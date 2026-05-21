// ============================================================
// Módulo de Cores — CRUD + Import em massa + Exclusão em massa
// ============================================================
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit } from '../lib/db';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any } }>();

// ---------- helpers ----------

/** Normaliza HEX: aceita "#RRGGBB", "RRGGBB", "#RGB", "RGB". Retorna #RRGGBB uppercase, ou null se inválido. */
function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = String(input).trim().toUpperCase().replace(/^#/, '');
  if (/^[0-9A-F]{3}$/.test(s)) {
    // #RGB → #RRGGBB
    s = s.split('').map(ch => ch + ch).join('');
  }
  if (/^[0-9A-F]{6}$/.test(s)) return '#' + s;
  return null;
}

/** Normaliza nome: trim + colapsa espaços */
function normalizeNome(input: string | null | undefined): string {
  return String(input || '').trim().replace(/\s+/g, ' ');
}

// ---------- GET /cores — lista (filtros: ativo, busca) ----------

app.get('/cores', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const onlyAtivo = c.req.query('ativo'); // '1' | '0' | undefined
  const q = (c.req.query('q') || '').trim();
  const where: string[] = ['id_empresa = ?'];
  const args: any[] = [id_empresa];
  if (onlyAtivo === '1' || onlyAtivo === '0') {
    where.push('ativo = ?');
    args.push(Number(onlyAtivo));
  }
  if (q) {
    where.push('(nome LIKE ? OR hex LIKE ?)');
    args.push('%' + q + '%', '%' + q + '%');
  }
  const sql = `SELECT id, nome, hex, ativo, ordem, criado_em, atualizado_em
               FROM cores
               WHERE ${where.join(' AND ')}
               ORDER BY ordem ASC, nome COLLATE NOCASE ASC`;
  const r = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json(ok(r.results || []));
});

// ---------- POST /cores — cria nova cor ----------

app.post('/cores', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const nome = normalizeNome(body?.nome);
  const hex  = normalizeHex(body?.hex);
  const ativo = body?.ativo === false || body?.ativo === 0 ? 0 : 1;
  const ordem = Number.isFinite(body?.ordem) ? Number(body.ordem) : 0;

  if (!nome) return c.json(fail('Nome da cor é obrigatório.'), 400);
  if (!hex)  return c.json(fail('Código HEX inválido. Use #RRGGBB.'), 400);
  const id_empresa = (c.get('id_empresa') as number) || 1;

  // Duplicatas (case-insensitive via UNIQUE INDEX COLLATE NOCASE no schema)
  try {
    const res = await c.env.DB.prepare(
      `INSERT INTO cores (nome, hex, ativo, ordem, id_empresa) VALUES (?, ?, ?, ?, ?)`
    ).bind(nome, hex, ativo, ordem, id_empresa).run();
    const id = res.meta?.last_row_id;
    const u = c.get('user');
    await audit(c.env.DB, u?.login || 'system', 'cores', 'INSERT', String(id), { nome, hex });
    const row = await c.env.DB.prepare(
      `SELECT id, nome, hex, ativo, ordem, criado_em, atualizado_em FROM cores WHERE id = ? AND id_empresa = ?`
    ).bind(id, id_empresa).first();
    return c.json(ok(row));
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/UNIQUE/i.test(msg) && /nome/i.test(msg)) return c.json(fail('Já existe uma cor com este nome.'), 409);
    if (/UNIQUE/i.test(msg) && /hex/i.test(msg))  return c.json(fail('Já existe uma cor com este código HEX.'), 409);
    if (/UNIQUE/i.test(msg)) return c.json(fail('Nome ou HEX já cadastrado.'), 409);
    return c.json(fail('Erro ao salvar cor: ' + msg), 500);
  }
});

// ---------- PUT /cores/:id — edita ----------

app.put('/cores/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return c.json(fail('ID inválido.'), 400);
  const body = await c.req.json().catch(() => ({}));
  const nome = normalizeNome(body?.nome);
  const hex  = normalizeHex(body?.hex);
  const ativo = body?.ativo === false || body?.ativo === 0 ? 0 : 1;
  const ordem = Number.isFinite(body?.ordem) ? Number(body.ordem) : 0;
  if (!nome) return c.json(fail('Nome da cor é obrigatório.'), 400);
  if (!hex)  return c.json(fail('Código HEX inválido. Use #RRGGBB.'), 400);
  const id_empresa = (c.get('id_empresa') as number) || 1;

  try {
    const r = await c.env.DB.prepare(
      `UPDATE cores
         SET nome = ?, hex = ?, ativo = ?, ordem = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND id_empresa = ?`
    ).bind(nome, hex, ativo, ordem, id, id_empresa).run();
    if (!r.meta?.changes) return c.json(fail('Cor não encontrada.'), 404);
    const u = c.get('user');
    await audit(c.env.DB, u?.login || 'system', 'cores', 'UPDATE', String(id), { nome, hex, ativo });
    const row = await c.env.DB.prepare(
      `SELECT id, nome, hex, ativo, ordem, criado_em, atualizado_em FROM cores WHERE id = ? AND id_empresa = ?`
    ).bind(id, id_empresa).first();
    return c.json(ok(row));
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/UNIQUE/i.test(msg) && /nome/i.test(msg)) return c.json(fail('Já existe outra cor com este nome.'), 409);
    if (/UNIQUE/i.test(msg) && /hex/i.test(msg))  return c.json(fail('Já existe outra cor com este código HEX.'), 409);
    if (/UNIQUE/i.test(msg)) return c.json(fail('Nome ou HEX já cadastrado em outra cor.'), 409);
    return c.json(fail('Erro ao atualizar cor: ' + msg), 500);
  }
});

// ---------- DELETE /cores/:id — exclui individual ----------

app.delete('/cores/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return c.json(fail('ID inválido.'), 400);
  const id_empresa = (c.get('id_empresa') as number) || 1;
  try {
    const r = await c.env.DB.prepare(`DELETE FROM cores WHERE id = ? AND id_empresa = ?`).bind(id, id_empresa).run();
    if (!r.meta?.changes) return c.json(fail('Cor não encontrada.'), 404);
    const u = c.get('user');
    await audit(c.env.DB, u?.login || 'system', 'cores', 'DELETE', String(id), {});
    return c.json(ok({ id, deleted: true }));
  } catch (e: any) {
    return c.json(fail('Erro ao excluir cor: ' + (e?.message || e)), 500);
  }
});

// ---------- DELETE /cores — exclui TODAS (proteção dupla) ----------

app.delete('/cores', async (c) => {
  const confirm1 = c.req.query('confirm') === 'true';
  const confirm2 = c.req.query('confirm2') === 'EXCLUIR_TODAS';
  if (!confirm1 || !confirm2) {
    return c.json(fail('Operação requer dupla confirmação: ?confirm=true&confirm2=EXCLUIR_TODAS'), 400);
  }
  const id_empresa = (c.get('id_empresa') as number) || 1;
  try {
    const r = await c.env.DB.prepare(`DELETE FROM cores WHERE id_empresa = ?`).bind(id_empresa).run();
    const u = c.get('user');
    await audit(c.env.DB, u?.login || 'system', 'cores', 'DELETE_ALL', '*', { deleted: r.meta?.changes || 0 });
    return c.json(ok({ deleted: r.meta?.changes || 0 }));
  } catch (e: any) {
    return c.json(fail('Erro ao excluir todas as cores: ' + (e?.message || e)), 500);
  }
});

// ---------- POST /cores/import — importação em massa ----------

/**
 * Aceita JSON: { items: [{ nome, hex, ativo? }], mode?: 'skip' | 'overwrite' }
 *   - mode 'skip' (default): ignora duplicatas (mantém existentes)
 *   - mode 'overwrite': atualiza nome/hex existentes pelo nome (case-insensitive)
 *
 * Retorna: { inserted, updated, skipped, errors: [{ row, nome, hex, motivo }] }
 */
app.post('/cores/import', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const body = await c.req.json().catch(() => ({}));
  const items = Array.isArray(body?.items) ? body.items : [];
  const mode: 'skip' | 'overwrite' = body?.mode === 'overwrite' ? 'overwrite' : 'skip';

  let inserted = 0, updated = 0, skipped = 0;
  const errors: Array<{ row: number; nome: string; hex: string; motivo: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const nome = normalizeNome(it?.nome);
    const hex  = normalizeHex(it?.hex);
    if (!nome) { errors.push({ row: i + 1, nome: String(it?.nome || ''), hex: String(it?.hex || ''), motivo: 'Nome vazio' }); continue; }
    if (!hex)  { errors.push({ row: i + 1, nome, hex: String(it?.hex || ''), motivo: 'HEX inválido' }); continue; }
    const ativo = it?.ativo === false || it?.ativo === 0 ? 0 : 1;

    try {
      if (mode === 'overwrite') {
        // Procura por nome OU hex iguais (case-insensitive), dentro do tenant
        const existing = await c.env.DB.prepare(
          `SELECT id FROM cores WHERE (nome = ? COLLATE NOCASE OR hex = ? COLLATE NOCASE) AND id_empresa = ? LIMIT 1`
        ).bind(nome, hex, id_empresa).first<{ id: number }>();
        if (existing?.id) {
          await c.env.DB.prepare(
            `UPDATE cores SET nome = ?, hex = ?, ativo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND id_empresa = ?`
          ).bind(nome, hex, ativo, existing.id, id_empresa).run();
          updated++;
          continue;
        }
      }
      try {
        await c.env.DB.prepare(
          `INSERT INTO cores (nome, hex, ativo, id_empresa) VALUES (?, ?, ?, ?)`
        ).bind(nome, hex, ativo, id_empresa).run();
        inserted++;
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (/UNIQUE/i.test(msg)) {
          skipped++;
          if (mode === 'skip') {
            // não é erro, apenas ignorado
          } else {
            errors.push({ row: i + 1, nome, hex, motivo: 'Duplicado (nome ou hex)' });
          }
        } else {
          errors.push({ row: i + 1, nome, hex, motivo: msg });
        }
      }
    } catch (e: any) {
      errors.push({ row: i + 1, nome, hex, motivo: String(e?.message || e) });
    }
  }

  const u = c.get('user');
  await audit(c.env.DB, u?.login || 'system', 'cores', 'IMPORT', '*', { mode, inserted, updated, skipped, errorsCount: errors.length });

  return c.json(ok({ inserted, updated, skipped, errors }));
});

export default app;
