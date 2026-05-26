-- =============================================================================
-- Migration 0034 — REPARAÇÃO de Retornos órfãos (multi-tenant)
-- =============================================================================
-- Contexto:
-- Empresa principal (id=1) tem 167 remessas com status='Retornado' MAS sem
-- registro correspondente em terc_retornos. Esses dados são da planilha
-- legada "Kamylla v1.0" — remessas em modo "basico" sem grade detalhada.
--
-- Sintoma: tela /retornos vazia + cards zerados na empresa principal.
--
-- Solução: para CADA remessa Retornada que não tem retorno vinculado, criamos
-- um registro sintético em terc_retornos com:
--   - dt_retorno = dt_recebimento da remessa (ou dt_saida como fallback)
--   - qtd_boa    = qtd_total da remessa (assume 100% boas, sem refugo/conserto)
--   - qtd_total  = qtd_total da remessa
--   - valor_pago = valor_pago da remessa (preserva pagamento existente)
--   - dt_pagamento = dt_pagamento da remessa (preserva pagamento existente)
--   - observacao = '[Reparação automática 0034] Retorno reconstruído ...'
--
-- Critério rigoroso de tenant: aplica em TODAS as empresas, não apenas a 1.
-- Idempotente: NOT EXISTS garante que não duplica em re-execução.
-- =============================================================================

-- 1) Garantir colunas auxiliares (defensivo - caso schema esteja desatualizado)
-- (terc_retornos já tem id_empresa NOT NULL DEFAULT 1 pelo schema atual)

-- 2) Reconstrução: 1 retorno sintético por remessa órfã
INSERT INTO terc_retornos (
  id_remessa,
  dt_retorno,
  qtd_total,
  qtd_boa,
  qtd_refugo,
  qtd_conserto,
  valor_pago,
  dt_pagamento,
  observacao,
  criado_por,
  dt_criacao,
  id_empresa
)
SELECT
  r.id_remessa,
  COALESCE(r.dt_recebimento, r.dt_saida, date('now'))             AS dt_retorno,
  r.qtd_total                                                      AS qtd_total,
  r.qtd_total                                                      AS qtd_boa,
  0                                                                AS qtd_refugo,
  0                                                                AS qtd_conserto,
  COALESCE(r.valor_pago, 0)                                        AS valor_pago,
  r.dt_pagamento                                                   AS dt_pagamento,
  '[Reparação automática 0034] Retorno reconstruído a partir da remessa #'
    || r.num_controle
    || ' — dados legados sem grade detalhada.'                     AS observacao,
  'system:repair-0034'                                             AS criado_por,
  datetime('now')                                                  AS dt_criacao,
  r.id_empresa                                                     AS id_empresa
FROM terc_remessas r
WHERE r.status = 'Retornado'
  AND NOT EXISTS (
    SELECT 1
      FROM terc_retornos rt
     WHERE rt.id_remessa = r.id_remessa
       AND rt.id_empresa = r.id_empresa
  );

-- 3) Recalcular o valor_pago da remessa para garantir consistência KPI
-- Se a remessa tem valor_pago > 0 mas o retorno não tinha — agora ambos têm.
-- Não fazemos nada aqui — os valores já foram copiados acima.

-- 4) Backfill defensivo: garantir id_empresa em qualquer linha que esteja NULL
UPDATE terc_retornos        SET id_empresa = 1 WHERE id_empresa IS NULL;
UPDATE terc_retorno_itens   SET id_empresa = 1 WHERE id_empresa IS NULL;
UPDATE terc_retorno_item_grade SET id_empresa = 1 WHERE id_empresa IS NULL;

-- 5) Índices adicionais para a tela /retornos (caso ainda não existam)
CREATE INDEX IF NOT EXISTS idx_terc_retornos_emp_dt
  ON terc_retornos (id_empresa, dt_retorno DESC);
CREATE INDEX IF NOT EXISTS idx_terc_retornos_emp_pag
  ON terc_retornos (id_empresa, dt_pagamento);
