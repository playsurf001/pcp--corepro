// =====================================================================
// SPRINT 5 — Rate Limit em memória (Cloudflare Workers isolate)
// =====================================================================
// Limita por IP+rota. Como cada isolate é independente, o limite
// efetivo é APROXIMADO (suficiente para anti-abuso básico). Para
// rate limit global preciso usaríamos Durable Objects ou KV — fica
// como SPRINT futuro.
//
// Uso:
//   import { rateLimit } from '../lib/rate_limit';
//   app.use('/api/public/signup', rateLimit({ key: 'signup', max: 5, windowSec: 60 }));
// =====================================================================
import type { Context, Next } from 'hono';

interface BucketEntry {
  resetAt: number;
  count: number;
}

const buckets = new Map<string, BucketEntry>();

// Limpeza ocasional (1 em 100 calls) para evitar growth descontrolado
let opCount = 0;
function gc() {
  opCount++;
  if (opCount % 100 !== 0) return;
  const now = Date.now();
  for (const [k, v] of buckets.entries()) {
    if (v.resetAt < now) buckets.delete(k);
  }
}

export interface RateLimitOptions {
  key: string;        // prefixo do bucket (ex: 'signup', 'login', 'webhook')
  max: number;        // requisições por janela
  windowSec: number;  // duração da janela em segundos
  by?: 'ip' | 'global'; // default 'ip'
}

export function rateLimit(opts: RateLimitOptions) {
  return async (c: Context, next: Next) => {
    gc();
    const ip =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for') ||
      c.req.header('x-real-ip') ||
      'unknown';
    const bucketKey = `${opts.key}:${opts.by === 'global' ? 'global' : ip}`;
    const now = Date.now();
    const winMs = opts.windowSec * 1000;

    const cur = buckets.get(bucketKey);
    if (!cur || cur.resetAt < now) {
      buckets.set(bucketKey, { resetAt: now + winMs, count: 1 });
      return next();
    }
    cur.count++;
    if (cur.count > opts.max) {
      const retryAfter = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Muitas requisições. Tente novamente em alguns segundos.',
          code: 'RATE_LIMITED',
          retry_after_seconds: retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          },
        }
      );
    }
    return next();
  };
}
