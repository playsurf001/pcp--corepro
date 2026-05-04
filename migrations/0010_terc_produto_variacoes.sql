-- Migration 0010: Variações de produto (Cor + Grade) e tabela de preços avançada
-- Estende terc_precos para suportar: Produto + Cor + Grade(tamanho) + Serviço + Preço + Tempo
-- Estratégia: ADD COLUMN não-destrutiva e novo índice único.
-- Compatível com registros legados (cor='', tamanho='' = preço genérico do produto).

-- 1) Tabela de catálogo de cores reutilizáveis (nome único)
CREATE TABLE IF NOT EXISTS terc_cores (
  id_cor       INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_cor     TEXT NOT NULL UNIQUE,
  hex          TEXT,                          -- opcional (ex: #FFFFFF)
  ativo        INTEGER NOT NULL DEFAULT 1,
  dt_criacao   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2) Variações por produto: define quais cores e tamanhos cada produto suporta
CREATE TABLE IF NOT EXISTS terc_produto_variacoes (
  id_var         INTEGER PRIMARY KEY AUTOINCREMENT,
  id_produto     INTEGER NOT NULL,
  cor            TEXT NOT NULL DEFAULT '',     -- texto livre p/ flexibilidade ('' = sem cor)
  tamanho        TEXT NOT NULL DEFAULT '',     -- 'PP','P','M','G','GG','XGG','36','38'... ('' = sem tamanho)
  ativo          INTEGER NOT NULL DEFAULT 1,
  dt_criacao     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_produto) REFERENCES terc_produtos(id_produto) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_terc_pvar_unico
  ON terc_produto_variacoes (id_produto, cor, tamanho);
CREATE INDEX IF NOT EXISTS idx_terc_pvar_prod ON terc_produto_variacoes(id_produto);

-- 3) Estende terc_precos com COR e TAMANHO (grade) — texto livre
-- SQLite: ADD COLUMN é seguro; valores antigos ficam '' (vazio) = preço genérico.
ALTER TABLE terc_precos ADD COLUMN cor     TEXT NOT NULL DEFAULT '';
ALTER TABLE terc_precos ADD COLUMN tamanho TEXT NOT NULL DEFAULT '';
ALTER TABLE terc_precos ADD COLUMN dt_alteracao TEXT;
ALTER TABLE terc_precos ADD COLUMN alterado_por TEXT;

-- 4) Novo índice único garantindo unicidade Produto+Cor+Grade+Serviço+Coleção
-- (Mantemos o antigo `UNIQUE (cod_ref, id_servico, grade, id_colecao)` mas
-- agora a chave de negócio efetiva inclui cor+tamanho.)
CREATE UNIQUE INDEX IF NOT EXISTS ux_terc_precos_full
  ON terc_precos (cod_ref, COALESCE(id_servico,0), COALESCE(cor,''), COALESCE(tamanho,''), COALESCE(id_colecao,0));

CREATE INDEX IF NOT EXISTS idx_terc_precos_cor    ON terc_precos(cor);
CREATE INDEX IF NOT EXISTS idx_terc_precos_tam    ON terc_precos(tamanho);
CREATE INDEX IF NOT EXISTS idx_terc_precos_lookup ON terc_precos(cod_ref, id_servico, ativo);

-- 5) Seed inicial das cores (vindas da planilha "cor - preço.xlsx" → Planilha1)
INSERT OR IGNORE INTO terc_cores (nome_cor) VALUES
  ('Amarelo'),('Areia'),('Azul'),('Azul claro'),('Bege'),('Branco'),
  ('Caqui'),('Cereja'),('Chumbo'),('Cinza'),('Creme'),('Dourado'),
  ('Gelo'),('Goiaba'),('Indigo'),('Laranja'),('Lodo'),('Marinho'),
  ('Marrom'),('Mostarda'),('Off White'),('Petróleo'),('Pink'),
  ('Preto'),('Rosa'),('Roxo'),('Salmão'),('Verde'),('Verde claro'),
  ('Verde musgo'),('Vermelho'),('Vinho');
