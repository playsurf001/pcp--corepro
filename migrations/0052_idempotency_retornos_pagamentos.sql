-- =====================================================================
-- 0052_idempotency_retornos_pagamentos.sql
-- HOTFIX 0067 — Estende proteção anti-duplo-POST a Retornos e Pagamentos
--
-- CONTEXTO:
--   O HOTFIX 0066 protegeu apenas remessas. A auditoria completa mostrou
--   que duplicatas em remessas se propagam para retornos e depois para
--   pagamentos (2 pares confirmados: CTRL 297/312 pago 2× no id_pag=18;
--   CTRL 1784/1785 pago 2× no id_pag=62). Total pago em duplicidade
--   identificado: R$ 59,40.
--
-- SOLUÇÃO:
--   Mesma estratégia da migration 0051: coluna idempotency_key NULL-able
--   + UNIQUE INDEX PARCIAL escopado por id_empresa.
--
-- ESCOPO:
--   • terc_retornos.idempotency_key     — deduplica POST /terc/retornos
--   • payments_terc.idempotency_key     — deduplica POST /payments-terc
--
-- COMPATIBILIDADE:
--   Coluna NULL-able. Índice UNIQUE parcial ignora todas as linhas
--   existentes (retornos e pagamentos). Backward compatible.
--
-- MULTI-TENANT:
--   Índice composto (id_empresa, idempotency_key) — empresas diferentes
--   podem reutilizar UUIDs sem conflito.
--
-- ZERO DELETE. ZERO ALTERAÇÃO DE DADOS EXISTENTES.
-- =====================================================================

-- 1) terc_retornos
ALTER TABLE terc_retornos ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_retornos_idem
  ON terc_retornos (id_empresa, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_retornos_idem
  ON terc_retornos (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 2) payments_terc
ALTER TABLE payments_terc ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_terc_idem
  ON payments_terc (id_empresa, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_terc_idem
  ON payments_terc (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
