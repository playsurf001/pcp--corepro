-- =====================================================================
-- 0025_usuarios_login_per_empresa.sql
-- SPRINT 4 — Reservado para futura mudança de UNIQUE composto
-- =====================================================================
-- DECISÃO PRAGMÁTICA:
--   Manter `usuarios.login UNIQUE` GLOBAL por enquanto. A lógica de
--   signup (signup.ts) garante unicidade global anexando sufixo
--   randômico quando há colisão. Isso evita rebuild da tabela
--   (que envolveria recriar FKs em sessoes/auditoria).
--
-- Esta migration é um "no-op" que apenas registra que o assunto foi
-- considerado e a decisão tomada. Quando precisarmos de UNIQUE composto
-- (caso users queiram repetir 'admin' em empresas diferentes), faremos
-- num sprint dedicado com plano de rebuild + recriação de FKs.
-- =====================================================================

-- No-op: cria um índice auxiliar não-UNIQUE que apenas documenta o caso.
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_login
  ON usuarios (id_empresa, lower(login));
