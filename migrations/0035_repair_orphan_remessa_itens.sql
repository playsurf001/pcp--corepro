-- =============================================================================
-- Migration 0035 — REPARAÇÃO de remessa_itens + grade órfãos (multi-tenant)
-- =============================================================================
-- Contexto:
-- A planilha legada "Kamylla v1.0" foi importada criando 193 linhas em
-- terc_remessas (header completo: cod_ref, cor, qtd_total, preco_unit,
-- valor_total, id_cor, num_op…) MAS NUNCA criou os registros filhos em
-- terc_remessa_itens (1 por produto+cor) nem terc_remessa_grade (1 por tamanho).
--
-- Sintoma: ao abrir a edição de remessa, todos os campos vêm zerados —
-- produto não vem selecionado, grade aparece com 0 em todos os tamanhos,
-- Total item: 0 pç, Valor: R$ 0,00. A linha aparece corretamente na grid
-- (porque a grid lê r.cod_ref/r.cor/r.qtd_total direto do header), mas o
-- modal de edição lê os filhos.
--
-- Auditoria PROD ANTES (id_empresa=1):
--   terc_remessas:           193
--   terc_remessa_itens:        0   ❌
--   terc_remessa_grade:        0   ❌
--   terc_remessa_item_grade:   0   ❌
--
-- Solução: para cada remessa que tem qtd_total>0 mas NENHUM item vinculado:
--   1) Criar 1 item em terc_remessa_itens preservando todos os dados do header
--   2) Criar 1 grade em terc_remessa_grade com tamanho='UNICO' e qtd=qtd_total
--   3) Criar 1 grade em terc_remessa_item_grade vinculando item↔tamanho UNICO
--
-- Isso garante:
--   - Modal de edição abre com produto, ref, cor, preço, quantidade preenchidos
--   - Romaneio gera corretamente
--   - Cálculos batem (qtd × preço = valor já existente no header)
--   - Tela /retornos continua funcionando (não depende disso)
--   - Idempotente: re-execução não duplica (NOT EXISTS guarda)
--   - Tenant-scoped: opera em TODAS as empresas, mas cada item leva o
--     id_empresa correto da remessa pai (sem cruzar tenants)
-- =============================================================================

-- 1) Criar 1 item por remessa órfã (sem itens vinculados)
INSERT INTO terc_remessa_itens (
  id_remessa, id_produto, cod_ref, desc_ref, id_servico, cor,
  grade_num, qtd_total, preco_unit, valor_total, tempo_peca,
  observacao, ordem, ativo, dt_criacao, id_grade_tamanho, num_op,
  id_cor, id_empresa
)
SELECT
  r.id_remessa,
  NULL                              AS id_produto,          -- legado: sem produto vinculado
  r.cod_ref,
  r.desc_ref,
  r.id_servico,
  r.cor,
  COALESCE(r.grade, 1)              AS grade_num,
  r.qtd_total,
  r.preco_unit,
  r.valor_total,
  r.tempo_peca,
  '[Reparação automática 0035] Item reconstruído a partir do header da remessa legada.' AS observacao,
  0                                 AS ordem,
  1                                 AS ativo,
  datetime('now')                   AS dt_criacao,
  NULL                              AS id_grade_tamanho,    -- frontend resolve via tamanhos da grade
  r.num_op,
  r.id_cor,
  r.id_empresa
FROM terc_remessas r
WHERE r.qtd_total > 0
  AND NOT EXISTS (
    SELECT 1 FROM terc_remessa_itens i
     WHERE i.id_remessa = r.id_remessa AND i.id_empresa = r.id_empresa
  );

-- 2) Criar 1 entry em terc_remessa_grade (tamanho='UNICO', qtd=qtd_total)
-- Só para remessas que agora têm pelo menos 1 item mas ainda não têm grade-header.
INSERT INTO terc_remessa_grade (id_remessa, tamanho, qtd, id_empresa)
SELECT
  r.id_remessa,
  'UNICO'                           AS tamanho,
  r.qtd_total                       AS qtd,
  r.id_empresa
FROM terc_remessas r
WHERE r.qtd_total > 0
  AND NOT EXISTS (
    SELECT 1 FROM terc_remessa_grade g
     WHERE g.id_remessa = r.id_remessa AND g.id_empresa = r.id_empresa
  );

-- 3) Criar 1 entry em terc_remessa_item_grade para cada item recém-criado
-- vinculando ao tamanho UNICO com a qtd_total daquele item.
-- (cada item de cada remessa recebe 1 linha de grade UNICO)
INSERT INTO terc_remessa_item_grade (id_item, tamanho, qtd, id_empresa)
SELECT
  i.id_item,
  'UNICO'                           AS tamanho,
  i.qtd_total                       AS qtd,
  i.id_empresa
FROM terc_remessa_itens i
WHERE i.observacao LIKE '[Reparação automática 0035]%'
  AND NOT EXISTS (
    SELECT 1 FROM terc_remessa_item_grade ig
     WHERE ig.id_item = i.id_item AND ig.id_empresa = i.id_empresa
  );

-- 4) Backfill defensivo: id_empresa em qualquer linha que esteja NULL
UPDATE terc_remessa_itens      SET id_empresa = 1 WHERE id_empresa IS NULL;
UPDATE terc_remessa_grade      SET id_empresa = 1 WHERE id_empresa IS NULL;
UPDATE terc_remessa_item_grade SET id_empresa = 1 WHERE id_empresa IS NULL;

-- 5) Índices adicionais para a edição de remessa (caso ainda não existam)
CREATE INDEX IF NOT EXISTS idx_terc_rem_itens_emp_rem_ativo
  ON terc_remessa_itens (id_empresa, id_remessa, ativo);
CREATE INDEX IF NOT EXISTS idx_terc_rem_grade_emp_rem_tam
  ON terc_remessa_grade (id_empresa, id_remessa, tamanho);
