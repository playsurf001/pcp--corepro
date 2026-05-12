// Módulo de Configurações — Parâmetros da empresa (enxuto, apenas terceirização)
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit } from '../lib/db';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any } }>();

/* GET /parametros — usado pela impressão de romaneio (loadEmpresa) */
app.get('/parametros', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT chave, valor FROM parametros ORDER BY chave`
  ).all();
  return c.json(ok(r.results || []));
});

/* PUT /parametros/:chave — atualiza um parâmetro */
app.put('/parametros/:chave', async (c) => {
  const chave = c.req.param('chave');
  const body = await c.req.json().catch(() => ({}));
  const valor = body?.valor ?? '';
  try {
    await c.env.DB.prepare(
      `INSERT INTO parametros (chave, valor) VALUES (?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
    ).bind(chave, String(valor)).run();
    const u = c.get('user');
    await audit(c.env.DB, u?.login || 'system', 'parametros', 'UPDATE', chave, { valor });
    return c.json(ok({ chave, valor }));
  } catch (e: any) {
    return c.json(fail('Erro ao salvar parâmetro: ' + (e?.message || e)), 500);
  }
});

export default app;
