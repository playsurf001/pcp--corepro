-- =================================================================
-- 0012 — RETORNO MULTI-ITENS (1 retorno cobre N itens da remessa)
--
-- Estrutura nova:
--   terc_retornos               (cabeçalho — já existe; ganha agregados)
--   terc_retorno_itens          (1 linha por item retornado)
--   terc_retorno_item_grade     (grade por item retornado)
--
-- Compatibilidade: terc_retorno_grade legado continua sendo gravado
-- (somatório de todas as grades de itens) para telas antigas.
-- =================================================================

CREATE TABLE IF NOT EXISTS terc_retorno_itens (
  id_ret_item    INTEGER PRIMARY KEY AUTOINCREMENT,
  id_retorno     INTEGER NOT NULL,
  id_item        INTEGER NOT NULL,                 -- vínculo com terc_remessa_itens
  id_remessa     INTEGER NOT NULL,                 -- denormalizado p/ filtro rápido
  cod_ref        TEXT,
  desc_ref       TEXT,
  cor            TEXT,
  id_servico     INTEGER,
  qtd_boa        INTEGER NOT NULL DEFAULT 0,
  qtd_refugo     INTEGER NOT NULL DEFAULT 0,
  qtd_conserto   INTEGER NOT NULL DEFAULT 0,
  qtd_total      INTEGER NOT NULL DEFAULT 0,       -- = boa+refugo+conserto
  preco_unit     REAL    NOT NULL DEFAULT 0,
  valor          REAL    NOT NULL DEFAULT 0,       -- = qtd_boa * preco_unit
  observacao     TEXT,
  dt_criacao     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_retorno) REFERENCES terc_retornos(id_retorno) ON DELETE CASCADE,
  FOREIGN KEY (id_item)    REFERENCES terc_remessa_itens(id_item),
  FOREIGN KEY (id_remessa) REFERENCES terc_remessas(id_remessa) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_terc_ret_item_ret  ON terc_retorno_itens(id_retorno);
CREATE INDEX IF NOT EXISTS idx_terc_ret_item_item ON terc_retorno_itens(id_item);
CREATE INDEX IF NOT EXISTS idx_terc_ret_item_rem  ON terc_retorno_itens(id_remessa);

-- Grade por item retornado (1 linha por tamanho)
CREATE TABLE IF NOT EXISTS terc_retorno_item_grade (
  id_ret_item_grade INTEGER PRIMARY KEY AUTOINCREMENT,
  id_ret_item       INTEGER NOT NULL,
  tamanho           TEXT    NOT NULL,
  qtd               INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (id_ret_item) REFERENCES terc_retorno_itens(id_ret_item) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_terc_ret_item_grade_item ON terc_retorno_item_grade(id_ret_item);
CREATE UNIQUE INDEX IF NOT EXISTS ux_terc_ret_item_grade_tam ON terc_retorno_item_grade(id_ret_item, tamanho);

-- Migração suave: para retornos antigos (sem itens), cria 1 linha vinculada
-- ao primeiro item da remessa correspondente (id_item via terc_remessa_itens).
INSERT INTO terc_retorno_itens (
  id_retorno, id_item, id_remessa, cod_ref, desc_ref, cor, id_servico,
  qtd_boa, qtd_refugo, qtd_conserto, qtd_total, preco_unit, valor,
  observacao, dt_criacao
)
SELECT
  ret.id_retorno,
  (SELECT MIN(id_item) FROM terc_remessa_itens WHERE id_remessa = ret.id_remessa),
  ret.id_remessa,
  rem.cod_ref, rem.desc_ref, rem.cor, rem.id_servico,
  COALESCE(ret.qtd_boa,0), COALESCE(ret.qtd_refugo,0), COALESCE(ret.qtd_conserto,0),
  COALESCE(ret.qtd_total,0), COALESCE(rem.preco_unit,0),
  COALESCE(ret.valor_pago, COALESCE(ret.qtd_boa,0) * COALESCE(rem.preco_unit,0)),
  ret.observacao, COALESCE(ret.dt_criacao, datetime('now'))
FROM terc_retornos ret
JOIN terc_remessas rem ON rem.id_remessa = ret.id_remessa
WHERE NOT EXISTS (
  SELECT 1 FROM terc_retorno_itens ri WHERE ri.id_retorno = ret.id_retorno
)
AND EXISTS (
  SELECT 1 FROM terc_remessa_itens i WHERE i.id_remessa = ret.id_remessa
);

-- Migra grade legada (terc_retorno_grade) para grade do item retornado criado acima
INSERT INTO terc_retorno_item_grade (id_ret_item, tamanho, qtd)
SELECT ri.id_ret_item, g.tamanho, g.qtd
FROM terc_retorno_grade g
JOIN terc_retorno_itens ri ON ri.id_retorno = g.id_retorno
WHERE NOT EXISTS (
  SELECT 1 FROM terc_retorno_item_grade rg
   WHERE rg.id_ret_item = ri.id_ret_item AND rg.tamanho = g.tamanho
);
