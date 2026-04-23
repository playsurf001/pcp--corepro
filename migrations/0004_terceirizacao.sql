-- ============================================================
-- MIGRATION 0004 — CONTROLE DE TERCEIRIZAÇÃO
-- Baseado na planilha "Controle de Terceirização Versão.xlsx"
-- 10.560 remessas, 10.405 retornos, 29 terceirizados
-- ============================================================

-- 1) Setores (Aparador, Embalagem, Estamparia, ...)
CREATE TABLE IF NOT EXISTS terc_setores (
  id_setor   INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_setor TEXT NOT NULL UNIQUE,
  ativo      INTEGER NOT NULL DEFAULT 1,
  dt_criacao TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2) Tipos de serviço (Aparar peça, Embalagem, Estamparia, ...)
CREATE TABLE IF NOT EXISTS terc_servicos (
  id_servico   INTEGER PRIMARY KEY AUTOINCREMENT,
  desc_servico TEXT NOT NULL UNIQUE,
  ativo        INTEGER NOT NULL DEFAULT 1,
  dt_criacao   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3) Coleções (Ímpeto, ...)
CREATE TABLE IF NOT EXISTS terc_colecoes (
  id_colecao  INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_colecao TEXT NOT NULL UNIQUE,
  ativo        INTEGER NOT NULL DEFAULT 1,
  dt_criacao   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4) Terceirizados (empresas/pessoas que prestam serviço)
CREATE TABLE IF NOT EXISTS terc_terceirizados (
  id_terc       INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_terc     TEXT NOT NULL UNIQUE,
  id_setor      INTEGER,
  cpf_cnpj      TEXT,
  telefone      TEXT,
  email         TEXT,
  endereco      TEXT,
  qtd_pessoas   INTEGER NOT NULL DEFAULT 1,   -- quantas pessoas trabalham (para previsão)
  min_trab_dia  INTEGER NOT NULL DEFAULT 480, -- minutos trabalhados/dia
  efic_padrao   REAL    NOT NULL DEFAULT 0.80,-- 80% eficiência padrão
  prazo_padrao  INTEGER NOT NULL DEFAULT 3,   -- dias padrão entrega
  situacao      TEXT    NOT NULL DEFAULT 'Ativa' CHECK(situacao IN ('Ativa','Inativa','Excluida','Suspensa')),
  observacao    TEXT,
  ativo         INTEGER NOT NULL DEFAULT 1,
  dt_criacao    TEXT NOT NULL DEFAULT (datetime('now')),
  criado_por    TEXT,
  FOREIGN KEY (id_setor) REFERENCES terc_setores(id_setor)
);
CREATE INDEX IF NOT EXISTS idx_terc_setor ON terc_terceirizados(id_setor);
CREATE INDEX IF NOT EXISTS idx_terc_situacao ON terc_terceirizados(situacao);

-- 5) Tabela de preços por (Referência + Serviço + Grade)
CREATE TABLE IF NOT EXISTS terc_precos (
  id_preco    INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_ref     TEXT    NOT NULL,
  desc_ref    TEXT,
  id_servico  INTEGER NOT NULL,
  grade       INTEGER NOT NULL DEFAULT 1,     -- 1,2,3,4 (qual grade de tamanhos)
  preco       REAL    NOT NULL DEFAULT 0,     -- R$ por peça
  tempo_min   REAL    NOT NULL DEFAULT 0,     -- tempo em minutos/peça (para previsão)
  id_colecao  INTEGER,
  dt_vigencia TEXT,
  observacao  TEXT,
  ativo       INTEGER NOT NULL DEFAULT 1,
  dt_criacao  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_servico) REFERENCES terc_servicos(id_servico),
  FOREIGN KEY (id_colecao) REFERENCES terc_colecoes(id_colecao),
  UNIQUE (cod_ref, id_servico, grade, id_colecao)
);
CREATE INDEX IF NOT EXISTS idx_terc_preco_ref ON terc_precos(cod_ref);

-- 6) Remessas (saída de peças para o terceirizado)
CREATE TABLE IF NOT EXISTS terc_remessas (
  id_remessa     INTEGER PRIMARY KEY AUTOINCREMENT,
  num_controle   INTEGER NOT NULL UNIQUE,     -- número sequencial do controle
  num_op         TEXT,                         -- opcional, OP relacionada
  id_terc        INTEGER NOT NULL,
  id_setor       INTEGER,
  cod_ref        TEXT    NOT NULL,
  desc_ref       TEXT,
  id_servico     INTEGER NOT NULL,
  cor            TEXT,
  grade          INTEGER NOT NULL DEFAULT 1,
  qtd_total      INTEGER NOT NULL DEFAULT 0,
  preco_unit     REAL    NOT NULL DEFAULT 0,
  valor_total    REAL    NOT NULL DEFAULT 0,   -- qtd_total * preco_unit
  id_colecao     INTEGER,
  dt_saida       TEXT    NOT NULL,             -- quando saiu da fábrica
  dt_inicio      TEXT,                          -- quando o terceirizado começou
  dt_previsao    TEXT,                          -- previsão de retorno calculada
  prazo_dias     INTEGER NOT NULL DEFAULT 0,    -- prazo em dias úteis
  tempo_peca     REAL    NOT NULL DEFAULT 0,    -- tempo em minutos/peça
  efic_pct       REAL    NOT NULL DEFAULT 0.80, -- eficiência usada no cálculo
  qtd_pessoas    INTEGER NOT NULL DEFAULT 1,
  min_trab_dia   INTEGER NOT NULL DEFAULT 480,
  status         TEXT    NOT NULL DEFAULT 'Aberta' CHECK(status IN ('Aberta','EmProducao','Parcial','Concluida','Atrasada','Cancelada')),
  observacao     TEXT,
  criado_por     TEXT,
  dt_criacao     TEXT NOT NULL DEFAULT (datetime('now')),
  alterado_por   TEXT,
  dt_alteracao   TEXT,
  FOREIGN KEY (id_terc)    REFERENCES terc_terceirizados(id_terc),
  FOREIGN KEY (id_setor)   REFERENCES terc_setores(id_setor),
  FOREIGN KEY (id_servico) REFERENCES terc_servicos(id_servico),
  FOREIGN KEY (id_colecao) REFERENCES terc_colecoes(id_colecao)
);
CREATE INDEX IF NOT EXISTS idx_terc_rem_terc    ON terc_remessas(id_terc);
CREATE INDEX IF NOT EXISTS idx_terc_rem_status  ON terc_remessas(status);
CREATE INDEX IF NOT EXISTS idx_terc_rem_saida   ON terc_remessas(dt_saida);
CREATE INDEX IF NOT EXISTS idx_terc_rem_prev    ON terc_remessas(dt_previsao);
CREATE INDEX IF NOT EXISTS idx_terc_rem_opref   ON terc_remessas(num_op, cod_ref);

-- 7) Grade da remessa (quantidade por tamanho: P, M, G, GG, EG, SG, + 4 extras)
CREATE TABLE IF NOT EXISTS terc_remessa_grade (
  id_grade_rem INTEGER PRIMARY KEY AUTOINCREMENT,
  id_remessa   INTEGER NOT NULL,
  tamanho      TEXT    NOT NULL,   -- P, M, G, GG, EG, SG, T7, T8, T9, T10
  qtd          INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (id_remessa) REFERENCES terc_remessas(id_remessa) ON DELETE CASCADE,
  UNIQUE (id_remessa, tamanho)
);
CREATE INDEX IF NOT EXISTS idx_terc_grade_rem ON terc_remessa_grade(id_remessa);

-- 8) Retornos (peças que voltaram, podem ser múltiplos retornos parciais por remessa)
CREATE TABLE IF NOT EXISTS terc_retornos (
  id_retorno   INTEGER PRIMARY KEY AUTOINCREMENT,
  id_remessa   INTEGER NOT NULL,
  dt_retorno   TEXT    NOT NULL,
  qtd_total    INTEGER NOT NULL DEFAULT 0,
  qtd_boa      INTEGER NOT NULL DEFAULT 0,    -- peças aprovadas
  qtd_refugo   INTEGER NOT NULL DEFAULT 0,    -- peças com defeito
  qtd_conserto INTEGER NOT NULL DEFAULT 0,    -- peças que precisam de conserto
  valor_pago   REAL    NOT NULL DEFAULT 0,
  dt_pagamento TEXT,
  observacao   TEXT,
  criado_por   TEXT,
  dt_criacao   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_remessa) REFERENCES terc_remessas(id_remessa) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_terc_ret_rem  ON terc_retornos(id_remessa);
CREATE INDEX IF NOT EXISTS idx_terc_ret_data ON terc_retornos(dt_retorno);

-- 9) Grade do retorno (quantidade por tamanho)
CREATE TABLE IF NOT EXISTS terc_retorno_grade (
  id_grade_ret INTEGER PRIMARY KEY AUTOINCREMENT,
  id_retorno   INTEGER NOT NULL,
  tamanho      TEXT    NOT NULL,
  qtd          INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (id_retorno) REFERENCES terc_retornos(id_retorno) ON DELETE CASCADE,
  UNIQUE (id_retorno, tamanho)
);

-- 10) Consertos (ciclo paralelo: peças enviadas para reparo e retornadas)
CREATE TABLE IF NOT EXISTS terc_consertos (
  id_conserto  INTEGER PRIMARY KEY AUTOINCREMENT,
  num_controle INTEGER NOT NULL UNIQUE,
  id_remessa   INTEGER,                      -- opcional: remessa original
  id_terc      INTEGER NOT NULL,
  tipo         TEXT    NOT NULL DEFAULT 'Conserto' CHECK(tipo IN ('Conserto','Retrabalho','Ajuste')),
  cod_ref      TEXT    NOT NULL,
  desc_ref     TEXT,
  cor          TEXT,
  grade        INTEGER NOT NULL DEFAULT 1,
  qtd_total    INTEGER NOT NULL DEFAULT 0,
  qtd_retornada INTEGER NOT NULL DEFAULT 0,
  dt_saida     TEXT    NOT NULL,
  dt_retorno   TEXT,
  status       TEXT    NOT NULL DEFAULT 'Aberto' CHECK(status IN ('Aberto','EmAndamento','Concluido','Cancelado')),
  observacao   TEXT,
  criado_por   TEXT,
  dt_criacao   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_remessa) REFERENCES terc_remessas(id_remessa),
  FOREIGN KEY (id_terc)    REFERENCES terc_terceirizados(id_terc)
);
CREATE INDEX IF NOT EXISTS idx_terc_cons_terc  ON terc_consertos(id_terc);
CREATE INDEX IF NOT EXISTS idx_terc_cons_rem   ON terc_consertos(id_remessa);

-- 11) Grade do conserto
CREATE TABLE IF NOT EXISTS terc_conserto_grade (
  id_grade_cons INTEGER PRIMARY KEY AUTOINCREMENT,
  id_conserto   INTEGER NOT NULL,
  tamanho       TEXT    NOT NULL,
  qtd           INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (id_conserto) REFERENCES terc_consertos(id_conserto) ON DELETE CASCADE,
  UNIQUE (id_conserto, tamanho)
);

-- ============================================================
-- SEED inicial dos cadastros (extraídos da planilha)
-- ============================================================

-- Setores
INSERT OR IGNORE INTO terc_setores (nome_setor) VALUES
  ('Aparador'), ('Embalagem'), ('Estamparia');

-- Serviços
INSERT OR IGNORE INTO terc_servicos (desc_servico) VALUES
  ('Aparar peça'), ('Embalagem'), ('Estamparia');

-- Coleções
INSERT OR IGNORE INTO terc_colecoes (nome_colecao) VALUES
  ('Ímpeto');

-- Terceirizados reais extraídos da planilha (29 pessoas) — inserts individuais
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Alisson',             (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Anna',                (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Antonio Leite',       (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Claudiele',           (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Crislaine',           (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Cristiane',           (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Delma',               (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Ederlon',             (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Edson Leite',         (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Eliene',              (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Eriberto',            (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Fernanda',            (SELECT id_setor FROM terc_setores WHERE nome_setor='Embalagem'), 'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Flaviana',            (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Iolanda',             (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Jany',                (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Jardson',             (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Jersiane',            (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Josefa',              (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Joselma',             (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Júlia',               (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Léo',                 (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Maria Costura',       (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Marli',               (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Marquinhos',          (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Patricia',            (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Paulinha',            (SELECT id_setor FROM terc_setores WHERE nome_setor='Embalagem'), 'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Rosa',                (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Dona Neide',          (SELECT id_setor FROM terc_setores WHERE nome_setor='Aparador'),  'Ativa');
INSERT OR IGNORE INTO terc_terceirizados (nome_terc, id_setor, situacao) VALUES ('Bordados & Bordados', (SELECT id_setor FROM terc_setores WHERE nome_setor='Estamparia'),'Ativa');
