/* ── IA — MEMÓRIA DA CONVERSA (por telefone) ─────────────────────────────────
   Histórico em JSON por número (mesmo formato serve pra OpenAI e Anthropic).
   Usa o MESMO banco SQLite (injetado por parâmetro). limitarHistorico corta nas
   últimas 24 msgs. finalizado_em abre a JANELA de alteração (finalizarAtendimentoIA
   / resetarSeExpirado). A tabela conversas_ia é criada no server.js (setup do banco);
   este módulo só opera nela. Comportamento idêntico ao que estava no server.js. */
module.exports = function createMemory({ db, janelaMs }) {
  function carregarConversaIA(telefone) {
    const row = db.prepare('SELECT historico FROM conversas_ia WHERE telefone = ?').get(telefone);
    return row ? JSON.parse(row.historico) : [];
  }

  // mantém só as últimas N mensagens (controla custo de token — um cliente fiel acumularia
  // histórico sem fim, já que é guardado por telefone). Garante começar num 'user' de texto
  // pra não deixar um tool_result órfão (que quebraria a chamada à IA).
  function limitarHistorico(historico, max = 24) {
    if (!Array.isArray(historico) || historico.length <= max) return historico;
    let corte = historico.slice(historico.length - max);
    while (corte.length && !(corte[0].role === 'user' && typeof corte[0].content === 'string')) corte.shift();
    return corte;
  }

  function salvarConversaIA(telefone, historico) {
    const agora = new Date().toISOString();
    const hist = JSON.stringify(limitarHistorico(historico));
    if (db.prepare('SELECT telefone FROM conversas_ia WHERE telefone = ?').get(telefone)) {
      // salvar = conversa ativa: limpa a marca de "finalizado" (caso o cliente tenha voltado pra ajustar)
      db.prepare('UPDATE conversas_ia SET historico = ?, atualizado_em = ?, finalizado_em = NULL WHERE telefone = ?').run(hist, agora, telefone);
    } else {
      db.prepare('INSERT INTO conversas_ia (telefone, historico, atualizado_em, finalizado_em) VALUES (?,?,?,NULL)').run(telefone, hist, agora);
    }
  }

  // FINALIZA o atendimento, mas NÃO apaga na hora: marca a hora do fecho e dá uma JANELA
  // (janelaMs, padrão 5 min) pro cliente ainda ajustar o pedido. O reset de verdade acontece
  // em resetarSeExpirado(), na próxima mensagem depois que a janela vence.
  function finalizarAtendimentoIA(telefone) {
    const r = db.prepare('UPDATE conversas_ia SET finalizado_em = ? WHERE telefone = ?').run(new Date().toISOString(), telefone);
    if (r.changes) console.log(`🏁 Atendimento de ${telefone} finalizado — janela de ${Math.round(janelaMs / 60000)} min pra ajustes antes de zerar.`);
  }

  // Zera o atendimento se já passou da janela desde o fecho do pedido (aí o próximo contato começa
  // do zero). É "preguiçoso": roda na próxima mensagem, não precisa de timer (sobrevive a reinício).
  function resetarSeExpirado(telefone) {
    const row = db.prepare('SELECT finalizado_em FROM conversas_ia WHERE telefone = ?').get(telefone);
    if (row && row.finalizado_em && (Date.now() - new Date(row.finalizado_em).getTime() > janelaMs)) {
      db.prepare('DELETE FROM conversas_ia WHERE telefone = ?').run(telefone);
      console.log(`🧹 Atendimento de ${telefone} zerado (passou da janela de alteração) — próximo é novo.`);
    }
  }

  // remove imagens (base64 pesado) do histórico antes de salvar — guarda só um marcador de texto
  function semImagens(historico) {
    return historico.map(m => {
      if (Array.isArray(m.content) && m.content.some(b => b.type === 'image' || b.type === 'image_url')) {
        const txt = (m.content.find(b => b.type === 'text') || {}).text || '[cliente enviou uma imagem/comprovante]';
        return { role: m.role, content: txt };
      }
      return m;
    });
  }

  return { carregarConversaIA, limitarHistorico, salvarConversaIA, finalizarAtendimentoIA, resetarSeExpirado, semImagens };
};
