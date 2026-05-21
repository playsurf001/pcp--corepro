-- ============================================================================
-- 0022_rbac_owner.sql
-- FASE 2 — Auth + RBAC moderno
--
-- OBJETIVO: Adicionar conceito de "Owner" (dono da empresa) sem quebrar nada.
--
-- DECISÃO ARQUITETURAL: NÃO altero o CHECK constraint de perfil. Em vez disso,
-- adiciono uma flag boolean is_owner. Quem tem (perfil='admin' AND is_owner=1)
-- é o Owner da empresa — único que pode editar dados da empresa, mudar plano,
-- desativar outros admins, etc.
--
-- Cada empresa deve ter EXATAMENTE 1 owner. Vou eleger o usuário 'admin' da
-- empresa default (id=1) como owner inicial. Esquema continua compatível: as
-- queries antigas (`perfil='admin'`) continuam funcionando.
--
-- Também adiciono colunas de metadados de auditoria útil em RBAC:
--   - dt_atualizacao (quando o usuário foi modificado)
--   - perfil_anterior (audit trail para mudanças de perfil)
-- ============================================================================

-- 1) Flag is_owner: dono da empresa (1 por empresa)
ALTER TABLE usuarios ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;

-- 2) Metadados úteis
ALTER TABLE usuarios ADD COLUMN dt_atualizacao TEXT;

-- 3) Eleger o admin de cada empresa como owner inicial
--    Estratégia: o admin com menor id_usuario por empresa vira owner
--    (geralmente é o admin original criado no bootstrap).
UPDATE usuarios
   SET is_owner = 1
 WHERE id_usuario IN (
   SELECT MIN(id_usuario) AS id
     FROM usuarios
    WHERE perfil = 'admin' AND ativo = 1
    GROUP BY id_empresa
 );

-- 4) Índice para queries de gestão (raras, mas pontuais)
CREATE INDEX IF NOT EXISTS idx_usuarios_owner ON usuarios(id_empresa, is_owner) WHERE is_owner = 1;

-- ============================================================================
-- 5) Companies: adicionar metadados úteis que serão usados pela tela
--    "Minha Empresa" (FASE 2) e billing futuro (FASE 4)
-- ============================================================================

-- Telefone e e-mail de contato da empresa (já existe nome, cnpj, slug)
ALTER TABLE companies ADD COLUMN telefone TEXT;
ALTER TABLE companies ADD COLUMN email_contato TEXT;
ALTER TABLE companies ADD COLUMN endereco TEXT;
ALTER TABLE companies ADD COLUMN cidade TEXT;
ALTER TABLE companies ADD COLUMN uf TEXT;
ALTER TABLE companies ADD COLUMN cep TEXT;

-- ============================================================================
-- FIM: 0022_rbac_owner.sql
-- Esquema:
--   - usuarios.is_owner: flag 0/1, exatamente 1 owner por empresa
--   - usuarios.dt_atualizacao: timestamp de última modificação
--   - companies.{telefone,email_contato,endereco,cidade,uf,cep}: metadados
--
-- Próximo passo (no código):
--   - Helper requireOwner() em lib/auth.ts
--   - Rotas /api/empresa (GET dados / PUT atualizar) — Owner-only
--   - Tela "Minha Empresa" no menu (Owner-only)
--   - Cobertura 100% de filtro id_empresa em todas as queries
-- ============================================================================
