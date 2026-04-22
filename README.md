# PCP Confecção v2.0 — Sistema Online

Sistema web de Planejamento e Controle da Produção para confecção, reconstruído a partir do legado Excel **"Kamylla – Ficha Balanceamento v1.0"**.

## Visão Geral
- **Nome**: PCP Confecção v2.0
- **Objetivo**: Substituir a planilha legado por um sistema online robusto, auditável e escalável, preservando a lógica operacional conhecida pela equipe (3 modos de balanceamento, ficha de acompanhamento, cores/tamanhos) e eliminando as fragilidades técnicas (linha "0", VLOOKUP sem ID, dados desnormalizados, ausência de versionamento).
- **Stack**: Hono + TypeScript + Cloudflare Pages (edge) + D1 (SQLite) + SPA em JS puro + TailwindCSS + Chart.js + DayJS + FontAwesome (via CDN).

## URLs Públicas

### 🚀 Produção (Cloudflare Pages)
- **App**: https://pcp-confeccao.pages.dev
- **Deployment atual**: https://88205839.pcp-confeccao.pages.dev
- **Health**: https://pcp-confeccao.pages.dev/api/health
- **Dashboard do Cloudflare**: https://dash.cloudflare.com/ → Pages → pcp-confeccao

### 📦 Código fonte (GitHub)
- **Repositório**: https://github.com/playsurf001/pcp--corepro
- **Branch principal**: `main`

### 🛠️ Sandbox (desenvolvimento)
- App: https://3000-i3enbye2xzp7kgjcurtzy-18e660f9.sandbox.novita.ai
- Health: https://3000-i3enbye2xzp7kgjcurtzy-18e660f9.sandbox.novita.ai/api/health

## 🔐 Acesso ao Sistema
1. Abra https://pcp-confeccao.pages.dev
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
15 tabelas normalizadas:
- **Cadastros**: `parametros`, `clientes`, `referencias`, `maquinas`, `aparelhos`, `operacoes`, `cores`, `tamanhos`
- **Sequências**: `seq_cab` (versão + flag `ativa` única por referência), `seq_itens`
- **OP**: `op_cab`, `op_cores`, `op_tamanhos`
- **Execução**: `apontamento`
- **Governança**: `auditoria` (append-only)

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
- **Status Produção**: ✅ **Ativo** em https://pcp-confeccao.pages.dev
- **Projeto Cloudflare**: `pcp-confeccao` (production branch: `main`)
- **Banco D1 Produção**: `pcp-confeccao-prod` (UUID `cb4cd8ca-3f6e-43bd-ad3d-b90488916399`)
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
npx wrangler pages project create pcp-confeccao --production-branch main --compatibility-date 2026-04-13

# 4. Build + Deploy
npm run build
npx wrangler pages deploy dist --project-name pcp-confeccao --branch main
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
