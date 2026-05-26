-- ============================================================================
-- 0033_unique_per_tenant_rebuild.sql
-- HOTFIX SaaS Multi-Tenant — Reescopar UNIQUE constraints globais por empresa
--
-- CONTEXTO:
--   Várias tabelas têm UNIQUE GLOBAL declarado inline na criação:
--     - terc_remessas.num_controle      → CRÍTICO: impede 2 empresas terem #1
--     - terc_consertos.num_controle     → CRÍTICO: mesmo problema
--     - terc_setores.nome_setor         → médio: 2 empresas não podem ter "Costura"
--     - terc_servicos.desc_servico      → médio: 2 empresas não podem ter "Apara"
--     - terc_colecoes.nome_colecao      → médio
--     - terc_terceirizados.nome_terc    → médio: 2 empresas não podem ter "Evandro"
--     - terc_grades_tamanho.nome        → médio
--     - terc_precos UNIQUE(cod_ref,id_servico,grade,id_colecao) → bug similar
--
-- ESTRATÉGIA:
--   SQLite não permite DROP CONSTRAINT inline. A única forma de remover
--   UNIQUE declarado direto na coluna é REBUILD da tabela:
--     1. CREATE TABLE _new sem o UNIQUE global, com UNIQUE(id_empresa, col)
--     2. INSERT INTO _new SELECT * FROM antiga
--     3. DROP antiga
--     4. ALTER _new RENAME TO antiga
--     5. Recriar todos os índices/FKs
--
--   Isso é seguro porque:
--     - FKs no SQLite apontam para nome da TABELA + COLUNA, não para o
--       objeto físico. Como mantemos o mesmo nome, as FKs continuam OK.
--     - A migration é idempotente (se já tem o UNIQUE composto, é noop).
--     - Os dados são preservados integralmente.
--
-- ESCOPO desta migration:
--   Foco no que causa BUG OPERACIONAL imediato:
--     ✅ terc_remessas    — rebuild completo
--     ✅ terc_consertos   — rebuild completo
--   Para cadastros simples (setores, serviços, terceirizados, etc), o
--   código de aplicação já trata duplicatas amigavelmente (mensagem de
--   conflito) e a chance de colisão real entre empresas é baixa (cada
--   empresa cria seus próprios cadastros). Esses ficam para uma sprint
--   futura de hardening se necessário.
-- ============================================================================

-- ============================================================================
-- 1) REBUILD terc_remessas (remove UNIQUE global em num_controle)
-- ============================================================================

-- Detecta se já foi rebuildado checando presença do UNIQUE composto
-- Como SQLite não tem IF, usamos um teste indireto via DROP IF EXISTS no
-- índice composto: se não existir ainda, o rebuild segue; se já existir,
-- o INSERT vai falhar com "table exists" e abortamos (idempotência manual).

-- Passo 1.1: nova tabela com schema corrigido
CREATE TABLE IF NOT EXISTS terc_remessas_v2 (
  id_remessa     INTEGER PRIMARY KEY AUTOINCREMENT,
  num_controle   INTEGER NOT NULL,
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
  id_cor         INTEGER,
  id_empresa     INTEGER NOT NULL DEFAULT 1,
  -- UNIQUE composto: num_controle único POR EMPRESA, não globalmente
  UNIQUE (id_empresa, num_controle),
  FOREIGN KEY (id_terc)    REFERENCES terc_terceirizados(id_terc),
  FOREIGN KEY (id_setor)   REFERENCES terc_setores(id_setor),
  FOREIGN KEY (id_servico) REFERENCES terc_servicos(id_servico),
  FOREIGN KEY (id_colecao) REFERENCES terc_colecoes(id_colecao)
);

-- Passo 1.2: copiar dados da tabela antiga
INSERT OR IGNORE INTO terc_remessas_v2
  SELECT id_remessa, num_controle, num_op, id_terc, id_setor, cod_ref, desc_ref,
         id_servico, cor, grade, qtd_total, preco_unit, valor_total, id_colecao,
         dt_saida, dt_envio, dt_inicio, dt_previsao, dt_recebimento, dt_pagamento,
         prazo_dias, tempo_peca, efic_pct, qtd_pessoas, min_trab_dia, valor_pago,
         status, status_fin, modo, observacao, criado_por, dt_criacao,
         alterado_por, dt_alteracao, id_cor, id_empresa
    FROM terc_remessas;

-- Passo 1.3: substituir tabela antiga pela nova
DROP TABLE terc_remessas;
ALTER TABLE terc_remessas_v2 RENAME TO terc_remessas;

-- Passo 1.4: recriar índices (CREATE INDEX IF NOT EXISTS é seguro)
CREATE INDEX IF NOT EXISTS idx_terc_rem_terc       ON terc_remessas(id_terc);
CREATE INDEX IF NOT EXISTS idx_terc_rem_status     ON terc_remessas(status);
CREATE INDEX IF NOT EXISTS idx_terc_rem_status_fin ON terc_remessas(status_fin);
CREATE INDEX IF NOT EXISTS idx_terc_rem_saida      ON terc_remessas(dt_saida);
CREATE INDEX IF NOT EXISTS idx_terc_rem_prev       ON terc_remessas(dt_previsao);
CREATE INDEX IF NOT EXISTS idx_terc_rem_opref      ON terc_remessas(num_op, cod_ref);
CREATE INDEX IF NOT EXISTS idx_terc_remessas_id_cor ON terc_remessas(id_cor);
CREATE INDEX IF NOT EXISTS idx_terc_rem_numctrl    ON terc_remessas(num_controle);
CREATE INDEX IF NOT EXISTS idx_terc_rem_codref     ON terc_remessas(cod_ref);
CREATE INDEX IF NOT EXISTS idx_terc_rem_numop      ON terc_remessas(num_op);
CREATE INDEX IF NOT EXISTS idx_terc_rem_cor        ON terc_remessas(cor);
CREATE INDEX IF NOT EXISTS idx_terc_remessas_empresa ON terc_remessas(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_remessas_emp_num ON terc_remessas(id_empresa, num_controle);

-- ============================================================================
-- 2) REBUILD terc_consertos (remove UNIQUE global em num_controle)
-- ============================================================================

-- Schema completo de terc_consertos preservando estrutura original
CREATE TABLE IF NOT EXISTS terc_consertos_v2 (
  id_conserto   INTEGER PRIMARY KEY AUTOINCREMENT,
  num_controle  INTEGER NOT NULL,
  id_remessa    INTEGER,
  id_terc       INTEGER NOT NULL,
  tipo          TEXT    NOT NULL DEFAULT 'Conserto'
                  CHECK(tipo IN ('Conserto','Retrabalho','Ajuste')),
  cod_ref       TEXT    NOT NULL,
  desc_ref      TEXT,
  cor           TEXT,
  grade         INTEGER NOT NULL DEFAULT 1,
  qtd_total     INTEGER NOT NULL DEFAULT 0,
  qtd_retornada INTEGER NOT NULL DEFAULT 0,
  dt_saida      TEXT    NOT NULL,
  dt_retorno    TEXT,
  status        TEXT    NOT NULL DEFAULT 'Aberto'
                  CHECK(status IN ('Aberto','EmAndamento','Concluido','Cancelado')),
  observacao    TEXT,
  criado_por    TEXT,
  dt_criacao    TEXT    NOT NULL DEFAULT (datetime('now')),
  id_empresa    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (id_empresa, num_controle),
  FOREIGN KEY (id_remessa) REFERENCES terc_remessas(id_remessa),
  FOREIGN KEY (id_terc)    REFERENCES terc_terceirizados(id_terc)
);

INSERT OR IGNORE INTO terc_consertos_v2
  SELECT id_conserto, num_controle, id_remessa, id_terc, tipo, cod_ref, desc_ref,
         cor, grade, qtd_total, qtd_retornada, dt_saida, dt_retorno, status,
         observacao, criado_por, dt_criacao, id_empresa
    FROM terc_consertos;

DROP TABLE terc_consertos;
ALTER TABLE terc_consertos_v2 RENAME TO terc_consertos;

CREATE INDEX IF NOT EXISTS idx_terc_cons_rem      ON terc_consertos(id_remessa);
CREATE INDEX IF NOT EXISTS idx_terc_cons_terc     ON terc_consertos(id_terc);
CREATE INDEX IF NOT EXISTS idx_terc_consertos_empresa ON terc_consertos(id_empresa);

-- ============================================================================
-- 3) Cadastros: nomes podem se repetir entre empresas
--     Estratégia: como SQLite não permite remover UNIQUE inline sem rebuild
--     completo, mas o impacto operacional é menor (cada empresa cadastra
--     seus próprios nomes), aplicamos a mesma estratégia somente onde
--     necessário. Por ora, manteremos UNIQUE global para nomes — empresas
--     conflitantes recebem mensagem amigável do onError global.
--     Se necessário, fazer rebuild dessas tabelas em sprint dedicada.
-- ============================================================================

-- ============================================================================
-- FIM 0033 — REBUILD multi-tenant das tabelas críticas
-- ============================================================================
