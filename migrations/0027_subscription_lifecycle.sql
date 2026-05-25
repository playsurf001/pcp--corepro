-- =====================================================================
-- 0027_subscription_lifecycle.sql
-- SPRINT C — Lifecycle de assinaturas
--
-- O que esta migration faz:
--   1) Adiciona em `subscriptions`:
--      - dias_grace          (INT) janela em dias entre vencimento e bloqueio (default 5)
--      - dt_pagamento_atrasada (TEXT) primeiro dia em que ficou inadimplente
--      - ultimo_aviso_em     (TEXT) último envio de aviso pré-vencimento
--   2) Adiciona em `companies`:
--      - bloqueada_por_pagamento (0/1) distingue bloqueio por inadimplência de bloqueio manual
--   3) Cria tabela `sub_logs` para auditar mudanças de estado da assinatura
--      (origem: cron, master manual, sistema, webhook MP)
--   4) Cria tabela `job_runs` para auditar execuções dos jobs cron/manual
-- =====================================================================

-- (1) subscriptions: novos campos
ALTER TABLE subscriptions ADD COLUMN dias_grace INTEGER NOT NULL DEFAULT 5;
ALTER TABLE subscriptions ADD COLUMN dt_pagamento_atrasada TEXT;
ALTER TABLE subscriptions ADD COLUMN ultimo_aviso_em TEXT;

-- (2) companies: flag de bloqueio por inadimplência
ALTER TABLE companies ADD COLUMN bloqueada_por_pagamento INTEGER NOT NULL DEFAULT 0;

-- (3) sub_logs: histórico de transições
CREATE TABLE IF NOT EXISTS sub_logs (
  id_log         INTEGER PRIMARY KEY AUTOINCREMENT,
  id_sub         INTEGER NOT NULL,
  id_empresa     INTEGER NOT NULL,
  evento         TEXT    NOT NULL,                    -- 'trial_expirado', 'pagamento_atrasado', 'bloqueada', 'reativada', 'troca_plano', 'aviso_enviado', 'criada', 'cancelada'
  status_antes   TEXT,
  status_depois  TEXT,
  origem         TEXT    NOT NULL DEFAULT 'system',   -- 'cron', 'master', 'webhook', 'system'
  detalhes       TEXT,                                -- JSON-livre
  dt_criacao     TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_sub) REFERENCES subscriptions(id_sub) ON DELETE CASCADE,
  FOREIGN KEY (id_empresa) REFERENCES companies(id_empresa) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sub_logs_sub      ON sub_logs(id_sub);
CREATE INDEX IF NOT EXISTS idx_sub_logs_empresa  ON sub_logs(id_empresa);
CREATE INDEX IF NOT EXISTS idx_sub_logs_evento   ON sub_logs(evento);
CREATE INDEX IF NOT EXISTS idx_sub_logs_dt       ON sub_logs(dt_criacao);

-- (4) job_runs: execuções de jobs cron / manual
CREATE TABLE IF NOT EXISTS job_runs (
  id_run         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name       TEXT    NOT NULL,                    -- 'expire_trials', 'mark_overdue', 'block_overdue', 'warn_upcoming', 'lifecycle_full'
  origem         TEXT    NOT NULL DEFAULT 'manual',   -- 'cron' | 'manual'
  iniciado_em    TEXT    NOT NULL DEFAULT (datetime('now')),
  finalizado_em  TEXT,
  duracao_ms     INTEGER,
  status         TEXT    NOT NULL DEFAULT 'ok'        -- 'ok' | 'erro' | 'parcial'
                 CHECK (status IN ('ok','erro','parcial')),
  processados    INTEGER NOT NULL DEFAULT 0,
  resultado      TEXT,                                -- JSON com resumo
  erro           TEXT,                                -- mensagem se status='erro'
  acionado_por   TEXT                                 -- login (master/cron/system)
);
CREATE INDEX IF NOT EXISTS idx_job_runs_name ON job_runs(job_name);
CREATE INDEX IF NOT EXISTS idx_job_runs_dt   ON job_runs(iniciado_em);

-- (5) Backfill: subscriptions ativas/pendentes sem dt_proxima_cobranca recebem
--     uma data padrão (30 dias após dt_inicio) — evita quebra do job markOverdue.
UPDATE subscriptions
   SET dt_proxima_cobranca = date(dt_inicio, '+30 days')
 WHERE dt_proxima_cobranca IS NULL
   AND status IN ('ativa','pendente');
