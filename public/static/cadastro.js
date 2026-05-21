/* =====================================================================
 * cadastro.js — Página pública de cadastro de empresa (SaaS signup)
 * SPRINT 4 — Trial 14 dias, 4 planos
 * Carregado dinamicamente por app.js quando hash inicia com #cadastro
 * ===================================================================== */
(function () {
  'use strict';

  // -------- Helpers --------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmtBRL = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');

  // CSS injection (escopo isolado)
  function injectCSS() {
    if (document.getElementById('cadastro-css')) return;
    const css = `
.cadastro-page { min-height: 100vh; background: linear-gradient(135deg, #020617 0%, #0F172A 50%, #1E1B4B 100%); color: #F8FAFC; font-family: 'Inter', sans-serif; padding: 24px 16px; }
.cadastro-wrap { max-width: 1100px; margin: 0 auto; }
.cadastro-header { display:flex; align-items:center; justify-content:space-between; padding-bottom: 32px; }
.cadastro-logo { display:flex; align-items:center; gap:12px; font-weight:800; font-size:20px; letter-spacing:-.02em; }
.cadastro-logo i { background: linear-gradient(135deg, #2563EB, #7C3AED); -webkit-background-clip:text; background-clip:text; color:transparent; font-size:28px; }
.cadastro-link-login { color: #94A3B8; font-size:14px; }
.cadastro-link-login a { color: #60A5FA; text-decoration: none; }
.cadastro-link-login a:hover { color: #93C5FD; text-decoration: underline; }
.cadastro-hero { text-align:center; padding: 24px 0 32px; }
.cadastro-hero h1 { font-size: clamp(28px, 4vw, 44px); font-weight: 800; background: linear-gradient(135deg, #60A5FA, #A78BFA, #00FF9C); -webkit-background-clip:text; background-clip:text; color:transparent; letter-spacing: -0.03em; margin: 0 0 12px; }
.cadastro-hero p { color: #94A3B8; font-size: 16px; max-width: 560px; margin: 0 auto; }
.trial-badge { display:inline-flex; align-items:center; gap:6px; background: rgba(0, 255, 156, 0.1); color: #00FF9C; border: 1px solid rgba(0, 255, 156, 0.3); padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
.cadastro-grid { display:grid; grid-template-columns: 1.2fr 1fr; gap: 28px; align-items:start; }
@media (max-width: 960px) { .cadastro-grid { grid-template-columns: 1fr; } }
.card { background: rgba(15,23,42,.7); backdrop-filter: blur(12px); border: 1px solid rgba(148,163,184,.15); border-radius: 16px; padding: 28px; }
.card h2 { font-size: 20px; font-weight: 700; margin: 0 0 6px; color: #F8FAFC; }
.card .subtitle { color: #94A3B8; font-size: 14px; margin-bottom: 24px; }
.form-row { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
.form-row.full { grid-template-columns: 1fr; }
@media (max-width: 600px) { .form-row { grid-template-columns: 1fr; } }
.field label { display:block; font-size: 13px; color: #CBD5E1; margin-bottom: 6px; font-weight: 500; }
.field input, .field select { width: 100%; background: rgba(2,6,23,.7); border: 1px solid rgba(148,163,184,.2); border-radius: 10px; padding: 11px 14px; color: #F8FAFC; font-size: 14px; transition: all .15s; box-sizing: border-box; }
.field input:focus, .field select:focus { outline: none; border-color: #60A5FA; box-shadow: 0 0 0 3px rgba(96,165,250,.15); }
.field .hint { font-size: 12px; color: #64748B; margin-top: 4px; }
.field .err { font-size: 12px; color: #F87171; margin-top: 4px; display:none; }
.field.has-error input { border-color: #F87171; }
.field.has-error .err { display:block; }
.cadastro-btn { width:100%; background: linear-gradient(135deg, #2563EB, #7C3AED); color: white; border: none; padding: 14px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; transition: all .15s; box-shadow: 0 8px 24px -8px rgba(37,99,235,.6); margin-top: 8px; }
.cadastro-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 32px -8px rgba(37,99,235,.8); }
.cadastro-btn:disabled { opacity: .6; cursor: not-allowed; transform: none; }
.terms { font-size: 12px; color: #64748B; text-align: center; margin-top: 14px; }
.terms a { color: #94A3B8; }

.planos-list { display:flex; flex-direction:column; gap: 12px; }
.plano-card { background: rgba(2,6,23,.5); border: 1px solid rgba(148,163,184,.15); border-radius: 12px; padding: 16px 18px; cursor: pointer; transition: all .15s; position: relative; }
.plano-card:hover { border-color: rgba(96,165,250,.4); background: rgba(2,6,23,.7); }
.plano-card.is-selected { border-color: #60A5FA; background: rgba(37,99,235,.1); box-shadow: 0 0 0 3px rgba(96,165,250,.15); }
.plano-card.is-popular::after { content: 'MAIS POPULAR'; position: absolute; top: -10px; right: 14px; background: linear-gradient(135deg, #F59E0B, #EF4444); color: white; padding: 3px 10px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; }
.plano-card .pl-top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
.plano-card .pl-nome { font-weight: 700; font-size: 16px; color: #F8FAFC; }
.plano-card .pl-desc { font-size: 12px; color: #94A3B8; margin-top: 2px; }
.plano-card .pl-preco { font-size: 22px; font-weight: 800; color: #00FF9C; }
.plano-card .pl-preco small { font-size: 11px; color: #94A3B8; font-weight: 500; }
.plano-card .pl-feats { display:flex; flex-wrap:wrap; gap: 6px; margin-top: 10px; }
.plano-card .pl-feat { font-size: 11px; background: rgba(96,165,250,.1); color: #93C5FD; padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(96,165,250,.2); }

.success-screen { background: rgba(15,23,42,.7); backdrop-filter: blur(12px); border: 1px solid rgba(0,255,156,.3); border-radius: 16px; padding: 48px 28px; text-align: center; max-width: 600px; margin: 60px auto; }
.success-screen .icon { font-size: 64px; color: #00FF9C; margin-bottom: 20px; animation: pop .4s ease-out; }
.success-screen h1 { font-size: 28px; margin: 0 0 12px; color: #F8FAFC; }
.success-screen p { color: #94A3B8; line-height: 1.6; margin: 6px 0; }
.success-screen .credenciais { background: rgba(2,6,23,.7); border: 1px solid rgba(148,163,184,.2); border-radius: 10px; padding: 16px; margin: 24px auto; max-width: 360px; text-align:left; font-family: 'Courier New', monospace; font-size: 13px; color: #00FF9C; }
.success-screen .credenciais strong { color: #94A3B8; }
.success-screen .btn-acessar { display:inline-block; background: linear-gradient(135deg, #2563EB, #7C3AED); color: white; padding: 14px 32px; border-radius: 12px; font-weight: 700; text-decoration: none; margin-top: 12px; }
@keyframes pop { 0% { transform: scale(0); opacity:0 } 50% { transform: scale(1.1) } 100% { transform: scale(1); opacity:1 } }

.alert-erro { background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.3); color: #FCA5A5; padding: 12px 16px; border-radius: 10px; font-size: 14px; margin-bottom: 18px; display:none; }
.alert-erro.show { display:block; }
    `;
    const tag = document.createElement('style');
    tag.id = 'cadastro-css';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // -------- API --------
  const API = '/api';
  let planos = [];
  let planoSelecionado = null;

  async function getPlanos() {
    try {
      const r = await fetch(`${API}/public/planos`);
      const j = await r.json();
      return j.ok ? (j.data || []) : [];
    } catch (e) { return []; }
  }

  async function fazerSignup(body) {
    const r = await fetch(`${API}/public/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  }

  // -------- Render --------
  function renderHeader() {
    return `
<header class="cadastro-header">
  <div class="cadastro-logo"><i class="fa-solid fa-layer-group"></i> CorePro</div>
  <div class="cadastro-link-login">
    Já tem conta? <a href="/" id="lnk-login-back">Entrar</a>
  </div>
</header>`;
  }

  function renderHero() {
    return `
<div class="cadastro-hero">
  <div class="trial-badge"><i class="fa-solid fa-gift"></i> 14 DIAS GRÁTIS · SEM CARTÃO DE CRÉDITO</div>
  <h1>Comece a usar o CorePro hoje mesmo</h1>
  <p>Crie sua conta em menos de 1 minuto. Você terá acesso completo durante o período de teste — sem compromisso.</p>
</div>`;
  }

  function renderPlanoCard(p) {
    const isPopular = p.codigo === 'profissional';
    const feats = [];
    if (p.max_usuarios > 0) feats.push(`<span class="pl-feat">${p.max_usuarios} usuários</span>`);
    if (p.max_usuarios < 0) feats.push(`<span class="pl-feat">Usuários ilimitados</span>`);
    if (p.max_remessas_mes > 0) feats.push(`<span class="pl-feat">${p.max_remessas_mes} remessas/mês</span>`);
    if (p.max_remessas_mes < 0) feats.push(`<span class="pl-feat">Remessas ilimitadas</span>`);
    if (p.max_terceirizados > 0) feats.push(`<span class="pl-feat">${p.max_terceirizados} terceirizados</span>`);
    if (p.feat_relatorios_avancados) feats.push(`<span class="pl-feat">Relatórios+</span>`);
    if (p.feat_api) feats.push(`<span class="pl-feat">API</span>`);
    if (p.feat_audit_log) feats.push(`<span class="pl-feat">Auditoria</span>`);

    return `
<div class="plano-card ${isPopular ? 'is-popular' : ''}" data-plano="${esc(p.codigo)}">
  <div class="pl-top">
    <div>
      <div class="pl-nome">${esc(p.nome)}</div>
      <div class="pl-desc">${esc(p.descricao || '')}</div>
    </div>
    <div class="pl-preco">${fmtBRL(p.preco_mensal)}<small>/mês</small></div>
  </div>
  <div class="pl-feats">${feats.join('')}</div>
</div>`;
  }

  function renderPlanosCol() {
    return `
<div class="card">
  <h2><i class="fa-solid fa-rocket" style="color:#60A5FA;margin-right:6px;"></i> Escolha seu plano</h2>
  <p class="subtitle">Você poderá testar grátis por 14 dias com o plano <strong style="color:#00FF9C">Profissional</strong>. Depois, escolha o plano ideal.</p>
  <div class="planos-list" id="planos-list">
    <div style="color:#64748B;font-size:14px;text-align:center;padding:30px;"><i class="fas fa-spinner fa-spin"></i> Carregando planos…</div>
  </div>
</div>`;
  }

  function renderFormCol() {
    return `
<div class="card">
  <h2><i class="fa-solid fa-building" style="color:#A78BFA;margin-right:6px;"></i> Crie sua conta</h2>
  <p class="subtitle">Suas informações ficam seguras. Não compartilhamos com terceiros.</p>
  <div class="alert-erro" id="cad-erro"></div>
  <form id="form-cadastro" autocomplete="off">
    <div class="form-row full"><div class="field"><label>Nome da empresa *</label><input id="f-empresa" type="text" required maxlength="120" placeholder="Ex: Confecções Silva LTDA" /></div></div>
    <div class="form-row">
      <div class="field"><label>CNPJ (opcional)</label><input id="f-cnpj" type="text" maxlength="20" placeholder="00.000.000/0000-00" /></div>
      <div class="field"><label>Telefone</label><input id="f-telefone" type="text" maxlength="20" placeholder="(11) 99999-9999" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Cidade</label><input id="f-cidade" type="text" maxlength="60" /></div>
      <div class="field"><label>UF</label><input id="f-uf" type="text" maxlength="2" placeholder="SP" /></div>
    </div>
    <hr style="border:none;border-top:1px solid rgba(148,163,184,.1);margin:20px 0;">
    <div class="form-row full"><div class="field"><label>Seu nome *</label><input id="f-admin" type="text" required maxlength="120" placeholder="Ex: João Silva" /></div></div>
    <div class="form-row full"><div class="field"><label>E-mail (será seu login) *</label><input id="f-email" type="email" required maxlength="160" placeholder="voce@empresa.com" /><div class="err">E-mail inválido</div></div></div>
    <div class="form-row full"><div class="field"><label>Senha *</label><input id="f-senha" type="password" required minlength="6" placeholder="Mínimo 6 caracteres" /><div class="hint">Mínimo 6 caracteres. Recomendamos misturar letras e números.</div></div></div>
    <button type="submit" class="cadastro-btn" id="btn-cad">
      <i class="fa-solid fa-rocket"></i> Criar conta e começar trial gratuito
    </button>
    <div class="terms">Ao criar conta, você concorda com nossos <a href="#">Termos</a> e <a href="#">Política de Privacidade</a>.</div>
  </form>
</div>`;
  }

  function renderSuccess(data) {
    return `
<div class="cadastro-wrap">
  ${renderHeader()}
  <div class="success-screen">
    <div class="icon"><i class="fa-solid fa-circle-check"></i></div>
    <h1>Bem-vindo ao CorePro! 🎉</h1>
    <p>Sua empresa <strong style="color:#F8FAFC">${esc(data.empresa.nome)}</strong> foi criada com sucesso.</p>
    <p>Seu trial de <strong style="color:#00FF9C">${data.trial_dias} dias</strong> está ativo até <strong>${esc(data.trial_ate || '—')}</strong>.</p>
    <div class="credenciais">
      <div><strong>Login:</strong> ${esc(data.login_admin)}</div>
      <div><strong>Senha:</strong> (a que você definiu)</div>
      <div><strong>URL:</strong> ${location.origin}</div>
    </div>
    <p style="font-size:13px;color:#94A3B8;">Estamos te conectando automaticamente…</p>
    <a href="/" class="btn-acessar" id="btn-entrar">Acessar agora <i class="fa-solid fa-arrow-right"></i></a>
  </div>
</div>`;
  }

  // -------- Logic --------
  function selectPlano(codigo) {
    planoSelecionado = codigo;
    $$('.plano-card').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.plano === codigo);
    });
  }

  function showError(msg) {
    const e = $('#cad-erro');
    if (!e) return;
    e.textContent = msg;
    e.classList.add('show');
    e.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function hideError() {
    const e = $('#cad-erro');
    if (e) e.classList.remove('show');
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    hideError();
    const btn = $('#btn-cad');
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Criando sua conta…';

    const body = {
      nome_empresa: $('#f-empresa').value.trim(),
      cnpj: $('#f-cnpj').value.trim() || null,
      telefone: $('#f-telefone').value.trim() || null,
      cidade: $('#f-cidade').value.trim() || null,
      uf: $('#f-uf').value.trim() || null,
      nome_admin: $('#f-admin').value.trim(),
      email_admin: $('#f-email').value.trim(),
      email_contato: $('#f-email').value.trim(),
      senha_admin: $('#f-senha').value,
      plano_codigo: planoSelecionado || 'profissional',
      trial_dias: 14,
    };

    if (!body.nome_empresa || !body.nome_admin || !body.email_admin || !body.senha_admin) {
      showError('Preencha todos os campos obrigatórios (*).');
      btn.disabled = false; btn.innerHTML = original;
      return;
    }

    try {
      const res = await fazerSignup(body);
      if (!res.ok) {
        showError(res.error || 'Não foi possível criar sua conta.');
        btn.disabled = false; btn.innerHTML = original;
        return;
      }
      // Sucesso — salva token e redireciona
      try {
        localStorage.setItem('corepro_token', res.data.token);
        // Também tenta nomes legados
        localStorage.setItem('pcp_token', res.data.token);
      } catch {}
      $('#app').innerHTML = renderSuccess(res.data);
      // Redirect automático em 3s
      setTimeout(() => {
        location.href = '/';
      }, 3000);
    } catch (e) {
      showError('Erro de conexão. Tente novamente em alguns segundos.');
      btn.disabled = false; btn.innerHTML = original;
    }
  }

  // -------- Boot --------
  async function boot() {
    injectCSS();
    $('#app').innerHTML = `
<div class="cadastro-page">
  <div class="cadastro-wrap">
    ${renderHeader()}
    ${renderHero()}
    <div class="cadastro-grid">
      ${renderPlanosCol()}
      ${renderFormCol()}
    </div>
  </div>
</div>`;

    // Carrega planos
    planos = await getPlanos();
    const list = $('#planos-list');
    if (planos.length === 0) {
      list.innerHTML = '<div style="color:#F87171;text-align:center;padding:20px;">Erro ao carregar planos. Recarregue a página.</div>';
    } else {
      list.innerHTML = planos.map(renderPlanoCard).join('');
      // Pré-seleciona 'profissional' (popular)
      const def = planos.find((p) => p.codigo === 'profissional') || planos[0];
      selectPlano(def.codigo);
      list.addEventListener('click', (e) => {
        const card = e.target.closest('.plano-card');
        if (card && card.dataset.plano) selectPlano(card.dataset.plano);
      });
    }

    $('#form-cadastro').addEventListener('submit', onSubmit);

    // Link voltar para login
    const lnk = $('#lnk-login-back');
    if (lnk) lnk.addEventListener('click', (e) => {
      e.preventDefault();
      location.hash = '';
      location.reload();
    });
  }

  boot();
})();
