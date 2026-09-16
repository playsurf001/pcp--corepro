-- =====================================================================
-- 0051_idempotency_remessas.sql
-- HOTFIX 0066 — Proteção contra duplicação de remessas (duplo POST / retry)
--
-- CONTEXTO:
--   Foi identificado no banco pelo menos 1 par de remessas duplicadas
--   criadas com 3 segundos de diferença (CTRL 1784/1785, mesma OP,
--   mesmo terceirizado, mesma cor, mesma quantidade). Assinatura clássica
--   de duplo clique no botão "Salvar" ou retry automático do cliente.
--
-- SOLUÇÃO:
--   Adicionar coluna opcional `idempotency_key` em terc_remessas.
--   O frontend envia um UUID único por clique (mesmo header
--   "Idempotency-Key" reenviado se o cliente refizer a chamada).
--   O backend:
--     1) Antes de inserir, procura por remessa da MESMA empresa com
--        mesmo idempotency_key.
--     2) Se encontrar, devolve o resultado existente sem inserir de novo.
--     3) Se não encontrar, insere gravando idempotency_key na linha.
--
-- MULTI-TENANT:
--   O índice UNIQUE é composto (id_empresa, idempotency_key) — empresas
--   diferentes podem reutilizar UUIDs (na prática nunca colidem).
--
-- COMPATIBILIDADE:
--   Coluna é NULL-able. Registros existentes ficam com NULL.
--   O índice UNIQUE é PARCIAL: só se aplica quando idempotency_key IS NOT NULL.
--   Isso significa que NÃO afeta as ~2200 remessas já existentes.
--   Clientes antigos que não enviarem o header continuam funcionando
--   (mas sem proteção contra duplicação — atualize o frontend).
--
-- SEM DELETE. SEM DROP. SEM ALTERAÇÃO DE DADOS EXISTENTES.
-- =====================================================================

-- 1) Adicionar coluna
ALTER TABLE terc_remessas ADD COLUMN idempotency_key TEXT;

-- 2) Índice UNIQUE parcial (só linhas com idempotency_key preenchido)
--    Escopo: (id_empresa, idempotency_key) — multi-tenant safe.
CREATE UNIQUE INDEX IF NOT EXISTS ux_remessas_idem
  ON terc_remessas (id_empresa, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3) Índice auxiliar para lookup rápido (sem UNIQUE)
--    Alguns dialects não otimizam UNIQUE parcial para SELECT — este ajuda.
CREATE INDEX IF NOT EXISTS idx_remessas_idem
  ON terc_remessas (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
