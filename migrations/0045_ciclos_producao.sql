-- ============================================================
-- HOTFIX 0045 — Ciclos de Produção (Competências)
--
-- Tabela para registrar fechamentos de ciclo de produção.
-- Cada registro = um ciclo FECHADO. O ciclo "aberto" (atual) é
-- inferido como: período entre o último fechamento (ou primeiro
-- dia do mês corrente, se nunca fechou) e a data de hoje.
--
-- Garantias:
--   - Multi-tenant: id_empresa em todas as queries
--   - Zero impacto em terc_remessas / terc_retornos (NÃO altera dados)
--   - Snapshot dos KPIs no momento do fechamento (auditoria)
--   - Reversível: drop da tabela volta ao comportamento anterior
-- ============================================================

CREATE TABLE IF NOT EXISTS terc_ciclos_producao (
  id_ciclo       INTEGER PRIMARY KEY AUTOINCREMENT,
  id_empresa     INTEGER NOT NULL,

  -- Janela do ciclo (datas YYYY-MM-DD)
  dt_inicio      TEXT    NOT NULL,
  dt_fim         TEXT    NOT NULL,

  -- Quem/quando fechou
  fechado_por    TEXT    NOT NULL,
  dt_fechamento  TEXT    NOT NULL DEFAULT (datetime('now')),

  -- Snapshot dos KPIs (capturado no momento do fechamento)
  -- JSON com: { remessas, pecas_enviadas, valor_total, em_aberto,
  --             concluidas, atrasadas, valor_pago_total, valor_a_pagar }
  snapshot_json  TEXT    NOT NULL DEFAULT '{}',

  -- Campos denormalizados para listagem rápida (sem precisar parsear JSON)
  total_remessas INTEGER NOT NULL DEFAULT 0,
  total_pecas    INTEGER NOT NULL DEFAULT 0,
  valor_total    REAL    NOT NULL DEFAULT 0,

  -- Observação opcional do usuário ao fechar
  observacao     TEXT
);

-- Índice para consulta rápida do último fechamento por empresa
CREATE INDEX IF NOT EXISTS idx_ciclos_empresa_dt
  ON terc_ciclos_producao(id_empresa, dt_fim DESC);

-- Índice para listagem cronológica
CREATE INDEX IF NOT EXISTS idx_ciclos_empresa_fechamento
  ON terc_ciclos_producao(id_empresa, dt_fechamento DESC);
