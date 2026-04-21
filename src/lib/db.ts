// Camada de acesso ao D1 + helpers

export type Bindings = {
  DB: D1Database;
};

export async function audit(
  db: D1Database,
  modulo: string,
  acao: string,
  chave: string,
  campo = '',
  vAnt: any = '',
  vNovo: any = '',
  usuario = 'sistema',
) {
  try {
    await db
      .prepare(
        `INSERT INTO auditoria (usuario, modulo, acao, chave_registro, campo, valor_anterior, valor_novo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        usuario,
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
