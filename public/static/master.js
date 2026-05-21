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
    <div class="master-shell">
      <aside class="master-sidebar">
        <h1><i class="fas fa-crown" style="color:#fbbf24"></i> CorePro <span class="tag">MASTER</span></h1>
        <nav class="master-nav">
          <a data-r="dashboard"><i class="fas fa-chart-line w-5"></i> Dashboard</a>
          <a data-r="empresas"><i class="fas fa-building w-5"></i> Empresas</a>
          <a data-r="financeiro"><i class="fas fa-credit-card w-5"></i> Financeiro</a>
          <a data-r="planos"><i class="fas fa-layer-group w-5"></i> Planos</a>
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

    $$('.master-nav a').forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); navigate(a.dataset.r); };
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
      const r = await api('get', '/master/dashboard');
      const d = r.data;
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
      const r = await api('get', '/master/empresas');
      const empresas = r.data || [];
      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2>Empresas (${empresas.length})</h2>
            <div class="subtitle">Cadastro, planos e status de todas as empresas-clientes</div>
          </div>
          <button class="master-btn master-btn-primary" onclick="masterNavigate('empresas/nova')"><i class="fas fa-plus"></i> Cadastrar empresa</button>
        </div>

        <div style="display:flex;gap:10px;margin-bottom:16px;">
          <input class="master-input" id="m-search" placeholder="Buscar por nome, CNPJ ou slug…" style="max-width:380px;" />
          <select class="master-select" id="m-status-filter" style="max-width:200px;">
            <option value="">Todos os status</option>
            <option value="ativa">Ativas</option>
            <option value="trial">Trial</option>
            <option value="suspensa">Suspensas</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </div>

        <div class="master-card" style="padding:0;overflow:hidden;">
          <table class="master-table">
            <thead><tr>
              <th>Empresa</th>
              <th>Plano</th>
              <th>Status</th>
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
      const search = $('#m-search'), statusF = $('#m-status-filter'), tbody = $('#m-tbody');
      function applyFilter() {
        const q = (search.value || '').toLowerCase();
        const st = statusF.value;
        const filt = empresas.filter((e) => {
          const matchQ = !q || [e.nome, e.cnpj, e.slug].some((x) => String(x || '').toLowerCase().includes(q));
          const matchS = !st || e.status === st;
          return matchQ && matchS;
        });
        tbody.innerHTML = renderEmpresasRows(filt);
      }
      search.oninput = applyFilter;
      statusF.onchange = applyFilter;
    } catch (e) {
      main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
    }
  }

  function renderEmpresasRows(list) {
    if (!list.length) return `<tr><td colspan="7"><div class="master-empty"><i class="fas fa-folder-open"></i><p>Nenhuma empresa encontrada.</p></div></td></tr>`;
    return list.map((e) => {
      const blocked = e.bloqueada_em ? `<span class="master-badge bloqueada" title="${e.motivo_bloqueio || ''}"><i class="fas fa-lock"></i> bloqueada</span>` : '';
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
      const planos = (r.data || []).filter((p) => p.codigo !== 'trial');
      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2><i class="fas fa-plus-circle mr-2" style="color:#a78bfa"></i> Cadastrar nova empresa</h2>
            <div class="subtitle">Preencha os dados; um trial automático será iniciado se selecionado.</div>
          </div>
          <button class="master-btn master-btn-secondary" onclick="masterNavigate('empresas')"><i class="fas fa-arrow-left"></i> Voltar</button>
        </div>

        <div class="master-card" style="max-width:780px;">
          <form id="m-new-emp" class="master-form">
            <div class="grid-2">
              <div>
                <label>Nome da empresa *</label>
                <input class="master-input" name="nome" required placeholder="Confecção XYZ LTDA" />
              </div>
              <div>
                <label>CNPJ</label>
                <input class="master-input" name="cnpj" placeholder="00.000.000/0000-00" />
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
                <input class="master-input" name="cep" />
              </div>
            </div>
            <div>
              <label>Endereço</label>
              <input class="master-input" name="endereco" placeholder="Rua, número, bairro" />
            </div>

            <div style="border-top:1px solid #334155;padding-top:18px;margin-top:6px;">
              <h4 style="color:#fff;font-weight:700;margin-bottom:12px;"><i class="fas fa-layer-group mr-1" style="color:#a78bfa"></i> Plano e período</h4>
              <div class="grid-2">
                <div>
                  <label>Plano *</label>
                  <select class="master-select" name="id_plano" required>
                    ${planos.map((p) => `<option value="${p.id_plano}">${p.nome} — ${fmt.money(p.preco_mensal)}/mês</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label>Dias de trial (0 = inicia já paga)</label>
                  <input class="master-input" name="trial_dias" type="number" min="0" max="60" value="14" />
                </div>
              </div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">
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
        ['nome','cnpj','email_contato','telefone','cidade','uf','cep','endereco'].forEach((k) => { data[k] = f[k].value.trim() || null; });
        data.id_plano = Number(f.id_plano.value);
        data.trial_dias = Number(f.trial_dias.value || 0);
        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cadastrando…';
        try {
          const r = await api('post', '/master/empresas', data);
          toast('Empresa cadastrada com sucesso!', 'success');
          navigate('empresas/' + r.data.id_empresa);
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
   * TELA: PLANOS (somente leitura nesta sprint)
   * ============================================================ */
  async function viewPlanos() {
    const main = $('#m-main');
    main.innerHTML = '<div class="master-loading"><i class="fas fa-spinner fa-spin"></i> Carregando planos…</div>';
    try {
      const r = await api('get', '/master/plans');
      const planos = r.data || [];
      main.innerHTML = `
        <div class="master-header">
          <div>
            <h2>Planos do SaaS (${planos.length})</h2>
            <div class="subtitle">Catálogo de planos, preços e limites. Edição completa em sprints futuras.</div>
          </div>
        </div>
        <div class="master-card" style="padding:0;overflow:hidden;">
          <table class="master-table">
            <thead><tr>
              <th>Plano</th>
              <th style="text-align:right;">Preço/mês</th>
              <th style="text-align:right;">Usuários</th>
              <th style="text-align:right;">Remessas/mês</th>
              <th style="text-align:right;">Terceirizados</th>
              <th>Features</th>
              <th>Visível</th>
            </tr></thead>
            <tbody>
              ${planos.map((p) => `
                <tr>
                  <td>
                    <div style="font-weight:700;color:#fff;">${p.nome}</div>
                    <div style="font-size:.75rem;color:#94a3b8;"><code>${p.codigo}</code></div>
                    <div style="font-size:.75rem;color:#94a3b8;margin-top:4px;">${p.descricao || ''}</div>
                  </td>
                  <td style="text-align:right;font-weight:700;color:#34d399;">${fmt.money(p.preco_mensal)}</td>
                  <td style="text-align:right;">${p.max_usuarios < 0 ? '∞' : p.max_usuarios}</td>
                  <td style="text-align:right;">${p.max_remessas_mes < 0 ? '∞' : fmt.int(p.max_remessas_mes)}</td>
                  <td style="text-align:right;">${p.max_terceirizados < 0 ? '∞' : p.max_terceirizados}</td>
                  <td style="font-size:.75rem;">
                    ${p.feat_relatorios_avancados ? '<span class="master-badge ativa" style="margin-right:3px;">RA</span>' : ''}
                    ${p.feat_api ? '<span class="master-badge ativa" style="margin-right:3px;">API</span>' : ''}
                    ${p.feat_audit_log ? '<span class="master-badge ativa" style="margin-right:3px;">AUD</span>' : ''}
                    ${p.feat_multi_filial ? '<span class="master-badge ativa" style="margin-right:3px;">MF</span>' : ''}
                  </td>
                  <td>${p.visivel ? '<i class="fas fa-eye" style="color:#34d399"></i>' : '<i class="fas fa-eye-slash" style="color:#64748b"></i>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      main.innerHTML = `<div class="master-empty"><i class="fas fa-exclamation-triangle" style="color:#f87171"></i><p>${e.message}</p></div>`;
    }
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
          <button class="master-btn master-btn-primary" id="m-fin-cobrar"><i class="fas fa-file-invoice-dollar"></i> Nova cobrança</button>
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
    if (top === 'planos') { highlightNav('planos'); return viewPlanos(); }
    if (top === 'financeiro') { highlightNav('financeiro'); return viewFinanceiro(); }
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
