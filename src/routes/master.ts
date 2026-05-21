// Módulo Master — Área administrativa SaaS
// Endpoints sob /api/master/* — apenas super_admins.
// Capacidades SPRINT 1:
//   • Login / logout / me
//   • CRUD de empresas (companies)
//   • Bloquear / desbloquear / suspender empresa
//   • Trocar plano de empresa
//   • Dashboard (totais por status, MRR estimado, receita do mês)
//   • Listar planos
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, toInt } from '../lib/db';
import {
  hashSenha,
  criarSessaoMaster,
  revogarSessaoMaster,
} from '../lib/master_auth';
import { randomHex } from '../lib/auth';

const app = new Hono<{ Bindings: Bindings; Variables: { master: any } }>();

/* ============================================================
 * Health
 * ============================================================ */
app.get('/master/health', (c) => c.json(ok({ service: 'master', ts: new Date().toISOString() })));

/* ============================================================
 * AUTH — Login / Logout / Me (somente login é público)
 * ============================================================ */
app.post('/master/auth/login', async (c) => {
  try {
    const { login, senha } = (await c.req.json().catch(() => ({}))) as any;
    if (!login || !senha) return fail('Login e senha obrigatórios.', 400);

    const row: any = await c.env.DB.prepare(
      `SELECT id_super, login, nome, email, salt, senha_hash, ativo
         FROM super_admins WHERE login = ? AND ativo = 1`
    ).bind(String(login).trim().toLowerCase()).first();

    if (!row) return fail('Credenciais inválidas.', 401);

    const hash = await hashSenha(row.salt, String(senha));
    if (hash !== row.senha_hash) return fail('Credenciais inválidas.', 401);

    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
    const ua = c.req.header('user-agent') || '';
    const token = await criarSessaoMaster(c.env.DB, row.id_super, ip, ua);

    await c.env.DB.prepare(
      `UPDATE super_admins SET ultimo_acesso = datetime('now'), dt_atualizacao = datetime('now') WHERE id_super = ?`
    ).bind(row.id_super).run();

    return c.json(ok({
      token,
      master: {
        id_super: row.id_super,
        login: row.login,
        nome: row.nome,
        email: row.email,
      },
    }));
  } catch (e: any) {
    return fail('Erro no login master: ' + (e?.message || e), 500);
  }
});

app.post('/master/auth/logout', async (c) => {
  try {
    // master middleware já garantiu que está autenticado; mas pegamos o token
    const auth = c.req.header('authorization') || '';
    const t = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (t) await revogarSessaoMaster(c.env.DB, t);
    return c.json(ok({ logout: true }));
  } catch (e: any) {
    return fail('Erro no logout: ' + (e?.message || e), 500);
  }
});

app.get('/master/auth/me', async (c) => {
  const m = c.get('master');
  if (!m) return fail('Não autenticado.', 401);
  return c.json(ok({
    id_super: m.id_super,
    login: m.login,
    nome: m.nome,
    email: m.email,
  }));
});

/* ============================================================
 * DASHBOARD — Estatísticas globais do SaaS
 * ============================================================ */
app.get('/master/dashboard', async (c) => {
  try {
    // Empresas por status
    const porStatus: any = await c.env.DB.prepare(
      `SELECT status, COUNT(*) AS qtd FROM companies GROUP BY status`
    ).all();

    const totEmp: any = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM companies`).first();

    // MRR estimado: SUM(preco_aplicado) das subscriptions ativas
    const mrr: any = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(preco_aplicado),0) AS mrr FROM subscriptions WHERE status = 'ativa' AND ciclo = 'mensal'`
    ).first();

    // Receita do mês corrente (payments aprovados no mês)
    const mes = new Date().toISOString().slice(0, 7);
    const receita: any = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) AS receita
         FROM payments
         WHERE status = 'aprovado' AND substr(dt_pagamento,1,7) = ?`
    ).bind(mes).first();

    // Distribuição por plano
    const porPlano: any = await c.env.DB.prepare(
      `SELECT p.codigo, p.nome, COUNT(c.id_empresa) AS qtd
         FROM plans p
         LEFT JOIN companies c ON c.id_plano = p.id_plano
         GROUP BY p.id_plano
         ORDER BY p.ordem`
    ).all();

    // Empresas cadastradas (últimos 30 dias)
    const ultimas: any = await c.env.DB.prepare(
      `SELECT id_empresa, nome, slug, status, plano, dt_criacao
         FROM companies
         WHERE date(dt_criacao) >= date('now','-30 days')
         ORDER BY dt_criacao DESC LIMIT 20`
    ).all();

    return c.json(ok({
      totals: {
        empresas: Number(totEmp?.n || 0),
        mrr: Number(mrr?.mrr || 0),
        receita_mes: Number(receita?.receita || 0),
      },
      por_status: porStatus.results || [],
      por_plano:  porPlano.results || [],
      ultimas:    ultimas.results || [],
    }));
  } catch (e: any) {
    return fail('Erro no dashboard master: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * PLANOS — Listagem (CRUD simples — SPRINT 1)
 * ============================================================ */
app.get('/master/plans', async (c) => {
  try {
    const r = await c.env.DB.prepare(
      `SELECT id_plano, codigo, nome, descricao, preco_mensal,
              max_usuarios, max_remessas_mes, max_terceirizados, max_storage_mb,
              feat_relatorios_avancados, feat_api, feat_export_excel, feat_audit_log, feat_multi_filial,
              visivel, ordem
         FROM plans ORDER BY ordem, preco_mensal`
    ).all();
    return c.json(ok(r.results || []));
  } catch (e: any) {
    return fail('Erro ao listar planos: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * EMPRESAS — CRUD completo
 * ============================================================ */
function slugify(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'empresa-' + randomHex(4);
}

// Lista todas as empresas com dados consolidados
app.get('/master/empresas', async (c) => {
  try {
    const q = c.req.query();
    const wh: string[] = [];
    const bd: any[] = [];
    if (q.status) { wh.push('c.status = ?'); bd.push(q.status); }
    if (q.q)      { wh.push('(c.nome LIKE ? OR c.cnpj LIKE ? OR c.slug LIKE ?)');
                    bd.push('%'+q.q+'%','%'+q.q+'%','%'+q.q+'%'); }
    const where = wh.length ? 'WHERE ' + wh.join(' AND ') : '';

    const rows: any = await c.env.DB.prepare(
      `SELECT c.id_empresa, c.nome, c.cnpj, c.slug, c.status, c.plano,
              c.trial_ate, c.dt_criacao, c.dt_atualizacao,
              c.bloqueada_em, c.motivo_bloqueio, c.dt_suspensao,
              c.telefone, c.email_contato, c.cidade, c.uf,
              c.id_plano,
              p.codigo  AS plano_codigo,
              p.nome    AS plano_nome,
              p.preco_mensal AS plano_preco,
              (SELECT COUNT(*) FROM usuarios u WHERE u.id_empresa = c.id_empresa AND u.ativo = 1) AS qtd_usuarios,
              (SELECT COUNT(*) FROM terc_remessas r WHERE r.id_empresa = c.id_empresa) AS qtd_remessas,
              (SELECT status FROM subscriptions s WHERE s.id_empresa = c.id_empresa
                ORDER BY (CASE s.status WHEN 'ativa' THEN 1 WHEN 'trial' THEN 2 WHEN 'pendente' THEN 3 ELSE 9 END), s.dt_criacao DESC LIMIT 1) AS sub_status
         FROM companies c
         LEFT JOIN plans p ON p.id_plano = c.id_plano
         ${where}
         ORDER BY c.dt_criacao DESC`
    ).bind(...bd).all();

    return c.json(ok(rows.results || []));
  } catch (e: any) {
    return fail('Erro ao listar empresas: ' + (e?.message || e), 500);
  }
});

// Detalhe de empresa + última subscription + últimos payments
app.get('/master/empresas/:id', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);

    const empresa: any = await c.env.DB.prepare(
      `SELECT c.*, p.codigo AS plano_codigo, p.nome AS plano_nome, p.preco_mensal AS plano_preco
         FROM companies c
         LEFT JOIN plans p ON p.id_plano = c.id_plano
         WHERE c.id_empresa = ?`
    ).bind(id).first();

    if (!empresa) return fail('Empresa não encontrada.', 404);

    const sub: any = await c.env.DB.prepare(
      `SELECT s.*, p.codigo AS plano_codigo, p.nome AS plano_nome
         FROM subscriptions s
         LEFT JOIN plans p ON p.id_plano = s.id_plano
         WHERE s.id_empresa = ?
         ORDER BY (CASE s.status WHEN 'ativa' THEN 1 WHEN 'trial' THEN 2 WHEN 'pendente' THEN 3 ELSE 9 END), s.dt_criacao DESC LIMIT 1`
    ).bind(id).first();

    const payments: any = await c.env.DB.prepare(
      `SELECT id_payment, metodo, status, valor, dt_referencia, dt_pagamento, dt_vencimento, dt_criacao
         FROM payments WHERE id_empresa = ? ORDER BY dt_criacao DESC LIMIT 20`
    ).bind(id).all();

    const stats: any = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM usuarios       WHERE id_empresa = ? AND ativo = 1) AS qtd_usuarios,
         (SELECT COUNT(*) FROM terc_remessas  WHERE id_empresa = ?) AS qtd_remessas,
         (SELECT COUNT(*) FROM terc_retornos rt JOIN terc_remessas r ON r.id_remessa = rt.id_remessa WHERE r.id_empresa = ?) AS qtd_retornos,
         (SELECT COUNT(*) FROM terc_terceirizados WHERE id_empresa = ? AND ativo = 1) AS qtd_terceirizados`
    ).bind(id, id, id, id).first();

    return c.json(ok({ empresa, subscription: sub, payments: payments.results || [], stats }));
  } catch (e: any) {
    return fail('Erro ao carregar empresa: ' + (e?.message || e), 500);
  }
});

// Criar empresa
app.post('/master/empresas', async (c) => {
  try {
    const b = (await c.req.json().catch(() => ({}))) as any;
    if (!b.nome) return fail('Nome da empresa é obrigatório.', 400);

    const slug = b.slug ? slugify(b.slug) : slugify(b.nome);
    const id_plano = toInt(b.id_plano) || null;
    const trial_dias = toInt(b.trial_dias) || 0;
    const trial_ate = trial_dias > 0
      ? new Date(Date.now() + trial_dias * 86400000).toISOString().slice(0, 10)
      : null;
    const status = b.status || (trial_dias > 0 ? 'trial' : 'ativa');
    const plano_codigo = b.plano_codigo || (trial_dias > 0 ? 'trial' : 'starter');

    // Cria empresa
    const r = await c.env.DB.prepare(
      `INSERT INTO companies
         (nome, cnpj, slug, plano, status, trial_ate, telefone, email_contato,
          endereco, cidade, uf, cep, id_plano)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      String(b.nome).trim(),
      b.cnpj || null,
      slug,
      plano_codigo,
      status,
      trial_ate,
      b.telefone || null,
      b.email_contato || null,
      b.endereco || null,
      b.cidade || null,
      b.uf || null,
      b.cep || null,
      id_plano
    ).run();

    const id_empresa = Number((r.meta as any)?.last_row_id || 0);

    // Cria subscription inicial se id_plano informado
    if (id_plano) {
      const plano: any = await c.env.DB.prepare(
        `SELECT preco_mensal FROM plans WHERE id_plano = ?`
      ).bind(id_plano).first();
      const sub_status = trial_dias > 0 ? 'trial' : 'ativa';
      const m = c.get('master') as any;
      await c.env.DB.prepare(
        `INSERT INTO subscriptions
           (id_empresa, id_plano, status, ciclo, preco_aplicado, dt_inicio, trial_ate,
            dt_proxima_cobranca, criado_por, observacao)
         VALUES (?,?,?,?,?, datetime('now'), ?, ?, ?, ?)`
      ).bind(
        id_empresa, id_plano, sub_status, 'mensal',
        Number(plano?.preco_mensal || 0),
        trial_ate,
        trial_ate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        m?.login || 'system',
        'Criada via /master ao cadastrar empresa.'
      ).run();
    }

    return c.json(ok({ id_empresa, slug }));
  } catch (e: any) {
    return fail('Erro ao criar empresa: ' + (e?.message || e), 500);
  }
});

// Editar empresa
app.put('/master/empresas/:id', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    const b = (await c.req.json().catch(() => ({}))) as any;

    const fields: string[] = [];
    const binds: any[] = [];
    const set = (col: string, val: any) => { fields.push(`${col} = ?`); binds.push(val); };

    if (b.nome !== undefined)          set('nome',          String(b.nome).trim());
    if (b.cnpj !== undefined)          set('cnpj',          b.cnpj || null);
    if (b.slug !== undefined)          set('slug',          slugify(b.slug));
    if (b.telefone !== undefined)      set('telefone',      b.telefone || null);
    if (b.email_contato !== undefined) set('email_contato', b.email_contato || null);
    if (b.endereco !== undefined)      set('endereco',      b.endereco || null);
    if (b.cidade !== undefined)        set('cidade',        b.cidade || null);
    if (b.uf !== undefined)            set('uf',            b.uf || null);
    if (b.cep !== undefined)           set('cep',           b.cep || null);

    if (fields.length === 0) return fail('Nada para atualizar.', 400);
    fields.push(`dt_atualizacao = datetime('now')`);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE companies SET ${fields.join(', ')} WHERE id_empresa = ?`).bind(...binds).run();
    return c.json(ok({ id_empresa: id, updated: true }));
  } catch (e: any) {
    return fail('Erro ao editar empresa: ' + (e?.message || e), 500);
  }
});

// Bloquear empresa (administrativo — distinto de suspender por falta de pagamento)
app.post('/master/empresas/:id/bloquear', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    const b = (await c.req.json().catch(() => ({}))) as any;
    const motivo = b.motivo || 'Bloqueio administrativo';
    if (id === 1) return fail('Não é permitido bloquear a empresa fundadora.', 400);
    await c.env.DB.prepare(
      `UPDATE companies SET bloqueada_em = datetime('now'), motivo_bloqueio = ?, dt_atualizacao = datetime('now') WHERE id_empresa = ?`
    ).bind(motivo, id).run();
    return c.json(ok({ id_empresa: id, bloqueada: true }));
  } catch (e: any) {
    return fail('Erro ao bloquear: ' + (e?.message || e), 500);
  }
});

app.post('/master/empresas/:id/desbloquear', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    await c.env.DB.prepare(
      `UPDATE companies SET bloqueada_em = NULL, motivo_bloqueio = NULL, dt_atualizacao = datetime('now') WHERE id_empresa = ?`
    ).bind(id).run();
    return c.json(ok({ id_empresa: id, bloqueada: false }));
  } catch (e: any) {
    return fail('Erro ao desbloquear: ' + (e?.message || e), 500);
  }
});

// Suspender (falta pagamento)
app.post('/master/empresas/:id/suspender', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    if (id === 1) return fail('Não é permitido suspender a empresa fundadora.', 400);
    await c.env.DB.prepare(
      `UPDATE companies SET status = 'suspensa', dt_suspensao = datetime('now'), dt_atualizacao = datetime('now') WHERE id_empresa = ?`
    ).bind(id).run();
    await c.env.DB.prepare(
      `UPDATE subscriptions SET status = 'suspensa', dt_atualizacao = datetime('now') WHERE id_empresa = ? AND status IN ('ativa','trial','pendente')`
    ).bind(id).run();
    return c.json(ok({ id_empresa: id, status: 'suspensa' }));
  } catch (e: any) {
    return fail('Erro ao suspender: ' + (e?.message || e), 500);
  }
});

app.post('/master/empresas/:id/reativar', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    await c.env.DB.prepare(
      `UPDATE companies SET status = 'ativa', dt_suspensao = NULL, dt_atualizacao = datetime('now') WHERE id_empresa = ?`
    ).bind(id).run();
    await c.env.DB.prepare(
      `UPDATE subscriptions SET status = 'ativa', dt_atualizacao = datetime('now') WHERE id_empresa = ? AND status = 'suspensa'`
    ).bind(id).run();
    return c.json(ok({ id_empresa: id, status: 'ativa' }));
  } catch (e: any) {
    return fail('Erro ao reativar: ' + (e?.message || e), 500);
  }
});

// Trocar plano da empresa
app.post('/master/empresas/:id/trocar-plano', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    const b = (await c.req.json().catch(() => ({}))) as any;
    const id_plano = toInt(b.id_plano);
    if (!id_plano) return fail('id_plano obrigatório.', 400);

    const plano: any = await c.env.DB.prepare(
      `SELECT id_plano, codigo, preco_mensal FROM plans WHERE id_plano = ?`
    ).bind(id_plano).first();
    if (!plano) return fail('Plano não encontrado.', 404);

    // Atualiza companies
    await c.env.DB.prepare(
      `UPDATE companies SET id_plano = ?, plano = ?, dt_atualizacao = datetime('now') WHERE id_empresa = ?`
    ).bind(id_plano, plano.codigo, id).run();

    // Cancela subscriptions atuais e cria nova
    await c.env.DB.prepare(
      `UPDATE subscriptions SET status = 'cancelada', dt_fim = datetime('now'), dt_atualizacao = datetime('now')
         WHERE id_empresa = ? AND status IN ('ativa','trial','pendente')`
    ).bind(id).run();

    const m = c.get('master') as any;
    await c.env.DB.prepare(
      `INSERT INTO subscriptions
         (id_empresa, id_plano, status, ciclo, preco_aplicado, dt_inicio, dt_proxima_cobranca, criado_por, observacao)
       VALUES (?,?,?,?,?, datetime('now'), ?, ?, ?)`
    ).bind(
      id, id_plano, 'ativa', 'mensal', Number(plano.preco_mensal || 0),
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      m?.login || 'system',
      'Troca de plano via /master'
    ).run();

    return c.json(ok({ id_empresa: id, id_plano, codigo: plano.codigo }));
  } catch (e: any) {
    return fail('Erro ao trocar plano: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * USUÁRIOS DE EMPRESA — listagem (para suporte; sem editar senhas)
 * ============================================================ */
app.get('/master/empresas/:id/usuarios', async (c) => {
  try {
    const id = toInt(c.req.param('id'));
    if (!id) return fail('ID inválido.', 400);
    const r: any = await c.env.DB.prepare(
      `SELECT id_usuario, login, nome, perfil, email, ativo, is_owner, ultimo_login, dt_criacao
         FROM usuarios WHERE id_empresa = ? ORDER BY is_owner DESC, perfil DESC, nome`
    ).bind(id).all();
    return c.json(ok(r.results || []));
  } catch (e: any) {
    return fail('Erro ao listar usuários: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * SPRINT 2 — JOBS (cron / on-demand)
 * ============================================================ */

/**
 * POST /master/jobs/expire-trials
 * Expira trials vencidos:
 *   - companies com status='trial' AND date(trial_ate) < date('now') → status='suspensa'
 *   - subscriptions correspondentes → status='suspensa'
 *
 * Pode ser chamado:
 *   - manualmente pelo super_admin no painel
 *   - via Cloudflare Cron Trigger (futuro)
 *
 * Empresa id=1 (fundadora) é IMUNE.
 */
app.post('/master/jobs/expire-trials', async (c) => {
  try {
    // Lista candidatos (excluindo id=1)
    const cand: any = await c.env.DB.prepare(
      `SELECT id_empresa, nome, plano, trial_ate
         FROM companies
        WHERE id_empresa <> 1
          AND status = 'trial'
          AND trial_ate IS NOT NULL
          AND date(trial_ate) < date('now')`
    ).all();
    const ids = (cand.results || []).map((r: any) => r.id_empresa);

    if (ids.length === 0) {
      return c.json(ok({ processadas: 0, empresas: [] }));
    }

    // Suspende empresas
    for (const id of ids) {
      await c.env.DB.prepare(
        `UPDATE companies
            SET status = 'suspensa',
                dt_suspensao = datetime('now'),
                dt_atualizacao = datetime('now')
          WHERE id_empresa = ?`
      ).bind(id).run();
      await c.env.DB.prepare(
        `UPDATE subscriptions
            SET status = 'suspensa',
                dt_atualizacao = datetime('now')
          WHERE id_empresa = ? AND status IN ('ativa','trial','pendente')`
      ).bind(id).run();
    }

    return c.json(ok({ processadas: ids.length, empresas: cand.results }));
  } catch (e: any) {
    return fail('Erro ao expirar trials: ' + (e?.message || e), 500);
  }
});

/**
 * GET /master/jobs/preview-expire-trials — pré-visualiza quais empresas
 * seriam suspensas sem executar nada (útil para o painel)
 */
app.get('/master/jobs/preview-expire-trials', async (c) => {
  try {
    const cand: any = await c.env.DB.prepare(
      `SELECT id_empresa, nome, slug, plano, trial_ate,
              CAST(julianday('now') - julianday(trial_ate) AS INTEGER) AS dias_vencido
         FROM companies
        WHERE id_empresa <> 1
          AND status = 'trial'
          AND trial_ate IS NOT NULL
          AND date(trial_ate) < date('now')
        ORDER BY trial_ate`
    ).all();
    return c.json(ok({ qtd: (cand.results || []).length, empresas: cand.results || [] }));
  } catch (e: any) {
    return fail('Erro preview: ' + (e?.message || e), 500);
  }
});

/**
 * GET /master/jobs/proximas-cobrancas
 * Lista subscriptions com dt_proxima_cobranca nos próximos 7 dias
 */
app.get('/master/jobs/proximas-cobrancas', async (c) => {
  try {
    const r: any = await c.env.DB.prepare(
      `SELECT s.id_sub, s.id_empresa, c.nome AS empresa, p.codigo AS plano,
              s.preco_aplicado, s.dt_proxima_cobranca, s.status,
              CAST(julianday(s.dt_proxima_cobranca) - julianday('now') AS INTEGER) AS dias_para_vencer
         FROM subscriptions s
         JOIN companies c ON c.id_empresa = s.id_empresa
         LEFT JOIN plans p ON p.id_plano = s.id_plano
        WHERE s.status IN ('ativa','pendente')
          AND s.dt_proxima_cobranca IS NOT NULL
          AND date(s.dt_proxima_cobranca) <= date('now','+7 days')
        ORDER BY s.dt_proxima_cobranca`
    ).all();
    return c.json(ok({ qtd: (r.results || []).length, items: r.results || [] }));
  } catch (e: any) {
    return fail('Erro: ' + (e?.message || e), 500);
  }
});

export default app;
