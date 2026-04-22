// OP (Ordem de Produção) - com cores e tamanhos normalizados
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, toNum, getUser } from '../lib/db';

const app = new Hono<{ Bindings: Bindings }>();

// Lista (filtros: status, id_cliente, id_ref, de, ate, search)
app.get('/ops', async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const binds: any[] = [];
  if (q.status) { where.push('op.status=?'); binds.push(q.status); }
  if (q.id_cliente) { where.push('op.id_cliente=?'); binds.push(toInt(q.id_cliente)); }
  if (q.id_ref) { where.push('op.id_ref=?'); binds.push(toInt(q.id_ref)); }
  if (q.de) { where.push('op.dt_emissao>=?'); binds.push(q.de); }
  if (q.ate) { where.push('op.dt_emissao<=?'); binds.push(q.ate); }
  if (q.search) { where.push('(op.num_op LIKE ? OR op.observacao LIKE ?)'); binds.push(`%${q.search}%`, `%${q.search}%`); }

  const sql = `
    SELECT op.*,
       r.cod_ref, r.desc_ref,
       c.cod_cliente, c.nome_cliente,
       sc.versao AS seq_versao,
       (SELECT COALESCE(SUM(tempo_padrao),0) FROM seq_itens WHERE id_seq_cab=op.id_seq_cab) AS tempo_total_ref,
       CASE
         WHEN op.status NOT IN ('Concluida','Cancelada') AND date(op.dt_entrega) < date('now')
         THEN 1 ELSE 0 END AS atrasada
    FROM op_cab op
    JOIN referencias r ON r.id_ref=op.id_ref
    JOIN clientes c ON c.id_cliente=op.id_cliente
    JOIN seq_cab sc ON sc.id_seq_cab=op.id_seq_cab
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY op.dt_emissao DESC, op.num_op DESC`;

  const rs = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(ok(rs.results));
});

// Detalhe com cores e tamanhos
app.get('/ops/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const op = await c.env.DB.prepare(
    `SELECT op.*,
       r.cod_ref, r.desc_ref,
       c.cod_cliente, c.nome_cliente, c.observacao AS cliente_observacao,
       sc.versao AS seq_versao,
       (SELECT COALESCE(SUM(tempo_padrao),0) FROM seq_itens WHERE id_seq_cab=op.id_seq_cab) AS tempo_total_ref
     FROM op_cab op
     JOIN referencias r ON r.id_ref=op.id_ref
     JOIN clientes c ON c.id_cliente=op.id_cliente
     JOIN seq_cab sc ON sc.id_seq_cab=op.id_seq_cab
     WHERE op.id_op=?`
  ).bind(id).first<any>();
  if (!op) return fail('OP não encontrada.', 404);

  const cores = await c.env.DB.prepare(
    `SELECT oc.*, co.cod_cor, co.nome_cor
     FROM op_cores oc JOIN cores co ON co.id_cor=oc.id_cor
     WHERE oc.id_op=? ORDER BY co.nome_cor`
  ).bind(id).all();

  const tams = await c.env.DB.prepare(
    `SELECT ot.*, t.cod_tam, t.ordem
     FROM op_tamanhos ot JOIN tamanhos t ON t.id_tam=ot.id_tam
     WHERE ot.id_op=? ORDER BY t.ordem, t.cod_tam`
  ).bind(id).all();

  return c.json(ok({ ...op, cores: cores.results, tamanhos: tams.results }));
});

async function validarOP(
  db: D1Database,
  b: any,
  idOpEditando: number | null
): Promise<{ error?: string; idSeqCab?: number }> {
  if (!b.num_op) return { error: 'Nº da OP obrigatório.' };
  if (!b.dt_emissao) return { error: 'Data de emissão obrigatória.' };
  if (!b.dt_entrega) return { error: 'Data de entrega obrigatória.' };
  if (b.dt_entrega < b.dt_emissao) return { error: 'Entrega anterior à emissão.' };
  if (!toInt(b.id_ref)) return { error: 'Referência obrigatória.' };
  if (!toInt(b.id_cliente)) return { error: 'Cliente obrigatório.' };
  const qtd = toInt(b.qtde_pecas);
  if (qtd <= 0) return { error: 'Quantidade de peças deve ser > 0.' };

  // NumOP único
  const dup = await db.prepare(
    `SELECT id_op FROM op_cab WHERE num_op=? AND id_op != ?`
  ).bind(b.num_op, idOpEditando || 0).first<{ id_op: number }>();
  if (dup) return { error: `Número de OP '${b.num_op}' já cadastrado.` };

  // Sequência ativa
  const sa = await db.prepare(
    `SELECT id_seq_cab FROM seq_cab WHERE id_ref=? AND ativa=1 LIMIT 1`
  ).bind(toInt(b.id_ref)).first<{ id_seq_cab: number }>();
  if (!sa) return { error: 'Referência não possui sequência ATIVA.' };

  // Soma cores/tamanhos = qtde peças
  const somaC = Array.isArray(b.cores)
    ? b.cores.reduce((s: number, x: any) => s + toInt(x.qtde_pecas), 0)
    : 0;
  const somaT = Array.isArray(b.tamanhos)
    ? b.tamanhos.reduce((s: number, x: any) => s + toInt(x.qtde_pecas), 0)
    : 0;
  if (Array.isArray(b.cores) && b.cores.length > 0 && somaC !== qtd)
    return { error: `Soma das Cores (${somaC}) deve = Qtd Peças (${qtd}).` };
  if (Array.isArray(b.tamanhos) && b.tamanhos.length > 0 && somaT !== qtd)
    return { error: `Soma dos Tamanhos (${somaT}) deve = Qtd Peças (${qtd}).` };

  return { idSeqCab: toInt(sa.id_seq_cab) };
}

app.post('/ops', async (c) => {
  const b = await c.req.json();
  const v = await validarOP(c.env.DB, b, null);
  if (v.error) return fail(v.error);

  const ins = await c.env.DB.prepare(
    `INSERT INTO op_cab (num_op, dt_emissao, id_ref, id_cliente, qtde_pecas, dt_entrega, id_seq_cab, status, observacao, criado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    b.num_op, b.dt_emissao, toInt(b.id_ref), toInt(b.id_cliente),
    toInt(b.qtde_pecas), b.dt_entrega, v.idSeqCab!,
    b.status || 'Aberta', b.observacao || null, getUser(c)
  ).run();
  const idOP = toInt(ins.meta.last_row_id);

  // Grades
  await salvarGrades(c.env.DB, idOP, b);
  await audit(c, 'OP', 'INS', `OP=${b.num_op}`);
  return c.json(ok({ id_op: idOP, num_op: b.num_op }));
});

app.put('/ops/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  const v = await validarOP(c.env.DB, b, id);
  if (v.error) return fail(v.error);

  await c.env.DB.prepare(
    `UPDATE op_cab SET num_op=?, dt_emissao=?, id_ref=?, id_cliente=?, qtde_pecas=?,
       dt_entrega=?, id_seq_cab=?, status=?, observacao=?, alterado_por=?, dt_alteracao=datetime('now')
     WHERE id_op=?`
  ).bind(
    b.num_op, b.dt_emissao, toInt(b.id_ref), toInt(b.id_cliente),
    toInt(b.qtde_pecas), b.dt_entrega, v.idSeqCab!,
    b.status || 'Aberta', b.observacao || null, getUser(c), id
  ).run();

  // Regrava grades
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM op_cores WHERE id_op=?`).bind(id),
    c.env.DB.prepare(`DELETE FROM op_tamanhos WHERE id_op=?`).bind(id),
  ]);
  await salvarGrades(c.env.DB, id, b);
  await audit(c, 'OP', 'UPD', `OP=${b.num_op}`);
  return c.json(ok({ id_op: id }));
});

async function salvarGrades(db: D1Database, idOP: number, b: any) {
  const stmts: D1PreparedStatement[] = [];
  if (Array.isArray(b.cores)) {
    for (const x of b.cores) {
      if (toInt(x.id_cor) && toInt(x.qtde_pecas, -1) >= 0) {
        stmts.push(
          db.prepare(
            `INSERT INTO op_cores (id_op, id_cor, qtde_pecas) VALUES (?, ?, ?)`
          ).bind(idOP, toInt(x.id_cor), toInt(x.qtde_pecas))
        );
      }
    }
  }
  if (Array.isArray(b.tamanhos)) {
    for (const x of b.tamanhos) {
      if (toInt(x.id_tam) && toInt(x.qtde_pecas, -1) >= 0) {
        stmts.push(
          db.prepare(
            `INSERT INTO op_tamanhos (id_op, id_tam, qtde_pecas) VALUES (?, ?, ?)`
          ).bind(idOP, toInt(x.id_tam), toInt(x.qtde_pecas))
        );
      }
    }
  }
  if (stmts.length) await db.batch(stmts);
}

app.patch('/ops/:id/status', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  const valid = ['Aberta', 'Planejada', 'EmProducao', 'Concluida', 'Cancelada'];
  if (!valid.includes(b.status)) return fail('Status inválido.');
  await c.env.DB.prepare(
    `UPDATE op_cab SET status=?, alterado_por=?, dt_alteracao=datetime('now') WHERE id_op=?`
  ).bind(b.status, getUser(c), id).run();
  await audit(c, 'OP', 'UPD', `OP_id=${id}`, 'status', '', b.status);
  return c.json(ok({ id_op: id, status: b.status }));
});

app.delete('/ops/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  // Só deleta se não tem apontamento
  const ap = await c.env.DB.prepare(`SELECT COUNT(*) c FROM apontamento WHERE id_op=?`).bind(id).first<{ c: number }>();
  if (toInt(ap?.c, 0) > 0) return fail('OP tem apontamentos — não pode ser excluída. Use status=Cancelada.');
  await c.env.DB.prepare(`DELETE FROM op_cab WHERE id_op=?`).bind(id).run();
  await audit(c, 'OP', 'DEL', `OP_id=${id}`);
  return c.json(ok({ id_op: id }));
});

export default app;
