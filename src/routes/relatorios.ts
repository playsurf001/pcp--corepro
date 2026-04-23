// Módulo de Relatórios profissionais (agregadores para PDF/impressão)
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, toNum } from '../lib/db';

const app = new Hono<{ Bindings: Bindings }>();

/* Helper: obtém período padrão (mês atual) */
function resolvePeriodo(q: any) {
  const hoje = new Date();
  const ini = q.dt_ini || new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
  const fim = q.dt_fim || new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { ini, fim };
}

/* ============================================================
 * 1) RELATÓRIO EXECUTIVO — KPIs + gráficos agregados do período
 * ============================================================ */
app.get('/relatorios/executivo', async (c) => {
  const q = c.req.query();
  const { ini, fim } = resolvePeriodo(q);

  // KPIs principais
  const kpiOps = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status='Aberta' THEN 1 ELSE 0 END) AS abertas,
       SUM(CASE WHEN status='Planejada' THEN 1 ELSE 0 END) AS planejadas,
       SUM(CASE WHEN status='EmProducao' THEN 1 ELSE 0 END) AS em_producao,
       SUM(CASE WHEN status='Concluida' THEN 1 ELSE 0 END) AS concluidas,
       SUM(CASE WHEN status='Cancelada' THEN 1 ELSE 0 END) AS canceladas,
       SUM(qtde_pecas) AS pecas_total,
       SUM(CASE WHEN status IN ('Aberta','Planejada','EmProducao') THEN qtde_pecas ELSE 0 END) AS pecas_aberto,
       SUM(CASE WHEN status IN ('Aberta','Planejada','EmProducao') AND dt_entrega < date('now') THEN 1 ELSE 0 END) AS atrasadas,
       AVG(julianday(dt_entrega) - julianday(dt_emissao)) AS prazo_medio
     FROM op_cab
     WHERE date(dt_emissao) BETWEEN ? AND ?`
  ).bind(ini, fim).first<any>();

  // Produção do período (apontamentos)
  const kpiProd = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total_apont,
       SUM(qtd_boa) AS producao_boa,
       SUM(qtd_refugo) AS refugo,
       SUM(horas_trab) AS horas_total,
       AVG(efic_real) AS efic_media
     FROM apontamento
     WHERE date(data) BETWEEN ? AND ?`
  ).bind(ini, fim).first<any>();

  // Top clientes (peças)
  const topClientes = await c.env.DB.prepare(
    `SELECT c.cod_cliente, c.nome_cliente,
       COUNT(op.id_op) AS qtd_ops,
       SUM(op.qtde_pecas) AS pecas,
       SUM(CASE WHEN op.status='Concluida' THEN 1 ELSE 0 END) AS ops_concluidas
     FROM op_cab op
     JOIN clientes c ON c.id_cliente=op.id_cliente
     WHERE date(op.dt_emissao) BETWEEN ? AND ?
     GROUP BY c.id_cliente
     ORDER BY pecas DESC
     LIMIT 10`
  ).bind(ini, fim).all();

  // Top referências
  const topRefs = await c.env.DB.prepare(
    `SELECT r.cod_ref, r.desc_ref, r.familia,
       COUNT(op.id_op) AS qtd_ops,
       SUM(op.qtde_pecas) AS pecas
     FROM op_cab op
     JOIN referencias r ON r.id_ref=op.id_ref
     WHERE date(op.dt_emissao) BETWEEN ? AND ?
     GROUP BY r.id_ref
     ORDER BY pecas DESC
     LIMIT 10`
  ).bind(ini, fim).all();

  // Status breakdown
  const statusBreak = await c.env.DB.prepare(
    `SELECT status, COUNT(*) AS c, SUM(qtde_pecas) AS pecas
     FROM op_cab
     WHERE date(dt_emissao) BETWEEN ? AND ?
     GROUP BY status`
  ).bind(ini, fim).all();

  // Produção diária (série temporal)
  const prodDiaria = await c.env.DB.prepare(
    `SELECT data AS dia,
       SUM(qtd_boa) AS boa,
       SUM(qtd_refugo) AS refugo,
       SUM(horas_trab) AS horas,
       AVG(efic_real) AS efic
     FROM apontamento
     WHERE date(data) BETWEEN ? AND ?
     GROUP BY data
     ORDER BY data`
  ).bind(ini, fim).all();

  // Top operadores
  const topOps = await c.env.DB.prepare(
    `SELECT operador,
       COUNT(*) AS apontamentos,
       SUM(qtd_boa) AS total_boa,
       SUM(qtd_refugo) AS total_refugo,
       SUM(horas_trab) AS horas,
       AVG(efic_real) AS efic_media
     FROM apontamento
     WHERE date(data) BETWEEN ? AND ? AND operador IS NOT NULL AND operador != ''
     GROUP BY operador
     ORDER BY total_boa DESC
     LIMIT 10`
  ).bind(ini, fim).all();

  await audit(c, 'REL', 'VIEW', `Executivo ${ini}..${fim}`);
  return c.json(ok({
    periodo: { ini, fim },
    kpis: {
      ops: kpiOps || {},
      producao: kpiProd || {},
      refugo_pct: kpiProd && kpiProd.producao_boa > 0
        ? (kpiProd.refugo || 0) / ((kpiProd.producao_boa || 0) + (kpiProd.refugo || 0))
        : 0,
    },
    top_clientes: topClientes.results,
    top_refs: topRefs.results,
    status_breakdown: statusBreak.results,
    producao_diaria: prodDiaria.results,
    top_operadores: topOps.results,
  }));
});

/* ============================================================
 * 2) RELATÓRIO DETALHADO DE OP — ficha completa imprimível
 * ============================================================ */
app.get('/relatorios/op/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const op = await c.env.DB.prepare(
    `SELECT op.*, r.cod_ref, r.desc_ref, r.familia,
       c.cod_cliente, c.nome_cliente, c.cnpj, c.observacao AS obs_cliente,
       sc.versao AS versao_seq
     FROM op_cab op
     JOIN referencias r ON r.id_ref=op.id_ref
     JOIN clientes c ON c.id_cliente=op.id_cliente
     LEFT JOIN seq_cab sc ON sc.id_seq_cab=op.id_seq_cab
     WHERE op.id_op=?`
  ).bind(id).first<any>();
  if (!op) return fail('OP não encontrada.', 404);

  const cores = await c.env.DB.prepare(
    `SELECT oc.qtde_pecas, co.cod_cor, co.nome_cor
     FROM op_cores oc JOIN cores co ON co.id_cor=oc.id_cor
     WHERE oc.id_op=? ORDER BY co.nome_cor`
  ).bind(id).all();

  const tamanhos = await c.env.DB.prepare(
    `SELECT ot.qtde_pecas, t.cod_tam, t.ordem
     FROM op_tamanhos ot JOIN tamanhos t ON t.id_tam=ot.id_tam
     WHERE ot.id_op=? ORDER BY t.ordem`
  ).bind(id).all();

  const sequencia = await c.env.DB.prepare(
    `SELECT si.sequencia, si.tempo_padrao,
       o.cod_op, o.desc_op,
       m.cod_maquina, m.desc_maquina, m.tipo AS maq_tipo, m.eficiencia AS maq_efic,
       ap.cod_aparelho, ap.desc_aparelho
     FROM seq_itens si
     JOIN operacoes o ON o.id_op=si.id_op
     LEFT JOIN maquinas m ON m.id_maquina=si.id_maquina
     LEFT JOIN aparelhos ap ON ap.id_aparelho=si.id_aparelho
     WHERE si.id_seq_cab=?
     ORDER BY si.sequencia`
  ).bind(op.id_seq_cab).all();

  const apontamentos = await c.env.DB.prepare(
    `SELECT a.*, si.sequencia, o.cod_op, o.desc_op
     FROM apontamento a
     LEFT JOIN seq_itens si ON si.id_seq_item=a.id_seq_item
     LEFT JOIN operacoes o ON o.id_op=si.id_op
     WHERE a.id_op=?
     ORDER BY a.data DESC, a.id_apont DESC`
  ).bind(id).all();

  // Totais
  const seqItems = sequencia.results as any[];
  const tempoTotalRef = seqItems.reduce((acc, s) => acc + toNum(s.tempo_padrao), 0);
  const apontItems = apontamentos.results as any[];
  const totApont = apontItems.reduce((a: any, x: any) => ({
    boa: a.boa + toNum(x.qtd_boa),
    refugo: a.refugo + toNum(x.qtd_refugo),
    horas: a.horas + toNum(x.horas_trab),
  }), { boa: 0, refugo: 0, horas: 0 });
  const eficMedia = apontItems.length
    ? apontItems.reduce((s, x) => s + toNum(x.efic_real), 0) / apontItems.length
    : 0;
  const pctConcluido = toNum(op.qtde_pecas) > 0 ? totApont.boa / toNum(op.qtde_pecas) : 0;

  await audit(c, 'REL', 'VIEW', `OP=${op.num_op}`);
  return c.json(ok({
    op,
    cores: cores.results,
    tamanhos: tamanhos.results,
    sequencia: seqItems,
    apontamentos: apontItems,
    totais: {
      tempo_total_ref: tempoTotalRef,
      producao_boa: totApont.boa,
      refugo: totApont.refugo,
      horas_total: totApont.horas,
      efic_media: eficMedia,
      pct_concluido: pctConcluido,
      pecas_restantes: Math.max(0, toNum(op.qtde_pecas) - totApont.boa),
    },
  }));
});

/* ============================================================
 * 3) PRODUÇÃO POR PERÍODO — apontamentos agregados/detalhados
 * ============================================================ */
app.get('/relatorios/producao', async (c) => {
  const q = c.req.query();
  const { ini, fim } = resolvePeriodo(q);
  const idOp = q.id_op ? toInt(q.id_op) : null;
  const operador = q.operador || null;

  const conds: string[] = [`date(a.data) BETWEEN ? AND ?`];
  const binds: any[] = [ini, fim];
  if (idOp) { conds.push(`a.id_op = ?`); binds.push(idOp); }
  if (operador) { conds.push(`a.operador LIKE ?`); binds.push(`%${operador}%`); }

  // Detalhe
  const detalhe = await c.env.DB.prepare(
    `SELECT a.*, op.num_op, r.cod_ref, r.desc_ref, c.nome_cliente,
       si.sequencia, o.cod_op, o.desc_op,
       m.cod_maquina, m.desc_maquina
     FROM apontamento a
     JOIN op_cab op ON op.id_op=a.id_op
     JOIN referencias r ON r.id_ref=op.id_ref
     JOIN clientes c ON c.id_cliente=op.id_cliente
     LEFT JOIN seq_itens si ON si.id_seq_item=a.id_seq_item
     LEFT JOIN operacoes o ON o.id_op=si.id_op
     LEFT JOIN maquinas m ON m.id_maquina=si.id_maquina
     WHERE ${conds.join(' AND ')}
     ORDER BY a.data DESC, a.id_apont DESC`
  ).bind(...binds).all();

  // Resumo por OP
  const porOp = await c.env.DB.prepare(
    `SELECT op.id_op, op.num_op, r.cod_ref, c.nome_cliente,
       SUM(a.qtd_boa) AS boa, SUM(a.qtd_refugo) AS refugo,
       SUM(a.horas_trab) AS horas,
       AVG(a.efic_real) AS efic
     FROM apontamento a
     JOIN op_cab op ON op.id_op=a.id_op
     JOIN referencias r ON r.id_ref=op.id_ref
     JOIN clientes c ON c.id_cliente=op.id_cliente
     WHERE ${conds.join(' AND ')}
     GROUP BY op.id_op
     ORDER BY boa DESC`
  ).bind(...binds).all();

  // Resumo por operador
  const porOperador = await c.env.DB.prepare(
    `SELECT a.operador,
       COUNT(*) AS apontamentos,
       SUM(a.qtd_boa) AS boa,
       SUM(a.qtd_refugo) AS refugo,
       SUM(a.horas_trab) AS horas,
       AVG(a.efic_real) AS efic
     FROM apontamento a
     WHERE ${conds.join(' AND ')} AND a.operador IS NOT NULL AND a.operador != ''
     GROUP BY a.operador
     ORDER BY boa DESC`
  ).bind(...binds).all();

  // Resumo por máquina
  const porMaquina = await c.env.DB.prepare(
    `SELECT m.cod_maquina, m.desc_maquina, m.tipo,
       COUNT(*) AS apontamentos,
       SUM(a.qtd_boa) AS boa,
       SUM(a.qtd_refugo) AS refugo,
       SUM(a.horas_trab) AS horas,
       AVG(a.efic_real) AS efic
     FROM apontamento a
     JOIN seq_itens si ON si.id_seq_item=a.id_seq_item
     JOIN maquinas m ON m.id_maquina=si.id_maquina
     WHERE ${conds.join(' AND ')}
     GROUP BY m.id_maquina
     ORDER BY boa DESC`
  ).bind(...binds).all();

  // Totais
  const tot = await c.env.DB.prepare(
    `SELECT COUNT(*) AS apontamentos,
       SUM(a.qtd_boa) AS boa, SUM(a.qtd_refugo) AS refugo,
       SUM(a.horas_trab) AS horas,
       AVG(a.efic_real) AS efic
     FROM apontamento a
     WHERE ${conds.join(' AND ')}`
  ).bind(...binds).first<any>();

  await audit(c, 'REL', 'VIEW', `Producao ${ini}..${fim}`);
  return c.json(ok({
    periodo: { ini, fim }, filtros: { id_op: idOp, operador },
    detalhe: detalhe.results,
    por_op: porOp.results,
    por_operador: porOperador.results,
    por_maquina: porMaquina.results,
    totais: tot || {},
  }));
});

/* ============================================================
 * 4) RELATÓRIO POR CLIENTE — histórico e KPIs por cliente
 * ============================================================ */
app.get('/relatorios/cliente/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const q = c.req.query();
  const { ini, fim } = resolvePeriodo(q);

  const cliente = await c.env.DB.prepare(
    `SELECT * FROM clientes WHERE id_cliente=?`
  ).bind(id).first<any>();
  if (!cliente) return fail('Cliente não encontrado.', 404);

  const resumoOps = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN status='Aberta' THEN 1 ELSE 0 END) AS abertas,
       SUM(CASE WHEN status='Planejada' THEN 1 ELSE 0 END) AS planejadas,
       SUM(CASE WHEN status='EmProducao' THEN 1 ELSE 0 END) AS em_producao,
       SUM(CASE WHEN status='Concluida' THEN 1 ELSE 0 END) AS concluidas,
       SUM(CASE WHEN status='Cancelada' THEN 1 ELSE 0 END) AS canceladas,
       SUM(qtde_pecas) AS pecas,
       SUM(CASE WHEN status IN ('Aberta','Planejada','EmProducao') AND dt_entrega < date('now') THEN 1 ELSE 0 END) AS atrasadas,
       AVG(julianday(dt_entrega) - julianday(dt_emissao)) AS prazo_medio
     FROM op_cab
     WHERE id_cliente=? AND date(dt_emissao) BETWEEN ? AND ?`
  ).bind(id, ini, fim).first<any>();

  const listaOps = await c.env.DB.prepare(
    `SELECT op.id_op, op.num_op, op.status, op.qtde_pecas,
       op.dt_emissao, op.dt_entrega, r.cod_ref, r.desc_ref,
       CASE WHEN op.dt_entrega < date('now') AND op.status NOT IN ('Concluida','Cancelada') THEN 1 ELSE 0 END AS atrasada
     FROM op_cab op
     JOIN referencias r ON r.id_ref=op.id_ref
     WHERE op.id_cliente=? AND date(op.dt_emissao) BETWEEN ? AND ?
     ORDER BY op.dt_emissao DESC`
  ).bind(id, ini, fim).all();

  const porRef = await c.env.DB.prepare(
    `SELECT r.cod_ref, r.desc_ref,
       COUNT(op.id_op) AS ops,
       SUM(op.qtde_pecas) AS pecas
     FROM op_cab op
     JOIN referencias r ON r.id_ref=op.id_ref
     WHERE op.id_cliente=? AND date(op.dt_emissao) BETWEEN ? AND ?
     GROUP BY r.id_ref
     ORDER BY pecas DESC`
  ).bind(id, ini, fim).all();

  // Produção do cliente no período
  const producao = await c.env.DB.prepare(
    `SELECT SUM(a.qtd_boa) AS boa, SUM(a.qtd_refugo) AS refugo,
       SUM(a.horas_trab) AS horas, AVG(a.efic_real) AS efic
     FROM apontamento a
     JOIN op_cab op ON op.id_op=a.id_op
     WHERE op.id_cliente=? AND date(a.data) BETWEEN ? AND ?`
  ).bind(id, ini, fim).first<any>();

  await audit(c, 'REL', 'VIEW', `Cliente=${cliente.cod_cliente}`);
  return c.json(ok({
    cliente, periodo: { ini, fim },
    resumo_ops: resumoOps || {},
    ops: listaOps.results,
    por_referencia: porRef.results,
    producao: producao || {},
  }));
});

/* ============================================================
 * 5) RELATÓRIO POR REFERÊNCIA — análise de produto
 * ============================================================ */
app.get('/relatorios/referencia/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const q = c.req.query();
  const { ini, fim } = resolvePeriodo(q);

  const ref = await c.env.DB.prepare(`SELECT * FROM referencias WHERE id_ref=?`).bind(id).first<any>();
  if (!ref) return fail('Referência não encontrada.', 404);

  const seqAtiva = await c.env.DB.prepare(
    `SELECT sc.*, COUNT(si.id_seq_item) AS qtd_itens,
       SUM(si.tempo_padrao) AS tempo_total
     FROM seq_cab sc
     LEFT JOIN seq_itens si ON si.id_seq_cab=sc.id_seq_cab
     WHERE sc.id_ref=? AND sc.ativa=1
     GROUP BY sc.id_seq_cab`
  ).bind(id).first<any>();

  const versoes = await c.env.DB.prepare(
    `SELECT versao, ativa, dt_criacao, dt_ativacao FROM seq_cab WHERE id_ref=? ORDER BY versao DESC`
  ).bind(id).all();

  const resumoOps = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
       SUM(qtde_pecas) AS pecas,
       SUM(CASE WHEN status='Concluida' THEN qtde_pecas ELSE 0 END) AS pecas_concluidas,
       SUM(CASE WHEN status IN ('Aberta','Planejada','EmProducao') THEN qtde_pecas ELSE 0 END) AS pecas_aberto,
       SUM(CASE WHEN dt_entrega < date('now') AND status NOT IN ('Concluida','Cancelada') THEN 1 ELSE 0 END) AS atrasadas
     FROM op_cab
     WHERE id_ref=? AND date(dt_emissao) BETWEEN ? AND ?`
  ).bind(id, ini, fim).first<any>();

  const porCliente = await c.env.DB.prepare(
    `SELECT c.cod_cliente, c.nome_cliente,
       COUNT(op.id_op) AS ops, SUM(op.qtde_pecas) AS pecas
     FROM op_cab op
     JOIN clientes c ON c.id_cliente=op.id_cliente
     WHERE op.id_ref=? AND date(op.dt_emissao) BETWEEN ? AND ?
     GROUP BY c.id_cliente
     ORDER BY pecas DESC`
  ).bind(id, ini, fim).all();

  const producao = await c.env.DB.prepare(
    `SELECT SUM(a.qtd_boa) AS boa, SUM(a.qtd_refugo) AS refugo,
       SUM(a.horas_trab) AS horas, AVG(a.efic_real) AS efic,
       COUNT(*) AS apontamentos
     FROM apontamento a
     JOIN op_cab op ON op.id_op=a.id_op
     WHERE op.id_ref=? AND date(a.data) BETWEEN ? AND ?`
  ).bind(id, ini, fim).first<any>();

  // Eficiência por operação da sequência ativa
  const eficPorOp: any = seqAtiva
    ? await c.env.DB.prepare(
      `SELECT o.cod_op, o.desc_op, si.tempo_padrao,
         COUNT(a.id_apont) AS apontamentos,
         SUM(a.qtd_boa) AS boa, SUM(a.qtd_refugo) AS refugo,
         AVG(a.efic_real) AS efic
       FROM seq_itens si
       JOIN operacoes o ON o.id_op=si.id_op
       LEFT JOIN apontamento a ON a.id_seq_item=si.id_seq_item
         AND date(a.data) BETWEEN ? AND ?
       WHERE si.id_seq_cab=?
       GROUP BY si.id_seq_item
       ORDER BY si.sequencia`
    ).bind(ini, fim, seqAtiva.id_seq_cab).all()
    : { results: [] };

  await audit(c, 'REL', 'VIEW', `Ref=${ref.cod_ref}`);
  return c.json(ok({
    referencia: ref, periodo: { ini, fim },
    sequencia_ativa: seqAtiva,
    versoes: versoes.results,
    resumo_ops: resumoOps || {},
    por_cliente: porCliente.results,
    producao: producao || {},
    efic_por_operacao: eficPorOp.results,
  }));
});

/* ============================================================
 * 6) RELATÓRIO DE AUDITORIA — rastro imprimível
 * ============================================================ */
app.get('/relatorios/auditoria', async (c) => {
  const q = c.req.query();
  const { ini, fim } = resolvePeriodo(q);
  const modulo = q.modulo || null;
  const usuario = q.usuario || null;
  const busca = q.busca || null;

  const conds: string[] = [`date(dt_hora) BETWEEN ? AND ?`];
  const binds: any[] = [ini, fim];
  if (modulo) { conds.push(`modulo = ?`); binds.push(modulo); }
  if (usuario) { conds.push(`usuario = ?`); binds.push(usuario); }
  if (busca) { conds.push(`chave_registro LIKE ?`); binds.push(`%${busca}%`); }

  const registros = await c.env.DB.prepare(
    `SELECT * FROM auditoria WHERE ${conds.join(' AND ')}
     ORDER BY dt_hora DESC, id_audit DESC LIMIT 1000`
  ).bind(...binds).all();

  // Resumo agregado
  const porModulo = await c.env.DB.prepare(
    `SELECT modulo, COUNT(*) AS total FROM auditoria
     WHERE ${conds.join(' AND ')}
     GROUP BY modulo ORDER BY total DESC`
  ).bind(...binds).all();

  const porAcao = await c.env.DB.prepare(
    `SELECT acao, COUNT(*) AS total FROM auditoria
     WHERE ${conds.join(' AND ')}
     GROUP BY acao ORDER BY total DESC`
  ).bind(...binds).all();

  const porUsuario = await c.env.DB.prepare(
    `SELECT usuario, COUNT(*) AS total FROM auditoria
     WHERE ${conds.join(' AND ')}
     GROUP BY usuario ORDER BY total DESC`
  ).bind(...binds).all();

  return c.json(ok({
    periodo: { ini, fim }, filtros: { modulo, usuario, busca },
    total: (registros.results || []).length,
    registros: registros.results,
    por_modulo: porModulo.results,
    por_acao: porAcao.results,
    por_usuario: porUsuario.results,
  }));
});

/* ---------- Listas auxiliares para filtros ---------- */
app.get('/relatorios/filtros', async (c) => {
  const clientes = await c.env.DB.prepare(
    `SELECT id_cliente, cod_cliente, nome_cliente FROM clientes WHERE ativo=1 ORDER BY nome_cliente`
  ).all();
  const refs = await c.env.DB.prepare(
    `SELECT id_ref, cod_ref, desc_ref FROM referencias WHERE ativo=1 ORDER BY cod_ref`
  ).all();
  const ops = await c.env.DB.prepare(
    `SELECT id_op, num_op FROM op_cab ORDER BY id_op DESC LIMIT 500`
  ).all();
  const operadores = await c.env.DB.prepare(
    `SELECT DISTINCT operador FROM apontamento WHERE operador IS NOT NULL AND operador != '' ORDER BY operador`
  ).all();
  const modulosAud = await c.env.DB.prepare(
    `SELECT DISTINCT modulo FROM auditoria ORDER BY modulo`
  ).all();
  const usuariosAud = await c.env.DB.prepare(
    `SELECT DISTINCT usuario FROM auditoria WHERE usuario IS NOT NULL ORDER BY usuario`
  ).all();
  return c.json(ok({
    clientes: clientes.results,
    refs: refs.results,
    ops: ops.results,
    operadores: (operadores.results as any[]).map(x => x.operador),
    modulos_auditoria: (modulosAud.results as any[]).map(x => x.modulo),
    usuarios_auditoria: (usuariosAud.results as any[]).map(x => x.usuario),
  }));
});

export default app;
