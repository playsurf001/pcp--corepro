// ============================================================
// Módulo de Cores — CRUD + Import em massa + Exclusão em massa
// Versão 2: vinculos, toggle, duplicate, delete-with-validation,
// observacoes, contagens, GET /:id detalhe.
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

/** Conta vínculos da cor em todas as 4 tabelas que referenciam id_cor. */
async function contarVinculosCor(db: D1Database, id_empresa: number, id_cor: number) {
  const [p, v, ri, rti] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as n FROM terc_precos          WHERE id_cor = ? AND id_empresa = ?`).bind(id_cor, id_empresa).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) as n FROM terc_produto_variacoes WHERE id_cor = ? AND id_empresa = ?`).bind(id_cor, id_empresa).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) as n FROM terc_remessa_itens   WHERE id_cor = ? AND id_empresa = ?`).bind(id_cor, id_empresa).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) as n FROM terc_retorno_itens   WHERE id_cor = ? AND id_empresa = ?`).bind(id_cor, id_empresa).first<{ n: number }>(),
  ]);
  const precos = Number(p?.n || 0);
  const variacoes = Number(v?.n || 0);
  const remessa_itens = Number(ri?.n || 0);
  const retorno_itens = Number(rti?.n || 0);
  return { precos, variacoes, remessa_itens, retorno_itens, total: precos + variacoes + remessa_itens + retorno_itens };
}

// ---------- GET /cores — lista (filtros: ativo, busca) + contagens de vínculos ----------

app.get('/cores', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const onlyAtivo = c.req.query('ativo'); // '1' | '0' | undefined
  const q = (c.req.query('q') || '').trim();
  const where: string[] = ['c.id_empresa = ?'];
  const args: any[] = [id_empresa];
  if (onlyAtivo === '1' || onlyAtivo === '0') {
    where.push('c.ativo = ?');
    args.push(Number(onlyAtivo));
  }
  if (q) {
    where.push('(c.nome LIKE ? OR c.hex LIKE ?)');
    args.push('%' + q + '%', '%' + q + '%');
  }
  // Subqueries para contagem em uma única query
  const sql = `
    SELECT
      c.id, c.nome, c.hex, c.ativo, c.ordem, c.observacoes, c.criado_em, c.atualizado_em,
      (SELECT COUNT(*) FROM terc_precos          WHERE id_cor = c.id AND id_empresa = c.id_empresa) AS qtd_precos,
      (SELECT COUNT(*) FROM terc_produto_variacoes WHERE id_cor = c.id AND id_empresa = c.id_empresa) AS qtd_variacoes,
      (SELECT COUNT(*) FROM terc_remessa_itens   WHERE id_cor = c.id AND id_empresa = c.id_empresa) AS qtd_remessas,
      (SELECT COUNT(*) FROM terc_retorno_itens   WHERE id_cor = c.id AND id_empresa = c.id_empresa) AS qtd_retornos
    FROM cores c
    WHERE ${where.join(' AND ')}
    ORDER BY c.ordem ASC, c.nome COLLATE NOCASE ASC`;
  const r = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json(ok(r.results || []));
});

// ---------- GET /cores/:id — detalhe com vinculos ----------

app.get('/cores/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return c.json(fail('ID inválido.'), 400);
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const row = await c.env.DB.prepare(
    `SELECT id, nome, hex, ativo, ordem, observacoes, criado_em, atualizado_em FROM cores WHERE id = ? AND id_empresa = ?`
  ).bind(id, id_empresa).first();
  if (!row) return c.json(fail('Cor não encontrada.'), 404);
  const vinculos = await contarVinculosCor(c.env.DB, id_empresa, id);
  return c.json(ok({ ...row, vinculos }));
});

// ---------- POST /cores — cria nova cor ----------

app.post('/cores', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const nome = normalizeNome(body?.nome);
  const hex  = normalizeHex(body?.hex);
  const ativo = body?.ativo === false || body?.ativo === 0 ? 0 : 1;
  const ordem = Number.isFinite(body?.ordem) ? Number(body.ordem) : 0;
  const observacoes = body?.observacoes ? String(body.observacoes).slice(0, 500) : null;

  if (!nome) return c.json(fail('Nome da cor é obrigatório.'), 400);
  if (!hex)  return c.json(fail('Código HEX inválido. Use #RRGGBB.'), 400);
  const id_empresa = (c.get('id_empresa') as number) || 1;

  // Duplicatas (case-insensitive via UNIQUE INDEX COLLATE NOCASE no schema)
  try {
    const res = await c.env.DB.prepare(
      `INSERT INTO cores (nome, hex, ativo, ordem, observacoes, id_empresa) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(nome, hex, ativo, ordem, observacoes, id_empresa).run();
    const id = res.meta?.last_row_id;
    const u = c.get('user');
    await audit(c.env.DB, u?.login || 'system', 'cores', 'INSERT', String(id), { nome, hex });
    const row = await c.env.DB.prepare(
      `SELECT id, nome, hex, ativo, ordem, observacoes, criado_em, atualizado_em FROM cores WHERE id = ? AND id_empresa = ?`
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
  const observacoes = body?.observacoes ? String(body.observacoes).slice(0, 500) : null;
  if (!nome) return c.json(fail('Nome da cor é obrigatório.'), 400);
  if (!hex)  return c.json(fail('Código HEX inválido. Use #RRGGBB.'), 400);
  const id_empresa = (c.get('id_empresa') as number) || 1;

  try {
    const r = await c.env.DB.prepare(
      `UPDATE cores
         SET nome = ?, hex = ?, ativo = ?, ordem = ?, observacoes = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND id_empresa = ?`
    ).bind(nome, hex, ativo, ordem, observacoes, id, id_empresa).run();
    if (!r.meta?.changes) return c.json(fail('Cor não encontrada.'), 404);
    const u = c.get('user');
    await audit(c.env.DB, u?.login || 'system', 'cores', 'UPDATE', String(id), { nome, hex, ativo });
    const row = await c.env.DB.prepare(
      `SELECT id, nome, hex, ativo, ordem, observacoes, criado_em, atualizado_em FROM cores WHERE id = ? AND id_empresa = ?`
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

// ---------- PATCH /cores/:id/toggle — alterna status ativo ----------

app.patch('/cores/:id/toggle', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return c.json(fail('ID inválido.'), 400);
  const id_empresa = (c.get('id_empresa') as number) || 1;
  try {
    const r = await c.env.DB.prepare(
      `UPDATE cores SET ativo = CASE WHEN ativo = 1 THEN 0 ELSE 1 END,
                        atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND id_empresa = ?`
    ).bind(id, id_empresa).run();
    if (!r.meta?.changes) return c.json(fail('Cor não encontrada.'), 404);
    const u = c.get('user');
    await audit(c.env.DB, u?.login || 'system', 'cores', 'TOGGLE', String(id), {});
    const row = await c.env.DB.prepare(
      `SELECT id, nome, hex, ativo, ordem, observacoes FROM cores WHERE id = ? AND id_empresa = ?`
    ).bind(id, id_empresa).first();
    return c.json(ok(row));
  } catch (e: any) {
    return c.json(fail('Erro ao alterar status: ' + (e?.message || e)), 500);
  }
});

// ---------- POST /cores/:id/duplicate — duplica cor ----------

app.post('/cores/:id/duplicate', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return c.json(fail('ID inválido.'), 400);
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const orig = await c.env.DB.prepare(
    `SELECT nome, hex, ativo, ordem, observacoes FROM cores WHERE id = ? AND id_empresa = ?`
  ).bind(id, id_empresa).first<any>();
  if (!orig) return c.json(fail('Cor não encontrada.'), 404);

  // Gera nome único: "Nome (cópia)", "Nome (cópia 2)" ... até 50
  let novoNome = orig.nome + ' (cópia)';
  for (let i = 1; i <= 50; i++) {
    const exists = await c.env.DB.prepare(
      `SELECT id FROM cores WHERE LOWER(nome) = LOWER(?) AND id_empresa = ? LIMIT 1`
    ).bind(novoNome, id_empresa).first();
    if (!exists) break;
    novoNome = orig.nome + ' (cópia ' + (i + 1) + ')';
  }
  // Hex precisa ser único também — se duplicado, faz leve variação
  let novoHex = orig.hex;
  const hexExists = await c.env.DB.prepare(
    `SELECT id FROM cores WHERE LOWER(hex) = LOWER(?) AND id_empresa = ? LIMIT 1`
  ).bind(novoHex, id_empresa).first();
  if (hexExists) {
    // Faz uma pequena variação no último dígito para garantir unicidade
    const h = String(novoHex).replace('#', '');
    if (/^[0-9A-Fa-f]{6}$/.test(h)) {
      for (let i = 0; i < 16; i++) {
        const lastDigit = i.toString(16).toUpperCase();
        const candidato = '#' + h.slice(0, 5) + lastDigit;
        if (candidato.toUpperCase() === novoHex.toUpperCase()) continue;
        const e2 = await c.env.DB.prepare(
          `SELECT id FROM cores WHERE LOWER(hex) = LOWER(?) AND id_empresa = ? LIMIT 1`
        ).bind(candidato, id_empresa).first();
        if (!e2) { novoHex = candidato; break; }
      }
    }
  }

  try {
    const res = await c.env.DB.prepare(
      `INSERT INTO cores (nome, hex, ativo, ordem, observacoes, id_empresa)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(novoNome, novoHex, orig.ativo, orig.ordem, orig.observacoes, id_empresa).run();
    const newId = res.meta?.last_row_id;
    const u = c.get('user');
    await audit(c.env.DB, u?.login || 'system', 'cores', 'DUPLICATE', String(newId), { from: id, nome: novoNome, hex: novoHex });
    const row = await c.env.DB.prepare(
      `SELECT id, nome, hex, ativo, ordem, observacoes, criado_em, atualizado_em FROM cores WHERE id = ? AND id_empresa = ?`
    ).bind(newId, id_empresa).first();
    return c.json(ok(row));
  } catch (e: any) {
    return c.json(fail('Erro ao duplicar cor: ' + (e?.message || e)), 500);
  }
});

// ---------- DELETE /cores/:id — exclui individual (com validação de vínculos) ----------

app.delete('/cores/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return c.json(fail('ID inválido.'), 400);
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const force = c.req.query('force') === '1';

  // Verifica vínculos
  const vinculos = await contarVinculosCor(c.env.DB, id_empresa, id);

  if (vinculos.total > 0 && !force) {
    return c.json({
      ok: false,
      error: 'Cor possui ' + vinculos.total + ' vínculo(s) no sistema. Use ?force=1 para desativar em vez de excluir.',
      code: 'HAS_LINKS',
      data: { vinculos },
    }, 409);
  }

  try {
    if (vinculos.total > 0 && force) {
      // Force = desativa em vez de excluir (preserva histórico)
      const r = await c.env.DB.prepare(
        `UPDATE cores SET ativo = 0, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND id_empresa = ?`
      ).bind(id, id_empresa).run();
      if (!r.meta?.changes) return c.json(fail('Cor não encontrada.'), 404);
      const u = c.get('user');
      await audit(c.env.DB, u?.login || 'system', 'cores', 'FORCE_DISABLE', String(id), { vinculos });
      return c.json(ok({ id, disabled: true, vinculos }));
    }
    // Sem vínculos: DELETE real
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
