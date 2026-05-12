import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings } from './lib/db';
import { authMiddleware, requireAdmin, requirePerfil } from './lib/auth';

import auth from './routes/auth';
import configuracoes from './routes/configuracoes';
import relatoriosDetalhados from './routes/relatorios_detalhados';
import terceirizacao from './routes/terceirizacao';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any } }>();

app.use('*', logger());
app.use('/api/*', cors());

// API — healthcheck (público)
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    sistema: 'CorePro Terceirização',
    timestamp: new Date().toISOString(),
  })
);

// Middleware de autenticação (protege /api/* exceto rotas públicas)
app.use('/api/*', authMiddleware);

// Auth e Terceirização: acessíveis a TODOS os usuários autenticados
app.route('/api', auth);
app.route('/api', terceirizacao);

// Configurações (parâmetros da empresa): admin only
// Relatórios: liberado para TODOS os usuários autenticados (alinhado com frontend)
const adminOnly = requireAdmin();

app.use('/api/parametros', adminOnly); app.use('/api/parametros/*', adminOnly);

app.route('/api', configuracoes);
app.route('/api', relatoriosDetalhados);

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
  <link href="/static/styles.css?v=14" rel="stylesheet" />
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
  <script src="/static/app.js?v=15"></script>
  <script src="/static/relatorios_det.js?v=5"></script>
</body>
</html>`;
}

export default app;
