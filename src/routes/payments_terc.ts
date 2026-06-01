/**
 * =============================================================================
 * HOTFIX 0042 — Módulo de Pagamentos de Terceirizados
 * =============================================================================
 *
 * Endpoints para a gestão financeira dos retornos:
 *   GET    /api/payments-terc/summary?id_terc=N        — painel financeiro de 1 terceirizado
 *   GET    /api/payments-terc                          — histórico paginado (filtros)
 *   GET    /api/payments-terc/:id                      — detalhe + itens + comprovante
 *   POST   /api/payments-terc                          — registra pagamento em lote
 *   POST   /api/payments-terc/:id/void                 — estorna (admin only)
 *
 * Garantias multi-tenant:
 *   • Todas as queries filtram por id_empresa (obtido de c.get('id_empresa'))
 *   • Retornos só podem ser pagos se pertencerem à mesma empresa do usuário
 *   • Estorno só pelo admin do tenant
 *
 * Garantias de compatibilidade:
 *   • terc_retornos.dt_pagamento continua sendo a fonte de verdade
 *   • Marca dt_pagamento + id_pagamento ao pagar; limpa ambos no estorno
 *   • Retornos legados (dt_pagamento sem id_pagamento) continuam exibindo "Pago"
 *
 * Auditoria:
 *   • Cada pagamento registra IP + login do usuário em payments_terc
 *   • audit() é chamado em todas as operações (CREATE_PAYMENT / VOID_PAYMENT)
 * =============================================================================
 */
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, toNum } from '../lib/db';
import { requireAdmin } from '../lib/auth';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any; id_empresa: number } }>();
const MOD = 'PAGTERC';

const FORMAS_VALIDAS = new Set([
  'PIX', 'Dinheiro', 'Transferência', 'TED', 'DOC', 'Cartão', 'Outro'
]);

/** Extrai o IP do cliente (tenta vários headers Cloudflare/proxy) */
function getClientIP(c: any): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'desconhecido'
  );
}

/* =============================================================================
 * GET /payments-terc/summary?id_terc=N
 *
 * Painel financeiro de UM terceirizado (tenant-scoped):
 *   - dados básicos do terceirizado (nome, setor, telefone)
 *   - agregados: total de retornos, peças boas, valor pendente, valor pago, valor total
 *   - quantidades por status (pendente/pago)
 *
 * Se id_terc = 0 ou ausente → retorna agregados globais da empresa.
 * ===========================================================================*/
app.get('/payments-terc/summary', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id_terc = toInt(c.req.query('id_terc') || 0);

  // 1) Terceirizado (se especificado)
  let terc: any = null;
  if (id_terc > 0) {
    terc = await c.env.DB.prepare(`
      SELECT t.id_terc, t.nome_terc, t.telefone, t.email,
             st.nome_setor, st.cor AS setor_cor
      FROM terc_terceirizados t
      LEFT JOIN terc_setores st ON st.id_setor = t.id_setor AND st.id_empresa = t.id_empresa
      WHERE t.id_terc = ? AND t.id_empresa = ?
    `).bind(id_terc, id_empresa).first();
    if (!terc) return c.json(fail('Terceirizado não encontrado nesta empresa.', 404));
  }

  // 2) Agregado dos retornos (sempre tenant-scoped)
  const whereExtra = id_terc > 0 ? 'AND r.id_terc = ?' : '';
  const binds: any[] = [id_empresa];
  if (id_terc > 0) binds.push(id_terc);

  const agg = await c.env.DB.prepare(`
    SELECT
      COUNT(rt.id_retorno)                                                   AS total_retornos,
      COALESCE(SUM(rt.qtd_boa), 0)                                           AS total_pecas_boas,
      COALESCE(SUM(rt.valor_pago), 0)                                        AS valor_total,
      COALESCE(SUM(CASE WHEN rt.dt_pagamento IS NULL     THEN rt.valor_pago ELSE 0 END), 0) AS valor_pendente,
      COALESCE(SUM(CASE WHEN rt.dt_pagamento IS NOT NULL THEN rt.valor_pago ELSE 0 END), 0) AS valor_pago,
      COALESCE(SUM(CASE WHEN rt.dt_pagamento IS NULL     THEN 1 ELSE 0 END), 0)             AS qtd_pendentes,
      COALESCE(SUM(CASE WHEN rt.dt_pagamento IS NOT NULL THEN 1 ELSE 0 END), 0)             AS qtd_pagos
    FROM terc_retornos rt
    JOIN terc_remessas r ON r.id_remessa = rt.id_remessa AND r.id_empresa = rt.id_empresa
    WHERE rt.id_empresa = ? ${whereExtra}
  `).bind(...binds).first<any>() || {};

  // 3) Último pagamento (só faz sentido se id_terc fornecido)
  let ultimoPagamento: any = null;
  if (id_terc > 0) {
    ultimoPagamento = await c.env.DB.prepare(`
      SELECT id_pagamento, dt_pagamento, valor_total, forma_pagamento, status
      FROM payments_terc
      WHERE id_empresa = ? AND id_terc = ? AND status = 'Confirmado'
      ORDER BY dt_pagamento DESC, id_pagamento DESC
      LIMIT 1
    `).bind(id_empresa, id_terc).first();
  }

  return c.json(ok({
    terceirizado: terc,
    totais: {
      total_retornos:   Number(agg.total_retornos) || 0,
      total_pecas_boas: Number(agg.total_pecas_boas) || 0,
      valor_total:      Number(agg.valor_total) || 0,
      valor_pendente:   Number(agg.valor_pendente) || 0,
      valor_pago:       Number(agg.valor_pago) || 0,
      qtd_pendentes:    Number(agg.qtd_pendentes) || 0,
      qtd_pagos:        Number(agg.qtd_pagos) || 0,
    },
    ultimo_pagamento: ultimoPagamento,
  }));
});

/* =============================================================================
 * GET /payments-terc
 *
 * Histórico paginado de pagamentos (tenant-scoped).
 * Query: ?de=YYYY-MM-DD&ate=YYYY-MM-DD&id_terc=N&forma=PIX&status=Confirmado&search=&page=1&per_page=50
 * ===========================================================================*/
app.get('/payments-terc', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const q = c.req.query();

  const today = new Date().toISOString().slice(0, 10);
  const de  = q.de  || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const ate = q.ate || today;
  const idTerc = toInt(q.id_terc || 0);
  const forma  = (q.forma || '').trim();
  const status = (q.status || '').trim();
  const search = (q.search || '').trim();

  let page    = Math.max(1, toInt(q.page || 1));
  let perPage = Math.max(1, Math.min(200, toInt(q.per_page || 50)));

  const where: string[] = ['p.id_empresa = ?', 'p.dt_pagamento >= ?', 'p.dt_pagamento <= ?'];
  const binds: any[] = [id_empresa, de, ate];

  if (idTerc) { where.push('p.id_terc = ?');         binds.push(idTerc); }
  if (forma)  { where.push('p.forma_pagamento = ?'); binds.push(forma);  }
  if (status) { where.push('p.status = ?');          binds.push(status); }
  if (search) {
    where.push('(t.nome_terc LIKE ? OR p.observacao LIKE ? OR CAST(p.id_pagamento AS TEXT) LIKE ?)');
    binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const whereSql = 'WHERE ' + where.join(' AND ');

  // Total + KPIs
  const kpi = await c.env.DB.prepare(`
    SELECT COUNT(*) AS qtd,
           COALESCE(SUM(CASE WHEN p.status='Confirmado' THEN p.valor_total ELSE 0 END),0) AS valor_total_confirmado,
           COALESCE(SUM(CASE WHEN p.status='Estornado'  THEN p.valor_total ELSE 0 END),0) AS valor_total_estornado
    FROM payments_terc p
    LEFT JOIN terc_terceirizados t ON t.id_terc = p.id_terc AND t.id_empresa = p.id_empresa
    ${whereSql}
  `).bind(...binds).first<any>() || {};

  const total = Number(kpi.qtd) || 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (page > totalPages) page = totalPages;
  const offset = (page - 1) * perPage;

  const rows = (await c.env.DB.prepare(`
    SELECT p.id_pagamento, p.dt_pagamento, p.valor_total, p.qtd_retornos, p.qtd_pecas_boas,
           p.forma_pagamento, p.observacao, p.status, p.usuario, p.dt_criacao,
           p.estornado_por, p.dt_estorno, p.motivo_estorno,
           t.id_terc, t.nome_terc, t.telefone,
           st.nome_setor, st.cor AS setor_cor
    FROM payments_terc p
    LEFT JOIN terc_terceirizados t ON t.id_terc = p.id_terc AND t.id_empresa = p.id_empresa
    LEFT JOIN terc_setores st ON st.id_setor = t.id_setor AND st.id_empresa = t.id_empresa
    ${whereSql}
    ORDER BY p.dt_pagamento DESC, p.id_pagamento DESC
    LIMIT ? OFFSET ?
  `).bind(...binds, perPage, offset).all()).results as any[];

  return c.json(ok({
    rows,
    total,
    page,
    per_page: perPage,
    total_pages: totalPages,
    kpis: {
      qtd: total,
      valor_confirmado: Number(kpi.valor_total_confirmado) || 0,
      valor_estornado:  Number(kpi.valor_total_estornado) || 0,
    },
  }));
});

/* =============================================================================
 * GET /payments-terc/:id
 *
 * Detalhe completo do pagamento (cabeçalho + itens com remessas/retornos).
 * Usado para visualizar e gerar PDF do comprovante.
 * ===========================================================================*/
app.get('/payments-terc/:id', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  if (!id) return c.json(fail('ID inválido.', 400));

  const pag = await c.env.DB.prepare(`
    SELECT p.*,
           t.nome_terc, t.telefone, t.email,
           st.nome_setor, st.cor AS setor_cor,
           e.nome AS empresa_nome, e.slug AS empresa_slug
    FROM payments_terc p
    LEFT JOIN terc_terceirizados t ON t.id_terc = p.id_terc AND t.id_empresa = p.id_empresa
    LEFT JOIN terc_setores st ON st.id_setor = t.id_setor AND st.id_empresa = t.id_empresa
    LEFT JOIN companies e ON e.id_empresa = p.id_empresa
    WHERE p.id_pagamento = ? AND p.id_empresa = ?
  `).bind(id, id_empresa).first<any>();

  if (!pag) return c.json(fail('Pagamento não encontrado.', 404));

  const itens = (await c.env.DB.prepare(`
    SELECT pi.id_payment_item, pi.id_retorno, pi.valor,
           rt.dt_retorno, rt.qtd_boa, rt.qtd_refugo, rt.qtd_conserto, rt.qtd_total,
           r.id_remessa, r.num_controle, r.num_op, r.cod_ref, r.desc_ref, r.cor, r.preco_unit,
           sv.desc_servico
    FROM payment_terc_items pi
    JOIN terc_retornos rt ON rt.id_retorno = pi.id_retorno AND rt.id_empresa = pi.id_empresa
    JOIN terc_remessas r ON r.id_remessa = rt.id_remessa AND r.id_empresa = rt.id_empresa
    LEFT JOIN terc_servicos sv ON sv.id_servico = r.id_servico AND sv.id_empresa = r.id_empresa
    WHERE pi.id_pagamento = ? AND pi.id_empresa = ?
    ORDER BY r.num_controle ASC, pi.id_payment_item ASC
  `).bind(id, id_empresa).all()).results as any[];

  return c.json(ok({ pagamento: pag, itens }));
});

/* =============================================================================
 * POST /payments-terc
 *
 * Registra pagamento em lote para 1+ retornos do MESMO terceirizado.
 *
 * Body: {
 *   id_terc: number,
 *   id_retornos: number[],
 *   dt_pagamento: 'YYYY-MM-DD',
 *   forma_pagamento: 'PIX'|'Dinheiro'|...,
 *   observacao?: string
 * }
 *
 * Validações:
 *   - id_terc + id_retornos[] obrigatórios
 *   - Todos os retornos devem pertencer à empresa atual E ao id_terc informado
 *   - Nenhum dos retornos pode estar pago (dt_pagamento IS NOT NULL)
 *   - forma_pagamento deve ser válida
 *
 * Transação:
 *   1) INSERT em payments_terc (cabeçalho)
 *   2) INSERT em payment_terc_items (1 por retorno)
 *   3) UPDATE terc_retornos SET dt_pagamento=?, id_pagamento=? WHERE id IN (...)
 *   4) audit() registrando ação
 * ===========================================================================*/
app.post('/payments-terc', async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const user = c.get('user') as any;
  const login = user?.login || 'sistema';
  const ip = getClientIP(c);

  const body = await c.req.json<any>().catch(() => ({}));
  const id_terc = toInt(body.id_terc);
  const id_retornos: number[] = Array.isArray(body.id_retornos)
    ? body.id_retornos.map((x: any) => toInt(x)).filter((x: number) => x > 0)
    : [];
  const dt_pagamento = String(body.dt_pagamento || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const forma_pagamento = String(body.forma_pagamento || 'PIX');
  const observacao = body.observacao ? String(body.observacao).slice(0, 1000) : null;

  // ── Validações iniciais
  if (!id_terc) return c.json(fail('Terceirizado é obrigatório.', 400));
  if (!id_retornos.length) return c.json(fail('Selecione ao menos 1 retorno para pagar.', 400));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dt_pagamento)) return c.json(fail('Data de pagamento inválida (YYYY-MM-DD).', 400));
  if (!FORMAS_VALIDAS.has(forma_pagamento)) return c.json(fail('Forma de pagamento inválida.', 400));

  // ── Confere que terceirizado existe nesta empresa
  const terc = await c.env.DB.prepare(`
    SELECT id_terc, nome_terc FROM terc_terceirizados
    WHERE id_terc = ? AND id_empresa = ?
  `).bind(id_terc, id_empresa).first<any>();
  if (!terc) return c.json(fail('Terceirizado não encontrado nesta empresa.', 404));

  // ── Valida retornos: pertencem à empresa + ao terceirizado + ainda pendentes
  const placeholders = id_retornos.map(() => '?').join(',');
  const rets = (await c.env.DB.prepare(`
    SELECT rt.id_retorno, rt.id_remessa, rt.dt_pagamento, rt.valor_pago, rt.qtd_boa, r.id_terc
    FROM terc_retornos rt
    JOIN terc_remessas r ON r.id_remessa = rt.id_remessa AND r.id_empresa = rt.id_empresa
    WHERE rt.id_empresa = ? AND rt.id_retorno IN (${placeholders})
  `).bind(id_empresa, ...id_retornos).all()).results as any[];

  if (rets.length !== id_retornos.length) {
    return c.json(fail(`Alguns retornos não foram encontrados ou pertencem a outra empresa. (${rets.length}/${id_retornos.length})`, 400));
  }

  const errosTerc = rets.filter(r => Number(r.id_terc) !== id_terc);
  if (errosTerc.length) {
    return c.json(fail(`${errosTerc.length} retorno(s) não pertencem ao terceirizado selecionado.`, 400));
  }

  const jaPagos = rets.filter(r => r.dt_pagamento);
  if (jaPagos.length) {
    return c.json(fail(`${jaPagos.length} retorno(s) já estão pagos. Atualize a página e tente novamente.`, 409));
  }

  // ── Calcula totais
  const valor_total    = rets.reduce((s, r) => s + (Number(r.valor_pago) || 0), 0);
  const qtd_pecas_boas = rets.reduce((s, r) => s + (Number(r.qtd_boa) || 0), 0);
  const qtd_retornos   = rets.length;

  // ── 1) Insere cabeçalho do pagamento
  const insP = await c.env.DB.prepare(`
    INSERT INTO payments_terc (
      id_empresa, id_terc, dt_pagamento, valor_total, qtd_retornos, qtd_pecas_boas,
      forma_pagamento, observacao, status, usuario, ip_origem
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Confirmado', ?, ?)
  `).bind(
    id_empresa, id_terc, dt_pagamento, valor_total, qtd_retornos, qtd_pecas_boas,
    forma_pagamento, observacao, login, ip
  ).run();

  const id_pagamento = Number(insP.meta?.last_row_id || 0);
  if (!id_pagamento) return c.json(fail('Falha ao registrar pagamento.', 500));

  // ── 2) Insere itens (1 por retorno)
  for (const r of rets) {
    await c.env.DB.prepare(`
      INSERT INTO payment_terc_items (id_pagamento, id_empresa, id_retorno, valor)
      VALUES (?, ?, ?, ?)
    `).bind(id_pagamento, id_empresa, r.id_retorno, Number(r.valor_pago) || 0).run();
  }

  // ── 3) Atualiza retornos: marca como pagos
  await c.env.DB.prepare(`
    UPDATE terc_retornos
    SET dt_pagamento = ?, id_pagamento = ?
    WHERE id_empresa = ? AND id_retorno IN (${placeholders})
  `).bind(dt_pagamento, id_pagamento, id_empresa, ...id_retornos).run();

  // ── 4) Auditoria
  await audit(c, MOD, 'CREATE',
    `pagamento:${id_pagamento}`,
    'valor_total',
    '0',
    String(valor_total)
  );

  return c.json(ok({
    id_pagamento,
    valor_total,
    qtd_retornos,
    qtd_pecas_boas,
    forma_pagamento,
    dt_pagamento,
    terceirizado: terc.nome_terc,
  }));
});

/* =============================================================================
 * POST /payments-terc/:id/void
 *
 * Estorna um pagamento. Só admins do tenant podem executar.
 * - status = 'Estornado'
 * - terc_retornos.dt_pagamento = NULL, id_pagamento = NULL para todos os itens
 * - audit() registra com motivo
 * ===========================================================================*/
app.post('/payments-terc/:id/void', requireAdmin(), async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const user = c.get('user') as any;
  const login = user?.login || 'admin';
  const id = toInt(c.req.param('id'));
  if (!id) return c.json(fail('ID inválido.', 400));

  const body = await c.req.json<any>().catch(() => ({}));
  const motivo = String(body.motivo || '').slice(0, 500).trim();
  if (!motivo) return c.json(fail('Motivo do estorno é obrigatório.', 400));

  const pag = await c.env.DB.prepare(`
    SELECT id_pagamento, status, valor_total FROM payments_terc
    WHERE id_pagamento = ? AND id_empresa = ?
  `).bind(id, id_empresa).first<any>();

  if (!pag) return c.json(fail('Pagamento não encontrado.', 404));
  if (pag.status === 'Estornado') return c.json(fail('Pagamento já está estornado.', 409));

  // 1) Libera os retornos (volta a "pendente")
  await c.env.DB.prepare(`
    UPDATE terc_retornos
    SET dt_pagamento = NULL, id_pagamento = NULL
    WHERE id_empresa = ? AND id_pagamento = ?
  `).bind(id_empresa, id).run();

  // 2) Marca pagamento como estornado
  await c.env.DB.prepare(`
    UPDATE payments_terc
    SET status = 'Estornado',
        estornado_por = ?,
        dt_estorno = datetime('now'),
        motivo_estorno = ?
    WHERE id_pagamento = ? AND id_empresa = ?
  `).bind(login, motivo, id, id_empresa).run();

  // 3) Auditoria
  await audit(c, MOD, 'VOID',
    `pagamento:${id}`,
    'status',
    'Confirmado',
    `Estornado: ${motivo}`
  );

  return c.json(ok({ id_pagamento: id, status: 'Estornado', motivo }));
});

export default app;
