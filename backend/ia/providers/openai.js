/* ── IA — PROVIDER OPENAI (PRINCIPAL) ────────────────────────────────────────
   gpt-4o-mini. Cobre: texto, visão (comprovante PIX), tools de AÇÃO (criar/alterar
   pedido) e de CONSULTA (Fase 3), com um LOOP de tool: enquanto a IA pedir tools,
   executa e devolve o resultado; termina quando a IA responde texto. Depois de
   criar/alterar um pedido, PARA de oferecer tools (só pede a mensagem final) —
   preserva exatamente o comportamento das fases anteriores. */
module.exports = function createOpenAIProvider(deps) {
  const {
    openai, modelo, maxTokens, maxToolLoops,
    montarPromptSistemaIA, carregarConversaIA, salvarConversaIA, finalizarAtendimentoIA,
    executarTool, toolsOpenAI, nomesTools,
  } = deps;

  return async function processarComOpenAI(telefone, nome, mensagem, cardapio, clienteConhecido, imagem, aberta, retirada) {
    const system = montarPromptSistemaIA(cardapio, clienteConhecido, aberta, retirada);
    // histórico no formato OpenAI: só mensagens de texto (descarta tool-calls antigos)
    const historico = carregarConversaIA(telefone).filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'));
    const conteudoUser = (imagem && imagem.data)
      ? [{ type: 'text', text: mensagem || 'Segue o comprovante do PIX.' }, { type: 'image_url', image_url: { url: `data:${imagem.mediaType || 'image/jpeg'};base64,${imagem.data}` } }]
      : ((mensagem && mensagem.trim()) ? mensagem : '(o cliente enviou uma mensagem sem texto)');
    const messages = [{ role: 'system', content: system }, ...historico, { role: 'user', content: conteudoUser }];

    let pedidoCriado = null;
    let textoResposta = '';
    for (let i = 0; i < maxToolLoops; i++) {
      // oferece tools enquanto a loja está aberta E ainda não fechou um pedido (após criar/alterar,
      // a próxima chamada é sem tools — só pra IA dar a mensagem final, como nas fases anteriores).
      const tools = (aberta && !pedidoCriado) ? toolsOpenAI : undefined;
      const resp = await openai.chat.completions.create({ model: modelo, max_tokens: maxTokens, messages, tools });
      const msg = resp.choices[0].message;
      textoResposta = msg.content || '';
      const chamadas = (msg.tool_calls || []).filter(t => t.function && nomesTools.has(t.function.name));
      if (!chamadas.length) break;
      // empurra a mensagem do assistant COM as tool_calls que vamos responder (uma tool_result p/ cada)
      messages.push({ role: 'assistant', content: msg.content, tool_calls: chamadas });
      for (const tc of chamadas) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        const r = executarTool(tc.function.name, args, telefone, nome);
        if (r.tipo === 'pedido') { pedidoCriado = r.pedido; console.log(`🔧 IA [OpenAI] tool "${tc.function.name}" pra ${telefone}.`); }
        else console.log(`🔎 IA [OpenAI] consulta "${tc.function.name}" pra ${telefone}.`);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: r.conteudo });
      }
    }

    const respostaFinal = textoResposta || (pedidoCriado ? `Pedido #${pedidoCriado.numero} confirmado! 🛵` : '');
    // Guarda o papo SEMPRE, como TEXTO e NUNCA vazio (as idas-e-voltas de tool não vão pro histórico salvo).
    const textoUserSalvar = (imagem && imagem.data)
      ? (mensagem && mensagem.trim() ? mensagem : '[cliente enviou uma imagem/comprovante]')
      : ((mensagem && mensagem.trim()) ? mensagem : '(o cliente enviou uma mensagem sem texto)');
    const novoHistorico = [...historico, { role: 'user', content: textoUserSalvar }, { role: 'assistant', content: respostaFinal || '(sem resposta)' }];
    salvarConversaIA(telefone, novoHistorico);
    if (pedidoCriado) finalizarAtendimentoIA(telefone);
    console.log(`🤖 [OpenAI] respondeu pra ${telefone}${pedidoCriado ? ` · pedido #${pedidoCriado.numero} ${pedidoCriado._alterado ? 'ALTERADO' : 'CRIADO'}` : ''}`);
    return { resposta: respostaFinal, pedidoCriado: pedidoCriado ? pedidoCriado.numero : null };
  };
};
