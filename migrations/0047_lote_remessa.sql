-- =============================================================================
-- Migration 0047 — LOTE DE REMESSA (CTRL único por referência)
-- =============================================================================
-- Contexto:
--   Antes deste hotfix, ao criar uma remessa com MÚLTIPLAS referências, o
--   sistema gravava 1 linha em terc_remessas (com 1 único num_controle/CTRL)
--   e N linhas em terc_remessa_itens — todas as referências compartilhavam
--   o MESMO CTRL na exibição (romaneio, listagem, relatórios, retornos).
--
--   Isso causava inconsistências:
--     • Rastreabilidade ruim (não dava para saber qual ref específica retornou)
--     • Pagamentos calculados em bloco em vez de por ref
--     • Auditoria pobre (1 evento para o conjunto)
--     • Relatórios mostrando dois itens com o mesmo CTRL
--
-- Solução (Opção C — híbrida):
--   • Adicionar coluna `lote_remessa_id` em terc_remessas (NULLABLE).
--   • Comportamento do backend a partir do HOTFIX 0047:
--       - 1 item       → 1 remessa, 1 CTRL, lote_remessa_id = NULL (idêntico ao legado)
--       - N itens (≥2) → N remessas (N CTRLs sequenciais), mesmo lote_remessa_id
--   • Cada CTRL agora é uma linha independente em terc_remessas, com seu
--     próprio retorno, pagamento, status e rastreabilidade — exatamente
--     como o usuário esperava.
--   • Romaneio PDF: gera 1 PDF agrupado pelo lote_remessa_id (multi-linhas
--     com o CTRL CORRETO em cada linha).
--
-- Compatibilidade (CRÍTICA — diretiva explícita do usuário):
--   • REGISTROS ANTIGOS NÃO SÃO ALTERADOS.
--   • Remessas legadas (com múltiplos itens compartilhando 1 CTRL) continuam
--     funcionando exatamente como antes — apenas têm `lote_remessa_id = NULL`.
--   • Retornos antigos, pagamentos antigos, relatórios antigos: zero impacto.
--
-- Multi-tenant:
--   • `lote_remessa_id` é único POR EMPRESA (não há UNIQUE no schema porque
--     N remessas compartilham o mesmo lote — o agrupamento é por igualdade).
--   • Geração do próximo `lote_remessa_id` segue o padrão MAX(...)+1 escopado
--     por id_empresa, igual a `num_controle`.
--
-- Reversível:
--   • Para reverter: ALTER TABLE terc_remessas DROP COLUMN lote_remessa_id;
--     (SQLite >= 3.35 suporta; em versões antigas, recriar a tabela).
-- =============================================================================

-- 1) Adiciona coluna lote_remessa_id (NULLABLE — não quebra registros legados)
ALTER TABLE terc_remessas ADD COLUMN lote_remessa_id INTEGER;

-- 2) Índice para consultas "buscar todas as remessas do lote X da empresa Y"
--    (usado pelo romaneio agrupado e por relatórios futuros)
CREATE INDEX IF NOT EXISTS idx_terc_rem_lote
  ON terc_remessas(id_empresa, lote_remessa_id);

-- 3) Índice auxiliar para queries que pegam só remessas multi-CTRL
--    (lote_remessa_id IS NOT NULL) — útil para auditoria/dashboards futuros
CREATE INDEX IF NOT EXISTS idx_terc_rem_lote_notnull
  ON terc_remessas(id_empresa, lote_remessa_id)
  WHERE lote_remessa_id IS NOT NULL;
