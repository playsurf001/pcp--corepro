// Autenticação: login, senha (SHA-256 + salt), tokens de sessão (Web Crypto API)
import type { Context, Next } from 'hono';
import type { Bindings } from './db';
import { fail, audit } from './db';

/* ========= Hash / Sal ========= */
const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashSenha(salt: string, senha: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(salt + ':' + senha));
  return toHex(buf);
}

/* ========= Sessões ========= */
const SESSAO_HORAS = 12;

export async function criarSessao(
  db: D1Database,
  idUsuario: number,
  ip = '',
  ua = ''
): Promise<string> {
  const token = randomHex(32);
  const dtExp = new Date(Date.now() + SESSAO_HORAS * 3600 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  await db
    .prepare(
      `INSERT INTO sessoes (token, id_usuario, dt_expira, ip, user_agent) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(token, idUsuario, dtExp, ip, ua)
    .run();
  // Limpa sessões expiradas (housekeeping barato)
  await db.prepare(`DELETE FROM sessoes WHERE datetime(dt_expira) < datetime('now')`).run();
  return token;
}

export async function validarSessao(db: D1Database, token: string) {
  if (!token) return null;
  const r = await db
    .prepare(
      `SELECT s.token, s.dt_expira, u.id_usuario, u.login, u.nome, u.perfil, u.ativo, u.trocar_senha
       FROM sessoes s
       JOIN usuarios u ON u.id_usuario = s.id_usuario
       WHERE s.token = ? AND datetime(s.dt_expira) > datetime('now') AND u.ativo = 1`
    )
    .bind(token)
    .first<any>();
  return r || null;
}

export async function revogarSessao(db: D1Database, token: string) {
  await db.prepare(`DELETE FROM sessoes WHERE token = ?`).bind(token).run();
}

/* ========= Middleware ========= */
function getToken(c: Context): string {
  // 1) Authorization: Bearer xxx
  const auth = c.req.header('authorization') || c.req.header('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  // 2) Cookie pcp_token=...
  const cookie = c.req.header('cookie') || c.req.header('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)pcp_token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  // 3) x-pcp-token (header customizado para SPA)
  return c.req.header('x-pcp-token') || '';
}

/** Rotas públicas que NÃO precisam de autenticação */
const PUBLIC_PATHS = new Set<string>([
  '/api/health',
  '/api/auth/login',
  '/api/auth/bootstrap',
  '/api/auth/me', // responde com null se não logado, útil para SPA
]);

export async function authMiddleware(c: Context<{ Bindings: Bindings }>, next: Next) {
  const path = new URL(c.req.url).pathname;

  // Só protege /api/*
  if (!path.startsWith('/api/')) return next();
  if (PUBLIC_PATHS.has(path)) return next();

  const token = getToken(c);
  const sess = await validarSessao(c.env.DB, token);
  if (!sess) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Não autenticado.', code: 'AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  // Bloqueia operações se usuário tiver que trocar senha (exceto o próprio endpoint de troca)
  if (sess.trocar_senha && path !== '/api/auth/trocar-senha' && path !== '/api/auth/logout') {
    return new Response(
      JSON.stringify({ ok: false, error: 'Troca de senha obrigatória.', code: 'PASSWORD_CHANGE_REQUIRED' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }
  // Injeta usuário no contexto para as rotas usarem
  c.set('user', sess);
  return next();
}

/** Exige um perfil mínimo (admin > gerente > pcp > operador > visualizador) */
const RANK: Record<string, number> = {
  admin: 100,
  gerente: 80,
  pcp: 60,
  operador: 40,
  visualizador: 20,
};

export function requirePerfil(min: string) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as any;
    if (!user) return fail('Não autenticado.', 401);
    if ((RANK[user.perfil] || 0) < (RANK[min] || 0)) return fail('Perfil insuficiente.', 403);
    return next();
  };
}

/**
 * Bloqueia rotas para usuários comuns. Apenas perfil 'admin' pode acessar.
 * Usado para isolar módulos de Gestão / Produção / Chão de Fábrica / Engenharia / Cadastros.
 * Retorna 403 com código ADMIN_REQUIRED (consumido pelo SPA para redirecionar).
 */
export function requireAdmin() {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as any;
    if (!user) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Não autenticado.', code: 'AUTH_REQUIRED' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (user.perfil !== 'admin') {
      return new Response(
        JSON.stringify({ ok: false, error: 'Acesso restrito a administradores.', code: 'ADMIN_REQUIRED' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return next();
  };
}
