-- =====================================================================
-- 0013 — Perfil de Usuário: email + avatar (foto base64) + senha admin
-- =====================================================================

-- 1) Novas colunas em usuarios
ALTER TABLE usuarios ADD COLUMN email TEXT;
ALTER TABLE usuarios ADD COLUMN avatar_data TEXT;       -- data:image/png;base64,...
ALTER TABLE usuarios ADD COLUMN avatar_mime TEXT;       -- ex: image/png, image/jpeg, image/webp
ALTER TABLE usuarios ADD COLUMN avatar_atualizado TEXT; -- timestamp da última troca

-- 2) Índice de unicidade (case-insensitive) para email — só quando preenchido
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email
  ON usuarios (lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- 3) Atualiza senha do admin para 'rapboy'
--    Hash: SHA-256("rapboy_salt_v1:rapboy") computado em build-time.
--    Para garantir compatibilidade entre Node/Workers, usamos um par
--    salt+hash gerado offline (mesmo algoritmo de hashSenha em src/lib/auth.ts).
--    salt: rapboy_salt_v1
--    senha: rapboy
--    hash:  SHA-256("rapboy_salt_v1:rapboy")
--           = 79c3c92bc73355aa4286c128c0474e044ab97837ff800a699fdbba5dd27be180
UPDATE usuarios
   SET senha_hash   = '79c3c92bc73355aa4286c128c0474e044ab97837ff800a699fdbba5dd27be180',
       senha_salt   = 'rapboy_salt_v1',
       trocar_senha = 0,
       ativo        = 1
 WHERE login = 'admin';

-- Caso o admin não exista (instalação muito antiga), cria com a senha rapboy
INSERT OR IGNORE INTO usuarios (login, nome, senha_hash, senha_salt, perfil, trocar_senha, criado_por)
VALUES (
  'admin',
  'Administrador',
  '79c3c92bc73355aa4286c128c0474e044ab97837ff800a699fdbba5dd27be180',
  'rapboy_salt_v1',
  'admin',
  0,
  'sistema'
);
