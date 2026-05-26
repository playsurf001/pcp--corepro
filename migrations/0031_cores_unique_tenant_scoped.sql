-- ============================================================
-- 0031 — Fix multi-tenant: UNIQUE (nome,hex) por empresa
-- ============================================================
-- BUG CRÍTICO: os índices UNIQUE atuais (nome) e (hex) são globais,
-- impedindo que duas empresas diferentes cadastrem cores com mesmo
-- nome ou mesmo HEX. Em SaaS multi-tenant isso é incorreto — cada
-- empresa deve ter seu próprio cadastro isolado.
--
-- CORREÇÃO: dropar índices globais e recriar como compostos:
--   UNIQUE (id_empresa, nome COLLATE NOCASE)
--   UNIQUE (id_empresa, hex  COLLATE NOCASE)
--
-- COMPATIBILIDADE: como o sistema sempre filtrou por id_empresa,
-- nenhum dado existente viola a nova restrição. Dados atuais (40
-- cores na empresa 1 em PROD) são preservados intactos.
--
-- IDEMPOTÊNCIA: DROP INDEX IF EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
-- ============================================================

-- 1) Dropa os índices UNIQUE globais antigos
DROP INDEX IF EXISTS idx_cores_nome_unique;
DROP INDEX IF EXISTS idx_cores_hex_unique;

-- 2) Cria novos UNIQUE escopados por tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_cores_empresa_nome_unique
  ON cores (id_empresa, nome COLLATE NOCASE);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cores_empresa_hex_unique
  ON cores (id_empresa, hex  COLLATE NOCASE);
