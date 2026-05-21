// ============================================================
// Módulo Empresa — dados da empresa (Owner-only para PUT)
// ============================================================
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit } from '../lib/db';
import { requireOwner } from '../lib/auth';
import { getUsageSummary } from '../lib/plan_limits';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any } }>();

/** GET /empresa — dados da empresa atual (qualquer usuário autenticado da empresa) */
app.get('/empresa', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const row = await c.env.DB.prepare(
    `SELECT id_empresa, nome, cnpj, telefone, email_contato, endereco, cidade, uf, cep,
            plano, status, trial_ate, dt_criacao
       FROM companies
      WHERE id_empresa = ?`
  ).bind(id_empresa).first<any>();
  if (!row) return fail('Empresa não encontrada.', 404);
  return c.json(ok(row));
});

/** GET /empresa/uso — uso vs limites do plano vigente (SPRINT 2)
 * Usado pelo frontend para mostrar banner de trial e barras de progresso.
 */
app.get('/empresa/uso', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  try {
    const empresa: any = await c.env.DB.prepare(
      `SELECT id_empresa, nome, plano, status, trial_ate, dt_criacao, dt_suspensao
         FROM companies WHERE id_empresa = ?`
    ).bind(id_empresa).first();
    if (!empresa) return fail('Empresa não encontrada.', 404);

    const usage = await getUsageSummary(c.env.DB, id_empresa);

    // Calcula dias restantes de trial
    let trial_dias_restantes: number | null = null;
    let trial_expirado = false;
    if (empresa.trial_ate) {
      const ate = new Date(empresa.trial_ate + 'T23:59:59');
      const diff = Math.ceil((ate.getTime() - Date.now()) / 86400000);
      trial_dias_restantes = diff;
      trial_expirado = diff < 0;
    }

    // Pega subscription ativa para informar próxima cobrança
    const sub: any = await c.env.DB.prepare(
      `SELECT id_sub, status, dt_proxima_cobranca, preco_aplicado, ciclo
         FROM subscriptions WHERE id_empresa = ?
         ORDER BY (CASE status WHEN 'ativa' THEN 1 WHEN 'trial' THEN 2 WHEN 'pendente' THEN 3 ELSE 9 END), dt_criacao DESC
         LIMIT 1`
    ).bind(id_empresa).first();

    return c.json(ok({
      empresa: {
        id_empresa: empresa.id_empresa,
        nome: empresa.nome,
        status: empresa.status,
        trial_ate: empresa.trial_ate,
        trial_dias_restantes,
        trial_expirado,
        dt_suspensao: empresa.dt_suspensao,
      },
      subscription: sub,
      ...usage,
    }));
  } catch (e: any) {
    return fail('Erro ao buscar uso: ' + (e?.message || e), 500);
  }
});

/** PUT /empresa — atualiza dados (Owner-only) */
app.put('/empresa', requireOwner(), async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json().catch(() => ({}));

  const nome = (b?.nome ?? '').toString().trim();
  if (!nome) return fail('Nome da empresa é obrigatório.', 400);

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
    if (!r.meta?.changes) return fail('Empresa não encontrada.', 404);

    await audit(c, 'EMPRESA', 'UPDATE', String(id_empresa), 'dados', '',
      JSON.stringify({ nome, cnpj, telefone, email_contato, endereco, cidade, uf, cep }));

    const row = await c.env.DB.prepare(
      `SELECT id_empresa, nome, cnpj, telefone, email_contato, endereco, cidade, uf, cep,
              plano, status, dt_criacao
         FROM companies
        WHERE id_empresa = ?`
    ).bind(id_empresa).first<any>();
    return c.json(ok(row));
  } catch (e: any) {
    return fail('Erro ao salvar empresa: ' + (e?.message || e), 500);
  }
});

export default app;
