/* ============================================================
 * CorePro · Área Master (Super Admin SaaS)
 * ============================================================
 * Arquivo carregado SOMENTE quando o hash da URL inicia com #master.
 * Isolado do app.js comum. Usa /api/master/* endpoints + token próprio
 * armazenado em localStorage.master_token.
 * ============================================================ */
(function () {
  'use strict';

  const API = '/api';
  const TOKEN_KEY = 'corepro_master_token';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmt = {
    money: (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    int:   (v) => Number(v || 0).toLocaleString('pt-BR'),
    date:  (v) => v ? new Date(v.replace(' ', 'T')).toLocaleDateString('pt-BR') : '—',
    datetime: (v) => v ? new Date(v.replace(' ', 'T')).toLocaleString('pt-BR') : '—',
  };

  const AUTH = {
    getToken: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    setToken: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch {} },
    clear:    ()  => { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
  };

  function api(method, path, data) {
    const token = AUTH.getToken();
    return axios({
      method,
      url: API + path,
      data,
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    }).then((r) => r.data).catch((e) => {
      const msg = e.response?.data?.error || e.message || 'Erro de comunicação';
      const code = e.response?.data?.code;
      if (code === 'MASTER_AUTH_REQUIRED') {
        AUTH.clear();
        renderLogin('Sessão expirada. Faça login novamente.');
      }
      throw new Error(msg);
    });
  }

  function toast(msg, kind = 'info') {
    let el = $('#master-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'master-toast';
      el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;';
      document.body.appendChild(el);
    }
    const t = document.createElement('div');
    const bg = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' }[kind] || '#3b82f6';
    t.style.cssText = `background:${bg};color:#fff;padding:12px 18px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.25);font-size:.9rem;font-weight:500;min-width:240px;animation:masterSlideIn .25s ease-out;`;
    t.textContent = msg;
    el.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = 'all .3s'; setTimeout(() => t.remove(), 300); }, 3500);
  }

  /* ============================================================
   * CSS inline mínimo da área master
   * ============================================================ */
  function injectCSS() {
    if ($('#master-css')) return;
    const css = `
    @keyframes masterSlideIn { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    #master-app { min-height: 100vh; background: #0f172a; color: #e2e8f0; font-family: 'Inter', sans-serif; }
    .master-shell { display: flex; min-height: 100vh; }
    .master-sidebar { width: 260px; background: #020617; border-right: 1px solid #1e293b; padding: 24px 16px; display: flex; flex-direction: column; }
    .master-sidebar h1 { font-size: 1.25rem; font-weight: 800; color: #fff; margin-bottom: 4px; display: flex; align-items: center; gap: 10px; }
    .master-sidebar .tag { font-size: .65rem; background: linear-gradient(90deg,#7c3aed,#2563eb); color: #fff; padding: 2px 8px; border-radius: 4px; letter-spacing: .1em; font-weight: 700; }
    .master-nav { flex: 1; margin-top: 24px; display: flex; flex-direction: column; gap: 4px; }
    .master-nav a { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 8px; color: #94a3b8; text-decoration: none; font-size: .9rem; font-weight: 500; cursor: pointer; transition: all .15s; }
    .master-nav a:hover { background: #1e293b; color: #e2e8f0; }
    .master-nav a.active { background: linear-gradient(90deg, rgba(124,58,237,.2), rgba(37,99,235,.15)); color: #fff; border-left: 3px solid #7c3aed; padding-left: 11px; }
    .master-user { margin-top: auto; padding: 14px; background: #1e293b; border-radius: 10px; font-size: .85rem; }
    .master-user .uname { font-weight: 700; color: #fff; }
    .master-user .urole { font-size: .7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: .08em; margin-top: 2px; }
    .master-content { flex: 1; padding: 28px 36px; overflow-x: hidden; }
    .master-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .master-header h2 { font-size: 1.6rem; font-weight: 700; color: #fff; }
    .master-header .subtitle { color: #94a3b8; font-size: .85rem; margin-top: 2px; }
    .master-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 22px; transition: border-color .15s; }
    .master-card:hover { border-color: #475569; }
    .master-kpi { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .master-kpi .master-card { display: flex; flex-direction: column; gap: 6px; }
    .master-kpi .label { color: #94a3b8; font-size: .75rem; text-transform: uppercase; letter-spacing: .1em; font-weight: 600; }
    .master-kpi .value { color: #fff; font-size: 2rem; font-weight: 800; font-feature-settings: "tnum"; }
    .master-kpi .delta { color: #34d399; font-size: .8rem; font-weight: 600; }
    .master-table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; }
    .master-table thead { background: #0f172a; }
    .master-table th { padding: 14px 16px; text-align: left; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; font-weight: 700; border-bottom: 1px solid #334155; }
    .master-table td { padding: 14px 16px; border-bottom: 1px solid #334155; color: #e2e8f0; font-size: .88rem; }
    .master-table tbody tr:hover { background: #243044; }
    .master-table tbody tr:last-child td { border-bottom: none; }
    .master-badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .master-badge.ativa { background: rgba(16,185,129,.15); color: #34d399; }
    .master-badge.trial { background: rgba(59,130,246,.15); color: #60a5fa; }
    .master-badge.suspensa { background: rgba(239,68,68,.15); color: #f87171; }
    .master-badge.cancelada { background: rgba(100,116,139,.2); color: #94a3b8; }
    .master-badge.bloqueada { background: rgba(245,158,11,.18); color: #fbbf24; }
    .master-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 8px; font-size: .85rem; font-weight: 600; cursor: pointer; border: 0; transition: all .15s; }
    .master-btn-primary { background: linear-gradient(90deg, #7c3aed, #2563eb); color: #fff; }
    .master-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(124,58,237,.4); }
    .master-btn-secondary { background: #334155; color: #e2e8f0; }
    .master-btn-secondary:hover { background: #475569; }
    .master-btn-danger { background: #dc2626; color: #fff; }
    .master-btn-danger:hover { background: #b91c1c; }
    .master-btn-warning { background: #d97706; color: #fff; }
    .master-btn-warning:hover { background: #b45309; }
    .master-btn-icon { padding: 6px 10px; font-size: .85rem; }
    .master-input, .master-select, .master-textarea { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px 14px; color: #e2e8f0; font-size: .9rem; font-family: inherit; transition: border-color .15s; }
    .master-input:focus, .master-select:focus, .master-textarea:focus { outline: none; border-color: #7c3aed; }
    .master-input::placeholder { color: #64748b; }
    .master-form { display: grid; gap: 14px; }
    .master-form .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .master-form .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
    .master-form label { display: block; font-size: .75rem; font-weight: 600; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .05em; }
    .master-modal-bg { position: fixed; inset: 0; background: rgba(2,6,23,.85); display: flex; align-items: center; justify-content: center; z-index: 9000; padding: 24px; backdrop-filter: blur(4px); }
    .master-modal { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 28px; max-width: 720px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
    .master-modal h3 { font-size: 1.25rem; font-weight: 700; color: #fff; margin-bottom: 18px; display: flex; align-items: center; gap: 10px; }
    .master-modal .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; padding-top: 18px; border-top: 1px solid #334155; }
    .master-login-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 30% 20%, rgba(124,58,237,.15), transparent 50%), radial-gradient(circle at 70% 80%, rgba(37,99,235,.12), transparent 50%), #020617; padding: 24px; }
    .master-login-card { background: #1e293b; border: 1px solid #334155; border-radius: 18px; padding: 38px; width: 100%; max-width: 420px; box-shadow: 0 30px 80px rgba(0,0,0,.5); }
    .master-login-card .logo { text-align: center; margin-bottom: 26px; }
    .master-login-card .logo h1 { font-size: 1.6rem; font-weight: 800; color: #fff; margin-bottom: 6px; display: inline-flex; align-items: center; gap: 10px; }
    .master-login-card .logo .tag { font-size: .65rem; background: linear-gradient(90deg,#7c3aed,#2563eb); color: #fff; padding: 3px 10px; border-radius: 4px; letter-spacing: .15em; font-weight: 800; vertical-align: middle; }
    .master-login-card .logo p { color: #94a3b8; font-size: .85rem; margin-top: 6px; }
    .master-loading { display: flex; align-items: center; justify-content: center; padding: 60px; color: #94a3b8; gap: 10px; font-size: .9rem; }
    .master-empty { text-align: center; padding: 60px 20px; color: #64748b; }
    .master-empty i { font-size: 3rem; color: #334155; margin-bottom: 16px; }

    /* ===== PLANOS — Cards grid ===== */
    .plans-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; }
    .plan-card { background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); border: 1px solid #334155; border-top: 4px solid #7c3aed; border-radius: 14px; padding: 22px 20px 18px; display: flex; flex-direction: column; gap: 12px; transition: transform .15s ease, box-shadow .2s ease, border-color .2s ease; position: relative; }
    .plan-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(0,0,0,.35); border-color: #475569; }
    .plan-card.inativo { opacity: .55; filter: grayscale(.35); }
    .plan-card.destaque { box-shadow: 0 0 0 1px rgba(251,191,36,.35), 0 6px 24px rgba(251,191,36,.08); }
    .plan-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .plan-card-title h3 { margin: 0; font-size: 1.3rem; font-weight: 800; }
    .plan-codigo { display: inline-block; margin-top: 4px; font-size: .68rem; color: #94a3b8; background: rgba(148,163,184,.1); padding: 2px 7px; border-radius: 4px; font-family: 'Courier New', monospace; }
    .plan-badge-destaque { display: inline-flex; align-items: center; gap: 4px; background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1e293b; font-size: .65rem; font-weight: 800; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
    .plan-status-inativo { background: rgba(148,163,184,.15); color: #94a3b8; font-size: .7rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
    .plan-price { display: flex; align-items: baseline; gap: 4px; padding: 6px 0; }
    .plan-price .currency { font-size: .8rem; color: #94a3b8; font-weight: 600; }
    .plan-price .value { font-size: 2rem; font-weight: 800; color: #fff; line-height: 1; }
    .plan-price .period { font-size: .85rem; color: #94a3b8; }
    .plan-desc { color: #cbd5e1; font-size: .82rem; line-height: 1.5; margin: 0; }
    .plan-limites { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; padding: 10px 12px; background: rgba(15,23,42,.5); border-radius: 8px; }
    .plan-limite { display: flex; justify-content: space-between; align-items: center; font-size: .8rem; }
    .plan-limite .lbl { color: #94a3b8; }
    .plan-limite .val { color: #fff; font-weight: 700; }
    .plan-features { display: flex; flex-wrap: wrap; gap: 5px; min-height: 30px; }
    .plan-feat-chip { display: inline-flex; align-items: center; gap: 4px; background: rgba(124,58,237,.15); color: #c4b5fd; font-size: .7rem; padding: 3px 8px; border-radius: 12px; border: 1px solid rgba(124,58,237,.3); }
    .plan-feat-chip i { font-size: .65rem; }
    .plan-meta { display: flex; justify-content: space-between; align-items: center; font-size: .75rem; color: #94a3b8; padding-top: 10px; border-top: 1px solid rgba(51,65,85,.5); }
    .plan-actions { display: flex; gap: 6px; padding-top: 12px; border-top: 1px solid rgba(51,65,85,.5); }
    .plan-actions .master-btn { flex: 0 0 auto; padding: 6px 10px; font-size: .8rem; }
    .plan-actions .master-btn:first-child { flex: 1; }

    /* ===== PLANO — Formulário ===== */
    .plan-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .plan-form-section { padding: 22px; }
    .plan-form-full { grid-column: 1 / -1; }
    .plan-form-title { margin: 0 0 16px; color: #fff; font-size: 1rem; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .plan-form-title i { color: #a78bfa; }
    .plan-form-section label { display: block; font-size: .78rem; font-weight: 600; color: #94a3b8; margin-bottom: 5px; }
    .plan-form-section .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .plan-form-section .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .plan-color-input { padding: 4px 8px; height: 42px; cursor: pointer; }
    .plan-feats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
    .plan-feat-toggle { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: rgba(15,23,42,.5); border: 1px solid #334155; border-radius: 10px; cursor: pointer; transition: all .15s; }
    .plan-feat-toggle:hover { border-color: #7c3aed; background: rgba(124,58,237,.08); }
    .plan-feat-toggle input { accent-color: #7c3aed; width: 18px; height: 18px; cursor: pointer; flex-shrink: 0; }
    .plan-feat-toggle input:checked + .plan-feat-content { color: #fff; }
    .plan-feat-toggle:has(input:checked) { border-color: #7c3aed; background: rgba(124,58,237,.12); }
    .plan-feat-content { display: flex; align-items: center; gap: 8px; color: #cbd5e1; font-size: .85rem; flex: 1; }
    .plan-feat-content i { color: #a78bfa; width: 16px; text-align: center; }
    .plan-toggle-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: rgba(15,23,42,.5); border: 1px solid #334155; border-radius: 10px; cursor: pointer; }
    .plan-toggle-row input { accent-color: #7c3aed; width: 20px; height: 20px; cursor: pointer; flex-shrink: 0; }
    .plan-toggle-row strong { display: block; color: #fff; font-size: .9rem; }
    .plan-toggle-row span { display: block; font-size: .75rem; color: #94a3b8; margin-top: 2px; }
    .plan-toggle-row:has(input:checked) { border-color: #7c3aed; }
    .plan-form-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 10px; padding-top: 6px; }
    @media (max-width: 900px) {
      .plan-form-grid { grid-template-columns: 1fr; }
      .plan-form-section .grid-2, .plan-form-section .grid-3 { grid-template-columns: 1fr 1fr; }
      .plans-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 540px) {
      .plan-form-section .grid-2, .plan-form-section .grid-3 { grid-template-columns: 1fr; }
      .plan-feats-grid { grid-template-columns: 1fr; }
    }

    /* ============================================================
     * SPRINT B — Gerenciamento de Empresas
     * ============================================================ */
    /* Seções de formulário */
    .master-form-section { font-size: .8rem; font-weight: 700; color: #fff; margin: 22px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #334155; text-transform: uppercase; letter-spacing: .06em; }
    .master-form-section:first-child { margin-top: 0; }

    /* Caixa de informação */
    .master-info-box { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; background: rgba(96,165,250,.08); border: 1px solid rgba(96,165,250,.25); border-radius: 8px; color: #bfdbfe; font-size: .82rem; line-height: 1.5; margin-bottom: 14px; }
    .master-info-box i { color: #60a5fa; margin-top: 2px; flex-shrink: 0; }
    .master-info-box strong { color: #fff; }

    /* Botão pequeno */
    .master-btn-sm { padding: 6px 12px !important; font-size: .78rem !important; }

    /* Modal de senha temporária (one-time) */
    .m-pwd-box { background: rgba(15,23,42,.6); border: 1px solid #334155; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
    .m-pwd-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed #334155; }
    .m-pwd-row:last-child { border-bottom: none; }
    .m-pwd-label { min-width: 130px; color: #94a3b8; font-size: .8rem; font-weight: 600; }
    .m-pwd-value { flex: 1; color: #e2e8f0; font-family: 'Menlo', 'Courier New', monospace; font-size: .9rem; word-break: break-all; user-select: all; }
    .m-pwd-value.m-pwd-secret { color: #fbbf24; font-weight: 700; font-size: 1.05rem; letter-spacing: .03em; background: rgba(251,191,36,.08); padding: 4px 10px; border-radius: 6px; border: 1px dashed rgba(251,191,36,.3); }
    .m-pwd-copy { background: #334155; border: none; color: #cbd5e1; padding: 6px 10px; border-radius: 6px; cursor: pointer; transition: all .15s; flex-shrink: 0; }
    .m-pwd-copy:hover { background: #475569; color: #fff; transform: translateY(-1px); }
    .m-pwd-copy:active { transform: translateY(0); }

    /* Alerta dentro do modal */
    .m-pwd-warn { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; background: rgba(251,191,36,.08); border: 1px solid rgba(251,191,36,.3); border-radius: 8px; color: #fde68a; font-size: .82rem; line-height: 1.5; margin-bottom: 14px; }
    .m-pwd-warn i { color: #fbbf24; margin-top: 2px; flex-shrink: 0; font-size: 1.1rem; }
    .m-pwd-warn strong { color: #fcd34d; }
    .m-pwd-warn u { text-decoration-color: #fbbf24; text-underline-offset: 2px; }

    /* Filtros da lista de empresas */
    .m-emp-filters { display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; gap: 10px; margin-bottom: 16px; }
    .m-emp-filters .master-input, .m-emp-filters .master-select { width: 100%; }
    @media (max-width: 900px) {
      .m-emp-filters { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 540px) {
      .m-emp-filters { grid-template-columns: 1fr; }
      .master-kpi { grid-template-columns: repeat(2, 1fr) !important; }
    }

    /* Ajuste do master-kpi quando temos 5 colunas */
    @media (max-width: 1100px) {
      .master-kpi[style*="repeat(5"] { grid-template-columns: repeat(3, 1fr) !important; }
    }

    /* ============================================================
     * SPRINT C — Jobs (lifecycle de assinaturas)
     * ============================================================ */
    .jobs-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .job-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 14px; transition: border-color .15s; }
    .job-card:hover { border-color: #475569; }
    .job-card-head { display: flex; align-items: flex-start; gap: 12px; }
    .job-card-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0; }
    .job-card-title { flex: 1; min-width: 0; }
    .job-card-title h3 { font-size: .98rem; font-weight: 700; color: #fff; margin: 0 0 4px 0; }
    .job-card-title p { font-size: .78rem; color: #94a3b8; margin: 0; line-height: 1.4; }
    .job-card-count { font-size: 2.2rem; font-weight: 800; font-family: 'Inter', sans-serif; min-width: 50px; text-align: right; line-height: 1; }
    .job-card-body { background: rgba(15,23,42,.5); border: 1px solid #334155; border-radius: 8px; padding: 12px 14px; min-height: 70px; }
    .job-empty { color: #94a3b8; font-size: .82rem; text-align: center; padding: 10px; }
    .job-empty i { font-size: 1.4rem; margin-right: 6px; }
    .job-items { list-style: none; padding: 0; margin: 0; }
    .job-items li { font-size: .8rem; color: #cbd5e1; padding: 4px 0; border-bottom: 1px dashed rgba(51,65,85,.6); }
    .job-items li:last-child { border-bottom: none; }
    .job-items li strong { color: #fff; }
    .job-more { color: #64748b !important; font-style: italic; font-size: .75rem !important; }
    .job-card-foot { display: flex; justify-content: flex-end; }
    @media (max-width: 900px) { .jobs-grid { grid-template-columns: 1fr; } }

    /* Dashboard: card de saúde do lifecycle */
    .lifecycle-health { transition: border-color .15s, transform .15s; }
    .lifecycle-health:hover { border-color: #7c3aed; transform: translateY(-1px); }
    .lc-mini { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid #334155; border-radius: 8px; background: rgba(15,23,42,.5); font-size: .78rem; color: #cbd5e1; }
    .lc-mini strong { font-size: 1rem; color: #fff; font-weight: 800; }
    .lc-mini span { color: #94a3b8; font-size: .72rem; }
    @media (max-width: 720px) { .lc-mini span { display: none; } }

    /* Sub-logs timeline */
    .sublogs-timeline { position: relative; padding-left: 4px; }
    .sublog-item { display: flex; gap: 12px; padding: 10px 0; position: relative; }
    .sublog-item:not(:last-child)::before { content: ''; position: absolute; left: 5px; top: 22px; bottom: -10px; width: 2px; background: #334155; }
    .sublog-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; box-shadow: 0 0 0 3px #1e293b; z-index: 1; }
    .sublog-body { flex: 1; min-width: 0; }
    .sublog-head { font-size: .85rem; }
    .sublog-meta { font-size: .72rem; color: #64748b; margin-top: 2px; font-family: 'Menlo', monospace; }
    .sublog-det { margin-top: 6px; font-size: .72rem; color: #94a3b8; }
    .sublog-det code { background: rgba(124,58,237,.1); border: 1px solid rgba(124,58,237,.25); padding: 1px 6px; border-radius: 4px; margin-right: 4px; color: #cbd5e1; }

    /* ============================================================
     * HOTFIX 0051 — Responsividade Mobile do Painel MASTER
     * Escopo: regras válidas apenas dentro de #master-app
     * Não impacta app.js principal (este arquivo só carrega em #master)
     * Breakpoints oficiais: 1024 (tablet), 768 (mobile), 480 (small)
     * ============================================================ */

    /* Hambúrguer (oculto no desktop, exibido <=1024) */
    #master-app .master-hamburger {
      display: none;
      position: fixed;
      top: 14px;
      left: 14px;
      z-index: 9500;
      background: #1e293b;
      border: 1px solid #334155;
      color: #fff;
      width: 44px;
      height: 44px;
      border-radius: 10px;
      font-size: 1.15rem;
      cursor: pointer;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,.35);
      transition: background .15s, transform .15s;
    }
    #master-app .master-hamburger:hover { background: #334155; }
    #master-app .master-hamburger:active { transform: scale(.94); }

    /* Overlay (oculto no desktop) */
    #master-app .master-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.6);
      z-index: 8800;
      backdrop-filter: blur(2px);
      animation: masterFadeIn .2s ease-out;
    }
    @keyframes masterFadeIn { from { opacity: 0; } to { opacity: 1; } }

    /* ===== TABLET (<=1024px) — sidebar vira off-canvas ===== */
    @media (max-width: 1024px) {
      #master-app .master-hamburger { display: inline-flex; }

      /* Sidebar: posiciona como drawer lateral, oculta por padrão */
      #master-app .master-sidebar {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: 280px;
        max-width: 80vw;
        z-index: 9000;
        transform: translateX(-105%);
        transition: transform .25s ease-out;
        box-shadow: 4px 0 24px rgba(0,0,0,.5);
        overflow-y: auto;
        padding-top: 64px; /* reserva espaço para o ☰ flutuante */
      }
      /* Estado aberto */
      #master-app.is-menu-open .master-sidebar { transform: translateX(0); }
      #master-app.is-menu-open .master-overlay { display: block; }

      /* Content ganha 100% e respiro no topo para o ☰ */
      #master-app .master-content {
        padding: 64px 20px 24px;
        width: 100%;
        min-width: 0;
        overflow-x: hidden;
      }

      /* Header da tela: empilha título + ação */
      #master-app .master-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
      }
      #master-app .master-header > button,
      #master-app .master-header .master-btn { width: 100%; justify-content: center; }
      #master-app .master-header h2 { font-size: 1.35rem; }

      /* KPIs: 2 por linha em tablet */
      #master-app .master-kpi,
      #master-app .master-kpi[style*="repeat(5"] {
        grid-template-columns: repeat(2, 1fr) !important;
      }
      #master-app .master-kpi .value { font-size: 1.6rem; }

      /* Cards de planos / jobs: 1 por linha */
      #master-app .plans-grid,
      #master-app .jobs-grid { grid-template-columns: 1fr !important; }

      /* Form do plano: 1 coluna */
      #master-app .plan-form-grid { grid-template-columns: 1fr !important; }
      #master-app .plan-form-section .grid-2,
      #master-app .plan-form-section .grid-3,
      #master-app .master-form .grid-2,
      #master-app .master-form .grid-3 { grid-template-columns: 1fr 1fr !important; }

      /* Filtros de empresas: 2 colunas no tablet */
      #master-app .m-emp-filters { grid-template-columns: 1fr 1fr !important; }

      /* Tabela: scroll horizontal apenas no container, nunca na página */
      #master-app .master-card:has(> .master-table) { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      #master-app .master-table { min-width: 720px; }

      /* Modais ocupam quase toda a tela */
      #master-app .master-modal-bg { padding: 12px; }
      #master-app .master-modal {
        width: 95%;
        max-width: 95%;
        max-height: 90vh;
        padding: 22px 18px;
        border-radius: 14px;
      }
      #master-app .master-modal .actions { flex-direction: column-reverse; gap: 8px; }
      #master-app .master-modal .actions .master-btn { width: 100%; justify-content: center; }
    }

    /* ===== MOBILE (<=768px) — cards 1 por linha + filtros empilhados ===== */
    @media (max-width: 768px) {
      #master-app .master-kpi,
      #master-app .master-kpi[style*="repeat(5"] {
        grid-template-columns: 1fr !important;
        gap: 12px;
      }
      #master-app .master-kpi .value { font-size: 1.8rem; }

      /* Filtros: um abaixo do outro */
      #master-app .m-emp-filters {
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
      }
      #master-app .m-emp-filters > * { width: 100%; }

      /* Forms do master ficam em 1 coluna */
      #master-app .master-form .grid-2,
      #master-app .master-form .grid-3,
      #master-app .plan-form-section .grid-2,
      #master-app .plan-form-section .grid-3 { grid-template-columns: 1fr !important; }
      #master-app .plan-feats-grid { grid-template-columns: 1fr !important; }

      /* Inputs ocupam 100% */
      #master-app .master-input,
      #master-app .master-select,
      #master-app .master-textarea { width: 100%; }

      /* Botões de ação em tabela: esconde texto, mostra só ícone */
      #master-app .master-table .master-btn,
      #master-app .master-table .master-btn-icon {
        padding: 8px 10px !important;
      }
      #master-app .master-table .master-btn-label { display: none; }
      /* Reduz padding das células */
      #master-app .master-table th,
      #master-app .master-table td { padding: 10px 12px; font-size: .82rem; }

      /* Cards (planos): ações em coluna */
      #master-app .plan-actions { flex-direction: column; }
      #master-app .plan-actions .master-btn { width: 100%; justify-content: center; }

      /* Header da tela: título menor */
      #master-app .master-content { padding: 60px 14px 20px; }
      #master-app .master-header h2 { font-size: 1.2rem; }
      #master-app .master-header .subtitle { font-size: .78rem; }

      /* Reduz padding interno de cards */
      #master-app .master-card { padding: 16px; }

      /* Modal de senha: linhas viram coluna */
      #master-app .m-pwd-row { flex-direction: column; align-items: flex-start; gap: 4px; }
      #master-app .m-pwd-label { min-width: 0; }
      #master-app .m-pwd-value { width: 100%; }

      /* Login: card menor */
      #master-app .master-login-card { padding: 26px 20px; }
      #master-app .master-login-card .logo h1 { font-size: 1.3rem; }
    }

    /* ===== iPHONE / SMALL (<=480px) — ajustes finos ===== */
    @media (max-width: 480px) {
      #master-app .master-hamburger {
        top: 10px; left: 10px;
        width: 40px; height: 40px;
      }
      #master-app .master-content { padding: 56px 10px 18px; }
      #master-app .master-header h2 { font-size: 1.1rem; }
      #master-app .master-kpi .value { font-size: 1.5rem; }
      #master-app .master-modal { padding: 18px 14px; }
      #master-app .master-modal h3 { font-size: 1.05rem; }
      #master-app .master-table th,
      #master-app .master-table td { padding: 8px 10px; font-size: .78rem; }

      /* Toast não sai da tela */
      #master-toast { left: 10px !important; right: 10px !important; top: 70px !important; }
      #master-toast > div { min-width: 0 !important; max-width: 100% !important; }
    }
    `;
    const s = document.createElement('style');
    s.id = 'master-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ============================================================
   * Roteamento simples por hash
   * ============================================================ */
  const STATE = { master: null, route: 'dashboard' };

  function getRoute() {
    const h = location.hash.replace(/^#/, '');
    if (!h.startsWith('master')) return null;
    const rest = h.slice('master'.length).replace(/^\//, '');
    return rest || 'dashboard';
  }

  function navigate(route) {
    location.hash = '#master/' + route;
  }
  window.masterNavigate = navigate;

  /* ============================================================
   * TELA DE LOGIN
   * ============================================================ */
  function renderLogin(msg) {
    document.title = 'CorePro Master — Login';
    document.body.innerHTML = '<div id="master-app"></div>';
    const app = $('#master-app');
    app.innerHTML = `
    <div class="master-login-screen">
      <div class="master-login-card">
        <div class="logo">
          <h1><i class="fas fa-crown" style="color:#fbbf24"></i> CorePro <span class="tag">MASTER</span></h1>
          <p>Painel administrativo SaaS — Acesso restrito</p>
        </div>
        ${msg ? `<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#fca5a5;padding:10px 14px;border-radius:8px;font-size:.85rem;margin-bottom:16px;"><i class="fas fa-exclamation-circle mr-1"></i> ${msg}</div>` : ''}
        <form id="m-form" class="master-form">
          <div>
            <label>Usuário Master</label>
            <input class="master-input" id="m-login" type="text" autocomplete="username" required autofocus placeholder="master" />
          </div>
          <div>
            <label>Senha</label>
            <input class="master-input" id="m-senha" type="password" autocomplete="current-password" required placeholder="••••••••" />
          </div>
          <button type="submit" class="master-btn master-btn-primary" id="m-btn" style="width:100%;padding:12px;justify-content:center;font-size:.95rem;margin-top:6px;">
            <i class="fas fa-arrow-right-to-bracket"></i> Acessar área Master
          </button>
        </form>
        <div id="m-err" style="color:#fca5a5;font-size:.85rem;text-align:center;margin-top:12px;"></div>
        <div style="text-align:center;margin-top:24px;padding-top:18px;border-top:1px solid #334155;font-size:.75rem;color:#64748b;">
          <a href="#" onclick="location.href='/'" style="color:#60a5fa;text-decoration:none;">← Voltar para acesso comum</a>
        </div>
      </div>
    </div>`;

    $('#m-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('#m-btn');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Entrando…';
      $('#m-err').textContent = '';
      try {
        const r = await axios.post(API + '/master/auth/login', {
          login: $('#m-login').value.trim(),
          senha: $('#m-senha').value,
        });
        AUTH.setToken(r.data.data.token);
        STATE.master = r.data.data.master;
        location.hash = '#master/dashboard';
        boot();
      } catch (err) {
        $('#m-err').textContent = err.response?.data?.error || 'Credenciais inválidas.';
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Acessar área Master';
      }
    };
  }

  /* ============================================================
   * SHELL (sidebar + content)
   * ============================================================ */
  function renderShell() {
    document.title = 'CorePro Master';
    document.body.innerHTML = '<div id="master-app"></div>';
    const app = $('#master-app');
    app.innerHTML = `
    <button class="master-hamburger" id="m-hamburger" aria-label="Abrir menu" type="button"><i class="fas fa-bars"></i></button>
    <div class="master-overlay" id="m-overlay"></div>
    <div class="master-shell">
      <aside class="master-sidebar">
        <h1><i class="fas fa-crown" style="color:#fbbf24"></i> CorePro <span class="tag">MASTER</span></h1>
        <nav class="master-nav">
          <a data-r="dashboard"><i class="fas fa-chart-line w-5"></i> Dashboard</a>
          <a data-r="empresas"><i class="fas fa-building w-5"></i> Empresas</a>
          <a data-r="financeiro"><i class="fas fa-credit-card w-5"></i> Financeiro</a>
          <a data-r="planos"><i class="fas fa-layer-group w-5"></i> Planos</a>
          <a data-r="jobs"><i class="fas fa-robot w-5"></i> Jobs</a>
        </nav>
        <div class="master-user">
          <div class="uname"><i class="fas fa-user-shield mr-1"></i> ${STATE.master?.nome || 'Admin'}</div>
          <div class="urole">${STATE.master?.login || ''}</div>
          <button class="master-btn master-btn-secondary" style="width:100%;margin-top:10px;justify-content:center;" id="m-logout"><i class="fas fa-sign-out-alt"></i> Sair</button>
        </div>
      </aside>
      <main class="master-content" id="m-main">
        <div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando…</div>
      </main>
    </div>`;

    // HOTFIX 0051 — Sidebar mobile retrátil
    const appEl = app;
    const openMenu  = () => appEl.classList.add('is-menu-open');
    const closeMenu = () => appEl.classList.remove('is-menu-open');
    $('#m-hamburger').onclick = (e) => {
      e.preventDefault();
      appEl.classList.toggle('is-menu-open');
    };
    $('#m-overlay').onclick = closeMenu;
    // Fecha ao redimensionar para desktop (>1024)
    window.addEventListener('resize', () => {
      if (window.innerWidth > 1024) closeMenu();
    });
    // Fecha com ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && appEl.classList.contains('is-menu-open')) closeMenu();
    });

    $$('.master-nav a').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        navigate(a.dataset.r);
        closeMenu(); // HOTFIX 0051 — fecha ao selecionar item
      };
    });
    $('#m-logout').onclick = async () => {
      try { await api('post', '/master/auth/logout'); } catch {}
      AUTH.clear();
      location.hash = '';
      location.href = '/';
    };
  }

  function highlightNav(route) {
    $$('.master-nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === route));
  }

  /* ============================================================
   * TELA: DASHBOARD
   * ============================================================ */
  async function viewDashboard() {
    const main = $('#m-main');
    main.innerHTML = '<div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando dashboard…</div>';
    try {
      const [r, life] = await Promise.all([
        api('get', '/master/dashboard'),
        api('get', '/master/jobs/preview-all').catch(() => ({ data: {} })),
      ]);
      const d = r.data;
      const lc = life.data || {};
      const lcExpire = lc.expire_trials?.qtd || 0;
      const lcMark   = lc.mark_overdue?.qtd  || 0;
      const lcBlock  = lc.block_overdue?.qtd || 0;
      const lcWarn   = lc.warn_upcoming?.qtd || 0;
      const lcTotal  = lcExpire + lcMark + lcBlock + lcWarn;

      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2>Dashboard SaaS</h2>
            <div class="subtitle">Visão consolidada de todas as empresas, MRR e receita</div>
          </div>
          <button class="master-btn master-btn-primary" onclick="masterNavigate('empresas/nova')"><i class="fas fa-plus"></i> Nova empresa</button>
        </div>

        <div class="master-kpi">
          <div class="master-card">
            <div class="label"><i class="fas fa-building mr-1"></i> Empresas ativas</div>
            <div class="value">${fmt.int(d.totals.empresas)}</div>
            <div class="delta">Total no sistema</div>
          </div>
          <div class="master-card">
            <div class="label"><i class="fas fa-arrows-spin mr-1"></i> MRR estimado</div>
            <div class="value">${fmt.money(d.totals.mrr)}</div>
            <div class="delta">Subscriptions ativas mensais</div>
          </div>
          <div class="master-card">
            <div class="label"><i class="fas fa-coins mr-1"></i> Receita do mês</div>
            <div class="value">${fmt.money(d.totals.receita_mes)}</div>
            <div class="delta">Payments aprovados em ${new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</div>
          </div>
        </div>

        <!-- ===== Saúde do lifecycle ===== -->
        <div class="master-card lifecycle-health" style="margin-bottom:24px;cursor:pointer;" onclick="masterNavigate('jobs')">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
            <div>
              <h3 style="font-size:.95rem;font-weight:700;color:#fff;margin:0 0 4px 0;">
                <i class="fas fa-robot mr-1" style="color:#a78bfa"></i> Saúde do Lifecycle
              </h3>
              <div style="font-size:.78rem;color:#94a3b8;">${lcTotal === 0 ? 'Tudo em ordem — nenhuma ação pendente.' : `${lcTotal} empresa(s) precisarão ser processadas no próximo ciclo.`}</div>
            </div>
            <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;">
              <div class="lc-mini" style="border-color:${lcWarn ? '#60a5fa' : '#334155'};">
                <i class="fas fa-bullhorn" style="color:#60a5fa"></i>
                <strong>${lcWarn}</strong>
                <span>avisos</span>
              </div>
              <div class="lc-mini" style="border-color:${lcExpire ? '#fbbf24' : '#334155'};">
                <i class="fas fa-hourglass-end" style="color:#fbbf24"></i>
                <strong>${lcExpire}</strong>
                <span>trials</span>
              </div>
              <div class="lc-mini" style="border-color:${lcMark ? '#f97316' : '#334155'};">
                <i class="fas fa-clock" style="color:#f97316"></i>
                <strong>${lcMark}</strong>
                <span>atraso</span>
              </div>
              <div class="lc-mini" style="border-color:${lcBlock ? '#f87171' : '#334155'};">
                <i class="fas fa-lock" style="color:#f87171"></i>
                <strong>${lcBlock}</strong>
                <span>bloqueio</span>
              </div>
              <i class="fas fa-chevron-right" style="color:#64748b;font-size:1rem;"></i>
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:24px;">
          <div class="master-card">
            <h3 style="font-size:.95rem;font-weight:700;color:#fff;margin-bottom:14px;"><i class="fas fa-layer-group mr-1" style="color:#a78bfa"></i> Distribuição por plano</h3>
            <table class="master-table" style="background:transparent;">
              <thead><tr><th>Plano</th><th style="text-align:right;">Empresas</th></tr></thead>
              <tbody>${(d.por_plano || []).map(p => `
                <tr><td><strong>${p.nome}</strong> <span style="color:#64748b;font-size:.75rem;">(${p.codigo})</span></td><td style="text-align:right;font-weight:700;">${fmt.int(p.qtd)}</td></tr>
              `).join('')}</tbody>
            </table>
          </div>
          <div class="master-card">
            <h3 style="font-size:.95rem;font-weight:700;color:#fff;margin-bottom:14px;"><i class="fas fa-circle-check mr-1" style="color:#34d399"></i> Empresas por status</h3>
            <table class="master-table" style="background:transparent;">
              <thead><tr><th>Status</th><th style="text-align:right;">Quantidade</th></tr></thead>
              <tbody>${(d.por_status || []).map(s => `
                <tr><td><span class="master-badge ${s.status}">${s.status}</span></td><td style="text-align:right;font-weight:700;">${fmt.int(s.qtd)}</td></tr>
              `).join('')}</tbody>
            </table>
          </div>
        </div>

        <div class="master-card">
          <h3 style="font-size:.95rem;font-weight:700;color:#fff;margin-bottom:14px;"><i class="fas fa-clock-rotate-left mr-1" style="color:#60a5fa"></i> Últimas empresas (30 dias)</h3>
          ${(d.ultimas || []).length === 0
            ? '<div class="master-empty"><i class="fas fa-folder-open"></i><p>Nenhuma empresa cadastrada nos últimos 30 dias.</p></div>'
            : `<table class="master-table" style="background:transparent;">
                <thead><tr><th>Empresa</th><th>Slug</th><th>Plano</th><th>Status</th><th>Criada</th><th></th></tr></thead>
                <tbody>${(d.ultimas || []).map(e => `
                  <tr>
                    <td><strong>${e.nome}</strong></td>
                    <td><code style="color:#94a3b8;font-size:.8rem;">${e.slug || '—'}</code></td>
                    <td>${e.plano}</td>
                    <td><span class="master-badge ${e.status}">${e.status}</span></td>
                    <td style="font-size:.8rem;color:#94a3b8;">${fmt.datetime(e.dt_criacao)}</td>
                    <td style="text-align:right;"><button class="master-btn master-btn-secondary master-btn-icon" onclick="masterNavigate('empresas/${e.id_empresa}')"><i class="fas fa-eye"></i> Ver</button></td>
                  </tr>`).join('')}
                </tbody>
              </table>`}
        </div>
      `;
    } catch (e) {
      main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
    }
  }

  /* ============================================================
   * TELA: EMPRESAS (lista)
   * ============================================================ */
  async function viewEmpresas() {
    const main = $('#m-main');
    main.innerHTML = '<div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando empresas…</div>';
    try {
      const [r, planosR] = await Promise.all([
        api('get', '/master/empresas'),
        api('get', '/master/plans'),
      ]);
      const empresas = r.data || [];
      const planos   = planosR.data || [];

      // KPIs rápidos
      const kpis = {
        total:     empresas.length,
        ativas:    empresas.filter((e) => e.status === 'ativa').length,
        trial:     empresas.filter((e) => e.status === 'trial').length,
        suspensas: empresas.filter((e) => e.status === 'suspensa').length,
        bloqueadas: empresas.filter((e) => e.bloqueada_em).length,
      };

      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2>Empresas (${empresas.length})</h2>
            <div class="subtitle">Cadastro, planos e status de todas as empresas-clientes</div>
          </div>
          <button class="master-btn master-btn-primary" onclick="masterNavigate('empresas/nova')"><i class="fas fa-plus"></i> Cadastrar empresa</button>
        </div>

        <div class="master-kpi" style="grid-template-columns:repeat(5, minmax(0,1fr));">
          <div class="master-card"><div class="label">Total</div><div class="value">${kpis.total}</div></div>
          <div class="master-card"><div class="label" style="color:#34d399;">Ativas</div><div class="value">${kpis.ativas}</div></div>
          <div class="master-card"><div class="label" style="color:#60a5fa;">Em trial</div><div class="value">${kpis.trial}</div></div>
          <div class="master-card"><div class="label" style="color:#fbbf24;">Suspensas</div><div class="value">${kpis.suspensas}</div></div>
          <div class="master-card"><div class="label" style="color:#f87171;">Bloqueadas</div><div class="value">${kpis.bloqueadas}</div></div>
        </div>

        <div class="m-emp-filters">
          <input class="master-input" id="m-search" placeholder="🔎 Buscar por nome, CNPJ ou slug…" />
          <select class="master-select" id="m-status-filter">
            <option value="">Todos os status</option>
            <option value="ativa">Ativas</option>
            <option value="trial">Trial</option>
            <option value="suspensa">Suspensas</option>
            <option value="cancelada">Canceladas</option>
          </select>
          <select class="master-select" id="m-plano-filter">
            <option value="">Todos os planos</option>
            ${planos.map((p) => `<option value="${p.id_plano}">${p.nome}</option>`).join('')}
          </select>
          <select class="master-select" id="m-bloq-filter">
            <option value="">Bloqueio: todas</option>
            <option value="bloq">Apenas bloqueadas</option>
            <option value="ok">Apenas não-bloqueadas</option>
          </select>
        </div>

        <div class="master-card" style="padding:0;overflow:hidden;">
          <table class="master-table">
            <thead><tr>
              <th>Empresa</th>
              <th>Plano</th>
              <th>Status</th>
              <th>Trial / Vencimento</th>
              <th style="text-align:right;">Usuários</th>
              <th style="text-align:right;">Remessas</th>
              <th>Criada</th>
              <th style="text-align:right;">Ações</th>
            </tr></thead>
            <tbody id="m-tbody">
              ${renderEmpresasRows(empresas)}
            </tbody>
          </table>
        </div>
      `;
      // Filtros client-side
      const search   = $('#m-search'),
            statusF  = $('#m-status-filter'),
            planoF   = $('#m-plano-filter'),
            bloqF    = $('#m-bloq-filter'),
            tbody    = $('#m-tbody');
      function applyFilter() {
        const q = (search.value || '').toLowerCase();
        const st = statusF.value;
        const pl = planoF.value;
        const bq = bloqF.value;
        const filt = empresas.filter((e) => {
          const matchQ = !q || [e.nome, e.cnpj, e.slug].some((x) => String(x || '').toLowerCase().includes(q));
          const matchS = !st || e.status === st;
          const matchP = !pl || String(e.id_plano) === String(pl);
          const matchB = !bq || (bq === 'bloq' ? !!e.bloqueada_em : !e.bloqueada_em);
          return matchQ && matchS && matchP && matchB;
        });
        tbody.innerHTML = renderEmpresasRows(filt);
      }
      search.oninput  = applyFilter;
      statusF.onchange = applyFilter;
      planoF.onchange  = applyFilter;
      bloqF.onchange   = applyFilter;
    } catch (e) {
      main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
    }
  }

  // Calcula dias restantes de trial (negativo se já venceu)
  function diasParaTrial(trial_ate) {
    if (!trial_ate) return null;
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const t = new Date(trial_ate); t.setHours(0,0,0,0);
    return Math.round((t.getTime() - hoje.getTime()) / 86400000);
  }

  function renderEmpresasRows(list) {
    if (!list.length) return `<tr><td colspan="8"><div class="master-empty"><i class="fas fa-folder-open"></i><p>Nenhuma empresa encontrada.</p></div></td></tr>`;
    return list.map((e) => {
      const blocked = e.bloqueada_em ? `<span class="master-badge bloqueada" title="${e.motivo_bloqueio || ''}"><i class="fas fa-lock"></i> bloqueada</span>` : '';
      let trialCell = '<span style="color:#64748b;">—</span>';
      if (e.trial_ate) {
        const dias = diasParaTrial(e.trial_ate);
        if (dias === null) trialCell = '—';
        else if (dias < 0) trialCell = `<span class="master-badge cancelada" title="Trial venceu em ${fmt.date(e.trial_ate)}"><i class="fas fa-times-circle"></i> venceu há ${Math.abs(dias)}d</span>`;
        else if (dias <= 3) trialCell = `<span class="master-badge trial" style="background:rgba(251,191,36,.18);color:#fbbf24;" title="${fmt.date(e.trial_ate)}"><i class="fas fa-exclamation-triangle"></i> vence em ${dias}d</span>`;
        else trialCell = `<span class="master-badge trial" title="${fmt.date(e.trial_ate)}"><i class="fas fa-clock"></i> ${dias}d</span>`;
      }
      return `
      <tr>
        <td>
          <div style="font-weight:700;color:#fff;">${e.nome}</div>
          <div style="font-size:.75rem;color:#94a3b8;">${e.cnpj || '—'} · <code>${e.slug || ''}</code> ${blocked}</div>
        </td>
        <td>
          <div style="font-weight:600;">${e.plano_nome || e.plano || '—'}</div>
          <div style="font-size:.75rem;color:#94a3b8;">${e.plano_preco ? fmt.money(e.plano_preco) + '/mês' : ''}</div>
        </td>
        <td><span class="master-badge ${e.status}">${e.status}</span></td>
        <td>${trialCell}</td>
        <td style="text-align:right;font-weight:600;">${fmt.int(e.qtd_usuarios)}</td>
        <td style="text-align:right;font-weight:600;">${fmt.int(e.qtd_remessas)}</td>
        <td style="font-size:.8rem;color:#94a3b8;">${fmt.date(e.dt_criacao)}</td>
        <td style="text-align:right;">
          <button class="master-btn master-btn-secondary master-btn-icon" onclick="masterNavigate('empresas/${e.id_empresa}')" title="Detalhes"><i class="fas fa-eye"></i></button>
        </td>
      </tr>`;
    }).join('');
  }

  /* ============================================================
   * TELA: NOVA EMPRESA (formulário)
   * ============================================================ */
  async function viewNovaEmpresa() {
    const main = $('#m-main');
    main.innerHTML = '<div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando formulário…</div>';
    try {
      const r = await api('get', '/master/plans');
      const planos = (r.data || []).filter((p) => p.codigo !== 'trial' && p.ativo !== 0);
      // Plano padrão sugerido: 'starter' se existir
      const planoStarter = planos.find((p) => p.codigo === 'starter');
      const defaultPlanoId = planoStarter ? planoStarter.id_plano : (planos[0]?.id_plano || '');
      const defaultTrial = planoStarter?.trial_dias ?? 30;

      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2><i class="fas fa-plus-circle mr-2" style="color:#a78bfa"></i> Cadastrar nova empresa</h2>
            <div class="subtitle">Empresa + usuário administrador serão criados automaticamente. Uma senha temporária será gerada.</div>
          </div>
          <button class="master-btn master-btn-secondary" onclick="masterNavigate('empresas')"><i class="fas fa-arrow-left"></i> Voltar</button>
        </div>

        <div class="master-card" style="max-width:820px;">
          <form id="m-new-emp" class="master-form">

            <!-- ===== Dados da empresa ===== -->
            <h4 class="master-form-section"><i class="fas fa-building mr-1" style="color:#60a5fa"></i> Dados da empresa</h4>
            <div class="grid-2">
              <div>
                <label>Nome da empresa *</label>
                <input class="master-input" name="nome" required placeholder="Confecção XYZ LTDA" maxlength="100" />
              </div>
              <div>
                <label>CNPJ</label>
                <input class="master-input" name="cnpj" placeholder="00.000.000/0000-00" maxlength="20" />
              </div>
            </div>
            <div class="grid-2">
              <div>
                <label>E-mail de contato</label>
                <input class="master-input" name="email_contato" type="email" placeholder="contato@empresa.com" />
              </div>
              <div>
                <label>Telefone</label>
                <input class="master-input" name="telefone" placeholder="(00) 00000-0000" />
              </div>
            </div>
            <div class="grid-3">
              <div>
                <label>Cidade</label>
                <input class="master-input" name="cidade" />
              </div>
              <div>
                <label>UF</label>
                <input class="master-input" name="uf" maxlength="2" style="text-transform:uppercase;" />
              </div>
              <div>
                <label>CEP</label>
                <input class="master-input" name="cep" maxlength="10" />
              </div>
            </div>
            <div>
              <label>Endereço</label>
              <input class="master-input" name="endereco" placeholder="Rua, número, bairro" />
            </div>

            <!-- ===== Usuário admin (auto-criação) ===== -->
            <h4 class="master-form-section"><i class="fas fa-user-shield mr-1" style="color:#34d399"></i> Usuário administrador da empresa</h4>
            <div class="master-info-box">
              <i class="fas fa-info-circle"></i>
              Este usuário será criado automaticamente com perfil <strong>admin (owner)</strong> e uma senha temporária. No primeiro login ele será obrigado a trocá-la.
            </div>
            <div class="grid-2">
              <div>
                <label>Nome do administrador *</label>
                <input class="master-input" name="admin_nome" required placeholder="João Silva" maxlength="80" />
              </div>
              <div>
                <label>E-mail do administrador *</label>
                <input class="master-input" name="admin_email" type="email" required placeholder="joao@empresa.com" />
              </div>
            </div>
            <div class="grid-2">
              <div>
                <label>Login (opcional)</label>
                <input class="master-input" name="admin_login" placeholder="auto-gerado a partir do e-mail" maxlength="20"
                       pattern="[a-zA-Z0-9._-]+" title="Apenas letras, números, ponto, hífen ou underscore" />
              </div>
              <div>
                <label>Telefone direto</label>
                <input class="master-input" name="admin_telefone" placeholder="(00) 00000-0000" />
              </div>
            </div>

            <!-- ===== Plano e ciclo ===== -->
            <h4 class="master-form-section"><i class="fas fa-layer-group mr-1" style="color:#a78bfa"></i> Plano e período</h4>
            <div class="grid-2">
              <div>
                <label>Plano *</label>
                <select class="master-select" name="id_plano" required>
                  ${planos.map((p) => `<option value="${p.id_plano}" ${p.id_plano === defaultPlanoId ? 'selected' : ''}>${p.nome} — ${fmt.money(p.preco_mensal)}/mês</option>`).join('')}
                </select>
              </div>
              <div>
                <label>Dias de trial (0 = inicia já paga)</label>
                <input class="master-input" name="trial_dias" type="number" min="0" max="60" value="${defaultTrial}" />
              </div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;">
              <button type="button" class="master-btn master-btn-secondary" onclick="masterNavigate('empresas')">Cancelar</button>
              <button type="submit" class="master-btn master-btn-primary"><i class="fas fa-check"></i> Cadastrar empresa</button>
            </div>
          </form>
        </div>
      `;

      $('#m-new-emp').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const data = {};
        ['nome','cnpj','email_contato','telefone','cidade','uf','cep','endereco',
         'admin_nome','admin_email','admin_login','admin_telefone'
        ].forEach((k) => { data[k] = (f[k]?.value || '').trim() || null; });
        data.id_plano = Number(f.id_plano.value);
        data.trial_dias = Number(f.trial_dias.value || 0);

        // Validação client-side
        if (!data.admin_nome || !data.admin_email) {
          toast('Informe nome e e-mail do administrador.', 'error');
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.admin_email)) {
          toast('E-mail do administrador é inválido.', 'error');
          return;
        }

        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cadastrando…';
        try {
          const r = await api('post', '/master/empresas', data);
          // Modal one-time com a senha temporária (não vai persistir nem ser logada)
          openTempPasswordModal({
            empresaNome: data.nome,
            login: r.data.admin?.login,
            senha: r.data.admin?.senha_temp,
            email: data.admin_email,
            onClose: () => navigate('empresas/' + r.data.id_empresa),
          });
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Cadastrar empresa';
        }
      };
    } catch (e) {
      main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
    }
  }

  /* ============================================================
   * MODAL ONE-TIME: senha temporária recém-gerada
   * Exibe credenciais do admin após criar empresa ou resetar senha.
   * Inclui copy-to-clipboard para login, senha e bloco completo.
   * ============================================================ */
  function openTempPasswordModal({ empresaNome, login, senha, email, titulo, subtitulo, onClose }) {
    const t  = titulo || 'Empresa criada com sucesso!';
    const st = subtitulo || `Senha temporária gerada para <strong style="color:#fff;">${empresaNome || 'a empresa'}</strong>.`;
    const blockText = `Empresa: ${empresaNome || ''}\nLogin: ${login || ''}\nSenha temporária: ${senha || ''}${email ? `\nE-mail: ${email}` : ''}`;

    const m = modal(`
      <h3 style="display:flex;align-items:center;gap:10px;">
        <i class="fas fa-key" style="color:#fbbf24;"></i> ${t}
      </h3>
      <p style="color:#cbd5e1;font-size:.92rem;line-height:1.5;margin-bottom:14px;">${st}</p>

      <div class="m-pwd-box">
        <div class="m-pwd-row">
          <div class="m-pwd-label">Login</div>
          <div class="m-pwd-value" id="m-pwd-login">${login || '—'}</div>
          <button type="button" class="m-pwd-copy" data-copy="login" title="Copiar login"><i class="fas fa-copy"></i></button>
        </div>
        <div class="m-pwd-row">
          <div class="m-pwd-label">Senha temporária</div>
          <div class="m-pwd-value m-pwd-secret" id="m-pwd-senha">${senha || '—'}</div>
          <button type="button" class="m-pwd-copy" data-copy="senha" title="Copiar senha"><i class="fas fa-copy"></i></button>
        </div>
        ${email ? `
        <div class="m-pwd-row">
          <div class="m-pwd-label">E-mail</div>
          <div class="m-pwd-value">${email}</div>
        </div>` : ''}
      </div>

      <div class="m-pwd-warn">
        <i class="fas fa-exclamation-triangle"></i>
        <div>
          <strong>Atenção:</strong> esta senha será exibida <u>apenas uma vez</u>. Anote ou copie agora.<br/>
          No primeiro login o usuário será obrigado a trocá-la.
        </div>
      </div>

      <div class="actions">
        <button type="button" class="master-btn master-btn-secondary" id="m-pwd-copy-all">
          <i class="fas fa-clipboard"></i> Copiar tudo
        </button>
        <button type="button" class="master-btn master-btn-primary" id="m-pwd-ok">
          <i class="fas fa-check"></i> Anotei, fechar
        </button>
      </div>
    `);

    const close = () => { m.remove(); if (typeof onClose === 'function') onClose(); };

    const copyToClipboard = async (text, label) => {
      try {
        await navigator.clipboard.writeText(text);
        toast((label || 'Texto') + ' copiado!', 'success');
      } catch {
        // Fallback antigo
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); toast((label || 'Texto') + ' copiado!', 'success'); }
        catch { toast('Não foi possível copiar automaticamente.', 'warning'); }
        ta.remove();
      }
    };

    m.querySelectorAll('.m-pwd-copy').forEach((btn) => {
      btn.onclick = () => {
        const what = btn.dataset.copy;
        if (what === 'login') copyToClipboard(login || '', 'Login');
        else if (what === 'senha') copyToClipboard(senha || '', 'Senha');
      };
    });
    m.querySelector('#m-pwd-copy-all').onclick = () => copyToClipboard(blockText, 'Credenciais');
    m.querySelector('#m-pwd-ok').onclick = close;
    // Bloqueia clique fora — usuário PRECISA confirmar (não perder a senha)
    m.onclick = (ev) => { if (ev.target === m) { /* não fecha */ } };
  }

  /* ============================================================
   * TELA: DETALHE DE EMPRESA
   * ============================================================ */
  async function viewEmpresaDetalhe(id) {
    const main = $('#m-main');
    main.innerHTML = '<div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando empresa…</div>';
    try {
      const [det, planosR] = await Promise.all([
        api('get', '/master/empresas/' + id),
        api('get', '/master/plans'),
      ]);
      const e = det.data.empresa;
      const sub = det.data.subscription;
      const stats = det.data.stats || {};
      const payments = det.data.payments || [];
      const owner = det.data.owner || null;
      const planos = (planosR.data || []);

      const blocked = e.bloqueada_em;

      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2>${e.nome} ${blocked ? '<span class="master-badge bloqueada" style="margin-left:8px;font-size:.6rem;"><i class="fas fa-lock"></i> bloqueada</span>' : ''}</h2>
            <div class="subtitle">${e.cnpj || 'sem CNPJ'} · <code>${e.slug || ''}</code> · <span class="master-badge ${e.status}">${e.status}</span></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="master-btn master-btn-secondary" onclick="masterNavigate('empresas')"><i class="fas fa-arrow-left"></i> Voltar</button>
            <button class="master-btn master-btn-secondary" id="m-edit"><i class="fas fa-edit"></i> Editar dados</button>
            <button class="master-btn master-btn-secondary" id="m-trocar-plano"><i class="fas fa-layer-group"></i> Trocar plano</button>
            ${blocked
              ? `<button class="master-btn master-btn-warning" id="m-desbloquear"><i class="fas fa-lock-open"></i> Desbloquear</button>`
              : `<button class="master-btn master-btn-warning" id="m-bloquear" ${id == 1 ? 'disabled style="opacity:.4;cursor:not-allowed"' : ''}><i class="fas fa-lock"></i> Bloquear</button>`
            }
            ${e.status === 'suspensa'
              ? `<button class="master-btn master-btn-primary" id="m-reativar"><i class="fas fa-play"></i> Reativar</button>`
              : `<button class="master-btn master-btn-danger" id="m-suspender" ${id == 1 ? 'disabled style="opacity:.4;cursor:not-allowed"' : ''}><i class="fas fa-pause"></i> Suspender</button>`
            }
          </div>
        </div>

        <div class="master-kpi">
          <div class="master-card">
            <div class="label"><i class="fas fa-users mr-1"></i> Usuários ativos</div>
            <div class="value">${fmt.int(stats.qtd_usuarios)}</div>
          </div>
          <div class="master-card">
            <div class="label"><i class="fas fa-truck mr-1"></i> Remessas</div>
            <div class="value">${fmt.int(stats.qtd_remessas)}</div>
          </div>
          <div class="master-card">
            <div class="label"><i class="fas fa-truck-arrow-right mr-1"></i> Retornos</div>
            <div class="value">${fmt.int(stats.qtd_retornos)}</div>
          </div>
          <div class="master-card">
            <div class="label"><i class="fas fa-handshake mr-1"></i> Terceirizados</div>
            <div class="value">${fmt.int(stats.qtd_terceirizados)}</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:24px;">
          <div class="master-card">
            <h3 style="font-size:.95rem;font-weight:700;color:#fff;margin-bottom:14px;"><i class="fas fa-info-circle mr-1" style="color:#60a5fa"></i> Dados cadastrais</h3>
            <table style="width:100%;font-size:.85rem;">
              <tbody>
                <tr><td style="color:#94a3b8;padding:6px 0;width:130px;">Nome</td><td>${e.nome}</td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">CNPJ</td><td>${e.cnpj || '—'}</td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">Slug</td><td><code>${e.slug || ''}</code></td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">E-mail</td><td>${e.email_contato || '—'}</td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">Telefone</td><td>${e.telefone || '—'}</td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">Cidade/UF</td><td>${e.cidade || '—'} / ${e.uf || '—'}</td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">CEP</td><td>${e.cep || '—'}</td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">Criada em</td><td>${fmt.datetime(e.dt_criacao)}</td></tr>
                ${blocked ? `<tr><td style="color:#fbbf24;padding:6px 0;">Bloqueio</td><td style="color:#fbbf24;">${e.motivo_bloqueio || '—'}<br><small>${fmt.datetime(e.bloqueada_em)}</small></td></tr>` : ''}
              </tbody>
            </table>
          </div>
          <div class="master-card">
            <h3 style="font-size:.95rem;font-weight:700;color:#fff;margin-bottom:14px;"><i class="fas fa-layer-group mr-1" style="color:#a78bfa"></i> Assinatura</h3>
            ${sub ? `
              <table style="width:100%;font-size:.85rem;">
                <tbody>
                  <tr><td style="color:#94a3b8;padding:6px 0;width:160px;">Plano atual</td><td><strong style="color:#fff;">${sub.plano_nome}</strong> <span style="color:#64748b;font-size:.75rem;">(${sub.plano_codigo})</span></td></tr>
                  <tr><td style="color:#94a3b8;padding:6px 0;">Status</td><td><span class="master-badge ${sub.status}">${sub.status}</span></td></tr>
                  <tr><td style="color:#94a3b8;padding:6px 0;">Ciclo</td><td>${sub.ciclo}</td></tr>
                  <tr><td style="color:#94a3b8;padding:6px 0;">Preço aplicado</td><td><strong>${fmt.money(sub.preco_aplicado)}</strong>/mês</td></tr>
                  <tr><td style="color:#94a3b8;padding:6px 0;">Início</td><td>${fmt.date(sub.dt_inicio)}</td></tr>
                  <tr><td style="color:#94a3b8;padding:6px 0;">Próxima cobrança</td><td>${fmt.date(sub.dt_proxima_cobranca)}</td></tr>
                  ${sub.trial_ate ? `<tr><td style="color:#94a3b8;padding:6px 0;">Trial até</td><td>${fmt.date(sub.trial_ate)}</td></tr>` : ''}
                </tbody>
              </table>
            ` : '<div class="master-empty" style="padding:30px;"><i class="fas fa-info-circle"></i><p>Sem assinatura ativa.</p></div>'}
          </div>
        </div>

        <!-- ===== Card: Histórico de transições (sub_logs) ===== -->
        <div class="master-card" style="margin-bottom:18px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h3 style="font-size:.95rem;font-weight:700;color:#fff;margin:0;">
              <i class="fas fa-history mr-1" style="color:#a78bfa"></i> Histórico da assinatura
            </h3>
            <button class="master-btn master-btn-secondary master-btn-sm" id="m-load-sublogs">
              <i class="fas fa-sync mr-1"></i> Carregar
            </button>
          </div>
          <div id="m-sublogs-content" style="font-size:.85rem;color:#94a3b8;">Clique em "Carregar" para ver as transições.</div>
        </div>

        <!-- ===== Card: Administrador (owner) ===== -->
        <div class="master-card" style="margin-bottom:18px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
            <h3 style="font-size:.95rem;font-weight:700;color:#fff;margin:0;">
              <i class="fas fa-user-shield mr-1" style="color:#34d399"></i> Administrador (owner)
            </h3>
            ${owner ? `
              <button class="master-btn master-btn-warning master-btn-sm" id="m-reset-admin">
                <i class="fas fa-key"></i> Resetar senha do admin
              </button>
            ` : ''}
          </div>
          ${owner ? `
            <table style="width:100%;font-size:.85rem;">
              <tbody>
                <tr><td style="color:#94a3b8;padding:6px 0;width:160px;">Nome</td><td><strong style="color:#fff;">${owner.nome || '—'}</strong></td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">Login</td><td><code>${owner.login || '—'}</code></td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">E-mail</td><td>${owner.email || '—'}</td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">Último login</td><td>${owner.ultimo_login ? fmt.datetime(owner.ultimo_login) : '<span style="color:#64748b;">nunca logou</span>'}</td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">Trocar senha?</td><td>${owner.trocar_senha ? '<span class="master-badge trial"><i class="fas fa-clock"></i> aguardando troca</span>' : '<span class="master-badge ativa"><i class="fas fa-check"></i> ok</span>'}</td></tr>
                <tr><td style="color:#94a3b8;padding:6px 0;">Criado em</td><td>${fmt.datetime(owner.dt_criacao)}</td></tr>
              </tbody>
            </table>
          ` : `
            <div class="master-empty" style="padding:24px;">
              <i class="fas fa-exclamation-triangle" style="color:#fbbf24;"></i>
              <p>Esta empresa não tem um usuário <strong>admin (owner)</strong> ativo.</p>
              <p style="font-size:.75rem;color:#94a3b8;">Empresas legadas podem precisar de migração manual.</p>
            </div>
          `}
        </div>

        <div class="master-card">
          <h3 style="font-size:.95rem;font-weight:700;color:#fff;margin-bottom:14px;"><i class="fas fa-receipt mr-1" style="color:#34d399"></i> Histórico de pagamentos (${payments.length})</h3>
          ${payments.length === 0
            ? '<div class="master-empty"><i class="fas fa-folder-open"></i><p>Nenhum pagamento registrado ainda.</p></div>'
            : `<table class="master-table" style="background:transparent;">
                <thead><tr><th>Referência</th><th>Método</th><th>Status</th><th style="text-align:right;">Valor</th><th>Vencimento</th><th>Pagamento</th></tr></thead>
                <tbody>${payments.map((p) => `
                  <tr>
                    <td>${p.dt_referencia || '—'}</td>
                    <td><i class="fas fa-${p.metodo === 'pix' ? 'qrcode' : 'money-bill'} mr-1"></i> ${p.metodo}</td>
                    <td><span class="master-badge ${p.status === 'aprovado' ? 'ativa' : p.status === 'pendente' ? 'trial' : 'cancelada'}">${p.status}</span></td>
                    <td style="text-align:right;font-weight:600;">${fmt.money(p.valor)}</td>
                    <td style="font-size:.8rem;">${fmt.date(p.dt_vencimento)}</td>
                    <td style="font-size:.8rem;">${fmt.date(p.dt_pagamento)}</td>
                  </tr>`).join('')}
                </tbody>
              </table>`}
        </div>
      `;

      // Ações
      const btn = (id) => $('#' + id);
      btn('m-edit')?.addEventListener('click', () => openEditModal(e));
      btn('m-trocar-plano')?.addEventListener('click', () => openTrocarPlanoModal(id, planos, sub?.id_plano));
      btn('m-bloquear')?.addEventListener('click', () => openBloquearModal(id));
      btn('m-desbloquear')?.addEventListener('click', async () => {
        if (!confirm('Confirmar desbloqueio?')) return;
        try { await api('post', `/master/empresas/${id}/desbloquear`); toast('Empresa desbloqueada.', 'success'); viewEmpresaDetalhe(id); }
        catch (err) { toast(err.message, 'error'); }
      });
      btn('m-suspender')?.addEventListener('click', async () => {
        if (!confirm('Suspender a empresa? Os usuários não conseguirão usar o sistema até a reativação.')) return;
        try { await api('post', `/master/empresas/${id}/suspender`); toast('Empresa suspensa.', 'warning'); viewEmpresaDetalhe(id); }
        catch (err) { toast(err.message, 'error'); }
      });
      btn('m-reativar')?.addEventListener('click', async () => {
        if (!confirm('Reativar a empresa?')) return;
        try { await api('post', `/master/empresas/${id}/reativar`); toast('Empresa reativada.', 'success'); viewEmpresaDetalhe(id); }
        catch (err) { toast(err.message, 'error'); }
      });
      // Carregar histórico de sub_logs (lazy: só quando clicar)
      btn('m-load-sublogs')?.addEventListener('click', async () => {
        const target = $('#m-sublogs-content');
        target.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Carregando…';
        try {
          const r = await api('get', `/master/empresas/${id}/sub-logs`);
          const items = r.data?.items || [];
          if (items.length === 0) {
            target.innerHTML = '<div class="master-empty" style="padding:24px;"><i class="fas fa-folder-open"></i><p>Sem transições registradas ainda.</p></div>';
            return;
          }
          const eventColor = {
            criada: '#34d399',
            trial_expirado: '#fbbf24',
            pagamento_atrasado: '#f97316',
            bloqueada: '#f87171',
            reativada: '#10b981',
            troca_plano: '#60a5fa',
            aviso_enviado: '#a78bfa',
            cancelada: '#94a3b8',
          };
          target.innerHTML = `
            <div class="sublogs-timeline">
              ${items.map((l) => {
                const color = eventColor[l.evento] || '#94a3b8';
                const det = l.detalhes && typeof l.detalhes === 'object'
                  ? Object.entries(l.detalhes).map(([k,v]) => `<code>${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}</code>`).join(' · ')
                  : '';
                return `
                  <div class="sublog-item">
                    <div class="sublog-dot" style="background:${color};"></div>
                    <div class="sublog-body">
                      <div class="sublog-head">
                        <strong style="color:#fff;">${l.evento}</strong>
                        ${l.status_antes || l.status_depois ? `<span style="color:#64748b;font-size:.78rem;margin-left:8px;">${l.status_antes || '?'} → <strong>${l.status_depois || '?'}</strong></span>` : ''}
                        <span class="master-badge ${l.origem === 'cron' ? 'trial' : l.origem === 'master' ? 'ativa' : 'pendente'}" style="margin-left:8px;font-size:.65rem;">${l.origem}</span>
                      </div>
                      <div class="sublog-meta">${fmt.datetime(l.dt_criacao)}</div>
                      ${det ? `<div class="sublog-det">${det}</div>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>`;
        } catch (err) {
          target.innerHTML = `<div style="color:#f87171;">${err.message}</div>`;
        }
      });

      // Reset de senha do admin owner
      btn('m-reset-admin')?.addEventListener('click', async () => {
        if (!confirm(
          'Resetar a senha do administrador?\n\n' +
          '• Uma nova senha temporária será gerada\n' +
          '• Todas as sessões ativas do admin serão encerradas\n' +
          '• Ele será obrigado a trocar a senha no próximo login\n\n' +
          'Continuar?'
        )) return;
        try {
          const r = await api('post', `/master/empresas/${id}/reset-admin-senha`);
          openTempPasswordModal({
            empresaNome: e.nome,
            login: r.data.login,
            senha: r.data.senha_temp,
            email: owner?.email || e.email_contato || null,
            titulo: 'Senha do administrador resetada!',
            subtitulo: `Nova senha temporária para <strong style="color:#fff;">${e.nome}</strong>. As sessões anteriores foram encerradas.`,
            onClose: () => viewEmpresaDetalhe(id),
          });
        } catch (err) { toast(err.message, 'error'); }
      });
    } catch (e) {
      main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
    }
  }

  /* ============================================================
   * MODAIS
   * ============================================================ */
  function modal(html) {
    const bg = document.createElement('div');
    bg.className = 'master-modal-bg';
    bg.innerHTML = `<div class="master-modal">${html}</div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
    return bg;
  }

  function openEditModal(e) {
    const m = modal(`
      <h3><i class="fas fa-edit"></i> Editar dados — ${e.nome}</h3>
      <form id="m-edit-form" class="master-form">
        <div class="grid-2">
          <div><label>Nome *</label><input class="master-input" name="nome" value="${e.nome || ''}" required /></div>
          <div><label>CNPJ</label><input class="master-input" name="cnpj" value="${e.cnpj || ''}" /></div>
        </div>
        <div class="grid-2">
          <div><label>E-mail</label><input class="master-input" name="email_contato" type="email" value="${e.email_contato || ''}" /></div>
          <div><label>Telefone</label><input class="master-input" name="telefone" value="${e.telefone || ''}" /></div>
        </div>
        <div class="grid-3">
          <div><label>Cidade</label><input class="master-input" name="cidade" value="${e.cidade || ''}" /></div>
          <div><label>UF</label><input class="master-input" name="uf" maxlength="2" value="${e.uf || ''}" /></div>
          <div><label>CEP</label><input class="master-input" name="cep" value="${e.cep || ''}" /></div>
        </div>
        <div><label>Endereço</label><input class="master-input" name="endereco" value="${e.endereco || ''}" /></div>
        <div class="actions">
          <button type="button" class="master-btn master-btn-secondary" data-close>Cancelar</button>
          <button type="submit" class="master-btn master-btn-primary"><i class="fas fa-check"></i> Salvar</button>
        </div>
      </form>
    `);
    m.querySelector('[data-close]').onclick = () => m.remove();
    m.querySelector('#m-edit-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const data = {};
      ['nome','cnpj','email_contato','telefone','cidade','uf','cep','endereco'].forEach((k) => { data[k] = f[k].value.trim() || null; });
      try {
        await api('put', '/master/empresas/' + e.id_empresa, data);
        toast('Dados salvos.', 'success');
        m.remove();
        viewEmpresaDetalhe(e.id_empresa);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  function openTrocarPlanoModal(id, planos, atualPlanoId) {
    const m = modal(`
      <h3><i class="fas fa-layer-group"></i> Trocar plano</h3>
      <p style="color:#94a3b8;font-size:.85rem;margin-bottom:14px;">A assinatura atual será cancelada e uma nova será criada com o plano selecionado. O preço aplicado será o vigente no plano.</p>
      <form id="m-tp-form" class="master-form">
        <div>
          <label>Novo plano</label>
          <select class="master-select" name="id_plano" required>
            ${planos.map((p) => `<option value="${p.id_plano}" ${p.id_plano == atualPlanoId ? 'selected' : ''}>${p.nome} — ${fmt.money(p.preco_mensal)}/mês (${p.codigo})</option>`).join('')}
          </select>
        </div>
        <div class="actions">
          <button type="button" class="master-btn master-btn-secondary" data-close>Cancelar</button>
          <button type="submit" class="master-btn master-btn-primary"><i class="fas fa-check"></i> Trocar plano</button>
        </div>
      </form>
    `);
    m.querySelector('[data-close]').onclick = () => m.remove();
    m.querySelector('#m-tp-form').onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api('post', `/master/empresas/${id}/trocar-plano`, { id_plano: Number(ev.target.id_plano.value) });
        toast('Plano alterado com sucesso.', 'success');
        m.remove();
        viewEmpresaDetalhe(id);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  function openBloquearModal(id) {
    const m = modal(`
      <h3><i class="fas fa-lock" style="color:#fbbf24"></i> Bloquear empresa</h3>
      <p style="color:#94a3b8;font-size:.85rem;margin-bottom:14px;">A empresa não conseguirá acessar o sistema até ser desbloqueada. Forneça um motivo (visível ao dono no login).</p>
      <form id="m-bl-form" class="master-form">
        <div>
          <label>Motivo</label>
          <textarea class="master-textarea" name="motivo" rows="3" required placeholder="Ex: Inadimplência recorrente, fraude detectada, etc."></textarea>
        </div>
        <div class="actions">
          <button type="button" class="master-btn master-btn-secondary" data-close>Cancelar</button>
          <button type="submit" class="master-btn master-btn-warning"><i class="fas fa-lock"></i> Bloquear</button>
        </div>
      </form>
    `);
    m.querySelector('[data-close]').onclick = () => m.remove();
    m.querySelector('#m-bl-form').onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api('post', `/master/empresas/${id}/bloquear`, { motivo: ev.target.motivo.value.trim() });
        toast('Empresa bloqueada.', 'warning');
        m.remove();
        viewEmpresaDetalhe(id);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  /* ============================================================
   * TELA: PLANOS — CRUD completo (SPRINT A)
   * Lista em cards + modal de criação/edição + duplicar + toggle + excluir
   * ============================================================ */
  // Lista de features disponíveis (mapa feature → label/ícone para UI)
  const PLAN_FEATURES = [
    { key: 'feat_dashboard',           label: 'Dashboard',              icon: 'fa-chart-line' },
    { key: 'feat_romaneio',            label: 'Romaneio',               icon: 'fa-print' },
    { key: 'feat_relatorios_avancados',label: 'Relatórios avançados',   icon: 'fa-chart-pie' },
    { key: 'feat_export_excel',        label: 'Exportar Excel',         icon: 'fa-file-excel' },
    { key: 'feat_export_pdf',          label: 'Exportar PDF',           icon: 'fa-file-pdf' },
    { key: 'feat_financeiro',          label: 'Financeiro',             icon: 'fa-dollar-sign' },
    { key: 'feat_audit_log',           label: 'Auditoria',              icon: 'fa-shield-alt' },
    { key: 'feat_api',                 label: 'API REST',               icon: 'fa-code' },
    { key: 'feat_backup',              label: 'Backup',                 icon: 'fa-cloud-upload-alt' },
    { key: 'feat_multi_filial',        label: 'Multi-filial',           icon: 'fa-building' },
    { key: 'feat_personalizacao',      label: 'Personalização',         icon: 'fa-palette' },
    { key: 'feat_suporte_prioritario', label: 'Suporte prioritário',    icon: 'fa-headset' },
  ];

  function unlimited(v) { return v < 0 ? '∞' : fmt.int(v); }

  async function viewPlanos() {
    const main = $('#m-main');
    main.innerHTML = '<div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando planos…</div>';
    try {
      const r = await api('get', '/master/plans?incluir_inativos=1');
      const planos = r.data || [];
      const ativos   = planos.filter((p) => p.ativo);
      const inativos = planos.filter((p) => !p.ativo);

      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2><i class="fas fa-layer-group mr-2" style="color:#a78bfa"></i> Gerenciamento de Planos (${planos.length})</h2>
            <div class="subtitle">${ativos.length} ativo(s) · ${inativos.length} inativo(s) · ${planos.filter((p) => p.destaque).length} em destaque</div>
          </div>
          <button class="master-btn master-btn-primary" onclick="masterNavigate('planos/novo')"><i class="fas fa-plus"></i> Novo plano</button>
        </div>

        <div class="plans-grid">
          ${planos.map(renderPlanCard).join('') || '<div class="master-empty"><i class="fas fa-layer-group"></i><p>Nenhum plano cadastrado.</p></div>'}
        </div>
      `;

      // Bind ações dos cards
      $$('.plan-card-action').forEach((btn) => {
        btn.onclick = (ev) => {
          ev.stopPropagation();
          const id = +btn.dataset.id;
          const action = btn.dataset.action;
          if (action === 'edit')      return navigate('planos/' + id);
          if (action === 'duplicate') return duplicarPlano(id);
          if (action === 'toggle')    return toggleAtivoPlano(id);
          if (action === 'delete')    return excluirPlano(id);
        };
      });
    } catch (e) {
      main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
    }
  }

  function renderPlanCard(p) {
    const featsAtivas = PLAN_FEATURES.filter((f) => p[f.key]);
    const limites = [
      { lbl: 'Usuários',      v: unlimited(p.max_usuarios) },
      { lbl: 'Remessas/mês',  v: unlimited(p.max_remessas_mes) },
      { lbl: 'Terceirizados', v: unlimited(p.max_terceirizados) },
      { lbl: 'Storage',       v: p.max_storage_mb < 0 ? '∞' : (p.max_storage_mb + ' MB') },
    ];
    const isInativo = !p.ativo;
    return `
      <div class="plan-card ${isInativo ? 'inativo' : ''} ${p.destaque ? 'destaque' : ''}" style="border-top-color:${p.cor || '#7c3aed'};">
        <div class="plan-card-header">
          <div class="plan-card-title">
            ${p.destaque ? '<span class="plan-badge-destaque"><i class="fas fa-star"></i> Destaque</span>' : ''}
            <h3 style="color:${p.cor || '#fff'};">${p.nome}</h3>
            <code class="plan-codigo">${p.codigo}</code>
          </div>
          ${isInativo ? '<span class="plan-status-inativo">Inativo</span>' : ''}
        </div>

        <div class="plan-price">
          <span class="currency">R$</span>
          <span class="value">${Number(p.preco_mensal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span class="period">/mês</span>
        </div>

        ${p.descricao ? `<p class="plan-desc">${p.descricao}</p>` : ''}

        <div class="plan-limites">
          ${limites.map((l) => `
            <div class="plan-limite"><span class="lbl">${l.lbl}</span><span class="val">${l.v}</span></div>
          `).join('')}
        </div>

        <div class="plan-features">
          ${featsAtivas.length === 0
            ? '<span style="color:#64748b;font-size:.75rem;">Nenhuma feature liberada.</span>'
            : featsAtivas.map((f) => `<span class="plan-feat-chip" title="${f.label}"><i class="fas ${f.icon}"></i> ${f.label}</span>`).join('')
          }
        </div>

        <div class="plan-meta">
          <span><i class="fas fa-clock"></i> Trial ${p.trial_dias || 0}d</span>
          <span>${p.visivel ? '<i class="fas fa-eye" style="color:#34d399"></i> Visível' : '<i class="fas fa-eye-slash"></i> Oculto'}</span>
        </div>

        <div class="plan-actions">
          <button class="master-btn master-btn-secondary plan-card-action" data-id="${p.id_plano}" data-action="edit" title="Editar"><i class="fas fa-edit"></i> Editar</button>
          <button class="master-btn master-btn-secondary plan-card-action" data-id="${p.id_plano}" data-action="duplicate" title="Duplicar"><i class="fas fa-copy"></i></button>
          <button class="master-btn master-btn-secondary plan-card-action" data-id="${p.id_plano}" data-action="toggle" title="${isInativo ? 'Ativar' : 'Desativar'}"><i class="fas fa-${isInativo ? 'play' : 'pause'}"></i></button>
          <button class="master-btn master-btn-secondary plan-card-action" data-id="${p.id_plano}" data-action="delete" title="Excluir" style="color:#f87171;"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `;
  }

  async function duplicarPlano(id) {
    if (!confirm('Duplicar este plano? A cópia ficará oculta até que você ajuste e ative.')) return;
    try {
      const r = await api('post', `/master/plans/${id}/duplicar`);
      toast(`Plano duplicado: ${r.data.nome}`, 'success');
      viewPlanos();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function toggleAtivoPlano(id) {
    try {
      const r = await api('post', `/master/plans/${id}/toggle`);
      toast(r.data.ativo ? 'Plano ativado.' : 'Plano desativado.', 'success');
      viewPlanos();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function excluirPlano(id) {
    if (!confirm('Excluir este plano DEFINITIVAMENTE? Esta ação só funciona se nenhuma empresa/assinatura o utilizar. Em vez disso, prefira desativar.')) return;
    try {
      await api('delete', `/master/plans/${id}`);
      toast('Plano excluído.', 'success');
      viewPlanos();
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ============================================================
   * TELA: NOVO/EDITAR PLANO (formulário completo)
   * ============================================================ */
  async function viewPlanoForm(id) {
    const main = $('#m-main');
    const isEdit = !!id;
    main.innerHTML = '<div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando formulário…</div>';

    let plano = {
      codigo: '', nome: '', descricao: '', preco_mensal: 0,
      max_usuarios: 5, max_remessas_mes: 500, max_terceirizados: 50, max_storage_mb: 1000,
      cor: '#7c3aed', destaque: 0, ativo: 1, visivel: 1, trial_dias: 30, ordem: 0,
      feat_dashboard: 1, feat_romaneio: 1, feat_relatorios_avancados: 0, feat_export_excel: 1,
      feat_export_pdf: 1, feat_financeiro: 1, feat_audit_log: 0, feat_api: 0,
      feat_backup: 0, feat_multi_filial: 0, feat_personalizacao: 0, feat_suporte_prioritario: 0,
    };
    let uso = { empresas: 0, assinaturas_ativas: 0 };

    if (isEdit) {
      try {
        const r = await api('get', `/master/plans/${id}`);
        plano = r.data;
        uso = plano._uso || uso;
      } catch (e) {
        main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
        return;
      }
    }

    main.innerHTML = `
      <div class="master-header">
        <div>
          <h2><i class="fas fa-${isEdit ? 'edit' : 'plus-circle'} mr-2" style="color:${plano.cor || '#a78bfa'}"></i> ${isEdit ? 'Editar plano' : 'Novo plano'}</h2>
          <div class="subtitle">${isEdit ? `<code>${plano.codigo}</code> · ${uso.empresas} empresa(s) · ${uso.assinaturas_ativas} assinatura(s) ativa(s)` : 'Defina os limites, preço e features liberadas.'}</div>
        </div>
        <button class="master-btn master-btn-secondary" onclick="masterNavigate('planos')"><i class="fas fa-arrow-left"></i> Voltar</button>
      </div>

      <form id="m-plan-form" class="plan-form-grid">
        <!-- Coluna 1: dados básicos -->
        <div class="master-card plan-form-section">
          <h4 class="plan-form-title"><i class="fas fa-tag"></i> Identificação</h4>
          <div class="grid-2">
            <div>
              <label>Nome do plano *</label>
              <input class="master-input" name="nome" required value="${plano.nome}" placeholder="Profissional" />
            </div>
            <div>
              <label>Código (identificador) *</label>
              <input class="master-input" name="codigo" required value="${plano.codigo}" pattern="[a-z0-9_\\-]+" placeholder="profissional" ${isEdit && (uso.empresas > 0 || uso.assinaturas_ativas > 0) ? 'title="Cuidado: empresas usam este plano"' : ''} />
            </div>
          </div>
          <div>
            <label>Descrição</label>
            <textarea class="master-input" name="descricao" rows="2" placeholder="Para confecções em crescimento…">${plano.descricao || ''}</textarea>
          </div>
          <div class="grid-3">
            <div>
              <label>Preço mensal (R$) *</label>
              <input class="master-input" name="preco_mensal" type="number" min="0" step="0.01" required value="${plano.preco_mensal}" />
            </div>
            <div>
              <label>Trial (dias)</label>
              <input class="master-input" name="trial_dias" type="number" min="0" max="365" value="${plano.trial_dias}" />
            </div>
            <div>
              <label>Cor do plano</label>
              <input class="master-input plan-color-input" name="cor" type="color" value="${plano.cor || '#7c3aed'}" />
            </div>
          </div>
        </div>

        <!-- Coluna 2: limites -->
        <div class="master-card plan-form-section">
          <h4 class="plan-form-title"><i class="fas fa-sliders-h"></i> Limites (use -1 = ilimitado)</h4>
          <div class="grid-2">
            <div>
              <label>Usuários</label>
              <input class="master-input" name="max_usuarios" type="number" min="-1" value="${plano.max_usuarios}" />
            </div>
            <div>
              <label>Remessas / mês</label>
              <input class="master-input" name="max_remessas_mes" type="number" min="-1" value="${plano.max_remessas_mes}" />
            </div>
            <div>
              <label>Terceirizados</label>
              <input class="master-input" name="max_terceirizados" type="number" min="-1" value="${plano.max_terceirizados}" />
            </div>
            <div>
              <label>Armazenamento (MB)</label>
              <input class="master-input" name="max_storage_mb" type="number" min="-1" value="${plano.max_storage_mb}" />
            </div>
          </div>
        </div>

        <!-- Coluna larga: features -->
        <div class="master-card plan-form-section plan-form-full">
          <h4 class="plan-form-title"><i class="fas fa-check-double"></i> Funcionalidades liberadas</h4>
          <div class="plan-feats-grid">
            ${PLAN_FEATURES.map((f) => `
              <label class="plan-feat-toggle">
                <input type="checkbox" name="${f.key}" ${plano[f.key] ? 'checked' : ''} />
                <span class="plan-feat-content">
                  <i class="fas ${f.icon}"></i>
                  <span class="plan-feat-label">${f.label}</span>
                </span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Visibilidade / status -->
        <div class="master-card plan-form-section plan-form-full">
          <h4 class="plan-form-title"><i class="fas fa-eye"></i> Status & Visibilidade</h4>
          <div class="grid-3">
            <label class="plan-toggle-row">
              <input type="checkbox" name="ativo" ${plano.ativo ? 'checked' : ''} />
              <div><strong>Ativo</strong><span>Plano disponível para uso</span></div>
            </label>
            <label class="plan-toggle-row">
              <input type="checkbox" name="visivel" ${plano.visivel ? 'checked' : ''} />
              <div><strong>Visível no catálogo</strong><span>Aparece para clientes/checkout</span></div>
            </label>
            <label class="plan-toggle-row">
              <input type="checkbox" name="destaque" ${plano.destaque ? 'checked' : ''} />
              <div><strong>Destaque</strong><span>Marca como "mais popular"</span></div>
            </label>
          </div>
          <div style="margin-top:14px;max-width:200px;">
            <label>Ordem (menor primeiro)</label>
            <input class="master-input" name="ordem" type="number" min="0" value="${plano.ordem}" />
          </div>
        </div>

        <div class="plan-form-actions">
          <button type="button" class="master-btn master-btn-secondary" onclick="masterNavigate('planos')"><i class="fas fa-times"></i> Cancelar</button>
          <button type="submit" class="master-btn master-btn-primary"><i class="fas fa-${isEdit ? 'save' : 'check'}"></i> ${isEdit ? 'Salvar alterações' : 'Criar plano'}</button>
        </div>
      </form>
    `;

    $('#m-plan-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const data = {};
      // Campos texto/número
      ['codigo','nome','descricao','preco_mensal','trial_dias','cor',
       'max_usuarios','max_remessas_mes','max_terceirizados','max_storage_mb','ordem']
        .forEach((k) => { data[k] = (f.elements[k]?.value ?? '').trim(); });
      // Checkboxes (features + flags)
      ['ativo','visivel','destaque',
       'feat_dashboard','feat_romaneio','feat_relatorios_avancados','feat_export_excel',
       'feat_export_pdf','feat_financeiro','feat_audit_log','feat_api',
       'feat_backup','feat_multi_filial','feat_personalizacao','feat_suporte_prioritario']
        .forEach((k) => { data[k] = f.elements[k]?.checked ? 1 : 0; });

      const btn = f.querySelector('button[type=submit]');
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando…';
      try {
        if (isEdit) {
          await api('put', `/master/plans/${id}`, data);
          toast('Plano atualizado com sucesso!', 'success');
        } else {
          await api('post', '/master/plans', data);
          toast('Plano criado com sucesso!', 'success');
        }
        navigate('planos');
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = original;
      }
    };
  }

  /* ============================================================
   * 🆕 SPRINT 3 — TELA: FINANCEIRO
   * KPIs (MRR/Receita/Aprovados/Suspensas) + lista de payments + ações
   * ============================================================ */
  async function viewFinanceiro() {
    const main = $('#m-main');
    main.innerHTML = '<div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando financeiro…</div>';
    try {
      const [rResumo, rPayments, rEmpresas] = await Promise.all([
        api('get', '/master/billing/resumo'),
        api('get', '/master/billing/payments?limit=100'),
        api('get', '/master/empresas?limit=500'),
      ]);
      const resumo = rResumo.data || {};
      const payments = rPayments.data || [];
      const empresas = (rEmpresas.data?.list || rEmpresas.data || []).filter(e => e.id_empresa !== 1);

      const statusBadge = {
        pendente:  '<span class="master-badge" style="background:rgba(245,158,11,.2);color:#fbbf24">Pendente</span>',
        aprovado:  '<span class="master-badge ativa">Aprovado</span>',
        cancelado: '<span class="master-badge" style="background:rgba(100,116,139,.2);color:#94a3b8">Cancelado</span>',
        rejeitado: '<span class="master-badge" style="background:rgba(239,68,68,.2);color:#fca5a5">Rejeitado</span>',
        estornado: '<span class="master-badge" style="background:rgba(168,85,247,.2);color:#c4b5fd">Estornado</span>',
      };

      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2>Financeiro</h2>
            <div class="subtitle">Cobranças, pagamentos PIX e receita consolidada</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="master-btn master-btn-secondary" id="m-fin-logs" title="Ver logs de pagamento"><i class="fas fa-clipboard-list"></i> Logs PIX</button>
            <button class="master-btn master-btn-secondary" id="m-fin-diag" title="Diagnosticar integração PIX/Mercado Pago"><i class="fas fa-stethoscope"></i> Diagnosticar PIX</button>
            <button class="master-btn master-btn-primary" id="m-fin-cobrar"><i class="fas fa-file-invoice-dollar"></i> Nova cobrança</button>
          </div>
        </div>

        <!-- KPIs -->
        <div class="master-kpi">
          <div class="master-card">
            <div class="label"><i class="fas fa-arrows-spin mr-1"></i> MRR ativo</div>
            <div class="value">${fmt.money(resumo.mrr || 0)}</div>
            <div class="delta">Subscriptions com status=ativa</div>
          </div>
          <div class="master-card">
            <div class="label"><i class="fas fa-coins mr-1"></i> Receita do mês</div>
            <div class="value">${fmt.money(resumo.receita_mes || 0)}</div>
            <div class="delta">${new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</div>
          </div>
          <div class="master-card">
            <div class="label"><i class="fas fa-check-circle mr-1"></i> Pagamentos aprovados</div>
            <div class="value">${fmt.int(resumo.pagamentos_aprovados || 0)}</div>
            <div class="delta">Históricos no total</div>
          </div>
          <div class="master-card">
            <div class="label"><i class="fas fa-circle-exclamation mr-1"></i> Empresas suspensas</div>
            <div class="value" style="color:${(resumo.empresas_suspensas||0) > 0 ? '#fbbf24' : '#fff'}">${fmt.int(resumo.empresas_suspensas || 0)}</div>
            <div class="delta">Por inadimplência</div>
          </div>
        </div>

        <!-- Receita por mês (mini gráfico via barras CSS) -->
        ${Array.isArray(resumo.por_mes) && resumo.por_mes.length > 0 ? `
          <div class="master-card" style="margin-bottom:20px">
            <h3 style="font-size:.95rem;font-weight:700;color:#fff;margin-bottom:14px;">
              <i class="fas fa-chart-column mr-1" style="color:#60a5fa"></i> Receita nos últimos meses
            </h3>
            <div style="display:flex;align-items:flex-end;gap:10px;height:140px;padding:0 4px;">
              ${(() => {
                const maxV = Math.max(...resumo.por_mes.map(m => Number(m.total || 0)), 1);
                return resumo.por_mes.map(m => {
                  const v = Number(m.total || 0);
                  const h = Math.max(4, Math.round((v / maxV) * 120));
                  return `
                    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;">
                      <div style="font-size:.7rem;color:#94a3b8;font-weight:600;">${fmt.money(v).replace('R$ ','')}</div>
                      <div style="width:100%;height:${h}px;background:linear-gradient(180deg,#7c3aed,#2563eb);border-radius:6px 6px 0 0;"></div>
                      <div style="font-size:.65rem;color:#64748b;text-transform:uppercase;">${m.mes}</div>
                    </div>`;
                }).join('');
              })()}
            </div>
          </div>` : ''}

        <!-- Tabela de pagamentos -->
        <div class="master-card" style="padding:0;overflow:hidden;">
          <div style="padding:18px 22px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;">
            <h3 style="font-size:.95rem;font-weight:700;color:#fff;">
              <i class="fas fa-list mr-1" style="color:#a78bfa"></i> Últimos pagamentos
            </h3>
            <div style="display:flex;gap:8px;align-items:center;">
              <input type="search" id="m-fin-search" placeholder="Buscar empresa/referência…" 
                     style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:7px 12px;border-radius:8px;font-size:.85rem;width:240px"/>
              <select id="m-fin-status" style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:7px 12px;border-radius:8px;font-size:.85rem;">
                <option value="">Todos status</option>
                <option value="pendente">Pendentes</option>
                <option value="aprovado">Aprovados</option>
                <option value="cancelado">Cancelados</option>
                <option value="rejeitado">Rejeitados</option>
              </select>
            </div>
          </div>
          ${payments.length === 0 ? `
            <div class="master-empty"><i class="fas fa-folder-open"></i><p>Nenhum pagamento ainda.</p></div>
          ` : `
            <div style="overflow:auto;max-height:600px;">
              <table class="master-table" style="background:transparent;">
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Referência</th>
                    <th style="text-align:right;">Valor</th>
                    <th>Status</th>
                    <th>Vencimento</th>
                    <th>Pago em</th>
                    <th style="text-align:right;">Ações</th>
                  </tr>
                </thead>
                <tbody id="m-fin-tbody">
                  ${renderPaymentsRows(payments, statusBadge)}
                </tbody>
              </table>
            </div>`}
        </div>
      `;

      // Filtros locais
      const allPayments = payments.slice();
      const reapplyFilters = () => {
        const q = ($('#m-fin-search')?.value || '').toLowerCase().trim();
        const s = $('#m-fin-status')?.value || '';
        let filtered = allPayments;
        if (q) {
          filtered = filtered.filter(p =>
            (p.empresa_nome || '').toLowerCase().includes(q) ||
            (p.referencia || '').toLowerCase().includes(q) ||
            String(p.id_payment).includes(q)
          );
        }
        if (s) filtered = filtered.filter(p => p.status === s);
        const tbody = $('#m-fin-tbody');
        if (tbody) tbody.innerHTML = renderPaymentsRows(filtered, statusBadge);
        bindPaymentActions();
      };
      $('#m-fin-search')?.addEventListener('input', reapplyFilters);
      $('#m-fin-status')?.addEventListener('change', reapplyFilters);

      // Ação: Nova cobrança
      $('#m-fin-cobrar').onclick = () => openCriarCobrancaModal(empresas);
      $('#m-fin-diag').onclick   = () => openDiagnosticoPixModal();
      $('#m-fin-logs').onclick   = () => openLogsPixModal();

      bindPaymentActions();
    } catch (e) {
      main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
    }
  }

  function renderPaymentsRows(payments, statusBadge) {
    return payments.map(p => {
      const aprovado = p.status === 'aprovado';
      const pendente = p.status === 'pendente';
      return `
        <tr data-pay="${p.id_payment}">
          <td>
            <strong style="color:#fff;">${p.empresa_nome || ('Empresa ' + p.id_empresa)}</strong>
            <div style="font-size:.7rem;color:#64748b;">#${p.id_empresa}</div>
          </td>
          <td style="font-family:monospace;font-size:.78rem;">${p.referencia || ('#' + p.id_payment)}</td>
          <td style="text-align:right;font-weight:700;color:${aprovado ? '#34d399' : '#fff'};">${fmt.money(p.valor)}</td>
          <td>${statusBadge[p.status] || p.status}</td>
          <td style="font-size:.78rem;color:#94a3b8;">${p.dt_vencimento ? new Date(p.dt_vencimento).toLocaleDateString('pt-BR') : '—'}</td>
          <td style="font-size:.78rem;color:#94a3b8;">${p.dt_pagamento ? new Date(p.dt_pagamento).toLocaleString('pt-BR') : '—'}</td>
          <td style="text-align:right;">
            ${pendente ? `
              <button class="master-btn master-btn-secondary" data-act="aprovar" data-id="${p.id_payment}" title="Aprovar manualmente" style="padding:5px 10px;font-size:.75rem;"><i class="fas fa-check"></i></button>
              <button class="master-btn master-btn-secondary" data-act="sync" data-id="${p.id_payment}" title="Sincronizar com MP" style="padding:5px 10px;font-size:.75rem;"><i class="fas fa-rotate"></i></button>
              <button class="master-btn master-btn-secondary" data-act="cancelar" data-id="${p.id_payment}" title="Cancelar cobrança" style="padding:5px 10px;font-size:.75rem;color:#fca5a5;"><i class="fas fa-times"></i></button>
            ` : `
              <button class="master-btn master-btn-secondary" data-act="sync" data-id="${p.id_payment}" title="Sincronizar com MP" style="padding:5px 10px;font-size:.75rem;"><i class="fas fa-rotate"></i></button>
            `}
          </td>
        </tr>`;
    }).join('');
  }

  function bindPaymentActions() {
    $$('#m-fin-tbody [data-act]').forEach(btn => {
      btn.onclick = async () => {
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        if (!id) return;
        const confirmMsg = {
          aprovar: 'Aprovar este pagamento manualmente? A empresa será reativada.',
          cancelar: 'Cancelar esta cobrança?',
          sync: 'Sincronizar status com Mercado Pago?',
        }[act];
        if (act !== 'sync' && !confirm(confirmMsg)) return;

        btn.disabled = true;
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
          await api('post', `/master/billing/payments/${id}/${act}`);
          toast(`Ação "${act}" executada.`, 'success');
          viewFinanceiro();
        } catch (e) {
          toast(e.message || 'Erro na ação', 'error');
          btn.disabled = false;
          btn.innerHTML = original;
        }
      };
    });
  }

  function openCriarCobrancaModal(empresas) {
    const opts = empresas.map(e =>
      `<option value="${e.id_empresa}">${e.nome} (#${e.id_empresa}) — ${e.plano_codigo || e.plano || ''}</option>`
    ).join('');

    modal(`
      <h3 style="font-size:1.1rem;font-weight:700;color:#fff;margin-bottom:14px;">
        <i class="fas fa-file-invoice-dollar" style="color:#a78bfa"></i> Criar nova cobrança PIX
      </h3>
      <div style="color:#94a3b8;font-size:.85rem;margin-bottom:18px;">
        Gera uma cobrança PIX para a empresa selecionada. Se houver assinatura ativa, o valor padrão é o do plano.
      </div>
      <form id="m-cobrar-form" style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="display:block;font-size:.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:6px;">Empresa</label>
          <select name="id_empresa" required style="width:100%;background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:10px;border-radius:8px;font-size:.9rem;">
            <option value="">— Selecione —</option>
            ${opts}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:6px;">Valor (opcional — usa plano se vazio)</label>
          <input type="number" step="0.01" min="0.01" name="valor" placeholder="0.00" 
                 style="width:100%;background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:10px;border-radius:8px;font-size:.9rem;"/>
        </div>
        <div>
          <label style="display:block;font-size:.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:6px;">Descrição (opcional)</label>
          <input type="text" name="descricao" placeholder="Ex.: Mensalidade janeiro/2026" 
                 style="width:100%;background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:10px;border-radius:8px;font-size:.9rem;"/>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px;">
          <button type="button" class="master-btn master-btn-secondary" id="m-cobrar-cancel">Cancelar</button>
          <button type="submit" class="master-btn master-btn-primary"><i class="fas fa-paper-plane"></i> Gerar PIX</button>
        </div>
      </form>
    `);

    const closeModal = () => document.querySelector('.master-modal-bg')?.remove();
    $('#m-cobrar-cancel').onclick = closeModal;

    $('#m-cobrar-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const id = fd.get('id_empresa');
      if (!id) return;
      const valor = fd.get('valor');
      const body = {};
      if (valor && Number(valor) > 0) body.valor = Number(valor);
      const desc = fd.get('descricao');
      if (desc) body.descricao = String(desc);
      const btn = ev.target.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando…';
      try {
        await api('post', `/master/billing/empresas/${id}/cobrar`, body);
        toast('Cobrança PIX gerada com sucesso!', 'success');
        closeModal();
        viewFinanceiro();
      } catch (e) {
        toast(e.message || 'Erro ao gerar cobrança', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Gerar PIX';
      }
    };
  }

  /* ============================================================
   * HOTFIX 0052 — DIAGNÓSTICO PIX (admin only)
   * Roda bateria de 5 testes contra o Mercado Pago e mostra resultado.
   * ============================================================ */
  function openDiagnosticoPixModal() {
    const m = modal(`
      <h3 style="font-size:1.1rem;font-weight:700;color:#fff;margin-bottom:6px;">
        <i class="fas fa-stethoscope" style="color:#34d399"></i> Diagnóstico PIX / Mercado Pago
      </h3>
      <div style="color:#94a3b8;font-size:.85rem;margin-bottom:18px;">
        Roda 5 testes contra a integração: credenciais, validação de token, conectividade, criação de PIX de teste (R$ 0,01) e consulta do PIX criado.
      </div>
      <div id="m-diag-body" style="min-height:120px;">
        <div class="master-loading" style="color:#94a3b8;text-align:center;padding:24px;">
          <i class="fas fa-spinner fa-spin"></i> Executando diagnóstico…
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
        <button type="button" class="master-btn master-btn-secondary" id="m-diag-rerun"><i class="fas fa-rotate"></i> Rodar novamente</button>
        <button type="button" class="master-btn master-btn-primary" id="m-diag-close">Fechar</button>
      </div>
    `);

    const body = m.querySelector('#m-diag-body');
    m.querySelector('#m-diag-close').onclick = () => m.remove();
    m.querySelector('#m-diag-rerun').onclick = () => runDiag();

    async function runDiag() {
      body.innerHTML = `<div class="master-loading" style="color:#94a3b8;text-align:center;padding:24px;">
        <i class="fas fa-spinner fa-spin"></i> Executando diagnóstico…
      </div>`;
      try {
        const r = await api('get', '/master/billing/diagnostico-pix');
        const data = r.data || {};
        const tests = Array.isArray(data.testes) ? data.testes : [];
        const resumo = data.resumo || { total: 0, sucesso: 0, falha: 0 };
        const modo = data.modo || 'desconhecido';

        // Backend retorna { nome, sucesso: boolean, detalhe: object }
        // Vamos derivar status: pulado se detalhe.aviso, ok se sucesso, error caso contrário
        const statusOf = (t) => {
          if (t.detalhe && (t.detalhe.aviso || /pulado|skip/i.test(t.detalhe.aviso || ''))) return 'skip';
          return t.sucesso ? 'ok' : 'error';
        };

        const iconOf = (st) => st === 'ok'
          ? '<i class="fas fa-circle-check" style="color:#34d399"></i>'
          : (st === 'skip' ? '<i class="fas fa-circle-minus" style="color:#94a3b8"></i>'
                           : '<i class="fas fa-circle-xmark" style="color:#f87171"></i>');

        const renderDetalhe = (d) => {
          if (!d) return '';
          if (typeof d === 'string') return d;
          return Object.entries(d).map(([k, v]) => {
            const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
            return `<div><span style="color:#cbd5e1;font-weight:600;">${k}:</span> ${val}</div>`;
          }).join('');
        };

        const rowsHtml = tests.map(t => {
          const st = statusOf(t);
          const dica = t.detalhe && t.detalhe.diagnostico_provavel ? t.detalhe.diagnostico_provavel : null;
          return `
            <div style="display:flex;gap:12px;padding:12px;border:1px solid #334155;border-radius:8px;background:#0f172a;margin-bottom:8px;">
              <div style="font-size:1.2rem;">${iconOf(st)}</div>
              <div style="flex:1;min-width:0;">
                <div style="color:#fff;font-weight:600;font-size:.92rem;text-transform:capitalize;">${(t.nome || '').replace(/_/g, ' ')}</div>
                <div style="color:#94a3b8;font-size:.78rem;margin-top:4px;word-break:break-word;font-family:monospace;">
                  ${renderDetalhe(t.detalhe)}
                </div>
                ${dica ? `<div style="color:#fbbf24;font-size:.78rem;margin-top:6px;"><i class="fas fa-lightbulb"></i> ${dica}</div>` : ''}
              </div>
            </div>
          `;
        }).join('');

        const errCount = resumo.falha || 0;
        const okCount  = resumo.sucesso || 0;
        const bannerColor = errCount > 0 ? '#7f1d1d' : '#064e3b';
        const bannerText  = errCount > 0
          ? `${errCount} de ${resumo.total} teste(s) com falha — veja detalhes abaixo.`
          : `Todos os ${okCount} testes passaram.`;

        const modoBadge = modo === 'producao'
          ? '<span style="color:#34d399;">PRODUÇÃO</span>'
          : (modo === 'mock' ? '<span style="color:#fbbf24;">MOCK (forçado por MP_USE_MOCK)</span>'
                             : '<span style="color:#fbbf24;">MOCK (sem MP_ACCESS_TOKEN)</span>');

        body.innerHTML = `
          <div style="background:${bannerColor};border-radius:8px;padding:12px 14px;margin-bottom:14px;color:#fff;font-weight:600;font-size:.9rem;">
            ${errCount > 0 ? '<i class="fas fa-triangle-exclamation"></i>' : '<i class="fas fa-circle-check"></i>'} ${bannerText}
          </div>
          <div style="font-size:.78rem;color:#94a3b8;margin-bottom:10px;display:flex;gap:14px;flex-wrap:wrap;">
            <span><b style="color:#e2e8f0;">Modo:</b> ${modoBadge}</span>
            ${data.executado_por ? `<span><b style="color:#e2e8f0;">Por:</b> ${data.executado_por}</span>` : ''}
            ${data.iniciado_em ? `<span><b style="color:#e2e8f0;">Em:</b> ${new Date(data.iniciado_em).toLocaleString('pt-BR')}</span>` : ''}
          </div>
          ${rowsHtml || '<div style="color:#94a3b8;padding:20px;text-align:center;">Nenhum teste retornado.</div>'}
        `;
      } catch (e) {
        body.innerHTML = `
          <div style="background:#7f1d1d;color:#fff;padding:14px;border-radius:8px;font-weight:600;">
            <i class="fas fa-triangle-exclamation"></i> Erro ao rodar diagnóstico: ${e.message || e}
          </div>`;
      }
    }

    runDiag();
  }

  /* ============================================================
   * HOTFIX 0052 — LOGS DE PAGAMENTO (admin only)
   * Lista últimos eventos de criação/consulta/webhook de PIX.
   * ============================================================ */
  function openLogsPixModal() {
    const m = modal(`
      <h3 style="font-size:1.1rem;font-weight:700;color:#fff;margin-bottom:6px;">
        <i class="fas fa-clipboard-list" style="color:#a78bfa"></i> Logs de pagamento PIX
      </h3>
      <div style="color:#94a3b8;font-size:.85rem;margin-bottom:14px;">
        Eventos recentes de integração com Mercado Pago (criação, consulta, webhook, diagnóstico).
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <select id="m-logs-acao" style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:7px 10px;border-radius:8px;font-size:.82rem;">
          <option value="">Todas as ações</option>
          <option value="create">create (criação)</option>
          <option value="consult">consult (consulta)</option>
          <option value="webhook">webhook</option>
          <option value="diagnostico">diagnóstico</option>
        </select>
        <select id="m-logs-status" style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:7px 10px;border-radius:8px;font-size:.82rem;">
          <option value="">Todos status</option>
          <option value="success">success</option>
          <option value="error">error</option>
        </select>
        <input type="number" id="m-logs-empresa" placeholder="id_empresa" min="1"
               style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:7px 10px;border-radius:8px;font-size:.82rem;width:130px;"/>
        <button type="button" class="master-btn master-btn-secondary" id="m-logs-buscar" style="padding:7px 14px;font-size:.82rem;">
          <i class="fas fa-magnifying-glass"></i> Buscar
        </button>
      </div>
      <div id="m-logs-body" style="max-height:55vh;overflow:auto;border:1px solid #334155;border-radius:8px;background:#0f172a;">
        <div class="master-loading" style="color:#94a3b8;text-align:center;padding:24px;">
          <i class="fas fa-spinner fa-spin"></i> Carregando…
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;">
        <button type="button" class="master-btn master-btn-primary" id="m-logs-close">Fechar</button>
      </div>
    `);

    const body = m.querySelector('#m-logs-body');
    m.querySelector('#m-logs-close').onclick = () => m.remove();

    async function loadLogs() {
      body.innerHTML = `<div class="master-loading" style="color:#94a3b8;text-align:center;padding:24px;">
        <i class="fas fa-spinner fa-spin"></i> Carregando…
      </div>`;
      try {
        const params = new URLSearchParams();
        params.set('limit', '100');
        const ac = m.querySelector('#m-logs-acao').value;
        const st = m.querySelector('#m-logs-status').value;
        const ie = m.querySelector('#m-logs-empresa').value;
        if (ac) params.set('acao', ac);
        if (st) params.set('status', st);
        if (ie) params.set('id_empresa', ie);

        const r = await api('get', `/master/billing/payment-logs?${params.toString()}`);
        const logs = (r.data?.list || r.data || []);

        if (!logs.length) {
          body.innerHTML = `<div class="master-empty" style="padding:30px;text-align:center;color:#94a3b8;">
            <i class="fas fa-folder-open" style="font-size:1.8rem;display:block;margin-bottom:6px;"></i>
            Nenhum log encontrado com esses filtros.
          </div>`;
          return;
        }

        const statusBadge = (st) => st === 'success'
          ? '<span style="background:rgba(52,211,153,.2);color:#34d399;padding:2px 8px;border-radius:6px;font-size:.7rem;font-weight:600;">SUCCESS</span>'
          : '<span style="background:rgba(248,113,113,.2);color:#f87171;padding:2px 8px;border-radius:6px;font-size:.7rem;font-weight:600;">ERROR</span>';

        const acaoBadge = (ac) => {
          const colors = {
            create: ['#a78bfa', 'rgba(167,139,250,.15)'],
            consult: ['#60a5fa', 'rgba(96,165,250,.15)'],
            webhook: ['#fbbf24', 'rgba(251,191,36,.15)'],
            diagnostico: ['#34d399', 'rgba(52,211,153,.15)'],
          };
          const [fg, bg] = colors[ac] || ['#94a3b8', 'rgba(148,163,184,.15)'];
          return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:6px;font-size:.7rem;font-weight:600;">${ac || '—'}</span>`;
        };

        body.innerHTML = logs.map(l => `
          <details style="border-bottom:1px solid #1e293b;">
            <summary style="cursor:pointer;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:.82rem;">
              <span style="color:#64748b;font-family:monospace;font-size:.72rem;min-width:140px;">${l.dt_criacao ? new Date(l.dt_criacao + 'Z').toLocaleString('pt-BR') : '—'}</span>
              ${acaoBadge(l.acao)}
              ${statusBadge(l.status)}
              <span style="color:#e2e8f0;">Empresa #${l.id_empresa}</span>
              ${l.id_payment ? `<span style="color:#94a3b8;">pay #${l.id_payment}</span>` : ''}
              ${l.mp_payment_id ? `<span style="color:#94a3b8;font-family:monospace;font-size:.72rem;">mp:${l.mp_payment_id}</span>` : ''}
              ${l.http_status ? `<span style="color:${l.http_status >= 400 ? '#f87171' : '#94a3b8'};">HTTP ${l.http_status}</span>` : ''}
              ${l.valor ? `<span style="color:#34d399;font-weight:600;">R$ ${Number(l.valor).toFixed(2)}</span>` : ''}
              ${l.erro_curto ? `<span style="color:#fca5a5;font-style:italic;">${l.erro_curto}</span>` : ''}
            </summary>
            <div style="padding:0 14px 12px 14px;font-family:monospace;font-size:.72rem;color:#94a3b8;">
              ${l.usuario_login ? `<div><b style="color:#e2e8f0;">Usuário:</b> ${l.usuario_login}</div>` : ''}
              ${l.ip_origem ? `<div><b style="color:#e2e8f0;">IP:</b> ${l.ip_origem}</div>` : ''}
              ${l.user_agent ? `<div style="word-break:break-all;"><b style="color:#e2e8f0;">UA:</b> ${l.user_agent}</div>` : ''}
              ${l.payload_req ? `<div style="margin-top:6px;"><b style="color:#e2e8f0;">Request:</b><pre style="background:#020617;padding:8px;border-radius:4px;margin-top:4px;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;">${escapeHtml(l.payload_req)}</pre></div>` : ''}
              ${l.payload_res ? `<div style="margin-top:6px;"><b style="color:#e2e8f0;">Response:</b><pre style="background:#020617;padding:8px;border-radius:4px;margin-top:4px;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;">${escapeHtml(l.payload_res)}</pre></div>` : ''}
            </div>
          </details>
        `).join('');
      } catch (e) {
        body.innerHTML = `<div style="padding:20px;color:#f87171;text-align:center;">
          <i class="fas fa-triangle-exclamation"></i> Erro: ${e.message || e}
        </div>`;
      }
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    m.querySelector('#m-logs-buscar').onclick = loadLogs;
    loadLogs();
  }

  /* ============================================================
   * TELA: JOBS (lifecycle de assinaturas)
   * ============================================================ */
  // Metadados dos jobs (cor, ícone, label, descrição, endpoint)
  const JOBS_META = {
    warn_upcoming: {
      label: 'Avisar próximos do vencimento',
      icon:  'fa-bullhorn',
      color: '#60a5fa',
      desc:  'Empresas com trial ou cobrança a vencer em ≤ 3 dias. Marca aviso no banco.',
      endpoint: '/master/jobs/warn-upcoming',
      previewEndpoint: '/master/jobs/preview-warn-upcoming',
      previewKey: 'warn_upcoming',
    },
    expire_trials: {
      label: 'Expirar trials vencidos',
      icon:  'fa-hourglass-end',
      color: '#fbbf24',
      desc:  'Empresas com trial_ate < hoje. Suspende empresa e marca assinatura como expirada.',
      endpoint: '/master/jobs/expire-trials',
      previewEndpoint: '/master/jobs/preview-expire-trials',
      previewKey: 'expire_trials',
    },
    mark_overdue: {
      label: 'Marcar cobranças vencidas',
      icon:  'fa-clock',
      color: '#f97316',
      desc:  'Assinaturas ativas com dt_proxima_cobranca < hoje. Status vira pendente + marca dt_pagamento_atrasada.',
      endpoint: '/master/jobs/mark-overdue',
      previewEndpoint: '/master/jobs/preview-mark-overdue',
      previewKey: 'mark_overdue',
    },
    block_overdue: {
      label: 'Bloquear inadimplentes',
      icon:  'fa-lock',
      color: '#f87171',
      desc:  'Assinaturas pendentes há mais de dias_grace dias (default 5). Bloqueia empresa e marca bloqueada_por_pagamento.',
      endpoint: '/master/jobs/block-overdue',
      previewEndpoint: '/master/jobs/preview-block-overdue',
      previewKey: 'block_overdue',
    },
  };

  async function viewJobs() {
    const main = $('#m-main');
    main.innerHTML = '<div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando jobs…</div>';
    try {
      const r = await api('get', '/master/jobs/preview-all');
      const data = r.data || {};
      const total = Object.values(data).reduce((acc, x) => acc + (x.qtd || 0), 0);

      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2><i class="fas fa-robot mr-2" style="color:#a78bfa"></i> Jobs de Lifecycle</h2>
            <div class="subtitle">Execução manual e monitoramento dos jobs automáticos (cron diário às 03:00 UTC = 00:00 BRT)</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="master-btn master-btn-secondary" id="m-refresh"><i class="fas fa-sync"></i> Atualizar</button>
            <button class="master-btn master-btn-secondary" onclick="masterNavigate('jobs/runs')"><i class="fas fa-history"></i> Histórico</button>
            <button class="master-btn master-btn-primary" id="m-run-all" ${total === 0 ? 'disabled' : ''}>
              <i class="fas fa-play"></i> Executar tudo (${total})
            </button>
          </div>
        </div>

        <div class="master-info-box" style="margin-bottom:16px;">
          <i class="fas fa-info-circle"></i>
          <div>
            <strong>Cron diário automático:</strong> roda às <code>0 3 * * *</code> (03:00 UTC). Execução manual permite simular um ciclo a qualquer momento, sem esperar pelo cron.<br/>
            A empresa fundadora (id=1) é <strong>imune</strong> a qualquer mutação automática.
          </div>
        </div>

        <div class="jobs-grid">
          ${Object.entries(JOBS_META).map(([key, meta]) => {
            const qtd = data[meta.previewKey]?.qtd || 0;
            const items = data[meta.previewKey]?.items || [];
            return `
              <div class="job-card" data-job="${key}">
                <div class="job-card-head">
                  <div class="job-card-icon" style="background: ${meta.color}22; color: ${meta.color};">
                    <i class="fas ${meta.icon}"></i>
                  </div>
                  <div class="job-card-title">
                    <h3>${meta.label}</h3>
                    <p>${meta.desc}</p>
                  </div>
                  <div class="job-card-count" style="color: ${qtd > 0 ? meta.color : '#64748b'};">
                    ${qtd}
                  </div>
                </div>
                <div class="job-card-body">
                  ${qtd === 0
                    ? '<div class="job-empty"><i class="fas fa-check-circle" style="color:#10b981"></i> Nenhuma empresa será afetada agora</div>'
                    : `<ul class="job-items">${items.slice(0,5).map((it) => renderJobItem(key, it)).join('')}${items.length > 5 ? `<li class="job-more">+${items.length - 5} outras…</li>` : ''}</ul>`
                  }
                </div>
                <div class="job-card-foot">
                  <button class="master-btn master-btn-secondary master-btn-sm job-run-btn" data-job="${key}" ${qtd === 0 ? 'disabled' : ''}>
                    <i class="fas fa-play mr-1"></i> Executar agora
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      // Listeners
      $('#m-refresh').onclick = viewJobs;
      $('#m-run-all').onclick = () => runJobUI('lifecycle_full', '/master/jobs/lifecycle-full', total);
      $$('.job-run-btn').forEach((btn) => {
        btn.onclick = () => {
          const k = btn.dataset.job;
          const meta = JOBS_META[k];
          const qtd = data[meta.previewKey]?.qtd || 0;
          runJobUI(k, meta.endpoint, qtd);
        };
      });
    } catch (e) {
      main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
    }
  }

  // Renderiza 1 item da lista de preview de um job
  function renderJobItem(jobKey, it) {
    if (jobKey === 'expire_trials') {
      return `<li><strong>${it.nome || '—'}</strong> · trial venceu há ${it.dias_vencido}d</li>`;
    }
    if (jobKey === 'mark_overdue') {
      return `<li><strong>${it.nome || '—'}</strong> · cobrança ${fmt.date(it.dt_proxima_cobranca)} · atraso ${it.dias_atraso}d</li>`;
    }
    if (jobKey === 'block_overdue') {
      return `<li><strong>${it.nome || '—'}</strong> · pendente há ${it.dias_atraso}d (grace ${it.dias_grace}d)</li>`;
    }
    if (jobKey === 'warn_upcoming') {
      const tipo = it.status === 'trial' ? 'trial' : 'cobrança';
      return `<li><strong>${it.nome || '—'}</strong> · ${tipo} vence em ${it.dias_para_vencer}d</li>`;
    }
    return `<li>${it.nome || JSON.stringify(it)}</li>`;
  }

  // Confirma + executa job, mostra resultado
  async function runJobUI(jobKey, endpoint, qtd) {
    const isFull = jobKey === 'lifecycle_full';
    const label  = isFull ? 'Executar TODOS os jobs' : (JOBS_META[jobKey]?.label || jobKey);
    if (!confirm(`${label}?\n\n${qtd} item(s) serão processados agora.\nEsta ação é registrada em job_runs e sub_logs.\n\nContinuar?`)) return;

    const main = $('#m-main');
    const overlay = document.createElement('div');
    overlay.className = 'master-loading';
    overlay.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Executando ${label}…`;
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.85);z-index:9999;display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:#fff;';
    document.body.appendChild(overlay);

    try {
      const r = await api('post', endpoint);
      overlay.remove();
      const d = r.data || {};
      const proc = d.total_processados ?? d.processados ?? 0;
      const dur  = d.duracao_ms || 0;
      toast(`Job concluído: ${proc} item(s) em ${dur}ms.`, 'success');
      // Recarrega a tela
      setTimeout(viewJobs, 500);
    } catch (err) {
      overlay.remove();
      toast(err.message, 'error');
    }
  }

  /* ============================================================
   * TELA: JOBS RUNS (histórico de execuções)
   * ============================================================ */
  async function viewJobRuns() {
    const main = $('#m-main');
    main.innerHTML = '<div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando histórico…</div>';
    try {
      const r = await api('get', '/master/jobs/runs?limit=100');
      const runs = r.data?.items || [];
      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2><i class="fas fa-history mr-2" style="color:#a78bfa"></i> Histórico de execuções</h2>
            <div class="subtitle">Últimas ${runs.length} execuções de jobs (cron ou manual)</div>
          </div>
          <button class="master-btn master-btn-secondary" onclick="masterNavigate('jobs')"><i class="fas fa-arrow-left"></i> Voltar</button>
        </div>

        <div class="master-card" style="padding:0;overflow:hidden;">
          <table class="master-table">
            <thead><tr>
              <th>#</th>
              <th>Job</th>
              <th>Origem</th>
              <th>Acionado por</th>
              <th>Iniciado em</th>
              <th style="text-align:right;">Duração</th>
              <th style="text-align:right;">Processados</th>
              <th>Status</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${runs.length === 0
                ? `<tr><td colspan="9"><div class="master-empty"><i class="fas fa-folder-open"></i><p>Nenhuma execução registrada ainda.</p></div></td></tr>`
                : runs.map((r) => {
                    const stCls = r.status === 'ok' ? 'ativa' : r.status === 'erro' ? 'cancelada' : 'trial';
                    return `
                    <tr>
                      <td><code>#${r.id_run}</code></td>
                      <td><strong style="color:#fff;">${r.job_name}</strong></td>
                      <td><span class="master-badge ${r.origem === 'cron' ? 'trial' : 'ativa'}"><i class="fas fa-${r.origem === 'cron' ? 'clock' : 'user'}"></i> ${r.origem}</span></td>
                      <td style="font-size:.8rem;color:#94a3b8;">${r.acionado_por || '—'}</td>
                      <td style="font-size:.8rem;">${fmt.datetime(r.iniciado_em)}</td>
                      <td style="text-align:right;font-family:'Menlo',monospace;font-size:.85rem;">${r.duracao_ms || '—'}ms</td>
                      <td style="text-align:right;font-weight:700;">${r.processados}</td>
                      <td><span class="master-badge ${stCls}">${r.status}</span></td>
                      <td><button class="master-btn master-btn-secondary master-btn-icon" onclick="masterNavigate('jobs/runs/${r.id_run}')" title="Detalhes"><i class="fas fa-eye"></i></button></td>
                    </tr>`;
                  }).join('')
              }
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
    }
  }

  /* ============================================================
   * TELA: JOB RUN DETAIL — detalhes de uma execução
   * ============================================================ */
  async function viewJobRunDetail(id) {
    const main = $('#m-main');
    main.innerHTML = '<div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando…</div>';
    try {
      const r = await api('get', '/master/jobs/runs/' + id);
      const d = r.data || {};
      const stCls = d.status === 'ok' ? 'ativa' : d.status === 'erro' ? 'cancelada' : 'trial';

      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2><i class="fas fa-clipboard-check mr-2" style="color:#a78bfa"></i> Execução #${d.id_run}</h2>
            <div class="subtitle">${d.job_name} · ${fmt.datetime(d.iniciado_em)}</div>
          </div>
          <button class="master-btn master-btn-secondary" onclick="masterNavigate('jobs/runs')"><i class="fas fa-arrow-left"></i> Voltar</button>
        </div>

        <div class="master-kpi" style="grid-template-columns:repeat(4,1fr);">
          <div class="master-card"><div class="label">Status</div><div class="value"><span class="master-badge ${stCls}">${d.status}</span></div></div>
          <div class="master-card"><div class="label">Origem</div><div class="value"><span class="master-badge ${d.origem === 'cron' ? 'trial' : 'ativa'}">${d.origem}</span></div></div>
          <div class="master-card"><div class="label">Processados</div><div class="value">${d.processados}</div></div>
          <div class="master-card"><div class="label">Duração</div><div class="value" style="font-size:1rem;">${d.duracao_ms || '—'}ms</div></div>
        </div>

        ${d.erro ? `
          <div class="master-card" style="border-color:rgba(248,113,113,.4);background:rgba(248,113,113,.06);margin-bottom:18px;">
            <h3 style="color:#fca5a5;margin-bottom:8px;"><i class="fas fa-exclamation-triangle"></i> Erro</h3>
            <pre style="color:#fecaca;font-size:.85rem;white-space:pre-wrap;margin:0;">${d.erro}</pre>
          </div>
        ` : ''}

        <div class="master-card">
          <h3 style="margin-bottom:10px;color:#fff;"><i class="fas fa-code mr-1" style="color:#a78bfa"></i> Resultado completo (JSON)</h3>
          <pre style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:14px;color:#cbd5e1;font-size:.78rem;overflow:auto;max-height:560px;">${
            d.resultado ? JSON.stringify(d.resultado, null, 2) : '(sem resultado)'
          }</pre>
        </div>
      `;
    } catch (e) {
      main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
    }
  }

  /* ============================================================
   * ROUTER
   * ============================================================ */
  function dispatch() {
    const route = getRoute();
    if (!route) return;
    STATE.route = route;
    // Match patterns
    const parts = route.split('/');
    const top = parts[0];
    if (top === 'dashboard') { highlightNav('dashboard'); return viewDashboard(); }
    if (top === 'empresas') {
      highlightNav('empresas');
      if (parts[1] === 'nova') return viewNovaEmpresa();
      if (parts[1]) return viewEmpresaDetalhe(parts[1]);
      return viewEmpresas();
    }
    if (top === 'planos') {
      highlightNav('planos');
      if (parts[1] === 'novo') return viewPlanoForm(null);
      if (parts[1]) return viewPlanoForm(+parts[1]);
      return viewPlanos();
    }
    if (top === 'financeiro') { highlightNav('financeiro'); return viewFinanceiro(); }
    if (top === 'jobs') {
      highlightNav('jobs');
      if (parts[1] === 'runs' && parts[2]) return viewJobRunDetail(+parts[2]);
      if (parts[1] === 'runs') return viewJobRuns();
      return viewJobs();
    }
    // fallback
    location.hash = '#master/dashboard';
  }

  window.addEventListener('hashchange', () => {
    if (/^#?master(\/|$)/.test(location.hash)) dispatch();
  });

  /* ============================================================
   * BOOT
   * ============================================================ */
  async function boot() {
    injectCSS();
    const token = AUTH.getToken();
    if (!token) { renderLogin(); return; }
    // Valida token
    try {
      const r = await api('get', '/master/auth/me');
      STATE.master = r.data;
      renderShell();
      dispatch();
    } catch (e) {
      AUTH.clear();
      renderLogin('Sessão expirada. Faça login novamente.');
    }
  }

  // Inicializa
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
