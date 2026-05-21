// =====================================================================
// SPRINT 4 — Signup público (cadastro de novas empresas)
// =====================================================================
// Endpoint público sem auth: cria empresa + owner em uma transação lógica.
// Aplica trial automático (default 14 dias) com plano Profissional.
//
// Rotas:
//   POST /api/public/signup           → cadastra nova empresa + owner
//   GET  /api/public/planos           → lista planos visíveis (landing/cadastro)
//   POST /api/public/signup/check     → valida slug/email/login disponíveis
// =====================================================================
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, toInt } from '../lib/db';
import { hashSenha, randomHex, criarSessao } from '../lib/auth';

const app = new Hono<{ Bindings: Bindings }>();

function slugify(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'empresa-' + randomHex(4);
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_RX = /^[a-zA-Z0-9_.\-]+$/;

/* ============================================================
 * GET /public/planos — lista planos visíveis (sem trial)
 * ============================================================ */
app.get('/public/planos', async (c) => {
  try {
    const r: any = await c.env.DB.prepare(
      `SELECT id_plano, codigo, nome, descricao, preco_mensal,
              max_usuarios, max_remessas_mes, max_terceirizados,
              feat_relatorios_avancados, feat_api, feat_export_excel, feat_audit_log, feat_multi_filial,
              ordem
         FROM plans
        WHERE visivel = 1
          AND codigo <> 'trial'
        ORDER BY ordem, preco_mensal`
    ).all();
    return c.json(ok(r.results || []));
  } catch (e: any) {
    return fail('Erro ao listar planos: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * POST /public/signup/check — valida disponibilidade
 * Body: { slug?, login_admin?, email_contato? }
 * ============================================================ */
app.post('/public/signup/check', async (c) => {
  try {
    const b: any = await c.req.json().catch(() => ({}));
    const result: any = { ok: true };

    if (b.slug) {
      const s = slugify(b.slug);
      const r = await c.env.DB.prepare(
        `SELECT 1 FROM companies WHERE slug = ? LIMIT 1`
      ).bind(s).first();
      result.slug = { valor: s, disponivel: !r };
    }

    if (b.login_admin) {
      const login = String(b.login_admin).trim().toLowerCase();
      result.login_admin = {
        valor: login,
        valido: LOGIN_RX.test(login) && login.length >= 3,
        // Login pode repetir entre empresas diferentes — checagem global é só info.
        existe_global: !!(await c.env.DB.prepare(
          `SELECT 1 FROM usuarios WHERE lower(login) = ? LIMIT 1`
        ).bind(login).first()),
      };
    }

    if (b.email_contato) {
      const email = String(b.email_contato).trim().toLowerCase();
      result.email_contato = {
        valor: email,
        valido: EMAIL_RX.test(email),
      };
    }

    return c.json(ok(result));
  } catch (e: any) {
    return fail('Erro check: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * POST /public/signup — cadastro de nova empresa
 *
 * Body:
 *   {
 *     nome_empresa:    string (required)
 *     cnpj?:           string
 *     slug?:           string (auto-gerado se omitido)
 *     telefone?:       string
 *     email_contato?:  string (também usado como contato comercial)
 *     cidade?, uf?, cep?, endereco?
 *
 *     nome_admin:      string (required)
 *     email_admin:     string (required, usado como login se login_admin omitido)
 *     login_admin?:    string
 *     senha_admin:     string (>= 6 chars)
 *
 *     plano_codigo?:   string ('trial' default | 'starter' | 'profissional' | 'premium')
 *     trial_dias?:     number (default 14, máx 30)
 *   }
 *
 * Retorna: { id_empresa, slug, id_usuario, token, trial_ate }
 * ============================================================ */
app.post('/public/signup', async (c) => {
  try {
    const b: any = await c.req.json().catch(() => ({}));

    // --- Validações básicas ---
    const nome_empresa = String(b.nome_empresa || '').trim();
    if (!nome_empresa || nome_empresa.length < 2)
      return fail('Nome da empresa é obrigatório (mín 2 chars).', 400);

    const nome_admin = String(b.nome_admin || '').trim();
    if (!nome_admin || nome_admin.length < 2)
      return fail('Nome do administrador é obrigatório.', 400);

    const email_admin = String(b.email_admin || '').trim().toLowerCase();
    if (!EMAIL_RX.test(email_admin))
      return fail('E-mail inválido.', 400);

    const senha_admin = String(b.senha_admin || '');
    if (senha_admin.length < 6)
      return fail('Senha deve ter pelo menos 6 caracteres.', 400);

    let login_admin = String(b.login_admin || email_admin.split('@')[0] || '').trim().toLowerCase();
    login_admin = login_admin.replace(/[^a-z0-9_.\-]/g, '');
    if (login_admin.length < 3) login_admin = 'admin' + randomHex(2);

    // --- Slug único ---
    let slug = slugify(b.slug || nome_empresa);
    let tentativa = 0;
    while (true) {
      const ex = await c.env.DB.prepare(
        `SELECT 1 FROM companies WHERE slug = ? LIMIT 1`
      ).bind(slug).first();
      if (!ex) break;
      tentativa++;
      slug = slugify(b.slug || nome_empresa) + '-' + randomHex(2);
      if (tentativa > 5) return fail('Não foi possível gerar slug único — informe um manualmente.', 400);
    }

    // --- Resolve plano ---
    const planoCodigo = String(b.plano_codigo || 'trial').toLowerCase();
    const plano: any = await c.env.DB.prepare(
      `SELECT id_plano, codigo, preco_mensal FROM plans WHERE codigo = ? LIMIT 1`
    ).bind(planoCodigo).first();
    if (!plano) return fail('Plano inválido: ' + planoCodigo, 400);

    // --- Trial (default 14 dias, máx 30) ---
    const trialDias = Math.min(30, Math.max(0, toInt(b.trial_dias, planoCodigo === 'trial' ? 14 : 0)));
    const trial_ate = trialDias > 0
      ? new Date(Date.now() + trialDias * 86400000).toISOString().slice(0, 10)
      : null;
    const statusEmpresa = trialDias > 0 ? 'trial' : 'ativa';
    const planoSalvo = trialDias > 0 ? 'trial' : (planoCodigo === 'trial' ? 'starter' : planoCodigo);

    // --- INSERT companies ---
    const insEmp = await c.env.DB.prepare(
      `INSERT INTO companies
         (nome, cnpj, slug, plano, status, trial_ate,
          telefone, email_contato, endereco, cidade, uf, cep, id_plano)
       VALUES (?,?,?,?,?,?, ?,?,?,?,?,?, ?)`
    ).bind(
      nome_empresa,
      b.cnpj ? String(b.cnpj).trim() : null,
      slug,
      planoSalvo,
      statusEmpresa,
      trial_ate,
      b.telefone || null,
      b.email_contato || email_admin,
      b.endereco || null,
      b.cidade || null,
      b.uf ? String(b.uf).trim().toUpperCase().slice(0, 2) : null,
      b.cep || null,
      plano.id_plano
    ).run();

    const id_empresa = Number((insEmp.meta as any)?.last_row_id || 0);
    if (!id_empresa) return fail('Falha ao criar empresa.', 500);

    // --- Garante unicidade GLOBAL de login (schema legado mantém UNIQUE global) ---
    // Se já existir, sufixa com hex curto até encontrar disponível.
    let tentativasLogin = 0;
    while (true) {
      const dupLogin = await c.env.DB.prepare(
        `SELECT 1 FROM usuarios WHERE lower(login) = ? LIMIT 1`
      ).bind(login_admin).first();
      if (!dupLogin) break;
      tentativasLogin++;
      const sufixo = randomHex(2);
      // Mantém base ≤ 16 chars + sufixo (4) = 20 chars max
      const base = login_admin.replace(/-[a-f0-9]{4}$/, '').slice(0, 16);
      login_admin = `${base}-${sufixo}`;
      if (tentativasLogin > 5) return fail('Não foi possível gerar login único.', 500);
    }

    // --- INSERT usuário admin (owner) ---
    const salt = randomHex(16);
    const hash = await hashSenha(salt, senha_admin);
    const insUsr = await c.env.DB.prepare(
      `INSERT INTO usuarios
         (login, nome, email, senha_hash, senha_salt, perfil, ativo, trocar_senha,
          criado_por, id_empresa, is_owner)
       VALUES (?,?,?,?,?,?, 1, 0, ?, ?, 1)`
    ).bind(
      login_admin,
      nome_admin,
      email_admin,
      hash,
      salt,
      'admin',
      'signup',
      id_empresa
    ).run();

    const id_usuario = Number((insUsr.meta as any)?.last_row_id || 0);

    // --- Cria subscription inicial ---
    const subStatus = trialDias > 0 ? 'trial' : 'ativa';
    await c.env.DB.prepare(
      `INSERT INTO subscriptions
         (id_empresa, id_plano, status, ciclo, preco_aplicado, dt_inicio, trial_ate,
          dt_proxima_cobranca, criado_por, observacao)
       VALUES (?,?,?,?,?, datetime('now'), ?, ?, ?, ?)`
    ).bind(
      id_empresa,
      plano.id_plano,
      subStatus,
      'mensal',
      Number(plano.preco_mensal || 0),
      trial_ate,
      trial_ate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      'signup',
      trialDias > 0
        ? `Trial de ${trialDias} dias iniciado via signup público.`
        : 'Assinatura paga iniciada via signup público.'
    ).run();

    // --- Cria sessão automática para login imediato ---
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
    const ua = c.req.header('user-agent') || '';
    const token = await criarSessao(c.env.DB, id_usuario, ip, ua);

    await c.env.DB.prepare(
      `UPDATE usuarios SET ultimo_login = datetime('now') WHERE id_usuario = ?`
    ).bind(id_usuario).run();

    // --- Audit (opcional) ---
    try {
      await c.env.DB.prepare(
        `INSERT INTO auditoria (usuario, modulo, acao, chave_registro, campo, valor_anterior, valor_novo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        login_admin, 'SIGNUP', 'CREATE', `empresa:${id_empresa}`,
        'plano', '', planoSalvo
      ).run();
    } catch {}

    return c.json(ok({
      id_empresa,
      slug,
      id_usuario,
      login_admin,
      token,
      trial_ate,
      trial_dias: trialDias,
      plano_codigo: planoSalvo,
      empresa: { id_empresa, nome: nome_empresa, slug, plano: planoSalvo, status: statusEmpresa },
      usuario: { id_usuario, login: login_admin, nome: nome_admin, perfil: 'admin', is_owner: true },
    }));
  } catch (e: any) {
    return fail('Erro no signup: ' + (e?.message || e), 500);
  }
});

export default app;
