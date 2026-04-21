-- =====================================================================
-- Sistema PCP para Confecção - Schema v2.0
-- Baseado no legado "Kamylla - Ficha Balanceamento v1.0"
-- =====================================================================

-- Parâmetros globais (min/turno, eficiência default, pacote padrão)
CREATE TABLE IF NOT EXISTS parametros (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  descricao TEXT
);

-- Clientes
CREATE TABLE IF NOT EXISTS clientes (
  id_cliente     INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_cliente    TEXT UNIQUE NOT NULL,
  nome_cliente   TEXT NOT NULL,
  cnpj           TEXT,
  ativo          INTEGER NOT NULL DEFAULT 1,
  observacao     TEXT,            -- observações padrão nas OPs (multilinha)
  dt_cadastro    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Referências (produtos)
CREATE TABLE IF NOT EXISTS referencias (
  id_ref      INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_ref     TEXT UNIQUE NOT NULL,
  desc_ref    TEXT NOT NULL,
  familia     TEXT,
  ativo       INTEGER NOT NULL DEFAULT 1,
  dt_cadastro TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Máquinas (tipos; eficiência pertence à máquina - confirmado no legado)
CREATE TABLE IF NOT EXISTS maquinas (
  id_maquina       INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_maquina      TEXT UNIQUE NOT NULL,
  desc_maquina     TEXT NOT NULL,
  tipo             TEXT,
  eficiencia       REAL NOT NULL DEFAULT 0.85,  -- %
  oper_por_maquina REAL NOT NULL DEFAULT 1,
  ativo            INTEGER NOT NULL DEFAULT 1
);

-- Aparelhos
CREATE TABLE IF NOT EXISTS aparelhos (
  id_aparelho   INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_aparelho  TEXT UNIQUE NOT NULL,
  desc_aparelho TEXT NOT NULL,
  ativo         INTEGER NOT NULL DEFAULT 1
);

-- Operações (tempo padrão pertence à operação no legado, mas na v2.0 vem do seq_itens)
CREATE TABLE IF NOT EXISTS operacoes (
  id_op        INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_op       TEXT UNIQUE NOT NULL,
  desc_op      TEXT NOT NULL,
  id_maquina   INTEGER REFERENCES maquinas(id_maquina),
  id_aparelho  INTEGER REFERENCES aparelhos(id_aparelho),
  tempo_padrao REAL DEFAULT 0,   -- default quando a operação for adicionada a uma sequência
  ativo        INTEGER NOT NULL DEFAULT 1
);

-- Cores
CREATE TABLE IF NOT EXISTS cores (
  id_cor   INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_cor  TEXT UNIQUE NOT NULL,
  nome_cor TEXT NOT NULL,
  ativo    INTEGER NOT NULL DEFAULT 1
);

-- Tamanhos
CREATE TABLE IF NOT EXISTS tamanhos (
  id_tam  INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_tam TEXT UNIQUE NOT NULL,
  ordem   INTEGER DEFAULT 0,
  ativo   INTEGER NOT NULL DEFAULT 1
);

-- Sequências operacionais (cabeçalho com versão)
CREATE TABLE IF NOT EXISTS seq_cab (
  id_seq_cab  INTEGER PRIMARY KEY AUTOINCREMENT,
  id_ref      INTEGER NOT NULL REFERENCES referencias(id_ref),
  versao      INTEGER NOT NULL,
  ativa       INTEGER NOT NULL DEFAULT 0,  -- apenas 1 ativa por ref (regra de negócio no app)
  observacao  TEXT,
  criado_por  TEXT,
  dt_criacao  TEXT NOT NULL DEFAULT (datetime('now')),
  dt_ativacao TEXT,
  UNIQUE (id_ref, versao)
);
CREATE INDEX IF NOT EXISTS idx_seq_cab_ref ON seq_cab(id_ref);

-- Itens da sequência operacional
CREATE TABLE IF NOT EXISTS seq_itens (
  id_seq_item  INTEGER PRIMARY KEY AUTOINCREMENT,
  id_seq_cab   INTEGER NOT NULL REFERENCES seq_cab(id_seq_cab) ON DELETE CASCADE,
  sequencia    INTEGER NOT NULL,         -- 10, 20, 30...
  id_op        INTEGER NOT NULL REFERENCES operacoes(id_op),
  id_maquina   INTEGER REFERENCES maquinas(id_maquina),
  id_aparelho  INTEGER REFERENCES aparelhos(id_aparelho),
  tempo_padrao REAL NOT NULL,
  observacao   TEXT,
  UNIQUE (id_seq_cab, sequencia)
);
CREATE INDEX IF NOT EXISTS idx_seq_itens_cab ON seq_itens(id_seq_cab);

-- OPs (Ordens de Produção)
CREATE TABLE IF NOT EXISTS op_cab (
  id_op          INTEGER PRIMARY KEY AUTOINCREMENT,
  num_op         TEXT UNIQUE NOT NULL,
  dt_emissao     TEXT NOT NULL,
  id_ref         INTEGER NOT NULL REFERENCES referencias(id_ref),
  id_cliente     INTEGER NOT NULL REFERENCES clientes(id_cliente),
  qtde_pecas     INTEGER NOT NULL CHECK (qtde_pecas > 0),
  dt_entrega     TEXT NOT NULL,
  id_seq_cab     INTEGER NOT NULL REFERENCES seq_cab(id_seq_cab),
  status         TEXT NOT NULL DEFAULT 'Aberta'
                 CHECK (status IN ('Aberta','Planejada','EmProducao','Concluida','Cancelada')),
  observacao     TEXT,
  criado_por     TEXT,
  dt_criacao     TEXT NOT NULL DEFAULT (datetime('now')),
  alterado_por   TEXT,
  dt_alteracao   TEXT
);
CREATE INDEX IF NOT EXISTS idx_op_cab_status ON op_cab(status);
CREATE INDEX IF NOT EXISTS idx_op_cab_cliente ON op_cab(id_cliente);
CREATE INDEX IF NOT EXISTS idx_op_cab_ref ON op_cab(id_ref);

-- Grade de cores da OP
CREATE TABLE IF NOT EXISTS op_cores (
  id_op_cor  INTEGER PRIMARY KEY AUTOINCREMENT,
  id_op      INTEGER NOT NULL REFERENCES op_cab(id_op) ON DELETE CASCADE,
  id_cor     INTEGER NOT NULL REFERENCES cores(id_cor),
  qtde_pecas INTEGER NOT NULL CHECK (qtde_pecas >= 0),
  UNIQUE (id_op, id_cor)
);

-- Grade de tamanhos da OP
CREATE TABLE IF NOT EXISTS op_tamanhos (
  id_op_tam  INTEGER PRIMARY KEY AUTOINCREMENT,
  id_op      INTEGER NOT NULL REFERENCES op_cab(id_op) ON DELETE CASCADE,
  id_tam     INTEGER NOT NULL REFERENCES tamanhos(id_tam),
  qtde_pecas INTEGER NOT NULL CHECK (qtde_pecas >= 0),
  UNIQUE (id_op, id_tam)
);

-- Apontamento de produção (módulo novo, inexistente no legado)
CREATE TABLE IF NOT EXISTS apontamento (
  id_apont     INTEGER PRIMARY KEY AUTOINCREMENT,
  data         TEXT NOT NULL,
  id_op        INTEGER NOT NULL REFERENCES op_cab(id_op),
  id_seq_item  INTEGER NOT NULL REFERENCES seq_itens(id_seq_item),
  operador     TEXT NOT NULL,
  qtd_boa      INTEGER NOT NULL CHECK (qtd_boa >= 0),
  qtd_refugo   INTEGER NOT NULL DEFAULT 0 CHECK (qtd_refugo >= 0),
  horas_trab   REAL NOT NULL CHECK (horas_trab > 0),
  efic_real    REAL,                     -- calculado ao inserir
  criado_por   TEXT,
  dt_criacao   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apont_op ON apontamento(id_op);
CREATE INDEX IF NOT EXISTS idx_apont_data ON apontamento(data);

-- Auditoria (append-only)
CREATE TABLE IF NOT EXISTS auditoria (
  id_audit       INTEGER PRIMARY KEY AUTOINCREMENT,
  dt_hora        TEXT NOT NULL DEFAULT (datetime('now')),
  usuario        TEXT NOT NULL,
  modulo         TEXT NOT NULL,       -- SEQ, OP, APONT, CAD, SYS
  acao           TEXT NOT NULL,       -- INS, UPD, DEL, ATIVAR, INATIVAR, LOGIN
  chave_registro TEXT,
  campo          TEXT,
  valor_anterior TEXT,
  valor_novo     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_dt ON auditoria(dt_hora DESC);
CREATE INDEX IF NOT EXISTS idx_audit_modulo ON auditoria(modulo);
