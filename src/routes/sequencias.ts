// Sequência Operacional com versionamento (regra: 1 ativa por referência)
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, toNum } from '../lib/db';

const app = new Hono<{ Bindings: Bindings }>();

// Lista todas as versões de uma referência
app.get('/referencias/:idRef/sequencias', async (c) => {
  const idRef = toInt(c.req.param('idRef'));
  const rs = await c.env.DB.prepare(
    `SELECT sc.*,
       (SELECT COUNT(*) FROM seq_itens WHERE id_seq_cab=sc.id_seq_cab) AS qtd_itens,
       (SELECT COALESCE(SUM(tempo_padrao),0) FROM seq_itens WHERE id_seq_cab=sc.id_seq_cab) AS tempo_total
     FROM seq_cab sc
     WHERE sc.id_ref=?
     ORDER BY sc.versao DESC`
  ).bind(idRef).all();
  return c.json(ok(rs.results));
});

// Detalhe de uma versão com itens
app.get('/sequencias/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const cab = await c.env.DB.prepare(
    `SELECT sc.*, r.cod_ref, r.desc_ref
     FROM seq_cab sc
     JOIN referencias r ON r.id_ref=sc.id_ref
     WHERE sc.id_seq_cab=?`
  ).bind(id).first();
  if (!cab) return fail('Sequência não encontrada.', 404);
  const itens = await c.env.DB.prepare(
    `SELECT si.*,
       o.cod_op, o.desc_op,
       m.cod_maquina, m.desc_maquina, m.eficiencia AS maq_eficiencia,
       ap.cod_aparelho, ap.desc_aparelho
     FROM seq_itens si
     JOIN operacoes o ON o.id_op=si.id_op
     LEFT JOIN maquinas m ON m.id_maquina=si.id_maquina
     LEFT JOIN aparelhos ap ON ap.id_aparelho=si.id_aparelho
     WHERE si.id_seq_cab=?
     ORDER BY si.sequencia`
  ).bind(id).all();
  const tempo_total = (itens.results as any[]).reduce(
    (s: number, it: any) => s + toNum(it.tempo_padrao, 0),
    0
  );
  return c.json(ok({ ...cab, itens: itens.results, tempo_total }));
});

// Cria nova versão (inativa por padrão)
app.post('/sequencias', async (c) => {
  const b = await c.req.json();
  const idRef = toInt(b.id_ref);
  if (!idRef) return fail('Referência obrigatória.');
  if (!Array.isArray(b.itens) || b.itens.length === 0)
    return fail('Inclua ao menos um item na sequência.');

  // Validações de itens
  const seqs = new Set<number>();
  for (const it of b.itens) {
    if (!toInt(it.sequencia) || toInt(it.sequencia) <= 0)
      return fail('Todas as linhas precisam de uma Sequência numérica > 0.');
    if (!toInt(it.id_op)) return fail('Todas as linhas precisam de Operação.');
    if (toNum(it.tempo_padrao, 0) <= 0)
      return fail('Tempo Padrão deve ser > 0 em todas as linhas.');
    if (seqs.has(toInt(it.sequencia)))
      return fail(`Sequência ${it.sequencia} duplicada.`);
    seqs.add(toInt(it.sequencia));
  }

  // Próxima versão
  const last = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(versao),0) AS v FROM seq_cab WHERE id_ref=?`
  ).bind(idRef).first<{ v: number }>();
  const versao = toInt(last?.v, 0) + 1;

  // Cria cabeçalho
  const cab = await c.env.DB.prepare(
    `INSERT INTO seq_cab (id_ref, versao, ativa, observacao, criado_por) VALUES (?, ?, 0, ?, ?)`
  ).bind(idRef, versao, b.observacao || null, b.usuario || 'sistema').run();
  const idSeqCab = toInt(cab.meta.last_row_id);

  // Insere itens
  const stmts: D1PreparedStatement[] = [];
  for (const it of b.itens) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO seq_itens (id_seq_cab, sequencia, id_op, id_maquina, id_aparelho, tempo_padrao, observacao)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        idSeqCab,
        toInt(it.sequencia),
        toInt(it.id_op),
        it.id_maquina ? toInt(it.id_maquina) : null,
        it.id_aparelho ? toInt(it.id_aparelho) : null,
        toNum(it.tempo_padrao),
        it.observacao || null
      )
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);

  await audit(c.env.DB, 'SEQ', 'INS', `SeqCab=${idSeqCab}`, 'versao', '', versao);
  return c.json(ok({ id_seq_cab: idSeqCab, versao }));
});

// Edita versão (apenas se INATIVA)
app.put('/sequencias/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const cab = await c.env.DB.prepare(`SELECT * FROM seq_cab WHERE id_seq_cab=?`).bind(id).first<any>();
  if (!cab) return fail('Versão não encontrada.', 404);
  if (cab.ativa) return fail('Versão está ATIVA. Inative antes de editar.');

  const b = await c.req.json();
  if (!Array.isArray(b.itens) || b.itens.length === 0)
    return fail('Inclua ao menos um item.');

  const seqs = new Set<number>();
  for (const it of b.itens) {
    if (!toInt(it.sequencia) || toInt(it.sequencia) <= 0)
      return fail('Sequência inválida.');
    if (!toInt(it.id_op)) return fail('Operação obrigatória em todas as linhas.');
    if (toNum(it.tempo_padrao, 0) <= 0)
      return fail('Tempo padrão > 0 obrigatório.');
    if (seqs.has(toInt(it.sequencia)))
      return fail(`Sequência ${it.sequencia} duplicada.`);
    seqs.add(toInt(it.sequencia));
  }

  // Regrava itens
  await c.env.DB.prepare(`DELETE FROM seq_itens WHERE id_seq_cab=?`).bind(id).run();
  await c.env.DB.prepare(`UPDATE seq_cab SET observacao=? WHERE id_seq_cab=?`)
    .bind(b.observacao || null, id).run();

  const stmts: D1PreparedStatement[] = [];
  for (const it of b.itens) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO seq_itens (id_seq_cab, sequencia, id_op, id_maquina, id_aparelho, tempo_padrao, observacao)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        toInt(it.sequencia),
        toInt(it.id_op),
        it.id_maquina ? toInt(it.id_maquina) : null,
        it.id_aparelho ? toInt(it.id_aparelho) : null,
        toNum(it.tempo_padrao),
        it.observacao || null
      )
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);

  await audit(c.env.DB, 'SEQ', 'UPD', `SeqCab=${id}`);
  return c.json(ok({ id_seq_cab: id }));
});

// Ativa versão (desativa as outras da mesma ref)
app.post('/sequencias/:id/ativar', async (c) => {
  const id = toInt(c.req.param('id'));
  const cab = await c.env.DB.prepare(`SELECT * FROM seq_cab WHERE id_seq_cab=?`).bind(id).first<any>();
  if (!cab) return fail('Versão não encontrada.', 404);
  // Deve ter itens
  const it = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c FROM seq_itens WHERE id_seq_cab=?`
  ).bind(id).first<{ c: number }>();
  if (toInt(it?.c, 0) === 0) return fail('Versão não possui itens.');

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE seq_cab SET ativa=0 WHERE id_ref=?`).bind(cab.id_ref),
    c.env.DB.prepare(
      `UPDATE seq_cab SET ativa=1, dt_ativacao=datetime('now') WHERE id_seq_cab=?`
    ).bind(id),
  ]);
  await audit(c.env.DB, 'SEQ', 'ATIVAR', `SeqCab=${id}`);
  return c.json(ok({ id_seq_cab: id }));
});

// Inativa versão
app.post('/sequencias/:id/inativar', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare(`UPDATE seq_cab SET ativa=0 WHERE id_seq_cab=?`).bind(id).run();
  await audit(c.env.DB, 'SEQ', 'INATIVAR', `SeqCab=${id}`);
  return c.json(ok({ id_seq_cab: id }));
});

// Duplicar (cria nova versão copiando itens)
app.post('/sequencias/:id/duplicar', async (c) => {
  const id = toInt(c.req.param('id'));
  const orig = await c.env.DB.prepare(`SELECT * FROM seq_cab WHERE id_seq_cab=?`).bind(id).first<any>();
  if (!orig) return fail('Versão de origem não encontrada.', 404);

  const last = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(versao),0) AS v FROM seq_cab WHERE id_ref=?`
  ).bind(orig.id_ref).first<{ v: number }>();
  const novaVersao = toInt(last?.v, 0) + 1;

  const cab = await c.env.DB.prepare(
    `INSERT INTO seq_cab (id_ref, versao, ativa, observacao, criado_por)
     VALUES (?, ?, 0, ?, 'sistema')`
  ).bind(orig.id_ref, novaVersao, `Duplicada da versão ${orig.versao}`).run();
  const novoId = toInt(cab.meta.last_row_id);

  await c.env.DB.prepare(
    `INSERT INTO seq_itens (id_seq_cab, sequencia, id_op, id_maquina, id_aparelho, tempo_padrao, observacao)
     SELECT ?, sequencia, id_op, id_maquina, id_aparelho, tempo_padrao, observacao
     FROM seq_itens WHERE id_seq_cab=?`
  ).bind(novoId, id).run();

  await audit(c.env.DB, 'SEQ', 'DUP', `SeqCab=${novoId}`, 'origem', '', id);
  return c.json(ok({ id_seq_cab: novoId, versao: novaVersao }));
});

// Excluir versão (só se inativa e sem OP vinculada)
app.delete('/sequencias/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const cab = await c.env.DB.prepare(`SELECT * FROM seq_cab WHERE id_seq_cab=?`).bind(id).first<any>();
  if (!cab) return fail('Versão não encontrada.', 404);
  if (cab.ativa) return fail('Não é possível excluir versão ativa.');
  const uso = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c FROM op_cab WHERE id_seq_cab=?`
  ).bind(id).first<{ c: number }>();
  if (toInt(uso?.c, 0) > 0) return fail('Existem OPs vinculadas a esta versão.');

  await c.env.DB.prepare(`DELETE FROM seq_cab WHERE id_seq_cab=?`).bind(id).run();
  await audit(c.env.DB, 'SEQ', 'DEL', `SeqCab=${id}`);
  return c.json(ok({ id_seq_cab: id }));
});

export default app;
