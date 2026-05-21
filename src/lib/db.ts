// Camada de acesso ao D1 + helpers
import type { Context } from 'hono';

export type Bindings = {
  DB: D1Database;
};

/** Pega o login do usuário autenticado do contexto (ou 'sistema') */
export function getUser(c: Context): string {
  const u = c.get('user') as any;
  return u?.login || 'sistema';
}

/**
 * Pega o id_empresa (tenant) do contexto autenticado.
 * Fallback = 1 (empresa default "CorePro Confecção") para garantir
 * compatibilidade retroativa: qualquer chamada que não tenha contexto
 * válido cai na empresa default e não quebra o sistema.
 *
 * Uso padrão em rotas:
 *   const id_empresa = getEmpresa(c);
 *   // ... usar em WHERE e INSERT
 */
export function getEmpresa(c: Context): number {
  const v = c.get('id_empresa') as any;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Registra auditoria.
 * @param dbOrCtx — pode ser um D1Database (passa usuário como último arg)
 *                  OU um Context do Hono (usuário é extraído de c.get('user'))
 */
export async function audit(
  dbOrCtx: D1Database | Context,
  modulo: string,
  acao: string,
  chave: string,
  campo = '',
  vAnt: any = '',
  vNovo: any = '',
  usuario?: string,
) {
  let db: D1Database;
  let user = usuario || 'sistema';
  if ((dbOrCtx as any).env?.DB) {
    const c = dbOrCtx as Context;
    db = c.env.DB as D1Database;
    const u = c.get('user') as any;
    if (!usuario && u?.login) user = u.login;
  } else {
    db = dbOrCtx as D1Database;
  }
  try {
    await db
      .prepare(
        `INSERT INTO auditoria (usuario, modulo, acao, chave_registro, campo, valor_anterior, valor_novo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        user,
        modulo,
        acao,
        chave,
        campo,
        vAnt == null ? '' : String(vAnt),
        vNovo == null ? '' : String(vNovo),
      )
      .run();
  } catch (e) {
    console.error('audit fail', e);
  }
}

export function ok<T>(data: T, extra: Record<string, any> = {}) {
  return { ok: true, data, ...extra };
}
export function fail(message: string, code = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: code,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function toInt(v: any, def = 0): number {
  if (v === null || v === undefined || v === '') return def;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? def : n;
}

export function toNum(v: any, def = 0): number {
  if (v === null || v === undefined || v === '') return def;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? def : n;
}
