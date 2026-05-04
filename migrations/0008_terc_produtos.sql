-- Migration 0008 — Cadastro de Produtos da Terceirização
-- Centraliza referências/descrições/coleção/grade padrão para auto-fill em
-- Remessas e em Preços/Coleção. Reduz digitação e erros de cadastro.

CREATE TABLE IF NOT EXISTS terc_produtos (
  id_produto      INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_ref         TEXT    NOT NULL,
  desc_ref        TEXT    NOT NULL,
  nome_produto    TEXT,                  -- nome amigável (alternativa a desc_ref)
  id_colecao      INTEGER,
  grade_padrao    INTEGER DEFAULT 1,     -- 1 = grade única
  observacao      TEXT,
  ativo           INTEGER DEFAULT 1,
  dt_criacao      DATETIME DEFAULT CURRENT_TIMESTAMP,
  dt_alteracao    DATETIME,
  criado_por      TEXT,
  FOREIGN KEY (id_colecao) REFERENCES terc_colecoes(id_colecao)
);

-- Unicidade lógica por (referência + coleção). Coleção NULL = produto global.
CREATE UNIQUE INDEX IF NOT EXISTS ux_terc_produtos_ref_col
  ON terc_produtos (cod_ref, COALESCE(id_colecao, 0));

CREATE INDEX IF NOT EXISTS idx_terc_produtos_ativo ON terc_produtos(ativo);
CREATE INDEX IF NOT EXISTS idx_terc_produtos_cod   ON terc_produtos(cod_ref);

-- Backfill a partir de remessas existentes (gera produtos para refs já usadas)
INSERT OR IGNORE INTO terc_produtos (cod_ref, desc_ref, id_colecao, grade_padrao, ativo, criado_por)
SELECT
  r.cod_ref,
  COALESCE(MAX(r.desc_ref), r.cod_ref) AS desc_ref,
  r.id_colecao,
  COALESCE(MAX(r.grade), 1) AS grade_padrao,
  1,
  'BACKFILL'
FROM terc_remessas r
WHERE r.cod_ref IS NOT NULL AND TRIM(r.cod_ref) <> ''
GROUP BY r.cod_ref, r.id_colecao;

-- Também backfill a partir da tabela de preços (caso haja refs sem remessa)
INSERT OR IGNORE INTO terc_produtos (cod_ref, desc_ref, id_colecao, grade_padrao, ativo, criado_por)
SELECT
  p.cod_ref,
  COALESCE(MAX(p.desc_ref), p.cod_ref) AS desc_ref,
  p.id_colecao,
  COALESCE(MAX(p.grade), 1) AS grade_padrao,
  1,
  'BACKFILL'
FROM terc_precos p
WHERE p.cod_ref IS NOT NULL AND TRIM(p.cod_ref) <> ''
GROUP BY p.cod_ref, p.id_colecao;
