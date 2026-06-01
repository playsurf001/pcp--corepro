-- =============================================================================
-- Migration 0042 — MÓDULO DE PAGAMENTOS DE TERCEIRIZADOS
-- =============================================================================
-- Cria o módulo financeiro para gestão dos pagamentos dos retornos:
--
--   • payments_terc          — cabeçalho de cada pagamento (1 ou N retornos)
--   • payment_terc_items     — vínculo retorno ↔ pagamento + valor pago no item
--
-- Compatibilidade preservada:
--   • terc_retornos.dt_pagamento continua sendo a FONTE DE VERDADE de "está pago?"
--     (todas as queries de relatórios/dashboard/exportações dependem dela).
--   • Adicionamos terc_retornos.id_pagamento (FK opcional) para vincular ao registro
--     de pagamento — permite histórico, comprovante e estorno.
--   • Quando um retorno NÃO tem id_pagamento mas tem dt_pagamento (dados legados),
--     ele continua aparecendo como "Pago" e simplesmente não tem comprovante PDF
--     vinculado — backward-compatible.
--
-- Multi-tenant: tudo com id_empresa NOT NULL DEFAULT 1, mesmo padrão de 0021.
--
-- Auditoria: todos os endpoints registram em `auditoria` (que já tem id_empresa).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Tabela principal: payments_terc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments_terc (
  id_pagamento     INTEGER PRIMARY KEY AUTOINCREMENT,
  id_empresa       INTEGER NOT NULL DEFAULT 1,
  id_terc          INTEGER NOT NULL,
  dt_pagamento     TEXT    NOT NULL,          -- YYYY-MM-DD
  valor_total      REAL    NOT NULL DEFAULT 0,
  qtd_retornos     INTEGER NOT NULL DEFAULT 0,
  qtd_pecas_boas   INTEGER NOT NULL DEFAULT 0,
  forma_pagamento  TEXT    NOT NULL DEFAULT 'PIX',
  observacao       TEXT,
  status           TEXT    NOT NULL DEFAULT 'Confirmado'
                          CHECK (status IN ('Confirmado','Estornado')),
  usuario          TEXT,                       -- login do usuário que efetuou
  ip_origem        TEXT,                       -- IP de quem registrou (auditoria)
  estornado_por    TEXT,
  dt_estorno       TEXT,
  motivo_estorno   TEXT,
  dt_criacao       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_terc) REFERENCES terc_terceirizados(id_terc)
);

CREATE INDEX IF NOT EXISTS idx_payments_terc_emp     ON payments_terc(id_empresa);
CREATE INDEX IF NOT EXISTS idx_payments_terc_terc    ON payments_terc(id_empresa, id_terc);
CREATE INDEX IF NOT EXISTS idx_payments_terc_dt      ON payments_terc(id_empresa, dt_pagamento DESC);
CREATE INDEX IF NOT EXISTS idx_payments_terc_status  ON payments_terc(id_empresa, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Itens: vincula cada retorno pago ao pagamento
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_terc_items (
  id_payment_item  INTEGER PRIMARY KEY AUTOINCREMENT,
  id_pagamento     INTEGER NOT NULL,
  id_empresa       INTEGER NOT NULL DEFAULT 1,
  id_retorno       INTEGER NOT NULL,
  valor            REAL    NOT NULL DEFAULT 0,
  dt_criacao       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_pagamento) REFERENCES payments_terc(id_pagamento) ON DELETE CASCADE,
  FOREIGN KEY (id_retorno)   REFERENCES terc_retornos(id_retorno)   ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payment_terc_items_pag ON payment_terc_items(id_empresa, id_pagamento);
CREATE INDEX IF NOT EXISTS idx_payment_terc_items_ret ON payment_terc_items(id_empresa, id_retorno);

-- Garantia: 1 retorno só pode estar em 1 pagamento ativo (mesma empresa).
-- Em estorno, o registro permanece em payment_terc_items mas o pagamento fica
-- como status='Estornado' e dt_pagamento do retorno é zerado — o frontend
-- filtra por status='Confirmado' nas queries de "está pago?".
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_terc_items_retorno
  ON payment_terc_items(id_empresa, id_retorno);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Vincular retornos ao pagamento (opcional — backward-compatible)
--    SQLite ALTER TABLE ADD COLUMN é suportado e idempotente via try/catch no app.
--    Aqui não usamos IF NOT EXISTS porque SQLite não suporta para ALTER.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE terc_retornos ADD COLUMN id_pagamento INTEGER REFERENCES payments_terc(id_pagamento);
CREATE INDEX IF NOT EXISTS idx_terc_ret_pagamento ON terc_retornos(id_empresa, id_pagamento);
