-- Parâmetros de identidade da empresa (usados em impressões: romaneios, comprovantes, etc.)
INSERT OR IGNORE INTO parametros (chave, valor, descricao) VALUES
  ('EMPRESA_NOME', 'Play Surf', 'Nome da empresa (impressão)'),
  ('EMPRESA_TEL', '(81) 3738-1885', 'Telefone da empresa'),
  ('EMPRESA_EMAIL', 'playsurf.loja@gmail.com', 'E-mail da empresa'),
  ('EMPRESA_CNPJ', '', 'CNPJ da empresa'),
  ('EMPRESA_ENDERECO', '', 'Endereço da empresa');
