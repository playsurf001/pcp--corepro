-- ============================================================================
-- 0032_multi_tenant_hardening.sql
-- HOTFIX SaaS Multi-Tenant — Hardening de isolamento por empresa
--
-- CONTEXTO:
--   Empresas secundárias (id_empresa > 1) estavam recebendo HTTP 500 ao
--   tentar criar remessas. Causa raiz: helper `resolveColorId` em
--   src/routes/terceirizacao.ts linha 1835 era chamado SEM o argumento
--   id_empresa, caindo no default=1. Resultado:
--     1. Tentava criar/usar a cor na empresa 1 em vez da empresa do usuário
--     2. Violava UNIQUE(id_empresa, hex) ou criava registro órfão
--     3. SQLite lançava SQLITE_CONSTRAINT → SQLITE_ERROR → HTTP 500
--
-- ESTRATÉGIA DESTA MIGRATION:
--   Reforçar índices compostos `(id_empresa, <fk>)` para acelerar TODAS
--   as queries tenant-scoped do módulo de remessas/retornos. Os índices
--   simples em (id_empresa) e em (fk) já existem, mas o COMPOSTO permite
--   ao SQLite usar covering index sem table lookup.
--
-- IDEMPOTENTE: CREATE INDEX IF NOT EXISTS → seguro re-executar.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Índices compostos para queries do POST /terc/remessas
-- ----------------------------------------------------------------------------

-- Lookup de terceirizado dentro da empresa (linha 1755)
CREATE INDEX IF NOT EXISTS idx_terc_terc_emp_id
  ON terc_terceirizados(id_empresa, id_terc);

-- Lookup de serviço dentro da empresa (foreign key validation futura)
CREATE INDEX IF NOT EXISTS idx_terc_serv_emp_id
  ON terc_servicos(id_empresa, id_servico);

-- Cabeçalho da remessa: busca por num_controle dentro da empresa
CREATE INDEX IF NOT EXISTS idx_terc_remessas_emp_num
  ON terc_remessas(id_empresa, num_controle);

-- Itens da remessa: busca por id_remessa dentro da empresa (tenant join)
CREATE INDEX IF NOT EXISTS idx_terc_rem_itens_emp_rem
  ON terc_remessa_itens(id_empresa, id_remessa);

-- Grade por item da remessa (id_item escopado por empresa)
CREATE INDEX IF NOT EXISTS idx_terc_rem_item_grade_emp_item
  ON terc_remessa_item_grade(id_empresa, id_item);

-- Grade legado da remessa
CREATE INDEX IF NOT EXISTS idx_terc_rem_grade_emp_rem
  ON terc_remessa_grade(id_empresa, id_remessa);

-- ----------------------------------------------------------------------------
-- 2) Índices para retornos (mesma lógica)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_terc_ret_emp_rem
  ON terc_retornos(id_empresa, id_remessa);

CREATE INDEX IF NOT EXISTS idx_terc_ret_itens_emp_ret
  ON terc_retorno_itens(id_empresa, id_retorno);

CREATE INDEX IF NOT EXISTS idx_terc_ret_item_grade_emp_item
  ON terc_retorno_item_grade(id_empresa, id_ret_item);

-- ----------------------------------------------------------------------------
-- 3) Índices para cores (lookup do resolveColorId)
-- ----------------------------------------------------------------------------
-- Já existe `idx_cores_empresa_nome_unique` mas garantimos covering index
-- para ativo + ordem (lista de cores em dropdown)
CREATE INDEX IF NOT EXISTS idx_cores_emp_ativo_ordem
  ON cores(id_empresa, ativo, ordem);

-- ----------------------------------------------------------------------------
-- 4) Auditoria: garante integridade de id_empresa em linhas históricas
--    (defensivo — em produção todas as linhas devem ter id_empresa > 0)
-- ----------------------------------------------------------------------------
UPDATE terc_remessas       SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_remessa_itens  SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_remessa_grade  SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_remessa_item_grade SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_retornos       SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_retorno_itens  SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_retorno_grade  SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_retorno_item_grade SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE cores               SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_terceirizados  SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_servicos       SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_produtos       SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_precos         SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_grades_tamanho SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_colecoes       SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_setores        SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_eventos        SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;

-- ============================================================================
-- FIM 0032
-- ============================================================================
