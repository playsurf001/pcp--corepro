-- =====================================================================
-- MES v1.0 — Colaboradores, Sessões de Apontamento (timer), Defeitos
-- Adiciona o que falta para virar um Manufacturing Execution System de verdade.
-- Mantém compatibilidade com o módulo de apontamento existente.
-- =====================================================================

-- Setores produtivos (Corte, Costura, Acabamento, Estamparia, etc.)
CREATE TABLE IF NOT EXISTS setores (
  id_setor    INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_setor   TEXT UNIQUE NOT NULL,
  desc_setor  TEXT NOT NULL,
  cor         TEXT DEFAULT '#2563EB',  -- cor do card no dashboard
  ativo       INTEGER NOT NULL DEFAULT 1,
  dt_cadastro TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Colaboradores (chão de fábrica)
CREATE TABLE IF NOT EXISTS colaboradores (
  id_colab        INTEGER PRIMARY KEY AUTOINCREMENT,
  matricula       TEXT UNIQUE NOT NULL,
  nome            TEXT NOT NULL,
  funcao          TEXT,                          -- Costureira, Cortador, etc.
  id_setor        INTEGER REFERENCES setores(id_setor),
  meta_diaria     INTEGER DEFAULT 0,             -- peças/dia
  meta_eficiencia REAL    DEFAULT 0.85,          -- 85%
  custo_minuto    REAL    DEFAULT 0,             -- R$/min (para custo)
  bonus_base      REAL    DEFAULT 0,             -- valor base de bônus mensal
  ativo           INTEGER NOT NULL DEFAULT 1,
  dt_admissao     TEXT,
  dt_cadastro     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_colab_setor ON colaboradores(id_setor);
CREATE INDEX IF NOT EXISTS idx_colab_ativo ON colaboradores(ativo);

-- Sessões de apontamento (timer real: start/pause/finish)
-- Cada sessão = um trabalho de um colaborador numa operação específica de uma OP.
CREATE TABLE IF NOT EXISTS apontamento_sessao (
  id_sessao       INTEGER PRIMARY KEY AUTOINCREMENT,
  id_op           INTEGER NOT NULL REFERENCES op_cab(id_op),
  id_seq_item     INTEGER NOT NULL REFERENCES seq_itens(id_seq_item),
  id_colab        INTEGER REFERENCES colaboradores(id_colab),
  operador_nome   TEXT NOT NULL,                  -- snapshot (caso colab seja deletado)
  status          TEXT NOT NULL DEFAULT 'EmAndamento'
                  CHECK (status IN ('EmAndamento','Pausada','Finalizada','Cancelada')),
  dt_inicio       TEXT NOT NULL DEFAULT (datetime('now')),
  dt_pausa        TEXT,                           -- última pausa
  dt_fim          TEXT,
  segundos_pausa  INTEGER NOT NULL DEFAULT 0,     -- soma de pausas (para descontar)
  qtd_boa         INTEGER NOT NULL DEFAULT 0,
  qtd_refugo      INTEGER NOT NULL DEFAULT 0,
  qtd_retrabalho  INTEGER NOT NULL DEFAULT 0,
  efic_real       REAL,                           -- preenchido ao finalizar
  obs             TEXT,
  criado_por      TEXT,
  dt_criacao      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_aps_op       ON apontamento_sessao(id_op);
CREATE INDEX IF NOT EXISTS idx_aps_colab    ON apontamento_sessao(id_colab);
CREATE INDEX IF NOT EXISTS idx_aps_status   ON apontamento_sessao(status);
CREATE INDEX IF NOT EXISTS idx_aps_inicio   ON apontamento_sessao(dt_inicio);

-- Tipos de defeito (catálogo) — para análise por operação
CREATE TABLE IF NOT EXISTS tipos_defeito (
  id_defeito  INTEGER PRIMARY KEY AUTOINCREMENT,
  cod_defeito TEXT UNIQUE NOT NULL,
  descricao   TEXT NOT NULL,
  gravidade   TEXT DEFAULT 'media' CHECK (gravidade IN ('baixa','media','alta')),
  ativo       INTEGER NOT NULL DEFAULT 1
);

-- Defeitos registrados (vinculado a apontamento ou sessão)
CREATE TABLE IF NOT EXISTS defeitos_registro (
  id_reg       INTEGER PRIMARY KEY AUTOINCREMENT,
  id_sessao    INTEGER REFERENCES apontamento_sessao(id_sessao) ON DELETE CASCADE,
  id_apont     INTEGER REFERENCES apontamento(id_apont) ON DELETE CASCADE,
  id_defeito   INTEGER NOT NULL REFERENCES tipos_defeito(id_defeito),
  qtde         INTEGER NOT NULL CHECK (qtde > 0),
  dt_registro  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_def_sessao ON defeitos_registro(id_sessao);
CREATE INDEX IF NOT EXISTS idx_def_apont  ON defeitos_registro(id_apont);

-- Bonificação mensal calculada automaticamente
CREATE TABLE IF NOT EXISTS bonificacao_mes (
  id_bonus       INTEGER PRIMARY KEY AUTOINCREMENT,
  id_colab       INTEGER NOT NULL REFERENCES colaboradores(id_colab),
  ano            INTEGER NOT NULL,
  mes            INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  pecas_total    INTEGER NOT NULL DEFAULT 0,
  horas_total    REAL    NOT NULL DEFAULT 0,
  efic_media     REAL    NOT NULL DEFAULT 0,
  meta_atingida  INTEGER NOT NULL DEFAULT 0,      -- 0/1
  bonus_calc     REAL    NOT NULL DEFAULT 0,
  ranking        INTEGER,                         -- 1, 2, 3...
  dt_calculo     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (id_colab, ano, mes)
);
CREATE INDEX IF NOT EXISTS idx_bon_periodo ON bonificacao_mes(ano, mes);

-- Adiciona coluna id_colab no apontamento existente (sem quebrar nada)
-- SQLite não tem ADD COLUMN IF NOT EXISTS; protegemos com try/catch no app.
-- Como migrations rodam apenas uma vez, é seguro adicionar diretamente.
ALTER TABLE apontamento ADD COLUMN id_colab INTEGER REFERENCES colaboradores(id_colab);
ALTER TABLE apontamento ADD COLUMN qtd_retrabalho INTEGER NOT NULL DEFAULT 0;

-- Atualiza CHECK do status de op_cab para incluir 'Pausada'
-- SQLite não suporta ALTER de CHECK direto; fazemos via tabela temporária.
PRAGMA foreign_keys = OFF;

CREATE TABLE op_cab_new (
  id_op          INTEGER PRIMARY KEY AUTOINCREMENT,
  num_op         TEXT UNIQUE NOT NULL,
  dt_emissao     TEXT NOT NULL,
  id_ref         INTEGER NOT NULL REFERENCES referencias(id_ref),
  id_cliente     INTEGER NOT NULL REFERENCES clientes(id_cliente),
  qtde_pecas     INTEGER NOT NULL CHECK (qtde_pecas > 0),
  dt_entrega     TEXT NOT NULL,
  id_seq_cab     INTEGER NOT NULL REFERENCES seq_cab(id_seq_cab),
  status         TEXT NOT NULL DEFAULT 'Aberta'
                 CHECK (status IN ('Aberta','Planejada','EmProducao','Pausada','Concluida','Cancelada')),
  observacao     TEXT,
  criado_por     TEXT,
  dt_criacao     TEXT NOT NULL DEFAULT (datetime('now')),
  alterado_por   TEXT,
  dt_alteracao   TEXT
);
INSERT INTO op_cab_new SELECT * FROM op_cab;
DROP TABLE op_cab;
ALTER TABLE op_cab_new RENAME TO op_cab;
CREATE INDEX IF NOT EXISTS idx_op_cab_status ON op_cab(status);
CREATE INDEX IF NOT EXISTS idx_op_cab_cliente ON op_cab(id_cliente);
CREATE INDEX IF NOT EXISTS idx_op_cab_ref ON op_cab(id_ref);

PRAGMA foreign_keys = ON;

-- Setores padrão
INSERT OR IGNORE INTO setores (cod_setor, desc_setor, cor) VALUES
  ('CORTE',      'Corte',        '#3B82F6'),
  ('COSTURA',    'Costura',      '#8B5CF6'),
  ('ACABAMENTO', 'Acabamento',   '#10B981'),
  ('ESTAMPARIA', 'Estamparia',   '#F59E0B'),
  ('REVISAO',    'Revisão/QC',   '#EC4899'),
  ('EMBALAGEM',  'Embalagem',    '#06B6D4');

-- Defeitos comuns
INSERT OR IGNORE INTO tipos_defeito (cod_defeito, descricao, gravidade) VALUES
  ('COSTURA_TORTA',   'Costura torta',                'media'),
  ('PONTO_FALHO',     'Ponto falho',                  'media'),
  ('TECIDO_RASGADO',  'Tecido rasgado',               'alta'),
  ('MEDIDA_FORA',     'Medida fora do padrão',        'alta'),
  ('MANCHA',          'Mancha no tecido',             'media'),
  ('FIO_SOLTO',       'Fio solto',                    'baixa'),
  ('ETIQUETA',        'Problema de etiqueta',         'baixa'),
  ('OUTRO',           'Outro defeito',                'media');
