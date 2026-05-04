-- Migration 0009 — Produtos: Serviço padrão e Tempo padrão
-- Permite associar a um produto um serviço/tempo padrão usados como sugestão
-- inicial em Nova Remessa (próxima etapa) e como base para o auto-preço.

ALTER TABLE terc_produtos ADD COLUMN id_servico_padrao INTEGER REFERENCES terc_servicos(id_servico);
ALTER TABLE terc_produtos ADD COLUMN tempo_padrao REAL;

CREATE INDEX IF NOT EXISTS idx_terc_produtos_servico ON terc_produtos(id_servico_padrao);
