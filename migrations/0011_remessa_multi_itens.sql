-- =================================================================
-- 0011 — REMESSA MULTI-PRODUTOS + MULTI-CORES
-- Estrutura nova:
--   terc_remessas              (cabeçalho — já existe; usado como header)
--   terc_remessa_itens         (1 linha por produto+cor; cada cor = 1 item)
--   terc_remessa_item_grade    (1 linha por tamanho de cada item)
--
-- Compatibilidade: as colunas antigas em terc_remessas continuam preenchidas
-- com o "primeiro item" para não quebrar telas/relatórios legados.
-- =================================================================

-- Tabela de itens (cada produto+cor é 1 item)
CREATE TABLE IF NOT EXISTS terc_remessa_itens (
  id_item       INTEGER PRIMARY KEY AUTOINCREMENT,
  id_remessa    INTEGER NOT NULL,
  id_produto    INTEGER,                          -- opcional: vínculo com terc_produtos
  cod_ref       TEXT    NOT NULL,                 -- referência (denormalizada para histórico)
  desc_ref      TEXT,
  id_servico    INTEGER NOT NULL,
  cor           TEXT,                             -- cor do item (cada cor = 1 item)
  grade_num     INTEGER NOT NULL DEFAULT 1,       -- nível de grade (compatibilidade)
  qtd_total     INTEGER NOT NULL DEFAULT 0,       -- soma da grade deste item
  preco_unit    REAL    NOT NULL DEFAULT 0,
  valor_total   REAL    NOT NULL DEFAULT 0,       -- qtd_total * preco_unit
  tempo_peca    REAL    NOT NULL DEFAULT 0,
  observacao    TEXT,
  ordem         INTEGER NOT NULL DEFAULT 0,       -- ordem visual
  ativo         INTEGER NOT NULL DEFAULT 1,
  dt_criacao    TEXT    NOT NULL DEFAULT (datetime('now')),
  dt_alteracao  TEXT,
  FOREIGN KEY (id_remessa) REFERENCES terc_remessas(id_remessa) ON DELETE CASCADE,
  FOREIGN KEY (id_servico) REFERENCES terc_servicos(id_servico)
);

CREATE INDEX IF NOT EXISTS idx_terc_rem_item_rem    ON terc_remessa_itens(id_remessa);
CREATE INDEX IF NOT EXISTS idx_terc_rem_item_ref    ON terc_remessa_itens(cod_ref);
CREATE INDEX IF NOT EXISTS idx_terc_rem_item_serv   ON terc_remessa_itens(id_servico);

-- Grade por item (cada item tem sua própria grade independente)
CREATE TABLE IF NOT EXISTS terc_remessa_item_grade (
  id_item_grade INTEGER PRIMARY KEY AUTOINCREMENT,
  id_item       INTEGER NOT NULL,
  tamanho       TEXT    NOT NULL,
  qtd           INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (id_item) REFERENCES terc_remessa_itens(id_item) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_terc_rem_item_grade_item ON terc_remessa_item_grade(id_item);
CREATE UNIQUE INDEX IF NOT EXISTS ux_terc_rem_item_grade_tam ON terc_remessa_item_grade(id_item, tamanho);

-- Migrar remessas existentes: cada remessa antiga vira 1 item
INSERT INTO terc_remessa_itens (
  id_remessa, cod_ref, desc_ref, id_servico, cor, grade_num,
  qtd_total, preco_unit, valor_total, tempo_peca, ordem, ativo, dt_criacao
)
SELECT
  r.id_remessa, COALESCE(r.cod_ref,''), r.desc_ref, r.id_servico,
  r.cor, COALESCE(r.grade,1),
  COALESCE(r.qtd_total,0), COALESCE(r.preco_unit,0), COALESCE(r.valor_total,0),
  COALESCE(r.tempo_peca,0), 0, 1, COALESCE(r.dt_criacao, datetime('now'))
FROM terc_remessas r
WHERE NOT EXISTS (
  SELECT 1 FROM terc_remessa_itens i WHERE i.id_remessa = r.id_remessa
);

-- Migrar grade antiga (terc_remessa_grade) para terc_remessa_item_grade
INSERT INTO terc_remessa_item_grade (id_item, tamanho, qtd)
SELECT i.id_item, g.tamanho, g.qtd
FROM terc_remessa_grade g
JOIN terc_remessa_itens i ON i.id_remessa = g.id_remessa
WHERE NOT EXISTS (
  SELECT 1 FROM terc_remessa_item_grade ig
   WHERE ig.id_item = i.id_item AND ig.tamanho = g.tamanho
);
