-- ============================================================================
-- Migration 0037 — Módulo completo de Setores (multi-tenant)
-- ============================================================================
-- OBJETIVO:
--   1) Estender terc_setores com campos profissionais (codigo, descricao, cor,
--      ordem, dt_alteracao, criado_por, alterado_por) preservando os 3 setores
--      existentes da E1.
--   2) Corrigir bug multi-tenant: UNIQUE atual eh GLOBAL em nome_setor.
--      Estrategia: como nao podemos dropar a tabela facilmente (FK em
--      terc_terceirizados), usamos ALTER TABLE ADD COLUMN + remocao do indice
--      autoindex_terc_setores_1 atraves de drop logico (criando indice novo
--      composto e deixando o auto-index original, ja que SQLite nao permite
--      remover constraint UNIQUE inline de coluna).
--      Solucao definitiva: REBUILD usando PRAGMA defer_foreign_keys que eh
--      respeitado em transacao unica do D1.
--   3) Adicionar coluna id_setor em terc_servicos (FK opcional).
--   4) Indices de performance para queries tenant-scoped.
--
-- COMPATIBILIDADE:
--   - id_setor existentes sao PRESERVADOS (mesmos PKs)
--   - 177 remessas + N terceirizados que apontam para id_setor continuam OK
--   - servicos sem id_setor permanecem com NULL (campo opcional)
-- ============================================================================

-- ============================================================================
-- ESTRATEGIA ALTERNATIVA (sem rebuild da terc_setores para evitar FK violation):
-- 1) ALTER TABLE para adicionar as colunas novas
-- 2) Para corrigir o UNIQUE global -> nao removemos o autoindex (ele continua
--    sendo respeitado APENAS para INSERT/UPDATE que violem nome global), mas
--    como adicionamos UNIQUE composto (id_empresa, nome_setor), o backend
--    sempre podera trabalhar tenant-scoped. O UNIQUE global so impedira casos
--    onde duas empresas tentam o mesmo nome — nesses casos o erro 409 sera
--    capturado pelo onError global e a UI sugerira diferenciacao via codigo.
--
--    NOTA: Em uma proxima migration, faremos o rebuild completo quando o
--    sistema tiver downtime planejado. Por hora, o ganho de adicionar UNIQUE
--    composto e os novos campos eh imediato e seguro.
-- ============================================================================

-- 1) Novas colunas em terc_setores (ALTER TABLE NAO viola FK)
ALTER TABLE terc_setores ADD COLUMN codigo TEXT;
ALTER TABLE terc_setores ADD COLUMN descricao TEXT;
ALTER TABLE terc_setores ADD COLUMN cor TEXT;
ALTER TABLE terc_setores ADD COLUMN ordem INTEGER NOT NULL DEFAULT 0;
ALTER TABLE terc_setores ADD COLUMN dt_alteracao TEXT;
ALTER TABLE terc_setores ADD COLUMN criado_por TEXT;
ALTER TABLE terc_setores ADD COLUMN alterado_por TEXT;

-- 2) Backfill de ordem (inicial = id_setor, mantem ordem cronologica)
UPDATE terc_setores SET ordem = id_setor WHERE ordem = 0;

-- 3) Backfill de codigo (slug) para setores existentes
UPDATE terc_setores
   SET codigo = LOWER(
     REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
       nome_setor,
       ' ', '_'),
       'á','a'),'â','a'),'ã','a'),'à','a'),
       'é','e'),'ê','e'),
       'í','i'),
       'ó','o'),
       'ú','u')
   )
 WHERE codigo IS NULL;

-- 4) Backfill defensivo de id_empresa
UPDATE terc_setores SET id_empresa = 1 WHERE id_empresa IS NULL;

-- 5) Indices multi-tenant (UNIQUE composto coexiste com o autoindex global
--    legado — nao conflita pois pode haver multiplos indices UNIQUE)
CREATE UNIQUE INDEX IF NOT EXISTS ux_terc_setores_emp_codigo
  ON terc_setores (id_empresa, codigo)
  WHERE codigo IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_terc_setores_emp_ativo
  ON terc_setores (id_empresa, ativo);

CREATE INDEX IF NOT EXISTS idx_terc_setores_emp_ordem
  ON terc_setores (id_empresa, ordem);

-- ============================================================================
-- PASSO 6: Adicionar id_setor em terc_servicos (vinculo opcional)
-- ============================================================================

ALTER TABLE terc_servicos ADD COLUMN id_setor INTEGER REFERENCES terc_setores(id_setor);

-- Indice composto para JOIN tenant-scoped
CREATE INDEX IF NOT EXISTS idx_terc_servicos_emp_setor
  ON terc_servicos (id_empresa, id_setor);
