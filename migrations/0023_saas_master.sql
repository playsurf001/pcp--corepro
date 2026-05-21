-- =====================================================================
-- 0023_saas_master.sql
-- SPRINT 1 — Estrutura SaaS: Super Admin Master + Planos + Assinaturas + Pagamentos
-- =====================================================================
-- Objetivo:
--   Transformar CorePro em SaaS multi-empresa profissional.
--   Esta migration cria SOMENTE a estrutura (DDL + seeds essenciais).
--   A lógica de cobrança PIX (Mercado Pago) e enforcement de limites
--   será adicionada em sprints futuros.
--
-- Tabelas criadas:
--   1) super_admins      — Administradores master (acesso /master/*)
--   2) plans             — Catálogo de planos (Starter/Profissional/Premium/Enterprise)
--   3) subscriptions     — Assinaturas de empresas (1 empresa = 1 sub ativa)
--   4) payments          — Histórico de pagamentos (PIX/manual)
--
-- Alterações em tabelas existentes:
--   • companies.id_plano       INTEGER  → referência ao plano vigente
--   • companies.dt_suspensao   TEXT     → marca quando foi suspensa
--   • companies.bloqueada_em   TEXT     → bloqueio admin (independe de status)
--   • companies.motivo_bloqueio TEXT
-- =====================================================================

-- =====================================================================
-- 1) SUPER ADMINS — usuários com acesso à área /master
-- =====================================================================
CREATE TABLE IF NOT EXISTS super_admins (
  id_super       INTEGER PRIMARY KEY AUTOINCREMENT,
  login          TEXT    NOT NULL UNIQUE,
  nome           TEXT    NOT NULL,
  email          TEXT,
  salt           TEXT    NOT NULL,
  senha_hash     TEXT    NOT NULL,
  ativo          INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  ultimo_acesso  TEXT,
  dt_criacao     TEXT    NOT NULL DEFAULT (datetime('now')),
  dt_atualizacao TEXT
);

CREATE INDEX IF NOT EXISTS idx_super_admins_login ON super_admins(login);
CREATE INDEX IF NOT EXISTS idx_super_admins_ativo ON super_admins(ativo) WHERE ativo = 1;

-- Sessões separadas dos super_admins (não compartilha com sessoes de empresas)
CREATE TABLE IF NOT EXISTS super_admin_sessoes (
  token       TEXT    PRIMARY KEY,
  id_super    INTEGER NOT NULL,
  expira_em   TEXT    NOT NULL,
  dt_criacao  TEXT    NOT NULL DEFAULT (datetime('now')),
  ip          TEXT,
  user_agent  TEXT,
  FOREIGN KEY (id_super) REFERENCES super_admins(id_super) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_super_sessoes_super ON super_admin_sessoes(id_super);
CREATE INDEX IF NOT EXISTS idx_super_sessoes_expira ON super_admin_sessoes(expira_em);

-- =====================================================================
-- 2) PLANS — catálogo de planos
-- =====================================================================
CREATE TABLE IF NOT EXISTS plans (
  id_plano         INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo           TEXT    NOT NULL UNIQUE,    -- 'starter','profissional','premium','enterprise','trial'
  nome             TEXT    NOT NULL,
  descricao        TEXT,
  preco_mensal     REAL    NOT NULL DEFAULT 0,
  -- limites (-1 = ilimitado)
  max_usuarios       INTEGER NOT NULL DEFAULT -1,
  max_remessas_mes   INTEGER NOT NULL DEFAULT -1,
  max_terceirizados  INTEGER NOT NULL DEFAULT -1,
  max_storage_mb     INTEGER NOT NULL DEFAULT -1,
  -- features liberadas (flags)
  feat_relatorios_avancados INTEGER NOT NULL DEFAULT 0 CHECK (feat_relatorios_avancados IN (0,1)),
  feat_api                  INTEGER NOT NULL DEFAULT 0 CHECK (feat_api IN (0,1)),
  feat_export_excel         INTEGER NOT NULL DEFAULT 1 CHECK (feat_export_excel IN (0,1)),
  feat_audit_log            INTEGER NOT NULL DEFAULT 0 CHECK (feat_audit_log IN (0,1)),
  feat_multi_filial         INTEGER NOT NULL DEFAULT 0 CHECK (feat_multi_filial IN (0,1)),
  -- visibilidade
  visivel          INTEGER NOT NULL DEFAULT 1 CHECK (visivel IN (0,1)),
  ordem            INTEGER NOT NULL DEFAULT 0,
  dt_criacao       TEXT    NOT NULL DEFAULT (datetime('now')),
  dt_atualizacao   TEXT
);

CREATE INDEX IF NOT EXISTS idx_plans_codigo  ON plans(codigo);
CREATE INDEX IF NOT EXISTS idx_plans_visivel ON plans(visivel) WHERE visivel = 1;

-- =====================================================================
-- 3) SUBSCRIPTIONS — assinaturas (1 empresa pode ter 1 ativa)
-- =====================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id_sub           INTEGER PRIMARY KEY AUTOINCREMENT,
  id_empresa       INTEGER NOT NULL,
  id_plano         INTEGER NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'ativa'
                   CHECK (status IN ('trial','ativa','pendente','suspensa','cancelada','expirada')),
  ciclo            TEXT    NOT NULL DEFAULT 'mensal'
                   CHECK (ciclo IN ('mensal','trimestral','anual')),
  preco_aplicado   REAL    NOT NULL DEFAULT 0,    -- snapshot do preço no momento da assinatura
  dt_inicio        TEXT    NOT NULL DEFAULT (datetime('now')),
  dt_proxima_cobranca TEXT,
  dt_fim           TEXT,                          -- preenchido quando cancela/expira
  trial_ate        TEXT,                          -- duplica companies.trial_ate para histórico
  observacao       TEXT,
  criado_por       TEXT,                          -- login super_admin que criou
  dt_criacao       TEXT    NOT NULL DEFAULT (datetime('now')),
  dt_atualizacao   TEXT,
  FOREIGN KEY (id_empresa) REFERENCES companies(id_empresa) ON DELETE CASCADE,
  FOREIGN KEY (id_plano)   REFERENCES plans(id_plano)
);

CREATE INDEX IF NOT EXISTS idx_sub_empresa ON subscriptions(id_empresa);
CREATE INDEX IF NOT EXISTS idx_sub_status  ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_sub_cobranca ON subscriptions(dt_proxima_cobranca) WHERE status = 'ativa';
-- Apenas UMA subscription ATIVA/TRIAL por empresa
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_empresa_ativa
  ON subscriptions(id_empresa)
  WHERE status IN ('ativa','trial','pendente');

-- =====================================================================
-- 4) PAYMENTS — pagamentos (PIX + manual)
-- =====================================================================
CREATE TABLE IF NOT EXISTS payments (
  id_payment       INTEGER PRIMARY KEY AUTOINCREMENT,
  id_sub           INTEGER NOT NULL,
  id_empresa       INTEGER NOT NULL,
  metodo           TEXT    NOT NULL DEFAULT 'pix'
                   CHECK (metodo IN ('pix','boleto','cartao','manual','cortesia')),
  status           TEXT    NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','aprovado','rejeitado','cancelado','expirado','reembolsado')),
  valor            REAL    NOT NULL DEFAULT 0,
  moeda            TEXT    NOT NULL DEFAULT 'BRL',
  -- Mercado Pago
  mp_payment_id    TEXT,                          -- id do MP quando criado
  mp_status        TEXT,
  mp_qr_code       TEXT,                          -- payload PIX (copia-e-cola)
  mp_qr_base64     TEXT,                          -- QR base64 (lazy load via endpoint)
  mp_link          TEXT,                          -- ticket_url do MP
  -- Datas
  dt_referencia    TEXT,                          -- mês referência (YYYY-MM)
  dt_vencimento    TEXT,
  dt_pagamento     TEXT,
  dt_expiracao     TEXT,
  -- Auditoria
  observacao       TEXT,
  registrado_por   TEXT,                          -- login (super_admin ou system)
  dt_criacao       TEXT    NOT NULL DEFAULT (datetime('now')),
  dt_atualizacao   TEXT,
  FOREIGN KEY (id_sub)     REFERENCES subscriptions(id_sub) ON DELETE CASCADE,
  FOREIGN KEY (id_empresa) REFERENCES companies(id_empresa) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pay_empresa  ON payments(id_empresa);
CREATE INDEX IF NOT EXISTS idx_pay_sub      ON payments(id_sub);
CREATE INDEX IF NOT EXISTS idx_pay_status   ON payments(status);
CREATE INDEX IF NOT EXISTS idx_pay_mp       ON payments(mp_payment_id) WHERE mp_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pay_referencia ON payments(dt_referencia);

-- =====================================================================
-- 5) Adicionar colunas em companies
--    SQLite não suporta ADD COLUMN IF NOT EXISTS — tentativas com erro
--    serão "ignoradas" pelo wrangler quando a coluna já existir? NÃO.
--    Estratégia: criar bloco PRAGMA-safe usando subqueries não pode no SQLite.
--    Solução pragmática: usar comandos que falham silenciosamente em D1 não
--    funciona — então mantemos a migration garantida para uma execução só.
-- =====================================================================
ALTER TABLE companies ADD COLUMN id_plano INTEGER REFERENCES plans(id_plano);
ALTER TABLE companies ADD COLUMN dt_suspensao TEXT;
ALTER TABLE companies ADD COLUMN bloqueada_em TEXT;
ALTER TABLE companies ADD COLUMN motivo_bloqueio TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_plano       ON companies(id_plano);
CREATE INDEX IF NOT EXISTS idx_companies_status      ON companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_bloqueio    ON companies(bloqueada_em) WHERE bloqueada_em IS NOT NULL;

-- =====================================================================
-- 6) SEEDS — 4 planos canônicos + 1 trial + super_admin master
-- =====================================================================

-- Plans (idempotente via codigo UNIQUE)
INSERT OR IGNORE INTO plans
  (codigo, nome, descricao, preco_mensal,
   max_usuarios, max_remessas_mes, max_terceirizados, max_storage_mb,
   feat_relatorios_avancados, feat_api, feat_export_excel, feat_audit_log, feat_multi_filial,
   visivel, ordem)
VALUES
  ('trial',        'Período de Teste',
   '14 dias gratuitos com acesso completo ao plano Profissional.', 0,
   3, 50, 10, 100,
   1, 0, 1, 1, 0,
   0, 0),

  ('starter',      'Starter',
   'Para microempresas começarem: 2 usuários, 100 remessas/mês.', 49.90,
   2, 100, 20, 200,
   0, 0, 1, 0, 0,
   1, 1),

  ('profissional', 'Profissional',
   'Para confecções em crescimento: 5 usuários, 500 remessas/mês, relatórios avançados.', 99.90,
   5, 500, 50, 1000,
   1, 0, 1, 1, 0,
   1, 2),

  ('premium',      'Premium',
   'Para operações estabelecidas: 15 usuários, 2.000 remessas/mês, API, auditoria.', 199.90,
   15, 2000, 200, 5000,
   1, 1, 1, 1, 1,
   1, 3),

  ('enterprise',   'Enterprise',
   'Recursos ilimitados, suporte dedicado, SLA. Sob consulta.', 499.90,
   -1, -1, -1, -1,
   1, 1, 1, 1, 1,
   1, 4);

-- Super admin master (login: master, senha: master)
-- salt: '4d617374657253616c7432303236' (hex literal, opaco)
-- hashSenha(salt, senha) = SHA-256(salt + ':' + senha) em hex
-- Gerado com:
--   crypto.createHash('sha256').update('4d617374657253616c7432303236:master').digest('hex')
INSERT OR IGNORE INTO super_admins (login, nome, email, salt, senha_hash, ativo)
VALUES (
  'master',
  'Administrador Master',
  'master@corepro.local',
  '4d617374657253616c7432303236',
  '1bf9c5b7b1f6cfe867e3c6aa6a9e6aba1ce24afd2bec67e94654584e03fb4a6c',
  1
);

-- =====================================================================
-- 7) Vincular empresa default (id=1) ao plano Enterprise + criar subscription
-- =====================================================================
UPDATE companies
   SET id_plano = (SELECT id_plano FROM plans WHERE codigo = 'enterprise')
 WHERE id_empresa = 1 AND id_plano IS NULL;

-- Subscription ativa para empresa 1 (cortesia / enterprise)
INSERT OR IGNORE INTO subscriptions
  (id_empresa, id_plano, status, ciclo, preco_aplicado, dt_inicio, criado_por, observacao)
SELECT
  1,
  (SELECT id_plano FROM plans WHERE codigo = 'enterprise'),
  'ativa',
  'mensal',
  0,
  datetime('now'),
  'system',
  'Empresa fundadora — cortesia vitalícia (CorePro Confecção)'
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions WHERE id_empresa = 1 AND status IN ('ativa','trial','pendente')
);
