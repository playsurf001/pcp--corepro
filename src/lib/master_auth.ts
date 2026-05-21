// Autenticação Super-Admin (Master) — independente do auth de empresas.
// Usa tabelas `super_admins` + `super_admin_sessoes`.
// Endpoints protegidos: /api/master/*
import type { Context, Next } from 'hono';
import type { Bindings } from './db';
import { fail } from './db';
import { hashSenha, randomHex } from './auth';

/* ========= Sessões Master ========= */
const MASTER_SESSAO_HORAS = 8; // sessão mais curta — área crítica

export async function criarSessaoMaster(
  db: D1Database,
  idSuper: number,
  ip = '',
  ua = ''
): Promise<string> {
  const token = 'm_' + randomHex(32); // prefixo distingue de tokens de usuário comum
  const dtExp = new Date(Date.now() + MASTER_SESSAO_HORAS * 3600 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  await db
    .prepare(
      `INSERT INTO super_admin_sessoes (token, id_super, expira_em, ip, user_agent) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(token, idSuper, dtExp, ip, ua)
    .run();
  await db
    .prepare(`DELETE FROM super_admin_sessoes WHERE datetime(expira_em) < datetime('now')`)
    .run();
  return token;
}

export async function validarSessaoMaster(db: D1Database, token: string) {
  if (!token || !token.startsWith('m_')) return null;
  const r = await db
    .prepare(
      `SELECT s.token, s.expira_em,
              sa.id_super, sa.login, sa.nome, sa.email, sa.ativo
       FROM super_admin_sessoes s
       JOIN super_admins sa ON sa.id_super = s.id_super
       WHERE s.token = ? AND datetime(s.expira_em) > datetime('now') AND sa.ativo = 1`
    )
    .bind(token)
    .first<any>();
  return r || null;
}

export async function revogarSessaoMaster(db: D1Database, token: string) {
  await db.prepare(`DELETE FROM super_admin_sessoes WHERE token = ?`).bind(token).run();
}

/* ========= Helper de extração de token ========= */
function getMasterToken(c: Context): string {
  // 1) Authorization: Bearer xxx (prioridade)
  const auth = c.req.header('authorization') || c.req.header('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  // 2) Cookie master_token
  const cookie = c.req.header('cookie') || c.req.header('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)master_token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  // 3) Header dedicado x-master-token
  return c.req.header('x-master-token') || '';
}

/* ========= Middleware ========= */

/**
 * Rotas master públicas (não exigem autenticação).
 */
const MASTER_PUBLIC = new Set<string>([
  '/api/master/auth/login',
  '/api/master/health',
]);

/**
 * Middleware que protege TODAS as rotas /api/master/* exigindo um super_admin
 * válido. NÃO usa o `validarSessao` regular (de usuários de empresa) — área isolada.
 *
 * Aplicar APÓS `authMiddleware` (que ignora /api/master/* já que esses paths não
 * estão em PUBLIC_PATHS mas vão falhar com 401 do auth comum). Solução: registrar
 * este middleware NA ROTA `/api/master` ANTES do authMiddleware global, ou
 * inserir `/api/master/*` no PUBLIC_PATHS do auth comum e fazer a checagem aqui.
 *
 * Decisão: usar `app.use('/api/master/*', masterAuthMiddleware)` ANTES do
 * `app.use('/api/*', authMiddleware)` no index.tsx — Hono executa middlewares
 * na ordem de registro e o primeiro match curto-circuita.
 */
export async function masterAuthMiddleware(
  c: Context<{ Bindings: Bindings; Variables: { master: any } }>,
  next: Next
) {
  const path = new URL(c.req.url).pathname;

  if (!path.startsWith('/api/master/')) return next();
  if (MASTER_PUBLIC.has(path)) return next();

  const token = getMasterToken(c);
  const sess = await validarSessaoMaster(c.env.DB, token);
  if (!sess) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sessão master inválida ou expirada.', code: 'MASTER_AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  c.set('master', sess);
  return next();
}

/**
 * Guard para rotas que devem rejeitar empresas suspensas / bloqueadas.
 * Aplica DEPOIS do authMiddleware comum — usa c.get('id_empresa') e consulta companies.
 * Rotas isentas (login, logout, me, healthcheck, troca de senha) NÃO devem
 * receber este middleware.
 */
export function tenantStatusGuard() {
  return async (c: Context<{ Bindings: Bindings; Variables: { user: any } }>, next: Next) => {
    const path = new URL(c.req.url).pathname;
    // Master tem seu próprio fluxo
    if (path.startsWith('/api/master/')) return next();
    // Endpoints públicos (webhooks, signup) — sem auth de empresa
    if (path.startsWith('/api/public/')) return next();
    // Rotas que devem permanecer acessíveis mesmo quando empresa está suspensa:
    // o usuário precisa poder logar para ver o aviso e pagar a fatura.
    if (
      path === '/api/health' ||
      path === '/api/auth/login' ||
      path === '/api/auth/bootstrap' ||
      path === '/api/auth/me' ||
      path === '/api/auth/logout' ||
      path === '/api/auth/trocar-senha' ||
      path === '/api/auth/perfil' ||
      path === '/api/empresa' ||
      path === '/api/empresa/uso' ||
      path.startsWith('/api/billing/') // usuário precisa poder pagar mesmo suspenso
    ) return next();

    const user = c.get('user') as any;
    if (!user) return next(); // authMiddleware já tratou
    const id_empresa = Number(user.id_empresa || 0);
    if (!id_empresa) return next();

    const empresa = await c.env.DB.prepare(
      `SELECT status, bloqueada_em, motivo_bloqueio FROM companies WHERE id_empresa = ?`
    ).bind(id_empresa).first<any>();

    if (!empresa) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Empresa não encontrada.', code: 'TENANT_NOT_FOUND' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (empresa.bloqueada_em) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Empresa bloqueada pelo administrador. ' + (empresa.motivo_bloqueio || ''),
          code: 'TENANT_BLOCKED',
          motivo: empresa.motivo_bloqueio || null,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (empresa.status === 'suspensa') {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Assinatura suspensa por falta de pagamento. Regularize para continuar usando o sistema.',
          code: 'TENANT_SUSPENDED',
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } } // 402 Payment Required
      );
    }
    if (empresa.status === 'cancelada') {
      return new Response(
        JSON.stringify({ ok: false, error: 'Conta cancelada.', code: 'TENANT_CANCELLED' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return next();
  };
}

/* ========= Re-export para conveniência ========= */
export { hashSenha };
