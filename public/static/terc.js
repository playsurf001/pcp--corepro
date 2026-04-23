/* ============================================================
 * MÓDULO DE TERCEIRIZAÇÃO - Frontend
 * Controle de remessas, retornos, consertos, resumo, dashboard
 * ============================================================ */

const TAMS = ['P','M','G','GG','EG','SG','T7','T8','T9','T10'];
const TERC = { cache: {} };

async function tercLoadCache(force = false) {
  if (!force && TERC.cache.ts && (Date.now() - TERC.cache.ts) < 30000) return TERC.cache;
  const [tercs, setores, servicos, colecoes] = await Promise.all([
    api('get', '/terc/terceirizados'),
    api('get', '/terc/setores'),
    api('get', '/terc/servicos'),
    api('get', '/terc/colecoes'),
  ]);
  TERC.cache = {
    ts: Date.now(),
    terceirizados: tercs.data || [],
    setores: setores.data || [],
    servicos: servicos.data || [],
    colecoes: colecoes.data || [],
  };
  return TERC.cache;
}

function fmtMoney(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtNum(v) { return (Number(v) || 0).toLocaleString('pt-BR'); }
function fmtPct(v) { return ((Number(v) || 0) * 100).toFixed(1) + '%'; }

/* ============================================================
 * DASHBOARD DE TERCEIRIZAÇÃO
 * ============================================================ */
ROUTES.terc_dashboard = async (main) => {
  await tercLoadCache();
  const hoje = dayjs().format('YYYY-MM-DD');
  const ini = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  main.innerHTML = `
    <div class="space-y-5">
      <div class="card p-5">
        <h3 class="text-xl font-semibold text-slate-800 flex items-center">
          <i class="fas fa-handshake mr-2 text-brand"></i>Dashboard de Terceirização
        </h3>
        <div class="flex gap-3 mt-4 items-end flex-wrap">
          <div class="field"><label>De</label><input type="date" id="td-de" value="${ini}" /></div>
          <div class="field"><label>Até</label><input type="date" id="td-ate" value="${hoje}" /></div>
          <button id="td-go" class="btn btn-primary"><i class="fas fa-sync mr-1"></i>Atualizar</button>
        </div>
      </div>
      <div id="td-content"><div class="text-center py-16"><i class="fas fa-spinner fa-spin text-2xl"></i></div></div>
    </div>`;
  $('#td-go').onclick = () => carregarTercDash();
  await carregarTercDash();
};

async function carregarTercDash() {
  const ct = $('#td-content');
  ct.innerHTML = '<div class="text-center py-16"><i class="fas fa-spinner fa-spin text-2xl"></i></div>';
  const de = $('#td-de').value, ate = $('#td-ate').value;
  const r = (await api('get', `/terc/dashboard?de=${de}&ate=${ate}`)).data;
  const rem = r.kpis.remessas || {}, ret = r.kpis.retornos || {};

  ct.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
      ${kpiCard('Remessas', fmtNum(rem.total), 'fa-paper-plane', 'blue', `${fmtNum(rem.em_aberto)} em aberto · ${fmtNum(rem.concluidas)} concluídas`)}
      ${kpiCard('Peças enviadas', fmtNum(rem.pecas_enviadas), 'fa-boxes', 'purple', 'no período')}
      ${kpiCard('Valor movimentado', fmtMoney(rem.valor_total), 'fa-dollar-sign', 'green', 'R$ em remessas')}
      ${kpiCard('Atrasadas', fmtNum(rem.atrasadas), 'fa-exclamation-triangle', 'red', 'em aberto fora do prazo')}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
      ${kpiCard('Retornos', fmtNum(ret.total), 'fa-undo', 'blue', 'no período')}
      ${kpiCard('Peças boas', fmtNum(ret.pecas_boas), 'fa-check-circle', 'green', 'aprovadas')}
      ${kpiCard('Refugo', fmtNum(ret.pecas_refugo), 'fa-times-circle', 'red', 'peças descartadas')}
      ${kpiCard('Conserto', fmtNum(ret.pecas_conserto), 'fa-wrench', 'orange', 'encaminhadas')}
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <div class="card p-4">
        <h4 class="font-semibold text-slate-800 mb-3"><i class="fas fa-chart-line mr-2 text-brand"></i>Produção diária</h4>
        <canvas id="td-prod" style="max-height:260px"></canvas>
      </div>
      <div class="card p-4">
        <h4 class="font-semibold text-slate-800 mb-3"><i class="fas fa-chart-pie mr-2 text-brand"></i>Por Serviço</h4>
        <canvas id="td-serv" style="max-height:260px"></canvas>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <div class="card p-4">
        <h4 class="font-semibold text-slate-800 mb-3"><i class="fas fa-trophy mr-2 text-brand"></i>Top 10 Terceirizados</h4>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 border-b"><th class="py-2">#</th><th>Nome</th><th>Setor</th><th class="text-right">Peças</th><th class="text-right">Valor</th></tr></thead>
          <tbody>${(r.top_terceirizados || []).map((x, i) => `
            <tr class="border-b border-slate-100">
              <td class="py-2">${i+1}</td>
              <td>${x.nome_terc}</td>
              <td><span class="text-slate-500">${x.nome_setor || '—'}</span></td>
              <td class="text-right">${fmtNum(x.pecas)}</td>
              <td class="text-right">${fmtMoney(x.valor)}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="py-4 text-center text-slate-400">Sem dados</td></tr>'}</tbody>
        </table>
      </div>
      <div class="card p-4">
        <h4 class="font-semibold text-slate-800 mb-3"><i class="fas fa-exclamation-triangle mr-2 text-orange-500"></i>Remessas atrasadas</h4>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 border-b"><th class="py-2">#</th><th>Terc.</th><th>Ref</th><th class="text-right">Qtd</th><th class="text-right">Dias</th></tr></thead>
          <tbody>${(r.atrasadas || []).map(x => `
            <tr class="border-b border-slate-100 cursor-pointer hover:bg-slate-50" onclick="abrirRemessa(${x.id_remessa})">
              <td class="py-2 font-mono">${x.num_controle}</td>
              <td>${x.nome_terc}</td>
              <td>${x.cod_ref}</td>
              <td class="text-right">${fmtNum(x.qtd_total)}</td>
              <td class="text-right font-bold text-red-500">${Math.floor(x.dias_atraso || 0)}d</td>
            </tr>`).join('') || '<tr><td colspan="5" class="py-4 text-center text-slate-400">Nenhuma remessa atrasada</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  setTimeout(() => {
    const cp = $('#td-prod');
    if (cp) new Chart(cp, {
      type: 'bar',
      data: {
        labels: r.producao_diaria.map(x => dayjs(x.dia).format('DD/MM')),
        datasets: [
          { label: 'Boa', data: r.producao_diaria.map(x => x.boa), backgroundColor: '#00FF9C' },
          { label: 'Refugo', data: r.producao_diaria.map(x => x.refugo), backgroundColor: '#FF3B3B' },
          { label: 'Conserto', data: r.producao_diaria.map(x => x.conserto), backgroundColor: '#F97316' },
        ]
      },
      options: { scales: { x: { stacked: true }, y: { stacked: true } } }
    });
    const cs = $('#td-serv');
    if (cs) new Chart(cs, {
      type: 'doughnut',
      data: {
        labels: (r.por_servico || []).map(x => x.desc_servico || 'N/A'),
        datasets: [{ data: (r.por_servico || []).map(x => x.pecas), backgroundColor: ['#2563EB','#7C3AED','#00FF9C','#F97316','#FF3B3B'] }]
      },
      options: { plugins: { legend: { position: 'bottom' } }, cutout: '55%' }
    });
  }, 100);
}

function kpiCard(label, value, icon, color, hint) {
  const c = { blue: '#2563EB', purple: '#7C3AED', green: '#00FF9C', red: '#FF3B3B', orange: '#F97316' }[color] || '#2563EB';
  return `<div class="card p-4" style="border-left:3px solid ${c}">
    <div class="flex items-center justify-between">
      <div>
        <div class="text-xs uppercase tracking-wide text-slate-500 font-semibold">${label}</div>
        <div class="text-2xl font-bold text-slate-800 mt-1">${value}</div>
        <div class="text-xs text-slate-500 mt-1">${hint || ''}</div>
      </div>
      <div class="w-10 h-10 rounded-full flex items-center justify-center" style="background:${c}22;color:${c}">
        <i class="fas ${icon}"></i>
      </div>
    </div>
  </div>`;
}

/* ============================================================
 * TERCEIRIZADOS (CRUD)
 * ============================================================ */
ROUTES.terceirizados = async (main) => {
  const cache = await tercLoadCache(true);
  const { data: rows } = await api('get', '/terc/terceirizados');
  main.innerHTML = `
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-xl font-semibold text-slate-800"><i class="fas fa-users-cog mr-2 text-brand"></i>Terceirizados</h3>
        <div class="flex gap-2">
          <input id="terc-search" type="text" placeholder="Buscar..." class="px-3 py-2 rounded border text-sm" style="width:220px" />
          <button id="terc-new" class="btn btn-primary"><i class="fas fa-plus mr-1"></i>Novo</button>
        </div>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="text-left text-slate-500 border-b">
          <th class="py-2">Nome</th><th>Setor</th><th>Situação</th><th class="text-right">Pessoas</th><th class="text-right">Min/dia</th><th class="text-right">Efic</th><th>Telefone</th><th class="text-center w-40">Ações</th>
        </tr></thead>
        <tbody id="terc-body">${renderTercRows(rows)}</tbody>
      </table>
    </div>`;

  $('#terc-new').onclick = () => openTercForm(null, cache);
  $('#terc-search').oninput = (e) => {
    const t = e.target.value.toLowerCase();
    $('#terc-body').innerHTML = renderTercRows(rows.filter(r =>
      (r.nome_terc || '').toLowerCase().includes(t) ||
      (r.nome_setor || '').toLowerCase().includes(t)));
    bindTercActions(rows, cache);
  };
  bindTercActions(rows, cache);
};

function renderTercRows(rows) {
  if (!rows.length) return '<tr><td colspan="8" class="py-6 text-center text-slate-400">Sem registros</td></tr>';
  return rows.map(r => `
    <tr class="border-b border-slate-100 hover:bg-slate-50">
      <td class="py-2"><b>${r.nome_terc}</b></td>
      <td>${r.nome_setor || '—'}</td>
      <td>${badgeSituacao(r.situacao)}</td>
      <td class="text-right">${r.qtd_pessoas}</td>
      <td class="text-right">${r.min_trab_dia}</td>
      <td class="text-right">${fmtPct(r.efic_padrao)}</td>
      <td>${r.telefone || '—'}</td>
      <td class="text-center space-x-1">
        <button class="btn-icon btn-view" data-id="${r.id_terc}" title="Detalhes"><i class="fas fa-eye text-slate-600"></i></button>
        <button class="btn-icon btn-edit" data-id="${r.id_terc}" title="Editar"><i class="fas fa-edit text-blue-600"></i></button>
        <button class="btn-icon btn-toggle" data-id="${r.id_terc}" data-sit="${r.situacao}" title="${r.situacao === 'Ativa' ? 'Inativar' : 'Ativar'}"><i class="fas ${r.situacao === 'Ativa' ? 'fa-toggle-on text-green-500' : 'fa-toggle-off text-slate-400'}"></i></button>
        <button class="btn-icon btn-del" data-id="${r.id_terc}" data-nome="${r.nome_terc}" title="Excluir"><i class="fas fa-trash text-red-500"></i></button>
      </td>
    </tr>`).join('');
}

function bindTercActions(rows, cache) {
  $$('.btn-edit').forEach(b => b.onclick = () => {
    const row = rows.find(r => r.id_terc == b.dataset.id);
    openTercForm(row, cache);
  });
  $$('.btn-view').forEach(b => b.onclick = () => abrirTerceirizadoDetalhe(b.dataset.id));
  $$('.btn-toggle').forEach(b => b.onclick = async () => {
    const nova = b.dataset.sit === 'Ativa' ? 'Inativa' : 'Ativa';
    await api('patch', `/terc/terceirizados/${b.dataset.id}/situacao`, { situacao: nova });
    toast(`Terceirizado ${nova.toLowerCase()}`, 'success');
    ROUTES.terceirizados($('#main-content'));
  });
  $$('.btn-del').forEach(b => b.onclick = async () => {
    if (!confirm(`Excluir DEFINITIVAMENTE o terceirizado "${b.dataset.nome}"?`)) return;
    try {
      await api('delete', `/terc/terceirizados/${b.dataset.id}`);
      toast('Terceirizado excluído', 'success');
      ROUTES.terceirizados($('#main-content'));
    } catch (e) {}
  });
}

function badgeSituacao(s) {
  const c = { 'Ativa': 'bg-green-100 text-green-700', 'Inativa': 'bg-slate-200 text-slate-600', 'Excluida': 'bg-red-100 text-red-700', 'Suspensa': 'bg-yellow-100 text-yellow-700' };
  return `<span class="px-2 py-1 rounded text-xs font-semibold ${c[s] || 'bg-slate-100'}">${s}</span>`;
}

function openTercForm(row, cache) {
  const isEdit = !!row;
  const opts = cache.setores.map(s => `<option value="${s.id_setor}" ${row && row.id_setor == s.id_setor ? 'selected' : ''}>${s.nome_setor}</option>`).join('');
  const html = `
    <div class="modal-backdrop" id="terc-modal">
      <div class="modal p-5" style="max-width:720px">
        <h3 class="text-lg font-semibold mb-3">${isEdit ? 'Editar' : 'Novo'} Terceirizado</h3>
        <form id="terc-form" class="grid grid-cols-2 gap-3">
          <div class="col-span-2 field"><label>Nome *</label><input name="nome_terc" required value="${row?.nome_terc || ''}" /></div>
          <div class="field"><label>Setor</label><select name="id_setor"><option value="">—</option>${opts}</select></div>
          <div class="field"><label>Situação</label><select name="situacao">
            ${['Ativa','Inativa','Suspensa','Excluida'].map(s => `<option ${row?.situacao === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>
          <div class="field"><label>CPF/CNPJ</label><input name="cpf_cnpj" value="${row?.cpf_cnpj || ''}" /></div>
          <div class="field"><label>Telefone</label><input name="telefone" value="${row?.telefone || ''}" /></div>
          <div class="field col-span-2"><label>E-mail</label><input name="email" value="${row?.email || ''}" /></div>
          <div class="field col-span-2"><label>Endereço</label><input name="endereco" value="${row?.endereco || ''}" /></div>
          <div class="field"><label>Qtd pessoas</label><input name="qtd_pessoas" type="number" min="1" value="${row?.qtd_pessoas || 1}" /></div>
          <div class="field"><label>Min. trab./dia</label><input name="min_trab_dia" type="number" min="1" value="${row?.min_trab_dia || 480}" /></div>
          <div class="field"><label>Eficiência (0-1)</label><input name="efic_padrao" type="number" step="0.01" min="0.1" max="1" value="${row?.efic_padrao || 0.8}" /></div>
          <div class="field"><label>Prazo padrão (dias)</label><input name="prazo_padrao" type="number" min="0" value="${row?.prazo_padrao || 3}" /></div>
          <div class="field col-span-2"><label>Observação</label><textarea name="observacao" rows="2">${row?.observacao || ''}</textarea></div>
          <div class="col-span-2 flex justify-end gap-2 mt-2">
            <button type="button" class="btn btn-secondary" onclick="$('#terc-modal').remove()">Cancelar</button>
            <button type="submit" class="btn btn-primary"><i class="fas fa-save mr-1"></i>Salvar</button>
          </div>
        </form>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  $('#terc-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    try {
      if (isEdit) await api('put', `/terc/terceirizados/${row.id_terc}`, body);
      else await api('post', '/terc/terceirizados', body);
      toast('Salvo com sucesso', 'success');
      $('#terc-modal').remove();
      ROUTES.terceirizados($('#main-content'));
    } catch (e) {}
  };
}

async function abrirTerceirizadoDetalhe(id) {
  const r = (await api('get', `/terc/terceirizados/${id}`)).data;
  const s = r.stats || {};
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="terc-view">
      <div class="modal p-6" style="max-width:640px">
        <h3 class="text-xl font-bold text-slate-800">${r.nome_terc}</h3>
        <div class="text-sm text-slate-500 mb-4">${r.nome_setor || '—'} · ${badgeSituacao(r.situacao)}</div>
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div><div class="text-xs text-slate-500">CPF/CNPJ</div><div class="font-semibold">${r.cpf_cnpj || '—'}</div></div>
          <div><div class="text-xs text-slate-500">Telefone</div><div class="font-semibold">${r.telefone || '—'}</div></div>
          <div><div class="text-xs text-slate-500">E-mail</div><div class="font-semibold">${r.email || '—'}</div></div>
          <div><div class="text-xs text-slate-500">Prazo padrão</div><div class="font-semibold">${r.prazo_padrao} dias</div></div>
          <div><div class="text-xs text-slate-500">Pessoas / Min-dia</div><div class="font-semibold">${r.qtd_pessoas} / ${r.min_trab_dia}min</div></div>
          <div><div class="text-xs text-slate-500">Eficiência</div><div class="font-semibold">${fmtPct(r.efic_padrao)}</div></div>
        </div>
        <div class="bg-slate-50 p-3 rounded mb-4">
          <div class="text-sm font-semibold text-slate-700 mb-2">Estatísticas</div>
          <div class="grid grid-cols-3 gap-2 text-sm">
            <div><span class="text-slate-500">Total remessas:</span> <b>${fmtNum(s.total_remessas)}</b></div>
            <div><span class="text-slate-500">Peças enviadas:</span> <b>${fmtNum(s.pecas_enviadas)}</b></div>
            <div><span class="text-slate-500">Valor total:</span> <b>${fmtMoney(s.valor_total)}</b></div>
            <div><span class="text-slate-500">Em aberto:</span> <b>${fmtNum(s.em_aberto)}</b></div>
            <div><span class="text-slate-500">Atrasadas:</span> <b class="text-red-500">${fmtNum(s.atrasadas)}</b></div>
            <div><span class="text-slate-500">Concluídas:</span> <b class="text-green-600">${fmtNum(s.concluidas)}</b></div>
          </div>
        </div>
        ${r.observacao ? `<div class="bg-yellow-50 border border-yellow-200 p-3 rounded text-sm mb-4 whitespace-pre-wrap">${r.observacao}</div>` : ''}
        <div class="flex justify-end"><button class="btn btn-secondary" onclick="$('#terc-view').remove()">Fechar</button></div>
      </div>
    </div>`);
}

/* ============================================================
 * REMESSAS
 * ============================================================ */
ROUTES.terc_remessas = async (main) => {
  const cache = await tercLoadCache();
  const { data: rows } = await api('get', '/terc/remessas');
  main.innerHTML = `
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 class="text-xl font-semibold text-slate-800"><i class="fas fa-paper-plane mr-2 text-brand"></i>Remessas para Terceirizados</h3>
        <div class="flex gap-2 flex-wrap">
          <select id="rem-f-status" class="px-2 py-2 border rounded text-sm">
            <option value="">Todos status</option>
            ${['Aberta','EmProducao','Parcial','Concluida','Atrasada','Cancelada'].map(s => `<option>${s}</option>`).join('')}
          </select>
          <select id="rem-f-terc" class="px-2 py-2 border rounded text-sm">
            <option value="">Todos terceirizados</option>
            ${cache.terceirizados.map(t => `<option value="${t.id_terc}">${t.nome_terc}</option>`).join('')}
          </select>
          <input id="rem-search" type="text" placeholder="Buscar ref/op/cor..." class="px-3 py-2 border rounded text-sm" style="width:220px" />
          <button id="rem-new" class="btn btn-primary"><i class="fas fa-plus mr-1"></i>Nova Remessa</button>
        </div>
      </div>
      <div class="overflow-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 border-b sticky-head">
            <th class="py-2 px-1">Nº</th><th>OP</th><th>Terc.</th><th>Ref.</th><th>Serviço</th><th>Cor</th>
            <th class="text-right">Qtd</th><th class="text-right">Valor</th><th>Saída</th><th>Previsão</th><th>Status</th><th class="text-center w-24">Ações</th>
          </tr></thead>
          <tbody id="rem-body">${renderRemessaRows(rows)}</tbody>
        </table>
      </div>
      <div class="mt-2 text-sm text-slate-500">${rows.length} remessa(s)</div>
    </div>`;

  $('#rem-new').onclick = () => abrirFormRemessa(null);
  const filtrar = async () => {
    const params = new URLSearchParams();
    const s = $('#rem-f-status').value, t = $('#rem-f-terc').value, q = $('#rem-search').value;
    if (s) params.set('status', s);
    if (t) params.set('id_terc', t);
    if (q) params.set('search', q);
    const { data } = await api('get', '/terc/remessas?' + params);
    $('#rem-body').innerHTML = renderRemessaRows(data);
    bindRemActions(data);
  };
  $('#rem-f-status').onchange = filtrar;
  $('#rem-f-terc').onchange = filtrar;
  let deb; $('#rem-search').oninput = () => { clearTimeout(deb); deb = setTimeout(filtrar, 300); };
  bindRemActions(rows);
};

function renderRemessaRows(rows) {
  if (!rows.length) return '<tr><td colspan="12" class="py-6 text-center text-slate-400">Sem remessas</td></tr>';
  return rows.map(r => `
    <tr class="border-b border-slate-100 hover:bg-slate-50 ${r.atrasada ? 'bg-red-50' : ''}">
      <td class="py-2 px-1 font-mono"><b>${r.num_controle}</b></td>
      <td class="font-mono">${r.num_op || '—'}</td>
      <td>${r.nome_terc || '—'}</td>
      <td class="font-mono text-xs">${r.cod_ref}</td>
      <td>${r.desc_servico || '—'}</td>
      <td>${r.cor || '—'}</td>
      <td class="text-right"><b>${fmtNum(r.qtd_total)}</b></td>
      <td class="text-right">${fmtMoney(r.valor_total)}</td>
      <td>${dayjs(r.dt_saida).format('DD/MM/YY')}</td>
      <td class="${r.atrasada ? 'text-red-500 font-bold' : ''}">${r.dt_previsao ? dayjs(r.dt_previsao).format('DD/MM/YY') : '—'}</td>
      <td>${badgeStatusRem(r.status, r.atrasada)}</td>
      <td class="text-center">
        <button class="btn-icon btn-view-rem" data-id="${r.id_remessa}" title="Detalhes"><i class="fas fa-eye text-slate-600"></i></button>
        <button class="btn-icon btn-edit-rem" data-id="${r.id_remessa}" title="Editar"><i class="fas fa-edit text-blue-600"></i></button>
        <button class="btn-icon btn-del-rem" data-id="${r.id_remessa}" data-num="${r.num_controle}" title="Excluir"><i class="fas fa-trash text-red-500"></i></button>
      </td>
    </tr>`).join('');
}
function badgeStatusRem(s, atrasada) {
  const c = { 'Aberta': 'bg-slate-200 text-slate-700', 'EmProducao': 'bg-blue-100 text-blue-700',
    'Parcial': 'bg-yellow-100 text-yellow-700', 'Concluida': 'bg-green-100 text-green-700',
    'Atrasada': 'bg-red-100 text-red-700', 'Cancelada': 'bg-slate-100 text-slate-400 line-through' };
  const label = atrasada && s !== 'Concluida' && s !== 'Cancelada' ? 'Atrasada' : s;
  const cls = atrasada && s !== 'Concluida' && s !== 'Cancelada' ? c.Atrasada : (c[s] || 'bg-slate-100');
  return `<span class="px-2 py-1 rounded text-xs font-semibold ${cls}">${label}</span>`;
}

function bindRemActions(rows) {
  $$('.btn-view-rem').forEach(b => b.onclick = () => abrirRemessa(b.dataset.id));
  $$('.btn-edit-rem').forEach(b => b.onclick = async () => {
    const { data } = await api('get', `/terc/remessas/${b.dataset.id}`);
    abrirFormRemessa(data);
  });
  $$('.btn-del-rem').forEach(b => b.onclick = async () => {
    if (!confirm(`Excluir remessa Nº ${b.dataset.num}?`)) return;
    try {
      await api('delete', `/terc/remessas/${b.dataset.id}`);
      toast('Remessa excluída', 'success');
      ROUTES.terc_remessas($('#main-content'));
    } catch (e) {}
  });
}

async function abrirFormRemessa(row) {
  const cache = await tercLoadCache();
  const isEdit = !!row;
  let num;
  if (!isEdit) {
    const { data } = await api('get', '/terc/remessas/next-num');
    num = data.num_controle;
  }

  const tercOpts = cache.terceirizados.filter(t => t.situacao === 'Ativa' || (row && t.id_terc === row.id_terc))
    .map(t => `<option value="${t.id_terc}" ${row && row.id_terc == t.id_terc ? 'selected' : ''}>${t.nome_terc}</option>`).join('');
  const servOpts = cache.servicos.map(s => `<option value="${s.id_servico}" ${row && row.id_servico == s.id_servico ? 'selected' : ''}>${s.desc_servico}</option>`).join('');
  const colOpts = cache.colecoes.map(co => `<option value="${co.id_colecao}" ${row && row.id_colecao == co.id_colecao ? 'selected' : ''}>${co.nome_colecao}</option>`).join('');

  const gradeInputs = TAMS.map(t => {
    const g = row?.grade?.find(x => x.tamanho === t);
    return `<div class="flex flex-col items-center">
      <label class="text-xs text-slate-500 font-bold">${t}</label>
      <input type="number" min="0" name="tam_${t}" value="${g?.qtd || 0}" class="w-16 text-center px-1 py-1 border rounded text-sm" />
    </div>`;
  }).join('');

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="rem-modal">
      <div class="modal p-5" style="max-width:1000px;max-height:92vh;overflow:auto">
        <h3 class="text-lg font-semibold mb-4">${isEdit ? 'Editar' : 'Nova'} Remessa ${isEdit ? '#' + row.num_controle : '(Nº ' + num + ')'}</h3>
        <form id="rem-form">
          <div class="grid grid-cols-12 gap-3 mb-3">
            <div class="field col-span-2"><label>Nº OP</label><input name="num_op" value="${row?.num_op || ''}" /></div>
            <div class="field col-span-3"><label>Terceirizado *</label><select name="id_terc" required>${tercOpts}</select></div>
            <div class="field col-span-3"><label>Serviço *</label><select name="id_servico" required>${servOpts}</select></div>
            <div class="field col-span-2"><label>Grade (1-4)</label><input name="grade" type="number" min="1" max="4" value="${row?.grade || 1}" /></div>
            <div class="field col-span-2"><label>Coleção</label><select name="id_colecao"><option value="">—</option>${colOpts}</select></div>

            <div class="field col-span-3"><label>Cód. Referência *</label><input name="cod_ref" required value="${row?.cod_ref || ''}" /></div>
            <div class="field col-span-5"><label>Descrição</label><input name="desc_ref" value="${row?.desc_ref || ''}" /></div>
            <div class="field col-span-2"><label>Cor</label><input name="cor" value="${row?.cor || ''}" /></div>
            <div class="field col-span-2"><label>Status</label><select name="status">
              ${['Aberta','EmProducao','Parcial','Concluida','Cancelada'].map(s => `<option ${row?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select></div>
          </div>

          <div class="bg-slate-50 p-3 rounded mb-3">
            <div class="text-sm font-semibold text-slate-700 mb-2">Grade (quantidade por tamanho)</div>
            <div class="flex gap-2 flex-wrap">${gradeInputs}</div>
            <div class="text-xs text-slate-500 mt-2">O total é calculado automaticamente pela soma dos tamanhos.</div>
          </div>

          <div class="grid grid-cols-12 gap-3 mb-3">
            <div class="field col-span-2"><label>Data saída *</label><input name="dt_saida" type="date" required value="${row?.dt_saida ? row.dt_saida.slice(0,10) : dayjs().format('YYYY-MM-DD')}" /></div>
            <div class="field col-span-2"><label>Data início</label><input name="dt_inicio" type="date" value="${row?.dt_inicio ? row.dt_inicio.slice(0,10) : ''}" /></div>
            <div class="field col-span-2"><label>Prazo (dias)</label><input name="prazo_dias" type="number" min="0" value="${row?.prazo_dias || 0}" placeholder="0=auto" /></div>
            <div class="field col-span-2"><label>Tempo/peça (min)</label><input name="tempo_peca" type="number" step="0.01" min="0" value="${row?.tempo_peca || 0}" /></div>
            <div class="field col-span-2"><label>Preço unit. (R$)</label><input name="preco_unit" type="number" step="0.01" min="0" value="${row?.preco_unit || 0}" /></div>
            <div class="field col-span-2"><label>Pessoas</label><input name="qtd_pessoas" type="number" min="1" value="${row?.qtd_pessoas || 1}" /></div>
            <div class="field col-span-2"><label>Eficiência (0-1)</label><input name="efic_pct" type="number" step="0.01" min="0.1" max="1" value="${row?.efic_pct || 0.8}" /></div>
            <div class="field col-span-2"><label>Min/dia</label><input name="min_trab_dia" type="number" min="1" value="${row?.min_trab_dia || 480}" /></div>
            <div class="field col-span-8"><label>Observação</label><input name="observacao" value="${row?.observacao || ''}" /></div>
          </div>

          <div class="flex justify-between items-center mt-4">
            <button type="button" id="rem-lookup" class="btn btn-secondary"><i class="fas fa-search mr-1"></i>Buscar preço tabelado</button>
            <div class="flex gap-2">
              <button type="button" class="btn btn-secondary" onclick="$('#rem-modal').remove()">Cancelar</button>
              <button type="submit" class="btn btn-primary"><i class="fas fa-save mr-1"></i>Salvar</button>
            </div>
          </div>
        </form>
      </div>
    </div>`);

  $('#rem-lookup').onclick = async () => {
    const fd = new FormData($('#rem-form'));
    const q = new URLSearchParams({
      cod_ref: fd.get('cod_ref') || '',
      id_servico: fd.get('id_servico') || '',
      grade: fd.get('grade') || '1',
      id_colecao: fd.get('id_colecao') || '0',
    });
    try {
      const { data } = await api('get', '/terc/precos/lookup?' + q);
      if (!data) { toast('Nenhum preço tabelado encontrado', 'warning'); return; }
      $('#rem-form [name=preco_unit]').value = data.preco || 0;
      $('#rem-form [name=tempo_peca]').value = data.tempo_min || 0;
      if (data.desc_ref && !$('#rem-form [name=desc_ref]').value) $('#rem-form [name=desc_ref]').value = data.desc_ref;
      toast('Preço aplicado', 'success');
    } catch (e) {}
  };

  $('#rem-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    body.grade_valor = body.grade; // grade (1-4)
    const grade = TAMS.filter(t => Number(fd.get(`tam_${t}`)) > 0).map(t => ({ tamanho: t, qtd: Number(fd.get(`tam_${t}`)) }));
    if (grade.length === 0) { toast('Informe pelo menos um tamanho com quantidade', 'error'); return; }
    body.grade = grade;
    try {
      if (isEdit) await api('put', `/terc/remessas/${row.id_remessa}`, body);
      else await api('post', '/terc/remessas', body);
      toast('Remessa salva', 'success');
      $('#rem-modal').remove();
      ROUTES.terc_remessas($('#main-content'));
    } catch (e) {}
  };
}

/* ============================================================
 * DETALHE DE REMESSA (com retornos)
 * ============================================================ */
async function abrirRemessa(id) {
  const { data: r } = await api('get', `/terc/remessas/${id}`);
  const t = r.totais_retorno || {};
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="rem-view">
      <div class="modal p-5" style="max-width:960px;max-height:92vh;overflow:auto">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-xl font-bold text-slate-800">Remessa Nº ${r.num_controle}</h3>
            <div class="text-sm text-slate-500">OP ${r.num_op || '—'} · ${r.cod_ref} — ${r.desc_ref || ''}</div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-primary" onclick="abrirFormRetorno(${r.id_remessa})"><i class="fas fa-undo mr-1"></i>Registrar Retorno</button>
            <button class="btn btn-secondary" onclick="$('#rem-view').remove()">Fechar</button>
          </div>
        </div>

        <div class="grid grid-cols-4 gap-3 mb-4">
          <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Terceirizado</div><div class="font-semibold">${r.nome_terc}</div></div>
          <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Serviço</div><div class="font-semibold">${r.desc_servico}</div></div>
          <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Cor</div><div class="font-semibold">${r.cor || '—'}</div></div>
          <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Status</div>${badgeStatusRem(r.status)}</div>
        </div>

        <div class="grid grid-cols-4 gap-3 mb-4">
          <div class="card p-3 text-center"><div class="text-xs text-slate-500">Qtd Enviada</div><div class="text-2xl font-bold text-slate-800">${fmtNum(r.qtd_total)}</div></div>
          <div class="card p-3 text-center"><div class="text-xs text-slate-500">Retornada (boa)</div><div class="text-2xl font-bold text-green-600">${fmtNum(t.boa)}</div></div>
          <div class="card p-3 text-center"><div class="text-xs text-slate-500">Refugo / Conserto</div><div class="text-2xl font-bold text-orange-500">${fmtNum(t.refugo + t.conserto)}</div></div>
          <div class="card p-3 text-center"><div class="text-xs text-slate-500">Saldo (pendente)</div><div class="text-2xl font-bold ${r.saldo > 0 ? 'text-red-500' : 'text-green-600'}">${fmtNum(r.saldo)}</div></div>
        </div>

        <div class="mb-4">
          <div class="text-sm font-semibold text-slate-700 mb-2">Grade enviada</div>
          <div class="flex gap-2 flex-wrap">
            ${r.grade.map(g => `<div class="bg-blue-50 border border-blue-200 px-3 py-2 rounded"><div class="text-xs text-slate-500">${g.tamanho}</div><div class="font-bold">${g.qtd}</div></div>`).join('') || '<span class="text-slate-400 text-sm">Sem grade</span>'}
          </div>
        </div>

        <div class="grid grid-cols-4 gap-3 mb-4 text-sm">
          <div><span class="text-slate-500">Preço unit:</span> <b>${fmtMoney(r.preco_unit)}</b></div>
          <div><span class="text-slate-500">Valor total:</span> <b>${fmtMoney(r.valor_total)}</b></div>
          <div><span class="text-slate-500">Tempo/peça:</span> <b>${(r.tempo_peca || 0).toFixed(2)} min</b></div>
          <div><span class="text-slate-500">Eficiência:</span> <b>${fmtPct(r.efic_pct)}</b></div>
          <div><span class="text-slate-500">Data saída:</span> <b>${dayjs(r.dt_saida).format('DD/MM/YYYY')}</b></div>
          <div><span class="text-slate-500">Data início:</span> <b>${r.dt_inicio ? dayjs(r.dt_inicio).format('DD/MM/YYYY') : '—'}</b></div>
          <div><span class="text-slate-500">Previsão:</span> <b class="${r.atrasada ? 'text-red-500' : ''}">${r.dt_previsao ? dayjs(r.dt_previsao).format('DD/MM/YYYY') : '—'}</b></div>
          <div><span class="text-slate-500">Prazo (dias):</span> <b>${r.prazo_dias}</b></div>
        </div>

        <h4 class="font-semibold text-slate-700 mb-2"><i class="fas fa-history mr-2"></i>Histórico de Retornos</h4>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 border-b">
            <th class="py-2">Data</th><th class="text-right">Boa</th><th class="text-right">Refugo</th><th class="text-right">Conserto</th><th class="text-right">Total</th><th class="text-right">Valor pago</th><th>Obs</th><th></th>
          </tr></thead>
          <tbody>${r.retornos.map(ret => `
            <tr class="border-b border-slate-100">
              <td class="py-2">${dayjs(ret.dt_retorno).format('DD/MM/YYYY')}</td>
              <td class="text-right text-green-600">${fmtNum(ret.qtd_boa)}</td>
              <td class="text-right text-red-500">${fmtNum(ret.qtd_refugo)}</td>
              <td class="text-right text-orange-500">${fmtNum(ret.qtd_conserto)}</td>
              <td class="text-right font-bold">${fmtNum(ret.qtd_total)}</td>
              <td class="text-right">${fmtMoney(ret.valor_pago)}</td>
              <td class="text-xs text-slate-500">${ret.observacao || ''}</td>
              <td><button class="btn-icon" onclick="excluirRetorno(${ret.id_retorno}, ${id})" title="Excluir"><i class="fas fa-trash text-red-500"></i></button></td>
            </tr>`).join('') || '<tr><td colspan="8" class="py-4 text-center text-slate-400">Nenhum retorno registrado</td></tr>'}
          </tbody>
        </table>

        ${r.observacao ? `<div class="bg-yellow-50 border border-yellow-200 p-3 rounded text-sm mt-4 whitespace-pre-wrap">${r.observacao}</div>` : ''}
      </div>
    </div>`);
}

window.abrirRemessa = abrirRemessa;
window.abrirFormRetorno = abrirFormRetorno;
window.excluirRetorno = async function(id, idRemessa) {
  if (!confirm('Excluir este retorno?')) return;
  try { await api('delete', `/terc/retornos/${id}`); toast('Retorno excluído', 'success'); $('#rem-view').remove(); abrirRemessa(idRemessa); } catch(e) {}
};

async function abrirFormRetorno(idRemessa) {
  const { data: r } = await api('get', `/terc/remessas/${idRemessa}`);
  const gradeInputs = TAMS.map(t => {
    const g = r.grade.find(x => x.tamanho === t);
    if (!g) return '';
    return `<div class="flex flex-col items-center">
      <label class="text-xs text-slate-500 font-bold">${t} <span class="text-slate-400">(${g.qtd})</span></label>
      <input type="number" min="0" max="${g.qtd}" name="tam_${t}" value="0" class="w-16 text-center px-1 py-1 border rounded text-sm" />
    </div>`;
  }).join('');

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="ret-modal" style="z-index:60">
      <div class="modal p-5" style="max-width:720px">
        <h3 class="text-lg font-semibold mb-3">Registrar retorno — Remessa Nº ${r.num_controle}</h3>
        <div class="text-sm text-slate-500 mb-3">Saldo pendente: <b class="text-slate-800">${fmtNum(r.saldo)}</b> peças</div>
        <form id="ret-form">
          <div class="bg-slate-50 p-3 rounded mb-3">
            <div class="text-sm font-semibold text-slate-700 mb-2">Grade retornada (máx. conforme enviada)</div>
            <div class="flex gap-2 flex-wrap">${gradeInputs || '<span class="text-slate-400">Sem grade</span>'}</div>
          </div>
          <div class="grid grid-cols-4 gap-3 mb-3">
            <div class="field"><label>Data retorno *</label><input name="dt_retorno" type="date" required value="${dayjs().format('YYYY-MM-DD')}" /></div>
            <div class="field"><label>Qtd boa *</label><input name="qtd_boa" type="number" min="0" value="0" required /></div>
            <div class="field"><label>Refugo</label><input name="qtd_refugo" type="number" min="0" value="0" /></div>
            <div class="field"><label>Para conserto</label><input name="qtd_conserto" type="number" min="0" value="0" /></div>
            <div class="field col-span-2"><label>Valor pago (R$)</label><input name="valor_pago" type="number" step="0.01" min="0" value="" placeholder="auto: qtd boa × preço" /></div>
            <div class="field col-span-2"><label>Data pagamento</label><input name="dt_pagamento" type="date" /></div>
            <div class="field col-span-4"><label>Observação</label><input name="observacao" /></div>
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="btn btn-secondary" onclick="$('#ret-modal').remove()">Cancelar</button>
            <button type="submit" class="btn btn-primary"><i class="fas fa-save mr-1"></i>Registrar</button>
          </div>
        </form>
      </div>
    </div>`);

  // Autofill qtd_boa com soma da grade digitada
  $$('#ret-form [name^=tam_]').forEach(inp => {
    inp.oninput = () => {
      let s = 0;
      $$('#ret-form [name^=tam_]').forEach(x => s += Number(x.value) || 0);
      $('#ret-form [name=qtd_boa]').value = s;
    };
  });

  $('#ret-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    body.id_remessa = idRemessa;
    body.grade = TAMS.filter(t => Number(fd.get(`tam_${t}`)) > 0).map(t => ({ tamanho: t, qtd: Number(fd.get(`tam_${t}`)) }));
    try {
      const res = await api('post', '/terc/retornos', body);
      toast(`Retorno registrado. Status: ${res.data.status_remessa}`, 'success');
      $('#ret-modal').remove();
      $('#rem-view').remove();
      abrirRemessa(idRemessa);
    } catch (e) {}
  };
}

/* ============================================================
 * RESUMO DE TERCEIRIZAÇÕES (tabela consolidada)
 * ============================================================ */
ROUTES.terc_resumo = async (main) => {
  const cache = await tercLoadCache();
  const colOpts = cache.colecoes.map(c => `<option value="${c.id_colecao}">${c.nome_colecao}</option>`).join('');
  main.innerHTML = `
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-xl font-semibold text-slate-800"><i class="fas fa-table mr-2 text-brand"></i>Resumo de Terceirizações</h3>
        <div class="flex gap-2">
          <select id="res-colecao" class="px-2 py-2 border rounded text-sm">
            <option value="">Todas as coleções</option>${colOpts}
          </select>
          <button id="res-go" class="btn btn-primary"><i class="fas fa-sync mr-1"></i>Atualizar</button>
        </div>
      </div>
      <div id="res-content"><div class="text-center py-16"><i class="fas fa-spinner fa-spin text-2xl"></i></div></div>
    </div>`;
  $('#res-go').onclick = () => carregarResumo();
  $('#res-colecao').onchange = () => carregarResumo();
  carregarResumo();
};

async function carregarResumo() {
  const col = $('#res-colecao').value;
  const url = col ? `/terc/resumo?id_colecao=${col}` : '/terc/resumo';
  const { data } = await api(url ? 'get' : 'get', url);
  const rows = (await api('get', url)).data;
  const tot = rows.reduce((a, r) => ({
    pecas_coletar: a.pecas_coletar + (Number(r.pecas_coletar) || 0),
    pecas_producao: a.pecas_producao + (Number(r.pecas_producao) || 0),
    pecas_produzidas: a.pecas_produzidas + (Number(r.pecas_produzidas) || 0),
    pecas_conserto: a.pecas_conserto + (Number(r.pecas_conserto) || 0),
    pecas_consertadas: a.pecas_consertadas + (Number(r.pecas_consertadas) || 0),
    valor: a.valor + (Number(r.valor_movimentado) || 0),
  }), { pecas_coletar: 0, pecas_producao: 0, pecas_produzidas: 0, pecas_conserto: 0, pecas_consertadas: 0, valor: 0 });

  $('#res-content').innerHTML = `
    <div class="overflow-auto">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-slate-500 border-b">
          <th class="py-2">Terceirizado</th><th>Setor</th><th>Situação</th>
          <th class="text-right">A Coletar</th><th>Data Término</th>
          <th class="text-right">Em Produção</th><th class="text-right">Produzidas</th>
          <th class="text-right">Conserto</th><th class="text-right">Consertadas</th>
          <th class="text-right">Índice</th><th class="text-right">Valor Total</th>
        </tr></thead>
        <tbody>
        ${rows.map(r => `
          <tr class="border-b border-slate-100 hover:bg-slate-50">
            <td class="py-2"><b>${r.nome_terc}</b></td>
            <td>${r.nome_setor || '—'}</td>
            <td>${badgeSituacao(r.situacao)}</td>
            <td class="text-right ${r.pecas_coletar > 0 ? 'font-bold text-orange-500' : ''}">${fmtNum(r.pecas_coletar)}</td>
            <td>${r.dt_termino ? dayjs(r.dt_termino).format('DD/MM/YY') : '—'}</td>
            <td class="text-right">${fmtNum(r.pecas_producao)}</td>
            <td class="text-right text-green-600">${fmtNum(r.pecas_produzidas)}</td>
            <td class="text-right text-orange-500">${fmtNum(r.pecas_conserto)}</td>
            <td class="text-right">${fmtNum(r.pecas_consertadas)}</td>
            <td class="text-right ${r.indice_consertos > 0.05 ? 'text-red-500 font-bold' : ''}">${fmtPct(r.indice_consertos)}</td>
            <td class="text-right">${fmtMoney(r.valor_movimentado)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot class="bg-slate-100 font-bold">
          <tr>
            <td class="py-2" colspan="3">TOTAIS</td>
            <td class="text-right">${fmtNum(tot.pecas_coletar)}</td><td></td>
            <td class="text-right">${fmtNum(tot.pecas_producao)}</td>
            <td class="text-right text-green-600">${fmtNum(tot.pecas_produzidas)}</td>
            <td class="text-right text-orange-500">${fmtNum(tot.pecas_conserto)}</td>
            <td class="text-right">${fmtNum(tot.pecas_consertadas)}</td>
            <td></td>
            <td class="text-right">${fmtMoney(tot.valor)}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

/* ============================================================
 * IMPORTADOR de remessas (usa SheetJS já carregado)
 * ============================================================ */
ROUTES.terc_importar = async (main) => {
  main.innerHTML = `
    <div class="space-y-5">
      <div class="card p-5">
        <h3 class="text-lg font-semibold text-slate-800 mb-2"><i class="fas fa-file-import mr-2 text-brand"></i>Importador de Remessas (Controle de Terceirização)</h3>
        <p class="text-sm text-slate-600 mb-4">
          Envie a planilha <b>"Controle de Terceirização"</b> ou um arquivo Excel/CSV com colunas:
          <code class="bg-slate-100 px-1">num_controle, num_op, nome_terc, setor, cod_ref, desc_ref, desc_servico, cor, grade, dt_saida, preco_unit, tempo_peca</code>
          + tamanhos por prefixo <code>tam_P, tam_M, tam_G, tam_GG, tam_EG</code>... Ou use a aba <b>Remessa</b> da planilha original (colunas A:AL são mapeadas automaticamente).
        </p>
        <div class="flex gap-3 items-end flex-wrap">
          <input type="file" id="imp-file" accept=".xlsx,.xls,.csv" class="text-sm" />
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="imp-dry" checked /> Dry-run (apenas simular)</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="imp-cad" checked /> Criar cadastros faltantes</label>
          <button id="imp-go" class="btn btn-primary" disabled><i class="fas fa-play mr-1"></i>Processar</button>
        </div>
        <div id="imp-info" class="text-sm text-slate-500 mt-3"></div>
      </div>
      <div id="imp-result"></div>
    </div>`;

  let parsed = null;
  $('#imp-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#imp-info').innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i>Lendo arquivo...`;
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      // Tenta aba "Remessa", senão primeira aba
      const sn = wb.SheetNames.find(n => /remessa/i.test(n)) || wb.SheetNames[0];
      const ws = wb.Sheets[sn];
      // Cabeçalho da aba Remessa está na linha 2
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, range: 1, raw: false, dateNF: 'yyyy-mm-dd' });
      const header = raw[0] || [];
      const rows = raw.slice(1).filter(r => r && r.some(v => v != null && v !== ''));
      parsed = mapImportRows(header, rows);
      $('#imp-info').innerHTML = `<i class="fas fa-check text-green-500 mr-1"></i>${parsed.length} linha(s) reconhecida(s) na aba <b>${sn}</b>.`;
      $('#imp-go').disabled = false;
    } catch (err) {
      $('#imp-info').innerHTML = `<i class="fas fa-times text-red-500 mr-1"></i>Erro: ${err.message}`;
    }
  };

  $('#imp-go').onclick = async () => {
    if (!parsed) return;
    $('#imp-result').innerHTML = `<div class="card p-5"><i class="fas fa-spinner fa-spin mr-1"></i>Processando ${parsed.length} linhas...</div>`;
    try {
      const { data } = await api('post', '/terc/importar/remessas', {
        rows: parsed,
        dry_run: $('#imp-dry').checked,
        criar_cadastros: $('#imp-cad').checked,
      });
      $('#imp-result').innerHTML = `
        <div class="card p-5">
          <h4 class="text-lg font-semibold mb-3">${data.dry_run ? '🧪 Simulação (dry-run)' : '✅ Importação concluída'}</h4>
          <div class="grid grid-cols-4 gap-3 mb-4">
            <div class="bg-slate-50 p-3 rounded"><div class="text-xs text-slate-500">Total</div><div class="text-2xl font-bold">${data.total}</div></div>
            <div class="bg-green-50 p-3 rounded"><div class="text-xs text-slate-500">Inseridas</div><div class="text-2xl font-bold text-green-600">${data.inseridas}</div></div>
            <div class="bg-red-50 p-3 rounded"><div class="text-xs text-slate-500">Ignoradas</div><div class="text-2xl font-bold text-red-500">${data.ignoradas}</div></div>
            <div class="bg-blue-50 p-3 rounded"><div class="text-xs text-slate-500">Cadastros criados</div><div class="text-2xl font-bold text-blue-600">${data.cadastros_criados}</div></div>
          </div>
          ${data.erros?.length ? `
            <details class="mt-3"><summary class="cursor-pointer text-sm text-slate-600">Ver ${data.erros.length} erro(s)</summary>
              <div class="bg-red-50 p-3 rounded mt-2 text-xs max-h-64 overflow-auto">
                ${data.erros.map(e => `<div>Linha ${e.linha}: ${e.erro}</div>`).join('')}
              </div>
            </details>` : ''}
        </div>`;
    } catch (e) {}
  };
};

// Mapeia linhas da aba "Remessa" original
function mapImportRows(header, rows) {
  const idx = {};
  header.forEach((h, i) => {
    const k = String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (/nº ?con.*trole|n. con.*trole/.test(k)) idx.num_controle = i;
    else if (/n.*op/.test(k) && !idx.num_op) idx.num_op = i;
    else if (/nome.*terceir/.test(k)) idx.nome_terc = i;
    else if (/^setor$/.test(k)) idx.setor = i;
    else if (/^ref\.?$/.test(k)) idx.cod_ref = i;
    else if (/descri.*refer/.test(k)) idx.desc_ref = i;
    else if (/descri.*servi|desc.*servi/.test(k)) idx.desc_servico = i;
    else if (/^cor$/.test(k)) idx.cor = i;
    else if (/^1 ?2 ?3 ?4$/.test(k) || /^grade$/.test(k)) idx.grade = i;
    else if (/^qtde? ?total$/.test(k)) idx.qtd_total = i;
    else if (/^pre.o$/.test(k)) idx.preco_unit = i;
    else if (/valor.*total/.test(k)) idx.valor_total = i;
    else if (/^cole.ão$/.test(k)) idx.colecao = i;
    else if (/data.*sa.da/.test(k)) idx.dt_saida = i;
    else if (/data.*in.cio/.test(k)) idx.dt_inicio = i;
    else if (/previs.*retorno/.test(k)) idx.dt_previsao = i;
    else if (/tempo.*pe.a|tempo.*min/.test(k)) idx.tempo_peca = i;
    else if (/efici.ncia/.test(k)) idx.efic_pct = i;
    else if (/qtde? ?pessoas/.test(k)) idx.qtd_pessoas = i;
    else if (/min.*trab/.test(k)) idx.min_trab_dia = i;
    else if (/prazo.*dias|n. de dias/.test(k)) idx.prazo_dias = i;
    else if (/observ/.test(k)) idx.observacao = i;
  });

  // Colunas de tamanhos (J=10 em diante, 10 colunas)
  const tamCols = ['P','M','G','GG','EG','SG','T7','T8','T9','T10'];
  const tamStart = idx.grade !== undefined ? idx.grade + 1 : 10; // após 'grade' (col J)

  return rows.map(r => {
    const o = {};
    Object.keys(idx).forEach(k => o[k] = r[idx[k]]);
    tamCols.forEach((t, i) => {
      const v = r[tamStart + i];
      if (v && Number(v) > 0) o[`tam_${t}`] = Number(v);
    });
    // Normaliza data
    if (o.dt_saida) {
      if (o.dt_saida instanceof Date) o.dt_saida = o.dt_saida.toISOString().slice(0, 10);
      else if (typeof o.dt_saida === 'number') { const d = new Date(Math.round((o.dt_saida - 25569) * 86400000)); o.dt_saida = d.toISOString().slice(0, 10); }
      else o.dt_saida = String(o.dt_saida).slice(0, 10);
    }
    return o;
  }).filter(o => o.nome_terc && o.cod_ref);
}
