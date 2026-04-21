// Balanceamento, Ficha de Acompanhamento, Apontamento, Dashboard
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, toNum } from '../lib/db';

const app = new Hono<{ Bindings: Bindings }>();

/* ===================== BALANCEAMENTO =====================
   Regras:
   - PçsHora100   = 60 / TempoPadrão
   - PçsHoraReal  = PçsHora100 * eficiência_efetiva
   - QtdMáquinas  = CEIL( (QtdPecasDia * TempoPadrão) / (MinTurno * Turnos * efic_efetiva) )
   - QtdOperador  = (se máquina) QtdMáquinas * OperPorMáquina
                    (senão)      CEIL( (QtdPecasDia * TempoPadrão) / (MinTurno * Turnos) )
   - Modos:
     1 = 100%  (efic=1)   — igual ao legado R3=1
     2 = Efic Geral       — usa b.eficiencia       — igual ao legado R3=2
     3 = Efic por Máquina — usa maquinas.eficiencia — igual ao legado R3=3
========================================================== */
app.get('/ops/:id/balanceamento', async (c) => {
  const id = toInt(c.req.param('id'));
  const q = c.req.query();
  const modo = toInt(q.modo, 3); // 1,2,3
  const op = await c.env.DB.prepare(
    `SELECT op.*, r.cod_ref, r.desc_ref, c.nome_cliente
     FROM op_cab op
     JOIN referencias r ON r.id_ref=op.id_ref
     JOIN clientes c ON c.id_cliente=op.id_cliente
     WHERE op.id_op=?`
  ).bind(id).first<any>();
  if (!op) return fail('OP não encontrada.', 404);

  const param = await c.env.DB.prepare(`SELECT chave, valor FROM parametros`).all();
  const P: Record<string, string> = {};
  (param.results as any[]).forEach((r) => (P[r.chave] = r.valor));

  const minTurno = toNum(q.min_turno, toNum(P.MIN_TURNO, 480));
  const turnos = toNum(q.turnos, toNum(P.TURNOS, 1));
  const eficGeral = toNum(q.eficiencia, toNum(P.EFIC_PADRAO, 0.85));
  // Dias úteis entre emissão e entrega (aproximado: diferença de dias)
  const dtEm = new Date(op.dt_emissao);
  const dtEnt = new Date(op.dt_entrega);
  let diasUteis = Math.ceil((dtEnt.getTime() - dtEm.getTime()) / 86400000);
  if (diasUteis <= 0) diasUteis = 1;
  const qtdPecasDia = toNum(q.pecas_dia, Math.ceil(toNum(op.qtde_pecas) / diasUteis));

  const itens = await c.env.DB.prepare(
    `SELECT si.*,
       o.cod_op, o.desc_op,
       m.id_maquina AS maq_id, m.cod_maquina, m.desc_maquina, m.tipo AS maq_tipo,
       m.eficiencia AS maq_eficiencia, m.oper_por_maquina,
       ap.cod_aparelho, ap.desc_aparelho
     FROM seq_itens si
     JOIN operacoes o ON o.id_op=si.id_op
     LEFT JOIN maquinas m ON m.id_maquina=si.id_maquina
     LEFT JOIN aparelhos ap ON ap.id_aparelho=si.id_aparelho
     WHERE si.id_seq_cab=?
     ORDER BY si.sequencia`
  ).bind(op.id_seq_cab).all();

  const linhas = (itens.results as any[]).map((it) => {
    const tp = toNum(it.tempo_padrao);
    const efic = modo === 1 ? 1 : modo === 2 ? eficGeral : toNum(it.maq_eficiencia, eficGeral);
    const pph100 = tp > 0 ? 60 / tp : 0;
    const pphReal = pph100 * efic;
    const denomMaq = minTurno * turnos * (efic || 1);
    const qtdMaq = denomMaq > 0 ? Math.ceil((qtdPecasDia * tp) / denomMaq) : 0;
    let qtdOper = 0;
    if (it.maq_id) {
      qtdOper = qtdMaq * toNum(it.oper_por_maquina, 1);
    } else {
      qtdOper = Math.ceil((qtdPecasDia * tp) / (minTurno * turnos));
    }
    return {
      sequencia: it.sequencia,
      cod_op: it.cod_op,
      desc_op: it.desc_op,
      cod_maquina: it.cod_maquina,
      desc_maquina: it.desc_maquina,
      tipo_maquina: it.maq_tipo,
      cod_aparelho: it.cod_aparelho,
      desc_aparelho: it.desc_aparelho,
      tempo_padrao: tp,
      eficiencia: efic,
      pcs_hora_100: pph100,
      pcs_hora_real: pphReal,
      qtd_maquinas: qtdMaq,
      qtd_operadores: qtdOper,
      observacao: it.observacao || '',
    };
  });

  // Resumo por tipo de máquina
  const resumo: Record<string, { tipo: string; qtd: number }> = {};
  linhas.forEach((l) => {
    const k = l.tipo_maquina || '(sem máquina)';
    if (!resumo[k]) resumo[k] = { tipo: k, qtd: 0 };
    resumo[k].qtd += l.qtd_maquinas;
  });

  const tempoTotal = linhas.reduce((s, l) => s + toNum(l.tempo_padrao), 0);
  const totalMinOP = tempoTotal * toInt(op.qtde_pecas);
  const totalMaq = linhas.reduce((s, l) => s + l.qtd_maquinas, 0);
  const totalOper = linhas.reduce((s, l) => s + l.qtd_operadores, 0);

  await audit(c.env.DB, 'BALANC', 'GERAR', `OP=${op.num_op}`, 'modo', '', modo);
  return c.json(
    ok({
      op: {
        id_op: op.id_op,
        num_op: op.num_op,
        cod_ref: op.cod_ref,
        desc_ref: op.desc_ref,
        nome_cliente: op.nome_cliente,
        qtde_pecas: op.qtde_pecas,
        dt_entrega: op.dt_entrega,
      },
      parametros: {
        modo,
        min_turno: minTurno,
        turnos,
        eficiencia_geral: eficGeral,
        pecas_dia: qtdPecasDia,
        dias_uteis: diasUteis,
      },
      linhas,
      resumo_maquinas: Object.values(resumo),
      totais: {
        tempo_total_ref: tempoTotal,
        total_min_op: totalMinOP,
        qtd_maquinas: totalMaq,
        qtd_operadores: totalOper,
      },
    })
  );
});

/* ===================== FICHA DE ACOMPANHAMENTO =====================
   - Lista operações da sequência ativa da OP
   - Campos: tempo padrão, pçs/hora, pacote, tempo por pacote
==================================================================== */
app.get('/ops/:id/ficha', async (c) => {
  const id = toInt(c.req.param('id'));
  const q = c.req.query();
  const op = await c.env.DB.prepare(
    `SELECT op.*, r.cod_ref, r.desc_ref, c.nome_cliente
     FROM op_cab op
     JOIN referencias r ON r.id_ref=op.id_ref
     JOIN clientes c ON c.id_cliente=op.id_cliente
     WHERE op.id_op=?`
  ).bind(id).first<any>();
  if (!op) return fail('OP não encontrada.', 404);

  const param = await c.env.DB.prepare(`SELECT chave, valor FROM parametros`).all();
  const P: Record<string, string> = {};
  (param.results as any[]).forEach((r) => (P[r.chave] = r.valor));
  const pacote = toNum(q.pacote, toNum(P.PACOTE_PADRAO, 10));

  const itens = await c.env.DB.prepare(
    `SELECT si.*, o.cod_op, o.desc_op,
       m.cod_maquina, m.desc_maquina,
       ap.cod_aparelho, ap.desc_aparelho
     FROM seq_itens si
     JOIN operacoes o ON o.id_op=si.id_op
     LEFT JOIN maquinas m ON m.id_maquina=si.id_maquina
     LEFT JOIN aparelhos ap ON ap.id_aparelho=si.id_aparelho
     WHERE si.id_seq_cab=?
     ORDER BY si.sequencia`
  ).bind(op.id_seq_cab).all();

  const linhas = (itens.results as any[]).map((it) => {
    const tp = toNum(it.tempo_padrao);
    const pph = tp > 0 ? 60 / tp : 0;
    return {
      sequencia: it.sequencia,
      cod_op: it.cod_op,
      desc_op: it.desc_op,
      desc_maquina: it.desc_maquina,
      desc_aparelho: it.desc_aparelho,
      tempo_padrao: tp,
      pcs_hora: pph,
      pacote,
      tempo_pacote: tp * pacote,
    };
  });

  const tempoTotal = linhas.reduce((s, l) => s + toNum(l.tempo_padrao), 0);
  const totalMinOP = tempoTotal * toInt(op.qtde_pecas);

  // Cores e tamanhos para o cabeçalho
  const cores = await c.env.DB.prepare(
    `SELECT co.nome_cor, oc.qtde_pecas FROM op_cores oc
     JOIN cores co ON co.id_cor=oc.id_cor WHERE oc.id_op=? ORDER BY co.nome_cor`
  ).bind(id).all();
  const tams = await c.env.DB.prepare(
    `SELECT t.cod_tam, ot.qtde_pecas FROM op_tamanhos ot
     JOIN tamanhos t ON t.id_tam=ot.id_tam WHERE ot.id_op=? ORDER BY t.ordem`
  ).bind(id).all();

  await audit(c.env.DB, 'FICHA', 'GERAR', `OP=${op.num_op}`);
  return c.json(
    ok({
      op: {
        id_op: op.id_op, num_op: op.num_op, dt_emissao: op.dt_emissao,
        cod_ref: op.cod_ref, desc_ref: op.desc_ref,
        nome_cliente: op.nome_cliente, qtde_pecas: op.qtde_pecas,
        dt_entrega: op.dt_entrega, observacao: op.observacao,
      },
      cores: cores.results, tamanhos: tams.results,
      linhas, pacote,
      totais: { tempo_total_ref: tempoTotal, total_min_op: totalMinOP },
    })
  );
});

/* ===================== APONTAMENTO ===================== */
app.get('/apontamentos', async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const binds: any[] = [];
  if (q.id_op) { where.push('ap.id_op=?'); binds.push(toInt(q.id_op)); }
  if (q.de) { where.push('date(ap.data)>=date(?)'); binds.push(q.de); }
  if (q.ate) { where.push('date(ap.data)<=date(?)'); binds.push(q.ate); }
  if (q.operador) { where.push('ap.operador LIKE ?'); binds.push(`%${q.operador}%`); }

  const sql = `
    SELECT ap.*,
       op.num_op,
       si.sequencia, o.cod_op, o.desc_op
    FROM apontamento ap
    JOIN op_cab op ON op.id_op=ap.id_op
    JOIN seq_itens si ON si.id_seq_item=ap.id_seq_item
    JOIN operacoes o ON o.id_op=si.id_op
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ap.data DESC, ap.id_apont DESC
    LIMIT 200`;
  const rs = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(ok(rs.results));
});

app.post('/apontamentos', async (c) => {
  const b = await c.req.json();
  if (!b.data) return fail('Data obrigatória.');
  const idOp = toInt(b.id_op);
  const seq = toInt(b.sequencia);
  if (!idOp) return fail('OP obrigatória.');
  if (!seq) return fail('Sequência obrigatória.');
  if (!b.operador) return fail('Operador obrigatório.');
  const qB = toInt(b.qtd_boa);
  const qR = toInt(b.qtd_refugo);
  const hrs = toNum(b.horas_trab);
  if (qB < 0) return fail('Qtde Boa inválida.');
  if (qR < 0) return fail('Refugo inválido.');
  if (hrs <= 0) return fail('Horas trabalhadas deve ser > 0.');

  // Busca seq_item pela sequência dentro da versão ativa da OP
  const op = await c.env.DB.prepare(`SELECT id_seq_cab, num_op FROM op_cab WHERE id_op=?`).bind(idOp).first<any>();
  if (!op) return fail('OP não encontrada.', 404);
  const it = await c.env.DB.prepare(
    `SELECT id_seq_item, tempo_padrao FROM seq_itens WHERE id_seq_cab=? AND sequencia=?`
  ).bind(op.id_seq_cab, seq).first<any>();
  if (!it) return fail(`Sequência ${seq} não existe na versão ativa da OP.`);

  const minTotais = hrs * 60;
  const efic = minTotais > 0 ? (qB * toNum(it.tempo_padrao)) / minTotais : 0;

  const r = await c.env.DB.prepare(
    `INSERT INTO apontamento (data, id_op, id_seq_item, operador, qtd_boa, qtd_refugo, horas_trab, efic_real, criado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    b.data, idOp, toInt(it.id_seq_item),
    String(b.operador), qB, qR, hrs, efic, b.usuario || 'sistema'
  ).run();

  await audit(c.env.DB, 'APONT', 'INS', `OP=${op.num_op}/Seq=${seq}`, 'qtd_boa', '', qB);
  return c.json(ok({ id_apont: r.meta.last_row_id, efic_real: efic }));
});

app.delete('/apontamentos/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare(`DELETE FROM apontamento WHERE id_apont=?`).bind(id).run();
  await audit(c.env.DB, 'APONT', 'DEL', `Apont=${id}`);
  return c.json(ok({ id_apont: id }));
});

/* ===================== DASHBOARD ===================== */
app.get('/dashboard', async (c) => {
  const q = c.req.query();
  const mesIni = q.mes_ini || new Date().toISOString().slice(0, 7) + '-01';
  const mesFim = q.mes_fim || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
    .toISOString().slice(0, 10);

  // OPs abertas (não concluídas/canceladas)
  const abertas = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c FROM op_cab WHERE status NOT IN ('Concluida','Cancelada')`
  ).first<{ c: number }>();

  // OPs atrasadas
  const atrasadas = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c FROM op_cab
     WHERE status NOT IN ('Concluida','Cancelada') AND date(dt_entrega) < date('now')`
  ).first<{ c: number }>();

  // Peças em aberto
  const pecas = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(qtde_pecas),0) AS s FROM op_cab
     WHERE status NOT IN ('Concluida','Cancelada')`
  ).first<{ s: number }>();

  // Minutos em aberto
  const minutos = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(op.qtde_pecas * tt.tt),0) AS s
     FROM op_cab op
     JOIN (
       SELECT id_seq_cab, SUM(tempo_padrao) AS tt FROM seq_itens GROUP BY id_seq_cab
     ) tt ON tt.id_seq_cab=op.id_seq_cab
     WHERE op.status NOT IN ('Concluida','Cancelada')`
  ).first<{ s: number }>();

  // Prazo médio (dias)
  const prazo = await c.env.DB.prepare(
    `SELECT COALESCE(AVG(julianday(dt_entrega) - julianday('now')), 0) AS m FROM op_cab
     WHERE status NOT IN ('Concluida','Cancelada')`
  ).first<{ m: number }>();

  // Produção boa do mês
  const prodMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(qtd_boa),0) AS s, COALESCE(SUM(qtd_refugo),0) AS r
     FROM apontamento WHERE date(data) >= date(?) AND date(data) < date(?)`
  ).bind(mesIni, mesFim).first<{ s: number; r: number }>();

  // Eficiência real global do mês
  const efic = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(ap.qtd_boa * si.tempo_padrao), 0) AS num,
       COALESCE(SUM(ap.horas_trab * 60), 0) AS den
     FROM apontamento ap
     JOIN seq_itens si ON si.id_seq_item=ap.id_seq_item
     WHERE date(ap.data) >= date(?) AND date(ap.data) < date(?)`
  ).bind(mesIni, mesFim).first<{ num: number; den: number }>();

  const eficReal = toNum(efic?.den, 0) > 0 ? toNum(efic?.num, 0) / toNum(efic?.den, 0) : 0;

  // Carga por cliente
  const cargaCli = await c.env.DB.prepare(
    `SELECT c.nome_cliente, COUNT(*) AS qtd_ops, COALESCE(SUM(op.qtde_pecas),0) AS pecas
     FROM op_cab op JOIN clientes c ON c.id_cliente=op.id_cliente
     WHERE op.status NOT IN ('Concluida','Cancelada')
     GROUP BY c.nome_cliente ORDER BY pecas DESC LIMIT 10`
  ).all();

  // Carga por referência
  const cargaRef = await c.env.DB.prepare(
    `SELECT r.cod_ref, r.desc_ref, COUNT(*) AS qtd_ops, COALESCE(SUM(op.qtde_pecas),0) AS pecas
     FROM op_cab op JOIN referencias r ON r.id_ref=op.id_ref
     WHERE op.status NOT IN ('Concluida','Cancelada')
     GROUP BY r.id_ref ORDER BY pecas DESC LIMIT 10`
  ).all();

  // OPs por status
  const statusBreak = await c.env.DB.prepare(
    `SELECT status, COUNT(*) AS c FROM op_cab GROUP BY status`
  ).all();

  const prodBoa = toNum(prodMes?.s, 0);
  const prodRef = toNum(prodMes?.r, 0);
  const refPct = (prodBoa + prodRef) > 0 ? prodRef / (prodBoa + prodRef) : 0;

  return c.json(
    ok({
      ops_abertas: toInt(abertas?.c, 0),
      ops_atrasadas: toInt(atrasadas?.c, 0),
      pecas_aberto: toInt(pecas?.s, 0),
      minutos_aberto: Math.round(toNum(minutos?.s, 0)),
      prazo_medio_dias: toNum(prazo?.m, 0),
      producao_boa_mes: prodBoa,
      refugo_mes: prodRef,
      refugo_pct: refPct,
      eficiencia_real: eficReal,
      carga_clientes: cargaCli.results,
      carga_refs: cargaRef.results,
      status_breakdown: statusBreak.results,
      periodo: { mes_ini: mesIni, mes_fim: mesFim },
    })
  );
});

/* ===================== AUDITORIA ===================== */
app.get('/auditoria', async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const binds: any[] = [];
  if (q.modulo) { where.push('modulo=?'); binds.push(q.modulo); }
  if (q.de) { where.push('date(dt_hora)>=date(?)'); binds.push(q.de); }
  if (q.ate) { where.push('date(dt_hora)<=date(?)'); binds.push(q.ate); }
  if (q.search) { where.push('(chave_registro LIKE ? OR usuario LIKE ? OR acao LIKE ?)'); binds.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }

  const sql = `SELECT * FROM auditoria ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id_audit DESC LIMIT 500`;
  const rs = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(ok(rs.results));
});

export default app;
