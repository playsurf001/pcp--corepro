-- ============================================================
-- 0019: Unificação de cores (terc_cores → cores) + FK id_cor
-- ============================================================
--
-- Objetivos:
--   1) Migrar registros de terc_cores (legada) para cores (oficial)
--      sem duplicar (chaves UNIQUE case-insensitive em nome/hex já
--      garantem isso).
--   2) Adicionar coluna id_cor INTEGER NULL (FK → cores.id) em:
--        - terc_remessa_itens     (linhas com cor TEXT)
--        - terc_retorno_itens     (linhas com cor TEXT)
--        - terc_precos            (linhas com cor TEXT — todas vazias hoje)
--        - terc_produto_variacoes (linhas com cor TEXT — tabela vazia)
--        - terc_remessas          (denormalização, filtros rápidos)
--      NOTA: terc_retornos NÃO tem coluna cor (foi removida ou nunca existiu
--      no schema atual) — id_cor de retorno fica em terc_retorno_itens.
--   3) Backfill: para cada cor TEXT existente, garantir que está
--      em `cores` (inserindo se necessário) e popular id_cor.
--   4) MANTER a coluna `cor TEXT` em todas as tabelas (espelho de
--      cores.nome) — permite rollback e leitura legada.
--   5) DROP terc_cores ao final (não usado em mais nenhuma rota).
--
-- IMPORTANTE: SQLite não suporta ADD FOREIGN KEY via ALTER TABLE,
-- então a FK fica como "lógica" (sem CONSTRAINT no schema), mas
-- as queries do backend sempre fazem JOIN/UPDATE coordenado.
--
-- Estratégia conservadora: nenhum DROP de coluna `cor` — espelho
-- mantido. Após N semanas estável, próxima migration poderá
-- remover a coluna texto se quisermos.
-- ============================================================

-- ============================================================
-- PROBLEMA RESOLVIDO: O UNIQUE INDEX em hex impedia importar
-- múltiplas cores sem hex (todas tentariam o mesmo placeholder).
--
-- SOLUÇÃO: dropar temporariamente o UNIQUE em hex, fazer todos os
-- INSERTs com hex provisório, depois UPDATE atribuindo hex único
-- determinístico baseado no ID, e por fim recriar o UNIQUE em hex.
-- ============================================================

DROP INDEX IF EXISTS idx_cores_hex_unique;

-- ============================================================
-- PASSO 1: Importar cores da tabela legada (preservando hex quando existe)
-- ============================================================
-- Para registros de terc_cores SEM hex, marcamos com placeholder
-- '#000000' temporário que será reescrito no PASSO 3.
INSERT OR IGNORE INTO cores (nome, hex, ativo)
  SELECT
    TRIM(nome_cor),
    COALESCE(NULLIF(TRIM(hex), ''), '#000000') AS hex,
    ativo
  FROM terc_cores
  WHERE nome_cor IS NOT NULL AND TRIM(nome_cor) != '';

-- ============================================================
-- PASSO 2: Garantir que TODA cor TEXT em uso esteja em `cores`
-- ============================================================
-- Insere cores referenciadas por itens/remessas/preços mas que não
-- estão ainda em `cores`. Hex provisório '#000000' (será reescrito).
-- Para NOT EXISTS case-insensitive usamos subselect com WHERE = COLLATE NOCASE
INSERT OR IGNORE INTO cores (nome, hex, ativo)
  SELECT DISTINCT TRIM(cor), '#000000', 1
  FROM terc_remessa_itens ri
  WHERE ri.cor IS NOT NULL AND TRIM(ri.cor) != ''
    AND NOT EXISTS (SELECT 1 FROM cores c WHERE c.nome = TRIM(ri.cor) COLLATE NOCASE);

INSERT OR IGNORE INTO cores (nome, hex, ativo)
  SELECT DISTINCT TRIM(cor), '#000000', 1
  FROM terc_retorno_itens ri
  WHERE ri.cor IS NOT NULL AND TRIM(ri.cor) != ''
    AND NOT EXISTS (SELECT 1 FROM cores c WHERE c.nome = TRIM(ri.cor) COLLATE NOCASE);

INSERT OR IGNORE INTO cores (nome, hex, ativo)
  SELECT DISTINCT TRIM(cor), '#000000', 1
  FROM terc_remessas r
  WHERE r.cor IS NOT NULL AND TRIM(r.cor) != ''
    AND NOT EXISTS (SELECT 1 FROM cores c WHERE c.nome = TRIM(r.cor) COLLATE NOCASE);

INSERT OR IGNORE INTO cores (nome, hex, ativo)
  SELECT DISTINCT TRIM(cor), '#000000', 1
  FROM terc_precos p
  WHERE p.cor IS NOT NULL AND TRIM(p.cor) != ''
    AND NOT EXISTS (SELECT 1 FROM cores c WHERE c.nome = TRIM(p.cor) COLLATE NOCASE);

-- ============================================================
-- PASSO 2b: Reescrever todos os hex '#000000' provisórios com
-- valores únicos determinísticos baseados no id da cor.
-- ============================================================
-- Usa printf('#%06X', id * 0x1F1F1F % 0xFFFFFF) — gera hex distinto
-- e estético para cada id (não preto puro, mas tonalidades variadas).
-- Após isso, admin pode editar os hex no painel de Cores.
UPDATE cores
  SET hex = printf('#%06X', ((id * 999983) % 16777215))
  WHERE hex = '#000000'
    AND nome NOT IN ('Preto'); -- preserva "Preto" intencional

-- Garante que NÃO haja duas cores com mesmo hex agora (validação)
-- via re-UPDATE de qualquer colisão remanescente.
UPDATE cores
  SET hex = printf('#%06X', ((id * 7919) + (id * id)) % 16777215)
  WHERE id IN (
    SELECT a.id FROM cores a
    JOIN cores b ON LOWER(a.hex) = LOWER(b.hex) AND a.id > b.id
  );

-- Recria o UNIQUE INDEX em hex (agora seguro)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cores_hex_unique
  ON cores (hex COLLATE NOCASE);

-- ============================================================
-- PASSO 3: Adicionar coluna id_cor (FK lógica) nas tabelas
-- ============================================================
-- SQLite: ADD COLUMN é não-destrutivo e idempotente via IF NOT
-- EXISTS NÃO suportado para colunas — usamos pragma_table_info no
-- backend para idempotência. Aqui assumimos primeira execução.
--
-- Trick: como SQLite não tem ADD COLUMN IF NOT EXISTS, criamos
-- via pragma. Mas como migrations são versionadas (d1_migrations
-- tem 0019 marcada como aplicada e nunca roda 2x), podemos usar
-- ALTER TABLE direto.

ALTER TABLE terc_remessa_itens     ADD COLUMN id_cor INTEGER;
ALTER TABLE terc_retorno_itens     ADD COLUMN id_cor INTEGER;
ALTER TABLE terc_precos            ADD COLUMN id_cor INTEGER;
ALTER TABLE terc_produto_variacoes ADD COLUMN id_cor INTEGER;
ALTER TABLE terc_remessas          ADD COLUMN id_cor INTEGER;

-- Índices para performance dos JOINs
CREATE INDEX IF NOT EXISTS idx_terc_remessa_itens_id_cor     ON terc_remessa_itens(id_cor);
CREATE INDEX IF NOT EXISTS idx_terc_retorno_itens_id_cor     ON terc_retorno_itens(id_cor);
CREATE INDEX IF NOT EXISTS idx_terc_precos_id_cor            ON terc_precos(id_cor);
CREATE INDEX IF NOT EXISTS idx_terc_produto_variacoes_id_cor ON terc_produto_variacoes(id_cor);
CREATE INDEX IF NOT EXISTS idx_terc_remessas_id_cor          ON terc_remessas(id_cor);

-- ============================================================
-- PASSO 4: Backfill id_cor a partir do texto cor (case-insensitive)
-- ============================================================
-- Para cada linha onde cor TEXT existe e id_cor ainda é NULL,
-- buscar em cores.nome (COLLATE NOCASE) e setar id_cor.

UPDATE terc_remessa_itens
  SET id_cor = (
    SELECT id FROM cores
    WHERE nome = TRIM(terc_remessa_itens.cor) COLLATE NOCASE
    LIMIT 1
  )
  WHERE cor IS NOT NULL AND TRIM(cor) != '' AND id_cor IS NULL;

UPDATE terc_retorno_itens
  SET id_cor = (
    SELECT id FROM cores
    WHERE nome = TRIM(terc_retorno_itens.cor) COLLATE NOCASE
    LIMIT 1
  )
  WHERE cor IS NOT NULL AND TRIM(cor) != '' AND id_cor IS NULL;

UPDATE terc_precos
  SET id_cor = (
    SELECT id FROM cores
    WHERE nome = TRIM(terc_precos.cor) COLLATE NOCASE
    LIMIT 1
  )
  WHERE cor IS NOT NULL AND TRIM(cor) != '' AND id_cor IS NULL;

UPDATE terc_produto_variacoes
  SET id_cor = (
    SELECT id FROM cores
    WHERE nome = TRIM(terc_produto_variacoes.cor) COLLATE NOCASE
    LIMIT 1
  )
  WHERE cor IS NOT NULL AND TRIM(cor) != '' AND id_cor IS NULL;

UPDATE terc_remessas
  SET id_cor = (
    SELECT id FROM cores
    WHERE nome = TRIM(terc_remessas.cor) COLLATE NOCASE
    LIMIT 1
  )
  WHERE cor IS NOT NULL AND TRIM(cor) != '' AND id_cor IS NULL;

-- ============================================================
-- PASSO 5: DROP terc_cores (legada, não mais referenciada)
-- ============================================================
-- Nenhuma rota usa terc_cores mais (a tela de Cores agora usa `cores`).
-- DELETE primeiro para liberar quaisquer FKs implícitas, depois DROP.
DELETE FROM terc_cores;
DROP TABLE IF EXISTS terc_cores;
