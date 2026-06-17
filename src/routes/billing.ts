// =====================================================================
// SPRINT 3+D — Billing / Cobranças PIX
// =====================================================================
// 3 grupos de endpoints:
//   1) /api/master/billing/*  → super_admin (criar/aprovar cobranças)
//   2) /api/billing/*         → usuário autenticado (minhas faturas)
//   3) /api/public/mp/webhook → webhook Mercado Pago (sem auth, com HMAC)
//
// SPRINT D — Aprimoramentos:
//   - Webhook valida HMAC-SHA256 (header x-signature) com MP_WEBHOOK_SECRET
//   - Idempotência via tabela payment_webhook_events (UNIQUE external_id)
//   - aplicarPagamentoAprovado() integra com Sprint C:
//       * Libera companies.bloqueada_por_pagamento = 0
//       * Registra sub_log com evento='payment_approved'
//       * dt_proxima_cobranca = max(hoje, dt_proxima_atual) + 30d (não perde dias)
//   - Endpoint /master/billing/payments/:id/simulate-approved (só em modo MOCK)
// =====================================================================
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, toInt, toNum } from '../lib/db';
import { criarPixMP, consultarPagamentoMP } from '../lib/mercadopago';
import { MercadoPagoGateway } from '../lib/payments/mercadopago';
import { isMockMode } from '../lib/payments/factory';
import { logSub } from '../lib/lifecycle';

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
 * SPRINT D — Retorna o access token efetivo para chamar a API do MP.
 * - Se MP_USE_MOCK=1 → retorna undefined (força modo MOCK em criarPixMP/consultarPagamentoMP)
 * - Senão → retorna MP_ACCESS_TOKEN (pode ser undefined também = mock fallback)
 */
function getMPToken(env: Bindings): string | undefined {
  if (env.MP_USE_MOCK === '1' || env.MP_USE_MOCK === 'true') return undefined;
  return env.MP_ACCESS_TOKEN;
}

/**
 * HOTFIX 0052 — Registra evento de cobrança em payment_logs.
 * Nunca quebra o fluxo principal: erros de log são silenciados.
 */
async function logarPaymentEvent(
  c: any,
  params: {
    id_empresa: number;
    id_payment?: number | null;
    usuario_login?: string | null;
    gateway?: string;
    acao: 'create' | 'consult' | 'webhook' | 'diagnostico';
    status: 'success' | 'error';
    valor?: number | null;
    mp_payment_id?: string | null;
    http_status?: number | null;
    erro_curto?: string | null;
    payload_req?: any;
    payload_res?: any;
  }
): Promise<void> {
  try {
    const truncate = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) + '…' : s);
    // Limpa credenciais do payload antes de salvar
    const cleanPayload = (obj: any): string => {
      if (!obj) return '';
      try {
        const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
        return truncate(
          json.replace(/("?(access_token|authorization|x-signature|secret)"?\s*[:=]\s*"?)[^",}\s]+/gi, '$1***'),
          2000
        );
      } catch { return ''; }
    };
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
    const ua = truncate(c.req.header('user-agent') || '', 200);
    await c.env.DB.prepare(
      `INSERT INTO payment_logs
         (id_empresa, id_payment, usuario_login, gateway, acao, status, valor,
          mp_payment_id, http_status, erro_curto, payload_req, payload_res, ip_origem, user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      params.id_empresa,
      params.id_payment ?? null,
      params.usuario_login ?? null,
      params.gateway || 'mercadopago',
      params.acao,
      params.status,
      params.valor ?? null,
      params.mp_payment_id ?? null,
      params.http_status ?? null,
      params.erro_curto ? truncate(params.erro_curto, 500) : null,
      cleanPayload(params.payload_req),
      cleanPayload(params.payload_res),
      ip,
      ua
    ).run();
  } catch { /* silencioso — log nunca quebra o fluxo */ }
}

/**
 * Sanitiza email do pagador para evitar 400 do MP.
 * MP rejeita TLDs reservados (.test, .local, .example, .invalid) e
 * emails malformados. Fallback usa nosso próprio domínio.
 */
function emailPagadorSeguro(emailRaw: string | undefined | null, id_empresa: number): string {
  const e = (emailRaw || '').trim().toLowerCase();
  const re = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  const reservedTLDs = ['.test', '.local', '.example', '.invalid', '.localhost'];
  const isReserved = reservedTLDs.some((tld) => e.endsWith(tld));
  if (e && re.test(e) && !isReserved) return e;
  // Fallback: gera email plausível em domínio nosso (válido para o MP)
  return `cobranca+empresa${id_empresa}@corepro.com.br`;
}

/**
 * SPRINT D — Aplica efeitos colaterais de um pagamento aprovado.
 *
 * - payment.status='aprovado' + dt_pagamento
 * - subscription:
 *     * status='ativa'
 *     * dt_proxima_cobranca = max(hoje, dt_proxima_atual) + 30d (PRESERVA DIAS)
 *     * limpa dt_pagamento_atrasada e ultimo_aviso_em
 * - companies:
 *     * status='ativa' (se estava suspensa/pendente)
 *     * bloqueada_por_pagamento = 0  ← Sprint C
 *     * dt_suspensao = NULL
 * - Registra sub_log com evento='payment_approved' e origem='webhook'|'master'|'manual'
 *
 * Idempotente: se payment já estava 'aprovado', retorna alteracao=false sem mexer em nada.
 */
async function aplicarPagamentoAprovado(
  db: D1Database,
  payment: { id_payment: number; id_sub: number; id_empresa: number; valor: number; status?: string },
  opts?: { origem?: string; ator?: string },
): Promise<{ alteracao: boolean; status_antes?: string; status_depois?: string }> {
  // Empresa id=1 (founder) é cortesia e não tem cobrança; mas se vier um payment
  // associado por algum motivo, ainda aplicamos (não bloqueia).
  if (payment.status === 'aprovado') {
    return { alteracao: false };
  }

  const origem = opts?.origem || 'webhook';
  const ator = opts?.ator || 'system';

  // 1) Payment → aprovado
  await db.prepare(
    `UPDATE payments
        SET status='aprovado',
            dt_pagamento = COALESCE(dt_pagamento, datetime('now')),
            dt_atualizacao = datetime('now')
      WHERE id_payment = ?
        AND status <> 'aprovado'`
  ).bind(payment.id_payment).run();

  // 2) Buscar subscription para snapshot + cálculo dt_proxima_cobranca
  const sub: any = await db.prepare(
    `SELECT id_sub, status, dt_proxima_cobranca FROM subscriptions WHERE id_sub = ?`
  ).bind(payment.id_sub).first();

  const status_antes: string = sub?.status || 'unknown';

  // 3) Subscription → ativa + estende prazo (max preserva dias caso cliente pague antes)
  await db.prepare(
    `UPDATE subscriptions
        SET status = 'ativa',
            dt_proxima_cobranca = date(
              CASE
                WHEN dt_proxima_cobranca IS NULL OR date(dt_proxima_cobranca) < date('now')
                  THEN date('now')
                ELSE dt_proxima_cobranca
              END,
              '+30 days'
            ),
            dt_pagamento_atrasada = NULL,
            ultimo_aviso_em = NULL,
            dt_atualizacao = datetime('now')
      WHERE id_sub = ?`
  ).bind(payment.id_sub).run();

  // 4) Empresa → ativa + desbloqueio
  await db.prepare(
    `UPDATE companies
        SET status = 'ativa',
            bloqueada_por_pagamento = 0,
            dt_suspensao = NULL,
            dt_atualizacao = datetime('now')
      WHERE id_empresa = ?`
  ).bind(payment.id_empresa).run();

  // 5) Log auditável (Sprint C)
  try {
    await logSub(db, {
      id_sub: payment.id_sub,
      id_empresa: payment.id_empresa,
      evento: 'payment_approved',
      status_antes,
      status_depois: 'ativa',
      origem,
      detalhes: {
        id_payment: payment.id_payment,
        valor: payment.valor,
        ator,
      },
    });
  } catch (e) {
    // Log auxiliar — não bloqueia o pagamento se logSub falhar
    console.error('logSub falhou ao aprovar payment', e);
  }

  return { alteracao: true, status_antes, status_depois: 'ativa' };
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
    const mp = await criarPixMP(getMPToken(c.env), {
      amount: valor,
      description: `CorePro — Assinatura ${empresa?.nome || ''} ref ${ref}`,
      external_reference: String(id_payment),
      payer_email: emailPagadorSeguro(empresa?.email_contato, id_empresa),
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
      // HOTFIX 0052 — payload normalizado com aliases
      qr_code: mp.qr_code,
      qr_base64: mp.qr_base64,
      qr_code_base64: mp.qr_base64,
      pix_copia_cola: mp.qr_code,
      ticket_url: mp.ticket_url,
      expires_at: mp.expires_at,
      dt_expiracao: mp.expires_at,
      referencia: id_payment,
      mp_error: mp.error || null,
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
    const m = c.get('master') as any;
    const p: any = await c.env.DB.prepare(
      `SELECT id_payment, id_sub, id_empresa, valor, status FROM payments WHERE id_payment = ?`
    ).bind(id).first();
    if (!p) return fail('Pagamento não encontrado.', 404);
    if (p.status === 'aprovado') return c.json(ok({ id_payment: id, alteracao: false }));
    const result = await aplicarPagamentoAprovado(c.env.DB, p, {
      origem: 'master',
      ator: m?.login || 'master',
    });
    return c.json(ok({ id_payment: id, ...result }));
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
    const r = await consultarPagamentoMP(getMPToken(c.env), p.mp_payment_id);
    if (!r.ok) return fail('Falha consulta MP: ' + r.error, 502);
    const m = c.get('master') as any;
    if (r.status === 'aprovado' && p.status !== 'aprovado') {
      await aplicarPagamentoAprovado(c.env.DB, p, { origem: 'master', ator: m?.login || 'master' });
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
 * HOTFIX 0052 — Diagnóstico e logs do gateway PIX (MASTER)
 * ============================================================ */

/**
 * GET /api/master/billing/payment-logs
 * Lista os últimos eventos de cobrança (sucesso e falha).
 * Aceita ?id_empresa, ?status (success|error), ?acao, ?limit (default 100, max 500).
 */
app.get('/master/billing/payment-logs', async (c) => {
  try {
    const q = c.req.query();
    const wh: string[] = [];
    const bd: any[] = [];
    if (q.id_empresa) { wh.push('pl.id_empresa = ?'); bd.push(toInt(q.id_empresa)); }
    if (q.status)     { wh.push('pl.status = ?');     bd.push(q.status); }
    if (q.acao)       { wh.push('pl.acao = ?');       bd.push(q.acao); }
    if (q.id_payment) { wh.push('pl.id_payment = ?'); bd.push(toInt(q.id_payment)); }
    const where = wh.length ? 'WHERE ' + wh.join(' AND ') : '';
    const limit = Math.min(toInt(q.limit) || 100, 500);
    const r: any = await c.env.DB.prepare(
      `SELECT pl.*, c.nome AS empresa_nome, c.slug AS empresa_slug
         FROM payment_logs pl
         LEFT JOIN companies c ON c.id_empresa = pl.id_empresa
         ${where}
         ORDER BY pl.dt_criacao DESC
         LIMIT ${limit}`
    ).bind(...bd).all();
    return c.json(ok(r.results || []));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

/**
 * GET /api/master/billing/diagnostico-pix
 * Roda uma série de testes contra o gateway Mercado Pago para
 * verificar se as credenciais e a chave PIX estão funcionando.
 *
 * Testes:
 *   1) Credenciais configuradas (env vars)
 *   2) Token válido (chama /v1/users/me)
 *   3) Conexão com API MP
 *   4) Criação de cobrança real (R$ 0,01, marcada como teste)
 *   5) Consulta da cobrança recém-criada
 *
 * Resposta inclui detalhes de cada etapa.
 */
app.get('/master/billing/diagnostico-pix', async (c) => {
  const m = c.get('master') as any;
  const env = c.env;
  const result: any = {
    iniciado_em: new Date().toISOString(),
    executado_por: m?.login || 'master',
    modo: 'desconhecido',
    testes: [] as any[],
    resumo: { total: 0, sucesso: 0, falha: 0 },
  };

  const addTest = (nome: string, sucesso: boolean, detalhe: any) => {
    result.testes.push({ nome, sucesso, detalhe });
    result.resumo.total++;
    if (sucesso) result.resumo.sucesso++; else result.resumo.falha++;
  };

  // ===== 1) Credenciais =====
  const hasToken      = !!env.MP_ACCESS_TOKEN;
  const hasPubKey     = !!env.MP_PUBLIC_KEY;
  const hasWebhookSec = !!env.MP_WEBHOOK_SECRET;
  const useMock       = env.MP_USE_MOCK === '1' || env.MP_USE_MOCK === 'true';
  result.modo = useMock ? 'mock' : (hasToken ? 'producao' : 'mock-fallback');
  addTest('credenciais', hasToken && hasPubKey && hasWebhookSec, {
    MP_ACCESS_TOKEN: hasToken ? 'OK' : 'AUSENTE',
    MP_PUBLIC_KEY: hasPubKey ? 'OK' : 'AUSENTE',
    MP_WEBHOOK_SECRET: hasWebhookSec ? 'OK' : 'AUSENTE',
    MP_USE_MOCK: useMock ? 'true' : 'false',
  });

  // Se modo mock, pula testes online
  if (useMock || !hasToken) {
    addTest('conexao_mp', false, { aviso: 'Pulado (modo MOCK)' });
    addTest('criacao_pix', false, { aviso: 'Pulado (modo MOCK)' });
    addTest('consulta_pix', false, { aviso: 'Pulado (modo MOCK)' });
    return c.json(ok(result));
  }

  // ===== 2) Token válido + 3) Conexão API =====
  try {
    const r = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
    });
    if (r.ok) {
      const j: any = await r.json();
      addTest('token_valido', true, {
        usuario_id: j.id || null,
        email: j.email || null,
        site_id: j.site_id || null,
        country_id: j.country_id || null,
      });
      addTest('conexao_mp', true, { http_status: 200, latencia_ok: true });
    } else {
      const txt = await r.text();
      addTest('token_valido', false, { http_status: r.status, erro: txt.slice(0, 300) });
      addTest('conexao_mp', false, { http_status: r.status });
      return c.json(ok(result));
    }
  } catch (e: any) {
    addTest('token_valido', false, { erro: e?.message || String(e) });
    addTest('conexao_mp', false, { erro: 'Falha de rede' });
    return c.json(ok(result));
  }

  // ===== 4) Criação de cobrança teste (R$ 0,01) =====
  let testMpId: string | null = null;
  try {
    const mp = await criarPixMP(env.MP_ACCESS_TOKEN, {
      amount: 0.01,
      description: 'CorePro DIAGNOSTICO PIX (R$ 0,01) — pode ignorar',
      external_reference: 'DIAG-' + Date.now(),
      payer_email: 'diagnostico@corepro.com.br',
    });
    if (mp.ok && mp.qr_code) {
      testMpId = mp.mp_payment_id;
      addTest('criacao_pix', true, {
        mp_payment_id: mp.mp_payment_id,
        tem_qr_code: !!mp.qr_code,
        tem_qr_base64: !!mp.qr_base64,
        qr_code_len: mp.qr_code.length,
        expires_at: mp.expires_at,
      });
    } else {
      addTest('criacao_pix', false, {
        erro: mp.error || 'Sem QR code retornado',
        ok: mp.ok,
        diagnostico_provavel: (mp.error || '').toLowerCase().includes('without key enabled')
          ? 'Conta MP sem chave PIX cadastrada — vá em mercadopago.com.br → Sua conta → PIX'
          : 'Erro do gateway, verificar payload',
      });
    }
  } catch (e: any) {
    addTest('criacao_pix', false, { erro: e?.message || String(e) });
  }

  // ===== 5) Consulta da cobrança =====
  if (testMpId) {
    try {
      const r = await consultarPagamentoMP(env.MP_ACCESS_TOKEN, testMpId);
      addTest('consulta_pix', r.ok, {
        mp_payment_id: testMpId,
        status: r.status,
        ok: r.ok,
      });
    } catch (e: any) {
      addTest('consulta_pix', false, { erro: e?.message || String(e) });
    }
  } else {
    addTest('consulta_pix', false, { aviso: 'Pulado (criação falhou)' });
  }

  // Log do diagnóstico
  await logarPaymentEvent(c, {
    id_empresa: 0, usuario_login: m?.login,
    acao: 'diagnostico',
    status: result.resumo.falha === 0 ? 'success' : 'error',
    erro_curto: result.resumo.falha === 0 ? null : `${result.resumo.falha} de ${result.resumo.total} testes falharam`,
    payload_res: result.resumo,
  });

  result.finalizado_em = new Date().toISOString();
  return c.json(ok(result));
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

/**
 * SPRINT D — Polling de status (chamado pela UI a cada N segundos enquanto
 * o modal PIX está aberto). Retorna o status atual do pagamento + se foi aprovado
 * para fechar o modal e atualizar a UI.
 */
app.get('/billing/payment/:id/status', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  if (!id) return fail('ID inválido.', 400);
  try {
    const p: any = await c.env.DB.prepare(
      `SELECT id_payment, status, valor, dt_pagamento, dt_expiracao, mp_status
         FROM payments
        WHERE id_payment = ? AND id_empresa = ?`
    ).bind(id, id_empresa).first();
    if (!p) return fail('Pagamento não encontrado.', 404);

    // Se ainda pendente e tem mp_payment_id, faz uma consulta light no MP
    // (não bloqueia: se MP estiver indisponível, retorna status do DB)
    let synced = false;
    if (p.status === 'pendente') {
      const full: any = await c.env.DB.prepare(
        `SELECT mp_payment_id, id_sub, id_empresa, valor, status FROM payments WHERE id_payment = ?`
      ).bind(id).first();
      if (full?.mp_payment_id) {
        try {
          const r = await consultarPagamentoMP(getMPToken(c.env), full.mp_payment_id);
          if (r.ok && r.status === 'aprovado' && p.status !== 'aprovado') {
            await aplicarPagamentoAprovado(c.env.DB, full, { origem: 'system', ator: 'self_polling' });
            p.status = 'aprovado';
            p.dt_pagamento = new Date().toISOString();
            synced = true;
          } else if (r.ok && r.status !== p.status) {
            await c.env.DB.prepare(
              `UPDATE payments SET status=?, mp_status=?, dt_atualizacao=datetime('now') WHERE id_payment=?`
            ).bind(r.status, r.status, id).run();
            p.status = r.status;
            synced = true;
          }
        } catch {
          // ignora falha no MP (mantém status do DB)
        }
      }
    }

    return c.json(ok({
      id_payment: p.id_payment,
      status: p.status,
      valor: p.valor,
      dt_pagamento: p.dt_pagamento,
      dt_expiracao: p.dt_expiracao,
      mp_status: p.mp_status,
      synced,
      aprovado: p.status === 'aprovado',
    }));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

app.post('/billing/gerar-cobranca', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const user = c.get('user') as any;
  try {
    // HOTFIX 0052 — só reusa cobranças com QR válido (mp_qr_code não vazio
    // e mp_payment_id presente). Cobranças órfãs (que falharam ao chamar o
    // MP e ficaram com mp_qr_code NULL) são marcadas como 'cancelado' para
    // não bloquearem a próxima tentativa.
    const exist: any = await c.env.DB.prepare(
      `SELECT id_payment, valor, mp_payment_id, mp_qr_code, mp_qr_base64, mp_link,
              dt_expiracao, status
         FROM payments WHERE id_empresa = ? AND status = 'pendente'
           AND (dt_expiracao IS NULL OR datetime(dt_expiracao) > datetime('now'))
         ORDER BY dt_criacao DESC LIMIT 1`
    ).bind(id_empresa).first();

    if (exist) {
      // Reuso válido: já tem QR code e mp_payment_id preenchidos
      if (exist.mp_qr_code && exist.mp_qr_code.length > 10 && exist.mp_payment_id) {
        return c.json(ok({
          id_payment: exist.id_payment,
          valor: exist.valor,
          status: exist.status,
          mp_payment_id: exist.mp_payment_id,
          // HOTFIX 0052 — payload normalizado: emite AMBOS os aliases
          // (qr_code, qr_base64, qr_code_base64) para compatibilidade com
          // o frontend e com integrações externas.
          qr_code: exist.mp_qr_code,
          qr_base64: exist.mp_qr_base64,
          qr_code_base64: exist.mp_qr_base64,
          pix_copia_cola: exist.mp_qr_code,
          ticket_url: exist.mp_link,
          expires_at: exist.dt_expiracao,
          dt_expiracao: exist.dt_expiracao,
          referencia: exist.id_payment,
          reused: true,
        }));
      }
      // Reuso inválido: cobrança órfã sem QR → cancela e segue para criar uma nova
      await c.env.DB.prepare(
        `UPDATE payments SET status='cancelado', dt_atualizacao=datetime('now'),
                            observacao=COALESCE(observacao,'') || ' [auto-cancelada: sem QR válido]'
         WHERE id_payment = ?`
      ).bind(exist.id_payment).run();
    }

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
    const mpReq = {
      amount: valor,
      description: `CorePro — Assinatura ${empresa?.nome || ''} ref ${ref}`,
      external_reference: String(id_payment),
      payer_email: emailPagadorSeguro(empresa?.email_contato, id_empresa),
      payer_name: empresa?.nome,
      payer_doc: empresa?.cnpj,
      webhook_url: `${baseUrl}/api/public/mp/webhook`,
    };
    const mp = await criarPixMP(getMPToken(c.env), mpReq);

    await c.env.DB.prepare(
      `UPDATE payments
          SET mp_payment_id=?, mp_status=?, mp_qr_code=?, mp_qr_base64=?, mp_link=?,
              dt_expiracao=?, dt_atualizacao=datetime('now')
        WHERE id_payment=?`
    ).bind(mp.mp_payment_id, mp.status, mp.qr_code, mp.qr_base64, mp.ticket_url, mp.expires_at, id_payment).run();

    // Se MP retornou erro (sem QR code), traduz a mensagem para o usuário final
    if (!mp.ok || (!mp.qr_code && !mp.mock)) {
      let userMsg = 'Falha ao gerar PIX no Mercado Pago.';
      const errStr = (mp.error || '').toLowerCase();
      if (errStr.includes('without key enabled') || errStr.includes('qr render')) {
        userMsg = 'Conta Mercado Pago do recebedor ainda não tem chave PIX habilitada. ' +
                  'Acesse mercadopago.com.br → Sua conta → PIX e cadastre uma chave.';
      } else if (errStr.includes('identification') || errStr.includes('document')) {
        userMsg = 'Documento (CPF/CNPJ) inválido. Atualize o cadastro da empresa.';
      } else if (errStr.includes('email')) {
        userMsg = 'E-mail do pagador inválido. Atualize o cadastro da empresa.';
      } else if (mp.error) {
        userMsg = 'Mercado Pago recusou a cobrança: ' + mp.error.substring(0, 200);
      }
      // HOTFIX 0052 — log de falha
      await logarPaymentEvent(c, {
        id_empresa, id_payment, usuario_login: user?.login,
        acao: 'create', status: 'error', valor,
        mp_payment_id: mp.mp_payment_id,
        erro_curto: userMsg,
        payload_req: { ...mpReq, payer_doc: mpReq.payer_doc ? '***' + String(mpReq.payer_doc).slice(-3) : null },
        payload_res: { ok: mp.ok, status: mp.status, error: mp.error, raw_excerpt: mp.raw ? JSON.stringify(mp.raw).slice(0, 500) : null },
      });
      return c.json({
        ok: false,
        error: userMsg,
        data: {
          id_payment, mock: mp.mock, valor, status: 'erro',
          mp_error: mp.error || null,
        },
      }, 502);
    }

    // HOTFIX 0052 — log de sucesso
    await logarPaymentEvent(c, {
      id_empresa, id_payment, usuario_login: user?.login,
      acao: 'create', status: 'success', valor,
      mp_payment_id: mp.mp_payment_id,
      payload_req: { amount: valor, mock: mp.mock, ref },
      payload_res: { status: mp.status, has_qr: !!mp.qr_code, expires_at: mp.expires_at },
    });

    return c.json(ok({
      id_payment,
      mp_payment_id: mp.mp_payment_id,
      mock: mp.mock,
      valor,
      status: mp.status,
      // HOTFIX 0052 — payload normalizado com TODOS os aliases
      qr_code: mp.qr_code,
      qr_base64: mp.qr_base64,
      qr_code_base64: mp.qr_base64,
      pix_copia_cola: mp.qr_code,
      ticket_url: mp.ticket_url,
      expires_at: mp.expires_at,
      dt_expiracao: mp.expires_at,
      referencia: id_payment,
      reused: false,
    }));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * SPRINT D — WEBHOOK MERCADO PAGO (público + HMAC + idempotência)
 *
 * Fluxo:
 *   1) Captura headers (x-signature, x-request-id) e query data.id
 *   2) Lê body bruto + parseia JSON
 *   3) Tenta INSERT em payment_webhook_events com UNIQUE external_id
 *      - Se UNIQUE falhar: replay → retorna 200 (idempotência)
 *      - Senão: continua processando
 *   4) Valida HMAC (se MP_WEBHOOK_SECRET configurado E não estamos em mock)
 *      - Se inválida: registra signature_valid=0, status='error', retorna 401
 *   5) Resolve payment local pelo mp_payment_id (== data.id)
 *   6) Consulta MP para pegar status atualizado
 *   7) Aplica transição (aprovar / atualizar status) se necessário
 *   8) Atualiza payment_webhook_events com resultado e duração
 *
 * Retorna SEMPRE 200 para casos de "OK ignorado" para o MP não re-enfileirar.
 * Retorna 401 apenas em assinatura inválida (MP entende e ajusta).
 * ============================================================ */
app.post('/public/mp/webhook', async (c) => {
  const t0 = Date.now();
  let id_event: number | null = null;
  // Captura inputs cedo para conseguir logar mesmo em erro
  const xSig = c.req.header('x-signature') || '';
  const xReqId = c.req.header('x-request-id') || '';
  const xRequestUuid = c.req.header('x-request-id') || c.req.header('x-idempotency-key') || '';
  const ipOrigem =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-real-ip') ||
    c.req.header('x-forwarded-for') ||
    '';
  // Capturar headers para auditoria (sem Authorization)
  const headersObj: Record<string, string> = {};
  for (const [k, v] of (c.req.raw.headers as Headers).entries()) {
    const kl = k.toLowerCase();
    if (kl === 'authorization' || kl === 'cookie') continue;
    headersObj[k] = v;
  }

  // 1) Lê body
  let body: any = {};
  let bodyText = '';
  try {
    bodyText = await c.req.text();
    if (bodyText) body = JSON.parse(bodyText);
  } catch {
    body = {};
  }

  const mpId = String(
    body?.data?.id || body?.id || c.req.query('id') || c.req.query('data.id') || ''
  );
  const eventType = String(body?.type || body?.topic || '');
  const action = String(body?.action || '');
  // external_id: prioriza x-request-id (MP usa pra deduplica) + fallback timestamp+mpId
  const external_id = xRequestUuid || (mpId ? `${mpId}-${Date.now()}` : null);

  // 2) Idempotência: tenta inserir event antes de processar
  try {
    const r = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO payment_webhook_events
         (gateway, external_id, resource_id, event_type, action,
          status, signature_valid, payload, headers, ip_origem)
       VALUES ('mercadopago', ?, ?, ?, ?, 'received', 0, ?, ?, ?)`
    ).bind(
      external_id,
      mpId || null,
      eventType || null,
      action || null,
      bodyText ? bodyText.slice(0, 4000) : null,
      JSON.stringify(headersObj).slice(0, 2000),
      ipOrigem || null,
    ).run();
    const changes = Number((r.meta as any)?.changes || 0);
    if (changes === 0 && external_id) {
      // INSERT OR IGNORE não inseriu → já existe (replay)
      return c.json({ ok: true, replay: true, external_id }, 200);
    }
    id_event = Number((r.meta as any)?.last_row_id || 0) || null;
  } catch (e) {
    console.error('webhook insert event falhou', e);
    // Continua processando mesmo se log falhar
  }

  // Helper para atualizar o evento ao final
  const finishEvent = async (
    status: 'processed' | 'ignored' | 'error',
    signature_valid: number,
    resultado: any,
    erro?: string,
    id_payment?: number,
  ) => {
    if (!id_event) return;
    try {
      await c.env.DB.prepare(
        `UPDATE payment_webhook_events
            SET status=?, signature_valid=?, resultado=?, erro=?,
                id_payment=?, dt_processado=datetime('now'), duracao_ms=?
          WHERE id_event=?`
      ).bind(
        status,
        signature_valid,
        resultado ? JSON.stringify(resultado).slice(0, 4000) : null,
        erro || null,
        id_payment || null,
        Date.now() - t0,
        id_event,
      ).run();
    } catch {}
  };

  if (!mpId) {
    await finishEvent('ignored', 0, null, 'no resource id');
    return c.json({ ok: true, ignored: 'no id' });
  }

  // 3) Valida HMAC (se temos secret configurado)
  // Em modo mock OU sem secret configurado, pula validação (dev)
  let signature_valid = 0;
  const mockMode = isMockMode(c.env);
  const secret = c.env.MP_WEBHOOK_SECRET;
  if (secret && !mockMode) {
    try {
      const valid = await MercadoPagoGateway.verifyWebhookSignature(xSig, xReqId, mpId, secret);
      signature_valid = valid ? 1 : 0;
      if (!valid) {
        await finishEvent('error', 0, { mpId }, 'invalid signature');
        return c.json({ ok: false, error: 'invalid signature' }, 401);
      }
    } catch (e: any) {
      await finishEvent('error', 0, { mpId }, 'signature check threw: ' + (e?.message || e));
      return c.json({ ok: false, error: 'signature error' }, 401);
    }
  } else {
    // Sem secret OU modo mock — aceita mas marca como não validado
    signature_valid = mockMode ? 1 : 0;
  }

  // 4) Resolve payment local + consulta MP para status atualizado
  try {
    const pay: any = await c.env.DB.prepare(
      `SELECT id_payment, id_sub, id_empresa, status, valor, mp_payment_id
         FROM payments WHERE mp_payment_id = ?`
    ).bind(mpId).first();

    if (!pay) {
      await finishEvent('ignored', signature_valid, { mpId }, 'payment not found');
      return c.json({ ok: true, ignored: 'payment not found', mp_id: mpId });
    }

    // Consulta MP (em mock retorna sempre pendente)
    const r = await consultarPagamentoMP(getMPToken(c.env), mpId);
    if (!r.ok) {
      await finishEvent('error', signature_valid, { mpId, r }, r.error || 'mp query failed', pay.id_payment);
      return c.json({ ok: false, error: r.error || 'mp query failed', mp_id: mpId });
    }

    let aplicou: any = { alteracao: false };
    if (r.status === 'aprovado' && pay.status !== 'aprovado') {
      aplicou = await aplicarPagamentoAprovado(c.env.DB, pay, { origem: 'webhook', ator: 'mp_webhook' });
    } else if (pay.status !== r.status) {
      // Status mudou para algo diferente de 'aprovado' (rejeitado/cancelado/expirado)
      await c.env.DB.prepare(
        `UPDATE payments SET status=?, mp_status=?, dt_atualizacao=datetime('now') WHERE id_payment=?`
      ).bind(r.status, r.status, pay.id_payment).run();
    }

    await finishEvent(
      'processed',
      signature_valid,
      { mpId, status: r.status, aplicou },
      undefined,
      pay.id_payment,
    );
    return c.json({ ok: true, mp_id: mpId, status: r.status, ...(aplicou.alteracao ? { aplicou } : {}) });
  } catch (e: any) {
    console.error('mp_webhook erro', e);
    await finishEvent('error', signature_valid, { mpId }, e?.message || String(e));
    return c.json({ ok: false, error: e?.message || String(e) });
  }
});

/* ============================================================
 * SPRINT D — Helper master: listar webhooks recebidos
 * ============================================================ */
app.get('/master/billing/webhooks', async (c) => {
  try {
    const limit = Math.min(Math.max(toInt(c.req.query('limit')) || 50, 1), 200);
    const r: any = await c.env.DB.prepare(
      `SELECT id_event, gateway, external_id, resource_id, event_type, action,
              status, signature_valid, id_payment, ip_origem,
              dt_recebido, dt_processado, duracao_ms, erro
         FROM payment_webhook_events
        ORDER BY dt_recebido DESC
        LIMIT ?`
    ).bind(limit).all();
    return c.json(ok(r.results || []));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

app.get('/master/billing/webhooks/:id', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    const e: any = await c.env.DB.prepare(
      `SELECT * FROM payment_webhook_events WHERE id_event = ?`
    ).bind(id).first();
    if (!e) return fail('Evento não encontrado.', 404);
    // Parse payload/headers JSON para o response (mais útil para debug)
    try { e.payload_parsed = e.payload ? JSON.parse(e.payload) : null; } catch {}
    try { e.headers_parsed = e.headers ? JSON.parse(e.headers) : null; } catch {}
    try { e.resultado_parsed = e.resultado ? JSON.parse(e.resultado) : null; } catch {}
    return c.json(ok(e));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * SPRINT D — MASTER: simular pagamento aprovado (somente em modo MOCK)
 * Permite testar todo o fluxo (sub→ativa, empresa→desbloqueada, sub_log)
 * sem precisar realmente pagar via PIX no MP.
 * ============================================================ */
app.post('/master/billing/payments/:id/simulate-approved', async (c) => {
  try {
    if (!isMockMode(c.env)) {
      return fail('Só disponível em modo MOCK (MP_USE_MOCK=1). Em produção use sync ou aprove manualmente.', 403);
    }
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    const m = c.get('master') as any;
    const p: any = await c.env.DB.prepare(
      `SELECT id_payment, id_sub, id_empresa, valor, status FROM payments WHERE id_payment = ?`
    ).bind(id).first();
    if (!p) return fail('Pagamento não encontrado.', 404);
    if (p.status === 'aprovado') return c.json(ok({ id_payment: id, alteracao: false }));
    const result = await aplicarPagamentoAprovado(c.env.DB, p, {
      origem: 'master',
      ator: m?.login || 'master',
    });
    return c.json(ok({ id_payment: id, ...result, simulated: true }));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

export default app;
