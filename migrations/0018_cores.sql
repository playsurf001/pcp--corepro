-- ============================================================
-- 0018: Tabela cores — gerenciamento centralizado de cores
-- ============================================================
-- Permite cadastro, edição, importação em massa de cores usadas
-- pelo sistema (remessas, produtos, retornos, filtros, relatórios,
-- etiquetas, romaneios).
--
-- Regras:
--   - nome: único (case-insensitive via UNIQUE INDEX em LOWER(nome))
--   - hex: único (case-insensitive, sempre armazenado em UPPERCASE
--     normalizado para #RRGGBB pelo backend)
--   - ativo: 1 (default) / 0 — cores inativas não aparecem em selects
--   - ordem: para ordenação manual (default 0 → ordena por nome)
-- ============================================================

CREATE TABLE IF NOT EXISTS cores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT    NOT NULL,
  hex         TEXT    NOT NULL,  -- formato #RRGGBB (sempre uppercase)
  ativo       INTEGER NOT NULL DEFAULT 1,
  ordem       INTEGER NOT NULL DEFAULT 0,
  criado_em   DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Índices únicos case-insensitive (SQLite usa COLLATE NOCASE)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cores_nome_unique ON cores (nome COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cores_hex_unique  ON cores (hex  COLLATE NOCASE);
CREATE INDEX        IF NOT EXISTS idx_cores_ativo       ON cores (ativo);

-- Seed inicial com cores básicas (idempotente via INSERT OR IGNORE)
INSERT OR IGNORE INTO cores (nome, hex, ativo, ordem) VALUES
  ('Branco',      '#FFFFFF', 1, 1),
  ('Preto',       '#000000', 1, 2),
  ('Cinza',       '#9CA3AF', 1, 3),
  ('Azul Royal',  '#2563EB', 1, 4),
  ('Azul Marinho','#1E3A8A', 1, 5),
  ('Vermelho',    '#DC2626', 1, 6),
  ('Verde',       '#16A34A', 1, 7),
  ('Amarelo',     '#EAB308', 1, 8),
  ('Laranja',     '#F97316', 1, 9),
  ('Rosa',        '#EC4899', 1, 10),
  ('Roxo',        '#9333EA', 1, 11),
  ('Bege',        '#D6CCB1', 1, 12),
  ('Marrom',      '#78350F', 1, 13);
