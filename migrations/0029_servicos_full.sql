-- =====================================================================
-- MIGRATION 0029 — Módulo de Serviços completo
-- =====================================================================
-- Enriquece a tabela terc_servicos com campos profissionais:
--   - descricao        : descrição livre do serviço
--   - categoria        : agrupamento (Costura, Acabamento, Estamparia...)
--   - cor              : HEX (#RRGGBB) para identificação visual
--   - preco_padrao     : valor padrão (R$) — usado como sugestão em preços
--   - tempo_padrao     : tempo padrão (min) — usado como sugestão em produtos
--   - observacoes      : notas internas
--   - dt_alteracao     : auditoria
--
-- IDEMPOTÊNCIA: usa ALTER TABLE ADD COLUMN (D1/SQLite). Se a coluna já
-- existir, o comando falha — por isso esta migração só roda 1 vez.
--
-- ATENÇÃO: os dados existentes (3 serviços em PROD: 'Aparar peça',
-- 'Embalagem', 'Estamparia') são preservados. Campos novos ficam NULL
-- até o usuário editar. A categoria padrão é deduzida do nome no
-- backfill abaixo.
-- =====================================================================

ALTER TABLE terc_servicos ADD COLUMN descricao TEXT;
ALTER TABLE terc_servicos ADD COLUMN categoria TEXT;
ALTER TABLE terc_servicos ADD COLUMN cor TEXT;
ALTER TABLE terc_servicos ADD COLUMN preco_padrao REAL;
ALTER TABLE terc_servicos ADD COLUMN tempo_padrao REAL;
ALTER TABLE terc_servicos ADD COLUMN observacoes TEXT;
ALTER TABLE terc_servicos ADD COLUMN dt_alteracao TEXT;

-- Backfill heurístico de categoria + cor para os serviços existentes:
-- - Estamparia → roxo
-- - Embalagem → azul
-- - Aparar / Corte → laranja
-- - Costura → verde
-- - Demais → cinza claro
UPDATE terc_servicos
   SET categoria = CASE
         WHEN LOWER(desc_servico) LIKE '%estampa%' THEN 'Estamparia'
         WHEN LOWER(desc_servico) LIKE '%embala%'  THEN 'Acabamento'
         WHEN LOWER(desc_servico) LIKE '%aparar%' OR LOWER(desc_servico) LIKE '%corte%' THEN 'Corte'
         WHEN LOWER(desc_servico) LIKE '%costur%' OR LOWER(desc_servico) LIKE '%overlo%' OR LOWER(desc_servico) LIKE '%fechament%' THEN 'Costura'
         WHEN LOWER(desc_servico) LIKE '%bord%' THEN 'Bordado'
         WHEN LOWER(desc_servico) LIKE '%lavand%' OR LOWER(desc_servico) LIKE '%lavage%' THEN 'Lavanderia'
         WHEN LOWER(desc_servico) LIKE '%passad%' OR LOWER(desc_servico) LIKE '%ferro%' THEN 'Acabamento'
         ELSE 'Geral'
       END,
       cor = CASE
         WHEN LOWER(desc_servico) LIKE '%estampa%' THEN '#8B5CF6'
         WHEN LOWER(desc_servico) LIKE '%embala%'  THEN '#2563EB'
         WHEN LOWER(desc_servico) LIKE '%aparar%' OR LOWER(desc_servico) LIKE '%corte%' THEN '#F97316'
         WHEN LOWER(desc_servico) LIKE '%costur%' OR LOWER(desc_servico) LIKE '%overlo%' OR LOWER(desc_servico) LIKE '%fechament%' THEN '#10B981'
         WHEN LOWER(desc_servico) LIKE '%bord%' THEN '#EC4899'
         WHEN LOWER(desc_servico) LIKE '%lavand%' OR LOWER(desc_servico) LIKE '%lavage%' THEN '#0EA5E9'
         WHEN LOWER(desc_servico) LIKE '%passad%' OR LOWER(desc_servico) LIKE '%ferro%' THEN '#F59E0B'
         ELSE '#64748B'
       END,
       dt_alteracao = COALESCE(dt_alteracao, dt_criacao)
 WHERE categoria IS NULL;

-- Índice para filtros rápidos por categoria
CREATE INDEX IF NOT EXISTS idx_servicos_categoria ON terc_servicos(id_empresa, categoria);
CREATE INDEX IF NOT EXISTS idx_servicos_ativo     ON terc_servicos(id_empresa, ativo);
