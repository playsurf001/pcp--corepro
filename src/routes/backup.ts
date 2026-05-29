// ============================================================================
// HOTFIX 0038 — Rotas de Backup & Restauração
// ----------------------------------------------------------------------------
// Rotas tenant (/api/backup/*):
//   GET    /api/backup                       lista backups da empresa logada
//   GET    /api/backup/config                lê config de retenção/auto
//   PUT    /api/backup/config                atualiza config
//   POST   /api/backup                       gera backup manual da empresa
//   GET    /api/backup/:id/download          baixa .ndjson.gz
//   POST   /api/backup/:id/restore           restaura (senha + confirmação)
//   DELETE /api/backup/:id                   remove backup
//   GET    /api/backup/logs                  últimos logs da empresa
//
// Rotas master (/api/master/backup/*):
//   GET    /api/master/backup                lista TODOS backups (todas empresas)
//   POST   /api/master/backup/global         gera backup global
//   POST   /api/master/backup/tenant/:id     gera backup tenant-scoped via master
//   GET    /api/master/backup/:id/download   download (qualquer backup)
//   POST   /api/master/backup/:id/restore    restaura (qualquer)
//   DELETE /api/master/backup/:id            remove
//   GET    /api/master/backup/logs           logs globais
// ============================================================================
import { Hono } from 'hono';
import type { Bindings } from '../lib/db';
import { fail, ok, getEmpresa, toInt, audit, logTenant } from '../lib/db';
import { hashSenha } from '../lib/auth';
import {
  exportTenant,
  exportGlobal,
  parseAndValidate,
  restoreTenant,
  applyRetention,
  gzipDecompress,
  sha256Hex,
} from '../lib/backup_engine';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any; master: any } }>();

const SCHEMA_VERSION = 38;

/* ============================================================================
 * Helpers internos
 * ========================================================================== */

function clientIp(c: any): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for') ||
    c.req.header('x-real-ip') ||
    ''
  ).split(',')[0].trim();
}

function clientUA(c: any): string {
  return (c.req.header('user-agent') || '').slice(0, 200);
}

/**
 * Normaliza BLOB do D1 para Uint8Array.
 *   • Em PROD (workerd): vem como ArrayBuffer
 *   • Em LOCAL (better-sqlite3 via wrangler): vem como Array<number>
 *   • Já pode vir como Uint8Array
 * Retorna null se tipo não reconhecido.
 */
function normalizeBlob(p: any): Uint8Array | null {
  if (!p) return null;
  if (p instanceof Uint8Array) return p;
  if (p instanceof ArrayBuffer) return new Uint8Array(p);
  if (Array.isArray(p)) return new Uint8Array(p);
  if (typeof p === 'object' && typeof p.byteLength === 'number' && p.buffer instanceof ArrayBuffer) {
    return new Uint8Array(p.buffer, p.byteOffset || 0, p.byteLength);
  }
  return null;
}

/**
 * Registra um log estruturado em backup_logs.
 * Nunca lança — se falhar, apenas console.error.
 */
async function logBackup(
  db: D1Database,
  args: {
    id_backup?: number | null;
    id_empresa?: number | null;
    action: string;
    ator: string;
    ip?: string;
    ua?: string;
    detalhes?: any;
    duracao_ms?: number;
    status?: 'ok' | 'erro';
    erro?: string;
  }
) {
  try {
    await db
      .prepare(
        `INSERT INTO backup_logs
         (id_backup, id_empresa, action, ator, ip, user_agent, detalhes, duracao_ms, status, erro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        args.id_backup ?? null,
        args.id_empresa ?? null,
        args.action,
        args.ator,
        args.ip || '',
        args.ua || '',
        args.detalhes ? JSON.stringify(args.detalhes) : null,
        args.duracao_ms ?? 0,
        args.status || 'ok',
        args.erro || null
      )
      .run();
  } catch (e) {
    console.error('[backup_logs] insert fail', e);
  }
}

/**
 * Carrega backup_config da empresa (cria default se ausente — defensivo).
 */
async function getConfig(db: D1Database, id_empresa: number) {
  let cfg = await db
    .prepare(`SELECT * FROM backup_config WHERE id_empresa = ?`)
    .bind(id_empresa)
    .first<any>();
  if (!cfg) {
    await db
      .prepare(`INSERT OR IGNORE INTO backup_config (id_empresa) VALUES (?)`)
      .bind(id_empresa)
      .run();
    cfg = await db
      .prepare(`SELECT * FROM backup_config WHERE id_empresa = ?`)
      .bind(id_empresa)
      .first<any>();
  }
  return cfg;
}

/**
 * Verifica senha do usuário logado (proteção crítica para restore).
 */
async function verifySenhaUsuario(db: D1Database, id_usuario: number, senha: string): Promise<boolean> {
  if (!senha || !id_usuario) return false;
  const u = await db
    .prepare(`SELECT senha_hash, senha_salt, ativo FROM usuarios WHERE id_usuario = ?`)
    .bind(id_usuario)
    .first<any>();
  if (!u || !u.ativo) return false;
  const h = await hashSenha(u.senha_salt || '', senha);
  return h === u.senha_hash;
}

/**
 * Gera nome de arquivo padronizado.
 */
function nomeArquivo(escopo: 'tenant' | 'global', id_empresa: number | null): string {
  const now = new Date();
  const dt = now.toISOString().replace(/[:T]/g, '-').slice(0, 16);
  if (escopo === 'global') return `backup_global_${dt}.ndjson.gz`;
  return `backup_E${id_empresa || 0}_${dt}.ndjson.gz`;
}

/* ============================================================================
 * Rotas TENANT — /api/backup/*
 * ========================================================================== */

// GET /api/backup — lista backups da empresa logada
app.get('/backup', async (c) => {
  const id_empresa = getEmpresa(c);
  const r = await c.env.DB
    .prepare(
      `SELECT id_backup, tipo, escopo, nome_arquivo, schema_version,
              tamanho_bytes, total_registros, total_tabelas, status, erro,
              duracao_ms, criado_por, criado_por_ip, dt_criacao,
              dt_restaurado, restaurado_por, observacao, storage_driver
       FROM backups
       WHERE id_empresa = ?
       ORDER BY dt_criacao DESC
       LIMIT 200`
    )
    .bind(id_empresa)
    .all();
  return c.json(ok(r.results || []));
});

// GET /api/backup/config
app.get('/backup/config', async (c) => {
  const id_empresa = getEmpresa(c);
  const cfg = await getConfig(c.env.DB, id_empresa);
  return c.json(ok(cfg));
});

// PUT /api/backup/config — atualiza retenção/auto
app.put('/backup/config', async (c) => {
  const id_empresa = getEmpresa(c);
  const body = await c.req.json().catch(() => ({}));
  const max_backups = Math.max(1, Math.min(50, toInt(body.max_backups, 10)));
  const auto_enabled = body.auto_enabled ? 1 : 0;
  const auto_frequencia = ['diario', 'semanal', 'mensal'].includes(body.auto_frequencia)
    ? body.auto_frequencia
    : 'diario';
  const auto_hora_utc = Math.max(0, Math.min(23, toInt(body.auto_hora_utc, 3)));

  await c.env.DB
    .prepare(
      `INSERT INTO backup_config (id_empresa, max_backups, auto_enabled, auto_frequencia, auto_hora_utc, dt_atualizacao)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id_empresa) DO UPDATE SET
         max_backups=excluded.max_backups,
         auto_enabled=excluded.auto_enabled,
         auto_frequencia=excluded.auto_frequencia,
         auto_hora_utc=excluded.auto_hora_utc,
         dt_atualizacao=datetime('now')`
    )
    .bind(id_empresa, max_backups, auto_enabled, auto_frequencia, auto_hora_utc)
    .run();

  logTenant(c, 'backup.config.update', { max_backups, auto_enabled, auto_frequencia });
  return c.json(ok(await getConfig(c.env.DB, id_empresa)));
});

// POST /api/backup — gera backup manual da empresa logada
app.post('/backup', async (c) => {
  const id_empresa = getEmpresa(c);
  const user = c.get('user') as any;
  const ator = user?.login || 'sistema';
  const ip = clientIp(c);
  const ua = clientUA(c);

  // Pré-criação do registro (status=pending) para evitar perda de auditoria em erro
  const result = await c.env.DB
    .prepare(
      `INSERT INTO backups (id_empresa, tipo, escopo, nome_arquivo, schema_version,
                            status, criado_por, criado_por_ip)
       VALUES (?, 'manual', 'tenant', ?, ?, 'pending', ?, ?)`
    )
    .bind(id_empresa, nomeArquivo('tenant', id_empresa), SCHEMA_VERSION, ator, ip)
    .run();
  const id_backup = Number(result.meta.last_row_id);

  try {
    const exp = await exportTenant(c.env.DB, id_empresa, SCHEMA_VERSION);
    await c.env.DB
      .prepare(
        `UPDATE backups SET
           tamanho_bytes=?, total_registros=?, total_tabelas=?,
           checksum_sha256=?, payload=?, status='ok', duracao_ms=?
         WHERE id_backup=?`
      )
      .bind(
        exp.payloadGz.byteLength,
        exp.total_registros,
        exp.total_tabelas,
        exp.checksum,
        exp.payloadGz,
        exp.duracao_ms,
        id_backup
      )
      .run();

    // Retenção
    const cfg = await getConfig(c.env.DB, id_empresa);
    const removidos = await applyRetention(c.env.DB, id_empresa, cfg.max_backups || 10);

    await logBackup(c.env.DB, {
      id_backup, id_empresa, action: 'create', ator, ip, ua,
      detalhes: { tipo: 'manual', total_registros: exp.total_registros, retencao_removidos: removidos },
      duracao_ms: exp.duracao_ms, status: 'ok',
    });
    await audit(c, 'backup', 'create', String(id_backup), 'manual', '', String(exp.total_registros));

    const row = await c.env.DB
      .prepare(`SELECT id_backup, tipo, escopo, nome_arquivo, tamanho_bytes,
                       total_registros, total_tabelas, status, dt_criacao, duracao_ms
                FROM backups WHERE id_backup=?`)
      .bind(id_backup).first();
    return c.json(ok(row, { retencao_removidos: removidos }));
  } catch (e: any) {
    const msg = String(e?.message || e);
    await c.env.DB
      .prepare(`UPDATE backups SET status='erro', erro=? WHERE id_backup=?`)
      .bind(msg, id_backup).run();
    await logBackup(c.env.DB, {
      id_backup, id_empresa, action: 'create', ator, ip, ua,
      status: 'erro', erro: msg,
    });
    return fail('Falha ao gerar backup: ' + msg, 500);
  }
});

// GET /api/backup/:id/download
app.get('/backup/:id/download', async (c) => {
  const id_empresa = getEmpresa(c);
  const id_backup = toInt(c.req.param('id'));
  const user = c.get('user') as any;
  const ator = user?.login || 'sistema';

  const row = await c.env.DB
    .prepare(
      `SELECT id_backup, id_empresa, nome_arquivo, payload, tamanho_bytes, checksum_sha256, status
       FROM backups WHERE id_backup=? AND id_empresa=?`
    )
    .bind(id_backup, id_empresa).first<any>();
  if (!row) return fail('Backup não encontrado.', 404);
  if (row.status !== 'ok') return fail('Backup não está disponível (status=' + row.status + ').', 400);
  if (!row.payload) return fail('Payload ausente.', 410);

  await logBackup(c.env.DB, {
    id_backup, id_empresa, action: 'download', ator,
    ip: clientIp(c), ua: clientUA(c),
    detalhes: { tamanho: row.tamanho_bytes },
  });

  const body = normalizeBlob(row.payload);
  if (!body) return fail('Payload em formato não suportado.', 500);

  return new Response(body, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${row.nome_arquivo}"`,
      'Content-Length': String(body.byteLength),
      'X-Backup-Checksum': row.checksum_sha256 || '',
      'X-Backup-Id': String(row.id_backup),
    },
  });
});

// POST /api/backup/:id/restore
app.post('/backup/:id/restore', async (c) => {
  const id_empresa = getEmpresa(c);
  const id_backup = toInt(c.req.param('id'));
  const user = c.get('user') as any;
  if (!user?.id_usuario) return fail('Sessão inválida.', 401);
  const ator = user.login || 'sistema';
  const ip = clientIp(c);
  const ua = clientUA(c);

  const body = await c.req.json().catch(() => ({}));
  const senha = String(body.senha || '');
  const confirma = String(body.confirma_texto || '').trim().toUpperCase();
  if (confirma !== 'RESTAURAR') {
    return fail('Confirmação textual inválida. Digite exatamente RESTAURAR.', 400);
  }
  const senhaOK = await verifySenhaUsuario(c.env.DB, user.id_usuario, senha);
  if (!senhaOK) {
    await logBackup(c.env.DB, {
      id_backup, id_empresa, action: 'restore_start', ator, ip, ua,
      status: 'erro', erro: 'Senha incorreta',
    });
    return fail('Senha incorreta.', 401);
  }

  const row = await c.env.DB
    .prepare(`SELECT * FROM backups WHERE id_backup=? AND id_empresa=?`)
    .bind(id_backup, id_empresa).first<any>();
  if (!row) return fail('Backup não encontrado.', 404);
  if (row.status !== 'ok') return fail('Backup não disponível.', 400);
  if (!row.payload) return fail('Payload ausente.', 410);

  // 1) valida checksum do arquivo
  const payloadBytes = normalizeBlob(row.payload);
  if (!payloadBytes) return fail('Payload em formato inválido.', 500);
  const recomputed = await sha256Hex(payloadBytes);
  if (recomputed !== row.checksum_sha256) {
    await logBackup(c.env.DB, {
      id_backup, id_empresa, action: 'restore_start', ator, ip, ua,
      status: 'erro', erro: 'Checksum divergente',
    });
    return fail('Checksum do backup divergente — arquivo corrompido. Restauração abortada.', 400);
  }

  // 2) parseia e valida estrutura
  let parsed;
  try {
    parsed = await parseAndValidate(payloadBytes);
  } catch (e: any) {
    await logBackup(c.env.DB, {
      id_backup, id_empresa, action: 'restore_start', ator, ip, ua,
      status: 'erro', erro: 'Parse falhou: ' + String(e?.message || e),
    });
    return fail('Arquivo inválido: ' + String(e?.message || e), 400);
  }

  // 3) Cross-tenant protection: payload tenant DEVE ser desta empresa
  if (parsed.meta.escopo !== 'tenant') {
    return fail('Backup não é tenant-scoped. Restauração negada.', 400);
  }
  if (parsed.meta.id_empresa !== id_empresa) {
    await logBackup(c.env.DB, {
      id_backup, id_empresa, action: 'restore_start', ator, ip, ua,
      status: 'erro', erro: `Cross-tenant: payload=${parsed.meta.id_empresa} alvo=${id_empresa}`,
    });
    return fail('Este backup é de outra empresa. Restauração negada.', 403);
  }

  await logBackup(c.env.DB, {
    id_backup, id_empresa, action: 'restore_start', ator, ip, ua,
    detalhes: { schema_version: parsed.meta.schema_version, total_tabelas: parsed.tables.length },
  });

  // 4) Snapshot pré-restore (segurança máxima — usuário pode reverter)
  let snapshotId: number | null = null;
  try {
    const pre = await exportTenant(c.env.DB, id_empresa, SCHEMA_VERSION);
    const ins = await c.env.DB
      .prepare(
        `INSERT INTO backups (id_empresa, tipo, escopo, nome_arquivo, schema_version,
                              tamanho_bytes, total_registros, total_tabelas, checksum_sha256,
                              payload, status, duracao_ms, criado_por, criado_por_ip, observacao)
         VALUES (?, 'pre_restore', 'tenant', ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?)`
      )
      .bind(
        id_empresa,
        `pre_restore_E${id_empresa}_${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)}.ndjson.gz`,
        SCHEMA_VERSION,
        pre.payloadGz.byteLength,
        pre.total_registros,
        pre.total_tabelas,
        pre.checksum,
        pre.payloadGz,
        pre.duracao_ms,
        ator,
        ip,
        `Snapshot automático antes de restaurar backup #${id_backup}`
      ).run();
    snapshotId = Number(ins.meta.last_row_id);
  } catch (e) {
    console.error('[restore] snapshot pre-restore falhou', e);
    // Não bloqueia o restore, mas registra log
    await logBackup(c.env.DB, {
      id_empresa, action: 'restore_start', ator, ip, ua,
      status: 'erro', erro: 'Snapshot pré-restore falhou: ' + String((e as any)?.message || e),
    });
  }

  // 5) Executa restore atômico
  try {
    const t0 = Date.now();
    const r = await restoreTenant(c.env.DB, id_empresa, parsed);
    const dur = Date.now() - t0;

    await c.env.DB
      .prepare(`UPDATE backups SET dt_restaurado=datetime('now'), restaurado_por=?, status='restaurado' WHERE id_backup=?`)
      .bind(ator, id_backup).run();

    await logBackup(c.env.DB, {
      id_backup, id_empresa, action: 'restore_ok', ator, ip, ua,
      detalhes: { ...r, snapshot_id: snapshotId }, duracao_ms: dur,
    });
    await audit(c, 'backup', 'restore', String(id_backup), 'tenant', '', `inseridas=${r.inseridas}`);

    return c.json(ok({ ...r, snapshot_id: snapshotId, id_backup }));
  } catch (e: any) {
    const msg = String(e?.message || e);
    await logBackup(c.env.DB, {
      id_backup, id_empresa, action: 'restore_fail', ator, ip, ua,
      status: 'erro', erro: msg,
    });
    return fail('Falha ao restaurar: ' + msg + (snapshotId ? ` (snapshot #${snapshotId} preservado)` : ''), 500);
  }
});

// DELETE /api/backup/:id
app.delete('/backup/:id', async (c) => {
  const id_empresa = getEmpresa(c);
  const id_backup = toInt(c.req.param('id'));
  const user = c.get('user') as any;
  const ator = user?.login || 'sistema';

  const row = await c.env.DB
    .prepare(`SELECT id_backup FROM backups WHERE id_backup=? AND id_empresa=?`)
    .bind(id_backup, id_empresa).first();
  if (!row) return fail('Backup não encontrado.', 404);

  await c.env.DB
    .prepare(`DELETE FROM backups WHERE id_backup=? AND id_empresa=?`)
    .bind(id_backup, id_empresa).run();
  await logBackup(c.env.DB, {
    id_backup, id_empresa, action: 'delete', ator,
    ip: clientIp(c), ua: clientUA(c),
  });
  await audit(c, 'backup', 'delete', String(id_backup));
  return c.json(ok({ deletado: true }));
});

// GET /api/backup/logs — logs da empresa
app.get('/backup/logs', async (c) => {
  const id_empresa = getEmpresa(c);
  const limit = Math.min(toInt(c.req.query('limit'), 50), 200);
  const r = await c.env.DB
    .prepare(
      `SELECT id_log, id_backup, action, ator, ip, status, erro, duracao_ms, dt_log, detalhes
       FROM backup_logs WHERE id_empresa = ? ORDER BY dt_log DESC LIMIT ?`
    )
    .bind(id_empresa, limit).all();
  return c.json(ok(r.results || []));
});

/* ============================================================================
 * Rotas MASTER — /api/master/backup/*
 * ========================================================================== */

// GET /api/master/backup — todos backups (todas empresas + globais)
app.get('/master/backup', async (c) => {
  const idEmp = toInt(c.req.query('id_empresa') || 0);
  const escopo = (c.req.query('escopo') || '') as string;
  const where: string[] = ['1=1'];
  const binds: any[] = [];
  if (idEmp > 0) { where.push('b.id_empresa = ?'); binds.push(idEmp); }
  if (escopo === 'global') where.push('b.escopo = "global"');
  if (escopo === 'tenant') where.push('b.escopo = "tenant"');

  const r = await c.env.DB
    .prepare(
      `SELECT b.id_backup, b.id_empresa, c.nome AS nome_empresa,
              b.tipo, b.escopo, b.nome_arquivo, b.schema_version,
              b.tamanho_bytes, b.total_registros, b.total_tabelas, b.status, b.erro,
              b.duracao_ms, b.criado_por, b.dt_criacao, b.dt_restaurado,
              b.restaurado_por, b.observacao, b.storage_driver
       FROM backups b
       LEFT JOIN companies c ON c.id_empresa = b.id_empresa
       WHERE ${where.join(' AND ')}
       ORDER BY b.dt_criacao DESC
       LIMIT 500`
    )
    .bind(...binds).all();
  return c.json(ok(r.results || []));
});

// POST /api/master/backup/global — gera backup global
app.post('/master/backup/global', async (c) => {
  const master = c.get('master') as any;
  const ator = 'master:' + (master?.login || 'admin');
  const ip = clientIp(c);
  const ua = clientUA(c);

  const ins = await c.env.DB
    .prepare(
      `INSERT INTO backups (id_empresa, tipo, escopo, nome_arquivo, schema_version, status, criado_por, criado_por_ip)
       VALUES (NULL, 'global', 'global', ?, ?, 'pending', ?, ?)`
    )
    .bind(nomeArquivo('global', null), SCHEMA_VERSION, ator, ip).run();
  const id_backup = Number(ins.meta.last_row_id);

  try {
    const exp = await exportGlobal(c.env.DB, SCHEMA_VERSION);
    await c.env.DB
      .prepare(
        `UPDATE backups SET tamanho_bytes=?, total_registros=?, total_tabelas=?,
           checksum_sha256=?, payload=?, status='ok', duracao_ms=? WHERE id_backup=?`
      )
      .bind(
        exp.payloadGz.byteLength, exp.total_registros, exp.total_tabelas,
        exp.checksum, exp.payloadGz, exp.duracao_ms, id_backup
      ).run();

    // Retenção global (id_empresa=0 na config)
    const cfg = await getConfig(c.env.DB, 0);
    const r = await c.env.DB
      .prepare(`SELECT id_backup FROM backups WHERE escopo='global' ORDER BY dt_criacao DESC LIMIT -1 OFFSET ?`)
      .bind(cfg?.max_backups || 5).all<{ id_backup: number }>();
    const ids = (r.results || []).map((x) => x.id_backup);
    let removidos = 0;
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      await c.env.DB.prepare(`DELETE FROM backups WHERE id_backup IN (${ph})`).bind(...ids).run();
      removidos = ids.length;
    }

    await logBackup(c.env.DB, {
      id_backup, id_empresa: null, action: 'create', ator, ip, ua,
      detalhes: { tipo: 'global', total_registros: exp.total_registros, retencao_removidos: removidos },
      duracao_ms: exp.duracao_ms,
    });

    const row = await c.env.DB
      .prepare(`SELECT * FROM backups WHERE id_backup=?`).bind(id_backup).first();
    return c.json(ok(row, { retencao_removidos: removidos }));
  } catch (e: any) {
    const msg = String(e?.message || e);
    await c.env.DB
      .prepare(`UPDATE backups SET status='erro', erro=? WHERE id_backup=?`)
      .bind(msg, id_backup).run();
    await logBackup(c.env.DB, {
      id_backup, id_empresa: null, action: 'create', ator, ip, ua,
      status: 'erro', erro: msg,
    });
    return fail('Falha ao gerar backup global: ' + msg, 500);
  }
});

// POST /api/master/backup/tenant/:id — gera backup de UMA empresa (via master)
app.post('/master/backup/tenant/:id', async (c) => {
  const id_empresa = toInt(c.req.param('id'));
  if (!id_empresa) return fail('id_empresa inválido.', 400);
  const company = await c.env.DB
    .prepare(`SELECT id_empresa, nome FROM companies WHERE id_empresa=?`).bind(id_empresa).first<any>();
  if (!company) return fail('Empresa não encontrada.', 404);
  const master = c.get('master') as any;
  const ator = 'master:' + (master?.login || 'admin');
  const ip = clientIp(c);

  const ins = await c.env.DB
    .prepare(
      `INSERT INTO backups (id_empresa, tipo, escopo, nome_arquivo, schema_version, status, criado_por, criado_por_ip)
       VALUES (?, 'manual', 'tenant', ?, ?, 'pending', ?, ?)`
    )
    .bind(id_empresa, nomeArquivo('tenant', id_empresa), SCHEMA_VERSION, ator, ip).run();
  const id_backup = Number(ins.meta.last_row_id);

  try {
    const exp = await exportTenant(c.env.DB, id_empresa, SCHEMA_VERSION);
    await c.env.DB
      .prepare(
        `UPDATE backups SET tamanho_bytes=?, total_registros=?, total_tabelas=?,
           checksum_sha256=?, payload=?, status='ok', duracao_ms=? WHERE id_backup=?`
      )
      .bind(exp.payloadGz.byteLength, exp.total_registros, exp.total_tabelas,
            exp.checksum, exp.payloadGz, exp.duracao_ms, id_backup).run();
    await logBackup(c.env.DB, {
      id_backup, id_empresa, action: 'create', ator, ip, ua: clientUA(c),
      detalhes: { tipo: 'master_tenant', empresa: company.nome },
      duracao_ms: exp.duracao_ms,
    });
    const row = await c.env.DB
      .prepare(`SELECT * FROM backups WHERE id_backup=?`).bind(id_backup).first();
    return c.json(ok(row));
  } catch (e: any) {
    const msg = String(e?.message || e);
    await c.env.DB
      .prepare(`UPDATE backups SET status='erro', erro=? WHERE id_backup=?`).bind(msg, id_backup).run();
    return fail('Falha: ' + msg, 500);
  }
});

// GET /api/master/backup/:id/download
app.get('/master/backup/:id/download', async (c) => {
  const id_backup = toInt(c.req.param('id'));
  const master = c.get('master') as any;
  const ator = 'master:' + (master?.login || 'admin');

  const row = await c.env.DB
    .prepare(`SELECT id_backup, id_empresa, nome_arquivo, payload, tamanho_bytes,
                     checksum_sha256, status FROM backups WHERE id_backup=?`)
    .bind(id_backup).first<any>();
  if (!row) return fail('Backup não encontrado.', 404);
  if (row.status !== 'ok' || !row.payload) return fail('Backup indisponível.', 400);

  await logBackup(c.env.DB, {
    id_backup, id_empresa: row.id_empresa, action: 'download', ator,
    ip: clientIp(c), ua: clientUA(c), detalhes: { via: 'master', tamanho: row.tamanho_bytes },
  });
  const body = normalizeBlob(row.payload);
  if (!body) return fail('Payload em formato não suportado.', 500);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${row.nome_arquivo}"`,
      'Content-Length': String(body.byteLength),
      'X-Backup-Checksum': row.checksum_sha256 || '',
    },
  });
});

// POST /api/master/backup/:id/restore — master pode restaurar qualquer tenant
app.post('/master/backup/:id/restore', async (c) => {
  const id_backup = toInt(c.req.param('id'));
  const master = c.get('master') as any;
  const ator = 'master:' + (master?.login || 'admin');
  const ip = clientIp(c);
  const ua = clientUA(c);

  const body = await c.req.json().catch(() => ({}));
  const confirma = String(body.confirma_texto || '').trim().toUpperCase();
  if (confirma !== 'RESTAURAR') return fail('Digite RESTAURAR para confirmar.', 400);

  const row = await c.env.DB
    .prepare(`SELECT * FROM backups WHERE id_backup=?`).bind(id_backup).first<any>();
  if (!row) return fail('Backup não encontrado.', 404);
  if (row.status !== 'ok' || !row.payload) return fail('Backup indisponível.', 400);
  if (row.escopo === 'global') return fail('Restauração global não é suportada via UI. Procedimento manual.', 400);

  const id_empresa_alvo = Number(row.id_empresa);
  if (!id_empresa_alvo) return fail('Backup sem id_empresa associado.', 400);

  const payloadBytes = normalizeBlob(row.payload);
  if (!payloadBytes) return fail('Payload em formato inválido.', 500);
  const check = await sha256Hex(payloadBytes);
  if (check !== row.checksum_sha256) return fail('Checksum divergente.', 400);

  const parsed = await parseAndValidate(payloadBytes);
  if (parsed.meta.escopo !== 'tenant' || parsed.meta.id_empresa !== id_empresa_alvo) {
    return fail('Cross-tenant: payload não bate com empresa alvo.', 400);
  }

  await logBackup(c.env.DB, {
    id_backup, id_empresa: id_empresa_alvo, action: 'restore_start', ator, ip, ua,
    detalhes: { via: 'master' },
  });

  // Snapshot pré-restore
  let snapshotId: number | null = null;
  try {
    const pre = await exportTenant(c.env.DB, id_empresa_alvo, SCHEMA_VERSION);
    const ins = await c.env.DB
      .prepare(
        `INSERT INTO backups (id_empresa, tipo, escopo, nome_arquivo, schema_version,
                              tamanho_bytes, total_registros, total_tabelas, checksum_sha256,
                              payload, status, duracao_ms, criado_por, criado_por_ip, observacao)
         VALUES (?, 'pre_restore', 'tenant', ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?)`
      )
      .bind(
        id_empresa_alvo,
        `pre_restore_master_E${id_empresa_alvo}_${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)}.ndjson.gz`,
        SCHEMA_VERSION,
        pre.payloadGz.byteLength, pre.total_registros, pre.total_tabelas, pre.checksum,
        pre.payloadGz, pre.duracao_ms, ator, ip,
        `Snapshot master antes restore backup #${id_backup}`
      ).run();
    snapshotId = Number(ins.meta.last_row_id);
  } catch (e) {
    console.error('[master_restore] snapshot fail', e);
  }

  try {
    const t0 = Date.now();
    const r = await restoreTenant(c.env.DB, id_empresa_alvo, parsed);
    const dur = Date.now() - t0;
    await c.env.DB
      .prepare(`UPDATE backups SET dt_restaurado=datetime('now'), restaurado_por=?, status='restaurado' WHERE id_backup=?`)
      .bind(ator, id_backup).run();
    await logBackup(c.env.DB, {
      id_backup, id_empresa: id_empresa_alvo, action: 'restore_ok', ator, ip, ua,
      detalhes: { ...r, snapshot_id: snapshotId, via: 'master' }, duracao_ms: dur,
    });
    return c.json(ok({ ...r, snapshot_id: snapshotId }));
  } catch (e: any) {
    const msg = String(e?.message || e);
    await logBackup(c.env.DB, {
      id_backup, id_empresa: id_empresa_alvo, action: 'restore_fail', ator, ip, ua,
      status: 'erro', erro: msg,
    });
    return fail('Falha: ' + msg, 500);
  }
});

// DELETE /api/master/backup/:id
app.delete('/master/backup/:id', async (c) => {
  const id_backup = toInt(c.req.param('id'));
  const master = c.get('master') as any;
  const ator = 'master:' + (master?.login || 'admin');
  const row = await c.env.DB.prepare(`SELECT id_empresa FROM backups WHERE id_backup=?`).bind(id_backup).first<any>();
  if (!row) return fail('Backup não encontrado.', 404);
  await c.env.DB.prepare(`DELETE FROM backups WHERE id_backup=?`).bind(id_backup).run();
  await logBackup(c.env.DB, {
    id_backup, id_empresa: row.id_empresa ?? null, action: 'delete', ator,
    ip: clientIp(c), ua: clientUA(c), detalhes: { via: 'master' },
  });
  return c.json(ok({ deletado: true }));
});

// GET /api/master/backup/logs
app.get('/master/backup/logs', async (c) => {
  const limit = Math.min(toInt(c.req.query('limit'), 100), 500);
  const idEmp = toInt(c.req.query('id_empresa') || 0);
  const where = idEmp > 0 ? 'WHERE l.id_empresa = ?' : '';
  const binds = idEmp > 0 ? [idEmp, limit] : [limit];
  const r = await c.env.DB
    .prepare(
      `SELECT l.id_log, l.id_backup, l.id_empresa, c.nome AS nome_empresa,
              l.action, l.ator, l.ip, l.status, l.erro, l.duracao_ms, l.dt_log, l.detalhes
       FROM backup_logs l
       LEFT JOIN companies c ON c.id_empresa = l.id_empresa
       ${where}
       ORDER BY l.dt_log DESC LIMIT ?`
    )
    .bind(...binds).all();
  return c.json(ok(r.results || []));
});

export default app;
