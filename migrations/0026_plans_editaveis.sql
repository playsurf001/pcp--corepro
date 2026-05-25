-- =====================================================================
-- 0026_plans_editaveis.sql
-- SPRINT A — Planos totalmente editáveis pelo Master
-- =====================================================================
-- Objetivo: tornar a tabela `plans` (criada em 0023) gerenciável via UI
-- pelo administrador master. Adicionar campos visuais e de marketing,
-- além de features adicionais solicitadas:
--   • cor             — cor visual do plano (hex)
--   • destaque        — flag "plano em destaque" para landing
--   • ativo           — soft delete (separado de "visivel" que é vitrine)
--   • feat_dashboard  — habilita módulo de dashboard
--   • feat_romaneio   — habilita impressão de romaneio
--   • feat_export_pdf — habilita exportação PDF (export_excel já existe)
--   • feat_backup     — habilita backup manual
--   • feat_personalizacao — tema/logo da empresa
--   • feat_suporte_prioritario — atendimento prioritário
--   • trial_dias      — quantidade de dias trial do plano (default 30 conforme decisão)
-- =====================================================================
-- IMPORTANTE: D1 não suporta ALTER ADD COLUMN IF NOT EXISTS, e as migrations
-- são aplicadas uma única vez (controle pelo wrangler). Por isso usamos
-- ALTER TABLE direto. Se uma coluna já existir (de teste manual), reaplicar
-- esta migration falhará — neste caso basta marcar como aplicada na tabela
-- de controle do D1.
-- =====================================================================

-- Campos visuais / marketing
ALTER TABLE plans ADD COLUMN cor              TEXT    NOT NULL DEFAULT '#7c3aed';
ALTER TABLE plans ADD COLUMN destaque         INTEGER NOT NULL DEFAULT 0 CHECK (destaque IN (0,1));
ALTER TABLE plans ADD COLUMN ativo            INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1));
ALTER TABLE plans ADD COLUMN trial_dias       INTEGER NOT NULL DEFAULT 30;

-- Features adicionais
ALTER TABLE plans ADD COLUMN feat_dashboard          INTEGER NOT NULL DEFAULT 1 CHECK (feat_dashboard IN (0,1));
ALTER TABLE plans ADD COLUMN feat_romaneio           INTEGER NOT NULL DEFAULT 1 CHECK (feat_romaneio IN (0,1));
ALTER TABLE plans ADD COLUMN feat_export_pdf         INTEGER NOT NULL DEFAULT 1 CHECK (feat_export_pdf IN (0,1));
ALTER TABLE plans ADD COLUMN feat_backup             INTEGER NOT NULL DEFAULT 0 CHECK (feat_backup IN (0,1));
ALTER TABLE plans ADD COLUMN feat_personalizacao     INTEGER NOT NULL DEFAULT 0 CHECK (feat_personalizacao IN (0,1));
ALTER TABLE plans ADD COLUMN feat_suporte_prioritario INTEGER NOT NULL DEFAULT 0 CHECK (feat_suporte_prioritario IN (0,1));
ALTER TABLE plans ADD COLUMN feat_financeiro         INTEGER NOT NULL DEFAULT 1 CHECK (feat_financeiro IN (0,1));

-- Índices
CREATE INDEX IF NOT EXISTS idx_plans_ativo    ON plans(ativo) WHERE ativo = 1;
CREATE INDEX IF NOT EXISTS idx_plans_destaque ON plans(destaque) WHERE destaque = 1;

-- =====================================================================
-- Backfill: atualizar planos existentes com cores e features padrão
-- =====================================================================
UPDATE plans SET cor = '#94a3b8', trial_dias = 30  WHERE codigo = 'trial';
UPDATE plans SET cor = '#3b82f6', trial_dias = 30  WHERE codigo = 'starter';
UPDATE plans SET cor = '#7c3aed', trial_dias = 30, destaque = 1  WHERE codigo = 'profissional';
UPDATE plans SET cor = '#a855f7', trial_dias = 30  WHERE codigo = 'premium';
UPDATE plans SET cor = '#f59e0b', trial_dias = 30  WHERE codigo = 'enterprise';

-- Premium/Enterprise ganham todas as features extras
UPDATE plans SET
  feat_backup = 1,
  feat_personalizacao = 1,
  feat_suporte_prioritario = 1
WHERE codigo IN ('premium', 'enterprise');

-- =====================================================================
-- FIM 0026
-- =====================================================================
