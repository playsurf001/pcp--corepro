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
const fmt = {
  num: (v, d = 2) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }),
  int: (v) => Number(v || 0).toLocaleString('pt-BR'),
  pct: (v) => (Number(v || 0) * 100).toFixed(1) + '%',
  date: (s) => (s ? dayjs(s).format('DD/MM/YYYY') : ''),
  datetime: (s) => (s ? dayjs(s).format('DD/MM/YYYY HH:mm') : ''),
};

function toast(msg, type = 'info') {
  const map = { info: 'bg-blue-600', success: 'bg-emerald-600', error: 'bg-red-600', warning: 'bg-amber-600' };
  const t = el('div', { class: `toast ${map[type]} text-white px-4 py-3 rounded-lg shadow-lg` }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

async function api(method, path, body) {
  try {
    const r = await axios({ method, url: API + path, data: body });
    return r.data;
  } catch (e) {
    const msg = e.response?.data?.error || e.message || 'Erro';
    toast(msg, 'error');
    throw e;
  }
}

/* ---------- Estado global ---------- */
const state = {
  route: 'dashboard',
  cache: {},
};

/* ---------- Layout / Navegação ---------- */
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-line', group: 'Gestão' },
  { id: 'ops', label: 'Ordens de Produção', icon: 'fa-clipboard-list', group: 'Produção' },
  { id: 'balanceamento', label: 'Balanceamento', icon: 'fa-balance-scale', group: 'Produção' },
  { id: 'ficha', label: 'Ficha Acompanhamento', icon: 'fa-file-invoice', group: 'Produção' },
  { id: 'apontamento', label: 'Apontamento', icon: 'fa-hard-hat', group: 'Chão de Fábrica' },
  { id: 'sequencias', label: 'Sequências Operacionais', icon: 'fa-list-ol', group: 'Engenharia' },
  { id: 'referencias', label: 'Referências', icon: 'fa-tshirt', group: 'Cadastros' },
  { id: 'clientes', label: 'Clientes', icon: 'fa-users', group: 'Cadastros' },
  { id: 'operacoes', label: 'Operações', icon: 'fa-cogs', group: 'Cadastros' },
  { id: 'maquinas', label: 'Máquinas', icon: 'fa-industry', group: 'Cadastros' },
  { id: 'aparelhos', label: 'Aparelhos', icon: 'fa-tools', group: 'Cadastros' },
  { id: 'cores', label: 'Cores', icon: 'fa-palette', group: 'Cadastros' },
  { id: 'tamanhos', label: 'Tamanhos', icon: 'fa-ruler', group: 'Cadastros' },
  { id: 'parametros', label: 'Parâmetros', icon: 'fa-sliders-h', group: 'Sistema' },
  { id: 'auditoria', label: 'Auditoria', icon: 'fa-history', group: 'Sistema' },
];

function renderLayout() {
  const groups = {};
  NAV.forEach((n) => { (groups[n.group] ||= []).push(n); });

  $('#app').innerHTML = `
  <div class="flex h-screen">
    <aside id="sidebar" class="sidebar w-64 text-white flex-shrink-0 overflow-y-auto">
      <div class="p-5 border-b border-teal-800">
        <h1 class="text-xl font-bold flex items-center gap-2">
          <i class="fas fa-industry"></i> PCP Confecção
        </h1>
        <p class="text-xs text-teal-200 mt-1">v2.0 • Sistema de balanceamento</p>
      </div>
      <nav class="py-2">
        ${Object.entries(groups).map(([g, items]) => `
          <div class="px-4 py-1 text-xs uppercase text-teal-300 font-semibold mt-3">${g}</div>
          ${items.map(i => `
            <a href="#${i.id}" data-route="${i.id}" class="nav-item flex items-center gap-3 px-4 py-2 text-sm cursor-pointer">
              <i class="fas ${i.icon} w-5 text-center"></i>
              <span>${i.label}</span>
            </a>`).join('')}
        `).join('')}
      </nav>
    </aside>
    <div class="flex-1 flex flex-col overflow-hidden">
      <header id="topbar" class="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <h2 id="page-title" class="text-lg font-semibold text-slate-800">Dashboard</h2>
        <div class="text-sm text-slate-500">
          <span id="today">${dayjs().format('DD/MM/YYYY')}</span>
          <span class="mx-2">|</span>
          <span><i class="fas fa-user-circle"></i> Operador</span>
        </div>
      </header>
      <main id="main-content" class="flex-1 overflow-auto p-6 bg-slate-50"></main>
    </div>
  </div>`;

  $$('[data-route]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    navigate(a.dataset.route);
  }));
}

function navigate(route) {
  state.route = route;
  location.hash = route;
  $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  const nav = NAV.find((n) => n.id === route);
  $('#page-title').textContent = nav ? nav.label : route;
  render();
}

/* ---------- Renderer principal ---------- */
async function render() {
  const main = $('#main-content');
  main.innerHTML = `<div class="text-center py-16"><i class="fas fa-spinner fa-spin text-3xl text-brand"></i></div>`;
  const handler = ROUTES[state.route] || ROUTES.dashboard;
  try { await handler(main); }
  catch (e) { console.error(e); main.innerHTML = `<div class="card p-6 text-red-600"><i class="fas fa-exclamation-triangle"></i> Erro: ${e.message}</div>`; }
}

/* ============================================================
 * TELAS
 * ============================================================ */
const ROUTES = {};

/* ---------- DASHBOARD ---------- */
ROUTES.dashboard = async (main) => {
  const r = await api('get', '/dashboard');
  const d = r.data;
  main.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${kpi('OPs Abertas', d.ops_abertas, 'fa-folder-open', 'bg-blue-500')}
      ${kpi('OPs Atrasadas', d.ops_atrasadas, 'fa-exclamation-triangle', 'bg-red-500')}
      ${kpi('Peças em Aberto', fmt.int(d.pecas_aberto), 'fa-cubes', 'bg-indigo-500')}
      ${kpi('Prazo Médio (dias)', fmt.num(d.prazo_medio_dias, 1), 'fa-calendar-alt', 'bg-amber-500')}
      ${kpi('Minutos em Aberto', fmt.int(d.minutos_aberto), 'fa-clock', 'bg-cyan-500')}
      ${kpi('Produção Boa (mês)', fmt.int(d.producao_boa_mes), 'fa-check-circle', 'bg-emerald-500')}
      ${kpi('Refugo %', fmt.pct(d.refugo_pct), 'fa-trash-alt', 'bg-rose-500')}
      ${kpi('Eficiência Real', fmt.pct(d.eficiencia_real), 'fa-gauge-high', 'bg-purple-500')}
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="card p-5">
        <h3 class="font-semibold mb-3 text-slate-700">Carga por Cliente (top 10)</h3>
        <canvas id="ch-cli" height="220"></canvas>
      </div>
      <div class="card p-5">
        <h3 class="font-semibold mb-3 text-slate-700">Carga por Referência (top 10)</h3>
        <canvas id="ch-ref" height="220"></canvas>
      </div>
      <div class="card p-5">
        <h3 class="font-semibold mb-3 text-slate-700">OPs por Status</h3>
        <canvas id="ch-st" height="180"></canvas>
      </div>
      <div class="card p-5">
        <h3 class="font-semibold mb-3 text-slate-700">Dicas rápidas</h3>
        <ul class="space-y-2 text-sm text-slate-600">
          <li>✅ Cadastre primeiro: Máquinas → Aparelhos → Operações → Referências.</li>
          <li>✅ Crie a <b>Sequência Operacional</b> da referência e <b>ATIVE</b> a versão.</li>
          <li>✅ Abra OPs preenchendo <b>cores e tamanhos</b> (a soma deve bater com a qtde).</li>
          <li>✅ Use o <b>Balanceamento</b> para saber quantas máquinas/operadores.</li>
          <li>✅ Imprima a <b>Ficha de Acompanhamento</b> e registre no <b>Apontamento</b>.</li>
        </ul>
      </div>
    </div>
  `;

  const labels = d.carga_clientes.map(x => x.nome_cliente);
  const data = d.carga_clientes.map(x => x.pecas);
  if (labels.length) new Chart($('#ch-cli'), { type: 'bar', data: { labels, datasets: [{ label: 'Peças', data, backgroundColor: '#14b8a6' }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } });

  const labelsR = d.carga_refs.map(x => x.cod_ref + ' - ' + (x.desc_ref || '').slice(0, 25));
  const dataR = d.carga_refs.map(x => x.pecas);
  if (labelsR.length) new Chart($('#ch-ref'), { type: 'bar', data: { labels: labelsR, datasets: [{ label: 'Peças', data: dataR, backgroundColor: '#6366f1' }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } });

  const labelsS = d.status_breakdown.map(x => x.status);
  const dataS = d.status_breakdown.map(x => x.c);
  if (labelsS.length) new Chart($('#ch-st'), {
    type: 'doughnut',
    data: { labels: labelsS, datasets: [{ data: dataS, backgroundColor: ['#3b82f6', '#a855f7', '#f59e0b', '#10b981', '#ef4444'] }] }
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
    const data = (await api('get', config.endpoint)).data;
    main.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <div class="text-slate-600 text-sm">${data.length} registro(s)</div>
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
      </div>`;
    const tbody = $('#tbody');
    data.forEach((row) => {
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
      acts.innerHTML = `
        <button class="text-blue-600 hover:text-blue-800 mr-2" data-edit="${row[config.idField]}"><i class="fas fa-edit"></i></button>
        <button class="text-red-600 hover:text-red-800" data-del="${row[config.idField]}"><i class="fas fa-trash"></i></button>`;
      tr.appendChild(acts);
      tbody.appendChild(tr);
    });

    $('#btn-new').onclick = () => openCrudForm(config, null);
    $$('[data-edit]').forEach((b) => b.onclick = () => {
      const id = parseInt(b.dataset.edit);
      openCrudForm(config, data.find((x) => x[config.idField] === id));
    });
    $$('[data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('Confirma inativar este registro?')) return;
      await api('delete', `${config.endpoint}/${b.dataset.del}`);
      toast('Inativado.', 'success'); render();
    });
  };
}

function openCrudForm(config, row) {
  const isEdit = !!row;
  const m = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal w-full max-w-xl p-6' });
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-4">${isEdit ? 'Editar' : 'Novo'} ${config.label}</h3>
    <form id="crud-form" class="space-y-3">
      ${config.fields.map((f) => renderField(f, row)).join('')}
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" id="cancel" class="btn btn-secondary">Cancelar</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save mr-1"></i> Salvar</button>
      </div>
    </form>`;
  m.appendChild(card);
  document.body.appendChild(m);
  $('#cancel').onclick = () => m.remove();
  $('#crud-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const body = {};
    config.fields.forEach((f) => {
      const v = $(`#f_${f.name}`).value;
      if (f.type === 'number') body[f.name] = v === '' ? null : parseFloat(v);
      else if (f.type === 'checkbox') body[f.name] = $(`#f_${f.name}`).checked ? 1 : 0;
      else body[f.name] = v;
    });
    try {
      if (isEdit) await api('put', `${config.endpoint}/${row[config.idField]}`, body);
      else await api('post', config.endpoint, body);
      toast('Salvo.', 'success'); m.remove(); render();
    } catch {}
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
  const d = (await api('get', '/parametros')).data;
  main.innerHTML = `
    <div class="card p-6 max-w-2xl">
      <h3 class="font-semibold mb-4 text-slate-700">Parâmetros do sistema</h3>
      <form id="form-param" class="space-y-3">
        ${d.map(p => `
          <div class="grid grid-cols-3 gap-3 items-center">
            <label class="col-span-1 text-sm font-medium text-slate-700" title="${p.descricao || ''}">${p.chave}</label>
            <input class="col-span-1" id="p_${p.chave}" value="${p.valor || ''}"/>
            <span class="col-span-1 text-xs text-slate-500">${p.descricao || ''}</span>
          </div>`).join('')}
        <div class="flex justify-end pt-3"><button class="btn btn-primary"><i class="fas fa-save mr-1"></i> Salvar</button></div>
      </form>
    </div>`;
  $('#form-param').onsubmit = async (e) => {
    e.preventDefault();
    for (const p of d) {
      const v = $('#p_' + p.chave).value;
      if (v !== p.valor) await api('put', `/parametros/${p.chave}`, { valor: v });
    }
    toast('Parâmetros atualizados.', 'success'); render();
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
  const data = opsRes.data;
  main.innerHTML = `
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
        <button id="f-apply" class="btn btn-secondary flex-1"><i class="fas fa-filter mr-1"></i> Filtrar</button>
        <button id="btn-new-op" class="btn btn-primary flex-1"><i class="fas fa-plus mr-1"></i> Nova OP</button>
      </div>
    </div>
    <div class="card overflow-auto">
      <table class="w-full text-sm table-sticky">
        <thead class="bg-slate-100"><tr>
          <th class="px-3 py-2 text-left">Nº OP</th>
          <th class="px-3 py-2 text-left">Emissão</th>
          <th class="px-3 py-2 text-left">Referência</th>
          <th class="px-3 py-2 text-left">Cliente</th>
          <th class="px-3 py-2 text-right">Qtd Peças</th>
          <th class="px-3 py-2 text-left">Entrega</th>
          <th class="px-3 py-2 text-left">Versão Seq</th>
          <th class="px-3 py-2 text-left">Status</th>
          <th class="px-3 py-2 text-center">Ações</th>
        </tr></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>`;

  const drawBody = (items) => {
    const tbody = $('#tbody'); tbody.innerHTML = '';
    if (!items.length) { tbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-slate-500">Nenhuma OP encontrada.</td></tr>`; return; }
    items.forEach((r) => {
      const tr = el('tr', { class: 'border-t hover:bg-slate-50' + (r.atrasada ? ' bg-red-50' : '') });
      tr.innerHTML = `
        <td class="px-3 py-2 font-mono font-semibold">${r.num_op}</td>
        <td class="px-3 py-2">${fmt.date(r.dt_emissao)}</td>
        <td class="px-3 py-2">${r.cod_ref} — ${r.desc_ref}</td>
        <td class="px-3 py-2">${r.nome_cliente}</td>
        <td class="px-3 py-2 text-right">${fmt.int(r.qtde_pecas)}</td>
        <td class="px-3 py-2 ${r.atrasada ? 'text-red-600 font-semibold' : ''}">${fmt.date(r.dt_entrega)} ${r.atrasada ? '<i class="fas fa-exclamation-triangle ml-1"></i>' : ''}</td>
        <td class="px-3 py-2">v${r.seq_versao}</td>
        <td class="px-3 py-2"><span class="badge badge-${r.status}">${r.status}</span></td>
        <td class="px-3 py-2 text-center whitespace-nowrap">
          <button class="text-blue-600 mx-1" data-edit="${r.id_op}" title="Editar"><i class="fas fa-edit"></i></button>
          <button class="text-indigo-600 mx-1" data-balanc="${r.id_op}" title="Balanceamento"><i class="fas fa-balance-scale"></i></button>
          <button class="text-emerald-600 mx-1" data-ficha="${r.id_op}" title="Ficha"><i class="fas fa-file-invoice"></i></button>
          <button class="text-red-600 mx-1" data-del="${r.id_op}" title="Excluir"><i class="fas fa-trash"></i></button>
        </td>`;
      tbody.appendChild(tr);
    });
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
  $('#f-apply').onclick = async () => {
    const params = [
      ['status', $('#f-status').value],
      ['id_cliente', $('#f-cli').value],
      ['id_ref', $('#f-ref').value],
      ['search', $('#f-q').value],
    ].filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const rs = await api('get', '/ops' + (params ? '?' + params : ''));
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
  main.innerHTML = `
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
          <tbody>${ap.data.map(a => `
            <tr class="border-t">
              <td class="p-2">${fmt.date(a.data)}</td>
              <td class="p-2 font-mono">${a.num_op}</td>
              <td class="p-2 text-right">${a.sequencia}</td>
              <td class="p-2">${a.desc_op}</td>
              <td class="p-2">${a.operador}</td>
              <td class="p-2 text-right">${fmt.int(a.qtd_boa)}</td>
              <td class="p-2 text-right">${fmt.int(a.qtd_refugo)}</td>
              <td class="p-2 text-right">${fmt.num(a.horas_trab, 1)}</td>
              <td class="p-2 text-right ${a.efic_real >= 0.85 ? 'text-emerald-600' : a.efic_real >= 0.7 ? 'text-amber-600' : 'text-red-600'}">${fmt.pct(a.efic_real)}</td>
              <td class="p-2 text-center"><button class="text-red-600" data-del="${a.id_apont}"><i class="fas fa-times"></i></button></td>
            </tr>`).join('')}
          </tbody>
        </table>
        ${!ap.data.length ? '<div class="text-center text-slate-500 p-6">Nenhum apontamento.</div>' : ''}
      </div>
    </div>`;
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
 * BOOTSTRAP
 * ============================================================ */
(function init() {
  renderLayout();
  const initial = (location.hash || '#dashboard').slice(1);
  navigate(initial || 'dashboard');
  window.addEventListener('hashchange', () => {
    const r = location.hash.slice(1) || 'dashboard';
    if (r !== state.route) navigate(r);
  });
})();
