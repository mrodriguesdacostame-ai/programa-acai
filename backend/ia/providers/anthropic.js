/* ── IA — PROVIDER ANTHROPIC (FALLBACK) ──────────────────────────────────────
   claude-haiku-4-5. Só entra quando NÃO há OPENAI_API_KEY. Mesmo LOOP de tools do
   OpenAI: AÇÃO (criar/alterar) + CONSULTA (Fase 3), no formato de blocos do Anthropic.
   Depois de criar/alterar um pedido, para de oferecer tools (só a mensagem final). */
module.exports = function createAnthropicProvider(deps) {
  const {
    anthropic, modelo, maxTokens, maxToolLoops,
    montarPromptSistemaIA, carregarConversaIA, salvarConversaIA, finalizarAtendimentoIA, semImagens,
    executarTool, toolsAnthropic, nomesTools,
  } = deps;

  return async function processarComClaude(telefone, nome, mensagem, cardapio, clienteConhecido, imagem, aberta, retirada) {
    const system = montarPromptSistemaIA(cardapio, clienteConhecido, aberta, retirada);
    const historico = carregarConversaIA(telefone);
    // se veio imagem (comprovante), manda como bloco de visão junto do texto
    if (imagem && imagem.data) {
      historico.push({ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: imagem.mediaType || 'image/jpeg', data: imagem.data } },
        { type: 'text', text: mensagem || 'Segue o comprovante do PIX.' },
      ] });
    } else {
      historico.push({ role: 'user', content: (mensagem && mensagem.trim()) ? mensagem : '(o cliente enviou uma mensagem sem texto)' });
    }

    let pedidoCriado = null;
    let textoResposta = '';
    for (let i = 0; i < maxToolLoops; i++) {
      const tools = (aberta && !pedidoCriado) ? toolsAnthropic : undefined;
      const resposta = await anthropic.messages.create({ model: modelo, max_tokens: maxTokens, system, messages: historico, tools });
      historico.push({ role: 'assistant', content: resposta.content });
      textoResposta = (resposta.content.find(b => b.type === 'text') || {}).text || '';
      const usos = resposta.content.filter(b => b.type === 'tool_use' && nomesTools.has(b.name));
      if (!usos.length) break;
      const resultados = [];
      for (const tu of usos) {
        const r = executarTool(tu.name, tu.input, telefone, nome);
        if (r.tipo === 'pedido') { pedidoCriado = r.pedido; console.log(`🔧 IA [Anthropic] tool "${tu.name}" pra ${telefone}.`); }
        else console.log(`🔎 IA [Anthropic] consulta "${tu.name}" pra ${telefone}.`);
        resultados.push({ type: 'tool_result', tool_use_id: tu.id, content: r.conteudo });
      }
      historico.push({ role: 'user', content: resultados });
    }

    const respostaFinal = textoResposta || (pedidoCriado ? `Pedido #${pedidoCriado.numero} confirmado! 🛵` : '');
    // Guarda o papo SEMPRE (sem base64 de imagem); se fechou/ajustou pedido, marca finalizado.
    salvarConversaIA(telefone, semImagens(historico));
    if (pedidoCriado) finalizarAtendimentoIA(telefone);
    console.log(`🤖 [Claude] respondeu pra ${telefone}${pedidoCriado ? ` (pedido #${pedidoCriado.numero} ${pedidoCriado._alterado ? 'alterado' : 'criado'})` : ''}`);
    return { resposta: respostaFinal, pedidoCriado: pedidoCriado ? pedidoCriado.numero : null };
  };
};
