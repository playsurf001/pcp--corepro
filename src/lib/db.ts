// Camada de acesso ao D1 + helpers
import type { Context } from 'hono';

export type Bindings = {
  DB: D1Database;
  // SPRINT 3 — Mercado Pago PIX. Configurar via:
  //   wrangler pages secret put MP_ACCESS_TOKEN --project-name corepro-confeccao
  // Se ausente, o sistema opera em modo MOCK (gera QR fake para desenvolvimento).
  MP_ACCESS_TOKEN?: string;
  // SPRINT D — Webhook secret do Mercado Pago (validação HMAC SHA-256).
  // wrangler pages secret put MP_WEBHOOK_SECRET --project-name corepro-confeccao
  MP_WEBHOOK_SECRET?: string;
  // SPRINT D — Forçar modo mock localmente sem precisar remover MP_ACCESS_TOKEN.
  //   "1" ou "true" → usa MockGateway (não chama API real do MP)
  MP_USE_MOCK?: string;
  // SPRINT D — Public Key e Client Secret (não usados runtime, mas armazenados)
  MP_PUBLIC_KEY?: string;
  MP_CLIENT_SECRET?: string;
  // Base URL pública (para montar notification_url do MP). Ex: https://confeccao.corepro.com.br
  PUBLIC_BASE_URL?: string;
};

/** Pega o login do usuário autenticado do contexto (ou 'sistema') */
export function getUser(c: Context): string {
  const u = c.get('user') as any;
  return u?.login || 'sistema';
}

/**
 * Pega o id_empresa (tenant) do contexto autenticado.
 * Fallback = 1 (empresa default "CorePro Confecção") para garantir
 * compatibilidade retroativa: qualquer chamada que não tenha contexto
 * válido cai na empresa default e não quebra o sistema.
 *
 * Uso padrão em rotas:
 *   const id_empresa = getEmpresa(c);
 *   // ... usar em WHERE e INSERT
 */
export function getEmpresa(c: Context): number {
  const v = c.get('id_empresa') as any;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Versão estrita: exige que o id_empresa esteja injetado no contexto.
 * Use em rotas críticas (criação de remessas, retornos, financeiro) onde
 * NÃO queremos fallback silencioso para empresa 1 caso o middleware falhe.
 *
 * Lança um Response 401 caso não exista — o handler global captura.
 */
export function requireEmpresa(c: Context): number {
  const v = c.get('id_empresa') as any;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Response(
      JSON.stringify({
        ok: false,
        error: 'Sessão sem empresa vinculada. Faça login novamente.',
        code: 'TENANT_REQUIRED',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return n;
}

/**
 * Log estruturado de eventos tenant-scoped. Aparece em pm2 logs e wrangler tail.
 * Útil para auditoria de operações críticas em produção.
 */
export function logTenant(
  c: Context,
  event: string,
  extra: Record<string, any> = {}
) {
  const user = c.get('user') as any;
  const path = new URL(c.req.url).pathname;
  const id_empresa = (c.get('id_empresa') as number) || 0;
  console.log(
    '[tenant]',
    JSON.stringify({
      event,
      method: c.req.method,
      path,
      login: user?.login || 'anon',
      id_empresa,
      ...extra,
    })
  );
}

/**
 * Registra auditoria.
 * @param dbOrCtx — pode ser um D1Database (passa usuário como último arg)
 *                  OU um Context do Hono (usuário é extraído de c.get('user'))
 */
export async function audit(
  dbOrCtx: D1Database | Context,
  modulo: string,
  acao: string,
  chave: string,
  campo = '',
  vAnt: any = '',
  vNovo: any = '',
  usuario?: string,
) {
  let db: D1Database;
  let user = usuario || 'sistema';
  if ((dbOrCtx as any).env?.DB) {
    const c = dbOrCtx as Context;
    db = c.env.DB as D1Database;
    const u = c.get('user') as any;
    if (!usuario && u?.login) user = u.login;
  } else {
    db = dbOrCtx as D1Database;
  }
  try {
    await db
      .prepare(
        `INSERT INTO auditoria (usuario, modulo, acao, chave_registro, campo, valor_anterior, valor_novo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        user,
        modulo,
        acao,
        chave,
        campo,
        vAnt == null ? '' : String(vAnt),
        vNovo == null ? '' : String(vNovo),
      )
      .run();
  } catch (e) {
    console.error('audit fail', e);
  }
}

export function ok<T>(data: T, extra: Record<string, any> = {}) {
  return { ok: true, data, ...extra };
}
export function fail(message: string, code = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: code,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function toInt(v: any, def = 0): number {
  if (v === null || v === undefined || v === '') return def;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? def : n;
}

export function toNum(v: any, def = 0): number {
  if (v === null || v === undefined || v === '') return def;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? def : n;
}

/* ================================================================
 * HOTFIX 0056 — D1 transient error retry
 *
 * Cloudflare D1 pode retornar erros TRANSITÓRIOS de storage
 * (cold-start / object reset / internal error) que se resolvem
 * sozinhos em milissegundos. Exemplos observados em prod:
 *   - "Internal error while starting up D1 DB storage caused object to be reset"
 *   - "Network connection lost"
 *   - "D1_ERROR" genérico intermitente
 *
 * isTransientD1Error() detecta esses padrões via mensagem.
 * withD1Retry() executa a operação até N vezes com backoff curto
 * (evita degradar UX em erros passageiros de infra).
 *
 * NÃO faz retry em erros DETERMINÍSTICOS (constraint, NOT NULL,
 * too many SQL vars, etc.) — esses devem falhar imediatamente.
 * ================================================================ */

/** Retorna true se a mensagem do erro indica falha transitória de infra do D1. */
export function isTransientD1Error(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!msg) return false;
  // Padrões observados em incidentes reais do Cloudflare D1
  return (
    msg.includes('caused object to be reset') ||
    msg.includes('starting up d1 db storage') ||
    msg.includes('network connection lost') ||
    msg.includes('storage caused object') ||
    (msg.includes('internal error') && msg.includes('d1')) ||
    // HOTFIX 0062 — cota diária do D1 free tier esgotada.
    // Não é "transitória" no sentido técnico (retry não resolve dentro do dia),
    // mas do ponto de vista do USUÁRIO é uma falha temporária de infra —
    // não deve derrubar sessão, não deve mostrar 500 assustador, e
    // reseta automaticamente à meia-noite UTC.
    isQuotaExceededError(err)
  );
}

/**
 * HOTFIX 0062 — detecta especificamente o erro de cota diária do D1 free tier.
 * Mensagem observada em prod:
 *   "D1_ERROR: Your account has exceeded D1's free tier daily row read limit.
 *    Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue."
 * Retorna true também para "read limit" e "write limit" para robustez.
 */
export function isQuotaExceededError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('exceeded d1') ||
    msg.includes('free tier daily') ||
    msg.includes('daily row read limit') ||
    msg.includes('daily row write limit') ||
    (msg.includes('quota') && msg.includes('exceeded')) ||
    (msg.includes('rate limit') && msg.includes('d1'))
  );
}

/* ================================================================
 * HOTFIX 0062 — CACHE IN-MEMORY POR ISOLATE
 *
 * Cloudflare Workers mantém memória viva ENTRE requests no mesmo
 * isolate (~30-60 min típico). Podemos cachear resultados de queries
 * hot para reduzir DRASTICAMENTE o número de reads no D1.
 *
 * Alvos principais (executados em CADA request autenticada):
 *   1. validarSessao — 1 SELECT com JOIN, ~7 reads/request
 *   2. tenantStatusGuard — 1 SELECT em companies, ~1 read/request
 *
 * Com cache de 60s (sessão) e 5min (empresa), a mesma pessoa navegando
 * o dashboard passa de ~10 reads/request → ~1 read/minuto.
 *
 * Cada isolate tem seu próprio cache — não há coerência global, mas
 * TTL curto de sessão garante que logout/troca-de-senha reflita
 * rapidamente. Emergência: /api/health/cache-flush limpa tudo.
 * ================================================================ */

type CacheEntry<T> = { value: T; expiresAt: number };

/** Cache genérico com TTL em ms. Isolate-scoped (não sobrevive a cold-start). */
export class TTLCache<K, V> {
  private map = new Map<K, CacheEntry<V>>();
  private hits = 0;
  private misses = 0;
  constructor(private maxSize = 2000) {}
  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) { this.misses++; return undefined; }
    if (e.expiresAt < Date.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return e.value;
  }
  set(key: K, value: V, ttlMs: number) {
    // LRU-ish: se atingir maxSize, remove o mais antigo (primeira chave inserida)
    if (this.map.size >= this.maxSize) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
  delete(key: K) { this.map.delete(key); }
  clear() { this.map.clear(); this.hits = 0; this.misses = 0; }
  stats() {
    return { size: this.map.size, hits: this.hits, misses: this.misses };
  }
}

/** Cache de sessões válidas: token → user row. TTL curto (60s). */
export const sessionCache = new TTLCache<string, any>(2000);

/** Cache de empresas ativas: id_empresa → row. TTL longo (5min). */
export const empresaCache = new TTLCache<number, any>(500);

/**
 * Executa uma operação D1 com retry automático em erros transitórios.
 * @param op função async que executa a query D1
 * @param opts { attempts?, baseDelayMs?, label? }
 * @returns o resultado da op se ela eventualmente suceder
 * @throws o último erro (transitório ou não) se todas as tentativas falharem
 */
export async function withD1Retry<T>(
  op: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const attempts   = Math.max(1, opts.attempts ?? 3);
  const baseDelay  = Math.max(10, opts.baseDelayMs ?? 60);
  const label      = opts.label || 'd1-op';
  let lastErr: any = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await op();
    } catch (e: any) {
      lastErr = e;
      if (!isTransientD1Error(e) || i === attempts) {
        // Erro não-transitório OU esgotou tentativas → propaga
        if (isTransientD1Error(e)) {
          console.error(`[${label}] D1 transient error - all ${attempts} attempts failed:`, e?.message || e);
        }
        throw e;
      }
      // Backoff exponencial curto: 60ms, 120ms, 240ms...
      const delay = baseDelay * Math.pow(2, i - 1);
      console.warn(`[${label}] D1 transient error on attempt ${i}/${attempts}, retrying in ${delay}ms:`, e?.message || e);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  // Nunca chega aqui, mas satisfaz o TS
  throw lastErr;
}
