/* ── IA — FERRAMENTAS (function calling / tool use) ──────────────────────────
   AÇÃO (efeito no banco): criar_pedido, alterar_pedido  → INALTERADAS.
   CONSULTA (só leitura, Fase 3): buscar_cliente_delivery, buscar_ultimo_pedido_cliente,
     buscar_pedido_aberto_cliente, buscar_produtos_disponiveis.
   Schemas definidos no formato Anthropic (input_schema) e derivados pro formato OpenAI.
   As tools de CONSULTA NÃO recebem o telefone do modelo — o executor usa o telefone do
   atendimento (evita a IA consultar o número errado ou inventar). */

// ── AÇÃO (mesmas de antes) ──
const TOOL_CRIAR_PEDIDO = {
  name: 'criar_pedido',
  description: 'Cria o pedido de delivery quando o cliente já confirmou os itens, o endereço de entrega e a forma de pagamento.',
  input_schema: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Nome do cliente' },
      endereco: { type: 'string', description: 'Endereço completo de entrega (rua, número)' },
      bairro: { type: 'string', description: 'Bairro' },
      complemento: { type: 'string', description: 'Complemento ou ponto de referência, se o cliente informou' },
      itens: { type: 'string', description: 'Descrição dos itens pedidos, ex: "2x Açaí 500ml com granola e leite condensado"' },
      valor: { type: 'number', description: 'Valor total dos itens em reais, calculado a partir do cardápio' },
      taxa: { type: 'number', description: 'Taxa de entrega em reais (0 se a loja não cobrar ou não tiver sido definida)' },
      pagamento: { type: 'string', enum: ['PIX', 'Dinheiro', 'Cartão Crédito', 'Cartão Débito'], description: 'Forma de pagamento escolhida pelo cliente' },
      troco: { type: 'number', description: 'Troco necessário, só se o pagamento for em Dinheiro (0 se não precisar)' },
    },
    required: ['cliente', 'endereco', 'itens', 'valor', 'pagamento'],
  },
};
const TOOL_ALTERAR_PEDIDO = {
  name: 'alterar_pedido',
  description: 'Atualiza o pedido que você ACABOU de confirmar (nos últimos minutos) quando o cliente quer mudar algo: adicionar/trocar item, corrigir endereço, mudar pagamento/troco. NÃO cria pedido novo — ajusta o mesmo. Envie o pedido COMPLETO já corrigido (todos os itens finais e o valor total recalculado). Use isto (e não criar_pedido) quando for correção de um pedido recém-feito. Só use criar_pedido de novo se for claramente um pedido SEPARADO.',
  input_schema: TOOL_CRIAR_PEDIDO.input_schema,
};

// ── CONSULTA (Fase 3) — sem parâmetros; agem sobre o cliente/telefone do atendimento ──
const SEM_PARAMS = { type: 'object', properties: {}, required: [] };
const TOOL_BUSCAR_CLIENTE = {
  name: 'buscar_cliente_delivery',
  description: 'Consulta o CADASTRO do cliente atual (nome, endereço, forma de pagamento, atualizado_em) pra reaproveitar o que já está salvo e NÃO perguntar de novo. Use quando precisar do endereço/pagamento já conhecidos. Não recebe parâmetros — usa o telefone do atendimento.',
  input_schema: SEM_PARAMS,
};
const TOOL_ULTIMO_PEDIDO = {
  name: 'buscar_ultimo_pedido_cliente',
  description: 'Consulta o ÚLTIMO pedido desse cliente (número, itens, valor, pagamento, endereço, status, data, origem). Use quando o cliente pedir "repete o último", "o mesmo de sempre", "manda o mesmo pedido". Não recebe parâmetros.',
  input_schema: SEM_PARAMS,
};
const TOOL_PEDIDO_ABERTO = {
  name: 'buscar_pedido_aberto_cliente',
  description: 'Consulta o pedido mais recente EM ANDAMENTO desse cliente (número, status, itens, valor, endereço, data). Use pra responder status: "meu pedido saiu?", "já está em rota?", "foi confirmado?", "quanto falta?". Não recebe parâmetros.',
  input_schema: SEM_PARAMS,
};
const TOOL_PRODUTOS_DISP = {
  name: 'buscar_produtos_disponiveis',
  description: 'Consulta os PRODUTOS disponíveis agora (o que a loja tem no momento). Use pra responder "o que tem hoje?", "tem tal coisa?", "quais sabores/opções?". Não recebe parâmetros.',
  input_schema: SEM_PARAMS,
};

// derivador Anthropic → OpenAI (mesmo schema, formato diferente)
const paraOpenAI = t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } });

// mantidos por compatibilidade (as duas de ação, formato OpenAI)
const TOOL_OPENAI = paraOpenAI(TOOL_CRIAR_PEDIDO);
const TOOL_ALTERAR_OPENAI = paraOpenAI(TOOL_ALTERAR_PEDIDO);

// listas completas por provider (ordem: ações primeiro, consultas depois)
const TOOLS_ANTHROPIC = [TOOL_CRIAR_PEDIDO, TOOL_ALTERAR_PEDIDO, TOOL_BUSCAR_CLIENTE, TOOL_ULTIMO_PEDIDO, TOOL_PEDIDO_ABERTO, TOOL_PRODUTOS_DISP];
const TOOLS_OPENAI = TOOLS_ANTHROPIC.map(paraOpenAI);
const NOMES_TOOLS = new Set(TOOLS_ANTHROPIC.map(t => t.name));

/* Executor único (usado pelos dois providers). Recebe as funções do server.js por injeção.
   Devolve { tipo: 'pedido' | 'consulta', conteudo: <string p/ tool_result>, pedido?: <obj> }.
   AÇÃO: cria/altera pedido + atualiza cadastro (IDÊNTICO ao que os providers faziam antes).
   CONSULTA: roda a query e serializa o resultado em JSON (a IA lê e responde — nunca inventa). */
function criarExecutorTool(deps) {
  const {
    criarPedidoNoBanco, alterarUltimoPedidoIA, salvarClienteDelivery,
    buscarClienteDelivery, ultimoPedidoDoTelefone, pedidoAbertoDoTelefone, produtosDisponiveis,
  } = deps;
  const json = o => JSON.stringify(o);
  return function executarTool(nomeTool, args, telefone, nomeContato) {
    switch (nomeTool) {
      case 'criar_pedido': {
        const pedido = criarPedidoNoBanco({ ...args, telefone, cliente: args.cliente || nomeContato }, 'ia');
        salvarClienteDelivery(telefone, args.cliente || nomeContato, args.endereco, args.pagamento);
        return { tipo: 'pedido', pedido, conteudo: `Pedido #${pedido.numero} criado com sucesso, status pendente.` };
      }
      case 'alterar_pedido': {
        const pedido = alterarUltimoPedidoIA(telefone, { ...args, cliente: args.cliente || nomeContato });
        salvarClienteDelivery(telefone, args.cliente || nomeContato, args.endereco, args.pagamento);
        const verbo = pedido._alterado ? 'atualizado' : 'criado';
        return { tipo: 'pedido', pedido, conteudo: `Pedido #${pedido.numero} ${verbo} com sucesso, status pendente.` };
      }
      case 'buscar_cliente_delivery': {
        const c = buscarClienteDelivery(telefone);
        return { tipo: 'consulta', conteudo: json(c ? { encontrado: true, nome: c.nome, endereco: c.endereco, formaPagamento: c.formaPagamento, atualizado_em: c.atualizado_em } : { encontrado: false }) };
      }
      case 'buscar_ultimo_pedido_cliente': {
        const p = ultimoPedidoDoTelefone(telefone);
        return { tipo: 'consulta', conteudo: json(p ? { encontrado: true, ...p } : { encontrado: false }) };
      }
      case 'buscar_pedido_aberto_cliente': {
        const p = pedidoAbertoDoTelefone(telefone);
        return { tipo: 'consulta', conteudo: json(p ? { encontrado: true, ...p } : { encontrado: false }) };
      }
      case 'buscar_produtos_disponiveis': {
        const prods = produtosDisponiveis();
        return { tipo: 'consulta', conteudo: json({ produtos: prods, total: prods.length }) };
      }
      default:
        return { tipo: 'consulta', conteudo: json({ erro: 'ferramenta desconhecida: ' + nomeTool }) };
    }
  };
}

module.exports = {
  TOOL_CRIAR_PEDIDO, TOOL_ALTERAR_PEDIDO, TOOL_OPENAI, TOOL_ALTERAR_OPENAI,
  TOOL_BUSCAR_CLIENTE, TOOL_ULTIMO_PEDIDO, TOOL_PEDIDO_ABERTO, TOOL_PRODUTOS_DISP,
  TOOLS_ANTHROPIC, TOOLS_OPENAI, NOMES_TOOLS,
  criarExecutorTool,
};
