/* ============================================================
 * support_content.js — HOTFIX 0050
 * Central de Suporte e Treinamento (conteúdo estático versionado)
 *
 * Estrutura:
 *   SUPPORT_TOPICS    → 8 seções com tutoriais
 *   SUPPORT_FAQ       → perguntas frequentes
 *   SUPPORT_HELP_MAP  → mapeia route_id → topic_id (para botão ❓ contextual)
 *
 * Conteúdo escrito em HTML inline (sem dependência de Markdown parser).
 * Toda atualização → bumpear cache no src/index.tsx (v=N).
 * ============================================================ */

(function () {
  'use strict';

  // ---------- helpers de formatação reutilizáveis ----------
  const tip = (txt) => `<div class="sup-tip"><i class="fas fa-lightbulb mr-2 text-amber-500"></i>${txt}</div>`;
  const warn = (txt) => `<div class="sup-warn"><i class="fas fa-exclamation-triangle mr-2"></i>${txt}</div>`;
  const step = (n, title, body) => `<div class="sup-step"><div class="sup-step-num">${n}</div><div class="sup-step-body"><div class="sup-step-title">${title}</div>${body ? `<div class="sup-step-desc">${body}</div>` : ''}</div></div>`;
  const videoPlaceholder = (titulo) => `
    <div class="sup-video-ph">
      <i class="fas fa-circle-play text-4xl text-slate-300 mb-2"></i>
      <div class="text-sm font-medium text-slate-600">${titulo}</div>
      <div class="text-xs text-slate-400 mt-1">Vídeo em produção. Em breve disponível neste local.</div>
    </div>`;

  // ============================================================
  // 8 SEÇÕES PRINCIPAIS
  // ============================================================
  const SUPPORT_TOPICS = [
    // -------------------------------------------------------
    {
      id: 'primeiros-passos',
      title: 'Primeiros Passos',
      icon: 'fa-flag-checkered',
      summary: 'Configure sua empresa, usuários e cadastros essenciais.',
      keywords: ['configurar empresa', 'novo usuário', 'começar', 'inicial', 'onboarding', 'setup', 'primeira vez'],
      content: `
        <p class="sup-lead">Este roteiro garante que sua empresa tenha o sistema funcionando ponta a ponta em até <b>30 minutos</b>. Siga a ordem — cada passo depende do anterior.</p>

        <h3>Sequência recomendada</h3>
        ${step(1, 'Configurar dados da empresa', 'Acesse <b>Configurações → Minha Empresa</b> e preencha razão social, CNPJ, endereço e logotipo. Esses dados aparecem nos romaneios e relatórios.')}
        ${step(2, 'Cadastrar usuários', 'Vá em <b>Cadastros → Usuários</b> e crie um login para cada pessoa da equipe. Defina o perfil: <b>admin</b> (acesso total) ou <b>operacional</b> (módulos limitados).')}
        ${step(3, 'Cadastrar setores', 'Em <b>Cadastros → Setores</b> registre os setores produtivos (Corte, Costura, Acabamento, Tinturaria…). Setores são usados na triagem de serviços e remessas.')}
        ${step(4, 'Cadastrar serviços', 'Em <b>Cadastros → Serviços</b> liste os tipos de operação que você terceiriza (ex.: <i>Costura reta</i>, <i>Overlock</i>, <i>Aparar peça</i>, <i>Passar e dobrar</i>). Vincule cada serviço a um setor.')}
        ${step(5, 'Cadastrar produtos', 'Em <b>Cadastros → Produtos</b> registre cada referência (cod_ref + descrição). Defina coleção, grade padrão e serviço padrão.')}
        ${step(6, 'Cadastrar preços', 'Em <b>Cadastros → Preços / Coleções</b> defina o preço pago por peça para cada combinação (produto + serviço + cor + tamanho). O sistema usa esses preços para calcular o valor das remessas automaticamente.')}
        ${step(7, 'Cadastrar terceirizados', 'Em <b>Cadastros → Terceirizados</b> registre cada facção/costureira(o). Informe setor, capacidade (pessoas + minutos/dia), eficiência média e prazo padrão.')}
        ${step(8, 'Criar sua primeira remessa', 'Vá em <b>Terceirização → Remessas</b> e clique em <b>Nova Remessa</b>. Selecione terceirizado, produto, cor, grade. O sistema gera CTRL, preço, valor e prazo automaticamente.')}

        ${tip('Quando algum cadastro estiver vazio em outra tela, você verá um link <span class="text-amber-700 underline">"Cadastre um serviço primeiro"</span> — clique nele para ir direto ao cadastro faltante.')}

        <h3>Por que essa ordem importa</h3>
        <p>A precificação automática nas remessas só funciona quando <b>produto + serviço + preço</b> já existem. Pular o cadastro de preços faz com que cada remessa precise ser preenchida manualmente.</p>

        <h3>Vídeo do treinamento inicial</h3>
        ${videoPlaceholder('Tour completo: do zero à primeira remessa em 15 minutos')}
      `
    },

    // -------------------------------------------------------
    {
      id: 'produtos',
      title: 'Cadastro de Produtos',
      icon: 'fa-tshirt',
      summary: 'Referências, coleções, grades, cores, serviços e tempos.',
      keywords: ['produto', 'referência', 'cod_ref', 'coleção', 'grade', 'tamanho', 'cor'],
      content: `
        <p class="sup-lead">Produtos são as referências físicas que sua empresa produz. Cada produto carrega informações usadas em toda a operação: precificação, romaneio, retorno e relatórios.</p>

        <h3>Campos de um produto</h3>
        <table class="sup-table">
          <thead><tr><th>Campo</th><th>Para que serve</th></tr></thead>
          <tbody>
            <tr><td><b>Referência (cod_ref)</b></td><td>Código único do produto. Geralmente segue padrão da empresa (ex.: <code>04-01-26-71</code>).</td></tr>
            <tr><td><b>Descrição</b></td><td>Nome legível do produto (ex.: <i>Camiseta Básica Algodão</i>).</td></tr>
            <tr><td><b>Coleção</b></td><td>Agrupa produtos da mesma campanha/temporada. Usada em relatórios e precificação por coleção.</td></tr>
            <tr><td><b>Grade padrão</b></td><td>Define quais tamanhos abrirão automaticamente nas novas remessas (ex.: <i>PP-P-M-G-GG</i>).</td></tr>
            <tr><td><b>Serviço padrão</b></td><td>Serviço sugerido ao criar remessa deste produto (pode ser sobrescrito).</td></tr>
            <tr><td><b>Tempo padrão (min/peça)</b></td><td>Usado quando não há preço cadastrado com tempo específico. Influencia o cálculo de prazo.</td></tr>
          </tbody>
        </table>

        <h3>Como cadastrar</h3>
        ${step(1, 'Abrir a tela', 'Vá em <b>Cadastros → Produtos</b>.')}
        ${step(2, 'Clicar em "Novo Produto"', 'Botão no topo direito da tela.')}
        ${step(3, 'Preencher referência e descrição', 'Esses dois são obrigatórios.')}
        ${step(4, 'Selecionar coleção e grade padrão', 'Se ainda não existem, cadastre antes em <b>Cadastros → Preços/Coleções</b> e <b>Cadastros → Grades de Tamanho</b>.')}
        ${step(5, 'Definir serviço padrão e tempo (opcional)', 'Acelera a criação de remessas — esses valores virão pré-preenchidos.')}
        ${step(6, 'Salvar', 'O produto fica disponível imediatamente em todas as telas que usam produto.')}

        ${tip('Você pode <b>importar produtos em massa</b> via Excel: <b>Cadastros → Importação</b>. Útil ao migrar do sistema anterior.')}

        ${warn('Mudar a <b>referência</b> de um produto já usado em remessas pode quebrar relatórios históricos. Prefira inativar o antigo e cadastrar um novo.')}

        ${videoPlaceholder('Cadastro de produtos do zero')}
      `
    },

    // -------------------------------------------------------
    {
      id: 'servicos',
      title: 'Cadastro de Serviços',
      icon: 'fa-screwdriver-wrench',
      summary: 'Criar, editar, inativar e vincular serviços a produtos e preços.',
      keywords: ['serviço', 'criar serviço', 'inativar serviço', 'editar serviço', 'operação', 'costura', 'overlock'],
      content: `
        <p class="sup-lead">Serviços representam cada operação que você terceiriza. Um produto geralmente passa por vários serviços ao longo da produção (corte, costura, acabamento, embalagem…).</p>

        <h3>Criar um serviço</h3>
        ${step(1, 'Acessar a tela', 'Vá em <b>Cadastros → Serviços</b>.')}
        ${step(2, 'Clicar em "Novo Serviço"', 'Botão no canto superior direito.')}
        ${step(3, 'Preencher nome', 'Use nomes claros e padronizados (ex.: <i>Costura overlock 4 fios</i>). Evite siglas internas que só você entende.')}
        ${step(4, 'Vincular setor', 'Selecione o setor produtivo (Costura, Acabamento…). Isso ajuda na triagem e nos relatórios.')}
        ${step(5, 'Definir cor de identificação (opcional)', 'A cor aparece como badge em listagens — facilita identificação visual.')}
        ${step(6, 'Definir preço e tempo padrão (opcional)', 'Usados quando não há preço específico cadastrado para o produto.')}
        ${step(7, 'Salvar', 'O serviço aparece imediatamente nos selects de produtos, preços e remessas.')}

        <h3>Editar um serviço</h3>
        <p>Clique no ícone de lápis na linha do serviço. Você pode alterar nome, setor, cor, preço/tempo padrão e observações. Alterações <b>não</b> afetam remessas já criadas — apenas novas.</p>

        <h3>Inativar um serviço</h3>
        <p>Use o botão <b>Inativar</b> (alterna ativo/inativo) quando um serviço sair de uso. Serviços inativos:</p>
        <ul>
          <li>❌ Não aparecem em selects de novas remessas/produtos/preços.</li>
          <li>✅ Continuam visíveis em remessas históricas (com marcação <i>"(inativo)"</i>) — nada é perdido.</li>
          <li>✅ Podem ser reativados a qualquer momento.</li>
        </ul>

        ${tip('Se um serviço tem muitos vínculos (preços, produtos, remessas), o sistema mostra um aviso antes da inativação — você decide se continua.')}

        <h3>Excluir definitivamente</h3>
        <p>Só funciona se o serviço <b>não tem vínculos</b>. Caso tenha, use <b>Inativar</b>.</p>

        ${warn('Em ambiente multiempresa, cada empresa tem seus próprios serviços. Dois serviços com o mesmo nome em empresas diferentes são contas separadas e não se misturam.')}

        ${videoPlaceholder('Como gerenciar serviços')}
      `
    },

    // -------------------------------------------------------
    {
      id: 'remessas',
      title: 'Remessas',
      icon: 'fa-truck-fast',
      summary: 'Criar remessas, gerar romaneio, controlar saída e prazos.',
      keywords: ['remessa', 'romaneio', 'CTRL', 'enviar produção', 'controle', 'prazo', 'status'],
      content: `
        <p class="sup-lead">Remessas são o coração do sistema. Cada remessa representa um lote de peças enviado a um terceirizado para execução de um serviço. O sistema gera CTRL (número de controle) automaticamente.</p>

        <h3>Criar uma remessa</h3>
        ${step(1, 'Abrir a tela', 'Vá em <b>Terceirização → Remessas</b> e clique em <b>Nova Remessa</b>.')}
        ${step(2, 'Selecionar terceirizado', 'Os dados de capacidade (pessoas, minutos/dia, eficiência) são puxados automaticamente do cadastro.')}
        ${step(3, 'Adicionar produtos', 'Clique em <b>+ Produto</b> e selecione a referência. Múltiplos produtos numa única remessa são suportados — cada um gera um CTRL próprio (multi-CTRL).')}
        ${step(4, 'Definir cor, grade e quantidades', 'Para cada produto, escolha cor (obrigatória), tamanhos da grade e quantidade por tamanho.')}
        ${step(5, 'Confirmar preço e tempo', 'O sistema busca o preço cadastrado (mais específico ganha: produto+cor+tamanho > produto+cor > produto > genérico). Pode sobrescrever manualmente.')}
        ${step(6, 'Informar OP (opcional)', 'Número da Ordem de Produção, se sua empresa usa. Cada item pode ter sua própria OP.')}
        ${step(7, 'Salvar', 'O sistema gera CTRL(s), calcula prazo previsto (com base em tempo total ÷ capacidade) e cria o registro.')}

        <h3>Gerar romaneio (PDF)</h3>
        <p>Na lista de remessas, clique no ícone de impressora. O sistema gera um PDF formatado para impressão com:</p>
        <ul>
          <li>Cabeçalho da empresa</li>
          <li>Dados do terceirizado</li>
          <li>Itens (produto, cor, grade, qtd, preço, valor)</li>
          <li>Total geral</li>
          <li>Assinatura de retirada</li>
        </ul>

        <h3>Status das remessas</h3>
        <table class="sup-table">
          <tbody>
            <tr><td><span class="badge bg-slate-100">AguardandoEnvio</span></td><td>Criada mas ainda não entregue ao terceirizado</td></tr>
            <tr><td><span class="badge bg-blue-100">Enviado</span></td><td>Peças saíram da fábrica</td></tr>
            <tr><td><span class="badge bg-amber-100">EmProducao</span></td><td>Terceirizado iniciou o trabalho</td></tr>
            <tr><td><span class="badge bg-red-100">Atrasado</span></td><td>Passou da data prevista sem retorno</td></tr>
            <tr><td><span class="badge bg-green-100">Concluido</span></td><td>Retorno recebido (peças voltaram para a fábrica)</td></tr>
            <tr><td><span class="badge bg-emerald-100">Pago</span></td><td>Pagamento ao terceirizado quitado</td></tr>
          </tbody>
        </table>

        <h3>Prazo previsto</h3>
        <p>Calculado por: <code>(qtd × tempo_peça) ÷ (pessoas × min/dia × eficiência)</code>. Pode ser sobrescrito manualmente preenchendo "Prazo (dias)".</p>

        ${tip('Para envios urgentes, defina manualmente o campo <b>Prazo</b> em dias — o sistema recalcula a data prevista automaticamente.')}

        ${warn('Se houver múltiplos produtos com OPs diferentes na mesma remessa, cada CTRL gerado carregará a OP do seu respectivo item (não a OP do primeiro).')}

        ${videoPlaceholder('Criando uma remessa multi-produto')}
      `
    },

    // -------------------------------------------------------
    {
      id: 'retornos',
      title: 'Retornos',
      icon: 'fa-rotate-left',
      summary: 'Receber produção, registrar faltas, consertos e fechar retorno.',
      keywords: ['retorno', 'receber', 'falta', 'conserto', 'fechar retorno', 'peças boas', 'estoque'],
      content: `
        <p class="sup-lead">Quando o terceirizado devolve a produção, o registro de retorno é a forma de auditar quantas peças voltaram boas, quantas faltaram e quantas precisam de conserto.</p>

        <h3>Receber uma remessa</h3>
        ${step(1, 'Abrir a tela', 'Vá em <b>Terceirização → Retornos</b>.')}
        ${step(2, 'Localizar a remessa', 'Use os filtros (CTRL, terceirizado, data) ou a busca textual. Apenas remessas em status <i>Enviado</i> ou <i>EmProducao</i> aparecem.')}
        ${step(3, 'Clicar em "Registrar Retorno"', 'Abre o modal de conferência.')}
        ${step(4, 'Informar peças boas por cor/tamanho', 'A grade enviada aparece pré-preenchida. Ajuste se necessário.')}
        ${step(5, 'Informar faltas', 'Diferença entre enviado e retornado bom. O sistema desconta automaticamente do valor a pagar (configurável).')}
        ${step(6, 'Informar consertos', 'Peças que voltaram mas precisam de retrabalho. Geram um novo registro em <b>Consertos</b>.')}
        ${step(7, 'Confirmar', 'O sistema atualiza o status da remessa para <i>Concluido</i> ou <i>Parcial</i> (se ainda falta peça).')}

        <h3>Retornos parciais</h3>
        <p>Você pode receber uma remessa em várias entregas. Cada retorno acumula:</p>
        <ul>
          <li>Total retornado bom cresce a cada entrega</li>
          <li>Status fica <i>Parcial</i> até bater o total enviado</li>
          <li>Pode haver múltiplos retornos no histórico</li>
        </ul>

        ${warn('Não é possível registrar mais peças do que foi enviado. Se houver excesso, é necessário primeiro corrigir a quantidade da remessa original.')}

        <h3>Cálculo de pagamento</h3>
        <p>Após o retorno fechado:</p>
        <ul>
          <li><b>Valor base</b> = total retornado bom × preço unitário</li>
          <li><b>Descontos</b>: faltas e consertos podem ser descontados (definido nas configurações da empresa)</li>
          <li><b>Valor final</b> = valor base − descontos</li>
        </ul>

        ${tip('No relatório <b>Por Terceirizado</b> você acompanha quantas peças cada facção retornou e qual a taxa de aprovação (peças boas ÷ enviadas).')}

        ${videoPlaceholder('Como registrar um retorno passo a passo')}
      `
    },

    // -------------------------------------------------------
    {
      id: 'pagamentos',
      title: 'Pagamentos',
      icon: 'fa-money-bill-wave',
      summary: 'Pagamentos individuais, em lote, histórico e comprovantes.',
      keywords: ['pagamento', 'pagar', 'lote', 'comprovante', 'histórico', 'financeiro', 'PIX'],
      content: `
        <p class="sup-lead">O módulo de pagamentos centraliza tudo que sua empresa deve aos terceirizados. Calcula automaticamente a partir das remessas concluídas e gera comprovantes.</p>

        <h3>Pagamento individual</h3>
        ${step(1, 'Abrir a tela', 'Vá em <b>Financeiro → Pagamentos</b>.')}
        ${step(2, 'Filtrar pendentes', 'Use o filtro <i>Status = PendentePagamento</i> para ver só o que está em aberto.')}
        ${step(3, 'Marcar a remessa', 'Clique no checkbox da linha. O valor entra no rodapé como "Selecionado para pagamento".')}
        ${step(4, 'Clicar em "Registrar Pagamento"', 'Informe data, forma (PIX, dinheiro, transferência, cheque) e observação.')}
        ${step(5, 'Confirmar', 'O sistema registra, atualiza o status para <i>Pago</i> e gera um comprovante PDF.')}

        <h3>Pagamento em lote por terceirizado</h3>
        ${step(1, 'Filtrar por terceirizado', 'Selecione o nome no filtro superior.')}
        ${step(2, 'Selecionar todas as pendentes', 'Use o checkbox do cabeçalho ou marque individualmente.')}
        ${step(3, 'Registrar pagamento', 'Mesma forma do individual — o sistema agrupa tudo num único comprovante.')}

        <h3>Histórico</h3>
        <p>Em <b>Financeiro → Pagamentos</b>, filtre por <i>Status = Pago</i> para ver todos os pagamentos realizados. Cada linha permite:</p>
        <ul>
          <li>Reimprimir comprovante PDF</li>
          <li>Visualizar detalhes (data, forma, observação)</li>
          <li>Cancelar pagamento (volta para PendentePagamento)</li>
        </ul>

        <h3>Comprovante PDF</h3>
        <p>Gerado automaticamente. Contém:</p>
        <ul>
          <li>Razão social e CNPJ da empresa</li>
          <li>Dados do terceirizado (nome, CPF/CNPJ)</li>
          <li>Lista de remessas pagas com CTRL, data, valor</li>
          <li>Total geral em extenso</li>
          <li>Espaço para assinatura</li>
        </ul>

        ${tip('No relatório <b>Financeiro</b> você vê quanto sua empresa pagou no mês, por terceirizado, por serviço ou por coleção.')}

        ${warn('Cancelar um pagamento volta a remessa para <i>PendentePagamento</i> — útil em caso de erro de digitação. O comprovante PDF original não é apagado.')}

        ${videoPlaceholder('Pagamento em lote por terceirizado')}
      `
    },

    // -------------------------------------------------------
    {
      id: 'relatorios',
      title: 'Relatórios',
      icon: 'fa-chart-pie',
      summary: 'Produção, terceirizados, financeiro, atrasos e produtividade.',
      keywords: ['relatório', 'produção', 'financeiro', 'atrasado', 'produtividade', 'exportar', 'PDF', 'excel'],
      content: `
        <p class="sup-lead">A área de <b>Análises → Relatórios</b> reúne todos os indicadores operacionais e financeiros da operação. Use filtros de período + terceirizado + serviço para chegar ao número que interessa.</p>

        <h3>Tipos de relatório</h3>
        <table class="sup-table">
          <thead><tr><th>Relatório</th><th>O que mostra</th></tr></thead>
          <tbody>
            <tr><td><b>Produção</b></td><td>Quantas peças foram processadas no período, agrupadas por serviço, terceirizado, coleção ou referência.</td></tr>
            <tr><td><b>Por Terceirizado</b></td><td>Volume, taxa de aprovação (peças boas/enviadas), prazo médio cumprido vs prometido, valor pago.</td></tr>
            <tr><td><b>Financeiro</b></td><td>Total faturado vs pago, pendências em aberto, ranking de gastos por terceirizado/serviço.</td></tr>
            <tr><td><b>Atrasos</b></td><td>Remessas que passaram da data prevista sem retorno. Inclui dias de atraso e responsável.</td></tr>
            <tr><td><b>Produtividade</b></td><td>Peças por hora, eficiência real vs esperada, capacidade ociosa.</td></tr>
            <tr><td><b>Por Serviço</b></td><td>Volume e valor por tipo de operação. Útil para precificação.</td></tr>
          </tbody>
        </table>

        <h3>Como filtrar</h3>
        ${step(1, 'Definir período', 'Use atalhos (Hoje, 7 dias, Mês atual) ou intervalo customizado.')}
        ${step(2, 'Aplicar filtros adicionais', 'Terceirizado, serviço, coleção, status — combine para granularidade total.')}
        ${step(3, 'Clicar em "Atualizar"', 'O relatório recalcula em segundos.')}

        <h3>Exportação</h3>
        <ul>
          <li><b>PDF</b>: clique em <i>Imprimir</i> e escolha "Salvar como PDF" no diálogo do navegador. Formatado para impressão.</li>
          <li><b>Excel</b>: <i>(em desenvolvimento — roadmap)</i>. Por enquanto, copie a tabela e cole numa planilha — formatação é preservada.</li>
        </ul>

        ${tip('Para análises recorrentes, salve um link com filtros aplicados nos favoritos do navegador — a URL contém os parâmetros.')}

        ${videoPlaceholder('Tour pelos 6 relatórios principais')}
      `
    },

    // -------------------------------------------------------
    {
      id: 'backup',
      title: 'Backup e Restauração',
      icon: 'fa-database',
      summary: 'Gerar, baixar e restaurar backups com segurança.',
      keywords: ['backup', 'restaurar', 'baixar', 'restore', 'segurança', 'salvar dados'],
      content: `
        <p class="sup-lead">Backup é a sua rede de proteção. Em uma operação ativa, recomendamos gerar backup <b>antes</b> de operações em massa (importação, exclusão, mudanças estruturais).</p>

        <h3>Gerar backup</h3>
        ${step(1, 'Abrir a tela', 'Vá em <b>Configurações → Backup & Restauração</b>. <i>Acesso restrito a administradores.</i>')}
        ${step(2, 'Clicar em "Gerar Backup Agora"', 'O sistema processa em segundos e cria um arquivo com todos os dados da empresa.')}
        ${step(3, 'Conferir tamanho e total de registros', 'Um KPI no topo mostra o último backup gerado.')}

        <h3>Baixar backup</h3>
        <p>Na linha do backup desejado, clique no ícone de <b>download</b>. O arquivo vem em formato <code>.json</code> compactado — guarde-o em local seguro (Drive, OneDrive, pendrive externo).</p>

        ${tip('Mantenha pelo menos 1 backup por semana fora do sistema. A cobertura interna é boa, mas backups locais te protegem contra erros operacionais (ex.: restauração acidental).')}

        <h3>Restaurar backup</h3>
        ${warn('<b>Restaurar é uma operação destrutiva</b>. Todos os dados atuais da empresa são <b>substituídos</b> pelo conteúdo do backup. Não há "desfazer" depois.')}
        ${step(1, 'Gerar um backup atual ANTES', 'Mesmo que vá restaurar, gere um backup do estado atual primeiro — assim você tem como voltar.')}
        ${step(2, 'Clicar em "Restaurar Backup"', 'Botão na linha do backup desejado.')}
        ${step(3, 'Confirmar digitando a palavra de segurança', 'Evita restauração acidental.')}
        ${step(4, 'Aguardar conclusão', 'O sistema substitui os dados e recarrega automaticamente.')}

        <h3>O que está incluído no backup</h3>
        <ul>
          <li>✅ Cadastros: usuários, setores, serviços, produtos, preços, coleções, grades, cores, terceirizados</li>
          <li>✅ Operação: remessas, retornos, consertos, pagamentos</li>
          <li>✅ Configurações da empresa</li>
          <li>❌ <i>Não inclui</i>: anexos externos (PDFs, imagens enviadas), logs de auditoria detalhados</li>
        </ul>

        ${videoPlaceholder('Como gerar e restaurar backup com segurança')}
      `
    },
  ];

  // ============================================================
  // FAQ — Perguntas mais frequentes (consultas rápidas)
  // ============================================================
  const SUPPORT_FAQ = [
    { q: 'Como criar uma remessa?', a: 'Vá em <b>Terceirização → Remessas</b> e clique em <b>Nova Remessa</b>. Selecione terceirizado, adicione produtos com cor/grade/quantidade, confirme preço e salve. Veja o tutorial completo em <a href="#suporte:remessas">Remessas</a>.', topic: 'remessas' },
    { q: 'Como cancelar uma remessa?', a: 'Na lista de remessas, abra o menu de ações (⋮) da linha e clique em <b>Cancelar</b>. Só funciona para remessas que ainda não foram pagas. Cancelamento mantém o histórico (não apaga).', topic: 'remessas' },
    { q: 'Como gerar um romaneio?', a: 'Na lista de remessas, clique no ícone de impressora. O sistema gera um PDF formatado pronto para impressão.', topic: 'remessas' },
    { q: 'Como pagar terceirizados?', a: 'Vá em <b>Financeiro → Pagamentos</b>, filtre por <i>PendentePagamento</i> e terceirizado, selecione as remessas e clique em <b>Registrar Pagamento</b>. Veja <a href="#suporte:pagamentos">Pagamentos</a>.', topic: 'pagamentos' },
    { q: 'Como restaurar um backup?', a: 'Em <b>Configurações → Backup</b>, clique em <b>Restaurar</b> na linha do backup desejado. <b>Atenção</b>: substitui todos os dados atuais. Sempre gere um backup do estado atual antes.', topic: 'backup' },
    { q: 'Por que minha remessa não aparece em Retornos?', a: 'Só aparecem remessas em status <i>Enviado</i> ou <i>EmProducao</i>. Se a remessa está como <i>AguardandoEnvio</i>, registre primeiro a saída (botão "Marcar como enviada").', topic: 'retornos' },
    { q: 'Por que o preço não veio automático na remessa?', a: 'O sistema só busca preço cadastrado para a combinação (produto + serviço + cor + tamanho + coleção). Se faltar algum nível, ele tenta o mais genérico. Se não houver nada, vem zerado. Cadastre o preço em <b>Cadastros → Preços</b>.', topic: 'produtos' },
    { q: 'Como inativar um serviço?', a: 'Em <b>Cadastros → Serviços</b>, clique no botão <b>Inativar</b> da linha. Serviços inativos somem dos selects de novas operações, mas continuam visíveis em remessas históricas.', topic: 'servicos' },
    { q: 'Posso ter o mesmo nome de serviço em empresas diferentes?', a: 'Sim — desde a HOTFIX 0049, cada empresa tem seu próprio conjunto de serviços. Dentro da MESMA empresa, "Aparar" e "APARAR" são tratados como duplicata (case-insensitive).', topic: 'servicos' },
    { q: 'O que significa CTRL na remessa?', a: 'CTRL é o número de controle único da remessa (sequencial por empresa). Quando uma remessa tem múltiplos produtos, o sistema gera um CTRL por produto — todos compartilham o mesmo <i>lote_remessa_id</i> para agrupamento no romaneio.', topic: 'remessas' },
    { q: 'Como exportar relatório para Excel?', a: 'Por enquanto não há exportação direta para .xlsx — está no roadmap. Como alternativa: clique em "Imprimir", selecione "Salvar como PDF" no navegador, ou copie a tabela e cole numa planilha.', topic: 'relatorios' },
    { q: 'Como cadastrar uma nova empresa?', a: 'Cadastro de empresa é feito pelo proprietário (owner) em <b>Configurações → Minha Empresa</b>. Para múltiplas empresas no mesmo login, entre em contato com o administrador do sistema.', topic: 'primeiros-passos' },
  ];

  // ============================================================
  // Mapeamento route_id → topic_id (botão ❓ contextual)
  // ============================================================
  const SUPPORT_HELP_MAP = {
    // operação
    'terc_remessas':      'remessas',
    'terc_retornos':      'retornos',
    'pagamentos_terc':    'pagamentos',
    'relatorios_detalhados': 'relatorios',
    // cadastros
    'terc_produtos':      'produtos',
    'terc_servicos':      'servicos',
    'terc_precos':        'produtos',     // preços fazem parte do tutorial de produtos
    'terc_terceirizados': 'primeiros-passos',
    'terc_setores':       'primeiros-passos',
    'terc_grades_tamanho':'produtos',
    'cores':              'produtos',
    'usuarios':           'primeiros-passos',
    // configurações
    'backup':             'backup',
    'minha_empresa':      'primeiros-passos',
    'configuracoes':      'primeiros-passos',
    'terc_importador':    'produtos',
    // dashboard sem ajuda contextual específica
  };

  // ============================================================
  // BUSCA — substring scoring sobre title + summary + keywords + content
  // ============================================================
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
      .replace(/<[^>]+>/g, ' ')                          // tira HTML
      .replace(/\s+/g, ' ')
      .trim();
  }

  function searchSupport(query) {
    const q = normalize(query);
    if (!q || q.length < 2) return [];
    const terms = q.split(/\s+/).filter(t => t.length >= 2);
    if (terms.length === 0) return [];

    const results = [];

    // tópicos
    SUPPORT_TOPICS.forEach(t => {
      const haystacks = {
        title: normalize(t.title) + ' ' + normalize(t.summary),
        keywords: (t.keywords || []).map(normalize).join(' '),
        content: normalize(t.content),
      };
      let score = 0;
      let matched = false;
      terms.forEach(term => {
        if (haystacks.title.includes(term))    { score += 10; matched = true; }
        if (haystacks.keywords.includes(term)) { score += 6;  matched = true; }
        if (haystacks.content.includes(term))  { score += 2;  matched = true; }
      });
      if (matched) results.push({ kind: 'topic', id: t.id, title: t.title, summary: t.summary, icon: t.icon, score });
    });

    // FAQ
    SUPPORT_FAQ.forEach((f, idx) => {
      const hay = normalize(f.q + ' ' + f.a);
      let score = 0; let matched = false;
      terms.forEach(term => {
        if (normalize(f.q).includes(term)) { score += 12; matched = true; }
        else if (hay.includes(term))       { score += 4;  matched = true; }
      });
      if (matched) results.push({ kind: 'faq', id: 'faq-' + idx, title: f.q, summary: '', topic: f.topic, score });
    });

    return results.sort((a, b) => b.score - a.score).slice(0, 20);
  }

  // ============================================================
  // Export global
  // ============================================================
  window.SUPPORT = {
    TOPICS: SUPPORT_TOPICS,
    FAQ: SUPPORT_FAQ,
    HELP_MAP: SUPPORT_HELP_MAP,
    search: searchSupport,
    findTopic: (id) => SUPPORT_TOPICS.find(t => t.id === id),
  };
})();
