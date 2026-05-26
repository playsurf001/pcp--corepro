-- ============================================================================
-- Migration 0036 — Backfill de produtos órfãos referenciados em remessas legadas
-- ============================================================================
-- CONTEXTO:
--   A migration 0035 reconstruiu os itens das remessas a partir do header,
--   mas deixou id_produto=NULL porque o header legado só tem cod_ref (string).
--   Como o frontend depende de id_produto para popular o <select> "Produto"
--   ao abrir o modal de edição, e a Empresa Principal (E1) tem 125 cod_refs
--   referenciados em remessas que NUNCA foram cadastrados em terc_produtos,
--   o modal abre vazio (produto não selecionado → grade/preço/serviço caem).
--
-- CORREÇÃO (idempotente, tenant-scoped, multi-tenant safe):
--   1) Para cada (id_empresa, cod_ref) presente em terc_remessas mas AUSENTE
--      em terc_produtos da mesma empresa, cria o produto "legado" automatic.
--   2) Faz UPDATE de id_produto nos itens órfãos correlacionando por
--      (cod_ref, id_empresa).
--   3) Garante id_empresa NOT NULL em terc_produtos.
--   4) Garante observação de origem para auditabilidade.
-- ============================================================================

-- 1) AUTO-CADASTRO DOS PRODUTOS ÓRFÃOS (1 produto por cod_ref por empresa)
INSERT INTO terc_produtos (
  cod_ref, desc_ref, nome_produto, id_colecao, grade_padrao,
  observacao, ativo, dt_criacao, criado_por,
  id_servico_padrao, tempo_padrao, id_empresa
)
SELECT
  src.cod_ref,
  COALESCE(NULLIF(TRIM(src.desc_ref), ''), '[legado] ' || src.cod_ref) AS desc_ref,
  COALESCE(NULLIF(TRIM(src.desc_ref), ''), '[legado] ' || src.cod_ref) AS nome_produto,
  NULL AS id_colecao,
  COALESCE(src.grade, 1) AS grade_padrao,
  '[Reparação automática 0036] Produto auto-cadastrado a partir de remessas legadas (cod_ref órfão).' AS observacao,
  1 AS ativo,
  datetime('now') AS dt_criacao,
  'migration_0036' AS criado_por,
  src.id_servico AS id_servico_padrao,
  src.tempo_peca AS tempo_padrao,
  src.id_empresa
FROM (
  SELECT
    r.cod_ref,
    MIN(r.desc_ref) AS desc_ref,
    MIN(r.grade) AS grade,
    MIN(r.id_servico) AS id_servico,
    MIN(r.tempo_peca) AS tempo_peca,
    r.id_empresa
  FROM terc_remessas r
  WHERE r.cod_ref IS NOT NULL
    AND TRIM(r.cod_ref) <> ''
  GROUP BY r.id_empresa, r.cod_ref
) src
WHERE NOT EXISTS (
  SELECT 1 FROM terc_produtos p
   WHERE p.cod_ref = src.cod_ref
     AND p.id_empresa = src.id_empresa
);

-- 2) BACKFILL DE id_produto NOS ITENS DAS REMESSAS
-- Vincula itens.id_produto com o terc_produtos correspondente (cod_ref + id_empresa)
UPDATE terc_remessa_itens
SET id_produto = (
  SELECT p.id_produto
    FROM terc_produtos p
   WHERE p.cod_ref = terc_remessa_itens.cod_ref
     AND p.id_empresa = terc_remessa_itens.id_empresa
   ORDER BY p.ativo DESC, p.id_produto DESC
   LIMIT 1
)
WHERE id_produto IS NULL
  AND cod_ref IS NOT NULL
  AND TRIM(cod_ref) <> '';

-- 3) (terc_retorno_itens NÃO possui coluna id_produto — pular backfill nessa tabela)

-- 4) Backfill defensivo de id_empresa em produtos legados sem tenant
UPDATE terc_produtos SET id_empresa = 1 WHERE id_empresa IS NULL;

-- 5) Índices adicionais para performance do lookup por (cod_ref, id_empresa)
CREATE INDEX IF NOT EXISTS idx_terc_produtos_emp_cod
  ON terc_produtos (id_empresa, cod_ref);
CREATE INDEX IF NOT EXISTS idx_terc_rem_itens_emp_codref
  ON terc_remessa_itens (id_empresa, cod_ref);
