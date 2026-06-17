-- ============================================================
-- HOTFIX 0052 — Tabela payment_logs
-- ============================================================
-- Registra TODAS as tentativas (sucesso e falha) de criação de
-- cobranças PIX no gateway (Mercado Pago).
--
-- Objetivos:
--   1) Diagnóstico de problemas em produção (quando QR não gera)
--   2) Auditoria de quais empresas tentaram pagar/quando
--   3) Análise de falhas recorrentes (token vencido, chave PIX,
--      CNPJ inválido, indisponibilidade do gateway, etc.)
--
-- Compatível com D1 (sem TIMESTAMP DEFAULT — usa datetime('now'))
-- Multi-tenant: indexado por id_empresa.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_logs (
  id_log          INTEGER PRIMARY KEY AUTOINCREMENT,
  id_empresa      INTEGER NOT NULL,
  id_payment      INTEGER,                       -- pode ser NULL se falhar antes do INSERT em payments
  usuario_login   TEXT,                           -- registrado_por (login do usuário)
  gateway         TEXT NOT NULL DEFAULT 'mercadopago',
  acao            TEXT NOT NULL,                  -- 'create' | 'consult' | 'webhook' | 'diagnostico'
  status          TEXT NOT NULL,                  -- 'success' | 'error'
  valor           REAL,
  mp_payment_id   TEXT,
  http_status     INTEGER,                        -- HTTP status retornado pelo gateway
  erro_curto      TEXT,                           -- mensagem amigável (até 500 chars)
  payload_req     TEXT,                           -- JSON enviado ao gateway (limpo de credenciais)
  payload_res     TEXT,                           -- JSON recebido do gateway (limpo)
  ip_origem       TEXT,
  user_agent      TEXT,
  dt_criacao      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_payment_logs_empresa ON payment_logs(id_empresa, dt_criacao);
CREATE INDEX IF NOT EXISTS ix_payment_logs_payment ON payment_logs(id_payment);
CREATE INDEX IF NOT EXISTS ix_payment_logs_status  ON payment_logs(status, dt_criacao);
CREATE INDEX IF NOT EXISTS ix_payment_logs_acao    ON payment_logs(acao, dt_criacao);
