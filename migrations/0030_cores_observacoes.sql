-- ============================================================
-- 0030 — Módulo de Cores: enriquecimento + integração
-- ============================================================
-- Adiciona campo de observações ao cadastro de cores e índices para
-- contagem rápida de vínculos. Não altera dados existentes.
-- IDEMPOTENTE: ALTER TABLE ADD COLUMN + CREATE INDEX IF NOT EXISTS.
-- ============================================================

-- 1) Coluna observacoes (texto livre, opcional)
ALTER TABLE cores ADD COLUMN observacoes TEXT;

-- 2) Índices para acelerar JOIN/COUNT de vínculos (todas as 4 tabelas
--    que referenciam id_cor). IF NOT EXISTS torna idempotente.
CREATE INDEX IF NOT EXISTS idx_precos_id_cor          ON terc_precos(id_cor);
CREATE INDEX IF NOT EXISTS idx_var_id_cor             ON terc_produto_variacoes(id_cor);
CREATE INDEX IF NOT EXISTS idx_remessa_itens_id_cor   ON terc_remessa_itens(id_cor);
CREATE INDEX IF NOT EXISTS idx_retorno_itens_id_cor   ON terc_retorno_itens(id_cor);

-- 3) Índice para filtro por status (ativo) por empresa
CREATE INDEX IF NOT EXISTS idx_cores_ativo_empresa    ON cores(id_empresa, ativo);
