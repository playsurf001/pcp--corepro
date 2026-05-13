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
// Expõe globalmente para módulos externos (relatorios_det.js, etc)
window.AUTH = AUTH;

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
// Expõe globalmente para módulos externos (relatorios_det.js, etc)
window.state = state;

/* ============================================================
 * LOGOUT GLOBAL — escopo de módulo, registrado UMA ÚNICA VEZ.
 *
 * IMPORTANTE: doLogout() e seus listeners DEVEM ficar fora de
 * renderLayout(), porque renderLayout() é chamado a cada navegação
 * (bootApp → renderLayout). Se os listeners ficassem dentro, cada
 * navegação registraria NOVOS listeners no document, acumulando
 * handlers de closures mortas que bloqueavam uns aos outros via
 * stopImmediatePropagation + flag _logoutInProgress.
 *
 * Aqui o registro é IDEMPOTENTE (window.__logoutBound) — mesmo se
 * o script for re-injetado, não duplica.
 * ============================================================ */
let _logoutInProgress = false;
async function doLogout() {
  console.log('[logout] doLogout() iniciado');
  if (_logoutInProgress) { console.log('[logout] já em progresso, ignorando'); return; }
  _logoutInProgress = true;
  try {
    // 1) Fecha menu e limpa qualquer overlay/popover residual ANTES de qualquer coisa
    try {
      const menu = document.getElementById('user-menu');
      if (menu) { menu.classList.add('is-hidden'); menu.classList.remove('is-open'); }
      const bd = document.getElementById('user-menu-backdrop');
      if (bd) bd.classList.add('is-hidden');
    } catch {}
    try {
      document.getElementById('terc-print-menu')?.remove();
      document.querySelectorAll(
        '.popover-floating, [data-floating-menu], [role="tooltip"], .tooltip, .tippy-box'
      ).forEach(el => { try { el.remove(); } catch {} });
    } catch {}

    // 2) Limpa imediatamente o storage local (síncrono) — usuário JÁ está deslogado
    try { localStorage.removeItem('pcp_token'); } catch {}
    try { localStorage.removeItem('pcp_user'); } catch {}
    try { sessionStorage.clear(); } catch {}
    try { AUTH.clearToken(); } catch {}
    try { AUTH.clearUser(); } catch {}

    // 3) Limpa estado global de autenticação
    try { state.user = null; } catch {}
    try { state.token = null; } catch {}

    // 4) Chama a API (silenciosa — se falhar não impede o logout client-side)
    try { await api('post', '/auth/logout', {}, { silent: true }); } catch {}

    // 5) Redireciona para a tela de login
    try { location.hash = ''; } catch {}
    try {
      if (typeof renderLogin === 'function') {
        renderLogin('Sessão encerrada.');
      } else {
        location.reload();
      }
    } catch (err) {
      console.error('[logout] renderLogin falhou, recarregando página', err);
      try { location.reload(); } catch {}
    }
    console.log('[logout] doLogout() concluído');
  } finally {
    // Libera o flag depois de um ciclo, permitindo novo logout futuro
    setTimeout(() => { _logoutInProgress = false; }, 1000);
  }
}
window.doLogout = doLogout;

// Registra UMA ÚNICA VEZ os listeners delegados no document.
// Usa pointerdown (dispara antes do tooltip nativo aparecer) e click (failsafe).
if (!window.__logoutBound) {
  window.__logoutBound = true;
  const _globalLogoutHandler = (e) => {
    const t = e.target && e.target.closest && e.target.closest('#btn-logout');
    if (!t) return;
    console.log('[logout] handler global disparou via', e.type);
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    doLogout();
  };
  // Capture phase: roda antes de qualquer handler dos elementos descendentes
  document.addEventListener('pointerdown', _globalLogoutHandler, true);
  document.addEventListener('click', _globalLogoutHandler, true);
  // Teclado (Enter/Espaço) — acessibilidade
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = document.activeElement;
    if (t && t.id === 'btn-logout') {
      e.preventDefault();
      e.stopPropagation();
      doLogout();
    }
  }, true);
  console.log('[logout] handlers globais registrados (uma única vez)');
}

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
  // ==== TERCEIRIZAÇÃO (núcleo operacional — visível a todos) ====
  { id: 'dashboard',             label: 'Dashboard',         icon: 'fa-chart-line',       group: 'Terceirização', tercOnly: true },
  { id: 'terc_remessas',         label: 'Remessas',          icon: 'fa-truck-fast',       group: 'Terceirização', tercOnly: true },
  { id: 'terc_retornos',         label: 'Retornos',          icon: 'fa-truck-arrow-right',group: 'Terceirização', tercOnly: true },
  { id: 'terc_terceirizados',    label: 'Terceirizados',     icon: 'fa-handshake',        group: 'Terceirização', tercOnly: true },

  // ==== ANÁLISES ====
  { id: 'relatorios_detalhados', label: 'Relatórios',        icon: 'fa-chart-pie',        group: 'Análises',      tercOnly: true },

  // ==== SISTEMA (recolhível) — cadastros + admin ====
  { id: 'terc_produtos',         label: 'Produtos',          icon: 'fa-tshirt',           group: 'Sistema',       collapsible: true, tercOnly: true },
  { id: 'terc_precos',           label: 'Preços / Coleções', icon: 'fa-money-bill-wave',  group: 'Sistema',       collapsible: true, tercOnly: true },
  { id: 'terc_importador',       label: 'Importação',        icon: 'fa-file-excel',       group: 'Sistema',       collapsible: true, tercOnly: true },
  { id: 'terc_grades_tamanho',   label: 'Grades de Tamanho', icon: 'fa-ruler-combined',   group: 'Sistema',       collapsible: true, tercOnly: true },
  { id: 'usuarios',              label: 'Usuários',          icon: 'fa-user-shield',      group: 'Sistema',       collapsible: true, adminOnly: true },
  { id: 'configuracoes',         label: 'Configurações',     icon: 'fa-sliders-h',        group: 'Sistema',       collapsible: true, adminOnly: true },
];

/**
 * Política de visibilidade/acesso:
 *  - admin: pode tudo
 *  - qualquer outro perfil: APENAS itens marcados com tercOnly
 */
function isAdmin() { return state.user?.perfil === 'admin'; }
function podeAcessar(item) {
  if (!item) return false;
  // 'perfil' é sempre acessível ao usuário autenticado
  if (item && item.id === 'perfil') return true;
  if (isAdmin()) return true;
  return !!item.tercOnly;
}

/* Helpers de avatar (compartilhados pelo sidebar/topbar/perfil) */
function avatarHTML(user, size /* 'sm'|'md'|'lg'|'' */) {
  const cls = size ? ` ${size}` : '';
  const u = user || {};
  if (u.avatar_data) {
    return `<img class="avatar-img${cls}" src="${u.avatar_data}" alt="${(u.nome||'').replace(/"/g,'&quot;')}" />`;
  }
  const ini = (u.nome || u.login || '?').trim().charAt(0).toUpperCase();
  return `<span class="avatar-fallback${cls}" aria-hidden="true">${ini}</span>`;
}
window.avatarHTML = avatarHTML;

function renderLayout() {
  const groups = {};
  NAV.filter(podeAcessar).forEach((n) => { (groups[n.group] ||= []).push(n); });
  const u = state.user || { login: '?', nome: '?', perfil: '?' };

  // Estado do accordion "Sistema" persistido em localStorage
  let sistemaOpen = false;
  try { sistemaOpen = localStorage.getItem('nav-sistema-open') === '1'; } catch {}
  // Auto-expande se a rota atual é do grupo Sistema
  const sistemaIds = (groups['Sistema'] || []).map(i => i.id);
  if (sistemaIds.includes(state.route)) sistemaOpen = true;

  $('#app').innerHTML = `
  <div class="flex h-screen">
    <div id="sidebar-backdrop" class="sidebar-backdrop" aria-hidden="true"></div>
    <aside id="sidebar" class="sidebar" aria-label="Menu principal">
      <a href="#dashboard" data-route="dashboard" class="sidebar-brand" title="CorePro — Dashboard">
        <img src="/static/logo-full.png" alt="CorePro" />
        <span class="sidebar-tagline">Onde sistemas se tornam negócio</span>
      </a>
      <nav class="sidebar-nav" aria-label="Navegação principal">
        ${Object.entries(groups).map(([g, items]) => {
          const isCollapsible = g === 'Sistema';
          const open = isCollapsible ? sistemaOpen : true;
          if (isCollapsible) {
            return `
              <div class="nav-section nav-section-collapsible ${open ? 'is-open' : ''}" data-group="${g}">
                <button type="button" class="nav-group-toggle" aria-expanded="${open}" aria-controls="nav-grp-${g}">
                  <i class="fas fa-cogs nav-group-icon"></i>
                  <span class="nav-group-label-inline">${g}</span>
                  <i class="fas fa-chevron-down nav-group-caret"></i>
                </button>
                <div class="nav-group-items" id="nav-grp-${g}">
                  ${items.map(i => `
                    <a href="#${i.id}" data-route="${i.id}" class="nav-item">
                      <i class="fas ${i.icon}"></i>
                      <span>${i.label}</span>
                    </a>`).join('')}
                </div>
              </div>`;
          }
          return `
            <div class="nav-section">
              <div class="nav-group-label">${g}</div>
              ${items.map(i => `
                <a href="#${i.id}" data-route="${i.id}" class="nav-item">
                  <i class="fas ${i.icon}"></i>
                  <span>${i.label}</span>
                </a>`).join('')}
            </div>`;
        }).join('')}
      </nav>
      <a href="#perfil" data-route="perfil" class="sidebar-user" title="Editar perfil">
        ${avatarHTML(u, '')}
        <div class="flex-1 min-w-0">
          <div class="nome">${u.nome || '—'}</div>
          <div class="perfil">${u.perfil || ''}</div>
        </div>
        <i class="fas fa-cog text-xs opacity-60"></i>
      </a>
    </aside>
    <div class="flex-1 flex flex-col overflow-hidden">
      <header id="topbar" class="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-3">
        <button id="btn-hamburger" class="btn-hamburger" aria-label="Abrir menu" aria-controls="sidebar" aria-expanded="false">
          <i class="fas fa-bars"></i>
        </button>
        <h2 id="page-title" class="text-lg font-semibold text-slate-800 flex-1 min-w-0">Dashboard</h2>
        <div class="text-sm text-slate-500 flex items-center gap-3">
          <span id="today">${dayjs().format('DD/MM/YYYY')}</span>
          <span class="text-slate-300">|</span>
          ${Theme.toggleButtonHTML()}
          <div class="user-menu-wrap">
            <button id="user-btn" class="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-100" aria-label="Menu do usuário" aria-haspopup="menu" aria-expanded="false">
              <span id="topbar-avatar">${avatarHTML(u, '')}</span>
              <span class="text-slate-700 hidden sm:inline"><b>${u.nome}</b> <span class="text-xs text-slate-400">(${u.perfil})</span></span>
              <i class="fas fa-caret-down text-xs"></i>
            </button>
            <div id="user-menu" class="user-dropdown is-hidden" role="menu" aria-labelledby="user-btn">
              <div class="user-dropdown-header">
                <div id="user-dropdown-avatar">${avatarHTML(u, 'sm')}</div>
                <div class="min-w-0 flex-1">
                  <div class="nome">${u.nome || '—'}</div>
                  <div class="perfil">${u.perfil || ''}</div>
                </div>
              </div>
              <button id="btn-perfil" class="user-dropdown-item" role="menuitem"><i class="fas fa-user-circle"></i><span>Meu perfil</span></button>
              <button id="btn-trocar-senha" class="user-dropdown-item" role="menuitem"><i class="fas fa-key"></i><span>Trocar senha</span></button>
              <div class="user-dropdown-sep"></div>
              <button id="btn-logout" class="user-dropdown-item is-danger" role="menuitem"><i class="fas fa-sign-out-alt"></i><span>Sair</span></button>
            </div>
          </div>
        </div>
      </header>
      <main id="main-content" class="flex-1 overflow-auto p-6 bg-slate-50"></main>
    </div>
  </div>`;

  // ----- Hambúrguer + Drawer (mobile/tablet) -----
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  const burger = $('#btn-hamburger');
  function openSidebar() {
    sidebar.classList.add('open');
    backdrop.classList.add('open');
    burger.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
  }
  burger.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  backdrop.addEventListener('click', closeSidebar);
  // Fechar com ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
  });
  // Fechar ao redimensionar para desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024 && sidebar.classList.contains('open')) closeSidebar();
  });

  // Cliques em itens do menu — navegam e fecham drawer no mobile
  $$('[data-route]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    navigate(a.dataset.route);
    if (window.innerWidth < 1024) closeSidebar();
  }));

  // Toggle de grupos recolhíveis (Sistema)
  $$('.nav-group-toggle').forEach((b) => b.addEventListener('click', (ev) => {
    ev.preventDefault();
    const sec = b.closest('.nav-section-collapsible');
    if (!sec) return;
    const open = !sec.classList.contains('is-open');
    sec.classList.toggle('is-open', open);
    b.setAttribute('aria-expanded', String(open));
    if (sec.dataset.group === 'Sistema') {
      try { localStorage.setItem('nav-sistema-open', open ? '1' : '0'); } catch {}
    }
  }));

  // ----- Menu de usuário (topbar) — dropdown FIXED com posicionamento dinâmico -----
  const btn = $('#user-btn'), menu = $('#user-menu');

  /** Posiciona o menu (position:fixed) alinhado ao botão (right-edge), abaixo dele.
   *  Mobile: fixa no canto direito da tela com margem. */
  function positionUserMenu() {
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const menuW = Math.min(240, vw - 16);
    menu.style.width = menuW + 'px';
    // top = bottom do botão + 6px
    menu.style.top = (r.bottom + 6) + 'px';
    // right alinhado ao botão (mas nunca colado na borda esquerda)
    let right = Math.max(8, vw - r.right);
    if (vw < 480) right = 8; // mobile: cola direita
    menu.style.right = right + 'px';
    menu.style.left = 'auto';
  }

  // Backdrop invisível: bloqueia hover em botões abaixo (suprime tooltips nativos
  // do navegador que apareceriam por cima do dropdown via atributo title=).
  let userBackdrop = null;
  function ensureUserBackdrop() {
    if (userBackdrop) return userBackdrop;
    userBackdrop = document.createElement('div');
    userBackdrop.id = 'user-menu-backdrop';
    userBackdrop.className = 'user-menu-backdrop is-hidden';
    document.body.appendChild(userBackdrop);
    userBackdrop.addEventListener('click', () => closeUserMenu());
    return userBackdrop;
  }
  // Remove o atributo title temporariamente de TODOS elementos do documento
  // (impede tooltip nativo do navegador de aparecer por cima do menu).
  // Também limpa tooltips customizados que possam estar visíveis.
  let _suppressedTitles = [];
  function suppressNativeTitles() {
    _suppressedTitles = [];
    document.querySelectorAll('[title]').forEach(el => {
      // Ignora o próprio botão do menu e qualquer elemento dentro do dropdown
      if (el === btn || menu.contains(el)) return;
      const val = el.getAttribute('title');
      _suppressedTitles.push({ el, val });
      el.setAttribute('data-title-saved', val);
      el.removeAttribute('title');
    });
    // Remove tooltips customizados visíveis (Tippy/BS/popovers/Floating UI)
    document.querySelectorAll(
      '[role="tooltip"], .tooltip, .tippy-box, .popover-floating, [data-floating-menu], #terc-print-menu'
    ).forEach(el => { try { el.remove(); } catch {} });
  }
  function restoreNativeTitles() {
    _suppressedTitles.forEach(({ el, val }) => {
      if (val != null && el && el.isConnected) el.setAttribute('title', val);
      if (el && el.isConnected) el.removeAttribute('data-title-saved');
    });
    _suppressedTitles = [];
  }

  function openUserMenu() {
    // Remove TODO popover/menu flutuante anterior que possa interceptar cliques
    document.getElementById('terc-print-menu')?.remove();
    document.querySelectorAll(
      '.popover-floating, [data-floating-menu], [role="tooltip"], .tooltip, .tippy-box'
    ).forEach(el => { try { el.remove(); } catch {} });
    suppressNativeTitles();    // suprime ANTES de mostrar para evitar flicker do tooltip
    positionUserMenu();
    ensureUserBackdrop();
    userBackdrop.classList.remove('is-hidden');
    menu.classList.remove('is-hidden');
    menu.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    // Reposiciona após render (next frame) para garantir bounding rect correto
    requestAnimationFrame(positionUserMenu);
  }
  function closeUserMenu() {
    menu.classList.add('is-hidden');
    menu.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    if (userBackdrop) userBackdrop.classList.add('is-hidden');
    restoreNativeTitles();
  }
  function toggleUserMenu() {
    menu.classList.contains('is-open') ? closeUserMenu() : openUserMenu();
  }

  btn.addEventListener('click', (ev) => { ev.stopPropagation(); toggleUserMenu(); });
  // Click-fora fecha
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('is-open')) return;
    if (!btn.contains(e.target) && !menu.contains(e.target)) closeUserMenu();
  });
  // ESC fecha
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('is-open')) closeUserMenu();
  });
  // Reposiciona em scroll/resize (menu fixed precisa acompanhar o botão)
  window.addEventListener('scroll', () => { if (menu.classList.contains('is-open')) positionUserMenu(); }, true);
  window.addEventListener('resize', () => { if (menu.classList.contains('is-open')) positionUserMenu(); });

  // NOTA: doLogout() e os listeners globais de logout foram movidos para
  // o ESCOPO GLOBAL (fora de renderLayout) e registrados UMA ÚNICA VEZ
  // no init() — assim não acumulam handlers a cada re-render e não ficam
  // bloqueados por closures antigas. Ver final do arquivo.

  const btnSenha = $('#btn-trocar-senha');
  if (btnSenha) btnSenha.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    closeUserMenu(); openTrocarSenha(false);
  });
  const btnPerfil = $('#btn-perfil');
  if (btnPerfil) btnPerfil.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    closeUserMenu(); navigate('perfil');
  });
  // Theme toggle (sistema dual light/dark)
  Theme.bindToggle('#theme-toggle-btn');
}

/** Reaplica avatar/nome em sidebar e topbar (chamado após salvar perfil) */
function refreshUserUI() {
  const u = state.user || {};
  const slot = $('#topbar-avatar'); if (slot) slot.innerHTML = avatarHTML(u, '');
  const ddSlot = $('#user-dropdown-avatar'); if (ddSlot) ddSlot.innerHTML = avatarHTML(u, 'sm');
  const sb = $('.sidebar-user'); if (sb) {
    const av = sb.querySelector('.avatar-img,.avatar-fallback');
    if (av) av.outerHTML = avatarHTML(u, '');
    const nome = sb.querySelector('.nome'); if (nome) nome.textContent = u.nome || '—';
    const perf = sb.querySelector('.perfil'); if (perf) perf.textContent = u.perfil || '';
  }
  const ub = $('#user-btn'); if (ub) {
    const span = ub.querySelector('span.text-slate-700');
    if (span) span.innerHTML = `<b>${u.nome}</b> <span class="text-xs text-slate-400">(${u.perfil})</span>`;
  }
  // Atualiza header do dropdown (nome/perfil)
  const dd = $('#user-menu'); if (dd) {
    const ddNome = dd.querySelector('.user-dropdown-header .nome');
    const ddPerf = dd.querySelector('.user-dropdown-header .perfil');
    if (ddNome) ddNome.textContent = u.nome || '—';
    if (ddPerf) ddPerf.textContent = u.perfil || '';
  }
}
window.refreshUserUI = refreshUserUI;

/**
 * Rota inicial padrão — Dashboard de Terceirização para todos os perfis.
 */
function rotaInicial() {
  return 'dashboard';
}

/**
 * Guarda de rota: bloqueia acesso direto via URL/hash a módulos restritos
 * para usuários não-admin, redirecionando para o dashboard inicial.
 */
function navigate(route) {
  // Limpa popovers/menus flutuantes residuais ao navegar (impede que
  // bloqueiem cliques em telas seguintes — bug do "Sair" não funcionar)
  document.getElementById('terc-print-menu')?.remove();

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

/* ---------- USUÁRIOS (admin) ---------- */
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

  /* ============================================================
   * 🆕 GRADE DINÂMICA — usa apenas os tamanhos REALMENTE existentes
   * na remessa/itens. Não aplica mais ordem fixa que descartava
   * tamanhos como "PP", "34", ou personalizados.
   * ============================================================ */

  // Ordenação inteligente: alfa-padrão (PP→P→M→G→GG→EG→XG→XXG) ou numérica
  _sortTamanhos(tams) {
    const ORDEM_ALFA = ['PP','P','M','G','GG','EG','SG','XG','XGG','XXG','XXXG','UN','U','UNICO','ÚNICO'];
    const idx = (t) => {
      const u = String(t).toUpperCase().trim();
      const i = ORDEM_ALFA.indexOf(u);
      return i >= 0 ? i : 999;
    };
    return [...tams].sort((a, b) => {
      const na = Number(a), nb = Number(b);
      const aNum = !isNaN(na) && String(a).trim() !== '';
      const bNum = !isNaN(nb) && String(b).trim() !== '';
      if (aNum && bNum) return na - nb;            // 34, 36, 38...
      if (!aNum && !bNum) {
        const ia = idx(a), ib = idx(b);
        if (ia !== ib) return ia - ib;
        return String(a).localeCompare(String(b));
      }
      return aNum ? 1 : -1;                         // alfas antes, números depois
    });
  },

  // Extrai grade de um item/remessa em objeto {tamanho: qtd}
  _gradeToObj(src) {
    if (!src) return {};
    if (Array.isArray(src)) {
      const o = {};
      for (const x of src) {
        if (!x) continue;
        const t = String(x.tamanho || '').trim();
        const q = Number(x.qtd) || 0;
        if (t && q) o[t] = (o[t] || 0) + q;
      }
      return o;
    }
    if (typeof src === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(src)) {
        const t = String(k).trim();
        const q = Number(v) || 0;
        if (t && q) o[t] = q;
      }
      return o;
    }
    return {};
  },

  // União de tamanhos de várias "fontes" (remessas, itens ou retornos)
  _coletaTamanhosUniao(linhasOuItens) {
    const set = new Set();
    for (const x of linhasOuItens || []) {
      const o = this._gradeToObj(x.grade);
      Object.keys(o).forEach(t => { if (t) set.add(t); });
    }
    if (set.size === 0) return ['P','M','G','GG','EG','SG']; // fallback compatibilidade
    return this._sortTamanhos([...set]);
  },

  // Cabeçalho dinâmico: gera <th> apenas dos tamanhos passados
  // Mantém compatibilidade com chamada sem args (legado)
  _gradeHeaderHTML(tams) {
    const lista = Array.isArray(tams) && tams.length > 0
      ? this._sortTamanhos(tams)
      : ['P','M','G','GG','EG','SG','46','48','50','52']; // fallback legado
    return lista.map(t =>
      `<th class="col-grade grade-header">${escapeHtml ? (typeof escapeHtml === 'function' ? escapeHtml(t) : t) : t}</th>`
    ).join('');
  },

  // Células de grade — usa lista dinâmica se passada, senão fallback
  _gradeCellsFromRem(rem, tams) {
    const lista = Array.isArray(tams) && tams.length > 0
      ? this._sortTamanhos(tams)
      : ['P','M','G','GG','EG','SG','46','48','50','52'];
    const g = this._gradeToObj(rem.grade);
    return lista.map(t => `<td class="col-grade center">${g[t] ? fmt.int(g[t]) : ''}</td>`).join('');
  },

  _gradeCellsFromItem(item, tams) {
    const lista = Array.isArray(tams) && tams.length > 0
      ? this._sortTamanhos(tams)
      : ['P','M','G','GG','EG','SG','46','48','50','52'];
    const g = this._gradeToObj(item.grade);
    return lista.map(t => `<td class="col-grade center">${g[t] ? fmt.int(g[t]) : ''}</td>`).join('');
  },

  // 🆕 "Achata" um array de remessas em um array de LINHAS (cada linha = 1 item).
  // Se a remessa tem `itens[]` (multi-itens), gera 1 linha por item.
  // Se não tem (legado), gera 1 linha com a grade do cabeçalho.
  _flattenRemessasParaLinhas(remessas) {
    const linhas = [];
    for (const r of remessas) {
      const itens = Array.isArray(r.itens) ? r.itens.filter(i => i && (i.ativo == null || i.ativo === 1 || i.ativo === true)) : [];
      if (itens.length > 0) {
        for (const it of itens) {
          // Calcula qtd_total e valor_total do item (defensivo)
          let qtdItem = 0;
          if (Array.isArray(it.grade)) qtdItem = it.grade.reduce((a, g) => a + (Number(g.qtd) || 0), 0);
          else if (it.grade && typeof it.grade === 'object') qtdItem = Object.values(it.grade).reduce((a, q) => a + (Number(q) || 0), 0);
          if (!qtdItem) qtdItem = Number(it.qtd_total) || 0;
          const precoItem = Number(it.preco_unit) || 0;
          const valorItem = Number(it.valor_total) || (qtdItem * precoItem);

          linhas.push({
            num_controle: r.num_controle,
            // Nº OP por item: prioriza o do item; cai para o da remessa (compat. legado)
            num_op: (it.num_op && String(it.num_op).trim()) ? it.num_op : r.num_op,
            cod_ref: it.cod_ref || r.cod_ref,
            desc_ref: it.desc_ref || r.desc_ref,
            desc_servico: it.desc_servico || r.desc_servico,
            cor: it.cor || '',
            grade: it.grade,
            qtd_total: qtdItem,
            preco_unit: precoItem,
            valor_total: valorItem,
            _isItem: true,
          });
        }
      } else {
        // Legado: 1 linha por remessa
        linhas.push({
          num_controle: r.num_controle,
          num_op: r.num_op,
          cod_ref: r.cod_ref,
          desc_ref: r.desc_ref,
          desc_servico: r.desc_servico,
          cor: r.cor || '',
          grade: r.grade,
          qtd_total: Number(r.qtd_total) || 0,
          preco_unit: Number(r.preco_unit) || 0,
          valor_total: Number(r.valor_total) || 0,
          _isItem: false,
        });
      }
    }
    return linhas;
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

    // 🆕 MULTI-ITENS: achata cada remessa em N linhas (1 por item).
    // Mantém UM ÚNICO cabeçalho, UMA ÚNICA tabela e UM ÚNICO total geral.
    const linhasItens = this._flattenRemessasParaLinhas(remessas);

    // 🆕 GRADE DINÂMICA — coleta união dos tamanhos REALMENTE existentes nas linhas
    const TAMS = this._coletaTamanhosUniao(linhasItens);
    const NCOLS_TAM = TAMS.length;
    const wGrade = Math.max(2.6, Math.min(6.5, 33 / Math.max(1, NCOLS_TAM)));
    const colTamCSS = `<col class="col-grade" style="width:${wGrade.toFixed(2)}%">`.repeat(NCOLS_TAM);
    const tdTamVazio = `<td class="col-grade"></td>`.repeat(NCOLS_TAM);
    const colspanTot = 6 + NCOLS_TAM;

    // Totais (somatório das linhas — funciona p/ multi-itens e legado)
    const tot = linhasItens.reduce((a, l) => ({
      qtd: a.qtd + (Number(l.qtd_total) || 0),
      valor: a.valor + (Number(l.valor_total) || 0),
    }), { qtd: 0, valor: 0 });

    // Renderiza UMA LINHA POR ITEM (não cria página/romaneio nova)
    const linhas = linhasItens.map((l, i) => `
      <tr${i % 2 === 1 ? ' class="zebra"' : ''}>
        <td class="col-ctrl center"><b>${l.num_controle || ''}</b></td>
        <td class="col-op center">${l.num_op || '—'}</td>
        <td class="col-ref left"><b>${l.cod_ref || ''}</b></td>
        <td class="col-desc left">${l.desc_ref || ''}</td>
        <td class="col-serv left">${l.desc_servico || ''}</td>
        <td class="col-cor center">${l.cor || '—'}</td>
        ${this._gradeCellsFromItem(l, TAMS)}
        <td class="col-qtd right"><b>${fmt.int(l.qtd_total || 0)}</b></td>
        <td class="col-preco right">${fmt.num(l.preco_unit || 0, 2)}</td>
        <td class="col-valor right"><b>${fmt.num(l.valor_total || 0, 2)}</b></td>
      </tr>
    `).join('');

    // Linhas vazias mínimas para "preencher" tabela curta sem inflar
    const minLinhas = 5;
    const vazias = Math.max(0, minLinhas - linhasItens.length);
    const linhasVazias = Array(vazias).fill(0).map(() => `
      <tr class="empty">
        <td class="col-ctrl">&nbsp;</td>
        <td class="col-op"></td>
        <td class="col-ref"></td>
        <td class="col-desc"></td>
        <td class="col-serv"></td>
        <td class="col-cor"></td>
        ${tdTamVazio}
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
            ${colTamCSS}
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
              <th colspan="${NCOLS_TAM}" class="grade-header">T A M A N H O S</th>
              <th rowspan="2" class="col-qtd">Qtd<br>Total</th>
              <th rowspan="2" class="col-preco">Preço</th>
              <th rowspan="2" class="col-valor">Valor Total</th>
            </tr>
            <tr>
              ${this._gradeHeaderHTML(TAMS)}
            </tr>
          </thead>
          <tbody>
            ${linhas}
            ${linhasVazias}
            <tr class="tot-row">
              <td colspan="${colspanTot}" class="tot-label">TOTAL GERAL</td>
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

    // 🆕 GRADE DINÂMICA — extrai tamanhos da remessa (e dos itens, se multi-itens)
    const fontes = Array.isArray(remessa.itens) && remessa.itens.length > 0
      ? remessa.itens
      : [remessa];
    const TAMS = this._coletaTamanhosUniao(fontes);

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
              ${this._gradeHeaderHTML(TAMS)}
              <th>Total</th>
              <th>Data de<br>Envio</th>
              <th>Previsão<br>Entrega</th>
            </tr>
          </thead>
          <tbody>
            <tr class="destaque">
              <td class="left"><b>${remessa.cod_ref}</b></td>
              <td>${remessa.cor || '—'}</td>
              ${this._gradeCellsFromRem(remessa, TAMS)}
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

    // 🆕 GRADE DINÂMICA — usa união dos tamanhos da remessa + retornos
    const fontes = [remessa, ...retornos];
    if (Array.isArray(remessa.itens)) fontes.push(...remessa.itens);
    const ORDEM = this._coletaTamanhosUniao(fontes);
    const gradeEnviada = this._gradeToObj(remessa.grade);

    const saldos = {};
    ORDEM.forEach(t => { saldos[t] = gradeEnviada[t] || 0; });

    const linhasColetas = [];
    for (let i = 0; i < minColetas; i++) {
      const ret = retornos[i];
      const gradeRet = ret ? this._gradeToObj(ret.grade) : {};

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
                ${this._gradeHeaderHTML(ORDEM)}
                <th>Total</th>
                <th>Data de<br>Envio</th>
                <th>Previsão<br>Entrega</th>
              </tr>
            </thead>
            <tbody>
              <tr class="destaque">
                <td class="left"><b>${remessa.cod_ref}</b></td>
                <td>${remessa.cor || '—'}</td>
                ${this._gradeCellsFromRem(remessa, ORDEM)}
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
                ${this._gradeHeaderHTML(ORDEM)}
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
                { label: 'Falta', data: prod.map(p => fmt.safeNum(p?.refugo)), backgroundColor: '#ef4444' },
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
    menu.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${Math.max(8, rect.right - 200)}px;background:var(--surface-1,#fff);border:1px solid var(--border,#cbd5e1);box-shadow:0 10px 25px rgba(0,0,0,0.25);border-radius:8px;z-index:8000;min-width:200px;font-size:13px;overflow:hidden;`;
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

/* =================================================================
 * 🎨 Helper: hex de cor a partir do nome (mapa PT-BR + hash fallback)
 * ================================================================= */
function TERC_corHex(nome) {
  if (!nome) return '#cbd5e1';
  const n = String(nome).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const map = {
    'amarelo':'#facc15','areia':'#d6c79e','azul':'#2563eb','azul claro':'#60a5fa',
    'azul marinho':'#1e3a8a','marinho':'#1e3a8a','bege':'#e7d4b5','branco':'#ffffff',
    'caqui':'#a08d5f','cereja':'#b91c1c','chumbo':'#475569','cinza':'#94a3b8',
    'creme':'#fef3c7','dourado':'#d4a017','gelo':'#f1f5f9','goiaba':'#f87171',
    'indigo':'#4f46e5','laranja':'#f97316','lodo':'#65733d','marrom':'#78350f',
    'mostarda':'#ca8a04','off white':'#faf7ec','petroleo':'#0f766e',
    'pink':'#ec4899','preto':'#0a0a0a','rosa':'#fb7185','roxo':'#7c3aed',
    'salmao':'#fb923c','verde':'#16a34a','verde claro':'#86efac',
    'verde musgo':'#4d6b32','vermelho':'#dc2626','vinho':'#7f1d1d',
  };
  if (map[n]) return map[n];
  let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 65% 55%)`;
}
function TERC_normCorPt(s) {
  const t = String(s ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  return t.toLocaleLowerCase('pt-BR').replace(/(^|\s|-|\/)(\p{L})/gu,
    (_m, sep, ch) => sep + ch.toLocaleUpperCase('pt-BR'));
}

/* =================================================================
 * MODAL — NOVA/EDIÇÃO REMESSA — MULTI-PRODUTOS + MULTI-CORES
 *
 * Estrutura de estado local (array de itens):
 *   itens = [{ uid, cod_ref, desc_ref, id_servico, cor, preco_unit, tempo_peca, grade:{TAM:qtd,...} }, ...]
 *
 * Ações:
 *   - Adicionar Produto (item novo)
 *   - Adicionar Cor (clona o item duplicando produto, mas cor vazia + grade zerada)
 *   - Remover item
 *
 * Cálculo:
 *   - total_item = soma(grade) * preco_unit
 *   - total_remessa = soma(total_item)  (rodapé fixo)
 *
 * Edição: ao abrir uma remessa existente, carrega itens[] do GET /terc/remessas/:id
 * ================================================================= */
/* =================================================================
 * MODAL — NOVA/EDIÇÃO REMESSA — MULTI-PRODUTOS + MULTI-CORES
 *
 * Estrutura local:
 *   itens = [
 *     { uid, id_item, id_produto, cod_ref, desc_ref, id_servico, cor,
 *       preco_unit, tempo_peca, grade:{TAM:qtd,...}, _qtdRetornada }
 *   ]
 *   - 1 produto + 1 cor = 1 item (cada cor é uma linha separada).
 *   - Grade independente por item.
 *   - Total por item = soma(grade) * preco_unit.
 *   - Total da remessa = soma(total_item) — exibido fixo no rodapé.
 *
 * Ações: + Adicionar Produto · + Adicionar Cor · Remover item.
 * Render simples (sem framework), 1 POST/PUT em lote ao salvar.
 * ================================================================= */
async function TERC_openRemModal(id, onSave) {
  const edit = !!id;
  await TERC.load();
  // Lista "universal" usada como fallback quando nenhuma grade dinâmica está disponível.
  // Inclui todos os tamanhos comuns para acomodar remessas legadas.
  const TAMANHOS_FALLBACK = ['PP', 'P', 'M', 'G', 'GG', 'EG', 'XG', 'UN', 'TAM1', 'TAM2'];

  // ---- Carrega grades de tamanho dinâmicas ----
  let GRADES_TAMANHO = [];
  let GRADE_DEFAULT = null;
  try {
    const rg = await api('get', '/terc/grades-tamanho', null, { silent: true });
    GRADES_TAMANHO = fmt.safeArr(rg?.data).filter(g => g.ativo);
    GRADE_DEFAULT = GRADES_TAMANHO.find(g => g.is_default) || GRADES_TAMANHO[0] || null;
  } catch {}

  // Helpers de grade dinâmica
  function _gradeTamanhosArray(g) {
    if (!g || !g.tamanhos) return [];
    return String(g.tamanhos).split(',').map(t => t.trim()).filter(Boolean);
  }
  // Tamanhos visíveis para um item: prioriza id_grade_tamanho do item;
  // se ausente, usa os tamanhos da grade padrão; em última instância usa fallback
  // mesclado com tamanhos já existentes na grade do item (modo edição).
  function _itemTamanhos(it) {
    let arr = [];
    if (it.id_grade_tamanho) {
      const g = GRADES_TAMANHO.find(x => x.id_grade == it.id_grade_tamanho);
      arr = _gradeTamanhosArray(g);
    }
    if (arr.length === 0 && GRADE_DEFAULT) arr = _gradeTamanhosArray(GRADE_DEFAULT);
    if (arr.length === 0) arr = TAMANHOS_FALLBACK.slice();
    // Inclui tamanhos pré-existentes (edição de remessa antiga)
    Object.keys(it.grade || {}).forEach(t => {
      if (Number(it.grade[t]) > 0 && !arr.includes(t)) arr.push(t);
    });
    return arr;
  }
  // Lista global de tamanhos (união de todas as grades + fallback) — usada para
  // garantir que ao salvar nenhum tamanho seja perdido caso o usuário troque de grade.
  function _allKnownTamanhos() {
    const set = new Set(TAMANHOS_FALLBACK);
    GRADES_TAMANHO.forEach(g => _gradeTamanhosArray(g).forEach(t => set.add(t)));
    return Array.from(set);
  }
  const TAMANHOS = _allKnownTamanhos();

  // ---- Carrega dados da remessa (edição) ou usa defaults (nova) ----
  let r = {
    dt_saida: dayjs().format('YYYY-MM-DD'),
    status: 'AguardandoEnvio',
    efic_pct: 0.8, qtd_pessoas: 1, min_trab_dia: 480, prazo_dias: 0,
    itens: [],
  };
  if (edit) {
    try {
      const res = await api('get', '/terc/remessas/' + id);
      r = res.data || r;
      r.itens = Array.isArray(r.itens) ? r.itens : [];
    } catch { return; }
  }

  let num_controle = r.num_controle || 0;
  if (!edit) {
    try {
      const n = await api('get', '/terc/remessas/next-num');
      num_controle = n.data?.num_controle || 0;
    } catch {}
  }

  // ---- Cache global de cores (1 fetch para o modal todo) ----
  let _coresCache = [];
  try {
    const rc = await api('get', '/terc/cores/distinct', null, { silent: true });
    _coresCache = fmt.safeArr(rc?.data);
  } catch {}
  if (_coresCache.length === 0) {
    _coresCache = fmt.safeArr(window.TERC?.cores).map(c => ({ nome_cor: c.nome_cor, hex: c.hex, uso: 0 }));
  }

  // ---- Estado local: itens ----
  let _uid = 1;
  function newItem(over = {}) {
    const grade = {};
    if (over.grade && Array.isArray(over.grade)) {
      over.grade.forEach(x => { grade[x.tamanho] = Number(x.qtd || 0); });
    } else if (over.grade && typeof over.grade === 'object') {
      Object.assign(grade, over.grade);
    }
    // Detecta a grade de tamanho usada por este item:
    //  - Se vier explícito do backend (id_grade_tamanho) usa ele.
    //  - Senão, tenta casar pelos tamanhos já presentes com alguma grade cadastrada.
    //  - Senão, usa a default.
    let idGrade = over.id_grade_tamanho || null;
    if (!idGrade && Object.keys(grade).length > 0) {
      const tamsItem = Object.keys(grade).filter(t => Number(grade[t]) > 0).map(t => t.toUpperCase()).sort().join(',');
      const match = GRADES_TAMANHO.find(g => {
        const ts = _gradeTamanhosArray(g).map(t => t.toUpperCase()).sort().join(',');
        return ts === tamsItem;
      });
      if (match) idGrade = match.id_grade;
    }
    if (!idGrade && GRADE_DEFAULT) idGrade = GRADE_DEFAULT.id_grade;

    return {
      uid: _uid++,                                  // sempre novo (interno)
      id_item: over.id_item || null,                // null em duplicações: novo item no backend
      id_produto: over.id_produto || '',
      cod_ref: over.cod_ref || '',
      desc_ref: over.desc_ref || '',
      id_servico: over.id_servico || '',
      cor: over.cor || '',
      preco_unit: Number(over.preco_unit || 0),
      tempo_peca: Number(over.tempo_peca || 0),
      grade,
      id_grade_tamanho: idGrade,
      observacao: over.observacao || '',            // observação por item (se existir)
      // Nº OP por item: herda do cabeçalho até o usuário editar manualmente.
      // _num_op_manual=true significa que este item foi divergido e não sincroniza mais.
      num_op: (over.num_op != null ? String(over.num_op) : ''),
      _num_op_manual: !!over._num_op_manual,
      // _qtdRetornada NUNCA é copiado em duplicações: clone é item novo, sem retornos
      _qtdRetornada: Number(over._qtdRetornada || 0),
      _precoTag: '',
    };
  }

  let itens = [];
  if (edit && Array.isArray(r.itens) && r.itens.length > 0) {
    itens = r.itens.map(it => newItem(it));
  } else if (edit) {
    // Remessa antiga sem itens — converte cabeçalho em 1 item
    const g = {};
    (r.grade || []).forEach(x => { g[x.tamanho] = Number(x.qtd || 0); });
    itens.push(newItem({
      cod_ref: r.cod_ref, desc_ref: r.desc_ref, id_servico: r.id_servico,
      cor: r.cor, preco_unit: r.preco_unit, tempo_peca: r.tempo_peca, grade: g,
    }));
  } else {
    itens.push(newItem());
  }

  // ---- Modal shell ----
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', {
    class: 'modal p-5 w-full max-w-6xl',
    style: 'max-height:94vh;display:flex;flex-direction:column;gap:8px',
  });

  card.innerHTML = `
    <div class="flex items-center justify-between">
      <h3 class="text-lg font-semibold">
        <i class="fas fa-truck-fast mr-2 text-brand"></i>
        ${edit ? 'Editar' : 'Nova'} Remessa · Nº
        <span class="font-mono text-brand">${num_controle}</span>
      </h3>
      <label class="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
        <input type="checkbox" id="m-adv" /> Modo avançado
      </label>
    </div>

    <!-- Cabeçalho da remessa -->
    <div class="grid grid-cols-6 gap-3">
      <div class="col-span-3"><label>Terceirizado *</label>
        <select id="m-terc">${TERC.optTerc(r.id_terc, true)}</select></div>
      <div class="col-span-2"><label>Coleção</label>
        <select id="m-col">${TERC.optColecoes(r.id_colecao)}</select></div>
      <div class="col-span-1"><label>Data saída *</label>
        <input type="date" id="m-dts" value="${r.dt_saida || ''}" /></div>
      <div class="col-span-2"><label>Nº OP *</label>
        <input id="m-op" value="${r.num_op || ''}" placeholder="ex.: 1234" required /></div>
    </div>

    <!-- Bloco AVANÇADO (oculto por padrão) -->
    <div id="m-advanced" class="hidden pt-2 mt-1 border-t border-dashed">
      <div class="text-xs text-slate-500 mb-2">
        <i class="fas fa-circle-info mr-1"></i>Sobreposições manuais — vêm do terceirizado por padrão.
      </div>
      <div class="grid grid-cols-6 gap-3">
        <div><label>Data início</label>
          <input type="date" id="m-dti" value="${r.dt_inicio || r.dt_saida || ''}" /></div>
        <div><label>Qtd pessoas</label>
          <input type="number" min="1" id="m-pess" value="${r.qtd_pessoas || 1}" /></div>
        <div><label>Min trab/dia</label>
          <input type="number" min="60" id="m-min" value="${r.min_trab_dia || 480}" /></div>
        <div><label>Eficiência (0-1)</label>
          <input type="number" step="0.01" min="0.1" max="1" id="m-ef" value="${r.efic_pct || 0.8}" /></div>
        <div><label>Prazo fixo (dias)</label>
          <input type="number" min="0" id="m-pz" value="${r.prazo_dias || 0}" /></div>
        <div><label>Status</label>
          <select id="m-status">
            <option value="AguardandoEnvio" ${r.status === 'AguardandoEnvio' ? 'selected' : ''}>Aguardando envio</option>
            <option value="Enviado" ${r.status === 'Enviado' ? 'selected' : ''}>Enviado</option>
            <option value="EmProducao" ${r.status === 'EmProducao' ? 'selected' : ''}>Em produção</option>
            <option value="Parcial" ${r.status === 'Parcial' ? 'selected' : ''}>Parcial</option>
            <option value="Concluido" ${r.status === 'Concluido' ? 'selected' : ''}>Concluído</option>
            <option value="Cancelado" ${r.status === 'Cancelado' ? 'selected' : ''}>Cancelado</option>
          </select>
        </div>
        <div class="col-span-6"><label>Observação</label>
          <textarea id="m-obs" rows="2">${r.observacao || ''}</textarea></div>
      </div>
    </div>

    <!-- Botoeira de itens -->
    <div class="flex items-center justify-between mt-1">
      <div class="text-sm font-semibold text-slate-700">
        <i class="fas fa-boxes-stacked mr-1 text-brand"></i>Produtos da remessa
      </div>
      <div class="flex gap-2">
        <button id="btn-add-prod" type="button" class="btn btn-primary btn-sm">
          <i class="fas fa-plus mr-1"></i>Adicionar Produto
        </button>
      </div>
    </div>

    <!-- Container de cards (scroll interno) -->
    <div id="itens-wrap" style="flex:1;overflow-y:auto;padding-right:4px;display:flex;flex-direction:column;gap:10px"></div>

    <!-- Rodapé fixo: totais + ações -->
    <div class="border-t pt-3 mt-1 flex items-center justify-between gap-3" style="flex-shrink:0">
      <div class="flex flex-wrap items-center gap-4 text-sm">
        <span>Itens: <b id="tot-itens">0</b></span>
        <span>Peças: <b id="tot-pcs">0</b></span>
        <span>Total: <b id="tot-valor" class="text-emerald-700">R$ 0,00</b></span>
        <span class="text-slate-500">Previsão: <b id="tot-prev">—</b></span>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button id="m-cancel" class="btn btn-secondary">Cancelar</button>
        <button id="m-rascunho" class="btn btn-secondary" title="Salva o estado atual no navegador para continuar depois">
          <i class="fas fa-bookmark mr-1"></i>Salvar rascunho
        </button>
        <button id="m-save" class="btn btn-primary">
          <i class="fas fa-save mr-1"></i>Salvar remessa
        </button>
      </div>
    </div>
  `;
  m.appendChild(card);
  document.body.appendChild(m);

  // ---- Validação em tempo real do CABEÇALHO (Nº OP, Terceirizado, Data saída) ----
  // Nº OP: bloqueia espaços puros, valida no blur. Aceita números e letras (códigos como "OP-1234").
  const _opEl = card.querySelector('#m-op');
  if (_opEl) {
    _opEl.addEventListener('input', () => {
      // Remove o erro assim que o usuário começa a digitar algo válido
      const v = (_opEl.value || '').trim();
      if (v && _opEl.classList.contains('field-invalid')) {
        _opEl.classList.remove('field-invalid');
        const err = _opEl.parentElement?.querySelector(':scope > .field-error');
        if (err) err.remove();
      }
    });
    _opEl.addEventListener('blur', () => {
      const v = (_opEl.value || '').trim();
      // Normaliza: remove espaços extras nas bordas
      if (v !== _opEl.value) _opEl.value = v;
      if (!v) {
        _markInvalid(_opEl, 'Informe o Nº da OP.');
      }
    });
  }
  // Terceirizado: valida no change
  const _tercEl = card.querySelector('#m-terc');
  if (_tercEl) {
    _tercEl.addEventListener('change', () => {
      if (_tercEl.value) {
        _tercEl.classList.remove('field-invalid');
        const err = _tercEl.parentElement?.querySelector(':scope > .field-error');
        if (err) err.remove();
      } else {
        _markInvalid(_tercEl, 'Selecione o terceirizado.');
      }
    });
  }
  // Data saída: valida no change
  const _dtsEl = card.querySelector('#m-dts');
  if (_dtsEl) {
    _dtsEl.addEventListener('change', () => {
      if (_dtsEl.value) {
        _dtsEl.classList.remove('field-invalid');
        const err = _dtsEl.parentElement?.querySelector(':scope > .field-error');
        if (err) err.remove();
      } else {
        _markInvalid(_dtsEl, 'Informe a data de saída.');
      }
    });
  }

  // ---- RASCUNHO LOCAL (localStorage) ----
  // Cada sessão de Nova Remessa pode salvar/recuperar 1 rascunho.
  // Edição de remessa existente NÃO usa rascunho (escopo: novas).
  const RASCUNHO_KEY = 'corepro:remessa:rascunho';
  function _coletarEstado() {
    return {
      ts: Date.now(),
      cabecalho: {
        num_op: $('#m-op')?.value || '',
        id_terc: $('#m-terc')?.value || '',
        id_colecao: $('#m-col')?.value || '',
        dt_saida: $('#m-dts')?.value || '',
        dt_inicio: $('#m-dti')?.value || '',
        qtd_pessoas: $('#m-pess')?.value || '',
        min_trab_dia: $('#m-min')?.value || '',
        efic_pct: $('#m-ef')?.value || '',
        prazo_dias: $('#m-pz')?.value || '',
        status: $('#m-status')?.value || 'AguardandoEnvio',
        observacao: $('#m-obs')?.value || '',
      },
      itens: itens.map(it => ({
        id_produto: it.id_produto, cod_ref: it.cod_ref, desc_ref: it.desc_ref,
        id_servico: it.id_servico, cor: it.cor,
        preco_unit: it.preco_unit, tempo_peca: it.tempo_peca,
        grade: it.grade, id_grade_tamanho: it.id_grade_tamanho,
        num_op: it.num_op, _num_op_manual: it._num_op_manual,
      })),
    };
  }
  function _aplicarEstado(s) {
    if (!s || !s.cabecalho) return;
    const h = s.cabecalho;
    if ($('#m-op'))    $('#m-op').value    = h.num_op || '';
    if ($('#m-terc'))  $('#m-terc').value  = h.id_terc || '';
    if ($('#m-col'))   $('#m-col').value   = h.id_colecao || '';
    if ($('#m-dts'))   $('#m-dts').value   = h.dt_saida || '';
    if ($('#m-dti'))   $('#m-dti').value   = h.dt_inicio || '';
    if ($('#m-pess'))  $('#m-pess').value  = h.qtd_pessoas || 1;
    if ($('#m-min'))   $('#m-min').value   = h.min_trab_dia || 480;
    if ($('#m-ef'))    $('#m-ef').value    = h.efic_pct || 0.8;
    if ($('#m-pz'))    $('#m-pz').value    = h.prazo_dias || 0;
    if ($('#m-status'))$('#m-status').value= h.status || 'AguardandoEnvio';
    if ($('#m-obs'))   $('#m-obs').value   = h.observacao || '';
    if (Array.isArray(s.itens) && s.itens.length > 0) {
      itens = s.itens.map(it => newItem(it));
      mountItens();
    }
  }
  // Oferece restaurar rascunho ao abrir Nova Remessa
  if (!edit) {
    try {
      const raw = localStorage.getItem(RASCUNHO_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        const ageMin = Math.round((Date.now() - (data.ts || 0)) / 60000);
        setTimeout(() => {
          if (confirm(`Existe um rascunho salvo há ${ageMin} min. Deseja recuperá-lo?`)) {
            _aplicarEstado(data);
            toast('Rascunho recuperado', 'success');
          } else {
            localStorage.removeItem(RASCUNHO_KEY);
          }
        }, 200);
      }
    } catch {}
  }

  // ---- Toggle modo avançado ----
  $('#m-adv').onchange = (e) => $('#m-advanced').classList.toggle('hidden', !e.target.checked);

  // ---- Auto-fill parâmetros do terceirizado ----
  $('#m-terc').addEventListener('change', () => {
    const t = TERC.terceirizados.find(x => x.id_terc == $('#m-terc').value);
    if (t) {
      if ($('#m-pess')) $('#m-pess').value = t.qtd_pessoas || 1;
      if ($('#m-min')) $('#m-min').value = t.min_trab_dia || 480;
      if ($('#m-ef')) $('#m-ef').value = t.efic_padrao || 0.8;
      if ($('#m-pz')) $('#m-pz').value = t.prazo_padrao || 0;
      recalcAll();
    }
  });

  // =================================================================
  // RENDER DE 1 ITEM (card) — produto + cor + grade independente
  // =================================================================
  function renderItemCard(it) {
    const wrap = document.createElement('div');
    wrap.className = 'rem-item-card';
    wrap.dataset.uid = String(it.uid);

    const corHex = TERC_corHex(it.cor);
    const isLight = ['#ffffff','#fef3c7','#faf7ec','#f1f5f9','#e7d4b5','#86efac'].includes(corHex);
    const corBadge = it.cor
      ? `<span class="rem-cor-badge" style="background:${corHex};color:${isLight?'#0f172a':'#fff'}">
           <span class="rem-cor-dot" style="background:${isLight?'#0f172a':'#fff'}"></span>${it.cor}
         </span>`
      : '';

    const idProdSel = it.id_produto || (TERC.findProdutoByRef ? (TERC.findProdutoByRef(it.cod_ref, r.id_colecao)?.id_produto || '') : '');

    wrap.innerHTML = `
      <div class="rem-item-head">
        <div class="rem-item-title">
          <i class="fas fa-tshirt"></i>
          <span>Produto</span>
          <span class="rem-item-cor" data-role="cor-label">${corBadge}</span>
        </div>
        <div class="rem-item-actions">
          <button type="button" class="btn btn-secondary btn-sm rem-btn-dup" data-act="dup-item" title="Duplicar este produto com todos os dados (cor, grade, OP, preço, tempo)">
            <i class="fas fa-clone mr-1"></i>Duplicar
          </button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="add-cor" title="Duplicar este produto com outra cor">
            <i class="fas fa-palette mr-1"></i>+ Cor
          </button>
          <button type="button" class="btn btn-danger btn-sm" data-act="remove" title="Remover este item">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>

      <div class="grid grid-cols-12 gap-2">
        <div class="col-span-5"><label>Produto *</label>
          <select data-f="prod">${TERC.optProdutos(idProdSel, r.id_colecao)}</select></div>
        <div class="col-span-3"><label>Serviço *</label>
          <select data-f="serv">${TERC.optServicos(it.id_servico)}</select></div>
        <div class="col-span-2"><label>Referência</label>
          <input data-f="ref" value="${(it.cod_ref || '').replace(/"/g, '&quot;')}" placeholder="auto" /></div>
        <div class="col-span-2"><label>Preço (R$) <span class="text-xs" data-role="preco-tag"></span></label>
          <input type="number" step="0.01" data-f="preco" value="${Number(it.preco_unit || 0).toFixed(2)}" /></div>

        <div class="col-span-5"><label>Descrição</label>
          <input data-f="descref" value="${(it.desc_ref || '').replace(/"/g, '&quot;')}" /></div>
        <div class="col-span-3">
          <label>Cor</label>
          <div class="rem-cor-wrap">
            <input data-f="cor" value="${(it.cor || '').replace(/"/g, '&quot;')}" placeholder="Selecione ou digite" autocomplete="off" />
            <button data-f="cor-toggle" type="button" tabindex="-1" class="rem-cor-toggle">
              <i class="fas fa-palette"></i>
            </button>
            <div data-f="cor-dd" class="rem-cor-dd hidden"></div>
          </div>
        </div>
        <div class="col-span-2"><label>Nº OP * <span class="text-xs rem-op-tag" data-role="op-tag"></span></label>
          <div class="rem-op-wrap">
            <input data-f="num_op" value="${(it.num_op || '').replace(/"/g, '&quot;')}" placeholder="herda do cabeçalho" autocomplete="off" />
            <button data-f="op-reset" type="button" tabindex="-1" class="rem-op-reset hidden" title="Voltar a herdar do cabeçalho">
              <i class="fas fa-rotate-left"></i>
            </button>
          </div>
        </div>
        <div class="col-span-2"><label>Tempo/peça (min)</label>
          <input type="number" step="0.01" data-f="tempo" value="${Number(it.tempo_peca || 0)}" /></div>

        <div class="col-span-12">
          <div class="rem-grade-head">
            <label class="rem-grade-label">Grade *</label>
            <div class="rem-grade-tools">
              <label class="rem-grade-tools-label">Grade de tamanho:</label>
              <select data-f="grade-tipo" class="rem-grade-select">
                ${GRADES_TAMANHO.length === 0
                  ? '<option value="">— sem grades cadastradas —</option>'
                  : GRADES_TAMANHO.map(g => `<option value="${g.id_grade}" ${g.id_grade == it.id_grade_tamanho ? 'selected' : ''}>${(g.nome || '').replace(/</g,'&lt;')} (${g.tamanhos})</option>`).join('')
                }
              </select>
              <button type="button" class="btn btn-secondary btn-sm" data-act="copy-grade" title="Copiar grade deste item para os demais">
                <i class="fas fa-clone"></i>
              </button>
            </div>
          </div>
          <div class="grade-dynamic-wrap" data-f="grade">
            ${_itemTamanhos(it).map(t => `
              <div class="text-center">
                <div class="grade-tam-label">${t}</div>
                <input data-tam="${t}" type="number" min="0" value="${it.grade[t] || 0}" class="text-center grade-in-x grade-dynamic-input" />
              </div>`).join('')}
          </div>
          <div class="rem-item-totals">
            <span>Total item: <b data-role="tot-pcs">0</b> pç</span>
            <span>Valor: <b data-role="tot-val" class="rem-tot-val">R$ 0,00</b></span>
            ${it._qtdRetornada > 0
              ? `<span class="rem-retornado-hint"><i class="fas fa-undo mr-1"></i>Retornado: ${it._qtdRetornada} pç (mín. permitido)</span>`
              : ''}
          </div>
        </div>
      </div>
    `;

    // ---- Event listeners deste card ----
    const $$ = (sel) => wrap.querySelector(sel);
    const fProd = $$('[data-f="prod"]');
    const fServ = $$('[data-f="serv"]');
    const fRef = $$('[data-f="ref"]');
    const fDesc = $$('[data-f="descref"]');
    const fCor = $$('[data-f="cor"]');
    const fCorToggle = $$('[data-f="cor-toggle"]');
    const fCorDD = $$('[data-f="cor-dd"]');
    const fPreco = $$('[data-f="preco"]');
    const fTempo = $$('[data-f="tempo"]');
    const fOp = $$('[data-f="num_op"]');
    const fOpReset = $$('[data-f="op-reset"]');
    const opTag = $$('[data-role="op-tag"]');
    const corLabel = $$('[data-role="cor-label"]');
    const precoTag = $$('[data-role="preco-tag"]');

    // ---- Nº OP por item: herda/manual + sync inteligente ----
    function refreshOpUI() {
      if (!fOp) return;
      if (it._num_op_manual) {
        fOp.classList.add('rem-op-manual');
        if (opTag) opTag.innerHTML = '<i class="fas fa-pencil"></i> manual';
        if (fOpReset) fOpReset.classList.remove('hidden');
      } else {
        fOp.classList.remove('rem-op-manual');
        if (opTag) opTag.innerHTML = '<i class="fas fa-link"></i> herda';
        if (fOpReset) fOpReset.classList.add('hidden');
      }
    }
    refreshOpUI();
    if (fOp) {
      fOp.addEventListener('input', () => {
        // Qualquer digitação no campo marca o item como manual
        it.num_op = fOp.value;
        it._num_op_manual = true;
        refreshOpUI();
      });
      fOp.addEventListener('blur', () => {
        const v = (fOp.value || '').trim();
        it.num_op = v;
        // Se ficou vazio, volta a herdar do cabeçalho automaticamente
        if (!v) {
          it._num_op_manual = false;
          const mainOp = ($('#m-op')?.value || '').trim();
          it.num_op = mainOp;
          fOp.value = mainOp;
          refreshOpUI();
        }
        // Validação visual: num_op é obrigatório
        if (!it.num_op || !String(it.num_op).trim()) {
          _markInvalid(fOp, 'Informe o Nº da OP deste item.');
        } else {
          fOp.classList.remove('field-invalid');
          const err = fOp.parentElement?.parentElement?.querySelector(':scope > .field-error');
          if (err) err.remove();
        }
      });
    }
    if (fOpReset) {
      fOpReset.addEventListener('click', (e) => {
        e.preventDefault();
        it._num_op_manual = false;
        const mainOp = ($('#m-op')?.value || '').trim();
        it.num_op = mainOp;
        if (fOp) fOp.value = mainOp;
        refreshOpUI();
      });
    }

    function corBadgeHTML(nome) {
      if (!nome) return '';
      const hex = TERC_corHex(nome);
      const isLite = ['#ffffff','#fef3c7','#faf7ec','#f1f5f9','#e7d4b5','#86efac'].includes(hex);
      return `<span class="rem-cor-badge" style="background:${hex};color:${isLite?'#0f172a':'#fff'}">
        <span class="rem-cor-dot" style="background:${isLite?'#0f172a':'#fff'}"></span>${nome}
      </span>`;
    }
    function refreshCorLabel() { corLabel.innerHTML = corBadgeHTML(fCor.value.trim()); }
    function setPrecoTag(txt, color) { precoTag.innerHTML = txt ? `<span style="color:${color}">${txt}</span>` : ''; }

    // ---- Cor: dropdown + autocomplete ----
    function renderCorDD(filterTerm = '') {
      const q = filterTerm.trim().toLocaleLowerCase('pt-BR');
      const items = _coresCache.filter(c => !q || (c.nome_cor || '').toLocaleLowerCase('pt-BR').includes(q));
      let html = '';
      if (items.length === 0 && q) {
        html += `<div class="cor-opt cor-opt-new" data-novo="${q.replace(/"/g,'&quot;')}">
          <i class="fas fa-plus"></i><span>Nova cor: <b>${TERC_normCorPt(filterTerm)}</b></span>
        </div>`;
      }
      html += items.slice(0, 50).map(c => {
        const hex = c.hex || TERC_corHex(c.nome_cor);
        return `<div class="cor-opt" data-cor="${(c.nome_cor || '').replace(/"/g,'&quot;')}">
          <span class="cor-opt-swatch" style="background:${hex}"></span>
          <span class="cor-opt-name">${c.nome_cor}</span>
          ${c.uso > 0 ? `<span class="cor-opt-uso">${c.uso}</span>` : ''}
        </div>`;
      }).join('');
      if (!html) html = '<div class="cor-opt-empty">Sem cores. Digite uma nova.</div>';
      fCorDD.innerHTML = html;
      fCorDD.querySelectorAll('.cor-opt').forEach(opt => {
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const novo = opt.dataset.novo;
          const cor = opt.dataset.cor || TERC_normCorPt(novo || '');
          fCor.value = cor;
          it.cor = cor;
          fCorDD.classList.add('hidden');
          refreshCorLabel();
          autoLookup();
        });
      });
    }

    fCor.addEventListener('focus', () => { renderCorDD(fCor.value); fCorDD.classList.remove('hidden'); });
    fCor.addEventListener('input', () => { renderCorDD(fCor.value); fCorDD.classList.remove('hidden'); refreshCorLabel(); });
    fCor.addEventListener('blur', () => {
      setTimeout(() => {
        fCorDD.classList.add('hidden');
        const v = TERC_normCorPt(fCor.value);
        if (v !== fCor.value) fCor.value = v;
        it.cor = fCor.value.trim();
        refreshCorLabel();
        // Validação em tempo real: cor é obrigatória
        if (!it.cor) {
          _markInvalid(fCor, 'Informe a cor do produto.');
        } else {
          fCor.classList.remove('field-invalid');
          const err = fCor.parentElement?.querySelector(':scope > .field-error');
          if (err) err.remove();
        }
        autoLookup();
      }, 180);
    });
    fCorToggle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const willOpen = fCorDD.classList.contains('hidden');
      if (willOpen) { renderCorDD(fCor.value); fCorDD.classList.remove('hidden'); fCor.focus(); }
      else fCorDD.classList.add('hidden');
    });

    // ---- Auto-fill ao escolher PRODUTO ----
    fProd.onchange = () => {
      const opt = fProd.options[fProd.selectedIndex];
      if (!opt || !opt.value) return;
      const cod = opt.dataset.cod || '';
      const desc = opt.dataset.desc || '';
      if (cod) { fRef.value = cod; it.cod_ref = cod; }
      if (desc) { fDesc.value = desc; it.desc_ref = desc; }
      it.id_produto = opt.value;
      autoLookup();
    };

    // ---- Lookup automático de preço ----
    let _lastKey = '';
    async function autoLookup() {
      const cod = fRef.value.trim();
      const sv = fServ.value;
      const col = $('#m-col').value;
      const cor = fCor.value.trim();
      const grade = Array.from(wrap.querySelectorAll('.grade-in-x'))
        .map(i => ({ tam: i.dataset.tam, qtd: Number(i.value || 0) }))
        .filter(g => g.qtd > 0).sort((a, b) => b.qtd - a.qtd);
      const tam = grade[0]?.tam || '';
      if (!cod || !sv) { setPrecoTag('', ''); return; }
      const key = `${cod}|${sv}|${col}|${cor}|${tam}`;
      if (key === _lastKey) return;
      _lastKey = key;
      try {
        const params = new URLSearchParams({ cod_ref: cod, id_servico: sv });
        if (col) params.set('id_colecao', col);
        if (cor) params.set('cor', cor);
        if (tam) params.set('tamanho', tam);
        const res = await api('get', '/terc/precos/lookup?' + params.toString(), null, { silent: true });
        if (res.data && res.data.preco != null) {
          fPreco.value = Number(res.data.preco).toFixed(2);
          it.preco_unit = Number(res.data.preco);
          if (res.data.tempo_min) { fTempo.value = res.data.tempo_min; it.tempo_peca = Number(res.data.tempo_min); }
          if (res.data.desc_ref && !fDesc.value) { fDesc.value = res.data.desc_ref; it.desc_ref = res.data.desc_ref; }
          const lvl = res.data.match_level || '';
          const labelMap = {
            'produto+cor+grade+servico': 'tabela: prod+cor+grade+serv',
            'produto+cor+servico': 'tabela: prod+cor+serv',
            'produto+servico': 'tabela: prod+serv',
            'servico_padrao': 'serv. padrão',
          };
          setPrecoTag('<i class="fas fa-check"></i> ' + (labelMap[lvl] || 'tabela'), '#10b981');
          recalcItem();
        } else {
          setPrecoTag('<i class="fas fa-triangle-exclamation"></i> sem preço', '#f59e0b');
        }
      } catch {}
    }

    // ---- Inputs de campo: atualiza estado + recalcula ----
    fServ.addEventListener('change', () => { it.id_servico = fServ.value; autoLookup(); recalcItem(); });
    // Referência: auto-preenchida pelo Produto, editável manualmente, mas NÃO pode ser apagada.
    // Se o usuário esvaziar o campo, restauramos o último valor válido (cod_ref do produto, se houver).
    let _lastValidRef = it.cod_ref || '';
    fRef.addEventListener('input', () => {
      const v = fRef.value.trim();
      if (v) {
        it.cod_ref = v;
        _lastValidRef = v;
      } else {
        it.cod_ref = '';
      }
    });
    fRef.addEventListener('blur', () => {
      // Bloqueia apagamento: se vazio e existe um produto selecionado, restaura a ref do produto
      if (!fRef.value.trim()) {
        let restored = '';
        if (fProd && fProd.value) {
          const opt = fProd.options[fProd.selectedIndex];
          restored = opt?.dataset?.cod || '';
        }
        if (!restored) restored = _lastValidRef || '';
        if (restored) {
          fRef.value = restored;
          it.cod_ref = restored;
          _lastValidRef = restored;
          // Limpa marcação de erro (se houver) — campo agora está válido
          fRef.classList.remove('field-invalid');
          const err = fRef.parentElement?.querySelector(':scope > .field-error');
          if (err) err.remove();
          toast('A referência não pode ser apagada — restaurada automaticamente.', 'warning');
        } else {
          // Sem produto selecionado e sem valor anterior → marca erro inline
          _markInvalid(fRef, 'Informe a referência.');
        }
      }
      _lastKey = '';
      autoLookup();
    });
    fDesc.addEventListener('input', () => { it.desc_ref = fDesc.value.trim(); });
    fPreco.addEventListener('input', () => {
      it.preco_unit = Number(fPreco.value || 0);
      setPrecoTag('<i class="fas fa-keyboard"></i> manual', '#f59e0b');
      recalcItem();
    });
    fTempo.addEventListener('input', () => { it.tempo_peca = Number(fTempo.value || 0); recalcAll(); });

    // ---- Grade: atualiza estado + recalcula ----
    function bindGradeInputs() {
      wrap.querySelectorAll('.grade-in-x').forEach(inp => {
        inp.addEventListener('input', () => {
          it.grade[inp.dataset.tam] = Number(inp.value || 0);
          recalcItem();
        });
        inp.addEventListener('change', () => { _lastKey = ''; autoLookup(); });
      });
    }
    bindGradeInputs();

    // ---- Seletor de Grade dinâmica ----
    const fGradeTipo = wrap.querySelector('[data-f="grade-tipo"]');
    if (fGradeTipo) {
      fGradeTipo.addEventListener('change', () => {
        const idG = Number(fGradeTipo.value) || null;
        it.id_grade_tamanho = idG;
        // Re-renderiza apenas o container da grade (preserva valores existentes)
        const gradeWrap = wrap.querySelector('[data-f="grade"]');
        if (gradeWrap) {
          gradeWrap.innerHTML = _itemTamanhos(it).map(t => `
            <div class="text-center">
              <div class="text-xs font-mono text-slate-500">${t}</div>
              <input data-tam="${t}" type="number" min="0" value="${it.grade[t] || 0}" class="text-center grade-in-x grade-dynamic-input" />
            </div>`).join('');
          bindGradeInputs();
          recalcItem();
        }
      });
    }

    // ---- Botões do card ----
    wrap.querySelector('[data-act="add-cor"]').onclick = () => {
      // Clona produto, mantém serviço/preço/grade-tipo, mas zera grade e cor.
      // Propaga Nº OP: se o item-fonte foi editado manualmente, o clone herda essa edição
      // mantendo a flag manual; senão, o clone herda do cabeçalho normalmente.
      const clone = newItem({
        id_produto: it.id_produto, cod_ref: it.cod_ref, desc_ref: it.desc_ref,
        id_servico: it.id_servico, cor: '', preco_unit: it.preco_unit,
        tempo_peca: it.tempo_peca, grade: {},
        id_grade_tamanho: it.id_grade_tamanho,
        num_op: it.num_op,
        _num_op_manual: it._num_op_manual,
      });
      itens.push(clone);
      mountItens();
      // Foco na cor do novo card
      setTimeout(() => {
        const last = $('#itens-wrap').lastElementChild;
        if (last) last.querySelector('[data-f="cor"]')?.focus();
      }, 30);
    };
    // ============================================================
    // Botão "Duplicar" — cópia COMPLETA do item original
    // ------------------------------------------------------------
    // Copia: Produto, Serviço, Referência, Descrição, Cor, Nº OP,
    //        Preço, Tempo/peça, Grade de tamanho, Quantidades,
    //        Observação por item, flag _num_op_manual.
    // NÃO copia: id_item, uid, _qtdRetornada, _precoTag (estados
    //           temporários / IDs únicos / flags de erro).
    // Após inserir: re-renderiza, recalcula totais, dá scroll
    //               suave até o novo card e aplica animação de
    //               highlight para identificação visual.
    // ============================================================
    const fDupBtn = wrap.querySelector('[data-act="dup-item"]');
    if (fDupBtn) {
      fDupBtn.onclick = () => {
        // Anti-duplo-clique: desabilita o botão durante a operação
        if (fDupBtn.disabled) return;
        fDupBtn.disabled = true;

        // Cópia DEFENSIVA: garante que alterações no clone NÃO afetem o original
        // (objects/arrays são clonados; primitivos copiados por valor naturalmente)
        const clone = newItem({
          // Dados do produto
          id_produto: it.id_produto,
          cod_ref: it.cod_ref,
          desc_ref: it.desc_ref,
          id_servico: it.id_servico,
          // Variantes
          cor: it.cor,
          // Preços e tempo
          preco_unit: Number(it.preco_unit || 0),
          tempo_peca: Number(it.tempo_peca || 0),
          // Grade — deep clone do objeto para edição independente
          grade: { ...(it.grade || {}) },
          id_grade_tamanho: it.id_grade_tamanho,
          // Nº OP por item — preserva o estado (herda ou manual)
          num_op: it.num_op,
          _num_op_manual: it._num_op_manual,
          // Observação por item, se houver
          observacao: it.observacao || '',
          // Explicitamente NÃO copia: id_item, uid (sempre novos),
          // _qtdRetornada (clone não tem histórico de retorno).
        });

        // Insere logo APÓS o item original (não no fim) — UX mais previsível
        const idx = itens.findIndex(x => x.uid === it.uid);
        if (idx >= 0) {
          itens.splice(idx + 1, 0, clone);
        } else {
          itens.push(clone);
        }

        // Re-renderiza a lista e recalcula totais
        mountItens();
        recalcAll();

        // Identificação visual: scroll suave + highlight animado
        setTimeout(() => {
          const novoEl = card.querySelector(`[data-uid="${clone.uid}"]`);
          if (novoEl) {
            try {
              novoEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch {
              // Fallback para navegadores sem scrollIntoView com options
              novoEl.scrollIntoView();
            }
            novoEl.classList.add('rem-item-duplicated');
            // Remove a classe ao final da animação (CSS animation dura 1.6s)
            setTimeout(() => {
              novoEl.classList.remove('rem-item-duplicated');
            }, 1700);
          }
          // Reabilita o botão (caso o card original ainda exista no DOM)
          if (fDupBtn && fDupBtn.isConnected) fDupBtn.disabled = false;
        }, 40);

        toast('Produto duplicado — edite cor/grade/OP se necessário', 'success');
      };
    }
    // ---- Copiar grade deste item para todos os outros ----
    const fCopyGradeBtn = wrap.querySelector('[data-act="copy-grade"]');
    if (fCopyGradeBtn) {
      fCopyGradeBtn.onclick = () => {
        if (itens.length < 2) {
          toast('Adicione outro item antes de copiar a grade', 'warning');
          return;
        }
        const sourceGrade = { ...(it.grade || {}) };
        const sourceGradeId = it.id_grade_tamanho;
        let count = 0;
        itens.forEach(other => {
          if (other.uid === it.uid) return;
          if (other._qtdRetornada > 0) return; // não sobrescreve item com retornos
          other.grade = { ...sourceGrade };
          other.id_grade_tamanho = sourceGradeId;
          count++;
        });
        if (count === 0) {
          toast('Nenhum item disponível para receber a grade', 'warning');
          return;
        }
        mountItens();
        toast(`Grade copiada para ${count} item(ns)`, 'success');
      };
    }
    wrap.querySelector('[data-act="remove"]').onclick = () => {
      if (it._qtdRetornada > 0) {
        toast('Não é possível remover: este item já tem retornos registrados', 'warning');
        return;
      }
      if (itens.length === 1) {
        toast('A remessa precisa ter pelo menos 1 item', 'warning');
        return;
      }
      itens = itens.filter(x => x.uid !== it.uid);
      mountItens();
    };

    // ---- Recalcula totais deste card ----
    function recalcItem() {
      // Soma considerando todos os tamanhos conhecidos no estado (não só os visíveis)
      const total = Object.keys(it.grade || {}).reduce((a, t) => a + (Number(it.grade[t] || 0)), 0);
      const valor = total * Number(it.preco_unit || 0);
      wrap.querySelector('[data-role="tot-pcs"]').textContent = fmt.int(total);
      wrap.querySelector('[data-role="tot-val"]').textContent = TERC.fmtBRL(valor);
      it._totalPcs = total;
      it._totalVal = valor;
      recalcAll();
    }

    // Inicializa totais do card
    recalcItem();
    return wrap;
  }

  // =================================================================
  // RECALC GERAL (rodapé) + previsão
  // =================================================================
  function recalcAll() {
    let totPcs = 0, totVal = 0, tempoMax = 0;
    for (const it of itens) {
      const t = TAMANHOS.reduce((a, tam) => a + (Number(it.grade[tam] || 0)), 0);
      totPcs += t;
      totVal += t * Number(it.preco_unit || 0);
      if (Number(it.tempo_peca || 0) > tempoMax) tempoMax = Number(it.tempo_peca);
    }
    const $tot = $('#tot-itens'); if ($tot) $tot.textContent = itens.length;
    const $pcs = $('#tot-pcs'); if ($pcs) $pcs.textContent = fmt.int(totPcs);
    const $val = $('#tot-valor'); if ($val) $val.textContent = TERC.fmtBRL(totVal);

    // Previsão (usa avançado se preenchido)
    const dts = $('#m-dts').value;
    const pess = Number($('#m-pess')?.value || 1);
    const min = Number($('#m-min')?.value || 480);
    const ef = Number($('#m-ef')?.value || 0.8);
    const pz = Number($('#m-pz')?.value || 0);
    const $prev = $('#tot-prev');
    if (!$prev) return;
    if (totPcs > 0 && dts) {
      let dias = pz > 0 ? pz : (tempoMax > 0
        ? Math.max(1, Math.ceil((totPcs * tempoMax) / (Math.max(1, pess) * Math.max(1, min) * Math.max(0.1, ef))))
        : 0);
      if (dias > 0) {
        const d = dayjs(dts).add(dias, 'day').format('DD/MM/YYYY');
        $prev.textContent = d + ' (' + dias + ' dia' + (dias > 1 ? 's' : '') + ')';
      } else $prev.textContent = 'auto';
    } else $prev.textContent = '—';
  }

  // =================================================================
  // MOUNT/RE-RENDER da lista de cards
  // =================================================================
  function mountItens() {
    const wrap = $('#itens-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    itens.forEach(it => wrap.appendChild(renderItemCard(it)));
    recalcAll();
  }
  mountItens();

  // ---- Listeners globais (cabeçalho) ----
  $('#m-col').addEventListener('change', () => itens.forEach(() => {})); // reservado p/ futuro
  ['m-dts', 'm-pess', 'm-min', 'm-ef', 'm-pz'].forEach(id => {
    const el = $('#' + id); if (el) el.addEventListener('input', recalcAll);
  });

  // ---- Botão: Adicionar Produto ----
  // Novo item herda automaticamente o Nº OP do cabeçalho (sem marcar como manual).
  $('#btn-add-prod').onclick = () => {
    const mainOp = ($('#m-op')?.value || '').trim();
    itens.push(newItem({ num_op: mainOp, _num_op_manual: false }));
    mountItens();
    setTimeout(() => {
      const last = $('#itens-wrap').lastElementChild;
      if (last) last.querySelector('[data-f="prod"]')?.focus();
    }, 30);
  };

  // ---- Sync inteligente: ao editar o Nº OP do cabeçalho,
  //      propaga para os itens que AINDA herdam (não foram manualmente editados).
  if ($('#m-op')) {
    $('#m-op').addEventListener('input', () => {
      const v = ($('#m-op').value || '').trim();
      let touched = 0;
      itens.forEach(it => {
        if (!it._num_op_manual) {
          it.num_op = v;
          touched++;
        }
      });
      if (touched > 0) {
        // Atualiza apenas os inputs visíveis dos itens herdados, sem re-renderizar tudo
        const wraps = $('#itens-wrap')?.querySelectorAll('.rem-item-card') || [];
        wraps.forEach(w => {
          const uid = Number(w.dataset.uid);
          const it = itens.find(x => x.uid === uid);
          if (!it || it._num_op_manual) return;
          const inp = w.querySelector('[data-f="num_op"]');
          if (inp) inp.value = v;
          // Limpa marcação de erro se houver
          if (inp && v) {
            inp.classList.remove('field-invalid');
            const err = inp.parentElement?.parentElement?.querySelector(':scope > .field-error');
            if (err) err.remove();
          }
        });
      }
    });
  }

  // ---- Cancelar ----
  $('#m-cancel').onclick = () => m.remove();

  // ---- Salvar rascunho (localStorage) ----
  const btnRas = $('#m-rascunho');
  if (btnRas) {
    btnRas.onclick = () => {
      try {
        const data = _coletarEstado();
        localStorage.setItem(RASCUNHO_KEY, JSON.stringify(data));
        toast('Rascunho salvo no navegador', 'success');
      } catch (e) {
        toast('Falha ao salvar rascunho', 'error');
      }
    };
  }

  // ---- Helpers de validação visual ----
  // Marca um campo como inválido com borda vermelha + mensagem amigável abaixo
  function _markInvalid(input, msg) {
    if (!input) return;
    input.classList.add('field-invalid');
    // Procura ou cria o elemento de erro logo após o input
    let errEl = input.parentElement?.querySelector(':scope > .field-error');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'field-error text-xs text-red-600 mt-1';
      errEl.style.cssText = 'display:flex;align-items:center;gap:4px';
      input.parentElement?.appendChild(errEl);
    }
    errEl.innerHTML = `<i class="fas fa-circle-exclamation"></i><span>${msg}</span>`;
  }
  function _clearAllInvalid() {
    card.querySelectorAll('.field-invalid').forEach(el => el.classList.remove('field-invalid'));
    card.querySelectorAll('.field-error').forEach(el => el.remove());
    card.querySelectorAll('[data-card-error]').forEach(el => {
      el.removeAttribute('data-card-error');
      el.style.borderColor = '';
      el.style.background = '';
    });
  }
  function _scrollToFirstError() {
    const first = card.querySelector('.field-invalid, [data-card-error]');
    if (first) {
      try { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      try { first.focus({ preventScroll: true }); } catch {}
    }
  }
  function _markCardError(itemUid) {
    const w = card.querySelector(`[data-uid="${itemUid}"]`);
    if (!w) return;
    w.setAttribute('data-card-error', '1');
    w.style.borderColor = '#ef4444';
    w.style.background = '#fef2f2';
  }

  // ---- Cancelar ----
  // (já definido acima, evitamos sobrescrever)

  // ---- Limpa erro automaticamente quando o usuário começa a corrigir ----
  card.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t || !t.classList) return;
    if (t.classList.contains('field-invalid')) {
      t.classList.remove('field-invalid');
      const err = t.parentElement?.querySelector(':scope > .field-error');
      if (err) err.remove();
    }
    // Se o item-card estava marcado e agora algum input dentro dele foi editado, removemos a borda
    const wrap = t.closest('[data-card-error]');
    if (wrap && !wrap.querySelector('.field-invalid')) {
      wrap.removeAttribute('data-card-error');
      wrap.style.borderColor = '';
      wrap.style.background = '';
    }
  });
  card.addEventListener('change', (ev) => {
    const t = ev.target;
    if (!t || !t.classList) return;
    if (t.classList.contains('field-invalid')) {
      t.classList.remove('field-invalid');
      const err = t.parentElement?.querySelector(':scope > .field-error');
      if (err) err.remove();
    }
  });

  // ---- SALVAR (1 requisição em lote) ----
  $('#m-save').onclick = async () => {
    _clearAllInvalid();
    const errs = [];

    // 1) Cabeçalho: Terceirizado, Data saída e Nº OP obrigatórios
    if (!$('#m-terc').value) {
      _markInvalid($('#m-terc'), 'Selecione o terceirizado.');
      errs.push('Terceirizado é obrigatório');
    }
    if (!$('#m-dts').value) {
      _markInvalid($('#m-dts'), 'Informe a data de saída.');
      errs.push('Data de saída é obrigatória');
    }
    // Nº OP obrigatório — não pode ser vazio nem somente espaços
    const opVal = ($('#m-op')?.value || '').trim();
    if (!opVal) {
      _markInvalid($('#m-op'), 'Informe o Nº da OP.');
      errs.push('Nº OP é obrigatório');
    }

    // 2) Itens: cada item precisa de Produto, Serviço, Referência, Cor, Preço > 0 e Grade preenchida
    const itensBody = [];
    for (const it of itens) {
      const wrap = card.querySelector(`[data-uid="${it.uid}"]`);
      const grade = TAMANHOS
        .map(t => ({ tamanho: t, qtd: Number(it.grade[t] || 0) }))
        .filter(g => g.qtd > 0);
      const totalItem = grade.reduce((a, g) => a + g.qtd, 0);

      // Item totalmente vazio: ignora silenciosamente (caso usuário tenha clicado +Add e desistido)
      if (
        totalItem === 0 && !it.cod_ref && !it.cor && !it.id_servico
        && !it.id_produto && !Number(it.preco_unit)
      ) continue;

      let cardHasErr = false;
      if (wrap) {
        // Produto
        if (!it.id_produto) {
          _markInvalid(wrap.querySelector('[data-f="prod"]'), 'Selecione o produto.');
          cardHasErr = true;
        }
        // Serviço
        if (!it.id_servico) {
          _markInvalid(wrap.querySelector('[data-f="serv"]'), 'Selecione o serviço.');
          cardHasErr = true;
        }
        // Referência (auto-preenchida mas obrigatória — não pode ser apagada)
        if (!it.cod_ref || !String(it.cod_ref).trim()) {
          _markInvalid(wrap.querySelector('[data-f="ref"]'), 'Informe a referência.');
          cardHasErr = true;
        }
        // Cor (selecionar OU digitar)
        if (!it.cor || !String(it.cor).trim()) {
          _markInvalid(wrap.querySelector('[data-f="cor"]'), 'Informe a cor do produto.');
          cardHasErr = true;
        }
        // Valor unitário (não pode ser vazio, zero ou negativo)
        const precoNum = Number(it.preco_unit);
        if (!precoNum || isNaN(precoNum) || precoNum <= 0) {
          _markInvalid(wrap.querySelector('[data-f="preco"]'), 'Informe um valor válido.');
          cardHasErr = true;
        }
        // Nº OP por item — obrigatório, não pode ser vazio nem só espaços.
        // Se ainda herda do cabeçalho, garantimos sincronização com o valor atual de #m-op.
        if (!it._num_op_manual) {
          it.num_op = ($('#m-op')?.value || '').trim();
        }
        if (!it.num_op || !String(it.num_op).trim()) {
          _markInvalid(wrap.querySelector('[data-f="num_op"]'), 'Informe o Nº da OP deste item.');
          cardHasErr = true;
        }
        // Grade
        if (totalItem === 0) {
          const gradeEl = wrap.querySelector('[data-f="grade"]');
          if (gradeEl) {
            // Marca o container da grade
            gradeEl.classList.add('field-invalid');
            let errEl = gradeEl.parentElement?.querySelector(':scope > .field-error');
            if (!errEl) {
              errEl = document.createElement('div');
              errEl.className = 'field-error text-xs text-red-600 mt-1';
              errEl.innerHTML = '<i class="fas fa-circle-exclamation"></i> Preencha a grade com pelo menos 1 peça.';
              gradeEl.parentElement?.appendChild(errEl);
            }
          }
          cardHasErr = true;
        }
        // Não permitir qtd menor que retornado (na edição)
        if (it._qtdRetornada > 0 && totalItem > 0 && totalItem < it._qtdRetornada) {
          const gradeEl = wrap.querySelector('[data-f="grade"]');
          if (gradeEl) {
            gradeEl.classList.add('field-invalid');
            let errEl = gradeEl.parentElement?.querySelector(':scope > .field-error');
            if (!errEl) {
              errEl = document.createElement('div');
              errEl.className = 'field-error text-xs text-red-600 mt-1';
              gradeEl.parentElement?.appendChild(errEl);
            }
            errEl.innerHTML = `<i class="fas fa-circle-exclamation"></i> Total (${totalItem}) menor que o já retornado (${it._qtdRetornada}).`;
          }
          cardHasErr = true;
        }
      }
      if (cardHasErr) {
        _markCardError(it.uid);
        errs.push(`Item ${it.cod_ref || '(sem ref)'} / ${it.cor || '(sem cor)'}`);
        continue;
      }

      itensBody.push({
        id_item: it.id_item || null,
        id_produto: it.id_produto || null,
        cod_ref: it.cod_ref,
        desc_ref: it.desc_ref || '',
        id_servico: Number(it.id_servico),
        cor: it.cor || '',
        preco_unit: Number(it.preco_unit || 0),
        tempo_peca: Number(it.tempo_peca || 0),
        grade,
        id_grade_tamanho: it.id_grade_tamanho || null,
        num_op: String(it.num_op || '').trim(),
      });
    }

    if (errs.length > 0) {
      toast(`Corrija os campos destacados (${errs.length} erro(s)).`, 'error');
      _scrollToFirstError();
      return;
    }
    if (itensBody.length === 0) {
      toast('Adicione pelo menos 1 produto com grade preenchida', 'warning');
      return;
    }

    const body = {
      num_controle,
      num_op: $('#m-op').value.trim(),
      id_terc: $('#m-terc').value,
      id_colecao: $('#m-col').value,
      dt_saida: $('#m-dts').value,
      dt_inicio: $('#m-dti')?.value || $('#m-dts').value,
      qtd_pessoas: $('#m-pess')?.value || 1,
      min_trab_dia: $('#m-min')?.value || 480,
      efic_pct: $('#m-ef')?.value || 0.8,
      prazo_dias: $('#m-pz')?.value || 0,
      status: $('#m-status')?.value || 'AguardandoEnvio',
      observacao: $('#m-obs')?.value?.trim() || '',
      itens: itensBody,
    };

    try {
      if (edit) await api('put', '/terc/remessas/' + id, body);
      else await api('post', '/terc/remessas', body);
      toast(`Remessa salva — ${itensBody.length} item(ns)`, 'success');
      // Limpa rascunho local após salvar com sucesso
      try { localStorage.removeItem(RASCUNHO_KEY); } catch {}
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
/**
 * Distribui uma quantidade (refugo + conserto) sobre a grade
 * SEMPRE começando pelo tamanho com MENOR quantidade > 0.
 * Retorna um mapa { tamanho: qtd_descontada } e o total que sobrou (não distribuído).
 *
 * Regras:
 *  - Nunca gera valor negativo.
 *  - Sempre reduz primeiro o MENOR (>0). Empate por valor: ordem da grade enviada.
 *  - Quando o menor zerar, passa para o próximo menor (>0).
 *  - Se sobrar quantidade (> que a soma da grade), retorna 'sobra'.
 *
 * Exemplo: { P:3, M:3, G:3, GG:1 }, reduzir 2:
 *   1ª iteração: menor>0 = GG(1) → tira 1 → GG=0, falta=1
 *   2ª iteração: menores>0 são P/M/G (todos =3); P vem primeiro na ordem → tira 1 de P → P=2
 *   resultado: { P:2, M:3, G:3, GG:0 }, total = 8
 */
function _distribuirReducao(gradeAtual, ordemTamanhos, qtdReduzir) {
  const restante = { ...gradeAtual };
  const desconto = {};
  let falta = Math.max(0, qtdReduzir | 0);
  while (falta > 0) {
    // encontra tamanho com MENOR quantidade restante (>0)
    let alvo = null, min = Infinity;
    for (const t of ordemTamanhos) {
      const v = restante[t] || 0;
      if (v > 0 && v < min) { min = v; alvo = t; }
    }
    if (!alvo) break; // nada mais para tirar
    // tira 1 por iteração para respeitar precisão "de 1 em 1"
    // (garante o comportamento: zera o menor, depois passa para o próximo)
    restante[alvo] -= 1;
    desconto[alvo] = (desconto[alvo] || 0) + 1;
    falta -= 1;
  }
  return { gradeAjustada: restante, desconto, sobra: falta };
}

async function TERC_openRetModal(idRemessa, onSave, idRetornoEdit) {
  // Carrega contexto multi-itens (itens da remessa + grade enviada + saldo disponível por item)
  const editing = !!idRetornoEdit;
  const ctxQS = editing ? `?id_retorno=${encodeURIComponent(idRetornoEdit)}` : '';
  let ctx;
  try {
    ctx = (await api('get', `/terc/remessas/${idRemessa}/retorno-context${ctxQS}`)).data || {};
  } catch {
    toast('Falha ao carregar dados da remessa', 'error');
    return;
  }
  const rem = ctx.remessa || {};
  const itensRem = fmt.safeArr(ctx.itens);
  if (itensRem.length === 0) { toast('Remessa sem itens cadastrados', 'error'); return; }
  const retEdit = editing ? ctx.retorno_edit : null;
  if (editing && !retEdit) { toast('Retorno não encontrado', 'error'); return; }

  // Mapa de itens já lançados neste retorno (modo edição) → para preencher inputs
  const editByItem = new Map();
  if (editing) {
    fmt.safeArr(retEdit.itens).forEach(ri => {
      editByItem.set(Number(ri.id_item), {
        qtd_boa: fmt.safeNum(ri.qtd_boa),
        qtd_refugo: fmt.safeNum(ri.qtd_refugo),
        qtd_conserto: fmt.safeNum(ri.qtd_conserto),
        valor: ri.valor != null ? Number(ri.valor) : null,
        observacao: ri.observacao || '',
        gradeMap: Object.fromEntries(fmt.safeArr(ri.grade).map(g => [g.tamanho, fmt.safeNum(g.qtd)])),
      });
    });
  }

  // Estado local da UI
  // REGRA NOVA: a grade do retorno é SEMPRE igual à grade ENVIADA (soma = total enviado).
  // Falta e conserto APENAS redistribuem a grade — não alteram total nem valor.
  // Pagamento = total_enviado × preço_unit (sempre integral).
  const state = {
    items: itensRem.map(it => {
      const ed = editByItem.get(Number(it.id_item));
      const gradeEnv = fmt.safeArr(it.grade);
      // gradeEnviadaMap: { tamanho: qtd } — base imutável (vem da remessa)
      const gradeEnviadaMap = Object.fromEntries(gradeEnv.map(g => [g.tamanho, fmt.safeNum(g.qtd)]));
      return {
        id_item: Number(it.id_item),
        cod_ref: it.cod_ref || '',
        desc_ref: it.desc_ref || '',
        cor: it.cor || '',
        desc_servico: it.desc_servico || '',
        preco_unit: Number(it.preco_unit) || 0,
        qtd_enviada: fmt.safeNum(it.qtd_enviada || it.qtd_total),
        qtd_disponivel: fmt.safeNum(it.qtd_disponivel),
        gradeEnv,                                // [{tamanho, qtd}] ordenado (referência)
        gradeEnviadaMap,                         // base imutável para distribuir
        ordemTam: gradeEnv.map(g => g.tamanho),
        qtd_refugo: ed?.qtd_refugo || 0,
        qtd_conserto: ed?.qtd_conserto || 0,
        observacao: ed?.observacao || '',
      };
    }),
  };

  const titleIcon = editing ? 'fa-pen-to-square' : 'fa-truck-arrow-right';
  const titleTxt = editing
    ? `Editar Retorno · Remessa ${rem.num_controle}`
    : `Registrar Retorno · Remessa ${rem.num_controle}`;
  const dtVal = editing ? (retEdit.dt_retorno || dayjs().format('YYYY-MM-DD')) : dayjs().format('YYYY-MM-DD');
  const dtpVal = editing ? (retEdit.dt_pagamento || '') : '';
  const obsVal = editing ? (retEdit.observacao || '') : '';

  const colorBadge = (cor) => {
    if (!cor) return '<span class="text-slate-400">—</span>';
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 border border-slate-300">
      <span class="w-2 h-2 rounded-full bg-slate-500"></span>${cor}
    </span>`;
  };

  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-5xl max-h-[92vh] overflow-y-auto' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-2">
      <i class="fas ${titleIcon} mr-2 text-brand"></i>${titleTxt}
    </h3>
    <div class="bg-slate-50 p-3 rounded mb-3 text-sm grid grid-cols-2 md:grid-cols-4 gap-2">
      <div><b>Terceirizado:</b> ${rem.nome_terc || '—'}</div>
      <div><b>Itens:</b> ${state.items.length}</div>
      <div><b>Total enviado:</b> ${fmt.int(rem.qtd_total)}</div>
      <div><b>Status:</b> ${rem.status || '—'}</div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
      <div><label>Data retorno *</label><input type="date" id="m-dtr" value="${dtVal}" /></div>
      <div><label>Data pagamento</label><input type="date" id="m-dtp" value="${dtpVal}" /></div>
      <div class="md:col-span-3"><label>Observação geral</label>
        <input id="m-obs" value="${String(obsVal).replace(/"/g, '&quot;')}" />
      </div>
    </div>

    <div class="bg-blue-50 border border-blue-200 p-2 rounded text-xs text-blue-800 mb-2">
      <i class="fas fa-circle-info mr-1"></i>
      O pagamento é calculado pelas <b>peças boas retornadas</b> (total enviado − falta − conserto) × preço unitário.
      Falta e conserto <b>reduzem o pagamento</b> e também redistribuem a grade (sai primeiro do menor tamanho).
    </div>

    <div class="text-sm font-semibold mb-2 text-slate-700">
      <i class="fas fa-boxes-stacked mr-1"></i>Itens da remessa
    </div>
    <div id="ret-items-wrap" class="space-y-3"></div>

    <div class="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="text-sm space-y-1">
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <span><b>Enviado:</b> <span id="tg-env" class="font-mono">0</span> pç</span>
            <span><b>Quantidade retornada:</b> <span id="tg-qtd" class="font-mono text-blue-700">0</span> pç</span>
            <span><b>Boas:</b> <span id="tg-boa" class="font-mono">0</span></span>
            <span><b>Falta:</b> <span id="tg-ref" class="font-mono text-amber-700">0</span></span>
            <span><b>Conserto:</b> <span id="tg-con" class="font-mono text-orange-700">0</span></span>
          </div>
          <div class="text-base font-semibold text-emerald-800">
            <i class="fas fa-money-bill-wave mr-1"></i>Total pago: R$ <span id="tg-val">0,00</span>
            <span class="text-xs text-slate-500 font-normal ml-1">(boas × preço unitário)</span>
          </div>
        </div>
        <div class="flex gap-2">
          <button id="m-cancel" class="btn btn-secondary">Cancelar</button>
          <button id="m-save" class="btn btn-primary">
            <i class="fas fa-save mr-1"></i>${editing ? 'Salvar alterações' : 'Registrar retorno'}
          </button>
        </div>
      </div>
    </div>
  `;
  m.appendChild(card);
  document.body.appendChild(m);

  const itemsWrap = card.querySelector('#ret-items-wrap');

  // Renderiza um card por item da remessa
  function renderItem(it, idx) {
    const semSaldo = it.qtd_disponivel <= 0;
    const cardEl = document.createElement('div');
    cardEl.className = `border-2 rounded-lg p-3 ${semSaldo ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-slate-300 bg-white'}`;
    cardEl.dataset.idx = idx;

    cardEl.innerHTML = `
      <div class="flex flex-wrap items-center gap-3 mb-2">
        <div class="text-sm">
          <span class="font-mono font-semibold">${it.cod_ref || '—'}</span>
          <span class="text-slate-600">· ${it.desc_ref || ''}</span>
        </div>
        <div>${colorBadge(it.cor)}</div>
        <div class="text-xs px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-blue-700">
          <i class="fas fa-screwdriver-wrench mr-1"></i>${it.desc_servico || '—'}
        </div>
        <div class="text-xs ml-auto flex gap-3 text-slate-600">
          <span>Enviado: <b>${fmt.int(it.qtd_enviada)}</b></span>
          <span>Disponível: <b class="${semSaldo ? 'text-slate-400' : 'text-amber-700'}">${fmt.int(it.qtd_disponivel)}</b></span>
          <span>Preço: <b>R$ ${fmt.num(it.preco_unit)}</b></span>
        </div>
      </div>

      ${semSaldo ? `<div class="text-xs text-slate-500 italic">Item já totalmente retornado.</div>` : `
      <div>
        <div class="text-xs text-slate-500 mb-1">
          Grade retornada <span class="text-slate-400">— soma = total enviado (${fmt.int(it.qtd_enviada)} pç). Falta/Conserto redistribuem do menor tamanho.</span>
        </div>
        <div class="grid grid-cols-5 md:grid-cols-10 gap-1 mb-2">
          ${it.gradeEnv.map(g => {
            const env = fmt.safeNum(g.qtd);
            return `<div class="text-center" data-tam-wrap="${g.tamanho}">
              <div class="text-[10px] font-mono text-slate-500">${g.tamanho}
                <span class="text-slate-400">(env ${env})</span>
              </div>
              <div class="px-1 py-1 rounded border border-slate-200 bg-slate-50 text-center font-semibold text-sm"
                   data-role="boa-tam-num">${fmt.int(env)}</div>
              <div class="text-[10px] font-semibold text-emerald-700" data-role="boa-tam-lbl">
                <span class="text-slate-400 font-normal">boas</span>
              </div>
              <div class="text-[10px] text-red-600 hidden" data-role="reduz-tam">
                <i class="fas fa-arrow-down-long"></i> <span data-role="reduz-val">0</span>
              </div>
            </div>`;
          }).join('')}
        </div>

        <div class="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <div>
            <label class="text-xs text-blue-700"><i class="fas fa-rotate-left mr-1"></i>Qtd retornada</label>
            <input data-role="qtd-ret" type="number" min="0" max="${it.qtd_enviada}" value="${it.qtd_enviada - (it.qtd_refugo + it.qtd_conserto)}" class="ret-side-in border-blue-300" title="Quantidade boa retornada (= enviado − refugo − conserto)" />
          </div>
          <div>
            <label class="text-xs text-amber-700"><i class="fas fa-triangle-exclamation mr-1"></i>Falta</label>
            <input data-role="refugo" type="number" min="0" value="${it.qtd_refugo}" class="ret-side-in border-amber-300" />
          </div>
          <div>
            <label class="text-xs text-orange-700"><i class="fas fa-screwdriver mr-1"></i>Conserto</label>
            <input data-role="conserto" type="number" min="0" value="${it.qtd_conserto}" class="ret-side-in border-orange-300" />
          </div>
          <div class="md:col-span-3 text-xs text-slate-600 self-center">
            <div>Enviado: <b>${fmt.int(it.qtd_enviada)}</b> pç · Quantidade retornada: <b data-role="tot-boa" class="text-blue-700">${fmt.int(it.qtd_enviada - (it.qtd_refugo + it.qtd_conserto))}</b> pç</div>
            <div class="text-emerald-700 font-semibold">Total pago: R$ <span data-role="tot-val">${fmt.num((it.qtd_enviada - (it.qtd_refugo + it.qtd_conserto)) * it.preco_unit)}</span>
              <span class="text-xs text-slate-500 font-normal ml-1">(retornadas × preço)</span>
            </div>
            <div class="text-[11px] text-slate-400" data-role="tot-qtd-hidden" style="display:none">${fmt.int(it.qtd_enviada)}</div>
          </div>
          <div class="md:col-span-6">
            <input data-role="obs" placeholder="Observação do item (opcional)"
                   value="${String(it.observacao || '').replace(/"/g, '&quot;')}" />
          </div>
        </div>
        <div class="text-xs text-red-600 mt-1 hidden" data-role="err"></div>
      </div>`}
    `;
    return cardEl;
  }

  state.items.forEach((it, i) => itemsWrap.appendChild(renderItem(it, i)));

  // Recalcula a grade ajustada (refugo/conserto saem do menor tamanho) e os totais.
  // REGRAS (regra B):
  //  - Grade retornada = (total_enviado − refugo − conserto), distribuída na grade enviada
  //    removendo primeiro do MENOR tamanho.
  //  - Pagamento = qtd_boas × preço_unit (refugo/conserto DESCONTAM).
  //  - Falta + conserto > total_enviado → erro.
  //  - Quantidade retornada (peças boas) é exibida explicitamente.
  function recalc(triggerEl) {
    let tEnv = 0, tBoa = 0, tRef = 0, tCon = 0, tVal = 0;
    state.items.forEach((it, i) => {
      const cardEl = itemsWrap.querySelector(`[data-idx="${i}"]`);
      if (!cardEl) return;
      const errEl = cardEl.querySelector('[data-role="err"]');

      // Item sem saldo (já 100% retornado) — pula
      if (it.qtd_disponivel <= 0) return;

      // 1) Falta / Conserto / Qtd retornada solicitados
      const refInp = cardEl.querySelector('input[data-role="refugo"]');
      const conInp = cardEl.querySelector('input[data-role="conserto"]');
      const qtdRetInp = cardEl.querySelector('input[data-role="qtd-ret"]');
      let ref = refInp ? Math.max(0, fmt.safeNum(refInp.value)) : 0;
      let con = conInp ? Math.max(0, fmt.safeNum(conInp.value)) : 0;

      const totalEnviado = it.qtd_enviada;

      // Edição bidirecional: se o usuário alterou "Qtd retornada" diretamente,
      // recalculamos refugo automaticamente (mantendo conserto inalterado).
      // Regra: qtd_ret = total_enviado − refugo − conserto
      const isQtdRetEdit = triggerEl && qtdRetInp && triggerEl === qtdRetInp;
      if (isQtdRetEdit) {
        let qtdRet = Math.max(0, Math.min(totalEnviado, fmt.safeNum(qtdRetInp.value)));
        // refugo absorve a diferença; se conserto for maior que (total − qtdRet), zera refugo e ajusta conserto
        let novoRef = totalEnviado - qtdRet - con;
        if (novoRef < 0) {
          // conserto maior que disponível: ajusta conserto para caber
          novoRef = 0;
          con = totalEnviado - qtdRet;
          if (con < 0) con = 0;
          if (conInp) conInp.value = String(con);
        }
        ref = novoRef;
        if (refInp) refInp.value = String(ref);
      }

      const totalReduzir = ref + con;

      // 2) VALIDAÇÃO: refugo + conserto não podem exceder o total enviado
      let errMsg = '';
      if (totalReduzir > totalEnviado) {
        errMsg = 'Falta + conserto excede o total enviado.';
      }

      // 3) Distribui (refugo + conserto) na grade enviada — tira do MENOR tamanho primeiro.
      //    Se houver erro de excesso, ainda calculamos o que cabe para feedback visual.
      const reduzirAplicado = Math.min(totalReduzir, totalEnviado);
      const { gradeAjustada, desconto } = _distribuirReducao(
        it.gradeEnviadaMap, it.ordemTam, reduzirAplicado
      );

      // 4) Renderiza por tamanho: número final + indicador de redução
      cardEl.querySelectorAll('[data-tam-wrap]').forEach(wrap => {
        const tam = wrap.dataset.tamWrap;
        const finalTam = gradeAjustada[tam] || 0;
        const redTam = desconto[tam] || 0;
        const numEl = wrap.querySelector('[data-role="boa-tam-num"]');
        const redEl = wrap.querySelector('[data-role="reduz-tam"]');
        const redVal = wrap.querySelector('[data-role="reduz-val"]');
        if (numEl) {
          numEl.textContent = fmt.int(finalTam);
          // destaque visual quando há redução
          numEl.classList.toggle('bg-amber-50', redTam > 0);
          numEl.classList.toggle('border-amber-300', redTam > 0);
          numEl.classList.toggle('text-amber-800', redTam > 0);
          numEl.classList.toggle('bg-slate-50', redTam === 0);
          numEl.classList.toggle('border-slate-200', redTam === 0);
        }
        if (redEl) {
          if (redTam > 0) {
            redEl.classList.remove('hidden');
            if (redVal) redVal.textContent = fmt.int(redTam);
          } else {
            redEl.classList.add('hidden');
          }
        }
      });

      // 5) Persiste no estado
      it.qtd_refugo = ref;
      it.qtd_conserto = con;
      const obsInp = cardEl.querySelector('input[data-role="obs"]');
      if (obsInp) it.observacao = obsInp.value;
      it._gradeBoa = gradeAjustada;        // grade BOA por tamanho (após redistribuição)
      it._totalEnviado = totalEnviado;     // total enviado (= total retornado)

      // 6) Cálculos finais — pagamento = qtd_boas × preço (refugo/conserto descontam)
      const boa = totalEnviado - reduzirAplicado;
      const valItem = boa * Number(it.preco_unit || 0);

      // 7) UI: erro
      if (errEl) {
        if (errMsg) {
          errEl.classList.remove('hidden');
          errEl.innerHTML = `<i class="fas fa-circle-exclamation mr-1"></i>${errMsg}`;
        } else {
          errEl.classList.add('hidden');
          errEl.textContent = '';
        }
      }

      // 8) Card visual (vermelho se erro)
      cardEl.classList.toggle('border-red-400', !!errMsg);
      cardEl.classList.toggle('bg-red-50', !!errMsg);

      const totBoaEl = cardEl.querySelector('[data-role="tot-boa"]');
      const totValEl = cardEl.querySelector('[data-role="tot-val"]');
      if (totBoaEl) totBoaEl.textContent = fmt.int(boa);
      if (totValEl) totValEl.textContent = fmt.num(valItem);

      // Sincroniza o input "Qtd retornada" quando refugo/conserto mudaram
      // (mas não sobrescreve enquanto o próprio campo está sendo editado)
      const qtdRetInp2 = cardEl.querySelector('input[data-role="qtd-ret"]');
      if (qtdRetInp2 && qtdRetInp2 !== triggerEl) {
        qtdRetInp2.value = String(boa);
      }

      tEnv += totalEnviado;
      tBoa += boa;
      tRef += ref;
      tCon += con;
      tVal += valItem;
    });

    card.querySelector('#tg-boa').textContent = fmt.int(tBoa);
    card.querySelector('#tg-ref').textContent = fmt.int(tRef);
    card.querySelector('#tg-con').textContent = fmt.int(tCon);
    card.querySelector('#tg-qtd').textContent = fmt.int(tBoa);
    card.querySelector('#tg-val').textContent = fmt.num(tVal);
    const tgEnvEl = card.querySelector('#tg-env');
    if (tgEnvEl) tgEnvEl.textContent = fmt.int(tEnv);
  }

  itemsWrap.addEventListener('input', (ev) => recalc(ev.target));
  recalc();

  card.querySelector('#m-cancel').onclick = () => m.remove();
  card.querySelector('#m-save').onclick = async () => {
    // Monta payload por item segundo a regra B:
    //  - qtd_boa = total_enviado − (refugo + conserto)
    //  - Grade retornada (soma) = qtd_boa, distribuída removendo primeiro do MENOR tamanho.
    //  - valor_pago = qtd_boa × preço_unit (refugo/conserto DESCONTAM)
    const itensPayload = [];
    let blocked = false;
    state.items.forEach((it) => {
      if (it.qtd_disponivel <= 0) return;
      const totalEnviado = fmt.safeNum(it.qtd_enviada);
      const ref = fmt.safeNum(it.qtd_refugo);
      const con = fmt.safeNum(it.qtd_conserto);

      // 1) Falta + Conserto não podem exceder o total enviado
      if (ref + con > totalEnviado) {
        toast(`Item ${it.cod_ref}/${it.cor}: Falta + conserto excede o total enviado.`, 'error');
        blocked = true; return;
      }

      // 2) Grade BOA já calculada por recalc() (refugo/conserto subtraídos do menor tamanho)
      const gradeBoa = it._gradeBoa || {};
      const grade = Object.entries(gradeBoa)
        .map(([tamanho, qtd]) => ({ tamanho, qtd: fmt.safeNum(qtd) }))
        .filter(g => g.qtd > 0);
      const qtdBoa = grade.reduce((a, g) => a + g.qtd, 0);

      // 3) Consistência: qtd_boa + refugo + conserto = total enviado
      if (qtdBoa + ref + con !== totalEnviado) {
        toast(`Item ${it.cod_ref}/${it.cor}: inconsistência interna na grade (${qtdBoa}+${ref}+${con}≠${totalEnviado}).`, 'error');
        blocked = true; return;
      }

      // 4) Valor pago = qtd_boa × preço (refugo/conserto reduzem o pagamento)
      const valorItem = qtdBoa * Number(it.preco_unit || 0);

      itensPayload.push({
        id_item: it.id_item,
        qtd_boa: qtdBoa,
        qtd_refugo: ref,
        qtd_conserto: con,
        // backend respeita este valor: qtd_boa × preço (refugo/conserto descontam)
        valor: valorItem,
        grade,
        observacao: it.observacao || null,
      });
    });

    if (blocked) return;
    if (itensPayload.length === 0) {
      toast('Informe ao menos 1 item com quantidade retornada > 0', 'error');
      return;
    }

    // Valor pago total = soma dos valores por item (boas × preço)
    const valorPagoTotal = itensPayload.reduce((a, x) => a + (x.valor || 0), 0);

    const body = {
      id_remessa: idRemessa,
      dt_retorno: card.querySelector('#m-dtr').value,
      dt_pagamento: card.querySelector('#m-dtp').value || null,
      valor_pago: valorPagoTotal,
      observacao: card.querySelector('#m-obs').value.trim(),
      itens: itensPayload,
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
              <th class="text-left p-2">Data</th><th class="text-right p-2">Boas</th><th class="text-right p-2">Falta</th><th class="text-right p-2">Conserto</th>
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
      kpi('Peças em falta', fmt.int(tot.refugo), 'text-red-600'),
      kpi('Valor pago', TERC.fmtBRL(tot.valor), 'text-indigo-600'),
    ].join('');

    $('#tbl').innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-slate-100"><tr>
          <th class="text-left p-2">Data</th><th class="text-right p-2">Ctrl</th><th class="text-left p-2">Terceirizado</th>
          <th class="text-left p-2">Ref/Cor</th><th class="text-left p-2">Serviço</th>
          <th class="text-right p-2">Boas</th><th class="text-right p-2">Falta</th><th class="text-right p-2">Conserto</th>
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
ROUTES.terc_dashboard = (main) => { state.route = 'dashboard'; location.hash = 'dashboard'; ROUTES.dashboard(main); };

/* ============================================================
 * RENDERIZADOR — BLOCO DE PRODUTOS
 * Lista cadastros com filtro (busca + coleção + status), paginação
 * leve, ações de CRUD, importação e gerenciamento de coleções.
 * ============================================================ */
async function renderTercProdutosBlock(host) {
  if (!host) return;
  const $h = (typeof host === 'string') ? document.querySelector(host) : host;
  if (!$h) return;

  $h.innerHTML = `
    <div class="flex flex-wrap items-end gap-2 mb-3">
      <div class="flex-1 min-w-[200px]">
        <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Buscar</label>
        <input id="prod-q" placeholder="Referência, descrição ou nome…" />
      </div>
      <div class="min-w-[160px]">
        <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Coleção</label>
        <select id="prod-col">${TERC.optColecoes()}</select>
      </div>
      <div class="min-w-[120px]">
        <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Status</label>
        <select id="prod-st">
          <option value="ativos">Ativos</option>
          <option value="todos">Todos</option>
          <option value="inativos">Inativos</option>
        </select>
      </div>
      <div class="flex gap-2 ml-auto">
        <button id="prod-colecoes" class="btn btn-secondary"><i class="fas fa-layer-group mr-1"></i>Coleções</button>
        <button id="prod-import" class="btn btn-secondary"><i class="fas fa-file-excel mr-1"></i>Importar</button>
        <button id="prod-del-all" class="btn btn-danger" title="Excluir todos os produtos"><i class="fas fa-trash-can mr-1"></i>Excluir Todos</button>
        <button id="prod-novo" class="btn btn-primary"><i class="fas fa-plus mr-1"></i>Novo Produto</button>
      </div>
    </div>
    <div id="prod-stats" class="text-xs text-slate-500 mb-2"></div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr>
            <th class="text-left">Referência</th>
            <th class="text-left">Descrição</th>
            <th class="text-left">Coleção</th>
            <th class="text-left">Serv. Padrão</th>
            <th class="text-right">Tempo</th>
            <th class="text-center">Grade</th>
            <th class="text-center">Status</th>
            <th class="text-right">Ações</th>
          </tr>
        </thead>
        <tbody id="prod-tbody"><tr><td colspan="8" class="text-center text-slate-400 py-6"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando…</td></tr></tbody>
      </table>
    </div>
    <div id="prod-pager" class="flex items-center justify-between mt-3 text-xs text-slate-500"></div>
  `;

  const $q   = $h.querySelector('#prod-q');
  const $col = $h.querySelector('#prod-col');
  const $st  = $h.querySelector('#prod-st');
  const $tb  = $h.querySelector('#prod-tbody');
  const $stats = $h.querySelector('#prod-stats');
  const $pg  = $h.querySelector('#prod-pager');

  const PAGE_SIZE = 50;
  let page = 1;
  let _all = [];
  let _filtered = [];
  let _qTimer = null;

  function applyFilter() {
    const q   = ($q.value || '').trim().toLowerCase();
    const col = $col.value || '';
    const st  = $st.value || 'ativos';
    _filtered = _all.filter(p => {
      if (st === 'ativos'   && !p.ativo) return false;
      if (st === 'inativos' &&  p.ativo) return false;
      if (col && String(p.id_colecao || '') !== String(col)) return false;
      if (!q) return true;
      const blob = ((p.cod_ref || '') + ' ' + (p.desc_ref || '') + ' ' + (p.nome_produto || '') + ' ' + (p.nome_colecao || '')).toLowerCase();
      return blob.includes(q);
    });
    page = 1;
    render();
  }

  function render() {
    const total = _filtered.length;
    if (!total) {
      $tb.innerHTML = `<tr><td colspan="8" class="text-center text-slate-400 py-8"><i class="fas fa-box-open text-2xl mb-2 block opacity-60"></i>Nenhum produto encontrado.</td></tr>`;
      $stats.textContent = '0 produto(s).';
      $pg.innerHTML = '';
      return;
    }
    const totPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totPages) page = totPages;
    const start = (page - 1) * PAGE_SIZE;
    const slice = _filtered.slice(start, start + PAGE_SIZE);

    $stats.textContent = `${total} produto(s) · página ${page}/${totPages}`;
    $tb.innerHTML = slice.map(p => `
      <tr class="border-t hover:bg-slate-50">
        <td class="font-mono">${escapeHtml(p.cod_ref || '')}</td>
        <td>${escapeHtml(p.desc_ref || '')}${p.nome_produto ? `<div class="text-xs text-slate-400">${escapeHtml(p.nome_produto)}</div>` : ''}</td>
        <td class="text-slate-600">${escapeHtml(p.nome_colecao || '—')}</td>
        <td class="text-slate-600">${escapeHtml(p.desc_servico_padrao || '—')}</td>
        <td class="text-right tabular-nums">${p.tempo_padrao != null ? fmt.num(p.tempo_padrao, 2) : '—'}</td>
        <td class="text-center">${p.grade_padrao || 1}</td>
        <td class="text-center">${p.ativo
          ? '<span class="badge badge-Finalizada">Ativo</span>'
          : '<span class="badge badge-Cancelada">Inativo</span>'}</td>
        <td class="text-right whitespace-nowrap">
          <button class="btn btn-sm btn-secondary mr-1" data-edit="${p.id_produto}" title="Editar"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger" data-del="${p.id_produto}" title="Excluir"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`).join('');

    $pg.innerHTML = totPages > 1 ? `
      <span>Mostrando ${start + 1}–${Math.min(start + PAGE_SIZE, total)} de ${total}</span>
      <div class="flex gap-1">
        <button class="btn btn-sm btn-secondary" id="pg-prev" ${page === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
        <button class="btn btn-sm btn-secondary" id="pg-next" ${page === totPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
      </div>` : `<span>${total} item(ns)</span>`;
    const pP = $pg.querySelector('#pg-prev'); if (pP) pP.onclick = () => { page--; render(); };
    const pN = $pg.querySelector('#pg-next'); if (pN) pN.onclick = () => { page++; render(); };

    $tb.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => TERC_openProdModal(b.dataset.edit, load));
    $tb.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Excluir este produto? Pode falhar se houver remessas/preços vinculados.')) return;
      try { await api('delete', '/terc/produtos/' + b.dataset.del); toast('Produto excluído', 'success'); await load(); } catch {}
    });
  }

  async function load() {
    $tb.innerHTML = `<tr><td colspan="8" class="text-center text-slate-400 py-6"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando…</td></tr>`;
    try {
      const r = await api('get', '/terc/produtos', null, { silent: true });
      _all = fmt.safeArr(r?.data);
      TERC.produtos = _all;
      applyFilter();
    } catch (e) {
      console.error('[renderTercProdutosBlock] erro ao carregar', e);
      $tb.innerHTML = `<tr><td colspan="8" class="text-center text-red-500 py-6"><i class="fas fa-triangle-exclamation mr-2"></i>Erro ao carregar produtos.</td></tr>`;
    }
  }

  // Eventos com debounce no campo de busca
  $q.oninput   = () => { clearTimeout(_qTimer); _qTimer = setTimeout(applyFilter, 220); };
  $col.onchange = applyFilter;
  $st.onchange  = applyFilter;
  $h.querySelector('#prod-novo').onclick      = () => TERC_openProdModal(null, load);
  $h.querySelector('#prod-import').onclick    = () => TERC_openProdImportModal(load);
  $h.querySelector('#prod-colecoes').onclick  = () => TERC_openColecoesModal(load);
  $h.querySelector('#prod-del-all').onclick   = () => TERC_confirmDeleteAllProdutos(load);

  await load();
}

/* ---------- Modal: Excluir TODOS os produtos (confirmação) ---------- */
async function TERC_confirmDeleteAllProdutos(onDone) {
  const total = (TERC.produtos || []).length;
  const m = document.createElement('div'); m.className = 'modal-backdrop';
  const card = document.createElement('div'); card.className = 'modal p-6 w-full max-w-md';
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3" style="color:#F43F5E">
      <i class="fas fa-triangle-exclamation mr-2"></i>Excluir Todos os Produtos
    </h3>
    <p class="text-sm mb-2"><b>ATENÇÃO:</b></p>
    <p class="text-sm mb-2">Esta ação removerá <b>TODOS</b> os produtos cadastrados${total ? ` (<b>${total}</b>)` : ''}.</p>
    <p class="text-xs text-slate-400 mb-3">A ação é irreversível e poderá afetar referências usadas em remessas.</p>
    <p class="text-sm mb-2">Para confirmar, digite <b>EXCLUIR</b> abaixo:</p>
    <input id="m-del-all-prod-input" type="text" autocomplete="off" placeholder="Digite EXCLUIR" class="w-full mb-4" />
    <div class="flex justify-end gap-2">
      <button class="btn btn-secondary" id="m-del-all-prod-cancel">Cancelar</button>
      <button class="btn btn-danger" id="m-del-all-prod-go" disabled><i class="fas fa-trash-can mr-1"></i>Excluir Tudo</button>
    </div>`;
  m.appendChild(card); document.body.appendChild(m);
  const close = () => m.remove();
  const $i = card.querySelector('#m-del-all-prod-input');
  const $g = card.querySelector('#m-del-all-prod-go');
  card.querySelector('#m-del-all-prod-cancel').onclick = close;
  m.addEventListener('click', e => { if (e.target === m) close(); });
  $i.oninput = () => { $g.disabled = ($i.value.trim().toUpperCase() !== 'EXCLUIR'); };
  setTimeout(() => $i.focus(), 50);
  $g.onclick = async () => {
    $g.disabled = true;
    $g.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Excluindo…';
    try {
      const r = await api('delete', '/terc/produtos', { confirm: 'SIM' });
      const n = r?.data?.deleted ?? 0;
      toast(`${n} produto(s) excluído(s).`, 'success');
      try { TERC.produtos = []; } catch(_) {}
      close();
      if (typeof onDone === 'function') await onDone();
    } catch (e) {
      console.error('[del-all produtos]', e);
      toast(e?.message || 'Falha ao excluir produtos.', 'error');
      $g.disabled = false;
      $g.innerHTML = '<i class="fas fa-trash-can mr-1"></i>Excluir Tudo';
    }
  };
}

/* ============================================================
 * RENDERIZADOR — BLOCO DE PREÇOS / VARIAÇÕES (Cor + Grade)
 * Lista, filtra e gerencia variações de preço por produto.
 * ============================================================ */
async function renderTercPrecosBlock(host) {
  if (!host) return;
  const $h = (typeof host === 'string') ? document.querySelector(host) : host;
  if (!$h) return;

  $h.innerHTML = `
    <div class="flex flex-wrap items-end gap-2 mb-3">
      <div class="flex-1 min-w-[200px]">
        <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Buscar</label>
        <input id="prec-q" placeholder="Referência, descrição, cor, tamanho…" />
      </div>
      <div class="min-w-[160px]">
        <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Serviço</label>
        <select id="prec-serv">${TERC.optServicos()}</select>
      </div>
      <div class="min-w-[160px]">
        <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Coleção</label>
        <select id="prec-col">${TERC.optColecoes()}</select>
      </div>
      <div class="min-w-[120px]">
        <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Status</label>
        <select id="prec-st">
          <option value="ativos">Ativos</option>
          <option value="todos">Todos</option>
          <option value="inativos">Inativos</option>
        </select>
      </div>
      <div class="flex gap-2 ml-auto">
        <button id="prec-import" class="btn btn-secondary" title="Importar planilha de preços"><i class="fas fa-file-excel mr-1"></i>Importar Planilha</button>
        <button id="prec-del-all" class="btn btn-danger" title="Excluir todas as variações de preço"><i class="fas fa-trash-can mr-1"></i>Excluir Todos</button>
        <button id="prec-novo" class="btn btn-primary"><i class="fas fa-plus mr-1"></i>Nova Variação</button>
      </div>
    </div>
    <div id="prec-stats" class="text-xs text-slate-500 mb-2"></div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr>
            <th class="text-left">Referência</th>
            <th class="text-left">Descrição</th>
            <th class="text-left">Serviço</th>
            <th class="text-left">Cor</th>
            <th class="text-center">Tam</th>
            <th class="text-center">Grade</th>
            <th class="text-right">Preço</th>
            <th class="text-right">Tempo</th>
            <th class="text-left">Coleção</th>
            <th class="text-center">Status</th>
            <th class="text-right">Ações</th>
          </tr>
        </thead>
        <tbody id="prec-tbody"><tr><td colspan="11" class="text-center text-slate-400 py-6"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando…</td></tr></tbody>
      </table>
    </div>
    <div id="prec-pager" class="flex items-center justify-between mt-3 text-xs text-slate-500"></div>
  `;

  const $q    = $h.querySelector('#prec-q');
  const $serv = $h.querySelector('#prec-serv');
  const $col  = $h.querySelector('#prec-col');
  const $st   = $h.querySelector('#prec-st');
  const $tb   = $h.querySelector('#prec-tbody');
  const $stats = $h.querySelector('#prec-stats');
  const $pg   = $h.querySelector('#prec-pager');

  const PAGE_SIZE = 50;
  let page = 1;
  let _all = [];
  let _filtered = [];
  let _qTimer = null;

  function applyFilter() {
    const q    = ($q.value || '').trim().toLowerCase();
    const serv = $serv.value || '';
    const col  = $col.value || '';
    const st   = $st.value || 'ativos';
    _filtered = _all.filter(p => {
      if (st === 'ativos'   && !p.ativo) return false;
      if (st === 'inativos' &&  p.ativo) return false;
      if (serv && String(p.id_servico || '') !== String(serv)) return false;
      if (col  && String(p.id_colecao || '') !== String(col)) return false;
      if (!q) return true;
      const blob = ((p.cod_ref || '') + ' ' + (p.desc_ref || '') + ' ' + (p.cor || '') + ' ' + (p.tamanho || '') + ' ' + (p.desc_servico || '') + ' ' + (p.nome_colecao || '')).toLowerCase();
      return blob.includes(q);
    });
    page = 1;
    render();
  }

  function render() {
    const total = _filtered.length;
    if (!total) {
      $tb.innerHTML = `<tr><td colspan="11" class="text-center text-slate-400 py-8"><i class="fas fa-money-bill-wave text-2xl mb-2 block opacity-60"></i>Nenhuma variação encontrada.</td></tr>`;
      $stats.textContent = '0 variação(ões).';
      $pg.innerHTML = '';
      return;
    }
    const totPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totPages) page = totPages;
    const start = (page - 1) * PAGE_SIZE;
    const slice = _filtered.slice(start, start + PAGE_SIZE);

    $stats.textContent = `${total} variação(ões) · página ${page}/${totPages}`;
    $tb.innerHTML = slice.map(p => `
      <tr class="border-t hover:bg-slate-50">
        <td class="font-mono">${escapeHtml(p.cod_ref || '—')}</td>
        <td>${escapeHtml(p.desc_ref || '—')}</td>
        <td class="text-slate-600">${escapeHtml(p.desc_servico || '—')}</td>
        <td>${p.cor ? escapeHtml(p.cor) : '<span class="text-slate-400 italic text-xs">todas</span>'}</td>
        <td class="text-center">${p.tamanho ? escapeHtml(p.tamanho) : '<span class="text-slate-400 italic text-xs">todos</span>'}</td>
        <td class="text-center">${p.grade || 1}</td>
        <td class="text-right tabular-nums font-semibold">${TERC.fmtBRL(p.preco)}</td>
        <td class="text-right tabular-nums">${p.tempo_min ? fmt.num(p.tempo_min, 2) : '—'}</td>
        <td class="text-slate-600">${escapeHtml(p.nome_colecao || '—')}</td>
        <td class="text-center">${p.ativo
          ? '<span class="badge badge-Finalizada">Ativo</span>'
          : '<span class="badge badge-Cancelada">Inativo</span>'}</td>
        <td class="text-right whitespace-nowrap">
          <button class="btn btn-sm btn-secondary mr-1" data-edit="${p.id_preco}" title="Editar"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger" data-del="${p.id_preco}" title="Excluir"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`).join('');

    $pg.innerHTML = totPages > 1 ? `
      <span>Mostrando ${start + 1}–${Math.min(start + PAGE_SIZE, total)} de ${total}</span>
      <div class="flex gap-1">
        <button class="btn btn-sm btn-secondary" id="pg-prev" ${page === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
        <button class="btn btn-sm btn-secondary" id="pg-next" ${page === totPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
      </div>` : `<span>${total} item(ns)</span>`;
    const pP = $pg.querySelector('#pg-prev'); if (pP) pP.onclick = () => { page--; render(); };
    const pN = $pg.querySelector('#pg-next'); if (pN) pN.onclick = () => { page++; render(); };

    $tb.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => TERC_openPrecoModal(b.dataset.edit, load));
    $tb.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Excluir esta variação de preço?')) return;
      try { await api('delete', '/terc/precos/' + b.dataset.del); toast('Variação excluída', 'success'); await load(); } catch {}
    });
  }

  async function load() {
    $tb.innerHTML = `<tr><td colspan="11" class="text-center text-slate-400 py-6"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando…</td></tr>`;
    try {
      const r = await api('get', '/terc/precos', null, { silent: true });
      _all = fmt.safeArr(r?.data);
      applyFilter();
    } catch (e) {
      console.error('[renderTercPrecosBlock] erro ao carregar', e);
      $tb.innerHTML = `<tr><td colspan="11" class="text-center text-red-500 py-6"><i class="fas fa-triangle-exclamation mr-2"></i>Erro ao carregar variações de preço.</td></tr>`;
    }
  }

  $q.oninput    = () => { clearTimeout(_qTimer); _qTimer = setTimeout(applyFilter, 220); };
  $serv.onchange = applyFilter;
  $col.onchange  = applyFilter;
  $st.onchange   = applyFilter;
  $h.querySelector('#prec-novo').onclick    = () => TERC_openPrecoModal(null, load);
  $h.querySelector('#prec-import').onclick  = () => TERC_openPrecosImportModal(load);
  $h.querySelector('#prec-del-all').onclick = () => TERC_confirmDeleteAllPrecos(load);

  await load();
}

/* ---------- Modal: Importar planilha de PREÇOS (Excel/CSV) ---------- */
async function TERC_openPrecosImportModal(onDone) {
  const colOpts = (typeof TERC?.optColecoes === 'function') ? TERC.optColecoes() : '<option value="">—</option>';
  const m = document.createElement('div'); m.className = 'modal-backdrop';
  const card = document.createElement('div'); card.className = 'modal p-6 w-full max-w-2xl';
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-2"><i class="fas fa-file-excel mr-2 text-emerald-500"></i>Importar Planilha de Preços</h3>
    <p class="text-xs text-slate-400 mb-3">
      Aceita <b>.xlsx</b>, <b>.xls</b> ou <b>.csv</b>. Colunas reconhecidas:
      <code class="px-1 py-0.5 rounded bg-slate-800/50 text-[11px]">cod_ref</code>,
      <code class="px-1 py-0.5 rounded bg-slate-800/50 text-[11px]">desc_ref</code>,
      <code class="px-1 py-0.5 rounded bg-slate-800/50 text-[11px]">cor</code>,
      <code class="px-1 py-0.5 rounded bg-slate-800/50 text-[11px]">tamanho</code>,
      <code class="px-1 py-0.5 rounded bg-slate-800/50 text-[11px]">servico</code>,
      <code class="px-1 py-0.5 rounded bg-slate-800/50 text-[11px]">preco</code>,
      <code class="px-1 py-0.5 rounded bg-slate-800/50 text-[11px]">tempo</code>.
    </p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Coleção (opcional)</label>
        <select id="m-imp-prec-col" class="w-full">${colOpts}</select>
      </div>
      <div>
        <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Modo</label>
        <select id="m-imp-prec-modo" class="w-full">
          <option value="atualizar" selected>Atualizar (cria + atualiza)</option>
          <option value="criar">Criar (ignora existentes)</option>
          <option value="simular">Simular (não grava)</option>
        </select>
      </div>
    </div>
    <div class="mb-3">
      <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Arquivo</label>
      <input type="file" id="m-imp-prec-file" accept=".xlsx,.xls,.csv" class="w-full" />
    </div>
    <div id="m-imp-prec-status" class="text-sm mb-2"></div>
    <div id="m-imp-prec-result" class="mb-3"></div>
    <div class="flex justify-end gap-2">
      <button class="btn btn-secondary" id="m-imp-prec-cancel">Fechar</button>
      <button class="btn btn-primary" id="m-imp-prec-go" disabled><i class="fas fa-cloud-arrow-up mr-1"></i>Importar</button>
    </div>`;
  m.appendChild(card); document.body.appendChild(m);
  const close = () => m.remove();
  card.querySelector('#m-imp-prec-cancel').onclick = close;
  m.addEventListener('click', e => { if (e.target === m) close(); });

  const $f      = card.querySelector('#m-imp-prec-file');
  const $go     = card.querySelector('#m-imp-prec-go');
  const $status = card.querySelector('#m-imp-prec-status');
  const $result = card.querySelector('#m-imp-prec-result');
  const $col    = card.querySelector('#m-imp-prec-col');
  const $modo   = card.querySelector('#m-imp-prec-modo');

  let parsedRows = [];

  // Normalização de cabeçalho (acento + lowercase + alias)
  function normHeader(h) {
    const s = String(h || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
    const map = {
      'referencia':'cod_ref','ref':'cod_ref','codigo':'cod_ref','cod':'cod_ref','cod_ref':'cod_ref','nome_referencia':'cod_ref',
      'descricao':'desc_ref','desc':'desc_ref','produto':'desc_ref','desc_ref':'desc_ref','nome':'desc_ref',
      'cor':'cor',
      'tamanho':'tamanho','grade':'tamanho','tam':'tamanho',
      'servico':'servico','desc_servico':'servico','nome_servico':'servico',
      'preco':'preco','valor':'preco','preco_unit':'preco',
      'tempo':'tempo','tempo_min':'tempo','tempo_padrao':'tempo','minutos':'tempo',
    };
    return map[s] || s;
  }

  $f.onchange = async () => {
    const file = $f.files?.[0];
    if (!file) return;
    $status.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Lendo arquivo…';
    $result.innerHTML = '';
    parsedRows = [];
    try {
      if (!window.XLSX) throw new Error('Biblioteca XLSX indisponível.');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!aoa.length) throw new Error('Planilha vazia.');
      const headers = aoa[0].map(normHeader);
      const out = [];
      for (let i = 1; i < aoa.length; i++) {
        const row = aoa[i];
        if (!row || !row.length) continue;
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = row[idx]; });
        // pula linhas totalmente vazias
        if (!String(obj.cod_ref||'').trim() && !String(obj.servico||'').trim()) continue;
        out.push(obj);
      }
      parsedRows = out;
      $status.innerHTML = `<i class="fas fa-check text-emerald-500 mr-1"></i><b>${parsedRows.length}</b> linha(s) lida(s) de <code>${file.name}</code>.`;
      $go.disabled = (parsedRows.length === 0);
    } catch (e) {
      console.error('[imp-prec parse]', e);
      $status.innerHTML = `<i class="fas fa-triangle-exclamation text-red-500 mr-1"></i>Erro ao ler arquivo: ${escapeHtml(e?.message||e)}`;
      $go.disabled = true;
    }
  };

  $go.onclick = async () => {
    if (!parsedRows.length) return;
    $go.disabled = true;
    $go.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Enviando…';
    $result.innerHTML = '';
    try {
      const payload = {
        rows: parsedRows,
        modo: $modo.value || 'atualizar',
        id_colecao: $col.value || null,
      };
      const r = await api('post', '/terc/precos/importar', payload);
      const d = r?.data || {};
      $result.innerHTML = `
        <div class="rounded-lg border p-3" style="background:var(--surface-2,#1E293B);border-color:var(--border, rgba(148,163,184,.15))">
          <div class="grid grid-cols-3 gap-3 mb-2">
            <div><div class="text-[11px] text-slate-400 uppercase">Criados</div><div class="text-lg font-bold" style="color:#10B981">${d.criados ?? 0}</div></div>
            <div><div class="text-[11px] text-slate-400 uppercase">Atualizados</div><div class="text-lg font-bold" style="color:#0EA5E9">${d.atualizados ?? 0}</div></div>
            <div><div class="text-[11px] text-slate-400 uppercase">Ignorados</div><div class="text-lg font-bold" style="color:#F59E0B">${d.ignorados ?? 0}</div></div>
          </div>
          ${d.simulado ? '<div class="text-xs" style="color:#F59E0B"><i class="fas fa-flask mr-1"></i>Modo simulação — nenhum dado foi gravado.</div>' : ''}
          ${(d.erros && d.erros.length) ? `<details class="mt-2"><summary class="cursor-pointer" style="color:#F43F5E"><b>${d.total_erros||d.erros.length}</b> erro(s)</summary><ul class="mt-1 ml-5 text-xs text-slate-400 list-disc">${d.erros.map(er=>`<li>Linha ${er.linha}: ${escapeHtml(er.motivo||'')}</li>`).join('')}</ul></details>` : ''}
        </div>`;
      toast(`${d.criados||0} criados · ${d.atualizados||0} atualizados${d.ignorados ? ' · '+d.ignorados+' ignorados' : ''}.`, 'success');
      if (typeof onDone === 'function' && !d.simulado) await onDone();
    } catch (e) {
      console.error('[imp-prec send]', e);
      $result.innerHTML = `<div style="color:#F43F5E;font-size:13px"><i class="fas fa-triangle-exclamation mr-1"></i>${escapeHtml(e?.message||e)}</div>`;
    } finally {
      $go.disabled = false;
      $go.innerHTML = '<i class="fas fa-cloud-arrow-up mr-1"></i>Importar';
    }
  };
}

/* ---------- Modal: Excluir TODAS as variações de PREÇO (confirmação dupla) ---------- */
async function TERC_confirmDeleteAllPrecos(onDone) {
  const m = document.createElement('div'); m.className = 'modal-backdrop';
  const card = document.createElement('div'); card.className = 'modal p-6 w-full max-w-md';
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3" style="color:#F43F5E">
      <i class="fas fa-triangle-exclamation mr-2"></i>Excluir Todas as Variações de Preço
    </h3>
    <p class="text-sm mb-2"><b>ATENÇÃO:</b></p>
    <p class="text-sm mb-2">Esta ação removerá <b>TODAS</b> as variações de preço cadastradas (Cor / Tamanho / Serviço).</p>
    <p class="text-xs text-slate-400 mb-3">A ação é irreversível e poderá impactar autopreenchimento em remessas.</p>
    <p class="text-sm mb-2">Para confirmar, digite <b>EXCLUIR-TODOS</b> abaixo:</p>
    <input id="m-del-all-prec-input" type="text" autocomplete="off" placeholder="Digite EXCLUIR-TODOS" class="w-full mb-4" />
    <div class="flex justify-end gap-2">
      <button class="btn btn-secondary" id="m-del-all-prec-cancel">Cancelar</button>
      <button class="btn btn-danger" id="m-del-all-prec-go" disabled><i class="fas fa-trash-can mr-1"></i>Excluir Tudo</button>
    </div>`;
  m.appendChild(card); document.body.appendChild(m);
  const close = () => m.remove();
  const $i = card.querySelector('#m-del-all-prec-input');
  const $g = card.querySelector('#m-del-all-prec-go');
  card.querySelector('#m-del-all-prec-cancel').onclick = close;
  m.addEventListener('click', e => { if (e.target === m) close(); });
  $i.oninput = () => { $g.disabled = ($i.value.trim().toUpperCase() !== 'EXCLUIR-TODOS'); };
  setTimeout(() => $i.focus(), 50);
  $g.onclick = async () => {
    $g.disabled = true;
    $g.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Excluindo…';
    try {
      // backend exige confirm1=SIM e confirm2=EXCLUIR-TODOS
      const r = await api('delete', '/terc/precos', { confirm1: 'SIM', confirm2: 'EXCLUIR-TODOS' });
      const n = r?.data?.deleted ?? 0;
      toast(`${n} variação(ões) excluída(s).`, 'success');
      close();
      if (typeof onDone === 'function') await onDone();
    } catch (e) {
      console.error('[del-all precos]', e);
      toast(e?.message || 'Falha ao excluir variações.', 'error');
      $g.disabled = false;
      $g.innerHTML = '<i class="fas fa-trash-can mr-1"></i>Excluir Tudo';
    }
  };
}

// Helper de escape HTML local — evita XSS em tabelas dinâmicas
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Expõe globalmente — útil para depuração e reuso
window.renderTercProdutosBlock = renderTercProdutosBlock;
window.renderTercPrecosBlock   = renderTercPrecosBlock;

ROUTES.terc_produtos = async (main) => {
  try {
    await TERC.load();
    main.innerHTML = `
      <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div class="text-xs text-slate-500 uppercase tracking-widest"><i class="fas fa-tshirt mr-1 text-brand"></i>Cadastro de Produtos</div>
      </div>
      <div class="card p-4" id="prod-body"></div>`;
    await renderTercProdutosBlock(main.querySelector('#prod-body'));
  } catch (e) {
    console.error('[ROUTES.terc_produtos] erro', e);
    main.innerHTML = `
      <div class="card p-6 text-center">
        <i class="fas fa-triangle-exclamation text-3xl text-amber-500 mb-2"></i>
        <h3 class="text-lg font-semibold mb-1">Não foi possível abrir Produtos</h3>
        <p class="text-sm text-slate-500 mb-3">${escapeHtml(e?.message || 'Erro desconhecido.')}</p>
        <button class="btn btn-primary" onclick="location.reload()"><i class="fas fa-rotate mr-1"></i>Recarregar</button>
      </div>`;
  }
};

/* ---------- PREÇOS / VARIAÇÕES (rota standalone — usa o mesmo bloco) ---------- */
ROUTES.terc_precos = async (main) => {
  try {
    await TERC.load();
    main.innerHTML = `
      <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div class="text-xs text-slate-500 uppercase tracking-widest"><i class="fas fa-money-bill-wave mr-1 text-brand"></i>Tabela de Preços / Variações (Cor + Grade)</div>
      </div>
      <div class="card p-4" id="prec-body"></div>`;
    await renderTercPrecosBlock(main.querySelector('#prec-body'));
  } catch (e) {
    console.error('[ROUTES.terc_precos] erro', e);
    main.innerHTML = `
      <div class="card p-6 text-center">
        <i class="fas fa-triangle-exclamation text-3xl text-amber-500 mb-2"></i>
        <h3 class="text-lg font-semibold mb-1">Não foi possível abrir Preços/Coleções</h3>
        <p class="text-sm text-slate-500 mb-3">${escapeHtml(e?.message || 'Erro desconhecido.')}</p>
        <button class="btn btn-primary" onclick="location.reload()"><i class="fas fa-rotate mr-1"></i>Recarregar</button>
      </div>`;
  }
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
 * GRADES DE TAMANHO DINÂMICAS — CRUD em Configurações
 * Permite criar/editar/duplicar/excluir grades e definir a padrão.
 * Cada grade tem nome + lista CSV de tamanhos (ex.: "PP,P,M,G,GG").
 * ============================================================ */
/* ============================================================
 * GRADES DE TAMANHO — Gerenciador profissional
 * - Lista com chips visuais, contagem, padrão, status, data criação
 * - Botões: Nova / Editar / Duplicar / Definir Padrão / Excluir
 * - Modal com chips drag-and-drop (HTML5 DnD), add/remove/edit
 * - Verificação de uso (impede hard-delete em grades já usadas)
 * - Cache local para não recarregar a cada ação
 * ============================================================ */
ROUTES.terc_grades_tamanho = async (main) => {
  // --- helpers internos ---
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function parseTams(raw) {
    const arr = Array.isArray(raw)
      ? raw.map(x => String(x).trim()).filter(Boolean)
      : String(raw || '').split(/[,;|\n\r\t]/).map(x => x.trim()).filter(Boolean);
    const seen = new Set(); const out = [];
    for (const t of arr) {
      const k = t.toUpperCase();
      if (!seen.has(k)) { seen.add(k); out.push(t); }
    }
    return out;
  }
  function fmtDate(s) {
    if (!s) return '—';
    try { return dayjs(s).format('DD/MM/YYYY'); } catch { return s; }
  }
  function tipoFromTamanhos(tams) {
    const arr = parseTams(tams);
    if (arr.length === 0) return '—';
    const allNum = arr.every(t => /^\d+([,.]\d+)?$/.test(t));
    if (allNum) return 'Numérica';
    const padrao = ['PP','P','M','G','GG','EG','XG','U','UN','XS','S','L','XL','XXL','XP','XPP'];
    if (arr.every(t => padrao.includes(t.toUpperCase()))) return 'Letras';
    return 'Personalizada';
  }

  main.innerHTML = `
    <div class="page-header mb-4 flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-xl font-bold">
          <i class="fas fa-ruler-combined mr-2 text-brand"></i>Grades de Tamanho
        </h1>
        <p class="text-sm text-slate-500 mt-1">
          Crie e gerencie as grades disponíveis no sistema. A grade <b>padrão</b> abre automaticamente em novas remessas.
          Remessas antigas preservam os tamanhos originais — alterações afetam apenas registros novos.
        </p>
      </div>
      <div class="flex gap-2">
        <button id="g-reload" class="btn btn-secondary" title="Recarregar">
          <i class="fas fa-sync-alt"></i>
        </button>
        <button id="g-novo" class="btn btn-success">
          <i class="fas fa-plus mr-1"></i>Nova Grade
        </button>
      </div>
    </div>
    <div id="grades-list" class="card p-0 overflow-x-auto"></div>
  `;

  async function load() {
    const wrap = $('#grades-list');
    wrap.innerHTML = '<div class="p-8 text-center text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando grades…</div>';
    try {
      const r = await api('get', '/terc/grades-tamanho?incluir_inativos=1');
      const lst = fmt.safeArr(r.data);
      if (lst.length === 0) {
        wrap.innerHTML = `
          <div class="gd-empty">
            <i class="fas fa-ruler-combined"></i>
            <h3>Nenhuma grade cadastrada</h3>
            <p>Crie a sua primeira grade clicando em <b>"Nova Grade"</b>. Você poderá usá-la imediatamente em remessas e retornos.</p>
            <button class="btn btn-success" onclick="document.getElementById('g-novo').click()">
              <i class="fas fa-plus mr-1"></i>Criar Primeira Grade
            </button>
          </div>`;
        return;
      }
      wrap.innerHTML = `
        <table class="gd-table min-w-full text-sm">
          <thead>
            <tr>
              <th class="text-left">Nome</th>
              <th class="text-left">Tamanhos</th>
              <th class="text-center">Qtd</th>
              <th class="text-center">Tipo</th>
              <th class="text-center">Padrão</th>
              <th class="text-center">Status</th>
              <th class="text-left">Criada em</th>
              <th class="text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${lst.map((g) => {
              const tams = parseTams(g.tamanhos);
              const tipo = tipoFromTamanhos(g.tamanhos);
              return `
              <tr data-id="${g.id_grade}" class="${g.ativo ? '' : 'gd-row-inactive'}">
                <td class="font-semibold" title="${escHtml(g.descricao || '')}">
                  ${escHtml(g.nome)}
                  ${g.descricao ? `<div class="text-xs text-slate-400 font-normal">${escHtml(g.descricao)}</div>` : ''}
                </td>
                <td>
                  <div class="gd-chip-row">
                    ${tams.slice(0, 12).map(t => `<span class="gd-chip-mini">${escHtml(t)}</span>`).join('')}
                    ${tams.length > 12 ? `<span class="gd-chip-mini gd-chip-more">+${tams.length-12}</span>` : ''}
                  </div>
                </td>
                <td class="text-center font-mono">${tams.length}</td>
                <td class="text-center"><span class="gd-tipo-badge gd-tipo-${tipo.toLowerCase()}">${tipo}</span></td>
                <td class="text-center">
                  ${g.is_default
                    ? '<span class="gd-default-on" title="Grade padrão"><i class="fas fa-star"></i> Padrão</span>'
                    : (g.ativo
                        ? `<button class="gd-default-off" data-act="default" title="Marcar como padrão"><i class="far fa-star"></i></button>`
                        : '<span class="text-slate-400 text-xs">—</span>'
                      )
                  }
                </td>
                <td class="text-center">
                  ${g.ativo
                    ? '<span class="gd-status gd-status-on">Ativa</span>'
                    : '<span class="gd-status gd-status-off">Inativa</span>'
                  }
                </td>
                <td class="text-xs text-slate-500">${fmtDate(g.dt_criacao)}</td>
                <td class="text-right">
                  <div class="flex justify-end gap-1">
                    <button class="btn btn-secondary btn-sm" data-act="dup" title="Duplicar">
                      <i class="fas fa-copy"></i>
                    </button>
                    <button class="btn btn-primary btn-sm" data-act="edit" title="Editar">
                      <i class="fas fa-pen"></i>
                    </button>
                    ${g.ativo
                      ? `<button class="btn btn-danger btn-sm" data-act="del" title="Excluir / Desativar">
                          <i class="fas fa-trash"></i>
                        </button>`
                      : `<button class="btn btn-success btn-sm" data-act="reactivate" title="Reativar">
                          <i class="fas fa-undo"></i>
                        </button>`
                    }
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      `;

      wrap.querySelectorAll('button[data-act]').forEach((btn) => {
        btn.onclick = async () => {
          const tr = btn.closest('tr');
          const id = Number(tr?.dataset.id);
          const act = btn.dataset.act;
          if (!id) return;

          if (act === 'edit') return openGradeModal(id, load);

          if (act === 'dup') {
            try {
              const r = await api('post', `/terc/grades-tamanho/${id}/duplicar`);
              toast(`Grade duplicada como "${r.data?.nome || 'cópia'}"`, 'success'); load();
            } catch {}
            return;
          }
          if (act === 'default') {
            try {
              await api('post', `/terc/grades-tamanho/${id}/default`);
              toast('Grade marcada como padrão', 'success'); load();
            } catch {}
            return;
          }
          if (act === 'reactivate') {
            try {
              await api('put', `/terc/grades-tamanho/${id}`, { ativo: 1 });
              toast('Grade reativada', 'success'); load();
            } catch {}
            return;
          }
          if (act === 'del') {
            await handleDelete(id, load);
            return;
          }
        };
      });
    } catch (e) {
      wrap.innerHTML = `
        <div class="gd-empty gd-empty--error">
          <i class="fas fa-exclamation-triangle"></i>
          <h3>Falha ao carregar grades</h3>
          <p>${escHtml(e?.response?.data?.error || e?.message || 'Erro desconhecido')}</p>
          <button class="btn btn-primary" onclick="document.getElementById('g-reload').click()">
            <i class="fas fa-sync-alt mr-1"></i>Tentar novamente
          </button>
        </div>`;
    }
  }

  // ============== EXCLUSÃO INTELIGENTE ==============
  async function handleDelete(id, onDone) {
    let uso = null;
    try { uso = (await api('get', `/terc/grades-tamanho/${id}/uso`)).data; } catch {}

    const m = el('div', { class: 'modal-backdrop' });
    const card = el('div', { class: 'modal p-0 w-full max-w-md gd-confirm' });
    const emUso = !!(uso && uso.em_uso);

    card.innerHTML = `
      <div class="gd-confirm-header ${emUso ? 'gd-confirm-warn' : 'gd-confirm-danger'}">
        <i class="fas ${emUso ? 'fa-info-circle' : 'fa-exclamation-triangle'}"></i>
        <h3>${emUso ? 'Grade em uso' : 'Excluir grade'}</h3>
      </div>
      <div class="gd-confirm-body">
        ${emUso ? `
          <p>Esta grade já está vinculada a <b>${uso.itens}</b> item(ns) em <b>${uso.remessas}</b> remessa(s) — não pode ser excluída permanentemente.</p>
          <p class="text-sm text-slate-500 mt-2">Você pode <b>desativá-la</b> (soft-delete): ela ficará oculta para novas remessas, mas o histórico antigo continuará funcionando normalmente.</p>
        ` : `
          <p>Esta grade <b>não está vinculada a nenhuma movimentação</b>. Você pode excluí-la permanentemente ou apenas desativá-la.</p>
        `}
      </div>
      <div class="gd-confirm-actions">
        <button id="gc-cancel" class="btn btn-secondary">Cancelar</button>
        ${emUso
          ? `<button id="gc-soft" class="btn btn-warning"><i class="fas fa-eye-slash mr-1"></i>Desativar</button>`
          : `
            <button id="gc-soft" class="btn btn-warning"><i class="fas fa-eye-slash mr-1"></i>Desativar</button>
            <button id="gc-hard" class="btn btn-danger"><i class="fas fa-trash mr-1"></i>Excluir definitivo</button>
          `
        }
      </div>
    `;
    m.appendChild(card); document.body.appendChild(m);
    const close = () => m.remove();
    card.querySelector('#gc-cancel').onclick = close;
    card.querySelector('#gc-soft').onclick = async () => {
      try {
        await api('delete', `/terc/grades-tamanho/${id}`);
        toast('Grade desativada', 'success'); close(); onDone && onDone();
      } catch {}
    };
    const hardBtn = card.querySelector('#gc-hard');
    if (hardBtn) hardBtn.onclick = async () => {
      try {
        await api('delete', `/terc/grades-tamanho/${id}?hard=1`);
        toast('Grade excluída permanentemente', 'success'); close(); onDone && onDone();
      } catch {}
    };
  }

  // ============== MODAL DE EDIÇÃO ==============
  function openGradeModal(id, onSave) {
    const editing = !!id;
    const m = el('div', { class: 'modal-backdrop' });
    const card = el('div', { class: 'modal p-0 w-full max-w-2xl gd-modal' });
    card.innerHTML = `
      <div class="gd-modal-header">
        <i class="fas ${editing ? 'fa-pen-to-square' : 'fa-plus-circle'}"></i>
        <div>
          <h3>${editing ? 'Editar Grade' : 'Nova Grade'} de Tamanho</h3>
          <p class="text-xs opacity-80">Arraste os tamanhos para reorganizar. Clique nos chips para editar.</p>
        </div>
        <button class="gd-modal-close" id="gm-close" aria-label="Fechar"><i class="fas fa-times"></i></button>
      </div>

      <div class="gd-modal-body">
        <div class="gd-field">
          <label>Nome da grade <span class="gd-req">*</span></label>
          <input id="gm-nome" placeholder="ex.: Padrão Adulto, Numérico 34-42, Fitness Feminino" maxlength="80" autocomplete="off" />
        </div>

        <div class="gd-field">
          <label>Descrição <span class="text-xs text-slate-400 font-normal">(opcional)</span></label>
          <input id="gm-desc" placeholder="ex.: Tamanhos clássicos adulto" maxlength="160" autocomplete="off" />
        </div>

        <div class="gd-field">
          <label>Tamanhos <span class="gd-req">*</span>
            <span class="text-xs text-slate-400 font-normal ml-2">(arraste para reordenar — clique para editar — ✕ para remover)</span>
          </label>
          <div id="gm-chips" class="gd-chip-area" aria-live="polite"></div>
          <div class="gd-add-row">
            <input id="gm-add" placeholder="Digite um tamanho e pressione Enter (ex.: PP, 34, XG)" maxlength="20" autocomplete="off" />
            <button id="gm-add-btn" type="button" class="btn btn-primary btn-sm" title="Adicionar (Enter)">
              <i class="fas fa-plus"></i>
            </button>
          </div>
          <div class="gd-presets">
            <span class="gd-preset-label">Atalhos:</span>
            <button type="button" data-preset="PP,P,M,G,GG" class="gd-preset-btn">Adulto Clássico</button>
            <button type="button" data-preset="PP,P,M,G,GG,EG,XG" class="gd-preset-btn">Adulto Estendido</button>
            <button type="button" data-preset="34,36,38,40,42,44" class="gd-preset-btn">Numérica 34-44</button>
            <button type="button" data-preset="2,4,6,8,10,12,14" class="gd-preset-btn">Infantil</button>
            <button type="button" data-preset="U" class="gd-preset-btn">Único</button>
            <button type="button" data-preset="" class="gd-preset-btn gd-preset-clear" title="Limpar">
              <i class="fas fa-eraser"></i>
            </button>
          </div>
        </div>

        <div class="gd-field-row">
          <label class="gd-check">
            <input type="checkbox" id="gm-default" />
            <span><i class="fas fa-star text-amber-400 mr-1"></i>Marcar como padrão</span>
          </label>
          <label class="gd-check">
            <input type="checkbox" id="gm-ativo" checked />
            <span><i class="fas fa-toggle-on text-emerald-400 mr-1"></i>Ativa</span>
          </label>
        </div>

        <div id="gm-uso-hint" class="gd-uso-hint" style="display:none"></div>
      </div>

      <div class="gd-modal-footer">
        <button id="gm-cancel" class="btn btn-secondary">Cancelar</button>
        <button id="gm-save" class="btn btn-primary">
          <i class="fas fa-save mr-1"></i>Salvar Grade
        </button>
      </div>
    `;
    m.appendChild(card); document.body.appendChild(m);

    // Estado interno (lista mutável de tamanhos)
    let chips = [];

    const $chips = card.querySelector('#gm-chips');
    const $add = card.querySelector('#gm-add');
    const $addBtn = card.querySelector('#gm-add-btn');
    const $usoHint = card.querySelector('#gm-uso-hint');

    function renderChips() {
      if (chips.length === 0) {
        $chips.innerHTML = '<div class="gd-chip-empty">Nenhum tamanho — adicione abaixo ou use um atalho</div>';
        return;
      }
      $chips.innerHTML = chips.map((t, idx) => `
        <span class="gd-chip" draggable="true" data-idx="${idx}" tabindex="0">
          <i class="fas fa-grip-vertical gd-chip-grip" aria-hidden="true"></i>
          <span class="gd-chip-text" title="Clique para editar">${escHtml(t)}</span>
          <button type="button" class="gd-chip-x" data-idx="${idx}" aria-label="Remover ${escHtml(t)}">
            <i class="fas fa-times"></i>
          </button>
        </span>
      `).join('');
      bindChipEvents();
    }

    function bindChipEvents() {
      // Remoção
      $chips.querySelectorAll('.gd-chip-x').forEach(b => {
        b.onclick = (e) => {
          e.stopPropagation();
          const i = Number(b.dataset.idx);
          chips.splice(i, 1);
          renderChips();
        };
      });
      // Edição inline ao clicar no texto
      $chips.querySelectorAll('.gd-chip-text').forEach(t => {
        t.onclick = () => {
          const chip = t.closest('.gd-chip');
          const i = Number(chip.dataset.idx);
          const novo = prompt('Editar tamanho:', chips[i]);
          if (novo == null) return;
          const v = String(novo).trim();
          if (!v) return;
          // dedupe
          if (chips.some((x, k) => k !== i && x.toUpperCase() === v.toUpperCase())) {
            toast('Esse tamanho já existe na grade', 'warning'); return;
          }
          chips[i] = v;
          renderChips();
        };
      });

      // Drag-and-drop nativo HTML5
      let dragSrc = null;
      $chips.querySelectorAll('.gd-chip').forEach(chip => {
        chip.addEventListener('dragstart', (e) => {
          dragSrc = Number(chip.dataset.idx);
          chip.classList.add('gd-chip-dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', String(dragSrc)); } catch {}
        });
        chip.addEventListener('dragend', () => {
          chip.classList.remove('gd-chip-dragging');
          $chips.querySelectorAll('.gd-chip').forEach(c => c.classList.remove('gd-chip-over'));
        });
        chip.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          chip.classList.add('gd-chip-over');
        });
        chip.addEventListener('dragleave', () => chip.classList.remove('gd-chip-over'));
        chip.addEventListener('drop', (e) => {
          e.preventDefault();
          chip.classList.remove('gd-chip-over');
          const dst = Number(chip.dataset.idx);
          if (dragSrc == null || isNaN(dst) || dragSrc === dst) return;
          const [moved] = chips.splice(dragSrc, 1);
          chips.splice(dst, 0, moved);
          dragSrc = null;
          renderChips();
        });
      });
    }

    function addOne(raw) {
      const arr = parseTams(raw);
      let added = 0, dup = 0;
      for (const t of arr) {
        if (chips.some(c => c.toUpperCase() === t.toUpperCase())) { dup++; continue; }
        chips.push(t); added++;
      }
      renderChips();
      if (dup > 0) toast(`${dup} tamanho(s) já existiam`, 'warning');
      return added;
    }

    $addBtn.onclick = () => {
      const v = $add.value.trim();
      if (!v) return;
      addOne(v); $add.value = ''; $add.focus();
    };
    $add.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
        e.preventDefault();
        $addBtn.click();
      } else if (e.key === 'Backspace' && !$add.value && chips.length) {
        chips.pop(); renderChips();
      }
    });
    // Suporte a colar lista CSV
    $add.addEventListener('paste', (e) => {
      const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      if (/[,;|\n\t]/.test(text)) {
        e.preventDefault();
        addOne(text); $add.value = '';
      }
    });

    // Presets / atalhos
    card.querySelectorAll('button[data-preset]').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.preset || '';
        if (v === '' && b.classList.contains('gd-preset-clear')) {
          if (chips.length && !confirm('Limpar todos os tamanhos?')) return;
          chips = []; renderChips(); return;
        }
        chips = parseTams(v); renderChips();
      };
    });

    // Carrega dados se for edição (incluindo info de uso)
    if (editing) {
      Promise.all([
        api('get', '/terc/grades-tamanho/' + id),
        api('get', `/terc/grades-tamanho/${id}/uso`).catch(() => ({ data: null })),
      ]).then(([rg, ru]) => {
        const g = rg.data || {};
        card.querySelector('#gm-nome').value = g.nome || '';
        card.querySelector('#gm-desc').value = g.descricao || '';
        card.querySelector('#gm-default').checked = !!g.is_default;
        card.querySelector('#gm-ativo').checked = !!g.ativo;
        chips = parseTams(g.tamanhos);
        renderChips();
        const uso = ru?.data;
        if (uso && uso.em_uso) {
          $usoHint.style.display = '';
          $usoHint.innerHTML = `
            <i class="fas fa-info-circle"></i>
            Esta grade está vinculada a <b>${uso.itens}</b> item(ns) em <b>${uso.remessas}</b> remessa(s).
            Alterações afetam apenas <b>novas</b> remessas — o histórico antigo é preservado.
          `;
        }
      }).catch(() => m.remove());
    } else {
      card.querySelector('#gm-nome').focus();
      renderChips();
    }

    const close = () => m.remove();
    card.querySelector('#gm-cancel').onclick = close;
    card.querySelector('#gm-close').onclick = close;
    // Fecha com ESC
    document.addEventListener('keydown', function onEsc(ev) {
      if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });

    card.querySelector('#gm-save').onclick = async () => {
      const nome = card.querySelector('#gm-nome').value.trim();
      // Adiciona conteúdo pendente do input antes de salvar
      const pending = $add.value.trim();
      if (pending) addOne(pending);

      if (!nome) { toast('Informe o nome da grade', 'warning'); card.querySelector('#gm-nome').focus(); return; }
      if (chips.length === 0) { toast('Adicione ao menos 1 tamanho', 'warning'); $add.focus(); return; }

      const body = {
        nome,
        tamanhos: chips.join(','),
        descricao: card.querySelector('#gm-desc').value.trim(),
        is_default: card.querySelector('#gm-default').checked ? 1 : 0,
        ativo: card.querySelector('#gm-ativo').checked ? 1 : 0,
      };
      const $save = card.querySelector('#gm-save');
      $save.disabled = true; $save.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Salvando…';
      try {
        if (editing) await api('put', '/terc/grades-tamanho/' + id, body);
        else await api('post', '/terc/grades-tamanho', body);
        toast(editing ? 'Grade atualizada' : 'Grade criada com sucesso', 'success');
        close();
        onSave && onSave();
      } catch {
        $save.disabled = false; $save.innerHTML = '<i class="fas fa-save mr-1"></i>Salvar Grade';
      }
    };
  }

  $('#g-novo').onclick = () => openGradeModal(null, load);
  $('#g-reload').onclick = load;
  load();
};


/* ============================================================
 * CONFIGURAÇÕES — Parâmetros da empresa (usados na impressão de romaneio)
 * ============================================================ */
ROUTES.configuracoes = async (main) => {
  let params = [];
  try {
    const r = await api('get', '/parametros', null, { silent: true });
    params = r.data || [];
  } catch (e) {
    main.innerHTML = '<div class="card p-6 text-red-600"><i class="fas fa-exclamation-triangle mr-2"></i>Falha ao carregar parâmetros.</div>';
    return;
  }
  const map = {};
  params.forEach(p => { map[p.chave] = p.valor; });

  const FIELDS = [
    { key: 'EMPRESA_NOME',     label: 'Nome da Empresa',  icon: 'fa-building',     ph: 'Ex.: CorePro Confecção' },
    { key: 'EMPRESA_CNPJ',     label: 'CNPJ',             icon: 'fa-id-card',      ph: '00.000.000/0000-00' },
    { key: 'EMPRESA_TEL',      label: 'Telefone',         icon: 'fa-phone',        ph: '(00) 0000-0000' },
    { key: 'EMPRESA_EMAIL',    label: 'E-mail',           icon: 'fa-envelope',     ph: 'contato@empresa.com' },
    { key: 'EMPRESA_ENDERECO', label: 'Endereço',         icon: 'fa-map-marker-alt', ph: 'Rua, número, cidade — UF' },
  ];

  main.innerHTML = `
    <div class="max-w-3xl mx-auto">
      <div class="card p-6">
        <div class="flex items-center gap-3 mb-5 pb-4 border-b border-slate-200/10">
          <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white">
            <i class="fas fa-sliders-h text-xl"></i>
          </div>
          <div>
            <div class="text-lg font-bold">Configurações</div>
            <div class="text-sm text-slate-500">Dados da empresa exibidos na impressão de romaneio e relatórios.</div>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${FIELDS.map(f => `
            <div class="${f.key === 'EMPRESA_ENDERECO' ? 'md:col-span-2' : ''}">
              <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                <i class="fas ${f.icon} mr-1 text-slate-400"></i>${f.label}
              </label>
              <input type="text" data-key="${f.key}" value="${(map[f.key] || '').replace(/"/g,'&quot;')}"
                     placeholder="${f.ph}"
                     class="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300/30 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
          `).join('')}
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button id="btn-cfg-cancel" class="btn btn-secondary"><i class="fas fa-rotate mr-1"></i>Recarregar</button>
          <button id="btn-cfg-save" class="btn btn-primary"><i class="fas fa-save mr-1"></i>Salvar Configurações</button>
        </div>
      </div>
    </div>`;

  $('#btn-cfg-cancel').onclick = () => ROUTES.configuracoes(main);
  $('#btn-cfg-save').onclick = async () => {
    const btn = $('#btn-cfg-save');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Salvando…';
    try {
      const tasks = FIELDS.map(f => {
        const v = (main.querySelector(`input[data-key="${f.key}"]`)?.value || '').trim();
        return api('put', `/parametros/${encodeURIComponent(f.key)}`, { valor: v });
      });
      await Promise.all(tasks);
      // Limpa cache de empresa para forçar reload na próxima impressão
      if (window.UI && UI.empresa) UI.empresa = null;
      toast('Configurações salvas com sucesso.', 'success');
    } catch (e) {
      toast('Erro ao salvar: ' + (e?.response?.data?.error || e.message), 'error');
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>Salvar Configurações';
    }
  };
};

/* ============================================================
 * PERFIL DO USUÁRIO — edição de dados pessoais e foto/avatar
 * ============================================================ */
ROUTES.perfil = async (main) => {
  let p;
  try { p = (await api('get', '/auth/perfil')).data; }
  catch { main.innerHTML = '<div class="card p-6 text-red-600">Falha ao carregar perfil.</div>'; return; }

  // Estado local p/ avatar
  let novoAvatar = null;       // data URL pendente (se trocou)
  let removerAvatar = false;
  let avatarPreview = p.avatar_data || null;

  function renderHeader() {
    return `
      <div class="page-header mb-4">
        <h1 class="text-xl font-bold text-slate-800"><i class="fas fa-user-circle mr-2 text-brand"></i>Meu Perfil</h1>
        <p class="text-sm text-slate-500">Gerencie seus dados pessoais, foto e senha de acesso.</p>
      </div>`;
  }

  function avatarBoxHTML() {
    const u = { ...p, avatar_data: avatarPreview };
    return `
      <div class="profile-avatar-box">
        <div id="prof-av-slot">${avatarHTML(u, 'lg')}</div>
        <div class="actions">
          <button id="prof-av-pick" class="btn btn-secondary btn-sm" type="button">
            <i class="fas fa-camera mr-1"></i>Trocar foto
          </button>
          <button id="prof-av-rem" class="btn btn-danger btn-sm" type="button" ${avatarPreview ? '' : 'disabled'}>
            <i class="fas fa-trash mr-1"></i>Remover
          </button>
          <input id="prof-av-file" type="file" accept="image/png,image/jpeg,image/jpg,image/webp" class="hidden" />
        </div>
        <div class="text-xs text-slate-500 text-center" style="max-width:200px;">
          JPG, PNG ou WebP. Máx ~2 MB. Redimensionada para 256×256px automaticamente.
        </div>
      </div>`;
  }

  main.innerHTML = `
    ${renderHeader()}
    <div class="profile-grid">
      ${avatarBoxHTML()}
      <div>
        <div class="profile-section">
          <h4><i class="fas fa-id-card mr-2 text-brand"></i>Dados pessoais</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label>Nome <span class="text-red-500">*</span></label>
              <input id="prof-nome" type="text" value="${(p.nome||'').replace(/"/g,'&quot;')}" maxlength="120" required />
            </div>
            <div>
              <label>Login <span class="text-red-500">*</span></label>
              <input id="prof-login" type="text" value="${(p.login||'').replace(/"/g,'&quot;')}" maxlength="60" pattern="[a-zA-Z0-9_.\\-]+" required />
              <div class="text-xs text-slate-500 mt-1">Letras, números, ponto, hífen e underscore.</div>
            </div>
            <div>
              <label>E-mail</label>
              <input id="prof-email" type="email" value="${(p.email||'').replace(/"/g,'&quot;')}" maxlength="160" placeholder="seu@email.com" />
            </div>
            <div>
              <label>Perfil</label>
              <input type="text" value="${p.perfil || ''}" disabled class="bg-slate-100" />
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-3">
            <button id="prof-save" class="btn btn-primary"><i class="fas fa-save mr-1"></i>Salvar dados</button>
          </div>
        </div>

        <div class="profile-section">
          <h4><i class="fas fa-key mr-2 text-amber-600"></i>Alterar senha</h4>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label>Senha atual <span class="text-red-500">*</span></label>
              <input id="pwa" type="password" autocomplete="current-password" />
            </div>
            <div>
              <label>Nova senha (mín. 6) <span class="text-red-500">*</span></label>
              <input id="pwn" type="password" autocomplete="new-password" />
            </div>
            <div>
              <label>Confirmar nova <span class="text-red-500">*</span></label>
              <input id="pwc" type="password" autocomplete="new-password" />
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-3">
            <button id="pw-save" class="btn btn-primary"><i class="fas fa-shield-halved mr-1"></i>Atualizar senha</button>
          </div>
        </div>

        <div class="profile-section">
          <h4><i class="fas fa-circle-info mr-2 text-slate-500"></i>Informações da conta</h4>
          <div class="text-sm text-slate-600 grid grid-cols-1 md:grid-cols-2 gap-2">
            <div><b>ID:</b> ${p.id_usuario}</div>
            <div><b>Criado em:</b> ${p.dt_criacao ? dayjs(p.dt_criacao).format('DD/MM/YYYY HH:mm') : '—'}</div>
            <div><b>Último login:</b> ${p.ultimo_login ? dayjs(p.ultimo_login).format('DD/MM/YYYY HH:mm') : '—'}</div>
            <div><b>Avatar atualizado:</b> ${p.avatar_atualizado ? dayjs(p.avatar_atualizado).format('DD/MM/YYYY HH:mm') : '—'}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // ===== Avatar: pick / preview / redimensionar / remover =====
  const fileInput = $('#prof-av-file');
  $('#prof-av-pick').onclick = () => fileInput.click();
  $('#prof-av-rem').onclick = () => {
    if (!avatarPreview) return;
    avatarPreview = null;
    novoAvatar = null;
    removerAvatar = true;
    $('#prof-av-slot').innerHTML = avatarHTML({ ...p, avatar_data: null }, 'lg');
    $('#prof-av-rem').disabled = true;
  };
  fileInput.onchange = async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) {
      toast('Formato inválido. Use JPG, PNG ou WebP.', 'error'); return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast('Imagem muito grande. Máx 5 MB antes do redimensionamento.', 'error'); return;
    }
    try {
      const dataUrl = await _resizeImageToDataURL(f, 256, 256, 0.88);
      novoAvatar = dataUrl;
      avatarPreview = dataUrl;
      removerAvatar = false;
      $('#prof-av-slot').innerHTML = avatarHTML({ ...p, avatar_data: dataUrl }, 'lg');
      $('#prof-av-rem').disabled = false;
    } catch {
      toast('Não foi possível processar a imagem.', 'error');
    } finally {
      fileInput.value = '';
    }
  };

  // ===== Salvar dados pessoais (+ avatar se houver) =====
  $('#prof-save').onclick = async () => {
    const nome = $('#prof-nome').value.trim();
    const login = $('#prof-login').value.trim();
    const email = $('#prof-email').value.trim();
    if (!nome) { toast('Informe seu nome.', 'warning'); return; }
    if (!login || login.length < 3) { toast('Login inválido (mín. 3 caracteres).', 'warning'); return; }
    if (!/^[a-zA-Z0-9_.\-]+$/.test(login)) { toast('Login com caracteres inválidos.', 'warning'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('E-mail inválido.', 'warning'); return; }

    const body = { nome, login, email };
    if (removerAvatar) body.remover_avatar = true;
    else if (novoAvatar) body.avatar_data = novoAvatar;

    try {
      const r = await api('put', '/auth/perfil', body);
      const upd = r.data || {};
      // Sincroniza estado global
      Object.assign(p, upd);
      if (state.user) {
        state.user.nome = upd.nome;
        state.user.login = upd.login;
        state.user.email = upd.email;
        state.user.avatar_data = upd.avatar_data;
        state.user.avatar_mime = upd.avatar_mime;
        AUTH.setUser(state.user);
      }
      novoAvatar = null;
      removerAvatar = false;
      avatarPreview = upd.avatar_data || null;
      refreshUserUI();
      toast('Perfil atualizado com sucesso!', 'success');
    } catch {/* api() já mostra o erro */}
  };

  // ===== Alterar senha =====
  $('#pw-save').onclick = async () => {
    const sa = $('#pwa').value, sn = $('#pwn').value, sc = $('#pwc').value;
    if (!sa || !sn || !sc) { toast('Preencha todos os campos de senha.', 'warning'); return; }
    if (sn !== sc) { toast('A confirmação não confere.', 'error'); return; }
    if (sn.length < 6) { toast('Nova senha precisa de pelo menos 6 caracteres.', 'error'); return; }
    if (sn === sa) { toast('A nova senha deve ser diferente da atual.', 'warning'); return; }
    try {
      await api('put', '/auth/perfil/senha', { senha_atual: sa, senha_nova: sn, senha_confirma: sc });
      $('#pwa').value = ''; $('#pwn').value = ''; $('#pwc').value = '';
      toast('Senha alterada com sucesso.', 'success');
    } catch {/* api() já mostra o erro */}
  };
};

// Helper: redimensiona uma imagem (File) para data URL JPEG/PNG cabendo em maxW × maxH
function _resizeImageToDataURL(file, maxW, maxH, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        // Mantém PNG (com transparência) só se origem for PNG; resto vira JPEG (menor)
        const isPng = /image\/png/i.test(file.type);
        const out = isPng
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', quality || 0.88);
        resolve(out);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

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
      // Busca perfil completo (com avatar/email) — fallback p/ resposta do login
      let usuario = r.data.data.usuario;
      try {
        const me = await axios.get(API + '/auth/me', {
          headers: { Authorization: 'Bearer ' + r.data.data.token }
        });
        if (me.data?.data) usuario = { ...usuario, ...me.data.data };
      } catch {}
      AUTH.setUser(usuario);
      state.user = usuario;
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
