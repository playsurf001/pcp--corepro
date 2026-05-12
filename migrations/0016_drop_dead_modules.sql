-- =============================================================
-- Migration 0016 — Limpeza: remove tabelas de módulos descontinuados
-- =============================================================
-- Objetivo: enxugar o banco, deixando apenas o domínio de
-- TERCEIRIZAÇÃO + SISTEMA (auth/auditoria/parâmetros).
--
-- Estratégia (D1/SQLite):
--   D1 executa migrations dentro de uma transação implícita com
--   PRAGMA foreign_keys=ON. Portanto: 1) DELETE em ORDEM TOPOLÓGICA
--   correta (filhos antes de pais) e 2) DROP TABLE IF EXISTS na
--   mesma ordem topológica. Esta migration é IDEMPOTENTE.
--
-- Grafo de FKs real (filho -> pai), extraído via inspeção schema:
--   defeitos_registro    -> tipos_defeito, apontamento_sessao, apontamento
--   apontamento          -> op_cab, seq_itens, colaboradores, setores
--   apontamento_sessao   -> op_cab, seq_itens, colaboradores
--   bonificacao_mes      -> colaboradores
--   op_cores             -> op_cab, cores
--   op_tamanhos          -> op_cab, tamanhos
--   op_cab               -> referencias, clientes, seq_cab
--   seq_itens            -> seq_cab, operacoes, maquinas, aparelhos
--   seq_cab              -> referencias
--   operacoes            -> setores, maquinas, aparelhos   ⚠ crítico
--   colaboradores        -> setores
--
-- ORDEM TOPOLÓGICA CORRETA (filhos primeiro, pais por último):
--   1) defeitos_registro
--   2) bonificacao_mes
--   3) apontamento
--   4) apontamento_sessao
--   5) op_cores
--   6) op_tamanhos
--   7) op_cab
--   8) seq_itens
--   9) seq_cab
--  10) operacoes           ← antes de maquinas/aparelhos/setores!
--  11) colaboradores       ← antes de setores
--  12) tipos_defeito
--  13) aparelhos
--  14) clientes
--  15) cores
--  16) maquinas
--  17) referencias
--  18) setores             ← último dos pais
--  19) tamanhos
--
-- IMPORTANTE: Antes de aplicar em PRODUÇÃO, faça:
--   npx wrangler d1 export pcp-confeccao-prod --remote \
--     --output backup_pre_0016.sql
-- =============================================================

-- ===== 1) DELETE em ordem topológica (filhos primeiro) =====
-- O DELETE é necessário porque, mesmo IF EXISTS, o DROP TABLE
-- com FKs ativas pode falhar se a tabela-pai tiver linhas vivas
-- referenciadas. Limpando os dados primeiro, as FKs ficam órfãs
-- e o DROP a seguir é seguro.
DELETE FROM defeitos_registro    WHERE 1=1;
DELETE FROM bonificacao_mes      WHERE 1=1;
DELETE FROM apontamento          WHERE 1=1;
DELETE FROM apontamento_sessao   WHERE 1=1;
DELETE FROM op_cores             WHERE 1=1;
DELETE FROM op_tamanhos          WHERE 1=1;
DELETE FROM op_cab               WHERE 1=1;
DELETE FROM seq_itens            WHERE 1=1;
DELETE FROM seq_cab              WHERE 1=1;
DELETE FROM operacoes            WHERE 1=1;
DELETE FROM colaboradores        WHERE 1=1;
DELETE FROM tipos_defeito        WHERE 1=1;
DELETE FROM aparelhos            WHERE 1=1;
DELETE FROM clientes             WHERE 1=1;
DELETE FROM cores                WHERE 1=1;
DELETE FROM maquinas             WHERE 1=1;
DELETE FROM referencias          WHERE 1=1;
DELETE FROM setores              WHERE 1=1;
DELETE FROM tamanhos             WHERE 1=1;

-- ===== 2) DROP TABLE IF EXISTS (mesma ordem topológica) =====
DROP TABLE IF EXISTS defeitos_registro;
DROP TABLE IF EXISTS bonificacao_mes;
DROP TABLE IF EXISTS apontamento;
DROP TABLE IF EXISTS apontamento_sessao;
DROP TABLE IF EXISTS op_cores;
DROP TABLE IF EXISTS op_tamanhos;
DROP TABLE IF EXISTS op_cab;
DROP TABLE IF EXISTS seq_itens;
DROP TABLE IF EXISTS seq_cab;
DROP TABLE IF EXISTS operacoes;
DROP TABLE IF EXISTS colaboradores;
DROP TABLE IF EXISTS tipos_defeito;
DROP TABLE IF EXISTS aparelhos;
DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS cores;
DROP TABLE IF EXISTS maquinas;
DROP TABLE IF EXISTS referencias;
DROP TABLE IF EXISTS setores;
DROP TABLE IF EXISTS tamanhos;
