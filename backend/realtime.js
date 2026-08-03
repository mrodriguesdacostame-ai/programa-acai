/* ── TEMPO REAL (Fase 16) — SSE (Server-Sent Events) ─────────────────────────
   Canal server→client pra Central de Atendimento atualizar sozinha (mensagens,
   estado IA/humano, status de pedido, badges). Escolhido SSE em vez de WebSocket:
   é one-way (as AÇÕES do operador continuam via REST), roda em HTTP puro com o
   MESMO cookie de sessão da Fase 12, o EventSource reconecta sozinho e NÃO precisa
   de dependência nova. O server.js injeta { db } e liga o middleware de auth antes
   de /api/eventos, então aqui o usuário JÁ chega autenticado (req.usuario).
   Ver 29_ATENDIMENTO_TEMPO_REAL_FASE16.md. */
module.exports = function createRealtime({ db, logErro }) {
  const clientes = new Set(); // cada item: { res, sessaoId, usuario }
  let seq = 0;

  // Handler do stream. O middleware de auth já rodou (req.usuario existe) — sem sessão
  // o request nem chega aqui (401 no middleware), garantindo o canal só pra logado.
  function handler(req, res) {
    const u = req.usuario || {};
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx/proxy: não bufferizar o stream
    });
    res.write('retry: 3000\n\n'); // dica de reconexão pro EventSource (3s)
    const cliente = { id: ++seq, res, sessaoId: u.sessaoId || null, usuario: u.usuario || null };
    clientes.add(cliente);
    res.write(`event: conectado\ndata: ${JSON.stringify({ ok: true, agora: new Date().toISOString() })}\n\n`);
    req.on('close', () => { clientes.delete(cliente); });
    req.on('error', () => { clientes.delete(cliente); });
  }

  // Envia um evento nomeado pra TODOS os clientes conectados.
  function emitir(evento, dados) {
    if (!clientes.size) return;
    let payload;
    try { payload = `event: ${evento}\ndata: ${JSON.stringify(dados || {})}\n\n`; }
    catch (e) { if (logErro) logErro('sse:serializar', e); return; }
    for (const c of clientes) {
      try { c.res.write(payload); }
      catch { clientes.delete(c); } // conexão morta → tira do conjunto
    }
  }

  // Heartbeat a cada 25s: mantém a conexão viva através de proxies E revalida a sessão
  // (Parte 4: sessão expirada/derrubada fecha o canal). Se a sessão não está mais ativa,
  // avisa o front (sessao_expirada) e encerra o stream daquele cliente.
  const heartbeat = setInterval(() => {
    if (!clientes.size) return;
    const agora = new Date().toISOString();
    for (const c of clientes) {
      try {
        if (c.sessaoId) {
          const s = db.prepare('SELECT ativa, expira_em FROM sessoes WHERE id = ?').get(c.sessaoId);
          if (!s || !s.ativa || (s.expira_em && s.expira_em < agora)) {
            c.res.write('event: sessao_expirada\ndata: {}\n\n');
            c.res.end();
            clientes.delete(c);
            continue;
          }
        }
        c.res.write(': ping\n\n'); // comentário SSE (mantém vivo, ignorado pelo cliente)
      } catch { clientes.delete(c); }
    }
  }, 25000);
  if (heartbeat.unref) heartbeat.unref(); // não segura o processo por causa do timer

  return { handler, emitir, contar: () => clientes.size };
};
