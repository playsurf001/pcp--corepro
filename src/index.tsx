import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings } from './lib/db';
import { authMiddleware, requireAdmin, requirePerfil } from './lib/auth';
import { masterAuthMiddleware, tenantStatusGuard } from './lib/master_auth';
import { rateLimit } from './lib/rate_limit';

import auth from './routes/auth';
import backup from './routes/backup';
import billing from './routes/billing';
import configuracoes from './routes/configuracoes';
import cores from './routes/cores';
import empresa from './routes/empresa';
import master from './routes/master';
import paymentsTerc from './routes/payments_terc';
import relatoriosDetalhados from './routes/relatorios_detalhados';
import signup from './routes/signup';
import terceirizacao from './routes/terceirizacao';
import { runLifecycleFull, startJobRun, finishJobRun } from './lib/lifecycle';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any; master: any } }>();

app.use('*', logger());
app.use('/api/*', cors());

/* =============================================================
 * HANDLER GLOBAL DE ERROS (Multi-Tenant Safe)
 *
 * Captura QUALQUER exceção não tratada nas rotas /api/* e devolve
 * resposta JSON estruturada em português, com código + diagnóstico.
 *
 * Garantias:
 *  - Nunca devolve "Internal Server Error" cru com 500 vazio
 *  - Loga sempre id_empresa + login + path + método + payload abreviado
 *  - Detecta erros conhecidos de SQLite e converte para mensagens amigáveis
 *  - Mantém HTTP 5xx para erros não conhecidos (frontend pode retentar)
 * ============================================================= */
app.onError((err, c) => {
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;
  const user = c.get('user') as any;
  const id_empresa = (c.get('id_empresa') as number) || 0;
  const login = user?.login || 'anon';

  const raw = String(err?.message || err || 'Erro desconhecido');
  const stack = String((err as any)?.stack || '').split('\n').slice(0, 5).join('\n');

  // Log estruturado (visível em pm2 logs / wrangler tail)
  console.error(
    '[onError]',
    JSON.stringify({
      method, path, login, id_empresa,
      msg: raw.slice(0, 500),
    })
  );
  if (stack) console.error('[onError] stack:', stack);

  // --- Mapeamento de erros conhecidos para mensagens amigáveis ---
  // HOTFIX 0044: ordem dos testes ajustada para que padrões mais específicos
  // (FK / UNIQUE / NOT NULL / CHECK) sejam testados ANTES do regex genérico
  // /D1_ERROR/, que cobre TODOS os erros do D1 (eles vêm como
  // "D1_ERROR: FOREIGN KEY constraint failed", "D1_ERROR: too many SQL variables", etc.).
  // Também extraímos pistas adicionais (variáveis demais, banco bloqueado) e
  // passamos a expor o `hint` (mensagem técnica curta) MESMO em produção para
  // facilitar suporte sem vazar dados sensíveis.
  let status = 500;
  let friendly = 'Erro interno do servidor. Tente novamente em instantes.';
  let code: string | undefined = 'INTERNAL_ERROR';
  let hint: string | undefined; // pista técnica curta — sempre exposta

  if (/no such table/i.test(raw)) {
    status = 500;
    code = 'SCHEMA_OUTDATED';
    friendly = 'Estrutura do banco desatualizada. Contate o suporte.';
    const m = raw.match(/no such table:\s*([\w.]+)/i);
    if (m) hint = `Tabela ausente: ${m[1]}`;
  } else if (/no such column/i.test(raw)) {
    status = 500;
    code = 'SCHEMA_OUTDATED';
    friendly = 'Coluna ausente no banco. Atualize as migrations.';
    const m = raw.match(/no such column:\s*([\w.]+)/i);
    if (m) hint = `Coluna ausente: ${m[1]}`;
  } else if (/UNIQUE constraint failed/i.test(raw)) {
    status = 409;
    code = 'DUPLICATE';
    if (/cores\.nome/i.test(raw))   friendly = 'Já existe uma cor com este nome nesta empresa.';
    else if (/cores\.hex/i.test(raw)) friendly = 'Já existe uma cor com este código HEX nesta empresa.';
    else friendly = 'Registro duplicado nesta empresa.';
    const m = raw.match(/UNIQUE constraint failed:\s*([\w.,\s]+)/i);
    if (m) hint = `Único violado: ${m[1].trim()}`;
  } else if (/FOREIGN KEY constraint failed/i.test(raw)) {
    status = 409;
    code = 'FK_VIOLATION';
    friendly = 'Não foi possível concluir a operação pois há registros vinculados (retornos, pagamentos, romaneios ou outros lançamentos). Verifique as dependências e tente novamente.';
    hint = 'FOREIGN KEY constraint failed';
  } else if (/NOT NULL constraint failed/i.test(raw)) {
    status = 400;
    code = 'MISSING_FIELD';
    const m = raw.match(/NOT NULL constraint failed:\s*([\w.]+)/i);
    friendly = m ? `Campo obrigatório ausente: ${m[1]}.` : 'Campo obrigatório ausente.';
    if (m) hint = `NOT NULL: ${m[1]}`;
  } else if (/CHECK constraint failed/i.test(raw)) {
    status = 400;
    code = 'INVALID_VALUE';
    friendly = 'Valor inválido para o campo.';
    const m = raw.match(/CHECK constraint failed:\s*([\w.]+)/i);
    if (m) hint = `CHECK: ${m[1]}`;
  } else if (/too many SQL variables|too many parameters/i.test(raw)) {
    // D1 tem limite de ~100 parâmetros bindados por statement.
    status = 400;
    code = 'TOO_MANY_PARAMS';
    friendly = 'Operação com muitos itens de uma vez. Tente em lotes menores (até ~80 por vez).';
    hint = 'Limite de parâmetros do D1 excedido';
  } else if (/database is locked|SQLITE_BUSY/i.test(raw)) {
    status = 503;
    code = 'DB_BUSY';
    friendly = 'Banco temporariamente ocupado. Tente novamente em alguns segundos.';
    hint = 'Banco bloqueado momentaneamente';
  } else if (/is not valid JSON|Unexpected token/i.test(raw)) {
    status = 400;
    code = 'INVALID_JSON';
    friendly = 'Corpo da requisição inválido (JSON malformado).';
  } else if (/D1_ERROR/i.test(raw)) {
    status = 500;
    code = 'DB_ERROR';
    friendly = 'Erro no banco de dados. Equipe foi notificada.';
    // Extrai o que vem depois de "D1_ERROR:" como pista
    const m = raw.match(/D1_ERROR:\s*([^\n]+)/i);
    if (m) hint = m[1].slice(0, 160).trim();
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: friendly,
      code,
      // hint: pista técnica curta (≤160 chars), sem stack/dados sensíveis,
      // exposta também em produção para auxiliar suporte e o frontend mostrar contexto.
      hint,
      // detail: stack/raw completo — só em dev/local
      detail: (c.env as any)?.NODE_ENV === 'production' ? undefined : raw.slice(0, 300),
    }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
});

// API — healthcheck (público)
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    sistema: 'CorePro Terceirização',
    timestamp: new Date().toISOString(),
  })
);

// ────────────────────────────────────────────────────────────────────────
// ÁREA MASTER (Super Admin) — isolada do auth comum
// Registrar ANTES do authMiddleware geral para não conflitar.
// ────────────────────────────────────────────────────────────────────────
app.use('/api/master/*', masterAuthMiddleware);
// Rate limits da área master (login) — protege contra brute force
app.use('/api/master/auth/login', rateLimit({ key: 'master-login', max: 10, windowSec: 60 }));
app.route('/api', master);

// SPRINT 5 — Rate limits para endpoints públicos críticos
app.use('/api/public/signup',       rateLimit({ key: 'signup',  max: 5,  windowSec: 60 }));
app.use('/api/public/signup/check', rateLimit({ key: 'check',   max: 30, windowSec: 60 }));
app.use('/api/public/mp/webhook',   rateLimit({ key: 'webhook', max: 60, windowSec: 60 }));
app.use('/api/auth/login',          rateLimit({ key: 'login',   max: 15, windowSec: 60 }));

// Middleware de autenticação (protege /api/* exceto rotas públicas e /api/master/*)
// IMPORTANTE: registrar ANTES dos route handlers de billing/signup para que
// /api/billing/* (usuário) receba c.get('user') e c.get('id_empresa').
// /api/public/* é isento dentro do authMiddleware.
app.use('/api/*', authMiddleware);

// Tenant status guard: bloqueia empresas suspensas/bloqueadas (após auth).
// Exceções (login/me/billing/empresa/uso/public) tratadas dentro do guard.
app.use('/api/*', tenantStatusGuard());

// Signup público (/api/public/*) + Billing (/api/billing/* + /api/public/mp/webhook)
app.route('/api', signup);
app.route('/api', billing);

// Auth e Terceirização: acessíveis a TODOS os usuários autenticados
app.route('/api', auth);
app.route('/api', terceirizacao);

// Configurações (parâmetros da empresa): admin only
// Relatórios: liberado para TODOS os usuários autenticados (alinhado com frontend)
const adminOnly = requireAdmin();

app.use('/api/parametros', adminOnly); app.use('/api/parametros/*', adminOnly);

app.route('/api', configuracoes);
app.route('/api', cores);
app.route('/api', empresa);
app.route('/api', relatoriosDetalhados);

// HOTFIX 0038 — Backup & Restauração (tenant + master)
// O router 'backup' contém:
//   • /backup/*           → protegido por authMiddleware (usuário tenant)
//   • /master/backup/*    → protegido por masterAuthMiddleware (registrado ANTES no app)
// Ambos middlewares já estão configurados; apenas registramos as rotas aqui.
app.route('/api', backup);

// HOTFIX 0042 — Pagamentos de Terceirizados (tenant-scoped, audit, estorno admin-only)
app.route('/api', paymentsTerc);

// SPA: uma única página, navegação por hash
app.get('/', (c) => {
  return c.html(renderSPA());
});

function renderSPA(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CorePro — Terceirização Têxtil</title>
  <meta name="description" content="CorePro — Sistema profissional de gestão de terceirização têxtil." />
  <meta name="theme-color" content="#020617" />
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon.png" />
  <link rel="icon" type="image/png" sizes="192x192" href="/static/logo-icon.png" />
  <link rel="apple-touch-icon" href="/static/logo-icon.png" />
  <link rel="shortcut icon" href="/static/favicon.ico" />
  <!-- ANTI-FLASH: aplica tema antes de qualquer pintura -->
  <script>
    (function () {
      try {
        var saved = localStorage.getItem('corepro_theme');
        var sys = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        var theme = (saved === 'light' || saved === 'dark') ? saved : sys;
        document.documentElement.setAttribute('data-theme', theme);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'light' ? '#F8FAFC' : '#020617');
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    })();
  </script>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link href="/static/styles.css?v=52" rel="stylesheet" />
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] },
          colors: {
            brand: { DEFAULT: '#2563EB', dark: '#1D4ED8', light: '#60A5FA', neon: '#7C3AED' }
          }
        }
      }
    }
  </script>
  <style>html,body{font-family:'Inter',ui-sans-serif,system-ui,sans-serif;}</style>
</head>
<body class="min-h-screen">
  <div id="app">
    <div class="login-screen">
      <div class="text-center">
        <img src="/static/logo-icon.png" alt="CorePro" style="width:96px;height:96px;filter:drop-shadow(0 4px 20px rgba(37,99,235,.5));animation:pulse 2s ease-in-out infinite;" />
        <p style="margin-top:20px;color:var(--text-2,#9CA3AF);letter-spacing:.12em;font-size:.85rem;text-transform:uppercase;">
          <i class="fas fa-spinner fa-spin" style="color:#2563EB;margin-right:8px;"></i> Inicializando CorePro…
        </p>
      </div>
    </div>
  </div>
  <style>@keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.05);opacity:.85}}</style>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
  <script src="/static/core.js?v=4"></script>
  <script src="/static/app.js?v=52"></script>
  <script src="/static/relatorios_det.js?v=6"></script>
</body>
</html>`;
}

/* =============================================================
 * SPRINT C — Cloudflare Cron Trigger
 * Roda o lifecycle de assinaturas 1x/dia (03:00 UTC = 00:00 BRT).
 * Configurado em wrangler.jsonc → triggers.crons = ["0 3 * * *"]
 * ============================================================= */
async function scheduled(
  event: ScheduledEvent,
  env: Bindings,
  ctx: ExecutionContext
): Promise<void> {
  const t0 = Date.now();
  // Registra início do job composto
  const id_run = await startJobRun(env.DB, 'lifecycle_full', 'cron', 'cron');
  try {
    const result = await runLifecycleFull(env.DB);
    await finishJobRun(env.DB, id_run, {
      status: 'ok',
      processados: result.total_processados,
      resultado: {
        cron: event.cron,
        scheduledTime: new Date(event.scheduledTime).toISOString(),
        ...result.resultados,
      },
      duracao_ms: result.duracao_ms,
    });
    console.log(
      `[cron] lifecycle_full ok | processados=${result.total_processados} | duracao=${result.duracao_ms}ms`
    );
  } catch (e: any) {
    await finishJobRun(env.DB, id_run, {
      status: 'erro',
      processados: 0,
      erro: String(e?.message || e),
      duracao_ms: Date.now() - t0,
    });
    console.error('[cron] lifecycle_full erro:', e);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
