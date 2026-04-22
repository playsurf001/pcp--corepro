-- =====================================================================
-- Autenticação - Usuários e Sessões
-- =====================================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario    INTEGER PRIMARY KEY AUTOINCREMENT,
  login         TEXT UNIQUE NOT NULL,
  nome          TEXT NOT NULL,
  senha_hash    TEXT NOT NULL,     -- SHA-256(salt + senha)
  senha_salt    TEXT NOT NULL,     -- random 16 bytes hex
  perfil        TEXT NOT NULL DEFAULT 'operador'
                CHECK (perfil IN ('admin','gerente','pcp','operador','visualizador')),
  ativo         INTEGER NOT NULL DEFAULT 1,
  trocar_senha  INTEGER NOT NULL DEFAULT 0,  -- força troca no próximo login
  ultimo_login  TEXT,
  dt_criacao    TEXT NOT NULL DEFAULT (datetime('now')),
  criado_por    TEXT
);

CREATE TABLE IF NOT EXISTS sessoes (
  token         TEXT PRIMARY KEY,              -- random 32 bytes hex
  id_usuario    INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  dt_criacao    TEXT NOT NULL DEFAULT (datetime('now')),
  dt_expira     TEXT NOT NULL,                 -- agora + 12h
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(id_usuario);
CREATE INDEX IF NOT EXISTS idx_sessoes_expira ON sessoes(dt_expira);

-- Usuário admin padrão (senha: admin - força troca no primeiro login)
-- hash abaixo: SHA-256("defaultsalt00000" + "admin")
-- Será recriado pelo primeiro POST /api/auth/bootstrap se não existir
INSERT OR IGNORE INTO usuarios (login, nome, senha_hash, senha_salt, perfil, trocar_senha, criado_por)
VALUES (
  'admin',
  'Administrador',
  '__BOOTSTRAP__',
  '__BOOTSTRAP__',
  'admin',
  1,
  'sistema'
);
