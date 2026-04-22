// Rotas de CRUD dos cadastros mestres
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, toNum, getUser } from '../lib/db';

const app = new Hono<{ Bindings: Bindings }>();

/* ========== CLIENTES ========== */
app.get('/clientes', async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT * FROM clientes ORDER BY nome_cliente`
  ).all();
  return c.json(ok(rs.results));
});

app.post('/clientes', async (c) => {
  const b = await c.req.json();
  if (!b.cod_cliente || !b.nome_cliente)
    return fail('Código e Nome são obrigatórios.');
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO clientes (cod_cliente, nome_cliente, cnpj, observacao, ativo)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(b.cod_cliente, b.nome_cliente, b.cnpj || null, b.observacao || null, b.ativo ?? 1)
      .run();
    await audit(c, 'CAD', 'INS', `Cliente=${b.cod_cliente}`);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    return fail('Código já cadastrado ou inválido: ' + e.message);
  }
});

app.put('/clientes/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE clientes SET cod_cliente=?, nome_cliente=?, cnpj=?, observacao=?, ativo=?
     WHERE id_cliente=?`
  )
    .bind(b.cod_cliente, b.nome_cliente, b.cnpj || null, b.observacao || null, b.ativo ?? 1, id)
    .run();
  await audit(c, 'CAD', 'UPD', `Cliente=${id}`);
  return c.json(ok({ id }));
});

app.delete('/clientes/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  // soft delete
  await c.env.DB.prepare(`UPDATE clientes SET ativo=0 WHERE id_cliente=?`).bind(id).run();
  await audit(c, 'CAD', 'DEL', `Cliente=${id}`);
  return c.json(ok({ id }));
});

/* ========== REFERÊNCIAS ========== */
app.get('/referencias', async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT r.*,
       (SELECT id_seq_cab FROM seq_cab WHERE id_ref=r.id_ref AND ativa=1 LIMIT 1) AS id_seq_ativa,
       (SELECT versao FROM seq_cab WHERE id_ref=r.id_ref AND ativa=1 LIMIT 1) AS versao_ativa
     FROM referencias r ORDER BY cod_ref`
  ).all();
  return c.json(ok(rs.results));
});

app.post('/referencias', async (c) => {
  const b = await c.req.json();
  if (!b.cod_ref || !b.desc_ref) return fail('Código e Descrição obrigatórios.');
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO referencias (cod_ref, desc_ref, familia, ativo) VALUES (?, ?, ?, ?)`
    ).bind(b.cod_ref, b.desc_ref, b.familia || null, b.ativo ?? 1).run();
    await audit(c, 'CAD', 'INS', `Ref=${b.cod_ref}`);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    return fail('Código duplicado: ' + e.message);
  }
});

app.put('/referencias/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE referencias SET cod_ref=?, desc_ref=?, familia=?, ativo=? WHERE id_ref=?`
  ).bind(b.cod_ref, b.desc_ref, b.familia || null, b.ativo ?? 1, id).run();
  await audit(c, 'CAD', 'UPD', `Ref=${id}`);
  return c.json(ok({ id }));
});

app.delete('/referencias/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare(`UPDATE referencias SET ativo=0 WHERE id_ref=?`).bind(id).run();
  await audit(c, 'CAD', 'DEL', `Ref=${id}`);
  return c.json(ok({ id }));
});

/* ========== MÁQUINAS ========== */
app.get('/maquinas', async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM maquinas ORDER BY desc_maquina`).all();
  return c.json(ok(rs.results));
});

app.post('/maquinas', async (c) => {
  const b = await c.req.json();
  if (!b.cod_maquina || !b.desc_maquina) return fail('Código e Descrição obrigatórios.');
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO maquinas (cod_maquina, desc_maquina, tipo, eficiencia, oper_por_maquina, ativo)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      b.cod_maquina, b.desc_maquina, b.tipo || null,
      toNum(b.eficiencia, 0.85), toNum(b.oper_por_maquina, 1), b.ativo ?? 1
    ).run();
    await audit(c, 'CAD', 'INS', `Maq=${b.cod_maquina}`);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    return fail('Código duplicado: ' + e.message);
  }
});

app.put('/maquinas/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE maquinas SET cod_maquina=?, desc_maquina=?, tipo=?, eficiencia=?, oper_por_maquina=?, ativo=?
     WHERE id_maquina=?`
  ).bind(
    b.cod_maquina, b.desc_maquina, b.tipo || null,
    toNum(b.eficiencia, 0.85), toNum(b.oper_por_maquina, 1), b.ativo ?? 1, id
  ).run();
  await audit(c, 'CAD', 'UPD', `Maq=${id}`);
  return c.json(ok({ id }));
});

app.delete('/maquinas/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare(`UPDATE maquinas SET ativo=0 WHERE id_maquina=?`).bind(id).run();
  await audit(c, 'CAD', 'DEL', `Maq=${id}`);
  return c.json(ok({ id }));
});

/* ========== APARELHOS ========== */
app.get('/aparelhos', async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM aparelhos ORDER BY desc_aparelho`).all();
  return c.json(ok(rs.results));
});

app.post('/aparelhos', async (c) => {
  const b = await c.req.json();
  if (!b.cod_aparelho || !b.desc_aparelho) return fail('Código e Descrição obrigatórios.');
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO aparelhos (cod_aparelho, desc_aparelho, ativo) VALUES (?, ?, ?)`
    ).bind(b.cod_aparelho, b.desc_aparelho, b.ativo ?? 1).run();
    await audit(c, 'CAD', 'INS', `Apar=${b.cod_aparelho}`);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    return fail('Código duplicado: ' + e.message);
  }
});

app.put('/aparelhos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE aparelhos SET cod_aparelho=?, desc_aparelho=?, ativo=? WHERE id_aparelho=?`
  ).bind(b.cod_aparelho, b.desc_aparelho, b.ativo ?? 1, id).run();
  await audit(c, 'CAD', 'UPD', `Apar=${id}`);
  return c.json(ok({ id }));
});

app.delete('/aparelhos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare(`UPDATE aparelhos SET ativo=0 WHERE id_aparelho=?`).bind(id).run();
  await audit(c, 'CAD', 'DEL', `Apar=${id}`);
  return c.json(ok({ id }));
});

/* ========== OPERAÇÕES ========== */
app.get('/operacoes', async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT o.*,
       m.desc_maquina, m.cod_maquina,
       a.desc_aparelho, a.cod_aparelho
     FROM operacoes o
     LEFT JOIN maquinas m ON m.id_maquina=o.id_maquina
     LEFT JOIN aparelhos a ON a.id_aparelho=o.id_aparelho
     ORDER BY o.cod_op`
  ).all();
  return c.json(ok(rs.results));
});

app.post('/operacoes', async (c) => {
  const b = await c.req.json();
  if (!b.cod_op || !b.desc_op) return fail('Código e Descrição obrigatórios.');
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO operacoes (cod_op, desc_op, id_maquina, id_aparelho, tempo_padrao, ativo)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      b.cod_op, b.desc_op,
      b.id_maquina || null, b.id_aparelho || null,
      toNum(b.tempo_padrao, 0), b.ativo ?? 1
    ).run();
    await audit(c, 'CAD', 'INS', `Op=${b.cod_op}`);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    return fail('Código duplicado: ' + e.message);
  }
});

app.put('/operacoes/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE operacoes SET cod_op=?, desc_op=?, id_maquina=?, id_aparelho=?, tempo_padrao=?, ativo=?
     WHERE id_op=?`
  ).bind(
    b.cod_op, b.desc_op,
    b.id_maquina || null, b.id_aparelho || null,
    toNum(b.tempo_padrao, 0), b.ativo ?? 1, id
  ).run();
  await audit(c, 'CAD', 'UPD', `Op=${id}`);
  return c.json(ok({ id }));
});

app.delete('/operacoes/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare(`UPDATE operacoes SET ativo=0 WHERE id_op=?`).bind(id).run();
  await audit(c, 'CAD', 'DEL', `Op=${id}`);
  return c.json(ok({ id }));
});

/* ========== CORES ========== */
app.get('/cores', async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM cores ORDER BY nome_cor`).all();
  return c.json(ok(rs.results));
});

app.post('/cores', async (c) => {
  const b = await c.req.json();
  if (!b.cod_cor || !b.nome_cor) return fail('Código e Nome obrigatórios.');
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO cores (cod_cor, nome_cor, ativo) VALUES (?, ?, ?)`
    ).bind(b.cod_cor, b.nome_cor, b.ativo ?? 1).run();
    await audit(c, 'CAD', 'INS', `Cor=${b.cod_cor}`);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    return fail('Código duplicado: ' + e.message);
  }
});

app.put('/cores/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE cores SET cod_cor=?, nome_cor=?, ativo=? WHERE id_cor=?`
  ).bind(b.cod_cor, b.nome_cor, b.ativo ?? 1, id).run();
  await audit(c, 'CAD', 'UPD', `Cor=${id}`);
  return c.json(ok({ id }));
});

app.delete('/cores/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare(`UPDATE cores SET ativo=0 WHERE id_cor=?`).bind(id).run();
  await audit(c, 'CAD', 'DEL', `Cor=${id}`);
  return c.json(ok({ id }));
});

/* ========== TAMANHOS ========== */
app.get('/tamanhos', async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM tamanhos ORDER BY ordem, cod_tam`).all();
  return c.json(ok(rs.results));
});

app.post('/tamanhos', async (c) => {
  const b = await c.req.json();
  if (!b.cod_tam) return fail('Código obrigatório.');
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO tamanhos (cod_tam, ordem, ativo) VALUES (?, ?, ?)`
    ).bind(b.cod_tam, toInt(b.ordem, 0), b.ativo ?? 1).run();
    await audit(c, 'CAD', 'INS', `Tam=${b.cod_tam}`);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    return fail('Código duplicado: ' + e.message);
  }
});

app.put('/tamanhos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE tamanhos SET cod_tam=?, ordem=?, ativo=? WHERE id_tam=?`
  ).bind(b.cod_tam, toInt(b.ordem, 0), b.ativo ?? 1, id).run();
  await audit(c, 'CAD', 'UPD', `Tam=${id}`);
  return c.json(ok({ id }));
});

app.delete('/tamanhos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare(`UPDATE tamanhos SET ativo=0 WHERE id_tam=?`).bind(id).run();
  await audit(c, 'CAD', 'DEL', `Tam=${id}`);
  return c.json(ok({ id }));
});

/* ========== PARÂMETROS ========== */
app.get('/parametros', async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM parametros ORDER BY chave`).all();
  return c.json(ok(rs.results));
});

app.put('/parametros/:chave', async (c) => {
  const chave = c.req.param('chave');
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE parametros SET valor=? WHERE chave=?`
  ).bind(String(b.valor ?? ''), chave).run();
  await audit(c, 'CAD', 'UPD', `Param=${chave}`, 'valor', '', b.valor);
  return c.json(ok({ chave }));
});

export default app;
