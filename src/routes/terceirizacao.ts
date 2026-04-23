// Controle de Terceirização — Remessas, Retornos, Consertos, Cadastros, Resumo
// Baseado na planilha "Controle de Terceirização Versão.xlsx"
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, toNum, getUser } from '../lib/db';

const app = new Hono<{ Bindings: Bindings }>();

const MOD = 'TERC';
const TAMS = ['P','M','G','GG','EG','SG','T7','T8','T9','T10'];

/* =================================================================
 * CADASTROS AUXILIARES
 * ================================================================= */

// -------- Setores
app.get('/terc/setores', async (c) => {
  const rs = await c.env.DB.prepare('SELECT * FROM terc_setores ORDER BY nome_setor').all();
  return c.json(ok(rs.results));
});
app.post('/terc/setores', async (c) => {
  const b = await c.req.json();
  if (!b.nome_setor) return fail('nome_setor é obrigatório');
  const r = await c.env.DB.prepare('INSERT INTO terc_setores (nome_setor, ativo) VALUES (?, 1)').bind(b.nome_setor).run();
  await audit(c, MOD, 'INS', `setor:${r.meta.last_row_id}`, 'nome_setor', '', b.nome_setor);
  return c.json(ok({ id: r.meta.last_row_id }));
});
app.put('/terc/setores/:id', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  await c.env.DB.prepare('UPDATE terc_setores SET nome_setor=?, ativo=? WHERE id_setor=?').bind(b.nome_setor, b.ativo ? 1 : 0, id).run();
  await audit(c, MOD, 'UPD', `setor:${id}`);
  return c.json(ok({ id }));
});
app.delete('/terc/setores/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const uso = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_terceirizados WHERE id_setor=?').bind(id).first<any>();
  if (uso && uso.c > 0) return fail(`Setor possui ${uso.c} terceirizado(s) vinculado(s).`, 409);
  await c.env.DB.prepare('DELETE FROM terc_setores WHERE id_setor=?').bind(id).run();
  await audit(c, MOD, 'DEL', `setor:${id}`);
  return c.json(ok({ id, deleted: true }));
});

// -------- Serviços
app.get('/terc/servicos', async (c) => {
  const rs = await c.env.DB.prepare('SELECT * FROM terc_servicos ORDER BY desc_servico').all();
  return c.json(ok(rs.results));
});
app.post('/terc/servicos', async (c) => {
  const b = await c.req.json();
  if (!b.desc_servico) return fail('desc_servico é obrigatório');
  const r = await c.env.DB.prepare('INSERT INTO terc_servicos (desc_servico, ativo) VALUES (?, 1)').bind(b.desc_servico).run();
  await audit(c, MOD, 'INS', `servico:${r.meta.last_row_id}`, 'desc_servico', '', b.desc_servico);
  return c.json(ok({ id: r.meta.last_row_id }));
});
app.put('/terc/servicos/:id', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  await c.env.DB.prepare('UPDATE terc_servicos SET desc_servico=?, ativo=? WHERE id_servico=?').bind(b.desc_servico, b.ativo ? 1 : 0, id).run();
  await audit(c, MOD, 'UPD', `servico:${id}`);
  return c.json(ok({ id }));
});
app.delete('/terc/servicos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM terc_servicos WHERE id_servico=?').bind(id).run();
  await audit(c, MOD, 'DEL', `servico:${id}`);
  return c.json(ok({ id, deleted: true }));
});

// -------- Coleções
app.get('/terc/colecoes', async (c) => {
  const rs = await c.env.DB.prepare('SELECT * FROM terc_colecoes ORDER BY nome_colecao').all();
  return c.json(ok(rs.results));
});
app.post('/terc/colecoes', async (c) => {
  const b = await c.req.json();
  if (!b.nome_colecao) return fail('nome_colecao é obrigatório');
  const r = await c.env.DB.prepare('INSERT INTO terc_colecoes (nome_colecao, ativo) VALUES (?, 1)').bind(b.nome_colecao).run();
  await audit(c, MOD, 'INS', `colecao:${r.meta.last_row_id}`, 'nome_colecao', '', b.nome_colecao);
  return c.json(ok({ id: r.meta.last_row_id }));
});
app.put('/terc/colecoes/:id', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  await c.env.DB.prepare('UPDATE terc_colecoes SET nome_colecao=?, ativo=? WHERE id_colecao=?').bind(b.nome_colecao, b.ativo ? 1 : 0, id).run();
  await audit(c, MOD, 'UPD', `colecao:${id}`);
  return c.json(ok({ id }));
});
app.delete('/terc/colecoes/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM terc_colecoes WHERE id_colecao=?').bind(id).run();
  await audit(c, MOD, 'DEL', `colecao:${id}`);
  return c.json(ok({ id, deleted: true }));
});

/* =================================================================
 * TERCEIRIZADOS (CRUD)
 * ================================================================= */

app.get('/terc/terceirizados', async (c) => {
  const q = c.req.query();
  const where: string[] = []; const binds: any[] = [];
  if (q.situacao) { where.push('t.situacao=?'); binds.push(q.situacao); }
  if (q.id_setor) { where.push('t.id_setor=?'); binds.push(toInt(q.id_setor)); }
  if (q.search) { where.push('(t.nome_terc LIKE ? OR t.cpf_cnpj LIKE ?)'); binds.push(`%${q.search}%`, `%${q.search}%`); }
  const sql = `
    SELECT t.*, s.nome_setor
    FROM terc_terceirizados t
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.nome_terc`;
  const rs = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(ok(rs.results));
});

app.get('/terc/terceirizados/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const t = await c.env.DB.prepare(`
    SELECT t.*, s.nome_setor FROM terc_terceirizados t
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor WHERE id_terc=?`).bind(id).first<any>();
  if (!t) return fail('Terceirizado não encontrado', 404);

  // Estatísticas
  const stats = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total_remessas,
      COALESCE(SUM(qtd_total),0) AS pecas_enviadas,
      COALESCE(SUM(valor_total),0) AS valor_total,
      SUM(CASE WHEN status IN ('Aberta','EmProducao','Parcial') THEN 1 ELSE 0 END) AS em_aberto,
      SUM(CASE WHEN status='Atrasada' THEN 1 ELSE 0 END) AS atrasadas,
      SUM(CASE WHEN status='Concluida' THEN 1 ELSE 0 END) AS concluidas
    FROM terc_remessas WHERE id_terc=?`).bind(id).first<any>();
  return c.json(ok({ ...t, stats }));
});

app.post('/terc/terceirizados', async (c) => {
  const b = await c.req.json();
  if (!b.nome_terc) return fail('nome_terc é obrigatório');
  try {
    const r = await c.env.DB.prepare(`
      INSERT INTO terc_terceirizados (nome_terc, id_setor, cpf_cnpj, telefone, email, endereco, qtd_pessoas, min_trab_dia, efic_padrao, prazo_padrao, situacao, observacao, ativo, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .bind(b.nome_terc, toInt(b.id_setor) || null, b.cpf_cnpj || null, b.telefone || null, b.email || null, b.endereco || null,
        toInt(b.qtd_pessoas, 1), toInt(b.min_trab_dia, 480), toNum(b.efic_padrao, 0.8), toInt(b.prazo_padrao, 3),
        b.situacao || 'Ativa', b.observacao || null, getUser(c)).run();
    await audit(c, MOD, 'INS', `terc:${r.meta.last_row_id}`, 'nome_terc', '', b.nome_terc);
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Já existe terceirizado com esse nome', 409);
    return fail(String(e));
  }
});

app.put('/terc/terceirizados/:id', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  await c.env.DB.prepare(`
    UPDATE terc_terceirizados
    SET nome_terc=?, id_setor=?, cpf_cnpj=?, telefone=?, email=?, endereco=?,
        qtd_pessoas=?, min_trab_dia=?, efic_padrao=?, prazo_padrao=?, situacao=?, observacao=?, ativo=?
    WHERE id_terc=?`)
    .bind(b.nome_terc, toInt(b.id_setor) || null, b.cpf_cnpj || null, b.telefone || null, b.email || null, b.endereco || null,
      toInt(b.qtd_pessoas, 1), toInt(b.min_trab_dia, 480), toNum(b.efic_padrao, 0.8), toInt(b.prazo_padrao, 3),
      b.situacao || 'Ativa', b.observacao || null, b.ativo ? 1 : 0, id).run();
  await audit(c, MOD, 'UPD', `terc:${id}`);
  return c.json(ok({ id }));
});

app.delete('/terc/terceirizados/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const uso = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_remessas WHERE id_terc=?').bind(id).first<any>();
  if (uso && uso.c > 0) {
    const t = await c.env.DB.prepare('SELECT nome_terc FROM terc_terceirizados WHERE id_terc=?').bind(id).first<any>();
    return fail(`Não é possível excluir: ${t?.nome_terc || 'Terceirizado'} possui ${uso.c} remessa(s). Use "Inativar" para desativar.`, 409);
  }
  await c.env.DB.prepare('DELETE FROM terc_terceirizados WHERE id_terc=?').bind(id).run();
  await audit(c, MOD, 'DEL', `terc:${id}`);
  return c.json(ok({ id, deleted: true }));
});

app.patch('/terc/terceirizados/:id/situacao', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  const s = b.situacao || 'Ativa';
  await c.env.DB.prepare('UPDATE terc_terceirizados SET situacao=?, ativo=? WHERE id_terc=?')
    .bind(s, s === 'Ativa' ? 1 : 0, id).run();
  await audit(c, MOD, 'ATIV', `terc:${id}`, 'situacao', '', s);
  return c.json(ok({ id, situacao: s }));
});

/* =================================================================
 * PREÇOS
 * ================================================================= */

app.get('/terc/precos', async (c) => {
  const q = c.req.query();
  const where: string[] = ['p.ativo=1']; const binds: any[] = [];
  if (q.cod_ref) { where.push('p.cod_ref=?'); binds.push(q.cod_ref); }
  if (q.id_servico) { where.push('p.id_servico=?'); binds.push(toInt(q.id_servico)); }
  if (q.search) { where.push('(p.cod_ref LIKE ? OR p.desc_ref LIKE ?)'); binds.push(`%${q.search}%`, `%${q.search}%`); }
  const rs = await c.env.DB.prepare(`
    SELECT p.*, s.desc_servico, co.nome_colecao
    FROM terc_precos p
    LEFT JOIN terc_servicos s ON s.id_servico=p.id_servico
    LEFT JOIN terc_colecoes co ON co.id_colecao=p.id_colecao
    WHERE ${where.join(' AND ')}
    ORDER BY p.cod_ref, p.id_servico
    LIMIT 500`).bind(...binds).all();
  return c.json(ok(rs.results));
});

app.post('/terc/precos', async (c) => {
  const b = await c.req.json();
  if (!b.cod_ref || !b.id_servico) return fail('cod_ref e id_servico são obrigatórios');
  try {
    const r = await c.env.DB.prepare(`
      INSERT INTO terc_precos (cod_ref, desc_ref, id_servico, grade, preco, tempo_min, id_colecao, dt_vigencia, observacao, ativo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .bind(b.cod_ref, b.desc_ref || null, toInt(b.id_servico), toInt(b.grade, 1),
        toNum(b.preco), toNum(b.tempo_min), toInt(b.id_colecao) || null,
        b.dt_vigencia || null, b.observacao || null).run();
    await audit(c, MOD, 'INS', `preco:${r.meta.last_row_id}`, 'preco', '', String(b.preco));
    return c.json(ok({ id: r.meta.last_row_id }));
  } catch (e: any) {
    if (String(e).includes('UNIQUE')) return fail('Já existe preço para (ref + serviço + grade + coleção)', 409);
    return fail(String(e));
  }
});

app.put('/terc/precos/:id', async (c) => {
  const id = toInt(c.req.param('id')); const b = await c.req.json();
  await c.env.DB.prepare(`
    UPDATE terc_precos SET cod_ref=?, desc_ref=?, id_servico=?, grade=?, preco=?, tempo_min=?, id_colecao=?, dt_vigencia=?, observacao=?, ativo=?
    WHERE id_preco=?`)
    .bind(b.cod_ref, b.desc_ref || null, toInt(b.id_servico), toInt(b.grade, 1),
      toNum(b.preco), toNum(b.tempo_min), toInt(b.id_colecao) || null,
      b.dt_vigencia || null, b.observacao || null, b.ativo ? 1 : 0, id).run();
  await audit(c, MOD, 'UPD', `preco:${id}`);
  return c.json(ok({ id }));
});

app.delete('/terc/precos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM terc_precos WHERE id_preco=?').bind(id).run();
  await audit(c, MOD, 'DEL', `preco:${id}`);
  return c.json(ok({ id, deleted: true }));
});

// Busca de preço tabelado (autofill nas remessas)
app.get('/terc/precos/lookup', async (c) => {
  const q = c.req.query();
  const r = await c.env.DB.prepare(`
    SELECT p.preco, p.tempo_min, p.desc_ref
    FROM terc_precos p
    WHERE p.cod_ref=? AND p.id_servico=? AND p.grade=? AND p.ativo=1
      AND (p.id_colecao=? OR p.id_colecao IS NULL)
    ORDER BY CASE WHEN p.id_colecao=? THEN 0 ELSE 1 END
    LIMIT 1`)
    .bind(q.cod_ref, toInt(q.id_servico), toInt(q.grade, 1), toInt(q.id_colecao) || null, toInt(q.id_colecao) || null)
    .first<any>();
  return c.json(ok(r || null));
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
  const r = await c.env.DB.prepare('SELECT COALESCE(MAX(num_controle),0)+1 AS n FROM terc_remessas').first<any>();
  return c.json(ok({ num_controle: r?.n || 1 }));
});

// Lista
app.get('/terc/remessas', async (c) => {
  const q = c.req.query();
  const where: string[] = []; const binds: any[] = [];
  if (q.status) { where.push('r.status=?'); binds.push(q.status); }
  if (q.id_terc) { where.push('r.id_terc=?'); binds.push(toInt(q.id_terc)); }
  if (q.id_servico) { where.push('r.id_servico=?'); binds.push(toInt(q.id_servico)); }
  if (q.id_colecao) { where.push('r.id_colecao=?'); binds.push(toInt(q.id_colecao)); }
  if (q.de) { where.push('r.dt_saida>=?'); binds.push(q.de); }
  if (q.ate) { where.push('r.dt_saida<=?'); binds.push(q.ate); }
  if (q.cod_ref) { where.push('r.cod_ref=?'); binds.push(q.cod_ref); }
  if (q.num_op) { where.push('r.num_op=?'); binds.push(q.num_op); }
  if (q.search) { where.push('(r.cod_ref LIKE ? OR r.desc_ref LIKE ? OR r.num_op LIKE ? OR r.cor LIKE ?)'); binds.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }

  const sql = `
    SELECT r.*,
      t.nome_terc, st.nome_setor, sv.desc_servico, co.nome_colecao,
      COALESCE((SELECT SUM(qtd_boa)+SUM(qtd_refugo)+SUM(qtd_conserto) FROM terc_retornos WHERE id_remessa=r.id_remessa),0) AS qtd_retornada_calc,
      CASE WHEN r.status NOT IN ('Concluida','Cancelada') AND date(r.dt_previsao) < date('now') THEN 1 ELSE 0 END AS atrasada
    FROM terc_remessas r
    LEFT JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    LEFT JOIN terc_setores st ON st.id_setor=r.id_setor
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    LEFT JOIN terc_colecoes co ON co.id_colecao=r.id_colecao
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.dt_saida DESC, r.num_controle DESC
    LIMIT 500`;
  const rs = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(ok(rs.results));
});

// Detalhe de uma remessa (com grade + retornos)
app.get('/terc/remessas/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const rem = await c.env.DB.prepare(`
    SELECT r.*, t.nome_terc, st.nome_setor, sv.desc_servico, co.nome_colecao
    FROM terc_remessas r
    LEFT JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    LEFT JOIN terc_setores st ON st.id_setor=r.id_setor
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    LEFT JOIN terc_colecoes co ON co.id_colecao=r.id_colecao
    WHERE r.id_remessa=?`).bind(id).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);

  const grade = (await c.env.DB.prepare('SELECT tamanho, qtd FROM terc_remessa_grade WHERE id_remessa=?').bind(id).all()).results as any[];
  const retornos = (await c.env.DB.prepare(`
    SELECT r.*,
      (SELECT json_group_array(json_object('tamanho', tamanho, 'qtd', qtd)) FROM terc_retorno_grade WHERE id_retorno=r.id_retorno) AS grade_json
    FROM terc_retornos r WHERE id_remessa=? ORDER BY dt_retorno`).bind(id).all()).results as any[];
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

  return c.json(ok({ ...rem, grade, retornos: retornosParsed, totais_retorno: totRet, saldo: (Number(rem.qtd_total) || 0) - totRet.total }));
});

// Criar remessa
app.post('/terc/remessas', async (c) => {
  const b = await c.req.json();
  if (!b.id_terc || !b.cod_ref || !b.id_servico || !b.dt_saida) return fail('id_terc, cod_ref, id_servico e dt_saida são obrigatórios');

  const grade: any[] = Array.isArray(b.grade) ? b.grade : [];
  const qtd_total = grade.reduce((a, g) => a + (toInt(g.qtd) || 0), 0) || toInt(b.qtd_total);
  if (qtd_total <= 0) return fail('Quantidade total deve ser maior que zero');

  const preco = toNum(b.preco_unit);
  const valor = qtd_total * preco;

  // Busca terceirizado para parâmetros de previsão
  const t = await c.env.DB.prepare('SELECT id_setor, qtd_pessoas, min_trab_dia, efic_padrao, prazo_padrao FROM terc_terceirizados WHERE id_terc=?').bind(toInt(b.id_terc)).first<any>();
  const pess = toInt(b.qtd_pessoas, t?.qtd_pessoas || 1);
  const min_dia = toInt(b.min_trab_dia, t?.min_trab_dia || 480);
  const efic = toNum(b.efic_pct, t?.efic_padrao || 0.8);
  const tempo = toNum(b.tempo_peca);
  const prazo = toInt(b.prazo_dias, t?.prazo_padrao || 0);

  let { dias, dt_prev } = calcPrevisao(b.dt_saida, qtd_total, tempo, pess, min_dia, efic);
  if (prazo > 0) {
    const d = new Date(b.dt_saida + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + prazo);
    dt_prev = d.toISOString().slice(0, 10);
  }

  // Próximo número de controle
  const nextN = await c.env.DB.prepare('SELECT COALESCE(MAX(num_controle),0)+1 AS n FROM terc_remessas').first<any>();
  const num_controle = toInt(b.num_controle) || nextN?.n || 1;

  const r = await c.env.DB.prepare(`
    INSERT INTO terc_remessas (num_controle, num_op, id_terc, id_setor, cod_ref, desc_ref, id_servico, cor, grade, qtd_total, preco_unit, valor_total, id_colecao, dt_saida, dt_inicio, dt_previsao, prazo_dias, tempo_peca, efic_pct, qtd_pessoas, min_trab_dia, status, observacao, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(num_controle, b.num_op || null, toInt(b.id_terc), toInt(b.id_setor) || t?.id_setor || null,
      b.cod_ref, b.desc_ref || null, toInt(b.id_servico), b.cor || null, toInt(b.grade, 1),
      qtd_total, preco, valor, toInt(b.id_colecao) || null,
      b.dt_saida, b.dt_inicio || b.dt_saida, dt_prev, prazo > 0 ? prazo : dias, tempo, efic, pess, min_dia,
      b.status || 'Aberta', b.observacao || null, getUser(c)).run();

  const idR = r.meta.last_row_id;
  // Grade
  for (const g of grade) {
    if (toInt(g.qtd) > 0) {
      await c.env.DB.prepare('INSERT INTO terc_remessa_grade (id_remessa, tamanho, qtd) VALUES (?, ?, ?)')
        .bind(idR, g.tamanho, toInt(g.qtd)).run();
    }
  }
  await audit(c, MOD, 'INS_REM', `remessa:${idR}`, 'num_controle', '', String(num_controle));
  return c.json(ok({ id: idR, num_controle, dt_previsao: dt_prev, valor_total: valor }));
});

// Atualizar remessa
app.put('/terc/remessas/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  const grade: any[] = Array.isArray(b.grade) ? b.grade : [];
  const qtd_total = grade.reduce((a, g) => a + (toInt(g.qtd) || 0), 0) || toInt(b.qtd_total);
  const preco = toNum(b.preco_unit);
  const valor = qtd_total * preco;

  const pess = toInt(b.qtd_pessoas, 1);
  const min_dia = toInt(b.min_trab_dia, 480);
  const efic = toNum(b.efic_pct, 0.8);
  const tempo = toNum(b.tempo_peca);
  const prazo = toInt(b.prazo_dias);
  let { dias, dt_prev } = calcPrevisao(b.dt_saida, qtd_total, tempo, pess, min_dia, efic);
  if (prazo > 0) {
    const d = new Date(b.dt_saida + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + prazo);
    dt_prev = d.toISOString().slice(0, 10);
  }

  await c.env.DB.prepare(`
    UPDATE terc_remessas SET num_op=?, id_terc=?, id_setor=?, cod_ref=?, desc_ref=?, id_servico=?, cor=?, grade=?,
      qtd_total=?, preco_unit=?, valor_total=?, id_colecao=?, dt_saida=?, dt_inicio=?, dt_previsao=?, prazo_dias=?,
      tempo_peca=?, efic_pct=?, qtd_pessoas=?, min_trab_dia=?, status=?, observacao=?, alterado_por=?, dt_alteracao=datetime('now')
    WHERE id_remessa=?`)
    .bind(b.num_op || null, toInt(b.id_terc), toInt(b.id_setor) || null, b.cod_ref, b.desc_ref || null,
      toInt(b.id_servico), b.cor || null, toInt(b.grade, 1), qtd_total, preco, valor,
      toInt(b.id_colecao) || null, b.dt_saida, b.dt_inicio || b.dt_saida, dt_prev, prazo > 0 ? prazo : dias,
      tempo, efic, pess, min_dia, b.status || 'Aberta', b.observacao || null, getUser(c), id).run();

  // Regrava grade
  await c.env.DB.prepare('DELETE FROM terc_remessa_grade WHERE id_remessa=?').bind(id).run();
  for (const g of grade) {
    if (toInt(g.qtd) > 0) {
      await c.env.DB.prepare('INSERT INTO terc_remessa_grade (id_remessa, tamanho, qtd) VALUES (?, ?, ?)')
        .bind(id, g.tamanho, toInt(g.qtd)).run();
    }
  }
  await audit(c, MOD, 'UPD_REM', `remessa:${id}`);
  return c.json(ok({ id, dt_previsao: dt_prev, valor_total: valor }));
});

// Excluir remessa
app.delete('/terc/remessas/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const nRet = await c.env.DB.prepare('SELECT COUNT(*) AS c FROM terc_retornos WHERE id_remessa=?').bind(id).first<any>();
  if (nRet && nRet.c > 0) return fail(`Remessa possui ${nRet.c} retorno(s). Exclua os retornos primeiro ou cancele a remessa.`, 409);
  await c.env.DB.prepare('DELETE FROM terc_remessa_grade WHERE id_remessa=?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM terc_remessas WHERE id_remessa=?').bind(id).run();
  await audit(c, MOD, 'DEL_REM', `remessa:${id}`);
  return c.json(ok({ id, deleted: true }));
});

/* =================================================================
 * RETORNOS (podem existir múltiplos retornos parciais por remessa)
 * ================================================================= */

app.post('/terc/retornos', async (c) => {
  const b = await c.req.json();
  if (!b.id_remessa || !b.dt_retorno) return fail('id_remessa e dt_retorno são obrigatórios');

  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=?').bind(toInt(b.id_remessa)).first<any>();
  if (!rem) return fail('Remessa não encontrada', 404);

  const grade: any[] = Array.isArray(b.grade) ? b.grade : [];
  const qtd_total_grade = grade.reduce((a, g) => a + (toInt(g.qtd) || 0), 0);
  const qtd_boa = toInt(b.qtd_boa, qtd_total_grade);
  const qtd_refugo = toInt(b.qtd_refugo);
  const qtd_conserto = toInt(b.qtd_conserto);
  const qtd_total = qtd_boa + qtd_refugo + qtd_conserto;
  if (qtd_total <= 0) return fail('Quantidade retornada deve ser maior que zero');

  // Valida se não excede remessa
  const jaRet = await c.env.DB.prepare('SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=?').bind(toInt(b.id_remessa)).first<any>();
  const totalAposRetorno = (Number(jaRet?.s) || 0) + qtd_total;
  if (totalAposRetorno > Number(rem.qtd_total)) {
    return fail(`Quantidade excede a remessa. Remessa: ${rem.qtd_total}, já retornado: ${jaRet?.s || 0}, tentativa: ${qtd_total}`, 400);
  }

  const valor_pago = toNum(b.valor_pago, qtd_boa * Number(rem.preco_unit || 0));

  const r = await c.env.DB.prepare(`
    INSERT INTO terc_retornos (id_remessa, dt_retorno, qtd_total, qtd_boa, qtd_refugo, qtd_conserto, valor_pago, dt_pagamento, observacao, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(toInt(b.id_remessa), b.dt_retorno, qtd_total, qtd_boa, qtd_refugo, qtd_conserto,
      valor_pago, b.dt_pagamento || null, b.observacao || null, getUser(c)).run();
  const idRet = r.meta.last_row_id;
  for (const g of grade) {
    if (toInt(g.qtd) > 0) {
      await c.env.DB.prepare('INSERT INTO terc_retorno_grade (id_retorno, tamanho, qtd) VALUES (?, ?, ?)')
        .bind(idRet, g.tamanho, toInt(g.qtd)).run();
    }
  }

  // Atualiza status da remessa
  const novoStatus = totalAposRetorno >= Number(rem.qtd_total) ? 'Concluida' : 'Parcial';
  await c.env.DB.prepare('UPDATE terc_remessas SET status=? WHERE id_remessa=?').bind(novoStatus, toInt(b.id_remessa)).run();

  await audit(c, MOD, 'INS_RET', `retorno:${idRet}`, 'qtd_total', '', String(qtd_total));
  return c.json(ok({ id: idRet, status_remessa: novoStatus, total_retornado: totalAposRetorno, saldo: Number(rem.qtd_total) - totalAposRetorno }));
});

app.delete('/terc/retornos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const ret = await c.env.DB.prepare('SELECT id_remessa FROM terc_retornos WHERE id_retorno=?').bind(id).first<any>();
  if (!ret) return fail('Retorno não encontrado', 404);
  await c.env.DB.prepare('DELETE FROM terc_retorno_grade WHERE id_retorno=?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM terc_retornos WHERE id_retorno=?').bind(id).run();

  // Reavaliar status da remessa
  const rem = await c.env.DB.prepare('SELECT * FROM terc_remessas WHERE id_remessa=?').bind(ret.id_remessa).first<any>();
  const sum = await c.env.DB.prepare('SELECT COALESCE(SUM(qtd_boa+qtd_refugo+qtd_conserto),0) AS s FROM terc_retornos WHERE id_remessa=?').bind(ret.id_remessa).first<any>();
  const total = Number(sum?.s) || 0;
  let novoStatus = 'Aberta';
  if (total > 0 && total < Number(rem.qtd_total)) novoStatus = 'Parcial';
  else if (total >= Number(rem.qtd_total)) novoStatus = 'Concluida';
  await c.env.DB.prepare('UPDATE terc_remessas SET status=? WHERE id_remessa=?').bind(novoStatus, ret.id_remessa).run();

  await audit(c, MOD, 'DEL_RET', `retorno:${id}`);
  return c.json(ok({ id, deleted: true, status_remessa: novoStatus }));
});

/* =================================================================
 * RESUMO DE TERCEIRIZAÇÕES (tela principal)
 * ================================================================= */

app.get('/terc/resumo', async (c) => {
  const q = c.req.query();
  const colFilter = q.id_colecao ? `AND r.id_colecao=${toInt(q.id_colecao)}` : '';

  const rs = await c.env.DB.prepare(`
    SELECT
      t.id_terc, t.nome_terc, t.situacao, t.prazo_padrao,
      s.nome_setor,
      COALESCE(SUM(CASE WHEN r.status IN ('Aberta','EmProducao','Parcial') THEN (r.qtd_total - IFNULL((SELECT SUM(qtd_boa+qtd_refugo+qtd_conserto) FROM terc_retornos WHERE id_remessa=r.id_remessa),0)) ELSE 0 END), 0) AS pecas_coletar,
      MAX(CASE WHEN r.status IN ('Aberta','EmProducao','Parcial') THEN r.dt_previsao END) AS dt_termino,
      COALESCE(SUM(CASE WHEN r.status IN ('Aberta','EmProducao','Parcial') THEN r.qtd_total ELSE 0 END), 0) AS pecas_producao,
      COALESCE((SELECT SUM(qtd_boa) FROM terc_retornos rt JOIN terc_remessas rm ON rm.id_remessa=rt.id_remessa WHERE rm.id_terc=t.id_terc ${colFilter}), 0) AS pecas_produzidas,
      COALESCE((SELECT SUM(qtd_conserto) FROM terc_retornos rt JOIN terc_remessas rm ON rm.id_remessa=rt.id_remessa WHERE rm.id_terc=t.id_terc ${colFilter}), 0) AS pecas_conserto,
      COALESCE((SELECT SUM(CASE WHEN c.status='Concluido' THEN c.qtd_retornada ELSE 0 END) FROM terc_consertos c WHERE c.id_terc=t.id_terc), 0) AS pecas_consertadas,
      COUNT(DISTINCT r.id_remessa) AS total_remessas,
      COALESCE(SUM(r.valor_total),0) AS valor_movimentado
    FROM terc_terceirizados t
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor
    LEFT JOIN terc_remessas r ON r.id_terc=t.id_terc ${colFilter}
    GROUP BY t.id_terc
    ORDER BY t.nome_terc`).all();

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
  const q = c.req.query();
  const ini = q.de || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const fim = q.ate || new Date().toISOString().slice(0, 10);

  // KPIs
  const kpiRem = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(qtd_total),0) AS pecas_enviadas,
      COALESCE(SUM(valor_total),0) AS valor_total,
      SUM(CASE WHEN status IN ('Aberta','EmProducao','Parcial') THEN 1 ELSE 0 END) AS em_aberto,
      SUM(CASE WHEN status='Concluida' THEN 1 ELSE 0 END) AS concluidas,
      SUM(CASE WHEN status NOT IN ('Concluida','Cancelada') AND date(dt_previsao) < date('now') THEN 1 ELSE 0 END) AS atrasadas
    FROM terc_remessas
    WHERE dt_saida BETWEEN ? AND ?`).bind(ini, fim).first<any>();

  const kpiRet = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(qtd_boa),0) AS pecas_boas,
      COALESCE(SUM(qtd_refugo),0) AS pecas_refugo,
      COALESCE(SUM(qtd_conserto),0) AS pecas_conserto,
      COALESCE(SUM(valor_pago),0) AS valor_pago
    FROM terc_retornos
    WHERE dt_retorno BETWEEN ? AND ?`).bind(ini, fim).first<any>();

  const topTerc = (await c.env.DB.prepare(`
    SELECT t.nome_terc, s.nome_setor,
      COUNT(r.id_remessa) AS remessas,
      COALESCE(SUM(r.qtd_total),0) AS pecas,
      COALESCE(SUM(r.valor_total),0) AS valor
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    LEFT JOIN terc_setores s ON s.id_setor=t.id_setor
    WHERE r.dt_saida BETWEEN ? AND ?
    GROUP BY t.id_terc
    ORDER BY pecas DESC
    LIMIT 10`).bind(ini, fim).all()).results;

  const porServico = (await c.env.DB.prepare(`
    SELECT sv.desc_servico,
      COUNT(r.id_remessa) AS remessas,
      COALESCE(SUM(r.qtd_total),0) AS pecas,
      COALESCE(SUM(r.valor_total),0) AS valor
    FROM terc_remessas r
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    WHERE r.dt_saida BETWEEN ? AND ?
    GROUP BY sv.id_servico
    ORDER BY pecas DESC`).bind(ini, fim).all()).results;

  const producaoDiaria = (await c.env.DB.prepare(`
    SELECT date(rt.dt_retorno) AS dia,
      COALESCE(SUM(rt.qtd_boa),0) AS boa,
      COALESCE(SUM(rt.qtd_refugo),0) AS refugo,
      COALESCE(SUM(rt.qtd_conserto),0) AS conserto
    FROM terc_retornos rt
    WHERE rt.dt_retorno BETWEEN ? AND ?
    GROUP BY date(rt.dt_retorno)
    ORDER BY dia`).bind(ini, fim).all()).results;

  const atrasadas = (await c.env.DB.prepare(`
    SELECT r.id_remessa, r.num_controle, r.num_op, r.cod_ref, r.desc_ref, r.cor, r.qtd_total,
      r.dt_saida, r.dt_previsao, t.nome_terc, sv.desc_servico,
      julianday('now') - julianday(r.dt_previsao) AS dias_atraso
    FROM terc_remessas r
    JOIN terc_terceirizados t ON t.id_terc=r.id_terc
    LEFT JOIN terc_servicos sv ON sv.id_servico=r.id_servico
    WHERE r.status NOT IN ('Concluida','Cancelada') AND date(r.dt_previsao) < date('now')
    ORDER BY dias_atraso DESC LIMIT 20`).all()).results;

  return c.json(ok({
    periodo: { de: ini, ate: fim },
    kpis: { remessas: kpiRem, retornos: kpiRet },
    top_terceirizados: topTerc,
    por_servico: porServico,
    producao_diaria: producaoDiaria,
    atrasadas,
  }));
});

/* =================================================================
 * IMPORTADOR — recebe linhas parseadas do Excel/CSV no frontend
 * ================================================================= */

app.post('/terc/importar/remessas', async (c) => {
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

  (await c.env.DB.prepare('SELECT id_terc, nome_terc FROM terc_terceirizados').all()).results.forEach((r: any) => tercs[String(r.nome_terc).toLowerCase().trim()] = r.id_terc);
  (await c.env.DB.prepare('SELECT id_servico, desc_servico FROM terc_servicos').all()).results.forEach((r: any) => servicos[String(r.desc_servico).toLowerCase().trim()] = r.id_servico);
  (await c.env.DB.prepare('SELECT id_setor, nome_setor FROM terc_setores').all()).results.forEach((r: any) => setores[String(r.nome_setor).toLowerCase().trim()] = r.id_setor);
  (await c.env.DB.prepare('SELECT id_colecao, nome_colecao FROM terc_colecoes').all()).results.forEach((r: any) => colecoes[String(r.nome_colecao).toLowerCase().trim()] = r.id_colecao);

  const erros: any[] = [];
  let inseridas = 0, ignoradas = 0, cadCriados = 0;

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
        const r = await c.env.DB.prepare('INSERT INTO terc_terceirizados (nome_terc, situacao, ativo) VALUES (?, ?, 1)').bind(nome_terc, 'Ativa').run();
        id_terc = r.meta.last_row_id as number;
        tercs[nome_terc.toLowerCase()] = id_terc; cadCriados++;
      }
      if (!id_terc) { erros.push({ linha: n, erro: `Terceirizado "${nome_terc}" não cadastrado` }); ignoradas++; continue; }

      let id_servico = servicos[desc_servico.toLowerCase()];
      if (!id_servico && criarCadastros && !dryRun) {
        const r = await c.env.DB.prepare('INSERT INTO terc_servicos (desc_servico, ativo) VALUES (?, 1)').bind(desc_servico).run();
        id_servico = r.meta.last_row_id as number;
        servicos[desc_servico.toLowerCase()] = id_servico; cadCriados++;
      }
      if (!id_servico) { erros.push({ linha: n, erro: `Serviço "${desc_servico}" não cadastrado` }); ignoradas++; continue; }

      let id_setor = null;
      if (row.setor) {
        id_setor = setores[String(row.setor).toLowerCase()] || null;
        if (!id_setor && criarCadastros && !dryRun) {
          const r = await c.env.DB.prepare('INSERT INTO terc_setores (nome_setor, ativo) VALUES (?, 1)').bind(row.setor).run();
          id_setor = r.meta.last_row_id as number;
          setores[String(row.setor).toLowerCase()] = id_setor; cadCriados++;
        }
      }

      let id_colecao = null;
      if (row.colecao) {
        id_colecao = colecoes[String(row.colecao).toLowerCase()] || null;
        if (!id_colecao && criarCadastros && !dryRun) {
          const r = await c.env.DB.prepare('INSERT INTO terc_colecoes (nome_colecao, ativo) VALUES (?, 1)').bind(row.colecao).run();
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

      if (!dryRun) {
        const nextN = await c.env.DB.prepare('SELECT COALESCE(MAX(num_controle),0)+1 AS n FROM terc_remessas').first<any>();
        const r = await c.env.DB.prepare(`
          INSERT INTO terc_remessas (num_controle, num_op, id_terc, id_setor, cod_ref, desc_ref, id_servico, cor, grade, qtd_total, preco_unit, valor_total, id_colecao, dt_saida, dt_inicio, dt_previsao, prazo_dias, tempo_peca, efic_pct, qtd_pessoas, min_trab_dia, status, observacao, criado_por)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(toInt(row.num_controle) || nextN?.n, row.num_op || null, id_terc, id_setor, cod_ref, row.desc_ref || null,
            id_servico, row.cor || null, toInt(row.grade, 1), qtd_total, preco, valor, id_colecao,
            dt_saida, row.dt_inicio || dt_saida, row.dt_previsao || dt_saida,
            toInt(row.prazo_dias), toNum(row.tempo_peca), toNum(row.efic_pct, 0.8),
            toInt(row.qtd_pessoas, 1), toInt(row.min_trab_dia, 480),
            row.status || 'Aberta', row.observacao || null, getUser(c)).run();
        const idR = r.meta.last_row_id;
        for (const g of grade) {
          await c.env.DB.prepare('INSERT INTO terc_remessa_grade (id_remessa, tamanho, qtd) VALUES (?, ?, ?)').bind(idR, g.tamanho, g.qtd).run();
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
    erros: erros.slice(0, 100),
  }));
});

export default app;
