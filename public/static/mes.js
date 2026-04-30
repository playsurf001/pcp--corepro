/* ============================================================
 * MES — Manufacturing Execution System (Frontend)
 * Telas: Setores, Colaboradores, Apontamento Pro (Timer),
 * Dashboard MES Pro, Bonificação, Rastreabilidade, Alertas
 * ============================================================ */

(function () {
  'use strict';

  /* ============================================================
   * SETORES (CRUD simples)
   * ============================================================ */
  ROUTES.setores = async (main) => {
    const rs = await api('get', '/setores');
    const data = rs.data || [];
    main.innerHTML = `
      ${UI.pageHeader({
        breadcrumb: [{ label: 'Início', href: '#dashboard' }, { label: 'Chão de Fábrica' }, { label: 'Setores' }],
        title: 'Setores Produtivos',
        badge: 'MES',
        desc: 'Cadastre os setores (Corte, Costura, Acabamento, etc.) usados nos cards do dashboard e no perfil dos colaboradores.',
        actions: `<button class="btn btn-primary" id="btn-new-setor"><i class="fas fa-plus mr-2"></i>Novo setor</button>`,
      })}
      <div class="card overflow-hidden">
        <table class="w-full text-sm table-sticky">
          <thead class="bg-slate-100"><tr>
            <th class="px-3 py-2 text-left">Cor</th>
            <th class="px-3 py-2 text-left">Código</th>
            <th class="px-3 py-2 text-left">Descrição</th>
            <th class="px-3 py-2 text-center">Ativo</th>
            <th class="px-3 py-2 text-center w-32">Ações</th>
          </tr></thead>
          <tbody>${data.map(s => `
            <tr class="border-t">
              <td class="px-3 py-2"><span style="display:inline-block;width:24px;height:24px;border-radius:6px;background:${s.cor};border:1px solid var(--border)"></span></td>
              <td class="px-3 py-2 font-mono">${s.cod_setor}</td>
              <td class="px-3 py-2 font-semibold">${s.desc_setor}</td>
              <td class="px-3 py-2 text-center">${s.ativo ? '<i class="fas fa-check-circle" style="color:#10B981"></i>' : '<i class="fas fa-times-circle" style="color:#94A3B8"></i>'}</td>
              <td class="px-3 py-2 text-center">
                <button class="btn-icon" data-edit="${s.id_setor}" title="Editar" style="width:32px;height:32px"><i class="fas fa-edit"></i></button>
                <button class="btn-icon" data-del="${s.id_setor}" title="Excluir" style="width:32px;height:32px;color:#EF4444"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
        ${!data.length ? UI.empty({ icon:'fa-sitemap', title:'Nenhum setor', desc:'Crie o primeiro setor para começar a organizar o chão de fábrica.' }) : ''}
      </div>`;

    $('#btn-new-setor').onclick = () => openSetorEditor(null);
    $$('[data-edit]').forEach(b => b.onclick = () => openSetorEditor(data.find(x => x.id_setor === parseInt(b.dataset.edit))));
    $$('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Excluir este setor?')) return;
      await api('delete', `/setores/${b.dataset.del}`);
      ROUTES.setores(main);
    });
  };

  function openSetorEditor(s) {
    const isNew = !s;
    Modal.open({
      title: isNew ? 'Novo Setor' : 'Editar Setor',
      size: 'sm',
      body: `
        <div class="space-y-3">
          <div><label>Código *</label><input id="se-cod" value="${s?.cod_setor || ''}" placeholder="COSTURA" required/></div>
          <div><label>Descrição *</label><input id="se-desc" value="${s?.desc_setor || ''}" required/></div>
          <div><label>Cor</label><input type="color" id="se-cor" value="${s?.cor || '#2563EB'}" style="height:42px"/></div>
          <div class="flex items-center gap-2"><input type="checkbox" id="se-ativo" ${s?.ativo !== 0 ? 'checked' : ''}/> <label for="se-ativo" style="margin:0">Ativo</label></div>
        </div>`,
      onSave: async () => {
        const body = {
          cod_setor: $('#se-cod').value.trim(),
          desc_setor: $('#se-desc').value.trim(),
          cor: $('#se-cor').value,
          ativo: $('#se-ativo').checked ? 1 : 0,
        };
        if (!body.cod_setor || !body.desc_setor) { toast.error('Preencha código e descrição.'); return false; }
        if (isNew) await api('post', '/setores', body);
        else await api('put', `/setores/${s.id_setor}`, body);
        toast.success('Setor salvo.');
        ROUTES.setores($('#main-content'));
        return true;
      }
    });
  }

  /* ============================================================
   * COLABORADORES (CRUD + perfil de produção)
   * ============================================================ */
  ROUTES.colaboradores = async (main) => {
    const [rsC, rsS] = await Promise.all([
      api('get', '/colaboradores'),
      api('get', '/setores'),
    ]);
    const data = rsC.data || [];
    const setores = rsS.data || [];

    main.innerHTML = `
      ${UI.pageHeader({
        breadcrumb: [{ label: 'Início', href: '#dashboard' }, { label: 'Chão de Fábrica' }, { label: 'Colaboradores' }],
        title: 'Colaboradores',
        badge: 'MES',
        desc: 'Cadastro completo com função, setor, meta diária, eficiência alvo, custo/min e bônus base.',
        actions: `<button class="btn btn-primary" id="btn-new-col"><i class="fas fa-plus mr-2"></i>Novo colaborador</button>`,
      })}

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        ${UI.kpi({ label:'Total', value: data.length, icon:'fa-users', accent:'blue', sub:'cadastrados' })}
        ${UI.kpi({ label:'Ativos', value: data.filter(x=>x.ativo).length, icon:'fa-user-check', accent:'green', sub:'em operação' })}
        ${UI.kpi({ label:'Setores', value: setores.filter(s=>s.ativo).length, icon:'fa-sitemap', accent:'indigo', sub:'produtivos' })}
        ${UI.kpi({ label:'Meta média', value: data.length ? fmt.int(data.reduce((s,c)=>s+(Number(c.meta_diaria)||0),0)/data.length) : 0, icon:'fa-bullseye', accent:'amber', sub:'peças/dia' })}
      </div>

      <div class="card p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div><label>Buscar</label><input id="cf-q" placeholder="Nome / matrícula / função"/></div>
        <div><label>Setor</label><select id="cf-setor"><option value="">Todos</option>${setores.map(s=>`<option value="${s.id_setor}">${s.desc_setor}</option>`).join('')}</select></div>
        <div><label>Status</label><select id="cf-st"><option value="">Todos</option><option value="1">Ativos</option><option value="0">Inativos</option></select></div>
      </div>

      <div class="card overflow-auto">
        <table class="w-full text-sm table-sticky">
          <thead class="bg-slate-100"><tr>
            <th class="px-3 py-2 text-left">Matrícula</th>
            <th class="px-3 py-2 text-left">Nome</th>
            <th class="px-3 py-2 text-left">Função</th>
            <th class="px-3 py-2 text-left">Setor</th>
            <th class="px-3 py-2 text-right">Meta diária</th>
            <th class="px-3 py-2 text-right">Meta efic.</th>
            <th class="px-3 py-2 text-right">R$/min</th>
            <th class="px-3 py-2 text-center">Status</th>
            <th class="px-3 py-2 text-center w-28">Ações</th>
          </tr></thead>
          <tbody id="cb"></tbody>
        </table>
      </div>`;

    const draw = () => {
      const q = ($('#cf-q').value || '').toLowerCase();
      const st = $('#cf-st').value;
      const sId = $('#cf-setor').value;
      const filtered = data.filter(c => {
        if (q && !((c.nome||'')+' '+(c.matricula||'')+' '+(c.funcao||'')).toLowerCase().includes(q)) return false;
        if (st !== '' && String(c.ativo) !== st) return false;
        if (sId && String(c.id_setor||'') !== sId) return false;
        return true;
      });
      const tb = $('#cb');
      if (!filtered.length) {
        tb.innerHTML = `<tr><td colspan="9" class="p-0">${UI.empty({icon:'fa-id-badge',title:'Nenhum colaborador',desc:'Cadastre o primeiro colaborador para alimentar o chão de fábrica.'})}</td></tr>`;
        return;
      }
      tb.innerHTML = filtered.map(c => `
        <tr class="border-t">
          <td class="px-3 py-2 font-mono">${c.matricula}</td>
          <td class="px-3 py-2"><b>${c.nome}</b></td>
          <td class="px-3 py-2">${c.funcao || '—'}</td>
          <td class="px-3 py-2">${c.desc_setor ? `<span class="badge" style="background:${c.setor_cor}22;color:${c.setor_cor};font-weight:600">${c.desc_setor}</span>` : '—'}</td>
          <td class="px-3 py-2 text-right">${fmt.int(c.meta_diaria)}</td>
          <td class="px-3 py-2 text-right">${fmt.pct(c.meta_eficiencia)}</td>
          <td class="px-3 py-2 text-right">${fmt.num(c.custo_minuto, 2)}</td>
          <td class="px-3 py-2 text-center">${c.ativo ? '<span class="badge badge-Concluida">Ativo</span>' : '<span class="badge badge-Cancelada">Inativo</span>'}</td>
          <td class="px-3 py-2 text-center whitespace-nowrap">
            <button class="btn-icon" data-perfil="${c.id_colab}" title="Perfil" style="width:32px;height:32px"><i class="fas fa-chart-pie"></i></button>
            <button class="btn-icon" data-edit="${c.id_colab}" title="Editar" style="width:32px;height:32px"><i class="fas fa-edit"></i></button>
            <button class="btn-icon" data-del="${c.id_colab}" title="Inativar" style="width:32px;height:32px;color:#EF4444"><i class="fas fa-user-slash"></i></button>
          </td>
        </tr>`).join('');

      $$('[data-edit]').forEach(b => b.onclick = () => openColabEditor(data.find(x => x.id_colab === parseInt(b.dataset.edit)), setores));
      $$('[data-perfil]').forEach(b => b.onclick = () => openColabPerfil(parseInt(b.dataset.perfil)));
      $$('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm('Inativar este colaborador? (mantém histórico)')) return;
        await api('delete', `/colaboradores/${b.dataset.del}`);
        ROUTES.colaboradores(main);
      });
    };

    $('#btn-new-col').onclick = () => openColabEditor(null, setores);
    $('#cf-q').oninput = debounce(draw, 200);
    $('#cf-setor').onchange = draw;
    $('#cf-st').onchange = draw;
    draw();
  };

  function openColabEditor(c, setores) {
    const isNew = !c;
    Modal.open({
      title: isNew ? 'Novo Colaborador' : 'Editar Colaborador',
      size: 'md',
      body: `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><label>Matrícula *</label><input id="co-mat" value="${c?.matricula || ''}" required/></div>
          <div><label>Nome *</label><input id="co-nome" value="${c?.nome || ''}" required/></div>
          <div><label>Função</label><input id="co-func" value="${c?.funcao || ''}" placeholder="Costureira, Cortador..."/></div>
          <div><label>Setor</label><select id="co-setor"><option value="">—</option>${setores.map(s=>`<option value="${s.id_setor}" ${c?.id_setor===s.id_setor?'selected':''}>${s.desc_setor}</option>`).join('')}</select></div>
          <div><label>Meta diária (peças)</label><input type="number" id="co-meta" min="0" value="${c?.meta_diaria || 0}"/></div>
          <div><label>Meta eficiência (0-1)</label><input type="number" id="co-eff" min="0" max="1" step="0.01" value="${c?.meta_eficiencia ?? 0.85}"/></div>
          <div><label>Custo R$/min</label><input type="number" id="co-cm" min="0" step="0.01" value="${c?.custo_minuto || 0}"/></div>
          <div><label>Bônus base (R$)</label><input type="number" id="co-bb" min="0" step="0.01" value="${c?.bonus_base || 0}"/></div>
          <div><label>Data admissão</label><input type="date" id="co-dt" value="${c?.dt_admissao || ''}"/></div>
          <div class="flex items-end"><label class="flex items-center gap-2 m-0"><input type="checkbox" id="co-ativo" ${c?.ativo !== 0 ? 'checked' : ''}/> Ativo</label></div>
        </div>`,
      onSave: async () => {
        const body = {
          matricula: $('#co-mat').value.trim(),
          nome: $('#co-nome').value.trim(),
          funcao: $('#co-func').value.trim() || null,
          id_setor: $('#co-setor').value || null,
          meta_diaria: parseInt($('#co-meta').value) || 0,
          meta_eficiencia: parseFloat($('#co-eff').value) || 0.85,
          custo_minuto: parseFloat($('#co-cm').value) || 0,
          bonus_base: parseFloat($('#co-bb').value) || 0,
          dt_admissao: $('#co-dt').value || null,
          ativo: $('#co-ativo').checked ? 1 : 0,
        };
        if (!body.matricula || !body.nome) { toast.error('Matrícula e nome são obrigatórios.'); return false; }
        if (isNew) await api('post', '/colaboradores', body);
        else      await api('put', `/colaboradores/${c.id_colab}`, body);
        toast.success('Colaborador salvo.');
        ROUTES.colaboradores($('#main-content'));
        return true;
      }
    });
  }

  async function openColabPerfil(id) {
    const r = await api('get', `/colaboradores/${id}`);
    const d = r.data;
    const c = d.colaborador;
    const m = d.mes_atual || {};
    const hist = d.historico || [];

    Modal.open({
      title: `Perfil — ${c.nome}`,
      size: 'lg',
      hideSave: true,
      cancelText: 'Fechar',
      body: `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          ${UI.kpi({ label:'Peças (mês)', value: fmt.int(m.pecas), icon:'fa-cubes', accent:'blue' })}
          ${UI.kpi({ label:'Refugo (mês)', value: fmt.int(m.refugo), icon:'fa-recycle', accent:'rose' })}
          ${UI.kpi({ label:'Eficiência', value: fmt.pct(m.efic), icon:'fa-gauge-high', accent:'purple', progress: Math.min(100, (m.efic||0)*100) })}
          ${UI.kpi({ label:'Meta diária', value: fmt.int(c.meta_diaria), icon:'fa-bullseye', accent:'amber', sub:'peças/dia' })}
        </div>
        <div class="card p-4">
          <div class="font-semibold mb-3" style="color:var(--text-primary)"><i class="fas fa-history mr-2"></i>Histórico (30 dias)</div>
          ${hist.length ? `
          <div style="max-height:280px;overflow-y:auto">
            <table class="w-full text-sm">
              <thead class="bg-slate-100"><tr>
                <th class="p-2 text-left">Dia</th>
                <th class="p-2 text-right">Peças</th>
                <th class="p-2 text-right">Refugo</th>
                <th class="p-2 text-right">Horas</th>
                <th class="p-2 text-right">Efic.</th>
              </tr></thead>
              <tbody>${hist.map(h => `<tr class="border-t">
                <td class="p-2">${fmt.date(h.dia)}</td>
                <td class="p-2 text-right font-semibold">${fmt.int(h.pecas)}</td>
                <td class="p-2 text-right" style="color:${h.refugo>0?'#EF4444':'inherit'}">${fmt.int(h.refugo)}</td>
                <td class="p-2 text-right">${fmt.num(h.horas, 1)}</td>
                <td class="p-2 text-right font-semibold" style="color:${h.efic>=0.85?'#10B981':h.efic>=0.7?'#F59E0B':'#EF4444'}">${fmt.pct(h.efic)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
          ` : `<div style="text-align:center;color:var(--text-secondary);padding:30px 0">Sem produção registrada nos últimos 30 dias.</div>`}
        </div>`,
    });
  }

  /* ============================================================
   * APONTAMENTO PRO — Timer real (start/pause/resume/finish)
   * ============================================================ */
  let APONT_TIMER_INTERVAL = null;

  ROUTES.apontamento_pro = async (main) => {
    await renderApontamentoPro(main);
  };

  async function renderApontamentoPro(main) {
    const [rsAtivas, rsOps, rsCol, rsDef] = await Promise.all([
      api('get', '/sessoes/ativas'),
      api('get', '/ops'),
      api('get', '/colaboradores?ativo=1'),
      api('get', '/defeitos/tipos'),
    ]);
    const ativas = rsAtivas.data || [];
    const ops    = (rsOps.data || []).filter(o => o.status !== 'Concluida' && o.status !== 'Cancelada');
    const colabs = rsCol.data || [];
    const defeitos = rsDef.data || [];

    // Cache para sequências por OP
    window.__seqCache = window.__seqCache || {};

    main.innerHTML = `
      ${UI.pageHeader({
        breadcrumb: [{ label: 'Início', href: '#dashboard' }, { label: 'Chão de Fábrica' }, { label: 'Apontamento Pro' }],
        title: 'Apontamento com Cronômetro',
        badge: 'MES',
        live: true,
        desc: 'Inicie, pause e finalize operações em tempo real. Eficiência calculada automaticamente.',
        actions: `<button class="btn-icon" id="btn-refresh-pro" title="Atualizar"><i class="fas fa-sync-alt"></i></button>
                  <button class="btn btn-primary" id="btn-new-sessao"><i class="fas fa-play mr-2"></i>Iniciar operação</button>`,
      })}

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        ${UI.kpi({ label:'Em andamento', value: ativas.filter(s=>s.status==='EmAndamento').length, icon:'fa-play-circle', accent:'blue', sub:'operadores ativos' })}
        ${UI.kpi({ label:'Pausadas', value: ativas.filter(s=>s.status==='Pausada').length, icon:'fa-pause-circle', accent:'amber', sub:'aguardando' })}
        ${UI.kpi({ label:'Colaboradores ativos', value: colabs.length, icon:'fa-users', accent:'indigo' })}
        ${UI.kpi({ label:'OPs em produção', value: ops.length, icon:'fa-clipboard-list', accent:'green' })}
      </div>

      <div class="card p-5 mb-4">
        ${UI.section({ title: 'Operações em execução agora', icon: 'fa-stopwatch', meta: `${ativas.length} sessão(ões)` })}
        <div id="grid-sessoes" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"></div>
      </div>

      <div class="card p-5">
        ${UI.section({ title: 'Histórico recente', icon: 'fa-clock-rotate-left' })}
        <div id="hist-sessoes"></div>
      </div>
    `;

    drawSessoesAtivas(ativas, defeitos);
    drawHistorico();

    $('#btn-refresh-pro').onclick = () => renderApontamentoPro(main);
    $('#btn-new-sessao').onclick  = () => openStartSessao(ops, colabs, () => renderApontamentoPro(main));

    // Timer global (atualiza tempos a cada 1s)
    if (APONT_TIMER_INTERVAL) clearInterval(APONT_TIMER_INTERVAL);
    APONT_TIMER_INTERVAL = setInterval(updateTimers, 1000);

    UI.liveTick(main, Date.now());
  }

  function drawSessoesAtivas(ativas, defeitos) {
    const container = $('#grid-sessoes');
    if (!ativas.length) {
      container.outerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" id="grid-sessoes">${
        UI.empty({ icon:'fa-stopwatch', title:'Nenhuma operação em execução', desc:'Clique em "Iniciar operação" para registrar o início de uma operação.' })
      }</div>`;
      return;
    }
    container.innerHTML = ativas.map(s => sessaoCardHTML(s)).join('');

    $$('[data-pause]').forEach(b => b.onclick = async () => {
      try { await api('post', `/sessoes/${b.dataset.pause}/pause`); toast.success('Pausada.'); renderApontamentoPro($('#main-content')); }
      catch(e) { toast.error('Falha ao pausar.'); }
    });
    $$('[data-resume]').forEach(b => b.onclick = async () => {
      try { await api('post', `/sessoes/${b.dataset.resume}/resume`); toast.success('Retomada.'); renderApontamentoPro($('#main-content')); }
      catch(e) { toast.error('Falha ao retomar.'); }
    });
    $$('[data-finish]').forEach(b => b.onclick = () => {
      const s = ativas.find(x => x.id_sessao === parseInt(b.dataset.finish));
      openFinishSessao(s, defeitos, () => renderApontamentoPro($('#main-content')));
    });
    $$('[data-cancel-s]').forEach(b => b.onclick = async () => {
      if (!confirm('Cancelar esta sessão? (não conta na produção)')) return;
      await api('post', `/sessoes/${b.dataset.cancelS}/cancel`);
      toast.success('Cancelada.');
      renderApontamentoPro($('#main-content'));
    });
  }

  function sessaoCardHTML(s) {
    const isPaused = s.status === 'Pausada';
    const setorCor = s.setor_cor || '#2563EB';
    return `
      <div class="card p-4 sessao-card ${isPaused ? 'is-paused' : ''}" data-sessao="${s.id_sessao}" data-inicio="${s.dt_inicio}" data-pausa-ini="${s.dt_pausa || ''}" data-pausa-acum="${s.segundos_pausa || 0}" style="border-left:4px solid ${setorCor};position:relative">
        <div class="flex items-start justify-between mb-2">
          <div style="min-width:0">
            <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em">${s.desc_setor || 'Sem setor'}</div>
            <div style="font-weight:700;color:var(--text-primary);font-size:15px;margin-top:2px"><i class="fas fa-user mr-1"></i>${s.operador_nome}</div>
          </div>
          ${isPaused
            ? '<span class="badge" style="background:#FEF3C7;color:#92400E;font-weight:600"><i class="fas fa-pause mr-1"></i>Pausada</span>'
            : '<span class="badge" style="background:#DBEAFE;color:#1E40AF;font-weight:600"><span class="live-dot" style="background:#10B981;box-shadow:0 0 6px #10B981"></span>Ativa</span>'
          }
        </div>
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px">
          <i class="fas fa-clipboard-list mr-1"></i><b style="color:var(--text-primary)">OP ${s.num_op}</b> — ${s.cod_ref}
          <div style="margin-top:2px"><i class="fas fa-cog mr-1"></i>Seq ${s.sequencia}: ${s.desc_op}</div>
          <div style="margin-top:2px;font-size:11px"><i class="fas fa-user-tie mr-1"></i>${s.nome_cliente}</div>
        </div>
        <div class="timer-display" style="font-family:'Courier New',monospace;font-size:28px;font-weight:700;color:${isPaused ? '#F59E0B' : '#2563EB'};text-align:center;padding:10px 0;background:rgba(37,99,235,0.06);border-radius:8px;margin-bottom:10px" id="timer-${s.id_sessao}">00:00:00</div>
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:10px;text-align:center">
          Tempo padrão: <b>${fmt.num(s.tempo_padrao, 2)} min/peça</b>
        </div>
        <div class="flex gap-2">
          ${isPaused
            ? `<button class="btn btn-primary flex-1" data-resume="${s.id_sessao}" style="font-size:12px"><i class="fas fa-play mr-1"></i>Retomar</button>`
            : `<button class="btn btn-secondary flex-1" data-pause="${s.id_sessao}" style="font-size:12px;background:#FEF3C7;color:#92400E;border-color:#FBBF24"><i class="fas fa-pause mr-1"></i>Pausar</button>`
          }
          <button class="btn btn-primary flex-1" data-finish="${s.id_sessao}" style="font-size:12px;background:linear-gradient(135deg,#10B981,#059669)"><i class="fas fa-check mr-1"></i>Finalizar</button>
          <button class="btn-icon" data-cancel-s="${s.id_sessao}" title="Cancelar" style="width:38px;height:38px;color:#EF4444"><i class="fas fa-times"></i></button>
        </div>
      </div>`;
  }

  function updateTimers() {
    document.querySelectorAll('.sessao-card').forEach(card => {
      const inicio = card.dataset.inicio;
      const pausaIni = card.dataset.pausaIni;
      const pausaAcum = parseInt(card.dataset.pausaAcum) || 0;
      const isPaused = card.classList.contains('is-paused');
      if (!inicio) return;

      // Server retorna tempo em UTC, navegador trabalha local — ajusta para evitar offset
      const startMs = new Date(inicio.replace(' ', 'T') + 'Z').getTime();
      let pausedMs = pausaAcum * 1000;
      if (isPaused && pausaIni) {
        pausedMs += Date.now() - new Date(pausaIni.replace(' ', 'T') + 'Z').getTime();
      }
      const elapsed = Math.max(0, Math.floor((Date.now() - startMs - pausedMs) / 1000));
      const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const ss = String(elapsed % 60).padStart(2, '0');
      const id = card.dataset.sessao;
      const el = document.getElementById('timer-' + id);
      if (el) el.textContent = `${hh}:${mm}:${ss}`;
    });
  }

  async function drawHistorico() {
    try {
      const rs = await api('get', '/sessoes?status=Finalizada', null, { silent: true });
      const items = (rs.data || []).slice(0, 30);
      const c = $('#hist-sessoes');
      if (!c) return;
      if (!items.length) { c.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:20px">Nenhuma sessão finalizada ainda.</div>`; return; }
      c.innerHTML = `
        <div style="overflow-x:auto"><table class="w-full text-sm">
          <thead class="bg-slate-100"><tr>
            <th class="p-2 text-left">Início</th>
            <th class="p-2 text-left">OP</th>
            <th class="p-2 text-left">Operação</th>
            <th class="p-2 text-left">Operador</th>
            <th class="p-2 text-right">Boa</th>
            <th class="p-2 text-right">Refugo</th>
            <th class="p-2 text-right">Retrab.</th>
            <th class="p-2 text-right">Efic.</th>
          </tr></thead>
          <tbody>${items.map(s => `
            <tr class="border-t">
              <td class="p-2">${fmt.datetime(s.dt_inicio)}</td>
              <td class="p-2 font-mono">${s.num_op}</td>
              <td class="p-2">Seq ${s.sequencia} — ${s.desc_op}</td>
              <td class="p-2">${s.colab_nome || s.operador_nome}</td>
              <td class="p-2 text-right font-semibold">${fmt.int(s.qtd_boa)}</td>
              <td class="p-2 text-right" style="color:${s.qtd_refugo>0?'#EF4444':'inherit'}">${fmt.int(s.qtd_refugo)}</td>
              <td class="p-2 text-right" style="color:${s.qtd_retrabalho>0?'#F59E0B':'inherit'}">${fmt.int(s.qtd_retrabalho)}</td>
              <td class="p-2 text-right font-semibold" style="color:${s.efic_real>=0.85?'#10B981':s.efic_real>=0.7?'#F59E0B':'#EF4444'}">${fmt.pct(s.efic_real)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`;
    } catch(e) { /* silent */ }
  }

  function openStartSessao(ops, colabs, onDone) {
    Modal.open({
      title: 'Iniciar Operação',
      size: 'md',
      saveText: 'Iniciar',
      body: `
        <div class="space-y-3">
          <div><label>OP *</label><select id="ss-op" required>
            <option value="">--</option>
            ${ops.map(o => `<option value="${o.id_op}" data-seq="${o.id_seq_cab}">${o.num_op} — ${o.cod_ref} (${o.nome_cliente})</option>`).join('')}
          </select></div>
          <div><label>Operação (sequência) *</label><select id="ss-seq" required disabled><option value="">Selecione uma OP</option></select></div>
          <div><label>Colaborador *</label><select id="ss-colab" required>
            <option value="">--</option>
            ${colabs.map(c => `<option value="${c.id_colab}">${c.matricula} — ${c.nome}${c.desc_setor ? ' ('+c.desc_setor+')' : ''}</option>`).join('')}
          </select></div>
          <div class="alert-card success" style="margin-top:10px">
            <div class="ac-icon"><i class="fas fa-info-circle"></i></div>
            <div style="flex:1">
              <div class="ac-title">Cronômetro será iniciado</div>
              <div class="ac-desc">A OP será marcada como "Em Produção" e o tempo começará a contar agora.</div>
            </div>
          </div>
        </div>`,
      onOpen: () => {
        $('#ss-op').onchange = async (e) => {
          const id = parseInt(e.target.value);
          const sel = $('#ss-seq');
          if (!id) { sel.innerHTML = '<option value="">Selecione uma OP</option>'; sel.disabled = true; return; }
          sel.disabled = false; sel.innerHTML = '<option>Carregando...</option>';
          try {
            // 1) busca OP para descobrir id_seq_cab
            const rsOp = await api('get', `/ops/${id}`, null, { silent: true });
            const idSeqCab = rsOp.data?.id_seq_cab || rsOp.data?.op?.id_seq_cab;
            if (!idSeqCab) { sel.innerHTML = '<option value="">OP sem sequência ativa</option>'; return; }
            // 2) busca itens da sequência via endpoint correto
            const rsSeq = await api('get', `/sequencias/${idSeqCab}`, null, { silent: true });
            const lista = rsSeq.data?.itens || [];
            if (!lista.length) { sel.innerHTML = '<option value="">Sequência vazia</option>'; return; }
            sel.innerHTML = '<option value="">--</option>' + lista.map(it =>
              `<option value="${it.id_seq_item}">Seq ${it.sequencia} — ${it.cod_op || ''} ${it.desc_op || ''} (${fmt.num(it.tempo_padrao,2)} min)</option>`
            ).join('');
          } catch (err) {
            sel.innerHTML = '<option value="">Erro ao carregar sequência</option>';
          }
        };
      },
      onSave: async () => {
        const id_op = parseInt($('#ss-op').value);
        const id_seq_item = parseInt($('#ss-seq').value);
        const id_colab = parseInt($('#ss-colab').value);
        if (!id_op || !id_seq_item || !id_colab) { toast.error('Preencha todos os campos.'); return false; }
        try {
          await api('post', '/sessoes/start', { id_op, id_seq_item, id_colab });
          toast.success('Operação iniciada — cronômetro rodando.');
          if (onDone) onDone();
          return true;
        } catch (e) {
          toast.error(e.message || 'Falha ao iniciar.');
          return false;
        }
      }
    });
  }

  function openFinishSessao(s, defeitos, onDone) {
    Modal.open({
      title: `Finalizar Operação — ${s.operador_nome}`,
      size: 'md',
      saveText: 'Finalizar',
      body: `
        <div class="space-y-3">
          <div class="alert-card" style="background:rgba(37,99,235,0.06);border-color:#2563EB;border-left:4px solid #2563EB">
            <div class="ac-icon" style="background:rgba(37,99,235,0.12);color:#2563EB"><i class="fas fa-clipboard-list"></i></div>
            <div style="flex:1">
              <div class="ac-title">OP ${s.num_op} — Seq ${s.sequencia}</div>
              <div class="ac-desc">${s.desc_op} · Tempo padrão ${fmt.num(s.tempo_padrao,2)} min/peça</div>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div><label>Peças boas *</label><input type="number" id="fs-boa" min="0" value="0" required/></div>
            <div><label>Refugo</label><input type="number" id="fs-ref" min="0" value="0"/></div>
            <div><label>Retrabalho</label><input type="number" id="fs-ret" min="0" value="0"/></div>
          </div>
          <div>
            <label>Defeitos detalhados (opcional)</label>
            <div id="fs-defs" style="background:var(--bg-secondary,#F8FAFC);border:1px solid var(--border);border-radius:8px;padding:10px;max-height:160px;overflow-y:auto">
              ${defeitos.map(d => `
                <div class="flex items-center gap-2 mb-2">
                  <span style="flex:1;font-size:12px"><span class="badge" style="background:${d.gravidade==='alta'?'#FEE2E2':d.gravidade==='media'?'#FEF3C7':'#DBEAFE'};color:${d.gravidade==='alta'?'#991B1B':d.gravidade==='media'?'#92400E':'#1E40AF'};font-size:10px">${d.gravidade}</span> ${d.descricao}</span>
                  <input type="number" min="0" data-defeito="${d.id_defeito}" placeholder="0" style="width:70px;font-size:12px;padding:4px 8px"/>
                </div>`).join('')}
            </div>
          </div>
          <div><label>Observações</label><textarea id="fs-obs" rows="2"></textarea></div>
        </div>`,
      onSave: async () => {
        const qtd_boa = parseInt($('#fs-boa').value) || 0;
        const qtd_refugo = parseInt($('#fs-ref').value) || 0;
        const qtd_retrabalho = parseInt($('#fs-ret').value) || 0;
        const obs = $('#fs-obs').value.trim() || null;
        const defs = [];
        document.querySelectorAll('[data-defeito]').forEach(inp => {
          const q = parseInt(inp.value) || 0;
          if (q > 0) defs.push({ id_defeito: parseInt(inp.dataset.defeito), qtde: q });
        });
        try {
          await api('post', `/sessoes/${s.id_sessao}/finish`, { qtd_boa, qtd_refugo, qtd_retrabalho, obs, defeitos: defs });
          toast.success(`Sessão finalizada (${qtd_boa} peças).`);
          if (onDone) onDone();
          return true;
        } catch (e) {
          toast.error(e.message || 'Falha ao finalizar.');
          return false;
        }
      }
    });
  }

  /* ============================================================
   * DASHBOARD MES PRO — gráficos, ranking, eficiência por setor
   * ============================================================ */
  ROUTES.mes_dashboard = async (main) => {
    const [rsPro, rsAlertas, rsDef] = await Promise.all([
      api('get', '/dashboard/mes-pro'),
      api('get', '/alertas'),
      api('get', '/defeitos/analise', null, { silent: true }).catch(() => ({ data: { por_tipo: [], por_operacao: [] } })),
    ]);
    const d = rsPro.data;
    const alertas = rsAlertas.data?.alertas || [];
    const def = rsDef.data || { por_tipo: [], por_operacao: [] };
    const eg = d.eficiencia_geral || {};
    const sa = d.sessoes_ativas || {};

    main.innerHTML = `
      ${UI.pageHeader({
        breadcrumb: [{ label: 'Início', href: '#dashboard' }, { label: 'Gestão' }, { label: 'MES — Tempo Real' }],
        title: 'Dashboard MES — Tempo Real',
        badge: 'PRO',
        live: true,
        desc: 'Visão gerencial completa: produção diária, eficiência por setor, ranking de colaboradores e análise de defeitos.',
        actions: `<button class="btn-icon" id="btn-refresh-mes" title="Atualizar"><i class="fas fa-sync-alt"></i></button>`,
      })}

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        ${UI.kpi({ label:'Em operação agora', value: sa.rodando || 0, icon:'fa-play-circle', accent:'green', sub:`${sa.pausadas || 0} pausadas` })}
        ${UI.kpi({ label:'Eficiência geral (14d)', value: fmt.pct(eg.media), icon:'fa-gauge-high', accent:'purple', progress: Math.min(100, (eg.media||0)*100), trend:{ dir: (eg.media||0)>=0.85?'up':(eg.media||0)>=0.7?'flat':'down', text:(eg.media||0)>=0.85?'Ótimo':(eg.media||0)>=0.7?'OK':'Baixo'} })}
        ${UI.kpi({ label:'Setores produtivos', value: (d.eficiencia_setor||[]).length, icon:'fa-sitemap', accent:'blue' })}
        ${UI.kpi({ label:'Alertas críticos', value: alertas.length, icon:'fa-bell', accent: alertas.length>0?'amber':'green', sub: alertas.length>0?'requerem atenção':'tudo ok' })}
      </div>

      ${alertas.length ? `
      <div class="card p-5 mb-4">
        ${UI.section({ title:'Alertas críticos', icon:'fa-bell', meta:`${alertas.length}` })}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${alertas.map(a => UI.alert(a)).join('')}
        </div>
      </div>` : ''}

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div class="card p-5 lg:col-span-2">
          ${UI.section({ title:'Produção diária (peças boas vs refugo)', icon:'fa-chart-line', meta:`${d.dias} dias` })}
          <canvas id="chart-prod-linha" height="240"></canvas>
        </div>
        <div class="card p-5">
          ${UI.section({ title:'Distribuição de eficiência', icon:'fa-chart-pie', meta:`${d.dias}d` })}
          <canvas id="chart-efic-donut" height="240"></canvas>
          <div class="mt-3 text-sm" style="color:var(--text-secondary);text-align:center">
            <div><b style="color:#10B981">${eg.otimo||0}</b> ótimas (≥85%)</div>
            <div><b style="color:#F59E0B">${eg.medio||0}</b> médias (70-85%)</div>
            <div><b style="color:#EF4444">${eg.baixo||0}</b> baixas (&lt;70%)</div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div class="card p-5">
          ${UI.section({ title:'Eficiência por setor', icon:'fa-bar-chart', meta:'média' })}
          <canvas id="chart-setor" height="220"></canvas>
        </div>
        <div class="card p-5">
          ${UI.section({ title:'Ranking de colaboradores', icon:'fa-trophy', meta:'TOP 10' })}
          <div class="rank-list">
            ${(d.ranking_colab||[]).length
              ? d.ranking_colab.map((c, i) => UI.rankRow(i+1, c.nome, `${c.desc_setor||'—'} · ${fmt.int(c.pecas)} peças`, fmt.pct(c.efic))).join('')
              : `<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:13px">Sem produção registrada nos últimos ${d.dias} dias.</div>`
            }
          </div>
        </div>
      </div>

      ${(def.por_tipo||[]).length || (def.por_operacao||[]).length ? `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="card p-5">
          ${UI.section({ title:'Defeitos por tipo', icon:'fa-bug' })}
          <canvas id="chart-def-tipo" height="220"></canvas>
        </div>
        <div class="card p-5">
          ${UI.section({ title:'Defeitos por operação (gargalos)', icon:'fa-triangle-exclamation' })}
          <div style="max-height:240px;overflow-y:auto">
            ${(def.por_operacao||[]).map((o, i) => `
              <div class="rank-row" style="border-left:4px solid ${i===0?'#EF4444':i<3?'#F59E0B':'#94A3B8'}">
                <div class="pos">${i+1}</div>
                <div class="name"><b>${o.cod_op}</b><small>${o.desc_op}</small></div>
                <div class="score" style="color:#EF4444">${fmt.int(o.total)}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>` : ''}
    `;

    // Charts
    const colors = { primary:'#2563EB', success:'#10B981', warn:'#F59E0B', danger:'#EF4444', purple:'#8B5CF6' };
    const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#94A3B8';
    const gridColor = 'rgba(148,163,184,0.10)';

    // Linha de produção
    const linha = d.producao_linha || [];
    if (linha.length && window.Chart) {
      new Chart($('#chart-prod-linha'), {
        type: 'line',
        data: {
          labels: linha.map(x => fmt.date(x.dia)),
          datasets: [
            { label:'Peças boas', data: linha.map(x=>x.pecas), borderColor: colors.success, backgroundColor:'rgba(16,185,129,0.15)', tension:0.3, fill:true, borderWidth:2 },
            { label:'Refugo', data: linha.map(x=>x.refugo), borderColor: colors.danger, backgroundColor:'rgba(239,68,68,0.10)', tension:0.3, fill:true, borderWidth:2 },
          ]
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ labels:{ color:tickColor } } },
          scales:{ x:{ ticks:{color:tickColor}, grid:{color:gridColor} }, y:{ ticks:{color:tickColor}, grid:{color:gridColor}, beginAtZero:true } }
        }
      });
    }

    // Donut eficiência
    if ((eg.otimo||0) + (eg.medio||0) + (eg.baixo||0) > 0 && window.Chart) {
      new Chart($('#chart-efic-donut'), {
        type:'doughnut',
        data:{
          labels:['Ótimo (≥85%)','Médio (70-85%)','Baixo (<70%)'],
          datasets:[{ data:[eg.otimo||0, eg.medio||0, eg.baixo||0], backgroundColor:[colors.success, colors.warn, colors.danger], borderColor:'#0B1120', borderWidth:2 }]
        },
        options:{ responsive:true, maintainAspectRatio:false, cutout:'62%', plugins:{ legend:{ labels:{ color:tickColor, font:{size:11} } } } }
      });
    }

    // Barras setor
    const sets = (d.eficiencia_setor||[]).filter(s => s.pecas > 0);
    if (sets.length && window.Chart) {
      new Chart($('#chart-setor'), {
        type:'bar',
        data:{
          labels: sets.map(s => s.desc_setor),
          datasets:[
            { label:'Eficiência', data: sets.map(s => Math.round((s.efic||0)*100)), backgroundColor: sets.map(s => s.cor || colors.primary), borderRadius:6 }
          ]
        },
        options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:{color:tickColor}, grid:{color:gridColor} }, y:{ ticks:{color:tickColor, callback:(v)=>v+'%'}, grid:{color:gridColor}, beginAtZero:true, max:100 } } }
      });
    }

    // Defeitos por tipo
    if ((def.por_tipo||[]).length && window.Chart) {
      const top = def.por_tipo.slice(0,8);
      new Chart($('#chart-def-tipo'), {
        type:'bar',
        data:{ labels: top.map(t=>t.descricao), datasets:[{ label:'Qtde', data: top.map(t=>t.total), backgroundColor: top.map(t => t.gravidade==='alta'?colors.danger:t.gravidade==='media'?colors.warn:colors.primary), borderRadius:6 }] },
        options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y', plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:{color:tickColor}, grid:{color:gridColor}, beginAtZero:true }, y:{ ticks:{color:tickColor, font:{size:11}}, grid:{color:gridColor} } } }
      });
    }

    UI.liveTick(main, Date.now());
    $('#btn-refresh-mes').onclick = async () => {
      const b = $('#btn-refresh-mes'); b.classList.add('is-spinning');
      try { await ROUTES.mes_dashboard(main); } finally { b.classList.remove('is-spinning'); }
    };
  };

  /* ============================================================
   * BONIFICAÇÃO MENSAL
   * ============================================================ */
  ROUTES.bonificacao = async (main) => {
    const ano = new Date().getFullYear();
    const mes = new Date().getMonth() + 1;
    main.innerHTML = `
      ${UI.pageHeader({
        breadcrumb: [{ label: 'Início', href: '#dashboard' }, { label: 'Chão de Fábrica' }, { label: 'Bonificação' }],
        title: 'Bonificação Automática',
        badge: 'MES',
        desc: 'Cálculo automático de bônus mensal baseado em meta, eficiência e ranking. Use o botão para recalcular.',
        actions: `
          <select id="bn-ano" class="text-sm" style="width:90px;height:38px">${[ano-1,ano,ano+1].map(a=>`<option ${a===ano?'selected':''}>${a}</option>`).join('')}</select>
          <select id="bn-mes" class="text-sm" style="width:140px;height:38px">${['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m,i)=>`<option value="${i+1}" ${i+1===mes?'selected':''}>${m}</option>`).join('')}</select>
          <button class="btn btn-primary" id="bn-calc"><i class="fas fa-calculator mr-2"></i>Calcular agora</button>`,
      })}
      <div id="bn-content"></div>`;

    const carregar = async () => {
      const a = parseInt($('#bn-ano').value);
      const m = parseInt($('#bn-mes').value);
      const rs = await api('get', `/bonificacao?ano=${a}&mes=${m}`);
      const lista = rs.data?.lista || [];
      const total = lista.reduce((s, x) => s + (Number(x.bonus_calc) || 0), 0);
      const atingidas = lista.filter(x => x.meta_atingida).length;

      $('#bn-content').innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          ${UI.kpi({ label:'Colaboradores', value: lista.length, icon:'fa-users', accent:'blue' })}
          ${UI.kpi({ label:'Meta atingida', value: atingidas, icon:'fa-bullseye', accent:'green', sub:`de ${lista.length}` })}
          ${UI.kpi({ label:'Total bônus', value: 'R$ '+fmt.num(total,2), icon:'fa-money-bill-wave', accent:'amber' })}
          ${UI.kpi({ label:'Período', value: String(m).padStart(2,'0')+'/'+a, icon:'fa-calendar', accent:'indigo' })}
        </div>
        <div class="card overflow-auto">
          ${lista.length ? `<table class="w-full text-sm">
            <thead class="bg-slate-100"><tr>
              <th class="p-2 text-center w-12">#</th>
              <th class="p-2 text-left">Colaborador</th>
              <th class="p-2 text-left">Setor</th>
              <th class="p-2 text-right">Peças</th>
              <th class="p-2 text-right">Horas</th>
              <th class="p-2 text-right">Eficiência</th>
              <th class="p-2 text-center">Meta</th>
              <th class="p-2 text-right">Bônus</th>
            </tr></thead>
            <tbody>${lista.map(b => `
              <tr class="border-t" style="${b.ranking<=3?'background:rgba(251,191,36,0.06)':''}">
                <td class="p-2 text-center"><span class="badge" style="background:${b.ranking===1?'#FBBF24':b.ranking===2?'#94A3B8':b.ranking===3?'#F97316':'#E2E8F0'};color:#fff;font-weight:700;width:28px;display:inline-block;text-align:center">${b.ranking}</span></td>
                <td class="p-2"><b>${b.nome}</b><div style="font-size:11px;color:var(--text-secondary)">${b.matricula}</div></td>
                <td class="p-2">${b.desc_setor || '—'}</td>
                <td class="p-2 text-right">${fmt.int(b.pecas_total)}</td>
                <td class="p-2 text-right">${fmt.num(b.horas_total,1)}</td>
                <td class="p-2 text-right font-semibold" style="color:${b.efic_media>=0.85?'#10B981':b.efic_media>=0.7?'#F59E0B':'#EF4444'}">${fmt.pct(b.efic_media)}</td>
                <td class="p-2 text-center">${b.meta_atingida ? '<i class="fas fa-check-circle" style="color:#10B981"></i>' : '<i class="fas fa-times-circle" style="color:#94A3B8"></i>'}</td>
                <td class="p-2 text-right font-semibold" style="color:#10B981">R$ ${fmt.num(b.bonus_calc,2)}</td>
              </tr>`).join('')}
            </tbody>
          </table>` : UI.empty({ icon:'fa-trophy', title:'Sem cálculo para o período', desc:'Clique em "Calcular agora" para gerar o ranking e o bônus deste mês.' })}
        </div>`;
    };

    $('#bn-ano').onchange = carregar;
    $('#bn-mes').onchange = carregar;
    $('#bn-calc').onclick = async () => {
      const btn = $('#bn-calc'); btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Calculando...';
      try {
        await api('post', '/bonificacao/calcular', { ano: parseInt($('#bn-ano').value), mes: parseInt($('#bn-mes').value) });
        toast.success('Bonificação recalculada.');
        await carregar();
      } catch (e) { toast.error(e.message || 'Falha no cálculo.'); }
      finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-calculator mr-2"></i>Calcular agora'; }
    };
    await carregar();
  };

  /* ============================================================
   * RASTREABILIDADE — Produto → OP → Operações → Colab → Defeitos
   * ============================================================ */
  ROUTES.rastreabilidade = async (main) => {
    const rs = await api('get', '/ops');
    const ops = rs.data || [];
    main.innerHTML = `
      ${UI.pageHeader({
        breadcrumb: [{ label: 'Início', href: '#dashboard' }, { label: 'Produção' }, { label: 'Rastreabilidade' }],
        title: 'Rastreabilidade Completa',
        badge: 'MES',
        desc: 'Visualize todo o caminho de uma OP: operações executadas, colaboradores envolvidos e defeitos registrados.',
      })}
      <div class="card p-4 mb-4">
        <label>Selecione a OP</label>
        <select id="rs-op">
          <option value="">--</option>
          ${ops.map(o => `<option value="${o.id_op}">${o.num_op} — ${o.cod_ref} (${o.nome_cliente})</option>`).join('')}
        </select>
      </div>
      <div id="rs-out"></div>`;

    $('#rs-op').onchange = async (e) => {
      const id = parseInt(e.target.value);
      const out = $('#rs-out');
      if (!id) { out.innerHTML = ''; return; }
      out.innerHTML = `<div class="card p-6" style="text-align:center;color:var(--text-secondary)"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando...</div>`;
      try {
        const r = await api('get', `/rastreabilidade/op/${id}`);
        const d = r.data;
        out.innerHTML = `
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            ${UI.kpi({ label:'Nº OP', value: d.op.num_op, icon:'fa-clipboard-list', accent:'blue' })}
            ${UI.kpi({ label:'Produto', value: d.op.cod_ref, icon:'fa-tshirt', accent:'indigo', sub: d.op.desc_ref })}
            ${UI.kpi({ label:'Cliente', value: d.op.nome_cliente, icon:'fa-user-tie', accent:'purple' })}
            ${UI.kpi({ label:'Status', value: d.op.status, icon:'fa-info-circle', accent:'amber' })}
          </div>
          <div class="card p-5 mb-4">
            ${UI.section({ title:'Operações executadas', icon:'fa-list-ol' })}
            <table class="w-full text-sm">
              <thead class="bg-slate-100"><tr>
                <th class="p-2 text-right">Seq</th>
                <th class="p-2 text-left">Operação</th>
                <th class="p-2 text-right">Tempo padrão</th>
                <th class="p-2 text-right">Produzido</th>
                <th class="p-2 text-right">Refugo</th>
                <th class="p-2 text-right">Retrab.</th>
                <th class="p-2 text-right">Colab.</th>
                <th class="p-2 text-right">Efic. média</th>
              </tr></thead>
              <tbody>${(d.operacoes||[]).map(o => `
                <tr class="border-t">
                  <td class="p-2 text-right font-mono">${o.sequencia}</td>
                  <td class="p-2"><b>${o.cod_op}</b> — ${o.desc_op}</td>
                  <td class="p-2 text-right">${fmt.num(o.tempo_padrao,2)} min</td>
                  <td class="p-2 text-right font-semibold">${fmt.int(o.pecas_produzidas)}</td>
                  <td class="p-2 text-right" style="color:${o.pecas_refugo>0?'#EF4444':'inherit'}">${fmt.int(o.pecas_refugo)}</td>
                  <td class="p-2 text-right" style="color:${o.pecas_retrabalho>0?'#F59E0B':'inherit'}">${fmt.int(o.pecas_retrabalho)}</td>
                  <td class="p-2 text-right">${o.qtd_colaboradores}</td>
                  <td class="p-2 text-right font-semibold" style="color:${o.efic_media>=0.85?'#10B981':o.efic_media>=0.7?'#F59E0B':o.efic_media>0?'#EF4444':'var(--text-secondary)'}">${o.efic_media>0?fmt.pct(o.efic_media):'—'}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div class="card p-5">
              ${UI.section({ title:'Colaboradores envolvidos', icon:'fa-users' })}
              ${(d.colaboradores||[]).length ? `<div class="rank-list">${d.colaboradores.map((c,i) => UI.rankRow(i+1, c.operador_nome, c.desc_setor || `${c.sessoes} sessão(ões)`, fmt.int(c.pecas)+' pç')).join('')}</div>` : `<div style="text-align:center;color:var(--text-secondary);padding:20px">Nenhum colaborador registrado.</div>`}
            </div>
            <div class="card p-5">
              ${UI.section({ title:'Defeitos registrados', icon:'fa-bug' })}
              ${(d.defeitos||[]).length ? `<table class="w-full text-sm">
                <thead class="bg-slate-100"><tr>
                  <th class="p-2 text-left">Defeito</th>
                  <th class="p-2 text-center">Gravidade</th>
                  <th class="p-2 text-right">Qtde</th>
                </tr></thead>
                <tbody>${d.defeitos.map(df => `
                  <tr class="border-t">
                    <td class="p-2">${df.descricao}</td>
                    <td class="p-2 text-center"><span class="badge" style="background:${df.gravidade==='alta'?'#FEE2E2':df.gravidade==='media'?'#FEF3C7':'#DBEAFE'};color:${df.gravidade==='alta'?'#991B1B':df.gravidade==='media'?'#92400E':'#1E40AF'};font-weight:600">${df.gravidade}</span></td>
                    <td class="p-2 text-right font-semibold">${fmt.int(df.qtde)}</td>
                  </tr>`).join('')}
                </tbody>
              </table>` : `<div style="text-align:center;color:#10B981;padding:20px"><i class="fas fa-check-circle mr-1"></i>Sem defeitos registrados — qualidade 100%</div>`}
            </div>
          </div>
        `;
      } catch (err) {
        out.innerHTML = `<div class="card p-6" style="color:#EF4444"><i class="fas fa-exclamation-triangle mr-2"></i>Erro: ${err.message}</div>`;
      }
    };
  };

  /* ============================================================
   * CENTRAL DE ALERTAS
   * ============================================================ */
  ROUTES.alertas = async (main) => {
    const rs = await api('get', '/alertas');
    const alertas = rs.data?.alertas || [];
    main.innerHTML = `
      ${UI.pageHeader({
        breadcrumb: [{ label: 'Início', href: '#dashboard' }, { label: 'Gestão' }, { label: 'Alertas' }],
        title: 'Central de Alertas',
        badge: 'MES',
        desc: 'Notificações inteligentes do sistema baseadas em produção, eficiência, qualidade e prazos.',
        actions: `<button class="btn-icon" id="btn-ref-al" title="Atualizar"><i class="fas fa-sync-alt"></i></button>`,
      })}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        ${UI.kpi({ label:'Total alertas', value: alertas.length, icon:'fa-bell', accent: alertas.length>0?'amber':'green' })}
        ${UI.kpi({ label:'Críticos', value: alertas.filter(a=>a.tipo==='danger').length, icon:'fa-triangle-exclamation', accent:'red' })}
        ${UI.kpi({ label:'Atenção', value: alertas.filter(a=>a.tipo==='warning').length, icon:'fa-circle-exclamation', accent:'amber' })}
        ${UI.kpi({ label:'Status', value: alertas.length===0 ? 'OK' : 'Ação', icon:'fa-shield-alt', accent: alertas.length===0?'green':'red' })}
      </div>
      <div class="card p-5">
        ${UI.section({ title:'Notificações ativas', icon:'fa-bell' })}
        ${alertas.length ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-3">${alertas.map(a => UI.alert(a)).join('')}</div>`
          : UI.empty({ icon:'fa-shield-alt', title:'Tudo certo!', desc:'Nenhum alerta crítico no momento. Continue acompanhando o dashboard MES para indicadores em tempo real.' })}
      </div>`;
    $('#btn-ref-al').onclick = () => ROUTES.alertas(main);
  };

  // Funções auxiliares globais (tornar disponíveis)
  window.openColabPerfil = openColabPerfil;

  // Cleanup ao trocar de rota
  document.addEventListener('coreproRouteChange', () => {
    if (APONT_TIMER_INTERVAL) {
      clearInterval(APONT_TIMER_INTERVAL);
      APONT_TIMER_INTERVAL = null;
    }
  });

  // Helper debounce caso ainda não exista
  if (typeof window.debounce !== 'function') {
    window.debounce = function (fn, ms) {
      let t; return function() { clearTimeout(t); const a = arguments, ctx = this; t = setTimeout(() => fn.apply(ctx, a), ms); };
    };
  }

})();
