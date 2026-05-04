-- ============================================================
-- MIGRATION 0007 — TERCEIRIZAÇÃO V2: FLUXO OPERACIONAL
-- Novos status, financeiro automático, alertas, visão por terceirizado
-- ============================================================

-- 1) Novos campos na remessa para o fluxo completo
-- (SQLite não suporta DROP CHECK, então criamos shadow table e fazemos migração)

-- 1.1) Adiciona campos financeiros e de fluxo
ALTER TABLE terc_remessas ADD COLUMN dt_envio        TEXT;
ALTER TABLE terc_remessas ADD COLUMN dt_recebimento  TEXT;
ALTER TABLE terc_remessas ADD COLUMN dt_pagamento    TEXT;
ALTER TABLE terc_remessas ADD COLUMN valor_pago      REAL NOT NULL DEFAULT 0;
ALTER TABLE terc_remessas ADD COLUMN status_fin      TEXT NOT NULL DEFAULT 'NaoFaturado';
ALTER TABLE terc_remessas ADD COLUMN modo            TEXT NOT NULL DEFAULT 'basico';

-- Status financeiro: NaoFaturado | PendentePagamento | Pago | Cancelado
-- Modo: basico (auto) | avancado (manual)

-- 1.2) Recriar tabela com novos status — copia dados, recria, restaura
CREATE TABLE IF NOT EXISTS terc_remessas_new (
  id_remessa     INTEGER PRIMARY KEY AUTOINCREMENT,
  num_controle   INTEGER NOT NULL UNIQUE,
  num_op         TEXT,
  id_terc        INTEGER NOT NULL,
  id_setor       INTEGER,
  cod_ref        TEXT    NOT NULL,
  desc_ref       TEXT,
  id_servico     INTEGER NOT NULL,
  cor            TEXT,
  grade          INTEGER NOT NULL DEFAULT 1,
  qtd_total      INTEGER NOT NULL DEFAULT 0,
  preco_unit     REAL    NOT NULL DEFAULT 0,
  valor_total    REAL    NOT NULL DEFAULT 0,
  id_colecao     INTEGER,
  dt_saida       TEXT    NOT NULL,
  dt_envio       TEXT,
  dt_inicio      TEXT,
  dt_previsao    TEXT,
  dt_recebimento TEXT,
  dt_pagamento   TEXT,
  prazo_dias     INTEGER NOT NULL DEFAULT 0,
  tempo_peca     REAL    NOT NULL DEFAULT 0,
  efic_pct       REAL    NOT NULL DEFAULT 0.80,
  qtd_pessoas    INTEGER NOT NULL DEFAULT 1,
  min_trab_dia   INTEGER NOT NULL DEFAULT 480,
  valor_pago     REAL    NOT NULL DEFAULT 0,
  status         TEXT    NOT NULL DEFAULT 'AguardandoEnvio'
                  CHECK(status IN (
                    'AguardandoEnvio','Enviado','EmProducao','Atrasado',
                    'Concluido','Retornado','Pago','Cancelado','Parcial'
                  )),
  status_fin     TEXT    NOT NULL DEFAULT 'NaoFaturado'
                  CHECK(status_fin IN ('NaoFaturado','PendentePagamento','Pago','Cancelado')),
  modo           TEXT    NOT NULL DEFAULT 'basico',
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

-- Migrar dados — mapeando status antigos para novos
INSERT INTO terc_remessas_new (
  id_remessa, num_controle, num_op, id_terc, id_setor, cod_ref, desc_ref,
  id_servico, cor, grade, qtd_total, preco_unit, valor_total, id_colecao,
  dt_saida, dt_envio, dt_inicio, dt_previsao, dt_recebimento, dt_pagamento,
  prazo_dias, tempo_peca, efic_pct, qtd_pessoas, min_trab_dia, valor_pago,
  status, status_fin, modo, observacao, criado_por, dt_criacao, alterado_por, dt_alteracao
)
SELECT
  id_remessa, num_controle, num_op, id_terc, id_setor, cod_ref, desc_ref,
  id_servico, cor, grade, qtd_total, preco_unit, valor_total, id_colecao,
  dt_saida, dt_envio, dt_inicio, dt_previsao, dt_recebimento, dt_pagamento,
  prazo_dias, tempo_peca, efic_pct, qtd_pessoas, min_trab_dia, COALESCE(valor_pago,0),
  CASE
    WHEN status='Aberta' THEN 'AguardandoEnvio'
    WHEN status='EmProducao' THEN 'EmProducao'
    WHEN status='Parcial' THEN 'Parcial'
    WHEN status='Concluida' THEN 'Concluido'
    WHEN status='Atrasada' THEN 'Atrasado'
    WHEN status='Cancelada' THEN 'Cancelado'
    ELSE 'AguardandoEnvio'
  END,
  COALESCE(status_fin,'NaoFaturado'),
  COALESCE(modo,'basico'),
  observacao, criado_por, dt_criacao, alterado_por, dt_alteracao
FROM terc_remessas;

DROP TABLE terc_remessas;
ALTER TABLE terc_remessas_new RENAME TO terc_remessas;

CREATE INDEX IF NOT EXISTS idx_terc_rem_terc    ON terc_remessas(id_terc);
CREATE INDEX IF NOT EXISTS idx_terc_rem_status  ON terc_remessas(status);
CREATE INDEX IF NOT EXISTS idx_terc_rem_status_fin ON terc_remessas(status_fin);
CREATE INDEX IF NOT EXISTS idx_terc_rem_saida   ON terc_remessas(dt_saida);
CREATE INDEX IF NOT EXISTS idx_terc_rem_prev    ON terc_remessas(dt_previsao);
CREATE INDEX IF NOT EXISTS idx_terc_rem_opref   ON terc_remessas(num_op, cod_ref);

-- 2) Tabela de alertas operacionais da terceirização
CREATE TABLE IF NOT EXISTS terc_alertas (
  id_alerta    INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo         TEXT    NOT NULL,    -- ATRASO | BAIXA_PRODUCAO | SEM_RETORNO | PAGAMENTO_PENDENTE
  severidade   TEXT    NOT NULL DEFAULT 'media' CHECK(severidade IN ('baixa','media','alta','critica')),
  id_remessa   INTEGER,
  id_terc      INTEGER,
  titulo       TEXT    NOT NULL,
  descricao    TEXT,
  visualizado  INTEGER NOT NULL DEFAULT 0,
  resolvido    INTEGER NOT NULL DEFAULT 0,
  dt_geracao   TEXT NOT NULL DEFAULT (datetime('now')),
  dt_resolucao TEXT,
  FOREIGN KEY (id_remessa) REFERENCES terc_remessas(id_remessa) ON DELETE CASCADE,
  FOREIGN KEY (id_terc)    REFERENCES terc_terceirizados(id_terc)
);
CREATE INDEX IF NOT EXISTS idx_terc_alert_tipo ON terc_alertas(tipo, resolvido);
CREATE INDEX IF NOT EXISTS idx_terc_alert_terc ON terc_alertas(id_terc);

-- 3) Histórico de eventos da remessa (timeline)
CREATE TABLE IF NOT EXISTS terc_eventos (
  id_evento   INTEGER PRIMARY KEY AUTOINCREMENT,
  id_remessa  INTEGER NOT NULL,
  tipo        TEXT    NOT NULL,    -- CRIADA | ENVIADA | INICIO_PROD | RETORNO_PARCIAL | RETORNO_TOTAL | PAGAMENTO | CANCELADA
  descricao   TEXT,
  usuario     TEXT,
  dt_evento   TEXT NOT NULL DEFAULT (datetime('now')),
  payload     TEXT,                -- JSON livre
  FOREIGN KEY (id_remessa) REFERENCES terc_remessas(id_remessa) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_terc_ev_rem ON terc_eventos(id_remessa, dt_evento DESC);
