const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') }); // caminho explícito — o processo às vezes roda com cwd de outro projeto
const express = require('express');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const app = express();
app.use(express.json({ limit: '12mb' })); // 12mb pra caber o comprovante (imagem base64) no webhook

// ── Proteção opcional pra quando o sistema for hospedado na internet ──
// Se APP_SENHA estiver no .env, exige login (HTTP Basic) em TUDO, menos o webhook da IA
// (que já tem a própria proteção pelo WEBHOOK_SECRET). Sem APP_SENHA (uso local), fica aberto.
app.use((req, res, next) => {
  if (!process.env.APP_SENHA) return next();                      // local: sem trava
  if (req.path === '/api/atendimento-ia/webhook') return next();  // BotConversa usa o WEBHOOK_SECRET
  const [tipo, cred] = (req.get('Authorization') || '').split(' ');
  if (tipo === 'Basic' && cred) {
    const [user, senha] = Buffer.from(cred, 'base64').toString().split(':');
    if (user === (process.env.APP_USER || 'admin') && senha === process.env.APP_SENHA) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Programa Acai"');
  res.status(401).send('Acesso restrito.');
});

/* ── Banco de dados (node:sqlite, embutido no Node — sem instalar nada) ──
   Pedidos do Delivery e um espelho do catálogo de produtos precisam existir
   no SERVIDOR (não só no localStorage do navegador) pro atendimento por IA
   poder ler o cardápio e criar pedidos mesmo sem ninguém com a tela aberta. */
const db = new DatabaseSync(path.join(__dirname, 'acai.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY,
    numero INTEGER NOT NULL,
    cliente TEXT, telefone TEXT, bairro TEXT, endereco TEXT, complemento TEXT,
    itens TEXT, valor REAL, taxa REAL, total REAL,
    pagamento TEXT, troco REAL, status TEXT, criado TEXT,
    origem TEXT DEFAULT 'manual'
  )
`);
db.exec('CREATE TABLE IF NOT EXISTS pedidos_seq (n INTEGER)');
if (!db.prepare('SELECT n FROM pedidos_seq').get()) db.prepare('INSERT INTO pedidos_seq (n) VALUES (0)').run();
db.exec(`
  CREATE TABLE IF NOT EXISTS produtos (
    codigo TEXT PRIMARY KEY,
    nome TEXT, precoVenda REAL, estoque REAL, departamento TEXT,
    disponivel INTEGER DEFAULT 1
  )
`);
// migração pra bancos antigos que já tinham a tabela sem a coluna "disponivel"
try { db.exec('ALTER TABLE produtos ADD COLUMN disponivel INTEGER DEFAULT 1'); } catch {}

// ── Configurações da loja (chave/valor) — ex.: loja aberta/fechada ──
db.exec('CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT)');
function getConfig(chave, padrao) {
  const r = db.prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
  return r ? r.valor : padrao;
}
function setConfig(chave, valor) {
  db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, String(valor));
}
const lojaEstaAberta = () => getConfig('loja_aberta', '1') === '1'; // começa aberta por padrão
const soRetirada = () => getConfig('retirada_apenas', '0') === '1'; // só retirada no balcão (sem entrega)
const TEMPO_ENTREGA = 'Segunda a sábado — de manhã: pedidos a partir das 9h, entregas das 10h às 13h; à tarde/noite: a partir das 18h, entregas das 18h30 às 21h (fechamos 21h). Aos DOMINGOS só de manhã: pedidos a partir das 9h, entregas das 10h às 13h (domingo NÃO abrimos à noite). Quanto mais cedo o cliente pedir, mais cedo a entrega sai.';

// Próximo horário de funcionamento com base no dia/hora atual (UTC-3, Pará/BR).
// Só é chamada quando a loja está FECHADA, então nunca responde "agora".
// Domingo abre só de manhã (9h-13h); os outros dias têm manhã (9-13) e noite (18-21).
function proximaAbertura() {
  const local = new Date(Date.now() - 3 * 3600 * 1000); // desloca pro fuso do Pará (UTC-3)
  const dia = local.getUTCDay();   // 0=domingo, 6=sábado (uso getUTC* porque já desloquei a hora)
  const h = local.getUTCHours();
  if (h < 9) return 'hoje às 9h da manhã';        // antes das 9h → todo dia abre 9h
  if (dia === 0) return 'amanhã às 9h da manhã';  // domingo só tem manhã; passou disso, só segunda 9h
  if (h < 18) return 'hoje às 18h';               // seg-sáb: tarde fechada → próxima janela é 18h
  return 'amanhã às 9h da manhã';                 // noite → amanhã de manhã (inclusive sáb→dom, que abre 9h)
}

app.get('/api/loja/estado', (req, res) => res.json({ aberta: lojaEstaAberta(), retiradaApenas: soRetirada() }));
app.post('/api/loja/estado', (req, res) => {
  const b = req.body || {};
  if (b.aberta !== undefined) setConfig('loja_aberta', b.aberta ? '1' : '0');
  if (b.retiradaApenas !== undefined) setConfig('retirada_apenas', b.retiradaApenas ? '1' : '0');
  console.log(`🏪 Loja: ${lojaEstaAberta() ? 'ABERTA' : 'FECHADA'}${soRetirada() ? ' | SÓ RETIRADA' : ''}.`);
  res.json({ ok: true, aberta: lojaEstaAberta(), retiradaApenas: soRetirada() });
});

function proximoNumeroPedido() {
  const novo = (db.prepare('SELECT n FROM pedidos_seq').get().n || 0) + 1;
  db.prepare('UPDATE pedidos_seq SET n = ?').run(novo);
  return novo;
}
/* Reutilizada pelo endpoint REST (operador humano) E pelo webhook da IA (pedido por WhatsApp) */
function criarPedidoNoBanco(d, origem) {
  const valor = +d.valor || 0;
  const taxa = +d.taxa || 0;
  const pedido = {
    id: Date.now(), numero: proximoNumeroPedido(),
    cliente: d.cliente, telefone: d.telefone || '', bairro: d.bairro || '',
    endereco: d.endereco, complemento: d.complemento || '', itens: d.itens || '',
    valor, taxa, total: valor + taxa, pagamento: d.pagamento || 'Dinheiro', troco: +d.troco || 0,
    status: 'pendente', criado: new Date().toISOString(), origem: origem || d.origem || 'manual',
  };
  db.prepare(`INSERT INTO pedidos (id,numero,cliente,telefone,bairro,endereco,complemento,itens,valor,taxa,total,pagamento,troco,status,criado,origem)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    pedido.id, pedido.numero, pedido.cliente, pedido.telefone, pedido.bairro, pedido.endereco, pedido.complemento,
    pedido.itens, pedido.valor, pedido.taxa, pedido.total, pedido.pagamento, pedido.troco, pedido.status, pedido.criado, pedido.origem
  );
  return pedido;
}

app.get('/api/pedidos', (req, res) => {
  res.json(db.prepare('SELECT * FROM pedidos ORDER BY id DESC').all());
});
app.post('/api/pedidos', (req, res) => {
  const d = req.body || {};
  if (!d.cliente || !d.endereco) return res.status(400).json({ erro: 'Cliente e endereço são obrigatórios.' });
  res.json(criarPedidoNoBanco(d, d.origem || 'manual'));
});
app.put('/api/pedidos/:id', (req, res) => {
  const id = +req.params.id;
  if (!db.prepare('SELECT id FROM pedidos WHERE id = ?').get(id)) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  const campos = ['status', 'cliente', 'telefone', 'bairro', 'endereco', 'complemento', 'itens', 'pagamento', 'troco'];
  const updates = {};
  campos.forEach(c => { if (req.body[c] !== undefined) updates[c] = req.body[c]; });
  if (Object.keys(updates).length === 0) return res.status(400).json({ erro: 'Nada pra atualizar.' });
  const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE pedidos SET ${sets} WHERE id = ?`).run(...Object.values(updates), id);
  res.json(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id));
});
app.delete('/api/pedidos/:id', (req, res) => {
  db.prepare('DELETE FROM pedidos WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
});

app.get('/api/produtos', (req, res) => {
  res.json(db.prepare('SELECT * FROM produtos').all());
});
app.post('/api/produtos/sync', (req, res) => {
  const lista = Array.isArray(req.body) ? req.body : [];
  db.exec('DELETE FROM produtos');
  const insert = db.prepare('INSERT INTO produtos (codigo,nome,precoVenda,estoque,departamento,disponivel) VALUES (?,?,?,?,?,?)');
  lista.forEach(p => insert.run(p.codigo || '', p.nome || '', +p.precoVenda || 0, +p.estoque || 0, p.departamento || '', p.disponivel === false ? 0 : 1));
  res.json({ ok: true, total: lista.length });
});

/* ── Atendimento por IA (Claude) — pedidos de Delivery via WhatsApp ──
   Recebe a mensagem do cliente (mandada pelo Bloco de Integração do
   BotConversa), conversa usando o cardápio atual, e quando tiver itens +
   endereço + forma de pagamento confirmados, cria o pedido sozinho (tool use). */
// IA provider-agnóstica: usa GPT (OpenAI) se tiver OPENAI_API_KEY; senão Claude (Anthropic) se tiver ANTHROPIC_API_KEY.
// Sem nenhuma das duas, o atendimento por IA fica desligado (responde erro claro, sem derrubar o resto).
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const iaAtiva = !!(openai || anthropic);
console.log(
  openai ? '🤖 Atendimento por IA pronto (GPT / OPENAI_API_KEY).'
  : anthropic ? '🤖 Atendimento por IA pronto (Claude / ANTHROPIC_API_KEY).'
  : '⚠️ Nenhuma chave de IA (OPENAI_API_KEY ou ANTHROPIC_API_KEY) — atendimento por IA desligado até configurar.');

db.exec('CREATE TABLE IF NOT EXISTS conversas_ia (telefone TEXT PRIMARY KEY, historico TEXT, atualizado_em TEXT)');
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
    db.prepare('UPDATE conversas_ia SET historico = ?, atualizado_em = ? WHERE telefone = ?').run(hist, agora, telefone);
  } else {
    db.prepare('INSERT INTO conversas_ia (telefone, historico, atualizado_em) VALUES (?,?,?)').run(telefone, hist, agora);
  }
}

/* Cadastro de clientes do Delivery — importado do relatório do BotConversa (nome/endereço/
   forma de pagamento já conhecidos), e mantido atualizado a cada novo pedido confirmado.
   Existe pra IA não precisar perguntar endereço de novo pra quem já é cliente. */
db.exec('CREATE TABLE IF NOT EXISTS clientes_delivery (telefone TEXT PRIMARY KEY, nome TEXT, endereco TEXT, formaPagamento TEXT, atualizado_em TEXT)');
function buscarClienteDelivery(telefone) {
  return db.prepare('SELECT * FROM clientes_delivery WHERE telefone = ?').get(telefone) || null;
}
function salvarClienteDelivery(telefone, nome, endereco, formaPagamento) {
  const agora = new Date().toISOString();
  if (db.prepare('SELECT telefone FROM clientes_delivery WHERE telefone = ?').get(telefone)) {
    db.prepare('UPDATE clientes_delivery SET nome = COALESCE(?, nome), endereco = COALESCE(?, endereco), formaPagamento = COALESCE(?, formaPagamento), atualizado_em = ? WHERE telefone = ?')
      .run(nome || null, endereco || null, formaPagamento || null, agora, telefone);
  } else {
    db.prepare('INSERT INTO clientes_delivery (telefone, nome, endereco, formaPagamento, atualizado_em) VALUES (?,?,?,?,?)')
      .run(telefone, nome || '', endereco || '', formaPagamento || '', agora);
  }
}

app.get('/api/clientes-delivery', (req, res) => {
  const busca = (req.query.busca || '').trim();
  const limite = Math.min(+req.query.limite || 50, 200);
  const total = db.prepare('SELECT COUNT(*) AS n FROM clientes_delivery').get().n;
  let resultados;
  if (busca) {
    const termo = `%${busca}%`;
    resultados = db.prepare('SELECT * FROM clientes_delivery WHERE nome LIKE ? OR telefone LIKE ? OR endereco LIKE ? ORDER BY atualizado_em DESC LIMIT ?')
      .all(termo, termo, termo, limite);
  } else {
    resultados = db.prepare('SELECT * FROM clientes_delivery ORDER BY atualizado_em DESC LIMIT ?').all(limite);
  }
  res.json({ total, resultados });
});

/* ── Central de Atendimento ──────────────────────────────────────────────
   Caixa de entrada do WhatsApp da loja, operada por um humano (não é bot).
   Toda mensagem que CHEGA é guardada aqui; o envio só acontece quando o
   atendente clica em "Enviar" na tela — ou seja, é o mesmo que mandar a
   mensagem pelo celular, só que pela tela do sistema. */
db.exec(`CREATE TABLE IF NOT EXISTS mensagens_wpp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telefone TEXT NOT NULL,
  nome TEXT,
  direcao TEXT NOT NULL,            -- 'in' (recebida) ou 'out' (enviada)
  texto TEXT,
  criado TEXT NOT NULL,
  lido INTEGER DEFAULT 0,
  chat_id TEXT,                      -- id real do chat no WhatsApp (ex.: 5599...@c.us ou ...@lid) pra conseguir RESPONDER
  tipo TEXT DEFAULT 'chat',          -- 'chat' (texto) ou tipo da mídia: 'ptt'/'audio'/'image'/'video'/'document'/'sticker'
  midia TEXT,                        -- conteúdo da mídia em base64 (só pra mensagens com áudio/foto/etc.)
  midia_tipo TEXT                    -- mimetype da mídia (ex.: audio/ogg; codecs=opus)
)`);
// migrações pra bancos que já tinham a tabela sem essas colunas
try { db.exec('ALTER TABLE mensagens_wpp ADD COLUMN chat_id TEXT'); } catch {}
try { db.exec("ALTER TABLE mensagens_wpp ADD COLUMN tipo TEXT DEFAULT 'chat'"); } catch {}
try { db.exec('ALTER TABLE mensagens_wpp ADD COLUMN midia TEXT'); } catch {}
try { db.exec('ALTER TABLE mensagens_wpp ADD COLUMN midia_tipo TEXT'); } catch {}
// backfill: reconstrói o chat_id das mensagens antigas a partir do telefone (LID tem ~15 dígitos; número BR tem ≤13)
db.exec("UPDATE mensagens_wpp SET chat_id = telefone || '@lid'  WHERE (chat_id IS NULL OR chat_id = '') AND length(telefone) >= 14");
db.exec("UPDATE mensagens_wpp SET chat_id = telefone || '@c.us' WHERE (chat_id IS NULL OR chat_id = '') AND length(telefone) < 14");

// rótulo amigável pra mídia (usado quando não há legenda) — '🎤 Áudio', '📷 Foto', etc.
function rotuloMidia(tipo) {
  return ({ ptt: '🎤 Áudio', audio: '🎵 Áudio', image: '📷 Foto', video: '🎥 Vídeo', document: '📎 Arquivo', sticker: '🌟 Figurinha' })[tipo] || '📎 Mídia';
}

function salvarMensagemWpp(telefone, nome, direcao, texto, chatId, extras = {}) {
  const { tipo = 'chat', midia = null, midiaTipo = null } = extras;
  db.prepare('INSERT INTO mensagens_wpp (telefone, nome, direcao, texto, criado, lido, chat_id, tipo, midia, midia_tipo) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(telefone, nome || '', direcao, texto || '', new Date().toISOString(), direcao === 'out' ? 1 : 0, chatId || null, tipo, midia, midiaTipo);
}
// pega o id de chat mais recente de um contato (pra responder direto, sem tentar resolver número)
function chatIdDoContato(telefone) {
  const row = db.prepare("SELECT chat_id FROM mensagens_wpp WHERE telefone = ? AND chat_id IS NOT NULL AND chat_id <> '' ORDER BY id DESC LIMIT 1").get(telefone);
  return row ? row.chat_id : null;
}

// lista de conversas (uma por telefone), com a última mensagem e quantas não lidas
app.get('/api/atendimento/conversas', (req, res) => {
  const conversas = db.prepare(`
    SELECT telefone,
           MAX(id) AS ultimoId,
           SUM(CASE WHEN direcao='in' AND lido=0 THEN 1 ELSE 0 END) AS naoLidas
    FROM mensagens_wpp
    GROUP BY telefone
    ORDER BY ultimoId DESC
    LIMIT 200
  `).all();
  const ultima = db.prepare('SELECT texto, direcao, criado, nome, tipo FROM mensagens_wpp WHERE telefone = ? ORDER BY id DESC LIMIT 1');
  const nomeNaoVazio = db.prepare("SELECT nome FROM mensagens_wpp WHERE telefone = ? AND nome <> '' ORDER BY id DESC LIMIT 1");
  const resultados = conversas.map(c => {
    const u = ultima.get(c.telefone) || {};
    const nomeMsg = (nomeNaoVazio.get(c.telefone) || {}).nome;
    const cli = buscarClienteDelivery(c.telefone);
    // prévia: se a última for mídia sem legenda, mostra o rótulo (ex.: "🎤 Áudio") em vez de vazio
    const previa = u.texto || (u.tipo && u.tipo !== 'chat' ? rotuloMidia(u.tipo) : '');
    return {
      telefone: c.telefone,
      nome: nomeMsg || (cli && cli.nome) || '',
      ultimoTexto: previa,
      ultimaDirecao: u.direcao || '',
      criado: u.criado || '',
      naoLidas: c.naoLidas || 0,
    };
  });
  res.json(resultados);
});

// histórico completo de um contato — e marca as recebidas como lidas
app.get('/api/atendimento/mensagens/:telefone', (req, res) => {
  const telefone = req.params.telefone;
  // NÃO traz a coluna "midia" (base64 pesado) na lista — só uma flag; a mídia em si vai pelo endpoint dedicado
  const mensagens = db.prepare('SELECT id, direcao, texto, criado, lido, tipo, (midia IS NOT NULL) AS temMidia, midia_tipo AS midiaTipo FROM mensagens_wpp WHERE telefone = ? ORDER BY id ASC').all(telefone);
  db.prepare("UPDATE mensagens_wpp SET lido = 1 WHERE telefone = ? AND direcao = 'in' AND lido = 0").run(telefone);
  const cli = buscarClienteDelivery(telefone);
  res.json({ telefone, cliente: cli, mensagens });
});

// serve a mídia de uma mensagem (áudio/foto/etc.) decodificando o base64 guardado
app.get('/api/atendimento/midia/:id', (req, res) => {
  const row = db.prepare('SELECT midia, midia_tipo FROM mensagens_wpp WHERE id = ?').get(+req.params.id);
  if (!row || !row.midia) return res.status(404).json({ erro: 'Mídia não encontrada.' });
  res.set('Content-Type', row.midia_tipo || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(row.midia, 'base64'));
});

// atendente responde pela tela — envia pelo WhatsApp e guarda como 'out'
app.post('/api/atendimento/enviar', async (req, res) => {
  const { telefone, texto } = req.body || {};
  const digitos = (telefone || '').replace(/\D/g, '');
  if (!digitos || !texto) return res.status(400).json({ ok: false, erro: 'Telefone e texto são obrigatórios.' });

  // RESPONDER a um chat existente: usa o chat_id real guardado (resolve o caso do LID, em que o
  // "telefone" não é um número de verdade). Só cai pro getNumberId quando não há chat_id (contato novo).
  const chatId = chatIdDoContato(digitos);
  const envio = chatId
    ? await enviarParaChatId(chatId, texto)
    : await enviarMensagemWhatsapp(digitos, texto);
  if (!envio.ok) return res.status(envio.status || 500).json(envio);

  const cli = buscarClienteDelivery(digitos);
  salvarMensagemWpp(digitos, (cli && cli.nome) || '', 'out', texto, chatId);
  res.json({ ok: true });
});

// excluir uma conversa inteira da Central (apaga as mensagens desse contato)
app.delete('/api/atendimento/conversas/:telefone', (req, res) => {
  const r = db.prepare('DELETE FROM mensagens_wpp WHERE telefone = ?').run(req.params.telefone);
  console.log(`🗑️ Conversa ${req.params.telefone} excluída (${r.changes} mensagens).`);
  res.json({ ok: true, removidas: r.changes });
});

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

// mesma ferramenta no formato que a OpenAI (GPT) espera — derivada da de cima pra não duplicar o schema
const TOOL_OPENAI = {
  type: 'function',
  function: { name: TOOL_CRIAR_PEDIDO.name, description: TOOL_CRIAR_PEDIDO.description, parameters: TOOL_CRIAR_PEDIDO.input_schema },
};

function montarPromptSistemaIA(cardapio, clienteConhecido, lojaAberta = true, soRetirada = false) {
  // Loja FECHADA: prompt curto e exclusivo (sem o fluxo de pedido competindo),
  // pra IA nunca tirar pedido enquanto está fechado.
  if (!lojaAberta) {
    return `Você é o atendente virtual de uma loja de açaí no WhatsApp. A LOJA ESTÁ FECHADA NESTE MOMENTO.
Sua ÚNICA tarefa agora: responder de forma simpática e curta que a loja está fechada e informar quando reabre.
PRÓXIMO horário em que a loja abre: ${proximaAbertura()}. Se o cliente perguntar "que horas abre?" ou "tá aberto?", responda com ESSE próximo horário (não recite a grade toda — só o próximo).
Horário completo (só use se o cliente pedir os horários do dia todo): ${TEMPO_ENTREGA}
NÃO tire pedido, NÃO liste cardápio pra pedir agora, NÃO peça pagamento nem endereço, NÃO chame nenhuma função/ferramenta.
Exemplo: "Oi! 😊 No momento a loja está fechada. A gente abre ${proximaAbertura()} e vai ser um prazer preparar seu açaí! 🌴💜"
Tom: WhatsApp, curto e gentil. Negrito é com UM asterisco só (nunca use **).`;
  }
  const linhas = cardapio.length
    ? cardapio.map(p => `- ${p.nome}: R$ ${(p.precoVenda || 0).toFixed(2).replace('.', ',')}`).join('\n')
    : '(cardápio ainda não sincronizado — avise o cliente que o sistema está sendo configurado)';
  const blocoCliente = clienteConhecido
    ? `\nEsse cliente JÁ é conhecido (pediu antes):\n- Nome: ${clienteConhecido.nome || '(não sabemos)'}\n- Endereço salvo: ${clienteConhecido.endereco || '(não sabemos)'}\n- Forma de pagamento mais usada: ${clienteConhecido.formaPagamento || '(não sabemos)'}\nNÃO pergunte o endereço do zero — confirme se é pra entregar nesse endereço salvo (ex.: "é pra entregar no mesmo endereço de sempre, ${clienteConhecido.endereco}?"). Só pergunte de novo se o cliente disser que mudou ou se não tiver endereço salvo.\n`
    : '';
  // MODO RETIRADA: sobrepõe o fluxo de entrega — sem endereço, cliente busca no balcão
  const blocoRetirada = soRetirada
    ? `\n🏪 MODO RETIRADA (IMPORTANTE): no momento a loja está SÓ COM RETIRADA no balcão — NÃO estamos fazendo entrega/delivery agora. AVISE O CLIENTE LOGO NA PRIMEIRA RESPOSTA, antes de qualquer outra coisa, que hoje é SÓ RETIRADA no ponto: ele faz o pedido e vem BUSCAR aqui na loja (não tem entrega hoje). Ex.: "Oi! 😊 Hoje estamos trabalhando só com retirada no balcão, tá? Você faz o pedido e vem buscar aqui 🌴". NÃO pergunte endereço de entrega (ignore o passo do endereço). Ao chamar criar_pedido, coloque em "endereco" o texto "RETIRADA NO BALCÃO" e deixe bairro/complemento vazios. Na confirmação, NÃO fale de entrega — diga que é só passar aqui pra retirar quando estiver pronto. Se for PIX, siga conferindo o comprovante normalmente antes de fechar.\n`
    : '';
  return `Você é o atendente virtual da loja de açaí, conversando por WhatsApp. Esse atendimento substitui um bot antigo mais simples — siga o MESMO padrão que os clientes já conhecem, só que mais natural.
${blocoRetirada}${blocoCliente}
Cardápio disponível agora (açaí é vendido por litro/fração de litro, ex.: "1 litro", "1 litro e meio"; valor escala proporcional ao tamanho):
${linhas}

Regras do negócio:
- Entrega só a partir de 1 litro de açaí no pedido (não aceite pedido com menos que isso).
- Só entrega se o pedido tiver açaí — não entrega só complemento (farinha/tapioca/sardinha) sem açaí junto.
- Calcule o valor proporcional à quantidade pedida (ex.: 1,5 litro do Top = 1,5 × R$15 = R$22,50) somado aos complementos.
- A ENTREGA É GRÁTIS — não existe taxa de entrega. Nunca cobre nem invente taxa; a taxa é sempre 0. Se o cliente perguntar, diga que a entrega é gratuita 😊. O total é só a soma dos itens.

Como conversar (siga essa ordem, mas com naturalidade — não repita pergunta que o cliente já respondeu):
1. Entenda o pedido (o quê e quanto). Se o cliente só mandar uma saudação ou "tem açaí?", responda com o cardápio acima de forma resumida.
2. Pergunte a forma de pagamento: PIX, Dinheiro ou Cartão. Se for Dinheiro, pergunte se precisa de troco e para quanto.
3. Se for PIX: informe a chave e peça o comprovante antes de finalizar — use exatamente isso:
"certo! essa é a chave pix.✔

PIX:
91984540212
Banco nubank
nome: comercial do centro / ou M.Rodrigues da Costa.

aguardo o comprovante para poder enviarmos seu pedido 😉"
3b. CONFERÊNCIA DO COMPROVANTE (quando o cliente enviar uma IMAGEM): olhe a imagem com atenção e verifique se é um comprovante de PIX e se:
   - o VALOR pago bate com o total do pedido;
   - o destinatário/chave corresponde à loja (chave 91984540212, banco Nubank, nome "comercial do centro" ou "M.Rodrigues da Costa").
   Se estiver tudo certo, responda confirmando de forma natural, ex.: "Já verifiquei aqui, o comprovante está certinho! ✅ Pode me passar o endereço?" e siga para o endereço/finalização.
   Se o valor NÃO bater, o destinatário for outro, ou a imagem não for um comprovante de PIX, avise educadamente e peça o comprovante correto (ex.: "Hmm, não consegui confirmar esse comprovante — o valor/destinatário não bateu. Pode conferir e reenviar? 🙏"). NUNCA finalize um pedido no PIX sem ter visto um comprovante que confere.
4. Pergunte o endereço de entrega assim: o NOME DA RUA, o NÚMERO da casa, e ENTRE QUAIS RUAS fica (referência). NÃO pergunte o bairro. Ex.: "Me passa o endereço: nome da rua, número, e entre quais ruas fica? 🏠"
5. Quando tiver itens + forma de pagamento + endereço confirmados, chame a função criar_pedido. Preencha "endereco" com a rua + número, e "complemento" com o "entre tal e tal rua" (a referência). Deixe "bairro" vazio. Nunca invente o que o cliente não disse.
6. Depois de criar o pedido, responda EXATAMENTE com essa frase de confirmação (igual ao que os clientes já estão acostumados):
"Seu pedido foi realizado com sucesso!

As entregas são feitas pela ordem dos pedidos.

Por favor aguarde! 😊"

Horário de entrega: ${TEMPO_ENTREGA} Se o cliente perguntar o horário, ou quando o pedido chega, informe isso de forma simpática (e reforce que quanto mais cedo pedir, mais cedo recebe).

Tom: simpático, direto, mensagens curtas (estilo WhatsApp, sem parágrafo longo). Não pergunte o nome do cliente — já vem identificado pelo WhatsApp.

FORMATAÇÃO (MUITO IMPORTANTE — é WhatsApp, não é site): negrito no WhatsApp é com UM asterisco só (*assim*), NUNCA com dois (**assim** apareceria com os asteriscos na tela do cliente, feio). Prefira não usar asterisco nenhum; se quiser destacar um valor, use no máximo *um* de cada lado. Não use markdown (nada de ##, -, **). Pra listar o cardápio, use quebras de linha simples e emojis, não traços/markdown.`;
}

/* Núcleo do atendimento — usado tanto pelo webhook HTTP (BotConversa) quanto
   pelo listener de mensagens do whatsapp-web.js (teste direto, sem BotConversa).
   Escolhe o provider: GPT (OpenAI) se tiver a chave; senão Claude (Anthropic). */
async function processarMensagemIA(telefone, nome, mensagem, imagem) {
  if (!iaAtiva) {
    console.log(`⚠️ Mensagem de atendimento IA de ${telefone}, mas nenhuma chave de IA está configurada.`);
    return { erro: 'Atendimento por IA ainda não configurado (falta a chave OPENAI_API_KEY ou ANTHROPIC_API_KEY).' };
  }
  // a IA só oferece o que está marcado como disponível na tela (Módulo A)
  const cardapio = db.prepare('SELECT * FROM produtos WHERE disponivel = 1').all();
  const clienteConhecido = buscarClienteDelivery(telefone);
  const aberta = lojaEstaAberta();
  const retirada = soRetirada();
  try {
    return openai
      ? await processarComOpenAI(telefone, nome, mensagem, cardapio, clienteConhecido, imagem, aberta, retirada)
      : await processarComClaude(telefone, nome, mensagem, cardapio, clienteConhecido, imagem, aberta, retirada);
  } catch (err) {
    console.log(`❌ Erro no atendimento IA pra ${telefone}:`, err.message);
    return { erro: 'Falha ao processar a mensagem.' };
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

// ── GPT (OpenAI) ──
async function processarComOpenAI(telefone, nome, mensagem, cardapio, clienteConhecido, imagem, aberta, retirada) {
  const modelo = 'gpt-4o-mini';
  const system = montarPromptSistemaIA(cardapio, clienteConhecido, aberta, retirada);
  // histórico no formato OpenAI: só mensagens de texto (descarta tool-calls antigos e qualquer
  // resíduo em formato Anthropic de testes anteriores, pra não quebrar a chamada)
  const historico = carregarConversaIA(telefone).filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'));
  // se veio imagem (comprovante), manda como conteúdo de visão
  const conteudoUser = (imagem && imagem.data)
    ? [{ type: 'text', text: mensagem || 'Segue o comprovante do PIX.' }, { type: 'image_url', image_url: { url: `data:${imagem.mediaType || 'image/jpeg'};base64,${imagem.data}` } }]
    : mensagem;
  const messages = [{ role: 'system', content: system }, ...historico, { role: 'user', content: conteudoUser }];

  const resp = await openai.chat.completions.create({ model: modelo, max_tokens: 500, messages, tools: aberta ? [TOOL_OPENAI] : undefined });
  const msg = resp.choices[0].message;
  let textoResposta = msg.content || '';
  let pedidoCriado = null;

  const toolCall = (msg.tool_calls || []).find(t => t.function && t.function.name === 'criar_pedido');
  if (toolCall) {
    let args = {};
    try { args = JSON.parse(toolCall.function.arguments || '{}'); } catch {}
    pedidoCriado = criarPedidoNoBanco({ ...args, telefone, cliente: args.cliente || nome }, 'ia');
    salvarClienteDelivery(telefone, args.cliente || nome, args.endereco, args.pagamento);
    // devolve o resultado da ferramenta e pede a mensagem final de confirmação
    messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls });
    messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `Pedido #${pedidoCriado.numero} criado com sucesso, status pendente.` });
    const resp2 = await openai.chat.completions.create({ model: modelo, max_tokens: 300, messages });
    textoResposta = resp2.choices[0].message.content || `Pedido #${pedidoCriado.numero} confirmado! 🛵`;
  }

  // salva só o texto da conversa (user/assistant) — o system é remontado fresco a cada vez
  const novoHistorico = [...historico, { role: 'user', content: mensagem }, { role: 'assistant', content: textoResposta }];
  salvarConversaIA(telefone, novoHistorico);
  console.log(`🤖 [GPT] respondeu pra ${telefone}${pedidoCriado ? ` (pedido #${pedidoCriado.numero} criado)` : ''}`);
  return { resposta: textoResposta, pedidoCriado: pedidoCriado ? pedidoCriado.numero : null };
}

// ── Claude (Anthropic) — alternativa, usada se só a chave da Anthropic estiver configurada ──
async function processarComClaude(telefone, nome, mensagem, cardapio, clienteConhecido, imagem, aberta, retirada) {
  const modelo = 'claude-haiku-4-5-20251001';
  const system = montarPromptSistemaIA(cardapio, clienteConhecido, aberta, retirada);
  const historico = carregarConversaIA(telefone);
  // se veio imagem (comprovante), manda como bloco de visão junto do texto
  if (imagem && imagem.data) {
    historico.push({ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: imagem.mediaType || 'image/jpeg', data: imagem.data } },
      { type: 'text', text: mensagem || 'Segue o comprovante do PIX.' },
    ] });
  } else {
    historico.push({ role: 'user', content: mensagem });
  }

  let resposta = await anthropic.messages.create({ model: modelo, max_tokens: 500, system, messages: historico, tools: aberta ? [TOOL_CRIAR_PEDIDO] : undefined });
  historico.push({ role: 'assistant', content: resposta.content });

  let textoResposta = (resposta.content.find(b => b.type === 'text') || {}).text || '';
  let pedidoCriado = null;
  const chamadaTool = resposta.content.find(b => b.type === 'tool_use' && b.name === 'criar_pedido');

  if (chamadaTool) {
    pedidoCriado = criarPedidoNoBanco({ ...chamadaTool.input, telefone, cliente: chamadaTool.input.cliente || nome }, 'ia');
    salvarClienteDelivery(telefone, chamadaTool.input.cliente || nome, chamadaTool.input.endereco, chamadaTool.input.pagamento);
    historico.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: chamadaTool.id, content: `Pedido #${pedidoCriado.numero} criado com sucesso, status pendente.` }] });
    const resposta2 = await anthropic.messages.create({ model: modelo, max_tokens: 300, system, messages: historico });
    historico.push({ role: 'assistant', content: resposta2.content });
    textoResposta = (resposta2.content.find(b => b.type === 'text') || {}).text || `Pedido #${pedidoCriado.numero} confirmado! 🛵`;
  }

  salvarConversaIA(telefone, semImagens(historico));
  console.log(`🤖 [Claude] respondeu pra ${telefone}${pedidoCriado ? ` (pedido #${pedidoCriado.numero} criado)` : ''}`);
  return { resposta: textoResposta, pedidoCriado: pedidoCriado ? pedidoCriado.numero : null };
}

app.post('/api/atendimento-ia/webhook', async (req, res) => {
  // protege o webhook assim que ele fica exposto na internet (túnel/produção) — sem isso,
  // qualquer um que descobrisse a URL poderia mandar mensagem falsa e criar pedido fictício
  if (process.env.WEBHOOK_SECRET && req.get('X-Webhook-Secret') !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ erro: 'Não autorizado.' });
  }
  const { telefone, nome, mensagem, imagem, imagemTipo } = req.body || {};
  if (!telefone || (!mensagem && !imagem)) return res.status(400).json({ erro: 'Campos "telefone" e "mensagem" (ou "imagem") são obrigatórios.' });
  const img = imagem ? { data: imagem, mediaType: imagemTipo || 'image/jpeg' } : null;
  const resultado = await processarMensagemIA(telefone, nome, mensagem, img);
  res.status(resultado.erro ? (iaAtiva ? 500 : 503) : 200).json(resultado);
});

// Sem cache — o navegador sempre carrega a versão mais recente dos arquivos
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));

/* ── WhatsApp (whatsapp-web.js) — envio automático de avisos de saldo ──
   Pareamento único: escaneie o QR Code impresso aqui no terminal com o
   WhatsApp do celular da loja (Aparelhos conectados). A sessão fica salva
   em .wwebjs_auth/ e não pede QR de novo nos próximos starts. */

// O Chromium baixado pelo Puppeteer pode ficar incompleto nesta máquina
// (antivírus removendo o .exe na extração) — usa o Chrome/Edge já instalado
// no Windows em vez de depender desse download.
const NAVEGADORES_SISTEMA = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = NAVEGADORES_SISTEMA.find(p => fs.existsSync(p));
console.log(executablePath
  ? `🌐 Usando navegador do sistema pro WhatsApp: ${executablePath}`
  : '⚠️ Nenhum Chrome/Edge do sistema encontrado — vai depender do Chromium do Puppeteer.');

let whatsappPronto = false;
let ultimoQR = null;   // string crua do QR atual — null quando conectado (não precisa mais escanear)
const whatsapp = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  },
});
whatsapp.on('qr', qr => {
  ultimoQR = qr;
  console.log('\n📱 Escaneie o QR Code abaixo no WhatsApp do celular da loja (Aparelhos conectados),');
  console.log('   ou abra a aba Clientes no sistema — o mesmo QR Code aparece lá:\n');
  qrcodeTerminal.generate(qr, { small: true });
});
whatsapp.on('ready', () => { whatsappPronto = true; ultimoQR = null; console.log('✅ WhatsApp conectado — avisos de saldo serão enviados automaticamente.'); corrigirLidsExistentes(); });

// migra mensagens antigas guardadas com LID pro número real (ex.: 251856932569194 → 559192207690),
// pra que cadastro de cliente, crediário e respostas funcionem com o telefone de verdade
async function corrigirLidsExistentes() {
  try {
    const lids = db.prepare("SELECT DISTINCT telefone, chat_id FROM mensagens_wpp WHERE chat_id LIKE '%@lid'").all();
    for (const row of lids) {
      try {
        const c = await whatsapp.getContactById(row.chat_id);
        if (c && c.id && c.id.server === 'c.us' && c.id.user) {
          db.prepare('UPDATE mensagens_wpp SET telefone = ?, chat_id = ? WHERE telefone = ?')
            .run(c.id.user, c.id._serialized, row.telefone);
          console.log(`🔁 LID corrigido: ${row.telefone} → ${c.id.user}`);
        }
      } catch {}
    }
  } catch {}
}
whatsapp.on('disconnected', (motivo) => {
  whatsappPronto = false;
  ultimoQR = null;
  console.log(`⚠️ WhatsApp desconectado (${motivo}) — tentando reconectar em 5s...`);
  // reinicia o cliente sozinho: reconecta pela sessão salva OU gera um QR novo (que aparece na tela inicial),
  // pra não ficar travado "desconectado sem QR" como aconteceu
  setTimeout(() => { whatsapp.initialize().catch(err => console.log('❌ Falha ao reconectar o WhatsApp:', err.message)); }, 5000);
});
whatsapp.on('auth_failure', msg => console.log('❌ Falha de autenticação no WhatsApp:', msg));

/* 2ª opção de conexão pro atendimento por IA: direto pelo whatsapp-web.js (a 1ª é o
   webhook HTTP, usado pelo BotConversa). SÓ responde os IDs desta lista — enquanto
   for só pra teste, mantém o número real da loja protegido de estranhos. Pra abrir
   pra qualquer cliente de verdade, troque por um número dedicado (não o de avisos
   de crediário) e aí sim remova essa restrição.
   IMPORTANTE: o WhatsApp pode identificar o contato por "LID" (ex.: 251856932569194@lid)
   em vez do número direto (5591992207690@c.us) — descoberto via /api/whatsapp/diagnostico.
   Por isso a lista guarda o ID completo (com sufixo), não só os dígitos do telefone. */
const IDS_TESTE_IA = ['5591992207690@c.us', '251856932569194@lid'];
whatsapp.on('message', async message => {
  if (message.fromMe || message.from.endsWith('@g.us')) return;
  let nome = '';
  let telefone = message.from.replace('@c.us', '').replace('@lid', '');
  let chatId = message.from;
  try {
    const contato = await message.getContact();
    nome = contato.pushname || '';
    // contato.id é o id CANÔNICO baseado no NÚMERO REAL — mesmo quando a mensagem chega via @lid
    // (nesse caso contato.number vem como o próprio LID; por isso preferimos contato.id).
    if (contato.id && contato.id.server === 'c.us' && contato.id.user) {
      telefone = contato.id.user;           // número real, ex.: 559192207690
      chatId = contato.id._serialized;      // ex.: 559192207690@c.us — formato confiável pra responder
    } else if (contato.number) {
      telefone = contato.number;
    }
  } catch {}

  // baixa a mídia (áudio/foto/vídeo/etc.), se houver — senão o balão chegaria vazio
  let texto = message.body || '';
  let extras = {};
  if (message.hasMedia) {
    try {
      const media = await message.downloadMedia();
      // guarda a mídia, mas com teto de ~7MB de base64 (~5MB de arquivo) pra um vídeo grande
      // não inchar o banco — acima disso registra só o tipo (aparece o rótulo, sem o arquivo).
      if (media && media.data && media.data.length <= 7_000_000) {
        extras = { tipo: message.type, midia: media.data, midiaTipo: media.mimetype };
      } else if (media && media.data) {
        console.log(`⚠️ Mídia de ${telefone} grande demais (${Math.round(media.data.length / 1e6)}MB base64) — guardando só o rótulo.`);
      }
    } catch (err) { console.log('⚠️ Falha ao baixar mídia:', err.message); }
    if (!extras.tipo) extras = { tipo: message.type }; // registra o tipo mesmo se o download falhar/passar do teto
  }

  // guarda TODA mensagem recebida pra Central de Atendimento (caixa de entrada operada por humano).
  salvarMensagemWpp(telefone, nome, 'in', texto, chatId, extras);
  const descr = message.hasMedia ? rotuloMidia(message.type) : `"${texto}"`;
  console.log(`💬 Mensagem de ${telefone}${nome ? ` (${nome})` : ''}: ${descr}`);

  // resposta automática por IA: só pra lista de teste E só se houver chave de IA ativa (hoje desligada)
  if (iaAtiva && IDS_TESTE_IA.includes(message.from)) {
    // se o cliente mandou foto (provável comprovante do PIX), passa a imagem pra IA conferir
    const img = (extras.tipo === 'image' && extras.midia) ? { data: extras.midia, mediaType: extras.midiaTipo } : null;
    const resultado = await processarMensagemIA(telefone, nome, message.body, img);
    if (resultado.erro) { console.log(`⚠️ Não respondida (${resultado.erro})`); return; }
    try {
      await message.reply(resultado.resposta);
      salvarMensagemWpp(telefone, nome, 'out', resultado.resposta, chatId);
    } catch (err) { console.log('❌ Falha ao responder no WhatsApp:', err.message); }
  }
});

whatsapp.initialize().catch(err => console.log('❌ Não foi possível iniciar o cliente WhatsApp:', err.message));

app.get('/api/whatsapp/status', (req, res) => res.json({ pronto: whatsappPronto, temQr: !!ultimoQR }));

// (Re)conectar a pedido do usuário (botão na tela): destrói o cliente travado e reinicia,
// gerando um QR Code novo (que aparece no painel). Não faz nada se já estiver conectado.
app.post('/api/whatsapp/conectar', async (req, res) => {
  if (whatsappPronto) return res.json({ ok: true, jaConectado: true });
  ultimoQR = null;
  console.log('🔌 (Re)iniciando conexão do WhatsApp a pedido do usuário...');
  try { await whatsapp.destroy(); } catch {}
  whatsapp.initialize().catch(err => console.log('❌ Falha ao (re)iniciar o WhatsApp:', err.message)); // não await — o QR chega pelo evento
  res.json({ ok: true, iniciando: true });
});

app.get('/api/whatsapp/info', (req, res) => {
  if (!whatsappPronto) return res.status(503).json({ erro: 'WhatsApp não conectado.' });
  res.json({ numeroConectado: whatsapp.info?.wid?.user || null, nome: whatsapp.info?.pushname || null });
});

// DIAGNÓSTICO temporário — descobre o JID real que o WhatsApp usa pra um número (BR tem pegadinha do "9º dígito")
app.get('/api/whatsapp/diagnostico/:numero', async (req, res) => {
  if (!whatsappPronto) return res.status(503).json({ erro: 'WhatsApp não conectado.' });
  const numero = req.params.numero;
  try {
    const resolvido = await whatsapp.getNumberId(numero);
    res.json({ numeroConsultado: numero, resolvido: resolvido ? resolvido._serialized : null });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/whatsapp/qr', async (req, res) => {
  if (!ultimoQR) return res.status(404).json({ erro: 'Nenhum QR Code disponível agora (já conectado ou ainda iniciando).' });
  try {
    const png = await qrcode.toBuffer(ultimoQR, { width: 280, margin: 1 });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    res.status(500).json({ erro: err.message || 'Falha ao gerar o QR Code.' });
  }
});

// DIAGNÓSTICO temporário — inspeciona um contato pra descobrir o número real por trás de um LID
app.get('/api/whatsapp/contato/:id', async (req, res) => {
  if (!whatsappPronto) return res.status(503).json({ erro: 'WhatsApp não conectado.' });
  try {
    const c = await whatsapp.getContactById(req.params.id);
    let chatInfo = null;
    try {
      const chat = await c.getChat();
      chatInfo = { id: chat.id?._serialized || null, name: chat.name || null };
    } catch {}
    res.json({
      number: c.number || null,
      idServer: c.id?._serialized || null,
      idUser: c.id?.user || null,
      pushname: c.pushname || null,
      name: c.name || null,
      isWAContact: c.isWAContact,
      isBusiness: c.isBusiness,
      chat: chatInfo,
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// envio compartilhado (usado pelo /api/whatsapp/enviar dos avisos de crediário
// e pelo /api/atendimento/enviar da Central) — resolve o id real do contato
// em vez de "chutar" o formato, evitando falha silenciosa em número sem WhatsApp
async function enviarMensagemWhatsapp(digitos, mensagem) {
  if (!whatsappPronto) {
    console.log(`⚠️ Tentativa de envio com WhatsApp ainda não conectado (telefone ${digitos})`);
    return { ok: false, status: 503, erro: 'WhatsApp ainda não conectado — escaneie o QR Code na tela de Clientes.' };
  }
  try {
    const numeroId = await whatsapp.getNumberId(digitos);
    if (!numeroId) {
      console.log(`❌ Número ${digitos} não tem WhatsApp (ou formato errado) — mensagem não enviada.`);
      return { ok: false, status: 404, erro: `O número ${digitos} não foi encontrado no WhatsApp.` };
    }
    await whatsapp.sendMessage(numeroId._serialized, mensagem);
    console.log(`✅ WhatsApp enviado pra ${digitos}: "${mensagem.slice(0, 80)}${mensagem.length > 80 ? '...' : ''}"`);
    return { ok: true };
  } catch (err) {
    console.log(`❌ Falha ao enviar WhatsApp pra ${digitos}:`, err.message);
    return { ok: false, status: 500, erro: err.message || 'Falha ao enviar mensagem.' };
  }
}

// RESPONDER direto a um chat já existente pelo seu id (ex.: ...@c.us ou ...@lid).
// É o jeito certo de responder o LID — não dá pra "resolver número" de um LID.
async function enviarParaChatId(chatId, mensagem) {
  if (!whatsappPronto) {
    return { ok: false, status: 503, erro: 'WhatsApp ainda não conectado — escaneie o QR Code na tela de Clientes.' };
  }
  try {
    await whatsapp.sendMessage(chatId, mensagem);
    console.log(`✅ Resposta enviada pro chat ${chatId}: "${mensagem.slice(0, 80)}${mensagem.length > 80 ? '...' : ''}"`);
    return { ok: true };
  } catch (err) {
    console.log(`❌ Falha ao responder o chat ${chatId}:`, err.message);
    return { ok: false, status: 500, erro: err.message || 'Falha ao enviar mensagem.' };
  }
}

app.post('/api/whatsapp/enviar', async (req, res) => {
  const { telefone, mensagem } = req.body || {};
  const digitos = (telefone || '').replace(/\D/g, '');
  if (!digitos || !mensagem) return res.status(400).json({ ok: false, erro: 'Telefone e mensagem são obrigatórios.' });
  const envio = await enviarMensagemWhatsapp(digitos, mensagem);
  res.status(envio.ok ? 200 : (envio.status || 500)).json(envio);
});

app.listen(3001, () => console.log('✅ PROGRAMA AÇAÍ rodando em http://localhost:3001'));
