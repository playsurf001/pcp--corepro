import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings } from './lib/db';
import { authMiddleware } from './lib/auth';

import auth from './routes/auth';
import cadastros from './routes/cadastros';
import sequencias from './routes/sequencias';
import ops from './routes/ops';
import producao from './routes/producao';
import importador from './routes/importador';

const app = new Hono<{ Bindings: Bindings; Variables: { user: any } }>();

app.use('*', logger());
app.use('/api/*', cors());

// API — healthcheck (público)
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    sistema: 'PCP Confecção v2.0',
    timestamp: new Date().toISOString(),
  })
);

// Middleware de autenticação (protege /api/* exceto rotas públicas)
app.use('/api/*', authMiddleware);

app.route('/api', auth);
app.route('/api', cadastros);
app.route('/api', sequencias);
app.route('/api', ops);
app.route('/api', producao);
app.route('/api', importador);

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
  <title>PCP Confecção v2.0</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%91%95%3C/text%3E%3C/svg%3E" />
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link href="/static/styles.css" rel="stylesheet" />
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { DEFAULT: '#0f766e', dark: '#115e59', light: '#14b8a6' }
          }
        }
      }
    }
  </script>
</head>
<body class="bg-slate-50 min-h-screen">
  <div id="app">
    <div class="flex items-center justify-center h-screen">
      <div class="text-center">
        <i class="fas fa-spinner fa-spin text-4xl text-brand"></i>
        <p class="mt-3 text-slate-600">Carregando sistema...</p>
      </div>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="/static/app.js?v=2"></script>
</body>
</html>`;
}

export default app;
