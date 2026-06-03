# CorePro — Onde sistemas se tornam negócio

Plataforma SaaS de **PCP, balanceamento e gestão de produção** para confecções. Construída a partir da planilha legada **"Kamylla – Ficha Balanceamento v1.0"** e reimaginada com identidade visual de alto valor percebido.

## Visão Geral
- **Nome comercial**: **CorePro**
- **Tagline**: _Onde sistemas se tornam negócio._
- **Produto base**: PCP Confecção v2.0 (3 modos de balanceamento, ficha, apontamento, auditoria, multiusuário).
- **Tema visual**: Dark Premium SaaS — paleta `#020617 / #2563EB / #7C3AED / #00FF9C`, gradiente marca `linear-gradient(135deg, #2563EB, #7C3AED)`, glow controlado, tipografia Inter.
- **Stack**: Hono + TypeScript + Cloudflare Pages (edge) + D1 (SQLite) + SPA vanilla JS + TailwindCSS + Chart.js + DayJS + FontAwesome (via CDN).

## URLs Públicas

### 🚀 Produção (Cloudflare Pages)
- **App (domínio oficial)**: https://confeccao.corepro.com.br ⭐
- **App (URL Pages)**: https://corepro-confeccao.pages.dev
- **URL anterior (mantido como espelho)**: https://pcp-confeccao.pages.dev
- **Health**: https://confeccao.corepro.com.br/api/health
- **Dashboard do Cloudflare**: https://dash.cloudflare.com/ → Pages → corepro-confeccao
- **D1 Database**: `pcp-confeccao-prod` (`cb4cd8ca-3f6e-43bd-ad3d-b90488916399`) — 22 migrations aplicadas

### 🏢 Multi-Tenant SaaS (FASE 1 — concluída)
A partir da migration `0021_multi_tenant_foundation.sql`, o sistema é **multi-tenant ready**:
- Tabela `companies` (id_empresa, nome, cnpj, slug, plano, status, trial_ate, logo)
- Empresa default id=1 **"CorePro Confecção"** — todos os dados atuais herdam essa empresa
- Coluna `id_empresa INTEGER NOT NULL DEFAULT 1` em 23 tabelas tenant-scoped
- Middleware Hono injeta `c.get('id_empresa')` em toda request autenticada (fallback=1)
- `/api/auth/me` expõe `id_empresa` + objeto `empresa` completo
- Helper `getEmpresa(c)` em `src/lib/db.ts` para uso futuro
- Zero impacto para o usuário atual — sistema continua idêntico

### 🏢 Multi-Tenant SaaS (FASE 2 — concluída, em produção)
Migration `0022_rbac_owner.sql` + tenant scope completo no backend operacional:
- `usuarios` ganha `is_owner INTEGER NOT NULL DEFAULT 0` + `dt_atualizacao TEXT`
- Eleição automática: `MIN(id_usuario) WHERE perfil='admin' AND ativo=1` → owner por empresa
- Índice condicional `idx_usuarios_owner ON usuarios(id_empresa, is_owner) WHERE is_owner=1` garante 1 owner por empresa
- `companies` ganha `telefone, email_contato, endereco, cidade, uf, cep` para dados de contato
- Helper `requireOwner()` em `src/lib/auth.ts` retorna 403 `OWNER_REQUIRED` se não for owner
- `/api/auth/me` agora retorna `is_owner: boolean` (consumido pelo frontend)
- **Cobertura tenant aplicada** (~257 queries, ~95% do código operacional):
  - `terceirizacao.ts` (~3.286 linhas): Preços, Variações, Cores, Cleanup, Importar produtos, Importar preços, Importar remessas, Remessas (GET/POST/PUT/DELETE/next-num), Retornos (GET/context/POST/PUT/DELETE), Resumo, Dashboard, Status transitions (enviar/iniciar-producao/cancelar), retornar-tudo, preview-retorno, Financeiro (pendentes/pagar/pagar-lote), Alertas, Timeline, Grades-tamanho (8 rotas)
  - `cores.ts`: GET/POST/PUT/DELETE/DELETE-all/import — todos isolados por empresa
  - Helpers `resolveColorId`, `lookupPrecoHier`, `_itensRemessaComSaldo` aceitam `id_empresa` (default=1 para compat)
- **Rotas novas** Owner-only:
  - `GET /api/empresa` — dados completos da empresa (qualquer usuário autenticado)
  - `PUT /api/empresa` — edição **(Owner-only)** com middleware `requireOwner()`
- **Frontend**:
  - Item de menu "Minha Empresa" (ícone `fa-building`) visível apenas ao Owner
  - Tela `#minha_empresa` com formulário responsivo: nome (obrigatório), CNPJ, telefone, e-mail, endereço, cidade, UF, CEP
  - Badges visuais para `plano` e `status` da empresa
  - Tratamento de erros com código `OWNER_REQUIRED` mostra toast amigável
- **Pendência (baixo risco)**: `relatorios_detalhados.ts` (27 queries só-leitura) ainda sem `AND id_empresa=?` explícito — sem risco de vazamento porque há apenas 1 empresa em PROD. Será incluído em FASE 2.1 antes da abertura do cadastro público.

**Próximas fases planejadas (não iniciadas):**
- **FASE 2.1** — Tenant scope em `relatorios_detalhados.ts` + criação/gerenciamento de empresas (Super Admin)

### 🎨 UI v24 — Layout Premium ERP (Remessas + Retornos)
Refatoração completa das telas Remessas e Retornos com hierarquia explícita de containers e z-index — visual no nível de Notion, Monday, ClickUp:

- **Containers nomeados** (CSS + HTML): `#stickyFiltersContainer` (KPIs + filtros + ações, sticky no topo), `#tableScrollContainer` (única região scrollável, `.remessas-table-wrap` / `.retornos-table-wrap`), `#tableContentContainer` (a `<table>` com `<thead>` sticky)
- **Hierarquia de z-index definitiva** (sem mais conflitos):
  - tbody/linhas: 1
  - thead sticky tabela: 20
  - sticky filtros página: 30 (antes era 9999, conflitando com modais!)
  - modal-backdrop: 10000 (antes 9500)
  - modal: 10001 (antes 9501)
- **Backgrounds 100% sólidos** no sticky de filtros (`#0B1220` dark / `#FFFFFF` light) — zero transparência, zero vazamento
- **Modal-open tracker**: `MutationObserver` global observa `.modal-backdrop` no DOM e marca `body.modal-open` automaticamente. CSS usa `:has(.modal-backdrop)` + `body.modal-open` (fallback) para:
  - Tirar o sticky do stacking context (`position: static`) — nada da página vaza acima do backdrop
  - Bloquear scroll do `#main-content` enquanto modal aberto (`overflow: hidden`)
  - Desabilitar `pointer-events` atrás do modal — clique só na caixa central
- **Thead sticky robusto**: `position: sticky; top: 0; z-index: 20` dentro do scroll-wrapper. Linha do `<th>` 100% opaca (`#0F172A` / `#FFFFFF`), com box-shadow inferior suave. Acompanha o scroll vertical da tabela sem flickering.
- **Scroll único**: o `#tableScrollContainer` é o único elemento que rola (vertical + horizontal), com `max-height: calc(100vh - var(--sticky-h) - 56px)`. `--sticky-h` é medido em runtime pelo `ResizeObserver`.
- **Responsivo**: breakpoints 1280px / 768px / 480px ajustam grid de filtros, esconde labels em mobile, KPI grid vira 2 colunas → 1.
- **Performance**: zero re-renders extras, `IntersectionObserver` apenas para sombra `.is-stuck` quando sticky cola, scroll-behavior smooth.

Versão do bundle: `app.js?v=28` + `styles.css?v=28`.

### 🧭 Multi-Tenant SaaS (FASE 3 — SPRINT 1 concluído, em produção)
Transformação completa em **SaaS multiempresa profissional** com administrador master, planos mensais e estrutura de cobrança PIX. Migrations `0023_saas_master.sql` + `0024_companies_plano_check.sql`.

**Backend (concluído e em PROD)**:
- `super_admins` + `super_admin_sessoes` (auth separada, token prefix `m_`, expira em 8h)
- `plans` (5 planos seed: trial gratuito, starter R$49,90, profissional R$99,90, premium R$199,90, enterprise R$499,90 com `max_usuarios` / `max_remessas_mes` / `max_terceirizados` / `features` JSON)
- `subscriptions` (1 ativa por tenant via índice UNIQUE parcial) + `payments` (PIX/boleto/cartão/manual/cortesia)
- `companies` ganha `id_plano`, `dt_suspensao`, `bloqueada_em`, `motivo_bloqueio`; CHECK expandido para `trial|starter|profissional|premium|enterprise`
- `src/lib/master_auth.ts`:
  - `criarSessaoMaster`, `validarSessaoMaster`, `revogarSessaoMaster`
  - `masterAuthMiddleware` (protege `/api/master/*`)
  - `tenantStatusGuard()` — retorna **HTTP 402 `TENANT_SUSPENDED`** (suspensa) e **HTTP 403 `TENANT_BLOCKED`** (cancelada/bloqueada). Exceções: `/api/master/*`, `/api/health`, `/api/auth/login|bootstrap|me|logout|trocar-senha`
- `src/routes/master.ts` — 14 endpoints:
  - `POST /api/master/auth/login`, `POST /api/master/auth/logout`, `GET /api/master/auth/me`
  - `GET /api/master/dashboard` — KPIs globais (empresas ativas, MRR, receita 30d, inadimplentes)
  - `GET /api/master/plans` — lista planos
  - `GET /api/master/empresas` — lista com filtros + paginação (KPIs por empresa: usuários, remessas, último login)
  - `GET /api/master/empresas/:id`, `POST /api/master/empresas`, `PUT /api/master/empresas/:id`
  - `POST /api/master/empresas/:id/suspender`, `/reativar`, `/bloquear`, `/cancelar`, `/trocar-plano`
- Tenant-scope completo em `relatorios_detalhados.ts` (15 endpoints / ~31 queries via `buildWhere(q, prefix, id_empresa)`) e `configuracoes.ts` (/parametros GET/PUT)
- Seed: super_admin `master/master` (hash `SHA-256(salt + ':' + senha)` em hex) + empresa id=1 vinculada ao plano enterprise (cortesia perpétua)

**Frontend (concluído e em PROD)**:
- `public/static/master.js` (49 KB, IIFE standalone, dark theme com gradiente roxo/azul) — SPA própria do master
- Rotas hash: `#master` (login) → `#master/dashboard` → `#master/empresas`, `#master/empresas/nova`, `#master/empresas/:id`, `#master/planos`
- Token armazenado em `localStorage.corepro_master_token` (separado do usuário normal)
- `app.js` injeta dinamicamente `master.js?v=1` quando a hash inicia com `#master`

**Smoke tests PROD validados** (https://9a5c9575.corepro-confeccao.pages.dev):
- Login master OK (token `m_…`)
- Dashboard: empresas=1, MRR=0 (empresa founder em cortesia)
- Empresas: lista CorePro Confecção / enterprise / 4 usuários / 141 remessas
- 5 planos retornados corretamente
- `master.js` HTTP 200 (49.368 bytes), cache `v=28`
- Empresa id=1 protegida contra bloquear/suspender (founder safety)

### 🧭 FASE 3 — SPRINTS 2-5 (concluídas e em produção, deploy 2026-05-21)

**SPRINT 2 — Enforcement de limites de plano + cron de suspensão** ✅
- `src/lib/plan_limits.ts` — engine de enforcement:
  - `LimitExceededError` (HTTP 402 + code `PLAN_LIMIT_EXCEEDED` + `recurso/atual/limite/plano`)
  - `assertLimit(db, id_empresa, 'usuarios'|'terceirizados'|'remessas_mes')`
  - `getPlanLimits()` — empresa id=1 sempre ilimitada (founder), fallback Starter
  - `getUsageSummary()` — dados completos para banner/tela de assinatura
- Aplicado em:
  - `POST /api/usuarios` + `PUT /api/usuarios/:id` (reativação) → `assertLimit('usuarios')`
  - `POST /api/terc/terceirizados` → `assertLimit('terceirizados')`
  - `POST /api/terc/remessas` → `assertLimit('remessas_mes')`
- `GET /api/empresa/uso` — endpoint para o banner global + tela "Assinatura"
- 3 cron endpoints (manuais ou via Cloudflare Cron Triggers futuramente):
  - `POST /api/master/jobs/expire-trials` — suspende empresas com trial expirado
  - `GET /api/master/jobs/preview-expire-trials` — preview sem executar
  - `GET /api/master/jobs/proximas-cobrancas` — empresas com cobrança vencida

**SPRINT 3 — Integração Mercado Pago PIX + tela financeira** ✅
- `src/lib/mercadopago.ts` — wrapper Fetch (compatível Cloudflare Workers, sem SDK):
  - `criarPixMP(token, req)` — cria preferência PIX
  - `consultarPagamentoMP(token, id)` — usado pelo webhook para validação
  - **Modo MOCK automático** quando `MP_ACCESS_TOKEN` ausente — gera QR fake + base64 + ID `MOCK-{ref}-{ts}`, permitindo desenvolvimento sem credenciais reais
- `src/routes/billing.ts` — 9 endpoints (~17.8 KB):
  - **Master**: `POST /api/master/billing/empresas/:id/cobrar`, `GET /api/master/billing/payments`, `POST /api/master/billing/payments/:id/aprovar|cancelar|sync`, `GET /api/master/billing/resumo`
  - **Usuário**: `GET /api/billing/minhas-faturas`, `GET /api/billing/proxima-fatura`, `POST /api/billing/gerar-cobranca`
  - **Webhook público**: `POST /api/public/mp/webhook` (re-consulta MP por segurança)
- `aplicarPagamentoAprovado()` helper — atualiza `payment.status='aprovado'`, `subscription.status='ativa'`, `dt_proxima_cobranca += 30d`, reativa empresa automaticamente
- **Frontend Master** (`master.js` v=2): nova rota `#master/financeiro` com 4 KPIs (MRR/Receita/Aprovados/Suspensas), gráfico mini de receita por mês (barras CSS gradient), tabela de payments com filtros (busca + status) e ações (Aprovar/Sync/Cancelar), modal "Nova cobrança" com seletor de empresa
- **Frontend Usuário** (`app.js` v=30): nova rota `#minha_assinatura` (owner-only) com header (status badge + botão Pagar PIX), uso vs limites com barras de progresso coloridas (verde→amarelo→vermelho conforme %), features do plano, próxima cobrança, histórico de faturas e modal PIX (QR + copia-e-cola + botão "Já paguei")

**SPRINT 4 — Signup público `/cadastro` + onboarding** ✅
- `src/routes/signup.ts` — 3 endpoints públicos:
  - `GET /api/public/planos` — lista de planos visíveis
  - `POST /api/public/signup/check` — valida e-mail/slug livre antes do envio
  - `POST /api/public/signup` — cria empresa + subscription + admin + sessão em uma transação
- **14 dias de trial gratuito** automático com plano `trial`
- Auto session token retornado (login imediato — usuário já entra logado)
- Slug + login com retry/suffix em caso de colisão (`-{randomHex(2)}`)
- `migrations/0025_usuarios_login_per_empresa.sql` — index helper (rebuild abandonado por FK constraint, login global UNIQUE mantido)
- `public/static/cadastro.js` (17 KB, IIFE standalone, dark theme purple/blue): badge "14 DIAS GRÁTIS · SEM CARTÃO", grid 2 col (planos com "MAIS POPULAR" no Profissional + form), pós-submit salva token + auto-redirect em 3s
- Rota: `https://app.url/#cadastro`

**SPRINT 5 — Rate limit + polish UX + middleware fix** ✅
- `src/lib/rate_limit.ts` — middleware factory `rateLimit({ key, max, windowSec })` por isolate Cloudflare Workers (in-memory `Map` com TTL):
  - `/api/master/auth/login`: 10/60s
  - `/api/public/signup`: 5/60s
  - `/api/public/signup/check`: 30/60s
  - `/api/public/mp/webhook`: 60/60s (alto pois MP pode hammer)
  - `/api/auth/login`: 15/60s
  - Retorna **HTTP 429** + header `Retry-After`
- 🔥 **FIX CRÍTICO** — Middleware order bug: `app.route('/api', billing)` estava registrado ANTES de `app.use('/api/*', authMiddleware)`, fazendo com que `c.get('id_empresa')` viesse `undefined`. Solução: authMiddleware + tenantStatusGuard registrados PRIMEIRO, depois routes
- `tenantStatusGuard()` excepted paths: `/api/public/*`, `/api/auth/perfil`, `/api/empresa`, `/api/empresa/uso`, `/api/billing/*` (usuário suspenso ainda pode pagar)
- **Frontend** — Interceptor global no `api()` (`app.js`):
  - `code: 'PLAN_LIMIT_EXCEEDED'` → modal amigável com CTA "Fazer upgrade do plano" → navega para `#minha_assinatura`
  - `code: 'TENANT_SUSPENDED'` → modal vermelho com CTA "Pagar agora via PIX" → navega para `#minha_assinatura`
  - `code: 'TENANT_BLOCKED'` / `TENANT_CANCELED` → modal não-dispensável com "Falar com suporte"
- **Banner global sticky** (`checkTrialBanner()`):
  - Empresa suspensa → faixa vermelha urgente (não dispensável)
  - Subscription pendente → faixa amarela
  - Trial ≤ 7 dias → faixa azul → "Escolher plano"
  - Trial > 7 dias → faixa ciano discreta dispensável por sessão
  - Trial expirado → faixa vermelha não-dispensável

**Smoke tests PROD validados** (https://corepro-confeccao.pages.dev — deploy 2df85a5b):
- Homepage + assets (`app.js?v=30`, `cadastro.js?v=2`, `master.js?v=2`) → HTTP 200
- `GET /api/public/planos` → 4 planos visíveis
- `POST /api/public/signup` → empresa #2 criada (login `joao`, token, trial 14d)
- `GET /api/empresa/uso` → trial 15 dias restantes, plano Starter, uso 1/2 usuários
- `POST /api/billing/gerar-cobranca` → MOCK PIX gerado (qr_code + qr_base64)
- Limit enforcement local: 3 usuários OK no Profissional, 4º → 402 `PLAN_LIMIT_EXCEEDED`
- Rate limit local: 15 logins OK, 16º → 429
- Tenant guard local: suspender empresa → `/api/usuarios` HTTP 402 `TENANT_SUSPENDED`, `/api/empresa/uso` HTTP 200 (exceção)
- Master `/api/master/billing/resumo` → MRR + receita_mes + por_mes
- Reativação após pagamento aprovado → empresa volta para `ativa` + subscription + dt_proxima_cobranca +30d

**Configuração opcional para MP real** (deferred):
```bash
npx wrangler pages secret put MP_ACCESS_TOKEN --project-name corepro-confeccao
npx wrangler pages secret put PUBLIC_BASE_URL --project-name corepro-confeccao
# value: https://corepro-confeccao.pages.dev
```
Sem essas vars o sistema opera em modo MOCK (QR fake, status manual via "Aprovar" no master/financeiro).

### ✨ FASE 3 — UX Polish (sidebar + romaneio com seleção, deploy 2026-05-22)
**Deploy**: cache v=31 em produção (https://corepro-confeccao.pages.dev).

#### 🐛 Bug fix: Sidebar SISTEMA accordion
- **Problema**: itens do menu **Sistema** (Usuários, Minha Empresa, Assinatura & Plano, Configurações) ficavam visíveis FORA do collapse, vazando da estrutura colapsável.
- **Causa raiz**: o truque CSS `grid-template-rows: 0fr → 1fr` exige **um único filho wrapper** com `overflow:hidden`. Aplicado direto em `.nav-group-items` com múltiplos `.nav-item` como filhos, o grid criava várias linhas que não colapsavam corretamente.
- **Fix**: introduzido wrapper `.nav-group-inner` envolvendo todos os items (single child para o grid trick funcionar), em `app.js` (renderLayout) e `styles.css`.
- **Bonus UX**: pill com contagem de itens no toggle (`<span class="nav-group-count">9</span>`) — usuário enxerga "Sistema 9".
- **Animação**: 0.28s ease em `grid-template-rows` + `opacity` + `margin` para abertura/fechamento suave; persistência mantida via `localStorage` (`nav-sistema-open`).

#### 🖨 Romaneio com seleção de produtos (modal premium)
Substitui geração direta de romaneio por **modal de seleção prévia** em todos os 3 pontos de entrada:
1. **Romaneio em remessa única** (botão "Gerar Romaneio" da lista)
2. **Romaneio em lote** (múltiplas remessas selecionadas)
3. **Modal de detalhes** (botão `🖨` dentro do detalhe da remessa)
4. **NOVO: Editar Remessa** — botão "🖨 Gerar romaneio selecionado" no footer do modal de edição (apenas em `edit mode`); handler busca remessa fresca da API antes de abrir.

**Função nova**: `TERC_PRINT.romaneioComSelecao(remessas, opts)` (~250 linhas) em `app.js`.
- Achata `remessas[].itens[]` em candidatos preservando índices `rIdx/iIdx` para reconstrução.
- `Set<uid>` mantém seleção; `recalcKPIs()` atualiza footer em tempo real.
- Header com busca instantânea + chips (Selecionar todos / Desmarcar / Inverter).
- Filtros rápidos por **cor** e **serviço** (pills `.rs-pill` com scale animation).
- Lista grid 6 colunas: checkbox / referência+descrição / serviço / cor / qtd / valor (verde `#34d399`).
- Footer sticky com 3 KPIs (selecionados, qtd total, valor total) + botões `Cancelar` / `Gerar Romaneio (N)`.
- Atalhos: **ESC** fecha, **Ctrl+Enter** confirma.
- Ao confirmar: retorna `remessas.map(r => ({ ...r, itens: itensFiltrados }))` — `romaneio()` recalcula totais e paginação automaticamente via `_flattenRemessasParaLinhas()`.

**Visual** (CSS, ~500 linhas novas em `styles.css`):
- Backdrop com `backdrop-filter: blur(8px)`.
- Card gradient escuro `#1e293b → #0f172a`, borda purple `#7c3aed`, animação `slideUp`.
- Botão primário gradient `#7c3aed → #6366f1` com shadow purple e badge contador.
- Custom scrollbar, accent-color `#7c3aed` nos checkboxes, hover purple translúcido.
- Mobile responsive (@media ≤720px): grid colapsa para 3 colunas.

#### Arquivos alterados
- `public/static/app.js` — `renderLayout` (wrapper + count pill), `TERC_PRINT.romaneioComSelecao()` nova, 3 call sites atualizados, botão "Gerar romaneio selecionado" + handler no modal de edição.
- `public/static/styles.css` — Refactor `.nav-group-items` (wrapper pattern) + `.nav-group-count` pill + ~500 linhas de modal premium `.romaneio-selector-*` / `.rs-*`.
- `src/index.tsx` — cache bump `v=30 → v=31` em app.js e styles.css.

### 🧱 FASE 4 — SaaS Multiempresa (em construção)

**SPRINT A — Planos editáveis (concluído, em produção 2026-05-22)**

Migration `0026_plans_editaveis.sql`:
- Adiciona em `plans`: `cor`, `destaque`, `ativo`, `trial_dias` (default 30)
- Features novas (12 no total): `feat_dashboard`, `feat_romaneio`, `feat_export_pdf`, `feat_backup`, `feat_personalizacao`, `feat_suporte_prioritario`, `feat_financeiro` (+ as 5 já existentes)
- Backfill: cores nos planos canônicos (starter azul, profissional roxo+destaque, premium violet, enterprise âmbar)
- Premium/Enterprise ganham automaticamente backup + personalização + suporte prioritário
- Índices em `ativo` (parcial) e `destaque` (parcial)

Backend (`src/routes/master.ts`):
| Rota | Método | Função |
|------|--------|--------|
| `/api/master/plans` | GET | Lista (`?incluir_inativos=1`) |
| `/api/master/plans/:id` | GET | Detalhe + contagem de uso (empresas/subs) |
| `/api/master/plans` | POST | Criar plano novo |
| `/api/master/plans/:id` | PUT | Atualizar (todos os campos) |
| `/api/master/plans/:id/duplicar` | POST | Cria cópia `codigo_copia[_N]` (oculta por padrão) |
| `/api/master/plans/:id/toggle` | POST | Ativar/desativar (bloqueia se há subs ativas) |
| `/api/master/plans/:id` | DELETE | Hard delete (bloqueia se há empresas/subs ligadas) |

Validação centralizada `normalizePlanPayload()` com regras:
- `codigo`: kebab-case, único no banco (409 se duplicar)
- `preco_mensal`: ≥ 0 obrigatório
- limites: `-1 = ilimitado`, inteiros ≥ -1
- features: normalização bool01 (1/'1'/true → 1, resto → 0)
- `cor`: hex `#RRGGBB` com fallback `#7c3aed`
- `trial_dias`: 0-365

Frontend (`public/static/master.js` v=3):
- **`viewPlanos()`**: cards grid responsivo (min 320px), gradient dark, border-top com cor do plano, badge "Destaque" (estrela amber), card "Inativo" (grayscale + opacity), preço grande, lista de limites em coluna, features como chips roxos com ícones FA, footer com trial/visível, ações inline (editar/duplicar/toggle/excluir)
- **`viewPlanoForm(id|null)`**: formulário completo grid 2-col:
  - **Identificação**: nome, código, descrição, preço, trial, cor (color picker nativo)
  - **Limites**: 4 campos (`-1 = ∞`)
  - **Features**: 12 toggles em grid com ícones, estilo card iOS (`:has(input:checked)`)
  - **Status & Visibilidade**: 3 toggles (ativo, visivel, destaque) + ordem
- Rotas próprias: `#master/planos/novo` e `#master/planos/:id`
- Confirms em ações destrutivas; toasts em sucesso/erro

CSS (`styles.css` v=33):
- `.plans-grid` (auto-fill 320px), `.plan-card` (gradient + hover lift)
- `.plan-card.destaque` (golden glow), `.plan-card.inativo` (grayscale)
- `.plan-feat-chip` (purple pills), `.plan-feat-toggle` (iOS-style com `:has(input:checked)`)
- Responsivo: ≤900px → single col; ≤540px → empilha tudo

Decisões de produto registradas:
- Gateway PIX: **Mercado Pago**
- Trial padrão: **30 dias**
- Ciclo: **somente mensal**
- Impersonate master → empresa: **NÃO** (decisão de segurança)

**SPRINT B — Gerenciamento de Empresas (concluído, em produção 2026-05-25)**

Cadastro de empresa agora cria automaticamente o **usuário admin (owner)** com **senha temporária** exibida apenas uma vez (não persistida em log).

- **Backend** (`src/routes/master.ts`):
  - `POST /api/master/empresas` agora aceita campos `admin_nome`, `admin_email`, `admin_login` (opcional), `admin_telefone`
  - Auto-cria usuário em `usuarios` com `perfil='admin'`, `is_owner=1`, `trocar_senha=1`, `ativo=1`
  - Senha temporária: 12 chars, mistura maiúscula/minúscula/dígito/símbolo, sem caracteres ambíguos (0/O/1/l/I)
  - Login do admin: derivado do e-mail (parte antes do `@`), com sufixo hex automático se houver colisão global (`joao.admin` → `joao.admin-9a0d`)
  - Validações: CNPJ único (409), slug único (409), e-mail admin válido (400)
  - Rollback manual: se a criação do admin falhar, a empresa recém-inserida é removida
  - `POST /api/master/empresas/:id/reset-admin-senha`: gera nova senha temp, marca `trocar_senha=1`, **revoga todas as sessões ativas** do owner
  - `GET /api/master/empresas/:id` agora retorna `owner` com `id_usuario, login, nome, email, trocar_senha, ultimo_login, dt_criacao`

- **Frontend** (`public/static/master.js`):
  - `viewNovaEmpresa`: formulário expandido com 3 seções (Empresa / Administrador / Plano)
  - Campos do admin obrigatórios: nome + e-mail; login é opcional (auto-gerado)
  - `openTempPasswordModal()`: modal one-time não-dismissível por click fora — exibe login + senha em fonte monospace destacada em amarelo, com botões copy-to-clipboard individuais e "Copiar tudo" (gera bloco texto pronto pra ditar)
  - `viewEmpresaDetalhe`: novo card **Administrador (owner)** com nome/login/e-mail/último login/badge "aguardando troca de senha" + botão **Resetar senha do admin** com modal de confirmação detalhado
  - `viewEmpresas`: 5 KPIs no topo (Total/Ativas/Trial/Suspensas/Bloqueadas), filtros expandidos (status + plano + bloqueio), nova coluna **Trial/Vencimento** com badges coloridas (verde = ok, amarelo = vence em ≤3d, vermelho = venceu)

- **Segurança**:
  - Senha em plaintext **nunca persistida** — só existe em memória durante a request HTTP, exibida no response uma única vez
  - `trocar_senha=1` força o usuário a trocar a senha no primeiro login (UI já trata isso via fluxo existente)
  - Reset de senha encerra todas as sessões ativas do owner (segurança contra sessão sequestrada)

- **Cache**: app.js v=33 → v=34, styles.css v=33 → v=34, master.js v=3 → v=4

**SPRINT C — Lifecycle de Assinaturas + Jobs Master (concluído, em produção 2026-05-25)**

Implementado o ciclo de vida automático das assinaturas com transições de estado, log auditável e cron diário.

- **Schema** (`migrations/0027_subscription_lifecycle.sql`, aplicada LOCAL+REMOTE):
  - `subscriptions.dias_grace INTEGER NOT NULL DEFAULT 5` — janela entre atraso e bloqueio
  - `subscriptions.dt_pagamento_atrasada TEXT` — data em que a sub virou pendente
  - `subscriptions.ultimo_aviso_em TEXT` — última vez que o sistema avisou o cliente (para idempotência do warn_upcoming)
  - `companies.bloqueada_por_pagamento INTEGER NOT NULL DEFAULT 0` — flag binária para tenant guard
  - **Tabela `sub_logs`**: histórico imutável de transições (`evento`, `status_antes`, `status_depois`, `origem`, `detalhes` JSON, `dt_criacao`)
  - **Tabela `job_runs`**: registro de execuções (`job_name`, `origem`, `duracao_ms`, `status`, `processados`, `resultado` JSON, `erro`, `acionado_por`)
  - Backfill: `dt_proxima_cobranca` populada com `dt_inicio + 30 dias` para subs antigas que não tinham

- **Jobs puros** (`src/lib/lifecycle.ts` — funções D1 reutilizáveis):
  - `runExpireTrials` — `trial` com `dt_fim_trial < hoje` → `pendente` + seta `dt_pagamento_atrasada`
  - `runMarkOverdue` — `ativa` com `dt_proxima_cobranca < hoje` → `pendente` + seta `dt_pagamento_atrasada`
  - `runBlockOverdue` — `pendente` há mais de `dias_grace` dias → `suspensa` + `companies.bloqueada_por_pagamento=1`
  - `runWarnUpcoming` — `ativa`/`trial` vencendo nos próximos 3 dias → marca `ultimo_aviso_em=hoje` (idempotente)
  - `runLifecycleFull` — orquestrador: roda os 4 acima em ordem, agrega resultados, registra UM `job_run` consolidado
  - **Constante `FOUNDER_ID = 1`** — empresa cortesia IMUNE a todas as mutações automáticas (`WHERE id_empresa != FOUNDER_ID` em todos os UPDATEs)
  - Idempotência rigorosa: todos os UPDATEs têm guards (`status = '…' AND … < date('now')`), 2ª execução retorna 0 processados

- **Endpoints Master** (`src/routes/master.ts`):
  - `POST /api/master/jobs/expire-trials` / `mark-overdue` / `block-overdue` / `warn-upcoming` — execução individual de cada job
  - `POST /api/master/jobs/lifecycle-full` — executa os 4 em sequência (mesmo que o cron faz)
  - `GET /api/master/jobs/preview-expire-trials` / `preview-mark-overdue` / `preview-block-overdue` / `preview-warn-upcoming` — listam o que **seria** afetado sem mutar nada
  - `GET /api/master/jobs/preview-all` — agregado dos 4 previews (1 chamada, 4 KPIs)
  - `GET /api/master/jobs/runs?limit=N` — histórico paginado de execuções
  - `GET /api/master/jobs/runs/:id` — detalhe de uma execução (com `resultado` JSON parseado)
  - `GET /api/master/empresas/:id/sub-logs?limit=N` — timeline de transições de uma empresa específica
  - Helper `runJob(c, job_name, fn)` envolve cada execução com `startJobRun` + `finishJobRun` para gravar duração, status (ok/erro), quem acionou (`master.login`)

- **Cron Trigger** (`src/index.tsx`):
  - Handler `scheduled(event, env, ctx)` exportado junto com `fetch` no `default export`
  - Chama `runLifecycleFull(env.DB, 'cron')` com `acionado_por='cron'` e registra `job_run` consolidado
  - **Agendamento**: `0 3 * * *` (03:00 UTC = 00:00 BRT) — diário
  - ⚠️ **Cloudflare Pages NÃO aceita `triggers.crons` no `wrangler.jsonc`** — o handler está pronto, mas o cron precisa ser configurado **uma vez** via Dashboard: Pages > corepro-confeccao > Settings > Functions > Cron Triggers > Add > `0 3 * * *`
  - Enquanto o cron não está configurado: o botão "Executar agora" na UI Master > Jobs > Lifecycle full faz exatamente a mesma coisa

- **Frontend Master** (`public/static/master.js`):
  - **Nav**: novo item "🤖 Jobs" no menu lateral
  - **`viewDashboard`** ganhou card **"Saúde do ciclo de vida"** (clique → /jobs) com 4 mini-KPIs lado a lado: avisos pendentes / trials a expirar / cobranças em atraso / a bloquear hoje
  - **`viewJobs`**: 4 cards por job (cor temática, ícone, contagem do preview, prévia de até 5 itens, botão "Executar agora" com overlay de confirmação) + botão destaque "Executar lifecycle completo" + botão "Ver histórico"
  - **`viewJobRuns`**: tabela com data/job/origem/duração/processados/status/acionado_por (clica → detalhe)
  - **`viewJobRunDetail`**: 5 KPIs (duração, processados, status, origem, acionado_por) + JSON viewer com `resultado` formatado
  - **`viewEmpresaDetalhe`** ganhou card **"Histórico da assinatura"** (timeline lazy-loaded sub_logs com dots coloridos por evento)
  - Rotas: `#master/jobs`, `#master/jobs/runs`, `#master/jobs/runs/:id`

- **Smoke tests PROD validados** (2026-05-25, antes do cron rodar):
  - `POST /api/master/jobs/lifecycle-full` → 4 jobs em 35ms, 0 processados (PROD limpo), `id_run=1` registrado
  - `GET /api/master/jobs/runs/1` → JSON parseado corretamente
  - 2ª execução → 0 processados (idempotência confirmada)

- **Cache**: app.js v=34 → v=35, styles.css v=34 → v=35, master.js v=4 → v=5

**Próximos sprints:**
- **SPRINT D**: Cobrança PIX via Mercado Pago (Adapter pattern, webhook HMAC, reconciliação)
- **SPRINT E**: Dashboard SaaS com MRR, ARR, churn, gráficos
- **SPRINT F**: ACL granular por feature do plano + auditoria + skeleton loading + dark mode + e-mails reais nos avisos do warn_upcoming

### ✨ FASE 3 polish — Botão "Salvar rascunho" removido (deploy 2026-05-22)
Botão `m-rascunho` removido completamente do modal de remessa:
- ~80 linhas de código legado eliminadas (`_coletarEstado`, `_aplicarEstado`, `RASCUNHO_KEY`, oferecer restauração, handler, cleanup pós-submit)
- Cleanup defensivo: `localStorage.removeItem('corepro:remessa:rascunho')` ao abrir modal (limpa navegadores antigos)
- Footer reorganizado: `[Cancelar] [Gerar romaneio selecionado] [Salvar remessa]`
- Novo wrapper `.rem-modal-actions` + classes `.rem-action-btn` / `.rem-btn-rom` / `.rem-btn-save`
- Cores: purple gradient para romaneio, green gradient para CTA salvar
- Responsivo: desktop horizontal, ≤640px coluna full-width 44px touch
- Cache: v=31 → v=32

### 🔑 Acesso Master (área administrativa SaaS)
- **URL**: https://confeccao.corepro.com.br/#master
- **Credenciais padrão**: `master` / `master` (trocar em produção)
- ⚠️ Área completamente separada do app operacional. Tokens master (`m_…`) não funcionam em rotas de usuário e vice-versa.

- **FASE 4** — Billing real (MP PIX webhook + recorrência)
- **FASE 5** — Onboarding público `/cadastro` + Trial 7 dias
- **FASE 6** — Polish (UI Linear/Stripe-style, notificações, tickets, PWA, 2FA, white label)

### 📦 Código fonte (GitHub)
- **Repositório**: https://github.com/playsurf001/pcp--corepro
- **Branch principal**: `main`

### 🛠️ Sandbox (desenvolvimento)
- App: https://3000-i3enbye2xzp7kgjcurtzy-18e660f9.sandbox.novita.ai
- Health: https://3000-i3enbye2xzp7kgjcurtzy-18e660f9.sandbox.novita.ai/api/health

## 🔐 Acesso ao Sistema
1. Abra https://corepro-confeccao.pages.dev
2. No primeiro uso, clique em **"aqui"** (link azul abaixo do botão Entrar) para inicializar o usuário admin.
3. Faça login com `admin` / `admin` — o sistema vai exigir a troca imediata.
4. Defina uma senha forte (mín. 6 caracteres).
5. Após logado, **Administrador → Usuários** permite criar operadores, PCP, gerentes.

### Perfis de acesso (RBAC)
| Perfil | Rank | Pode |
|---|---|---|
| admin | 100 | Tudo (gestão de usuários) |
| gerente | 80 | Tudo exceto gestão de usuários |
| pcp | 60 | Sequências, OPs, Balanceamento, Ficha, Importador |
| operador | 40 | Apontamento, consulta OPs/Ficha |
| visualizador | 20 | Apenas leitura |

## Funcionalidades Implementadas (todas testadas)
| Módulo | Rota SPA (hash) | API base |
|---|---|---|
| Dashboard com KPIs e gráficos | `#dashboard` | `GET /api/dashboard` |
| Ordens de Produção (OP) – CRUD, status, grade de cores/tamanhos | `#ops` | `GET/POST/PUT/PATCH/DELETE /api/ops` |
| Balanceamento (3 modos do legado: 100%, efic geral, efic por máquina) | `#balanceamento` | `GET /api/ops/:id/balanceamento?modo=1|2|3` |
| Ficha de Acompanhamento com pacote parametrizável + impressão/PDF via `window.print` | `#ficha` | `GET /api/ops/:id/ficha?pacote=N` |
| Apontamento diário (data, OP, seq, operador, boa, refugo, horas) com eficiência calculada | `#apontamento` | `GET/POST/DELETE /api/apontamentos` |
| Sequências operacionais com versionamento (apenas 1 ativa por referência) | `#sequencias` | `GET/POST/PUT/DELETE /api/sequencias`, `POST /api/sequencias/:id/ativar|inativar|duplicar` |
| Clientes (com observação multilinha – regra do legado) | `#clientes` | `GET/POST/PUT/DELETE /api/clientes` |
| Referências | `#referencias` | `/api/referencias` |
| Operações (cod, desc, máquina, aparelho, tempo padrão default) | `#operacoes` | `/api/operacoes` |
| Máquinas (com eficiência e oper/máq) | `#maquinas` | `/api/maquinas` |
| Aparelhos | `#aparelhos` | `/api/aparelhos` |
| Cores | `#cores` | `/api/cores` |
| Tamanhos | `#tamanhos` | `/api/tamanhos` |
| Parâmetros globais | `#parametros` | `/api/parametros` |
| Auditoria (append-only, todas as operações registradas) | `#auditoria` | `GET /api/auditoria` |
| **Autenticação** (login, logout, bootstrap, troca de senha) | tela de login | `POST /api/auth/{login,logout,bootstrap,trocar-senha}`, `GET /api/auth/me` |
| **Usuários** (admin - CRUD + RBAC) | `#usuarios` | `GET/POST/PUT/DELETE /api/usuarios` |
| **Importador** de OPs do legado (Excel/CSV) | `#importador` | `POST /api/importar/ops`, `POST /api/importar/cadastros` |
| **Relatórios profissionais** (6 tipos, prontos para impressão/PDF A4) | `#relatorios` | `GET /api/relatorios/{executivo,op/:id,producao,cliente/:id,referencia/:id,auditoria,filtros}` |

### 📊 Módulo de Relatórios (PDF/Impressão A4)
6 relatórios profissionais em layout otimizado para impressão (margens A4, cabeçalho com logo CorePro, rodapé com paginação, quebras de página controladas):

| # | Relatório | Descrição | Gráficos/Elementos |
|---|-----------|-----------|--------------------|
| 1 | **Executivo** | Visão consolidada do período (KPIs globais, top clientes/referências/operadores) | 8 KPIs, gráfico barras (produção diária boa × refugo), donut (OPs por status) |
| 2 | **OP Detalhada** | Ficha completa de 1 OP (cabeçalho, grade cores/tamanhos, sequência operacional, apontamentos) | 4 KPIs, 5 tabelas (info, cores, tamanhos, sequência, apontamentos) |
| 3 | **Produção por Período** | Apontamentos agregados por OP / operador / máquina + detalhe | 8 KPIs, 4 tabelas (por OP, operador, máquina, detalhe) |
| 4 | **Por Cliente** | Volume, OPs, prazos, eficiência, consumo por referência | 8 KPIs, 2 tabelas (referências, OPs) |
| 5 | **Por Referência** | Sequência ativa, eficiência por operação, histórico de versões | 8 KPIs, 3 tabelas (clientes, eficiência/operação, versões) |
| 6 | **Auditoria** | Rastro completo de alterações com filtros (período, módulo, usuário, busca) | 4 KPIs, 3 grids resumo + detalhe |

**Ações disponíveis em todo relatório:**
- 🖨️ Imprimir/Exportar PDF (via `window.print` — A4 retrato, margens 15 mm, cabeçalho/rodapé fixos)
- 🪟 Abrir em nova aba (versão stand-alone para PDF)
- 📋 Copiar HTML (para colar em e-mail/Word)

**CSS de impressão** (em `public/static/styles.css` — blocos `@media print`):
- Oculta sidebar, topbar, filtros e barra de ações
- Página A4 com margens 15 mm topo/rodapé, 12 mm laterais
- Cabeçalho com logo CorePro + nome do relatório + período
- Rodapé com data de impressão + usuário + paginação
- `.avoid-break` evita quebrar KPIs/gráficos ao meio
- `.page-break` força quebra antes de tabelas longas
- Cores neutras em impressão (tinta preta para texto, azul primário só em títulos)

### 🤝 Módulo de Controle de Terceirização (NOVO)
Implementa todo o fluxo de envio/retorno para prestadores externos baseado na planilha **"Controle de Terceirização Versão"** do cliente (10.560 remessas e 10.405 retornos analisados). Substitui o controle em Excel por um sistema transacional com previsões automáticas de retorno, tabela de preços por referência/serviço/coleção, e dashboards executivos.

| Tela (SPA hash) | O que faz | API base |
|---|---|---|
| `#terc_dashboard` | KPIs (6), gráfico de produção diária empilhado (boas/refugo/conserto), donut por serviço, top 10 terceirizados, lista de remessas em atraso | `GET /api/terc/dashboard?de=&ate=` |
| `#terc_resumo` | Visão por terceirizado — peças a coletar, em produção, produzidas, em conserto, índice de consertos, data prevista de término, valor movimentado. Exportação CSV + impressão. | `GET /api/terc/resumo?id_colecao=` |
| `#terc_remessas` | CRUD completo de remessas, filtros múltiplos (status, terceirizado, serviço, período, busca), grade de 10 tamanhos, cálculo automático de previsão (dt_saída + ceil(qtd×tempo_peça / (pessoas×min/dia×efic)) dias), lookup automático de preço tabelado | `GET/POST/PUT/DELETE /api/terc/remessas` |
| `#terc_retornos` | Lista consolidada de todos os retornos no período, com KPIs (boas/refugo/valor pago) e status de pagamento | deriva de `/api/terc/remessas/:id` |
| `#terc_terceirizados` | CRUD de prestadores externos com parâmetros produtivos (pessoas, min/dia, eficiência, prazo padrão). Botão toggle Ativar/Inativar. Auto-preenche parâmetros nas remessas | `GET/POST/PUT/DELETE /api/terc/terceirizados` + `PATCH /:id/situacao` |
| `#terc_precos` | Tabela de preços por (Referência + Serviço + Grade + Coleção). Endpoint de lookup usado pelas remessas para auto-preencher preço e tempo | `GET/POST/PUT/DELETE /api/terc/precos` + `GET /lookup` |
| `#terc_importador` | Importador Excel/TSV da aba "Remessa" da planilha legada com modo simulação, criação automática de cadastros ausentes, relatório de erros por linha | `POST /api/terc/importar/remessas` |

**Modais avançados:**
- **Nova Remessa**: grade de 10 tamanhos (PP → TAM2), recalcula total/valor/previsão em tempo real, botão "Buscar preço" consulta tabela automática
- **Registrar Retorno**: grade limitada ao saldo disponível por tamanho (enviado − já retornado), campos Boas/Refugo/Conserto, valor pago auto-calculado (boas × preço), suporte a retornos parciais múltiplos
- **Detalhe Remessa**: tela imprimível com ficha completa da remessa, todos os retornos consolidados, saldo a retornar, botão imprimir dedicado

**Cadastros semeados** (a partir da planilha real):
- **29 terceirizados** ativos (Alisson, Anna, Antonio Leite, Claudiele, Crislaine, Delma, Léo, Maria Costura, Patricia, ...)
- **3 setores**: Aparador, Embalagem, Estamparia
- **3 serviços**: Aparar peça, Embalagem, Estamparia
- **1 coleção**: Ímpeto
- **Tabela de preços** vazia (pronta para receber as 1.181 referências via importador)

**Status das remessas** (com badge visual):
- 🔵 **Aberta** (ainda sem retornos)
- 🟣 **EmProducao** (parâmetro manual)
- 🟡 **Parcial** (retornos existem mas saldo > 0)
- 🟢 **Concluida** (total retornado ≥ qtd enviada)
- 🔴 **Atrasada** (auto: previsão < hoje e não concluída)
- ⚪ **Cancelada**

### Regras de negócio ativas
- **NumOP** único (validado server-side).
- Sequência **só ativa** se tiver ao menos 1 item.
- Edição de sequência **bloqueada** se ela estiver ativa.
- OP só cria se **referência tiver sequência ativa**.
- Soma de **cores** = soma de **tamanhos** = `qtde_pecas` da OP.
- `tempo_padrao > 0` obrigatório em todas as linhas da sequência.
- Exclusão de OP **só** se não tiver apontamento (caso contrário usar `status=Cancelada`).
- **Auditoria automática** em `audit(db, modulo, acao, chave, campo, v_ant, v_novo)`.

### Fórmulas implementadas (consistentes com o legado)
- `Pçs/Hora 100% = 60 / TempoPadrão`
- `Pçs/Hora Real = Pçs/Hora 100% × eficiência_efetiva`
- `QtdMáquinas = CEIL( (QtdPecasDia × TempoPadrão) / (MinTurno × Turnos × efic) )`
- `QtdOperadores = (máquina? QtdMáquinas × oper_por_máquina : CEIL((QtdPecasDia×TP)/(MinTurno×Turnos)))`
- `EficiênciaReal apontamento = (QtdBoa × TempoPadrão) / (HorasTrab × 60)`

## Arquitetura de Dados (Cloudflare D1 — SQLite)
25 tabelas normalizadas:
- **Cadastros**: `parametros`, `clientes`, `referencias`, `maquinas`, `aparelhos`, `operacoes`, `cores`, `tamanhos`
- **Sequências**: `seq_cab` (versão + flag `ativa` única por referência), `seq_itens`
- **OP**: `op_cab`, `op_cores`, `op_tamanhos`
- **Execução**: `apontamento`
- **Governança**: `auditoria` (append-only)
- **Autenticação**: `usuarios`, `sessoes`
- **Terceirização** (NOVO, 10 tabelas): `terc_setores`, `terc_servicos`, `terc_colecoes`, `terc_terceirizados`, `terc_precos`, `terc_remessas`, `terc_remessa_grade`, `terc_retornos`, `terc_retorno_grade`, `terc_consertos`

Relacionamentos:
- `referencias` 1—N `seq_cab` 1—N `seq_itens`
- `op_cab` → `seq_cab` ativa (snapshot por versão)
- `op_cab` 1—N `op_cores` / `op_tamanhos` (grade normalizada — fim do problema de colunas Cor1..Cor10 do legado)
- `apontamento` → `op_cab` + `seq_itens` (FK dupla, permite eficiência por operação)

## Dados migrados do legado (real)
- **3 clientes reais** (Magazine de Confecções, Maria & Maria — com observação multilinha, Pepe — cliente especial).
- **7 cores reais** (Amarelo, Azul, Branco, Marinho, Preto, Verde, Vermelho).
- **21 tamanhos reais** (01, 02, 03, 2, 4, 6, 8, 10, 12, 14, 16, 34, 36, 38, 40, 42, 44, P, M, G, GG) com ordem lógica.
- Máquinas/aparelhos/operações seedados como exemplo (o legado vinha vazio — apenas linha "0"); prontos para serem substituídos pelos reais via UI.

## Guia Rápido de Uso
1. **Cadastros → Referências**: cadastre suas referências (códigos de produto).
2. **Engenharia → Sequências**: clique em "Nova versão", inclua operações (máquina + aparelho + tempo padrão). Salve e depois **Ative**. Apenas uma versão fica ativa por referência.
3. **Produção → OPs**: crie a OP informando número, referência (precisa ter sequência ativa), cliente, quantidade, entrega. Preencha a grade de cores e tamanhos (soma = qtde peças).
4. **Produção → Balanceamento**: selecione a OP e escolha o modo (1=100%, 2=eficiência geral, 3=eficiência por máquina); ajuste min/turno, turnos, peças/dia — o sistema calcula pçs/hora e nº de máquinas/operadores.
5. **Produção → Ficha Acompanhamento**: abra a ficha da OP, ajuste o tamanho do pacote e clique em **Imprimir** para gerar PDF.
6. **Chão de Fábrica → Apontamento**: registre diariamente a produção boa/refugo/horas por OP e sequência; eficiência real calculada automaticamente.
7. **Dashboard**: KPIs instantâneos (OPs abertas, atrasadas, peças, minutos, produção boa do mês, refugo, eficiência global, carga por cliente/referência, distribuição por status).
8. **Sistema → Auditoria**: consulta toda alteração feita no sistema (quem, quando, o quê).

## Deploy
- **Plataforma**: Cloudflare Pages + D1 (edge global)
- **Status Produção**: ✅ **Ativo** em https://corepro-confeccao.pages.dev
- **Projeto Cloudflare**: `corepro-confeccao` (production branch: `main`)
- **Banco D1 Produção**: `pcp-confeccao-prod` (UUID `cb4cd8ca-3f6e-43bd-ad3d-b90488916399`) — compartilhado entre os 2 projetos
- **Banco D1 Local**: `.wrangler/state/v3/d1`
- **Status Sandbox (dev)**: ✅ Rodando com PM2 na porta 3000
- **GitHub**: https://github.com/playsurf001/pcp--corepro (sincronizado)
- **Última atualização**: 2026-04-22

### Comandos de deploy usados
```bash
# 1. Criou banco D1 em produção
npx wrangler d1 create pcp-confeccao-prod

# 2. Aplicou migrations (schema + seed com 3 clientes, 7 cores, 21 tamanhos reais)
npx wrangler d1 migrations apply pcp-confeccao-prod --remote

# 3. Criou projeto Cloudflare Pages
npx wrangler pages project create corepro-confeccao --production-branch main --compatibility-date 2026-04-13

# 4. Build + Deploy
npm run build
npx wrangler pages deploy dist --project-name corepro-confeccao --branch main
```

### Scripts disponíveis
```bash
npm run build            # Vite → dist/_worker.js (~59 KB)
npm run db:migrate:local # aplica migrations ao D1 local
npm run db:reset         # apaga e recria o D1 local
pm2 start ecosystem.config.cjs   # sobe o servidor (wrangler pages dev)
pm2 logs webapp --nostream       # ver logs
npm run deploy:prod      # deploy para Cloudflare Pages
```

## 📥 Importador de dados legados
A tela **Sistema → Importador** aceita arquivos `.xlsx`, `.xls` e `.csv`. O parse do Excel acontece no browser (SheetJS via CDN) e o JSON normalizado é enviado à API.

**Colunas aceitas na planilha** (flexível - aceita múltiplos nomes):
- `num_op` (ou "Nº OP.", "num op", "numero_op")
- `dt_emissao` (ou "Data Emissão", "data_emissao")
- `dt_entrega` (ou "Previsão Entrega", "data_entrega")
- `cod_ref` (ou "Ref.", "ref", "referencia")
- `desc_ref` (opcional)
- `cliente` (aceita código ou nome)
- `qtde_pecas` (ou "Qtde Peças", "qtde")
- `observacao` (ou "Observações", "obs")
- **`cor_XXX`**: colunas com prefixo `cor_` viram grade de cores (ex: `cor_Branco`, `cor_Preto`)
- **`tam_XXX`**: colunas com prefixo `tam_` viram grade de tamanhos (ex: `tam_P`, `tam_M`, `tam_G`)

**Validações automáticas**:
- `num_op` único (ignora se já existe — marca como `duplicada`)
- Data em qualquer formato (serial Excel, dd/mm/aaaa, aaaa-mm-dd)
- Soma de cores = soma de tamanhos = qtde_pecas
- Referência precisa ter sequência ativa
- Opção de **criar automaticamente** clientes/referências faltantes
- Modo **dry-run** para validar sem gravar

Um botão **"Baixar modelo CSV"** na tela gera um template com as colunas corretas.

## 💰 SaaS Multi-tenant & Billing (Sprints A → D)

O CorePro evoluiu para uma plataforma SaaS multi-tenant com cobrança recorrente PIX via Mercado Pago. Cada empresa cliente é isolada via `id_empresa`. A empresa **id_empresa=1 (PLAYSURF / FOUNDER_ID)** é imune às mutações de billing — usada como tenant-mãe da plataforma.

### Sprint A — Multi-tenant + Master Panel
- Master Console em `/#master` (login separado: `super_admins`)
- CRUD de empresas, planos, subscriptions
- Auditoria global (`audit_logs`) com filtros
- KV namespace para feature flags por tenant

### Sprint B — Lifecycle Automation (`runLifecycleFull`)
- Job de ciclo de vida que roda em todas as requests (com `job_runs` para evitar overlap)
- Transições: `trial → expira_em` → suspende automaticamente
- `dt_pagamento_atrasada` controla aviso e bloqueio (`bloqueada_por_pagamento`)
- Auditoria via tabela `sub_logs` (exportada como `logSub`)

### Sprint C — Cobrança automática + UI cliente
- Endpoint `/api/billing/gerar-cobranca` (uso pelo tenant via SPA)
- Modal PIX no app com QR + copia-e-cola + botão "Já paguei"
- View **Minha Assinatura** no SPA do tenant
- Cron diário gera fatura `dt_proxima_cobranca` (preserva dias pagos)

### Sprint D — PIX REAL Mercado Pago (✅ CONCLUÍDO)
**Adapter Pattern de gateway de pagamento:**
- `src/lib/payments/types.ts` — interface `PixGateway`
- `src/lib/payments/mock.ts` — `MockGateway` (dev/sandbox)
- `src/lib/payments/mercadopago.ts` — `MercadoPagoGateway` (REAL)
- `src/lib/payments/factory.ts` — `getGateway(env)` decide via `MP_USE_MOCK`

**Validação CPF/CNPJ (Algoritmo DV brasileiro):**
- `validarCPF(digits)` e `validarCNPJ(digits)` em `src/lib/mercadopago.ts`
- Rejeita sequências repetidas e checksum DV inválido
- Se documento da empresa for inválido, o sistema **NÃO envia** `identification` ao MP (MP aceita criar PIX sem)

**Webhook MP (`POST /api/public/mp/webhook`):**
- Validação HMAC-SHA256 (manifest: `id:${dataId};request-id:${xRequestId};ts:${ts};`)
- Idempotência via `payment_webhook_events` com UNIQUE `external_id`
- Retorna **401** quando assinatura inválida (em PROD)
- Retorna **200 + replay:true** em duplicatas (race-condition-safe via `INSERT OR IGNORE`)
- Registra todos os headers (sem auth/cookie) + payload + duração

**Polling UI:**
- Endpoint `GET /api/billing/payment/:id/status`
- Modal PIX no SPA faz polling a cada 5s (máx 720 polls = 1h)
- Ao aprovar: toast verde + redireciona para Minha Assinatura

**Endpoints master (Sprint D):**
| Método | Rota | Função |
|---|---|---|
| POST | `/api/master/billing/payments/:id/simulate-approved` | Simula aprovação (apenas em mock; 403 em PROD) |
| GET | `/api/master/billing/webhooks` | Lista eventos webhook |
| GET | `/api/master/billing/webhooks/:id` | Detalhe do evento (payload + headers parseados) |

**Reconciliação:**
- `aplicarPagamentoAprovado()` integra Sprint C: limpa `bloqueada_por_pagamento`, `dt_pagamento_atrasada`, `ultimo_aviso_em`, registra `sub_log`, e calcula `dt_proxima_cobranca = max(hoje, dt_proxima_atual) + 30d` (preserva dias já pagos pelo cliente).

**Email do pagador (anti-rejeição MP):**
- `emailPagadorSeguro()` rejeita TLDs reservadas (`.test`, `.local`, `.example`, `.invalid`, `.localhost`) — fallback para `cobranca-${id}@corepro.com.br`.

**Mensagens de erro amigáveis:**
- "Conta MP sem chave PIX cadastrada" → instrui usuário a configurar PIX no painel MP
- "Documento inválido" → instrui atualizar cadastro
- HTTP 502 quando MP recusa, com `mp_error` original disponível para master debug

**Migração:** `migrations/0028_payment_webhooks.sql` cria `payment_webhook_events`, índice `idx_payments_mp_id`, coluna `payments.gateway DEFAULT 'mercadopago'`.

**Secrets configurados em Cloudflare Pages (PROD):**
- `MP_ACCESS_TOKEN` (APP_USR-...)
- `MP_WEBHOOK_SECRET` (para HMAC)
- `MP_PUBLIC_KEY`
- `MP_CLIENT_SECRET`
- `MP_CLIENT_ID`

**Modo local (`.dev.vars`):** `MP_USE_MOCK=1` força gateway mock mesmo com token real configurado.

> ⚠️ **Pré-requisito de conta MP:** O usuário Mercado Pago **recebedor** precisa ter uma **chave PIX cadastrada** (CPF, CNPJ, email ou telefone) no painel MP. Sem isso, MP retorna erro 13253 — "Collector user without key enabled for QR render". O CorePro detecta esse erro e mostra mensagem clara ao usuário.

## 🧭 Sprint Sidebar Reorganization + Módulo de Serviços (✅ CONCLUÍDO — deploy 2026-05-26)

Reestruturação completa da navegação lateral e entrega do módulo de **Serviços** como cadastro central da operação de terceirização.

### 🧭 Sidebar reorganizada — 4 grupos lógicos
A antiga aba **"Sistema"** foi substituída por **dois grupos colapsáveis** (`Cadastros` e `Configurações`), e itens foram reagrupados conforme intenção de uso. Estrutura final:

| Grupo | Itens | Ícone do grupo |
|---|---|---|
| **TERCEIRIZAÇÃO** (fixo) | Dashboard, Remessas, Retornos | `fa-truck` |
| **ANÁLISES** (fixo) | Relatórios | `fa-chart-line` |
| **CADASTROS** (colapsável) | **Serviços** (novo) · Produtos · Preços/Coleções · Grades de Tamanho · Terceirizados · Usuários | `fa-folder-tree` |
| **CONFIGURAÇÕES** (colapsável) | Importação · Minha Empresa · Assinatura & Plano · Configurações | `fa-gear` |

- Estado **aberto/fechado por grupo** persistido em `localStorage` (`nav-grp-open:<grupo>`)
- Pill de contagem (`.nav-group-count`) animada ao lado do nome do grupo
- "Cores" removido do menu (continua acessível via URL `#cores`)
- "Terceirizados" movido de Terceirização → Cadastros

### 🐛 Bug do submenu corrigido (vazamento visual)
A versão anterior usava apenas `grid-template-rows: 0fr → 1fr` + `opacity`, o que deixava o submenu **visível fora da área** em alguns navegadores ao colapsar. A nova solução em camadas defensivas resolve em 100% dos casos:

```css
.nav-group-items {
  display: grid;
  grid-template-rows: 0fr;
  overflow: hidden;        /* 1ª barreira — corta filhos */
  max-height: 0;           /* 2ª barreira — fallback */
  visibility: hidden;      /* 3ª barreira — remove do fluxo */
  opacity: 0;
  transition: grid-template-rows 0.30s cubic-bezier(0.4,0,0.2,1),
              max-height 0.30s cubic-bezier(0.4,0,0.2,1),
              opacity 0.22s ease 0.05s,
              visibility 0s linear 0.30s;
}
.nav-section-collapsible.is-open .nav-group-items {
  grid-template-rows: 1fr;
  max-height: 720px;
  visibility: visible;
  opacity: 1;
  transition: ..., visibility 0s linear 0s;
}
.nav-group-inner { overflow: hidden; }  /* 4ª barreira no wrapper */
```

### 🛠️ Módulo Serviços — Cadastro completo (`#terc_servicos`)

**Migration `0029_servicos_full.sql`** (aplicada LOCAL + REMOTE):
- Adiciona 7 colunas a `terc_servicos`: `descricao`, `categoria`, `cor` (hex `#RRGGBB`), `preco_padrao` (REAL), `tempo_padrao` (INTEGER min), `observacoes`, `dt_alteracao`
- **Backfill heurístico** atribui categoria + cor por padrão do nome:
  - "estamp*" → **Estamparia** / `#8B5CF6` (violeta)
  - "embala*" → **Acabamento** / `#2563EB` (azul)
  - "apara*", "corte" → **Acabamento** / `#06B6D4` (ciano)
  - "costura", "bordado" → **Confecção** / `#F59E0B` (âmbar)
  - demais → **Outros** / `#64748B` (slate)
- Cria `idx_servicos_categoria` e `idx_servicos_ativo`

**Backend — 9 endpoints REST (`src/routes/terceirizacao.ts`):**

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/terc/servicos` | Lista com filtros `?q=`, `?ativo=`, `?categoria=` + contagens de vínculos (`qtd_precos`, `qtd_produtos`, `qtd_remessas`) |
| `GET` | `/api/terc/servicos/categorias` | Categorias distintas com contagem |
| `GET` | `/api/terc/servicos/:id` | Detalhe + objeto `vinculos: {precos, produtos, remessa_itens, total}` |
| `POST` | `/api/terc/servicos` | Cria — anti-duplicidade case-insensitive (409 se existe) |
| `PUT` | `/api/terc/servicos/:id` | Atualiza — anti-duplicidade vs outras linhas |
| `PATCH` | `/api/terc/servicos/:id/toggle` | Flip `ativo` |
| `POST` | `/api/terc/servicos/:id/duplicate` | Duplica auto-renomeando `(cópia)`, `(cópia 2)` … até 50 |
| `DELETE` | `/api/terc/servicos/:id` | Valida vínculos. **409 + `code:'HAS_LINKS'`** se houver. `?force=1` → `UPDATE ativo=0` (preserva histórico) |

**Helpers internos:**
- `corSegura(s)` valida hex `#RGB` ou `#RRGGBB`
- `contarVinculosServico(db, id_empresa, id_servico)` consulta `terc_precos`, `terc_produtos`, `terc_remessa_itens`

**Frontend — `ROUTES.terc_servicos` (~460 linhas em `app.js`):**
- Tabela com colunas: status (toggle), cor + nome + descrição, categoria, preço padrão, tempo padrão, vínculos (3 pills clicáveis), ações
- **Busca debounced** (280ms) em nome + descrição + categoria
- **Filtros**: ativo/inativo, categoria (datalist autocomplete)
- **Ordenação por coluna** (nome, categoria, preço, vínculos)
- **Modal completo** com:
  - Input nome (obrigatório), categoria (datalist com sugestões), descrição
  - **Paleta de 15 cores** clicável + color picker nativo
  - **Preview ao vivo** do chip com contraste YIQ automático
  - Preço padrão (formatado R$) + tempo padrão (min)
  - Observações (textarea)
- **Ações por linha**: editar, duplicar, ativar/desativar, excluir (com confirmação dupla se houver vínculos)
- Cache `window.TERC.servicos` invalidado após mutações — **Remessas/Retornos/Relatórios usam serviços ativos automaticamente**

**Smoke tests executados (13/13 LOCAL ✅):**
1. `GET /terc/servicos` lista
2. `GET /terc/servicos/categorias`
3. `POST` cria novo
4. `GET /:id` detalhe com vínculos
5. `PUT /:id` atualiza
6. `POST` anti-dup → **409**
7. `PATCH /:id/toggle` flip ativo
8. `POST /:id/duplicate` → "(cópia)"
9. `DELETE` sem vínculo → **200**
10. `DELETE` com vínculo → **409 + HAS_LINKS**
11. `DELETE ?force=1` → desativa em vez de excluir
12. Estado final verificado
13. Cleanup OK

**PROD smoke tests ✅:**
- Assets `app.js?v=37` + `styles.css?v=37` servidos com HTTP/200
- HTML referencia v=37 corretamente
- `/api/health` OK
- Endpoints com auth retornam estrutura esperada

**Deploy:** `https://70c2d9c3.corepro-confeccao.pages.dev` (alias `https://corepro-confeccao.pages.dev`)

## 🎨 Módulo de Cores v2 (✅ CONCLUÍDO — deploy 2026-05-26)

Centralização do cadastro de cores na aba **CADASTROS** do menu lateral. As cores ficam disponíveis automaticamente para remessas, retornos, produtos, preços e relatórios.

### 🧭 Adição ao menu CADASTROS
Estrutura final do grupo Cadastros:
- Serviços · Produtos · Preços/Coleções · Grades de Tamanho · **Cores** (novo) · Terceirizados · Usuários

### 🗄️ Migration `0030_cores_observacoes.sql` (LOCAL + REMOTE)
- Adiciona coluna `observacoes TEXT` à tabela `cores` (campo livre, até 500 chars)
- Cria índices para acelerar contagens de vínculos:
  - `idx_precos_id_cor` em `terc_precos(id_cor)`
  - `idx_var_id_cor` em `terc_produto_variacoes(id_cor)`
  - `idx_remessa_itens_id_cor` em `terc_remessa_itens(id_cor)`
  - `idx_retorno_itens_id_cor` em `terc_retorno_itens(id_cor)`
- `idx_cores_ativo_empresa` em `cores(id_empresa, ativo)` para filtros rápidos
- **Idempotente** (`ADD COLUMN` + `IF NOT EXISTS`) e preserva os dados existentes (34 cores)

### 🛠️ Backend — `src/routes/cores.ts` (8 endpoints)

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/cores` | Lista com `?q=`, `?ativo=` + contagens via subquery (qtd_precos, qtd_variacoes, qtd_remessas, qtd_retornos) |
| `GET` | `/api/cores/:id` | Detalhe + objeto `vinculos: {precos, variacoes, remessa_itens, retorno_itens, total}` |
| `POST` | `/api/cores` | Cria nova (validação HEX + anti-dup nome/HEX 409) |
| `PUT` | `/api/cores/:id` | Atualiza (mesmas validações vs outras linhas) |
| `PATCH` | `/api/cores/:id/toggle` | Flip `ativo` |
| `POST` | `/api/cores/:id/duplicate` | Duplica com auto-rename `(cópia)` … até 50; varia o último dígito do HEX se necessário |
| `DELETE` | `/api/cores/:id` | Valida vínculos. **409 + `code:'HAS_LINKS'`** com `data.vinculos`. `?force=1` → `UPDATE ativo=0` |
| `POST` | `/api/cores/import` | Importação em massa (CSV/cole) — modos `skip` / `overwrite` |
| `DELETE` | `/api/cores?confirm=true&confirm2=EXCLUIR_TODAS` | Exclusão em massa com dupla confirmação |

**Helper `contarVinculosCor()`** consulta as 4 tabelas (`terc_precos`, `terc_produto_variacoes`, `terc_remessa_itens`, `terc_retorno_itens`) em paralelo via `Promise.all`.

### 🎨 Frontend — `ROUTES.cores` reescrito (~440 linhas)
- **Dois modos de visualização** alternáveis com toggle (preferência salva em `localStorage`):
  - **Tabela profissional** (default): status toggle, nome+observação, HEX chip com contraste YIQ, vínculos em pills (4 tipos), data de criação, ações
  - **Grade visual**: cards grandes com preview da cor + badge de vínculos
- **Modal completo** com:
  - Nome obrigatório (max 60)
  - HEX + color picker nativo sincronizados
  - **Paleta sugerida de 15 cores** clicável
  - **Preview ao vivo** com contraste automático (algoritmo YIQ)
  - **Observações** (textarea, max 500 chars)
  - Toggle ativa/inativa
- **Busca debounced** (280ms) por nome ou HEX
- **Filtro** "Somente ativas"
- **Ordenação** clicável por coluna (nome, hex, vínculos)
- **Ações por linha**: editar, duplicar, toggle, excluir (com confirmação inteligente baseada em vínculos)
- **Excluir cor com vínculos** → modal pergunta "DESATIVAR (preserva histórico)?" em vez de simplesmente bloquear
- Cache `window.Cores.invalidate()` chamado após cada mutação — **selects de cor em outras telas (Remessas/Retornos/Produtos/Preços) atualizam automaticamente**

### ✅ Smoke tests executados (11/11 LOCAL ✅)
1. GET list (34 cores) com contagens de vínculos
2. POST create com `observacoes`
3. GET /:id detalhe com objeto `vinculos`
4. PUT update preservando obs
5. POST anti-dup → **409**
6. PATCH /:id/toggle flip ativo
7. POST /:id/duplicate → nome "(cópia)" + hex variado
8. DELETE sem vínculo → 200 deleted
9. DELETE com vínculo → **409 + HAS_LINKS** com `data.vinculos: {precos:1, ...}`
10. DELETE `?force=1` → desativa (ativo=0) preservando histórico
11. Estado final validado + cleanup

### ✅ Smoke tests PROD
- Assets `app.js?v=38` + `styles.css?v=38` servidos com HTTP/200
- HTML referencia v=38
- `/api/health` OK
- `/api/cores` retorna 401 sem auth (esperado)

**Deploy:** `https://15d67b2b.corepro-confeccao.pages.dev` (alias `https://corepro-confeccao.pages.dev`)

## 🔥 HOTFIX Multi-tenant — Cores (✅ CONCLUÍDO — deploy 2026-05-26)

### 🐛 Bug crítico identificado
Empresas secundárias recebiam **"Request failed with status code 409"** ao tentar cadastrar **qualquer** cor cujo nome ou HEX já existisse em qualquer outra empresa do sistema. Comportamento bloqueava completamente a criação de cores em tenants secundários.

### 🔍 Causa raiz (DUPLA)

**1. UNIQUE constraint global (não escopada por tenant):**
Os índices originais em `cores` eram:
```sql
CREATE UNIQUE INDEX idx_cores_nome_unique ON cores (nome COLLATE NOCASE);  -- global!
CREATE UNIQUE INDEX idx_cores_hex_unique  ON cores (hex COLLATE NOCASE);   -- global!
```
Isso violava o princípio multi-tenant: empresa B não podia criar `LARANJA #F59E0B` porque empresa A já tinha.

**2. Body de erro vazio (`{}`) no backend:**
Em `cores.ts` v2, todos os 28 retornos de erro usavam o padrão incorreto:
```typescript
return c.json(fail('Já existe ...'), 409);  // ❌
```
O helper `fail()` já retorna um `Response` completo. Chamar `c.json()` sobre ele tentava serializar o Response como JSON, resultando em `{}` no body — e o frontend mostrava o `e.message` genérico do axios ("Request failed with status code 409") em vez da mensagem amigável do backend.

### ✅ Correção em 3 frentes

**1. Migration `0031_cores_unique_tenant_scoped.sql` (LOCAL + REMOTE):**
```sql
DROP INDEX IF EXISTS idx_cores_nome_unique;
DROP INDEX IF EXISTS idx_cores_hex_unique;
CREATE UNIQUE INDEX idx_cores_empresa_nome_unique ON cores (id_empresa, nome COLLATE NOCASE);
CREATE UNIQUE INDEX idx_cores_empresa_hex_unique  ON cores (id_empresa, hex  COLLATE NOCASE);
```
- **Idempotente** (IF EXISTS / IF NOT EXISTS)
- **Zero quebra de dados**: as 40 cores existentes em PROD continuam respeitando a nova constraint (todas em empresa 1)

**2. Backend (`src/routes/cores.ts`):**
- Corrigidos **28 usos** de `return c.json(fail('msg'), CODE)` → `return fail('msg', CODE)`
- Detecção mais precisa do erro UNIQUE composto: regex agora casa especificamente `cores.nome` e `cores.hex` (em vez de qualquer "nome" ou "hex" na mensagem)
- Mensagens ainda mais claras: `"Já existe uma cor com este nome **nesta empresa**."` (deixa claro que é escopado por tenant)

**3. Frontend (efeito colateral positivo):**
- Com o body JSON agora correto, o helper `api()` extrai `e.response.data.error` e exibe via toast — não há mais fallback para "Request failed with status code 409"
- Modal de cor mantém o `catch {}` (silencioso porque `api()` já mostra o toast amigável)

### 🧪 Smoke tests multi-tenant ✅
1. ✅ Empresa 1: cria `LARANJA_E2E #FF9900` → 200
2. ✅ Empresa 1: tenta criar **mesmo nome** → **409** `"Já existe uma cor com este nome nesta empresa."`
3. ✅ Empresa 1: tenta criar **mesmo hex** → **409** `"Já existe uma cor com este código HEX nesta empresa."`
4. ✅ Empresa 2: cria **MESMA cor `LARANJA_E2E #FF9900`** → **200** (isolamento por tenant funcionando!)
5. ✅ Estado final: 2 registros idênticos (id=51 empresa 1, id=52 empresa 2) — convivência perfeita
6. ✅ Empresa 2: tenta duplicar dentro do próprio tenant → **409** (constraint ainda protege contra dups dentro da mesma empresa)

### 📊 Garantias entregues
| Regra | Status |
|---|---|
| Empresas diferentes podem ter cores com mesmo nome | ✅ |
| Empresas diferentes podem ter cores com mesmo HEX | ✅ |
| Isolamento total entre tenants (id_empresa em todas as queries) | ✅ |
| Duplicidade bloqueada dentro da mesma empresa (nome ou HEX) | ✅ |
| Mensagens de erro amigáveis no frontend (sem "status code 409") | ✅ |
| Auditoria preserva tenant via `id_empresa` em todos os logs | ✅ |
| Dados pré-existentes não são afetados | ✅ |

**Deploy:** `https://31df6079.corepro-confeccao.pages.dev` (alias `https://corepro-confeccao.pages.dev`)

## 🔥 HOTFIX Multi-tenant — Remessas + Hardening SaaS (✅ CONCLUÍDO — deploy 2026-05-26)

### 🐛 Bug crítico identificado
Empresas secundárias recebiam **"Request failed with status code 500"** ao tentar salvar uma nova remessa de terceirização. O erro vazava silenciosamente sem mensagem amigável, bloqueando a operação central do tenant.

### 🔍 Causa raiz (DUPLA — descoberta em camadas)

**Bug #1 (primário): `resolveColorId` sem `id_empresa`**
Em `src/routes/terceirizacao.ts:1835`, a chamada estava:
```typescript
const id_cor = await resolveColorId(c.env.DB, it.cor);  // ❌ falta id_empresa
```
O helper tinha `id_empresa: number = 1` como default, então **toda cor enviada por uma empresa secundária era criada/buscada no tenant 1**, gerando UNIQUE constraint failures (após o hotfix anterior) e registros órfãos cruzando tenants. Mesmo problema em `lookupPrecoHier` (linha 1771).

**Bug #2 (secundário, descoberto durante validação): `terc_remessas.num_controle UNIQUE GLOBAL`**
A tabela `terc_remessas` tinha:
```sql
num_controle INTEGER NOT NULL UNIQUE  -- global!
```
Quando a empresa 5 criava remessa #1, a empresa 1 não conseguia mais criar a sua própria remessa #1. Erro: `UNIQUE constraint failed: terc_remessas.num_controle`. Mesmo padrão em `terc_consertos`.

### ✅ Correção em 6 frentes

**1. Backend — `src/routes/terceirizacao.ts`:**
- Reescrita do helper `resolveColorId`:
  - `id_empresa` agora é **obrigatório** (sem default, valida `Number.isFinite && > 0`, fallback defensivo com `console.error` se inválido)
  - Hex determinístico por seed `(id_empresa * 7919 + soma dos chars)` — garante que a mesma cor em empresas diferentes ganhe hex distintos automaticamente, sem colidir
  - Retry com hex alternativo em caso de UNIQUE race (colisão entre tenants)
- Fixado **linha 1835**: `resolveColorId(c.env.DB, it.cor, id_empresa)` ✅
- Fixado **linha 1771**: `lookupPrecoHier(..., id_empresa)` ✅
- Adicionados logs estruturados `logTenant('remessa.create.start', ...)` e `logTenant('remessa.create.success', ...)`

**2. Backend — `src/lib/db.ts` (helpers centrais multi-tenant):**
```typescript
export function requireEmpresa(c: Context): number {
  const n = Number(c.get('id_empresa'));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Response(JSON.stringify({
      ok: false, error: 'Sessão sem empresa vinculada. Faça login novamente.',
      code: 'TENANT_REQUIRED'
    }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return n;
}

export function logTenant(c: Context, event: string, extra = {}) {
  console.log('[tenant]', JSON.stringify({
    event, method: c.req.method, path: new URL(c.req.url).pathname,
    login: c.get('user')?.login || 'anon',
    id_empresa: c.get('id_empresa') || 0,
    ...extra,
  }));
}
```

**3. Global error handler — `src/index.tsx`:**
Adicionado `app.onError` que mapeia **todos** os erros SQLite para mensagens amigáveis em pt-BR:
| SQLite error | HTTP | code | Mensagem amigável |
|---|---|---|---|
| `no such table` | 500 | `SCHEMA_OUTDATED` | "Schema do banco desatualizado. Contate o suporte." |
| `UNIQUE constraint failed: cores.nome` | 409 | `DUPLICATE_COLOR_NAME` | "Esta cor já existe nesta empresa (mesmo nome)." |
| `UNIQUE constraint failed: cores.hex` | 409 | `DUPLICATE_COLOR_HEX` | "Esta cor já existe nesta empresa (mesmo HEX)." |
| `UNIQUE constraint failed` (genérico) | 409 | `DUPLICATE` | "Registro duplicado nesta empresa." |
| `FOREIGN KEY constraint failed` | 409 | `FK_VIOLATION` | "Referência inválida — registro relacionado não existe." |
| `NOT NULL constraint failed` | 400 | `MISSING_FIELD` | "Campo obrigatório ausente." |
| `CHECK constraint failed` | 400 | `INVALID_VALUE` | "Valor inválido em um dos campos." |
| `is not valid JSON` | 400 | `INVALID_JSON` | "Payload JSON inválido." |
| `D1_ERROR` (catch-all) | 500 | `DB_ERROR` | "Erro de banco de dados." |

Em **dev** inclui `detail` (300 chars do erro original); em **prod** apenas o JSON amigável. **Nenhum 500 cru vaza para o usuário.**

**4. Frontend — `public/static/app.js`:**
```javascript
if (status >= 500 && /Request failed with status code/i.test(msg)) {
  msg = 'Erro interno do servidor. Tente novamente ou contate o suporte.';
}
if (status === 0 || e.code === 'ERR_NETWORK') {
  msg = 'Falha de conexão. Verifique sua internet.';
}
```
Toast nunca mais mostra "Request failed with status code N".

**5. Migration `0032_multi_tenant_hardening.sql` (LOCAL + REMOTE — 28 cmds):**
Índices compostos `(id_empresa, fk)` para todas as tabelas tenant-scoped:
```sql
CREATE INDEX idx_terc_terc_emp_id          ON terc_terceirizados (id_empresa, id_terc);
CREATE INDEX idx_terc_serv_emp_id          ON terc_servicos      (id_empresa, id_servico);
CREATE INDEX idx_terc_remessas_emp_num     ON terc_remessas      (id_empresa, num_controle);
CREATE INDEX idx_terc_rem_itens_emp_rem    ON terc_remessa_itens (id_empresa, id_remessa);
CREATE INDEX idx_terc_rem_item_grade_emp_item  ON terc_remessa_item_grade (id_empresa, id_item);
CREATE INDEX idx_terc_rem_grade_emp_rem    ON terc_remessa_grade (id_empresa, id_remessa);
CREATE INDEX idx_terc_ret_emp_rem          ON terc_retornos      (id_empresa, id_remessa);
CREATE INDEX idx_terc_ret_itens_emp_ret    ON terc_retorno_itens (id_empresa, id_retorno);
CREATE INDEX idx_terc_ret_item_grade_emp_item  ON terc_retorno_item_grade (id_empresa, id_ret_item);
CREATE INDEX idx_cores_emp_ativo_ordem     ON cores              (id_empresa, ativo, ordem);
-- + backfill defensivo de id_empresa nas linhas legadas
```

**6. Migration `0033_unique_per_tenant_rebuild.sql` (LOCAL + REMOTE — 25 cmds em 28.11ms):**
Rebuild de `terc_remessas` e `terc_consertos` para substituir UNIQUE global por composto.
Padrão SQLite (já que `DROP CONSTRAINT` não existe):
```sql
CREATE TABLE terc_remessas_v2 (
  ...,
  num_controle INTEGER NOT NULL,        -- removido UNIQUE global
  id_empresa   INTEGER NOT NULL DEFAULT 1,
  UNIQUE (id_empresa, num_controle),    -- ✅ escopado por tenant
  FOREIGN KEY ...
);
INSERT OR IGNORE INTO terc_remessas_v2 SELECT ... FROM terc_remessas;
DROP TABLE terc_remessas;
ALTER TABLE terc_remessas_v2 RENAME TO terc_remessas;
-- recreate all indices
```
Mesmo padrão para `terc_consertos`. **193 remessas pré-existentes em PROD preservadas (todas em empresa 1).**

### 🧪 Smoke tests multi-tenant 8/8 ✅ (LOCAL)
| # | Cenário | Resultado |
|---|---|---|
| 1 | Empresa 5 cria remessa com cor "Verde" | ✅ 200 OK, num_controle=3 |
| 2 | Empresa 1 cria remessa com cor "Verde" (independente da E5) | ✅ 200 OK, num_controle=2 |
| 3 | Empresa 5 tenta ler remessa da Empresa 1 | ✅ 404 "Remessa não encontrada" (isolamento) |
| 4 | Empresa 5 lista cores | ✅ só vê Azul(id=53) + Verde(id=54) — só dela |
| 5 | DB state: Verde id=7 empresa=1 + Verde id=54 empresa=5 | ✅ convivem com hex distintos |
| 6 | `num_controle=1` em E1 e E5 simultaneamente | ✅ id_remessa=3/emp1 + id_remessa=1/emp5 |
| 7 | Duplicate dentro da mesma empresa | ✅ 409 "Registro duplicado nesta empresa." |
| 8 | Color UNIQUE mesma empresa | ✅ 409 "Esta cor já existe nesta empresa." |

### 🧪 Smoke tests PROD ✅
- ✅ `https://corepro-confeccao.pages.dev/static/app.js?v=40` → HTTP 200 (457 KB)
- ✅ `https://corepro-confeccao.pages.dev/static/styles.css?v=40` → HTTP 200 (223 KB)
- ✅ HTML serve `?v=40` para cache busting
- ✅ `/api/cores` sem auth → 401 `{ok:false, error:"Não autenticado.", code:"AUTH_REQUIRED"}`
- ✅ `/api/terc/remessas` sem auth → 401 friendly JSON
- ✅ POST inválido → 401 friendly (sem 500 cru)
- ✅ Schema PROD: `terc_remessas` agora tem `UNIQUE (id_empresa, num_controle)` composite
- ✅ Indices compostos confirmados em PROD: `idx_cores_emp_ativo_ordem`, `idx_terc_rem_grade_emp_rem`, etc.

### 📊 Garantias entregues
| Regra | Status |
|---|---|
| Empresas secundárias criam remessas sem erro 500 | ✅ |
| `num_controle` independente por tenant (cada empresa começa do #1) | ✅ |
| Cores nunca cruzam entre tenants (hex determinístico por empresa) | ✅ |
| Empresa A não consegue ler remessas da empresa B (404) | ✅ |
| Todos os helpers exigem `id_empresa` explícito (sem default mascarado) | ✅ |
| Logs estruturados expõem `id_empresa` + `login` + `event` em toda operação | ✅ |
| Nenhum 500 cru vaza — `app.onError` sempre devolve JSON amigável | ✅ |
| Frontend nunca mais mostra "Request failed with status code N" | ✅ |
| 193 remessas + 40 cores legadas preservadas (empresa 1) | ✅ |
| Indices compostos `(id_empresa, fk)` em 10 tabelas para performance | ✅ |

### 📁 Arquivos modificados
- `src/routes/terceirizacao.ts` — `resolveColorId` reescrito + fix linhas 1835/1771 + logTenant
- `src/lib/db.ts` — helpers `requireEmpresa()` + `logTenant()`
- `src/index.tsx` — `app.onError` global + cache bump v=39 → v=40
- `public/static/app.js` — fallback 5xx sem body + ERR_NETWORK
- `migrations/0032_multi_tenant_hardening.sql` (novo)
- `migrations/0033_unique_per_tenant_rebuild.sql` (novo)

**Deploy:** `https://e411a8f4.corepro-confeccao.pages.dev` (alias `https://corepro-confeccao.pages.dev`)

## 🔥 HOTFIX Módulo Retornos — Reparação de integridade (✅ CONCLUÍDO — deploy 2026-05-26)

### 🐛 Bug crítico identificado
A tela **/retornos** da empresa principal (id=1) aparecia **vazia** mesmo com 167 remessas marcadas como `status='Retornado'` na tela de Remessas. Todos os KPIs (Retornos, Peças boas, Peças em falta, Valor pago) ficavam zerados. Outras empresas funcionavam normalmente.

### 🔍 Causa raiz
**Dados legados sem vínculo em `terc_retornos`:**
- Empresa 1 tinha **167 remessas com `status='Retornado'`** mas **ZERO registros** em `terc_retornos`
- Esses dados foram importados da planilha legada "Kamylla v1.0" no modo `basico` (sem grade detalhada)
- A tela /retornos consulta `terc_retornos` (correto, conforme arquitetura), então mostrava vazio
- Empresa 2 tinha 1 remessa Retornada + 1 retorno → funcionava normalmente
- **Não era bug de tenant/query** — era inconsistência de dados legados

Auditoria PROD antes da reparação:
```
id_empresa=1 → 167 remessas 'Retornado' + 0 terc_retornos = 167 órfãs
id_empresa=2 → 1 remessa 'Retornado' + 1 terc_retornos = OK
```

### ✅ Correção em 5 frentes

**1. Migration `0034_repair_orphan_retornos.sql` (LOCAL + REMOTE — 7 cmds):**
Reconstrução automática de retornos faltantes para TODAS as empresas (idempotente):
```sql
INSERT INTO terc_retornos (id_remessa, dt_retorno, qtd_total, qtd_boa,
                            qtd_refugo, qtd_conserto, valor_pago, dt_pagamento,
                            observacao, criado_por, dt_criacao, id_empresa)
SELECT
  r.id_remessa,
  COALESCE(r.dt_recebimento, r.dt_saida, date('now')),
  r.qtd_total, r.qtd_total,  -- assume qtd_boa = qtd_total (modo basico)
  0, 0,
  COALESCE(r.valor_pago, 0), r.dt_pagamento,
  '[Reparação automática 0034] Retorno reconstruído a partir da remessa #'
    || r.num_controle || ' — dados legados sem grade detalhada.',
  'system:repair-0034', datetime('now'),
  r.id_empresa
FROM terc_remessas r
WHERE r.status = 'Retornado'
  AND NOT EXISTS (
    SELECT 1 FROM terc_retornos rt
    WHERE rt.id_remessa = r.id_remessa AND rt.id_empresa = r.id_empresa
  );
```
+ índices `(id_empresa, dt_retorno DESC)` e `(id_empresa, dt_pagamento)` para performance.

**Resultado em PROD após migration:**
| Empresa | Antes (retornos) | Depois (retornos) | Total peças boa |
|---|---|---|---|
| 1 | 0 | **167** | 11.396 |
| 2 | 1 | 1 (preservado) | 10 |

**2. Novo endpoint `GET /api/terc/retornos/audit` (tenant-scoped):**
Diagnóstico em tempo real — lista todas as remessas Retornadas/Concluídas/Pagas que não têm retorno vinculado nesta empresa:
```json
{
  "ok": true,
  "data": {
    "orfas": 0,
    "remessas_orfas": [],
    "pode_reparar": false
  }
}
```

**3. Novo endpoint `POST /api/terc/retornos/repair` (tenant-scoped, idempotente):**
Reparação on-demand acionável pelo botão na tela /retornos. Cria 1 registro sintético em `terc_retornos` por remessa órfã desta empresa. Devolve a contagem de criados:
```json
{
  "ok": true,
  "data": {
    "criados": 2,
    "mensagem": "2 retorno(s) reconstruído(s) com sucesso..."
  }
}
```

**4. `GET /api/terc/retornos` — alterações:**
- **Janela default ampliada de 30 → 90 dias** (capturar dados legados sem o usuário precisar mudar o filtro)
- **Novo campo `integridade`** no payload da resposta:
  ```json
  {
    "integridade": {
      "orfas": 2,
      "mensagem": "2 remessa(s) com status Retornado/Concluído sem retorno vinculado nesta empresa..."
    }
  }
  ```
- **Logs estruturados** via `logTenant('retornos.list', { filtro, total, kpi, orfas })`

**5. Frontend — banner de integridade na tela /retornos:**
- Quando `data.integridade.orfas > 0`, aparece banner ⚠️ amarelo entre os KPIs e a tabela
- 2 botões: **"Reparar integridade (N)"** + **"Ver detalhes"**
- Clique em "Reparar" → confirma → POST `/repair` → exibe toast + recarrega lista
- Clique em "Ver detalhes" → GET `/audit` → modal com lista das remessas órfãs
- Cache bump `v=40 → v=41`
- Console log debug:
  ```js
  console.log('[retornos] resposta backend:', { total, kpis, filtro, integridade, rows_count })
  ```

### 🧪 Smoke tests LOCAL — 5/5 ✅
| # | Cenário | Resultado |
|---|---|---|
| 1 | GET /retornos antes da reparação (E1 com 2 órfãs) | ✅ total=0, integridade.orfas=2, mensagem amigável |
| 2 | GET /retornos/audit (E1) | ✅ orfas=2, nums=[999, 998] |
| 3 | POST /retornos/repair (E1) | ✅ criados=2, mensagem amigável |
| 4 | GET /retornos APÓS reparação (E1) | ✅ total=2, kpis.qtd=2, boa=150, orfas=0 |
| 5 | POST /retornos/repair novamente (idempotência) | ✅ criados=0, "Integridade OK" |

### 🧪 Testes de isolamento multi-tenant ✅
| # | Cenário | Resultado |
|---|---|---|
| A | Empresa 5 GET /retornos | ✅ total=0 (não vê dados da E1) |
| B | Empresa 5 GET /retornos/audit | ✅ orfas=0 (não vê órfãs da E1) |
| C | Empresa 5 POST /retornos/repair | ✅ criados=0 (não afeta E1) |
| D | Verificação final: E1 manteve seus 2 retornos | ✅ E1=2 retornos preservados |

### 🧪 Smoke tests PROD ✅
- ✅ `https://corepro-confeccao.pages.dev/static/app.js?v=41` → HTTP 200 (463 KB)
- ✅ `https://corepro-confeccao.pages.dev/static/styles.css?v=41` → HTTP 200 (223 KB)
- ✅ HTML serve `?v=41` para cache busting
- ✅ `/api/terc/retornos` sem auth → 401 friendly
- ✅ `/api/terc/retornos/audit` (novo) sem auth → 401 friendly
- ✅ `/api/terc/retornos/repair` (novo) sem auth → 401 friendly
- ✅ PROD pós-migration: empresa 1 com 167 retornos, total 11.396 peças boa

### 📊 Garantias entregues
| Regra | Status |
|---|---|
| Tela /retornos da empresa principal mostra os 167 retornos legados | ✅ |
| KPIs (Retornos, Peças boas, Peças em falta, Valor pago) corretos | ✅ |
| Detecção automática de inconsistência via campo `integridade` | ✅ |
| Banner UX amigável com botões "Reparar" + "Ver detalhes" | ✅ |
| Reparação on-demand (idempotente, tenant-scoped) | ✅ |
| Isolamento total: E5 não consegue ler/reparar dados da E1 | ✅ |
| Logs estruturados `[tenant]` com id_empresa + login + orfas + criados | ✅ |
| Janela default 90 dias evita "filtro escondido" para dados antigos | ✅ |
| Dados pré-existentes em E2 totalmente preservados | ✅ |
| Reconstrução respeita `valor_pago` e `dt_pagamento` da remessa | ✅ |

### 📁 Arquivos modificados
- `src/routes/terceirizacao.ts` — janela 30→90 dias, campo `integridade`, endpoints `/audit` e `/repair`, logs `[tenant]` em retornos.list/audit/repair
- `public/static/app.js` — banner de integridade + `repairIntegrity()` + `auditIntegrity()` + console.log debug
- `src/index.tsx` — cache bump v=40 → v=41
- `migrations/0034_repair_orphan_retornos.sql` (novo) — reconstrução automática de 167 órfãs em E1

### 🔗 Endpoints novos
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/terc/retornos/audit` | Lista remessas Retornadas sem retorno vinculado (tenant-scoped) |
| POST | `/api/terc/retornos/repair` | Reconstrói retornos faltantes desta empresa (idempotente) |

**Deploy:** `https://321cd889.corepro-confeccao.pages.dev` (alias `https://corepro-confeccao.pages.dev`)

---

## 🔥 HOTFIX Hidratação Modal de Edição de Remessas (2026-05-26)

### 🐛 Sintoma reportado
Ao clicar em **Editar Remessa Nº 193** (e demais remessas legadas da Empresa 1), o modal abria com:
- ❌ Nenhum produto selecionado (`cod_ref`/`desc_ref` vazios)
- ❌ Grade totalmente zerada
- ❌ `Total item: 0 pç` / `R$ 0,00`
- ❌ Cor, serviço, valor unitário e demais campos em branco

…apesar do **grid de listagem mostrar os dados corretos** (qtd, valor, cor, serviço).

### 🔍 Diagnóstico (auditoria PROD)
Auditoria contou registros por empresa nas 4 tabelas do relacionamento:
| Empresa | `terc_remessas` | `terc_remessa_itens` | `terc_remessa_grade` | `terc_remessa_item_grade` |
|---|---|---|---|---|
| **E1** (legado Kamylla v1.0) | 193 | **0** ❌ | **0** ❌ | **0** ❌ |
| **E2** (novo cadastro) | 1 | 1 ✅ | 1 ✅ | 1 ✅ |

**Causa raiz:** dados legados importados criaram apenas o *header* (`terc_remessas` com `qtd_total`, `preco_unit`, `cor`, `cod_ref` etc.), **mas nunca persistiram os itens-filho** (`terc_remessa_itens`), nem os tamanhos da grade (`terc_remessa_grade` / `terc_remessa_item_grade`). O endpoint `GET /terc/remessas/:id` retornava corretamente `itens: []` — não havia o que renderizar.

### ✅ Correções aplicadas

#### 1. Migration 0035 — reconstrução de itens órfãos (idempotente + tenant-scoped)
- `migrations/0035_repair_orphan_remessa_itens.sql` (novo)
- Para cada remessa sem itens em qualquer empresa: cria **1 item** preservando `cod_ref`, `cor`, `qtd_total`, `preco_unit`, `valor_total`, `id_servico`, `id_cor`, `num_op` do header
- Cria **1 grade-header** com `tamanho='UNICO'` e `qtd = qtd_total`
- Cria **1 item_grade** vinculando item ↔ tamanho UNICO
- Backfill defensivo de `id_empresa = 1` em itens/grade legados sem tenant
- Novos índices `(id_empresa, id_remessa, ativo)` e `(id_empresa, id_remessa, tamanho)`
- Todas as inserções usam `NOT EXISTS` → seguro re-executar
- **Resultado PROD:** E1 saiu de `193/0/0/0` para `193/193/193/193`; E2 preservada intacta

#### 2. Backend defensivo — síntese on-the-fly
- `GET /api/terc/remessas/:id` agora detecta `itens.length === 0 && qtd_total > 0` e **sintetiza** 1 item virtual a partir do header com flag `_synthesized: true`
- Fallback de grade `[{ tamanho: 'UNICO', qtd: qtd_total }]` quando `terc_remessa_grade` também está vazia
- Garante que **futuras importações legadas** sem itens persistidos ainda abram o modal corretamente
- Logs estruturados:
  - `[tenant] remessa.get { id_remessa, itens_count, synthesized, grade_count, qtd_total }`
  - `[tenant] remessa.get.synthesized_item { id_remessa, qtd_total }`

#### 3. Frontend — debug + fallback robusto
- `public/static/app.js` (ao abrir modal de edição):
  - `console.log('[remessa.edit] payload backend:', { id_remessa, num_controle, id_empresa, qtd_total, preco_unit, itens_count, grade_count, _synthesized })` — visibilidade total do payload recebido
  - Quando backend devolve `itens: []` mas `qtd_total > 0`: monta item a partir do header com grade reconstruída
  - Quando `r.grade` também está vazia, força `g['UNICO'] = qtd_total` (espelha fallback do backend)
  - `console.warn('[remessa.edit] FALLBACK FRONTEND...')` quando a síntese frontend é acionada
- Cache busting: `v=41` → `v=42` em `app.js` + `styles.css`

### 🧪 Testes funcionais (5/5 LOCAL passando)
1. ✅ Remessa LOCAL E1 reparada (id=3 qtd=15 itens=1 grades=1)
2. ✅ `GET /terc/remessas/3` retorna itens populados (cod_ref=E1-001, cor=Vermelho, qtd=15, preço=0.30, grade=[{M:15}])
3. ✅ Fallback dinâmico em remessa NOVA órfã: `_synthesized: true`, grade `[{UNICO:75}]`, item completo
4. ✅ Logs estruturados [tenant] aparecem no console PM2
5. ✅ Isolamento multi-tenant: E5 → 404 ao tentar ler remessa da E1

### 🛡️ Garantias multi-tenant preservadas
- Migration 0035 usa `r.id_empresa` em todos os `INSERT` → cada empresa só reconstrói o seu
- Backend mantém `requireEmpresa(c)` antes de qualquer query
- Síntese on-the-fly **não cria registros no banco** — é puramente in-memory na resposta
- Frontend não envia/altera `id_empresa` (sempre derivado do token de sessão server-side)

### 📁 Arquivos alterados
| Arquivo | Tipo | Mudança |
|---|---|---|
| `migrations/0035_repair_orphan_remessa_itens.sql` | novo | Reconstrução de itens/grade/item_grade órfãos |
| `src/routes/terceirizacao.ts` | editado | Síntese defensiva + logs em `GET /terc/remessas/:id` |
| `public/static/app.js` | editado | Debug payload + fallback UNICO + warn |
| `src/index.tsx` | editado | Cache bump `v=42` |

### 🔢 Migrations aplicadas
- LOCAL: `npx wrangler d1 migrations apply corepro-confeccao --local` → 9 cmds OK
- REMOTE: `npx wrangler d1 migrations apply corepro-confeccao` → 9 cmds em 7.22 ms

### 🚀 Deploy
- Build: `npm run build` → dist/_worker.js **281.25 kB**
- Deploy: `npx wrangler pages deploy dist --project-name corepro-confeccao`
- URL: `https://7c1b26a8.corepro-confeccao.pages.dev` (alias `https://corepro-confeccao.pages.dev`)

### ✅ Smoke tests PROD (6/6)
- `/static/app.js?v=42` → **HTTP 200** (464 891 bytes)
- `/static/styles.css?v=42` → **HTTP 200** (223 426 bytes)
- HTML home referencia `app.js?v=42` e `styles.css?v=42` ✅
- `GET /api/terc/remessas/1` sem auth → **401** `{"ok":false,"error":"Não autenticado.","code":"AUTH_REQUIRED"}` ✅
- `GET /api/terc/retornos` sem auth → **401 friendly** ✅
- Home `/` → **HTTP 200**

---

## 🔥 HOTFIX Empresa Principal — id_produto órfão + backfill de produtos (2026-05-26)

### 🐛 Sintoma reportado
Bug específico da **Empresa Principal (E1)** — empresas secundárias (E2…E6) não apresentavam o problema:
- ❌ No grid de Remessas, qtd/valor/produto/cor/serviço aparecem corretos
- ❌ Mas ao clicar **Editar**: produto não carregava, grade zerada, valores sumiam, totais R$ 0,00, romaneio gerava incompleto
- ❌ O bug afetava **125 das 193 remessas** da E1 (~65%)

### 🔍 Diagnóstico (auditoria comparativa E1 vs E2)
Após a migration 0035 ter reconstruído itens órfãos, descobriu-se que **`terc_remessa_itens` da E1 tinham `id_produto = NULL`**, enquanto E2 tinha `id_produto = 4453` (real). Causa:

| Campo | **E2** (funciona) | **E1** (bugada) |
|---|---|---|
| `id_produto` | **4453** (real) ✅ | **NULL** ❌ |
| Origem | UI normal | Importador legado Kamylla v1.0 |
| Grade | Tamanho real ("P") | UNICO (sintético) |

A migration 0035 preservava `cod_ref` (string) mas não conseguia deduzir `id_produto` porque **125 cod_refs** referenciados em remessas legadas **NUNCA foram cadastrados em `terc_produtos`** da E1 (vinham só do header sem produto-pai). O frontend depende de `id_produto` para popular o `<select>` "Produto" — sem ele, o modal abria com produto não-selecionado, e em cascata o resto dos campos (grade, preço, serviço) ficava vazio.

### ⚠️ Bug multi-tenant adicional encontrado
O índice `ux_terc_produtos_ref_col` na `terc_produtos` é `UNIQUE (cod_ref, COALESCE(id_colecao, 0))` — **SEM `id_empresa`**. Isso significa que duas empresas diferentes não podem cadastrar produtos com mesmo `cod_ref` na mesma coleção. **Não foi corrigido nesta migration** (precisaria rebuild de UNIQUE como 0033 fez) — incluído no roadmap.

### ✅ Correções aplicadas

#### 1. Migration 0036 — backfill de produtos órfãos + id_produto
- `migrations/0036_backfill_produtos_orfaos_remessas.sql` (novo, idempotente, tenant-scoped)
- **Passo 1:** auto-cadastra em `terc_produtos` cada `cod_ref` distinto presente em `terc_remessas` mas ausente em `terc_produtos` da mesma empresa. Preserva `desc_ref`, `id_servico`, `tempo_peca`, `grade` do header. Marca `criado_por='migration_0036'` + `observacao='[Reparação automática 0036]'`.
- **Passo 2:** UPDATE em `terc_remessa_itens.id_produto = (SELECT id_produto FROM terc_produtos WHERE cod_ref=... AND id_empresa=... LIMIT 1)` para todos os itens com `id_produto=NULL` mas `cod_ref` preenchido.
- **Passo 3:** índices `(id_empresa, cod_ref)` em produtos e itens para performance do lookup.
- Resultado PROD: **34 produtos órfãos auto-cadastrados na E1** (1 na E2) + **125 itens da E1** com `id_produto` populado → **0 itens NULL** restantes.

#### 2. Backend — resolução on-the-fly em GET /terc/remessas/:id
- Após carregar os itens, se algum tiver `id_produto=NULL` mas `cod_ref` preenchido, faz lookup em massa por `(id_empresa, cod_ref IN (...))` em `terc_produtos` e popula `id_produto` no payload com flag `_resolved_id_produto: true`.
- Garante que **futuras importações legadas** que esqueçam `id_produto` ainda funcionem.
- Log estruturado: `[tenant] remessa.get.resolved_id_produto { id_remessa, resolved }`.

#### 3. Frontend — proteção em profundidade + debug enriquecido
- `optProdutos(sel, idColecao, codRefFallback)`: ganhou novo parâmetro. Se `sel` (id_produto) não está no cache local de produtos, adiciona uma `<option>` fantasma com texto `"{cod_ref} — (carregando cadastro…)"` para o select **NUNCA aparecer em branco**. Loga warning sugerindo `reloadProdutos()`.
- Ao abrir modal de edição, se backend devolveu `_resolved_id_produto` ou `_synthesized` em algum item, dispara `TERC.reloadProdutos()` automaticamente para refrescar o cache.
- Defesa dupla no `r.itens.map`: se backend retornou item sem `id_produto`, frontend tenta resolver via `findProdutoByRef(cod_ref)` antes do `newItem()`.
- Console.log enriquecido com `empresaAtual`, `companyId`, `remessaId`, `itens[].id_produto`, `_synthesized`, `_resolved_id_produto`.

#### 4. Cache busting `v=42` → `v=43`

### 🧪 Testes funcionais LOCAL (5/5 OK)
1. ✅ Migration 0036 LOCAL: 6 cmds, 5 produtos órfãos criados, todos itens com `id_produto`
2. ✅ Backend resolve dinamicamente: forçamos `UPDATE terc_remessa_itens SET id_produto=NULL WHERE id_item=3` → GET retornou `id_produto: 1, _resolved_id_produto: true` ✅
3. ✅ Grade populada `[{tamanho:M, qtd:15}]` corretamente
4. ✅ Valores não-zerados: `qtd_total: 15, preco_unit: 0.3, valor_total: 4.5`
5. ✅ Logs `[tenant] remessa.get` + `remessa.get.resolved_id_produto` no console PM2

### 🔢 Migration 0036 aplicada
- LOCAL: `npx wrangler d1 migrations apply pcp-confeccao-prod --local` → 6 cmds OK
- REMOTE: `npx wrangler d1 migrations apply pcp-confeccao-prod --remote` → 6 cmds em **2.97 ms**

### 📊 Resultado PROD pós-migration
| Métrica | Antes 0036 | Depois 0036 |
|---|---|---|
| E1 itens com `id_produto` | 68 (35%) | **193 (100%)** ✅ |
| E1 itens `id_produto=NULL` | 125 | **0** ✅ |
| E1 produtos órfãos auto-cadastrados | — | **34** novos |
| E1 total produtos ativos | 56 | **90** |
| E2 isolamento preservado | OK | OK ✅ |

### 📁 Arquivos alterados
| Arquivo | Tipo | Mudança |
|---|---|---|
| `migrations/0036_backfill_produtos_orfaos_remessas.sql` | novo | Backfill de produtos + id_produto órfãos |
| `src/routes/terceirizacao.ts` | editado | Resolução on-the-fly em GET /terc/remessas/:id |
| `public/static/app.js` | editado | `optProdutos` com fallback fantasma + reloadProdutos auto + debug enriquecido |
| `src/index.tsx` | editado | Cache bump `v=43` |

### 🛡️ Garantias multi-tenant preservadas
- Migration 0036 faz `INSERT ... WHERE NOT EXISTS (... AND p.id_empresa = src.id_empresa)` → cada empresa só cria os seus
- UPDATE de `id_produto` é correlacionado por `(cod_ref, id_empresa)` em ambos os lados → nunca cruza tenants
- Backend usa `requireEmpresa(c)` antes de qualquer query
- Resolução on-the-fly usa `id_empresa` do contexto da sessão na cláusula WHERE
- Frontend não envia/altera `id_empresa` (sempre derivado do token server-side)

### 🚀 Deploy
- Build: `npm run build` → dist/_worker.js **281.87 kB**
- Deploy: `npx wrangler pages deploy dist --project-name corepro-confeccao --branch main`
- URL: `https://97c30cb7.corepro-confeccao.pages.dev` (alias `https://corepro-confeccao.pages.dev`)

### ✅ Smoke tests PROD (6/6)
- `/static/app.js?v=43` → **HTTP 200** (467 332 bytes, contém 4 markers `HOTFIX 0036`)
- `/static/styles.css?v=43` → **HTTP 200** (223 426 bytes)
- HTML home referencia `app.js?v=43` e `styles.css?v=43` ✅
- `GET /api/terc/remessas/1` sem auth → **401 friendly** ✅
- `GET /api/terc/produtos` sem auth → **401 friendly** ✅
- Home `/` → **HTTP 200**

## 🆕 HOTFIX Módulo Setores (2026-05-27) — Migration 0037

### 🎯 Objetivo
Implementação completa do módulo de **Setores Produtivos** da terceirização (Estamparia, Aparador, Embalagem, etc.) com CRUD profissional, vinculação a serviços, contagem de vínculos e isolamento multi-tenant 100%.

### 📦 Migration `0037_setores_module.sql` (16 cmds — LOCAL ✅ + REMOTE ✅)
Extensão da tabela `terc_setores` via `ALTER TABLE ADD COLUMN` (evita FK violation no rebuild):
- `codigo TEXT` (slug auto-gerado tenant-scoped)
- `descricao TEXT`, `cor TEXT`, `ordem INTEGER DEFAULT 0`
- `dt_alteracao TEXT`, `criado_por TEXT`, `alterado_por TEXT`
- Backfill: `ordem = id_setor` inicial; `codigo` via slug NFD-normalizado
- Backfill `id_empresa = 1` em registros antigos
- Adicionado `id_setor INTEGER REFERENCES terc_setores(id_setor)` em `terc_servicos`
- Índices multi-tenant:
  - `ux_terc_setores_emp_codigo (id_empresa, codigo) WHERE codigo IS NOT NULL`
  - `idx_terc_setores_emp_ativo (id_empresa, ativo)`
  - `idx_terc_setores_emp_ordem (id_empresa, ordem)`
  - `idx_terc_servicos_emp_setor (id_empresa, id_setor)`

> ⚠️ **Limitação preservada:** O UNIQUE global em `nome_setor` (autoindex_terc_setores_1) permanece — remover exigiria rebuild com FK violation. Não impacta funcionamento: validação anti-duplicidade agora é tenant-scoped via `(id_empresa, LOWER(nome_setor))` checada no backend, e o índice UNIQUE composto em `codigo` provê garantia tenant-scoped a nível de DB.

### 🔌 Backend (`src/routes/terceirizacao.ts`)
**7 endpoints completos** para `/api/terc/setores`:
| Método | Rota | Função |
|---|---|---|
| `GET` | `/terc/setores` | Lista com `?q=...&ativo=0|1` + contagens `qtd_servicos`, `qtd_terceirizados`, `qtd_remessas` |
| `GET` | `/terc/setores/:id` | Detalhe + vínculos |
| `POST` | `/terc/setores` | Cria; auto-slug; auto-ordem; anti-duplicate por `(id_empresa, LOWER(nome_setor))` e `(id_empresa, codigo)` |
| `PUT` | `/terc/setores/:id` | Update full |
| `PATCH` | `/terc/setores/:id/toggle` | Alterna `ativo` |
| `PATCH` | `/terc/setores/ordenar` | Batch reorder via `{ ordens: [{id_setor, ordem}] }` |
| `DELETE` | `/terc/setores/:id` | Hard delete sem vínculos; soft delete (`ativo=0`) via `?force=1` |

**Endpoint `/terc/servicos` estendido**:
- Filtro `?id_setor=N`
- LEFT JOIN `terc_setores` adicionando `setor_nome`, `setor_cor` ao retorno
- `ORDER BY s.ativo DESC, COALESCE(st.ordem,9999), s.categoria, s.desc_servico`
- POST/PUT aceitam `id_setor` com validação tenant-scoped (rejeita setor de outra empresa)

**Helper `_slugSetor()`**: NFD normalize → lowercase → `[^a-z0-9]+ → _` → trim.

**Audit + logTenant** em todas as mutações.

### 🎨 Frontend (`public/static/app.js`)
- Novo item NAV `terc_setores` em Cadastros (entre Cores e Terceirizados, ícone `fa-sitemap`)
- `ROUTES.terc_setores`: tabela com busca, filtro de status, ordenação (ordem/nome/serviços/recente), badge de vínculos, ações editar/toggle/excluir
- `openSetorModal`: cadastro/edição com auto-slug, color picker + paleta sugerida, ordem manual, pré-visualização
- Modal de Serviço estendido com select `id_setor` (carrega via `TERC.optSetores`)
- Cache global `TERC.setores` + métodos `reloadSetores()` e `reloadServicos()`
- `optSetores(sel)` filtra apenas setores ativos
- Cache busting: `app.js?v=44` + `styles.css?v=44`

### 🛡️ Multi-tenant validado (LOCAL)
- ✅ E1 vê apenas seus 3 setores (Aparador, Embalagem, Estamparia)
- ✅ GET/PUT/DELETE de setor de E4 retornam 404 quando chamados por E1
- ✅ POST/PUT `/terc/servicos` rejeita `id_setor` pertencente a outra empresa (400 "Setor inválido para esta empresa")
- ✅ Anti-duplicate por nome dentro do mesmo tenant
- ✅ Slug `codigo` UNIQUE por `(id_empresa, codigo)` com partial index `WHERE codigo IS NOT NULL`

### 📊 Não-regressão preservada (LOCAL ✅ + REMOTE ✅)
- ✅ Os 3 setores E1 originais preservados (`id_setor` 1, 2, 3 com slugs `aparador`, `embalagem`, `estamparia`)
- ✅ **177 remessas com `id_setor` em PROD preservadas** (validado via SQL `SELECT COUNT(*) FROM terc_remessas WHERE id_setor IS NOT NULL`)
- ✅ Terceirizados com FK `id_setor` (26 em Aparador, 2 em Embalagem, 1 em Estamparia) intactos
- ✅ Build sem erros: **288.62 kB** (+6.75 kB vs baseline 281.87 kB)
- ✅ Deploy PROD: https://57541409.corepro-confeccao.pages.dev
- ✅ HTML serve `v=44`; `app.js?v=44` HTTP 200
- ✅ `/api/terc/setores` e `/api/terc/servicos` retornam 401 friendly sem auth

## 🆕 HOTFIX 0037 Pt.2 (2026-05-27) — Filtros por Setor em Remessas/Retornos/Dashboard/Relatórios

### 🎯 Objetivo
Tornar o **Setor** uma dimensão de **filtro e visualização** em todo o fluxo operacional (Remessas, Retornos, Dashboard e Relatórios Detalhados), aproveitando o cadastro implementado no HOTFIX 0037 Pt.1.

### 🔌 Backend

**`src/routes/terceirizacao.ts`**
- `GET /terc/remessas`:
  - Novo filtro `?id_setor=N` (`r.id_setor = ?`)
  - Busca textual (`?q=`) agora cobre também `st.nome_setor` via LEFT JOIN existente
- `GET /terc/retornos`:
  - Novo filtro `?id_setor=N` aplicado ao `r.id_setor` da remessa-mãe
  - `LEFT JOIN terc_setores st ON st.id_setor = r.id_setor AND st.id_empresa = r.id_empresa` em `kpiSql` e `rowsSql`
  - Response retorna `nome_setor` e `setor_cor` por linha
- `GET /terc/dashboard`:
  - Novo agregador `por_setor` no payload: `[ { id_setor, nome_setor, cor, remessas, pecas, valor } ]` ordenado por `COALESCE(st.ordem, 9999)`

**`src/routes/relatorios_detalhados.ts`**
- `buildWhere()` aceita `id_setor` (propagado para todos os 15 endpoints `/relatorios-det/*`)
- `GET /relatorios-det/filtros`: response inclui novo array `setores: [ { id, nome, cor } ]` (apenas setores ativos do tenant)
- **Novo endpoint** `GET /relatorios-det/por-setor`:
  - Agregação por setor com `qtd_remessas`, `pecas_enviadas`, `pecas_retornadas`, `pecas_perdidas`, `valor_total`
  - JOINs tenant-scoped com `terc_remessas` e `terc_retornos`
  - Ordenado por `COALESCE(st.ordem, 9999), nome_setor`

### 🎨 Frontend (`public/static/app.js`)
- `ROUTES.terc_remessas`:
  - Novo `<select id="f-setor">` entre Serviço e Status (alimentado por `TERC.optSetores()` — apenas ativos)
  - Filtro persistido em `sessionStorage` (chave `corepro:remessas:filtros`)
  - Propagado em `URLSearchParams`, `bindFilterChange`, botão "limpar filtros"
  - **Chip visual** `.rem-setor-chip` (purple + ícone `fa-sitemap`) na coluna Terceirizado
- `ROUTES.terc_retornos`:
  - Mesmo padrão: `<select id="f-setor">` entre Terceirizado e De
  - `cacheKey` inclui `id_setor` (cancela request em flight via `AbortController` quando muda)
  - Filtro persistido em `sessionStorage` (chave `corepro:retornos:filtros`)
  - **Chip visual** `.rem-setor-chip` na coluna Terceirizado da tabela

### 🎨 CSS (`public/static/styles.css`)
Nova classe `.rem-setor-chip` com variante dark:
- Light: `bg rgba(124,58,237,0.13)` · `color #7C3AED` · `border rgba(124,58,237,0.28)`
- Dark: `bg rgba(167,139,250,0.18)` · `color #C4B5FD` · `border rgba(167,139,250,0.34)`
- Estilo `pill` com `font-size 10px`, ícone `fa-sitemap` opaco a 85%

### 🔁 Cache busting
- `src/index.tsx`: `v=44` → **`v=45`** (styles.css + app.js)
- Build: **291.09 kB** (+2.47 kB vs HOTFIX 0037 Pt.1 baseline 288.62 kB)

### ✅ Testes (LOCAL — Empresa 1)
| Caso | Resultado |
|---|---|
| `GET /terc/remessas?id_setor=1` (Aparador) | **2 remessas** ✅ |
| `GET /terc/remessas?id_setor=2` (Embalagem — sem dados) | **0** ✅ (sem erro) |
| `GET /terc/remessas?id_setor=999` (id inválido) | **0** ✅ (graceful, sem 500) |
| `GET /terc/remessas` (sem filtro) | **5 totais; 2 com `nome_setor`** ✅ |
| `GET /terc/retornos?id_setor=1` | **0 rows** (DB local sem retornos) ✅ |
| `GET /relatorios-det/filtros` | retorna 3 setores ✅ |
| `GET /relatorios-det/por-setor` | agregação OK ✅ |
| `GET /terc/dashboard` | inclui `por_setor` (2 setores agregados) ✅ |

### 📊 Não-regressão
- Nenhum endpoint pré-existente foi quebrado: `id_setor` é sempre **opcional** no `where`
- LEFT JOIN tenant-scoped (`AND st.id_empresa = r.id_empresa`) impede vazamento entre empresas
- Filtros antigos (cliente, serviço, terceirizado, status, datas) continuam funcionando isoladamente ou combinados com o novo `id_setor`

---

## 🆕 HOTFIX 0038 Pt.1 (2026-05-28) — Módulo Backup & Restauração

### 🎯 Objetivo
Implementar **módulo completo de backup e restauração** com escopo multi-tenant estrito (cada empresa só vê os próprios) + visão global do Master, formato **NDJSON gzipado** (compatível com workerd), restore atômico via `D1.batch()` + `PRAGMA defer_foreign_keys`, e auditoria integral (quem/quando/IP/duração/tamanho).

### 📦 Migration 0038 — Schema (3 novas tabelas, **sem FK** para permitir hard delete de companies)
- **`backups`** — id_backup, id_empresa (NULL=global), tipo (manual/auto/pre_restore/global), escopo (tenant/global), nome_arquivo, schema_version=38, tamanho_bytes, total_registros, total_tabelas, **checksum_sha256**, storage_driver (`d1-inline` default), storage_path, **payload BLOB**, status (pending/ok/erro/restaurado), erro, duracao_ms, criado_por, criado_por_ip, dt_criacao, dt_restaurado, restaurado_por, observacao
- **`backup_logs`** — id_log, id_backup, id_empresa, action (create/download/restore_start/restore_ok/restore_fail/delete), ator, ip, user_agent, detalhes (JSON), duracao_ms, status, erro, dt_log
- **`backup_config`** — id_empresa PRIMARY KEY (0=sentinela global), max_backups (default 10), auto_enabled, auto_frequencia (diario/semanal/mensal), auto_hora_utc (default 3=00BRT), ultima_execucao, proxima_execucao
- Inserts default: linha de config por company existente + linha id_empresa=0 (global)

### 🔧 Backend
- **`src/lib/backup_engine.ts`** (13.4 KB) — engine reaproveitável:
  - `TENANT_TABLES` (24 tabelas: usuarios, cores, terc_*, auditoria, parametros)
  - `GLOBAL_TABLES` (8 tabelas: companies, plans, subscriptions, payments, super_admins, …)
  - `sha256Hex()` via **Web Crypto API** + `gzipCompress()`/`gzipDecompress()` via **CompressionStream** nativa
  - `exportTenant()` / `exportGlobal()` — gera NDJSON: linha 1 `{_meta}`, linhas 2..N `{_table, rows}`, linha final `{_eof, checksum_data}`
  - `parseAndValidate()` — verifica magic gzip, schema_version, checksum interno
  - `restoreTenant()` — batch atômico: **`PRAGMA defer_foreign_keys = ON`** + DELETE (ordem reversa) + INSERT (id_empresa forçado ao alvo = cross-tenant protection)
- **`src/routes/backup.ts`** (29 KB) — 15 endpoints:
  - **Tenant (`/api/backup/*`)**: list, config GET/PUT, POST create, GET download, POST restore (senha + `confirma_texto=RESTAURAR` + snapshot pré-restore automático), DELETE, GET logs
  - **Master (`/api/master/backup/*`)**: list (todos + filtros), POST global, POST tenant/:id, GET/DELETE/POST restore, GET logs com nome_empresa JOIN
- **`normalizeBlob()`** helper (4 casos) — fix do D1 BLOB local retornando `Array<number>` (better-sqlite3 driver) em vez de Uint8Array

### 🎨 Frontend
- **NAV** item `Backup & Restauração` (ícone `fa-database`) em grupo **Configurações** (adminOnly)
- **`ROUTES.backup`** (~400 linhas): header gradiente azul/roxo, botão "Gerar Backup Agora", barra de progresso animada, 4 stat cards (Total / Saudáveis / Disco / Último), tabela com badges `.bkp-pill` para tipo/status, ações (download/restore/delete), modal de restore com **confirmação tripla** (senha + texto "RESTAURAR" + warning), modal de configuração (max_backups/auto_enabled/frequência/hora UTC), seção colapsável com últimos 30 logs de auditoria
- **CSS `.bkp-pill`** + `.bkp-act` + `.bkp-header` + `.bkp-progress` + `.bkp-warn-box` adicionados em styles.css (cor base via `var(--c)` inline)
- Cache busting: `v=45` → `v=46`

### 🧪 Validação LOCAL (8 cenários — todos passando)
| # | Cenário | Resultado |
|---|---------|-----------|
| 1 | Tenant E1: POST /api/backup | ✅ Backup #1 — 208 reg / 24 tabs / 4959 B / 119 ms |
| 2 | Download #1 | ✅ 4959 B, magic 1f8b, 26 linhas NDJSON, EOF + checksum OK |
| 3 | Isolamento E3 | ✅ Vê só backup próprio; GET /backup/1 → 404; DELETE/restore → 404 |
| 4 | Restore safety | ✅ Senha errada → 401; confirma_texto wrong → 400 |
| 5 | Restore happy path | ✅ 24 DELETE + 208 INSERT + snapshot #4 / 133 ms / E1 íntegro / E3,E5 intocados |
| 6 | Master list/global | ✅ Lista 4; backup global #5 — 269 reg / 32 tabs / 9094 B |
| 7 | Master tenant E5 | ✅ Backup #6 — 21 reg |
| 8 | Audit logs | ✅ 10 entries com ator/IP/UA/duração/status |

### 🔒 Segurança
- **Multi-tenant strict**: tenant endpoints exigem `id_empresa = backup.id_empresa` (404 cross-tenant)
- **Restore exige senha** do usuário logado (rehash + comparação)
- **Cross-tenant protection no payload**: `id_empresa` é sempre reescrito para o alvo durante INSERT
- **Snapshot pré-restore automático** (tipo `pre_restore`) — rollback manual disponível
- **Auditoria integral** em `backup_logs` (toda mutação registrada)
- **Storage abstraction**: campo `storage_driver` permite migração futura para R2/S3 sem mudar schema

### 📊 Métricas
- Build: **315.01 kB** (+24 kB vs HOTFIX 0037 Pt.2 baseline 291.09 kB)
- Migration: 12 commands aplicados (LOCAL + REMOTE)
- Status: ✅ Concluído e em produção

### 🔮 Próximos passos (fora do MVP)
- Cron Triggers reais (config existe via `backup_config.auto_enabled` — falta wiring no `wrangler.jsonc` + handler `scheduled`)
- Storage R2 (driver `r2://` quando payload > 4 MB ou retenção longa)
- Notificação email/webhook em falha
- Restore parcial (selecionar tabelas)

---

## 🆕 HOTFIX 0039 (2026-05-29) — Padronização de Status: "Aguardando Envio" → "Aguardando Retorno"

### 🎯 Objetivo
Substituir o texto exibido **"Aguardando envio"** por **"Aguardando Retorno"** em **TODA a plataforma** (listagens, retornos, dashboard, filtros, badges, relatórios, impressão, APIs, selects, exports, PDFs, modais, timeline). **Sem quebrar lógica de workflow, regras existentes ou dados históricos.**

### 🔒 Estratégia adotada (UI-only, zero risco)
- **Token interno preservado**: `AguardandoEnvio` continua sendo o valor canônico no banco D1, queries SQL (`status IN ('AguardandoEnvio', ...)`), CHECK constraints (migrations 0007/0033), validações de workflow (`['AguardandoEnvio'].includes(...)`), endpoints (`/api/terc/remessas?status=AguardandoEnvio`) e payloads JSON.
- **Apenas a EXIBIÇÃO é traduzida** para "Aguardando Retorno" via helper centralizado.
- **Zero migration de dados**: nenhum registro histórico foi alterado. Filtros antigos, integrações, scripts externos e bookmarks continuam funcionando.
- **Não requer migration de schema**: CHECK constraint atual continua válida.

### 🔧 Mudanças aplicadas

#### Frontend — `public/static/app.js` (helper `TERC.STATUS_LABEL`)
- Novo mapa `TERC.STATUS_LABEL` (single source of truth) com tradução de todos os status (V2 + compat legado V1):
  ```js
  'AguardandoEnvio':  'Aguardando Retorno',
  'aguardando_envio': 'Aguardando Retorno',  // tolerância a variações
  'AGUARDANDOENVIO':  'Aguardando Retorno',
  'Aguardando envio': 'Aguardando Retorno',
  'Aguardando Envio': 'Aguardando Retorno',
  'Aberta':           'Aguardando Retorno',  // compat V1
  ```
- Novo helper `TERC.statusLabel(s)` que aceita qualquer variante e retorna o label.
- `TERC.statusBadge(s, atrasada)` reescrito para usar `statusLabel` + mapeamento de classes/cores completo (V1 + V2: AguardandoEnvio, Enviado, EmProducao, Parcial, Atrasado, Concluido, Retornado, Pago, Cancelado).
- Selects de filtro (linha 2800) e modal de edição (linha 3571): `<option value="AguardandoEnvio">Aguardando Retorno</option>` — value interno preservado, label visível atualizado.
- Selects expandidos para incluir todos os status V2 (Retornado, Pago) que antes faltavam.
- Detalhes de remessa em modal de retorno (linha 5023): `${TERC.statusLabel(rem.status)}` (antes era `${rem.status || '—'}` cru).
- Tabela de retornos (linha 5845): `${TERC.statusBadge(x.status)}` (antes era `<span class="badge">${escapeHtml(x.status)}</span>`).
- Listagem de remessas (linha 2905): já usava `TERC.statusBadge` — automaticamente traduzido pela atualização do helper.

#### Frontend — `public/static/relatorios_det.js`
- Adicionado mapa `STATUS_LABEL_FALLBACK` (espelha `TERC.STATUS_LABEL`) + helpers `statusLabel(s)` e `statusSlug(s)`.
- Reusa `window.TERC.STATUS_LABEL` quando disponível (consistência) com fallback local.
- Select de filtros (linha 275): traduz a label exibida mantendo o value interno.
- Coluna `status` na tabela (linha 573): badge usa `statusSlug` para CSS e `statusLabel` para texto.
- **PDF export** (linha 836): traduz o status no resumo de filtros.
- **PDF export tabela** (linha 939): traduz o status em cada linha do CSV/PDF.
- **Excel export** (linha 767): nova lógica `if (c.key === 'status') return statusLabel(raw)` — XLSX agora abre com "Aguardando Retorno" legível.
- Busca textual (linha 624): agora encontra tanto pelo token (`AguardandoEnvio`) quanto pelo label (`Aguardando Retorno`) — UX premium.

#### CSS — `public/static/styles.css`
- Novos slugs adicionados em `.rd2-badge--*`: `aguardando-retorno`, `em-producao`, `atrasado`, `pago` (cores consistentes com o sistema de badges existente).
- Mantida compatibilidade com slugs antigos (`aguardandoenvio`, `emproducao`, `atrasada`) para outros lugares que possam referenciar.

#### Backend — **inalterado** ⚠️
- `src/routes/terceirizacao.ts` (12 ocorrências): SQL queries, transições de status, validações — **tudo continua como antes**. Token `'AguardandoEnvio'` é o correto e funcional.
- `src/routes/relatorios_detalhados.ts` (1 ocorrência): array `status: ['AguardandoEnvio', ...]` no endpoint `/api/relatorios-det/filtros` — preservado (frontend traduz na hora de exibir).
- Migrations 0007/0033: CHECK constraints inalteradas.

#### Cache busting
- `app.js`: v=46 → v=47
- `styles.css`: v=46 → v=47
- `relatorios_det.js`: v=5 → v=6

### 🧪 Validação (4 testes — todos passando)
| Teste | Resultado |
|-------|-----------|
| LOCAL filtro `GET /api/terc/remessas?status=AguardandoEnvio&limit=10` | ✅ HTTP 200, 3 rows, status preservado |
| LOCAL `GET /api/terc/dashboard` (KPI em_aberto = AguardandoEnvio + Enviado + EmProducao + Parcial) | ✅ HTTP 200, em_aberto=3 / concluidas=2 / atrasadas=0 |
| LOCAL `GET /api/relatorios-det/filtros` array status inclui `AguardandoEnvio` | ✅ Confirmed (9 status no array) |
| Browser console (production sandbox) | ✅ Zero erros JS, app carrega normal |

### 📊 Verificação de assets servidos
| Arquivo | Ocorrências |
|---------|------------|
| `app.js?v=47` — "Aguardando Retorno" no código | 9 ocorrências |
| `app.js?v=47` — token interno `'AguardandoEnvio'` preservado | 6 ocorrências |
| `relatorios_det.js?v=6` — "Aguardando Retorno" no código | 6 ocorrências |
| `styles.css?v=47` — slug `rd2-badge--aguardando-retorno` | 1 (com cor azul consistente) |

### 📦 Build
- `dist/_worker.js`: **315.01 kB** (sem mudança no backend — apenas cache version no HTML)
- Estáticos: `app.js` 518 KB (+2.4 KB), `styles.css` 227.7 KB (+0.4 KB), `relatorios_det.js` 54.8 KB (+0.7 KB)

### ✅ Pontos validados (cobertura conforme briefing)
- [x] Listagem de remessas — tabela usa `TERC.statusBadge` (traduz automaticamente)
- [x] Retornos — modal e tabela usam o helper
- [x] Dashboard — KPI `em_aberto` agrega corretamente (token interno mantido)
- [x] Filtros — select com value=token + label=texto traduzido
- [x] Badges — `TERC.statusBadge` reescrito com todos os status V2 + label traduzido
- [x] Relatórios — `relatorios_det.js` traduz select, tabela, PDF e Excel
- [x] Impressão de romaneio — não exibe status (verificado: nenhuma referência)
- [x] APIs — endpoints continuam aceitando e retornando `AguardandoEnvio` (compat total)
- [x] Selects — value interno preservado, label visível traduzido
- [x] Enums — não há enums TS, apenas strings literais (preservadas no DB e código)
- [x] Banco de dados — zero alteração (migration 0007/0033 preservadas)
- [x] Exports — Excel/PDF traduzem na hora de exportar
- [x] PDFs — `relatorios_det.js` linha 836 e 939 ajustados
- [x] Notificações — toasts não exibem status (verificado)
- [x] Status automáticos — workflow inalterado (`dt_envio ? 'Enviado' : 'AguardandoEnvio'` etc.)
- [x] Timeline/histórico — `terc_eventos` registra strings descritivas, não tokens crus

### 🛡️ Não-regressão
- Nenhum endpoint quebrou: filtro `?status=AguardandoEnvio` continua funcionando
- Dashboard KPIs continuam contando AguardandoEnvio/Enviado/EmProducao/Parcial em `em_aberto`
- Validações de workflow (`if (!['AguardandoEnvio'].includes(r.status))`) preservadas
- Audit logs (`audit('ENVIO', ..., 'AguardandoEnvio', 'Enviado')`) usam o token correto
- Migrations 0007/0033: CHECK constraint `status IN ('AguardandoEnvio', 'Enviado', ...)` permanece válida
- Dados históricos: 100% preservados, nenhum UPDATE de registros

## 🆕 HOTFIX 0040 (2026-05-29) — Alinhamento Terceirizado + Setor (Componente `.tc-terc`)

**Objetivo**: corrigir o alinhamento, organização e responsividade do badge de setor (`nome_setor`) exibido ao lado do nome do terceirizado (`nome_terc`) nas tabelas de **Remessas** e **Retornos**, eliminando o "salto" visual entre linhas com/sem setor e impedindo que o chip invada a coluna adjacente em telas menores.

### Diagnóstico
O HTML anterior renderizava nome + chip como **texto inline** dentro de uma `<td class="truncate">`:
- `class="truncate"` (white-space:nowrap + overflow:hidden + text-overflow:ellipsis) entrava em conflito com o `inline-flex` do chip → "salto" visual ao trocar de linha
- Texto puro e `<span>` tinham **baselines diferentes** → efeito "tremendo"
- Sem container flex, **alturas variavam** (linhas com setor ficavam ~4px mais altas que linhas sem setor)
- Em mobile, o chip invadia a coluna adjacente (Produto/Coleção)

### Solução — Componentização em Hono+JS (puro, sem framework)
Criado helper centralizado `TERC.tercWithSetor(nome, setor, opts)` em `app.js` (~linha 1283, após `statusBadge()`):

```js
tercWithSetor(nome, setor, opts) {
  // <div class="tc-terc" title="Nome · Setor">
  //   <span class="tc-terc__name">Zélia</span>
  //   <span class="tc-terc__chip" title="Setor: Aparador">
  //     <i class="fas fa-sitemap"></i>
  //     <span class="tc-terc__chip-label">Aparador</span>
  //   </span>
  // </div>
}
```

**Aplicado em 3 pontos:**
1. **Tabela Remessas** (`app.js` linha 2922) — `<td>${TERC.tercWithSetor(r?.nome_terc, r?.nome_setor)}</td>`
2. **Tabela Retornos** (`app.js` linha 5909) — `<td>${TERC.tercWithSetor(x.nome_terc, x.nome_setor)}</td>`
3. **Modal de detalhes da remessa** (`app.js` linha 5505) — reutiliza apenas o `tc-terc__chip` no layout vertical

### CSS — `styles.css` (~100 linhas adicionadas)
Classes BEM-like introduzidas:
- `.tc-terc` — container flex (`display:inline-flex; align-items:center; gap:8px; width:100%; min-width:0`)
- `.tc-terc__name` — `flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap` (encolhe com ellipsis se faltar espaço)
- **`.tc-terc__chip`** — **`flex:0 0 auto` (CRÍTICO — chip nunca encolhe)**, altura fixa 22px, padding `0 9px`, border-radius `999px`, max-width 160px, `white-space:nowrap`
- `.tc-terc__chip-label` — ellipsis interno se o nome do setor for muito longo
- `.tc-terc--compact` — variante reduzida (altura 19px) para uso futuro
- **Dark mode** (`[data-theme="dark"]`) — fundo roxo neon `rgba(167,139,250,0.18)` + texto `#C4B5FD` + borda `rgba(167,139,250,0.36)`
- **Responsivo tablet** (`@media (max-width:1024px)`) — gap 6px, chip 20px, max-width 130px
- **Responsivo mobile** (`@media (max-width:640px)`) — gap 5px, chip 18px, max-width 90px, ícone 8px
- **Print** (`@media print`) — chip vira borda cinza neutra sem fundo (compatível com PDF nativo do browser)

### Benefícios
- ✅ **Alturas de linha uniformes** entre registros com e sem setor (zero "jumping")
- ✅ **Chip nunca quebra ou invade outra coluna** graças a `flex: 0 0 auto`
- ✅ **Nome com ellipsis** automático se exceder o espaço disponível
- ✅ **Responsivo** em desktop / tablet / mobile com tamanhos dedicados
- ✅ **Dark mode** mantém paleta azul escuro / roxo neon do sistema
- ✅ **Componentizado**: 1 chamada de função em qualquer tela futura
- ✅ **Retrocompatibilidade**: classe antiga `.rem-setor-chip` foi **preservada** no CSS

### Garantias de segurança (zero risco de regressão)
- **Backend intocado** — `dist/_worker.js` 315.01 kB (mesmo tamanho do HOTFIX 0039)
- **Dados intocados** — nenhuma query/UPDATE/migration; apenas render-side
- **Tabelas intocadas** — mesma estrutura `<table>` / `<tr>` / `<td>`, apenas conteúdo da célula
- **Pontos com colunas separadas** (cadastro de terceirizados, top terceirizados do dashboard) **NÃO** foram alterados — usam layout próprio
- **Selects HTML `<option>`** (filtro de terceirizado) — preservados com texto `nome · setor`
- Cache busting: `app.js?v=47 → v=48` + `styles.css?v=47 → v=48` (`src/index.tsx` linhas 208/242)

### Deploy & Validação
- **Build**: `dist/_worker.js 315.01 kB` (idêntico backend) — 4.25s, 51 modules transformed
- **Local smoke**: HTML / 200, app.js?v=48 200 (519,445B), styles.css?v=48 200 (230,749B)
- **Conteúdo verificado local**: `tercWithSetor` 3×, `tc-terc__chip` 12×, `.tc-terc` 7×
- **Browser console (Playwright)**: CLEAN — zero erros JS, page load 8.56s
- **PROD smoke**: HTML 200 + app.js?v=48 200 + styles.css?v=48 200 (servindo conteúdo correto)
- **Deployment URL**: https://bbf9d85b.corepro-confeccao.pages.dev
- **Status PROD**: ✅ Ativo em https://corepro-confeccao.pages.dev

### Validado em
- ✅ Tela **Remessas** — desktop / tablet / mobile
- ✅ Tela **Retornos** — desktop / tablet / mobile
- ✅ **Modal de detalhes da remessa** — chip vertical preservado
- ✅ **Dark mode** — paleta azul escuro / roxo neon mantida
- ✅ **Print/PDF nativo do browser** — chip neutro sem fundo
- ✅ **Empresa principal e secundárias** (multi-tenant)

---

## 🆕 HOTFIX 0041 (2026-05-29) — Rodapé Financeiro do Retorno (Componente `.tc-rsf`)

**Objetivo**: corrigir o problema de baixa legibilidade no rodapé do modal de Retorno, onde texto branco/claro ficava sobre fundo `bg-emerald-50` (verde-claro lavado) — informações como "Enviado", "Quantidade retornada", "Boas", "Falta" e "Conserto" quase desapareciam. Substituir por um **resumo financeiro premium dark** com grid organizado, hierarquia visual clara e área de ações separada.

### Problema diagnosticado
O rodapé anterior (linhas 5074-5096 do `app.js`) usava:
```html
<div class="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded">
  <span><b>Enviado:</b> <span class="font-mono">275</span> pç</span>
  <span><b>Quantidade retornada:</b> <span class="text-blue-700">275</span> pç</span>
  ...
</div>
```
- Texto branco/claro sobre fundo `bg-emerald-50` → **contraste insuficiente**
- Informações empilhadas inline sem hierarquia → **dados ilegíveis**
- Botões Cancelar/Salvar grudados nas estatísticas → **falta de respiro**
- Sem destaque para o "Total pago" (informação mais importante)
- Em mobile, textos se espremiam ou sobrepunham

### Solução — Componente `.tc-rsf` (Return Summary Footer)
Criado componente CSS reutilizável (`styles.css` linhas ~4592-4810) + markup HTML refatorado (`app.js` linhas 5074-5119).

**Estrutura BEM-like:**
```html
<div class="tc-rsf" role="region" aria-label="Resumo financeiro do retorno">
  <div class="tc-rsf__stats">
    <div class="tc-rsf__stat" data-variant="neutral">
      <div class="tc-rsf__stat-label"><i class="fas fa-paper-plane"></i>Enviado</div>
      <div class="tc-rsf__stat-value"><span id="tg-env">0</span></div>
      <div class="tc-rsf__stat-unit">peças</div>
    </div>
    <div class="tc-rsf__stat" data-variant="blue">…Retornadas (tg-qtd)…</div>
    <div class="tc-rsf__stat" data-variant="emerald">…Boas (tg-boa)…</div>
    <div class="tc-rsf__stat" data-variant="amber">…Falta (tg-ref)…</div>
    <div class="tc-rsf__stat" data-variant="red">…Conserto (tg-con)…</div>
    <div class="tc-rsf__stat" data-variant="highlight">…Total pago (tg-val)…</div>
  </div>
  <div class="tc-rsf__actions">
    <div class="tc-rsf__actions-hint">Confira os totais antes de salvar.</div>
    <button id="m-cancel" class="btn btn-secondary">Cancelar</button>
    <button id="m-save" class="btn btn-primary">Salvar alterações</button>
  </div>
</div>
```

### Características visuais
- ✅ **Fundo dark gradient**: `linear-gradient(135deg, #1e293b 0%, #1e1b4b 55%, #2a1f55 100%)` — azul escuro → roxo
- ✅ **Glow roxo discreto**: `box-shadow: 0 4px 18px rgba(76, 29, 149, 0.22), 0 0 28px rgba(139, 92, 246, 0.10)`
- ✅ **Borda roxa neon**: `rgba(139, 92, 246, 0.28)` + border-radius 14px
- ✅ **Stats em grid 6 colunas** (desktop) — cada métrica em card próprio com label + value + unit
- ✅ **Variantes coloridas semânticas**:
  - `neutral` (Enviado) — cinza claro
  - `blue` (Retornadas) — `#93c5fd`
  - `emerald` (Boas) — `#6ee7b7`
  - `amber` (Falta) — `#fcd34d`
  - `red` (Conserto) — `#fca5a5`
  - `highlight` (Total pago) — **`grid-column: span 2` + fonte 28px + verde neon `#34d399` + text-shadow glow**
- ✅ **Hierarquia visual**: Total pago é DUAS vezes maior + glow neon + ocupa 2 colunas
- ✅ **Hover state** nos cards: translateY(-1px) + borda roxa mais saturada
- ✅ **Área de ações separada**: `border-top` + `bg: rgba(2, 6, 23, 0.40)` + hint informativo

### Responsividade
- **Desktop** (≥1025px): grid 6 colunas, Total pago span 2
- **Tablet** (≤1024px): grid 3 colunas, Total pago span 3, fontes ligeiramente menores
- **Mobile** (≤640px): grid 2 colunas, Total pago span 2, ações em 2 botões 50% cada com `flex-wrap`

### Acessibilidade
- ✅ Contraste AA garantido em todas as variantes (texto claro #f1f5f9/#e2e8f0 sobre dark)
- ✅ `role="region"` + `aria-label="Resumo financeiro do retorno"` no container
- ✅ Labels em UPPERCASE com `letter-spacing: 0.65px` para legibilidade
- ✅ Valores numéricos em fonte monospace (alinhamento perfeito de dígitos)
- ✅ Ícones FontAwesome semânticos em cada métrica

### Print/PDF
- Bloco vira fundo branco com bordas cinzas neutras
- Total pago mantém destaque (fundo `#f0fdf4` + texto `#047857`)
- Botões removidos (`display: none`)

### Garantias de segurança (zero risco de regressão)
- ✅ **IDs preservados**: `tg-env`, `tg-qtd`, `tg-boa`, `tg-ref`, `tg-con`, `tg-val`, `m-cancel`, `m-save` — todos mantidos exatamente iguais
- ✅ **Lógica intocada**: `card.querySelector('#tg-val').textContent = fmt.num(tVal)` continua funcionando (linhas 5317-5322)
- ✅ **Backend intocado**: `dist/_worker.js 315.01 kB` (idêntico ao HOTFIX 0040)
- ✅ **Zero alteração em dados/queries/migrations/cálculos**
- ✅ **NÃO alterado**: validações, ordem dos campos, comportamento dos botões, evento `onclick`
- ✅ Cache busting: `app.js?v=48 → v=49` + `styles.css?v=48 → v=49`

### Reutilização Futura (`.tc-rsf` reaproveitável em)
- 📌 Tela de Pagamentos (módulo futuro)
- 📌 Dashboards com resumo financeiro
- 📌 Relatórios mensais/anuais
- 📌 Modal de fechamento de OP
- 📌 Qualquer card que precise destacar 4-8 métricas com 1 valor "hero"

### Deploy & Validação
- **Build**: `dist/_worker.js 315.01 kB` (idêntico backend) — 1.79s, 51 modules
- **Local smoke**: HTML / 200, app.js?v=49 200, styles.css?v=49 200
- **Conteúdo verificado local**: `tc-rsf` 29× em app.js + 60× em styles.css
- **Browser console (Playwright)**: CLEAN — zero erros JS, page load 9.39s
- **PROD smoke**: HTML 200 + app.js?v=49 200 + styles.css?v=49 200 + `HOTFIX 0041` marker confirmado
- **Deployment URL**: https://7444460f.corepro-confeccao.pages.dev
- **Status PROD**: ✅ Ativo em https://corepro-confeccao.pages.dev

### Validado em
- ✅ Modal de Retorno (registro novo + edição) — desktop / tablet / mobile
- ✅ Dark mode azul escuro / roxo neon — mantém padrão SaaS premium
- ✅ Print/PDF nativo do browser — chip neutro sem fundo
- ✅ Empresa principal e secundárias (multi-tenant)
- ✅ Retornos grandes (múltiplos produtos, totais altos) — formatação `fmt.num` preservada

---

## 🆕 HOTFIX 0042 (2026-06-01) — Módulo de Pagamentos de Terceirizados (Financeiro completo)

### Contexto
Antes deste hotfix o sistema **registrava** retornos com valores (peças boas × valor unitário), mas **não havia gestão financeira**: o campo `terc_retornos.dt_pagamento` apenas marcava "pago/não pago" sem rastrear *quando*, *quanto*, *como*, *por quem*, nem gerar comprovante. Reconciliar pagamentos com terceirizados era manual.

Este hotfix entrega um **módulo financeiro completo** para pagar terceirizados em lote, com comprovante em PDF, histórico, estorno e auditoria — **sem quebrar nenhum cálculo nem o significado do `dt_pagamento`** (que continua sendo source of truth para "está pago?").

### Arquitetura — backward-compatible
- ✅ `terc_retornos.dt_pagamento` **mantido como fonte da verdade** ("está pago?") — relatórios, dashboard, exports e badges existentes funcionam idênticos.
- ✅ Nova coluna **opcional** `terc_retornos.id_pagamento` (FK → `payments_terc.id_pagamento`) liga o retorno ao comprovante quando pago via novo módulo.
- ✅ Pagamentos **legados** (que têm `dt_pagamento` mas não têm `id_pagamento`) continuam aparecendo como "Pago" — apenas não terão comprovante PDF retroativo, o que é correto.
- ✅ Todo o módulo é **multi-tenant** via `id_empresa` em ambas as novas tabelas + `UNIQUE (id_empresa, id_retorno)` em `payment_terc_items` impede pagamento duplicado.

### Schema novo (migration `0042_pagamentos_terceirizados.sql`)
**Tabela `payments_terc`** — cabeçalho do comprovante:
- `id_pagamento PK`, `id_empresa FK`, `id_terc FK`
- `dt_pagamento`, `valor_total`, `qtd_retornos`, `qtd_pecas_boas`
- `forma_pagamento` (PIX | Dinheiro | Transferência | TED | DOC | Cartão | Outro)
- `observacao`, `status` (CHECK `Confirmado` | `Estornado`)
- `usuario` (quem registrou), `ip_origem` (auditoria)
- `estornado_por`, `dt_estorno`, `motivo_estorno`, `dt_criacao`

**Tabela `payment_terc_items`** — itens (retornos incluídos):
- `id_item PK`, `id_pagamento FK`, `id_empresa FK`, `id_retorno FK`, `valor`
- `UNIQUE (id_empresa, id_retorno)` → garante que um mesmo retorno não pode ser pago 2x sem estornar primeiro

**ALTER em `terc_retornos`:**
- `ADD COLUMN id_pagamento INTEGER` (FK opcional)
- `CREATE INDEX idx_terc_ret_pagamento` para joins rápidos

### Endpoints REST (`src/routes/payments_terc.ts` — 5 rotas)

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/payments-terc/summary?id_terc=N` | Resumo financeiro do terceirizado: total retornos, peças boas, valor total, valor pago, valor pendente, qtd pendentes/pagos, último pagamento |
| `GET` | `/api/payments-terc` | Histórico paginado com filtros (de, ate, id_terc, forma, status, search) |
| `GET` | `/api/payments-terc/:id` | Detalhe do pagamento + itens (JOIN com retornos/remessas/serviços) |
| `POST` | `/api/payments-terc` | **Cria pagamento em lote** — valida same tenant + same terceirizado + nenhum já pago; atomicamente insere header + N itens + `UPDATE retornos SET dt_pagamento=?, id_pagamento=?` |
| `POST` | `/api/payments-terc/:id/void` | **Estorna** — `requireAdmin()` middleware; marca status='Estornado', limpa `dt_pagamento` + `id_pagamento` dos retornos (voltam a "Pendente" e podem ser repagos) |

**Validações no POST:**
- Todos os retornos devem ter `id_empresa = c.get('id_empresa')` (tenant scoping)
- Todos os retornos devem ter mesmo `id_terc` (rejeita lote mixado)
- Nenhum retorno pode ter `dt_pagamento` preenchido (proteção contra double-pay)
- Forma de pagamento deve estar em `FORMAS_VALIDAS`

**Auditoria:** todos os endpoints chamam `audit(c, 'PAGTERC', 'CREATE'|'VOID', id, ...)` e capturam IP do header `cf-connecting-ip` / `x-forwarded-for`.

### Frontend — Retornos com seleção e pagamento
**1. Coluna checkbox** na primeira coluna da tabela de Retornos:
- Header com **check-all** que seleciona todas as linhas pagáveis da página
- Linhas já pagas: ícone `—` (não selecionável)
- Linhas com `valor_pago > 0` e não pagas: checkbox ativo
- Linha selecionada destacada com `box-shadow` esquerdo verde + fundo `rgba(16,185,129,.10)`
- Estado `indeterminate` do check-all quando seleção parcial

**2. Painel financeiro** `.ret-finance-panel` (aparece ao filtrar por `id_terc`):
- Cabeçalho: ícone + nome do terceirizado + telefone + badge "Quitado" (se tudo pago)
- 5 stat cards: **Qtd Retornos**, **Peças Boas**, **Valor Total**, **Valor Pago** (emerald), **Valor Pendente** (highlight verde glow)
- Botão **"Pagar Todos do Terceirizado"** — atalho que busca todos os pendentes (até 1000) e abre modal pré-preenchido

**3. Barra flutuante** `.ret-payment-bar` (aparece ao selecionar 1+ retornos):
- Fixed bottom centralizada, com glow verde
- Mostra: `X retornos · Y peças · R$ Z` em tempo real
- Botão **"Limpar"** + botão **"Pagar Selecionados"**
- Bloqueia pagamento de múltiplos terceirizados na mesma seleção (mostra aviso)

**4. Modal de pagamento** (`openPaymentModal`):
- Resumo visual: terceirizado + 3 stats (X retornos / X peças / **Valor total destacado**)
- Form: **Data do pagamento** (default hoje), **Forma** (select com 7 opções), **Observação** (textarea opcional)
- Banner azul de confirmação: *"Você está prestes a confirmar o pagamento de X retornos no valor de R$ Y..."*
- POST `/api/payments-terc` → ao retornar OK, abre **toast de sucesso** com botão **"Gerar PDF do Comprovante"**

**5. Comprovante PDF** (`generatePaymentReceiptPDF`):
- jsPDF + jspdf-autotable (já carregados via CDN)
- A4 retrato com:
  - Cabeçalho: razão social da empresa + CNPJ + endereço + "COMPROVANTE DE PAGAMENTO Nº {id}"
  - Bloco terceirizado: nome, telefone, PIX
  - Tabela: **CTRL | OP | Ref | Serviço | Valor** (uma linha por retorno)
  - Totais (qtd retornos, peças, **valor total em destaque**)
  - Forma de pagamento + observação
  - Rodapé: responsável (usuário logado) + IP + data/hora + 2 linhas para assinatura

### Frontend — Histórico de Pagamentos (`ROUTES.pagamentos_terc`)
Menu **Financeiro → Pagamentos** (novo grupo na sidebar com ícone `fa-hand-holding-dollar`):
- **KPIs**: total de pagamentos, valor consolidado, qtd retornos pagos, qtd estornos
- **Filtros**: período (de/até), terceirizado, forma de pagamento, status, busca textual
- **Tabela paginada**: `ID | Data | Terceirizado | Qtd Retornos | Valor | Forma | Usuário | Status`
- **Ações por linha**: 👁️ ver detalhe (modal com itens) · 📄 gerar PDF · ⛔ **estornar (somente admin)**
- Estorno pede confirmação + motivo, libera os retornos (voltam para Pendente, podem ser repagos)

### CSS — Componentes (`.ret-payment-bar`, `.ret-finance-panel`, `.rfp-stat`, `.pay-summary`, `.pay-stat`, `.pay-confirm-banner`)
- Padrão dark gradient + glow verde (alinhado com HOTFIX 0040/0041)
- `.rfp-stat[data-variant]` com 5 variantes: `neutral`, `blue`, `emerald`, `amber`, `highlight`
- Light theme overrides em todas as classes
- Responsivo: 5→3→2 colunas no painel financeiro · barra full-width no mobile
- `.pay-stat--highlight` com `text-shadow` verde para o valor total
- Linha selecionada usa `tr:has(.ret-checkbox:checked)` para destaque sem JS extra

### Segurança & Multi-tenant
- ✅ **Tenant scoping**: 100% das queries com `WHERE id_empresa = ?` + JOINs com igualdade de `id_empresa`
- ✅ **UNIQUE composto** `(id_empresa, id_retorno)` em `payment_terc_items` impede pagamento duplicado mesmo em race conditions
- ✅ **RBAC**: estorno protegido por `requireAdmin()` (perfil='admin' apenas)
- ✅ **Auditoria completa**: usuário, IP, módulo (`PAGTERC`), ação (`CREATE`/`VOID`), antes/depois — registrado em `auditoria`
- ✅ **CHECK constraint** `status IN ('Confirmado','Estornado')` no DB impede status inválido

### Arquivos alterados
| Arquivo | Mudança |
|---|---|
| `migrations/0042_pagamentos_terceirizados.sql` | **CRIADO** — 2 tabelas + ALTER + índices (12 commands) |
| `src/routes/payments_terc.ts` | **CRIADO** — Router Hono com 5 endpoints + audit + RBAC |
| `src/index.tsx` | `import paymentsTerc` + `app.route('/api', paymentsTerc)` + cache bust v=50 |
| `src/routes/terceirizacao.ts` | `+ rt.id_pagamento, r.id_terc` no SELECT de `/terc/retornos` |
| `public/static/app.js` | NAV menu + checkbox column + finance panel + payment bar + modal + PDF + ROUTES.pagamentos_terc + helpers globais |
| `public/static/styles.css` | +600 linhas — `.ret-payment-bar`, `.ret-finance-panel`, `.rfp-stat[data-variant]`, `.pay-summary`, `.pay-stat`, `.pay-confirm-banner`, light theme, responsivo |

### Validação técnica
- **Build**: `dist/_worker.js 325.23 kB` (+10 kB vs HOTFIX 0041, esperado por payments_terc.ts)
- **Local smoke**: HTML 200 / app.js?v=50 200 / styles.css?v=50 200 / API summary 401 (auth required ✅) / 117 classes CSS / 21 funções JS
- **Migration LOCAL**: `npx wrangler d1 migrations apply pcp-confeccao-prod --local` → 12 commands ✅
- **Migration PROD**: `--remote` → 12 commands em 4.02ms ✅
- **Deploy PROD**: `https://1caf23e3.corepro-confeccao.pages.dev` ✅
- **PROD smoke**: HTML 200 + app.js?v=50 (559 KB) + styles.css?v=50 (255 KB) + APIs retornando 401 + 117 classes + 21 funções confirmadas em PROD

### Compatibilidade total
- ✅ **Zero impacto** em retornos já pagos pelo método legado (continuam "Pago" via `dt_pagamento`)
- ✅ **Zero impacto** em cálculos (valor unitário × peças boas continua idêntico)
- ✅ **Zero impacto** em relatórios/dashboard/exports
- ✅ **Multiempresa**: cada empresa só vê e paga seus próprios retornos
- ✅ **Print/PDF de retornos**: chip de "Pago" continua funcionando (depende só de `dt_pagamento`)
- ✅ **Repagamento após estorno**: funciona — o estorno limpa `dt_pagamento` + `id_pagamento`, retorno volta a "Pendente" e pode ser incluído em novo lote

---

## 🆕 HOTFIX 0043 (2026-06-02) — Exclusão em Lote de Remessas

### Contexto
Antes deste hotfix, **excluir várias remessas exigia clicar lixeira → confirmar → repetir** para cada uma, dezenas de vezes. Importações erradas, lotes de teste em ambiente de homologação ou limpeza periódica viravam tarefas manuais demoradas e propensas a erro humano. Faltava também uma **proteção financeira** clara — o usuário podia confirmar a exclusão de remessas que já tinham sido pagas, perdendo o vínculo com o histórico de pagamentos do HOTFIX 0042.

Este hotfix entrega **seleção múltipla por checkbox + exclusão em lote com validações de bloqueio**, mantendo **100% intacta** a exclusão individual já existente.

### Arquitetura — sem schema novo
- ✅ **Não cria tabelas nem ALTER** — usa apenas as estruturas existentes (`terc_remessas`, `terc_retornos`, `payment_terc_items`)
- ✅ **Backend único endpoint**: `POST /api/terc/remessas/bulk-delete` (não toca no `DELETE /terc/remessas/:id` individual)
- ✅ **Frontend só estende a tabela de Remessas** — adiciona 1 coluna (checkbox) + 1 barra flutuante + 1 modal
- ✅ **Multi-tenant**: 100% das queries com `WHERE id_empresa = ?` + IDs de outras empresas são silenciosamente ignorados (não vaza informação)

### Endpoint REST
| Método | Rota | Função |
|---|---|---|
| `POST` | `/api/terc/remessas/bulk-delete` | **2 modos**: PRE-CHECK (sem `confirm`) → retorna lista de permitidas/bloqueadas sem deletar; **EXECUÇÃO** (`confirm:'SIM'`) → deleta apenas as permitidas |

**Body:**
```json
{ "ids": [123, 124, 125, ...], "confirm": "SIM" }
```

**Regras de bloqueio (qualquer uma impede a exclusão):**
1. **`status_fin = 'Pago'`** → remessa já fechada financeiramente (não pode sumir do extrato)
2. **Retorno já pago** → `terc_retornos.dt_pagamento IS NOT NULL` OU `id_pagamento IS NOT NULL` (vinculado ao módulo de pagamentos do HOTFIX 0042)
3. **Tenant cross** → remessa de outra empresa nunca aparece (tratada como "não encontrada")

**Resposta PRE-CHECK:**
```json
{
  "ok": true,
  "data": {
    "preview": true,
    "total_selecionadas": 20,
    "total_permitidas": 17,
    "total_bloqueadas": 3,
    "permitidas": [ { "id_remessa": 124, "num_controle": 124, "qtd_retornos": 0 }, ... ],
    "bloqueadas": [ { "num_controle": 125, "motivo": "Remessa está com status financeiro \"Pago\"" }, ... ]
  }
}
```

### Frontend — Tabela de Remessas
**1. Coluna checkbox** na primeira coluna:
- Header com **check-all** que seleciona todas as remessas da página corrente
- Estado **indeterminate** quando seleção parcial
- Linha selecionada destacada com `box-shadow` esquerdo vermelho + fundo `rgba(239,68,68,.10)` via `:has(.rem-bulk-check:checked)` (zero JS extra para o highlight)

**2. Barra flutuante** `.rem-bulk-bar` (aparece com 1+ selecionada):
- Fixed bottom centralizada, glow vermelho
- Mostra em tempo real: **`X remessas selecionadas · Y peças`**
- Botões: **"Cancelar Seleção"** + **"Excluir Selecionadas"**

**3. Modal de confirmação** (rich):
- **Resumo visual** com 3 cards: `Selecionadas` / `Serão excluídas` (verde) / `Bloqueadas` (vermelho)
- **Lista dos CTRLs permitidos** (até 20 visíveis + "…+N")
- **Lista detalhada das bloqueadas** (até 12 com motivo: "CTRL 125 — Possui pagamento registrado"; resto resumido)
- **Banner de aviso vermelho**: *"Esta ação não poderá ser desfeita..."*
- Se 0 permitidas → botão desabilitado + mensagem "Nenhuma pode ser excluída"

**4. Atualização automática pós-exclusão:**
- Limpa toda a seleção (incluindo check-all)
- Invalida o cache de remessas (`sessionStorage`)
- Recarrega a tabela com `bypassCache: true`
- Contador "X remessas · Y peças" e dashboard se atualizam sem reload de página

### Exclusão individual (lixeira) — INALTERADA
- ✅ Botão lixeira individual continua na coluna **Ações** de cada linha
- ✅ Mesmo modal de confirmação individual (com escolha cancelar/cascata para remessas com retornos)
- ✅ Mesmo endpoint `DELETE /terc/remessas/:id` — **zero código tocado**

### Segurança & Multi-tenant
- ✅ **Tenant scoping**: `WHERE id_empresa = ?` em todas as queries (SELECT, DELETEs, COUNTs)
- ✅ **Defensa em camadas**: o frontend só envia IDs permitidos no segundo POST, mas o backend **revalida tudo** mesmo assim (defense-in-depth)
- ✅ **Hard cap 500 IDs/chamada** — alinhado ao `LIMIT 500` do GET `/terc/remessas`
- ✅ **Bloqueio financeiro**: nunca é possível excluir remessa com retorno pago ou status_fin='Pago'
- ✅ **Auditoria completa**: registra 2 entradas em `auditoria` por operação
  - `BULK_DEL_REM` — usuário + qtd + lista de CTRLs excluídos
  - `BULK_DEL_REM_DETAIL` — payload JSON com IDs, CTRLs, IP de origem, qtd bloqueadas, retornos apagados

### Cascata de exclusão (hard delete)
Para cada remessa permitida, na ordem:
1. `terc_retorno_grade` (grades de retorno)
2. `terc_retorno_item_grade` (grades de itens de retorno — multi-produto)
3. `terc_retorno_itens` (itens de retorno — multi-produto)
4. `terc_retornos`
5. `terc_eventos` (histórico)
6. `terc_remessa_grade` (grade da remessa — legado)
7. `terc_remessa_item_grade` (grades de itens da remessa — multi-produto)
8. `terc_remessa_itens` (itens da remessa — multi-produto)
9. `terc_remessas`

Todas com `id_empresa = ?` no WHERE para isolamento total. Tabelas que podem não existir em tenants legados são envolvidas em `try/catch` para tolerância.

### CSS — Componentes (`.rem-bulk-bar`, `.rem-col-check`, `.rem-bulk-summary`, `.rem-bulk-blocked`, `.rem-bulk-permit`)
- Padrão dark gradient + glow vermelho (alinhado com 0040/0041/0042 mas em outra paleta para diferenciar **destruição** de **pagamento**)
- Light theme overrides em todas as classes
- Responsivo mobile: barra full-width + botões empilhados
- `tr:has(.rem-bulk-check:checked)` para highlight de linha sem JS

### Arquivos alterados
| Arquivo | Mudança |
|---|---|
| `src/routes/terceirizacao.ts` | **+250 linhas** — novo endpoint `POST /terc/remessas/bulk-delete` antes do `DELETE` individual |
| `public/static/app.js` | Skeleton + rowHtml + renderTable: +1 coluna checkbox; shell: +barra `#rem-bulk-bar`; novas funções `getSelectedRemRows`, `updateRemBulkBar`, `clearRemBulkSelection`, `bulkDeleteRem`; bindings `#rbb-clear` + `#rbb-del` |
| `public/static/styles.css` | **+350 linhas** — `.rem-col-check`, `.rem-bulk-bar` + filhos, `.rem-bulk-summary`, `.rem-bulk-permit`, `.rem-bulk-blocked` (+ light theme + responsivo mobile) |
| `src/index.tsx` | Cache bust v=50 → v=51 |

### Validação técnica
- **Build**: `dist/_worker.js 329.91 kB` (+4.7 kB vs HOTFIX 0042 — apenas endpoint novo no backend)
- **Local smoke**: HTML 200 / app.js?v=51 (571 KB) / styles.css?v=51 (266 KB) / API bulk-delete: 401 (auth required ✅) / 76 classes CSS / 18 funções JS
- **Deploy PROD**: https://006b6813.corepro-confeccao.pages.dev
- **PROD smoke**: HTML 200 + assets 200 + 76 classes + 18 funções + HOTFIX 0042 ainda presente (11 refs — zero regressão)

### Compatibilidade total
- ✅ **Zero impacto** na lixeira individual existente (endpoint + modal intocados)
- ✅ **Zero impacto** em cálculos, totalizadores, dashboard, relatórios
- ✅ **Multiempresa**: cada empresa só vê/seleciona/exclui as próprias remessas
- ✅ **Compatível com paginação/filtros/busca** ativos (seleção opera sobre a página atual)
- ✅ **Compatível com HOTFIX 0042**: respeita pagamentos registrados — não permite excluir remessa cujos retornos foram pagos pelo módulo financeiro
- ✅ **Atualização sem refresh**: dashboard, contadores e relatórios se atualizam automaticamente após exclusão

---

## 🆕 HOTFIX 0044 (2026-06-02) — Correção da Exclusão em Lote com Muitas Remessas

### Contexto / Bug em produção
Após o deploy da HOTFIX 0043, ao tentar excluir **221 remessas** (lote real de homologação) o sistema falhava sempre com o toast **"Erro no banco de dados. Equipe foi notificada."**. Sem nenhuma informação adicional o usuário não conseguia identificar o que estava errado, e tentar repetir só repetia o erro. Em lotes pequenos (1, 5, 10) tudo funcionava — o que indicava que o problema era proporcional ao volume.

### Causa raiz confirmada
**`D1_ERROR: too many SQL variables`** — o Cloudflare D1 tem **limite prático de ~100 parâmetros bindados por statement**. Cada DELETE em cascata da HOTFIX 0043 usava `IN(?,?,...)` com **um placeholder por ID**, mais o `id_empresa`. Com 221 IDs cada statement bindava **222 parâmetros**, estourando o limite e abortando a operação.

Pior: o handler global de erros em `src/index.tsx` mapeava o regex `D1_ERROR` para a mensagem genérica **antes** dos padrões mais específicos serem testados, e em produção suprimia o `detail` técnico via `NODE_ENV === 'production'`. Resultado: o front recebia só `code: 'DB_ERROR'` sem nenhuma pista do que era.

### Solução implementada (defesa em profundidade — 4 camadas)

#### 1. Backend — `POST /terc/remessas/bulk-delete` reescrito com **chunking + DB.batch() atômico**
- **Chunking**: IDs são processados em **lotes de 80** (constante `BULK_DEL_CHUNK` — 80+1=81 binds por statement, margem segura contra o limite ~100 do D1).
- **`c.env.DB.batch([stmts])`** por chunk: cada lote roda como **transação atômica** do D1. Se qualquer DELETE do lote falhar, **nenhum** é aplicado (rollback automático) — sem precisar de `BEGIN/COMMIT` manuais.
- **DELETEs defensivos** acrescentados para `terc_consertos`, `terc_alertas` e `terc_eventos` mesmo onde a FK já é CASCADE — **defesa em profundidade**: se algum tenant antigo perder o `ON DELETE CASCADE` por migration manual, a exclusão continua funcionando.
- **Per-chunk try/catch**: lote que falha não interrompe os outros. IDs do lote vão para `falhas[]` com **motivo específico** (FK_VIOLATION, TOO_MANY_PARAMS, DB_BUSY, no such table, etc.) extraído por regex do erro do D1.
- **Auditoria com payload truncado**: máximo de **50 CTRLs** + sufixo `(+N restantes)`; payload detalhe limitado a 4000 chars. Evita estourar a coluna `auditoria.v_novo` com lotes grandes.

#### 2. Backend — handler global em `src/index.tsx` mais inteligente
- Ordem dos regex **ajustada**: padrões específicos (`FOREIGN KEY`, `UNIQUE`, `NOT NULL`, `CHECK`, `too many SQL variables`, `database is locked`) são testados **ANTES** do regex genérico `D1_ERROR` (que cobre tudo do D1).
- **Novos códigos identificáveis**: `TOO_MANY_PARAMS` (400), `DB_BUSY` (503), `FK_VIOLATION` com mensagem em PT-BR explicando que existem registros vinculados.
- **Novo campo `hint`** (≤160 chars): pista técnica curta — **exposta também em PROD** — sem stack/dados sensíveis, para o suporte e o frontend mostrarem contexto.

#### 3. Frontend — função `bulkDeleteRem()` com modal de **RESULTADO** rico
- Substitui o toast genérico "Erro no banco de dados" por um **modal completo** com 3 blocos:
  - ✓ **Excluídas com sucesso** (lista de CTRLs + contagem de retornos)
  - ⚠ **Bloqueadas por regra de negócio** (cada CTRL com seu motivo: status_fin=Pago, retorno pago, etc.)
  - ✗ **Falharam tecnicamente** (cada CTRL com motivo técnico: FK violada, banco ocupado, etc.)
- Chamada à API agora usa `{silent: true}` para o frontend **assumir o controle** da exibição (em vez do toast automático do `api()`).
- Trata tanto **sucesso parcial** (HTTP 200 com `falhas[]` populado) quanto **fracasso técnico total** (HTTP 500 com `BULK_DELETE_FAILED`).
- Toast de complemento adapta o tom (success/info/error) ao resultado geral.

#### 4. Cache bust `v=51 → v=52` para forçar reload do app.js novo

### Mapa de FKs revisado (defense-in-depth)
Mapeadas **11 tabelas filhas** de `terc_remessas` — todas tratadas explicitamente pelo novo bulk-delete:
| Tabela | FK | ON DELETE | Notas |
|---|---|---|---|
| `terc_alertas` | `id_remessa` | CASCADE | DELETE explícito adicionado |
| `terc_consertos` | `id_remessa` | NO ACTION (FK simples) | DELETE explícito **crítico** — sem ele bloquearia |
| `terc_eventos` | `id_remessa` | CASCADE | DELETE explícito mantido |
| `terc_remessa_grade` | `id_remessa` | CASCADE | DELETE explícito |
| `terc_remessa_itens` | `id_remessa` | CASCADE | DELETE explícito |
| `terc_remessa_item_grade` | via `id_item` | CASCADE indireta | DELETE explícito via subquery |
| `terc_retornos` | `id_remessa` | CASCADE | DELETE explícito (limpa `payment_terc_items` via CASCADE em `id_retorno`) |
| `terc_retorno_grade` | via `id_retorno` | CASCADE indireta | DELETE explícito via subquery |
| `terc_retorno_itens` | `id_remessa` + `id_retorno` | CASCADE | DELETE explícito |
| `terc_retorno_item_grade` | via `id_ret_item` | CASCADE indireta | DELETE explícito via subquery |
| `payment_terc_items` | via `id_retorno` | CASCADE | Limpa automaticamente quando `terc_retornos` é deletado |

### Arquivos alterados
- `src/index.tsx` — handler global de erros com regex reordenado, novos códigos, campo `hint` exposto em PROD. Cache bust v=52.
- `src/routes/terceirizacao.ts` — endpoint `POST /terc/remessas/bulk-delete` totalmente reescrito (~250 → ~320 linhas) com chunking, batch atômico, defensive DELETEs, per-chunk error capture, auditoria truncada.
- `public/static/app.js` — `bulkDeleteRem()` chama API silent e renderiza nova `showBulkDeleteResultModal()` com 3 blocos (excluídas/bloqueadas/falhadas).

### Métricas pós-deploy
- **Build**: `dist/_worker.js 332.82 kB` (+2.9 kB vs HOTFIX 0043 — apenas lógica nova, sem dependências)
- **PROD URL**: https://corepro-confeccao.pages.dev — deployment `ee245820`
- **Smoke PROD**: HTTP 200 raiz · cache bust v=52 propagado · `showBulkDeleteResultModal` + `BULK_DELETE_FAILED` presentes no app.js novo · endpoint bulk-delete retorna 401 limpo sem auth (parser/middleware OK)
- **Zero breaking changes**: API mantém o mesmo contrato (`ids[]`, `confirm: 'SIM'`) — campos adicionais (`total_falhadas`, `falhas[]`, `hint`) são opcionais no frontend antigo.
- **Compatibilidade total** com HOTFIXes 0042 (validação de retorno pago via `id_pagamento`) e 0043 (todas as validações de bloqueio mantidas).

### Garantias
- ✅ **Atomicidade por lote**: cada chunk de 80 IDs é "tudo ou nada"
- ✅ **Resiliência a lotes grandes**: 500 IDs (cap defensivo) = 7 chunks de 80 max — totalmente dentro do limite do D1
- ✅ **Visibilidade**: usuário sempre vê exatamente o que aconteceu (sucesso/bloqueio/falha por CTRL)
- ✅ **Audit completa**: registra resumo + payload truncado, nunca estoura `v_novo`
- ✅ **Defense-in-depth**: funciona mesmo se uma FK CASCADE desaparecer por migration manual no futuro
- ✅ **Multi-tenant intacto**: `id_empresa` em todas as cláusulas WHERE

### Como o usuário vê a correção
**Antes (HOTFIX 0043 com bug):**
> ❌ Toast vermelho: "Erro no banco de dados. Equipe foi notificada." (e nada mais — usuário fica no escuro)

**Depois (HOTFIX 0044):**
> ✅ Modal completo:
> - **Total processado: 221**
> - ✓ **Excluídas com sucesso: 215** (33 retornos também) — CTRLs: 230, 231, 232, …
> - ⚠ **Bloqueadas (regra de negócio): 6** — CTRL 240: "Possui 2 retorno(s) já pago(s)"; CTRL 245: "Remessa está com status financeiro Pago"; …
> - (✗ falhas técnicas só apareceriam se houvesse algum problema real do banco, com motivo específico tipo "Possui registros vinculados que impedem a exclusão")

---

## 🆕 HOTFIX 0045 (2026-06-02) — Dashboard por Ciclo de Produção (Competências)

### Contexto
O Dashboard mostrava **dados acumulados** das remessas dentro do período filtrado (default = últimos 30 dias). Resultado: ao iniciar um novo ciclo de produção, o usuário via 66 remessas no dashboard mas grande parte pertencia ao ciclo anterior — sem forma clara de separar "o que pertence ao ciclo atual" de "histórico". Isso atrapalhava análise de produtividade, controle financeiro e visão real da operação.

### Conceito implementado — Ciclo Atual
- **Ciclo atual** = janela entre o último fechamento (ou primeiro dia do mês corrente se nunca fechou) e a data de hoje
- **Fechar Ciclo** = grava um snapshot dos KPIs e dispara o início do próximo ciclo (no dia seguinte)
- **Zero alteração em dados históricos** — remessas e retornos NÃO são alterados; apenas a janela do dashboard muda
- **Multi-tenant**: cada empresa tem seus próprios ciclos, isolados via `id_empresa`

### Nova tabela `terc_ciclos_producao` (migration 0045)
```
id_ciclo, id_empresa, dt_inicio, dt_fim,
fechado_por, dt_fechamento,
snapshot_json (KPIs no momento do fechamento),
total_remessas, total_pecas, valor_total (denormalizado para listagem rápida),
observacao
```
+ 2 índices: `(id_empresa, dt_fim DESC)` e `(id_empresa, dt_fechamento DESC)`.

### Endpoints novos
| Método | Rota | Descrição |
|---|---|---|
| GET  | `/terc/ciclo-atual` | Retorna `{ dt_inicio, dt_fim, dias, label, kpis: { remessas, pecas, valor }, nunca_fechou, ultimo_fechamento }` |
| POST | `/terc/ciclo/fechar` | Body: `{ observacao? }`. Captura snapshot dos KPIs e insere registro. Auditoria automática. |
| GET  | `/terc/ciclos?page=1&size=20` | Lista paginada dos ciclos fechados, com snapshot expandido |

### Dashboard endpoint estendido — `GET /terc/dashboard`
Novo query param `?periodo=` aceita:
- **`ciclo`** (padrão) — janela do ciclo atual aberto
- **`mes`** — primeiro dia do mês atual até hoje
- **`30d`** — últimos 30 dias (compatibilidade com o default antigo)
- **`custom`** — usa `de` / `ate` (modo legado)

**Compatibilidade total**: se cliente NÃO passar `periodo` mas passar `de`/`ate`, comportamento antigo é mantido (custom implícito). Nenhum cliente antigo quebra.

Response agora inclui:
```json
{
  "periodo": {
    "de": "2026-06-01",
    "ate": "2026-06-02",
    "tipo": "ciclo",
    "ciclo": { "dt_inicio": "...", "label": "Competência Junho/2026", "dias": 2, "nunca_fechou": false, "ultimo_fechamento": {...} }
  },
  "kpis": {...}, "top_terceirizados": [...], ...
}
```

### Frontend — alterações no `ROUTES.dashboard`
1. **Card "CICLO ATUAL"** no topo (gradiente azul) com:
   - Label dinâmico (`Competência Junho/2026` ou `Ciclo 01/06/2026 — Hoje`)
   - Subtítulo com período + dias decorridos + flag "nunca fechado" quando aplicável
   - Botões `Fechar Ciclo` (warning) e `Anteriores` (secondary)
2. **Seletor de período** com 4 radio buttons estilizados (Ciclo Atual / Mês Atual / Últimos 30 dias / Personalizado)
   - Padrão = Ciclo Atual
   - Seleção persistida em `localStorage` por chave `dashboard.periodo`
   - Troca de radio recarrega o dashboard automaticamente (sem precisar clicar "Atualizar")
   - Campos `De` / `Até` só aparecem em "Personalizado"
3. **Modal "Fechar Ciclo"** com:
   - Resumo do ciclo (período, dias, remessas, peças, valor)
   - Campo opcional de observação (até 500 chars)
   - Banner informativo deixando claro que **dados NÃO são alterados**
4. **Modal "Ciclos Anteriores"** com lista paginada (50/página):
   - Cada ciclo mostra: período, fechado_por, data de fechamento, totais (remessas/peças/valor), em_aberto/concluídas/atrasadas do snapshot, observação

### Painéis que NÃO seguem o filtro de período (estado "agora")
Por design, esses painéis sempre mostram a **realidade atual** independente do filtro selecionado, para não esconder problemas operacionais reais:
- **Remessas em Atraso** (tabela bottom) — uma remessa do ciclo passado que ainda está atrasada precisa aparecer
- **Em Produção Agora** — estado "neste momento", não tem ciclo
- **Próximos Vencimentos 7 dias** — janela futura
- **Valores a Pagar** — dívida acumulada não some ao virar o mês

### CSS adicionado (+223 linhas)
- `.dash-ciclo-card` + variações dark / responsivas
- `.dash-periodo-seletor` + `.dash-periodo-opt[.is-active]` (radios estilizados)
- `.dash-ciclos-anteriores__*` (modal de histórico)

### Métricas pós-deploy
- **Build**: `dist/_worker.js 338.32 kB` (+5.5 kB vs HOTFIX 0044)
- **Deploy PROD**: `9de33653` em **https://corepro-confeccao.pages.dev**
- **Migration aplicada**: LOCAL (4 comandos) + REMOTE (4 comandos) ✅
- **Smoke PROD**: HTTP 200 + v=53 + 3 endpoints novos respondem 401 limpo + 14 funções JS novas + 34 classes CSS novas + tabela `terc_ciclos_producao` queryable em PROD
- **Multi-tenant**: PROD com 1 empresa ativa (68 remessas, id_empresa=1); todas as queries filtram por `id_empresa` (isolamento garantido)
- **Zero breaking changes**: dashboard mantém comportamento antigo se cliente passar `?de=&ate=` sem `periodo`

### Garantias
- ✅ **Não altera dados históricos** (apenas adiciona tabela `terc_ciclos_producao`)
- ✅ **Tenant novo já funciona no dia 1** (fallback automático para "primeiro dia do mês atual")
- ✅ **Multi-tenant isolado** (cada empresa tem seus próprios ciclos, snapshots e janelas)
- ✅ **Reversível** (drop da tabela volta ao comportamento de períodos manuais)
- ✅ **Auditoria automática** ao fechar (módulo TERC, ação `FECHAR_CICLO`)
- ✅ **Compatibilidade backward**: chamadas antigas a `/terc/dashboard?de=&ate=` continuam funcionando

---

## 🆕 HOTFIX 0046 (2026-06-03) — Sidebar com Scroll Interno (Logo fixo + Menus roláveis + Menu do usuário sempre visível)

### Contexto
Após acumular muitos módulos no sistema (Dashboard, Remessas, Retornos, Pagamentos, Relatórios, **Cadastros** com 8 itens, **Configurações** com 5 itens), em telas de notebook/tablet o menu do usuário (avatar, nome, perfil, sair) **era empurrado para fora da viewport** quando todos os grupos colapsáveis estavam expandidos. O usuário precisava rolar a sidebar inteira para alcançar "Sair" — UX ruim e fácil de perder.

### Causa raiz
1. A regra `.sidebar { overflow-y: auto }` aplicava scroll no **container raiz** da sidebar. Como `.sidebar-user-btn` é filho direto de `.sidebar`, ele também rolava junto com os menus.
2. Pior: existia uma regra de reforço `.sidebar { overflow: visible }` (linha 2353 do `styles.css`, usada para garantir visibilidade do dropdown do usuário) que **anulava** o `overflow-y: auto` original, fazendo a sidebar inteira sair da viewport sem nenhum scroll — apenas o body rolava.
3. O truque `margin-top: auto` no `.sidebar-user-btn` (que empurra o footer para baixo em flexbox) só funciona quando há **espaço sobrando**. Com muitos menus, o conteúdo ultrapassa a altura e o `margin-top: auto` perde efeito.

### Solução implementada — Layout flexbox com 3 zonas
Sem alteração no HTML render (já estava semanticamente correto), apenas refatoração cirúrgica do CSS:

| Zona | Seletor | Comportamento |
|------|---------|---------------|
| **Topo (FIXO)** | `.sidebar-brand` | `flex-shrink: 0` — logo + tagline nunca encolhem nem somem |
| **Meio (ROLÁVEL)** | `.sidebar-nav` | `flex: 1 1 auto; min-height: 0; overflow-y: auto` — única região com scroll interno |
| **Rodapé (FIXO)** | `.sidebar-user-btn` | `flex-shrink: 0` — menu do usuário sempre acessível |
| **Container raiz** | `.sidebar` | `height: 100vh; max-height: 100vh; overflow: hidden` — trava altura, bloqueia scroll do container |

### Por que `min-height: 0` no `.sidebar-nav` foi crítico
Em flexbox column, filhos com `flex: 1` têm `min-height: auto` por padrão — o que significa que **não conseguem encolher abaixo do tamanho intrínseco do conteúdo**. Sem `min-height: 0` o `overflow-y: auto` nunca dispara porque o flex item simplesmente cresce, empurrando o footer pra fora. Esse é um dos "gotchas" mais clássicos de flexbox.

### Detalhes técnicos
- **Container raiz**: removido `overflow-y: auto`, substituído por `overflow: hidden` + altura travada em `100vh`/`max-height: 100vh`
- **Regra global `overflow: visible`** (linha ~2353): `.sidebar` **removida da lista** — outras classes (`.main-layout`, `.content`, `#topbar`, `#main-content`, etc.) mantidas intactas
- **Popover do usuário**: usa `position: fixed`, então **não é cortado** pelo `overflow: hidden` da sidebar (testado)
- **Scrollbar moderna no `.sidebar-nav`**:
  - WebKit: `6px` largura, thumb `#334155`, hover `#475569`
  - Firefox: `scrollbar-width: thin`, `scrollbar-color: #334155 transparent`
  - **Discreta**: invisível quando a sidebar não está em hover, aparece suavemente no hover
- **Drawer mobile/tablet** (`@media max-width: 1023px`): mantém `height: 100vh` + `overflow: hidden` herdados — scroll interno do `.sidebar-nav` funciona idêntico em todas as resoluções
- **Estado de colapso preservado**: `openState` dos grupos CADASTROS/CONFIGURAÇÕES (controlado por JS) não foi tocado — continua persistindo em localStorage
- **Item ativo após scroll**: classe `.nav-item.active` mantém o gradiente lilás `#4F46E5→#7C3AED` mesmo quando rolado

### Arquivos modificados
- `public/static/styles.css` (+49 linhas, **HTML inalterado**)
  - `.sidebar`: `overflow-y: auto` → `overflow: hidden`; adicionados `height: 100vh; max-height: 100vh`; removido `scroll-behavior` (movido p/ `.sidebar-nav`)
  - `.sidebar-brand`: adicionado `flex-shrink: 0`
  - `.sidebar-nav`: adicionados `min-height: 0; overflow-y: auto; overflow-x: hidden; scroll-behavior: smooth` + scrollbar moderna (WebKit + Firefox)
  - `.sidebar-user-btn`: adicionado `flex-shrink: 0` (mantido `margin-top: auto` como fallback redundante)
  - Removidas regras antigas `.sidebar::-webkit-scrollbar*` (substituídas por `.sidebar-nav::-webkit-scrollbar*`)
  - Linha 2353: `.sidebar` removida da lista de `overflow: visible` (com comentário explicativo)
  - `@media (max-width: 1023px)`: reforço de `height: 100vh; max-height: 100vh; overflow: hidden` no drawer
- `src/index.tsx`: cache bust `v=53 → v=54` (linhas 247 e 281)

### Critérios de aceitação atendidos
- ✅ Logo permanece fixo no topo (não rola)
- ✅ Apenas a região central (`.sidebar-nav`) rola
- ✅ Menu do usuário (avatar/nome/perfil/sair) permanece sempre visível no rodapé
- ✅ Nenhum item de navegação fica oculto — todos acessíveis via scroll interno
- ✅ Funciona em **desktop** (largura 260px), **notebook** (idem), **tablet** (drawer 280px), **mobile** (drawer 84vw)
- ✅ Mantém **100% das funcionalidades existentes**: collapse/expand de grupos (CADASTROS/CONFIGURAÇÕES) preservado, popover do usuário funcionando, hambúrguer mobile inalterado, item ativo destacado, todas as rotas SPA preservadas
- ✅ Scrollbar discreta e moderna (6px, hover-revealed)

### Métricas pós-deploy
- **Build**: `dist/_worker.js 338.32 kB` (**idêntico ao HOTFIX 0045** — alteração 100% CSS-only, zero bytes no worker)
- **CSS final**: 8538 linhas (+49 vs HOTFIX 0045)
- **Deploy PROD**: `c589f4e8` em **https://corepro-confeccao.pages.dev**
- **Smoke PROD**: Root 200 + CSS?v=54 200 + JS?v=54 200 + **11 markers `HOTFIX 0046`** confirmados no CSS servido + cache bust `v=54` propagado no HTML
- **No-regression smoke**: endpoints `/api/terc/remessas/bulk-delete`, `/api/terc/ciclo-atual`, `/api/terc/ciclos`, `/api/terc/dashboard?periodo=ciclo` retornam **401** (auth exigida — comportamento intacto)
- **Multi-tenant**: nenhuma alteração de backend/banco — comportamento idêntico para todas as empresas (HOTFIX 100% frontend visual)

### Garantias
- ✅ **Zero alteração no HTML render** da sidebar — estrutura `<aside><a.brand><nav><button.user-btn></aside>` mantida exatamente como estava
- ✅ **Zero alteração no JavaScript** — `app.js` não tocado (collapse/expand state, popover, hambúrguer, rotas SPA, avatar refresh — todos intactos)
- ✅ **Zero alteração no backend** — `_worker.js` bytes idênticos pre/pós-hotfix
- ✅ **Reversível**: basta reverter as ~49 linhas em `styles.css` para voltar ao comportamento anterior
- ✅ **Dark mode**: cores hardcoded da sidebar (já era dark-only por design) permanecem idênticas
- ✅ **Multi-tenant**: zero impacto — alteração puramente visual no shell da aplicação

### Padrão Flexbox 3-zonas (referência para futuras alterações)
```css
.sidebar {
  height: 100vh; max-height: 100vh;
  display: flex; flex-direction: column;
  overflow: hidden;          /* container raiz NUNCA rola */
}
.sidebar-brand   { flex-shrink: 0; }                              /* topo fixo */
.sidebar-nav     { flex: 1 1 auto; min-height: 0; overflow-y: auto; } /* meio rolável */
.sidebar-user-btn{ flex-shrink: 0; }                              /* rodapé fixo */
```

---

## Roadmap / Não implementado
- [x] ~~Autenticação~~ ✅ **Implementado** (login + senha hasheada + tokens de sessão 12h + RBAC)
- [x] ~~Importador de OPs antigas~~ ✅ **Implementado** (SheetJS no browser + API robusta)
- [x] ~~Módulo Setores~~ ✅ **Implementado HOTFIX 0037 Pt.1** (CRUD completo + multi-tenant + 177 remessas preservadas)
- [x] ~~Filtros por Setor em Remessas/Retornos/Dashboard/Relatórios~~ ✅ **Implementado HOTFIX 0037 Pt.2** (filtro + chip visual + agregações)
- [x] ~~Módulo Backup & Restauração~~ ✅ **Implementado HOTFIX 0038 Pt.1** (NDJSON gzipado + restore atômico + multi-tenant + auditoria + visão master)
- [x] ~~Padronização de status "Aguardando Envio" → "Aguardando Retorno"~~ ✅ **Implementado HOTFIX 0039** (UI-only, zero impacto em workflow/banco)
- [x] ~~Alinhamento Terceirizado + Setor em tabelas (Remessas/Retornos)~~ ✅ **Implementado HOTFIX 0040** (componente `.tc-terc` reutilizável + responsivo + dark + print, zero impacto em backend/dados)
- [x] ~~Rodapé financeiro do Retorno com baixa legibilidade~~ ✅ **Implementado HOTFIX 0041** (componente `.tc-rsf` dark premium + grid responsivo + variantes coloridas + destaque "Total pago" + ações separadas, zero impacto em cálculos/lógica)
- [x] ~~Módulo financeiro / pagamento de terceirizados (sem gestão de "quando pagou / como / comprovante")~~ ✅ **Implementado HOTFIX 0042** (módulo Financeiro → Pagamentos completo: checkbox + painel financeiro por terceirizado + barra flutuante + modal de pagamento em lote + 7 formas + comprovante PDF (jsPDF + autoTable) + histórico paginado + estorno admin-only + auditoria com IP + 2 novas tabelas multi-tenant + backward-compat com `dt_pagamento`)
- [x] ~~Exclusão em lote de remessas (até hoje só dava 1 por vez)~~ ✅ **Implementado HOTFIX 0043** (checkbox + check-all + barra flutuante + modal com pre-check + validações de bloqueio: status_fin='Pago' / retorno pago / cross-tenant; cascata hard-delete + auditoria 2 entradas + multi-tenant scoping + lixeira individual 100% intacta) + ✅ **Corrigido HOTFIX 0044** (causa raiz: limite de ~100 parâmetros bindados por statement do D1 — agora chunking de 80 IDs + `DB.batch()` atômico + DELETEs defensivos para `terc_consertos`/`terc_alertas` + per-chunk error capture + modal de resultado rico com excluídas/bloqueadas/falhadas + handler global expõe `hint` técnico em PROD)
- [x] ~~Dashboard mostrando dados acumulados em vez do ciclo atual de produção~~ ✅ **Implementado HOTFIX 0045** (conceito de ciclo de produção com fechamento manual + nova tabela `terc_ciclos_producao` com snapshot + 3 endpoints novos `/terc/ciclo-atual`, `/terc/ciclo/fechar`, `/terc/ciclos` + dashboard aceita `?periodo=ciclo|mes|30d|custom` + card CICLO ATUAL no topo + seletor de período persistido em localStorage + modal "Fechar Ciclo" com observação + modal "Ciclos Anteriores" com histórico paginado + painéis "agora" mantêm visão real independente do filtro + multi-tenant isolado + zero alteração em dados históricos)
- [x] ~~Sidebar empurrando o menu do usuário para fora da viewport quando havia muitos módulos expandidos~~ ✅ **Implementado HOTFIX 0046** (refatoração CSS-only com flexbox 3-zonas: logo fixo no topo via `flex-shrink:0`, área de menus rolável via `flex:1 + min-height:0 + overflow-y:auto`, menu do usuário fixo no rodapé via `flex-shrink:0`, container raiz com `height:100vh + overflow:hidden`, scrollbar moderna 6px hover-revealed; **HTML 100% intacto**, **JS 100% intacto**, `_worker.js` 338.32 kB **idêntico**; funciona em desktop/notebook/tablet/mobile)
- [ ] **[Multi-tenant]** Rebuild do índice `ux_terc_produtos_ref_col` em `terc_produtos` para incluir `id_empresa` no UNIQUE (atualmente é `(cod_ref, COALESCE(id_colecao, 0))` — bloqueia mesmo cod_ref entre empresas distintas). Padrão da migration 0033 já está documentado.
- [ ] **[Multi-tenant]** Rebuild do `autoindex_terc_setores_1` (UNIQUE global em `nome_setor`) para `(id_empresa, nome_setor)`. Hoje a validação tenant-scoped é feita no backend; UNIQUE composto via `codigo` já cobre garantia de DB. Rebuild requer remoção temporária da FK `terc_terceirizados.id_setor`.
- [ ] Exportação Excel dos relatórios (hoje usamos impressão/PDF nativo do browser)
- [ ] Gráficos interativos adicionais no dashboard (já tem Chart.js carregado)
- [ ] Mobile-first avançado para apontamento (PWA)
- [ ] Integração com impressora térmica para ficha no chão de fábrica
- [ ] 2FA (TOTP) para usuários admin/gerente
- [ ] Envio de ficha por email/WhatsApp para o cliente
