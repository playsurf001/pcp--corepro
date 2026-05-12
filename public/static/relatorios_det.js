/* ============================================================================
 * Relatórios — CorePro Premium Executive Dashboard
 * 4 áreas: Resumo Executivo • Gráficos Analíticos • Tabela Detalhada • Exportação
 * Visível para todos os usuários (gating removido — controle por NAV.tercOnly).
 * Depende de: window.fmt, window.toast, ROUTES, state, axios, Chart, jsPDF, XLSX
 * ============================================================================ */
(function () {
  'use strict';

  if (typeof ROUTES === 'undefined') return;

  const RD = {
    filters: {
      dt_ini: '', dt_fim: '',
      id_terc: '', id_servico: '', id_colecao: '',
      cor: '', cod_ref: '', num_op: '', status: '',
      busca: '',
    },
    cache: { dashboard: null, remessas: null, retornos: null, filtros: null },
    charts: {},
    table: {
      page: 1,
      perPage: 25,
      sortKey: 'dt_saida',
      sortDir: 'desc',
      search: '',
    },
    favoritos: [],
  };
  window.RD = RD;

  /* ---------- helpers ---------- */
  const fmtNum   = v => (window.fmt?.num   ? window.fmt.num(v)   : (Number(v||0)).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}));
  const fmtInt   = v => (window.fmt?.int   ? window.fmt.int(v)   : Math.round(Number(v||0)).toLocaleString('pt-BR'));
  const fmtPct   = v => {
    const n = Number(v||0);
    const pct = n <= 1 ? n * 100 : n;
    return pct.toFixed(1) + '%';
  };
  const fmtDate  = v => (window.fmt?.date  ? window.fmt.date(v)  : (v ? String(v).slice(0,10).split('-').reverse().join('/') : ''));
  const fmtMoney = v => 'R$ ' + fmtNum(v);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const debounce = (fn, ms=250) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

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
    Object.keys(f).forEach(k => { if (k !== 'busca' && f[k]) params.set(k, f[k]); });
    return params.toString();
  }
  async function fetchAPI(path) {
    const sep = path.includes('?') ? '&' : '?';
    const qs = buildQuery();
    const url = `/api${path}${qs ? sep + qs : ''}`;
    // CRÍTICO: usar a mesma chave que o app principal (AUTH.getToken)
    const token =
      (window.AUTH && typeof window.AUTH.getToken === 'function' ? window.AUTH.getToken() : '') ||
      localStorage.getItem('pcp_token') ||
      (window.state && window.state.user && window.state.user.token) ||
      localStorage.getItem('token') ||
      '';
    try {
      const res = await axios.get(url, {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        timeout: 30000,
      });
      if (!res.data?.ok) throw new Error(res.data?.error || 'Falha ao carregar');
      return res.data.data;
    } catch (e) {
      const status = e.response?.status;
      const code = e.response?.data?.code;
      const msg = e.response?.data?.error || e.message || 'Falha ao carregar';
      // Log estruturado para debug
      console.error('[RD.fetchAPI]', path, 'status=' + status, 'code=' + code, '→', msg);
      // Repassa Error com mensagem amigável
      const err = new Error(msg);
      err.status = status;
      err.code = code;
      throw err;
    }
  }

  function destroyCharts() {
    Object.values(RD.charts).forEach(ch => { try { ch.destroy(); } catch(_){} });
    RD.charts = {};
  }

  /* ---------- favoritos (localStorage) ---------- */
  const FAV_KEY = 'rd_favoritos_v1';
  function loadFavoritos() {
    try { RD.favoritos = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); }
    catch(_) { RD.favoritos = []; }
  }
  function saveFavoritos() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(RD.favoritos)); } catch(_){}
  }
  function snapshotFiltros() {
    return JSON.parse(JSON.stringify(RD.filters));
  }

  /* ============================================================
   * SKELETON
   * ============================================================ */
  function skeletonKPIs() {
    return Array.from({length:6}).map(()=>`<div class="rd-kpi-sk"></div>`).join('');
  }
  function skeletonChart() {
    return `<div class="rd-chart-sk"></div>`;
  }
  function skeletonTable(rows=8, cols=8) {
    return `<div class="rd-tbl-sk">
      ${Array.from({length:rows}).map(()=>`<div class="rd-tbl-sk__row">${Array.from({length:cols}).map(()=>`<span></span>`).join('')}</div>`).join('')}
    </div>`;
  }

  /* ============================================================
   * HEADER
   * ============================================================ */
  function renderHeader() {
    return `
      <div class="rd2-header">
        <div class="rd2-header__left">
          <div class="rd2-breadcrumb">
            <i class="fa-solid fa-chart-pie"></i>
            <span>Análises</span>
            <i class="fa-solid fa-angle-right rd2-breadcrumb__sep"></i>
            <span class="rd2-breadcrumb__current">Relatórios</span>
          </div>
          <h1 class="rd2-title">Relatórios Executivos</h1>
          <p class="rd2-subtitle">Visão analítica completa — produção, financeiro, qualidade e desempenho.</p>
        </div>
        <div class="rd2-header__actions">
          <button class="rd2-btn rd2-btn--ghost" id="rd2BtnRefresh" title="Atualizar dados">
            <i class="fa-solid fa-arrows-rotate"></i><span>Atualizar</span>
          </button>
          <button class="rd2-btn rd2-btn--ghost" id="rd2BtnPrint" title="Imprimir relatório">
            <i class="fa-solid fa-print"></i><span>Imprimir</span>
          </button>
          <button class="rd2-btn rd2-btn--ghost" id="rd2BtnExcel" title="Exportar Excel">
            <i class="fa-solid fa-file-excel"></i><span>Excel</span>
          </button>
          <button class="rd2-btn rd2-btn--primary" id="rd2BtnPDF" title="Gerar PDF Executivo">
            <i class="fa-solid fa-file-pdf"></i><span>Gerar PDF</span>
          </button>
        </div>
      </div>`;
  }

  /* ============================================================
   * FILTER BAR PREMIUM
   * ============================================================ */
  function renderFilterBar(filtros) {
    const f = RD.filters;
    const favs = RD.favoritos || [];
    return `
      <div class="rd2-filterbar">
        <div class="rd2-filterbar__row rd2-filterbar__row--main">
          <div class="rd2-search">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="rd2_busca" placeholder="Buscar por OP, referência, produto, cor..." value="${esc(f.busca||'')}">
          </div>
          <div class="rd2-quickfilters">
            <button class="rd2-chip" data-period="hoje"><i class="fa-regular fa-calendar"></i> Hoje</button>
            <button class="rd2-chip" data-period="7d">7 dias</button>
            <button class="rd2-chip" data-period="30d">30 dias</button>
            <button class="rd2-chip" data-period="mes">Este mês</button>
            <button class="rd2-chip" data-period="ano">Ano</button>
          </div>
          <div class="rd2-fav-wrap">
            <button class="rd2-btn rd2-btn--ghost rd2-btn--sm" id="rd2FavMenu">
              <i class="fa-regular fa-star"></i><span>Favoritos</span>
              <i class="fa-solid fa-caret-down"></i>
            </button>
            <div class="rd2-fav-menu" id="rd2FavList" hidden>
              <div class="rd2-fav-menu__hd">Filtros salvos</div>
              <div class="rd2-fav-menu__items" id="rd2FavItems">
                ${favs.length ? favs.map((x,i)=>`
                  <div class="rd2-fav-item" data-fav="${i}">
                    <span><i class="fa-solid fa-star"></i> ${esc(x.nome)}</span>
                    <button class="rd2-fav-del" data-fav-del="${i}" title="Remover"><i class="fa-solid fa-xmark"></i></button>
                  </div>`).join('') : `<div class="rd2-fav-empty">Nenhum favorito salvo.</div>`}
              </div>
              <button class="rd2-fav-add" id="rd2FavAdd"><i class="fa-solid fa-plus"></i> Salvar filtros atuais</button>
            </div>
          </div>
        </div>
        <div class="rd2-filterbar__row rd2-filterbar__row--fields">
          <div class="rd2-field">
            <label>De</label>
            <input type="date" id="rd2_dt_ini" value="${esc(f.dt_ini)}">
          </div>
          <div class="rd2-field">
            <label>Até</label>
            <input type="date" id="rd2_dt_fim" value="${esc(f.dt_fim)}">
          </div>
          <div class="rd2-field">
            <label>Terceirizado</label>
            <select id="rd2_id_terc">
              <option value="">Todos</option>
              ${(filtros?.terceirizados||[]).map(x=>`<option value="${x.id}" ${String(f.id_terc)==String(x.id)?'selected':''}>${esc(x.nome)}</option>`).join('')}
            </select>
          </div>
          <div class="rd2-field">
            <label>Serviço</label>
            <select id="rd2_id_servico">
              <option value="">Todos</option>
              ${(filtros?.servicos||[]).map(x=>`<option value="${x.id}" ${String(f.id_servico)==String(x.id)?'selected':''}>${esc(x.nome)}</option>`).join('')}
            </select>
          </div>
          <div class="rd2-field">
            <label>Coleção</label>
            <select id="rd2_id_colecao">
              <option value="">Todas</option>
              ${(filtros?.colecoes||[]).map(x=>`<option value="${x.id}" ${String(f.id_colecao)==String(x.id)?'selected':''}>${esc(x.nome)}</option>`).join('')}
            </select>
          </div>
          <div class="rd2-field">
            <label>Produto</label>
            <input type="text" id="rd2_cod_ref" value="${esc(f.cod_ref)}" placeholder="Ref.">
          </div>
          <div class="rd2-field">
            <label>Cor</label>
            <input type="text" id="rd2_cor" list="rd2_cores_dl" value="${esc(f.cor)}" placeholder="Qualquer">
            <datalist id="rd2_cores_dl">${(filtros?.cores||[]).map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
          </div>
          <div class="rd2-field">
            <label>Status</label>
            <select id="rd2_status">
              <option value="">Todos</option>
              ${(filtros?.status||[]).map(s=>`<option value="${s}" ${f.status===s?'selected':''}>${esc(s)}</option>`).join('')}
            </select>
          </div>
          <div class="rd2-filterbar__actions">
            <button class="rd2-btn rd2-btn--primary rd2-btn--sm" id="rd2Apply">
              <i class="fa-solid fa-check"></i><span>Aplicar</span>
            </button>
            <button class="rd2-btn rd2-btn--ghost rd2-btn--sm" id="rd2Reset">
              <i class="fa-solid fa-rotate-left"></i><span>Limpar</span>
            </button>
          </div>
        </div>
      </div>`;
  }

  function readFiltrosFromDom() {
    const get = id => (document.getElementById(id)?.value || '').trim();
    RD.filters.dt_ini     = get('rd2_dt_ini');
    RD.filters.dt_fim     = get('rd2_dt_fim');
    RD.filters.id_terc    = get('rd2_id_terc');
    RD.filters.id_servico = get('rd2_id_servico');
    RD.filters.id_colecao = get('rd2_id_colecao');
    RD.filters.cor        = get('rd2_cor');
    RD.filters.cod_ref    = get('rd2_cod_ref');
    RD.filters.status     = get('rd2_status');
    RD.filters.busca      = get('rd2_busca');
  }

  function applyQuickPeriod(kind) {
    const hoje = new Date();
    const fmt = d => d.toISOString().slice(0,10);
    let ini, fim;
    switch (kind) {
      case 'hoje': ini = fim = fmt(hoje); break;
      case '7d':   fim = fmt(hoje); ini = fmt(new Date(hoje.getTime() - 6*86400000)); break;
      case '30d':  fim = fmt(hoje); ini = fmt(new Date(hoje.getTime() - 29*86400000)); break;
      case 'mes':
        ini = fmt(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
        fim = fmt(new Date(hoje.getFullYear(), hoje.getMonth()+1, 0)); break;
      case 'ano':
        ini = fmt(new Date(hoje.getFullYear(), 0, 1));
        fim = fmt(new Date(hoje.getFullYear(), 11, 31)); break;
      default: return;
    }
    RD.filters.dt_ini = ini;
    RD.filters.dt_fim = fim;
    const a = document.getElementById('rd2_dt_ini'); if (a) a.value = ini;
    const b = document.getElementById('rd2_dt_fim'); if (b) b.value = fim;
  }

  /* ============================================================
   * KPIs (6 — minimalista executivo)
   * ============================================================ */
  function kpiCard({ label, value, icon, accent='primary', sub='', delta=null }) {
    let deltaHTML = '';
    if (delta != null && !isNaN(delta)) {
      const cls = delta >= 0 ? 'rd2-kpi__delta--up' : 'rd2-kpi__delta--down';
      const ic  = delta >= 0 ? 'fa-arrow-trend-up'   : 'fa-arrow-trend-down';
      deltaHTML = `<span class="rd2-kpi__delta ${cls}"><i class="fa-solid ${ic}"></i>${Math.abs(delta).toFixed(1)}%</span>`;
    }
    return `
      <div class="rd2-kpi rd2-kpi--${accent}">
        <div class="rd2-kpi__top">
          <div class="rd2-kpi__icon"><i class="fa-solid ${icon}"></i></div>
          ${deltaHTML}
        </div>
        <div class="rd2-kpi__label">${esc(label)}</div>
        <div class="rd2-kpi__value">${value}</div>
        ${sub ? `<div class="rd2-kpi__sub">${sub}</div>` : ''}
      </div>`;
  }

  function renderKPIs(k) {
    const enviado    = Number(k?.total_enviado   || 0);
    const retornado  = Number(k?.total_retornado || 0);
    const pago       = Number(k?.total_pago      || 0);
    const faltas     = Number(k?.total_faltas    || 0);
    const consertos  = Number(k?.total_consertos || 0);
    const efic       = enviado > 0 ? (retornado / enviado) * 100 : 0;

    return `
      <section class="rd2-section rd2-section--kpis" id="rd2KPIs">
        <div class="rd2-section__hd">
          <h2><i class="fa-solid fa-bullseye"></i> Resumo Executivo</h2>
          <span class="rd2-section__hint">Indicadores-chave do período selecionado</span>
        </div>
        <div class="rd2-kpis">
          ${kpiCard({ label:'Total Enviado',    value: fmtInt(enviado),    icon:'fa-paper-plane',           accent:'indigo'  })}
          ${kpiCard({ label:'Total Retornado',  value: fmtInt(retornado),  icon:'fa-arrow-right-arrow-left',accent:'sky'     })}
          ${kpiCard({ label:'Total Pago',       value: fmtMoney(pago),     icon:'fa-money-bill-wave',       accent:'emerald' })}
          ${kpiCard({ label:'Faltas',           value: fmtInt(faltas),     icon:'fa-triangle-exclamation',  accent:'rose'    })}
          ${kpiCard({ label:'Consertos',        value: fmtInt(consertos),  icon:'fa-screwdriver-wrench',    accent:'amber'   })}
          ${kpiCard({ label:'Eficiência Geral', value: efic.toFixed(1)+'%',icon:'fa-gauge-high',            accent:'violet'  })}
        </div>
      </section>`;
  }

  /* ============================================================
   * GRÁFICOS — Chart.js dark premium (9 charts)
   * ============================================================ */
  const CHART_COLORS = {
    indigo:  '#6366F1',
    violet:  '#8B5CF6',
    emerald: '#10B981',
    sky:     '#0EA5E9',
    amber:   '#F59E0B',
    rose:    '#F43F5E',
    cyan:    '#06B6D4',
    lime:    '#84CC16',
    pink:    '#EC4899',
    slate:   '#64748B',
  };
  const PALETTE = ['#6366F1','#8B5CF6','#0EA5E9','#10B981','#F59E0B','#F43F5E','#06B6D4','#84CC16','#EC4899','#A855F7'];

  function isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  function chartBase(type) {
    const light = isLight();
    const tickColor = light ? '#475569' : '#94a3b8';
    const gridColor = light ? 'rgba(15,23,42,.06)' : 'rgba(148,163,184,.08)';
    const legendColor = light ? '#1e293b' : '#cbd5e1';
    const tooltipBg = light ? 'rgba(255,255,255,.98)' : 'rgba(15,23,42,.96)';
    const tooltipFg = light ? '#0f172a' : '#e2e8f0';
    const tooltipBd = light ? 'rgba(15,23,42,.1)' : 'rgba(99,102,241,.4)';

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: { labels: { color: legendColor, font:{family:'Inter, system-ui', size:11}, boxWidth: 12, boxHeight: 12, padding: 12 } },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: tooltipFg,
          bodyColor: tooltipFg,
          borderColor: tooltipBd,
          borderWidth: 1,
          padding: 10,
          titleFont: { size: 12, weight: '600' },
          bodyFont:  { size: 11 },
          cornerRadius: 8,
          displayColors: true,
          boxPadding: 4,
        }
      },
      scales: (type==='line' || type==='bar') ? {
        x: { ticks: { color: tickColor, font:{size:10} }, grid: { color: gridColor, drawBorder:false } },
        y: { ticks: { color: tickColor, font:{size:10} }, grid: { color: gridColor, drawBorder:false } },
      } : {}
    };
  }

  function makeChart(canvasId, type, data, options={}) {
    const el = document.getElementById(canvasId);
    if (!el || !window.Chart) return;
    if (RD.charts[canvasId]) { try { RD.charts[canvasId].destroy(); } catch(_){} }
    const opts = Object.assign(chartBase(type), options);
    RD.charts[canvasId] = new Chart(el, { type, data, options: opts });
  }

  function chartCard(id, title, icon='fa-chart-line', size='md') {
    return `
      <div class="rd2-chart rd2-chart--${size}">
        <div class="rd2-chart__hd">
          <div class="rd2-chart__title"><i class="fa-solid ${icon}"></i> ${esc(title)}</div>
        </div>
        <div class="rd2-chart__body"><canvas id="${id}"></canvas></div>
      </div>`;
  }

  function renderChartsGrid() {
    return `
      <section class="rd2-section">
        <div class="rd2-section__hd">
          <h2><i class="fa-solid fa-chart-column"></i> Gráficos Analíticos</h2>
          <span class="rd2-section__hint">9 visões interativas</span>
        </div>
        <div class="rd2-charts-grid">
          ${chartCard('chProdDia',     'Produção por Dia',          'fa-chart-line',  'lg')}
          ${chartCard('chProdTerc',    'Produção por Terceirizado', 'fa-handshake',   'md')}
          ${chartCard('chPagPeriodo',  'Pagamentos por Período',    'fa-money-bill-trend-up', 'md')}
          ${chartCard('chTopServ',     'Serviços Mais Usados',      'fa-cogs',        'md')}
          ${chartCard('chRanking',     'Ranking de Terceirizados',  'fa-trophy',      'md')}
          ${chartCard('chFaltasProd',  'Faltas por Produto',        'fa-triangle-exclamation','md')}
          ${chartCard('chRetMedio',    'Retorno Médio (12 meses)',  'fa-clock-rotate-left','md')}
          ${chartCard('chPorCor',      'Volume por Cor',            'fa-palette',     'md')}
          ${chartCard('chPorColecao',  'Volume por Coleção',        'fa-tags',        'md')}
        </div>
      </section>`;
  }

  function fillCharts(g) {
    const prod   = g.producao_periodo   || [];
    const pag    = g.pagamentos_periodo || [];
    const tServ  = g.top_servicos       || [];
    const tTerc  = g.top_terceirizados  || [];
    const faltas = g.faltas_periodo     || [];
    const mensal = g.retorno_mensal     || [];

    // 1) Produção por dia (Boas / Faltas / Conserto)
    makeChart('chProdDia', 'line', {
      labels: prod.map(x => fmtDate(x.dt)),
      datasets: [
        { label:'Boas',     data: prod.map(x=>x.boa),     borderColor: CHART_COLORS.emerald, backgroundColor:'rgba(16,185,129,.12)',  fill:true, tension:.35, borderWidth:2, pointRadius:0, pointHoverRadius:4 },
        { label:'Faltas',   data: prod.map(x=>x.falta),   borderColor: CHART_COLORS.rose,    backgroundColor:'rgba(244,63,94,.10)',   fill:true, tension:.35, borderWidth:2, pointRadius:0, pointHoverRadius:4 },
        { label:'Consertos',data: prod.map(x=>x.conserto),borderColor: CHART_COLORS.amber,   backgroundColor:'rgba(245,158,11,.10)',  fill:true, tension:.35, borderWidth:2, pointRadius:0, pointHoverRadius:4 },
      ]
    });

    // 2) Produção por terceirizado (horizontal bar)
    makeChart('chProdTerc', 'bar', {
      labels: tTerc.map(x=>x.nome || '—'),
      datasets: [
        { label:'Enviado', data: tTerc.map(x=>x.enviado), backgroundColor: CHART_COLORS.indigo, borderRadius:6, borderSkipped:false },
      ]
    }, { indexAxis: 'y' });

    // 3) Pagamentos por período (bar)
    makeChart('chPagPeriodo', 'bar', {
      labels: pag.map(x => fmtDate(x.dt)),
      datasets: [
        { label:'Pago (R$)', data: pag.map(x=>x.valor), backgroundColor: CHART_COLORS.violet, borderRadius:6, borderSkipped:false },
      ]
    });

    // 4) Top serviços (doughnut)
    makeChart('chTopServ', 'doughnut', {
      labels: tServ.map(x=>x.nome || '—'),
      datasets: [{ data: tServ.map(x=>x.qtd), backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 8 }]
    }, {
      cutout: '62%',
      plugins: { legend: { position:'right', labels:{ color: isLight()?'#1e293b':'#cbd5e1', font:{size:10}, boxWidth:10, boxHeight:10, padding: 8 } } },
      scales: {}
    });

    // 5) Ranking terceirizados (horizontal bar — pago)
    makeChart('chRanking', 'bar', {
      labels: tTerc.map(x=>x.nome || '—'),
      datasets: [
        { label:'Pago (R$)', data: tTerc.map(x=>x.pago), backgroundColor: CHART_COLORS.emerald, borderRadius:6, borderSkipped:false },
      ]
    }, { indexAxis: 'y' });

    // 6) Faltas por produto (vertical bar derivada do dataset)
    const faltasPorProduto = (g.faltas_por_produto || faltas.slice(0,10)).map(x => ({
      label: x.cod_ref || x.dt || '—',
      qtd: x.qtd,
    }));
    makeChart('chFaltasProd', 'bar', {
      labels: faltasPorProduto.map(x=>x.label),
      datasets: [{ label:'Faltas', data: faltasPorProduto.map(x=>x.qtd), backgroundColor: CHART_COLORS.rose, borderRadius:6, borderSkipped:false }]
    });

    // 7) Retorno médio (12 meses) — linha
    makeChart('chRetMedio', 'line', {
      labels: mensal.map(x=>x.mes),
      datasets: [
        { label:'Boas',  data: mensal.map(x=>x.boa),   borderColor: CHART_COLORS.emerald, backgroundColor:'rgba(16,185,129,.10)', fill:true, tension:.35, borderWidth:2, pointRadius:0 },
        { label:'Faltas',data: mensal.map(x=>x.falta), borderColor: CHART_COLORS.rose,    backgroundColor:'rgba(244,63,94,.08)',  fill:true, tension:.35, borderWidth:2, pointRadius:0 },
      ]
    });

    // 8) Volume por cor — bar
    const porCor = g.por_cor || [];
    makeChart('chPorCor', 'bar', {
      labels: porCor.map(x=>x.cor || '—'),
      datasets: [{ label:'Qtd', data: porCor.map(x=>x.qtd), backgroundColor: CHART_COLORS.cyan, borderRadius:6, borderSkipped:false }]
    });

    // 9) Volume por coleção — pie
    const porCol = g.por_colecao || [];
    makeChart('chPorColecao', 'doughnut', {
      labels: porCol.map(x=>x.nome || '—'),
      datasets: [{ data: porCol.map(x=>x.qtd), backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 8 }]
    }, {
      cutout: '55%',
      plugins: { legend: { position:'right', labels:{ color: isLight()?'#1e293b':'#cbd5e1', font:{size:10}, boxWidth:10, boxHeight:10, padding: 8 } } },
      scales: {}
    });
  }

  /* ============================================================
   * TABELA DETALHADA — sort / search / paginate
   * ============================================================ */
  const TABLE_COLS = [
    { key:'num_op',       label:'OP',           sortable:true },
    { key:'cod_ref',      label:'Produto',      sortable:true },
    { key:'cor',          label:'Cor',          sortable:true },
    { key:'desc_servico', label:'Serviço',      sortable:true },
    { key:'nome_terc',    label:'Terceirizado', sortable:true },
    { key:'qtd_total',    label:'Qtd Env.',     sortable:true, right:true, fmt: v=>fmtInt(v) },
    { key:'qtd_boa',      label:'Qtd Ret.',     sortable:true, right:true, fmt: v=>fmtInt(v) },
    { key:'qtd_refugo',   label:'Faltas',       sortable:true, right:true, fmt: v=>`<span class="rd2-num rd2-num--rose">${fmtInt(v)}</span>` },
    { key:'qtd_conserto', label:'Cons.',        sortable:true, right:true, fmt: v=>`<span class="rd2-num rd2-num--amber">${fmtInt(v)}</span>` },
    { key:'preco_unit',   label:'V.Unit',       sortable:true, right:true, fmt: v=>fmtMoney(v) },
    { key:'valor_total',  label:'V.Total',      sortable:true, right:true, fmt: v=>`<b>${fmtMoney(v)}</b>` },
    { key:'status',       label:'Status',       sortable:true, fmt: v=>`<span class="rd2-badge rd2-badge--${(v||'').toLowerCase().replace(/\s+/g,'-')}">${esc(v||'-')}</span>` },
    { key:'dt_saida',     label:'Saída',        sortable:true, fmt: v=>fmtDate(v) },
  ];

  function getDetailRows(remRows, retRows) {
    // mescla: agrega retornos por id_remessa
    const aggRet = {};
    (retRows || []).forEach(r => {
      const k = r.id_remessa;
      if (!aggRet[k]) aggRet[k] = { qtd_boa:0, qtd_refugo:0, qtd_conserto:0 };
      aggRet[k].qtd_boa      += Number(r.qtd_boa||0);
      aggRet[k].qtd_refugo   += Number(r.qtd_refugo||0);
      aggRet[k].qtd_conserto += Number(r.qtd_conserto||0);
    });
    return (remRows || []).map(r => {
      const ret = aggRet[r.id_remessa] || { qtd_boa:0, qtd_refugo:0, qtd_conserto:0 };
      return {
        id_remessa: r.id_remessa,
        num_op: r.num_op || '',
        cod_ref: r.cod_ref || '',
        desc_ref: r.desc_ref || '',
        cor: r.cor || '',
        desc_servico: r.desc_servico || '',
        nome_terc: r.nome_terc || '',
        nome_colecao: r.nome_colecao || '',
        qtd_total: Number(r.qtd_total||0),
        qtd_boa: ret.qtd_boa,
        qtd_refugo: ret.qtd_refugo,
        qtd_conserto: ret.qtd_conserto,
        preco_unit: Number(r.preco_unit||0),
        valor_total: Number(r.valor_total||0),
        valor_pago: Number(r.valor_pago||0),
        status: r.status || '',
        dt_saida: r.dt_saida || '',
        dt_previsao: r.dt_previsao || '',
        dt_recebimento: r.dt_recebimento || '',
      };
    });
  }

  function filterAndSort(rows) {
    const q = (RD.table.search || RD.filters.busca || '').toLowerCase().trim();
    let out = rows;
    if (q) {
      out = out.filter(r =>
        String(r.num_op||'').toLowerCase().includes(q) ||
        String(r.cod_ref||'').toLowerCase().includes(q) ||
        String(r.desc_ref||'').toLowerCase().includes(q) ||
        String(r.cor||'').toLowerCase().includes(q) ||
        String(r.desc_servico||'').toLowerCase().includes(q) ||
        String(r.nome_terc||'').toLowerCase().includes(q) ||
        String(r.status||'').toLowerCase().includes(q)
      );
    }
    const k = RD.table.sortKey, dir = RD.table.sortDir === 'asc' ? 1 : -1;
    out = out.slice().sort((a,b) => {
      const va = a[k], vb = b[k];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va||'').localeCompare(String(vb||'')) * dir;
    });
    return out;
  }

  function renderDetailTable() {
    return `
      <section class="rd2-section">
        <div class="rd2-section__hd">
          <h2><i class="fa-solid fa-table"></i> Tabela Detalhada</h2>
          <div class="rd2-table-tools">
            <div class="rd2-search rd2-search--sm">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input type="text" id="rd2_tbl_search" placeholder="Buscar na tabela..." value="${esc(RD.table.search)}">
            </div>
            <select id="rd2_tbl_pp" class="rd2-select-sm">
              <option value="10"  ${RD.table.perPage==10?'selected':''}>10/pág</option>
              <option value="25"  ${RD.table.perPage==25?'selected':''}>25/pág</option>
              <option value="50"  ${RD.table.perPage==50?'selected':''}>50/pág</option>
              <option value="100" ${RD.table.perPage==100?'selected':''}>100/pág</option>
            </select>
          </div>
        </div>
        <div class="rd2-table-wrap" id="rd2TblWrap">
          ${skeletonTable(8, TABLE_COLS.length)}
        </div>
      </section>`;
  }

  function paintTable(rowsAll) {
    const wrap = document.getElementById('rd2TblWrap');
    if (!wrap) return;
    const filtered = filterAndSort(rowsAll);
    const total = filtered.length;
    const pp = RD.table.perPage;
    const totalPages = Math.max(1, Math.ceil(total / pp));
    if (RD.table.page > totalPages) RD.table.page = 1;
    const slice = filtered.slice((RD.table.page-1)*pp, RD.table.page*pp);

    const head = `<tr>${TABLE_COLS.map(c => {
      const arrow = (RD.table.sortKey===c.key)
        ? (RD.table.sortDir==='asc' ? '<i class="fa-solid fa-arrow-up-short-wide"></i>' : '<i class="fa-solid fa-arrow-down-wide-short"></i>')
        : '<i class="fa-solid fa-sort rd2-th-sort"></i>';
      const right = c.right ? ' rd2-th--right' : '';
      const sortable = c.sortable ? ` data-sort="${c.key}"` : '';
      return `<th class="rd2-th${right}${c.sortable?' rd2-th--sortable':''}"${sortable}>
        <span>${esc(c.label)}</span>${c.sortable?arrow:''}
      </th>`;
    }).join('')}</tr>`;

    const body = slice.length
      ? slice.map(r => `<tr>${TABLE_COLS.map(c => {
          const v = typeof c.fmt === 'function' ? c.fmt(r[c.key], r) : esc(r[c.key] ?? '');
          return `<td${c.right?' class="rd2-td--right"':''}>${v}</td>`;
        }).join('')}</tr>`).join('')
      : `<tr><td colspan="${TABLE_COLS.length}" class="rd2-td--empty">
          <i class="fa-regular fa-folder-open"></i> Nenhum registro encontrado.
        </td></tr>`;

    // totals footer
    const sumQE = filtered.reduce((a,r)=>a+(+r.qtd_total||0),0);
    const sumQR = filtered.reduce((a,r)=>a+(+r.qtd_boa||0),0);
    const sumF  = filtered.reduce((a,r)=>a+(+r.qtd_refugo||0),0);
    const sumC  = filtered.reduce((a,r)=>a+(+r.qtd_conserto||0),0);
    const sumV  = filtered.reduce((a,r)=>a+(+r.valor_total||0),0);
    const tfoot = `<tr class="rd2-tfoot">
      <td colspan="5">Total (${total} registro${total!==1?'s':''})</td>
      <td class="rd2-td--right"><b>${fmtInt(sumQE)}</b></td>
      <td class="rd2-td--right"><b>${fmtInt(sumQR)}</b></td>
      <td class="rd2-td--right"><b class="rd2-num--rose">${fmtInt(sumF)}</b></td>
      <td class="rd2-td--right"><b class="rd2-num--amber">${fmtInt(sumC)}</b></td>
      <td></td>
      <td class="rd2-td--right"><b>${fmtMoney(sumV)}</b></td>
      <td colspan="2"></td>
    </tr>`;

    const ini = total ? ((RD.table.page-1)*pp + 1) : 0;
    const fim = Math.min(RD.table.page*pp, total);

    wrap.innerHTML = `
      <div class="rd2-table-scroll">
        <table class="rd2-table">
          <thead>${head}</thead>
          <tbody>${body}</tbody>
          <tfoot>${tfoot}</tfoot>
        </table>
      </div>
      <div class="rd2-pagination">
        <span class="rd2-pagination__info">Exibindo <b>${ini}</b>–<b>${fim}</b> de <b>${total}</b></span>
        <div class="rd2-pagination__ctrls">
          <button class="rd2-pgbtn" data-pg="first" ${RD.table.page<=1?'disabled':''}><i class="fa-solid fa-angles-left"></i></button>
          <button class="rd2-pgbtn" data-pg="prev"  ${RD.table.page<=1?'disabled':''}><i class="fa-solid fa-angle-left"></i></button>
          <span class="rd2-pagination__page">Página ${RD.table.page} de ${totalPages}</span>
          <button class="rd2-pgbtn" data-pg="next" ${RD.table.page>=totalPages?'disabled':''}><i class="fa-solid fa-angle-right"></i></button>
          <button class="rd2-pgbtn" data-pg="last" ${RD.table.page>=totalPages?'disabled':''}><i class="fa-solid fa-angles-right"></i></button>
        </div>
      </div>`;

    // bind sort
    wrap.querySelectorAll('th[data-sort]').forEach(th => {
      th.onclick = () => {
        const k = th.dataset.sort;
        if (RD.table.sortKey === k) {
          RD.table.sortDir = RD.table.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          RD.table.sortKey = k;
          RD.table.sortDir = 'asc';
        }
        paintTable(rowsAll);
      };
    });
    // bind paginate
    wrap.querySelectorAll('.rd2-pgbtn').forEach(b => {
      b.onclick = () => {
        const a = b.dataset.pg;
        if (a==='first') RD.table.page = 1;
        if (a==='prev')  RD.table.page = Math.max(1, RD.table.page-1);
        if (a==='next')  RD.table.page = Math.min(totalPages, RD.table.page+1);
        if (a==='last')  RD.table.page = totalPages;
        paintTable(rowsAll);
      };
    });
  }

  /* ============================================================
   * EXPORTS — Excel / PDF
   * ============================================================ */
  function exportExcel() {
    if (!window.XLSX) { window.toast?.('Biblioteca XLSX indisponível.', 'error'); return; }
    const rows = RD.cache.detailRows || [];
    const headers = TABLE_COLS.map(c => c.label);
    const data = rows.map(r => TABLE_COLS.map(c => {
      const raw = r[c.key];
      if (typeof raw === 'number') return raw;
      return raw ?? '';
    }));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Detalhado');

    // KPIs sheet
    const k = RD.cache.dashboard?.kpis || {};
    const ef = (Number(k.total_enviado||0) > 0) ? (Number(k.total_retornado||0)/Number(k.total_enviado||0))*100 : 0;
    const kpiSheet = XLSX.utils.aoa_to_sheet([
      ['Indicador', 'Valor'],
      ['Período', `${RD.filters.dt_ini} a ${RD.filters.dt_fim}`],
      ['Total Enviado',   Number(k.total_enviado||0)],
      ['Total Retornado', Number(k.total_retornado||0)],
      ['Total Pago',      Number(k.total_pago||0)],
      ['Faltas',          Number(k.total_faltas||0)],
      ['Consertos',       Number(k.total_consertos||0)],
      ['Eficiência (%)',  ef],
    ]);
    XLSX.utils.book_append_sheet(wb, kpiSheet, 'Resumo');

    const fname = 'CorePro_Relatorio_' + RD.filters.dt_ini + '_a_' + RD.filters.dt_fim + '.xlsx';
    XLSX.writeFile(wb, fname);
    window.toast?.('Excel exportado.', 'success');
  }

  async function exportPDF() {
    if (!window.jspdf?.jsPDF) { window.toast?.('Biblioteca jsPDF indisponível.', 'error'); return; }
    const { jsPDF } = window.jspdf;

    const k = RD.cache.dashboard?.kpis || {};
    const f = RD.filters;
    const rows = RD.cache.detailRows || [];
    const efic = Number(k.total_enviado||0) > 0 ? (Number(k.total_retornado||0)/Number(k.total_enviado||0))*100 : 0;

    // 1) PORTRAIT — capa + KPIs + filtros + gráficos
    const doc = new jsPDF({ orientation:'portrait', unit:'pt', format:'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();

    // ----- Page 1 (capa premium) -----
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 110, 'F');
    // gradiente faux
    doc.setFillColor(99, 102, 241);
    doc.rect(0, 100, W, 4, 'F');
    try { doc.addImage('/static/logo-full.png', 'PNG', 36, 28, 110, 36); } catch(_){}
    doc.setTextColor(255);
    doc.setFontSize(18);
    doc.setFont('helvetica','bold');
    doc.text('Relatório Executivo', W-36, 50, { align:'right' });
    doc.setFont('helvetica','normal');
    doc.setFontSize(10);
    doc.text('CorePro — Terceirização Têxtil', W-36, 68, { align:'right' });
    doc.setFontSize(8);
    doc.text('Gerado em ' + new Date().toLocaleString('pt-BR'), W-36, 84, { align:'right' });

    // Filtros aplicados
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.setFont('helvetica','bold');
    doc.text('Filtros aplicados', 36, 145);
    doc.setFont('helvetica','normal');
    doc.setFontSize(9);
    const filtros = [
      ['Período', `${fmtDate(f.dt_ini)} a ${fmtDate(f.dt_fim)}`],
      ['Terceirizado', f.id_terc ? '#'+f.id_terc : 'Todos'],
      ['Serviço',      f.id_servico ? '#'+f.id_servico : 'Todos'],
      ['Coleção',      f.id_colecao ? '#'+f.id_colecao : 'Todas'],
      ['Produto',      f.cod_ref || '—'],
      ['Cor',          f.cor || '—'],
      ['Status',       f.status || 'Todos'],
    ];
    if (window.jspdf && doc.autoTable) {
      doc.autoTable({
        startY: 155,
        head: [['Filtro','Valor']],
        body: filtros,
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 36, right: 36 },
      });
    }

    // KPIs
    let y = (doc.lastAutoTable?.finalY || 200) + 30;
    doc.setFontSize(12);
    doc.setFont('helvetica','bold');
    doc.text('Resumo Executivo', 36, y);
    y += 12;

    const kpis = [
      { label:'Total Enviado',    value: fmtInt(k.total_enviado),    color: [99,102,241] },
      { label:'Total Retornado',  value: fmtInt(k.total_retornado),  color: [14,165,233] },
      { label:'Total Pago',       value: fmtMoney(k.total_pago),     color: [16,185,129] },
      { label:'Faltas',           value: fmtInt(k.total_faltas),     color: [244,63,94] },
      { label:'Consertos',        value: fmtInt(k.total_consertos),  color: [245,158,11] },
      { label:'Eficiência Geral', value: efic.toFixed(1)+'%',        color: [139,92,246] },
    ];
    const cardW = (W - 36*2 - 20) / 3;
    const cardH = 60;
    kpis.forEach((kp, i) => {
      const col = i % 3, row = Math.floor(i/3);
      const x = 36 + col * (cardW + 10);
      const yy = y + 10 + row * (cardH + 10);
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, yy, cardW, cardH, 6, 6, 'FD');
      doc.setFillColor(kp.color[0], kp.color[1], kp.color[2]);
      doc.roundedRect(x, yy, 4, cardH, 2, 2, 'F');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica','normal');
      doc.text(kp.label.toUpperCase(), x + 12, yy + 18);
      doc.setFontSize(16);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica','bold');
      doc.text(String(kp.value), x + 12, yy + 42);
    });

    // ----- Gráficos (capturados como imagem) -----
    const chartIds = ['chProdDia','chProdTerc','chPagPeriodo','chTopServ','chRanking','chFaltasProd','chRetMedio','chPorCor','chPorColecao'];
    const chartTitles = ['Produção por Dia','Produção por Terceirizado','Pagamentos por Período','Serviços Mais Usados','Ranking de Terceirizados','Faltas por Produto','Retorno Médio (12 meses)','Volume por Cor','Volume por Coleção'];

    let chartY = y + 10 + Math.ceil(kpis.length/3) * (cardH + 10) + 20;
    const chartW = (W - 36*2 - 20) / 2;
    const chartH = 130;

    chartIds.forEach((id, i) => {
      if (i % 4 === 0) {
        doc.addPage();
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica','bold');
        doc.text('Gráficos Analíticos', 36, 40);
        chartY = 60;
      }
      const col = (i % 4) % 2;
      const row = Math.floor((i % 4) / 2);
      const x = 36 + col * (chartW + 20);
      const yy = chartY + row * (chartH + 30);

      const canvas = document.getElementById(id);
      if (canvas) {
        try {
          const img = canvas.toDataURL('image/png', 1.0);
          doc.setFontSize(9);
          doc.setTextColor(71, 85, 105);
          doc.setFont('helvetica','bold');
          doc.text(chartTitles[i], x, yy - 4);
          doc.setDrawColor(226, 232, 240);
          doc.roundedRect(x, yy, chartW, chartH, 4, 4, 'S');
          doc.addImage(img, 'PNG', x+4, yy+4, chartW-8, chartH-8);
        } catch(_) {}
      }
    });

    // ----- LANDSCAPE — tabela detalhada -----
    if (rows.length && doc.autoTable) {
      doc.addPage('a4', 'landscape');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica','bold');
      doc.text('Tabela Detalhada', 36, 40);
      doc.setFontSize(8);
      doc.setFont('helvetica','normal');
      doc.setTextColor(100, 116, 139);
      doc.text(`${rows.length} registros • ${fmtDate(f.dt_ini)} a ${fmtDate(f.dt_fim)}`, 36, 56);

      const headers = ['OP','Produto','Cor','Serviço','Terceirizado','Q.Env','Q.Ret','Falt','Cons','V.Unit','V.Total','Status','Saída'];
      const body = rows.slice(0, 1000).map(r => [
        r.num_op||'', r.cod_ref||'', r.cor||'', r.desc_servico||'', r.nome_terc||'',
        fmtInt(r.qtd_total), fmtInt(r.qtd_boa), fmtInt(r.qtd_refugo), fmtInt(r.qtd_conserto),
        fmtMoney(r.preco_unit), fmtMoney(r.valor_total), r.status||'', fmtDate(r.dt_saida)
      ]);
      doc.autoTable({
        startY: 70,
        head: [headers],
        body,
        styles: { fontSize: 7, cellPadding: 3, overflow:'linebreak' },
        headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle:'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 36, right: 36, bottom: 40 },
        columnStyles: {
          5:{halign:'right'}, 6:{halign:'right'}, 7:{halign:'right'}, 8:{halign:'right'},
          9:{halign:'right'}, 10:{halign:'right'},
        },
      });
    }

    // ----- Rodapé com paginação em todas as páginas -----
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      doc.setDrawColor(226, 232, 240);
      doc.line(36, ph-30, pw-36, ph-30);
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica','normal');
      doc.text('CorePro — Relatórios Executivos', 36, ph-15);
      doc.text(`Página ${p} de ${totalPages}`, pw-36, ph-15, { align:'right' });
    }

    const fname = 'CorePro_Relatorio_' + RD.filters.dt_ini + '_a_' + RD.filters.dt_fim + '.pdf';
    doc.save(fname);
    window.toast?.('PDF gerado.', 'success');
  }

  /* ============================================================
   * RENDER PRINCIPAL
   * ============================================================ */
  async function loadAll() {
    const dash = await fetchAPI('/relatorios-det/dashboard');
    const rem  = await fetchAPI('/relatorios-det/remessas').catch(()=>({rows:[]}));
    const ret  = await fetchAPI('/relatorios-det/retornos').catch(()=>({rows:[]}));

    // gera por_cor / por_colecao a partir das remessas
    const aggCor = {}, aggCol = {};
    (rem.rows||[]).forEach(r => {
      const c = (r.cor||'—').toUpperCase();
      aggCor[c] = (aggCor[c]||0) + Number(r.qtd_total||0);
      const k = r.nome_colecao || '—';
      aggCol[k] = (aggCol[k]||0) + Number(r.qtd_total||0);
    });
    const por_cor     = Object.keys(aggCor).map(k=>({cor:k, qtd:aggCor[k]})).sort((a,b)=>b.qtd-a.qtd).slice(0,12);
    const por_colecao = Object.keys(aggCol).map(k=>({nome:k, qtd:aggCol[k]})).sort((a,b)=>b.qtd-a.qtd).slice(0,10);

    // faltas por produto
    const aggFalta = {};
    (ret.rows||[]).forEach(r => {
      const k = r.cod_ref||'—';
      aggFalta[k] = (aggFalta[k]||0) + Number(r.qtd_refugo||0);
    });
    const faltas_por_produto = Object.keys(aggFalta).map(k=>({cod_ref:k, qtd:aggFalta[k]})).filter(x=>x.qtd>0).sort((a,b)=>b.qtd-a.qtd).slice(0,10);

    dash.graficos = dash.graficos || {};
    dash.graficos.por_cor = por_cor;
    dash.graficos.por_colecao = por_colecao;
    dash.graficos.faltas_por_produto = faltas_por_produto;

    RD.cache.dashboard = dash;
    RD.cache.remessas  = rem;
    RD.cache.retornos  = ret;
    RD.cache.detailRows = getDetailRows(rem.rows||[], ret.rows||[]);
    return dash;
  }

  function renderEmptyState(msg, icon = 'fa-folder-open') {
    return `
      <section class="rd2-section">
        <div class="rd2-empty">
          <i class="fa-solid ${icon}"></i>
          <h3>${esc(msg || 'Nenhum dado encontrado para os filtros selecionados')}</h3>
          <p>Ajuste o período ou os filtros e tente novamente.</p>
          <button class="rd2-btn rd2-btn--primary" id="rd2EmptyReset">
            <i class="fa-solid fa-broom"></i> Limpar filtros
          </button>
        </div>
      </section>`;
  }

  function renderErrorState(e) {
    const status = e?.status;
    let msg = e?.message || 'Erro desconhecido';
    let hint = '';
    if (status === 401 || e?.code === 'AUTH_REQUIRED') {
      msg = 'Sessão expirada';
      hint = 'Faça login novamente para continuar.';
    } else if (status === 403) {
      msg = 'Acesso negado';
      hint = 'Seu perfil não tem permissão para visualizar este relatório.';
    } else if (status >= 500) {
      msg = 'Erro no servidor';
      hint = 'Tente novamente em alguns instantes.';
    } else if (!status) {
      hint = 'Verifique sua conexão com a internet.';
    }
    return `
      <section class="rd2-section">
        <div class="rd2-empty rd2-empty--error">
          <i class="fa-solid fa-circle-exclamation"></i>
          <h3>${esc(msg)}</h3>
          ${hint ? `<p>${esc(hint)}</p>` : ''}
          <button class="rd2-btn rd2-btn--primary" id="rd2ErrRetry">
            <i class="fa-solid fa-rotate-right"></i> Tentar novamente
          </button>
        </div>
      </section>`;
  }

  function isDashboardEmpty(dash) {
    const k = dash?.kpis || {};
    const sumKpis = Number(k.total_enviado||0) + Number(k.total_retornado||0)
                  + Number(k.total_pago||0) + Number(k.total_faltas||0)
                  + Number(k.total_consertos||0) + Number(k.qtd_remessas||0);
    return sumKpis === 0;
  }

  async function renderAll() {
    const kpisHost   = document.getElementById('rd2KPIsHost');
    const chartsHost = document.getElementById('rd2ChartsHost');
    const tableHost  = document.getElementById('rd2TableHost');
    if (kpisHost)   kpisHost.innerHTML = `<section class="rd2-section"><div class="rd2-section__hd"><h2><i class="fa-solid fa-bullseye"></i> Resumo Executivo</h2></div><div class="rd2-kpis">${skeletonKPIs()}</div></section>`;
    if (chartsHost) chartsHost.innerHTML = renderChartsGrid();
    if (tableHost)  tableHost.innerHTML  = renderDetailTable();

    try {
      const dash = await loadAll();
      // Sempre renderiza KPIs (mesmo zerados, para indicador visual)
      if (kpisHost)   kpisHost.innerHTML   = renderKPIs(dash.kpis || {});

      // Empty state quando não há nenhum dado
      if (isDashboardEmpty(dash) && (!RD.cache.detailRows || RD.cache.detailRows.length === 0)) {
        if (chartsHost) chartsHost.innerHTML = renderEmptyState('Nenhum dado encontrado para os filtros selecionados');
        if (tableHost)  tableHost.innerHTML  = '';
        const btn = document.getElementById('rd2EmptyReset');
        if (btn) btn.onclick = () => document.getElementById('rd2Reset')?.click();
        return;
      }

      if (chartsHost) chartsHost.innerHTML = renderChartsGrid();
      // pequeno delay para canvases serem montados
      requestAnimationFrame(()=> fillCharts(dash.graficos || {}));
      if (tableHost)  tableHost.innerHTML  = renderDetailTable();
      bindTableHandlers();
      paintTable(RD.cache.detailRows || []);
    } catch (e) {
      console.error('[RD.renderAll]', e);
      const errHTML = renderErrorState(e);
      if (kpisHost) kpisHost.innerHTML = errHTML;
      if (chartsHost) chartsHost.innerHTML = '';
      if (tableHost) tableHost.innerHTML = '';
      const retry = document.getElementById('rd2ErrRetry');
      if (retry) retry.onclick = () => { RD.cache = {}; renderAll(); };
    }
  }

  function bindTableHandlers() {
    const search = document.getElementById('rd2_tbl_search');
    if (search) {
      search.oninput = debounce(() => {
        RD.table.search = search.value || '';
        RD.table.page = 1;
        paintTable(RD.cache.detailRows || []);
      }, 200);
    }
    const pp = document.getElementById('rd2_tbl_pp');
    if (pp) pp.onchange = () => { RD.table.perPage = Number(pp.value)||25; RD.table.page = 1; paintTable(RD.cache.detailRows||[]); };
  }

  /* ============================================================
   * ROUTE
   * ============================================================ */
  ROUTES.relatorios_detalhados = async (main) => {
    // SEM gating de perfil — visível para todos os usuários autenticados
    ensureFiltros();
    loadFavoritos();
    destroyCharts();

    main.innerHTML = `
      <div class="rd2-page" id="rd2Page">
        ${renderHeader()}
        <div id="rd2FilterHost"></div>
        <div id="rd2KPIsHost"></div>
        <div id="rd2ChartsHost"></div>
        <div id="rd2TableHost"></div>
      </div>`;

    // Filtros (lazy)
    let filtros = {};
    try { filtros = await fetchAPI('/relatorios-det/filtros'); RD.cache.filtros = filtros; } catch(_) {}
    document.getElementById('rd2FilterHost').innerHTML = renderFilterBar(filtros);
    bindFilterHandlers();
    bindHeaderHandlers();

    await renderAll();
  };

  function bindHeaderHandlers() {
    const r = document.getElementById('rd2BtnRefresh'); if (r) r.onclick = () => { RD.cache = {}; renderAll(); };
    const p = document.getElementById('rd2BtnPrint');   if (p) p.onclick = () => window.print();
    const e = document.getElementById('rd2BtnExcel');   if (e) e.onclick = () => exportExcel();
    const d = document.getElementById('rd2BtnPDF');     if (d) d.onclick = () => exportPDF();
  }

  function bindFilterHandlers() {
    const apply = document.getElementById('rd2Apply');
    if (apply) apply.onclick = () => { readFiltrosFromDom(); RD.cache = {}; RD.table.page = 1; renderAll(); window.toast?.('Filtros aplicados.','info'); };
    const reset = document.getElementById('rd2Reset');
    if (reset) reset.onclick = () => {
      RD.filters = { dt_ini:'', dt_fim:'', id_terc:'', id_servico:'', id_colecao:'', cor:'', cod_ref:'', num_op:'', status:'', busca:'' };
      ensureFiltros();
      ['rd2_id_terc','rd2_id_servico','rd2_id_colecao','rd2_cor','rd2_cod_ref','rd2_status','rd2_busca'].forEach(id => { const el=document.getElementById(id); if (el) el.value=''; });
      const a = document.getElementById('rd2_dt_ini'); if (a) a.value = RD.filters.dt_ini;
      const b = document.getElementById('rd2_dt_fim'); if (b) b.value = RD.filters.dt_fim;
      RD.cache = {}; RD.table.page = 1;
      renderAll();
    };

    document.querySelectorAll('.rd2-chip[data-period]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.rd2-chip').forEach(x => x.classList.remove('is-active'));
        btn.classList.add('is-active');
        applyQuickPeriod(btn.dataset.period);
        readFiltrosFromDom();
        RD.cache = {}; RD.table.page = 1; renderAll();
      };
    });

    const busca = document.getElementById('rd2_busca');
    if (busca) busca.oninput = debounce(() => {
      RD.filters.busca = busca.value;
      RD.table.search = busca.value;
      paintTable(RD.cache.detailRows || []);
    }, 250);

    // Favoritos
    const favBtn = document.getElementById('rd2FavMenu');
    const favList = document.getElementById('rd2FavList');
    if (favBtn && favList) {
      favBtn.onclick = (ev) => { ev.stopPropagation(); favList.hidden = !favList.hidden; };
      document.addEventListener('click', (ev) => {
        if (!favList.contains(ev.target) && ev.target !== favBtn) favList.hidden = true;
      }, { once: false });
    }
    const favAdd = document.getElementById('rd2FavAdd');
    if (favAdd) favAdd.onclick = () => {
      readFiltrosFromDom();
      const nome = prompt('Nome do filtro favorito:', `Filtro ${new Date().toLocaleDateString('pt-BR')}`);
      if (!nome) return;
      RD.favoritos.push({ nome, filtros: snapshotFiltros() });
      saveFavoritos();
      window.toast?.('Filtro salvo nos favoritos.','success');
      // re-render filterbar para mostrar lista atualizada
      document.getElementById('rd2FilterHost').innerHTML = renderFilterBar(RD.cache.filtros||{});
      bindFilterHandlers();
    };
    document.querySelectorAll('[data-fav]').forEach(it => {
      it.onclick = (ev) => {
        if (ev.target.closest('[data-fav-del]')) return;
        const i = Number(it.dataset.fav);
        const fav = RD.favoritos[i];
        if (!fav) return;
        RD.filters = Object.assign({ busca:'' }, fav.filtros);
        // re-render filterbar com valores aplicados
        document.getElementById('rd2FilterHost').innerHTML = renderFilterBar(RD.cache.filtros||{});
        bindFilterHandlers();
        RD.cache = {}; RD.table.page = 1; renderAll();
      };
    });
    document.querySelectorAll('[data-fav-del]').forEach(b => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        const i = Number(b.dataset.favDel);
        RD.favoritos.splice(i,1);
        saveFavoritos();
        document.getElementById('rd2FilterHost').innerHTML = renderFilterBar(RD.cache.filtros||{});
        bindFilterHandlers();
      };
    });
  }

})();
