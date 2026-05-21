// ============================================================
// Módulo Empresa — dados da empresa (Owner-only para PUT)
// ============================================================
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit } from '../lib/db';
import { requireOwner } from '../lib/auth';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any } }>();

/** GET /empresa — dados da empresa atual (qualquer usuário autenticado da empresa) */
app.get('/empresa', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const row = await c.env.DB.prepare(
    `SELECT id_empresa, nome, cnpj, telefone, email_contato, endereco, cidade, uf, cep,
            plano, status, dt_criacao
       FROM companies
      WHERE id_empresa = ?`
  ).bind(id_empresa).first<any>();
  if (!row) return c.json(fail('Empresa não encontrada.'), 404);
  return c.json(ok(row));
});

/** PUT /empresa — atualiza dados (Owner-only) */
app.put('/empresa', requireOwner(), async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json().catch(() => ({}));

  const nome = (b?.nome ?? '').toString().trim();
  if (!nome) return c.json(fail('Nome da empresa é obrigatório.'), 400);

  const cnpj         = b?.cnpj          != null ? String(b.cnpj).trim()          : null;
  const telefone     = b?.telefone      != null ? String(b.telefone).trim()      : null;
  const email_contato= b?.email_contato != null ? String(b.email_contato).trim() : null;
  const endereco     = b?.endereco      != null ? String(b.endereco).trim()      : null;
  const cidade       = b?.cidade        != null ? String(b.cidade).trim()        : null;
  const uf           = b?.uf            != null ? String(b.uf).trim().toUpperCase().slice(0, 2) : null;
  const cep          = b?.cep           != null ? String(b.cep).trim()           : null;

  try {
    const r = await c.env.DB.prepare(
      `UPDATE companies
          SET nome = ?, cnpj = ?, telefone = ?, email_contato = ?,
              endereco = ?, cidade = ?, uf = ?, cep = ?,
              dt_atualizacao = CURRENT_TIMESTAMP
        WHERE id_empresa = ?`
    ).bind(nome, cnpj, telefone, email_contato, endereco, cidade, uf, cep, id_empresa).run();
    if (!r.meta?.changes) return c.json(fail('Empresa não encontrada.'), 404);

    const u = c.get('user');
    await audit(c.env.DB, u?.login || 'system', 'empresa', 'UPDATE', String(id_empresa), {
      nome, cnpj, telefone, email_contato, endereco, cidade, uf, cep,
    });

    const row = await c.env.DB.prepare(
      `SELECT id_empresa, nome, cnpj, telefone, email_contato, endereco, cidade, uf, cep,
              plano, status, dt_criacao
         FROM companies
        WHERE id_empresa = ?`
    ).bind(id_empresa).first<any>();
    return c.json(ok(row));
  } catch (e: any) {
    return c.json(fail('Erro ao salvar empresa: ' + (e?.message || e)), 500);
  }
});

export default app;
