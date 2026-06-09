-- ============================================================================
-- 0049_servicos_unique_per_tenant.sql
-- HOTFIX 0049 — Padronização de Serviços (Multi-Tenant)
--
-- CONTEXTO:
--   A tabela terc_servicos foi criada na migration 0004 com:
--       desc_servico TEXT NOT NULL UNIQUE
--   Esse UNIQUE é GLOBAL (sem id_empresa).
--
-- LIMITAÇÃO TÉCNICA CONHECIDA (D1):
--   Não é possível remover a UNIQUE global agora sem rebuild físico das 4
--   tabelas que possuem FK para terc_servicos(id_servico):
--     - terc_precos
--     - terc_produtos
--     - terc_remessa_itens
--     - terc_remessas
--   O D1 da Cloudflare:
--     - Não honra PRAGMA foreign_keys=OFF em migrations (sempre permanece ON)
--     - Bloqueia BEGIN/COMMIT explícitos (exige Workers state.storage API)
--     - Bloqueia PRAGMA writable_schema=1 com SQLITE_AUTH
--   A migration 0037 documenta exatamente esse mesmo dilema para terc_setores
--   e adota o mesmo workaround pragmático.
--
--   O rebuild físico das 5 tabelas (terc_servicos + dependentes) será feito
--   em sprint futura dedicada, com janela de manutenção.
--
-- ESCOPO REAL DESTA MIGRATION:
--   1) ADICIONAR índice UNIQUE composto (id_empresa, LOWER(desc_servico))
--      → Nova capability: dentro da mesma empresa, "Aparar" e "APARAR" passam
--        a ser tratados como duplicata (antes só batia caso-sensitive).
--      → Empresas distintas com mesmo nome ainda esbarram no UNIQUE global —
--        o app retorna 409 com mensagem amigável sugerindo variação.
--   2) Garantir que o índice idx_terc_servicos_empresa exista (defensivo).
--
-- IDEMPOTÊNCIA:
--   CREATE INDEX IF NOT EXISTS em todos os passos.
-- ============================================================================

-- Índice UNIQUE composto case-insensitive POR EMPRESA
-- Convive com o sqlite_autoindex_terc_servicos_1 (UNIQUE global em desc_servico)
-- sem conflito: SQLite permite múltiplos índices UNIQUE sobre a mesma coluna.
CREATE UNIQUE INDEX IF NOT EXISTS ux_terc_servicos_emp_desc
  ON terc_servicos(id_empresa, LOWER(desc_servico));

-- Defensivo: garantir índice tenant scoping
CREATE INDEX IF NOT EXISTS idx_terc_servicos_empresa
  ON terc_servicos(id_empresa);
