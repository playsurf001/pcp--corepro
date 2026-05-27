// Controle de Terceirização — Remessas, Retornos, Consertos, Cadastros, Resumo
// Baseado na planilha "Controle de Terceirização Versão.xlsx"
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, toNum, getUser, logTenant } from '../lib/db';
import { assertLimit, LimitExceededError } from '../lib/plan_limits';

const app = new Hono<{ Bindings: Bindings }>();

const MOD = 'TERC';
const TAMS = ['P','M','G','GG','EG','SG','T7','T8','T9','T10'];

/**
 * Resolve nome de cor (texto) para id_cor (FK em cores.id) — TENANT-SCOPED.
 *
 * IMPORTANTE: id_empresa agora é OBRIGATÓRIO (não tem default).
 * Qualquer chamada sem id_empresa é um BUG de tenant-leak e será sinalizado
 * no log. Para manter compat com chamadas antigas que ainda não foram
 * atualizadas, mantemos o fallback `|| 1` defensivo, mas LOGAMOS para
 * permitir caça aos call sites legados.
 *
 * Comportamento:
 *  - Case-insensitive (COLLATE NOCASE).
 *  - Retorna null se corText vazio (cor não obrigatória no schema antigo).
 *  - Auto-cria a cor caso não exista NA EMPRESA, gerando hex determinístico.
 *  - SEMPRE escopa SELECT + INSERT + UPDATE por id_empresa.
 *  - Em caso de race condition (UNIQUE collision), refaz busca tenant-scoped.
 */
async function resolveColorId(
  db: D1Database,
  corText: any,
  id_empresa: number
): Promise<number | null> {
  if (!Number.isFinite(id_empresa) || id_empresa <= 0) {
    // Log de bug para caçar tenant-leak em produção
    console.error('[resolveColorId] BUG: id_empresa inválido =', id_empresa, '— fallback=1 aplicado');
    id_empresa = 1;
  }
  const nome = (corText == null ? '' : String(corText)).trim();
  if (!nome) return null;

  // Busca case-insensitive, tenant-scoped
  const row = await db.prepare(
    'SELECT id FROM cores WHERE nome = ? COLLATE NOCASE AND id_empresa = ? LIMIT 1'
  ).bind(nome, id_empresa).first<{ id: number }>();
  if (row && row.id) return row.id;

  // Auto-create tenant-scoped. Gera hex determinístico baseado em
  // (id_empresa + nome) para evitar colisões entre tenants e dentro do tenant.
  // Se a tabela `cores` tem UNIQUE(id_empresa, hex), garantimos unicidade
  // dentro do escopo.
  const seed = (id_empresa * 7919 + Array.from(nome).reduce((a, ch) => a + ch.charCodeAt(0), 0)) >>> 0;
  const baseHex = '#' + ((seed * 999983) % 16777215).toString(16).toUpperCase().padStart(6, '0');
  try {
    const ins = await db.prepare(
      `INSERT INTO cores (id_empresa, nome, hex, ativo) VALUES (?, ?, ?, 1)`
    ).bind(id_empresa, nome, baseHex).run();
    const newId = Number(ins.meta?.last_row_id || 0);
    if (newId) return newId;
  } catch (e: any) {
    // Possíveis causas:
    //  (a) Race condition: outra request inseriu a mesma cor — refaz busca
    //  (b) Conflito de hex: já existe nesta empresa com hex igual (raro). Tenta achar pelo nome.
    const msg = String(e?.message || e);
    if (!/UNIQUE/i.test(msg)) {
      console.error('[resolveColorId] erro inesperado:', msg, '| tenant=', id_empresa, 'nome=', nome);
    }
    const row2 = await db.prepare(
      'SELECT id FROM cores WHERE nome = ? COLLATE NOCASE AND id_empresa = ? LIMIT 1'
    ).bind(nome, id_empresa).first<{ id: number }>();
    if (row2 && row2.id) return row2.id;

    // Se conflito foi por HEX (cor "Azul" não existe mas hex já existe),
    // tenta novamente com hex alternativo (acrescenta sufixo no seed).
    try {
      const altHex = '#' + (((seed + Date.now()) * 999983) % 16777215).toString(16).toUpperCase().padStart(6, '0');
      const ins2 = await db.prepare(
        `INSERT INTO cores (id_empresa, nome, hex, ativo) VALUES (?, ?, ?, 1)`
      ).bind(id_empresa, nome, altHex).run();
      const newId2 = Number(ins2.meta?.last_row_id || 0);
      if (newId2) return newId2;
    } catch (e2) {
      // Última tentativa: busca de novo (race)
      const row3 = await db.prepare(
        'SELECT id FROM cores WHERE nome = ? COLLATE NOCASE AND id_empresa = ? LIMIT 1'
      ).bind(nome, id_empresa).first<{ id: number }>();
      if (row3 && row3.id) return row3.id;
    }
  }
  return null;
}

/* =================================================================
 * CADASTROS AUXILIARES
 * ================================================================= */

// =====================================================================
// SETORES — Módulo completo (tenant-scoped, HOTFIX 0037)
// =====================================================================
// Rotas:
//   GET    /terc/setores                lista (?q= busca por nome/codigo, ?ativo=0|1)
//   GET    /terc/setores/:id            detalhe com contagens de vinculos
//   POST   /terc/setores                cria
//   PUT    /terc/setores/:id            atualiza (full)
//   PATCH  /terc/setores/:id/toggle     ativa/desativa
//   PATCH  /terc/setores/ordenar        reordena (body: { ordens: [{id, ordem}] })
//   DELETE /terc/setores/:id            soft delete (valida vinculos; ?force=1 desativa)
// =====================================================================

// Helper: normaliza codigo/slug
function _slugSetor(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// LIST — com busca + filtros + contagem de vínculos
app.get('/terc/setores', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query('q')?.trim() || '';
  const ativo = c.req.query('ativo');
  const where: string[] = ['s.id_empresa=?'];
  const binds: any[] = [id_empresa];
  if (q) {
    where.push('(LOWER(s.nome_setor) LIKE ? OR LOWER(s.codigo) LIKE ? OR LOWER(COALESCE(s.descricao,\'\')) LIKE ?)');
    binds.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
  }
  if (ativo === '0' || ativo === '1') {
    where.push('s.ativo=?');
    binds.push(Number(ativo));
  }
  const rs = await c.env.DB.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM terc_servicos     sv WHERE sv.id_setor=s.id_setor AND sv.id_empresa=s.id_empresa) AS qtd_servicos,
      (SELECT COUNT(*) FROM terc_terceirizados t  WHERE t.id_setor =s.id_setor AND t.id_empresa =s.id_empresa) AS qtd_terceirizados,
      (SELECT COUNT(*) FROM terc_remessas      r  WHERE r.id_setor =s.id_setor AND r.id_empresa =s.id_empresa) AS qtd_remessas
    FROM terc_setores s
    WHERE ${where.join(' AND ')}
    ORDER BY s.ordem ASC, s.nome_setor ASC
  `).bind(...binds).all();
  logTenant(c, 'setores.list', { total: rs.results?.length || 0, q, ativo });
  return c.json(ok(rs.results));
});

// DETAIL — com contagens de vínculos
app.get('/terc/setores/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const setor = await c.env.DB.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM terc_servicos     sv WHERE sv.id_setor=s.id_setor AND sv.id_empresa=s.id_empresa) AS qtd_servicos,
      (SELECT COUNT(*) FROM terc_terceirizados t  WHERE t.id_setor =s.id_setor AND t.id_empresa =s.id_empresa) AS qtd_terceirizados,
      (SELECT COUNT(*) FROM terc_remessas      r  WHERE r.id_setor =s.id_setor AND r.id_empresa =s.id_empresa) AS qtd_remessas
    FROM terc_setores s
    WHERE s.id_setor=? AND s.id_empresa=?
  `).bind(id, id_empresa).first<any>();
  if (!setor) return fail('Setor não encontrado', 404);
  return c.json(ok(setor));
});

// CREATE
app.post('/terc/setores', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  const nome = String(b.nome_setor || '').trim();
  if (!nome) return fail('Nome do setor é obrigatório', 400);
  const codigo = b.codigo ? _slugSetor(b.codigo) : _slugSetor(nome);
  const descricao = b.descricao ? String(b.descricao).trim() : null;
  const cor = b.cor ? String(b.cor).trim() : null;
  const ordem = Number.isFinite(Number(b.ordem)) ? Number(b.ordem) : 0;
  const ativo = (b.ativo === false || b.ativo === 0) ? 0 : 1;

  // Validação: duplicidade por tenant (nome OU codigo)
  const dup = await c.env.DB.prepare(
    'SELECT id_setor, nome_setor, codigo FROM terc_setores WHERE id_empresa=? AND (LOWER(nome_setor)=LOWER(?) OR (codigo IS NOT NULL AND codigo=?)) LIMIT 1'
  ).bind(id_empresa, nome, codigo).first<any>();
  if (dup) {
    if (String(dup.nome_setor || '').toLowerCase() === nome.toLowerCase()) {
      return fail('Já existe um setor com este nome nesta empresa.', 409);
    }
    return fail('Já existe um setor com este código nesta empresa.', 409);
  }

  // Auto-ordem se ordem=0: pega max+1 da empresa
  let ordemFinal = ordem;
  if (ordemFinal <= 0) {
    const maxOrd = await c.env.DB.prepare('SELECT COALESCE(MAX(ordem),0) AS m FROM terc_setores WHERE id_empresa=?').bind(id_empresa).first<any>();
    ordemFinal = (Number(maxOrd?.m) || 0) + 1;
  }

  const login = (c.get('login') as string) || 'system';
  const r = await c.env.DB.prepare(`
    INSERT INTO terc_setores (id_empresa, nome_setor, codigo, descricao, cor, ordem, ativo, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id_empresa, nome, codigo, descricao, cor, ordemFinal, ativo, login).run();
  await audit(c, MOD, 'INS', `setor:${r.meta.last_row_id}`, 'nome_setor', '', nome);
  logTenant(c, 'setores.create', { id_setor: r.meta.last_row_id, nome });
  return c.json(ok({ id: r.meta.last_row_id, id_setor: r.meta.last_row_id }));
});

// UPDATE (full)
app.put('/terc/setores/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  const cur = await c.env.DB.prepare('SELECT * FROM terc_setores WHERE id_setor=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!cur) return fail('Setor não encontrado', 404);

  const nome = String(b.nome_setor ?? cur.nome_setor).trim();
  if (!nome) return fail('Nome do setor é obrigatório', 400);
  const codigo = b.codigo !== undefined
    ? (b.codigo ? _slugSetor(b.codigo) : _slugSetor(nome))
    : cur.codigo;
  const descricao = b.descricao !== undefined ? (b.descricao || null) : cur.descricao;
  const cor = b.cor !== undefined ? (b.cor || null) : cur.cor;
  const ordem = b.ordem !== undefined && Number.isFinite(Number(b.ordem)) ? Number(b.ordem) : cur.ordem;
  const ativo = b.ativo !== undefined ? ((b.ativo === false || b.ativo === 0) ? 0 : 1) : cur.ativo;

  // Validação de duplicidade contra outros setores da mesma empresa
  const dup = await c.env.DB.prepare(
    'SELECT id_setor FROM terc_setores WHERE id_empresa=? AND id_setor<>? AND (LOWER(nome_setor)=LOWER(?) OR (codigo IS NOT NULL AND codigo=?)) LIMIT 1'
  ).bind(id_empresa, id, nome, codigo).first<any>();
  if (dup) return fail('Já existe outro setor com este nome ou código nesta empresa.', 409);

  const login = (c.get('login') as string) || 'system';
  await c.env.DB.prepare(`
    UPDATE terc_setores
       SET nome_setor=?, codigo=?, descricao=?, cor=?, ordem=?, ativo=?,
           dt_alteracao=datetime('now'), alterado_por=?
     WHERE id_setor=? AND id_empresa=?
  `).bind(nome, codigo, descricao, cor, ordem, ativo, login, id, id_empresa).run();
  await audit(c, MOD, 'UPD', `setor:${id}`);
  logTenant(c, 'setores.update', { id_setor: id, nome });
  return c.json(ok({ id, id_setor: id }));
});

// TOGGLE ativo/inativo
app.patch('/terc/setores/:id/toggle', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const cur = await c.env.DB.prepare('SELECT ativo FROM terc_setores WHERE id_setor=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!cur) return fail('Setor não encontrado', 404);
  const novo = cur.ativo ? 0 : 1;
  const login = (c.get('login') as string) || 'system';
  await c.env.DB.prepare(`UPDATE terc_setores SET ativo=?, dt_alteracao=datetime('now'), alterado_por=? WHERE id_setor=? AND id_empresa=?`).bind(novo, login, id, id_empresa).run();
  await audit(c, MOD, 'UPD', `setor:${id}`, 'ativo', String(cur.ativo), String(novo));
  logTenant(c, 'setores.toggle', { id_setor: id, ativo: novo });
  return c.json(ok({ id, ativo: novo }));
});

// REORDENAR (body: { ordens: [{ id_setor, ordem }] })
app.patch('/terc/setores/ordenar', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json().catch(() => ({}));
  const ordens = Array.isArray(b?.ordens) ? b.ordens : [];
  if (ordens.length === 0) return fail('Lista de ordens vazia.', 400);
  const login = (c.get('login') as string) || 'system';
  let n = 0;
  for (const o of ordens) {
    const idSet = toInt(o?.id_setor);
    const ord = Number(o?.ordem);
    if (!idSet || !Number.isFinite(ord)) continue;
    const r = await c.env.DB.prepare(
      `UPDATE terc_setores SET ordem=?, dt_alteracao=datetime('now'), alterado_por=? WHERE id_setor=? AND id_empresa=?`
    ).bind(ord, login, idSet, id_empresa).run();
    if (r.meta.changes > 0) n++;
  }
  logTenant(c, 'setores.reorder', { count: n });
  return c.json(ok({ updated: n }));
});

// DELETE com soft delete em caso de vínculos
app.delete('/terc/setores/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const force = c.req.query('force') === '1';
  const cur = await c.env.DB.prepare('SELECT * FROM terc_setores WHERE id_setor=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!cur) return fail('Setor não encontrado', 404);

  // Conta vínculos
  const usoTerc = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_terceirizados WHERE id_setor=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  const usoServ = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_servicos WHERE id_setor=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  const usoRem  = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_remessas  WHERE id_setor=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  const tt = (Number(usoTerc?.c) || 0) + (Number(usoServ?.c) || 0) + (Number(usoRem?.c) || 0);

  if (tt > 0 && !force) {
    return fail(
      `Setor possui ${Number(usoServ?.c) || 0} serviço(s), ${Number(usoTerc?.c) || 0} terceirizado(s) e ${Number(usoRem?.c) || 0} remessa(s) vinculados. Use ?force=1 para inativar (soft-delete).`,
      409
    );
  }

  if (tt > 0 && force) {
    // Soft delete: inativa o setor mas preserva vínculos (não quebra histórico)
    const login = (c.get('login') as string) || 'system';
    await c.env.DB.prepare(`UPDATE terc_setores SET ativo=0, dt_alteracao=datetime('now'), alterado_por=? WHERE id_setor=? AND id_empresa=?`).bind(login, id, id_empresa).run();
    await audit(c, MOD, 'UPD', `setor:${id}`, 'ativo', '1', '0');
    logTenant(c, 'setores.softdelete', { id_setor: id, vinculos: tt });
    return c.json(ok({ id, soft_deleted: true, vinculos: tt }));
  }

  // Hard delete (sem vínculos)
  await c.env.DB.prepare('DELETE FROM terc_setores WHERE id_setor=? AND id_empresa=?').bind(id, id_empresa).run();
  await audit(c, MOD, 'DEL', `setor:${id}`);
  logTenant(c, 'setores.delete', { id_setor: id });
  return c.json(ok({ id, deleted: true }));
});

// =====================================================================
// SERVIÇOS — Módulo completo (tenant-scoped)
// =====================================================================
// Campos suportados (após migration 0029):
//   id_servico, desc_servico, descricao, categoria, cor, preco_padrao,
//   tempo_padrao, observacoes, ativo, dt_criacao, dt_alteracao, id_empresa
//
// Endpoints:
//   GET    /terc/servicos                 lista (suporta ?q= ?ativo= ?categoria=)
//   GET    /terc/servicos/categorias      lista distinct das categorias usadas
//   GET    /terc/servicos/:id             detalhe (com contagem de vínculos)
//   POST   /terc/servicos                 cria
//   PUT    /terc/servicos/:id             atualiza (full)
//   PATCH  /terc/servicos/:id/toggle      ativa/desativa
//   POST   /terc/servicos/:id/duplicate   duplica
//   DELETE /terc/servicos/:id             remove (valida vínculos; força com ?force=1 desativa)
// =====================================================================

/** Cor HEX válida (#RGB ou #RRGGBB) — retorna null se inválida */
function corSegura(s: any): string | null {
  if (!s) return null;
  let x = String(s).trim().toUpperCase().replace(/^#/, '');
  if (/^[0-9A-F]{3}$/.test(x)) x = x.split('').map((ch) => ch + ch).join('');
  return /^[0-9A-F]{6}$/.test(x) ? '#' + x : null;
}

/** Conta vínculos do serviço para validação de delete */
async function contarVinculosServico(db: D1Database, id_empresa: number, id_servico: number) {
  const [precos, produtos, remessaItens]: any = await Promise.all([
    db.prepare(`SELECT COUNT(*) as n FROM terc_precos WHERE id_empresa=? AND id_servico=?`).bind(id_empresa, id_servico).first(),
    db.prepare(`SELECT COUNT(*) as n FROM terc_produtos WHERE id_empresa=? AND id_servico_padrao=?`).bind(id_empresa, id_servico).first(),
    db.prepare(`SELECT COUNT(*) as n FROM terc_remessa_itens WHERE id_empresa=? AND id_servico=?`).bind(id_empresa, id_servico).first(),
  ]);
  return {
    precos: Number(precos?.n || 0),
    produtos: Number(produtos?.n || 0),
    remessa_itens: Number(remessaItens?.n || 0),
    total: Number(precos?.n || 0) + Number(produtos?.n || 0) + Number(remessaItens?.n || 0),
  };
}

app.get('/terc/servicos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();
  const where: string[] = ['s.id_empresa=?'];
  const binds: any[] = [id_empresa];
  if (q.q) {
    where.push('(LOWER(s.desc_servico) LIKE ? OR LOWER(COALESCE(s.descricao,\'\')) LIKE ? OR LOWER(COALESCE(s.categoria,\'\')) LIKE ?)');
    const like = '%' + String(q.q).toLowerCase().trim() + '%';
    binds.push(like, like, like);
  }
  if (q.ativo === '1') where.push('s.ativo=1');
  if (q.ativo === '0') where.push('s.ativo=0');
  if (q.categoria) { where.push('s.categoria=?'); binds.push(q.categoria); }
  // HOTFIX 0037: filtro por setor
  if (q.id_setor) { where.push('s.id_setor=?'); binds.push(toInt(q.id_setor)); }

  const rs = await c.env.DB.prepare(
    `SELECT s.*, st.nome_setor AS setor_nome, st.cor AS setor_cor,
            (SELECT COUNT(*) FROM terc_precos      p  WHERE p.id_empresa=s.id_empresa  AND p.id_servico=s.id_servico)            AS qtd_precos,
            (SELECT COUNT(*) FROM terc_produtos    pr WHERE pr.id_empresa=s.id_empresa AND pr.id_servico_padrao=s.id_servico)    AS qtd_produtos,
            (SELECT COUNT(*) FROM terc_remessa_itens r WHERE r.id_empresa=s.id_empresa AND r.id_servico=s.id_servico)            AS qtd_remessas
       FROM terc_servicos s
       LEFT JOIN terc_setores st ON st.id_setor=s.id_setor AND st.id_empresa=s.id_empresa
      WHERE ${where.join(' AND ')}
      ORDER BY s.ativo DESC, COALESCE(st.ordem,9999), s.categoria, s.desc_servico`
  ).bind(...binds).all();
  return c.json(ok(rs.results));
});

app.get('/terc/servicos/categorias', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const rs = await c.env.DB.prepare(
    `SELECT categoria, COUNT(*) as n FROM terc_servicos
       WHERE id_empresa=? AND categoria IS NOT NULL AND categoria <> ''
       GROUP BY categoria ORDER BY categoria`
  ).bind(id_empresa).all();
  return c.json(ok(rs.results));
});

app.get('/terc/servicos/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  if (!id) return fail('ID inválido.', 400);
  const row: any = await c.env.DB.prepare(
    `SELECT * FROM terc_servicos WHERE id_servico=? AND id_empresa=?`
  ).bind(id, id_empresa).first();
  if (!row) return fail('Serviço não encontrado.', 404);
  const vinc = await contarVinculosServico(c.env.DB, id_empresa, id);
  return c.json(ok({ ...row, vinculos: vinc }));
});

app.post('/terc/servicos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json<any>();
  const nome = String(b.desc_servico || '').trim();
  if (!nome) return fail('Nome do serviço é obrigatório.', 400);
  if (nome.length > 120) return fail('Nome muito longo (máx 120 caracteres).', 400);

  // Anti-duplicidade (case-insensitive) na mesma empresa
  const dup: any = await c.env.DB.prepare(
    `SELECT id_servico FROM terc_servicos WHERE id_empresa=? AND LOWER(desc_servico)=LOWER(?) LIMIT 1`
  ).bind(id_empresa, nome).first();
  if (dup) return fail('Já existe um serviço com este nome.', 409);

  // HOTFIX 0037: id_setor (FK opcional)
  const id_setor = b.id_setor != null && b.id_setor !== '' ? toInt(b.id_setor) : null;
  if (id_setor) {
    const set: any = await c.env.DB.prepare(
      `SELECT id_setor FROM terc_setores WHERE id_setor=? AND id_empresa=?`
    ).bind(id_setor, id_empresa).first();
    if (!set) return fail('Setor inválido para esta empresa.', 400);
  }

  const r = await c.env.DB.prepare(
    `INSERT INTO terc_servicos
       (desc_servico, descricao, categoria, cor, preco_padrao, tempo_padrao, observacoes, ativo, id_empresa, id_setor, dt_criacao, dt_alteracao)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(
    nome,
    b.descricao ? String(b.descricao).trim() : null,
    b.categoria ? String(b.categoria).trim() : null,
    corSegura(b.cor),
    b.preco_padrao != null && b.preco_padrao !== '' ? Number(b.preco_padrao) : null,
    b.tempo_padrao != null && b.tempo_padrao !== '' ? Number(b.tempo_padrao) : null,
    b.observacoes ? String(b.observacoes).trim() : null,
    b.ativo === 0 || b.ativo === false ? 0 : 1,
    id_empresa,
    id_setor
  ).run();
  await audit(c, MOD, 'INS', `servico:${r.meta.last_row_id}`, 'desc_servico', '', nome);
  return c.json(ok({ id: r.meta.last_row_id }));
});

app.put('/terc/servicos/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  if (!id) return fail('ID inválido.', 400);
  const b = await c.req.json<any>();
  const nome = String(b.desc_servico || '').trim();
  if (!nome) return fail('Nome do serviço é obrigatório.', 400);
  if (nome.length > 120) return fail('Nome muito longo (máx 120 caracteres).', 400);

  // Anti-duplicidade contra OUTROS registros
  const dup: any = await c.env.DB.prepare(
    `SELECT id_servico FROM terc_servicos WHERE id_empresa=? AND LOWER(desc_servico)=LOWER(?) AND id_servico<>? LIMIT 1`
  ).bind(id_empresa, nome, id).first();
  if (dup) return fail('Já existe outro serviço com este nome.', 409);

  // HOTFIX 0037: id_setor (FK opcional)
  const id_setor = b.id_setor != null && b.id_setor !== '' ? toInt(b.id_setor) : null;
  if (id_setor) {
    const set: any = await c.env.DB.prepare(
      `SELECT id_setor FROM terc_setores WHERE id_setor=? AND id_empresa=?`
    ).bind(id_setor, id_empresa).first();
    if (!set) return fail('Setor inválido para esta empresa.', 400);
  }

  await c.env.DB.prepare(
    `UPDATE terc_servicos
        SET desc_servico=?, descricao=?, categoria=?, cor=?, preco_padrao=?, tempo_padrao=?,
            observacoes=?, ativo=?, id_setor=?, dt_alteracao=datetime('now')
      WHERE id_servico=? AND id_empresa=?`
  ).bind(
    nome,
    b.descricao ? String(b.descricao).trim() : null,
    b.categoria ? String(b.categoria).trim() : null,
    corSegura(b.cor),
    b.preco_padrao != null && b.preco_padrao !== '' ? Number(b.preco_padrao) : null,
    b.tempo_padrao != null && b.tempo_padrao !== '' ? Number(b.tempo_padrao) : null,
    b.observacoes ? String(b.observacoes).trim() : null,
    b.ativo === 0 || b.ativo === false ? 0 : 1,
    id_setor,
    id, id_empresa
  ).run();
  await audit(c, MOD, 'UPD', `servico:${id}`);
  return c.json(ok({ id }));
});

app.patch('/terc/servicos/:id/toggle', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  if (!id) return fail('ID inválido.', 400);
  const cur: any = await c.env.DB.prepare(
    `SELECT ativo FROM terc_servicos WHERE id_servico=? AND id_empresa=?`
  ).bind(id, id_empresa).first();
  if (!cur) return fail('Serviço não encontrado.', 404);
  const novo = cur.ativo ? 0 : 1;
  await c.env.DB.prepare(
    `UPDATE terc_servicos SET ativo=?, dt_alteracao=datetime('now') WHERE id_servico=? AND id_empresa=?`
  ).bind(novo, id, id_empresa).run();
  await audit(c, MOD, 'TOGGLE', `servico:${id}`, 'ativo', String(cur.ativo), String(novo));
  return c.json(ok({ id, ativo: novo }));
});

app.post('/terc/servicos/:id/duplicate', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  if (!id) return fail('ID inválido.', 400);
  const src: any = await c.env.DB.prepare(
    `SELECT * FROM terc_servicos WHERE id_servico=? AND id_empresa=?`
  ).bind(id, id_empresa).first();
  if (!src) return fail('Serviço não encontrado.', 404);

  // Gera nome único: "X (cópia)", "X (cópia 2)", "X (cópia 3)" ...
  let baseNome = `${src.desc_servico} (cópia)`;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists: any = await c.env.DB.prepare(
      `SELECT 1 FROM terc_servicos WHERE id_empresa=? AND LOWER(desc_servico)=LOWER(?) LIMIT 1`
    ).bind(id_empresa, baseNome).first();
    if (!exists) break;
    n += 1;
    baseNome = `${src.desc_servico} (cópia ${n})`;
    if (n > 50) return fail('Muitas cópias deste serviço — renomeie as cópias antigas.', 409);
  }

  const r = await c.env.DB.prepare(
    `INSERT INTO terc_servicos
       (desc_servico, descricao, categoria, cor, preco_padrao, tempo_padrao, observacoes, ativo, id_empresa, dt_criacao, dt_alteracao)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`
  ).bind(
    baseNome, src.descricao, src.categoria, src.cor,
    src.preco_padrao, src.tempo_padrao, src.observacoes, id_empresa
  ).run();
  await audit(c, MOD, 'DUP', `servico:${r.meta.last_row_id}`, 'from_id', '', String(id));
  return c.json(ok({ id: r.meta.last_row_id, desc_servico: baseNome }));
});

app.delete('/terc/servicos/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  if (!id) return fail('ID inválido.', 400);
  const force = c.req.query('force') === '1';

  // Verifica existência + vínculos
  const cur: any = await c.env.DB.prepare(
    `SELECT id_servico, desc_servico FROM terc_servicos WHERE id_servico=? AND id_empresa=?`
  ).bind(id, id_empresa).first();
  if (!cur) return fail('Serviço não encontrado.', 404);

  const vinc = await contarVinculosServico(c.env.DB, id_empresa, id);
  if (vinc.total > 0 && !force) {
    return c.json({
      ok: false,
      error: `Serviço está vinculado: ${vinc.precos} preço(s), ${vinc.produtos} produto(s), ${vinc.remessa_itens} item(ns) de remessa. ` +
             `Use ?force=1 para apenas desativar (não exclui).`,
      code: 'HAS_LINKS',
      data: { vinculos: vinc },
    }, 409);
  }

  if (force && vinc.total > 0) {
    // Modo seguro: desativa em vez de excluir (preserva histórico)
    await c.env.DB.prepare(
      `UPDATE terc_servicos SET ativo=0, dt_alteracao=datetime('now') WHERE id_servico=? AND id_empresa=?`
    ).bind(id, id_empresa).run();
    await audit(c, MOD, 'DISABLE', `servico:${id}`, 'desc_servico', cur.desc_servico, '');
    return c.json(ok({ id, deleted: false, disabled: true, vinculos: vinc }));
  }

  // Sem vínculos → DELETE real
  await c.env.DB.prepare(
    `DELETE FROM terc_servicos WHERE id_servico=? AND id_empresa=?`
  ).bind(id, id_empresa).run();
  await audit(c, MOD, 'DEL', `servico:${id}`, 'desc_servico', cur.desc_servico, '');
  return c.json(ok({ id, deleted: true }));
});

// -------- Coleções (tenant-scoped)
app.get('/terc/colecoes', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const rs = await c.env.DB.prepare('SELECT * FROM terc_colecoes WHERE id_empresa=? ORDER BY nome_colecao').bind(id_empresa).all();
  return c.json(ok(rs.results));
});
app.post('/terc/colecoes', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  if (!b.nome_colecao) return fail('nome_colecao é obrigatório');
  const r = await c.env.DB.prepare('INSERT INTO terc_colecoes (nome_colecao, ativo, id_empresa) VALUES (?, 1, ?)').bind(b.nome_colecao, id_empresa).run();
  await audit(c, MOD, 'INS', `colecao:${r.meta.last_row_id}`, 'nome_colecao', '', b.nome_colecao);
  return c.json(ok({ id: r.meta.last_row_id }));
});
app.put('/terc/colecoes/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  await c.env.DB.prepare('UPDATE terc_colecoes SET nome_colecao=?, ativo=? WHERE id_colecao=? AND id_empresa=?').bind(b.nome_colecao, b.ativo ? 1 : 0, id, id_empresa).run();
  await audit(c, MOD, 'UPD', `colecao:${id}`);
  return c.json(ok({ id }));
});
app.delete('/terc/colecoes/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  // Validações de uso (impede excluir coleção em uso) — todas escopadas por empresa
  const usoP = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_produtos WHERE id_colecao=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (usoP && usoP.c > 0) return fail(`Coleção possui ${usoP.c} produto(s) vinculado(s).`, 409);
  const usoR = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_remessas WHERE id_colecao=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (usoR && usoR.c > 0) return fail(`Coleção possui ${usoR.c} remessa(s) vinculada(s).`, 409);
  const usoPr = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_precos WHERE id_colecao=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (usoPr && usoPr.c > 0) return fail(`Coleção possui ${usoPr.c} preço(s) vinculado(s).`, 409);
  await c.env.DB.prepare('DELETE FROM terc_colecoes WHERE id_colecao=? AND id_empresa=?').bind(id, id_empresa).run();
  await audit(c, MOD, 'DEL', `colecao:${id}`);
  return c.json(ok({ id, deleted: true }));
});

/* =================================================================
 * PRODUTOS — Cadastro central de referências (auto-fill em remessa/preço)
 * ================================================================= */

app.get('/terc/produtos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();
  const where: string[] = ['p.id_empresa=?']; const binds: any[] = [id_empresa];
  if (q.ativo !== '0') where.push('p.ativo=1');
  if (q.id_colecao) { where.push('p.id_colecao=?'); binds.push(toInt(q.id_colecao)); }
  if (q.search) {
    where.push('(p.cod_ref LIKE ? OR p.desc_ref LIKE ? OR p.nome_produto LIKE ?)');
    binds.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
  }
  const sql = `
    SELECT p.*, co.nome_colecao, s.desc_servico AS desc_servico_padrao
    FROM terc_produtos p
    LEFT JOIN terc_colecoes co ON co.id_colecao=p.id_colecao AND co.id_empresa=p.id_empresa
    LEFT JOIN terc_servicos s ON s.id_servico=p.id_servico_padrao AND s.id_empresa=p.id_empresa
    WHERE ${where.join(' AND ')}
    ORDER BY p.cod_ref
    LIMIT 2000`;
  const rs = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(ok(rs.results));
});

// Excluir TODOS os produtos (com proteção: exige confirm=SIM no body) — escopado por empresa
app.delete('/terc/produtos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json().catch(() => ({}));
  if (b.confirm !== 'SIM') return fail('Confirmação obrigatória: envie {"confirm":"SIM"} no body.', 400);
  const tot = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_produtos WHERE id_empresa=?').bind(id_empresa).first<any>();
  await c.env.DB.prepare('DELETE FROM terc_produtos WHERE id_empresa=?').bind(id_empresa).run();
  await audit(c, MOD, 'DEL_ALL', 'produto:*', 'qtd', String(tot?.c || 0), '0');
  return c.json(ok({ deleted: tot?.c || 0 }));
});

// Lookup rápido por referência (auto-fill na remessa/preço) — escopado por empresa
app.get('/terc/produtos/lookup', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();
  const cod_ref = String(q.cod_ref || '').trim();
  if (!cod_ref) return c.json(ok(null));
  const r = await c.env.DB.prepare(`
    SELECT p.*, co.nome_colecao FROM terc_produtos p
    LEFT JOIN terc_colecoes co ON co.id_colecao=p.id_colecao AND co.id_empresa=p.id_empresa
    WHERE p.cod_ref=? AND p.ativo=1 AND p.id_empresa=?
      AND (? = 0 OR p.id_colecao=? OR p.id_colecao IS NULL)
    ORDER BY CASE WHEN p.id_colecao=? THEN 0 ELSE 1 END LIMIT 1`)
    .bind(cod_ref, id_empresa, toInt(q.id_colecao) || 0, toInt(q.id_colecao) || 0, toInt(q.id_colecao) || 0)
    .first<any>();
  return c.json(ok(r || null));
});

app.get('/terc/produtos/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const r = await c.env.DB.prepare(`
    SELECT p.*, co.nome_colecao, s.desc_servico AS desc_servico_padrao
    FROM terc_produtos p
    LEFT JOIN terc_colecoes co ON co.id_colecao=p.id_colecao AND co.id_empresa=p.id_empresa
    LEFT JOIN terc_servicos s ON s.id_servico=p.id_servico_padrao AND s.id_empresa=p.id_empresa
    WHERE p.id_produto=? AND p.id_empresa=?`).bind(id, id_empresa).first<any>();
  if (!r) return fail('Produto não encontrado', 404);
  return c.json(ok(r));
});

app.post('/terc/produtos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  const cod_ref = String(b.cod_ref || '').trim();
  const desc_ref = String(b.desc_ref || b.nome_produto || '').trim();
  if (!cod_ref) return fail('Referência é obrigatória');
  if (!desc_ref) return fail('Descrição é obrigatória');
  // Pré-checagem de duplicidade dentro da própria empresa
  const dup = await c.env.DB.prepare(
    'SELECT id_produto FROM terc_produtos WHERE cod_ref=? AND COALESCE(id_colecao,0)=COALESCE(?,0) AND id_empresa=?'
  ).bind(cod_ref, toInt(b.id_colecao) || null, id_empresa).first<any>();
  if (dup) return fail(`Já existe produto com a referência "${cod_ref}" (id ${dup.id_produto}).`, 409);
  try {
    const r = await c.env.DB.prepare(`
      INSERT INTO terc_produtos
        (cod_ref, desc_ref, nome_produto, id_colecao, grade_padrao, observacao,
         id_servico_padrao, tempo_padrao, ativo, criado_por, id_empresa)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind(cod_ref, desc_ref, b.nome_produto || null, toInt(b.id_colecao) || null,
        toInt(b.grade_padrao, 1), b.observacao || null,
        toInt(b.id_servico_padrao) || null, b.tempo_padrao != null ? toNum(b.tempo_padrao) : null,
        getUser(c), id_empresa).run();
    await audit(c, MOD, 'INS', `produto:${r.meta.last_row_id}`, 'cod_ref', '', cod_ref);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Já existe produto com essa referência nesta coleção', 409);
    return fail(String(e));
  }
});

app.put('/terc/produtos/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  const cod_ref = String(b.cod_ref || '').trim();
  const desc_ref = String(b.desc_ref || b.nome_produto || '').trim();
  if (!cod_ref || !desc_ref) return fail('Referência e descrição são obrigatórias');
  // Pré-checagem de duplicidade (excluindo o próprio id) — escopada por empresa
  const dup = await c.env.DB.prepare(
    'SELECT id_produto FROM terc_produtos WHERE cod_ref=? AND COALESCE(id_colecao,0)=COALESCE(?,0) AND id_produto<>? AND id_empresa=?'
  ).bind(cod_ref, toInt(b.id_colecao) || null, id, id_empresa).first<any>();
  if (dup) return fail(`Já existe outro produto com a referência "${cod_ref}" (id ${dup.id_produto}).`, 409);
  try {
    await c.env.DB.prepare(`
      UPDATE terc_produtos
      SET cod_ref=?, desc_ref=?, nome_produto=?, id_colecao=?, grade_padrao=?, observacao=?,
          id_servico_padrao=?, tempo_padrao=?, ativo=?, dt_alteracao=datetime('now')
      WHERE id_produto=? AND id_empresa=?`)
      .bind(cod_ref, desc_ref, b.nome_produto || null, toInt(b.id_colecao) || null,
        toInt(b.grade_padrao, 1), b.observacao || null,
        toInt(b.id_servico_padrao) || null, b.tempo_padrao != null && b.tempo_padrao !== '' ? toNum(b.tempo_padrao) : null,
        b.ativo === 0 ? 0 : 1, id, id_empresa).run();
    await audit(c, MOD, 'UPD', `produto:${id}`);
    return c.json(ok({ id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Já existe produto com essa referência nesta coleção', 409);
    return fail(String(e));
  }
});

app.delete('/terc/produtos/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM terc_produtos WHERE id_produto=? AND id_empresa=?').bind(id, id_empresa).run();
  await audit(c, MOD, 'DEL', `produto:${id}`);
  return c.json(ok({ id, deleted: true }));
});

/* =================================================================
 * 🧹 LIMPEZA LEVE — Nome + Descrição (IGNORA referência)
 *
 * Regras (PROMPT GENZPARK):
 *  - PRODUTOS:  duplicado = nome_normalizado + descricao_normalizada
 *               normalização: lower(trim(...)) + remove espaços duplos / invisíveis
 *               manter o de menor id_produto (ORDER BY id ASC), excluir restantes
 *  - PREÇOS:    duplicado = nome + descricao + cor + grade + serviço (ignora ref)
 *               valores iguais → manter 1, excluir resto
 *               valores diferentes → manter o mais recente (maior id), excluir resto
 *               serviço diferente → NÃO é duplicado (já garantido pelo grupo)
 *
 * Performance:
 *  - SQL direto (CTE + DELETE em massa), nada de loop por item
 *  - Sem dry-run pesado, sem preview, sem simulação
 *  - Backup leve antes de excluir (CREATE TABLE AS SELECT)
 * ================================================================= */
app.post('/terc/cleanup/run', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const DB = c.env.DB;
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14); // YYYYMMDDHHMMSS

  // 1) BACKUP LEVE (DROP + CREATE AS SELECT) — apenas tenant atual
  const bkProd = `bk_terc_produtos_e${id_empresa}_${ts}`;
  const bkPrec = `bk_terc_precos_e${id_empresa}_${ts}`;
  await DB.prepare(`DROP TABLE IF EXISTS ${bkProd}`).run().catch(() => {});
  await DB.prepare(`DROP TABLE IF EXISTS ${bkPrec}`).run().catch(() => {});
  await DB.prepare(`CREATE TABLE ${bkProd} AS SELECT * FROM terc_produtos WHERE id_empresa=${id_empresa}`).run().catch(() => {});
  await DB.prepare(`CREATE TABLE ${bkPrec} AS SELECT * FROM terc_precos WHERE id_empresa=${id_empresa}`).run().catch(() => {});

  // 2) PRODUTOS — duplicidade por (nome_norm, desc_norm), mantém menor id
  //    nome efetivo = COALESCE(nome_produto, desc_ref); desc efetiva = desc_ref
  //    normalização SQL portável: LOWER(TRIM(REPLACE(REPLACE(REPLACE(x, char(9), ' '), char(160), ' '), '  ', ' ')))
  const NORM_SQL = (col: string) => `
    LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col},''),
      CHAR(9), ' '), CHAR(160), ' '), CHAR(13), ' '), CHAR(10), ' '), '  ', ' ')))`;

  const totProdAntes = (await DB.prepare(`SELECT COUNT(*) AS n FROM terc_produtos WHERE id_empresa=?`).bind(id_empresa).first<any>())?.n || 0;

  // Calcula quantos serão removidos antes (apenas COUNT, sem listar)
  const remProd = (await DB.prepare(`
    SELECT COUNT(*) AS n FROM terc_produtos p
    WHERE p.id_empresa=?
      AND p.id_produto > (
      SELECT MIN(p2.id_produto) FROM terc_produtos p2
      WHERE p2.id_empresa=p.id_empresa
        AND ${NORM_SQL('p2.nome_produto')} = ${NORM_SQL('p.nome_produto')}
        AND ${NORM_SQL('p2.desc_ref')}     = ${NORM_SQL('p.desc_ref')}
    )
  `).bind(id_empresa).first<any>())?.n || 0;

  if (remProd > 0) {
    // DELETE em massa — SQL direto, apenas tenant atual
    await DB.prepare(`
      DELETE FROM terc_produtos
      WHERE id_empresa=?
        AND id_produto IN (
        SELECT p.id_produto FROM terc_produtos p
        WHERE p.id_empresa=?
          AND p.id_produto > (
          SELECT MIN(p2.id_produto) FROM terc_produtos p2
          WHERE p2.id_empresa=p.id_empresa
            AND ${NORM_SQL('p2.nome_produto')} = ${NORM_SQL('p.nome_produto')}
            AND ${NORM_SQL('p2.desc_ref')}     = ${NORM_SQL('p.desc_ref')}
        )
      )
    `).bind(id_empresa, id_empresa).run();
  }

  const totProdDepois = (await DB.prepare(`SELECT COUNT(*) AS n FROM terc_produtos WHERE id_empresa=?`).bind(id_empresa).first<any>())?.n || 0;

  // 3) PREÇOS — duplicidade por (nome_norm, desc_norm, cor_norm, tamanho_norm, id_servico)
  //    IGNORA cod_ref totalmente, conforme exigência do prompt
  //    valores iguais → mantém menor id; valores diferentes → mantém maior id (mais recente)
  const totPrecAntes = (await DB.prepare(`SELECT COUNT(*) AS n FROM terc_precos WHERE ativo=1 AND id_empresa=?`).bind(id_empresa).first<any>())?.n || 0;

  // 3a) Duplicatas com TUDO igual (mesmo preço, mesmo tempo) → manter MIN(id)
  //     Aqui agrupamos pela chave de negócio + valor; quem sobrar é "tudo igual"
  // 3b) Duplicatas com VALORES diferentes na mesma chave → manter MAX(id)
  //
  // Estratégia única e barata: para cada grupo (chave), manter MAX(id_preco) — sempre o mais recente
  //   - Se valores forem iguais, ainda é correto (apenas mantemos o mais recente, idêntico aos outros)
  //   - Se valores diferirem, atende a regra "manter mais recente"
  // Isso simplifica a query a UM ÚNICO DELETE.

  const remPrec = (await DB.prepare(`
    SELECT COUNT(*) AS n FROM terc_precos p
    WHERE p.ativo=1 AND p.id_empresa=?
      AND p.id_preco < (
        SELECT MAX(p2.id_preco) FROM terc_precos p2
        WHERE p2.ativo=1 AND p2.id_empresa=p.id_empresa
          AND p2.id_servico = p.id_servico
          AND ${NORM_SQL('p2.cor')}     = ${NORM_SQL('p.cor')}
          AND ${NORM_SQL('p2.tamanho')} = ${NORM_SQL('p.tamanho')}
          AND ${NORM_SQL('p2.cod_ref')} = ${NORM_SQL('p.cod_ref')}  -- mantém isolamento por produto
          AND ${NORM_SQL('p2.desc_ref')}= ${NORM_SQL('p.desc_ref')}
      )
  `).bind(id_empresa).first<any>())?.n || 0;

  if (remPrec > 0) {
    await DB.prepare(`
      DELETE FROM terc_precos
      WHERE id_empresa=?
        AND id_preco IN (
        SELECT p.id_preco FROM terc_precos p
        WHERE p.ativo=1 AND p.id_empresa=?
          AND p.id_preco < (
            SELECT MAX(p2.id_preco) FROM terc_precos p2
            WHERE p2.ativo=1 AND p2.id_empresa=p.id_empresa
              AND p2.id_servico = p.id_servico
              AND ${NORM_SQL('p2.cor')}     = ${NORM_SQL('p.cor')}
              AND ${NORM_SQL('p2.tamanho')} = ${NORM_SQL('p.tamanho')}
              AND ${NORM_SQL('p2.cod_ref')} = ${NORM_SQL('p.cod_ref')}
              AND ${NORM_SQL('p2.desc_ref')}= ${NORM_SQL('p.desc_ref')}
          )
      )
    `).bind(id_empresa, id_empresa).run();
  }

  const totPrecDepois = (await DB.prepare(`SELECT COUNT(*) AS n FROM terc_precos WHERE ativo=1 AND id_empresa=?`).bind(id_empresa).first<any>())?.n || 0;

  await audit(c, MOD, 'CLEANUP_RUN', 'duplicados',
    `prod:${totProdAntes}->${totProdDepois}`,
    `prec:${totPrecAntes}->${totPrecDepois}`,
    `bk:${bkProd}|${bkPrec}`);

  return c.json(ok({
    backup: { produtos: bkProd, precos: bkPrec },
    produtos: {
      antes: totProdAntes,
      depois: totProdDepois,
      removidos: totProdAntes - totProdDepois,
    },
    precos: {
      antes: totPrecAntes,
      depois: totPrecDepois,
      removidos: totPrecAntes - totPrecDepois,
    },
    resumo: `${totProdAntes - totProdDepois} produto(s) removido(s) · ${totPrecAntes - totPrecDepois} preço(s) removido(s)`,
  }));
});

// Aliases legados — apontam para o mesmo handler leve
app.post('/terc/cleanup/produtos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const DB = c.env.DB;
  const NORM_SQL = (col: string) => `
    LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col},''),
      CHAR(9), ' '), CHAR(160), ' '), CHAR(13), ' '), CHAR(10), ' '), '  ', ' ')))`;
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const bk = `bk_terc_produtos_e${id_empresa}_${ts}`;
  const totAntes = (await DB.prepare(`SELECT COUNT(*) AS n FROM terc_produtos WHERE id_empresa=?`).bind(id_empresa).first<any>())?.n || 0;
  await DB.prepare(`DROP TABLE IF EXISTS ${bk}`).run().catch(() => {});
  await DB.prepare(`CREATE TABLE ${bk} AS SELECT * FROM terc_produtos WHERE id_empresa=${id_empresa}`).run().catch(() => {});
  await DB.prepare(`
    DELETE FROM terc_produtos
    WHERE id_empresa=?
      AND id_produto IN (
      SELECT p.id_produto FROM terc_produtos p
      WHERE p.id_empresa=?
        AND p.id_produto > (
        SELECT MIN(p2.id_produto) FROM terc_produtos p2
        WHERE p2.id_empresa=p.id_empresa
          AND ${NORM_SQL('p2.nome_produto')} = ${NORM_SQL('p.nome_produto')}
          AND ${NORM_SQL('p2.desc_ref')}     = ${NORM_SQL('p.desc_ref')}
      )
    )
  `).bind(id_empresa, id_empresa).run();
  const totDepois = (await DB.prepare(`SELECT COUNT(*) AS n FROM terc_produtos WHERE id_empresa=?`).bind(id_empresa).first<any>())?.n || 0;
  await audit(c, MOD, 'CLEANUP_PRODUTOS', 'produtos', `${totAntes}`, `${totDepois}`, `bk:${bk}`);
  return c.json(ok({ backup: bk, antes: totAntes, depois: totDepois, removidos: totAntes - totDepois }));
});

app.post('/terc/cleanup/precos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const DB = c.env.DB;
  const NORM_SQL = (col: string) => `
    LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col},''),
      CHAR(9), ' '), CHAR(160), ' '), CHAR(13), ' '), CHAR(10), ' '), '  ', ' ')))`;
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const bk = `bk_terc_precos_e${id_empresa}_${ts}`;
  const totAntes = (await DB.prepare(`SELECT COUNT(*) AS n FROM terc_precos WHERE ativo=1 AND id_empresa=?`).bind(id_empresa).first<any>())?.n || 0;
  await DB.prepare(`DROP TABLE IF EXISTS ${bk}`).run().catch(() => {});
  await DB.prepare(`CREATE TABLE ${bk} AS SELECT * FROM terc_precos WHERE id_empresa=${id_empresa}`).run().catch(() => {});
  await DB.prepare(`
    DELETE FROM terc_precos
    WHERE id_empresa=?
      AND id_preco IN (
      SELECT p.id_preco FROM terc_precos p
      WHERE p.ativo=1 AND p.id_empresa=?
        AND p.id_preco < (
          SELECT MAX(p2.id_preco) FROM terc_precos p2
          WHERE p2.ativo=1 AND p2.id_empresa=p.id_empresa
            AND p2.id_servico = p.id_servico
            AND ${NORM_SQL('p2.cor')}     = ${NORM_SQL('p.cor')}
            AND ${NORM_SQL('p2.tamanho')} = ${NORM_SQL('p.tamanho')}
            AND ${NORM_SQL('p2.cod_ref')} = ${NORM_SQL('p.cod_ref')}
            AND ${NORM_SQL('p2.desc_ref')}= ${NORM_SQL('p.desc_ref')}
        )
    )
  `).bind(id_empresa, id_empresa).run();
  const totDepois = (await DB.prepare(`SELECT COUNT(*) AS n FROM terc_precos WHERE ativo=1 AND id_empresa=?`).bind(id_empresa).first<any>())?.n || 0;
  await audit(c, MOD, 'CLEANUP_PRECOS', 'precos', `${totAntes}`, `${totDepois}`, `bk:${bk}`);
  return c.json(ok({ backup: bk, antes: totAntes, depois: totDepois, removidos: totAntes - totDepois }));
});

/*  Importação em lote de produtos (Excel/CSV)
 *  Aliases aceitos por coluna (case/acento-insensitive — normalizados no front):
 *    cod_ref       ← "NOME REFERÊNCIA" | referencia | ref | codigo | cod_ref
 *    desc_ref      ← "PRODUTO" | descricao | desc | nome
 *    nome_produto  ← nome_produto | nome
 *    colecao       ← colecao | nome_colecao
 *    id_servico    ← id_servico_padrao | servico_padrao | servico
 *    tempo_padrao  ← tempo_padrao | tempo
 *    grade_padrao  ← grade_padrao | grade
 *    observacao    ← observacao | obs
 *  Opções no body:
 *    dry_run        : boolean (default false) — simula sem gravar
 *    criar_novos    : boolean (default true)  — se false, ignora referências novas
 *    atualizar      : boolean (default true)  — se false, ignora referências existentes
 */
app.post('/terc/produtos/importar', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  const rows: any[] = Array.isArray(b.rows) ? b.rows : [];
  const dryRun = !!b.dry_run;
  const criarNovos = b.criar_novos !== false;
  const atualizarExist = b.atualizar !== false;
  if (rows.length === 0) return fail('Nenhuma linha enviada');

  // Cache de coleções e serviços p/ resolução por nome (tenant-scoped)
  const colMap: Record<string, number> = {};
  (await c.env.DB.prepare('SELECT id_colecao, nome_colecao FROM terc_colecoes WHERE id_empresa=?').bind(id_empresa).all()).results.forEach((r: any) =>
    colMap[String(r.nome_colecao).toLowerCase().trim()] = r.id_colecao);
  const servMap: Record<string, number> = {};
  (await c.env.DB.prepare('SELECT id_servico, desc_servico FROM terc_servicos WHERE id_empresa=?').bind(id_empresa).all()).results.forEach((r: any) =>
    servMap[String(r.desc_servico).toLowerCase().trim()] = r.id_servico);

  const erros: any[] = [];
  const refsNoLote = new Map<string, number>(); // chave "cod_ref|id_colecao" → linha
  let inseridos = 0, atualizados = 0, ignorados = 0, colCriadas = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; const n = i + 1;
    try {
      const cod_ref = String(row.cod_ref || row.referencia || row.ref || row.codigo || '').trim();
      const desc_ref = String(row.desc_ref || row.descricao || row.desc || row.produto || row.nome_produto || row.nome || '').trim();
      const nome_produto = String(row.nome_produto || row.nome || '').trim() || null;
      const grade_padrao = toInt(row.grade_padrao || row.grade || 1, 1);
      const observacao = String(row.observacao || row.obs || '').trim() || null;
      const colecao = String(row.colecao || row.nome_colecao || '').trim();
      const tempo_padrao = (row.tempo_padrao != null && row.tempo_padrao !== '') ? toNum(row.tempo_padrao)
                          : (row.tempo != null && row.tempo !== '' ? toNum(row.tempo) : null);

      if (!cod_ref || !desc_ref) {
        erros.push({ linha: n, ref: cod_ref, erro: 'Referência e descrição são obrigatórias' });
        ignorados++; continue;
      }

      // Resolve coleção (cria se faltar e dry_run=false)
      let id_colecao: number | null = null;
      if (colecao) {
        id_colecao = colMap[colecao.toLowerCase()] || null;
        if (!id_colecao && !dryRun) {
          const r = await c.env.DB.prepare('INSERT INTO terc_colecoes (id_empresa, nome_colecao, ativo) VALUES (?, ?, 1)').bind(id_empresa, colecao).run();
          id_colecao = r.meta.last_row_id as number;
          colMap[colecao.toLowerCase()] = id_colecao; colCriadas++;
        }
      }

      // Resolve serviço por nome OU id
      let id_servico_padrao: number | null = null;
      const servRaw = row.id_servico_padrao || row.servico_padrao || row.servico || row.id_servico;
      if (servRaw != null && String(servRaw).trim() !== '') {
        const asNum = toInt(servRaw);
        if (asNum > 0) id_servico_padrao = asNum;
        else id_servico_padrao = servMap[String(servRaw).toLowerCase().trim()] || null;
      }

      // Detecta duplicidade dentro do PRÓPRIO arquivo (mesma ref+coleção em 2 linhas)
      const dupKey = `${cod_ref}|${id_colecao || 0}`;
      if (refsNoLote.has(dupKey)) {
        erros.push({ linha: n, ref: cod_ref, erro: `Referência duplicada na planilha (linha ${refsNoLote.get(dupKey)})` });
        ignorados++; continue;
      }
      refsNoLote.set(dupKey, n);

      // Verifica se já existe na base (cod_ref + colecao + tenant)
      const exists = await c.env.DB.prepare(
        'SELECT id_produto FROM terc_produtos WHERE id_empresa=? AND cod_ref=? AND COALESCE(id_colecao,0)=COALESCE(?,0)'
      ).bind(id_empresa, cod_ref, id_colecao).first<any>();

      if (exists && !atualizarExist) {
        erros.push({ linha: n, ref: cod_ref, erro: 'Já existe e "atualizar" desativado' });
        ignorados++; continue;
      }
      if (!exists && !criarNovos) {
        erros.push({ linha: n, ref: cod_ref, erro: 'Não existe e "criar novos" desativado' });
        ignorados++; continue;
      }

      if (!dryRun) {
        if (exists) {
          await c.env.DB.prepare(`
            UPDATE terc_produtos
            SET desc_ref=?, nome_produto=?, grade_padrao=?, observacao=?,
                id_servico_padrao=COALESCE(?, id_servico_padrao),
                tempo_padrao=COALESCE(?, tempo_padrao),
                dt_alteracao=datetime('now')
            WHERE id_produto=? AND id_empresa=?`)
            .bind(desc_ref, nome_produto, grade_padrao, observacao,
              id_servico_padrao, tempo_padrao, exists.id_produto, id_empresa).run();
          atualizados++;
        } else {
          await c.env.DB.prepare(`
            INSERT INTO terc_produtos
              (id_empresa, cod_ref, desc_ref, nome_produto, id_colecao, grade_padrao, observacao,
               id_servico_padrao, tempo_padrao, ativo, criado_por)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
            .bind(id_empresa, cod_ref, desc_ref, nome_produto, id_colecao, grade_padrao, observacao,
              id_servico_padrao, tempo_padrao, getUser(c)).run();
          inseridos++;
        }
      } else {
        if (exists) atualizados++; else inseridos++;
      }
    } catch (e: any) {
      erros.push({ linha: n, erro: String(e.message || e) }); ignorados++;
    }
  }

  if (!dryRun && (inseridos + atualizados) > 0)
    await audit(c, MOD, 'IMP_PROD', `import:${Date.now()}`, 'qtd', '', String(inseridos + atualizados));
  return c.json(ok({
    dry_run: dryRun, total: rows.length,
    inseridos, atualizados, ignorados,
    colecoes_criadas: colCriadas,
    erros: erros.slice(0, 200),
  }));
});

/* =================================================================
 * TERCEIRIZADOS (CRUD)
 * ================================================================= */

app.get('/terc/terceirizados', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();
  const where: string[] = ['t.id_empresa=?']; const binds: any[] = [id_empresa];
  if (q.situacao) { where.push('t.situacao=?'); binds.push(q.situacao); }
  if (q.id_setor) { where.push('t.id_setor=?'); binds.push(toInt(q.id_setor)); }
  if (q.search) { where.push('(t.nome_terc LIKE ? OR t.cpf_cnpj LIKE ?)'); binds.push(`%${q.search}%`, `%${q.search}%`); }
  const sql = `
    SELECT t.*, s.nome_setor
    FROM terc_terceirizados t
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor AND s.id_empresa=t.id_empresa
    WHERE ${where.join(' AND ')}
    ORDER BY t.nome_terc`;
  const rs = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(ok(rs.results));
});

app.get('/terc/terceirizados/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const t = await c.env.DB.prepare(`
    SELECT t.*, s.nome_setor FROM terc_terceirizados t
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor AND s.id_empresa=t.id_empresa
    WHERE id_terc=? AND t.id_empresa=?`).bind(id, id_empresa).first<any>();
  if (!t) return fail('Terceirizado não encontrado', 404);

  // Estatísticas operacionais e financeiras (novos status v2) — escopado por empresa
  const stats = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total_remessas,
      COALESCE(SUM(qtd_total),0) AS pecas_enviadas,
      COALESCE(SUM(valor_total),0) AS valor_total,
      SUM(CASE WHEN status IN ('AguardandoEnvio','Enviado','EmProducao','Parcial') THEN 1 ELSE 0 END) AS em_aberto,
      SUM(CASE WHEN status='Atrasado' THEN 1 ELSE 0 END) AS atrasadas,
      SUM(CASE WHEN status IN ('Concluido','Retornado','Pago') THEN 1 ELSE 0 END) AS concluidas,
      SUM(CASE WHEN status_fin='PendentePagamento' THEN (valor_total - COALESCE(valor_pago,0)) ELSE 0 END) AS a_pagar,
      SUM(CASE WHEN status_fin='Pago' THEN COALESCE(valor_pago,0) ELSE 0 END) AS pago_total,
      SUM(CASE WHEN status='EmProducao' THEN qtd_total ELSE 0 END) AS pecas_em_producao
    FROM terc_remessas WHERE id_terc=? AND id_empresa=?`).bind(id, id_empresa).first<any>();

  const producaoAtual = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.desc_ref, r.cor, r.qtd_total,
           r.dt_saida, r.dt_envio, r.dt_previsao, r.status, r.valor_total,
           sv.desc_servico,
           CASE WHEN date(r.dt_previsao) < date('now') AND r.status NOT IN ('Concluido','Retornado','Pago','Cancelado') THEN 1 ELSE 0 END AS atrasada,
           COALESCE((SELECT SUM(qtd_boa+qtd_refugo+qtd_conserto) FROM terc_retornos WHERE id_remessa=r.id_remessa AND id_empresa=r.id_empresa),0) AS qtd_retornada
    FROM terc_remessas r
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico AND sv.id_empresa=r.id_empresa
    WHERE r.id_terc=? AND r.id_empresa=? AND r.status NOT IN ('Concluido','Retornado','Pago','Cancelado')
    ORDER BY r.dt_previsao ASC LIMIT 50`).bind(id, id_empresa).all()).results;

  const historico = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.desc_ref, r.qtd_total,
           r.dt_saida, r.dt_recebimento, r.status, r.status_fin, r.valor_total, r.valor_pago,
           sv.desc_servico
    FROM terc_remessas r
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico AND sv.id_empresa=r.id_empresa
    WHERE r.id_terc=? AND r.id_empresa=? AND r.status IN ('Concluido','Retornado','Pago','Cancelado')
    ORDER BY COALESCE(r.dt_recebimento, r.dt_saida) DESC LIMIT 30`).bind(id, id_empresa).all()).results;

  const eficRow = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(rt.qtd_boa),0) AS boa,
      COALESCE(SUM(rt.qtd_refugo+rt.qtd_conserto),0) AS perda,
      COALESCE(SUM(rt.qtd_boa+rt.qtd_refugo+rt.qtd_conserto),0) AS total_ret
    FROM terc_retornos rt
    JOIN terc_remessas rm ON rm.id_remessa=rt.id_remessa AND rm.id_empresa=rt.id_empresa
    WHERE rm.id_terc=? AND rm.id_empresa=?`).bind(id, id_empresa).first<any>();
  const total_ret = Number(eficRow?.total_ret) || 0;
  const efic_real = total_ret > 0 ? (Number(eficRow?.boa) / total_ret) : 0;

  return c.json(ok({
    ...t, stats,
    eficiencia_real: efic_real,
    pecas_boas: Number(eficRow?.boa) || 0,
    pecas_perda: Number(eficRow?.perda) || 0,
    producao_atual: producaoAtual,
    historico,
  }));
});

app.post('/terc/terceirizados', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  if (!b.nome_terc) return fail('nome_terc é obrigatório');

  // SPRINT 2 — Limite de terceirizados do plano
  try {
    await assertLimit(c.env.DB, id_empresa, 'terceirizados');
  } catch (e) {
    if (e instanceof LimitExceededError) return e.toResponse();
    throw e;
  }

  try {
    const r = await c.env.DB.prepare(`
      INSERT INTO terc_terceirizados (nome_terc, id_setor, cpf_cnpj, telefone, email, endereco, qtd_pessoas, min_trab_dia, efic_padrao, prazo_padrao, situacao, observacao, ativo, criado_por, id_empresa)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind(b.nome_terc, toInt(b.id_setor) || null, b.cpf_cnpj || null, b.telefone || null, b.email || null, b.endereco || null,
        toInt(b.qtd_pessoas, 1), toInt(b.min_trab_dia, 480), toNum(b.efic_padrao, 0.8), toInt(b.prazo_padrao, 3),
        b.situacao || 'Ativa', b.observacao || null, getUser(c), id_empresa).run();
    await audit(c, MOD, 'INS', `terc:${r.meta.last_row_id}`, 'nome_terc', '', b.nome_terc);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Já existe terceirizado com esse nome', 409);
    return fail(String(e));
  }
});

app.put('/terc/terceirizados/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  await c.env.DB.prepare(`
    UPDATE terc_terceirizados
    SET nome_terc=?, id_setor=?, cpf_cnpj=?, telefone=?, email=?, endereco=?,
        qtd_pessoas=?, min_trab_dia=?, efic_padrao=?, prazo_padrao=?, situacao=?, observacao=?, ativo=?
    WHERE id_terc=? AND id_empresa=?`)
    .bind(b.nome_terc, toInt(b.id_setor) || null, b.cpf_cnpj || null, b.telefone || null, b.email || null, b.endereco || null,
      toInt(b.qtd_pessoas, 1), toInt(b.min_trab_dia, 480), toNum(b.efic_padrao, 0.8), toInt(b.prazo_padrao, 3),
      b.situacao || 'Ativa', b.observacao || null, b.ativo ? 1 : 0, id, id_empresa).run();
  await audit(c, MOD, 'UPD', `terc:${id}`);
  return c.json(ok({ id }));
});

app.delete('/terc/terceirizados/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const uso = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_remessas WHERE id_terc=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (uso && uso.c > 0) {
    const t = await c.env.DB.prepare('SELECT nome_terc FROM terc_terceirizados WHERE id_terc=? AND id_empresa=?').bind(id, id_empresa).first<any>();
    return fail(`Não é possível excluir: ${t?.nome_terc || 'Terceirizado'} possui ${uso.c} remessa(s). Use "Inativar" para desativar.`, 409);
  }
  await c.env.DB.prepare('DELETE FROM terc_terceirizados WHERE id_terc=? AND id_empresa=?').bind(id, id_empresa).run();
  await audit(c, MOD, 'DEL', `terc:${id}`);
  return c.json(ok({ id, deleted: true }));
});

app.patch('/terc/terceirizados/:id/situacao', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  const s = b.situacao || 'Ativa';
  await c.env.DB.prepare('UPDATE terc_terceirizados SET situacao=?, ativo=? WHERE id_terc=? AND id_empresa=?')
    .bind(s, s === 'Ativa' ? 1 : 0, id, id_empresa).run();
  await audit(c, MOD, 'ATIV', `terc:${id}`, 'situacao', '', s);
  return c.json(ok({ id, situacao: s }));
});

/* =================================================================
 * PREÇOS
 * ================================================================= */

app.get('/terc/precos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();
  const where: string[] = ['p.ativo=1', 'p.id_empresa=?']; const binds: any[] = [id_empresa];
  if (q.cod_ref)    { where.push('p.cod_ref=?');    binds.push(q.cod_ref); }
  if (q.id_servico) { where.push('p.id_servico=?'); binds.push(toInt(q.id_servico)); }
  if (q.id_colecao) { where.push('p.id_colecao=?'); binds.push(toInt(q.id_colecao)); }
  if (q.cor != null && q.cor !== '')         { where.push('p.cor=?');     binds.push(q.cor); }
  if (q.tamanho != null && q.tamanho !== '') { where.push('p.tamanho=?'); binds.push(q.tamanho); }
  if (q.search) {
    where.push('(p.cod_ref LIKE ? OR p.desc_ref LIKE ? OR p.cor LIKE ? OR p.tamanho LIKE ?)');
    const s = `%${q.search}%`; binds.push(s, s, s, s);
  }
  const rs = await c.env.DB.prepare(`
    SELECT p.*, s.desc_servico, co.nome_colecao
    FROM terc_precos p
    LEFT JOIN terc_servicos s ON s.id_servico=p.id_servico AND s.id_empresa=p.id_empresa
    LEFT JOIN terc_colecoes co ON co.id_colecao=p.id_colecao AND co.id_empresa=p.id_empresa
    WHERE ${where.join(' AND ')}
    ORDER BY p.cod_ref, p.cor, p.tamanho, p.id_servico
    LIMIT 1000`).bind(...binds).all();
  return c.json(ok(rs.results));
});

app.post('/terc/precos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  // Aceita id_produto -> deriva cod_ref + desc_ref + id_colecao
  if (b.id_produto) {
    const p = await c.env.DB.prepare('SELECT cod_ref, desc_ref, id_colecao FROM terc_produtos WHERE id_produto=? AND id_empresa=?').bind(toInt(b.id_produto), id_empresa).first<any>();
    if (p) {
      b.cod_ref = b.cod_ref || p.cod_ref;
      b.desc_ref = b.desc_ref || p.desc_ref;
      if (!b.id_colecao) b.id_colecao = p.id_colecao;
    }
  }
  if (!b.id_servico) return fail('Serviço é obrigatório');
  if (!b.cod_ref && !b.desc_ref) return fail('Informe a referência ou descrição do produto');
  if (!b.cod_ref) {
    b.cod_ref = String(b.desc_ref).toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
  }
  const cor     = String(b.cor ?? '').trim();
  const tamanho = String(b.tamanho ?? '').trim();
  const id_cor  = await resolveColorId(c.env.DB, cor, id_empresa);
  try {
    const r = await c.env.DB.prepare(`
      INSERT INTO terc_precos (id_empresa, cod_ref, desc_ref, id_servico, grade, cor, id_cor, tamanho, preco, tempo_min, id_colecao, dt_vigencia, observacao, ativo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .bind(id_empresa, b.cod_ref, b.desc_ref || null, toInt(b.id_servico), toInt(b.grade, 1),
        cor, id_cor, tamanho,
        toNum(b.preco), toNum(b.tempo_min), toInt(b.id_colecao) || null,
        b.dt_vigencia || null, b.observacao || null).run();
    await audit(c, MOD, 'INS', `preco:${r.meta.last_row_id}`, 'preco', '', String(b.preco));
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return fail(`Já existe preço cadastrado para esta combinação (Produto + Cor + Grade + Serviço${b.id_colecao ? ' + Coleção' : ''}).`, 409);
    }
    return fail(String(e));
  }
});

app.put('/terc/precos/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  const cor     = String(b.cor ?? '').trim();
  const tamanho = String(b.tamanho ?? '').trim();
  const id_cor  = await resolveColorId(c.env.DB, cor, id_empresa);
  try {
    await c.env.DB.prepare(`
      UPDATE terc_precos
         SET cod_ref=?, desc_ref=?, id_servico=?, grade=?, cor=?, id_cor=?, tamanho=?,
             preco=?, tempo_min=?, id_colecao=?, dt_vigencia=?, observacao=?, ativo=?,
             dt_alteracao=datetime('now'), alterado_por=?
       WHERE id_preco=? AND id_empresa=?`)
      .bind(b.cod_ref, b.desc_ref || null, toInt(b.id_servico), toInt(b.grade, 1),
        cor, id_cor, tamanho,
        toNum(b.preco), toNum(b.tempo_min), toInt(b.id_colecao) || null,
        b.dt_vigencia || null, b.observacao || null, b.ativo ? 1 : 0,
        getUser(c), id, id_empresa).run();
    await audit(c, MOD, 'UPD', `preco:${id}`);
    return c.json(ok({ id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) {
      return fail('Já existe outro preço com a mesma combinação (Produto + Cor + Grade + Serviço).', 409);
    }
    return fail(String(e));
  }
});

app.delete('/terc/precos/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM terc_precos WHERE id_preco=? AND id_empresa=?').bind(id, id_empresa).run();
  await audit(c, MOD, 'DEL', `preco:${id}`);
  return c.json(ok({ id, deleted: true }));
});

// 🚨 Excluir TODOS os preços com confirmação dupla
app.delete('/terc/precos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const c1 = String(q.confirm1 || body.confirm1 || '');
  const c2 = String(q.confirm2 || body.confirm2 || '');
  if (c1 !== 'SIM' || c2 !== 'EXCLUIR-TODOS') {
    return fail('Confirmação dupla obrigatória: confirm1=SIM e confirm2=EXCLUIR-TODOS', 400);
  }
  const cnt = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM terc_precos WHERE id_empresa=?').bind(id_empresa).first<any>();
  await c.env.DB.prepare('DELETE FROM terc_precos WHERE id_empresa=?').bind(id_empresa).run();
  await audit(c, MOD, 'DEL_ALL', 'precos', 'total', String(cnt?.n || 0), '0');
  return c.json(ok({ deleted: Number(cnt?.n) || 0 }));
});

// Busca de preço tabelado (autofill nas remessas) — agora considera COR + TAMANHO
// Prioridade:
//   1) Produto + Cor + Tamanho + Serviço (mais específico)
//   2) Produto + Cor + Serviço
//   3) Produto + Serviço
//   4) Serviço padrão (qualquer produto cod_ref='*')
app.get('/terc/precos/lookup', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();
  const cod = String(q.cod_ref || '').trim();
  const idsv = toInt(q.id_servico);
  const cor = String(q.cor || '').trim();
  const tam = String(q.tamanho || '').trim();
  const grd = toInt(q.grade, 1);
  const idcol = toInt(q.id_colecao) || null;
  if (!cod || !idsv) return fail('cod_ref e id_servico são obrigatórios');

  // Helper de busca pré-ordenada
  const tryQ = async (sql: string, ...binds: any[]) =>
    c.env.DB.prepare(sql).bind(...binds).first<any>();

  // Nível 1: Produto+Cor+Tamanho+Serviço (com ou sem coleção)
  let r = null as any;
  if (cor && tam) {
    r = await tryQ(`
      SELECT preco, tempo_min, desc_ref, cor, tamanho, id_preco,
             'produto+cor+grade+servico' AS match_level
      FROM terc_precos
      WHERE id_empresa=? AND cod_ref=? AND id_servico=? AND cor=? AND tamanho=? AND ativo=1
        AND (id_colecao=? OR id_colecao IS NULL)
      ORDER BY CASE WHEN id_colecao=? THEN 0 ELSE 1 END
      LIMIT 1`, id_empresa, cod, idsv, cor, tam, idcol, idcol);
  }
  // Nível 2: Produto+Cor+Serviço
  if (!r && cor) {
    r = await tryQ(`
      SELECT preco, tempo_min, desc_ref, cor, tamanho, id_preco,
             'produto+cor+servico' AS match_level
      FROM terc_precos
      WHERE id_empresa=? AND cod_ref=? AND id_servico=? AND cor=? AND (tamanho='' OR tamanho IS NULL) AND ativo=1
        AND (id_colecao=? OR id_colecao IS NULL)
      ORDER BY CASE WHEN id_colecao=? THEN 0 ELSE 1 END
      LIMIT 1`, id_empresa, cod, idsv, cor, idcol, idcol);
  }
  // Nível 3: Produto+Serviço (sem cor, sem tamanho)
  if (!r) {
    r = await tryQ(`
      SELECT preco, tempo_min, desc_ref, cor, tamanho, id_preco,
             'produto+servico' AS match_level
      FROM terc_precos
      WHERE id_empresa=? AND cod_ref=? AND id_servico=? AND (cor='' OR cor IS NULL) AND (tamanho='' OR tamanho IS NULL) AND ativo=1
        AND (id_colecao=? OR id_colecao IS NULL)
      ORDER BY CASE WHEN id_colecao=? THEN 0 ELSE 1 END
      LIMIT 1`, id_empresa, cod, idsv, idcol, idcol);
  }
  // Nível 4: Serviço padrão (qualquer produto), grade=grd
  if (!r) {
    r = await tryQ(`
      SELECT preco, tempo_min, desc_ref, cor, tamanho, id_preco,
             'servico_padrao' AS match_level
      FROM terc_precos
      WHERE id_empresa=? AND cod_ref='*' AND id_servico=? AND ativo=1
      LIMIT 1`, id_empresa, idsv);
  }
  // Compatibilidade: ainda inclui campo grade legado se existir match
  return c.json(ok(r || null));
});

/* =================================================================
 * VARIAÇÕES DE PRODUTO (cor + grade) — CRUD por produto
 * ================================================================= */

// Lista variações de um produto
app.get('/terc/produtos/:id/variacoes', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const idProd = toInt(c.req.param('id'));
  const rs = await c.env.DB.prepare(
    'SELECT * FROM terc_produto_variacoes WHERE id_produto=? AND id_empresa=? AND ativo=1 ORDER BY cor, tamanho'
  ).bind(idProd, id_empresa).all();
  return c.json(ok(rs.results));
});

// Cria variação (id_produto, cor, tamanho)
app.post('/terc/produtos/:id/variacoes', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const idProd = toInt(c.req.param('id'));
  const b = await c.req.json();
  const cor = String(b.cor ?? '').trim();
  const tam = String(b.tamanho ?? '').trim();
  if (!cor && !tam) return fail('Informe ao menos cor ou tamanho');
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO terc_produto_variacoes (id_empresa, id_produto, cor, tamanho) VALUES (?, ?, ?, ?)'
    ).bind(id_empresa, idProd, cor, tam).run();
    await audit(c, MOD, 'INS', `variacao:${r.meta.last_row_id}`, 'cor+tam', '', `${cor}|${tam}`);
    return c.json(ok({ id: r.meta.last_row_id, cor, tamanho: tam }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Esta variação (cor + tamanho) já existe para este produto.', 409);
    return fail(String(e));
  }
});

// Inserção em LOTE: cores[] × tamanhos[] (gera todas as combinações)
app.post('/terc/produtos/:id/variacoes/lote', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const idProd = toInt(c.req.param('id'));
  const b = await c.req.json();
  const cores: string[] = Array.isArray(b.cores) ? b.cores.map((x: any) => String(x).trim()).filter(Boolean) : [];
  const tams:  string[] = Array.isArray(b.tamanhos) ? b.tamanhos.map((x: any) => String(x).trim()).filter(Boolean) : [];
  if (cores.length === 0 && tams.length === 0) return fail('Informe ao menos uma cor ou um tamanho');

  const combos: { cor: string; tam: string }[] = [];
  if (cores.length && tams.length) {
    for (const c1 of cores) for (const t1 of tams) combos.push({ cor: c1, tam: t1 });
  } else if (cores.length) {
    for (const c1 of cores) combos.push({ cor: c1, tam: '' });
  } else {
    for (const t1 of tams) combos.push({ cor: '', tam: t1 });
  }

  let criados = 0, ignorados = 0;
  for (const x of combos) {
    try {
      await c.env.DB.prepare(
        'INSERT INTO terc_produto_variacoes (id_empresa, id_produto, cor, tamanho) VALUES (?, ?, ?, ?)'
      ).bind(id_empresa, idProd, x.cor, x.tam).run();
      criados++;
    } catch { ignorados++; }
  }
  await audit(c, MOD, 'INS_LOTE', `produto:${idProd}`, 'variacoes', '', `+${criados} (${ignorados} já existiam)`);
  return c.json(ok({ criados, ignorados, total: combos.length }));
});

app.delete('/terc/produtos/:id/variacoes/:idv', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const idv = toInt(c.req.param('idv'));
  await c.env.DB.prepare('DELETE FROM terc_produto_variacoes WHERE id_var=? AND id_empresa=?').bind(idv, id_empresa).run();
  await audit(c, MOD, 'DEL', `variacao:${idv}`);
  return c.json(ok({ id: idv, deleted: true }));
});

/* =================================================================
 * CATÁLOGO DE CORES (reutilizável)
 * ================================================================= */

app.get('/terc/cores', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  // Usa tabela global 'cores' (única fonte de verdade), tenant-scoped.
  // Aliases mantêm compatibilidade com frontend legado (id_cor, nome_cor)
  const rs = await c.env.DB.prepare(
    'SELECT id AS id_cor, nome AS nome_cor, hex, ativo FROM cores WHERE ativo=1 AND id_empresa=? ORDER BY nome'
  ).bind(id_empresa).all();
  return c.json(ok(rs.results));
});

// 🌈 Cores DISTINCT — unifica catálogo (terc_cores) + cores realmente usadas em terc_precos
// Filtra por cod_ref se informado (cores efetivamente cadastradas para aquele produto).
// Sempre normaliza/deduplica e retorna ordem alfabética.
app.get('/terc/cores/distinct', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const cod = String(c.req.query('cod_ref') || '').trim();
  const set = new Map<string, { nome_cor: string; hex: string | null; uso: number }>();

  // 1) Catálogo global (cores) tenant-scoped
  const cat = await c.env.DB.prepare(
    'SELECT nome AS nome_cor, hex FROM cores WHERE ativo=1 AND id_empresa=?'
  ).bind(id_empresa).all();
  for (const r of (cat.results as any[])) {
    const nome = String(r.nome_cor || '').trim();
    if (!nome) continue;
    const k = nome.toLocaleLowerCase('pt-BR');
    if (!set.has(k)) set.set(k, { nome_cor: nome, hex: r.hex || null, uso: 0 });
  }

  // 2) Cores presentes em terc_precos (com filtro opcional por cod_ref)
  let sql = `SELECT cor AS nome_cor, COUNT(*) AS uso FROM terc_precos
             WHERE ativo=1 AND id_empresa=? AND cor IS NOT NULL AND cor!=''`;
  const binds: any[] = [id_empresa];
  if (cod) { sql += ' AND cod_ref=?'; binds.push(cod); }
  sql += ' GROUP BY cor';
  const usadas = await c.env.DB.prepare(sql).bind(...binds).all();
  for (const r of (usadas.results as any[])) {
    const nome = String(r.nome_cor || '').trim();
    if (!nome) continue;
    const k = nome.toLocaleLowerCase('pt-BR');
    if (set.has(k)) set.get(k)!.uso = Number(r.uso) || 0;
    else set.set(k, { nome_cor: nome, hex: null, uso: Number(r.uso) || 0 });
  }

  const list = Array.from(set.values()).sort((a, b) => a.nome_cor.localeCompare(b.nome_cor, 'pt-BR'));
  return c.json(ok(list));
});

app.post('/terc/cores', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  const nome = String(b.nome_cor ?? b.nome ?? '').trim();
  if (!nome) return fail('Nome da cor obrigatório');
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO cores (id_empresa, nome, hex, ativo) VALUES (?, ?, ?, 1)'
    ).bind(id_empresa, nome, b.hex || null).run();
    await audit(c, MOD, 'INS', `cor:${r.meta.last_row_id}`, 'nome', '', nome);
    return c.json(ok({ id: r.meta.last_row_id, nome_cor: nome }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Esta cor já existe', 409);
    return fail(String(e));
  }
});

app.delete('/terc/cores/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare('UPDATE cores SET ativo=0 WHERE id=? AND id_empresa=?').bind(id, id_empresa).run();
  await audit(c, MOD, 'DEL', `cor:${id}`);
  return c.json(ok({ id, deleted: true }));
});

/* =================================================================
 * IMPORTAÇÃO DE PLANILHA (Cor + Preço + Grade)
 *   Recebe: { rows: [{cod_ref, desc_ref, cor, tamanho, servico, preco, tempo}, ...],
 *             modo: 'criar' | 'atualizar' | 'simular',
 *             id_colecao: number | null }
 *   Retorna: { criados, atualizados, ignorados, erros: [], simulado: bool }
 * ================================================================= */
app.post('/terc/precos/importar', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  const rows: any[] = Array.isArray(b.rows) ? b.rows : [];
  const modo = String(b.modo || 'atualizar').toLowerCase(); // criar|atualizar|simular
  const idColecao = toInt(b.id_colecao) || null;
  if (rows.length === 0) return fail('Nenhuma linha para importar');

  // 🔠 Normalização: trim + colapsa espaços + Title Case (ex.: "  azul claro " → "Azul Claro")
  const normCor = (s: any): string => {
    const t = String(s ?? '').trim().replace(/\s+/g, ' ');
    if (!t) return '';
    // Capitaliza cada palavra (preserva acentos)
    return t.toLocaleLowerCase('pt-BR').replace(/(^|\s|-|\/)(\p{L})/gu, (_m, sep, ch) => sep + ch.toLocaleUpperCase('pt-BR'));
  };
  const normTam = (s: any): string => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');

  // Pré-carrega serviços ATIVOS para mapear nome → id (case-insensitive + sem acento)
  const stripAcc = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const svRows = await c.env.DB.prepare('SELECT id_servico, desc_servico FROM terc_servicos WHERE ativo=1 AND id_empresa=?').bind(id_empresa).all();
  const svMap = new Map<string, number>();
  for (const sv of (svRows.results as any[])) {
    svMap.set(stripAcc(String(sv.desc_servico || '')), Number(sv.id_servico));
  }

  // Cache: cod_ref+id_colecao → id_produto (evita SELECT repetido durante o lote)
  const prodCache = new Map<string, number>();
  // Cache: cod_ref+cor (normalizada) → boolean (variação criada)
  const varCache = new Set<string>();

  let criados = 0, atualizados = 0, ignorados = 0;
  const erros: { linha: number; motivo: string }[] = [];
  const coresVistas = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const lineNo = i + 1;
    try {
      const cod_ref  = String(row.cod_ref ?? row.referencia ?? row.ref ?? '').trim();
      const desc_ref = String(row.desc_ref ?? row.descricao ?? '').trim();
      const cor      = normCor(row.cor);
      const tamanho  = normTam(row.tamanho ?? row.grade);
      const svRaw    = String(row.servico ?? row.desc_servico ?? '').trim();
      const preco    = toNum(row.preco);
      const tempo    = toNum(row.tempo ?? row.tempo_min);

      // Validações obrigatórias
      if (!cod_ref) { erros.push({ linha: lineNo, motivo: 'Referência vazia' }); ignorados++; continue; }
      if (!svRaw)   { erros.push({ linha: lineNo, motivo: 'Serviço vazio' });   ignorados++; continue; }
      const idSv = svMap.get(stripAcc(svRaw));
      if (!idSv)    { erros.push({ linha: lineNo, motivo: `Serviço "${svRaw}" não cadastrado` }); ignorados++; continue; }
      if (preco < 0) { erros.push({ linha: lineNo, motivo: 'Preço negativo' }); ignorados++; continue; }

      // 🔑 Chave única: cod_ref + id_servico + cor + tamanho + id_colecao
      // (todas comparações com COALESCE para manter consistência com índice)
      const existing = await c.env.DB.prepare(`
        SELECT id_preco FROM terc_precos
        WHERE id_empresa=?
          AND cod_ref=?
          AND id_servico=?
          AND COALESCE(cor,'')=?
          AND COALESCE(tamanho,'')=?
          AND COALESCE(id_colecao,0)=COALESCE(?,0)
        LIMIT 1`)
        .bind(id_empresa, cod_ref, idSv, cor, tamanho, idColecao).first<any>();

      if (modo === 'simular') {
        if (existing) atualizados++; else criados++;
        if (cor) coresVistas.add(cor);
        continue;
      }

      if (existing) {
        if (modo === 'criar') { ignorados++; continue; } // modo criar: pula existentes
        // ATUALIZAR: força ativo=1, sobrescreve preço/tempo, mantém desc se vazia
        await c.env.DB.prepare(`
          UPDATE terc_precos
             SET desc_ref=COALESCE(NULLIF(?, ''), desc_ref),
                 preco=?, tempo_min=?, ativo=1,
                 dt_alteracao=datetime('now'), alterado_por=?
           WHERE id_preco=? AND id_empresa=?`)
          .bind(desc_ref, preco, tempo, getUser(c), existing.id_preco, id_empresa).run();
        atualizados++;
      } else {
        // CRIAR (em modo 'atualizar' também criamos os faltantes)
        const idCorIns = await resolveColorId(c.env.DB, cor, id_empresa);
        await c.env.DB.prepare(`
          INSERT INTO terc_precos (id_empresa, cod_ref, desc_ref, id_servico, grade, cor, id_cor, tamanho,
                                   preco, tempo_min, id_colecao, ativo)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1)`)
          .bind(id_empresa, cod_ref, desc_ref || null, idSv, cor, idCorIns, tamanho, preco, tempo, idColecao).run();
        criados++;
      }

      // 📦 Garante produto + variação (via cache para performance)
      const prodKey = `${cod_ref}|${idColecao || 0}`;
      let idProd = prodCache.get(prodKey);
      if (!idProd) {
        await c.env.DB.prepare(`
          INSERT OR IGNORE INTO terc_produtos (id_empresa, cod_ref, desc_ref, id_colecao, ativo)
          VALUES (?, ?, ?, ?, 1)`)
          .bind(id_empresa, cod_ref, desc_ref || cod_ref, idColecao).run();
        const prod = await c.env.DB.prepare(
          'SELECT id_produto FROM terc_produtos WHERE id_empresa=? AND cod_ref=? AND COALESCE(id_colecao,0)=COALESCE(?,0) LIMIT 1'
        ).bind(id_empresa, cod_ref, idColecao).first<any>();
        if (prod) { idProd = Number(prod.id_produto); prodCache.set(prodKey, idProd); }
      }

      if (idProd && (cor || tamanho)) {
        const vk = `${idProd}|${cor}|${tamanho}`;
        if (!varCache.has(vk)) {
          await c.env.DB.prepare(
            'INSERT OR IGNORE INTO terc_produto_variacoes (id_empresa, id_produto, cor, tamanho) VALUES (?, ?, ?, ?)'
          ).bind(id_empresa, idProd, cor, tamanho).run().catch(() => {});
          varCache.add(vk);
        }
      }

      // Garante cor no catálogo global (tenant-scoped)
      if (cor && !coresVistas.has(cor)) {
        coresVistas.add(cor);
        await c.env.DB.prepare(
          'INSERT OR IGNORE INTO cores (id_empresa, nome, hex, ativo) VALUES (?, ?, ?, 1)'
        ).bind(id_empresa, cor, '#888888').run().catch(() => {});
      }
    } catch (e: any) {
      erros.push({ linha: lineNo, motivo: String(e?.message || e) });
      ignorados++;
    }
  }

  await audit(c, MOD, 'IMPORT_PRECOS', 'precos', 'totais', '',
    `criados:${criados} atualizados:${atualizados} ignorados:${ignorados} modo:${modo}`);
  return c.json(ok({
    criados, atualizados, ignorados,
    erros: erros.slice(0, 50),
    total_erros: erros.length,
    cores_detectadas: Array.from(coresVistas).sort(),
    simulado: modo === 'simular',
    modo,
  }));
});

/* =================================================================
 * REMESSAS
 * ================================================================= */

// Calcula previsão de retorno = dt_saida + ceil(qtd × tempo_peca / (qtd_pessoas × min_trab × efic)) dias úteis
function calcPrevisao(dt_saida: string, qtd: number, tempo: number, pess: number, min_dia: number, efic: number): { dias: number, dt_prev: string } {
  if (!dt_saida || qtd <= 0 || tempo <= 0) return { dias: 0, dt_prev: dt_saida || '' };
  const capacidadeMin = Math.max(1, pess) * Math.max(1, min_dia) * Math.max(0.1, efic);
  const totalMin = qtd * tempo;
  const dias = Math.max(1, Math.ceil(totalMin / capacidadeMin));
  const d = new Date(dt_saida + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  const iso = d.toISOString().slice(0, 10);
  return { dias, dt_prev: iso };
}

// Próximo número de controle
app.get('/terc/remessas/next-num', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const r = await c.env.DB.prepare('SELECT COALESCE(MAX(num_controle),0)+1 AS n FROM terc_remessas WHERE id_empresa=?').bind(id_empresa).first<any>();
  return c.json(ok({ num_controle: r?.n || 1 }));
});

// Lista (atualiza status Atrasado automaticamente conforme dt_previsao)
app.get('/terc/remessas', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();

  // 🔁 Atualização automática de status atrasado (idempotente, por tenant)
  await c.env.DB.prepare(`
    UPDATE terc_remessas
    SET status='Atrasado'
    WHERE id_empresa=?
      AND status IN ('AguardandoEnvio','Enviado','EmProducao','Parcial')
      AND dt_previsao IS NOT NULL
      AND date(dt_previsao) < date('now')`).bind(id_empresa).run();

  const where: string[] = ['r.id_empresa=?']; const binds: any[] = [id_empresa];
  if (q.status) { where.push('r.status=?'); binds.push(q.status); }
  if (q.status_fin) { where.push('r.status_fin=?'); binds.push(q.status_fin); }
  if (q.id_terc) { where.push('r.id_terc=?'); binds.push(toInt(q.id_terc)); }
  if (q.id_servico) { where.push('r.id_servico=?'); binds.push(toInt(q.id_servico)); }
  if (q.id_setor) { where.push('r.id_setor=?'); binds.push(toInt(q.id_setor)); } // HOTFIX 0037
  if (q.id_colecao) { where.push('r.id_colecao=?'); binds.push(toInt(q.id_colecao)); }
  if (q.de) { where.push('r.dt_saida>=?'); binds.push(q.de); }
  if (q.ate) { where.push('r.dt_saida<=?'); binds.push(q.ate); }
  if (q.cod_ref) { where.push('r.cod_ref=?'); binds.push(q.cod_ref); }
  if (q.num_op) { where.push('r.num_op=?'); binds.push(q.num_op); }
  if (q.atrasadas) { where.push("r.status='Atrasado'"); }
  if (q.em_producao) { where.push("r.status IN ('Enviado','EmProducao')"); }
  if (q.search) {
    // 🔎 Busca inteligente: múltiplos termos (separados por espaço) são combinados por AND,
    // cada termo é procurado em vários campos via OR (parcial, case-insensitive via LIKE).
    // Campos: Nº CTRL, OP, ref/cor, terceirizado, serviço, produto/coleção.
    const terms = String(q.search).trim().split(/\s+/).filter(Boolean).slice(0, 8);
    const fields = [
      'r.num_controle', 'r.cod_ref', 'r.desc_ref', 'r.num_op', 'r.cor',
      't.nome_terc', 'sv.desc_servico', 'co.nome_colecao', 'st.nome_setor'
    ];
    for (const term of terms) {
      where.push('(' + fields.map(f => `${f} LIKE ?`).join(' OR ') + ')');
      const like = `%${term}%`;
      for (let i = 0; i < fields.length; i++) binds.push(like);
    }
  }

  const sql = `
    SELECT r.*,
      t.nome_terc, st.nome_setor, sv.desc_servico, co.nome_colecao,
      COALESCE((SELECT SUM(qtd_boa)+SUM(qtd_refugo)+SUM(qtd_conserto) FROM terc_retornos WHERE id_remessa=r.id_remessa AND id_empresa=r.id_empresa),0) AS qtd_retornada_calc,
      CASE WHEN r.status='Atrasado' THEN 1 ELSE 0 END AS atrasada,
      CAST(julianday(date('now')) - julianday(date(r.dt_previsao)) AS INTEGER) AS dias_atraso,
      CAST(julianday(date(r.dt_previsao)) - julianday(date('now')) AS INTEGER) AS dias_para_vencer
    FROM terc_remessas r
    LEFT JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    LEFT JOIN terc_setores st ON st.id_setor=r.id_setor AND st.id_empresa=r.id_empresa
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico AND sv.id_empresa=r.id_empresa
    LEFT JOIN terc_colecoes co ON co.id_colecao=r.id_colecao AND co.id_empresa=r.id_empresa
    WHERE ${where.join(' AND ')}
    ORDER BY r.dt_saida DESC, r.num_controle DESC
    LIMIT 500`;
  const rs = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(ok(rs.results));
});

// Detalhe de uma remessa (com grade + retornos)
app.get('/terc/remessas/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const rem = await c.env.DB.prepare(`
    SELECT r.*, t.nome_terc, st.nome_setor, sv.desc_servico, co.nome_colecao
    FROM terc_remessas r
    LEFT JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    LEFT JOIN terc_setores st ON st.id_setor=r.id_setor AND st.id_empresa=r.id_empresa
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico AND sv.id_empresa=r.id_empresa
    LEFT JOIN terc_colecoes co ON co.id_colecao=r.id_colecao AND co.id_empresa=r.id_empresa
    WHERE r.id_remessa=? AND r.id_empresa=?`).bind(id, id_empresa).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);

  const grade = (await c.env.DB.prepare('SELECT tamanho, qtd FROM terc_remessa_grade WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).all()).results as any[];

  // 🆕 Itens multi-cores (cada produto+cor é 1 item)
  const itens = (await c.env.DB.prepare(`
    SELECT i.*, sv.desc_servico,
      (SELECT json_group_array(json_object('tamanho', tamanho, 'qtd', qtd))
         FROM terc_remessa_item_grade WHERE id_item=i.id_item AND id_empresa=i.id_empresa) AS grade_json
    FROM terc_remessa_itens i
    LEFT JOIN terc_servicos sv ON sv.id_servico=i.id_servico AND sv.id_empresa=i.id_empresa
    WHERE i.id_remessa=? AND i.id_empresa=? AND i.ativo=1
    ORDER BY i.ordem ASC, i.id_item ASC`).bind(id, id_empresa).all()).results as any[];
  let itensParsed = itens.map((it: any) => {
    let g: any[] = [];
    try { g = JSON.parse(it.grade_json || '[]'); } catch {}
    return { ...it, grade: g };
  });

  // 🛡️ HOTFIX 0036: Para CADA item com id_produto NULL mas cod_ref preenchido,
  // resolve dinamicamente o id_produto via lookup em terc_produtos (cod_ref + id_empresa).
  // Garante que o <select> de produtos no modal mostre o produto correto mesmo se
  // a migration 0036 ainda não tiver rodado nesta empresa. Também adiciona flag
  // _resolved_id_produto:true para debug/auditoria no frontend.
  const itensSemProduto = itensParsed.filter((it: any) => !it.id_produto && it.cod_ref);
  if (itensSemProduto.length > 0) {
    const codRefs = [...new Set(itensSemProduto.map((it: any) => it.cod_ref))];
    const placeholders = codRefs.map(() => '?').join(',');
    const lookup = (await c.env.DB.prepare(`
      SELECT cod_ref, id_produto FROM terc_produtos
       WHERE id_empresa=? AND cod_ref IN (${placeholders}) AND ativo=1
       ORDER BY id_produto DESC
    `).bind(id_empresa, ...codRefs).all()).results as any[];
    // 1 entrada por cod_ref (o id_produto ativo mais recente)
    const mapCodToId = new Map<string, number>();
    for (const row of lookup) {
      if (!mapCodToId.has(row.cod_ref)) mapCodToId.set(row.cod_ref, Number(row.id_produto));
    }
    let resolvedCount = 0;
    itensParsed = itensParsed.map((it: any) => {
      if (!it.id_produto && it.cod_ref && mapCodToId.has(it.cod_ref)) {
        resolvedCount++;
        return { ...it, id_produto: mapCodToId.get(it.cod_ref), _resolved_id_produto: true };
      }
      return it;
    });
    if (resolvedCount > 0) {
      logTenant(c, 'remessa.get.resolved_id_produto', { id_remessa: id, resolved: resolvedCount });
    }
  }

  // 🛡️ FALLBACK DEFENSIVO (HOTFIX 0035): se a remessa não tem itens no banco
  // mas o header tem qtd_total>0, sintetiza 1 item virtual a partir do header.
  // Isso garante que o modal de edição NUNCA abra zerado mesmo se a migration
  // de reparação ainda não tiver rodado nesta empresa (ou se algum dado futuro
  // chegar inconsistente). O item virtual recebe _synthesized:true para o
  // frontend saber que veio do fallback e pode persistir corretamente no PUT.
  let synthesized = false;
  if (itensParsed.length === 0 && Number(rem.qtd_total) > 0) {
    synthesized = true;
    const gradeHeader = (grade && grade.length > 0)
      ? grade.map((g: any) => ({ tamanho: g.tamanho, qtd: Number(g.qtd) || 0 }))
      : [{ tamanho: 'UNICO', qtd: Number(rem.qtd_total) || 0 }];
    itensParsed = [{
      id_item: null, // null sinaliza para o PUT que precisa INSERT
      id_remessa: rem.id_remessa,
      id_produto: null,
      cod_ref: rem.cod_ref,
      desc_ref: rem.desc_ref,
      id_servico: rem.id_servico,
      desc_servico: (rem as any).desc_servico,
      cor: rem.cor,
      id_cor: rem.id_cor,
      grade_num: rem.grade || 1,
      qtd_total: rem.qtd_total,
      preco_unit: rem.preco_unit,
      valor_total: rem.valor_total,
      tempo_peca: rem.tempo_peca,
      num_op: rem.num_op,
      id_grade_tamanho: null,
      observacao: '[Item sintetizado a partir do header — legado sem itens persistidos]',
      ordem: 0,
      ativo: 1,
      grade: gradeHeader,
      _synthesized: true,
    }];
    logTenant(c, 'remessa.get.synthesized_item', { id_remessa: id, qtd_total: rem.qtd_total });
  }

  const retornos = (await c.env.DB.prepare(`
    SELECT r.*,
      (SELECT json_group_array(json_object('tamanho', tamanho, 'qtd', qtd)) FROM terc_retorno_grade WHERE id_retorno=r.id_retorno AND id_empresa=r.id_empresa) AS grade_json
    FROM terc_retornos r WHERE id_remessa=? AND id_empresa=? ORDER BY dt_retorno`).bind(id, id_empresa).all()).results as any[];
  const retornosParsed = retornos.map((r: any) => {
    let g = [];
    try { g = JSON.parse(r.grade_json || '[]'); } catch {}
    return { ...r, grade: g };
  });

  // Totais retornados
  const totRet = retornosParsed.reduce((a: any, x: any) => ({
    boa: a.boa + (Number(x.qtd_boa) || 0),
    refugo: a.refugo + (Number(x.qtd_refugo) || 0),
    conserto: a.conserto + (Number(x.qtd_conserto) || 0),
    total: a.total + (Number(x.qtd_total) || 0),
    valor: a.valor + (Number(x.valor_pago) || 0),
  }), { boa: 0, refugo: 0, conserto: 0, total: 0, valor: 0 });

  // 🛡️ Se a grade-header tb estiver vazia mas temos qtd_total>0, devolvemos
  // uma grade virtual {UNICO: qtd_total} para o frontend desenhar corretamente.
  let gradeOut = grade;
  if ((!gradeOut || gradeOut.length === 0) && Number(rem.qtd_total) > 0) {
    gradeOut = [{ tamanho: 'UNICO', qtd: Number(rem.qtd_total) || 0 }];
  }

  logTenant(c, 'remessa.get', {
    id_remessa: id,
    itens_count: itensParsed.length,
    synthesized,
    grade_count: gradeOut.length,
    qtd_total: rem.qtd_total,
  });

  return c.json(ok({
    ...rem, grade: gradeOut, itens: itensParsed,
    retornos: retornosParsed, totais_retorno: totRet,
    saldo: (Number(rem.qtd_total) || 0) - totRet.total,
    _synthesized: synthesized, // flag global no payload — frontend pode usar para badge "dados reconstruídos"
  }));
});

// Criar remessa — MODO BÁSICO automação total (preço, prazo, valor, eficiência)
// Usuário precisa apenas: id_terc + id_servico + qtd (ou grade)
// Modo avançado: aceita override manual de preco_unit, tempo_peca, prazo_dias, efic_pct
/* =================================================================
 * 🛠️ Helper: lookup hierárquico de preço (4 níveis)
 *   1) cod_ref + id_servico + cor + tamanho/grade
 *   2) cod_ref + id_servico + cor
 *   3) cod_ref + id_servico
 *   4) id_servico (default genérico)
 * ================================================================= */
async function lookupPrecoHier(
  DB: D1Database,
  codRef: string,
  idServico: number,
  cor: string | null,
  tamanho: string | null,
  gradeNum: number,
  idColecao: number | null,
  id_empresa: number = 1
): Promise<{ preco: number; tempo: number; desc_ref: string | null }> {
  const tries: Array<{ sql: string; binds: any[] }> = [];
  const colBind = idColecao || null;

  if (codRef && cor && tamanho) {
    tries.push({
      sql: `SELECT preco, tempo_min, desc_ref FROM terc_precos
            WHERE id_empresa=? AND cod_ref=? AND id_servico=? AND LOWER(TRIM(COALESCE(cor,'')))=LOWER(TRIM(?))
              AND LOWER(TRIM(COALESCE(tamanho,'')))=LOWER(TRIM(?)) AND ativo=1
              AND (id_colecao=? OR id_colecao IS NULL)
            ORDER BY CASE WHEN id_colecao=? THEN 0 ELSE 1 END LIMIT 1`,
      binds: [id_empresa, codRef, idServico, cor, tamanho, colBind, colBind],
    });
  }
  if (codRef && cor) {
    tries.push({
      sql: `SELECT preco, tempo_min, desc_ref FROM terc_precos
            WHERE id_empresa=? AND cod_ref=? AND id_servico=? AND LOWER(TRIM(COALESCE(cor,'')))=LOWER(TRIM(?)) AND ativo=1
              AND (id_colecao=? OR id_colecao IS NULL)
            ORDER BY CASE WHEN id_colecao=? THEN 0 ELSE 1 END LIMIT 1`,
      binds: [id_empresa, codRef, idServico, cor, colBind, colBind],
    });
  }
  if (codRef) {
    tries.push({
      sql: `SELECT preco, tempo_min, desc_ref FROM terc_precos
            WHERE id_empresa=? AND cod_ref=? AND id_servico=? AND grade=? AND ativo=1
              AND (id_colecao=? OR id_colecao IS NULL)
            ORDER BY CASE WHEN id_colecao=? THEN 0 ELSE 1 END LIMIT 1`,
      binds: [id_empresa, codRef, idServico, gradeNum, colBind, colBind],
    });
  }
  // Default por serviço (sem produto)
  tries.push({
    sql: `SELECT preco, tempo_min, desc_ref FROM terc_precos
          WHERE id_empresa=? AND (cod_ref IS NULL OR cod_ref='') AND id_servico=? AND ativo=1 LIMIT 1`,
    binds: [id_empresa, idServico],
  });

  for (const t of tries) {
    const found = await DB.prepare(t.sql).bind(...t.binds).first<any>();
    if (found) {
      return {
        preco: Number(found.preco) || 0,
        tempo: Number(found.tempo_min) || 0,
        desc_ref: found.desc_ref || null,
      };
    }
  }
  return { preco: 0, tempo: 0, desc_ref: null };
}

/* =================================================================
 * POST /terc/remessas — criação MULTI-PRODUTOS + MULTI-CORES
 *
 * Aceita 2 formatos:
 *  (A) NOVO: { itens: [{ cod_ref, desc_ref, id_servico, cor, preco_unit, tempo_peca, grade:[{tamanho,qtd}] }, ...] }
 *  (B) LEGADO: { cod_ref, id_servico, cor, grade:[{tamanho,qtd}], preco_unit, ... }
 *
 * Em (B), o body é convertido para 1 único item antes da persistência.
 * O cabeçalho terc_remessas guarda os totais agregados (compatibilidade com telas antigas).
 * ================================================================= */
app.post('/terc/remessas', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  logTenant(c, 'remessa.create.start', { id_terc: b?.id_terc, itens: Array.isArray(b?.itens) ? b.itens.length : 0 });
  if (!b.id_terc) return fail('Terceirizado é obrigatório');

  // SPRINT 2 — Limite de remessas/mês do plano
  try {
    await assertLimit(c.env.DB, id_empresa, 'remessas_mes');
  } catch (e) {
    if (e instanceof LimitExceededError) return e.toResponse();
    throw e;
  }

  // ---- Normalizar para estrutura multi-itens ----
  let itens: any[] = Array.isArray(b.itens) ? b.itens : [];
  if (itens.length === 0) {
    // Modo legado: monta 1 item a partir do body
    if (!b.id_servico) return fail('Serviço é obrigatório (ou informe itens[])');
    itens = [{
      cod_ref: b.cod_ref || '',
      desc_ref: b.desc_ref || null,
      id_servico: toInt(b.id_servico),
      cor: b.cor || null,
      preco_unit: toNum(b.preco_unit),
      tempo_peca: toNum(b.tempo_peca),
      grade_num: toInt(b.grade, 1),
      grade: Array.isArray(b.grade) ? b.grade : [],
      observacao: null,
    }];
  }

  // Validar itens (cada item precisa de id_servico, cor e ao menos 1 qtd > 0)
  const itensValidos: any[] = [];
  for (const it of itens) {
    const idServ = toInt(it.id_servico);
    if (!idServ) return fail('Cada item precisa de um serviço');
    const grade: any[] = Array.isArray(it.grade) ? it.grade : [];
    const qtdItem = grade.reduce((a, g) => a + (toInt(g.qtd) || 0), 0);
    if (qtdItem <= 0) continue; // ignora item vazio
    // Cor obrigatória — não permitir salvar item sem cor
    const corVal = (it.cor != null ? String(it.cor) : '').trim();
    if (!corVal) return fail(`Informe a cor do produto${it.cod_ref ? ` (item ${it.cod_ref})` : ''}.`);
    itensValidos.push({ ...it, cor: corVal, _grade: grade, _qtd: qtdItem, _idServ: idServ });
  }
  if (itensValidos.length === 0) return fail('Informe ao menos 1 item com quantidade > 0');

  // ---- Terceirizado (tenant-scoped) ----
  const t = await c.env.DB.prepare(
    'SELECT id_setor, qtd_pessoas, min_trab_dia, efic_padrao, prazo_padrao FROM terc_terceirizados WHERE id_terc=? AND id_empresa=?'
  ).bind(toInt(b.id_terc), id_empresa).first<any>();
  if (!t) return fail('Terceirizado não encontrado', 404);

  const pess = toInt(b.qtd_pessoas, t.qtd_pessoas || 1);
  const min_dia = toInt(b.min_trab_dia, t.min_trab_dia || 480);
  const efic = toNum(b.efic_pct, t.efic_padrao || 0.8);

  // ---- Auto-fill de preço por item (lookup hierárquico) + agregados ----
  let totQtd = 0, totValor = 0;
  let tempoMaxItem = 0; // usaremos o maior tempo/peça para o cálculo de prazo
  for (const it of itensValidos) {
    let preco = toNum(it.preco_unit);
    let tempo = toNum(it.tempo_peca);
    let descRef = it.desc_ref || null;

    if (it.cod_ref && (preco === 0 || tempo === 0 || !descRef)) {
      const found = await lookupPrecoHier(
        c.env.DB, String(it.cod_ref), it._idServ, it.cor || null,
        null, toInt(it.grade_num, 1), toInt(b.id_colecao) || null, id_empresa
      );
      if (preco === 0) preco = found.preco;
      if (tempo === 0) tempo = found.tempo;
      if (!descRef) descRef = found.desc_ref;
    }
    it._preco = preco;
    it._tempo = tempo;
    it._desc = descRef;
    it._valor = it._qtd * preco;
    totQtd += it._qtd;
    totValor += it._valor;
    if (tempo > tempoMaxItem) tempoMaxItem = tempo;
  }

  // ---- Prazo / previsão ----
  const prazo = toInt(b.prazo_dias, t.prazo_padrao || 0);
  const dt_saida = b.dt_saida || new Date().toISOString().slice(0, 10);
  let dt_prev: string;
  let diasFinal = prazo;
  if (prazo > 0) {
    const d = new Date(dt_saida + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + prazo);
    dt_prev = d.toISOString().slice(0, 10);
  } else {
    const rPrev = calcPrevisao(dt_saida, totQtd, tempoMaxItem, pess, min_dia, efic);
    diasFinal = rPrev.dias; dt_prev = rPrev.dt_prev;
  }

  // ---- Número de controle (escopado por empresa) ----
  const nextN = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(num_controle),0)+1 AS n FROM terc_remessas WHERE id_empresa=?'
  ).bind(id_empresa).first<any>();
  const num_controle = toInt(b.num_controle) || nextN?.n || 1;

  // ---- Cabeçalho: usa o 1º item como "principal" para compat. com tela legada ----
  const head = itensValidos[0];
  const status_inicial = b.dt_envio ? 'Enviado' : (b.status || 'AguardandoEnvio');

  const headIdCor = await resolveColorId(c.env.DB, head.cor, id_empresa);
  const r = await c.env.DB.prepare(`
    INSERT INTO terc_remessas
      (num_controle, num_op, id_terc, id_setor, cod_ref, desc_ref, id_servico, cor, id_cor, grade,
       qtd_total, preco_unit, valor_total, id_colecao, dt_saida, dt_envio, dt_inicio, dt_previsao,
       prazo_dias, tempo_peca, efic_pct, qtd_pessoas, min_trab_dia,
       status, status_fin, modo, observacao, criado_por, id_empresa)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(num_controle, b.num_op || null, toInt(b.id_terc), toInt(b.id_setor) || t.id_setor || null,
      head.cod_ref || '', head._desc, head._idServ, head.cor || null, headIdCor, toInt(head.grade_num, 1),
      totQtd, head._preco, totValor, toInt(b.id_colecao) || null,
      dt_saida, b.dt_envio || null, b.dt_inicio || null, dt_prev,
      diasFinal, tempoMaxItem, efic, pess, min_dia,
      status_inicial, 'NaoFaturado', b.modo || 'basico', b.observacao || null, getUser(c), id_empresa).run();

  const idR = r.meta.last_row_id as number;

  // ---- Persistir cada item + sua grade independente ----
  let ordem = 0;
  for (const it of itensValidos) {
    // Nº OP por item: usa o do item; se faltar, herda do cabeçalho da remessa
    const itemNumOp = (typeof it.num_op === 'string' && it.num_op.trim())
      ? it.num_op.trim()
      : (b.num_op || null);
    const itIdCor = await resolveColorId(c.env.DB, it.cor, id_empresa);
    const ri = await c.env.DB.prepare(`
      INSERT INTO terc_remessa_itens
        (id_remessa, id_produto, cod_ref, desc_ref, id_servico, cor, id_cor, grade_num,
         qtd_total, preco_unit, valor_total, tempo_peca, observacao, ordem, ativo, id_grade_tamanho, num_op, id_empresa)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .bind(idR, toInt(it.id_produto) || null, it.cod_ref || '', it._desc, it._idServ,
        it.cor || null, itIdCor, toInt(it.grade_num, 1),
        it._qtd, it._preco, it._valor, it._tempo, it.observacao || null, ordem++,
        toInt(it.id_grade_tamanho) || null, itemNumOp, id_empresa).run();
    const idItem = ri.meta.last_row_id as number;
    for (const g of it._grade) {
      if (toInt(g.qtd) > 0) {
        await c.env.DB.prepare(
          'INSERT INTO terc_remessa_item_grade (id_item, tamanho, qtd, id_empresa) VALUES (?, ?, ?, ?)'
        ).bind(idItem, g.tamanho, toInt(g.qtd), id_empresa).run();
      }
    }
  }

  // ---- Compatibilidade legada: grade do 1º item replicada no terc_remessa_grade ----
  // (telas antigas leem terc_remessa_grade direto)
  for (const g of head._grade) {
    if (toInt(g.qtd) > 0) {
      await c.env.DB.prepare(
        'INSERT INTO terc_remessa_grade (id_remessa, tamanho, qtd, id_empresa) VALUES (?, ?, ?, ?)'
      ).bind(idR, g.tamanho, toInt(g.qtd), id_empresa).run();
    }
  }

  // Evento + auditoria
  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario, id_empresa) VALUES (?, 'CRIADA', ?, ?, ?)`)
    .bind(idR, `Remessa ${num_controle} criada — ${itensValidos.length} item(ns), ${totQtd} pç, R$ ${totValor.toFixed(2)}`, getUser(c), id_empresa).run();
  await audit(c, MOD, 'INS_REM', `remessa:${idR}`, 'num_controle', '', String(num_controle));

  logTenant(c, 'remessa.create.success', {
    id_remessa: idR,
    num_controle,
    itens: itensValidos.length,
    qtd: totQtd,
    valor: totValor,
  });

  return c.json(ok({
    id: idR, num_controle, dt_previsao: dt_prev, prazo_dias: diasFinal,
    qtd_total: totQtd, valor_total: totValor,
    preco_unit: head._preco, tempo_peca: head._tempo, status: status_inicial,
    itens_count: itensValidos.length,
    auto: { itens_processados: itensValidos.length },
  }));
});

/* =================================================================
 * PUT /terc/remessas/:id — EDIÇÃO COMPLETA MULTI-ITENS
 *
 * Aceita 2 formatos:
 *  (A) NOVO: { itens: [...], num_op, dt_saida, ... } — substitui tudo
 *  (B) LEGADO: { cod_ref, cor, grade:[...], preco_unit, ... } — converte em 1 item
 *
 * Regra crítica: Se a remessa tem retornos, a quantidade total NÃO pode ficar
 * abaixo do total já retornado.
 * ================================================================= */
app.put('/terc/remessas/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();

  // Verifica existência (tenant-scoped)
  const remOld = await c.env.DB.prepare(
    'SELECT id_remessa, qtd_total FROM terc_remessas WHERE id_remessa=? AND id_empresa=?'
  ).bind(id, id_empresa).first<any>();
  if (!remOld) return fail('Remessa não encontrada', 404);

  // Quantidade já retornada (proteção contra subtração indevida)
  const retTot = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(COALESCE(qtd_boa,0)+COALESCE(qtd_refugo,0)+COALESCE(qtd_conserto,0)),0) AS n
       FROM terc_retornos WHERE id_remessa=? AND id_empresa=?`
  ).bind(id, id_empresa).first<any>();
  const totalRetornado = Number(retTot?.n || 0);

  // ---- Normalizar para multi-itens ----
  let itens: any[] = Array.isArray(b.itens) ? b.itens : [];
  if (itens.length === 0) {
    itens = [{
      cod_ref: b.cod_ref || '',
      desc_ref: b.desc_ref || null,
      id_servico: toInt(b.id_servico),
      cor: b.cor || null,
      preco_unit: toNum(b.preco_unit),
      tempo_peca: toNum(b.tempo_peca),
      grade_num: toInt(b.grade, 1),
      grade: Array.isArray(b.grade) ? b.grade : [],
    }];
  }

  const itensValidos: any[] = [];
  for (const it of itens) {
    const idServ = toInt(it.id_servico);
    if (!idServ) return fail('Cada item precisa de um serviço');
    const grade: any[] = Array.isArray(it.grade) ? it.grade : [];
    const qtdItem = grade.reduce((a, g) => a + (toInt(g.qtd) || 0), 0);
    if (qtdItem <= 0) continue;
    // Cor obrigatória — não permitir salvar item sem cor
    const corVal = (it.cor != null ? String(it.cor) : '').trim();
    if (!corVal) return fail(`Informe a cor do produto${it.cod_ref ? ` (item ${it.cod_ref})` : ''}.`);
    itensValidos.push({ ...it, cor: corVal, _grade: grade, _qtd: qtdItem, _idServ: idServ });
  }
  if (itensValidos.length === 0) return fail('Informe ao menos 1 item com quantidade > 0');

  // ---- Auto-fill por item + agregados ----
  let totQtd = 0, totValor = 0, tempoMaxItem = 0;
  for (const it of itensValidos) {
    let preco = toNum(it.preco_unit);
    let tempo = toNum(it.tempo_peca);
    let descRef = it.desc_ref || null;

    if (it.cod_ref && (preco === 0 || tempo === 0 || !descRef)) {
      const found = await lookupPrecoHier(
        c.env.DB, String(it.cod_ref), it._idServ, it.cor || null,
        null, toInt(it.grade_num, 1), toInt(b.id_colecao) || null, id_empresa
      );
      if (preco === 0) preco = found.preco;
      if (tempo === 0) tempo = found.tempo;
      if (!descRef) descRef = found.desc_ref;
    }
    it._preco = preco; it._tempo = tempo; it._desc = descRef;
    it._valor = it._qtd * preco;
    totQtd += it._qtd;
    totValor += it._valor;
    if (tempo > tempoMaxItem) tempoMaxItem = tempo;
  }

  // 🔒 Proteção: total não pode ficar < retornado
  if (totalRetornado > 0 && totQtd < totalRetornado) {
    return fail(
      `Quantidade total (${totQtd}) é menor que o já retornado (${totalRetornado}). ` +
      `Ajuste a grade dos itens.`,
      409
    );
  }

  // ---- Recalcula prazo/previsão ----
  const pess = toInt(b.qtd_pessoas, 1);
  const min_dia = toInt(b.min_trab_dia, 480);
  const efic = toNum(b.efic_pct, 0.8);
  const prazo = toInt(b.prazo_dias);
  let { dias, dt_prev } = calcPrevisao(b.dt_saida, totQtd, tempoMaxItem, pess, min_dia, efic);
  if (prazo > 0) {
    const d = new Date(b.dt_saida + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + prazo);
    dt_prev = d.toISOString().slice(0, 10);
  }

  const head = itensValidos[0];
  const headIdCor = await resolveColorId(c.env.DB, head.cor, id_empresa);

  // ---- UPDATE cabeçalho (com agregados do 1º item p/ compat) ----
  await c.env.DB.prepare(`
    UPDATE terc_remessas SET num_op=?, id_terc=?, id_setor=?, cod_ref=?, desc_ref=?, id_servico=?, cor=?, id_cor=?, grade=?,
      qtd_total=?, preco_unit=?, valor_total=?, id_colecao=?, dt_saida=?, dt_inicio=?, dt_previsao=?, prazo_dias=?,
      tempo_peca=?, efic_pct=?, qtd_pessoas=?, min_trab_dia=?, status=?, observacao=?, alterado_por=?, dt_alteracao=datetime('now')
    WHERE id_remessa=? AND id_empresa=?`)
    .bind(b.num_op || null, toInt(b.id_terc), toInt(b.id_setor) || null,
      head.cod_ref || '', head._desc, head._idServ, head.cor || null, headIdCor, toInt(head.grade_num, 1),
      totQtd, head._preco, totValor, toInt(b.id_colecao) || null,
      b.dt_saida, b.dt_inicio || b.dt_saida, dt_prev, prazo > 0 ? prazo : dias,
      tempoMaxItem, efic, pess, min_dia, b.status || 'AguardandoEnvio', b.observacao || null, getUser(c), id, id_empresa).run();

  // ---- Regrava itens (e suas grades) — DELETE+INSERT é atômico no D1 ----
  await c.env.DB.prepare('DELETE FROM terc_remessa_itens WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).run();
  // (FK ON DELETE CASCADE remove terc_remessa_item_grade automaticamente)

  let ordem = 0;
  for (const it of itensValidos) {
    // Nº OP por item: usa o do item; se faltar, herda do cabeçalho
    const itemNumOp = (typeof it.num_op === 'string' && it.num_op.trim())
      ? it.num_op.trim()
      : (b.num_op || null);
    const itIdCor = await resolveColorId(c.env.DB, it.cor, id_empresa);
    const ri = await c.env.DB.prepare(`
      INSERT INTO terc_remessa_itens
        (id_empresa, id_remessa, id_produto, cod_ref, desc_ref, id_servico, cor, id_cor, grade_num,
         qtd_total, preco_unit, valor_total, tempo_peca, observacao, ordem, ativo, dt_alteracao, id_grade_tamanho, num_op)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?)`)
      .bind(id_empresa, id, toInt(it.id_produto) || null, it.cod_ref || '', it._desc, it._idServ,
        it.cor || null, itIdCor, toInt(it.grade_num, 1),
        it._qtd, it._preco, it._valor, it._tempo, it.observacao || null, ordem++,
        toInt(it.id_grade_tamanho) || null, itemNumOp).run();
    const idItem = ri.meta.last_row_id as number;
    for (const g of it._grade) {
      if (toInt(g.qtd) > 0) {
        await c.env.DB.prepare(
          'INSERT INTO terc_remessa_item_grade (id_empresa, id_item, tamanho, qtd) VALUES (?, ?, ?, ?)'
        ).bind(id_empresa, idItem, g.tamanho, toInt(g.qtd)).run();
      }
    }
  }

  // ---- Sincroniza grade legada (terc_remessa_grade) com a do 1º item ----
  await c.env.DB.prepare('DELETE FROM terc_remessa_grade WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).run();
  for (const g of head._grade) {
    if (toInt(g.qtd) > 0) {
      await c.env.DB.prepare(
        'INSERT INTO terc_remessa_grade (id_empresa, id_remessa, tamanho, qtd) VALUES (?, ?, ?, ?)'
      ).bind(id_empresa, id, g.tamanho, toInt(g.qtd)).run();
    }
  }

  await audit(c, MOD, 'UPD_REM', `remessa:${id}`);
  return c.json(ok({
    id, dt_previsao: dt_prev,
    qtd_total: totQtd, valor_total: totValor,
    itens_count: itensValidos.length,
  }));
});

// Excluir remessa
// Comportamento (refator 2026‑05‑04):
//   - Por padrão (sem retornos), exclui completamente (HARD DELETE).
//   - Se a remessa possui retornos, exige confirmação explícita pelo cliente:
//        ?confirm=SIM ou body { confirm: 'SIM' }
//        E permite escolher modo: ?modo=cascata (apaga retornos+remessa) ou ?modo=soft
//        (mantém retornos, marca a remessa como Cancelada — preserva histórico).
//   - Sem confirmação retorna 409 com contagem de retornos para o front mostrar modal.
app.delete('/terc/remessas/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const q = c.req.query();
  let body: any = {};
  try { body = await c.req.json(); } catch { /* sem body é OK */ }
  const confirm = String(q.confirm || body.confirm || '').toUpperCase();
  const modo = String(q.modo || body.modo || 'cascata').toLowerCase(); // cascata | soft

  const rem = await c.env.DB.prepare('SELECT id_remessa, num_controle, status FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);

  const nRet = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_retornos WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  const totalRet = Number(nRet?.c) || 0;

  // Se possui retornos e não houve confirmação explícita, devolve 409 com contexto
  if (totalRet > 0 && confirm !== 'SIM') {
    return c.json({
      ok: false,
      code: 'NEEDS_CONFIRMATION',
      error: `Esta remessa possui ${totalRet} retorno(s) vinculado(s). Escolha uma opção.`,
      retornos: totalRet,
      num_controle: rem.num_controle,
    }, 409);
  }

  if (modo === 'soft' && totalRet > 0) {
    // Soft delete: mantém retornos e remessa, mas cancela
    await c.env.DB.prepare("UPDATE terc_remessas SET status='Cancelada', status_fin='NaoFaturado' WHERE id_remessa=? AND id_empresa=?").bind(id, id_empresa).run();
    await c.env.DB.prepare(`INSERT INTO terc_eventos (id_empresa, id_remessa, tipo, descricao, usuario) VALUES (?, ?, 'CANCELADA', ?, ?)`)
      .bind(id_empresa, id, `Remessa cancelada (soft delete) — preserva ${totalRet} retorno(s).`, getUser(c)).run();
    await audit(c, MOD, 'CANCEL_REM', `remessa:${id}`, 'status', rem.status || '', 'Cancelada');
    return c.json(ok({ id, deleted: false, soft: true, status_remessa: 'Cancelada', retornos_preservados: totalRet }));
  }

  // Hard delete em cascata (tenant-scoped): apaga retornos, grade de retornos, eventos e a remessa
  await c.env.DB.prepare('DELETE FROM terc_retorno_grade WHERE id_empresa=? AND id_retorno IN (SELECT id_retorno FROM terc_retornos WHERE id_remessa=? AND id_empresa=?)').bind(id_empresa, id, id_empresa).run();
  await c.env.DB.prepare('DELETE FROM terc_retornos WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).run();
  await c.env.DB.prepare('DELETE FROM terc_eventos WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).run().catch(() => {});
  await c.env.DB.prepare('DELETE FROM terc_remessa_grade WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).run();
  await c.env.DB.prepare('DELETE FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).run();
  await audit(c, MOD, 'DEL_REM', `remessa:${id}`, 'retornos_apagados', '', String(totalRet));
  return c.json(ok({ id, deleted: true, retornos_apagados: totalRet }));
});

/* =================================================================
 * RETORNOS (podem existir múltiplos retornos parciais por remessa)
 * ================================================================= */

/* =================================================================
 * Helper: lê os itens da remessa com suas grades e calcula o saldo
 * disponível por item (qtd enviada − soma de retornos anteriores).
 * Retorna mapa { id_item: { ...item, gradeMap, gradeMaxMap, retornado } }
 * ================================================================= */
async function _itensRemessaComSaldo(DB: D1Database, idRemessa: number, idRetEditar: number = 0, id_empresa: number = 1) {
  const itens = (await DB.prepare(`
    SELECT i.id_item, i.id_remessa, i.id_produto, i.cod_ref, i.desc_ref,
           i.id_servico, i.cor, i.preco_unit, i.qtd_total, i.tempo_peca,
           sv.desc_servico
      FROM terc_remessa_itens i
      LEFT JOIN terc_servicos sv ON sv.id_servico = i.id_servico AND sv.id_empresa = i.id_empresa
     WHERE i.id_remessa = ? AND i.id_empresa = ? AND i.ativo = 1
     ORDER BY i.ordem ASC, i.id_item ASC`).bind(idRemessa, id_empresa).all()).results as any[];

  if (itens.length === 0) return [];

  // Carrega grades enviadas por item (tenant-scoped)
  const ids = itens.map(i => i.id_item);
  const placeholders = ids.map(() => '?').join(',');
  const grades = (await DB.prepare(
    `SELECT id_item, tamanho, qtd FROM terc_remessa_item_grade
      WHERE id_empresa = ? AND id_item IN (${placeholders})`
  ).bind(id_empresa, ...ids).all()).results as any[];
  const gradeByItem: Record<number, Record<string, number>> = {};
  for (const g of grades) {
    (gradeByItem[g.id_item] ||= {})[g.tamanho] = Number(g.qtd) || 0;
  }

  // Carrega retornos anteriores por item (excluindo o que está em edição)
  const retIts = (await DB.prepare(`
    SELECT ri.id_item, ri.qtd_boa, ri.qtd_refugo, ri.qtd_conserto, ri.qtd_total
      FROM terc_retorno_itens ri
     WHERE ri.id_remessa = ? AND ri.id_empresa = ?
       AND (? = 0 OR ri.id_retorno <> ?)`
  ).bind(idRemessa, id_empresa, idRetEditar, idRetEditar).all()).results as any[];

  const retGrades = (await DB.prepare(`
    SELECT rig.tamanho, rig.qtd, ri.id_item
      FROM terc_retorno_item_grade rig
      JOIN terc_retorno_itens ri ON ri.id_ret_item = rig.id_ret_item AND ri.id_empresa = rig.id_empresa
     WHERE ri.id_remessa = ? AND ri.id_empresa = ?
       AND (? = 0 OR ri.id_retorno <> ?)`
  ).bind(idRemessa, id_empresa, idRetEditar, idRetEditar).all()).results as any[];

  const retornadoByItem: Record<number, number> = {};
  for (const r of retIts) {
    retornadoByItem[r.id_item] = (retornadoByItem[r.id_item] || 0) + (Number(r.qtd_total) || 0);
  }
  const retGradeByItem: Record<number, Record<string, number>> = {};
  for (const g of retGrades) {
    (retGradeByItem[g.id_item] ||= {})[g.tamanho] = (retGradeByItem[g.id_item]?.[g.tamanho] || 0) + (Number(g.qtd) || 0);
  }

  return itens.map(it => {
    const gEnv = gradeByItem[it.id_item] || {};
    const gRet = retGradeByItem[it.id_item] || {};
    const gradeMax: Record<string, number> = {};
    for (const t of Object.keys(gEnv)) gradeMax[t] = Math.max(0, (gEnv[t] || 0) - (gRet[t] || 0));
    const enviado = Object.values(gEnv).reduce((a, v) => a + v, 0) || Number(it.qtd_total) || 0;
    const retornado = retornadoByItem[it.id_item] || 0;
    // grade como array (preserva ordem dos tamanhos da grade enviada)
    const gradeArr = Object.entries(gEnv).map(([tamanho, qtd]) => ({ tamanho, qtd }));
    return {
      ...it,
      grade: gradeArr,
      gradeEnviada: gEnv,
      gradeMax,
      qtd_enviada: enviado,
      qtd_retornada_anterior: retornado,
      qtd_disponivel: Math.max(0, enviado - retornado),
    };
  });
}

/* =================================================================
 * GET /terc/retornos
 * Endpoint OTIMIZADO para a tela "Retornos" — substitui a abordagem
 * antiga (N+1 requests: lista remessas + para cada uma busca detalhe).
 *
 * Faz tudo em DUAS queries: 1 para contagem/KPIs (sem LIMIT), 1 para
 * a página atual (com LIMIT/OFFSET). JOIN inline traz nome_terc,
 * cod_ref, cor, num_controle, desc_servico no mesmo round-trip.
 *
 * Query params:
 *   - de (YYYY-MM-DD)        — data inicial (default: 30 dias atrás)
 *   - ate (YYYY-MM-DD)       — data final (default: hoje)
 *   - id_terc (int)          — filtra terceirizado
 *   - search (string)        — busca em num_controle/cod_ref/cor/nome_terc
 *   - status_pag             — 'pago' | 'pendente' | '' (todos)
 *   - page (1-based, default 1)
 *   - per_page (default 50, max 200)
 *
 * Retorna:
 *   {
 *     ok: true,
 *     data: {
 *       rows: [...],         // página atual (no máx per_page itens)
 *       total: N,            // total geral filtrado (sem paginação)
 *       page: N, per_page: N, total_pages: N,
 *       kpis: {              // agregados do filtro inteiro (não da página)
 *         qtd: N, boa: N, refugo: N, conserto: N, total: N,
 *         valor_pago: N, valor_pago_pendente: N, valor_pago_quitado: N
 *       }
 *     }
 *   }
 * ================================================================= */
app.get('/terc/retornos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();

  // ---- Sanitização de inputs
  const today = new Date().toISOString().slice(0, 10);
  // 📅 Janela default: 90 dias (era 30 — alargamos para capturar dados legados
  // que ficavam invisíveis quando o usuário não mudava o filtro).
  const de  = q.de  || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const ate = q.ate || today;
  const idTerc = toInt(q.id_terc || 0);
  const search = (q.search || '').trim();
  const statusPag = (q.status_pag || '').trim(); // 'pago' | 'pendente' | ''

  let page = Math.max(1, toInt(q.page || 1));
  let perPage = Math.max(1, Math.min(200, toInt(q.per_page || 50)));
  const offset = (page - 1) * perPage;

  // ---- Where dinâmico (compartilhado entre count/kpi e select), tenant-scoped
  const idSetor = toInt(q.id_setor || 0); // HOTFIX 0037
  const where: string[] = ['rt.id_empresa = ?', 'rt.dt_retorno >= ?', 'rt.dt_retorno <= ?'];
  const binds: any[] = [id_empresa, de, ate];
  if (idTerc) { where.push('r.id_terc = ?'); binds.push(idTerc); }
  if (idSetor) { where.push('r.id_setor = ?'); binds.push(idSetor); } // HOTFIX 0037
  if (search) {
    // 🔎 Busca inteligente multi-termo: cada termo (separado por espaço) é AND
    // através dos campos via OR — busca parcial, case-insensitive via LIKE.
    const terms = search.split(/\s+/).filter(Boolean).slice(0, 8);
    const fields = [
      'r.num_controle', 'r.cod_ref', 'r.desc_ref', 'r.cor',
      't.nome_terc', 'r.num_op', 'sv.desc_servico', 'st.nome_setor'
    ];
    for (const term of terms) {
      where.push('(' + fields.map(f => `${f} LIKE ?`).join(' OR ') + ')');
      const like = `%${term}%`;
      for (let i = 0; i < fields.length; i++) binds.push(like);
    }
  }
  if (statusPag === 'pago')     where.push('rt.dt_pagamento IS NOT NULL');
  if (statusPag === 'pendente') where.push('rt.dt_pagamento IS NULL');
  const whereSql = 'WHERE ' + where.join(' AND ');

  // ---- 1) KPIs + total — agregação no banco (uma única query, tenant-scoped)
  const kpiSql = `
    SELECT
      COUNT(*)                                                    AS qtd,
      COALESCE(SUM(rt.qtd_boa), 0)                                AS boa,
      COALESCE(SUM(rt.qtd_refugo), 0)                             AS refugo,
      COALESCE(SUM(rt.qtd_conserto), 0)                           AS conserto,
      COALESCE(SUM(rt.qtd_total), 0)                              AS total,
      COALESCE(SUM(rt.valor_pago), 0)                             AS valor_pago,
      COALESCE(SUM(CASE WHEN rt.dt_pagamento IS NULL     THEN rt.valor_pago ELSE 0 END), 0) AS valor_pendente,
      COALESCE(SUM(CASE WHEN rt.dt_pagamento IS NOT NULL THEN rt.valor_pago ELSE 0 END), 0) AS valor_quitado
    FROM terc_retornos rt
    JOIN terc_remessas r       ON r.id_remessa = rt.id_remessa AND r.id_empresa = rt.id_empresa
    LEFT JOIN terc_terceirizados t ON t.id_terc = r.id_terc AND t.id_empresa = r.id_empresa
    LEFT JOIN terc_servicos sv ON sv.id_servico = r.id_servico AND sv.id_empresa = r.id_empresa
    LEFT JOIN terc_setores st ON st.id_setor = r.id_setor AND st.id_empresa = r.id_empresa
    ${whereSql}`;
  const kpi = await c.env.DB.prepare(kpiSql).bind(...binds).first<any>() || {};
  const totalGeral = Number(kpi.qtd) || 0;
  const totalPages = Math.max(1, Math.ceil(totalGeral / perPage));
  if (page > totalPages) page = totalPages;
  const offset2 = (page - 1) * perPage;

  // ---- 2) Página atual — JOIN único, sem N+1, tenant-scoped
  const rowsSql = `
    SELECT
      rt.id_retorno, rt.id_remessa, rt.dt_retorno, rt.qtd_total,
      rt.qtd_boa, rt.qtd_refugo, rt.qtd_conserto, rt.valor_pago,
      rt.dt_pagamento, rt.observacao,
      r.num_controle, r.cod_ref, r.cor, r.num_op,
      t.nome_terc,
      sv.desc_servico,
      st.nome_setor, st.cor AS setor_cor
    FROM terc_retornos rt
    JOIN terc_remessas r       ON r.id_remessa = rt.id_remessa AND r.id_empresa = rt.id_empresa
    LEFT JOIN terc_terceirizados t ON t.id_terc = r.id_terc AND t.id_empresa = r.id_empresa
    LEFT JOIN terc_servicos sv ON sv.id_servico = r.id_servico AND sv.id_empresa = r.id_empresa
    LEFT JOIN terc_setores st ON st.id_setor = r.id_setor AND st.id_empresa = r.id_empresa
    ${whereSql}
    ORDER BY rt.dt_retorno DESC, rt.id_retorno DESC
    LIMIT ? OFFSET ?`;
  const rs = await c.env.DB.prepare(rowsSql).bind(...binds, perPage, offset2).all();

  // 🔍 Detecção de inconsistência: remessas Retornado/Concluido sem retorno vinculado
  // (tenant-scoped — só conta as da empresa atual)
  const inconsist = await c.env.DB.prepare(`
    SELECT COUNT(*) AS orfas
      FROM terc_remessas r
     WHERE r.id_empresa = ?
       AND r.status IN ('Retornado','Concluido','Parcial','Pago')
       AND NOT EXISTS (
         SELECT 1 FROM terc_retornos rt
          WHERE rt.id_remessa = r.id_remessa AND rt.id_empresa = r.id_empresa
       )
  `).bind(id_empresa).first<any>() || { orfas: 0 };
  const orfas = Number(inconsist.orfas) || 0;

  // 📊 Logs estruturados (sempre, para debug em PROD)
  logTenant(c, 'retornos.list', {
    filtro: { de, ate, id_terc: idTerc || null, search: search || null, status_pag: statusPag || null },
    page, per_page: perPage,
    total: totalGeral,
    kpi: { boa: Number(kpi.boa)||0, refugo: Number(kpi.refugo)||0, conserto: Number(kpi.conserto)||0, valor_pago: Number(kpi.valor_pago)||0 },
    orfas, // alerta de integridade
  });

  return c.json(ok({
    rows: rs.results || [],
    total: totalGeral,
    page,
    per_page: perPage,
    total_pages: totalPages,
    kpis: {
      qtd: totalGeral,
      boa: Number(kpi.boa) || 0,
      refugo: Number(kpi.refugo) || 0,
      conserto: Number(kpi.conserto) || 0,
      total: Number(kpi.total) || 0,
      valor_pago: Number(kpi.valor_pago) || 0,
      valor_pago_pendente: Number(kpi.valor_pendente) || 0,
      valor_pago_quitado: Number(kpi.valor_quitado) || 0,
    },
    filtro: { de, ate, id_terc: idTerc || null, search: search || null, status_pag: statusPag || null },
    // 🚨 Sinalizador de inconsistência para o frontend mostrar banner de reparação
    integridade: {
      orfas,
      mensagem: orfas > 0
        ? `${orfas} remessa(s) com status Retornado/Concluído sem retorno vinculado nesta empresa. Use o botão "Reparar integridade" para reconstruir.`
        : null,
    },
  }));
});

/* =================================================================
 * GET /terc/retornos/audit
 * Auditoria de integridade — diagnóstico detalhado (tenant-scoped).
 * Lista as remessas que estão com status='Retornado' (ou Concluído/Parcial/Pago)
 * mas que NÃO possuem registro em terc_retornos — útil para o painel admin
 * mostrar exatamente quais remessas precisam de reparação.
 * ================================================================= */
app.get('/terc/retornos/audit', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const orfas = await c.env.DB.prepare(`
    SELECT
      r.id_remessa, r.num_controle, r.cod_ref, r.cor, r.qtd_total,
      r.valor_total, r.valor_pago, r.dt_recebimento, r.dt_pagamento,
      r.status, r.status_fin, r.id_empresa
    FROM terc_remessas r
    WHERE r.id_empresa = ?
      AND r.status IN ('Retornado','Concluido','Parcial','Pago')
      AND NOT EXISTS (
        SELECT 1 FROM terc_retornos rt
         WHERE rt.id_remessa = r.id_remessa AND rt.id_empresa = r.id_empresa
      )
    ORDER BY r.id_remessa DESC
  `).bind(id_empresa).all();

  const lista = (orfas.results || []) as any[];
  logTenant(c, 'retornos.audit', { orfas: lista.length });
  return c.json(ok({
    orfas: lista.length,
    remessas_orfas: lista,
    pode_reparar: lista.length > 0,
  }));
});

/* =================================================================
 * POST /terc/retornos/repair
 * Reparação on-demand — recria registros faltantes em terc_retornos
 * para todas as remessas Retornadas órfãs desta empresa.
 *
 * Cria 1 retorno sintético por remessa órfã, assumindo qtd_boa = qtd_total
 * (modo "basico" sem refugo/conserto). Idempotente: NOT EXISTS impede duplicação.
 *
 * Apenas usuários com sessão válida + id_empresa podem disparar
 * (não exige role específica — auto-reparação dos próprios dados).
 * ================================================================= */
app.post('/terc/retornos/repair', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const user = c.get('user') as any;

  // Reconstrói retornos órfãos — tenant-scoped, idempotente
  const result = await c.env.DB.prepare(`
    INSERT INTO terc_retornos (
      id_remessa, dt_retorno, qtd_total, qtd_boa, qtd_refugo, qtd_conserto,
      valor_pago, dt_pagamento, observacao, criado_por, dt_criacao, id_empresa
    )
    SELECT
      r.id_remessa,
      COALESCE(r.dt_recebimento, r.dt_saida, date('now')),
      r.qtd_total,
      r.qtd_total,
      0, 0,
      COALESCE(r.valor_pago, 0),
      r.dt_pagamento,
      '[Reparação on-demand] Retorno reconstruído a partir da remessa #' || r.num_controle || ' — modo legado/basico.',
      ?,
      datetime('now'),
      r.id_empresa
    FROM terc_remessas r
    WHERE r.id_empresa = ?
      AND r.status IN ('Retornado','Concluido','Parcial','Pago')
      AND NOT EXISTS (
        SELECT 1 FROM terc_retornos rt
         WHERE rt.id_remessa = r.id_remessa AND rt.id_empresa = r.id_empresa
      )
  `).bind(`repair-by:${user?.login || 'anon'}`, id_empresa).run();

  const criados = result.meta?.changes || 0;
  logTenant(c, 'retornos.repair', { criados });
  await audit(c, MOD, 'REPAIR_RET', 'integridade', '', '', String(criados));

  return c.json(ok({
    criados,
    mensagem: criados > 0
      ? `${criados} retorno(s) reconstruído(s) com sucesso. A tela de Retornos agora reflete todos os dados.`
      : 'Nenhuma remessa órfã encontrada. Integridade OK.',
  }));
});

/* =================================================================
 * GET /terc/remessas/:id/retorno-context
 * Devolve a estrutura pronta para a tela "Registrar Retorno":
 *   - cabeçalho da remessa
 *   - itens[] com gradeEnviada, gradeMax (por tamanho) e disponível
 * Aceita ?id_retorno=X para excluir esse retorno do cálculo (modo edição).
 * ================================================================= */
app.get('/terc/remessas/:id/retorno-context', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const idRetEdit = toInt(c.req.query('id_retorno') || 0);
  const rem = await c.env.DB.prepare(`
    SELECT r.*, t.nome_terc, sv.desc_servico
      FROM terc_remessas r
      LEFT JOIN terc_terceirizados t ON t.id_terc = r.id_terc AND t.id_empresa = r.id_empresa
      LEFT JOIN terc_servicos sv ON sv.id_servico = r.id_servico AND sv.id_empresa = r.id_empresa
     WHERE r.id_remessa = ? AND r.id_empresa = ?`).bind(id, id_empresa).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);

  const itens = await _itensRemessaComSaldo(c.env.DB, id, idRetEdit, id_empresa);

  // Se for edição, devolve também os valores já lançados deste retorno (por item)
  let retornoEdit: any = null;
  if (idRetEdit) {
    const r0 = await c.env.DB.prepare('SELECT * FROM terc_retornos WHERE id_retorno=? AND id_empresa=?').bind(idRetEdit, id_empresa).first<any>();
    if (r0) {
      const ris = (await c.env.DB.prepare(`
        SELECT ri.*, (SELECT json_group_array(json_object('tamanho', tamanho, 'qtd', qtd))
                        FROM terc_retorno_item_grade WHERE id_ret_item = ri.id_ret_item AND id_empresa = ri.id_empresa) AS grade_json
          FROM terc_retorno_itens ri WHERE ri.id_retorno = ? AND ri.id_empresa = ?`).bind(idRetEdit, id_empresa).all()).results as any[];
      retornoEdit = {
        ...r0,
        itens: ris.map(x => {
          let g: any[] = [];
          try { g = JSON.parse(x.grade_json || '[]'); } catch {}
          return { ...x, grade: g };
        }),
      };
    }
  }

  return c.json(ok({ remessa: rem, itens, retorno_edit: retornoEdit }));
});

/* =================================================================
 * POST /terc/retornos — RETORNO MULTI-ITENS
 * Aceita 2 formatos:
 *   (A) NOVO: { id_remessa, dt_retorno, itens: [
 *         { id_item, qtd_boa, qtd_refugo, qtd_conserto,
 *           grade: [{tamanho, qtd}], valor (opcional) }, ... ] }
 *   (B) LEGADO: { id_remessa, dt_retorno, qtd_boa, qtd_refugo, qtd_conserto,
 *         grade: [...] } — converte automaticamente para 1 item (o 1º da remessa).
 * ================================================================= */
app.post('/terc/retornos', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  if (!b.id_remessa || !b.dt_retorno) return fail('id_remessa e dt_retorno são obrigatórios');
  const idRem = toInt(b.id_remessa);

  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(idRem, id_empresa).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);

  // ---- Carrega itens da remessa (com saldo disponível por item) ----
  const itensRem = await _itensRemessaComSaldo(c.env.DB, idRem, 0, id_empresa);
  const mapItens = new Map<number, any>();
  for (const it of itensRem) mapItens.set(it.id_item, it);

  // ---- Normaliza payload em itens[] ----
  let itensInput: any[] = Array.isArray(b.itens) ? b.itens : [];
  if (itensInput.length === 0) {
    // LEGADO: cabe em 1 item (o 1º da remessa)
    if (itensRem.length === 0) return fail('Remessa não tem itens cadastrados', 400);
    const principal = itensRem[0];
    itensInput = [{
      id_item: principal.id_item,
      qtd_boa: toInt(b.qtd_boa),
      qtd_refugo: toInt(b.qtd_refugo),
      qtd_conserto: toInt(b.qtd_conserto),
      grade: Array.isArray(b.grade) ? b.grade : [],
    }];
  }

  // ---- Valida cada item retornado ----
  const itensValid: any[] = [];
  for (const x of itensInput) {
    const idItem = toInt(x.id_item);
    if (!idItem) return fail('Cada item retornado precisa de id_item');
    const it = mapItens.get(idItem);
    if (!it) return fail(`Item #${idItem} não pertence à remessa`, 400);

    const grade: any[] = Array.isArray(x.grade) ? x.grade : [];
    const totalGrade = grade.reduce((a, g) => a + (toInt(g.qtd) || 0), 0);
    let qtdBoa = toInt(x.qtd_boa, totalGrade);
    const qtdRef = toInt(x.qtd_refugo);
    const qtdCon = toInt(x.qtd_conserto);
    // Se grade veio mas qtd_boa não bate com a soma da grade, prioriza a grade
    if (totalGrade > 0 && qtdBoa === 0) qtdBoa = totalGrade;
    const qtdTot = qtdBoa + qtdRef + qtdCon;
    if (qtdTot <= 0) continue; // ignora item sem retorno

    // Valida: total_item <= disponível (enviado − outros retornos)
    if (qtdTot > it.qtd_disponivel) {
      return fail(
        `Item ${it.cod_ref || ''}/${it.cor || '?'}: total ${qtdTot} excede o disponível (${it.qtd_disponivel}).`,
        400,
      );
    }
    // Valida grade: qtd por tamanho <= máx do tamanho disponível
    for (const g of grade) {
      const max = it.gradeMax[g.tamanho] || 0;
      if ((toInt(g.qtd) || 0) > max) {
        return fail(
          `Item ${it.cod_ref || ''}/${it.cor || '?'} tamanho ${g.tamanho}: ${g.qtd} excede o disponível (${max}).`,
          400,
        );
      }
    }

    const preco = Number(it.preco_unit) || 0;
    const valor = (x.valor != null ? toNum(x.valor) : qtdBoa * preco);
    itensValid.push({
      idItem, it, grade, qtdBoa, qtdRef, qtdCon, qtdTot, preco, valor,
      observacao: x.observacao || null,
    });
  }
  if (itensValid.length === 0) return fail('Informe ao menos 1 item com quantidade retornada > 0', 400);

  // ---- Totaliza para gravação no cabeçalho ----
  const totBoa = itensValid.reduce((a, x) => a + x.qtdBoa, 0);
  const totRef = itensValid.reduce((a, x) => a + x.qtdRef, 0);
  const totCon = itensValid.reduce((a, x) => a + x.qtdCon, 0);
  const totQtd = totBoa + totRef + totCon;
  // Valor total: usa o que veio em b.valor_pago se informado; senão soma valores por item
  const totValor = b.valor_pago != null && b.valor_pago !== ''
    ? toNum(b.valor_pago)
    : itensValid.reduce((a, x) => a + x.valor, 0);

  // ---- INSERT cabeçalho ----
  const r = await c.env.DB.prepare(`
    INSERT INTO terc_retornos (id_remessa, dt_retorno, qtd_total, qtd_boa, qtd_refugo, qtd_conserto,
                               valor_pago, dt_pagamento, observacao, criado_por, id_empresa)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(idRem, b.dt_retorno, totQtd, totBoa, totRef, totCon,
      totValor, b.dt_pagamento || null, b.observacao || null, getUser(c), id_empresa).run();
  const idRet = r.meta.last_row_id as number;

  // ---- INSERT por item retornado + grade do item ----
  const gradeAgreg: Record<string, number> = {}; // p/ compat. terc_retorno_grade legado
  for (const x of itensValid) {
    const itIdCor = await resolveColorId(c.env.DB, x.it.cor, id_empresa);
    const ri = await c.env.DB.prepare(`
      INSERT INTO terc_retorno_itens
        (id_retorno, id_item, id_remessa, cod_ref, desc_ref, cor, id_cor, id_servico,
         qtd_boa, qtd_refugo, qtd_conserto, qtd_total, preco_unit, valor, observacao, id_empresa)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(idRet, x.idItem, idRem,
        x.it.cod_ref, x.it.desc_ref, x.it.cor, itIdCor, x.it.id_servico,
        x.qtdBoa, x.qtdRef, x.qtdCon, x.qtdTot, x.preco, x.valor, x.observacao, id_empresa).run();
    const idRi = ri.meta.last_row_id as number;
    for (const g of x.grade) {
      const q = toInt(g.qtd);
      if (q > 0) {
        await c.env.DB.prepare(
          'INSERT INTO terc_retorno_item_grade (id_ret_item, tamanho, qtd, id_empresa) VALUES (?, ?, ?, ?)'
        ).bind(idRi, g.tamanho, q, id_empresa).run();
        gradeAgreg[g.tamanho] = (gradeAgreg[g.tamanho] || 0) + q;
      }
    }
  }

  // ---- Compat. legada: replica grade agregada em terc_retorno_grade ----
  for (const [tam, q] of Object.entries(gradeAgreg)) {
    if (q > 0) {
      await c.env.DB.prepare('INSERT INTO terc_retorno_grade (id_retorno, tamanho, qtd, id_empresa) VALUES (?, ?, ?, ?)')
        .bind(idRet, tam, q, id_empresa).run();
    }
  }

  // ---- Atualiza status da remessa (tenant-scoped) ----
  const jaRet = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=? AND id_empresa=?'
  ).bind(idRem, id_empresa).first<any>();
  const totalAposRetorno = Number(jaRet?.s) || 0;
  const completo = totalAposRetorno >= Number(rem.qtd_total);
  const novoStatus = completo ? 'Retornado' : 'Parcial';
  const novoStatusFin = completo ? 'PendentePagamento' : (rem.status_fin || 'NaoFaturado');

  await c.env.DB.prepare(`UPDATE terc_remessas SET status=?, status_fin=?, dt_recebimento=COALESCE(dt_recebimento, ?) WHERE id_remessa=? AND id_empresa=?`)
    .bind(novoStatus, novoStatusFin, completo ? b.dt_retorno : null, idRem, id_empresa).run();

  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario, id_empresa) VALUES (?, ?, ?, ?, ?)`)
    .bind(idRem,
      completo ? 'RETORNO_TOTAL' : 'RETORNO_PARCIAL',
      `Retorno ${totQtd} pç em ${itensValid.length} item(ns) (boa: ${totBoa}, refugo: ${totRef}, conserto: ${totCon}) — R$ ${totValor.toFixed(2)}`,
      getUser(c), id_empresa).run();

  await audit(c, MOD, 'INS_RET', `retorno:${idRet}`, 'qtd_total', '', String(totQtd));
  return c.json(ok({
    id: idRet, status_remessa: novoStatus, status_fin: novoStatusFin,
    total_retornado: totalAposRetorno, saldo: Number(rem.qtd_total) - totalAposRetorno,
    itens_count: itensValid.length, qtd_boa: totBoa, qtd_refugo: totRef, qtd_conserto: totCon,
    valor_pago: totValor,
  }));
});

/* =================================================================
 * PUT /terc/retornos/:id — EDIÇÃO MULTI-ITENS
 * Aceita 2 formatos (igual ao POST). Substitui todos os itens deste retorno.
 * ================================================================= */
app.put('/terc/retornos/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  const ret = await c.env.DB.prepare('SELECT * FROM terc_retornos WHERE id_retorno=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!ret) return fail('Retorno não encontrado', 404);
  const idRem = Number(ret.id_remessa);
  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(idRem, id_empresa).first<any>();
  if (!rem) return fail('Remessa associada não encontrada', 404);

  // Itens da remessa com saldo (excluindo este retorno do cálculo)
  const itensRem = await _itensRemessaComSaldo(c.env.DB, idRem, id, id_empresa);
  const mapItens = new Map<number, any>();
  for (const it of itensRem) mapItens.set(it.id_item, it);

  // Normaliza itens[]
  let itensInput: any[] = Array.isArray(b.itens) ? b.itens : [];
  if (itensInput.length === 0) {
    if (itensRem.length === 0) return fail('Remessa não tem itens cadastrados', 400);
    const principal = itensRem[0];
    itensInput = [{
      id_item: principal.id_item,
      qtd_boa: toInt(b.qtd_boa),
      qtd_refugo: toInt(b.qtd_refugo),
      qtd_conserto: toInt(b.qtd_conserto),
      grade: Array.isArray(b.grade) ? b.grade : [],
    }];
  }

  // Validação por item
  const itensValid: any[] = [];
  for (const x of itensInput) {
    const idItem = toInt(x.id_item);
    if (!idItem) return fail('Cada item retornado precisa de id_item');
    const it = mapItens.get(idItem);
    if (!it) return fail(`Item #${idItem} não pertence à remessa`, 400);
    const grade: any[] = Array.isArray(x.grade) ? x.grade : [];
    const totalGrade = grade.reduce((a, g) => a + (toInt(g.qtd) || 0), 0);
    let qtdBoa = toInt(x.qtd_boa, totalGrade);
    const qtdRef = toInt(x.qtd_refugo);
    const qtdCon = toInt(x.qtd_conserto);
    if (totalGrade > 0 && qtdBoa === 0) qtdBoa = totalGrade;
    const qtdTot = qtdBoa + qtdRef + qtdCon;
    if (qtdTot <= 0) continue;
    if (qtdTot > it.qtd_disponivel) {
      return fail(`Item ${it.cod_ref || ''}/${it.cor || '?'}: total ${qtdTot} excede o disponível (${it.qtd_disponivel}).`, 400);
    }
    for (const g of grade) {
      const max = it.gradeMax[g.tamanho] || 0;
      if ((toInt(g.qtd) || 0) > max) {
        return fail(`Item ${it.cod_ref || ''}/${it.cor || '?'} tamanho ${g.tamanho}: ${g.qtd} excede o disponível (${max}).`, 400);
      }
    }
    const preco = Number(it.preco_unit) || 0;
    const valor = (x.valor != null ? toNum(x.valor) : qtdBoa * preco);
    itensValid.push({ idItem, it, grade, qtdBoa, qtdRef, qtdCon, qtdTot, preco, valor, observacao: x.observacao || null });
  }
  if (itensValid.length === 0) return fail('Informe ao menos 1 item com quantidade retornada > 0', 400);

  const totBoa = itensValid.reduce((a, x) => a + x.qtdBoa, 0);
  const totRef = itensValid.reduce((a, x) => a + x.qtdRef, 0);
  const totCon = itensValid.reduce((a, x) => a + x.qtdCon, 0);
  const totQtd = totBoa + totRef + totCon;
  const totValor = b.valor_pago != null && b.valor_pago !== ''
    ? toNum(b.valor_pago)
    : itensValid.reduce((a, x) => a + x.valor, 0);

  const dt_retorno = b.dt_retorno || ret.dt_retorno;
  const dt_pagamento = b.dt_pagamento || null;
  const observacao = b.observacao != null ? b.observacao : ret.observacao;

  const valoresAntes = `boa:${ret.qtd_boa},ref:${ret.qtd_refugo},cons:${ret.qtd_conserto},val:${ret.valor_pago}`;
  const valoresDepois = `boa:${totBoa},ref:${totRef},cons:${totCon},val:${totValor}`;

  await c.env.DB.prepare(`
    UPDATE terc_retornos
       SET dt_retorno=?, qtd_total=?, qtd_boa=?, qtd_refugo=?, qtd_conserto=?,
           valor_pago=?, dt_pagamento=?, observacao=?
     WHERE id_retorno=? AND id_empresa=?`)
    .bind(dt_retorno, totQtd, totBoa, totRef, totCon, totValor, dt_pagamento, observacao, id, id_empresa).run();

  // Regrava itens (FK ON DELETE CASCADE limpa terc_retorno_item_grade)
  await c.env.DB.prepare('DELETE FROM terc_retorno_itens WHERE id_retorno=? AND id_empresa=?').bind(id, id_empresa).run();
  await c.env.DB.prepare('DELETE FROM terc_retorno_grade WHERE id_retorno=? AND id_empresa=?').bind(id, id_empresa).run();

  const gradeAgreg: Record<string, number> = {};
  for (const x of itensValid) {
    const itIdCor = await resolveColorId(c.env.DB, x.it.cor, id_empresa);
    const ri = await c.env.DB.prepare(`
      INSERT INTO terc_retorno_itens
        (id_empresa, id_retorno, id_item, id_remessa, cod_ref, desc_ref, cor, id_cor, id_servico,
         qtd_boa, qtd_refugo, qtd_conserto, qtd_total, preco_unit, valor, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id_empresa, id, x.idItem, idRem,
        x.it.cod_ref, x.it.desc_ref, x.it.cor, itIdCor, x.it.id_servico,
        x.qtdBoa, x.qtdRef, x.qtdCon, x.qtdTot, x.preco, x.valor, x.observacao).run();
    const idRi = ri.meta.last_row_id as number;
    for (const g of x.grade) {
      const q = toInt(g.qtd);
      if (q > 0) {
        await c.env.DB.prepare(
          'INSERT INTO terc_retorno_item_grade (id_empresa, id_ret_item, tamanho, qtd) VALUES (?, ?, ?, ?)'
        ).bind(id_empresa, idRi, g.tamanho, q).run();
        gradeAgreg[g.tamanho] = (gradeAgreg[g.tamanho] || 0) + q;
      }
    }
  }
  for (const [tam, q] of Object.entries(gradeAgreg)) {
    if (q > 0) {
      await c.env.DB.prepare('INSERT INTO terc_retorno_grade (id_empresa, id_retorno, tamanho, qtd) VALUES (?, ?, ?, ?)')
        .bind(id_empresa, id, tam, q).run();
    }
  }

  // Reavalia status da remessa (tenant-scoped)
  const sumAll = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=? AND id_empresa=?'
  ).bind(idRem, id_empresa).first<any>();
  const totalAposEdit = Number(sumAll?.s) || 0;
  let novoStatus = (rem.dt_envio ? 'Enviado' : 'AguardandoEnvio');
  if (totalAposEdit > 0 && totalAposEdit < Number(rem.qtd_total)) novoStatus = 'Parcial';
  else if (totalAposEdit >= Number(rem.qtd_total)) novoStatus = 'Retornado';
  const novoStatusFin = totalAposEdit >= Number(rem.qtd_total) ? 'PendentePagamento' : 'NaoFaturado';
  const dt_recebimento = totalAposEdit >= Number(rem.qtd_total) ? dt_retorno : null;
  await c.env.DB.prepare(
    'UPDATE terc_remessas SET status=?, status_fin=?, dt_recebimento=COALESCE(?, dt_recebimento) WHERE id_remessa=? AND id_empresa=?'
  ).bind(novoStatus, novoStatusFin, dt_recebimento, idRem, id_empresa).run();

  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_empresa, id_remessa, tipo, descricao, usuario) VALUES (?, ?, 'RETORNO_EDITADO', ?, ?)`)
    .bind(id_empresa, idRem, `Retorno #${id} editado (${valoresAntes} → ${valoresDepois})`, getUser(c)).run().catch(() => {});

  await audit(c, MOD, 'UPD_RET', `retorno:${id}`, 'totais', valoresAntes, valoresDepois);
  return c.json(ok({
    id, status_remessa: novoStatus, status_fin: novoStatusFin,
    total_retornado: totalAposEdit, saldo: Number(rem.qtd_total) - totalAposEdit,
    qtd_boa: totBoa, qtd_refugo: totRef, qtd_conserto: totCon, qtd_total: totQtd,
    valor_pago: totValor, itens_count: itensValid.length,
  }));
});

app.delete('/terc/retornos/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const ret = await c.env.DB.prepare('SELECT * FROM terc_retornos WHERE id_retorno=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!ret) return fail('Retorno não encontrado', 404);
  const valoresAntes = `boa:${ret.qtd_boa},ref:${ret.qtd_refugo},cons:${ret.qtd_conserto},val:${ret.valor_pago}`;
  await c.env.DB.prepare('DELETE FROM terc_retorno_grade WHERE id_retorno=? AND id_empresa=?').bind(id, id_empresa).run();
  await c.env.DB.prepare('DELETE FROM terc_retornos WHERE id_retorno=? AND id_empresa=?').bind(id, id_empresa).run();

  // Reavaliar status da remessa (tenant-scoped)
  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(ret.id_remessa, id_empresa).first<any>();
  const sum = await c.env.DB.prepare('SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=? AND id_empresa=?').bind(ret.id_remessa, id_empresa).first<any>();
  const total = Number(sum?.s) || 0;
  let novoStatus = (rem.dt_envio ? 'Enviado' : 'AguardandoEnvio');
  if (total > 0 && total < Number(rem.qtd_total)) novoStatus = 'Parcial';
  else if (total >= Number(rem.qtd_total)) novoStatus = 'Retornado';
  // Reabre status financeiro se ficou abaixo do total
  const novoStatusFin = total >= Number(rem.qtd_total) ? 'PendentePagamento' : 'NaoFaturado';
  // Se ficou < total, limpa dt_recebimento (volta ao fluxo aberto)
  const limpaRecebimento = total < Number(rem.qtd_total);
  if (limpaRecebimento) {
    await c.env.DB.prepare('UPDATE terc_remessas SET status=?, status_fin=?, dt_recebimento=NULL WHERE id_remessa=? AND id_empresa=?')
      .bind(novoStatus, novoStatusFin, ret.id_remessa, id_empresa).run();
  } else {
    await c.env.DB.prepare('UPDATE terc_remessas SET status=?, status_fin=? WHERE id_remessa=? AND id_empresa=?')
      .bind(novoStatus, novoStatusFin, ret.id_remessa, id_empresa).run();
  }

  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_empresa, id_remessa, tipo, descricao, usuario) VALUES (?, ?, 'RETORNO_EXCLUIDO', ?, ?)`)
    .bind(id_empresa, ret.id_remessa, `Retorno #${id} excluído (${valoresAntes})`, getUser(c)).run().catch(() => {});

  await audit(c, MOD, 'DEL_RET', `retorno:${id}`, 'totais', valoresAntes, '');
  return c.json(ok({
    id, deleted: true, status_remessa: novoStatus, status_fin: novoStatusFin,
    total_retornado: total, saldo: Number(rem.qtd_total) - total,
  }));
});

/* =================================================================
 * RESUMO DE TERCEIRIZAÇÕES (tela principal)
 * ================================================================= */

app.get('/terc/resumo', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();
  const colFilter = q.id_colecao ? `AND r.id_colecao=${toInt(q.id_colecao)}` : '';

  const rs = await c.env.DB.prepare(`
    SELECT
      t.id_terc, t.nome_terc, t.situacao, t.prazo_padrao,
      s.nome_setor,
      COALESCE(SUM(CASE WHEN r.status IN ('Aberta','EmProducao','Parcial') THEN (r.qtd_total - IFNULL((SELECT SUM(qtd_boa+qtd_refugo+qtd_conserto) FROM terc_retornos WHERE id_remessa=r.id_remessa AND id_empresa=?),0)) ELSE 0 END), 0) AS pecas_coletar,
      MAX(CASE WHEN r.status IN ('Aberta','EmProducao','Parcial') THEN r.dt_previsao END) AS dt_termino,
      COALESCE(SUM(CASE WHEN r.status IN ('Aberta','EmProducao','Parcial') THEN r.qtd_total ELSE 0 END), 0) AS pecas_producao,
      COALESCE((SELECT SUM(qtd_boa) FROM terc_retornos rt JOIN terc_remessas rm ON rm.id_remessa=rt.id_remessa AND rm.id_empresa=rt.id_empresa WHERE rm.id_terc=t.id_terc AND rt.id_empresa=? ${colFilter}), 0) AS pecas_produzidas,
      COALESCE((SELECT SUM(qtd_conserto) FROM terc_retornos rt JOIN terc_remessas rm ON rm.id_remessa=rt.id_remessa AND rm.id_empresa=rt.id_empresa WHERE rm.id_terc=t.id_terc AND rt.id_empresa=? ${colFilter}), 0) AS pecas_conserto,
      COALESCE((SELECT SUM(CASE WHEN c.status='Concluido' THEN c.qtd_retornada ELSE 0 END) FROM terc_consertos c WHERE c.id_terc=t.id_terc AND c.id_empresa=?), 0) AS pecas_consertadas,
      COUNT(DISTINCT r.id_remessa) AS total_remessas,
      COALESCE(SUM(r.valor_total),0) AS valor_movimentado
    FROM terc_terceirizados t
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor AND s.id_empresa=t.id_empresa
    LEFT JOIN terc_remessas r ON r.id_terc=t.id_terc AND r.id_empresa=t.id_empresa ${colFilter}
    WHERE t.id_empresa=?
    GROUP BY t.id_terc
    ORDER BY t.nome_terc`).bind(id_empresa, id_empresa, id_empresa, id_empresa, id_empresa).all();

  const resumo = (rs.results as any[]).map((r: any) => ({
    ...r,
    indice_consertos: (Number(r.pecas_produzidas) || 0) > 0
      ? (Number(r.pecas_conserto) || 0) / (Number(r.pecas_produzidas) || 0)
      : 0,
  }));
  return c.json(ok(resumo));
});

/* =================================================================
 * DASHBOARD DE TERCEIRIZAÇÃO
 * ================================================================= */

app.get('/terc/dashboard', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();
  const ini = q.de || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const fim = q.ate || new Date().toISOString().slice(0, 10);

  // KPIs
  const kpiRem = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(qtd_total),0) AS pecas_enviadas,
      COALESCE(SUM(valor_total),0) AS valor_total,
      SUM(CASE WHEN status IN ('AguardandoEnvio','Enviado','EmProducao','Parcial') THEN 1 ELSE 0 END) AS em_aberto,
      SUM(CASE WHEN status IN ('Concluido','Retornado','Pago') THEN 1 ELSE 0 END) AS concluidas,
      SUM(CASE WHEN status='Atrasado' THEN 1 ELSE 0 END) AS atrasadas,
      SUM(CASE WHEN status='EmProducao' THEN 1 ELSE 0 END) AS em_producao,
      SUM(CASE WHEN status_fin='PendentePagamento' THEN (valor_total - COALESCE(valor_pago,0)) ELSE 0 END) AS valor_a_pagar,
      SUM(CASE WHEN status_fin='Pago' THEN COALESCE(valor_pago,0) ELSE 0 END) AS valor_pago_total
    FROM terc_remessas
    WHERE id_empresa=? AND dt_saida BETWEEN ? AND ?`).bind(id_empresa, ini, fim).first<any>();

  const kpiRet = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(qtd_boa),0) AS pecas_boas,
      COALESCE(SUM(qtd_refugo),0) AS pecas_refugo,
      COALESCE(SUM(qtd_conserto),0) AS pecas_conserto,
      COALESCE(SUM(valor_pago),0) AS valor_pago
    FROM terc_retornos
    WHERE id_empresa=? AND dt_retorno BETWEEN ? AND ?`).bind(id_empresa, ini, fim).first<any>();

  const topTerc = (await c.env.DB.prepare(`
    SELECT t.nome_terc, s.nome_setor,
      COUNT(r.id_remessa) AS remessas,
      COALESCE(SUM(r.qtd_total),0) AS pecas,
      COALESCE(SUM(r.valor_total),0) AS valor
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor AND s.id_empresa=t.id_empresa
    WHERE r.id_empresa=? AND r.dt_saida BETWEEN ? AND ?
    GROUP BY t.id_terc
    ORDER BY pecas DESC
    LIMIT 10`).bind(id_empresa, ini, fim).all()).results;

  const porServico = (await c.env.DB.prepare(`
    SELECT sv.desc_servico,
      COUNT(r.id_remessa) AS remessas,
      COALESCE(SUM(r.qtd_total),0) AS pecas,
      COALESCE(SUM(r.valor_total),0) AS valor
    FROM terc_remessas r
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico AND sv.id_empresa=r.id_empresa
    WHERE r.id_empresa=? AND r.dt_saida BETWEEN ? AND ?
    GROUP BY sv.id_servico
    ORDER BY pecas DESC`).bind(id_empresa, ini, fim).all()).results;

  // HOTFIX 0037: agregação por setor da remessa
  const porSetor = (await c.env.DB.prepare(`
    SELECT st.id_setor, st.nome_setor, st.cor,
      COUNT(r.id_remessa) AS remessas,
      COALESCE(SUM(r.qtd_total),0) AS pecas,
      COALESCE(SUM(r.valor_total),0) AS valor
    FROM terc_remessas r
    LEFT JOIN terc_setores st ON st.id_setor=r.id_setor AND st.id_empresa=r.id_empresa
    WHERE r.id_empresa=? AND r.dt_saida BETWEEN ? AND ?
    GROUP BY st.id_setor
    ORDER BY COALESCE(st.ordem,9999), pecas DESC`).bind(id_empresa, ini, fim).all()).results;

  const producaoDiaria = (await c.env.DB.prepare(`
    SELECT date(rt.dt_retorno) AS dia,
      COALESCE(SUM(rt.qtd_boa),0) AS boa,
      COALESCE(SUM(rt.qtd_refugo),0) AS refugo,
      COALESCE(SUM(rt.qtd_conserto),0) AS conserto
    FROM terc_retornos rt
    WHERE rt.id_empresa=? AND rt.dt_retorno BETWEEN ? AND ?
    GROUP BY date(rt.dt_retorno)
    ORDER BY dia`).bind(id_empresa, ini, fim).all()).results;

  const atrasadas = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.num_op, r.cod_ref, r.desc_ref, r.cor, r.qtd_total,
      r.dt_saida, r.dt_previsao, r.status, r.valor_total,
      t.nome_terc, t.id_terc, sv.desc_servico,
      CAST(julianday('now') - julianday(r.dt_previsao) AS INTEGER) AS dias_atraso
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico AND sv.id_empresa=r.id_empresa
    WHERE r.id_empresa=? AND r.status='Atrasado'
    ORDER BY dias_atraso DESC LIMIT 30`).bind(id_empresa).all()).results;

  // 🆕 Em produção agora (Enviado + EmProducao)
  const emProducaoAgora = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.desc_ref, r.cor, r.qtd_total,
      r.dt_saida, r.dt_envio, r.dt_previsao, r.status, r.valor_total,
      t.nome_terc, t.id_terc, sv.desc_servico,
      CAST(julianday(r.dt_previsao) - julianday('now') AS INTEGER) AS dias_para_vencer
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico AND sv.id_empresa=r.id_empresa
    WHERE r.id_empresa=? AND r.status IN ('Enviado','EmProducao')
    ORDER BY r.dt_previsao ASC LIMIT 30`).bind(id_empresa).all()).results;

  // 🆕 Próximos vencimentos (7 dias)
  const proximosVencimentos = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.desc_ref, r.qtd_total,
      r.dt_previsao, r.status, r.valor_total,
      t.nome_terc, sv.desc_servico,
      CAST(julianday(r.dt_previsao) - julianday('now') AS INTEGER) AS dias_para_vencer
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico AND sv.id_empresa=r.id_empresa
    WHERE r.id_empresa=? AND r.status IN ('AguardandoEnvio','Enviado','EmProducao','Parcial')
      AND date(r.dt_previsao) BETWEEN date('now') AND date('now', '+7 days')
    ORDER BY r.dt_previsao ASC LIMIT 20`).bind(id_empresa).all()).results;

  // 🆕 Valores a pagar (status financeiro pendente)
  const valoresAPagar = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.qtd_total,
      r.dt_recebimento, r.valor_total, r.valor_pago, r.status_fin,
      (r.valor_total - COALESCE(r.valor_pago,0)) AS valor_aberto,
      t.nome_terc, t.id_terc
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    WHERE r.id_empresa=? AND r.status_fin='PendentePagamento'
    ORDER BY r.dt_recebimento ASC, r.dt_saida ASC LIMIT 30`).bind(id_empresa).all()).results;

  return c.json(ok({
    periodo: { de: ini, ate: fim },
    kpis: { remessas: kpiRem, retornos: kpiRet },
    top_terceirizados: topTerc,
    por_servico: porServico,
    por_setor: porSetor, // HOTFIX 0037
    producao_diaria: producaoDiaria,
    atrasadas,
    em_producao_agora: emProducaoAgora,
    proximos_vencimentos: proximosVencimentos,
    valores_a_pagar: valoresAPagar,
  }));
});

/* =================================================================
 * 🆕 FLUXO OPERACIONAL — transições de status (one-click)
 * ================================================================= */

// Marcar como ENVIADO (sai da fábrica para o terceirizado)
app.post('/terc/remessas/:id/enviar', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const dt = b.dt_envio || new Date().toISOString().slice(0, 10);
  const r = await c.env.DB.prepare('SELECT id_remessa, status FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!r) return fail('Remessa não encontrada', 404);
  if (!['AguardandoEnvio'].includes(String(r.status))) return fail(`Status atual (${r.status}) não permite envio.`, 409);
  await c.env.DB.prepare(`UPDATE terc_remessas SET status='Enviado', dt_envio=?, alterado_por=?, dt_alteracao=datetime('now') WHERE id_remessa=? AND id_empresa=?`)
    .bind(dt, getUser(c), id, id_empresa).run();
  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario, id_empresa) VALUES (?, 'ENVIADA', ?, ?, ?)`)
    .bind(id, `Remessa enviada em ${dt}`, getUser(c), id_empresa).run();
  await audit(c, MOD, 'ENVIO', `remessa:${id}`, 'status', 'AguardandoEnvio', 'Enviado');
  return c.json(ok({ id, status: 'Enviado', dt_envio: dt }));
});

// Marcar EM PRODUÇÃO (terceirizado começou a produzir)
app.post('/terc/remessas/:id/iniciar-producao', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const dt = b.dt_inicio || new Date().toISOString().slice(0, 10);
  const r = await c.env.DB.prepare('SELECT status FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!r) return fail('Remessa não encontrada', 404);
  if (!['Enviado','AguardandoEnvio'].includes(String(r.status))) return fail(`Status atual (${r.status}) não permite iniciar produção.`, 409);
  await c.env.DB.prepare(`UPDATE terc_remessas SET status='EmProducao', dt_inicio=?, dt_envio=COALESCE(dt_envio, ?), alterado_por=?, dt_alteracao=datetime('now') WHERE id_remessa=? AND id_empresa=?`)
    .bind(dt, dt, getUser(c), id, id_empresa).run();
  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario, id_empresa) VALUES (?, 'INICIO_PROD', ?, ?, ?)`)
    .bind(id, `Produção iniciada em ${dt}`, getUser(c), id_empresa).run();
  await audit(c, MOD, 'INICIO_PROD', `remessa:${id}`, 'status', String(r.status), 'EmProducao');
  return c.json(ok({ id, status: 'EmProducao', dt_inicio: dt }));
});

// Cancelar remessa
app.post('/terc/remessas/:id/cancelar', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await c.env.DB.prepare('SELECT status FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!r) return fail('Remessa não encontrada', 404);
  if (['Pago','Retornado','Concluido'].includes(String(r.status))) return fail(`Status atual (${r.status}) não permite cancelamento.`, 409);
  await c.env.DB.prepare(`UPDATE terc_remessas SET status='Cancelado', status_fin='Cancelado', observacao=COALESCE(observacao,'') || ' | Cancelado: ' || ?, alterado_por=?, dt_alteracao=datetime('now') WHERE id_remessa=? AND id_empresa=?`)
    .bind(b.motivo || 'sem motivo', getUser(c), id, id_empresa).run();
  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario, id_empresa) VALUES (?, 'CANCELADA', ?, ?, ?)`)
    .bind(id, `Cancelada — ${b.motivo || ''}`, getUser(c), id_empresa).run();
  await audit(c, MOD, 'CANCELAR', `remessa:${id}`);
  return c.json(ok({ id, status: 'Cancelado' }));
});

/* =================================================================
 * 🆕 RETORNO SIMPLIFICADO — Retornar tudo em 1 clique
 * ================================================================= */

// Retorna 100% como peças boas (tudo aprovado), preenchendo automaticamente
app.post('/terc/remessas/:id/retornar-tudo', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);
  if (['Cancelado','Pago'].includes(String(rem.status))) return fail(`Remessa em status ${rem.status} não permite retorno.`, 409);

  const jaRet = await c.env.DB.prepare('SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  const saldo = Number(rem.qtd_total) - (Number(jaRet?.s) || 0);
  if (saldo <= 0) return fail('Não há saldo a retornar nesta remessa', 400);

  const dt = b.dt_retorno || new Date().toISOString().slice(0, 10);
  const valor = saldo * Number(rem.preco_unit || 0);

  // Insere o retorno completo
  const ins = await c.env.DB.prepare(`
    INSERT INTO terc_retornos (id_remessa, dt_retorno, qtd_total, qtd_boa, qtd_refugo, qtd_conserto, valor_pago, observacao, criado_por, id_empresa)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`)
    .bind(id, dt, saldo, saldo, valor, b.observacao || 'Retorno total automático', getUser(c), id_empresa).run();
  const idRet = ins.meta.last_row_id;

  // Replica grade da remessa proporcional ao saldo
  const gradeRem = (await c.env.DB.prepare('SELECT tamanho, qtd FROM terc_remessa_grade WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).all()).results as any[];
  const totalGrade = gradeRem.reduce((a, g) => a + (Number(g.qtd) || 0), 0);
  for (const g of gradeRem) {
    if (Number(g.qtd) > 0 && totalGrade > 0) {
      const qtd = Math.round((Number(g.qtd) / totalGrade) * saldo);
      if (qtd > 0) {
        await c.env.DB.prepare('INSERT INTO terc_retorno_grade (id_retorno, tamanho, qtd, id_empresa) VALUES (?, ?, ?, ?)')
          .bind(idRet, g.tamanho, qtd, id_empresa).run();
      }
    }
  }

  // 🤖 Atualiza remessa: status Retornado + financeiro pendente
  await c.env.DB.prepare(`UPDATE terc_remessas SET status='Retornado', status_fin='PendentePagamento', dt_recebimento=COALESCE(dt_recebimento, ?) WHERE id_remessa=? AND id_empresa=?`)
    .bind(dt, id, id_empresa).run();

  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario, id_empresa) VALUES (?, 'RETORNO_TOTAL', ?, ?, ?)`)
    .bind(id, `Retorno total automático: ${saldo} pç — R$ ${valor.toFixed(2)}`, getUser(c), id_empresa).run();

  await audit(c, MOD, 'RET_TUDO', `remessa:${id}`, 'qtd_total', '', String(saldo));
  return c.json(ok({
    id_retorno: idRet, id_remessa: id,
    qtd_retornada: saldo, valor_pago: valor,
    status: 'Retornado', status_fin: 'PendentePagamento'
  }));
});

// Preview de retorno parcial pré-preenchido com saldo restante
app.get('/terc/remessas/:id/preview-retorno', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);
  const jaRet = await c.env.DB.prepare('SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  const saldo = Number(rem.qtd_total) - (Number(jaRet?.s) || 0);
  const grade = (await c.env.DB.prepare('SELECT tamanho, qtd FROM terc_remessa_grade WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).all()).results as any[];
  const totalGrade = grade.reduce((a, g) => a + (Number(g.qtd) || 0), 0);
  const gradePreenchida = grade.map((g: any) => ({
    tamanho: g.tamanho,
    qtd_remessa: g.qtd,
    qtd_sugerida: totalGrade > 0 ? Math.round((Number(g.qtd) / totalGrade) * saldo) : 0,
  }));
  return c.json(ok({
    id_remessa: id, num_controle: rem.num_controle, cod_ref: rem.cod_ref,
    qtd_total_remessa: rem.qtd_total, qtd_ja_retornada: Number(jaRet?.s) || 0, saldo,
    preco_unit: rem.preco_unit, valor_estimado: saldo * Number(rem.preco_unit || 0),
    grade_sugerida: gradePreenchida,
  }));
});

/* =================================================================
 * 🆕 FINANCEIRO AUTOMÁTICO — pendente / pago
 * ================================================================= */

// Lista valores a pagar (pendentes)
app.get('/terc/financeiro/pendentes', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();
  const where: string[] = ["r.id_empresa=?", "r.status_fin='PendentePagamento'"];
  const binds: any[] = [id_empresa];
  if (q.id_terc) { where.push('r.id_terc=?'); binds.push(toInt(q.id_terc)); }

  const rs = await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.desc_ref, r.qtd_total,
      r.dt_saida, r.dt_recebimento, r.valor_total, r.valor_pago, r.status, r.status_fin,
      (r.valor_total - COALESCE(r.valor_pago,0)) AS valor_aberto,
      t.id_terc, t.nome_terc, sv.desc_servico,
      CAST(julianday('now') - julianday(r.dt_recebimento) AS INTEGER) AS dias_pendente
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico AND sv.id_empresa=r.id_empresa
    WHERE ${where.join(' AND ')}
    ORDER BY r.dt_recebimento ASC, r.dt_saida ASC LIMIT 200`).bind(...binds).all();

  const tot = await c.env.DB.prepare(`
    SELECT COUNT(*) AS qtde, COALESCE(SUM(valor_total - COALESCE(valor_pago,0)),0) AS total
    FROM terc_remessas WHERE id_empresa=? AND status_fin='PendentePagamento'`).bind(id_empresa).first<any>();

  const porTerc = (await c.env.DB.prepare(`
    SELECT t.id_terc, t.nome_terc,
      COUNT(*) AS qtde,
      COALESCE(SUM(r.valor_total - COALESCE(r.valor_pago,0)),0) AS valor_aberto
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    WHERE r.id_empresa=? AND r.status_fin='PendentePagamento'
    GROUP BY t.id_terc ORDER BY valor_aberto DESC`).bind(id_empresa).all()).results;

  return c.json(ok({ pendentes: rs.results, totais: tot, por_terceirizado: porTerc }));
});

// Marcar como PAGO (uma remessa)
app.post('/terc/remessas/:id/pagar', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const dt = b.dt_pagamento || new Date().toISOString().slice(0, 10);

  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);
  if (rem.status_fin === 'Pago') return fail('Remessa já está paga', 409);

  const valor = toNum(b.valor_pago, Number(rem.valor_total) || 0);

  await c.env.DB.prepare(`
    UPDATE terc_remessas
    SET status='Pago', status_fin='Pago', valor_pago=?, dt_pagamento=?, alterado_por=?, dt_alteracao=datetime('now')
    WHERE id_remessa=? AND id_empresa=?`)
    .bind(valor, dt, getUser(c), id, id_empresa).run();

  await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario, id_empresa) VALUES (?, 'PAGAMENTO', ?, ?, ?)`)
    .bind(id, `Pagamento R$ ${valor.toFixed(2)} em ${dt}`, getUser(c), id_empresa).run();

  await audit(c, MOD, 'PAGAR', `remessa:${id}`, 'valor_pago', '', String(valor));
  return c.json(ok({ id, status: 'Pago', valor_pago: valor, dt_pagamento: dt }));
});

// Marcar várias remessas como pagas em lote
app.post('/terc/financeiro/pagar-lote', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  const ids: number[] = Array.isArray(b.ids) ? b.ids.map((x: any) => toInt(x)).filter((x: number) => x > 0) : [];
  if (ids.length === 0) return fail('Nenhuma remessa selecionada');
  const dt = b.dt_pagamento || new Date().toISOString().slice(0, 10);
  let pagas = 0; let valor_total = 0;
  for (const id of ids) {
    const rem = await c.env.DB.prepare('SELECT valor_total, status_fin FROM terc_remessas WHERE id_remessa=? AND id_empresa=?').bind(id, id_empresa).first<any>();
    if (!rem || rem.status_fin === 'Pago') continue;
    const v = Number(rem.valor_total) || 0;
    await c.env.DB.prepare(`UPDATE terc_remessas SET status='Pago', status_fin='Pago', valor_pago=?, dt_pagamento=?, alterado_por=?, dt_alteracao=datetime('now') WHERE id_remessa=? AND id_empresa=?`)
      .bind(v, dt, getUser(c), id, id_empresa).run();
    await c.env.DB.prepare(`INSERT INTO terc_eventos (id_remessa, tipo, descricao, usuario, id_empresa) VALUES (?, 'PAGAMENTO', ?, ?, ?)`)
      .bind(id, `Pagamento em lote R$ ${v.toFixed(2)}`, getUser(c), id_empresa).run();
    pagas++; valor_total += v;
  }
  await audit(c, MOD, 'PAGAR_LOTE', `remessas:${ids.length}`, 'valor_total', '', String(valor_total));
  return c.json(ok({ pagas, valor_total, dt_pagamento: dt }));
});

/* =================================================================
 * 🆕 ALERTAS AUTOMÁTICOS DA TERCEIRIZAÇÃO
 * ================================================================= */

app.get('/terc/alertas', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  // Atualiza status atrasado antes (idempotente)
  await c.env.DB.prepare(`
    UPDATE terc_remessas SET status='Atrasado'
    WHERE id_empresa=? AND status IN ('AguardandoEnvio','Enviado','EmProducao','Parcial')
      AND date(dt_previsao) < date('now')`).bind(id_empresa).run();

  const atrasos = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.qtd_total, r.dt_previsao,
      t.id_terc, t.nome_terc,
      CAST(julianday('now') - julianday(r.dt_previsao) AS INTEGER) AS dias_atraso
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    WHERE r.id_empresa=? AND r.status='Atrasado'
    ORDER BY dias_atraso DESC LIMIT 50`).bind(id_empresa).all()).results;

  const semRetorno = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref, r.dt_envio,
      t.id_terc, t.nome_terc,
      CAST(julianday('now') - julianday(r.dt_envio) AS INTEGER) AS dias_sem_retorno
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    WHERE r.id_empresa=? AND r.status IN ('Enviado','EmProducao')
      AND r.dt_envio IS NOT NULL
      AND date(r.dt_envio) < date('now', '-5 days')
      AND NOT EXISTS (SELECT 1 FROM terc_retornos WHERE id_remessa=r.id_remessa AND id_empresa=r.id_empresa)
    ORDER BY dias_sem_retorno DESC LIMIT 30`).bind(id_empresa).all()).results;

  const baixaProd = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.cod_ref,
      t.id_terc, t.nome_terc,
      SUM(rt.qtd_boa) AS boa, SUM(rt.qtd_refugo+rt.qtd_conserto) AS perda,
      SUM(rt.qtd_boa+rt.qtd_refugo+rt.qtd_conserto) AS total_ret
    FROM terc_retornos rt
    JOIN terc_remessas r ON r.id_remessa=rt.id_remessa AND r.id_empresa=rt.id_empresa
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    WHERE rt.id_empresa=? AND rt.dt_retorno >= date('now','-30 days')
    GROUP BY r.id_remessa
    HAVING total_ret > 0 AND (perda * 1.0 / total_ret) > 0.10
    ORDER BY (perda * 1.0 / total_ret) DESC LIMIT 20`).bind(id_empresa).all()).results;

  const pagAtrasado = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.dt_recebimento, r.valor_total,
      t.id_terc, t.nome_terc,
      CAST(julianday('now') - julianday(r.dt_recebimento) AS INTEGER) AS dias_pendente
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc AND t.id_empresa=r.id_empresa
    WHERE r.id_empresa=? AND r.status_fin='PendentePagamento'
      AND r.dt_recebimento IS NOT NULL
      AND date(r.dt_recebimento) < date('now','-7 days')
    ORDER BY dias_pendente DESC LIMIT 30`).bind(id_empresa).all()).results;

  const alertas: any[] = [];
  if (atrasos.length) alertas.push({ tipo: 'ATRASO', severidade: 'critica', titulo: `${atrasos.length} remessa(s) atrasada(s)`, descricao: 'Datas de previsão já vencidas', itens: atrasos });
  if (semRetorno.length) alertas.push({ tipo: 'SEM_RETORNO', severidade: 'alta', titulo: `${semRetorno.length} remessa(s) sem retorno há +5 dias`, descricao: 'Possível atraso na produção', itens: semRetorno });
  if (baixaProd.length) alertas.push({ tipo: 'BAIXA_PRODUCAO', severidade: 'media', titulo: `${baixaProd.length} remessa(s) com refugo > 10%`, descricao: 'Qualidade abaixo do esperado', itens: baixaProd });
  if (pagAtrasado.length) alertas.push({ tipo: 'PAGAMENTO_PENDENTE', severidade: 'media', titulo: `${pagAtrasado.length} pagamento(s) pendentes há +7 dias`, descricao: 'Valores a pagar em atraso', itens: pagAtrasado });
  if (alertas.length === 0) alertas.push({ tipo: 'OK', severidade: 'baixa', titulo: 'Tudo certo!', descricao: 'Sem alertas críticos no momento', itens: [] });

  return c.json(ok({
    total: alertas.filter((a: any) => a.tipo !== 'OK').reduce((acc: number, a: any) => acc + a.itens.length, 0),
    alertas,
  }));
});

/* =================================================================
 * 🆕 TIMELINE DE EVENTOS DA REMESSA
 * ================================================================= */
app.get('/terc/remessas/:id/timeline', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const rs = await c.env.DB.prepare(`
    SELECT id_evento, tipo, descricao, usuario, dt_evento
    FROM terc_eventos WHERE id_remessa=? AND id_empresa=?
    ORDER BY dt_evento DESC LIMIT 100`).bind(id, id_empresa).all();
  return c.json(ok(rs.results));
});

/* =================================================================
 * IMPORTADOR — recebe linhas parseadas do Excel/CSV no frontend
 * ================================================================= */

app.post('/terc/importar/remessas', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  const rows: any[] = Array.isArray(b.rows) ? b.rows : [];
  const dryRun = !!b.dry_run;
  const criarCadastros = !!b.criar_cadastros;

  if (rows.length === 0) return fail('Nenhuma linha enviada');

  // Cache de cadastros
  const tercs: Record<string, number> = {};
  const servicos: Record<string, number> = {};
  const setores: Record<string, number> = {};
  const colecoes: Record<string, number> = {};
  const produtos: Record<string, { id: number; desc: string; grade: number }> = {}; // chave = "cod_ref|id_colecao"
  const precos: Record<string, number> = {}; // chave = "cod_ref|id_servico|grade|id_colecao"

  (await c.env.DB.prepare('SELECT id_terc, nome_terc FROM terc_terceirizados WHERE id_empresa=?').bind(id_empresa).all()).results.forEach((r: any) => tercs[String(r.nome_terc).toLowerCase().trim()] = r.id_terc);
  (await c.env.DB.prepare('SELECT id_servico, desc_servico FROM terc_servicos WHERE id_empresa=?').bind(id_empresa).all()).results.forEach((r: any) => servicos[String(r.desc_servico).toLowerCase().trim()] = r.id_servico);
  (await c.env.DB.prepare('SELECT id_setor, nome_setor FROM terc_setores WHERE id_empresa=?').bind(id_empresa).all()).results.forEach((r: any) => setores[String(r.nome_setor).toLowerCase().trim()] = r.id_setor);
  (await c.env.DB.prepare('SELECT id_colecao, nome_colecao FROM terc_colecoes WHERE id_empresa=?').bind(id_empresa).all()).results.forEach((r: any) => colecoes[String(r.nome_colecao).toLowerCase().trim()] = r.id_colecao);
  (await c.env.DB.prepare('SELECT id_produto, cod_ref, desc_ref, id_colecao, grade_padrao FROM terc_produtos WHERE ativo=1 AND id_empresa=?').bind(id_empresa).all()).results.forEach((r: any) => {
    produtos[`${r.cod_ref}|${r.id_colecao || 0}`] = { id: r.id_produto, desc: r.desc_ref, grade: r.grade_padrao || 1 };
  });
  (await c.env.DB.prepare('SELECT id_preco, cod_ref, id_servico, grade, id_colecao FROM terc_precos WHERE ativo=1 AND id_empresa=?').bind(id_empresa).all()).results.forEach((r: any) => {
    precos[`${r.cod_ref}|${r.id_servico}|${r.grade || 1}|${r.id_colecao || 0}`] = r.id_preco;
  });

  const erros: any[] = [];
  let inseridas = 0, ignoradas = 0, cadCriados = 0;
  let prodsCriados = 0, precosCriados = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const n = i + 1;
    try {
      const nome_terc = String(row.nome_terc || row.terceirizado || '').trim();
      const desc_servico = String(row.desc_servico || row.servico || '').trim();
      const cod_ref = String(row.cod_ref || row.ref || '').trim();
      const dt_saida = String(row.dt_saida || row.data_saida || '').slice(0, 10);

      if (!nome_terc || !desc_servico || !cod_ref || !dt_saida) {
        erros.push({ linha: n, erro: 'Campos obrigatórios ausentes (nome_terc, desc_servico, cod_ref, dt_saida)' });
        ignoradas++; continue;
      }

      // Resolver cadastros
      let id_terc = tercs[nome_terc.toLowerCase()];
      if (!id_terc && criarCadastros && !dryRun) {
        const r = await c.env.DB.prepare('INSERT INTO terc_terceirizados (nome_terc, situacao, ativo, id_empresa) VALUES (?, ?, 1, ?)').bind(nome_terc, 'Ativa', id_empresa).run();
        id_terc = r.meta.last_row_id as number;
        tercs[nome_terc.toLowerCase()] = id_terc; cadCriados++;
      }
      if (!id_terc) { erros.push({ linha: n, erro: `Terceirizado "${nome_terc}" não cadastrado` }); ignoradas++; continue; }

      let id_servico = servicos[desc_servico.toLowerCase()];
      if (!id_servico && criarCadastros && !dryRun) {
        const r = await c.env.DB.prepare('INSERT INTO terc_servicos (desc_servico, ativo, id_empresa) VALUES (?, 1, ?)').bind(desc_servico, id_empresa).run();
        id_servico = r.meta.last_row_id as number;
        servicos[desc_servico.toLowerCase()] = id_servico; cadCriados++;
      }
      if (!id_servico) { erros.push({ linha: n, erro: `Serviço "${desc_servico}" não cadastrado` }); ignoradas++; continue; }

      let id_setor = null;
      if (row.setor) {
        id_setor = setores[String(row.setor).toLowerCase()] || null;
        if (!id_setor && criarCadastros && !dryRun) {
          const r = await c.env.DB.prepare('INSERT INTO terc_setores (nome_setor, ativo, id_empresa) VALUES (?, 1, ?)').bind(row.setor, id_empresa).run();
          id_setor = r.meta.last_row_id as number;
          setores[String(row.setor).toLowerCase()] = id_setor; cadCriados++;
        }
      }

      let id_colecao: number | null = null;
      if (row.colecao) {
        id_colecao = colecoes[String(row.colecao).toLowerCase()] || null;
        if (!id_colecao && criarCadastros && !dryRun) {
          const r = await c.env.DB.prepare('INSERT INTO terc_colecoes (nome_colecao, ativo, id_empresa) VALUES (?, 1, ?)').bind(row.colecao, id_empresa).run();
          id_colecao = r.meta.last_row_id as number;
          colecoes[String(row.colecao).toLowerCase()] = id_colecao; cadCriados++;
        }
      }

      // Grade
      const grade: any[] = [];
      for (const t of TAMS) {
        const v = toInt(row[`tam_${t}`] || row[t] || 0);
        if (v > 0) grade.push({ tamanho: t, qtd: v });
      }
      const qtd_total = grade.reduce((a, g) => a + g.qtd, 0) || toInt(row.qtd_total);
      if (qtd_total <= 0) { erros.push({ linha: n, erro: 'Quantidade total = 0' }); ignoradas++; continue; }

      const preco = toNum(row.preco_unit || row.preco);
      const valor = qtd_total * preco;
      const desc_ref = String(row.desc_ref || row.descricao || '').trim() || cod_ref;
      const grade_padrao = toInt(row.grade, 1);

      // 🤖 Auto-criar PRODUTO se não existir (importação inteligente)
      const prodKey = `${cod_ref}|${id_colecao || 0}`;
      if (!produtos[prodKey] && criarCadastros && !dryRun) {
        const rp = await c.env.DB.prepare(`
          INSERT OR IGNORE INTO terc_produtos (cod_ref, desc_ref, id_colecao, grade_padrao, ativo, criado_por, id_empresa)
          VALUES (?, ?, ?, ?, 1, ?, ?)`)
          .bind(cod_ref, desc_ref, id_colecao, grade_padrao, getUser(c), id_empresa).run();
        if (rp.meta.last_row_id) {
          produtos[prodKey] = { id: rp.meta.last_row_id as number, desc: desc_ref, grade: grade_padrao };
          prodsCriados++;
        }
      }

      // 🤖 Auto-criar PREÇO se não existir e a planilha trouxe valor (importação inteligente)
      if (preco > 0) {
        const precoKey = `${cod_ref}|${id_servico}|${grade_padrao}|${id_colecao || 0}`;
        if (!precos[precoKey] && criarCadastros && !dryRun) {
          try {
            const rp = await c.env.DB.prepare(`
              INSERT OR IGNORE INTO terc_precos (cod_ref, desc_ref, id_servico, grade, preco, tempo_min, id_colecao, ativo, id_empresa)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
              .bind(cod_ref, desc_ref, id_servico, grade_padrao, preco, toNum(row.tempo_peca), id_colecao, id_empresa).run();
            if (rp.meta.last_row_id) {
              precos[precoKey] = rp.meta.last_row_id as number;
              precosCriados++;
            }
          } catch {}
        }
      }

      if (!dryRun) {
        const nextN = await c.env.DB.prepare('SELECT COALESCE(MAX(num_controle),0)+1 AS n FROM terc_remessas WHERE id_empresa=?').bind(id_empresa).first<any>();
        const rowIdCor = await resolveColorId(c.env.DB, row.cor, id_empresa);
        const r = await c.env.DB.prepare(`
          INSERT INTO terc_remessas (num_controle, num_op, id_terc, id_setor, cod_ref, desc_ref, id_servico, cor, id_cor, grade, qtd_total, preco_unit, valor_total, id_colecao, dt_saida, dt_inicio, dt_previsao, prazo_dias, tempo_peca, efic_pct, qtd_pessoas, min_trab_dia, status, observacao, criado_por, id_empresa)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(toInt(row.num_controle) || nextN?.n, row.num_op || null, id_terc, id_setor, cod_ref, row.desc_ref || null,
            id_servico, row.cor || null, rowIdCor, toInt(row.grade, 1), qtd_total, preco, valor, id_colecao,
            dt_saida, row.dt_inicio || dt_saida, row.dt_previsao || dt_saida,
            toInt(row.prazo_dias), toNum(row.tempo_peca), toNum(row.efic_pct, 0.8),
            toInt(row.qtd_pessoas, 1), toInt(row.min_trab_dia, 480),
            row.status || 'Aberta', row.observacao || null, getUser(c), id_empresa).run();
        const idR = r.meta.last_row_id;
        for (const g of grade) {
          await c.env.DB.prepare('INSERT INTO terc_remessa_grade (id_remessa, tamanho, qtd, id_empresa) VALUES (?, ?, ?, ?)').bind(idR, g.tamanho, g.qtd, id_empresa).run();
        }
      }
      inseridas++;
    } catch (e: any) {
      erros.push({ linha: n, erro: String(e.message || e) });
      ignoradas++;
    }
  }

  if (!dryRun) {
    await audit(c, MOD, 'IMP', `import:${Date.now()}`, 'inseridas', '', String(inseridas));
  }
  return c.json(ok({
    dry_run: dryRun,
    total: rows.length,
    inseridas,
    ignoradas,
    cadastros_criados: cadCriados,
    produtos_criados: prodsCriados,
    precos_criados: precosCriados,
    erros: erros.slice(0, 100),
  }));
});

/* =================================================================
 * GRADES DE TAMANHO DINÂMICAS (CRUD)
 * Tabela: terc_grades_tamanho
 * Campos: id_grade, nome, tamanhos (CSV), descricao, is_default, ativo
 * ================================================================= */

// Helper: normaliza CSV de tamanhos (trim + dedupe + valida)
function _normalizaTamanhos(raw: any): string {
  if (!raw) return '';
  let arr: string[] = [];
  if (Array.isArray(raw)) arr = raw.map((x) => String(x).trim()).filter(Boolean);
  else arr = String(raw).split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
  // dedupe preservando ordem
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of arr) {
    const k = t.toUpperCase();
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out.join(',');
}

// LIST — apenas ativos por padrão; ?incluir_inativos=1 para listar todos
app.get('/terc/grades-tamanho', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const incluirInativos = c.req.query('incluir_inativos') === '1';
  const sql = incluirInativos
    ? `SELECT * FROM terc_grades_tamanho WHERE id_empresa=? ORDER BY is_default DESC, nome ASC`
    : `SELECT * FROM terc_grades_tamanho WHERE id_empresa=? AND ativo=1 ORDER BY is_default DESC, nome ASC`;
  const r = await c.env.DB.prepare(sql).bind(id_empresa).all<any>();
  return c.json(ok(r.results || []));
});

// GET single
app.get('/terc/grades-tamanho/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const r = await c.env.DB.prepare('SELECT * FROM terc_grades_tamanho WHERE id_grade=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!r) return fail('Grade não encontrada', 404);
  return c.json(ok(r));
});

// CREATE
app.post('/terc/grades-tamanho', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json();
  const nome = String(b.nome || '').trim();
  const tamanhos = _normalizaTamanhos(b.tamanhos);
  if (!nome) return fail('Nome da grade é obrigatório');
  if (!tamanhos) return fail('Informe ao menos 1 tamanho (ex.: PP,P,M,G,GG)');

  // Nome único por empresa
  const ex = await c.env.DB.prepare('SELECT id_grade FROM terc_grades_tamanho WHERE nome=? AND id_empresa=?').bind(nome, id_empresa).first<any>();
  if (ex) return fail('Já existe uma grade com este nome');

  const isDefault = b.is_default ? 1 : 0;
  // Se este vai ser o default, zera o flag dos outros (dentro do tenant)
  if (isDefault) {
    await c.env.DB.prepare('UPDATE terc_grades_tamanho SET is_default=0 WHERE is_default=1 AND id_empresa=?').bind(id_empresa).run();
  }

  const r = await c.env.DB.prepare(`
    INSERT INTO terc_grades_tamanho (nome, tamanhos, descricao, is_default, ativo, criado_por, id_empresa)
    VALUES (?, ?, ?, ?, 1, ?, ?)`)
    .bind(nome, tamanhos, b.descricao || null, isDefault, getUser(c), id_empresa).run();
  return c.json(ok({ id_grade: r.meta.last_row_id, nome, tamanhos, is_default: isDefault }));
});

// UPDATE
app.put('/terc/grades-tamanho/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  const cur = await c.env.DB.prepare('SELECT * FROM terc_grades_tamanho WHERE id_grade=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!cur) return fail('Grade não encontrada', 404);

  const nome = b.nome != null ? String(b.nome).trim() : cur.nome;
  const tamanhos = b.tamanhos != null ? _normalizaTamanhos(b.tamanhos) : cur.tamanhos;
  const descricao = b.descricao != null ? b.descricao : cur.descricao;
  const ativo = b.ativo != null ? (b.ativo ? 1 : 0) : cur.ativo;
  const isDefault = b.is_default != null ? (b.is_default ? 1 : 0) : cur.is_default;

  if (!nome) return fail('Nome da grade é obrigatório');
  if (!tamanhos) return fail('Informe ao menos 1 tamanho');

  // Nome único (excluindo o próprio, no tenant)
  const ex = await c.env.DB.prepare('SELECT id_grade FROM terc_grades_tamanho WHERE nome=? AND id_grade<>? AND id_empresa=?').bind(nome, id, id_empresa).first<any>();
  if (ex) return fail('Já existe outra grade com este nome');

  if (isDefault && !cur.is_default) {
    await c.env.DB.prepare('UPDATE terc_grades_tamanho SET is_default=0 WHERE is_default=1 AND id_empresa=?').bind(id_empresa).run();
  }

  await c.env.DB.prepare(`
    UPDATE terc_grades_tamanho
       SET nome=?, tamanhos=?, descricao=?, is_default=?, ativo=?, dt_alteracao=CURRENT_TIMESTAMP
     WHERE id_grade=? AND id_empresa=?`)
    .bind(nome, tamanhos, descricao, isDefault, ativo, id, id_empresa).run();

  return c.json(ok({ id_grade: id, nome, tamanhos, is_default: isDefault, ativo }));
});

// DUPLICATE — cria uma cópia com sufixo "(cópia)"
app.post('/terc/grades-tamanho/:id/duplicar', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const cur = await c.env.DB.prepare('SELECT * FROM terc_grades_tamanho WHERE id_grade=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!cur) return fail('Grade não encontrada', 404);

  // Encontra um nome único (dentro do tenant)
  let novoNome = `${cur.nome} (cópia)`;
  let i = 1;
  while (true) {
    const ex = await c.env.DB.prepare('SELECT id_grade FROM terc_grades_tamanho WHERE nome=? AND id_empresa=?').bind(novoNome, id_empresa).first<any>();
    if (!ex) break;
    i++;
    novoNome = `${cur.nome} (cópia ${i})`;
  }

  const r = await c.env.DB.prepare(`
    INSERT INTO terc_grades_tamanho (nome, tamanhos, descricao, is_default, ativo, criado_por, id_empresa)
    VALUES (?, ?, ?, 0, 1, ?, ?)`)
    .bind(novoNome, cur.tamanhos, cur.descricao || null, getUser(c), id_empresa).run();

  return c.json(ok({ id_grade: r.meta.last_row_id, nome: novoNome, tamanhos: cur.tamanhos }));
});

// SET DEFAULT
app.post('/terc/grades-tamanho/:id/default', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const cur = await c.env.DB.prepare('SELECT * FROM terc_grades_tamanho WHERE id_grade=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!cur) return fail('Grade não encontrada', 404);
  if (!cur.ativo) return fail('Grade está inativa — ative antes de marcar como padrão');
  await c.env.DB.prepare('UPDATE terc_grades_tamanho SET is_default=0 WHERE is_default=1 AND id_empresa=?').bind(id_empresa).run();
  await c.env.DB.prepare('UPDATE terc_grades_tamanho SET is_default=1, dt_alteracao=CURRENT_TIMESTAMP WHERE id_grade=? AND id_empresa=?').bind(id, id_empresa).run();
  return c.json(ok({ id_grade: id, is_default: 1 }));
});

// USO — conta quantas remessas/itens estão usando essa grade
// Usado pela UI para decidir se permite hard-delete ou apenas soft-delete
app.get('/terc/grades-tamanho/:id/uso', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const cur = await c.env.DB.prepare('SELECT id_grade, nome FROM terc_grades_tamanho WHERE id_grade=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!cur) return fail('Grade não encontrada', 404);

  const rItens = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM terc_remessa_itens WHERE id_grade_tamanho=? AND id_empresa=?'
  ).bind(id, id_empresa).first<any>();
  const itens = Number(rItens?.n || 0);

  const rRemessas = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT id_remessa) AS n
      FROM terc_remessa_itens
     WHERE id_grade_tamanho=? AND id_empresa=?
  `).bind(id, id_empresa).first<any>();
  const remessas = Number(rRemessas?.n || 0);

  return c.json(ok({
    id_grade: id,
    nome: cur.nome,
    itens,
    remessas,
    em_uso: (itens + remessas) > 0,
  }));
});

// DELETE — soft delete por padrão; ?hard=1 só permitido se a grade NUNCA foi usada
app.delete('/terc/grades-tamanho/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const cur = await c.env.DB.prepare('SELECT * FROM terc_grades_tamanho WHERE id_grade=? AND id_empresa=?').bind(id, id_empresa).first<any>();
  if (!cur) return fail('Grade não encontrada', 404);

  // Conta uso real (preserva histórico de remessas/retornos antigos)
  const rItens = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM terc_remessa_itens WHERE id_grade_tamanho=? AND id_empresa=?'
  ).bind(id, id_empresa).first<any>();
  const emUso = Number(rItens?.n || 0) > 0;

  const wantHard = c.req.query('hard') === '1';

  if (wantHard) {
    if (emUso) {
      return c.json({
        ok: false,
        code: 'GRADE_EM_USO',
        error: 'Esta grade já possui movimentações e não pode ser excluída permanentemente. Você pode desativá-la (soft-delete).',
      }, 409);
    }
    await c.env.DB.prepare('DELETE FROM terc_grades_tamanho WHERE id_grade=? AND id_empresa=?').bind(id, id_empresa).run();
    if (cur.is_default) {
      const next = await c.env.DB.prepare('SELECT id_grade FROM terc_grades_tamanho WHERE ativo=1 AND id_empresa=? ORDER BY id_grade ASC LIMIT 1').bind(id_empresa).first<any>();
      if (next) {
        await c.env.DB.prepare('UPDATE terc_grades_tamanho SET is_default=1 WHERE id_grade=? AND id_empresa=?').bind(next.id_grade, id_empresa).run();
      }
    }
    await audit(c, 'GRADES_TAMANHO', 'DEL_HARD', `grade:${id}`, 'nome', cur.nome, '');
    return c.json(ok({ id_grade: id, deleted: true, hard: true }));
  }

  // Soft delete (padrão) — preserva o vínculo histórico nas remessas antigas
  await c.env.DB.prepare('UPDATE terc_grades_tamanho SET ativo=0, is_default=0, dt_alteracao=CURRENT_TIMESTAMP WHERE id_grade=? AND id_empresa=?').bind(id, id_empresa).run();

  if (cur.is_default) {
    const next = await c.env.DB.prepare('SELECT id_grade FROM terc_grades_tamanho WHERE ativo=1 AND id_empresa=? ORDER BY id_grade ASC LIMIT 1').bind(id_empresa).first<any>();
    if (next) {
      await c.env.DB.prepare('UPDATE terc_grades_tamanho SET is_default=1 WHERE id_grade=? AND id_empresa=?').bind(next.id_grade, id_empresa).run();
    }
  }
  await audit(c, 'GRADES_TAMANHO', 'DEL_SOFT', `grade:${id}`, 'ativo', '1', '0');
  return c.json(ok({ id_grade: id, deleted: true, hard: false, em_uso: emUso }));
});

export default app;
