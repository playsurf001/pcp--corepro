-- =====================================================================
-- 0024_companies_plano_check.sql
-- Atualiza CHECK constraint de companies.plano para incluir 'premium'
-- e 'profissional' (códigos dos novos planos introduzidos em 0023).
-- =====================================================================
-- SQLite NÃO suporta ALTER TABLE para mudar CHECK. Solução: recriar a tabela
-- preservando todos os dados, com novo CHECK ampliado. Idempotente: ao final
-- a tabela tem exatamente o mesmo nome e schema esperado.
-- =====================================================================

-- D1 gerencia transações automaticamente em batch; não usar BEGIN/COMMIT.

-- 1) Cria tabela nova com schema expandido
CREATE TABLE companies_new (
  id_empresa     INTEGER PRIMARY KEY AUTOINCREMENT,
  nome           TEXT    NOT NULL,
  cnpj           TEXT,
  slug           TEXT    UNIQUE,
  logo_data      TEXT,
  logo_mime      TEXT,
  plano          TEXT    NOT NULL DEFAULT 'enterprise'
                 CHECK (plano IN ('trial','starter','profissional','premium','enterprise','suspended','professional')),
  status         TEXT    NOT NULL DEFAULT 'ativa'
                 CHECK (status IN ('ativa','trial','suspensa','cancelada')),
  trial_ate      TEXT,
  dt_criacao     TEXT    NOT NULL DEFAULT (datetime('now')),
  dt_atualizacao TEXT,
  telefone       TEXT,
  email_contato  TEXT,
  endereco       TEXT,
  cidade         TEXT,
  uf             TEXT,
  cep            TEXT,
  id_plano       INTEGER REFERENCES plans(id_plano),
  dt_suspensao   TEXT,
  bloqueada_em   TEXT,
  motivo_bloqueio TEXT
);

-- 2) Copia dados — note: TODAS as colunas listadas acima devem existir na tabela
--    original. As que foram adicionadas via ALTER em 0021/0022/0023 já existem.
INSERT INTO companies_new (
  id_empresa, nome, cnpj, slug, logo_data, logo_mime, plano, status, trial_ate,
  dt_criacao, dt_atualizacao,
  telefone, email_contato, endereco, cidade, uf, cep,
  id_plano, dt_suspensao, bloqueada_em, motivo_bloqueio
)
SELECT
  id_empresa, nome, cnpj, slug, logo_data, logo_mime, plano, status, trial_ate,
  dt_criacao, dt_atualizacao,
  telefone, email_contato, endereco, cidade, uf, cep,
  id_plano, dt_suspensao, bloqueada_em, motivo_bloqueio
FROM companies;

-- 3) Substitui tabela
DROP TABLE companies;
ALTER TABLE companies_new RENAME TO companies;

-- 4) Reindexar
CREATE INDEX IF NOT EXISTS idx_companies_plano    ON companies(id_plano);
CREATE INDEX IF NOT EXISTS idx_companies_status   ON companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_bloqueio ON companies(bloqueada_em) WHERE bloqueada_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_slug     ON companies(slug);
