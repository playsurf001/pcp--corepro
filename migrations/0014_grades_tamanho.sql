-- =================================================================
-- Migration 0014 — Grades de Tamanho dinâmicas
-- =================================================================
-- Objetivo: substituir a lista fixa ['PP','P','M','G','GG','EG','XG','UN','TAM1','TAM2']
-- por grades configuráveis pelo usuário em Configurações → Grades de Tamanho.
--
-- Cada grade tem um nome (ex.: "Padrão Adulto", "Numérico 34-42", "Infantil")
-- e uma lista ordenada de tamanhos (CSV) — ex.: "PP,P,M,G,GG".
--
-- Comportamento:
--   - 1 grade pode ser marcada como `is_default` (apenas uma por vez).
--   - As remessas continuam armazenando os tamanhos diretamente em
--     terc_remessa_item_grade(tamanho), portanto nenhuma quebra de schema.
--   - Apenas a UI passa a oferecer grades sob demanda.
-- =================================================================

CREATE TABLE IF NOT EXISTS terc_grades_tamanho (
  id_grade      INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL UNIQUE,
  tamanhos      TEXT NOT NULL,            -- CSV ordenado, ex.: "PP,P,M,G,GG"
  descricao     TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0,
  ativo         INTEGER NOT NULL DEFAULT 1,
  dt_criacao    DATETIME DEFAULT CURRENT_TIMESTAMP,
  dt_alteracao  DATETIME,
  criado_por    TEXT
);

CREATE INDEX IF NOT EXISTS idx_terc_grade_default ON terc_grades_tamanho(is_default);
CREATE INDEX IF NOT EXISTS idx_terc_grade_ativo   ON terc_grades_tamanho(ativo);

-- =================================================================
-- Seed: grades padrão para começar
-- =================================================================
INSERT OR IGNORE INTO terc_grades_tamanho (nome, tamanhos, descricao, is_default, ativo) VALUES
  ('Padrão Adulto',         'PP,P,M,G,GG',         'Tamanhos clássicos adulto',                    1, 1),
  ('Adulto Estendido',      'PP,P,M,G,GG,EG,XG',   'Inclui tamanhos extra-grandes',                0, 1),
  ('Numérico 34-42',        '34,36,38,40,42',      'Numeração feminina/masculina',                 0, 1),
  ('Infantil',              '2,4,6,8,10,12',       'Tamanhos infantis numéricos',                  0, 1),
  ('Juvenil',               '10,12,14,16',         'Tamanhos juvenis',                             0, 1),
  ('Único',                 'U',                   'Tamanho único',                                0, 1);
