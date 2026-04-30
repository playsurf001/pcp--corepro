/* ============================================================
 * CorePro — Core v1.0
 * - Theme manager (light/dark) com persistência e prefers-color-scheme
 * - Estado central reativo (Store)
 * - Helpers padronizados: saveData / loadData / deleteItem / updateUI
 * - Error boundary global e feedback visual unificado
 * - Persistência de filtros por rota
 * ============================================================ */
'use strict';

/* ============================================================
 * THEME MANAGER
 * ============================================================ */
const Theme = {
  KEY: 'corepro_theme',
  current: 'dark',

  /** Detecta tema preferido (localStorage > prefers-color-scheme > dark) */
  detect() {
    const saved = localStorage.getItem(this.KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    return 'dark';
  },

  /** Aplica o tema sem animação (uso no boot, evita flash) */
  applyImmediate(theme) {
    this.current = theme;
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#F8FAFC' : '#020617');
  },

  /** Aplica com transição suave */
  apply(theme) {
    document.documentElement.classList.add('theme-transition');
    this.applyImmediate(theme);
    localStorage.setItem(this.KEY, theme);
    setTimeout(() => document.documentElement.classList.remove('theme-transition'), 350);
    // Avisa listeners (charts, etc)
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  },

  /** Alterna entre light e dark */
  toggle() {
    const next = this.current === 'dark' ? 'light' : 'dark';
    this.apply(next);
    return next;
  },

  /** Inicializa (chamar o mais cedo possível) */
  init() {
    this.applyImmediate(this.detect());
    // Sincroniza se o usuário mudar a preferência do sistema (e não tiver overridden)
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      mq.addEventListener?.('change', (e) => {
        if (!localStorage.getItem(this.KEY)) {
          this.apply(e.matches ? 'light' : 'dark');
        }
      });
    }
  },

  /** HTML do botão toggle */
  toggleButtonHTML() {
    return `
      <button id="theme-toggle-btn" class="theme-toggle" type="button" title="Alternar tema (claro/escuro)" aria-label="Alternar tema">
        <i class="fas fa-sun icon-sun"></i>
        <i class="fas fa-moon icon-moon"></i>
      </button>
    `;
  },

  /** Conecta o botão toggle ao DOM */
  bindToggle(selector = '#theme-toggle-btn') {
    const btn = document.querySelector(selector);
    if (!btn) return;
    btn.addEventListener('click', () => this.toggle());
  },
};

// Inicialização imediata (anti-flash) — antes mesmo do app.js carregar dados
Theme.init();
window.Theme = Theme;

/* ============================================================
 * STORE — Estado central reativo simples
 * ============================================================ */
class Store {
  constructor(initial = {}) {
    this._state = { ...initial };
    this._listeners = new Map();
  }
  get(key) { return key ? this._state[key] : { ...this._state }; }
  set(patch) {
    const changed = [];
    for (const k in patch) {
      if (this._state[k] !== patch[k]) {
        this._state[k] = patch[k];
        changed.push(k);
      }
    }
    changed.forEach((k) => {
      const ls = this._listeners.get(k);
      if (ls) ls.forEach((fn) => { try { fn(this._state[k], this._state); } catch (e) { console.error('[Store]', k, e); } });
    });
    if (changed.length) {
      const all = this._listeners.get('*');
      if (all) all.forEach((fn) => { try { fn(this._state, changed); } catch (e) { console.error('[Store]', e); } });
    }
  }
  on(key, fn) {
    if (!this._listeners.has(key)) this._listeners.set(key, new Set());
    this._listeners.get(key).add(fn);
    return () => this._listeners.get(key)?.delete(fn);
  }
}

const AppStore = new Store({
  route: 'dashboard',
  user: null,
  loading: false,
  filters: {}, // { [routeId]: { campo: valor } }
  cache: {},
});
window.AppStore = AppStore;

/* ============================================================
 * FILTER PERSISTENCE — sobrevive a navegação e paginação
 * ============================================================ */
const FilterStore = {
  KEY: 'corepro_filters',
  _all: null,
  _load() {
    if (this._all) return this._all;
    try { this._all = JSON.parse(localStorage.getItem(this.KEY) || '{}'); }
    catch { this._all = {}; }
    return this._all;
  },
  _save() { try { localStorage.setItem(this.KEY, JSON.stringify(this._all || {})); } catch {} },
  get(scope) { return { ...(this._load()[scope] || {}) }; },
  set(scope, patch) {
    const all = this._load();
    all[scope] = { ...(all[scope] || {}), ...patch };
    this._save();
    AppStore.set({ filters: { ...AppStore.get('filters'), [scope]: all[scope] } });
  },
  reset(scope) {
    const all = this._load();
    delete all[scope];
    this._save();
  },
  /** Liga inputs de um formulário (DOM) ao FilterStore — auto-restore + auto-save */
  bind(scope, container = document) {
    const restored = this.get(scope);
    const inputs = container.querySelectorAll('[data-filter]');
    inputs.forEach((inp) => {
      const key = inp.dataset.filter;
      if (restored[key] !== undefined && restored[key] !== '') {
        if (inp.type === 'checkbox') inp.checked = !!restored[key];
        else inp.value = restored[key];
      }
      const handler = () => {
        const val = inp.type === 'checkbox' ? inp.checked : inp.value;
        this.set(scope, { [key]: val });
      };
      inp.addEventListener('change', handler);
      if (inp.tagName === 'INPUT' && (inp.type === 'text' || inp.type === 'search')) {
        inp.addEventListener('input', debounce(handler, 250));
      }
    });
  },
};
window.FilterStore = FilterStore;

/* ============================================================
 * UTILITIES
 * ============================================================ */
function debounce(fn, ms = 200) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

/** Mostra estado de loading num botão */
function setBtnLoading(btn, loading = true) {
  if (!btn) return;
  if (loading) {
    btn.classList.add('is-loading');
    btn.setAttribute('disabled', 'disabled');
    btn.dataset._originalHtml ??= btn.innerHTML;
  } else {
    btn.classList.remove('is-loading');
    btn.removeAttribute('disabled');
  }
}

/** Confirma com prompt nativo (substituível por modal customizado depois) */
function confirmAction(msg) { return window.confirm(msg); }

/* ============================================================
 * STANDARD CRUD HELPERS — saveData / loadData / deleteItem / updateUI
 * ------------------------------------------------------------
 * Toda operação CRUD passa por estes helpers para garantir:
 *  - try/catch consistente
 *  - feedback visual (toast, loading)
 *  - log estruturado em caso de erro
 *  - re-render localizado (não recarrega a página inteira)
 * ============================================================ */
const Data = {
  /** GET — carrega lista/objeto */
  async loadData(endpoint, opts = {}) {
    try {
      const r = await api('get', endpoint, undefined, opts);
      return r?.data;
    } catch (e) {
      console.error('[Data.loadData]', endpoint, e);
      throw e;
    }
  },

  /** POST/PUT — salva (cria ou atualiza) */
  async saveData(endpoint, body, { id = null, btn = null, silentToast = false, successMsg = 'Salvo com sucesso.' } = {}) {
    setBtnLoading(btn, true);
    try {
      const method = id ? 'put' : 'post';
      const url = id ? `${endpoint}/${id}` : endpoint;
      const r = await api(method, url, body);
      if (!silentToast) toast(successMsg, 'success');
      return r?.data;
    } catch (e) {
      console.error('[Data.saveData]', endpoint, id, e);
      // toast de erro já é exibido pelo interceptor de api()
      throw e;
    } finally {
      setBtnLoading(btn, false);
    }
  },

  /** DELETE — remove */
  async deleteItem(endpoint, id, { confirmMsg = 'Excluir este registro?', successMsg = 'Excluído.', btn = null } = {}) {
    if (confirmMsg && !confirmAction(confirmMsg)) return false;
    setBtnLoading(btn, true);
    try {
      await api('delete', `${endpoint}/${id}`);
      toast(successMsg, 'success');
      return true;
    } catch (e) {
      console.error('[Data.deleteItem]', endpoint, id, e);
      return false;
    } finally {
      setBtnLoading(btn, false);
    }
  },

  /** PATCH — atualização parcial (toggle, status, etc) */
  async patchItem(endpoint, id, suffix, body, { successMsg = 'Atualizado.', btn = null } = {}) {
    setBtnLoading(btn, true);
    try {
      await api('patch', `${endpoint}/${id}${suffix ? '/' + suffix : ''}`, body);
      toast(successMsg, 'success');
      return true;
    } catch (e) {
      console.error('[Data.patchItem]', endpoint, id, suffix, e);
      return false;
    } finally {
      setBtnLoading(btn, false);
    }
  },
};
window.Data = Data;

/** updateUI — re-renderiza a rota atual sem recarregar a página */
function updateUI() {
  if (typeof window.render === 'function') {
    window.render();
  }
}
window.updateUI = updateUI;

/* ============================================================
 * GLOBAL ERROR HANDLERS — capturam erros não-tratados
 * ============================================================ */
window.addEventListener('error', (ev) => {
  console.error('[GlobalError]', ev.message, ev.filename, ev.lineno, ev.error);
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('[UnhandledPromise]', ev.reason);
  // Já tem toast pelo api(); só registra
});

/* ============================================================
 * EVENT DELEGATION — listeners delegados (resolvem botões duplicados)
 * Use no markup: data-action="<nome>" data-id="<id>"
 * Registre handler com: Actions.on('<nome>', (id, btn, ev) => ...)
 * ============================================================ */
const Actions = {
  _handlers: new Map(),
  on(name, fn) { this._handlers.set(name, fn); },
  off(name) { this._handlers.delete(name); },
  _attachOnce() {
    if (this._attached) return;
    this._attached = true;
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const name = btn.dataset.action;
      const fn = this._handlers.get(name);
      if (!fn) return;
      ev.preventDefault();
      try { fn(btn.dataset.id, btn, ev); }
      catch (e) { console.error('[Action]', name, e); toast('Erro: ' + (e.message || e), 'error'); }
    });
  },
};
Actions._attachOnce();
window.Actions = Actions;

/* ============================================================
 * UI HELPERS — componentes inspirados em sistemas MES industriais
 * page header (breadcrumb + ações), KPIs v2, pills, empty state,
 * toolbar sticky, indicador "live"
 * ============================================================ */
const UI = {
  /** Header padrão de página: breadcrumb + título + descrição + ações */
  pageHeader({ breadcrumb = [], title = '', badge = '', desc = '', actions = '', live = false } = {}) {
    const bc = breadcrumb.length
      ? `<div class="breadcrumb">${breadcrumb.map((b, i) => {
          const sep = i < breadcrumb.length - 1 ? '<span class="sep"><i class="fas fa-chevron-right" style="font-size:9px"></i></span>' : '';
          const item = b.href
            ? `<a href="${b.href}">${b.label}</a>`
            : `<span>${b.label}</span>`;
          return `${item}${sep}`;
        }).join('')}</div>`
      : '';
    const liveTag = live
      ? `<span class="live-indicator" title="Atualizado agora"><span class="pulse"></span><span>Atualizado <span data-live-time>agora</span></span></span>`
      : '';
    return `
      <div class="page-header">
        <div class="ph-left">
          ${bc}
          <div class="ph-title">
            <span>${title}</span>
            ${badge ? `<span class="ph-badge">${badge}</span>` : ''}
          </div>
          ${desc ? `<div class="ph-desc">${desc}</div>` : ''}
        </div>
        <div class="ph-actions">
          ${liveTag}
          ${actions}
        </div>
      </div>`;
  },

  /** KPI card v2 (estilo MES com acento lateral, ícone, trend e progresso opcional) */
  kpi({ label, value, icon = 'fa-chart-line', accent = 'blue', trend = null, sub = '', progress = null }) {
    const trendBlock = trend
      ? `<span class="kpi-trend ${trend.dir}"><i class="fas fa-arrow-${trend.dir === 'up' ? 'up' : trend.dir === 'down' ? 'down' : 'right'}"></i>${trend.text}</span>`
      : '';
    const subBlock = sub ? `<span class="kpi-sub">${sub}</span>` : '';
    const progBlock = (progress !== null && progress !== undefined)
      ? `<div class="kpi-progress"><span style="width:${Math.max(0, Math.min(100, progress))}%"></span></div>`
      : '';
    return `
      <div class="kpi-card-v2 acc-${accent}">
        <div class="kpi-head">
          <span class="kpi-label">${label}</span>
          <span class="kpi-icon-mini"><i class="fas ${icon}"></i></span>
        </div>
        <div class="kpi-value">${value}</div>
        ${progBlock}
        <div class="kpi-foot">
          ${trendBlock}
          ${subBlock}
        </div>
      </div>`;
  },

  /** Pill / badge de status */
  pill(text, variant = 'neutral', icon = '') {
    const ico = icon ? `<i class="fas ${icon}" style="font-size:9px"></i>` : '<span class="dot"></span>';
    return `<span class="pill pill-${variant}">${ico}<span>${text}</span></span>`;
  },

  /** Pill automático para status comuns de produção */
  statusPill(status) {
    const map = {
      'Aberta':      ['neutral',  'fa-folder-open'],
      'Planejada':   ['purple',   'fa-calendar-check'],
      'EmProducao':  ['primary',  'fa-play'],
      'Em Produção': ['primary',  'fa-play'],
      'Pausada':     ['warning',  'fa-pause'],
      'Concluida':   ['success',  'fa-check'],
      'Concluída':   ['success',  'fa-check'],
      'Atrasada':    ['danger',   'fa-exclamation'],
      'Cancelada':   ['danger',   'fa-times'],
      'Ativa':       ['success',  'fa-circle-check'],
      'Inativa':     ['neutral',  'fa-circle'],
    };
    const [variant, ic] = map[status] || ['neutral', ''];
    return UI.pill(status, variant, ic);
  },

  /** Empty state ilustrado */
  empty({ icon = 'fa-inbox', title = 'Sem dados', desc = '', action = '' } = {}) {
    return `
      <div class="empty-state">
        <div class="es-icon"><i class="fas ${icon}"></i></div>
        <div class="es-title">${title}</div>
        ${desc ? `<div class="es-desc">${desc}</div>` : ''}
        ${action || ''}
      </div>`;
  },

  /** Toolbar sticky com busca + filtros + ação primária */
  toolbar({ searchId = 'tb-search', searchPh = 'Buscar...', filters = '', actions = '' } = {}) {
    return `
      <div class="toolbar-sticky">
        <div class="tb-search">
          <i class="fas fa-search"></i>
          <input id="${searchId}" type="text" placeholder="${searchPh}" autocomplete="off" />
        </div>
        ${filters}
        <div class="tb-spacer"></div>
        ${actions}
      </div>`;
  },

  /** Section header (subtítulo dentro de card) */
  section({ title, icon = '', meta = '' } = {}) {
    return `
      <div class="section-head">
        <div class="sh-title">${icon ? `<i class="fas ${icon}"></i>` : ''}<span>${title}</span></div>
        ${meta ? `<div class="sh-meta">${meta}</div>` : ''}
      </div>`;
  },

  /** Barra de progresso inline (para tabelas de OP) */
  progress(pct, opts = {}) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const variant = opts.variant
      || (p >= 100 ? 'done' : p >= 70 ? '' : opts.late ? 'warn' : '');
    return `<div class="op-progress">
      <div class="bar ${variant}"><span style="width:${p}%"></span></div>
      <span class="pct">${p.toFixed(0)}%</span>
    </div>`;
  },

  /** Card de alerta (dashboard MES) */
  alert({ tipo = 'warning', icon = 'fa-circle-exclamation', titulo = '', desc = '', acao = '' } = {}) {
    const click = acao ? `onclick="navigate('${acao}')" style="cursor:pointer"` : '';
    return `
      <div class="alert-card ${tipo}" ${click}>
        <div class="ac-icon"><i class="fas ${icon}"></i></div>
        <div style="flex:1;min-width:0">
          <div class="ac-title">${titulo}</div>
          ${desc ? `<div class="ac-desc">${desc}</div>` : ''}
        </div>
      </div>`;
  },

  /** Linha de ranking (top operadores, top produtos) */
  rankRow(pos, nome, sub, score) {
    const top = pos <= 3 ? `top${pos}` : '';
    return `
      <div class="rank-row ${top}">
        <div class="pos">${pos}</div>
        <div class="name"><b>${nome}</b>${sub ? `<small>${sub}</small>` : ''}</div>
        <div class="score">${score}</div>
      </div>`;
  },

  /** Atualiza o indicador live (texto "há Xs") periodicamente */
  liveTick(rootEl, since = Date.now()) {
    const upd = () => {
      const el = (rootEl || document).querySelector('[data-live-time]');
      if (!el) return;
      const s = Math.floor((Date.now() - since) / 1000);
      el.textContent = s < 5 ? 'agora' : s < 60 ? `há ${s}s` : `há ${Math.floor(s/60)}min`;
    };
    upd();
    if (this._liveTimer) clearInterval(this._liveTimer);
    this._liveTimer = setInterval(upd, 5000);
  },
};
window.UI = UI;
