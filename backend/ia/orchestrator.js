/* ── IA — ORQUESTRADOR (núcleo) ──────────────────────────────────────────────
   Ponto de entrada da camada de IA. O server.js injeta as dependências (banco +
   funções de pedido/cliente/estado da loja + CONSULTAS da Fase 3) e recebe
   { processarMensagemIA, iaAtiva, logBoot }. Monta memória, prompt, executor de
   tools (ação + consulta) e os dois providers, e expõe processarMensagemIA:
   decide o provider (OpenAI principal / Anthropic fallback), carrega o contexto,
   aplica o reset da janela e trata erros. Mesmo formato de retorno de sempre. */
const config = require('./config');
const createMemory = require('./memory');
const createPrompt = require('./prompt');
const tools = require('./tools');
const createOpenAIProvider = require('./providers/openai');
const createAnthropicProvider = require('./providers/anthropic');

module.exports = function createIA(deps) {
  const {
    db,
    criarPedidoNoBanco, alterarUltimoPedidoIA,     // AÇÃO das tools
    buscarClienteDelivery, salvarClienteDelivery,   // cadastro do cliente do delivery
    lojaEstaAberta, soRetirada,                     // estado da loja
    ultimoPedidoDoTelefone, pedidoAbertoDoTelefone, produtosDisponiveis, // CONSULTAS (Fase 3)
  } = deps;

  const memory = createMemory({ db, janelaMs: config.JANELA_ALTERACAO_MS });
  const prompt = createPrompt({ db });
  const executarTool = tools.criarExecutorTool({
    criarPedidoNoBanco, alterarUltimoPedidoIA, salvarClienteDelivery,     // ação
    buscarClienteDelivery, ultimoPedidoDoTelefone, pedidoAbertoDoTelefone, produtosDisponiveis, // consulta
  });

  // dependências comuns aos dois providers
  const comum = {
    montarPromptSistemaIA: prompt.montarPromptSistemaIA,
    carregarConversaIA: memory.carregarConversaIA,
    salvarConversaIA: memory.salvarConversaIA,
    finalizarAtendimentoIA: memory.finalizarAtendimentoIA,
    executarTool,
    nomesTools: tools.NOMES_TOOLS,
    maxToolLoops: config.MAX_TOOL_LOOPS,
    maxTokens: config.MAX_TOKENS,
  };
  const processarComOpenAI = createOpenAIProvider({
    ...comum, openai: config.openai, modelo: config.MODELO_OPENAI, toolsOpenAI: tools.TOOLS_OPENAI,
  });
  const processarComClaude = createAnthropicProvider({
    ...comum, anthropic: config.anthropic, modelo: config.MODELO_ANTHROPIC, semImagens: memory.semImagens, toolsAnthropic: tools.TOOLS_ANTHROPIC,
  });

  async function processarMensagemIA(telefone, nome, mensagem, imagem) {
    if (!config.iaAtiva) {
      console.log(`⚠️ Mensagem de atendimento IA de ${telefone}, mas nenhuma chave de IA está configurada.`);
      return { erro: 'Atendimento por IA ainda não configurado (falta a chave OPENAI_API_KEY ou ANTHROPIC_API_KEY).' };
    }
    // a IA só oferece o que está marcado como disponível na tela (Módulo A)
    const cardapio = db.prepare('SELECT * FROM produtos WHERE disponivel = 1').all();
    const clienteConhecido = buscarClienteDelivery(telefone);
    const aberta = lojaEstaAberta();
    const retirada = soRetirada();
    // reset preguiçoso: se passou da janela desde o fim do último atendimento, zera agora (novo começa do zero)
    memory.resetarSeExpirado(telefone);
    // LOG de início com contexto (telefone · loja · retirada · provider) — 🆕 se for atendimento novo. Sem chave.
    const novoAtendimento = memory.carregarConversaIA(telefone).length === 0;
    console.log(`🤖 IA${novoAtendimento ? ' 🆕' : ''} · ${telefone}${nome ? ` (${nome})` : ''} · loja ${aberta ? 'ABERTA' : 'FECHADA'} · retirada ${retirada ? 'SIM' : 'não'} · provider ${config.openai ? 'OpenAI' : 'Anthropic'}`);
    try {
      return config.openai
        ? await processarComOpenAI(telefone, nome, mensagem, cardapio, clienteConhecido, imagem, aberta, retirada)
        : await processarComClaude(telefone, nome, mensagem, cardapio, clienteConhecido, imagem, aberta, retirada);
    } catch (err) {
      console.log(`❌ IA · erro no atendimento de ${telefone} · provider ${config.openai ? 'OpenAI' : 'Anthropic'} · loja ${aberta ? 'aberta' : 'fechada'} · retirada ${retirada ? 'sim' : 'não'}:`, err.message);
      return { erro: 'Falha ao processar a mensagem.' };
    }
  }

  return { processarMensagemIA, iaAtiva: config.iaAtiva, logBoot: config.logBoot };
};
