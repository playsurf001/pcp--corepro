// Módulo de Relatórios Detalhados — Terceirização (CorePro)
// Endpoints agregadores otimizados para dashboards e relatórios analíticos
// [SPRINT 1] Multi-tenant: todas as queries filtram por id_empresa
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, getEmpresa } from '../lib/db';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any } }>();

/* ============================================================
 * Helpers
 * ============================================================ */
function periodo(q: any) {
  const hoje = new Date();
  const ini = q.dt_ini || new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
  const fim = q.dt_fim || new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { ini, fim };
}

/**
 * Constrói cláusula WHERE adicional para filtros opcionais.
 * SEMPRE injeta `${prefix}.id_empresa = ?` como primeiro filtro para
 * garantir isolamento multi-tenant em 100% das queries.
 */
function buildWhere(q: any, prefix: string, id_empresa: number) {
  const where: string[] = [];
  const binds: any[] = [];
  const p = prefix ? prefix + '.' : '';
  // Tenant scoping obrigatório
  where.push(`${p}id_empresa = ?`);
  binds.push(id_empresa);
  if (q.id_terc)    { where.push(`${p}id_terc = ?`);    binds.push(Number(q.id_terc)); }
  if (q.id_servico) { where.push(`${p}id_servico = ?`); binds.push(Number(q.id_servico)); }
  if (q.id_setor)   { where.push(`${p}id_setor = ?`);   binds.push(Number(q.id_setor)); } // HOTFIX 0037
  if (q.id_colecao) { where.push(`${p}id_colecao = ?`); binds.push(Number(q.id_colecao)); }
  if (q.cor)        { where.push(`UPPER(${p}cor) = UPPER(?)`); binds.push(q.cor); }
  if (q.cod_ref)    { where.push(`${p}cod_ref LIKE ?`); binds.push('%' + q.cod_ref + '%'); }
  if (q.num_op)     { where.push(`${p}num_op LIKE ?`);  binds.push('%' + q.num_op + '%'); }
  if (q.status)     { where.push(`${p}status = ?`);     binds.push(q.status); }
  return { where: ' AND ' + where.join(' AND '), binds };
}

/* ============================================================
 * 1) DASHBOARD ANALÍTICO — KPIs + séries para gráficos
 * ============================================================ */
app.get('/relatorios-det/dashboard', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const f = buildWhere(q, 'r', id_empresa);

    // KPIs principais (remessas no período)
    const kpiRem: any = await c.env.DB.prepare(
      `SELECT
        COUNT(*)                          AS qtd_remessas,
        COALESCE(SUM(r.qtd_total),0)      AS total_enviado,
        COALESCE(SUM(r.valor_total),0)    AS valor_total,
        COALESCE(SUM(r.valor_pago),0)     AS valor_pago,
        COALESCE(AVG(r.prazo_dias),0)     AS prazo_medio,
        COALESCE(AVG(r.efic_pct),0)       AS efic_media
       FROM terc_remessas r
       WHERE r.dt_saida BETWEEN ? AND ? ${f.where}`
    ).bind(ini, fim, ...f.binds).first();

    // KPIs de retornos (filtro via JOIN com r.id_empresa)
    const kpiRet: any = await c.env.DB.prepare(
      `SELECT
        COUNT(*)                            AS qtd_retornos,
        COALESCE(SUM(rt.qtd_boa),0)         AS total_retornado,
        COALESCE(SUM(rt.qtd_refugo),0)      AS total_faltas,
        COALESCE(SUM(rt.qtd_conserto),0)    AS total_consertos,
        COALESCE(SUM(rt.valor_pago),0)      AS total_pago_periodo
       FROM terc_retornos rt
       JOIN terc_remessas r ON r.id_remessa = rt.id_remessa
       WHERE rt.dt_retorno BETWEEN ? AND ? ${f.where}`
    ).bind(ini, fim, ...f.binds).first();

    // Produção por período (dia)
    const prodPeriodo = await c.env.DB.prepare(
      `SELECT
        rt.dt_retorno AS dt,
        COALESCE(SUM(rt.qtd_boa),0)      AS boa,
        COALESCE(SUM(rt.qtd_refugo),0)   AS falta,
        COALESCE(SUM(rt.qtd_conserto),0) AS conserto,
        COALESCE(SUM(rt.valor_pago),0)   AS valor
       FROM terc_retornos rt
       JOIN terc_remessas r ON r.id_remessa = rt.id_remessa
       WHERE rt.dt_retorno BETWEEN ? AND ? ${f.where}
       GROUP BY rt.dt_retorno ORDER BY rt.dt_retorno`
    ).bind(ini, fim, ...f.binds).all();

    // Pagamentos por período
    const pagPeriodo = await c.env.DB.prepare(
      `SELECT r.dt_pagamento AS dt, COALESCE(SUM(r.valor_pago),0) AS valor
       FROM terc_remessas r
       WHERE r.dt_pagamento IS NOT NULL AND r.dt_pagamento BETWEEN ? AND ? ${f.where}
       GROUP BY r.dt_pagamento ORDER BY r.dt_pagamento`
    ).bind(ini, fim, ...f.binds).all();

    // Top serviços
    const topServ = await c.env.DB.prepare(
      `SELECT s.desc_servico AS nome,
              COUNT(*)                  AS qtd_remessas,
              COALESCE(SUM(r.qtd_total),0) AS qtd,
              COALESCE(SUM(r.valor_total),0) AS valor
       FROM terc_remessas r
       LEFT JOIN terc_servicos s ON s.id_servico = r.id_servico AND s.id_empresa = r.id_empresa
       WHERE r.dt_saida BETWEEN ? AND ? ${f.where}
       GROUP BY r.id_servico ORDER BY qtd DESC LIMIT 10`
    ).bind(ini, fim, ...f.binds).all();

    // Top terceirizados
    const topTerc = await c.env.DB.prepare(
      `SELECT t.nome_terc AS nome,
              COUNT(*)                       AS qtd_remessas,
              COALESCE(SUM(r.qtd_total),0)   AS enviado,
              COALESCE(SUM(r.valor_pago),0)  AS pago
       FROM terc_remessas r
       LEFT JOIN terc_terceirizados t ON t.id_terc = r.id_terc
       WHERE r.dt_saida BETWEEN ? AND ? ${f.where}
       GROUP BY r.id_terc ORDER BY enviado DESC LIMIT 10`
    ).bind(ini, fim, ...f.binds).all();

    // Faltas por período (apenas refugo)
    const faltasPeriodo = await c.env.DB.prepare(
      `SELECT rt.dt_retorno AS dt, COALESCE(SUM(rt.qtd_refugo),0) AS qtd
       FROM terc_retornos rt
       JOIN terc_remessas r ON r.id_remessa = rt.id_remessa
       WHERE rt.dt_retorno BETWEEN ? AND ? ${f.where}
       GROUP BY rt.dt_retorno ORDER BY rt.dt_retorno`
    ).bind(ini, fim, ...f.binds).all();

    // Retorno mensal (últimos 12 meses) — filtrado por id_empresa via JOIN com r
    const retMensal = await c.env.DB.prepare(
      `SELECT substr(rt.dt_retorno,1,7) AS mes,
              COALESCE(SUM(rt.qtd_boa),0)    AS boa,
              COALESCE(SUM(rt.qtd_refugo),0) AS falta,
              COALESCE(SUM(rt.valor_pago),0) AS valor
       FROM terc_retornos rt
       JOIN terc_remessas r ON r.id_remessa = rt.id_remessa
       WHERE rt.dt_retorno >= date('now','-12 months') AND r.id_empresa = ?
       GROUP BY substr(rt.dt_retorno,1,7) ORDER BY mes`
    ).bind(id_empresa).all();

    return c.json(ok({
      periodo: { ini, fim },
      kpis: {
        total_enviado:     Number(kpiRem?.total_enviado || 0),
        total_retornado:   Number(kpiRet?.total_retornado || 0),
        total_pago:        Number(kpiRem?.valor_pago || 0),
        total_faltas:      Number(kpiRet?.total_faltas || 0),
        total_consertos:   Number(kpiRet?.total_consertos || 0),
        qtd_remessas:      Number(kpiRem?.qtd_remessas || 0),
        qtd_retornos:      Number(kpiRet?.qtd_retornos || 0),
        prazo_medio:       Number(kpiRem?.prazo_medio || 0),
        eficiencia:        Number(kpiRem?.efic_media || 0),
        valor_total_geral: Number(kpiRem?.valor_total || 0),
      },
      graficos: {
        producao_periodo:  prodPeriodo.results || [],
        pagamentos_periodo: pagPeriodo.results || [],
        top_servicos:       topServ.results || [],
        top_terceirizados:  topTerc.results || [],
        faltas_periodo:     faltasPeriodo.results || [],
        retorno_mensal:     retMensal.results || [],
      },
    }));
  } catch (e: any) {
    return fail('Erro no dashboard analítico: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 2) RELATÓRIO DE REMESSAS (lista detalhada)
 * ============================================================ */
app.get('/relatorios-det/remessas', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const f = buildWhere(q, 'r', id_empresa);
    const rows = await c.env.DB.prepare(
      `SELECT r.id_remessa, r.num_controle, r.num_op, r.cod_ref, r.desc_ref, r.cor,
              r.qtd_total, r.preco_unit, r.valor_total, r.valor_pago,
              r.dt_saida, r.dt_previsao, r.dt_recebimento, r.status, r.status_fin,
              s.desc_servico, t.nome_terc, c.nome_colecao
       FROM terc_remessas r
       LEFT JOIN terc_servicos     s ON s.id_servico = r.id_servico AND s.id_empresa = r.id_empresa
       LEFT JOIN terc_terceirizados t ON t.id_terc   = r.id_terc
       LEFT JOIN terc_colecoes     c ON c.id_colecao = r.id_colecao
       WHERE r.dt_saida BETWEEN ? AND ? ${f.where}
       ORDER BY r.dt_saida DESC, r.num_controle DESC`
    ).bind(ini, fim, ...f.binds).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro relatório remessas: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 3) RELATÓRIO DE RETORNOS
 * ============================================================ */
app.get('/relatorios-det/retornos', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const f = buildWhere(q, 'r', id_empresa);
    const rows = await c.env.DB.prepare(
      `SELECT rt.id_retorno, rt.dt_retorno, rt.qtd_boa, rt.qtd_refugo, rt.qtd_conserto,
              rt.qtd_total, rt.valor_pago, rt.observacao,
              r.id_remessa, r.num_controle, r.num_op, r.cod_ref, r.desc_ref, r.cor,
              r.qtd_total AS qtd_enviada, r.preco_unit, r.dt_saida, r.dt_previsao,
              r.prazo_dias, t.nome_terc, s.desc_servico,
              CAST(julianday(rt.dt_retorno) - julianday(r.dt_saida) AS INTEGER) AS dias_decorridos
       FROM terc_retornos rt
       JOIN terc_remessas r ON r.id_remessa = rt.id_remessa
       LEFT JOIN terc_terceirizados t ON t.id_terc   = r.id_terc
       LEFT JOIN terc_servicos     s ON s.id_servico = r.id_servico AND s.id_empresa = r.id_empresa
       WHERE rt.dt_retorno BETWEEN ? AND ? ${f.where}
       ORDER BY rt.dt_retorno DESC, rt.id_retorno DESC`
    ).bind(ini, fim, ...f.binds).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro relatório retornos: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 4) RELATÓRIO FINANCEIRO
 * ============================================================ */
app.get('/relatorios-det/financeiro', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const f = buildWhere(q, 'r', id_empresa);

    const totais: any = await c.env.DB.prepare(
      `SELECT
        COALESCE(SUM(r.valor_total),0) AS valor_total,
        COALESCE(SUM(r.valor_pago),0)  AS valor_pago,
        COALESCE(SUM(CASE WHEN r.status_fin='PendentePagamento' THEN (r.valor_total - r.valor_pago) ELSE 0 END),0) AS valor_pendente
       FROM terc_remessas r
       WHERE r.dt_saida BETWEEN ? AND ? ${f.where}`
    ).bind(ini, fim, ...f.binds).first();

    const porServico = await c.env.DB.prepare(
      `SELECT s.desc_servico AS nome,
              COALESCE(SUM(r.qtd_total),0)   AS qtd,
              COALESCE(SUM(r.valor_total),0) AS valor,
              COALESCE(SUM(r.valor_pago),0)  AS pago
       FROM terc_remessas r
       LEFT JOIN terc_servicos s ON s.id_servico = r.id_servico AND s.id_empresa = r.id_empresa
       WHERE r.dt_saida BETWEEN ? AND ? ${f.where}
       GROUP BY r.id_servico ORDER BY valor DESC`
    ).bind(ini, fim, ...f.binds).all();

    const porTerc = await c.env.DB.prepare(
      `SELECT t.nome_terc AS nome,
              COALESCE(SUM(r.qtd_total),0)   AS qtd,
              COALESCE(SUM(r.valor_total),0) AS valor,
              COALESCE(SUM(r.valor_pago),0)  AS pago
       FROM terc_remessas r
       LEFT JOIN terc_terceirizados t ON t.id_terc = r.id_terc
       WHERE r.dt_saida BETWEEN ? AND ? ${f.where}
       GROUP BY r.id_terc ORDER BY pago DESC`
    ).bind(ini, fim, ...f.binds).all();

    const porProduto = await c.env.DB.prepare(
      `SELECT r.cod_ref AS cod_ref, MAX(r.desc_ref) AS desc_ref,
              COALESCE(SUM(r.qtd_total),0)   AS qtd,
              COALESCE(SUM(r.valor_total),0) AS valor,
              COALESCE(SUM(r.valor_pago),0)  AS pago
       FROM terc_remessas r
       WHERE r.dt_saida BETWEEN ? AND ? ${f.where}
       GROUP BY r.cod_ref ORDER BY valor DESC LIMIT 50`
    ).bind(ini, fim, ...f.binds).all();

    const porPeriodo = await c.env.DB.prepare(
      `SELECT substr(r.dt_saida,1,7) AS mes,
              COALESCE(SUM(r.valor_total),0) AS valor,
              COALESCE(SUM(r.valor_pago),0)  AS pago
       FROM terc_remessas r
       WHERE r.dt_saida BETWEEN ? AND ? ${f.where}
       GROUP BY substr(r.dt_saida,1,7) ORDER BY mes`
    ).bind(ini, fim, ...f.binds).all();

    return c.json(ok({
      periodo: { ini, fim },
      totais: {
        valor_total:    Number(totais?.valor_total || 0),
        valor_pago:     Number(totais?.valor_pago || 0),
        valor_pendente: Number(totais?.valor_pendente || 0),
      },
      por_servico:   porServico.results || [],
      por_terceirizado: porTerc.results || [],
      por_produto:   porProduto.results || [],
      por_periodo:   porPeriodo.results || [],
    }));
  } catch (e: any) {
    return fail('Erro relatório financeiro: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 5) RELATÓRIO POR TERCEIRIZADO (com ranking)
 * Inicia FROM terc_terceirizados → filtro explícito t.id_empresa
 * ============================================================ */
app.get('/relatorios-det/por-terceirizado', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const rows = await c.env.DB.prepare(
      `SELECT t.id_terc, t.nome_terc, t.efic_padrao,
              COALESCE(SUM(r.qtd_total),0)        AS total_enviado,
              COALESCE(SUM(rt.qtd_boa),0)         AS total_recebido,
              COALESCE(SUM(rt.qtd_refugo),0)      AS total_faltas,
              COALESCE(SUM(rt.qtd_conserto),0)    AS total_consertos,
              COALESCE(SUM(r.valor_pago),0)       AS total_pago,
              COALESCE(AVG(r.prazo_dias),0)       AS prazo_medio,
              COALESCE(AVG(r.efic_pct),0)         AS efic_media,
              COUNT(DISTINCT r.id_remessa)        AS qtd_remessas
       FROM terc_terceirizados t
       LEFT JOIN terc_remessas r ON r.id_terc = t.id_terc AND r.dt_saida BETWEEN ? AND ? AND r.id_empresa = ?
       LEFT JOIN terc_retornos rt ON rt.id_remessa = r.id_remessa
       WHERE t.id_empresa = ?
       GROUP BY t.id_terc
       HAVING qtd_remessas > 0
       ORDER BY total_recebido DESC`
    ).bind(ini, fim, id_empresa, id_empresa).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro por terceirizado: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 6) RELATÓRIO POR SERVIÇO
 * Inicia FROM terc_servicos → filtro explícito s.id_empresa
 * ============================================================ */
app.get('/relatorios-det/por-servico', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const rows = await c.env.DB.prepare(
      `SELECT s.id_servico, s.desc_servico,
              COUNT(DISTINCT r.id_remessa)        AS qtd_remessas,
              COALESCE(SUM(r.qtd_total),0)        AS qtd_total,
              COALESCE(SUM(rt.qtd_boa),0)         AS qtd_produzida,
              COALESCE(SUM(r.valor_total),0)      AS valor_total,
              COALESCE(SUM(r.valor_pago),0)       AS valor_pago,
              COALESCE(AVG(r.tempo_peca),0)       AS tempo_medio
       FROM terc_servicos s
       LEFT JOIN terc_remessas r ON r.id_servico = s.id_servico AND r.dt_saida BETWEEN ? AND ? AND r.id_empresa = ?
       LEFT JOIN terc_retornos rt ON rt.id_remessa = r.id_remessa
       WHERE s.id_empresa = ?
       GROUP BY s.id_servico
       HAVING qtd_remessas > 0
       ORDER BY qtd_total DESC`
    ).bind(ini, fim, id_empresa, id_empresa).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro por serviço: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 6b) RELATÓRIO POR SETOR (HOTFIX 0037)
 * Inicia FROM terc_setores → filtro explícito st.id_empresa
 * ============================================================ */
app.get('/relatorios-det/por-setor', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const rows = await c.env.DB.prepare(
      `SELECT st.id_setor, st.nome_setor, st.cor, st.codigo, st.ordem,
              COUNT(DISTINCT r.id_remessa)        AS qtd_remessas,
              COALESCE(SUM(r.qtd_total),0)        AS qtd_total,
              COALESCE(SUM(rt.qtd_boa),0)         AS qtd_produzida,
              COALESCE(SUM(rt.qtd_refugo),0)      AS qtd_faltas,
              COALESCE(SUM(rt.qtd_conserto),0)    AS qtd_consertos,
              COALESCE(SUM(r.valor_total),0)      AS valor_total,
              COALESCE(SUM(r.valor_pago),0)       AS valor_pago,
              COALESCE(AVG(r.prazo_dias),0)       AS prazo_medio,
              COALESCE(AVG(r.efic_pct),0)         AS efic_media,
              COUNT(DISTINCT r.id_terc)           AS qtd_terceirizados_periodo
       FROM terc_setores st
       LEFT JOIN terc_remessas r ON r.id_setor = st.id_setor AND r.dt_saida BETWEEN ? AND ? AND r.id_empresa = ?
       LEFT JOIN terc_retornos rt ON rt.id_remessa = r.id_remessa
       WHERE st.id_empresa = ?
       GROUP BY st.id_setor
       ORDER BY COALESCE(st.ordem,9999), st.nome_setor`
    ).bind(ini, fim, id_empresa, id_empresa).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro por setor: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 7) RELATÓRIO POR PRODUTO
 * ============================================================ */
app.get('/relatorios-det/por-produto', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const rows = await c.env.DB.prepare(
      `SELECT r.cod_ref,
              MAX(r.desc_ref)                     AS desc_ref,
              GROUP_CONCAT(DISTINCT r.cor)        AS cores,
              COUNT(DISTINCT r.id_remessa)        AS qtd_remessas,
              COALESCE(SUM(r.qtd_total),0)        AS total_enviado,
              COALESCE(SUM(rt.qtd_boa),0)         AS total_retornado,
              COALESCE(SUM(rt.qtd_refugo),0)      AS total_faltas,
              COALESCE(SUM(r.valor_total),0)      AS valor_total,
              COALESCE(SUM(r.valor_pago),0)       AS valor_pago
       FROM terc_remessas r
       LEFT JOIN terc_retornos rt ON rt.id_remessa = r.id_remessa
       WHERE r.dt_saida BETWEEN ? AND ? AND r.id_empresa = ?
       GROUP BY r.cod_ref
       ORDER BY total_enviado DESC LIMIT 200`
    ).bind(ini, fim, id_empresa).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro por produto: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 8) RELATÓRIO POR COR
 * ============================================================ */
app.get('/relatorios-det/por-cor', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const rows = await c.env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(r.cor),''),'(sem cor)') AS cor,
              COUNT(DISTINCT r.id_remessa)    AS qtd_remessas,
              COALESCE(SUM(r.qtd_total),0)    AS qtd_enviada,
              COALESCE(SUM(rt.qtd_boa),0)     AS qtd_retornada,
              COALESCE(SUM(rt.qtd_refugo),0)  AS qtd_faltas,
              COALESCE(SUM(r.valor_total),0)  AS custo
       FROM terc_remessas r
       LEFT JOIN terc_retornos rt ON rt.id_remessa = r.id_remessa
       WHERE r.dt_saida BETWEEN ? AND ? AND r.id_empresa = ?
       GROUP BY UPPER(TRIM(r.cor))
       ORDER BY qtd_enviada DESC`
    ).bind(ini, fim, id_empresa).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro por cor: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 9) RELATÓRIO POR OP
 * ============================================================ */
app.get('/relatorios-det/por-op', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const rows = await c.env.DB.prepare(
      `SELECT COALESCE(r.num_op,'(sem OP)')   AS num_op,
              COUNT(DISTINCT r.id_remessa)    AS qtd_remessas,
              COALESCE(SUM(r.qtd_total),0)    AS qtd_enviada,
              COALESCE(SUM(rt.qtd_boa),0)     AS qtd_retornada,
              COALESCE(SUM(rt.qtd_refugo),0)  AS qtd_faltas,
              COALESCE(SUM(r.valor_total),0)  AS valor_total,
              COALESCE(SUM(r.valor_pago),0)   AS valor_pago,
              MIN(r.dt_saida) AS dt_inicio, MAX(COALESCE(rt.dt_retorno,r.dt_previsao)) AS dt_fim
       FROM terc_remessas r
       LEFT JOIN terc_retornos rt ON rt.id_remessa = r.id_remessa
       WHERE r.dt_saida BETWEEN ? AND ? AND r.id_empresa = ?
       GROUP BY r.num_op
       ORDER BY dt_inicio DESC`
    ).bind(ini, fim, id_empresa).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro por OP: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 10) RELATÓRIO DE FALTAS
 * ============================================================ */
app.get('/relatorios-det/faltas', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const f = buildWhere(q, 'r', id_empresa);
    const rows = await c.env.DB.prepare(
      `SELECT rt.dt_retorno, rt.qtd_refugo AS qtd, rt.observacao,
              r.cod_ref, r.desc_ref, r.cor, r.num_op, r.num_controle,
              t.nome_terc, s.desc_servico
       FROM terc_retornos rt
       JOIN terc_remessas r ON r.id_remessa = rt.id_remessa
       LEFT JOIN terc_terceirizados t ON t.id_terc   = r.id_terc
       LEFT JOIN terc_servicos     s ON s.id_servico = r.id_servico AND s.id_empresa = r.id_empresa
       WHERE rt.dt_retorno BETWEEN ? AND ? AND rt.qtd_refugo > 0 ${f.where}
       ORDER BY rt.dt_retorno DESC, rt.qtd_refugo DESC`
    ).bind(ini, fim, ...f.binds).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro faltas: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 11) RELATÓRIO DE CONSERTO
 * ============================================================ */
app.get('/relatorios-det/conserto', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const f = buildWhere(q, 'r', id_empresa);
    const rows = await c.env.DB.prepare(
      `SELECT rt.dt_retorno, rt.qtd_conserto AS qtd, rt.observacao,
              r.cod_ref, r.desc_ref, r.cor, r.num_op, r.num_controle,
              r.preco_unit, (rt.qtd_conserto * r.preco_unit) AS custo,
              t.nome_terc, s.desc_servico
       FROM terc_retornos rt
       JOIN terc_remessas r ON r.id_remessa = rt.id_remessa
       LEFT JOIN terc_terceirizados t ON t.id_terc   = r.id_terc
       LEFT JOIN terc_servicos     s ON s.id_servico = r.id_servico AND s.id_empresa = r.id_empresa
       WHERE rt.dt_retorno BETWEEN ? AND ? AND rt.qtd_conserto > 0 ${f.where}
       ORDER BY rt.dt_retorno DESC, rt.qtd_conserto DESC`
    ).bind(ini, fim, ...f.binds).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro conserto: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 12) RELATÓRIO DE PRODUÇÃO (resumido por dia)
 * ============================================================ */
app.get('/relatorios-det/producao', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const f = buildWhere(q, 'r', id_empresa);
    const rows = await c.env.DB.prepare(
      `SELECT rt.dt_retorno AS dt,
              COUNT(DISTINCT r.id_remessa)      AS qtd_remessas,
              COALESCE(SUM(rt.qtd_boa),0)       AS qtd_boa,
              COALESCE(SUM(rt.qtd_refugo),0)    AS qtd_falta,
              COALESCE(SUM(rt.qtd_conserto),0)  AS qtd_conserto,
              COALESCE(SUM(rt.valor_pago),0)    AS valor_pago
       FROM terc_retornos rt
       JOIN terc_remessas r ON r.id_remessa = rt.id_remessa
       WHERE rt.dt_retorno BETWEEN ? AND ? ${f.where}
       GROUP BY rt.dt_retorno ORDER BY rt.dt_retorno DESC`
    ).bind(ini, fim, ...f.binds).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro produção: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 13) RANKING DE TERCEIRIZADOS (mais produtivos)
 * Inicia FROM terc_terceirizados → filtro explícito t.id_empresa
 * ============================================================ */
app.get('/relatorios-det/ranking', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const rows = await c.env.DB.prepare(
      `SELECT t.id_terc, t.nome_terc,
              COUNT(DISTINCT r.id_remessa)    AS qtd_remessas,
              COALESCE(SUM(rt.qtd_boa),0)     AS qtd_produzida,
              COALESCE(SUM(rt.qtd_refugo),0)  AS qtd_faltas,
              COALESCE(SUM(r.valor_pago),0)   AS valor_pago,
              COALESCE(AVG(r.efic_pct),0)     AS efic_media,
              CASE WHEN COALESCE(SUM(rt.qtd_boa),0) + COALESCE(SUM(rt.qtd_refugo),0) > 0
                   THEN 1.0 * COALESCE(SUM(rt.qtd_refugo),0)
                        / (COALESCE(SUM(rt.qtd_boa),0) + COALESCE(SUM(rt.qtd_refugo),0))
                   ELSE 0 END AS taxa_falta
       FROM terc_terceirizados t
       LEFT JOIN terc_remessas r ON r.id_terc = t.id_terc AND r.dt_saida BETWEEN ? AND ? AND r.id_empresa = ?
       LEFT JOIN terc_retornos rt ON rt.id_remessa = r.id_remessa
       WHERE t.id_empresa = ?
       GROUP BY t.id_terc
       HAVING qtd_remessas > 0
       ORDER BY qtd_produzida DESC`
    ).bind(ini, fim, id_empresa, id_empresa).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro ranking: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 14) HISTÓRICO GERAL (linha do tempo de remessas + retornos)
 * ============================================================ */
app.get('/relatorios-det/historico', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const q = c.req.query();
    const { ini, fim } = periodo(q);
    const f = buildWhere(q, 'r', id_empresa);
    const rows = await c.env.DB.prepare(
      `SELECT 'REMESSA' AS tipo, r.dt_saida AS dt, r.num_controle AS num,
              r.cod_ref, r.cor, r.qtd_total AS qtd, r.valor_total AS valor,
              r.status, t.nome_terc
       FROM terc_remessas r
       LEFT JOIN terc_terceirizados t ON t.id_terc = r.id_terc
       WHERE r.dt_saida BETWEEN ? AND ? ${f.where}
       UNION ALL
       SELECT 'RETORNO' AS tipo, rt.dt_retorno AS dt, r.num_controle AS num,
              r.cod_ref, r.cor, rt.qtd_total AS qtd, rt.valor_pago AS valor,
              'Retornado' AS status, t.nome_terc
       FROM terc_retornos rt
       JOIN terc_remessas r ON r.id_remessa = rt.id_remessa
       LEFT JOIN terc_terceirizados t ON t.id_terc = r.id_terc
       WHERE rt.dt_retorno BETWEEN ? AND ? ${f.where}
       ORDER BY dt DESC LIMIT 500`
    ).bind(ini, fim, ...f.binds, ini, fim, ...f.binds).all();
    return c.json(ok({ periodo: { ini, fim }, rows: rows.results || [] }));
  } catch (e: any) {
    return fail('Erro histórico: ' + (e?.message || e), 500);
  }
});

/* ============================================================
 * 15) FILTROS — listas auxiliares para selects
 * Todas as listas filtradas por id_empresa
 * ============================================================ */
app.get('/relatorios-det/filtros', async (c) => {
  try {
    const id_empresa = getEmpresa(c);
    const [tercs, servs, cols, setores, cores, ops] = await Promise.all([
      c.env.DB.prepare(`SELECT id_terc AS id, nome_terc AS nome FROM terc_terceirizados WHERE ativo=1 AND id_empresa=? ORDER BY nome_terc`).bind(id_empresa).all(),
      c.env.DB.prepare(`SELECT id_servico AS id, desc_servico AS nome FROM terc_servicos WHERE ativo=1 AND id_empresa=? ORDER BY desc_servico`).bind(id_empresa).all(),
      c.env.DB.prepare(`SELECT id_colecao AS id, nome_colecao AS nome FROM terc_colecoes WHERE ativo=1 AND id_empresa=? ORDER BY nome_colecao`).bind(id_empresa).all(),
      // HOTFIX 0037: lista de setores ativos
      c.env.DB.prepare(`SELECT id_setor AS id, nome_setor AS nome, cor FROM terc_setores WHERE ativo=1 AND id_empresa=? ORDER BY COALESCE(ordem,9999), nome_setor`).bind(id_empresa).all(),
      c.env.DB.prepare(`SELECT DISTINCT cor FROM terc_remessas WHERE cor IS NOT NULL AND TRIM(cor)<>'' AND id_empresa=? ORDER BY cor`).bind(id_empresa).all(),
      c.env.DB.prepare(`SELECT DISTINCT num_op FROM terc_remessas WHERE num_op IS NOT NULL AND TRIM(num_op)<>'' AND id_empresa=? ORDER BY num_op DESC LIMIT 200`).bind(id_empresa).all(),
    ]);
    return c.json(ok({
      terceirizados: tercs.results || [],
      servicos:      servs.results || [],
      colecoes:      cols.results || [],
      setores:       setores.results || [], // HOTFIX 0037
      cores:         (cores.results as any[] || []).map(x => x.cor),
      ops:           (ops.results as any[] || []).map(x => x.num_op),
      status: ['AguardandoEnvio','Enviado','EmProducao','Atrasado','Concluido','Retornado','Pago','Cancelado','Parcial'],
    }));
  } catch (e: any) {
    return fail('Erro filtros: ' + (e?.message || e), 500);
  }
});

export default app;
