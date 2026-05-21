// Módulo de Configurações — Parâmetros da empresa (multi-tenant, enxuto)
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, getEmpresa } from '../lib/db';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any } }>();

/* GET /parametros — lista parâmetros da empresa do usuário autenticado.
   Usado pela impressão de romaneio (loadEmpresa) e tela de Configurações. */
app.get('/parametros', async (c) => {
  const id_empresa = getEmpresa(c);
  const r = await c.env.DB.prepare(
    `SELECT chave, valor FROM parametros WHERE id_empresa = ? ORDER BY chave`
  ).bind(id_empresa).all();
  return c.json(ok(r.results || []));
});

/* PUT /parametros/:chave — atualiza/cria parâmetro da empresa.
   Multi-tenant: a PK é (chave, id_empresa) — UPSERT correto. */
app.put('/parametros/:chave', async (c) => {
  const id_empresa = getEmpresa(c);
  const chave = c.req.param('chave');
  const body = await c.req.json().catch(() => ({}));
  const valor = body?.valor ?? '';
  try {
    await c.env.DB.prepare(
      `INSERT INTO parametros (chave, id_empresa, valor) VALUES (?, ?, ?)
         ON CONFLICT(chave, id_empresa) DO UPDATE SET valor = excluded.valor`
    ).bind(chave, id_empresa, String(valor)).run();
    const u = c.get('user');
    await audit(c.env.DB, u?.login || 'system', 'parametros', 'UPDATE', chave, '', String(valor));
    return c.json(ok({ chave, valor }));
  } catch (e: any) {
    return fail('Erro ao salvar parâmetro: ' + (e?.message || e), 500);
  }
});

export default app;
