// =====================================================================
// MES — Manufacturing Execution System
// Endpoints: setores, colaboradores, sessões de apontamento (timer),
// defeitos, bonificação automática, rastreabilidade, alertas
// =====================================================================
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, toNum, getUser } from '../lib/db';

const app = new Hono<{ Bindings: Bindings }>();

/* ============================================================
 * SETORES
 * ============================================================ */
app.get('/setores', async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT * FROM setores ORDER BY desc_setor`
  ).all();
  return c.json(ok(rs.results));
});

app.post('/setores', async (c) => {
  const b = await c.req.json();
  if (!b.cod_setor || !b.desc_setor) return fail('Código e descrição são obrigatórios.');
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO setores (cod_setor, desc_setor, cor, ativo) VALUES (?, ?, ?, ?)`
    ).bind(b.cod_setor, b.desc_setor, b.cor || '#2563EB', b.ativo ? 1 : 1).run();
    await audit(c.env.DB, 'MES', 'INS_SETOR', String(r.meta.last_row_id), '', '', b.cod_setor, getUser(c)?.login || '');
    return c.json(ok({ id_setor: r.meta.last_row_id }));
  } catch (e: any) {
    return fail('Erro ao criar setor: ' + e.message);
  }
});

app.put('/setores/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE setores SET cod_setor=?, desc_setor=?, cor=?, ativo=? WHERE id_setor=?`
  ).bind(b.cod_setor, b.desc_setor, b.cor || '#2563EB', b.ativo ? 1 : 0, id).run();
  await audit(c.env.DB, 'MES', 'UPD_SETOR', String(id), '', '', '', getUser(c)?.login || '');
  return c.json(ok({ id_setor: id }));
});

app.delete('/setores/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare(`DELETE FROM setores WHERE id_setor=?`).bind(id).run();
  await audit(c.env.DB, 'MES', 'DEL_SETOR', String(id), '', '', '', getUser(c)?.login || '');
  return c.json(ok({ id_setor: id }));
});

/* ============================================================
 * COLABORADORES
 * ============================================================ */
app.get('/colaboradores', async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const params: any[] = [];
  if (q.ativo !== undefined) { where.push('co.ativo=?'); params.push(toInt(q.ativo)); }
  if (q.id_setor)            { where.push('co.id_setor=?'); params.push(toInt(q.id_setor)); }
  const sql = `
    SELECT co.*, s.desc_setor, s.cor AS setor_cor
    FROM colaboradores co
    LEFT JOIN setores s ON s.id_setor=co.id_setor
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY co.nome
  `;
  const rs = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(ok(rs.results));
});

app.get('/colaboradores/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const colab = await c.env.DB.prepare(
    `SELECT co.*, s.desc_setor, s.cor AS setor_cor
     FROM colaboradores co
     LEFT JOIN setores s ON s.id_setor=co.id_setor
     WHERE co.id_colab=?`
  ).bind(id).first<any>();
  if (!colab) return fail('Colaborador não encontrado.', 404);

  // Histórico de produção (30 dias)
  const hist = await c.env.DB.prepare(
    `SELECT date(dt_inicio) AS dia,
            SUM(qtd_boa) AS pecas,
            SUM(qtd_refugo) AS refugo,
            ROUND(SUM(julianday(COALESCE(dt_fim,'now')) - julianday(dt_inicio)) * 24 - SUM(segundos_pausa)/3600.0, 2) AS horas,
            AVG(efic_real) AS efic
     FROM apontamento_sessao
     WHERE id_colab=? AND status='Finalizada' AND dt_inicio >= datetime('now','-30 day')
     GROUP BY date(dt_inicio)
     ORDER BY dia DESC`
  ).bind(id).all();

  // Totais do mês corrente
  const ano = new Date().getFullYear();
  const mes = new Date().getMonth() + 1;
  const tot = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(qtd_boa),0) AS pecas,
            COALESCE(SUM(qtd_refugo),0) AS refugo,
            COALESCE(AVG(efic_real),0) AS efic
     FROM apontamento_sessao
     WHERE id_colab=? AND status='Finalizada'
       AND strftime('%Y',dt_inicio)=? AND strftime('%m',dt_inicio)=?`
  ).bind(id, String(ano), String(mes).padStart(2, '0')).first<any>();

  return c.json(ok({ colaborador: colab, historico: hist.results, mes_atual: tot }));
});

app.post('/colaboradores', async (c) => {
  const b = await c.req.json();
  if (!b.matricula || !b.nome) return fail('Matrícula e Nome são obrigatórios.');
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO colaboradores
        (matricula, nome, funcao, id_setor, meta_diaria, meta_eficiencia, custo_minuto, bonus_base, ativo, dt_admissao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      b.matricula, b.nome, b.funcao || null,
      b.id_setor ? toInt(b.id_setor) : null,
      toInt(b.meta_diaria, 0),
      toNum(b.meta_eficiencia, 0.85),
      toNum(b.custo_minuto, 0),
      toNum(b.bonus_base, 0),
      b.ativo === 0 ? 0 : 1,
      b.dt_admissao || null
    ).run();
    await audit(c.env.DB, 'MES', 'INS_COLAB', String(r.meta.last_row_id), '', '', b.matricula, getUser(c)?.login || '');
    return c.json(ok({ id_colab: r.meta.last_row_id }));
  } catch (e: any) {
    return fail('Erro ao criar colaborador: ' + e.message);
  }
});

app.put('/colaboradores/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE colaboradores
       SET matricula=?, nome=?, funcao=?, id_setor=?, meta_diaria=?, meta_eficiencia=?,
           custo_minuto=?, bonus_base=?, ativo=?, dt_admissao=?
     WHERE id_colab=?`
  ).bind(
    b.matricula, b.nome, b.funcao || null,
    b.id_setor ? toInt(b.id_setor) : null,
    toInt(b.meta_diaria, 0),
    toNum(b.meta_eficiencia, 0.85),
    toNum(b.custo_minuto, 0),
    toNum(b.bonus_base, 0),
    b.ativo === 0 ? 0 : 1,
    b.dt_admissao || null,
    id
  ).run();
  await audit(c.env.DB, 'MES', 'UPD_COLAB', String(id), '', '', '', getUser(c)?.login || '');
  return c.json(ok({ id_colab: id }));
});

app.delete('/colaboradores/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  // Soft delete (mantém histórico)
  await c.env.DB.prepare(`UPDATE colaboradores SET ativo=0 WHERE id_colab=?`).bind(id).run();
  await audit(c.env.DB, 'MES', 'INATIVAR_COLAB', String(id), '', '', '', getUser(c)?.login || '');
  return c.json(ok({ id_colab: id }));
});

/* ============================================================
 * APONTAMENTO COM TIMER (sessões: start / pause / resume / finish)
 * ============================================================ */

// Lista sessões ativas (em andamento ou pausadas) — para o painel "Em Operação"
app.get('/sessoes/ativas', async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT s.*,
            op.num_op, r.cod_ref, r.desc_ref, c.nome_cliente,
            si.sequencia, op2.cod_op, op2.desc_op, op2.id_maquina,
            co.nome AS colab_nome, co.id_setor, set_.desc_setor, set_.cor AS setor_cor,
            si.tempo_padrao
     FROM apontamento_sessao s
     JOIN op_cab op ON op.id_op=s.id_op
     JOIN referencias r ON r.id_ref=op.id_ref
     JOIN clientes c ON c.id_cliente=op.id_cliente
     JOIN seq_itens si ON si.id_seq_item=s.id_seq_item
     JOIN operacoes op2 ON op2.id_op=si.id_op
     LEFT JOIN colaboradores co ON co.id_colab=s.id_colab
     LEFT JOIN setores set_ ON set_.id_setor=co.id_setor
     WHERE s.status IN ('EmAndamento','Pausada')
     ORDER BY s.dt_inicio DESC`
  ).all();
  return c.json(ok(rs.results));
});

// Lista sessões finalizadas (com filtros)
app.get('/sessoes', async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const params: any[] = [];
  if (q.id_op)    { where.push('s.id_op=?');    params.push(toInt(q.id_op)); }
  if (q.id_colab) { where.push('s.id_colab=?'); params.push(toInt(q.id_colab)); }
  if (q.status)   { where.push('s.status=?');   params.push(q.status); }
  if (q.dt_ini)   { where.push('date(s.dt_inicio)>=date(?)'); params.push(q.dt_ini); }
  if (q.dt_fim)   { where.push('date(s.dt_inicio)<=date(?)'); params.push(q.dt_fim); }

  const rs = await c.env.DB.prepare(
    `SELECT s.*,
            op.num_op, r.cod_ref, r.desc_ref,
            si.sequencia, op2.desc_op,
            co.nome AS colab_nome, set_.desc_setor
     FROM apontamento_sessao s
     JOIN op_cab op ON op.id_op=s.id_op
     JOIN referencias r ON r.id_ref=op.id_ref
     JOIN seq_itens si ON si.id_seq_item=s.id_seq_item
     JOIN operacoes op2 ON op2.id_op=si.id_op
     LEFT JOIN colaboradores co ON co.id_colab=s.id_colab
     LEFT JOIN setores set_ ON set_.id_setor=co.id_setor
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY s.dt_inicio DESC
     LIMIT 300`
  ).bind(...params).all();
  return c.json(ok(rs.results));
});

// Inicia sessão
app.post('/sessoes/start', async (c) => {
  const b = await c.req.json();
  if (!b.id_op || !b.id_seq_item) return fail('id_op e id_seq_item são obrigatórios.');

  // Resolve nome do operador a partir do colab (se informado)
  let nomeOper = b.operador_nome || '';
  if (b.id_colab) {
    const co = await c.env.DB.prepare(`SELECT nome FROM colaboradores WHERE id_colab=?`).bind(toInt(b.id_colab)).first<any>();
    if (co) nomeOper = co.nome;
  }
  if (!nomeOper) return fail('Operador é obrigatório.');

  // Bloqueia se houver sessão aberta para o mesmo colab
  if (b.id_colab) {
    const aberta = await c.env.DB.prepare(
      `SELECT id_sessao FROM apontamento_sessao
       WHERE id_colab=? AND status IN ('EmAndamento','Pausada') LIMIT 1`
    ).bind(toInt(b.id_colab)).first<any>();
    if (aberta) return fail('Este colaborador já tem uma sessão ativa. Finalize antes.', 409);
  }

  const r = await c.env.DB.prepare(
    `INSERT INTO apontamento_sessao
       (id_op, id_seq_item, id_colab, operador_nome, status, dt_inicio, criado_por)
     VALUES (?, ?, ?, ?, 'EmAndamento', datetime('now'), ?)`
  ).bind(
    toInt(b.id_op), toInt(b.id_seq_item),
    b.id_colab ? toInt(b.id_colab) : null,
    nomeOper, getUser(c)?.login || ''
  ).run();

  // Atualiza status da OP para "EmProducao" se ainda não está
  await c.env.DB.prepare(
    `UPDATE op_cab SET status='EmProducao', dt_alteracao=datetime('now')
     WHERE id_op=? AND status IN ('Aberta','Planejada','Pausada')`
  ).bind(toInt(b.id_op)).run();

  await audit(c.env.DB, 'MES', 'START_SESSAO', String(r.meta.last_row_id), '', '', nomeOper, getUser(c)?.login || '');
  return c.json(ok({ id_sessao: r.meta.last_row_id }));
});

// Pausa sessão
app.post('/sessoes/:id/pause', async (c) => {
  const id = toInt(c.req.param('id'));
  const s = await c.env.DB.prepare(`SELECT * FROM apontamento_sessao WHERE id_sessao=?`).bind(id).first<any>();
  if (!s) return fail('Sessão não encontrada.', 404);
  if (s.status !== 'EmAndamento') return fail('Só é possível pausar sessão em andamento.');

  await c.env.DB.prepare(
    `UPDATE apontamento_sessao SET status='Pausada', dt_pausa=datetime('now') WHERE id_sessao=?`
  ).bind(id).run();
  await audit(c.env.DB, 'MES', 'PAUSE_SESSAO', String(id), '', '', '', getUser(c)?.login || '');
  return c.json(ok({ id_sessao: id }));
});

// Retoma sessão (acumula segundos de pausa)
app.post('/sessoes/:id/resume', async (c) => {
  const id = toInt(c.req.param('id'));
  const s = await c.env.DB.prepare(`SELECT * FROM apontamento_sessao WHERE id_sessao=?`).bind(id).first<any>();
  if (!s) return fail('Sessão não encontrada.', 404);
  if (s.status !== 'Pausada') return fail('Sessão não está pausada.');

  // Calcula segundos da pausa atual
  const segs = await c.env.DB.prepare(
    `SELECT CAST((julianday('now') - julianday(?)) * 86400 AS INTEGER) AS s`
  ).bind(s.dt_pausa).first<{ s: number }>();

  await c.env.DB.prepare(
    `UPDATE apontamento_sessao
     SET status='EmAndamento', dt_pausa=NULL, segundos_pausa=segundos_pausa+?
     WHERE id_sessao=?`
  ).bind(toInt(segs?.s, 0), id).run();
  await audit(c.env.DB, 'MES', 'RESUME_SESSAO', String(id), '', '', '', getUser(c)?.login || '');
  return c.json(ok({ id_sessao: id, segundos_pausa: toInt(segs?.s, 0) }));
});

// Finaliza sessão (registra qtd_boa, refugo, retrabalho e cria registro consolidado em apontamento)
app.post('/sessoes/:id/finish', async (c) => {
  const id = toInt(c.req.param('id'));
  const b = await c.req.json();
  const s = await c.env.DB.prepare(`SELECT * FROM apontamento_sessao WHERE id_sessao=?`).bind(id).first<any>();
  if (!s) return fail('Sessão não encontrada.', 404);
  if (s.status === 'Finalizada' || s.status === 'Cancelada') return fail('Sessão já encerrada.');

  // Se estava pausada, fecha pausa
  let segPausaExtra = 0;
  if (s.status === 'Pausada' && s.dt_pausa) {
    const segs = await c.env.DB.prepare(
      `SELECT CAST((julianday('now') - julianday(?)) * 86400 AS INTEGER) AS s`
    ).bind(s.dt_pausa).first<{ s: number }>();
    segPausaExtra = toInt(segs?.s, 0);
  }

  // Tempo trabalhado = (fim - início) - pausas
  const tempoTotal = await c.env.DB.prepare(
    `SELECT CAST((julianday('now') - julianday(?)) * 86400 AS INTEGER) AS s`
  ).bind(s.dt_inicio).first<{ s: number }>();
  const segPausa = toInt(s.segundos_pausa, 0) + segPausaExtra;
  const segTrab = Math.max(1, toInt(tempoTotal?.s, 0) - segPausa);
  const horas = segTrab / 3600;

  const qtdBoa     = toInt(b.qtd_boa, 0);
  const qtdRefugo  = toInt(b.qtd_refugo, 0);
  const qtdRetrab  = toInt(b.qtd_retrabalho, 0);

  // Tempo padrão (min) da operação
  const seq = await c.env.DB.prepare(`SELECT tempo_padrao FROM seq_itens WHERE id_seq_item=?`).bind(s.id_seq_item).first<any>();
  const tempoPadrao = toNum(seq?.tempo_padrao, 0); // min/peça
  const eficReal = horas * 60 > 0 ? (qtdBoa * tempoPadrao) / (horas * 60) : 0;

  // Atualiza sessão
  await c.env.DB.prepare(
    `UPDATE apontamento_sessao
       SET status='Finalizada', dt_fim=datetime('now'),
           segundos_pausa=?, qtd_boa=?, qtd_refugo=?, qtd_retrabalho=?, efic_real=?, obs=?, dt_pausa=NULL
     WHERE id_sessao=?`
  ).bind(segPausa, qtdBoa, qtdRefugo, qtdRetrab, eficReal, b.obs || null, id).run();

  // Cria registro consolidado em apontamento (compatibilidade com módulos antigos)
  await c.env.DB.prepare(
    `INSERT INTO apontamento
       (data, id_op, id_seq_item, operador, qtd_boa, qtd_refugo, qtd_retrabalho, horas_trab, efic_real, id_colab, criado_por)
     VALUES (date('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    s.id_op, s.id_seq_item, s.operador_nome,
    qtdBoa, qtdRefugo, qtdRetrab,
    horas, eficReal, s.id_colab, getUser(c)?.login || ''
  ).run();

  // Registra defeitos detalhados (se vierem)
  if (Array.isArray(b.defeitos)) {
    for (const d of b.defeitos) {
      if (toInt(d.id_defeito) && toInt(d.qtde) > 0) {
        await c.env.DB.prepare(
          `INSERT INTO defeitos_registro (id_sessao, id_defeito, qtde) VALUES (?, ?, ?)`
        ).bind(id, toInt(d.id_defeito), toInt(d.qtde)).run();
      }
    }
  }

  await audit(c.env.DB, 'MES', 'FINISH_SESSAO', String(id), '', '', `boa=${qtdBoa} ref=${qtdRefugo}`, getUser(c)?.login || '');
  return c.json(ok({ id_sessao: id, horas, efic_real: eficReal }));
});

// Cancela sessão
app.post('/sessoes/:id/cancel', async (c) => {
  const id = toInt(c.req.param('id'));
  await c.env.DB.prepare(
    `UPDATE apontamento_sessao SET status='Cancelada', dt_fim=datetime('now') WHERE id_sessao=?`
  ).bind(id).run();
  await audit(c.env.DB, 'MES', 'CANCEL_SESSAO', String(id), '', '', '', getUser(c)?.login || '');
  return c.json(ok({ id_sessao: id }));
});

/* ============================================================
 * TIPOS DE DEFEITO
 * ============================================================ */
app.get('/defeitos/tipos', async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT * FROM tipos_defeito WHERE ativo=1 ORDER BY descricao`
  ).all();
  return c.json(ok(rs.results));
});

app.get('/defeitos/analise', async (c) => {
  const q = c.req.query();
  const dtIni = q.dt_ini || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10);
  const dtFim = q.dt_fim || new Date().toISOString().slice(0, 10);

  // Defeitos por tipo
  const porTipo = await c.env.DB.prepare(
    `SELECT td.cod_defeito, td.descricao, td.gravidade,
            COALESCE(SUM(dr.qtde),0) AS total
     FROM tipos_defeito td
     LEFT JOIN defeitos_registro dr ON dr.id_defeito=td.id_defeito
     LEFT JOIN apontamento_sessao s ON s.id_sessao=dr.id_sessao
     WHERE td.ativo=1
       AND (dr.id_reg IS NULL OR date(s.dt_inicio) BETWEEN date(?) AND date(?))
     GROUP BY td.id_defeito
     HAVING total > 0
     ORDER BY total DESC`
  ).bind(dtIni, dtFim).all();

  // Defeitos por operação (gargalos de qualidade)
  const porOper = await c.env.DB.prepare(
    `SELECT op2.cod_op, op2.desc_op, COALESCE(SUM(dr.qtde),0) AS total
     FROM defeitos_registro dr
     JOIN apontamento_sessao s ON s.id_sessao=dr.id_sessao
     JOIN seq_itens si ON si.id_seq_item=s.id_seq_item
     JOIN operacoes op2 ON op2.id_op=si.id_op
     WHERE date(s.dt_inicio) BETWEEN date(?) AND date(?)
     GROUP BY op2.id_op
     ORDER BY total DESC
     LIMIT 10`
  ).bind(dtIni, dtFim).all();

  return c.json(ok({ por_tipo: porTipo.results, por_operacao: porOper.results, dt_ini: dtIni, dt_fim: dtFim }));
});

/* ============================================================
 * BONIFICAÇÃO MENSAL — calcula automaticamente
 * ============================================================ */
app.post('/bonificacao/calcular', async (c) => {
  const b = await c.req.json();
  const ano = toInt(b.ano, new Date().getFullYear());
  const mes = toInt(b.mes, new Date().getMonth() + 1);
  const mesStr = String(mes).padStart(2, '0');

  // Métricas por colaborador
  const metr = await c.env.DB.prepare(
    `SELECT co.id_colab, co.nome, co.meta_diaria, co.meta_eficiencia, co.bonus_base,
            COALESCE(SUM(s.qtd_boa),0) AS pecas,
            COALESCE(SUM(
              (julianday(COALESCE(s.dt_fim,s.dt_inicio)) - julianday(s.dt_inicio))*24
              - s.segundos_pausa/3600.0
            ),0) AS horas,
            COALESCE(AVG(s.efic_real),0) AS efic
     FROM colaboradores co
     LEFT JOIN apontamento_sessao s
            ON s.id_colab=co.id_colab AND s.status='Finalizada'
           AND strftime('%Y',s.dt_inicio)=? AND strftime('%m',s.dt_inicio)=?
     WHERE co.ativo=1
     GROUP BY co.id_colab
     ORDER BY efic DESC, pecas DESC`
  ).bind(String(ano), mesStr).all<any>();

  const lista = (metr.results || []).map((r: any, idx: number) => {
    const efic = toNum(r.efic, 0);
    const meta = toNum(r.meta_eficiencia, 0.85);
    const metaAtingida = efic >= meta ? 1 : 0;
    // Fórmula: bonus_base * (efic/meta), saturado em 1.5x se atingiu meta; 0 caso contrário
    let bonus = 0;
    if (metaAtingida) {
      bonus = toNum(r.bonus_base, 0) * Math.min(1.5, efic / meta);
    } else if (efic >= meta * 0.9) {
      // Bônus parcial 50% se ficou perto da meta (>=90% da meta)
      bonus = toNum(r.bonus_base, 0) * 0.5;
    }
    return {
      id_colab: r.id_colab,
      nome: r.nome,
      pecas: toInt(r.pecas, 0),
      horas: toNum(r.horas, 0),
      efic_media: efic,
      meta_atingida: metaAtingida,
      bonus_calc: Math.round(bonus * 100) / 100,
      ranking: idx + 1,
    };
  });

  // Persiste
  for (const it of lista) {
    await c.env.DB.prepare(
      `INSERT INTO bonificacao_mes
         (id_colab, ano, mes, pecas_total, horas_total, efic_media, meta_atingida, bonus_calc, ranking, dt_calculo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id_colab, ano, mes) DO UPDATE SET
         pecas_total=excluded.pecas_total,
         horas_total=excluded.horas_total,
         efic_media=excluded.efic_media,
         meta_atingida=excluded.meta_atingida,
         bonus_calc=excluded.bonus_calc,
         ranking=excluded.ranking,
         dt_calculo=excluded.dt_calculo`
    ).bind(
      it.id_colab, ano, mes,
      it.pecas, it.horas, it.efic_media,
      it.meta_atingida, it.bonus_calc, it.ranking
    ).run();
  }

  await audit(c.env.DB, 'MES', 'CALC_BONUS', `${ano}-${mesStr}`, '', '', String(lista.length), getUser(c)?.login || '');
  return c.json(ok({ ano, mes, total_colab: lista.length, ranking: lista }));
});

app.get('/bonificacao', async (c) => {
  const q = c.req.query();
  const ano = toInt(q.ano, new Date().getFullYear());
  const mes = toInt(q.mes, new Date().getMonth() + 1);
  const rs = await c.env.DB.prepare(
    `SELECT b.*, co.matricula, co.nome, s.desc_setor
     FROM bonificacao_mes b
     JOIN colaboradores co ON co.id_colab=b.id_colab
     LEFT JOIN setores s ON s.id_setor=co.id_setor
     WHERE b.ano=? AND b.mes=?
     ORDER BY b.ranking ASC`
  ).bind(ano, mes).all();
  return c.json(ok({ ano, mes, lista: rs.results }));
});

/* ============================================================
 * RASTREABILIDADE — Produto → OP → Operações → Colaboradores → Defeitos
 * ============================================================ */
app.get('/rastreabilidade/op/:id', async (c) => {
  const id = toInt(c.req.param('id'));
  const op = await c.env.DB.prepare(
    `SELECT op.*, r.cod_ref, r.desc_ref, c.nome_cliente, sc.versao AS seq_versao
     FROM op_cab op
     JOIN referencias r ON r.id_ref=op.id_ref
     JOIN clientes c ON c.id_cliente=op.id_cliente
     JOIN seq_cab sc ON sc.id_seq_cab=op.id_seq_cab
     WHERE op.id_op=?`
  ).bind(id).first<any>();
  if (!op) return fail('OP não encontrada.', 404);

  const operacoes = await c.env.DB.prepare(
    `SELECT si.id_seq_item, si.sequencia, si.tempo_padrao,
            o.cod_op, o.desc_op,
            COALESCE(SUM(s.qtd_boa),0)        AS pecas_produzidas,
            COALESCE(SUM(s.qtd_refugo),0)     AS pecas_refugo,
            COALESCE(SUM(s.qtd_retrabalho),0) AS pecas_retrabalho,
            COUNT(DISTINCT s.id_colab)        AS qtd_colaboradores,
            COALESCE(AVG(s.efic_real),0)      AS efic_media
     FROM seq_itens si
     JOIN operacoes o ON o.id_op=si.id_op
     LEFT JOIN apontamento_sessao s ON s.id_seq_item=si.id_seq_item AND s.id_op=? AND s.status='Finalizada'
     WHERE si.id_seq_cab=?
     GROUP BY si.id_seq_item
     ORDER BY si.sequencia`
  ).bind(id, op.id_seq_cab).all();

  const colabs = await c.env.DB.prepare(
    `SELECT s.operador_nome, set_.desc_setor,
            COALESCE(SUM(s.qtd_boa),0) AS pecas,
            COALESCE(AVG(s.efic_real),0) AS efic,
            COUNT(*) AS sessoes
     FROM apontamento_sessao s
     LEFT JOIN colaboradores co ON co.id_colab=s.id_colab
     LEFT JOIN setores set_ ON set_.id_setor=co.id_setor
     WHERE s.id_op=? AND s.status='Finalizada'
     GROUP BY s.operador_nome
     ORDER BY pecas DESC`
  ).bind(id).all();

  const defeitos = await c.env.DB.prepare(
    `SELECT td.descricao, td.gravidade, COALESCE(SUM(dr.qtde),0) AS qtde
     FROM defeitos_registro dr
     JOIN tipos_defeito td ON td.id_defeito=dr.id_defeito
     JOIN apontamento_sessao s ON s.id_sessao=dr.id_sessao
     WHERE s.id_op=?
     GROUP BY td.id_defeito
     ORDER BY qtde DESC`
  ).bind(id).all();

  return c.json(ok({
    op,
    operacoes: operacoes.results,
    colaboradores: colabs.results,
    defeitos: defeitos.results,
  }));
});

/* ============================================================
 * DASHBOARD MES AVANÇADO — produção diária, eficiência por setor,
 * ranking, defeitos
 * ============================================================ */
app.get('/dashboard/mes-pro', async (c) => {
  const q = c.req.query();
  const dias = toInt(q.dias, 14);
  const dia = q.dia || new Date().toISOString().slice(0, 10);

  // Produção dos últimos N dias (linha)
  const prodLinha = await c.env.DB.prepare(
    `SELECT date(dt_inicio) AS dia,
            COALESCE(SUM(qtd_boa),0) AS pecas,
            COALESCE(SUM(qtd_refugo),0) AS refugo
     FROM apontamento_sessao
     WHERE status='Finalizada' AND date(dt_inicio) >= date(?, '-' || ? || ' day')
     GROUP BY date(dt_inicio)
     ORDER BY dia ASC`
  ).bind(dia, dias).all();

  // Eficiência por setor (barras)
  const eficSetor = await c.env.DB.prepare(
    `SELECT set_.desc_setor, set_.cor,
            COALESCE(AVG(s.efic_real),0) AS efic,
            COALESCE(SUM(s.qtd_boa),0) AS pecas,
            COALESCE(SUM(s.qtd_refugo),0) AS refugo
     FROM setores set_
     LEFT JOIN colaboradores co ON co.id_setor=set_.id_setor
     LEFT JOIN apontamento_sessao s ON s.id_colab=co.id_colab AND s.status='Finalizada'
                                    AND date(s.dt_inicio) >= date(?,'-' || ? || ' day')
     WHERE set_.ativo=1
     GROUP BY set_.id_setor
     ORDER BY efic DESC`
  ).bind(dia, dias).all();

  // Ranking colaboradores (TOP 10)
  const ranking = await c.env.DB.prepare(
    `SELECT co.nome, set_.desc_setor,
            COALESCE(SUM(s.qtd_boa),0) AS pecas,
            COALESCE(AVG(s.efic_real),0) AS efic,
            co.meta_diaria
     FROM colaboradores co
     LEFT JOIN setores set_ ON set_.id_setor=co.id_setor
     LEFT JOIN apontamento_sessao s ON s.id_colab=co.id_colab AND s.status='Finalizada'
                                    AND date(s.dt_inicio) >= date(?,'-' || ? || ' day')
     WHERE co.ativo=1
     GROUP BY co.id_colab
     HAVING pecas > 0
     ORDER BY efic DESC, pecas DESC
     LIMIT 10`
  ).bind(dia, dias).all();

  // Eficiência geral (donut: ótimo / médio / baixo)
  const eficGeral = await c.env.DB.prepare(
    `SELECT
        SUM(CASE WHEN efic_real >= 0.85 THEN 1 ELSE 0 END) AS otimo,
        SUM(CASE WHEN efic_real >= 0.70 AND efic_real < 0.85 THEN 1 ELSE 0 END) AS medio,
        SUM(CASE WHEN efic_real < 0.70 THEN 1 ELSE 0 END) AS baixo,
        COALESCE(AVG(efic_real),0) AS media
     FROM apontamento_sessao
     WHERE status='Finalizada' AND date(dt_inicio) >= date(?,'-' || ? || ' day')`
  ).bind(dia, dias).first<any>();

  // Sessões ativas agora
  const ativas = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='EmAndamento' THEN 1 ELSE 0 END) AS rodando,
            SUM(CASE WHEN status='Pausada' THEN 1 ELSE 0 END) AS pausadas
     FROM apontamento_sessao WHERE status IN ('EmAndamento','Pausada')`
  ).first<any>();

  return c.json(ok({
    producao_linha: prodLinha.results,
    eficiencia_setor: eficSetor.results,
    ranking_colab: ranking.results,
    eficiencia_geral: eficGeral,
    sessoes_ativas: ativas,
    dia,
    dias,
  }));
});

/* ============================================================
 * ALERTAS INTELIGENTES (centralizado para sino/notificações)
 * ============================================================ */
app.get('/alertas', async (c) => {
  const alertas: any[] = [];

  // 1) OPs atrasadas
  const atras = await c.env.DB.prepare(
    `SELECT id_op, num_op, dt_entrega FROM op_cab
     WHERE status NOT IN ('Concluida','Cancelada') AND date(dt_entrega) < date('now')
     ORDER BY dt_entrega ASC LIMIT 5`
  ).all();
  for (const r of (atras.results as any[]) || []) {
    alertas.push({
      tipo: 'danger', icon: 'fa-triangle-exclamation',
      titulo: `OP ${r.num_op} atrasada`,
      desc: `Entrega prevista para ${r.dt_entrega}`,
      acao: 'ops',
    });
  }

  // 2) Sessões pausadas há mais de 1h
  const pausLong = await c.env.DB.prepare(
    `SELECT s.id_sessao, s.operador_nome, op.num_op
     FROM apontamento_sessao s
     JOIN op_cab op ON op.id_op=s.id_op
     WHERE s.status='Pausada' AND julianday('now') - julianday(s.dt_pausa) > 1.0/24
     LIMIT 5`
  ).all();
  for (const r of (pausLong.results as any[]) || []) {
    alertas.push({
      tipo: 'warning', icon: 'fa-pause-circle',
      titulo: `Sessão pausada há +1h`,
      desc: `${r.operador_nome} — OP ${r.num_op}`,
      acao: 'apontamento',
    });
  }

  // 3) Eficiência abaixo de 60% nos últimos 3 dias
  const eficB = await c.env.DB.prepare(
    `SELECT COALESCE(AVG(efic_real),0) AS m
     FROM apontamento_sessao
     WHERE status='Finalizada' AND date(dt_inicio) >= date('now','-3 day')`
  ).first<any>();
  if (toNum(eficB?.m, 0) > 0 && toNum(eficB?.m, 0) < 0.6) {
    alertas.push({
      tipo: 'warning', icon: 'fa-gauge-low',
      titulo: 'Eficiência baixa',
      desc: `Média 3d: ${(toNum(eficB?.m, 0) * 100).toFixed(1)}%`,
      acao: 'dashboard',
    });
  }

  // 4) Refugo alto (>5%) nos últimos 7 dias
  const ref = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(qtd_boa),0) AS b, COALESCE(SUM(qtd_refugo),0) AS r
     FROM apontamento_sessao WHERE date(dt_inicio) >= date('now','-7 day')`
  ).first<any>();
  const tot = toNum(ref?.b, 0) + toNum(ref?.r, 0);
  if (tot > 0 && toNum(ref?.r, 0) / tot > 0.05) {
    alertas.push({
      tipo: 'warning', icon: 'fa-recycle',
      titulo: `Refugo alto: ${(toNum(ref?.r, 0) / tot * 100).toFixed(1)}%`,
      desc: 'Acima da meta de 5% nos últimos 7 dias',
      acao: 'dashboard',
    });
  }

  return c.json(ok({ total: alertas.length, alertas }));
});

export default app;
