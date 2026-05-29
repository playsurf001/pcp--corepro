// ============================================================================
// HOTFIX 0038 — Backup Engine
// ----------------------------------------------------------------------------
// Responsabilidades:
//   1. Exportar dados (tenant-scoped OU global) em NDJSON gzipado
//   2. Calcular SHA-256 do payload
//   3. Restaurar payload validando integridade
//   4. Reaproveitado por endpoint manual + cron handler
// ----------------------------------------------------------------------------
// Formato do arquivo (.ndjson.gz):
//   linha 1  → { "_meta": true, schema_version, escopo, id_empresa,
//                generated_at, total_tabelas, total_registros }
//   linha 2..N → { "_table": "<nome>", "rows": [ {...}, {...} ] }
//                (uma linha por tabela; rows é o array completo daquela tabela)
//   última linha → { "_eof": true, checksum_data: "<sha256 das linhas anteriores>" }
// ============================================================================

/**
 * Tabelas tenant-scoped (todas têm coluna `id_empresa`).
 * Ordem é importante para restore (pais antes dos filhos para evitar FK).
 * Esta lista é a fonte da verdade do que entra no backup de UMA empresa.
 */
export const TENANT_TABLES: ReadonlyArray<string> = [
  // núcleo de cadastros
  'usuarios',
  'cores',
  'terc_setores',
  'terc_terceirizados',
  'terc_servicos',
  'terc_colecoes',
  'terc_produtos',
  'terc_produto_variacoes',
  'terc_grades_tamanho',
  'terc_precos',
  // remessas + grade + itens
  'terc_remessas',
  'terc_remessa_itens',
  'terc_remessa_grade',
  'terc_remessa_item_grade',
  // retornos + grade + itens
  'terc_retornos',
  'terc_retorno_itens',
  'terc_retorno_grade',
  'terc_retorno_item_grade',
  // consertos + eventos + alertas + auditoria
  'terc_consertos',
  'terc_conserto_grade',
  'terc_eventos',
  'terc_alertas',
  'auditoria',
  // parametros locais da empresa
  'parametros',
];

/**
 * Tabelas globais (sem id_empresa) — entram APENAS no backup global do master.
 */
export const GLOBAL_TABLES: ReadonlyArray<string> = [
  'companies',
  'plans',
  'subscriptions',
  'sub_logs',
  'payments',
  'payment_webhook_events',
  'super_admins',
  'job_runs',
];

/**
 * Hash SHA-256 → hex string (usa Web Crypto API, disponível no Workers).
 */
export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  let bytes: ArrayBuffer;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data).buffer;
  } else if (data instanceof Uint8Array) {
    // Garante ArrayBuffer próprio (não SharedArrayBuffer)
    bytes = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? (data.buffer as ArrayBuffer)
      : (data.slice().buffer as ArrayBuffer);
  } else {
    bytes = data;
  }
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Comprime um Uint8Array usando GZIP nativo do Workers (CompressionStream).
 */
export async function gzipCompress(input: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(input);
  writer.close();
  const out = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(out);
}

/**
 * Descomprime um Uint8Array gzipado.
 */
export async function gzipDecompress(input: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(input);
  writer.close();
  const out = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(out);
}

/**
 * Lista as tabelas que realmente existem no DB (intersecção com a lista esperada).
 * Evita erro de "no such table" caso uma migration ainda não tenha rodado em algum env.
 */
async function existingTables(db: D1Database, candidates: ReadonlyArray<string>): Promise<string[]> {
  const r = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all<{ name: string }>();
  const real = new Set((r.results || []).map((x) => x.name));
  return candidates.filter((t) => real.has(t));
}

export interface BackupResult {
  payloadGz: Uint8Array;
  checksum: string;
  total_tabelas: number;
  total_registros: number;
  schema_version: number;
  duracao_ms: number;
}

/**
 * Gera o backup de UMA empresa (tenant-scoped).
 * Atenção: já recebe id_empresa validado — não faz controle de permissão.
 */
export async function exportTenant(
  db: D1Database,
  id_empresa: number,
  schema_version = 38
): Promise<BackupResult> {
  const t0 = Date.now();
  const tables = await existingTables(db, TENANT_TABLES);
  const lines: string[] = [];
  let total_registros = 0;

  // header
  lines.push(JSON.stringify({
    _meta: true,
    escopo: 'tenant',
    id_empresa,
    schema_version,
    generated_at: new Date().toISOString(),
  }));

  for (const t of tables) {
    // SELECT * tenant-scoped
    const r = await db
      .prepare(`SELECT * FROM ${t} WHERE id_empresa = ?`)
      .bind(id_empresa)
      .all<any>();
    const rows = r.results || [];
    total_registros += rows.length;
    lines.push(JSON.stringify({ _table: t, rows }));
  }

  // EOF + checksum dos dados (do bloco _meta até o último _table)
  const dataJoined = lines.join('\n');
  const checksumData = await sha256Hex(dataJoined);
  lines.push(JSON.stringify({ _eof: true, checksum_data: checksumData }));

  const finalText = lines.join('\n') + '\n';
  const payloadGz = await gzipCompress(new TextEncoder().encode(finalText));
  const checksum = await sha256Hex(payloadGz); // hash do arquivo final

  return {
    payloadGz,
    checksum,
    total_tabelas: tables.length,
    total_registros,
    schema_version,
    duracao_ms: Date.now() - t0,
  };
}

/**
 * Gera backup GLOBAL (todas as empresas + tabelas globais).
 * Uso exclusivo do master.
 */
export async function exportGlobal(
  db: D1Database,
  schema_version = 38
): Promise<BackupResult> {
  const t0 = Date.now();
  const tenantT = await existingTables(db, TENANT_TABLES);
  const globalT = await existingTables(db, GLOBAL_TABLES);
  const lines: string[] = [];
  let total_registros = 0;

  lines.push(JSON.stringify({
    _meta: true,
    escopo: 'global',
    id_empresa: null,
    schema_version,
    generated_at: new Date().toISOString(),
  }));

  // Tabelas globais sem filtro
  for (const t of globalT) {
    const r = await db.prepare(`SELECT * FROM ${t}`).all<any>();
    const rows = r.results || [];
    total_registros += rows.length;
    lines.push(JSON.stringify({ _table: t, rows }));
  }

  // Tabelas tenant — todas as linhas de todas as empresas
  for (const t of tenantT) {
    const r = await db.prepare(`SELECT * FROM ${t}`).all<any>();
    const rows = r.results || [];
    total_registros += rows.length;
    lines.push(JSON.stringify({ _table: t, rows }));
  }

  const dataJoined = lines.join('\n');
  const checksumData = await sha256Hex(dataJoined);
  lines.push(JSON.stringify({ _eof: true, checksum_data: checksumData }));

  const finalText = lines.join('\n') + '\n';
  const payloadGz = await gzipCompress(new TextEncoder().encode(finalText));
  const checksum = await sha256Hex(payloadGz);

  return {
    payloadGz,
    checksum,
    total_tabelas: tenantT.length + globalT.length,
    total_registros,
    schema_version,
    duracao_ms: Date.now() - t0,
  };
}

/**
 * Parseia o payload NDJSON descomprimido em estrutura intermediária.
 * Lança erro se _eof estiver ausente, checksum_data falhar, ou estrutura corrompida.
 */
export interface ParsedBackup {
  meta: {
    escopo: 'tenant' | 'global';
    id_empresa: number | null;
    schema_version: number;
    generated_at: string;
  };
  tables: Array<{ name: string; rows: any[] }>;
}

export async function parseAndValidate(payloadGz: Uint8Array | ArrayBuffer): Promise<ParsedBackup> {
  const bytes = payloadGz instanceof ArrayBuffer ? new Uint8Array(payloadGz) : payloadGz;
  const decompressed = await gzipDecompress(bytes);
  const text = new TextDecoder().decode(decompressed).trim();
  const allLines = text.split('\n');
  if (allLines.length < 3) {
    throw new Error('Arquivo corrompido: estrutura mínima ausente (header/EOF).');
  }

  const eofRaw = allLines[allLines.length - 1];
  let eof: any;
  try { eof = JSON.parse(eofRaw); } catch { throw new Error('Linha EOF inválida.'); }
  if (!eof || eof._eof !== true || typeof eof.checksum_data !== 'string') {
    throw new Error('EOF ausente ou inválido.');
  }

  const dataPart = allLines.slice(0, -1).join('\n');
  const recompChecksum = await sha256Hex(dataPart);
  if (recompChecksum !== eof.checksum_data) {
    throw new Error('Checksum interno divergente — arquivo corrompido.');
  }

  // header
  let header: any;
  try { header = JSON.parse(allLines[0]); } catch { throw new Error('Header inválido.'); }
  if (!header._meta) throw new Error('Header _meta ausente.');

  const tables: ParsedBackup['tables'] = [];
  for (let i = 1; i < allLines.length - 1; i++) {
    let obj: any;
    try { obj = JSON.parse(allLines[i]); } catch { throw new Error(`Linha ${i + 1} inválida.`); }
    if (!obj._table || !Array.isArray(obj.rows)) {
      throw new Error(`Linha ${i + 1}: bloco de tabela mal formado.`);
    }
    tables.push({ name: obj._table, rows: obj.rows });
  }

  return {
    meta: {
      escopo: header.escopo,
      id_empresa: header.id_empresa ?? null,
      schema_version: header.schema_version,
      generated_at: header.generated_at,
    },
    tables,
  };
}

/**
 * Restaura UMA empresa a partir de um payload já parseado e validado.
 * Estratégia:
 *   1. DELETE FROM <tabela> WHERE id_empresa = ?
 *   2. INSERT cada row com colunas detectadas dinamicamente via PRAGMA table_info
 *   3. Tudo dentro de um único db.batch() para atomicidade
 *   4. id_empresa do payload é REESCRITO para o id_empresa alvo (cross-tenant restore protection)
 */
export async function restoreTenant(
  db: D1Database,
  id_empresa_alvo: number,
  parsed: ParsedBackup
): Promise<{ deletadas: number; inseridas: number; duracao_ms: number; tabelas_aplicadas: number }> {
  const t0 = Date.now();
  if (parsed.meta.escopo !== 'tenant') {
    throw new Error('Payload não é tenant (escopo=' + parsed.meta.escopo + ').');
  }

  const realTables = await existingTables(db, TENANT_TABLES);
  const realSet = new Set(realTables);

  // Para cada tabela, descobre colunas reais via PRAGMA (evita INSERT em coluna inexistente)
  const colsCache: Record<string, string[]> = {};
  for (const t of realTables) {
    const ti = await db.prepare(`PRAGMA table_info(${t})`).all<{ name: string }>();
    colsCache[t] = (ti.results || []).map((c) => c.name);
  }

  // Constrói stmts:
  //   0. PRAGMA defer_foreign_keys=ON — adia checagem de FK para o COMMIT
  //      (D1/SQLite suporta; permite DELETE + INSERT em qualquer ordem dentro do batch)
  //   1. DELETE de TODAS as tabelas (ordem reversa para respeitar dependências)
  //   2. INSERT linha-a-linha
  const stmts: D1PreparedStatement[] = [];
  stmts.push(db.prepare(`PRAGMA defer_foreign_keys = ON`));

  // DELETE em ordem reversa
  for (const t of [...realTables].reverse()) {
    stmts.push(db.prepare(`DELETE FROM ${t} WHERE id_empresa = ?`).bind(id_empresa_alvo));
  }

  // INSERTs (preserva id_empresa do alvo — substitui qualquer id_empresa do payload)
  let totalInseridas = 0;
  let tabelasAplicadas = 0;
  for (const { name, rows } of parsed.tables) {
    if (!realSet.has(name)) continue;            // tabela sumiu da DB — pula
    const realCols = colsCache[name] || [];
    if (!realCols.length) continue;
    if (!rows.length) { tabelasAplicadas++; continue; }
    tabelasAplicadas++;

    for (const row of rows) {
      // Filtra apenas colunas que existem no DB atual
      const insertCols: string[] = [];
      const insertVals: any[] = [];
      for (const col of realCols) {
        if (col === 'id_empresa') {
          insertCols.push(col);
          insertVals.push(id_empresa_alvo);              // FORÇA id_empresa alvo
        } else if (Object.prototype.hasOwnProperty.call(row, col)) {
          insertCols.push(col);
          insertVals.push(row[col]);
        }
      }
      if (!insertCols.length) continue;
      const placeholders = insertCols.map(() => '?').join(',');
      stmts.push(
        db.prepare(
          `INSERT OR REPLACE INTO ${name} (${insertCols.join(',')}) VALUES (${placeholders})`
        ).bind(...insertVals)
      );
      totalInseridas++;
    }
  }

  // batch() é atômico no D1 — se 1 stmt falhar, tudo é revertido
  await db.batch(stmts);

  return {
    deletadas: realTables.length,
    inseridas: totalInseridas,
    duracao_ms: Date.now() - t0,
    tabelas_aplicadas: tabelasAplicadas,
  };
}

/**
 * Aplica retenção: mantém apenas `max_backups` mais recentes da empresa.
 * Retorna a quantidade deletada.
 */
export async function applyRetention(
  db: D1Database,
  id_empresa: number | null,
  max_backups: number
): Promise<number> {
  if (max_backups <= 0) return 0;
  const where = id_empresa === null
    ? 'id_empresa IS NULL'
    : 'id_empresa = ?';
  const binds: any[] = id_empresa === null ? [] : [id_empresa];

  // Pega ids mais antigos além do limite
  const r = await db
    .prepare(`SELECT id_backup FROM backups WHERE ${where} ORDER BY dt_criacao DESC LIMIT -1 OFFSET ?`)
    .bind(...binds, max_backups)
    .all<{ id_backup: number }>();
  const ids = (r.results || []).map((x) => x.id_backup);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  await db.prepare(`DELETE FROM backups WHERE id_backup IN (${placeholders})`).bind(...ids).run();
  return ids.length;
}
