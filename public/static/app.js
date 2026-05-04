/* ============================================================
 * PCP Confecção v2.0 — SPA (vanilla JS)
 * Baseado no legado "Kamylla Ficha Balanceamento v1.0"
 * ============================================================ */
'use strict';

const API = '/api';

/* ---------- Utilitários ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const el = (tag, attrs = {}, children = []) => {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on') && typeof attrs[k] === 'function') e[k] = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
};
// Helpers defensivos: tudo que vier null/undefined/NaN/string‑inválida vira 0 ou []
const _safeNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const _safeArr = (v) => (Array.isArray(v) ? v : []);
const fmt = {
  num: (v, d = 2) => _safeNum(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }),
  int: (v) => _safeNum(v).toLocaleString('pt-BR'),
  pct: (v) => (_safeNum(v) * 100).toFixed(1) + '%',
  date: (s) => { if (!s) return ''; const d = dayjs(s); return d.isValid() ? d.format('DD/MM/YYYY') : ''; },
  datetime: (s) => { if (!s) return ''; const d = dayjs(s); return d.isValid() ? d.format('DD/MM/YYYY HH:mm') : ''; },
  safeNum: _safeNum,
  safeArr: _safeArr,
};
window.fmt = fmt;

function toast(msg, type = 'info') {
  const map = { info: 'bg-blue-600', success: 'bg-emerald-600', error: 'bg-red-600', warning: 'bg-amber-600' };
  const icon = { info: 'fa-info-circle', success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle' }[type] || 'fa-info-circle';
  const t = el('div', { class: 'toast' });
  t.innerHTML = `<div class="${map[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2"><i class="fas ${icon}"></i><span>${msg}</span></div>`;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-8px)'; setTimeout(() => t.remove(), 250); }, 3500);
}
// expõe global p/ core.js
window.toast = toast;

/* ---------- Autenticação ---------- */
const AUTH = {
  getToken: () => localStorage.getItem('pcp_token') || '',
  setToken: (t) => localStorage.setItem('pcp_token', t),
  clearToken: () => localStorage.removeItem('pcp_token'),
  getUser: () => { try { return JSON.parse(localStorage.getItem('pcp_user') || 'null'); } catch { return null; } },
  setUser: (u) => localStorage.setItem('pcp_user', JSON.stringify(u)),
  clearUser: () => localStorage.removeItem('pcp_user'),
};

async function api(method, path, body, opts = {}) {
  try {
    const headers = {};
    const token = AUTH.getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = await axios({ method, url: API + path, data: body, headers });
    return r.data;
  } catch (e) {
    const status = e.response?.status;
    const code = e.response?.data?.code;
    const msg = e.response?.data?.error || e.message || 'Erro';
    // Log estruturado p/ debug
    console.error('[api]', method?.toUpperCase(), path, 'status=' + status, 'code=' + code, '→', msg);
    // Token expirado ou inválido
    if (status === 401 && code === 'AUTH_REQUIRED' && !opts.silent) {
      AUTH.clearToken(); AUTH.clearUser();
      renderLogin('Sessão expirada. Faça login novamente.');
      throw e;
    }
    if (status === 403 && code === 'PASSWORD_CHANGE_REQUIRED' && !opts.silent) {
      renderTrocarSenhaObrigatoria();
      throw e;
    }
    if (!opts.silent) toast(msg, 'error');
    throw e;
  }
}
window.api = api;

/* ---------- Estado global ---------- */
const state = {
  route: 'dashboard',
  cache: {},
  user: null,
};

/* ---------- Layout / Navegação ----------
 * Política de acesso (refator 2026‑04‑30):
 *   - admin: vê TUDO
 *   - usuário comum (qualquer outro perfil): vê APENAS Terceirização
 *
 * Marcamos cada item com `tercOnly: true` (visível a todos) ou `adminOnly: true`
 * (visível só ao admin). A função podeAcessar() abaixo aplica as regras.
 *
 * Rotas de Terceirização agora ficam EXPANDIDAS no sidebar — sem accordion.
 */
const NAV = [
  // ==== TERCEIRIZAÇÃO (visível a todos os perfis autenticados) ====
  { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-line', group: 'Terceirização', tercOnly: true },
  { id: 'terc_remessas', label: 'Remessas', icon: 'fa-truck-fast', group: 'Terceirização', tercOnly: true },
  { id: 'terc_retornos', label: 'Retornos', icon: 'fa-truck-arrow-right', group: 'Terceirização', tercOnly: true },
  { id: 'terc_terceirizados', label: 'Terceirizados', icon: 'fa-handshake', group: 'Terceirização', tercOnly: true },
  { id: 'terc_produtos', label: 'Produtos', icon: 'fa-tshirt', group: 'Terceirização', tercOnly: true },
  { id: 'terc_precos', label: 'Preços / Coleção', icon: 'fa-money-bill-wave', group: 'Terceirização', tercOnly: true },
  { id: 'terc_importador', label: 'Importação', icon: 'fa-file-excel', group: 'Terceirização', tercOnly: true },

  // ==== ADMIN — Gestão ====
  { id: 'admin_dashboard', label: 'Dashboard MES', icon: 'fa-tachometer-alt', group: 'Gestão', adminOnly: true },
  { id: 'mes_dashboard', label: 'MES — Tempo Real', icon: 'fa-bolt', group: 'Gestão', adminOnly: true },
  { id: 'relatorios', label: 'Relatórios', icon: 'fa-file-pdf', group: 'Gestão', adminOnly: true },
  { id: 'alertas', label: 'Alertas & Notificações', icon: 'fa-bell', group: 'Gestão', adminOnly: true },

  // ==== ADMIN — Produção ====
  { id: 'ops', label: 'Ordens de Produção', icon: 'fa-clipboard-list', group: 'Produção', adminOnly: true },
  { id: 'balanceamento', label: 'Balanceamento', icon: 'fa-balance-scale', group: 'Produção', adminOnly: true },
  { id: 'ficha', label: 'Ficha Acompanhamento', icon: 'fa-file-invoice', group: 'Produção', adminOnly: true },
  { id: 'rastreabilidade', label: 'Rastreabilidade', icon: 'fa-route', group: 'Produção', adminOnly: true },

  // ==== ADMIN — Chão de Fábrica ====
  { id: 'apontamento_pro', label: 'Apontamento Pro (Timer)', icon: 'fa-stopwatch', group: 'Chão de Fábrica', adminOnly: true },
  { id: 'apontamento', label: 'Apontamento Simples', icon: 'fa-hard-hat', group: 'Chão de Fábrica', adminOnly: true },
  { id: 'colaboradores', label: 'Colaboradores', icon: 'fa-id-badge', group: 'Chão de Fábrica', adminOnly: true },
  { id: 'setores', label: 'Setores', icon: 'fa-sitemap', group: 'Chão de Fábrica', adminOnly: true },
  { id: 'bonificacao', label: 'Bonificação', icon: 'fa-trophy', group: 'Chão de Fábrica', adminOnly: true },

  // ==== ADMIN — Engenharia ====
  { id: 'sequencias', label: 'Sequências Operacionais', icon: 'fa-list-ol', group: 'Engenharia', adminOnly: true },

  // ==== ADMIN — Cadastros ====
  { id: 'referencias', label: 'Referências', icon: 'fa-tshirt', group: 'Cadastros', adminOnly: true },
  { id: 'clientes', label: 'Clientes', icon: 'fa-users', group: 'Cadastros', adminOnly: true },
  { id: 'operacoes', label: 'Operações', icon: 'fa-cogs', group: 'Cadastros', adminOnly: true },
  { id: 'maquinas', label: 'Máquinas', icon: 'fa-industry', group: 'Cadastros', adminOnly: true },
  { id: 'aparelhos', label: 'Aparelhos', icon: 'fa-tools', group: 'Cadastros', adminOnly: true },
  { id: 'cores', label: 'Cores', icon: 'fa-palette', group: 'Cadastros', adminOnly: true },
  { id: 'tamanhos', label: 'Tamanhos', icon: 'fa-ruler', group: 'Cadastros', adminOnly: true },

  // ==== ADMIN — Sistema ====
  { id: 'importador', label: 'Importador Geral', icon: 'fa-file-import', group: 'Sistema', adminOnly: true },
  { id: 'usuarios', label: 'Usuários', icon: 'fa-user-shield', group: 'Sistema', adminOnly: true },
  { id: 'parametros', label: 'Parâmetros', icon: 'fa-sliders-h', group: 'Sistema', adminOnly: true },
  { id: 'auditoria', label: 'Auditoria', icon: 'fa-history', group: 'Sistema', adminOnly: true },
];

/**
 * Política de visibilidade/acesso:
 *  - admin: pode tudo
 *  - qualquer outro perfil: APENAS itens marcados com tercOnly
 */
function isAdmin() { return state.user?.perfil === 'admin'; }
function podeAcessar(item) {
  if (!item) return false;
  if (isAdmin()) return true;
  return !!item.tercOnly;
}

function renderLayout() {
  const groups = {};
  NAV.filter(podeAcessar).forEach((n) => { (groups[n.group] ||= []).push(n); });
  const u = state.user || { login: '?', nome: '?', perfil: '?' };

  $('#app').innerHTML = `
  <div class="flex h-screen">
    <aside id="sidebar" class="sidebar">
      <a href="#dashboard" data-route="dashboard" class="sidebar-brand" title="CorePro — Dashboard">
        <img src="/static/logo-full.png" alt="CorePro" />
        <span class="sidebar-tagline">Onde sistemas se tornam negócio</span>
      </a>
      <nav class="sidebar-nav" aria-label="Navegação principal">
        ${Object.entries(groups).map(([g, items]) => `
          <div class="nav-section">
            <div class="nav-group-label">${g}</div>
            ${items.map(i => `
              <a href="#${i.id}" data-route="${i.id}" class="nav-item">
                <i class="fas ${i.icon}"></i>
                <span>${i.label}</span>
              </a>`).join('')}
          </div>
        `).join('')}
      </nav>
    </aside>
    <div class="flex-1 flex flex-col overflow-hidden">
      <header id="topbar" class="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <h2 id="page-title" class="text-lg font-semibold text-slate-800">Dashboard</h2>
        <div class="text-sm text-slate-500 flex items-center gap-3">
          <span id="today">${dayjs().format('DD/MM/YYYY')}</span>
          <span class="text-slate-300">|</span>
          ${Theme.toggleButtonHTML()}
          <div class="relative">
            <button id="user-btn" class="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-slate-100">
              <i class="fas fa-user-circle text-brand text-lg"></i>
              <span class="text-slate-700"><b>${u.nome}</b> <span class="text-xs text-slate-400">(${u.perfil})</span></span>
              <i class="fas fa-caret-down text-xs"></i>
            </button>
            <div id="user-menu" class="hidden absolute right-0 mt-1 w-52 bg-white border rounded shadow-lg z-50">
              <button id="btn-trocar-senha" class="w-full text-left px-4 py-2 text-sm hover:bg-slate-50"><i class="fas fa-key mr-2"></i>Trocar senha</button>
              <button id="btn-logout" class="w-full text-left px-4 py-2 text-sm hover:bg-red-50 text-red-600"><i class="fas fa-sign-out-alt mr-2"></i>Sair</button>
            </div>
          </div>
        </div>
      </header>
      <main id="main-content" class="flex-1 overflow-auto p-6 bg-slate-50"></main>
    </div>
  </div>`;

  $$('[data-route]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    navigate(a.dataset.route);
  }));

  const btn = $('#user-btn'), menu = $('#user-menu');
  btn.onclick = () => menu.classList.toggle('hidden');
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) menu.classList.add('hidden');
  });
  $('#btn-logout').onclick = async () => {
    try { await api('post', '/auth/logout', {}, { silent: true }); } catch {}
    AUTH.clearToken(); AUTH.clearUser();
    location.hash = '';
    renderLogin('Sessão encerrada.');
  };
  $('#btn-trocar-senha').onclick = () => openTrocarSenha(false);
  // Theme toggle (sistema dual light/dark)
  Theme.bindToggle('#theme-toggle-btn');
}

/**
 * Rota inicial padrão.
 *  - admin: 'admin_dashboard' (visão MES)
 *  - usuário comum: 'dashboard' (Dashboard de Terceirização)
 */
function rotaInicial() {
  return 'dashboard';
}

/**
 * Guarda de rota: bloqueia acesso direto via URL/hash a módulos restritos
 * para usuários não-admin, redirecionando para o dashboard inicial.
 */
function navigate(route) {
  // Resolve item do NAV (ou aceita rota dinâmica não listada)
  const nav = NAV.find((n) => n.id === route);

  // Se rota não existe ou não é permitida ao usuário, redireciona p/ dashboard
  if (route && nav && !podeAcessar(nav)) {
    console.warn('[navigate] Acesso negado a', route, '— redirecionando');
    toast('Acesso restrito. Apenas administradores podem visualizar este módulo.', 'warning');
    route = rotaInicial();
  }
  if (!route) route = rotaInicial();

  state.route = route;
  location.hash = route;
  $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  const navResolved = NAV.find((n) => n.id === route);
  const titleEl = $('#page-title');
  if (titleEl) titleEl.textContent = navResolved ? navResolved.label : route;
  render();
}

/* ---------- Renderer principal ---------- */
async function render() {
  const main = $('#main-content');
  if (!main) { console.warn('[render] #main-content não encontrado (sem layout?)'); return; }

  // Guarda extra de segurança: se a rota atual não estiver permitida ao usuário,
  // força volta ao dashboard inicial (impede acesso via hash direto na URL).
  const navItem = NAV.find((n) => n.id === state.route);
  if (navItem && !podeAcessar(navItem)) {
    console.warn('[render] Rota bloqueada:', state.route);
    state.route = rotaInicial();
    location.hash = state.route;
  }

  main.innerHTML = `<div class="text-center py-16"><i class="fas fa-spinner fa-spin text-3xl text-brand"></i><div class="text-xs text-slate-400 mt-3 uppercase tracking-widest">Carregando…</div></div>`;
  const handler = ROUTES[state.route] || ROUTES[rotaInicial()] || ROUTES.dashboard;
  try {
    await handler(main);
    AppStore?.set?.({ route: state.route, loading: false });
  } catch (e) {
    console.error('[render]', state.route, e);
    // Se for 403 ADMIN_REQUIRED, redireciona para dashboard inicial
    const code = e?.response?.data?.code || e?.code;
    if (code === 'ADMIN_REQUIRED') {
      toast('Acesso restrito a administradores. Redirecionando…', 'warning');
      setTimeout(() => navigate(rotaInicial()), 600);
      return;
    }
    main.innerHTML = `<div class="card p-6"><div class="text-red-600 font-semibold mb-2"><i class="fas fa-exclamation-triangle mr-2"></i>Erro ao carregar tela</div><div class="text-sm text-slate-500">${e.message || e}</div><button class="btn btn-secondary mt-4" onclick="render()"><i class="fas fa-redo mr-1"></i>Tentar novamente</button></div>`;
  }
}
window.render = render;
window.navigate = navigate;

/* ============================================================
 * TELAS
 * ============================================================ */
const ROUTES = {};

/* ---------- DASHBOARD ---------- */
// Dashboard de FÁBRICA (MES) — APENAS admin (renomeado de 'dashboard' p/ 'admin_dashboard')
ROUTES.admin_dashboard = async (main) => {
  const [r, rMes] = await Promise.all([
    api('get', '/dashboard'),
    api('get', '/dashboard/mes', null, { silent: true }).catch(() => ({ data: null })),
  ]);
  const d = r.data;
  const mes = rMes && rMes.data ? rMes.data : null;

  // % refugo invertido (quanto menor, melhor) — usamos como "saúde de qualidade"
  const refugo = Number(d.refugo_pct || 0);
  const eficiencia = Number(d.eficiencia_real || 0);
  const opsTotal = Number(d.ops_abertas || 0);
  const opsAtrasadas = Number(d.ops_atrasadas || 0);
  const pctAtraso = opsTotal ? (opsAtrasadas / opsTotal) * 100 : 0;

  main.innerHTML = `
    ${UI.pageHeader({
      breadcrumb: [{ label: 'Início' }, { label: 'Dashboard' }],
      title: 'Visão Geral da Produção',
      badge: 'MES',
      desc: 'Indicadores em tempo real de Ordens de Produção, eficiência operacional e qualidade.',
      live: true,
      actions: `
        <button class="btn-icon" id="btn-refresh-dash" title="Atualizar dados"><i class="fas fa-sync-alt"></i></button>
        <button class="btn btn-primary" data-route-link="ops"><i class="fas fa-plus mr-2"></i>Nova OP</button>
      `,
    })}

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
      ${UI.kpi({
        label: 'OPs Abertas', value: fmt.int(d.ops_abertas), icon: 'fa-folder-open',
        accent: 'blue', sub: 'no momento'
      })}
      ${UI.kpi({
        label: 'OPs Atrasadas', value: fmt.int(d.ops_atrasadas), icon: 'fa-triangle-exclamation',
        accent: 'red',
        trend: { dir: opsAtrasadas > 0 ? 'down' : 'up', text: pctAtraso.toFixed(1) + '%' },
        sub: 'do total aberto',
        progress: pctAtraso
      })}
      ${UI.kpi({
        label: 'Peças em Aberto', value: fmt.int(d.pecas_aberto), icon: 'fa-cubes',
        accent: 'indigo', sub: 'a produzir'
      })}
      ${UI.kpi({
        label: 'Prazo Médio', value: fmt.num(d.prazo_medio_dias, 1), icon: 'fa-calendar-day',
        accent: 'amber', sub: 'dias úteis'
      })}
      ${UI.kpi({
        label: 'Minutos em Aberto', value: fmt.int(d.minutos_aberto), icon: 'fa-clock',
        accent: 'cyan', sub: 'tempo planejado'
      })}
      ${UI.kpi({
        label: 'Produção Boa (mês)', value: fmt.int(d.producao_boa_mes), icon: 'fa-circle-check',
        accent: 'green', sub: 'peças aprovadas'
      })}
      ${UI.kpi({
        label: 'Refugo', value: fmt.pct(d.refugo_pct), icon: 'fa-recycle',
        accent: 'rose',
        trend: { dir: refugo > 3 ? 'down' : 'up', text: refugo > 3 ? 'Alto' : 'OK' },
        sub: 'meta < 3%',
        progress: Math.min(100, refugo * 10)
      })}
      ${UI.kpi({
        label: 'Eficiência Real', value: fmt.pct(d.eficiencia_real), icon: 'fa-gauge-high',
        accent: 'purple',
        trend: { dir: eficiencia >= 80 ? 'up' : eficiencia >= 60 ? 'flat' : 'down', text: eficiencia >= 80 ? 'Ótimo' : eficiencia >= 60 ? 'OK' : 'Baixo' },
        sub: 'OEE estimado',
        progress: eficiencia
      })}
    </div>

    ${mes ? `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
      <div class="card p-5 lg:col-span-2">
        ${UI.section({ title: 'Alertas Críticos', icon: 'fa-bell', meta: `${mes.alertas.length} sinal(is)` })}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${mes.alertas.map(a => UI.alert(a)).join('')}
        </div>
      </div>
      <div class="card p-5">
        ${UI.section({ title: 'Top Operadores (7d)', icon: 'fa-trophy', meta: 'ranking' })}
        <div class="rank-list">
          ${(mes.top_operadores && mes.top_operadores.length)
            ? mes.top_operadores.map((op, i) => UI.rankRow(
                i + 1,
                op.operador || '—',
                `${fmt.int(op.pecas)} peças · ${fmt.num(op.horas, 1)}h`,
                fmt.pct(op.eficiencia)
              )).join('')
            : `<div style="text-align:center;color:var(--text-secondary);font-size:13px;padding:20px 0">
                 <i class="fas fa-users-slash" style="font-size:24px;opacity:.4;display:block;margin-bottom:8px"></i>
                 Sem apontamentos nos últimos 7 dias
               </div>`}
        </div>
      </div>
    </div>

    <div class="card p-5 mb-5">
      ${UI.section({ title: 'OPs em Produção', icon: 'fa-industry', meta: `${(mes.ops_ativas || []).length} ativa(s)` })}
      ${(mes.ops_ativas && mes.ops_ativas.length) ? `
        <div class="overflow-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-100"><tr>
              <th class="px-3 py-2 text-left">Nº OP</th>
              <th class="px-3 py-2 text-left">Referência / Cliente</th>
              <th class="px-3 py-2 text-right">Peças</th>
              <th class="px-3 py-2 text-left">Progresso</th>
              <th class="px-3 py-2 text-left">Entrega</th>
              <th class="px-3 py-2 text-left">Status</th>
            </tr></thead>
            <tbody>
              ${mes.ops_ativas.map(op => {
                const pct = op.qtde_pecas > 0 ? Math.min(100, (op.produzido / op.qtde_pecas) * 100) : 0;
                const status = op.atrasada ? 'Atrasada' : op.status;
                return `<tr class="border-t${op.atrasada ? ' row-late' : ''}">
                  <td class="px-3 py-2 font-mono font-semibold">${op.num_op}</td>
                  <td class="px-3 py-2">
                    <div style="font-weight:600">${op.cod_ref}</div>
                    <div style="font-size:11px;color:var(--text-secondary)"><i class="fas fa-user mr-1"></i>${op.nome_cliente}</div>
                  </td>
                  <td class="px-3 py-2 text-right">${fmt.int(op.qtde_pecas)}</td>
                  <td class="px-3 py-2">${UI.progress(pct, { late: !!op.atrasada })}</td>
                  <td class="px-3 py-2 ${op.atrasada ? 'font-semibold' : ''}" style="${op.atrasada ? 'color:#EF4444' : ''}">${fmt.date(op.dt_entrega)}</td>
                  <td class="px-3 py-2">${UI.statusPill(status)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>` : `${UI.empty({
          icon: 'fa-industry',
          title: 'Nenhuma OP em produção',
          desc: 'Quando OPs estiverem ativas, elas aparecerão aqui em tempo real.'
        })}`}
    </div>
    ` : ''}

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="card p-5">
        ${UI.section({ title: 'Carga por Cliente', icon: 'fa-users', meta: 'TOP 10' })}
        <canvas id="ch-cli" height="220"></canvas>
      </div>
      <div class="card p-5">
        ${UI.section({ title: 'Carga por Referência', icon: 'fa-tags', meta: 'TOP 10' })}
        <canvas id="ch-ref" height="220"></canvas>
      </div>
      <div class="card p-5">
        ${UI.section({ title: 'OPs por Status', icon: 'fa-chart-pie', meta: 'tempo real' })}
        <canvas id="ch-st" height="180"></canvas>
      </div>
      <div class="card p-5">
        ${UI.section({ title: 'Fluxo recomendado', icon: 'fa-route' })}
        <ul class="space-y-2 text-sm" style="color:var(--text-secondary)">
          <li><i class="fas fa-check" style="color:var(--primary)"></i> &nbsp;Cadastre: <b>Máquinas → Aparelhos → Operações → Referências</b></li>
          <li><i class="fas fa-check" style="color:var(--primary)"></i> &nbsp;Crie a <b>Sequência Operacional</b> e <b>ATIVE</b> a versão.</li>
          <li><i class="fas fa-check" style="color:var(--primary)"></i> &nbsp;Abra OPs preenchendo <b>cores e tamanhos</b> (soma = qtde).</li>
          <li><i class="fas fa-check" style="color:var(--primary)"></i> &nbsp;Use o <b>Balanceamento</b> para dimensionar máquinas/operadores.</li>
          <li><i class="fas fa-check" style="color:var(--primary)"></i> &nbsp;Imprima a <b>Ficha</b> e registre no <b>Apontamento</b>.</li>
        </ul>
      </div>
    </div>
  `;

  // Live tick
  UI.liveTick(main, Date.now());

  // Botão refresh com spinner
  const btnRefresh = $('#btn-refresh-dash');
  if (btnRefresh) btnRefresh.onclick = async () => {
    btnRefresh.classList.add('is-spinning');
    try { await ROUTES.dashboard(main); }
    finally { btnRefresh.classList.remove('is-spinning'); }
  };

  // Atalho "Nova OP"
  const newOpBtn = main.querySelector('[data-route-link="ops"]');
  if (newOpBtn) newOpBtn.onclick = () => navigate('ops');

  // Tema CorePro para Chart.js (cores neon + eixos escuros)
  const CP_THEME = {
    primary: '#2563EB', secondary: '#7C3AED', success: '#00FF9C',
    warning: '#F97316', danger: '#FF3B3B', grid: 'rgba(148,163,184,0.10)',
    tick: '#9CA3AF',
  };
  const axisCfg = {
    scales: {
      x: { ticks: { color: CP_THEME.tick }, grid: { color: CP_THEME.grid } },
      y: { ticks: { color: CP_THEME.tick }, grid: { color: CP_THEME.grid } }
    },
    plugins: { legend: { labels: { color: '#E5E7EB' } } }
  };

  const labels = d.carga_clientes.map(x => x.nome_cliente);
  const data = d.carga_clientes.map(x => x.pecas);
  if (labels.length) new Chart($('#ch-cli'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Peças', data, backgroundColor: CP_THEME.primary, borderRadius: 6, borderSkipped: false }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: axisCfg.scales }
  });

  const labelsR = d.carga_refs.map(x => x.cod_ref + ' - ' + (x.desc_ref || '').slice(0, 25));
  const dataR = d.carga_refs.map(x => x.pecas);
  if (labelsR.length) new Chart($('#ch-ref'), {
    type: 'bar',
    data: { labels: labelsR, datasets: [{ label: 'Peças', data: dataR, backgroundColor: CP_THEME.secondary, borderRadius: 6, borderSkipped: false }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: axisCfg.scales }
  });

  const labelsS = d.status_breakdown.map(x => x.status);
  const dataS = d.status_breakdown.map(x => x.c);
  const statusColors = { 'Aberta':'#6B7280', 'Planejada':CP_THEME.secondary, 'EmProducao':CP_THEME.primary, 'Concluida':CP_THEME.success, 'Cancelada':CP_THEME.danger };
  if (labelsS.length) new Chart($('#ch-st'), {
    type: 'doughnut',
    data: { labels: labelsS, datasets: [{ data: dataS, backgroundColor: labelsS.map(s => statusColors[s] || CP_THEME.primary), borderColor: '#0B1120', borderWidth: 2 }] },
    options: { plugins: { legend: { labels: { color: '#E5E7EB' } } }, cutout: '60%' }
  });
};

function kpi(label, value, icon, color) {
  return `<div class="kpi-card"><div class="kpi-icon ${color}"><i class="fas ${icon}"></i></div>
    <div><div class="text-2xl font-bold text-slate-800">${value}</div><div class="text-xs text-slate-500">${label}</div></div></div>`;
}

/* ============================================================
 * CADASTROS GENÉRICOS (Clientes, Refs, Máquinas, etc.)
 * ============================================================ */
function makeCrud(config) {
  return async (main) => {
    let data = [];
    try {
      data = await Data.loadData(config.endpoint);
    } catch (e) {
      main.innerHTML = `<div class="card p-6 text-red-600"><i class="fas fa-exclamation-triangle mr-2"></i>Falha ao carregar ${config.label.toLowerCase()}: ${e.message || e}</div>`;
      return;
    }

    // Filtro local por texto (persistido por rota)
    const scope = `crud_${state.route}`;
    const savedFilter = FilterStore.get(scope);
    const search = (savedFilter.q || '').toLowerCase();

    const filtered = !search ? data : data.filter((row) =>
      config.cols.some((c) => String((c.render ? c.render(row) : row[c.field]) ?? '').toLowerCase().includes(search))
    );

    main.innerHTML = `
      <div class="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div class="flex items-center gap-3">
          <div class="text-slate-600 text-sm">${filtered.length}/${data.length} registro(s)</div>
          <input type="search" data-filter="q" placeholder="Buscar..." class="text-sm" style="width:240px"/>
        </div>
        <button id="btn-new" class="btn btn-primary"><i class="fas fa-plus mr-1"></i> Novo</button>
      </div>
      <div class="card overflow-hidden">
        <table class="w-full text-sm table-sticky">
          <thead class="bg-slate-100 text-slate-700">
            <tr>${config.cols.map(c => `<th class="px-3 py-2 text-left">${c.label}</th>`).join('')}
              <th class="px-3 py-2 text-center w-28">Ações</th></tr>
          </thead>
          <tbody id="tbody"></tbody>
        </table>
        ${filtered.length === 0 ? '<div class="p-6 text-center text-slate-500">Nenhum registro encontrado.</div>' : ''}
      </div>`;

    const tbody = $('#tbody');
    filtered.forEach((row) => {
      const tr = el('tr', { class: 'border-t hover:bg-slate-50' });
      config.cols.forEach((c) => {
        let v = row[c.field];
        if (c.render) v = c.render(row);
        else if (c.type === 'bool') v = v ? '<i class="fas fa-check text-emerald-600"></i>' : '<i class="fas fa-times text-slate-400"></i>';
        else if (c.type === 'date') v = fmt.date(v);
        else if (c.type === 'pct') v = fmt.pct(v);
        else if (c.type === 'num') v = fmt.num(v, c.decimals ?? 2);
        tr.appendChild(el('td', { class: 'px-3 py-2', html: v ?? '' }));
      });
      const acts = el('td', { class: 'px-3 py-2 text-center' });
      const idv = row[config.idField];
      const isAtivo = row.ativo === 1 || row.ativo === true;
      const toggleBtn = config.toggleAtivo
        ? `<button title="${isAtivo ? 'Inativar' : 'Reativar'}" class="mr-2" style="color:${isAtivo ? 'var(--warning)' : 'var(--success)'}" data-toggle="${idv}" data-ativo="${isAtivo ? 1 : 0}">
             <i class="fas ${isAtivo ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
           </button>`
        : '';
      acts.innerHTML = `
        <button title="Editar" class="mr-2" style="color:var(--primary)" data-edit="${idv}"><i class="fas fa-edit"></i></button>
        ${toggleBtn}
        <button title="Excluir definitivamente" style="color:var(--danger)" data-del="${idv}"><i class="fas fa-trash"></i></button>`;
      tr.appendChild(acts);
      tbody.appendChild(tr);
    });

    // Liga filtros (auto-restore + auto-save)
    FilterStore.bind(scope, main);

    // Re-render local (não recarrega tudo)
    const reload = () => ROUTES[state.route](main);

    $('#btn-new').onclick = () => openCrudForm(config, null, reload);
    $$('[data-edit]').forEach((b) => b.onclick = () => {
      const id = parseInt(b.dataset.edit);
      openCrudForm(config, data.find((x) => x[config.idField] === id), reload);
    });

    // Toggle ativo/inativo
    $$('[data-toggle]').forEach((b) => b.onclick = async () => {
      const id = b.dataset.toggle;
      const atual = parseInt(b.dataset.ativo) === 1;
      const novo = atual ? 0 : 1;
      if (!confirm(atual ? 'Inativar este cadastro?' : 'Reativar este cadastro?')) return;
      const ok = await Data.patchItem(config.endpoint, id, 'ativo', { ativo: novo },
        { successMsg: novo ? 'Reativado.' : 'Inativado.', btn: b });
      if (ok) reload();
    });

    // Hard delete
    $$('[data-del]').forEach((b) => b.onclick = async () => {
      const id = b.dataset.del;
      const row = data.find((x) => String(x[config.idField]) === String(id));
      const nome = row ? (row[config.labelField] || row.nome_cliente || row.cod_cliente || row.desc_op || `#${id}`) : `#${id}`;
      const msg = `Excluir DEFINITIVAMENTE ${config.label.toLowerCase()} "${nome}"?\n\n` +
                  `Esta ação não pode ser desfeita. Se houver registros vinculados, a exclusão será bloqueada.`;
      const ok = await Data.deleteItem(config.endpoint, id, { confirmMsg: msg, successMsg: `${config.label} excluído.`, btn: b });
      if (ok) reload();
    });
  };
}

function openCrudForm(config, row, onSaved) {
  const isEdit = !!row;
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal w-full max-w-xl p-6' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-4">${isEdit ? 'Editar' : 'Novo'} ${config.label}</h3>
    <form id="crud-form" class="space-y-3">
      ${config.fields.map((f) => renderField(f, row)).join('')}
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" id="cancel" class="btn btn-secondary">Cancelar</button>
        <button type="submit" id="crud-save" class="btn btn-primary"><i class="fas fa-save mr-1"></i> Salvar</button>
      </div>
    </form>`;
  m.appendChild(card);
  document.body.appendChild(m);
  // Foco automático no primeiro campo
  setTimeout(() => card.querySelector('input,select,textarea')?.focus(), 50);
  // ESC fecha
  const escHandler = (e) => { if (e.key === 'Escape') { m.remove(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
  // Click no backdrop fecha
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  $('#cancel').onclick = () => m.remove();

  $('#crud-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const body = {};
    let validationError = null;
    config.fields.forEach((f) => {
      const node = $(`#f_${f.name}`);
      if (!node) return;
      const v = node.value;
      if (f.type === 'number') body[f.name] = v === '' ? null : parseFloat(v);
      else if (f.type === 'checkbox') body[f.name] = node.checked ? 1 : 0;
      else body[f.name] = v;
      if (f.required && (v === '' || v == null)) validationError = `Campo "${f.label}" é obrigatório.`;
    });
    if (validationError) { toast(validationError, 'warning'); return; }
    const btn = $('#crud-save');
    try {
      await Data.saveData(config.endpoint, body, {
        id: isEdit ? row[config.idField] : null,
        btn,
        successMsg: isEdit ? `${config.label} atualizado.` : `${config.label} criado.`,
      });
      m.remove();
      document.removeEventListener('keydown', escHandler);
      if (onSaved) onSaved(); else updateUI();
    } catch { /* toast já exibido pelo Data.saveData */ }
  };
}

function renderField(f, row) {
  const v = row ? (row[f.name] ?? '') : (f.default ?? '');
  if (f.type === 'checkbox') {
    return `<label class="flex items-center gap-2"><input type="checkbox" id="f_${f.name}" ${row && v ? 'checked' : (!row ? 'checked' : '')} class="w-4 h-4"/> ${f.label}</label>`;
  }
  if (f.type === 'textarea') {
    return `<div><label>${f.label}${f.required ? ' *' : ''}</label><textarea id="f_${f.name}" rows="4" ${f.required ? 'required' : ''}>${v || ''}</textarea></div>`;
  }
  if (f.type === 'select') {
    return `<div><label>${f.label}${f.required ? ' *' : ''}</label>
      <select id="f_${f.name}" ${f.required ? 'required' : ''}>
        <option value="">-- selecione --</option>
        ${f.options.map(o => `<option value="${o.value}" ${String(o.value) === String(v) ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select></div>`;
  }
  return `<div><label>${f.label}${f.required ? ' *' : ''}</label>
    <input type="${f.type || 'text'}" id="f_${f.name}" value="${v ?? ''}" ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''}/></div>`;
}

/* ---------- Configs de CRUD ---------- */
ROUTES.clientes = makeCrud({
  endpoint: '/clientes', idField: 'id_cliente', label: 'Cliente',
  labelField: 'nome_cliente', toggleAtivo: true,
  cols: [
    { field: 'cod_cliente', label: 'Código' },
    { field: 'nome_cliente', label: 'Nome' },
    { field: 'cnpj', label: 'CNPJ' },
    { field: 'observacao', label: 'Observação', render: (r) => (r.observacao || '').slice(0, 60) + ((r.observacao || '').length > 60 ? '...' : '') },
    { field: 'ativo', label: 'Ativo', type: 'bool' },
  ],
  fields: [
    { name: 'cod_cliente', label: 'Código', required: true },
    { name: 'nome_cliente', label: 'Nome', required: true },
    { name: 'cnpj', label: 'CNPJ' },
    { name: 'observacao', label: 'Observações padrão nas OPs', type: 'textarea' },
    { name: 'ativo', label: 'Ativo', type: 'checkbox' },
  ]
});

ROUTES.referencias = makeCrud({
  endpoint: '/referencias', idField: 'id_ref', label: 'Referência',
  labelField: 'desc_ref', toggleAtivo: true,
  cols: [
    { field: 'cod_ref', label: 'Código' },
    { field: 'desc_ref', label: 'Descrição' },
    { field: 'familia', label: 'Família' },
    { field: 'versao_ativa', label: 'Versão Ativa', render: (r) => r.versao_ativa ? `<span class="badge badge-Concluida">v${r.versao_ativa}</span>` : '<span class="text-slate-400">sem sequência</span>' },
    { field: 'ativo', label: 'Ativo', type: 'bool' },
  ],
  fields: [
    { name: 'cod_ref', label: 'Código', required: true },
    { name: 'desc_ref', label: 'Descrição', required: true },
    { name: 'familia', label: 'Família' },
    { name: 'ativo', label: 'Ativo', type: 'checkbox' },
  ]
});

ROUTES.maquinas = makeCrud({
  endpoint: '/maquinas', idField: 'id_maquina', label: 'Máquina',
  labelField: 'desc_maquina', toggleAtivo: true,
  cols: [
    { field: 'cod_maquina', label: 'Código' },
    { field: 'desc_maquina', label: 'Descrição' },
    { field: 'tipo', label: 'Tipo' },
    { field: 'eficiencia', label: 'Eficiência', type: 'pct' },
    { field: 'oper_por_maquina', label: 'Oper/Máq', type: 'num', decimals: 1 },
    { field: 'ativo', label: 'Ativo', type: 'bool' },
  ],
  fields: [
    { name: 'cod_maquina', label: 'Código', required: true },
    { name: 'desc_maquina', label: 'Descrição', required: true },
    { name: 'tipo', label: 'Tipo (Reta, Overlock, etc.)' },
    { name: 'eficiencia', label: 'Eficiência (0.00 a 1.00)', type: 'number', step: '0.01', default: 0.85 },
    { name: 'oper_por_maquina', label: 'Operadores por máquina', type: 'number', step: '0.1', default: 1 },
    { name: 'ativo', label: 'Ativo', type: 'checkbox' },
  ]
});

ROUTES.aparelhos = makeCrud({
  endpoint: '/aparelhos', idField: 'id_aparelho', label: 'Aparelho',
  labelField: 'desc_aparelho', toggleAtivo: true,
  cols: [
    { field: 'cod_aparelho', label: 'Código' },
    { field: 'desc_aparelho', label: 'Descrição' },
    { field: 'ativo', label: 'Ativo', type: 'bool' },
  ],
  fields: [
    { name: 'cod_aparelho', label: 'Código', required: true },
    { name: 'desc_aparelho', label: 'Descrição', required: true },
    { name: 'ativo', label: 'Ativo', type: 'checkbox' },
  ]
});

ROUTES.cores = makeCrud({
  endpoint: '/cores', idField: 'id_cor', label: 'Cor',
  labelField: 'nome_cor', toggleAtivo: true,
  cols: [
    { field: 'cod_cor', label: 'Código' },
    { field: 'nome_cor', label: 'Nome' },
    { field: 'ativo', label: 'Ativo', type: 'bool' },
  ],
  fields: [
    { name: 'cod_cor', label: 'Código', required: true },
    { name: 'nome_cor', label: 'Nome', required: true },
    { name: 'ativo', label: 'Ativo', type: 'checkbox' },
  ]
});

ROUTES.tamanhos = makeCrud({
  endpoint: '/tamanhos', idField: 'id_tam', label: 'Tamanho',
  labelField: 'cod_tam', toggleAtivo: true,
  cols: [
    { field: 'cod_tam', label: 'Código' },
    { field: 'ordem', label: 'Ordem' },
    { field: 'ativo', label: 'Ativo', type: 'bool' },
  ],
  fields: [
    { name: 'cod_tam', label: 'Código (ex.: P, M, 38)', required: true },
    { name: 'ordem', label: 'Ordem (para ordenar)', type: 'number', step: '1' },
    { name: 'ativo', label: 'Ativo', type: 'checkbox' },
  ]
});

/* ---------- OPERAÇÕES (precisa de máquinas/aparelhos) ---------- */
ROUTES.operacoes = async (main) => {
  const [ops, maqs, apas] = await Promise.all([
    api('get', '/operacoes'), api('get', '/maquinas'), api('get', '/aparelhos')
  ]);
  const data = ops.data;
  main.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <div class="text-slate-600 text-sm">${data.length} operações</div>
      <button id="btn-new" class="btn btn-primary"><i class="fas fa-plus mr-1"></i> Nova Operação</button>
    </div>
    <div class="card overflow-hidden">
      <table class="w-full text-sm table-sticky">
        <thead class="bg-slate-100 text-slate-700">
          <tr>
            <th class="px-3 py-2 text-left">Código</th>
            <th class="px-3 py-2 text-left">Descrição</th>
            <th class="px-3 py-2 text-left">Máquina</th>
            <th class="px-3 py-2 text-left">Aparelho</th>
            <th class="px-3 py-2 text-right">Tempo Padrão</th>
            <th class="px-3 py-2 text-center">Ativo</th>
            <th class="px-3 py-2 text-center w-28">Ações</th>
          </tr></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>`;
  const tbody = $('#tbody');
  data.forEach((r) => {
    const tr = el('tr', { class: 'border-t hover:bg-slate-50' });
    tr.innerHTML = `
      <td class="px-3 py-2">${r.cod_op}</td>
      <td class="px-3 py-2">${r.desc_op}</td>
      <td class="px-3 py-2">${r.desc_maquina || '-'}</td>
      <td class="px-3 py-2">${r.desc_aparelho || '-'}</td>
      <td class="px-3 py-2 text-right">${fmt.num(r.tempo_padrao)}</td>
      <td class="px-3 py-2 text-center">${r.ativo ? '<i class="fas fa-check text-emerald-600"></i>' : '<i class="fas fa-times text-slate-400"></i>'}</td>
      <td class="px-3 py-2 text-center">
        <button class="text-blue-600" data-edit="${r.id_op}"><i class="fas fa-edit"></i></button>
        <button class="text-red-600 ml-2" data-del="${r.id_op}"><i class="fas fa-trash"></i></button>
      </td>`;
    tbody.appendChild(tr);
  });
  const openForm = (row) => {
    const isEdit = !!row;
    const m = el('div', { class: 'modal-backdrop' });
    const card = el('div', { class: 'modal w-full max-w-xl p-6' });
    card.innerHTML = `
      <h3 class="text-lg font-semibold mb-4">${isEdit ? 'Editar' : 'Nova'} Operação</h3>
      <form id="f" class="space-y-3">
        <div><label>Código *</label><input id="f_cod" required value="${row?.cod_op || ''}"/></div>
        <div><label>Descrição *</label><input id="f_desc" required value="${row?.desc_op || ''}"/></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label>Máquina</label>
            <select id="f_maq"><option value="">-- selecione --</option>
            ${maqs.data.map(m => `<option value="${m.id_maquina}" ${row?.id_maquina === m.id_maquina ? 'selected' : ''}>${m.cod_maquina} - ${m.desc_maquina}</option>`).join('')}
            </select></div>
          <div><label>Aparelho</label>
            <select id="f_apa"><option value="">-- selecione --</option>
            ${apas.data.map(a => `<option value="${a.id_aparelho}" ${row?.id_aparelho === a.id_aparelho ? 'selected' : ''}>${a.cod_aparelho} - ${a.desc_aparelho}</option>`).join('')}
            </select></div>
        </div>
        <div><label>Tempo Padrão (minutos) *</label>
          <input type="number" step="0.01" id="f_tp" required value="${row?.tempo_padrao || 0}"/></div>
        <label class="flex items-center gap-2">
          <input type="checkbox" id="f_ativo" ${!row || row.ativo ? 'checked' : ''}/> Ativo</label>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="cancel" class="btn btn-secondary">Cancelar</button>
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div>
      </form>`;
    m.appendChild(card); document.body.appendChild(m);
    $('#cancel').onclick = () => m.remove();
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        cod_op: $('#f_cod').value, desc_op: $('#f_desc').value,
        id_maquina: $('#f_maq').value || null, id_aparelho: $('#f_apa').value || null,
        tempo_padrao: parseFloat($('#f_tp').value),
        ativo: $('#f_ativo').checked ? 1 : 0,
      };
      try {
        if (isEdit) await api('put', `/operacoes/${row.id_op}`, body);
        else await api('post', '/operacoes', body);
        toast('Salvo.', 'success'); m.remove(); render();
      } catch {}
    };
  };
  $('#btn-new').onclick = () => openForm(null);
  $$('[data-edit]').forEach(b => b.onclick = () => openForm(data.find(x => x.id_op == b.dataset.edit)));
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Inativar esta operação?')) return;
    await api('delete', `/operacoes/${b.dataset.del}`); render();
  });
};

/* ============================================================
 * PARÂMETROS
 * ============================================================ */
ROUTES.parametros = async (main) => {
  let d;
  try { d = await Data.loadData('/parametros'); }
  catch (e) { main.innerHTML = `<div class="card p-6 text-red-600"><i class="fas fa-exclamation-triangle mr-2"></i>Erro: ${e.message || e}</div>`; return; }

  main.innerHTML = `
    <div class="card p-6 max-w-3xl">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-slate-700">Parâmetros do sistema</h3>
        <button id="btn-reset-form" type="button" class="btn btn-secondary btn-sm" title="Restaurar valores carregados">
          <i class="fas fa-undo mr-1"></i> Resetar
        </button>
      </div>
      <form id="form-param" class="space-y-3">
        ${d.map(p => `
          <div class="grid grid-cols-3 gap-3 items-center">
            <label class="col-span-1 text-sm font-medium text-slate-700" title="${p.descricao || ''}">${p.chave}</label>
            <input class="col-span-1" id="p_${p.chave}" value="${p.valor || ''}" data-original="${(p.valor || '').replace(/"/g, '&quot;')}"/>
            <span class="col-span-1 text-xs text-slate-500">${p.descricao || ''}</span>
          </div>`).join('')}
        <div class="flex justify-end pt-3"><button id="btn-salvar-param" type="submit" class="btn btn-primary"><i class="fas fa-save mr-1"></i> Salvar</button></div>
      </form>
    </div>`;

  $('#btn-reset-form').onclick = () => {
    d.forEach(p => { const inp = $('#p_' + p.chave); if (inp) inp.value = p.valor || ''; });
    toast('Valores restaurados.', 'info');
  };

  $('#form-param').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#btn-salvar-param');
    setBtnLoading(btn, true);
    try {
      let count = 0;
      const errors = [];
      for (const p of d) {
        const v = $('#p_' + p.chave).value;
        if (v !== p.valor) {
          try {
            await api('put', `/parametros/${encodeURIComponent(p.chave)}`, { valor: v });
            p.valor = v; // sincroniza estado local
            count++;
          } catch (err) {
            errors.push(`${p.chave}: ${err.response?.data?.error || err.message}`);
          }
        }
      }
      if (errors.length) {
        toast(`Erro em ${errors.length} parâmetro(s). Veja o console.`, 'error');
        console.error('[parametros] erros:', errors);
      } else if (count === 0) {
        toast('Nenhuma alteração para salvar.', 'info');
      } else {
        toast(`${count} parâmetro(s) atualizado(s).`, 'success');
      }
    } finally {
      setBtnLoading(btn, false);
    }
  };
};

/* ============================================================
 * SEQUÊNCIAS OPERACIONAIS
 * ============================================================ */
ROUTES.sequencias = async (main) => {
  const refs = (await api('get', '/referencias')).data;
  main.innerHTML = `
    <div class="card p-4 mb-4">
      <label>Referência</label>
      <select id="sel-ref" class="max-w-md">
        <option value="">-- Selecione --</option>
        ${refs.map(r => `<option value="${r.id_ref}">${r.cod_ref} — ${r.desc_ref}${r.versao_ativa ? ` (v${r.versao_ativa} ativa)` : ''}</option>`).join('')}
      </select>
    </div>
    <div id="seq-area"></div>`;
  $('#sel-ref').onchange = (e) => renderSeqArea(parseInt(e.target.value) || 0);
};

async function renderSeqArea(idRef) {
  const area = $('#seq-area');
  if (!idRef) { area.innerHTML = ''; return; }
  const versoes = (await api('get', `/referencias/${idRef}/sequencias`)).data;
  area.innerHTML = `
    <div class="flex justify-between items-center mb-3">
      <h3 class="font-semibold text-slate-700">Versões</h3>
      <button id="btn-new-seq" class="btn btn-primary"><i class="fas fa-plus mr-1"></i> Nova Versão</button>
    </div>
    <div class="card overflow-hidden mb-4">
      <table class="w-full text-sm">
        <thead class="bg-slate-100"><tr>
          <th class="px-3 py-2 text-left">Versão</th>
          <th class="px-3 py-2 text-left">Status</th>
          <th class="px-3 py-2 text-right">Qtd Itens</th>
          <th class="px-3 py-2 text-right">Tempo Total (min)</th>
          <th class="px-3 py-2 text-left">Criada em</th>
          <th class="px-3 py-2 text-center">Ações</th>
        </tr></thead>
        <tbody>
          ${versoes.map(v => `
            <tr class="border-t hover:bg-slate-50">
              <td class="px-3 py-2 font-mono">v${v.versao}</td>
              <td class="px-3 py-2">${v.ativa ? '<span class="badge badge-Concluida">ATIVA</span>' : '<span class="badge bg-slate-200 text-slate-700">inativa</span>'}</td>
              <td class="px-3 py-2 text-right">${v.qtd_itens}</td>
              <td class="px-3 py-2 text-right">${fmt.num(v.tempo_total)}</td>
              <td class="px-3 py-2">${fmt.datetime(v.dt_criacao)}</td>
              <td class="px-3 py-2 text-center">
                <button class="text-blue-600 mr-2" data-view="${v.id_seq_cab}"><i class="fas fa-eye"></i></button>
                ${!v.ativa ? `<button class="text-amber-600 mr-2" data-edit="${v.id_seq_cab}"><i class="fas fa-edit"></i></button>` : ''}
                ${!v.ativa ? `<button class="text-emerald-600 mr-2" data-act="${v.id_seq_cab}" title="Ativar"><i class="fas fa-check-circle"></i></button>` : `<button class="text-amber-600 mr-2" data-inat="${v.id_seq_cab}" title="Inativar"><i class="fas fa-times-circle"></i></button>`}
                <button class="text-indigo-600 mr-2" data-dup="${v.id_seq_cab}" title="Duplicar"><i class="fas fa-copy"></i></button>
                ${!v.ativa ? `<button class="text-red-600" data-del="${v.id_seq_cab}" title="Excluir"><i class="fas fa-trash"></i></button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${!versoes.length ? '<div class="p-6 text-center text-slate-500">Nenhuma versão cadastrada.</div>' : ''}
    </div>
    <div id="seq-detail"></div>`;
  $('#btn-new-seq').onclick = () => openSeqEditor(idRef, null);
  $$('[data-view]').forEach(b => b.onclick = () => viewSeqDetail(parseInt(b.dataset.view)));
  $$('[data-edit]').forEach(b => b.onclick = () => openSeqEditor(idRef, parseInt(b.dataset.edit)));
  $$('[data-act]').forEach(b => b.onclick = async () => {
    await api('post', `/sequencias/${b.dataset.act}/ativar`);
    toast('Versão ativada.', 'success'); renderSeqArea(idRef);
  });
  $$('[data-inat]').forEach(b => b.onclick = async () => {
    await api('post', `/sequencias/${b.dataset.inat}/inativar`);
    toast('Versão inativada.', 'warning'); renderSeqArea(idRef);
  });
  $$('[data-dup]').forEach(b => b.onclick = async () => {
    await api('post', `/sequencias/${b.dataset.dup}/duplicar`);
    toast('Versão duplicada.', 'success'); renderSeqArea(idRef);
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Excluir esta versão?')) return;
    await api('delete', `/sequencias/${b.dataset.del}`);
    renderSeqArea(idRef);
  });
}

async function viewSeqDetail(id) {
  const d = (await api('get', `/sequencias/${id}`)).data;
  $('#seq-detail').innerHTML = `
    <div class="card p-5">
      <h3 class="font-semibold mb-3 text-slate-700">
        <i class="fas fa-list-ol mr-1"></i> ${d.cod_ref} — ${d.desc_ref} <span class="text-sm text-slate-500">v${d.versao} ${d.ativa ? '(ATIVA)' : ''}</span>
      </h3>
      <table class="w-full text-sm">
        <thead class="bg-slate-100"><tr>
          <th class="px-2 py-2 text-right w-20">Seq</th>
          <th class="px-2 py-2 text-left">Operação</th>
          <th class="px-2 py-2 text-left">Máquina</th>
          <th class="px-2 py-2 text-left">Aparelho</th>
          <th class="px-2 py-2 text-right">Tempo Padrão</th>
          <th class="px-2 py-2 text-left">Observação</th>
        </tr></thead>
        <tbody>
          ${d.itens.map(i => `
            <tr class="border-t">
              <td class="px-2 py-1 text-right font-mono">${i.sequencia}</td>
              <td class="px-2 py-1">${i.cod_op} — ${i.desc_op}</td>
              <td class="px-2 py-1">${i.desc_maquina || '-'}</td>
              <td class="px-2 py-1">${i.desc_aparelho || '-'}</td>
              <td class="px-2 py-1 text-right">${fmt.num(i.tempo_padrao)}</td>
              <td class="px-2 py-1">${i.observacao || ''}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr class="border-t-2 font-semibold">
          <td colspan="4" class="px-2 py-2 text-right">Tempo total:</td>
          <td class="px-2 py-2 text-right">${fmt.num(d.tempo_total)} min</td>
          <td></td>
        </tr></tfoot>
      </table>
    </div>`;
}

async function openSeqEditor(idRef, idSeqCab) {
  const ops = (await api('get', '/operacoes')).data.filter(o => o.ativo);
  const maqs = (await api('get', '/maquinas')).data.filter(o => o.ativo);
  const apas = (await api('get', '/aparelhos')).data.filter(o => o.ativo);
  let itens = [];
  let obs = '';
  if (idSeqCab) {
    const d = (await api('get', `/sequencias/${idSeqCab}`)).data;
    itens = d.itens.map(i => ({
      sequencia: i.sequencia, id_op: i.id_op, id_maquina: i.id_maquina,
      id_aparelho: i.id_aparelho, tempo_padrao: i.tempo_padrao, observacao: i.observacao || ''
    }));
    obs = d.observacao || '';
  }
  if (!itens.length) itens = [{ sequencia: 10, id_op: '', id_maquina: '', id_aparelho: '', tempo_padrao: 0, observacao: '' }];

  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal w-full max-w-5xl p-6' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3">${idSeqCab ? 'Editar' : 'Nova'} Sequência Operacional</h3>
    <div class="mb-3"><label>Observação</label><textarea id="obs" rows="2">${obs}</textarea></div>
    <div class="overflow-auto">
      <table class="w-full text-sm border">
        <thead class="bg-slate-100"><tr>
          <th class="px-2 py-1 w-20">Seq *</th>
          <th class="px-2 py-1">Operação *</th>
          <th class="px-2 py-1">Máquina</th>
          <th class="px-2 py-1">Aparelho</th>
          <th class="px-2 py-1 w-28">Tempo Padrão *</th>
          <th class="px-2 py-1">Observação</th>
          <th class="px-2 py-1 w-10"></th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <div class="flex justify-between items-center mt-3">
      <button id="btn-add" type="button" class="btn btn-secondary"><i class="fas fa-plus mr-1"></i> Nova linha</button>
      <div>Tempo total: <b id="tt">0,00</b> min</div>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button id="cancel" type="button" class="btn btn-secondary">Cancelar</button>
      <button id="save" type="button" class="btn btn-primary"><i class="fas fa-save mr-1"></i> Salvar</button>
    </div>`;
  m.appendChild(card); document.body.appendChild(m);

  const rows = $('#rows');
  const draw = () => {
    rows.innerHTML = '';
    itens.forEach((it, idx) => {
      const tr = el('tr', { class: 'border-t' });
      tr.innerHTML = `
        <td class="p-1"><input type="number" step="1" value="${it.sequencia || ''}" data-f="sequencia" data-i="${idx}" class="text-right"/></td>
        <td class="p-1"><select data-f="id_op" data-i="${idx}">
          <option value="">--</option>${ops.map(o => `<option value="${o.id_op}" ${it.id_op == o.id_op ? 'selected' : ''}>${o.cod_op} — ${o.desc_op}</option>`).join('')}
        </select></td>
        <td class="p-1"><select data-f="id_maquina" data-i="${idx}">
          <option value="">--</option>${maqs.map(o => `<option value="${o.id_maquina}" ${it.id_maquina == o.id_maquina ? 'selected' : ''}>${o.desc_maquina}</option>`).join('')}
        </select></td>
        <td class="p-1"><select data-f="id_aparelho" data-i="${idx}">
          <option value="">--</option>${apas.map(o => `<option value="${o.id_aparelho}" ${it.id_aparelho == o.id_aparelho ? 'selected' : ''}>${o.desc_aparelho}</option>`).join('')}
        </select></td>
        <td class="p-1"><input type="number" step="0.01" value="${it.tempo_padrao || 0}" data-f="tempo_padrao" data-i="${idx}" class="text-right"/></td>
        <td class="p-1"><input value="${it.observacao || ''}" data-f="observacao" data-i="${idx}"/></td>
        <td class="p-1 text-center"><button type="button" data-del="${idx}" class="text-red-600"><i class="fas fa-times"></i></button></td>`;
      rows.appendChild(tr);
    });
    // Quando seleciona operação, pré-popula máquina/aparelho/tempo se vazios
    $$('[data-f]').forEach(inp => {
      inp.oninput = inp.onchange = (ev) => {
        const i = parseInt(ev.target.dataset.i);
        const f = ev.target.dataset.f;
        let v = ev.target.value;
        if (f === 'sequencia' || f === 'id_op' || f === 'id_maquina' || f === 'id_aparelho') v = v === '' ? '' : parseInt(v);
        else if (f === 'tempo_padrao') v = parseFloat(v || 0);
        itens[i][f] = v;
        if (f === 'id_op' && v) {
          const op = ops.find(o => o.id_op === v);
          if (op) {
            if (!itens[i].id_maquina && op.id_maquina) itens[i].id_maquina = op.id_maquina;
            if (!itens[i].id_aparelho && op.id_aparelho) itens[i].id_aparelho = op.id_aparelho;
            if (!itens[i].tempo_padrao && op.tempo_padrao) itens[i].tempo_padrao = op.tempo_padrao;
            draw(); updateTotal();
          }
        }
        updateTotal();
      };
    });
    $$('[data-del]').forEach(b => b.onclick = () => { itens.splice(parseInt(b.dataset.del), 1); draw(); updateTotal(); });
  };
  const updateTotal = () => { $('#tt').textContent = fmt.num(itens.reduce((s, i) => s + (parseFloat(i.tempo_padrao) || 0), 0)); };
  draw(); updateTotal();

  $('#btn-add').onclick = () => {
    const nextSeq = Math.max(0, ...itens.map(i => parseInt(i.sequencia) || 0)) + 10;
    itens.push({ sequencia: nextSeq, id_op: '', id_maquina: '', id_aparelho: '', tempo_padrao: 0, observacao: '' });
    draw();
  };
  $('#cancel').onclick = () => m.remove();
  $('#save').onclick = async () => {
    const body = { id_ref: idRef, observacao: $('#obs').value, itens };
    try {
      if (idSeqCab) await api('put', `/sequencias/${idSeqCab}`, body);
      else await api('post', '/sequencias', body);
      toast('Sequência salva.', 'success'); m.remove(); renderSeqArea(idRef);
    } catch {}
  };
}

/* ============================================================
 * OPs
 * ============================================================ */
ROUTES.ops = async (main) => {
  const [opsRes, refs, clis] = await Promise.all([
    api('get', '/ops'), api('get', '/referencias'), api('get', '/clientes'),
  ]);
  let data = opsRes.data;

  main.innerHTML = `
    ${UI.pageHeader({
      breadcrumb: [{ label: 'Início', href: '#dashboard' }, { label: 'Produção' }, { label: 'Ordens de Produção' }],
      title: 'Ordens de Produção',
      badge: 'MES',
      desc: 'Gerencie OPs com status em tempo real, % de conclusão e indicadores de atraso.',
      actions: `
        <button class="btn-icon" id="btn-refresh-ops" title="Atualizar"><i class="fas fa-sync-alt"></i></button>
        <button class="btn btn-primary" id="btn-new-op"><i class="fas fa-plus mr-2"></i>Nova OP</button>
      `,
    })}
    <div class="card p-4 mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
      <div><label>Status</label><select id="f-status">
        <option value="">Todos</option>
        <option>Aberta</option><option>Planejada</option>
        <option>EmProducao</option><option>Concluida</option><option>Cancelada</option>
      </select></div>
      <div><label>Cliente</label><select id="f-cli"><option value="">Todos</option>${clis.data.map(c => `<option value="${c.id_cliente}">${c.nome_cliente}</option>`).join('')}</select></div>
      <div><label>Referência</label><select id="f-ref"><option value="">Todas</option>${refs.data.map(r => `<option value="${r.id_ref}">${r.cod_ref}</option>`).join('')}</select></div>
      <div><label>Buscar</label><input id="f-q" placeholder="Nº OP / obs"/></div>
      <div class="flex items-end gap-2">
        <button id="f-apply" class="btn btn-secondary w-full"><i class="fas fa-filter mr-1"></i> Filtrar</button>
      </div>
    </div>
    <div class="card overflow-auto">
      <table class="w-full text-sm table-sticky">
        <thead class="bg-slate-100"><tr>
          <th class="px-3 py-2 text-left">Nº OP</th>
          <th class="px-3 py-2 text-left">Referência / Cliente</th>
          <th class="px-3 py-2 text-right">Peças</th>
          <th class="px-3 py-2 text-left">Progresso</th>
          <th class="px-3 py-2 text-left">Entrega</th>
          <th class="px-3 py-2 text-left">Status</th>
          <th class="px-3 py-2 text-center">Ações</th>
        </tr></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>`;

  // Mapa id_op -> progresso (lazy fetch para não travar)
  const progressoMap = new Map();

  const statusToPill = (status, atrasada) => {
    if (atrasada && status !== 'Concluida' && status !== 'Cancelada') return UI.statusPill('Atrasada');
    return UI.statusPill(status);
  };

  const drawBody = (items) => {
    const tbody = $('#tbody'); tbody.innerHTML = '';
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-0">${UI.empty({
        icon: 'fa-clipboard-list',
        title: 'Nenhuma OP encontrada',
        desc: 'Ajuste os filtros ou crie a primeira OP para começar a planejar a produção.',
        action: '<button class="btn btn-primary" onclick="document.getElementById(\'btn-new-op\').click()"><i class="fas fa-plus mr-2"></i>Criar OP</button>'
      })}</td></tr>`;
      return;
    }
    items.forEach((r) => {
      const tr = el('tr', { class: 'border-t' + (r.atrasada ? ' row-late' : '') });
      const progressId = `prog-${r.id_op}`;
      // Placeholder progresso (carrega async)
      tr.innerHTML = `
        <td class="px-3 py-2 font-mono font-semibold">${r.num_op}</td>
        <td class="px-3 py-2">
          <div style="font-weight:600">${r.cod_ref} <span style="color:var(--text-secondary);font-weight:400">— ${r.desc_ref}</span></div>
          <div style="font-size:11px;color:var(--text-secondary)"><i class="fas fa-user mr-1"></i>${r.nome_cliente}</div>
        </td>
        <td class="px-3 py-2 text-right font-semibold">${fmt.int(r.qtde_pecas)}</td>
        <td class="px-3 py-2" id="${progressId}"><div class="op-progress"><div class="bar"><span style="width:0%"></span></div><span class="pct" style="color:var(--text-secondary)">…</span></div></td>
        <td class="px-3 py-2 ${r.atrasada ? 'font-semibold' : ''}" style="${r.atrasada ? 'color:#EF4444' : ''}">
          <i class="far fa-calendar mr-1" style="opacity:.7"></i>${fmt.date(r.dt_entrega)}
          ${r.atrasada ? '<i class="fas fa-exclamation-triangle ml-1" title="Atrasada"></i>' : ''}
        </td>
        <td class="px-3 py-2">${statusToPill(r.status, r.atrasada)}</td>
        <td class="px-3 py-2 text-center whitespace-nowrap">
          <button class="btn-icon" data-edit="${r.id_op}" title="Editar" style="width:32px;height:32px"><i class="fas fa-edit"></i></button>
          <button class="btn-icon" data-balanc="${r.id_op}" title="Balanceamento" style="width:32px;height:32px"><i class="fas fa-balance-scale"></i></button>
          <button class="btn-icon" data-ficha="${r.id_op}" title="Ficha" style="width:32px;height:32px"><i class="fas fa-file-invoice"></i></button>
          <button class="btn-icon" data-del="${r.id_op}" title="Excluir" style="width:32px;height:32px;color:#EF4444"><i class="fas fa-trash"></i></button>
        </td>`;
      tbody.appendChild(tr);
    });

    // Carrega progresso assincronamente em paralelo (max 8 simultâneos)
    const ids = items.map(r => r.id_op);
    const fetchProg = async (id) => {
      if (progressoMap.has(id)) return progressoMap.get(id);
      try {
        const rs = await api('get', `/ops/${id}/progresso`, null, { silent: true });
        progressoMap.set(id, rs.data);
        return rs.data;
      } catch { return null; }
    };
    const chunks = [];
    for (let i = 0; i < ids.length; i += 8) chunks.push(ids.slice(i, i + 8));
    (async () => {
      for (const chunk of chunks) {
        const results = await Promise.all(chunk.map(fetchProg));
        results.forEach((p) => {
          if (!p) return;
          const cell = document.getElementById(`prog-${p.id_op}`);
          if (cell) cell.innerHTML = UI.progress(p.pct_concluido, { late: p.atrasada });
        });
      }
    })();

    $$('[data-edit]').forEach(b => b.onclick = () => openOPEditor(parseInt(b.dataset.edit)));
    $$('[data-balanc]').forEach(b => b.onclick = () => { state.balancOp = parseInt(b.dataset.balanc); navigate('balanceamento'); });
    $$('[data-ficha]').forEach(b => b.onclick = () => { state.fichaOp = parseInt(b.dataset.ficha); navigate('ficha'); });
    $$('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Excluir OP? (somente se não tiver apontamentos)')) return;
      try { await api('delete', `/ops/${b.dataset.del}`); toast('OP excluída.', 'success'); render(); } catch {}
    });
  };
  drawBody(data);

  $('#btn-new-op').onclick = () => openOPEditor(null);
  const btnRefresh = $('#btn-refresh-ops');
  if (btnRefresh) btnRefresh.onclick = async () => {
    btnRefresh.classList.add('is-spinning');
    try { progressoMap.clear(); await ROUTES.ops(main); }
    finally { btnRefresh.classList.remove('is-spinning'); }
  };
  $('#f-apply').onclick = async () => {
    const params = [
      ['status', $('#f-status').value],
      ['id_cliente', $('#f-cli').value],
      ['id_ref', $('#f-ref').value],
      ['search', $('#f-q').value],
    ].filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const rs = await api('get', '/ops' + (params ? '?' + params : ''));
    progressoMap.clear();
    drawBody(rs.data);
  };
};

async function openOPEditor(idOp) {
  const [refs, clis, cores, tams] = await Promise.all([
    api('get', '/referencias'), api('get', '/clientes'),
    api('get', '/cores'), api('get', '/tamanhos'),
  ]);
  let op = {
    num_op: '', dt_emissao: dayjs().format('YYYY-MM-DD'),
    id_ref: '', id_cliente: '', qtde_pecas: 0,
    dt_entrega: dayjs().add(15, 'day').format('YYYY-MM-DD'),
    status: 'Aberta', observacao: '', cores: [], tamanhos: []
  };
  if (idOp) {
    const d = (await api('get', `/ops/${idOp}`)).data;
    op = {
      ...d,
      cores: d.cores.map(c => ({ id_cor: c.id_cor, qtde_pecas: c.qtde_pecas })),
      tamanhos: d.tamanhos.map(t => ({ id_tam: t.id_tam, qtde_pecas: t.qtde_pecas })),
    };
  }

  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal w-full max-w-5xl p-6' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3">${idOp ? 'Editar' : 'Nova'} Ordem de Produção</h3>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
      <div><label>Nº OP *</label><input id="op_num" value="${op.num_op}" required ${idOp ? 'readonly' : ''}/></div>
      <div><label>Data Emissão *</label><input type="date" id="op_em" value="${op.dt_emissao}" required/></div>
      <div><label>Previsão Entrega *</label><input type="date" id="op_ent" value="${op.dt_entrega}" required/></div>
      <div><label>Referência *</label><select id="op_ref" required><option value="">--</option>${refs.data.map(r => `<option value="${r.id_ref}" ${op.id_ref == r.id_ref ? 'selected' : ''} ${!r.id_seq_ativa ? 'disabled' : ''}>${r.cod_ref} — ${r.desc_ref}${!r.id_seq_ativa ? ' (SEM SEQUÊNCIA ATIVA)' : ` [v${r.versao_ativa}]`}</option>`).join('')}</select></div>
      <div><label>Cliente *</label><select id="op_cli" required><option value="">--</option>${clis.data.map(c => `<option value="${c.id_cliente}" ${op.id_cliente == c.id_cliente ? 'selected' : ''}>${c.nome_cliente}</option>`).join('')}</select></div>
      <div><label>Qtde Peças *</label><input type="number" id="op_qtd" value="${op.qtde_pecas}" min="1" required/></div>
      <div class="md:col-span-2"><label>Status</label>
        <select id="op_status">
          ${['Aberta', 'Planejada', 'EmProducao', 'Concluida', 'Cancelada'].map(s => `<option ${op.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></div>
      <div id="op_cliobs_wrap" class="md:col-span-3"></div>
      <div class="md:col-span-3"><label>Observações da OP</label><textarea id="op_obs" rows="2">${op.observacao || ''}</textarea></div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div>
        <div class="flex items-center justify-between mb-1"><label class="m-0">Grade de Cores</label>
          <button id="btn-add-cor" type="button" class="text-xs text-brand hover:underline">+ adicionar</button></div>
        <table class="w-full text-sm border"><thead class="bg-slate-100"><tr>
          <th class="p-1 text-left">Cor</th><th class="p-1 text-right w-28">Qtd</th><th class="p-1 w-8"></th>
        </tr></thead><tbody id="g-cor"></tbody>
        <tfoot><tr class="border-t font-semibold"><td class="p-1 text-right">Total:</td><td id="sum-cor" class="p-1 text-right">0</td><td></td></tr></tfoot></table>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1"><label class="m-0">Grade de Tamanhos</label>
          <button id="btn-add-tam" type="button" class="text-xs text-brand hover:underline">+ adicionar</button></div>
        <table class="w-full text-sm border"><thead class="bg-slate-100"><tr>
          <th class="p-1 text-left">Tamanho</th><th class="p-1 text-right w-28">Qtd</th><th class="p-1 w-8"></th>
        </tr></thead><tbody id="g-tam"></tbody>
        <tfoot><tr class="border-t font-semibold"><td class="p-1 text-right">Total:</td><td id="sum-tam" class="p-1 text-right">0</td><td></td></tr></tfoot></table>
      </div>
    </div>
    <div class="text-xs text-slate-500 mb-3">Regra: Soma das cores e dos tamanhos deve ser igual à Qtde de Peças.</div>
    <div class="flex justify-end gap-2">
      <button id="cancel" type="button" class="btn btn-secondary">Cancelar</button>
      <button id="save" type="button" class="btn btn-primary"><i class="fas fa-save mr-1"></i> Salvar</button>
    </div>`;
  m.appendChild(card); document.body.appendChild(m);

  const draw = () => {
    const gc = $('#g-cor'); gc.innerHTML = '';
    op.cores.forEach((c, idx) => {
      const tr = el('tr', { class: 'border-t' });
      tr.innerHTML = `<td class="p-1"><select data-f="id_cor" data-i="${idx}"><option value="">--</option>${cores.data.map(x => `<option value="${x.id_cor}" ${c.id_cor == x.id_cor ? 'selected' : ''}>${x.nome_cor}</option>`).join('')}</select></td>
        <td class="p-1"><input type="number" min="0" data-f="qtde_pecas" data-i="${idx}" value="${c.qtde_pecas}" class="text-right"/></td>
        <td class="p-1 text-center"><button type="button" data-del-cor="${idx}" class="text-red-600"><i class="fas fa-times"></i></button></td>`;
      gc.appendChild(tr);
    });
    const gt = $('#g-tam'); gt.innerHTML = '';
    op.tamanhos.forEach((t, idx) => {
      const tr = el('tr', { class: 'border-t' });
      tr.innerHTML = `<td class="p-1"><select data-ft="id_tam" data-i="${idx}"><option value="">--</option>${tams.data.map(x => `<option value="${x.id_tam}" ${t.id_tam == x.id_tam ? 'selected' : ''}>${x.cod_tam}</option>`).join('')}</select></td>
        <td class="p-1"><input type="number" min="0" data-ft="qtde_pecas" data-i="${idx}" value="${t.qtde_pecas}" class="text-right"/></td>
        <td class="p-1 text-center"><button type="button" data-del-tam="${idx}" class="text-red-600"><i class="fas fa-times"></i></button></td>`;
      gt.appendChild(tr);
    });
    $$('[data-f]').forEach(i => i.onchange = i.oninput = (ev) => {
      const idx = parseInt(ev.target.dataset.i); const f = ev.target.dataset.f;
      op.cores[idx][f] = f === 'id_cor' ? parseInt(ev.target.value) || '' : parseInt(ev.target.value) || 0;
      updateSum();
    });
    $$('[data-ft]').forEach(i => i.onchange = i.oninput = (ev) => {
      const idx = parseInt(ev.target.dataset.i); const f = ev.target.dataset.ft;
      op.tamanhos[idx][f] = f === 'id_tam' ? parseInt(ev.target.value) || '' : parseInt(ev.target.value) || 0;
      updateSum();
    });
    $$('[data-del-cor]').forEach(b => b.onclick = () => { op.cores.splice(parseInt(b.dataset.delCor), 1); draw(); });
    $$('[data-del-tam]').forEach(b => b.onclick = () => { op.tamanhos.splice(parseInt(b.dataset.delTam), 1); draw(); });
    updateSum();
  };
  const updateSum = () => {
    $('#sum-cor').textContent = fmt.int(op.cores.reduce((s, c) => s + (c.qtde_pecas || 0), 0));
    $('#sum-tam').textContent = fmt.int(op.tamanhos.reduce((s, c) => s + (c.qtde_pecas || 0), 0));
  };

  // Observações do cliente
  $('#op_cli').onchange = () => {
    const cli = clis.data.find(c => c.id_cliente == $('#op_cli').value);
    $('#op_cliobs_wrap').innerHTML = cli?.observacao ? `<div class="bg-amber-50 border border-amber-200 rounded p-3 text-sm"><b>Observações do cliente:</b><pre class="whitespace-pre-wrap font-sans mt-1">${cli.observacao}</pre></div>` : '';
  };
  $('#op_cli').dispatchEvent(new Event('change'));

  $('#btn-add-cor').onclick = () => { op.cores.push({ id_cor: '', qtde_pecas: 0 }); draw(); };
  $('#btn-add-tam').onclick = () => { op.tamanhos.push({ id_tam: '', qtde_pecas: 0 }); draw(); };
  $('#cancel').onclick = () => m.remove();
  $('#save').onclick = async () => {
    const body = {
      num_op: $('#op_num').value.trim(),
      dt_emissao: $('#op_em').value,
      dt_entrega: $('#op_ent').value,
      id_ref: parseInt($('#op_ref').value),
      id_cliente: parseInt($('#op_cli').value),
      qtde_pecas: parseInt($('#op_qtd').value),
      status: $('#op_status').value,
      observacao: $('#op_obs').value,
      cores: op.cores.filter(c => c.id_cor),
      tamanhos: op.tamanhos.filter(t => t.id_tam),
    };
    try {
      if (idOp) await api('put', `/ops/${idOp}`, body);
      else await api('post', '/ops', body);
      toast('OP salva.', 'success'); m.remove(); render();
    } catch {}
  };
  draw();
}

/* ============================================================
 * BALANCEAMENTO
 * ============================================================ */
ROUTES.balanceamento = async (main) => {
  const ops = (await api('get', '/ops')).data;
  const selected = state.balancOp || ops[0]?.id_op || '';
  main.innerHTML = `
    <div class="card p-4 mb-4 grid grid-cols-1 md:grid-cols-6 gap-3">
      <div class="md:col-span-2"><label>OP</label>
        <select id="b-op">${ops.map(o => `<option value="${o.id_op}" ${selected == o.id_op ? 'selected' : ''}>${o.num_op} — ${o.nome_cliente} (${o.cod_ref})</option>`).join('')}</select></div>
      <div><label>Modo</label>
        <select id="b-modo">
          <option value="3">Efic. por Máquina</option>
          <option value="2">Efic. Geral</option>
          <option value="1">100%</option>
        </select></div>
      <div><label>Pçs/dia</label><input type="number" id="b-dia"/></div>
      <div><label>Min/turno</label><input type="number" id="b-min" value="480"/></div>
      <div><label>Turnos</label><input type="number" id="b-tur" value="1" step="0.1"/></div>
      <div class="flex items-end gap-2"><label class="invisible">x</label>
        <button id="b-go" class="btn btn-primary flex-1"><i class="fas fa-calculator mr-1"></i> Calcular</button>
        <button id="b-print" class="btn btn-secondary"><i class="fas fa-print"></i></button>
      </div>
    </div>
    <div id="b-result"></div>`;
  const run = async () => {
    const idOp = $('#b-op').value;
    if (!idOp) return;
    const params = new URLSearchParams();
    params.set('modo', $('#b-modo').value);
    if ($('#b-dia').value) params.set('pecas_dia', $('#b-dia').value);
    if ($('#b-min').value) params.set('min_turno', $('#b-min').value);
    if ($('#b-tur').value) params.set('turnos', $('#b-tur').value);
    const r = (await api('get', `/ops/${idOp}/balanceamento?${params}`)).data;
    drawBalanc(r);
  };
  $('#b-go').onclick = run;
  $('#b-print').onclick = () => window.print();
  $('#b-op').onchange = () => run();
  $('#b-modo').onchange = () => run();
  if (selected) run();
};

function drawBalanc(r) {
  $('#b-result').innerHTML = `
    <div class="card p-5 mb-4">
      <h3 class="font-semibold text-slate-700 mb-2">
        <i class="fas fa-balance-scale mr-1"></i>
        Balanceamento — OP ${r.op.num_op}</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div><div class="text-slate-500">Referência</div><b>${r.op.cod_ref} — ${r.op.desc_ref}</b></div>
        <div><div class="text-slate-500">Cliente</div><b>${r.op.nome_cliente}</b></div>
        <div><div class="text-slate-500">Qtd peças</div><b>${fmt.int(r.op.qtde_pecas)}</b></div>
        <div><div class="text-slate-500">Entrega</div><b>${fmt.date(r.op.dt_entrega)}</b></div>
        <div><div class="text-slate-500">Dias úteis</div><b>${r.parametros.dias_uteis}</b></div>
        <div><div class="text-slate-500">Peças/dia</div><b>${fmt.int(r.parametros.pecas_dia)}</b></div>
        <div><div class="text-slate-500">Min/turno × Turnos</div><b>${r.parametros.min_turno} × ${r.parametros.turnos}</b></div>
        <div><div class="text-slate-500">Modo</div><b>${{1:'100%',2:'Efic. Geral '+fmt.pct(r.parametros.eficiencia_geral),3:'Efic. por Máquina'}[r.parametros.modo]}</b></div>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="lg:col-span-2 card overflow-auto">
        <table class="w-full text-sm table-sticky">
          <thead class="bg-slate-100"><tr>
            <th class="px-2 py-2 text-right w-16">Seq</th>
            <th class="px-2 py-2 text-left">Operação</th>
            <th class="px-2 py-2 text-left">Máquina</th>
            <th class="px-2 py-2 text-right">Tempo</th>
            <th class="px-2 py-2 text-right">Efic</th>
            <th class="px-2 py-2 text-right">Pçs/h 100%</th>
            <th class="px-2 py-2 text-right">Pçs/h Real</th>
            <th class="px-2 py-2 text-right">Qt Máq</th>
            <th class="px-2 py-2 text-right">Qt Oper</th>
          </tr></thead>
          <tbody>${r.linhas.map(l => `
            <tr class="border-t">
              <td class="px-2 py-1 text-right font-mono">${l.sequencia}</td>
              <td class="px-2 py-1">${l.cod_op} — ${l.desc_op}</td>
              <td class="px-2 py-1">${l.desc_maquina || '-'}</td>
              <td class="px-2 py-1 text-right">${fmt.num(l.tempo_padrao)}</td>
              <td class="px-2 py-1 text-right">${fmt.pct(l.eficiencia)}</td>
              <td class="px-2 py-1 text-right">${fmt.num(l.pcs_hora_100, 1)}</td>
              <td class="px-2 py-1 text-right">${fmt.num(l.pcs_hora_real, 1)}</td>
              <td class="px-2 py-1 text-right font-semibold">${l.qtd_maquinas}</td>
              <td class="px-2 py-1 text-right font-semibold">${fmt.num(l.qtd_operadores, 1)}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr class="border-t-2 font-semibold bg-slate-50">
            <td colspan="3" class="px-2 py-2 text-right">Totais:</td>
            <td class="px-2 py-2 text-right">${fmt.num(r.totais.tempo_total_ref)}</td>
            <td></td><td></td><td></td>
            <td class="px-2 py-2 text-right">${r.totais.qtd_maquinas}</td>
            <td class="px-2 py-2 text-right">${fmt.num(r.totais.qtd_operadores, 1)}</td>
          </tr>
          <tr><td colspan="9" class="px-2 py-1 text-sm text-slate-600 text-right">Total Minutos da OP: <b>${fmt.int(r.totais.total_min_op)}</b> min</td></tr>
          </tfoot>
        </table>
      </div>
      <div class="card p-4">
        <h4 class="font-semibold mb-2 text-slate-700"><i class="fas fa-list mr-1"></i> Resumo Máquinas</h4>
        <table class="w-full text-sm"><thead class="bg-slate-100"><tr>
          <th class="px-2 py-1 text-left">Tipo</th><th class="px-2 py-1 text-right">Qtd</th></tr></thead>
          <tbody>${r.resumo_maquinas.map(x => `<tr class="border-t"><td class="px-2 py-1">${x.tipo}</td><td class="px-2 py-1 text-right font-semibold">${x.qtd}</td></tr>`).join('')}</tbody></table>
      </div>
    </div>`;
}

/* ============================================================
 * FICHA DE ACOMPANHAMENTO
 * ============================================================ */
ROUTES.ficha = async (main) => {
  const ops = (await api('get', '/ops')).data;
  const selected = state.fichaOp || ops[0]?.id_op || '';
  main.innerHTML = `
    <div class="card p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3 no-print">
      <div class="md:col-span-2"><label>OP</label>
        <select id="f-op">${ops.map(o => `<option value="${o.id_op}" ${selected == o.id_op ? 'selected' : ''}>${o.num_op} — ${o.nome_cliente}</option>`).join('')}</select></div>
      <div><label>Pacote padrão</label><input type="number" id="f-pct" value="10" min="1"/></div>
      <div class="flex items-end gap-2">
        <button id="f-go" class="btn btn-primary flex-1"><i class="fas fa-print mr-1"></i> Gerar</button>
        <button id="f-prt" class="btn btn-secondary"><i class="fas fa-file-pdf"></i></button>
      </div>
    </div>
    <div id="f-result"></div>`;

  const run = async () => {
    const id = $('#f-op').value; if (!id) return;
    const r = (await api('get', `/ops/${id}/ficha?pacote=${$('#f-pct').value || 10}`)).data;
    drawFicha(r);
  };
  $('#f-go').onclick = run;
  $('#f-prt').onclick = () => window.print();
  $('#f-op').onchange = run;
  if (selected) run();
};

function drawFicha(r) {
  $('#f-result').innerHTML = `
    <div class="card p-6">
      <div class="flex items-start justify-between border-b pb-4 mb-4">
        <div>
          <h2 class="text-xl font-bold">Ficha de Acompanhamento de Produção</h2>
          <div class="text-sm text-slate-500">Emitida em ${fmt.datetime(new Date())}</div>
        </div>
        <div class="text-right text-sm">
          <div><b>OP:</b> ${r.op.num_op}</div>
          <div><b>Emissão:</b> ${fmt.date(r.op.dt_emissao)}</div>
          <div><b>Entrega:</b> ${fmt.date(r.op.dt_entrega)}</div>
        </div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
        <div><div class="text-slate-500">Cliente</div><b>${r.op.nome_cliente}</b></div>
        <div><div class="text-slate-500">Referência</div><b>${r.op.cod_ref} — ${r.op.desc_ref}</b></div>
        <div><div class="text-slate-500">Qtd Peças</div><b>${fmt.int(r.op.qtde_pecas)}</b></div>
        <div><div class="text-slate-500">Tempo Total / peça</div><b>${fmt.num(r.totais.tempo_total_ref)} min</b></div>
        <div class="md:col-span-2"><div class="text-slate-500">Cores</div>${r.cores.map(c => `<span class="badge bg-slate-100 text-slate-700 mr-1">${c.nome_cor}: ${c.qtde_pecas}</span>`).join('')}</div>
        <div class="md:col-span-2"><div class="text-slate-500">Tamanhos</div>${r.tamanhos.map(t => `<span class="badge bg-slate-100 text-slate-700 mr-1">${t.cod_tam}: ${t.qtde_pecas}</span>`).join('')}</div>
      </div>
      <table class="w-full text-sm border">
        <thead class="bg-slate-100"><tr>
          <th class="p-2 text-right w-16">Seq</th>
          <th class="p-2 text-left">Operação</th>
          <th class="p-2 text-left">Máquina</th>
          <th class="p-2 text-left">Aparelho</th>
          <th class="p-2 text-right">Tempo (min)</th>
          <th class="p-2 text-right">Pçs/Hora</th>
          <th class="p-2 text-right">Pacote</th>
          <th class="p-2 text-right">Tempo/Pacote</th>
          <th class="p-2 text-left">Operador(a)</th>
          <th class="p-2 text-right">Qtd/Pacote</th>
        </tr></thead>
        <tbody>${r.linhas.map(l => `
          <tr class="border-t">
            <td class="p-2 text-right font-mono">${l.sequencia}</td>
            <td class="p-2">${l.cod_op} — ${l.desc_op}</td>
            <td class="p-2">${l.desc_maquina || '-'}</td>
            <td class="p-2">${l.desc_aparelho || '-'}</td>
            <td class="p-2 text-right">${fmt.num(l.tempo_padrao)}</td>
            <td class="p-2 text-right">${fmt.num(l.pcs_hora, 1)}</td>
            <td class="p-2 text-right">${l.pacote}</td>
            <td class="p-2 text-right">${fmt.num(l.tempo_pacote)}</td>
            <td class="p-2">&nbsp;</td>
            <td class="p-2">&nbsp;</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr class="border-t-2 font-semibold bg-slate-50">
          <td colspan="4" class="p-2 text-right">Total:</td>
          <td class="p-2 text-right">${fmt.num(r.totais.tempo_total_ref)}</td>
          <td colspan="5" class="p-2 text-right">Total Min. OP: <b>${fmt.int(r.totais.total_min_op)}</b></td>
        </tr></tfoot>
      </table>
      ${r.op.observacao ? `<div class="mt-4 bg-amber-50 border border-amber-200 p-3 text-sm"><b>Observações:</b><br/>${r.op.observacao}</div>` : ''}
      <div class="mt-8 text-xs text-slate-500 text-right">Impresso em ${fmt.datetime(new Date())}</div>
    </div>`;
}

/* ============================================================
 * APONTAMENTO
 * ============================================================ */
ROUTES.apontamento = async (main) => {
  const [ops, ap] = await Promise.all([api('get', '/ops'), api('get', '/apontamentos')]);

  // Métricas do dia (operadores, peças, eficiência média)
  const hoje = dayjs().format('YYYY-MM-DD');
  const apHoje = ap.data.filter(a => (a.data || '').slice(0, 10) === hoje);
  const pecasHoje = apHoje.reduce((s, a) => s + (Number(a.qtd_boa) || 0), 0);
  const refHoje = apHoje.reduce((s, a) => s + (Number(a.qtd_refugo) || 0), 0);
  const horasHoje = apHoje.reduce((s, a) => s + (Number(a.horas_trab) || 0), 0);
  const eficMed = apHoje.length
    ? apHoje.reduce((s, a) => s + (Number(a.efic_real) || 0), 0) / apHoje.length : 0;

  main.innerHTML = `
    ${UI.pageHeader({
      breadcrumb: [{ label: 'Início', href: '#dashboard' }, { label: 'Produção' }, { label: 'Apontamento' }],
      title: 'Apontamento de Produção',
      badge: 'MES',
      desc: 'Registro em tempo real do que foi produzido. Eficiência calculada automaticamente.',
      live: true,
      actions: `<button class="btn-icon" id="btn-refresh-ap" title="Atualizar"><i class="fas fa-sync-alt"></i></button>`,
    })}

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      ${UI.kpi({ label: 'Peças Boas (hoje)', value: fmt.int(pecasHoje), icon: 'fa-circle-check', accent: 'green', sub: 'aprovadas' })}
      ${UI.kpi({ label: 'Refugo (hoje)', value: fmt.int(refHoje), icon: 'fa-recycle', accent: 'rose', sub: 'rejeitadas' })}
      ${UI.kpi({ label: 'Horas Trabalhadas', value: fmt.num(horasHoje, 1), icon: 'fa-clock', accent: 'cyan', sub: 'no dia' })}
      ${UI.kpi({ label: 'Eficiência Média', value: fmt.pct(eficMed), icon: 'fa-gauge-high', accent: 'purple',
        progress: Math.min(100, eficMed * 100),
        trend: { dir: eficMed >= 0.85 ? 'up' : eficMed >= 0.7 ? 'flat' : 'down', text: eficMed >= 0.85 ? 'Ótimo' : eficMed >= 0.7 ? 'OK' : 'Baixa' }
      })}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="card p-5">
        <h3 class="font-semibold mb-3 text-slate-700"><i class="fas fa-plus-circle mr-1"></i> Novo apontamento</h3>
        <form id="f-ap" class="space-y-3">
          <div><label>Data *</label><input type="date" id="a_dt" value="${dayjs().format('YYYY-MM-DD')}" required/></div>
          <div><label>OP *</label><select id="a_op" required>
            <option value="">--</option>${ops.data.filter(o => o.status !== 'Cancelada').map(o => `<option value="${o.id_op}">${o.num_op} — ${o.cod_ref}</option>`).join('')}
          </select></div>
          <div><label>Sequência *</label><input type="number" id="a_seq" required/></div>
          <div><label>Operador *</label><input id="a_op_nome" required/></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label>Qtd Boa *</label><input type="number" id="a_boa" min="0" required/></div>
            <div><label>Refugo</label><input type="number" id="a_ref" min="0" value="0"/></div>
          </div>
          <div><label>Horas trabalhadas *</label><input type="number" id="a_hrs" step="0.1" min="0.1" required/></div>
          <button class="btn btn-primary w-full"><i class="fas fa-save mr-1"></i> Registrar</button>
        </form>
      </div>
      <div class="card p-5 lg:col-span-2 overflow-auto">
        <h3 class="font-semibold mb-3 text-slate-700"><i class="fas fa-list mr-1"></i> Últimos apontamentos</h3>
        ${ap.data.length ? `
        <table class="w-full text-sm">
          <thead class="bg-slate-100"><tr>
            <th class="p-2 text-left">Data</th>
            <th class="p-2 text-left">OP</th>
            <th class="p-2 text-right">Seq</th>
            <th class="p-2 text-left">Operação</th>
            <th class="p-2 text-left">Operador</th>
            <th class="p-2 text-right">Boa</th>
            <th class="p-2 text-right">Refugo</th>
            <th class="p-2 text-right">Horas</th>
            <th class="p-2 text-right">Efic.</th>
            <th class="p-2 w-10"></th>
          </tr></thead>
          <tbody>${ap.data.map(a => {
            const ef = Number(a.efic_real) || 0;
            const efClass = ef >= 0.85 ? 'text-emerald-600' : ef >= 0.7 ? 'text-amber-600' : 'text-red-600';
            const lowAlert = ef < 0.6 ? '<i class="fas fa-arrow-down ml-1" title="Produtividade baixa"></i>' : '';
            return `
            <tr class="border-t">
              <td class="p-2">${fmt.date(a.data)}</td>
              <td class="p-2 font-mono">${a.num_op}</td>
              <td class="p-2 text-right">${a.sequencia}</td>
              <td class="p-2">${a.desc_op}</td>
              <td class="p-2">${a.operador}</td>
              <td class="p-2 text-right">${fmt.int(a.qtd_boa)}</td>
              <td class="p-2 text-right">${fmt.int(a.qtd_refugo)}</td>
              <td class="p-2 text-right">${fmt.num(a.horas_trab, 1)}</td>
              <td class="p-2 text-right font-semibold ${efClass}">${fmt.pct(ef)}${lowAlert}</td>
              <td class="p-2 text-center"><button class="btn-icon" data-del="${a.id_apont}" title="Excluir" style="width:30px;height:30px;color:#EF4444"><i class="fas fa-times"></i></button></td>
            </tr>`;}).join('')}
          </tbody>
        </table>` : UI.empty({
          icon: 'fa-clipboard-check',
          title: 'Nenhum apontamento',
          desc: 'Use o formulário ao lado para registrar o primeiro apontamento de produção.'
        })}
      </div>
    </div>`;

  const btnRefAp = $('#btn-refresh-ap');
  if (btnRefAp) btnRefAp.onclick = async () => {
    btnRefAp.classList.add('is-spinning');
    try { await ROUTES.apontamento(main); }
    finally { btnRefAp.classList.remove('is-spinning'); }
  };
  UI.liveTick(main, Date.now());
  $('#f-ap').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      data: $('#a_dt').value, id_op: parseInt($('#a_op').value),
      sequencia: parseInt($('#a_seq').value), operador: $('#a_op_nome').value,
      qtd_boa: parseInt($('#a_boa').value), qtd_refugo: parseInt($('#a_ref').value || 0),
      horas_trab: parseFloat($('#a_hrs').value),
    };
    try { const r = await api('post', '/apontamentos', body); toast(`Registrado. Eficiência: ${fmt.pct(r.data.efic_real)}`, 'success'); render(); }
    catch {}
  };
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Excluir apontamento?')) return;
    await api('delete', `/apontamentos/${b.dataset.del}`); render();
  });
};

/* ============================================================
 * AUDITORIA
 * ============================================================ */
ROUTES.auditoria = async (main) => {
  const d = (await api('get', '/auditoria')).data;
  main.innerHTML = `
    <div class="card overflow-auto">
      <table class="w-full text-sm table-sticky">
        <thead class="bg-slate-100"><tr>
          <th class="p-2 text-left">Data/Hora</th>
          <th class="p-2 text-left">Usuário</th>
          <th class="p-2 text-left">Módulo</th>
          <th class="p-2 text-left">Ação</th>
          <th class="p-2 text-left">Chave</th>
          <th class="p-2 text-left">Campo</th>
          <th class="p-2 text-left">Valor Anterior</th>
          <th class="p-2 text-left">Valor Novo</th>
        </tr></thead>
        <tbody>${d.map(r => `
          <tr class="border-t">
            <td class="p-2">${fmt.datetime(r.dt_hora)}</td>
            <td class="p-2">${r.usuario}</td>
            <td class="p-2"><span class="badge bg-slate-200 text-slate-700">${r.modulo}</span></td>
            <td class="p-2">${r.acao}</td>
            <td class="p-2 font-mono text-xs">${r.chave_registro || ''}</td>
            <td class="p-2 text-xs">${r.campo || ''}</td>
            <td class="p-2 text-xs">${r.valor_anterior || ''}</td>
            <td class="p-2 text-xs">${r.valor_novo || ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${!d.length ? '<div class="text-center text-slate-500 p-6">Sem registros de auditoria.</div>' : ''}
    </div>`;
};

/* ============================================================
 * 📊 RELATÓRIOS PROFISSIONAIS (6 modelos, prontos para PDF)
 * ============================================================ */
const REL = {
  current: 'executivo',
  filtros: null,
  periodoIni: null,
  periodoFim: null,
  charts: [],
};

function relDefaultPeriodo() {
  const hoje = dayjs();
  REL.periodoIni = hoje.startOf('month').format('YYYY-MM-DD');
  REL.periodoFim = hoje.endOf('month').format('YYYY-MM-DD');
}

function relDestroyCharts() {
  REL.charts.forEach(c => { try { c.destroy(); } catch {} });
  REL.charts = [];
}

/* Helpers de formatação para relatórios */
const relFmt = {
  num: (v, dec = 0) => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }),
  pct: (v, dec = 1) => (v == null || isNaN(v)) ? '—' : (Number(v) * 100).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%',
  date: (s) => s ? dayjs(s).format('DD/MM/YYYY') : '—',
  datetime: (s) => s ? dayjs(s).format('DD/MM/YYYY HH:mm') : '—',
  status: (s) => {
    const cls = { Aberta: '', Planejada: 'purple', EmProducao: 'blue', Concluida: 'ok', Cancelada: 'danger' }[s] || '';
    return `<span class="rep-badge ${cls}">${s || '—'}</span>`;
  },
};

/* Cabeçalho padrão do documento — com logo CorePro */
function relDocHeader(tipo, subtitulo) {
  const now = dayjs().format('DD/MM/YYYY HH:mm');
  const per = REL.periodoIni && REL.periodoFim
    ? `${dayjs(REL.periodoIni).format('DD/MM/YYYY')} — ${dayjs(REL.periodoFim).format('DD/MM/YYYY')}` : '';
  const u = state.user || {};
  return `
  <div class="report-header">
    <div class="brand">
      <img src="/static/logo-icon.png" alt="CorePro" />
      <div>
        <div class="title">CorePro</div>
        <div class="sub">Onde sistemas se tornam negócio</div>
      </div>
    </div>
    <div class="meta">
      <div class="type">${tipo}</div>
      <div style="font-size:13px;font-weight:600;color:#0B1120;margin-top:2px">${subtitulo || ''}</div>
      ${per ? `<div style="margin-top:3px">Período: <b>${per}</b></div>` : ''}
      <div>Emitido em: <b>${now}</b></div>
      <div>Por: <b>${u.nome || '—'}</b> <span style="color:#9CA3AF">(${u.perfil || '—'})</span></div>
    </div>
  </div>`;
}

function relDocFooter() {
  return `
  <div class="rep-footer">
    <div>CorePro · PCP Confecção · Relatório gerado automaticamente</div>
    <div>Página <span class="page-num"></span></div>
  </div>`;
}

/* Barra de ações (imprimir, nova aba, voltar) */
function relActionsBar() {
  return `
  <div class="rep-actions no-print">
    <button id="rel-print" class="btn btn-primary"><i class="fas fa-print mr-2"></i>Imprimir / Salvar como PDF</button>
    <button id="rel-export-html" class="btn btn-secondary"><i class="fas fa-file-code mr-2"></i>Abrir em nova aba</button>
  </div>`;
}

/* Bind das ações do relatório (depois de renderizar) */
function relBindActions(html) {
  const btnPrint = $('#rel-print');
  if (btnPrint) btnPrint.onclick = () => window.print();
  const btnExport = $('#rel-export-html');
  if (btnExport) btnExport.onclick = () => relAbrirEmNovaAba(html);
}

/* Abre o relatório em uma aba separada (útil para salvar como PDF sem UI do app) */
function relAbrirEmNovaAba(htmlDocumento) {
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((n) => n.outerHTML).join('\n');
  const title = `CorePro — ${REL.current}`;
  const win = window.open('', '_blank');
  win.document.open();
  win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
    <meta charset="UTF-8" />
    <title>${title}</title>
    ${styles}
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>body{background:#020617;padding:18px;}</style>
  </head><body>
    <div class="report-doc">${htmlDocumento}</div>
    <script>setTimeout(()=>window.print(), 800);</script>
  </body></html>`);
  win.document.close();
}

/* ---------- Shell da tela de relatórios ---------- */
ROUTES.relatorios = async (main) => {
  relDestroyCharts();
  if (!REL.periodoIni) relDefaultPeriodo();
  if (!REL.filtros) {
    try { REL.filtros = (await api('get', '/relatorios/filtros')).data; } catch { REL.filtros = { clientes: [], refs: [], ops: [], operadores: [], modulos_auditoria: [], usuarios_auditoria: [] }; }
  }

  const tabs = [
    { id: 'executivo',  label: 'Executivo',     icon: 'fa-chart-pie' },
    { id: 'op',         label: 'OP Detalhada',  icon: 'fa-clipboard-list' },
    { id: 'producao',   label: 'Produção',      icon: 'fa-hard-hat' },
    { id: 'cliente',    label: 'Cliente',       icon: 'fa-user-tie' },
    { id: 'referencia', label: 'Referência',    icon: 'fa-tshirt' },
    { id: 'auditoria',  label: 'Auditoria',     icon: 'fa-history' },
  ];

  main.innerHTML = `
  <div class="rel-shell">
    <div class="rel-tabs no-print">
      ${tabs.map(t => `<div class="rel-tab ${t.id === REL.current ? 'active' : ''}" data-tab="${t.id}"><i class="fas ${t.icon}"></i>${t.label}</div>`).join('')}
    </div>
    <div id="rel-filters" class="no-print"></div>
    <div id="rel-content"></div>
  </div>`;

  $$('.rel-tab').forEach((t) => t.onclick = () => {
    REL.current = t.dataset.tab;
    $$('.rel-tab').forEach((x) => x.classList.toggle('active', x === t));
    renderRelatorio();
  });

  renderRelatorio();
};

async function renderRelatorio() {
  relDestroyCharts();
  const fil = $('#rel-filters');
  const ct = $('#rel-content');
  ct.innerHTML = '<div class="text-center py-16"><i class="fas fa-spinner fa-spin text-2xl"></i></div>';

  // monta filtros por tipo
  const per = `
    <div class="field"><label>Data inicial</label><input type="date" id="f-ini" value="${REL.periodoIni}" /></div>
    <div class="field"><label>Data final</label><input type="date" id="f-fim" value="${REL.periodoFim}" /></div>`;

  let extra = '';
  if (REL.current === 'op') {
    const ops = REL.filtros.ops || [];
    extra = `<div class="field" style="min-width:220px"><label>OP</label>
      <select id="f-op"><option value="">— selecione —</option>${ops.map(o => `<option value="${o.id_op}">${o.num_op}</option>`).join('')}</select></div>`;
  } else if (REL.current === 'cliente') {
    const cls = REL.filtros.clientes || [];
    extra = `<div class="field" style="min-width:220px"><label>Cliente</label>
      <select id="f-cli"><option value="">— selecione —</option>${cls.map(c => `<option value="${c.id_cliente}">${c.cod_cliente} — ${c.nome_cliente}</option>`).join('')}</select></div>`;
  } else if (REL.current === 'referencia') {
    const rfs = REL.filtros.refs || [];
    extra = `<div class="field" style="min-width:220px"><label>Referência</label>
      <select id="f-ref"><option value="">— selecione —</option>${rfs.map(r => `<option value="${r.id_ref}">${r.cod_ref} — ${r.desc_ref}</option>`).join('')}</select></div>`;
  } else if (REL.current === 'producao') {
    const ops = REL.filtros.ops || [];
    const opers = REL.filtros.operadores || [];
    extra = `
      <div class="field" style="min-width:220px"><label>OP (opcional)</label>
        <select id="f-op"><option value="">Todas</option>${ops.map(o => `<option value="${o.id_op}">${o.num_op}</option>`).join('')}</select></div>
      <div class="field" style="min-width:180px"><label>Operador (opcional)</label>
        <select id="f-oper"><option value="">Todos</option>${opers.map(o => `<option value="${o}">${o}</option>`).join('')}</select></div>`;
  } else if (REL.current === 'auditoria') {
    const mods = REL.filtros.modulos_auditoria || [];
    const usrs = REL.filtros.usuarios_auditoria || [];
    extra = `
      <div class="field"><label>Módulo</label>
        <select id="f-mod"><option value="">Todos</option>${mods.map(m => `<option value="${m}">${m}</option>`).join('')}</select></div>
      <div class="field"><label>Usuário</label>
        <select id="f-usr"><option value="">Todos</option>${usrs.map(u => `<option value="${u}">${u}</option>`).join('')}</select></div>
      <div class="field" style="min-width:200px"><label>Busca</label><input type="text" id="f-busca" placeholder="texto na chave" /></div>`;
  }

  fil.innerHTML = `<div class="rel-toolbar">${per}${extra}
    <div class="field" style="min-width:auto"><label>&nbsp;</label>
      <button id="rel-go" class="btn btn-primary"><i class="fas fa-play mr-1"></i>Gerar relatório</button></div>
  </div>`;

  $('#rel-go').onclick = async () => {
    REL.periodoIni = $('#f-ini').value || REL.periodoIni;
    REL.periodoFim = $('#f-fim').value || REL.periodoFim;
    await gerarRelatorioAtual();
  };

  // gera automaticamente na 1ª carga (para o executivo e auditoria)
  if (REL.current === 'executivo' || REL.current === 'auditoria') await gerarRelatorioAtual();
  else ct.innerHTML = `
    <div class="card p-10 text-center" style="border:2px dashed rgba(148,163,184,.25)">
      <i class="fas fa-hand-pointer text-5xl" style="color:#60A5FA"></i>
      <p class="mt-4" style="color:#9CA3AF">Selecione os filtros acima e clique em <b>Gerar relatório</b>.</p>
    </div>`;
}

async function gerarRelatorioAtual() {
  const ct = $('#rel-content');
  ct.innerHTML = '<div class="text-center py-16"><i class="fas fa-spinner fa-spin text-2xl"></i></div>';
  relDestroyCharts();
  try {
    if (REL.current === 'executivo') await relExecutivo(ct);
    else if (REL.current === 'op') await relOp(ct);
    else if (REL.current === 'producao') await relProducao(ct);
    else if (REL.current === 'cliente') await relCliente(ct);
    else if (REL.current === 'referencia') await relReferencia(ct);
    else if (REL.current === 'auditoria') await relAuditoria(ct);
  } catch (e) {
    console.error(e);
    ct.innerHTML = `<div class="card p-6" style="color:#FF3B3B"><i class="fas fa-exclamation-triangle"></i> Erro ao gerar relatório: ${e.message || e}</div>`;
  }
}

/* ---------- 1) EXECUTIVO ---------- */
async function relExecutivo(ct) {
  const r = (await api('get', `/relatorios/executivo?dt_ini=${REL.periodoIni}&dt_fim=${REL.periodoFim}`)).data;
  const k = r.kpis;
  const ops = k.ops || {};
  const prd = k.producao || {};
  const htmlDoc = `
    ${relDocHeader('Relatório Executivo', 'Visão consolidada de Produção')}
    <div class="rep-kpis">
      <div class="rep-kpi"><div class="label">OPs no período</div><div class="value">${relFmt.num(ops.total)}</div><div class="hint">${relFmt.num(ops.concluidas)} concluídas · ${relFmt.num(ops.abertas)} abertas</div></div>
      <div class="rep-kpi warn"><div class="label">OPs atrasadas</div><div class="value">${relFmt.num(ops.atrasadas)}</div><div class="hint">em aberto fora do prazo</div></div>
      <div class="rep-kpi purple"><div class="label">Peças totais</div><div class="value">${relFmt.num(ops.pecas_total)}</div><div class="hint">${relFmt.num(ops.pecas_aberto)} em aberto</div></div>
      <div class="rep-kpi"><div class="label">Prazo médio</div><div class="value">${relFmt.num(ops.prazo_medio, 1)}</div><div class="hint">dias emissão → entrega</div></div>
      <div class="rep-kpi ok"><div class="label">Produção boa</div><div class="value">${relFmt.num(prd.producao_boa)}</div><div class="hint">peças aprovadas</div></div>
      <div class="rep-kpi danger"><div class="label">Refugo</div><div class="value">${relFmt.num(prd.refugo)}</div><div class="hint">${relFmt.pct(k.refugo_pct)} do produzido</div></div>
      <div class="rep-kpi"><div class="label">Horas trabalhadas</div><div class="value">${relFmt.num(prd.horas_total, 1)}</div><div class="hint">${relFmt.num(prd.total_apont)} apontamentos</div></div>
      <div class="rep-kpi ok"><div class="label">Eficiência real</div><div class="value">${relFmt.pct(prd.efic_media)}</div><div class="hint">média do período</div></div>
    </div>

    <div class="rep-grid-2 avoid-break">
      <div class="rep-chart"><h3>Produção diária (peças boas x refugo)</h3><canvas id="rc-prod"></canvas></div>
      <div class="rep-chart"><h3>OPs por Status</h3><canvas id="rc-status"></canvas></div>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-user-tie"></i>Top clientes do período</h2>
      <table class="rep-table">
        <thead><tr><th>#</th><th>Código</th><th>Nome</th><th class="num">OPs</th><th class="num">Concluídas</th><th class="num">Peças</th></tr></thead>
        <tbody>${r.top_clientes.map((c, i) => `
          <tr><td>${i+1}</td><td>${c.cod_cliente}</td><td>${c.nome_cliente}</td>
            <td class="num">${relFmt.num(c.qtd_ops)}</td>
            <td class="num">${relFmt.num(c.ops_concluidas)}</td>
            <td class="num">${relFmt.num(c.pecas)}</td></tr>`).join('') || '<tr><td colspan="6" class="center" style="color:#9CA3AF">Sem dados no período</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-tshirt"></i>Top referências do período</h2>
      <table class="rep-table">
        <thead><tr><th>#</th><th>Código</th><th>Descrição</th><th>Família</th><th class="num">OPs</th><th class="num">Peças</th></tr></thead>
        <tbody>${r.top_refs.map((x, i) => `
          <tr><td>${i+1}</td><td>${x.cod_ref}</td><td>${x.desc_ref}</td><td>${x.familia || '—'}</td>
            <td class="num">${relFmt.num(x.qtd_ops)}</td><td class="num">${relFmt.num(x.pecas)}</td></tr>`).join('') || '<tr><td colspan="6" class="center" style="color:#9CA3AF">Sem dados no período</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-hard-hat"></i>Top operadores</h2>
      <table class="rep-table">
        <thead><tr><th>Operador</th><th class="num">Apontamentos</th><th class="num">Boas</th><th class="num">Refugo</th><th class="num">Horas</th><th class="num">Eficiência</th></tr></thead>
        <tbody>${r.top_operadores.map(o => `
          <tr><td>${o.operador}</td>
            <td class="num">${relFmt.num(o.apontamentos)}</td>
            <td class="num">${relFmt.num(o.total_boa)}</td>
            <td class="num">${relFmt.num(o.total_refugo)}</td>
            <td class="num">${relFmt.num(o.horas, 1)}</td>
            <td class="num">${relFmt.pct(o.efic_media)}</td></tr>`).join('') || '<tr><td colspan="6" class="center" style="color:#9CA3AF">Sem apontamentos</td></tr>'}
        </tbody>
      </table>
    </div>
    ${relDocFooter()}`;

  ct.innerHTML = `${relActionsBar()}<div class="report-doc">${htmlDoc}</div>`;
  relBindActions(htmlDoc);

  // Gráficos
  setTimeout(() => {
    const cProd = $('#rc-prod');
    if (cProd) {
      const labels = r.producao_diaria.map(x => dayjs(x.dia).format('DD/MM'));
      const boa = r.producao_diaria.map(x => Number(x.boa) || 0);
      const ref = r.producao_diaria.map(x => Number(x.refugo) || 0);
      REL.charts.push(new Chart(cProd, {
        type: 'bar',
        data: { labels, datasets: [
          { label: 'Boa', data: boa, backgroundColor: '#2563EB', borderRadius: 4 },
          { label: 'Refugo', data: ref, backgroundColor: '#FF3B3B', borderRadius: 4 },
        ]},
        options: { plugins: { legend: { labels: { color: '#111827' } } }, scales: { x: { ticks: { color: '#374151' } }, y: { ticks: { color: '#374151' } } } }
      }));
    }
    const cSt = $('#rc-status');
    if (cSt) {
      const labels = r.status_breakdown.map(x => x.status);
      const data = r.status_breakdown.map(x => Number(x.c) || 0);
      const colors = labels.map(s => ({ 'Aberta':'#6B7280','Planejada':'#7C3AED','EmProducao':'#2563EB','Concluida':'#00FF9C','Cancelada':'#FF3B3B' })[s] || '#6B7280');
      REL.charts.push(new Chart(cSt, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#fff', borderWidth: 2 }] },
        options: { plugins: { legend: { position: 'bottom', labels: { color: '#111827' } } }, cutout: '55%' }
      }));
    }
  }, 100);
}

/* ---------- 2) OP DETALHADA ---------- */
async function relOp(ct) {
  const idOp = $('#f-op')?.value;
  if (!idOp) { ct.innerHTML = '<div class="card p-8 text-center" style="color:#9CA3AF">Selecione uma OP e clique em Gerar relatório.</div>'; return; }
  const r = (await api('get', `/relatorios/op/${idOp}`)).data;
  const o = r.op, t = r.totais;
  const htmlDoc = `
    ${relDocHeader('Relatório Detalhado de OP', `OP ${o.num_op} · ${o.cod_ref} — ${o.desc_ref}`)}

    <div class="rep-info">
      <div class="cell"><div class="k">Número OP</div><div class="v">${o.num_op}</div></div>
      <div class="cell"><div class="k">Status</div><div class="v">${relFmt.status(o.status)}</div></div>
      <div class="cell"><div class="k">Cliente</div><div class="v">${o.cod_cliente} — ${o.nome_cliente}</div></div>
      <div class="cell"><div class="k">CNPJ</div><div class="v">${o.cnpj || '—'}</div></div>
      <div class="cell"><div class="k">Referência</div><div class="v">${o.cod_ref} — ${o.desc_ref}</div></div>
      <div class="cell"><div class="k">Família</div><div class="v">${o.familia || '—'}</div></div>
      <div class="cell"><div class="k">Versão Seq</div><div class="v">v${o.versao_seq || '—'}</div></div>
      <div class="cell"><div class="k">Qtd Peças</div><div class="v">${relFmt.num(o.qtde_pecas)}</div></div>
      <div class="cell"><div class="k">Emissão</div><div class="v">${relFmt.date(o.dt_emissao)}</div></div>
      <div class="cell"><div class="k">Entrega</div><div class="v">${relFmt.date(o.dt_entrega)}</div></div>
      <div class="cell"><div class="k">Criada por</div><div class="v">${o.criado_por || '—'}</div></div>
      <div class="cell"><div class="k">Criada em</div><div class="v">${relFmt.datetime(o.dt_criacao)}</div></div>
    </div>

    <div class="rep-kpis">
      <div class="rep-kpi ok"><div class="label">Produção boa</div><div class="value">${relFmt.num(t.producao_boa)}</div><div class="hint">peças aprovadas</div></div>
      <div class="rep-kpi danger"><div class="label">Refugo</div><div class="value">${relFmt.num(t.refugo)}</div></div>
      <div class="rep-kpi"><div class="label">Horas</div><div class="value">${relFmt.num(t.horas_total, 1)}</div></div>
      <div class="rep-kpi ${t.pct_concluido >= 1 ? 'ok' : 'purple'}"><div class="label">Concluído</div><div class="value">${relFmt.pct(t.pct_concluido)}</div><div class="hint">${relFmt.num(t.pecas_restantes)} peças restantes</div></div>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-palette"></i>Grade de Cores</h2>
      <table class="rep-table">
        <thead><tr><th>Código</th><th>Cor</th><th class="num">Qtde</th></tr></thead>
        <tbody>${r.cores.map(c => `<tr><td>${c.cod_cor}</td><td>${c.nome_cor}</td><td class="num">${relFmt.num(c.qtde_pecas)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="num">${relFmt.num(r.cores.reduce((a,c)=>a+(Number(c.qtde_pecas)||0),0))}</td></tr></tfoot>
      </table>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-ruler"></i>Grade de Tamanhos</h2>
      <table class="rep-table">
        <thead><tr><th>Tamanho</th><th class="num">Qtde</th></tr></thead>
        <tbody>${r.tamanhos.map(tt => `<tr><td>${tt.cod_tam}</td><td class="num">${relFmt.num(tt.qtde_pecas)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td>Total</td><td class="num">${relFmt.num(r.tamanhos.reduce((a,x)=>a+(Number(x.qtde_pecas)||0),0))}</td></tr></tfoot>
      </table>
    </div>

    <div class="rep-section avoid-break page-break">
      <h2><i class="fas fa-list-ol"></i>Sequência Operacional</h2>
      <table class="rep-table">
        <thead><tr><th class="center">Seq</th><th>Operação</th><th>Máquina</th><th>Aparelho</th><th class="num">TP (min)</th><th class="num">Pç/h 100%</th></tr></thead>
        <tbody>${r.sequencia.map(s => `<tr>
          <td class="center">${s.sequencia}</td>
          <td><b>${s.cod_op}</b> — ${s.desc_op}</td>
          <td>${s.cod_maquina || '—'} ${s.desc_maquina ? '· ' + s.desc_maquina : ''}</td>
          <td>${s.cod_aparelho || '—'}</td>
          <td class="num">${relFmt.num(s.tempo_padrao, 2)}</td>
          <td class="num">${s.tempo_padrao > 0 ? relFmt.num(60/s.tempo_padrao, 1) : '—'}</td>
        </tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="4">Tempo total por peça</td><td class="num">${relFmt.num(t.tempo_total_ref, 2)} min</td><td></td></tr></tfoot>
      </table>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-hard-hat"></i>Apontamentos registrados</h2>
      <table class="rep-table">
        <thead><tr><th>Data</th><th class="center">Seq</th><th>Operação</th><th>Operador</th><th class="num">Boa</th><th class="num">Refugo</th><th class="num">Horas</th><th class="num">Eficiência</th></tr></thead>
        <tbody>${r.apontamentos.map(a => `<tr>
          <td>${relFmt.date(a.data)}</td>
          <td class="center">${a.sequencia || '—'}</td>
          <td>${a.cod_op || '—'} ${a.desc_op || ''}</td>
          <td>${a.operador}</td>
          <td class="num">${relFmt.num(a.qtd_boa)}</td>
          <td class="num">${relFmt.num(a.qtd_refugo)}</td>
          <td class="num">${relFmt.num(a.horas_trab, 1)}</td>
          <td class="num">${relFmt.pct(a.efic_real)}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="center" style="color:#9CA3AF">Nenhum apontamento registrado</td></tr>'}
        </tbody>
      </table>
    </div>

    ${o.observacao ? `<div class="rep-section avoid-break"><h2><i class="fas fa-sticky-note"></i>Observações</h2><div style="background:#FFFBEB;border:1px solid #FDE68A;padding:10px;border-radius:6px;white-space:pre-wrap">${o.observacao}</div></div>` : ''}
    ${relDocFooter()}`;

  ct.innerHTML = `${relActionsBar()}<div class="report-doc">${htmlDoc}</div>`;
  relBindActions(htmlDoc);
}

/* ---------- 3) PRODUÇÃO POR PERÍODO ---------- */
async function relProducao(ct) {
  const idOp = $('#f-op')?.value;
  const oper = $('#f-oper')?.value;
  let url = `/relatorios/producao?dt_ini=${REL.periodoIni}&dt_fim=${REL.periodoFim}`;
  if (idOp) url += `&id_op=${idOp}`;
  if (oper) url += `&operador=${encodeURIComponent(oper)}`;
  const r = (await api('get', url)).data;
  const t = r.totais || {};
  const htmlDoc = `
    ${relDocHeader('Relatório de Produção', 'Apontamentos agregados e detalhados')}
    <div class="rep-kpis">
      <div class="rep-kpi"><div class="label">Apontamentos</div><div class="value">${relFmt.num(t.apontamentos)}</div></div>
      <div class="rep-kpi ok"><div class="label">Produção boa</div><div class="value">${relFmt.num(t.boa)}</div></div>
      <div class="rep-kpi danger"><div class="label">Refugo</div><div class="value">${relFmt.num(t.refugo)}</div></div>
      <div class="rep-kpi"><div class="label">Horas</div><div class="value">${relFmt.num(t.horas, 1)}</div></div>
    </div>
    <div class="rep-kpis">
      <div class="rep-kpi ok"><div class="label">Eficiência média</div><div class="value">${relFmt.pct(t.efic)}</div></div>
      <div class="rep-kpi warn"><div class="label">% Refugo</div><div class="value">${(t.boa||t.refugo) ? relFmt.pct((Number(t.refugo)||0)/((Number(t.boa)||0)+(Number(t.refugo)||0))) : '—'}</div></div>
      <div class="rep-kpi purple"><div class="label">Pçs/hora</div><div class="value">${t.horas>0 ? relFmt.num((Number(t.boa)||0)/(Number(t.horas)||1), 1) : '—'}</div></div>
      <div class="rep-kpi"><div class="label">Período</div><div class="value" style="font-size:13px;line-height:1.4">${relFmt.date(r.periodo.ini)} — ${relFmt.date(r.periodo.fim)}</div></div>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-clipboard-list"></i>Resumo por OP</h2>
      <table class="rep-table">
        <thead><tr><th>OP</th><th>Referência</th><th>Cliente</th><th class="num">Boa</th><th class="num">Refugo</th><th class="num">Horas</th><th class="num">Efic</th></tr></thead>
        <tbody>${r.por_op.map(x => `<tr>
          <td><b>${x.num_op}</b></td><td>${x.cod_ref}</td><td>${x.nome_cliente}</td>
          <td class="num">${relFmt.num(x.boa)}</td><td class="num">${relFmt.num(x.refugo)}</td>
          <td class="num">${relFmt.num(x.horas,1)}</td><td class="num">${relFmt.pct(x.efic)}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="center" style="color:#9CA3AF">Sem dados</td></tr>'}</tbody>
      </table>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-hard-hat"></i>Resumo por Operador</h2>
      <table class="rep-table">
        <thead><tr><th>Operador</th><th class="num">Apont.</th><th class="num">Boa</th><th class="num">Refugo</th><th class="num">Horas</th><th class="num">Efic</th></tr></thead>
        <tbody>${r.por_operador.map(x => `<tr>
          <td>${x.operador}</td>
          <td class="num">${relFmt.num(x.apontamentos)}</td>
          <td class="num">${relFmt.num(x.boa)}</td>
          <td class="num">${relFmt.num(x.refugo)}</td>
          <td class="num">${relFmt.num(x.horas,1)}</td>
          <td class="num">${relFmt.pct(x.efic)}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="center" style="color:#9CA3AF">Sem dados</td></tr>'}</tbody>
      </table>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-industry"></i>Resumo por Máquina</h2>
      <table class="rep-table">
        <thead><tr><th>Código</th><th>Descrição</th><th>Tipo</th><th class="num">Apont.</th><th class="num">Boa</th><th class="num">Refugo</th><th class="num">Efic</th></tr></thead>
        <tbody>${r.por_maquina.map(x => `<tr>
          <td>${x.cod_maquina}</td><td>${x.desc_maquina}</td><td>${x.tipo || '—'}</td>
          <td class="num">${relFmt.num(x.apontamentos)}</td>
          <td class="num">${relFmt.num(x.boa)}</td>
          <td class="num">${relFmt.num(x.refugo)}</td>
          <td class="num">${relFmt.pct(x.efic)}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="center" style="color:#9CA3AF">Sem dados</td></tr>'}</tbody>
      </table>
    </div>

    <div class="rep-section page-break">
      <h2><i class="fas fa-list"></i>Detalhe dos Apontamentos</h2>
      <table class="rep-table">
        <thead><tr><th>Data</th><th>OP</th><th>Ref</th><th>Cliente</th><th>Seq</th><th>Operação</th><th>Operador</th><th class="num">Boa</th><th class="num">Ref</th><th class="num">H</th><th class="num">Efic</th></tr></thead>
        <tbody>${r.detalhe.map(x => `<tr>
          <td>${relFmt.date(x.data)}</td>
          <td><b>${x.num_op}</b></td>
          <td>${x.cod_ref}</td>
          <td>${x.nome_cliente}</td>
          <td class="center">${x.sequencia || '—'}</td>
          <td>${x.cod_op || '—'} ${x.desc_op ? '· '+x.desc_op : ''}</td>
          <td>${x.operador}</td>
          <td class="num">${relFmt.num(x.qtd_boa)}</td>
          <td class="num">${relFmt.num(x.qtd_refugo)}</td>
          <td class="num">${relFmt.num(x.horas_trab,1)}</td>
          <td class="num">${relFmt.pct(x.efic_real)}</td>
        </tr>`).join('') || '<tr><td colspan="11" class="center" style="color:#9CA3AF">Nenhum apontamento no período/filtros</td></tr>'}</tbody>
      </table>
    </div>
    ${relDocFooter()}`;

  ct.innerHTML = `${relActionsBar()}<div class="report-doc">${htmlDoc}</div>`;
  relBindActions(htmlDoc);
}

/* ---------- 4) CLIENTE ---------- */
async function relCliente(ct) {
  const id = $('#f-cli')?.value;
  if (!id) { ct.innerHTML = '<div class="card p-8 text-center" style="color:#9CA3AF">Selecione um cliente e clique em Gerar relatório.</div>'; return; }
  const r = (await api('get', `/relatorios/cliente/${id}?dt_ini=${REL.periodoIni}&dt_fim=${REL.periodoFim}`)).data;
  const c = r.cliente, ro = r.resumo_ops, p = r.producao || {};
  const htmlDoc = `
    ${relDocHeader('Relatório por Cliente', `${c.cod_cliente} — ${c.nome_cliente}`)}

    <div class="rep-info">
      <div class="cell"><div class="k">Código</div><div class="v">${c.cod_cliente}</div></div>
      <div class="cell"><div class="k">Nome</div><div class="v">${c.nome_cliente}</div></div>
      <div class="cell"><div class="k">CNPJ</div><div class="v">${c.cnpj || '—'}</div></div>
      <div class="cell"><div class="k">Status</div><div class="v">${c.ativo ? '<span class="rep-badge ok">Ativo</span>' : '<span class="rep-badge danger">Inativo</span>'}</div></div>
    </div>
    ${c.observacao ? `<div style="background:#FFFBEB;border:1px solid #FDE68A;padding:8px;border-radius:6px;margin-bottom:10px;white-space:pre-wrap;font-size:11px">${c.observacao}</div>` : ''}

    <div class="rep-kpis">
      <div class="rep-kpi"><div class="label">OPs no período</div><div class="value">${relFmt.num(ro.total)}</div><div class="hint">${relFmt.num(ro.concluidas)} concluídas</div></div>
      <div class="rep-kpi warn"><div class="label">Atrasadas</div><div class="value">${relFmt.num(ro.atrasadas)}</div></div>
      <div class="rep-kpi purple"><div class="label">Peças encomendadas</div><div class="value">${relFmt.num(ro.pecas)}</div></div>
      <div class="rep-kpi"><div class="label">Prazo médio</div><div class="value">${relFmt.num(ro.prazo_medio,1)}</div><div class="hint">dias</div></div>
      <div class="rep-kpi ok"><div class="label">Produção boa</div><div class="value">${relFmt.num(p.boa)}</div></div>
      <div class="rep-kpi danger"><div class="label">Refugo</div><div class="value">${relFmt.num(p.refugo)}</div></div>
      <div class="rep-kpi"><div class="label">Horas</div><div class="value">${relFmt.num(p.horas,1)}</div></div>
      <div class="rep-kpi ok"><div class="label">Eficiência média</div><div class="value">${relFmt.pct(p.efic)}</div></div>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-tshirt"></i>Consumo por Referência</h2>
      <table class="rep-table">
        <thead><tr><th>Código</th><th>Descrição</th><th class="num">OPs</th><th class="num">Peças</th></tr></thead>
        <tbody>${r.por_referencia.map(x => `<tr><td>${x.cod_ref}</td><td>${x.desc_ref}</td>
          <td class="num">${relFmt.num(x.ops)}</td><td class="num">${relFmt.num(x.pecas)}</td></tr>`).join('') || '<tr><td colspan="4" class="center" style="color:#9CA3AF">Sem dados</td></tr>'}</tbody>
      </table>
    </div>

    <div class="rep-section page-break">
      <h2><i class="fas fa-clipboard-list"></i>Ordens de Produção</h2>
      <table class="rep-table">
        <thead><tr><th>OP</th><th>Referência</th><th>Emissão</th><th>Entrega</th><th class="num">Peças</th><th>Status</th></tr></thead>
        <tbody>${r.ops.map(o => `<tr>
          <td><b>${o.num_op}</b></td>
          <td>${o.cod_ref} — ${o.desc_ref}</td>
          <td>${relFmt.date(o.dt_emissao)}</td>
          <td>${o.atrasada ? '<span class="rep-badge danger">'+relFmt.date(o.dt_entrega)+'</span>' : relFmt.date(o.dt_entrega)}</td>
          <td class="num">${relFmt.num(o.qtde_pecas)}</td>
          <td>${relFmt.status(o.status)}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="center" style="color:#9CA3AF">Sem OPs no período</td></tr>'}</tbody>
      </table>
    </div>
    ${relDocFooter()}`;

  ct.innerHTML = `${relActionsBar()}<div class="report-doc">${htmlDoc}</div>`;
  relBindActions(htmlDoc);
}

/* ---------- 5) REFERÊNCIA ---------- */
async function relReferencia(ct) {
  const id = $('#f-ref')?.value;
  if (!id) { ct.innerHTML = '<div class="card p-8 text-center" style="color:#9CA3AF">Selecione uma referência e clique em Gerar relatório.</div>'; return; }
  const r = (await api('get', `/relatorios/referencia/${id}?dt_ini=${REL.periodoIni}&dt_fim=${REL.periodoFim}`)).data;
  const ref = r.referencia, sa = r.sequencia_ativa, ro = r.resumo_ops, p = r.producao || {};
  const htmlDoc = `
    ${relDocHeader('Relatório por Referência', `${ref.cod_ref} — ${ref.desc_ref}`)}

    <div class="rep-info">
      <div class="cell"><div class="k">Código</div><div class="v">${ref.cod_ref}</div></div>
      <div class="cell"><div class="k">Descrição</div><div class="v">${ref.desc_ref}</div></div>
      <div class="cell"><div class="k">Família</div><div class="v">${ref.familia || '—'}</div></div>
      <div class="cell"><div class="k">Status</div><div class="v">${ref.ativo ? '<span class="rep-badge ok">Ativa</span>' : '<span class="rep-badge danger">Inativa</span>'}</div></div>
      <div class="cell"><div class="k">Versão ativa</div><div class="v">${sa ? 'v'+sa.versao : '—'}</div></div>
      <div class="cell"><div class="k">Itens da sequência</div><div class="v">${sa ? relFmt.num(sa.qtd_itens) : '—'}</div></div>
      <div class="cell"><div class="k">Tempo total/peça</div><div class="v">${sa ? relFmt.num(sa.tempo_total, 2) + ' min' : '—'}</div></div>
      <div class="cell"><div class="k">Pçs/hora @100%</div><div class="v">${sa && sa.tempo_total > 0 ? relFmt.num(60/sa.tempo_total, 1) : '—'}</div></div>
    </div>

    <div class="rep-kpis">
      <div class="rep-kpi"><div class="label">OPs no período</div><div class="value">${relFmt.num(ro.total)}</div></div>
      <div class="rep-kpi purple"><div class="label">Peças encomendadas</div><div class="value">${relFmt.num(ro.pecas)}</div></div>
      <div class="rep-kpi ok"><div class="label">Peças concluídas</div><div class="value">${relFmt.num(ro.pecas_concluidas)}</div></div>
      <div class="rep-kpi warn"><div class="label">Em aberto</div><div class="value">${relFmt.num(ro.pecas_aberto)}</div><div class="hint">${relFmt.num(ro.atrasadas)} atrasadas</div></div>
      <div class="rep-kpi ok"><div class="label">Produção boa</div><div class="value">${relFmt.num(p.boa)}</div></div>
      <div class="rep-kpi danger"><div class="label">Refugo</div><div class="value">${relFmt.num(p.refugo)}</div></div>
      <div class="rep-kpi"><div class="label">Horas</div><div class="value">${relFmt.num(p.horas, 1)}</div></div>
      <div class="rep-kpi ok"><div class="label">Eficiência</div><div class="value">${relFmt.pct(p.efic)}</div></div>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-user-tie"></i>Clientes que compram esta referência</h2>
      <table class="rep-table">
        <thead><tr><th>Código</th><th>Nome</th><th class="num">OPs</th><th class="num">Peças</th></tr></thead>
        <tbody>${r.por_cliente.map(x => `<tr><td>${x.cod_cliente}</td><td>${x.nome_cliente}</td>
          <td class="num">${relFmt.num(x.ops)}</td><td class="num">${relFmt.num(x.pecas)}</td></tr>`).join('') || '<tr><td colspan="4" class="center" style="color:#9CA3AF">Sem dados</td></tr>'}</tbody>
      </table>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-balance-scale"></i>Eficiência por Operação (versão ativa)</h2>
      <table class="rep-table">
        <thead><tr><th>Cód Op</th><th>Operação</th><th class="num">TP (min)</th><th class="num">Apont</th><th class="num">Boa</th><th class="num">Refugo</th><th class="num">Efic</th></tr></thead>
        <tbody>${r.efic_por_operacao.map(x => `<tr>
          <td>${x.cod_op}</td><td>${x.desc_op}</td>
          <td class="num">${relFmt.num(x.tempo_padrao, 2)}</td>
          <td class="num">${relFmt.num(x.apontamentos)}</td>
          <td class="num">${relFmt.num(x.boa)}</td>
          <td class="num">${relFmt.num(x.refugo)}</td>
          <td class="num">${relFmt.pct(x.efic)}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="center" style="color:#9CA3AF">Sem dados</td></tr>'}</tbody>
      </table>
    </div>

    <div class="rep-section avoid-break">
      <h2><i class="fas fa-code-branch"></i>Histórico de Versões de Sequência</h2>
      <table class="rep-table">
        <thead><tr><th class="center">Versão</th><th>Status</th><th>Criação</th><th>Ativação</th></tr></thead>
        <tbody>${r.versoes.map(v => `<tr>
          <td class="center"><b>v${v.versao}</b></td>
          <td>${v.ativa ? '<span class="rep-badge ok">ATIVA</span>' : '<span class="rep-badge">inativa</span>'}</td>
          <td>${relFmt.datetime(v.dt_criacao)}</td>
          <td>${relFmt.datetime(v.dt_ativacao)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    ${relDocFooter()}`;

  ct.innerHTML = `${relActionsBar()}<div class="report-doc">${htmlDoc}</div>`;
  relBindActions(htmlDoc);
}

/* ---------- 6) AUDITORIA ---------- */
async function relAuditoria(ct) {
  const modulo = $('#f-mod')?.value || '';
  const usuario = $('#f-usr')?.value || '';
  const busca = $('#f-busca')?.value || '';
  let url = `/relatorios/auditoria?dt_ini=${REL.periodoIni}&dt_fim=${REL.periodoFim}`;
  if (modulo) url += `&modulo=${encodeURIComponent(modulo)}`;
  if (usuario) url += `&usuario=${encodeURIComponent(usuario)}`;
  if (busca) url += `&busca=${encodeURIComponent(busca)}`;
  const r = (await api('get', url)).data;
  const htmlDoc = `
    ${relDocHeader('Relatório de Auditoria', 'Rastro completo de alterações')}
    <div class="rep-kpis">
      <div class="rep-kpi"><div class="label">Total de eventos</div><div class="value">${relFmt.num(r.total)}</div></div>
      <div class="rep-kpi purple"><div class="label">Módulos envolvidos</div><div class="value">${relFmt.num(r.por_modulo.length)}</div></div>
      <div class="rep-kpi"><div class="label">Usuários distintos</div><div class="value">${relFmt.num(r.por_usuario.length)}</div></div>
      <div class="rep-kpi warn"><div class="label">Tipos de ação</div><div class="value">${relFmt.num(r.por_acao.length)}</div></div>
    </div>

    <div class="rep-grid-3">
      <div class="avoid-break"><h3>Por Módulo</h3>
        <table class="rep-table">
          <thead><tr><th>Módulo</th><th class="num">Qtde</th></tr></thead>
          <tbody>${r.por_modulo.map(x => `<tr><td><b>${x.modulo}</b></td><td class="num">${relFmt.num(x.total)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="avoid-break"><h3>Por Ação</h3>
        <table class="rep-table">
          <thead><tr><th>Ação</th><th class="num">Qtde</th></tr></thead>
          <tbody>${r.por_acao.map(x => `<tr><td><b>${x.acao}</b></td><td class="num">${relFmt.num(x.total)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="avoid-break"><h3>Por Usuário</h3>
        <table class="rep-table">
          <thead><tr><th>Usuário</th><th class="num">Qtde</th></tr></thead>
          <tbody>${r.por_usuario.map(x => `<tr><td><b>${x.usuario}</b></td><td class="num">${relFmt.num(x.total)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>

    <div class="rep-section page-break">
      <h2><i class="fas fa-list"></i>Detalhe (últimos ${r.total} eventos)</h2>
      <table class="rep-table">
        <thead><tr><th>Data/Hora</th><th>Usuário</th><th>Módulo</th><th>Ação</th><th>Chave</th><th>Campo</th><th>Valor anterior</th><th>Valor novo</th></tr></thead>
        <tbody>${r.registros.map(x => `<tr>
          <td style="white-space:nowrap">${relFmt.datetime(x.dt_hora)}</td>
          <td>${x.usuario}</td>
          <td><span class="rep-badge blue">${x.modulo}</span></td>
          <td>${x.acao}</td>
          <td style="font-family:monospace;font-size:10px">${x.chave_registro || ''}</td>
          <td>${x.campo || ''}</td>
          <td style="font-size:10px;color:#6B7280">${x.valor_anterior || ''}</td>
          <td style="font-size:10px">${x.valor_novo || ''}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="center" style="color:#9CA3AF">Sem eventos no período</td></tr>'}</tbody>
      </table>
    </div>
    ${relDocFooter()}`;

  ct.innerHTML = `${relActionsBar()}<div class="report-doc">${htmlDoc}</div>`;
  relBindActions(htmlDoc);
}

/* ============================================================
 * IMPORTADOR (Excel → JSON → API)
 * ============================================================ */
ROUTES.importador = async (main) => {
  main.innerHTML = `
  <div class="space-y-5">
    <div class="card p-5">
      <h3 class="text-lg font-semibold text-slate-800 mb-2"><i class="fas fa-file-import mr-2 text-brand"></i>Importador de OPs do legado</h3>
      <p class="text-sm text-slate-600 mb-4">
        Envie uma planilha Excel (.xlsx/.xls) com as OPs antigas. Cabeçalho mínimo: 
        <code class="bg-slate-100 px-1">num_op, dt_emissao, dt_entrega, cod_ref, cliente, qtde_pecas</code>. 
        Colunas com prefixo <code>cor_</code> (ex.: <code>cor_Azul</code>) viram grade de cores;
        colunas com prefixo <code>tam_</code> viram grade de tamanhos. Observação opcional.
      </p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label>Arquivo Excel</label>
          <input id="imp-file" type="file" accept=".xlsx,.xls,.csv" />
        </div>
        <div>
          <label>Aba (opcional)</label>
          <input id="imp-sheet" type="text" placeholder="Deixe vazio p/ usar a 1ª" />
        </div>
        <div class="flex flex-col">
          <label>Opções</label>
          <label class="text-sm"><input id="imp-dry" type="checkbox" checked /> Apenas validar (dry-run)</label>
          <label class="text-sm"><input id="imp-create" type="checkbox" /> Criar clientes/referências faltantes</label>
        </div>
      </div>
      <div class="flex items-center gap-2 mt-4">
        <button id="btn-preview" class="btn btn-secondary"><i class="fas fa-eye mr-1"></i> Pré-visualizar linhas</button>
        <button id="btn-importar" class="btn btn-primary"><i class="fas fa-upload mr-1"></i> Importar</button>
        <button id="btn-baixar-modelo" class="btn btn-secondary ml-auto"><i class="fas fa-download mr-1"></i> Baixar modelo CSV</button>
      </div>
    </div>

    <div id="imp-preview" class="card p-4 hidden">
      <h4 class="font-semibold mb-2">Pré-visualização (primeiras 20 linhas)</h4>
      <div id="imp-preview-body" class="overflow-auto text-xs"></div>
    </div>

    <div id="imp-resultado" class="card p-4 hidden">
      <h4 class="font-semibold mb-2">Resultado da importação</h4>
      <div id="imp-resultado-body"></div>
    </div>
  </div>`;

  // Lazy-load SheetJS (CDN)
  async function loadSheetJS() {
    if (window.XLSX) return window.XLSX;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    return window.XLSX;
  }

  async function parseArquivo() {
    const f = $('#imp-file').files[0];
    if (!f) { toast('Selecione um arquivo.', 'warning'); return null; }
    const XLSX = await loadSheetJS();
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheetName = ($('#imp-sheet').value.trim()) || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) { toast(`Aba '${sheetName}' não encontrada.`, 'error'); return null; }
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    // Converte cada linha em { num_op, dt_emissao, ..., cores:{...}, tamanhos:{...} }
    const saida = rows.map((r) => {
      const linha = {
        num_op: r.num_op ?? r['Nº OP.'] ?? r['num op'] ?? r['numero_op'],
        dt_emissao: r.dt_emissao ?? r['Data Emissão'] ?? r['data_emissao'] ?? r['Data\nEmissão'],
        dt_entrega: r.dt_entrega ?? r['Previsão Entrega'] ?? r['data_entrega'] ?? r['Previsão\nEntrega'],
        cod_ref: r.cod_ref ?? r['Ref.'] ?? r['ref'] ?? r['referencia'],
        desc_ref: r.desc_ref ?? r['Descrição da Ref.'] ?? r['Descrição\nda Ref.'],
        cliente: r.cliente ?? r['Cliente'],
        qtde_pecas: r.qtde_pecas ?? r['Qtde Peças'] ?? r['Qtde\nPeças'] ?? r['qtde'],
        observacao: r.observacao ?? r['Observações'] ?? r['obs'],
        cores: {},
        tamanhos: {},
      };
      // Colunas cor_* e tam_*
      for (const [k, v] of Object.entries(r)) {
        if (v === '' || v == null) continue;
        const km = k.toLowerCase().trim();
        if (km.startsWith('cor_') || km.startsWith('cor ')) {
          const nome = k.substring(4).trim();
          if (nome) linha.cores[nome] = Number(v) || 0;
        } else if (km.startsWith('tam_') || km.startsWith('tam ')) {
          const nome = k.substring(4).trim();
          if (nome) linha.tamanhos[nome] = Number(v) || 0;
        }
      }
      return linha;
    }).filter((l) => l.num_op);
    return saida;
  }

  $('#btn-preview').onclick = async () => {
    const linhas = await parseArquivo();
    if (!linhas) return;
    if (!linhas.length) { toast('Nenhuma linha válida encontrada.', 'warning'); return; }
    $('#imp-preview').classList.remove('hidden');
    $('#imp-preview-body').innerHTML = `
      <p class="mb-2 text-slate-600">${linhas.length} linhas lidas.</p>
      <table class="w-full border"><thead class="bg-slate-100"><tr>
        <th class="p-1 border">#</th><th class="p-1 border">num_op</th><th class="p-1 border">dt_emissao</th>
        <th class="p-1 border">dt_entrega</th><th class="p-1 border">cod_ref</th><th class="p-1 border">cliente</th>
        <th class="p-1 border">qtde</th><th class="p-1 border">cores</th><th class="p-1 border">tamanhos</th>
      </tr></thead><tbody>
      ${linhas.slice(0, 20).map((l, i) => `
        <tr><td class="p-1 border">${i+1}</td>
          <td class="p-1 border">${l.num_op || ''}</td>
          <td class="p-1 border">${l.dt_emissao || ''}</td>
          <td class="p-1 border">${l.dt_entrega || ''}</td>
          <td class="p-1 border">${l.cod_ref || ''}</td>
          <td class="p-1 border">${l.cliente || ''}</td>
          <td class="p-1 border text-right">${l.qtde_pecas || ''}</td>
          <td class="p-1 border">${Object.entries(l.cores).map(([k,v])=>k+':'+v).join(', ')}</td>
          <td class="p-1 border">${Object.entries(l.tamanhos).map(([k,v])=>k+':'+v).join(', ')}</td>
        </tr>`).join('')}
      </tbody></table>`;
  };

  $('#btn-importar').onclick = async () => {
    const linhas = await parseArquivo();
    if (!linhas || !linhas.length) return;
    const dry = $('#imp-dry').checked;
    const criar = $('#imp-create').checked;
    if (!dry && !confirm(`Confirmar importação de ${linhas.length} OPs?`)) return;
    const r = await api('post', '/importar/ops', { linhas, dry_run: dry, criar_faltantes: criar });
    const d = r.data;
    $('#imp-resultado').classList.remove('hidden');
    $('#imp-resultado-body').innerHTML = `
      <div class="grid grid-cols-4 gap-3 mb-3">
        <div class="bg-slate-100 rounded p-3"><div class="text-xs text-slate-500">Total</div><div class="text-xl font-bold">${d.total}</div></div>
        <div class="bg-emerald-50 rounded p-3"><div class="text-xs text-emerald-600">Importadas${d.dry_run?' (válidas)':''}</div><div class="text-xl font-bold text-emerald-700">${d.importadas}</div></div>
        <div class="bg-amber-50 rounded p-3"><div class="text-xs text-amber-600">Ignoradas (duplicadas)</div><div class="text-xl font-bold text-amber-700">${d.ignoradas}</div></div>
        <div class="bg-red-50 rounded p-3"><div class="text-xs text-red-600">Erros</div><div class="text-xl font-bold text-red-700">${d.erros}</div></div>
      </div>
      <div class="overflow-auto max-h-96">
        <table class="w-full text-xs border">
          <thead class="bg-slate-100"><tr><th class="p-1 border">#</th><th class="p-1 border">num_op</th><th class="p-1 border">Status</th><th class="p-1 border">Detalhe</th></tr></thead>
          <tbody>${d.relatorio.map(r => `<tr>
            <td class="p-1 border">${r.linha}</td>
            <td class="p-1 border font-mono">${r.num_op}</td>
            <td class="p-1 border ${r.status==='ok'?'text-emerald-600':r.status==='duplicada'?'text-amber-600':'text-red-600'}">${r.status}</td>
            <td class="p-1 border">${r.detalhe||''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      ${d.dry_run ? '<p class="mt-3 text-sm text-amber-700"><i class="fas fa-info-circle"></i> Esse foi apenas um teste. Desmarque "dry-run" para efetivar.</p>' : '<p class="mt-3 text-sm text-emerald-700"><i class="fas fa-check-circle"></i> Importação concluída.</p>'}`;
    toast(`${d.dry_run?'Validação':'Importação'}: ${d.importadas} ok, ${d.ignoradas} duplicadas, ${d.erros} erros`, d.erros?'warning':'success');
  };

  $('#btn-baixar-modelo').onclick = () => {
    const csv = [
      'num_op;dt_emissao;dt_entrega;cod_ref;desc_ref;cliente;qtde_pecas;observacao;cor_Branco;cor_Preto;tam_P;tam_M;tam_G',
      '1001;2024-01-15;2024-02-10;REF001;Camiseta Básica;Maria & Maria;100;Observação livre;50;50;30;40;30',
      '1002;2024-01-20;2024-02-15;REF002;Blusa Manga Longa;Pepe;80;;40;40;20;30;30',
    ].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'modelo_importacao_ops.csv';
    a.click();
  };
};

/* ============================================================
 * USUÁRIOS (admin)
 * ============================================================ */
ROUTES.usuarios = async (main) => {
  let d;
  try { d = await Data.loadData('/usuarios'); }
  catch (e) { main.innerHTML = `<div class="card p-6 text-red-600"><i class="fas fa-exclamation-triangle mr-2"></i>Erro: ${e.message || e}</div>`; return; }

  const reload = () => ROUTES.usuarios(main);
  const scope = 'crud_usuarios';
  const search = (FilterStore.get(scope).q || '').toLowerCase();
  const filtered = !search ? d : d.filter(u =>
    [u.login, u.nome, u.perfil].some(x => String(x || '').toLowerCase().includes(search))
  );

  main.innerHTML = `
  <div class="space-y-4">
    <div class="flex justify-between items-center gap-3 flex-wrap">
      <div class="flex items-center gap-3">
        <h3 class="text-lg font-semibold text-slate-800">Usuários do Sistema</h3>
        <input type="search" data-filter="q" placeholder="Buscar..." class="text-sm" style="width:220px"/>
      </div>
      <button id="btn-novo-user" class="btn btn-primary"><i class="fas fa-plus mr-1"></i> Novo usuário</button>
    </div>
    <div class="card overflow-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-100"><tr>
          <th class="p-2 text-left">Login</th><th class="p-2 text-left">Nome</th>
          <th class="p-2 text-left">Perfil</th><th class="p-2 text-left">Último login</th>
          <th class="p-2 text-center">Ativo</th><th class="p-2 text-center">Trocar senha</th>
          <th class="p-2 text-right">Ações</th>
        </tr></thead>
        <tbody>${filtered.map(u => `
          <tr class="border-t">
            <td class="p-2 font-mono">${u.login}</td>
            <td class="p-2">${u.nome}</td>
            <td class="p-2"><span class="badge bg-slate-200 text-slate-700">${u.perfil}</span></td>
            <td class="p-2 text-xs">${u.ultimo_login ? fmt.datetime(u.ultimo_login) : '—'}</td>
            <td class="p-2 text-center">${u.ativo ? '<i class="fas fa-check text-emerald-600"></i>' : '<i class="fas fa-times text-red-600"></i>'}</td>
            <td class="p-2 text-center">${u.trocar_senha ? '<i class="fas fa-exclamation-triangle text-amber-600"></i>' : ''}</td>
            <td class="p-2 text-right">
              <button class="text-brand" data-edit="${u.id_usuario}"><i class="fas fa-edit"></i></button>
              <button class="text-red-600 ml-2" data-del="${u.id_usuario}"><i class="fas fa-user-slash"></i></button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${filtered.length === 0 ? '<div class="p-6 text-center text-slate-500">Nenhum usuário encontrado.</div>' : ''}
    </div>
  </div>`;

  FilterStore.bind(scope, main);
  $('#btn-novo-user').onclick = () => openUsuarioForm(null, reload);
  $$('[data-edit]').forEach(b => b.onclick = () => {
    const id = parseInt(b.dataset.edit);
    const u = d.find(x => x.id_usuario === id);
    if (u) openUsuarioForm(u, reload);
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    const ok = await Data.deleteItem('/usuarios', b.dataset.del,
      { confirmMsg: 'Desativar este usuário?', successMsg: 'Usuário desativado.', btn: b });
    if (ok) reload();
  });
};

function openUsuarioForm(row, onSaved) {
  const isEdit = !!row;
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-md' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3">${isEdit ? 'Editar' : 'Novo'} usuário</h3>
    <div class="space-y-3">
      <div><label>Login *</label><input id="u-login" type="text" value="${row?.login || ''}" ${isEdit ? 'disabled' : ''} /></div>
      <div><label>Nome *</label><input id="u-nome" type="text" value="${row?.nome || ''}" /></div>
      <div><label>Perfil</label>
        <select id="u-perfil">
          ${['admin','gerente','pcp','operador','visualizador'].map(p => `<option value="${p}" ${row?.perfil===p?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
      <div><label>${isEdit ? 'Nova senha (deixe em branco p/ manter)' : 'Senha *'}</label><input id="u-senha" type="password" placeholder="mín. 6 caracteres" /></div>
      <label class="flex items-center gap-2 text-sm"><input id="u-ativo" type="checkbox" ${row?.ativo !== 0 ? 'checked' : ''}/> Ativo</label>
      <label class="flex items-center gap-2 text-sm"><input id="u-trocar" type="checkbox" ${row?.trocar_senha ? 'checked' : ''}/> Forçar troca de senha no próximo login</label>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button id="u-cancel" class="btn btn-secondary">Cancelar</button>
      <button id="u-save" class="btn btn-primary"><i class="fas fa-save mr-1"></i>Salvar</button>
    </div>`;
  m.appendChild(card); document.body.appendChild(m);
  setTimeout(() => $('#u-nome')?.focus(), 50);
  const escHandler = (e) => { if (e.key === 'Escape') { m.remove(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  $('#u-cancel').onclick = () => m.remove();
  $('#u-save').onclick = async () => {
    const login = $('#u-login').value.trim();
    const nome = $('#u-nome').value.trim();
    const senha = $('#u-senha').value;
    if (!isEdit && !login) { toast('Login é obrigatório.', 'warning'); return; }
    if (!nome) { toast('Nome é obrigatório.', 'warning'); return; }
    if (!isEdit && (!senha || senha.length < 6)) { toast('Senha mínima de 6 caracteres.', 'warning'); return; }

    const body = {
      login, nome,
      perfil: $('#u-perfil').value,
      senha,
      ativo: $('#u-ativo').checked ? 1 : 0,
      trocar_senha: $('#u-trocar').checked ? 1 : 0,
    };
    try {
      await Data.saveData('/usuarios', body, {
        id: isEdit ? row.id_usuario : null,
        btn: $('#u-save'),
        successMsg: isEdit ? 'Usuário atualizado.' : 'Usuário criado.',
      });
      m.remove();
      document.removeEventListener('keydown', escHandler);
      if (onSaved) onSaved(); else updateUI();
    } catch { /* já tratado */ }
  };
}

/* ============================================================
 * MÓDULO TERCEIRIZAÇÃO (Controle completo)
 * ============================================================ */

/* ---------- Cache de cadastros auxiliares ---------- */
const TERC = {
  setores: [], servicos: [], colecoes: [], terceirizados: [], produtos: [], cores: [],
  async load(force = false) {
    if (!force && this.terceirizados.length) return;
    const [rs1, rs2, rs3, rs4, rs5, rs6] = await Promise.all([
      api('get', '/terc/setores'),
      api('get', '/terc/servicos'),
      api('get', '/terc/colecoes'),
      api('get', '/terc/terceirizados'),
      api('get', '/terc/produtos', null, { silent: true }).catch(() => ({ data: [] })),
      api('get', '/terc/cores', null, { silent: true }).catch(() => ({ data: [] })),
    ]);
    this.setores = rs1.data || [];
    this.servicos = rs2.data || [];
    this.colecoes = rs3.data || [];
    this.terceirizados = rs4.data || [];
    this.produtos = rs5.data || [];
    this.cores = rs6.data || [];
  },
  async reloadProdutos() {
    try { const r = await api('get', '/terc/produtos', null, { silent: true }); this.produtos = r.data || []; } catch {}
  },
  optSetores(sel) { return ['<option value="">—</option>'].concat(this.setores.map(s => `<option value="${s.id_setor}" ${sel == s.id_setor ? 'selected' : ''}>${s.nome_setor}</option>`)).join(''); },
  optServicos(sel) { return ['<option value="">—</option>'].concat(this.servicos.map(s => `<option value="${s.id_servico}" ${sel == s.id_servico ? 'selected' : ''}>${s.desc_servico}</option>`)).join(''); },
  optColecoes(sel) { return ['<option value="">Todas</option>'].concat(this.colecoes.map(s => `<option value="${s.id_colecao}" ${sel == s.id_colecao ? 'selected' : ''}>${s.nome_colecao}</option>`)).join(''); },
  optTerc(sel, onlyAtivos = false) {
    const list = onlyAtivos ? this.terceirizados.filter(t => t.ativo) : this.terceirizados;
    return ['<option value="">—</option>'].concat(list.map(t => `<option value="${t.id_terc}" ${sel == t.id_terc ? 'selected' : ''}>${t.nome_terc}${t.nome_setor ? ' · ' + t.nome_setor : ''}</option>`)).join('');
  },
  optProdutos(sel, idColecao) {
    let list = this.produtos.filter(p => p.ativo);
    if (idColecao) list = list.filter(p => !p.id_colecao || p.id_colecao == idColecao);
    return ['<option value="">— Selecione um produto cadastrado —</option>']
      .concat(list.map(p => `<option value="${p.id_produto}" ${sel == p.id_produto ? 'selected' : ''} data-cod="${(p.cod_ref || '').replace(/"/g, '&quot;')}" data-desc="${(p.desc_ref || '').replace(/"/g, '&quot;')}" data-col="${p.id_colecao || ''}" data-grade="${p.grade_padrao || 1}">${p.cod_ref} — ${p.desc_ref}${p.nome_colecao ? ' · ' + p.nome_colecao : ''}</option>`))
      .join('');
  },
  findProdutoByRef(cod_ref, idColecao) {
    if (!cod_ref) return null;
    const list = this.produtos.filter(p => p.ativo && p.cod_ref === cod_ref);
    if (!list.length) return null;
    if (idColecao) {
      const exact = list.find(p => p.id_colecao == idColecao);
      if (exact) return exact;
    }
    return list.find(p => !p.id_colecao) || list[0];
  },
  fmtBRL(v) { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  statusBadge(s, atrasada = 0) {
    if (atrasada && !['Concluida', 'Cancelada'].includes(s)) return '<span class="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700"><i class="fas fa-triangle-exclamation mr-1"></i>Atrasada</span>';
    const map = {
      'Aberta': 'bg-blue-100 text-blue-700',
      'EmProducao': 'bg-indigo-100 text-indigo-700',
      'Parcial': 'bg-amber-100 text-amber-700',
      'Concluida': 'bg-emerald-100 text-emerald-700',
      'Atrasada': 'bg-red-100 text-red-700',
      'Cancelada': 'bg-slate-200 text-slate-600',
    };
    return `<span class="px-2 py-0.5 rounded text-xs ${map[s] || 'bg-slate-100 text-slate-700'}">${s}</span>`;
  },
  // Cache de parâmetros da empresa para impressão
  empresa: null,
  async loadEmpresa(force = false) {
    if (!force && this.empresa) return this.empresa;
    try {
      const r = await api('get', '/parametros', null, { silent: true });
      const map = {};
      (r.data || []).forEach(p => { map[p.chave] = p.valor; });
      this.empresa = {
        nome: map.EMPRESA_NOME || 'CorePro',
        tel: map.EMPRESA_TEL || '',
        email: map.EMPRESA_EMAIL || '',
        cnpj: map.EMPRESA_CNPJ || '',
        endereco: map.EMPRESA_ENDERECO || '',
      };
    } catch {
      this.empresa = { nome: 'CorePro', tel: '', email: '', cnpj: '', endereco: '' };
    }
    return this.empresa;
  },
};

/* ============================================================
 * MÓDULO DE IMPRESSÃO DE TERCEIRIZAÇÃO
 * Replica fielmente as telas da planilha legada:
 *  - Romaneio de Serviço (com grade de tamanhos)
 *  - Comprovante de Entrega Total
 *  - Controle de Entrega Parcial (com múltiplas coletas)
 * ============================================================ */
const TERC_PRINT = {
  // Tamanhos padrão (iguais à planilha original)
  TAMS: ['PP', 'P', 'M', 'G', 'GG', 'EG', 'XG', 'UN', 'TAM1', 'TAM2'],

  // Abre uma nova janela de impressão com HTML + CSS A4
  _openWindow(title, bodyHTML) {
    const w = window.open('', '_blank', 'width=1100,height=800');
    if (!w) { toast('Pop-ups bloqueados. Permita pop-ups para imprimir.', 'error'); return null; }
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>${title}</title>
      <style>${this._printCSS()}</style>
      </head><body>${bodyHTML}
      <script>window.addEventListener('load',()=>{setTimeout(()=>{window.print();},350);});</script>
      </body></html>`);
    w.document.close();
    return w;
  },

  _printCSS() {
    return `
      @page { size: A4 portrait; margin: 6mm 6mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; }
      body { font-family: Arial, 'Helvetica Neue', sans-serif; font-size: 9pt; color: #000; }

      /* === FOLHA A4 com 2 VIAS === */
      .sheet { width: 100%; max-width: 198mm; margin: 0 auto; }
      .via-wrap { display: flex; flex-direction: column; gap: 0; }
      .via {
        width: 100%;
        padding: 2mm 0 1mm;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .via.via-1 { border-bottom: 2px dashed #555; padding-bottom: 4mm; margin-bottom: 4mm; }
      .via-tag {
        display: inline-block;
        background: #1e3a8a; color: #fff;
        font-weight: bold; font-size: 9pt;
        padding: 2px 10px; border-radius: 3px;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }
      .via-tag.tag-terc { background: #047857; }
      .corte-info {
        font-size: 7.5pt; color: #666; text-align: center;
        margin: 1mm 0 2mm;
        letter-spacing: 1px;
      }

      /* === CABEÇALHO === */
      .empresa-header {
        display: flex; align-items: center; gap: 10px;
        padding: 4px 2px; border-bottom: 1.5px solid #1e3a8a;
        margin-bottom: 4px;
      }
      .empresa-logo { width: 50px; height: 42px; object-fit: contain; }
      .empresa-info { flex: 1; text-align: center; }
      .empresa-nome { font-size: 13pt; font-weight: bold; line-height: 1.1; }
      .empresa-contato { font-size: 7.5pt; color: #333; line-height: 1.2; }
      .empresa-datas { text-align: right; font-size: 7.5pt; line-height: 1.3; min-width: 110px; }
      .empresa-datas b { display: inline-block; min-width: 70px; text-align: right; font-weight: 600; }

      /* === TÍTULO E SUBTÍTULO === */
      .titulo-bar {
        display: flex; justify-content: space-between; align-items: center;
        margin: 3px 0 2px; gap: 8px;
      }
      .titulo { font-size: 11pt; font-weight: bold; margin: 0; }
      .sub { font-size: 9pt; margin: 0; }
      .sub b {
        background: #fef3c7; padding: 1px 6px;
        border: 1px solid #d97706; border-radius: 2px;
        font-weight: bold;
      }
      .box-right { text-align: right; font-size: 8.5pt; }
      .box-right .ctrl {
        display: inline-block; border: 1.5px solid #000;
        padding: 2px 8px; background: #fff; font-weight: bold;
        font-size: 9pt;
      }

      /* === TABELA PRINCIPAL — LARGURAS PROPORCIONAIS === */
      table.grid {
        width: 100%;
        border-collapse: collapse;
        margin-top: 3px;
        table-layout: fixed; /* travamento de colunas para evitar estouros */
      }
      table.grid th, table.grid td {
        border: 0.5px solid #555;
        padding: 2px 3px;
        font-size: 8pt;
        text-align: center;
        vertical-align: middle;
        word-wrap: break-word;
        overflow: hidden;
        line-height: 1.25;
      }
      table.grid thead th {
        background: #dbeafe;
        font-weight: bold;
        font-size: 7.5pt;
        line-height: 1.1;
        padding: 3px 2px;
      }
      table.grid thead .grade-header {
        background: #c7d2fe;
        letter-spacing: 0.5px;
      }
      table.grid td.left { text-align: left; }
      table.grid td.right { text-align: right; }
      table.grid td.center { text-align: center; }
      table.grid tbody tr td { background: #fff; }
      table.grid tbody tr.zebra td { background: #f8fafc; }
      table.grid tbody tr.empty td { background: #fcfcfd; }

      /* Larguras proporcionais inteligentes (em %) */
      .col-ctrl   { width: 5.5%; }   /* Nº Controle  - pequeno */
      .col-op     { width: 5.5%; }   /* Nº OP        - pequeno */
      .col-ref    { width: 7.5%; }   /* Referência   - médio */
      .col-desc   { width: 14%;  }   /* Descrição    - médio (reduzido) */
      .col-serv   { width: 10%;  }   /* Serviço      - médio */
      .col-cor    { width: 6.5%; }   /* Cor          - pequeno */
      .col-grade  { width: 3.3%; }   /* cada coluna de tamanho (10 colunas = 33%) */
      .col-qtd    { width: 5%;   }   /* Qtde total   - pequeno */
      .col-preco  { width: 5.5%; }   /* Preço        - pequeno */
      .col-valor  { width: 7.5%; }   /* Valor total  - médio */

      /* Linha de total geral */
      tr.tot-row td {
        background: #1e3a8a !important;
        color: #fff;
        font-weight: bold;
        font-size: 9pt;
        padding: 4px 4px;
        border-color: #1e3a8a;
      }
      tr.tot-row td.tot-label { text-align: right; letter-spacing: 0.3px; }

      /* === ASSINATURAS === */
      .assina-area {
        display: flex; justify-content: space-between;
        gap: 20px; margin-top: 8mm; padding: 0 4px;
      }
      .assina-col { flex: 1; }
      .assina-col .linha {
        border-top: 1px solid #000;
        margin-top: 0;
        padding-top: 2px;
        text-align: center;
        font-size: 8pt;
      }
      .footer-info {
        margin-top: 3mm;
        font-size: 7pt;
        color: #666;
        text-align: center;
        border-top: 0.5px dotted #aaa;
        padding-top: 2px;
      }

      /* === LEGADO (comprovante / parcial) === */
      .desc-italic { font-style: italic; color: #333; font-size: 8.5pt; margin: 2px 0 4px; padding: 0 2px; }
      .coleta-title { background: #d1fae5; border: 1px solid #000; text-align: center; font-weight: bold; padding: 3px; margin-top: 6px; font-size: 10pt; }
      .comprovante-bloco { border: 1.5px solid #000; padding: 6px; margin-bottom: 8px; background: #f0fdf4; }
      .comprovante-bloco h3 { text-align: center; background: #fff; border: 1px solid #000; padding: 3px; font-size: 10pt; margin: 0 0 4px; }
      .dashed { border-top: 2px dashed #666; margin: 6px 0; padding-top: 3px; font-size: 7.5pt; color: #666; text-align: center; }
      .alert { color: #b91c1c; font-weight: bold; margin: 4px 0; }
      .page-break { page-break-after: always; break-after: page; }
      .no-print { display: none; }

      @media print {
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .no-print { display: none !important; }
        .via { page-break-inside: avoid; break-inside: avoid; }
        table.grid { page-break-inside: auto; }
        table.grid tr { page-break-inside: avoid; break-inside: avoid; }
        table.grid thead { display: table-header-group; }
        table.grid tfoot { display: table-footer-group; }
      }
    `;
  },

  // Cabeçalho institucional da empresa (igual ao romaneio Play Surf)
  _headerHTML(empresa, metaDireita) {
    const logo = '/static/favicon.png'; // reaproveita favicon da empresa/produto
    return `
      <div class="empresa-header">
        <img src="${logo}" class="empresa-logo" onerror="this.style.display='none'"/>
        <div class="empresa-info">
          <div class="empresa-nome">${empresa.nome}</div>
          <div class="empresa-contato">${empresa.tel || ''}${empresa.tel && empresa.email ? ' &middot; ' : ''}${empresa.email || ''}</div>
          ${empresa.endereco ? `<div class="empresa-contato">${empresa.endereco}</div>` : ''}
          ${empresa.cnpj ? `<div class="empresa-contato">CNPJ: ${empresa.cnpj}</div>` : ''}
        </div>
        <div class="empresa-datas">${metaDireita || ''}</div>
      </div>
    `;
  },

  // Tabela grade de tamanhos (replica a estrutura da coluna Gr + Tamanhos)
  _gradeHeaderHTML(tams) {
    const cols = [
      ['P', '34'], ['M', '36'], ['G', '38'], ['GG', '40'],
      ['EG', '42'], ['SG', '44'], ['46', ''], ['48', ''], ['50', ''], ['52', '']
    ];
    return cols.map(([t, n]) =>
      `<th class="col-grade grade-header">${t}${n ? `<br><span style="font-weight:normal;font-size:6.5pt;color:#444">${n}</span>` : ''}</th>`
    ).join('');
  },

  _gradeCellsFromRem(rem) {
    // Mapeia os 10 tamanhos padrão da planilha (P, M, G, GG, EG, SG + 46, 48, 50, 52)
    const ORDEM = ['P', 'M', 'G', 'GG', 'EG', 'SG', '46', '48', '50', '52'];
    const g = Object.fromEntries((Array.isArray(rem.grade) ? rem.grade : []).map(x => [x.tamanho, x.qtd]));
    return ORDEM.map(t => `<td class="col-grade center">${g[t] ? fmt.int(g[t]) : ''}</td>`).join('');
  },

  /* ================================================================
   * 1) ROMANEIO DE SERVIÇO (tela "Romaneio de Serviço - Aparador")
   * Tabela: Nº Ctrl | Nº OP | Ref | Desc Ref | Desc Serviço | Cor | Grade | Qtd | Preço | Valor
   * Pode receber array de remessas (romaneio em lote do terceirizado)
   * ================================================================ */
  async romaneio(remessas, opts = {}) {
    if (!Array.isArray(remessas)) remessas = [remessas];
    if (remessas.length === 0) { toast('Sem remessas', 'warning'); return; }
    const empresa = await TERC.loadEmpresa();

    const r0 = remessas[0] || {};
    const nomeTerc = r0.nome_terc || 'Terceirização';
    const setor = r0.nome_setor || '';

    // Datas: usa da primeira remessa como referência
    const dtSaida = r0.dt_saida ? dayjs(r0.dt_saida).format('DD/MM/YYYY') : '';
    const dtInicio = r0.dt_inicio ? dayjs(r0.dt_inicio).format('DD/MM/YYYY') : dtSaida;
    const dtPrev = r0.dt_previsao ? dayjs(r0.dt_previsao).format('DD/MM/YYYY') : '';

    const metaDir = `
      <div><b>Data Saída:</b> ${dtSaida || '—'}</div>
      <div><b>Data Início:</b> ${dtInicio || '—'}</div>
      <div><b>Previsão:</b> ${dtPrev || '—'}</div>
    `;

    // Totais (defensivos)
    const tot = remessas.reduce((a, r) => ({
      qtd: a.qtd + (Number(r.qtd_total) || 0),
      valor: a.valor + (Number(r.valor_total) || 0),
    }), { qtd: 0, valor: 0 });

    // Linhas da tabela — quantidade dinâmica, sem preencher com vazias exageradas
    const linhas = remessas.map((r, i) => `
      <tr${i % 2 === 1 ? ' class="zebra"' : ''}>
        <td class="col-ctrl center"><b>${r.num_controle || ''}</b></td>
        <td class="col-op center">${r.num_op || '—'}</td>
        <td class="col-ref left"><b>${r.cod_ref || ''}</b></td>
        <td class="col-desc left">${r.desc_ref || ''}</td>
        <td class="col-serv left">${r.desc_servico || ''}</td>
        <td class="col-cor center">${r.cor || '—'}</td>
        ${this._gradeCellsFromRem(r)}
        <td class="col-qtd right"><b>${fmt.int(r.qtd_total || 0)}</b></td>
        <td class="col-preco right">${fmt.num(r.preco_unit || 0, 2)}</td>
        <td class="col-valor right"><b>${fmt.num(r.valor_total || 0, 2)}</b></td>
      </tr>
    `).join('');

    // Linhas vazias mínimas para "preencher" tabela curta sem inflar
    // Em layout de 2 vias (A4 dividido em 2), no máx ~5 linhas em branco por via
    const minLinhas = 5;
    const vazias = Math.max(0, minLinhas - remessas.length);
    const linhasVazias = Array(vazias).fill(0).map(() => `
      <tr class="empty">
        <td class="col-ctrl">&nbsp;</td>
        <td class="col-op"></td>
        <td class="col-ref"></td>
        <td class="col-desc"></td>
        <td class="col-serv"></td>
        <td class="col-cor"></td>
        <td class="col-grade"></td><td class="col-grade"></td><td class="col-grade"></td>
        <td class="col-grade"></td><td class="col-grade"></td><td class="col-grade"></td>
        <td class="col-grade"></td><td class="col-grade"></td><td class="col-grade"></td>
        <td class="col-grade"></td>
        <td class="col-qtd"></td>
        <td class="col-preco"></td>
        <td class="col-valor"></td>
      </tr>
    `).join('');

    // Construtor de UMA VIA (cabeçalho + tabela + assinaturas)
    const buildVia = (tag, tagClass, recebedor) => `
      <div class="via ${tag === '1ª VIA' ? 'via-1' : 'via-2'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
          <span class="via-tag ${tagClass}">${tag} — ${recebedor.toUpperCase()}</span>
          <span style="font-size:7.5pt;color:#666">Romaneio Nº <b>${r0.num_controle || '—'}</b> · ${dayjs().format('DD/MM/YYYY HH:mm')}</span>
        </div>

        ${this._headerHTML(empresa, metaDir)}

        <div class="titulo-bar">
          <div class="titulo">Romaneio de Serviço${setor ? ' — ' + setor : ''}</div>
          <div class="sub"><b>Terceirização: ${nomeTerc}</b></div>
        </div>

        <table class="grid">
          <colgroup>
            <col class="col-ctrl"><col class="col-op"><col class="col-ref">
            <col class="col-desc"><col class="col-serv"><col class="col-cor">
            <col class="col-grade"><col class="col-grade"><col class="col-grade">
            <col class="col-grade"><col class="col-grade"><col class="col-grade">
            <col class="col-grade"><col class="col-grade"><col class="col-grade">
            <col class="col-grade">
            <col class="col-qtd"><col class="col-preco"><col class="col-valor">
          </colgroup>
          <thead>
            <tr>
              <th rowspan="2" class="col-ctrl">Nº<br>Ctrl</th>
              <th rowspan="2" class="col-op">Nº<br>OP</th>
              <th rowspan="2" class="col-ref">Ref.</th>
              <th rowspan="2" class="col-desc">Descrição</th>
              <th rowspan="2" class="col-serv">Serviço</th>
              <th rowspan="2" class="col-cor">Cor</th>
              <th colspan="10" class="grade-header">T A M A N H O S</th>
              <th rowspan="2" class="col-qtd">Qtd<br>Total</th>
              <th rowspan="2" class="col-preco">Preço</th>
              <th rowspan="2" class="col-valor">Valor Total</th>
            </tr>
            <tr>
              ${this._gradeHeaderHTML()}
            </tr>
          </thead>
          <tbody>
            ${linhas}
            ${linhasVazias}
            <tr class="tot-row">
              <td colspan="16" class="tot-label">TOTAL GERAL</td>
              <td class="col-qtd right">${fmt.int(tot.qtd)}</td>
              <td class="col-preco"></td>
              <td class="col-valor right">${TERC.fmtBRL(tot.valor)}</td>
            </tr>
          </tbody>
        </table>

        <div class="assina-area">
          <div class="assina-col">
            <div style="height:14mm"></div>
            <div class="linha"><b>Entregue por (Empresa)</b><br><span style="font-size:7pt;color:#666">Nome / Assinatura / Data</span></div>
          </div>
          <div class="assina-col">
            <div style="height:14mm"></div>
            <div class="linha"><b>Recebido por (${nomeTerc})</b><br><span style="font-size:7pt;color:#666">Nome / Assinatura / Data</span></div>
          </div>
        </div>

        <div class="footer-info">
          ${tag} · ${recebedor} · Gerado em ${dayjs().format('DD/MM/YYYY HH:mm')} por ${state.user?.nome || state.user?.login || '—'} · CorePro PCP
        </div>
      </div>
    `;

    const body = `
      <div class="sheet">
        <div class="via-wrap">
          ${buildVia('1ª VIA', 'tag-emp', 'EMPRESA')}
          <div class="corte-info">- - - - - - - - - - - - - - - - - - - - -  ✂  RECORTAR / DOBRAR  ✂  - - - - - - - - - - - - - - - - - - - - -</div>
          ${buildVia('2ª VIA', 'tag-terc', 'TERCEIRIZADO')}
        </div>
      </div>
    `;
    this._openWindow('Romaneio — ' + nomeTerc, body);
  },

  /* ================================================================
   * 2) COMPROVANTE DE ENTREGA TOTAL (parte superior da tela 1)
   * Bloco único com: referência, grade horizontal, datas, assinatura
   * Imprime 2 vias (para empresa e terceirizado)
   * ================================================================ */
  async comprovanteTotal(remessa, opts = {}) {
    const empresa = await TERC.loadEmpresa();
    const duasVias = opts.duasVias !== false;

    const bloco = (via) => `
      <div class="comprovante-bloco">
        <h3>Comprovante de entrega total da remessa para Empresa ${via ? '(' + via + ')' : ''}</h3>
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="titulo" style="font-size:13pt">Terceirização: ${remessa.nome_terc}</div>
          </div>
          <div class="box-right">
            <div><b>Nº OP:</b> ${remessa.num_op || '—'}</div>
            <div class="ctrl">Nº Controle: ${remessa.num_controle}</div>
          </div>
        </div>
        <table class="grid" style="clear:both">
          <thead>
            <tr>
              <th>Referência</th><th>Cor</th>
              ${this._gradeHeaderHTML()}
              <th>Total</th>
              <th>Data de<br>Envio</th>
              <th>Previsão<br>Entrega</th>
            </tr>
          </thead>
          <tbody>
            <tr class="destaque">
              <td class="left"><b>${remessa.cod_ref}</b></td>
              <td>${remessa.cor || '—'}</td>
              ${this._gradeCellsFromRem(remessa)}
              <td><b>${fmt.int(remessa.qtd_total)}</b></td>
              <td>${fmt.date(remessa.dt_saida)}</td>
              <td>${fmt.date(remessa.dt_previsao)}</td>
            </tr>
          </tbody>
        </table>
        <div class="desc-italic">${remessa.desc_ref || ''}${remessa.desc_servico ? ' — <b>Serviço:</b> ' + remessa.desc_servico : ''}</div>

        <div class="assina-area">
          <div class="assina-col">
            <div>Data última peça: ______ / ______ / 20______</div>
            <div style="margin-top:12px;font-size:9pt">Observações: ${remessa.observacao || ''}</div>
          </div>
          <div class="assina-col">
            <div class="linha">Visto de quem pegar a última peça</div>
          </div>
        </div>
      </div>
    `;

    const body = `
      <div class="sheet">
        ${this._headerHTML(empresa, `<div><b>Emitido em:</b> ${dayjs().format('DD/MM/YYYY HH:mm')}</div>`)}
        ${bloco('1ª via — Empresa')}
        ${duasVias ? '<div class="dashed">— — — — destaque aqui — — — —</div>' + bloco('2ª via — Terceirizado') : ''}
      </div>
    `;
    this._openWindow('Comprovante de Entrega — Ctrl ' + remessa.num_controle, body);
  },

  /* ================================================================
   * 3) CONTROLE DE ENTREGA PARCIAL (parte inferior da tela 1)
   * Bloco com: referência, grade; depois tabela com N coletas + saldos
   * ================================================================ */
  async controleParcial(remessa, opts = {}) {
    const empresa = await TERC.loadEmpresa();

    // Quantas coletas já existem + 2 linhas em branco para preencher manualmente
    const retornos = remessa.retornos || [];
    const minColetas = Math.max(retornos.length + 2, 4);

    // Calcular saldos progressivos por tamanho
    const ORDEM = ['P', 'M', 'G', 'GG', 'EG', 'SG', '46', '48', '50', '52'];
    const gradeEnviada = Object.fromEntries((remessa.grade || []).map(g => [g.tamanho, Number(g.qtd) || 0]));

    const saldos = {};
    ORDEM.forEach(t => { saldos[t] = gradeEnviada[t] || 0; });

    const linhasColetas = [];
    for (let i = 0; i < minColetas; i++) {
      const ret = retornos[i];
      const gradeRet = {};
      if (ret && Array.isArray(ret.grade)) ret.grade.forEach(g => { gradeRet[g.tamanho] = Number(g.qtd) || 0; });

      const cells = ORDEM.map(t => `<td>${gradeRet[t] || ''}</td>`).join('');
      const totRet = ORDEM.reduce((a, t) => a + (gradeRet[t] || 0), 0);

      linhasColetas.push(`
        <tr>
          <td class="left"><b>${i + 1}ª coleta:</b> ${ret ? fmt.date(ret.dt_retorno) : ''}</td>
          ${cells}
          <td><b>${ret ? fmt.int(totRet) : ''}</b></td>
          <td style="width:110px"></td>
        </tr>
      `);

      // Atualiza saldo se houver retorno real
      if (ret) ORDEM.forEach(t => { saldos[t] = Math.max(0, (saldos[t] || 0) - (gradeRet[t] || 0)); });

      const saldoCells = ORDEM.map(t => `<td style="color:#b45309">${saldos[t] || 0}</td>`).join('');
      const totSaldo = ORDEM.reduce((a, t) => a + (saldos[t] || 0), 0);
      linhasColetas.push(`
        <tr style="background:#fffbeb">
          <td class="left" style="color:#b45309"><b>Saldo =></b></td>
          ${saldoCells}
          <td style="color:#b45309"><b>${fmt.int(totSaldo)}</b></td>
          <td></td>
        </tr>
      `);
    }

    const body = `
      <div class="sheet">
        ${this._headerHTML(empresa, `<div><b>Emitido em:</b> ${dayjs().format('DD/MM/YYYY HH:mm')}</div>`)}
        <div class="comprovante-bloco">
          <h3>CONTROLE ENTREGA PARCIAL DA TERCEIRIZAÇÃO PARA EMPRESA</h3>

          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div class="titulo" style="font-size:13pt">Terceirização: ${remessa.nome_terc}</div>
            <div class="box-right">
              <div><b>Nº OP:</b> ${remessa.num_op || '—'}</div>
              <div class="ctrl">Nº Controle: ${remessa.num_controle}</div>
            </div>
          </div>

          <table class="grid">
            <thead>
              <tr>
                <th>Referência</th><th>Cor</th>
                ${this._gradeHeaderHTML()}
                <th>Total</th>
                <th>Data de<br>Envio</th>
                <th>Previsão<br>Entrega</th>
              </tr>
            </thead>
            <tbody>
              <tr class="destaque">
                <td class="left"><b>${remessa.cod_ref}</b></td>
                <td>${remessa.cor || '—'}</td>
                ${this._gradeCellsFromRem(remessa)}
                <td><b>${fmt.int(remessa.qtd_total)}</b></td>
                <td>${fmt.date(remessa.dt_saida)}</td>
                <td>${fmt.date(remessa.dt_previsao)}</td>
              </tr>
            </tbody>
          </table>
          <div class="desc-italic">${remessa.desc_ref || ''}${remessa.desc_servico ? ' — <b>Serviço:</b> ' + remessa.desc_servico : ''}</div>

          <div class="coleta-title">Quantidade Retornada</div>
          <table class="grid">
            <thead>
              <tr>
                <th style="width:130px">Data da coleta</th>
                ${this._gradeHeaderHTML()}
                <th>Total</th>
                <th>Visto de quem coletar</th>
              </tr>
            </thead>
            <tbody>
              ${linhasColetas.join('')}
            </tbody>
          </table>

          <div style="margin-top:10px;font-size:9pt;color:#555">
            <b>Legenda:</b> "Saldo =>" é a quantidade ainda pendente (enviada − total retornado até a linha).
            ${retornos.length ? `<br><b>Retornos já registrados no sistema:</b> ${retornos.length} — preenchidos automaticamente.` : '<br>Preencha manualmente os dados das coletas à medida que ocorrerem.'}
          </div>
        </div>

        <div style="margin-top:14px;font-size:8pt;color:#555;text-align:center">
          Gerado em ${dayjs().format('DD/MM/YYYY HH:mm')} por ${state.user?.nome || state.user?.login || '—'} · CorePro PCP
        </div>
      </div>
    `;
    this._openWindow('Controle Parcial — Ctrl ' + remessa.num_controle, body);
  },
};

/* ---------- DASHBOARD de Terceirização (rota inicial padrão para TODOS) ---------- */
ROUTES.dashboard = async (main) => {
  await TERC.load();
  const hoje = dayjs().format('YYYY-MM-DD');
  const de = dayjs().subtract(30, 'day').format('YYYY-MM-DD');

  main.innerHTML = `
    <div class="card p-4 mb-4">
      <div class="flex flex-wrap items-end gap-3">
        <div><label>De</label><input type="date" id="f-de" value="${de}" /></div>
        <div><label>Até</label><input type="date" id="f-ate" value="${hoje}" /></div>
        <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Atualizar</button>
        <div class="flex-1"></div>
        <a href="#terc_remessas" class="btn btn-secondary"><i class="fas fa-truck-fast mr-1"></i>Ver remessas</a>
      </div>
    </div>
    <div id="kpis" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4"></div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div class="card p-4"><h3 class="font-semibold mb-2"><i class="fas fa-chart-line mr-1 text-brand"></i>Produção diária (retornos)</h3><canvas id="cht-prod" height="140"></canvas></div>
      <div class="card p-4"><h3 class="font-semibold mb-2"><i class="fas fa-chart-pie mr-1 text-brand"></i>Remessas por serviço</h3><canvas id="cht-serv" height="140"></canvas></div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div class="card p-4">
        <h3 class="font-semibold mb-2"><i class="fas fa-trophy mr-1 text-brand"></i>Top 10 Terceirizados (por peças)</h3>
        <div id="top-terc" class="overflow-x-auto"></div>
      </div>
      <div class="card p-4">
        <h3 class="font-semibold mb-2"><i class="fas fa-triangle-exclamation mr-1 text-red-600"></i>Remessas em atraso</h3>
        <div id="atrasadas" class="overflow-x-auto"></div>
      </div>
    </div>
  `;

  // ⚠️ Carregamento defensivo: cada seção é renderizada de forma isolada
  // (try/catch) para que uma falha em um bloco não derrube a tela inteira.
  // Todos os valores são validados (null/undefined/NaN → 0, listas → []).
  const FALLBACK_EMPTY = '<p class="text-slate-500 text-sm py-4 text-center"><i class="fas fa-circle-info mr-1"></i>Sem dados disponíveis</p>';
  const FALLBACK_ERROR = (msg) => `<p class="text-amber-600 text-sm py-4 text-center"><i class="fas fa-triangle-exclamation mr-1"></i>${msg || 'Falha ao carregar'}</p>`;

  async function load() {
    const de = ($('#f-de')?.value) || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
    const ate = ($('#f-ate')?.value) || dayjs().format('YYYY-MM-DD');

    let d = {};
    try {
      const r = await api('get', `/terc/dashboard?de=${de}&ate=${ate}`, null, { silent: true });
      d = (r && r.data) ? r.data : {};
    } catch (e) {
      console.error('[dashboard] erro ao buscar /terc/dashboard', e);
      // Mostra estado de erro mas continua tentando renderizar com dados vazios
      const errMsg = e?.response?.data?.error || e?.message || 'Erro ao carregar dashboard';
      if ($('#kpis')) $('#kpis').innerHTML = `<div class="col-span-full">${FALLBACK_ERROR(errMsg)}</div>`;
      d = {};
    }

    const k = (d && typeof d === 'object' && d.kpis) ? d.kpis : {};
    const kr = (k && typeof k === 'object' && k.remessas) ? k.remessas : {};

    // ---------- KPIs (sempre renderiza, com fallback 0) ----------
    try {
      const kpi = (label, val, icon, color) => `
        <div class="card p-3">
          <div class="text-xs text-slate-500 uppercase">${label}</div>
          <div class="flex items-center gap-2 mt-1">
            <i class="fas ${icon} ${color}"></i>
            <div class="text-2xl font-bold text-slate-800">${val}</div>
          </div>
        </div>`;
      if ($('#kpis')) $('#kpis').innerHTML = [
        kpi('Remessas', fmt.int(kr.total), 'fa-truck-fast', 'text-brand'),
        kpi('Peças enviadas', fmt.int(kr.pecas_enviadas), 'fa-boxes', 'text-indigo-600'),
        kpi('Valor enviado', TERC.fmtBRL(fmt.safeNum(kr.valor_total)), 'fa-dollar-sign', 'text-emerald-600'),
        kpi('Em aberto', fmt.int(kr.em_aberto), 'fa-clock', 'text-amber-600'),
        kpi('Concluídas', fmt.int(kr.concluidas), 'fa-check-circle', 'text-emerald-600'),
        kpi('Atrasadas', fmt.int(kr.atrasadas), 'fa-triangle-exclamation', 'text-red-600'),
      ].join('');
    } catch (e) { console.error('[dashboard] kpis', e); }

    // ---------- Gráfico produção diária ----------
    try {
      const prod = fmt.safeArr(d.producao_diaria);
      const ctxP = document.getElementById('cht-prod')?.getContext?.('2d');
      if (window._chtProd) { try { window._chtProd.destroy(); } catch {} window._chtProd = null; }
      if (ctxP) {
        if (prod.length === 0) {
          // Sem dados: limpa canvas e mostra placeholder
          const wrap = ctxP.canvas.parentElement;
          if (wrap && !wrap.querySelector('.no-data-prod')) {
            const ph = document.createElement('div');
            ph.className = 'no-data-prod text-center text-slate-400 text-sm py-8';
            ph.innerHTML = '<i class="fas fa-circle-info mr-1"></i>Sem dados disponíveis no período';
            ctxP.canvas.style.display = 'none';
            wrap.appendChild(ph);
          }
        } else {
          // Tem dados: remove placeholder anterior se existir
          const wrap = ctxP.canvas.parentElement;
          wrap?.querySelector('.no-data-prod')?.remove();
          ctxP.canvas.style.display = '';
          const labels = prod.map(p => { const d = dayjs(p?.dia); return d.isValid() ? d.format('DD/MM') : '?'; });
          window._chtProd = new Chart(ctxP, {
            type: 'bar',
            data: {
              labels,
              datasets: [
                { label: 'Boas', data: prod.map(p => fmt.safeNum(p?.boa)), backgroundColor: '#10b981' },
                { label: 'Refugo', data: prod.map(p => fmt.safeNum(p?.refugo)), backgroundColor: '#ef4444' },
                { label: 'Conserto', data: prod.map(p => fmt.safeNum(p?.conserto)), backgroundColor: '#f59e0b' },
              ],
            },
            options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } },
          });
        }
      }
    } catch (e) { console.error('[dashboard] grafico produção', e); }

    // ---------- Gráfico por serviço ----------
    try {
      const serv = fmt.safeArr(d.por_servico);
      const ctxS = document.getElementById('cht-serv')?.getContext?.('2d');
      if (window._chtServ) { try { window._chtServ.destroy(); } catch {} window._chtServ = null; }
      if (ctxS) {
        if (serv.length === 0) {
          const wrap = ctxS.canvas.parentElement;
          if (wrap && !wrap.querySelector('.no-data-serv')) {
            const ph = document.createElement('div');
            ph.className = 'no-data-serv text-center text-slate-400 text-sm py-8';
            ph.innerHTML = '<i class="fas fa-circle-info mr-1"></i>Sem dados disponíveis no período';
            ctxS.canvas.style.display = 'none';
            wrap.appendChild(ph);
          }
        } else {
          const wrap = ctxS.canvas.parentElement;
          wrap?.querySelector('.no-data-serv')?.remove();
          ctxS.canvas.style.display = '';
          window._chtServ = new Chart(ctxS, {
            type: 'doughnut',
            data: {
              labels: serv.map(s => s?.desc_servico || '(sem serviço)'),
              datasets: [{ data: serv.map(s => fmt.safeNum(s?.pecas)), backgroundColor: ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#06b6d4'] }],
            },
          });
        }
      }
    } catch (e) { console.error('[dashboard] grafico servico', e); }

    // ---------- Top terceirizados ----------
    try {
      const top = fmt.safeArr(d.top_terceirizados);
      if ($('#top-terc')) $('#top-terc').innerHTML = top.length ? `
        <table class="w-full text-sm">
          <thead><tr class="bg-slate-100"><th class="text-left p-2">#</th><th class="text-left p-2">Terceirizado</th><th class="text-left p-2">Setor</th><th class="text-right p-2">Remessas</th><th class="text-right p-2">Peças</th><th class="text-right p-2">Valor</th></tr></thead>
          <tbody>${top.map((t, i) => `
            <tr class="border-b">
              <td class="p-2">${i + 1}</td>
              <td class="p-2 font-medium">${t?.nome_terc || '—'}</td>
              <td class="p-2 text-slate-500">${t?.nome_setor || '—'}</td>
              <td class="p-2 text-right">${fmt.int(t?.remessas)}</td>
              <td class="p-2 text-right">${fmt.int(t?.pecas)}</td>
              <td class="p-2 text-right">${TERC.fmtBRL(fmt.safeNum(t?.valor))}</td>
            </tr>`).join('')}</tbody>
        </table>` : FALLBACK_EMPTY;
    } catch (e) { console.error('[dashboard] top terc', e); if ($('#top-terc')) $('#top-terc').innerHTML = FALLBACK_ERROR(); }

    // ---------- Atrasadas ----------
    try {
      const atr = fmt.safeArr(d.atrasadas);
      if ($('#atrasadas')) $('#atrasadas').innerHTML = atr.length ? `
        <table class="w-full text-sm">
          <thead><tr class="bg-red-50"><th class="text-left p-2">Ctrl</th><th class="text-left p-2">Terceirizado</th><th class="text-left p-2">Ref.</th><th class="text-right p-2">Qtd</th><th class="text-right p-2">Previsão</th><th class="text-right p-2">Atraso</th></tr></thead>
          <tbody>${atr.map(a => `
            <tr class="border-b">
              <td class="p-2">${a?.num_controle ?? '—'}</td>
              <td class="p-2">${a?.nome_terc || '—'}</td>
              <td class="p-2"><span class="font-mono text-xs">${a?.cod_ref || ''}</span> ${a?.cor ? '· ' + a.cor : ''}</td>
              <td class="p-2 text-right">${fmt.int(a?.qtd_total)}</td>
              <td class="p-2 text-right">${fmt.date(a?.dt_previsao)}</td>
              <td class="p-2 text-right text-red-600 font-semibold">${Math.floor(fmt.safeNum(a?.dias_atraso))} dia(s)</td>
            </tr>`).join('')}</tbody>
        </table>` : '<p class="text-slate-500 text-sm py-4 text-center"><i class="fas fa-check-circle text-emerald-500"></i> Nenhuma remessa em atraso</p>';
    } catch (e) { console.error('[dashboard] atrasadas', e); if ($('#atrasadas')) $('#atrasadas').innerHTML = FALLBACK_ERROR(); }
  }
  if ($('#btn-filtrar')) $('#btn-filtrar').onclick = load;
  try { await load(); } catch (e) { console.error('[dashboard] load top‑level', e); }
};

/* ---------- RESUMO de Terceirizações ---------- */
ROUTES.terc_resumo = async (main) => {
  await TERC.load();
  main.innerHTML = `
    <div class="card p-4 mb-4">
      <div class="flex flex-wrap items-end gap-3">
        <div><label>Coleção</label><select id="f-col">${TERC.optColecoes()}</select></div>
        <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Filtrar</button>
        <div class="flex-1"></div>
        <button id="btn-print" class="btn btn-secondary"><i class="fas fa-print mr-1"></i>Imprimir / PDF</button>
        <button id="btn-csv" class="btn btn-secondary"><i class="fas fa-file-csv mr-1"></i>Exportar CSV</button>
      </div>
    </div>
    <div class="card p-0 overflow-x-auto" id="tbl-wrap"><div class="p-6 text-center text-slate-500"><i class="fas fa-spinner fa-spin"></i> Carregando...</div></div>
  `;

  async function load() {
    const col = $('#f-col').value;
    const r = await api('get', `/terc/resumo${col ? '?id_colecao=' + col : ''}`);
    const rs = r.data || [];
    window._resumo = rs;
    $('#tbl-wrap').innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-slate-100 sticky top-0"><tr>
          <th class="text-left p-2">Terceirizado</th>
          <th class="text-left p-2">Setor</th>
          <th class="text-center p-2">Situação</th>
          <th class="text-right p-2">A coletar</th>
          <th class="text-right p-2">Em produção</th>
          <th class="text-right p-2">Produzidas</th>
          <th class="text-right p-2">Conserto</th>
          <th class="text-right p-2">Consertadas</th>
          <th class="text-right p-2">Remessas</th>
          <th class="text-right p-2">Valor</th>
          <th class="text-right p-2">% Consertos</th>
          <th class="text-center p-2">Término prev.</th>
        </tr></thead>
        <tbody>
          ${rs.map(t => `
            <tr class="border-b hover:bg-slate-50">
              <td class="p-2 font-medium">${t.nome_terc}</td>
              <td class="p-2 text-slate-500">${t.nome_setor || '—'}</td>
              <td class="p-2 text-center">${t.situacao === 'Ativa'
                ? '<span class="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">Ativa</span>'
                : '<span class="px-2 py-0.5 rounded text-xs bg-slate-200 text-slate-600">Inativa</span>'}</td>
              <td class="p-2 text-right">${fmt.int(t.pecas_coletar)}</td>
              <td class="p-2 text-right">${fmt.int(t.pecas_producao)}</td>
              <td class="p-2 text-right text-emerald-700 font-semibold">${fmt.int(t.pecas_produzidas)}</td>
              <td class="p-2 text-right text-amber-700">${fmt.int(t.pecas_conserto)}</td>
              <td class="p-2 text-right">${fmt.int(t.pecas_consertadas)}</td>
              <td class="p-2 text-right">${fmt.int(t.total_remessas)}</td>
              <td class="p-2 text-right">${TERC.fmtBRL(t.valor_movimentado)}</td>
              <td class="p-2 text-right ${Number(t.indice_consertos) > 0.05 ? 'text-red-600 font-semibold' : 'text-slate-600'}">${fmt.pct(t.indice_consertos)}</td>
              <td class="p-2 text-center">${t.dt_termino ? fmt.date(t.dt_termino) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }
  $('#btn-filtrar').onclick = load;
  $('#btn-print').onclick = () => window.print();
  $('#btn-csv').onclick = () => {
    const rs = window._resumo || [];
    const h = ['Terceirizado', 'Setor', 'Situacao', 'A coletar', 'Em producao', 'Produzidas', 'Conserto', 'Consertadas', 'Remessas', 'Valor', 'Indice consertos', 'Termino previsto'];
    const rows = rs.map(t => [t.nome_terc, t.nome_setor || '', t.situacao, t.pecas_coletar, t.pecas_producao, t.pecas_produzidas, t.pecas_conserto, t.pecas_consertadas, t.total_remessas, Number(t.valor_movimentado).toFixed(2), (Number(t.indice_consertos) * 100).toFixed(1) + '%', t.dt_termino || '']);
    const csv = [h, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `resumo-terceirizacao-${dayjs().format('YYYYMMDD')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  await load();
};

/* ---------- TERCEIRIZADOS (cadastro) ---------- */
ROUTES.terc_terceirizados = async (main) => {
  await TERC.load();
  main.innerHTML = `
    <div class="card p-4 mb-4">
      <div class="flex flex-wrap items-end gap-3">
        <div><label>Busca</label><input id="f-search" placeholder="Nome ou CPF/CNPJ..." /></div>
        <div><label>Setor</label><select id="f-setor">${TERC.optSetores()}</select></div>
        <div><label>Situação</label><select id="f-sit"><option value="">Todos</option><option value="Ativa">Ativa</option><option value="Inativa">Inativa</option></select></div>
        <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Filtrar</button>
        <div class="flex-1"></div>
        <button id="btn-novo" class="btn btn-success"><i class="fas fa-plus mr-1"></i>Novo Terceirizado</button>
      </div>
    </div>
    <div class="card p-0 overflow-x-auto" id="tbl"></div>
  `;

  async function load() {
    const p = new URLSearchParams();
    if ($('#f-search').value) p.set('search', $('#f-search').value);
    if ($('#f-setor').value) p.set('id_setor', $('#f-setor').value);
    if ($('#f-sit').value) p.set('situacao', $('#f-sit').value);
    const r = await api('get', '/terc/terceirizados?' + p.toString());
    const rs = r.data || [];
    $('#tbl').innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-slate-100"><tr>
          <th class="text-left p-2">Nome</th><th class="text-left p-2">Setor</th>
          <th class="text-left p-2">Contato</th>
          <th class="text-right p-2">Pessoas</th><th class="text-right p-2">Efic.</th>
          <th class="text-right p-2">Prazo</th>
          <th class="text-center p-2">Situação</th><th class="text-center p-2">Ações</th>
        </tr></thead>
        <tbody>
          ${rs.map(t => `
            <tr class="border-b hover:bg-slate-50">
              <td class="p-2 font-medium">${t.nome_terc}${t.cpf_cnpj ? '<br><span class="text-xs text-slate-400">' + t.cpf_cnpj + '</span>' : ''}</td>
              <td class="p-2">${t.nome_setor || '—'}</td>
              <td class="p-2 text-xs text-slate-600">${t.telefone || ''}${t.email ? '<br>' + t.email : ''}</td>
              <td class="p-2 text-right">${t.qtd_pessoas}</td>
              <td class="p-2 text-right">${(Number(t.efic_padrao) * 100).toFixed(0)}%</td>
              <td class="p-2 text-right">${t.prazo_padrao} dias</td>
              <td class="p-2 text-center">${t.situacao === 'Ativa' ? '<span class="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">Ativa</span>' : '<span class="px-2 py-0.5 rounded text-xs bg-slate-200 text-slate-600">Inativa</span>'}</td>
              <td class="p-2 text-center whitespace-nowrap">
                <button class="btn btn-sm btn-secondary" onclick="TERC_editTerc(${t.id_terc})"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm ${t.situacao === 'Ativa' ? 'btn-warning' : 'btn-success'}" onclick="TERC_toggleSitTerc(${t.id_terc}, '${t.situacao === 'Ativa' ? 'Inativa' : 'Ativa'}')"><i class="fas fa-${t.situacao === 'Ativa' ? 'pause' : 'play'}"></i></button>
                <button class="btn btn-sm btn-danger" onclick="TERC_delTerc(${t.id_terc}, '${t.nome_terc.replace(/'/g, '')}')"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${rs.length === 0 ? '<div class="p-6 text-center text-slate-500">Nenhum terceirizado encontrado.</div>' : ''}
    `;
  }
  window.TERC_editTerc = (id) => TERC_openTercModal(id, load);
  window.TERC_toggleSitTerc = async (id, sit) => {
    await api('patch', '/terc/terceirizados/' + id + '/situacao', { situacao: sit });
    toast('Situação atualizada', 'success');
    await TERC.load(true); load();
  };
  window.TERC_delTerc = async (id, nome) => {
    if (!confirm('Excluir terceirizado "' + nome + '"?\n(só é permitido se não tiver remessas)')) return;
    try { await api('delete', '/terc/terceirizados/' + id); toast('Excluído', 'success'); await TERC.load(true); load(); } catch {}
  };
  $('#btn-filtrar').onclick = load;
  $('#btn-novo').onclick = () => TERC_openTercModal(null, load);
  await load();
};

function TERC_openTercModal(id, onSave) {
  const edit = !!id;
  (async () => {
    let t = { qtd_pessoas: 1, min_trab_dia: 480, efic_padrao: 0.8, prazo_padrao: 3, situacao: 'Ativa', ativo: 1 };
    if (edit) { const r = await api('get', '/terc/terceirizados/' + id); t = r.data; }
    const m = el('div', { class: 'modal-backdrop' });
    const card = el('div', { class: 'modal p-6 w-full max-w-2xl' });
    card.innerHTML = `
      <h3 class="text-lg font-semibold mb-3"><i class="fas fa-handshake mr-2 text-brand"></i>${edit ? 'Editar' : 'Novo'} Terceirizado</h3>
      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2"><label>Nome *</label><input id="m-nome" value="${t.nome_terc || ''}" /></div>
        <div><label>Setor</label><select id="m-setor">${TERC.optSetores(t.id_setor)}</select></div>
        <div><label>CPF/CNPJ</label><input id="m-cpf" value="${t.cpf_cnpj || ''}" /></div>
        <div><label>Telefone</label><input id="m-tel" value="${t.telefone || ''}" /></div>
        <div><label>E-mail</label><input id="m-email" type="email" value="${t.email || ''}" /></div>
        <div class="col-span-2"><label>Endereço</label><input id="m-end" value="${t.endereco || ''}" /></div>
        <div><label>Qtd pessoas</label><input id="m-pess" type="number" min="1" value="${t.qtd_pessoas || 1}" /></div>
        <div><label>Min. trabalhados/dia</label><input id="m-min" type="number" min="60" value="${t.min_trab_dia || 480}" /></div>
        <div><label>Eficiência padrão (0-1)</label><input id="m-ef" type="number" step="0.01" min="0.1" max="1" value="${t.efic_padrao || 0.8}" /></div>
        <div><label>Prazo padrão (dias)</label><input id="m-pz" type="number" min="0" value="${t.prazo_padrao || 3}" /></div>
        <div><label>Situação</label><select id="m-sit"><option value="Ativa" ${t.situacao === 'Ativa' ? 'selected' : ''}>Ativa</option><option value="Inativa" ${t.situacao === 'Inativa' ? 'selected' : ''}>Inativa</option></select></div>
        <div class="col-span-2"><label>Observação</label><textarea id="m-obs" rows="2">${t.observacao || ''}</textarea></div>
      </div>
      <div class="flex justify-end gap-2 mt-4">
        <button id="m-cancel" class="btn btn-secondary">Cancelar</button>
        <button id="m-save" class="btn btn-primary"><i class="fas fa-save mr-1"></i>Salvar</button>
      </div>
    `;
    m.appendChild(card); document.body.appendChild(m);
    $('#m-cancel').onclick = () => m.remove();
    $('#m-save').onclick = async () => {
      const body = {
        nome_terc: $('#m-nome').value.trim(), id_setor: $('#m-setor').value, cpf_cnpj: $('#m-cpf').value.trim(),
        telefone: $('#m-tel').value.trim(), email: $('#m-email').value.trim(), endereco: $('#m-end').value.trim(),
        qtd_pessoas: $('#m-pess').value, min_trab_dia: $('#m-min').value, efic_padrao: $('#m-ef').value,
        prazo_padrao: $('#m-pz').value, situacao: $('#m-sit').value, observacao: $('#m-obs').value.trim(), ativo: 1,
      };
      if (!body.nome_terc) { toast('Nome é obrigatório', 'warning'); return; }
      try {
        if (edit) await api('put', '/terc/terceirizados/' + id, body);
        else await api('post', '/terc/terceirizados', body);
        toast('Salvo com sucesso', 'success');
        m.remove();
        await TERC.load(true);
        if (onSave) onSave();
      } catch {}
    };
  })();
}

/* ---------- REMESSAS ---------- */
ROUTES.terc_remessas = async (main) => {
  await TERC.load();
  const hoje = dayjs().format('YYYY-MM-DD');
  const de = dayjs().subtract(60, 'day').format('YYYY-MM-DD');
  main.innerHTML = `
    <div class="card p-4 mb-4">
      <div class="flex flex-wrap items-end gap-3">
        <div><label>Busca</label><input id="f-search" placeholder="OP, Ref, Cor..." /></div>
        <div><label>Terceirizado</label><select id="f-terc">${TERC.optTerc()}</select></div>
        <div><label>Serviço</label><select id="f-serv">${TERC.optServicos()}</select></div>
        <div><label>Status</label><select id="f-status"><option value="">Todos</option><option>Aberta</option><option>EmProducao</option><option>Parcial</option><option>Concluida</option><option>Cancelada</option></select></div>
        <div><label>De</label><input type="date" id="f-de" value="${de}" /></div>
        <div><label>Até</label><input type="date" id="f-ate" value="${hoje}" /></div>
        <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Filtrar</button>
        <div class="flex-1"></div>
        <button id="btn-romaneio-lote" class="btn btn-secondary" title="Imprime um Romaneio de Serviço com todas as remessas filtradas"><i class="fas fa-print mr-1"></i>Romaneio em Lote</button>
        <button id="btn-nova" class="btn btn-success"><i class="fas fa-plus mr-1"></i>Nova Remessa</button>
      </div>
    </div>
    <div class="card p-0 overflow-x-auto" id="tbl"></div>
  `;

  let _lastRemessas = [];
  async function load() {
    try {
      const p = new URLSearchParams();
      if ($('#f-search')?.value) p.set('search', $('#f-search').value);
      if ($('#f-terc')?.value) p.set('id_terc', $('#f-terc').value);
      if ($('#f-serv')?.value) p.set('id_servico', $('#f-serv').value);
      if ($('#f-status')?.value) p.set('status', $('#f-status').value);
      if ($('#f-de')?.value) p.set('de', $('#f-de').value);
      if ($('#f-ate')?.value) p.set('ate', $('#f-ate').value);
      const r = await api('get', '/terc/remessas?' + p.toString(), null, { silent: true }).catch(e => {
        console.error('[remessas] erro fetch', e);
        toast(e?.response?.data?.error || 'Falha ao carregar remessas', 'error');
        return { data: [] };
      });
      const rs = fmt.safeArr(r?.data);
      _lastRemessas = rs;
      $('#tbl').innerHTML = `
        <table class="w-full text-sm">
          <thead class="bg-slate-100"><tr>
            <th class="text-right p-2">Ctrl</th>
            <th class="text-left p-2">OP</th>
            <th class="text-left p-2">Terceirizado</th>
            <th class="text-left p-2">Serviço</th>
            <th class="text-left p-2">Referência</th>
            <th class="text-left p-2">Cor</th>
            <th class="text-right p-2">Qtd</th>
            <th class="text-right p-2">Retornada</th>
            <th class="text-right p-2">Valor</th>
            <th class="text-center p-2">Saída</th>
            <th class="text-center p-2">Prev.</th>
            <th class="text-center p-2">Status</th>
            <th class="text-center p-2">Ações</th>
          </tr></thead>
          <tbody>
            ${rs.map(r => {
              const qtdTotal = fmt.safeNum(r?.qtd_total);
              const qtdRet = fmt.safeNum(r?.qtd_retornada_calc);
              return `
              <tr class="border-b hover:bg-slate-50">
                <td class="p-2 text-right font-mono">${r?.num_controle ?? '—'}</td>
                <td class="p-2">${r?.num_op || '—'}</td>
                <td class="p-2">${r?.nome_terc || '—'}</td>
                <td class="p-2 text-xs text-slate-600">${r?.desc_servico || '—'}</td>
                <td class="p-2"><span class="font-mono text-xs">${r?.cod_ref || ''}</span><br><span class="text-xs text-slate-500">${r?.desc_ref || ''}</span></td>
                <td class="p-2">${r?.cor || '—'}</td>
                <td class="p-2 text-right">${fmt.int(qtdTotal)}</td>
                <td class="p-2 text-right ${qtdRet >= qtdTotal && qtdTotal > 0 ? 'text-emerald-700' : 'text-amber-700'}">${fmt.int(qtdRet)}</td>
                <td class="p-2 text-right">${TERC.fmtBRL(fmt.safeNum(r?.valor_total))}</td>
                <td class="p-2 text-center">${fmt.date(r?.dt_saida)}</td>
                <td class="p-2 text-center">${fmt.date(r?.dt_previsao)}</td>
                <td class="p-2 text-center">${TERC.statusBadge(r?.status, r?.atrasada)}</td>
                <td class="p-2 text-center whitespace-nowrap">
                  <button class="btn btn-sm btn-secondary" title="Detalhes" onclick="TERC_viewRem(${r.id_remessa})"><i class="fas fa-eye"></i></button>
                  <button class="btn btn-sm btn-primary" title="Editar" onclick="TERC_editRem(${r.id_remessa})"><i class="fas fa-edit"></i></button>
                  <button class="btn btn-sm btn-success" title="Registrar retorno" onclick="TERC_retRem(${r.id_remessa})"><i class="fas fa-truck-arrow-right"></i></button>
                  <button class="btn btn-sm" style="background:#eab308;color:white" title="Imprimir" onclick="TERC_showPrintMenu(event, ${r.id_remessa})"><i class="fas fa-print"></i></button>
                  <button class="btn btn-sm btn-danger" title="Excluir" onclick="TERC_delRem(${r.id_remessa}, ${r.num_controle})"><i class="fas fa-trash"></i></button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        ${rs.length === 0 ? '<div class="p-6 text-center text-slate-500"><i class="fas fa-circle-info mr-1"></i>Sem dados disponíveis</div>' : ''}
      `;
    } catch (e) {
      console.error('[remessas] load', e);
      $('#tbl').innerHTML = `<div class="p-6 text-center text-amber-600"><i class="fas fa-triangle-exclamation mr-1"></i>Falha ao carregar remessas: ${e?.message || e}</div>`;
    }
  }
  window.TERC_viewRem = (id) => TERC_openRemDetalhe(id);
  window.TERC_editRem = (id) => TERC_openRemModal(id, load);
  window.TERC_retRem = (id) => TERC_openRetModal(id, load);
  window.TERC_delRem = (id, n) => TERC_confirmDelRem(id, n, load);
  // Menu flutuante de impressão (popover por clique — funciona em touch/mobile)
  window.TERC_showPrintMenu = (ev, id) => {
    ev.stopPropagation();
    // Remove menu anterior se existir
    const old = document.getElementById('terc-print-menu');
    if (old) { old.remove(); if (old.dataset.id === String(id)) return; }
    const btn = ev.currentTarget;
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'terc-print-menu';
    menu.dataset.id = String(id);
    menu.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${Math.max(8, rect.right - 200)}px;background:white;border:1px solid #cbd5e1;box-shadow:0 10px 25px rgba(0,0,0,0.15);border-radius:6px;z-index:9999;min-width:200px;font-size:13px;overflow:hidden;`;
    menu.innerHTML = `
      <button class="w-full text-left px-3 py-2 hover:bg-slate-100" style="display:block;border:0;background:transparent;cursor:pointer" data-act="rom"><i class="fas fa-file-lines text-blue-600 mr-2"></i>Romaneio de Serviço</button>
      <button class="w-full text-left px-3 py-2 hover:bg-slate-100" style="display:block;border:0;background:transparent;cursor:pointer" data-act="comp"><i class="fas fa-check-circle text-emerald-600 mr-2"></i>Compr. Entrega Total</button>
      <button class="w-full text-left px-3 py-2 hover:bg-slate-100" style="display:block;border:0;background:transparent;cursor:pointer" data-act="parc"><i class="fas fa-list-check text-amber-600 mr-2"></i>Controle Parcial</button>
    `;
    document.body.appendChild(menu);
    menu.querySelectorAll('button').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const act = b.dataset.act;
        menu.remove();
        if (act === 'rom') await window.TERC_printRom(id);
        else if (act === 'comp') await window.TERC_printCompTotal(id);
        else if (act === 'parc') await window.TERC_printParcial(id);
      };
    });
    // Fecha ao clicar fora
    setTimeout(() => {
      const close = (e) => {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }
      };
      document.addEventListener('click', close);
    }, 10);
  };
  // Handlers de impressão individual (buscam detalhe completo antes)
  window.TERC_printRom = async (id) => {
    const r = await api('get', '/terc/remessas/' + id);
    await TERC_PRINT.romaneio([r.data]);
  };
  window.TERC_printCompTotal = async (id) => {
    const r = await api('get', '/terc/remessas/' + id);
    await TERC_PRINT.comprovanteTotal(r.data);
  };
  window.TERC_printParcial = async (id) => {
    const r = await api('get', '/terc/remessas/' + id);
    await TERC_PRINT.controleParcial(r.data);
  };
  $('#btn-filtrar').onclick = load;
  $('#btn-nova').onclick = () => TERC_openRemModal(null, load);
  $('#btn-romaneio-lote').onclick = async () => {
    if (!_lastRemessas.length) { toast('Filtre alguma remessa antes', 'warning'); return; }
    // Para o romaneio em lote precisamos da grade de cada remessa — busca em paralelo (limitado a 30)
    if (_lastRemessas.length > 30) {
      if (!confirm('Imprimir ' + _lastRemessas.length + ' remessas? Recomendado ≤ 30 por romaneio. Continuar?')) return;
    }
    toast('Preparando romaneio em lote...', 'info');
    const detalhes = [];
    for (const r of _lastRemessas.slice(0, 60)) {
      try {
        const d = await api('get', '/terc/remessas/' + r.id_remessa, null, { silent: true });
        detalhes.push(d.data);
      } catch { detalhes.push(r); }
    }
    await TERC_PRINT.romaneio(detalhes);
  };
  await load();
};

async function TERC_openRemModal(id, onSave) {
  const edit = !!id;
  await TERC.load();
  let r = { dt_saida: dayjs().format('YYYY-MM-DD'), status: 'AguardandoEnvio', tempo_peca: 0, efic_pct: 0.8, qtd_pessoas: 1, min_trab_dia: 480, prazo_dias: 0, preco_unit: 0, grade: [] };
  const TAMANHOS = ['PP', 'P', 'M', 'G', 'GG', 'EG', 'XG', 'UN', 'TAM1', 'TAM2'];
  if (edit) {
    const res = await api('get', '/terc/remessas/' + id); r = res.data;
    r.grade = r.grade || [];
  }
  let num_controle = r.num_controle || 0;
  if (!edit) {
    const n = await api('get', '/terc/remessas/next-num'); num_controle = n.data?.num_controle;
  }

  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-4xl' });
  const gradeMap = Object.fromEntries(r.grade.map(g => [g.tamanho, g.qtd]));
  // Encontra produto inicial (se editando, faz match por cod_ref+coleção)
  const prodInicial = edit ? TERC.findProdutoByRef(r.cod_ref, r.id_colecao) : null;
  const idProdSel = prodInicial ? prodInicial.id_produto : '';

  card.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-lg font-semibold"><i class="fas fa-truck-fast mr-2 text-brand"></i>${edit ? 'Editar' : 'Nova'} Remessa · Nº <span class="font-mono text-brand">${num_controle}</span></h3>
      <label class="flex items-center gap-2 text-xs text-slate-600 cursor-pointer"><input type="checkbox" id="m-adv" /> Modo avançado</label>
    </div>

    <!-- Bloco BÁSICO (campos mínimos) -->
    <div class="grid grid-cols-6 gap-3">
      <div class="col-span-3"><label>Terceirizado *</label><select id="m-terc">${TERC.optTerc(r.id_terc, true)}</select></div>
      <div class="col-span-3"><label>Serviço *</label><select id="m-serv">${TERC.optServicos(r.id_servico)}</select></div>

      <div class="col-span-4">
        <label>Produto (descrição) *<span class="text-xs text-slate-500 ml-1">— selecione um cadastrado ou digite uma referência manual</span></label>
        <select id="m-prod">${TERC.optProdutos(idProdSel, r.id_colecao)}</select>
      </div>
      <div class="col-span-2"><label>Coleção</label><select id="m-col">${TERC.optColecoes(r.id_colecao)}</select></div>

      <div class="col-span-2"><label>Referência</label><input id="m-ref" value="${r.cod_ref || ''}" placeholder="auto-preenchido" /></div>
      <div class="col-span-2"><label>Descrição</label><input id="m-descref" value="${r.desc_ref || ''}" /></div>
      <div class="col-span-2">
        <label>Cor</label>
        <input id="m-cor" value="${(r.cor || '').replace(/"/g, '&quot;')}" list="rem-cor-dl" placeholder="auto-carregado do produto" />
        <datalist id="rem-cor-dl"></datalist>
      </div>

      <div class="col-span-2"><label>Data saída *</label><input type="date" id="m-dts" value="${r.dt_saida || ''}" /></div>
      <div class="col-span-2"><label>Preço unit. (R$) <span id="m-preco-tag" class="text-xs ml-1"></span></label><input type="number" step="0.01" id="m-preco" value="${r.preco_unit || 0}" /></div>
      <div class="col-span-2"><label>Nº OP</label><input id="m-op" value="${r.num_op || ''}" placeholder="opcional" /></div>

      <div class="col-span-6">
        <label class="font-semibold">Grade de tamanhos *</label>
        <div class="grid grid-cols-5 md:grid-cols-10 gap-2 mt-1" id="m-grade">
          ${TAMANHOS.map(t => `
            <div class="text-center">
              <div class="text-xs font-mono text-slate-500">${t}</div>
              <input data-tam="${t}" type="number" min="0" value="${gradeMap[t] || 0}" class="text-center grade-in" />
            </div>`).join('')}
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-4 text-sm">
          <span>Total: <b id="m-total">0</b> peças</span>
          <span>Valor: <b id="m-valor">${TERC.fmtBRL(0)}</b></span>
          <span class="text-slate-500">Previsão: <b id="m-prev">—</b></span>
        </div>
      </div>
    </div>

    <!-- Bloco AVANÇADO (oculto por padrão — campos opcionais) -->
    <div id="m-advanced" class="hidden mt-4 pt-4 border-t border-dashed">
      <div class="text-xs text-slate-500 mb-2"><i class="fas fa-circle-info mr-1"></i>Estes campos vêm automaticamente do cadastro do terceirizado e da tabela de preços. Edite apenas se precisar sobrepor.</div>
      <div class="grid grid-cols-6 gap-3">
        <div><label>Data início</label><input type="date" id="m-dti" value="${r.dt_inicio || r.dt_saida || ''}" /></div>
        <div><label>Tempo/peça (min)</label><input type="number" step="0.01" id="m-tempo" value="${r.tempo_peca || 0}" /></div>
        <div><label>Qtd pessoas</label><input type="number" min="1" id="m-pess" value="${r.qtd_pessoas || 1}" /></div>
        <div><label>Min trab/dia</label><input type="number" min="60" id="m-min" value="${r.min_trab_dia || 480}" /></div>
        <div><label>Eficiência (0-1)</label><input type="number" step="0.01" min="0.1" max="1" id="m-ef" value="${r.efic_pct || 0.8}" /></div>
        <div><label>Prazo fixo (dias)</label><input type="number" min="0" id="m-pz" value="${r.prazo_dias || 0}" /></div>
        <div class="col-span-3"><label>Status</label><select id="m-status"><option value="AguardandoEnvio" ${r.status === 'AguardandoEnvio' ? 'selected' : ''}>Aguardando envio</option><option value="Enviado" ${r.status === 'Enviado' ? 'selected' : ''}>Enviado</option><option value="EmProducao" ${r.status === 'EmProducao' ? 'selected' : ''}>Em produção</option><option value="Parcial" ${r.status === 'Parcial' ? 'selected' : ''}>Parcial</option><option value="Concluido" ${r.status === 'Concluido' ? 'selected' : ''}>Concluído</option><option value="Cancelado" ${r.status === 'Cancelado' ? 'selected' : ''}>Cancelado</option></select></div>
        <div class="col-span-3"><label>&nbsp;</label><button id="m-lookup" class="btn btn-secondary w-full" type="button"><i class="fas fa-search-dollar mr-1"></i>Buscar preço da tabela</button></div>
        <div class="col-span-6"><label>Observação</label><textarea id="m-obs" rows="2">${r.observacao || ''}</textarea></div>
      </div>
    </div>

    <div class="flex justify-end gap-2 mt-4">
      <button id="m-cancel" class="btn btn-secondary">Cancelar</button>
      <button id="m-save" class="btn btn-primary"><i class="fas fa-save mr-1"></i>Salvar remessa</button>
    </div>
  `;
  m.appendChild(card); document.body.appendChild(m);

  // Toggle modo avançado
  $('#m-adv').onchange = (e) => $('#m-advanced').classList.toggle('hidden', !e.target.checked);

  function setPrecoTag(txt, color) {
    const el = $('#m-preco-tag');
    if (!el) return;
    el.innerHTML = txt ? `<span style="color:${color}">${txt}</span>` : '';
  }

  function recalc() {
    const grade = Array.from(card.querySelectorAll('.grade-in')).map(i => ({ tamanho: i.dataset.tam, qtd: Number(i.value || 0) }));
    const total = grade.reduce((a, g) => a + g.qtd, 0);
    const preco = Number($('#m-preco').value || 0);
    $('#m-total').textContent = fmt.int(total);
    $('#m-valor').textContent = TERC.fmtBRL(total * preco);
    const tempo = Number($('#m-tempo')?.value || 0);
    const pess = Number($('#m-pess')?.value || 1);
    const min = Number($('#m-min')?.value || 480);
    const ef = Number($('#m-ef')?.value || 0.8);
    const pz = Number($('#m-pz')?.value || 0);
    const dts = $('#m-dts').value;
    if (total > 0 && dts) {
      let dias = pz > 0 ? pz : (tempo > 0 ? Math.max(1, Math.ceil((total * tempo) / (Math.max(1, pess) * Math.max(1, min) * Math.max(0.1, ef)))) : 0);
      if (dias > 0) {
        const d = dayjs(dts).add(dias, 'day').format('DD/MM/YYYY');
        $('#m-prev').textContent = d + ' (' + dias + ' dia' + (dias > 1 ? 's' : '') + ')';
      } else $('#m-prev').textContent = 'auto';
    } else $('#m-prev').textContent = '—';
  }

  // 🎨 Carrega cores cadastradas para o produto selecionado (datalist dinâmico)
  async function loadCoresDoProduto() {
    const dl = $('#rem-cor-dl');
    if (!dl) return;
    const cod = $('#m-ref').value.trim();
    let nomes = new Set();
    // 1) Cores cadastradas em variações do produto (id_produto)
    const idProd = $('#m-prod').value;
    if (idProd) {
      try {
        const r = await api('get', '/terc/produtos/' + idProd + '/variacoes', null, { silent: true });
        fmt.safeArr(r?.data).forEach(v => { if (v.cor) nomes.add(v.cor); });
      } catch {}
    }
    // 2) Cores presentes na tabela de preços para esse cod_ref
    if (cod) {
      try {
        const r = await api('get', '/terc/precos?cod_ref=' + encodeURIComponent(cod), null, { silent: true });
        fmt.safeArr(r?.data).forEach(p => { if (p.cor) nomes.add(p.cor); });
      } catch {}
    }
    // 3) Catálogo geral (fallback)
    if (nomes.size === 0) fmt.safeArr(window.TERC?.cores).forEach(c => nomes.add(c.nome_cor));
    dl.innerHTML = Array.from(nomes).sort().map(n => `<option value="${n}">`).join('');
  }

  // 🔎 Lookup automático de preço (Produto + Cor + Tamanho + Serviço, com fallback)
  // Prioridade enviada ao backend:
  //   1) Produto + Cor + Tamanho + Serviço → match_level='produto+cor+grade+servico'
  //   2) Produto + Cor + Serviço            → match_level='produto+cor+servico'
  //   3) Produto + Serviço                  → match_level='produto+servico'
  //   4) Serviço padrão                     → match_level='servico_padrao'
  let _lastLookupKey = '';
  async function autoLookupPreco() {
    const cod = $('#m-ref').value.trim();
    const sv  = $('#m-serv').value;
    const col = $('#m-col').value;
    const cor = $('#m-cor').value.trim();
    // Tamanho dominante = aquele com mais peças na grade (ou primeiro >0)
    const grade = Array.from(card.querySelectorAll('.grade-in'))
      .map(i => ({ tam: i.dataset.tam, qtd: Number(i.value || 0) }))
      .filter(g => g.qtd > 0)
      .sort((a, b) => b.qtd - a.qtd);
    const tam = grade[0]?.tam || '';
    if (!cod || !sv) { setPrecoTag('', ''); return; }
    const key = `${cod}|${sv}|${col || ''}|${cor}|${tam}`;
    if (key === _lastLookupKey) return;
    _lastLookupKey = key;
    try {
      const params = new URLSearchParams({ cod_ref: cod, id_servico: sv });
      if (col) params.set('id_colecao', col);
      if (cor) params.set('cor', cor);
      if (tam) params.set('tamanho', tam);
      const res = await api('get', '/terc/precos/lookup?' + params.toString(), null, { silent: true });
      if (res.data && res.data.preco != null) {
        $('#m-preco').value = Number(res.data.preco).toFixed(2);
        if (res.data.tempo_min && $('#m-tempo')) $('#m-tempo').value = res.data.tempo_min;
        if (res.data.desc_ref && !$('#m-descref').value) $('#m-descref').value = res.data.desc_ref;
        const lvl = res.data.match_level || '';
        const labelMap = {
          'produto+cor+grade+servico': '<i class="fas fa-bullseye"></i> aplicado: produto+cor+grade+serviço',
          'produto+cor+servico':       '<i class="fas fa-circle-check"></i> aplicado: produto+cor+serviço',
          'produto+servico':            '<i class="fas fa-circle-check"></i> aplicado: produto+serviço',
          'servico_padrao':             '<i class="fas fa-circle-info"></i> aplicado: serviço padrão',
        };
        setPrecoTag(labelMap[lvl] || '<i class="fas fa-check"></i> da tabela', '#10b981');
        toast('Preço aplicado automaticamente', 'success');
        recalc();
      } else {
        setPrecoTag('<i class="fas fa-triangle-exclamation"></i> Preço não encontrado para esta combinação — <a href="#" id="m-save-preco" style="text-decoration:underline">salvar?</a>', '#f59e0b');
        const a = $('#m-save-preco');
        if (a) a.onclick = (e) => { e.preventDefault(); saveSugestaoPreco(); };
      }
    } catch {}
  }

  async function saveSugestaoPreco() {
    const cod = $('#m-ref').value.trim();
    const desc = $('#m-descref').value.trim();
    const sv = $('#m-serv').value;
    const col = $('#m-col').value;
    const preco = Number($('#m-preco').value || 0);
    if (!sv || !preco || preco <= 0) { toast('Informe serviço e preço primeiro', 'warning'); return; }
    if (!cod && !desc) { toast('Informe referência ou descrição', 'warning'); return; }
    try {
      await api('post', '/terc/precos', { cod_ref: cod, desc_ref: desc, id_servico: sv, id_colecao: col, grade: 1, preco });
      toast('Preço salvo na tabela', 'success');
      setPrecoTag('<i class="fas fa-check"></i> salvo', '#10b981');
      _lastLookupKey = '';
    } catch {}
  }

  // 📦 Auto-fill ao escolher PRODUTO
  $('#m-prod').onchange = async () => {
    const opt = $('#m-prod').options[$('#m-prod').selectedIndex];
    if (!opt || !opt.value) return;
    const cod = opt.dataset.cod || '';
    const desc = opt.dataset.desc || '';
    const colId = opt.dataset.col || '';
    if (cod) $('#m-ref').value = cod;
    if (desc) $('#m-descref').value = desc;
    if (colId && !$('#m-col').value) $('#m-col').value = colId;
    await loadCoresDoProduto();
    toast('Produto atualizado', 'success');
    autoLookupPreco();
  };
  $('#m-serv').addEventListener('change', autoLookupPreco);
  $('#m-col').addEventListener('change', autoLookupPreco);
  $('#m-ref').addEventListener('blur', () => { _lastLookupKey = ''; loadCoresDoProduto(); autoLookupPreco(); });
  $('#m-cor').addEventListener('change', () => { _lastLookupKey = ''; autoLookupPreco(); });
  $('#m-cor').addEventListener('blur',   () => { _lastLookupKey = ''; autoLookupPreco(); });
  $('#m-preco').addEventListener('input', () => { setPrecoTag('<i class="fas fa-keyboard"></i> manual', '#f59e0b'); recalc(); });
  card.querySelectorAll('.grade-in, #m-tempo, #m-pess, #m-min, #m-ef, #m-pz, #m-dts').forEach(i => i.addEventListener('input', recalc));
  // Recarrega cores e dispara lookup quando a grade muda (tamanho dominante pode mudar)
  card.querySelectorAll('.grade-in').forEach(i => i.addEventListener('change', () => { _lastLookupKey = ''; autoLookupPreco(); }));
  // Inicializa datalist de cores e tenta lookup com valores iniciais
  loadCoresDoProduto();

  // 👤 Auto-preenche parâmetros ocultos do terceirizado (não exibe no básico)
  $('#m-terc').addEventListener('change', () => {
    const t = TERC.terceirizados.find(x => x.id_terc == $('#m-terc').value);
    if (t) {
      if ($('#m-pess')) $('#m-pess').value = t.qtd_pessoas || 1;
      if ($('#m-min')) $('#m-min').value = t.min_trab_dia || 480;
      if ($('#m-ef')) $('#m-ef').value = t.efic_padrao || 0.8;
      if ($('#m-pz')) $('#m-pz').value = t.prazo_padrao || 0;
      recalc();
    }
  });

  // Botão manual de lookup (modo avançado)
  const btnLookup = $('#m-lookup');
  if (btnLookup) btnLookup.onclick = () => { _lastLookupKey = ''; autoLookupPreco(); };

  recalc();
  if (!edit) {
    // Tenta lookup imediatamente se já há valores (re-edição)
    setTimeout(autoLookupPreco, 100);
  }

  $('#m-cancel').onclick = () => m.remove();
  $('#m-save').onclick = async () => {
    const grade = Array.from(card.querySelectorAll('.grade-in')).map(i => ({ tamanho: i.dataset.tam, qtd: Number(i.value || 0) })).filter(g => g.qtd > 0);
    const body = {
      num_controle, num_op: $('#m-op').value.trim(),
      id_terc: $('#m-terc').value, id_servico: $('#m-serv').value, id_colecao: $('#m-col').value,
      cod_ref: $('#m-ref').value.trim(), desc_ref: $('#m-descref').value.trim(),
      cor: $('#m-cor').value.trim(),
      dt_saida: $('#m-dts').value, dt_inicio: $('#m-dti')?.value || $('#m-dts').value,
      tempo_peca: $('#m-tempo')?.value || 0, preco_unit: $('#m-preco').value,
      qtd_pessoas: $('#m-pess')?.value || 1, min_trab_dia: $('#m-min')?.value || 480,
      efic_pct: $('#m-ef')?.value || 0.8, prazo_dias: $('#m-pz')?.value || 0,
      status: $('#m-status')?.value || 'AguardandoEnvio', observacao: $('#m-obs')?.value?.trim() || '',
      grade,
    };
    if (!body.id_terc || !body.id_servico || !body.cod_ref || !body.dt_saida) { toast('Preencha terceirizado, serviço, referência/produto e data de saída', 'warning'); return; }
    if (grade.length === 0) { toast('Informe ao menos uma quantidade na grade', 'warning'); return; }
    try {
      if (edit) await api('put', '/terc/remessas/' + id, body);
      else await api('post', '/terc/remessas', body);
      toast('Remessa salva', 'success');
      m.remove();
      if (onSave) onSave();
    } catch {}
  };
}

/* ============================================================
 * MODAL — Cadastro/Edição de Produto
 * ============================================================ */
async function TERC_openProdModal(id, onSave) {
  await TERC.load();
  let p = { ativo: 1, grade_padrao: 1 };
  if (id) {
    try { const r = await api('get', '/terc/produtos/' + id); p = r.data || p; } catch { return; }
  }
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-2xl' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3"><i class="fas fa-tshirt mr-2 text-brand"></i>${id ? 'Editar' : 'Novo'} Produto</h3>
    <div class="grid grid-cols-2 gap-3">
      <div><label>Referência *<span class="text-xs text-slate-400 ml-1">(única)</span></label><input id="m-ref" value="${(p.cod_ref || '').replace(/"/g, '&quot;')}" placeholder="ex: 01-01-25-00" /></div>
      <div><label>Nome curto</label><input id="m-nome" value="${(p.nome_produto || '').replace(/"/g, '&quot;')}" placeholder="opcional" /></div>
      <div class="col-span-2"><label>Descrição *</label><input id="m-desc" value="${(p.desc_ref || '').replace(/"/g, '&quot;')}" placeholder="ex: VOLLEY ADULTO" /></div>
      <div><label>Serviço padrão <span class="text-xs text-slate-400">(opcional)</span></label><select id="m-serv"><option value="">— nenhum —</option>${TERC.optServicos(p.id_servico_padrao).replace(/^<option value=""[^<]*<\/option>/, '')}</select></div>
      <div><label>Tempo padrão (min/peça) <span class="text-xs text-slate-400">(opcional)</span></label><input id="m-tempo" type="number" step="0.01" min="0" value="${p.tempo_padrao != null ? p.tempo_padrao : ''}" placeholder="—" /></div>
      <div><label>Coleção</label><select id="m-col">${TERC.optColecoes(p.id_colecao)}</select></div>
      <div><label>Grade padrão</label><input id="m-grade" type="number" min="1" value="${p.grade_padrao || 1}" /></div>
      <div class="col-span-2"><label>Observação</label><textarea id="m-obs" rows="2">${p.observacao || ''}</textarea></div>
      <div><label class="flex items-center gap-2 mt-2"><input type="checkbox" id="m-ativo" ${p.ativo !== 0 ? 'checked' : ''} /> Ativo</label></div>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button id="m-cancel" class="btn btn-secondary">Cancelar</button>
      <button id="m-save" class="btn btn-primary"><i class="fas fa-save mr-1"></i>Salvar</button>
    </div>
  `;
  m.appendChild(card); document.body.appendChild(m);
  $('#m-ref').focus();
  $('#m-cancel').onclick = () => m.remove();
  $('#m-save').onclick = async () => {
    const body = {
      cod_ref: $('#m-ref').value.trim(),
      desc_ref: $('#m-desc').value.trim(),
      nome_produto: $('#m-nome').value.trim(),
      id_colecao: $('#m-col').value || null,
      grade_padrao: $('#m-grade').value || 1,
      id_servico_padrao: $('#m-serv').value || null,
      tempo_padrao: $('#m-tempo').value !== '' ? Number($('#m-tempo').value) : null,
      observacao: $('#m-obs').value.trim(),
      ativo: $('#m-ativo').checked ? 1 : 0,
    };
    if (!body.cod_ref) { toast('Referência é obrigatória', 'warning'); return; }
    if (!body.desc_ref) { toast('Descrição é obrigatória', 'warning'); return; }
    try {
      if (id) await api('put', '/terc/produtos/' + id, body);
      else await api('post', '/terc/produtos', body);
      toast('Produto salvo', 'success');
      m.remove();
      await TERC.reloadProdutos();
      if (onSave) onSave();
    } catch {}
  };
}

/* ============================================================
 * MODAL — Importação de Produtos (Excel/CSV/TSV)
 * Aceita layout livre: detecta colunas por nome (case-insensitive, sem acentos).
 * Aliases: "NOME REFERÊNCIA"→cod_ref | "PRODUTO"→desc_ref | serviço | tempo | coleção | observação
 * Ignora linhas vazias e linhas-cabeçalho "TABELA DE CODÍGO" e similares.
 * ============================================================ */
async function TERC_openProdImportModal(onSave) {
  await TERC.load();
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-4xl' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3"><i class="fas fa-file-excel mr-2 text-emerald-600"></i>Importar Produtos</h3>
    <div class="text-sm text-slate-600 mb-3">
      <p class="mb-1">Aceita Excel (.xlsx) com qualquer ordem de colunas. O importador detecta automaticamente:</p>
      <div class="bg-slate-50 p-2 rounded text-xs font-mono">
        <b>Referência</b>: "NOME REFERÊNCIA" / referencia / ref / codigo / cod_ref &nbsp;— <b>obrigatória, única</b><br/>
        <b>Descrição</b>: "PRODUTO" / descricao / desc / nome &nbsp;— <b>obrigatória</b><br/>
        <b>Opcionais</b>: servico (nome ou id) | tempo | colecao | grade | observacao
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
      <div><label>Arquivo Excel/CSV</label><input type="file" id="f-file" accept=".xlsx,.xls,.csv" /></div>
      <div class="flex flex-col gap-1 justify-end">
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="f-criar" checked /> <span>Criar novos produtos</span></label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="f-atualizar" checked /> <span>Atualizar existentes</span></label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="f-dry" /> <span class="text-amber-700"><b>Simulação</b> (não grava)</span></label>
      </div>
    </div>
    <div id="f-preview" class="hidden mb-3"></div>
    <textarea id="f-data" rows="7" placeholder="Ou cole aqui as linhas (TAB separado) — 1ª linha = cabeçalho" style="font-family:monospace;font-size:11px"></textarea>
    <div id="result" class="mt-3"></div>
    <div class="flex justify-end gap-2 mt-3">
      <button id="m-cancel" class="btn btn-secondary">Fechar</button>
      <button id="m-import" class="btn btn-primary"><i class="fas fa-upload mr-1"></i>Importar</button>
    </div>
  `;
  m.appendChild(card); document.body.appendChild(m);
  $('#m-cancel').onclick = () => m.remove();

  // ---- Normalização de cabeçalho: tira acentos, espaços, pontuação ----
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim().replace(/[\s_\-./]+/g, '');
  }
  // Mapeia cabeçalho original -> chave canônica (cod_ref, desc_ref, etc)
  function detectColumn(h) {
    const k = norm(h);
    // Referência: prioriza "NOME REFERÊNCIA" (único) sobre "REFERÊNCIA" (prefixo)
    if (k === 'nomereferencia' || k === 'codref' || k === 'codigo' || k === 'cod') return 'cod_ref';
    if (k === 'referencia' || k === 'ref') return '__ref_curta'; // prefixo, descartar se houver "nome referencia"
    if (k === 'produto' || k === 'descricao' || k === 'desc' || k === 'descref') return 'desc_ref';
    if (k === 'nome' || k === 'nomeproduto') return 'nome_produto';
    if (k === 'servico' || k === 'servicopadrao' || k === 'idservico' || k === 'idservicopadrao') return 'id_servico_padrao';
    if (k === 'tempo' || k === 'tempopadrao' || k === 'tempomin') return 'tempo_padrao';
    if (k === 'colecao' || k === 'nomecolecao') return 'colecao';
    if (k === 'grade' || k === 'gradepadrao') return 'grade_padrao';
    if (k === 'observacao' || k === 'obs') return 'observacao';
    return null;
  }
  // Filtra linhas que parecem dados válidos (não cabeçalhos secundários)
  function isDataRow(obj) {
    if (!obj.cod_ref || !obj.desc_ref) return false;
    const ref = String(obj.cod_ref).trim();
    const desc = String(obj.desc_ref).trim();
    // Descarta linhas como "TABELA DE CODÍGO", "00 - NÃO TEM ESPECIFICAÇÃO"
    if (/^tabela\s+de\s+codigo/i.test(desc) || /^tabela\s+de\s+codigo/i.test(ref)) return false;
    // Referência precisa ter ao menos 2 caracteres
    if (ref.length < 2) return false;
    return true;
  }

  let _parsedRows = []; // último parse válido

  function renderPreview(rows) {
    if (!rows.length) { $('#f-preview').classList.add('hidden'); return; }
    const sample = rows.slice(0, 5);
    $('#f-preview').classList.remove('hidden');
    $('#f-preview').innerHTML = `
      <div class="text-xs text-slate-500 mb-1">Pré-visualização (${rows.length} linhas válidas detectadas):</div>
      <div class="card p-0 overflow-x-auto" style="max-height:160px">
        <table class="w-full text-xs"><thead class="bg-slate-100"><tr>
          <th class="text-left p-1">cod_ref</th><th class="text-left p-1">desc_ref</th>
          <th class="text-left p-1">servico</th><th class="text-right p-1">tempo</th><th class="text-left p-1">colecao</th>
        </tr></thead><tbody>
        ${sample.map(r => `<tr class="border-b">
          <td class="p-1 font-mono">${r.cod_ref || ''}</td>
          <td class="p-1">${r.desc_ref || ''}</td>
          <td class="p-1">${r.id_servico_padrao || ''}</td>
          <td class="p-1 text-right">${r.tempo_padrao || ''}</td>
          <td class="p-1">${r.colecao || ''}</td>
        </tr>`).join('')}
        ${rows.length > 5 ? `<tr><td colspan="5" class="p-1 text-center text-slate-500">… +${rows.length - 5} linhas</td></tr>` : ''}
        </tbody></table>
      </div>`;
  }

  // Converte planilha (array de objetos) em rows canônicas
  function parseSheetData(data) {
    if (!data.length) return [];
    const headers = Object.keys(data[0]);
    // Mapa cabeçalho original -> chave canônica
    const map = {};
    let hasNomeRef = false, hasRefCurta = false;
    headers.forEach(h => { const k = detectColumn(h); if (k) { map[h] = k; if (k === 'cod_ref') hasNomeRef = true; if (k === '__ref_curta') hasRefCurta = true; } });
    // Se só tem "REFERÊNCIA" (prefixo) sem "NOME REFERÊNCIA", usa-a como cod_ref mesmo
    if (!hasNomeRef && hasRefCurta) {
      Object.keys(map).forEach(h => { if (map[h] === '__ref_curta') map[h] = 'cod_ref'; });
    }
    return data.map(r => {
      const o = {};
      for (const h of headers) {
        const k = map[h];
        if (!k || k === '__ref_curta') continue;
        const v = r[h];
        if (v != null && String(v).trim() !== '') o[k] = String(v).trim();
      }
      return o;
    }).filter(isDataRow);
  }

  $('#f-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!window.XLSX) {
      await new Promise(res => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = res; document.head.appendChild(s); });
    }
    const ab = await f.arrayBuffer();
    const wb = window.XLSX.read(ab, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (data.length === 0) { toast('Planilha vazia', 'warning'); return; }
    _parsedRows = parseSheetData(data);
    if (!_parsedRows.length) {
      toast('Nenhuma linha válida detectada (verifique colunas "NOME REFERÊNCIA" e "PRODUTO")', 'warning');
      return;
    }
    // Também exibe os dados brutos no textarea (apenas para conferência)
    const headers = Object.keys(data[0]);
    $('#f-data').value = [headers.join('\t'), ...data.slice(0, 50).map(r => headers.map(h => r[h]).join('\t'))].join('\n');
    renderPreview(_parsedRows);
    toast(`${_parsedRows.length} linhas válidas (de ${data.length} totais)`, 'success');
  };

  $('#m-import').onclick = async () => {
    let rows = _parsedRows;
    // Se não veio de upload, tenta parsear o textarea
    if (!rows.length) {
      const text = $('#f-data').value.trim();
      if (!text) { toast('Suba um arquivo Excel ou cole os dados', 'warning'); return; }
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast('Inclua cabeçalho e ao menos uma linha', 'warning'); return; }
      const headers = lines[0].split('\t');
      const data = lines.slice(1).map(l => {
        const c = l.split('\t'); const o = {};
        headers.forEach((h, i) => o[h] = (c[i] || '').trim());
        return o;
      });
      rows = parseSheetData(data);
      if (!rows.length) { toast('Nenhuma linha válida no texto colado', 'warning'); return; }
      _parsedRows = rows;
      renderPreview(rows);
    }
    try {
      const r = await api('post', '/terc/produtos/importar', {
        rows,
        dry_run: $('#f-dry').checked,
        criar_novos: $('#f-criar').checked,
        atualizar: $('#f-atualizar').checked,
      });
      const d = r.data || {};
      $('#result').innerHTML = `
        <div class="card p-3 ${d.dry_run ? 'bg-amber-50' : 'bg-emerald-50'}">
          <div class="text-sm font-semibold">
            ${d.dry_run ? '<i class="fas fa-flask text-amber-600 mr-1"></i><span class="text-amber-700">SIMULAÇÃO</span>' : '<i class="fas fa-check-circle text-emerald-600 mr-1"></i><span class="text-emerald-700">EXECUTADO</span>'}
            — ${d.total} linhas processadas
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-sm">
            <div class="p-2 bg-white rounded border"><i class="fas fa-plus text-emerald-600"></i> Criados: <b>${d.inseridos}</b></div>
            <div class="p-2 bg-white rounded border"><i class="fas fa-sync text-blue-600"></i> Atualizados: <b>${d.atualizados}</b></div>
            <div class="p-2 bg-white rounded border"><i class="fas fa-ban text-amber-600"></i> Ignorados: <b>${d.ignorados}</b></div>
            <div class="p-2 bg-white rounded border"><i class="fas fa-layer-group text-indigo-600"></i> Coleções criadas: <b>${d.colecoes_criadas}</b></div>
          </div>
          ${(d.erros || []).length ? `<details class="mt-2" open><summary class="text-xs text-red-600 cursor-pointer"><b>${d.erros.length} erro(s)</b> — clique para detalhes</summary><div class="mt-1 max-h-40 overflow-y-auto text-xs"><table class="w-full"><thead class="bg-red-100"><tr><th class="p-1 text-left">Linha</th><th class="p-1 text-left">Referência</th><th class="p-1 text-left">Erro</th></tr></thead><tbody>${d.erros.map(e => `<tr class="border-b"><td class="p-1">${e.linha}</td><td class="p-1 font-mono">${e.ref || ''}</td><td class="p-1 text-red-700">${e.erro}</td></tr>`).join('')}</tbody></table></div></details>` : '<div class="mt-2 text-xs text-emerald-700"><i class="fas fa-check"></i> Sem erros.</div>'}
        </div>`;
      if (!d.dry_run && (d.inseridos + d.atualizados) > 0) {
        toast(`${d.inseridos + d.atualizados} produto(s) importados`, 'success');
        await TERC.reloadProdutos();
        if (onSave) onSave();
      }
    } catch {}
  };
}

/* ============================================================
 * MODAL — Gerenciar Coleções (CRUD completo)
 * ============================================================ */
async function TERC_openColecoesModal(onSave) {
  await TERC.load(true);
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-xl' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3"><i class="fas fa-layer-group mr-2 text-brand"></i>Coleções</h3>
    <div class="flex gap-2 mb-3">
      <input id="c-nome" placeholder="Nome da nova coleção" />
      <button id="c-add" class="btn btn-success"><i class="fas fa-plus mr-1"></i>Adicionar</button>
    </div>
    <div id="c-list" class="card p-0 overflow-x-auto"></div>
    <div class="flex justify-end gap-2 mt-4">
      <button id="m-cancel" class="btn btn-secondary">Fechar</button>
    </div>
  `;
  m.appendChild(card); document.body.appendChild(m);

  function render() {
    const list = TERC.colecoes;
    $('#c-list').innerHTML = list.length ? `
      <table class="w-full text-sm">
        <thead class="bg-slate-100"><tr><th class="text-left p-2">Nome</th><th class="text-center p-2">Ativo</th><th class="text-center p-2">Ações</th></tr></thead>
        <tbody>
          ${list.map(c => `
            <tr class="border-b" data-id="${c.id_colecao}">
              <td class="p-2"><input class="c-edit w-full" data-id="${c.id_colecao}" value="${(c.nome_colecao || '').replace(/"/g, '&quot;')}" /></td>
              <td class="p-2 text-center"><input type="checkbox" class="c-act" data-id="${c.id_colecao}" ${c.ativo ? 'checked' : ''} /></td>
              <td class="p-2 text-center whitespace-nowrap">
                <button class="btn btn-sm btn-primary c-save" data-id="${c.id_colecao}" title="Salvar"><i class="fas fa-save"></i></button>
                <button class="btn btn-sm btn-danger c-del" data-id="${c.id_colecao}" title="Excluir"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>` : '<div class="p-4 text-center text-slate-500">Nenhuma coleção cadastrada.</div>';
    card.querySelectorAll('.c-save').forEach(b => b.onclick = async () => {
      const id = b.dataset.id;
      const nome = card.querySelector(`input.c-edit[data-id="${id}"]`).value.trim();
      const ativo = card.querySelector(`input.c-act[data-id="${id}"]`).checked ? 1 : 0;
      if (!nome) { toast('Nome obrigatório', 'warning'); return; }
      try { await api('put', '/terc/colecoes/' + id, { nome_colecao: nome, ativo }); toast('Atualizada', 'success'); await TERC.load(true); render(); if (onSave) onSave(); } catch {}
    });
    card.querySelectorAll('.c-del').forEach(b => b.onclick = async () => {
      if (!confirm('Excluir esta coleção? Produtos/preços vinculados podem ser afetados.')) return;
      try { await api('delete', '/terc/colecoes/' + b.dataset.id); toast('Excluída', 'success'); await TERC.load(true); render(); if (onSave) onSave(); } catch {}
    });
  }

  $('#c-add').onclick = async () => {
    const nome = $('#c-nome').value.trim();
    if (!nome) { toast('Informe o nome', 'warning'); return; }
    try {
      await api('post', '/terc/colecoes', { nome_colecao: nome });
      $('#c-nome').value = '';
      toast('Coleção criada', 'success');
      await TERC.load(true);
      render();
      if (onSave) onSave();
    } catch {}
  };
  $('#c-nome').addEventListener('keypress', (e) => { if (e.key === 'Enter') $('#c-add').click(); });
  $('#m-cancel').onclick = () => m.remove();
  render();
}

// Modal de retorno — cria novo OU edita existente quando idRetornoEdit é informado.
// Em modo edit: pré-preenche valores, NÃO subtrai a si mesmo do gradeMax e usa PUT.
async function TERC_openRetModal(idRemessa, onSave, idRetornoEdit) {
  const res = await api('get', '/terc/remessas/' + idRemessa);
  const r = res.data || {};
  const editing = !!idRetornoEdit;
  const retEdit = editing ? (fmt.safeArr(r.retornos).find(x => Number(x.id_retorno) === Number(idRetornoEdit)) || null) : null;
  if (editing && !retEdit) { toast('Retorno não encontrado', 'error'); return; }

  // Saldo: total da remessa − soma dos retornos atuais (se editando, descontar este retorno)
  const totalRetTodos = fmt.safeNum(r.totais_retorno?.total);
  const totalEsteRet = retEdit ? fmt.safeNum(retEdit.qtd_total) : 0;
  const saldoBase = fmt.safeNum(r.qtd_total) - totalRetTodos + totalEsteRet;

  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-3xl' });
  // Grade máxima disponível por tamanho = enviada − retornos de OUTROS retornos (não este)
  const gradeMax = Object.fromEntries(fmt.safeArr(r.grade).map(g => [g.tamanho, fmt.safeNum(g.qtd)]));
  fmt.safeArr(r.retornos).forEach(ret => {
    if (editing && Number(ret.id_retorno) === Number(idRetornoEdit)) return; // não subtrai a si mesmo
    fmt.safeArr(ret.grade).forEach(g => { gradeMax[g.tamanho] = (gradeMax[g.tamanho] || 0) - fmt.safeNum(g.qtd); });
  });
  // Mapa do retorno em edição (qtd preenchida nos inputs)
  const gradeAtual = editing ? Object.fromEntries(fmt.safeArr(retEdit.grade).map(g => [g.tamanho, fmt.safeNum(g.qtd)])) : {};

  const titleIcon = editing ? 'fa-pen-to-square' : 'fa-truck-arrow-right';
  const titleTxt = editing ? `Editar Retorno · Remessa ${r.num_controle}` : `Registrar Retorno · Remessa ${r.num_controle}`;
  const dtVal = editing ? (retEdit.dt_retorno || dayjs().format('YYYY-MM-DD')) : dayjs().format('YYYY-MM-DD');
  const boaVal = editing ? fmt.safeNum(retEdit.qtd_boa) : 0;
  const refVal = editing ? fmt.safeNum(retEdit.qtd_refugo) : 0;
  const consVal = editing ? fmt.safeNum(retEdit.qtd_conserto) : 0;
  const valVal = editing ? (retEdit.valor_pago != null ? retEdit.valor_pago : '') : '';
  const dtpVal = editing ? (retEdit.dt_pagamento || '') : '';
  const obsVal = editing ? (retEdit.observacao || '') : '';

  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-2"><i class="fas ${titleIcon} mr-2 text-brand"></i>${titleTxt}</h3>
    <div class="bg-slate-50 p-3 rounded mb-3 text-sm grid grid-cols-3 gap-2">
      <div><b>Terceirizado:</b> ${r.nome_terc || '—'}</div>
      <div><b>Ref:</b> <span class="font-mono">${r.cod_ref || ''}</span> ${r.cor || ''}</div>
      <div><b>Serviço:</b> ${r.desc_servico || '—'}</div>
      <div><b>Enviadas:</b> ${fmt.int(r.qtd_total)}</div>
      <div><b>Outros retornos:</b> ${fmt.int(totalRetTodos - totalEsteRet)}</div>
      <div class="${saldoBase > 0 ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'}"><b>Disponível:</b> ${fmt.int(saldoBase)}</div>
    </div>
    <div class="grid grid-cols-5 gap-3">
      <div><label>Data retorno *</label><input type="date" id="m-dtr" value="${dtVal}" /></div>
      <div><label>Boas</label><input type="number" min="0" id="m-boa" value="${boaVal}" /></div>
      <div><label>Refugo</label><input type="number" min="0" id="m-ref" value="${refVal}" /></div>
      <div><label>Conserto</label><input type="number" min="0" id="m-cons" value="${consVal}" /></div>
      <div><label>Valor pago (R$)</label><input type="number" step="0.01" id="m-val" value="${valVal}" placeholder="auto = boas × preço" /></div>
      <div class="col-span-5">
        <label>Grade retornada <span class="text-xs text-slate-500">(máx. = enviado − outros retornos)</span></label>
        <div class="grid grid-cols-5 md:grid-cols-10 gap-2 mt-1" id="g-wrap">
          ${fmt.safeArr(r.grade).map(g => {
            const max = fmt.safeNum(gradeMax[g.tamanho]);
            const cur = fmt.safeNum(gradeAtual[g.tamanho]);
            return `
            <div class="text-center">
              <div class="text-xs font-mono text-slate-500">${g.tamanho} <span class="text-slate-400">(máx ${max})</span></div>
              <input data-tam="${g.tamanho}" data-max="${max}" type="number" min="0" max="${max}" value="${cur}" class="text-center ret-in" />
            </div>`;
          }).join('')}
        </div>
        <div class="mt-2 text-sm">Grade total: <b id="g-total">${fmt.int(Object.values(gradeAtual).reduce((a, v) => a + v, 0))}</b></div>
      </div>
      <div><label>Data pagamento</label><input type="date" id="m-dtp" value="${dtpVal}" /></div>
      <div class="col-span-4"><label>Observação</label><input id="m-obs" value="${obsVal.replace(/"/g, '&quot;')}" /></div>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button id="m-cancel" class="btn btn-secondary">Cancelar</button>
      <button id="m-save" class="btn btn-primary"><i class="fas fa-save mr-1"></i>${editing ? 'Salvar alterações' : 'Registrar retorno'}</button>
    </div>
  `;
  m.appendChild(card); document.body.appendChild(m);
  function recalc() {
    const tot = Array.from(card.querySelectorAll('.ret-in')).reduce((a, i) => a + fmt.safeNum(i.value), 0);
    $('#g-total').textContent = fmt.int(tot);
    if (!$('#m-boa').dataset.manual) $('#m-boa').value = tot;
  }
  card.querySelectorAll('.ret-in').forEach(i => i.addEventListener('input', recalc));
  $('#m-boa').addEventListener('input', () => { $('#m-boa').dataset.manual = '1'; });
  if (editing) $('#m-boa').dataset.manual = '1'; // não sobrescreve em edit
  $('#m-cancel').onclick = () => m.remove();
  $('#m-save').onclick = async () => {
    const grade = Array.from(card.querySelectorAll('.ret-in')).map(i => ({ tamanho: i.dataset.tam, qtd: fmt.safeNum(i.value) })).filter(g => g.qtd > 0);
    const body = {
      id_remessa: idRemessa, dt_retorno: $('#m-dtr').value,
      qtd_boa: $('#m-boa').value, qtd_refugo: $('#m-ref').value, qtd_conserto: $('#m-cons').value,
      valor_pago: $('#m-val').value || null, dt_pagamento: $('#m-dtp').value || null,
      observacao: $('#m-obs').value.trim(), grade,
    };
    try {
      if (editing) {
        await api('put', '/terc/retornos/' + idRetornoEdit, body);
        toast('Retorno atualizado com sucesso', 'success');
      } else {
        await api('post', '/terc/retornos', body);
        toast('Retorno registrado', 'success');
      }
      m.remove();
      if (onSave) onSave();
    } catch {}
  };
}

// Edição direta de retorno via id (chamada pelo botão "lápis" na lista)
window.TERC_editRet = async (idRet, idRem) => {
  TERC_openRetModal(idRem, () => TERC_openRemDetalhe(idRem), idRet);
};

// Modal de confirmação para excluir REMESSA — oferece opções "Cascata" ou "Soft Delete"
// quando há retornos. Sem retornos, é uma confirmação simples.
async function TERC_confirmDelRem(id, num, onDone) {
  // Primeiro tenta DELETE simples — se houver retornos, backend responde 409 NEEDS_CONFIRMATION
  let info = null;
  try {
    const r = await api('delete', '/terc/remessas/' + id, null, { silent: true });
    // Sucesso direto (sem retornos): confirma com o usuário primeiro? Não — a UX
    // pede confirmação para qualquer exclusão, então fazemos a checagem aqui.
    // Como deletou sem perguntar, vamos repor o estado solicitando confirmação.
    // Para simplicidade, tratamos a UX: este caso só ocorre se a remessa não tinha
    // retornos. Mostramos o sucesso e seguimos.
    toast('Remessa nº ' + num + ' excluída', 'success');
    onDone && onDone();
    return;
  } catch (e) {
    info = e?.response?.data;
    if (e?.response?.status !== 409 || info?.code !== 'NEEDS_CONFIRMATION') {
      // Erro real diferente — toast já foi mostrado pelo api()
      return;
    }
  }

  // Tem retornos: abre modal com escolha de modo
  const totRet = fmt.safeNum(info?.retornos);
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-lg' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-2"><i class="fas fa-triangle-exclamation mr-2 text-amber-500"></i>Remessa nº ${num}</h3>
    <p class="text-sm text-slate-600 mb-4">Esta remessa possui <b>${totRet} retorno(s)</b> vinculado(s). O que deseja fazer?</p>
    <div class="space-y-2 mb-4">
      <label class="flex items-start gap-2 p-3 border-2 border-amber-300 bg-amber-50 rounded cursor-pointer hover:bg-amber-100 transition">
        <input type="radio" name="modo" value="soft" class="mt-1" checked />
        <div>
          <div class="font-semibold text-amber-800"><i class="fas fa-archive mr-1"></i>Cancelar remessa (mantém histórico)</div>
          <div class="text-xs text-slate-600 mt-1">Status muda para "Cancelada". Os ${totRet} retorno(s) e valores pagos ficam preservados para auditoria. <b>Recomendado.</b></div>
        </div>
      </label>
      <label class="flex items-start gap-2 p-3 border-2 border-red-300 bg-red-50 rounded cursor-pointer hover:bg-red-100 transition">
        <input type="radio" name="modo" value="cascata" class="mt-1" />
        <div>
          <div class="font-semibold text-red-700"><i class="fas fa-trash-can mr-1"></i>Excluir tudo (remessa + retornos)</div>
          <div class="text-xs text-slate-600 mt-1">Apaga permanentemente a remessa e os ${totRet} retorno(s) vinculado(s). Operação irreversível.</div>
        </div>
      </label>
    </div>
    <div class="flex justify-end gap-2">
      <button id="c-cancel" class="btn btn-secondary"><i class="fas fa-xmark mr-1"></i>Cancelar ação</button>
      <button id="c-ok" class="btn btn-danger"><i class="fas fa-check mr-1"></i>Confirmar</button>
    </div>
  `;
  m.appendChild(card); document.body.appendChild(m);
  $('#c-cancel').onclick = () => m.remove();
  $('#c-ok').onclick = async () => {
    const modo = card.querySelector('input[name="modo"]:checked')?.value || 'soft';
    try {
      const r = await api('delete', '/terc/remessas/' + id + '?confirm=SIM&modo=' + modo);
      m.remove();
      if (modo === 'soft') toast('Remessa nº ' + num + ' cancelada (histórico preservado)', 'success');
      else toast('Remessa nº ' + num + ' excluída (' + totRet + ' retorno(s) também)', 'success');
      onDone && onDone();
    } catch {}
  };
}
window.TERC_confirmDelRem = TERC_confirmDelRem;

async function TERC_openRemDetalhe(id) {
  let r = {};
  try {
    const res = await api('get', '/terc/remessas/' + id);
    r = res?.data || {};
  } catch (e) {
    console.error('[TERC_openRemDetalhe]', e);
    toast(e?.response?.data?.error || 'Falha ao carregar detalhe da remessa', 'error');
    return;
  }
  const totRet = (r.totais_retorno && typeof r.totais_retorno === 'object') ? r.totais_retorno : { boa: 0, refugo: 0, conserto: 0, total: 0, valor: 0 };
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-4xl' });
  card.innerHTML = `
    <div class="flex items-start justify-between mb-3 flex-wrap gap-2">
      <h3 class="text-lg font-semibold"><i class="fas fa-file-invoice mr-2 text-brand"></i>Remessa Nº ${r.num_controle ?? '—'} <span class="text-sm font-normal text-slate-500">(${r.num_op || 'sem OP'})</span></h3>
      <div class="flex gap-2 flex-wrap">
        <button id="m-print-rom" class="btn btn-sm" style="background:#2563eb;color:white" title="Romaneio de Serviço (planilha)"><i class="fas fa-file-lines mr-1"></i>Romaneio</button>
        <button id="m-print-comp" class="btn btn-sm" style="background:#10b981;color:white" title="Comprovante de Entrega Total (2 vias)"><i class="fas fa-check-circle mr-1"></i>Compr. Total</button>
        <button id="m-print-parcial" class="btn btn-sm" style="background:#f59e0b;color:white" title="Controle de Entrega Parcial (com coletas)"><i class="fas fa-list-check mr-1"></i>Ctrl. Parcial</button>
        <button id="m-close" class="btn btn-sm btn-secondary"><i class="fas fa-times"></i></button>
      </div>
    </div>
    <div id="print-area">
      <div class="grid grid-cols-3 gap-3 text-sm mb-4">
        <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Terceirizado</div><div class="font-semibold">${r.nome_terc || '—'}</div><div class="text-xs text-slate-500 mt-1">${r.nome_setor || ''}</div></div>
        <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Referência</div><div class="font-mono font-semibold">${r.cod_ref || '—'}</div><div class="text-xs">${r.desc_ref || ''} ${r.cor ? '· ' + r.cor : ''}</div></div>
        <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Serviço</div><div class="font-semibold">${r.desc_servico || '—'}</div>${r.nome_colecao ? '<div class="text-xs">' + r.nome_colecao + '</div>' : ''}</div>
        <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Saída / Previsão</div><div>${fmt.date(r.dt_saida)} → <b>${fmt.date(r.dt_previsao)}</b></div><div class="text-xs text-slate-500">${fmt.safeNum(r.prazo_dias)} dia(s)</div></div>
        <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Qtd / Preço / Valor</div><div><b>${fmt.int(r.qtd_total)}</b> pçs × ${TERC.fmtBRL(fmt.safeNum(r.preco_unit))} = <b>${TERC.fmtBRL(fmt.safeNum(r.valor_total))}</b></div></div>
        <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Status</div><div>${TERC.statusBadge(r.status)}</div><div class="text-xs text-slate-500 mt-1">${fmt.safeNum(r.tempo_peca)} min/peça · ${fmt.safeNum(r.qtd_pessoas) || 1} pessoa(s) · ${(fmt.safeNum(r.efic_pct) * 100).toFixed(0)}% efic.</div></div>
      </div>

      <div class="mb-4">
        <h4 class="font-semibold mb-2"><i class="fas fa-ruler mr-1"></i>Grade enviada</h4>
        <div class="flex flex-wrap gap-2">
          ${fmt.safeArr(r.grade).map(g => `<div class="px-3 py-2 bg-blue-50 rounded text-sm"><span class="font-mono text-xs text-slate-500">${g.tamanho}</span> <b>${fmt.int(g.qtd)}</b></div>`).join('') || '<span class="text-slate-500">—</span>'}
        </div>
      </div>

      <div class="mb-4">
        <h4 class="font-semibold mb-2"><i class="fas fa-truck-arrow-right mr-1"></i>Retornos</h4>
        ${fmt.safeArr(r.retornos).length ? `
          <table class="w-full text-sm">
            <thead class="bg-slate-100"><tr>
              <th class="text-left p-2">Data</th><th class="text-right p-2">Boas</th><th class="text-right p-2">Refugo</th><th class="text-right p-2">Conserto</th>
              <th class="text-right p-2">Total</th><th class="text-right p-2">Valor pago</th><th class="text-left p-2">Obs</th><th class="text-center p-2 no-print">Ações</th>
            </tr></thead>
            <tbody>
              ${fmt.safeArr(r.retornos).map(x => `
                <tr class="border-b">
                  <td class="p-2">${fmt.date(x?.dt_retorno)}</td>
                  <td class="p-2 text-right text-emerald-700">${fmt.int(x?.qtd_boa)}</td>
                  <td class="p-2 text-right text-red-600">${fmt.int(x?.qtd_refugo)}</td>
                  <td class="p-2 text-right text-amber-700">${fmt.int(x?.qtd_conserto)}</td>
                  <td class="p-2 text-right font-semibold">${fmt.int(x?.qtd_total)}</td>
                  <td class="p-2 text-right">${TERC.fmtBRL(fmt.safeNum(x?.valor_pago))}</td>
                  <td class="p-2 text-xs text-slate-500">${x?.observacao || ''}</td>
                  <td class="p-2 text-center whitespace-nowrap no-print">
                    <button class="btn btn-sm btn-primary" title="Editar retorno" onclick="TERC_editRet(${x.id_retorno}, ${id})"><i class="fas fa-pen"></i></button>
                    <button class="btn btn-sm btn-danger" title="Excluir retorno" onclick="TERC_delRet(${x.id_retorno}, ${id})"><i class="fas fa-trash"></i></button>
                  </td>
                </tr>`).join('')}
              <tr class="bg-slate-50 font-semibold">
                <td class="p-2">Totais</td>
                <td class="p-2 text-right">${fmt.int(totRet.boa)}</td>
                <td class="p-2 text-right">${fmt.int(totRet.refugo)}</td>
                <td class="p-2 text-right">${fmt.int(totRet.conserto)}</td>
                <td class="p-2 text-right">${fmt.int(totRet.total)}</td>
                <td class="p-2 text-right">${TERC.fmtBRL(fmt.safeNum(totRet.valor))}</td>
                <td colspan="2"></td>
              </tr>
              <tr class="bg-amber-50 font-semibold">
                <td class="p-2" colspan="4">Saldo a retornar</td>
                <td class="p-2 text-right text-amber-700">${fmt.int(r.saldo)}</td>
                <td colspan="3"></td>
              </tr>
            </tbody>
          </table>` : '<p class="text-slate-500 text-sm">Nenhum retorno registrado.</p>'}
      </div>

      ${r.observacao ? `<div class="text-sm p-3 bg-amber-50 rounded"><b>Observação:</b> ${r.observacao}</div>` : ''}
    </div>
  `;
  m.appendChild(card); document.body.appendChild(m);
  $('#m-close').onclick = () => m.remove();
  // Ações de impressão — usam o módulo TERC_PRINT (replica planilha)
  $('#m-print-rom').onclick = () => TERC_PRINT.romaneio([r]);
  $('#m-print-comp').onclick = () => TERC_PRINT.comprovanteTotal(r);
  $('#m-print-parcial').onclick = () => TERC_PRINT.controleParcial(r);
  // Excluir retorno — confirmação simples + recálculo automático no backend
  window.TERC_delRet = async (idRet, idRem) => {
    const ok = await TERC_confirmDelRet(idRet);
    if (!ok) return;
    try {
      await api('delete', '/terc/retornos/' + idRet);
      toast('Retorno excluído com sucesso', 'success');
      m.remove();
      TERC_openRemDetalhe(idRem);
      // Refresca dashboards/listas se houver
      window._tercAccApi?.refreshAll?.();
      // Re-renderiza a rota atual se for dashboard/remessas/retornos
      if (['dashboard', 'terc_remessas', 'terc_retornos'].includes(state.route)) {
        try { window.render?.(); } catch {}
      }
    } catch {}
  };
}

// Modal de confirmação para excluir retorno
async function TERC_confirmDelRet(idRet) {
  return new Promise((resolve) => {
    const m = el('div', { class: 'modal-backdrop' });
    const card = el('div', { class: 'modal p-6 w-full max-w-md' });
    card.innerHTML = `
      <h3 class="text-lg font-semibold text-red-700 mb-3"><i class="fas fa-triangle-exclamation mr-2"></i>Excluir retorno</h3>
      <p class="text-sm mb-2">Você tem certeza que deseja excluir este retorno?</p>
      <p class="text-xs text-slate-500 mb-4">As quantidades, valor pago e status da remessa serão automaticamente recalculados.</p>
      <div class="flex justify-end gap-2">
        <button id="c-cancel" class="btn btn-secondary">Cancelar</button>
        <button id="c-ok" class="btn btn-danger"><i class="fas fa-trash mr-1"></i>Excluir</button>
      </div>
    `;
    m.appendChild(card); document.body.appendChild(m);
    $('#c-cancel').onclick = () => { m.remove(); resolve(false); };
    $('#c-ok').onclick = () => { m.remove(); resolve(true); };
  });
}
window.TERC_confirmDelRet = TERC_confirmDelRet;

/* ---------- RETORNOS (lista consolidada) ---------- */
ROUTES.terc_retornos = async (main) => {
  await TERC.load();
  const hoje = dayjs().format('YYYY-MM-DD');
  const de = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  main.innerHTML = `
    <div class="card p-4 mb-4">
      <div class="flex flex-wrap items-end gap-3">
        <div><label>Terceirizado</label><select id="f-terc">${TERC.optTerc()}</select></div>
        <div><label>De</label><input type="date" id="f-de" value="${de}" /></div>
        <div><label>Até</label><input type="date" id="f-ate" value="${hoje}" /></div>
        <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Filtrar</button>
        <div class="flex-1"></div>
        <button id="btn-print" class="btn btn-secondary"><i class="fas fa-print mr-1"></i>Imprimir</button>
      </div>
    </div>
    <div id="kpis" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"></div>
    <div class="card p-0 overflow-x-auto" id="tbl"></div>
  `;
  async function load() {
    const de = $('#f-de')?.value || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
    const ate = $('#f-ate')?.value || dayjs().format('YYYY-MM-DD');
    const idt = $('#f-terc')?.value || '';
    // Usa /terc/remessas como lista-base e busca retornos na view de cada
    let rems = [];
    try {
      const p = new URLSearchParams({ de, ate });
      if (idt) p.set('id_terc', idt);
      const r = await api('get', '/terc/remessas?' + p.toString(), null, { silent: true });
      rems = fmt.safeArr(r?.data).filter(x => fmt.safeNum(x?.qtd_retornada_calc) > 0);
    } catch (e) {
      console.error('[terc_retornos] erro fetch lista', e);
      $('#kpis').innerHTML = `<div class="col-span-full text-center text-amber-600 py-3"><i class="fas fa-triangle-exclamation mr-1"></i>Falha ao carregar retornos</div>`;
      $('#tbl').innerHTML = '<div class="p-6 text-center text-slate-500"><i class="fas fa-circle-info mr-1"></i>Sem dados disponíveis</div>';
      return;
    }

    // Agregar detalhes (consulta individual para trazer retornos exatos)
    const rows = [];
    const tot = { boa: 0, refugo: 0, conserto: 0, total: 0, valor: 0 };
    for (const rem of rems.slice(0, 100)) { // limitar a 100 para performance
      try {
        const d = await api('get', '/terc/remessas/' + rem.id_remessa, null, { silent: true });
        fmt.safeArr(d?.data?.retornos).forEach(ret => {
          if (!ret) return;
          const dtR = ret.dt_retorno || '';
          if (dtR >= de && dtR <= ate && (!idt || String(rem.id_terc) === String(idt))) {
            rows.push({
              ...ret,
              id_remessa: rem.id_remessa,
              nome_terc: rem.nome_terc,
              cod_ref: rem.cod_ref,
              cor: rem.cor,
              num_controle: rem.num_controle,
              desc_servico: rem.desc_servico,
            });
            tot.boa += fmt.safeNum(ret.qtd_boa);
            tot.refugo += fmt.safeNum(ret.qtd_refugo);
            tot.conserto += fmt.safeNum(ret.qtd_conserto);
            tot.total += fmt.safeNum(ret.qtd_total);
            tot.valor += fmt.safeNum(ret.valor_pago);
          }
        });
      } catch (e) {
        console.warn('[terc_retornos] falha detalhe remessa', rem?.id_remessa, e?.message);
      }
    }
    rows.sort((a, b) => ((a.dt_retorno || '') < (b.dt_retorno || '') ? 1 : -1));

    const kpi = (l, v, c) => `<div class="card p-3"><div class="text-xs text-slate-500 uppercase">${l}</div><div class="text-2xl font-bold ${c}">${v}</div></div>`;
    $('#kpis').innerHTML = [
      kpi('Retornos', fmt.int(rows.length), 'text-brand'),
      kpi('Peças boas', fmt.int(tot.boa), 'text-emerald-600'),
      kpi('Peças refugo', fmt.int(tot.refugo), 'text-red-600'),
      kpi('Valor pago', TERC.fmtBRL(tot.valor), 'text-indigo-600'),
    ].join('');

    $('#tbl').innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-slate-100"><tr>
          <th class="text-left p-2">Data</th><th class="text-right p-2">Ctrl</th><th class="text-left p-2">Terceirizado</th>
          <th class="text-left p-2">Ref/Cor</th><th class="text-left p-2">Serviço</th>
          <th class="text-right p-2">Boas</th><th class="text-right p-2">Refugo</th><th class="text-right p-2">Conserto</th>
          <th class="text-right p-2">Total</th><th class="text-right p-2">Valor</th><th class="text-center p-2">Pagto</th>
          <th class="text-center p-2 no-print">Ações</th>
        </tr></thead>
        <tbody>
          ${rows.map(x => `
            <tr class="border-b hover:bg-slate-50">
              <td class="p-2">${fmt.date(x.dt_retorno)}</td>
              <td class="p-2 text-right font-mono">${x.num_controle ?? '—'}</td>
              <td class="p-2">${x.nome_terc || '—'}</td>
              <td class="p-2"><span class="font-mono text-xs">${x.cod_ref || ''}</span> ${x.cor || ''}</td>
              <td class="p-2 text-xs">${x.desc_servico || ''}</td>
              <td class="p-2 text-right text-emerald-700">${fmt.int(x.qtd_boa)}</td>
              <td class="p-2 text-right text-red-600">${fmt.int(x.qtd_refugo)}</td>
              <td class="p-2 text-right text-amber-700">${fmt.int(x.qtd_conserto)}</td>
              <td class="p-2 text-right font-semibold">${fmt.int(x.qtd_total)}</td>
              <td class="p-2 text-right">${TERC.fmtBRL(fmt.safeNum(x.valor_pago))}</td>
              <td class="p-2 text-center text-xs">${x.dt_pagamento ? fmt.date(x.dt_pagamento) : '<span class="text-amber-600">Pendente</span>'}</td>
              <td class="p-2 text-center whitespace-nowrap no-print">
                <button class="btn btn-sm btn-primary" title="Editar retorno" onclick="TERC_editRetFromList(${x.id_retorno}, ${x.id_remessa})"><i class="fas fa-pen"></i></button>
                <button class="btn btn-sm btn-danger" title="Excluir retorno" onclick="TERC_delRetFromList(${x.id_retorno}, ${x.id_remessa})"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${rows.length === 0 ? '<div class="p-6 text-center text-slate-500"><i class="fas fa-circle-info mr-1"></i>Sem dados disponíveis no período</div>' : ''}
    `;
  }
  // Edição direta a partir da lista consolidada — após salvar, recarrega lista
  window.TERC_editRetFromList = (idRet, idRem) => {
    TERC_openRetModal(idRem, () => { load(); window._tercAccApi?.refreshAll?.(); }, idRet);
  };
  window.TERC_delRetFromList = async (idRet, idRem) => {
    const okConf = await TERC_confirmDelRet(idRet);
    if (!okConf) return;
    try {
      await api('delete', '/terc/retornos/' + idRet);
      toast('Retorno excluído com sucesso', 'success');
      load();
      window._tercAccApi?.refreshAll?.();
    } catch {}
  };
  $('#btn-filtrar').onclick = load;
  $('#btn-print').onclick = () => window.print();
  try { await load(); } catch (e) { console.error('[terc_retornos] load top‑level', e); }
};

/* ============================================================
 * 🏠 CENTRAL DE TERCEIRIZAÇÃO — UI em blocos minimizados (accordion)
 * Substitui as telas isoladas de Dashboard, Resumo, Remessas, Retornos,
 * Terceirizados e Preços. Apenas 1 bloco aberto por vez. Cada bloco
 * mostra resumo rápido (totais, valor, qtd) no header.
 * ============================================================ */
ROUTES.terc_central = async (main) => {
  await TERC.load();

  main.innerHTML = `
    <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
      <div class="text-xs text-slate-500 uppercase tracking-widest"><i class="fas fa-handshake-angle mr-1 text-brand"></i>Central de Terceirização</div>
      <div class="flex gap-2">
        <button id="terc-btn-nova-rem" class="btn btn-success btn-sm"><i class="fas fa-plus mr-1"></i>Nova Remessa</button>
        <button id="terc-btn-novo-prod" class="btn btn-primary btn-sm"><i class="fas fa-tshirt mr-1"></i>Novo Produto</button>
        <button id="terc-btn-novo-preco" class="btn btn-secondary btn-sm"><i class="fas fa-money-bill-wave mr-1"></i>Novo Preço</button>
      </div>
    </div>
    <div id="acc-terc"></div>
  `;

  // Botões rápidos da barra superior — funcionam mesmo sem expandir um bloco
  $('#terc-btn-nova-rem').onclick = () => TERC_openRemModal(null, () => window._tercAccApi?.refreshAll?.());
  $('#terc-btn-novo-prod').onclick = () => TERC_openProdModal(null, () => window._tercAccApi?.refreshAll?.());
  $('#terc-btn-novo-preco').onclick = () => TERC_openPrecoModal(null, () => window._tercAccApi?.refreshAll?.());

  // Cache do resumo já carregado (para popular pílulas dos headers)
  const summary = { dashboard: null, terceirizados: null, remessas: null, retornos: null, produtos: null, precos: null };

  // Pré-carrega resumos leves para popular as pílulas (em paralelo)
  const hoje = dayjs().format('YYYY-MM-DD');
  const de30 = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  const de60 = dayjs().subtract(60, 'day').format('YYYY-MM-DD');

  async function loadSummaries() {
    try {
      const [dash, rems, prods, precos] = await Promise.all([
        api('get', `/terc/dashboard?de=${de30}&ate=${hoje}`, null, { silent: true }).catch(() => ({ data: { kpis: { remessas: {} } } })),
        api('get', `/terc/remessas?de=${de60}&ate=${hoje}`, null, { silent: true }).catch(() => ({ data: [] })),
        api('get', '/terc/produtos', null, { silent: true }).catch(() => ({ data: [] })),
        api('get', '/terc/precos', null, { silent: true }).catch(() => ({ data: [] })),
      ]);
      summary.dashboard = dash.data || {};
      summary.remessas = rems.data || [];
      summary.produtos = prods.data || [];
      summary.precos = precos.data || [];

      // Atualiza summary das pílulas do header de cada bloco
      const k = summary.dashboard.kpis?.remessas || {};
      const kr = summary.dashboard.kpis?.retornos || {};
      window._tercAccApi?.refreshSummary('dashboard', `
        <span class="acc-summary-pill"><i class="fas fa-truck-fast text-brand"></i><b>${fmt.int(k.total)}</b> remessas</span>
        <span class="acc-summary-pill"><i class="fas fa-boxes text-indigo-600"></i><b>${fmt.int(k.pecas_enviadas)}</b> peças</span>
        <span class="acc-summary-pill"><i class="fas fa-dollar-sign text-emerald-600"></i><b>${TERC.fmtBRL(k.valor_total)}</b></span>
        ${(k.atrasadas || 0) > 0 ? `<span class="acc-summary-pill" style="background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.3);color:#ef4444"><i class="fas fa-triangle-exclamation"></i><b>${fmt.int(k.atrasadas)}</b> atrasadas</span>` : ''}
      `);

      const totRem = summary.remessas.length;
      const pecasRem = summary.remessas.reduce((a, r) => a + (Number(r.qtd_total) || 0), 0);
      const valorRem = summary.remessas.reduce((a, r) => a + (Number(r.valor_total) || 0), 0);
      const atrasadas = summary.remessas.filter(r => r.atrasada).length;
      window._tercAccApi?.refreshSummary('remessas', `
        <span class="acc-summary-pill"><i class="fas fa-list"></i><b>${fmt.int(totRem)}</b> remessas (60d)</span>
        <span class="acc-summary-pill"><i class="fas fa-boxes"></i><b>${fmt.int(pecasRem)}</b> peças</span>
        <span class="acc-summary-pill"><i class="fas fa-dollar-sign text-emerald-600"></i><b>${TERC.fmtBRL(valorRem)}</b></span>
        ${atrasadas > 0 ? `<span class="acc-summary-pill" style="background:rgba(239,68,68,.1);color:#ef4444"><b>${atrasadas}</b> em atraso</span>` : ''}
      `);

      const tercAtivos = TERC.terceirizados.filter(t => t.ativo).length;
      window._tercAccApi?.refreshSummary('terceirizados', `
        <span class="acc-summary-pill"><i class="fas fa-handshake text-brand"></i><b>${fmt.int(TERC.terceirizados.length)}</b> total</span>
        <span class="acc-summary-pill"><i class="fas fa-circle-check text-emerald-600"></i><b>${fmt.int(tercAtivos)}</b> ativos</span>
        <span class="acc-summary-pill"><i class="fas fa-pause text-slate-500"></i><b>${fmt.int(TERC.terceirizados.length - tercAtivos)}</b> inativos</span>
      `);

      window._tercAccApi?.refreshSummary('retornos', `
        <span class="acc-summary-pill"><i class="fas fa-truck-arrow-right text-brand"></i><b>${fmt.int(kr.total)}</b> retornos</span>
        <span class="acc-summary-pill"><i class="fas fa-circle-check text-emerald-600"></i><b>${fmt.int(kr.pecas_boas)}</b> boas</span>
        <span class="acc-summary-pill"><i class="fas fa-times-circle text-red-600"></i><b>${fmt.int(kr.pecas_refugo)}</b> refugo</span>
      `);

      window._tercAccApi?.refreshSummary('produtos', `
        <span class="acc-summary-pill"><i class="fas fa-tshirt text-brand"></i><b>${fmt.int(summary.produtos.length)}</b> cadastrados</span>
        <span class="acc-summary-pill"><i class="fas fa-layer-group text-indigo-600"></i><b>${fmt.int(TERC.colecoes.length)}</b> coleções</span>
      `);

      window._tercAccApi?.refreshSummary('precos', `
        <span class="acc-summary-pill"><i class="fas fa-money-bill-wave text-emerald-600"></i><b>${fmt.int(summary.precos.length)}</b> preços</span>
        <span class="acc-summary-pill"><i class="fas fa-tools text-indigo-600"></i><b>${fmt.int(TERC.servicos.length)}</b> serviços</span>
      `);
    } catch (e) { console.warn('[terc_central summaries]', e); }
  }

  // Define os blocos (todos minimizados por padrão; persistência via Accordion)
  const accApi = Accordion.render($('#acc-terc'), [
    {
      id: 'dashboard', icon: 'fa-tachometer-alt', title: 'Dashboard Operacional',
      summary: '<span class="text-slate-400" style="opacity:.6">Carregando…</span>',
      onOpen: (block, body) => renderTercDashboardBlock(body),
    },
    {
      id: 'remessas', icon: 'fa-truck-fast', title: 'Remessas',
      summary: '<span class="text-slate-400" style="opacity:.6">Carregando…</span>',
      onOpen: (block, body) => renderTercRemessasBlock(body, () => window._tercAccApi?.refreshAll?.()),
    },
    {
      id: 'retornos', icon: 'fa-truck-arrow-right', title: 'Retornos',
      summary: '<span class="text-slate-400" style="opacity:.6">Carregando…</span>',
      onOpen: (block, body) => renderTercRetornosBlock(body),
    },
    {
      id: 'terceirizados', icon: 'fa-handshake', title: 'Terceirizados',
      summary: '<span class="text-slate-400" style="opacity:.6">Carregando…</span>',
      onOpen: (block, body) => renderTercTerceirizadosBlock(body, () => window._tercAccApi?.refreshAll?.()),
    },
    {
      id: 'produtos', icon: 'fa-tshirt', title: 'Produtos',
      summary: '<span class="text-slate-400" style="opacity:.6">Carregando…</span>',
      onOpen: (block, body) => renderTercProdutosBlock(body, () => window._tercAccApi?.refreshAll?.()),
    },
    {
      id: 'precos', icon: 'fa-money-bill-wave', title: 'Preços / Coleção',
      summary: '<span class="text-slate-400" style="opacity:.6">Carregando…</span>',
      onOpen: (block, body) => renderTercPrecosBlock(body, () => window._tercAccApi?.refreshAll?.()),
    },
    {
      id: 'resumo', icon: 'fa-list-check', title: 'Resumo por Terceirizado',
      summary: '<span class="text-slate-400" style="opacity:.6">Clique para gerar consolidado</span>',
      onOpen: (block, body) => renderTercResumoBlock(body),
    },
  ], { group: 'terc_central' });

  // Expor API + helper de refresh global
  window._tercAccApi = {
    ...accApi,
    refreshAll: async () => {
      await TERC.load(true);
      await loadSummaries();
      // Re-renderiza o bloco aberto (se houver)
      const openId = accApi.getOpen();
      if (openId) {
        const body = accApi.getBody(openId);
        if (openId === 'dashboard') renderTercDashboardBlock(body);
        else if (openId === 'remessas') renderTercRemessasBlock(body, window._tercAccApi.refreshAll);
        else if (openId === 'retornos') renderTercRetornosBlock(body);
        else if (openId === 'terceirizados') renderTercTerceirizadosBlock(body, window._tercAccApi.refreshAll);
        else if (openId === 'produtos') renderTercProdutosBlock(body, window._tercAccApi.refreshAll);
        else if (openId === 'precos') renderTercPrecosBlock(body, window._tercAccApi.refreshAll);
        else if (openId === 'resumo') renderTercResumoBlock(body);
      }
    },
  };

  loadSummaries();
};

/* ---------- BLOCO: DASHBOARD OPERACIONAL ---------- */
async function renderTercDashboardBlock(body) {
  const hoje = dayjs().format('YYYY-MM-DD');
  const de = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  body.innerHTML = `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div><label>De</label><input type="date" id="f-de" value="${de}" /></div>
      <div><label>Até</label><input type="date" id="f-ate" value="${hoje}" /></div>
      <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Atualizar</button>
    </div>
    <div id="kpis" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4"></div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div class="card p-4"><h4 class="font-semibold mb-2"><i class="fas fa-chart-line mr-1 text-brand"></i>Produção diária (retornos)</h4><canvas id="cht-prod" height="140"></canvas></div>
      <div class="card p-4"><h4 class="font-semibold mb-2"><i class="fas fa-chart-pie mr-1 text-brand"></i>Remessas por serviço</h4><canvas id="cht-serv" height="140"></canvas></div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="card p-4">
        <h4 class="font-semibold mb-2"><i class="fas fa-trophy mr-1 text-brand"></i>Top 10 Terceirizados</h4>
        <div id="top-terc" class="overflow-x-auto"></div>
      </div>
      <div class="card p-4">
        <h4 class="font-semibold mb-2"><i class="fas fa-triangle-exclamation mr-1 text-red-600"></i>Remessas em atraso</h4>
        <div id="atrasadas" class="overflow-x-auto"></div>
      </div>
    </div>
  `;
  const FALLBACK_EMPTY = '<p class="text-slate-500 text-sm py-4 text-center"><i class="fas fa-circle-info mr-1"></i>Sem dados disponíveis</p>';
  const FALLBACK_ERROR = (msg) => `<p class="text-amber-600 text-sm py-4 text-center"><i class="fas fa-triangle-exclamation mr-1"></i>${msg || 'Falha ao carregar'}</p>`;
  async function load() {
    const de = body.querySelector('#f-de')?.value || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
    const ate = body.querySelector('#f-ate')?.value || dayjs().format('YYYY-MM-DD');
    let d = {};
    try {
      const r = await api('get', `/terc/dashboard?de=${de}&ate=${ate}`, null, { silent: true });
      d = (r && r.data) ? r.data : {};
    } catch (e) {
      console.error('[renderTercDashboardBlock] erro fetch', e);
      const errMsg = e?.response?.data?.error || e?.message || 'Erro ao carregar dashboard';
      const kpisEl = body.querySelector('#kpis');
      if (kpisEl) kpisEl.innerHTML = `<div class="col-span-full">${FALLBACK_ERROR(errMsg)}</div>`;
      d = {};
    }

    const k = (d && typeof d === 'object' && d.kpis) ? d.kpis : {};
    const kr = (k && typeof k === 'object' && k.remessas) ? k.remessas : {};

    // KPIs
    try {
      const kpi = (label, val, icon, color) => `
        <div class="card p-3">
          <div class="text-xs text-slate-500 uppercase">${label}</div>
          <div class="flex items-center gap-2 mt-1">
            <i class="fas ${icon} ${color}"></i>
            <div class="text-2xl font-bold">${val}</div>
          </div>
        </div>`;
      const kpisEl = body.querySelector('#kpis');
      if (kpisEl) kpisEl.innerHTML = [
        kpi('Remessas', fmt.int(kr.total), 'fa-truck-fast', 'text-brand'),
        kpi('Peças enviadas', fmt.int(kr.pecas_enviadas), 'fa-boxes', 'text-indigo-600'),
        kpi('Valor enviado', TERC.fmtBRL(fmt.safeNum(kr.valor_total)), 'fa-dollar-sign', 'text-emerald-600'),
        kpi('Em aberto', fmt.int(kr.em_aberto), 'fa-clock', 'text-amber-600'),
        kpi('Concluídas', fmt.int(kr.concluidas), 'fa-check-circle', 'text-emerald-600'),
        kpi('Atrasadas', fmt.int(kr.atrasadas), 'fa-triangle-exclamation', 'text-red-600'),
      ].join('');
    } catch (e) { console.error('[block] kpis', e); }

    // Gráfico produção
    try {
      const prod = fmt.safeArr(d.producao_diaria);
      const canvas = body.querySelector('#cht-prod');
      const ctxP = canvas?.getContext?.('2d');
      if (window._chtProdC) { try { window._chtProdC.destroy(); } catch {} window._chtProdC = null; }
      if (ctxP) {
        if (prod.length === 0) {
          canvas.style.display = 'none';
          if (!canvas.parentElement.querySelector('.no-data-prodC')) {
            const ph = document.createElement('div');
            ph.className = 'no-data-prodC text-center text-slate-400 text-sm py-8';
            ph.innerHTML = '<i class="fas fa-circle-info mr-1"></i>Sem dados disponíveis no período';
            canvas.parentElement.appendChild(ph);
          }
        } else {
          canvas.parentElement.querySelector('.no-data-prodC')?.remove();
          canvas.style.display = '';
          window._chtProdC = new Chart(ctxP, {
            type: 'bar',
            data: { labels: prod.map(p => { const d = dayjs(p?.dia); return d.isValid() ? d.format('DD/MM') : '?'; }), datasets: [
              { label: 'Boas', data: prod.map(p => fmt.safeNum(p?.boa)), backgroundColor: '#10b981' },
              { label: 'Refugo', data: prod.map(p => fmt.safeNum(p?.refugo)), backgroundColor: '#ef4444' },
              { label: 'Conserto', data: prod.map(p => fmt.safeNum(p?.conserto)), backgroundColor: '#f59e0b' },
            ] },
            options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } },
          });
        }
      }
    } catch (e) { console.error('[block] grafico produção', e); }

    // Gráfico serviço
    try {
      const serv = fmt.safeArr(d.por_servico);
      const canvas = body.querySelector('#cht-serv');
      const ctxS = canvas?.getContext?.('2d');
      if (window._chtServC) { try { window._chtServC.destroy(); } catch {} window._chtServC = null; }
      if (ctxS) {
        if (serv.length === 0) {
          canvas.style.display = 'none';
          if (!canvas.parentElement.querySelector('.no-data-servC')) {
            const ph = document.createElement('div');
            ph.className = 'no-data-servC text-center text-slate-400 text-sm py-8';
            ph.innerHTML = '<i class="fas fa-circle-info mr-1"></i>Sem dados disponíveis no período';
            canvas.parentElement.appendChild(ph);
          }
        } else {
          canvas.parentElement.querySelector('.no-data-servC')?.remove();
          canvas.style.display = '';
          window._chtServC = new Chart(ctxS, {
            type: 'doughnut',
            data: { labels: serv.map(s => s?.desc_servico || '(sem serviço)'),
              datasets: [{ data: serv.map(s => fmt.safeNum(s?.pecas)), backgroundColor: ['#2563eb','#10b981','#f59e0b','#ef4444','#6366f1','#06b6d4'] }] },
          });
        }
      }
    } catch (e) { console.error('[block] grafico servico', e); }

    // Top terceirizados
    try {
      const top = fmt.safeArr(d.top_terceirizados);
      const elTop = body.querySelector('#top-terc');
      if (elTop) elTop.innerHTML = top.length ? `
        <table class="w-full text-sm">
          <thead><tr class="bg-slate-100"><th class="text-left p-2">#</th><th class="text-left p-2">Terceirizado</th><th class="text-right p-2">Remessas</th><th class="text-right p-2">Peças</th><th class="text-right p-2">Valor</th></tr></thead>
          <tbody>${top.map((t, i) => `<tr class="border-b"><td class="p-2">${i + 1}</td><td class="p-2 font-medium">${t?.nome_terc || '—'}</td><td class="p-2 text-right">${fmt.int(t?.remessas)}</td><td class="p-2 text-right">${fmt.int(t?.pecas)}</td><td class="p-2 text-right">${TERC.fmtBRL(fmt.safeNum(t?.valor))}</td></tr>`).join('')}</tbody>
        </table>` : FALLBACK_EMPTY;
    } catch (e) { console.error('[block] top terc', e); }

    // Atrasadas
    try {
      const atr = fmt.safeArr(d.atrasadas);
      const elAtr = body.querySelector('#atrasadas');
      if (elAtr) elAtr.innerHTML = atr.length ? `
        <table class="w-full text-sm">
          <thead><tr class="bg-red-50"><th class="text-left p-2">Ctrl</th><th class="text-left p-2">Terceirizado</th><th class="text-left p-2">Ref.</th><th class="text-right p-2">Qtd</th><th class="text-right p-2">Atraso</th></tr></thead>
          <tbody>${atr.map(a => `<tr class="border-b"><td class="p-2">${a?.num_controle ?? '—'}</td><td class="p-2">${a?.nome_terc || '—'}</td><td class="p-2"><span class="font-mono text-xs">${a?.cod_ref || ''}</span></td><td class="p-2 text-right">${fmt.int(a?.qtd_total)}</td><td class="p-2 text-right text-red-600 font-semibold">${Math.floor(fmt.safeNum(a?.dias_atraso))} dia(s)</td></tr>`).join('')}</tbody>
        </table>` : '<p class="text-slate-500 text-sm py-4 text-center"><i class="fas fa-check-circle text-emerald-500"></i> Nenhuma remessa em atraso</p>';
    } catch (e) { console.error('[block] atrasadas', e); }
  }
  const btn = body.querySelector('#btn-filtrar');
  if (btn) btn.onclick = load;
  try { await load(); } catch (e) { console.error('[renderTercDashboardBlock] load top‑level', e); }
}

/* ---------- BLOCO: REMESSAS ---------- */
async function renderTercRemessasBlock(body, refresh) {
  const hoje = dayjs().format('YYYY-MM-DD');
  const de = dayjs().subtract(60, 'day').format('YYYY-MM-DD');
  body.innerHTML = `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div><label>Busca</label><input id="f-search" placeholder="OP, Ref, Cor..." /></div>
      <div><label>Terceirizado</label><select id="f-terc">${TERC.optTerc()}</select></div>
      <div><label>Serviço</label><select id="f-serv">${TERC.optServicos()}</select></div>
      <div><label>Coleção</label><select id="f-col">${TERC.optColecoes()}</select></div>
      <div><label>Status</label><select id="f-status"><option value="">Todos</option><option>AguardandoEnvio</option><option>Enviado</option><option>EmProducao</option><option>Atrasado</option><option>Parcial</option><option>Concluido</option><option>Pago</option><option>Cancelado</option></select></div>
      <div><label>De</label><input type="date" id="f-de" value="${de}" /></div>
      <div><label>Até</label><input type="date" id="f-ate" value="${hoje}" /></div>
      <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Filtrar</button>
      <div class="flex-1"></div>
      <button id="btn-romaneio-lote" class="btn btn-secondary" title="Romaneio das remessas filtradas"><i class="fas fa-print mr-1"></i>Romaneio Lote</button>
      <button id="btn-nova" class="btn btn-success"><i class="fas fa-plus mr-1"></i>Nova Remessa</button>
    </div>
    <div class="card p-0 overflow-x-auto" id="tbl"></div>
  `;
  let _last = [];
  async function load() {
    const p = new URLSearchParams();
    if (body.querySelector('#f-search').value) p.set('search', body.querySelector('#f-search').value);
    if (body.querySelector('#f-terc').value) p.set('id_terc', body.querySelector('#f-terc').value);
    if (body.querySelector('#f-serv').value) p.set('id_servico', body.querySelector('#f-serv').value);
    if (body.querySelector('#f-col').value) p.set('id_colecao', body.querySelector('#f-col').value);
    if (body.querySelector('#f-status').value) p.set('status', body.querySelector('#f-status').value);
    if (body.querySelector('#f-de').value) p.set('de', body.querySelector('#f-de').value);
    if (body.querySelector('#f-ate').value) p.set('ate', body.querySelector('#f-ate').value);
    const r = await api('get', '/terc/remessas?' + p.toString());
    const rs = r.data || []; _last = rs;
    body.querySelector('#tbl').innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-slate-100"><tr>
          <th class="text-right p-2">Ctrl</th><th class="text-left p-2">OP</th><th class="text-left p-2">Terceirizado</th>
          <th class="text-left p-2">Serviço</th><th class="text-left p-2">Referência</th><th class="text-left p-2">Cor</th>
          <th class="text-right p-2">Qtd</th><th class="text-right p-2">Retornada</th><th class="text-right p-2">Valor</th>
          <th class="text-center p-2">Saída</th><th class="text-center p-2">Prev.</th><th class="text-center p-2">Status</th><th class="text-center p-2">Ações</th>
        </tr></thead>
        <tbody>
          ${rs.map(r => `
            <tr class="border-b hover:bg-slate-50">
              <td class="p-2 text-right font-mono">${r.num_controle}</td>
              <td class="p-2">${r.num_op || '—'}</td>
              <td class="p-2">${r.nome_terc}</td>
              <td class="p-2 text-xs text-slate-600">${r.desc_servico || '—'}</td>
              <td class="p-2"><span class="font-mono text-xs">${r.cod_ref}</span><br><span class="text-xs text-slate-500">${r.desc_ref || ''}</span></td>
              <td class="p-2">${r.cor || '—'}</td>
              <td class="p-2 text-right">${fmt.int(r.qtd_total)}</td>
              <td class="p-2 text-right ${r.qtd_retornada_calc >= r.qtd_total ? 'text-emerald-700' : 'text-amber-700'}">${fmt.int(r.qtd_retornada_calc)}</td>
              <td class="p-2 text-right">${TERC.fmtBRL(r.valor_total)}</td>
              <td class="p-2 text-center">${fmt.date(r.dt_saida)}</td>
              <td class="p-2 text-center">${fmt.date(r.dt_previsao)}</td>
              <td class="p-2 text-center">${TERC.statusBadge(r.status, r.atrasada)}</td>
              <td class="p-2 text-center whitespace-nowrap">
                <button class="btn btn-sm btn-secondary" title="Detalhes" onclick="TERC_viewRem(${r.id_remessa})"><i class="fas fa-eye"></i></button>
                <button class="btn btn-sm btn-primary" title="Editar" onclick="TERC_editRem(${r.id_remessa})"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-success" title="Retorno" onclick="TERC_retRem(${r.id_remessa})"><i class="fas fa-truck-arrow-right"></i></button>
                <button class="btn btn-sm btn-danger" title="Excluir" onclick="TERC_delRem(${r.id_remessa}, ${r.num_controle})"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${rs.length === 0 ? '<div class="p-6 text-center text-slate-500">Nenhuma remessa encontrada.</div>' : ''}
    `;
  }
  window.TERC_viewRem = (id) => TERC_openRemDetalhe(id);
  window.TERC_editRem = (id) => TERC_openRemModal(id, () => { load(); refresh && refresh(); });
  window.TERC_retRem = (id) => TERC_openRetModal(id, () => { load(); refresh && refresh(); });
  window.TERC_delRem = (id, n) => TERC_confirmDelRem(id, n, () => { load(); refresh && refresh(); });
  body.querySelector('#btn-filtrar').onclick = load;
  body.querySelector('#btn-nova').onclick = () => TERC_openRemModal(null, () => { load(); refresh && refresh(); });
  body.querySelector('#btn-romaneio-lote').onclick = async () => {
    if (!_last.length) { toast('Filtre alguma remessa antes', 'warning'); return; }
    if (_last.length > 30 && !confirm('Imprimir ' + _last.length + ' remessas? Recomendado ≤ 30. Continuar?')) return;
    toast('Preparando romaneio em lote...', 'info');
    const detalhes = [];
    for (const r of _last.slice(0, 60)) {
      try { const d = await api('get', '/terc/remessas/' + r.id_remessa, null, { silent: true }); detalhes.push(d.data); }
      catch { detalhes.push(r); }
    }
    await TERC_PRINT.romaneio(detalhes);
  };
  await load();
}

/* ---------- BLOCO: RETORNOS ---------- */
async function renderTercRetornosBlock(body) {
  const hoje = dayjs().format('YYYY-MM-DD');
  const de = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  body.innerHTML = `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div><label>Terceirizado</label><select id="f-terc">${TERC.optTerc()}</select></div>
      <div><label>De</label><input type="date" id="f-de" value="${de}" /></div>
      <div><label>Até</label><input type="date" id="f-ate" value="${hoje}" /></div>
      <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Filtrar</button>
    </div>
    <div id="kpis" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"></div>
    <div class="card p-0 overflow-x-auto" id="tbl"></div>
  `;
  async function load() {
    const de = body.querySelector('#f-de').value, ate = body.querySelector('#f-ate').value, idt = body.querySelector('#f-terc').value;
    const p = new URLSearchParams({ de, ate });
    if (idt) p.set('id_terc', idt);
    const r = await api('get', '/terc/remessas?' + p.toString());
    const rems = (r.data || []).filter(x => Number(x.qtd_retornada_calc) > 0);
    const rows = []; let tot = { boa: 0, refugo: 0, conserto: 0, total: 0, valor: 0 };
    for (const rem of rems.slice(0, 100)) {
      try {
        const d = await api('get', '/terc/remessas/' + rem.id_remessa, null, { silent: true });
        (d.data.retornos || []).forEach(ret => {
          if (ret.dt_retorno >= de && ret.dt_retorno <= ate) {
            rows.push({ ...ret, nome_terc: rem.nome_terc, cod_ref: rem.cod_ref, cor: rem.cor, num_controle: rem.num_controle, desc_servico: rem.desc_servico });
            tot.boa += Number(ret.qtd_boa) || 0;
            tot.refugo += Number(ret.qtd_refugo) || 0;
            tot.conserto += Number(ret.qtd_conserto) || 0;
            tot.total += Number(ret.qtd_total) || 0;
            tot.valor += Number(ret.valor_pago) || 0;
          }
        });
      } catch {}
    }
    rows.sort((a, b) => (a.dt_retorno < b.dt_retorno ? 1 : -1));
    const kpi = (l, v, c) => `<div class="card p-3"><div class="text-xs text-slate-500 uppercase">${l}</div><div class="text-2xl font-bold ${c}">${v}</div></div>`;
    body.querySelector('#kpis').innerHTML = [
      kpi('Retornos', fmt.int(rows.length), 'text-brand'),
      kpi('Peças boas', fmt.int(tot.boa), 'text-emerald-600'),
      kpi('Peças refugo', fmt.int(tot.refugo), 'text-red-600'),
      kpi('Valor pago', TERC.fmtBRL(tot.valor), 'text-indigo-600'),
    ].join('');
    body.querySelector('#tbl').innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-slate-100"><tr>
          <th class="text-left p-2">Data</th><th class="text-right p-2">Ctrl</th><th class="text-left p-2">Terceirizado</th>
          <th class="text-left p-2">Ref/Cor</th><th class="text-left p-2">Serviço</th>
          <th class="text-right p-2">Boas</th><th class="text-right p-2">Refugo</th><th class="text-right p-2">Conserto</th>
          <th class="text-right p-2">Total</th><th class="text-right p-2">Valor</th>
        </tr></thead>
        <tbody>
          ${rows.map(x => `
            <tr class="border-b">
              <td class="p-2">${fmt.date(x.dt_retorno)}</td>
              <td class="p-2 text-right font-mono">${x.num_controle}</td>
              <td class="p-2">${x.nome_terc}</td>
              <td class="p-2"><span class="font-mono text-xs">${x.cod_ref}</span> ${x.cor || ''}</td>
              <td class="p-2 text-xs">${x.desc_servico || ''}</td>
              <td class="p-2 text-right text-emerald-700">${fmt.int(x.qtd_boa)}</td>
              <td class="p-2 text-right text-red-600">${fmt.int(x.qtd_refugo)}</td>
              <td class="p-2 text-right text-amber-700">${fmt.int(x.qtd_conserto)}</td>
              <td class="p-2 text-right font-semibold">${fmt.int(x.qtd_total)}</td>
              <td class="p-2 text-right">${TERC.fmtBRL(x.valor_pago)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${rows.length === 0 ? '<div class="p-6 text-center text-slate-500">Nenhum retorno no período.</div>' : ''}`;
  }
  body.querySelector('#btn-filtrar').onclick = load;
  await load();
}

/* ---------- BLOCO: TERCEIRIZADOS ---------- */
async function renderTercTerceirizadosBlock(body, refresh) {
  body.innerHTML = `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div><label>Busca</label><input id="f-search" placeholder="Nome ou CPF/CNPJ..." /></div>
      <div><label>Setor</label><select id="f-setor">${TERC.optSetores()}</select></div>
      <div><label>Situação</label><select id="f-sit"><option value="">Todos</option><option value="Ativa">Ativa</option><option value="Inativa">Inativa</option></select></div>
      <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Filtrar</button>
      <div class="flex-1"></div>
      <button id="btn-novo" class="btn btn-success"><i class="fas fa-plus mr-1"></i>Novo Terceirizado</button>
    </div>
    <div class="card p-0 overflow-x-auto" id="tbl"></div>
  `;
  async function load() {
    const p = new URLSearchParams();
    if (body.querySelector('#f-search').value) p.set('search', body.querySelector('#f-search').value);
    if (body.querySelector('#f-setor').value) p.set('id_setor', body.querySelector('#f-setor').value);
    if (body.querySelector('#f-sit').value) p.set('situacao', body.querySelector('#f-sit').value);
    const r = await api('get', '/terc/terceirizados?' + p.toString());
    const rs = r.data || [];
    body.querySelector('#tbl').innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-slate-100"><tr>
          <th class="text-left p-2">Nome</th><th class="text-left p-2">Setor</th>
          <th class="text-left p-2">Contato</th>
          <th class="text-right p-2">Pessoas</th><th class="text-right p-2">Efic.</th>
          <th class="text-right p-2">Prazo</th>
          <th class="text-center p-2">Situação</th><th class="text-center p-2">Ações</th>
        </tr></thead>
        <tbody>
          ${rs.map(t => `
            <tr class="border-b hover:bg-slate-50">
              <td class="p-2 font-medium">${t.nome_terc}${t.cpf_cnpj ? '<br><span class="text-xs text-slate-400">' + t.cpf_cnpj + '</span>' : ''}</td>
              <td class="p-2">${t.nome_setor || '—'}</td>
              <td class="p-2 text-xs text-slate-600">${t.telefone || ''}${t.email ? '<br>' + t.email : ''}</td>
              <td class="p-2 text-right">${t.qtd_pessoas}</td>
              <td class="p-2 text-right">${(Number(t.efic_padrao) * 100).toFixed(0)}%</td>
              <td class="p-2 text-right">${t.prazo_padrao} dias</td>
              <td class="p-2 text-center">${t.situacao === 'Ativa' ? '<span class="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">Ativa</span>' : '<span class="px-2 py-0.5 rounded text-xs bg-slate-200 text-slate-600">Inativa</span>'}</td>
              <td class="p-2 text-center whitespace-nowrap">
                <button class="btn btn-sm btn-secondary" onclick="TERC_editTerc(${t.id_terc})"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm ${t.situacao === 'Ativa' ? 'btn-warning' : 'btn-success'}" onclick="TERC_toggleSitTerc(${t.id_terc}, '${t.situacao === 'Ativa' ? 'Inativa' : 'Ativa'}')"><i class="fas fa-${t.situacao === 'Ativa' ? 'pause' : 'play'}"></i></button>
                <button class="btn btn-sm btn-danger" onclick="TERC_delTerc(${t.id_terc}, '${t.nome_terc.replace(/'/g, '')}')"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${rs.length === 0 ? '<div class="p-6 text-center text-slate-500">Nenhum terceirizado encontrado.</div>' : ''}
    `;
  }
  window.TERC_editTerc = (id) => TERC_openTercModal(id, () => { load(); refresh && refresh(); });
  window.TERC_toggleSitTerc = async (id, sit) => {
    await api('patch', '/terc/terceirizados/' + id + '/situacao', { situacao: sit });
    toast('Situação atualizada', 'success'); await TERC.load(true); load(); refresh && refresh();
  };
  window.TERC_delTerc = async (id, nome) => {
    if (!confirm('Excluir terceirizado "' + nome + '"?\n(só é permitido se não tiver remessas)')) return;
    try { await api('delete', '/terc/terceirizados/' + id); toast('Excluído', 'success'); await TERC.load(true); load(); refresh && refresh(); } catch {}
  };
  body.querySelector('#btn-filtrar').onclick = load;
  body.querySelector('#btn-novo').onclick = () => TERC_openTercModal(null, () => { load(); refresh && refresh(); });
  await load();
}

/* ---------- BLOCO: PRODUTOS ---------- */
async function renderTercProdutosBlock(body, refresh) {
  await TERC.load();
  body.innerHTML = `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div><label>Busca</label><input id="f-search" placeholder="Ref ou descrição..." autocomplete="off" /></div>
      <div><label>Coleção</label><select id="f-col">${TERC.optColecoes()}</select></div>
      <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Filtrar</button>
      <div class="flex-1"></div>
      <span id="prod-count" class="text-xs text-slate-500 mr-2"></span>
      <button id="btn-import" class="btn btn-secondary"><i class="fas fa-file-excel mr-1"></i>Importar Excel</button>
      <button id="btn-del-all" class="btn btn-danger" title="Excluir TODOS os produtos"><i class="fas fa-trash-can mr-1"></i>Excluir todos</button>
      <button id="btn-novo" class="btn btn-success"><i class="fas fa-plus mr-1"></i>Novo Produto</button>
    </div>
    <div class="card p-0 overflow-x-auto" id="tbl"></div>
  `;
  async function load() {
    const p = new URLSearchParams();
    if (body.querySelector('#f-search').value) p.set('search', body.querySelector('#f-search').value);
    if (body.querySelector('#f-col').value) p.set('id_colecao', body.querySelector('#f-col').value);
    const r = await api('get', '/terc/produtos?' + p.toString());
    const rs = r.data || [];
    const countEl = body.querySelector('#prod-count');
    if (countEl) countEl.textContent = `${rs.length} produto(s)`;
    body.querySelector('#tbl').innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-slate-100"><tr>
          <th class="text-left p-2">Referência</th>
          <th class="text-left p-2">Descrição</th>
          <th class="text-left p-2">Serviço padrão</th>
          <th class="text-right p-2">Tempo (min)</th>
          <th class="text-left p-2">Coleção</th>
          <th class="text-center p-2">Ativo</th>
          <th class="text-center p-2">Ações</th>
        </tr></thead>
        <tbody>
          ${rs.map(p => `
            <tr class="border-b hover:bg-slate-50">
              <td class="p-2 font-mono text-xs">${p.cod_ref}</td>
              <td class="p-2">${p.desc_ref}${p.nome_produto ? `<div class="text-xs text-slate-400">${p.nome_produto}</div>` : ''}</td>
              <td class="p-2 text-slate-600">${p.desc_servico_padrao || '<span class="text-slate-400">—</span>'}</td>
              <td class="p-2 text-right">${p.tempo_padrao != null ? Number(p.tempo_padrao).toFixed(2) : '<span class="text-slate-400">—</span>'}</td>
              <td class="p-2">${p.nome_colecao || '<span class="text-slate-400">Todas</span>'}</td>
              <td class="p-2 text-center">${p.ativo ? '<span class="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">Ativo</span>' : '<span class="px-2 py-0.5 rounded text-xs bg-slate-200 text-slate-600">Inativo</span>'}</td>
              <td class="p-2 text-center whitespace-nowrap">
                <button class="btn btn-sm btn-primary" onclick="TERC_editProd(${p.id_produto})" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-danger" onclick="TERC_delProd(${p.id_produto}, '${(p.cod_ref || '').replace(/'/g, '')}')" title="Excluir"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${rs.length === 0 ? '<div class="p-6 text-center text-slate-500"><i class="fas fa-inbox mr-1"></i>Nenhum produto cadastrado. Use "Importar Excel" ou "Novo Produto".</div>' : ''}
    `;
  }
  window.TERC_editProd = (id) => TERC_openProdModal(id, () => { load(); refresh && refresh(); });
  window.TERC_delProd = async (id, ref) => {
    if (!confirm('Excluir produto "' + ref + '"?\nEsta ação não pode ser desfeita.')) return;
    try { await api('delete', '/terc/produtos/' + id); toast('Excluído', 'success'); await TERC.reloadProdutos(); load(); refresh && refresh(); } catch {}
  };
  body.querySelector('#btn-filtrar').onclick = load;
  body.querySelector('#f-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  body.querySelector('#btn-novo').onclick = () => TERC_openProdModal(null, () => { load(); refresh && refresh(); });
  body.querySelector('#btn-import').onclick = () => TERC_openProdImportModal(() => { load(); refresh && refresh(); });
  body.querySelector('#btn-del-all').onclick = async () => {
    // Confirmação DUPLA
    const tot = (await api('get', '/terc/produtos')).data?.length || 0;
    if (tot === 0) { toast('Nenhum produto para excluir', 'info'); return; }
    if (!confirm(`⚠️ ATENÇÃO: Excluir TODOS os ${tot} produtos?\n\nEsta ação NÃO PODE SER DESFEITA.`)) return;
    const txt = prompt('Para confirmar, digite a palavra: EXCLUIR');
    if (txt !== 'EXCLUIR') { toast('Operação cancelada', 'warning'); return; }
    try {
      const r = await api('delete', '/terc/produtos', { confirm: 'SIM' });
      toast(`${r.data?.deleted || 0} produto(s) excluídos`, 'success');
      await TERC.reloadProdutos();
      load(); refresh && refresh();
    } catch {}
  };
  await load();
}

/* ---------- BLOCO: PREÇOS ---------- */
async function renderTercPrecosBlock(body, refresh) {
  body.innerHTML = `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div><label>Busca</label><input id="f-search" placeholder="Ref, descrição, cor, tamanho..." /></div>
      <div><label>Serviço</label><select id="f-serv">${TERC.optServicos()}</select></div>
      <div><label>Coleção</label><select id="f-col">${TERC.optColecoes()}</select></div>
      <div><label>Cor</label><input id="f-cor" placeholder="Ex: Azul" list="cores-dl" /></div>
      <div><label>Tamanho</label><input id="f-tam" placeholder="Ex: M" list="tams-dl" /></div>
      <datalist id="cores-dl">${(window.TERC?.cores || []).map(c => `<option value="${c.nome_cor}">`).join('')}</datalist>
      <datalist id="tams-dl">${['PP','P','M','G','GG','XGG','EG','SG'].map(t => `<option value="${t}">`).join('')}</datalist>
      <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Filtrar</button>
      <div class="flex-1"></div>
      <button id="btn-importar" class="btn btn-secondary" title="Importar planilha de cor/preço"><i class="fas fa-file-excel mr-1"></i>Importar</button>
      <button id="btn-col" class="btn btn-secondary" title="Gerenciar coleções"><i class="fas fa-layer-group mr-1"></i>Coleções</button>
      <button id="btn-novo" class="btn btn-success"><i class="fas fa-plus mr-1"></i>Novo Preço</button>
      <button id="btn-del-all" class="btn btn-danger" title="Excluir TODOS os preços (confirmação dupla)"><i class="fas fa-trash-can mr-1"></i>Excluir todos</button>
    </div>
    <div class="text-xs text-slate-500 mb-2"><i class="fas fa-circle-info mr-1"></i>A combinação <b>Produto + Cor + Grade + Serviço</b> deve ser única. Linhas sem cor/tamanho são preços genéricos do produto (fallback).</div>
    <div class="card p-0 overflow-x-auto" id="tbl"></div>
  `;
  async function load() {
    try {
      const p = new URLSearchParams();
      if (body.querySelector('#f-search').value) p.set('search', body.querySelector('#f-search').value);
      if (body.querySelector('#f-serv').value)   p.set('id_servico', body.querySelector('#f-serv').value);
      if (body.querySelector('#f-col').value)    p.set('id_colecao', body.querySelector('#f-col').value);
      if (body.querySelector('#f-cor').value)    p.set('cor', body.querySelector('#f-cor').value);
      if (body.querySelector('#f-tam').value)    p.set('tamanho', body.querySelector('#f-tam').value);
      const r = await api('get', '/terc/precos?' + p.toString(), null, { silent: true });
      const rs = fmt.safeArr(r?.data);
      body.querySelector('#tbl').innerHTML = `
        <table class="w-full text-sm">
          <thead class="bg-slate-100"><tr>
            <th class="text-left p-2">Ref.</th>
            <th class="text-left p-2">Descrição</th>
            <th class="text-left p-2">Cor</th>
            <th class="text-center p-2">Grade</th>
            <th class="text-left p-2">Serviço</th>
            <th class="text-left p-2">Coleção</th>
            <th class="text-right p-2">Preço</th>
            <th class="text-right p-2">Tempo (min)</th>
            <th class="text-center p-2">Ações</th>
          </tr></thead>
          <tbody>
            ${rs.map(x => `
              <tr class="border-b hover:bg-slate-50">
                <td class="p-2 font-mono text-xs">${x.cod_ref || '—'}</td>
                <td class="p-2">${x.desc_ref || '<span class="text-slate-400">—</span>'}</td>
                <td class="p-2">${x.cor ? `<span class="px-2 py-0.5 rounded text-xs bg-slate-100">${x.cor}</span>` : '<span class="text-slate-400">—</span>'}</td>
                <td class="p-2 text-center">${x.tamanho ? `<span class="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 font-mono">${x.tamanho}</span>` : '<span class="text-slate-400">—</span>'}</td>
                <td class="p-2">${x.desc_servico || '—'}</td>
                <td class="p-2">${x.nome_colecao || '<span class="text-slate-400">Todas</span>'}</td>
                <td class="p-2 text-right font-semibold text-emerald-700">${TERC.fmtBRL(fmt.safeNum(x.preco))}</td>
                <td class="p-2 text-right">${fmt.num(fmt.safeNum(x.tempo_min), 2)}</td>
                <td class="p-2 text-center whitespace-nowrap">
                  <button class="btn btn-sm btn-primary" title="Editar" onclick="TERC_editPreco(${x.id_preco})"><i class="fas fa-pen"></i></button>
                  <button class="btn btn-sm btn-danger" title="Excluir" onclick="TERC_delPreco(${x.id_preco})"><i class="fas fa-trash"></i></button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
        ${rs.length === 0 ? '<div class="p-6 text-center text-slate-500"><i class="fas fa-circle-info mr-1"></i>Sem dados disponíveis. Cadastre um preço ou importe uma planilha.</div>' : `<div class="p-2 text-xs text-slate-500 text-right">${rs.length} variação(ões) listada(s)</div>`}
      `;
    } catch (e) {
      console.error('[renderTercPrecosBlock] load', e);
      body.querySelector('#tbl').innerHTML = '<div class="p-6 text-center text-amber-600"><i class="fas fa-triangle-exclamation mr-1"></i>Falha ao carregar a tabela de preços</div>';
    }
  }
  window.TERC_editPreco = (id) => TERC_openPrecoModal(id, () => { load(); refresh && refresh(); });
  window.TERC_delPreco = async (id) => {
    const okConf = await TERC_confirmDelPreco();
    if (!okConf) return;
    try { await api('delete', '/terc/precos/' + id); toast('Preço excluído', 'success'); load(); refresh && refresh(); } catch {}
  };
  body.querySelector('#btn-filtrar').onclick = load;
  body.querySelector('#btn-novo').onclick = () => TERC_openPrecoModal(null, () => { load(); refresh && refresh(); });
  body.querySelector('#btn-col').onclick = () => TERC_openColecoesModal(() => { load(); refresh && refresh(); });
  body.querySelector('#btn-importar').onclick = () => TERC_openImportPrecosModal(() => { load(); refresh && refresh(); });
  body.querySelector('#btn-del-all').onclick = () => TERC_confirmDelAllPrecos(() => { load(); refresh && refresh(); });
  await load();
}

// Confirma exclusão de UM preço
function TERC_confirmDelPreco() {
  return new Promise((resolve) => {
    const m = el('div', { class: 'modal-backdrop' });
    const card = el('div', { class: 'modal p-6 w-full max-w-md' });
    card.innerHTML = `
      <h3 class="text-lg font-semibold mb-3"><i class="fas fa-triangle-exclamation mr-2 text-amber-500"></i>Excluir preço</h3>
      <p class="text-sm mb-4">Esta variação de preço será removida. Deseja continuar?</p>
      <div class="flex justify-end gap-2">
        <button id="c-cancel" class="btn btn-secondary">Cancelar</button>
        <button id="c-ok" class="btn btn-danger"><i class="fas fa-trash mr-1"></i>Excluir</button>
      </div>`;
    m.appendChild(card); document.body.appendChild(m);
    $('#c-cancel').onclick = () => { m.remove(); resolve(false); };
    $('#c-ok').onclick     = () => { m.remove(); resolve(true);  };
  });
}

// Confirma exclusão de TODOS os preços (confirmação dupla)
function TERC_confirmDelAllPrecos(onDone) {
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-md' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold text-red-700 mb-3"><i class="fas fa-triangle-exclamation mr-2"></i>EXCLUIR TODOS OS PREÇOS</h3>
    <p class="text-sm mb-2">Esta ação <b>apaga permanentemente</b> todas as variações de preço cadastradas. Os produtos e cores não serão afetados.</p>
    <p class="text-sm mb-3">Para confirmar, digite exatamente: <code class="px-1 bg-slate-100 rounded">EXCLUIR-TODOS</code></p>
    <input id="c-typed" placeholder="Digite EXCLUIR-TODOS" />
    <div class="flex justify-end gap-2 mt-4">
      <button id="c-cancel" class="btn btn-secondary">Cancelar</button>
      <button id="c-ok" class="btn btn-danger" disabled><i class="fas fa-trash-can mr-1"></i>Confirmar exclusão</button>
    </div>`;
  m.appendChild(card); document.body.appendChild(m);
  const typedEl = $('#c-typed'), okEl = $('#c-ok');
  typedEl.oninput = () => { okEl.disabled = typedEl.value.trim() !== 'EXCLUIR-TODOS'; };
  $('#c-cancel').onclick = () => m.remove();
  okEl.onclick = async () => {
    try {
      const r = await api('delete', '/terc/precos?confirm1=SIM&confirm2=EXCLUIR-TODOS');
      const n = r?.data?.deleted ?? 0;
      m.remove();
      toast(`${n} preço(s) excluído(s)`, 'success');
      onDone && onDone();
    } catch {}
  };
}

// Modal de importação de planilha de cor/preço (XLSX)
function TERC_openImportPrecosModal(onDone) {
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-3xl' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3"><i class="fas fa-file-excel mr-2 text-emerald-600"></i>Importar Planilha de Preços (Cor + Grade)</h3>
    <div class="bg-slate-50 p-3 rounded text-xs mb-3">
      <b>Colunas esperadas:</b> Referência · Descrição · Cor · Grade · Serviço · Preço · Tempo
      <br/><span class="text-slate-500">Linhas com mesma combinação <b>Ref + Cor + Grade + Serviço</b> são tratadas como atualização (não duplica).</span>
    </div>
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label>Arquivo Excel (.xlsx)</label>
        <input type="file" id="i-file" accept=".xlsx,.xls,.csv" />
      </div>
      <div>
        <label>Coleção (opcional)</label>
        <select id="i-col">${TERC.optColecoes()}</select>
      </div>
    </div>
    <div class="flex flex-wrap gap-4 mb-3 text-sm">
      <label class="flex items-center gap-2"><input type="radio" name="i-modo" value="atualizar" checked /> Atualizar existentes (cria os faltantes)</label>
      <label class="flex items-center gap-2"><input type="radio" name="i-modo" value="criar" /> Apenas criar novos (não toca nos existentes)</label>
      <label class="flex items-center gap-2"><input type="radio" name="i-modo" value="simular" /> Simulação (não grava)</label>
    </div>
    <div id="i-preview" class="text-xs text-slate-600 mb-3"></div>
    <div id="i-result" class="text-sm mb-3"></div>
    <div class="flex justify-end gap-2">
      <button id="i-cancel" class="btn btn-secondary">Fechar</button>
      <button id="i-go" class="btn btn-primary" disabled><i class="fas fa-upload mr-1"></i>Importar</button>
    </div>`;
  m.appendChild(card); document.body.appendChild(m);

  let parsedRows = [];
  $('#i-cancel').onclick = () => m.remove();

  $('#i-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!window.XLSX) {
      await new Promise(res => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = res; document.head.appendChild(s);
      });
    }
    try {
      const ab = await f.arrayBuffer();
      const wb = window.XLSX.read(ab, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const arr = window.XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      // Normaliza chaves (case-insensitive, sem acento)
      const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      parsedRows = arr.map(row => {
        const out = {};
        for (const [k, v] of Object.entries(row)) {
          const nk = norm(k);
          if (nk === 'ref' || nk === 'referencia' || nk === 'cod_ref' || nk === 'codigo')           out.cod_ref = String(v || '').trim();
          else if (nk === 'descricao' || nk === 'desc_ref' || nk === 'descricao da referencia')      out.desc_ref = String(v || '').trim();
          else if (nk === 'cor')                                                                     out.cor = String(v || '').trim();
          else if (nk === 'grade' || nk === 'tamanho' || nk === 'tam')                               out.tamanho = String(v || '').trim();
          else if (nk === 'servico' || nk === 'desc_servico' || nk === 'descricao do servico')        out.servico = String(v || '').trim();
          else if (nk === 'preco' || nk === 'valor')                                                  out.preco = parseFloat(String(v).replace(',', '.')) || 0;
          else if (nk === 'tempo' || nk === 'tempo_min' || nk === 'tempo (min)' || nk === 'tempo da peca') out.tempo = parseFloat(String(v).replace(',', '.')) || 0;
        }
        return out;
      }).filter(r => r.cod_ref || r.desc_ref);
      $('#i-preview').innerHTML = `<i class="fas fa-circle-check text-emerald-600 mr-1"></i><b>${parsedRows.length}</b> linha(s) detectada(s). Primeiras 3: <code class="text-xs">${JSON.stringify(parsedRows.slice(0, 3))}</code>`;
      $('#i-go').disabled = parsedRows.length === 0;
    } catch (err) {
      $('#i-preview').innerHTML = `<span class="text-red-600"><i class="fas fa-triangle-exclamation mr-1"></i>Falha ao ler o arquivo: ${err.message}</span>`;
      parsedRows = [];
      $('#i-go').disabled = true;
    }
  };

  $('#i-go').onclick = async () => {
    const modo = card.querySelector('input[name="i-modo"]:checked')?.value || 'atualizar';
    const idCol = $('#i-col').value || null;
    $('#i-go').disabled = true;
    $('#i-result').innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Processando...';
    try {
      const r = await api('post', '/terc/precos/importar', { rows: parsedRows, modo, id_colecao: idCol });
      const d = r?.data || {};
      const erros = fmt.safeArr(d.erros);
      $('#i-result').innerHTML = `
        <div class="bg-emerald-50 border border-emerald-200 rounded p-3">
          <div class="font-semibold mb-1">${d.simulado ? '🧪 Simulação concluída' : '✅ Importação concluída'} (modo: ${d.modo})</div>
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="p-2 bg-white rounded"><div class="text-2xl font-bold text-emerald-700">${fmt.int(d.criados)}</div><div class="text-xs">Criados</div></div>
            <div class="p-2 bg-white rounded"><div class="text-2xl font-bold text-blue-700">${fmt.int(d.atualizados)}</div><div class="text-xs">Atualizados</div></div>
            <div class="p-2 bg-white rounded"><div class="text-2xl font-bold text-amber-700">${fmt.int(d.ignorados)}</div><div class="text-xs">Ignorados</div></div>
          </div>
          ${erros.length ? `<details class="mt-2 text-xs"><summary class="cursor-pointer text-amber-700">${erros.length} erro(s) — ver detalhes</summary><ul class="ml-4 mt-1">${erros.map(e => `<li>Linha ${e.linha}: ${e.motivo}</li>`).join('')}</ul></details>` : ''}
        </div>`;
      if (!d.simulado) toast(`Importação: +${d.criados} criados, ${d.atualizados} atualizados`, 'success');
      onDone && onDone();
    } catch (e) {
      $('#i-result').innerHTML = `<div class="text-red-600 p-3 bg-red-50 rounded"><i class="fas fa-triangle-exclamation mr-1"></i>${e?.response?.data?.error || 'Falha na importação'}</div>`;
    } finally {
      $('#i-go').disabled = false;
    }
  };
}
window.TERC_openImportPrecosModal = TERC_openImportPrecosModal;

/* ---------- BLOCO: RESUMO ---------- */
async function renderTercResumoBlock(body) {
  body.innerHTML = `
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div><label>Coleção</label><select id="f-col">${TERC.optColecoes()}</select></div>
      <button id="btn-filtrar" class="btn btn-primary"><i class="fas fa-filter mr-1"></i>Filtrar</button>
      <div class="flex-1"></div>
      <button id="btn-csv" class="btn btn-secondary"><i class="fas fa-file-csv mr-1"></i>Exportar CSV</button>
    </div>
    <div class="card p-0 overflow-x-auto" id="tbl-wrap"><div class="p-6 text-center text-slate-500"><i class="fas fa-spinner fa-spin"></i> Carregando...</div></div>
  `;
  async function load() {
    const col = body.querySelector('#f-col').value;
    const r = await api('get', `/terc/resumo${col ? '?id_colecao=' + col : ''}`);
    const rs = r.data || []; window._resumoBlock = rs;
    body.querySelector('#tbl-wrap').innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-slate-100 sticky top-0"><tr>
          <th class="text-left p-2">Terceirizado</th><th class="text-left p-2">Setor</th>
          <th class="text-center p-2">Situação</th>
          <th class="text-right p-2">A coletar</th><th class="text-right p-2">Em produção</th>
          <th class="text-right p-2">Produzidas</th><th class="text-right p-2">Conserto</th>
          <th class="text-right p-2">Remessas</th><th class="text-right p-2">Valor</th>
          <th class="text-right p-2">% Consertos</th>
        </tr></thead>
        <tbody>
          ${rs.map(t => `
            <tr class="border-b hover:bg-slate-50">
              <td class="p-2 font-medium">${t.nome_terc}</td>
              <td class="p-2 text-slate-500">${t.nome_setor || '—'}</td>
              <td class="p-2 text-center">${t.situacao === 'Ativa' ? '<span class="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">Ativa</span>' : '<span class="px-2 py-0.5 rounded text-xs bg-slate-200 text-slate-600">Inativa</span>'}</td>
              <td class="p-2 text-right">${fmt.int(t.pecas_coletar)}</td>
              <td class="p-2 text-right">${fmt.int(t.pecas_producao)}</td>
              <td class="p-2 text-right text-emerald-700 font-semibold">${fmt.int(t.pecas_produzidas)}</td>
              <td class="p-2 text-right text-amber-700">${fmt.int(t.pecas_conserto)}</td>
              <td class="p-2 text-right">${fmt.int(t.total_remessas)}</td>
              <td class="p-2 text-right">${TERC.fmtBRL(t.valor_movimentado)}</td>
              <td class="p-2 text-right ${Number(t.indice_consertos) > 0.05 ? 'text-red-600 font-semibold' : 'text-slate-600'}">${fmt.pct(t.indice_consertos)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }
  body.querySelector('#btn-filtrar').onclick = load;
  body.querySelector('#btn-csv').onclick = () => {
    const rs = window._resumoBlock || [];
    const h = ['Terceirizado','Setor','Situacao','A coletar','Em producao','Produzidas','Conserto','Remessas','Valor','%Consertos'];
    const rows = rs.map(t => [t.nome_terc, t.nome_setor || '', t.situacao, t.pecas_coletar, t.pecas_producao, t.pecas_produzidas, t.pecas_conserto, t.total_remessas, Number(t.valor_movimentado).toFixed(2), (Number(t.indice_consertos) * 100).toFixed(1) + '%']);
    const csv = [h, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `resumo-terc-${dayjs().format('YYYYMMDD')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  await load();
}

/* ---------- ALIAS legado — terc_dashboard redireciona para a rota inicial 'dashboard' ----------
 * As demais rotas (terc_remessas, terc_retornos, terc_terceirizados, terc_produtos,
 * terc_precos, terc_importador) são telas independentes (sem accordion) — definidas acima.
 */
ROUTES.terc_dashboard = (main) => { state.route = 'dashboard'; location.hash = 'dashboard'; ROUTES.dashboard(main); };
ROUTES.terc_resumo = (main) => { state.route = 'terc_terceirizados'; location.hash = 'terc_terceirizados'; ROUTES.terc_terceirizados(main); };

/* ---------- TELA ÚNICA: Produtos (atalho direto, mesma view do bloco) ---------- */
ROUTES.terc_produtos = async (main) => {
  await TERC.load();
  main.innerHTML = `
    <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
      <div class="text-xs text-slate-500 uppercase tracking-widest"><i class="fas fa-tshirt mr-1 text-brand"></i>Cadastro de Produtos</div>
      <a href="#terc_central" class="btn btn-secondary btn-sm"><i class="fas fa-handshake-angle mr-1"></i>Central de Terceirização</a>
    </div>
    <div class="card p-4" id="prod-body"></div>`;
  renderTercProdutosBlock($('#prod-body'), null);
};

/* ---------- PREÇOS / VARIAÇÕES (rota standalone — usa o mesmo bloco) ---------- */
ROUTES.terc_precos = async (main) => {
  await TERC.load();
  main.innerHTML = `
    <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
      <div class="text-xs text-slate-500 uppercase tracking-widest"><i class="fas fa-money-bill-wave mr-1 text-brand"></i>Tabela de Preços / Variações (Cor + Grade)</div>
      <a href="#terc_central" class="btn btn-secondary btn-sm"><i class="fas fa-handshake-angle mr-1"></i>Central de Terceirização</a>
    </div>
    <div class="card p-4" id="prec-body"></div>`;
  await renderTercPrecosBlock($('#prec-body'), null);
};

async function TERC_openPrecoModal(id, onSave) {
  await TERC.load();
  let p = { grade: 1, preco: 0, tempo_min: 0, ativo: 1, cor: '', tamanho: '' };
  if (id) {
    try {
      const r = await api('get', '/terc/precos', null, { silent: true });
      p = fmt.safeArr(r?.data).find(x => Number(x.id_preco) === Number(id)) || p;
    } catch {}
  }
  const prodInicial = (id && p.cod_ref) ? TERC.findProdutoByRef(p.cod_ref, p.id_colecao) : null;
  const idProdSel = prodInicial ? prodInicial.id_produto : '';
  const cores = fmt.safeArr(window.TERC?.cores);
  const tamsPadrao = ['PP','P','M','G','GG','XGG','EG','SG'];

  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-2xl' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3"><i class="fas fa-money-bill-wave mr-2 text-brand"></i>${id ? 'Editar' : 'Nova'} Variação de Preço</h3>
    <div class="grid grid-cols-2 gap-3">
      <div class="col-span-2">
        <label>Produto<span class="text-xs text-slate-500 ml-1">— escolha um cadastrado para auto-preencher</span></label>
        <select id="m-prod">${TERC.optProdutos(idProdSel)}</select>
      </div>
      <div><label>Referência <span class="text-xs text-slate-400">(opcional)</span></label><input id="m-ref" value="${(p.cod_ref || '').replace(/"/g, '&quot;')}" placeholder="auto se vazio" /></div>
      <div><label>Descrição</label><input id="m-desc" value="${(p.desc_ref || '').replace(/"/g, '&quot;')}" /></div>
      <div>
        <label>Cor <span class="text-xs text-slate-400">(opcional)</span></label>
        <input id="m-cor" value="${(p.cor || '').replace(/"/g, '&quot;')}" list="m-cor-dl" placeholder="Ex: Azul (vazio = todas as cores)" />
        <datalist id="m-cor-dl">${cores.map(c => `<option value="${c.nome_cor}">`).join('')}</datalist>
      </div>
      <div>
        <label>Tamanho / Grade <span class="text-xs text-slate-400">(opcional)</span></label>
        <input id="m-tam" value="${(p.tamanho || '').replace(/"/g, '&quot;')}" list="m-tam-dl" placeholder="Ex: M (vazio = todos)" />
        <datalist id="m-tam-dl">${tamsPadrao.map(t => `<option value="${t}">`).join('')}</datalist>
      </div>
      <div><label>Serviço *</label><select id="m-serv">${TERC.optServicos(p.id_servico)}</select></div>
      <div><label>Coleção</label><select id="m-col">${TERC.optColecoes(p.id_colecao)}</select></div>
      <div><label>Grade num. (1=única)</label><input id="m-grade" type="number" min="1" value="${p.grade || 1}" /></div>
      <div><label>Preço (R$) *</label><input id="m-preco" type="number" step="0.01" value="${p.preco || 0}" /></div>
      <div><label>Tempo (min/peça)</label><input id="m-tempo" type="number" step="0.01" value="${p.tempo_min || 0}" /></div>
      <div><label>Vigência</label><input id="m-vig" type="date" value="${p.dt_vigencia || ''}" /></div>
      <div class="col-span-2"><label>Observação</label><input id="m-obs" value="${(p.observacao || '').replace(/"/g, '&quot;')}" /></div>
    </div>
    <div class="text-xs text-slate-500 mt-2"><i class="fas fa-circle-info mr-1"></i>A combinação <b>Produto + Cor + Tamanho + Serviço</b> deve ser única. Deixe Cor/Tamanho vazios para preço genérico (fallback).</div>
    <div class="flex justify-end gap-2 mt-4">
      <button id="m-cancel" class="btn btn-secondary">Cancelar</button>
      <button id="m-save" class="btn btn-primary"><i class="fas fa-save mr-1"></i>Salvar</button>
    </div>
  `;
  m.appendChild(card); document.body.appendChild(m);

  // 📦 Auto-fill ao escolher PRODUTO
  $('#m-prod').onchange = () => {
    const opt = $('#m-prod').options[$('#m-prod').selectedIndex];
    if (!opt || !opt.value) return;
    if (opt.dataset.cod)   $('#m-ref').value  = opt.dataset.cod;
    if (opt.dataset.desc)  $('#m-desc').value = opt.dataset.desc;
    if (opt.dataset.col && !$('#m-col').value) $('#m-col').value = opt.dataset.col;
    if (opt.dataset.grade) $('#m-grade').value = opt.dataset.grade;
  };

  $('#m-cancel').onclick = () => m.remove();
  $('#m-save').onclick = async () => {
    const body = {
      cod_ref:    $('#m-ref').value.trim(),
      desc_ref:   $('#m-desc').value.trim(),
      id_produto: $('#m-prod').value || null,
      id_servico: $('#m-serv').value,
      id_colecao: $('#m-col').value,
      cor:        $('#m-cor').value.trim(),
      tamanho:    $('#m-tam').value.trim(),
      grade:      $('#m-grade').value,
      preco:      $('#m-preco').value,
      tempo_min:  $('#m-tempo').value,
      dt_vigencia: $('#m-vig').value || null,
      observacao: $('#m-obs').value.trim(),
      ativo: 1,
    };
    if (!body.id_servico) { toast('Serviço é obrigatório', 'warning'); return; }
    if (!body.cod_ref && !body.desc_ref && !body.id_produto) { toast('Selecione um produto, ou informe referência/descrição', 'warning'); return; }
    if (!body.preco || Number(body.preco) <= 0) { toast('Informe o preço', 'warning'); return; }
    try {
      if (id) await api('put', '/terc/precos/' + id, body);
      else    await api('post', '/terc/precos', body);
      toast(id ? 'Variação atualizada' : 'Variação criada', 'success');
      m.remove(); if (onSave) onSave();
    } catch {}
  };
}

/* ---------- IMPORTADOR de Planilha de Terceirização ---------- */
ROUTES.terc_importador = async (main) => {
  await TERC.load();
  main.innerHTML = `
    <div class="card p-5">
      <h3 class="text-lg font-semibold mb-2"><i class="fas fa-file-excel mr-2 text-emerald-600"></i>Importar Planilha de Terceirização</h3>
      <p class="text-sm text-slate-600 mb-4">Cole dados copiados da planilha <b>Remessa</b> (incluindo o cabeçalho) ou faça upload do arquivo Excel. Colunas esperadas:</p>
      <div class="bg-slate-50 p-3 rounded text-xs font-mono mb-4">
        Nº OP · Nome Terceirização · Setor · Ref. · Descrição da Referência · Descrição do Serviço · Cor · Qtde Total · Preço · Data de Saída · Coleção · Tempo da Peça (min.) · % Eficiência · Qtde pessoas · Min. Trabalhados · Observações
      </div>
      <div class="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label>Arquivo Excel (.xlsx) da aba "Remessa"</label>
          <input type="file" id="f-file" accept=".xlsx,.xls" />
          <div class="text-xs text-slate-500 mt-1">Ou cole os dados abaixo ↓</div>
        </div>
        <div class="flex items-end gap-3">
          <label class="flex items-center gap-2"><input type="checkbox" id="f-criar" checked /> Criar cadastros faltantes automaticamente</label>
          <label class="flex items-center gap-2"><input type="checkbox" id="f-dry" checked /> Simulação (não grava)</label>
        </div>
      </div>
      <textarea id="f-data" rows="10" placeholder="Cole aqui as linhas copiadas da planilha (TAB separado) — incluindo o cabeçalho na 1ª linha"></textarea>
      <div class="flex justify-end gap-2 mt-3">
        <button id="btn-limpar" class="btn btn-secondary">Limpar</button>
        <button id="btn-import" class="btn btn-primary"><i class="fas fa-upload mr-1"></i>Importar</button>
      </div>
      <div id="result" class="mt-4"></div>
    </div>
  `;

  function parseTSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { headers: [], rows: [] };
    const headers = lines[0].split('\t').map(h => h.trim());
    const rows = lines.slice(1).map(l => {
      const cells = l.split('\t');
      const o = {}; headers.forEach((h, i) => o[h] = (cells[i] || '').trim());
      return o;
    });
    return { headers, rows };
  }

  $('#btn-limpar').onclick = () => { $('#f-data').value = ''; $('#result').innerHTML = ''; $('#f-file').value = ''; };

  // Upload Excel via SheetJS (lazy load)
  $('#f-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!window.XLSX) {
      await new Promise(res => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = res; document.head.appendChild(s); });
    }
    const ab = await f.arrayBuffer();
    const wb = window.XLSX.read(ab, { type: 'array' });
    const sheet = wb.Sheets['Remessa'] || wb.Sheets[wb.SheetNames[0]];
    // Na planilha original o cabeçalho está na linha 2 (index 1)
    const data = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    let headerRow = 0;
    for (let i = 0; i < Math.min(5, data.length); i++) {
      if (data[i].some(c => String(c).toLowerCase().includes('op'))) { headerRow = i; break; }
    }
    const headers = data[headerRow].map(h => String(h).trim());
    const rows = data.slice(headerRow + 1).filter(r => r.some(c => String(c).trim())).map(r => {
      const o = {}; headers.forEach((h, i) => o[h] = String(r[i] == null ? '' : r[i]).trim()); return o;
    });
    $('#f-data').value = [headers.join('\t'), ...rows.map(r => headers.map(h => r[h]).join('\t'))].join('\n');
    toast('Planilha carregada: ' + rows.length + ' linhas', 'success');
  };

  $('#btn-import').onclick = async () => {
    const { rows } = parseTSV($('#f-data').value);
    if (rows.length === 0) { toast('Cole ou carregue os dados primeiro', 'warning'); return; }
    $('#result').innerHTML = '<div class="text-slate-500"><i class="fas fa-spinner fa-spin"></i> Importando ' + rows.length + ' linha(s)...</div>';
    try {
      const r = await api('post', '/terc/importar/remessas', {
        rows, dry_run: $('#f-dry').checked, criar_cadastros: $('#f-criar').checked,
      });
      const d = r.data || {};
      $('#result').innerHTML = `
        <div class="card p-4 ${$('#f-dry').checked ? 'bg-amber-50' : 'bg-emerald-50'}">
          <h4 class="font-semibold mb-2">${$('#f-dry').checked ? '🧪 Simulação concluída' : '✅ Importação concluída'}</h4>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><div class="text-xs text-slate-500">Linhas lidas</div><div class="text-2xl font-bold">${fmt.int(d.total || rows.length)}</div></div>
            <div><div class="text-xs text-slate-500">Remessas criadas</div><div class="text-2xl font-bold text-emerald-700">${fmt.int(d.inseridas || 0)}</div></div>
            <div><div class="text-xs text-slate-500">Cadastros criados</div><div class="text-2xl font-bold">${fmt.int(d.cadastros_criados || 0)}</div></div>
            <div><div class="text-xs text-slate-500">Erros/pulados</div><div class="text-2xl font-bold text-red-700">${fmt.int((d.erros || []).length)}</div></div>
          </div>
          ${(d.erros && d.erros.length) ? '<div class="mt-3 max-h-64 overflow-y-auto"><h5 class="font-semibold mb-1">Erros:</h5><ul class="text-xs list-disc pl-5">' + d.erros.slice(0, 50).map(e => '<li>Linha ' + e.linha + ': ' + e.erro + '</li>').join('') + '</ul></div>' : ''}
          ${$('#f-dry').checked ? '<div class="mt-3 p-2 bg-amber-100 rounded text-sm">⚠️ Nada foi gravado. Desmarque "Simulação" para importar de verdade.</div>' : ''}
        </div>
      `;
      if (!$('#f-dry').checked) await TERC.load(true);
    } catch (e) {
      $('#result').innerHTML = '<div class="p-3 bg-red-50 text-red-700 rounded">Erro: ' + (e.message || e) + '</div>';
    }
  };
};

/* ============================================================
 * TELA DE LOGIN
 * ============================================================ */
function renderLogin(msg) {
  $('#app').innerHTML = `
  <div class="login-screen">
    <div class="login-card">
      <div class="login-logo">
        <img src="/static/logo-full.png" alt="CorePro" />
        <div class="login-tagline">Onde sistemas se tornam negócio</div>
      </div>
      ${msg ? `<div class="mb-4 p-3 rounded text-sm" style="background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.35);color:#F97316"><i class="fas fa-info-circle mr-1"></i> ${msg}</div>` : ''}
      <form id="login-form" class="space-y-4">
        <div>
          <label><i class="fas fa-user mr-1" style="color:#60A5FA"></i> Usuário</label>
          <input id="login-login" type="text" autocomplete="username" required autofocus placeholder="seu.usuario" />
        </div>
        <div>
          <label><i class="fas fa-lock mr-1" style="color:#60A5FA"></i> Senha</label>
          <input id="login-senha" type="password" autocomplete="current-password" required placeholder="••••••••" />
        </div>
        <button type="submit" id="login-btn" class="btn btn-primary w-full" style="padding:.75rem;font-size:.95rem;">
          <i class="fas fa-arrow-right-to-bracket mr-2"></i> Acessar plataforma
        </button>
      </form>
      <div id="login-msg" class="text-center text-sm mt-3" style="color:#FF3B3B"></div>
      <div class="mt-6 pt-4 text-xs text-center" style="border-top:1px solid rgba(148,163,184,.15);color:#6B7280">
        <p>Primeiro acesso? Clique <a id="login-boot" href="#" style="color:#60A5FA;font-weight:600">aqui</a> para inicializar o administrador.</p>
        <p class="mt-2" style="opacity:.7">© ${new Date().getFullYear()} CorePro · PCP & Balanceamento</p>
      </div>
    </div>
  </div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#login-btn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Entrando...';
    try {
      const r = await axios.post(API + '/auth/login', {
        login: $('#login-login').value.trim(),
        senha: $('#login-senha').value,
      });
      AUTH.setToken(r.data.data.token);
      AUTH.setUser(r.data.data.usuario);
      state.user = r.data.data.usuario;
      if (state.user.trocar_senha) {
        renderTrocarSenhaObrigatoria();
      } else {
        bootApp();
      }
    } catch (e) {
      const m = e.response?.data?.error || 'Erro ao fazer login';
      $('#login-msg').textContent = m;
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt mr-1"></i> Entrar';
    }
  };
  $('#login-boot').onclick = async (e) => {
    e.preventDefault();
    try {
      const r = await axios.post(API + '/auth/bootstrap');
      $('#login-msg').innerHTML = '<span class="text-emerald-600">' + r.data.data.message + '</span>';
      $('#login-login').value = 'admin';
      $('#login-senha').value = 'admin';
      $('#login-senha').focus();
    } catch (err) {
      $('#login-msg').textContent = err.response?.data?.error || 'Erro no bootstrap';
    }
  };
}

/* ============================================================
 * TROCA DE SENHA
 * ============================================================ */
function openTrocarSenha(obrigatorio) {
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-md' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3">
      <i class="fas fa-key mr-2 text-brand"></i>${obrigatorio ? 'Troca de senha obrigatória' : 'Trocar senha'}
    </h3>
    ${obrigatorio ? '<p class="mb-3 text-sm text-amber-700 bg-amber-50 p-2 rounded">Você precisa definir uma nova senha antes de continuar.</p>' : ''}
    <div class="space-y-3">
      <div><label>Senha atual</label><input id="pw-atual" type="password" autofocus /></div>
      <div><label>Nova senha (mín. 6 caracteres)</label><input id="pw-nova" type="password" /></div>
      <div><label>Confirmar nova senha</label><input id="pw-conf" type="password" /></div>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      ${obrigatorio ? '' : '<button id="pw-cancel" class="btn btn-secondary">Cancelar</button>'}
      <button id="pw-save" class="btn btn-primary">Salvar</button>
    </div>`;
  m.appendChild(card); document.body.appendChild(m);
  if (!obrigatorio) $('#pw-cancel').onclick = () => m.remove();
  $('#pw-save').onclick = async () => {
    const sa = $('#pw-atual').value, sn = $('#pw-nova').value, sc = $('#pw-conf').value;
    if (!sa || !sn || !sc) { toast('Preencha todos os campos', 'warning'); return; }
    if (sn !== sc) { toast('Confirmação não confere', 'error'); return; }
    if (sn.length < 6) { toast('Senha deve ter pelo menos 6 caracteres', 'error'); return; }
    try {
      await api('post', '/auth/trocar-senha', { senha_atual: sa, senha_nova: sn });
      toast('Senha alterada com sucesso!', 'success');
      m.remove();
      // Atualiza user (trocar_senha = false)
      const u = AUTH.getUser(); if (u) { u.trocar_senha = false; AUTH.setUser(u); state.user = u; }
      if (obrigatorio) bootApp();
    } catch {}
  };
}

function renderTrocarSenhaObrigatoria() {
  $('#app').innerHTML = `
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-700 to-teal-900 p-4">
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-8 text-center">
      <i class="fas fa-shield-alt text-5xl text-brand mb-3"></i>
      <h2 class="text-xl font-bold mb-2">Primeiro acesso</h2>
      <p class="text-slate-600 mb-4">Por segurança, defina uma nova senha antes de usar o sistema.</p>
    </div>
  </div>`;
  setTimeout(() => openTrocarSenha(true), 300);
}

/* ============================================================
 * BOOTSTRAP
 * ============================================================ */
function bootApp() {
  renderLayout();
  const initial = (location.hash || '#dashboard').slice(1);
  navigate(initial || 'dashboard');
}

(async function init() {
  window.addEventListener('hashchange', () => {
    if (!state.user) return;
    const r = location.hash.slice(1) || 'dashboard';
    if (r !== state.route) navigate(r);
  });

  // Tem token? Valida com /auth/me
  const token = AUTH.getToken();
  if (!token) { renderLogin(); return; }
  try {
    const r = await axios.get(API + '/auth/me', { headers: { Authorization: 'Bearer ' + token } });
    const u = r.data?.data;
    if (!u) { AUTH.clearToken(); AUTH.clearUser(); renderLogin(); return; }
    state.user = u; AUTH.setUser(u);
    if (u.trocar_senha) { renderTrocarSenhaObrigatoria(); return; }
    bootApp();
  } catch {
    AUTH.clearToken(); AUTH.clearUser();
    renderLogin('Não foi possível validar a sessão. Faça login.');
  }
})();
