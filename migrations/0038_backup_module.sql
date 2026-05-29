-- ============================================================================
-- Migration 0038 — Módulo de Backup & Restauração (HOTFIX 0038)
-- ============================================================================
-- Objetivo: Permitir que cada empresa gere backup tenant-scoped (NDJSON gzipado)
-- e que o MASTER gere backup global. Histórico, restore e auditoria embutidos.
--
-- Decisões:
--   • Payload guardado INLINE no D1 (BLOB) para empresas pequenas (<800KB).
--     Coluna `storage_driver` deixa preparado para R2 futuro sem novo schema.
--   • `id_empresa = NULL` indica backup GLOBAL (master).
--   • Hard delete permitido apenas pelo dono do tenant ou master.
--   • Checksum SHA-256 obrigatório (valida antes de restaurar).
--   • `backup_logs` registra TODA mutação (gerar, baixar, restaurar, excluir).
-- ============================================================================

-- 1) Tabela principal de backups -------------------------------------------------
CREATE TABLE IF NOT EXISTS backups (
  id_backup         INTEGER PRIMARY KEY AUTOINCREMENT,
  id_empresa        INTEGER,                              -- NULL = backup global (master)
  tipo              TEXT NOT NULL DEFAULT 'manual',       -- 'manual' | 'auto' | 'pre_restore' | 'global'
  escopo            TEXT NOT NULL DEFAULT 'tenant',       -- 'tenant' | 'global'
  nome_arquivo      TEXT NOT NULL,                        -- ex: backup_E1_2026-05-27_14h30.ndjson.gz
  schema_version    INTEGER NOT NULL DEFAULT 38,          -- versão do schema no momento do dump
  tamanho_bytes     INTEGER NOT NULL DEFAULT 0,           -- tamanho do payload gzipado
  total_registros   INTEGER NOT NULL DEFAULT 0,           -- soma de linhas exportadas
  total_tabelas     INTEGER NOT NULL DEFAULT 0,
  checksum_sha256   TEXT NOT NULL DEFAULT '',             -- hex(sha256(payload))
  storage_driver    TEXT NOT NULL DEFAULT 'd1-inline',    -- 'd1-inline' | 'r2' (futuro)
  storage_path      TEXT,                                 -- usado pelo driver r2 no futuro
  payload           BLOB,                                 -- NDJSON gzipado (driver d1-inline)
  status            TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'ok' | 'erro' | 'restaurado'
  erro              TEXT,
  duracao_ms        INTEGER DEFAULT 0,
  criado_por        TEXT,                                 -- login do usuário ou 'master:<login>'
  criado_por_ip     TEXT,
  dt_criacao        TEXT NOT NULL DEFAULT (datetime('now')),
  dt_restaurado     TEXT,
  restaurado_por    TEXT,
  observacao        TEXT
);

CREATE INDEX IF NOT EXISTS idx_backups_emp_data    ON backups(id_empresa, dt_criacao DESC);
CREATE INDEX IF NOT EXISTS idx_backups_escopo      ON backups(escopo, dt_criacao DESC);
CREATE INDEX IF NOT EXISTS idx_backups_status      ON backups(status);

-- 2) Logs de auditoria de backups -----------------------------------------------
CREATE TABLE IF NOT EXISTS backup_logs (
  id_log       INTEGER PRIMARY KEY AUTOINCREMENT,
  id_backup    INTEGER,                                   -- pode ser NULL se ação falhou antes de gerar
  id_empresa   INTEGER,
  action       TEXT NOT NULL,                             -- 'create' | 'download' | 'restore_start' | 'restore_ok' | 'restore_fail' | 'delete'
  ator         TEXT,                                      -- login do usuário (ou 'master:xxx')
  ip           TEXT,
  user_agent   TEXT,
  detalhes     TEXT,                                      -- JSON com detalhes do contexto
  duracao_ms   INTEGER DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'ok',                -- 'ok' | 'erro'
  erro         TEXT,
  dt_log       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_emp_data ON backup_logs(id_empresa, dt_log DESC);
CREATE INDEX IF NOT EXISTS idx_backup_logs_backup   ON backup_logs(id_backup);
CREATE INDEX IF NOT EXISTS idx_backup_logs_action   ON backup_logs(action);

-- 3) Configuração de retenção por empresa (parâmetros leves) -------------------
-- Reaproveita tabela `parametros` quando existir (chave-valor); senão cria mini-tabela.
-- Sem FK para companies — preciso permitir id_empresa=0 (sentinela global do master)
-- Limpeza órfã é responsabilidade do app (DELETE cascata feito em tempo de delete-empresa).
CREATE TABLE IF NOT EXISTS backup_config (
  id_empresa            INTEGER PRIMARY KEY,              -- 1 linha por empresa; 0 = global (master)
  max_backups           INTEGER NOT NULL DEFAULT 10,      -- retenção: quantidade máxima de backups mantidos
  auto_enabled          INTEGER NOT NULL DEFAULT 0,       -- 0=off | 1=on (cron precisa estar ativo)
  auto_frequencia       TEXT NOT NULL DEFAULT 'diario',   -- 'diario' | 'semanal' | 'mensal'
  auto_hora_utc         INTEGER NOT NULL DEFAULT 3,       -- 0..23 (default 03:00 UTC = 00:00 BRT)
  ultima_execucao       TEXT,
  proxima_execucao      TEXT,
  dt_atualizacao        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Linhas default para empresas existentes (não falha se já existir)
INSERT OR IGNORE INTO backup_config (id_empresa, max_backups, auto_enabled)
SELECT id_empresa, 10, 0 FROM companies;

-- Linha "global" (id_empresa=0) para master controlar backup global
INSERT OR IGNORE INTO backup_config (id_empresa, max_backups, auto_enabled)
VALUES (0, 5, 0);
