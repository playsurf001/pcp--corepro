-- =================================================================
-- 0017 — Nº OP por item de remessa
-- Adiciona coluna num_op na tabela terc_remessa_itens para permitir
-- que cada produto da remessa tenha seu próprio Nº OP (com herança
-- automática do Nº OP principal e edição manual individual).
-- =================================================================

ALTER TABLE terc_remessa_itens ADD COLUMN num_op TEXT;

-- Índice para busca/filtragem por OP de item
CREATE INDEX IF NOT EXISTS idx_terc_rem_item_op ON terc_remessa_itens(num_op);

-- Backfill: itens existentes herdam o num_op da sua remessa
UPDATE terc_remessa_itens
   SET num_op = (
     SELECT r.num_op FROM terc_remessas r
      WHERE r.id_remessa = terc_remessa_itens.id_remessa
   )
 WHERE num_op IS NULL;
