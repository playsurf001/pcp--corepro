/* ============================================================================
 * Relatórios Detalhados — Módulo CorePro
 * Dashboard analítico + relatórios listáveis com filtros, gráficos e exports.
 * Depende de: window.fmt, window.toast, window.api, window.UI, ROUTES, state.
 * ============================================================================ */
(function () {
  'use strict';

  if (typeof ROUTES === 'undefined') return; // app.js ainda não carregou

  const RD = {
    // estado interno
    activeReport: 'dashboard',
    filters: {
      dt_ini: '', dt_fim: '',
      id_terc: '', id_servico: '', id_colecao: '',
      cor: '', cod_ref: '', num_op: '', status: '',
    },
    cache: {},
    charts: {}, // instâncias Chart.js
  };
  window.RD = RD;

  /* ----------- helpers ----------- */
  const fmtNum = (v) => (window.fmt?.num ? window.fmt.num(v) : (Number(v||0)).toFixed(2));
  const fmtInt = (v) => (window.fmt?.int ? window.fmt.int(v) : Math.round(Number(v||0)).toString());
  const fmtPct = (v) => (window.fmt?.pct ? window.fmt.pct(v) : ((Number(v||0)*100).toFixed(1) + '%'));
  const fmtDate = (v) => (window.fmt?.date ? window.fmt.date(v) : (v||''));
  const fmtMoney = (v) => 'R$ ' + fmtNum(v);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  /** Período padrão = mês atual */
  function defaultPeriodo() {
    const hoje = new Date();
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0,10);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).toISOString().slice(0,10);
    return { ini, fim };
  }

  function ensureFiltros() {
    if (!RD.filters.dt_ini || !RD.filters.dt_fim) {
      const p = defaultPeriodo();
      RD.filters.dt_ini = p.ini;
      RD.filters.dt_fim = p.fim;
    }
  }

  function buildQuery() {
    const f = RD.filters;
    const params = new URLSearchParams();
    Object.keys(f).forEach(k => { if (f[k]) params.set(k, f[k]); });
    return params.toString();
  }

  async function fetchAPI(path) {
    const sep = path.includes('?') ? '&' : '?';
    const qs = buildQuery();
    const url = `/api${path}${qs ? sep + qs : ''}`;
    const res = await axios.get(url, {
      headers: { Authorization: 'Bearer ' + (state.user?.token || localStorage.getItem('token') || '') }
    });
    if (!res.data?.ok) throw new Error(res.data?.error || 'Falha ao carregar');
    return res.data.data;
  }

  /* ----------- destruir gráficos ao trocar de relatório ----------- */
  function destroyCharts() {
    Object.values(RD.charts).forEach(ch => { try { ch.destroy(); } catch(_){} });
    RD.charts = {};
  }

  /* ============================================================
   * SUBMENU lateral / navegação interna
   * ============================================================ */
  const SUBMENU = [
    { id: 'dashboard',     label: 'Dashboard Analítico',       icon: 'fa-chart-line' },
    { id: 'remessas',      label: 'Relatório de Remessas',     icon: 'fa-truck-fast' },
    { id: 'retornos',      label: 'Relatório de Retornos',     icon: 'fa-truck-arrow-right' },
    { id: 'financeiro',    label: 'Relatório Financeiro',      icon: 'fa-money-bill-trend-up' },
    { id: 'por_terceirizado', label: 'Por Terceirizado',       icon: 'fa-handshake' },
    { id: 'por_servico',   label: 'Por Serviço',               icon: 'fa-cogs' },
    { id: 'por_produto',   label: 'Por Produto',               icon: 'fa-tshirt' },
    { id: 'por_cor',       label: 'Por Cor',                   icon: 'fa-palette' },
    { id: 'por_op',        label: 'Por OP',                    icon: 'fa-clipboard-list' },
    { id: 'faltas',        label: 'Relatório de Faltas',       icon: 'fa-triangle-exclamation' },
    { id: 'conserto',      label: 'Relatório de Conserto',     icon: 'fa-screwdriver-wrench' },
    { id: 'producao',      label: 'Relatório de Produção',     icon: 'fa-industry' },
    { id: 'ranking',       label: 'Ranking de Terceirizados',  icon: 'fa-trophy' },
    { id: 'historico',     label: 'Histórico Geral',           icon: 'fa-clock-rotate-left' },
    { id: 'exportacoes',   label: 'Exportações',               icon: 'fa-file-export' },
  ];

  function renderSubmenu() {
    return `
      <aside class="rd-submenu">
        <div class="rd-submenu__title">
          <i class="fa-solid fa-chart-pie"></i>
          <span>Relatórios Detalhados</span>
        </div>
        <nav class="rd-submenu__list">
          ${SUBMENU.map(s => `
            <a href="javascript:void(0)" class="rd-submenu__item ${RD.activeReport===s.id?'is-active':''}" data-report="${s.id}">
              <i class="fa-solid ${s.icon}"></i><span>${esc(s.label)}</span>
            </a>
          `).join('')}
        </nav>
      </aside>`;
  }

  /* ============================================================
   * Filtros avançados
   * ============================================================ */
  function renderFiltros(filtros) {
    const f = RD.filters;
    return `
      <div class="rd-filters card">
        <div class="rd-filters__head">
          <div class="rd-filters__title"><i class="fa-solid fa-filter"></i> Filtros Avançados</div>
          <button class="btn-ghost rd-filters__toggle" id="rdFltToggle" title="Mostrar/ocultar filtros">
            <i class="fa-solid fa-chevron-up"></i>
          </button>
        </div>
        <div class="rd-filters__body" id="rdFltBody">
          <div class="field"><label>Data Inicial</label>
            <input type="date" id="rd_dt_ini" value="${esc(f.dt_ini)}" />
          </div>
          <div class="field"><label>Data Final</label>
            <input type="date" id="rd_dt_fim" value="${esc(f.dt_fim)}" />
          </div>
          <div class="field"><label>Terceirizado</label>
            <select id="rd_id_terc"><option value="">Todos</option>
              ${(filtros?.terceirizados||[]).map(x=>`<option value="${x.id}" ${String(f.id_terc)==String(x.id)?'selected':''}>${esc(x.nome)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Serviço</label>
            <select id="rd_id_servico"><option value="">Todos</option>
              ${(filtros?.servicos||[]).map(x=>`<option value="${x.id}" ${String(f.id_servico)==String(x.id)?'selected':''}>${esc(x.nome)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Coleção</label>
            <select id="rd_id_colecao"><option value="">Todas</option>
              ${(filtros?.colecoes||[]).map(x=>`<option value="${x.id}" ${String(f.id_colecao)==String(x.id)?'selected':''}>${esc(x.nome)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Cor</label>
            <input type="text" id="rd_cor" list="rd_cores_dl" value="${esc(f.cor)}" placeholder="Qualquer" />
            <datalist id="rd_cores_dl">${(filtros?.cores||[]).map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
          </div>
          <div class="field"><label>Produto (referência)</label>
            <input type="text" id="rd_cod_ref" value="${esc(f.cod_ref)}" placeholder="Ex.: CAM-001" />
          </div>
          <div class="field"><label>Nº OP</label>
            <input type="text" id="rd_num_op" value="${esc(f.num_op)}" placeholder="Qualquer" />
          </div>
          <div class="field"><label>Status</label>
            <select id="rd_status"><option value="">Todos</option>
              ${(filtros?.status||[]).map(s=>`<option value="${s}" ${f.status===s?'selected':''}>${esc(s)}</option>`).join('')}
            </select>
          </div>
          <div class="rd-filters__actions">
            <button class="btn-primary" id="rdApplyFlt"><i class="fa-solid fa-magnifying-glass"></i> Aplicar</button>
            <button class="btn-ghost" id="rdResetFlt"><i class="fa-solid fa-rotate"></i> Limpar</button>
          </div>
        </div>
      </div>`;
  }

  function readFiltrosFromDom() {
    const get = id => (document.getElementById(id)?.value || '').trim();
    RD.filters.dt_ini    = get('rd_dt_ini');
    RD.filters.dt_fim    = get('rd_dt_fim');
    RD.filters.id_terc    = get('rd_id_terc');
    RD.filters.id_servico = get('rd_id_servico');
    RD.filters.id_colecao = get('rd_id_colecao');
    RD.filters.cor        = get('rd_cor');
    RD.filters.cod_ref    = get('rd_cod_ref');
    RD.filters.num_op     = get('rd_num_op');
    RD.filters.status     = get('rd_status');
  }

  /* ============================================================
   * Skeleton / Loading
   * ============================================================ */
  function skeleton(rows=6, cols=5) {
    return `<div class="rd-skel">
      ${Array.from({length: rows}).map(()=>`<div class="rd-skel__row">
        ${Array.from({length: cols}).map(()=>`<span></span>`).join('')}
      </div>`).join('')}
    </div>`;
  }

  /* ============================================================
   * Exportações: CSV / Excel / PDF
   * ============================================================ */
  function exportCSV(filename, headers, rows) {
    const sep = ';';
    const csv = [
      headers.join(sep),
      ...rows.map(r => r.map(v => {
        const s = String(v ?? '').replace(/"/g, '""');
        return /[;\n"]/.test(s) ? `"${s}"` : s;
      }).join(sep))
    ].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename + '.csv';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }

  function exportExcel(filename, headers, rows, sheetName='Relatório') {
    if (!window.XLSX) { toast?.('Biblioteca XLSX indisponível.', 'error'); return; }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0,31));
    XLSX.writeFile(wb, filename + '.xlsx');
  }

  function exportPDF(title, headers, rows) {
    if (!window.jspdf?.jsPDF) { toast?.('Biblioteca jsPDF indisponível.', 'error'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    // Cabeçalho com logo + título
    try { doc.addImage('/static/logo-full.png', 'PNG', 30, 18, 90, 28); } catch(_){}
    doc.setFontSize(14);
    doc.text(title, 140, 32);
    doc.setFontSize(9);
    const f = RD.filters;
    const filtroTxt = `Período: ${f.dt_ini} a ${f.dt_fim}` +
      (f.id_terc?` • Terc#${f.id_terc}`:'') +
      (f.id_servico?` • Serv#${f.id_servico}`:'') +
      (f.cor?` • Cor: ${f.cor}`:'') +
      (f.cod_ref?` • Ref: ${f.cod_ref}`:'') +
      (f.num_op?` • OP: ${f.num_op}`:'') +
      (f.status?` • Status: ${f.status}`:'');
    doc.text(filtroTxt, 140, 48);
    doc.text('Gerado em: ' + new Date().toLocaleString('pt-BR'), 140, 60);

    doc.autoTable({
      startY: 78,
      head: [headers],
      body: rows,
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [22, 30, 46], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: 30, right: 30 },
      didDrawPage: (data) => {
        const pageNum = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.text(`Página ${pageNum}`, doc.internal.pageSize.getWidth()-60, doc.internal.pageSize.getHeight()-15);
        doc.text('CorePro — Relatórios Detalhados', 30, doc.internal.pageSize.getHeight()-15);
      }
    });
    doc.save(title.replace(/\s+/g,'_') + '.pdf');
  }

  function exportButtons(rid) {
    return `<div class="rd-export">
      <button class="btn-ghost" data-export="pdf"   data-rid="${rid}"><i class="fa-solid fa-file-pdf"></i> PDF</button>
      <button class="btn-ghost" data-export="excel" data-rid="${rid}"><i class="fa-solid fa-file-excel"></i> Excel</button>
      <button class="btn-ghost" data-export="csv"   data-rid="${rid}"><i class="fa-solid fa-file-csv"></i> CSV</button>
      <button class="btn-ghost" data-export="print" data-rid="${rid}"><i class="fa-solid fa-print"></i> Imprimir</button>
    </div>`;
  }

  /* ============================================================
   * KPI card helper
   * ============================================================ */
  function kpiCard({ label, value, icon, accent='primary', sub='' }) {
    return `<div class="rd-kpi rd-kpi--${accent}">
      <div class="rd-kpi__icon"><i class="fa-solid ${icon}"></i></div>
      <div class="rd-kpi__body">
        <div class="rd-kpi__label">${esc(label)}</div>
        <div class="rd-kpi__value">${value}</div>
        ${sub ? `<div class="rd-kpi__sub">${sub}</div>` : ''}
      </div>
    </div>`;
  }

  /* ============================================================
   * GRÁFICOS — wrappers Chart.js
   * ============================================================ */
  function makeChart(canvasId, type, data, options={}) {
    const el = document.getElementById(canvasId);
    if (!el || !window.Chart) return;
    if (RD.charts[canvasId]) RD.charts[canvasId].destroy();
    RD.charts[canvasId] = new Chart(el, {
      type, data,
      options: Object.assign({
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#cbd5e1' } } },
        scales: type==='line' || type==='bar' ? {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.1)' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.1)' } }
        } : {}
      }, options)
    });
  }

  /* ============================================================
   * RENDERS — DASHBOARD ANALÍTICO
   * ============================================================ */
  async function renderDashboard(container) {
    container.innerHTML = `
      <div class="rd-section-title"><i class="fa-solid fa-chart-line"></i> Dashboard Analítico</div>
      <div class="rd-kpis-grid" id="rdKpisGrid">${skeleton(2,5)}</div>
      <div class="rd-charts-grid">
        <div class="card rd-chart"><div class="rd-chart__title">Produção por Período</div><div class="rd-chart__body"><canvas id="chProd"></canvas></div></div>
        <div class="card rd-chart"><div class="rd-chart__title">Pagamentos por Período</div><div class="rd-chart__body"><canvas id="chPag"></canvas></div></div>
        <div class="card rd-chart"><div class="rd-chart__title">Top 10 Serviços</div><div class="rd-chart__body"><canvas id="chServ"></canvas></div></div>
        <div class="card rd-chart"><div class="rd-chart__title">Top 10 Terceirizados</div><div class="rd-chart__body"><canvas id="chTerc"></canvas></div></div>
        <div class="card rd-chart"><div class="rd-chart__title">Faltas por Período</div><div class="rd-chart__body"><canvas id="chFalt"></canvas></div></div>
        <div class="card rd-chart"><div class="rd-chart__title">Retorno Mensal (12 meses)</div><div class="rd-chart__body"><canvas id="chMes"></canvas></div></div>
      </div>`;

    try {
      const data = await fetchAPI('/relatorios-det/dashboard');
      const k = data.kpis || {};
      const g = data.graficos || {};

      // KPI cards
      document.getElementById('rdKpisGrid').innerHTML = [
        kpiCard({ label:'Total Enviado',     value: fmtInt(k.total_enviado),    icon:'fa-paper-plane',  accent:'primary' }),
        kpiCard({ label:'Total Retornado',   value: fmtInt(k.total_retornado),  icon:'fa-arrow-right-arrow-left', accent:'info' }),
        kpiCard({ label:'Total Pago',        value: fmtMoney(k.total_pago),     icon:'fa-money-bill-wave', accent:'success' }),
        kpiCard({ label:'Total Faltas',      value: fmtInt(k.total_faltas),     icon:'fa-triangle-exclamation', accent:'danger' }),
        kpiCard({ label:'Total Consertos',   value: fmtInt(k.total_consertos),  icon:'fa-screwdriver-wrench', accent:'warning' }),
        kpiCard({ label:'Qtd. Remessas',     value: fmtInt(k.qtd_remessas),     icon:'fa-truck-fast',   accent:'primary' }),
        kpiCard({ label:'Qtd. Retornos',     value: fmtInt(k.qtd_retornos),     icon:'fa-truck-arrow-right', accent:'info' }),
        kpiCard({ label:'Prazo Médio',       value: fmtNum(k.prazo_medio) + ' dias', icon:'fa-clock', accent:'warning' }),
        kpiCard({ label:'Eficiência',        value: fmtPct(k.eficiencia),       icon:'fa-gauge-high',   accent:'success' }),
      ].join('');

      // Charts
      makeChart('chProd','line', {
        labels: (g.producao_periodo||[]).map(x=>x.dt),
        datasets: [
          { label:'Boas',     data:(g.producao_periodo||[]).map(x=>x.boa),     borderColor:'#22c55e', backgroundColor:'rgba(34,197,94,.15)', fill:true, tension:.3 },
          { label:'Falta',    data:(g.producao_periodo||[]).map(x=>x.falta),   borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,.15)', fill:true, tension:.3 },
          { label:'Conserto', data:(g.producao_periodo||[]).map(x=>x.conserto),borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,.15)', fill:true, tension:.3 },
        ]
      });
      makeChart('chPag','bar', {
        labels: (g.pagamentos_periodo||[]).map(x=>x.dt),
        datasets: [{ label:'Pago (R$)', data:(g.pagamentos_periodo||[]).map(x=>x.valor), backgroundColor:'#3b82f6' }]
      });
      makeChart('chServ','bar', {
        labels: (g.top_servicos||[]).map(x=>x.nome||'—'),
        datasets: [{ label:'Peças', data:(g.top_servicos||[]).map(x=>x.qtd), backgroundColor:'#8b5cf6' }]
      }, { indexAxis:'y' });
      makeChart('chTerc','bar', {
        labels: (g.top_terceirizados||[]).map(x=>x.nome||'—'),
        datasets: [{ label:'Enviado', data:(g.top_terceirizados||[]).map(x=>x.enviado), backgroundColor:'#06b6d4' }]
      }, { indexAxis:'y' });
      makeChart('chFalt','line', {
        labels: (g.faltas_periodo||[]).map(x=>x.dt),
        datasets: [{ label:'Faltas', data:(g.faltas_periodo||[]).map(x=>x.qtd), borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,.2)', fill:true, tension:.3 }]
      });
      makeChart('chMes','bar', {
        labels: (g.retorno_mensal||[]).map(x=>x.mes),
        datasets: [
          { label:'Boas', data:(g.retorno_mensal||[]).map(x=>x.boa), backgroundColor:'#22c55e' },
          { label:'Falta', data:(g.retorno_mensal||[]).map(x=>x.falta), backgroundColor:'#ef4444' },
        ]
      });
    } catch (e) {
      container.innerHTML = `<div class="card error">Erro ao carregar dashboard: ${esc(e.message)}</div>`;
    }
  }

  /* ============================================================
   * RENDERS — Listas (tabelas com export)
   * ============================================================ */
  function tableHTML(rid, cols, rows, opts={}) {
    const head = `<tr>${cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr>`;
    const body = rows.length
      ? rows.map(r => `<tr>${cols.map(c => {
          const v = typeof c.fmt === 'function' ? c.fmt(r[c.key], r) : (r[c.key] ?? '');
          return `<td${c.right?' class="t-right"':''}>${v}</td>`;
        }).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" class="rd-empty">Sem registros para os filtros aplicados.</td></tr>`;
    const totals = opts.totals ? `<tfoot><tr>${opts.totals.map(t=>`<td${t.right?' class="t-right":""'}>${t.value}</td>`).join('')}</tr></tfoot>` : '';
    return `<div class="rd-table-wrap"><table class="rd-table" id="${rid}"><thead>${head}</thead><tbody>${body}</tbody>${totals}</table></div>`;
  }

  function setupExportHandlers(rid, title, cols, rows) {
    const root = document.querySelector(`[data-rid="${rid}"]`)?.parentElement || document;
    document.querySelectorAll(`[data-rid="${rid}"]`).forEach(btn => {
      btn.onclick = () => {
        const headers = cols.map(c=>c.label);
        const data = rows.map(r => cols.map(c => {
          const v = typeof c.exportFmt === 'function' ? c.exportFmt(r[c.key], r) : (typeof c.fmt==='function' ? String(c.fmt(r[c.key],r)).replace(/<[^>]+>/g,'') : (r[c.key]??''));
          return v;
        }));
        const type = btn.dataset.export;
        const fname = title.replace(/\s+/g,'_') + '_' + (RD.filters.dt_ini||'') + '_a_' + (RD.filters.dt_fim||'');
        if (type==='csv')   exportCSV(fname, headers, data);
        if (type==='excel') exportExcel(fname, headers, data);
        if (type==='pdf')   exportPDF(title, headers, data);
        if (type==='print') window.print();
      };
    });
  }

  async function renderListaGenerica({ container, title, endpoint, cols, summaryFn }) {
    const rid = 'tbl_' + Math.random().toString(36).slice(2,8);
    container.innerHTML = `
      <div class="rd-section-title"><i class="fa-solid fa-table"></i> ${esc(title)}</div>
      <div class="rd-toolbar">${exportButtons(rid)}</div>
      <div class="card rd-list">${skeleton(8,6)}</div>`;
    try {
      const data = await fetchAPI(endpoint);
      const rows = data.rows || [];
      const summary = summaryFn ? summaryFn(rows) : '';
      container.querySelector('.rd-list').innerHTML = `
        ${summary}
        ${tableHTML(rid, cols, rows)}
      `;
      setupExportHandlers(rid, title, cols, rows);
    } catch(e) {
      container.querySelector('.rd-list').innerHTML = `<div class="error">Erro: ${esc(e.message)}</div>`;
    }
  }

  /* ===== Definições de cada relatório ===== */
  function reportRemessas(c)  {
    return renderListaGenerica({
      container: c, title: 'Relatório de Remessas',
      endpoint: '/relatorios-det/remessas',
      cols: [
        { key:'num_controle', label:'Nº', fmt: v => `<b>#${v||''}</b>` },
        { key:'num_op',       label:'OP' },
        { key:'cod_ref',      label:'Referência' },
        { key:'desc_ref',     label:'Produto' },
        { key:'cor',          label:'Cor' },
        { key:'desc_servico', label:'Serviço' },
        { key:'nome_terc',    label:'Terceirizado' },
        { key:'qtd_total',    label:'Qtd', right:true, fmt:v=>fmtInt(v) },
        { key:'preco_unit',   label:'Preço', right:true, fmt:v=>fmtMoney(v) },
        { key:'valor_total',  label:'Valor', right:true, fmt:v=>fmtMoney(v) },
        { key:'dt_saida',     label:'Saída', fmt:v=>fmtDate(v) },
        { key:'dt_previsao',  label:'Previsão', fmt:v=>fmtDate(v) },
        { key:'status',       label:'Status', fmt:v=>`<span class="rd-badge">${esc(v||'')}</span>` },
      ],
      summaryFn: rows => {
        const tQ = rows.reduce((a,r)=>a+(+r.qtd_total||0),0);
        const tV = rows.reduce((a,r)=>a+(+r.valor_total||0),0);
        return `<div class="rd-summary">
          <span><b>${rows.length}</b> remessas</span>
          <span>Total enviado: <b>${fmtInt(tQ)}</b></span>
          <span>Valor total: <b>${fmtMoney(tV)}</b></span>
        </div>`;
      }
    });
  }

  function reportRetornos(c) {
    return renderListaGenerica({
      container: c, title: 'Relatório de Retornos',
      endpoint: '/relatorios-det/retornos',
      cols: [
        { key:'num_controle', label:'Remessa', fmt:v=>`<b>#${v||''}</b>` },
        { key:'cod_ref',      label:'Ref' },
        { key:'desc_ref',     label:'Produto' },
        { key:'cor',          label:'Cor' },
        { key:'qtd_enviada',  label:'Enviado', right:true, fmt:v=>fmtInt(v) },
        { key:'qtd_boa',      label:'Retornado', right:true, fmt:v=>`<b style="color:#22c55e">${fmtInt(v)}</b>` },
        { key:'qtd_refugo',   label:'Falta', right:true, fmt:v=>`<span style="color:#ef4444">${fmtInt(v)}</span>` },
        { key:'qtd_conserto', label:'Conserto', right:true, fmt:v=>`<span style="color:#f59e0b">${fmtInt(v)}</span>` },
        { key:'valor_pago',   label:'Pago', right:true, fmt:v=>fmtMoney(v) },
        { key:'dt_retorno',   label:'Data Retorno', fmt:v=>fmtDate(v) },
        { key:'dias_decorridos', label:'Prazo (d)', right:true, fmt:v=>fmtInt(v) },
      ],
      summaryFn: rows => {
        const tB = rows.reduce((a,r)=>a+(+r.qtd_boa||0),0);
        const tF = rows.reduce((a,r)=>a+(+r.qtd_refugo||0),0);
        const tC = rows.reduce((a,r)=>a+(+r.qtd_conserto||0),0);
        const tV = rows.reduce((a,r)=>a+(+r.valor_pago||0),0);
        return `<div class="rd-summary">
          <span>Boas: <b style="color:#22c55e">${fmtInt(tB)}</b></span>
          <span>Falta: <b style="color:#ef4444">${fmtInt(tF)}</b></span>
          <span>Conserto: <b style="color:#f59e0b">${fmtInt(tC)}</b></span>
          <span>Total Pago: <b>${fmtMoney(tV)}</b></span>
        </div>`;
      }
    });
  }

  async function reportFinanceiro(c) {
    c.innerHTML = `
      <div class="rd-section-title"><i class="fa-solid fa-money-bill-trend-up"></i> Relatório Financeiro</div>
      <div class="rd-toolbar">${exportButtons('tbl_fin')}</div>
      <div id="rdFinBox" class="rd-fin-box">${skeleton(4,3)}</div>`;
    try {
      const data = await fetchAPI('/relatorios-det/financeiro');
      const t = data.totais || {};
      const box = document.getElementById('rdFinBox');
      box.innerHTML = `
        <div class="rd-kpis-grid">
          ${kpiCard({label:'Valor Total', value:fmtMoney(t.valor_total), icon:'fa-money-bill', accent:'primary'})}
          ${kpiCard({label:'Pago',        value:fmtMoney(t.valor_pago),  icon:'fa-circle-check', accent:'success'})}
          ${kpiCard({label:'Pendente',    value:fmtMoney(t.valor_pendente), icon:'fa-hourglass-half', accent:'warning'})}
        </div>
        <div class="rd-charts-grid">
          <div class="card rd-chart"><div class="rd-chart__title">Custo por Serviço</div><div class="rd-chart__body"><canvas id="finServ"></canvas></div></div>
          <div class="card rd-chart"><div class="rd-chart__title">Custo por Terceirizado</div><div class="rd-chart__body"><canvas id="finTerc"></canvas></div></div>
          <div class="card rd-chart"><div class="rd-chart__title">Custo por Período</div><div class="rd-chart__body"><canvas id="finPer"></canvas></div></div>
          <div class="card rd-chart"><div class="rd-chart__title">Top Produtos</div><div class="rd-chart__body"><canvas id="finProd"></canvas></div></div>
        </div>
        <div class="card">
          ${tableHTML('tbl_fin', [
            { key:'nome',  label:'Serviço' },
            { key:'qtd',   label:'Qtd', right:true, fmt:v=>fmtInt(v) },
            { key:'valor', label:'Valor', right:true, fmt:v=>fmtMoney(v) },
            { key:'pago',  label:'Pago',  right:true, fmt:v=>fmtMoney(v) },
          ], data.por_servico||[])}
        </div>`;
      makeChart('finServ','pie', {
        labels: (data.por_servico||[]).map(x=>x.nome||'—'),
        datasets: [{ data:(data.por_servico||[]).map(x=>x.valor), backgroundColor:['#3b82f6','#8b5cf6','#06b6d4','#22c55e','#f59e0b','#ef4444','#ec4899','#10b981'] }]
      });
      makeChart('finTerc','bar', {
        labels: (data.por_terceirizado||[]).map(x=>x.nome||'—'),
        datasets: [{ label:'Pago', data:(data.por_terceirizado||[]).map(x=>x.pago), backgroundColor:'#22c55e' }]
      }, { indexAxis:'y' });
      makeChart('finPer','line', {
        labels: (data.por_periodo||[]).map(x=>x.mes),
        datasets: [
          { label:'Total', data:(data.por_periodo||[]).map(x=>x.valor), borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,.15)', fill:true, tension:.3 },
          { label:'Pago',  data:(data.por_periodo||[]).map(x=>x.pago),  borderColor:'#22c55e', backgroundColor:'rgba(34,197,94,.15)', fill:true, tension:.3 },
        ]
      });
      makeChart('finProd','bar', {
        labels: (data.por_produto||[]).slice(0,15).map(x=>x.cod_ref),
        datasets: [{ label:'Valor', data:(data.por_produto||[]).slice(0,15).map(x=>x.valor), backgroundColor:'#8b5cf6' }]
      });
      // Export usa por_servico
      setupExportHandlers('tbl_fin', 'Relatorio_Financeiro', [
        { key:'nome', label:'Serviço' }, { key:'qtd', label:'Qtd', fmt:v=>fmtInt(v) },
        { key:'valor', label:'Valor', fmt:v=>fmtNum(v) }, { key:'pago', label:'Pago', fmt:v=>fmtNum(v) },
      ], data.por_servico||[]);
    } catch(e) {
      c.innerHTML = `<div class="card error">Erro: ${esc(e.message)}</div>`;
    }
  }

  function reportPorTerc(c) {
    return renderListaGenerica({
      container: c, title: 'Relatório por Terceirizado',
      endpoint: '/relatorios-det/por-terceirizado',
      cols: [
        { key:'nome_terc',     label:'Terceirizado', fmt:v=>`<b>${esc(v||'')}</b>` },
        { key:'qtd_remessas',  label:'Remessas', right:true, fmt:v=>fmtInt(v) },
        { key:'total_enviado', label:'Enviado',  right:true, fmt:v=>fmtInt(v) },
        { key:'total_recebido',label:'Recebido', right:true, fmt:v=>fmtInt(v) },
        { key:'total_faltas',  label:'Faltas',   right:true, fmt:v=>fmtInt(v) },
        { key:'total_consertos',label:'Consertos',right:true, fmt:v=>fmtInt(v) },
        { key:'total_pago',    label:'Pago',     right:true, fmt:v=>fmtMoney(v) },
        { key:'prazo_medio',   label:'Prazo',    right:true, fmt:v=>fmtNum(v)+' d' },
        { key:'efic_media',    label:'Eficiência',right:true, fmt:v=>fmtPct(v) },
      ]
    });
  }

  function reportPorServ(c) {
    return renderListaGenerica({
      container: c, title: 'Relatório por Serviço',
      endpoint: '/relatorios-det/por-servico',
      cols: [
        { key:'desc_servico',  label:'Serviço', fmt:v=>`<b>${esc(v||'')}</b>` },
        { key:'qtd_remessas',  label:'Remessas', right:true, fmt:v=>fmtInt(v) },
        { key:'qtd_total',     label:'Qtd Enviada', right:true, fmt:v=>fmtInt(v) },
        { key:'qtd_produzida', label:'Produzida', right:true, fmt:v=>fmtInt(v) },
        { key:'valor_total',   label:'Valor Total', right:true, fmt:v=>fmtMoney(v) },
        { key:'valor_pago',    label:'Pago', right:true, fmt:v=>fmtMoney(v) },
        { key:'tempo_medio',   label:'Tempo Médio (s)', right:true, fmt:v=>fmtNum(v) },
      ]
    });
  }

  function reportPorProd(c) {
    return renderListaGenerica({
      container: c, title: 'Relatório por Produto',
      endpoint: '/relatorios-det/por-produto',
      cols: [
        { key:'cod_ref',         label:'Referência', fmt:v=>`<b>${esc(v||'')}</b>` },
        { key:'desc_ref',        label:'Descrição' },
        { key:'cores',           label:'Cores' },
        { key:'qtd_remessas',    label:'Remessas', right:true, fmt:v=>fmtInt(v) },
        { key:'total_enviado',   label:'Enviado', right:true, fmt:v=>fmtInt(v) },
        { key:'total_retornado', label:'Retornado', right:true, fmt:v=>fmtInt(v) },
        { key:'total_faltas',    label:'Faltas', right:true, fmt:v=>fmtInt(v) },
        { key:'valor_total',     label:'Custo', right:true, fmt:v=>fmtMoney(v) },
        { key:'valor_pago',      label:'Pago', right:true, fmt:v=>fmtMoney(v) },
      ]
    });
  }

  function reportPorCor(c) {
    return renderListaGenerica({
      container: c, title: 'Relatório por Cor',
      endpoint: '/relatorios-det/por-cor',
      cols: [
        { key:'cor', label:'Cor', fmt:v=>`<span class="rd-color-pill">${esc(v||'')}</span>` },
        { key:'qtd_remessas', label:'Remessas', right:true, fmt:v=>fmtInt(v) },
        { key:'qtd_enviada',  label:'Enviado', right:true, fmt:v=>fmtInt(v) },
        { key:'qtd_retornada',label:'Retornado', right:true, fmt:v=>fmtInt(v) },
        { key:'qtd_faltas',   label:'Faltas', right:true, fmt:v=>fmtInt(v) },
        { key:'custo',        label:'Custo', right:true, fmt:v=>fmtMoney(v) },
      ]
    });
  }

  function reportPorOP(c) {
    return renderListaGenerica({
      container: c, title: 'Relatório por OP',
      endpoint: '/relatorios-det/por-op',
      cols: [
        { key:'num_op',       label:'Nº OP', fmt:v=>`<b>${esc(v||'')}</b>` },
        { key:'qtd_remessas', label:'Remessas', right:true, fmt:v=>fmtInt(v) },
        { key:'qtd_enviada',  label:'Enviado', right:true, fmt:v=>fmtInt(v) },
        { key:'qtd_retornada',label:'Retornado', right:true, fmt:v=>fmtInt(v) },
        { key:'qtd_faltas',   label:'Faltas', right:true, fmt:v=>fmtInt(v) },
        { key:'valor_total',  label:'Valor', right:true, fmt:v=>fmtMoney(v) },
        { key:'valor_pago',   label:'Pago', right:true, fmt:v=>fmtMoney(v) },
        { key:'dt_inicio',    label:'Início', fmt:v=>fmtDate(v) },
        { key:'dt_fim',       label:'Última Mov', fmt:v=>fmtDate(v) },
      ]
    });
  }

  function reportFaltas(c) {
    return renderListaGenerica({
      container: c, title: 'Relatório de Faltas',
      endpoint: '/relatorios-det/faltas',
      cols: [
        { key:'dt_retorno', label:'Data', fmt:v=>fmtDate(v) },
        { key:'cod_ref',    label:'Ref' },
        { key:'desc_ref',   label:'Produto' },
        { key:'cor',        label:'Cor' },
        { key:'qtd',        label:'Qtd', right:true, fmt:v=>`<b style="color:#ef4444">${fmtInt(v)}</b>` },
        { key:'nome_terc',  label:'Terceirizado' },
        { key:'num_op',     label:'OP' },
        { key:'observacao', label:'Observação' },
      ]
    });
  }

  function reportConserto(c) {
    return renderListaGenerica({
      container: c, title: 'Relatório de Conserto',
      endpoint: '/relatorios-det/conserto',
      cols: [
        { key:'dt_retorno',   label:'Data', fmt:v=>fmtDate(v) },
        { key:'cod_ref',      label:'Ref' },
        { key:'desc_ref',     label:'Produto' },
        { key:'desc_servico', label:'Serviço' },
        { key:'qtd',          label:'Qtd', right:true, fmt:v=>`<b style="color:#f59e0b">${fmtInt(v)}</b>` },
        { key:'nome_terc',    label:'Terceirizado' },
        { key:'custo',        label:'Custo', right:true, fmt:v=>fmtMoney(v) },
        { key:'observacao',   label:'Observação' },
      ]
    });
  }

  function reportProducao(c) {
    return renderListaGenerica({
      container: c, title: 'Relatório de Produção',
      endpoint: '/relatorios-det/producao',
      cols: [
        { key:'dt',           label:'Data', fmt:v=>fmtDate(v) },
        { key:'qtd_remessas', label:'Remessas', right:true, fmt:v=>fmtInt(v) },
        { key:'qtd_boa',      label:'Boas', right:true, fmt:v=>`<b style="color:#22c55e">${fmtInt(v)}</b>` },
        { key:'qtd_falta',    label:'Falta', right:true, fmt:v=>`<span style="color:#ef4444">${fmtInt(v)}</span>` },
        { key:'qtd_conserto', label:'Conserto', right:true, fmt:v=>`<span style="color:#f59e0b">${fmtInt(v)}</span>` },
        { key:'valor_pago',   label:'Pago', right:true, fmt:v=>fmtMoney(v) },
      ]
    });
  }

  function reportRanking(c) {
    return renderListaGenerica({
      container: c, title: 'Ranking de Terceirizados',
      endpoint: '/relatorios-det/ranking',
      cols: [
        { key:'nome_terc',     label:'Terceirizado', fmt:(v,r)=>`<b>${esc(v||'')}</b>` },
        { key:'qtd_remessas',  label:'Remessas', right:true, fmt:v=>fmtInt(v) },
        { key:'qtd_produzida', label:'Produzida', right:true, fmt:v=>`<b style="color:#22c55e">${fmtInt(v)}</b>` },
        { key:'qtd_faltas',    label:'Faltas', right:true, fmt:v=>fmtInt(v) },
        { key:'taxa_falta',    label:'% Falta', right:true, fmt:v=>fmtPct(v) },
        { key:'valor_pago',    label:'Pago', right:true, fmt:v=>fmtMoney(v) },
        { key:'efic_media',    label:'Eficiência', right:true, fmt:v=>fmtPct(v) },
      ]
    });
  }

  function reportHistorico(c) {
    return renderListaGenerica({
      container: c, title: 'Histórico Geral',
      endpoint: '/relatorios-det/historico',
      cols: [
        { key:'dt',         label:'Data', fmt:v=>fmtDate(v) },
        { key:'tipo',       label:'Tipo', fmt:v=>`<span class="rd-badge ${v==='RETORNO'?'rd-badge--info':'rd-badge--primary'}">${esc(v)}</span>` },
        { key:'num',        label:'Nº', fmt:v=>`<b>#${v||''}</b>` },
        { key:'cod_ref',    label:'Ref' },
        { key:'cor',        label:'Cor' },
        { key:'qtd',        label:'Qtd', right:true, fmt:v=>fmtInt(v) },
        { key:'valor',      label:'Valor', right:true, fmt:v=>fmtMoney(v) },
        { key:'status',     label:'Status' },
        { key:'nome_terc',  label:'Terceirizado' },
      ]
    });
  }

  function reportExportacoes(c) {
    c.innerHTML = `
      <div class="rd-section-title"><i class="fa-solid fa-file-export"></i> Exportações em Lote</div>
      <div class="card">
        <p class="muted">Exporte os principais relatórios em PDF, Excel ou CSV utilizando os filtros aplicados.</p>
        <div class="rd-export-grid">
          ${[
            { id:'remessas', label:'Remessas', icon:'fa-truck-fast' },
            { id:'retornos', label:'Retornos', icon:'fa-truck-arrow-right' },
            { id:'financeiro', label:'Financeiro', icon:'fa-money-bill-wave' },
            { id:'por-terceirizado', label:'Por Terceirizado', icon:'fa-handshake' },
            { id:'por-servico', label:'Por Serviço', icon:'fa-cogs' },
            { id:'por-produto', label:'Por Produto', icon:'fa-tshirt' },
            { id:'por-cor', label:'Por Cor', icon:'fa-palette' },
            { id:'por-op', label:'Por OP', icon:'fa-clipboard-list' },
            { id:'faltas', label:'Faltas', icon:'fa-triangle-exclamation' },
            { id:'conserto', label:'Conserto', icon:'fa-screwdriver-wrench' },
            { id:'ranking', label:'Ranking', icon:'fa-trophy' },
          ].map(x => `
            <div class="rd-export-card">
              <div class="rd-export-card__head"><i class="fa-solid ${x.icon}"></i><span>${esc(x.label)}</span></div>
              <div class="rd-export-card__body">
                <button class="btn-ghost" data-bulk-export="${x.id}" data-fmt="pdf"><i class="fa-solid fa-file-pdf"></i> PDF</button>
                <button class="btn-ghost" data-bulk-export="${x.id}" data-fmt="excel"><i class="fa-solid fa-file-excel"></i> Excel</button>
                <button class="btn-ghost" data-bulk-export="${x.id}" data-fmt="csv"><i class="fa-solid fa-file-csv"></i> CSV</button>
              </div>
            </div>`).join('')}
        </div>
      </div>`;

    c.querySelectorAll('[data-bulk-export]').forEach(btn => {
      btn.onclick = async () => {
        const ep = btn.dataset.bulkExport;
        const fmt = btn.dataset.fmt;
        try {
          btn.disabled = true; btn.classList.add('is-loading');
          const data = await fetchAPI('/relatorios-det/' + ep);
          const rows = data.rows || data.por_servico || [];
          if (!rows.length) { toast?.('Sem dados para exportar.', 'warning'); return; }
          const headers = Object.keys(rows[0]);
          const out = rows.map(r => headers.map(h => r[h] ?? ''));
          const fname = `${ep}_${RD.filters.dt_ini}_a_${RD.filters.dt_fim}`;
          if (fmt==='pdf')   exportPDF(`Relatório ${ep}`, headers, out);
          if (fmt==='excel') exportExcel(fname, headers, out);
          if (fmt==='csv')   exportCSV(fname, headers, out);
          toast?.('Exportação concluída.', 'success');
        } catch(e) {
          toast?.('Erro: ' + e.message, 'error');
        } finally {
          btn.disabled = false; btn.classList.remove('is-loading');
        }
      };
    });
  }

  /* ============================================================
   * Roteador interno
   * ============================================================ */
  const REPORTS = {
    dashboard:        renderDashboard,
    remessas:         reportRemessas,
    retornos:         reportRetornos,
    financeiro:       reportFinanceiro,
    por_terceirizado: reportPorTerc,
    por_servico:      reportPorServ,
    por_produto:      reportPorProd,
    por_cor:          reportPorCor,
    por_op:           reportPorOP,
    faltas:           reportFaltas,
    conserto:         reportConserto,
    producao:         reportProducao,
    ranking:          reportRanking,
    historico:        reportHistorico,
    exportacoes:      reportExportacoes,
  };

  async function renderActiveReport() {
    destroyCharts();
    const container = document.getElementById('rdContent');
    if (!container) return;
    container.innerHTML = `<div class="card">${skeleton(6,5)}</div>`;
    const fn = REPORTS[RD.activeReport] || REPORTS.dashboard;
    await fn(container);
  }

  /* ============================================================
   * Rota principal — ROUTES.relatorios_detalhados
   * ============================================================ */
  ROUTES.relatorios_detalhados = async (main) => {
    // permissão (admin/gerente)
    const perfil = state.user?.perfil || '';
    if (perfil !== 'admin' && perfil !== 'gerente') {
      main.innerHTML = `<div class="card error">
        <i class="fa-solid fa-lock"></i> Acesso restrito a administradores e gerentes.
      </div>`;
      return;
    }

    ensureFiltros();

    main.innerHTML = `
      <div class="rd-page">
        <div class="rd-header">
          <div>
            <h1><i class="fa-solid fa-chart-pie"></i> Relatórios Detalhados</h1>
            <p class="muted">Análises completas, gráficos interativos e exportações profissionais.</p>
          </div>
        </div>
        <div class="rd-grid">
          ${renderSubmenu()}
          <main class="rd-main">
            <div id="rdFilterSlot"></div>
            <div id="rdContent"><div class="card">${skeleton(6,5)}</div></div>
          </main>
        </div>
      </div>`;

    // Carrega filtros e renderiza
    let filtros = {};
    try {
      filtros = await fetchAPI('/relatorios-det/filtros');
    } catch(e) { /* segue sem filtros opcionais */ }

    document.getElementById('rdFilterSlot').innerHTML = renderFiltros(filtros);

    // Submenu click
    main.querySelectorAll('[data-report]').forEach(a => {
      a.onclick = () => {
        RD.activeReport = a.dataset.report;
        main.querySelectorAll('[data-report]').forEach(x => x.classList.toggle('is-active', x.dataset.report===RD.activeReport));
        renderActiveReport();
      };
    });

    // Toggle filtros
    document.getElementById('rdFltToggle').onclick = () => {
      document.getElementById('rdFltBody').classList.toggle('is-collapsed');
      const ic = document.querySelector('#rdFltToggle i');
      if (ic) ic.classList.toggle('fa-chevron-up'), ic.classList.toggle('fa-chevron-down');
    };

    // Aplicar filtros
    document.getElementById('rdApplyFlt').onclick = () => {
      readFiltrosFromDom();
      renderActiveReport();
      toast?.('Filtros aplicados.', 'info');
    };
    document.getElementById('rdResetFlt').onclick = () => {
      RD.filters = { dt_ini:'', dt_fim:'', id_terc:'', id_servico:'', id_colecao:'', cor:'', cod_ref:'', num_op:'', status:'' };
      ensureFiltros();
      ['rd_id_terc','rd_id_servico','rd_id_colecao','rd_cor','rd_cod_ref','rd_num_op','rd_status'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      document.getElementById('rd_dt_ini').value = RD.filters.dt_ini;
      document.getElementById('rd_dt_fim').value = RD.filters.dt_fim;
      renderActiveReport();
    };

    // Render inicial
    await renderActiveReport();
  };

})();
