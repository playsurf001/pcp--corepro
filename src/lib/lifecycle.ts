// =============================================================
// SaaS — Lifecycle de Assinaturas
// =============================================================
// Funções puras (sem Hono Context) — reutilizadas em:
//   1) handlers HTTP (/master/jobs/*)
//   2) handler `scheduled` do Worker (cron diário)
//
// Empresa id_empresa=1 (fundadora) é IMUNE a qualquer mudança automática.
// Toda transição grava em `sub_logs` para auditoria.
// =============================================================

export type LifecycleResult<T = any> = {
  job: string;
  processados: number;
  itens: T[];
  duracao_ms: number;
};

const FOUNDER_ID = 1; // empresa fundadora — imune ao lifecycle automático

/* =============================================================
 * Helper: registra transição em sub_logs
 * ============================================================= */
export async function logSub(
  DB: D1Database,
  args: {
    id_sub: number;
    id_empresa: number;
    evento: string;
    status_antes?: string | null;
    status_depois?: string | null;
    origem?: 'cron' | 'master' | 'webhook' | 'system';
    detalhes?: any;
  }
): Promise<void> {
  try {
    await DB.prepare(
      `INSERT INTO sub_logs
         (id_sub, id_empresa, evento, status_antes, status_depois, origem, detalhes)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(
      args.id_sub,
      args.id_empresa,
      args.evento,
      args.status_antes ?? null,
      args.status_depois ?? null,
      args.origem ?? 'system',
      args.detalhes ? JSON.stringify(args.detalhes) : null
    ).run();
  } catch {
    // sub_logs não deve quebrar o job principal
  }
}

/* =============================================================
 * Helper: registra execução de job em job_runs
 * Retorna o id_run para atualizar no final.
 * ============================================================= */
export async function startJobRun(
  DB: D1Database,
  job_name: string,
  origem: 'cron' | 'manual',
  acionado_por: string
): Promise<number> {
  try {
    const r = await DB.prepare(
      `INSERT INTO job_runs (job_name, origem, acionado_por) VALUES (?,?,?)`
    ).bind(job_name, origem, acionado_por).run();
    return Number((r.meta as any)?.last_row_id || 0);
  } catch {
    return 0;
  }
}

export async function finishJobRun(
  DB: D1Database,
  id_run: number,
  args: {
    status: 'ok' | 'erro' | 'parcial';
    processados: number;
    resultado?: any;
    erro?: string;
    duracao_ms: number;
  }
): Promise<void> {
  if (!id_run) return;
  try {
    await DB.prepare(
      `UPDATE job_runs
          SET finalizado_em = datetime('now'),
              duracao_ms   = ?,
              status       = ?,
              processados  = ?,
              resultado    = ?,
              erro         = ?
        WHERE id_run = ?`
    ).bind(
      args.duracao_ms,
      args.status,
      args.processados,
      args.resultado ? JSON.stringify(args.resultado) : null,
      args.erro || null,
      id_run
    ).run();
  } catch {
    // silencioso
  }
}

/* =============================================================
 * JOB 1 — expire_trials
 * Trials vencidos: companies.status='trial' AND date(trial_ate) < date('now')
 *   → companies.status='suspensa'
 *   → subscriptions vinculadas (status IN ('trial','pendente')) → 'expirada'
 * ============================================================= */
export async function runExpireTrials(
  DB: D1Database
): Promise<LifecycleResult> {
  const t0 = Date.now();
  const cand: any = await DB.prepare(
    `SELECT c.id_empresa, c.nome, c.slug, c.trial_ate,
            s.id_sub, s.status AS sub_status
       FROM companies c
       LEFT JOIN subscriptions s ON s.id_empresa = c.id_empresa
            AND s.status IN ('trial','ativa','pendente')
      WHERE c.id_empresa <> ?
        AND c.status = 'trial'
        AND c.trial_ate IS NOT NULL
        AND date(c.trial_ate) < date('now')`
  ).bind(FOUNDER_ID).all();

  const itens: any[] = [];
  for (const row of cand.results || []) {
    await DB.prepare(
      `UPDATE companies
          SET status = 'suspensa',
              dt_suspensao = datetime('now'),
              dt_atualizacao = datetime('now')
        WHERE id_empresa = ?`
    ).bind(row.id_empresa).run();

    if (row.id_sub) {
      await DB.prepare(
        `UPDATE subscriptions
            SET status = 'expirada',
                dt_fim = datetime('now'),
                dt_atualizacao = datetime('now')
          WHERE id_sub = ?`
      ).bind(row.id_sub).run();
      await logSub(DB, {
        id_sub: row.id_sub,
        id_empresa: row.id_empresa,
        evento: 'trial_expirado',
        status_antes: row.sub_status,
        status_depois: 'expirada',
        origem: 'cron',
        detalhes: { trial_ate: row.trial_ate, nome: row.nome },
      });
    }
    itens.push({
      id_empresa: row.id_empresa,
      nome: row.nome,
      slug: row.slug,
      trial_ate: row.trial_ate,
    });
  }
  return {
    job: 'expire_trials',
    processados: itens.length,
    itens,
    duracao_ms: Date.now() - t0,
  };
}

/* =============================================================
 * JOB 2 — mark_overdue
 * Assinaturas ativas com dt_proxima_cobranca < hoje
 *   → status='pendente'
 *   → dt_pagamento_atrasada = date('now') (se ainda não tiver)
 * ============================================================= */
export async function runMarkOverdue(
  DB: D1Database
): Promise<LifecycleResult> {
  const t0 = Date.now();
  const cand: any = await DB.prepare(
    `SELECT s.id_sub, s.id_empresa, c.nome, s.dt_proxima_cobranca, s.status
       FROM subscriptions s
       JOIN companies c ON c.id_empresa = s.id_empresa
      WHERE c.id_empresa <> ?
        AND s.status = 'ativa'
        AND s.dt_proxima_cobranca IS NOT NULL
        AND date(s.dt_proxima_cobranca) < date('now')`
  ).bind(FOUNDER_ID).all();

  const itens: any[] = [];
  for (const row of cand.results || []) {
    await DB.prepare(
      `UPDATE subscriptions
          SET status = 'pendente',
              dt_pagamento_atrasada = COALESCE(dt_pagamento_atrasada, date('now')),
              dt_atualizacao = datetime('now')
        WHERE id_sub = ?`
    ).bind(row.id_sub).run();
    await logSub(DB, {
      id_sub: row.id_sub,
      id_empresa: row.id_empresa,
      evento: 'pagamento_atrasado',
      status_antes: 'ativa',
      status_depois: 'pendente',
      origem: 'cron',
      detalhes: { dt_proxima_cobranca: row.dt_proxima_cobranca, nome: row.nome },
    });
    itens.push({
      id_sub: row.id_sub,
      id_empresa: row.id_empresa,
      nome: row.nome,
      dt_proxima_cobranca: row.dt_proxima_cobranca,
    });
  }
  return {
    job: 'mark_overdue',
    processados: itens.length,
    itens,
    duracao_ms: Date.now() - t0,
  };
}

/* =============================================================
 * JOB 3 — block_overdue
 * Assinaturas pendentes há mais de N dias (dias_grace) → bloqueia empresa
 *   - companies.status='suspensa', bloqueada_em=now, bloqueada_por_pagamento=1
 *   - subscriptions.status='suspensa'
 * ============================================================= */
export async function runBlockOverdue(
  DB: D1Database
): Promise<LifecycleResult> {
  const t0 = Date.now();
  const cand: any = await DB.prepare(
    `SELECT s.id_sub, s.id_empresa, c.nome, s.dt_pagamento_atrasada, s.dias_grace,
            CAST(julianday('now') - julianday(s.dt_pagamento_atrasada) AS INTEGER) AS dias_atraso
       FROM subscriptions s
       JOIN companies c ON c.id_empresa = s.id_empresa
      WHERE c.id_empresa <> ?
        AND s.status = 'pendente'
        AND s.dt_pagamento_atrasada IS NOT NULL
        AND c.bloqueada_em IS NULL
        AND CAST(julianday('now') - julianday(s.dt_pagamento_atrasada) AS INTEGER) >= s.dias_grace`
  ).bind(FOUNDER_ID).all();

  const itens: any[] = [];
  for (const row of cand.results || []) {
    await DB.prepare(
      `UPDATE companies
          SET status = 'suspensa',
              bloqueada_em = datetime('now'),
              bloqueada_por_pagamento = 1,
              motivo_bloqueio = COALESCE(motivo_bloqueio, 'Pagamento em atraso há ' || ? || ' dias.'),
              dt_atualizacao = datetime('now')
        WHERE id_empresa = ?`
    ).bind(row.dias_atraso, row.id_empresa).run();

    await DB.prepare(
      `UPDATE subscriptions
          SET status = 'suspensa',
              dt_atualizacao = datetime('now')
        WHERE id_sub = ?`
    ).bind(row.id_sub).run();

    await logSub(DB, {
      id_sub: row.id_sub,
      id_empresa: row.id_empresa,
      evento: 'bloqueada',
      status_antes: 'pendente',
      status_depois: 'suspensa',
      origem: 'cron',
      detalhes: {
        dias_atraso: row.dias_atraso,
        dias_grace: row.dias_grace,
        nome: row.nome,
      },
    });

    itens.push({
      id_sub: row.id_sub,
      id_empresa: row.id_empresa,
      nome: row.nome,
      dias_atraso: row.dias_atraso,
      dias_grace: row.dias_grace,
    });
  }
  return {
    job: 'block_overdue',
    processados: itens.length,
    itens,
    duracao_ms: Date.now() - t0,
  };
}

/* =============================================================
 * JOB 4 — warn_upcoming
 * Sinaliza assinaturas que vencem em ≤ 3 dias (trial OU cobrança).
 * Por enquanto: apenas marca `ultimo_aviso_em` e loga em sub_logs.
 * No futuro (Sprint F) → enviar e-mail real.
 * ============================================================= */
export async function runWarnUpcoming(
  DB: D1Database
): Promise<LifecycleResult> {
  const t0 = Date.now();
  const cand: any = await DB.prepare(
    `SELECT s.id_sub, s.id_empresa, c.nome, s.status, s.trial_ate, s.dt_proxima_cobranca,
            CAST(julianday(COALESCE(s.trial_ate, s.dt_proxima_cobranca)) - julianday('now') AS INTEGER) AS dias_para_vencer
       FROM subscriptions s
       JOIN companies c ON c.id_empresa = s.id_empresa
      WHERE c.id_empresa <> ?
        AND s.status IN ('trial','ativa')
        AND (
          (s.status = 'trial' AND s.trial_ate IS NOT NULL
            AND CAST(julianday(s.trial_ate) - julianday('now') AS INTEGER) BETWEEN 0 AND 3)
          OR
          (s.status = 'ativa' AND s.dt_proxima_cobranca IS NOT NULL
            AND CAST(julianday(s.dt_proxima_cobranca) - julianday('now') AS INTEGER) BETWEEN 0 AND 3)
        )
        AND (s.ultimo_aviso_em IS NULL OR date(s.ultimo_aviso_em) < date('now'))`
  ).bind(FOUNDER_ID).all();

  const itens: any[] = [];
  for (const row of cand.results || []) {
    await DB.prepare(
      `UPDATE subscriptions
          SET ultimo_aviso_em = datetime('now')
        WHERE id_sub = ?`
    ).bind(row.id_sub).run();

    await logSub(DB, {
      id_sub: row.id_sub,
      id_empresa: row.id_empresa,
      evento: 'aviso_enviado',
      status_antes: row.status,
      status_depois: row.status,
      origem: 'cron',
      detalhes: {
        tipo: row.status === 'trial' ? 'trial_vence_em_breve' : 'cobranca_vence_em_breve',
        dias_para_vencer: row.dias_para_vencer,
        nome: row.nome,
      },
    });

    itens.push({
      id_sub: row.id_sub,
      id_empresa: row.id_empresa,
      nome: row.nome,
      tipo: row.status === 'trial' ? 'trial' : 'cobranca',
      dias_para_vencer: row.dias_para_vencer,
    });
  }
  return {
    job: 'warn_upcoming',
    processados: itens.length,
    itens,
    duracao_ms: Date.now() - t0,
  };
}

/* =============================================================
 * JOB COMPOSTO — lifecycle_full
 * Executa todos na ordem correta: warn → expire → mark → block
 * ============================================================= */
export async function runLifecycleFull(
  DB: D1Database
): Promise<{
  duracao_ms: number;
  total_processados: number;
  resultados: { [k: string]: LifecycleResult };
}> {
  const t0 = Date.now();
  const a = await runWarnUpcoming(DB);
  const b = await runExpireTrials(DB);
  const c = await runMarkOverdue(DB);
  const d = await runBlockOverdue(DB);
  return {
    duracao_ms: Date.now() - t0,
    total_processados: a.processados + b.processados + c.processados + d.processados,
    resultados: {
      warn_upcoming: a,
      expire_trials: b,
      mark_overdue: c,
      block_overdue: d,
    },
  };
}

/* =============================================================
 * PREVIEW helpers — leem o BD sem mutar nada
 * Usados pelo painel master.
 * ============================================================= */
export async function previewExpireTrials(DB: D1Database) {
  const r: any = await DB.prepare(
    `SELECT c.id_empresa, c.nome, c.slug, c.trial_ate,
            CAST(julianday('now') - julianday(c.trial_ate) AS INTEGER) AS dias_vencido
       FROM companies c
      WHERE c.id_empresa <> ?
        AND c.status = 'trial'
        AND c.trial_ate IS NOT NULL
        AND date(c.trial_ate) < date('now')
      ORDER BY c.trial_ate`
  ).bind(FOUNDER_ID).all();
  return r.results || [];
}

export async function previewMarkOverdue(DB: D1Database) {
  const r: any = await DB.prepare(
    `SELECT s.id_sub, s.id_empresa, c.nome, s.dt_proxima_cobranca, s.preco_aplicado,
            CAST(julianday('now') - julianday(s.dt_proxima_cobranca) AS INTEGER) AS dias_atraso
       FROM subscriptions s
       JOIN companies c ON c.id_empresa = s.id_empresa
      WHERE c.id_empresa <> ?
        AND s.status = 'ativa'
        AND s.dt_proxima_cobranca IS NOT NULL
        AND date(s.dt_proxima_cobranca) < date('now')
      ORDER BY s.dt_proxima_cobranca`
  ).bind(FOUNDER_ID).all();
  return r.results || [];
}

export async function previewBlockOverdue(DB: D1Database) {
  const r: any = await DB.prepare(
    `SELECT s.id_sub, s.id_empresa, c.nome, s.dt_pagamento_atrasada, s.dias_grace,
            CAST(julianday('now') - julianday(s.dt_pagamento_atrasada) AS INTEGER) AS dias_atraso,
            s.preco_aplicado
       FROM subscriptions s
       JOIN companies c ON c.id_empresa = s.id_empresa
      WHERE c.id_empresa <> ?
        AND s.status = 'pendente'
        AND s.dt_pagamento_atrasada IS NOT NULL
        AND c.bloqueada_em IS NULL
        AND CAST(julianday('now') - julianday(s.dt_pagamento_atrasada) AS INTEGER) >= s.dias_grace
      ORDER BY s.dt_pagamento_atrasada`
  ).bind(FOUNDER_ID).all();
  return r.results || [];
}

export async function previewWarnUpcoming(DB: D1Database) {
  const r: any = await DB.prepare(
    `SELECT s.id_sub, s.id_empresa, c.nome, s.status, s.trial_ate, s.dt_proxima_cobranca,
            CAST(julianday(COALESCE(s.trial_ate, s.dt_proxima_cobranca)) - julianday('now') AS INTEGER) AS dias_para_vencer,
            s.ultimo_aviso_em
       FROM subscriptions s
       JOIN companies c ON c.id_empresa = s.id_empresa
      WHERE c.id_empresa <> ?
        AND s.status IN ('trial','ativa')
        AND (
          (s.status = 'trial' AND s.trial_ate IS NOT NULL
            AND CAST(julianday(s.trial_ate) - julianday('now') AS INTEGER) BETWEEN 0 AND 3)
          OR
          (s.status = 'ativa' AND s.dt_proxima_cobranca IS NOT NULL
            AND CAST(julianday(s.dt_proxima_cobranca) - julianday('now') AS INTEGER) BETWEEN 0 AND 3)
        )
      ORDER BY dias_para_vencer`
  ).bind(FOUNDER_ID).all();
  return r.results || [];
}
