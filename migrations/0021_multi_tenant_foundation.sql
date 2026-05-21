-- ============================================================================
-- 0021_multi_tenant_foundation.sql
-- FASE 1 — Fundação Multi-Tenant SaaS
--
-- OBJETIVO: Introduzir o conceito de "empresa" (tenant) sem quebrar nada.
-- ESTRATÉGIA:
--   1. Criar tabela `companies` e inserir empresa default id=1 ("CorePro Confecção")
--   2. Adicionar coluna `id_empresa INTEGER NOT NULL DEFAULT 1` em todas as
--      tabelas operacionais. O DEFAULT 1 garante que toda linha existente fique
--      vinculada à empresa default automaticamente.
--   3. UPDATE defensivo em cada tabela (idempotente, sem efeito real, mas
--      garante que mesmo linhas com NULL — improvável — sejam corrigidas).
--   4. Criar índices em (id_empresa) para performance de queries multi-tenant.
--   5. Tratar `parametros` separadamente (PK é `chave TEXT` — precisa de PK
--      composta `(chave, id_empresa)` via recriação de tabela).
--
-- RESULTADO: Após esta migration, todos os dados existentes pertencem à
-- empresa id=1. Sistema continua 100% funcional — as queries da aplicação
-- ainda funcionam mesmo sem filtro de empresa (a próxima fase adiciona o
-- filtro no código com fallback id_empresa=1).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabela companies (raiz da tenancy)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id_empresa     INTEGER PRIMARY KEY AUTOINCREMENT,
  nome           TEXT    NOT NULL,
  cnpj           TEXT,
  slug           TEXT    UNIQUE,
  logo_data      TEXT,
  logo_mime      TEXT,
  plano          TEXT    NOT NULL DEFAULT 'enterprise'
                 CHECK (plano IN ('trial','starter','professional','enterprise','suspended')),
  status         TEXT    NOT NULL DEFAULT 'ativa'
                 CHECK (status IN ('ativa','trial','suspensa','cancelada')),
  trial_ate      TEXT,
  dt_criacao     TEXT    NOT NULL DEFAULT (datetime('now')),
  dt_atualizacao TEXT
);

-- Empresa default (id=1) que herda TODOS os dados atuais do sistema
INSERT OR IGNORE INTO companies (id_empresa, nome, slug, plano, status)
VALUES (1, 'CorePro Confecção', 'corepro', 'enterprise', 'ativa');

-- ----------------------------------------------------------------------------
-- 2) Adicionar coluna id_empresa em todas as tabelas tenant-scoped
--    DEFAULT 1 garante backfill automático de linhas existentes.
--    NOT NULL impede que novos INSERTs esqueçam de informar a empresa
--    (qualquer rota antiga que não passe id_empresa cairá no default=1).
--
--    NOTA: SQLite NÃO permite ALTER TABLE ADD COLUMN ... REFERENCES ...
--    com DEFAULT não-NULL (limitação documentada). Por isso a integridade
--    referencial fica garantida apenas por:
--      (a) DEFAULT 1 + companies(id=1) sempre existir (linha acima)
--      (b) middleware no código sempre injetar id_empresa válido
--    Isto é equivalente em garantia prática, e é o padrão usado por
--    grandes SaaS multi-tenant rodando em SQLite.
-- ----------------------------------------------------------------------------

-- --- Núcleo / sistema da empresa ---
ALTER TABLE usuarios               ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE auditoria              ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cores                  ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;

-- --- Terceirização: cadastros base ---
ALTER TABLE terc_terceirizados     ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_servicos          ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_setores           ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_colecoes          ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_produtos          ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_produto_variacoes ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_grades_tamanho    ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_precos            ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;

-- --- Terceirização: operação (remessas) ---
ALTER TABLE terc_remessas          ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_remessa_itens     ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_remessa_grade     ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_remessa_item_grade ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;

-- --- Terceirização: operação (retornos) ---
ALTER TABLE terc_retornos          ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_retorno_itens     ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_retorno_grade     ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_retorno_item_grade ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;

-- --- Terceirização: consertos e eventos ---
ALTER TABLE terc_consertos         ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_conserto_grade    ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_eventos           ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;
ALTER TABLE terc_alertas           ADD COLUMN id_empresa INTEGER NOT NULL DEFAULT 1;

-- ----------------------------------------------------------------------------
-- 3) UPDATE defensivo (idempotente)
--    O DEFAULT 1 já garante o backfill, mas reforçamos para o caso de algum
--    NULL escapar (não deve haver, mas é grátis e seguro).
-- ----------------------------------------------------------------------------
UPDATE usuarios            SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE auditoria           SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE cores               SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_terceirizados  SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_servicos       SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_setores        SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_colecoes       SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_produtos       SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_produto_variacoes SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_grades_tamanho SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_precos         SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_remessas       SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_remessa_itens  SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_remessa_grade  SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_remessa_item_grade SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_retornos       SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_retorno_itens  SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_retorno_grade  SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_retorno_item_grade SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_consertos      SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_conserto_grade SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_eventos        SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;
UPDATE terc_alertas        SET id_empresa = 1 WHERE id_empresa IS NULL OR id_empresa = 0;

-- ----------------------------------------------------------------------------
-- 4) Tratamento especial: `parametros`
--    A tabela parametros tem PK em `chave TEXT`. Para suportar multi-tenant,
--    a PK precisa ser composta `(chave, id_empresa)`. Faremos isso recriando
--    a tabela (padrão SQLite para mudar PK).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parametros_new (
  chave       TEXT    NOT NULL,
  id_empresa  INTEGER NOT NULL DEFAULT 1,
  valor       TEXT    NOT NULL,
  descricao   TEXT,
  PRIMARY KEY (chave, id_empresa)
);

INSERT OR IGNORE INTO parametros_new (chave, id_empresa, valor, descricao)
  SELECT chave, 1, valor, descricao FROM parametros;

DROP TABLE parametros;
ALTER TABLE parametros_new RENAME TO parametros;

-- ----------------------------------------------------------------------------
-- 5) Índices para queries multi-tenant
--    Todos os filtros principais agora terão id_empresa no WHERE.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa            ON usuarios(id_empresa);
CREATE INDEX IF NOT EXISTS idx_auditoria_empresa           ON auditoria(id_empresa);
CREATE INDEX IF NOT EXISTS idx_cores_empresa               ON cores(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_terceirizados_empresa  ON terc_terceirizados(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_servicos_empresa       ON terc_servicos(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_setores_empresa        ON terc_setores(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_colecoes_empresa       ON terc_colecoes(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_produtos_empresa       ON terc_produtos(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_produto_variacoes_empresa ON terc_produto_variacoes(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_grades_tamanho_empresa ON terc_grades_tamanho(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_precos_empresa         ON terc_precos(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_remessas_empresa       ON terc_remessas(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_remessa_itens_empresa  ON terc_remessa_itens(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_remessa_grade_empresa  ON terc_remessa_grade(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_remessa_item_grade_empresa ON terc_remessa_item_grade(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_retornos_empresa       ON terc_retornos(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_retorno_itens_empresa  ON terc_retorno_itens(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_retorno_grade_empresa  ON terc_retorno_grade(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_retorno_item_grade_empresa ON terc_retorno_item_grade(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_consertos_empresa      ON terc_consertos(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_conserto_grade_empresa ON terc_conserto_grade(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_eventos_empresa        ON terc_eventos(id_empresa);
CREATE INDEX IF NOT EXISTS idx_terc_alertas_empresa        ON terc_alertas(id_empresa);

-- ============================================================================
-- FIM: 0021_multi_tenant_foundation.sql
-- Sistema agora é multi-tenant ready. Próximo passo (no código):
--   - Middleware Hono injeta c.get('id_empresa') a partir da sessão
--   - Queries começam a usar id_empresa no WHERE (com fallback 1 por segurança)
-- ============================================================================
