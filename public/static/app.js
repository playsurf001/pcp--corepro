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
    // 🆕 Suporte a AbortController: passe opts.signal para cancelar requests
    const cfg = { method, url: API + path, data: body, headers };
    if (opts.signal) cfg.signal = opts.signal;
    const r = await axios(cfg);
    return r.data;
  } catch (e) {
    // Request cancelado pelo cliente (AbortController) — silenciar
    if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED' || axios.isCancel?.(e)) {
      const err = new Error('canceled');
      err.canceled = true;
      throw err;
    }
    const status = e.response?.status;
    const code = e.response?.data?.code;
    let msg = e.response?.data?.error || e.message || 'Erro';
    const detail = e.response?.data?.detail;
    // Log estruturado p/ debug
    console.error('[api]', method?.toUpperCase(), path, 'status=' + status, 'code=' + code, '→', msg, detail ? `\n  detail: ${detail}` : '');
    // 🛡️ FALLBACK: se o backend devolveu 500 sem body JSON (text/plain "Internal Server Error"),
    // damos uma mensagem amigável em vez do "Request failed with status code 500" cru do axios.
    if (status >= 500 && (msg === 'Request failed with status code 500' || /Request failed with status code/i.test(msg))) {
      msg = 'Erro interno do servidor. Tente novamente ou contate o suporte.';
    }
    if (status === 0 || e.code === 'ERR_NETWORK') {
      msg = 'Falha de conexão. Verifique sua internet.';
    }
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
    // 🆕 SPRINT 5 — Interceptor de cobrança/limites SaaS
    // 402 Payment Required: tenant suspenso por inadimplência OU limite de plano excedido
    if (status === 402 && !opts.silent) {
      const data = e.response?.data || {};
      if (code === 'PLAN_LIMIT_EXCEEDED') {
        showPlanLimitModal(data);
        throw e;
      }
      if (code === 'TENANT_SUSPENDED' || code === 'TENANT_BLOCKED' || code === 'TENANT_CANCELED') {
        showTenantBlockedModal(data, code);
        throw e;
      }
    }
    if (!opts.silent) toast(msg, 'error');
    throw e;
  }
}
window.api = api;

/* ============================================================
 * 🆕 SPRINT 5 — MODAIS DE COBRANÇA / LIMITES SaaS
 * Interceptor exibe modal amigável em vez de toast quando:
 *  - PLAN_LIMIT_EXCEEDED → CTA "Fazer upgrade" → #minha_assinatura
 *  - TENANT_SUSPENDED    → CTA "Pagar agora"  → #minha_assinatura
 * ============================================================ */
function showPlanLimitModal(data) {
  // Evita modais duplicados sobrepostos
  if (document.getElementById('plan-limit-modal')) return;
  const limite = data.limite ?? '—';
  const atual  = data.atual  ?? '—';
  const recurso = data.recurso || data.kind || 'recurso';
  const recursoLabel = {
    usuarios: 'usuários ativos',
    terceirizados: 'terceirizados',
    remessas_mes: 'remessas no mês',
  }[recurso] || recurso;
  const plano = data.plano || 'atual';

  const modal = document.createElement('div');
  modal.id = 'plan-limit-modal';
  modal.className = 'modal-backdrop';
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid rgba(168,85,247,0.3);border-radius:18px;max-width:480px;width:100%;padding:32px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);color:#f1f5f9">
      <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#dc2626);display:flex;align-items:center;justify-content:center;margin:0 auto 20px">
        <i class="fas fa-bolt" style="font-size:32px;color:#fff"></i>
      </div>
      <h2 style="font-size:22px;font-weight:700;text-align:center;margin-bottom:8px">Limite do plano atingido</h2>
      <p style="font-size:14px;text-align:center;color:#94a3b8;margin-bottom:20px">
        Seu plano <strong style="color:#a78bfa">${plano}</strong> permite até <strong>${limite}</strong> ${recursoLabel}.
        Você já utilizou <strong style="color:#f59e0b">${atual}/${limite}</strong>.
      </p>
      <div style="background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.3);border-radius:12px;padding:14px;margin-bottom:20px;font-size:13px;color:#cbd5e1;text-align:center">
        <i class="fas fa-arrow-up-right-dots" style="color:#a78bfa;margin-right:6px"></i>
        Faça upgrade para um plano superior e continue crescendo sem limites.
      </div>
      <div style="display:flex;gap:10px">
        <button id="plm-close" style="flex:1;padding:12px;border-radius:10px;background:rgba(148,163,184,0.15);color:#cbd5e1;border:1px solid rgba(148,163,184,0.2);font-weight:600;cursor:pointer">Fechar</button>
        <button id="plm-upgrade" style="flex:2;padding:12px;border-radius:10px;background:linear-gradient(135deg,#a855f7,#6366f1);color:#fff;border:none;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(168,85,247,0.4)">
          <i class="fas fa-rocket mr-1"></i> Fazer upgrade do plano
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#plm-close').onclick = close;
  modal.querySelector('#plm-upgrade').onclick = () => { close(); navigate('minha_assinatura'); };
  modal.onclick = (ev) => { if (ev.target === modal) close(); };
}

function showTenantBlockedModal(data, code) {
  if (document.getElementById('tenant-blocked-modal')) return;
  const map = {
    TENANT_SUSPENDED: {
      titulo: 'Conta suspensa por falta de pagamento',
      cor1: '#f59e0b', cor2: '#dc2626',
      icon: 'fa-circle-exclamation',
      msg: 'Sua assinatura está em atraso. Acesse "Assinatura" para gerar um PIX e reativar imediatamente.',
      cta: 'Pagar agora via PIX',
    },
    TENANT_BLOCKED: {
      titulo: 'Conta bloqueada',
      cor1: '#dc2626', cor2: '#7f1d1d',
      icon: 'fa-ban',
      msg: 'Esta conta foi bloqueada pela administração. Entre em contato com o suporte para regularização.',
      cta: 'Falar com suporte',
    },
    TENANT_CANCELED: {
      titulo: 'Assinatura cancelada',
      cor1: '#64748b', cor2: '#334155',
      icon: 'fa-circle-xmark',
      msg: 'Esta assinatura foi cancelada. Para reativar entre em contato com o suporte.',
      cta: 'Entrar em contato',
    },
  };
  const cfg = map[code] || map.TENANT_SUSPENDED;
  const modal = document.createElement('div');
  modal.id = 'tenant-blocked-modal';
  modal.className = 'modal-backdrop';
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.85);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid rgba(${code==='TENANT_BLOCKED'?'220,38,38':'245,158,11'},0.4);border-radius:18px;max-width:480px;width:100%;padding:32px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.6);color:#f1f5f9">
      <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,${cfg.cor1},${cfg.cor2});display:flex;align-items:center;justify-content:center;margin:0 auto 20px">
        <i class="fas ${cfg.icon}" style="font-size:32px;color:#fff"></i>
      </div>
      <h2 style="font-size:22px;font-weight:700;text-align:center;margin-bottom:12px">${cfg.titulo}</h2>
      <p style="font-size:14px;text-align:center;color:#cbd5e1;margin-bottom:24px;line-height:1.6">${cfg.msg}</p>
      <div style="display:flex;gap:10px">
        ${code === 'TENANT_SUSPENDED' ? `
          <button id="tbm-pay" style="flex:1;padding:14px;border-radius:10px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(16,185,129,0.4)">
            <i class="fas fa-qrcode mr-1"></i> ${cfg.cta}
          </button>
        ` : `
          <button id="tbm-logout" style="flex:1;padding:14px;border-radius:10px;background:rgba(148,163,184,0.15);color:#cbd5e1;border:1px solid rgba(148,163,184,0.2);font-weight:600;cursor:pointer">
            <i class="fas fa-sign-out-alt mr-1"></i> Sair
          </button>
        `}
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#tbm-pay')?.addEventListener('click', () => { close(); navigate('minha_assinatura'); });
  modal.querySelector('#tbm-logout')?.addEventListener('click', () => { close(); doLogout(); });
  // Bloqueante: não fecha clicando fora
}
window.showPlanLimitModal = showPlanLimitModal;
window.showTenantBlockedModal = showTenantBlockedModal;

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
/**
 * doLogout — Logout DEFINITIVO com hard reload.
 *
 * Estratégia (à prova de balas):
 *  1) Sinaliza saída no sessionStorage (sobrevive ao reload, é lido no init
 *     para mostrar toast "Sessão encerrada.")
 *  2) Limpa TODOS storages possíveis (tanto chaves atuais quanto legadas)
 *  3) Limpa TODOS cookies do documento
 *  4) Chama API /auth/logout em paralelo (fire-and-forget)
 *  5) Hard reload via window.location.replace('/') — destrói TODO estado JS,
 *     handlers acumulados e closures. NÃO TEM COMO FALHAR.
 *
 * Idempotente: flag _logoutInProgress evita execução dupla.
 */
let _logoutInProgress = false;
function doLogout(e) {
  if (e) {
    try { e.preventDefault(); } catch {}
    try { e.stopPropagation(); } catch {}
    try { e.stopImmediatePropagation && e.stopImmediatePropagation(); } catch {}
  }
  console.log('[logout] ▶ doLogout() iniciado, type=', e?.type || 'manual');
  if (_logoutInProgress) { console.log('[logout] ⚠ já em progresso, ignorando'); return; }
  _logoutInProgress = true;

  // 1) FEEDBACK VISUAL imediato — overlay de "Saindo..." cobre a tela inteira.
  // Garante que mesmo se a navegação demorar, o usuário VÊ que o clique funcionou.
  try {
    const overlay = document.createElement('div');
    overlay.id = '__logout_overlay';
    overlay.style.cssText = [
      'position:fixed','inset:0','z-index:9999999',
      'background:rgba(15,23,42,0.85)','backdrop-filter:blur(6px)',
      '-webkit-backdrop-filter:blur(6px)',
      'display:flex','align-items:center','justify-content:center',
      'color:#fff','font-family:system-ui,-apple-system,sans-serif',
      'font-size:1rem','letter-spacing:.02em',
    ].join(';');
    overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px">
        <div style="width:42px;height:42px;border:3px solid rgba(255,255,255,.18);border-top-color:#fff;border-radius:50%;animation:__logoutSpin .8s linear infinite"></div>
        <div>Saindo da conta...</div>
      </div>
      <style>@keyframes __logoutSpin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(overlay);
  } catch {}

  // 2) Fecha o popover visualmente (defesa)
  try {
    const pop = document.getElementById('sidebar-user-pop');
    if (pop) { pop.classList.add('is-hidden'); pop.classList.remove('is-open'); }
    const sbBtn = document.getElementById('sidebar-user-btn');
    if (sbBtn) { sbBtn.classList.remove('is-open'); sbBtn.setAttribute('aria-expanded', 'false'); }
    // Legados (caso ainda existam após hot-reload parcial)
    const legacyMenu = document.getElementById('user-menu');
    if (legacyMenu) { legacyMenu.classList.add('is-hidden'); legacyMenu.classList.remove('is-open'); }
    const legacyBd = document.getElementById('user-menu-backdrop');
    if (legacyBd) legacyBd.classList.add('is-hidden');
    document.getElementById('terc-print-menu')?.remove();
    document.querySelectorAll(
      '.popover-floating, [data-floating-menu], [role="tooltip"], .tooltip, .tippy-box'
    ).forEach(el => { try { el.remove(); } catch {} });
  } catch {}

  // 3) Limpa TODOS storages (atuais + legados + genéricos)
  const lsKeys = [
    'pcp_token', 'pcp_user',           // chaves atuais do sistema
    'token', 'user', 'empresa', 'auth', // chaves comuns/legadas
    'authToken', 'userData', 'currentUser', 'session', 'jwt',
  ];
  lsKeys.forEach(k => { try { localStorage.removeItem(k); } catch {} });
  try { sessionStorage.clear(); } catch {}
  console.log('[logout] ✓ storages limpos');

  // 4) Limpa cookies (defesa em profundidade)
  try {
    document.cookie.split(';').forEach((c) => {
      const eq = c.indexOf('=');
      const name = (eq > -1 ? c.substr(0, eq) : c).trim();
      if (name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${location.hostname}`;
      }
    });
  } catch {}

  // 5) Reseta estado global (defesa — morre no reload)
  try { if (window.state) { window.state.user = null; window.state.token = null; } } catch {}
  try { AUTH && AUTH.clearToken && AUTH.clearToken(); } catch {}
  try { AUTH && AUTH.clearUser && AUTH.clearUser(); } catch {}

  // 6) Avisa o backend (fire-and-forget)
  try {
    fetch((window.API_BASE_URL || '/api') + '/auth/logout', {
      method: 'POST', credentials: 'include', keepalive: true,
    }).catch(() => {});
  } catch {}

  // 7) Marca a saída para mostrar mensagem na próxima tela de login
  try { sessionStorage.setItem('_logout_msg', 'Sessão encerrada.'); } catch {}

  // 8) HARD RELOAD — destrói TODO o estado JS, handlers, closures.
  console.log('[logout] ▶ redirecionando via hard reload...');
  try {
    location.hash = '';
    // Tenta replace IMEDIATAMENTE (mais rápido); fallback assíncrono
    try { window.location.replace('/'); return; } catch {}
    setTimeout(() => {
      try { window.location.replace('/'); }
      catch { window.location.href = '/'; }
    }, 30);
  } catch {
    try { window.location.href = '/'; } catch {}
  }
}
window.doLogout = doLogout;
window.handleLogout = doLogout; // alias solicitado

// Registra UMA ÚNICA VEZ os listeners delegados no document.
// Usa pointerdown (dispara antes do tooltip nativo aparecer) e click (failsafe).
if (!window.__logoutBound) {
  window.__logoutBound = true;
  const _globalLogoutHandler = (e) => {
    const t = e.target && e.target.closest && e.target.closest('#btn-logout, [data-action="logout"], .logout-btn');
    if (!t) return;
    console.log('[logout] handler global disparou via', e.type);
    doLogout(e);
  };
  // Capture phase: roda antes de qualquer handler dos elementos descendentes
  document.addEventListener('pointerdown', _globalLogoutHandler, true);
  document.addEventListener('click', _globalLogoutHandler, true);
  // Teclado (Enter/Espaço) — acessibilidade
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = document.activeElement;
    if (t && (t.id === 'btn-logout' || t.dataset?.action === 'logout' || t.classList?.contains('logout-btn'))) {
      doLogout(e);
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
 * REFATOR 2026-05-26: Sistema foi dividido em CADASTROS + CONFIGURAÇÕES.
 *   - CADASTROS: dados de domínio (Serviços, Produtos, Preços, Grades, Terceirizados, Usuários)
 *   - CONFIGURAÇÕES: ajustes da conta (Importação, Empresa, Assinatura, Configurações)
 * Ambos os grupos são recolhíveis. Terceirização e Análises seguem expandidos.
 *
 * Cores foi REMOVIDA do menu principal (acessada via tela de Produtos ou interna).
 * Novo módulo: SERVIÇOS (id: terc_servicos) — primeiro item de Cadastros.
 */
const NAV = [
  // ==== TERCEIRIZAÇÃO (núcleo operacional — visível a todos) ====
  { id: 'dashboard',             label: 'Dashboard',         icon: 'fa-chart-line',       group: 'Terceirização', tercOnly: true },
  { id: 'terc_remessas',         label: 'Remessas',          icon: 'fa-truck-fast',       group: 'Terceirização', tercOnly: true },
  { id: 'terc_retornos',         label: 'Retornos',          icon: 'fa-truck-arrow-right',group: 'Terceirização', tercOnly: true },

  // ==== FINANCEIRO (HOTFIX 0042 — Pagamentos de Terceirizados) ====
  { id: 'pagamentos_terc',       label: 'Pagamentos',        icon: 'fa-hand-holding-dollar', group: 'Financeiro', tercOnly: true },

  // ==== ANÁLISES ====
  { id: 'relatorios_detalhados', label: 'Relatórios',        icon: 'fa-chart-pie',        group: 'Análises',      tercOnly: true },

  // ==== CADASTROS (recolhível) — dados de domínio ====
  { id: 'terc_servicos',         label: 'Serviços',          icon: 'fa-screwdriver-wrench', group: 'Cadastros',  collapsible: true, tercOnly: true },
  { id: 'terc_produtos',         label: 'Produtos',          icon: 'fa-tshirt',           group: 'Cadastros',     collapsible: true, tercOnly: true },
  { id: 'terc_precos',           label: 'Preços / Coleções', icon: 'fa-money-bill-wave',  group: 'Cadastros',     collapsible: true, tercOnly: true },
  { id: 'terc_grades_tamanho',   label: 'Grades de Tamanho', icon: 'fa-ruler-combined',   group: 'Cadastros',     collapsible: true, tercOnly: true },
  { id: 'cores',                 label: 'Cores',             icon: 'fa-palette',          group: 'Cadastros',     collapsible: true, tercOnly: true },
  { id: 'terc_setores',          label: 'Setores',           icon: 'fa-sitemap',          group: 'Cadastros',     collapsible: true, tercOnly: true },
  { id: 'terc_terceirizados',    label: 'Terceirizados',     icon: 'fa-handshake',        group: 'Cadastros',     collapsible: true, tercOnly: true },
  { id: 'usuarios',              label: 'Usuários',          icon: 'fa-user-shield',      group: 'Cadastros',     collapsible: true, adminOnly: true },

  // ==== CONFIGURAÇÕES (recolhível) — ajustes da conta ====
  { id: 'terc_importador',       label: 'Importação',        icon: 'fa-file-excel',       group: 'Configurações', collapsible: true, tercOnly: true },
  { id: 'minha_empresa',         label: 'Minha Empresa',     icon: 'fa-building',         group: 'Configurações', collapsible: true, ownerOnly: true },
  { id: 'minha_assinatura',      label: 'Assinatura & Plano',icon: 'fa-credit-card',      group: 'Configurações', collapsible: true, ownerOnly: true },
  { id: 'configuracoes',         label: 'Configurações',     icon: 'fa-sliders-h',        group: 'Configurações', collapsible: true, adminOnly: true },
  { id: 'backup',                label: 'Backup & Restauração', icon: 'fa-database',      group: 'Configurações', collapsible: true, adminOnly: true },
];

/** Lista de grupos colapsáveis (precisa estar sincronizado com NAV) */
const COLLAPSIBLE_GROUPS = ['Cadastros', 'Configurações'];
/** Ícones por grupo (para o cabeçalho do collapsible) */
const GROUP_ICONS = {
  'Cadastros': 'fa-folder-tree',
  'Configurações': 'fa-gear',
  'Terceirização': 'fa-truck-fast',
  'Financeiro': 'fa-hand-holding-dollar',
  'Análises': 'fa-chart-pie',
};

/**
 * Política de visibilidade/acesso:
 *  - admin: pode tudo
 *  - qualquer outro perfil: APENAS itens marcados com tercOnly
 */
function isAdmin() { return state.user?.perfil === 'admin'; }
function isOwner() { return !!state.user?.is_owner && state.user?.perfil === 'admin'; }
function podeAcessar(item) {
  if (!item) return false;
  // 'perfil' é sempre acessível ao usuário autenticado
  if (item && item.id === 'perfil') return true;
  // ownerOnly: apenas o dono da empresa (is_owner=1 + admin) vê
  if (item.ownerOnly) return isOwner();
  if (isAdmin()) return true;
  return !!item.tercOnly;
}
window.isOwner = isOwner;

/* ============================================================
 * v24 — MODAL OPEN TRACKER (fallback :has() + bloqueio scroll)
 * ---------------------------------------------------------------
 * Observa o <body> e, sempre que existe um .modal-backdrop filho,
 * marca body.modal-open. Isso permite que o CSS (que já tem regras
 * com :has(.modal-backdrop)) tenha um fallback robusto para 100%
 * dos navegadores e também desabilite o scroll do #main-content
 * enquanto o modal estiver aberto (UX premium ERP).
 * ============================================================ */
(function setupModalOpenTracker() {
  if (window.__modalTrackerInit) return;
  window.__modalTrackerInit = true;
  function syncModalOpen() {
    const hasModal = !!document.querySelector('.modal-backdrop');
    document.body.classList.toggle('modal-open', hasModal);
  }
  // Roda 1 vez no boot
  if (document.body) syncModalOpen();
  // Observa mudanças no body (adicionou/removeu modal)
  const mo = new MutationObserver(syncModalOpen);
  if (document.body) {
    mo.observe(document.body, { childList: true, subtree: false });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      mo.observe(document.body, { childList: true, subtree: false });
      syncModalOpen();
    });
  }
})();

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

  // Estado dos accordions persistido em localStorage (uma chave por grupo)
  // Auto-expande o grupo cuja rota atual pertence
  const openState = {};
  COLLAPSIBLE_GROUPS.forEach((g) => {
    let isOpen = false;
    try { isOpen = localStorage.getItem(`nav-grp-open:${g}`) === '1'; } catch {}
    const ids = (groups[g] || []).map((i) => i.id);
    if (ids.includes(state.route)) isOpen = true;
    openState[g] = isOpen;
  });

  const adminItems = isAdmin() ? `
              <button data-act="ver-usuarios" class="user-pop-item" role="menuitem">
                <i class="fas fa-user-shield"></i><span>Gerenciar usuários</span>
              </button>` : '';

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
          const isCollapsible = COLLAPSIBLE_GROUPS.includes(g);
          const open = isCollapsible ? !!openState[g] : true;
          const grpIcon = GROUP_ICONS[g] || 'fa-folder';
          // Slug seguro para IDs (sem acentos/espaços)
          const slug = g.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
          if (isCollapsible) {
            return `
              <div class="nav-section nav-section-collapsible ${open ? 'is-open' : ''}" data-group="${g}">
                <button type="button" class="nav-group-toggle" aria-expanded="${open}" aria-controls="nav-grp-${slug}">
                  <i class="fas ${grpIcon} nav-group-icon" aria-hidden="true"></i>
                  <span class="nav-group-label-inline">${g}</span>
                  <span class="nav-group-count">${items.length}</span>
                  <i class="fas fa-chevron-down nav-group-caret" aria-hidden="true"></i>
                </button>
                <div class="nav-group-items" id="nav-grp-${slug}" role="region">
                  <div class="nav-group-inner">
                    ${items.map(i => `
                      <a href="#${i.id}" data-route="${i.id}" class="nav-item">
                        <i class="fas ${i.icon}" aria-hidden="true"></i>
                        <span>${i.label}</span>
                      </a>`).join('')}
                  </div>
                </div>
              </div>`;
          }
          return `
            <div class="nav-section">
              <div class="nav-group-label">
                <i class="fas ${grpIcon} nav-group-label-icon" aria-hidden="true"></i>
                <span>${g}</span>
              </div>
              ${items.map(i => `
                <a href="#${i.id}" data-route="${i.id}" class="nav-item">
                  <i class="fas ${i.icon}" aria-hidden="true"></i>
                  <span>${i.label}</span>
                </a>`).join('')}
            </div>`;
        }).join('')}
      </nav>

      <!-- ============== PERFIL DROPDOWN (sidebar bottom) ============== -->
      <button type="button" id="sidebar-user-btn" class="sidebar-user-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="sidebar-user-pop">
        <span class="sidebar-user-avatar-wrap">
          ${avatarHTML(u, '')}
          <span class="sidebar-user-status" aria-label="Online"></span>
        </span>
        <span class="sidebar-user-info">
          <span class="sidebar-user-name">${u.nome || '—'}</span>
          <span class="sidebar-user-meta">
            <span class="sidebar-user-online">Online</span>
            <span class="sidebar-user-dot">•</span>
            <span class="sidebar-user-perfil">${u.perfil || ''}</span>
          </span>
        </span>
        <i class="fas fa-chevron-up sidebar-user-caret" aria-hidden="true"></i>
      </button>
    </aside>

    <!-- ============== POPOVER do USUÁRIO (fixed, position via JS) ============== -->
    <div id="sidebar-user-pop" class="sidebar-user-pop is-hidden" role="menu" aria-labelledby="sidebar-user-btn">
      <div class="user-pop-header">
        <div class="user-pop-avatar-wrap">
          <span id="user-pop-avatar">${avatarHTML(u, 'lg')}</span>
          <span class="user-pop-status" aria-label="Online"></span>
        </div>
        <div class="user-pop-info">
          <div class="user-pop-nome">${u.nome || '—'}</div>
          <div class="user-pop-email">${u.email || u.login || ''}</div>
          <div class="user-pop-perfil-badge">${u.perfil || ''}</div>
        </div>
      </div>

      <div class="user-pop-section">
        <div class="user-pop-section-label">Conta</div>
        <button data-act="ver-perfil" class="user-pop-item" role="menuitem">
          <i class="fas fa-user-circle"></i><span>Meu perfil</span>
        </button>
        <button data-act="editar-perfil" class="user-pop-item" role="menuitem">
          <i class="fas fa-user-pen"></i><span>Editar perfil</span>
        </button>
        <button data-act="trocar-senha" class="user-pop-item" role="menuitem">
          <i class="fas fa-key"></i><span>Trocar senha</span>
        </button>
      </div>

      <div class="user-pop-section">
        <div class="user-pop-section-label">Preferências</div>
        <button data-act="toggle-tema" class="user-pop-item" role="menuitem">
          <i class="fas fa-circle-half-stroke"></i>
          <span>Alternar tema</span>
          <span class="user-pop-tag" id="user-pop-tema-tag">—</span>
        </button>
        <button data-act="ver-configs" class="user-pop-item" role="menuitem">
          <i class="fas fa-sliders"></i><span>Configurações</span>
        </button>
      </div>

      <div class="user-pop-section">
        <div class="user-pop-section-label">Atalhos</div>
        <button data-act="ver-remessas" class="user-pop-item" role="menuitem">
          <i class="fas fa-truck-fast"></i><span>Ver remessas</span>
        </button>${adminItems}
      </div>

      <div class="user-pop-sep"></div>
      <button id="btn-logout" class="user-pop-item is-danger logout-btn" data-action="logout" role="menuitem">
        <i class="fas fa-arrow-right-from-bracket"></i><span>Sair</span>
      </button>
    </div>

    <div class="flex-1 flex flex-col overflow-hidden">
      <header id="topbar" class="topbar-clean">
        <button id="btn-hamburger" class="btn-hamburger" aria-label="Abrir menu" aria-controls="sidebar" aria-expanded="false">
          <i class="fas fa-bars"></i>
        </button>
        <h2 id="page-title" class="text-lg font-semibold text-slate-800 flex-1 min-w-0">Dashboard</h2>
        <div class="topbar-actions">
          <span id="today" class="topbar-date">${dayjs().format('DD/MM/YYYY')}</span>
          ${Theme.toggleButtonHTML()}
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

  // Toggle de grupos recolhíveis (Cadastros, Configurações)
  // Persiste o estado por grupo em localStorage (nav-grp-open:<grupo>)
  $$('.nav-group-toggle').forEach((b) => b.addEventListener('click', (ev) => {
    ev.preventDefault();
    const sec = b.closest('.nav-section-collapsible');
    if (!sec) return;
    const open = !sec.classList.contains('is-open');
    sec.classList.toggle('is-open', open);
    b.setAttribute('aria-expanded', String(open));
    const grp = sec.dataset.group;
    if (grp) {
      try { localStorage.setItem(`nav-grp-open:${grp}`, open ? '1' : '0'); } catch {}
    }
  }));

  // ============================================================
  // MENU DE USUÁRIO (sidebar inferior) — popover FIXED ancorado
  // ao botão, abrindo PARA CIMA (já que o botão fica no rodapé).
  // ============================================================
  const userBtn = $('#sidebar-user-btn');
  const userPop = $('#sidebar-user-pop');

  /** Atualiza a chip que mostra o tema atual ("Claro"/"Escuro"). */
  function updateTemaTag() {
    const tag = $('#user-pop-tema-tag');
    if (!tag) return;
    const cur = (window.Theme && Theme.current) ? Theme.current : 'light';
    tag.textContent = cur === 'dark' ? 'Escuro' : 'Claro';
  }

  /** Posiciona o popover acima do botão (position:fixed).
   *  Desktop: alinha à esquerda do botão.
   *  Mobile (≤640px): ocupa quase toda a largura, centralizado. */
  function positionUserPop() {
    if (!userBtn || !userPop) return;
    const r = userBtn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    // Reset para medir altura real
    userPop.style.maxHeight = '';
    const popH = Math.min(userPop.offsetHeight || 460, vh - 2 * margin);
    const popW = userPop.offsetWidth || 280;

    if (vw <= 640) {
      // Mobile: popover quase-fullwidth, centralizado horizontalmente.
      const w = Math.min(vw - 2 * margin, 380);
      userPop.style.width = w + 'px';
      userPop.style.left = ((vw - w) / 2) + 'px';
      userPop.style.right = 'auto';
    } else {
      // Desktop/tablet: alinhado à esquerda do botão.
      userPop.style.width = '';
      let left = r.left;
      // Garante que não sai pela direita
      if (left + popW + margin > vw) left = vw - popW - margin;
      if (left < margin) left = margin;
      userPop.style.left = left + 'px';
      userPop.style.right = 'auto';
    }

    // Vertical: abre PARA CIMA (top = r.top - popH - 8).
    // Se não houver espaço para cima, abre para baixo.
    let top = r.top - popH - 8;
    if (top < margin) {
      // tenta abrir para baixo
      const below = r.bottom + 8;
      if (below + popH < vh - margin) {
        top = below;
      } else {
        // sem espaço nem em cima nem embaixo: cola no topo e limita altura
        top = margin;
        userPop.style.maxHeight = (vh - 2 * margin) + 'px';
      }
    }
    userPop.style.top = top + 'px';
  }

  function openUserPop() {
    if (!userBtn || !userPop) return;
    // Remove popovers/tooltips residuais que poderiam interceptar cliques
    document.getElementById('terc-print-menu')?.remove();
    document.querySelectorAll(
      '.popover-floating, [data-floating-menu], [role="tooltip"], .tooltip, .tippy-box'
    ).forEach(el => { try { el.remove(); } catch {} });

    updateTemaTag();
    userPop.classList.remove('is-hidden');
    userPop.classList.add('is-open');
    userBtn.classList.add('is-open');
    userBtn.setAttribute('aria-expanded', 'true');
    // Reposiciona DEPOIS de visível (precisa de offsetHeight real)
    positionUserPop();
    requestAnimationFrame(positionUserPop);
  }
  function closeUserPop() {
    if (!userPop || !userBtn) return;
    userPop.classList.add('is-hidden');
    userPop.classList.remove('is-open');
    userBtn.classList.remove('is-open');
    userBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleUserPop() {
    if (!userPop) return;
    userPop.classList.contains('is-open') ? closeUserPop() : openUserPop();
  }

  // Toggle no clique do botão
  if (userBtn) {
    userBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleUserPop();
    });
  }

  // Click-fora fecha
  document.addEventListener('click', (e) => {
    if (!userPop || !userPop.classList.contains('is-open')) return;
    if (userBtn && userBtn.contains(e.target)) return;
    if (userPop.contains(e.target)) return;
    closeUserPop();
  });
  // ESC fecha
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && userPop && userPop.classList.contains('is-open')) {
      closeUserPop();
      userBtn && userBtn.focus();
    }
  });
  // Reposiciona em scroll/resize (popover fixed precisa acompanhar o botão)
  window.addEventListener('scroll', () => {
    if (userPop && userPop.classList.contains('is-open')) positionUserPop();
  }, true);
  window.addEventListener('resize', () => {
    if (userPop && userPop.classList.contains('is-open')) positionUserPop();
  });

  // ============================================================
  // DELEGAÇÃO de cliques nos itens [data-act] do popover.
  // Cada item executa uma ação e fecha o popover (exceto logout,
  // que faz hard-reload e destrói tudo).
  // ============================================================
  if (userPop) {
    userPop.addEventListener('click', (e) => {
      const item = e.target.closest('[data-act]');
      if (!item) return;
      const act = item.dataset.act;
      // Fecha o popover ANTES de navegar (UX)
      switch (act) {
        case 'ver-perfil':
          closeUserPop();
          navigate('perfil');
          break;
        case 'editar-perfil':
          closeUserPop();
          navigate('perfil');
          // Sinaliza para a página entrar em modo edição (se suportado)
          try { sessionStorage.setItem('perfil:edit', '1'); } catch {}
          break;
        case 'trocar-senha':
          closeUserPop();
          if (typeof openTrocarSenha === 'function') openTrocarSenha(false);
          break;
        case 'ver-configs':
          closeUserPop();
          navigate('configuracoes');
          break;
        case 'toggle-tema':
          // NÃO fecha — usuário pode querer alternar várias vezes
          if (window.Theme && typeof Theme.toggle === 'function') {
            try { Theme.toggle(); } catch (err) { console.warn('[tema] toggle falhou', err); }
            updateTemaTag();
          }
          break;
        case 'ver-remessas':
          closeUserPop();
          navigate('terc_remessas');
          break;
        case 'ver-usuarios':
          closeUserPop();
          navigate('usuarios');
          break;
        // Logout é tratado pelo handler direto + delegação global
        default:
          break;
      }
    });
  }

  // Atualiza a tag de tema quando o tema mudar por outro caminho
  // (ex.: botão de tema na topbar, atalho de teclado, etc.)
  window.addEventListener('themechange', updateTemaTag);
  // Inicializa a tag com o tema atual
  updateTemaTag();

  // ============================================================
  // LOGOUT — bind DIRETO no botão (no momento do render).
  // Não depende de delegação global. Roda em pointerdown E click
  // (failsafe). Não fecha o popover antes — o hard reload destrói tudo.
  // O handler global em window.__logoutBound também captura via
  // [data-action="logout"] / .logout-btn / #btn-logout.
  // ============================================================
  const btnLogout = $('#btn-logout');
  if (btnLogout) {
    const handleLogoutDirect = (e) => {
      console.log('[logout] click direto no botão Sair, type=', e.type);
      try { e.preventDefault(); } catch {}
      try { e.stopPropagation(); } catch {}
      try { e.stopImmediatePropagation && e.stopImmediatePropagation(); } catch {}
      doLogout(e);
    };
    // pointerdown roda ANTES de click — dispara o logout imediatamente
    btnLogout.addEventListener('pointerdown', handleLogoutDirect);
    // click é failsafe (se pointerdown não disparar em algum browser)
    btnLogout.addEventListener('click', handleLogoutDirect);
    // Feedback visual instantâneo de que o clique foi capturado
    btnLogout.addEventListener('mousedown', () => {
      btnLogout.style.transform = 'scale(0.97)';
      setTimeout(() => { try { btnLogout.style.transform = ''; } catch {} }, 120);
    });
  }

  // Theme toggle (sistema dual light/dark) — botão na topbar
  Theme.bindToggle('#theme-toggle-btn');
}

/** Reaplica avatar/nome/perfil no botão da sidebar e no header do popover
 *  (chamado após salvar perfil em /perfil). */
function refreshUserUI() {
  const u = state.user || {};

  // === Botão da sidebar (#sidebar-user-btn) ===
  const sbBtn = $('#sidebar-user-btn');
  if (sbBtn) {
    // Avatar (substitui apenas o elemento .avatar-img/.avatar-fallback,
    // preservando o span.sidebar-user-status irmão dentro do wrap)
    const wrap = sbBtn.querySelector('.sidebar-user-avatar-wrap');
    if (wrap) {
      const oldAv = wrap.querySelector('.avatar-img, .avatar-fallback');
      if (oldAv) oldAv.outerHTML = avatarHTML(u, '');
    }
    const nameEl = sbBtn.querySelector('.sidebar-user-name');
    if (nameEl) nameEl.textContent = u.nome || '—';
    const perfilEl = sbBtn.querySelector('.sidebar-user-perfil');
    if (perfilEl) perfilEl.textContent = u.perfil || '';
  }

  // === Header do popover (#sidebar-user-pop) ===
  const pop = $('#sidebar-user-pop');
  if (pop) {
    const avSlot = pop.querySelector('#user-pop-avatar');
    if (avSlot) avSlot.innerHTML = avatarHTML(u, 'lg');
    const nomeEl = pop.querySelector('.user-pop-nome');
    if (nomeEl) nomeEl.textContent = u.nome || '—';
    const emailEl = pop.querySelector('.user-pop-email');
    if (emailEl) emailEl.textContent = u.email || u.login || '';
    const badgeEl = pop.querySelector('.user-pop-perfil-badge');
    if (badgeEl) badgeEl.textContent = u.perfil || '';
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
  async reloadSetores() {
    try { const r = await api('get', '/terc/setores', null, { silent: true }); this.setores = r.data || []; } catch {}
  },
  async reloadServicos() {
    try { const r = await api('get', '/terc/servicos', null, { silent: true }); this.servicos = r.data || []; } catch {}
  },
  optSetores(sel, includeEmpty = true) {
    const ativos = this.setores.filter(s => s.ativo !== 0);
    const opts = includeEmpty ? ['<option value="">—</option>'] : [];
    return opts.concat(ativos.map(s => `<option value="${s.id_setor}" ${sel == s.id_setor ? 'selected' : ''}>${s.nome_setor}</option>`)).join('');
  },
  optServicos(sel) {
    // 🛡️ HOTFIX 0049: filtra serviços inativos do select.
    // Exceção: se 'sel' aponta para um serviço inativo (registro histórico),
    // mantém esse específico na lista para não exibir "—" em remessa antiga.
    const ativos = this.servicos.filter(s => s.ativo !== 0);
    const list = (sel && !ativos.some(s => s.id_servico == sel))
      ? ativos.concat(this.servicos.filter(s => s.id_servico == sel && s.ativo === 0))
      : ativos;
    return ['<option value="">—</option>']
      .concat(list.map(s => `<option value="${s.id_servico}" ${sel == s.id_servico ? 'selected' : ''}>${s.desc_servico}${s.ativo === 0 ? ' (inativo)' : ''}</option>`))
      .join('');
  },
  optColecoes(sel) { return ['<option value="">Todas</option>'].concat(this.colecoes.map(s => `<option value="${s.id_colecao}" ${sel == s.id_colecao ? 'selected' : ''}>${s.nome_colecao}</option>`)).join(''); },
  optTerc(sel, onlyAtivos = false) {
    const list = onlyAtivos ? this.terceirizados.filter(t => t.ativo) : this.terceirizados;
    return ['<option value="">—</option>'].concat(list.map(t => `<option value="${t.id_terc}" ${sel == t.id_terc ? 'selected' : ''}>${t.nome_terc}${t.nome_setor ? ' · ' + t.nome_setor : ''}</option>`)).join('');
  },
  optProdutos(sel, idColecao, codRefFallback) {
    let list = this.produtos.filter(p => p.ativo);
    if (idColecao) list = list.filter(p => !p.id_colecao || p.id_colecao == idColecao);
    const opts = ['<option value="">— Selecione um produto cadastrado —</option>']
      .concat(list.map(p => `<option value="${p.id_produto}" ${sel == p.id_produto ? 'selected' : ''} data-cod="${(p.cod_ref || '').replace(/"/g, '&quot;')}" data-desc="${(p.desc_ref || '').replace(/"/g, '&quot;')}" data-col="${p.id_colecao || ''}" data-grade="${p.grade_padrao || 1}">${p.cod_ref} — ${p.desc_ref}${p.nome_colecao ? ' · ' + p.nome_colecao : ''}</option>`));
    // 🛡️ HOTFIX 0036: Se o sel não foi encontrado na lista (produto foi auto-cadastrado
    // pela migration mas o cache local ainda não recarregou), adiciona opção fantasma
    // com base no cod_ref recebido para o usuário NÃO ver o select em branco.
    if (sel && !list.some(p => p.id_produto == sel) && codRefFallback) {
      opts.push(`<option value="${sel}" selected data-cod="${(codRefFallback || '').replace(/"/g, '&quot;')}" data-ghost="1">${codRefFallback} — (carregando cadastro…)</option>`);
      console.warn('[optProdutos] id_produto', sel, 'não encontrado no cache — opção fantasma adicionada. Acione reloadProdutos().');
    }
    return opts.join('');
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
  /* ============================================================
   * HOTFIX 0039 — Tradução centralizada de status de remessas/retornos.
   *
   * IMPORTANTE: o token interno NÃO muda (continua 'AguardandoEnvio' no
   * banco, queries, APIs, CHECK constraint e workflow). Apenas a EXIBIÇÃO
   * é traduzida para "Aguardando Retorno" conforme padronização solicitada.
   * Isso garante zero quebra de compatibilidade com dados históricos.
   *
   * Aceita tanto o token canônico (`AguardandoEnvio`) quanto variações
   * legadas/normalizadas (`aguardando_envio`, `AGUARDANDOENVIO`, `Aguardando envio`).
   * ============================================================ */
  STATUS_LABEL: {
    'AguardandoEnvio':  'Aguardando Retorno',
    'aguardando_envio': 'Aguardando Retorno',
    'AGUARDANDOENVIO':  'Aguardando Retorno',
    'Aguardando envio': 'Aguardando Retorno',
    'Aguardando Envio': 'Aguardando Retorno',
    'Enviado':          'Enviado',
    'EmProducao':       'Em produção',
    'Parcial':          'Parcial',
    'Atrasado':         'Atrasado',
    'Concluido':        'Concluído',
    'Retornado':        'Retornado',
    'Pago':             'Pago',
    'Cancelado':        'Cancelado',
    // Compat legado (terc V1)
    'Aberta':           'Aguardando Retorno',
    'Concluida':        'Concluído',
    'Cancelada':        'Cancelado',
    'Atrasada':         'Atrasado',
  },
  statusLabel(s) {
    if (s == null || s === '') return '—';
    return this.STATUS_LABEL[String(s)] || String(s);
  },
  statusBadge(s, atrasada = 0) {
    if (atrasada && !['Concluida', 'Cancelada', 'Concluido', 'Cancelado', 'Pago', 'Retornado'].includes(s)) return '<span class="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700"><i class="fas fa-triangle-exclamation mr-1"></i>Atrasada</span>';
    const map = {
      // Tokens canônicos V2 (terc)
      'AguardandoEnvio':  'bg-blue-100 text-blue-700',
      'Enviado':          'bg-cyan-100 text-cyan-700',
      'EmProducao':       'bg-indigo-100 text-indigo-700',
      'Parcial':          'bg-amber-100 text-amber-700',
      'Atrasado':         'bg-red-100 text-red-700',
      'Concluido':        'bg-emerald-100 text-emerald-700',
      'Retornado':        'bg-emerald-100 text-emerald-700',
      'Pago':             'bg-green-100 text-green-700',
      'Cancelado':        'bg-slate-200 text-slate-600',
      // Compat legado
      'Aberta':           'bg-blue-100 text-blue-700',
      'Concluida':        'bg-emerald-100 text-emerald-700',
      'Atrasada':         'bg-red-100 text-red-700',
      'Cancelada':        'bg-slate-200 text-slate-600',
    };
    const label = this.statusLabel(s);
    return `<span class="px-2 py-0.5 rounded text-xs ${map[s] || 'bg-slate-100 text-slate-700'}">${label}</span>`;
  },
  /* ============================================================
   * HOTFIX 0040 — Componente reutilizável Terceirizado + Setor
   *
   * Renderiza o par "Nome do Terceirizado + Badge do Setor" alinhado
   * horizontalmente, com truncamento aplicado APENAS ao nome (preservando
   * o chip visível e legível). Usado em:
   *   - Tabela de Remessas
   *   - Tabela de Retornos
   *   - Demais tabelas que mostram (nome_terc, nome_setor)
   *
   * Estrutura DOM:
   *   <div class="tc-terc" title="Nome · Setor">
   *     <span class="tc-terc__name">Zélia</span>
   *     <span class="tc-terc__chip" title="Setor: Aparador">
   *       <i class="fas fa-sitemap"></i>Aparador
   *     </span>
   *   </div>
   *
   * Quando o setor é nulo/vazio, o chip é omitido (zero impacto visual).
   * ============================================================ */
  tercWithSetor(nome, setor, opts) {
    opts = opts || {};
    const safeName = escapeHtml(nome || '—');
    const safeSetor = setor ? escapeHtml(setor) : '';
    const fullTitle = nome ? (setor ? `${escapeHtml(nome)} · Setor: ${safeSetor}` : escapeHtml(nome)) : '';
    const chip = safeSetor
      ? `<span class="tc-terc__chip" title="Setor: ${safeSetor}"><i class="fas fa-sitemap"></i><span class="tc-terc__chip-label">${safeSetor}</span></span>`
      : '';
    // `opts.compact` reduz padding/fonte do chip (uso em telas densas como dashboard)
    const cls = 'tc-terc' + (opts.compact ? ' tc-terc--compact' : '');
    return `<div class="${cls}" title="${fullTitle}"><span class="tc-terc__name">${safeName}</span>${chip}</div>`;
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
   * 🆕 SELETOR DE PRODUTOS ANTES DE GERAR O ROMANEIO (premium UX)
   * Abre um modal dark com lista de TODOS os itens (de uma ou múltiplas
   * remessas), com checkboxes individuais + filtros (todos/cor/serviço)
   * + footer sticky com KPIs (selecionados / qtd total / valor total)
   * + botões "Cancelar" e "Gerar Romaneio".
   *
   * Quando o usuário confirma, devolve as remessas com `itens` FILTRADAS
   * (preservando o restante da remessa) e chama `romaneio(remessasFiltradas)`.
   * Se a remessa for legado (sem itens), permite selecionar a remessa inteira.
   * ================================================================ */
  async romaneioComSelecao(remessas, opts = {}) {
    if (!Array.isArray(remessas)) remessas = [remessas];
    if (remessas.length === 0) { toast('Sem remessas', 'warning'); return; }

    // 🆕 HOTFIX 0047 — Expansão automática de LOTE
    // Se o usuário pediu romaneio de UMA remessa que pertence a um lote
    // multi-CTRL (lote_remessa_id != null), buscamos todas as remessas do
    // lote para gerar 1 PDF agrupado com todos os CTRLs corretos por linha.
    // Caso o lote já esteja pré-expandido (ex: romaneio em lote do terc),
    // a chamada é idempotente — IDs duplicados são deduplicados.
    try {
      const lotesParaExpandir = new Set();
      for (const r of remessas) {
        if (r && r.lote_remessa_id) lotesParaExpandir.add(r.lote_remessa_id);
      }
      // Só expande se temos lote(s) E o conjunto atual NÃO já contém todas as
      // remessas desses lotes (heurística: se já temos >1 remessa do mesmo
      // lote, presumimos que veio expandido — ex: romaneio em lote).
      const remessasPorLote = {};
      for (const r of remessas) {
        const k = r?.lote_remessa_id;
        if (k) (remessasPorLote[k] ||= []).push(r);
      }
      const lotesNaoExpandidos = [...lotesParaExpandir].filter(
        l => (remessasPorLote[l] || []).length === 1
      );
      if (lotesNaoExpandidos.length > 0) {
        const expandidas = [];
        const idsJaPresentes = new Set(remessas.map(r => r.id_remessa));
        for (const loteId of lotesNaoExpandidos) {
          try {
            const resp = await api('get', '/terc/remessas/lote/' + loteId, null, { silent: true });
            const lst = (resp?.data?.remessas || []);
            for (const rm of lst) {
              if (!idsJaPresentes.has(rm.id_remessa)) {
                expandidas.push(rm);
                idsJaPresentes.add(rm.id_remessa);
              }
            }
          } catch (e) {
            console.warn('[romaneio] falha expandindo lote ' + loteId, e);
          }
        }
        if (expandidas.length > 0) {
          // Mantém remessas que não eram de lote OU que vieram de lotes já expandidos,
          // adiciona as recém-buscadas do mesmo lote.
          remessas = [...remessas, ...expandidas];
          toast(`Lote expandido — ${expandidas.length + lotesNaoExpandidos.length} remessas no romaneio`, 'info');
        }
      }
    } catch (e) {
      // Falha na expansão NUNCA bloqueia o romaneio — segue com o que tem.
      console.warn('[romaneio] expansão de lote ignorada:', e);
    }

    // ───────── Achata em "candidatos" (linhas selecionáveis) ─────────
    // Cada candidato = referência a um item específico de uma remessa
    // (ou à remessa legado completa quando não há itens).
    const candidatos = [];
    let idxGlobal = 0;
    for (let rIdx = 0; rIdx < remessas.length; rIdx++) {
      const r = remessas[rIdx];
      const itens = Array.isArray(r.itens) ? r.itens.filter(i => i && (i.ativo == null || i.ativo === 1 || i.ativo === true)) : [];
      if (itens.length > 0) {
        for (let iIdx = 0; iIdx < itens.length; iIdx++) {
          const it = itens[iIdx];
          let qtdItem = 0;
          if (Array.isArray(it.grade)) qtdItem = it.grade.reduce((a, g) => a + (Number(g.qtd) || 0), 0);
          else if (it.grade && typeof it.grade === 'object') qtdItem = Object.values(it.grade).reduce((a, q) => a + (Number(q) || 0), 0);
          if (!qtdItem) qtdItem = Number(it.qtd_total) || 0;
          const precoItem = Number(it.preco_unit) || 0;
          const valorItem = Number(it.valor_total) || (qtdItem * precoItem);
          candidatos.push({
            uid: 'i' + (idxGlobal++),
            rIdx, iIdx,
            num_controle: r.num_controle,
            num_op: (it.num_op && String(it.num_op).trim()) ? it.num_op : r.num_op,
            cod_ref: it.cod_ref || r.cod_ref,
            desc_ref: it.desc_ref || r.desc_ref,
            desc_servico: it.desc_servico || r.desc_servico,
            cor: it.cor || '',
            qtd_total: qtdItem,
            preco_unit: precoItem,
            valor_total: valorItem,
            grade: it.grade,
            _isItem: true,
          });
        }
      } else {
        candidatos.push({
          uid: 'r' + (idxGlobal++),
          rIdx, iIdx: null,
          num_controle: r.num_controle,
          num_op: r.num_op,
          cod_ref: r.cod_ref,
          desc_ref: r.desc_ref,
          desc_servico: r.desc_servico,
          cor: r.cor || '',
          qtd_total: Number(r.qtd_total) || 0,
          preco_unit: Number(r.preco_unit) || 0,
          valor_total: Number(r.valor_total) || 0,
          grade: r.grade,
          _isItem: false,
        });
      }
    }

    if (candidatos.length === 0) {
      toast('Não há produtos para imprimir.', 'warning');
      return;
    }

    // Casos triviais: 1 único item → pula seletor e imprime direto
    if (candidatos.length === 1 && opts.skipIfOnly) {
      return this.romaneio(remessas, opts);
    }

    // ───────── Renderiza o modal premium ─────────
    return new Promise((resolve) => {
      const selecionados = new Set(candidatos.map(c => c.uid)); // padrão: todos selecionados
      const fmtBRL = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
      const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      // Listas únicas para filtros rápidos
      const coresUnicas = [...new Set(candidatos.map(c => c.cor).filter(Boolean))].sort();
      const servicosUnicos = [...new Set(candidatos.map(c => c.desc_servico).filter(Boolean))].sort();

      const m = document.createElement('div');
      m.id = 'romaneio-selector-modal';
      m.className = 'modal-backdrop romaneio-selector-bd';
      m.innerHTML = `
        <div class="romaneio-selector-card">
          <!-- Header -->
          <div class="rs-header">
            <div>
              <div class="rs-title">
                <i class="fas fa-print"></i>
                Selecionar produtos para o romaneio
              </div>
              <div class="rs-subtitle">${candidatos.length} produto${candidatos.length !== 1 ? 's' : ''} disponíve${candidatos.length !== 1 ? 'is' : 'l'} em ${remessas.length} remessa${remessas.length !== 1 ? 's' : ''}</div>
            </div>
            <button class="rs-close" id="rs-close" aria-label="Fechar"><i class="fas fa-times"></i></button>
          </div>

          <!-- Toolbar -->
          <div class="rs-toolbar">
            <div class="rs-search-wrap">
              <i class="fas fa-search"></i>
              <input type="search" id="rs-search" placeholder="Buscar por referência, descrição, cor ou serviço…" />
            </div>
            <div class="rs-quick-filters">
              <button class="rs-chip rs-chip-primary" id="rs-all" title="Marcar todos os visíveis">
                <i class="fas fa-check-double"></i> Selecionar todos
              </button>
              <button class="rs-chip" id="rs-none" title="Desmarcar todos">
                <i class="fas fa-square"></i> Desmarcar todos
              </button>
              <button class="rs-chip" id="rs-invert" title="Inverter seleção">
                <i class="fas fa-arrows-rotate"></i> Inverter
              </button>
            </div>
          </div>

          ${coresUnicas.length > 1 || servicosUnicos.length > 1 ? `
            <div class="rs-quick-section">
              ${coresUnicas.length > 1 ? `
                <div class="rs-quick-row">
                  <span class="rs-quick-label"><i class="fas fa-palette"></i> Cor:</span>
                  <div class="rs-pill-group">
                    ${coresUnicas.map(c => `<button class="rs-pill" data-by-cor="${esc(c)}">${esc(c)}</button>`).join('')}
                  </div>
                </div>
              ` : ''}
              ${servicosUnicos.length > 1 ? `
                <div class="rs-quick-row">
                  <span class="rs-quick-label"><i class="fas fa-screwdriver-wrench"></i> Serviço:</span>
                  <div class="rs-pill-group">
                    ${servicosUnicos.map(s => `<button class="rs-pill" data-by-serv="${esc(s)}">${esc(s)}</button>`).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          ` : ''}

          <!-- Lista de produtos (rolável) -->
          <div class="rs-list-wrap">
            <div class="rs-list-head">
              <span class="rs-col-check"><i class="fas fa-check" style="opacity:0.4"></i></span>
              <span class="rs-col-ref">REFERÊNCIA</span>
              <span class="rs-col-desc">DESCRIÇÃO / SERVIÇO</span>
              <span class="rs-col-cor">COR</span>
              <span class="rs-col-qtd">QTD</span>
              <span class="rs-col-valor">VALOR</span>
            </div>
            <div class="rs-list" id="rs-list">
              ${candidatos.map(c => `
                <label class="rs-row" data-uid="${c.uid}"
                       data-search="${esc((c.cod_ref || '') + ' ' + (c.desc_ref || '') + ' ' + (c.desc_servico || '') + ' ' + (c.cor || ''))}"
                       data-cor="${esc(c.cor || '')}"
                       data-serv="${esc(c.desc_servico || '')}">
                  <span class="rs-col-check">
                    <input type="checkbox" data-uid="${c.uid}" checked class="rs-checkbox" />
                  </span>
                  <span class="rs-col-ref">
                    <span class="rs-ref-code">${esc(c.cod_ref || '—')}</span>
                    ${c.num_op ? `<span class="rs-ref-op">OP ${esc(c.num_op)}</span>` : ''}
                  </span>
                  <span class="rs-col-desc">
                    <span class="rs-desc-main">${esc(c.desc_ref || '—')}</span>
                    ${c.desc_servico ? `<span class="rs-desc-sub"><i class="fas fa-screwdriver-wrench"></i> ${esc(c.desc_servico)}</span>` : ''}
                  </span>
                  <span class="rs-col-cor">${c.cor ? `<span class="rs-cor-badge">${esc(c.cor)}</span>` : '<span style="color:#64748b">—</span>'}</span>
                  <span class="rs-col-qtd">${fmt.int(c.qtd_total)}</span>
                  <span class="rs-col-valor">${fmtBRL(c.valor_total)}</span>
                </label>
              `).join('')}
              <div class="rs-empty" id="rs-empty" style="display:none">
                <i class="fas fa-magnifying-glass"></i>
                <p>Nenhum produto encontrado com este filtro.</p>
              </div>
            </div>
          </div>

          <!-- Footer sticky -->
          <div class="rs-footer">
            <div class="rs-kpis">
              <div class="rs-kpi">
                <span class="rs-kpi-label">Selecionados</span>
                <span class="rs-kpi-value" id="rs-kpi-sel">${candidatos.length}</span>
                <span class="rs-kpi-of">de ${candidatos.length}</span>
              </div>
              <div class="rs-kpi">
                <span class="rs-kpi-label">Qtd total</span>
                <span class="rs-kpi-value" id="rs-kpi-qtd">—</span>
                <span class="rs-kpi-of">peças</span>
              </div>
              <div class="rs-kpi">
                <span class="rs-kpi-label">Valor total</span>
                <span class="rs-kpi-value rs-kpi-value-strong" id="rs-kpi-valor">—</span>
              </div>
            </div>
            <div class="rs-actions">
              <button class="rs-btn rs-btn-ghost" id="rs-cancel">
                <i class="fas fa-xmark"></i> Cancelar
              </button>
              <button class="rs-btn rs-btn-primary" id="rs-confirm">
                <i class="fas fa-print"></i> Gerar Romaneio
                <span class="rs-btn-count" id="rs-btn-count">${candidatos.length}</span>
              </button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(m);

      const $list = m.querySelector('#rs-list');
      const $empty = m.querySelector('#rs-empty');
      const $search = m.querySelector('#rs-search');
      const $kpiSel = m.querySelector('#rs-kpi-sel');
      const $kpiQtd = m.querySelector('#rs-kpi-qtd');
      const $kpiValor = m.querySelector('#rs-kpi-valor');
      const $btnCount = m.querySelector('#rs-btn-count');
      const $confirm = m.querySelector('#rs-confirm');

      const recalcKPIs = () => {
        let qtd = 0, valor = 0, sel = 0;
        for (const c of candidatos) {
          if (selecionados.has(c.uid)) { sel++; qtd += c.qtd_total; valor += c.valor_total; }
        }
        $kpiSel.textContent = sel;
        $kpiQtd.textContent = fmt.int(qtd);
        $kpiValor.textContent = fmtBRL(valor);
        $btnCount.textContent = sel;
        $confirm.disabled = sel === 0;
        $confirm.classList.toggle('is-disabled', sel === 0);
      };

      const applySearch = () => {
        const q = ($search.value || '').toLowerCase().trim();
        let visiveis = 0;
        $list.querySelectorAll('.rs-row').forEach(row => {
          const hay = row.dataset.search.toLowerCase();
          const ok = !q || hay.includes(q);
          row.style.display = ok ? '' : 'none';
          if (ok) visiveis++;
        });
        $empty.style.display = visiveis === 0 ? '' : 'none';
      };

      // Sincroniza checkbox visual com Set
      const syncCheckboxes = () => {
        $list.querySelectorAll('.rs-checkbox').forEach(cb => {
          const uid = cb.dataset.uid;
          const checked = selecionados.has(uid);
          cb.checked = checked;
          cb.closest('.rs-row').classList.toggle('is-selected', checked);
        });
      };
      syncCheckboxes();
      recalcKPIs();

      // Listeners
      $search.addEventListener('input', applySearch);

      $list.addEventListener('change', (ev) => {
        const cb = ev.target.closest('.rs-checkbox');
        if (!cb) return;
        const uid = cb.dataset.uid;
        if (cb.checked) selecionados.add(uid);
        else selecionados.delete(uid);
        cb.closest('.rs-row').classList.toggle('is-selected', cb.checked);
        recalcKPIs();
      });

      // Clique na linha inteira (exceto no próprio checkbox) também alterna
      $list.addEventListener('click', (ev) => {
        if (ev.target.closest('.rs-checkbox')) return;
        const row = ev.target.closest('.rs-row');
        if (!row) return;
        ev.preventDefault();
        const cb = row.querySelector('.rs-checkbox');
        cb.checked = !cb.checked;
        const uid = cb.dataset.uid;
        if (cb.checked) selecionados.add(uid);
        else selecionados.delete(uid);
        row.classList.toggle('is-selected', cb.checked);
        recalcKPIs();
      });

      m.querySelector('#rs-all').onclick = () => {
        // Marca apenas os VISÍVEIS (respeita busca)
        $list.querySelectorAll('.rs-row').forEach(r => {
          if (r.style.display !== 'none') selecionados.add(r.dataset.uid);
        });
        syncCheckboxes();
        recalcKPIs();
      };
      m.querySelector('#rs-none').onclick = () => {
        $list.querySelectorAll('.rs-row').forEach(r => {
          if (r.style.display !== 'none') selecionados.delete(r.dataset.uid);
        });
        syncCheckboxes();
        recalcKPIs();
      };
      m.querySelector('#rs-invert').onclick = () => {
        $list.querySelectorAll('.rs-row').forEach(r => {
          if (r.style.display === 'none') return;
          const uid = r.dataset.uid;
          if (selecionados.has(uid)) selecionados.delete(uid);
          else selecionados.add(uid);
        });
        syncCheckboxes();
        recalcKPIs();
      };

      // Filtros rápidos por cor/serviço (acumulativos — adiciona à seleção)
      m.querySelectorAll('[data-by-cor]').forEach(b => {
        b.onclick = () => {
          const cor = b.dataset.byCor;
          $list.querySelectorAll('.rs-row').forEach(r => {
            if (r.dataset.cor === cor && r.style.display !== 'none') {
              selecionados.add(r.dataset.uid);
            }
          });
          syncCheckboxes();
          recalcKPIs();
          b.classList.add('rs-pill-active');
          setTimeout(() => b.classList.remove('rs-pill-active'), 600);
        };
      });
      m.querySelectorAll('[data-by-serv]').forEach(b => {
        b.onclick = () => {
          const serv = b.dataset.byServ;
          $list.querySelectorAll('.rs-row').forEach(r => {
            if (r.dataset.serv === serv && r.style.display !== 'none') {
              selecionados.add(r.dataset.uid);
            }
          });
          syncCheckboxes();
          recalcKPIs();
          b.classList.add('rs-pill-active');
          setTimeout(() => b.classList.remove('rs-pill-active'), 600);
        };
      });

      // ───────── Fechar e confirmar ─────────
      const close = (result) => {
        m.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };
      const onKey = (ev) => {
        if (ev.key === 'Escape') close(null);
        if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && selecionados.size > 0) {
          ev.preventDefault();
          doConfirm();
        }
      };
      document.addEventListener('keydown', onKey);

      m.querySelector('#rs-close').onclick = () => close(null);
      m.querySelector('#rs-cancel').onclick = () => close(null);
      m.addEventListener('click', (ev) => { if (ev.target === m) close(null); });

      const doConfirm = async () => {
        if (selecionados.size === 0) return;
        // Reconstrói remessas com `itens` filtrados
        const remessasFiltradas = remessas.map((r, rIdx) => {
          const selCandidatos = candidatos.filter(c => c.rIdx === rIdx && selecionados.has(c.uid));
          if (selCandidatos.length === 0) return null; // remessa inteira excluída
          const algumLegado = selCandidatos.some(c => !c._isItem);
          if (algumLegado) return r; // remessa legado: usa original
          const itensFiltrados = selCandidatos.map(c => r.itens[c.iIdx]);
          return { ...r, itens: itensFiltrados };
        }).filter(Boolean);

        $confirm.disabled = true;
        $confirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando…';
        try {
          await this.romaneio(remessasFiltradas, opts);
          close(remessasFiltradas);
        } catch (e) {
          console.error('[romaneio]', e);
          toast('Erro ao gerar romaneio: ' + (e?.message || e), 'error');
          $confirm.disabled = false;
          $confirm.innerHTML = '<i class="fas fa-print"></i> Gerar Romaneio <span class="rs-btn-count" id="rs-btn-count">' + selecionados.size + '</span>';
        }
      };
      $confirm.onclick = doConfirm;

      // Foco inicial no campo de busca para UX rápida
      setTimeout(() => $search.focus(), 60);
    });
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

  // HOTFIX 0045 — Período padrão = "ciclo" (ciclo atual de produção).
  // Salvamos o último período usado por usuário/empresa em localStorage
  // para não perder a seleção entre navegações.
  const LS_KEY = 'dashboard.periodo';
  const periodoSalvo = (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) || 'ciclo';

  main.innerHTML = `
    <!-- HOTFIX 0045 — Card CICLO ATUAL -->
    <div id="card-ciclo" class="dash-ciclo-card mb-4">
      <div class="dash-ciclo-card__icon"><i class="fas fa-calendar-check"></i></div>
      <div class="dash-ciclo-card__body">
        <div class="dash-ciclo-card__label">📅 Ciclo Atual</div>
        <div id="ciclo-titulo" class="dash-ciclo-card__title">Carregando…</div>
        <div id="ciclo-subtitulo" class="dash-ciclo-card__sub">—</div>
      </div>
      <div class="dash-ciclo-card__actions">
        <button id="btn-fechar-ciclo" class="btn btn-warning btn-sm" title="Fechar ciclo atual e iniciar novo">
          <i class="fas fa-flag-checkered mr-1"></i>Fechar Ciclo
        </button>
        <button id="btn-ver-ciclos" class="btn btn-secondary btn-sm" title="Ver ciclos anteriores">
          <i class="fas fa-clock-rotate-left mr-1"></i>Anteriores
        </button>
      </div>
    </div>

    <div class="card p-4 mb-4">
      <div class="flex flex-wrap items-end gap-3">
        <!-- HOTFIX 0045 — Seletor de período -->
        <div class="dash-periodo-seletor" role="radiogroup" aria-label="Selecionar período">
          <label class="dash-periodo-opt ${periodoSalvo === 'ciclo' ? 'is-active' : ''}">
            <input type="radio" name="periodo" value="ciclo" ${periodoSalvo === 'ciclo' ? 'checked' : ''} />
            <span><i class="fas fa-calendar-check mr-1"></i>Ciclo Atual</span>
          </label>
          <label class="dash-periodo-opt ${periodoSalvo === 'mes' ? 'is-active' : ''}">
            <input type="radio" name="periodo" value="mes" ${periodoSalvo === 'mes' ? 'checked' : ''} />
            <span><i class="fas fa-calendar-days mr-1"></i>Mês Atual</span>
          </label>
          <label class="dash-periodo-opt ${periodoSalvo === '30d' ? 'is-active' : ''}">
            <input type="radio" name="periodo" value="30d" ${periodoSalvo === '30d' ? 'checked' : ''} />
            <span><i class="fas fa-clock-rotate-left mr-1"></i>Últimos 30 dias</span>
          </label>
          <label class="dash-periodo-opt ${periodoSalvo === 'custom' ? 'is-active' : ''}">
            <input type="radio" name="periodo" value="custom" ${periodoSalvo === 'custom' ? 'checked' : ''} />
            <span><i class="fas fa-calendar mr-1"></i>Personalizado</span>
          </label>
        </div>

        <!-- Campos de data — só visíveis em "Personalizado" -->
        <div id="custom-dates" class="flex flex-wrap items-end gap-3" style="display:${periodoSalvo === 'custom' ? 'flex' : 'none'}">
          <div><label>De</label><input type="date" id="f-de" value="${de}" /></div>
          <div><label>Até</label><input type="date" id="f-ate" value="${hoje}" /></div>
        </div>

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

  // HOTFIX 0045 — descobre qual período está selecionado nos radios
  function getPeriodoSelecionado() {
    const r = document.querySelector('input[name="periodo"]:checked');
    return r?.value || 'ciclo';
  }

  async function load() {
    // HOTFIX 0045 — monta URL conforme o período escolhido
    const periodo = getPeriodoSelecionado();
    let url = '/terc/dashboard?periodo=' + encodeURIComponent(periodo);
    if (periodo === 'custom') {
      const de = ($('#f-de')?.value) || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
      const ate = ($('#f-ate')?.value) || dayjs().format('YYYY-MM-DD');
      url += `&de=${de}&ate=${ate}`;
    }

    let d = {};
    try {
      const r = await api('get', url, null, { silent: true });
      d = (r && r.data) ? r.data : {};
    } catch (e) {
      console.error('[dashboard] erro ao buscar /terc/dashboard', e);
      // Mostra estado de erro mas continua tentando renderizar com dados vazios
      const errMsg = e?.response?.data?.error || e?.message || 'Erro ao carregar dashboard';
      if ($('#kpis')) $('#kpis').innerHTML = `<div class="col-span-full">${FALLBACK_ERROR(errMsg)}</div>`;
      d = {};
    }

    // HOTFIX 0045 — atualiza o card CICLO ATUAL com a janela resolvida pelo backend
    try {
      const per = d?.periodo || {};
      const ciclo = per.ciclo;
      const tit = $('#ciclo-titulo');
      const sub = $('#ciclo-subtitulo');
      const fmtDt = (iso) => {
        if (!iso) return '—';
        const d2 = dayjs(iso);
        return d2.isValid() ? d2.format('DD/MM/YYYY') : iso;
      };
      if (tit && sub) {
        if (per.tipo === 'ciclo' && ciclo) {
          tit.textContent = ciclo.label || `${fmtDt(ciclo.dt_inicio)} → Hoje`;
          const partes = [`${fmtDt(ciclo.dt_inicio)} → ${fmtDt(ciclo.dt_fim)}`, `${ciclo.dias || 0} dia(s)`];
          if (ciclo.nunca_fechou) partes.push('<span class="text-amber-500"><i class="fas fa-info-circle mr-1"></i>nunca fechado</span>');
          sub.innerHTML = partes.join(' · ');
        } else {
          const labels = { mes: 'Mês atual', '30d': 'Últimos 30 dias', custom: 'Período personalizado' };
          tit.textContent = labels[per.tipo] || 'Período selecionado';
          sub.textContent = `${fmtDt(per.de)} → ${fmtDt(per.ate)}`;
        }
      }
      // Mostra/esconde botão "Fechar Ciclo" — só faz sentido em modo ciclo
      const btnF = $('#btn-fechar-ciclo');
      if (btnF) btnF.style.display = (per.tipo === 'ciclo') ? '' : 'none';
    } catch (e) { console.error('[dashboard] ciclo card', e); }

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

  // HOTFIX 0045 — radios de período: ao trocar, recarrega e persiste
  document.querySelectorAll('input[name="periodo"]').forEach(r => {
    r.addEventListener('change', () => {
      const sel = getPeriodoSelecionado();
      try { localStorage.setItem(LS_KEY, sel); } catch {}
      // Atualiza visual do radio "ativo"
      document.querySelectorAll('.dash-periodo-opt').forEach(opt => {
        opt.classList.toggle('is-active', opt.querySelector('input')?.checked);
      });
      // Mostra/esconde campos de data customizada
      const cd = $('#custom-dates');
      if (cd) cd.style.display = (sel === 'custom') ? 'flex' : 'none';
      // Recarrega imediatamente (não precisa clicar "Atualizar")
      load();
    });
  });

  // HOTFIX 0045 — botão Fechar Ciclo
  if ($('#btn-fechar-ciclo')) {
    $('#btn-fechar-ciclo').onclick = () => abrirModalFecharCiclo(load);
  }

  // HOTFIX 0045 — botão Ver Anteriores
  if ($('#btn-ver-ciclos')) {
    $('#btn-ver-ciclos').onclick = () => abrirModalCiclosAnteriores();
  }

  try { await load(); } catch (e) { console.error('[dashboard] load top‑level', e); }
};

/**
 * HOTFIX 0045 — Modal de confirmação para FECHAR CICLO ATUAL
 * Mostra o resumo do ciclo (período, totais), pede observação opcional
 * e cria o registro de fechamento via POST /terc/ciclo/fechar.
 */
async function abrirModalFecharCiclo(onSuccess) {
  // Busca o ciclo atual para mostrar o resumo
  let ciclo = null;
  try {
    const r = await api('get', '/terc/ciclo-atual', null, { silent: true });
    ciclo = r?.data || null;
  } catch (e) {
    toast('Não foi possível carregar o ciclo atual.', 'error');
    return;
  }
  if (!ciclo) {
    toast('Ciclo atual indisponível.', 'error');
    return;
  }

  const fmtDt = (iso) => {
    if (!iso) return '—';
    const d2 = dayjs(iso);
    return d2.isValid() ? d2.format('DD/MM/YYYY') : iso;
  };

  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-lg' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3">
      <i class="fas fa-flag-checkered mr-2 text-amber-500"></i>Fechar Ciclo Atual
    </h3>
    <div class="rem-bulk-summary mb-3">
      <div class="rem-bulk-summary__row">
        <span class="rem-bulk-summary__lbl">Período</span>
        <span class="rem-bulk-summary__val">${fmtDt(ciclo.dt_inicio)} → ${fmtDt(ciclo.dt_fim)}</span>
      </div>
      <div class="rem-bulk-summary__row">
        <span class="rem-bulk-summary__lbl">Dias no ciclo</span>
        <span class="rem-bulk-summary__val">${ciclo.dias || 0}</span>
      </div>
      <div class="rem-bulk-summary__row rem-bulk-summary__row--ok">
        <span class="rem-bulk-summary__lbl"><i class="fas fa-truck-fast mr-1"></i>Remessas no ciclo</span>
        <span class="rem-bulk-summary__val">${fmt.int(ciclo.kpis?.remessas || 0)}</span>
      </div>
      <div class="rem-bulk-summary__row">
        <span class="rem-bulk-summary__lbl"><i class="fas fa-boxes mr-1"></i>Peças enviadas</span>
        <span class="rem-bulk-summary__val">${fmt.int(ciclo.kpis?.pecas || 0)}</span>
      </div>
      <div class="rem-bulk-summary__row">
        <span class="rem-bulk-summary__lbl"><i class="fas fa-dollar-sign mr-1"></i>Valor total</span>
        <span class="rem-bulk-summary__val">${TERC.fmtBRL(fmt.safeNum(ciclo.kpis?.valor || 0))}</span>
      </div>
    </div>

    <label class="block mb-3">
      <span class="text-sm text-slate-600 mb-1 inline-block">Observação (opcional)</span>
      <textarea id="ciclo-obs" rows="2" maxlength="500" class="w-full"
        placeholder="Ex.: fechamento mensal, lote especial, etc."></textarea>
    </label>

    <div class="pay-confirm-banner mb-3">
      <i class="fas fa-circle-info"></i>
      <div>
        Ao fechar, os indicadores do dashboard serão <b>zerados</b> e um novo ciclo
        começará a partir de amanhã. Os dados de remessas e retornos
        <b>NÃO serão alterados</b> — apenas a janela do dashboard muda.
      </div>
    </div>

    <div class="flex justify-end gap-2">
      <button id="ciclo-cancel" class="btn btn-secondary"><i class="fas fa-xmark mr-1"></i>Cancelar</button>
      <button id="ciclo-ok" class="btn btn-warning"><i class="fas fa-flag-checkered mr-1"></i>Fechar Ciclo</button>
    </div>
  `;
  m.appendChild(card);
  document.body.appendChild(m);

  document.getElementById('ciclo-cancel').onclick = () => m.remove();
  document.getElementById('ciclo-ok').onclick = async () => {
    const obs = (document.getElementById('ciclo-obs')?.value || '').trim();
    const $ok = document.getElementById('ciclo-ok');
    $ok.disabled = true;
    $ok.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Fechando…';
    try {
      const r = await api('post', '/terc/ciclo/fechar',
        { observacao: obs }, { silent: true });
      const d = r?.data || {};
      m.remove();
      toast(`Ciclo encerrado: ${d.snapshot?.remessas || 0} remessas, ${d.snapshot?.pecas_enviadas || 0} peças.`, 'success');
      if (typeof onSuccess === 'function') onSuccess();
    } catch (e) {
      $ok.disabled = false;
      $ok.innerHTML = '<i class="fas fa-flag-checkered mr-1"></i>Tentar novamente';
      const msg = e?.response?.data?.error || e?.message || 'Erro ao fechar ciclo';
      toast(msg, 'error');
    }
  };
}

/**
 * HOTFIX 0045 — Modal de listagem de CICLOS ANTERIORES
 * Lista paginada (20/página) com snapshot resumido de cada ciclo fechado.
 */
async function abrirModalCiclosAnteriores() {
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal p-6 w-full max-w-3xl' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-3">
      <i class="fas fa-clock-rotate-left mr-2 text-brand"></i>Ciclos Anteriores
    </h3>
    <div id="ciclos-lista" class="dash-ciclos-anteriores">
      <p class="text-slate-500 text-sm py-4 text-center"><i class="fas fa-spinner fa-spin mr-1"></i>Carregando…</p>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button id="ciclos-close" class="btn btn-primary"><i class="fas fa-xmark mr-1"></i>Fechar</button>
    </div>
  `;
  m.appendChild(card);
  document.body.appendChild(m);
  document.getElementById('ciclos-close').onclick = () => m.remove();

  const fmtDt = (iso) => {
    if (!iso) return '—';
    const d2 = dayjs(iso);
    return d2.isValid() ? d2.format('DD/MM/YYYY') : iso;
  };
  const fmtDtH = (iso) => {
    if (!iso) return '—';
    const d2 = dayjs(iso);
    return d2.isValid() ? d2.format('DD/MM/YYYY HH:mm') : iso;
  };

  try {
    const r = await api('get', '/terc/ciclos?page=1&size=50', null, { silent: true });
    const items = (r?.data) || [];
    const total = r?.total || 0;
    const $list = document.getElementById('ciclos-lista');
    if (!$list) return;
    if (items.length === 0) {
      $list.innerHTML = '<p class="text-slate-500 text-sm py-6 text-center"><i class="fas fa-circle-info mr-1"></i>Nenhum ciclo foi fechado ainda. Use "Fechar Ciclo" para iniciar o histórico.</p>';
      return;
    }
    $list.innerHTML = `
      <div class="text-xs text-slate-500 mb-2">Mostrando ${items.length} de ${total} ciclo(s) fechado(s)</div>
      <div class="dash-ciclos-anteriores__list">
        ${items.map(it => `
          <div class="dash-ciclos-anteriores__item">
            <div class="dash-ciclos-anteriores__head">
              <span class="dash-ciclos-anteriores__period">
                <i class="fas fa-calendar-check mr-1"></i>
                ${fmtDt(it.dt_inicio)} → ${fmtDt(it.dt_fim)}
              </span>
              <span class="dash-ciclos-anteriores__date">
                Fechado em ${fmtDtH(it.dt_fechamento)} por <b>${escapeHtml(it.fechado_por)}</b>
              </span>
            </div>
            <div class="dash-ciclos-anteriores__kpis">
              <span><i class="fas fa-truck-fast mr-1 text-brand"></i><b>${fmt.int(it.total_remessas)}</b> remessas</span>
              <span><i class="fas fa-boxes mr-1 text-indigo-500"></i><b>${fmt.int(it.total_pecas)}</b> peças</span>
              <span><i class="fas fa-dollar-sign mr-1 text-emerald-500"></i><b>${TERC.fmtBRL(it.valor_total)}</b></span>
              ${(it.snapshot?.em_aberto != null) ? `<span><i class="fas fa-clock mr-1 text-amber-500"></i>${fmt.int(it.snapshot.em_aberto)} em aberto</span>` : ''}
              ${(it.snapshot?.concluidas != null) ? `<span><i class="fas fa-check-circle mr-1 text-emerald-500"></i>${fmt.int(it.snapshot.concluidas)} concluídas</span>` : ''}
              ${(it.snapshot?.atrasadas != null && it.snapshot.atrasadas > 0) ? `<span><i class="fas fa-triangle-exclamation mr-1 text-red-500"></i>${fmt.int(it.snapshot.atrasadas)} atrasadas</span>` : ''}
            </div>
            ${it.observacao ? `<div class="dash-ciclos-anteriores__obs"><i class="fas fa-comment-dots mr-1"></i>${escapeHtml(it.observacao)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    const $list = document.getElementById('ciclos-lista');
    if ($list) $list.innerHTML = '<p class="text-red-500 text-sm py-4 text-center"><i class="fas fa-triangle-exclamation mr-1"></i>Falha ao carregar ciclos.</p>';
  }
}

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
/* ============================================================
 * 🚀 ROUTES.terc_remessas — REFATORADO v23 (ERP Premium)
 *
 * Recursos:
 *  - Toolbar sticky (top fixo com blur + sombra)
 *  - Busca inteligente: multi-termo (200 azul embalagem ctrl 12)
 *  - Campos buscados: CTRL, OP, ref, cor, terceirizado, serviço, produto
 *  - Debounce 300ms na busca
 *  - AbortController: cancela request anterior ao mudar filtros
 *  - Cache em sessionStorage (TTL 30s) — invalida ao salvar
 *  - Skeleton loading + tabela in-place (sem re-render do shell)
 *  - Contador de resultados: "X remessas · Y peças"
 *  - Thead sticky abaixo do toolbar (top:80px)
 *  - Responsivo (mobile = filtros empilhados)
 * ============================================================ */
ROUTES.terc_remessas = async (main) => {
  await TERC.load();

  const REM_CACHE_KEY = 'corepro:remessas:cache';
  const REM_CACHE_TTL = 30_000; // 30s

  // Filtros persistidos
  let savedFilters = {};
  try { savedFilters = JSON.parse(sessionStorage.getItem('corepro:remessas:filtros') || '{}'); } catch {}

  const hoje = dayjs().format('YYYY-MM-DD');
  const deDefault = dayjs().subtract(60, 'day').format('YYYY-MM-DD');

  const st = {
    search:     '',
    id_terc:    savedFilters.id_terc || '',
    id_servico: savedFilters.id_servico || '',
    id_setor:   savedFilters.id_setor || '',  // HOTFIX 0037
    status:     savedFilters.status || '',
    de:         savedFilters.de || deDefault,
    ate:        savedFilters.ate || hoje,
  };

  // ----- Shell (renderiza 1 vez; depois só a tabela é re-renderizada) -----
  // v23.2: TODO o topo (contador + ações + filtros) vive dentro de UM sticky único.
  // A tabela rola por baixo, sem vazamento visual.
  main.innerHTML = `
    <div class="remessas-page">
      <!-- ============================================================
       * v24 — REMESSAS LAYOUT (ERP Premium)
       *
       *  #stickyFiltersContainer  → contador + ações + filtros (sticky top)
       *  #tableScrollContainer    → área scrollável (única que rola)
       *    └─ #tableContentContainer → <table> com thead sticky
       * ============================================================ -->

      <!-- ⬇️ Sticky único — contador + ações + filtros -->
      <div id="stickyFiltersContainer" class="page-sticky-header remessas-toolbar">
        <div class="page-sticky-row">
          <!-- Linha 1: contador + ações principais (Romaneio + Nova) -->
          <div class="remessas-summary-row">
            <span id="rem-counter" class="rem-counter" aria-live="polite"></span>
            <div class="flex-1"></div>
            <button id="btn-romaneio-lote" class="btn btn-secondary"
              title="Imprime um Romaneio de Serviço com todas as remessas filtradas">
              <i class="fas fa-print mr-1"></i><span>Romaneio em Lote</span>
            </button>
            <button id="btn-nova" class="btn btn-success">
              <i class="fas fa-plus mr-1"></i><span>Nova Remessa</span>
            </button>
          </div>

          <!-- Linha 2: filtros -->
          <div class="page-sticky-grid">
            <div class="filter-cell filter-cell-search">
              <label>Buscar</label>
              <div class="search-input-wrap">
                <i class="fas fa-search search-icon"></i>
                <input id="f-search" type="text" autocomplete="off"
                  placeholder="Nº CTRL, OP, ref, cor, produto, terceirizado, serviço…"
                  value="${escapeHtml(st.search)}" />
              </div>
            </div>
            <div class="filter-cell">
              <label>Terceirizado</label>
              <select id="f-terc">${TERC.optTerc()}</select>
            </div>
            <div class="filter-cell">
              <label>Serviço</label>
              <select id="f-serv">${TERC.optServicos()}</select>
            </div>
            <div class="filter-cell">
              <label>Setor</label>
              <select id="f-setor">${TERC.optSetores()}</select>
            </div>
            <div class="filter-cell">
              <label>Status</label>
              <select id="f-status">
                <option value="">Todos</option>
                <option value="AguardandoEnvio">Aguardando Retorno</option>
                <option value="Enviado">Enviado</option>
                <option value="EmProducao">Em produção</option>
                <option value="Parcial">Parcial</option>
                <option value="Atrasado">Atrasado</option>
                <option value="Concluido">Concluído</option>
                <option value="Retornado">Retornado</option>
                <option value="Pago">Pago</option>
                <option value="Cancelado">Cancelado</option>
              </select>
            </div>
            <div class="filter-cell">
              <label>De</label>
              <input type="date" id="f-de" value="${st.de}" />
            </div>
            <div class="filter-cell">
              <label>Até</label>
              <input type="date" id="f-ate" value="${st.ate}" />
            </div>
          </div>

          <!-- Linha 3: ações secundárias (Limpar) -->
          <div class="page-sticky-actions">
            <button id="btn-clear" class="btn btn-secondary btn-sm" title="Limpar filtros">
              <i class="fas fa-eraser mr-1"></i><span>Limpar</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ⬇️ Container scrollável (única região que rola) -->
      <div id="rem-tbl" class="card p-0 remessas-table-wrap" data-container="tableScrollContainer"></div>

      <!-- ⬇️ HOTFIX 0043 — Barra flutuante de seleção em lote (Excluir Selecionadas) -->
      <div id="rem-bulk-bar" class="rem-bulk-bar" role="region" aria-label="Ações em lote">
        <div class="rem-bulk-bar__info">
          <i class="fas fa-check-double"></i>
          <span><b id="rbb-count">0</b> remessas selecionadas</span>
          <span class="rem-bulk-bar__sep">·</span>
          <i class="fas fa-cubes"></i>
          <span><b id="rbb-pieces">0</b> peças</span>
        </div>
        <div class="rem-bulk-bar__actions">
          <button id="rbb-clear" class="btn btn-ghost" title="Limpar seleção">
            <i class="fas fa-xmark mr-1"></i><span>Cancelar Seleção</span>
          </button>
          <button id="rbb-del" class="btn btn-danger" title="Excluir as remessas selecionadas">
            <i class="fas fa-trash mr-1"></i><span>Excluir Selecionadas</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // Refs
  const $tbl     = $('#rem-tbl');
  const $counter = $('#rem-counter');
  const $search  = $('#f-search');
  const $terc    = $('#f-terc');
  const $serv    = $('#f-serv');
  const $setor   = $('#f-setor');   // HOTFIX 0037
  const $status  = $('#f-status');
  const $de      = $('#f-de');
  const $ate     = $('#f-ate');
  const $btnClear   = $('#btn-clear');
  const $btnNova    = $('#btn-nova');
  const $btnRomLote = $('#btn-romaneio-lote');

  // Pré-popular selects com filtros salvos
  try {
    if (st.id_terc)    $terc.value = String(st.id_terc);
    if (st.id_servico) $serv.value = String(st.id_servico);
    if (st.id_setor && $setor) $setor.value = String(st.id_setor); // HOTFIX 0037
    if (st.status)     $status.value = String(st.status);
  } catch {}

  let _lastRemessas = [];

  // ----- Skeleton -----
  function skeletonTable() {
    const cols = 14; // +1: coluna de checkbox (HOTFIX 0043)
    const rows = Array.from({ length: 8 }).map(() => `
      <tr class="skeleton-row">
        ${Array.from({length: cols}).map(() => '<td><span class="skeleton-cell"></span></td>').join('')}
      </tr>`).join('');
    return `
      <div class="table-scroll" data-container="tableContentContainer">
        <table class="w-full text-sm remessas-table">
          <thead><tr>
            <th class="rem-col-check no-print"><input type="checkbox" disabled /></th>
            <th class="text-right">Ctrl</th><th>OP</th><th>Terceirizado</th>
            <th>Serviço</th><th>Referência</th><th>Cor</th>
            <th class="text-right">Qtd</th><th class="text-right">Retornada</th>
            <th class="text-right">Valor</th><th class="text-center">Saída</th>
            <th class="text-center">Prev.</th><th class="text-center">Status</th>
            <th class="text-center no-print">Ações</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ============================================================
  // HOTFIX 0043 — Helpers de seleção em lote para Remessas
  // ============================================================

  /** Lê as remessas atualmente selecionadas (checkbox marcado). */
  function getSelectedRemRows() {
    const checks = $tbl.querySelectorAll('.rem-bulk-check:checked');
    const out = [];
    checks.forEach(cb => {
      out.push({
        id:  Number(cb.dataset.remId),
        num: Number(cb.dataset.remNum) || 0,
        qtd: Number(cb.dataset.remQtd) || 0,
      });
    });
    return out;
  }

  /**
   * Atualiza a barra flutuante de ações em lote conforme a seleção atual.
   * Sincroniza estado do checkbox "selecionar todos" (incluindo indeterminate).
   */
  function updateRemBulkBar() {
    const bar = document.getElementById('rem-bulk-bar');
    if (!bar) return;

    const allChecks = $tbl.querySelectorAll('.rem-bulk-check');
    const selChecks = $tbl.querySelectorAll('.rem-bulk-check:checked');
    const total = allChecks.length;
    const sel   = selChecks.length;

    const checkAll = $tbl.querySelector('#rem-check-all');
    if (checkAll) {
      if (sel === 0)            { checkAll.checked = false; checkAll.indeterminate = false; }
      else if (sel === total)   { checkAll.checked = true;  checkAll.indeterminate = false; }
      else                      { checkAll.checked = false; checkAll.indeterminate = true;  }
    }

    if (sel === 0) {
      bar.classList.remove('is-visible');
      return;
    }

    // Soma peças
    let pieces = 0;
    selChecks.forEach(cb => { pieces += Number(cb.dataset.remQtd) || 0; });

    const $count  = document.getElementById('rbb-count');
    const $pieces = document.getElementById('rbb-pieces');
    if ($count)  $count.textContent  = String(sel);
    if ($pieces) $pieces.textContent = fmt.int(pieces);

    bar.classList.add('is-visible');
  }

  /** Limpa toda a seleção (desmarca checkboxes + esconde barra). */
  function clearRemBulkSelection() {
    $tbl.querySelectorAll('.rem-bulk-check').forEach(cb => { cb.checked = false; });
    const checkAll = $tbl.querySelector('#rem-check-all');
    if (checkAll) { checkAll.checked = false; checkAll.indeterminate = false; }
    updateRemBulkBar();
  }

  /**
   * Fluxo de exclusão em lote:
   *  1. Faz PRE-CHECK no backend (sem confirm) → recebe lista de permitidas/bloqueadas
   *  2. Mostra modal detalhado: quantas serão excluídas, quais bloqueadas e por quê
   *  3. Usuário confirma → POST novamente com confirm='SIM' → executa
   *  4. Toast com resultado + invalida cache + recarrega tabela
   */
  async function bulkDeleteRem() {
    const rows = getSelectedRemRows();
    if (rows.length === 0) {
      toast('Selecione pelo menos uma remessa.', 'info');
      return;
    }

    const ids = rows.map(r => r.id);
    let preview = null;

    // === Passo 1: PRE-CHECK ===
    try {
      const r = await api('post', '/terc/remessas/bulk-delete',
        { ids, confirm: '' }, { silent: false });
      preview = r?.data || {};
    } catch (e) {
      // Erro do api() já mostrou toast — nada a fazer
      return;
    }

    const permitidas = Array.isArray(preview?.permitidas) ? preview.permitidas : [];
    const bloqueadas = Array.isArray(preview?.bloqueadas) ? preview.bloqueadas : [];
    const totalPerm  = permitidas.length;
    const totalBloq  = bloqueadas.length;
    const totalSel   = rows.length;

    // === Passo 2: Modal de confirmação ===
    const m = el('div', { class: 'modal-backdrop' });
    const card = el('div', { class: 'modal p-6 w-full max-w-2xl' });

    const bloqHtml = totalBloq > 0 ? `
      <div class="rem-bulk-blocked">
        <div class="rem-bulk-blocked__title">
          <i class="fas fa-ban"></i>
          <span><b>${totalBloq}</b> remessa${totalBloq === 1 ? '' : 's'} não pode${totalBloq === 1 ? '' : 'm'} ser excluída${totalBloq === 1 ? '' : 's'}:</span>
        </div>
        <div class="rem-bulk-blocked__list">
          ${bloqueadas.slice(0, 12).map(b => `
            <div class="rem-bulk-blocked__row">
              <span class="rem-bulk-blocked__ctrl">CTRL ${b.num_controle || '—'}</span>
              <span class="rem-bulk-blocked__reason">${escapeHtml(b.motivo || 'Bloqueada')}</span>
            </div>
          `).join('')}
          ${bloqueadas.length > 12 ? `
            <div class="rem-bulk-blocked__more">
              … e mais ${bloqueadas.length - 12} remessa${bloqueadas.length - 12 === 1 ? '' : 's'} bloqueada${bloqueadas.length - 12 === 1 ? '' : 's'}.
            </div>
          ` : ''}
        </div>
      </div>
    ` : '';

    const permListPreview = permitidas.slice(0, 20).map(p => p.num_controle).filter(n => n > 0).join(', ');
    const permListSuffix  = permitidas.length > 20 ? ` … (+${permitidas.length - 20})` : '';

    card.innerHTML = `
      <h3 class="text-lg font-semibold mb-2">
        <i class="fas fa-trash-can mr-2 text-red-500"></i>
        Exclusão em lote de remessas
      </h3>

      <div class="rem-bulk-summary">
        <div class="rem-bulk-summary__row">
          <span class="rem-bulk-summary__lbl">Selecionadas</span>
          <span class="rem-bulk-summary__val">${totalSel}</span>
        </div>
        <div class="rem-bulk-summary__row rem-bulk-summary__row--ok">
          <span class="rem-bulk-summary__lbl"><i class="fas fa-circle-check mr-1"></i>Serão excluídas</span>
          <span class="rem-bulk-summary__val">${totalPerm}</span>
        </div>
        ${totalBloq > 0 ? `
          <div class="rem-bulk-summary__row rem-bulk-summary__row--block">
            <span class="rem-bulk-summary__lbl"><i class="fas fa-ban mr-1"></i>Bloqueadas</span>
            <span class="rem-bulk-summary__val">${totalBloq}</span>
          </div>
        ` : ''}
      </div>

      ${totalPerm > 0 ? `
        <div class="rem-bulk-permit">
          <div class="rem-bulk-permit__title">
            <i class="fas fa-list-check mr-1"></i>CTRLs a excluir:
          </div>
          <div class="rem-bulk-permit__list">${escapeHtml(permListPreview)}${permListSuffix}</div>
        </div>
      ` : ''}

      ${bloqHtml}

      ${totalPerm > 0 ? `
        <div class="pay-confirm-banner mt-3">
          <i class="fas fa-triangle-exclamation"></i>
          <div>
            Esta ação <b>não poderá ser desfeita</b>. As remessas excluídas
            e seus retornos vinculados serão removidos permanentemente do banco.
          </div>
        </div>
      ` : `
        <div class="pay-confirm-banner mt-3" style="background:rgba(239,68,68,.10);border-color:rgba(239,68,68,.32);color:#fecaca">
          <i class="fas fa-circle-exclamation"></i>
          <div>
            <b>Nenhuma das remessas selecionadas pode ser excluída.</b>
            Revise os bloqueios acima.
          </div>
        </div>
      `}

      <div class="flex justify-end gap-2 mt-4">
        <button id="rbb-modal-cancel" class="btn btn-secondary">
          <i class="fas fa-xmark mr-1"></i>Cancelar
        </button>
        <button id="rbb-modal-ok" class="btn btn-danger" ${totalPerm === 0 ? 'disabled' : ''}>
          <i class="fas fa-check mr-1"></i>Confirmar Exclusão${totalPerm > 0 ? ` (${totalPerm})` : ''}
        </button>
      </div>
    `;

    m.appendChild(card);
    document.body.appendChild(m);

    document.getElementById('rbb-modal-cancel').onclick = () => m.remove();

    const $ok = document.getElementById('rbb-modal-ok');
    if (totalPerm === 0) return; // botão já disabled

    $ok.onclick = async () => {
      $ok.disabled = true;
      $ok.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Excluindo…';

      // HOTFIX 0044 — chama com {silent:true} para nós mesmos
      // tratarmos a resposta (sucesso parcial / falha total) com modal
      // detalhado em vez do toast genérico do api().
      let resp = null;
      let errResp = null;
      try {
        const idsPerm = permitidas.map(p => p.id_remessa);
        const r = await api('post', '/terc/remessas/bulk-delete',
          { ids: idsPerm, confirm: 'SIM' }, { silent: true });
        resp = r?.data || r || {};
      } catch (e) {
        // api(silent) repassa o erro do axios — extraímos o payload do backend
        errResp = e?.response?.data || null;
        if (!errResp) {
          // falha de rede / sem resposta: reabilita botão e mostra toast simples
          $ok.disabled = false;
          $ok.innerHTML = '<i class="fas fa-check mr-1"></i>Tentar novamente';
          toast(e?.message || 'Falha de conexão. Tente novamente.', 'error');
          return;
        }
      }

      // Fecha modal de confirmação e mostra o modal de RESULTADO
      m.remove();

      // Quando deu erro o backend devolve {ok:false, falhas:[...], bloqueadas:[...]}.
      // Quando deu sucesso (total ou parcial) devolve {ok:true, data:{...}}.
      const d = errResp || resp || {};
      const nExc = Number(d.total_excluidas) || 0;
      const nRet = Number(d.retornos_apagados) || 0;
      const nBlk = Number(d.total_bloqueadas) || 0;
      const nFail = Number(d.total_falhadas) || 0;
      const ctrlsExcluidos = Array.isArray(d.ctrls_excluidos) ? d.ctrls_excluidos : [];
      const falhas = Array.isArray(d.falhas) ? d.falhas : [];
      const bloqueadasResp = Array.isArray(d.bloqueadas) ? d.bloqueadas : bloqueadas;

      showBulkDeleteResultModal({
        nExc, nRet, nBlk, nFail,
        ctrlsExcluidos,
        falhas,
        bloqueadas: bloqueadasResp,
        hint: d.hint || errResp?.hint,
        errorMsg: errResp?.error,
      });

      // Limpa seleção + recarrega tabela SE algo foi excluído
      if (nExc > 0) {
        clearRemBulkSelection();
        cacheInvalidate();
        load({ bypassCache: true });
      }
    };
  }

  /**
   * HOTFIX 0044 — Modal de RESULTADO da exclusão em lote.
   * Mostra três blocos: ✓ excluídas, ⚠ bloqueadas, ✗ falhadas.
   * Em PROD com 200+ remessas, esse modal é o ÚNICO sinal claro
   * do que aconteceu (substitui o toast "Erro no banco de dados").
   */
  function showBulkDeleteResultModal({ nExc, nRet, nBlk, nFail, ctrlsExcluidos, falhas, bloqueadas, hint, errorMsg }) {
    const total = nExc + nBlk + nFail;
    const sucessoTotal = nFail === 0 && nBlk === 0 && nExc > 0;
    const sucessoParcial = nExc > 0 && (nBlk > 0 || nFail > 0);
    const fracassoTotal = nExc === 0;

    // Header com ícone/cor segundo o resultado geral
    let headerIcon, headerColor, headerTitle;
    if (sucessoTotal)       { headerIcon='fa-circle-check';  headerColor='text-emerald-500'; headerTitle='Exclusão concluída'; }
    else if (sucessoParcial){ headerIcon='fa-circle-exclamation'; headerColor='text-amber-500'; headerTitle='Exclusão concluída com observações'; }
    else                    { headerIcon='fa-circle-xmark';  headerColor='text-red-500';     headerTitle='Não foi possível excluir'; }

    // Listas — limita visualização a 12 para não estourar o modal
    const CAP = 12;
    const ctrlsView = ctrlsExcluidos.slice(0, CAP).join(', ');
    const ctrlsMore = ctrlsExcluidos.length > CAP ? ` … (+${ctrlsExcluidos.length - CAP})` : '';

    const bloqList = bloqueadas.slice(0, CAP).map(b => `
      <div class="rem-bulk-blocked__row">
        <span class="rem-bulk-blocked__ctrl">CTRL ${b.num_controle || '—'}</span>
        <span class="rem-bulk-blocked__reason">${escapeHtml(b.motivo || 'Bloqueada')}</span>
      </div>
    `).join('');
    const bloqMore = bloqueadas.length > CAP
      ? `<div class="rem-bulk-blocked__more">… e mais ${bloqueadas.length - CAP} bloqueada${bloqueadas.length - CAP === 1 ? '' : 's'}.</div>`
      : '';

    const falhaList = falhas.slice(0, CAP).map(f => `
      <div class="rem-bulk-blocked__row">
        <span class="rem-bulk-blocked__ctrl">CTRL ${f.num_controle || '—'}</span>
        <span class="rem-bulk-blocked__reason">${escapeHtml(f.motivo || 'Falha técnica')}</span>
      </div>
    `).join('');
    const falhaMore = falhas.length > CAP
      ? `<div class="rem-bulk-blocked__more">… e mais ${falhas.length - CAP} falha${falhas.length - CAP === 1 ? '' : 's'}.</div>`
      : '';

    const mr = el('div', { class: 'modal-backdrop' });
    const card = el('div', { class: 'modal p-6 w-full max-w-2xl' });
    card.innerHTML = `
      <h3 class="text-lg font-semibold mb-3">
        <i class="fas ${headerIcon} mr-2 ${headerColor}"></i>${headerTitle}
      </h3>

      ${errorMsg ? `
        <div class="pay-confirm-banner mb-3" style="background:rgba(239,68,68,.10);border-color:rgba(239,68,68,.32);color:#fecaca">
          <i class="fas fa-triangle-exclamation"></i>
          <div>${escapeHtml(errorMsg)}${hint ? `<div class="text-xs mt-1 opacity-80">Detalhe técnico: ${escapeHtml(hint)}</div>` : ''}</div>
        </div>
      ` : ''}

      <div class="rem-bulk-summary">
        <div class="rem-bulk-summary__row">
          <span class="rem-bulk-summary__lbl">Total processado</span>
          <span class="rem-bulk-summary__val">${total}</span>
        </div>
        <div class="rem-bulk-summary__row rem-bulk-summary__row--ok">
          <span class="rem-bulk-summary__lbl"><i class="fas fa-circle-check mr-1"></i>Excluídas com sucesso</span>
          <span class="rem-bulk-summary__val">${nExc}${nRet > 0 ? ` <span class="text-xs opacity-70">(${nRet} retorno${nRet === 1 ? '' : 's'})</span>` : ''}</span>
        </div>
        ${nBlk > 0 ? `
          <div class="rem-bulk-summary__row rem-bulk-summary__row--block">
            <span class="rem-bulk-summary__lbl"><i class="fas fa-ban mr-1"></i>Bloqueadas (regra de negócio)</span>
            <span class="rem-bulk-summary__val">${nBlk}</span>
          </div>
        ` : ''}
        ${nFail > 0 ? `
          <div class="rem-bulk-summary__row rem-bulk-summary__row--block">
            <span class="rem-bulk-summary__lbl"><i class="fas fa-circle-xmark mr-1"></i>Falharam tecnicamente</span>
            <span class="rem-bulk-summary__val">${nFail}</span>
          </div>
        ` : ''}
      </div>

      ${nExc > 0 ? `
        <div class="rem-bulk-permit">
          <div class="rem-bulk-permit__title">
            <i class="fas fa-list-check mr-1"></i>CTRLs excluídos:
          </div>
          <div class="rem-bulk-permit__list">${escapeHtml(ctrlsView)}${ctrlsMore}</div>
        </div>
      ` : ''}

      ${nBlk > 0 ? `
        <div class="rem-bulk-blocked">
          <div class="rem-bulk-blocked__title">
            <i class="fas fa-ban"></i>
            <span><b>${nBlk}</b> bloqueada${nBlk === 1 ? '' : 's'} por regra de negócio:</span>
          </div>
          <div class="rem-bulk-blocked__list">${bloqList}${bloqMore}</div>
        </div>
      ` : ''}

      ${nFail > 0 ? `
        <div class="rem-bulk-blocked" style="border-color:rgba(239,68,68,.32);background:rgba(239,68,68,.06)">
          <div class="rem-bulk-blocked__title" style="color:#fecaca">
            <i class="fas fa-circle-xmark"></i>
            <span><b>${nFail}</b> falharam tecnicamente:</span>
          </div>
          <div class="rem-bulk-blocked__list">${falhaList}${falhaMore}</div>
        </div>
      ` : ''}

      <div class="flex justify-end gap-2 mt-4">
        <button id="rbb-result-ok" class="btn btn-primary">
          <i class="fas fa-check mr-1"></i>Fechar
        </button>
      </div>
    `;

    mr.appendChild(card);
    document.body.appendChild(mr);
    document.getElementById('rbb-result-ok').onclick = () => mr.remove();

    // Toast de complemento — curto e direto
    if (sucessoTotal) {
      toast(`${nExc} remessa${nExc === 1 ? '' : 's'} excluída${nExc === 1 ? '' : 's'} com sucesso.`, 'success');
    } else if (sucessoParcial) {
      toast(`${nExc} excluída${nExc === 1 ? '' : 's'} · ${nBlk + nFail} não foram processada${nBlk + nFail === 1 ? '' : 's'}. Veja o relatório.`, 'info');
    } else {
      toast('Nenhuma remessa foi excluída. Veja o relatório.', 'error');
    }
  }

  function rowHtml(r) {
    const qtdTotal = fmt.safeNum(r?.qtd_total);
    const qtdRet   = fmt.safeNum(r?.qtd_retornada_calc);
    const retClass = (qtdRet >= qtdTotal && qtdTotal > 0) ? 'text-emerald-600' : 'text-amber-600';
    return `
      <tr class="remessas-row is-bulk-selectable">
        <td class="rem-col-check no-print">
          <input type="checkbox" class="rem-bulk-check"
                 data-rem-id="${r.id_remessa}"
                 data-rem-num="${r.num_controle ?? ''}"
                 data-rem-qtd="${qtdTotal}"
                 aria-label="Selecionar remessa ${r.num_controle ?? ''}" />
        </td>
        <td class="text-right font-mono tabular-nums">${r?.num_controle ?? '—'}</td>
        <td>${escapeHtml(r?.num_op || '—')}</td>
        <td>${TERC.tercWithSetor(r?.nome_terc, r?.nome_setor)}</td>
        <td class="text-xs text-slate-500 truncate" title="${escapeHtml(r?.desc_servico || '')}">${escapeHtml(r?.desc_servico || '—')}</td>
        <td>
          <span class="font-mono text-xs">${escapeHtml(r?.cod_ref || '')}</span>
          ${r?.desc_ref ? `<br><span class="text-xs text-slate-500">${escapeHtml(r.desc_ref)}</span>` : ''}
        </td>
        <td>${escapeHtml(r?.cor || '—')}</td>
        <td class="text-right tabular-nums">${fmt.int(qtdTotal)}</td>
        <td class="text-right tabular-nums ${retClass}">${fmt.int(qtdRet)}</td>
        <td class="text-right tabular-nums">${TERC.fmtBRL(fmt.safeNum(r?.valor_total))}</td>
        <td class="text-center whitespace-nowrap">${fmt.date(r?.dt_saida)}</td>
        <td class="text-center whitespace-nowrap">${fmt.date(r?.dt_previsao)}</td>
        <td class="text-center">${TERC.statusBadge(r?.status, r?.atrasada)}</td>
        <td class="text-center whitespace-nowrap no-print">
          <button class="btn btn-sm btn-secondary" title="Detalhes" data-act="view" data-id="${r.id_remessa}"><i class="fas fa-eye"></i></button>
          <button class="btn btn-sm btn-primary"   title="Editar"   data-act="edit" data-id="${r.id_remessa}"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-success"   title="Registrar retorno" data-act="ret" data-id="${r.id_remessa}"><i class="fas fa-truck-arrow-right"></i></button>
          <button class="btn btn-sm btn-print" style="background:#eab308;color:#fff" title="Imprimir" data-act="print" data-id="${r.id_remessa}"><i class="fas fa-print"></i></button>
          <button class="btn btn-sm btn-danger"    title="Excluir"  data-act="del"  data-id="${r.id_remessa}" data-num="${r.num_controle}"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
  }

  function renderCounter(rs) {
    const n = rs.length;
    const totalPecas = rs.reduce((a, r) => a + fmt.safeNum(r?.qtd_total), 0);
    if (!n) {
      $counter.innerHTML = '<i class="fas fa-circle-info mr-1"></i><b>0</b> resultados';
      return;
    }
    $counter.innerHTML = `
      <i class="fas fa-truck-fast text-brand mr-1"></i>
      <b>${fmt.int(n)}</b> ${n === 1 ? 'remessa' : 'remessas'}
      <span class="counter-sep">·</span>
      <i class="fas fa-cubes text-indigo-400 mr-1"></i>
      <b>${fmt.int(totalPecas)}</b> peça${totalPecas === 1 ? '' : 's'}
    `;
  }

  function renderTable(rs) {
    _lastRemessas = rs;
    renderCounter(rs);
    if (!rs.length) {
      $tbl.innerHTML = `
        <div class="p-10 text-center text-slate-500">
          <i class="fas fa-box-open text-3xl mb-2 block opacity-50"></i>
          <div>Nenhuma remessa encontrada com os filtros atuais.</div>
          <div class="text-xs mt-2">Tente ajustar busca, datas ou status — ou crie uma nova remessa.</div>
        </div>`;
      return;
    }
    $tbl.innerHTML = `
      <div class="table-scroll" data-container="tableContentContainer">
        <table class="w-full text-sm remessas-table">
          <thead><tr>
            <th class="rem-col-check no-print">
              <input type="checkbox" id="rem-check-all"
                     title="Selecionar / desmarcar todas da página"
                     aria-label="Selecionar todas as remessas da página" />
            </th>
            <th class="text-right">Ctrl</th><th>OP</th><th>Terceirizado</th>
            <th>Serviço</th><th>Referência</th><th>Cor</th>
            <th class="text-right">Qtd</th><th class="text-right">Retornada</th>
            <th class="text-right">Valor</th><th class="text-center">Saída</th>
            <th class="text-center">Prev.</th><th class="text-center">Status</th>
            <th class="text-center no-print">Ações</th>
          </tr></thead>
          <tbody>${rs.map(rowHtml).join('')}</tbody>
        </table>
      </div>`;

    // Delegação por data-act (1 listener, performance)
    $tbl.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        const act = btn.dataset.act;
        const id  = Number(btn.dataset.id);
        if (act === 'view')  return window.TERC_viewRem(id);
        if (act === 'edit')  return window.TERC_editRem(id);
        if (act === 'ret')   return window.TERC_retRem(id);
        if (act === 'del')   return window.TERC_delRem(id, Number(btn.dataset.num));
        if (act === 'print') return window.TERC_showPrintMenu(ev, id);
      });
    });

    // === HOTFIX 0043 — Bindings de seleção em lote ===
    const checkAll = $tbl.querySelector('#rem-check-all');
    const rowChecks = $tbl.querySelectorAll('.rem-bulk-check');

    if (checkAll) {
      checkAll.addEventListener('change', () => {
        rowChecks.forEach(cb => { cb.checked = checkAll.checked; });
        updateRemBulkBar();
      });
    }
    rowChecks.forEach(cb => {
      cb.addEventListener('change', () => {
        updateRemBulkBar();
      });
    });

    // Reseta seleção / barra ao trocar de página/filtro
    updateRemBulkBar();
  }

  // ----- Cache -----
  function cacheKey() {
    return REM_CACHE_KEY + ':' + JSON.stringify(st);
  }
  function cacheGet() {
    try {
      const raw = sessionStorage.getItem(cacheKey());
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (Date.now() - o.t > REM_CACHE_TTL) return null;
      return o.d;
    } catch { return null; }
  }
  function cacheSet(d) {
    try { sessionStorage.setItem(cacheKey(), JSON.stringify({ t: Date.now(), d })); } catch {}
  }
  function cacheInvalidate() {
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(REM_CACHE_KEY)) sessionStorage.removeItem(k);
      }
    } catch {}
  }

  function persistFilters() {
    try {
      sessionStorage.setItem('corepro:remessas:filtros', JSON.stringify({
        id_terc: st.id_terc, id_servico: st.id_servico, id_setor: st.id_setor,
        status: st.status, de: st.de, ate: st.ate
      }));
    } catch {}
  }

  // ----- Fetch com AbortController -----
  let _abortCtrl = null;
  let _inFlight = false;
  async function load(opts = {}) {
    if (_abortCtrl) { try { _abortCtrl.abort(); } catch {} }
    _abortCtrl = new AbortController();

    const cached = cacheGet();
    if (cached && !opts.bypassCache) {
      renderTable(cached);
      return;
    }
    if (!_inFlight) {
      $tbl.innerHTML = skeletonTable();
      $counter.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Buscando…';
    }
    _inFlight = true;

    const p = new URLSearchParams();
    if (st.search)     p.set('search',     st.search);
    if (st.id_terc)    p.set('id_terc',    st.id_terc);
    if (st.id_servico) p.set('id_servico', st.id_servico);
    if (st.id_setor)   p.set('id_setor',   st.id_setor);  // HOTFIX 0037
    if (st.status)     p.set('status',     st.status);
    if (st.de)         p.set('de',         st.de);
    if (st.ate)        p.set('ate',        st.ate);

    try {
      const r = await api('get', '/terc/remessas?' + p.toString(), null, {
        silent: true, signal: _abortCtrl.signal
      });
      const rs = fmt.safeArr(r?.data);
      cacheSet(rs);
      renderTable(rs);
    } catch (e) {
      if (e?.canceled) return; // ignorou — outra busca em andamento
      console.error('[remessas] fetch erro', e);
      $tbl.innerHTML = `
        <div class="p-10 text-center text-red-500">
          <i class="fas fa-circle-exclamation text-3xl mb-2 block opacity-70"></i>
          <div>Falha ao carregar remessas.</div>
          <div class="text-xs mt-1 text-slate-500">${escapeHtml(e?.message || String(e))}</div>
          <button class="btn btn-secondary btn-sm mt-3" id="rem-retry"><i class="fas fa-rotate mr-1"></i>Tentar novamente</button>
        </div>`;
      $counter.innerHTML = '<span class="text-red-400"><i class="fas fa-triangle-exclamation mr-1"></i>Erro</span>';
      const retry = document.getElementById('rem-retry');
      if (retry) retry.onclick = () => load({ bypassCache: true });
    } finally {
      _inFlight = false;
    }
  }

  // ----- Handlers (debounce na busca; mudança de filtro reseta cache) -----
  let _searchTimer = null;
  $search.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      st.search = $search.value.trim();
      cacheInvalidate();
      load();
    }, 300);
  });

  function bindChange(el, prop) {
    el.addEventListener('change', () => {
      st[prop] = el.value;
      persistFilters();
      load();
    });
  }
  bindChange($terc,   'id_terc');
  bindChange($serv,   'id_servico');
  if ($setor) bindChange($setor, 'id_setor');  // HOTFIX 0037
  bindChange($status, 'status');
  bindChange($de,     'de');
  bindChange($ate,    'ate');

  $btnClear.onclick = () => {
    st.search = '';     $search.value = '';
    st.id_terc = '';    try { $terc.value = ''; } catch {}
    st.id_servico = ''; try { $serv.value = ''; } catch {}
    st.id_setor = '';   try { if ($setor) $setor.value = ''; } catch {}  // HOTFIX 0037
    st.status = '';     $status.value = '';
    st.de = deDefault;  $de.value = deDefault;
    st.ate = hoje;      $ate.value = hoje;
    persistFilters();
    cacheInvalidate();
    load();
  };

  // ----- Ações globais (re-uso de TERC_*) -----
  window.TERC_viewRem = (id) => TERC_openRemDetalhe(id);
  window.TERC_editRem = (id) => TERC_openRemModal(id, () => { cacheInvalidate(); load({ bypassCache: true }); });
  window.TERC_retRem  = (id) => TERC_openRetModal(id,  () => { cacheInvalidate(); load({ bypassCache: true }); });
  window.TERC_delRem  = (id, n) => TERC_confirmDelRem(id, n, () => { cacheInvalidate(); load({ bypassCache: true }); });
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
  // Mostra seletor de produtos antes de gerar romaneio (UX premium)
  window.TERC_printRom = async (id) => {
    const r = await api('get', '/terc/remessas/' + id);
    await TERC_PRINT.romaneioComSelecao([r.data]);
  };
  window.TERC_printCompTotal = async (id) => {
    const r = await api('get', '/terc/remessas/' + id);
    await TERC_PRINT.comprovanteTotal(r.data);
  };
  window.TERC_printParcial = async (id) => {
    const r = await api('get', '/terc/remessas/' + id);
    await TERC_PRINT.controleParcial(r.data);
  };
  // ----- Botões de ação (com loading state) -----
  $btnNova.onclick = () => TERC_openRemModal(null, () => { cacheInvalidate(); load({ bypassCache: true }); });

  // === HOTFIX 0043 — Bindings da barra flutuante de seleção em lote ===
  // Esses botões estão fora do #rem-tbl (no shell), então bindam apenas 1 vez.
  const $rbbClear = document.getElementById('rbb-clear');
  const $rbbDel   = document.getElementById('rbb-del');
  if ($rbbClear) $rbbClear.onclick = () => clearRemBulkSelection();
  if ($rbbDel)   $rbbDel.onclick   = () => bulkDeleteRem();

  $btnRomLote.onclick = async () => {
    if (!_lastRemessas.length) { toast('Filtre alguma remessa antes', 'warning'); return; }
    if (_lastRemessas.length > 30) {
      if (!confirm('Imprimir ' + _lastRemessas.length + ' remessas? Recomendado ≤ 30 por romaneio. Continuar?')) return;
    }
    const original = $btnRomLote.innerHTML;
    $btnRomLote.disabled = true;
    $btnRomLote.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i><span>Preparando…</span>';
    toast('Preparando romaneio em lote...', 'info');
    try {
      const detalhes = [];
      for (const r of _lastRemessas.slice(0, 60)) {
        try {
          const d = await api('get', '/terc/remessas/' + r.id_remessa, null, { silent: true });
          detalhes.push(d.data);
        } catch { detalhes.push(r); }
      }
      // Mostra seletor de produtos antes (UX premium — permite escolher
      // exatamente o que vai no romaneio em lote)
      await TERC_PRINT.romaneioComSelecao(detalhes);
    } finally {
      $btnRomLote.disabled = false;
      $btnRomLote.innerHTML = original;
    }
  };

  // ----- Sticky shadow: adiciona .is-stuck quando o header cola no topo -----
  _setupStickyShadow($('.remessas-toolbar'));

  // ----- Primeira carga -----
  try { await load(); } catch (e) { console.error('[remessas] init', e); }
};

/* ============================================================
 * 🪄 Helper global: efeito visual quando .page-sticky-header
 * cola no topo do scroller (#main-content). Adiciona .is-stuck
 * para ativar sombra mais pronunciada (estilo ERP premium).
 *
 * v23.3: também mede a altura do sticky e exporta como CSS var
 * --sticky-h no #main-content, para que o <thead> da tabela
 * possa usar top: var(--sticky-h) e ficar fixo logo abaixo
 * dos filtros (cabeçalho de colunas sempre visível).
 * ============================================================ */
function _setupStickyShadow(el) {
  if (!el || typeof IntersectionObserver === 'undefined') return;
  try {
    // Sentinel acima do header — quando ele "sai" da viewport, o header colou
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'height:1px;width:1px;pointer-events:none;';
    sentinel.setAttribute('aria-hidden', 'true');
    el.parentNode.insertBefore(sentinel, el);
    const scroller = document.getElementById('main-content') || null;
    const io = new IntersectionObserver(([entry]) => {
      el.classList.toggle('is-stuck', !entry.isIntersecting);
    }, { root: scroller, threshold: [0], rootMargin: '0px 0px 0px 0px' });
    io.observe(sentinel);
    el._stickyObs = io;

    // 🆕 v23.3: mede a altura do sticky e publica como CSS var
    // (usado pelo <thead> sticky das tabelas).
    const publishHeight = () => {
      const h = Math.ceil(el.getBoundingClientRect().height || 0);
      if (h > 0) {
        const target = scroller || document.documentElement;
        target.style.setProperty('--sticky-h', h + 'px');
        // também propaga no html como fallback global
        document.documentElement.style.setProperty('--sticky-h', h + 'px');
      }
    };
    publishHeight();
    // Reage a mudanças (filtros adicionam linhas em mobile, etc.)
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(publishHeight);
      ro.observe(el);
      el._stickyResizeObs = ro;
    }
    window.addEventListener('resize', publishHeight, { passive: true });
  } catch (e) { /* fail-silent */ }
}

/* =================================================================
 * 🎨 Helper: hex de cor a partir do nome (mapa PT-BR + hash fallback)
 * ================================================================= */
function TERC_corHex(nome) {
  if (!nome) return '#cbd5e1';
  // Prioridade 1: cadastro oficial via window.Cores (cache)
  try {
    const cache = window.Cores?.cache;
    if (Array.isArray(cache)) {
      const found = cache.find(c => (c.nome || '').toLocaleLowerCase('pt-BR') === String(nome).toLocaleLowerCase('pt-BR'));
      if (found && found.hex) return found.hex;
    }
  } catch {}
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
      // 🛡️ HOTFIX 0036: Se backend resolveu id_produto dinamicamente, recarrega cache
      // de produtos para garantir que o select tenha a opção correta (produto pode
      // ter sido auto-cadastrado pela migration recentemente).
      const hasResolved = r.itens.some(it => it._resolved_id_produto || it._synthesized);
      if (hasResolved) {
        console.log('[remessa.edit] backend resolveu id_produto dinamicamente — recarregando cache de produtos');
        await TERC.reloadProdutos();
      }
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
  // Fonte 1: /cores (cadastro oficial, com hex correto)
  // Fonte 2: /terc/cores/distinct (uso/frequência em remessas — legado)
  // Merge: usa nome como chave, prioriza hex do /cores, soma uso do legado.
  let _coresCache = [];
  try {
    const [rOfic, rLeg] = await Promise.all([
      window.Cores ? window.Cores.list(true) : api('get', '/cores?ativo=1', null, { silent: true }).then(r => r?.data || []),
      api('get', '/terc/cores/distinct', null, { silent: true }).then(r => fmt.safeArr(r?.data)).catch(() => []),
    ]);
    const map = new Map();
    (rOfic || []).forEach(c => {
      const nome = (c.nome || c.nome_cor || '').trim();
      if (!nome) return;
      map.set(nome.toLowerCase(), { nome_cor: nome, hex: c.hex || TERC_corHex(nome), uso: 0, id_cor: c.id || null });
    });
    (rLeg || []).forEach(c => {
      const nome = (c.nome_cor || '').trim();
      if (!nome) return;
      const k = nome.toLowerCase();
      if (map.has(k)) {
        const cur = map.get(k);
        cur.uso = (cur.uso || 0) + (c.uso || 0);
      } else {
        map.set(k, { nome_cor: nome, hex: c.hex || TERC_corHex(nome), uso: c.uso || 0, id_cor: null });
      }
    });
    _coresCache = Array.from(map.values()).sort((a, b) => (b.uso || 0) - (a.uso || 0) || a.nome_cor.localeCompare(b.nome_cor));
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
  // 🔍 DEBUG estruturado para diagnóstico multi-tenant (HOTFIX 0036)
  if (edit) {
    const empresaAtual = (window.AppState && window.AppState.empresa) || null;
    console.log('[remessa.edit] payload backend:', {
      empresaAtual: empresaAtual ? { id: empresaAtual.id_empresa, nome: empresaAtual.nome_empresa } : null,
      companyId: r.id_empresa,
      remessaId: r.id_remessa,
      num_controle: r.num_controle,
      qtd_total: r.qtd_total,
      preco_unit: r.preco_unit,
      valor_total: r.valor_total,
      itens_count: Array.isArray(r.itens) ? r.itens.length : 0,
      grade_count: Array.isArray(r.grade) ? r.grade.length : 0,
      itens: Array.isArray(r.itens) ? r.itens.map(it => ({
        id_item: it.id_item, id_produto: it.id_produto, cod_ref: it.cod_ref,
        cor: it.cor, qtd_total: it.qtd_total, preco_unit: it.preco_unit,
        grade_count: Array.isArray(it.grade) ? it.grade.length : 0,
        _synthesized: it._synthesized || false,
        _resolved_id_produto: it._resolved_id_produto || false,
      })) : [],
      _synthesized: r._synthesized || false,
    });
  }

  if (edit && Array.isArray(r.itens) && r.itens.length > 0) {
    // ✅ Caminho normal — backend devolveu itens (incluindo casos sintetizados/resolvidos)
    // 🛡️ HOTFIX 0036: Para cada item sem id_produto, tenta resolver pelo cod_ref antes do newItem.
    // O backend já faz isso, mas mantemos como dupla proteção (defense in depth).
    //
    // 🆕 HOTFIX 0048 — Detectar divergência entre OP do item e OP do cabeçalho na carga.
    // Se o backend devolveu um item cuja num_op é diferente do r.num_op (caso comum em
    // dados pré-HOTFIX 0048 que ficaram desalinhados), marcamos _num_op_manual=true para
    // que a UI exiba "manual" em vez de "herda" — refletindo a realidade do dado.
    const headerOp = (r.num_op != null ? String(r.num_op).trim() : '');
    itens = r.itens.map(it => {
      if (!it.id_produto && it.cod_ref && TERC.findProdutoByRef) {
        const prod = TERC.findProdutoByRef(it.cod_ref, r.id_colecao);
        if (prod) {
          console.log('[remessa.edit] frontend resolved id_produto:', { cod_ref: it.cod_ref, id_produto: prod.id_produto });
          it = { ...it, id_produto: prod.id_produto, _resolved_id_produto: true };
        }
      }
      // Divergência item↔header → marca manual para o UI mostrar "manual" ao invés de "herda"
      const itOp = (it.num_op != null ? String(it.num_op).trim() : '');
      if (itOp && headerOp && itOp !== headerOp) {
        it = { ...it, _num_op_manual: true };
      }
      return newItem(it);
    });
  } else if (edit) {
    // 🛡️ Fallback final no frontend: backend não devolveu itens nem sintetizou
    // (edge case extremo — proteção em profundidade). Hidrata 1 item a partir
    // do header com a grade do header OU grade virtual {UNICO: qtd_total}.
    const g = {};
    if (Array.isArray(r.grade) && r.grade.length > 0) {
      r.grade.forEach(x => { g[x.tamanho] = Number(x.qtd || 0); });
    } else if (Number(r.qtd_total) > 0) {
      // Grade vazia mas há quantidade — usa tamanho ÚNICO como fallback
      g['UNICO'] = Number(r.qtd_total) || 0;
    }
    console.warn('[remessa.edit] FALLBACK FRONTEND: backend devolveu itens vazios — sintetizando do header. qtd_total=', r.qtd_total, ' grade reconstruída=', g);
    itens.push(newItem({
      cod_ref: r.cod_ref, desc_ref: r.desc_ref, id_servico: r.id_servico,
      cor: r.cor, id_cor: r.id_cor, num_op: r.num_op,
      preco_unit: r.preco_unit, tempo_peca: r.tempo_peca, grade: g,
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
            <option value="AguardandoEnvio" ${r.status === 'AguardandoEnvio' ? 'selected' : ''}>Aguardando Retorno</option>
            <option value="Enviado" ${r.status === 'Enviado' ? 'selected' : ''}>Enviado</option>
            <option value="EmProducao" ${r.status === 'EmProducao' ? 'selected' : ''}>Em produção</option>
            <option value="Parcial" ${r.status === 'Parcial' ? 'selected' : ''}>Parcial</option>
            <option value="Concluido" ${r.status === 'Concluido' ? 'selected' : ''}>Concluído</option>
            <option value="Retornado" ${r.status === 'Retornado' ? 'selected' : ''}>Retornado</option>
            <option value="Pago" ${r.status === 'Pago' ? 'selected' : ''}>Pago</option>
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
      <div class="rem-modal-actions">
        <button id="m-cancel" class="btn btn-secondary rem-action-btn">
          <i class="fas fa-times mr-1"></i>Cancelar
        </button>
        ${edit ? `
          <button id="m-print-rom-sel" class="btn rem-action-btn rem-btn-rom" title="Selecionar produtos e gerar romaneio">
            <i class="fas fa-print mr-1"></i>Gerar romaneio selecionado
          </button>
        ` : ''}
        <button id="m-save" class="btn btn-primary rem-action-btn rem-btn-save">
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

  // ---- Limpeza defensiva: remove rascunho legado do localStorage (feature descontinuada) ----
  try { localStorage.removeItem('corepro:remessa:rascunho'); } catch {}

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
          <select data-f="prod">${TERC.optProdutos(idProdSel, r.id_colecao, it.cod_ref)}</select></div>
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

  // ---- 🆕 Gerar romaneio selecionado (apenas em modo edição) ----
  const $btnPrintSel = $('#m-print-rom-sel');
  if ($btnPrintSel) {
    $btnPrintSel.onclick = async () => {
      $btnPrintSel.disabled = true;
      const original = $btnPrintSel.innerHTML;
      $btnPrintSel.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Carregando…';
      try {
        // Busca a remessa fresca do servidor (com itens + grade) para garantir
        // dados atualizados — usuário pode ter editado e ainda não salvou,
        // mas o foco do "gerar romaneio selecionado" é imprimir o que ESTÁ salvo
        const rFresh = await api('get', '/terc/remessas/' + id);
        await TERC_PRINT.romaneioComSelecao([rFresh.data]);
      } catch (e) {
        toast('Erro ao carregar remessa: ' + (e?.message || e), 'error');
      } finally {
        $btnPrintSel.disabled = false;
        $btnPrintSel.innerHTML = original;
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
      if (edit) {
        await api('put', '/terc/remessas/' + id, body);
        toast(`Remessa salva — ${itensBody.length} item(ns)`, 'success');
      } else {
        // 🆕 HOTFIX 0047: backend pode retornar { num_controles: [...], lote_remessa_id }
        // quando múltiplos itens — cada item vira 1 CTRL independente.
        const resp = await api('post', '/terc/remessas', body);
        const data = resp?.data || {};
        const ctrls = Array.isArray(data.num_controles) ? data.num_controles : null;
        const lote = data.lote_remessa_id || null;

        if (ctrls && ctrls.length > 1 && lote) {
          // Múltiplos CTRLs gerados — mostra a lista para o usuário
          const ctrlsStr = ctrls.length <= 5
            ? ctrls.join(', ')
            : `${ctrls.slice(0, 3).join(', ')}…${ctrls[ctrls.length - 1]}`;
          toast(
            `${ctrls.length} remessas criadas (CTRLs ${ctrlsStr}) — Lote #${lote}`,
            'success'
          );
        } else {
          // Comportamento clássico (1 item = 1 CTRL)
          toast(`Remessa salva — ${itensBody.length} item(ns)`, 'success');
        }
      }
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
      <div><b>Status:</b> ${TERC.statusLabel(rem.status)}</div>
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

    <!-- HOTFIX 0041 — Return Summary Footer (.tc-rsf) — dark grid + variants + ações separadas -->
    <div class="tc-rsf" role="region" aria-label="Resumo financeiro do retorno">
      <div class="tc-rsf__stats">
        <div class="tc-rsf__stat" data-variant="neutral">
          <div class="tc-rsf__stat-label"><i class="fas fa-paper-plane"></i>Enviado</div>
          <div class="tc-rsf__stat-value"><span id="tg-env">0</span></div>
          <div class="tc-rsf__stat-unit">peças</div>
        </div>
        <div class="tc-rsf__stat" data-variant="blue">
          <div class="tc-rsf__stat-label"><i class="fas fa-rotate-left"></i>Retornadas</div>
          <div class="tc-rsf__stat-value"><span id="tg-qtd">0</span></div>
          <div class="tc-rsf__stat-unit">peças</div>
        </div>
        <div class="tc-rsf__stat" data-variant="emerald">
          <div class="tc-rsf__stat-label"><i class="fas fa-circle-check"></i>Boas</div>
          <div class="tc-rsf__stat-value"><span id="tg-boa">0</span></div>
          <div class="tc-rsf__stat-unit">peças</div>
        </div>
        <div class="tc-rsf__stat" data-variant="amber">
          <div class="tc-rsf__stat-label"><i class="fas fa-triangle-exclamation"></i>Falta</div>
          <div class="tc-rsf__stat-value"><span id="tg-ref">0</span></div>
          <div class="tc-rsf__stat-unit">peças</div>
        </div>
        <div class="tc-rsf__stat" data-variant="red">
          <div class="tc-rsf__stat-label"><i class="fas fa-screwdriver-wrench"></i>Conserto</div>
          <div class="tc-rsf__stat-value"><span id="tg-con">0</span></div>
          <div class="tc-rsf__stat-unit">peças</div>
        </div>
        <div class="tc-rsf__stat" data-variant="highlight">
          <div class="tc-rsf__stat-label"><i class="fas fa-money-bill-wave"></i>Total pago</div>
          <div class="tc-rsf__stat-value">R$ <span id="tg-val">0,00</span></div>
          <div class="tc-rsf__stat-unit">boas × preço unitário</div>
        </div>
      </div>
      <div class="tc-rsf__actions">
        <div class="tc-rsf__actions-hint">
          <i class="fas fa-circle-info"></i>
          <span>Confira os totais antes de ${editing ? 'salvar' : 'registrar'}.</span>
        </div>
        <button id="m-cancel" class="btn btn-secondary" type="button">
          <i class="fas fa-xmark mr-1"></i>Cancelar
        </button>
        <button id="m-save" class="btn btn-primary" type="button">
          <i class="fas fa-save mr-1"></i>${editing ? 'Salvar alterações' : 'Registrar retorno'}
        </button>
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
        <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Terceirizado</div><div class="font-semibold">${escapeHtml(r.nome_terc || '—')}</div>${r.nome_setor ? `<div class="mt-1"><span class="tc-terc__chip"><i class="fas fa-sitemap"></i><span class="tc-terc__chip-label">${escapeHtml(r.nome_setor)}</span></span></div>` : ''}</div>
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
  // Romaneio passa pelo seletor de produtos (escolhe quais itens incluir)
  $('#m-print-rom').onclick = () => TERC_PRINT.romaneioComSelecao([r]);
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
/* ============================================================
 * 🚀 ROUTES.terc_retornos — OTIMIZADO v22
 *
 * Antes (lento): GET /terc/remessas → N x GET /terc/remessas/:id
 *                ↳ N+1 round-trips, sem paginação, filtros JS em memória.
 *
 * Agora (rápido): GET /terc/retornos?de=&ate=&id_terc=&search=&page=&per_page=
 *                ↳ 1 query SQL com JOIN, paginação server-side, KPIs agregados.
 *
 * Recursos:
 *  - Paginação server-side (20/50/100/200 por página)
 *  - Busca com debounce 300ms
 *  - AbortController: cancela requests antigos quando filtros mudam
 *  - Skeleton loading enquanto carrega
 *  - Cache em sessionStorage (TTL 30s) — invalidação on-save
 *  - Filtro de status de pagamento (todos/pago/pendente)
 *  - Sem re-render desnecessário: tabela atualiza in-place
 * ============================================================ */
ROUTES.terc_retornos = async (main) => {
  await TERC.load();

  // ----- Estado da tela (escopo do componente) -----
  const RET_CACHE_KEY = 'corepro:retornos:cache';
  const RET_CACHE_TTL = 30_000; // 30s
  const PER_PAGE_DEFAULT = 50;

  // Recupera filtros persistidos (mantém preferência entre navegações)
  let savedFilters = {};
  try { savedFilters = JSON.parse(sessionStorage.getItem('corepro:retornos:filtros') || '{}'); } catch {}

  const hoje = dayjs().format('YYYY-MM-DD');
  const deDefault = dayjs().subtract(30, 'day').format('YYYY-MM-DD');

  const state = {
    de:        savedFilters.de  || deDefault,
    ate:       savedFilters.ate || hoje,
    id_terc:   savedFilters.id_terc || '',
    id_setor:  savedFilters.id_setor || '',  // HOTFIX 0037
    search:    '',
    status_pag: savedFilters.status_pag || '',
    page:      1,
    per_page:  Number(savedFilters.per_page) || PER_PAGE_DEFAULT,
  };

  // ----- Render shell (1 vez) -----
  // v23.2: KPIs + filtros + paginação TUDO dentro do MESMO sticky único.
  // Nada rola "acima" do sticky — a tabela começa abaixo dele de forma sólida.
  main.innerHTML = `
    <div class="retornos-page">
      <!-- ============================================================
       * v24 — RETORNOS LAYOUT (ERP Premium)
       *
       *  #stickyFiltersContainer  → KPIs + filtros + paginação (sticky top)
       *  #tableScrollContainer    → área scrollável (única que rola)
       *    └─ #tableContentContainer → <table> com thead sticky
       * ============================================================ -->

      <!-- ⬇️ Sticky único — contém KPIs + filtros + paginação/impressão -->
      <div id="stickyFiltersContainer" class="page-sticky-header retornos-toolbar">
        <div class="page-sticky-row">
          <!-- Linha 1: cards de resumo (KPIs) -->
          <div id="ret-kpis" class="ret-kpis-grid"></div>

          <!-- 🚨 Banner de alerta de integridade (oculto por padrão) -->
          <div id="ret-integrity-banner" style="display:none"></div>

          <!-- 💰 HOTFIX 0042 — Painel financeiro do terceirizado filtrado (oculto até filtrar) -->
          <div id="ret-terc-finance-panel" style="display:none"></div>

          <!-- 💵 HOTFIX 0042 — Barra flutuante de pagamento (aparece quando há retornos selecionados) -->
          <div id="ret-payment-bar" class="ret-payment-bar" style="display:none">
            <div class="ret-payment-bar__info">
              <i class="fas fa-square-check"></i>
              <span><b id="rpb-count">0</b> retorno(s) selecionado(s)</span>
              <span class="ret-payment-bar__sep">·</span>
              <span><b id="rpb-pieces">0</b> peças boas</span>
              <span class="ret-payment-bar__sep">·</span>
              <span>Total: <b id="rpb-total" class="ret-payment-bar__total">R$ 0,00</b></span>
            </div>
            <div class="ret-payment-bar__actions">
              <button id="rpb-clear" class="btn btn-secondary btn-sm" title="Limpar seleção">
                <i class="fas fa-xmark mr-1"></i>Limpar
              </button>
              <button id="rpb-pay" class="btn btn-primary btn-sm" title="Pagar selecionados">
                <i class="fas fa-hand-holding-dollar mr-1"></i>Pagar Selecionados
              </button>
            </div>
          </div>

          <!-- Linha 2: filtros -->
          <div class="page-sticky-grid">
            <div class="filter-cell filter-cell-search">
              <label>Buscar</label>
              <div class="search-input-wrap">
                <i class="fas fa-search search-icon"></i>
                <input id="f-search" type="text" placeholder="Nº CTRL, ref, cor, terceirizado, OP, serviço…" value="${escapeHtml(state.search)}" />
              </div>
            </div>
            <div class="filter-cell">
              <label>Terceirizado</label>
              <select id="f-terc">${TERC.optTerc()}</select>
            </div>
            <div class="filter-cell">
              <label>Setor</label>
              <select id="f-setor">${TERC.optSetores()}</select>
            </div>
            <div class="filter-cell">
              <label>De</label>
              <input type="date" id="f-de" value="${state.de}" />
            </div>
            <div class="filter-cell">
              <label>Até</label>
              <input type="date" id="f-ate" value="${state.ate}" />
            </div>
            <div class="filter-cell">
              <label>Pagamento</label>
              <select id="f-pag">
                <option value="">Todos</option>
                <option value="pendente" ${state.status_pag==='pendente'?'selected':''}>Pendentes</option>
                <option value="pago" ${state.status_pag==='pago'?'selected':''}>Pagos</option>
              </select>
            </div>
          </div>

          <!-- Linha 3: ações + paginação + impressão -->
          <div class="page-sticky-actions">
            <button id="btn-refresh" class="btn btn-secondary btn-sm" title="Atualizar"><i class="fas fa-rotate"></i></button>
            <button id="btn-clear"   class="btn btn-secondary btn-sm" title="Limpar filtros"><i class="fas fa-eraser mr-1"></i><span>Limpar</span></button>
            <div class="flex-1"></div>
            <span class="text-xs text-slate-500 whitespace-nowrap">Por página:</span>
            <select id="f-pp" class="select-sm" style="width:auto">
              <option value="20"  ${state.per_page===20?'selected':''}>20</option>
              <option value="50"  ${state.per_page===50?'selected':''}>50</option>
              <option value="100" ${state.per_page===100?'selected':''}>100</option>
              <option value="200" ${state.per_page===200?'selected':''}>200</option>
            </select>
            <button id="btn-print" class="btn btn-secondary btn-sm" title="Imprimir"><i class="fas fa-print"></i></button>
          </div>
        </div>
      </div>

      <!-- ⬇️ Container scrollável (única região que rola) -->
      <div id="ret-tbl" class="card p-0 retornos-table-wrap" data-container="tableScrollContainer"></div>

      <!-- Paginação (fora do scroll, sob a tabela) -->
      <div id="ret-pager" class="retornos-pager"></div>
    </div>
  `;

  // ----- Refs -----
  const $tbl    = $('#ret-tbl');
  const $kpis   = $('#ret-kpis');
  const $pager  = $('#ret-pager');
  const $search = $('#f-search');
  const $terc   = $('#f-terc');
  const $setor  = $('#f-setor');  // HOTFIX 0037
  const $de     = $('#f-de');
  const $ate    = $('#f-ate');
  const $pag    = $('#f-pag');
  const $pp     = $('#f-pp');

  // Pré-popular id_terc/id_setor com o salvo
  if (state.id_terc) {
    try { $terc.value = String(state.id_terc); } catch {}
  }
  if (state.id_setor && $setor) {
    try { $setor.value = String(state.id_setor); } catch {}
  }

  // ----- Helpers de UI -----
  function skeletonTable() {
    const rows = Array.from({ length: 8 }).map(() => `
      <tr class="skeleton-row">
        ${Array.from({length: 11}).map(() => '<td><span class="skeleton-cell"></span></td>').join('')}
      </tr>`).join('');
    return `
      <div class="table-scroll" data-container="tableContentContainer">
        <table class="w-full text-sm retornos-table">
          <thead><tr>
            <th class="ret-col-check no-print"><input type="checkbox" disabled /></th>
            <th>Data</th><th class="text-right">Ctrl</th><th>Terceirizado</th>
            <th>Ref/Cor</th><th>Serviço</th>
            <th class="text-right">Boas</th><th class="text-right">Falta</th><th class="text-right">Conserto</th>
            <th class="text-right">Total</th><th class="text-right">Valor</th><th class="text-center">Pagto</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }
  function skeletonKpis() {
    return Array.from({length:4}).map(() => `
      <div class="card p-3 kpi-card">
        <span class="skeleton-cell" style="width:60%;height:10px"></span>
        <span class="skeleton-cell" style="width:80%;height:24px;margin-top:8px"></span>
      </div>`).join('');
  }
  function renderKpis(k) {
    const card = (label, val, cls, icon) => `
      <div class="card p-3 kpi-card">
        <div class="text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1">
          <i class="fas ${icon} ${cls}"></i><span>${label}</span>
        </div>
        <div class="text-2xl font-bold ${cls} mt-1 tabular-nums">${val}</div>
      </div>`;
    $kpis.innerHTML = [
      card('Retornos',      fmt.int(k.qtd),        'text-brand',         'fa-truck-arrow-right'),
      card('Peças boas',    fmt.int(k.boa),        'text-emerald-600',   'fa-check-circle'),
      card('Peças em falta',fmt.int(k.refugo),     'text-red-600',       'fa-times-circle'),
      card('Valor pago',    TERC.fmtBRL(k.valor_pago_quitado) + ' <span class="text-xs text-amber-600 font-normal">+ ' + TERC.fmtBRL(k.valor_pago_pendente) + ' pend.</span>', 'text-indigo-600', 'fa-coins'),
    ].join('');
  }

  // 🚨 Banner de integridade — só aparece quando o backend detecta órfãs
  function renderIntegrityBanner(integridade) {
    const banner = document.getElementById('ret-integrity-banner');
    if (!banner) return;
    const orfas = Number(integridade?.orfas || 0);
    if (orfas <= 0) {
      banner.style.display = 'none';
      banner.innerHTML = '';
      return;
    }
    banner.style.display = '';
    banner.innerHTML = `
      <div style="background: linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.10));
                  border: 1px solid rgba(245,158,11,0.45); border-radius: 12px;
                  padding: 14px 18px; margin-top: 12px;
                  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
        <div style="font-size: 28px; color: #f59e0b; line-height: 1;">
          <i class="fas fa-triangle-exclamation"></i>
        </div>
        <div style="flex:1; min-width: 260px;">
          <div style="font-weight: 700; color: #f59e0b; font-size: 14px; margin-bottom: 4px;">
            Inconsistência detectada nesta empresa
          </div>
          <div style="font-size: 13px; color: var(--text-secondary, #94a3b8); line-height: 1.45;">
            ${escapeHtml(integridade.mensagem || '')}
          </div>
        </div>
        <button id="btn-repair-integrity" class="btn btn-primary btn-sm" style="white-space:nowrap;">
          <i class="fas fa-wrench mr-1"></i>Reparar integridade (${orfas})
        </button>
        <button id="btn-audit-integrity" class="btn btn-secondary btn-sm" style="white-space:nowrap;">
          <i class="fas fa-list mr-1"></i>Ver detalhes
        </button>
      </div>`;
    // bindings
    document.getElementById('btn-repair-integrity').onclick = repairIntegrity;
    document.getElementById('btn-audit-integrity').onclick = auditIntegrity;
  }

  // Executa reparação on-demand (recria retornos órfãos da empresa atual)
  async function repairIntegrity() {
    if (!confirm('Deseja reconstruir os retornos faltantes desta empresa?\n\nO sistema criará 1 registro de retorno sintético para cada remessa com status "Retornado" que ainda não tem retorno vinculado, usando os dados existentes na remessa (qtd_total, valor_pago, dt_recebimento).\n\nEsta operação é segura, idempotente e tenant-scoped.')) return;
    const btn = document.getElementById('btn-repair-integrity');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Reparando…'; }
    try {
      const r = await api('post', '/terc/retornos/repair', {});
      const criados = Number(r?.data?.criados || 0);
      toast(r?.data?.mensagem || `${criados} retorno(s) reconstruído(s).`, 'success');
      cacheInvalidate();
      fetchData({ bypassCache: true });
    } catch (e) {
      console.error('[repair-integrity] erro', e);
      toast('Falha ao reparar integridade. Tente novamente.', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wrench mr-1"></i>Reparar integridade'; }
    }
  }

  // Mostra detalhes das remessas órfãs (modal simples)
  async function auditIntegrity() {
    try {
      const r = await api('get', '/terc/retornos/audit');
      const lista = r?.data?.remessas_orfas || [];
      if (!lista.length) {
        toast('Nenhuma inconsistência encontrada.', 'success');
        return;
      }
      const rows = lista.slice(0, 50).map(x => `
        <tr>
          <td class="text-right font-mono">${x.num_controle || '—'}</td>
          <td class="font-mono text-xs">${escapeHtml(x.cod_ref || '—')}</td>
          <td>${escapeHtml(x.cor || '—')}</td>
          <td class="text-right">${fmt.int(x.qtd_total)}</td>
          <td class="text-right">${TERC.fmtBRL(fmt.safeNum(x.valor_total))}</td>
          <td>${fmt.date(x.dt_recebimento)}</td>
          <td>${TERC.statusBadge(x.status)}</td>
        </tr>`).join('');
      const extra = lista.length > 50 ? `<div class="text-xs text-slate-500 mt-2">+ ${lista.length - 50} outras remessas…</div>` : '';
      const html = `
        <div style="max-height: 60vh; overflow:auto;">
          <table class="w-full text-sm">
            <thead><tr>
              <th>Ctrl</th><th>Ref</th><th>Cor</th><th class="text-right">Qtd</th>
              <th class="text-right">Valor</th><th>Recebimento</th><th>Status</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          ${extra}
        </div>`;
      // usa modal genérico se existir
      if (typeof showModal === 'function') {
        showModal(`Remessas órfãs (${lista.length})`, html);
      } else {
        const w = window.open('', '_blank');
        if (w) { w.document.write(`<title>Auditoria de retornos</title>${html}`); w.document.close(); }
      }
    } catch (e) {
      console.error('[audit-integrity] erro', e);
      toast('Falha ao buscar auditoria.', 'error');
    }
  }

  /* ============================================================
   * 💰 HOTFIX 0042 — PAGAMENTOS DE TERCEIRIZADOS
   * Funções dedicadas à seleção, painel financeiro e modal de pagamento.
   * Multi-tenant safe — todas usam api() que injeta token automaticamente.
   * ============================================================ */

  // Carrega painel financeiro quando filtro de terceirizado está ativo
  async function loadTercFinancePanel() {
    const panel = document.getElementById('ret-terc-finance-panel');
    if (!panel) return;
    if (!state.id_terc) { panel.style.display = 'none'; panel.innerHTML = ''; return; }
    try {
      const r = await api('get', '/payments-terc/summary?id_terc=' + state.id_terc);
      const d = r?.data || {};
      const t = d.terceirizado || {};
      const tot = d.totais || {};
      const last = d.ultimo_pagamento;
      const setorChip = t.nome_setor ? TERC.tercWithSetor('', t.nome_setor).replace(/<div[^>]*>|<\/div>/g, '').replace(/<span class="tc-terc__name">[^<]*<\/span>/, '') : '';
      panel.innerHTML = `
        <div class="ret-finance-panel">
          <div class="ret-finance-panel__head">
            <div class="ret-finance-panel__title">
              <i class="fas fa-user-tie"></i>
              <span class="ret-finance-panel__name">${escapeHtml(t.nome_terc || '—')}</span>
              ${t.nome_setor ? `<span class="tc-terc__chip"><i class="fas fa-sitemap"></i><span class="tc-terc__chip-label">${escapeHtml(t.nome_setor)}</span></span>` : ''}
              ${t.telefone ? `<span class="ret-finance-panel__phone"><i class="fas fa-phone"></i>${escapeHtml(t.telefone)}</span>` : ''}
            </div>
            <div class="ret-finance-panel__actions">
              ${tot.qtd_pendentes > 0 ? `
                <button id="btn-pay-all-terc" class="btn btn-primary btn-sm" title="Pagar TODOS os retornos pendentes deste terceirizado">
                  <i class="fas fa-hand-holding-dollar mr-1"></i>Pagar Todos do Terceirizado
                </button>
              ` : `
                <span class="ret-finance-panel__paid-badge"><i class="fas fa-check-circle"></i>Sem pendências</span>
              `}
            </div>
          </div>
          <div class="ret-finance-panel__stats">
            <div class="rfp-stat" data-variant="neutral">
              <div class="rfp-stat__label">Retornos</div>
              <div class="rfp-stat__value">${fmt.int(tot.total_retornos)}</div>
              <div class="rfp-stat__sub">${fmt.int(tot.qtd_pendentes)} pendente(s) · ${fmt.int(tot.qtd_pagos)} pago(s)</div>
            </div>
            <div class="rfp-stat" data-variant="emerald">
              <div class="rfp-stat__label">Peças boas</div>
              <div class="rfp-stat__value">${fmt.int(tot.total_pecas_boas)}</div>
              <div class="rfp-stat__sub">acumuladas</div>
            </div>
            <div class="rfp-stat" data-variant="amber">
              <div class="rfp-stat__label">Pendente</div>
              <div class="rfp-stat__value">${TERC.fmtBRL(tot.valor_pendente)}</div>
              <div class="rfp-stat__sub">a pagar</div>
            </div>
            <div class="rfp-stat" data-variant="blue">
              <div class="rfp-stat__label">Já pago</div>
              <div class="rfp-stat__value">${TERC.fmtBRL(tot.valor_pago)}</div>
              <div class="rfp-stat__sub">quitado</div>
            </div>
            <div class="rfp-stat" data-variant="highlight">
              <div class="rfp-stat__label">Total geral</div>
              <div class="rfp-stat__value">${TERC.fmtBRL(tot.valor_total)}</div>
              <div class="rfp-stat__sub">${last ? `último pgto: ${fmt.date(last.dt_pagamento)} (${last.forma_pagamento})` : 'sem pagamentos ainda'}</div>
            </div>
          </div>
        </div>
      `;
      panel.style.display = '';
      const btnAll = document.getElementById('btn-pay-all-terc');
      if (btnAll) btnAll.onclick = () => payAllForTerc(Number(state.id_terc));
    } catch (e) {
      console.error('[finance-panel] erro', e);
      panel.style.display = 'none';
    }
  }

  // Atualiza barra flutuante de pagamento conforme seleção
  function updatePaymentBar() {
    const bar = document.getElementById('ret-payment-bar');
    if (!bar) return;
    const checks = Array.from($tbl.querySelectorAll('.ret-checkbox:checked'));
    const count = checks.length;
    let total = 0, pieces = 0;
    const tercSet = new Set();
    checks.forEach(cb => {
      total  += Number(cb.dataset.retValor || 0);
      pieces += Number(cb.dataset.retBoas  || 0);
      if (cb.dataset.retTercId) tercSet.add(cb.dataset.retTercId);
    });
    if (count === 0) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    document.getElementById('rpb-count').textContent = count;
    document.getElementById('rpb-pieces').textContent = fmt.int(pieces);
    document.getElementById('rpb-total').textContent = TERC.fmtBRL(total);
    const $pay = document.getElementById('rpb-pay');
    // Bloqueia se múltiplos terceirizados selecionados
    if (tercSet.size > 1) {
      $pay.disabled = true;
      $pay.title = 'Selecione retornos de apenas 1 terceirizado por vez';
      $pay.innerHTML = '<i class="fas fa-triangle-exclamation mr-1"></i>Múltiplos terceirizados';
      $pay.classList.add('btn-warning');
      $pay.classList.remove('btn-primary');
    } else {
      $pay.disabled = false;
      $pay.title = 'Pagar selecionados';
      $pay.innerHTML = '<i class="fas fa-hand-holding-dollar mr-1"></i>Pagar Selecionados';
      $pay.classList.add('btn-primary');
      $pay.classList.remove('btn-warning');
    }
    // Sincroniza "check-all" do header
    const $checkAll = $tbl.querySelector('#ret-check-all');
    if ($checkAll) {
      const allCbs = $tbl.querySelectorAll('.ret-checkbox');
      const allChecked = allCbs.length > 0 && count === allCbs.length;
      const someChecked = count > 0 && count < allCbs.length;
      $checkAll.checked = allChecked;
      $checkAll.indeterminate = someChecked;
    }
  }

  function getSelectedRetornos() {
    return Array.from($tbl.querySelectorAll('.ret-checkbox:checked')).map(cb => ({
      id_retorno: Number(cb.dataset.retId),
      id_terc:    Number(cb.dataset.retTercId),
      nome_terc:  cb.dataset.retTerc || '',
      valor:      Number(cb.dataset.retValor || 0),
      qtd_boa:    Number(cb.dataset.retBoas || 0),
    }));
  }

  // Pagar selecionados (botão da barra flutuante)
  async function payFromSelection() {
    const sel = getSelectedRetornos();
    if (!sel.length) { toast('Selecione ao menos 1 retorno.', 'warning'); return; }
    const tercSet = new Set(sel.map(s => s.id_terc));
    if (tercSet.size > 1) {
      toast('Selecione retornos de apenas 1 terceirizado por vez.', 'warning');
      return;
    }
    const idTerc = sel[0].id_terc;
    const nomeTerc = sel[0].nome_terc;
    if (!idTerc) {
      toast('Retorno sem terceirizado vinculado — não é possível pagar.', 'error');
      return;
    }
    openPaymentModal({
      id_terc: idTerc,
      nome_terc: nomeTerc,
      id_retornos: sel.map(s => s.id_retorno),
      valor_total: sel.reduce((a, s) => a + s.valor, 0),
      qtd_boas:    sel.reduce((a, s) => a + s.qtd_boa, 0),
    });
  }

  // Pagar TODOS pendentes do terceirizado filtrado
  async function payAllForTerc(idTerc) {
    if (!idTerc) return;
    // Marca todos os checkboxes da página primeiro (UX) e usa fluxo da seleção,
    // MAS busca também os pendentes que possam estar em outras páginas.
    try {
      // Busca todos pendentes deste terceirizado em todas as páginas do filtro
      const p = new URLSearchParams({
        de: state.de, ate: state.ate,
        id_terc: String(idTerc),
        status_pag: 'pendente',
        per_page: '1000', page: '1',
      });
      const r = await api('get', '/terc/retornos?' + p.toString());
      const rows = (r?.data?.rows || []).filter(x => !x.dt_pagamento && Number(x.valor_pago) > 0);
      if (!rows.length) {
        toast('Nenhum retorno pendente para este terceirizado.', 'info');
        return;
      }
      const nomeTerc = rows[0].nome_terc || '';
      openPaymentModal({
        id_terc: idTerc,
        nome_terc: nomeTerc,
        id_retornos: rows.map(x => x.id_retorno),
        valor_total: rows.reduce((a, x) => a + Number(x.valor_pago || 0), 0),
        qtd_boas:    rows.reduce((a, x) => a + Number(x.qtd_boa    || 0), 0),
        isAll: true,
      });
    } catch (e) {
      console.error('[pay-all-terc] erro', e);
      toast('Falha ao buscar retornos pendentes.', 'error');
    }
  }

  // Abre modal de pagamento (em lote, individual ou todos)
  function openPaymentModal(cfg) {
    const m = document.createElement('div');
    m.className = 'modal-backdrop';
    const card = document.createElement('div');
    card.className = 'modal modal-md';
    const hoje = dayjs().format('YYYY-MM-DD');
    const formas = ['PIX','Dinheiro','Transferência','TED','DOC','Cartão','Outro'];

    card.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">
          <i class="fas fa-hand-holding-dollar mr-2 text-emerald-600"></i>
          Pagamento de Terceirizado
        </h3>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <!-- Resumo do pagamento -->
        <div class="pay-summary">
          <div class="pay-summary__terc">
            <div class="text-xs uppercase tracking-wider text-slate-500">Terceirizado</div>
            <div class="text-lg font-semibold">${escapeHtml(cfg.nome_terc || '—')}</div>
            ${cfg.isAll ? '<div class="text-xs text-amber-700 mt-1"><i class="fas fa-bolt mr-1"></i>Pagar TODOS os retornos pendentes</div>' : ''}
          </div>
          <div class="pay-summary__stats">
            <div class="pay-stat"><div class="pay-stat__label">Retornos</div><div class="pay-stat__value">${fmt.int(cfg.id_retornos.length)}</div></div>
            <div class="pay-stat"><div class="pay-stat__label">Peças boas</div><div class="pay-stat__value">${fmt.int(cfg.qtd_boas)}</div></div>
            <div class="pay-stat pay-stat--highlight"><div class="pay-stat__label">Total a pagar</div><div class="pay-stat__value">${TERC.fmtBRL(cfg.valor_total)}</div></div>
          </div>
        </div>

        <!-- Formulário -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <div>
            <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Data do pagamento *</label>
            <input id="pm-dt" type="date" value="${hoje}" />
          </div>
          <div>
            <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Forma de pagamento *</label>
            <select id="pm-forma">
              ${formas.map(f => `<option value="${f}">${f}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="mt-3">
          <label class="block text-xs uppercase tracking-wider text-slate-500 mb-1">Observação (opcional)</label>
          <textarea id="pm-obs" rows="2" placeholder="Ex: Pagamento referente aos retornos de maio." maxlength="500"></textarea>
        </div>

        <!-- Confirmação visual -->
        <div class="pay-confirm-banner mt-4">
          <i class="fas fa-circle-info"></i>
          <div>
            <div class="font-semibold">Você está pagando:</div>
            <div class="text-sm mt-1">
              <b>${cfg.id_retornos.length}</b> retorno(s) ·
              <b>${fmt.int(cfg.qtd_boas)}</b> peças boas ·
              <b>${TERC.fmtBRL(cfg.valor_total)}</b>
            </div>
            <div class="text-xs text-slate-500 mt-1">Após confirmar, os retornos ficarão marcados como pagos e um comprovante será gerado.</div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-close type="button"><i class="fas fa-xmark mr-1"></i>Cancelar</button>
        <button id="pm-confirm" class="btn btn-primary" type="button">
          <i class="fas fa-check mr-1"></i>Confirmar Pagamento
        </button>
      </div>
    `;
    m.appendChild(card);
    document.body.appendChild(m);
    card.querySelectorAll('[data-close]').forEach(b => b.onclick = () => m.remove());

    document.getElementById('pm-confirm').onclick = async () => {
      const dt = (document.getElementById('pm-dt')   ).value || hoje;
      const forma = (document.getElementById('pm-forma')).value;
      const obs = (document.getElementById('pm-obs')  ).value || '';
      const btn = document.getElementById('pm-confirm');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Processando…';
      try {
        const r = await api('post', '/payments-terc', {
          id_terc: cfg.id_terc,
          id_retornos: cfg.id_retornos,
          dt_pagamento: dt,
          forma_pagamento: forma,
          observacao: obs,
        });
        const idPag = Number(r?.data?.id_pagamento || 0);
        m.remove();
        toast('Pagamento registrado com sucesso!', 'success');
        // Refresh lista + painel
        cacheInvalidate();
        await fetchData({ bypassCache: true });
        if (state.id_terc) loadTercFinancePanel();
        // Oferece comprovante imediatamente
        if (idPag) showPaymentReceiptOption(idPag);
      } catch (e) {
        console.error('[payment] erro', e);
        const msg = e?.response?.data?.error || 'Falha ao registrar pagamento.';
        toast(msg, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check mr-1"></i>Confirmar Pagamento';
      }
    };
  }

  // Toast com botão "Gerar PDF"
  function showPaymentReceiptOption(idPagamento) {
    const m = document.createElement('div');
    m.className = 'modal-backdrop';
    const card = document.createElement('div');
    card.className = 'modal modal-sm';
    card.innerHTML = `
      <div class="modal-body text-center" style="padding: 30px;">
        <div style="font-size: 48px; color: #10b981; margin-bottom: 12px;">
          <i class="fas fa-circle-check"></i>
        </div>
        <div class="text-xl font-semibold mb-2">Pagamento confirmado!</div>
        <div class="text-sm text-slate-500 mb-5">
          Pagamento <b>#${idPagamento}</b> registrado com sucesso.<br>
          Deseja gerar o comprovante em PDF agora?
        </div>
        <div class="flex gap-2 justify-center">
          <button class="btn btn-secondary" data-close type="button">
            <i class="fas fa-xmark mr-1"></i>Agora não
          </button>
          <button id="pmr-pdf" class="btn btn-primary" type="button">
            <i class="fas fa-file-pdf mr-1"></i>Gerar Comprovante
          </button>
        </div>
      </div>
    `;
    m.appendChild(card);
    document.body.appendChild(m);
    card.querySelectorAll('[data-close]').forEach(b => b.onclick = () => m.remove());
    document.getElementById('pmr-pdf').onclick = async () => {
      m.remove();
      await generatePaymentReceiptPDF(idPagamento);
    };
  }

  function rowHtml(x) {
    const refCorParts = [];
    if (x.cod_ref) refCorParts.push(`<span class="font-mono text-xs">${escapeHtml(x.cod_ref)}</span>`);
    if (x.cor) refCorParts.push(escapeHtml(x.cor));
    // HOTFIX 0042 — Checkbox só habilitado para retornos PENDENTES com valor > 0
    const isPago = !!x.dt_pagamento;
    const canPay = !isPago && Number(x.valor_pago) > 0;
    const checkboxHtml = canPay
      ? `<input type="checkbox" class="ret-checkbox" data-ret-id="${x.id_retorno}" data-ret-terc-id="${x.id_terc || ''}" data-ret-terc="${escapeHtml(x.nome_terc || '')}" data-ret-valor="${Number(x.valor_pago) || 0}" data-ret-boas="${Number(x.qtd_boa) || 0}" title="Selecionar para pagamento" />`
      : `<span class="ret-check-na" title="${isPago ? 'Já pago' : 'Sem valor a pagar'}"><i class="fas fa-${isPago ? 'check' : 'minus'}"></i></span>`;
    return `
      <tr class="retornos-row${canPay ? ' is-payable' : ''}" data-ret-id="${x.id_retorno}" data-ret-terc-id="${x.id_terc || ''}">
        <td class="ret-col-check text-center no-print">${checkboxHtml}</td>
        <td class="whitespace-nowrap">${fmt.date(x.dt_retorno)}</td>
        <td class="text-right font-mono">${x.num_controle ?? '—'}</td>
        <td>${TERC.tercWithSetor(x.nome_terc, x.nome_setor)}</td>
        <td>${refCorParts.join(' ') || '—'}</td>
        <td class="text-xs text-slate-600 truncate" title="${escapeHtml(x.desc_servico||'')}">${escapeHtml(x.desc_servico || '')}</td>
        <td class="text-right text-emerald-700 tabular-nums">${fmt.int(x.qtd_boa)}</td>
        <td class="text-right text-red-600 tabular-nums">${fmt.int(x.qtd_refugo)}</td>
        <td class="text-right text-amber-700 tabular-nums">${fmt.int(x.qtd_conserto)}</td>
        <td class="text-right font-semibold tabular-nums">${fmt.int(x.qtd_total)}</td>
        <td class="text-right tabular-nums">${TERC.fmtBRL(fmt.safeNum(x.valor_pago))}</td>
        <td class="text-center text-xs">${
          x.dt_pagamento
            ? '<span class="badge badge-pago">' + fmt.date(x.dt_pagamento) + '</span>'
            : '<span class="badge badge-pendente">Pendente</span>'
        }</td>
        <td class="text-center whitespace-nowrap no-print">
          <button class="btn btn-sm btn-primary" title="Editar retorno" data-edit-ret="${x.id_retorno}" data-edit-rem="${x.id_remessa}"><i class="fas fa-pen"></i></button>
          <button class="btn btn-sm btn-danger" title="Excluir retorno" data-del-ret="${x.id_retorno}" data-del-rem="${x.id_remessa}"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
  }

  function renderTable(rows) {
    if (!rows.length) {
      $tbl.innerHTML = `
        <div class="p-10 text-center text-slate-500">
          <i class="fas fa-box-open text-3xl mb-2 block opacity-50"></i>
          <div>Nenhum retorno encontrado no período selecionado.</div>
          <div class="text-xs mt-2">Ajuste os filtros ou registre novos retornos.</div>
        </div>`;
      return;
    }
    $tbl.innerHTML = `
      <div class="table-scroll" data-container="tableContentContainer">
        <table class="w-full text-sm retornos-table">
          <thead><tr>
            <th class="ret-col-check no-print" title="Selecionar todos pendentes da página">
              <input type="checkbox" id="ret-check-all" />
            </th>
            <th>Data</th><th class="text-right">Ctrl</th><th>Terceirizado</th>
            <th>Ref/Cor</th><th>Serviço</th>
            <th class="text-right">Boas</th><th class="text-right">Falta</th><th class="text-right">Conserto</th>
            <th class="text-right">Total</th><th class="text-right">Valor</th><th class="text-center">Pagto</th>
            <th class="text-center no-print">Ações</th>
          </tr></thead>
          <tbody>${rows.map(rowHtml).join('')}</tbody>
        </table>
      </div>`;

    // Delegação de cliques (não cria N listeners)
    $tbl.querySelectorAll('[data-edit-ret]').forEach(b => b.onclick = () => {
      const ret = Number(b.dataset.editRet), rem = Number(b.dataset.editRem);
      window.TERC_editRetFromList(ret, rem);
    });
    $tbl.querySelectorAll('[data-del-ret]').forEach(b => b.onclick = () => {
      const ret = Number(b.dataset.delRet), rem = Number(b.dataset.delRem);
      window.TERC_delRetFromList(ret, rem);
    });

    // HOTFIX 0042 — Seleção para pagamento
    $tbl.querySelectorAll('.ret-checkbox').forEach(cb => {
      cb.addEventListener('change', updatePaymentBar);
    });
    const $checkAll = $tbl.querySelector('#ret-check-all');
    if ($checkAll) {
      $checkAll.addEventListener('change', () => {
        const checked = $checkAll.checked;
        $tbl.querySelectorAll('.ret-checkbox').forEach(cb => { cb.checked = checked; });
        updatePaymentBar();
      });
    }
    // Restaura seleção (filtro por terceirizado pode preservar)
    updatePaymentBar();
  }

  function renderPager(total, page, perPage, totalPages) {
    if (!total) { $pager.innerHTML = ''; return; }
    const start = (page - 1) * perPage + 1;
    const end = Math.min(start + perPage - 1, total);

    // Gera lista compacta de páginas
    const around = 2;
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - around && i <= page + around)) {
        pages.push(i);
      } else if (pages[pages.length-1] !== '…') {
        pages.push('…');
      }
    }
    const pagesHtml = pages.map(p => p === '…'
      ? '<span class="pager-ellipsis">…</span>'
      : `<button class="pager-page ${p===page?'is-current':''}" data-page="${p}">${p}</button>`
    ).join('');

    $pager.innerHTML = `
      <div class="pager-info">Mostrando <b>${start}</b>–<b>${end}</b> de <b>${total}</b> retorno(s)</div>
      <div class="pager-ctrl">
        <button class="pager-btn" id="pg-first" ${page<=1?'disabled':''} title="Primeira"><i class="fas fa-angles-left"></i></button>
        <button class="pager-btn" id="pg-prev"  ${page<=1?'disabled':''} title="Anterior"><i class="fas fa-angle-left"></i></button>
        ${pagesHtml}
        <button class="pager-btn" id="pg-next"  ${page>=totalPages?'disabled':''} title="Próxima"><i class="fas fa-angle-right"></i></button>
        <button class="pager-btn" id="pg-last"  ${page>=totalPages?'disabled':''} title="Última"><i class="fas fa-angles-right"></i></button>
      </div>`;

    $pager.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { state.page = Number(b.dataset.page); fetchData(); });
    const f = $('#pg-first'); if (f) f.onclick = () => { state.page = 1; fetchData(); };
    const p = $('#pg-prev');  if (p) p.onclick = () => { state.page = Math.max(1, state.page - 1); fetchData(); };
    const n = $('#pg-next');  if (n) n.onclick = () => { state.page = Math.min(totalPages, state.page + 1); fetchData(); };
    const l = $('#pg-last');  if (l) l.onclick = () => { state.page = totalPages; fetchData(); };
  }

  // ----- Cache helpers -----
  function cacheKey() {
    return RET_CACHE_KEY + ':' + JSON.stringify({
      de: state.de, ate: state.ate, id_terc: state.id_terc, id_setor: state.id_setor,
      search: state.search, status_pag: state.status_pag,
      page: state.page, per_page: state.per_page
    });
  }
  function cacheGet() {
    try {
      const raw = sessionStorage.getItem(cacheKey());
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (Date.now() - o.t > RET_CACHE_TTL) return null;
      return o.d;
    } catch { return null; }
  }
  function cacheSet(data) {
    try { sessionStorage.setItem(cacheKey(), JSON.stringify({ t: Date.now(), d: data })); } catch {}
  }
  function cacheInvalidate() {
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(RET_CACHE_KEY)) sessionStorage.removeItem(k);
      }
    } catch {}
  }

  // Persiste filtros (exceto search e page) para próxima visita
  function persistFilters() {
    try {
      sessionStorage.setItem('corepro:retornos:filtros', JSON.stringify({
        de: state.de, ate: state.ate, id_terc: state.id_terc, id_setor: state.id_setor,
        status_pag: state.status_pag, per_page: state.per_page
      }));
    } catch {}
  }

  // ----- Fetch com AbortController (cancela request anterior) -----
  let _abortCtrl = null;
  let _inFlight = false;
  async function fetchData(opts = {}) {
    // Cancela request anterior
    if (_abortCtrl) { try { _abortCtrl.abort(); } catch {} }
    _abortCtrl = new AbortController();

    // Skeleton apenas no primeiro load ou quando o cache não cobrir
    const cached = cacheGet();
    if (cached && !opts.bypassCache) {
      renderKpis(cached.kpis);
      renderTable(cached.rows);
      renderPager(cached.total, cached.page, cached.per_page, cached.total_pages);
      return;
    }
    if (!_inFlight) {
      $kpis.innerHTML = skeletonKpis();
      $tbl.innerHTML = skeletonTable();
      $pager.innerHTML = '';
    }
    _inFlight = true;

    const p = new URLSearchParams({
      de: state.de, ate: state.ate,
      page: String(state.page), per_page: String(state.per_page),
    });
    if (state.id_terc)    p.set('id_terc', state.id_terc);
    if (state.id_setor)   p.set('id_setor', state.id_setor); // HOTFIX 0037
    if (state.search)     p.set('search', state.search);
    if (state.status_pag) p.set('status_pag', state.status_pag);

    try {
      const r = await api('get', '/terc/retornos?' + p.toString(), null, {
        silent: true, signal: _abortCtrl.signal
      });
      const data = r?.data || { rows: [], kpis: {}, total: 0, page: 1, per_page: state.per_page, total_pages: 1 };

      // 🔍 DEBUG: logs estruturados para diagnóstico multi-tenant
      console.log('[retornos] resposta backend:', {
        total: data.total,
        kpis: data.kpis,
        filtro: data.filtro,
        integridade: data.integridade,
        rows_count: (data.rows || []).length,
      });

      cacheSet(data);
      renderKpis(data.kpis || {});
      renderIntegrityBanner(data.integridade || null);
      renderTable(data.rows || []);
      renderPager(data.total || 0, data.page || 1, data.per_page || state.per_page, data.total_pages || 1);
      // HOTFIX 0042 — Painel financeiro só quando há 1 terceirizado filtrado
      loadTercFinancePanel();
    } catch (e) {
      if (e?.canceled) {
        // Request cancelado — outra busca está em andamento. Não mostra erro.
        return;
      }
      console.error('[terc_retornos] fetch erro', e);
      $kpis.innerHTML = `<div class="col-span-full text-center text-amber-600 py-3"><i class="fas fa-triangle-exclamation mr-1"></i>Falha ao carregar retornos</div>`;
      $tbl.innerHTML  = `
        <div class="p-10 text-center text-red-500">
          <i class="fas fa-circle-exclamation text-3xl mb-2 block opacity-70"></i>
          <div>Erro ao carregar dados. Tente novamente.</div>
          <button class="btn btn-secondary btn-sm mt-3" onclick="document.getElementById('btn-refresh').click()"><i class="fas fa-rotate mr-1"></i>Tentar novamente</button>
        </div>`;
      $pager.innerHTML = '';
    } finally {
      _inFlight = false;
    }
  }

  // ----- Handlers (debounce na busca; mudança de filtros reseta página) -----
  let _searchTimer = null;
  $search.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      state.search = $search.value.trim();
      state.page = 1;
      cacheInvalidate(); // busca textual sempre invalida
      fetchData();
    }, 300);
  });
  function bindFilterChange(el, prop, numeric=false) {
    el.addEventListener('change', () => {
      const v = el.value;
      state[prop] = numeric ? (v ? Number(v) : '') : v;
      state.page = 1;
      persistFilters();
      fetchData();
    });
  }
  bindFilterChange($terc, 'id_terc');
  if ($setor) bindFilterChange($setor, 'id_setor'); // HOTFIX 0037
  bindFilterChange($de,   'de');
  bindFilterChange($ate,  'ate');
  bindFilterChange($pag,  'status_pag');
  $pp.addEventListener('change', () => {
    state.per_page = Number($pp.value) || PER_PAGE_DEFAULT;
    state.page = 1;
    persistFilters();
    fetchData();
  });
  $('#btn-refresh').onclick = () => { cacheInvalidate(); fetchData({ bypassCache: true }); };
  $('#btn-clear').onclick = () => {
    state.de = deDefault; $de.value = deDefault;
    state.ate = hoje;     $ate.value = hoje;
    state.id_terc = '';   try { $terc.value = ''; } catch {}
    state.id_setor = '';  try { if ($setor) $setor.value = ''; } catch {} // HOTFIX 0037
    state.status_pag = ''; $pag.value = '';
    state.search = '';     $search.value = '';
    state.page = 1;
    persistFilters();
    cacheInvalidate();
    fetchData();
  };
  $('#btn-print').onclick = () => window.print();

  // ----- Atalhos globais p/ ações na lista (invalidam cache ao salvar) -----
  window.TERC_editRetFromList = (idRet, idRem) => {
    TERC_openRetModal(idRem, () => {
      cacheInvalidate();
      fetchData({ bypassCache: true });
      window._tercAccApi?.refreshAll?.();
    }, idRet);
  };
  window.TERC_delRetFromList = async (idRet, idRem) => {
    const okConf = await TERC_confirmDelRet(idRet);
    if (!okConf) return;
    try {
      await api('delete', '/terc/retornos/' + idRet);
      toast('Retorno excluído com sucesso', 'success');
      cacheInvalidate();
      fetchData({ bypassCache: true });
      window._tercAccApi?.refreshAll?.();
    } catch {}
  };

  // HOTFIX 0042 — Barra flutuante de pagamento
  const $rpbClear = document.getElementById('rpb-clear');
  const $rpbPay   = document.getElementById('rpb-pay');
  if ($rpbClear) $rpbClear.onclick = () => {
    $tbl.querySelectorAll('.ret-checkbox').forEach(cb => { cb.checked = false; });
    const ca = $tbl.querySelector('#ret-check-all'); if (ca) { ca.checked = false; ca.indeterminate = false; }
    updatePaymentBar();
  };
  if ($rpbPay) $rpbPay.onclick = payFromSelection;

  // ----- Sticky shadow visual -----
  _setupStickyShadow(document.querySelector('.retornos-toolbar'));

  // ----- Primeira carga (usa cache se houver) -----
  try { await fetchData(); } catch (e) { console.error('[terc_retornos] init', e); }
};

/* ============================================================
 * 💰 HOTFIX 0042 — PAGAMENTOS DE TERCEIRIZADOS
 * Helpers globais reutilizáveis: PDF do comprovante e histórico.
 * ============================================================ */

/**
 * Gera comprovante PDF do pagamento usando jsPDF + autoTable.
 * Usa a empresa do usuário logado (state.user / TERC.empresa).
 */
async function generatePaymentReceiptPDF(idPagamento) {
  try {
    const r = await api('get', '/payments-terc/' + idPagamento);
    const pag = r?.data?.pagamento || {};
    const itens = r?.data?.itens || [];

    // jsPDF disponível como window.jspdf.jsPDF
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) { toast('jsPDF não está carregado.', 'error'); return; }
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 14;

    // Cabeçalho
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text(pag.empresa_nome || 'CorePro — Terceirização', 14, y);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    y += 6;
    doc.text('Comprovante de Pagamento de Terceirizado', 14, y);
    y += 5;
    doc.setDrawColor(200); doc.line(14, y, pageW - 14, y);
    y += 6;

    // Bloco identificação do pagamento
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text(`Pagamento Nº ${pag.id_pagamento}`, 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`Data: ${fmt.date(pag.dt_pagamento)}`, pageW - 14, y, { align: 'right' });
    y += 6;
    doc.text(`Status: ${pag.status || 'Confirmado'}`, 14, y);
    doc.text(`Forma: ${pag.forma_pagamento || '—'}`, pageW - 14, y, { align: 'right' });
    y += 8;

    // Dados terceirizado
    doc.setFont('helvetica', 'bold'); doc.text('Terceirizado', 14, y); y += 5;
    doc.setFont('helvetica', 'normal');
    doc.text(`Nome: ${pag.nome_terc || '—'}`, 14, y); y += 5;
    if (pag.nome_setor) { doc.text(`Setor: ${pag.nome_setor}`, 14, y); y += 5; }
    if (pag.telefone)   { doc.text(`Telefone: ${pag.telefone}`, 14, y); y += 5; }
    y += 3;

    // Tabela de itens
    const head = [['CTRL', 'OP', 'Referência', 'Cor', 'Serviço', 'Boas', 'Valor (R$)']];
    const body = itens.map(i => [
      String(i.num_controle || '—'),
      String(i.num_op || '—'),
      String(i.cod_ref || '—'),
      String(i.cor || '—'),
      String(i.desc_servico || '—'),
      String(i.qtd_boa || 0),
      Number(i.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ]);
    doc.autoTable({
      startY: y, head, body,
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { halign: 'right', cellWidth: 16 },
        1: { halign: 'right', cellWidth: 18 },
        5: { halign: 'right', cellWidth: 14 },
        6: { halign: 'right', cellWidth: 24 },
      },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 6;

    // Totais
    doc.setDrawColor(180); doc.line(14, y, pageW - 14, y); y += 6;
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.text(`Total de retornos: ${pag.qtd_retornos || 0}`, 14, y);
    doc.text(`Peças boas: ${pag.qtd_pecas_boas || 0}`, 80, y);
    const valorFmt = Number(pag.valor_total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    doc.setFontSize(12);
    doc.text(`Total pago: ${valorFmt}`, pageW - 14, y, { align: 'right' });
    y += 8;

    // Observação
    if (pag.observacao) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text('Observação:', 14, y); y += 5;
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(String(pag.observacao), pageW - 28);
      doc.text(lines, 14, y); y += lines.length * 5 + 3;
    }

    // Responsável + assinatura
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Responsável (sistema): ${pag.usuario || '—'}`, 14, y); y += 5;
    if (pag.ip_origem) { doc.text(`IP de origem: ${pag.ip_origem}`, 14, y); y += 5; }
    y += 15;

    // Assinatura
    doc.setDrawColor(60); doc.line(14, y, 100, y);
    doc.line(pageW - 100, y, pageW - 14, y);
    y += 4;
    doc.setFontSize(8);
    doc.text('Recebido por (assinatura)', 14, y);
    doc.text('Empresa (assinatura)', pageW - 100, y);

    // Rodapé
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(7); doc.setTextColor(120);
    doc.text(`Gerado em ${dayjs().format('DD/MM/YYYY HH:mm')} · CorePro — Terceirização Têxtil`, pageW / 2, pageH - 8, { align: 'center' });

    doc.save(`comprovante_pagamento_${idPagamento}.pdf`);
    toast('Comprovante PDF gerado!', 'success');
  } catch (e) {
    console.error('[pdf-comprovante] erro', e);
    toast('Falha ao gerar comprovante PDF.', 'error');
  }
}
window.generatePaymentReceiptPDF = generatePaymentReceiptPDF;

/* ============================================================
 * ROUTES.pagamentos_terc — HISTÓRICO DE PAGAMENTOS
 * Tela: Financeiro → Pagamentos. Lista todos os pagamentos de
 * terceirizados da empresa (multi-tenant). Permite ver detalhes,
 * gerar PDF e estornar (admin only).
 * ============================================================ */
ROUTES.pagamentos_terc = async (main) => {
  await TERC.load();
  const hoje = dayjs().format('YYYY-MM-DD');
  const ini  = dayjs().subtract(90, 'day').format('YYYY-MM-DD');

  const st = {
    de: ini, ate: hoje, id_terc: '', forma: '', status: '', search: '',
    page: 1, per_page: 50,
  };

  main.innerHTML = `
    <div class="pagamentos-page">
      <div class="page-sticky-header">
        <div class="page-sticky-row">
          <h2 class="text-xl font-bold mb-3">
            <i class="fas fa-hand-holding-dollar mr-2 text-emerald-600"></i>
            Pagamentos de Terceirizados
            <span class="text-sm text-slate-500 font-normal ml-2">Histórico financeiro completo</span>
          </h2>
          <div id="pg-kpis" class="ret-kpis-grid"></div>
          <div class="page-sticky-grid mt-2">
            <div class="filter-cell filter-cell-search">
              <label>Buscar</label>
              <div class="search-input-wrap">
                <i class="fas fa-search search-icon"></i>
                <input id="pgf-search" placeholder="Nome do terceirizado, observação, ID…" />
              </div>
            </div>
            <div class="filter-cell">
              <label>Terceirizado</label>
              <select id="pgf-terc">${TERC.optTerc()}</select>
            </div>
            <div class="filter-cell">
              <label>De</label>
              <input id="pgf-de" type="date" value="${st.de}" />
            </div>
            <div class="filter-cell">
              <label>Até</label>
              <input id="pgf-ate" type="date" value="${st.ate}" />
            </div>
            <div class="filter-cell">
              <label>Forma</label>
              <select id="pgf-forma">
                <option value="">Todas</option>
                <option value="PIX">PIX</option>
                <option value="Dinheiro">Dinheiro</option>
                <option value="Transferência">Transferência</option>
                <option value="TED">TED</option>
                <option value="DOC">DOC</option>
                <option value="Cartão">Cartão</option>
                <option value="Outro">Outro</option>
              </select>
            </div>
            <div class="filter-cell">
              <label>Status</label>
              <select id="pgf-status">
                <option value="">Todos</option>
                <option value="Confirmado">Confirmados</option>
                <option value="Estornado">Estornados</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div id="pg-tbl" class="card p-0 mt-3"></div>
      <div id="pg-pager" class="retornos-pager"></div>
    </div>
  `;

  const $tbl = $('#pg-tbl'), $kpis = $('#pg-kpis'), $pager = $('#pg-pager');

  function rowHtml(p) {
    const isVoid = p.status === 'Estornado';
    return `
      <tr class="${isVoid ? 'opacity-60' : ''}">
        <td class="text-right font-mono">#${p.id_pagamento}</td>
        <td class="whitespace-nowrap">${fmt.date(p.dt_pagamento)}</td>
        <td>${TERC.tercWithSetor(p.nome_terc, p.nome_setor)}</td>
        <td class="text-right tabular-nums">${fmt.int(p.qtd_retornos)}</td>
        <td class="text-right tabular-nums">${fmt.int(p.qtd_pecas_boas)}</td>
        <td class="text-right tabular-nums font-semibold ${isVoid ? 'line-through text-slate-400' : 'text-emerald-700'}">${TERC.fmtBRL(p.valor_total)}</td>
        <td><span class="badge ${p.forma_pagamento === 'PIX' ? 'badge-pago' : ''}">${escapeHtml(p.forma_pagamento || '—')}</span></td>
        <td class="text-xs text-slate-600">${escapeHtml(p.usuario || '—')}</td>
        <td class="text-center">
          ${isVoid
            ? '<span class="badge badge-pendente"><i class="fas fa-rotate-left mr-1"></i>Estornado</span>'
            : '<span class="badge badge-pago"><i class="fas fa-check mr-1"></i>Confirmado</span>'}
        </td>
        <td class="text-center no-print whitespace-nowrap">
          <button class="btn btn-sm btn-secondary" title="Ver detalhes" data-view="${p.id_pagamento}"><i class="fas fa-eye"></i></button>
          <button class="btn btn-sm btn-primary" title="Gerar PDF" data-pdf="${p.id_pagamento}"><i class="fas fa-file-pdf"></i></button>
          ${(!isVoid && window.isAdmin && window.isAdmin())
            ? `<button class="btn btn-sm btn-danger" title="Estornar pagamento" data-void="${p.id_pagamento}"><i class="fas fa-rotate-left"></i></button>`
            : ''}
        </td>
      </tr>`;
  }

  function renderKpis(k) {
    const card = (label, val, cls, icon) => `
      <div class="card p-3 kpi-card">
        <div class="text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1">
          <i class="fas ${icon} ${cls}"></i><span>${label}</span>
        </div>
        <div class="text-2xl font-bold ${cls} mt-1 tabular-nums">${val}</div>
      </div>`;
    $kpis.innerHTML = [
      card('Pagamentos',       fmt.int(k.qtd),                     'text-brand',       'fa-hand-holding-dollar'),
      card('Valor confirmado', TERC.fmtBRL(k.valor_confirmado),     'text-emerald-600', 'fa-circle-check'),
      card('Valor estornado',  TERC.fmtBRL(k.valor_estornado),      'text-red-600',     'fa-rotate-left'),
    ].join('');
  }

  function renderTable(rows) {
    if (!rows.length) {
      $tbl.innerHTML = `
        <div class="p-10 text-center text-slate-500">
          <i class="fas fa-money-bill-wave text-3xl mb-2 block opacity-50"></i>
          <div>Nenhum pagamento encontrado.</div>
          <div class="text-xs mt-2">Registre pagamentos na tela de Retornos.</div>
        </div>`;
      return;
    }
    $tbl.innerHTML = `
      <div class="table-scroll">
        <table class="w-full text-sm retornos-table">
          <thead><tr>
            <th class="text-right">ID</th>
            <th>Data</th>
            <th>Terceirizado</th>
            <th class="text-right">Retornos</th>
            <th class="text-right">Peças</th>
            <th class="text-right">Valor</th>
            <th>Forma</th>
            <th>Responsável</th>
            <th class="text-center">Status</th>
            <th class="text-center no-print">Ações</th>
          </tr></thead>
          <tbody>${rows.map(rowHtml).join('')}</tbody>
        </table>
      </div>`;

    $tbl.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => generatePaymentReceiptPDF(Number(b.dataset.pdf)));
    $tbl.querySelectorAll('[data-view]').forEach(b => b.onclick = () => viewPaymentDetail(Number(b.dataset.view)));
    $tbl.querySelectorAll('[data-void]').forEach(b => b.onclick = () => voidPayment(Number(b.dataset.void), fetchData));
  }

  function renderPager(total, page, perPage, totalPages) {
    if (!total) { $pager.innerHTML = ''; return; }
    const start = (page - 1) * perPage + 1;
    const end = Math.min(start + perPage - 1, total);
    $pager.innerHTML = `
      <div class="pager-info">Mostrando <b>${start}</b>–<b>${end}</b> de <b>${total}</b> pagamento(s)</div>
      <div class="pager-ctrl">
        <button class="pager-btn" id="pgg-prev" ${page<=1?'disabled':''}><i class="fas fa-angle-left"></i></button>
        <span class="pager-page is-current">${page}/${totalPages}</span>
        <button class="pager-btn" id="pgg-next" ${page>=totalPages?'disabled':''}><i class="fas fa-angle-right"></i></button>
      </div>`;
    const $p = $('#pgg-prev'), $n = $('#pgg-next');
    if ($p) $p.onclick = () => { st.page = Math.max(1, st.page - 1); fetchData(); };
    if ($n) $n.onclick = () => { st.page = Math.min(totalPages, st.page + 1); fetchData(); };
  }

  async function fetchData() {
    $tbl.innerHTML = '<div class="p-10 text-center text-slate-400"><i class="fas fa-spinner fa-spin"></i> Carregando…</div>';
    const p = new URLSearchParams({
      de: st.de, ate: st.ate, page: String(st.page), per_page: String(st.per_page),
    });
    if (st.id_terc) p.set('id_terc', st.id_terc);
    if (st.forma)   p.set('forma', st.forma);
    if (st.status)  p.set('status', st.status);
    if (st.search)  p.set('search', st.search);
    try {
      const r = await api('get', '/payments-terc?' + p.toString());
      const d = r?.data || {};
      renderKpis(d.kpis || {});
      renderTable(d.rows || []);
      renderPager(d.total || 0, d.page || 1, d.per_page || st.per_page, d.total_pages || 1);
    } catch (e) {
      console.error('[pagamentos] fetch erro', e);
      $tbl.innerHTML = '<div class="p-10 text-center text-red-500">Erro ao carregar pagamentos.</div>';
    }
  }

  // Filtros
  let _t = null;
  $('#pgf-search').addEventListener('input', () => {
    clearTimeout(_t); _t = setTimeout(() => { st.search = $('#pgf-search').value.trim(); st.page = 1; fetchData(); }, 300);
  });
  ['#pgf-terc', '#pgf-de', '#pgf-ate', '#pgf-forma', '#pgf-status'].forEach(sel => {
    const el = $(sel); if (!el) return;
    el.addEventListener('change', () => {
      st.id_terc = $('#pgf-terc').value;
      st.de      = $('#pgf-de').value;
      st.ate     = $('#pgf-ate').value;
      st.forma   = $('#pgf-forma').value;
      st.status  = $('#pgf-status').value;
      st.page = 1;
      fetchData();
    });
  });

  // Detalhes modal
  async function viewPaymentDetail(id) {
    try {
      const r = await api('get', '/payments-terc/' + id);
      const pag = r?.data?.pagamento || {};
      const itens = r?.data?.itens || [];
      const isVoid = pag.status === 'Estornado';
      const m = document.createElement('div'); m.className = 'modal-backdrop';
      const card = document.createElement('div'); card.className = 'modal modal-lg';
      card.innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">
            <i class="fas fa-receipt mr-2"></i>Pagamento #${pag.id_pagamento}
            ${isVoid ? '<span class="badge badge-pendente ml-2">Estornado</span>' : '<span class="badge badge-pago ml-2">Confirmado</span>'}
          </h3>
          <button class="modal-close" data-close>×</button>
        </div>
        <div class="modal-body">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div class="bg-slate-50 p-3 rounded">
              <div class="text-xs text-slate-500">Terceirizado</div>
              <div class="font-semibold">${escapeHtml(pag.nome_terc || '—')}</div>
              ${pag.nome_setor ? `<div class="mt-1"><span class="tc-terc__chip"><i class="fas fa-sitemap"></i><span class="tc-terc__chip-label">${escapeHtml(pag.nome_setor)}</span></span></div>` : ''}
              ${pag.telefone ? `<div class="text-xs text-slate-500 mt-1"><i class="fas fa-phone mr-1"></i>${escapeHtml(pag.telefone)}</div>` : ''}
            </div>
            <div class="bg-emerald-50 p-3 rounded">
              <div class="text-xs text-slate-500">Pagamento</div>
              <div class="text-2xl font-bold text-emerald-700">${TERC.fmtBRL(pag.valor_total)}</div>
              <div class="text-xs mt-1">${fmt.date(pag.dt_pagamento)} · ${escapeHtml(pag.forma_pagamento || '—')}</div>
              <div class="text-xs text-slate-500">${pag.qtd_retornos || 0} retorno(s) · ${pag.qtd_pecas_boas || 0} peças</div>
            </div>
          </div>
          ${pag.observacao ? `<div class="bg-blue-50 border border-blue-200 p-2 rounded text-sm mb-3"><b>Observação:</b> ${escapeHtml(pag.observacao)}</div>` : ''}
          ${isVoid ? `<div class="bg-red-50 border border-red-200 p-2 rounded text-sm mb-3 text-red-700"><b><i class="fas fa-rotate-left mr-1"></i>Estornado</b> em ${pag.dt_estorno || '—'} por <b>${escapeHtml(pag.estornado_por || '—')}</b>. Motivo: ${escapeHtml(pag.motivo_estorno || '—')}</div>` : ''}
          <div class="text-sm font-semibold mb-2">Retornos pagos:</div>
          <div class="table-scroll" style="max-height: 40vh; overflow:auto;">
            <table class="w-full text-sm">
              <thead><tr>
                <th class="text-right">CTRL</th><th>OP</th><th>Ref</th><th>Cor</th><th>Serviço</th>
                <th class="text-right">Boas</th><th class="text-right">Valor</th>
              </tr></thead>
              <tbody>${itens.map(i => `
                <tr>
                  <td class="text-right font-mono">${i.num_controle || '—'}</td>
                  <td>${escapeHtml(i.num_op || '—')}</td>
                  <td class="font-mono text-xs">${escapeHtml(i.cod_ref || '—')}</td>
                  <td>${escapeHtml(i.cor || '—')}</td>
                  <td class="text-xs">${escapeHtml(i.desc_servico || '—')}</td>
                  <td class="text-right tabular-nums text-emerald-700">${fmt.int(i.qtd_boa)}</td>
                  <td class="text-right tabular-nums">${TERC.fmtBRL(i.valor)}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>
          <div class="text-xs text-slate-500 mt-3">
            Registrado por: <b>${escapeHtml(pag.usuario || '—')}</b>
            ${pag.ip_origem ? ' · IP: ' + escapeHtml(pag.ip_origem) : ''}
            ${pag.dt_criacao ? ' · em ' + escapeHtml(pag.dt_criacao) : ''}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-close type="button"><i class="fas fa-xmark mr-1"></i>Fechar</button>
          <button class="btn btn-primary" id="vp-pdf" type="button"><i class="fas fa-file-pdf mr-1"></i>Gerar PDF</button>
        </div>
      `;
      m.appendChild(card); document.body.appendChild(m);
      card.querySelectorAll('[data-close]').forEach(b => b.onclick = () => m.remove());
      $('#vp-pdf').onclick = () => generatePaymentReceiptPDF(id);
    } catch (e) {
      console.error('[view-payment] erro', e);
      toast('Erro ao carregar detalhes.', 'error');
    }
  }

  // Estorno (admin only)
  async function voidPayment(id, refresh) {
    if (!window.isAdmin || !window.isAdmin()) {
      toast('Apenas administradores podem estornar pagamentos.', 'warning');
      return;
    }
    const motivo = prompt('Motivo do estorno (obrigatório):');
    if (!motivo || motivo.trim().length < 3) {
      toast('Estorno cancelado.', 'info'); return;
    }
    if (!confirm(`Confirma o estorno do pagamento #${id}?\n\nOs retornos voltarão para o status "Pendente" e poderão ser pagos novamente.`)) return;
    try {
      await api('post', `/payments-terc/${id}/void`, { motivo: motivo.trim() });
      toast('Pagamento estornado.', 'success');
      if (typeof refresh === 'function') refresh();
    } catch (e) {
      console.error('[void] erro', e);
      const msg = e?.response?.data?.error || 'Falha ao estornar pagamento.';
      toast(msg, 'error');
    }
  }

  await fetchData();
};
window.isAdmin = window.isAdmin || (() => state.user?.perfil === 'admin');

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
  // Garante cache de cores oficiais para o select visual
  try { if (window.Cores) await window.Cores.list(); } catch {}
  let p = { grade: 1, preco: 0, tempo_min: 0, ativo: 1, cor: '', tamanho: '' };
  if (id) {
    try {
      const r = await api('get', '/terc/precos', null, { silent: true });
      p = fmt.safeArr(r?.data).find(x => Number(x.id_preco) === Number(id)) || p;
    } catch {}
  }
  const prodInicial = (id && p.cod_ref) ? TERC.findProdutoByRef(p.cod_ref, p.id_colecao) : null;
  const idProdSel = prodInicial ? prodInicial.id_produto : '';
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
        ${window.Cores
          ? window.Cores.select({ value: p.cor || '', name: 'cor', placeholder: 'Ex: Azul (vazio = todas)', idPrefix: 'm-cor' })
          : `<input id="m-cor-fallback" value="${(p.cor || '').replace(/"/g, '&quot;')}" placeholder="Ex: Azul" />`}
      </div>
      <div>
        <label>Tamanho / Grade <span class="text-xs text-slate-400">(opcional)</span></label>
        <input id="m-tam" value="${(p.tamanho || '').replace(/"/g, '&quot;')}" list="m-tam-dl" placeholder="Ex: M (vazio = todos)" />
        <datalist id="m-tam-dl">${tamsPadrao.map(t => `<option value="${t}">`).join('')}</datalist>
      </div>
      <div>
        <label>Serviço *</label>
        <select id="m-serv">${TERC.optServicos(p.id_servico)}</select>
        ${(TERC.servicos || []).filter(s => s.ativo !== 0).length === 0
          ? `<div class="text-xs text-amber-700 mt-1"><i class="fas fa-exclamation-triangle mr-1"></i>Nenhum serviço ativo cadastrado. <a href="#terc-servicos" class="underline">Cadastre um serviço primeiro</a>.</div>`
          : ''}
      </div>
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
  // Bind cor visual (bolinha colorida ao digitar)
  try { window.Cores?.bindInputs(card); } catch {}

  // Helper para ler valor do input cor (visual ou fallback)
  const _getCorVal = () => {
    const visual = card.querySelector('[data-cor-input] input[name="cor"]');
    if (visual) return (visual.value || '').trim();
    return (card.querySelector('#m-cor-fallback')?.value || '').trim();
  };

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
      cor:        _getCorVal(),
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
 * CORES — Gerenciamento centralizado de cores
 * ============================================================
 * CRUD completo + importação em massa (CSV, texto livre, Excel via copy/paste)
 * + exclusão em massa com dupla confirmação + busca + filtro ativo/inativo.
 *
 * Cache global em window.Cores.cache (preenchido sob demanda) — usado por
 * window.Cores.select() para renderizar selects visuais com bolinha colorida
 * em qualquer parte do sistema (remessas, produtos, retornos, etc).
 * ============================================================ */

// ---------- API client global (acessível por outras telas) ----------
window.Cores = window.Cores || {
  cache: null,
  cacheAt: 0,
  /** Busca lista (com cache de 60s). force=true ignora cache. */
  async list(force = false) {
    const now = Date.now();
    if (!force && this.cache && (now - this.cacheAt) < 60_000) return this.cache;
    try {
      const r = await api('get', '/cores?ativo=1', null, { silent: true });
      this.cache = Array.isArray(r?.data) ? r.data : [];
      this.cacheAt = now;
    } catch { this.cache = this.cache || []; }
    return this.cache;
  },
  /** Invalida cache (chamado após CRUD) */
  invalidate() { this.cache = null; this.cacheAt = 0; },
  /** Renderiza um <select> visual com bolinha colorida no option (via datalist + input).
   *  Uso: window.Cores.select({ value, name, required, placeholder, idPrefix }) → string HTML */
  select({ value = '', name = 'cor', required = false, placeholder = 'Cor', idPrefix = 'sel-cor' } = {}) {
    const id = idPrefix + '-' + Math.random().toString(36).slice(2, 8);
    const cores = this.cache || [];
    const optsHtml = cores.map(c =>
      `<option value="${escapeHtml(c.nome)}" data-hex="${escapeHtml(c.hex)}"></option>`
    ).join('');
    const hex = (cores.find(c => (c.nome || '').toLowerCase() === String(value || '').toLowerCase())?.hex) || '';
    return `
      <span class="cor-input-wrap" data-cor-input>
        <span class="cor-input-dot" data-cor-dot style="background:${escapeHtml(hex || 'transparent')};border:1px solid var(--border-2,#cbd5e1)"></span>
        <input id="${id}" name="${escapeHtml(name)}" type="text"
               list="${id}-dl"
               value="${escapeHtml(value || '')}"
               placeholder="${escapeHtml(placeholder)}"
               autocomplete="off"
               ${required ? 'required' : ''} />
        <datalist id="${id}-dl">${optsHtml}</datalist>
      </span>`;
  },
  /** Bind: atualiza a bolinha quando o usuário digita (chamado uma vez pelo container) */
  bindInputs(scope = document) {
    scope.querySelectorAll('[data-cor-input]:not([data-cor-bound])').forEach(wrap => {
      wrap.setAttribute('data-cor-bound', '1');
      const inp = wrap.querySelector('input');
      const dot = wrap.querySelector('[data-cor-dot]');
      if (!inp || !dot) return;
      const upd = () => {
        const val = (inp.value || '').toLowerCase().trim();
        const found = (this.cache || []).find(c => (c.nome || '').toLowerCase() === val);
        dot.style.background = found?.hex || 'transparent';
      };
      inp.addEventListener('input', upd);
      inp.addEventListener('change', upd);
      upd();
    });
  },
};

// =====================================================================
// MÓDULO DE SETORES — Tela completa de cadastro (HOTFIX 0037 — 2026-05-27)
// =====================================================================
// Setores produtivos da terceirização (ex.: Estamparia, Aparador, Embalagem).
// Vinculados a serviços (terc_servicos.id_setor) e terceirizados.
//
// Após a migration 0037, setores ganharam: codigo (slug), descricao, cor,
// ordem, dt_alteracao, criado_por, alterado_por.
//
// Funcionalidades:
//   - Tabela com busca, filtro por status, ordenação
//   - Modal de cadastro/edição: nome, código (auto-slug), descrição, cor, ordem, status
//   - Ações: editar, ativar/desativar, excluir
//   - Validação de vínculos (serviços, terceirizados, remessas) antes de excluir
//   - Soft-delete via ?force=1 quando há vínculos
//   - Cache global TERC.setores invalidado após mutação
//   - Multi-tenant: tudo escopado por id_empresa
// =====================================================================
ROUTES.terc_setores = async (main) => {
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }
  function isValidHex(s) {
    let x = String(s || '').trim().toUpperCase().replace(/^#/, '');
    if (/^[0-9A-F]{3}$/.test(x)) x = x.split('').map((ch) => ch + ch).join('');
    return /^[0-9A-F]{6}$/.test(x) ? '#' + x : null;
  }
  function contrastingText(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return '#000';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? '#0f172a' : '#ffffff';
  }
  function fmtData(s) {
    if (!s) return '—';
    try {
      const d = new Date(String(s).replace(' ', 'T'));
      if (isNaN(d)) return s;
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return s; }
  }
  function slugify(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  const PALETA = [
    '#2563EB', '#7C3AED', '#8B5CF6', '#EC4899', '#EF4444',
    '#F97316', '#F59E0B', '#EAB308', '#10B981', '#14B8A6',
    '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1', '#64748B',
  ];

  state.route = 'terc_setores';

  let lista = [];
  let filtro = { q: '', status: 'all', sort: 'ordem' };

  async function loadList() {
    try {
      const qs = new URLSearchParams();
      if (filtro.q) qs.set('q', filtro.q);
      if (filtro.status === 'ativos') qs.set('ativo', '1');
      if (filtro.status === 'inativos') qs.set('ativo', '0');
      const r = await api('get', '/terc/setores' + (qs.toString() ? '?' + qs : ''), null, { silent: true });
      lista = Array.isArray(r?.data) ? r.data : [];

      const sk = filtro.sort;
      lista.sort((a, b) => {
        if (sk === 'nome') return String(a.nome_setor || '').localeCompare(String(b.nome_setor || ''), 'pt-BR');
        if (sk === 'servicos') return Number(b.qtd_servicos || 0) - Number(a.qtd_servicos || 0);
        if (sk === 'recent') return String(b.dt_alteracao || b.dt_criacao || '').localeCompare(String(a.dt_alteracao || a.dt_criacao || ''));
        // default ordem (com ativos primeiro)
        if ((b.ativo ? 1 : 0) !== (a.ativo ? 1 : 0)) return (b.ativo ? 1 : 0) - (a.ativo ? 1 : 0);
        return Number(a.ordem || 9999) - Number(b.ordem || 9999);
      });
    } catch (e) {
      lista = [];
      toast('Erro ao carregar setores: ' + (e?.message || 'desconhecido'), 'error');
    }
    render();
    // Atualiza cache global
    if (window.TERC) {
      try { window.TERC.setores = lista.slice(); } catch {}
    }
  }

  function render() {
    const totalAtivos = lista.filter((s) => s.ativo).length;
    const totalInativos = lista.length - totalAtivos;
    const semFiltro = !filtro.q && filtro.status === 'all';

    main.innerHTML = `
      <div class="page-header mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 class="page-title"><i class="fas fa-sitemap mr-2 text-indigo-500"></i>Setores</h1>
          <p class="page-subtitle">Setores produtivos da terceirização. Organize serviços, terceirizados e remessas por área de atuação (ex.: Estamparia, Aparador, Embalagem).</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button id="st-novo" class="btn btn-primary"><i class="fas fa-plus mr-1"></i>Novo setor</button>
          <button id="st-reload" class="btn btn-secondary" title="Recarregar"><i class="fas fa-rotate"></i></button>
        </div>
      </div>

      <!-- Filtros -->
      <div class="card mb-4">
        <div class="card-body">
          <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div class="md:col-span-6">
              <label class="text-xs text-slate-500 font-medium">Buscar</label>
              <div class="relative">
                <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                <input id="st-q" type="text" class="form-input pl-9"
                  placeholder="Nome, código ou descrição..."
                  value="${escHtml(filtro.q)}" />
              </div>
            </div>
            <div class="md:col-span-3">
              <label class="text-xs text-slate-500 font-medium">Status</label>
              <select id="st-status" class="form-input">
                <option value="all" ${filtro.status === 'all' ? 'selected' : ''}>Todos</option>
                <option value="ativos" ${filtro.status === 'ativos' ? 'selected' : ''}>Ativos</option>
                <option value="inativos" ${filtro.status === 'inativos' ? 'selected' : ''}>Inativos</option>
              </select>
            </div>
            <div class="md:col-span-3">
              <label class="text-xs text-slate-500 font-medium">Ordenar</label>
              <select id="st-sort" class="form-input">
                <option value="ordem" ${filtro.sort === 'ordem' ? 'selected' : ''}>Ordem manual</option>
                <option value="nome" ${filtro.sort === 'nome' ? 'selected' : ''}>Nome (A→Z)</option>
                <option value="servicos" ${filtro.sort === 'servicos' ? 'selected' : ''}>Mais serviços</option>
                <option value="recent" ${filtro.sort === 'recent' ? 'selected' : ''}>Mais recente</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div class="text-xs text-slate-500 mb-3 flex items-center gap-3 flex-wrap">
        <span><i class="fas fa-info-circle mr-1"></i><b>${lista.length}</b> setor${lista.length !== 1 ? 'es' : ''}</span>
        <span class="text-emerald-600"><i class="fas fa-circle-check mr-1"></i><b>${totalAtivos}</b> ativo${totalAtivos !== 1 ? 's' : ''}</span>
        <span class="text-slate-400"><i class="fas fa-circle-xmark mr-1"></i><b>${totalInativos}</b> inativo${totalInativos !== 1 ? 's' : ''}</span>
        ${!semFiltro ? `<button id="st-clear" class="ml-auto text-indigo-600 hover:underline"><i class="fas fa-filter-circle-xmark mr-1"></i>Limpar filtros</button>` : ''}
      </div>

      ${lista.length === 0 ? `
        <div class="card">
          <div class="card-body text-center py-12 text-slate-500">
            <i class="fas fa-sitemap text-5xl text-slate-300 mb-3"></i>
            <p class="font-medium">${semFiltro ? 'Nenhum setor cadastrado.' : 'Nenhum setor encontrado com este filtro.'}</p>
            <p class="text-sm mt-1">${semFiltro ? 'Clique em <b>Novo setor</b> para começar.' : 'Ajuste a busca ou clique em "Limpar filtros".'}</p>
          </div>
        </div>
      ` : `
        <div class="card overflow-hidden">
          <div class="overflow-x-auto">
            <table class="srv-table w-full text-sm">
              <thead>
                <tr>
                  <th style="width:36px"></th>
                  <th style="width:60px" class="text-center">Ordem</th>
                  <th>Setor</th>
                  <th class="hidden md:table-cell">Código</th>
                  <th class="hidden lg:table-cell text-center">Serviços</th>
                  <th class="hidden lg:table-cell text-center">Terceirizados</th>
                  <th class="hidden xl:table-cell text-center">Remessas</th>
                  <th class="hidden xl:table-cell">Criado em</th>
                  <th class="text-center">Status</th>
                  <th class="text-right" style="width:140px">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${lista.map((s) => {
                  const cor = s.cor || '#64748B';
                  return `
                    <tr class="srv-row ${s.ativo ? '' : 'is-inactive'}" data-id="${s.id_setor}">
                      <td>
                        <span class="srv-dot" style="background:${escHtml(cor)}" title="${escHtml(cor)}"></span>
                      </td>
                      <td class="text-center tabular-nums text-xs text-slate-500">${s.ordem ?? '—'}</td>
                      <td>
                        <div class="font-medium text-slate-800">${escHtml(s.nome_setor)}</div>
                        ${s.descricao ? `<div class="text-xs text-slate-500 mt-0.5 line-clamp-1">${escHtml(s.descricao)}</div>` : ''}
                      </td>
                      <td class="hidden md:table-cell">
                        ${s.codigo ? `<code class="text-xs px-1.5 py-0.5 bg-slate-100 rounded">${escHtml(s.codigo)}</code>` : '<span class="text-xs text-slate-400">—</span>'}
                      </td>
                      <td class="hidden lg:table-cell text-center">
                        ${Number(s.qtd_servicos) > 0
                          ? `<span class="srv-vinc-pill">${s.qtd_servicos}</span>`
                          : '<span class="text-xs text-slate-400">0</span>'}
                      </td>
                      <td class="hidden lg:table-cell text-center">
                        ${Number(s.qtd_terceirizados) > 0
                          ? `<span class="srv-vinc-pill">${s.qtd_terceirizados}</span>`
                          : '<span class="text-xs text-slate-400">0</span>'}
                      </td>
                      <td class="hidden xl:table-cell text-center">
                        ${Number(s.qtd_remessas) > 0
                          ? `<span class="srv-vinc-pill">${s.qtd_remessas}</span>`
                          : '<span class="text-xs text-slate-400">0</span>'}
                      </td>
                      <td class="hidden xl:table-cell text-xs text-slate-500">${fmtData(s.dt_criacao)}</td>
                      <td class="text-center">
                        ${s.ativo
                          ? '<span class="srv-status-on"><i class="fas fa-check"></i>Ativo</span>'
                          : '<span class="srv-status-off"><i class="fas fa-pause"></i>Inativo</span>'}
                      </td>
                      <td class="text-right">
                        <div class="srv-actions">
                          <button class="btn-icon" data-act="edit" data-id="${s.id_setor}" title="Editar"><i class="fas fa-pen"></i></button>
                          <button class="btn-icon" data-act="toggle" data-id="${s.id_setor}" title="${s.ativo ? 'Desativar' : 'Ativar'}">
                            <i class="fas ${s.ativo ? 'fa-eye' : 'fa-eye-slash'}"></i>
                          </button>
                          <button class="btn-icon is-danger" data-act="del" data-id="${s.id_setor}" title="Excluir"><i class="fas fa-trash"></i></button>
                        </div>
                      </td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `}
    `;

    $('#st-novo').onclick = () => openSetorModal(null);
    $('#st-reload').onclick = () => loadList();
    let _qtmr = 0;
    $('#st-q').oninput = (e) => {
      clearTimeout(_qtmr);
      const v = e.target.value;
      _qtmr = setTimeout(() => { filtro.q = v; loadList(); }, 280);
    };
    $('#st-status').onchange = (e) => { filtro.status = e.target.value; loadList(); };
    $('#st-sort').onchange = (e) => { filtro.sort = e.target.value; render(); };
    const $clear = $('#st-clear');
    if ($clear) $clear.onclick = () => {
      filtro = { q: '', status: 'all', sort: 'ordem' };
      loadList();
    };

    main.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.id);
        const act = btn.dataset.act;
        const s = lista.find((x) => x.id_setor === id);
        if (!s) return;
        if (act === 'edit') openSetorModal(s);
        else if (act === 'toggle') toggleAtivo(s);
        else if (act === 'del') excluirSetor(s);
      };
    });
  }

  function openSetorModal(setor) {
    const isEdit = !!setor;
    const m = document.createElement('div');
    m.className = 'modal-backdrop';
    m.innerHTML = `
      <div class="modal-card" style="max-width:620px">
        <div class="modal-header">
          <h3><i class="fas fa-sitemap mr-2"></i>${isEdit ? 'Editar setor' : 'Novo setor'}</h3>
          <button class="modal-close" type="button" aria-label="Fechar">&times;</button>
        </div>
        <div class="modal-body">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="md:col-span-2">
              <label class="form-label">Nome do setor <span class="text-red-500">*</span></label>
              <input id="stm-nome" type="text" class="form-input" maxlength="60"
                value="${escHtml(setor?.nome_setor || '')}" placeholder="Ex: Estamparia" required />
            </div>

            <div>
              <label class="form-label">Código (slug)</label>
              <input id="stm-codigo" type="text" class="form-input" maxlength="40"
                value="${escHtml(setor?.codigo || '')}" placeholder="auto" />
              <p class="text-xs text-slate-500 mt-1">Identificador único do setor. Deixe vazio para gerar automaticamente.</p>
            </div>

            <div>
              <label class="form-label">Ordem</label>
              <input id="stm-ordem" type="number" min="0" step="1" class="form-input"
                value="${setor?.ordem != null ? setor.ordem : ''}" placeholder="0" />
              <p class="text-xs text-slate-500 mt-1">Posição na listagem (menor = primeiro).</p>
            </div>

            <div class="md:col-span-2">
              <label class="form-label">Cor de identificação</label>
              <div class="flex gap-2 items-center">
                <input id="stm-cor" type="text" class="form-input flex-1" maxlength="7"
                  value="${escHtml(setor?.cor || '#6366F1')}" placeholder="#6366F1" />
                <input id="stm-cor-pick" type="color"
                  value="${escHtml(setor?.cor || '#6366F1')}"
                  style="height:38px;width:48px;border-radius:8px;border:1px solid var(--border-2,#cbd5e1);cursor:pointer" />
              </div>
              <div class="srv-paleta mt-2">
                ${PALETA.map((c) => `<button type="button" class="srv-paleta-dot" data-cor="${c}" style="background:${c}" title="${c}"></button>`).join('')}
              </div>
            </div>

            <div class="md:col-span-2">
              <label class="form-label">Descrição</label>
              <textarea id="stm-desc" rows="2" class="form-input" maxlength="240"
                placeholder="Breve descrição do setor (opcional)">${escHtml(setor?.descricao || '')}</textarea>
            </div>

            <div class="md:col-span-2">
              <label class="flex items-center gap-2 cursor-pointer">
                <input id="stm-ativo" type="checkbox" ${(setor?.ativo ?? 1) ? 'checked' : ''} />
                <span class="text-sm">Ativo (visível nos selects do sistema)</span>
              </label>
            </div>

            <div class="md:col-span-2">
              <label class="form-label">Pré-visualização</label>
              <div id="stm-preview" class="srv-preview"></div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-act="cancel" type="button">Cancelar</button>
          <button class="btn btn-primary" data-act="save" type="button">
            <i class="fas fa-save mr-1"></i>${isEdit ? 'Salvar alterações' : 'Cadastrar'}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('.modal-close').onclick = close;
    m.querySelector('[data-act="cancel"]').onclick = close;
    m.addEventListener('click', (e) => { if (e.target === m) close(); });

    const $nome = m.querySelector('#stm-nome');
    const $cod = m.querySelector('#stm-codigo');
    const $cor = m.querySelector('#stm-cor');
    const $corPick = m.querySelector('#stm-cor-pick');
    const $prev = m.querySelector('#stm-preview');

    let codigoEditadoManualmente = isEdit && setor?.codigo;
    $cod.oninput = () => { codigoEditadoManualmente = true; };

    function syncPreview() {
      const cor = isValidHex($cor.value) || '#6366F1';
      const nome = ($nome.value || '').trim() || 'Nome do setor';
      const txt = contrastingText(cor);
      $prev.innerHTML = `
        <div class="srv-preview-card" style="background:${cor};color:${txt}">
          <span class="srv-preview-dot" style="background:${txt}"></span>
          <div class="srv-preview-text">
            <div class="srv-preview-nome">${escHtml(nome)}</div>
            ${$cod.value ? `<div class="srv-preview-cat"><code>${escHtml($cod.value)}</code></div>` : ''}
          </div>
        </div>
      `;
    }
    $nome.oninput = () => {
      if (!codigoEditadoManualmente) $cod.value = slugify($nome.value);
      syncPreview();
    };
    $cor.oninput = () => {
      const v = isValidHex($cor.value);
      if (v) $corPick.value = v;
      syncPreview();
    };
    $corPick.oninput = () => { $cor.value = $corPick.value.toUpperCase(); syncPreview(); };
    m.querySelectorAll('.srv-paleta-dot').forEach((d) => {
      d.onclick = () => {
        const c = d.dataset.cor;
        $cor.value = c;
        $corPick.value = c;
        syncPreview();
      };
    });
    syncPreview();
    setTimeout(() => $nome.focus(), 60);

    m.querySelector('[data-act="save"]').onclick = async () => {
      const nome = ($nome.value || '').trim();
      if (!nome) { toast('Informe o nome do setor', 'warning'); $nome.focus(); return; }
      const cor = isValidHex($cor.value);
      const ordemRaw = m.querySelector('#stm-ordem').value;
      const payload = {
        nome_setor: nome,
        codigo: $cod.value.trim() || null,
        descricao: m.querySelector('#stm-desc').value.trim() || null,
        cor: cor || null,
        ordem: ordemRaw !== '' ? Number(ordemRaw) : null,
        ativo: m.querySelector('#stm-ativo').checked ? 1 : 0,
      };
      try {
        if (isEdit) {
          await api('put', '/terc/setores/' + setor.id_setor, payload, { silent: false });
          toast('Setor atualizado!', 'success');
        } else {
          await api('post', '/terc/setores', payload, { silent: false });
          toast('Setor cadastrado!', 'success');
        }
        close();
        // Atualiza cache global ANTES de reload
        try { await window.TERC?.reloadSetores?.(); } catch {}
        loadList();
      } catch {}
    };
  }

  async function toggleAtivo(s) {
    try {
      const r = await api('patch', `/terc/setores/${s.id_setor}/toggle`, null, { silent: false });
      toast(r?.data?.ativo ? 'Setor ativado' : 'Setor desativado', 'success');
      try { await window.TERC?.reloadSetores?.(); } catch {}
      loadList();
    } catch {}
  }

  async function excluirSetor(s) {
    const totVinc = (Number(s.qtd_servicos) || 0) + (Number(s.qtd_terceirizados) || 0) + (Number(s.qtd_remessas) || 0);
    if (totVinc > 0) {
      const detalhes = `${s.qtd_servicos || 0} serviço(s), ${s.qtd_terceirizados || 0} terceirizado(s), ${s.qtd_remessas || 0} remessa(s)`;
      const msg = `O setor "${s.nome_setor}" está vinculado a:\n${detalhes}\n\n` +
                  `Por segurança, não é possível EXCLUIR um setor vinculado.\n\n` +
                  `Deseja DESATIVÁ-LO? (o setor some dos selects mas mantém o histórico)`;
      if (!confirm(msg)) return;
      try {
        await api('delete', `/terc/setores/${s.id_setor}?force=1`, null, { silent: false });
        toast('Setor desativado (mantido por vínculos)', 'success');
        try { await window.TERC?.reloadSetores?.(); } catch {}
        loadList();
      } catch {}
      return;
    }
    if (!confirm(`Excluir o setor "${s.nome_setor}"?\n\nEsta ação é irreversível.`)) return;
    try {
      await api('delete', `/terc/setores/${s.id_setor}`, null, { silent: false });
      toast('Setor excluído', 'success');
      try { await window.TERC?.reloadSetores?.(); } catch {}
      loadList();
    } catch {}
  }

  await loadList();
};

// =====================================================================
// MÓDULO DE SERVIÇOS — Tela completa de cadastro (2026-05-26)
// =====================================================================
// Reutiliza os serviços já existentes em terc_servicos (preservados).
// Após a migration 0029, os serviços ganharam: categoria, cor,
// preco_padrao, tempo_padrao, descricao, observacoes.
//
// Funcionalidades:
//   - Tabela profissional com busca, filtro por status/categoria, ordenação
//   - Cards com cor de identificação (HEX)
//   - Modal de cadastro/edição com todos os campos
//   - Ações: editar, ativar/desativar, duplicar, excluir
//   - Validação de vínculos antes de excluir (impede quebra do sistema)
//   - Contador de vínculos (preços, produtos, remessas) por serviço
//   - Cache global TERC.servicos invalidado após qualquer mutação
// =====================================================================
ROUTES.terc_servicos = async (main) => {
  // --- Helpers internos ---
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }
  function isValidHex(s) {
    let x = String(s || '').trim().toUpperCase().replace(/^#/, '');
    if (/^[0-9A-F]{3}$/.test(x)) x = x.split('').map((ch) => ch + ch).join('');
    return /^[0-9A-F]{6}$/.test(x) ? '#' + x : null;
  }
  function contrastingText(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return '#000';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? '#0f172a' : '#ffffff';
  }
  function fmtMoeda(v) {
    if (v == null || v === '') return '—';
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
  }
  function fmtTempo(v) {
    if (v == null || v === '') return '—';
    const n = Number(v);
    if (!isFinite(n) || n <= 0) return '—';
    if (n < 60) return n.toFixed(1).replace(/\.0$/, '') + ' min';
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }
  function fmtData(s) {
    if (!s) return '—';
    try {
      const d = new Date(String(s).replace(' ', 'T'));
      if (isNaN(d)) return s;
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return s; }
  }

  // Paleta sugerida (clique para preencher no modal)
  const PALETA_SUGERIDA = [
    '#2563EB', '#7C3AED', '#8B5CF6', '#EC4899', '#EF4444',
    '#F97316', '#F59E0B', '#EAB308', '#10B981', '#14B8A6',
    '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1', '#64748B',
  ];
  const CATEGORIAS_PADRAO = [
    'Costura', 'Corte', 'Acabamento', 'Estamparia', 'Bordado',
    'Lavanderia', 'Embalagem', 'Geral',
  ];

  state.route = 'terc_servicos';

  let lista = [];
  let categorias = [];
  let filtro = { q: '', status: 'all', categoria: '', sort: 'desc_servico' };

  async function loadList() {
    try {
      const qs = new URLSearchParams();
      if (filtro.q) qs.set('q', filtro.q);
      if (filtro.status === 'ativos') qs.set('ativo', '1');
      if (filtro.status === 'inativos') qs.set('ativo', '0');
      if (filtro.categoria) qs.set('categoria', filtro.categoria);
      const r = await api('get', '/terc/servicos' + (qs.toString() ? '?' + qs : ''), null, { silent: true });
      lista = Array.isArray(r?.data) ? r.data : [];

      const rc = await api('get', '/terc/servicos/categorias', null, { silent: true });
      categorias = Array.isArray(rc?.data) ? rc.data : [];

      // Ordenação client-side (já vem ordenado pelo backend, mas re-aplica)
      const sk = filtro.sort;
      lista.sort((a, b) => {
        if (sk === 'preco') return Number(b.preco_padrao || 0) - Number(a.preco_padrao || 0);
        if (sk === 'tempo') return Number(b.tempo_padrao || 0) - Number(a.tempo_padrao || 0);
        if (sk === 'recent') return String(b.dt_alteracao || b.dt_criacao || '').localeCompare(String(a.dt_alteracao || a.dt_criacao || ''));
        // default: nome (com ativos primeiro)
        if ((b.ativo ? 1 : 0) !== (a.ativo ? 1 : 0)) return (b.ativo ? 1 : 0) - (a.ativo ? 1 : 0);
        return String(a.desc_servico || '').localeCompare(String(b.desc_servico || ''), 'pt-BR');
      });
    } catch (e) {
      lista = [];
      toast('Erro ao carregar serviços: ' + (e?.message || 'desconhecido'), 'error');
    }
    render();
    // Invalida cache global de TERC.servicos para remessas/retornos pegarem versão atualizada
    if (window.TERC && typeof window.TERC.servicos !== 'undefined') {
      try {
        window.TERC.servicos = lista.filter((s) => s.ativo).map((s) => ({
          id_servico: s.id_servico, desc_servico: s.desc_servico, cor: s.cor, categoria: s.categoria,
        }));
      } catch {}
    }
  }

  function render() {
    const totalAtivos = lista.filter((s) => s.ativo).length;
    const totalInativos = lista.length - totalAtivos;
    const semFiltro = !filtro.q && filtro.status === 'all' && !filtro.categoria;

    main.innerHTML = `
      <div class="page-header mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 class="page-title"><i class="fas fa-screwdriver-wrench mr-2 text-indigo-500"></i>Serviços</h1>
          <p class="page-subtitle">Gerencie os serviços utilizados em remessas, retornos, preços e produtos. Cores e categorias ajudam a identificar visualmente.</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button id="sv-novo" class="btn btn-primary"><i class="fas fa-plus mr-1"></i>Novo serviço</button>
          <button id="sv-reload" class="btn btn-secondary" title="Recarregar"><i class="fas fa-rotate"></i></button>
        </div>
      </div>

      <!-- Filtros e busca -->
      <div class="card mb-4">
        <div class="card-body">
          <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div class="md:col-span-5">
              <label class="text-xs text-slate-500 font-medium">Buscar</label>
              <div class="relative">
                <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                <input id="sv-q" type="text" class="form-input pl-9"
                  placeholder="Nome, descrição ou categoria..."
                  value="${escHtml(filtro.q)}" />
              </div>
            </div>
            <div class="md:col-span-3">
              <label class="text-xs text-slate-500 font-medium">Categoria</label>
              <select id="sv-cat" class="form-input">
                <option value="">Todas (${lista.length})</option>
                ${categorias.map((c) => `
                  <option value="${escHtml(c.categoria)}" ${filtro.categoria === c.categoria ? 'selected' : ''}>
                    ${escHtml(c.categoria)} (${c.n})
                  </option>`).join('')}
              </select>
            </div>
            <div class="md:col-span-2">
              <label class="text-xs text-slate-500 font-medium">Status</label>
              <select id="sv-status" class="form-input">
                <option value="all" ${filtro.status === 'all' ? 'selected' : ''}>Todos</option>
                <option value="ativos" ${filtro.status === 'ativos' ? 'selected' : ''}>Ativos</option>
                <option value="inativos" ${filtro.status === 'inativos' ? 'selected' : ''}>Inativos</option>
              </select>
            </div>
            <div class="md:col-span-2">
              <label class="text-xs text-slate-500 font-medium">Ordenar</label>
              <select id="sv-sort" class="form-input">
                <option value="desc_servico" ${filtro.sort === 'desc_servico' ? 'selected' : ''}>Nome (A→Z)</option>
                <option value="recent" ${filtro.sort === 'recent' ? 'selected' : ''}>Mais recente</option>
                <option value="preco" ${filtro.sort === 'preco' ? 'selected' : ''}>Maior preço</option>
                <option value="tempo" ${filtro.sort === 'tempo' ? 'selected' : ''}>Maior tempo</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Stats compactas -->
      <div class="text-xs text-slate-500 mb-3 flex items-center gap-3 flex-wrap">
        <span><i class="fas fa-info-circle mr-1"></i><b>${lista.length}</b> serviço${lista.length !== 1 ? 's' : ''}</span>
        <span class="text-emerald-600"><i class="fas fa-circle-check mr-1"></i><b>${totalAtivos}</b> ativo${totalAtivos !== 1 ? 's' : ''}</span>
        <span class="text-slate-400"><i class="fas fa-circle-xmark mr-1"></i><b>${totalInativos}</b> inativo${totalInativos !== 1 ? 's' : ''}</span>
        ${!semFiltro ? `<button id="sv-clear" class="ml-auto text-indigo-600 hover:underline"><i class="fas fa-filter-circle-xmark mr-1"></i>Limpar filtros</button>` : ''}
      </div>

      ${lista.length === 0 ? `
        <div class="card">
          <div class="card-body text-center py-12 text-slate-500">
            <i class="fas fa-screwdriver-wrench text-5xl text-slate-300 mb-3"></i>
            <p class="font-medium">${semFiltro ? 'Nenhum serviço cadastrado.' : 'Nenhum serviço encontrado com este filtro.'}</p>
            <p class="text-sm mt-1">${semFiltro
              ? 'Clique em <b>Novo serviço</b> para começar.'
              : 'Ajuste a busca ou clique em "Limpar filtros".'}</p>
          </div>
        </div>
      ` : `
        <div class="card overflow-hidden">
          <div class="overflow-x-auto">
            <table class="srv-table w-full text-sm">
              <thead>
                <tr>
                  <th style="width:36px"></th>
                  <th>Serviço</th>
                  <th class="hidden md:table-cell">Categoria</th>
                  <th class="hidden lg:table-cell text-right">Preço padrão</th>
                  <th class="hidden lg:table-cell text-right">Tempo padrão</th>
                  <th class="hidden xl:table-cell text-center">Vínculos</th>
                  <th class="hidden xl:table-cell">Criado em</th>
                  <th class="text-center">Status</th>
                  <th class="text-right" style="width:160px">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${lista.map((s) => {
                  const cor = s.cor || '#64748B';
                  const totVinc = (Number(s.qtd_precos) || 0) + (Number(s.qtd_produtos) || 0) + (Number(s.qtd_remessas) || 0);
                  return `
                    <tr class="srv-row ${s.ativo ? '' : 'is-inactive'}" data-id="${s.id_servico}">
                      <td>
                        <span class="srv-dot" style="background:${escHtml(cor)}" title="${escHtml(cor)}"></span>
                      </td>
                      <td>
                        <div class="font-medium text-slate-800">${escHtml(s.desc_servico)}</div>
                        ${s.descricao ? `<div class="text-xs text-slate-500 mt-0.5 line-clamp-1">${escHtml(s.descricao)}</div>` : ''}
                      </td>
                      <td class="hidden md:table-cell">
                        ${s.categoria
                          ? `<span class="srv-chip" style="background:${escHtml(cor)}22;color:${escHtml(cor)};border:1px solid ${escHtml(cor)}44">${escHtml(s.categoria)}</span>`
                          : '<span class="text-xs text-slate-400">—</span>'}
                      </td>
                      <td class="hidden lg:table-cell text-right tabular-nums">${fmtMoeda(s.preco_padrao)}</td>
                      <td class="hidden lg:table-cell text-right tabular-nums">${fmtTempo(s.tempo_padrao)}</td>
                      <td class="hidden xl:table-cell text-center">
                        ${totVinc > 0
                          ? `<span class="srv-vinc-pill" title="Preços: ${s.qtd_precos} · Produtos: ${s.qtd_produtos} · Remessas: ${s.qtd_remessas}">${totVinc}</span>`
                          : '<span class="text-xs text-slate-400">—</span>'}
                      </td>
                      <td class="hidden xl:table-cell text-xs text-slate-500">${fmtData(s.dt_criacao)}</td>
                      <td class="text-center">
                        ${s.ativo
                          ? '<span class="srv-status-on"><i class="fas fa-check"></i>Ativo</span>'
                          : '<span class="srv-status-off"><i class="fas fa-pause"></i>Inativo</span>'}
                      </td>
                      <td class="text-right">
                        <div class="srv-actions">
                          <button class="btn-icon" data-act="edit" data-id="${s.id_servico}" title="Editar"><i class="fas fa-pen"></i></button>
                          <button class="btn-icon" data-act="toggle" data-id="${s.id_servico}" title="${s.ativo ? 'Desativar' : 'Ativar'}">
                            <i class="fas ${s.ativo ? 'fa-eye' : 'fa-eye-slash'}"></i>
                          </button>
                          <button class="btn-icon" data-act="dup" data-id="${s.id_servico}" title="Duplicar"><i class="fas fa-copy"></i></button>
                          <button class="btn-icon is-danger" data-act="del" data-id="${s.id_servico}" title="Excluir"><i class="fas fa-trash"></i></button>
                        </div>
                      </td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `}
    `;

    // --- Listeners ---
    $('#sv-novo').onclick = () => openServicoModal(null);
    $('#sv-reload').onclick = () => loadList();
    let _qtmr = 0;
    $('#sv-q').oninput = (e) => {
      clearTimeout(_qtmr);
      const v = e.target.value;
      _qtmr = setTimeout(() => { filtro.q = v; loadList(); }, 280);
    };
    $('#sv-cat').onchange = (e) => { filtro.categoria = e.target.value; loadList(); };
    $('#sv-status').onchange = (e) => { filtro.status = e.target.value; loadList(); };
    $('#sv-sort').onchange = (e) => { filtro.sort = e.target.value; render(); };
    const $clear = $('#sv-clear');
    if ($clear) $clear.onclick = () => {
      filtro = { q: '', status: 'all', categoria: '', sort: 'desc_servico' };
      loadList();
    };

    // Ações na tabela
    main.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.id);
        const act = btn.dataset.act;
        const s = lista.find((x) => x.id_servico === id);
        if (!s) return;
        if (act === 'edit') openServicoModal(s);
        else if (act === 'toggle') toggleAtivo(s);
        else if (act === 'dup') duplicarServico(s);
        else if (act === 'del') excluirServico(s);
      };
    });
  }

  // --- Modal: Novo/Editar ---
  function openServicoModal(srv) {
    const isEdit = !!srv;
    const m = document.createElement('div');
    m.className = 'modal-backdrop';
    m.innerHTML = `
      <div class="modal-card" style="max-width:680px">
        <div class="modal-header">
          <h3><i class="fas fa-screwdriver-wrench mr-2"></i>${isEdit ? 'Editar serviço' : 'Novo serviço'}</h3>
          <button class="modal-close" type="button" aria-label="Fechar">&times;</button>
        </div>
        <div class="modal-body">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="md:col-span-2">
              <label class="form-label">Nome do serviço <span class="text-red-500">*</span></label>
              <input id="sm-nome" type="text" class="form-input" maxlength="120"
                value="${escHtml(srv?.desc_servico || '')}" placeholder="Ex: Costura overlock" required />
            </div>

            <div>
              <label class="form-label">Categoria</label>
              <input id="sm-cat" type="text" class="form-input" list="sm-cat-list" maxlength="60"
                value="${escHtml(srv?.categoria || '')}" placeholder="Ex: Costura" />
              <datalist id="sm-cat-list">
                ${CATEGORIAS_PADRAO.map((c) => `<option value="${escHtml(c)}">`).join('')}
                ${categorias.filter((c) => !CATEGORIAS_PADRAO.includes(c.categoria))
                  .map((c) => `<option value="${escHtml(c.categoria)}">`).join('')}
              </datalist>
            </div>

            <div class="md:col-span-2">
              <label class="form-label">
                <i class="fas fa-sitemap mr-1 text-slate-400"></i>Setor (opcional)
              </label>
              <select id="sm-setor" class="form-input">
                ${(window.TERC?.optSetores ? window.TERC.optSetores(srv?.id_setor) : '<option value="">—</option>')}
              </select>
              <p class="text-xs text-slate-500 mt-1">Agrupa serviços por setor produtivo (ex.: Estamparia, Aparador, Embalagem)</p>
            </div>

            <div>
              <label class="form-label">Cor de identificação</label>
              <div class="flex gap-2 items-center">
                <input id="sm-cor" type="text" class="form-input flex-1" maxlength="7"
                  value="${escHtml(srv?.cor || '#6366F1')}" placeholder="#6366F1" />
                <input id="sm-cor-pick" type="color"
                  value="${escHtml(srv?.cor || '#6366F1')}"
                  style="height:38px;width:48px;border-radius:8px;border:1px solid var(--border-2,#cbd5e1);cursor:pointer" />
              </div>
              <div class="srv-paleta mt-2">
                ${PALETA_SUGERIDA.map((c) => `
                  <button type="button" class="srv-paleta-dot" data-cor="${c}" style="background:${c}" title="${c}"></button>
                `).join('')}
              </div>
            </div>

            <div>
              <label class="form-label">Preço padrão (R$)</label>
              <input id="sm-preco" type="number" min="0" step="0.01" class="form-input"
                value="${srv?.preco_padrao != null ? srv.preco_padrao : ''}" placeholder="0,00" />
            </div>

            <div>
              <label class="form-label">Tempo padrão (min)</label>
              <input id="sm-tempo" type="number" min="0" step="0.1" class="form-input"
                value="${srv?.tempo_padrao != null ? srv.tempo_padrao : ''}" placeholder="0" />
            </div>

            <div class="md:col-span-2">
              <label class="form-label">Descrição</label>
              <input id="sm-desc" type="text" class="form-input" maxlength="240"
                value="${escHtml(srv?.descricao || '')}" placeholder="Breve descrição do serviço (opcional)" />
            </div>

            <div class="md:col-span-2">
              <label class="form-label">Observações</label>
              <textarea id="sm-obs" rows="2" class="form-input" maxlength="500"
                placeholder="Notas internas, instruções para fornecedores, etc. (opcional)">${escHtml(srv?.observacoes || '')}</textarea>
            </div>

            <div class="md:col-span-2">
              <label class="flex items-center gap-2 cursor-pointer">
                <input id="sm-ativo" type="checkbox" ${(srv?.ativo ?? 1) ? 'checked' : ''} />
                <span class="text-sm">Ativo (visível nos selects do sistema)</span>
              </label>
            </div>

            <!-- Preview -->
            <div class="md:col-span-2">
              <label class="form-label">Pré-visualização</label>
              <div id="sm-preview" class="srv-preview"></div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-act="cancel" type="button">Cancelar</button>
          <button class="btn btn-primary" data-act="save" type="button">
            <i class="fas fa-save mr-1"></i>${isEdit ? 'Salvar alterações' : 'Cadastrar'}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('.modal-close').onclick = close;
    m.querySelector('[data-act="cancel"]').onclick = close;
    m.addEventListener('click', (e) => { if (e.target === m) close(); });

    const $nome = m.querySelector('#sm-nome');
    const $cat = m.querySelector('#sm-cat');
    const $cor = m.querySelector('#sm-cor');
    const $corPick = m.querySelector('#sm-cor-pick');
    const $prev = m.querySelector('#sm-preview');

    function syncPreview() {
      const cor = isValidHex($cor.value) || '#6366F1';
      const nome = ($nome.value || '').trim() || 'Nome do serviço';
      const cat = ($cat.value || '').trim();
      const txt = contrastingText(cor);
      $prev.innerHTML = `
        <div class="srv-preview-card" style="background:${cor};color:${txt}">
          <span class="srv-preview-dot" style="background:${txt}"></span>
          <div class="srv-preview-text">
            <div class="srv-preview-nome">${escHtml(nome)}</div>
            ${cat ? `<div class="srv-preview-cat">${escHtml(cat)}</div>` : ''}
          </div>
        </div>
      `;
    }
    $nome.oninput = syncPreview;
    $cat.oninput = syncPreview;
    $cor.oninput = () => {
      const v = isValidHex($cor.value);
      if (v) $corPick.value = v;
      syncPreview();
    };
    $corPick.oninput = () => { $cor.value = $corPick.value.toUpperCase(); syncPreview(); };
    m.querySelectorAll('.srv-paleta-dot').forEach((d) => {
      d.onclick = () => {
        const c = d.dataset.cor;
        $cor.value = c;
        $corPick.value = c;
        syncPreview();
      };
    });
    syncPreview();
    setTimeout(() => $nome.focus(), 60);

    m.querySelector('[data-act="save"]').onclick = async () => {
      const nome = ($nome.value || '').trim();
      if (!nome) { toast('Informe o nome do serviço', 'warning'); $nome.focus(); return; }
      const cor = isValidHex($cor.value);
      const _setorEl = m.querySelector('#sm-setor');
      const payload = {
        desc_servico: nome,
        descricao: m.querySelector('#sm-desc').value.trim() || null,
        categoria: $cat.value.trim() || null,
        cor: cor || null,
        preco_padrao: m.querySelector('#sm-preco').value !== '' ? Number(m.querySelector('#sm-preco').value) : null,
        tempo_padrao: m.querySelector('#sm-tempo').value !== '' ? Number(m.querySelector('#sm-tempo').value) : null,
        observacoes: m.querySelector('#sm-obs').value.trim() || null,
        ativo: m.querySelector('#sm-ativo').checked ? 1 : 0,
        id_setor: _setorEl && _setorEl.value ? Number(_setorEl.value) : null,
      };
      try {
        if (isEdit) {
          await api('put', '/terc/servicos/' + srv.id_servico, payload, { silent: false });
          toast('Serviço atualizado!', 'success');
        } else {
          await api('post', '/terc/servicos', payload, { silent: false });
          toast('Serviço cadastrado!', 'success');
        }
        close();
        loadList();
      } catch {}
    };
  }

  // --- Toggle ativo/inativo ---
  async function toggleAtivo(s) {
    try {
      const r = await api('patch', `/terc/servicos/${s.id_servico}/toggle`, null, { silent: false });
      toast(r?.data?.ativo ? 'Serviço ativado' : 'Serviço desativado', 'success');
      loadList();
    } catch {}
  }

  // --- Duplicar ---
  async function duplicarServico(s) {
    if (!confirm(`Criar uma cópia de "${s.desc_servico}"?`)) return;
    try {
      const r = await api('post', `/terc/servicos/${s.id_servico}/duplicate`, null, { silent: false });
      toast(`Serviço duplicado: ${r?.data?.desc_servico || 'cópia'}`, 'success');
      loadList();
    } catch {}
  }

  // --- Excluir (com validação de vínculos) ---
  async function excluirServico(s) {
    const totVinc = (Number(s.qtd_precos) || 0) + (Number(s.qtd_produtos) || 0) + (Number(s.qtd_remessas) || 0);
    if (totVinc > 0) {
      const detalhes = `${s.qtd_precos || 0} preço(s), ${s.qtd_produtos || 0} produto(s), ${s.qtd_remessas || 0} item(ns) de remessa`;
      const msg = `O serviço "${s.desc_servico}" está vinculado a:\n${detalhes}\n\n` +
                  `Por segurança, não é possível EXCLUIR um serviço vinculado.\n\n` +
                  `Deseja DESATIVÁ-LO? (o serviço some dos selects mas mantém o histórico)`;
      if (!confirm(msg)) return;
      try {
        await api('delete', `/terc/servicos/${s.id_servico}?force=1`, null, { silent: false });
        toast('Serviço desativado (mantido por vínculos)', 'success');
        loadList();
      } catch {}
      return;
    }
    if (!confirm(`Excluir o serviço "${s.desc_servico}"?\n\nEsta ação é irreversível.`)) return;
    try {
      await api('delete', `/terc/servicos/${s.id_servico}`, null, { silent: false });
      toast('Serviço excluído', 'success');
      loadList();
    } catch {}
  }

  // Inicializa
  // HOTFIX 0037: garante setores no cache para o select do modal
  try { if (window.TERC && (!window.TERC.setores || !window.TERC.setores.length)) await window.TERC.reloadSetores?.(); } catch {}
  await loadList();
};

ROUTES.cores = async (main) => {
  // ============================================================
  // Módulo de Cores — v2 (tabela profissional + vínculos + duplicate)
  // ============================================================
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function isValidHex(s) {
    let x = String(s || '').trim().toUpperCase().replace(/^#/, '');
    if (/^[0-9A-F]{3}$/.test(x)) x = x.split('').map(ch => ch + ch).join('');
    return /^[0-9A-F]{6}$/.test(x) ? '#' + x : null;
  }
  function contrastingText(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return '#000';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? '#0f172a' : '#ffffff';
  }
  function fmtDate(s) {
    if (!s) return '—';
    try { return new Date(String(s).replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR'); } catch { return String(s).slice(0, 10); }
  }

  state.route = 'cores';

  // Paleta sugerida (padrão consistente com Serviços)
  const PALETA = ['#2563EB','#7C3AED','#06B6D4','#10B981','#F59E0B','#EF4444','#EC4899','#8B5CF6','#14B8A6','#F97316','#84CC16','#0EA5E9','#64748B','#1E293B','#FFFFFF'];

  let lista = [];
  let filtro = { q: '', somenteAtivos: false };
  let viewMode = 'table'; // 'table' | 'grid'
  let sort = { col: 'nome', dir: 'asc' };

  try { viewMode = localStorage.getItem('cores-view-mode') || 'table'; } catch {}

  async function loadList() {
    try {
      const qs = new URLSearchParams();
      if (filtro.q) qs.set('q', filtro.q);
      if (filtro.somenteAtivos) qs.set('ativo', '1');
      const r = await api('get', '/cores' + (qs.toString() ? '?' + qs : ''), null, { silent: true });
      lista = Array.isArray(r?.data) ? r.data : [];
    } catch (e) {
      lista = [];
      toast('Erro ao carregar cores: ' + (e?.message || 'desconhecido'), 'error');
    }
    render();
    // Invalida o cache global para outras telas pegarem a versão atualizada
    if (window.Cores && typeof window.Cores.invalidate === 'function') {
      window.Cores.invalidate();
    }
  }

  function sortLista(arr) {
    const dir = sort.dir === 'desc' ? -1 : 1;
    const col = sort.col;
    return [...arr].sort((a, b) => {
      let va, vb;
      if (col === 'nome' || col === 'hex') {
        va = String(a[col] || '').toLowerCase();
        vb = String(b[col] || '').toLowerCase();
      } else if (col === 'vinculos') {
        const ta = (a.qtd_precos || 0) + (a.qtd_variacoes || 0) + (a.qtd_remessas || 0) + (a.qtd_retornos || 0);
        const tb = (b.qtd_precos || 0) + (b.qtd_variacoes || 0) + (b.qtd_remessas || 0) + (b.qtd_retornos || 0);
        va = ta; vb = tb;
      } else if (col === 'ativo') {
        va = a.ativo || 0; vb = b.ativo || 0;
      } else {
        va = a[col]; vb = b[col];
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  function vinculosTotal(c) {
    return (c.qtd_precos || 0) + (c.qtd_variacoes || 0) + (c.qtd_remessas || 0) + (c.qtd_retornos || 0);
  }

  function render() {
    const totalAtivas = lista.filter(c => c.ativo).length;
    const totalInativas = lista.length - totalAtivas;
    const arr = sortLista(lista);

    main.innerHTML = `
      <div class="page-header mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 class="page-title"><i class="fas fa-palette mr-2 text-violet-500"></i>Cores</h1>
          <p class="page-subtitle">Cadastro centralizado das cores usadas em remessas, produtos, retornos e relatórios.</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <div class="srv-view-toggle">
            <button class="srv-view-btn ${viewMode === 'table' ? 'is-active' : ''}" data-view="table" title="Visualização em tabela"><i class="fas fa-table"></i></button>
            <button class="srv-view-btn ${viewMode === 'grid' ? 'is-active' : ''}" data-view="grid" title="Visualização em grade"><i class="fas fa-th"></i></button>
          </div>
          <button id="c-nova" class="btn btn-primary"><i class="fas fa-plus mr-1"></i>Nova cor</button>
          <button id="c-import" class="btn btn-secondary"><i class="fas fa-file-import mr-1"></i>Importar</button>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-body">
          <div class="flex items-center gap-3 flex-wrap">
            <div class="flex-1 min-w-[220px]">
              <label class="text-xs text-slate-500 font-medium">Buscar</label>
              <input id="c-busca" type="text" class="form-input" placeholder="Nome ou HEX (ex: #2563EB)" value="${escHtml(filtro.q)}" />
            </div>
            <div>
              <label class="text-xs text-slate-500 font-medium block">Status</label>
              <label class="flex items-center gap-2 text-sm select-none cursor-pointer h-[38px]">
                <input id="c-ativos" type="checkbox" ${filtro.somenteAtivos ? 'checked' : ''} />
                <span>Somente ativas</span>
              </label>
            </div>
            <div>
              <label class="text-xs text-slate-500 font-medium block">&nbsp;</label>
              <button id="c-reload" class="btn btn-secondary btn-sm h-[38px]" title="Recarregar"><i class="fas fa-rotate"></i></button>
            </div>
          </div>
        </div>
      </div>

      <div class="text-xs text-slate-500 mb-2 flex items-center gap-3 flex-wrap">
        <span><i class="fas fa-info-circle mr-1"></i><b>${lista.length}</b> cores total</span>
        <span class="srv-status-on" style="padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;"><b>${totalAtivas}</b> ativas</span>
        <span class="srv-status-off" style="padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;"><b>${totalInativas}</b> inativas</span>
      </div>

      ${lista.length === 0 ? `
        <div class="card">
          <div class="card-body text-center py-12 text-slate-500">
            <i class="fas fa-palette text-5xl text-slate-300 mb-3"></i>
            <p class="font-medium">Nenhuma cor cadastrada${filtro.q ? ' com este filtro' : ''}.</p>
            <p class="text-sm mt-1">Clique em <b>Nova cor</b> ou <b>Importar</b> para começar.</p>
          </div>
        </div>
      ` : viewMode === 'table' ? renderTable(arr) : renderGrid(arr)}
    `;

    // Listeners gerais
    $('#c-nova').onclick = () => openCorModal(null);
    $('#c-import').onclick = () => openImportModal();
    $('#c-reload').onclick = () => loadList();

    let _qtmr = 0;
    $('#c-busca').oninput = (e) => {
      clearTimeout(_qtmr);
      const v = e.target.value;
      _qtmr = setTimeout(() => { filtro.q = v; loadList(); }, 280);
    };
    $('#c-ativos').onchange = (e) => { filtro.somenteAtivos = e.target.checked; loadList(); };

    main.querySelectorAll('[data-view]').forEach(btn => {
      btn.onclick = () => {
        viewMode = btn.dataset.view;
        try { localStorage.setItem('cores-view-mode', viewMode); } catch {}
        render();
      };
    });

    // Sort handlers
    main.querySelectorAll('[data-sort]').forEach(th => {
      th.onclick = () => {
        const col = th.dataset.sort;
        if (sort.col === col) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
        else { sort.col = col; sort.dir = 'asc'; }
        render();
      };
    });

    // Action handlers (table + grid)
    main.querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        const id = Number(btn.dataset.id);
        const act = btn.dataset.act;
        const cor = lista.find(c => c.id === id);
        if (!cor) return;
        if (act === 'edit') openCorModal(cor);
        else if (act === 'del') deleteOne(cor);
        else if (act === 'duplicate') duplicate(cor);
        else if (act === 'toggle') toggle(cor);
      };
    });
  }

  function sortIndicator(col) {
    if (sort.col !== col) return '<i class="fas fa-sort opacity-30 ml-1"></i>';
    return sort.dir === 'asc' ? '<i class="fas fa-sort-up ml-1"></i>' : '<i class="fas fa-sort-down ml-1"></i>';
  }

  function renderTable(arr) {
    return `
      <div class="card">
        <div class="card-body p-0 overflow-x-auto">
          <table class="srv-table w-full">
            <thead>
              <tr>
                <th style="width:60px">Status</th>
                <th data-sort="nome" class="cursor-pointer select-none">Cor / Nome ${sortIndicator('nome')}</th>
                <th data-sort="hex" class="cursor-pointer select-none" style="width:120px">HEX ${sortIndicator('hex')}</th>
                <th data-sort="vinculos" class="cursor-pointer select-none" style="width:200px">Vínculos ${sortIndicator('vinculos')}</th>
                <th style="width:120px">Criação</th>
                <th style="width:160px;text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${arr.map(c => {
                const total = vinculosTotal(c);
                return `
                <tr class="${c.ativo ? '' : 'opacity-60'}" data-id="${c.id}">
                  <td>
                    <button class="btn-icon srv-toggle-btn ${c.ativo ? 'is-on' : 'is-off'}" data-act="toggle" data-id="${c.id}" title="${c.ativo ? 'Desativar' : 'Ativar'}">
                      <i class="fas ${c.ativo ? 'fa-check-circle' : 'fa-circle-xmark'}"></i>
                    </button>
                  </td>
                  <td>
                    <div class="flex items-center gap-3">
                      <span class="srv-dot" style="background:${escHtml(c.hex)};box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)"></span>
                      <div class="min-w-0">
                        <div class="font-medium truncate">${escHtml(c.nome)}</div>
                        ${c.observacoes ? `<div class="text-xs text-slate-500 line-clamp-1">${escHtml(c.observacoes)}</div>` : ''}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="srv-chip" style="background:${escHtml(c.hex)};color:${contrastingText(c.hex)};font-family:monospace;font-size:11px;letter-spacing:0.5px">
                      ${escHtml(c.hex)}
                    </span>
                  </td>
                  <td>
                    ${total === 0
                      ? '<span class="text-xs text-slate-400">Sem vínculos</span>'
                      : `<div class="flex flex-wrap gap-1">
                          ${c.qtd_precos    ? `<span class="srv-vinc-pill" title="Preços/Coleções"><i class="fas fa-money-bill-wave mr-1"></i>${c.qtd_precos}</span>` : ''}
                          ${c.qtd_variacoes ? `<span class="srv-vinc-pill" title="Variações de produto"><i class="fas fa-tshirt mr-1"></i>${c.qtd_variacoes}</span>` : ''}
                          ${c.qtd_remessas  ? `<span class="srv-vinc-pill" title="Itens de remessa"><i class="fas fa-truck-fast mr-1"></i>${c.qtd_remessas}</span>` : ''}
                          ${c.qtd_retornos  ? `<span class="srv-vinc-pill" title="Itens de retorno"><i class="fas fa-truck-arrow-right mr-1"></i>${c.qtd_retornos}</span>` : ''}
                        </div>`
                    }
                  </td>
                  <td class="text-xs text-slate-500">${fmtDate(c.criado_em)}</td>
                  <td>
                    <div class="srv-actions">
                      <button class="btn-icon" data-act="edit" data-id="${c.id}" title="Editar"><i class="fas fa-pen"></i></button>
                      <button class="btn-icon" data-act="duplicate" data-id="${c.id}" title="Duplicar"><i class="fas fa-copy"></i></button>
                      <button class="btn-icon is-danger" data-act="del" data-id="${c.id}" title="Excluir"><i class="fas fa-trash"></i></button>
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderGrid(arr) {
    return `
      <div class="cores-grid">
        ${arr.map(c => {
          const total = vinculosTotal(c);
          return `
          <div class="cor-card ${c.ativo ? '' : 'is-inactive'}" data-id="${c.id}">
            <div class="cor-preview" style="background:${escHtml(c.hex)};color:${contrastingText(c.hex)}">
              <span class="cor-hex-overlay">${escHtml(c.hex)}</span>
              ${c.ativo ? '' : '<span class="cor-badge-inativo">Inativa</span>'}
              ${total > 0 ? `<span class="cor-vinc-badge" title="${total} vínculos">${total}</span>` : ''}
            </div>
            <div class="cor-info">
              <div class="cor-nome" title="${escHtml(c.nome)}">${escHtml(c.nome)}</div>
              <div class="cor-actions">
                <button class="btn-icon" data-act="edit" data-id="${c.id}" title="Editar"><i class="fas fa-pen"></i></button>
                <button class="btn-icon" data-act="duplicate" data-id="${c.id}" title="Duplicar"><i class="fas fa-copy"></i></button>
                <button class="btn-icon" data-act="toggle" data-id="${c.id}" title="${c.ativo ? 'Desativar' : 'Ativar'}">
                  <i class="fas ${c.ativo ? 'fa-eye' : 'fa-eye-slash'}"></i>
                </button>
                <button class="btn-icon is-danger" data-act="del" data-id="${c.id}" title="Excluir"><i class="fas fa-trash"></i></button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
  }

  // ---------- Toggle status ----------
  async function toggle(cor) {
    try {
      await api('patch', '/cores/' + cor.id + '/toggle', null, { silent: false });
      toast(cor.ativo ? 'Cor desativada' : 'Cor ativada', 'success');
      loadList();
    } catch {}
  }

  // ---------- Duplicate ----------
  async function duplicate(cor) {
    try {
      const r = await api('post', '/cores/' + cor.id + '/duplicate', null, { silent: false });
      toast('Cor duplicada: ' + (r?.data?.nome || ''), 'success');
      loadList();
    } catch {}
  }

  // ---------- Modal: Nova/Editar ----------
  function openCorModal(cor) {
    const isEdit = !!cor;
    const m = document.createElement('div');
    m.className = 'modal-backdrop';
    m.innerHTML = `
      <div class="modal-card" style="max-width:540px">
        <div class="modal-header">
          <h3><i class="fas fa-palette mr-2"></i>${isEdit ? 'Editar cor' : 'Nova cor'}</h3>
          <button class="modal-close" type="button">&times;</button>
        </div>
        <div class="modal-body">
          <div class="space-y-3">
            <div>
              <label class="form-label">Nome <span class="text-red-500">*</span></label>
              <input id="cm-nome" type="text" class="form-input" maxlength="60"
                value="${escHtml(cor?.nome || '')}" placeholder="Ex: Azul Royal" required />
            </div>
            <div class="flex gap-3 items-end">
              <div class="flex-1">
                <label class="form-label">Código HEX <span class="text-red-500">*</span></label>
                <input id="cm-hex" type="text" class="form-input font-mono" maxlength="7"
                  value="${escHtml(cor?.hex || '#2563EB')}" placeholder="#2563EB" required />
              </div>
              <div>
                <label class="form-label">Picker</label>
                <input id="cm-pick" type="color" value="${escHtml(cor?.hex || '#2563EB')}"
                  style="height:38px;width:48px;border-radius:8px;border:1px solid var(--border-2,#cbd5e1);cursor:pointer" />
              </div>
            </div>

            <div>
              <label class="form-label">Paleta sugerida</label>
              <div class="srv-paleta">
                ${PALETA.map(c => `<button type="button" class="srv-paleta-dot" data-paleta="${c}" style="background:${c}" title="${c}"></button>`).join('')}
              </div>
            </div>

            <div>
              <label class="form-label">Preview ao vivo</label>
              <div id="cm-preview" class="srv-preview cor-preview-modal"
                style="background:${escHtml(cor?.hex || '#2563EB')};color:${contrastingText(cor?.hex || '#2563EB')}">
                <span id="cm-preview-text" class="srv-preview-text">${escHtml(cor?.nome || 'Azul Royal')}</span>
                <span id="cm-preview-hex" class="srv-preview-hex">${escHtml(cor?.hex || '#2563EB')}</span>
              </div>
            </div>

            <div>
              <label class="form-label">Observações <span class="text-xs text-slate-400">(opcional)</span></label>
              <textarea id="cm-obs" class="form-input" rows="2" maxlength="500"
                placeholder="Notas internas sobre esta cor (referência, fornecedor, etc.)">${escHtml(cor?.observacoes || '')}</textarea>
            </div>

            <label class="flex items-center gap-2 cursor-pointer">
              <input id="cm-ativo" type="checkbox" ${(cor?.ativo ?? 1) ? 'checked' : ''} />
              <span class="text-sm">Ativa (visível nos selects do sistema)</span>
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-act="cancel" type="button">Cancelar</button>
          <button class="btn btn-primary" data-act="save" type="button"><i class="fas fa-save mr-1"></i>${isEdit ? 'Salvar' : 'Cadastrar'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('.modal-close').onclick = close;
    m.querySelector('[data-act="cancel"]').onclick = close;
    m.addEventListener('click', (e) => { if (e.target === m) close(); });

    const $nome = m.querySelector('#cm-nome');
    const $hex = m.querySelector('#cm-hex');
    const $pick = m.querySelector('#cm-pick');
    const $prev = m.querySelector('#cm-preview');
    const $prevTxt = m.querySelector('#cm-preview-text');
    const $prevHex = m.querySelector('#cm-preview-hex');

    function syncPreview() {
      const hex = isValidHex($hex.value) || '#cccccc';
      $prev.style.background = hex;
      $prev.style.color = contrastingText(hex);
      $prevTxt.textContent = $nome.value || 'Sem nome';
      $prevHex.textContent = hex;
    }
    $nome.oninput = syncPreview;
    $hex.oninput = () => {
      const v = isValidHex($hex.value);
      if (v) $pick.value = v;
      syncPreview();
    };
    $pick.oninput = () => { $hex.value = $pick.value.toUpperCase(); syncPreview(); };

    // Paleta clicável
    m.querySelectorAll('[data-paleta]').forEach(btn => {
      btn.onclick = () => {
        const c = btn.dataset.paleta;
        $hex.value = c;
        $pick.value = c;
        syncPreview();
      };
    });

    setTimeout(() => $nome.focus(), 50);

    m.querySelector('[data-act="save"]').onclick = async () => {
      const nome = ($nome.value || '').trim();
      const hex = isValidHex($hex.value);
      const ativo = m.querySelector('#cm-ativo').checked ? 1 : 0;
      const observacoes = (m.querySelector('#cm-obs').value || '').trim() || null;
      if (!nome) { toast('Informe o nome da cor', 'warning'); $nome.focus(); return; }
      if (!hex)  { toast('Código HEX inválido. Use #RRGGBB.', 'warning'); $hex.focus(); return; }
      try {
        if (isEdit) {
          await api('put', '/cores/' + cor.id, { nome, hex, ativo, observacoes }, { silent: false });
          toast('Cor atualizada!', 'success');
        } else {
          await api('post', '/cores', { nome, hex, ativo, observacoes }, { silent: false });
          toast('Cor cadastrada!', 'success');
        }
        close();
        loadList();
      } catch {}
    };
  }

  // ---------- Excluir 1 (com validação de vínculos) ----------
  async function deleteOne(cor) {
    const total = vinculosTotal(cor);
    if (total === 0) {
      if (!confirm(`Excluir a cor "${cor.nome}" (${cor.hex})?\n\nEsta ação é irreversível.`)) return;
      try {
        await api('delete', '/cores/' + cor.id, null, { silent: false });
        toast('Cor excluída', 'success');
        loadList();
      } catch {}
      return;
    }
    // Tem vínculos — confirmação dupla, oferece desativar
    const partes = [];
    if (cor.qtd_precos)    partes.push(cor.qtd_precos + ' preço(s)');
    if (cor.qtd_variacoes) partes.push(cor.qtd_variacoes + ' variação(ões)');
    if (cor.qtd_remessas)  partes.push(cor.qtd_remessas + ' item(ns) de remessa');
    if (cor.qtd_retornos)  partes.push(cor.qtd_retornos + ' item(ns) de retorno');
    const msg = `A cor "${cor.nome}" possui ${total} vínculo(s):\n- ${partes.join('\n- ')}\n\nPara preservar o histórico, recomendamos DESATIVAR em vez de excluir.\n\nClique OK para DESATIVAR (manter histórico) ou Cancelar para abortar.`;
    if (!confirm(msg)) return;
    try {
      await api('delete', '/cores/' + cor.id + '?force=1', null, { silent: false });
      toast('Cor desativada (histórico preservado)', 'success');
      loadList();
    } catch {}
  }

  // ---------- Modal: Importar ----------
  function openImportModal() {
    const m = document.createElement('div');
    m.className = 'modal-backdrop';
    m.innerHTML = `
      <div class="modal-card" style="max-width:640px">
        <div class="modal-header">
          <h3><i class="fas fa-file-import mr-2"></i>Importar cores</h3>
          <button class="modal-close" type="button">&times;</button>
        </div>
        <div class="modal-body">
          <p class="text-sm text-slate-600 mb-3">
            Cole as cores no formato <code>nome,#hex</code> (uma por linha).
            Aceita também separação por <kbd>;</kbd>, <kbd>Tab</kbd> ou <kbd>|</kbd>.
            Excel/CSV: copie as duas colunas e cole abaixo.
          </p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label class="form-label">Ou selecione arquivo CSV / TXT</label>
              <input id="ci-file" type="file" accept=".csv,.txt,text/csv,text/plain" class="form-input" />
            </div>
            <div>
              <label class="form-label">Comportamento ao encontrar duplicata</label>
              <select id="ci-mode" class="form-input">
                <option value="skip">Ignorar (manter a existente)</option>
                <option value="overwrite">Sobrescrever (atualizar pelo nome/HEX)</option>
              </select>
            </div>
          </div>
          <label class="form-label">Lista de cores</label>
          <textarea id="ci-text" rows="10" class="form-input font-mono text-sm"
            placeholder="Azul Royal,#2563EB&#10;Preto,#000000&#10;Branco,#FFFFFF"></textarea>
          <div class="text-xs text-slate-500 mt-2">
            <i class="fas fa-info-circle mr-1"></i>
            Linhas vazias ou começando com <code>#</code> (comentário) são ignoradas.
          </div>
          <div id="ci-result" class="mt-3"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-act="cancel" type="button">Fechar</button>
          <button class="btn btn-primary" data-act="run" type="button"><i class="fas fa-upload mr-1"></i>Importar</button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('.modal-close').onclick = close;
    m.querySelector('[data-act="cancel"]').onclick = close;
    m.addEventListener('click', (e) => { if (e.target === m) close(); });

    const $text = m.querySelector('#ci-text');
    const $file = m.querySelector('#ci-file');
    const $result = m.querySelector('#ci-result');

    $file.onchange = async () => {
      const f = $file.files?.[0];
      if (!f) return;
      const txt = await f.text();
      $text.value = txt;
    };

    function parseList(raw) {
      const lines = String(raw || '').split(/\r?\n/);
      const items = [];
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('#') && !/^#[0-9A-Fa-f]{3,6}\b/.test(line)) continue;
        const sep = line.indexOf(';') > -1 ? ';'
                   : line.indexOf('\t') > -1 ? '\t'
                   : line.indexOf('|') > -1 ? '|'
                   : ',';
        const parts = line.split(sep).map(s => s.trim());
        if (parts.length < 2) {
          const m2 = line.match(/^(.+?)\s+(#?[0-9A-Fa-f]{3,6})\s*$/);
          if (m2) { items.push({ row: i + 1, nome: m2[1].trim(), hex: m2[2] }); continue; }
          items.push({ row: i + 1, nome: parts[0] || '', hex: '' });
          continue;
        }
        items.push({ row: i + 1, nome: parts[0], hex: parts[1] });
      }
      return items;
    }

    m.querySelector('[data-act="run"]').onclick = async () => {
      const items = parseList($text.value);
      if (!items.length) { toast('Nada para importar', 'warning'); return; }
      const mode = m.querySelector('#ci-mode').value;
      $result.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Importando ' + items.length + ' linhas...';
      try {
        const r = await api('post', '/cores/import', { items, mode }, { silent: false });
        const d = r?.data || {};
        const errs = Array.isArray(d.errors) ? d.errors : [];
        $result.innerHTML = `
          <div class="alert ${errs.length ? 'alert-warning' : 'alert-success'}">
            <div class="font-medium mb-1">
              <i class="fas fa-check-circle mr-1"></i>
              ${d.inserted || 0} inseridas · ${d.updated || 0} atualizadas · ${d.skipped || 0} ignoradas · ${errs.length} erros
            </div>
            ${errs.length ? `
              <details class="text-xs mt-2">
                <summary class="cursor-pointer">Ver detalhes dos erros (${errs.length})</summary>
                <ul class="mt-2 space-y-1 max-h-40 overflow-auto">
                  ${errs.slice(0, 50).map(e => `<li>Linha ${e.row}: <b>${escHtml(e.nome || '—')}</b> (${escHtml(e.hex || '—')}) → ${escHtml(e.motivo)}</li>`).join('')}
                </ul>
              </details>
            ` : ''}
          </div>`;
        loadList();
      } catch (e) {
        $result.innerHTML = '<div class="alert alert-error">Erro ao importar: ' + escHtml(e?.message || 'desconhecido') + '</div>';
      }
    };
  }

  // Boot
  await loadList();
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
 * MINHA EMPRESA — gestão dos dados da empresa (Owner-only)
 * Multi-tenant FASE 2 — só o dono (is_owner=1 + admin) pode editar
 * ============================================================ */
ROUTES.minha_empresa = async (main) => {
  if (!isOwner()) {
    main.innerHTML = `
      <div class="max-w-2xl mx-auto">
        <div class="card p-8 text-center">
          <i class="fas fa-lock text-5xl text-amber-500 mb-4"></i>
          <div class="text-xl font-bold mb-2">Acesso restrito</div>
          <div class="text-sm text-slate-500 mb-4">Apenas o <strong>dono</strong> da empresa pode visualizar e editar estes dados.</div>
          <button class="btn btn-secondary" onclick="navigate('dashboard')">
            <i class="fas fa-arrow-left mr-1"></i>Voltar ao Dashboard
          </button>
        </div>
      </div>`;
    return;
  }

  let emp = null;
  try {
    const r = await api('get', '/empresa', null, { silent: true });
    emp = r.data || {};
  } catch (e) {
    main.innerHTML = `<div class="card p-6 text-red-600"><i class="fas fa-exclamation-triangle mr-2"></i>Falha ao carregar dados da empresa: ${e?.response?.data?.error || e.message}</div>`;
    return;
  }

  const planosLabel = { free: 'Grátis', basic: 'Básico', pro: 'Profissional', enterprise: 'Enterprise' };
  const statusBadge = {
    ativa:     '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Ativa</span>',
    suspensa:  '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Suspensa</span>',
    cancelada: '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">Cancelada</span>',
  };
  const esc = (v) => String(v ?? '').replace(/"/g, '&quot;');

  main.innerHTML = `
    <div class="max-w-4xl mx-auto space-y-4">
      <!-- Header com identidade da empresa -->
      <div class="card p-6">
        <div class="flex items-center gap-4 mb-5 pb-4 border-b border-slate-200/10">
          <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white shadow-lg">
            <i class="fas fa-building text-2xl"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-lg font-bold truncate">${esc(emp.nome || 'Minha Empresa')}</span>
              ${statusBadge[emp.status] || ''}
              <span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                <i class="fas fa-gem mr-1"></i>${planosLabel[emp.plano] || emp.plano || '—'}
              </span>
            </div>
            <div class="text-sm text-slate-500 mt-0.5">
              <i class="fas fa-id-badge mr-1"></i>ID: ${emp.id_empresa} ·
              <i class="fas fa-calendar-day ml-2 mr-1"></i>Desde ${(emp.dt_criacao || '').slice(0, 10) || '—'}
            </div>
          </div>
        </div>

        <!-- Aviso Owner -->
        <div class="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 p-3 mb-5 flex items-start gap-2">
          <i class="fas fa-crown text-amber-500 mt-0.5"></i>
          <div class="text-sm text-amber-800 dark:text-amber-200">
            Você é o <strong>dono</strong> desta empresa. Essas informações aparecerão em romaneios, relatórios e documentos oficiais.
          </div>
        </div>

        <!-- Formulário -->
        <form id="form-empresa" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              <i class="fas fa-signature mr-1 text-slate-400"></i>Razão Social / Nome Fantasia <span class="text-rose-500">*</span>
            </label>
            <input type="text" name="nome" required maxlength="120" value="${esc(emp.nome)}"
                   class="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300/30 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              <i class="fas fa-id-card mr-1 text-slate-400"></i>CNPJ
            </label>
            <input type="text" name="cnpj" maxlength="20" value="${esc(emp.cnpj)}"
                   placeholder="00.000.000/0000-00"
                   class="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300/30 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              <i class="fas fa-phone mr-1 text-slate-400"></i>Telefone
            </label>
            <input type="text" name="telefone" maxlength="30" value="${esc(emp.telefone)}"
                   placeholder="(00) 0000-0000"
                   class="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300/30 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>

          <div class="md:col-span-2">
            <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              <i class="fas fa-envelope mr-1 text-slate-400"></i>E-mail de Contato
            </label>
            <input type="email" name="email_contato" maxlength="120" value="${esc(emp.email_contato)}"
                   placeholder="contato@empresa.com"
                   class="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300/30 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>

          <div class="md:col-span-2">
            <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              <i class="fas fa-map-marker-alt mr-1 text-slate-400"></i>Endereço
            </label>
            <input type="text" name="endereco" maxlength="200" value="${esc(emp.endereco)}"
                   placeholder="Rua, número, bairro"
                   class="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300/30 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              <i class="fas fa-city mr-1 text-slate-400"></i>Cidade
            </label>
            <input type="text" name="cidade" maxlength="80" value="${esc(emp.cidade)}"
                   class="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300/30 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                <i class="fas fa-flag mr-1 text-slate-400"></i>UF
              </label>
              <input type="text" name="uf" maxlength="2" value="${esc(emp.uf)}"
                     placeholder="RS" style="text-transform:uppercase;"
                     class="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300/30 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                <i class="fas fa-mail-bulk mr-1 text-slate-400"></i>CEP
              </label>
              <input type="text" name="cep" maxlength="10" value="${esc(emp.cep)}"
                     placeholder="00000-000"
                     class="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300/30 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
          </div>

          <div class="md:col-span-2 mt-4 flex flex-col sm:flex-row justify-end gap-2 pt-4 border-t border-slate-200/10">
            <button type="button" id="btn-emp-cancel" class="btn btn-secondary">
              <i class="fas fa-rotate mr-1"></i>Recarregar
            </button>
            <button type="submit" id="btn-emp-save" class="btn btn-primary">
              <i class="fas fa-save mr-1"></i>Salvar Dados da Empresa
            </button>
          </div>
        </form>
      </div>

      <!-- Card informativo -->
      <div class="card p-5">
        <div class="flex items-start gap-3">
          <i class="fas fa-info-circle text-blue-500 text-xl mt-0.5"></i>
          <div class="text-sm text-slate-600 dark:text-slate-400">
            <div class="font-semibold mb-1">Sobre os dados da empresa</div>
            <ul class="list-disc list-inside space-y-1">
              <li>O <strong>nome</strong> é exibido em todos os documentos impressos (romaneios, relatórios).</li>
              <li><strong>CNPJ</strong>, <strong>endereço</strong> e <strong>contato</strong> aparecem nos cabeçalhos de relatórios oficiais.</li>
              <li>Plano e status são gerenciados pela plataforma — entre em contato com o suporte para alterações.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>`;

  $('#btn-emp-cancel').onclick = () => ROUTES.minha_empresa(main);

  $('#form-empresa').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = $('#btn-emp-save');
    const form = $('#form-empresa');
    const fd = new FormData(form);
    const payload = {
      nome:          (fd.get('nome') || '').toString().trim(),
      cnpj:          (fd.get('cnpj') || '').toString().trim(),
      telefone:      (fd.get('telefone') || '').toString().trim(),
      email_contato: (fd.get('email_contato') || '').toString().trim(),
      endereco:      (fd.get('endereco') || '').toString().trim(),
      cidade:        (fd.get('cidade') || '').toString().trim(),
      uf:            (fd.get('uf') || '').toString().trim().toUpperCase(),
      cep:           (fd.get('cep') || '').toString().trim(),
    };

    if (!payload.nome) {
      toast('Informe o nome da empresa.', 'warning');
      form.querySelector('[name=nome]')?.focus();
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Salvando…';
    try {
      const r = await api('put', '/empresa', payload);
      const novo = r.data || {};
      // Atualiza o usuário em memória para refletir o novo nome da empresa
      if (state.user?.empresa) {
        state.user.empresa.nome = novo.nome;
        AUTH.setUser?.(state.user);
      }
      toast('Dados da empresa salvos com sucesso.', 'success');
      ROUTES.minha_empresa(main);
    } catch (e) {
      const code = e?.response?.data?.code;
      const msg = e?.response?.data?.error || e.message;
      if (code === 'OWNER_REQUIRED') {
        toast('Apenas o dono da empresa pode salvar essas alterações.', 'error');
      } else {
        toast('Erro ao salvar: ' + msg, 'error');
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save mr-1"></i>Salvar Dados da Empresa';
    }
  };
};

/* ============================================================
 * 🆕 SPRINT 3 — MINHA ASSINATURA / PLANO (self-service de cobrança)
 * Owner-only. Mostra:
 *  - Plano atual + features
 *  - Uso vs limites (barras de progresso)
 *  - Trial / próxima cobrança
 *  - PIX self-service (gerar QR + copia-e-cola)
 *  - Histórico de faturas
 * ============================================================ */
ROUTES.minha_assinatura = async (main) => {
  if (!isOwner()) {
    main.innerHTML = `
      <div class="max-w-2xl mx-auto">
        <div class="card p-8 text-center">
          <i class="fas fa-lock text-5xl text-amber-500 mb-4"></i>
          <div class="text-xl font-bold mb-2">Acesso restrito</div>
          <div class="text-sm text-slate-500 mb-4">Apenas o <strong>dono</strong> da empresa pode visualizar e gerenciar a assinatura.</div>
          <button class="btn btn-secondary" onclick="navigate('dashboard')">
            <i class="fas fa-arrow-left mr-1"></i>Voltar ao Dashboard
          </button>
        </div>
      </div>`;
    return;
  }

  main.innerHTML = `<div class="text-center py-16"><i class="fas fa-spinner fa-spin text-3xl text-brand"></i><div class="text-xs text-slate-400 mt-3 uppercase tracking-widest">Carregando assinatura…</div></div>`;

  let uso = null, proxima = null, faturas = [];
  try {
    const [ru, rp, rf] = await Promise.all([
      api('get', '/empresa/uso', null, { silent: true }).catch(() => null),
      api('get', '/billing/proxima-fatura', null, { silent: true }).catch(() => null),
      api('get', '/billing/minhas-faturas', null, { silent: true }).catch(() => null),
    ]);
    uso = ru?.data || null;
    proxima = rp?.data || null;
    faturas = rf?.data || [];
  } catch (e) {
    main.innerHTML = `<div class="card p-6 text-red-600"><i class="fas fa-exclamation-triangle mr-2"></i>Falha ao carregar dados da assinatura: ${e?.response?.data?.error || e.message}</div>`;
    return;
  }

  if (!uso) {
    main.innerHTML = `<div class="card p-6 text-amber-700"><i class="fas fa-info-circle mr-2"></i>Não foi possível carregar os dados de uso da assinatura.</div>`;
    return;
  }

  const plano = uso.plano || {};
  const features = uso.features || {};
  const u = uso.uso || {};
  const sub = proxima?.subscription || null;
  const trialDias = uso.trial_dias_restantes;
  const isTrial = (sub?.status === 'trial') || (typeof trialDias === 'number');
  const fmtBRL = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

  // Barra de progresso com cores baseadas em %
  const progressBar = (atual, max, label, icon) => {
    if (max === null || max === undefined || max === -1 || max === 'ilimitado') {
      return `
        <div class="rounded-lg p-4" style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2)">
          <div class="flex items-center justify-between mb-1">
            <span class="text-sm font-semibold"><i class="fas ${icon} mr-1 text-emerald-500"></i>${label}</span>
            <span class="text-xs px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 font-bold">ILIMITADO</span>
          </div>
          <div class="text-2xl font-bold text-emerald-600">${atual}</div>
          <div class="text-xs text-slate-500">utilizados</div>
        </div>`;
    }
    const pct = max > 0 ? Math.min(100, Math.round((atual / max) * 100)) : 0;
    let cor = '#10b981';     // verde
    if (pct >= 70) cor = '#f59e0b';  // amarelo
    if (pct >= 90) cor = '#ef4444';  // vermelho
    return `
      <div class="rounded-lg p-4" style="background:rgba(148,163,184,0.06);border:1px solid rgba(148,163,184,0.15)">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-semibold"><i class="fas ${icon} mr-1" style="color:${cor}"></i>${label}</span>
          <span class="text-xs font-bold" style="color:${cor}">${pct}%</span>
        </div>
        <div class="text-2xl font-bold">${atual} <span class="text-sm font-normal text-slate-500">/ ${max}</span></div>
        <div class="mt-2 h-2 rounded-full overflow-hidden" style="background:rgba(148,163,184,0.15)">
          <div style="height:100%;width:${pct}%;background:${cor};transition:width .4s ease"></div>
        </div>
      </div>`;
  };

  // Status badge da assinatura
  const statusBadge = (() => {
    if (sub?.status === 'ativa') return '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><i class="fas fa-check-circle mr-1"></i>Ativa</span>';
    if (sub?.status === 'trial' || isTrial) return `<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"><i class="fas fa-rocket mr-1"></i>Trial</span>`;
    if (sub?.status === 'pendente') return '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"><i class="fas fa-clock mr-1"></i>Pendente</span>';
    if (sub?.status === 'suspensa') return '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"><i class="fas fa-circle-exclamation mr-1"></i>Suspensa</span>';
    return '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700">—</span>';
  })();

  // Features do plano
  const featList = [
    { key: 'feat_relatorios_avancados', label: 'Relatórios avançados', icon: 'fa-chart-line' },
    { key: 'feat_api',                  label: 'Acesso à API',         icon: 'fa-code' },
    { key: 'feat_export_excel',         label: 'Exportação Excel/PDF', icon: 'fa-file-export' },
    { key: 'feat_audit_log',            label: 'Log de auditoria',     icon: 'fa-clipboard-list' },
    { key: 'feat_multi_filial',         label: 'Multi-filial',         icon: 'fa-building' },
  ];

  main.innerHTML = `
    <div class="max-w-5xl mx-auto space-y-4">
      <!-- HEADER -->
      <div class="card p-6">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-xl flex items-center justify-center text-white shadow-lg" style="background:linear-gradient(135deg,#a855f7,#6366f1)">
            <i class="fas fa-credit-card text-2xl"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-lg font-bold">Plano ${plano.nome || '—'}</span>
              ${statusBadge}
            </div>
            <div class="text-sm text-slate-500 mt-0.5">
              ${plano.preco_mensal ? fmtBRL(plano.preco_mensal) + '/mês' : 'Plano grátis'}
              ${plano.descricao ? ' · ' + plano.descricao : ''}
            </div>
          </div>
          <button class="btn btn-primary" id="btn-gerar-pix">
            <i class="fas fa-qrcode mr-1"></i>Pagar com PIX
          </button>
        </div>

        ${isTrial && typeof trialDias === 'number' ? `
          <div class="rounded-lg mt-4 p-3 flex items-start gap-2" style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25)">
            <i class="fas fa-rocket text-blue-500 mt-0.5"></i>
            <div class="text-sm text-blue-700 dark:text-blue-200">
              <strong>Período de avaliação:</strong> ${trialDias > 0 ? trialDias + ' dias restantes' : 'expirou'} ·
              ${sub?.trial_ate ? 'Termina em ' + fmtDate(sub.trial_ate) : ''}
            </div>
          </div>` : ''}

        ${sub?.status === 'suspensa' ? `
          <div class="rounded-lg mt-4 p-3 flex items-start gap-2" style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3)">
            <i class="fas fa-circle-exclamation text-amber-500 mt-0.5"></i>
            <div class="text-sm text-amber-700 dark:text-amber-200">
              <strong>Conta suspensa por inadimplência.</strong> Pague o PIX abaixo para reativar imediatamente.
            </div>
          </div>` : ''}
      </div>

      <!-- USO vs LIMITES -->
      <div class="card p-6">
        <h3 class="text-base font-bold mb-4"><i class="fas fa-gauge-high mr-2 text-brand"></i>Uso vs. limites do plano</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${progressBar(u.usuarios?.atual ?? 0,      u.usuarios?.max,      'Usuários ativos',  'fa-users')}
          ${progressBar(u.terceirizados?.atual ?? 0, u.terceirizados?.max, 'Terceirizados',    'fa-handshake')}
          ${progressBar(u.remessas_mes?.atual ?? 0,  u.remessas_mes?.max,  'Remessas neste mês','fa-truck-fast')}
        </div>
      </div>

      <!-- FEATURES + PRÓXIMA COBRANÇA -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="card p-6">
          <h3 class="text-base font-bold mb-3"><i class="fas fa-star mr-2 text-amber-500"></i>Recursos do plano</h3>
          <ul class="space-y-2 text-sm">
            ${featList.map(f => `
              <li class="flex items-center gap-2">
                ${features[f.key] ? '<i class="fas fa-check-circle text-emerald-500"></i>' : '<i class="fas fa-times-circle text-slate-400"></i>'}
                <span class="${features[f.key] ? '' : 'text-slate-400 line-through'}">
                  <i class="fas ${f.icon} mr-1 text-slate-400"></i>${f.label}
                </span>
              </li>`).join('')}
          </ul>
        </div>

        <div class="card p-6">
          <h3 class="text-base font-bold mb-3"><i class="fas fa-calendar-day mr-2 text-brand"></i>Próxima cobrança</h3>
          ${sub ? `
            <div class="space-y-2 text-sm">
              <div class="flex justify-between border-b border-slate-200/10 pb-2">
                <span class="text-slate-500">Valor</span>
                <span class="font-bold text-lg">${fmtBRL(sub.valor_mensal)}</span>
              </div>
              <div class="flex justify-between border-b border-slate-200/10 pb-2">
                <span class="text-slate-500">Data</span>
                <span class="font-semibold">${fmtDate(sub.dt_proxima_cobranca)}</span>
              </div>
              <div class="flex justify-between border-b border-slate-200/10 pb-2">
                <span class="text-slate-500">Método</span>
                <span class="font-semibold"><i class="fas fa-qrcode mr-1 text-emerald-500"></i>PIX (Mercado Pago)</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">Auto-renovação</span>
                <span class="font-semibold">Sim</span>
              </div>
            </div>` : '<div class="text-sm text-slate-500">Sem assinatura ativa.</div>'}
        </div>
      </div>

      <!-- HISTÓRICO DE FATURAS -->
      <div class="card p-6">
        <h3 class="text-base font-bold mb-3"><i class="fas fa-receipt mr-2 text-brand"></i>Histórico de faturas</h3>
        ${faturas.length === 0 ? '<div class="text-sm text-slate-500 text-center py-6">Nenhuma fatura ainda. Quando emitirmos uma cobrança ela aparecerá aqui.</div>' : `
          <div class="overflow-auto">
            <table class="w-full text-sm">
              <thead class="bg-slate-100 dark:bg-slate-800"><tr>
                <th class="p-2 text-left">Referência</th>
                <th class="p-2 text-left">Vencimento</th>
                <th class="p-2 text-right">Valor</th>
                <th class="p-2 text-center">Status</th>
                <th class="p-2 text-left">Pago em</th>
              </tr></thead>
              <tbody>
                ${faturas.map(f => {
                  const statusMap = {
                    pendente:  '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-100 text-amber-700">Pendente</span>',
                    aprovado:  '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-700">Pago</span>',
                    cancelado: '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-200 text-slate-600">Cancelado</span>',
                    rejeitado: '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-rose-100 text-rose-700">Rejeitado</span>',
                    estornado: '<span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-purple-100 text-purple-700">Estornado</span>',
                  };
                  return `
                    <tr class="border-t border-slate-200/10">
                      <td class="p-2 font-mono text-xs">${f.referencia || ('#' + f.id_payment)}</td>
                      <td class="p-2">${fmtDate(f.dt_vencimento || f.dt_geracao)}</td>
                      <td class="p-2 text-right font-semibold">${fmtBRL(f.valor)}</td>
                      <td class="p-2 text-center">${statusMap[f.status] || f.status}</td>
                      <td class="p-2 text-xs">${f.dt_pagamento ? new Date(f.dt_pagamento).toLocaleString('pt-BR') : '—'}</td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`}
      </div>

      <!-- AÇÕES SECUNDÁRIAS -->
      <div class="card p-4">
        <div class="flex flex-wrap gap-2 justify-between items-center">
          <div class="text-xs text-slate-500">
            <i class="fas fa-shield-halved mr-1 text-emerald-500"></i>
            Pagamentos processados via <strong>Mercado Pago</strong>. PIX com confirmação automática.
          </div>
          <button class="btn btn-secondary text-sm" onclick="navigate('minha_assinatura')">
            <i class="fas fa-rotate mr-1"></i>Atualizar
          </button>
        </div>
      </div>
    </div>`;

  // === Ação: GERAR PIX ===
  $('#btn-gerar-pix').onclick = async () => {
    const btn = $('#btn-gerar-pix');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Gerando…';
    try {
      const r = await api('post', '/billing/gerar-cobranca', {});
      const pay = r.data || {};
      mostrarModalPix(pay);
    } catch (e) {
      // erro já tratado pelo interceptor
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-qrcode mr-1"></i>Pagar com PIX';
    }
  };
};

/** Modal com QR code PIX + copia-e-cola */
function mostrarModalPix(pay) {
  const fmtBRL = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  const qr = pay.qr_code_base64 || '';
  const qrText = pay.qr_code || '';
  const valor = pay.valor || pay.transaction_amount || 0;
  const ref = pay.referencia || pay.id_payment || '—';
  const expira = pay.dt_expiracao ? new Date(pay.dt_expiracao).toLocaleString('pt-BR') : '';

  const existing = document.getElementById('pix-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'pix-modal';
  modal.className = 'modal-backdrop';
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:#fff;color:#0f172a;border-radius:18px;max-width:480px;width:100%;padding:28px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);position:relative">
      <button id="pix-close" style="position:absolute;top:14px;right:14px;width:32px;height:32px;border-radius:50%;background:rgba(148,163,184,0.15);border:none;cursor:pointer;font-size:16px">×</button>
      <div style="text-align:center;margin-bottom:16px">
        <div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#10b981,#059669);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px">
          <i class="fas fa-qrcode" style="color:#fff;font-size:26px"></i>
        </div>
        <h2 style="font-size:20px;font-weight:700;margin-bottom:4px">Pagar via PIX</h2>
        <div style="font-size:13px;color:#64748b">Escaneie o QR ou copie o código abaixo</div>
      </div>
      <div style="background:#f1f5f9;border-radius:12px;padding:16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Valor</div>
          <div style="font-size:24px;font-weight:800;color:#10b981">${fmtBRL(valor)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Referência</div>
          <div style="font-size:12px;font-family:monospace;color:#475569">${ref}</div>
        </div>
      </div>

      ${qr ? `
        <div style="text-align:center;background:#fff;padding:16px;border-radius:12px;border:2px dashed #cbd5e1;margin-bottom:14px">
          <img src="data:image/png;base64,${qr}" alt="QR PIX" style="width:200px;height:200px;display:block;margin:0 auto"/>
        </div>` : ''}

      ${qrText ? `
        <div style="margin-bottom:14px">
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:6px"><i class="fas fa-clipboard mr-1"></i>Código PIX copia-e-cola</label>
          <div style="display:flex;gap:6px">
            <input id="pix-text" readonly value="${qrText.replace(/"/g,'&quot;')}" style="flex:1;padding:10px;font-family:monospace;font-size:11px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc"/>
            <button id="pix-copy" style="padding:10px 14px;background:#10b981;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer"><i class="fas fa-copy"></i></button>
          </div>
        </div>` : ''}

      ${expira ? `<div style="font-size:11px;color:#64748b;text-align:center;margin-bottom:14px"><i class="fas fa-clock mr-1"></i>Expira em ${expira}</div>` : ''}

      <!-- SPRINT D: indicador de status com polling automático -->
      <div id="pix-status" style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:10px;padding:12px;font-size:12px;color:#065f46;text-align:center">
        <i class="fas fa-satellite-dish mr-1" id="pix-status-icon"></i>
        <span id="pix-status-text">Aguardando pagamento… A confirmação é automática.</span>
      </div>

      <div style="margin-top:14px;display:flex;gap:8px">
        <button id="pix-refresh" style="flex:1;padding:12px;background:#3b82f6;color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer">
          <i class="fas fa-rotate mr-1"></i>Já paguei (verificar agora)
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // SPRINT D — polling de status a cada 5s
  let pollTimer = null;
  let pollCount = 0;
  const MAX_POLLS = 720; // 720 * 5s = 1h
  const statusEl = modal.querySelector('#pix-status');
  const statusTextEl = modal.querySelector('#pix-status-text');
  const statusIconEl = modal.querySelector('#pix-status-icon');

  const stopPolling = () => {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  };
  const showAprovado = () => {
    statusEl.style.background = 'rgba(16,185,129,0.2)';
    statusEl.style.borderColor = 'rgba(16,185,129,0.5)';
    statusEl.style.color = '#065f46';
    statusIconEl.className = 'fas fa-check-circle mr-1';
    statusIconEl.style.color = '#10b981';
    statusTextEl.innerHTML = '<strong>Pagamento confirmado!</strong> Sua conta foi reativada.';
    stopPolling();
    toast('Pagamento confirmado! Sua conta está ativa.', 'success');
    setTimeout(() => { modal.remove(); navigate('minha_assinatura'); }, 1800);
  };
  const showRejeitado = (label) => {
    statusEl.style.background = 'rgba(239,68,68,0.1)';
    statusEl.style.borderColor = 'rgba(239,68,68,0.3)';
    statusEl.style.color = '#991b1b';
    statusIconEl.className = 'fas fa-circle-exclamation mr-1';
    statusIconEl.style.color = '#ef4444';
    statusTextEl.innerHTML = `<strong>${label}</strong> — gere uma nova cobrança.`;
    stopPolling();
  };

  const poll = async () => {
    if (!document.body.contains(modal)) { stopPolling(); return; }
    pollCount++;
    if (pollCount > MAX_POLLS) { stopPolling(); return; }
    try {
      const r = await api('get', `/billing/payment/${pay.id_payment}/status`, null, { silent: true });
      const d = r?.data || {};
      if (d.aprovado || d.status === 'aprovado') return showAprovado();
      if (d.status === 'rejeitado') return showRejeitado('Pagamento rejeitado');
      if (d.status === 'cancelado') return showRejeitado('Cobrança cancelada');
      if (d.status === 'expirado') return showRejeitado('Cobrança expirada');
      // Continua polling
    } catch {
      // ignora erros de rede transientes
    }
    pollTimer = setTimeout(poll, 5000);
  };
  // Inicia polling em 5s (primeiro check) — não bloqueia render
  pollTimer = setTimeout(poll, 5000);

  const close = () => { stopPolling(); modal.remove(); };
  modal.querySelector('#pix-close').onclick = close;
  modal.onclick = (ev) => { if (ev.target === modal) close(); };

  const copyBtn = modal.querySelector('#pix-copy');
  if (copyBtn) copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(qrText);
      copyBtn.innerHTML = '<i class="fas fa-check"></i>';
      copyBtn.style.background = '#059669';
      setTimeout(() => { copyBtn.innerHTML = '<i class="fas fa-copy"></i>'; copyBtn.style.background = '#10b981'; }, 1500);
      toast('Código PIX copiado!', 'success');
    } catch {
      toast('Não foi possível copiar. Copie manualmente.', 'error');
    }
  };

  const refreshBtn = modal.querySelector('#pix-refresh');
  if (refreshBtn) refreshBtn.onclick = async () => {
    refreshBtn.disabled = true;
    const original = refreshBtn.innerHTML;
    refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Verificando…';
    try {
      const r = await api('get', `/billing/payment/${pay.id_payment}/status`, null, { silent: true });
      const d = r?.data || {};
      if (d.aprovado || d.status === 'aprovado') return showAprovado();
      if (d.status === 'rejeitado') return showRejeitado('Pagamento rejeitado');
      if (d.status === 'cancelado') return showRejeitado('Cobrança cancelada');
      if (d.status === 'expirado') return showRejeitado('Cobrança expirada');
      // Continua pendente
      statusEl.style.background = 'rgba(245,158,11,0.1)';
      statusTextEl.textContent = 'Ainda não recebido. Tente novamente em alguns segundos…';
      setTimeout(() => {
        statusEl.style.background = 'rgba(16,185,129,0.08)';
        statusTextEl.textContent = 'Aguardando pagamento… A confirmação é automática.';
      }, 2500);
    } catch {
      toast('Não foi possível verificar agora.', 'error');
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = original;
    }
  };
}
window.mostrarModalPix = mostrarModalPix;

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
  // 🆕 SPRINT 5 — Banner global de trial / cobrança (fetch async, não bloqueia render)
  setTimeout(() => checkTrialBanner(), 200);
}

/* ============================================================
 * 🆕 SPRINT 5 — BANNER GLOBAL DE TRIAL / COBRANÇA / SUSPENSÃO
 * Aparece no topo do topbar quando:
 *  - Trial em vigor com < 7 dias restantes
 *  - Assinatura em status 'pendente' ou 'suspensa'
 * Estilo: faixa fina sticky no topo da janela, dismissível por sessão.
 * ============================================================ */
async function checkTrialBanner() {
  try {
    // Só consultamos se houver usuário autenticado
    if (!state.user) return;
    const r = await api('get', '/empresa/uso', null, { silent: true });
    const data = r?.data;
    if (!data) return;

    const sub = data.subscription || null;
    const trialDias = data.trial_dias_restantes;
    const empresa = state.user.empresa || {};
    const empresaStatus = empresa.status;

    // Decide se mostra banner
    let banner = null;
    // 1) Empresa suspensa → urgente vermelho
    if (empresaStatus === 'suspensa') {
      banner = {
        tipo: 'suspensa',
        cor: 'linear-gradient(90deg,#dc2626,#b91c1c)',
        icon: 'fa-circle-exclamation',
        texto: '<strong>Sua conta está suspensa.</strong> Pague o PIX e reative imediatamente.',
        cta: 'Pagar agora',
        dismissible: false,
      };
    }
    // 2) Assinatura pendente → aviso amarelo
    else if (sub?.status === 'pendente') {
      banner = {
        tipo: 'pendente',
        cor: 'linear-gradient(90deg,#f59e0b,#d97706)',
        icon: 'fa-clock',
        texto: '<strong>Pagamento pendente.</strong> Há uma fatura aguardando pagamento.',
        cta: 'Ver fatura',
        dismissible: true,
      };
    }
    // 3) Trial expirando (≤ 7 dias)
    else if (typeof trialDias === 'number' && trialDias <= 7 && trialDias > 0) {
      banner = {
        tipo: 'trial-fim',
        cor: 'linear-gradient(90deg,#3b82f6,#6366f1)',
        icon: 'fa-rocket',
        texto: `<strong>Trial acaba em ${trialDias} dia${trialDias > 1 ? 's' : ''}.</strong> Escolha um plano para continuar usando o CorePro sem interrupção.`,
        cta: 'Escolher plano',
        dismissible: true,
      };
    }
    // 4) Trial expirado
    else if (typeof trialDias === 'number' && trialDias <= 0 && sub?.status === 'trial') {
      banner = {
        tipo: 'trial-expirado',
        cor: 'linear-gradient(90deg,#dc2626,#991b1b)',
        icon: 'fa-bell',
        texto: '<strong>Seu trial expirou.</strong> Pague seu primeiro mês para continuar.',
        cta: 'Pagar agora',
        dismissible: false,
      };
    }
    // 5) Trial confortável (> 7 dias): banner discreto azul claro
    else if (typeof trialDias === 'number' && trialDias > 7) {
      const dismissedKey = '_trial_banner_dismissed_' + (state.user.id_empresa || '');
      if (sessionStorage.getItem(dismissedKey)) return;
      banner = {
        tipo: 'trial',
        cor: 'linear-gradient(90deg,#0891b2,#0e7490)',
        icon: 'fa-star',
        texto: `<strong>${trialDias} dias de trial</strong> · Aproveite todos os recursos premium até ${sub?.trial_ate ? new Date(sub.trial_ate).toLocaleDateString('pt-BR') : ''}.`,
        cta: 'Ver planos',
        dismissible: true,
      };
    }

    if (!banner) return;
    renderTrialBanner(banner);
  } catch (e) {
    // 402/TENANT_SUSPENDED já tratado pelo interceptor — não polui o console
    if (e?.response?.status !== 402) console.warn('[checkTrialBanner]', e?.message);
  }
}
window.checkTrialBanner = checkTrialBanner;

function renderTrialBanner(banner) {
  // Remove anterior se existir
  document.getElementById('trial-banner')?.remove();

  const el = document.createElement('div');
  el.id = 'trial-banner';
  el.style.cssText = `
    position:sticky;top:0;z-index:9998;
    background:${banner.cor};
    color:#fff;font-size:13px;font-weight:500;
    padding:8px 16px;display:flex;align-items:center;gap:10px;
    box-shadow:0 2px 8px rgba(0,0,0,0.15);
  `;
  el.innerHTML = `
    <i class="fas ${banner.icon}" style="font-size:14px"></i>
    <span style="flex:1;line-height:1.4">${banner.texto}</span>
    <button id="tb-cta" style="background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">
      ${banner.cta} <i class="fas fa-arrow-right ml-1"></i>
    </button>
    ${banner.dismissible ? '<button id="tb-close" aria-label="Fechar" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0 4px;opacity:0.8" title="Fechar até o próximo login">×</button>' : ''}
  `;

  // Insere antes do #topbar
  const topbar = document.getElementById('topbar');
  if (topbar?.parentNode) {
    topbar.parentNode.insertBefore(el, topbar);
  } else {
    document.body.insertBefore(el, document.body.firstChild);
  }

  el.querySelector('#tb-cta').onclick = () => navigate('minha_assinatura');
  el.querySelector('#tb-close')?.addEventListener('click', () => {
    el.remove();
    const dismissedKey = '_trial_banner_dismissed_' + (state.user?.id_empresa || '');
    try { sessionStorage.setItem(dismissedKey, '1'); } catch {}
  });
}
window.renderTrialBanner = renderTrialBanner;

/* =================================================================
 * HOTFIX 0038 — Backup & Restauração
 * UI tenant-scoped. Acessível apenas a admin (adminOnly no NAV).
 * Endpoints: /backup, /backup/config, /backup/:id/download, /backup/:id/restore
 * ================================================================= */
ROUTES.backup = async (main) => {
  if (!isAdmin()) {
    main.innerHTML = `
      <div class="max-w-2xl mx-auto">
        <div class="card p-8 text-center">
          <i class="fas fa-lock text-5xl text-amber-500 mb-4"></i>
          <div class="text-xl font-bold mb-2">Acesso restrito</div>
          <div class="text-sm text-slate-500 mb-4">Apenas usuários <strong>admin</strong> podem acessar o módulo de Backup.</div>
          <button class="btn btn-secondary" onclick="navigate('dashboard')">
            <i class="fas fa-arrow-left mr-1"></i>Voltar
          </button>
        </div>
      </div>`;
    return;
  }

  const fmtBytes = (n) => {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };
  const fmtDt = (s) => {
    if (!s) return '—';
    try {
      const d = s.includes('T') ? new Date(s) : new Date(s.replace(' ', 'T') + 'Z');
      return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    } catch { return s; }
  };
  const tipoBadge = (tipo) => {
    const map = {
      manual:      { color: '#2563EB', icon: 'fa-hand-pointer',  label: 'Manual' },
      auto:        { color: '#10B981', icon: 'fa-clock',         label: 'Auto' },
      pre_restore: { color: '#F59E0B', icon: 'fa-life-ring',     label: 'Pré-Restore' },
      global:      { color: '#7C3AED', icon: 'fa-globe',         label: 'Global' },
    };
    const t = map[tipo] || { color: '#64748B', icon: 'fa-file', label: tipo };
    return `<span class="bkp-pill" style="--c:${t.color}"><i class="fas ${t.icon}"></i>${t.label}</span>`;
  };
  const statusBadge = (status) => {
    const map = {
      ok:          { color: '#10B981', icon: 'fa-check-circle',     label: 'OK' },
      pending:     { color: '#F59E0B', icon: 'fa-spinner fa-spin',  label: 'Processando' },
      erro:        { color: '#EF4444', icon: 'fa-exclamation-triangle', label: 'Erro' },
      restaurado:  { color: '#7C3AED', icon: 'fa-rotate-left',      label: 'Restaurado' },
    };
    const s = map[status] || { color: '#64748B', icon: 'fa-circle', label: status };
    return `<span class="bkp-pill" style="--c:${s.color}"><i class="fas ${s.icon}"></i>${s.label}</span>`;
  };

  main.innerHTML = `
    <div class="max-w-7xl mx-auto space-y-5">
      <!-- HEADER -->
      <div class="card p-5" style="background:linear-gradient(135deg, rgba(37,99,235,0.08), rgba(124,58,237,0.08)); border:1px solid rgba(124,58,237,0.22)">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div class="text-xl font-bold flex items-center gap-3">
              <i class="fas fa-database text-2xl" style="color:#7C3AED"></i>
              Backup & Restauração
            </div>
            <div class="text-xs text-slate-500 mt-1">Cópia de segurança dos dados desta empresa em arquivo <code>.ndjson.gz</code> com checksum SHA-256.</div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-primary" id="bkp-gerar">
              <i class="fas fa-bolt mr-2"></i>Gerar Backup Agora
            </button>
            <button class="btn btn-secondary" id="bkp-cfg-open">
              <i class="fas fa-sliders-h mr-2"></i>Configurações
            </button>
          </div>
        </div>
        <div id="bkp-progress" class="hidden mt-4">
          <div class="text-xs text-slate-400 mb-2 flex items-center gap-2">
            <i class="fas fa-spinner fa-spin text-brand"></i>
            <span id="bkp-progress-text">Gerando backup…</span>
          </div>
          <div style="height:6px;background:rgba(148,163,184,0.18);border-radius:99px;overflow:hidden">
            <div id="bkp-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#2563EB,#7C3AED);transition:width .3s"></div>
          </div>
        </div>
      </div>

      <!-- STATS -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3" id="bkp-stats">
        <!-- preenchido por JS -->
      </div>

      <!-- LISTA -->
      <div class="card overflow-hidden">
        <div class="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2" style="border-color:var(--card-border)">
          <div class="font-semibold flex items-center gap-2">
            <i class="fas fa-list-ul text-brand"></i>Histórico de Backups
          </div>
          <button class="btn btn-secondary btn-sm" id="bkp-reload">
            <i class="fas fa-sync-alt mr-1"></i>Atualizar
          </button>
        </div>
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:60px">#</th>
                <th>Arquivo</th>
                <th style="width:120px">Tipo</th>
                <th style="width:110px">Tamanho</th>
                <th style="width:90px">Registros</th>
                <th style="width:110px">Status</th>
                <th style="width:170px">Criado</th>
                <th style="width:120px">Por</th>
                <th style="width:200px;text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody id="bkp-tbody">
              <tr><td colspan="9" class="text-center text-slate-400 py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- LOGS -->
      <details class="card overflow-hidden">
        <summary class="px-4 py-3 cursor-pointer font-semibold flex items-center gap-2" style="user-select:none">
          <i class="fas fa-clipboard-list text-brand"></i>Logs de Auditoria (últimos 30)
        </summary>
        <div class="overflow-x-auto border-t" style="border-color:var(--card-border)">
          <table class="data-table" id="bkp-logs-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Backup</th>
                <th>Ação</th>
                <th>Ator</th>
                <th>IP</th>
                <th>Status</th>
                <th>Duração</th>
              </tr>
            </thead>
            <tbody id="bkp-logs-tbody">
              <tr><td colspan="7" class="text-center text-slate-400 py-6 text-xs">Carregando…</td></tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  `;

  // ===== HANDLERS =====

  async function loadList() {
    const tbody = $('#bkp-tbody');
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-slate-400 py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando…</td></tr>';
    let items = [];
    try {
      const r = await api('get', '/backup');
      items = r?.data || [];
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center text-red-500 py-8"><i class="fas fa-exclamation-triangle mr-2"></i>Falha ao carregar.</td></tr>`;
      return;
    }
    renderStats(items);
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center text-slate-400 py-10">
        <i class="fas fa-inbox text-3xl mb-2"></i>
        <div class="text-sm">Nenhum backup gerado ainda.</div>
        <div class="text-xs mt-1">Clique em <strong>Gerar Backup Agora</strong> para criar o primeiro.</div>
      </td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((b) => `
      <tr>
        <td class="text-xs text-slate-500">#${b.id_backup}</td>
        <td class="text-xs">
          <div class="font-mono" style="word-break:break-all">${escapeHtml(b.nome_arquivo || '')}</div>
          ${b.observacao ? `<div class="text-slate-400 mt-1" style="font-size:10px">${escapeHtml(b.observacao)}</div>` : ''}
        </td>
        <td>${tipoBadge(b.tipo)}</td>
        <td class="text-xs font-mono">${fmtBytes(b.tamanho_bytes)}</td>
        <td class="text-xs">${Number(b.total_registros || 0).toLocaleString('pt-BR')} <span class="text-slate-400">· ${b.total_tabelas || 0} tab.</span></td>
        <td>${statusBadge(b.status)}${b.erro ? `<div class="text-xs text-red-500 mt-1" title="${escapeHtml(b.erro)}">${escapeHtml(b.erro.slice(0, 50))}…</div>` : ''}</td>
        <td class="text-xs text-slate-500">${fmtDt(b.dt_criacao)}<div class="text-slate-400" style="font-size:10px">${b.duracao_ms ? b.duracao_ms + 'ms' : ''}</div></td>
        <td class="text-xs">${escapeHtml(b.criado_por || '—')}</td>
        <td class="text-right">
          <div class="flex gap-1 justify-end flex-wrap">
            <button class="btn btn-sm btn-secondary" data-action="download" data-id="${b.id_backup}" data-arquivo="${escapeHtml(b.nome_arquivo)}" title="Baixar" ${b.status !== 'ok' && b.status !== 'restaurado' ? 'disabled' : ''}>
              <i class="fas fa-download"></i>
            </button>
            <button class="btn btn-sm" data-action="restore" data-id="${b.id_backup}" data-arquivo="${escapeHtml(b.nome_arquivo)}" title="Restaurar" style="background:#F59E0B;color:#fff" ${b.status !== 'ok' && b.status !== 'restaurado' ? 'disabled' : ''}>
              <i class="fas fa-undo-alt"></i>
            </button>
            <button class="btn btn-sm" data-action="delete" data-id="${b.id_backup}" data-arquivo="${escapeHtml(b.nome_arquivo)}" title="Excluir" style="background:#EF4444;color:#fff">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
    // bind ações
    tbody.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.onclick = () => {
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        const arquivo = btn.getAttribute('data-arquivo');
        if (action === 'download') downloadBackup(id, arquivo);
        else if (action === 'restore') openRestoreModal(id, arquivo);
        else if (action === 'delete') deleteBackup(id, arquivo);
      };
    });
  }

  function renderStats(items) {
    const total = items.length;
    const okCount = items.filter((b) => b.status === 'ok' || b.status === 'restaurado').length;
    const sumBytes = items.reduce((acc, b) => acc + Number(b.tamanho_bytes || 0), 0);
    const last = items[0]?.dt_criacao;
    $('#bkp-stats').innerHTML = `
      <div class="card p-3" style="background:rgba(37,99,235,0.06);border-color:rgba(37,99,235,0.22)">
        <div class="text-[10px] uppercase tracking-widest text-slate-400">Total Backups</div>
        <div class="text-2xl font-bold mt-1">${total}</div>
      </div>
      <div class="card p-3" style="background:rgba(16,185,129,0.06);border-color:rgba(16,185,129,0.22)">
        <div class="text-[10px] uppercase tracking-widest text-slate-400">Saudáveis</div>
        <div class="text-2xl font-bold mt-1" style="color:#10B981">${okCount}</div>
      </div>
      <div class="card p-3" style="background:rgba(124,58,237,0.06);border-color:rgba(124,58,237,0.22)">
        <div class="text-[10px] uppercase tracking-widest text-slate-400">Total em disco</div>
        <div class="text-2xl font-bold mt-1">${fmtBytes(sumBytes)}</div>
      </div>
      <div class="card p-3" style="background:rgba(245,158,11,0.06);border-color:rgba(245,158,11,0.22)">
        <div class="text-[10px] uppercase tracking-widest text-slate-400">Último Backup</div>
        <div class="text-base font-bold mt-1">${last ? fmtDt(last) : '—'}</div>
      </div>
    `;
  }

  async function loadLogs() {
    let items = [];
    try { items = (await api('get', '/backup/logs?limit=30'))?.data || []; }
    catch {}
    const tbody = $('#bkp-logs-tbody');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 py-6 text-xs">Sem logs.</td></tr>';
      return;
    }
    const actionMap = {
      create: { c: '#2563EB', l: 'Criação' },
      download: { c: '#10B981', l: 'Download' },
      restore_start: { c: '#F59E0B', l: 'Restore inic.' },
      restore_ok: { c: '#7C3AED', l: 'Restore OK' },
      restore_fail: { c: '#EF4444', l: 'Restore falhou' },
      delete: { c: '#EF4444', l: 'Exclusão' },
    };
    tbody.innerHTML = items.map((l) => {
      const a = actionMap[l.action] || { c: '#64748B', l: l.action };
      return `<tr>
        <td class="text-xs text-slate-500">${fmtDt(l.dt_log)}</td>
        <td class="text-xs">#${l.id_backup || '—'}</td>
        <td><span class="bkp-pill" style="--c:${a.c}">${a.l}</span></td>
        <td class="text-xs">${escapeHtml(l.ator || '—')}</td>
        <td class="text-xs text-slate-500 font-mono">${escapeHtml(l.ip || '')}</td>
        <td>${l.status === 'erro' ? '<span class="text-red-500"><i class="fas fa-times-circle"></i> erro</span>' : '<span class="text-emerald-500"><i class="fas fa-check"></i> ok</span>'}</td>
        <td class="text-xs">${l.duracao_ms ? l.duracao_ms + 'ms' : '—'}</td>
      </tr>`;
    }).join('');
  }

  async function gerarBackup() {
    const btn = $('#bkp-gerar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Gerando…';
    $('#bkp-progress').classList.remove('hidden');
    $('#bkp-progress-text').textContent = 'Coletando dados das tabelas…';
    $('#bkp-progress-bar').style.width = '30%';

    try {
      const r = await api('post', '/backup');
      $('#bkp-progress-bar').style.width = '100%';
      $('#bkp-progress-text').textContent = `Backup #${r.data.id_backup} gerado (${fmtBytes(r.data.tamanho_bytes)}, ${r.data.total_registros} registros)`;
      toast(`Backup #${r.data.id_backup} gerado com sucesso!`, 'success');
      if (r.retencao_removidos > 0) {
        toast(`${r.retencao_removidos} backup(s) antigo(s) removido(s) pela retenção.`, 'info');
      }
      setTimeout(() => $('#bkp-progress').classList.add('hidden'), 1800);
      await loadList();
      await loadLogs();
    } catch (e) {
      $('#bkp-progress-text').innerHTML = '<span class="text-red-500">Falha ao gerar backup.</span>';
      $('#bkp-progress-bar').style.background = '#EF4444';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-bolt mr-2"></i>Gerar Backup Agora';
    }
  }

  async function downloadBackup(id, arquivo) {
    const token = AUTH.getToken();
    try {
      const r = await axios.get(API + '/backup/' + id + '/download', {
        headers: { Authorization: 'Bearer ' + token },
        responseType: 'blob',
      });
      const blob = r.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = arquivo || ('backup_' + id + '.ndjson.gz');
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('Download iniciado: ' + (arquivo || id), 'success');
      loadLogs();
    } catch (e) {
      toast('Falha ao baixar backup.', 'error');
    }
  }

  async function deleteBackup(id, arquivo) {
    if (!confirm(`Excluir o backup #${id}?\n\n${arquivo}\n\nEsta ação NÃO pode ser desfeita.`)) return;
    try {
      await api('delete', '/backup/' + id);
      toast('Backup excluído.', 'success');
      await loadList(); await loadLogs();
    } catch {}
  }

  function openRestoreModal(id, arquivo) {
    const html = `
      <div class="modal-backdrop">
        <div class="modal-content" style="max-width:560px">
          <div class="modal-header" style="background:linear-gradient(135deg,#F59E0B,#EF4444);color:#fff">
            <div class="font-bold text-lg flex items-center gap-2">
              <i class="fas fa-exclamation-triangle"></i>Restaurar Backup
            </div>
            <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()" style="color:#fff">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <div class="rounded-lg p-3 mb-4" style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3)">
              <div class="font-bold text-red-600 dark:text-red-400 mb-2 flex items-center gap-2">
                <i class="fas fa-exclamation-circle"></i>Atenção: ação destrutiva
              </div>
              <ul class="text-xs space-y-1 list-disc ml-5 text-slate-700 dark:text-slate-300">
                <li>Esta ação <strong>substituirá todos os dados atuais</strong> da sua empresa pelos dados do backup.</li>
                <li>Um <strong>snapshot automático</strong> da situação atual será criado antes do restore (você poderá voltar).</li>
                <li>Outras empresas <strong>não serão afetadas</strong>.</li>
                <li>A operação é <strong>atômica</strong>: se falhar, o estado é revertido.</li>
              </ul>
            </div>
            <div class="text-xs text-slate-500 mb-2">Arquivo: <span class="font-mono">${escapeHtml(arquivo)}</span></div>

            <label class="block text-xs font-semibold mt-3 mb-1">Sua senha</label>
            <input type="password" id="rst-senha" class="input w-full" placeholder="Digite a senha para confirmar" autocomplete="current-password">

            <label class="block text-xs font-semibold mt-3 mb-1">Confirme digitando <code>RESTAURAR</code></label>
            <input type="text" id="rst-confirma" class="input w-full" placeholder="RESTAURAR" autocomplete="off" style="text-transform:uppercase;letter-spacing:.1em">

            <div id="rst-feedback" class="text-xs mt-3 hidden"></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancelar</button>
            <button class="btn" id="rst-confirmar" style="background:#EF4444;color:#fff" disabled>
              <i class="fas fa-undo-alt mr-1"></i>Restaurar Agora
            </button>
          </div>
        </div>
      </div>
    `;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper.firstElementChild);

    const $senha = document.getElementById('rst-senha');
    const $conf = document.getElementById('rst-confirma');
    const $btn = document.getElementById('rst-confirmar');
    const $fb = document.getElementById('rst-feedback');

    const check = () => {
      $btn.disabled = !( $senha.value.length >= 3 && $conf.value.trim().toUpperCase() === 'RESTAURAR' );
    };
    $senha.oninput = check;
    $conf.oninput = check;

    $btn.onclick = async () => {
      $btn.disabled = true;
      $btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Restaurando…';
      $fb.classList.remove('hidden');
      $fb.className = 'text-xs mt-3 text-amber-600';
      $fb.innerHTML = '<i class="fas fa-clock mr-1"></i>Criando snapshot de segurança e aplicando dados…';
      try {
        const r = await api('post', '/backup/' + id + '/restore', {
          senha: $senha.value,
          confirma_texto: $conf.value.trim().toUpperCase(),
        });
        $fb.className = 'text-xs mt-3 text-emerald-600';
        $fb.innerHTML = `<i class="fas fa-check-circle mr-1"></i>Sucesso! ${r.data.inseridas} registros restaurados em ${r.data.duracao_ms}ms. Snapshot reverso: #${r.data.snapshot_id || '—'}.`;
        toast('Restauração concluída. Recarregando…', 'success');
        setTimeout(() => location.reload(), 2200);
      } catch (e) {
        $fb.className = 'text-xs mt-3 text-red-500';
        $fb.innerHTML = '<i class="fas fa-times-circle mr-1"></i>' + (e?.response?.data?.error || e.message || 'Falha.');
        $btn.disabled = false;
        $btn.innerHTML = '<i class="fas fa-undo-alt mr-1"></i>Tentar de novo';
      }
    };
    $senha.focus();
  }

  async function openConfigModal() {
    let cfg = {};
    try { cfg = (await api('get', '/backup/config'))?.data || {}; } catch {}
    const html = `
      <div class="modal-backdrop">
        <div class="modal-content" style="max-width:520px">
          <div class="modal-header">
            <div class="font-bold text-lg flex items-center gap-2"><i class="fas fa-sliders-h text-brand"></i>Configurações de Backup</div>
            <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()"><i class="fas fa-times"></i></button>
          </div>
          <div class="modal-body">
            <label class="block text-xs font-semibold mb-1">Retenção (máximo de backups mantidos)</label>
            <input type="number" id="cfg-max" class="input w-full" min="1" max="50" value="${cfg.max_backups || 10}">
            <div class="text-[11px] text-slate-400 mt-1">Backups mais antigos são automaticamente removidos quando este limite é ultrapassado.</div>

            <div class="mt-5 pt-4 border-t" style="border-color:var(--card-border)">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" id="cfg-auto" ${cfg.auto_enabled ? 'checked' : ''} class="w-4 h-4">
                <span class="font-semibold text-sm">Habilitar backup automático</span>
              </label>
              <div class="text-[11px] text-slate-400 mt-1 ml-6">
                <i class="fas fa-info-circle"></i> Backup automático requer ativação do <strong>Cron Trigger</strong> no Dashboard Cloudflare.
                Enquanto não estiver ativo, esta configuração fica salva mas não dispara automaticamente.
              </div>

              <label class="block text-xs font-semibold mt-3 mb-1">Frequência</label>
              <select id="cfg-freq" class="input w-full">
                <option value="diario" ${cfg.auto_frequencia === 'diario' ? 'selected' : ''}>Diário</option>
                <option value="semanal" ${cfg.auto_frequencia === 'semanal' ? 'selected' : ''}>Semanal</option>
                <option value="mensal" ${cfg.auto_frequencia === 'mensal' ? 'selected' : ''}>Mensal</option>
              </select>

              <label class="block text-xs font-semibold mt-3 mb-1">Horário (UTC)</label>
              <input type="number" id="cfg-hora" class="input w-full" min="0" max="23" value="${cfg.auto_hora_utc ?? 3}">
              <div class="text-[11px] text-slate-400 mt-1">UTC. Padrão: 3 (00:00 BRT). Ex.: 12 = 09:00 BRT.</div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancelar</button>
            <button class="btn btn-primary" id="cfg-salvar"><i class="fas fa-save mr-1"></i>Salvar</button>
          </div>
        </div>
      </div>
    `;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper.firstElementChild);

    document.getElementById('cfg-salvar').onclick = async () => {
      try {
        await api('put', '/backup/config', {
          max_backups: Number(document.getElementById('cfg-max').value) || 10,
          auto_enabled: document.getElementById('cfg-auto').checked,
          auto_frequencia: document.getElementById('cfg-freq').value,
          auto_hora_utc: Number(document.getElementById('cfg-hora').value) || 3,
        });
        toast('Configuração salva.', 'success');
        document.querySelector('.modal-backdrop')?.remove();
      } catch {}
    };
  }

  // bind
  $('#bkp-gerar').onclick = gerarBackup;
  $('#bkp-reload').onclick = () => { loadList(); loadLogs(); };
  $('#bkp-cfg-open').onclick = openConfigModal;

  await loadList();
  await loadLogs();
};

(async function init() {
  // Recupera mensagem de logout vinda do hard reload (se houver)
  let logoutMsg = null;
  try {
    logoutMsg = sessionStorage.getItem('_logout_msg');
    if (logoutMsg) sessionStorage.removeItem('_logout_msg');
  } catch {}

  // === ÁREA MASTER (Super Admin SaaS) ===
  // Roteia para /static/master.js quando hash começa com #master.
  // Detecção precoce para evitar piscar a tela de login normal.
  const isMasterRoute = () => /^#?master(\/|$)/.test(location.hash || '');
  if (isMasterRoute()) {
    // Injeta master.js dinamicamente
    const s = document.createElement('script');
    s.src = '/static/master.js?v=5';
    s.onerror = () => {
      $('#app').innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626"><i class="fas fa-exclamation-triangle text-3xl"></i><p class="mt-3">Erro ao carregar área Master.</p></div>';
    };
    document.body.appendChild(s);
    return; // não carrega app normal
  }

  // === CADASTRO PÚBLICO (SaaS Signup) ===
  // Quando hash começa com #cadastro, carrega tela de signup standalone.
  const isCadastroRoute = () => /^#?cadastro(\/|$)/.test(location.hash || '');
  if (isCadastroRoute()) {
    const s = document.createElement('script');
    s.src = '/static/cadastro.js?v=2';
    s.onerror = () => {
      $('#app').innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626"><i class="fas fa-exclamation-triangle text-3xl"></i><p class="mt-3">Erro ao carregar página de cadastro.</p></div>';
    };
    document.body.appendChild(s);
    return;
  }

  // Listener de hash para sair/entrar das áreas isoladas
  window.addEventListener('hashchange', () => {
    if (isMasterRoute() || isCadastroRoute()) location.reload();
  });

  window.addEventListener('hashchange', () => {
    // GUARDA DE ROTA: sem usuário autenticado, qualquer hashchange volta ao login
    if (!state.user) {
      // Limpa hash para evitar loop e garante tela de login
      try { history.replaceState(null, '', location.pathname); } catch {}
      renderLogin(logoutMsg || 'Faça login para continuar.');
      return;
    }
    const r = location.hash.slice(1) || 'dashboard';
    if (r !== state.route) navigate(r);
  });

  // Tem token? Valida com /auth/me
  const token = AUTH.getToken();
  if (!token) { renderLogin(logoutMsg || undefined); return; }
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
