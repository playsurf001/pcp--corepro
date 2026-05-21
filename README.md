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

**Próximas SPRINTS** (deferred):
- **SPRINT 2** — Enforcement de limites de plano (max_usuarios, max_remessas_mes), cron de suspensão por inadimplência, banner de trial
- **SPRINT 3** — Integração Mercado Pago PIX (criar cobrança, webhook, tela financeira)
- **SPRINT 4** — Signup público `/cadastro` + wizard de onboarding + e-mail transacional
- **SPRINT 5** — Cache KV, rate limit, R2 backups, polish UX

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

## Roadmap / Não implementado
- [x] ~~Autenticação~~ ✅ **Implementado** (login + senha hasheada + tokens de sessão 12h + RBAC)
- [x] ~~Importador de OPs antigas~~ ✅ **Implementado** (SheetJS no browser + API robusta)
- [ ] Exportação Excel dos relatórios (hoje usamos impressão/PDF nativo do browser)
- [ ] Gráficos interativos adicionais no dashboard (já tem Chart.js carregado)
- [ ] Mobile-first avançado para apontamento (PWA)
- [ ] Integração com impressora térmica para ficha no chão de fábrica
- [ ] 2FA (TOTP) para usuários admin/gerente
- [ ] Envio de ficha por email/WhatsApp para o cliente
