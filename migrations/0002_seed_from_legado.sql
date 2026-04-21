-- =====================================================================
-- Seed com dados extraídos do legado real:
-- Arquivo "Kamylla - Ficha Balanceamento Versão 1.0.xlsx"
-- =====================================================================

-- Parâmetros padrão
INSERT OR REPLACE INTO parametros (chave, valor, descricao) VALUES
  ('MIN_TURNO', '480', 'Minutos trabalhados por turno'),
  ('TURNOS', '1', 'Quantidade de turnos padrão'),
  ('EFIC_PADRAO', '0.85', 'Eficiência default (85%)'),
  ('PACOTE_PADRAO', '10', 'Pacote padrão em peças'),
  ('VERSAO_SISTEMA', '2.0.0', 'Versão do sistema');

-- Clientes (3 registros reais do legado)
INSERT OR IGNORE INTO clientes (cod_cliente, nome_cliente, observacao) VALUES
  ('CLI001', 'Magazine de Confecções Ltda.', NULL),
  ('CLI002', 'Maria & Maria', 'Utilizar etiquetas do Cliente.' || char(10) || 'Colocar TAGs do Cliente nas peças quando embaladas.'),
  ('CLI003', 'Pepe', '****   CLIENTE ESPECIAL  ****' || char(10) || 'Utilizar etiquetas de composição e bordada enviadas pelo Cliente.' || char(10) || 'Colocar TAGs do Cliente nas peças quando forem embaladas.');

-- Cores (7 registros reais do legado)
INSERT OR IGNORE INTO cores (cod_cor, nome_cor) VALUES
  ('AMR', 'Amarelo'),
  ('AZL', 'Azul'),
  ('BRC', 'Branco'),
  ('MAR', 'Marinho'),
  ('PRT', 'Preto'),
  ('VRD', 'Verde'),
  ('VRM', 'Vermelho');

-- Tamanhos (21 registros reais do legado, com ordem lógica)
INSERT OR IGNORE INTO tamanhos (cod_tam, ordem) VALUES
  ('01', 1), ('02', 2), ('03', 3), ('2', 4), ('4', 5), ('6', 6), ('8', 7),
  ('10', 8), ('12', 9), ('14', 10), ('16', 11),
  ('34', 12), ('36', 13), ('38', 14), ('40', 15), ('42', 16), ('44', 17),
  ('P', 18), ('M', 19), ('G', 20), ('GG', 21);

-- Demo: máquinas e aparelhos comuns em confecção (não estavam preenchidos no legado)
INSERT OR IGNORE INTO maquinas (cod_maquina, desc_maquina, tipo, eficiencia, oper_por_maquina) VALUES
  ('RETA', 'Reta Eletrônica', 'Reta', 0.85, 1),
  ('OVER', 'Overlock 5 Fios', 'Overlock', 0.85, 1),
  ('INTER', 'Interlock', 'Interlock', 0.85, 1),
  ('GALON', 'Galoneira', 'Galoneira', 0.85, 1),
  ('TRAV', 'Travete', 'Travete', 0.80, 1),
  ('CASEAD', 'Caseadeira', 'Caseado', 0.75, 1),
  ('BOTAO', 'Botoneira', 'Botão', 0.75, 1),
  ('MANUAL', 'Manual', 'Manual', 0.90, 1);

INSERT OR IGNORE INTO aparelhos (cod_aparelho, desc_aparelho) VALUES
  ('APR-A', 'Aparelho A'),
  ('APR-B', 'Aparelho B'),
  ('APR-C', 'Aparelho C');

-- Operações comuns de confecção (demo para uso imediato)
INSERT OR IGNORE INTO operacoes (cod_op, desc_op, id_maquina, tempo_padrao) VALUES
  ('OP01', 'Fechar ombros', (SELECT id_maquina FROM maquinas WHERE cod_maquina='OVER'), 0.50),
  ('OP02', 'Pespontar gola', (SELECT id_maquina FROM maquinas WHERE cod_maquina='RETA'), 0.80),
  ('OP03', 'Fechar lateral', (SELECT id_maquina FROM maquinas WHERE cod_maquina='OVER'), 1.20),
  ('OP04', 'Bainha de manga', (SELECT id_maquina FROM maquinas WHERE cod_maquina='GALON'), 0.60),
  ('OP05', 'Bainha de barra', (SELECT id_maquina FROM maquinas WHERE cod_maquina='GALON'), 0.70),
  ('OP06', 'Travete reforço', (SELECT id_maquina FROM maquinas WHERE cod_maquina='TRAV'), 0.30),
  ('OP07', 'Pregar etiqueta', (SELECT id_maquina FROM maquinas WHERE cod_maquina='RETA'), 0.40),
  ('OP08', 'Revisão final', (SELECT id_maquina FROM maquinas WHERE cod_maquina='MANUAL'), 1.00);

-- Referência demo
INSERT OR IGNORE INTO referencias (cod_ref, desc_ref, familia) VALUES
  ('REF001', 'Camiseta Básica Gola Redonda', 'Camisetas'),
  ('REF002', 'Blusa Manga Longa', 'Blusas');
