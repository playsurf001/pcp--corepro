// Rotas de autenticação
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { ok, fail, audit, toInt, withD1Retry, isTransientD1Error } from '../lib/db';
import {
  hashSenha,
  randomHex,
  criarSessao,
  revogarSessao,
  validarSessao,
  requirePerfil,
} from '../lib/auth';
import { assertLimit, LimitExceededError } from '../lib/plan_limits';

const app = new Hono<{ Bindings: Bindings }>();

/* ================================================================
 * HOTFIX 0056 — Login resiliente a falhas transitórias do D1
 *
 * Contexto: em prod, o Cloudflare D1 pode retornar erros de storage
 * de forma intermitente (cold-start / object reset). O login era
 * a rota mais afetada porque é a PRIMEIRA query após o worker
 * ser instanciado. Sem retry, o usuário via
 * "Erro no banco de dados. Equipe foi notificada." e não conseguia
 * entrar — mesmo quando o D1 já estava respondendo às próximas queries.
 *
 * Solução:
 *   1. Cada etapa (busca usuário, hash senha, cria sessão, update login,
 *      audit) roda dentro de withD1Retry() com 3 tentativas e backoff
 *      curto (60ms → 120ms → 240ms).
 *   2. Try/catch granular por etapa com labels específicos → logs
 *      no console mostram exatamente onde falhou.
 *   3. Erros transitórios que sobrevivem ao retry retornam 503 com
 *      mensagem amigável ("Serviço temporariamente indisponível") em
 *      vez do genérico "Erro no banco de dados".
 *   4. Erros determinísticos (tabela faltando, sintaxe, etc.) mantêm
 *      500 e logs completos.
 * ================================================================ */

/** Constrói uma Response 503 amigável para erros de infra do D1. */
function serviceUnavailable(reason: string, ref?: string) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'Serviço de autenticação temporariamente indisponível. Aguarde alguns segundos e tente novamente.',
      code: 'AUTH_TEMPORARILY_UNAVAILABLE',
      hint: reason,
      ref: ref || undefined,
    }),
    { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '2' } }
  );
}

/** Logging estruturado para o servidor (aparece em wrangler tail / pm2 logs). */
function logAuthError(stage: string, err: any, ctx: Record<string, any> = {}) {
  const msg = err?.message || String(err);
  const transient = isTransientD1Error(err);
  console.error(JSON.stringify({
    scope: 'auth-login',
    stage,
    transient,
    error: msg,
    stack: err?.stack ? String(err.stack).slice(0, 800) : undefined,
    ...ctx,
    ts: new Date().toISOString(),
  }));
}

/* ========= BOOTSTRAP =========
 * Primeiro acesso: se o admin ainda tem senha '__BOOTSTRAP__', permite
 * setar a senha inicial (ou pelo reset abaixo). Chamado no primeiro uso.
 */
app.post('/auth/bootstrap', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id_usuario, senha_hash FROM usuarios WHERE login='admin'`
  ).first<any>();
  if (!row) return fail('Admin não existe no banco.');
  if (row.senha_hash !== '__BOOTSTRAP__') {
    return fail('Sistema já foi inicializado. Use login.');
  }
  // Senha default 'admin' (forçar troca no primeiro login)
  const salt = randomHex(16);
  const hash = await hashSenha(salt, 'admin');
  await c.env.DB.prepare(
    `UPDATE usuarios SET senha_hash=?, senha_salt=?, trocar_senha=1 WHERE login='admin'`
  ).bind(hash, salt).run();
  await audit(c.env.DB, 'AUTH', 'BOOTSTRAP', 'admin', '', '', 'senha=admin (trocar)');
  return c.json(
    ok({
      message: 'Admin inicializado. Use login=admin, senha=admin — será obrigatória a troca no primeiro login.',
    })
  );
});

/* ========= LOGIN =========
 * HOTFIX 0056 — refatorado para ser resiliente a falhas transitórias do D1
 * e reportar erros específicos por etapa.
 *
 * Etapas (cada uma com try/catch + retry + log específico):
 *   [1] Parse do body
 *   [2] Busca do usuário (SELECT * FROM usuarios WHERE login=? AND ativo=1)
 *   [3] Validação do hash da senha (Web Crypto — sem D1)
 *   [4] Criação da sessão (INSERT em sessoes + housekeeping)
 *   [5] Update do ultimo_login (não crítico — falha silenciosa em transient)
 *   [6] Audit log (não crítico — falha silenciosa)
 *
 * Erros determinísticos (senha errada, usuário inativo) devolvem 401.
 * Erros transitórios de infra (D1 storage) devolvem 503 com Retry-After.
 * Erros determinísticos de infra (tabela faltando, etc.) devolvem 500.
 */
app.post('/auth/login', async (c) => {
  const startedAt = Date.now();
  const ip =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for') ||
    '';
  const ua = c.req.header('user-agent') || '';

  // ── [1] PARSE DO BODY ────────────────────────────────────────────────
  let b: { login?: string; senha?: string };
  try {
    b = await c.req.json<{ login?: string; senha?: string }>();
  } catch (e: any) {
    logAuthError('parse-body', e, { ip });
    return fail('Corpo da requisição inválido (JSON malformado).', 400);
  }
  const login = (b.login || '').trim();
  const senha = b.senha || '';
  if (!login || !senha) return fail('Login e senha obrigatórios.');

  // ── [2] BUSCA DO USUÁRIO ─────────────────────────────────────────────
  let u: any = null;
  try {
    u = await withD1Retry(
      () => c.env.DB
        .prepare(`SELECT * FROM usuarios WHERE login=? AND ativo=1`)
        .bind(login)
        .first<any>(),
      { attempts: 3, baseDelayMs: 60, label: 'auth-login/select-user' }
    );
  } catch (e: any) {
    logAuthError('select-user', e, { login, ip });
    if (isTransientD1Error(e)) {
      return serviceUnavailable('storage-transient-select-user');
    }
    // Erro determinístico (ex.: tabela usuarios não existe) — 500 mas amigável
    return new Response(JSON.stringify({
      ok: false,
      error: 'Não foi possível consultar o banco de usuários. Tente novamente em instantes.',
      code: 'AUTH_SELECT_USER_FAILED',
      hint: (e?.message || '').slice(0, 160),
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  if (!u) {
    // Audit é best-effort — não bloqueia resposta se D1 estiver instável
    try {
      await withD1Retry(
        () => audit(c.env.DB, 'AUTH', 'LOGIN_FAIL', login, '', '', 'usuario_inexistente'),
        { attempts: 2, baseDelayMs: 40, label: 'auth-login/audit-fail' }
      );
    } catch (e: any) { logAuthError('audit-fail-inexistente', e, { login }); }
    return fail('Usuário ou senha inválidos.', 401);
  }

  if (u.senha_hash === '__BOOTSTRAP__') {
    return fail('Sistema não inicializado. Chame POST /api/auth/bootstrap primeiro.', 409);
  }

  // ── [3] VALIDAÇÃO DA SENHA (Web Crypto — sem D1) ─────────────────────
  let hash: string;
  try {
    hash = await hashSenha(u.senha_salt, senha);
  } catch (e: any) {
    logAuthError('hash-senha', e, { login, id_usuario: u.id_usuario });
    return new Response(JSON.stringify({
      ok: false,
      error: 'Falha ao validar credenciais. Tente novamente.',
      code: 'AUTH_HASH_FAILED',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  if (hash !== u.senha_hash) {
    try {
      await withD1Retry(
        () => audit(c.env.DB, 'AUTH', 'LOGIN_FAIL', login, '', '', 'senha_errada'),
        { attempts: 2, baseDelayMs: 40, label: 'auth-login/audit-fail' }
      );
    } catch (e: any) { logAuthError('audit-fail-senha', e, { login }); }
    return fail('Usuário ou senha inválidos.', 401);
  }

  // ── [4] CRIA SESSÃO ──────────────────────────────────────────────────
  let token: string;
  try {
    token = await withD1Retry(
      () => criarSessao(c.env.DB, u.id_usuario, ip, ua),
      { attempts: 3, baseDelayMs: 60, label: 'auth-login/criar-sessao' }
    );
  } catch (e: any) {
    logAuthError('criar-sessao', e, { login, id_usuario: u.id_usuario });
    if (isTransientD1Error(e)) {
      return serviceUnavailable('storage-transient-criar-sessao');
    }
    return new Response(JSON.stringify({
      ok: false,
      error: 'Não foi possível criar a sessão. Tente novamente em instantes.',
      code: 'AUTH_SESSION_FAILED',
      hint: (e?.message || '').slice(0, 160),
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // ── [5] UPDATE ULTIMO_LOGIN (não bloqueia — falha silenciosa) ────────
  try {
    await withD1Retry(
      () => c.env.DB
        .prepare(`UPDATE usuarios SET ultimo_login=datetime('now') WHERE id_usuario=?`)
        .bind(u.id_usuario).run(),
      { attempts: 2, baseDelayMs: 40, label: 'auth-login/update-ultimo-login' }
    );
  } catch (e: any) {
    // Não bloqueia o login — apenas registra
    logAuthError('update-ultimo-login', e, { login, id_usuario: u.id_usuario });
  }

  // ── [6] AUDIT SUCESSO (não bloqueia) ─────────────────────────────────
  try {
    await withD1Retry(
      () => audit(c.env.DB, 'AUTH', 'LOGIN', login, '', '', '', login),
      { attempts: 2, baseDelayMs: 40, label: 'auth-login/audit-success' }
    );
  } catch (e: any) {
    logAuthError('audit-success', e, { login, id_usuario: u.id_usuario });
  }

  const durMs = Date.now() - startedAt;
  if (durMs > 2000) {
    console.warn(`[auth-login] slow login: ${durMs}ms for login=${login}`);
  }

  return c.json(
    ok({
      token,
      usuario: {
        id_usuario: u.id_usuario,
        login: u.login,
        nome: u.nome,
        perfil: u.perfil,
        trocar_senha: !!u.trocar_senha,
      },
    })
  );
});

/* ========= LOGOUT ========= */
app.post('/auth/logout', async (c) => {
  const user = c.get('user') as any;
  const auth = c.req.header('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  if (token) await revogarSessao(c.env.DB, token);
  await audit(c.env.DB, 'AUTH', 'LOGOUT', user?.login || 'anon');
  return c.json(ok({ ok: true }));
});

/* ========= ME ========= */
app.get('/auth/me', async (c) => {
  const auth = c.req.header('authorization') || '';
  const tok = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  if (!tok) return c.json(ok(null));
  const sess = await validarSessao(c.env.DB, tok);
  if (!sess) return c.json(ok(null));
  // Multi-tenant: anexa info b\u00e1sica da empresa do usu\u00e1rio (fallback id_empresa=1)
  const id_empresa = (sess as any).id_empresa || 1;
  const emp = await c.env.DB.prepare(
    `SELECT id_empresa, nome, slug, plano, status FROM companies WHERE id_empresa=?`
  ).bind(id_empresa).first<any>().catch(() => null);
  return c.json(
    ok({
      id_usuario: sess.id_usuario,
      login: sess.login,
      nome: sess.nome,
      perfil: sess.perfil,
      email: sess.email || null,
      avatar_data: sess.avatar_data || null,
      avatar_mime: sess.avatar_mime || null,
      trocar_senha: !!sess.trocar_senha,
      is_owner: !!(sess as any).is_owner,
      id_empresa: id_empresa,
      empresa: emp || { id_empresa: 1, nome: 'CorePro Confec\u00e7\u00e3o', plano: 'enterprise', status: 'ativa' },
    })
  );
});

/* ========= PERFIL — GET (dados completos do usuário logado) ========= */
app.get('/auth/perfil', async (c) => {
  const user = c.get('user') as any;
  if (!user) return fail('Não autenticado.', 401);
  const u = await c.env.DB.prepare(
    `SELECT id_usuario, login, nome, email, perfil, avatar_data, avatar_mime,
            avatar_atualizado, ultimo_login, dt_criacao
       FROM usuarios WHERE id_usuario=?`
  ).bind(user.id_usuario).first<any>();
  if (!u) return fail('Usuário não encontrado.', 404);
  return c.json(ok(u));
});

/* ========= PERFIL — PUT (atualiza nome / login / email / avatar) =========
 * Body: { nome?, login?, email?, avatar_data?, avatar_mime?, remover_avatar? }
 * Validações:
 *  - login não pode duplicar (case-insensitive)
 *  - email não pode duplicar (case-insensitive) quando informado
 *  - avatar_data: aceita data:image/(png|jpeg|jpg|webp);base64,... limitado a ~2 MB
 */
app.put('/auth/perfil', async (c) => {
  const user = c.get('user') as any;
  if (!user) return fail('Não autenticado.', 401);
  const b = await c.req.json<any>();

  const sets: string[] = [];
  const vals: any[] = [];

  // nome
  if (b.nome !== undefined) {
    const nome = String(b.nome || '').trim();
    if (!nome) return fail('Nome não pode ser vazio.');
    if (nome.length > 120) return fail('Nome muito longo (máx 120).');
    sets.push('nome = ?'); vals.push(nome);
  }

  // login
  if (b.login !== undefined) {
    const login = String(b.login || '').trim();
    if (!login) return fail('Login não pode ser vazio.');
    if (login.length < 3) return fail('Login deve ter pelo menos 3 caracteres.');
    if (!/^[a-zA-Z0-9_.\-]+$/.test(login)) return fail('Login só pode conter letras, números, ponto, underscore e hífen.');
    // Checa duplicidade
    const dup = await c.env.DB.prepare(
      `SELECT id_usuario FROM usuarios WHERE lower(login)=lower(?) AND id_usuario<>?`
    ).bind(login, user.id_usuario).first<any>();
    if (dup) return fail('Login já está em uso por outro usuário.', 409);
    sets.push('login = ?'); vals.push(login);
  }

  // email
  if (b.email !== undefined) {
    const email = String(b.email || '').trim();
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('E-mail inválido.');
      if (email.length > 160) return fail('E-mail muito longo.');
      const dup = await c.env.DB.prepare(
        `SELECT id_usuario FROM usuarios WHERE lower(email)=lower(?) AND id_usuario<>?`
      ).bind(email, user.id_usuario).first<any>();
      if (dup) return fail('E-mail já está em uso por outro usuário.', 409);
      sets.push('email = ?'); vals.push(email);
    } else {
      sets.push('email = NULL');
    }
  }

  // avatar (upload ou remoção)
  if (b.remover_avatar) {
    sets.push('avatar_data = NULL');
    sets.push('avatar_mime = NULL');
    sets.push("avatar_atualizado = datetime('now')");
  } else if (b.avatar_data !== undefined && b.avatar_data !== null && b.avatar_data !== '') {
    const data = String(b.avatar_data);
    // Validação: tem que ser data URL base64 de imagem permitida
    const m = data.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) return fail('Avatar inválido. Use JPG, PNG ou WebP em base64 (data URL).');
    const mime = m[1].toLowerCase().replace('image/jpg', 'image/jpeg');
    // Limite: ~2 MB já em base64 (1 byte vira ~1.37 caracteres). 3 MB de base64 ≈ 2.2 MB binário
    if (data.length > 3_000_000) return fail('Imagem muito grande (máx ~2 MB). Reduza no cliente antes de enviar.');
    sets.push('avatar_data = ?'); vals.push(data);
    sets.push('avatar_mime = ?'); vals.push(mime);
    sets.push("avatar_atualizado = datetime('now')");
  }

  if (sets.length === 0) return fail('Nada para atualizar.');

  vals.push(user.id_usuario);
  await c.env.DB.prepare(
    `UPDATE usuarios SET ${sets.join(', ')} WHERE id_usuario=?`
  ).bind(...vals).run();

  await audit(c.env.DB, 'AUTH', 'UPD_PERFIL', user.login, '', '', sets.join(';'));

  // Retorna perfil atualizado (sem dados sensíveis)
  const u = await c.env.DB.prepare(
    `SELECT id_usuario, login, nome, email, perfil, avatar_data, avatar_mime,
            avatar_atualizado, ultimo_login, dt_criacao
       FROM usuarios WHERE id_usuario=?`
  ).bind(user.id_usuario).first<any>();
  return c.json(ok(u));
});

/* ========= PERFIL — PUT senha (alterna do trocar-senha mas com confirmação) =========
 * Body: { senha_atual, senha_nova, senha_confirma }
 */
app.put('/auth/perfil/senha', async (c) => {
  const user = c.get('user') as any;
  if (!user) return fail('Não autenticado.', 401);
  const b = await c.req.json<any>();
  const sa = String(b.senha_atual || '');
  const sn = String(b.senha_nova || '');
  const sc = String(b.senha_confirma || '');
  if (!sa || !sn || !sc) return fail('Preencha senha atual, nova e confirmação.');
  if (sn !== sc) return fail('Nova senha e confirmação não conferem.');
  if (sn.length < 6) return fail('Nova senha deve ter pelo menos 6 caracteres.');
  if (sn === sa) return fail('A nova senha deve ser diferente da senha atual.');

  const u = await c.env.DB.prepare(
    `SELECT senha_hash, senha_salt FROM usuarios WHERE id_usuario=?`
  ).bind(user.id_usuario).first<any>();
  if (!u) return fail('Usuário não encontrado.', 404);

  const h = await hashSenha(u.senha_salt, sa);
  if (h !== u.senha_hash) return fail('Senha atual incorreta.');

  const salt = randomHex(16);
  const novaHash = await hashSenha(salt, sn);
  await c.env.DB.prepare(
    `UPDATE usuarios SET senha_hash=?, senha_salt=?, trocar_senha=0 WHERE id_usuario=?`
  ).bind(novaHash, salt, user.id_usuario).run();

  await audit(c.env.DB, 'AUTH', 'UPD_SENHA', user.login);
  return c.json(ok({ message: 'Senha alterada com sucesso.' }));
});

/* ========= TROCAR SENHA ========= */
app.post('/auth/trocar-senha', async (c) => {
  const user = c.get('user') as any;
  if (!user) return fail('Não autenticado.', 401);
  const b = await c.req.json<{ senha_atual?: string; senha_nova?: string }>();
  if (!b.senha_atual || !b.senha_nova) return fail('Informe senha atual e nova.');
  if (b.senha_nova.length < 6) return fail('Senha nova deve ter >= 6 caracteres.');

  const u = await c.env.DB.prepare(
    `SELECT senha_hash, senha_salt FROM usuarios WHERE id_usuario=?`
  ).bind(user.id_usuario).first<any>();
  if (!u) return fail('Usuário não encontrado.', 404);

  const h = await hashSenha(u.senha_salt, b.senha_atual);
  if (h !== u.senha_hash) return fail('Senha atual incorreta.');

  const salt = randomHex(16);
  const novaHash = await hashSenha(salt, b.senha_nova);
  await c.env.DB.prepare(
    `UPDATE usuarios SET senha_hash=?, senha_salt=?, trocar_senha=0 WHERE id_usuario=?`
  ).bind(novaHash, salt, user.id_usuario).run();
  await audit(c.env.DB, 'AUTH', 'TROCAR_SENHA', user.login);
  return c.json(ok({ message: 'Senha alterada.' }));
});

/* ========= CRUD DE USUÁRIOS (admin) ========= */
// Multi-tenant: admin só enxerga / edita usuários da própria empresa.
// Fallback id_empresa=1 garante compat com dados legados.
app.get('/usuarios', requirePerfil('admin'), async (c) => {
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const rs = await c.env.DB.prepare(
    `SELECT id_usuario, login, nome, perfil, ativo, trocar_senha, ultimo_login, dt_criacao
     FROM usuarios WHERE id_empresa = ? ORDER BY login`
  ).bind(id_empresa).all();
  return c.json(ok(rs.results));
});

app.post('/usuarios', requirePerfil('admin'), async (c) => {
  const user = c.get('user') as any;
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const b = await c.req.json<any>();
  if (!b.login || !b.nome || !b.senha) return fail('Login, nome e senha obrigatórios.');
  if (b.senha.length < 6) return fail('Senha deve ter >= 6 caracteres.');

  // SPRINT 2 — Limite de usuários do plano (apenas se ativo=1)
  if ((b.ativo ?? 1) === 1) {
    try {
      await assertLimit(c.env.DB, id_empresa, 'usuarios');
    } catch (e) {
      if (e instanceof LimitExceededError) return e.toResponse();
      throw e;
    }
  }

  const salt = randomHex(16);
  const hash = await hashSenha(salt, b.senha);
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO usuarios (login, nome, senha_hash, senha_salt, perfil, ativo, trocar_senha, criado_por, id_empresa)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      b.login.trim(),
      b.nome,
      hash,
      salt,
      b.perfil || 'operador',
      b.ativo ?? 1,
      b.trocar_senha ?? 1,
      user.login,
      id_empresa
    ).run();
    await audit(c.env.DB, 'AUTH', 'INS_USR', b.login, '', '', b.perfil || 'operador', user.login);
    return c.json(ok({ id_usuario: r.meta.last_row_id }));
  } catch (e: any) {
    return fail('Login já existe ou dados inválidos: ' + e.message);
  }
});

app.put('/usuarios/:id', requirePerfil('admin'), async (c) => {
  const user = c.get('user') as any;
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  const b = await c.req.json<any>();

  // SPRINT 2 — Se está REATIVANDO usuário inativo, valida limite
  if ((b.ativo ?? 1) === 1) {
    const cur: any = await c.env.DB.prepare(
      `SELECT ativo FROM usuarios WHERE id_usuario=? AND id_empresa=?`
    ).bind(id, id_empresa).first();
    if (cur && Number(cur.ativo) === 0) {
      try {
        await assertLimit(c.env.DB, id_empresa, 'usuarios');
      } catch (e) {
        if (e instanceof LimitExceededError) return e.toResponse();
        throw e;
      }
    }
  }

  // Garante isolamento: só atualiza se o usuário pertencer à mesma empresa do admin
  await c.env.DB.prepare(
    `UPDATE usuarios SET nome=?, perfil=?, ativo=? WHERE id_usuario=? AND id_empresa=?`
  ).bind(b.nome, b.perfil, b.ativo ?? 1, id, id_empresa).run();
  // Se enviou nova senha, troca
  if (b.senha) {
    if (b.senha.length < 6) return fail('Senha deve ter >= 6 caracteres.');
    const salt = randomHex(16);
    const hash = await hashSenha(salt, b.senha);
    await c.env.DB.prepare(
      `UPDATE usuarios SET senha_hash=?, senha_salt=?, trocar_senha=? WHERE id_usuario=? AND id_empresa=?`
    ).bind(hash, salt, b.trocar_senha ?? 1, id, id_empresa).run();
  }
  await audit(c.env.DB, 'AUTH', 'UPD_USR', `usr=${id}`, '', '', b.perfil || '', user.login);
  return c.json(ok({ id_usuario: id }));
});

app.delete('/usuarios/:id', requirePerfil('admin'), async (c) => {
  const user = c.get('user') as any;
  const id_empresa = (c.get('id_empresa') as number) || 1;
  const id = toInt(c.req.param('id'));
  if (id === user.id_usuario) return fail('Não pode desativar a si mesmo.');
  // Só desativa se for da mesma empresa do admin
  await c.env.DB.prepare(`UPDATE usuarios SET ativo=0 WHERE id_usuario=? AND id_empresa=?`).bind(id, id_empresa).run();
  // Invalida sessões
  await c.env.DB.prepare(`DELETE FROM sessoes WHERE id_usuario=?`).bind(id).run();
  await audit(c.env.DB, 'AUTH', 'DEL_USR', `usr=${id}`, '', '', '', user.login);
  return c.json(ok({ id_usuario: id }));
});

export default app;
