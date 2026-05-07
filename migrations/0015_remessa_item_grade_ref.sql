-- =================================================================
-- Migration 0015 — Vínculo opcional do item da remessa com a grade de tamanho
-- =================================================================
-- Adiciona a coluna id_grade_tamanho em terc_remessa_itens para registrar
-- qual grade dinâmica (terc_grades_tamanho) foi usada na criação do item.
-- Permite reedição precisa e auditoria sem afetar dados legados.
-- =================================================================

ALTER TABLE terc_remessa_itens ADD COLUMN id_grade_tamanho INTEGER;

CREATE INDEX IF NOT EXISTS idx_terc_rem_item_grade_tam
  ON terc_remessa_itens(id_grade_tamanho);
