-- =====================================================================
-- SPRINT D — Webhook events log + payment fields auxiliares
-- =====================================================================
-- Objetivo:
--   1) Garantir idempotência dos webhooks do Mercado Pago (mesmo evento
--      pode chegar várias vezes — DEVE ser processado UMA vez só)
--   2) Auditar TODO webhook recebido (mesmo os ignorados/inválidos)
--   3) Indexar mp_payment_id para lookup rápido no handler
-- =====================================================================

-- 1) Tabela de eventos de webhook
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id_event         INTEGER PRIMARY KEY AUTOINCREMENT,
  gateway          TEXT    NOT NULL DEFAULT 'mercadopago',
  -- ID único do evento conforme o gateway (header x-request-id no MP)
  -- UNIQUE garante idempotência: se chegar de novo, o INSERT falha e a gente ignora
  external_id      TEXT,
  -- ID do recurso afetado (payment_id no MP)
  resource_id      TEXT,
  -- Tipo do evento (payment.created, payment.updated, etc.)
  event_type       TEXT,
  -- Action (created, updated)
  action           TEXT,
  -- Resultado do processamento: received, processed, ignored, error, replay
  status           TEXT NOT NULL DEFAULT 'received'
                   CHECK (status IN ('received','processed','ignored','error','replay')),
  -- HMAC validação
  signature_valid  INTEGER NOT NULL DEFAULT 0,
  -- Payload bruto (JSON stringified)
  payload          TEXT,
  -- Headers brutos (JSON stringified, sem Authorization)
  headers          TEXT,
  -- Resultado/erro
  resultado        TEXT,
  erro             TEXT,
  -- Referência ao payment afetado (quando match)
  id_payment       INTEGER,
  -- IP de origem (auditoria)
  ip_origem        TEXT,
  -- Timestamps
  dt_recebido      TEXT NOT NULL DEFAULT (datetime('now')),
  dt_processado    TEXT,
  duracao_ms       INTEGER,
  FOREIGN KEY (id_payment) REFERENCES payments(id_payment) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pwe_external ON payment_webhook_events(external_id);
CREATE INDEX IF NOT EXISTS idx_pwe_resource ON payment_webhook_events(resource_id);
CREATE INDEX IF NOT EXISTS idx_pwe_status   ON payment_webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_pwe_dt       ON payment_webhook_events(dt_recebido DESC);
-- Idempotência: se já recebemos esse external_id, ignoramos
CREATE UNIQUE INDEX IF NOT EXISTS uq_pwe_external_id
  ON payment_webhook_events(external_id)
  WHERE external_id IS NOT NULL;

-- 2) Índice no mp_payment_id para lookup rápido no webhook
CREATE INDEX IF NOT EXISTS idx_payments_mp_id ON payments(mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

-- 3) Adicionar coluna "gateway" ao payments (futuro: stripe, pagarme, etc.)
-- O ALTER deve ser idempotente — SQLite não tem IF NOT EXISTS no ADD COLUMN,
-- então deixamos para a aplicação detectar e ignorar se já existir.
-- Como esta migration roda apenas uma vez (graças à tabela d1_migrations),
-- isso é seguro.
ALTER TABLE payments ADD COLUMN gateway TEXT NOT NULL DEFAULT 'mercadopago';

-- 4) Backfill: subscriptions sem dt_proxima_cobranca recebem hoje+30d
--    (defensive — Sprint C já fez isso, mas garantimos para subs novas)
UPDATE subscriptions
   SET dt_proxima_cobranca = date('now', '+30 days')
 WHERE dt_proxima_cobranca IS NULL
   AND status IN ('ativa','trial','pendente');
