-- =====================================================================
-- Migration 0048 — HOTFIX 0048: Sincronizar num_op do header com o item
-- =====================================================================
-- CONTEXTO:
--   O HOTFIX 0047 introduziu o caminho multi-CTRL (1 remessa por item,
--   todas com o mesmo lote_remessa_id). Devido a um bug no helper
--   persistirRemessaUnitaria(), TODAS as remessas do lote eram inseridas
--   com `num_op = b.num_op` (OP global do form), em vez de `it.num_op`
--   (OP do item específico). Resultado: CTRL X com item ref Y/OP A pode
--   ter ficado gravado no header como `num_op = B` (a OP do form/último).
--
-- ESCOPO DESTA CORREÇÃO (DATA FIX):
--   - Atua APENAS em remessas pertencentes a um lote (lote_remessa_id
--     NOT NULL) -> não toca remessas pré-HOTFIX 0047
--   - Atua APENAS em remessas com EXATAMENTE 1 item ativo (multi-CTRL=1:1)
--   - Atua APENAS quando há divergência entre item.num_op e header.num_op
--   - Atua APENAS quando o item tem num_op preenchido
--
-- O QUE NÃO MUDA:
--   - CTRLs (num_controle), retornos, pagamentos, alertas, eventos,
--     auditoria, remessas legadas, remessas com múltiplos itens.
--
-- IDEMPOTENTE: pode ser reaplicada sem efeito.
-- TENANT-SCOPED: comparações por id_empresa em todos os subqueries.
-- =====================================================================

UPDATE terc_remessas
SET    num_op = (
         SELECT i.num_op
           FROM terc_remessa_itens i
          WHERE i.id_remessa = terc_remessas.id_remessa
            AND i.id_empresa = terc_remessas.id_empresa
            AND i.ativo = 1
          LIMIT 1
       )
WHERE  lote_remessa_id IS NOT NULL
  AND  EXISTS (
         SELECT 1 FROM terc_remessa_itens i
          WHERE i.id_remessa = terc_remessas.id_remessa
            AND i.id_empresa = terc_remessas.id_empresa
            AND i.ativo = 1
            AND TRIM(COALESCE(i.num_op, '')) <> ''
            AND TRIM(COALESCE(i.num_op, '')) <> TRIM(COALESCE(terc_remessas.num_op, ''))
       )
  AND  (
         SELECT COUNT(*) FROM terc_remessa_itens i
          WHERE i.id_remessa = terc_remessas.id_remessa
            AND i.id_empresa = terc_remessas.id_empresa
            AND i.ativo = 1
       ) = 1;
