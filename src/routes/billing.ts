// =====================================================================
// SPRINT 3 — Billing / Cobranças PIX
// =====================================================================
// 3 grupos de endpoints:
//   1) /api/master/billing/*  → super_admin (criar/aprovar cobranças)
//   2) /api/billing/*         → usuário autenticado (minhas faturas)
//   3) /api/public/mp/webhook → webhook Mercado Pago (sem auth)
// =====================================================================
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, toInt, toNum } from '../lib/db';
import { criarPixMP, consultarPagamentoMP } from '../lib/mercadopago';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any; master: any } }>();

function getBaseUrl(c: any): string {
  return (
    (c.env.PUBLIC_BASE_URL && String(c.env.PUBLIC_BASE_URL).replace(/\/+$/, '')) ||
    new URL(c.req.url).origin
  );
}

function refMes(d?: Date): string {
  return (d || new Date()).toISOString().slice(0, 7);
}

/**
 * Aplica efeitos colaterais de um pagamento aprovado:
 *   - payment.status='aprovado'
 *   - subscription.status='ativa', dt_proxima_cobranca = hoje+30d
 *   - empresa.status='ativa' (se estava suspensa/pendente)
 */
async function aplicarPagamentoAprovado(
  db: D1Database,
  payment: { id_payment: number; id_sub: number; id_empresa: number; valor: number }
) {
  await db.prepare(
    `UPDATE payments
        SET status='aprovado',
            dt_pagamento = COALESCE(dt_pagamento, datetime('now')),
            dt_atualizacao = datetime('now')
      WHERE id_payment = ?`
  ).bind(payment.id_payment).run();

  await db.prepare(
    `UPDATE subscriptions
        SET status='ativa',
            dt_proxima_cobranca = date('now','+30 days'),
            dt_atualizacao = datetime('now')
      WHERE id_sub = ?`
  ).bind(payment.id_sub).run();

  await db.prepare(
    `UPDATE companies
        SET status='ativa',
            dt_suspensao = NULL,
            dt_atualizacao = datetime('now')
      WHERE id_empresa = ?
        AND status IN ('suspensa','trial','pendente')`
  ).bind(payment.id_empresa).run();
}

/* ============================================================
 * MASTER — Criar cobrança PIX
 * ============================================================ */
app.post('/master/billing/empresas/:id/cobrar', async (c) => {
  try {
    const id_empresa = toInt(c.req.param('id'));
    if (!id_empresa) return fail('ID inválido.', 400);
    const m = c.get('master') as any;
    const b: any = await c.req.json().catch(() => ({}));

    let sub: any = await c.env.DB.prepare(
      `SELECT id_sub, id_plano, preco_aplicado, ciclo, status
         FROM subscriptions WHERE id_empresa = ?
        ORDER BY (CASE status WHEN 'ativa' THEN 1 WHEN 'pendente' THEN 2 WHEN 'trial' THEN 3 WHEN 'suspensa' THEN 4 ELSE 9 END), dt_criacao DESC
        LIMIT 1`
    ).bind(id_empresa).first();

    if (!sub) {
      const emp: any = await c.env.DB.prepare(
        `SELECT id_plano FROM companies WHERE id_empresa = ?`
      ).bind(id_empresa).first();
      if (!emp || !emp.id_plano) return fail('Empresa sem plano definido. Defina um plano antes.', 400);
      const plano: any = await c.env.DB.prepare(
        `SELECT preco_mensal FROM plans WHERE id_plano = ?`
      ).bind(emp.id_plano).first();
      const r = await c.env.DB.prepare(
        `INSERT INTO subscriptions
           (id_empresa, id_plano, status, ciclo, preco_aplicado, dt_inicio, dt_proxima_cobranca, criado_por, observacao)
         VALUES (?,?,?,?,?, datetime('now'), date('now','+30 days'), ?, ?)`
      ).bind(
        id_empresa, emp.id_plano, 'pendente', 'mensal',
        Number(plano?.preco_mensal || 0),
        m?.login || 'system',
        'Subscription criada para gerar primeira cobrança via /master/billing'
      ).run();
      sub = {
        id_sub: Number((r.meta as any)?.last_row_id || 0),
        preco_aplicado: Number(plano?.preco_mensal || 0),
      };
    }

    const valor = toNum(b.valor, Number(sub.preco_aplicado || 0));
    if (valor <= 0) return fail('Valor inválido.', 400);

    const ref = refMes();
    const empresa: any = await c.env.DB.prepare(
      `SELECT nome, cnpj, email_contato FROM companies WHERE id_empresa = ?`
    ).bind(id_empresa).first();

    const pr = await c.env.DB.prepare(
      `INSERT INTO payments
         (id_sub, id_empresa, metodo, status, valor, moeda,
          dt_referencia, dt_vencimento, observacao, registrado_por)
       VALUES (?,?,?,?,?,?, ?, date('now','+1 day'), ?, ?)`
    ).bind(
      sub.id_sub, id_empresa, 'pix', 'pendente', valor, 'BRL', ref,
      b.observacao || 'Cobrança gerada via /master/billing',
      m?.login || 'system'
    ).run();
    const id_payment = Number((pr.meta as any)?.last_row_id || 0);

    const baseUrl = getBaseUrl(c);
    const mp = await criarPixMP(c.env.MP_ACCESS_TOKEN, {
      amount: valor,
      description: `CorePro — Assinatura ${empresa?.nome || ''} ref ${ref}`,
      external_reference: String(id_payment),
      payer_email: empresa?.email_contato || `empresa${id_empresa}@corepro.local`,
      payer_name: empresa?.nome,
      payer_doc: empresa?.cnpj,
      webhook_url: `${baseUrl}/api/public/mp/webhook`,
    });

    await c.env.DB.prepare(
      `UPDATE payments
          SET mp_payment_id=?, mp_status=?, mp_qr_code=?, mp_qr_base64=?, mp_link=?,
              dt_expiracao=?, dt_atualizacao=datetime('now')
        WHERE id_payment=?`
    ).bind(mp.mp_payment_id, mp.status, mp.qr_code, mp.qr_base64, mp.ticket_url, mp.expires_at, id_payment).run();

    return c.json(ok({
      id_payment, mock: mp.mock, mp_payment_id: mp.mp_payment_id, status: mp.status, valor,
      qr_code: mp.qr_code, qr_base64: mp.qr_base64, ticket_url: mp.ticket_url,
      expires_at: mp.expires_at, mp_error: mp.error || null,
    }));
  } catch (e: any) {
    return fail('Erro ao gerar cobrança: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * MASTER — Listar / detalhar / aprovar / sync payments
 * ============================================================ */
app.get('/master/billing/payments', async (c) => {
  try {
    const q = c.req.query();
    const wh: string[] = [];
    const bd: any[] = [];
    if (q.id_empresa) { wh.push('p.id_empresa = ?'); bd.push(toInt(q.id_empresa)); }
    if (q.status)     { wh.push('p.status = ?'); bd.push(q.status); }
    if (q.metodo)     { wh.push('p.metodo = ?'); bd.push(q.metodo); }
    if (q.mes)        { wh.push('p.dt_referencia = ?'); bd.push(q.mes); }
    const where = wh.length ? 'WHERE ' + wh.join(' AND ') : '';
    const r: any = await c.env.DB.prepare(
      `SELECT p.id_payment, p.id_sub, p.id_empresa, p.metodo, p.status, p.valor, p.moeda,
              p.mp_payment_id, p.mp_status, p.mp_link,
              p.dt_referencia, p.dt_vencimento, p.dt_pagamento, p.dt_expiracao,
              p.dt_criacao, p.observacao, p.registrado_por,
              c.nome AS empresa_nome, c.slug AS empresa_slug,
              pl.codigo AS plano_codigo
         FROM payments p
         JOIN companies c ON c.id_empresa = p.id_empresa
         LEFT JOIN subscriptions s ON s.id_sub = p.id_sub
         LEFT JOIN plans pl ON pl.id_plano = s.id_plano
         ${where}
         ORDER BY p.dt_criacao DESC
         LIMIT 200`
    ).bind(...bd).all();
    return c.json(ok(r.results || []));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

app.get('/master/billing/payments/:id', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    const p: any = await c.env.DB.prepare(`SELECT * FROM payments WHERE id_payment = ?`).bind(id).first();
    if (!p) return fail('Pagamento não encontrado.', 404);
    return c.json(ok(p));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

app.post('/master/billing/payments/:id/aprovar', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    const p: any = await c.env.DB.prepare(
      `SELECT id_payment, id_sub, id_empresa, valor, status FROM payments WHERE id_payment = ?`
    ).bind(id).first();
    if (!p) return fail('Pagamento não encontrado.', 404);
    if (p.status === 'aprovado') return c.json(ok({ id_payment: id, alteracao: false }));
    await aplicarPagamentoAprovado(c.env.DB, p);
    return c.json(ok({ id_payment: id, alteracao: true }));
  } catch (e: any) {
    return fail('Erro ao aprovar: ' + (e?.message || e), 500);
  }
});

app.post('/master/billing/payments/:id/cancelar', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    await c.env.DB.prepare(
      `UPDATE payments SET status='cancelado', dt_atualizacao=datetime('now') WHERE id_payment=?`
    ).bind(id).run();
    return c.json(ok({ id_payment: id, status: 'cancelado' }));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

app.post('/master/billing/payments/:id/sync', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    const p: any = await c.env.DB.prepare(
      `SELECT id_payment, id_sub, id_empresa, mp_payment_id, status, valor FROM payments WHERE id_payment = ?`
    ).bind(id).first();
    if (!p) return fail('Pagamento não encontrado.', 404);
    if (!p.mp_payment_id) return fail('Payment sem mp_payment_id.', 400);
    const r = await consultarPagamentoMP(c.env.MP_ACCESS_TOKEN, p.mp_payment_id);
    if (!r.ok) return fail('Falha consulta MP: ' + r.error, 502);
    if (r.status === 'aprovado' && p.status !== 'aprovado') {
      await aplicarPagamentoAprovado(c.env.DB, p);
    } else {
      await c.env.DB.prepare(
        `UPDATE payments SET status=?, mp_status=?, dt_atualizacao=datetime('now') WHERE id_payment=?`
      ).bind(r.status, r.status, id).run();
    }
    return c.json(ok({ id_payment: id, status: r.status }));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * MASTER — Resumo financeiro
 * ============================================================ */
app.get('/master/billing/resumo', async (c) => {
  try {
    const meses: any = await c.env.DB.prepare(
      `SELECT dt_referencia AS mes,
              COUNT(*) AS qtd,
              COALESCE(SUM(CASE WHEN status='aprovado' THEN valor ELSE 0 END),0) AS receita,
              COALESCE(SUM(CASE WHEN status='pendente' THEN valor ELSE 0 END),0) AS pendente,
              COALESCE(SUM(CASE WHEN status='rejeitado' THEN valor ELSE 0 END),0) AS rejeitado
         FROM payments
        WHERE dt_referencia IS NOT NULL
        GROUP BY dt_referencia
        ORDER BY dt_referencia DESC
        LIMIT 12`
    ).all();

    const stat: any = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM payments WHERE status='aprovado') AS pagamentos_aprovados,
         (SELECT COUNT(*) FROM payments WHERE status='pendente') AS pagamentos_pendentes,
         (SELECT COALESCE(SUM(valor),0) FROM payments WHERE status='aprovado'
            AND substr(dt_pagamento,1,7) = strftime('%Y-%m','now')) AS receita_mes,
         (SELECT COALESCE(SUM(valor),0) FROM payments WHERE status='aprovado') AS receita_total,
         (SELECT COALESCE(SUM(preco_aplicado),0) FROM subscriptions
            WHERE status='ativa' AND ciclo='mensal') AS mrr,
         (SELECT COUNT(*) FROM companies WHERE status='suspensa') AS empresas_suspensas`
    ).first();

    return c.json(ok({ resumo: stat, por_mes: meses.results || [] }));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * EMPRESA (usuário comum) — minhas faturas
 * ============================================================ */
app.get('/billing/minhas-faturas', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  try {
    const r: any = await c.env.DB.prepare(
      `SELECT id_payment, metodo, status, valor, moeda,
              mp_link, mp_qr_code, mp_qr_base64,
              dt_referencia, dt_vencimento, dt_pagamento, dt_expiracao, dt_criacao, observacao
         FROM payments WHERE id_empresa = ?
        ORDER BY dt_criacao DESC LIMIT 50`
    ).bind(id_empresa).all();
    return c.json(ok(r.results || []));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

app.get('/billing/proxima-fatura', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  try {
    const sub: any = await c.env.DB.prepare(
      `SELECT s.id_sub, s.status, s.preco_aplicado, s.dt_proxima_cobranca, s.ciclo,
              p.codigo AS plano_codigo, p.nome AS plano_nome, p.preco_mensal AS plano_preco
         FROM subscriptions s
         LEFT JOIN plans p ON p.id_plano = s.id_plano
         WHERE s.id_empresa = ?
         ORDER BY (CASE s.status
                     WHEN 'ativa' THEN 1
                     WHEN 'trial' THEN 2
                     WHEN 'pendente' THEN 3
                     WHEN 'suspensa' THEN 4
                     ELSE 9 END), s.dt_criacao DESC
         LIMIT 1`
    ).bind(id_empresa).first();
    const pendente: any = await c.env.DB.prepare(
      `SELECT id_payment, valor, status, mp_qr_code, mp_qr_base64, mp_link, dt_expiracao
         FROM payments WHERE id_empresa = ? AND status = 'pendente'
        ORDER BY dt_criacao DESC LIMIT 1`
    ).bind(id_empresa).first();
    return c.json(ok({ subscription: sub, pendente }));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

app.post('/billing/gerar-cobranca', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const user = c.get('user') as any;
  try {
    const exist: any = await c.env.DB.prepare(
      `SELECT id_payment, valor, mp_qr_code, mp_qr_base64, mp_link, dt_expiracao, status
         FROM payments WHERE id_empresa = ? AND status = 'pendente'
           AND (dt_expiracao IS NULL OR datetime(dt_expiracao) > datetime('now'))
         ORDER BY dt_criacao DESC LIMIT 1`
    ).bind(id_empresa).first();
    if (exist) return c.json(ok({ ...exist, reused: true }));

    const sub: any = await c.env.DB.prepare(
      `SELECT id_sub, id_plano, preco_aplicado FROM subscriptions WHERE id_empresa = ?
         ORDER BY (CASE status WHEN 'ativa' THEN 1 WHEN 'pendente' THEN 2 WHEN 'trial' THEN 3 WHEN 'suspensa' THEN 4 ELSE 9 END), dt_criacao DESC LIMIT 1`
    ).bind(id_empresa).first();
    if (!sub) return fail('Sem subscription cadastrada.', 400);
    const valor = Number(sub.preco_aplicado || 0);
    if (valor <= 0) return fail('Subscription com valor zero — fale com o suporte.', 400);

    const ref = refMes();
    const empresa: any = await c.env.DB.prepare(
      `SELECT nome, cnpj, email_contato FROM companies WHERE id_empresa = ?`
    ).bind(id_empresa).first();

    const pr = await c.env.DB.prepare(
      `INSERT INTO payments
         (id_sub, id_empresa, metodo, status, valor, moeda,
          dt_referencia, dt_vencimento, observacao, registrado_por)
       VALUES (?,?,?,?,?,?, ?, date('now','+1 day'), ?, ?)`
    ).bind(
      sub.id_sub, id_empresa, 'pix', 'pendente', valor, 'BRL',
      ref, 'Cobrança gerada via app pelo usuário', user?.login || 'self-service'
    ).run();
    const id_payment = Number((pr.meta as any)?.last_row_id || 0);

    const baseUrl = getBaseUrl(c);
    const mp = await criarPixMP(c.env.MP_ACCESS_TOKEN, {
      amount: valor,
      description: `CorePro — Assinatura ${empresa?.nome || ''} ref ${ref}`,
      external_reference: String(id_payment),
      payer_email: empresa?.email_contato || `empresa${id_empresa}@corepro.local`,
      payer_name: empresa?.nome,
      payer_doc: empresa?.cnpj,
      webhook_url: `${baseUrl}/api/public/mp/webhook`,
    });

    await c.env.DB.prepare(
      `UPDATE payments
          SET mp_payment_id=?, mp_status=?, mp_qr_code=?, mp_qr_base64=?, mp_link=?,
              dt_expiracao=?, dt_atualizacao=datetime('now')
        WHERE id_payment=?`
    ).bind(mp.mp_payment_id, mp.status, mp.qr_code, mp.qr_base64, mp.ticket_url, mp.expires_at, id_payment).run();

    return c.json(ok({
      id_payment, mock: mp.mock, valor, status: mp.status,
      qr_code: mp.qr_code, qr_base64: mp.qr_base64, ticket_url: mp.ticket_url,
      expires_at: mp.expires_at, reused: false,
    }));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * WEBHOOK MERCADO PAGO (público)
 * ============================================================ */
app.post('/public/mp/webhook', async (c) => {
  try {
    const body: any = await c.req.json().catch(() => ({}));
    const mpId = String(
      body?.data?.id || body?.id || c.req.query('id') || c.req.query('data.id') || ''
    );
    if (!mpId) return c.json({ ok: true, ignored: 'no id' });

    const pay: any = await c.env.DB.prepare(
      `SELECT id_payment, id_sub, id_empresa, status, valor, mp_payment_id
         FROM payments WHERE mp_payment_id = ?`
    ).bind(mpId).first();

    const r = await consultarPagamentoMP(c.env.MP_ACCESS_TOKEN, mpId);

    if (pay && r.ok) {
      if (r.status === 'aprovado' && pay.status !== 'aprovado') {
        await aplicarPagamentoAprovado(c.env.DB, pay);
      } else if (pay.status !== r.status) {
        await c.env.DB.prepare(
          `UPDATE payments SET status=?, mp_status=?, dt_atualizacao=datetime('now') WHERE id_payment=?`
        ).bind(r.status, r.status, pay.id_payment).run();
      }
    }
    return c.json({ ok: true, mp_id: mpId, status: r.status });
  } catch (e: any) {
    console.error('mp_webhook', e);
    return c.json({ ok: false, error: e?.message || String(e) });
  }
});

export default app;
