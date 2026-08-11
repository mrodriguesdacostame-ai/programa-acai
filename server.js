/* ══════════════════════════════════════════════════════════════════════════
   PROGRAMA AÇAÍ — servidor único (Node + node:sqlite + Express, SPA sem framework)
   ─────────────────────────────────────────────────────────────────────────
   MAPA DE ARQUITETURA (para navegar este arquivo — busque pelos marcadores):
     · "Banco de dados"            → init + PRAGMAs/WAL + migrações (Fase 37)
     · "Autenticação real"         → auth/sessões/perfis (Fase 12)
     · "Tempo real"                → canal SSE (Fase 16)
     · vendas / pagamentos         → PDV (busque `/api/vendas`)
     · pedidos / delivery          → `/api/pedidos`, expedição, entregadores
     · clientes / clientes_extrato → cadastro + FIADO (saldo calculado)
     · financeiro_*                → núcleo financeiro/fluxo (Fases 25/29)
     · caixa_sessoes               → fechamento de caixa (Fase 27)
     · fornecedores/erp_/contas_pagar → compras rápidas + contas a pagar (Fase 26)
     · cp_*                        → COMPRAS PROFISSIONAIS (Fases 31/34)
     · lotes / lotes_consumo       → CUSTO REAL / FIFO (Fase 30)
     · custo_* / producao_rendimento_perfil → CUSTOS/FORMAÇÃO DE PREÇO (Fase 35)
     · "FASE 33"                   → CONTAS A RECEBER (`/api/receber`)
     · "FASE 36"                   → registro de módulos + `/api/erp/consistencia`
     · "FASE 37"                   → HARDENING (pragmas, migrar(), emTransacao, /api/manutencao)
   CONVENÇÕES CENTRAIS (não violar): saldo/custo SEMPRE calculado (nunca guardado);
   integrações financeiras por referência + idempotência (syncFin); schema aditivo.
   ══════════════════════════════════════════════════════════════════════════ */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') }); // caminho explícito — o processo às vezes roda com cwd de outro projeto
const express = require('express');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
// A camada de IA (config / memória / prompt / tools / providers / orquestrador) vive em backend/ia/.
// config.js instancia os SDKs (OpenAI/Anthropic) e expõe as constantes da IA — precisa vir DEPOIS do
// dotenv (linha 2) pra enxergar as chaves. Ver 14_REFACTOR_IA_FASE2.md.
const iaConfig = require('./backend/ia/config');

const app = express();
app.use(express.json({ limit: '12mb' })); // 12mb pra caber o comprovante (imagem base64) no webhook

// ── Blindagem do processo ──────────────────────────────────────────────────
// Um erro solto no cliente do WhatsApp (ex.: EBUSY ao limpar a sessão depois de um
// LOGOUT, ou o Puppeteer quebrando) NÃO pode derrubar o servidor inteiro — o PDV, o
// Delivery e a Central de Atendimento precisam continuar no ar de qualquer jeito.
process.on('unhandledRejection', (err) => console.log('⚠️ Promessa rejeitada sem tratamento (servidor segue):', (err && err.message) || err));
process.on('uncaughtException', (err) => console.log('⚠️ Exceção não tratada (servidor segue):', (err && err.message) || err));

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
const db = new DatabaseSync(process.env.ACAI_DB || path.join(__dirname, 'acai.db'));

/* ══ FASE 37 — HARDENING: pragmas de performance/robustez + migrations versionadas ══
   WAL deixa leitores e escritores conviverem sem travar (essencial p/ crescer);
   synchronous=NORMAL é seguro com WAL e bem mais rápido; busy_timeout evita erro
   por lock momentâneo. Nada disso muda comportamento — só desempenho e robustez. */
try {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA cache_size = -8000');   // ~8 MB de cache de páginas
  db.exec('PRAGMA temp_store = MEMORY');
} catch (e) { console.log('⚠️ Falha ao aplicar pragmas:', e.message); }

// Registro de migrações aplicadas — formaliza a evolução do schema (antes era só ALTER em try/catch).
db.exec('CREATE TABLE IF NOT EXISTS schema_migracoes (id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT UNIQUE, aplicada_em TEXT)');
// migrar(chave, fn): roda fn UMA vez e registra; se já aplicada, não repete. Idempotente e auditável.
function migrar(chave, fn) {
  if (db.prepare('SELECT 1 FROM schema_migracoes WHERE chave=?').get(chave)) return false;
  try { fn(); db.prepare('INSERT INTO schema_migracoes (chave,aplicada_em) VALUES (?,?)').run(chave, new Date().toISOString()); return true; }
  catch (e) { console.log(`⚠️ Migração ${chave} falhou:`, e.message); return false; }
}
const SCHEMA_VERSAO = 'fase37';
// Marca a baseline (todo o schema criado até a Fase 36 por CREATE/ALTER inline) como um ponto conhecido.
migrar('baseline_ate_fase36', () => {});
// Índices de performance nas colunas quentes (filtros/joins) que ainda não tinham índice.
migrar('fase37_indices_performance', () => {
  const idx = [
    'CREATE INDEX IF NOT EXISTS idx_vendas_criado ON vendas(criado_em)',
    'CREATE INDEX IF NOT EXISTS idx_vendas_data ON vendas(data)',
    'CREATE INDEX IF NOT EXISTS idx_vendas_cliente ON vendas(cliente_id)',
    'CREATE INDEX IF NOT EXISTS idx_vendas_status ON vendas(status)',
    'CREATE INDEX IF NOT EXISTS idx_vitens_prod ON vendas_itens(produto_codigo)',
    'CREATE INDEX IF NOT EXISTS idx_pag_cliente ON pagamentos(cliente_id)',
    'CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status)',
    'CREATE INDEX IF NOT EXISTS idx_pedidos_criado ON pedidos(criado)',
    'CREATE INDEX IF NOT EXISTS idx_extrato_tipo ON clientes_extrato(tipo)',
    'CREATE INDEX IF NOT EXISTS idx_finmov_cat ON financeiro_movimentos(categoria_id)',
    'CREATE INDEX IF NOT EXISTS idx_lc_lp ON lotes_consumo(lote_produto_id)',
    'CREATE INDEX IF NOT EXISTS idx_cpagar_pedido ON contas_pagar(pedido_compra_id)',
    'CREATE INDEX IF NOT EXISTS idx_cpagar_status ON contas_pagar(status)',
    'CREATE INDEX IF NOT EXISTS idx_cppedidos_forn ON cp_pedidos(fornecedor_id)',
    'CREATE INDEX IF NOT EXISTS idx_cppedidos_status ON cp_pedidos(status)',
    'CREATE INDEX IF NOT EXISTS idx_cpreceb_pedido ON cp_recebimentos(pedido_id)',
    'CREATE INDEX IF NOT EXISTS idx_cprecebitens_rec ON cp_recebimentos_itens(recebimento_id)',
    'CREATE INDEX IF NOT EXISTS idx_estmov_criado ON estoque_movimentos(criado_em)',
    'CREATE INDEX IF NOT EXISTS idx_wpp_telefone ON mensagens_wpp(telefone)',
    'CREATE INDEX IF NOT EXISTS idx_logs_modulo ON logs_acoes(modulo)',
    'CREATE INDEX IF NOT EXISTS idx_prod_categoria ON produtos(categoria_id)',
    'CREATE INDEX IF NOT EXISTS idx_prod_marca ON produtos(marca_id)',
  ];
  for (const s of idx) { try { db.exec(s); } catch {} }
});

// emTransacao(fn): envelope BEGIN/COMMIT/ROLLBACK reutilizável (mesmo padrão já usado no PDV).
// Garante atomicidade de operações multi-escrita. Se `fn` lançar, desfaz tudo e repropaga.
function emTransacao(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

// ── Manutenção / OPS (Fase 11): backup automático, logs de erro/ações e mídia ──
// Cria as pastas backups/ e logs/ + a tabela logs_acoes. Ver 24_BACKUP_SEGURANCA_FASE11.md.
const manut = require('./backend/manutencao')({ db, rootDir: __dirname });
const atualizacao = require('./backend/atualizacao')({ db, rootDir: __dirname, manut });
// além do console (blindagem acima), grava os erros de processo em logs/erro.log
process.on('unhandledRejection', (err) => manut.logErro('unhandledRejection', err));
process.on('uncaughtException', (err) => manut.logErro('uncaughtException', err));

// ── Autenticação real (Fase 12): usuários + sessões + perfis ────────────────
// PRECISA vir antes de TODAS as rotas /api/* (menos as exceções internas do
// middleware: /api/auth/login e o webhook da IA). Ver 25_AUTENTICACAO_USUARIOS_FASE12.md.
const auth = require('./backend/auth')({ db, logAcao: manut.logAcao });
app.use(auth.middleware);
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);
app.get('/api/auth/me', auth.me);
app.post('/api/auth/supervisor', auth.supervisor);
auth.rotasUsuarios(app); // GET/POST/PUT /api/usuarios* (o middleware exige admin nessas rotas)

// ── Tempo real (Fase 16): canal SSE server→client pra Central de Atendimento ──
// Vem DEPOIS do middleware de auth (linha 56): sem sessão, o request nem chega no
// handler. `realtime.emitir(evento, dados)` é chamado nos pontos de mudança abaixo.
const realtime = require('./backend/realtime')({ db, logErro: manut.logErro });
app.get('/api/eventos', realtime.handler);

// Endpoints administrativos (o middleware acima exige perfil ADMIN em /api/backup*, /api/manutencao* e /api/logs-acoes)
// Logs de ações críticas/segurança (Fase 13 — alimenta a aba Segurança da tela de Administração)
app.get('/api/logs-acoes', (req, res) => {
  const { acao, modulo, de, ate } = req.query;
  const cond = [], args = [];
  if (acao) { cond.push('acao LIKE ?'); args.push(`%${acao}%`); }
  if (modulo) { cond.push('modulo LIKE ?'); args.push(`%${modulo}%`); }
  if (de) { cond.push('data >= ?'); args.push(de); }
  if (ate) { cond.push('data <= ?'); args.push(ate + 'T23:59:59'); }
  const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';
  res.json(db.prepare(`SELECT * FROM logs_acoes${where} ORDER BY id DESC LIMIT 500`).all(...args));
});
app.get('/api/backup/status', (req, res) => res.json(manut.statusBackup()));
app.get('/api/backup/listar', (req, res) => res.json(manut.listarBackups()));
app.post('/api/backup/criar', (req, res) => res.json(manut.criarBackup('manual')));
app.get('/api/manutencao/midia/status', (req, res) => res.json(manut.statusMidia()));
app.post('/api/manutencao/midia/limpar', (req, res) => res.json(manut.limparMidia(req.body && req.body.dias)));

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
// Fase 18 — vínculo do pedido ao cliente unificado (preenchido na criação e na migração)
try { db.exec('ALTER TABLE pedidos ADD COLUMN cliente_id INTEGER'); } catch {}
db.exec('CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id)');
// Fase 22 — EXPEDIÇÃO: entregador + carimbos de rota/entrega (aditivo, não muda o fluxo atual).
for (const col of ['entregador_id INTEGER', 'saiu_para_entrega_em TEXT', 'entregue_em TEXT', 'previsao_entrega_em TEXT', 'rota_obs TEXT', 'tempo_entrega_min REAL']) {
  try { db.exec(`ALTER TABLE pedidos ADD COLUMN ${col}`); } catch {}
}
db.exec('CREATE INDEX IF NOT EXISTS idx_pedidos_entregador ON pedidos(entregador_id)');
// Cadastro de entregadores da loja (desativa sem apagar histórico)
db.exec(`CREATE TABLE IF NOT EXISTS entregadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL, telefone TEXT, ativo INTEGER DEFAULT 1, obs TEXT,
  criado_em TEXT, atualizado_em TEXT
)`);
// Fase 23 — acesso mobile do entregador (login por telefone + PIN, sessão própria por token)
for (const col of ['pin_hash TEXT', 'token_acesso TEXT', 'ultimo_acesso TEXT']) {
  try { db.exec(`ALTER TABLE entregadores ADD COLUMN ${col}`); } catch {}
}
db.exec(`
  CREATE TABLE IF NOT EXISTS produtos (
    codigo TEXT PRIMARY KEY,
    nome TEXT, precoVenda REAL, estoque REAL, departamento TEXT,
    disponivel INTEGER DEFAULT 1
  )
`);
// migração pra bancos antigos que já tinham a tabela sem a coluna "disponivel"
try { db.exec('ALTER TABLE produtos ADD COLUMN disponivel INTEGER DEFAULT 1'); } catch {}
// Fase 9: a tabela produtos vira a FONTE PRINCIPAL (antes era só espelho pra IA).
// Colunas que faltavam pra guardar o cadastro completo que vinha do localStorage:
for (const col of ['precoCompra REAL', 'estoqueMin REAL', 'fornecedor TEXT', 'conjunto TEXT', 'vendacaixa REAL', 'unidCaixa REAL', 'atualizado_em TEXT', 'descricao_conjunto TEXT', 'granel INTEGER DEFAULT 0']) {
  try { db.exec(`ALTER TABLE produtos ADD COLUMN ${col}`); } catch {}
}
// Movimentos de estoque (auditoria: entrada/saida/ajuste/cancelamento) — não muda o comportamento atual
db.exec(`CREATE TABLE IF NOT EXISTS estoque_movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_codigo TEXT NOT NULL,
  tipo TEXT NOT NULL,            -- 'entrada' | 'saida' | 'ajuste' | 'cancelamento'
  quantidade REAL NOT NULL,
  estoque_anterior REAL, estoque_novo REAL,
  motivo TEXT, referencia TEXT, criado_em TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_mov_produto ON estoque_movimentos(produto_codigo)');

// ── Configurações da loja (chave/valor) — ex.: loja aberta/fechada ──
db.exec('CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT)');
// Números que recebem uma CÓPIA de cada pedido novo pelo WhatsApp (ex.: cozinha, entregador, dono).
// Cada um tem um liga/desliga (ativo) — só os ligados recebem.
db.exec('CREATE TABLE IF NOT EXISTS destinatarios_copia (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, telefone TEXT NOT NULL, ativo INTEGER DEFAULT 1)');
// Avisos editáveis (4 slots): quando ligados, a IA passa o texto pro cliente durante o atendimento.
db.exec('CREATE TABLE IF NOT EXISTS avisos (id INTEGER PRIMARY KEY, texto TEXT DEFAULT \'\', ativo INTEGER DEFAULT 0)');
for (let i = 1; i <= 4; i++) if (!db.prepare('SELECT id FROM avisos WHERE id = ?').get(i)) db.prepare('INSERT INTO avisos (id, texto, ativo) VALUES (?,\'\',0)').run(i);

// ── Estado de atendimento POR CONVERSA (Fase 15) ─────────────────────────────
// Controla, telefone a telefone, se quem responde é a IA ou um humano, e guarda
// observações do operador. SEM linha = padrão (IA no automático). Ver 28_*.
db.exec(`CREATE TABLE IF NOT EXISTS atendimento_estado (
  telefone TEXT PRIMARY KEY,
  modo TEXT DEFAULT 'ia',            -- 'ia' (automático) | 'humano' (operador assumiu)
  ia_ativa INTEGER DEFAULT 1,        -- liga/desliga a IA SÓ nesta conversa (1=on, 0=off)
  assumido_por INTEGER,              -- id do usuário que assumiu
  assumido_nome TEXT,                -- nome pra exibir na tela sem novo JOIN
  assumido_em TEXT,
  obs TEXT DEFAULT '',               -- observações do operador sobre o cliente
  atualizado_em TEXT
)`);
// Estado atual da conversa (com defaults quando ainda não há linha)
function estadoAtendimento(telefone) {
  const tel = telefone || '';
  const r = db.prepare('SELECT * FROM atendimento_estado WHERE telefone = ?').get(tel);
  if (!r) return { telefone: tel, modo: 'ia', ia_ativa: 1, assumido_por: null, assumido_nome: null, assumido_em: null, obs: '', atualizado_em: null, existe: false };
  return { ...r, existe: true };
}
// A IA só responde SOZINHA se a conversa não estiver em modo humano E a IA por-conversa estiver ligada.
// Padrão (sem linha) = aceita (mantém o comportamento anterior à Fase 15).
function conversaAceitaIA(telefone) {
  const e = estadoAtendimento(telefone);
  return e.modo !== 'humano' && e.ia_ativa !== 0;
}
// Grava só os campos enviados, preservando o resto do estado (upsert por telefone).
function upsertEstado(telefone, campos) {
  const a = estadoAtendimento(telefone);
  const novo = {
    modo: campos.modo !== undefined ? campos.modo : a.modo,
    ia_ativa: campos.ia_ativa !== undefined ? (campos.ia_ativa ? 1 : 0) : a.ia_ativa,
    assumido_por: campos.assumido_por !== undefined ? campos.assumido_por : a.assumido_por,
    assumido_nome: campos.assumido_nome !== undefined ? campos.assumido_nome : a.assumido_nome,
    assumido_em: campos.assumido_em !== undefined ? campos.assumido_em : a.assumido_em,
    obs: campos.obs !== undefined ? campos.obs : a.obs,
    atualizado_em: new Date().toISOString(),
  };
  db.prepare(`INSERT INTO atendimento_estado (telefone, modo, ia_ativa, assumido_por, assumido_nome, assumido_em, obs, atualizado_em)
              VALUES (?,?,?,?,?,?,?,?)
              ON CONFLICT(telefone) DO UPDATE SET modo=excluded.modo, ia_ativa=excluded.ia_ativa,
                assumido_por=excluded.assumido_por, assumido_nome=excluded.assumido_nome,
                assumido_em=excluded.assumido_em, obs=excluded.obs, atualizado_em=excluded.atualizado_em`)
    .run(telefone || '', novo.modo, novo.ia_ativa, novo.assumido_por, novo.assumido_nome, novo.assumido_em, novo.obs, novo.atualizado_em);
  return estadoAtendimento(telefone);
}
function getConfig(chave, padrao) {
  const r = db.prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
  return r ? r.valor : padrao;
}
function setConfig(chave, valor) {
  db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, String(valor));
}
const lojaEstaAberta = () => getConfig('loja_aberta', '1') === '1'; // começa aberta por padrão
const soRetirada = () => getConfig('retirada_apenas', '0') === '1'; // só retirada no balcão (sem entrega)
const iaAutoLigada = () => getConfig('ia_auto', '0') === '1'; // IA responde os clientes SOZINHA (qualquer um que escrever, em qualquer número conectado). Começa DESLIGADA.
// Janela pós-pedido — definida na config da IA (backend/ia/config.js). Aqui é usada por
// alterarUltimoPedidoIA; dentro da camada de IA, pela memória (resetarSeExpirado/finalizar).
// (TEMPO_ENTREGA e proximaAbertura foram pra backend/ia/prompt.js — só o prompt os usa.)
const JANELA_ALTERACAO_MS = iaConfig.JANELA_ALTERACAO_MS;

app.get('/api/loja/estado', (req, res) => res.json({ aberta: lojaEstaAberta(), retiradaApenas: soRetirada(), iaAuto: iaAutoLigada() }));
app.post('/api/loja/estado', (req, res) => {
  const b = req.body || {};
  if (b.aberta !== undefined) setConfig('loja_aberta', b.aberta ? '1' : '0');
  if (b.retiradaApenas !== undefined) setConfig('retirada_apenas', b.retiradaApenas ? '1' : '0');
  if (b.iaAuto !== undefined) setConfig('ia_auto', b.iaAuto ? '1' : '0');
  console.log(`🏪 Loja: ${lojaEstaAberta() ? 'ABERTA' : 'FECHADA'}${soRetirada() ? ' | SÓ RETIRADA' : ''} | IA auto: ${iaAutoLigada() ? 'LIGADA' : 'desligada'}.`);
  res.json({ ok: true, aberta: lojaEstaAberta(), retiradaApenas: soRetirada(), iaAuto: iaAutoLigada() });
});

/* ── Configuração / identidade da loja (Fase 20) ─────────────────────────────
   Centraliza os DADOS DA LOJA na mesma tabela `config` (chave/valor), sem tabela
   nova: identidade + parâmetros operacionais simples que o sistema usa em vários
   lugares (título, atendimento, taxa padrão). GET é leitura pra qualquer logado;
   salvar exige admin. Ver 33_POLIMENTO_PREPARACAO_COMERCIAL_FASE20.md. */
const CAMPOS_LOJA = {
  loja_nome: 'Açaí do Centro', loja_telefone: '', loja_endereco: '', loja_bairro: '',
  loja_horario: '', loja_taxa_entrega: '0', loja_mensagem_atendimento: '', loja_configurada: '0',
  insumo_falta_modo: 'avisar', // Fase 21: 'avisar' | 'bloquear' | 'supervisor' (falta de insumo na venda)
  // Fase 24 — CRM / fidelidade (cashback). Regras editáveis; padrões coerentes pra loja de açaí.
  fidelidade_modo: 'cashback',      // 'cashback' | 'off'
  fidelidade_percentual: '5',       // % da venda elegível que vira saldo do cliente
  crm_dias_inativo: '30',           // sem comprar há mais que isso → inativo/sumido
  crm_vip_gasto: '300',             // gastou >= isso (total) → VIP
  crm_vip_compras: '10',            // OU fez >= tantas compras → VIP
  crm_recorrente_compras: '3',      // >= tantas compras → recorrente
};
function lerConfigLoja() {
  const o = {};
  for (const k of Object.keys(CAMPOS_LOJA)) o[k] = getConfig(k, CAMPOS_LOJA[k]);
  o.loja_taxa_entrega = +o.loja_taxa_entrega || 0;
  o.loja_configurada = o.loja_configurada === '1';
  return o;
}
app.get('/api/loja/config', (req, res) => res.json(lerConfigLoja()));
app.put('/api/loja/config', (req, res) => {
  if (!req.usuario || req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Só o administrador pode alterar os dados da loja.' });
  const b = req.body || {};
  for (const k of Object.keys(CAMPOS_LOJA)) if (b[k] !== undefined) setConfig(k, b[k]);
  setConfig('loja_configurada', '1'); // marca que a loja foi configurada ao menos uma vez
  manut.logAcao('dados da loja alterados', 'loja', { por: req.usuario.usuario, campos: Object.keys(b) }, 'config');
  res.json(lerConfigLoja());
});
// Status geral da instalação (pra tela de Administração → Dados) — visão rápida do que já está pronto.
app.get('/api/loja/status-instalacao', (req, res) => {
  const cont = (sql) => { try { return db.prepare(sql).get().n; } catch { return 0; } };
  res.json({
    usuarios: cont('SELECT COUNT(*) n FROM usuarios'),
    admins: cont("SELECT COUNT(*) n FROM usuarios WHERE perfil='admin' AND ativo=1"),
    produtos: cont('SELECT COUNT(*) n FROM produtos'),
    clientes: cont('SELECT COUNT(*) n FROM clientes'),
    vendas: cont('SELECT COUNT(*) n FROM vendas'),
    pedidos: cont('SELECT COUNT(*) n FROM pedidos'),
    lojaConfigurada: getConfig('loja_configurada', '0') === '1',
    whatsappConectado: !!whatsappPronto,
    temBackup: (() => { try { return (manut.listarBackups() || []).length > 0; } catch { return false; } })(),
  });
});

/* ── Exportação de dados (Fase 20) — admin (via middleware). JSON ou CSV. ─────
   Backup manual / auditoria / migração / transparência. Só leitura. */
function _csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = v => { if (v == null) return ''; const s = String(v).replace(/"/g, '""'); return /[",\n;]/.test(s) ? `"${s}"` : s; };
  return [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))].join('\n');
}
const EXPORT_FONTES = {
  clientes: () => db.prepare('SELECT id,nome,telefone,telefone_normalizado,bairro,endereco,obs,origem_principal,criado_em FROM clientes ORDER BY id').all(),
  produtos: () => db.prepare('SELECT codigo,nome,departamento,precoVenda,precoCompra,estoque,estoqueMin,disponivel FROM produtos ORDER BY nome').all(),
  vendas: () => db.prepare('SELECT id,numero,data,total,status,origem,operador FROM vendas ORDER BY id DESC').all(),
  pedidos: () => db.prepare('SELECT id,numero,cliente,telefone,itens,total,status,criado,origem FROM pedidos ORDER BY id DESC').all(),
  compras: () => db.prepare('SELECT id,data,numNota,fornecedor,descricao,total,origem FROM compras ORDER BY id DESC').all(),
  insumos: () => db.prepare('SELECT id,nome,unidade,qtd,saldo,custo_total,custo_unitario FROM insumos ORDER BY id').all(),
};
app.get('/api/exportar/:tipo', (req, res) => {
  const tipo = req.params.tipo;
  const hoje = new Date().toISOString().slice(0, 10);
  if (tipo === 'tudo') {
    const tudo = {}; for (const k of Object.keys(EXPORT_FONTES)) tudo[k] = EXPORT_FONTES[k]();
    manut.logAcao('exportação de dados', 'dados', { tipo: 'tudo', por: (req.usuario || {}).usuario }, 'config');
    res.setHeader('Content-Disposition', `attachment; filename="acai-export-tudo-${hoje}.json"`);
    return res.json({ exportado_em: new Date().toISOString(), ...tudo });
  }
  const fn = EXPORT_FONTES[tipo];
  if (!fn) return res.status(400).json({ erro: 'Tipo inválido. Use: ' + Object.keys(EXPORT_FONTES).join(', ') + ' ou tudo.' });
  const rows = fn();
  manut.logAcao('exportação de dados', 'dados', { tipo, registros: rows.length, por: (req.usuario || {}).usuario }, 'config');
  const nome = `acai-${tipo}-${hoje}`;
  if ((req.query.formato || 'json') === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.csv"`);
    return res.send(_csv(rows));
  }
  res.setHeader('Content-Disposition', `attachment; filename="${nome}.json"`);
  res.json(rows);
});

/* ── Importação assistida (Fase 20) — admin. Base simples e IDEMPOTENTE ───────
   Aceita o array exportado. Clientes casam pelo telefone normalizado (unificado);
   produtos pelo código (upsert). NÃO apaga nada; só cria/atualiza. */
app.post('/api/importar/clientes', (req, res) => {
  const lista = Array.isArray(req.body) ? req.body : (Array.isArray(req.body && req.body.clientes) ? req.body.clientes : []);
  let criados = 0, atualizados = 0;
  db.exec('BEGIN');
  try {
    for (const c of lista) {
      if (!c || !c.nome) continue;
      const r = acharOuCriarClienteUnificado(c.telefone || '', { nome: c.nome, endereco: c.endereco, bairro: c.bairro }, c.origem_principal || 'importado');
      if (r.criado) criados++; else atualizados++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ erro: e.message }); }
  manut.logAcao('importação de dados', 'dados', { tipo: 'clientes', criados, atualizados, por: (req.usuario || {}).usuario }, 'config');
  res.json({ ok: true, criados, atualizados });
});
app.post('/api/importar/produtos', (req, res) => {
  const lista = Array.isArray(req.body) ? req.body : (Array.isArray(req.body && req.body.produtos) ? req.body.produtos : []);
  let importados = 0;
  const agora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const p of lista) { if (p && p.codigo && p.nome) { upsertProduto(p, agora); importados++; } }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ erro: e.message }); }
  manut.logAcao('importação de dados', 'dados', { tipo: 'produtos', importados, por: (req.usuario || {}).usuario }, 'config');
  res.json({ ok: true, importados });
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
  const orig = origem || d.origem || 'manual';
  // Fase 18: vincula ao cliente unificado (acha ou cria pelo telefone normalizado). Não trava o pedido se falhar.
  let clienteId = null;
  try {
    if (d.telefone) {
      const r = acharOuCriarClienteUnificado(d.telefone, { nome: d.cliente, endereco: d.endereco, bairro: d.bairro }, orig === 'ia' ? 'atendimento' : 'delivery');
      clienteId = r.cliente ? r.cliente.id : null;
      if (r.criado) manut.logAcao('cliente criado por pedido', 'clientes', { cliente_id: clienteId, telefone: d.telefone, origem: orig }, 'operacao');
    }
  } catch (e) { manut.logErro('vincular-cliente-pedido', e); }
  const pedido = {
    id: Date.now(), numero: proximoNumeroPedido(),
    cliente: d.cliente, telefone: d.telefone || '', bairro: d.bairro || '',
    endereco: d.endereco, complemento: d.complemento || '', itens: d.itens || '',
    valor, taxa, total: valor + taxa, pagamento: d.pagamento || 'Dinheiro', troco: +d.troco || 0,
    status: 'pendente', criado: new Date().toISOString(), origem: orig, cliente_id: clienteId,
  };
  db.prepare(`INSERT INTO pedidos (id,numero,cliente,telefone,bairro,endereco,complemento,itens,valor,taxa,total,pagamento,troco,status,criado,origem,cliente_id)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    pedido.id, pedido.numero, pedido.cliente, pedido.telefone, pedido.bairro, pedido.endereco, pedido.complemento,
    pedido.itens, pedido.valor, pedido.taxa, pedido.total, pedido.pagamento, pedido.troco, pedido.status, pedido.criado, pedido.origem, pedido.cliente_id
  );
  enviarCopiaPedido(pedido).catch(() => {}); // manda cópia pros números ligados — em segundo plano, não trava a criação
  syncFin(sincronizarFinanceiroPedido, pedido.id); // Fase 25: cria a entrada de delivery PENDENTE (confirma ao entregar)
  // Fase 27: enfileira pra impressão futura (estrutura pronta; NÃO imprime ainda). Nunca trava o pedido.
  if (typeof enfileirarImpressao === 'function') enfileirarImpressao('pedido', pedido.id, `Pedido #${pedido.numero}`, { numero: pedido.numero, cliente: pedido.cliente, itens: pedido.itens, total: pedido.total, pagamento: pedido.pagamento, endereco: pedido.endereco, bairro: pedido.bairro });
  return pedido;
}

// Ajusta o ÚLTIMO pedido pendente desse telefone feito dentro da janela de alteração
// (cliente mudou algo logo após confirmar). Se não achar um recente, cria um novo (segurança).
// Só troca os campos que vieram preenchidos — mantém o resto do pedido original.
function alterarUltimoPedidoIA(telefone, d) {
  const limite = new Date(Date.now() - JANELA_ALTERACAO_MS).toISOString();
  const p = db.prepare("SELECT * FROM pedidos WHERE telefone = ? AND status = 'pendente' AND criado >= ? ORDER BY id DESC LIMIT 1").get(telefone || '', limite);
  if (!p) return criarPedidoNoBanco({ ...d, telefone }, 'ia'); // nada recente pra ajustar → cria normal
  const manter = (novo, velho) => (novo === undefined || novo === null || novo === '') ? velho : novo;
  const num = (novo, velho) => (novo === undefined || novo === null || novo === '') ? velho : +novo;
  const valor = num(d.valor, p.valor), taxa = num(d.taxa, p.taxa);
  db.prepare('UPDATE pedidos SET cliente=?, endereco=?, bairro=?, complemento=?, itens=?, valor=?, taxa=?, total=?, pagamento=?, troco=? WHERE id=?')
    .run(manter(d.cliente, p.cliente), manter(d.endereco, p.endereco), manter(d.bairro, p.bairro), manter(d.complemento, p.complemento),
         manter(d.itens, p.itens), valor, taxa, valor + taxa, manter(d.pagamento, p.pagamento), num(d.troco, p.troco), p.id);
  const atualizado = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(p.id);
  atualizado._alterado = true;
  console.log(`✏️ Pedido #${atualizado.numero} ALTERADO pra ${telefone} (ajuste na janela de ${Math.round(JANELA_ALTERACAO_MS / 60000)} min).`);
  return atualizado;
}

/* ── Consultas de contexto pra IA (Fase 3) — SÓ LEITURA, sem efeito colateral. ─────
   Injetadas na camada de IA (backend/ia/) pra alimentar as tools de consulta.
   Usam só as tabelas que já existem (pedidos, produtos). A IA NUNCA inventa dado:
   se a consulta voltar vazia, ela responde que não encontrou. */
// último pedido daquele telefone (qualquer status)
function ultimoPedidoDoTelefone(telefone) {
  return db.prepare('SELECT numero, itens, valor, total, pagamento, endereco, complemento, bairro, troco, status, criado, origem FROM pedidos WHERE telefone = ? ORDER BY id DESC LIMIT 1').get(telefone || '') || null;
}
// pedido mais recente ainda EM ANDAMENTO (pendente/preparo/rota); se não houver, o mais recente qualquer
function pedidoAbertoDoTelefone(telefone) {
  // inclui o id (chave usada no PUT /api/pedidos/:id) pra o painel do Atendimento poder mudar o status
  return db.prepare("SELECT id, numero, status, itens, valor, total, endereco, complemento, criado, origem, entregador_id, saiu_para_entrega_em, tempo_entrega_min FROM pedidos WHERE telefone = ? AND status IN ('pendente','preparo','pronto','rota') ORDER BY id DESC LIMIT 1").get(telefone || '')
      || db.prepare('SELECT id, numero, status, itens, valor, total, endereco, complemento, criado, origem, entregador_id, saiu_para_entrega_em, tempo_entrega_min FROM pedidos WHERE telefone = ? ORDER BY id DESC LIMIT 1').get(telefone || '')
      || null;
}
// produtos disponíveis agora (o mesmo espelho do catálogo que a IA já oferece)
function produtosDisponiveis() {
  return db.prepare('SELECT codigo, nome, precoVenda, departamento FROM produtos WHERE disponivel = 1 ORDER BY nome').all();
}

app.get('/api/pedidos', (req, res) => {
  res.json(db.prepare('SELECT * FROM pedidos ORDER BY id DESC').all());
});
// pedido único (usado pelo relatório de compra no detalhe do cliente)
app.get('/api/pedidos/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(+req.params.id);
  p ? res.json(p) : res.status(404).json({ erro: 'Pedido não encontrado.' });
});
app.post('/api/pedidos', (req, res) => {
  const d = req.body || {};
  if (!d.cliente || !d.endereco) return res.status(400).json({ erro: 'Cliente e endereço são obrigatórios.' });
  res.json(criarPedidoNoBanco(d, d.origem || 'manual'));
});
app.put('/api/pedidos/:id', (req, res) => {
  const id = +req.params.id;
  const atual = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!atual) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  const campos = ['status', 'cliente', 'telefone', 'bairro', 'endereco', 'complemento', 'itens', 'pagamento', 'troco'];
  const updates = {};
  campos.forEach(c => { if (req.body[c] !== undefined) updates[c] = req.body[c]; });
  if (Object.keys(updates).length === 0) return res.status(400).json({ erro: 'Nada pra atualizar.' });
  // Fase 22: qualquer caminho que mude o status (quadro/atendimento) carimba os horários de expedição.
  if (updates.status === 'rota' && !atual.saiu_para_entrega_em) updates.saiu_para_entrega_em = new Date().toISOString();
  if (updates.status === 'entregue' && !atual.entregue_em) {
    updates.entregue_em = new Date().toISOString();
    if (atual.saiu_para_entrega_em) updates.tempo_entrega_min = Math.max(0, Math.round((Date.now() - new Date(atual.saiu_para_entrega_em).getTime()) / 60000));
  }
  const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE pedidos SET ${sets} WHERE id = ?`).run(...Object.values(updates), id);
  const pedidoAtualizado = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  // Fase 15: registra a troca de status (Parte 9) — guarda de onde veio (Delivery x Atendimento)
  if (updates.status !== undefined) {
    const via = (req.body && req.body.via) === 'atendimento' ? 'atendimento' : 'delivery';
    manut.logAcao('status de pedido alterado', via, { id, status: updates.status, por: (req.usuario || {}).usuario || null }, 'operacao');
    // Fase 16: avisa a Central em tempo real (o painel da conversa daquele telefone se atualiza)
    realtime.emitir('pedido_status_alterado', { id, status: updates.status, telefone: pedidoAtualizado && pedidoAtualizado.telefone });
  }
  if (updates.status !== undefined) syncFin(sincronizarFinanceiroPedido, id); // Fase 25: pendente→confirmado (entregue) / estorno (cancelado)
  res.json(pedidoAtualizado);
});
app.delete('/api/pedidos/:id', (req, res) => {
  db.prepare('DELETE FROM pedidos WHERE id = ?').run(+req.params.id);
  manut.logAcao('exclusão de pedido', 'delivery', { id: +req.params.id }, 'admin');
  syncFin(sincronizarFinanceiroPedido, +req.params.id); // Fase 25: pedido removido → estorna o movimento
  res.json({ ok: true });
});

/* ══ EXPEDIÇÃO / ENTREGADORES (Fase 22) ═════════════════════════════════════ */
function nomeEntregador(id) { if (!id) return null; const e = db.prepare('SELECT nome FROM entregadores WHERE id = ?').get(id); return e ? e.nome : null; }
// nunca devolve pin_hash/token pro cliente; expõe só se o entregador JÁ tem PIN (Fase 23)
function entregadorPublico(e) {
  if (!e) return null;
  return { id: e.id, nome: e.nome, telefone: e.telefone, ativo: e.ativo, obs: e.obs, criado_em: e.criado_em, atualizado_em: e.atualizado_em, temPin: !!e.pin_hash, ultimo_acesso: e.ultimo_acesso };
}

// Entregadores — GET (qualquer logado); POST/PUT exigem supervisor (via middleware).
app.get('/api/entregadores', (req, res) => {
  const soAtivos = req.query.ativos === '1';
  res.json(db.prepare(`SELECT * FROM entregadores ${soAtivos ? 'WHERE ativo = 1 ' : ''}ORDER BY ativo DESC, nome`).all().map(entregadorPublico));
});
app.post('/api/entregadores', (req, res) => {
  const d = req.body || {};
  if (!d.nome || !String(d.nome).trim()) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  const agora = new Date().toISOString();
  const pinHash = (d.pin && String(d.pin).length >= 4) ? auth.hashSenha(String(d.pin)) : null; // Fase 23: PIN opcional já no cadastro
  const info = db.prepare('INSERT INTO entregadores (nome,telefone,ativo,obs,pin_hash,criado_em,atualizado_em) VALUES (?,?,1,?,?,?,?)')
    .run(String(d.nome).trim(), (d.telefone || '').trim(), d.obs || '', pinHash, agora, agora);
  manut.logAcao('entregador criado', 'expedicao', { id: info.lastInsertRowid, nome: d.nome, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(entregadorPublico(db.prepare('SELECT * FROM entregadores WHERE id = ?').get(info.lastInsertRowid)));
});
app.put('/api/entregadores/:id', (req, res) => {
  const id = +req.params.id, d = req.body || {};
  if (!db.prepare('SELECT id FROM entregadores WHERE id = ?').get(id)) return res.status(404).json({ erro: 'Entregador não encontrado.' });
  db.prepare('UPDATE entregadores SET nome = COALESCE(?,nome), telefone = ?, obs = ?, ativo = COALESCE(?,ativo), atualizado_em = ? WHERE id = ?')
    .run(d.nome != null ? d.nome : null, d.telefone || '', d.obs || '', d.ativo != null ? (d.ativo ? 1 : 0) : null, new Date().toISOString(), id);
  // Fase 23: (re)definir o PIN de acesso mobile — nunca guardado em texto
  if (d.pin !== undefined) {
    if (d.pin === '' || d.pin === null) db.prepare('UPDATE entregadores SET pin_hash = NULL, token_acesso = NULL WHERE id = ?').run(id); // remove acesso
    else if (String(d.pin).length >= 4) { db.prepare('UPDATE entregadores SET pin_hash = ?, token_acesso = NULL WHERE id = ?').run(auth.hashSenha(String(d.pin)), id); manut.logAcao('pin de entregador definido', 'expedicao', { id, por: (req.usuario || {}).usuario }, 'seguranca'); }
    else return res.status(400).json({ erro: 'O PIN precisa de pelo menos 4 dígitos.' });
  }
  manut.logAcao(d.ativo === false ? 'entregador desativado' : 'entregador editado', 'expedicao', { id, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(entregadorPublico(db.prepare('SELECT * FROM entregadores WHERE id = ?').get(id)));
});

// Despachar → ROTA com entregador + carimba a saída (e previsão opcional)
app.post('/api/pedidos/:id/despachar', (req, res) => {
  const id = +req.params.id, d = req.body || {};
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  const entregadorId = +d.entregador_id || null;
  if (entregadorId && !db.prepare('SELECT id FROM entregadores WHERE id = ?').get(entregadorId)) return res.status(400).json({ erro: 'Entregador inválido.' });
  const agora = new Date().toISOString();
  const previsao = (+d.previsao_min > 0) ? new Date(Date.now() + (+d.previsao_min) * 60000).toISOString() : null;
  db.prepare("UPDATE pedidos SET status = 'rota', entregador_id = ?, saiu_para_entrega_em = COALESCE(saiu_para_entrega_em, ?), previsao_entrega_em = ?, rota_obs = ? WHERE id = ?")
    .run(entregadorId, agora, previsao, d.rota_obs || '', id);
  manut.logAcao('pedido despachado', 'expedicao', { pedido: p.numero, id, entregador: nomeEntregador(entregadorId), entregador_id: entregadorId, por: (req.usuario || {}).usuario }, 'operacao');
  realtime.emitir('pedido_status_alterado', { id, status: 'rota', telefone: p.telefone });
  syncFin(sincronizarFinanceiroPedido, id); // Fase 25
  res.json(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id));
});
// Marcar ENTREGUE → carimba a entrega e calcula o tempo de rota (min)
app.post('/api/pedidos/:id/entregar', (req, res) => {
  const id = +req.params.id;
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  const tempo = p.saiu_para_entrega_em ? Math.max(0, Math.round((Date.now() - new Date(p.saiu_para_entrega_em).getTime()) / 60000)) : null;
  db.prepare("UPDATE pedidos SET status = 'entregue', entregue_em = ?, tempo_entrega_min = ? WHERE id = ?").run(new Date().toISOString(), tempo, id);
  manut.logAcao('pedido entregue', 'expedicao', { pedido: p.numero, id, entregador: nomeEntregador(p.entregador_id), tempo_min: tempo, por: (req.usuario || {}).usuario }, 'operacao');
  realtime.emitir('pedido_status_alterado', { id, status: 'entregue', telefone: p.telefone });
  syncFin(sincronizarFinanceiroPedido, id); // Fase 25: entrega confirmada → entrada confirmada
  res.json(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id));
});
// Retornar de rota → volta pra 'pronto' (corrige despacho errado)
app.post('/api/pedidos/:id/retornar', (req, res) => {
  const id = +req.params.id;
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  db.prepare("UPDATE pedidos SET status = 'pronto', saiu_para_entrega_em = NULL, previsao_entrega_em = NULL WHERE id = ?").run(id);
  manut.logAcao('pedido retornou da rota', 'expedicao', { pedido: p.numero, id, por: (req.usuario || {}).usuario }, 'operacao');
  realtime.emitir('pedido_status_alterado', { id, status: 'pronto', telefone: p.telefone });
  syncFin(sincronizarFinanceiroPedido, id); // Fase 25: volta a pendente
  res.json(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id));
});

// Resumo da expedição — blocos do painel (prontos, em rota, entregues hoje, entregadores)
app.get('/api/expedicao/resumo', (req, res) => {
  const prontos = db.prepare("SELECT * FROM pedidos WHERE status IN ('preparo','pronto') ORDER BY id DESC").all();
  const rota = db.prepare("SELECT * FROM pedidos WHERE status = 'rota' ORDER BY saiu_para_entrega_em").all()
    .map(p => ({ ...p, entregador_nome: nomeEntregador(p.entregador_id), min_em_rota: p.saiu_para_entrega_em ? Math.round((Date.now() - new Date(p.saiu_para_entrega_em).getTime()) / 60000) : null }));
  const eh = db.prepare("SELECT COUNT(*) n, COALESCE(AVG(tempo_entrega_min),0) tmedio FROM pedidos WHERE status = 'entregue' AND entregue_em IS NOT NULL AND date(entregue_em,'localtime') = date('now','localtime')").get();
  const entregadores = db.prepare('SELECT * FROM entregadores WHERE ativo = 1 ORDER BY nome').all().map(e => {
    const emRota = db.prepare("SELECT COUNT(*) n FROM pedidos WHERE status = 'rota' AND entregador_id = ?").get(e.id).n;
    const hoje = db.prepare("SELECT COUNT(*) n, COALESCE(AVG(tempo_entrega_min),0) tmedio FROM pedidos WHERE status = 'entregue' AND entregador_id = ? AND date(entregue_em,'localtime') = date('now','localtime')").get(e.id);
    return { id: e.id, nome: e.nome, telefone: e.telefone, emRota, entreguesHoje: hoje.n, tempoMedio: Math.round(hoje.tmedio), temPin: !!e.pin_hash };
  });
  res.json({ prontos, rota, emRota: rota.length, entreguesHoje: { total: eh.n, tempoMedio: Math.round(eh.tmedio) }, entregadores });
});

/* ══ PAINEL DO ENTREGADOR (Fase 23) — sessão PRÓPRIA por PIN, isolada da equipe ══
   O middleware de auth exime /api/entregador/* — a segurança aqui é o cookie
   'acai_entregador' (token aleatório; no banco só o SHA-256). O entregador só
   enxerga/atualiza os PEDIDOS DELE. Ver 37_PAINEL_ENTREGADOR_MOBILE_FASE23.md. */
const _shaEnt = t => require('crypto').createHash('sha256').update(String(t)).digest('hex');
const SESSAO_ENTREGADOR_DIAS = 30;
function entregadorDaSessao(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)acai_entregador=([^;]+)/);
  if (!m) return null;
  const e = db.prepare('SELECT * FROM entregadores WHERE token_acesso = ? AND ativo = 1').get(_shaEnt(m[1]));
  if (!e) return null;
  if (e.ultimo_acesso && (Date.now() - new Date(e.ultimo_acesso).getTime()) > SESSAO_ENTREGADOR_DIAS * 86400e3) return null; // expira por inatividade
  return e;
}
function exigirEntregador(req, res) {
  const e = entregadorDaSessao(req);
  if (!e) { res.status(401).json({ erro: 'Sessão do entregador expirada — entre de novo.' }); return null; }
  return e;
}
// LOGIN: telefone + PIN → cria a sessão (token no cookie HttpOnly)
app.post('/api/entregador/login', (req, res) => {
  const d = req.body || {};
  const norm = normalizarTelefone(d.telefone || '');
  if (!norm || !d.pin) return res.status(400).json({ erro: 'Informe telefone e PIN.' });
  const e = db.prepare('SELECT * FROM entregadores WHERE ativo = 1 AND pin_hash IS NOT NULL').all()
    .filter(x => normalizarTelefone(x.telefone) === norm)
    .find(x => auth.verificarSenha(String(d.pin), x.pin_hash));
  if (!e) {
    manut.logAcao('acesso entregador negado', 'expedicao', { telefone: '***' + String(d.telefone || '').slice(-4) }, 'seguranca');
    return res.status(401).json({ erro: 'Telefone ou PIN incorretos (ou entregador inativo/sem acesso).' });
  }
  const token = require('crypto').randomBytes(24).toString('hex');
  db.prepare('UPDATE entregadores SET token_acesso = ?, ultimo_acesso = ? WHERE id = ?').run(_shaEnt(token), new Date().toISOString(), e.id);
  res.setHeader('Set-Cookie', `acai_entregador=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSAO_ENTREGADOR_DIAS * 86400}`);
  manut.logAcao('entregador acessou', 'expedicao', { id: e.id, nome: e.nome }, 'seguranca');
  res.json({ id: e.id, nome: e.nome, loja: getConfig('loja_nome', 'Açaí do Centro') });
});
// nome da loja pra tela de login do entregador (público, não-sensível)
app.get('/api/entregador/loja', (req, res) => res.json({ loja: getConfig('loja_nome', 'Açaí do Centro') }));
app.get('/api/entregador/me', (req, res) => {
  const e = exigirEntregador(req, res); if (!e) return;
  db.prepare('UPDATE entregadores SET ultimo_acesso = ? WHERE id = ?').run(new Date().toISOString(), e.id);
  res.json({ id: e.id, nome: e.nome, loja: getConfig('loja_nome', 'Açaí do Centro') });
});
app.post('/api/entregador/logout', (req, res) => {
  const e = entregadorDaSessao(req);
  if (e) db.prepare('UPDATE entregadores SET token_acesso = NULL WHERE id = ?').run(e.id);
  res.setHeader('Set-Cookie', 'acai_entregador=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});
// Pedidos EM ROTA do entregador logado + resumo do dia (só os DELE)
app.get('/api/entregador/pedidos', (req, res) => {
  const e = exigirEntregador(req, res); if (!e) return;
  const emRota = db.prepare("SELECT id,numero,cliente,telefone,bairro,endereco,complemento,itens,valor,taxa,total,pagamento,troco,status,criado,saiu_para_entrega_em,previsao_entrega_em,rota_obs FROM pedidos WHERE entregador_id = ? AND status = 'rota' ORDER BY saiu_para_entrega_em").all(e.id)
    .map(p => ({ ...p, min_em_rota: p.saiu_para_entrega_em ? Math.round((Date.now() - new Date(p.saiu_para_entrega_em).getTime()) / 60000) : null }));
  const hoje = db.prepare("SELECT COUNT(*) n, COALESCE(AVG(tempo_entrega_min),0) tmedio FROM pedidos WHERE entregador_id = ? AND status = 'entregue' AND date(entregue_em,'localtime') = date('now','localtime')").get(e.id);
  res.json({ entregador: e.nome, emRota, resumo: { emRota: emRota.length, entreguesHoje: hoje.n, tempoMedio: Math.round(hoje.tmedio) } });
});
// Marcar ENTREGUE — só o próprio pedido, só em rota (reusa a lógica da Fase 22)
app.post('/api/entregador/pedidos/:id/entregue', (req, res) => {
  const e = exigirEntregador(req, res); if (!e) return;
  const id = +req.params.id;
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (p.entregador_id !== e.id) { manut.logAcao('entrega negada (pedido de outro)', 'expedicao', { id, entregador: e.nome }, 'seguranca'); return res.status(403).json({ erro: 'Este pedido não é seu.' }); }
  if (p.status === 'entregue') return res.json({ ok: true, id, tempo_entrega_min: p.tempo_entrega_min }); // idempotente
  const tempo = p.saiu_para_entrega_em ? Math.max(0, Math.round((Date.now() - new Date(p.saiu_para_entrega_em).getTime()) / 60000)) : null;
  db.prepare("UPDATE pedidos SET status = 'entregue', entregue_em = ?, tempo_entrega_min = ? WHERE id = ?").run(new Date().toISOString(), tempo, id);
  db.prepare('UPDATE entregadores SET ultimo_acesso = ? WHERE id = ?').run(new Date().toISOString(), e.id);
  manut.logAcao('pedido entregue', 'expedicao', { pedido: p.numero, id, entregador: e.nome, tempo_min: tempo, via: 'app_entregador' }, 'operacao');
  realtime.emitir('pedido_status_alterado', { id, status: 'entregue', telefone: p.telefone });
  syncFin(sincronizarFinanceiroPedido, id); // Fase 25: entrega pelo app confirma a entrada de delivery
  res.json({ ok: true, id, tempo_entrega_min: tempo });
});
// Página mobile do entregador (rota amigável)
app.get('/entregador', (req, res) => res.sendFile(path.join(__dirname, 'public', 'entregador.html')));
// Manifest do PWA — nome baseado na config da loja (Fase 23)
app.get('/manifest.webmanifest', (req, res) => {
  const loja = getConfig('loja_nome', 'Açaí do Centro');
  res.type('application/manifest+json').send(JSON.stringify({
    name: 'Entregador — ' + loja, short_name: 'Entregador',
    description: 'Painel do entregador: pedidos em rota e confirmação de entrega.',
    start_url: '/entregador', scope: '/entregador', display: 'standalone', orientation: 'portrait',
    background_color: '#1a0526', theme_color: '#2a0a3a', lang: 'pt-BR',
    icons: [{ src: '/icone-entregador.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
  }));
});

// ── Cópia dos pedidos: cadastro dos números que recebem uma cópia de cada pedido novo ──
app.get('/api/copia-pedido/destinatarios', (req, res) => res.json(db.prepare('SELECT * FROM destinatarios_copia ORDER BY id').all()));
app.post('/api/copia-pedido/destinatarios', (req, res) => {
  const nome = (req.body.nome || '').trim();
  const telefone = (req.body.telefone || '').replace(/\D/g, '');
  if (telefone.length < 10) return res.status(400).json({ erro: 'Telefone inválido — use DDD + número.' });
  const r = db.prepare('INSERT INTO destinatarios_copia (nome, telefone, ativo) VALUES (?,?,1)').run(nome, telefone);
  res.json(db.prepare('SELECT * FROM destinatarios_copia WHERE id = ?').get(r.lastInsertRowid));
});
app.put('/api/copia-pedido/destinatarios/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM destinatarios_copia WHERE id = ?').get(+req.params.id);
  if (!row) return res.status(404).json({ erro: 'Destinatário não encontrado.' });
  const ativo = req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : row.ativo;
  const nome = req.body.nome !== undefined ? req.body.nome : row.nome;
  const telefone = req.body.telefone !== undefined ? String(req.body.telefone).replace(/\D/g, '') : row.telefone;
  db.prepare('UPDATE destinatarios_copia SET nome=?, telefone=?, ativo=? WHERE id=?').run(nome, telefone, ativo, +req.params.id);
  res.json(db.prepare('SELECT * FROM destinatarios_copia WHERE id = ?').get(+req.params.id));
});
app.delete('/api/copia-pedido/destinatarios/:id', (req, res) => {
  db.prepare('DELETE FROM destinatarios_copia WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
});

// monta o texto do pedido pra mandar no WhatsApp
function formatarPedidoTexto(p) {
  const brl = v => 'R$ ' + (+v || 0).toFixed(2).replace('.', ',');
  return [
    `🌴 *PEDIDO #${p.numero}* (${p.origem === 'ia' ? 'IA/WhatsApp' : 'balcão'})`,
    `👤 ${p.cliente || '—'}${p.telefone ? ' · ' + p.telefone : ''}`,
    (p.endereco && p.endereco !== 'RETIRADA NO BALCÃO') ? `📍 ${p.endereco}${p.complemento ? ' — ' + p.complemento : ''}` : '🏪 Retirada no balcão',
    `🍧 ${p.itens || '—'}`,
    `💰 Total: ${brl(p.total)}`,
    `💳 ${p.pagamento || '—'}${+p.troco ? ' · troco pra ' + brl(p.troco) : ''}`,
  ].join('\n');
}
// envia a cópia do pedido pros destinatários LIGADOS (usa o WhatsApp que estiver conectado)
async function enviarCopiaPedido(pedido) {
  const dests = db.prepare('SELECT * FROM destinatarios_copia WHERE ativo = 1').all();
  if (!dests.length) return;
  const texto = formatarPedidoTexto(pedido);
  for (const d of dests) {
    const envio = await enviarMensagemWhatsapp(d.telefone, texto);
    console.log(envio.ok
      ? `📋 Cópia do pedido #${pedido.numero} enviada pra ${d.nome || d.telefone}.`
      : `⚠️ Não deu pra enviar cópia do #${pedido.numero} pra ${d.telefone}: ${envio.erro}`);
  }
}

// ── Avisos automáticos: textos que a IA passa pro cliente quando ligados ──
app.get('/api/avisos', (req, res) => res.json(db.prepare('SELECT * FROM avisos ORDER BY id').all()));
app.put('/api/avisos/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM avisos WHERE id = ?').get(+req.params.id);
  if (!row) return res.status(404).json({ erro: 'Aviso não encontrado.' });
  const texto = req.body.texto !== undefined ? String(req.body.texto).slice(0, 300) : row.texto;
  const ativo = req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : row.ativo;
  db.prepare('UPDATE avisos SET texto = ?, ativo = ? WHERE id = ?').run(texto, ativo, +req.params.id);
  res.json(db.prepare('SELECT * FROM avisos WHERE id = ?').get(+req.params.id));
});
// (avisosAtivos foi pra backend/ia/prompt.js — só o prompt da IA usa os avisos ligados.)

/* ══════════════════════════════════════════════════════════════════════════
   PRODUTOS + ESTOQUE (Fase 9) — a tabela `produtos` virou a FONTE PRINCIPAL.
   O frontend continua mandando o catálogo inteiro em /api/produtos/sync (agora
   um UPSERT não-destrutivo, não apaga mais tudo), e há CRUD + movimentos de
   estoque + disponibilidade + importação. A IA lê `produtos WHERE disponivel=1`.
   ══════════════════════════════════════════════════════════════════════════ */
// UPSERT de um produto (por codigo). Preserva o que já existe e atualiza os campos.
const _upsertProduto = db.prepare(`INSERT INTO produtos
  (codigo,nome,precoVenda,precoCompra,estoque,estoqueMin,departamento,fornecedor,conjunto,vendacaixa,unidCaixa,disponivel,atualizado_em)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(codigo) DO UPDATE SET nome=excluded.nome,precoVenda=excluded.precoVenda,precoCompra=excluded.precoCompra,
    estoque=excluded.estoque,estoqueMin=excluded.estoqueMin,departamento=excluded.departamento,fornecedor=excluded.fornecedor,
    conjunto=excluded.conjunto,vendacaixa=excluded.vendacaixa,unidCaixa=excluded.unidCaixa,disponivel=excluded.disponivel,atualizado_em=excluded.atualizado_em`);
function upsertProduto(p, agora) {
  // o frontend usa precoVendaCaixa/unidPorCaixa; guardamos nas colunas vendacaixa/unidCaixa
  const vendacaixa = p.vendacaixa != null ? p.vendacaixa : p.precoVendaCaixa;
  const unidCaixa = p.unidCaixa != null ? p.unidCaixa : p.unidPorCaixa;
  _upsertProduto.run(p.codigo || '', p.nome || '', +p.precoVenda || 0, +p.precoCompra || 0, +p.estoque || 0, +p.estoqueMin || 0,
    p.departamento || '', p.fornecedor || '', p.conjunto || '', +vendacaixa || 0, +unidCaixa || 0,
    p.disponivel === false || p.disponivel === 0 ? 0 : 1, agora || new Date().toISOString());
  // descrição do conjunto (caixa) — round-trip via SELECT *; só grava quando vem preenchida
  if (p.descricao_conjunto != null) { try { db.prepare('UPDATE produtos SET descricao_conjunto=? WHERE codigo=?').run(String(p.descricao_conjunto), p.codigo || ''); } catch {} }
  // granel (a granel = leva saco + sacola na venda; demais só sacola)
  if (p.granel != null) { try { db.prepare('UPDATE produtos SET granel=? WHERE codigo=?').run(p.granel ? 1 : 0, p.codigo || ''); } catch {} }
  // Cadastro inteligente (Fase 43.6): se vier tipo/unidade, persiste; controla_fechamento é DEDUZIDO
  // do tipo → todo produto classificado entra sozinho na conferência do fechamento (salvo se explícito).
  // Caminho quente (/sync) não manda esses campos, então não é afetado.
  if (p.tipo != null || p.unidade != null || p.controla_fechamento != null) {
    const tipo = p.tipo != null ? String(p.tipo) : undefined;
    const cf = p.controla_fechamento != null ? (p.controla_fechamento ? 1 : 0)
      : (tipo !== undefined ? (['', 'servico', 'nao_controlado'].includes(tipo) ? 0 : 1) : undefined);
    const sets = [], args = [];
    if (tipo !== undefined) { sets.push('tipo=?'); args.push(tipo); }
    if (p.unidade != null) { sets.push('unidade=?'); args.push(String(p.unidade)); }
    if (cf !== undefined) { sets.push('controla_fechamento=?'); args.push(cf); }
    if (sets.length) { args.push(p.codigo || ''); try { db.prepare(`UPDATE produtos SET ${sets.join(',')} WHERE codigo=?`).run(...args); } catch {} }
  }
}
// Registra um movimento de estoque + ajusta o estoque do produto (auditoria). Idempotente por natureza
// só se o chamador passar estoque_novo (o frontend passa o valor final que ele já calculou).
function registrarMovimento(codigo, tipo, d) {
  const p = db.prepare('SELECT estoque FROM produtos WHERE codigo = ?').get(codigo);
  if (!p) return null;
  const atual = +p.estoque || 0;
  const anterior = (d.estoque_anterior != null) ? +d.estoque_anterior : atual;
  const qtd = +d.quantidade || 0;
  let novo;
  if (d.estoque_novo != null) novo = +d.estoque_novo;
  else if (tipo === 'ajuste') novo = qtd;
  // vender sem estoque deixa NEGATIVO (a falta fica visível); a entrada SOMA e normaliza (−3 + 10 = 7).
  else if (tipo === 'entrada' || tipo === 'cancelamento') novo = Math.round((atual + qtd) * 100) / 100;
  else novo = Math.round((atual - qtd) * 100) / 100; // saida (venda) — pode ficar negativo
  const agora = new Date().toISOString();
  db.prepare('UPDATE produtos SET estoque = ?, atualizado_em = ? WHERE codigo = ?').run(novo, agora, codigo);
  db.prepare('INSERT INTO estoque_movimentos (produto_codigo,tipo,quantidade,estoque_anterior,estoque_novo,motivo,referencia,criado_em) VALUES (?,?,?,?,?,?,?,?)')
    .run(codigo, tipo, qtd, anterior, novo, d.motivo || '', d.referencia || '', agora);
  return { codigo, tipo, quantidade: qtd, estoque_anterior: anterior, estoque_novo: novo };
}

app.get('/api/produtos', (req, res) => {
  const q = (req.query.q || '').trim();
  res.json(q
    ? db.prepare('SELECT * FROM produtos WHERE codigo LIKE ? OR nome LIKE ? ORDER BY nome').all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM produtos ORDER BY nome').all());
});
app.get('/api/produtos/:codigo', (req, res) => {
  const p = db.prepare('SELECT * FROM produtos WHERE codigo = ?').get(req.params.codigo);
  p ? res.json(p) : res.status(404).json({ erro: 'Produto não encontrado.' });
});
// UPSERT do catálogo inteiro (mantém o nome /sync usado pelo frontend; agora NÃO apaga tudo)
app.post('/api/produtos/sync', (req, res) => {
  const lista = Array.isArray(req.body) ? req.body : [];
  const agora = new Date().toISOString();
  for (const p of lista) if (p && p.codigo) upsertProduto(p, agora);
  res.json({ ok: true, total: lista.length });
});
app.post('/api/produtos', (req, res) => {
  const d = req.body || {};
  if (!d.codigo || !d.nome) return res.status(400).json({ erro: 'codigo e nome são obrigatórios.' });
  upsertProduto(d);
  res.json(db.prepare('SELECT * FROM produtos WHERE codigo = ?').get(d.codigo));
});
app.put('/api/produtos/:codigo', (req, res) => {
  const cod = req.params.codigo;
  if (!db.prepare('SELECT codigo FROM produtos WHERE codigo = ?').get(cod)) return res.status(404).json({ erro: 'Produto não encontrado.' });
  upsertProduto({ ...req.body, codigo: cod });
  res.json(db.prepare('SELECT * FROM produtos WHERE codigo = ?').get(cod));
});
app.delete('/api/produtos/:codigo', (req, res) => {
  db.prepare('DELETE FROM produtos WHERE codigo = ?').run(req.params.codigo);
  manut.logAcao('exclusão de produto', 'produtos', { codigo: req.params.codigo }, 'admin');
  res.json({ ok: true });
});
// Movimentos de estoque
for (const tipo of ['entrada', 'saida', 'ajuste', 'cancelamento']) {
  app.post(`/api/produtos/:codigo/${tipo}`, (req, res) => {
    const r = registrarMovimento(req.params.codigo, tipo, req.body || {});
    if (r && tipo === 'ajuste') manut.logAcao('alteração manual de estoque', 'estoque', { codigo: req.params.codigo, estoque_novo: r.estoque_novo }, 'admin');
    r ? res.json(r) : res.status(404).json({ erro: 'Produto não encontrado.' });
  });
}
app.get('/api/produtos/:codigo/movimentos', (req, res) =>
  res.json(db.prepare('SELECT * FROM estoque_movimentos WHERE produto_codigo = ? ORDER BY id DESC LIMIT 300').all(req.params.codigo)));
app.put('/api/produtos/:codigo/disponibilidade', (req, res) => {
  const disp = (req.body && (req.body.disponivel === false || req.body.disponivel === 0)) ? 0 : 1;
  const info = db.prepare('UPDATE produtos SET disponivel = ?, atualizado_em = ? WHERE codigo = ?').run(disp, new Date().toISOString(), req.params.codigo);
  info.changes ? res.json({ ok: true, disponivel: disp }) : res.status(404).json({ erro: 'Produto não encontrado.' });
});
// Importação inicial do localStorage — idempotente por codigo. Produto NOVO entra com estoque;
// produto que JÁ existe tem só o cadastro atualizado (o estoque do servidor é PRESERVADO).
app.post('/api/produtos/importar-localstorage', (req, res) => {
  const lista = Array.isArray(req.body && req.body.produtos) ? req.body.produtos : (Array.isArray(req.body) ? req.body : []);
  let importados = 0, atualizados = 0, ignorados = 0;
  const agora = new Date().toISOString();
  for (const p of lista) {
    if (!p || !p.codigo) { ignorados++; continue; }
    const existe = db.prepare('SELECT estoque FROM produtos WHERE codigo = ?').get(p.codigo);
    if (existe) {
      // atualiza o cadastro mas PRESERVA o estoque atual do servidor (não bagunça)
      upsertProduto({ ...p, estoque: existe.estoque }, agora);
      atualizados++;
    } else {
      upsertProduto(p, agora);
      importados++;
    }
  }
  const rel = { importados, atualizados, ignorados };
  console.log('📥 Importação de produtos:', rel);
  res.json(rel);
});

/* ══════════════════════════════════════════════════════════════════════════
   VENDAS + FINANCEIRO (Fase 10) — vendas/itens/pagamentos + compras + insumos.
   A venda aqui é RECORD-ONLY: o estoque (Fase 9) e o fiado (Fase 8) já são
   tratados pelos fluxos do frontend — este endpoint NÃO repete baixa nem
   lançamento (evita contar em dobro). Cancelamento só marca o status.
   ══════════════════════════════════════════════════════════════════════════ */
db.exec(`CREATE TABLE IF NOT EXISTS vendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, data TEXT, total REAL, subtotal REAL, desconto REAL,
  troco REAL, status TEXT, origem TEXT, cliente_id INTEGER, operador TEXT,
  cancelada_em TEXT, motivo_cancelamento TEXT, criado_em TEXT
)`);
// Quem pegou na conta (fiado) — nome do autorizado/titular que retirou. Aparece no espelho.
try { db.exec(`ALTER TABLE vendas ADD COLUMN retirado_por TEXT`); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS vendas_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER NOT NULL, produto_codigo TEXT, codigo TEXT,
  nome TEXT, qtd REAL, preco REAL, subtotal REAL, pacote INTEGER, unidConsumo REAL, criado_em TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER NOT NULL, forma TEXT, valor REAL,
  cliente_id INTEGER, detalhes TEXT, criado_em TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, numNota TEXT, fornecedor TEXT, descricao TEXT,
  total REAL, origem TEXT, detalhes TEXT, criado_em TEXT
)`);
try { db.exec('ALTER TABLE compras ADD COLUMN forma_pagamento TEXT'); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS insumos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, qtd REAL, custo_total REAL, custo_unitario REAL, criado_em TEXT
)`);
// ── COMPRA DE AÇAÍ (latas) — controle próprio: compra a prazo e paga em outra data ──
db.exec(`CREATE TABLE IF NOT EXISTS compras_acai (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fornecedor TEXT, data_compra TEXT, quantidade REAL, preco_unitario REAL, total REAL,
  pago INTEGER DEFAULT 0, data_pagamento TEXT, forma_pagamento TEXT, obs TEXT, criado_em TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS receitas_rendimento (
  id INTEGER PRIMARY KEY AUTOINCREMENT, materia TEXT, composicao TEXT, atualizado_em TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_vendas_itens ON vendas_itens(venda_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_pagamentos ON pagamentos(venda_id)');

/* ══ RETAGUARDA (Fase 19) — compras com itens, insumos maduros, produção/rendimento ══
   Tudo ADITIVO: as tabelas antigas (compras/insumos) continuam; ganham detalhamento e
   histórico ao lado. Ver 32_RETAGUARDA_CUSTO_FASE19.md. */
// Itens de uma compra (detalhe por produto/insumo/outro)
db.exec(`CREATE TABLE IF NOT EXISTS compras_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compra_id INTEGER NOT NULL,
  tipo_item TEXT,            -- 'produto' | 'insumo' | 'outro'
  referencia_id TEXT,        -- código do produto ou id do insumo, se aplicável
  descricao TEXT,
  quantidade REAL, unidade TEXT,
  custo_unitario REAL, subtotal REAL,
  criado_em TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_compras_itens ON compras_itens(compra_id)');
// Insumos: amplia pra ter unidade, saldo e observações (mantém qtd/custo_total/custo_unitario)
for (const col of ['unidade TEXT', 'saldo REAL', 'obs TEXT', 'atualizado_em TEXT']) {
  try { db.exec(`ALTER TABLE insumos ADD COLUMN ${col}`); } catch {}
}
// Movimentação de insumos (histórico mínimo: entrada/consumo/ajuste)
db.exec(`CREATE TABLE IF NOT EXISTS insumos_movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insumo_id INTEGER NOT NULL,
  tipo TEXT,                 -- 'entrada' | 'consumo' | 'ajuste'
  quantidade REAL, custo_unitario REAL,
  saldo_anterior REAL, saldo_novo REAL,
  origem TEXT,               -- 'compra' | 'producao' | 'ajuste_manual'
  referencia_id TEXT, data TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_insumos_mov ON insumos_movimentos(insumo_id)');
// Produção / rendimento: cabeçalho + itens consumidos (entrada) + itens gerados (saída)
db.exec(`CREATE TABLE IF NOT EXISTS producoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT, tipo TEXT,      -- 'rendimento' | 'producao'
  descricao TEXT, origem TEXT,
  custo_total REAL, obs TEXT, criado_em TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS producoes_itens_entrada (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producao_id INTEGER NOT NULL,
  tipo_item TEXT,            -- 'produto' | 'insumo' | 'materia' | 'outro'
  referencia_id TEXT, descricao TEXT,
  quantidade REAL, unidade TEXT,
  custo_unitario REAL, subtotal REAL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS producoes_itens_saida (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producao_id INTEGER NOT NULL,
  produto_codigo TEXT, descricao TEXT,
  quantidade REAL, unidade TEXT,
  custo_unitario_resultante REAL, subtotal_resultante REAL
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_prod_entrada ON producoes_itens_entrada(producao_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_prod_saida ON producoes_itens_saida(producao_id)');

/* ══ FICHA TÉCNICA / RECEITA (Fase 21) ══════════════════════════════════════
   Cabeçalho por produto (1 ficha por código) + itens (insumos/produtos que o
   produto consome). Dá base pra baixa automática na venda e pro custo real.
   Ver 34_FICHA_TECNICA_CUSTO_REAL_FASE21.md. */
db.exec(`CREATE TABLE IF NOT EXISTS produtos_ficha (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_codigo TEXT NOT NULL UNIQUE,
  nome TEXT, ativo INTEGER DEFAULT 1,
  criado_em TEXT, atualizado_em TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS produtos_ficha_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ficha_id INTEGER NOT NULL,
  tipo_item TEXT,            -- 'insumo' | 'produto'
  referencia_id TEXT,        -- id do insumo ou código do produto
  descricao TEXT,
  quantidade REAL, unidade TEXT,
  obrigatorio INTEGER DEFAULT 1, obs TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_ficha_produto ON produtos_ficha(produto_codigo)');
db.exec('CREATE INDEX IF NOT EXISTS idx_ficha_itens ON produtos_ficha_itens(ficha_id)');

// intervalo de datas → cláusula segura (ISO). Vazio = tudo.
function faixaData(de, ate) {
  const cond = [], args = [];
  if (de) { cond.push('data >= ?'); args.push(de); }
  if (ate) { cond.push('data <= ?'); args.push(ate); }
  return { where: cond.length ? ' AND ' + cond.join(' AND ') : '', args };
}
function vendaCompleta(id) {
  const v = db.prepare('SELECT * FROM vendas WHERE id = ?').get(id);
  if (!v) return null;
  v.itens = db.prepare('SELECT * FROM vendas_itens WHERE venda_id = ? ORDER BY id').all(id);
  v.pagamentos = db.prepare('SELECT * FROM pagamentos WHERE venda_id = ? ORDER BY id').all(id);
  return v;
}

// ── Idempotência (Fase 14) ──────────────────────────────────────────────────
// A fila offline do frontend reenvia operações críticas com um client_request_id.
// Aqui guardamos o resultado de cada id já processado e, se ele chegar de novo,
// devolvemos o MESMO resultado em vez de duplicar (venda/lançamento/cliente).
db.exec(`CREATE TABLE IF NOT EXISTS idempotencia (
  client_request_id TEXT PRIMARY KEY, tipo TEXT, resultado TEXT, criado_em TEXT
)`);
function idempotente(clientRequestId, tipo, fn) {
  if (clientRequestId) {
    const j = db.prepare('SELECT resultado FROM idempotencia WHERE client_request_id = ?').get(clientRequestId);
    if (j) return JSON.parse(j.resultado); // já processado: mesmo resultado, sem duplicar
  }
  const resultado = fn();
  if (clientRequestId) {
    try {
      db.prepare('INSERT INTO idempotencia (client_request_id, tipo, resultado, criado_em) VALUES (?,?,?,?)')
        .run(clientRequestId, tipo, JSON.stringify(resultado), new Date().toISOString());
    } catch {}
  }
  return resultado;
}

// ── Vendas ──
app.get('/api/vendas', (req, res) => {
  const { status, origem, de, ate } = req.query;
  const cond = [], args = [];
  if (status) { cond.push('status = ?'); args.push(status); }
  if (origem) { cond.push('origem = ?'); args.push(origem); }
  if (de) { cond.push('data >= ?'); args.push(de); }
  if (ate) { cond.push('data <= ?'); args.push(ate); }
  const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';
  res.json(db.prepare(`SELECT * FROM vendas${where} ORDER BY id DESC LIMIT 1000`).all(...args));
});
app.get('/api/vendas/:id', (req, res) => {
  const v = vendaCompleta(+req.params.id);
  v ? res.json(v) : res.status(404).json({ erro: 'Venda não encontrada.' });
});
app.post('/api/vendas', (req, res) => {
  const d = req.body || {};
  try {
    const resultado = idempotente(d.client_request_id, 'venda', () => {
      const agora = new Date().toISOString();
      db.exec('BEGIN');
      try {
        const info = db.prepare(`INSERT INTO vendas (numero,data,total,subtotal,desconto,troco,status,origem,cliente_id,operador,retirado_por,criado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.numero || '', d.data || agora, +d.total || 0, +d.subtotal || +d.total || 0,
          +d.desconto || 0, +d.troco || 0, d.status || 'concluida', d.origem || 'pdv', d.cliente_id || null, d.operador || '', d.retirado_por || null, agora);
        const id = info.lastInsertRowid;
        if (!d.numero) db.prepare('UPDATE vendas SET numero = ? WHERE id = ?').run(String(id), id);
        const insItem = db.prepare('INSERT INTO vendas_itens (venda_id,produto_codigo,codigo,nome,qtd,preco,subtotal,pacote,unidConsumo,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)');
        for (const it of (d.itens || [])) {
          const cod = it.codigo || it.cod || '';
          insItem.run(id, cod, cod, it.nome || it.desc || '', +it.qtd || 0, +it.preco || 0, +it.subtotal || (+it.qtd * +it.preco) || 0, it.pacote ? 1 : 0, +it.unidConsumo || 1, agora);
        }
        const insPag = db.prepare('INSERT INTO pagamentos (venda_id,forma,valor,cliente_id,detalhes,criado_em) VALUES (?,?,?,?,?,?)');
        for (const p of (d.pagamentos || [])) {
          let det = p.detalhes ? JSON.stringify(p.detalhes) : null;
          if (!det && p.forma === 'Fiado' && d.fiado_lancamento_id) det = JSON.stringify({ lancamento_id: d.fiado_lancamento_id });
          insPag.run(id, p.forma || '', +p.valor || 0, p.cliente_id || null, det, agora);
        }
        // Fase 21: baixa automática dos insumos da ficha técnica (dentro da MESMA transação e do
        // envelope idempotente → não baixa duas vezes se a fila offline reenviar a venda).
        const baixa = baixarInsumosDaVenda(d.itens, id);
        // Fase 43.5: fecha o ciclo — baixa o estoque do PRODUTO vendido (só produtos sem ficha).
        if ((d.status || 'concluida') === 'concluida') movimentarEstoqueVenda(d.itens, id, false);
        // embalagem automática: 1 sacola por unidade (todos) + 1 saco nos produtos a granel
        if ((d.status || 'concluida') === 'concluida') { try { consumirEmbalagemVenda(d.itens, id); } catch {} }
        // Fase 24: cashback de fidelidade na venda ELEGÍVEL (concluída + com cliente vinculado).
        // Dentro da mesma transação idempotente → não credita duas vezes no reenvio da fila.
        let cashback = 0;
        const cfg = crmConfig();
        const totalVenda = +d.total || 0;
        if (cfg.fidelidadeModo === 'cashback' && d.cliente_id && (d.status || 'concluida') === 'concluida' && cfg.fidelidadePercentual > 0 && totalVenda > 0) {
          cashback = Math.round(totalVenda * cfg.fidelidadePercentual) / 100;
          if (cashback > 0) movimentarFidelidade(d.cliente_id, 'credito', cashback, 'venda', 'venda#' + id, `cashback ${cfg.fidelidadePercentual}%`, '');
        }
        db.exec('COMMIT');
        // Fase 25: espelha a venda no financeiro (idempotente por referência; try/catch não quebra a venda)
        syncFin(sincronizarFinanceiroVenda, id);
        // Fase 28: enfileira o cupom da venda pra impressão (estrutura pronta; não trava a venda)
        if ((d.status || 'concluida') === 'concluida' && typeof enfileirarImpressao === 'function') {
          enfileirarImpressao('venda', id, `Venda #${d.numero || id}`, { numero: d.numero || String(id), total: +d.total || 0, itens: (d.itens || []).length });
          // Fase 40: canhoto/comprovante automático (só se ligado na config) — estação balcão
          if (getConfig('impressao_canhoto_auto', '0') === '1') { try { enfileirarImpressao('venda', id, `Canhoto #${d.numero || id}`, canhotoDoc('venda', id), { via: 'canhoto', estacao: 'balcao' }); } catch {} }
        }
        // Fase 30: consome os LOTES em FIFO pra apurar o custo REAL de cada item (camada de custeio à parte; try/catch não quebra a venda)
        if ((d.status || 'concluida') === 'concluida' && typeof consumirLotesDaVenda === 'function') { try { consumirLotesDaVenda(id); } catch (e) { try { manut.logErro('custo-real-venda', e); } catch {} } }
        return { id, numero: d.numero || String(id), insumosBaixados: baixa.baixados, avisosInsumo: baixa.avisos, cashbackCreditado: cashback };
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    });
    res.json(resultado);
  } catch (e) {
    console.log('❌ Erro ao registrar venda:', e.message);
    res.status(500).json({ erro: 'Falha ao registrar a venda.' });
  }
});
app.post('/api/vendas/:id/cancelar', (req, res) => {
  const id = +req.params.id;
  const v = db.prepare('SELECT id, status FROM vendas WHERE id = ?').get(id);
  if (!v) return res.status(404).json({ erro: 'Venda não encontrada.' });
  db.prepare('UPDATE vendas SET status = ?, cancelada_em = ?, motivo_cancelamento = ? WHERE id = ?')
    .run('cancelada', new Date().toISOString(), (req.body && req.body.motivo) || 'cancelamento no PDV', id);
  manut.logAcao('cancelamento de venda', 'vendas', { id, motivo: (req.body && req.body.motivo) || '' }, 'pdv');
  syncFin(sincronizarFinanceiroVenda, id); // Fase 25: estorna o movimento financeiro da venda cancelada
  if (typeof estornarLotesDaVenda === 'function') { try { estornarLotesDaVenda(id); } catch {} } // Fase 30: devolve o consumo de lote
  // Fase 43.5: devolve o estoque baixado (só se a venda estava concluída — foi ela que baixou)
  if (v.status === 'concluida') { try { movimentarEstoqueVenda(db.prepare('SELECT produto_codigo, qtd FROM vendas_itens WHERE venda_id=?').all(id), id, true); } catch {} }
  res.json({ ok: true });
});

// ── Relatórios / Financeiro ── (só vendas concluídas contam no faturamento)
app.get('/api/financeiro/resumo', (req, res) => {
  const f = faixaData(req.query.de, req.query.ate);
  const fat = db.prepare(`SELECT COALESCE(SUM(total),0) tot, COUNT(*) n FROM vendas WHERE status='concluida'${f.where}`).get(...f.args);
  const gCompras = db.prepare(`SELECT COALESCE(SUM(total),0) tot FROM compras WHERE 1=1${f.where}`).get(...f.args).tot;
  const gInsumos = db.prepare('SELECT COALESCE(SUM(custo_total),0) tot FROM insumos').get().tot;
  const gastos = gCompras + gInsumos;
  res.json({ faturamento: fat.tot, qtdVendas: fat.n, gastos, gastoCompras: gCompras, gastoInsumos: gInsumos, saldo: fat.tot - gastos });
});
app.get('/api/financeiro/vendas-produtos', (req, res) => {
  const f = faixaData(req.query.de, req.query.ate);
  res.json(db.prepare(`SELECT i.codigo, i.nome, SUM(i.qtd) qtd, SUM(i.subtotal) total
    FROM vendas_itens i JOIN vendas v ON v.id = i.venda_id WHERE v.status='concluida'${f.where.replace(/data/g, 'v.data')}
    GROUP BY i.codigo, i.nome ORDER BY total DESC`).all(...f.args));
});
app.get('/api/financeiro/formas-pagamento', (req, res) => {
  const f = faixaData(req.query.de, req.query.ate);
  res.json(db.prepare(`SELECT p.forma, SUM(p.valor) total, COUNT(*) n
    FROM pagamentos p JOIN vendas v ON v.id = p.venda_id WHERE v.status='concluida'${f.where.replace(/data/g, 'v.data')}
    GROUP BY p.forma ORDER BY total DESC`).all(...f.args));
});

/* ── Histórico / relatórios (Fase 14) — a aba Histórico lê daqui (backend = fonte
   principal). Aceita ?de=&ate= (ISO). Só vendas 'concluida' contam no faturamento. */
app.get('/api/historico/resumo', (req, res) => {
  const f = faixaData(req.query.de, req.query.ate);
  const fv = f.where.replace(/data/g, 'v.data');
  const v = db.prepare(`SELECT COALESCE(SUM(total),0) fat, COUNT(*) n FROM vendas WHERE status='concluida'${f.where}`).get(...f.args);
  const itens = db.prepare(`SELECT COALESCE(SUM(i.qtd),0) q FROM vendas_itens i JOIN vendas v ON v.id=i.venda_id WHERE v.status='concluida'${fv}`).get(...f.args).q;
  const gCompras = db.prepare(`SELECT COALESCE(SUM(total),0) t FROM compras WHERE 1=1${f.where}`).get(...f.args).t;
  const gInsumos = db.prepare('SELECT COALESCE(SUM(custo_total),0) t FROM insumos').get().t;
  const canc = db.prepare(`SELECT COUNT(*) n FROM vendas WHERE status='cancelada'${f.where}`).get(...f.args).n;
  const pico = db.prepare(`SELECT strftime('%H', v.data, 'localtime') h, SUM(i.qtd) q FROM vendas_itens i JOIN vendas v ON v.id=i.venda_id WHERE v.status='concluida'${fv} GROUP BY h ORDER BY q DESC LIMIT 1`).get(...f.args);
  const gastos = gCompras + gInsumos;
  res.json({
    faturamento: v.fat, qtdVendas: v.n, itens, ticketMedio: v.n ? v.fat / v.n : 0,
    gastoCompras: gCompras, gastoInsumos: gInsumos, gastos, saldo: v.fat - gastos,
    cancelamentos: canc, picoHora: pico ? +pico.h : null,
  });
});
app.get('/api/historico/vendas', (req, res) => {
  const f = faixaData(req.query.de, req.query.ate);
  res.json(db.prepare(`SELECT * FROM vendas WHERE 1=1${f.where} ORDER BY id DESC LIMIT 1000`).all(...f.args));
});
app.get('/api/historico/vendas-produtos', (req, res) => {
  const f = faixaData(req.query.de, req.query.ate);
  res.json(db.prepare(`SELECT i.codigo, i.nome, SUM(i.qtd) qtd, SUM(i.subtotal) valor, MAX(v.data) ultima
    FROM vendas_itens i JOIN vendas v ON v.id=i.venda_id WHERE v.status='concluida'${f.where.replace(/data/g, 'v.data')}
    GROUP BY i.codigo, i.nome ORDER BY qtd DESC`).all(...f.args));
});
app.get('/api/historico/formas-pagamento', (req, res) => {
  const f = faixaData(req.query.de, req.query.ate);
  res.json(db.prepare(`SELECT p.forma, SUM(p.valor) total, COUNT(*) n
    FROM pagamentos p JOIN vendas v ON v.id=p.venda_id WHERE v.status='concluida'${f.where.replace(/data/g, 'v.data')}
    GROUP BY p.forma ORDER BY total DESC`).all(...f.args));
});
app.get('/api/historico/compras', (req, res) => {
  const f = faixaData(req.query.de, req.query.ate);
  res.json(db.prepare(`SELECT * FROM compras WHERE 1=1${f.where} ORDER BY data DESC LIMIT 1000`).all(...f.args));
});
app.get('/api/historico/insumos', (req, res) => res.json(db.prepare('SELECT * FROM insumos ORDER BY id DESC').all()));
app.get('/api/historico/cancelamentos', (req, res) => {
  const f = faixaData(req.query.de, req.query.ate);
  res.json(db.prepare(`SELECT * FROM vendas WHERE status='cancelada'${f.where} ORDER BY data DESC LIMIT 1000`).all(...f.args));
});

/* ══ DASHBOARD / HOME GERENCIAL (Fase 17) — só leitura, backend = fonte ═══════
   "Hoje" e "semana" em horário LOCAL (o banco guarda ISO em UTC): comparamos
   date(coluna,'localtime') com date('now','localtime'). Só vendas 'concluida'
   contam no faturamento (mesma regra do Histórico). Qualquer usuário logado lê. */
const HOJE_VENDA = "date(v.data,'localtime')=date('now','localtime')";
const HOJE = (col) => `date(${col},'localtime')=date('now','localtime')`;

// BLOCO A — resumo do dia (faturamento, nº de vendas, ticket, itens, pedidos, clientes)
app.get('/api/dashboard/resumo-dia', (req, res) => {
  const v = db.prepare(`SELECT COALESCE(SUM(total),0) fat, COUNT(*) n FROM vendas v WHERE status='concluida' AND ${HOJE_VENDA}`).get();
  const itens = db.prepare(`SELECT COALESCE(SUM(i.qtd),0) q FROM vendas_itens i JOIN vendas v ON v.id=i.venda_id WHERE v.status='concluida' AND ${HOJE_VENDA}`).get().q;
  const pedidosHoje = db.prepare(`SELECT COUNT(*) n FROM pedidos WHERE ${HOJE('criado')}`).get().n;
  const clientesId = db.prepare(`SELECT COUNT(DISTINCT cliente_id) n FROM vendas v WHERE status='concluida' AND cliente_id IS NOT NULL AND ${HOJE_VENDA}`).get().n;
  res.json({ faturamento: v.fat, qtdVendas: v.n, ticketMedio: v.n ? v.fat / v.n : 0, itens, pedidosHoje, clientesIdentificados: clientesId });
});

// BLOCO B — formas de pagamento do dia (soma por forma)
app.get('/api/dashboard/formas-pagamento', (req, res) => {
  res.json(db.prepare(`SELECT p.forma, COALESCE(SUM(p.valor),0) total, COUNT(*) n
    FROM pagamentos p JOIN vendas v ON v.id=p.venda_id
    WHERE v.status='concluida' AND ${HOJE_VENDA}
    GROUP BY p.forma ORDER BY total DESC`).all());
});

// BLOCO C — delivery + atendimento (pedidos por status + conversas)
app.get('/api/dashboard/atendimento', (req, res) => {
  const st = {};
  for (const r of db.prepare('SELECT status, COUNT(*) n FROM pedidos GROUP BY status').all()) st[r.status] = r.n;
  const entreguesHoje = db.prepare(`SELECT COUNT(*) n FROM pedidos WHERE status='entregue' AND ${HOJE('criado')}`).get().n;
  const naoLidas = db.prepare("SELECT COUNT(DISTINCT telefone) n FROM mensagens_wpp WHERE direcao='in' AND lido=0").get().n;
  const humano = db.prepare("SELECT COUNT(*) n FROM atendimento_estado WHERE modo='humano'").get().n;
  const iaOff = db.prepare('SELECT COUNT(*) n FROM atendimento_estado WHERE ia_ativa=0').get().n;
  // Fase 22: tempo médio de entrega de hoje (min) — só dos que têm o tempo calculado
  const tmedio = db.prepare("SELECT COALESCE(AVG(tempo_entrega_min),0) t FROM pedidos WHERE status='entregue' AND tempo_entrega_min IS NOT NULL AND date(entregue_em,'localtime')=date('now','localtime')").get().t;
  res.json({
    pendentes: st.pendente || 0, preparo: (st.preparo || 0) + (st.pronto || 0), rota: st.rota || 0, entreguesHoje,
    conversasNaoLidas: naoLidas, conversasHumano: humano, conversasIaDesligada: iaOff,
    tempoMedioEntrega: Math.round(tmedio),
  });
});

// BLOCO D — estoque / alertas (baixo, zerado, indisponível + top 5 críticos)
app.get('/api/dashboard/estoque-alertas', (req, res) => {
  const baixo = db.prepare('SELECT COUNT(*) n FROM produtos WHERE estoqueMin IS NOT NULL AND estoqueMin>0 AND estoque>0 AND estoque<=estoqueMin').get().n;
  const zerados = db.prepare('SELECT COUNT(*) n FROM produtos WHERE estoque IS NOT NULL AND estoque<=0').get().n;
  const indisponiveis = db.prepare('SELECT COUNT(*) n FROM produtos WHERE disponivel=0').get().n;
  const criticos = db.prepare(`SELECT codigo, nome, estoque, estoqueMin FROM produtos
    WHERE (estoque IS NOT NULL AND estoque<=0) OR (estoqueMin>0 AND estoque<=estoqueMin)
    ORDER BY (COALESCE(estoque,0) - COALESCE(estoqueMin,0)) ASC, estoque ASC LIMIT 5`).all();
  res.json({ estoqueBaixo: baixo, zerados, indisponiveis, criticos });
});

// BLOCO E — financeiro rápido (gastos do dia, saldo bruto, fiado)
app.get('/api/dashboard/financeiro', (req, res) => {
  const fatHoje = db.prepare(`SELECT COALESCE(SUM(total),0) t FROM vendas v WHERE status='concluida' AND ${HOJE_VENDA}`).get().t;
  const comprasHoje = db.prepare(`SELECT COALESCE(SUM(total),0) t FROM compras WHERE ${HOJE('data')}`).get().t;
  const insumosHoje = db.prepare(`SELECT COALESCE(SUM(custo_total),0) t FROM insumos WHERE ${HOJE('criado_em')}`).get().t;
  const gastosHoje = comprasHoje + insumosHoje;
  const fiadoRecebidoHoje = db.prepare(`SELECT COALESCE(SUM(valor),0) t FROM clientes_extrato WHERE tipo='pagamento' AND ${HOJE('criado_em')}`).get().t;
  // fiado em aberto = soma só dos saldos POSITIVOS por cliente (compra soma, pagamento/estorno subtraem)
  const saldos = db.prepare("SELECT cliente_id, SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END) saldo FROM clientes_extrato GROUP BY cliente_id").all();
  const fiadoEmAberto = saldos.reduce((s, r) => s + (r.saldo > 0.001 ? r.saldo : 0), 0);
  // Compra de açaí (latas): o que foi PAGO hoje (sai do caixa hoje) e o total ainda a pagar aos fornecedores
  let acaiPagoHoje = 0, acaiAPagar = 0;
  // data_pagamento guarda só a DATA (sem hora) → compara direto com a data local (sem 'localtime', que deslocaria 1 dia)
  try { acaiPagoHoje = db.prepare(`SELECT COALESCE(SUM(total),0) t FROM compras_acai WHERE pago=1 AND date(data_pagamento)=date('now','localtime')`).get().t; } catch {}
  try { acaiAPagar = db.prepare('SELECT COALESCE(SUM(total),0) t FROM compras_acai WHERE pago=0').get().t; } catch {}
  res.json({ gastosHoje, gastoCompras: comprasHoje, gastoInsumos: insumosHoje, faturamentoHoje: fatHoje, saldoBrutoHoje: fatHoje - gastosHoje, fiadoRecebidoHoje, fiadoEmAberto, acaiPagoHoje, acaiAPagar });
});

// BLOCO F — top produtos (dia e semana)
app.get('/api/dashboard/top-produtos', (req, res) => {
  const dia = db.prepare(`SELECT i.codigo, i.nome, SUM(i.qtd) qtd, SUM(i.subtotal) total
    FROM vendas_itens i JOIN vendas v ON v.id=i.venda_id
    WHERE v.status='concluida' AND ${HOJE_VENDA}
    GROUP BY i.codigo, i.nome ORDER BY qtd DESC LIMIT 5`).all();
  const semana = db.prepare(`SELECT i.codigo, i.nome, SUM(i.qtd) qtd, SUM(i.subtotal) total
    FROM vendas_itens i JOIN vendas v ON v.id=i.venda_id
    WHERE v.status='concluida' AND date(v.data,'localtime') >= date('now','localtime','-6 days')
    GROUP BY i.codigo, i.nome ORDER BY qtd DESC LIMIT 5`).all();
  res.json({ dia, semana });
});

// ── Compras (Fase 19: agora com ITENS opcionais; retrocompatível sem itens) ──
app.get('/api/compras', (req, res) => {
  const f = faixaData(req.query.de, req.query.ate);
  res.json(db.prepare(`SELECT * FROM compras WHERE 1=1${f.where} ORDER BY id DESC LIMIT 1000`).all(...f.args));
});
app.get('/api/compras/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM compras WHERE id = ?').get(+req.params.id);
  if (!c) return res.status(404).json({ erro: 'Compra não encontrada.' });
  c.itens = db.prepare('SELECT * FROM compras_itens WHERE compra_id = ? ORDER BY id').all(c.id);
  res.json(c);
});
app.post('/api/compras', (req, res) => {
  const d = req.body || {};
  const agora = new Date().toISOString();
  const itens = Array.isArray(d.itens) ? d.itens : [];
  const totalItens = itens.reduce((s, it) => s + (it.subtotal != null ? +it.subtotal : (+it.quantidade || 0) * (+it.custo_unitario || 0)), 0);
  const total = d.total != null ? +d.total : totalItens;
  let compraId;
  db.exec('BEGIN');
  try {
    const info = db.prepare('INSERT INTO compras (data,numNota,fornecedor,descricao,total,origem,detalhes,forma_pagamento,criado_em) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(d.data || agora, d.numNota || '', d.fornecedor || '', d.descricao || '', total, d.origem || 'manual', d.detalhes ? JSON.stringify(d.detalhes) : null, d.forma_pagamento || '', agora);
    compraId = info.lastInsertRowid;
    const insItem = db.prepare('INSERT INTO compras_itens (compra_id,tipo_item,referencia_id,descricao,quantidade,unidade,custo_unitario,subtotal,criado_em) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const it of itens) {
      const qtd = +it.quantidade || 0, cu = +it.custo_unitario || 0;
      const sub = it.subtotal != null ? +it.subtotal : qtd * cu;
      insItem.run(compraId, it.tipo_item || 'outro', it.referencia_id != null ? String(it.referencia_id) : null, it.descricao || '', qtd, it.unidade || '', cu, sub, agora);
      // item de PRODUTO: atualiza o custo (compra mais recente) e, se pedido, dá entrada no estoque
      if (it.tipo_item === 'produto' && it.referencia_id) {
        const prod = db.prepare('SELECT codigo FROM produtos WHERE codigo = ?').get(String(it.referencia_id));
        if (prod) {
          if (cu > 0) db.prepare('UPDATE produtos SET precoCompra = ?, atualizado_em = ? WHERE codigo = ?').run(cu, agora, prod.codigo);
          if (it.dar_entrada && qtd > 0) registrarMovimento(prod.codigo, 'entrada', { quantidade: qtd, motivo: 'compra', referencia: 'compra#' + compraId });
        }
      }
      // item de INSUMO: dá entrada no saldo do insumo
      if (it.tipo_item === 'insumo' && it.referencia_id) { try { movimentarInsumo(+it.referencia_id, 'entrada', qtd, cu, 'compra', 'compra#' + compraId); } catch {} }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ erro: e.message }); }
  manut.logAcao('compra criada', 'compras', { id: compraId, total, itens: itens.length, numNota: d.numNota || '' }, 'operacao');
  res.json({ id: compraId, total });
});
app.put('/api/compras/:id', (req, res) => {
  const id = +req.params.id, d = req.body || {};
  if (!db.prepare('SELECT id FROM compras WHERE id = ?').get(id)) return res.status(404).json({ erro: 'Compra não encontrada.' });
  db.prepare('UPDATE compras SET data = COALESCE(?,data), numNota = ?, fornecedor = ?, descricao = ?, total = COALESCE(?,total) WHERE id = ?')
    .run(d.data || null, d.numNota || '', d.fornecedor || '', d.descricao || '', d.total != null ? +d.total : null, id);
  manut.logAcao('compra alterada', 'compras', { id }, 'operacao');
  res.json(db.prepare('SELECT * FROM compras WHERE id = ?').get(id));
});
app.delete('/api/compras/:id', (req, res) => {
  db.prepare('DELETE FROM compras_itens WHERE compra_id = ?').run(+req.params.id);
  db.prepare('DELETE FROM compras WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
});

// ── Insumos (Fase 19: saldo + custo médio + movimentação) ──
// Movimenta um insumo (entrada/consumo/ajuste), atualiza saldo/custo médio e grava histórico.
function movimentarInsumo(insumoId, tipo, quantidade, custoUnitario, origem, referenciaId) {
  const ins = db.prepare('SELECT * FROM insumos WHERE id = ?').get(insumoId);
  if (!ins) return null;
  const qtd = +quantidade || 0;
  const saldoAnt = (ins.saldo != null) ? +ins.saldo : (+ins.qtd || 0);
  let saldoNovo;
  if (tipo === 'entrada') saldoNovo = saldoAnt + qtd;
  else if (tipo === 'consumo') saldoNovo = Math.max(0, saldoAnt - qtd);
  else saldoNovo = qtd; // ajuste = saldo absoluto
  let cu = (+ins.custo_unitario || 0);
  if (tipo === 'entrada' && qtd > 0 && +custoUnitario > 0) {
    // custo médio ponderado só quando entra com custo informado
    cu = saldoAnt > 0 ? ((saldoAnt * (+ins.custo_unitario || 0)) + (qtd * +custoUnitario)) / (saldoAnt + qtd) : +custoUnitario;
  }
  const agora = new Date().toISOString();
  db.prepare('UPDATE insumos SET saldo = ?, custo_unitario = ?, atualizado_em = ? WHERE id = ?').run(saldoNovo, cu, agora, insumoId);
  db.prepare('INSERT INTO insumos_movimentos (insumo_id,tipo,quantidade,custo_unitario,saldo_anterior,saldo_novo,origem,referencia_id,data) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(insumoId, tipo, qtd, +custoUnitario || cu, saldoAnt, saldoNovo, origem || '', referenciaId || '', agora);
  return { insumoId, tipo, saldo_anterior: saldoAnt, saldo_novo: saldoNovo, custo_unitario: cu };
}
app.get('/api/insumos', (req, res) => res.json(db.prepare('SELECT * FROM insumos ORDER BY id DESC').all()));
app.get('/api/insumos/:id/movimentos', (req, res) => res.json(db.prepare('SELECT * FROM insumos_movimentos WHERE insumo_id = ? ORDER BY id DESC LIMIT 300').all(+req.params.id)));
app.post('/api/insumos', (req, res) => {
  const d = req.body || {};
  if (!d.nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  const qtd = +d.qtd || 0, custoTotal = +d.custo_total || +d.custo || 0;
  const cu = qtd > 0 ? custoTotal / qtd : custoTotal;
  const agora = new Date().toISOString();
  const info = db.prepare('INSERT INTO insumos (nome,unidade,qtd,saldo,custo_total,custo_unitario,obs,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(d.nome, d.unidade || 'un', qtd, qtd, custoTotal, cu, d.obs || '', agora, agora);
  const id = info.lastInsertRowid;
  if (qtd > 0) db.prepare('INSERT INTO insumos_movimentos (insumo_id,tipo,quantidade,custo_unitario,saldo_anterior,saldo_novo,origem,data) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, 'entrada', qtd, cu, 0, qtd, 'compra', agora);
  res.json({ id, saldo: qtd, custo_unitario: cu });
});
app.put('/api/insumos/:id', (req, res) => {
  const id = +req.params.id, d = req.body || {};
  if (!db.prepare('SELECT id FROM insumos WHERE id = ?').get(id)) return res.status(404).json({ erro: 'Insumo não encontrado.' });
  db.prepare('UPDATE insumos SET nome = COALESCE(?,nome), unidade = COALESCE(?,unidade), obs = COALESCE(?,obs), atualizado_em = ? WHERE id = ?')
    .run(d.nome || null, d.unidade || null, d.obs != null ? d.obs : null, new Date().toISOString(), id);
  res.json(db.prepare('SELECT * FROM insumos WHERE id = ?').get(id));
});
app.post('/api/insumos/:id/movimentos', (req, res) => {
  const id = +req.params.id, d = req.body || {};
  const tipo = ['entrada', 'consumo', 'ajuste'].includes(d.tipo) ? d.tipo : 'ajuste';
  const r = movimentarInsumo(id, tipo, +d.quantidade || 0, d.custo_unitario, d.origem || 'ajuste_manual', d.referencia_id || '');
  if (!r) return res.status(404).json({ erro: 'Insumo não encontrado.' });
  if (tipo === 'ajuste' || (d.origem || 'ajuste_manual') === 'ajuste_manual') manut.logAcao('ajuste manual de insumo', 'insumos', { id, tipo, saldo_novo: r.saldo_novo }, 'operacao');
  res.json(r);
});
app.delete('/api/insumos/:id', (req, res) => {
  db.prepare('DELETE FROM insumos_movimentos WHERE insumo_id = ?').run(+req.params.id);
  db.prepare('DELETE FROM insumos WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
});

// ── COMPRA DE AÇAÍ (latas) — controle de compra a prazo + pagamento em outra data ──
app.get('/api/compras-acai', (req, res) => {
  const q = req.query;
  const colData = q.campo === 'pagamento' ? 'data_pagamento' : 'data_compra';   // filtrar por data de COMPRA ou de PAGAMENTO
  // condição base (fornecedor + período) — vale pra lista E pro resumo
  const baseCond = ['1=1'], baseArgs = [];
  if (q.fornecedor) { baseCond.push('fornecedor = ?'); baseArgs.push(q.fornecedor); }
  if (q.de) { baseCond.push(`date(${colData}) >= ?`); baseArgs.push(q.de); }
  if (q.ate) { baseCond.push(`date(${colData}) <= ?`); baseArgs.push(q.ate); }
  // a LISTA respeita também o status (padrão do front = só pendentes)
  const listCond = baseCond.slice(), listArgs = baseArgs.slice();
  if (q.status === 'pago') listCond.push('pago = 1'); else if (q.status === 'pendente') listCond.push('pago = 0');
  const lista = db.prepare(`SELECT * FROM compras_acai WHERE ${listCond.join(' AND ')} ORDER BY date(data_compra) DESC, id DESC`).all(...listArgs);
  // o RESUMO (Comprado/Pago/A pagar) ignora o status → mostra o quadro completo do recorte
  const rr = db.prepare(`SELECT * FROM compras_acai WHERE ${baseCond.join(' AND ')}`).all(...baseArgs);
  const totComprado = rr.reduce((s, c) => s + (+c.total || 0), 0);
  const totPago = rr.filter(c => c.pago).reduce((s, c) => s + (+c.total || 0), 0);
  const totLatas = rr.reduce((s, c) => s + (+c.quantidade || 0), 0);
  const fornecedores = db.prepare("SELECT DISTINCT fornecedor FROM compras_acai WHERE fornecedor <> '' ORDER BY fornecedor").all().map(r => r.fornecedor);
  const aPagarForn = db.prepare("SELECT fornecedor, COALESCE(SUM(total),0) saldo, COUNT(*) n FROM compras_acai WHERE pago = 0 GROUP BY fornecedor ORDER BY saldo DESC").all();
  res.json({ lista, resumo: { totComprado, totPago, aPagar: totComprado - totPago, totLatas, n: lista.length, nTotal: rr.length }, fornecedores, aPagarForn });
});
app.post('/api/compras-acai', (req, res) => {
  const d = req.body || {};
  const qtd = +d.quantidade || 0, preco = +d.preco_unitario || 0;
  if (qtd <= 0) return res.status(400).json({ erro: 'Informe a quantidade de latas.' });
  const total = d.total != null ? +d.total : Math.round(qtd * preco * 100) / 100;
  const agora = new Date().toISOString();
  const info = db.prepare('INSERT INTO compras_acai (fornecedor, data_compra, quantidade, preco_unitario, total, pago, data_pagamento, forma_pagamento, obs, criado_em) VALUES (?,?,?,?,?,0,NULL,NULL,?,?)')
    .run((d.fornecedor || '').trim(), (d.data_compra || agora.slice(0, 10)), qtd, preco, total, (d.obs || '').trim(), agora);
  res.json(db.prepare('SELECT * FROM compras_acai WHERE id = ?').get(info.lastInsertRowid));
});
app.post('/api/compras-acai/:id/pagar', (req, res) => {
  const id = +req.params.id, d = req.body || {};
  const c = db.prepare('SELECT * FROM compras_acai WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ erro: 'Compra não encontrada.' });
  const dataPg = (d.data_pagamento || new Date().toISOString().slice(0, 10));
  db.prepare('UPDATE compras_acai SET pago = 1, data_pagamento = ?, forma_pagamento = ? WHERE id = ?').run(dataPg, (d.forma_pagamento || '').trim(), id);
  res.json(db.prepare('SELECT * FROM compras_acai WHERE id = ?').get(id));
});
app.post('/api/compras-acai/:id/estornar-pagamento', (req, res) => {
  const id = +req.params.id;
  db.prepare('UPDATE compras_acai SET pago = 0, data_pagamento = NULL, forma_pagamento = NULL WHERE id = ?').run(id);
  res.json(db.prepare('SELECT * FROM compras_acai WHERE id = ?').get(id) || { ok: true });
});
app.put('/api/compras-acai/:id', (req, res) => {
  const id = +req.params.id, d = req.body || {};
  if (!db.prepare('SELECT id FROM compras_acai WHERE id = ?').get(id)) return res.status(404).json({ erro: 'Compra não encontrada.' });
  const qtd = +d.quantidade || 0, preco = +d.preco_unitario || 0, total = d.total != null ? +d.total : Math.round(qtd * preco * 100) / 100;
  db.prepare('UPDATE compras_acai SET fornecedor=?, data_compra=?, quantidade=?, preco_unitario=?, total=?, obs=? WHERE id=?')
    .run((d.fornecedor || '').trim(), d.data_compra, qtd, preco, total, (d.obs || '').trim(), id);
  res.json(db.prepare('SELECT * FROM compras_acai WHERE id = ?').get(id));
});
app.delete('/api/compras-acai/:id', (req, res) => {
  db.prepare('DELETE FROM compras_acai WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
});

/* ══ CONFERÊNCIA DE CAIXA — SÓ CONFERE (não fecha caixa, não move dinheiro) ═══════════
   Compara o ESPERADO (das vendas, por forma: crédito/débito/pix/dinheiro/alimentação) com
   o CONTADO informado por maquininha + pix da conta + dinheiro da gaveta. Maquininhas são
   rótulos EDITÁVEIS (não afetam o financeiro). Aceita período De→Até (pra fechar vários dias
   juntos) e guarda histórico pra sugerir "desde a última conferência". Fiado NÃO conta (não é
   caixa); vendas legadas sem forma (Importado/Automático) caem em "outros". ═════════════════ */
db.exec(`CREATE TABLE IF NOT EXISTS conf_maquininhas (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, ordem INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1, criado_em TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS conf_caixa (id INTEGER PRIMARY KEY AUTOINCREMENT, de TEXT, ate TEXT, esperado_json TEXT, informado_json TEXT, total_esperado REAL, total_informado REAL, diferenca REAL, obs TEXT, criado_em TEXT, criado_por TEXT)`);
(function seedConfMaquininhas() {
  if (db.prepare('SELECT COUNT(*) n FROM conf_maquininhas').get().n) return;
  const ins = db.prepare('INSERT INTO conf_maquininhas (nome, ordem, ativo, criado_em) VALUES (?,?,1,?)'), ag = new Date().toISOString();
  ['InfinitePay', 'Getnet', 'Mercado Pago'].forEach((n, i) => ins.run(n, i, ag));
})();
// esperado por forma, das vendas concluídas no período (datas em horário local, dia inteiro)
function conferenciaEsperado(de, ate) {
  const cond = ["v.status='concluida'"], args = [];
  if (de) { cond.push("date(v.data,'localtime') >= ?"); args.push(de); }
  if (ate) { cond.push("date(v.data,'localtime') <= ?"); args.push(ate); }
  const rows = db.prepare(`SELECT p.forma, COALESCE(SUM(p.valor),0) total FROM pagamentos p JOIN vendas v ON v.id=p.venda_id WHERE ${cond.join(' AND ')} GROUP BY p.forma`).all(...args);
  const m = { credito: 0, debito: 0, pix: 0, dinheiro: 0, alimentacao: 0, outros: 0 };
  for (const r of rows) {
    const t = +r.total || 0;
    switch (r.forma) {
      case 'Cartão Crédito': m.credito += t; break;
      case 'Cartão Débito': m.debito += t; break;
      case 'PIX': m.pix += t; break;
      case 'Dinheiro': m.dinheiro += t; break;
      case 'Cartão Alimentação': m.alimentacao += t; break;
      case 'Fiado': break;               // não é caixa (dinheiro não entrou)
      default: m.outros += t;            // Importado / Automático / sem forma
    }
  }
  // linka a sangria/suprimento QUE JÁ EXISTEM (financeiro_movimentos do caixa) no esperado do dinheiro:
  // gaveta = vendas em dinheiro + suprimentos (inclui troco/fundo) − sangrias, no mesmo período.
  const vendasDinheiro = m.dinheiro;
  const pc = [], pa = [];
  if (de) { pc.push("date(data,'localtime') >= ?"); pa.push(de); }
  if (ate) { pc.push("date(data,'localtime') <= ?"); pa.push(ate); }
  const per = pc.length ? ' AND ' + pc.join(' AND ') : '';
  const sup = db.prepare(`SELECT COALESCE(SUM(valor),0) t FROM financeiro_movimentos WHERE referencia_tipo='caixa_suprimento' AND situacao='confirmado'${per}`).get(...pa).t;
  const san = db.prepare(`SELECT COALESCE(SUM(valor),0) t FROM financeiro_movimentos WHERE referencia_tipo='caixa_sangria' AND situacao='confirmado'${per}`).get(...pa).t;
  for (const k of ['credito', 'debito', 'pix', 'alimentacao', 'outros']) m[k] = r2(m[k]);
  m.dinheiro = r2(vendasDinheiro + (+sup || 0) - (+san || 0));
  m.dinheiroDetalhe = { vendas: r2(vendasDinheiro), suprimentos: r2(sup), sangrias: r2(san) };
  m.total = r2(m.credito + m.debito + m.pix + m.dinheiro + m.alimentacao + m.outros);
  return m;
}
app.get('/api/conferencia/maquininhas', (req, res) => res.json(db.prepare('SELECT id, nome, ordem FROM conf_maquininhas WHERE ativo=1 ORDER BY ordem, id').all()));
app.post('/api/conferencia/maquininhas', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const nome = ((req.body || {}).nome || '').trim(); if (!nome) return res.status(400).json({ erro: 'Informe o nome da maquininha.' });
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem),0)+1 o FROM conf_maquininhas').get().o;
  const info = db.prepare('INSERT INTO conf_maquininhas (nome, ordem, ativo, criado_em) VALUES (?,?,1,?)').run(nome, ordem, new Date().toISOString());
  res.json(db.prepare('SELECT id, nome, ordem FROM conf_maquininhas WHERE id=?').get(info.lastInsertRowid));
});
app.put('/api/conferencia/maquininhas/:id', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const nome = ((req.body || {}).nome || '').trim(); if (!nome) return res.status(400).json({ erro: 'Informe o nome.' });
  db.prepare('UPDATE conf_maquininhas SET nome=? WHERE id=?').run(nome, +req.params.id);
  res.json({ ok: true });
});
app.delete('/api/conferencia/maquininhas/:id', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  db.prepare('UPDATE conf_maquininhas SET ativo=0 WHERE id=?').run(+req.params.id); // soft-delete: histórico mantém o nome
  res.json({ ok: true });
});
app.get('/api/conferencia/esperado', (req, res) => {
  res.json({ esperado: conferenciaEsperado(req.query.de, req.query.ate), ultima: db.prepare('SELECT de, ate, criado_em FROM conf_caixa ORDER BY id DESC LIMIT 1').get() || null });
});
app.post('/api/conferencia', (req, res) => {
  const d = req.body || {}, de = d.de || null, ate = d.ate || null;
  const esperado = conferenciaEsperado(de, ate);        // recalcula no servidor (não confia no cliente)
  const inf = d.informado || {}, maq = Array.isArray(inf.maquininhas) ? inf.maquininhas : [];
  const soma = campo => r2(maq.reduce((s, m) => s + (+m[campo] || 0), 0));
  const contado = { credito: soma('credito'), debito: soma('debito'), pix: r2(soma('pix') + (+inf.pixConta || 0)), alimentacao: soma('alimentacao'), dinheiro: r2(+inf.dinheiro || 0), outros: r2(+inf.outros || 0) };
  contado.total = r2(contado.credito + contado.debito + contado.pix + contado.alimentacao + contado.dinheiro + contado.outros);
  const formas = ['credito', 'debito', 'pix', 'dinheiro', 'alimentacao', 'outros'], diff = {};
  formas.forEach(f => diff[f] = r2((contado[f] || 0) - (esperado[f] || 0)));
  const totalDif = r2(contado.total - esperado.total);
  const info = db.prepare('INSERT INTO conf_caixa (de,ate,esperado_json,informado_json,total_esperado,total_informado,diferenca,obs,criado_em,criado_por) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(de, ate, JSON.stringify(esperado), JSON.stringify({ ...inf, contado }), esperado.total, contado.total, totalDif, (d.obs || '').trim(), new Date().toISOString(), (req.usuario || {}).usuario || '');
  res.json({ id: info.lastInsertRowid, esperado, contado, diferenca: diff, totalDiferenca: totalDif });
});
app.get('/api/conferencia/historico', (req, res) => {
  const rows = db.prepare('SELECT id, de, ate, esperado_json, informado_json, total_esperado, total_informado, diferenca, obs, criado_em, criado_por FROM conf_caixa ORDER BY id DESC LIMIT 60').all();
  const FORMAS = ['credito', 'debito', 'pix', 'dinheiro', 'alimentacao'];
  const lista = rows.map(r => {
    let esp = {}, inf = {}; try { esp = JSON.parse(r.esperado_json || '{}'); } catch {} try { inf = JSON.parse(r.informado_json || '{}'); } catch {}
    const cont = inf.contado || {}, porForma = {};
    for (const f of FORMAS) porForma[f] = r2((+cont[f] || 0) - (+esp[f] || 0));
    return { id: r.id, de: r.de, ate: r.ate, total_esperado: r.total_esperado, total_informado: r.total_informado, diferenca: r.diferenca, obs: r.obs, criado_em: r.criado_em, criado_por: r.criado_por, porForma };
  });
  // ── inteligência: placar, acumulado, forma que mais escapa, alerta de padrão ──
  let bateu = 0, sobra = 0, prejuizo = 0, difAcum = 0; const formaAcum = {}; FORMAS.forEach(f => formaAcum[f] = 0);
  for (const c of lista) {
    const d = +c.diferenca || 0; difAcum += d;
    if (Math.abs(d) < 0.005) bateu++; else if (d > 0) sobra++; else prejuizo++;
    for (const f of FORMAS) formaAcum[f] = r2(formaAcum[f] + (+c.porForma[f] || 0));
  }
  let pior = null; for (const f of FORMAS) { if (!pior || Math.abs(formaAcum[f]) > Math.abs(pior.valor)) pior = { forma: f, valor: r2(formaAcum[f]) }; }
  let alerta = null; const ult = lista.slice(0, 5);
  for (const f of FORMAS) {
    const nf = ult.filter(c => (+c.porForma[f] || 0) <= -0.005).length, ns = ult.filter(c => (+c.porForma[f] || 0) >= 0.005).length;
    if (nf >= 3) { alerta = { forma: f, sentido: 'falta', n: nf, de: ult.length }; break; }
    if (ns >= 3) { alerta = { forma: f, sentido: 'sobra', n: ns, de: ult.length }; break; }
  }
  const n = lista.length;
  res.json({ lista, insights: { n, bateu, sobra, prejuizo, difAcum: r2(difAcum), difMedia: n ? r2(difAcum / n) : 0, formaAcum, pior, alerta } });
});
// espelho de um fechamento (detalhe completo: por forma, por maquininha, obs, quem)
app.get('/api/conferencia/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM conf_caixa WHERE id=?').get(+req.params.id);
  if (!r) return res.status(404).json({ erro: 'Fechamento não encontrado.' });
  let esp = {}, inf = {}; try { esp = JSON.parse(r.esperado_json || '{}'); } catch {} try { inf = JSON.parse(r.informado_json || '{}'); } catch {}
  const cont = inf.contado || {}, porForma = {};
  for (const f of ['credito', 'debito', 'pix', 'dinheiro', 'alimentacao', 'outros']) porForma[f] = { esperado: r2(+esp[f] || 0), contado: r2(+cont[f] || 0), diferenca: r2((+cont[f] || 0) - (+esp[f] || 0)) };
  res.json({ id: r.id, de: r.de, ate: r.ate, criado_em: r.criado_em, criado_por: r.criado_por, obs: r.obs,
    total_esperado: r.total_esperado, total_informado: r.total_informado, diferenca: r.diferenca, porForma,
    maquininhas: inf.maquininhas || [], pixConta: r2(+inf.pixConta || 0), dinheiro: r2(+inf.dinheiro || 0), outros: r2(+inf.outros || 0), dinheiroDetalhe: esp.dinheiroDetalhe || null });
});

/* ══ BALANÇO DE ESTOQUE — contagem física × sistema, ajusta tudo de uma vez e valora o
   resultado em SALDO (sobra) ou PREJUÍZO (perda). Reusa salvarMovNC (ajuste auditado, único
   ponto que mexe no estoque e propaga pra todo o programa). A valoração é pelo CUSTO
   (precoCompra) — é o que de fato se ganhou/perdeu de mercadoria. Ligado à Conferência: quando
   o caixa dá diferença, o operador confere o estoque aqui pra achar o que sumiu. ═══════════ */
db.exec(`CREATE TABLE IF NOT EXISTS balancos (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, n_itens INTEGER, n_ajustados INTEGER, valor_sobra REAL, valor_falta REAL, resultado REAL, obs TEXT, itens_json TEXT, criado_em TEXT, criado_por TEXT)`);
app.get('/api/balanco/produtos', (req, res) => {
  const q = (req.query.q || '').trim();
  const rows = q
    ? db.prepare("SELECT codigo,nome,COALESCE(unidade,'un') unidade,COALESCE(estoque,0) estoque,COALESCE(precoCompra,0) custo,COALESCE(precoVenda,0) venda FROM produtos WHERE codigo LIKE ? OR nome LIKE ? ORDER BY nome").all(`%${q}%`, `%${q}%`)
    : db.prepare("SELECT codigo,nome,COALESCE(unidade,'un') unidade,COALESCE(estoque,0) estoque,COALESCE(precoCompra,0) custo,COALESCE(precoVenda,0) venda FROM produtos ORDER BY nome").all();
  res.json(rows.map(p => ({ ...p, estoque: r2(p.estoque), custo: r2(p.custo), venda: r2(p.venda) })));
});
app.post('/api/balanco', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {}, itens = Array.isArray(d.itens) ? d.itens : [];
  let valorSobra = 0, valorFalta = 0, nAjust = 0; const detalhe = [];
  for (const it of itens) {
    const cod = it && it.codigo; if (!cod) continue;
    if (it.fisico == null || it.fisico === '') continue;   // produto não contado → ignora
    const p = db.prepare("SELECT codigo,nome,COALESCE(unidade,'un') unidade,COALESCE(estoque,0) estoque,COALESCE(precoCompra,0) custo FROM produtos WHERE codigo=?").get(cod);
    if (!p) continue;
    const fisico = r2(+it.fisico || 0), dif = r2(fisico - (+p.estoque || 0));
    if (Math.abs(dif) < 0.001) continue;                   // sem diferença → nada a ajustar
    try { salvarMovNC({ produto_codigo: cod, tipo: 'ajuste', quantidade: Math.abs(dif), sentido_ajuste: dif > 0 ? 'entrada' : 'saida', obs: 'balanço de estoque' + (d.obs ? ' · ' + d.obs : '') }, (req.usuario || {}).nome || (req.usuario || {}).usuario || '', 'balanco'); }
    catch { continue; }
    nAjust++;
    const valor = r2(dif * (+p.custo || 0));
    if (valor > 0) valorSobra += valor; else valorFalta += -valor;
    detalhe.push({ codigo: cod, nome: p.nome, unidade: p.unidade, estoque_sistema: r2(p.estoque), fisico, dif, custo: r2(p.custo), valor });
  }
  const resultado = r2(valorSobra - valorFalta);   // + = saldo (sobra) · − = prejuízo (perda)
  const info = db.prepare('INSERT INTO balancos (data,n_itens,n_ajustados,valor_sobra,valor_falta,resultado,obs,itens_json,criado_em,criado_por) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(ymdLocal(new Date()), itens.length, nAjust, r2(valorSobra), r2(valorFalta), resultado, (d.obs || '').trim(), JSON.stringify(detalhe), new Date().toISOString(), (req.usuario || {}).usuario || '');
  manut.logAcao('balanço de estoque', 'estoque', { id: info.lastInsertRowid, ajustados: nAjust, resultado, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ id: info.lastInsertRowid, nAjustados: nAjust, valorSobra: r2(valorSobra), valorFalta: r2(valorFalta), resultado, detalhe });
});
app.get('/api/balanco/historico', (req, res) => {
  const rows = db.prepare('SELECT id, data, n_ajustados, valor_sobra, valor_falta, resultado, obs, itens_json, criado_em, criado_por FROM balancos ORDER BY id DESC LIMIT 60').all();
  const prod = {}; let totalPrejuizo = 0, totalSaldo = 0;
  const lista = rows.map(r => {
    let itens = []; try { itens = JSON.parse(r.itens_json || '[]'); } catch {}
    for (const it of itens) { const v = +it.valor || 0; const p = prod[it.codigo] = prod[it.codigo] || { nome: it.nome, perda: 0, sobra: 0, nPerda: 0 }; if (v < 0) { p.perda += -v; p.nPerda++; } else p.sobra += v; }
    if ((+r.resultado || 0) < 0) totalPrejuizo += -(+r.resultado); else totalSaldo += (+r.resultado);
    return { id: r.id, data: r.data, n_ajustados: r.n_ajustados, valor_sobra: r.valor_sobra, valor_falta: r.valor_falta, resultado: r.resultado, obs: r.obs, criado_em: r.criado_em, criado_por: r.criado_por };
  });
  let pior = null; for (const [cod, p] of Object.entries(prod)) { if (p.perda > 0 && (!pior || p.perda > pior.perda)) pior = { codigo: cod, nome: p.nome, perda: r2(p.perda), n: p.nPerda }; }
  res.json({ lista, insights: { n: lista.length, totalPrejuizo: r2(totalPrejuizo), totalSaldo: r2(totalSaldo), pior } });
});
// Troco/fundo que fica na gaveta para o próximo dia. Reusa o razão (entrada de dinheiro na
// conta Caixa, referencia_tipo 'caixa_suprimento') → entra no ESPERADO do dinheiro daquele dia
// na conferência, sem exigir caixa aberto. Data default = amanhã.
app.post('/api/caixa/troco', (req, res) => {
  const d = req.body || {}, valor = Math.round((+d.valor || 0) * 100) / 100;
  if (valor <= 0) return res.status(400).json({ erro: 'Informe um valor maior que zero.' });
  const contaCaixa = (db.prepare("SELECT id FROM financeiro_contas WHERE nome='Caixa'").get() || {}).id || null;
  const dataYmd = (d.data || ymdLocal(new Date(Date.now() + 864e5))).slice(0, 10);
  const movId = inserirMovimento({ data: dataYmd + 'T12:00:00', tipo: 'entrada', conta_id: contaCaixa, categoria_id: catFinId('Suprimento'),
    valor, descricao: 'Troco na gaveta (fundo) para o dia' + (d.obs ? ' · ' + d.obs : ''), origem: 'caixa', situacao: 'confirmado',
    referencia_tipo: 'caixa_suprimento', caixa_sessao_id: 0, responsavel: (req.usuario || {}).nome || '', criado_por: (req.usuario || {}).usuario || '' });
  manut.logAcao('troco/fundo na gaveta', 'caixa', { valor, data: dataYmd, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true, id: movId, valor, data: dataYmd });
});
// espelho de um balanço (itens contados, diferença e valor por produto)
app.get('/api/balanco/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM balancos WHERE id=?').get(+req.params.id);
  if (!r) return res.status(404).json({ erro: 'Balanço não encontrado.' });
  let itens = []; try { itens = JSON.parse(r.itens_json || '[]'); } catch {}
  res.json({ id: r.id, data: r.data, n_ajustados: r.n_ajustados, valor_sobra: r.valor_sobra, valor_falta: r.valor_falta, resultado: r.resultado, obs: r.obs, criado_em: r.criado_em, criado_por: r.criado_por, itens });
});

/* ══ CONTROLE DE LITROS (F8 registra litros produzidos por valor; F10 fecha o dia com as sacas
   e joga no rendimento). Os lançamentos ficam PENDENTES até o fechamento (consumido=1). ══════ */
db.exec(`CREATE TABLE IF NOT EXISTS litros_producao (id INTEGER PRIMARY KEY AUTOINCREMENT, litros REAL, valor_unit REAL, data TEXT, consumido INTEGER DEFAULT 0, criado_em TEXT, criado_por TEXT)`);
try { db.exec('ALTER TABLE litros_producao ADD COLUMN produto_codigo TEXT'); } catch {} // liga a produção ao PRODUTO (não só ao valor) — o F10 usa o produto exato
function litrosResumo(rows) {
  // Agrupa por PRODUTO quando houver código; senão pelo valor (retrocompat com lançamentos antigos).
  // Assim dois produtos de mesmo preço NÃO se misturam, e o F10 preenche o produto certo.
  const grupos = {}; let total = 0;
  for (const r of rows) {
    const v = r2(+r.valor_unit || 0), l = r2(+r.litros || 0), cod = r.produto_codigo || '';
    const key = cod ? ('c:' + cod) : ('v:' + v);
    total += l;
    if (!grupos[key]) {
      let nome = '';
      if (cod) { try { const p = db.prepare('SELECT nome FROM produtos WHERE codigo=?').get(cod); nome = p ? p.nome : ''; } catch {} }
      grupos[key] = { valor: v, codigo: cod, nome, litros: 0, n: 0 };
    }
    grupos[key].litros = r2(grupos[key].litros + l); grupos[key].n++;
  }
  return { totalLitros: r2(total), porValor: Object.values(grupos).sort((a, b) => a.valor - b.valor), n: rows.length };
}
app.post('/api/litros', (req, res) => {
  const d = req.body || {}, litros = r2(+d.litros || 0), valor = r2(+d.valor || +d.valor_unit || 0);
  const codigo = (d.produto_codigo || d.codigo || '').toString().trim();
  if (litros <= 0) return res.status(400).json({ erro: 'Informe os litros (maior que zero).' });
  if (valor <= 0) return res.status(400).json({ erro: 'Informe o valor.' });
  const info = db.prepare('INSERT INTO litros_producao (litros,valor_unit,produto_codigo,data,consumido,criado_em,criado_por) VALUES (?,?,?,?,0,?,?)')
    .run(litros, valor, codigo || null, ymdLocal(new Date()), new Date().toISOString(), (req.usuario || {}).usuario || '');
  res.json(db.prepare('SELECT * FROM litros_producao WHERE id=?').get(info.lastInsertRowid));
});
app.get('/api/litros', (req, res) => {
  const rows = db.prepare('SELECT * FROM litros_producao WHERE consumido=0 ORDER BY id DESC').all();
  res.json({ lista: rows, resumo: litrosResumo(rows) });
});
app.delete('/api/litros/:id', (req, res) => { db.prepare('DELETE FROM litros_producao WHERE id=? AND consumido=0').run(+req.params.id); res.json({ ok: true }); });
// valores/produtos do F8: cada botão é um PRODUTO DE AÇAÍ CADASTRADO (código+nome+valor), pra o F10
// preencher o produto EXATO e nunca aparecer valor "fantasma" sem produto por trás. Fonte = o que está
// cadastrado. Só cai na lista curada/todos se NENHUM produto for classificado como açaí (não trava o F8).
app.get('/api/litros/valores', (req, res) => {
  const prods = db.prepare('SELECT codigo, nome, precoVenda, departamento FROM produtos WHERE COALESCE(precoVenda,0)>0 ORDER BY precoVenda, nome').all();
  const ehAcai = p => { const t = ((p.nome || '') + ' ' + (p.departamento || '')).toLowerCase(); return t.includes('aça') || t.includes('aca'); };
  const acai = prods.filter(ehAcai);
  if (acai.length) return res.json(acai.map(p => ({ valor: r2(+p.precoVenda || 0), codigo: p.codigo, nome: p.nome })));
  // sem nenhum açaí classificado: mantém a lista curada (se o admin cadastrou) ou todos os produtos
  const cfg = getConfig('litros_valores', '');
  if (cfg) {
    try {
      const arr = JSON.parse(cfg);
      if (Array.isArray(arr) && arr.length) {
        return res.json(arr.map(v => r2(+v || 0)).filter(v => v > 0).map(v => {
          const iguais = prods.filter(p => Math.abs(r2(+p.precoVenda || 0) - v) < 0.005);
          const p = iguais.length === 1 ? iguais[0] : null;
          return { valor: v, codigo: p ? p.codigo : '', nome: p ? p.nome : '' };
        }));
      }
    } catch {}
  }
  res.json(prods.map(p => ({ valor: r2(+p.precoVenda || 0), codigo: p.codigo, nome: p.nome })));
});
// Edita os valores do F8 — SÓ o administrador. Lista vazia volta ao automático (preços dos produtos).
app.post('/api/litros/valores', (req, res) => {
  if (!req.usuario || req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Só o administrador pode editar os valores do açaí.' });
  const arr = Array.isArray((req.body || {}).valores) ? req.body.valores : [];
  const limpos = [...new Set(arr.map(v => r2(+v || 0)).filter(v => v > 0))].sort((a, b) => a - b);
  setConfig('litros_valores', JSON.stringify(limpos));
  res.json({ ok: true, valores: limpos });
});
// Fechar o dia: marca os pendentes como consumidos e devolve o resumo (litros por valor) p/ o rendimento.
app.post('/api/litros/fechar', (req, res) => {
  const rows = db.prepare('SELECT * FROM litros_producao WHERE consumido=0').all();
  const resumo = litrosResumo(rows);
  db.prepare('UPDATE litros_producao SET consumido=1 WHERE consumido=0').run();
  res.json({ ok: true, resumo });
});

/* ── ANOTAÇÕES ("pagar depois") ──────────────────────────────────────────────
   Recebível RÁPIDO, sem precisar cadastrar cliente. Fica no PDV até dar baixa.
   Enquanto ABERTA conta como "a receber" (entra no resumo/relatórios). Ao PAGAR,
   vira ENTRADA no financeiro (caixa) — igual ao recebimento de fiado. Se veio de
   uma venda (botão na tela de finalizar), a venda já baixou o estoque e entrou no
   faturamento com forma "Anotado" (tratada como NÃO-caixa, igual fiado). ───────── */
db.exec(`CREATE TABLE IF NOT EXISTS anotacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, descricao TEXT, valor REAL,
  venda_id INTEGER, pago INTEGER DEFAULT 0, pago_em TEXT, pago_formas TEXT,
  criado_em TEXT, criado_por TEXT)`);
try { db.exec('ALTER TABLE anotacoes ADD COLUMN historico TEXT'); } catch {} // log de cada compra da MESMA pessoa (pra somar + relatório)
function anotacaoFront(a) {
  let hist = []; try { hist = JSON.parse(a.historico || '[]'); } catch {}
  if (!Array.isArray(hist)) hist = [];
  return { id: a.id, nome: a.nome || '', descricao: a.descricao || '', valor: r2(+a.valor || 0),
    venda_id: a.venda_id || null, pago: !!a.pago, pago_em: a.pago_em || null, criado_por: a.criado_por || '',
    criado_em: a.criado_em, hora: a.criado_em ? new Date(a.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
    historico: hist.map(h => ({ ...h, valor: r2(+h.valor || 0) })), nCompras: (hist.filter(h => !h.pagamento).length || 1) };
}
const anotacoesPendentesTotal = () => r2(db.prepare('SELECT COALESCE(SUM(valor),0) t FROM anotacoes WHERE pago=0').get().t || 0);

app.get('/api/anotacoes', (req, res) => {
  const rows = db.prepare(`SELECT * FROM anotacoes ${req.query.todas === '1' ? '' : 'WHERE pago=0'} ORDER BY id DESC LIMIT 300`).all();
  // nomes já usados (pra sugerir/autocompletar e não redigitar)
  const nomes = db.prepare("SELECT DISTINCT nome FROM anotacoes WHERE COALESCE(nome,'')<>'' ORDER BY nome").all().map(r => r.nome);
  // fiados em ABERTO por cliente (saldo positivo) — a caixa "quem paga depois" mostra fiado + anotações juntos
  const fiados = db.prepare(`SELECT c.id cliente_id, c.nome, COALESCE(SUM(CASE WHEN e.tipo='compra' THEN e.valor ELSE -e.valor END),0) saldo, MAX(e.criado_em) ultimo
      FROM clientes_extrato e JOIN clientes c ON c.id=e.cliente_id GROUP BY e.cliente_id HAVING saldo > 0.009 ORDER BY ultimo DESC`).all()
    .map(f => ({ cliente_id: f.cliente_id, nome: f.nome, saldo: r2(f.saldo), hora: f.ultimo ? new Date(f.ultimo).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '' }));
  const fiadoTotal = r2(fiados.reduce((s, f) => s + f.saldo, 0));
  res.json({ lista: rows.map(anotacaoFront), fiados, fiadoTotal, totalAnotacoes: anotacoesPendentesTotal(), nomes,
    totalPendente: r2(anotacoesPendentesTotal() + fiadoTotal),
    nPendentes: db.prepare('SELECT COUNT(*) n FROM anotacoes WHERE pago=0').get().n + fiados.length });
});
app.post('/api/anotacoes', (req, res) => {
  const d = req.body || {}, valor = r2(+d.valor || 0);
  if (valor <= 0) return res.status(400).json({ erro: 'Informe o valor da anotação.' });
  const nome = (d.nome || '').trim(), descricao = (d.descricao || '').trim(), agora = new Date().toISOString();
  const entrada = { data: agora, descricao, valor, venda_id: d.venda_id || null };
  // Mesma pessoa com anotação ABERTA → SOMA na existente (vira uma conta corrente) e guarda no histórico.
  const existente = nome ? db.prepare('SELECT * FROM anotacoes WHERE pago=0 AND lower(trim(nome))=lower(?) ORDER BY id DESC LIMIT 1').get(nome) : null;
  let id;
  if (existente) {
    let hist = []; try { hist = JSON.parse(existente.historico || '[]'); } catch {}
    if (!Array.isArray(hist)) hist = [];
    if (!hist.length) hist.push({ data: existente.criado_em, descricao: existente.descricao || '', valor: r2(+existente.valor || 0), venda_id: existente.venda_id || null });
    hist.push(entrada);
    db.prepare('UPDATE anotacoes SET valor=?, descricao=?, historico=? WHERE id=?')
      .run(r2((+existente.valor || 0) + valor), descricao || existente.descricao || '', JSON.stringify(hist), existente.id);
    id = existente.id;
  } else {
    const info = db.prepare('INSERT INTO anotacoes (nome,descricao,valor,venda_id,pago,historico,criado_em,criado_por) VALUES (?,?,?,?,0,?,?,?)')
      .run(nome, descricao, valor, d.venda_id || null, JSON.stringify([entrada]), agora, (req.usuario || {}).nome || (req.usuario || {}).usuario || '');
    id = info.lastInsertRowid;
  }
  try { manut.logAcao(existente ? 'anotação somada (pagar depois)' : 'anotação criada (pagar depois)', 'financeiro', { id, valor, nome }, 'pdv'); } catch {}
  res.json(anotacaoFront(db.prepare('SELECT * FROM anotacoes WHERE id=?').get(id)));
});
app.post('/api/anotacoes/:id/pagar', (req, res) => {
  const a = db.prepare('SELECT * FROM anotacoes WHERE id=?').get(+req.params.id);
  if (!a) return res.status(404).json({ erro: 'Anotação não encontrada.' });
  if (a.pago) return res.json(anotacaoFront(a));
  const d = req.body || {};
  const saldo = r2(+a.valor || 0);
  // valor pago: se não vier, quita tudo. NUNCA paga mais que o saldo. Menor que o saldo = PARCIAL.
  let valorPago = d.valor != null ? r2(+d.valor || 0) : saldo;
  if (valorPago <= 0) return res.status(400).json({ erro: 'Informe quanto foi pago.' });
  if (valorPago > saldo) valorPago = saldo;
  const parcial = valorPago < saldo - 0.001;
  // formas: usa as informadas OU uma só (forma) com o valor pago
  let formas = Array.isArray(d.formas) ? d.formas.filter(f => (+f.valor || 0) > 0) : [];
  if (!formas.length) formas = [{ nome: d.forma || 'Dinheiro', valor: valorPago }];
  const agora = new Date().toISOString(), cat = catFinId('Recebimento anotação');
  for (const f of formas) {
    const valor = r2(+f.valor || 0); if (valor <= 0) continue;
    inserirMovimento({ data: agora, tipo: 'entrada', conta_id: contaParaForma(f.nome || f.forma || 'Dinheiro'),
      categoria_id: cat, valor, descricao: `Recebimento anotação${parcial ? ' (parcial)' : ''} · ${a.nome || 'sem nome'}`, origem: 'anotacao',
      responsavel: (req.usuario || {}).nome || '', situacao: 'confirmado', referencia_tipo: 'anotacao', referencia_id: a.id });
  }
  // registra o pagamento no histórico (valor negativo = abateu)
  let hist = []; try { hist = JSON.parse(a.historico || '[]'); } catch {}
  if (!Array.isArray(hist)) hist = [];
  hist.push({ data: agora, descricao: (parcial ? 'Pagamento parcial' : 'Pagamento') + ' · ' + formas.map(f => f.nome || f.forma).join(' + '), valor: -valorPago, pagamento: true });
  if (parcial) {
    db.prepare('UPDATE anotacoes SET valor=?, historico=? WHERE id=?').run(r2(saldo - valorPago), JSON.stringify(hist), a.id);
  } else {
    db.prepare('UPDATE anotacoes SET pago=1, valor=0, pago_em=?, pago_formas=?, historico=? WHERE id=?').run(agora, JSON.stringify(formas), JSON.stringify(hist), a.id);
  }
  try { manut.logAcao(parcial ? 'anotação paga parcial' : 'anotação paga', 'financeiro', { id: a.id, valorPago, restante: r2(saldo - valorPago) }, 'pdv'); } catch {}
  res.json(anotacaoFront(db.prepare('SELECT * FROM anotacoes WHERE id=?').get(a.id)));
});
app.delete('/api/anotacoes/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM anotacoes WHERE id=?').get(+req.params.id);
  if (!a) return res.json({ ok: true });
  try { for (const m of movsDaReferencia('anotacao', a.id)) if (m.situacao !== 'estornado') estornarMovimento(m.id, 'anotação removida', 'sistema'); } catch {}
  db.prepare('DELETE FROM anotacoes WHERE id=?').run(a.id);
  try { manut.logAcao('anotação removida', 'financeiro', { id: a.id }, 'pdv'); } catch {}
  res.json({ ok: true });
});

// ── Produção / Rendimento (Fase 19) ──
// Registra a produção (entrada consumida + saída gerada), calcula custo, SOBE o estoque do
// produto final (com movimento auditado) e baixa insumos/produtos consumidos (best-effort).
function registrarProducao(d) {
  const agora = new Date().toISOString();
  const entrada = Array.isArray(d.entrada) ? d.entrada : [];
  const saida = Array.isArray(d.saida) ? d.saida : [];
  const custoEntradas = entrada.reduce((s, it) => s + (it.subtotal != null ? +it.subtotal : (+it.quantidade || 0) * (+it.custo_unitario || 0)), 0);
  const custoTotal = d.custo_total != null ? +d.custo_total : custoEntradas;
  const qtdSaidaTotal = saida.reduce((s, it) => s + (+it.quantidade || 0), 0);
  const reflexos = { estoqueSubiu: [], insumosConsumidos: 0, produtosBaixados: 0 };
  let producaoId;
  db.exec('BEGIN');
  try {
    producaoId = db.prepare('INSERT INTO producoes (data,tipo,descricao,origem,custo_total,obs,criado_em) VALUES (?,?,?,?,?,?,?)')
      .run(d.data || agora, d.tipo || 'rendimento', d.descricao || '', d.origem || 'manual', custoTotal, d.obs || '', agora).lastInsertRowid;
    const insEnt = db.prepare('INSERT INTO producoes_itens_entrada (producao_id,tipo_item,referencia_id,descricao,quantidade,unidade,custo_unitario,subtotal) VALUES (?,?,?,?,?,?,?,?)');
    for (const it of entrada) {
      const qtd = +it.quantidade || 0, cu = +it.custo_unitario || 0, sub = it.subtotal != null ? +it.subtotal : qtd * cu;
      insEnt.run(producaoId, it.tipo_item || 'materia', it.referencia_id != null ? String(it.referencia_id) : null, it.descricao || '', qtd, it.unidade || '', cu, sub);
      if (it.tipo_item === 'insumo' && it.referencia_id) { if (movimentarInsumo(+it.referencia_id, 'consumo', qtd, cu, 'producao', 'producao#' + producaoId)) reflexos.insumosConsumidos++; }
      else if (it.tipo_item === 'produto' && it.referencia_id) { const pr = db.prepare('SELECT codigo FROM produtos WHERE codigo = ?').get(String(it.referencia_id)); if (pr) { registrarMovimento(pr.codigo, 'saida', { quantidade: qtd, motivo: 'consumo produção', referencia: 'producao#' + producaoId }); reflexos.produtosBaixados++; } }
    }
    const insSai = db.prepare('INSERT INTO producoes_itens_saida (producao_id,produto_codigo,descricao,quantidade,unidade,custo_unitario_resultante,subtotal_resultante) VALUES (?,?,?,?,?,?,?)');
    for (const it of saida) {
      const qtd = +it.quantidade || 0;
      const cod = it.produto_codigo || it.codigo;
      const cur = it.custo_unitario_resultante != null ? +it.custo_unitario_resultante : (qtdSaidaTotal > 0 ? custoTotal / qtdSaidaTotal : 0); // rateio simples por quantidade
      insSai.run(producaoId, cod ? String(cod) : '', it.descricao || '', qtd, it.unidade || '', cur, qtd * cur);
      if (cod) {
        const existe = db.prepare('SELECT codigo FROM produtos WHERE codigo = ?').get(String(cod));
        if (!existe) upsertProduto({ codigo: String(cod), nome: it.descricao || String(cod), precoVenda: +it.preco_venda || 0, precoCompra: cur, estoque: 0, departamento: d.departamento || '', fornecedor: d.fornecedor || '' });
        else {
          const upd = { precoCompra: cur, atualizado_em: agora };
          if (+it.preco_venda > 0) upd.precoVenda = +it.preco_venda;
          const sets = Object.keys(upd).map(k => `${k} = ?`).join(', ');
          db.prepare(`UPDATE produtos SET ${sets} WHERE codigo = ?`).run(...Object.values(upd), String(cod));
        }
        if (qtd > 0) { registrarMovimento(String(cod), 'entrada', { quantidade: qtd, motivo: 'produção #' + producaoId, referencia: 'producao#' + producaoId }); reflexos.estoqueSubiu.push({ codigo: String(cod), qtd }); }
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  manut.logAcao('produção criada', 'producao', { id: producaoId, tipo: d.tipo || 'rendimento', custo_total: custoTotal, saidas: saida.length }, 'operacao');
  if (reflexos.estoqueSubiu.length) manut.logAcao('produção refletida em estoque', 'estoque', { producao_id: producaoId, produtos: reflexos.estoqueSubiu.length }, 'operacao');
  return { id: producaoId, custo_total: custoTotal, custo_unitario_medio: qtdSaidaTotal > 0 ? custoTotal / qtdSaidaTotal : 0, reflexos };
}
app.get('/api/producoes', (req, res) => { const f = faixaData(req.query.de, req.query.ate); res.json(db.prepare(`SELECT * FROM producoes WHERE 1=1${f.where} ORDER BY id DESC LIMIT 500`).all(...f.args)); });
app.get('/api/producoes/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM producoes WHERE id = ?').get(+req.params.id);
  if (!p) return res.status(404).json({ erro: 'Produção não encontrada.' });
  p.entrada = db.prepare('SELECT * FROM producoes_itens_entrada WHERE producao_id = ? ORDER BY id').all(p.id);
  p.saida = db.prepare('SELECT * FROM producoes_itens_saida WHERE producao_id = ? ORDER BY id').all(p.id);
  res.json(p);
});
app.post('/api/producoes', (req, res) => {
  try {
    const r = registrarProducao(req.body || {});
    // registra o gasto da matéria-prima em `compras` (pra o financeiro/dashboard enxergar), se pedido
    if (req.body && req.body.registrar_compra && r.custo_total > 0) {
      db.prepare('INSERT INTO compras (data,numNota,fornecedor,descricao,total,origem,detalhes,criado_em) VALUES (?,?,?,?,?,?,?,?)')
        .run(new Date().toISOString(), req.body.numNota || '', req.body.fornecedor || '', req.body.descricao || 'Produção/rendimento', r.custo_total, 'producao', JSON.stringify({ producao_id: r.id }), new Date().toISOString());
    }
    res.json(r);
  } catch (e) { manut.logErro('producao', e); res.status(500).json({ erro: e.message }); }
});

// ── Custo por produto (Fase 19) — custo = precoCompra (compra mais recente/produção) ──
app.get('/api/custos', (req, res) => {
  res.json(db.prepare(`SELECT codigo, nome, precoVenda, COALESCE(precoCompra,0) custo,
    CASE WHEN precoVenda > 0 THEN (precoVenda - COALESCE(precoCompra,0)) / precoVenda ELSE 0 END margem
    FROM produtos ORDER BY nome`).all());
});

/* ══ FICHA TÉCNICA / RECEITA (Fase 21) — helpers + endpoints ═══════════════════ */
// custo unitário de um item referenciado (insumo → custo médio; produto → precoCompra)
function custoRefUnitario(tipo, referenciaId) {
  if (tipo === 'insumo') { const i = db.prepare('SELECT custo_unitario FROM insumos WHERE id = ?').get(+referenciaId); return i ? (+i.custo_unitario || 0) : 0; }
  if (tipo === 'produto') { const p = db.prepare('SELECT precoCompra FROM produtos WHERE codigo = ?').get(String(referenciaId)); return p ? (+p.precoCompra || 0) : 0; }
  return 0;
}
// ficha de um produto + custo estimado (soma dos itens × custo unitário do referenciado)
function fichaDoProduto(codigo) {
  const f = db.prepare('SELECT * FROM produtos_ficha WHERE produto_codigo = ?').get(String(codigo));
  if (!f) return null;
  const itens = db.prepare('SELECT * FROM produtos_ficha_itens WHERE ficha_id = ? ORDER BY id').all(f.id);
  let custo = 0;
  for (const it of itens) { it.custo_unitario_ref = custoRefUnitario(it.tipo_item, it.referencia_id); it.subtotal_custo = (+it.quantidade || 0) * it.custo_unitario_ref; custo += it.subtotal_custo; }
  return { ficha: f, itens, custoEstimado: custo };
}
// Baixa os insumos da ficha de cada item vendido (proporcional à qtd). Auditável (insumos_movimentos).
// NUNCA lança erro (a venda não quebra por isso). Retorna { baixados, avisos }.
function baixarInsumosDaVenda(itens, vendaId) {
  const out = { baixados: 0, avisos: [] };
  for (const vit of (itens || [])) {
    const cod = vit.codigo || vit.cod || vit.produto_codigo;
    const qVend = +vit.qtd || +vit.quantidade || 0;
    if (!cod || qVend <= 0) continue;
    const fp = fichaDoProduto(cod);
    if (!fp || !fp.ficha.ativo) continue;                 // sem ficha (ou inativa) → segue normal
    for (const item of fp.itens) {
      if (item.tipo_item !== 'insumo') continue;           // baixa só insumos (produto-componente = melhoria futura)
      const insId = +item.referencia_id;
      const ins = db.prepare('SELECT id, nome, saldo, qtd FROM insumos WHERE id = ?').get(insId);
      if (!ins) continue;
      const precisa = (+item.quantidade || 0) * qVend;
      if (precisa <= 0) continue;
      const saldo = (ins.saldo != null) ? +ins.saldo : (+ins.qtd || 0);
      if (item.obrigatorio && saldo < precisa - 1e-9) {    // faltou insumo obrigatório → avisa + log (não bloqueia aqui)
        out.avisos.push({ insumo_id: insId, insumo: ins.nome, precisa, saldo, produto: cod });
        manut.logAcao('alerta de falta de insumo', 'insumos', { insumo_id: insId, insumo: ins.nome, precisa, saldo, produto: cod, venda: vendaId }, 'operacao');
      }
      movimentarInsumo(insId, 'consumo', precisa, null, 'venda', 'venda#' + vendaId);
      out.baixados++;
    }
  }
  if (out.baixados) manut.logAcao('baixa automática de insumos', 'insumos', { venda: vendaId, itens: out.baixados, avisos: out.avisos.length }, 'operacao');
  return out;
}
// Pré-checagem (sem baixar) — quais insumos faltariam pra vender esses itens.
function checarInsumosFicha(itens) {
  const faltas = [];
  for (const vit of (itens || [])) {
    const cod = vit.codigo || vit.cod; const qVend = +vit.qtd || +vit.quantidade || 0;
    const fp = cod ? fichaDoProduto(cod) : null;
    if (!fp || !fp.ficha.ativo) continue;
    for (const item of fp.itens) {
      if (item.tipo_item !== 'insumo') continue;
      const ins = db.prepare('SELECT id,nome,saldo,qtd FROM insumos WHERE id = ?').get(+item.referencia_id);
      if (!ins) continue;
      const precisa = (+item.quantidade || 0) * qVend;
      const saldo = (ins.saldo != null) ? +ins.saldo : (+ins.qtd || 0);
      if (precisa > saldo + 1e-9) faltas.push({ insumo: ins.nome, produto: cod, precisa, saldo, obrigatorio: !!item.obrigatorio });
    }
  }
  return faltas;
}

app.get('/api/produtos/:codigo/ficha', (req, res) => {
  const fp = fichaDoProduto(req.params.codigo);
  if (!fp) return res.json({ existe: false, produto_codigo: req.params.codigo, ativo: true, itens: [], custoEstimado: 0 });
  res.json({ existe: true, produto_codigo: req.params.codigo, ativo: !!fp.ficha.ativo, nome: fp.ficha.nome, itens: fp.itens, custoEstimado: fp.custoEstimado });
});
app.put('/api/produtos/:codigo/ficha', (req, res) => {
  const codigo = String(req.params.codigo);
  if (!db.prepare('SELECT codigo FROM produtos WHERE codigo = ?').get(codigo)) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const d = req.body || {};
  const itens = Array.isArray(d.itens) ? d.itens : [];
  const agora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    let f = db.prepare('SELECT * FROM produtos_ficha WHERE produto_codigo = ?').get(codigo);
    if (!f) { const info = db.prepare('INSERT INTO produtos_ficha (produto_codigo,nome,ativo,criado_em,atualizado_em) VALUES (?,?,?,?,?)').run(codigo, d.nome || '', d.ativo === false ? 0 : 1, agora, agora); f = { id: info.lastInsertRowid }; }
    else db.prepare('UPDATE produtos_ficha SET nome=?, ativo=?, atualizado_em=? WHERE id=?').run(d.nome || '', d.ativo === false ? 0 : 1, agora, f.id);
    db.prepare('DELETE FROM produtos_ficha_itens WHERE ficha_id = ?').run(f.id);
    const ins = db.prepare('INSERT INTO produtos_ficha_itens (ficha_id,tipo_item,referencia_id,descricao,quantidade,unidade,obrigatorio,obs) VALUES (?,?,?,?,?,?,?,?)');
    for (const it of itens) ins.run(f.id, it.tipo_item === 'produto' ? 'produto' : 'insumo', it.referencia_id != null ? String(it.referencia_id) : null, it.descricao || '', +it.quantidade || 0, it.unidade || '', it.obrigatorio === false ? 0 : 1, it.obs || '');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ erro: e.message }); }
  const fp = fichaDoProduto(codigo);
  // custo real: aplica o custo da ficha no produto (precoCompra) — a não ser que peçam aplicar_custo=false
  if (d.aplicar_custo !== false && fp && fp.itens.length) db.prepare('UPDATE produtos SET precoCompra=?, atualizado_em=? WHERE codigo=?').run(fp.custoEstimado, agora, codigo);
  manut.logAcao('ficha técnica salva', 'produtos', { produto: codigo, itens: itens.length, custo: fp ? fp.custoEstimado : 0, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true, produto_codigo: codigo, ativo: !!(fp && fp.ficha.ativo), itens: fp ? fp.itens : [], custoEstimado: fp ? fp.custoEstimado : 0 });
});
app.get('/api/fichas', (req, res) => {
  res.json(db.prepare(`SELECT f.produto_codigo, f.ativo, p.nome, p.precoVenda, p.precoCompra,
    (SELECT COUNT(*) FROM produtos_ficha_itens i WHERE i.ficha_id = f.id) itens
    FROM produtos_ficha f LEFT JOIN produtos p ON p.codigo = f.produto_codigo ORDER BY p.nome`).all());
});
app.post('/api/insumos/checar-ficha', (req, res) => {
  const itens = Array.isArray(req.body && req.body.itens) ? req.body.itens : (Array.isArray(req.body) ? req.body : []);
  const faltas = checarInsumosFicha(itens);
  res.json({ modo: getConfig('insumo_falta_modo', 'avisar'), ok: faltas.length === 0, faltas });
});

// ── Importações (idempotentes; não apagam o localStorage) ──
app.post('/api/vendas/importar-localstorage', (req, res) => {
  const lista = Array.isArray(req.body && req.body.vendas) ? req.body.vendas : [];
  let importadas = 0, ignoradas = 0;
  db.exec('BEGIN');
  try {
    for (const v of lista) {
      const data = v.hora || v.data || new Date().toISOString();
      const total = +v.total || 0;
      const dup = db.prepare('SELECT id FROM vendas WHERE data = ? AND ABS(total - ?) < 0.001').get(data, total);
      if (dup) { ignoradas++; continue; }
      const info = db.prepare('INSERT INTO vendas (numero,data,total,subtotal,troco,status,origem,cliente_id,criado_em) VALUES (?,?,?,?,?,?,?,?,?)')
        .run('', data, total, total, +v.troco || 0, v.cancelada ? 'cancelada' : 'concluida', 'pdv', (v.fiado && v.fiado.clienteId) || null, data);
      const id = info.lastInsertRowid;
      db.prepare('UPDATE vendas SET numero = ? WHERE id = ?').run(String(id), id);
      const insItem = db.prepare('INSERT INTO vendas_itens (venda_id,produto_codigo,codigo,nome,qtd,preco,subtotal,pacote,unidConsumo,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)');
      for (const it of (v.itens || [])) insItem.run(id, it.cod || '', it.cod || '', it.nome || '', +it.qtd || 0, +it.preco || 0, (+it.qtd * +it.preco) || 0, it.pacote ? 1 : 0, +it.unidConsumo || 1, data);
      db.prepare('INSERT INTO pagamentos (venda_id,forma,valor,cliente_id,detalhes,criado_em) VALUES (?,?,?,?,?,?)')
        .run(id, 'Importado', total, (v.fiado && v.fiado.clienteId) || null, JSON.stringify({ descricao: v.pgto || '' }), data);
      importadas++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ erro: e.message }); }
  const rel = { importadas, ignoradas };
  console.log('📥 Importação de vendas:', rel);
  res.json(rel);
});
app.post('/api/compras/importar-localstorage', (req, res) => {
  const lista = Array.isArray(req.body && req.body.compras) ? req.body.compras : [];
  let importadas = 0, ignoradas = 0;
  for (const c of lista) {
    const data = c.hora || c.data || new Date().toISOString();
    const total = +c.total || 0;
    const dup = db.prepare('SELECT id FROM compras WHERE data = ? AND ABS(total - ?) < 0.001 AND numNota = ?').get(data, total, c.numNota || '');
    if (dup) { ignoradas++; continue; }
    db.prepare('INSERT INTO compras (data,numNota,fornecedor,descricao,total,origem,detalhes,criado_em) VALUES (?,?,?,?,?,?,?,?)')
      .run(data, c.numNota || '', c.fornecedor || '', c.nome || c.descricao || '', total, c.codigo === '(rendimento)' ? 'rendimento' : 'produto', JSON.stringify({ codigo: c.codigo, qtd: c.qtd }), data);
    importadas++;
  }
  const rel = { importadas, ignoradas };
  console.log('📥 Importação de compras:', rel);
  res.json(rel);
});
app.post('/api/insumos/importar-localstorage', (req, res) => {
  const lista = Array.isArray(req.body && req.body.insumos) ? req.body.insumos : [];
  let importados = 0, ignorados = 0;
  for (const i of lista) {
    const data = i.hora || i.criado_em || new Date().toISOString();
    const custoTotal = +i.custo_total || +i.custo || 0, qtd = +i.qtd || 0;
    const dup = db.prepare('SELECT id FROM insumos WHERE nome = ? AND ABS(custo_total - ?) < 0.001 AND criado_em = ?').get(i.nome || '', custoTotal, data);
    if (dup) { ignorados++; continue; }
    db.prepare('INSERT INTO insumos (nome,qtd,custo_total,custo_unitario,criado_em) VALUES (?,?,?,?,?)')
      .run(i.nome || '', qtd, custoTotal, qtd > 0 ? custoTotal / qtd : custoTotal, data);
    importados++;
  }
  const rel = { importados, ignorados };
  console.log('📥 Importação de insumos:', rel);
  res.json(rel);
});

/* ═══════════════════════════════════════════════════════════════════════════
   IA — camada extraída pra backend/ia/ (Fase 2)
   Aqui o server.js só cria a tabela da memória, INJETA as dependências (banco +
   funções de pedido/cliente/estado da loja) e recebe de volta o orquestrador.
   Toda a lógica (config, memória, prompt, tools, providers) mora em backend/ia/.
   Ver 14_REFACTOR_IA_FASE2.md.
   ═══════════════════════════════════════════════════════════════════════════ */
// tabela da memória da IA (conversas por telefone) — criada aqui, no setup do banco
db.exec('CREATE TABLE IF NOT EXISTS conversas_ia (telefone TEXT PRIMARY KEY, historico TEXT, atualizado_em TEXT)');
try { db.exec('ALTER TABLE conversas_ia ADD COLUMN finalizado_em TEXT'); } catch {} // hora do fecho do pedido (janela de alteração)
const ia = require('./backend/ia/orchestrator')({
  db,
  criarPedidoNoBanco, alterarUltimoPedidoIA,     // AÇÃO das tools de pedido (ficam no server.js)
  buscarClienteDelivery, salvarClienteDelivery,   // cadastro do cliente do delivery
  lojaEstaAberta, soRetirada,                     // estado da loja
  // Fase 3 — CONSULTAS de contexto (só leitura) pras novas tools de consulta da IA:
  ultimoPedidoDoTelefone, pedidoAbertoDoTelefone, produtosDisponiveis,
});
ia.logBoot();                                      // log de boot (provider principal/fallback)
const iaAtiva = ia.iaAtiva;                         // usado pelo listener do WhatsApp e pelo webhook
const processarMensagemIA = ia.processarMensagemIA;

/* Cadastro de clientes do Delivery — importado do relatório do BotConversa (nome/endereço/
   forma de pagamento já conhecidos), e mantido atualizado a cada novo pedido confirmado.
   Existe pra IA não precisar perguntar endereço de novo pra quem já é cliente. */
db.exec('CREATE TABLE IF NOT EXISTS clientes_delivery (telefone TEXT PRIMARY KEY, nome TEXT, endereco TEXT, formaPagamento TEXT, atualizado_em TEXT)');
// Fase 18: a FONTE agora é `clientes` (unificado). Mantém o MESMO contrato de retorno
// que a IA e o painel já esperam (nome, endereco, formaPagamento, atualizado_em) e acrescenta
// os campos unificados (id, bairro, obs, conhecido). Cai no clientes_delivery legado só se
// ainda não houver cliente unificado (ex.: antes da conciliação).
function buscarClienteDelivery(telefone) {
  const c = resolverClienteUnificado(telefone);
  if (c) {
    return {
      id: c.id, telefone: c.telefone || telefone, nome: c.nome, endereco: c.endereco || '',
      bairro: c.bairro || '', obs: c.obs || '', formaPagamento: c.forma_pagamento || '',
      atualizado_em: c.atualizado_em, conhecido: true, origem: c.origem_principal || null,
    };
  }
  const cd = db.prepare('SELECT * FROM clientes_delivery WHERE telefone = ?').get(telefone);
  return cd ? { telefone: cd.telefone, nome: cd.nome, endereco: cd.endereco, formaPagamento: cd.formaPagamento, atualizado_em: cd.atualizado_em } : null;
}
// Fase 18: grava no cliente unificado (fonte) E espelha no clientes_delivery (legado, sem quebrar
// a lista de clientes do Delivery). O upsert unificado só PREENCHE buracos, nunca sobrescreve.
function salvarClienteDelivery(telefone, nome, endereco, formaPagamento) {
  acharOuCriarClienteUnificado(telefone, { nome, endereco, formaPagamento }, 'delivery');
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

/* ══════════════════════════════════════════════════════════════════════════
   CLIENTES do PDV + FIADO (Fase 8) — fonte principal no SQLite
   Antes viviam só no localStorage (acai_clientes). São o cadastro do BALCÃO e o
   EXTRATO de fiado (compra/pagamento/estorno). Separado do clientes_delivery
   (cadastro do delivery/IA). Saldo NUNCA é guardado — é sempre a soma do extrato.
   ══════════════════════════════════════════════════════════════════════════ */
db.exec(`CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL, telefone TEXT, bairro TEXT, endereco TEXT, obs TEXT,
  criado_em TEXT, atualizado_em TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS clientes_extrato (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,            -- 'compra' | 'pagamento' | 'estorno'
  valor REAL NOT NULL,
  descricao TEXT, formas TEXT, referencia TEXT, criado_em TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_extrato_cliente ON clientes_extrato(cliente_id)');
// Fase 18 — CLIENTE UNIFICADO: amplia `clientes` pra ser a base única (PDV + Delivery + Atendimento).
for (const col of ['telefone_normalizado TEXT', 'origem_principal TEXT', 'forma_pagamento TEXT']) {
  try { db.exec(`ALTER TABLE clientes ADD COLUMN ${col}`); } catch {}
}
db.exec('CREATE INDEX IF NOT EXISTS idx_clientes_telnorm ON clientes(telefone_normalizado)');
// Fase 24 — CRM: aniversário + tags simples (aditivo). Métricas são calculadas (não guardadas).
for (const col of ['nascimento TEXT', 'tags TEXT']) { try { db.exec(`ALTER TABLE clientes ADD COLUMN ${col}`); } catch {} }
// Autorizados: pessoas que podem pegar na conta (fiado) do cliente — nomes separados por vírgula.
try { db.exec(`ALTER TABLE clientes ADD COLUMN autorizados TEXT`); } catch {}
// Movimentação de fidelidade (cashback) — auditável; saldo = soma (crédito − resgate ± ajuste).
db.exec(`CREATE TABLE IF NOT EXISTS fidelidade_movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  tipo TEXT,                 -- 'credito' | 'resgate' | 'ajuste'
  valor REAL,                -- em R$ (cashback); sempre positivo, o tipo diz o sinal
  origem TEXT,               -- 'venda' | 'manual'
  referencia TEXT, descricao TEXT, por TEXT, criado_em TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_fidelidade_cliente ON fidelidade_movimentos(cliente_id)');

// telefone só com dígitos, sem o 55 do país — pra casar cadastros digitados de jeitos diferentes
function soDigitosTel(t) { let d = (t || '').replace(/\D/g, ''); if (d.length > 11 && d.startsWith('55')) d = d.slice(2); return d; }
/* ── CHAVE CANÔNICA DE TELEFONE (Fase 18) — reconhece a mesma pessoa em qualquer formato ──
   Passos: tira tudo que não é dígito; remove o DDI 55; e devolve DDD (2) + os 8 últimos
   dígitos (o "assinante"), IGNORANDO o 9 extra do celular. Assim casam:
   +55 (91) 99220-7690 · 5591992207690 · 91992207690 · 9192207690 → "9192207690".
   Sem DDD reconhecível (menos de 10 dígitos), usa o que tiver. É a MESMA regra usada em
   clientes, delivery, WhatsApp, pedidos e migração. Ver 31_CLIENTE_UNIFICADO_FASE18.md. */
function normalizarTelefone(t) {
  let d = String(t == null ? '' : t).replace(/\D/g, '');
  if (!d) return '';
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2); // tira o DDI do Brasil
  if (d.length >= 10) return d.slice(0, 2) + d.slice(-8);   // DDD + 8 finais (ignora o 9 do celular)
  return d;
}
// mapeia um lançamento do banco pro formato que o frontend já usa (desc/data/formasPagas)
function extratoParaFront(l) {
  let formasPagas = []; try { formasPagas = l.formas ? JSON.parse(l.formas) : []; } catch {}
  return { id: l.id, tipo: l.tipo, valor: l.valor, desc: l.descricao || '', data: l.criado_em, referencia: l.referencia || '', formasPagas };
}
function lancamentosDoCliente(clienteId) {
  return db.prepare('SELECT * FROM clientes_extrato WHERE cliente_id = ? ORDER BY id ASC').all(clienteId).map(extratoParaFront);
}
function clienteParaFront(c, comExtrato) {
  const base = { id: c.id, nome: c.nome, telefone: c.telefone || '', bairro: c.bairro || '', endereco: c.endereco || '', obs: c.obs || '',
    nascimento: c.nascimento || '', tags: c.tags || '', autorizados: c.autorizados || '', origem: c.origem_principal || '', criadoEm: c.criado_em };
  if (comExtrato) base.lancamentos = lancamentosDoCliente(c.id);
  return base;
}
// saldo = soma do extrato (compra soma; pagamento/estorno subtraem) — mesma regra do frontend
function saldoDoClienteDb(clienteId) {
  return db.prepare('SELECT tipo, valor FROM clientes_extrato WHERE cliente_id = ?').all(clienteId)
    .reduce((s, l) => s + (l.tipo === 'compra' ? l.valor : -l.valor), 0);
}

/* ══ CRM / FIDELIDADE (Fase 24) — métricas CALCULADAS (nunca guardadas, sempre da operação real) ══ */
function crmConfig() {
  return {
    diasInativo: +getConfig('crm_dias_inativo', '30') || 30,
    vipGasto: +getConfig('crm_vip_gasto', '300') || 300,
    vipCompras: +getConfig('crm_vip_compras', '10') || 10,
    recorrenteCompras: +getConfig('crm_recorrente_compras', '3') || 3,
    fidelidadeModo: getConfig('fidelidade_modo', 'cashback'),
    fidelidadePercentual: +getConfig('fidelidade_percentual', '5') || 0,
  };
}
// compras do cliente = vendas concluídas + pedidos não-cancelados vinculados (Fase 10/18)
function metricasDeTodosClientes() {
  const rows = db.prepare(`SELECT cliente_id, COUNT(*) qtd, COALESCE(SUM(total),0) total, MAX(dt) ultima FROM (
      SELECT cliente_id, total, data AS dt FROM vendas WHERE status='concluida' AND cliente_id IS NOT NULL
      UNION ALL
      SELECT cliente_id, total, criado AS dt FROM pedidos WHERE status <> 'cancelado' AND cliente_id IS NOT NULL
    ) GROUP BY cliente_id`).all();
  const map = new Map(); for (const r of rows) map.set(r.cliente_id, r); return map;
}
function metricasDoCliente(clienteId) {
  return db.prepare(`SELECT COUNT(*) qtd, COALESCE(SUM(total),0) total, MAX(dt) ultima FROM (
      SELECT total, data AS dt FROM vendas WHERE status='concluida' AND cliente_id = ?
      UNION ALL
      SELECT total, criado AS dt FROM pedidos WHERE status <> 'cancelado' AND cliente_id = ?
    )`).get(clienteId, clienteId) || { qtd: 0, total: 0, ultima: null };
}
// deriva as métricas + o STATUS do cliente a partir das compras e das regras (config)
function metricasCalculadas(m, cfg) {
  const qtd = m ? +m.qtd || 0 : 0, total = m ? +m.total || 0 : 0, ultima = m ? m.ultima : null;
  const dias = ultima ? Math.floor((Date.now() - new Date(ultima).getTime()) / 86400e3) : null;
  let status;
  if (qtd === 0) status = 'novo';
  else if (dias != null && dias > cfg.diasInativo) status = 'inativo';
  else if (total >= cfg.vipGasto || qtd >= cfg.vipCompras) status = 'vip';
  else if (qtd >= cfg.recorrenteCompras) status = 'recorrente';
  else status = 'novo';
  return { qtdCompras: qtd, totalGasto: total, ticketMedio: qtd ? total / qtd : 0, ultimaCompra: ultima, diasSemComprar: dias, status };
}
// dia/mês do aniversário a partir de 'YYYY-MM-DD' ou 'MM-DD'
function aniversarioMMDD(nasc) {
  if (!nasc) return null;
  const m = String(nasc).match(/(\d{2})-(\d{2})$/); // pega MM-DD do fim
  return m ? (m[1] + '-' + m[2]) : null;
}
// ── Fidelidade (cashback em R$): saldo = crédito − resgate ± ajuste. Nunca guardado. ──
function saldoFidelidade(clienteId) {
  return db.prepare('SELECT tipo, valor FROM fidelidade_movimentos WHERE cliente_id = ?').all(clienteId)
    .reduce((s, l) => s + (l.tipo === 'credito' ? l.valor : l.tipo === 'resgate' ? -l.valor : l.valor), 0);
}
function movimentarFidelidade(clienteId, tipo, valor, origem, referencia, descricao, por) {
  let v = +valor || 0;
  if (tipo === 'credito' || tipo === 'resgate') v = Math.abs(v); // magnitude; o tipo diz o sinal (ajuste pode ser negativo)
  db.prepare('INSERT INTO fidelidade_movimentos (cliente_id,tipo,valor,origem,referencia,descricao,por,criado_em) VALUES (?,?,?,?,?,?,?,?)')
    .run(clienteId, tipo, v, origem || '', referencia || '', descricao || '', por || '', new Date().toISOString());
  return saldoFidelidade(clienteId);
}
// últimas compras (vendas + pedidos) do cliente, pra tela de detalhe
function comprasDoCliente(clienteId, limite = 8) {
  // `id` incluído (aditivo) pra o detalhe do cliente abrir o relatório de itens da compra
  return db.prepare(`SELECT * FROM (
      SELECT id, 'venda' tipo, numero, total, data dt, status FROM vendas WHERE status='concluida' AND cliente_id = ?
      UNION ALL
      SELECT id, 'pedido' tipo, numero, total, criado dt, status FROM pedidos WHERE status <> 'cancelado' AND cliente_id = ?
    ) ORDER BY dt DESC LIMIT ?`).all(clienteId, clienteId, limite);
}
// casa um cliente pelos últimos 8 dígitos do telefone (mesma heurística do painel de contexto)
function clientePorTelefoneDigitos(telefone) {
  const alvo = soDigitosTel(telefone).slice(-8);
  if (alvo.length < 8) return null;
  return db.prepare('SELECT * FROM clientes').all().find(c => soDigitosTel(c.telefone).slice(-8) === alvo) || null;
}

/* ── CLIENTE UNIFICADO (Fase 18) — a base `clientes` é a referência única ────── */
// Acha o cliente principal pela CHAVE normalizada (indexada). Fallback varre os que
// ainda não têm a chave gravada (pré-migração) — some depois da conciliação.
function resolverClienteUnificado(telefone) {
  const norm = normalizarTelefone(telefone);
  if (!norm) return null;
  const c = db.prepare('SELECT * FROM clientes WHERE telefone_normalizado = ? ORDER BY id LIMIT 1').get(norm);
  if (c) return c;
  return db.prepare("SELECT * FROM clientes WHERE telefone_normalizado IS NULL OR telefone_normalizado = ''").all()
    .find(x => normalizarTelefone(x.telefone) === norm) || null;
}
// Acha OU cria o cliente unificado a partir de um contato (delivery/atendimento/pedido).
// Ao achar, preenche buracos SEM sobrescrever o que já existe (conservador). Devolve {cliente, criado}.
function acharOuCriarClienteUnificado(telefone, dados = {}, origem = 'delivery') {
  const norm = normalizarTelefone(telefone);
  if (!norm) return { cliente: null, criado: false };
  const agora = new Date().toISOString();
  const existente = resolverClienteUnificado(telefone);
  if (existente) {
    const upd = {};
    if ((!existente.nome || existente.nome === '') && dados.nome) upd.nome = dados.nome;
    if (!existente.endereco && dados.endereco) upd.endereco = dados.endereco;
    if (!existente.bairro && dados.bairro) upd.bairro = dados.bairro;
    if (!existente.forma_pagamento && dados.formaPagamento) upd.forma_pagamento = dados.formaPagamento;
    if (!existente.telefone_normalizado) upd.telefone_normalizado = norm;
    if (Object.keys(upd).length) {
      const sets = Object.keys(upd).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE clientes SET ${sets}, atualizado_em = ? WHERE id = ?`).run(...Object.values(upd), agora, existente.id);
    }
    return { cliente: db.prepare('SELECT * FROM clientes WHERE id = ?').get(existente.id), criado: false };
  }
  const nome = (dados.nome && String(dados.nome).trim()) || ('Cliente ' + norm.slice(-4));
  const info = db.prepare(`INSERT INTO clientes (nome, telefone, telefone_normalizado, bairro, endereco, obs, forma_pagamento, origem_principal, criado_em, atualizado_em)
                           VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(nome, telefone || '', norm, dados.bairro || '', dados.endereco || '', '', dados.formaPagamento || '', origem, agora, agora);
  return { cliente: db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid), criado: true };
}
// pedidos de um cliente unificado (histórico) — por vínculo cliente_id
function pedidosDoClienteId(clienteId, limite = 10) {
  return db.prepare('SELECT id, numero, itens, valor, taxa, total, pagamento, status, criado, origem FROM pedidos WHERE cliente_id = ? ORDER BY id DESC LIMIT ?').all(clienteId, limite);
}

/* ── Conciliação/migração dos clientes (Fase 18) — SEGURA e IDEMPOTENTE ────────
   NUNCA apaga nada. (1) preenche telefone_normalizado/origem nos clientes existentes;
   (2) traz os clientes_delivery pra base unificada (vincula se já existir pelo telefone,
   cria se não); (3) preenche pedidos.cliente_id. Conflitos (mesmo telefone em 2 cadastros)
   NÃO são mesclados — apenas contados e documentados (conservador). Roda 1x no boot
   (guardada por config) e pode ser reexecutada via POST /api/clientes/conciliar (admin). */
function conciliarClientes(origemLog = 'boot') {
  const rel = { clientesNormalizados: 0, pedidosVinculados: 0, clientesCriadosDePedido: 0, delivEnriquecidos: 0, duplicadosMesmoTelefone: 0 };
  db.exec('BEGIN');
  try {
    // 1) backfill nos clientes existentes (chave normalizada + origem 'pdv' por padrão)
    for (const c of db.prepare('SELECT id, telefone, telefone_normalizado, origem_principal FROM clientes').all()) {
      const norm = normalizarTelefone(c.telefone);
      if (norm && norm !== (c.telefone_normalizado || '')) { db.prepare('UPDATE clientes SET telefone_normalizado = ? WHERE id = ?').run(norm, c.id); rel.clientesNormalizados++; }
      if (!c.origem_principal) db.prepare("UPDATE clientes SET origem_principal = 'pdv' WHERE id = ?").run(c.id);
    }
    rel.duplicadosMesmoTelefone = db.prepare("SELECT COUNT(*) n FROM (SELECT telefone_normalizado FROM clientes WHERE telefone_normalizado <> '' GROUP BY telefone_normalizado HAVING COUNT(*) > 1)").get().n;
    // 2) pedidos → cliente_id: acha o cliente unificado (ou cria A PARTIR DO PEDIDO). Só telefones
    //    que REALMENTE fizeram pedido viram cliente — NÃO importamos a agenda inteira do WhatsApp
    //    (clientes_delivery é um cache grande de contatos; ela continua sendo o fallback de leitura).
    for (const p of db.prepare("SELECT id, telefone, cliente, endereco, bairro, origem FROM pedidos WHERE cliente_id IS NULL AND telefone IS NOT NULL AND telefone <> ''").all()) {
      const r = acharOuCriarClienteUnificado(p.telefone, { nome: p.cliente, endereco: p.endereco, bairro: p.bairro }, p.origem === 'ia' ? 'atendimento' : 'delivery');
      if (r.cliente) {
        db.prepare('UPDATE pedidos SET cliente_id = ? WHERE id = ?').run(r.cliente.id, p.id);
        rel.pedidosVinculados++;
        if (r.criado) rel.clientesCriadosDePedido++;
      }
    }
    // 3) enriquece (sem criar) os clientes já existentes com o que o clientes_delivery tiver a mais
    for (const cd of db.prepare("SELECT * FROM clientes_delivery WHERE telefone IS NOT NULL AND telefone <> ''").all()) {
      const norm = normalizarTelefone(cd.telefone);
      if (!norm) continue;
      const existente = db.prepare('SELECT * FROM clientes WHERE telefone_normalizado = ? ORDER BY id LIMIT 1').get(norm);
      if (!existente) continue; // não cria — contato sem pedido fica só no cache de delivery
      const upd = {};
      if (!existente.endereco && cd.endereco) upd.endereco = cd.endereco;
      if (!existente.forma_pagamento && cd.formaPagamento) upd.forma_pagamento = cd.formaPagamento;
      if ((!existente.nome || existente.nome === '') && cd.nome) upd.nome = cd.nome;
      if (Object.keys(upd).length) {
        const sets = Object.keys(upd).map(k => `${k} = ?`).join(', ');
        db.prepare(`UPDATE clientes SET ${sets}, atualizado_em = ? WHERE id = ?`).run(...Object.values(upd), new Date().toISOString(), existente.id);
        rel.delivEnriquecidos++;
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  manut.logAcao('conciliação de clientes', 'clientes', { ...rel, origem: origemLog }, 'migracao');
  return rel;
}
// roda uma vez (idempotente) — guardada por flag de config; nunca derruba o boot
if (getConfig('clientes_unificados_v1', '0') !== '1') {
  try { console.log('🔗 Fase 18 — conciliando clientes:', conciliarClientes('boot')); setConfig('clientes_unificados_v1', '1'); }
  catch (e) { console.log('⚠️ Falha na conciliação de clientes (o sistema segue normal):', e.message); }
}

// ── Endpoints do cliente unificado (Fase 18) ──
app.get('/api/clientes/por-telefone/:telefone', (req, res) => {
  const cli = resolverClienteUnificado(req.params.telefone);
  if (!cli) return res.json({ encontrado: false, telefone: req.params.telefone, telefoneNormalizado: normalizarTelefone(req.params.telefone) });
  res.json({
    encontrado: true,
    cliente: { id: cli.id, nome: cli.nome, telefone: cli.telefone, bairro: cli.bairro || '', endereco: cli.endereco || '', obs: cli.obs || '', formaPagamento: cli.forma_pagamento || '', origem: cli.origem_principal || null },
    saldoFiado: saldoDoClienteDb(cli.id),
    ultimoPedido: ultimoPedidoDoTelefone(req.params.telefone),
    pedidos: pedidosDoClienteId(cli.id, 10),
  });
});
app.get('/api/clientes/:id/pedidos', (req, res) => res.json(pedidosDoClienteId(+req.params.id, 50)));
app.post('/api/clientes/conciliar', (req, res) => {
  if (!req.usuario || req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Só o administrador pode reconciliar clientes.' });
  try { res.json({ ok: true, relatorio: conciliarClientes('manual') }); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/clientes', (req, res) => {
  const q = (req.query.q || '').trim();
  const full = req.query.full === '1';
  const clientes = q
    ? db.prepare('SELECT * FROM clientes WHERE nome LIKE ? OR telefone LIKE ? ORDER BY nome').all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM clientes ORDER BY nome').all();
  res.json(clientes.map(c => clienteParaFront(c, full)));
});
app.get('/api/clientes/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(+req.params.id);
  if (!c) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  res.json(clienteParaFront(c, true));
});
app.post('/api/clientes', (req, res) => {
  const d = req.body || {};
  if (!d.nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  const resultado = idempotente(d.client_request_id, 'cliente', () => {   // fila offline não duplica cliente
    const agora = new Date().toISOString();
    // Fase 18: chave normalizada + origem. Fase 24: aniversário + tags.
    const info = db.prepare('INSERT INTO clientes (nome, telefone, telefone_normalizado, bairro, endereco, obs, origem_principal, nascimento, tags, autorizados, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(d.nome, d.telefone || '', normalizarTelefone(d.telefone), d.bairro || '', d.endereco || '', d.obs || '', d.origem_principal || 'pdv', d.nascimento || '', d.tags || '', d.autorizados || '', agora, agora);
    return clienteParaFront(db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid), true);
  });
  res.json(resultado);
});
app.put('/api/clientes/:id', (req, res) => {
  const id = +req.params.id;
  if (!db.prepare('SELECT id FROM clientes WHERE id = ?').get(id)) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const d = req.body || {};
  // Fase 18: chave normalizada em dia. Fase 24: nascimento/tags (só sobrescreve se vierem no corpo).
  db.prepare('UPDATE clientes SET nome = COALESCE(?, nome), telefone = ?, telefone_normalizado = ?, bairro = ?, endereco = ?, obs = ?, nascimento = COALESCE(?, nascimento), tags = COALESCE(?, tags), autorizados = COALESCE(?, autorizados), atualizado_em = ? WHERE id = ?')
    .run(d.nome != null ? d.nome : null, d.telefone || '', normalizarTelefone(d.telefone), d.bairro || '', d.endereco || '', d.obs || '', d.nascimento != null ? d.nascimento : null, d.tags != null ? d.tags : null, d.autorizados != null ? d.autorizados : null, new Date().toISOString(), id);
  res.json(clienteParaFront(db.prepare('SELECT * FROM clientes WHERE id = ?').get(id), true));
});
app.delete('/api/clientes/:id', (req, res) => {
  const id = +req.params.id;
  db.prepare('DELETE FROM clientes_extrato WHERE cliente_id = ?').run(id);
  db.prepare('DELETE FROM clientes WHERE id = ?').run(id);
  manut.logAcao('exclusão de cliente', 'clientes', { id }, 'admin');
  res.json({ ok: true });
});
app.get('/api/clientes/:id/extrato', (req, res) => res.json(lancamentosDoCliente(+req.params.id)));
app.get('/api/clientes/:id/saldo', (req, res) => res.json({ saldo: saldoDoClienteDb(+req.params.id) }));
app.post('/api/clientes/:id/lancamentos', (req, res) => {
  const id = +req.params.id;
  if (!db.prepare('SELECT id FROM clientes WHERE id = ?').get(id)) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const d = req.body || {};
  if (!d.tipo || d.valor == null) return res.status(400).json({ erro: 'tipo e valor são obrigatórios.' });
  const resultado = idempotente(d.client_request_id, 'pagamento_fiado', () => {   // fila offline não duplica lançamento
    const formas = (d.formas || d.formasPagas) ? JSON.stringify(d.formas || d.formasPagas) : null;
    // Fase 33: 'compra' de fiado é um título a receber — ganha vencimento (informado ou prazo padrão da config).
    let venc = null;
    if (d.tipo === 'compra') {
      if (d.vencimento) venc = String(d.vencimento).slice(0, 10);
      else { const prazo = parseInt(getConfig('cr_prazo_padrao_dias', '0')) || 0; if (prazo > 0) { const dt = new Date(); dt.setDate(dt.getDate() + prazo); venc = dt.toISOString().slice(0, 10); } }
    }
    const info = db.prepare('INSERT INTO clientes_extrato (cliente_id, tipo, valor, descricao, formas, referencia, vencimento, criado_em) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, d.tipo, +d.valor, d.descricao || d.desc || '', formas, d.referencia || '', venc, new Date().toISOString());
    const l = db.prepare('SELECT * FROM clientes_extrato WHERE id = ?').get(info.lastInsertRowid);
    syncFin(sincronizarFinanceiroFiado, info.lastInsertRowid); // Fase 25: recebimento de fiado vira entrada no financeiro
    return { lancamento: extratoParaFront(l), saldo: saldoDoClienteDb(id) };
  });
  res.json(resultado);
});
app.delete('/api/clientes/:id/lancamentos/:lancId', (req, res) => {
  db.prepare('DELETE FROM clientes_extrato WHERE id = ? AND cliente_id = ?').run(+req.params.lancId, +req.params.id);
  syncFin(sincronizarFinanceiroFiado, +req.params.lancId); // Fase 25: some o lançamento → estorna o movimento
  res.json({ ok: true, saldo: saldoDoClienteDb(+req.params.id) });
});

/* ══ CRM / FIDELIDADE — endpoints (Fase 24) ═════════════════════════════════ */
// monta a base de CRM: cada cliente + métricas + status + fidelidade + fiado (calculado, sempre atual)
function listaClientesCRM() {
  const cfg = crmConfig();
  const mets = metricasDeTodosClientes();
  return db.prepare('SELECT * FROM clientes ORDER BY nome').all().map(c => ({
    id: c.id, nome: c.nome, telefone: c.telefone || '', bairro: c.bairro || '', endereco: c.endereco || '',
    obs: c.obs || '', tags: c.tags || '', nascimento: c.nascimento || '', origem: c.origem_principal || '', criado_em: c.criado_em,
    ...metricasCalculadas(mets.get(c.id), cfg),
    aniversarioMMDD: aniversarioMMDD(c.nascimento),
    saldoFidelidade: saldoFidelidade(c.id), fiado: saldoDoClienteDb(c.id),
  }));
}
const mmddDe = (date) => { const d = new Date(date); return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function mmddProximosDias(n) { const set = new Set(); const base = new Date(); for (let i = 0; i < n; i++) { const d = new Date(base); d.setDate(base.getDate() + i); set.add(mmddDe(d)); } return set; }

// Detalhe CRM de um cliente (pra tela reforçada)
app.get('/api/clientes/:id/crm', (req, res) => {
  const id = +req.params.id;
  const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const cfg = crmConfig();
  res.json({
    cliente: clienteParaFront(c, false),
    metricas: metricasCalculadas(metricasDoCliente(id), cfg),
    fiado: saldoDoClienteDb(id),
    fidelidade: { modo: cfg.fidelidadeModo, saldo: saldoFidelidade(id) },
    ultimasCompras: comprasDoCliente(id, 8),
    aniversario: aniversarioMMDD(c.nascimento),
  });
});
// Fidelidade — saldo + movimentos
app.get('/api/clientes/:id/fidelidade', (req, res) => {
  const id = +req.params.id;
  const cfg = crmConfig();
  res.json({ saldo: saldoFidelidade(id), modo: cfg.fidelidadeModo, percentual: cfg.fidelidadePercentual,
    movimentos: db.prepare('SELECT * FROM fidelidade_movimentos WHERE cliente_id = ? ORDER BY id DESC LIMIT 100').all(id) });
});
// Fidelidade — crédito/resgate/ajuste MANUAL (não mexe no caixa; é saldo promocional à parte)
app.post('/api/clientes/:id/fidelidade', (req, res) => {
  const id = +req.params.id, d = req.body || {};
  if (!db.prepare('SELECT id FROM clientes WHERE id = ?').get(id)) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const tipo = ['credito', 'resgate', 'ajuste'].includes(d.tipo) ? d.tipo : null;
  if (!tipo || d.valor == null) return res.status(400).json({ erro: 'tipo (credito|resgate|ajuste) e valor são obrigatórios.' });
  if (tipo === 'resgate' && Math.abs(+d.valor) > saldoFidelidade(id) + 1e-9) return res.status(400).json({ erro: 'Saldo de fidelidade insuficiente pra esse resgate.' });
  const saldo = movimentarFidelidade(id, tipo, +d.valor, 'manual', d.referencia || '', d.descricao || '', (req.usuario || {}).usuario || '');
  manut.logAcao('fidelidade ' + tipo, 'crm', { cliente_id: id, valor: +d.valor, saldo, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true, saldo });
});

// Painel CRM — resumo
app.get('/api/crm/resumo', (req, res) => {
  const cfg = crmConfig();
  const lista = listaClientesCRM();
  const hoje = mmddDe(new Date()), semana = mmddProximosDias(7);
  const resumo = {
    totalClientes: lista.length,
    ativos: lista.filter(c => c.qtdCompras > 0 && c.status !== 'inativo').length,
    sumidos: lista.filter(c => c.status === 'inativo').length,
    vips: lista.filter(c => c.status === 'vip').length,
    novos: lista.filter(c => c.status === 'novo' && c.qtdCompras > 0).length,
    aniversariantesHoje: lista.filter(c => c.aniversarioMMDD === hoje).length,
    aniversariantesSemana: lista.filter(c => c.aniversarioMMDD && semana.has(c.aniversarioMMDD)).length,
    comFiado: lista.filter(c => c.fiado > 0.001).length,
    fidelidadeTotal: Math.round(lista.reduce((s, c) => s + (c.saldoFidelidade || 0), 0) * 100) / 100,
    diasInativo: cfg.diasInativo,
  };
  res.json(resumo);
});
// Lista de clientes com filtros (pra painel e campanhas)
app.get('/api/crm/clientes', (req, res) => {
  const q = req.query;
  const semana = mmddProximosDias(7), hoje = mmddDe(new Date());
  let lista = listaClientesCRM();
  if (q.status) lista = lista.filter(c => c.status === q.status);
  if (q.bairro) lista = lista.filter(c => (c.bairro || '').toLowerCase().includes(String(q.bairro).toLowerCase()));
  if (q.busca) { const t = String(q.busca).toLowerCase(); lista = lista.filter(c => (c.nome || '').toLowerCase().includes(t) || (c.telefone || '').includes(t)); }
  if (q.sumido === '1') lista = lista.filter(c => c.status === 'inativo');
  if (q.comFiado === '1') lista = lista.filter(c => c.fiado > 0.001);
  if (q.aniversariante === 'hoje') lista = lista.filter(c => c.aniversarioMMDD === hoje);
  if (q.aniversariante === 'semana') lista = lista.filter(c => c.aniversarioMMDD && semana.has(c.aniversarioMMDD));
  if (q.gastoMin) lista = lista.filter(c => c.totalGasto >= +q.gastoMin);
  if (q.comprasMin) lista = lista.filter(c => c.qtdCompras >= +q.comprasMin);
  if (q.diasMin) lista = lista.filter(c => c.diasSemComprar != null && c.diasSemComprar >= +q.diasMin);
  // ordenação
  const ord = q.ordenar || 'nome';
  lista.sort((a, b) => ord === 'gasto' ? b.totalGasto - a.totalGasto : ord === 'compras' ? b.qtdCompras - a.qtdCompras
    : ord === 'sumido' ? (b.diasSemComprar || 0) - (a.diasSemComprar || 0) : (a.nome || '').localeCompare(b.nome || ''));
  res.json(lista);
});
// Aniversariantes (hoje | semana)
app.get('/api/crm/aniversariantes', (req, res) => {
  const semana = mmddProximosDias(7), hoje = mmddDe(new Date());
  const alvo = req.query.periodo === 'semana' ? (mmdd) => mmdd && semana.has(mmdd) : (mmdd) => mmdd === hoje;
  res.json(listaClientesCRM().filter(c => alvo(c.aniversarioMMDD)).sort((a, b) => (a.aniversarioMMDD || '').localeCompare(b.aniversarioMMDD || '')));
});
// Ranking (por compras ou gasto)
app.get('/api/crm/ranking', (req, res) => {
  const por = req.query.por === 'compras' ? 'qtdCompras' : 'totalGasto';
  const lim = Math.min(+req.query.limite || 20, 100);
  res.json(listaClientesCRM().filter(c => c.qtdCompras > 0).sort((a, b) => b[por] - a[por]).slice(0, lim));
});
// Campanha — lista pronta de contatos (nome + telefone) por critério, pra copiar/exportar
app.get('/api/crm/campanha', (req, res) => {
  const crit = req.query.criterio || 'sumidos';
  const semana = mmddProximosDias(7), hoje = mmddDe(new Date());
  const cfg = crmConfig();
  let lista = listaClientesCRM().filter(c => c.telefone); // campanha precisa de contato
  const filtros = {
    sumidos: c => c.status === 'inativo',
    inativos_15: c => c.diasSemComprar != null && c.diasSemComprar >= 15,
    inativos_30: c => c.diasSemComprar != null && c.diasSemComprar >= 30,
    aniversariantes_hoje: c => c.aniversarioMMDD === hoje,
    aniversariantes_semana: c => c.aniversarioMMDD && semana.has(c.aniversarioMMDD),
    vip: c => c.status === 'vip',
    ticket_alto: c => c.ticketMedio >= 30,
    gasto_alto: c => c.totalGasto >= cfg.vipGasto,
    com_fiado: c => c.fiado > 0.001,
    delivery: c => ['delivery', 'atendimento'].includes(c.origem),
    novos: c => c.status === 'novo' && c.qtdCompras > 0,
  };
  const fn = filtros[crit] || filtros.sumidos;
  lista = lista.filter(fn).map(c => ({ nome: c.nome, telefone: c.telefone, bairro: c.bairro, status: c.status, totalGasto: c.totalGasto, diasSemComprar: c.diasSemComprar, fiado: c.fiado }));
  manut.logAcao('lista de campanha', 'crm', { criterio: crit, contatos: lista.length, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ criterio: crit, total: lista.length, contatos: lista });
});

/* ══════════════════════════════════════════════════════════════════════════
   FASE 41 — CRM & CLUBE DO CLIENTE. Regras 100% CONFIGURÁVEIS (nada fixo no
   código): cupons virtuais, campanhas com indicadores e sorteios. NÃO duplica
   dados — CONSOME as métricas que o ERP já tem (compras, total, ticket, última,
   status — Fase 24) e a fidelidade/cashback (fidelidade_movimentos). O único
   estado novo é o que não existia: regras, cupons, campanhas, sorteios. Sem
   cartão físico — identifica pelo cadastro (telefone, Fase 18). WhatsApp
   automático fica RESERVADO (config, fase futura). ═══════════════════════════ */
migrar('fase41_crm_clube', () => {
  db.exec(`CREATE TABLE IF NOT EXISTS crm_regras (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL,
    tipo TEXT,                 -- 'acumulo_valor' | 'compras' | 'pedidos' | 'produto'
    meta REAL,                 -- gatilho (R$ acumulado, nº de compras/pedidos, qtd do produto)
    premiacao_tipo TEXT,       -- 'litros' | 'desconto' | 'produto' | 'credito' | 'frete' | 'cupom'
    premiacao_valor REAL, premiacao_desc TEXT, produto_codigo TEXT,
    validade_dias INTEGER DEFAULT 30, ativa INTEGER DEFAULT 1, obs TEXT, criado_em TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS crm_cupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER NOT NULL, regra_id INTEGER, campanha_id INTEGER,
    codigo TEXT, tipo TEXT, valor REAL, descricao TEXT,
    status TEXT DEFAULT 'disponivel',   -- 'disponivel' | 'usado' | 'expirado' | 'cancelado'
    validade TEXT, criado_em TEXT, usado_em TEXT, usado_venda TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS crm_campanhas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT, de TEXT, ate TEXT,
    segmento TEXT, regra_id INTEGER, premiacao_desc TEXT, ativa INTEGER DEFAULT 1, obs TEXT, criado_em TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS crm_sorteios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, de TEXT, ate TEXT, valor_por_bilhete REAL,
    premio TEXT, status TEXT DEFAULT 'aberto', ganhador_cliente_id INTEGER, sorteado_em TEXT, obs TEXT, criado_em TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_cupons_cliente ON crm_cupons(cliente_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cupons_status ON crm_cupons(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cupons_campanha ON crm_cupons(campanha_id)');
});
(function seedCrmClubeConfig() {
  for (const [k, v] of Object.entries({ crm_cupom_prefixo: 'AC', crm_whatsapp_auto: '0', crm_clube_ativo: '1' }))
    if (getConfig(k, null) == null) setConfig(k, v);
})();

const CRM_PREMIACOES = ['litros', 'desconto', 'produto', 'credito', 'frete', 'cupom'];
const CRM_TIPOS_REGRA = ['acumulo_valor', 'compras', 'pedidos', 'produto'];
const crmHoje = () => ymdLocal(new Date());
// BASE de avaliação de uma regra p/ um cliente — SEMPRE lida das compras reais (não guarda nada)
function crBaseRegra(regra, clienteId) {
  if (regra.tipo === 'acumulo_valor') return +metricasDoCliente(clienteId).total || 0;
  if (regra.tipo === 'compras') return +metricasDoCliente(clienteId).qtd || 0;
  if (regra.tipo === 'pedidos') return db.prepare("SELECT COUNT(*) n FROM pedidos WHERE status<>'cancelado' AND cliente_id=?").get(clienteId).n;
  if (regra.tipo === 'produto' && regra.produto_codigo) return +db.prepare("SELECT COALESCE(SUM(vi.qtd),0) q FROM vendas_itens vi JOIN vendas v ON v.id=vi.venda_id WHERE v.status='concluida' AND v.cliente_id=? AND vi.produto_codigo=?").get(clienteId, regra.produto_codigo).q || 0;
  return 0;
}
function crEmitirCupom(clienteId, regra, campanhaId) {
  const validade = (+regra.validade_dias || 0) > 0 ? new Date(Date.now() + regra.validade_dias * 864e5).toISOString().slice(0, 10) : null;
  const codigo = (getConfig('crm_cupom_prefixo', 'AC') || 'AC') + Date.now().toString(36).slice(-4).toUpperCase() + Math.floor(Math.random() * 90 + 10);
  const info = db.prepare('INSERT INTO crm_cupons (cliente_id,regra_id,campanha_id,codigo,tipo,valor,descricao,status,validade,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(clienteId, regra.id || null, campanhaId || null, codigo, regra.premiacao_tipo || 'cupom', +regra.premiacao_valor || 0, regra.premiacao_desc || regra.nome || 'Prêmio', 'disponivel', validade, new Date().toISOString());
  return info.lastInsertRowid;
}
// Gera cupons do cliente pelas regras ATIVAS — IDEMPOTENTE por CICLO (nunca emite 2x o mesmo ciclo)
function crGerarCuponsCliente(clienteId) {
  const regras = db.prepare('SELECT * FROM crm_regras WHERE ativa=1').all();
  let gerados = 0;
  for (const r of regras) {
    const meta = +r.meta || 0; if (meta <= 0) continue;
    const ciclos = Math.floor(crBaseRegra(r, clienteId) / meta);
    const jaTem = db.prepare('SELECT COUNT(*) n FROM crm_cupons WHERE regra_id=? AND cliente_id=?').get(r.id, clienteId).n;
    for (let i = jaTem; i < ciclos; i++) { crEmitirCupom(clienteId, r, null); gerados++; }
  }
  return gerados;
}
function crExpirarCupons() { try { db.prepare("UPDATE crm_cupons SET status='expirado' WHERE status='disponivel' AND validade IS NOT NULL AND validade < ?").run(crmHoje()); } catch {} }
// Benefícios do cliente (pro operador ver no PDV: cupons + fidelidade + progresso das regras)
function crBeneficiosCliente(clienteId) {
  crExpirarCupons();
  const cupons = db.prepare("SELECT * FROM crm_cupons WHERE cliente_id=? AND status='disponivel' ORDER BY id DESC").all(clienteId);
  const progresso = db.prepare('SELECT * FROM crm_regras WHERE ativa=1').all().map(r => {
    const meta = +r.meta || 0, base = crBaseRegra(r, clienteId), noCiclo = meta > 0 ? base % meta : 0;
    return { regra: r.nome, tipo: r.tipo, meta, atual: r2(base), falta: meta > 0 ? r2(meta - noCiclo) : null, premiacao: r.premiacao_desc || r.premiacao_tipo };
  });
  return { cupons, saldo_fidelidade: r2(saldoFidelidade(clienteId)), progresso };
}
function crUsarCupom(id, vendaRef, por) {
  const c = db.prepare("SELECT * FROM crm_cupons WHERE id=?").get(id);
  if (!c) return { erro: 'Cupom não encontrado.' };
  if (c.status !== 'disponivel') return { erro: `Cupom já está ${c.status}.` };
  db.prepare("UPDATE crm_cupons SET status='usado', usado_em=?, usado_venda=? WHERE id=?").run(new Date().toISOString(), vendaRef || null, id);
  // Prêmio em CRÉDITO cai direto na fidelidade (reusa o cashback, sem duplicar); os demais são aplicados no PDV.
  if (c.tipo === 'credito' && +c.valor > 0) { try { movimentarFidelidade(c.cliente_id, 'credito', +c.valor, 'clube', 'cupom#' + id, 'Crédito do clube: ' + (c.descricao || ''), por || ''); } catch {} }
  manut.logAcao('cupom do clube usado', 'crm', { cupom: id, cliente: c.cliente_id, tipo: c.tipo, por }, 'operacao');
  return { ok: true, cupom: db.prepare('SELECT * FROM crm_cupons WHERE id=?').get(id) };
}
// Indicadores de uma campanha (calculados da operação real)
function crIndicadoresCampanha(camp) {
  const cupons = db.prepare('SELECT * FROM crm_cupons WHERE campanha_id=?').all(camp.id);
  const clientes = new Set(cupons.map(c => c.cliente_id));
  const usados = cupons.filter(c => c.status === 'usado');
  let valorVendido = 0;
  for (const c of usados) { if (c.usado_venda) { const v = db.prepare('SELECT total FROM vendas WHERE numero=? OR id=?').get(String(c.usado_venda), +c.usado_venda || -1); if (v) valorVendido += +v.total || 0; } }
  return { alcance: clientes.size, cupons: cupons.length, usados: usados.length,
    conversao: cupons.length ? r2(usados.length / cupons.length * 100) : 0, valor_vendido: r2(valorVendido),
    clientes_usaram: new Set(usados.map(c => c.cliente_id)).size };
}
// Bilhetes de um sorteio por cliente (calculado das compras no período ÷ valor por bilhete)
function crBilhetesSorteio(s) {
  const de = (s.de || '2000-01-01').slice(0, 10), ate = (s.ate || crmHoje()).slice(0, 10), vpb = +s.valor_por_bilhete || 0;
  if (vpb <= 0) return [];
  const rows = db.prepare(`SELECT cliente_id, COALESCE(SUM(total),0) gasto FROM (
      SELECT cliente_id,total,data dt FROM vendas WHERE status='concluida' AND cliente_id IS NOT NULL AND date(data,'localtime') BETWEEN ? AND ?
      UNION ALL SELECT cliente_id,total,criado dt FROM pedidos WHERE status<>'cancelado' AND cliente_id IS NOT NULL AND date(criado,'localtime') BETWEEN ? AND ?
    ) GROUP BY cliente_id`).all(de, ate, de, ate);
  return rows.map(r => ({ cliente_id: r.cliente_id, gasto: r2(r.gasto), bilhetes: Math.floor(r.gasto / vpb) })).filter(x => x.bilhetes > 0);
}

// ── Endpoints do Clube (gestor: admin/supervisor) ──
const nomeClienteCrm = (id) => (db.prepare('SELECT nome FROM clientes WHERE id=?').get(id) || {}).nome || ('#' + id);
// REGRAS
app.get('/api/crm/regras', (req, res) => res.json(db.prepare('SELECT * FROM crm_regras ORDER BY ativa DESC, id DESC').all()));
app.post('/api/crm/regras', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {};
  if (!d.nome || !CRM_TIPOS_REGRA.includes(d.tipo) || !CRM_PREMIACOES.includes(d.premiacao_tipo)) return res.status(400).json({ erro: 'Nome, tipo e tipo de premiação são obrigatórios.' });
  const info = db.prepare(`INSERT INTO crm_regras (nome,tipo,meta,premiacao_tipo,premiacao_valor,premiacao_desc,produto_codigo,validade_dias,ativa,obs,criado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(d.nome, d.tipo, +d.meta || 0, d.premiacao_tipo, +d.premiacao_valor || 0, d.premiacao_desc || '', d.produto_codigo || null, +d.validade_dias || 30, d.ativa === false ? 0 : 1, d.obs || '', new Date().toISOString());
  res.json(db.prepare('SELECT * FROM crm_regras WHERE id=?').get(info.lastInsertRowid));
});
app.put('/api/crm/regras/:id', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const r = db.prepare('SELECT * FROM crm_regras WHERE id=?').get(+req.params.id); if (!r) return res.status(404).json({ erro: 'Regra não encontrada.' });
  const d = req.body || {};
  db.prepare('UPDATE crm_regras SET nome=?,tipo=?,meta=?,premiacao_tipo=?,premiacao_valor=?,premiacao_desc=?,produto_codigo=?,validade_dias=?,ativa=?,obs=? WHERE id=?')
    .run(d.nome ?? r.nome, CRM_TIPOS_REGRA.includes(d.tipo) ? d.tipo : r.tipo, d.meta != null ? +d.meta : r.meta, CRM_PREMIACOES.includes(d.premiacao_tipo) ? d.premiacao_tipo : r.premiacao_tipo,
      d.premiacao_valor != null ? +d.premiacao_valor : r.premiacao_valor, d.premiacao_desc ?? r.premiacao_desc, d.produto_codigo ?? r.produto_codigo, d.validade_dias != null ? +d.validade_dias : r.validade_dias, d.ativa != null ? (d.ativa ? 1 : 0) : r.ativa, d.obs ?? r.obs, r.id);
  res.json(db.prepare('SELECT * FROM crm_regras WHERE id=?').get(r.id));
});
app.delete('/api/crm/regras/:id', (req, res) => { if (!gateFinLancar(req, res)) return; db.prepare('DELETE FROM crm_regras WHERE id=?').run(+req.params.id); res.json({ ok: true }); });
// CUPONS + avaliação (gera cupons pelas regras)
app.get('/api/crm/cupons', (req, res) => {
  crExpirarCupons();
  const q = req.query || {}; let sql = `SELECT cu.*, c.nome cliente_nome, c.telefone FROM crm_cupons cu LEFT JOIN clientes c ON c.id=cu.cliente_id WHERE 1=1`; const args = [];
  if (q.status) { sql += ' AND cu.status=?'; args.push(q.status); }
  if (q.cliente_id) { sql += ' AND cu.cliente_id=?'; args.push(+q.cliente_id); }
  sql += ' ORDER BY cu.id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...args));
});
app.post('/api/crm/avaliar', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const clientes = db.prepare("SELECT DISTINCT cliente_id FROM (SELECT cliente_id FROM vendas WHERE cliente_id IS NOT NULL UNION SELECT cliente_id FROM pedidos WHERE cliente_id IS NOT NULL)").all();
  let gerados = 0; for (const c of clientes) gerados += crGerarCuponsCliente(c.cliente_id);
  manut.logAcao('avaliação do clube (geração de cupons)', 'crm', { clientes: clientes.length, cupons: gerados, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true, clientes_avaliados: clientes.length, cupons_gerados: gerados });
});
app.post('/api/crm/cupons/:id/usar', (req, res) => { if (!gateFinLancar(req, res)) return; const r = crUsarCupom(+req.params.id, (req.body || {}).venda, (req.usuario || {}).usuario); r.erro ? res.status(400).json(r) : res.json(r); });
app.post('/api/crm/cupons/:id/cancelar', (req, res) => { if (!gateFinLancar(req, res)) return; db.prepare("UPDATE crm_cupons SET status='cancelado' WHERE id=? AND status='disponivel'").run(+req.params.id); res.json({ ok: true }); });
app.get('/api/clientes/:id/beneficios', (req, res) => res.json(crBeneficiosCliente(+req.params.id)));
// CAMPANHAS + indicadores
app.get('/api/crm/campanhas', (req, res) => res.json(db.prepare('SELECT * FROM crm_campanhas ORDER BY ativa DESC, id DESC').all().map(c => ({ ...c, indicadores: crIndicadoresCampanha(c) }))));
app.get('/api/crm/campanhas/:id', (req, res) => { const c = db.prepare('SELECT * FROM crm_campanhas WHERE id=?').get(+req.params.id); if (!c) return res.status(404).json({ erro: 'Campanha não encontrada.' }); res.json({ ...c, indicadores: crIndicadoresCampanha(c) }); });
app.post('/api/crm/campanhas', (req, res) => {
  if (!gateFinLancar(req, res)) return; const d = req.body || {}; if (!d.nome) return res.status(400).json({ erro: 'Informe o nome da campanha.' });
  const info = db.prepare('INSERT INTO crm_campanhas (nome,tipo,de,ate,segmento,regra_id,premiacao_desc,ativa,obs,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(d.nome, d.tipo || 'periodo', d.de || null, d.ate || null, d.segmento || null, d.regra_id ? +d.regra_id : null, d.premiacao_desc || '', d.ativa === false ? 0 : 1, d.obs || '', new Date().toISOString());
  res.json(db.prepare('SELECT * FROM crm_campanhas WHERE id=?').get(info.lastInsertRowid));
});
app.put('/api/crm/campanhas/:id', (req, res) => {
  if (!gateFinLancar(req, res)) return; const c = db.prepare('SELECT * FROM crm_campanhas WHERE id=?').get(+req.params.id); if (!c) return res.status(404).json({ erro: 'Não encontrada.' });
  const d = req.body || {};
  db.prepare('UPDATE crm_campanhas SET nome=?,tipo=?,de=?,ate=?,segmento=?,regra_id=?,premiacao_desc=?,ativa=?,obs=? WHERE id=?')
    .run(d.nome ?? c.nome, d.tipo ?? c.tipo, d.de ?? c.de, d.ate ?? c.ate, d.segmento ?? c.segmento, d.regra_id != null ? +d.regra_id : c.regra_id, d.premiacao_desc ?? c.premiacao_desc, d.ativa != null ? (d.ativa ? 1 : 0) : c.ativa, d.obs ?? c.obs, c.id);
  res.json(db.prepare('SELECT * FROM crm_campanhas WHERE id=?').get(c.id));
});
app.delete('/api/crm/campanhas/:id', (req, res) => { if (!gateFinLancar(req, res)) return; db.prepare('DELETE FROM crm_campanhas WHERE id=?').run(+req.params.id); res.json({ ok: true }); });
// DISPARAR campanha: emite um cupom pra cada cliente do segmento (idempotente por cliente/campanha)
function crClientesSegmento(seg) { const lista = listaClientesCRM().filter(c => c.telefone || true); return (!seg || seg === 'todos') ? lista : lista.filter(c => c.status === seg); }
function crDispararCampanha(camp) {
  const regra = camp.regra_id ? db.prepare('SELECT * FROM crm_regras WHERE id=?').get(camp.regra_id) : null;
  const premi = regra || { premiacao_tipo: 'cupom', premiacao_valor: 0, premiacao_desc: camp.premiacao_desc || camp.nome, validade_dias: 30, nome: camp.nome };
  let n = 0;
  for (const c of crClientesSegmento(camp.segmento)) {
    if (db.prepare('SELECT 1 FROM crm_cupons WHERE campanha_id=? AND cliente_id=?').get(camp.id, c.id)) continue;
    crEmitirCupom(c.id, premi, camp.id); n++;
  }
  return n;
}
app.post('/api/crm/campanhas/:id/disparar', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const c = db.prepare('SELECT * FROM crm_campanhas WHERE id=?').get(+req.params.id); if (!c) return res.status(404).json({ erro: 'Campanha não encontrada.' });
  const n = crDispararCampanha(c);
  manut.logAcao('campanha disparada', 'crm', { campanha: c.id, cupons: n, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true, cupons_emitidos: n, indicadores: crIndicadoresCampanha(c) });
});
// SORTEIOS
app.get('/api/crm/sorteios', (req, res) => res.json(db.prepare('SELECT s.*, c.nome ganhador_nome FROM crm_sorteios s LEFT JOIN clientes c ON c.id=s.ganhador_cliente_id ORDER BY s.id DESC').all()));
app.get('/api/crm/sorteios/:id', (req, res) => { const s = db.prepare('SELECT s.*, c.nome ganhador_nome FROM crm_sorteios s LEFT JOIN clientes c ON c.id=s.ganhador_cliente_id WHERE s.id=?').get(+req.params.id); if (!s) return res.status(404).json({ erro: 'Não encontrado.' }); const b = crBilhetesSorteio(s).map(x => ({ ...x, cliente_nome: nomeClienteCrm(x.cliente_id) })).sort((a, z) => z.bilhetes - a.bilhetes); res.json({ ...s, bilhetes: b, total_bilhetes: b.reduce((a, x) => a + x.bilhetes, 0), participantes: b.length }); });
app.post('/api/crm/sorteios', (req, res) => {
  if (!gateFinLancar(req, res)) return; const d = req.body || {}; if (!d.nome) return res.status(400).json({ erro: 'Informe o nome do sorteio.' });
  const info = db.prepare('INSERT INTO crm_sorteios (nome,de,ate,valor_por_bilhete,premio,status,obs,criado_em) VALUES (?,?,?,?,?,?,?,?)')
    .run(d.nome, d.de || null, d.ate || null, +d.valor_por_bilhete || 0, d.premio || '', 'aberto', d.obs || '', new Date().toISOString());
  res.json(db.prepare('SELECT * FROM crm_sorteios WHERE id=?').get(info.lastInsertRowid));
});
app.post('/api/crm/sorteios/:id/sortear', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const s = db.prepare('SELECT * FROM crm_sorteios WHERE id=?').get(+req.params.id); if (!s) return res.status(404).json({ erro: 'Não encontrado.' });
  if (s.status === 'encerrado') return res.status(400).json({ erro: 'Sorteio já encerrado.' });
  const bilhetes = crBilhetesSorteio(s); if (!bilhetes.length) return res.status(400).json({ erro: 'Nenhum participante com bilhetes.' });
  const urna = []; bilhetes.forEach(b => { for (let i = 0; i < b.bilhetes; i++) urna.push(b.cliente_id); });
  const ganhador = urna[Math.floor(Math.random() * urna.length)];
  db.prepare("UPDATE crm_sorteios SET status='encerrado', ganhador_cliente_id=?, sorteado_em=? WHERE id=?").run(ganhador, new Date().toISOString(), s.id);
  manut.logAcao('sorteio realizado', 'crm', { sorteio: s.id, ganhador, urna: urna.length, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true, ganhador_cliente_id: ganhador, ganhador_nome: nomeClienteCrm(ganhador), total_bilhetes: urna.length });
});
app.delete('/api/crm/sorteios/:id', (req, res) => { if (!gateFinLancar(req, res)) return; db.prepare('DELETE FROM crm_sorteios WHERE id=?').run(+req.params.id); res.json({ ok: true }); });
// RESUMO do clube (indicadores gerais)
app.get('/api/crm/clube/resumo', (req, res) => {
  crExpirarCupons();
  const cup = db.prepare("SELECT status, COUNT(*) n, COALESCE(SUM(valor),0) v FROM crm_cupons GROUP BY status").all();
  const porStatus = Object.fromEntries(cup.map(x => [x.status, x.n]));
  res.json({ regras_ativas: db.prepare('SELECT COUNT(*) n FROM crm_regras WHERE ativa=1').get().n,
    cupons: { disponivel: porStatus.disponivel || 0, usado: porStatus.usado || 0, expirado: porStatus.expirado || 0 },
    campanhas_ativas: db.prepare('SELECT COUNT(*) n FROM crm_campanhas WHERE ativa=1').get().n,
    sorteios_abertos: db.prepare("SELECT COUNT(*) n FROM crm_sorteios WHERE status='aberto'").get().n,
    config: { cupom_prefixo: getConfig('crm_cupom_prefixo', 'AC'), whatsapp_auto: getConfig('crm_whatsapp_auto', '0') === '1' } });
});
app.post('/api/crm/clube/config', (req, res) => {
  if (!gateFinLancar(req, res)) return; const d = req.body || {};
  if (d.cupom_prefixo) setConfig('crm_cupom_prefixo', String(d.cupom_prefixo).slice(0, 6).toUpperCase());
  if (d.whatsapp_auto != null) setConfig('crm_whatsapp_auto', d.whatsapp_auto ? '1' : '0');
  res.json({ ok: true });
});

/* ══════════════════════════════════════════════════════════════════════════
   FASE 42 — ASSISTENTE INTELIGENTE DO ERP. A IA vira uma CAMADA sobre o sistema:
   lê o que o ERP JÁ tem (estoque, pedidos, contas, fiado, clientes, custos,
   consistência) e vira INSIGHTS/alertas + resumo + respostas em linguagem
   natural. NUNCA executa ação crítica — só sugere e pede confirmação no módulo.
   NÃO duplica dado nem cria regra paralela: reusa os helpers já construídos. O
   atendimento WhatsApp (backend/ia) continua; aqui a IA narra o contexto. ═══ */
// Motor de INSIGHTS — determinístico, unifica sinais que já existem no ERP.
function assistenteInsights() {
  const ins = [], hoje = ymdLocal(new Date());
  const add = (area, sev, titulo, detalhe, acao, conf, modulo) => ins.push({ area, severidade: sev, titulo, detalhe: detalhe || '', acao_sugerida: acao || '', requer_confirmacao: !!conf, modulo: modulo || null });
  // OPERAÇÃO — estoque
  try {
    const baixo = db.prepare('SELECT codigo,nome,estoque,estoqueMin FROM produtos WHERE estoqueMin>0 AND estoque<=estoqueMin ORDER BY estoque').all();
    const zerados = baixo.filter(p => (+p.estoque || 0) <= 0), acabando = baixo.filter(p => (+p.estoque || 0) > 0);
    if (zerados.length) add('operacao', 'critico', `${zerados.length} produto(s) zerado(s)`, zerados.slice(0, 6).map(p => p.nome).join(', '), 'Repor estoque ou produzir', true, 'produtos');
    if (acabando.length) add('operacao', 'atencao', `${acabando.length} produto(s) acabando`, acabando.slice(0, 6).map(p => `${p.nome} (${r2(p.estoque)})`).join(', '), 'Planejar reposição/produção', false, 'produtos');
  } catch {}
  // OPERAÇÃO — pedidos demorando
  try {
    const lentos = db.prepare("SELECT numero,criado FROM pedidos WHERE status IN ('pendente','preparo','pronto','rota')").all()
      .map(p => ({ ...p, min: Math.round((Date.now() - new Date(p.criado).getTime()) / 60000) })).filter(p => p.min >= 45);
    if (lentos.length) add('operacao', 'atencao', `${lentos.length} pedido(s) demorando`, `o mais antigo há ${Math.max(...lentos.map(p => p.min))} min`, 'Conferir produção/expedição', false, 'producao');
  } catch {}
  // CLIENTES — benefício disponível (Clube)
  try { crExpirarCupons(); const n = db.prepare("SELECT COUNT(DISTINCT cliente_id) n FROM crm_cupons WHERE status='disponivel'").get().n; if (n) add('clientes', 'info', `${n} cliente(s) com benefício disponível`, 'Cupons do Clube prontos pra usar', 'Avisar no atendimento/PDV', false, 'clientes'); } catch {}
  // FINANCEIRO — contas a pagar
  try {
    const cp = db.prepare("SELECT * FROM contas_pagar WHERE status IN ('aberto','parcial')").all();
    const emAb = c => r2((c.valor_total || 0) - valorPagoConta(c.id)), venc = c => (c.data_vencimento || '').slice(0, 10);
    const vencidas = cp.filter(c => venc(c) && venc(c) < hoje);
    if (vencidas.length) add('financeiro', 'critico', `${vencidas.length} conta(s) a pagar vencida(s)`, fmtBRLc(vencidas.reduce((s, c) => s + emAb(c), 0)), 'Pagar ou renegociar', true, 'financeiro');
    const s3 = new Date(); s3.setDate(s3.getDate() + 3); const y3 = ymdLocal(s3);
    const prox = cp.filter(c => venc(c) && venc(c) >= hoje && venc(c) <= y3);
    if (prox.length) add('financeiro', 'atencao', `${prox.length} conta(s) vencendo em 3 dias`, fmtBRLc(prox.reduce((s, c) => s + emAb(c), 0)), 'Programar pagamento', false, 'financeiro');
  } catch {}
  // FINANCEIRO — fiado vencido (Contas a Receber)
  try { const rr = crResumo(crCarteira()); if (rr.vencido > 0.005) add('financeiro', 'atencao', `Fiado vencido: ${fmtBRLc(rr.vencido)}`, `${rr.clientes_inadimplentes} cliente(s) inadimplente(s)`, 'Acionar a régua de cobrança', false, 'financeiro'); } catch {}
  // CLIENTES — inativos / VIP
  try {
    const cfg = crmConfig(), mets = metricasDeTodosClientes(); let inat = 0, vip = 0;
    for (const [, m] of mets) { const c = metricasCalculadas(m, cfg); if (c.status === 'inativo') inat++; if (c.status === 'vip') vip++; }
    if (inat) add('clientes', 'atencao', `${inat} cliente(s) sumido(s)`, `sem comprar há mais de ${cfg.diasInativo} dias`, 'Campanha de recuperação (Clube)', false, 'clientes');
    if (vip) add('clientes', 'info', `${vip} cliente(s) VIP`, 'base fiel — vale um agrado', 'Campanha VIP (Clube)', false, 'clientes');
  } catch {}
  // ADMINISTRAÇÃO — consistência do ERP (Fase 36/37)
  try { const c = consistenciaERP(); c.checks.filter(x => x.status === 'alerta').forEach(x => add('administracao', 'atencao', x.titulo, x.detalhe, 'Conferir em Administração → Plataforma', false, 'administracao')); } catch {}
  return ins;
}
// Resumo executivo (determinístico) — reusa BI + saldos + contas
function assistenteResumo() {
  const fx = faixaPeriodo({ periodo: 'mes' }), bi = biVisaoGeral(fx);
  const saldo = r2(db.prepare('SELECT id FROM financeiro_contas WHERE ativo=1').all().reduce((s, c) => s + saldoDaConta(c.id), 0));
  const cp = db.prepare("SELECT * FROM contas_pagar WHERE status IN ('aberto','parcial')").all();
  const pagar = r2(cp.reduce((s, c) => s + r2((c.valor_total || 0) - valorPagoConta(c.id)), 0));
  let receber = 0; try { receber = crResumo(crCarteira()).total; } catch {}
  try { receber = r2(receber + anotacoesPendentesTotal()); } catch {}   // + anotações "pagar depois" em aberto
  const ins = assistenteInsights();
  return { periodo: fx.label, faturamento_mes: r2(bi.faturamento || 0), lucro_mes: r2(bi.lucroEstimado || 0), saldo_caixa: saldo, a_pagar: pagar, a_receber: r2(receber),
    alertas: { critico: ins.filter(i => i.severidade === 'critico').length, atencao: ins.filter(i => i.severidade === 'atencao').length, info: ins.filter(i => i.severidade === 'info').length } };
}
function assistenteContexto() {
  let movimentacoes = null; try { movimentacoes = movncResumo(30); } catch {}
  let compras = null; try { compras = typeof comprasIntelResumoIA === 'function' ? comprasIntelResumoIA() : null; } catch {}
  return { resumo: assistenteResumo(), insights: assistenteInsights().slice(0, 15), movimentacoes_nao_comerciais: movimentacoes, compras_inteligentes: compras };
}
function assistenteRespostaFallback(pergunta, ctx) {
  const r = ctx.resumo, crit = ctx.insights.filter(i => i.severidade === 'critico');
  let t = `Resumo (${r.periodo}): faturamento ${fmtBRLc(r.faturamento_mes)}, lucro ${fmtBRLc(r.lucro_mes)}, caixa ${fmtBRLc(r.saldo_caixa)}, a pagar ${fmtBRLc(r.a_pagar)}, a receber ${fmtBRLc(r.a_receber)}. Alertas: ${r.alertas.critico} crítico(s), ${r.alertas.atencao} de atenção.`;
  if (crit.length) t += ' PRIORIDADE: ' + crit.map(i => i.titulo).join('; ') + '.';
  return t + ' (IA de linguagem natural indisponível — mostrando o resumo direto dos dados.)';
}

// ── Endpoints do Assistente (gestor) ──
app.get('/api/assistente/status', (req, res) => res.json({ ia_ativa: !!iaConfig.iaAtiva, modelo: iaConfig.iaAtiva ? (iaConfig.anthropic ? iaConfig.MODELO_ANTHROPIC : iaConfig.MODELO_OPENAI) : null }));
app.get('/api/assistente/insights', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const ins = assistenteInsights();
  const areas = ['operacao', 'financeiro', 'clientes', 'producao', 'administracao'];
  const porArea = Object.fromEntries(areas.map(a => [a, ins.filter(i => i.area === a)]));
  res.json({ insights: ins, por_area: porArea, total: ins.length,
    contagem: { critico: ins.filter(i => i.severidade === 'critico').length, atencao: ins.filter(i => i.severidade === 'atencao').length, info: ins.filter(i => i.severidade === 'info').length } });
});
app.get('/api/assistente/resumo', (req, res) => { if (!gateFinLancar(req, res)) return; res.json(assistenteResumo()); });
app.post('/api/assistente/perguntar', async (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const pergunta = String((req.body || {}).pergunta || '').trim();
  if (!pergunta) return res.status(400).json({ erro: 'Faça uma pergunta.' });
  const contexto = assistenteContexto();
  // Sem IA de linguagem natural → responde direto dos dados (nunca deixa o usuário na mão).
  if (!iaConfig.iaAtiva || !iaConfig.anthropic) return res.json({ resposta: assistenteRespostaFallback(pergunta, contexto), fonte: 'deterministico', ia: false });
  try {
    const sys = 'Você é o assistente do ERP "Açaí do Centro". Responda em português, direto e prático, USANDO SOMENTE os dados fornecidos (não invente números). NUNCA execute ações: se algo exigir ação com impacto financeiro, fiscal ou de estoque, oriente o usuário a confirmar no módulo correspondente. Se faltar dado, diga o que ele deve olhar no sistema. Seja conciso.';
    const resp = await iaConfig.anthropic.messages.create({ model: iaConfig.MODELO_ANTHROPIC, max_tokens: 600, system: sys,
      messages: [{ role: 'user', content: `Pergunta: ${pergunta}\n\nDados atuais do ERP (JSON):\n${JSON.stringify(contexto)}` }] });
    const texto = (resp.content || []).map(b => b.text || '').join('').trim();
    manut.logAcao('pergunta ao assistente', 'ia', { pergunta: pergunta.slice(0, 120), por: (req.usuario || {}).usuario }, 'operacao');
    res.json({ resposta: texto || assistenteRespostaFallback(pergunta, contexto), fonte: texto ? 'ia' : 'deterministico', ia: !!texto, modelo: iaConfig.MODELO_ANTHROPIC });
  } catch (e) { res.json({ resposta: assistenteRespostaFallback(pergunta, contexto), fonte: 'deterministico', ia: false, erro_ia: e.message }); }
});

/* ══════════════════════════════════════════════════════════════════════════
   FASE 43 — OPERAÇÃO REAL: FECHAMENTO OPERACIONAL POR PERÍODO. A loja fecha às
   13h e às 21h; nada é pedido na ABERTURA. No FECHAMENTO o operador informa
   sacas usadas, litros produzidos (Popular/Médio/Grosso) e o RESTANTE de cada
   tipo. O sistema calcula sozinho: consumo do período, estoque disponível,
   rendimento por saca, divergência (restante × estoque do sistema) e histórico
   (base p/ a previsão da IA — F42). Reusa produtos/estoque e a decisão de
   produção por LOTE (sem rendimento fixo). Não duplica; parametrizável. ═══════ */
migrar('fase43_operacao_fechamento', () => {
  db.exec(`CREATE TABLE IF NOT EXISTS operacao_fechamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, periodo TEXT, sacas_usadas REAL,
    litros_popular REAL, litros_medio REAL, litros_grosso REAL,
    restante_popular REAL, restante_medio REAL, restante_grosso REAL,
    div_popular REAL, div_medio REAL, div_grosso REAL, operador TEXT, obs TEXT, criado_em TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_opfech_data ON operacao_fechamentos(data)');
});
(function seedOperacaoConfig() {
  const map = { operacao_produto_popular: 'ACAI-POP', operacao_produto_medio: 'ACAI-TOP', operacao_produto_grosso: 'ACAI-GROSSO',
    operacao_ajusta_estoque: '0', operacao_hora_manha: '13', operacao_hora_noite: '21', operacao_hora_domingo: '13' };
  for (const [k, v] of Object.entries(map)) if (getConfig(k, null) == null) setConfig(k, v);
})();
const opProdutos = () => ({ popular: getConfig('operacao_produto_popular', 'ACAI-POP'), medio: getConfig('operacao_produto_medio', 'ACAI-TOP'), grosso: getConfig('operacao_produto_grosso', 'ACAI-GROSSO') });
function operacaoPeriodoAtual() {
  const d = new Date(), dia = d.getDay(), h = d.getHours();
  if (dia === 0) return { periodo: 'domingo', label: 'Domingo (9h–13h)' };
  return h < 14 ? { periodo: 'manha', label: 'Manhã (abertura até 13h)' } : { periodo: 'noite', label: 'Noite (18h–21h)' };
}
const PERIODO_LABEL = { manha: 'Manhã', noite: 'Noite', domingo: 'Domingo' };
const MODO_LABEL = { periodo: 'Por Período', consolidado: 'Único do Dia' };
// Classifica uma diferença físico×teórico em uma hipótese operacional (nunca cria venda; só sugere).
function hintDivergencia(dif) {
  if (dif == null) return null;
  const d = +dif || 0;
  if (Math.abs(d) < 0.01) return { classe: 'ok', texto: 'Sem divergência' };
  if (d < 0) return { classe: 'falta', texto: 'Falta — possível venda não registrada, consumo interno ou perda' };
  return { classe: 'sobra', texto: 'Sobra — possível erro de contagem, produção não lançada ou devolução' };
}
function fechamentoFront(f) {
  if (!f) return null;
  const lt = r2((+f.litros_popular || 0) + (+f.litros_medio || 0) + (+f.litros_grosso || 0));
  let itens = []; try { itens = f.itens ? JSON.parse(f.itens) : []; } catch {}
  let financeiro = null; try { financeiro = f.financeiro ? JSON.parse(f.financeiro) : null; } catch {}
  // Conferência automática (esperado × informado × diferença), reconstruída dos snapshots gravados.
  const acaiConf = [
    { grupo: 'Açaí Popular', unidade: 'L', esperado: r2((+f.restante_popular || 0) - (+f.div_popular || 0)), informado: r2(+f.restante_popular || 0), diferenca: r2(+f.div_popular || 0) },
    { grupo: 'Açaí Médio', unidade: 'L', esperado: r2((+f.restante_medio || 0) - (+f.div_medio || 0)), informado: r2(+f.restante_medio || 0), diferenca: r2(+f.div_medio || 0) },
    { grupo: 'Açaí Grosso', unidade: 'L', esperado: r2((+f.restante_grosso || 0) - (+f.div_grosso || 0)), informado: r2(+f.restante_grosso || 0), diferenca: r2(+f.div_grosso || 0) },
  ];
  const itensConf = itens.filter(i => i.fisico != null).map(i => ({ grupo: i.nome || i.codigo, unidade: i.unidade || 'un', esperado: r2(i.teorico), informado: r2(i.fisico), diferenca: r2(i.diferenca) }));
  const conferencia = [...acaiConf, ...itensConf].map(c => ({ ...c, hint: hintDivergencia(c.diferenca) }));
  return { ...f, periodo_label: PERIODO_LABEL[f.periodo] || f.periodo, modo: f.modo || 'periodo', modo_label: MODO_LABEL[f.modo || 'periodo'], status: f.status || 'confirmado',
    itens, financeiro, conferencia, litros_totais: lt,
    restante_total: r2((+f.restante_popular || 0) + (+f.restante_medio || 0) + (+f.restante_grosso || 0)),
    rendimento_saca: (+f.sacas_usadas > 0 ? r2(lt / f.sacas_usadas) : null),
    consumo_popular: r2((+f.litros_popular || 0) - (+f.restante_popular || 0)), consumo_medio: r2((+f.litros_medio || 0) - (+f.restante_medio || 0)), consumo_grosso: r2((+f.litros_grosso || 0) - (+f.restante_grosso || 0)),
    consumo_total: r2(lt - ((+f.restante_popular || 0) + (+f.restante_medio || 0) + (+f.restante_grosso || 0))),
    divergencia_total: r2((+f.div_popular || 0) + (+f.div_medio || 0) + (+f.div_grosso || 0)),
    divergencia_itens: itensConf.length,
    custo_mp: f.custo_mp != null ? r2(f.custo_mp) : null, custo_litro: (f.custo_mp != null && lt > 0) ? r2(f.custo_mp / lt) : null };
}
function operacaoResumo() {
  const rows = db.prepare('SELECT * FROM operacao_fechamentos ORDER BY id DESC LIMIT 90').all().map(fechamentoFront);
  const comSacas = rows.filter(r => (+r.sacas_usadas || 0) > 0 && r.rendimento_saca != null);
  const rendMedio = comSacas.length ? r2(comSacas.reduce((s, r) => s + r.rendimento_saca, 0) / comSacas.length) : null;
  return { total: rows.length, rendimento_medio_saca: rendMedio,
    sacas_total: r2(rows.reduce((s, r) => s + (+r.sacas_usadas || 0), 0)), litros_total: r2(rows.reduce((s, r) => s + r.litros_totais, 0)),
    consumo_total: r2(rows.reduce((s, r) => s + r.consumo_total, 0)), divergencias: rows.filter(r => Math.abs(r.divergencia_total) > 2).length,
    ultimos: rows.slice(0, 12) };
}

app.get('/api/operacao/periodo-atual', (req, res) => res.json({ ...operacaoPeriodoAtual(), agora: new Date().toISOString() }));
// Modo automático (o sistema decide período×consolidado) — base da tela de fechamento.
app.get('/api/operacao/modo', (req, res) => res.json({ ...operacaoModo(), data: ymdLocal(new Date()), agora: new Date().toISOString() }));
// Estado da conferência para PREENCHER a tela: teórico do açaí + outros produtos controlados + caixa esperado.
app.get('/api/operacao/conferencia', (req, res) => {
  const m = operacaoModo(), data = req.query.data || ymdLocal(new Date());
  const modo = req.query.modo || m.modo, periodo = req.query.periodo || m.periodo;
  const prod = opProdutos();
  const acaiRow = (cod, nome) => { const p = cod ? db.prepare("SELECT nome, COALESCE(estoque,0) estoque, COALESCE(unidade,'L') unidade FROM produtos WHERE codigo=?").get(cod) : null; return { codigo: cod, nome, unidade: (p && p.unidade) || 'L', teorico: p ? r2(p.estoque) : 0 }; };
  const fx = faixaPeriodoOperacional(modo, periodo, data);
  res.json({
    modo, periodo, label: m.label, data, manha_fechada: m.manha_fechada,
    acai: { popular: acaiRow(prod.popular, 'Açaí Popular'), medio: acaiRow(prod.medio, 'Açaí Médio'), grosso: acaiRow(prod.grosso, 'Açaí Grosso') },
    produtos: produtosConferencia(),
    caixa: caixaEsperadoPeriodo(fx.de, fx.ate),
  });
});
app.get('/api/operacao/config', (req, res) => res.json({ ...opProdutos(), ajusta_estoque: getConfig('operacao_ajusta_estoque', '0') === '1' }));
app.post('/api/operacao/config', (req, res) => {
  if (!gateFinLancar(req, res)) return; const d = req.body || {};
  if (d.popular) setConfig('operacao_produto_popular', String(d.popular));
  if (d.medio) setConfig('operacao_produto_medio', String(d.medio));
  if (d.grosso) setConfig('operacao_produto_grosso', String(d.grosso));
  if (d.ajusta_estoque != null) setConfig('operacao_ajusta_estoque', d.ajusta_estoque ? '1' : '0');
  res.json({ ok: true });
});
app.get('/api/operacao/resumo', (req, res) => res.json(operacaoResumo()));
app.get('/api/operacao/fechamentos', (req, res) => res.json(db.prepare('SELECT * FROM operacao_fechamentos ORDER BY id DESC LIMIT 200').all().map(fechamentoFront)));
app.get('/api/operacao/fechamentos/:id', (req, res) => { const f = fechamentoFront(db.prepare('SELECT * FROM operacao_fechamentos WHERE id=?').get(+req.params.id)); f ? res.json(f) : res.status(404).json({ erro: 'Fechamento não encontrado.' }); });
const estoqueDeCod = (cod) => { const p = cod ? db.prepare('SELECT estoque FROM produtos WHERE codigo=?').get(cod) : null; return p ? (+p.estoque || 0) : 0; };
// grava (cria ou atualiza) um fechamento; se CONFIRMADO, reconcilia o estoque (reusa a lógica da Fase 43.5)
function salvarFechamento(d, existente, usuario) {
  const prod = opProdutos(), agora = new Date().toISOString();
  const div = (cod, rest) => r2((+rest || 0) - estoqueDeCod(cod));
  const itens = Array.isArray(d.itens) ? d.itens.map(i => ({ codigo: i.codigo, nome: i.nome || '', unidade: i.unidade || 'un',
    teorico: r2(estoqueDeCod(i.codigo)), fisico: (i.fisico != null ? r2(i.fisico) : null),
    diferenca: (i.fisico != null ? r2((+i.fisico || 0) - estoqueDeCod(i.codigo)) : null) })) : (existente ? (JSON.parse(existente.itens || '[]')) : []);
  const status = d.status === 'confirmado' ? 'confirmado' : 'rascunho';
  const campos = { data: d.data || (existente && existente.data) || ymdLocal(new Date()), periodo: d.periodo || (existente && existente.periodo) || operacaoPeriodoAtual().periodo,
    modo: ['periodo', 'consolidado'].includes(d.modo) ? d.modo : (existente && existente.modo) || 'periodo', status,
    sacas_usadas: +d.sacas_usadas || 0, litros_popular: +d.litros_popular || 0, litros_medio: +d.litros_medio || 0, litros_grosso: +d.litros_grosso || 0,
    restante_popular: +d.restante_popular || 0, restante_medio: +d.restante_medio || 0, restante_grosso: +d.restante_grosso || 0,
    div_popular: div(prod.popular, d.restante_popular), div_medio: div(prod.medio, d.restante_medio), div_grosso: div(prod.grosso, d.restante_grosso),
    itens: JSON.stringify(itens), financeiro: d.financeiro ? JSON.stringify(d.financeiro) : (existente ? existente.financeiro : null),
    operador: usuario || (existente && existente.operador) || '', obs: d.obs != null ? d.obs : (existente && existente.obs) || '' };
  let id;
  if (existente) {
    db.prepare(`UPDATE operacao_fechamentos SET data=?,periodo=?,modo=?,status=?,sacas_usadas=?,litros_popular=?,litros_medio=?,litros_grosso=?,restante_popular=?,restante_medio=?,restante_grosso=?,div_popular=?,div_medio=?,div_grosso=?,itens=?,financeiro=?,operador=?,obs=?,confirmado_em=? WHERE id=?`)
      .run(campos.data, campos.periodo, campos.modo, campos.status, campos.sacas_usadas, campos.litros_popular, campos.litros_medio, campos.litros_grosso, campos.restante_popular, campos.restante_medio, campos.restante_grosso, campos.div_popular, campos.div_medio, campos.div_grosso, campos.itens, campos.financeiro, campos.operador, campos.obs, status === 'confirmado' ? agora : null, existente.id);
    id = existente.id;
  } else {
    id = db.prepare(`INSERT INTO operacao_fechamentos (data,periodo,modo,status,sacas_usadas,litros_popular,litros_medio,litros_grosso,restante_popular,restante_medio,restante_grosso,div_popular,div_medio,div_grosso,itens,financeiro,operador,obs,confirmado_em,criado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(campos.data, campos.periodo, campos.modo, campos.status, campos.sacas_usadas, campos.litros_popular, campos.litros_medio, campos.litros_grosso, campos.restante_popular, campos.restante_medio, campos.restante_grosso, campos.div_popular, campos.div_medio, campos.div_grosso, campos.itens, campos.financeiro, campos.operador, campos.obs, status === 'confirmado' ? agora : null, agora).lastInsertRowid;
  }
  // Reconciliação de estoque SÓ ao CONFIRMAR (rascunho não mexe em nada) — nunca duplica.
  if (status === 'confirmado' && (!existente || existente.status !== 'confirmado') && getConfig('operacao_ajusta_estoque', '0') === '1') {
    const aj = (cod, q) => { if (cod && db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(cod)) registrarMovimento(cod, 'ajuste', { quantidade: +q || 0, estoque_novo: +q || 0, motivo: 'fechamento operacional', referencia: 'fechamento#' + id }); };
    aj(prod.popular, campos.restante_popular); aj(prod.medio, campos.restante_medio); aj(prod.grosso, campos.restante_grosso);
    for (const it of itens) if (it.fisico != null) aj(it.codigo, it.fisico); // outros produtos → estoque físico informado
    const saca = getConfig('operacao_saca_codigo', 'SACA-ACAI');
    if (saca && campos.sacas_usadas > 0 && db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(saca))
      registrarMovimento(saca, 'saida', { quantidade: campos.sacas_usadas, motivo: 'consumo na produção', referencia: 'fechamento#' + id });
    // Fase 45: consome os LOTES INTERNOS por FIFO e apura o custo real da matéria-prima.
    try { if (typeof consumirLotesFechamento === 'function') consumirLotesFechamento(id, campos.sacas_usadas); } catch (e) { manut.logErro('fech-lote-consumo', e); }
  }
  manut.logAcao(existente ? 'fechamento atualizado' : 'fechamento operacional', 'operacao', { id, modo: campos.modo, status, periodo: campos.periodo, por: usuario }, 'operacao');
  return fechamentoFront(db.prepare('SELECT * FROM operacao_fechamentos WHERE id=?').get(id));
}
app.post('/api/operacao/fechamentos', (req, res) => { try { res.json(salvarFechamento(req.body || {}, null, (req.usuario || {}).nome || '')); } catch (e) { res.status(500).json({ erro: e.message }); } });
app.put('/api/operacao/fechamentos/:id', (req, res) => {
  const ex = db.prepare('SELECT * FROM operacao_fechamentos WHERE id=?').get(+req.params.id);
  if (!ex) return res.status(404).json({ erro: 'Fechamento não encontrado.' });
  // Alterar um fechamento JÁ CONFIRMADO exige gestor (segurança/histórico).
  if (ex.status === 'confirmado' && !gateFinLancar(req, res)) return;
  try { res.json(salvarFechamento(req.body || {}, ex, (req.usuario || {}).nome || '')); } catch (e) { res.status(500).json({ erro: e.message }); }
});
app.delete('/api/operacao/fechamentos/:id', (req, res) => { if (!gateFinLancar(req, res)) return; db.prepare('DELETE FROM operacao_fechamentos WHERE id=?').run(+req.params.id); res.json({ ok: true }); });

/* ══════════════════════════════════════════════════════════════════════════
   FASE 43.5 — CONSOLIDAÇÃO DA OPERAÇÃO REAL: fecha o ciclo do estoque. Antes,
   a venda NÃO baixava o estoque do produto e a produção NÃO o alimentava —
   o número era irreal e a divergência do fechamento não significava nada.
   Agora: (1) VENDA baixa o estoque do produto vendido (produtos SEM ficha, pra
   não duplicar com os insumos); (2) o FECHAMENTO reconcilia o açaí ao RESTANTE
   físico (resolve a produção ser contínua e só conhecida no fechamento) e
   CONSOME as sacas da matéria-prima. Tudo config-gated (reversível). Também
   classifica os produtos por tipo e cadastra a matéria-prima "Saca de Açaí".
   ══════════════════════════════════════════════════════════════════════════ */
migrar('fase43b_consolidacao_operacao', () => {
  const setTipo = (cod, tipo) => { try { db.prepare("UPDATE produtos SET tipo=? WHERE codigo=? AND (tipo IS NULL OR tipo='')").run(tipo, cod); } catch {} };
  ['ACAI-POP', 'ACAI-TOP', 'ACAI-GROSSO'].forEach(c => setTipo(c, 'acabado'));   // açaí produzido (vendido por litro)
  ['SARDINHA', 'FARINHA', 'TAPIOCA'].forEach(c => setTipo(c, 'acabado'));         // revenda
  if (!db.prepare("SELECT codigo FROM produtos WHERE codigo='SACA-ACAI'").get())
    try { db.prepare("INSERT INTO produtos (codigo,nome,tipo,precoVenda,precoCompra,estoque,estoqueMin,disponivel,unidade,atualizado_em) VALUES ('SACA-ACAI','Saca de Açaí (matéria-prima)','materia_prima',0,0,0,0,0,'saca',?)").run(new Date().toISOString()); } catch {}
  setConfig('operacao_ajusta_estoque', '1'); // liga a reconciliação do açaí ao restante físico
});
(function seedConsolidacaoConfig() {
  const map = { estoque_baixa_venda: '1', operacao_saca_codigo: 'SACA-ACAI' };
  for (const [k, v] of Object.entries(map)) if (getConfig(k, null) == null) setConfig(k, v);
})();
// ── Fase 43.6: dois modos de fechamento (por período × único do dia) + conferência dinâmica ──
migrar('fase43c_fechamento_modos', () => {
  for (const col of ['modo TEXT', 'status TEXT', 'itens TEXT', 'financeiro TEXT', 'confirmado_em TEXT']) {
    try { db.exec(`ALTER TABLE operacao_fechamentos ADD COLUMN ${col}`); } catch {}
  }
  try { db.exec('ALTER TABLE produtos ADD COLUMN controla_fechamento INTEGER'); } catch {}
  // registros antigos = período já confirmado (mantém o comportamento anterior)
  try { db.exec("UPDATE operacao_fechamentos SET modo='periodo' WHERE modo IS NULL OR modo=''"); } catch {}
  try { db.exec("UPDATE operacao_fechamentos SET status='confirmado' WHERE status IS NULL OR status=''"); } catch {}
  // Cadastro inteligente: todo produto CLASSIFICADO (com tipo) entra sozinho na conferência.
  try { db.exec("UPDATE produtos SET controla_fechamento=1 WHERE controla_fechamento IS NULL AND COALESCE(tipo,'') NOT IN ('','servico','nao_controlado')"); } catch {}
});
// MODO automático — o sistema decide sozinho; nunca pede os dois formatos ao mesmo tempo:
//  • manhã já CONFIRMADA hoje → só o fechamento da noite (período)
//  • manhã ainda não fechada e já é noite → fechamento ÚNICO do dia (consolidado)
//  • ainda de manhã (ou domingo) → fechamento do período corrente
function operacaoModo() {
  const hoje = ymdLocal(new Date()), per = operacaoPeriodoAtual().periodo;
  if (per === 'domingo') return { modo: 'periodo', periodo: 'domingo', label: 'Fechamento de Domingo', manha_fechada: false };
  const manhaFechada = !!db.prepare("SELECT 1 FROM operacao_fechamentos WHERE data=? AND periodo='manha' AND status='confirmado'").get(hoje);
  if (manhaFechada) return { modo: 'periodo', periodo: 'noite', label: 'Fechamento da Noite', manha_fechada: true };
  if (per === 'manha') return { modo: 'periodo', periodo: 'manha', label: 'Fechamento da Manhã', manha_fechada: false };
  return { modo: 'consolidado', periodo: 'noite', label: 'Fechamento Único do Dia', manha_fechada: false };
}
// Outros produtos controlados (exclui o trio de açaí e a saca — tratados na produção). Respeita tipo+unidade.
function produtosConferencia() {
  const prod = opProdutos(), saca = getConfig('operacao_saca_codigo', 'SACA-ACAI');
  const exclui = new Set([prod.popular, prod.medio, prod.grosso, saca].filter(Boolean));
  return db.prepare("SELECT codigo, nome, COALESCE(unidade,'un') unidade, COALESCE(tipo,'') tipo, COALESCE(estoque,0) estoque FROM produtos WHERE controla_fechamento=1 ORDER BY nome").all()
    .filter(p => !exclui.has(p.codigo))
    .map(p => ({ codigo: p.codigo, nome: p.nome, unidade: p.unidade, tipo: p.tipo, teorico: r2(p.estoque) }));
}
// Faixa de datas LOCAIS do período (corte 14h: loja fecha 13h e reabre 18h — sem vendas no meio).
function faixaPeriodoOperacional(modo, periodo, dataYmd) {
  const dia = dataYmd || ymdLocal(new Date());
  const ini = `${dia} 00:00:00`, meio = `${dia} 14:00:00`, fim = `${dia} 23:59:59`;
  if (modo === 'consolidado') return { de: ini, ate: fim };
  if (periodo === 'noite') return { de: meio, ate: fim };
  return { de: ini, ate: meio }; // manhã / domingo
}
// Caixa esperado do período (mesma fonte do BI financeiro): pagamentos por forma + fiado recebido.
function caixaEsperadoPeriodo(deLocal, ateLocal) {
  const balPg = db.prepare(`SELECT p.forma forma, COALESCE(SUM(p.valor),0) total, COUNT(*) n FROM pagamentos p JOIN vendas v ON v.id=p.venda_id WHERE v.status='concluida' AND datetime(v.data,'localtime')>=? AND datetime(v.data,'localtime')<? GROUP BY p.forma`).all(deLocal, ateLocal);
  const delPg = db.prepare(`SELECT pagamento forma, COALESCE(SUM(${PED_TOTAL}),0) total, COUNT(*) n FROM pedidos p WHERE p.status<>'cancelado' AND datetime(p.criado,'localtime')>=? AND datetime(p.criado,'localtime')<? GROUP BY pagamento`).all(deLocal, ateLocal);
  const mapa = {};
  for (const r of [...balPg, ...delPg]) { const k = normalizarForma(r.forma); (mapa[k] || (mapa[k] = { forma: k, total: 0, n: 0 })); mapa[k].total += r.total; mapa[k].n += r.n; }
  const formas = Object.values(mapa).map(f => ({ ...f, total: r2(f.total) })).sort((a, b) => b.total - a.total);
  const fiadoReceb = db.prepare(`SELECT COALESCE(SUM(valor),0) t FROM clientes_extrato WHERE tipo='pagamento' AND datetime(criado_em,'localtime')>=? AND datetime(criado_em,'localtime')<?`).get(deLocal, ateLocal).t;
  return { formas, total: r2(formas.reduce((s, f) => s + f.total, 0)), fiado_recebido: r2(fiadoReceb) };
}
const temFichaAtiva = (cod) => !!db.prepare('SELECT 1 FROM produtos_ficha WHERE produto_codigo=? AND ativo=1').get(cod);
// Baixa (ou estorna) o estoque dos PRODUTOS vendidos. Só produtos SEM ficha (senão dupla-baixa com os insumos).
function movimentarEstoqueVenda(itens, vendaId, estorno) {
  if (getConfig('estoque_baixa_venda', '1') !== '1') return;
  for (const it of (itens || [])) {
    const cod = it.produto_codigo || it.codigo || it.cod; const qtd = +it.qtd || +it.quantidade || 0;
    if (!cod || qtd <= 0 || temFichaAtiva(cod)) continue;
    if (!db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(cod)) continue;
    registrarMovimento(cod, estorno ? 'entrada' : 'saida', { quantidade: qtd, motivo: estorno ? 'estorno venda' : 'venda', referencia: (estorno ? 'estorno-venda#' : 'venda#') + vendaId });
  }
}
// Embalagem automática na venda: 1 SACOLA por unidade (todos os produtos) + 1 SACO por unidade
// nos produtos A GRANEL (açaí/farinha/tapioca — flag granel). Consome os insumos "Sacola"/"Saco"
// (achados por nome) → o custo entra no saldo/custo dos insumos. Desligável por config embalagem_auto.
function consumirEmbalagemVenda(itens, vendaId) {
  if (getConfig('embalagem_auto', '1') !== '1') return;
  // prefere o insumo de nome EXATO "sacola"/"saco" (ignora "saco de meio kg" etc.); só cai no LIKE se não houver exato
  const sacola = db.prepare("SELECT id FROM insumos WHERE lower(nome)='sacola' LIMIT 1").get()
    || db.prepare("SELECT id FROM insumos WHERE lower(nome) LIKE '%sacola%' ORDER BY id LIMIT 1").get();
  const saco = db.prepare("SELECT id FROM insumos WHERE lower(nome)='saco' LIMIT 1").get()
    || db.prepare("SELECT id FROM insumos WHERE lower(nome) LIKE 'saco%' AND lower(nome) NOT LIKE '%sacola%' ORDER BY id LIMIT 1").get();
  if (!sacola && !saco) return;
  for (const it of (itens || [])) {
    const cod = it.produto_codigo || it.codigo || it.cod, qtd = +it.qtd || +it.quantidade || 0;
    if (!cod || qtd <= 0) continue;
    if (sacola) { try { movimentarInsumo(sacola.id, 'consumo', qtd, 0, 'embalagem-venda', 'venda#' + vendaId); } catch {} }
    if (saco) { const p = db.prepare('SELECT granel FROM produtos WHERE codigo=?').get(cod); if (p && p.granel) { try { movimentarInsumo(saco.id, 'consumo', qtd, 0, 'embalagem-venda', 'venda#' + vendaId); } catch {} } }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   FASE 44 — MOVIMENTAÇÕES NÃO COMERCIAIS
   Toda entrada/saída de estoque que NÃO é venda, com MOTIVO obrigatório
   (consumo interno, perda, brinde, degustação, doação, ajuste, quebra,
   consumo na produção, e outros configuráveis). Reusa `registrarMovimento`
   (único ponto de mutação de estoque). NUNCA gera venda nem receita.
   Alimenta relatórios, a conferência do fechamento e o contexto da IA.
   ══════════════════════════════════════════════════════════════════════════ */
migrar('fase44_movimentacoes_nc', () => {
  db.exec(`CREATE TABLE IF NOT EXISTS movimentacoes_nc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_codigo TEXT NOT NULL, produto_nome TEXT, unidade TEXT,
    tipo TEXT NOT NULL, sentido TEXT NOT NULL,
    quantidade REAL NOT NULL, delta REAL,
    estoque_anterior REAL, estoque_novo REAL,
    funcionario TEXT, usuario TEXT, obs TEXT,
    referencia TEXT, origem TEXT,
    data TEXT, criado_em TEXT, estornado INTEGER DEFAULT 0)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_movnc_data ON movimentacoes_nc(data)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_movnc_produto ON movimentacoes_nc(produto_codigo)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_movnc_tipo ON movimentacoes_nc(tipo)');
  try { db.exec('ALTER TABLE produtos ADD COLUMN mov_nc_tipos TEXT'); } catch {} // JSON de chaves; vazio = todas permitidas
});
// Tipos canônicos — CONFIGURÁVEIS (guardados em config JSON; dá pra criar novos sem programar).
const MOVNC_TIPOS_PADRAO = [
  { chave: 'consumo_interno', label: 'Consumo interno', sentido: 'saida', icone: '🧑‍🍳' },
  { chave: 'perda', label: 'Perda', sentido: 'saida', icone: '🗑️' },
  { chave: 'quebra', label: 'Quebra', sentido: 'saida', icone: '💥' },
  { chave: 'brinde', label: 'Brinde', sentido: 'saida', icone: '🎁' },
  { chave: 'degustacao', label: 'Degustação', sentido: 'saida', icone: '🥄' },
  { chave: 'doacao', label: 'Doação', sentido: 'saida', icone: '🤝' },
  { chave: 'consumo_producao', label: 'Consumo na produção', sentido: 'saida', icone: '🏭' },
  { chave: 'ajuste', label: 'Ajuste de estoque', sentido: 'ajuste', icone: '⚖️' },
];
function movncTipos() {
  let arr = null; try { const raw = getConfig('mov_nc_tipos', null); if (raw) arr = JSON.parse(raw); } catch {}
  return (Array.isArray(arr) && arr.length) ? arr : MOVNC_TIPOS_PADRAO;
}
const movncTipo = (chave) => movncTipos().find(t => t.chave === chave) || null;
// Tipos permitidos p/ um produto — cadastro mestre (vazio/null = todos). Sem programar p/ novos produtos.
function movncTiposDoProduto(cod) {
  const p = db.prepare('SELECT mov_nc_tipos FROM produtos WHERE codigo=?').get(cod);
  let permit = null; try { if (p && p.mov_nc_tipos) permit = JSON.parse(p.mov_nc_tipos); } catch {}
  const todos = movncTipos();
  return (Array.isArray(permit) && permit.length) ? todos.filter(t => permit.includes(t.chave)) : todos;
}
function movncFront(m) {
  if (!m) return null;
  const t = movncTipo(m.tipo) || { label: m.tipo, icone: '•' };
  const dt = m.criado_em ? new Date(m.criado_em) : null;
  return { ...m, tipo_label: t.label, tipo_icone: t.icone,
    hora: dt ? String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0') : '' };
}
// Registra UMA movimentação → move o estoque via registrarMovimento (único ponto). NUNCA toca financeiro.
// Custo do dia carimbado em cada movimentação (consumo/perda/brinde…): congela o precoCompra
// vigente no momento do lançamento, pra o valor não mudar depois se o custo do produto mudar.
try { db.exec('ALTER TABLE movimentacoes_nc ADD COLUMN custo_unit REAL'); } catch {}
try { db.exec('ALTER TABLE movimentacoes_nc ADD COLUMN valor REAL'); } catch {}
function salvarMovNC(d, usuario, origem) {
  const cod = d.produto_codigo || d.codigo; if (!cod) throw new Error('Produto é obrigatório.');
  const prod = db.prepare("SELECT codigo, nome, COALESCE(unidade,'un') unidade, COALESCE(estoque,0) estoque, COALESCE(precoCompra,0) custo FROM produtos WHERE codigo=?").get(cod);
  if (!prod) throw new Error('Produto não encontrado.');
  const t = movncTipo(d.tipo); if (!t) throw new Error('Tipo de movimentação inválido.');
  if (!movncTiposDoProduto(cod).some(x => x.chave === t.chave)) throw new Error('Produto não habilitado para "' + t.label + '".');
  const qtd = Math.abs(+d.quantidade || 0); if (!(qtd > 0)) throw new Error('Quantidade deve ser maior que zero.');
  const atual = +prod.estoque || 0;
  // Ajuste pode ser entrada (+) ou saída (−) conforme sentido_ajuste; os demais têm sentido fixo.
  const efet = t.sentido === 'ajuste' ? (d.sentido_ajuste === 'entrada' ? 'entrada' : 'saida') : t.sentido;
  const delta = efet === 'entrada' ? qtd : -qtd;
  const estoqueNovo = Math.max(0, r2(atual + delta));
  const custoUnit = r2(+prod.custo || 0);         // custo do dia = precoCompra vigente agora
  const valor = r2(custoUnit * qtd);              // valor da movimentação (mercadoria que saiu/entrou)
  const agora = new Date().toISOString(), dataYmd = ymdLocal(new Date());
  const id = db.prepare(`INSERT INTO movimentacoes_nc (produto_codigo,produto_nome,unidade,tipo,sentido,quantidade,delta,estoque_anterior,estoque_novo,funcionario,usuario,obs,referencia,origem,data,criado_em,estornado,custo_unit,valor)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(cod, prod.nome, prod.unidade, t.chave, t.sentido, qtd, r2(delta), r2(atual), estoqueNovo,
    (d.funcionario || '').trim(), usuario || '', (d.obs || '').trim(), '', origem || 'modulo', dataYmd, agora, custoUnit, valor).lastInsertRowid;
  // move o estoque: ajuste usa valor absoluto; saída/entrada usam a quantidade
  const movTipo = t.sentido === 'ajuste' ? 'ajuste' : (delta > 0 ? 'entrada' : 'saida');
  registrarMovimento(cod, movTipo, { quantidade: qtd, estoque_novo: t.sentido === 'ajuste' ? estoqueNovo : undefined, estoque_anterior: atual,
    motivo: t.label + ((d.funcionario || '').trim() ? ' · ' + d.funcionario.trim() : ''), referencia: 'movnc#' + id });
  db.prepare('UPDATE movimentacoes_nc SET referencia=? WHERE id=?').run('movnc#' + id, id);
  manut.logAcao('movimentação não comercial', 'estoque', { id, tipo: t.chave, produto: cod, qtd, delta: r2(delta), origem, por: usuario }, 'operacao');
  return movncFront(db.prepare('SELECT * FROM movimentacoes_nc WHERE id=?').get(id));
}
// Estorno: reverte o delta aplicado ao estoque (auditável). Gestor.
function estornarMovNC(id, usuario) {
  const m = db.prepare('SELECT * FROM movimentacoes_nc WHERE id=?').get(+id);
  if (!m) throw new Error('Movimentação não encontrada.');
  if (m.estornado) throw new Error('Movimentação já estornada.');
  if (db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(m.produto_codigo)) {
    const rev = (+m.delta || 0) >= 0 ? 'saida' : 'entrada';
    registrarMovimento(m.produto_codigo, rev, { quantidade: Math.abs(+m.delta || 0), motivo: 'estorno · ' + ((movncTipo(m.tipo) || {}).label || m.tipo), referencia: 'estorno-movnc#' + id });
  }
  db.prepare('UPDATE movimentacoes_nc SET estornado=1 WHERE id=?').run(+id);
  manut.logAcao('movimentação não comercial estornada', 'estoque', { id: +id, por: usuario }, 'operacao');
  return { ok: true };
}
// Resumo p/ relatórios e IA (últimos N dias): total por tipo + saídas do dia.
function movncResumo(dias) {
  const desde = ymdLocal(new Date(Date.now() - (dias || 30) * 864e5));
  const hoje = ymdLocal(new Date());
  const porTipo = db.prepare('SELECT tipo, COUNT(*) n, SUM(quantidade) q FROM movimentacoes_nc WHERE estornado=0 AND data>=? GROUP BY tipo ORDER BY n DESC').all(desde)
    .map(r => ({ ...r, ...(movncTipo(r.tipo) || { label: r.tipo, icone: '•' }), q: r2(r.q) }));
  const total = db.prepare('SELECT COUNT(*) n FROM movimentacoes_nc WHERE estornado=0 AND data>=?').get(desde).n;
  const hojeN = db.prepare('SELECT COUNT(*) n FROM movimentacoes_nc WHERE estornado=0 AND data=?').get(hoje).n;
  return { desde, dias: dias || 30, total, hoje: hojeN, porTipo };
}

// ── Endpoints ──
app.get('/api/movimentacoes/tipos', (req, res) => res.json({ tipos: movncTipos() }));
// Produtos p/ a tela: com unidade, estoque e os tipos que cada um aceita (cadastro mestre).
app.get('/api/movimentacoes/produtos', (req, res) => {
  const q = (req.query.q || '').trim();
  const rows = (q ? db.prepare("SELECT codigo,nome,COALESCE(unidade,'un') unidade,COALESCE(estoque,0) estoque FROM produtos WHERE codigo LIKE ? OR nome LIKE ? ORDER BY nome").all(`%${q}%`, `%${q}%`)
    : db.prepare("SELECT codigo,nome,COALESCE(unidade,'un') unidade,COALESCE(estoque,0) estoque FROM produtos ORDER BY nome").all());
  res.json(rows.map(p => ({ ...p, estoque: r2(p.estoque), tipos: movncTiposDoProduto(p.codigo).map(t => t.chave) })));
});
// Nomes de funcionários já usados + usuários ativos (autocomplete do "responsável").
app.get('/api/movimentacoes/funcionarios', (req, res) => {
  const funcs = db.prepare("SELECT nome FROM funcionarios WHERE ativo=1 ORDER BY nome").all().map(r => r.nome);
  const users = db.prepare("SELECT nome FROM usuarios WHERE ativo=1 ORDER BY nome").all().map(r => r.nome);
  const usados = db.prepare("SELECT DISTINCT funcionario FROM movimentacoes_nc WHERE funcionario IS NOT NULL AND funcionario<>'' ORDER BY funcionario").all().map(r => r.funcionario);
  res.json({ funcionarios: [...new Set([...funcs, ...users, ...usados])] });   // cadastrados 1º, depois usuários, depois nomes já usados
});
// ── CADASTRO de FUNCIONÁRIOS (quem pega consumo interno) — não precisa ser usuário do sistema ──
db.exec(`CREATE TABLE IF NOT EXISTS funcionarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, ativo INTEGER DEFAULT 1, criado_em TEXT)`);
app.get('/api/funcionarios', (req, res) => {
  res.json(db.prepare('SELECT id,nome,ativo FROM funcionarios ORDER BY nome').all().map(f => ({ id: f.id, nome: f.nome, ativo: !!f.ativo })));
});
app.post('/api/funcionarios', (req, res) => {
  const nome = ((req.body || {}).nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'Informe o nome do funcionário.' });
  const ja = db.prepare('SELECT id FROM funcionarios WHERE lower(trim(nome))=lower(?)').get(nome);
  if (ja) { db.prepare('UPDATE funcionarios SET ativo=1 WHERE id=?').run(ja.id); return res.json({ id: ja.id, nome, ativo: true, jaExistia: true }); }
  const info = db.prepare('INSERT INTO funcionarios (nome,ativo,criado_em) VALUES (?,1,?)').run(nome, new Date().toISOString());
  try { manut.logAcao('funcionário cadastrado', 'cadastro', { id: info.lastInsertRowid, nome }, 'admin'); } catch {}
  res.json({ id: info.lastInsertRowid, nome, ativo: true });
});
app.put('/api/funcionarios/:id', (req, res) => {
  const d = req.body || {}, f = db.prepare('SELECT * FROM funcionarios WHERE id=?').get(+req.params.id);
  if (!f) return res.status(404).json({ erro: 'Funcionário não encontrado.' });
  const nome = d.nome != null ? String(d.nome).trim() : f.nome;
  const ativo = d.ativo != null ? (d.ativo ? 1 : 0) : f.ativo;
  db.prepare('UPDATE funcionarios SET nome=?, ativo=? WHERE id=?').run(nome || f.nome, ativo, f.id);
  res.json({ id: f.id, nome: nome || f.nome, ativo: !!ativo });
});
app.delete('/api/funcionarios/:id', (req, res) => {
  db.prepare('DELETE FROM funcionarios WHERE id=?').run(+req.params.id);
  try { manut.logAcao('funcionário removido', 'cadastro', { id: +req.params.id }, 'admin'); } catch {}
  res.json({ ok: true });
});
app.get('/api/movimentacoes', (req, res) => {
  const w = [], a = [];
  if (req.query.tipo) { w.push('tipo=?'); a.push(req.query.tipo); }
  if (req.query.produto) { w.push('produto_codigo=?'); a.push(req.query.produto); }
  if (req.query.de) { w.push('data>=?'); a.push(req.query.de); }
  if (req.query.ate) { w.push('data<=?'); a.push(req.query.ate); }
  if (req.query.excluir_estornadas === '1') w.push('estornado=0');
  const clause = w.length ? ' WHERE ' + w.join(' AND ') : '';
  res.json(db.prepare(`SELECT * FROM movimentacoes_nc${clause} ORDER BY id DESC LIMIT 300`).all(...a).map(movncFront));
});
app.get('/api/movimentacoes/resumo', (req, res) => res.json(movncResumo(+req.query.dias || 30)));
app.post('/api/movimentacoes', (req, res) => {
  try { res.json(salvarMovNC(req.body || {}, (req.usuario || {}).nome || (req.usuario || {}).usuario || '', req.body && req.body.origem === 'fechamento' ? 'fechamento' : 'modulo')); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});
app.delete('/api/movimentacoes/:id', (req, res) => {
  if (!gateFinLancar(req, res)) return; // estorno mexe em estoque → gestor
  try { res.json(estornarMovNC(req.params.id, (req.usuario || {}).usuario || '')); } catch (e) { res.status(400).json({ erro: e.message }); }
});
// Pesquisa inteligente do CONSUMO INTERNO — o que foi consumido e por quem, com valor (custo)
// por funcionário e por produto + insights. Filtros: de, ate, funcionario, q (nome).
app.get('/api/consumo/inteligente', (req, res) => {
  const w = ["tipo='consumo_interno'", 'estornado=0'], a = [];
  if (req.query.de) { w.push('data>=?'); a.push(req.query.de); }
  if (req.query.ate) { w.push('data<=?'); a.push(req.query.ate); }
  if (req.query.funcionario) { w.push('funcionario=?'); a.push(req.query.funcionario); }
  if (req.query.q) { const t = '%' + req.query.q + '%'; w.push('(produto_nome LIKE ? OR funcionario LIKE ?)'); a.push(t, t); }
  const lista = db.prepare(`SELECT id, produto_codigo, produto_nome, unidade, quantidade, funcionario, usuario, data, criado_em, COALESCE(custo_unit,0) custo_unit, COALESCE(valor,0) valor FROM movimentacoes_nc WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT 300`).all(...a);
  const custoDe = {}, porFunc = {}, porProd = {}; let totalQtd = 0, totalValor = 0;
  for (const m of lista) {
    const q = +m.quantidade || 0;
    // usa o CUSTO DO DIA carimbado no lançamento; só recalcula pelo custo atual em registros antigos (valor=0)
    let val;
    if (+m.valor > 0) val = r2(+m.valor);
    else { if (custoDe[m.produto_codigo] === undefined) { const p = db.prepare('SELECT COALESCE(precoCompra,0) c FROM produtos WHERE codigo=?').get(m.produto_codigo); custoDe[m.produto_codigo] = p ? +p.c : 0; } val = r2(q * custoDe[m.produto_codigo]); }
    totalQtd += q; totalValor += val;
    const fn = m.funcionario || '—'; (porFunc[fn] = porFunc[fn] || { nome: fn, qtd: 0, valor: 0, n: 0 }); porFunc[fn].qtd += q; porFunc[fn].valor += val; porFunc[fn].n++;
    const pn = m.produto_nome || m.produto_codigo; (porProd[pn] = porProd[pn] || { nome: pn, unidade: m.unidade, qtd: 0, valor: 0 }); porProd[pn].qtd += q; porProd[pn].valor += val;
  }
  const arrFunc = Object.values(porFunc).map(x => ({ ...x, qtd: r2(x.qtd), valor: r2(x.valor) })).sort((x, y) => y.valor - x.valor);
  const arrProd = Object.values(porProd).map(x => ({ ...x, qtd: r2(x.qtd), valor: r2(x.valor) })).sort((x, y) => y.qtd - x.qtd);
  const funcionarios = db.prepare("SELECT DISTINCT funcionario FROM movimentacoes_nc WHERE tipo='consumo_interno' AND funcionario<>'' ORDER BY funcionario").all().map(r => r.funcionario);
  res.json({ lista, porFuncionario: arrFunc, porProduto: arrProd, funcionarios, insights: { totalQtd: r2(totalQtd), totalValor: r2(totalValor), nRegistros: lista.length, quemMais: arrFunc[0] || null, produtoMais: arrProd[0] || null } });
});
// Cadastro mestre: definir quais tipos cada produto pode usar (gerencial). Vazio = todos.
app.get('/api/movimentacoes/config', (req, res) => {
  const rows = db.prepare("SELECT codigo,nome,COALESCE(unidade,'un') unidade,mov_nc_tipos FROM produtos ORDER BY nome").all();
  res.json({ tipos: movncTipos(), produtos: rows.map(p => { let permit = null; try { permit = p.mov_nc_tipos ? JSON.parse(p.mov_nc_tipos) : null; } catch {} return { codigo: p.codigo, nome: p.nome, unidade: p.unidade, permitidos: Array.isArray(permit) ? permit : [] }; }) });
});
app.post('/api/movimentacoes/config', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {};
  if (!d.produto_codigo) return res.status(400).json({ erro: 'produto_codigo obrigatório.' });
  const permit = Array.isArray(d.permitidos) ? d.permitidos.filter(c => movncTipo(c)) : [];
  db.prepare('UPDATE produtos SET mov_nc_tipos=? WHERE codigo=?').run(permit.length ? JSON.stringify(permit) : null, d.produto_codigo);
  res.json({ ok: true, permitidos: permit });
});

// Importação inicial do localStorage — IDEMPOTENTE: casa por telefone e não duplica lançamentos.
// Nunca apaga nada; só insere o que ainda não existe. Pode rodar várias vezes sem estragar.
app.post('/api/clientes/importar-localstorage', (req, res) => {
  const lista = Array.isArray(req.body && req.body.clientes) ? req.body.clientes : [];
  let clientesImportados = 0, clientesJaExistiam = 0, lancamentosImportados = 0, lancamentosPulados = 0;
  const agora = new Date().toISOString();
  for (const cli of lista) {
    if (!cli || !cli.nome) continue;
    let existente = cli.telefone ? clientePorTelefoneDigitos(cli.telefone) : null;
    let clienteId;
    if (existente) { clienteId = existente.id; clientesJaExistiam++; }
    else {
      const info = db.prepare('INSERT INTO clientes (nome, telefone, bairro, endereco, obs, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)')
        .run(cli.nome, cli.telefone || '', cli.bairro || '', cli.endereco || '', cli.obs || '', cli.criadoEm || agora, agora);
      clienteId = info.lastInsertRowid; clientesImportados++;
    }
    const jaExistentes = db.prepare('SELECT tipo, valor, criado_em FROM clientes_extrato WHERE cliente_id = ?').all(clienteId);
    for (const l of (cli.lancamentos || [])) {
      const data = l.data || l.criado_em || agora;
      const dup = jaExistentes.some(e => e.tipo === l.tipo && Math.abs(e.valor - l.valor) < 0.001 && e.criado_em === data);
      if (dup) { lancamentosPulados++; continue; }
      const formas = (l.formasPagas || l.formas) ? JSON.stringify(l.formasPagas || l.formas) : null;
      db.prepare('INSERT INTO clientes_extrato (cliente_id, tipo, valor, descricao, formas, referencia, criado_em) VALUES (?,?,?,?,?,?,?)')
        .run(clienteId, l.tipo, +l.valor, l.desc || l.descricao || '', formas, l.referencia || 'importado', data);
      lancamentosImportados++;
      jaExistentes.push({ tipo: l.tipo, valor: +l.valor, criado_em: data });
    }
  }
  const rel = { clientesImportados, clientesJaExistiam, lancamentosImportados, lancamentosPulados };
  console.log('📥 Importação de clientes/fiado:', rel);
  res.json(rel);
});

/* ══════════════════════════════════════════════════════════════════════════
   BI / RELATÓRIOS / GESTÃO (Fase 25) — só LEITURA sobre os dados reais.
   Nada aqui grava (exceto log de exportação). Todos os números saem das mesmas
   tabelas da operação (vendas/pedidos/pagamentos/clientes_extrato/fidelidade/
   produtos). Custo/lucro é ESTIMADO e só onde há custo confiável (precoCompra);
   delivery tem item em texto livre, então não entra no custo (ver 39_*.md).
   Acesso: admin + supervisor. Ver Parte 14. ═══════════════════════════════════ */
const PED_TOTAL = "(CASE WHEN p.total > 0 THEN p.total ELSE COALESCE(p.valor,0)+COALESCE(p.taxa,0) END)";
function podeVerBI(req) { const perfil = (req.usuario || {}).perfil; return perfil === 'admin' || perfil === 'supervisor'; }
function gateBI(req, res) { if (podeVerBI(req)) return true; res.status(403).json({ erro: 'Sem permissão para ver os relatórios de gestão. Fale com o administrador.' }); return false; }
const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Período → faixa de datas LOCAIS (o banco guarda ISO UTC; filtramos por date(col,'localtime')).
function faixaPeriodo(q) {
  const hoje = new Date();
  const per = (q && q.periodo) || '30d';
  const menos = (n) => { const o = new Date(hoje); o.setDate(o.getDate() - n); return o; };
  let de = null, ate = null, label = '';
  if (per === 'hoje') { de = ate = ymdLocal(hoje); label = 'Hoje'; }
  else if (per === 'ontem') { de = ate = ymdLocal(menos(1)); label = 'Ontem'; }
  else if (per === '7d') { de = ymdLocal(menos(6)); ate = ymdLocal(hoje); label = 'Últimos 7 dias'; }
  else if (per === '30d') { de = ymdLocal(menos(29)); ate = ymdLocal(hoje); label = 'Últimos 30 dias'; }
  else if (per === 'mes') { de = ymdLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1)); ate = ymdLocal(hoje); label = 'Este mês'; }
  else if (per === 'mes_passado') { de = ymdLocal(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)); ate = ymdLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 0)); label = 'Mês passado'; }
  else if (per === 'tudo') { de = null; ate = null; label = 'Todo o período'; }
  else if (per === 'custom') { de = ((q.de || '') + '').slice(0, 10) || null; ate = ((q.ate || '') + '').slice(0, 10) || null; label = 'Período personalizado'; }
  else { de = ymdLocal(menos(29)); ate = ymdLocal(hoje); label = 'Últimos 30 dias'; }
  return { periodo: per, de, ate, label };
}
// cláusula WHERE por período sobre uma coluna de data (col é literal confiável; datas são parametrizadas)
function wherePeriodo(col, fx) {
  const cond = [], args = [];
  if (fx.de) { cond.push(`date(${col},'localtime') >= ?`); args.push(fx.de); }
  if (fx.ate) { cond.push(`date(${col},'localtime') <= ?`); args.push(fx.ate); }
  return { clause: cond.length ? ' AND ' + cond.join(' AND ') : '', args };
}
// normaliza a forma de pagamento (balcão vem estruturado; delivery vem em texto livre)
function normalizarForma(f) {
  const s = (f || '').toLowerCase();
  if (/pix/.test(s)) return 'PIX';
  if (/dinheiro|espécie|especie|troco/.test(s)) return 'Dinheiro';
  if (/cr[eé]dito/.test(s)) return 'Cartão Crédito';
  if (/d[eé]bito/.test(s)) return 'Cartão Débito';
  if (/cart[ãa]o|cartao/.test(s)) return 'Cartão';
  if (/fiado|prazo|anota/.test(s)) return 'Fiado';
  return (f && f.trim()) ? f.trim() : 'Não informado';
}

// ── Núcleos reutilizados (JSON + CSV) ───────────────────────────────────────
function biVisaoGeral(fx) {
  const wv = wherePeriodo('v.data', fx), wp = wherePeriodo('p.criado', fx), we = wherePeriodo('entregue_em', fx), wx = wherePeriodo('criado_em', fx);
  const bal = db.prepare(`SELECT COALESCE(SUM(total),0) fat, COUNT(*) n FROM vendas v WHERE v.status='concluida'${wv.clause}`).get(...wv.args);
  const del = db.prepare(`SELECT COALESCE(SUM(${PED_TOTAL}),0) fat, COUNT(*) n FROM pedidos p WHERE p.status<>'cancelado'${wp.clause}`).get(...wp.args);
  const custoRow = db.prepare(`SELECT COALESCE(SUM(i.qtd*COALESCE(pr.precoCompra,0)),0) custo,
      COALESCE(SUM(CASE WHEN COALESCE(pr.precoCompra,0)>0 THEN i.subtotal ELSE 0 END),0) fatComCusto,
      COALESCE(SUM(i.subtotal),0) fatItens
    FROM vendas_itens i JOIN vendas v ON v.id=i.venda_id
    LEFT JOIN produtos pr ON pr.codigo = COALESCE(NULLIF(i.produto_codigo,''), i.codigo)
    WHERE v.status='concluida'${wv.clause}`).get(...wv.args);
  const faturamento = bal.fat + del.fat, nTx = bal.n + del.n;
  const lucro = custoRow.fatComCusto - custoRow.custo;
  const clientes = db.prepare(`SELECT COUNT(*) n FROM (
      SELECT cliente_id FROM vendas v WHERE v.status='concluida' AND cliente_id IS NOT NULL${wv.clause}
      UNION SELECT cliente_id FROM pedidos p WHERE p.status<>'cancelado' AND cliente_id IS NOT NULL${wp.clause})`).get(...wv.args, ...wp.args).n;
  const fiadoReceb = db.prepare(`SELECT COALESCE(SUM(valor),0) t FROM clientes_extrato WHERE tipo='pagamento'${wx.clause}`).get(...wx.args).t;
  const fiadoAberto = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END),0) t FROM clientes_extrato`).get().t;
  const ent = db.prepare(`SELECT COUNT(*) n, COALESCE(AVG(tempo_entrega_min),0) tmedio FROM pedidos p WHERE p.status='entregue' AND entregue_em IS NOT NULL${we.clause}`).get(...we.args);
  const cash = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='credito' THEN valor ELSE 0 END),0) creditado, COALESCE(SUM(CASE WHEN tipo='resgate' THEN valor ELSE 0 END),0) resgatado FROM fidelidade_movimentos WHERE 1=1${wx.clause}`).get(...wx.args);
  return {
    periodo: fx, faturamento, faturamentoBalcao: bal.fat, faturamentoDelivery: del.fat,
    nVendas: bal.n, nPedidos: del.n, nTransacoes: nTx, ticketMedio: nTx ? faturamento / nTx : 0,
    custoEstimado: custoRow.custo, lucroEstimado: lucro, faturamentoComCusto: custoRow.fatComCusto,
    margemEstimada: custoRow.fatComCusto > 0 ? lucro / custoRow.fatComCusto : 0,
    coberturaCusto: custoRow.fatItens > 0 ? custoRow.fatComCusto / custoRow.fatItens : 0,
    clientesAtendidos: clientes, fiadoRecebido: fiadoReceb, fiadoAbertoTotal: fiadoAberto,
    entregasConcluidas: ent.n, tempoMedioEntregaMin: ent.tmedio,
    cashbackCreditado: cash.creditado, cashbackResgatado: cash.resgatado,
  };
}
function biFinanceiro(fx) {
  const wv = wherePeriodo('v.data', fx), wp = wherePeriodo('p.criado', fx), wx = wherePeriodo('criado_em', fx);
  const bal = db.prepare(`SELECT COALESCE(SUM(total),0) fat, COUNT(*) n FROM vendas v WHERE v.status='concluida'${wv.clause}`).get(...wv.args);
  const del = db.prepare(`SELECT COALESCE(SUM(${PED_TOTAL}),0) fat, COUNT(*) n FROM pedidos p WHERE p.status<>'cancelado'${wp.clause}`).get(...wp.args);
  const balPg = db.prepare(`SELECT p.forma forma, COALESCE(SUM(p.valor),0) total, COUNT(*) n FROM pagamentos p JOIN vendas v ON v.id=p.venda_id WHERE v.status='concluida'${wv.clause} GROUP BY p.forma`).all(...wv.args);
  const delPg = db.prepare(`SELECT pagamento forma, COALESCE(SUM(${PED_TOTAL}),0) total, COUNT(*) n FROM pedidos p WHERE p.status<>'cancelado'${wp.clause} GROUP BY pagamento`).all(...wp.args);
  const mapa = {};
  for (const r of [...balPg, ...delPg]) { const k = normalizarForma(r.forma); (mapa[k] || (mapa[k] = { forma: k, total: 0, n: 0 })); mapa[k].total += r.total; mapa[k].n += r.n; }
  const formasPagamento = Object.values(mapa).sort((a, b) => b.total - a.total);
  const evBal = db.prepare(`SELECT date(v.data,'localtime') dia, COALESCE(SUM(total),0) fat, COUNT(*) n FROM vendas v WHERE v.status='concluida'${wv.clause} GROUP BY dia`).all(...wv.args);
  const evDel = db.prepare(`SELECT date(p.criado,'localtime') dia, COALESCE(SUM(${PED_TOTAL}),0) fat, COUNT(*) n FROM pedidos p WHERE p.status<>'cancelado'${wp.clause} GROUP BY dia`).all(...wp.args);
  const dias = {};
  const bump = (d, k, fat, n) => { (dias[d] || (dias[d] = { dia: d, balcao: 0, delivery: 0, total: 0, n: 0 })); dias[d][k] += fat; dias[d].total += fat; dias[d].n += n; };
  for (const r of evBal) bump(r.dia, 'balcao', r.fat, r.n);
  for (const r of evDel) bump(r.dia, 'delivery', r.fat, r.n);
  const evolucao = Object.values(dias).sort((a, b) => (a.dia || '').localeCompare(b.dia || ''));
  const fiadoReceb = db.prepare(`SELECT COALESCE(SUM(valor),0) t FROM clientes_extrato WHERE tipo='pagamento'${wx.clause}`).get(...wx.args).t;
  const fiadoLancado = db.prepare(`SELECT COALESCE(SUM(valor),0) t FROM clientes_extrato WHERE tipo='compra'${wx.clause}`).get(...wx.args).t;
  const fiadoAberto = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END),0) t FROM clientes_extrato`).get().t;
  const topDevedores = db.prepare(`SELECT c.id, c.nome, c.telefone, COALESCE(SUM(CASE WHEN e.tipo='compra' THEN e.valor ELSE -e.valor END),0) saldo
    FROM clientes c JOIN clientes_extrato e ON e.cliente_id=c.id GROUP BY c.id HAVING saldo > 0.001 ORDER BY saldo DESC LIMIT 10`).all();
  return {
    periodo: fx, faturamento: bal.fat + del.fat, faturamentoBalcao: bal.fat, faturamentoDelivery: del.fat,
    nVendas: bal.n, nPedidos: del.n, ticketMedio: (bal.n + del.n) ? (bal.fat + del.fat) / (bal.n + del.n) : 0,
    formasPagamento, evolucao,
    fiado: { recebido: fiadoReceb, lancado: fiadoLancado, aberto: fiadoAberto, topDevedores },
  };
}
function biProdutos(fx) {
  const wv = wherePeriodo('v.data', fx);
  const rows = db.prepare(`SELECT COALESCE(NULLIF(i.produto_codigo,''), i.codigo) prod_codigo, MAX(i.nome) nome,
      SUM(i.qtd) qtd, SUM(i.subtotal) faturamento, COALESCE(MAX(pr.precoCompra),0) custoUnit, SUM(i.qtd*COALESCE(pr.precoCompra,0)) custo
    FROM vendas_itens i JOIN vendas v ON v.id=i.venda_id
    LEFT JOIN produtos pr ON pr.codigo = COALESCE(NULLIF(i.produto_codigo,''), i.codigo)
    WHERE v.status='concluida'${wv.clause}
    GROUP BY COALESCE(NULLIF(i.produto_codigo,''), i.codigo) ORDER BY faturamento DESC`).all(...wv.args);
  const totalFat = rows.reduce((s, r) => s + (r.faturamento || 0), 0);
  let acc = 0;
  const prods = rows.map(r => {
    const temCusto = r.custoUnit > 0;
    const lucro = temCusto ? r.faturamento - r.custo : null;
    return { codigo: r.prod_codigo, nome: r.nome, qtd: r.qtd, faturamento: r.faturamento, custoUnit: r.custoUnit, custo: temCusto ? r.custo : null,
      temCusto, lucro, margem: (temCusto && r.faturamento > 0) ? lucro / r.faturamento : null, participacao: totalFat ? r.faturamento / totalFat : 0 };
  });
  for (const p of prods) { acc += p.participacao; p.acumulado = acc; p.classeABC = acc <= 0.8 ? 'A' : acc <= 0.95 ? 'B' : 'C'; }
  const comCusto = prods.filter(p => p.temCusto);
  return {
    periodo: fx, totalProdutos: prods.length, totalFaturamento: totalFat, semCusto: prods.length - comCusto.length,
    maisVendidos: [...prods].sort((a, b) => b.qtd - a.qtd).slice(0, 20),
    maisFaturaram: prods.slice(0, 20),
    maisLucro: [...comCusto].sort((a, b) => b.lucro - a.lucro).slice(0, 20),
    maiorMargem: [...comCusto].sort((a, b) => b.margem - a.margem).slice(0, 20),
    baixoGiro: [...prods].sort((a, b) => a.qtd - b.qtd).slice(0, 15),
    abc: prods,
  };
}
function biClientes(fx) {
  const wv = wherePeriodo('v.data', fx), wp = wherePeriodo('p.criado', fx), wc = wherePeriodo('criado_em', fx), wx = wherePeriodo('criado_em', fx);
  const rows = db.prepare(`SELECT cliente_id, SUM(n) compras, SUM(total) gasto FROM (
      SELECT cliente_id, COUNT(*) n, COALESCE(SUM(total),0) total FROM vendas v WHERE v.status='concluida' AND cliente_id IS NOT NULL${wv.clause} GROUP BY cliente_id
      UNION ALL
      SELECT cliente_id, COUNT(*) n, COALESCE(SUM(${PED_TOTAL}),0) total FROM pedidos p WHERE p.status<>'cancelado' AND cliente_id IS NOT NULL${wp.clause} GROUP BY cliente_id
    ) GROUP BY cliente_id`).all(...wv.args, ...wp.args);
  const nomes = {}; for (const c of db.prepare('SELECT id,nome,telefone,bairro FROM clientes').all()) nomes[c.id] = c;
  const info = rows.map(r => ({ id: r.cliente_id, nome: (nomes[r.cliente_id] || {}).nome || ('Cliente #' + r.cliente_id), telefone: (nomes[r.cliente_id] || {}).telefone || '', compras: r.compras, gasto: r.gasto }));
  const novos = db.prepare(`SELECT id,nome,telefone,bairro,criado_em FROM clientes WHERE criado_em IS NOT NULL${wc.clause} ORDER BY criado_em DESC`).all(...wc.args);
  const comFiado = db.prepare(`SELECT c.id,c.nome,c.telefone, COALESCE(SUM(CASE WHEN e.tipo='compra' THEN e.valor ELSE -e.valor END),0) saldo
    FROM clientes c JOIN clientes_extrato e ON e.cliente_id=c.id GROUP BY c.id HAVING saldo>0.001 ORDER BY saldo DESC LIMIT 20`).all();
  const fid = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='credito' THEN valor ELSE 0 END),0) creditado, COALESCE(SUM(CASE WHEN tipo='resgate' THEN valor ELSE 0 END),0) resgatado FROM fidelidade_movimentos WHERE 1=1${wx.clause}`).get(...wx.args);
  const fidSaldo = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='credito' THEN valor WHEN tipo='resgate' THEN -valor ELSE valor END),0) t FROM fidelidade_movimentos`).get().t;
  return {
    periodo: fx, clientesNoPeriodo: info.length,
    maisCompraram: [...info].sort((a, b) => b.compras - a.compras).slice(0, 20),
    maisGastaram: [...info].sort((a, b) => b.gasto - a.gasto).slice(0, 20),
    novos: novos.length, novosLista: novos.slice(0, 20), comFiado,
    fidelidade: { creditadoPeriodo: fid.creditado, resgatadoPeriodo: fid.resgatado, saldoTotal: fidSaldo },
  };
}
function biDelivery(fx) {
  const wp = wherePeriodo('p.criado', fx), we = wherePeriodo('entregue_em', fx), wv = wherePeriodo('v.data', fx);
  const total = db.prepare(`SELECT COUNT(*) n,
      SUM(CASE WHEN p.status='entregue' THEN 1 ELSE 0 END) entregues,
      SUM(CASE WHEN p.status='cancelado' THEN 1 ELSE 0 END) cancelados
    FROM pedidos p WHERE 1=1${wp.clause}`).get(...wp.args);
  const fatDel = db.prepare(`SELECT COALESCE(SUM(${PED_TOTAL}),0) fat, COUNT(*) n FROM pedidos p WHERE p.status<>'cancelado'${wp.clause}`).get(...wp.args);
  const tempo = db.prepare(`SELECT COALESCE(AVG(tempo_entrega_min),0) tmedio FROM pedidos p WHERE p.status='entregue' AND tempo_entrega_min IS NOT NULL${we.clause}`).get(...we.args);
  const ranking = db.prepare(`SELECT e.id, e.nome, COUNT(*) entregas, COALESCE(AVG(p.tempo_entrega_min),0) tempoMedio, COALESCE(SUM(${PED_TOTAL}),0) faturamento
    FROM pedidos p JOIN entregadores e ON e.id=p.entregador_id WHERE p.status='entregue' AND p.entregue_em IS NOT NULL${we.clause}
    GROUP BY e.id ORDER BY entregas DESC`).all(...we.args);
  const emRotaAgora = db.prepare("SELECT COUNT(*) n FROM pedidos WHERE status='rota'").get().n;
  const bal = db.prepare(`SELECT COALESCE(SUM(total),0) fat, COUNT(*) n FROM vendas v WHERE v.status='concluida'${wv.clause}`).get(...wv.args);
  const porBairro = db.prepare(`SELECT COALESCE(NULLIF(TRIM(bairro),''),'—') bairro, COUNT(*) n, COALESCE(SUM(${PED_TOTAL}),0) fat
    FROM pedidos p WHERE p.status<>'cancelado'${wp.clause} GROUP BY bairro ORDER BY n DESC LIMIT 15`).all(...wp.args);
  return {
    periodo: fx, pedidos: fatDel.n, faturamento: fatDel.fat, entregues: total.entregues || 0, cancelados: total.cancelados || 0,
    tempoMedioMin: tempo.tmedio, rankingEntregadores: ranking, emRotaAgora,
    comparativo: { balcao: { fat: bal.fat, n: bal.n }, delivery: { fat: fatDel.fat, n: fatDel.n } }, porBairro,
  };
}
function biHorarios(fx) {
  const wv = wherePeriodo('v.data', fx), wp = wherePeriodo('p.criado', fx);
  const horaBal = db.prepare(`SELECT strftime('%H',v.data,'localtime') h, COUNT(*) n, COALESCE(SUM(total),0) fat FROM vendas v WHERE v.status='concluida'${wv.clause} GROUP BY h`).all(...wv.args);
  const horaDel = db.prepare(`SELECT strftime('%H',p.criado,'localtime') h, COUNT(*) n, COALESCE(SUM(${PED_TOTAL}),0) fat FROM pedidos p WHERE p.status<>'cancelado'${wp.clause} GROUP BY h`).all(...wp.args);
  const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, balcao: 0, delivery: 0, total: 0, n: 0 }));
  for (const r of horaBal) { const h = +r.h; horas[h].balcao += r.fat; horas[h].total += r.fat; horas[h].n += r.n; }
  for (const r of horaDel) { const h = +r.h; horas[h].delivery += r.fat; horas[h].total += r.fat; horas[h].n += r.n; }
  const NOMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const dow = NOMES.map((nome, i) => ({ dia: i, nome, total: 0, n: 0 }));
  for (const r of db.prepare(`SELECT strftime('%w',v.data,'localtime') w, COUNT(*) n, COALESCE(SUM(total),0) fat FROM vendas v WHERE v.status='concluida'${wv.clause} GROUP BY w`).all(...wv.args)) { const w = +r.w; dow[w].total += r.fat; dow[w].n += r.n; }
  for (const r of db.prepare(`SELECT strftime('%w',p.criado,'localtime') w, COUNT(*) n, COALESCE(SUM(${PED_TOTAL}),0) fat FROM pedidos p WHERE p.status<>'cancelado'${wp.clause} GROUP BY w`).all(...wp.args)) { const w = +r.w; dow[w].total += r.fat; dow[w].n += r.n; }
  const melhorHora = horas.reduce((a, b) => b.total > a.total ? b : a, horas[0]);
  const melhorDia = dow.reduce((a, b) => b.total > a.total ? b : a, dow[0]);
  const picoDel = horas.reduce((a, b) => b.delivery > a.delivery ? b : a, horas[0]);
  return { periodo: fx, porHora: horas, porDiaSemana: dow,
    melhorHora: melhorHora.total > 0 ? melhorHora.hora : null, melhorDia: melhorDia.total > 0 ? melhorDia.nome : null,
    picoDeliveryHora: picoDel.delivery > 0 ? picoDel.hora : null };
}

// ── Endpoints BI (JSON) ─────────────────────────────────────────────────────
app.get('/api/bi/visao-geral', (req, res) => { if (!gateBI(req, res)) return; res.json(biVisaoGeral(faixaPeriodo(req.query))); });
app.get('/api/bi/financeiro', (req, res) => { if (!gateBI(req, res)) return; res.json(biFinanceiro(faixaPeriodo(req.query))); });
app.get('/api/bi/produtos', (req, res) => { if (!gateBI(req, res)) return; res.json(biProdutos(faixaPeriodo(req.query))); });
app.get('/api/bi/clientes', (req, res) => { if (!gateBI(req, res)) return; res.json(biClientes(faixaPeriodo(req.query))); });
app.get('/api/bi/delivery', (req, res) => { if (!gateBI(req, res)) return; res.json(biDelivery(faixaPeriodo(req.query))); });
app.get('/api/bi/horarios', (req, res) => { if (!gateBI(req, res)) return; res.json(biHorarios(faixaPeriodo(req.query))); });

// ── Exportações CSV (produtos, clientes, financeiro) — loga em logs_acoes/bi ──
function enviarCSV(req, res, arquivo, cabecalho, linhas, tipoExport) {
  const csv = [cabecalho, ...linhas].map(r => r.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  manut.logAcao('exportação de relatório', 'bi', { tipo: tipoExport, linhas: linhas.length, periodo: (req.query || {}).periodo || '', por: (req.usuario || {}).usuario }, 'config');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${arquivo}"`);
  res.send('﻿' + csv);
}
const brl = (v) => (Number(v || 0)).toFixed(2).replace('.', ',');
app.get('/api/bi/export/produtos.csv', (req, res) => {
  if (!gateBI(req, res)) return;
  const fx = faixaPeriodo(req.query), d = biProdutos(fx);
  const linhas = d.abc.map(p => [p.codigo, p.nome, p.qtd, brl(p.faturamento), p.temCusto ? brl(p.custo) : 'sem custo', p.temCusto ? brl(p.lucro) : 'sem custo',
    p.margem == null ? 'sem custo' : (p.margem * 100).toFixed(1) + '%', (p.participacao * 100).toFixed(1) + '%', p.classeABC]);
  enviarCSV(req, res, `bi-produtos-${fx.de || 'tudo'}_${fx.ate || ''}.csv`, ['Codigo', 'Produto', 'Qtd', 'Faturamento', 'Custo estimado', 'Lucro estimado', 'Margem', 'Participacao', 'Classe ABC'], linhas, 'produtos');
});
app.get('/api/bi/export/clientes.csv', (req, res) => {
  if (!gateBI(req, res)) return;
  const fx = faixaPeriodo(req.query), d = biClientes(fx);
  const linhas = [...d.maisGastaram].map(c => [c.nome, c.telefone, c.compras, brl(c.gasto)]);
  enviarCSV(req, res, `bi-clientes-${fx.de || 'tudo'}_${fx.ate || ''}.csv`, ['Cliente', 'Telefone', 'Compras', 'Gasto'], linhas, 'clientes');
});
app.get('/api/bi/export/financeiro.csv', (req, res) => {
  if (!gateBI(req, res)) return;
  const fx = faixaPeriodo(req.query), d = biFinanceiro(fx);
  const linhas = d.evolucao.map(e => [e.dia, brl(e.balcao), brl(e.delivery), brl(e.total), e.n]);
  linhas.push([]); linhas.push(['Forma de pagamento', 'Total', 'Qtde']);
  for (const f of d.formasPagamento) linhas.push([f.forma, brl(f.total), f.n]);
  enviarCSV(req, res, `bi-financeiro-${fx.de || 'tudo'}_${fx.ate || ''}.csv`, ['Dia', 'Balcao', 'Delivery', 'Total', 'Transacoes'], linhas, 'financeiro');
});

/* ══════════════════════════════════════════════════════════════════════════
   NÚCLEO FINANCEIRO / FLUXO DE CAIXA (Fase 25) — o coração financeiro. Toda
   movimentação de dinheiro nasce aqui. Integra AUTOMATICAMENTE com PDV,
   Delivery e Fiado SEM contar o mesmo dinheiro duas vezes: cada movimento
   automático carrega a REFERÊNCIA do documento que o gerou (venda/pedido/
   extrato) e a criação é IDEMPOTENTE por essa referência. Saldos são SEMPRE
   calculados (nunca guardados), como fiado/fidelidade. Ver 40_*.md.
   ══════════════════════════════════════════════════════════════════════════ */
db.exec(`CREATE TABLE IF NOT EXISTS financeiro_contas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT,
  saldo_inicial REAL DEFAULT 0, ativo INTEGER DEFAULT 1, cor TEXT, icone TEXT, obs TEXT,
  sistema INTEGER DEFAULT 0, criado_em TEXT, atualizado_em TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS financeiro_categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT,
  cor TEXT, icone TEXT, sistema INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1, criado_em TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS financeiro_movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, tipo TEXT NOT NULL,
  conta_id INTEGER, categoria_id INTEGER, valor REAL NOT NULL, descricao TEXT,
  origem TEXT, obs TEXT, responsavel TEXT, situacao TEXT DEFAULT 'confirmado',
  referencia_tipo TEXT, referencia_id TEXT, estornado_em TEXT, estorno_motivo TEXT,
  criado_em TEXT, criado_por TEXT, atualizado_em TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_fin_mov_ref ON financeiro_movimentos(referencia_tipo, referencia_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_fin_mov_data ON financeiro_movimentos(data)');
db.exec('CREATE INDEX IF NOT EXISTS idx_fin_mov_conta ON financeiro_movimentos(conta_id)');

// Seed inicial (só se vazio) — contas e categorias que a loja já usa.
(function seedFinanceiro() {
  const agora = new Date().toISOString();
  if (!db.prepare('SELECT COUNT(*) n FROM financeiro_contas').get().n) {
    const insC = db.prepare('INSERT INTO financeiro_contas (nome,tipo,saldo_inicial,ativo,sistema,criado_em) VALUES (?,?,0,1,?,?)');
    [['Caixa', 'caixa', 1], ['PIX', 'pix', 1], ['Conta Bancária', 'banco', 0], ['InfinitePay', 'maquininha', 0],
     ['Getnet', 'maquininha', 0], ['PagSeguro', 'maquininha', 0], ['Outras', 'outro', 1]].forEach(c => insC.run(c[0], c[1], c[2], agora));
  }
  if (!db.prepare('SELECT COUNT(*) n FROM financeiro_categorias').get().n) {
    const insCat = db.prepare('INSERT INTO financeiro_categorias (nome,tipo,sistema,ativo,criado_em) VALUES (?,?,?,1,?)');
    [['Venda PDV', 'entrada', 1], ['Venda Delivery', 'entrada', 1], ['Recebimento Fiado', 'entrada', 1],
     ['Compra', 'saida', 0], ['Despesa', 'saida', 0], ['Retirada', 'saida', 0], ['Aporte', 'entrada', 0],
     ['Taxa', 'saida', 0], ['Outros', 'ambos', 0]].forEach(c => insCat.run(c[0], c[1], c[2], agora));
  }
  // conta padrão pra cartão (maquininha): default InfinitePay se existir e ainda não configurado
  if (!getConfig('financeiro_conta_cartao_id', null)) {
    const ip = db.prepare("SELECT id FROM financeiro_contas WHERE nome='InfinitePay'").get();
    if (ip) setConfig('financeiro_conta_cartao_id', ip.id);
  }
})();

// ── Saldos (SÓ movimentos 'confirmado' entram no saldo; pendente/estornado não) ──
function saldoDaConta(contaId) {
  const c = db.prepare('SELECT saldo_inicial FROM financeiro_contas WHERE id = ?').get(contaId);
  if (!c) return 0;
  const r = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) ent,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) sai
    FROM financeiro_movimentos WHERE conta_id = ? AND situacao = 'confirmado'`).get(contaId);
  return Math.round(((c.saldo_inicial || 0) + r.ent - r.sai) * 100) / 100;
}
const contaComSaldo = (c) => ({ ...c, saldo: saldoDaConta(c.id) });
function saldoTotalFinanceiro() {
  return Math.round(db.prepare('SELECT id FROM financeiro_contas WHERE ativo = 1').all().reduce((s, c) => s + saldoDaConta(c.id), 0) * 100) / 100;
}
// mapeia a forma de pagamento na conta financeira certa (reusa o normalizador do BI)
function contaParaForma(forma) {
  const f = normalizarForma(forma);
  const pega = (nome) => (db.prepare('SELECT id FROM financeiro_contas WHERE nome = ?').get(nome) || {}).id || null;
  if (f === 'Dinheiro') return pega('Caixa');
  if (f === 'PIX') return pega('PIX');
  if (/Cart[ãa]o/.test(f)) { const id = +getConfig('financeiro_conta_cartao_id', 0); if (id) return id; }
  return pega('Outras') || pega('Caixa');
}
const catFinId = (nome) => { const r = db.prepare('SELECT id FROM financeiro_categorias WHERE nome = ?').get(nome); return r ? r.id : null; };
const movsDaReferencia = (tipo, id) => db.prepare('SELECT * FROM financeiro_movimentos WHERE referencia_tipo = ? AND referencia_id = ?').all(tipo, String(id));
function inserirMovimento(m) {
  const agora = new Date().toISOString();
  // Fase 27: carimba a sessão de caixa aberta (se houver uma só) pra o fechamento
  // enxergar automaticamente esta movimentação. Passar m.caixa_sessao_id força uma sessão.
  let sessaoId = m.caixa_sessao_id != null ? m.caixa_sessao_id : null;
  if (sessaoId == null && typeof sessaoAbertaUnica === 'function') { try { sessaoId = sessaoAbertaUnica(); } catch {} }
  const info = db.prepare(`INSERT INTO financeiro_movimentos
     (data,tipo,conta_id,categoria_id,valor,descricao,origem,obs,responsavel,situacao,referencia_tipo,referencia_id,caixa_sessao_id,centro_custo_id,criado_em,criado_por,atualizado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
     m.data || agora, m.tipo, m.conta_id || null, m.categoria_id || null, +m.valor || 0, m.descricao || '',
     m.origem || 'manual', m.obs || '', m.responsavel || '', m.situacao || 'confirmado',
     m.referencia_tipo || null, m.referencia_id != null ? String(m.referencia_id) : null, sessaoId, m.centro_custo_id || null, agora, m.criado_por || '', agora);
  return info.lastInsertRowid;
}
function estornarMovimento(id, motivo, por) {
  const agora = new Date().toISOString();
  db.prepare("UPDATE financeiro_movimentos SET situacao='estornado', estornado_em=?, estorno_motivo=?, atualizado_em=? WHERE id=?").run(agora, motivo || '', agora, id);
  manut.logAcao('estorno de movimento financeiro', 'financeiro', { id, motivo: motivo || '', por: por || 'sistema' }, 'operacao');
}

/* ── INTEGRAÇÃO AUTOMÁTICA (idempotente por referência — NUNCA conta 2x) ──
   Sempre chamadas dentro de try/catch nos hooks: se algo falhar aqui, a
   operação original (venda/pedido/fiado) NÃO quebra. */
// VENDA PDV: cada pagamento vira 1 entrada na conta da forma. Fiado NÃO entra
// aqui (vira caixa só quando o cliente paga o fiado). Cancelou → estorna.
function sincronizarFinanceiroVenda(vendaId) {
  const v = db.prepare('SELECT * FROM vendas WHERE id = ?').get(vendaId);
  if (!v) return;
  const jaTem = movsDaReferencia('venda', vendaId);
  if (v.status !== 'concluida') { for (const m of jaTem) if (m.situacao !== 'estornado') estornarMovimento(m.id, 'venda cancelada', 'sistema'); return; }
  if (jaTem.length) return; // já sincronizada
  const pagamentos = db.prepare('SELECT * FROM pagamentos WHERE venda_id = ?').all(vendaId);
  const cat = catFinId('Venda PDV');
  const lista = pagamentos.length ? pagamentos : [{ forma: '', valor: v.total }];
  for (const p of lista) {
    if (/fiado|prazo|anota/i.test(p.forma || '')) continue;   // fiado E anotado = recebível, não entra no caixa até pagar
    const valor = +p.valor || 0; if (valor <= 0) continue;
    inserirMovimento({ data: v.data || v.criado_em, tipo: 'entrada', conta_id: contaParaForma(p.forma), categoria_id: cat,
      valor, descricao: `Venda #${v.numero || v.id}` + (p.forma ? ` · ${normalizarForma(p.forma)}` : ''), origem: 'pdv',
      responsavel: v.operador || '', situacao: 'confirmado', referencia_tipo: 'venda', referencia_id: vendaId });
  }
}
// RECEBIMENTO DE FIADO: só o lançamento 'pagamento' vira entrada (a 'compra' é dívida, não caixa).
function sincronizarFinanceiroFiado(lancamentoId) {
  const l = db.prepare('SELECT * FROM clientes_extrato WHERE id = ?').get(lancamentoId);
  const jaTem = movsDaReferencia('extrato', lancamentoId);
  if (!l || l.tipo !== 'pagamento') { for (const m of jaTem) if (m.situacao !== 'estornado') estornarMovimento(m.id, 'lançamento de fiado removido', 'sistema'); return; }
  if (jaTem.length) return;
  const cli = db.prepare('SELECT nome FROM clientes WHERE id = ?').get(l.cliente_id);
  let formas = []; try { formas = JSON.parse(l.formas || '[]'); } catch {}
  const base = { tipo: 'entrada', data: l.criado_em, categoria_id: catFinId('Recebimento Fiado'), origem: 'fiado', situacao: 'confirmado',
    referencia_tipo: 'extrato', referencia_id: lancamentoId, descricao: `Recebimento fiado · ${cli ? cli.nome : 'cliente'}` };
  if (Array.isArray(formas) && formas.length) {
    for (const f of formas) { const valor = +f.valor || 0; if (valor > 0) inserirMovimento({ ...base, conta_id: contaParaForma(f.nome || f.forma), valor }); }
  } else {
    inserirMovimento({ ...base, conta_id: contaParaForma('Dinheiro'), valor: +l.valor || 0 });
  }
}
// VENDA DELIVERY: pedido não-cancelado gera 1 entrada (Venda Delivery). Enquanto
// não entregue fica PENDENTE; ao ENTREGAR vira CONFIRMADO; cancelou → estorna.
function sincronizarFinanceiroPedido(pedidoId) {
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  const existentes = movsDaReferencia('pedido', pedidoId).filter(m => m.situacao !== 'estornado');
  if (!p || p.status === 'cancelado') { for (const m of existentes) estornarMovimento(m.id, p ? 'pedido cancelado' : 'pedido removido', 'sistema'); return; }
  if (/fiado|prazo/i.test(p.pagamento || '')) return; // fiado no delivery entra pelo fluxo de fiado
  const valor = +p.total || ((+p.valor || 0) + (+p.taxa || 0));
  if (valor <= 0) return;
  const situacao = p.status === 'entregue' ? 'confirmado' : 'pendente';
  const dados = { tipo: 'entrada', data: p.criado, conta_id: contaParaForma(p.pagamento), categoria_id: catFinId('Venda Delivery'),
    valor, descricao: `Pedido #${p.numero}${p.cliente ? ' · ' + p.cliente : ''}`, origem: 'delivery', situacao,
    referencia_tipo: 'pedido', referencia_id: pedidoId };
  if (existentes.length) {
    db.prepare('UPDATE financeiro_movimentos SET valor=?, conta_id=?, situacao=?, atualizado_em=? WHERE id=?')
      .run(valor, dados.conta_id, situacao, new Date().toISOString(), existentes[0].id);
  } else inserirMovimento(dados);
}
// chamada segura (nunca deixa o financeiro quebrar a operação de origem)
function syncFin(fn, id) { try { fn(id); } catch (e) { try { manut.logErro('financeiro-sync', e); } catch {} } }

// ── Endpoints ──────────────────────────────────────────────────────────────
const SELECT_MOV = `SELECT m.*, c.nome conta_nome, cat.nome categoria_nome, cc.nome centro_custo_nome
  FROM financeiro_movimentos m
  LEFT JOIN financeiro_contas c ON c.id = m.conta_id
  LEFT JOIN financeiro_categorias cat ON cat.id = m.categoria_id
  LEFT JOIN financeiro_centros_custo cc ON cc.id = m.centro_custo_id`;
const movFront = (id) => db.prepare(`${SELECT_MOV} WHERE m.id = ?`).get(id);
function gateFinLancar(req, res) { const p = (req.usuario || {}).perfil; if (p === 'admin' || p === 'supervisor') return true; res.status(403).json({ erro: 'Só administrador ou supervisor podem lançar no financeiro.' }); return false; }
function gateFinAdmin(req, res) { if ((req.usuario || {}).perfil === 'admin') return true; res.status(403).json({ erro: 'Esta ação do financeiro é restrita ao administrador.' }); return false; }
function filtrosMovimentos(q) {
  const cond = ['1=1'], args = [];
  if (q.de) { cond.push("date(m.data,'localtime') >= ?"); args.push(String(q.de).slice(0, 10)); }
  if (q.ate) { cond.push("date(m.data,'localtime') <= ?"); args.push(String(q.ate).slice(0, 10)); }
  if (q.conta_id) { cond.push('m.conta_id = ?'); args.push(+q.conta_id); }
  if (q.categoria_id) { cond.push('m.categoria_id = ?'); args.push(+q.categoria_id); }
  if (q.tipo && ['entrada', 'saida'].includes(q.tipo)) { cond.push('m.tipo = ?'); args.push(q.tipo); }
  if (q.origem) { cond.push('m.origem = ?'); args.push(q.origem); }
  if (q.situacao) { cond.push('m.situacao = ?'); args.push(q.situacao); }
  if (q.responsavel) { cond.push('m.responsavel LIKE ?'); args.push('%' + q.responsavel + '%'); }
  if (q.centro_custo_id) { cond.push('m.centro_custo_id = ?'); args.push(+q.centro_custo_id); }
  if (q.busca) { cond.push('(m.descricao LIKE ? OR m.obs LIKE ?)'); args.push('%' + q.busca + '%', '%' + q.busca + '%'); }
  return { where: cond.join(' AND '), args };
}
// Contas (CRUD — admin)
app.get('/api/financeiro/contas', (req, res) => res.json(db.prepare('SELECT * FROM financeiro_contas ORDER BY ativo DESC, nome').all().map(contaComSaldo)));
app.post('/api/financeiro/contas', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const d = req.body || {}; if (!d.nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  const agora = new Date().toISOString();
  const info = db.prepare('INSERT INTO financeiro_contas (nome,tipo,saldo_inicial,ativo,cor,icone,obs,sistema,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,0,?,?)')
    .run(d.nome, d.tipo || 'outro', +d.saldo_inicial || 0, d.ativo === false ? 0 : 1, d.cor || '', d.icone || '', d.obs || '', agora, agora);
  manut.logAcao('conta financeira criada', 'financeiro', { id: info.lastInsertRowid, nome: d.nome, por: (req.usuario || {}).usuario }, 'config');
  res.json(contaComSaldo(db.prepare('SELECT * FROM financeiro_contas WHERE id=?').get(info.lastInsertRowid)));
});
app.put('/api/financeiro/contas/:id', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const id = +req.params.id, d = req.body || {};
  db.prepare('UPDATE financeiro_contas SET nome=COALESCE(?,nome), tipo=COALESCE(?,tipo), saldo_inicial=COALESCE(?,saldo_inicial), ativo=COALESCE(?,ativo), cor=COALESCE(?,cor), obs=COALESCE(?,obs), atualizado_em=? WHERE id=?')
    .run(d.nome ?? null, d.tipo ?? null, d.saldo_inicial != null ? +d.saldo_inicial : null, d.ativo != null ? (d.ativo ? 1 : 0) : null, d.cor ?? null, d.obs ?? null, new Date().toISOString(), id);
  manut.logAcao('conta financeira editada', 'financeiro', { id, por: (req.usuario || {}).usuario }, 'config');
  res.json(contaComSaldo(db.prepare('SELECT * FROM financeiro_contas WHERE id=?').get(id)));
});
app.delete('/api/financeiro/contas/:id', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const id = +req.params.id, c = db.prepare('SELECT * FROM financeiro_contas WHERE id=?').get(id);
  if (!c) return res.status(404).json({ erro: 'Conta não encontrada.' });
  if (c.sistema) return res.status(400).json({ erro: 'Conta do sistema não pode ser excluída (pode desativar).' });
  const n = db.prepare('SELECT COUNT(*) n FROM financeiro_movimentos WHERE conta_id=?').get(id).n;
  if (n > 0) return res.status(400).json({ erro: `Conta tem ${n} movimento(s). Desative em vez de excluir.` });
  db.prepare('DELETE FROM financeiro_contas WHERE id=?').run(id);
  manut.logAcao('conta financeira excluída', 'financeiro', { id, nome: c.nome, por: (req.usuario || {}).usuario }, 'config');
  res.json({ ok: true });
});
// Categorias (CRUD — admin)
app.get('/api/financeiro/categorias', (req, res) => res.json(db.prepare('SELECT * FROM financeiro_categorias ORDER BY tipo, nome').all()));
app.post('/api/financeiro/categorias', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const d = req.body || {}; if (!d.nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  const info = db.prepare('INSERT INTO financeiro_categorias (nome,tipo,cor,icone,sistema,ativo,criado_em) VALUES (?,?,?,?,0,1,?)')
    .run(d.nome, ['entrada', 'saida', 'ambos'].includes(d.tipo) ? d.tipo : 'ambos', d.cor || '', d.icone || '', new Date().toISOString());
  manut.logAcao('categoria financeira criada', 'financeiro', { id: info.lastInsertRowid, nome: d.nome, por: (req.usuario || {}).usuario }, 'config');
  res.json(db.prepare('SELECT * FROM financeiro_categorias WHERE id=?').get(info.lastInsertRowid));
});
app.put('/api/financeiro/categorias/:id', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const id = +req.params.id, d = req.body || {};
  db.prepare('UPDATE financeiro_categorias SET nome=COALESCE(?,nome), tipo=COALESCE(?,tipo), ativo=COALESCE(?,ativo) WHERE id=?')
    .run(d.nome ?? null, d.tipo ?? null, d.ativo != null ? (d.ativo ? 1 : 0) : null, id);
  res.json(db.prepare('SELECT * FROM financeiro_categorias WHERE id=?').get(id));
});
app.delete('/api/financeiro/categorias/:id', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const id = +req.params.id, c = db.prepare('SELECT * FROM financeiro_categorias WHERE id=?').get(id);
  if (!c) return res.status(404).json({ erro: 'Categoria não encontrada.' });
  if (c.sistema) return res.status(400).json({ erro: 'Categoria do sistema não pode ser excluída.' });
  const n = db.prepare('SELECT COUNT(*) n FROM financeiro_movimentos WHERE categoria_id=?').get(id).n;
  if (n > 0) return res.status(400).json({ erro: `Categoria tem ${n} movimento(s).` });
  db.prepare('DELETE FROM financeiro_categorias WHERE id=?').run(id);
  manut.logAcao('categoria financeira excluída', 'financeiro', { id, nome: c.nome, por: (req.usuario || {}).usuario }, 'config');
  res.json({ ok: true });
});
// Movimentos — lista com filtros
app.get('/api/financeiro/movimentos', (req, res) => {
  const f = filtrosMovimentos(req.query);
  res.json(db.prepare(`${SELECT_MOV} WHERE ${f.where} ORDER BY m.data DESC, m.id DESC LIMIT 1000`).all(...f.args));
});
// Fluxo de caixa — cronológico com saldo acumulado (só confirmado)
app.get('/api/financeiro/fluxo', (req, res) => {
  const f = filtrosMovimentos(req.query);
  const rows = db.prepare(`${SELECT_MOV} WHERE ${f.where} AND m.situacao='confirmado' ORDER BY m.data ASC, m.id ASC`).all(...f.args);
  let acc = 0;
  const linhas = rows.map(m => { acc += (m.tipo === 'entrada' ? m.valor : -m.valor); return { ...m, saldoAcumulado: Math.round(acc * 100) / 100 }; });
  res.json({ linhas: linhas.reverse(), saldoFinal: Math.round(acc * 100) / 100, total: linhas.length });
});
// Criar movimento manual (entrada/saída) — admin/supervisor
app.post('/api/financeiro/movimentos', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {};
  if (!['entrada', 'saida'].includes(d.tipo)) return res.status(400).json({ erro: 'tipo deve ser entrada ou saida.' });
  if (!(+d.valor > 0)) return res.status(400).json({ erro: 'valor deve ser maior que zero.' });
  const id = inserirMovimento({ data: d.data || new Date().toISOString(), tipo: d.tipo, conta_id: +d.conta_id || null, categoria_id: +d.categoria_id || null,
    valor: +d.valor, descricao: d.descricao || '', origem: 'manual', obs: d.obs || '', responsavel: d.responsavel || (req.usuario || {}).nome || '',
    situacao: d.situacao === 'pendente' ? 'pendente' : 'confirmado', centro_custo_id: +d.centro_custo_id || null, criado_por: (req.usuario || {}).usuario || '' });
  manut.logAcao('movimento financeiro criado', 'financeiro', { id, tipo: d.tipo, valor: +d.valor, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(movFront(id));
});
// Editar movimento (só manual) — admin/supervisor
app.put('/api/financeiro/movimentos/:id', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const id = +req.params.id, m = db.prepare('SELECT * FROM financeiro_movimentos WHERE id=?').get(id);
  if (!m) return res.status(404).json({ erro: 'Movimento não encontrado.' });
  if (m.referencia_tipo) return res.status(400).json({ erro: 'Movimento automático (venda/pedido/fiado) não é editável aqui.' });
  const d = req.body || {};
  db.prepare('UPDATE financeiro_movimentos SET data=COALESCE(?,data), tipo=COALESCE(?,tipo), conta_id=COALESCE(?,conta_id), categoria_id=COALESCE(?,categoria_id), valor=COALESCE(?,valor), descricao=COALESCE(?,descricao), obs=COALESCE(?,obs), responsavel=COALESCE(?,responsavel), situacao=COALESCE(?,situacao), atualizado_em=? WHERE id=?')
    .run(d.data ?? null, d.tipo ?? null, d.conta_id != null ? +d.conta_id : null, d.categoria_id != null ? +d.categoria_id : null, d.valor != null ? +d.valor : null, d.descricao ?? null, d.obs ?? null, d.responsavel ?? null, d.situacao ?? null, new Date().toISOString(), id);
  manut.logAcao('movimento financeiro editado', 'financeiro', { id, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(movFront(id));
});
// Estornar (não apaga — marca estornado, sai do saldo) — admin
app.post('/api/financeiro/movimentos/:id/estornar', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const id = +req.params.id, m = db.prepare('SELECT * FROM financeiro_movimentos WHERE id=?').get(id);
  if (!m) return res.status(404).json({ erro: 'Movimento não encontrado.' });
  if (m.situacao === 'estornado') return res.json({ ok: true, jaEstornado: true });
  estornarMovimento(id, (req.body && req.body.motivo) || 'estorno manual', (req.usuario || {}).usuario);
  res.json({ ok: true });
});
// Excluir (só manual) — admin
app.delete('/api/financeiro/movimentos/:id', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const id = +req.params.id, m = db.prepare('SELECT * FROM financeiro_movimentos WHERE id=?').get(id);
  if (!m) return res.status(404).json({ erro: 'Movimento não encontrado.' });
  if (m.referencia_tipo) return res.status(400).json({ erro: 'Movimento automático não pode ser excluído (use estorno ou cancele o documento de origem).' });
  db.prepare('DELETE FROM financeiro_movimentos WHERE id=?').run(id);
  manut.logAcao('movimento financeiro excluído', 'financeiro', { id, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true });
});
// Visão geral
app.get('/api/financeiro/visao-geral', (req, res) => {
  const dia = (col) => `date(${col},'localtime')=date('now','localtime')`;
  const mi = new Date(); const mesIni = `${mi.getFullYear()}-${String(mi.getMonth() + 1).padStart(2, '0')}-01`;
  const sDia = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) ent, COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) sai FROM financeiro_movimentos WHERE situacao='confirmado' AND ${dia('data')}`).get();
  const sMes = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) ent, COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) sai FROM financeiro_movimentos WHERE situacao='confirmado' AND date(data,'localtime') >= ?`).get(mesIni);
  const ultimas = db.prepare(`${SELECT_MOV} WHERE m.situacao != 'estornado' ORDER BY m.data DESC, m.id DESC LIMIT 12`).all();
  const pendentes = db.prepare(`${SELECT_MOV} WHERE m.situacao='pendente' ORDER BY m.data DESC LIMIT 30`).all();
  const contas = db.prepare('SELECT * FROM financeiro_contas WHERE ativo=1 ORDER BY nome').all().map(contaComSaldo);
  res.json({
    saldoAtual: saldoTotalFinanceiro(),
    entradasDia: sDia.ent, saidasDia: sDia.sai, saldoDia: Math.round((sDia.ent - sDia.sai) * 100) / 100,
    entradasMes: sMes.ent, saidasMes: sMes.sai, resultadoMes: Math.round((sMes.ent - sMes.sai) * 100) / 100,
    contas, ultimas, pendentes, totalPendentes: pendentes.length,
    valorPendente: Math.round(pendentes.reduce((s, m) => s + (m.tipo === 'entrada' ? m.valor : -m.valor), 0) * 100) / 100,
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ERP — FORNECEDORES · COMPRAS · CONTAS A PAGAR (Fase 26). Estende o núcleo
   financeiro (Fase 25). Uma COMPRA gera automaticamente: entrada de estoque +
   atualização de custo (precoCompra → BI/produção) + uma CONTA A PAGAR. Pagar
   a conta (total ou parcial) gera a SAÍDA financeira (categoria "Compra"), com
   referência idempotente — nunca conta o mesmo dinheiro/estoque duas vezes.
   Saldos/status são SEMPRE calculados. Estrutura pronta pra boleto/XML/QR no
   futuro (campos livres) sem refazer tabela. Ver 41_*.md.
   ══════════════════════════════════════════════════════════════════════════ */
db.exec(`CREATE TABLE IF NOT EXISTS fornecedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, razao_social TEXT, cpf_cnpj TEXT,
  telefone TEXT, whatsapp TEXT, cidade TEXT, endereco TEXT, banco TEXT, pix TEXT, obs TEXT,
  tags TEXT, contato_principal TEXT, ativo INTEGER DEFAULT 1, criado_em TEXT, atualizado_em TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS erp_compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fornecedor_id INTEGER, numero_nf TEXT,
  data_emissao TEXT, data_vencimento TEXT, forma_pagamento TEXT, conta_id INTEGER,
  status TEXT DEFAULT 'aberto', subtotal REAL, frete REAL, desconto REAL, outras_despesas REAL, total REAL,
  obs TEXT, cancelada_em TEXT, motivo_cancelamento TEXT, criado_em TEXT, criado_por TEXT, atualizado_em TEXT,
  chave_nfe TEXT, xml_ref TEXT, boleto_ref TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS erp_compras_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT, compra_id INTEGER NOT NULL, produto_codigo TEXT, descricao TEXT,
  quantidade REAL, valor_unitario REAL, valor_total REAL, lote TEXT, validade TEXT, criado_em TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS contas_pagar (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fornecedor_id INTEGER, compra_id INTEGER, categoria_id INTEGER,
  descricao TEXT, valor_total REAL, data_emissao TEXT, data_vencimento TEXT, status TEXT DEFAULT 'aberto',
  obs TEXT, cancelada_em TEXT, criado_em TEXT, criado_por TEXT, boleto_ref TEXT, codigo_barras TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS contas_pagar_pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conta_pagar_id INTEGER NOT NULL, data TEXT, valor REAL,
  conta_id INTEGER, forma_pagamento TEXT, financeiro_movimento_id INTEGER, estornado INTEGER DEFAULT 0,
  estornado_em TEXT, obs TEXT, criado_em TEXT, criado_por TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_erp_compra_forn ON erp_compras(fornecedor_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_erp_compra_itens ON erp_compras_itens(compra_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_cp_forn ON contas_pagar(fornecedor_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_cp_venc ON contas_pagar(data_vencimento)');
db.exec('CREATE INDEX IF NOT EXISTS idx_cp_pgto ON contas_pagar_pagamentos(conta_pagar_id)');

// ── Helpers de status/saldo (sempre calculados) ──
function valorPagoConta(contaId) { return Math.round(db.prepare('SELECT COALESCE(SUM(valor),0) t FROM contas_pagar_pagamentos WHERE conta_pagar_id=? AND estornado=0').get(contaId).t * 100) / 100; }
function statusDaConta(c) {
  if (!c) return 'aberto';
  if (c.cancelada_em) return 'cancelada';
  const pago = valorPagoConta(c.id);
  if (pago >= (c.valor_total || 0) - 1e-6 && (c.valor_total || 0) > 0) return 'pago';
  if (pago > 1e-6) return 'parcial';
  return 'aberto';
}
function recomputarConta(contaId) {
  const c = db.prepare('SELECT * FROM contas_pagar WHERE id=?').get(contaId);
  if (!c) return null;
  const st = statusDaConta(c);
  db.prepare('UPDATE contas_pagar SET status=? WHERE id=?').run(st, contaId);
  if (c.compra_id) db.prepare('UPDATE erp_compras SET status=?, atualizado_em=? WHERE id=?').run(st, new Date().toISOString(), c.compra_id);
  return st;
}
function fornecedorMetricas(fid) {
  const compras = db.prepare("SELECT total, data_emissao FROM erp_compras WHERE fornecedor_id=? AND status<>'cancelada'").all(fid);
  const now = new Date();
  const mesIni = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, anoIni = `${now.getFullYear()}-01-01`;
  let totalMes = 0, totalAno = 0, ultima = null, maior = 0, soma = 0;
  for (const c of compras) {
    const d = (c.data_emissao || '').slice(0, 10), v = +c.total || 0;
    soma += v; if (v > maior) maior = v; if (!ultima || d > ultima) ultima = d;
    if (d >= mesIni) totalMes += v; if (d >= anoIni) totalAno += v;
  }
  let saldoAberto = 0;
  for (const a of db.prepare('SELECT id, valor_total FROM contas_pagar WHERE fornecedor_id=? AND cancelada_em IS NULL').all(fid)) saldoAberto += Math.max(0, (a.valor_total || 0) - valorPagoConta(a.id));
  return { qtdCompras: compras.length, totalComprado: Math.round(soma * 100) / 100, totalMes: Math.round(totalMes * 100) / 100, totalAno: Math.round(totalAno * 100) / 100,
    ultimaCompra: ultima, maiorCompra: maior, ticketMedio: compras.length ? Math.round(soma / compras.length * 100) / 100 : 0, saldoAberto: Math.round(saldoAberto * 100) / 100 };
}
const fornecedorFront = (f) => ({ ...f, ...fornecedorMetricas(f.id) });

// ── Integração com estoque/custo (reusa registrarMovimento da Fase 19) ──
function entrarEstoqueCompra(compraId, itens) {
  const agora = new Date().toISOString();
  for (const it of itens) {
    const cod = (it.produto_codigo || '').trim(); if (!cod) continue;
    if (!db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(cod)) continue;
    const qtd = +it.quantidade || 0, vu = +it.valor_unitario || 0;
    if (vu > 0) db.prepare('UPDATE produtos SET precoCompra=?, atualizado_em=? WHERE codigo=?').run(vu, agora, cod); // custo mais recente → BI/produção
    if (qtd > 0) { try { registrarMovimento(cod, 'entrada', { quantidade: qtd, motivo: 'compra ERP', referencia: 'erp_compra#' + compraId }); } catch (e) { manut.logErro('erp-estoque-entrada', e); } }
  }
}
function reverterEstoqueCompra(compraId) {
  // Fase 45.1: no modo manual, o estoque entrou só pelo que foi recebido — estorna a MESMA quantidade.
  const compra = db.prepare('SELECT recebimento_modo FROM erp_compras WHERE id=?').get(compraId);
  const manual = compra && compra.recebimento_modo === 'manual';
  for (const it of db.prepare('SELECT * FROM erp_compras_itens WHERE compra_id=?').all(compraId)) {
    const cod = (it.produto_codigo || '').trim(); if (!cod) continue;
    if (!db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(cod)) continue;
    const qtd = manual ? (+it.qtd_recebida || 0) : (+it.quantidade || 0);
    if (qtd > 0) { try { registrarMovimento(cod, 'saida', { quantidade: qtd, motivo: 'cancelamento de compra', referencia: 'erp_compra#' + compraId + ' estorno' }); } catch (e) { manut.logErro('erp-estoque-estorno', e); } }
  }
}
function criarContaPagarDaCompra(compra) {
  const existe = db.prepare('SELECT id FROM contas_pagar WHERE compra_id=?').get(compra.id);
  if (existe) return existe.id; // idempotente: 1 conta a pagar por compra
  const forn = compra.fornecedor_id ? db.prepare('SELECT nome FROM fornecedores WHERE id=?').get(compra.fornecedor_id) : null;
  const info = db.prepare(`INSERT INTO contas_pagar (fornecedor_id,compra_id,categoria_id,descricao,valor_total,data_emissao,data_vencimento,status,obs,criado_em,criado_por)
     VALUES (?,?,?,?,?,?,?, 'aberto', ?,?,?)`).run(compra.fornecedor_id || null, compra.id, catFinId('Compra'),
     `Compra${compra.numero_nf ? ' NF ' + compra.numero_nf : ''}${forn ? ' · ' + forn.nome : ''}`, compra.total, compra.data_emissao, compra.data_vencimento, compra.obs || '', new Date().toISOString(), compra.criado_por || '');
  return info.lastInsertRowid;
}
// PAGAR (total ou parcial): registra o pagamento + cria a SAÍDA financeira (categoria Compra).
function pagarContaPagar(contaId, d) {
  const c = db.prepare('SELECT * FROM contas_pagar WHERE id=?').get(contaId);
  if (!c) return { erro: 'Conta a pagar não encontrada.' };
  if (c.cancelada_em) return { erro: 'Conta cancelada não pode ser paga.' };
  const restante = Math.round(((c.valor_total || 0) - valorPagoConta(contaId)) * 100) / 100;
  const valor = Math.round((+d.valor || 0) * 100) / 100;
  if (valor <= 0) return { erro: 'Valor deve ser maior que zero.' };
  if (valor > restante + 1e-6) return { erro: `Valor acima do saldo em aberto (${restante.toFixed(2)}).` };
  const agora = new Date().toISOString();
  const forn = c.fornecedor_id ? db.prepare('SELECT nome FROM fornecedores WHERE id=?').get(c.fornecedor_id) : null;
  const contaFin = +d.conta_id || contaParaForma(d.forma_pagamento || d.forma);
  const info = db.prepare('INSERT INTO contas_pagar_pagamentos (conta_pagar_id,data,valor,conta_id,forma_pagamento,criado_em,criado_por,obs) VALUES (?,?,?,?,?,?,?,?)')
    .run(contaId, d.data || agora, valor, contaFin, d.forma_pagamento || d.forma || '', agora, d.por || '', d.obs || '');
  const pgtoId = info.lastInsertRowid;
  const movId = inserirMovimento({ data: d.data || agora, tipo: 'saida', conta_id: contaFin, categoria_id: catFinId('Compra'),
    valor, descricao: `Pagamento ${forn ? forn.nome : 'fornecedor'}${c.compra_id ? ' · compra #' + c.compra_id : ''}`, origem: 'compra',
    responsavel: d.por || '', situacao: 'confirmado', referencia_tipo: 'conta_pagar_pgto', referencia_id: pgtoId });
  db.prepare('UPDATE contas_pagar_pagamentos SET financeiro_movimento_id=? WHERE id=?').run(movId, pgtoId);
  const st = recomputarConta(contaId);
  manut.logAcao('pagamento de conta a pagar', 'contas_pagar', { conta_id: contaId, pagamento_id: pgtoId, valor, status: st, por: d.por }, 'operacao');
  return { ok: true, pagamento_id: pgtoId, movimento_id: movId, status: st, valorPago: valorPagoConta(contaId), restante: Math.round(((c.valor_total || 0) - valorPagoConta(contaId)) * 100) / 100 };
}
function estornarPagamentoConta(pgtoId, por) {
  const p = db.prepare('SELECT * FROM contas_pagar_pagamentos WHERE id=?').get(pgtoId);
  if (!p) return { erro: 'Pagamento não encontrado.' };
  if (p.estornado) return { ok: true, jaEstornado: true };
  db.prepare('UPDATE contas_pagar_pagamentos SET estornado=1, estornado_em=? WHERE id=?').run(new Date().toISOString(), pgtoId);
  if (p.financeiro_movimento_id) estornarMovimento(p.financeiro_movimento_id, 'estorno de pagamento de compra', por || 'sistema');
  const st = recomputarConta(p.conta_pagar_id);
  manut.logAcao('estorno de pagamento', 'contas_pagar', { pagamento_id: pgtoId, conta_id: p.conta_pagar_id, status: st, por }, 'operacao');
  return { ok: true, status: st };
}
function cancelarCompraErp(compraId, motivo, por) {
  const c = db.prepare('SELECT * FROM erp_compras WHERE id=?').get(compraId);
  if (!c) return { erro: 'Compra não encontrada.' };
  if (c.status === 'cancelada') return { ok: true, jaCancelada: true };
  const agora = new Date().toISOString();
  // Cancela TODAS as contas a pagar da compra (base 'pedido' tem 1; base 'recebido' pode ter várias, 1 por recebimento).
  for (const conta of db.prepare('SELECT * FROM contas_pagar WHERE compra_id=? AND cancelada_em IS NULL').all(compraId)) {
    for (const p of db.prepare('SELECT id FROM contas_pagar_pagamentos WHERE conta_pagar_id=? AND estornado=0').all(conta.id)) estornarPagamentoConta(p.id, por);
    db.prepare('UPDATE contas_pagar SET status=?, cancelada_em=? WHERE id=?').run('cancelada', agora, conta.id);
  }
  reverterEstoqueCompra(compraId);
  try { anularLotesDaCompra(compraId); } catch (e) { manut.logErro('erp-compra-lote-anular', e); }
  // Fase 45.1: marca os recebimentos como cancelados (histórico preservado).
  try { db.prepare("UPDATE erp_recebimentos SET status='cancelado' WHERE compra_id=? AND status<>'cancelado'").run(compraId); } catch {}
  db.prepare("UPDATE erp_compras SET status=?, status_recebimento='cancelada', cancelada_em=?, motivo_cancelamento=?, atualizado_em=? WHERE id=?").run('cancelada', agora, motivo || '', agora, compraId);
  manut.logAcao('compra cancelada', 'compras', { id: compraId, motivo: motivo || '', por }, 'operacao');
  return { ok: true };
}

// ══ Endpoints — FORNECEDORES ══
app.get('/api/erp/fornecedores', (req, res) => {
  const soAtivos = req.query.ativos === '1';
  res.json(db.prepare(`SELECT * FROM fornecedores ${soAtivos ? 'WHERE ativo=1' : ''} ORDER BY ativo DESC, nome`).all().map(fornecedorFront));
});
app.get('/api/erp/fornecedores/:id', (req, res) => { const f = db.prepare('SELECT * FROM fornecedores WHERE id=?').get(+req.params.id); f ? res.json(fornecedorFront(f)) : res.status(404).json({ erro: 'Fornecedor não encontrado.' }); });
app.get('/api/erp/fornecedores/:id/historico', (req, res) => {
  const fid = +req.params.id;
  const compras = db.prepare("SELECT id,numero_nf,data_emissao,data_vencimento,total,status FROM erp_compras WHERE fornecedor_id=? ORDER BY id DESC LIMIT 200").all(fid);
  const pagamentos = db.prepare(`SELECT p.id,p.data,p.valor,p.forma_pagamento,cp.compra_id, fc.nome conta_nome FROM contas_pagar_pagamentos p JOIN contas_pagar cp ON cp.id=p.conta_pagar_id LEFT JOIN financeiro_contas fc ON fc.id=p.conta_id WHERE cp.fornecedor_id=? AND p.estornado=0 ORDER BY p.id DESC LIMIT 200`).all(fid);
  const precos = db.prepare(`SELECT i.produto_codigo, i.descricao, i.valor_unitario, c.data_emissao FROM erp_compras_itens i JOIN erp_compras c ON c.id=i.compra_id WHERE c.fornecedor_id=? AND c.status<>'cancelada' AND i.produto_codigo<>'' ORDER BY c.data_emissao DESC LIMIT 200`).all(fid);
  res.json({ metricas: fornecedorMetricas(fid), compras, pagamentos, precos });
});
app.post('/api/erp/fornecedores', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {}; if (!d.nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  // Não permitir duplicidade por CPF/CNPJ (comparando só os dígitos).
  const doc = digitos(d.cpf_cnpj);
  if (doc) { const dup = db.prepare("SELECT id, nome FROM fornecedores WHERE REPLACE(REPLACE(REPLACE(REPLACE(cpf_cnpj,'.',''),'-',''),'/',''),' ','')=?").get(doc); if (dup) return res.status(409).json({ erro: `Já existe fornecedor com este CPF/CNPJ: ${dup.nome}.`, fornecedor_id: dup.id }); }
  // Sem documento: apenas AVISA se há nome+telefone iguais (não bloqueia cadastro legítimo).
  let aviso = null;
  if (!doc && d.telefone) { const semi = db.prepare('SELECT id, nome FROM fornecedores WHERE nome=? AND telefone=?').get(d.nome, d.telefone); if (semi) aviso = `Já existe um fornecedor com mesmo nome e telefone (#${semi.id}). Cadastro criado mesmo assim.`; }
  const agora = new Date().toISOString();
  const info = db.prepare(`INSERT INTO fornecedores (codigo,nome,nome_fantasia,razao_social,cpf_cnpj,inscricao_estadual,telefone,whatsapp,email,cidade,estado,endereco,banco,pix,obs,tags,contato_principal,ativo,criado_em,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(d.codigo || proximoCodigoFornecedor(), d.nome, d.nome_fantasia || '', d.razao_social || '', d.cpf_cnpj || '', d.inscricao_estadual || '', d.telefone || '', d.whatsapp || '', d.email || '', d.cidade || '', d.estado || '', d.endereco || '', d.banco || '', d.pix || '', d.obs || '', d.tags || '', d.contato_principal || '', d.ativo === false ? 0 : 1, agora, agora);
  manut.logAcao('fornecedor criado', 'fornecedores', { id: info.lastInsertRowid, nome: d.nome, por: (req.usuario || {}).usuario }, 'config');
  res.json({ ...fornecedorFront(db.prepare('SELECT * FROM fornecedores WHERE id=?').get(info.lastInsertRowid)), aviso });
});
app.put('/api/erp/fornecedores/:id', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const id = +req.params.id, d = req.body || {};
  if (!db.prepare('SELECT id FROM fornecedores WHERE id=?').get(id)) return res.status(404).json({ erro: 'Fornecedor não encontrado.' });
  const doc = digitos(d.cpf_cnpj);
  if (doc) { const dup = db.prepare("SELECT id, nome FROM fornecedores WHERE id<>? AND REPLACE(REPLACE(REPLACE(REPLACE(cpf_cnpj,'.',''),'-',''),'/',''),' ','')=?").get(id, doc); if (dup) return res.status(409).json({ erro: `Outro fornecedor já usa este CPF/CNPJ: ${dup.nome}.` }); }
  db.prepare(`UPDATE fornecedores SET nome=COALESCE(?,nome),nome_fantasia=COALESCE(?,nome_fantasia),razao_social=COALESCE(?,razao_social),cpf_cnpj=COALESCE(?,cpf_cnpj),inscricao_estadual=COALESCE(?,inscricao_estadual),telefone=COALESCE(?,telefone),whatsapp=COALESCE(?,whatsapp),email=COALESCE(?,email),cidade=COALESCE(?,cidade),estado=COALESCE(?,estado),endereco=COALESCE(?,endereco),banco=COALESCE(?,banco),pix=COALESCE(?,pix),obs=COALESCE(?,obs),tags=COALESCE(?,tags),contato_principal=COALESCE(?,contato_principal),ativo=COALESCE(?,ativo),atualizado_em=? WHERE id=?`)
    .run(d.nome ?? null, d.nome_fantasia ?? null, d.razao_social ?? null, d.cpf_cnpj ?? null, d.inscricao_estadual ?? null, d.telefone ?? null, d.whatsapp ?? null, d.email ?? null, d.cidade ?? null, d.estado ?? null, d.endereco ?? null, d.banco ?? null, d.pix ?? null, d.obs ?? null, d.tags ?? null, d.contato_principal ?? null, d.ativo != null ? (d.ativo ? 1 : 0) : null, new Date().toISOString(), id);
  manut.logAcao('fornecedor editado', 'fornecedores', { id, por: (req.usuario || {}).usuario }, 'config');
  res.json(fornecedorFront(db.prepare('SELECT * FROM fornecedores WHERE id=?').get(id)));
});
app.delete('/api/erp/fornecedores/:id', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const id = +req.params.id, n = db.prepare('SELECT COUNT(*) n FROM erp_compras WHERE fornecedor_id=?').get(id).n;
  if (n > 0) return res.status(400).json({ erro: `Fornecedor tem ${n} compra(s). Desative em vez de excluir.` });
  db.prepare('DELETE FROM fornecedores WHERE id=?').run(id);
  manut.logAcao('fornecedor excluído', 'fornecedores', { id, por: (req.usuario || {}).usuario }, 'config');
  res.json({ ok: true });
});

// ══ Endpoints — COMPRAS ══
function compraDetalhe(id) {
  const c = db.prepare('SELECT * FROM erp_compras WHERE id=?').get(id);
  if (!c) return null;
  c.itens = db.prepare('SELECT * FROM erp_compras_itens WHERE compra_id=? ORDER BY id').all(id);
  c.fornecedor = c.fornecedor_id ? db.prepare('SELECT id,nome,telefone,whatsapp,pix,banco FROM fornecedores WHERE id=?').get(c.fornecedor_id) : null;
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE compra_id=?').get(id);
  c.conta_pagar = conta || null;
  const pagos = conta ? db.prepare('SELECT p.*, fc.nome conta_nome FROM contas_pagar_pagamentos p LEFT JOIN financeiro_contas fc ON fc.id=p.conta_id WHERE p.conta_pagar_id=? ORDER BY p.id').all(conta.id) : [];
  const pago = conta ? valorPagoConta(conta.id) : 0;
  c.resumo = { valor_total: c.total, pago, restante: Math.round(((c.total || 0) - pago) * 100) / 100, num_parcelas: pagos.filter(p => !p.estornado).length, status: c.status, fornecedor: c.fornecedor ? c.fornecedor.nome : '—', nf: c.numero_nf };
  const tl = [{ tipo: 'criada', data: c.criado_em, texto: 'Compra criada', valor: c.total }];
  for (const p of pagos) tl.push({ id: p.id, tipo: p.estornado ? 'estorno' : 'pagamento', data: p.estornado ? p.estornado_em : p.data, texto: (p.estornado ? 'Estorno de pagamento' : 'Pagamento') + (p.conta_nome ? ' · ' + p.conta_nome : ''), valor: p.valor, forma: p.forma_pagamento, estornado: !!p.estornado });
  if (c.cancelada_em) tl.push({ tipo: 'cancelada', data: c.cancelada_em, texto: 'Compra cancelada' + (c.motivo_cancelamento ? ' · ' + c.motivo_cancelamento : ''), valor: 0 });
  c.timeline = tl.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  c.pagamentos = pagos;
  return c;
}
app.get('/api/erp/compras', (req, res) => {
  const q = req.query, cond = ['1=1'], args = [];
  if (q.fornecedor_id) { cond.push('c.fornecedor_id=?'); args.push(+q.fornecedor_id); }
  if (q.status) { cond.push('c.status=?'); args.push(q.status); }
  if (q.numero_nf) { cond.push('c.numero_nf LIKE ?'); args.push('%' + q.numero_nf + '%'); }
  if (q.conta_id) { cond.push('c.conta_id=?'); args.push(+q.conta_id); }
  if (q.forma_pagamento) { cond.push('c.forma_pagamento=?'); args.push(q.forma_pagamento); }
  if (q.de) { cond.push('date(c.data_emissao)>=?'); args.push(String(q.de).slice(0, 10)); }
  if (q.ate) { cond.push('date(c.data_emissao)<=?'); args.push(String(q.ate).slice(0, 10)); }
  if (q.valorMin) { cond.push('c.total>=?'); args.push(+q.valorMin); }
  if (q.valorMax) { cond.push('c.total<=?'); args.push(+q.valorMax); }
  let rows = db.prepare(`SELECT c.*, f.nome fornecedor_nome FROM erp_compras c LEFT JOIN fornecedores f ON f.id=c.fornecedor_id WHERE ${cond.join(' AND ')} ORDER BY c.id DESC LIMIT 1000`).all(...args);
  if (q.produto) { const ids = db.prepare('SELECT DISTINCT compra_id FROM erp_compras_itens WHERE produto_codigo LIKE ? OR descricao LIKE ?').all('%' + q.produto + '%', '%' + q.produto + '%').map(r => r.compra_id); rows = rows.filter(r => ids.includes(r.id)); }
  res.json(rows.map(c => { const conta = db.prepare('SELECT id FROM contas_pagar WHERE compra_id=?').get(c.id); const pago = conta ? valorPagoConta(conta.id) : 0; return { ...c, pago, restante: Math.round(((c.total || 0) - pago) * 100) / 100 }; }));
});
app.get('/api/erp/compras/:id', (req, res) => { const c = compraDetalhe(+req.params.id); c ? res.json(c) : res.status(404).json({ erro: 'Compra não encontrada.' }); });
app.post('/api/erp/compras', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {}, itens = Array.isArray(d.itens) ? d.itens : [];
  const subtotal = itens.reduce((s, it) => s + (it.valor_total != null ? +it.valor_total : (+it.quantidade || 0) * (+it.valor_unitario || 0)), 0);
  const total = Math.round((subtotal + (+d.frete || 0) + (+d.outras_despesas || 0) - (+d.desconto || 0)) * 100) / 100;
  const agora = new Date().toISOString();
  let compraId;
  db.exec('BEGIN');
  try {
    const info = db.prepare(`INSERT INTO erp_compras (fornecedor_id,numero_nf,data_emissao,data_vencimento,forma_pagamento,conta_id,status,subtotal,frete,desconto,outras_despesas,total,obs,criado_em,criado_por,atualizado_em)
       VALUES (?,?,?,?,?,?, 'aberto', ?,?,?,?,?,?,?,?,?)`).run(+d.fornecedor_id || null, d.numero_nf || '', (d.data_emissao || agora).slice(0, 10), d.data_vencimento || null, d.forma_pagamento || '', +d.conta_id || null,
      Math.round(subtotal * 100) / 100, +d.frete || 0, +d.desconto || 0, +d.outras_despesas || 0, total, d.obs || '', agora, (req.usuario || {}).usuario || '', agora);
    compraId = info.lastInsertRowid;
    const insIt = db.prepare('INSERT INTO erp_compras_itens (compra_id,produto_codigo,descricao,quantidade,valor_unitario,valor_total,lote,validade,criado_em) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const it of itens) { const q2 = +it.quantidade || 0, vu = +it.valor_unitario || 0; insIt.run(compraId, (it.produto_codigo || '').trim(), it.descricao || '', q2, vu, it.valor_total != null ? +it.valor_total : q2 * vu, it.lote || '', it.validade || '', agora); }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ erro: e.message }); }
  const compra = db.prepare('SELECT * FROM erp_compras WHERE id=?').get(compraId);
  if (d.data_recebimento) { const dr = String(d.data_recebimento).slice(0, 10); db.prepare('UPDATE erp_compras SET data_recebimento=? WHERE id=?').run(dr, compraId); compra.data_recebimento = dr; }
  // Fase 45.1: MODO de recebimento. 'manual' → entrada e lotes só pelos recebimentos (parcial);
  // 'automatico' (PADRÃO, preserva o legado) → entrada única + lote total na criação.
  const modo = d.recebimento_modo === 'manual' ? 'manual' : 'automatico';
  const finBase = d.financeiro_base === 'recebido' ? 'recebido' : 'pedido';
  const totalPedido = itens.reduce((s, it) => s + (+it.quantidade || 0), 0);
  db.prepare('UPDATE erp_compras SET recebimento_modo=?, financeiro_base=?, status_recebimento=?, qtd_pedida=?, qtd_recebida=0 WHERE id=?')
    .run(modo, finBase, modo === 'manual' ? 'aguardando' : 'recebida', r2(totalPedido), compraId);
  compra.recebimento_modo = modo; compra.financeiro_base = finBase;
  let lotes = [], contaId = null;
  if (modo === 'automatico') {
    try { entrarEstoqueCompra(compraId, itens); } catch (e) { manut.logErro('erp-compra-estoque', e); }
    contaId = criarContaPagarDaCompra(compra); // conta pelo total (legado)
    // Fase 45: gera o LOTE INTERNO da matéria-prima na entrada única.
    try { lotes = criarLotesDaCompra(compra, itens, (req.usuario || {}).usuario); } catch (e) { manut.logErro('erp-compra-lote', e); }
    // marca os itens como totalmente recebidos (entrada única).
    db.prepare('UPDATE erp_compras_itens SET qtd_recebida=quantidade, qtd_recusada=0 WHERE compra_id=?').run(compraId);
    db.prepare('UPDATE erp_compras SET qtd_recebida=? WHERE id=?').run(r2(totalPedido), compraId);
  } else {
    // Manual: nada de estoque/lote agora. Conta a pagar SÓ se a base for pelo total do pedido.
    if (finBase === 'pedido') contaId = criarContaPagarDaCompra(compra);
  }
  try { atualizarDatasFornecedor(compra.fornecedor_id); } catch (e) { manut.logErro('erp-compra-forn-datas', e); }
  manut.logAcao('compra criada', 'compras', { id: compraId, fornecedor_id: compra.fornecedor_id, total, itens: itens.length, nf: d.numero_nf || '', modo, financeiro_base: finBase, lotes: lotes.length, por: (req.usuario || {}).usuario }, 'operacao');
  let pagamento = null;
  if (contaId && d.pagamento_inicial && +d.pagamento_inicial.valor > 0) pagamento = pagarContaPagar(contaId, { valor: +d.pagamento_inicial.valor, conta_id: +d.pagamento_inicial.conta_id || +d.conta_id, forma_pagamento: d.pagamento_inicial.forma || d.forma_pagamento, por: (req.usuario || {}).usuario });
  res.json({ id: compraId, total, conta_pagar_id: contaId, lotes, recebimento_modo: modo, financeiro_base: finBase, status: db.prepare('SELECT status FROM erp_compras WHERE id=?').get(compraId).status, status_recebimento: db.prepare('SELECT status_recebimento FROM erp_compras WHERE id=?').get(compraId).status_recebimento, pagamento });
});
app.put('/api/erp/compras/:id', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const id = +req.params.id, d = req.body || {}, c = db.prepare('SELECT * FROM erp_compras WHERE id=?').get(id);
  if (!c) return res.status(404).json({ erro: 'Compra não encontrada.' });
  if (c.status === 'cancelada') return res.status(400).json({ erro: 'Compra cancelada não é editável.' });
  db.prepare('UPDATE erp_compras SET numero_nf=COALESCE(?,numero_nf), data_vencimento=COALESCE(?,data_vencimento), obs=COALESCE(?,obs), atualizado_em=? WHERE id=?').run(d.numero_nf ?? null, d.data_vencimento ?? null, d.obs ?? null, new Date().toISOString(), id);
  if (d.data_vencimento != null) db.prepare('UPDATE contas_pagar SET data_vencimento=? WHERE compra_id=?').run(d.data_vencimento, id);
  manut.logAcao('compra editada', 'compras', { id, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(compraDetalhe(id));
});
app.post('/api/erp/compras/:id/cancelar', (req, res) => { if (!gateFinAdmin(req, res)) return; const r = cancelarCompraErp(+req.params.id, (req.body && req.body.motivo) || '', (req.usuario || {}).usuario); r.erro ? res.status(400).json(r) : res.json(r); });

// ══ Endpoints — CONTAS A PAGAR ══
function classificarVencimento(c, status) {
  if (status === 'pago') return 'pago';
  if (status === 'cancelada') return 'cancelada';
  if (!c.data_vencimento) return 'sem_venc';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const v = new Date(String(c.data_vencimento).slice(0, 10) + 'T00:00:00');
  const diff = Math.round((v - hoje) / 86400000);
  if (diff < 0) return 'vencida';
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanha';
  if (diff <= 7) return 'proximos';
  return 'futuro';
}
app.get('/api/erp/contas-pagar', (req, res) => {
  const q = req.query, cond = ['1=1'], args = [];
  if (q.fornecedor_id) { cond.push('cp.fornecedor_id=?'); args.push(+q.fornecedor_id); }
  if (q.categoria_id) { cond.push('cp.categoria_id=?'); args.push(+q.categoria_id); }
  if (q.vencDe) { cond.push('date(cp.data_vencimento)>=?'); args.push(String(q.vencDe).slice(0, 10)); }
  if (q.vencAte) { cond.push('date(cp.data_vencimento)<=?'); args.push(String(q.vencAte).slice(0, 10)); }
  if (q.busca) { cond.push('(cp.descricao LIKE ? OR f.nome LIKE ?)'); args.push('%' + q.busca + '%', '%' + q.busca + '%'); }
  if (q.valorMin) { cond.push('cp.valor_total>=?'); args.push(+q.valorMin); }
  if (q.valorMax) { cond.push('cp.valor_total<=?'); args.push(+q.valorMax); }
  let rows = db.prepare(`SELECT cp.*, f.nome fornecedor_nome, cat.nome categoria_nome FROM contas_pagar cp LEFT JOIN fornecedores f ON f.id=cp.fornecedor_id LEFT JOIN financeiro_categorias cat ON cat.id=cp.categoria_id WHERE ${cond.join(' AND ')} ORDER BY (cp.data_vencimento IS NULL), cp.data_vencimento ASC, cp.id DESC LIMIT 1000`).all(...args);
  rows = rows.map(c => { const status = statusDaConta(c); const pago = valorPagoConta(c.id); return { ...c, status, pago, restante: Math.round(((c.valor_total || 0) - pago) * 100) / 100, bucket: classificarVencimento(c, status) }; });
  if (q.status) rows = rows.filter(r => r.status === q.status);
  if (q.bucket) rows = rows.filter(r => r.bucket === q.bucket);
  if (q.conta_id) rows = rows.filter(r => db.prepare('SELECT 1 FROM contas_pagar_pagamentos WHERE conta_pagar_id=? AND conta_id=? AND estornado=0 LIMIT 1').get(r.id, +q.conta_id));
  if (q.forma_pagamento) rows = rows.filter(r => db.prepare('SELECT 1 FROM contas_pagar_pagamentos WHERE conta_pagar_id=? AND forma_pagamento=? AND estornado=0 LIMIT 1').get(r.id, q.forma_pagamento));
  const resumo = { vencidas: 0, hoje: 0, amanha: 0, proximos: 0, abertas: 0, parciais: 0, pagas: 0, canceladas: 0 };
  for (const r of rows) {
    if (r.status === 'pago') resumo.pagas++;
    else if (r.status === 'cancelada') resumo.canceladas++;
    else { if (r.status === 'parcial') resumo.parciais++; else resumo.abertas++; if (resumo[r.bucket + 's'] !== undefined) resumo[r.bucket + 's']++; else if (r.bucket === 'hoje') resumo.hoje++; else if (r.bucket === 'amanha') resumo.amanha++; else if (r.bucket === 'proximos') resumo.proximos++; }
  }
  res.json({ contas: rows, resumo, totalAberto: Math.round(rows.filter(r => r.status === 'aberto' || r.status === 'parcial').reduce((s, r) => s + r.restante, 0) * 100) / 100 });
});
app.get('/api/erp/contas-pagar/:id', (req, res) => {
  const id = +req.params.id, c = db.prepare('SELECT cp.*, f.nome fornecedor_nome FROM contas_pagar cp LEFT JOIN fornecedores f ON f.id=cp.fornecedor_id WHERE cp.id=?').get(id);
  if (!c) return res.status(404).json({ erro: 'Conta a pagar não encontrada.' });
  c.status = statusDaConta(c); c.pago = valorPagoConta(id); c.restante = Math.round(((c.valor_total || 0) - c.pago) * 100) / 100;
  c.pagamentos = db.prepare('SELECT p.*, fc.nome conta_nome FROM contas_pagar_pagamentos p LEFT JOIN financeiro_contas fc ON fc.id=p.conta_id WHERE p.conta_pagar_id=? ORDER BY p.id').all(id);
  res.json(c);
});
app.post('/api/erp/contas-pagar', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {}; if (!(+d.valor_total > 0)) return res.status(400).json({ erro: 'valor_total é obrigatório.' });
  const info = db.prepare('INSERT INTO contas_pagar (fornecedor_id,categoria_id,descricao,valor_total,data_emissao,data_vencimento,status,obs,criado_em,criado_por) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(+d.fornecedor_id || null, +d.categoria_id || catFinId('Compra'), d.descricao || 'Conta a pagar', +d.valor_total, (d.data_emissao || new Date().toISOString()).slice(0, 10), d.data_vencimento || null, 'aberto', d.obs || '', new Date().toISOString(), (req.usuario || {}).usuario || '');
  manut.logAcao('conta a pagar criada', 'contas_pagar', { id: info.lastInsertRowid, valor: +d.valor_total, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(db.prepare('SELECT * FROM contas_pagar WHERE id=?').get(info.lastInsertRowid));
});
app.post('/api/erp/contas-pagar/:id/pagar', (req, res) => { if (!gateFinLancar(req, res)) return; const r = pagarContaPagar(+req.params.id, { ...req.body, por: (req.usuario || {}).usuario }); r.erro ? res.status(400).json(r) : res.json(r); });
app.post('/api/erp/contas-pagar/:id/cancelar', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const id = +req.params.id, c = db.prepare('SELECT * FROM contas_pagar WHERE id=?').get(id);
  if (!c) return res.status(404).json({ erro: 'Conta não encontrada.' });
  if (c.compra_id) return res.status(400).json({ erro: 'Conta de compra — cancele a compra correspondente.' });
  for (const p of db.prepare('SELECT id FROM contas_pagar_pagamentos WHERE conta_pagar_id=? AND estornado=0').all(id)) estornarPagamentoConta(p.id, (req.usuario || {}).usuario);
  db.prepare('UPDATE contas_pagar SET status=?, cancelada_em=? WHERE id=?').run('cancelada', new Date().toISOString(), id);
  manut.logAcao('conta a pagar cancelada', 'contas_pagar', { id, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true });
});
app.post('/api/erp/pagamentos/:id/estornar', (req, res) => { if (!gateFinAdmin(req, res)) return; const r = estornarPagamentoConta(+req.params.id, (req.usuario || {}).usuario); r.erro ? res.status(400).json(r) : res.json(r); });

// ══ ALERTAS ══
app.get('/api/erp/alertas', (req, res) => {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const hojeStr = hoje.toISOString().slice(0, 10), amanhaStr = new Date(hoje.getTime() + 86400000).toISOString().slice(0, 10);
  const abertas = db.prepare('SELECT cp.*, f.nome fornecedor_nome FROM contas_pagar cp LEFT JOIN fornecedores f ON f.id=cp.fornecedor_id WHERE cp.cancelada_em IS NULL').all()
    .map(c => ({ ...c, status: statusDaConta(c), pago: valorPagoConta(c.id) })).filter(c => c.status === 'aberto' || c.status === 'parcial');
  const rest = c => Math.round(((c.valor_total || 0) - c.pago) * 100) / 100;
  const mapC = c => ({ id: c.id, fornecedor: c.fornecedor_nome || '—', venc: c.data_vencimento, restante: rest(c) });
  const vencidas = abertas.filter(c => c.data_vencimento && String(c.data_vencimento).slice(0, 10) < hojeStr).map(mapC);
  const venceHoje = abertas.filter(c => String(c.data_vencimento || '').slice(0, 10) === hojeStr).map(mapC);
  const venceAmanha = abertas.filter(c => String(c.data_vencimento || '').slice(0, 10) === amanhaStr).map(mapC);
  const limite = new Date(hoje.getTime() - 45 * 86400000).toISOString().slice(0, 10);
  const semCompra = db.prepare('SELECT id,nome FROM fornecedores WHERE ativo=1').all().map(f => ({ id: f.id, nome: f.nome, ultima: db.prepare("SELECT MAX(date(data_emissao)) u FROM erp_compras WHERE fornecedor_id=? AND status<>'cancelada'").get(f.id).u })).filter(f => f.ultima && f.ultima < limite);
  const aumentos = [];
  for (const p of db.prepare("SELECT DISTINCT produto_codigo FROM erp_compras_itens WHERE produto_codigo<>''").all()) {
    const hist = db.prepare("SELECT i.valor_unitario FROM erp_compras_itens i JOIN erp_compras c ON c.id=i.compra_id WHERE i.produto_codigo=? AND c.status<>'cancelada' AND i.valor_unitario>0 ORDER BY c.data_emissao DESC, i.id DESC").all(p.produto_codigo);
    if (hist.length < 2) continue;
    const ultimo = hist[0].valor_unitario, ant = hist.slice(1), media = ant.reduce((s, h) => s + h.valor_unitario, 0) / ant.length;
    if (media > 0 && ultimo > media * 1.15) { const prod = db.prepare('SELECT nome FROM produtos WHERE codigo=?').get(p.produto_codigo); aumentos.push({ codigo: p.produto_codigo, nome: prod ? prod.nome : p.produto_codigo, ultimo, media: Math.round(media * 100) / 100, aumentoPct: Math.round((ultimo / media - 1) * 1000) / 10 }); }
  }
  res.json({ vencidas, venceHoje, venceAmanha, fornecedoresSemCompra: semCompra, aumentosPreco: aumentos, totalAlertas: vencidas.length + venceHoje.length + venceAmanha.length + semCompra.length + aumentos.length });
});

// ══ RELATÓRIOS ══
app.get('/api/erp/relatorios', (req, res) => {
  const de = (req.query.de || '').slice(0, 10), ate = (req.query.ate || '').slice(0, 10);
  const cond = ["c.status<>'cancelada'"], args = [];
  if (de) { cond.push('date(c.data_emissao)>=?'); args.push(de); }
  if (ate) { cond.push('date(c.data_emissao)<=?'); args.push(ate); }
  const w = cond.join(' AND ');
  const totalPeriodo = db.prepare(`SELECT COALESCE(SUM(c.total),0) total, COUNT(*) qtd, COALESCE(AVG(c.total),0) media FROM erp_compras c WHERE ${w}`).get(...args);
  const porFornecedor = db.prepare(`SELECT f.id, f.nome, COUNT(*) qtd, COALESCE(SUM(c.total),0) total, COALESCE(AVG(c.total),0) media FROM erp_compras c JOIN fornecedores f ON f.id=c.fornecedor_id WHERE ${w} GROUP BY f.id ORDER BY total DESC`).all(...args);
  const produtos = db.prepare(`SELECT i.produto_codigo, MAX(i.descricao) nome, SUM(i.quantidade) qtd, SUM(i.valor_total) total, AVG(i.valor_unitario) preco_medio FROM erp_compras_itens i JOIN erp_compras c ON c.id=i.compra_id WHERE ${w} AND i.produto_codigo<>'' GROUP BY i.produto_codigo ORDER BY total DESC`).all(...args)
    .map(p => ({ ...p, preco_medio: Math.round(p.preco_medio * 100) / 100 }));
  let maisBarato = null, maisCaro = null, evolucao = [], produtoEvolucao = null;
  if (produtos.length) {
    const top = produtos[0].produto_codigo; produtoEvolucao = produtos[0].nome;
    const pf = db.prepare(`SELECT f.nome, AVG(i.valor_unitario) preco FROM erp_compras_itens i JOIN erp_compras c ON c.id=i.compra_id JOIN fornecedores f ON f.id=c.fornecedor_id WHERE i.produto_codigo=? AND c.status<>'cancelada' AND i.valor_unitario>0 GROUP BY f.id ORDER BY preco ASC`).all(top);
    if (pf.length) { maisBarato = { produto: produtos[0].nome, fornecedor: pf[0].nome, preco: Math.round(pf[0].preco * 100) / 100 }; maisCaro = { produto: produtos[0].nome, fornecedor: pf[pf.length - 1].nome, preco: Math.round(pf[pf.length - 1].preco * 100) / 100 }; }
    evolucao = db.prepare(`SELECT date(c.data_emissao) dia, AVG(i.valor_unitario) preco FROM erp_compras_itens i JOIN erp_compras c ON c.id=i.compra_id WHERE i.produto_codigo=? AND c.status<>'cancelada' AND i.valor_unitario>0 GROUP BY dia ORDER BY dia`).all(top).map(r => ({ dia: r.dia, preco: Math.round(r.preco * 100) / 100 }));
  }
  res.json({ totalPeriodo, porFornecedor, produtos, maisBarato, maisCaro, produtoEvolucao, evolucao });
});

/* ══════════════════════════════════════════════════════════════════════════
   FASE 45 — COMPRAS INTELIGENTES & GESTÃO DE FORNECEDORES
   Camada gerencial sobre o que já existe (erp_compras, fornecedores,
   contas_pagar, registrarMovimento, operacao_fechamentos). NÃO cria estoque
   nem financeiro paralelo. Adiciona: LOTE INTERNO de matéria-prima, consumo
   FIFO pelo fechamento, rendimento e custo REAL por litro, análise por
   fornecedor, alertas e contexto p/ IA. Fluxo:
   compra → entrada estoque → lote interno → consumo (fechamento, FIFO)
          → rendimento real → custo real/litro → resultado gerencial.
   ══════════════════════════════════════════════════════════════════════════ */
migrar('fase45_compras_inteligentes', () => {
  // Fornecedores: campos gerenciais que faltavam (aditivo — nada é removido).
  for (const col of ['codigo TEXT', 'nome_fantasia TEXT', 'inscricao_estadual TEXT', 'email TEXT', 'estado TEXT', 'data_primeira_compra TEXT', 'data_ultima_compra TEXT']) {
    try { db.exec(`ALTER TABLE fornecedores ADD COLUMN ${col}`); } catch {}
  }
  // Compra: data do recebimento (a data_emissao já é a "data da compra").
  try { db.exec('ALTER TABLE erp_compras ADD COLUMN data_recebimento TEXT'); } catch {}
  // Fechamento: custo real da matéria-prima consumida (calculado no consumo FIFO).
  try { db.exec('ALTER TABLE operacao_fechamentos ADD COLUMN custo_mp REAL'); } catch {}
  // LOTE INTERNO de matéria-prima (sacas) — rastreabilidade fornecedor→consumo.
  db.exec(`CREATE TABLE IF NOT EXISTS mp_lotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lote_interno TEXT UNIQUE, lote_fornecedor TEXT, materia_codigo TEXT,
    fornecedor_id INTEGER, compra_id INTEGER,
    qtd REAL, unidade TEXT, custo_total REAL, custo_saca REAL, saldo REAL,
    data_recebimento TEXT, safra TEXT, status TEXT DEFAULT 'disponivel',
    criado_em TEXT, criado_por TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_mplote_forn ON mp_lotes(fornecedor_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_mplote_mat ON mp_lotes(materia_codigo)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_mplote_compra ON mp_lotes(compra_id)');
  // CONSUMO do lote pelo fechamento (FIFO) — parcelas por lote/fornecedor.
  db.exec(`CREATE TABLE IF NOT EXISTS mp_fechamento_consumo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fechamento_id INTEGER, mp_lote_id INTEGER, lote_interno TEXT,
    fornecedor_id INTEGER, materia_codigo TEXT,
    sacas REAL, custo_atribuido REAL, custo_saca REAL, criado_em TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_mpcons_fech ON mp_fechamento_consumo(fechamento_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_mpcons_lote ON mp_fechamento_consumo(mp_lote_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_mpcons_forn ON mp_fechamento_consumo(fornecedor_id)');
  // Avaliação do fornecedor (indicadores objetivos + notas manuais).
  db.exec(`CREATE TABLE IF NOT EXISTS fornecedor_avaliacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fornecedor_id INTEGER, compra_id INTEGER, lote_interno TEXT,
    nota REAL, criterios TEXT, obs TEXT, usuario TEXT, criado_em TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_favaliacao_forn ON fornecedor_avaliacoes(fornecedor_id)');
});
(function seedComprasIntelConfig() {
  const map = {
    mp_materias: JSON.stringify(['SACA-ACAI']),   // produtos que geram lote interno (genérico p/ outras MP)
    mp_consumo_criterio: 'fifo',                    // futuro: outros critérios (não implementado)
    ci_min_compras: '3',                            // mínimo p/ nota de custo-benefício
    ci_alerta_preco_pct: '15',                      // aumento % da saca que dispara alerta
    ci_alerta_rend_pct: '15',                       // rendimento abaixo da média (%) que dispara alerta
    ci_alerta_custo_pct: '15',                      // custo/litro acima da média (%) que dispara alerta
    ci_dias_sem_compra: '30',                       // fornecedor inativo há X dias
    ci_lote_parado_dias: '45',                      // lote sem consumo há X dias
  };
  for (const [k, v] of Object.entries(map)) if (getConfig(k, null) == null) setConfig(k, v);
})();

/* ══════════════════════════════════════════════════════════════════════════
   FASE 45.1 — RECEBIMENTO PARCIAL DE COMPRAS (conclusão das Compras Inteligentes)
   Uma COMPRA (erp_compras) pode ser recebida em UMA ou VÁRIAS entregas. Cada
   entrega (erp_recebimentos) dá entrada SÓ do que foi recebido e aprovado,
   gera o LOTE INTERNO (mp_lotes) da quantidade recebida (custo landed proporcional)
   e — conforme a configuração financeira da compra — a conta a pagar. Tudo
   ADITIVO e idempotente: o comportamento antigo (entrada única na criação)
   continua sendo o PADRÃO. Reusa registrarMovimento (estoque), contas_pagar
   (financeiro) e mp_lotes/FIFO (Fase 45). Ver 63_*.md.
   ══════════════════════════════════════════════════════════════════════════ */
migrar('fase45_1_recebimento_parcial', () => {
  // Compra: controle do recebimento fracionado (aditivo; DEFAULT preserva o legado).
  for (const col of [
    "status_recebimento TEXT DEFAULT 'recebida'",   // aguardando|parcial|recebida|divergencia|cancelada
    "recebimento_modo TEXT DEFAULT 'automatico'",    // automatico (entrada única na criação) | manual (por recebimento)
    "financeiro_base TEXT DEFAULT 'pedido'",         // pedido (conta pelo total) | recebido (conta conforme recebido)
    'qtd_pedida REAL', 'qtd_recebida REAL',          // cache p/ listagem rápida
  ]) { try { db.exec(`ALTER TABLE erp_compras ADD COLUMN ${col}`); } catch {} }
  // Itens da compra: acumuladores de recebido/recusado por linha.
  for (const col of ['qtd_recebida REAL DEFAULT 0', 'qtd_recusada REAL DEFAULT 0']) { try { db.exec(`ALTER TABLE erp_compras_itens ADD COLUMN ${col}`); } catch {} }
  // O LOTE INTERNO agora sabe de QUAL recebimento nasceu (além da compra).
  try { db.exec('ALTER TABLE mp_lotes ADD COLUMN recebimento_id INTEGER'); } catch {}
  db.exec('CREATE INDEX IF NOT EXISTS idx_mplote_receb ON mp_lotes(recebimento_id)');
  // Conta a pagar pode nascer de um recebimento específico (financeiro conforme recebido).
  try { db.exec('ALTER TABLE contas_pagar ADD COLUMN erp_recebimento_id INTEGER'); } catch {}
  db.exec('CREATE INDEX IF NOT EXISTS idx_cp_erpreceb ON contas_pagar(erp_recebimento_id)');
  // RECEBIMENTO (entrega) de uma compra — cabeçalho.
  db.exec(`CREATE TABLE IF NOT EXISTS erp_recebimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, compra_id INTEGER, fornecedor_id INTEGER,
    data TEXT, usuario TEXT, status TEXT DEFAULT 'pendente', integrado INTEGER DEFAULT 0,
    obs TEXT, anexos TEXT, criado_em TEXT, criado_por TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS erp_recebimentos_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT, recebimento_id INTEGER, compra_item_id INTEGER,
    produto_codigo TEXT, descricao TEXT, qtd_esperada REAL, qtd_recebida REAL, qtd_recusada REAL,
    diferenca REAL, motivo_divergencia TEXT, lote_fornecedor TEXT, validade TEXT, obs TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_erpreceb_compra ON erp_recebimentos(compra_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_erprecebitens_rec ON erp_recebimentos_itens(recebimento_id)');
});
(function seedReceb45_1() {
  const map = {
    ci_receb_parcial_dias: '7',       // compra parcialmente recebida há X dias → alerta
    ci_divergencia_dias: '3',         // divergência sem solução há X dias → alerta
    ci_forn_divergencias_min: '3',    // fornecedor com N+ divergências → alerta
  };
  for (const [k, v] of Object.entries(map)) if (getConfig(k, null) == null) setConfig(k, v);
})();
// Motivos de divergência configuráveis (o "outro" cobre casos livres).
const MOTIVOS_DIVERGENCIA = ['falta', 'sobra', 'produto_errado', 'danificado', 'qualidade_recusada', 'lote_divergente', 'validade_inadequada', 'outro'];
const LITROS_FECH = '(COALESCE(of.litros_popular,0)+COALESCE(of.litros_medio,0)+COALESCE(of.litros_grosso,0))';
const mpMaterias = () => { try { const a = JSON.parse(getConfig('mp_materias', '["SACA-ACAI"]')); return Array.isArray(a) && a.length ? a : ['SACA-ACAI']; } catch { return ['SACA-ACAI']; } };
const digitos = (s) => (s || '').replace(/\D/g, '');
function proximoCodigoFornecedor() { const n = (+getConfig('forn_seq', '0') || 0) + 1; setConfig('forn_seq', String(n)); return 'FORN-' + String(n).padStart(4, '0'); }
function sufixoMateria(cod) { const m = { 'SACA-ACAI': 'ACAI' }; return m[cod] || (cod || 'MP').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'MP'; }
function proximoLoteInterno(materiaCod) {
  const ano = new Date().getFullYear(), key = 'mp_lote_seq_' + ano;
  const seq = (+getConfig(key, '0') || 0) + 1; setConfig(key, String(seq));
  return 'LOT-' + sufixoMateria(materiaCod) + '-' + ano + '-' + String(seq).padStart(6, '0');
}
// Atualiza data 1ª/última compra do fornecedor (métrica de frequência).
function atualizarDatasFornecedor(fid) {
  if (!fid) return;
  const r = db.prepare("SELECT MIN(date(data_emissao)) pri, MAX(date(data_emissao)) ult FROM erp_compras WHERE fornecedor_id=? AND status<>'cancelada'").get(fid);
  db.prepare('UPDATE fornecedores SET data_primeira_compra=?, data_ultima_compra=? WHERE id=?').run(r.pri || null, r.ult || null, fid);
}
// Gera o LOTE INTERNO por item de matéria-prima da compra (idempotente por compra+matéria).
// Custo do lote inclui rateio proporcional de frete/outras−desconto (landed cost real por saca).
function criarLotesDaCompra(compra, itens, usuario) {
  const materias = mpMaterias();
  const subtotal = itens.reduce((s, it) => s + (+it.valor_total || (+it.quantidade || 0) * (+it.valor_unitario || 0)), 0);
  const ajuste = (+compra.frete || 0) + (+compra.outras_despesas || 0) - (+compra.desconto || 0);
  const fator = subtotal > 0 ? (subtotal + ajuste) / subtotal : 1;
  const criados = [];
  for (const it of itens) {
    const cod = (it.produto_codigo || '').trim();
    if (!materias.includes(cod)) continue;
    const qtd = +it.quantidade || 0; if (qtd <= 0) continue;
    if (db.prepare('SELECT id FROM mp_lotes WHERE compra_id=? AND materia_codigo=?').get(compra.id, cod)) continue; // idempotente
    const baseTotal = +it.valor_total || qtd * (+it.valor_unitario || 0);
    const custoTotal = r2(baseTotal * fator), custoSaca = qtd > 0 ? r2(custoTotal / qtd) : 0;
    const lote = proximoLoteInterno(cod);
    const info = db.prepare(`INSERT INTO mp_lotes (lote_interno,lote_fornecedor,materia_codigo,fornecedor_id,compra_id,qtd,unidade,custo_total,custo_saca,saldo,data_recebimento,safra,status,criado_em,criado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'disponivel',?,?)`).run(lote, it.lote || '', cod, compra.fornecedor_id || null, compra.id, qtd, it.unidade || 'saca', custoTotal, custoSaca, qtd,
      (compra.data_recebimento || compra.data_emissao || ymdLocal(new Date())).slice(0, 10), it.safra || '', new Date().toISOString(), usuario || '');
    criados.push({ id: info.lastInsertRowid, lote_interno: lote, qtd, custo_saca: custoSaca });
    manut.logAcao('lote interno gerado', 'compras', { lote, compra_id: compra.id, materia: cod, qtd, custo_saca: custoSaca, por: usuario }, 'operacao');
  }
  return criados;
}
// Cancelamento de compra → anula os lotes dela (mantém histórico de consumo já ocorrido).
function anularLotesDaCompra(compraId) {
  for (const l of db.prepare("SELECT * FROM mp_lotes WHERE compra_id=? AND status<>'cancelado'").all(compraId))
    db.prepare("UPDATE mp_lotes SET status='cancelado', saldo=0 WHERE id=?").run(l.id);
}
// Consumo FIFO das sacas informadas no fechamento. Idempotente por fechamento.
// Não move estoque (a baixa física do SACA-ACAI já é feita pela reconciliação);
// aqui é a ATRIBUIÇÃO DE CUSTO por lote/fornecedor.
function consumirLotesFechamento(fechamentoId, sacas) {
  if (db.prepare('SELECT 1 FROM mp_fechamento_consumo WHERE fechamento_id=?').get(fechamentoId)) return { jaConsumido: true };
  let restante = r2(+sacas || 0), custoTotal = 0; const parcelas = [];
  if (restante > 0) {
    const materia = getConfig('operacao_saca_codigo', 'SACA-ACAI');
    const lotes = db.prepare("SELECT * FROM mp_lotes WHERE materia_codigo=? AND status='disponivel' AND saldo>0.0001 ORDER BY date(data_recebimento) ASC, id ASC").all(materia);
    for (const l of lotes) {
      if (restante <= 0.0001) break;
      const usa = r2(Math.min(l.saldo, restante)), custo = r2(usa * l.custo_saca);
      db.prepare('INSERT INTO mp_fechamento_consumo (fechamento_id,mp_lote_id,lote_interno,fornecedor_id,materia_codigo,sacas,custo_atribuido,custo_saca,criado_em) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(fechamentoId, l.id, l.lote_interno, l.fornecedor_id, l.materia_codigo, usa, custo, l.custo_saca, new Date().toISOString());
      const novo = r2(l.saldo - usa);
      db.prepare("UPDATE mp_lotes SET saldo=?, status=CASE WHEN ?<=0.0001 THEN 'esgotado' ELSE 'disponivel' END WHERE id=?").run(novo, novo, l.id);
      parcelas.push({ lote_interno: l.lote_interno, fornecedor_id: l.fornecedor_id, sacas: usa, custo });
      custoTotal = r2(custoTotal + custo); restante = r2(restante - usa);
    }
  }
  db.prepare('UPDATE operacao_fechamentos SET custo_mp=? WHERE id=?').run(custoTotal, fechamentoId);
  if (restante > 0.01) manut.logAcao('fechamento com sacas sem lote', 'compras', { fechamento_id: fechamentoId, sacas_sem_lote: restante }, 'operacao');
  return { custoTotal, parcelas, semLote: restante };
}
// Reverte o consumo de um fechamento (reprocessamento/cancelamento) — devolve saldo aos lotes.
function reverterConsumoFechamento(fechamentoId) {
  for (const c of db.prepare('SELECT * FROM mp_fechamento_consumo WHERE fechamento_id=?').all(fechamentoId)) {
    db.prepare("UPDATE mp_lotes SET saldo=ROUND(saldo+?,4), status='disponivel' WHERE id=?").run(c.sacas, c.mp_lote_id);
  }
  db.prepare('DELETE FROM mp_fechamento_consumo WHERE fechamento_id=?').run(fechamentoId);
  db.prepare('UPDATE operacao_fechamentos SET custo_mp=NULL WHERE id=?').run(fechamentoId);
}

// ── Análise por fornecedor (preço/rendimento/custo real, tudo rastreável) ──
function fornecedorAnaliseMP(fid) {
  const lot = db.prepare("SELECT COUNT(*) nLotes, COALESCE(SUM(qtd),0) sacas, COALESCE(SUM(custo_total),0) valor, COALESCE(SUM(saldo),0) saldoSacas, MIN(custo_saca) minSaca, MAX(custo_saca) maxSaca, AVG(custo_saca) mediaSaca, MIN(data_recebimento) primeira, MAX(data_recebimento) ultima FROM mp_lotes WHERE fornecedor_id=? AND status<>'cancelado'").get(fid);
  const cons = db.prepare(`SELECT COALESCE(SUM(mc.sacas),0) sacasCons, COALESCE(SUM(mc.custo_atribuido),0) custoCons,
     COALESCE(SUM(CASE WHEN of.sacas_usadas>0 THEN ${LITROS_FECH}*mc.sacas/of.sacas_usadas ELSE 0 END),0) litros
     FROM mp_fechamento_consumo mc JOIN operacao_fechamentos of ON of.id=mc.fechamento_id WHERE mc.fornecedor_id=?`).get(fid);
  const litros = r2(cons.litros), custoCons = r2(cons.custoCons), sacasCons = r2(cons.sacasCons);
  const lotesEstoque = db.prepare("SELECT COUNT(*) n FROM mp_lotes WHERE fornecedor_id=? AND status='disponivel' AND saldo>0.0001").get(fid).n;
  // melhor/pior rendimento por fechamento (só fechamentos que consumiram deste fornecedor)
  const rendFech = db.prepare(`SELECT of.id, ${LITROS_FECH} litros, SUM(mc.sacas) sacas FROM mp_fechamento_consumo mc JOIN operacao_fechamentos of ON of.id=mc.fechamento_id WHERE mc.fornecedor_id=? GROUP BY of.id HAVING sacas>0`).all(fid)
    .map(r => r2(r.litros * (r.sacas / db.prepare('SELECT sacas_usadas s FROM operacao_fechamentos WHERE id=?').get(r.id).s) / r.sacas)).filter(x => x > 0);
  return {
    nLotes: lot.nLotes, sacasCompradas: r2(lot.sacas), valorComprado: r2(lot.valor),
    precoMedioSaca: r2(lot.mediaSaca || 0), menorSaca: r2(lot.minSaca || 0), maiorSaca: r2(lot.maxSaca || 0),
    primeiraCompra: lot.primeira, ultimaCompra: lot.ultima, saldoSacas: r2(lot.saldoSacas), lotesEmEstoque: lotesEstoque,
    litrosProduzidos: litros, sacasConsumidas: sacasCons,
    rendimentoMedioSaca: sacasCons > 0 ? r2(litros / sacasCons) : null,
    melhorRendimento: rendFech.length ? Math.max(...rendFech) : null, piorRendimento: rendFech.length ? Math.min(...rendFech) : null,
    custoMedioLitro: litros > 0 ? r2(custoCons / litros) : null,
  };
}
// Comparativo entre fornecedores (só os que têm compra de matéria-prima).
function comparativoFornecedores(minCompras) {
  const min = minCompras != null ? +minCompras : (+getConfig('ci_min_compras', '3') || 3);
  const forns = db.prepare("SELECT DISTINCT f.id, f.nome, f.codigo FROM fornecedores f JOIN mp_lotes l ON l.fornecedor_id=f.id WHERE l.status<>'cancelado'").all();
  const linhas = forns.map(f => { const a = fornecedorAnaliseMP(f.id); return { id: f.id, nome: f.nome, codigo: f.codigo, ...a, dadosSuficientes: a.nLotes >= min }; });
  // melhor custo-benefício = menor custo real por litro, com dados suficientes
  const comCusto = linhas.filter(l => l.custoMedioLitro != null && l.dadosSuficientes);
  const melhor = comCusto.length ? comCusto.reduce((a, b) => a.custoMedioLitro <= b.custoMedioLitro ? a : b) : null;
  return { min, linhas, melhorCustoBeneficio: melhor ? { id: melhor.id, nome: melhor.nome, custoMedioLitro: melhor.custoMedioLitro } : null };
}
// Alertas gerenciais calculados (sem IA). Limites configuráveis.
function comprasIntelAlertas() {
  const al = [];
  const pctPreco = +getConfig('ci_alerta_preco_pct', '15'), pctRend = +getConfig('ci_alerta_rend_pct', '15'), pctCusto = +getConfig('ci_alerta_custo_pct', '15');
  const diasSem = +getConfig('ci_dias_sem_compra', '30'), loteParadoDias = +getConfig('ci_lote_parado_dias', '45');
  // médias gerais
  const mediaSacaGeral = db.prepare("SELECT AVG(custo_saca) m FROM mp_lotes WHERE status<>'cancelado'").get().m || 0;
  const comp = comparativoFornecedores();
  const rendGeral = comp.linhas.filter(l => l.rendimentoMedioSaca != null);
  const mediaRendGeral = rendGeral.length ? rendGeral.reduce((s, l) => s + l.rendimentoMedioSaca, 0) / rendGeral.length : 0;
  const custoGeral = comp.linhas.filter(l => l.custoMedioLitro != null);
  const mediaCustoGeral = custoGeral.length ? custoGeral.reduce((s, l) => s + l.custoMedioLitro, 0) / custoGeral.length : 0;
  // preço da última saca acima da média recente do fornecedor
  for (const f of comp.linhas) {
    if (f.precoMedioSaca > 0 && mediaSacaGeral > 0 && f.precoMedioSaca > mediaSacaGeral * (1 + pctPreco / 100))
      al.push({ tipo: 'preco_alto', sev: 'atencao', fornecedor: f.nome, texto: `Preço médio da saca (${fmtBr(f.precoMedioSaca)}) acima da média geral (${fmtBr(mediaSacaGeral)}).` });
    if (f.rendimentoMedioSaca != null && mediaRendGeral > 0 && f.rendimentoMedioSaca < mediaRendGeral * (1 - pctRend / 100))
      al.push({ tipo: 'rendimento_baixo', sev: 'atencao', fornecedor: f.nome, texto: `Rendimento médio (${f.rendimentoMedioSaca} L/saca) abaixo da média geral (${r2(mediaRendGeral)} L/saca).` });
    if (f.custoMedioLitro != null && mediaCustoGeral > 0 && f.custoMedioLitro > mediaCustoGeral * (1 + pctCusto / 100))
      al.push({ tipo: 'custo_alto', sev: 'critico', fornecedor: f.nome, texto: `Custo real por litro (${fmtBr(f.custoMedioLitro)}) acima da média geral (${fmtBr(mediaCustoGeral)}).` });
    if (f.ultimaCompra) { const dias = Math.floor((Date.now() - new Date(f.ultimaCompra + 'T00:00:00').getTime()) / 864e5); if (dias >= diasSem) al.push({ tipo: 'sem_compra', sev: 'info', fornecedor: f.nome, texto: `Sem compras há ${dias} dias.` }); }
  }
  // lotes parados no estoque (sem consumo) há X dias
  const lim = ymdLocal(new Date(Date.now() - loteParadoDias * 864e5));
  for (const l of db.prepare("SELECT lote_interno, saldo, data_recebimento FROM mp_lotes WHERE status='disponivel' AND saldo>0.0001 AND date(data_recebimento)<?").all(lim))
    al.push({ tipo: 'lote_parado', sev: 'atencao', texto: `Lote ${l.lote_interno} parado no estoque (${r2(l.saldo)} sacas) desde ${l.data_recebimento}.` });
  // saldo vencido em contas a pagar de fornecedores (reusa contas_pagar)
  const hoje = ymdLocal(new Date());
  for (const c of db.prepare("SELECT cp.id, cp.valor_total, cp.data_vencimento, f.nome FROM contas_pagar cp JOIN fornecedores f ON f.id=cp.fornecedor_id WHERE cp.cancelada_em IS NULL AND cp.data_vencimento<? ").all(hoje)) {
    const rest = r2((c.valor_total || 0) - valorPagoConta(c.id)); if (rest > 0.01) al.push({ tipo: 'saldo_vencido', sev: 'critico', fornecedor: c.nome, texto: `Conta vencida (${fmtBr(rest)}) desde ${c.data_vencimento}.` });
  }
  // ── Fase 45.1: alertas de RECEBIMENTO ──
  const recParcialDias = +getConfig('ci_receb_parcial_dias', '7'), divDias = +getConfig('ci_divergencia_dias', '3'), fornDivMin = +getConfig('ci_forn_divergencias_min', '3');
  const limParcial = ymdLocal(new Date(Date.now() - recParcialDias * 864e5));
  for (const c of db.prepare("SELECT c.id, c.status_recebimento, c.qtd_pedida, c.qtd_recebida, c.data_emissao, f.nome FROM erp_compras c LEFT JOIN fornecedores f ON f.id=c.fornecedor_id WHERE c.recebimento_modo='manual' AND c.status IN ('aberto','parcial','pago') AND c.status_recebimento IN ('aguardando','parcial')").all()) {
    const pend = r2((c.qtd_pedida || 0) - (c.qtd_recebida || 0));
    if (c.data_emissao && String(c.data_emissao).slice(0, 10) < limParcial)
      al.push({ tipo: 'receb_parado', sev: 'atencao', fornecedor: c.nome, texto: `Compra #${c.id} ${c.status_recebimento === 'aguardando' ? 'sem recebimento' : 'parcial'} há mais de ${recParcialDias} dias (${pend} pendente(s)).` });
    else if (pend > 0.0001)
      al.push({ tipo: 'qtd_pendente', sev: 'info', fornecedor: c.nome, texto: `Compra #${c.id} com ${pend} unidade(s) pendente(s) de recebimento.` });
  }
  // divergências sem solução (compra em 'divergencia' há X dias) + recebimentos recusados
  const limDiv = ymdLocal(new Date(Date.now() - divDias * 864e5));
  for (const c of db.prepare("SELECT c.id, c.atualizado_em, f.nome FROM erp_compras c LEFT JOIN fornecedores f ON f.id=c.fornecedor_id WHERE c.status_recebimento='divergencia' AND c.status<>'cancelada'").all())
    if (!c.atualizado_em || String(c.atualizado_em).slice(0, 10) <= limDiv) al.push({ tipo: 'divergencia', sev: 'atencao', fornecedor: c.nome, texto: `Compra #${c.id} com divergência de recebimento sem solução.` });
  for (const r of db.prepare("SELECT r.id, r.compra_id, f.nome FROM erp_recebimentos r LEFT JOIN fornecedores f ON f.id=r.fornecedor_id WHERE r.status='recusado'").all())
    al.push({ tipo: 'receb_recusado', sev: 'atencao', fornecedor: r.nome, texto: `Recebimento #${r.id} (compra #${r.compra_id}) foi recusado.` });
  // lote sem vínculo correto (matéria-prima sem fornecedor)
  for (const l of db.prepare("SELECT lote_interno FROM mp_lotes WHERE status<>'cancelado' AND (fornecedor_id IS NULL)").all())
    al.push({ tipo: 'lote_sem_vinculo', sev: 'info', texto: `Lote ${l.lote_interno} sem fornecedor vinculado.` });
  // fornecedor com divergências repetidas
  for (const f of db.prepare(`SELECT f.nome, COUNT(*) n FROM erp_recebimentos_itens ri JOIN erp_recebimentos r ON r.id=ri.recebimento_id JOIN fornecedores f ON f.id=r.fornecedor_id WHERE (ri.qtd_recusada>0 OR (ri.motivo_divergencia IS NOT NULL AND ri.motivo_divergencia<>'')) GROUP BY f.id HAVING n>=?`).all(fornDivMin))
    al.push({ tipo: 'forn_divergencias', sev: 'atencao', fornecedor: f.nome, texto: `Fornecedor com ${f.n} divergências de recebimento registradas.` });
  return al;
}
const fmtBr = (v) => 'R$ ' + (r2(v || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Dashboard gerencial (período opcional via faixaPeriodo).
function comprasIntelDashboard(fx) {
  const wc = wherePeriodo('date(l.data_recebimento)', fx);
  const tot = db.prepare(`SELECT COUNT(*) nLotes, COALESCE(SUM(l.qtd),0) sacas, COALESCE(SUM(l.custo_total),0) valor, AVG(l.custo_saca) precoSaca FROM mp_lotes l WHERE l.status<>'cancelado'${wc.clause}`).get(...wc.args);
  const consumo = db.prepare(`SELECT COALESCE(SUM(mc.sacas),0) sacas, COALESCE(SUM(mc.custo_atribuido),0) custo, COALESCE(SUM(CASE WHEN of.sacas_usadas>0 THEN ${LITROS_FECH}*mc.sacas/of.sacas_usadas ELSE 0 END),0) litros FROM mp_fechamento_consumo mc JOIN operacao_fechamentos of ON of.id=mc.fechamento_id`).get();
  const comp = comparativoFornecedores();
  const maisUsado = db.prepare("SELECT f.nome, COUNT(*) n FROM mp_lotes l JOIN fornecedores f ON f.id=l.fornecedor_id WHERE l.status<>'cancelado' GROUP BY f.id ORDER BY n DESC LIMIT 1").get();
  const melhorRend = comp.linhas.filter(l => l.rendimentoMedioSaca != null).sort((a, b) => b.rendimentoMedioSaca - a.rendimentoMedioSaca)[0] || null;
  const litros = r2(consumo.litros);
  return {
    totalComprado: r2(tot.valor), sacas: r2(tot.sacas), nLotes: tot.nLotes, precoMedioSaca: r2(tot.precoSaca || 0),
    litrosProduzidos: litros, rendimentoMedioSaca: consumo.sacas > 0 ? r2(litros / consumo.sacas) : null,
    custoMedioLitro: litros > 0 ? r2(consumo.custo / litros) : null,
    fornecedorMaisUsado: maisUsado ? maisUsado.nome : null,
    melhorRendimento: melhorRend ? { nome: melhorRend.nome, rendimento: melhorRend.rendimentoMedioSaca } : null,
    melhorCustoBeneficio: comp.melhorCustoBeneficio,
    ultimaCompra: db.prepare("SELECT MAX(date(data_recebimento)) u FROM mp_lotes WHERE status<>'cancelado'").get().u,
    alertas: comprasIntelAlertas(),
  };
}
// Resumo consolidado e RASTREÁVEL p/ a IA (só consulta/explica; nunca executa compra).
function comprasIntelResumoIA() {
  const d = comprasIntelDashboard(faixaPeriodo({ periodo: 'mes' }));
  const comp = comparativoFornecedores();
  return {
    mes: { total_comprado: d.totalComprado, sacas: d.sacas, preco_medio_saca: d.precoMedioSaca, custo_medio_litro: d.custoMedioLitro, rendimento_medio_saca: d.rendimentoMedioSaca },
    fornecedor_mais_usado: d.fornecedorMaisUsado, melhor_rendimento: d.melhorRendimento, melhor_custo_beneficio: d.melhorCustoBeneficio,
    fornecedores: comp.linhas.map(l => ({ nome: l.nome, sacas: l.sacasCompradas, preco_saca: l.precoMedioSaca, rendimento_saca: l.rendimentoMedioSaca, custo_litro: l.custoMedioLitro, ultima_compra: l.ultimaCompra })),
    lotes_em_estoque: db.prepare("SELECT COUNT(*) n FROM mp_lotes WHERE status='disponivel' AND saldo>0.0001").get().n,
    alertas: d.alertas.length,
  };
}

// ══ Endpoints — COMPRAS INTELIGENTES ══
app.get('/api/erp/inteligencia/dashboard', (req, res) => { if (!gateBI(req, res)) return; res.json(comprasIntelDashboard(faixaPeriodo(req.query))); });
app.get('/api/erp/inteligencia/comparativo', (req, res) => { if (!gateBI(req, res)) return; res.json(comparativoFornecedores(req.query.min)); });
app.get('/api/erp/inteligencia/alertas', (req, res) => { if (!gateBI(req, res)) return; res.json({ alertas: comprasIntelAlertas() }); });
app.get('/api/erp/inteligencia/fornecedor/:id', (req, res) => { if (!gateBI(req, res)) return; res.json(fornecedorAnaliseMP(+req.params.id)); });
// Lotes internos (filtros: fornecedor, materia, status, em estoque)
app.get('/api/erp/lotes', (req, res) => {
  const w = ['1=1'], a = [];
  if (req.query.fornecedor_id) { w.push('l.fornecedor_id=?'); a.push(+req.query.fornecedor_id); }
  if (req.query.materia) { w.push('l.materia_codigo=?'); a.push(req.query.materia); }
  if (req.query.status) { w.push('l.status=?'); a.push(req.query.status); }
  if (req.query.em_estoque === '1') w.push("l.status='disponivel' AND l.saldo>0.0001");
  res.json(db.prepare(`SELECT l.*, f.nome fornecedor_nome FROM mp_lotes l LEFT JOIN fornecedores f ON f.id=l.fornecedor_id WHERE ${w.join(' AND ')} ORDER BY l.id DESC LIMIT 500`).all(...a));
});
app.get('/api/erp/lotes/:id', (req, res) => {
  const l = db.prepare('SELECT l.*, f.nome fornecedor_nome FROM mp_lotes l LEFT JOIN fornecedores f ON f.id=l.fornecedor_id WHERE l.id=?').get(+req.params.id);
  if (!l) return res.status(404).json({ erro: 'Lote não encontrado.' });
  l.consumos = db.prepare('SELECT mc.*, of.data fech_data, of.periodo FROM mp_fechamento_consumo mc JOIN operacao_fechamentos of ON of.id=mc.fechamento_id WHERE mc.mp_lote_id=? ORDER BY mc.id').all(+req.params.id);
  res.json(l);
});
// Rendimento/custo real por fechamento (rastreável)
app.get('/api/erp/inteligencia/fechamentos', (req, res) => {
  if (!gateBI(req, res)) return;
  const rows = db.prepare(`SELECT of.id, of.data, of.periodo, of.modo, of.sacas_usadas, ${LITROS_FECH} litros, of.custo_mp FROM operacao_fechamentos of WHERE of.status='confirmado' ORDER BY of.id DESC LIMIT 200`).all()
    .map(r => ({ ...r, litros: r2(r.litros), rendimento_saca: r.sacas_usadas > 0 ? r2(r.litros / r.sacas_usadas) : null, custo_litro: r.litros > 0 && r.custo_mp != null ? r2(r.custo_mp / r.litros) : null,
      parcelas: db.prepare('SELECT lote_interno, fornecedor_id, sacas, custo_atribuido FROM mp_fechamento_consumo WHERE fechamento_id=?').all(r.id) }));
  res.json(rows);
});
// Avaliações do fornecedor
app.get('/api/erp/fornecedores/:id/avaliacoes', (req, res) => res.json(db.prepare('SELECT * FROM fornecedor_avaliacoes WHERE fornecedor_id=? ORDER BY id DESC LIMIT 100').all(+req.params.id)));
app.post('/api/erp/fornecedores/:id/avaliacoes', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {}, nota = +d.nota;
  if (!(nota >= 0 && nota <= 5)) return res.status(400).json({ erro: 'Nota deve ser de 0 a 5.' });
  const info = db.prepare('INSERT INTO fornecedor_avaliacoes (fornecedor_id,compra_id,lote_interno,nota,criterios,obs,usuario,criado_em) VALUES (?,?,?,?,?,?,?,?)')
    .run(+req.params.id, +d.compra_id || null, d.lote_interno || '', r2(nota), d.criterios ? JSON.stringify(d.criterios) : null, d.obs || '', (req.usuario || {}).usuario || '', new Date().toISOString());
  manut.logAcao('avaliação de fornecedor', 'fornecedores', { id: info.lastInsertRowid, fornecedor_id: +req.params.id, nota, por: (req.usuario || {}).usuario }, 'config');
  res.json({ ok: true, id: info.lastInsertRowid });
});
// Reprocessamento do vínculo produção↔lote (gestor) — reverte e refaz o consumo FIFO, em transação.
app.post('/api/erp/inteligencia/reprocessar-fechamento/:id', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const f = db.prepare('SELECT * FROM operacao_fechamentos WHERE id=?').get(+req.params.id);
  if (!f) return res.status(404).json({ erro: 'Fechamento não encontrado.' });
  if (f.status !== 'confirmado') return res.status(400).json({ erro: 'Só fechamentos confirmados.' });
  db.exec('BEGIN');
  try { reverterConsumoFechamento(f.id); const r = consumirLotesFechamento(f.id, f.sacas_usadas); db.exec('COMMIT');
    manut.logAcao('reprocessamento de consumo do fechamento', 'compras', { fechamento_id: f.id, motivo: (req.body || {}).motivo || '', custo: r.custoTotal, por: (req.usuario || {}).usuario }, 'operacao');
    res.json({ ok: true, ...r });
  } catch (e) { db.exec('ROLLBACK'); res.status(500).json({ erro: e.message }); }
});
// Relatórios (JSON ou CSV) — reusa as agregações acima.
function csvDe(linhas, colunas) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [colunas.map(c => c.h).join(';'), ...linhas.map(l => colunas.map(c => esc(l[c.k])).join(';'))].join('\n');
}
app.get('/api/erp/inteligencia/relatorio', (req, res) => {
  if (!gateBI(req, res)) return;
  const tipo = req.query.tipo || 'comparativo', formato = req.query.formato || 'json';
  let linhas = [], colunas = [];
  if (tipo === 'comparativo') { linhas = comparativoFornecedores(req.query.min).linhas; colunas = [{ k: 'nome', h: 'Fornecedor' }, { k: 'sacasCompradas', h: 'Sacas' }, { k: 'precoMedioSaca', h: 'Preço médio saca' }, { k: 'rendimentoMedioSaca', h: 'Rend. médio (L/saca)' }, { k: 'custoMedioLitro', h: 'Custo real/L' }, { k: 'saldoSacas', h: 'Saldo sacas' }, { k: 'ultimaCompra', h: 'Última compra' }]; }
  else if (tipo === 'lotes') { linhas = db.prepare("SELECT l.lote_interno, f.nome fornecedor, l.qtd, l.saldo, l.custo_saca, l.data_recebimento, l.status FROM mp_lotes l LEFT JOIN fornecedores f ON f.id=l.fornecedor_id ORDER BY l.id DESC").all(); colunas = [{ k: 'lote_interno', h: 'Lote' }, { k: 'fornecedor', h: 'Fornecedor' }, { k: 'qtd', h: 'Sacas' }, { k: 'saldo', h: 'Saldo' }, { k: 'custo_saca', h: 'Custo/saca' }, { k: 'data_recebimento', h: 'Recebimento' }, { k: 'status', h: 'Status' }]; }
  else if (tipo === 'fechamentos') { linhas = db.prepare(`SELECT of.data, of.periodo, of.sacas_usadas sacas, ${LITROS_FECH} litros, of.custo_mp FROM operacao_fechamentos of WHERE of.status='confirmado' ORDER BY of.id DESC`).all().map(r => ({ ...r, litros: r2(r.litros), rendimento: r.sacas > 0 ? r2(r.litros / r.sacas) : '', custo_litro: r.litros > 0 && r.custo_mp != null ? r2(r.custo_mp / r.litros) : '' })); colunas = [{ k: 'data', h: 'Data' }, { k: 'periodo', h: 'Período' }, { k: 'sacas', h: 'Sacas' }, { k: 'litros', h: 'Litros' }, { k: 'rendimento', h: 'Rend. (L/saca)' }, { k: 'custo_mp', h: 'Custo MP' }, { k: 'custo_litro', h: 'Custo/L' }]; }
  if (formato === 'csv') { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="relatorio_${tipo}.csv"`); return res.send('﻿' + csvDe(linhas, colunas)); }
  res.json({ tipo, colunas, linhas });
});

/* ══ FASE 45.1 — RECEBIMENTO PARCIAL: motor (estoque + lote interno + financeiro) ══
   Reusa registrarMovimento (estoque), contas_pagar (financeiro) e mp_lotes/FIFO (Fase 45).
   Cada recebimento é idempotente por 'integrado' — nunca dá entrada/lote/conta 2x. */

// Fator landed (frete/outras−desconto rateado) da COMPRA — mesma regra da Fase 45.
function fatorLandedCompra(compra) {
  const itens = db.prepare('SELECT * FROM erp_compras_itens WHERE compra_id=?').all(compra.id);
  const subtotal = itens.reduce((s, it) => s + (+it.valor_total || (+it.quantidade || 0) * (+it.valor_unitario || 0)), 0);
  const ajuste = (+compra.frete || 0) + (+compra.outras_despesas || 0) - (+compra.desconto || 0);
  return subtotal > 0 ? (subtotal + ajuste) / subtotal : 1;
}
// Recalcula comprado/recebido/pendente/recusado e o STATUS de recebimento da compra.
function recomputarStatusRecebimentoCompra(compraId) {
  const c = db.prepare('SELECT status FROM erp_compras WHERE id=?').get(compraId);
  if (c && c.status === 'cancelada') return 'cancelada';
  const itens = db.prepare('SELECT * FROM erp_compras_itens WHERE compra_id=?').all(compraId);
  let pedido = 0, recebido = 0, recusado = 0;
  for (const it of itens) { pedido += +it.quantidade || 0; recebido += +it.qtd_recebida || 0; recusado += +it.qtd_recusada || 0; }
  pedido = r2(pedido); recebido = r2(recebido); recusado = r2(recusado);
  const pendente = r2(pedido - recebido - recusado);
  let st;
  if (recebido <= 0.0001 && recusado <= 0.0001) st = 'aguardando';
  else if (pendente > 0.0001) st = 'parcial';
  else st = recusado > 0.0001 ? 'divergencia' : 'recebida'; // tudo contabilizado (recebido+recusado = pedido)
  db.prepare('UPDATE erp_compras SET status_recebimento=?, qtd_pedida=?, qtd_recebida=?, atualizado_em=? WHERE id=?').run(st, pedido, recebido, new Date().toISOString(), compraId);
  return st;
}
// Gera o LOTE INTERNO (mp_lotes) da matéria-prima RECEBIDA neste recebimento (idempotente por recebimento+matéria).
function criarLotesDoRecebimento(compra, rec, itensRec, usuario) {
  const materias = mpMaterias(), fator = fatorLandedCompra(compra), criados = [];
  for (const itr of itensRec) {
    const cod = (itr.produto_codigo || '').trim();
    if (!materias.includes(cod)) continue;
    const qtd = +itr.qtd_recebida || 0; if (qtd <= 0) continue;
    if (db.prepare('SELECT id FROM mp_lotes WHERE recebimento_id=? AND materia_codigo=?').get(rec.id, cod)) continue; // idempotente
    const ci = itr.compra_item_id ? db.prepare('SELECT valor_unitario FROM erp_compras_itens WHERE id=?').get(itr.compra_item_id) : null;
    const vu = ci ? (+ci.valor_unitario || 0) : 0;
    const custoTotal = r2(qtd * vu * fator), custoSaca = qtd > 0 ? r2(custoTotal / qtd) : 0;
    const lote = proximoLoteInterno(cod);
    const info = db.prepare(`INSERT INTO mp_lotes (lote_interno,lote_fornecedor,materia_codigo,fornecedor_id,compra_id,recebimento_id,qtd,unidade,custo_total,custo_saca,saldo,data_recebimento,safra,status,criado_em,criado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'disponivel',?,?)`).run(lote, itr.lote_fornecedor || '', cod, compra.fornecedor_id || null, compra.id, rec.id, qtd, 'saca', custoTotal, custoSaca, qtd,
      (rec.data || compra.data_recebimento || compra.data_emissao || ymdLocal(new Date())).slice(0, 10), itr.safra || '', new Date().toISOString(), usuario || '');
    criados.push({ id: info.lastInsertRowid, lote_interno: lote, qtd, custo_saca: custoSaca });
    manut.logAcao('lote interno gerado (recebimento)', 'compras', { lote, compra_id: compra.id, recebimento_id: rec.id, materia: cod, qtd, custo_saca: custoSaca, por: usuario }, 'operacao');
  }
  return criados;
}
// Quando a matéria-prima da compra fica TOTALMENTE recebida, ajusta o último lote pra a soma
// dos lotes internos fechar EXATO com o custo landed da compra (arredondamento → R$ 0,00).
function reconciliarLotesCompra(compraId) {
  const compra = db.prepare('SELECT * FROM erp_compras WHERE id=?').get(compraId);
  if (!compra) return;
  const fator = fatorLandedCompra(compra), itens = db.prepare('SELECT * FROM erp_compras_itens WHERE compra_id=?').all(compraId);
  for (const cod of mpMaterias()) {
    const lin = itens.filter(it => (it.produto_codigo || '').trim() === cod);
    if (!lin.length) continue;
    const pedido = r2(lin.reduce((s, it) => s + (+it.quantidade || 0), 0));
    const recebido = r2(lin.reduce((s, it) => s + (+it.qtd_recebida || 0), 0));
    const recusado = r2(lin.reduce((s, it) => s + (+it.qtd_recusada || 0), 0));
    if (r2(recebido + recusado) + 0.0001 < pedido) continue; // ainda pendente → não força fechamento
    if (recebido <= 0.0001) continue;
    // alvo = custo landed da parte efetivamente RECEBIDA da matéria (recusa não vira lote).
    const alvo = r2(lin.reduce((s, it) => { const base = (+it.valor_unitario || 0) * (+it.qtd_recebida || 0); return s + base * fator; }, 0));
    const lotes = db.prepare("SELECT * FROM mp_lotes WHERE compra_id=? AND materia_codigo=? AND status<>'cancelado' ORDER BY id").all(compraId, cod);
    if (!lotes.length) continue;
    const soma = r2(lotes.reduce((s, l) => s + (+l.custo_total || 0), 0));
    const dif = r2(alvo - soma);
    if (Math.abs(dif) >= 0.01) {
      const ult = lotes[lotes.length - 1], novoTotal = r2((+ult.custo_total || 0) + dif), novaSaca = ult.qtd > 0 ? r2(novoTotal / ult.qtd) : ult.custo_saca;
      db.prepare('UPDATE mp_lotes SET custo_total=?, custo_saca=? WHERE id=?').run(novoTotal, novaSaca, ult.id);
    }
  }
}
// Conta a pagar PROPORCIONAL ao recebido (financeiro_base='recebido') — idempotente por recebimento.
function contaPagarRecebidoErp(compra, rec, valor) {
  if (!(valor > 0)) return null;
  const existe = db.prepare('SELECT id FROM contas_pagar WHERE erp_recebimento_id=?').get(rec.id);
  if (existe) return existe.id;
  const forn = compra.fornecedor_id ? db.prepare('SELECT nome FROM fornecedores WHERE id=?').get(compra.fornecedor_id) : null;
  const info = db.prepare(`INSERT INTO contas_pagar (fornecedor_id,compra_id,erp_recebimento_id,categoria_id,descricao,valor_total,data_emissao,data_vencimento,status,obs,criado_em,criado_por)
     VALUES (?,?,?,?,?,?,?,?, 'aberto', ?,?,?)`).run(compra.fornecedor_id || null, compra.id, rec.id, catFinId('Compra'),
     `Recebimento compra #${compra.id}${compra.numero_nf ? ' NF ' + compra.numero_nf : ''}${forn ? ' · ' + forn.nome : ''}`, r2(valor), (rec.data || new Date().toISOString()).slice(0, 10), compra.data_vencimento || null, '', new Date().toISOString(), rec.criado_por || '');
  return info.lastInsertRowid;
}
// APROVAR recebimento → entrada (só do recebido) + lote interno + financeiro (conforme base). Idempotente.
function aprovarRecebimentoErp(recId, usuario) {
  const rec = db.prepare('SELECT * FROM erp_recebimentos WHERE id=?').get(recId);
  if (!rec) throw new Error('Recebimento não encontrado.');
  if (rec.status === 'cancelado' || rec.status === 'recusado') throw new Error('Recebimento não está pendente.');
  if (rec.integrado) return { jaIntegrado: true };
  const compra = db.prepare('SELECT * FROM erp_compras WHERE id=?').get(rec.compra_id);
  if (!compra) throw new Error('Compra não encontrada.');
  if (compra.status === 'cancelada') throw new Error('Compra cancelada.');
  const itens = db.prepare('SELECT * FROM erp_recebimentos_itens WHERE recebimento_id=?').all(recId);
  const agora = new Date().toISOString(), fator = fatorLandedCompra(compra);
  let valorRecebido = 0;
  for (const it of itens) {
    const qtd = +it.qtd_recebida || 0; if (qtd <= 0) continue;
    const ci = it.compra_item_id ? db.prepare('SELECT * FROM erp_compras_itens WHERE id=?').get(it.compra_item_id) : null;
    const vu = ci ? (+ci.valor_unitario || 0) : 0;
    valorRecebido += qtd * vu * fator;
    if (it.produto_codigo && db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(it.produto_codigo)) {
      registrarMovimento(it.produto_codigo, 'entrada', { quantidade: qtd, motivo: 'recebimento compra ERP #' + compra.id, referencia: 'erp_receb#' + recId });
      if (vu > 0) db.prepare('UPDATE produtos SET precoCompra=?, atualizado_em=? WHERE codigo=?').run(vu, agora, it.produto_codigo);
    }
    if (ci) db.prepare('UPDATE erp_compras_itens SET qtd_recebida=COALESCE(qtd_recebida,0)+?, qtd_recusada=COALESCE(qtd_recusada,0)+? WHERE id=?').run(qtd, +it.qtd_recusada || 0, ci.id);
  }
  const lotes = criarLotesDoRecebimento(compra, rec, itens, usuario);
  const st = recomputarStatusRecebimentoCompra(compra.id);
  if (st === 'recebida' || st === 'divergencia') reconciliarLotesCompra(compra.id);
  let contaId = null;
  if (compra.financeiro_base === 'recebido') contaId = contaPagarRecebidoErp(compra, rec, r2(valorRecebido));
  db.prepare("UPDATE erp_recebimentos SET status='aprovado', integrado=1 WHERE id=?").run(recId);
  manut.logAcao('recebimento aprovado', 'compras', { recebimento: recId, compra_id: compra.id, valor: r2(valorRecebido), lotes: lotes.length, conta_pagar: contaId, status_recebimento: st, por: usuario }, 'operacao');
  return { ok: true, status_recebimento: st, lotes, conta_pagar_id: contaId, valor_recebido: r2(valorRecebido) };
}
// RECUSAR recebimento inteiro (antes de integrar) — não mexe em estoque/financeiro.
function recusarRecebimentoErp(recId, motivo, usuario) {
  const rec = db.prepare('SELECT * FROM erp_recebimentos WHERE id=?').get(recId);
  if (!rec) return { erro: 'Recebimento não encontrado.' };
  if (rec.integrado) return { erro: 'Recebimento já integrado — use estornar.' };
  db.prepare("UPDATE erp_recebimentos SET status='recusado', obs=? WHERE id=?").run((rec.obs ? rec.obs + ' · ' : '') + 'RECUSADO: ' + (motivo || ''), recId);
  recomputarStatusRecebimentoCompra(rec.compra_id);
  manut.logAcao('recebimento recusado', 'compras', { recebimento: recId, compra_id: rec.compra_id, motivo: motivo || '', por: usuario }, 'operacao');
  return { ok: true };
}
// ESTORNAR recebimento integrado (admin) — desfaz estoque + lote(s) + conta, se for seguro.
function estornarRecebimentoErp(recId, usuario) {
  const rec = db.prepare('SELECT * FROM erp_recebimentos WHERE id=?').get(recId);
  if (!rec) return { erro: 'Recebimento não encontrado.' };
  if (!rec.integrado) return { erro: 'Recebimento não integrado (nada a estornar).' };
  const compra = db.prepare('SELECT * FROM erp_compras WHERE id=?').get(rec.compra_id);
  // trava: conta a pagar deste recebimento já paga?
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE erp_recebimento_id=?').get(recId);
  if (conta) { const pago = db.prepare('SELECT COALESCE(SUM(valor),0) v FROM contas_pagar_pagamentos WHERE conta_pagar_id=? AND estornado=0').get(conta.id).v; if (pago > 0.005) return { erro: 'A conta a pagar deste recebimento já teve pagamento. Estorne o pagamento antes.' }; }
  // trava: algum lote deste recebimento já foi consumido em fechamento?
  const lotes = db.prepare('SELECT * FROM mp_lotes WHERE recebimento_id=?').all(recId);
  for (const l of lotes) { if (r2((+l.qtd || 0) - (+l.saldo || 0)) > 0.0001) return { erro: `O lote ${l.lote_interno} deste recebimento já foi consumido na produção. Não é possível estornar.` }; }
  const itens = db.prepare('SELECT * FROM erp_recebimentos_itens WHERE recebimento_id=?').all(recId);
  for (const it of itens) {
    const qtd = +it.qtd_recebida || 0; if (qtd <= 0) continue;
    if (it.produto_codigo && db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(it.produto_codigo))
      registrarMovimento(it.produto_codigo, 'saida', { quantidade: qtd, motivo: 'estorno recebimento compra', referencia: 'estorno-erp-receb#' + recId });
    if (it.compra_item_id) db.prepare('UPDATE erp_compras_itens SET qtd_recebida=MAX(0,COALESCE(qtd_recebida,0)-?), qtd_recusada=MAX(0,COALESCE(qtd_recusada,0)-?) WHERE id=?').run(qtd, +it.qtd_recusada || 0, it.compra_item_id);
  }
  for (const l of lotes) db.prepare("UPDATE mp_lotes SET status='cancelado', saldo=0 WHERE id=?").run(l.id);
  if (conta) db.prepare('DELETE FROM contas_pagar WHERE id=?').run(conta.id);
  db.prepare("UPDATE erp_recebimentos SET status='estornado', integrado=0 WHERE id=?").run(recId);
  const st = recomputarStatusRecebimentoCompra(rec.compra_id);
  manut.logAcao('recebimento estornado', 'compras', { recebimento: recId, compra_id: rec.compra_id, lotes: lotes.length, conta: conta ? conta.id : null, status_recebimento: st, por: usuario }, 'operacao');
  return { ok: true, status_recebimento: st };
}
// Cria um recebimento (pendente) para uma compra. Valida quantidades contra o pendente por item.
function criarRecebimentoErp(compra, d, usuario) {
  const itensCompra = db.prepare('SELECT * FROM erp_compras_itens WHERE compra_id=?').all(compra.id);
  const porId = Object.fromEntries(itensCompra.map(it => [it.id, it]));
  const linhas = Array.isArray(d.itens) ? d.itens : [];
  const norm = [];
  for (const l of linhas) {
    const ci = porId[+l.compra_item_id]; if (!ci) continue;
    const rec = Math.max(0, +l.qtd_recebida || 0), rej = Math.max(0, +l.qtd_recusada || 0);
    if (rec <= 0 && rej <= 0) continue;
    const pendente = r2((+ci.quantidade || 0) - (+ci.qtd_recebida || 0) - (+ci.qtd_recusada || 0));
    if (r2(rec + rej) > pendente + 0.01) throw new Error(`Quantidade (${r2(rec + rej)}) acima do pendente (${pendente}) do item ${ci.produto_codigo || ci.descricao}.`);
    const motivo = (rej > 0 || Math.abs(rec - (+ci.quantidade || 0)) > 0.0001) ? (l.motivo_divergencia || (rej > 0 ? 'falta' : '')) : '';
    norm.push({ compra_item_id: ci.id, produto_codigo: ci.produto_codigo, descricao: ci.descricao, qtd_esperada: pendente, qtd_recebida: r2(rec), qtd_recusada: r2(rej), diferenca: r2(rec - pendente), motivo_divergencia: motivo, lote_fornecedor: l.lote_fornecedor || '', validade: l.validade || '', obs: l.obs || '' });
  }
  if (!norm.length) throw new Error('Informe ao menos um item recebido ou recusado.');
  const agora = new Date().toISOString();
  const info = db.prepare('INSERT INTO erp_recebimentos (compra_id,fornecedor_id,data,usuario,status,integrado,obs,anexos,criado_em,criado_por) VALUES (?,?,?,?,?,0,?,?,?,?)')
    .run(compra.id, compra.fornecedor_id || null, (d.data || agora).slice(0, 19).replace('T', ' '), d.conferente || usuario || '', 'pendente', d.obs || '', d.anexos ? JSON.stringify(d.anexos) : null, agora, usuario || '');
  const rid = info.lastInsertRowid, ins = db.prepare('INSERT INTO erp_recebimentos_itens (recebimento_id,compra_item_id,produto_codigo,descricao,qtd_esperada,qtd_recebida,qtd_recusada,diferenca,motivo_divergencia,lote_fornecedor,validade,obs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const n of norm) ins.run(rid, n.compra_item_id, n.produto_codigo, n.descricao, n.qtd_esperada, n.qtd_recebida, n.qtd_recusada, n.diferenca, n.motivo_divergencia, n.lote_fornecedor, n.validade, n.obs);
  manut.logAcao('recebimento registrado', 'compras', { recebimento: rid, compra_id: compra.id, itens: norm.length, por: usuario }, 'operacao');
  return db.prepare('SELECT * FROM erp_recebimentos WHERE id=?').get(rid);
}
// Detalhe (recebimento + itens + lotes + conta gerada).
function recebimentoErpDetalhe(id) {
  const r = db.prepare('SELECT r.*, c.numero_nf, f.nome fornecedor FROM erp_recebimentos r LEFT JOIN erp_compras c ON c.id=r.compra_id LEFT JOIN fornecedores f ON f.id=r.fornecedor_id WHERE r.id=?').get(id);
  if (!r) return null;
  r.itens = db.prepare('SELECT * FROM erp_recebimentos_itens WHERE recebimento_id=?').all(id);
  r.lotes = db.prepare('SELECT id, lote_interno, materia_codigo, qtd, saldo, custo_total, custo_saca, status FROM mp_lotes WHERE recebimento_id=?').all(id);
  r.conta_pagar = db.prepare('SELECT id, descricao, valor_total, status, data_vencimento FROM contas_pagar WHERE erp_recebimento_id=?').get(id) || null;
  r.anexos = r.anexos ? (() => { try { return JSON.parse(r.anexos); } catch { return []; } })() : [];
  return r;
}
// Resumo de recebimento de uma compra (comprado/recebido/pendente/recusado por item + status).
function compraRecebimentoResumo(compraId) {
  const compra = db.prepare('SELECT * FROM erp_compras WHERE id=?').get(compraId);
  if (!compra) return null;
  const itens = db.prepare('SELECT * FROM erp_compras_itens WHERE compra_id=?').all(compraId).map(it => {
    const q = +it.quantidade || 0, r = +it.qtd_recebida || 0, x = +it.qtd_recusada || 0;
    return { id: it.id, produto_codigo: it.produto_codigo, descricao: it.descricao, valor_unitario: it.valor_unitario, comprado: r2(q), recebido: r2(r), recusado: r2(x), pendente: r2(q - r - x) };
  });
  const recebimentos = db.prepare('SELECT id, data, usuario, status, integrado, obs FROM erp_recebimentos WHERE compra_id=? ORDER BY id').all(compraId)
    .map(rc => ({ ...rc, itens: db.prepare('SELECT produto_codigo, qtd_recebida, qtd_recusada, motivo_divergencia, lote_fornecedor FROM erp_recebimentos_itens WHERE recebimento_id=?').all(rc.id) }));
  const tot = itens.reduce((a, it) => ({ comprado: a.comprado + it.comprado, recebido: a.recebido + it.recebido, recusado: a.recusado + it.recusado, pendente: a.pendente + it.pendente }), { comprado: 0, recebido: 0, recusado: 0, pendente: 0 });
  return { compra_id: compraId, recebimento_modo: compra.recebimento_modo, financeiro_base: compra.financeiro_base, status_recebimento: compra.status_recebimento, itens, totais: { comprado: r2(tot.comprado), recebido: r2(tot.recebido), recusado: r2(tot.recusado), pendente: r2(tot.pendente) }, recebimentos };
}

// ══ Endpoints — RECEBIMENTO PARCIAL ══
app.get('/api/erp/compras/:id/recebimento', (req, res) => { const r = compraRecebimentoResumo(+req.params.id); r ? res.json(r) : res.status(404).json({ erro: 'Compra não encontrada.' }); });
app.get('/api/erp/compras/:id/recebimentos', (req, res) => res.json(db.prepare('SELECT r.*, (SELECT COUNT(*) FROM erp_recebimentos_itens WHERE recebimento_id=r.id) n_itens FROM erp_recebimentos r WHERE r.compra_id=? ORDER BY r.id').all(+req.params.id)));
app.get('/api/erp/recebimentos/motivos', (_req, res) => res.json({ motivos: MOTIVOS_DIVERGENCIA }));
app.get('/api/erp/recebimentos/:id', (req, res) => { const r = recebimentoErpDetalhe(+req.params.id); r ? res.json(r) : res.status(404).json({ erro: 'Recebimento não encontrado.' }); });
// Criar recebimento (supervisor/comprador). Opcionalmente já aprova (aprovar:true).
app.post('/api/erp/compras/:id/recebimentos', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const compra = db.prepare('SELECT * FROM erp_compras WHERE id=?').get(+req.params.id);
  if (!compra) return res.status(404).json({ erro: 'Compra não encontrada.' });
  if (compra.status === 'cancelada') return res.status(400).json({ erro: 'Compra cancelada não recebe mercadoria.' });
  try {
    const r = emTransacao(() => {
      const rec = criarRecebimentoErp(compra, req.body || {}, (req.usuario || {}).usuario);
      let integ = null;
      if ((req.body || {}).aprovar) integ = aprovarRecebimentoErp(rec.id, (req.usuario || {}).usuario);
      return { recebimento: recebimentoErpDetalhe(rec.id), integracao: integ, resumo: compraRecebimentoResumo(compra.id) };
    });
    res.json(r);
  } catch (e) { res.status(400).json({ erro: e.message }); }
});
app.post('/api/erp/recebimentos/:id/aprovar', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  try { const r = emTransacao(() => aprovarRecebimentoErp(+req.params.id, (req.usuario || {}).usuario)); res.json(r); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});
app.post('/api/erp/recebimentos/:id/recusar', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const r = recusarRecebimentoErp(+req.params.id, (req.body || {}).motivo || '', (req.usuario || {}).usuario);
  r.erro ? res.status(400).json(r) : res.json(r);
});
app.post('/api/erp/recebimentos/:id/estornar', (req, res) => {
  if (!gateFinAdmin(req, res)) return; // estorno = ação sensível → admin
  try { const r = emTransacao(() => estornarRecebimentoErp(+req.params.id, (req.usuario || {}).usuario)); r.erro ? res.status(400).json(r) : res.json(r); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});
// Alterar quantidade pedida de um item da compra (divergência: "alterar pedido com autorização") — ADMIN.
app.post('/api/erp/compras/:id/ajustar-item', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const compra = db.prepare('SELECT * FROM erp_compras WHERE id=?').get(+req.params.id);
  if (!compra) return res.status(404).json({ erro: 'Compra não encontrada.' });
  if (compra.status === 'cancelada') return res.status(400).json({ erro: 'Compra cancelada.' });
  const d = req.body || {}, item = db.prepare('SELECT * FROM erp_compras_itens WHERE id=? AND compra_id=?').get(+d.item_id, compra.id);
  if (!item) return res.status(404).json({ erro: 'Item não encontrado.' });
  const novaQtd = Math.max(+item.qtd_recebida || 0, +d.quantidade || 0); // não pode ficar abaixo do já recebido
  try {
    const r = emTransacao(() => {
      db.prepare('UPDATE erp_compras_itens SET quantidade=?, valor_total=? WHERE id=?').run(r2(novaQtd), r2(novaQtd * (+item.valor_unitario || 0)), item.id);
      // recomputa totais da compra
      const itens = db.prepare('SELECT * FROM erp_compras_itens WHERE compra_id=?').all(compra.id);
      const subtotal = itens.reduce((s, it) => s + (+it.valor_total || 0), 0);
      const total = r2(subtotal + (+compra.frete || 0) + (+compra.outras_despesas || 0) - (+compra.desconto || 0));
      db.prepare('UPDATE erp_compras SET subtotal=?, total=?, atualizado_em=? WHERE id=?').run(r2(subtotal), total, new Date().toISOString(), compra.id);
      // financeiro: só ajusta a conta pelo TOTAL (base 'pedido') e apenas se ainda não paga além do novo valor.
      if (compra.financeiro_base !== 'recebido') {
        const conta = db.prepare('SELECT * FROM contas_pagar WHERE compra_id=? AND erp_recebimento_id IS NULL AND cancelada_em IS NULL').get(compra.id);
        if (conta) { const pago = valorPagoConta(conta.id); if (total + 0.0001 < pago) throw new Error('Novo total abaixo do já pago — ajuste os pagamentos primeiro.'); db.prepare('UPDATE contas_pagar SET valor_total=? WHERE id=?').run(total, conta.id); recomputarConta(conta.id); }
      }
      const st = recomputarStatusRecebimentoCompra(compra.id);
      manut.logAcao('item de compra ajustado (divergência)', 'compras', { compra_id: compra.id, item_id: item.id, de: item.quantidade, para: r2(novaQtd), motivo: d.motivo || '', por: (req.usuario || {}).usuario }, 'operacao');
      return { ok: true, total, status_recebimento: st, resumo: compraRecebimentoResumo(compra.id) };
    });
    res.json(r);
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

/* ══ FASE 45.1 — SÉRIES E SAZONALIDADE (gráficos gerenciais, dados reais da Fase 45) ══ */
// Série temporal por mês: preço/saca e sacas (mp_lotes), rendimento e custo/L (fechamentos).
app.get('/api/erp/inteligencia/series', (req, res) => {
  if (!gateBI(req, res)) return;
  const fx = faixaPeriodo(req.query), q = req.query;
  const wl = [], al = [];
  wl.push("l.status<>'cancelado'");
  if (q.fornecedor_id) { wl.push('l.fornecedor_id=?'); al.push(+q.fornecedor_id); }
  if (q.materia) { wl.push('l.materia_codigo=?'); al.push(q.materia); }
  if (fx.de) { wl.push("date(l.data_recebimento)>=?"); al.push(fx.de); }
  if (fx.ate) { wl.push("date(l.data_recebimento)<=?"); al.push(fx.ate); }
  const compras = db.prepare(`SELECT strftime('%Y-%m', l.data_recebimento) mes, SUM(l.qtd) sacas, SUM(l.custo_total) valor, AVG(l.custo_saca) preco_saca FROM mp_lotes l WHERE ${wl.join(' AND ')} GROUP BY mes ORDER BY mes`).all(...al);
  // rendimento/custo por litro por mês (fechamentos confirmados, opcional por fornecedor)
  const wf = ["of.status='confirmado'"], af = [];
  if (q.fornecedor_id) { wf.push('mc.fornecedor_id=?'); af.push(+q.fornecedor_id); }
  if (fx.de) { wf.push('date(of.data)>=?'); af.push(fx.de); }
  if (fx.ate) { wf.push('date(of.data)<=?'); af.push(fx.ate); }
  const fech = db.prepare(`SELECT strftime('%Y-%m', of.data) mes,
       SUM(mc.sacas) sacas, SUM(mc.custo_atribuido) custo,
       SUM(CASE WHEN of.sacas_usadas>0 THEN ${LITROS_FECH}*mc.sacas/of.sacas_usadas ELSE 0 END) litros
     FROM mp_fechamento_consumo mc JOIN operacao_fechamentos of ON of.id=mc.fechamento_id WHERE ${wf.join(' AND ')} GROUP BY mes ORDER BY mes`).all(...af);
  const compra = compras.map(r => ({ mes: r.mes, sacas: r2(r.sacas), valor: r2(r.valor), preco_saca: r2(r.preco_saca) }));
  const producao = fech.map(r => ({ mes: r.mes, litros: r2(r.litros), rendimento: r.sacas > 0 ? r2(r.litros / r.sacas) : null, custo_litro: r.litros > 0 ? r2(r.custo / r.litros) : null }));
  res.json({ periodo: fx, compra, producao });
});
// Sazonalidade: consolida por MÊS-do-ano (1..12) e, quando informada, por safra.
app.get('/api/erp/inteligencia/sazonalidade', (req, res) => {
  if (!gateBI(req, res)) return;
  const porMes = db.prepare(`SELECT CAST(strftime('%m', l.data_recebimento) AS INTEGER) m, SUM(l.qtd) sacas, SUM(l.custo_total) valor, AVG(l.custo_saca) preco_saca FROM mp_lotes l WHERE l.status<>'cancelado' AND l.data_recebimento IS NOT NULL GROUP BY m`).all();
  const rendMes = db.prepare(`SELECT CAST(strftime('%m', of.data) AS INTEGER) m, SUM(mc.sacas) sacas, SUM(mc.custo_atribuido) custo, SUM(CASE WHEN of.sacas_usadas>0 THEN ${LITROS_FECH}*mc.sacas/of.sacas_usadas ELSE 0 END) litros FROM mp_fechamento_consumo mc JOIN operacao_fechamentos of ON of.id=mc.fechamento_id WHERE of.status='confirmado' GROUP BY m`).all();
  const rmap = Object.fromEntries(rendMes.map(r => [r.m, r]));
  const nomes = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const linhas = [];
  for (let m = 1; m <= 12; m++) {
    const c = porMes.find(x => x.m === m), rf = rmap[m];
    if (!c && !rf) continue;
    const litros = rf ? r2(rf.litros) : 0, sacasCons = rf ? r2(rf.sacas) : 0;
    linhas.push({ mes: m, nome: nomes[m], sacas: c ? r2(c.sacas) : 0, preco_saca: c ? r2(c.preco_saca) : null, rendimento: sacasCons > 0 ? r2(litros / sacasCons) : null, custo_litro: litros > 0 ? r2(rf.custo / litros) : null });
  }
  const comCusto = linhas.filter(l => l.custo_litro != null);
  const melhor = comCusto.length ? comCusto.reduce((a, b) => a.custo_litro <= b.custo_litro ? a : b) : null;
  const pior = comCusto.length ? comCusto.reduce((a, b) => a.custo_litro >= b.custo_litro ? a : b) : null;
  // safras informadas (campo livre nos lotes)
  const safras = db.prepare("SELECT safra, SUM(qtd) sacas, AVG(custo_saca) preco_saca FROM mp_lotes WHERE status<>'cancelado' AND safra IS NOT NULL AND safra<>'' GROUP BY safra ORDER BY safra").all().map(s => ({ safra: s.safra, sacas: r2(s.sacas), preco_saca: r2(s.preco_saca) }));
  res.json({ linhas, melhorPeriodo: melhor ? { nome: melhor.nome, custo_litro: melhor.custo_litro } : null, piorPeriodo: pior ? { nome: pior.nome, custo_litro: pior.custo_litro } : null, safras });
});
// FICHA gerencial completa do fornecedor (seção 7) — uma chamada com tudo + links.
app.get('/api/erp/fornecedores/:id/ficha', (req, res) => {
  if (!gateBI(req, res)) return;
  const fid = +req.params.id, f = db.prepare('SELECT * FROM fornecedores WHERE id=?').get(fid);
  if (!f) return res.status(404).json({ erro: 'Fornecedor não encontrado.' });
  const analise = fornecedorAnaliseMP(fid), metricas = fornecedorMetricas(fid);
  const compras = db.prepare("SELECT id, numero_nf, data_emissao, total, status, status_recebimento FROM erp_compras WHERE fornecedor_id=? ORDER BY id DESC LIMIT 50").all(fid);
  const recebimentos = db.prepare('SELECT r.id, r.data, r.status, r.compra_id FROM erp_recebimentos r WHERE r.fornecedor_id=? ORDER BY r.id DESC LIMIT 50').all(fid);
  const lotes = db.prepare("SELECT id, lote_interno, materia_codigo, qtd, saldo, custo_saca, data_recebimento, status FROM mp_lotes WHERE fornecedor_id=? ORDER BY id DESC LIMIT 100").all(fid);
  const hoje = ymdLocal(new Date());
  const contasVencidas = db.prepare('SELECT id, descricao, valor_total, data_vencimento FROM contas_pagar WHERE fornecedor_id=? AND cancelada_em IS NULL AND data_vencimento<?').all(fid, hoje)
    .map(c => ({ ...c, restante: r2((c.valor_total || 0) - valorPagoConta(c.id)) })).filter(c => c.restante > 0.01);
  const avaliacoes = db.prepare('SELECT * FROM fornecedor_avaliacoes WHERE fornecedor_id=? ORDER BY id DESC LIMIT 50').all(fid)
    .map(a => ({ ...a, criterios: a.criterios ? (() => { try { return JSON.parse(a.criterios); } catch { return null; } })() : null }));
  const notaMedia = avaliacoes.length ? r2(avaliacoes.reduce((s, a) => s + (+a.nota || 0), 0) / avaliacoes.length) : null;
  const alertas = comprasIntelAlertas().filter(a => a.fornecedor === f.nome);
  res.json({ fornecedor: f, analise, metricas, saldoAberto: metricas.saldoAberto, compras, recebimentos, lotes, contasVencidas, avaliacoes, notaMedia, alertas });
});

/* ══════════════════════════════════════════════════════════════════════════
   FECHAMENTO DE CAIXA · CONCILIAÇÃO · AUTOMAÇÃO (Fase 27). Uma SESSÃO de caixa
   (turno do operador) é uma VISÃO sobre os financeiro_movimentos do período —
   cada movimento é carimbado com a sessão aberta no momento (caixa_sessao_id),
   então PDV/Delivery/Fiado/Compras entram no fechamento SOZINHOS e SEM duplicar.
   Suprimento/Sangria são movimentos financeiros normais (categoria própria).
   Ver 42_*.md. ═══════════════════════════════════════════════════════════════ */
db.exec(`CREATE TABLE IF NOT EXISTS caixa_sessoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, operador TEXT, operador_nome TEXT, conta_id INTEGER,
  aberto_em TEXT, fechado_em TEXT, valor_inicial REAL DEFAULT 0, status TEXT DEFAULT 'aberto',
  obs_abertura TEXT, obs_fechamento TEXT, valores_esperados TEXT, valores_informados TEXT,
  diferenca REAL, saldo_final REAL, fechado_por TEXT, criado_em TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_caixa_status ON caixa_sessoes(status)');
db.exec('CREATE INDEX IF NOT EXISTS idx_caixa_operador ON caixa_sessoes(operador)');
db.exec(`CREATE TABLE IF NOT EXISTS fila_impressao (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT, referencia_id TEXT, titulo TEXT, conteudo TEXT,
  status TEXT DEFAULT 'pendente', tentativas INTEGER DEFAULT 0, criado_em TEXT, impresso_em TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_fila_status ON fila_impressao(status)');
try { db.exec('ALTER TABLE financeiro_movimentos ADD COLUMN caixa_sessao_id INTEGER'); } catch {}
db.exec('CREATE INDEX IF NOT EXISTS idx_fin_mov_sessao ON financeiro_movimentos(caixa_sessao_id)');
// categorias novas usadas pelo caixa (idempotente)
(function seedCaixaCategorias() {
  for (const [nome, tipo] of [['Suprimento', 'entrada'], ['Sangria', 'saida']])
    if (!db.prepare('SELECT id FROM financeiro_categorias WHERE nome=?').get(nome))
      db.prepare('INSERT INTO financeiro_categorias (nome,tipo,sistema,ativo,criado_em) VALUES (?,?,1,1,?)').run(nome, tipo, new Date().toISOString());
})();

function sessaoAbertaUnica() { const a = db.prepare("SELECT id FROM caixa_sessoes WHERE status='aberto'").all(); return a.length === 1 ? a[0].id : null; }
function sessaoAbertaDoOperador(usuario) { return db.prepare("SELECT * FROM caixa_sessoes WHERE status='aberto' AND operador=?").get(usuario || '') || null; }
// Conferência: esperado por conta (valor_inicial na conta da sessão + entradas − saídas confirmadas carimbadas nesta sessão)
function conferenciaSessao(sessao) {
  const movs = db.prepare(`SELECT m.conta_id, c.nome conta_nome, c.tipo conta_tipo, m.tipo, m.valor, cat.nome categoria_nome
    FROM financeiro_movimentos m LEFT JOIN financeiro_contas c ON c.id=m.conta_id LEFT JOIN financeiro_categorias cat ON cat.id=m.categoria_id
    WHERE m.caixa_sessao_id=? AND m.situacao='confirmado'`).all(sessao.id);
  const porConta = {};
  for (const m of movs) { const k = m.conta_id || 0; (porConta[k] || (porConta[k] = { conta_id: m.conta_id, conta: m.conta_nome || 'Sem conta', tipo: m.conta_tipo, entradas: 0, saidas: 0 })); if (m.tipo === 'entrada') porConta[k].entradas += m.valor; else porConta[k].saidas += m.valor; }
  const linhas = db.prepare('SELECT id,nome,tipo FROM financeiro_contas ORDER BY nome').all().map(c => {
    const p = porConta[c.id] || { entradas: 0, saidas: 0 };
    const inicial = c.id === sessao.conta_id ? (sessao.valor_inicial || 0) : 0;
    return { conta_id: c.id, conta: c.nome, tipo: c.tipo, inicial, entradas: Math.round(p.entradas * 100) / 100, saidas: Math.round(p.saidas * 100) / 100, esperado: Math.round((inicial + p.entradas - p.saidas) * 100) / 100 };
  }).filter(l => l.inicial || l.entradas || l.saidas);
  const soma = (f) => Math.round(movs.filter(f).reduce((s, m) => s + m.valor, 0) * 100) / 100;
  const totalEntradas = soma(m => m.tipo === 'entrada'), totalSaidas = soma(m => m.tipo === 'saida');
  return { linhas, fiadoRecebido: soma(m => m.categoria_nome === 'Recebimento Fiado' && m.tipo === 'entrada'),
    totalEntradas, totalSaidas, totalEsperado: Math.round(linhas.reduce((s, l) => s + l.esperado, 0) * 100) / 100,
    resultadoDia: Math.round((totalEntradas - totalSaidas) * 100) / 100 };
}
function sessaoParaFront(s) {
  const conf = conferenciaSessao(s);
  return { ...s, valores_esperados: s.valores_esperados ? JSON.parse(s.valores_esperados) : null, valores_informados: s.valores_informados ? JSON.parse(s.valores_informados) : null, conferencia: conf };
}
// gate: admin/supervisor mexem em qualquer caixa; operador só no dele
function gateCaixa(req, res, sessao) {
  const u = req.usuario || {};
  if (u.perfil === 'admin' || u.perfil === 'supervisor') return true;
  if (sessao && sessao.operador === u.usuario) return true;
  res.status(403).json({ erro: 'Você só pode operar o seu próprio caixa.' }); return false;
}

// ── Fila de impressão (estrutura pra automação futura — NÃO imprime ainda) ──
function enfileirarImpressao(tipo, referenciaId, titulo, conteudo, opts) {
  try {
    const o = opts || {};
    // Fase 40: cada documento cai numa ESTAÇÃO (balcão/produção/expedição) — roteamento automático.
    const estacao = o.estacao || (typeof estacaoDoDoc === 'function' ? estacaoDoDoc(tipo, o.via) : 'balcao');
    db.prepare('INSERT INTO fila_impressao (tipo,referencia_id,titulo,conteudo,status,estacao,via,copias,criado_em) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(tipo, referenciaId != null ? String(referenciaId) : null, titulo || '', conteudo ? JSON.stringify(conteudo) : null, 'pendente', estacao, o.via || null, o.copias || null, new Date().toISOString());
  } catch (e) { try { manut.logErro('fila-impressao', e); } catch {} }
}

// ── Endpoints do CAIXA ──
app.get('/api/caixa/atual', (req, res) => {
  const s = sessaoAbertaDoOperador((req.usuario || {}).usuario);
  res.json(s ? sessaoParaFront(s) : { aberto: false });
});
app.get('/api/caixa/sessoes', (req, res) => {
  const q = req.query, cond = ['1=1'], args = [];
  const u = req.usuario || {};
  if (!(u.perfil === 'admin' || u.perfil === 'supervisor')) { cond.push('operador=?'); args.push(u.usuario); } // operador só as dele
  else if (q.operador) { cond.push('operador=?'); args.push(q.operador); }
  if (q.status) { cond.push('status=?'); args.push(q.status); }
  if (q.de) { cond.push("date(aberto_em,'localtime')>=?"); args.push(String(q.de).slice(0, 10)); }
  if (q.ate) { cond.push("date(aberto_em,'localtime')<=?"); args.push(String(q.ate).slice(0, 10)); }
  res.json(db.prepare(`SELECT * FROM caixa_sessoes WHERE ${cond.join(' AND ')} ORDER BY id DESC LIMIT 200`).all(...args).map(sessaoParaFront));
});
app.get('/api/caixa/sessoes/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM caixa_sessoes WHERE id=?').get(+req.params.id);
  if (!s) return res.status(404).json({ erro: 'Sessão não encontrada.' });
  res.json(sessaoParaFront(s));
});
app.post('/api/caixa/abrir', (req, res) => {
  const u = req.usuario || {}, d = req.body || {};
  if (sessaoAbertaDoOperador(u.usuario)) return res.status(400).json({ erro: 'Você já tem um caixa aberto. Feche antes de abrir outro.' });
  const conta = +d.conta_id || (db.prepare("SELECT id FROM financeiro_contas WHERE nome='Caixa'").get() || {}).id || null;
  const agora = new Date().toISOString();
  const info = db.prepare('INSERT INTO caixa_sessoes (operador,operador_nome,conta_id,aberto_em,valor_inicial,status,obs_abertura,criado_em) VALUES (?,?,?,?,?,?,?,?)')
    .run(u.usuario || '', u.nome || u.usuario || '', conta, agora, +d.valor_inicial || 0, 'aberto', d.obs || '', agora);
  manut.logAcao('abertura de caixa', 'caixa', { sessao: info.lastInsertRowid, operador: u.usuario, valor_inicial: +d.valor_inicial || 0 }, 'operacao');
  res.json(sessaoParaFront(db.prepare('SELECT * FROM caixa_sessoes WHERE id=?').get(info.lastInsertRowid)));
});
function lancarCaixaMov(req, res, tipo) {
  const id = +req.params.id, s = db.prepare('SELECT * FROM caixa_sessoes WHERE id=?').get(id);
  if (!s) return res.status(404).json({ erro: 'Sessão não encontrada.' });
  if (s.status !== 'aberto') return res.status(400).json({ erro: 'Caixa já fechado.' });
  if (!gateCaixa(req, res, s)) return;
  const d = req.body || {}, valor = Math.round((+d.valor || 0) * 100) / 100;
  if (valor <= 0) return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });
  const ehSup = tipo === 'suprimento';
  const movId = inserirMovimento({ tipo: ehSup ? 'entrada' : 'saida', conta_id: s.conta_id, categoria_id: catFinId(ehSup ? 'Suprimento' : 'Sangria'),
    valor, descricao: (ehSup ? 'Suprimento' : 'Sangria') + (d.motivo ? ' · ' + d.motivo : ''), origem: 'caixa', obs: d.obs || '',
    responsavel: d.responsavel || (req.usuario || {}).nome || '', situacao: 'confirmado', referencia_tipo: 'caixa_' + tipo, referencia_id: id, caixa_sessao_id: id, criado_por: (req.usuario || {}).usuario || '' });
  manut.logAcao(tipo + ' de caixa', 'caixa', { sessao: id, valor, motivo: d.motivo || '', por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true, movimento_id: movId, conferencia: conferenciaSessao(s) });
}
app.post('/api/caixa/:id/suprimento', (req, res) => lancarCaixaMov(req, res, 'suprimento'));
app.post('/api/caixa/:id/sangria', (req, res) => lancarCaixaMov(req, res, 'sangria'));
// Sangria/Suprimento AVULSOS — não exigem caixa aberto (justificativa obrigatória). Entram no
// razão como movimento de dinheiro (referencia_tipo caixa_*), então a conferência do dia soma
// automático. caixa_sessao_id=0 → não vira "não conciliado" nem depende de sessão.
function lancarCaixaMovAvulso(req, res, tipo) {
  const d = req.body || {}, valor = r2(+d.valor || 0);
  if (valor <= 0) return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });
  if (!(d.motivo || '').trim()) return res.status(400).json({ erro: 'A justificativa é obrigatória.' });
  const ehSup = tipo === 'suprimento';
  const contaCaixa = (db.prepare("SELECT id FROM financeiro_contas WHERE nome='Caixa'").get() || {}).id || null;
  const movId = inserirMovimento({ tipo: ehSup ? 'entrada' : 'saida', conta_id: contaCaixa, categoria_id: catFinId(ehSup ? 'Suprimento' : 'Sangria'),
    valor, descricao: (ehSup ? 'Suprimento' : 'Sangria') + ' · ' + d.motivo.trim(), origem: 'caixa', situacao: 'confirmado',
    referencia_tipo: 'caixa_' + tipo, caixa_sessao_id: 0, responsavel: (req.usuario || {}).nome || '', criado_por: (req.usuario || {}).usuario || '' });
  manut.logAcao(tipo + ' de caixa (avulso)', 'caixa', { valor, motivo: d.motivo.trim(), por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true, movimento_id: movId });
}
app.post('/api/caixa/suprimento', (req, res) => lancarCaixaMovAvulso(req, res, 'suprimento'));
app.post('/api/caixa/sangria', (req, res) => lancarCaixaMovAvulso(req, res, 'sangria'));
app.post('/api/caixa/:id/fechar', (req, res) => {
  const id = +req.params.id, s = db.prepare('SELECT * FROM caixa_sessoes WHERE id=?').get(id);
  if (!s) return res.status(404).json({ erro: 'Sessão não encontrada.' });
  if (s.status !== 'aberto') return res.status(400).json({ erro: 'Caixa já está fechado.' });
  if (!gateCaixa(req, res, s)) return;
  const d = req.body || {}, conf = conferenciaSessao(s);
  const informados = d.valores_informados || {}; // { conta_id: valor_contado }
  const detalhe = conf.linhas.map(l => { const inf = informados[l.conta_id] != null ? +informados[l.conta_id] : null; return { ...l, informado: inf, diferenca: inf != null ? Math.round((inf - l.esperado) * 100) / 100 : null }; });
  const totalInformado = Math.round(detalhe.reduce((s2, l) => s2 + (l.informado || 0), 0) * 100) / 100;
  const diferenca = Math.round((totalInformado - conf.totalEsperado) * 100) / 100;
  const agora = new Date().toISOString();
  db.prepare("UPDATE caixa_sessoes SET status='fechado', fechado_em=?, valores_esperados=?, valores_informados=?, diferenca=?, saldo_final=?, obs_fechamento=?, fechado_por=? WHERE id=?")
    .run(agora, JSON.stringify(conf), JSON.stringify(detalhe), diferenca, conf.totalEsperado, d.obs || '', (req.usuario || {}).usuario || '', id);
  const limite = +getConfig('caixa_limite_diferenca', '5');
  manut.logAcao('fechamento de caixa', 'caixa', { sessao: id, esperado: conf.totalEsperado, informado: totalInformado, diferenca, operador: s.operador, por: (req.usuario || {}).usuario }, Math.abs(diferenca) > limite ? 'seguranca' : 'operacao');
  res.json({ ok: true, esperado: conf.totalEsperado, informado: totalInformado, diferenca, sobra: diferenca > 0 ? diferenca : 0, falta: diferenca < 0 ? -diferenca : 0, detalhe, resultadoDia: conf.resultadoDia });
});
// Conciliação: sessões fechadas com esperado × conferido × diferença (filtros)
app.get('/api/caixa/conciliacao', (req, res) => {
  const q = req.query, cond = ["status='fechado'"], args = [];
  const u = req.usuario || {};
  if (!(u.perfil === 'admin' || u.perfil === 'supervisor')) { cond.push('operador=?'); args.push(u.usuario); }
  else if (q.operador) { cond.push('operador=?'); args.push(q.operador); }
  if (q.de) { cond.push("date(aberto_em,'localtime')>=?"); args.push(String(q.de).slice(0, 10)); }
  if (q.ate) { cond.push("date(aberto_em,'localtime')<=?"); args.push(String(q.ate).slice(0, 10)); }
  const sessoes = db.prepare(`SELECT * FROM caixa_sessoes WHERE ${cond.join(' AND ')} ORDER BY id DESC LIMIT 200`).all(...args);
  const limite = +getConfig('caixa_limite_diferenca', '5');
  let linhas = sessoes.map(s => {
    const inf = s.valores_informados ? JSON.parse(s.valores_informados) : [];
    const contaFiltro = q.conta_id ? inf.filter(l => String(l.conta_id) === String(q.conta_id)) : inf;
    return { sessao_id: s.id, operador: s.operador_nome || s.operador, aberto_em: s.aberto_em, fechado_em: s.fechado_em,
      esperado: s.saldo_final, diferenca: s.diferenca, situacao: Math.abs(s.diferenca || 0) <= limite ? 'ok' : (s.diferenca > 0 ? 'sobra' : 'falta'), contas: contaFiltro };
  });
  if (q.conta_id) linhas = linhas.filter(l => l.contas.length);
  res.json({ linhas, limite, totalDiferenca: Math.round(linhas.reduce((s, l) => s + (l.diferenca || 0), 0) * 100) / 100 });
});
// Alertas do caixa
app.get('/api/caixa/alertas', (req, res) => {
  const limite = +getConfig('caixa_limite_diferenca', '5'), horas = +getConfig('caixa_horas_alerta', '12');
  const abertas = db.prepare("SELECT * FROM caixa_sessoes WHERE status='aberto'").all();
  const agora = Date.now();
  const caixaAbertoMuito = abertas.filter(s => (agora - new Date(s.aberto_em).getTime()) > horas * 3600e3).map(s => ({ sessao: s.id, operador: s.operador_nome || s.operador, aberto_em: s.aberto_em, horas: Math.round((agora - new Date(s.aberto_em).getTime()) / 3600e3) }));
  const diferencaAlta = db.prepare("SELECT id,operador_nome,operador,diferenca FROM caixa_sessoes WHERE status='fechado' AND ABS(COALESCE(diferenca,0))>? ORDER BY id DESC LIMIT 20").all(limite).map(s => ({ sessao: s.id, operador: s.operador_nome || s.operador, diferenca: s.diferenca }));
  const semCategoria = db.prepare("SELECT COUNT(*) n FROM financeiro_movimentos WHERE categoria_id IS NULL AND situacao='confirmado'").get().n;
  const naoConciliados = db.prepare("SELECT COUNT(*) n FROM financeiro_movimentos WHERE caixa_sessao_id IS NULL AND situacao='confirmado' AND origem IN ('pdv','delivery','fiado','caixa')").get().n;
  res.json({ caixaAbertoMuito, diferencaAlta, semCategoria, recebimentosNaoConciliados: naoConciliados,
    totalAlertas: caixaAbertoMuito.length + diferencaAlta.length + (semCategoria > 0 ? 1 : 0) + (naoConciliados > 0 ? 1 : 0) });
});

// ── Fila de impressão (leitura + marcar; automação futura) ──
app.get('/api/impressao/fila', (req, res) => {
  const cond = [], args = [];
  if (req.query.status) { cond.push('status=?'); args.push(req.query.status); }
  if (req.query.estacao) { cond.push('estacao=?'); args.push(req.query.estacao); } // Fase 40: filtro por estação
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  res.json(db.prepare(`SELECT * FROM fila_impressao ${where} ORDER BY id DESC LIMIT 200`).all(...args));
});
app.post('/api/impressao/:id/status', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const id = +req.params.id, novo = ['pendente', 'impresso', 'ignorado', 'erro'].includes((req.body || {}).status) ? req.body.status : 'impresso';
  db.prepare('UPDATE fila_impressao SET status=?, impresso_em=?, tentativas=tentativas+1 WHERE id=?').run(novo, novo === 'impresso' ? new Date().toISOString() : null, id);
  res.json({ ok: true });
});

/* ══════════════════════════════════════════════════════════════════════════
   CENTRAL DE PRODUÇÃO · MOTOR DE IMPRESSÃO · AUTOMAÇÃO (Fase 28). Usa a
   fila_impressao (Fase 27) e o ciclo de vida do pedido (Fase 22). O board é uma
   VISÃO dos pedidos por status. A COMANDA é montada aqui; o navegador imprime
   (caminho real, sem driver nativo). REIMPRESSÃO só imprime — nunca registra
   venda/estoque/financeiro. Ver 43_*.md. ══════════════════════════════════════ */
function comandaDoPedido(pedidoId, via) {
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!p) return null;
  const loja = { nome: getConfig('loja_nome', 'Açaí do Centro'), telefone: getConfig('loja_telefone', ''), endereco: getConfig('loja_endereco', ''), bairro: getConfig('loja_bairro', '') };
  const temEndereco = !!(p.endereco && p.endereco.trim());
  return {
    via: ['producao', 'entrega', 'cliente', 'canhoto'].includes(via) ? via : 'producao',
    loja, id: p.id, numero: p.numero, data: p.criado, status: p.status,
    cliente: p.cliente || '', telefone: p.telefone || '', endereco: p.endereco || '', complemento: p.complemento || '', bairro: p.bairro || '',
    itens: p.itens || '', obs: p.rota_obs || '', pagamento: p.pagamento || '', troco: +p.troco || 0, valor: +p.valor || 0, taxa: +p.taxa || 0, total: +p.total || 0,
    tipo: temEndereco ? 'entrega' : 'retirada', entregador: p.entregador_id ? nomeEntregador(p.entregador_id) : null,
    qr: `acaipedido:${p.id}:${p.numero}`, // payload do QR (uso futuro; não há leitura ainda)
    largura: +getConfig('impressao_largura', '80'), copias: +getConfig('impressao_copias', '1'),
  };
}

// ── Central de Produção — board por status (pedidos de hoje + os ainda abertos) ──
app.get('/api/producao/pedidos', (req, res) => {
  const pedidos = db.prepare(`SELECT * FROM pedidos
    WHERE date(criado,'localtime')=date('now','localtime') OR status IN ('pendente','preparo','pronto','rota')
    ORDER BY criado DESC LIMIT 300`).all();
  const agora = Date.now();
  const enrich = (p) => ({
    id: p.id, numero: p.numero, criado: p.criado, status: p.status, cliente: p.cliente, telefone: p.telefone,
    endereco: p.endereco, complemento: p.complemento, bairro: p.bairro, itens: p.itens, obs: p.rota_obs || '',
    pagamento: p.pagamento, troco: p.troco, total: p.total, origem: p.origem, entregador_id: p.entregador_id, entregador: p.entregador_id ? nomeEntregador(p.entregador_id) : null,
    tipo: (p.endereco && p.endereco.trim()) ? 'entrega' : 'retirada', min_espera: Math.max(0, Math.round((agora - new Date(p.criado).getTime()) / 60000)),
  });
  const g = { aguardando: [], producao: [], pronto: [], rota: [], entregue: [], cancelado: [] };
  const mapa = { pendente: 'aguardando', preparo: 'producao', pronto: 'pronto', rota: 'rota', entregue: 'entregue', cancelado: 'cancelado' };
  for (const p of pedidos) { const k = mapa[p.status]; if (k) g[k].push(enrich(p)); }
  res.json(g);
});
function mudarStatusProducao(req, res, novo, acao) {
  const id = +req.params.id, p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  db.prepare('UPDATE pedidos SET status = ? WHERE id = ?').run(novo, id);
  manut.logAcao(acao, 'producao', { pedido: p.numero, id, status: novo, por: (req.usuario || {}).usuario }, 'operacao');
  realtime.emitir('pedido_status_alterado', { id, status: novo, telefone: p.telefone });
  syncFin(sincronizarFinanceiroPedido, id); // mantém o financeiro/caixa em dia (idempotente)
  res.json(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id));
}
app.post('/api/producao/pedidos/:id/iniciar', (req, res) => mudarStatusProducao(req, res, 'preparo', 'início de produção'));
app.post('/api/producao/pedidos/:id/pronto', (req, res) => mudarStatusProducao(req, res, 'pronto', 'fim de produção'));
app.post('/api/producao/pedidos/:id/cancelar', (req, res) => {
  const id = +req.params.id, p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  db.prepare('UPDATE pedidos SET status = ? WHERE id = ?').run('cancelado', id);
  manut.logAcao('pedido cancelado na produção', 'producao', { pedido: p.numero, id, por: (req.usuario || {}).usuario }, 'operacao');
  realtime.emitir('pedido_status_alterado', { id, status: 'cancelado', telefone: p.telefone });
  syncFin(sincronizarFinanceiroPedido, id); // estorna a entrada de delivery
  res.json({ ok: true });
});

// ── Motor de impressão ──
app.get('/api/impressao/comanda/:pedidoId', (req, res) => {
  const c = comandaDoPedido(+req.params.pedidoId, req.query.via);
  c ? res.json(c) : res.status(404).json({ erro: 'Pedido não encontrado.' });
});
// marca um item da fila como impresso/erro (o navegador chama após mandar imprimir).
// AUTOMAÇÃO: ao imprimir um pedido que estava 'pendente', ele passa pra 'preparo' (Em produção).
app.post('/api/impressao/:id/imprimir', (req, res) => {
  const id = +req.params.id, ok = (req.body || {}).ok !== false;
  const f = db.prepare('SELECT * FROM fila_impressao WHERE id = ?').get(id);
  if (!f) return res.status(404).json({ erro: 'Item de fila não encontrado.' });
  db.prepare('UPDATE fila_impressao SET status = ?, impresso_em = ?, tentativas = tentativas + 1 WHERE id = ?').run(ok ? 'impresso' : 'erro', ok ? new Date().toISOString() : null, id);
  manut.logAcao(ok ? 'impressão' : 'falha de impressão', 'impressao', { fila: id, tipo: f.tipo, ref: f.referencia_id, por: (req.usuario || {}).usuario }, ok ? 'operacao' : 'seguranca');
  if (ok && f.tipo === 'pedido' && f.referencia_id) {
    const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(f.referencia_id);
    if (p && p.status === 'pendente') {
      db.prepare("UPDATE pedidos SET status = 'preparo' WHERE id = ?").run(p.id);
      manut.logAcao('início de produção', 'producao', { pedido: p.numero, id: p.id, via: 'impressao_auto' }, 'operacao');
      realtime.emitir('pedido_status_alterado', { id: p.id, status: 'preparo', telefone: p.telefone });
    }
  }
  res.json({ ok: true });
});
// REIMPRESSÃO — cria uma nova entrada de fila (marcada) e devolve a comanda.
// NUNCA registra venda, NUNCA baixa estoque, NUNCA gera movimentação financeira. Só imprime.
app.post('/api/impressao/reimprimir/:pedidoId', (req, res) => {
  const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(+req.params.pedidoId);
  if (!p) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  const info = db.prepare('INSERT INTO fila_impressao (tipo,referencia_id,titulo,conteudo,status,criado_em) VALUES (?,?,?,?,?,?)')
    .run('reimpressao', String(p.id), `Reimpressão #${p.numero}`, JSON.stringify({ numero: p.numero, reimpressao: true }), 'reimpresso', new Date().toISOString());
  manut.logAcao('reimpressão', 'impressao', { pedido: p.numero, id: p.id, fila: info.lastInsertRowid, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true, fila_id: info.lastInsertRowid, comanda: comandaDoPedido(p.id, req.query.via) });
});
// Configuração de impressão
app.get('/api/impressao/config', (req, res) => res.json({
  auto: getConfig('impressao_auto', '0') === '1', copias: +getConfig('impressao_copias', '1'), largura: +getConfig('impressao_largura', '80'),
  som: getConfig('impressao_som', '1') === '1', principal: getConfig('impressora_principal', ''), secundaria: getConfig('impressora_secundaria', ''), conexao: getConfig('impressao_conexao', 'usb'),
  modelos: { producao: getConfig('modelo_producao', '1') === '1', entrega: getConfig('modelo_entrega', '1') === '1', cliente: getConfig('modelo_cliente', '0') === '1' },
}));
app.post('/api/impressao/config', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {};
  const setBool = (k, v) => setConfig(k, v ? '1' : '0');
  if (d.auto !== undefined) setBool('impressao_auto', d.auto);
  if (d.copias !== undefined) setConfig('impressao_copias', String(Math.max(1, +d.copias || 1)));
  if (d.largura !== undefined) setConfig('impressao_largura', String([58, 80].includes(+d.largura) ? +d.largura : 80));
  if (d.som !== undefined) setBool('impressao_som', d.som);
  if (d.principal !== undefined) setConfig('impressora_principal', String(d.principal || ''));
  if (d.secundaria !== undefined) setConfig('impressora_secundaria', String(d.secundaria || ''));
  if (d.conexao !== undefined) setConfig('impressao_conexao', ['usb', 'rede'].includes(d.conexao) ? d.conexao : 'usb');
  if (d.modelos) { if (d.modelos.producao !== undefined) setBool('modelo_producao', d.modelos.producao); if (d.modelos.entrega !== undefined) setBool('modelo_entrega', d.modelos.entrega); if (d.modelos.cliente !== undefined) setBool('modelo_cliente', d.modelos.cliente); }
  manut.logAcao('config de impressão alterada', 'impressao', { por: (req.usuario || {}).usuario }, 'config');
  res.json({ ok: true });
});

/* ══════════════════════════════════════════════════════════════════════════
   FASE 40 — OPERAÇÃO INTELIGENTE: roteamento por ESTAÇÃO + CANHOTO + Central
   de Impressão. Reusa a fila (F27), o motor de comanda (F28) e a expedição/
   entregadores (F22/23) — SEM reconstruir. Cada documento é roteado pra uma
   estação (balcão/produção/expedição); o canhoto é um comprovante compacto.
   A impressão física continua pelo navegador (caminho real de hoje). ═══════ */
migrar('fase40_impressao_estacao', () => {
  for (const col of ['estacao TEXT', 'via TEXT', 'copias INTEGER']) { try { db.exec(`ALTER TABLE fila_impressao ADD COLUMN ${col}`); } catch {} }
  db.exec('CREATE INDEX IF NOT EXISTS idx_fila_estacao ON fila_impressao(estacao)');
});
// Itens antigos sem estação → balcão (padrão), pra contagem e filtro baterem.
migrar('fase40_backfill_estacao', () => { try { db.exec("UPDATE fila_impressao SET estacao='balcao' WHERE estacao IS NULL"); } catch {} });
const ESTACOES = [
  { chave: 'balcao', nome: 'Balcão / Cupom', icone: '🧾' },
  { chave: 'producao', nome: 'Produção / Cozinha', icone: '🏭' },
  { chave: 'expedicao', nome: 'Expedição / Entrega', icone: '🛵' },
];
// Roteamento automático de cada documento pra sua estação (parametrizável por via)
function estacaoDoDoc(tipo, via) {
  if (tipo === 'pedido') { if (via === 'entrega') return 'expedicao'; if (via === 'cliente' || via === 'canhoto') return 'balcao'; return 'producao'; }
  return 'balcao'; // venda, canhoto de venda, avulsos
}
// CANHOTO — comprovante compacto (comprovante de pagamento / recibo de entrega). Só monta; navegador imprime.
function canhotoDoc(tipo, id) {
  const loja = { nome: getConfig('loja_nome', 'Açaí do Centro'), telefone: getConfig('loja_telefone', '') };
  if (tipo === 'venda') {
    const v = db.prepare('SELECT * FROM vendas WHERE id=?').get(+id); if (!v) return null;
    const pgs = db.prepare('SELECT forma, valor FROM pagamentos WHERE venda_id=?').all(v.id);
    return { via: 'canhoto', tipo: 'venda', loja, numero: v.numero || String(v.id), data: v.criado_em || v.data,
      total: +v.total || 0, formas: pgs.map(p => ({ forma: p.forma, valor: +p.valor || 0 })), operador: v.operador || '',
      largura: +getConfig('impressao_largura', '80') };
  }
  if (tipo === 'pedido') {
    const c = comandaDoPedido(+id, 'canhoto'); if (!c) return null;
    return { via: 'canhoto', tipo: 'pedido', loja, numero: c.numero, data: c.data, cliente: c.cliente, endereco: c.endereco, bairro: c.bairro,
      total: c.total, pagamento: c.pagamento, troco: c.troco, entregador: c.entregador, largura: c.largura };
  }
  return null;
}
// Parametrização (reservada/desligada por padrão)
(function seedImpressaoF40() { if (getConfig('impressao_canhoto_auto', null) == null) setConfig('impressao_canhoto_auto', '0'); })();

// ── Endpoints Fase 40 ──
app.get('/api/impressao/estacoes', (req, res) => {
  const pend = db.prepare("SELECT estacao, COUNT(*) n FROM fila_impressao WHERE status='pendente' GROUP BY estacao").all();
  const mapa = Object.fromEntries(pend.map(x => [x.estacao || 'balcao', x.n]));
  res.json({ estacoes: ESTACOES.map(e => ({ ...e, pendentes: mapa[e.chave] || 0 })), canhoto_auto: getConfig('impressao_canhoto_auto', '0') === '1' });
});
app.get('/api/impressao/canhoto/:tipo/:id', (req, res) => {
  const c = canhotoDoc(req.params.tipo, req.params.id);
  c ? res.json(c) : res.status(404).json({ erro: 'Documento não encontrado.' });
});
app.post('/api/impressao/estacoes/config', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  if ((req.body || {}).canhoto_auto !== undefined) setConfig('impressao_canhoto_auto', req.body.canhoto_auto ? '1' : '0');
  res.json({ ok: true, canhoto_auto: getConfig('impressao_canhoto_auto', '0') === '1' });
});
// Enfileirar um canhoto manualmente (ex.: reimprimir comprovante) — não altera venda/estoque/financeiro
app.post('/api/impressao/canhoto/:tipo/:id/enfileirar', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const c = canhotoDoc(req.params.tipo, req.params.id);
  if (!c) return res.status(404).json({ erro: 'Documento não encontrado.' });
  enfileirarImpressao(req.params.tipo, req.params.id, `Canhoto ${c.numero}`, c, { via: 'canhoto', estacao: 'balcao' });
  res.json({ ok: true, canhoto: c });
});

/* ══════════════════════════════════════════════════════════════════════════
   GESTÃO FINANCEIRA AVANÇADA (Fase 29) — centro de custos, dashboard rico,
   livro-caixa (movimentações), alertas unificados, relatórios/export e config.
   Tudo LÊ o mesmo livro-caixa (financeiro_movimentos) + ERP (compras/contas a
   pagar) — nada é lançado duas vezes. Ver 44_*.md. ═══════════════════════════ */
const r2 = (v) => Math.round((+v || 0) * 100) / 100;
db.exec(`CREATE TABLE IF NOT EXISTS financeiro_centros_custo (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT, ativo INTEGER DEFAULT 1, sistema INTEGER DEFAULT 0, criado_em TEXT
)`);
try { db.exec('ALTER TABLE financeiro_movimentos ADD COLUMN centro_custo_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE contas_pagar ADD COLUMN centro_custo_id INTEGER'); } catch {}
db.exec('CREATE INDEX IF NOT EXISTS idx_fin_mov_cc ON financeiro_movimentos(centro_custo_id)');
(function seedCentrosCusto() {
  if (db.prepare('SELECT COUNT(*) n FROM financeiro_centros_custo').get().n) return;
  const ins = db.prepare('INSERT INTO financeiro_centros_custo (nome,tipo,ativo,sistema,criado_em) VALUES (?,?,1,?,?)'), agora = new Date().toISOString();
  [['Açaí', 'insumo', 1], ['Frutas', 'insumo', 1], ['Coberturas', 'insumo', 1], ['Embalagens', 'insumo', 1], ['Funcionários', 'fixo', 1],
   ['Energia', 'fixo', 1], ['Água', 'fixo', 1], ['Internet', 'fixo', 1], ['Marketing', 'variavel', 0], ['Impostos', 'fixo', 0], ['Outros', 'outro', 1]].forEach(c => ins.run(c[0], c[1], c[2], agora));
})();

// ── Centros de custo (CRUD — admin) ──
app.get('/api/financeiro/centros-custo', (req, res) => res.json(db.prepare('SELECT * FROM financeiro_centros_custo ORDER BY ativo DESC, nome').all()));
app.post('/api/financeiro/centros-custo', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const d = req.body || {}; if (!d.nome) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  const info = db.prepare('INSERT INTO financeiro_centros_custo (nome,tipo,ativo,sistema,criado_em) VALUES (?,?,1,0,?)').run(d.nome, d.tipo || 'outro', new Date().toISOString());
  manut.logAcao('centro de custo criado', 'financeiro', { id: info.lastInsertRowid, nome: d.nome, por: (req.usuario || {}).usuario }, 'config');
  res.json(db.prepare('SELECT * FROM financeiro_centros_custo WHERE id=?').get(info.lastInsertRowid));
});
app.put('/api/financeiro/centros-custo/:id', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const id = +req.params.id, d = req.body || {};
  db.prepare('UPDATE financeiro_centros_custo SET nome=COALESCE(?,nome), tipo=COALESCE(?,tipo), ativo=COALESCE(?,ativo) WHERE id=?').run(d.nome ?? null, d.tipo ?? null, d.ativo != null ? (d.ativo ? 1 : 0) : null, id);
  res.json(db.prepare('SELECT * FROM financeiro_centros_custo WHERE id=?').get(id));
});
app.delete('/api/financeiro/centros-custo/:id', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const id = +req.params.id, c = db.prepare('SELECT * FROM financeiro_centros_custo WHERE id=?').get(id);
  if (!c) return res.status(404).json({ erro: 'Não encontrado.' });
  if (c.sistema) return res.status(400).json({ erro: 'Centro de custo do sistema não pode ser excluído (pode desativar).' });
  const n = db.prepare('SELECT COUNT(*) n FROM financeiro_movimentos WHERE centro_custo_id=?').get(id).n;
  if (n > 0) return res.status(400).json({ erro: `Tem ${n} movimento(s). Desative em vez de excluir.` });
  db.prepare('DELETE FROM financeiro_centros_custo WHERE id=?').run(id);
  manut.logAcao('centro de custo excluído', 'financeiro', { id, nome: c.nome, por: (req.usuario || {}).usuario }, 'config');
  res.json({ ok: true });
});

// ── Dashboard financeiro ──
app.get('/api/financeiro/dashboard', (req, res) => {
  const inicioMes = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; })();
  const hojeYmd = ymdLocal(new Date());
  const semana = new Date(); semana.setDate(semana.getDate() + 7); const semanaYmd = ymdLocal(semana);
  const contas = db.prepare('SELECT * FROM financeiro_contas WHERE ativo=1 ORDER BY nome').all().map(contaComSaldo);
  const somaTipo = (tipos) => r2(contas.filter(c => tipos.includes(c.tipo)).reduce((s, c) => s + c.saldo, 0));
  const cpAbertas = db.prepare("SELECT * FROM contas_pagar WHERE status IN ('aberto','parcial')").all();
  const emAberto = (c) => r2((c.valor_total || 0) - valorPagoConta(c.id));
  const venc = (c) => (c.data_vencimento || '').slice(0, 10);
  const pagarHoje = r2(cpAbertas.filter(c => venc(c) === hojeYmd).reduce((s, c) => s + emAberto(c), 0));
  const pagarSemana = r2(cpAbertas.filter(c => venc(c) && venc(c) >= hojeYmd && venc(c) <= semanaYmd).reduce((s, c) => s + emAberto(c), 0));
  const pagarTotal = r2(cpAbertas.reduce((s, c) => s + emAberto(c), 0));
  const pagarVencido = r2(cpAbertas.filter(c => venc(c) && venc(c) < hojeYmd).reduce((s, c) => s + emAberto(c), 0));
  const fiadoReceber = r2(db.prepare("SELECT COALESCE(SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END),0) t FROM clientes_extrato").get().t);
  const despMes = r2(db.prepare("SELECT COALESCE(SUM(valor),0) t FROM financeiro_movimentos WHERE tipo='saida' AND situacao='confirmado' AND date(data,'localtime')>=?").get(inicioMes).t);
  const recMes = r2(db.prepare("SELECT COALESCE(SUM(valor),0) t FROM financeiro_movimentos WHERE tipo='entrada' AND situacao='confirmado' AND date(data,'localtime')>=?").get(inicioMes).t);
  const comprasMes = r2(db.prepare("SELECT COALESCE(SUM(total),0) t FROM erp_compras WHERE status<>'cancelada' AND date(COALESCE(data_emissao,criado_em),'localtime')>=?").get(inicioMes).t);
  const fx = faixaPeriodo({ periodo: 'mes' }), bi = biVisaoGeral(fx);
  const maiorForn = db.prepare("SELECT f.nome, COALESCE(SUM(ec.total),0) tot FROM erp_compras ec JOIN fornecedores f ON f.id=ec.fornecedor_id WHERE ec.status<>'cancelada' AND date(COALESCE(ec.data_emissao,ec.criado_em),'localtime')>=? GROUP BY ec.fornecedor_id ORDER BY tot DESC LIMIT 1").get(inicioMes);
  const cli = biClientes(fx), maiorCliente = (cli.maisGastaram || [])[0] || null;
  const prod = biProdutos(fx), produtosLucrativos = (prod.maisLucro || []).slice(0, 5).map(p => ({ nome: p.nome, lucro: r2(p.lucro), margem: p.margem }));
  const serie = (sql) => db.prepare(sql).all().map(x => ({ k: x.k, v: r2(x.v) }));
  const serieDia = serie("SELECT date(data,'localtime') k, COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) v FROM financeiro_movimentos WHERE situacao='confirmado' AND date(data,'localtime')>=date('now','-13 days','localtime') GROUP BY k ORDER BY k");
  const serieMes = db.prepare("SELECT strftime('%Y-%m',data,'localtime') k, COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) v FROM financeiro_movimentos WHERE situacao='confirmado' GROUP BY k ORDER BY k DESC LIMIT 12").all().reverse().map(x => ({ k: x.k, v: r2(x.v) }));
  const serieAno = serie("SELECT strftime('%Y',data,'localtime') k, COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) v FROM financeiro_movimentos WHERE situacao='confirmado' GROUP BY k ORDER BY k");
  res.json({
    saldos: { caixa: somaTipo(['caixa']), banco: somaTipo(['banco', 'maquininha']), total: r2(contas.reduce((s, c) => s + c.saldo, 0)), contas: contas.map(c => ({ nome: c.nome, tipo: c.tipo, saldo: c.saldo })) },
    receber: { hoje: 0, semana: 0, total: r2(fiadoReceber + anotacoesPendentesTotal()), fiado: fiadoReceber, anotacoes: anotacoesPendentesTotal(), obs: 'a receber = fiado + anotações "pagar depois" em aberto' },
    pagar: { hoje: pagarHoje, semana: pagarSemana, total: pagarTotal, vencido: pagarVencido },
    mes: { vendas: r2(bi.faturamento), receitas: recMes, despesas: despMes, compras: comprasMes, lucro: r2(bi.lucroEstimado), coberturaCusto: bi.coberturaCusto },
    maiorFornecedor: maiorForn ? { nome: maiorForn.nome, total: r2(maiorForn.tot) } : null,
    maiorCliente: maiorCliente ? { nome: maiorCliente.nome, total: r2(maiorCliente.gasto) } : null,
    produtosLucrativos,
    graficos: { diario: serieDia, mensal: serieMes, anual: serieAno },
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   FASE 39 — FINANCEIRO PREMIUM (dashboard gerencial consolidado + indicadores)
   ─────────────────────────────────────────────────────────────────────────
   CAMADA DE CONSOLIDAÇÃO (só leitura) que reúne Fluxo, Contas a Pagar (F26),
   Contas a Receber (F33), Compras, Custos/CMV (F30/35) e Fechamento (F27) numa
   visão gerencial única, com INDICADORES e um DRE-lite. NÃO duplica dado — tudo
   é calculado a partir das mesmas fontes. Deixa ganchos preparados para as
   integrações futuras (Produção por Lotes, CRM/Fidelidade, BI). ═══════════ */
app.get('/api/financeiro/premium', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  try {
    const fx = faixaPeriodo(req.query), wMov = wherePeriodo('data', fx), wLC = wherePeriodo('criado_em', fx), wCP = wherePeriodo('data_emissao', fx);
    const hoje = ymdLocal(new Date()); const sem = new Date(); sem.setDate(sem.getDate() + 7); const semYmd = ymdLocal(sem);
    // Saldos (Fluxo de Caixa)
    const contas = db.prepare('SELECT * FROM financeiro_contas WHERE ativo=1 ORDER BY nome').all().map(contaComSaldo);
    const saldoTotal = r2(contas.reduce((s, c) => s + c.saldo, 0));
    const caixa = r2(contas.filter(c => c.tipo === 'caixa').reduce((s, c) => s + c.saldo, 0));
    const banco = r2(contas.filter(c => ['banco', 'maquininha'].includes(c.tipo)).reduce((s, c) => s + c.saldo, 0));
    // Contas a Receber (Fase 33 — mesma fonte)
    const receber = crResumo(crCarteira());
    // Contas a Pagar (Fase 26)
    const cpAbertas = db.prepare("SELECT * FROM contas_pagar WHERE status IN ('aberto','parcial')").all();
    const emAberto = (c) => r2((c.valor_total || 0) - valorPagoConta(c.id)), venc = (c) => (c.data_vencimento || '').slice(0, 10);
    const pagar = { total: r2(cpAbertas.reduce((s, c) => s + emAberto(c), 0)),
      vencido: r2(cpAbertas.filter(c => venc(c) && venc(c) < hoje).reduce((s, c) => s + emAberto(c), 0)),
      hoje: r2(cpAbertas.filter(c => venc(c) === hoje).reduce((s, c) => s + emAberto(c), 0)),
      semana: r2(cpAbertas.filter(c => venc(c) && venc(c) >= hoje && venc(c) <= semYmd).reduce((s, c) => s + emAberto(c), 0)) };
    // Resultado do período (livro-caixa)
    const receitas = r2(db.prepare(`SELECT COALESCE(SUM(valor),0) t FROM financeiro_movimentos WHERE tipo='entrada' AND situacao='confirmado'${wMov.clause}`).get(...wMov.args).t);
    const despesas = r2(db.prepare(`SELECT COALESCE(SUM(valor),0) t FROM financeiro_movimentos WHERE tipo='saida' AND situacao='confirmado'${wMov.clause}`).get(...wMov.args).t);
    // Vendas + CMV (custo real FIFO, Fase 30/35) do período
    const bi = biVisaoGeral(fx);
    const lb = db.prepare(`SELECT COALESCE(SUM(qtd*preco_unitario),0) receita, COALESCE(SUM(custo_total),0) custo FROM lotes_consumo WHERE 1=1${wLC.clause}`).get(...wLC.args);
    const vendas = r2(bi.faturamento || lb.receita), cmv = r2(lb.custo), lucroBruto = r2(vendas - cmv);
    // Compras do período (contas a pagar emitidas — captura compra rápida e profissional)
    const compras = r2(db.prepare(`SELECT COALESCE(SUM(valor_total),0) t FROM contas_pagar WHERE status<>'cancelada'${wCP.clause}`).get(...wCP.args).t);
    // DRE simplificado (lite)
    const dre = { receita_bruta: vendas, cmv, lucro_bruto: lucroBruto, despesas, resultado: r2(lucroBruto - despesas),
      margem_bruta: vendas > 0 ? r2(lucroBruto / vendas * 100) : null, margem_liquida: vendas > 0 ? r2((lucroBruto - despesas) / vendas * 100) : null };
    // Indicadores financeiros
    const indicadores = {
      liquidez_imediata: pagar.total > 0 ? r2(saldoTotal / pagar.total) : null,      // saldo ÷ a pagar
      posicao_liquida: r2(saldoTotal + receber.total - pagar.total),                  // caixa + a receber − a pagar
      inadimplencia_pct: receber.total > 0 ? r2(receber.vencido / receber.total * 100) : 0,
      cobertura_caixa_dias: despesas > 0 ? r2(saldoTotal / (despesas / 30)) : null,   // dias de caixa no ritmo do período
      margem_bruta: dre.margem_bruta, margem_liquida: dre.margem_liquida,
      resultado_caixa: r2(receitas - despesas),
    };
    // Consolidação por módulo (cada um com seu número-chave + status)
    const modulos = [
      { chave: 'fluxo', nome: '💵 Fluxo de Caixa', valor: saldoTotal, obs: `${contas.length} conta(s)` },
      { chave: 'receber', nome: '📥 Contas a Receber', valor: receber.total, alerta: receber.vencido > 0, obs: receber.vencido > 0 ? `${fmtBRLc(receber.vencido)} vencido` : 'em dia' },
      { chave: 'contas_pagar', nome: '📌 Contas a Pagar', valor: pagar.total, alerta: pagar.vencido > 0, obs: pagar.vencido > 0 ? `${fmtBRLc(pagar.vencido)} vencido` : 'em dia' },
      { chave: 'compras', nome: '🛒 Compras (período)', valor: compras, obs: fx.label },
      { chave: 'custos', nome: '📊 Lucro bruto (período)', valor: lucroBruto, obs: dre.margem_bruta != null ? `margem ${dre.margem_bruta}%` : '' },
      { chave: 'fechamento', nome: '🧮 Fechamento de Caixa', valor: null, obs: sessaoAbertaUnica() ? 'sessão aberta' : 'nenhuma sessão aberta' },
    ];
    // Série diária (14 dias) — saldo líquido por dia
    const serieDia = db.prepare("SELECT date(data,'localtime') k, COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) v FROM financeiro_movimentos WHERE situacao='confirmado' AND date(data,'localtime')>=date('now','-13 days','localtime') GROUP BY k ORDER BY k").all().map(x => ({ k: x.k, v: r2(x.v) }));
    res.json({
      periodo: fx,
      saldos: { total: saldoTotal, caixa, banco, contas: contas.map(c => ({ nome: c.nome, tipo: c.tipo, saldo: c.saldo })) },
      receber, pagar, resultado: { receitas, despesas, resultado_caixa: r2(receitas - despesas), vendas, compras },
      dre, indicadores, modulos, serie_dia: serieDia,
      integracoes_futuras: {
        producao_lotes: { status: 'preparado', obs: 'Lotes de produção (Fase 38) alimentarão o CMV e o custo por litro quando ativados.' },
        crm_fidelidade: { status: 'preparado', obs: 'Resgates/cashback entrarão como categoria financeira dedicada.' },
        bi: { status: 'ativo', obs: 'Indicadores já consomem o BI (faturamento, produtos, clientes).' },
      },
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── Movimentações (livro-caixa completo + saldo corrido) ──
app.get('/api/financeiro/movimentacoes', (req, res) => {
  const f = filtrosMovimentos(req.query);
  const rows = db.prepare(`${SELECT_MOV} WHERE ${f.where} ORDER BY m.data ASC, m.id ASC`).all(...f.args);
  let acc = 0;
  const linhas = rows.map(m => { if (m.situacao === 'confirmado') acc += (m.tipo === 'entrada' ? m.valor : -m.valor); return { ...m, saldo: r2(acc) }; });
  res.json({ linhas: linhas.reverse(), total: linhas.length, saldoFinal: r2(acc) });
});

// ── Alertas financeiros unificados ──
app.get('/api/financeiro/alertas', (req, res) => {
  const hojeYmd = ymdLocal(new Date()), am = new Date(); am.setDate(am.getDate() + 1); const amanhaYmd = ymdLocal(am);
  const cpAbertas = db.prepare("SELECT cp.*, f.nome forn FROM contas_pagar cp LEFT JOIN fornecedores f ON f.id=cp.fornecedor_id WHERE cp.status IN ('aberto','parcial')").all();
  const emAberto = (c) => r2((c.valor_total || 0) - valorPagoConta(c.id)), venc = (c) => (c.data_vencimento || '').slice(0, 10);
  const vencidas = cpAbertas.filter(c => venc(c) && venc(c) < hojeYmd).map(c => ({ id: c.id, fornecedor: c.forn || '—', valor: emAberto(c), vencimento: venc(c) }));
  const venceAmanha = cpAbertas.filter(c => venc(c) === amanhaYmd).map(c => ({ id: c.id, fornecedor: c.forn || '—', valor: emAberto(c) }));
  const saldoTotal = saldoTotalFinanceiro(), saldoBaixoLim = +getConfig('financeiro_saldo_baixo', '100');
  const limParado = new Date(); limParado.setDate(limParado.getDate() - 45);
  const fornParados = db.prepare("SELECT f.nome, MAX(ec.criado_em) ult FROM fornecedores f JOIN erp_compras ec ON ec.fornecedor_id=f.id WHERE f.ativo=1 GROUP BY f.id HAVING ult < ? ORDER BY ult LIMIT 10").all(limParado.toISOString()).map(x => ({ nome: x.nome, ultima: x.ult }));
  const comprasAltas = [];
  for (const f of db.prepare('SELECT id,nome FROM fornecedores WHERE ativo=1').all()) {
    const comp = db.prepare("SELECT total FROM erp_compras WHERE fornecedor_id=? AND status<>'cancelada' ORDER BY id DESC LIMIT 12").all(f.id);
    if (comp.length >= 3) { const media = comp.reduce((s, c) => s + (c.total || 0), 0) / comp.length; if (comp[0].total > media * 1.5) comprasAltas.push({ fornecedor: f.nome, valor: r2(comp[0].total), media: r2(media) }); }
  }
  const semCategoria = db.prepare("SELECT COUNT(*) n FROM financeiro_movimentos WHERE categoria_id IS NULL AND situacao='confirmado'").get().n;
  res.json({
    vencidas, venceAmanha, saldoTotal: r2(saldoTotal), saldoBaixo: saldoTotal < saldoBaixoLim, saldoBaixoLim, fluxoNegativo: saldoTotal < 0,
    fornecedoresParados: fornParados, comprasAcimaMedia: comprasAltas, semCategoria,
    total: vencidas.length + venceAmanha.length + (saldoTotal < saldoBaixoLim ? 1 : 0) + fornParados.length + comprasAltas.length,
  });
});

// ── Relatórios (+ export CSV; PDF pelo navegador no front) ──
function relatorioFinanceiro(tipo, fx) {
  const wm = wherePeriodo('m.data', fx);
  if (tipo === 'centro-custos') {
    const rows = db.prepare(`SELECT COALESCE(cc.nome,'(sem centro)') nome, SUM(m.valor) tot, COUNT(*) n FROM financeiro_movimentos m LEFT JOIN financeiro_centros_custo cc ON cc.id=m.centro_custo_id WHERE m.tipo='saida' AND m.situacao='confirmado'${wm.clause} GROUP BY m.centro_custo_id ORDER BY tot DESC`).all(...wm.args);
    return { titulo: 'Despesas por centro de custo', colunas: ['Centro de custo', 'Total', 'Lançamentos'], linhas: rows.map(r => [r.nome, r2(r.tot), r.n]) };
  }
  if (tipo === 'despesas' || tipo === 'receitas') {
    const t = tipo === 'despesas' ? 'saida' : 'entrada';
    const rows = db.prepare(`SELECT COALESCE(cat.nome,'(sem categoria)') nome, SUM(m.valor) tot, COUNT(*) n FROM financeiro_movimentos m LEFT JOIN financeiro_categorias cat ON cat.id=m.categoria_id WHERE m.tipo=? AND m.situacao='confirmado'${wm.clause} GROUP BY m.categoria_id ORDER BY tot DESC`).all(t, ...wm.args);
    return { titulo: (tipo === 'despesas' ? 'Despesas' : 'Receitas') + ' por categoria', colunas: ['Categoria', 'Total', 'Lançamentos'], linhas: rows.map(r => [r.nome, r2(r.tot), r.n]) };
  }
  if (tipo === 'fluxo') {
    const rows = db.prepare(`SELECT date(data,'localtime') dia, COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) ent, COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) sai FROM financeiro_movimentos m WHERE situacao='confirmado'${wm.clause} GROUP BY dia ORDER BY dia`).all(...wm.args);
    return { titulo: 'Fluxo de caixa por dia', colunas: ['Dia', 'Entradas', 'Saídas', 'Resultado'], linhas: rows.map(r => [r.dia, r2(r.ent), r2(r.sai), r2(r.ent - r.sai)]) };
  }
  if (tipo === 'fornecedores') {
    const wc = wherePeriodo('COALESCE(ec.data_emissao,ec.criado_em)', fx);
    const rows = db.prepare(`SELECT f.nome, COUNT(*) n, COALESCE(SUM(ec.total),0) tot FROM erp_compras ec JOIN fornecedores f ON f.id=ec.fornecedor_id WHERE ec.status<>'cancelada'${wc.clause} GROUP BY ec.fornecedor_id ORDER BY tot DESC`).all(...wc.args);
    return { titulo: 'Compras por fornecedor', colunas: ['Fornecedor', 'Compras', 'Total'], linhas: rows.map(r => [r.nome, r.n, r2(r.tot)]) };
  }
  if (tipo === 'contas-pagas' || tipo === 'contas-vencidas') {
    const hojeYmd = ymdLocal(new Date());
    const cps = db.prepare("SELECT cp.*, f.nome forn FROM contas_pagar cp LEFT JOIN fornecedores f ON f.id=cp.fornecedor_id").all();
    let lista;
    if (tipo === 'contas-pagas') lista = cps.filter(c => statusDaConta(c) === 'pago');
    else lista = cps.filter(c => ['aberto', 'parcial'].includes(statusDaConta(c)) && (c.data_vencimento || '').slice(0, 10) < hojeYmd);
    return { titulo: tipo === 'contas-pagas' ? 'Contas pagas' : 'Contas vencidas', colunas: ['Fornecedor', 'Descrição', 'Valor', 'Vencimento', 'Status'],
      linhas: lista.map(c => [c.forn || '—', c.descricao || '', r2(c.valor_total), (c.data_vencimento || '').slice(0, 10), statusDaConta(c)]) };
  }
  return { titulo: 'Relatório', colunas: [], linhas: [] };
}
app.get('/api/financeiro/relatorios/:tipo', (req, res) => {
  const fx = faixaPeriodo(req.query), rel = relatorioFinanceiro(req.params.tipo, fx);
  if (req.query.csv === '1') return enviarCSV(req, res, `fin-${req.params.tipo}-${fx.de || 'tudo'}.csv`, rel.colunas, rel.linhas.map(l => l.map(v => typeof v === 'number' ? String(v).replace('.', ',') : v)), 'financeiro-' + req.params.tipo);
  res.json({ ...rel, periodo: fx });
});

// ── Config financeira ──
app.get('/api/financeiro/config', (req, res) => res.json({ saldo_baixo: +getConfig('financeiro_saldo_baixo', '100'), conta_cartao_id: +getConfig('financeiro_conta_cartao_id', 0) }));
app.post('/api/financeiro/config', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const d = req.body || {};
  if (d.saldo_baixo != null) setConfig('financeiro_saldo_baixo', String(Math.max(0, +d.saldo_baixo || 0)));
  if (d.conta_cartao_id != null) setConfig('financeiro_conta_cartao_id', String(+d.conta_cartao_id || 0));
  manut.logAcao('config financeira alterada', 'financeiro', { por: (req.usuario || {}).usuario }, 'config');
  res.json({ ok: true });
});

/* ══════════════════════════════════════════════════════════════════════════
   CUSTO REAL · LOTES · RATEIO INTELIGENTE · RENTABILIDADE (Fase 30). Cada
   processamento vira um LOTE; o custo do lote é rateado pelos PESOS de cada
   produto (não custo médio simples); cada venda consome os lotes em FIFO e
   apura CUSTO/MARGEM/LUCRO REAL do item. Camada de CUSTEIO à parte: não mexe
   no estoque operacional (produtos.estoque) nem duplica o financeiro. Perdas
   geram saída financeira. Pesos versionados (lote antigo nunca é recalculado).
   Ver 45_*.md. ══════════════════════════════════════════════════════════════ */
db.exec(`CREATE TABLE IF NOT EXISTS lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, fornecedor_id INTEGER, data TEXT, operador TEXT,
  valor_pago REAL, qtd_recebida REAL, unidade TEXT, rendimento_previsto REAL, nota_fiscal TEXT,
  forma_pagamento TEXT, conta_id INTEGER, centro_custo_id INTEGER, obs TEXT,
  status TEXT DEFAULT 'aberto', criado_em TEXT, criado_por TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS lotes_produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lote_id INTEGER NOT NULL, produto_codigo TEXT, nome TEXT,
  qtd_produzida REAL, peso_custo REAL, custo_unitario REAL, preco_venda REAL,
  qtd_vendida REAL DEFAULT 0, qtd_perdida REAL DEFAULT 0, qtd_restante REAL DEFAULT 0
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_lp_lote ON lotes_produtos(lote_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_lp_prod ON lotes_produtos(produto_codigo)');
db.exec('CREATE TABLE IF NOT EXISTS pesos_custo (produto_codigo TEXT PRIMARY KEY, nome TEXT, peso REAL DEFAULT 1, atualizado_em TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS pesos_custo_historico (id INTEGER PRIMARY KEY AUTOINCREMENT, produto_codigo TEXT, peso_antigo REAL, peso_novo REAL, por TEXT, criado_em TEXT)');
db.exec(`CREATE TABLE IF NOT EXISTS lotes_consumo (
  id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER, venda_item_id INTEGER, lote_id INTEGER, lote_produto_id INTEGER,
  produto_codigo TEXT, qtd REAL, custo_unitario REAL, custo_total REAL, preco_unitario REAL, criado_em TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_lc_venda ON lotes_consumo(venda_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_lc_prod ON lotes_consumo(produto_codigo)');
db.exec(`CREATE TABLE IF NOT EXISTS perdas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lote_produto_id INTEGER, lote_id INTEGER, produto_codigo TEXT, nome TEXT,
  tipo TEXT, qtd REAL, custo_unitario REAL, custo_total REAL, financeiro_movimento_id INTEGER,
  data TEXT, operador TEXT, obs TEXT, criado_em TEXT
)`);
if (!db.prepare("SELECT id FROM financeiro_categorias WHERE nome='Perda'").get())
  db.prepare("INSERT INTO financeiro_categorias (nome,tipo,sistema,ativo,criado_em) VALUES ('Perda','saida',1,1,?)").run(new Date().toISOString());

const pesoDoProduto = (codigo) => { const r = db.prepare('SELECT peso FROM pesos_custo WHERE produto_codigo=?').get(codigo); return r && r.peso != null ? r.peso : 1; };
// RATEIO PONDERADO: custo_unitario_j = valor_lote * peso_j / Σ(peso_i * qtd_i). Pesos são SNAPSHOT (gravados no lote).
function ratearLote(loteId) {
  const lote = db.prepare('SELECT * FROM lotes WHERE id=?').get(loteId);
  const prods = db.prepare('SELECT * FROM lotes_produtos WHERE lote_id=?').all(loteId);
  if (!lote || !prods.length) return null;
  const denom = prods.reduce((s, p) => s + (p.peso_custo || 1) * (p.qtd_produzida || 0), 0);
  const valor = +lote.valor_pago || 0;
  for (const p of prods) {
    const custoUnit = denom > 0 ? r2(valor * (p.peso_custo || 1) / denom) : 0;
    db.prepare('UPDATE lotes_produtos SET custo_unitario=?, qtd_restante = qtd_produzida - qtd_vendida - qtd_perdida WHERE id=?').run(custoUnit, p.id);
  }
  db.prepare("UPDATE lotes SET status='finalizado' WHERE id=?").run(loteId);
  return db.prepare('SELECT * FROM lotes_produtos WHERE lote_id=?').all(loteId);
}
// FIFO: consome os lotes finalizados (mais antigos primeiro) pra apurar o custo REAL de cada item. Idempotente por venda.
function consumirLotesDaVenda(vendaId) {
  const v = db.prepare('SELECT * FROM vendas WHERE id=?').get(vendaId);
  if (!v || v.status !== 'concluida') return;
  if (db.prepare('SELECT 1 FROM lotes_consumo WHERE venda_id=? LIMIT 1').get(vendaId)) return; // já consumido
  const agora = new Date().toISOString();
  for (const it of db.prepare('SELECT * FROM vendas_itens WHERE venda_id=?').all(vendaId)) {
    const cod = it.produto_codigo || it.codigo; if (!cod) continue;
    let restante = +it.qtd || 0;
    const lotes = db.prepare("SELECT lp.* FROM lotes_produtos lp JOIN lotes l ON l.id=lp.lote_id WHERE lp.produto_codigo=? AND lp.qtd_restante > 0.0001 AND l.status='finalizado' ORDER BY l.data ASC, l.id ASC").all(cod);
    for (const lp of lotes) {
      if (restante <= 0.0001) break;
      const usar = Math.min(restante, lp.qtd_restante);
      db.prepare('INSERT INTO lotes_consumo (venda_id,venda_item_id,lote_id,lote_produto_id,produto_codigo,qtd,custo_unitario,custo_total,preco_unitario,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(vendaId, it.id, lp.lote_id, lp.id, cod, usar, lp.custo_unitario, r2(usar * lp.custo_unitario), +it.preco || 0, agora);
      db.prepare('UPDATE lotes_produtos SET qtd_vendida = qtd_vendida + ?, qtd_restante = qtd_restante - ? WHERE id=?').run(usar, usar, lp.id);
      restante -= usar;
    }
  }
}
function estornarLotesDaVenda(vendaId) {
  for (const c of db.prepare('SELECT * FROM lotes_consumo WHERE venda_id=?').all(vendaId))
    db.prepare('UPDATE lotes_produtos SET qtd_vendida = MAX(0, qtd_vendida - ?), qtd_restante = qtd_restante + ? WHERE id=?').run(c.qtd, c.qtd, c.lote_produto_id);
  db.prepare('DELETE FROM lotes_consumo WHERE venda_id=?').run(vendaId);
}
function registrarPerda(lpId, tipo, qtd, obs, usuario) {
  const lp = db.prepare('SELECT * FROM lotes_produtos WHERE id=?').get(lpId);
  if (!lp) throw new Error('produto do lote não encontrado');
  qtd = Math.min(+qtd || 0, lp.qtd_restante);
  if (qtd <= 0) throw new Error('quantidade inválida (sem saldo no lote)');
  const custoTotal = r2(qtd * (lp.custo_unitario || 0)), agora = new Date().toISOString();
  db.prepare('UPDATE lotes_produtos SET qtd_perdida = qtd_perdida + ?, qtd_restante = qtd_restante - ? WHERE id=?').run(qtd, qtd, lpId);
  let movId = null;
  if (custoTotal > 0) movId = inserirMovimento({ tipo: 'saida', conta_id: contaParaForma('Dinheiro'), categoria_id: catFinId('Perda'), valor: custoTotal,
    descricao: `Perda (${tipo}) · ${lp.nome || lp.produto_codigo} · ${qtd}un`, origem: 'perda', situacao: 'confirmado', referencia_tipo: 'perda', criado_por: usuario || '' });
  const info = db.prepare('INSERT INTO perdas (lote_produto_id,lote_id,produto_codigo,nome,tipo,qtd,custo_unitario,custo_total,financeiro_movimento_id,data,operador,obs,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(lpId, lp.lote_id, lp.produto_codigo, lp.nome, tipo, qtd, lp.custo_unitario, custoTotal, movId, agora, usuario || '', obs || '', agora);
  if (movId) db.prepare('UPDATE financeiro_movimentos SET referencia_id=? WHERE id=?').run(String(info.lastInsertRowid), movId);
  return { id: info.lastInsertRowid, custoTotal, movimento_id: movId };
}

// ── Endpoints: LOTES ──
function gateCustos(req, res) { return gateFinLancar(req, res); } // admin/supervisor lançam
app.get('/api/custos/lotes', (req, res) => {
  const rows = db.prepare('SELECT l.*, f.nome fornecedor FROM lotes l LEFT JOIN fornecedores f ON f.id=l.fornecedor_id ORDER BY l.id DESC LIMIT 300').all();
  res.json(rows.map(l => ({ ...l, produtos: db.prepare('SELECT * FROM lotes_produtos WHERE lote_id=?').all(l.id).length })));
});
app.get('/api/custos/lotes/:id', (req, res) => {
  const l = db.prepare('SELECT l.*, f.nome fornecedor FROM lotes l LEFT JOIN fornecedores f ON f.id=l.fornecedor_id WHERE l.id=?').get(+req.params.id);
  if (!l) return res.status(404).json({ erro: 'Lote não encontrado.' });
  l.produtos = db.prepare('SELECT * FROM lotes_produtos WHERE lote_id=? ORDER BY id').all(l.id);
  res.json(l);
});
app.post('/api/custos/lotes', (req, res) => {
  if (!gateCustos(req, res)) return;
  const d = req.body || {}, prods = Array.isArray(d.produtos) ? d.produtos.filter(p => (p.codigo || p.nome) && +p.qtd_produzida > 0) : [];
  if (!prods.length) return res.status(400).json({ erro: 'Informe ao menos um produto produzido.' });
  const agora = new Date().toISOString();
  const numero = d.numero || ('L' + Date.now().toString().slice(-6));
  const info = db.prepare(`INSERT INTO lotes (numero,fornecedor_id,data,operador,valor_pago,qtd_recebida,unidade,rendimento_previsto,nota_fiscal,forma_pagamento,conta_id,centro_custo_id,obs,status,criado_em,criado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'aberto',?,?)`).run(numero, +d.fornecedor_id || null, d.data || agora, d.operador || (req.usuario || {}).nome || '',
     +d.valor_pago || 0, +d.qtd_recebida || 0, d.unidade || 'kg', +d.rendimento_previsto || 0, d.nota_fiscal || '', d.forma_pagamento || '', +d.conta_id || null, +d.centro_custo_id || null, d.obs || '', agora, (req.usuario || {}).usuario || '');
  const loteId = info.lastInsertRowid;
  const ins = db.prepare('INSERT INTO lotes_produtos (lote_id,produto_codigo,nome,qtd_produzida,peso_custo,preco_venda,qtd_restante) VALUES (?,?,?,?,?,?,?)');
  for (const p of prods) { const cod = p.codigo || p.nome; ins.run(loteId, cod, p.nome || cod, +p.qtd_produzida || 0, +p.peso != null && +p.peso > 0 ? +p.peso : pesoDoProduto(cod), +p.preco_venda || 0, +p.qtd_produzida || 0); }
  ratearLote(loteId); // finaliza + rateia (pesos já são snapshot)
  manut.logAcao('lote criado', 'custos', { id: loteId, numero, valor: +d.valor_pago || 0, produtos: prods.length, por: (req.usuario || {}).usuario }, 'operacao');
  manut.logAcao('rateio de lote', 'custos', { id: loteId, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(db.prepare('SELECT * FROM lotes WHERE id=?').get(loteId));
});
app.post('/api/custos/lotes/:id/cancelar', (req, res) => {
  if (!gateCustos(req, res)) return;
  const id = +req.params.id, l = db.prepare('SELECT * FROM lotes WHERE id=?').get(id);
  if (!l) return res.status(404).json({ erro: 'Lote não encontrado.' });
  const vendido = db.prepare('SELECT COALESCE(SUM(qtd_vendida),0) v FROM lotes_produtos WHERE lote_id=?').get(id).v;
  if (vendido > 0.0001) return res.status(400).json({ erro: 'Lote já teve vendas — não pode cancelar (registre perdas se preciso).' });
  db.prepare("UPDATE lotes SET status='cancelado' WHERE id=?").run(id);
  manut.logAcao('lote cancelado', 'custos', { id, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true });
});

// ── PESOS de custo (versionados) ──
app.get('/api/custos/pesos', (req, res) => {
  const prods = db.prepare('SELECT codigo, nome FROM produtos ORDER BY nome').all();
  res.json(prods.map(p => ({ codigo: p.codigo, nome: p.nome, peso: pesoDoProduto(p.codigo) })));
});
app.put('/api/custos/pesos/:codigo', (req, res) => {
  if (!gateCustos(req, res)) return;
  const cod = req.params.codigo, novo = +req.body.peso;
  if (!(novo > 0)) return res.status(400).json({ erro: 'peso deve ser maior que zero.' });
  const antigo = pesoDoProduto(cod), agora = new Date().toISOString();
  const prod = db.prepare('SELECT nome FROM produtos WHERE codigo=?').get(cod);
  db.prepare('INSERT INTO pesos_custo (produto_codigo,nome,peso,atualizado_em) VALUES (?,?,?,?) ON CONFLICT(produto_codigo) DO UPDATE SET peso=excluded.peso, nome=excluded.nome, atualizado_em=excluded.atualizado_em').run(cod, prod ? prod.nome : cod, novo, agora);
  db.prepare('INSERT INTO pesos_custo_historico (produto_codigo,peso_antigo,peso_novo,por,criado_em) VALUES (?,?,?,?,?)').run(cod, antigo, novo, (req.usuario || {}).usuario || '', agora);
  manut.logAcao('peso de custo alterado', 'custos', { produto: cod, de: antigo, para: novo, por: (req.usuario || {}).usuario }, 'config');
  res.json({ ok: true, codigo: cod, peso: novo });
});
app.get('/api/custos/pesos/:codigo/historico', (req, res) => res.json(db.prepare('SELECT * FROM pesos_custo_historico WHERE produto_codigo=? ORDER BY id DESC').all(req.params.codigo)));

// ── RENDIMENTOS (por lote) ──
app.get('/api/custos/rendimentos', (req, res) => {
  const lotes = db.prepare("SELECT l.*, f.nome fornecedor FROM lotes l LEFT JOIN fornecedores f ON f.id=l.fornecedor_id WHERE l.status='finalizado' ORDER BY l.id DESC LIMIT 200").all();
  res.json(lotes.map(l => {
    const p = db.prepare('SELECT COALESCE(SUM(qtd_produzida),0) prod, COALESCE(SUM(qtd_perdida),0) perd FROM lotes_produtos WHERE lote_id=?').get(l.id);
    const previsto = +l.rendimento_previsto || 0, produzido = r2(p.prod), perdas = r2(p.perd);
    return { id: l.id, numero: l.numero, fornecedor: l.fornecedor, data: l.data, qtd_recebida: l.qtd_recebida, unidade: l.unidade,
      previsto, produzido, diferenca: r2(produzido - previsto), perdas, rendimento: (l.qtd_recebida > 0 ? r2(produzido / l.qtd_recebida * 100) : null),
      eficiencia: (previsto > 0 ? r2((produzido - perdas) / previsto * 100) : (produzido > 0 ? r2((produzido - perdas) / produzido * 100) : null)) };
  }));
});

// ── CUSTOS REAIS (por item vendido, via FIFO) ──
app.get('/api/custos/custos-reais', (req, res) => {
  const fx = faixaPeriodo(req.query), wc = wherePeriodo('lc.criado_em', fx);
  const rows = db.prepare(`SELECT lc.*, l.numero lote_numero, lp.nome FROM lotes_consumo lc JOIN lotes l ON l.id=lc.lote_id JOIN lotes_produtos lp ON lp.id=lc.lote_produto_id WHERE 1=1${wc.clause} ORDER BY lc.id DESC LIMIT 500`).all(...wc.args);
  res.json(rows.map(r => { const receita = r2(r.qtd * r.preco_unitario), lucro = r2(receita - r.custo_total); return {
    ...r, receita, lucro, margem: receita > 0 ? r2(lucro / receita * 100) : 0 }; }));
});

// ── RENTABILIDADE + rankings ──
app.get('/api/custos/rentabilidade', (req, res) => {
  const fx = faixaPeriodo(req.query), wc = wherePeriodo('lc.criado_em', fx);
  const grupo = (sql, args) => db.prepare(sql).all(...args).map(x => { const receita = r2(x.receita), custo = r2(x.custo), lucro = r2(receita - custo); return { ...x, receita, custo, lucro, margem: receita > 0 ? r2(lucro / receita * 100) : 0 }; });
  const porProduto = grupo(`SELECT lc.produto_codigo cod, MAX(lp.nome) nome, SUM(lc.qtd) qtd, SUM(lc.qtd*lc.preco_unitario) receita, SUM(lc.custo_total) custo FROM lotes_consumo lc JOIN lotes_produtos lp ON lp.id=lc.lote_produto_id WHERE 1=1${wc.clause} GROUP BY lc.produto_codigo ORDER BY (SUM(lc.qtd*lc.preco_unitario)-SUM(lc.custo_total)) DESC`, wc.args);
  const porLote = grupo(`SELECT lc.lote_id, MAX(l.numero) numero, SUM(lc.qtd*lc.preco_unitario) receita, SUM(lc.custo_total) custo FROM lotes_consumo lc JOIN lotes l ON l.id=lc.lote_id WHERE 1=1${wc.clause} GROUP BY lc.lote_id ORDER BY (SUM(lc.qtd*lc.preco_unitario)-SUM(lc.custo_total)) DESC`, wc.args);
  const porFornecedor = grupo(`SELECT f.nome, SUM(lc.qtd*lc.preco_unitario) receita, SUM(lc.custo_total) custo FROM lotes_consumo lc JOIN lotes l ON l.id=lc.lote_id LEFT JOIN fornecedores f ON f.id=l.fornecedor_id WHERE 1=1${wc.clause} GROUP BY l.fornecedor_id ORDER BY (SUM(lc.qtd*lc.preco_unitario)-SUM(lc.custo_total)) DESC`, wc.args);
  res.json({ periodo: fx, porProduto, porLote, porFornecedor,
    maisLucrativos: [...porProduto].slice(0, 10), menosLucrativos: [...porProduto].sort((a, b) => a.lucro - b.lucro).slice(0, 10) });
});

// ── INDICADORES ──
app.get('/api/custos/indicadores', (req, res) => {
  const fx = faixaPeriodo(req.query), wc = wherePeriodo('lc.criado_em', fx);
  const c = db.prepare(`SELECT COALESCE(SUM(lc.qtd),0) qtd, COALESCE(SUM(lc.qtd*lc.preco_unitario),0) receita, COALESCE(SUM(lc.custo_total),0) custo FROM lotes_consumo lc WHERE 1=1${wc.clause}`).get(...wc.args);
  const receita = r2(c.receita), custo = r2(c.custo), lucro = r2(receita - custo), qtd = r2(c.qtd);
  const custoMedio = r2((db.prepare('SELECT AVG(custo_unitario) a FROM lotes_produtos WHERE custo_unitario>0').get().a) || 0);
  res.json({
    receita, custoReal: custo, lucroReal: lucro, itensVendidos: qtd,
    margem: receita > 0 ? r2(lucro / receita * 100) : 0, markup: custo > 0 ? r2(receita / custo) : 0, roi: custo > 0 ? r2(lucro / custo * 100) : 0,
    custoMedioProduto: custoMedio, ticketMedio: qtd > 0 ? r2(receita / qtd) : 0, lucroPorUnidade: qtd > 0 ? r2(lucro / qtd) : 0,
  });
});

// ── PERDAS ──
app.get('/api/custos/perdas', (req, res) => res.json(db.prepare('SELECT p.*, l.numero lote_numero FROM perdas p LEFT JOIN lotes l ON l.id=p.lote_id ORDER BY p.id DESC LIMIT 300').all()));
app.post('/api/custos/perdas', (req, res) => {
  if (!gateCustos(req, res)) return;
  const d = req.body || {};
  const tipos = ['descarte', 'deterioracao', 'degustacao', 'erro_producao', 'quebra'];
  if (!tipos.includes(d.tipo)) return res.status(400).json({ erro: 'tipo inválido.' });
  try {
    const r = registrarPerda(+d.lote_produto_id, d.tipo, +d.qtd, d.obs, (req.usuario || {}).usuario);
    manut.logAcao('perda registrada', 'custos', { perda: r.id, tipo: d.tipo, qtd: +d.qtd, custo: r.custoTotal, por: (req.usuario || {}).usuario }, 'operacao');
    res.json({ ok: true, ...r });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

// ── SIMULAÇÃO (puro — não grava nada) ──
app.post('/api/custos/simular', (req, res) => {
  const d = req.body || {}, valor = +d.valor_pago || 0, produtos = Array.isArray(d.produtos) ? d.produtos : [];
  const denom = produtos.reduce((s, p) => s + (+p.peso || 1) * (+p.qtd || 0), 0);
  const linhas = produtos.map(p => {
    const custoUnit = denom > 0 ? r2(valor * (+p.peso || 1) / denom) : 0, preco = +p.preco || 0;
    return { nome: p.nome || p.codigo, qtd: +p.qtd || 0, peso: +p.peso || 1, custoUnit, preco,
      margem: preco > 0 ? r2((preco - custoUnit) / preco * 100) : 0, lucroUnit: r2(preco - custoUnit), lucroTotal: r2((preco - custoUnit) * (+p.qtd || 0)) };
  });
  const receita = r2(linhas.reduce((s, l) => s + l.preco * l.qtd, 0)), lucro = r2(linhas.reduce((s, l) => s + l.lucroTotal, 0));
  res.json({ valor_pago: valor, linhas, receita, custo: valor, lucro, margem: receita > 0 ? r2(lucro / receita * 100) : 0, roi: valor > 0 ? r2(lucro / valor * 100) : 0 });
});

// ── ALERTAS de custo ──
app.get('/api/custos/alertas', (req, res) => {
  const semLucro = db.prepare(`SELECT lp.nome, lp.produto_codigo cod, lp.preco_venda, lp.custo_unitario FROM lotes_produtos lp JOIN lotes l ON l.id=lp.lote_id WHERE l.status='finalizado' AND lp.custo_unitario>0 AND lp.preco_venda>0 AND lp.preco_venda <= lp.custo_unitario ORDER BY (lp.preco_venda-lp.custo_unitario) LIMIT 20`).all()
    .map(x => ({ nome: x.nome, custo: r2(x.custo_unitario), preco: r2(x.preco_venda), margem: r2((x.preco_venda - x.custo_unitario) / x.preco_venda * 100) }));
  const parados = db.prepare(`SELECT lp.nome, l.numero, lp.qtd_restante, l.data FROM lotes_produtos lp JOIN lotes l ON l.id=lp.lote_id WHERE l.status='finalizado' AND lp.qtd_restante>0.5 AND l.data < ? ORDER BY l.data LIMIT 20`).all(new Date(Date.now() - 7 * 864e5).toISOString())
    .map(x => ({ nome: x.nome, lote: x.numero, restante: r2(x.qtd_restante), desde: x.data }));
  // rendimento abaixo da média
  const rends = db.prepare("SELECT l.id, l.numero, l.fornecedor_id, (SELECT COALESCE(SUM(qtd_produzida),0) FROM lotes_produtos WHERE lote_id=l.id) prod, l.qtd_recebida FROM lotes l WHERE l.status='finalizado' AND l.qtd_recebida>0").all()
    .map(l => ({ ...l, rend: l.prod / l.qtd_recebida }));
  const media = rends.length ? rends.reduce((s, r) => s + r.rend, 0) / rends.length : 0;
  const rendBaixo = rends.filter(r => media > 0 && r.rend < media * 0.85).map(r => ({ lote: r.numero, rendimento: r2(r.rend * 100), media: r2(media * 100) }));
  res.json({ margemNegativa: semLucro, lotesParados: parados, rendimentoBaixo: rendBaixo,
    total: semLucro.length + parados.length + rendBaixo.length });
});

// ── HISTÓRICO (lotes + perdas recentes) ──
app.get('/api/custos/historico', (req, res) => {
  const lotes = db.prepare('SELECT id,numero,data,valor_pago,status FROM lotes ORDER BY id DESC LIMIT 50').all();
  const perdas = db.prepare('SELECT id,nome,tipo,qtd,custo_total,data FROM perdas ORDER BY id DESC LIMIT 50').all();
  res.json({ lotes, perdas });
});

/* ══════════════════════════════════════════════════════════════════════════
   FASE 35 — CUSTOS, RENTABILIDADE E FORMAÇÃO DE PREÇO (consolidação)
   ─────────────────────────────────────────────────────────────────────────
   CAMADA DE LEITURA sobre o que já existe (lotes, lotes_consumo, produtos):
   consolida por produto o CUSTO MÉDIO PONDERADO (compras/lotes), o CUSTO REAL
   (FIFO efetivamente consumido) e a ÚLTIMA COMPRA (produtos.precoCompra), com
   margem/markup de cada base; formação de preço por margem-alvo; lucro bruto
   por venda/produto/período. NÃO duplica dado — tudo é CALCULADO. Só grava
   auditoria (custo_historico) e a estrutura RESERVADA do rateio de produção
   (producao_rendimento_perfil), que NÃO tem lógica ativa ainda. ══════════ */
// Auditoria de custo do produto (quando muda por compra/lote/ajuste)
db.exec(`CREATE TABLE IF NOT EXISTS custo_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT, produto_codigo TEXT, custo_anterior REAL, custo_novo REAL,
  origem TEXT, referencia TEXT, obs TEXT, por TEXT, criado_em TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_custohist_prod ON custo_historico(produto_codigo)');
/* RESERVADO (Fase 35): estrutura para o FUTURO rateio avançado da produção de
   açaí (cada produto com custo específico por rendimento). NÃO é lido por
   nenhuma lógica de produção/custo ainda — só armazena a configuração-alvo,
   pra quando a fase avançada chegar não precisar refazer o schema. */
db.exec(`CREATE TABLE IF NOT EXISTS producao_rendimento_perfil (
  id INTEGER PRIMARY KEY AUTOINCREMENT, produto_codigo TEXT UNIQUE, rendimento_esperado REAL,
  fator_rateio REAL, custo_alvo REAL, unidade TEXT, ativo INTEGER DEFAULT 0, obs TEXT, atualizado_em TEXT, criado_em TEXT
)`);
(function seedCustoConfig() {
  if (getConfig('custo_metodo_padrao', null) == null) setConfig('custo_metodo_padrao', 'real'); // real | medio | ultima
  if (getConfig('custo_margem_alvo', null) == null) setConfig('custo_margem_alvo', '50');        // % alvo p/ formação de preço
})();

// Custo MÉDIO PONDERADO (compras/lotes): Σ(custo_unit × qtd) / Σ(qtd) dos lotes finalizados
function custoMedioPonderado(codigo) {
  const r = db.prepare(`SELECT COALESCE(SUM(lp.custo_unitario*lp.qtd_produzida),0) c, COALESCE(SUM(lp.qtd_produzida),0) q
    FROM lotes_produtos lp JOIN lotes l ON l.id=lp.lote_id WHERE lp.produto_codigo=? AND l.status='finalizado' AND lp.custo_unitario>0`).get(codigo);
  return r.q > 0 ? r2(r.c / r.q) : null;
}
// Custo REAL (FIFO efetivamente consumido em vendas): Σ(custo_total) / Σ(qtd)
function custoRealMedio(codigo, wc) {
  const r = db.prepare(`SELECT COALESCE(SUM(custo_total),0) c, COALESCE(SUM(qtd),0) q FROM lotes_consumo WHERE produto_codigo=?${wc ? wc.clause : ''}`).get(codigo, ...(wc ? wc.args : []));
  return r.q > 0 ? r2(r.c / r.q) : null;
}
function custoVigente(codigo, metodo, cm, cr, uc) {
  const m = metodo || getConfig('custo_metodo_padrao', 'real');
  const cadeia = m === 'medio' ? [cm, cr, uc] : m === 'ultima' ? [uc, cm, cr] : [cr, cm, uc]; // real é o padrão
  for (const v of cadeia) if (v != null && v > 0) return v;
  return uc != null ? uc : 0;
}
const margemDe = (preco, custo) => (preco > 0 && custo != null) ? r2((preco - custo) / preco * 100) : null;
const markupDe = (preco, custo) => (custo > 0) ? r2(preco / custo) : null;
// Consolidação de custo de UM produto (tudo calculado, nada guardado)
function custoProdutoConsolidado(p) {
  const preco = +p.precoVenda || 0;
  const cm = custoMedioPonderado(p.codigo), cr = custoRealMedio(p.codigo), uc = (+p.precoCompra || 0) || null;
  const metodo = getConfig('custo_metodo_padrao', 'real');
  const vig = custoVigente(p.codigo, metodo, cm, cr, uc);
  return {
    codigo: p.codigo, nome: p.nome, preco_venda: preco, estoque: +p.estoque || 0,
    custo_medio: cm, custo_real: cr, ultima_compra: uc, custo_vigente: r2(vig), metodo,
    margem_medio: margemDe(preco, cm), margem_real: margemDe(preco, cr), margem_ultima: margemDe(preco, uc),
    margem_vigente: margemDe(preco, vig), markup_vigente: markupDe(preco, vig),
    lucro_unit_vigente: r2(preco - vig), tem_custo: (cm != null || cr != null || (uc != null && uc > 0)),
  };
}
// Preço sugerido por margem-alvo (markup por dentro): preco = custo / (1 - margem/100)
function precoSugerido(custo, margemAlvo) {
  const m = +margemAlvo || 0; if (m <= 0 || m >= 100 || !(custo > 0)) return null;
  return r2(custo / (1 - m / 100));
}
// Grava auditoria de custo se mudou (chamado nos pontos onde o custo do produto muda)
function registrarCustoHistorico(codigo, anterior, novo, origem, referencia, por) {
  if (!(Math.abs((+novo || 0) - (+anterior || 0)) > 0.005)) return;
  db.prepare('INSERT INTO custo_historico (produto_codigo,custo_anterior,custo_novo,origem,referencia,obs,por,criado_em) VALUES (?,?,?,?,?,?,?,?)')
    .run(codigo, r2(anterior), r2(novo), origem || 'ajuste', referencia || '', '', por || '', new Date().toISOString());
}

// ── CUSTO CONSOLIDADO POR PRODUTO ──
app.get('/api/custos/produtos', (req, res) => {
  const q = req.query || {};
  let prods = db.prepare('SELECT codigo,nome,precoVenda,precoCompra,estoque FROM produtos ORDER BY nome').all();
  let lista = prods.map(custoProdutoConsolidado);
  if (q.busca) { const s = String(q.busca).toLowerCase(); lista = lista.filter(x => (x.nome || '').toLowerCase().includes(s) || (x.codigo || '').toLowerCase().includes(s)); }
  if (q.sem_custo === '1') lista = lista.filter(x => !x.tem_custo);
  if (q.margem_baixa === '1') lista = lista.filter(x => x.margem_vigente != null && x.margem_vigente < 15);
  const comCusto = lista.filter(x => x.tem_custo && x.preco_venda > 0);
  const margemMedia = comCusto.length ? r2(comCusto.reduce((s, x) => s + (x.margem_vigente || 0), 0) / comCusto.length) : 0;
  res.json({ produtos: lista, resumo: { total: lista.length, sem_custo: lista.filter(x => !x.tem_custo).length,
    margem_negativa: lista.filter(x => x.margem_vigente != null && x.margem_vigente < 0).length, margem_media: margemMedia } });
});
app.get('/api/custos/produtos/:codigo', (req, res) => {
  const p = db.prepare('SELECT codigo,nome,precoVenda,precoCompra,estoque FROM produtos WHERE codigo=?').get(req.params.codigo);
  if (!p) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const cons = custoProdutoConsolidado(p);
  const margemAlvo = +getConfig('custo_margem_alvo', '50');
  const lotes = db.prepare(`SELECT l.numero, l.data, lp.qtd_produzida, lp.custo_unitario, lp.qtd_restante, l.origem
    FROM lotes_produtos lp JOIN lotes l ON l.id=lp.lote_id WHERE lp.produto_codigo=? ORDER BY l.id DESC LIMIT 30`).all(p.codigo);
  const historico = db.prepare('SELECT * FROM custo_historico WHERE produto_codigo=? ORDER BY id DESC LIMIT 40').all(p.codigo);
  const perfil = db.prepare('SELECT * FROM producao_rendimento_perfil WHERE produto_codigo=?').get(p.codigo) || null;
  res.json({ ...cons, formacao_preco: { margem_alvo: margemAlvo, preco_sugerido: precoSugerido(cons.custo_vigente, margemAlvo),
    diferenca_preco_atual: cons.preco_venda ? r2((precoSugerido(cons.custo_vigente, margemAlvo) || 0) - cons.preco_venda) : null },
    lotes, historico_custo: historico, rendimento_perfil: perfil });
});

// ── FORMAÇÃO DE PREÇO (sugere preço por margem-alvo; ou margem a partir de um preço) ──
app.get('/api/custos/formacao-preco', (req, res) => {
  const cod = req.query.codigo, margem = req.query.margem != null ? +req.query.margem : +getConfig('custo_margem_alvo', '50');
  const p = cod ? db.prepare('SELECT codigo,nome,precoVenda,precoCompra,estoque FROM produtos WHERE codigo=?').get(cod) : null;
  if (cod && !p) return res.status(404).json({ erro: 'Produto não encontrado.' });
  let custo = req.query.custo != null ? +req.query.custo : null;
  const cons = p ? custoProdutoConsolidado(p) : null;
  if (custo == null && cons) custo = cons.custo_vigente;
  const sugerido = precoSugerido(custo, margem);
  const precoAtual = cons ? cons.preco_venda : (req.query.preco != null ? +req.query.preco : 0);
  res.json({ codigo: cod || null, nome: p ? p.nome : null, custo: custo != null ? r2(custo) : null, margem_alvo: margem,
    preco_sugerido: sugerido, markup: sugerido && custo > 0 ? r2(sugerido / custo) : null,
    preco_atual: precoAtual, margem_atual: margemDe(precoAtual, custo), diferenca: sugerido && precoAtual ? r2(sugerido - precoAtual) : null });
});

// ── LUCRO BRUTO por venda | produto | dia (lê lotes_consumo — custo REAL FIFO) ──
app.get('/api/custos/lucro-bruto', (req, res) => {
  const fx = faixaPeriodo(req.query), wc = wherePeriodo('lc.criado_em', fx), group = req.query.group || 'produto';
  const wrap = (rows) => rows.map(x => { const receita = r2(x.receita), custo = r2(x.custo), lucro = r2(receita - custo);
    return { ...x, receita, custo, lucro, margem: receita > 0 ? r2(lucro / receita * 100) : 0 }; });
  let dados;
  if (group === 'venda') dados = wrap(db.prepare(`SELECT lc.venda_id, MAX(v.numero) numero, MAX(v.criado_em) data, SUM(lc.qtd*lc.preco_unitario) receita, SUM(lc.custo_total) custo
    FROM lotes_consumo lc LEFT JOIN vendas v ON v.id=lc.venda_id WHERE 1=1${wc.clause} GROUP BY lc.venda_id ORDER BY lc.venda_id DESC LIMIT 500`, ).all(...wc.args));
  else if (group === 'dia') dados = wrap(db.prepare(`SELECT date(lc.criado_em,'localtime') dia, SUM(lc.qtd*lc.preco_unitario) receita, SUM(lc.custo_total) custo
    FROM lotes_consumo lc WHERE 1=1${wc.clause} GROUP BY date(lc.criado_em,'localtime') ORDER BY dia DESC LIMIT 120`).all(...wc.args));
  else dados = wrap(db.prepare(`SELECT lc.produto_codigo cod, MAX(lp.nome) nome, SUM(lc.qtd) qtd, SUM(lc.qtd*lc.preco_unitario) receita, SUM(lc.custo_total) custo
    FROM lotes_consumo lc JOIN lotes_produtos lp ON lp.id=lc.lote_produto_id WHERE 1=1${wc.clause} GROUP BY lc.produto_codigo ORDER BY (SUM(lc.qtd*lc.preco_unitario)-SUM(lc.custo_total)) DESC LIMIT 200`).all(...wc.args));
  const tot = db.prepare(`SELECT COALESCE(SUM(lc.qtd*lc.preco_unitario),0) receita, COALESCE(SUM(lc.custo_total),0) custo FROM lotes_consumo lc WHERE 1=1${wc.clause}`).get(...wc.args);
  const receita = r2(tot.receita), custo = r2(tot.custo), lucro = r2(receita - custo);
  res.json({ periodo: fx, group, dados, total: { receita, custo, lucro, margem: receita > 0 ? r2(lucro / receita * 100) : 0 } });
});

// ── HISTÓRICO DE CUSTO ──
app.get('/api/custos/custo-historico', (req, res) => {
  const cod = req.query.codigo;
  const sql = cod ? 'SELECT * FROM custo_historico WHERE produto_codigo=? ORDER BY id DESC LIMIT 200' : 'SELECT * FROM custo_historico ORDER BY id DESC LIMIT 200';
  res.json(cod ? db.prepare(sql).all(cod) : db.prepare(sql).all());
});

// ── RESERVADO: perfil de rendimento da produção (SÓ armazena — sem efeito na produção ainda) ──
app.get('/api/custos/rendimento-perfil', (req, res) => res.json(db.prepare('SELECT rp.*, p.nome produto_nome FROM producao_rendimento_perfil rp LEFT JOIN produtos p ON p.codigo=rp.produto_codigo ORDER BY rp.id DESC').all()));
app.get('/api/custos/rendimento-perfil/:codigo', (req, res) => res.json(db.prepare('SELECT * FROM producao_rendimento_perfil WHERE produto_codigo=?').get(req.params.codigo) || { produto_codigo: req.params.codigo, rendimento_esperado: null, fator_rateio: null, custo_alvo: null, unidade: 'kg', ativo: 0, obs: '' }));
app.put('/api/custos/rendimento-perfil/:codigo', (req, res) => {
  if (!gateCustos(req, res)) return;
  const cod = req.params.codigo, d = req.body || {}, agora = new Date().toISOString();
  if (!db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(cod)) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const ex = db.prepare('SELECT id FROM producao_rendimento_perfil WHERE produto_codigo=?').get(cod);
  if (ex) db.prepare('UPDATE producao_rendimento_perfil SET rendimento_esperado=?, fator_rateio=?, custo_alvo=?, unidade=?, ativo=?, obs=?, atualizado_em=? WHERE produto_codigo=?')
    .run(+d.rendimento_esperado || null, +d.fator_rateio || null, +d.custo_alvo || null, d.unidade || 'kg', d.ativo ? 1 : 0, d.obs || '', agora, cod);
  else db.prepare('INSERT INTO producao_rendimento_perfil (produto_codigo,rendimento_esperado,fator_rateio,custo_alvo,unidade,ativo,obs,atualizado_em,criado_em) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(cod, +d.rendimento_esperado || null, +d.fator_rateio || null, +d.custo_alvo || null, d.unidade || 'kg', d.ativo ? 1 : 0, d.obs || '', agora, agora);
  res.json({ ok: true, reservado: true, aviso: 'Estrutura preparada — ainda NÃO afeta a produção (rateio avançado é fase futura).' });
});

// ── CONFIG de custo (método vigente + margem-alvo padrão) ──
app.get('/api/custos/config-custo', (req, res) => res.json({ metodo: getConfig('custo_metodo_padrao', 'real'), margem_alvo: +getConfig('custo_margem_alvo', '50') }));
app.post('/api/custos/config-custo', (req, res) => {
  if (!gateCustos(req, res)) return;
  const d = req.body || {};
  if (d.metodo && ['real', 'medio', 'ultima'].includes(d.metodo)) setConfig('custo_metodo_padrao', d.metodo);
  if (d.margem_alvo != null) setConfig('custo_margem_alvo', String(+d.margem_alvo || 0));
  res.json({ ok: true, metodo: getConfig('custo_metodo_padrao', 'real'), margem_alvo: +getConfig('custo_margem_alvo', '50') });
});

/* ══════════════════════════════════════════════════════════════════════════
   FASE 36 — CONSOLIDAÇÃO DA PLATAFORMA + PREPARAÇÃO P/ MÓDULOS AVANÇADOS
   ─────────────────────────────────────────────────────────────────────────
   NÃO é módulo de feature novo: (1) um REGISTRO de módulos (`modulos_sistema`)
   que cataloga o que já existe (status 'ativo') e deixa preparados os 4 módulos
   futuros (status 'planejado': Financeiro Premium, Produção Avançada, CRM/
   Fidelidade Avançado, IA/Automação) + config reservada (desligada) — pra
   quando chegarem não precisar refazer nada; (2) um check de SAÚDE/CONSISTÊNCIA
   que LÊ os dados existentes e confere os invariantes entre as fases 33/34/35
   (não grava nada, não duplica). ══════════════════════════════════════════ */
db.exec(`CREATE TABLE IF NOT EXISTS modulos_sistema (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT UNIQUE, nome TEXT, icone TEXT, categoria TEXT,
  status TEXT DEFAULT 'ativo', fase TEXT, descricao TEXT, requer_perfil TEXT, ordem INTEGER DEFAULT 0,
  criado_em TEXT, atualizado_em TEXT
)`);
(function seedModulos() {
  const ins = db.prepare(`INSERT OR IGNORE INTO modulos_sistema (chave,nome,icone,categoria,status,fase,descricao,requer_perfil,ordem,criado_em,atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const agora = new Date().toISOString();
  const M = [
    // ── ATIVOS (o que já existe) ──
    ['pdv', 'Vendas (PDV)', '🛒', 'operacao', 'ativo', '6', 'Frente de caixa, recebimento e cupom.', 'operador', 10],
    ['delivery', 'Delivery', '🛵', 'operacao', 'ativo', '5', 'Pedidos, board e expedição.', 'operador', 20],
    ['producao', 'Produção', '🏭', 'operacao', 'ativo', '28', 'Central de produção e impressão de comandas.', 'operador', 30],
    ['atendimento', 'Atendimento', '💬', 'operacao', 'ativo', '15', 'Central de atendimento (WhatsApp) + IA.', 'operador', 40],
    ['estoque', 'Estoque', '📦', 'operacao', 'ativo', '9', 'Movimentações e alertas de estoque.', 'operador', 50],
    ['cadastro', 'Cadastro Mestre', '📋', 'operacao', 'ativo', '32', 'Cadastro profissional de produtos/insumos/embalagens.', 'supervisor', 60],
    ['clientes', 'Clientes & CRM', '👥', 'operacao', 'ativo', '18/24', 'Cadastro unificado, fiado e fidelidade.', 'operador', 70],
    ['financeiro', 'Financeiro & Fluxo de Caixa', '💵', 'financeiro', 'ativo', '25/29', 'Núcleo financeiro, movimentações e fluxo.', 'operador', 80],
    ['fechamento', 'Fechamento de Caixa', '🧮', 'financeiro', 'ativo', '27', 'Sessões de caixa e conciliação.', 'operador', 90],
    ['contas_pagar', 'Contas a Pagar', '📌', 'financeiro', 'ativo', '26', 'Obrigações a fornecedores, integrada às compras.', 'supervisor', 100],
    ['contas_receber', 'Contas a Receber', '📥', 'financeiro', 'ativo', '33', 'Títulos, cobranças e inadimplência do fiado.', 'supervisor', 110],
    ['compras', 'Compras Profissionais', '🛒', 'financeiro', 'ativo', '31/34', 'Solicitação→cotação→pedido→recebimento→custo.', 'supervisor', 120],
    ['custos', 'Custos & Rentabilidade', '📊', 'gestao', 'ativo', '30/35', 'Custo real/médio, formação de preço e lucro bruto.', 'supervisor', 130],
    ['bi', 'Gestão / BI', '📈', 'gestao', 'ativo', '25', 'Relatórios e indicadores de gestão.', 'supervisor', 140],
    // ── PLANEJADOS (preparados, sem lógica ainda) ──
    ['financeiro_premium', 'Financeiro Premium', '💎', 'futuro', 'planejado', '—', 'DRE, conciliação bancária, boletos e PIX de cobrança. Estende o núcleo financeiro e Contas a Receber/Pagar.', 'admin', 200],
    ['producao_avancada', 'Produção Avançada', '🏭', 'futuro', 'planejado', '—', 'Rateio inteligente por rendimento (custo específico por produto). Lê a estrutura reservada `producao_rendimento_perfil` (Fase 35).', 'supervisor', 210],
    ['crm_fidelidade', 'CRM & Fidelidade Avançado', '🎯', 'futuro', 'planejado', '—', 'Segmentação, campanhas e régua de relacionamento. Estende Clientes/Fidelidade (Fase 24).', 'supervisor', 220],
    ['ia_automacao', 'IA & Automação', '🤖', 'futuro', 'planejado', '—', 'Cobrança automática, atendimento e insights por IA. Usa a régua (Fase 33) e o atendimento (Fase 15).', 'admin', 230],
  ];
  for (const m of M) ins.run(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], agora, agora);
  // Config RESERVADA (desligada) por módulo futuro — pra ligar sem refazer schema quando a fase chegar.
  for (const k of ['modulo_financeiro_premium', 'modulo_producao_avancada', 'modulo_crm_fidelidade', 'modulo_ia_automacao'])
    if (getConfig(k, null) == null) setConfig(k, '0');
})();

const moduloFront = (m) => ({ chave: m.chave, nome: m.nome, icone: m.icone, categoria: m.categoria, status: m.status, fase: m.fase, descricao: m.descricao, requer_perfil: m.requer_perfil, ordem: m.ordem });
app.get('/api/modulos', (req, res) => {
  const todos = db.prepare('SELECT * FROM modulos_sistema ORDER BY ordem, id').all().map(moduloFront);
  const flags = { financeiro_premium: getConfig('modulo_financeiro_premium', '0') === '1', producao_avancada: getConfig('modulo_producao_avancada', '0') === '1',
    crm_fidelidade: getConfig('modulo_crm_fidelidade', '0') === '1', ia_automacao: getConfig('modulo_ia_automacao', '0') === '1' };
  res.json({ ativos: todos.filter(m => m.status === 'ativo'), planejados: todos.filter(m => m.status === 'planejado').map(m => ({ ...m, habilitado: !!flags[m.chave] })),
    resumo: { ativos: todos.filter(m => m.status === 'ativo').length, planejados: todos.filter(m => m.status === 'planejado').length } });
});
app.get('/api/modulos/:chave', (req, res) => {
  const m = db.prepare('SELECT * FROM modulos_sistema WHERE chave=?').get(req.params.chave);
  m ? res.json(moduloFront(m)) : res.status(404).json({ erro: 'Módulo não encontrado.' });
});

// ── SAÚDE / CONSISTÊNCIA DO ERP (só leitura — confere invariantes entre módulos) ──
// Fase 37: extraído p/ função reutilizável (endpoint + verificação no boot).
function consistenciaERP() {
    const checks = [];
    const add = (chave, titulo, ok, valor, detalhe) => checks.push({ chave, titulo, status: ok ? 'ok' : 'alerta', valor, detalhe });
    // 1) Contas a Receber (Fase 33) == saldo de fiado (mesma fonte: clientes_extrato)
    const saldos = db.prepare("SELECT cliente_id, SUM(CASE WHEN tipo='compra' THEN valor ELSE -valor END) s FROM clientes_extrato GROUP BY cliente_id").all();
    const fiadoAberto = r2(saldos.reduce((a, x) => a + (x.s > 0.005 ? x.s : 0), 0));
    const negativos = saldos.filter(x => x.s < -0.005).length; // clientes com crédito a favor (anomalia p/ conferir)
    add('receber_fiado', 'Contas a Receber = saldo de fiado', true, fmtBRLc(fiadoAberto), `Fiado em aberto: ${fmtBRLc(fiadoAberto)}${negativos ? ` · ${negativos} cliente(s) com saldo negativo (adiantado)` : ''}`);
    // 2) Movimentos financeiros com referência órfã (documento de origem inexistente)
    let orfaos = 0;
    orfaos += db.prepare("SELECT COUNT(*) n FROM financeiro_movimentos m WHERE m.referencia_tipo='venda' AND NOT EXISTS (SELECT 1 FROM vendas v WHERE v.id=CAST(m.referencia_id AS INTEGER))").get().n;
    orfaos += db.prepare("SELECT COUNT(*) n FROM financeiro_movimentos m WHERE m.referencia_tipo='pedido' AND NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.id=CAST(m.referencia_id AS INTEGER))").get().n;
    orfaos += db.prepare("SELECT COUNT(*) n FROM financeiro_movimentos m WHERE m.referencia_tipo='extrato' AND NOT EXISTS (SELECT 1 FROM clientes_extrato e WHERE e.id=CAST(m.referencia_id AS INTEGER))").get().n;
    add('financeiro_orfaos', 'Movimentos financeiros sem documento de origem', orfaos === 0, orfaos, orfaos === 0 ? 'Todos os movimentos automáticos têm origem válida.' : `${orfaos} movimento(s) com referência órfã.`);
    // 3) Produtos sem custo apurável (Fase 35)
    const prods = db.prepare('SELECT codigo,precoVenda,precoCompra FROM produtos').all();
    const semCusto = prods.filter(p => { const cm = custoMedioPonderado(p.codigo), cr = custoRealMedio(p.codigo); return cm == null && cr == null && !(+p.precoCompra > 0); }).length;
    add('produtos_sem_custo', 'Produtos com custo cadastrado', semCusto === 0, `${prods.length - semCusto}/${prods.length}`, semCusto === 0 ? 'Todos os produtos têm custo (lote, FIFO ou última compra).' : `${semCusto} produto(s) sem nenhuma base de custo.`);
    // 4) Recebimentos integrados sem lote de custo (Fase 34↔30) — só conta os que têm item cadastrado
    const recSemLote = db.prepare(`SELECT COUNT(*) n FROM cp_recebimentos r WHERE r.integrado=1 AND NOT EXISTS (SELECT 1 FROM lotes l WHERE l.recebimento_id=r.id)
      AND EXISTS (SELECT 1 FROM cp_recebimentos_itens i JOIN produtos p ON p.codigo=i.produto_codigo WHERE i.recebimento_id=r.id AND i.qtd_recebida>0)`).get().n;
    add('recebimento_lote', 'Recebimentos integrados com lote de custo', recSemLote === 0, recSemLote, recSemLote === 0 ? 'Todo recebimento aprovado gerou seu lote de custo.' : `${recSemLote} recebimento(s) aprovados sem lote.`);
    // 5) Recebimentos integrados sem conta a pagar (Fase 34↔26)
    const recSemConta = db.prepare(`SELECT COUNT(*) n FROM cp_recebimentos r WHERE r.integrado=1 AND NOT EXISTS (SELECT 1 FROM contas_pagar c WHERE c.recebimento_id=r.id)
      AND EXISTS (SELECT 1 FROM cp_recebimentos_itens i JOIN cp_pedidos_itens pi ON pi.id=i.pedido_item_id WHERE i.recebimento_id=r.id AND i.qtd_recebida>0 AND pi.valor_unitario>0)`).get().n;
    add('recebimento_conta', 'Recebimentos integrados com conta a pagar', recSemConta === 0, recSemConta, recSemConta === 0 ? 'Todo recebimento com valor gerou conta a pagar.' : `${recSemConta} recebimento(s) sem conta a pagar.`);
  const alertas = checks.filter(c => c.status === 'alerta').length;
  return { status_geral: alertas === 0 ? 'ok' : 'alerta', alertas, checks, verificado_em: new Date().toISOString() };
}
app.get('/api/erp/consistencia', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  try { res.json(consistenciaERP()); } catch (e) { res.status(500).json({ erro: e.message }); }
});
function fmtBRLc(v) { return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ','); }

// ── Fase 37: manutenção do banco (admin) — checkpoint WAL + otimização + integridade ──
app.get('/api/manutencao/otimizar', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  const out = {};
  try {
    try { out.wal_checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(); } catch (e) { out.wal_checkpoint = { erro: e.message }; }
    try { db.exec('PRAGMA optimize'); out.optimize = 'ok'; } catch (e) { out.optimize = e.message; }
    try { db.exec('ANALYZE'); out.analyze = 'ok'; } catch (e) { out.analyze = e.message; }
    try { out.integridade = db.prepare('PRAGMA integrity_check').get(); } catch (e) { out.integridade = { erro: e.message }; }
    out.schema_versao = SCHEMA_VERSAO;
    out.migracoes = db.prepare('SELECT COUNT(*) n FROM schema_migracoes').get().n;
    manut.logAcao('otimização do banco', 'manutencao', { por: (req.usuario || {}).usuario }, 'operacao');
    res.json({ ok: true, ...out });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});
// Info de saúde/versão (leve) — pra tela mostrar sem rodar o check pesado
app.get('/api/manutencao/info', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  res.json({ schema_versao: SCHEMA_VERSAO, migracoes: db.prepare('SELECT chave,aplicada_em FROM schema_migracoes ORDER BY id').all(),
    journal_mode: (db.prepare('PRAGMA journal_mode').get() || {}).journal_mode, indices: db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index'").get().n });
});

// ── Atualização do sistema (só admin) — Administração → Atualizações ──
app.get('/api/atualizacao/status', async (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  try { res.json(await atualizacao.status()); } catch (e) { res.status(500).json({ erro: e.message }); }
});
app.post('/api/atualizacao/conectar', async (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  try { res.json(await atualizacao.conectar()); } catch (e) { res.status(500).json({ erro: e.message }); }
});
app.post('/api/atualizacao/verificar', async (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  try { res.json(await atualizacao.verificar()); } catch (e) { res.status(500).json({ erro: e.message }); }
});
app.post('/api/atualizacao/aplicar', async (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  try { res.json(await atualizacao.aplicar((req.usuario || {}).usuario || (req.usuario || {}).nome || '')); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});
app.get('/api/atualizacao/historico', (req, res) => {
  if (!gateFinAdmin(req, res)) return;
  res.json(atualizacao.historico());
});

/* ══════════════════════════════════════════════════════════════════════════
   FASE 38 — PRODUÇÃO AVANÇADA (arquitetura genérica, PREPARAÇÃO)
   ─────────────────────────────────────────────────────────────────────────
   Constrói a base para a produção baseada em RENDIMENTO: PERFIS (1 matéria-prima
   → N produtos, com pesos/percentuais/método de rateio), ORDENS de produção
   (histórico + rastreabilidade por lote) e um SIMULADOR de rateio (puro). É
   GENÉRICA e PARAMETRIZÁVEL — NÃO implementa o modelo específico do Açaí do
   Centro nem integra estoque/custo/financeiro ainda. A produção antiga
   (`/api/producoes`, Fase 19) fica 100% intacta. Reusa a matemática de rateio
   ponderado da Fase 30 (ratearLote) e a estrutura reservada da Fase 35
   (producao_rendimento_perfil). A ATIVAÇÃO (baixa de estoque + geração de lote
   FIFO + lançamento financeiro ao concluir) é a fase futura. ══════════════ */
migrar('fase38_producao_avancada', () => {
  db.exec(`CREATE TABLE IF NOT EXISTS producao_perfis (
    id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT, nome TEXT NOT NULL,
    materia_tipo TEXT, materia_ref TEXT, materia_nome TEXT, materia_unidade TEXT,
    rendimento_esperado REAL, rendimento_unidade TEXT, metodo_rateio TEXT DEFAULT 'peso',
    ativo INTEGER DEFAULT 1, obs TEXT, criado_em TEXT, atualizado_em TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS producao_perfis_saidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, perfil_id INTEGER NOT NULL, produto_codigo TEXT, nome TEXT,
    peso_rateio REAL DEFAULT 1, percentual REAL, rendimento_esperado REAL, unidade TEXT, ordem INTEGER DEFAULT 0)`);
  db.exec(`CREATE TABLE IF NOT EXISTS producao_ordens (
    id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, perfil_id INTEGER, data TEXT,
    status TEXT DEFAULT 'rascunho', materia_qtd REAL, materia_custo_unitario REAL, materia_custo_total REAL,
    custo_total REAL, rendimento_real REAL, lote_id INTEGER, integrado INTEGER DEFAULT 0,
    operador TEXT, obs TEXT, criado_em TEXT, atualizado_em TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS producao_ordens_saidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ordem_id INTEGER NOT NULL, produto_codigo TEXT, nome TEXT,
    qtd_prevista REAL, qtd_produzida REAL, peso_rateio REAL, custo_unitario_resultante REAL, subtotal_resultante REAL, lote_produto_id INTEGER)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_pperfis_saidas ON producao_perfis_saidas(perfil_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_pordens_perfil ON producao_ordens(perfil_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_pordens_saidas ON producao_ordens_saidas(ordem_id)');
});
// Parâmetros (reservados/desligados — a integração automática é a ativação futura)
(function seedProducaoConfig() {
  const padrao = { producao_avancada_ativa: '0', producao_metodo_rateio_padrao: 'peso', producao_gera_lote_ao_concluir: '0' };
  for (const [k, v] of Object.entries(padrao)) if (getConfig(k, null) == null) setConfig(k, v);
})();
// Fase 39: alinha com a DECISÃO oficial (produção por LOTE) — o lote guarda o fornecedor das sacas.
// (rendimento é MEDIDO no fim, nunca fixo; custo médio/litro é FLAT; custo por tipo fica p/ depois.)
migrar('fase39_ordem_fornecedor', () => { try { db.exec('ALTER TABLE producao_ordens ADD COLUMN fornecedor_id INTEGER'); } catch {} });

const METODOS_RATEIO = ['peso', 'percentual', 'custo_alvo', 'manual'];
// Métricas FLAT de um lote de produção (decisão oficial): litros totais, rendimento médio/saca, custo médio/litro.
function metricasLoteProducao(o) {
  const litros = r2(db.prepare('SELECT COALESCE(SUM(qtd_produzida),0) q FROM producao_ordens_saidas WHERE ordem_id=?').get(o.id).q);
  return { litros_totais: litros, rendimento_medio_saca: (o.materia_qtd > 0 ? r2(litros / o.materia_qtd) : null),
    custo_medio_litro: (litros > 0 ? r2((+o.materia_custo_total || 0) / litros) : null) };
}
function perfilProducaoCompleto(id) {
  const p = db.prepare('SELECT * FROM producao_perfis WHERE id=?').get(id);
  if (!p) return null;
  p.saidas = db.prepare('SELECT * FROM producao_perfis_saidas WHERE perfil_id=? ORDER BY ordem, id').all(id);
  return p;
}
/* SIMULADOR DE RATEIO — PURO (não grava, não integra). Distribui o custo da
   matéria-prima entre os produtos de saída. Genérico por método; o 'peso' usa a
   MESMA fórmula da Fase 30: custo_unit_j = valor * peso_j / Σ(peso_i · qtd_i). */
function simularRateioProducao(saidas, materiaCustoTotal, metodo, materiaQtd) {
  const valor = +materiaCustoTotal || 0;
  const linhas = saidas.map(s => {
    const qtd = s.qtd != null ? (+s.qtd || 0) : (+s.rendimento_esperado || 0) * (+materiaQtd || 0);
    return { produto_codigo: s.produto_codigo || null, nome: s.nome || s.produto_codigo || '', qtd: r2(qtd),
      peso_rateio: +s.peso_rateio || 1, percentual: s.percentual != null ? +s.percentual : null };
  });
  const totalQtd = linhas.reduce((a, l) => a + l.qtd, 0);
  if (metodo === 'percentual') {
    for (const l of linhas) { const share = valor * ((l.percentual || 0) / 100); l.custo_total = r2(share); l.custo_unitario = l.qtd > 0 ? r2(share / l.qtd) : 0; }
  } else { // 'peso' (padrão) e fallback dos demais → rateio ponderado por peso×qtd
    const denom = linhas.reduce((a, l) => a + (l.peso_rateio || 1) * l.qtd, 0);
    for (const l of linhas) { l.custo_unitario = denom > 0 ? r2(valor * (l.peso_rateio || 1) / denom) : 0; l.custo_total = r2(l.custo_unitario * l.qtd); }
  }
  const custoDistribuido = r2(linhas.reduce((a, l) => a + (l.custo_total || 0), 0));
  return { metodo: metodo || 'peso', materia_custo_total: r2(valor), total_qtd: r2(totalQtd), linhas,
    custo_distribuido: custoDistribuido, diferenca: r2(valor - custoDistribuido) };
}
function numeroOrdemProducao() { const n = db.prepare('SELECT COUNT(*) c FROM producao_ordens').get().c + 1; return 'OP' + String(n).padStart(4, '0'); }
const gateProducao = (req, res) => gateFinLancar(req, res); // gestor (admin/supervisor)

// ── PERFIS ──
app.get('/api/producao-avancada/perfis', (req, res) => res.json(db.prepare('SELECT p.*, (SELECT COUNT(*) FROM producao_perfis_saidas s WHERE s.perfil_id=p.id) saidas FROM producao_perfis p ORDER BY p.ativo DESC, p.nome').all()));
app.get('/api/producao-avancada/perfis/:id', (req, res) => { const p = perfilProducaoCompleto(+req.params.id); p ? res.json(p) : res.status(404).json({ erro: 'Perfil não encontrado.' }); });
app.post('/api/producao-avancada/perfis', (req, res) => {
  if (!gateProducao(req, res)) return;
  const d = req.body || {}; if (!d.nome) return res.status(400).json({ erro: 'Informe o nome do perfil.' });
  const agora = new Date().toISOString();
  const metodo = METODOS_RATEIO.includes(d.metodo_rateio) ? d.metodo_rateio : getConfig('producao_metodo_rateio_padrao', 'peso');
  const info = db.prepare(`INSERT INTO producao_perfis (chave,nome,materia_tipo,materia_ref,materia_nome,materia_unidade,rendimento_esperado,rendimento_unidade,metodo_rateio,ativo,obs,criado_em,atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.chave || null, d.nome, d.materia_tipo || 'materia', d.materia_ref || null, d.materia_nome || '', d.materia_unidade || 'kg',
    +d.rendimento_esperado || null, d.rendimento_unidade || d.materia_unidade || 'kg', metodo, d.ativo === false ? 0 : 1, d.obs || '', agora, agora);
  const pid = info.lastInsertRowid;
  salvarSaidasPerfil(pid, d.saidas);
  manut.logAcao('perfil de produção criado', 'producao', { id: pid, nome: d.nome }, 'operacao');
  res.json(perfilProducaoCompleto(pid));
});
function salvarSaidasPerfil(perfilId, saidas) {
  if (!Array.isArray(saidas)) return;
  db.prepare('DELETE FROM producao_perfis_saidas WHERE perfil_id=?').run(perfilId);
  const ins = db.prepare('INSERT INTO producao_perfis_saidas (perfil_id,produto_codigo,nome,peso_rateio,percentual,rendimento_esperado,unidade,ordem) VALUES (?,?,?,?,?,?,?,?)');
  saidas.forEach((s, i) => { if (!(s.produto_codigo || s.nome)) return;
    const prod = s.produto_codigo ? db.prepare('SELECT nome FROM produtos WHERE codigo=?').get(s.produto_codigo) : null;
    ins.run(perfilId, s.produto_codigo || null, s.nome || (prod && prod.nome) || s.produto_codigo || '', +s.peso_rateio || 1, s.percentual != null ? +s.percentual : null, +s.rendimento_esperado || null, s.unidade || '', +s.ordem || i); });
}
app.put('/api/producao-avancada/perfis/:id', (req, res) => {
  if (!gateProducao(req, res)) return;
  const id = +req.params.id, p = db.prepare('SELECT * FROM producao_perfis WHERE id=?').get(id);
  if (!p) return res.status(404).json({ erro: 'Perfil não encontrado.' });
  const d = req.body || {}, metodo = METODOS_RATEIO.includes(d.metodo_rateio) ? d.metodo_rateio : p.metodo_rateio;
  db.prepare(`UPDATE producao_perfis SET nome=?, materia_tipo=?, materia_ref=?, materia_nome=?, materia_unidade=?, rendimento_esperado=?, rendimento_unidade=?, metodo_rateio=?, ativo=?, obs=?, atualizado_em=? WHERE id=?`)
    .run(d.nome ?? p.nome, d.materia_tipo ?? p.materia_tipo, d.materia_ref ?? p.materia_ref, d.materia_nome ?? p.materia_nome, d.materia_unidade ?? p.materia_unidade,
      d.rendimento_esperado != null ? +d.rendimento_esperado : p.rendimento_esperado, d.rendimento_unidade ?? p.rendimento_unidade, metodo, d.ativo != null ? (d.ativo ? 1 : 0) : p.ativo, d.obs ?? p.obs, new Date().toISOString(), id);
  if (Array.isArray(d.saidas)) salvarSaidasPerfil(id, d.saidas);
  res.json(perfilProducaoCompleto(id));
});
app.delete('/api/producao-avancada/perfis/:id', (req, res) => {
  if (!gateProducao(req, res)) return;
  const id = +req.params.id;
  if (db.prepare('SELECT 1 FROM producao_ordens WHERE perfil_id=? LIMIT 1').get(id)) return res.status(400).json({ erro: 'Perfil já usado em ordens — desative em vez de excluir.' });
  db.prepare('DELETE FROM producao_perfis_saidas WHERE perfil_id=?').run(id);
  db.prepare('DELETE FROM producao_perfis WHERE id=?').run(id);
  res.json({ ok: true });
});
// SIMULAR (puro — não grava nem integra)
app.post('/api/producao-avancada/perfis/:id/simular', (req, res) => {
  const p = perfilProducaoCompleto(+req.params.id);
  if (!p) return res.status(404).json({ erro: 'Perfil não encontrado.' });
  const d = req.body || {}, materiaQtd = +d.materia_qtd || 0;
  const custoTotal = d.materia_custo_total != null ? +d.materia_custo_total : (materiaQtd * (+d.materia_custo_unitario || 0));
  // permite sobrepor a qtd de cada saída (senão usa rendimento_esperado × materia_qtd)
  const overrides = d.saidas_qtd || {};
  const saidas = p.saidas.map(s => ({ ...s, qtd: overrides[s.produto_codigo] != null ? +overrides[s.produto_codigo] : undefined }));
  res.json({ perfil: { id: p.id, nome: p.nome, metodo_rateio: p.metodo_rateio }, ...simularRateioProducao(saidas, custoTotal, p.metodo_rateio, materiaQtd) });
});

// ── ORDENS DE PRODUÇÃO (histórico + rastreabilidade — REGISTRO, sem integrar estoque/custo/financeiro) ──
const SELECT_ORDEM = `SELECT o.*, p.nome perfil_nome, f.nome fornecedor_nome FROM producao_ordens o LEFT JOIN producao_perfis p ON p.id=o.perfil_id LEFT JOIN fornecedores f ON f.id=o.fornecedor_id`;
app.get('/api/producao-avancada/ordens', (req, res) => {
  const q = req.query || {}; let sql = SELECT_ORDEM + ' WHERE 1=1'; const args = [];
  if (q.status) { sql += ' AND o.status=?'; args.push(q.status); }
  if (q.perfil_id) { sql += ' AND o.perfil_id=?'; args.push(+q.perfil_id); }
  sql += ' ORDER BY o.id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...args));
});
app.get('/api/producao-avancada/ordens/:id', (req, res) => {
  const o = db.prepare(SELECT_ORDEM + ' WHERE o.id=?').get(+req.params.id);
  if (!o) return res.status(404).json({ erro: 'Ordem não encontrada.' });
  o.saidas = db.prepare('SELECT * FROM producao_ordens_saidas WHERE ordem_id=? ORDER BY id').all(o.id);
  o.metricas = metricasLoteProducao(o); // Fase 39: litros totais + rendimento médio/saca + custo médio/litro (flat)
  res.json(o);
});
app.post('/api/producao-avancada/ordens', (req, res) => {
  if (!gateProducao(req, res)) return;
  const d = req.body || {}, perfil = d.perfil_id ? perfilProducaoCompleto(+d.perfil_id) : null;
  if (!perfil) return res.status(400).json({ erro: 'Perfil de produção é obrigatório.' });
  const materiaQtd = +d.materia_qtd || 0, materiaCustoUnit = +d.materia_custo_unitario || 0;
  const materiaCustoTotal = d.materia_custo_total != null ? +d.materia_custo_total : r2(materiaQtd * materiaCustoUnit);
  const agora = new Date().toISOString(), numero = numeroOrdemProducao();
  const fornId = d.fornecedor_id ? +d.fornecedor_id : null; // Fase 39: fornecedor das sacas por lote
  const info = db.prepare(`INSERT INTO producao_ordens (numero,perfil_id,fornecedor_id,data,status,materia_qtd,materia_custo_unitario,materia_custo_total,custo_total,operador,obs,integrado,criado_em,atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(numero, perfil.id, fornId, d.data || agora, d.status === 'planejada' ? 'planejada' : 'rascunho', materiaQtd, materiaCustoUnit, materiaCustoTotal, materiaCustoTotal, (req.usuario || {}).nome || '', d.obs || '', agora, agora);
  const oid = info.lastInsertRowid;
  // snapshot das saídas previstas do perfil (qtd prevista = rendimento_esperado × materia_qtd)
  const ins = db.prepare('INSERT INTO producao_ordens_saidas (ordem_id,produto_codigo,nome,qtd_prevista,peso_rateio) VALUES (?,?,?,?,?)');
  for (const s of perfil.saidas) ins.run(oid, s.produto_codigo, s.nome, r2((+s.rendimento_esperado || 0) * materiaQtd), +s.peso_rateio || 1);
  manut.logAcao('ordem de produção criada', 'producao', { id: oid, numero, perfil: perfil.nome }, 'operacao');
  res.json(db.prepare(SELECT_ORDEM + ' WHERE o.id=?').get(oid));
});
app.put('/api/producao-avancada/ordens/:id', (req, res) => {
  if (!gateProducao(req, res)) return;
  const id = +req.params.id, o = db.prepare('SELECT * FROM producao_ordens WHERE id=?').get(id);
  if (!o) return res.status(404).json({ erro: 'Ordem não encontrada.' });
  const d = req.body || {}, agora = new Date().toISOString();
  const status = ['rascunho', 'planejada', 'concluida', 'cancelada'].includes(d.status) ? d.status : o.status;
  // CONCLUIR = registra o resultado (qtd produzida + rateio de custo GENÉRICO como HISTÓRICO).
  // NÃO baixa estoque, NÃO gera lote FIFO, NÃO lança no financeiro (isso é a ativação futura,
  // gated por producao_gera_lote_ao_concluir='0'). É só registro/indicador nesta fase.
  if (status === 'concluida' && o.status !== 'concluida') {
    const perfil = perfilProducaoCompleto(o.perfil_id);
    const saidasBanco = db.prepare('SELECT * FROM producao_ordens_saidas WHERE ordem_id=? ORDER BY id').all(id);
    const prod = d.produzido || {}; // qtd produzida por saída (chave = produto_codigo OU id da linha)
    const entradaSim = saidasBanco.map(s => {
      const perfSaida = perfil ? (perfil.saidas.find(x => (x.produto_codigo && x.produto_codigo === s.produto_codigo) || x.nome === s.nome) || {}) : {};
      const qtdProd = (s.produto_codigo != null && prod[s.produto_codigo] != null) ? +prod[s.produto_codigo]
        : (prod[s.id] != null ? +prod[s.id] : (+s.qtd_prevista || 0));
      return { _id: s.id, produto_codigo: s.produto_codigo, nome: s.nome, peso_rateio: s.peso_rateio, percentual: perfSaida.percentual != null ? +perfSaida.percentual : null, qtd: qtdProd };
    });
    const sim = simularRateioProducao(entradaSim, o.materia_custo_total, perfil ? perfil.metodo_rateio : 'peso', o.materia_qtd);
    const totalProd = r2(sim.linhas.reduce((a, l) => a + l.qtd, 0));
    const upd = db.prepare('UPDATE producao_ordens_saidas SET qtd_produzida=?, custo_unitario_resultante=?, subtotal_resultante=? WHERE id=?');
    sim.linhas.forEach((l, i) => upd.run(l.qtd, l.custo_unitario, l.custo_total, entradaSim[i]._id));
    const rendimento = o.materia_qtd > 0 ? r2(totalProd / o.materia_qtd) : null;
    db.prepare('UPDATE producao_ordens SET status=?, rendimento_real=?, custo_total=?, obs=?, atualizado_em=? WHERE id=?')
      .run('concluida', rendimento, r2(o.materia_custo_total), d.obs ?? o.obs, agora, id);
    manut.logAcao('ordem de produção concluída (registro)', 'producao', { id, numero: o.numero, rendimento }, 'operacao');
  } else {
    db.prepare('UPDATE producao_ordens SET status=?, obs=?, atualizado_em=? WHERE id=?').run(status, d.obs ?? o.obs, agora, id);
  }
  const out = db.prepare(SELECT_ORDEM + ' WHERE o.id=?').get(id);
  out.saidas = db.prepare('SELECT * FROM producao_ordens_saidas WHERE ordem_id=? ORDER BY id').all(id);
  res.json(out);
});
app.delete('/api/producao-avancada/ordens/:id', (req, res) => {
  if (!gateProducao(req, res)) return;
  const id = +req.params.id;
  db.prepare('DELETE FROM producao_ordens_saidas WHERE ordem_id=?').run(id);
  db.prepare('DELETE FROM producao_ordens WHERE id=?').run(id);
  res.json({ ok: true });
});

// ── INDICADORES de rendimento (leitura das ordens concluídas) ──
app.get('/api/producao-avancada/indicadores', (req, res) => {
  const concl = db.prepare("SELECT o.*, p.nome perfil_nome, p.rendimento_esperado FROM producao_ordens o LEFT JOIN producao_perfis p ON p.id=o.perfil_id WHERE o.status='concluida'").all();
  const porPerfil = new Map();
  for (const o of concl) {
    const e = porPerfil.get(o.perfil_id) || { perfil: o.perfil_nome, ordens: 0, materia: 0, produzido: 0, esperado: o.rendimento_esperado || 0, custo: 0 };
    e.ordens++; e.materia = r2(e.materia + (+o.materia_qtd || 0)); e.custo = r2(e.custo + (+o.custo_total || 0));
    const tp = db.prepare('SELECT COALESCE(SUM(qtd_produzida),0) q FROM producao_ordens_saidas WHERE ordem_id=?').get(o.id).q;
    e.produzido = r2(e.produzido + tp); porPerfil.set(o.perfil_id, e);
  }
  const perfis = [...porPerfil.values()].map(e => ({ ...e, rendimento_medio: e.materia > 0 ? r2(e.produzido / e.materia) : null,
    eficiencia: (e.esperado > 0 && e.materia > 0) ? r2((e.produzido / e.materia) / e.esperado * 100) : null }));
  res.json({ total_ordens: concl.length, perfis,
    resumo: { materia_total: r2(perfis.reduce((a, p) => a + p.materia, 0)), produzido_total: r2(perfis.reduce((a, p) => a + p.produzido, 0)), custo_total: r2(perfis.reduce((a, p) => a + p.custo, 0)) } });
});

// ── CONFIG (parametrização) ──
app.get('/api/producao-avancada/config', (req, res) => res.json({
  ativa: getConfig('producao_avancada_ativa', '0') === '1', metodo_rateio_padrao: getConfig('producao_metodo_rateio_padrao', 'peso'),
  gera_lote_ao_concluir: getConfig('producao_gera_lote_ao_concluir', '0') === '1', metodos: METODOS_RATEIO }));
app.post('/api/producao-avancada/config', (req, res) => {
  if (!gateProducao(req, res)) return;
  const d = req.body || {};
  if (d.metodo_rateio_padrao && METODOS_RATEIO.includes(d.metodo_rateio_padrao)) setConfig('producao_metodo_rateio_padrao', d.metodo_rateio_padrao);
  // ativa / gera_lote ficam reservados (a integração automática é a fase futura) — aceitamos gravar a intenção
  if (d.ativa != null) setConfig('producao_avancada_ativa', d.ativa ? '1' : '0');
  if (d.gera_lote_ao_concluir != null) setConfig('producao_gera_lote_ao_concluir', d.gera_lote_ao_concluir ? '1' : '0');
  res.json({ ok: true, aviso: 'Parâmetros salvos. A execução automática do rateio (baixa de estoque/lote/financeiro) será ligada na fase de ativação.' });
});

/* ══════════════════════════════════════════════════════════════════════════
   COMPRAS PROFISSIONAIS · PEDIDOS AO FORNECEDOR (Fase 31). O ciclo completo:
   Solicitação → Cotação (escolhe vencedor) → Pedido → Recebimento → aprovação.
   O RECEBIMENTO APROVADO dispara as integrações (estoque + conta a pagar +
   custo/precoCompra), idempotente — sem contar o mesmo dinheiro/estoque 2x.
   Convive com a compra rápida da Fase 26 (tabelas próprias cp_*). Ver 46_*.md.
   ══════════════════════════════════════════════════════════════════════════ */
db.exec(`CREATE TABLE IF NOT EXISTS cp_solicitacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, solicitante TEXT, departamento TEXT, centro_custo_id INTEGER, prioridade TEXT, obs TEXT, status TEXT DEFAULT 'aberta', criado_em TEXT, criado_por TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS cp_solicitacoes_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, solicitacao_id INTEGER, produto_codigo TEXT, descricao TEXT, quantidade REAL)`);
db.exec(`CREATE TABLE IF NOT EXISTS cp_cotacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, solicitacao_id INTEGER, descricao TEXT, status TEXT DEFAULT 'aberta', vencedor_fornecedor_id INTEGER, criado_em TEXT, criado_por TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS cp_cotacoes_fornecedores (id INTEGER PRIMARY KEY AUTOINCREMENT, cotacao_id INTEGER, fornecedor_id INTEGER, valor REAL, prazo TEXT, frete REAL, obs TEXT, criado_em TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS cp_pedidos (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, fornecedor_id INTEGER, cotacao_id INTEGER, solicitacao_id INTEGER, data TEXT, prazo_entrega TEXT,
  forma_pagamento TEXT, conta_id INTEGER, centro_custo_id INTEGER, subtotal REAL, frete REAL, impostos REAL, desconto REAL, total REAL, status TEXT DEFAULT 'aberto', obs TEXT, criado_em TEXT, criado_por TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS cp_pedidos_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER, produto_codigo TEXT, descricao TEXT, quantidade REAL, valor_unitario REAL, valor_total REAL, qtd_recebida REAL DEFAULT 0)`);
db.exec(`CREATE TABLE IF NOT EXISTS cp_recebimentos (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER, data TEXT, conferente TEXT, status TEXT DEFAULT 'pendente', obs TEXT, fotos TEXT, integrado INTEGER DEFAULT 0, criado_em TEXT, criado_por TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS cp_recebimentos_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, recebimento_id INTEGER, pedido_item_id INTEGER, produto_codigo TEXT, qtd_pedida REAL, qtd_recebida REAL, diferenca REAL, lote TEXT, validade TEXT, qualidade TEXT, obs TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS cp_notas_fiscais (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER, numero TEXT, serie TEXT, emissao TEXT, chave TEXT, xml_ref TEXT, pdf_ref TEXT, obs TEXT, criado_em TEXT)`);

/* ══ FASE 34 — INTEGRAÇÃO COMPRAS ↔ ESTOQUE ↔ CUSTO(LOTES) ↔ FINANCEIRO ══
   O recebimento aprovado (Fase 31) passa a: (1) dar entrada no estoque [já fazia],
   (2) gerar um LOTE DE CUSTO (Fase 30) com custo DIRETO por linha do pedido —
   assim o FIFO de custo real enxerga as compras (base pro custo das sacas de açaí),
   (3) gerar CONTA A PAGAR proporcional ao que foi de fato recebido (não o total do
   pedido no 1º parcial). Tudo idempotente por recebimento — nunca conta 2x. ══ */
for (const col of ['recebimento_id INTEGER', 'origem TEXT']) { try { db.exec(`ALTER TABLE lotes ADD COLUMN ${col}`); } catch {} }
try { db.exec(`ALTER TABLE contas_pagar ADD COLUMN recebimento_id INTEGER`); } catch {}
db.exec('CREATE INDEX IF NOT EXISTS idx_lotes_receb ON lotes(recebimento_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_cp_receb ON contas_pagar(recebimento_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_cp_ped_itens ON cp_pedidos_itens(pedido_id)');
try { db.exec('ALTER TABLE contas_pagar ADD COLUMN pedido_compra_id INTEGER'); } catch {}

const gateCompras = (req, res) => gateFinLancar(req, res); // admin/supervisor (comprador) lançam
function numeroPedidoCompra() { const n = db.prepare("SELECT COUNT(*) c FROM cp_pedidos").get().c + 1; return 'PC' + String(n).padStart(4, '0'); }

// Conta a pagar do pedido (idempotente por pedido) — reusa a máquina de contas_pagar (Fase 26)
// Conta a pagar PROPORCIONAL ao recebido (Fase 34) — idempotente por recebimento.
// Cada recebimento gera sua própria obrigação com o valor efetivamente recebido,
// então recebimentos parciais somam certinho (nunca o total do pedido de uma vez).
function contaPagarDoRecebimento(rec, pedido, valorRecebido) {
  if (!(valorRecebido > 0)) return null;
  const existe = db.prepare('SELECT id FROM contas_pagar WHERE recebimento_id=?').get(rec.id);
  if (existe) return existe.id;
  const forn = pedido && pedido.fornecedor_id ? db.prepare('SELECT nome FROM fornecedores WHERE id=?').get(pedido.fornecedor_id) : null;
  const venc = (pedido && pedido.prazo_entrega) || new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const info = db.prepare(`INSERT INTO contas_pagar (fornecedor_id,pedido_compra_id,recebimento_id,categoria_id,centro_custo_id,descricao,valor_total,data_emissao,data_vencimento,status,obs,criado_em,criado_por)
     VALUES (?,?,?,?,?,?,?,?,?, 'aberto', ?,?,?)`).run(pedido ? pedido.fornecedor_id || null : null, pedido ? pedido.id : null, rec.id, catFinId('Compra'),
     pedido ? pedido.centro_custo_id || null : null, `Recebimento ${pedido ? pedido.numero : ''} #${rec.id}${forn ? ' · ' + forn.nome : ''}`,
     r2(valorRecebido), (rec.data || new Date().toISOString()).slice(0, 10), venc, (pedido && pedido.obs) || '', new Date().toISOString(), rec.criado_por || '');
  return info.lastInsertRowid;
}
// LOTE DE CUSTO a partir do recebimento (Fase 34 ↔ Fase 30) — idempotente por recebimento.
// Custo DIRETO por linha (valor_unitario do pedido), sem rateio: numa COMPRA o custo de
// cada item é conhecido. Lote nasce 'finalizado' → entra no FIFO (consumirLotesDaVenda).
function loteDoRecebimento(rec, pedido) {
  const existe = db.prepare('SELECT id FROM lotes WHERE recebimento_id=?').get(rec.id);
  if (existe) return existe.id;
  const itens = db.prepare('SELECT * FROM cp_recebimentos_itens WHERE recebimento_id=?').all(rec.id);
  const linhas = [];
  for (const it of itens) {
    const qtd = +it.qtd_recebida || 0; if (qtd <= 0) continue;
    if (!it.produto_codigo || !db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(it.produto_codigo)) continue;
    const pi = it.pedido_item_id ? db.prepare('SELECT valor_unitario FROM cp_pedidos_itens WHERE id=?').get(it.pedido_item_id) : null;
    const custoUnit = pi ? (+pi.valor_unitario || 0) : 0;
    const prod = db.prepare('SELECT nome, precoVenda FROM produtos WHERE codigo=?').get(it.produto_codigo);
    linhas.push({ codigo: it.produto_codigo, nome: (prod && prod.nome) || it.produto_codigo, qtd, custoUnit, preco_venda: (prod && +prod.precoVenda) || 0 });
  }
  if (!linhas.length) return null; // recebimento só de itens sem cadastro → sem lote de custo
  const agora = new Date().toISOString();
  const valorPago = r2(linhas.reduce((s, l) => s + l.qtd * l.custoUnit, 0));
  const numero = 'RC' + String(rec.id).padStart(4, '0');
  const info = db.prepare(`INSERT INTO lotes (numero,fornecedor_id,data,operador,valor_pago,qtd_recebida,unidade,nota_fiscal,conta_id,centro_custo_id,obs,status,origem,recebimento_id,criado_em,criado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'finalizado', 'recebimento', ?,?,?)`).run(numero, pedido ? pedido.fornecedor_id || null : null, (rec.data || agora).slice(0, 10),
     rec.criado_por || '', valorPago, r2(linhas.reduce((s, l) => s + l.qtd, 0)), 'un', pedido ? pedido.numero : '', pedido ? pedido.conta_id || null : null,
     pedido ? pedido.centro_custo_id || null : null, `Gerado do recebimento #${rec.id}`, rec.id, agora, rec.criado_por || '');
  const loteId = info.lastInsertRowid;
  const ins = db.prepare('INSERT INTO lotes_produtos (lote_id,produto_codigo,nome,qtd_produzida,peso_custo,custo_unitario,preco_venda,qtd_restante) VALUES (?,?,?,?,?,?,?,?)');
  for (const l of linhas) ins.run(loteId, l.codigo, l.nome, l.qtd, 1, r2(l.custoUnit), l.preco_venda, l.qtd); // custo DIRETO (não rateia)
  return loteId;
}
// RECEBIMENTO APROVADO → estoque + custo(lote) + conta a pagar proporcional (idempotente por recebimento)
function aprovarRecebimento(recId, usuario) {
  const rec = db.prepare('SELECT * FROM cp_recebimentos WHERE id=?').get(recId);
  if (!rec) throw new Error('recebimento não encontrado');
  if (rec.integrado) return { jaIntegrado: true };
  const pedido = db.prepare('SELECT * FROM cp_pedidos WHERE id=?').get(rec.pedido_id);
  const itens = db.prepare('SELECT * FROM cp_recebimentos_itens WHERE recebimento_id=?').all(recId);
  const agora = new Date().toISOString();
  let valorRecebido = 0;
  for (const it of itens) {
    const qtd = +it.qtd_recebida || 0; if (qtd <= 0) continue;
    // preço unitário do item do pedido (pra custo)
    const pi = it.pedido_item_id ? db.prepare('SELECT * FROM cp_pedidos_itens WHERE id=?').get(it.pedido_item_id) : null;
    const custoUnit = pi ? (+pi.valor_unitario || 0) : 0;
    valorRecebido += qtd * custoUnit;
    if (it.produto_codigo && db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(it.produto_codigo)) {
      registrarMovimento(it.produto_codigo, 'entrada', { quantidade: qtd, motivo: 'recebimento ' + (pedido ? pedido.numero : ''), referencia: 'recebimento#' + recId });
      if (custoUnit > 0) {
        const antes = +(db.prepare('SELECT precoCompra FROM produtos WHERE codigo=?').get(it.produto_codigo) || {}).precoCompra || 0;
        db.prepare('UPDATE produtos SET precoCompra=?, atualizado_em=? WHERE codigo=?').run(custoUnit, agora, it.produto_codigo);
        try { registrarCustoHistorico(it.produto_codigo, antes, custoUnit, 'compra', 'recebimento#' + recId, usuario); } catch {} // Fase 35: auditoria de custo
      }
    }
    if (pi) db.prepare('UPDATE cp_pedidos_itens SET qtd_recebida = qtd_recebida + ? WHERE id=?').run(qtd, pi.id);
  }
  // Fase 34: lote de custo (FIFO) + conta a pagar proporcional ao recebido — idempotentes por recebimento
  const loteId = loteDoRecebimento(rec, pedido);
  const contaId = contaPagarDoRecebimento(rec, pedido, valorRecebido);
  // status do pedido: recebido se tudo veio, senão parcial
  if (pedido) {
    const pend = db.prepare('SELECT COUNT(*) c FROM cp_pedidos_itens WHERE pedido_id=? AND qtd_recebida < quantidade - 0.0001').get(pedido.id).c;
    db.prepare('UPDATE cp_pedidos SET status=? WHERE id=?').run(pend > 0 ? 'parcial' : 'recebido', pedido.id);
  }
  db.prepare("UPDATE cp_recebimentos SET status='aprovado', integrado=1 WHERE id=?").run(recId);
  manut.logAcao('recebimento aprovado', 'compras', { recebimento: recId, pedido: pedido ? pedido.numero : null, conta_pagar: contaId, lote: loteId, valor: r2(valorRecebido), por: usuario }, 'operacao');
  return { ok: true, conta_pagar_id: contaId, lote_id: loteId, valor_recebido: r2(valorRecebido) };
}
// ESTORNO de recebimento (Fase 34) — desfaz estoque + lote + conta a pagar, se ainda for seguro.
function estornarRecebimento(recId, usuario) {
  const rec = db.prepare('SELECT * FROM cp_recebimentos WHERE id=?').get(recId);
  if (!rec) return { erro: 'Recebimento não encontrado.' };
  if (!rec.integrado || rec.status === 'estornado') return { erro: 'Recebimento não está integrado (nada a estornar).' };
  const pedido = db.prepare('SELECT * FROM cp_pedidos WHERE id=?').get(rec.pedido_id);
  // trava: conta a pagar já com pagamento? não estorna (mexeria em caixa já movimentado)
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE recebimento_id=?').get(recId);
  if (conta) {
    const pago = db.prepare("SELECT COALESCE(SUM(valor),0) v FROM contas_pagar_pagamentos WHERE conta_pagar_id=? AND (estornado IS NULL OR estornado=0)").get(conta.id).v;
    if (pago > 0.005) return { erro: 'A conta a pagar deste recebimento já teve pagamento. Estorne o pagamento antes.' };
  }
  // trava: lote de custo já consumido por venda (FIFO)? não estorna (afetaria custo de vendas fechadas)
  const lote = db.prepare('SELECT * FROM lotes WHERE recebimento_id=?').get(recId);
  if (lote) {
    const consumido = db.prepare(`SELECT COALESCE(SUM(qtd_vendida + qtd_perdida),0) q FROM lotes_produtos WHERE lote_id=?`).get(lote.id).q;
    if (consumido > 0.0001) return { erro: 'O lote de custo deste recebimento já foi consumido em vendas/perdas. Não é possível estornar.' };
  }
  const itens = db.prepare('SELECT * FROM cp_recebimentos_itens WHERE recebimento_id=?').all(recId);
  for (const it of itens) {
    const qtd = +it.qtd_recebida || 0; if (qtd <= 0) continue;
    if (it.produto_codigo && db.prepare('SELECT codigo FROM produtos WHERE codigo=?').get(it.produto_codigo))
      registrarMovimento(it.produto_codigo, 'saida', { quantidade: qtd, motivo: 'estorno recebimento ' + (pedido ? pedido.numero : ''), referencia: 'estorno-receb#' + recId });
    if (it.pedido_item_id) db.prepare('UPDATE cp_pedidos_itens SET qtd_recebida = MAX(0, qtd_recebida - ?) WHERE id=?').run(qtd, it.pedido_item_id);
  }
  if (lote) { db.prepare('DELETE FROM lotes_produtos WHERE lote_id=?').run(lote.id); db.prepare('DELETE FROM lotes WHERE id=?').run(lote.id); }
  if (conta) { db.prepare('DELETE FROM contas_pagar WHERE id=?').run(conta.id); }
  db.prepare("UPDATE cp_recebimentos SET status='estornado', integrado=0 WHERE id=?").run(recId);
  if (pedido) {
    const receb = db.prepare('SELECT COALESCE(SUM(qtd_recebida),0) q FROM cp_pedidos_itens WHERE pedido_id=?').get(pedido.id).q;
    const pend = db.prepare('SELECT COUNT(*) c FROM cp_pedidos_itens WHERE pedido_id=? AND qtd_recebida < quantidade - 0.0001').get(pedido.id).c;
    db.prepare('UPDATE cp_pedidos SET status=? WHERE id=?').run(receb <= 0.0001 ? 'aberto' : (pend > 0 ? 'parcial' : 'recebido'), pedido.id);
  }
  manut.logAcao('recebimento estornado', 'compras', { recebimento: recId, lote: lote ? lote.id : null, conta_pagar: conta ? conta.id : null, por: usuario }, 'operacao');
  return { ok: true, lote_removido: lote ? lote.id : null, conta_removida: conta ? conta.id : null };
}

// ── SOLICITAÇÕES ──
app.get('/api/compras-pro/solicitacoes', (req, res) => res.json(db.prepare("SELECT s.*, cc.nome centro_custo FROM cp_solicitacoes s LEFT JOIN financeiro_centros_custo cc ON cc.id=s.centro_custo_id ORDER BY s.id DESC LIMIT 200").all().map(s => ({ ...s, itens: db.prepare('SELECT COUNT(*) c FROM cp_solicitacoes_itens WHERE solicitacao_id=?').get(s.id).c }))));
app.get('/api/compras-pro/solicitacoes/:id', (req, res) => { const s = db.prepare('SELECT * FROM cp_solicitacoes WHERE id=?').get(+req.params.id); if (!s) return res.status(404).json({ erro: 'Não encontrada.' }); s.itens = db.prepare('SELECT * FROM cp_solicitacoes_itens WHERE solicitacao_id=?').all(s.id); res.json(s); });
app.post('/api/compras-pro/solicitacoes', (req, res) => {
  if (!gateCompras(req, res)) return;
  const d = req.body || {}, itens = Array.isArray(d.itens) ? d.itens.filter(i => (i.produto_codigo || i.descricao) && +i.quantidade > 0) : [];
  if (!itens.length) return res.status(400).json({ erro: 'Informe ao menos um item.' });
  const info = db.prepare('INSERT INTO cp_solicitacoes (solicitante,departamento,centro_custo_id,prioridade,obs,status,criado_em,criado_por) VALUES (?,?,?,?,?,?,?,?)')
    .run(d.solicitante || (req.usuario || {}).nome || '', d.departamento || '', +d.centro_custo_id || null, d.prioridade || 'normal', d.obs || '', 'aberta', new Date().toISOString(), (req.usuario || {}).usuario || '');
  const sid = info.lastInsertRowid, ins = db.prepare('INSERT INTO cp_solicitacoes_itens (solicitacao_id,produto_codigo,descricao,quantidade) VALUES (?,?,?,?)');
  for (const i of itens) ins.run(sid, i.produto_codigo || '', i.descricao || i.produto_codigo || '', +i.quantidade || 0);
  manut.logAcao('solicitação de compra criada', 'compras', { id: sid, itens: itens.length, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(db.prepare('SELECT * FROM cp_solicitacoes WHERE id=?').get(sid));
});

// ── COTAÇÕES ──
app.get('/api/compras-pro/cotacoes', (req, res) => res.json(db.prepare('SELECT c.*, f.nome vencedor FROM cp_cotacoes c LEFT JOIN fornecedores f ON f.id=c.vencedor_fornecedor_id ORDER BY c.id DESC LIMIT 200').all().map(c => ({ ...c, fornecedores: db.prepare('SELECT COUNT(*) n FROM cp_cotacoes_fornecedores WHERE cotacao_id=?').get(c.id).n }))));
app.get('/api/compras-pro/cotacoes/:id', (req, res) => { const c = db.prepare('SELECT * FROM cp_cotacoes WHERE id=?').get(+req.params.id); if (!c) return res.status(404).json({ erro: 'Não encontrada.' }); c.fornecedores = db.prepare('SELECT cf.*, f.nome FROM cp_cotacoes_fornecedores cf LEFT JOIN fornecedores f ON f.id=cf.fornecedor_id WHERE cf.cotacao_id=? ORDER BY cf.valor').all(c.id); c.solicitacao = c.solicitacao_id ? db.prepare('SELECT * FROM cp_solicitacoes WHERE id=?').get(c.solicitacao_id) : null; res.json(c); });
app.post('/api/compras-pro/cotacoes', (req, res) => {
  if (!gateCompras(req, res)) return;
  const d = req.body || {};
  const info = db.prepare('INSERT INTO cp_cotacoes (solicitacao_id,descricao,status,criado_em,criado_por) VALUES (?,?,?,?,?)').run(+d.solicitacao_id || null, d.descricao || 'Cotação', 'aberta', new Date().toISOString(), (req.usuario || {}).usuario || '');
  if (+d.solicitacao_id) db.prepare("UPDATE cp_solicitacoes SET status='cotando' WHERE id=?").run(+d.solicitacao_id);
  manut.logAcao('cotação criada', 'compras', { id: info.lastInsertRowid, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(db.prepare('SELECT * FROM cp_cotacoes WHERE id=?').get(info.lastInsertRowid));
});
app.post('/api/compras-pro/cotacoes/:id/fornecedor', (req, res) => {
  if (!gateCompras(req, res)) return;
  const d = req.body || {}, cid = +req.params.id;
  db.prepare('INSERT INTO cp_cotacoes_fornecedores (cotacao_id,fornecedor_id,valor,prazo,frete,obs,criado_em) VALUES (?,?,?,?,?,?,?)').run(cid, +d.fornecedor_id || null, +d.valor || 0, d.prazo || '', +d.frete || 0, d.obs || '', new Date().toISOString());
  res.json(db.prepare('SELECT cf.*, f.nome FROM cp_cotacoes_fornecedores cf LEFT JOIN fornecedores f ON f.id=cf.fornecedor_id WHERE cf.cotacao_id=? ORDER BY cf.valor').all(cid));
});
app.post('/api/compras-pro/cotacoes/:id/vencedor', (req, res) => {
  if (!gateCompras(req, res)) return;
  const cid = +req.params.id, fid = +req.body.fornecedor_id;
  const cf = db.prepare('SELECT * FROM cp_cotacoes_fornecedores WHERE cotacao_id=? AND fornecedor_id=?').get(cid, fid);
  if (!cf) return res.status(400).json({ erro: 'Cotação desse fornecedor não existe.' });
  db.prepare("UPDATE cp_cotacoes SET vencedor_fornecedor_id=?, status='fechada' WHERE id=?").run(fid, cid);
  // gera o PEDIDO automaticamente a partir da cotação vencedora + itens da solicitação
  const cot = db.prepare('SELECT * FROM cp_cotacoes WHERE id=?').get(cid);
  const solItens = cot.solicitacao_id ? db.prepare('SELECT * FROM cp_solicitacoes_itens WHERE solicitacao_id=?').all(cot.solicitacao_id) : [];
  const numero = numeroPedidoCompra(), agora = new Date().toISOString();
  // rateia o valor da cotação pelos itens (proporcional à quantidade) — simples e previsível
  const totalQtd = solItens.reduce((s, i) => s + (+i.quantidade || 0), 0) || 1;
  const subtotal = +cf.valor || 0;
  const pInfo = db.prepare(`INSERT INTO cp_pedidos (numero,fornecedor_id,cotacao_id,solicitacao_id,data,prazo_entrega,subtotal,frete,impostos,desconto,total,status,criado_em,criado_por)
     VALUES (?,?,?,?,?,?,?,?,0,0,?, 'aberto', ?,?)`).run(numero, fid, cid, cot.solicitacao_id || null, agora, cf.prazo || null, subtotal, +cf.frete || 0, r2(subtotal + (+cf.frete || 0)), agora, (req.usuario || {}).usuario || '');
  const pid = pInfo.lastInsertRowid, ins = db.prepare('INSERT INTO cp_pedidos_itens (pedido_id,produto_codigo,descricao,quantidade,valor_unitario,valor_total) VALUES (?,?,?,?,?,?)');
  for (const i of solItens) { const vu = r2(subtotal / totalQtd); ins.run(pid, i.produto_codigo || '', i.descricao || '', +i.quantidade || 0, vu, r2(vu * (+i.quantidade || 0))); }
  if (cot.solicitacao_id) db.prepare("UPDATE cp_solicitacoes SET status='pedido' WHERE id=?").run(cot.solicitacao_id);
  manut.logAcao('cotação fechada + pedido gerado', 'compras', { cotacao: cid, pedido: numero, fornecedor: fid, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true, pedido_id: pid, numero });
});

// ── PEDIDOS DE COMPRA ──
app.get('/api/compras-pro/pedidos', (req, res) => {
  const q = req.query, cond = ['1=1'], args = [];
  if (q.status) { cond.push('p.status=?'); args.push(q.status); }
  if (q.fornecedor_id) { cond.push('p.fornecedor_id=?'); args.push(+q.fornecedor_id); }
  if (q.de) { cond.push("date(p.data,'localtime')>=?"); args.push(String(q.de).slice(0, 10)); }
  if (q.ate) { cond.push("date(p.data,'localtime')<=?"); args.push(String(q.ate).slice(0, 10)); }
  res.json(db.prepare(`SELECT p.*, f.nome fornecedor FROM cp_pedidos p LEFT JOIN fornecedores f ON f.id=p.fornecedor_id WHERE ${cond.join(' AND ')} ORDER BY p.id DESC LIMIT 300`).all(...args));
});
app.get('/api/compras-pro/pedidos/:id', (req, res) => {
  const p = db.prepare('SELECT p.*, f.nome fornecedor FROM cp_pedidos p LEFT JOIN fornecedores f ON f.id=p.fornecedor_id WHERE p.id=?').get(+req.params.id);
  if (!p) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  p.itens = db.prepare('SELECT * FROM cp_pedidos_itens WHERE pedido_id=?').all(p.id);
  p.recebimentos = db.prepare('SELECT * FROM cp_recebimentos WHERE pedido_id=? ORDER BY id').all(p.id);
  p.notas = db.prepare('SELECT * FROM cp_notas_fiscais WHERE pedido_id=?').all(p.id);
  res.json(p);
});
app.post('/api/compras-pro/pedidos', (req, res) => { // criar pedido direto (sem cotação)
  if (!gateCompras(req, res)) return;
  const d = req.body || {}, itens = Array.isArray(d.itens) ? d.itens.filter(i => (i.produto_codigo || i.descricao) && +i.quantidade > 0) : [];
  if (!d.fornecedor_id || !itens.length) return res.status(400).json({ erro: 'Fornecedor e itens são obrigatórios.' });
  const subtotal = itens.reduce((s, i) => s + (+i.valor_unitario || 0) * (+i.quantidade || 0), 0);
  const total = r2(subtotal + (+d.frete || 0) + (+d.impostos || 0) - (+d.desconto || 0));
  const numero = numeroPedidoCompra(), agora = new Date().toISOString();
  const info = db.prepare(`INSERT INTO cp_pedidos (numero,fornecedor_id,data,prazo_entrega,forma_pagamento,conta_id,centro_custo_id,subtotal,frete,impostos,desconto,total,status,obs,criado_em,criado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'aberto', ?,?,?)`).run(numero, +d.fornecedor_id, agora, d.prazo_entrega || null, d.forma_pagamento || '', +d.conta_id || null, +d.centro_custo_id || null,
     r2(subtotal), +d.frete || 0, +d.impostos || 0, +d.desconto || 0, total, d.obs || '', agora, (req.usuario || {}).usuario || '');
  const pid = info.lastInsertRowid, ins = db.prepare('INSERT INTO cp_pedidos_itens (pedido_id,produto_codigo,descricao,quantidade,valor_unitario,valor_total) VALUES (?,?,?,?,?,?)');
  for (const i of itens) ins.run(pid, i.produto_codigo || '', i.descricao || i.produto_codigo || '', +i.quantidade || 0, +i.valor_unitario || 0, r2((+i.valor_unitario || 0) * (+i.quantidade || 0)));
  manut.logAcao('pedido de compra criado', 'compras', { id: pid, numero, total, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(db.prepare('SELECT * FROM cp_pedidos WHERE id=?').get(pid));
});
app.post('/api/compras-pro/pedidos/:id/cancelar', (req, res) => {
  if (!gateCompras(req, res)) return;
  const id = +req.params.id, p = db.prepare('SELECT * FROM cp_pedidos WHERE id=?').get(id);
  if (!p) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (db.prepare("SELECT 1 FROM cp_recebimentos WHERE pedido_id=? AND integrado=1 LIMIT 1").get(id)) return res.status(400).json({ erro: 'Pedido já teve recebimento aprovado — não pode cancelar.' });
  db.prepare("UPDATE cp_pedidos SET status='cancelado' WHERE id=?").run(id);
  manut.logAcao('pedido de compra cancelado', 'compras', { id, por: (req.usuario || {}).usuario }, 'operacao');
  res.json({ ok: true });
});

// ── RECEBIMENTOS ──
app.get('/api/compras-pro/recebimentos', (req, res) => res.json(db.prepare('SELECT r.*, p.numero pedido_numero, f.nome fornecedor FROM cp_recebimentos r LEFT JOIN cp_pedidos p ON p.id=r.pedido_id LEFT JOIN fornecedores f ON f.id=p.fornecedor_id ORDER BY r.id DESC LIMIT 200').all()));
app.post('/api/compras-pro/recebimentos', (req, res) => {
  if (!gateCompras(req, res)) return;
  const d = req.body || {}, pedido = db.prepare('SELECT * FROM cp_pedidos WHERE id=?').get(+d.pedido_id);
  if (!pedido) return res.status(400).json({ erro: 'Pedido inválido.' });
  const itens = Array.isArray(d.itens) ? d.itens : [];
  const info = db.prepare('INSERT INTO cp_recebimentos (pedido_id,data,conferente,status,obs,criado_em,criado_por) VALUES (?,?,?,?,?,?,?)')
    .run(pedido.id, d.data || new Date().toISOString(), d.conferente || (req.usuario || {}).nome || '', 'pendente', d.obs || '', new Date().toISOString(), (req.usuario || {}).usuario || '');
  const rid = info.lastInsertRowid, ins = db.prepare('INSERT INTO cp_recebimentos_itens (recebimento_id,pedido_item_id,produto_codigo,qtd_pedida,qtd_recebida,diferenca,lote,validade,qualidade,obs) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const i of itens) { const ped = +i.qtd_pedida || 0, rec = +i.qtd_recebida || 0; ins.run(rid, +i.pedido_item_id || null, i.produto_codigo || '', ped, rec, r2(rec - ped), i.lote || '', i.validade || '', i.qualidade || 'ok', i.obs || ''); }
  manut.logAcao('recebimento registrado', 'compras', { id: rid, pedido: pedido.numero, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(db.prepare('SELECT * FROM cp_recebimentos WHERE id=?').get(rid));
});
app.post('/api/compras-pro/recebimentos/:id/aprovar', (req, res) => {
  if (!gateCompras(req, res)) return;
  // Fase 37: envelope transacional — estoque + lote + conta a pagar entram tudo-ou-nada.
  try { const r = emTransacao(() => aprovarRecebimento(+req.params.id, (req.usuario || {}).usuario)); res.json(r); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});
app.post('/api/compras-pro/recebimentos/:id/estornar', (req, res) => {
  if (!gateFinAdmin(req, res)) return; // estorno é ação sensível → admin
  try { const r = emTransacao(() => estornarRecebimento(+req.params.id, (req.usuario || {}).usuario)); r.erro ? res.status(400).json(r) : res.json(r); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});
// Detalhe do recebimento (itens + lote + conta a pagar gerados) — pra tela mostrar a integração
app.get('/api/compras-pro/recebimentos/:id', (req, res) => {
  const r = db.prepare('SELECT r.*, p.numero pedido_numero, f.nome fornecedor FROM cp_recebimentos r LEFT JOIN cp_pedidos p ON p.id=r.pedido_id LEFT JOIN fornecedores f ON f.id=p.fornecedor_id WHERE r.id=?').get(+req.params.id);
  if (!r) return res.status(404).json({ erro: 'Recebimento não encontrado.' });
  r.itens = db.prepare('SELECT * FROM cp_recebimentos_itens WHERE recebimento_id=?').all(r.id);
  const lote = db.prepare('SELECT id, numero, valor_pago, status FROM lotes WHERE recebimento_id=?').get(r.id);
  r.lote = lote || null;
  if (lote) lote.produtos = db.prepare('SELECT produto_codigo, nome, qtd_produzida, custo_unitario, qtd_restante FROM lotes_produtos WHERE lote_id=?').all(lote.id);
  r.conta_pagar = db.prepare('SELECT id, descricao, valor_total, status, data_vencimento FROM contas_pagar WHERE recebimento_id=?').get(r.id) || null;
  res.json(r);
});

// ── NOTAS FISCAIS (estrutura p/ XML futuro — sem leitura) ──
app.get('/api/compras-pro/notas', (req, res) => res.json(db.prepare('SELECT nf.*, p.numero pedido_numero FROM cp_notas_fiscais nf LEFT JOIN cp_pedidos p ON p.id=nf.pedido_id ORDER BY nf.id DESC LIMIT 200').all()));
app.post('/api/compras-pro/notas', (req, res) => {
  if (!gateCompras(req, res)) return;
  const d = req.body || {};
  const info = db.prepare('INSERT INTO cp_notas_fiscais (pedido_id,numero,serie,emissao,chave,xml_ref,pdf_ref,obs,criado_em) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(+d.pedido_id || null, d.numero || '', d.serie || '', d.emissao || '', d.chave || '', d.xml_ref || '', d.pdf_ref || '', d.obs || '', new Date().toISOString());
  manut.logAcao('nota fiscal cadastrada', 'compras', { id: info.lastInsertRowid, numero: d.numero, por: (req.usuario || {}).usuario }, 'operacao');
  res.json(db.prepare('SELECT * FROM cp_notas_fiscais WHERE id=?').get(info.lastInsertRowid));
});

// ── RELATÓRIOS ──
app.get('/api/compras-pro/relatorios/:tipo', (req, res) => {
  const fx = faixaPeriodo(req.query), w = wherePeriodo('p.data', fx), tipo = req.params.tipo;
  if (tipo === 'por-fornecedor') {
    const rows = db.prepare(`SELECT f.nome, COUNT(*) n, COALESCE(SUM(p.total),0) tot, COALESCE(AVG(p.total),0) media FROM cp_pedidos p LEFT JOIN fornecedores f ON f.id=p.fornecedor_id WHERE p.status<>'cancelado'${w.clause} GROUP BY p.fornecedor_id ORDER BY tot DESC`).all(...w.args);
    return res.json({ titulo: 'Comprado por fornecedor', colunas: ['Fornecedor', 'Pedidos', 'Total', 'Ticket médio'], linhas: rows.map(r => [r.nome || '—', r.n, r2(r.tot), r2(r.media)]) });
  }
  if (tipo === 'por-produto') {
    const rows = db.prepare(`SELECT pi.produto_codigo cod, MAX(pi.descricao) nome, SUM(pi.quantidade) qtd, COALESCE(SUM(pi.valor_total),0) tot, COALESCE(AVG(pi.valor_unitario),0) preco FROM cp_pedidos_itens pi JOIN cp_pedidos p ON p.id=pi.pedido_id WHERE p.status<>'cancelado'${w.clause} GROUP BY pi.produto_codigo ORDER BY tot DESC`).all(...w.args);
    return res.json({ titulo: 'Comprado por produto', colunas: ['Produto', 'Qtd', 'Total', 'Preço médio'], linhas: rows.map(r => [r.nome || r.cod || '—', r2(r.qtd), r2(r.tot), r2(r.preco)]) });
  }
  if (tipo === 'por-centro') {
    const rows = db.prepare(`SELECT COALESCE(cc.nome,'(sem centro)') nome, COUNT(*) n, COALESCE(SUM(p.total),0) tot FROM cp_pedidos p LEFT JOIN financeiro_centros_custo cc ON cc.id=p.centro_custo_id WHERE p.status<>'cancelado'${w.clause} GROUP BY p.centro_custo_id ORDER BY tot DESC`).all(...w.args);
    return res.json({ titulo: 'Compras por centro de custo', colunas: ['Centro', 'Pedidos', 'Total'], linhas: rows.map(r => [r.nome, r.n, r2(r.tot)]) });
  }
  res.json({ titulo: 'Relatório', colunas: [], linhas: [] });
});

// ── ALERTAS ──
app.get('/api/compras-pro/alertas', (req, res) => {
  const hojeYmd = ymdLocal(new Date());
  const atrasados = db.prepare(`SELECT p.numero, f.nome fornecedor, p.prazo_entrega FROM cp_pedidos p LEFT JOIN fornecedores f ON f.id=p.fornecedor_id WHERE p.status IN ('aberto','parcial') AND p.prazo_entrega IS NOT NULL AND p.prazo_entrega < ? ORDER BY p.prazo_entrega`).all(hojeYmd)
    .map(x => ({ pedido: x.numero, fornecedor: x.fornecedor || '—', prazo: x.prazo_entrega }));
  // fornecedor inativo / sem comprar há 45 dias (reusa erp_compras + cp_pedidos)
  const lim = new Date(Date.now() - 45 * 864e5).toISOString();
  const semComprar = db.prepare(`SELECT f.nome, MAX(x.dt) ult FROM fornecedores f JOIN (SELECT fornecedor_id, criado_em dt FROM cp_pedidos UNION ALL SELECT fornecedor_id, criado_em FROM erp_compras) x ON x.fornecedor_id=f.id WHERE f.ativo=1 GROUP BY f.id HAVING ult < ? ORDER BY ult LIMIT 10`).all(lim)
    .map(x => ({ nome: x.nome, ultima: x.ult }));
  res.json({ pedidosAtrasados: atrasados, fornecedoresParados: semComprar, total: atrasados.length + semComprar.length });
});

/* ══════════════════════════════════════════════════════════════════════════
   CADASTRO MESTRE DE PRODUTOS (Fase 32) — transforma `produtos` num cadastro
   mestre com TIPO (acabado/matéria-prima/insumo/embalagem/serviço/composto),
   categorias, marcas, unidades, histórico de alterações e um painel de
   integrações (compras/vendas/lotes/movimentos/custos). TUDO ADITIVO: as
   colunas e tabelas são novas; o PDV/Estoque/Compras seguem lendo o mesmo
   `produtos`. Ver 47_*.md. ═════════════════════════════════════════════════ */
for (const col of ['tipo TEXT', 'codigo_interno TEXT', 'codigo_barras TEXT', 'descricao_curta TEXT', 'categoria_id INTEGER', 'marca_id INTEGER',
  'fornecedor_principal_id INTEGER', 'fornecedor_alt_id INTEGER', 'centro_custo_id INTEGER', 'unidade TEXT', 'peso REAL', 'volume REAL',
  'imagem TEXT', 'obs TEXT', 'preco_minimo REAL', 'preco_promocional REAL', 'estoque_reservado REAL', 'estoque_max REAL', 'ponto_reposicao REAL', 'localizacao TEXT']) {
  try { db.exec(`ALTER TABLE produtos ADD COLUMN ${col}`); } catch {}
}
db.exec('CREATE TABLE IF NOT EXISTS produtos_categorias (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, ativo INTEGER DEFAULT 1, criado_em TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS produtos_marcas (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, ativo INTEGER DEFAULT 1, criado_em TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS produtos_unidades (id INTEGER PRIMARY KEY AUTOINCREMENT, sigla TEXT NOT NULL, nome TEXT, criado_em TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS produtos_historico (id INTEGER PRIMARY KEY AUTOINCREMENT, produto_codigo TEXT, campo TEXT, valor_antigo TEXT, valor_novo TEXT, por TEXT, criado_em TEXT)');
db.exec('CREATE INDEX IF NOT EXISTS idx_prodhist ON produtos_historico(produto_codigo)');
(function seedUnidades() {
  if (db.prepare('SELECT COUNT(*) n FROM produtos_unidades').get().n) return;
  const ins = db.prepare('INSERT INTO produtos_unidades (sigla,nome,criado_em) VALUES (?,?,?)'), agora = new Date().toISOString();
  [['UN', 'Unidade'], ['KG', 'Quilograma'], ['G', 'Grama'], ['L', 'Litro'], ['ML', 'Mililitro'], ['CX', 'Caixa'], ['PC', 'Pacote'], ['DZ', 'Dúzia']].forEach(u => ins.run(u[0], u[1], agora));
})();

/* ══════════════════════════════════════════════════════════════════════════
   FASE 33 — CONTAS A RECEBER, COBRANÇAS E INADIMPLÊNCIA
   ─────────────────────────────────────────────────────────────────────────
   PRINCÍPIO (auditoria do Fiado): NÃO cria saldo paralelo. O Fiado continua
   sendo o `clientes_extrato` (compra/pagamento/estorno) e o saldo do cliente
   continua CALCULADO (saldoDoClienteDb). Este módulo é uma CAMADA DE GESTÃO:
   • cada 'compra' do extrato é um TÍTULO a receber (ganha `vencimento` opcional);
   • os 'pagamento'/'estorno' são CRÉDITOS alocados FIFO (mais antigo primeiro)
     para derivar valor pago / restante / status de cada título;
   • RECEBER um título reusa o MESMO lançamento 'pagamento' → a MESMA
     sincronizarFinanceiroFiado. Ou seja: dinheiro entra no financeiro por UM
     único caminho, idempotente. Total dos títulos == saldoDoClienteDb SEMPRE.
   Compatível com PDV, Delivery, Clientes, Financeiro, Fluxo, Fechamento. ══ */

// Colunas aditivas (try/catch — não recria se já existir)
try { db.exec(`ALTER TABLE clientes_extrato ADD COLUMN vencimento TEXT`); } catch {}
for (const col of ['limite_credito REAL DEFAULT 0', 'bloqueado INTEGER DEFAULT 0']) {
  try { db.exec(`ALTER TABLE clientes ADD COLUMN ${col}`); } catch {}
}
db.exec('CREATE INDEX IF NOT EXISTS idx_extrato_venc ON clientes_extrato(vencimento)');
// Registro de cobranças (régua/histórico de contato) — NÃO mexe em saldo/financeiro
db.exec(`CREATE TABLE IF NOT EXISTS cobrancas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  extrato_id INTEGER,                 -- título alvo (opcional; null = carteira toda)
  canal TEXT,                         -- whatsapp | telefone | presencial | email | outro
  status TEXT DEFAULT 'pendente',     -- pendente | enviada | prometido | pago | cancelada
  valor_alvo REAL, promessa_data TEXT, resultado TEXT, obs TEXT,
  criado_em TEXT, criado_por TEXT, atualizado_em TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_cobrancas_cliente ON cobrancas(cliente_id)');
// Configurações do módulo (só cria se ainda não existir)
(function seedReceberConfig() {
  const padrao = { cr_prazo_padrao_dias: '30', cr_dias_alerta_previo: '3', cr_juros_mes: '0',
    cr_multa_pct: '0', cr_bloqueio_automatico: '0', cr_limite_padrao: '0' };
  for (const [k, v] of Object.entries(padrao)) if (getConfig(k, null) == null) setConfig(k, v);
})();

const crRound = (v) => Math.round((+v || 0) * 100) / 100;
function crHojeStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function crDias(de, ate) { // dias inteiros entre duas datas 'YYYY-MM-DD' (ate - de)
  const a = new Date(de + 'T00:00:00'), b = new Date(ate + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
const crVenc = (l) => (l.vencimento && String(l.vencimento).slice(0, 10)) || ''; // '' = sem vencimento
const crDataTit = (l) => crVenc(l) || String(l.criado_em || '').slice(0, 10); // chave de ordenação FIFO

/* Aloca os créditos (pagamentos+estornos) do cliente sobre as compras (títulos),
   FIFO pelo vencimento (mais antigo primeiro), depois por id. Devolve os títulos
   com valor pago / restante / status derivados. Não altera nada no banco. */
function crAlocarTitulos(lancs) {
  const hoje = crHojeStr();
  const jr = parseFloat(getConfig('cr_juros_mes', '0')) || 0;
  const mt = parseFloat(getConfig('cr_multa_pct', '0')) || 0;
  const compras = lancs.filter(l => l.tipo === 'compra')
    .sort((a, b) => crDataTit(a).localeCompare(crDataTit(b)) || a.id - b.id);
  let credito = lancs.filter(l => l.tipo !== 'compra').reduce((s, l) => s + (+l.valor || 0), 0);
  return compras.map(c => {
    const valor = crRound(c.valor);
    const alocado = crRound(Math.min(valor, Math.max(0, credito)));
    credito = crRound(credito - alocado);
    const restante = crRound(valor - alocado);
    const venc = crVenc(c);
    const pago = restante <= 0.005;
    const atraso = (!pago && venc && venc < hoje) ? crDias(venc, hoje) : 0;
    const status = pago ? 'pago' : (atraso > 0 ? 'vencido' : 'a_vencer');
    // encargos SUGERIDOS (juros pró-rata mês + multa) — informativos, NÃO lançados sozinhos
    const meses = atraso / 30;
    const encargos = atraso > 0 ? crRound(restante * (mt / 100) + restante * (jr / 100) * meses) : 0;
    return {
      extrato_id: c.id, cliente_id: c.cliente_id, valor, valor_pago: crRound(valor - restante), restante,
      vencimento: venc || null, criado_em: c.criado_em, descricao: c.descricao || '',
      status, parcial: alocado > 0.005 && !pago, dias_atraso: atraso,
      dias_para_vencer: (!pago && venc && venc >= hoje) ? crDias(hoje, venc) : null,
      encargos_sugeridos: encargos, bucket: crBucket(atraso),
    };
  });
}
function crBucket(atraso) {
  if (atraso <= 0) return 'a_vencer';
  if (atraso <= 30) return 'd1_30';
  if (atraso <= 60) return 'd31_60';
  if (atraso <= 90) return 'd61_90';
  return 'd90_mais';
}
const crExtratoCliente = (id) => db.prepare('SELECT * FROM clientes_extrato WHERE cliente_id=?').all(id);
const crTitulosCliente = (id) => crAlocarTitulos(crExtratoCliente(id));
// Carteira inteira (todos os clientes com fiado), já com nome/telefone
function crCarteira() {
  const linhas = db.prepare(`SELECT e.*, c.nome cliente_nome, c.telefone cliente_telefone
    FROM clientes_extrato e JOIN clientes c ON c.id = e.cliente_id`).all();
  const porCli = new Map();
  for (const l of linhas) { if (!porCli.has(l.cliente_id)) porCli.set(l.cliente_id, []); porCli.get(l.cliente_id).push(l); }
  const nomes = new Map(linhas.map(l => [l.cliente_id, { nome: l.cliente_nome, tel: l.cliente_telefone }]));
  const titulos = [];
  for (const [cid, ls] of porCli) {
    const info = nomes.get(cid);
    for (const t of crAlocarTitulos(ls)) titulos.push({ ...t, cliente_nome: info.nome, cliente_telefone: info.tel || '' });
  }
  return titulos;
}
function crResumo(titulos) {
  const abertos = titulos.filter(t => t.status !== 'pago');
  const total = crRound(abertos.reduce((s, t) => s + t.restante, 0));
  const vencido = crRound(abertos.filter(t => t.status === 'vencido').reduce((s, t) => s + t.restante, 0));
  const aVencer = crRound(total - vencido);
  const aging = { a_vencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_mais: 0 };
  for (const t of abertos) aging[t.bucket] = crRound((aging[t.bucket] || 0) + t.restante);
  const clientesVenc = new Set(abertos.filter(t => t.status === 'vencido').map(t => t.cliente_id));
  return { total, vencido, a_vencer: aVencer, titulos_abertos: abertos.length,
    clientes_devedores: new Set(abertos.map(t => t.cliente_id)).size, clientes_inadimplentes: clientesVenc.size, aging };
}
// Situação de crédito de um cliente (limite, bloqueio, vencido) — pra PDV/Delivery consultarem
function crCreditoStatus(id) {
  const cli = db.prepare('SELECT limite_credito, bloqueado FROM clientes WHERE id=?').get(id) || {};
  const titulos = crTitulosCliente(id);
  const saldo = crRound(titulos.filter(t => t.status !== 'pago').reduce((s, t) => s + t.restante, 0));
  const vencido = crRound(titulos.filter(t => t.status === 'vencido').reduce((s, t) => s + t.restante, 0));
  const limite = crRound(cli.limite_credito);
  const bloqueioAuto = getConfig('cr_bloqueio_automatico', '0') === '1' && vencido > 0.005;
  const bloqueado = !!cli.bloqueado || bloqueioAuto;
  const disponivel = limite > 0 ? crRound(limite - saldo) : null; // null = sem limite definido
  return { saldo, vencido, limite, disponivel, bloqueado, bloqueado_manual: !!cli.bloqueado, bloqueio_automatico: bloqueioAuto,
    estourou_limite: limite > 0 && saldo > limite + 0.005 };
}

// ── Endpoints /api/receber/* (gestor: admin/supervisor) ──────────────────
app.get('/api/receber/dashboard', (req, res) => {
  try {
    const titulos = crCarteira();
    const resumo = crResumo(titulos);
    const hoje = crHojeStr();
    const prevAlerta = +getConfig('cr_dias_alerta_previo', '3') || 3;
    // recebido no mês (pagamentos de fiado do mês corrente)
    const mesIni = hoje.slice(0, 8) + '01';
    const recebidoMes = db.prepare(`SELECT COALESCE(SUM(valor),0) t FROM clientes_extrato WHERE tipo='pagamento' AND substr(criado_em,1,10) >= ?`).get(mesIni).t;
    // maiores devedores
    const porCli = new Map();
    for (const t of titulos.filter(x => x.status !== 'pago')) {
      const e = porCli.get(t.cliente_id) || { cliente_id: t.cliente_id, cliente_nome: t.cliente_nome, total: 0, vencido: 0 };
      e.total = crRound(e.total + t.restante); if (t.status === 'vencido') e.vencido = crRound(e.vencido + t.restante);
      porCli.set(t.cliente_id, e);
    }
    const maioresDevedores = [...porCli.values()].sort((a, b) => b.total - a.total).slice(0, 8);
    const vencendo = titulos.filter(t => t.status === 'a_vencer' && t.dias_para_vencer != null && t.dias_para_vencer <= prevAlerta);
    res.json({ resumo, recebido_mes: crRound(recebidoMes), maiores_devedores: maioresDevedores,
      vencendo_qtd: vencendo.length, vencendo_total: crRound(vencendo.reduce((s, t) => s + t.restante, 0)),
      ticket_medio_atraso: resumo.clientes_inadimplentes ? crRound(resumo.vencido / resumo.clientes_inadimplentes) : 0 });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/receber/titulos', (req, res) => {
  try {
    let titulos = crCarteira();
    const q = req.query || {};
    if (q.status) titulos = titulos.filter(t => t.status === q.status);
    if (q.cliente_id) titulos = titulos.filter(t => t.cliente_id == q.cliente_id);
    if (q.bucket) titulos = titulos.filter(t => t.bucket === q.bucket);
    if (q.abertos === '1') titulos = titulos.filter(t => t.status !== 'pago');
    if (q.venc_de) titulos = titulos.filter(t => t.vencimento && t.vencimento >= q.venc_de);
    if (q.venc_ate) titulos = titulos.filter(t => t.vencimento && t.vencimento <= q.venc_ate);
    if (q.busca) { const s = String(q.busca).toLowerCase(); titulos = titulos.filter(t => (t.cliente_nome || '').toLowerCase().includes(s) || (t.descricao || '').toLowerCase().includes(s)); }
    titulos.sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999') || b.restante - a.restante);
    res.json({ titulos, resumo: crResumo(titulos) });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/receber/cliente/:id', (req, res) => {
  const id = +req.params.id;
  const c = db.prepare('SELECT * FROM clientes WHERE id=?').get(id);
  if (!c) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const titulos = crTitulosCliente(id);
  const cobrancas = db.prepare('SELECT * FROM cobrancas WHERE cliente_id=? ORDER BY id DESC LIMIT 50').all(id);
  res.json({ cliente: { id: c.id, nome: c.nome, telefone: c.telefone || '', bairro: c.bairro || '' },
    credito: crCreditoStatus(id), titulos, cobrancas,
    extrato: db.prepare('SELECT * FROM clientes_extrato WHERE cliente_id=? ORDER BY id DESC LIMIT 60').all(id).map(extratoParaFront) });
});

// RECEBER — cria um 'pagamento' no extrato (reusa o MESMO fluxo do fiado → syncFin).
// Aceita título específico (referencia titulo#id) OU pagamento no saldo do cliente.
app.post('/api/receber/pagar', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {};
  const clienteId = +d.cliente_id;
  if (!clienteId || !db.prepare('SELECT id FROM clientes WHERE id=?').get(clienteId)) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const valor = crRound(d.valor);
  if (!(valor > 0)) return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });
  const saldo = saldoDoClienteDb(clienteId);
  if (valor > saldo + 0.005) return res.status(400).json({ erro: `Valor acima do saldo devedor (${saldo.toFixed(2)}).` });
  const out = idempotente(d.client_request_id, 'receber_titulo', () => {
    const formas = (d.formas || d.formasPagas) ? JSON.stringify(d.formas || d.formasPagas) : null;
    const ref = d.extrato_id ? `titulo#${+d.extrato_id}` : (d.referencia || 'receber');
    const desc = d.descricao || (d.extrato_id ? `Recebimento título #${+d.extrato_id}` : 'Recebimento fiado');
    const info = db.prepare('INSERT INTO clientes_extrato (cliente_id, tipo, valor, descricao, formas, referencia, criado_em) VALUES (?,?,?,?,?,?,?)')
      .run(clienteId, 'pagamento', valor, desc, formas, ref, new Date().toISOString());
    syncFin(sincronizarFinanceiroFiado, info.lastInsertRowid); // dinheiro entra no financeiro (idempotente)
    // se a cobrança referenciava este título/cliente, marca como paga
    try { db.prepare(`UPDATE cobrancas SET status='pago', atualizado_em=? WHERE cliente_id=? AND status IN('pendente','enviada','prometido') AND (extrato_id=? OR extrato_id IS NULL)`)
      .run(new Date().toISOString(), clienteId, d.extrato_id ? +d.extrato_id : -1); } catch {}
    manut.logAcao('recebimento de fiado (contas a receber)', 'financeiro', { cliente_id: clienteId, valor, ref }, 'operacao');
    return { ok: true, lancamento_id: info.lastInsertRowid, saldo: saldoDoClienteDb(clienteId), titulos: crTitulosCliente(clienteId) };
  });
  res.json(out);
});

// Define/edita o vencimento de um título (uma 'compra' do extrato)
app.put('/api/receber/titulos/:extratoId/vencimento', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const l = db.prepare("SELECT * FROM clientes_extrato WHERE id=? AND tipo='compra'").get(+req.params.extratoId);
  if (!l) return res.status(404).json({ erro: 'Título não encontrado.' });
  const venc = (req.body || {}).vencimento ? String(req.body.vencimento).slice(0, 10) : null;
  db.prepare('UPDATE clientes_extrato SET vencimento=? WHERE id=?').run(venc, l.id);
  res.json({ ok: true, titulos: crTitulosCliente(l.cliente_id) });
});

// ── Cobranças ────────────────────────────────────────────────────────────
app.get('/api/receber/cobrancas', (req, res) => {
  const q = req.query || {};
  let sql = `SELECT co.*, c.nome cliente_nome, c.telefone cliente_telefone FROM cobrancas co JOIN clientes c ON c.id=co.cliente_id WHERE 1=1`;
  const args = [];
  if (q.cliente_id) { sql += ' AND co.cliente_id=?'; args.push(+q.cliente_id); }
  if (q.status) { sql += ' AND co.status=?'; args.push(q.status); }
  sql += ' ORDER BY co.id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...args));
});
app.post('/api/receber/cobrancas', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {};
  if (!d.cliente_id || !db.prepare('SELECT id FROM clientes WHERE id=?').get(+d.cliente_id)) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const agora = new Date().toISOString();
  const info = db.prepare(`INSERT INTO cobrancas (cliente_id,extrato_id,canal,status,valor_alvo,promessa_data,resultado,obs,criado_em,criado_por,atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(+d.cliente_id, d.extrato_id ? +d.extrato_id : null, d.canal || 'whatsapp',
    d.status || 'enviada', d.valor_alvo != null ? crRound(d.valor_alvo) : null, d.promessa_data || null,
    d.resultado || '', d.obs || '', agora, (req.usuario || {}).nome || 'sistema', agora);
  manut.logAcao('registro de cobrança', 'financeiro', { cliente_id: +d.cliente_id, canal: d.canal }, 'operacao');
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
app.put('/api/receber/cobrancas/:id', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const co = db.prepare('SELECT * FROM cobrancas WHERE id=?').get(+req.params.id);
  if (!co) return res.status(404).json({ erro: 'Cobrança não encontrada.' });
  const d = req.body || {};
  db.prepare('UPDATE cobrancas SET status=?, resultado=?, promessa_data=?, obs=?, atualizado_em=? WHERE id=?')
    .run(d.status || co.status, d.resultado != null ? d.resultado : co.resultado, d.promessa_data != null ? d.promessa_data : co.promessa_data,
      d.obs != null ? d.obs : co.obs, new Date().toISOString(), co.id);
  res.json({ ok: true });
});
app.delete('/api/receber/cobrancas/:id', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  db.prepare('DELETE FROM cobrancas WHERE id=?').run(+req.params.id);
  res.json({ ok: true });
});

// ── Inadimplência (clientes com título vencido, aging por cliente) ────────
app.get('/api/receber/inadimplencia', (req, res) => {
  try {
    const titulos = crCarteira().filter(t => t.status === 'vencido');
    const porCli = new Map();
    for (const t of titulos) {
      const e = porCli.get(t.cliente_id) || { cliente_id: t.cliente_id, cliente_nome: t.cliente_nome, cliente_telefone: t.cliente_telefone,
        total: 0, titulos: 0, maior_atraso: 0, encargos: 0 };
      e.total = crRound(e.total + t.restante); e.titulos++; e.maior_atraso = Math.max(e.maior_atraso, t.dias_atraso);
      e.encargos = crRound(e.encargos + t.encargos_sugeridos);
      porCli.set(t.cliente_id, e);
    }
    const lista = [...porCli.values()].sort((a, b) => b.total - a.total).map(c => ({ ...c, bucket: crBucket(c.maior_atraso),
      ultima_cobranca: (db.prepare('SELECT criado_em FROM cobrancas WHERE cliente_id=? ORDER BY id DESC LIMIT 1').get(c.cliente_id) || {}).criado_em || null }));
    res.json({ clientes: lista, total: crRound(lista.reduce((s, c) => s + c.total, 0)), qtd: lista.length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── Régua de cobrança: sugestões (vencendo em X dias + vencidos sem cobrança recente) ──
app.get('/api/receber/regua', (req, res) => {
  try {
    const prev = +getConfig('cr_dias_alerta_previo', '3') || 3;
    const titulos = crCarteira().filter(t => t.status !== 'pago');
    const recente = (cid) => { const r = db.prepare('SELECT criado_em FROM cobrancas WHERE cliente_id=? ORDER BY id DESC LIMIT 1').get(cid); return r ? crDias(String(r.criado_em).slice(0, 10), crHojeStr()) : 999; };
    const aVencer = titulos.filter(t => t.status === 'a_vencer' && t.dias_para_vencer != null && t.dias_para_vencer <= prev)
      .map(t => ({ ...t, motivo: 'vence_em_' + t.dias_para_vencer, dias_ultima_cobranca: recente(t.cliente_id) }));
    const vencidos = titulos.filter(t => t.status === 'vencido').map(t => ({ ...t, dias_ultima_cobranca: recente(t.cliente_id) }))
      .filter(t => t.dias_ultima_cobranca >= 3).map(t => ({ ...t, motivo: 'vencido_ha_' + t.dias_atraso }));
    res.json({ a_vencer: aVencer, vencidos, total_sugestoes: aVencer.length + vencidos.length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── Relatórios (posicao | aging | inadimplencia | recebimentos | cobrancas) + ?csv=1 ──
app.get('/api/receber/relatorios/:tipo', (req, res) => {
  try {
    const tipo = req.params.tipo, csv = req.query.csv === '1';
    if (tipo === 'posicao') {
      const titulos = crCarteira().filter(t => t.status !== 'pago').sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999'));
      if (csv) return enviarCSV(req, res, 'posicao_receber.csv', ['Cliente', 'Titulo', 'Vencimento', 'Valor', 'Pago', 'Restante', 'Status', 'Atraso'],
        titulos.map(t => [t.cliente_nome, t.descricao, t.vencimento || '', brl(t.valor), brl(t.valor_pago), brl(t.restante), t.status, t.dias_atraso || 0]), 'receber');
      return res.json({ titulos, resumo: crResumo(titulos) });
    }
    if (tipo === 'aging') {
      const r = crResumo(crCarteira());
      if (csv) return enviarCSV(req, res, 'aging.csv', ['Faixa', 'Valor'],
        [['A vencer', brl(r.aging.a_vencer)], ['1-30 dias', brl(r.aging.d1_30)], ['31-60 dias', brl(r.aging.d31_60)], ['61-90 dias', brl(r.aging.d61_90)], ['90+ dias', brl(r.aging.d90_mais)]], 'receber');
      return res.json(r);
    }
    if (tipo === 'inadimplencia') {
      const titulos = crCarteira().filter(t => t.status === 'vencido');
      if (csv) return enviarCSV(req, res, 'inadimplencia.csv', ['Cliente', 'Telefone', 'Titulo', 'Vencimento', 'Restante', 'Atraso'],
        titulos.map(t => [t.cliente_nome, t.cliente_telefone || '', t.descricao, t.vencimento || '', brl(t.restante), t.dias_atraso]), 'receber');
      return res.json({ titulos });
    }
    if (tipo === 'recebimentos') {
      const de = req.query.de || (crHojeStr().slice(0, 8) + '01'), ate = req.query.ate || crHojeStr();
      const rows = db.prepare(`SELECT e.criado_em, e.valor, e.descricao, e.formas, c.nome cliente_nome
        FROM clientes_extrato e JOIN clientes c ON c.id=e.cliente_id
        WHERE e.tipo='pagamento' AND substr(e.criado_em,1,10) BETWEEN ? AND ? ORDER BY e.criado_em DESC`).all(de, ate);
      if (csv) return enviarCSV(req, res, 'recebimentos.csv', ['Data', 'Cliente', 'Valor', 'Descricao'],
        rows.map(r => [String(r.criado_em).slice(0, 10), r.cliente_nome, brl(r.valor), r.descricao || '']), 'receber');
      return res.json({ recebimentos: rows, total: crRound(rows.reduce((s, r) => s + r.valor, 0)) });
    }
    if (tipo === 'cobrancas') {
      const rows = db.prepare(`SELECT co.*, c.nome cliente_nome FROM cobrancas co JOIN clientes c ON c.id=co.cliente_id ORDER BY co.id DESC LIMIT 500`).all();
      if (csv) return enviarCSV(req, res, 'cobrancas.csv', ['Data', 'Cliente', 'Canal', 'Status', 'Promessa', 'Resultado'],
        rows.map(r => [String(r.criado_em).slice(0, 10), r.cliente_nome, r.canal || '', r.status, r.promessa_data || '', r.resultado || '']), 'receber');
      return res.json({ cobrancas: rows });
    }
    res.status(404).json({ erro: 'Relatório desconhecido.' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── Config + limite de crédito por cliente ────────────────────────────────
app.get('/api/receber/config', (req, res) => res.json({
  prazo_padrao_dias: +getConfig('cr_prazo_padrao_dias', '30'), dias_alerta_previo: +getConfig('cr_dias_alerta_previo', '3'),
  juros_mes: parseFloat(getConfig('cr_juros_mes', '0')) || 0, multa_pct: parseFloat(getConfig('cr_multa_pct', '0')) || 0,
  bloqueio_automatico: getConfig('cr_bloqueio_automatico', '0') === '1', limite_padrao: crRound(getConfig('cr_limite_padrao', '0')),
}));
app.post('/api/receber/config', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const d = req.body || {}, map = { prazo_padrao_dias: 'cr_prazo_padrao_dias', dias_alerta_previo: 'cr_dias_alerta_previo',
    juros_mes: 'cr_juros_mes', multa_pct: 'cr_multa_pct', limite_padrao: 'cr_limite_padrao' };
  for (const [k, chave] of Object.entries(map)) if (d[k] != null) setConfig(chave, String(d[k]));
  if (d.bloqueio_automatico != null) setConfig('cr_bloqueio_automatico', d.bloqueio_automatico ? '1' : '0');
  res.json({ ok: true });
});
app.get('/api/clientes/:id/credito-status', (req, res) => {
  if (!db.prepare('SELECT id FROM clientes WHERE id=?').get(+req.params.id)) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  res.json(crCreditoStatus(+req.params.id));
});
app.put('/api/clientes/:id/credito', (req, res) => {
  if (!gateFinLancar(req, res)) return;
  const id = +req.params.id;
  if (!db.prepare('SELECT id FROM clientes WHERE id=?').get(id)) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const d = req.body || {};
  if (d.limite_credito != null) db.prepare('UPDATE clientes SET limite_credito=? WHERE id=?').run(crRound(d.limite_credito), id);
  if (d.bloqueado != null) db.prepare('UPDATE clientes SET bloqueado=? WHERE id=?').run(d.bloqueado ? 1 : 0, id);
  manut.logAcao('ajuste de crédito do cliente', 'clientes', { id, limite: d.limite_credito, bloqueado: d.bloqueado }, 'admin');
  res.json({ ok: true, credito: crCreditoStatus(id) });
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
  // Fase 16: avisa a Central em tempo real (vale pra recebida, resposta manual e resposta da IA —
  // todas passam por aqui). conversa_atualizada mantém a lista/badge em dia; nao_lidas só p/ entrada.
  realtime.emitir('mensagem_nova', { telefone, direcao, tipo, criado: new Date().toISOString() });
  realtime.emitir('conversa_atualizada', { telefone });
  if (direcao === 'in') realtime.emitir('nao_lidas_atualizadas', { telefone });
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
    // Fase 15: estado da conversa (modo humano/ia + IA por-conversa) pra pintar o indicador da lista
    const est = estadoAtendimento(c.telefone);
    return {
      telefone: c.telefone,
      nome: nomeMsg || (cli && cli.nome) || '',
      ultimoTexto: previa,
      ultimaDirecao: u.direcao || '',
      criado: u.criado || '',
      naoLidas: c.naoLidas || 0,
      estado: { modo: est.modo, ia_ativa: est.ia_ativa, assumido_nome: est.assumido_nome },
    };
  });
  res.json(resultados);
});

// histórico completo de um contato — e marca as recebidas como lidas
app.get('/api/atendimento/mensagens/:telefone', (req, res) => {
  const telefone = req.params.telefone;
  // NÃO traz a coluna "midia" (base64 pesado) na lista — só uma flag; a mídia em si vai pelo endpoint dedicado
  const mensagens = db.prepare('SELECT id, direcao, texto, criado, lido, tipo, (midia IS NOT NULL) AS temMidia, midia_tipo AS midiaTipo FROM mensagens_wpp WHERE telefone = ? ORDER BY id ASC').all(telefone);
  const marcadas = db.prepare("UPDATE mensagens_wpp SET lido = 1 WHERE telefone = ? AND direcao = 'in' AND lido = 0").run(telefone);
  if (marcadas.changes) realtime.emitir('nao_lidas_atualizadas', { telefone }); // Fase 16: outras abas zeram o badge
  const cli = buscarClienteDelivery(telefone);
  res.json({ telefone, cliente: cli, mensagens });
});

// CONTEXTO consolidado do cliente pra COLUNA LATERAL do Atendimento (Fase 4).
// SÓ LEITURA — reaproveita as consultas da Fase 3 (buscarClienteDelivery / ultimoPedidoDoTelefone /
// pedidoAbertoDoTelefone). Não cria estado, não toca em WhatsApp nem na IA: só junta o que já existe
// pra alimentar o painel do cliente (cliente + último pedido + pedido em aberto). Fiado fica no
// front (localStorage do PDV), então não entra aqui.
app.get('/api/atendimento/contexto/:telefone', (req, res) => {
  const telefone = req.params.telefone;
  // Fase 18: o cliente do painel agora é o UNIFICADO (mesma pessoa do PDV/fiado/delivery)
  const uni = resolverClienteUnificado(telefone);
  const cli = buscarClienteDelivery(telefone); // já resolve unificado; mantém o formato do painel
  // Fase 18 — histórico recente e último pedido pelo CLIENTE unificado (casa mesmo se o telefone
  // do pedido veio em outro formato); cai no match exato por telefone só se não houver cliente.
  const historico = uni ? pedidosDoClienteId(uni.id, 5) : [];
  const ultimoPedido = (historico[0]) || ultimoPedidoDoTelefone(telefone);
  // pedidoAbertoDoTelefone tem fallback pro "mais recente qualquer"; aqui só interessa o que está
  // DE VERDADE em andamento — filtra pelo status pra o bloco "Pedido em aberto" não mostrar entregue.
  const EM_ABERTO = new Set(['pendente', 'preparo', 'pronto', 'rota']);
  const abertoRaw = pedidoAbertoDoTelefone(telefone);
  const pedidoAberto = (abertoRaw && EM_ABERTO.has(abertoRaw.status)) ? abertoRaw : null;
  if (pedidoAberto) pedidoAberto.entregador_nome = nomeEntregador(pedidoAberto.entregador_id); // Fase 22: quem está levando
  // Fase 18 — fiado do MESMO cliente unificado (id direto; sem depender da heurística de últimos dígitos)
  const fiado = uni ? { encontrado: true, nome: uni.nome, saldo: saldoDoClienteDb(uni.id) } : { encontrado: false };
  res.json({
    telefone,
    cliente: cli ? { ...cli, conhecido: true } : { conhecido: false },
    clienteId: uni ? uni.id : null,
    ultimoPedido: ultimoPedido || null,
    pedidoAberto,
    fiado,
    historico,
    estado: estadoAtendimento(telefone), // Fase 15: modo (ia/humano), IA por-conversa, quem assumiu, obs
  });
});

// ── Estado de atendimento POR CONVERSA (Fase 15) ─────────────────────────────
// Controla quem responde cada conversa (IA x humano) e as observações do operador.
// GET é leitura; os demais alteram o estado e ficam no log de ações.
// Permissão (Parte 8): qualquer logado ASSUME; devolver à IA / liberar uma conversa
// assumida por OUTRO operador exige supervisor/admin (ou janela de supervisor).
function souDonoOuSupervisor(req, est) {
  const u = req.usuario || {};
  if (!est.assumido_por || est.assumido_por === u.usuario_id) return true;          // ninguém assumiu, ou fui eu
  if (u.perfil === 'admin' || u.perfil === 'supervisor') return true;
  if (u.supervisor_ate && u.supervisor_ate > new Date().toISOString()) return true; // operador com janela de supervisor aberta
  return false;
}

app.get('/api/atendimento/estado/:telefone', (req, res) => {
  res.json(estadoAtendimento(req.params.telefone));
});

// Fase 16: avisa todos os clientes (todas as abas) que o estado de uma conversa mudou (compacto)
const emitirEstado = (telefone, e) => realtime.emitir('estado_atendimento_alterado', {
  telefone, estado: { modo: e.modo, ia_ativa: e.ia_ativa, assumido_nome: e.assumido_nome, obs: e.obs },
});

// Atualização genérica do estado (modo / ia_ativa / obs) — partial update.
app.put('/api/atendimento/estado/:telefone', (req, res) => {
  const telefone = req.params.telefone;
  const b = req.body || {};
  const est = estadoAtendimento(telefone);
  const querReligar = b.modo === 'ia' || b.ia_ativa === 1 || b.ia_ativa === true;
  if (querReligar && !souDonoOuSupervisor(req, est)) {
    return res.status(403).json({ erro: 'Só o operador que assumiu (ou um supervisor) pode devolver esta conversa à IA.' });
  }
  const campos = {};
  if (b.modo !== undefined) campos.modo = b.modo === 'humano' ? 'humano' : 'ia';
  if (b.ia_ativa !== undefined) campos.ia_ativa = b.ia_ativa ? 1 : 0;
  if (b.obs !== undefined) campos.obs = String(b.obs).slice(0, 2000);
  const e = upsertEstado(telefone, campos);
  manut.logAcao('atendimento atualizado', 'atendimento', { telefone, campos: Object.keys(campos), por: (req.usuario || {}).usuario || null }, 'operacao');
  emitirEstado(telefone, e);
  res.json(e);
});

// ASSUME a conversa: entra em modo humano e DESLIGA a IA automática dessa conversa.
app.post('/api/atendimento/assumir/:telefone', (req, res) => {
  const telefone = req.params.telefone;
  const u = req.usuario || {};
  const e = upsertEstado(telefone, {
    modo: 'humano', ia_ativa: 0,
    assumido_por: u.usuario_id || null, assumido_nome: u.nome || u.usuario || null,
    assumido_em: new Date().toISOString(),
  });
  manut.logAcao('atendimento assumido', 'atendimento', { telefone, por: u.usuario || null }, 'operacao');
  emitirEstado(telefone, e);
  res.json(e);
});

// LIBERA a conversa: volta pro automático (modo ia) e RELIGA a IA. Liberar o atendimento
// assumido por OUTRO operador exige supervisor/admin (Parte 8).
app.post('/api/atendimento/liberar/:telefone', (req, res) => {
  const telefone = req.params.telefone;
  const est = estadoAtendimento(telefone);
  if (!souDonoOuSupervisor(req, est)) {
    manut.logAcao('liberar negado', 'atendimento', { telefone, por: (req.usuario || {}).usuario || null, assumidoPor: est.assumido_nome }, 'seguranca');
    return res.status(403).json({ erro: 'Este atendimento foi assumido por outro operador — só um supervisor pode liberar.' });
  }
  const e = upsertEstado(telefone, { modo: 'ia', ia_ativa: 1, assumido_por: null, assumido_nome: null, assumido_em: null });
  manut.logAcao('atendimento liberado', 'atendimento', { telefone, por: (req.usuario || {}).usuario || null }, 'operacao');
  emitirEstado(telefone, e);
  res.json(e);
});

// Liga/desliga a IA SÓ nesta conversa. body: { ativa: true|false }.
// Religar a IA de conversa assumida por OUTRO exige supervisor/admin.
app.put('/api/atendimento/ia/:telefone', (req, res) => {
  const telefone = req.params.telefone;
  const ativa = !!(req.body && req.body.ativa);
  const est = estadoAtendimento(telefone);
  if (ativa && !souDonoOuSupervisor(req, est)) {
    return res.status(403).json({ erro: 'Este atendimento foi assumido por outro operador — só um supervisor pode religar a IA.' });
  }
  const u = req.usuario || {};
  const jaAssumido = est.modo === 'humano' && est.assumido_por; // preserva quem já tinha assumido
  const e = upsertEstado(telefone, ativa
    ? { ia_ativa: 1, modo: 'ia', assumido_por: null, assumido_nome: null, assumido_em: null }
    : { ia_ativa: 0, modo: 'humano', ...(jaAssumido ? {} : { assumido_por: u.usuario_id || null, assumido_nome: u.nome || u.usuario || null, assumido_em: new Date().toISOString() }) });
  manut.logAcao(ativa ? 'ia ligada na conversa' : 'ia desligada na conversa', 'atendimento', { telefone, por: u.usuario || null }, 'operacao');
  emitirEstado(telefone, e);
  res.json(e);
});

// Observações INTERNAS do operador sobre a conversa (NUNCA vão pro cliente). body: { obs }
app.put('/api/atendimento/obs/:telefone', (req, res) => {
  const telefone = req.params.telefone;
  const obs = String((req.body && req.body.obs) || '').slice(0, 2000);
  const e = upsertEstado(telefone, { obs });
  manut.logAcao('observação alterada', 'atendimento', { telefone, por: (req.usuario || {}).usuario || null }, 'operacao');
  emitirEstado(telefone, e);
  res.json(e);
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
  realtime.emitir('conversa_atualizada', { telefone: req.params.telefone, removida: true }); // Fase 16
  res.json({ ok: true, removidas: r.changes });
});

// (Ferramentas da IA — criar_pedido / alterar_pedido + o executor — foram pra backend/ia/tools.js.)

// (Prompt do sistema — montarPromptSistemaIA — foi pra backend/ia/prompt.js.)

// (Orquestrador processarMensagemIA + providers OpenAI/Anthropic + semImagens foram pra backend/ia/.
//  O server.js recebe `processarMensagemIA` e `iaAtiva` via a fiação da camada de IA, acima.)

app.post('/api/atendimento-ia/webhook', async (req, res) => {
  // protege o webhook assim que ele fica exposto na internet (túnel/produção) — sem isso,
  // qualquer um que descobrisse a URL poderia mandar mensagem falsa e criar pedido fictício
  if (process.env.WEBHOOK_SECRET && req.get('X-Webhook-Secret') !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ erro: 'Não autorizado.' });
  }
  const { telefone, nome, mensagem, imagem, imagemTipo } = req.body || {};
  if (!telefone || (!mensagem && !imagem)) return res.status(400).json({ erro: 'Campos "telefone" e "mensagem" (ou "imagem") são obrigatórios.' });
  // Fase 15: se a conversa está com humano no comando (ou IA desligada nela), a IA não responde por este canal também.
  if (!conversaAceitaIA(telefone)) return res.status(200).json({ ignorado: true, motivo: 'atendimento humano nesta conversa' });
  const img = imagem ? { data: imagem, mediaType: imagemTipo || 'image/jpeg' } : null;
  const resultado = await processarMensagemIA(telefone, nome, mensagem, img);
  res.status(resultado.erro ? (iaAtiva ? 500 : 503) : 200).json(resultado);
});

// CACHE-BUSTING DEFINITIVO: serve o index.html injetando ?v=<BOOT_ID> nos assets
// (css/js) — o BOOT_ID muda a cada início do servidor (= a cada atualização), então o
// navegador é OBRIGADO a baixar o app.js/style.css novos. Fim do "atualizei e ficou velho".
const BOOT_ID = Date.now();
function servirIndex(req, res) {
  try {
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    html = html.replace(/(href|src)="((?:css|js)\/[^"?]+\.(?:css|js))"/g, '$1="$2?v=' + BOOT_ID + '"');
    res.set('Cache-Control', 'no-store').type('html').send(html);
  } catch { res.sendFile(path.join(__dirname, 'public', 'index.html')); }
}
app.get('/', servirIndex);
app.get('/index.html', servirIndex);

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
  realtime.emitir('whatsapp_status', { pronto: false, temQr: true }); // Fase 16
});
whatsapp.on('ready', () => { whatsappPronto = true; ultimoQR = null; console.log('✅ WhatsApp conectado — avisos de saldo serão enviados automaticamente.'); realtime.emitir('whatsapp_status', { pronto: true, temQr: false }); corrigirLidsExistentes(); });

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
// Reconexão única e sequenciada: destrói o cliente atual (fecha o Chrome, solta o lockfile da
// sessão) ANTES de reiniciar, pra não cair no "browser is already running". A trava evita duas
// reconexões ao mesmo tempo (o LOGOUT + o botão da tela chegando juntos foi o que quebrou hoje).
let reconectandoWhatsapp = false;
async function reconectarWhatsapp() {
  if (reconectandoWhatsapp) return;
  reconectandoWhatsapp = true;
  try { await whatsapp.destroy(); } catch {}
  try { await whatsapp.initialize(); }
  catch (err) { console.log('❌ Falha ao reconectar o WhatsApp:', err.message); }
  finally { reconectandoWhatsapp = false; }
}
whatsapp.on('disconnected', (motivo) => {
  whatsappPronto = false;
  ultimoQR = null;
  realtime.emitir('whatsapp_status', { pronto: false, temQr: false }); // Fase 16
  console.log(`⚠️ WhatsApp desconectado (${motivo}) — tentando reconectar em 8s...`);
  // reconecta pela sessão salva OU gera um QR novo (que aparece na tela inicial)
  setTimeout(reconectarWhatsapp, 8000);
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
  // ignora: enviadas por mim, grupos, status e listas de transmissão/canais (não são clientes)
  if (message.fromMe || message.from.endsWith('@g.us') || message.from.endsWith('@broadcast') || message.from.endsWith('@newsletter')) return;
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

  // resposta automática por IA: responde QUALQUER cliente que escrever (independe do número conectado),
  // desde que o "Atendimento automático" esteja LIGADO na tela e haja chave de IA configurada.
  // Fase 15: e a CONVERSA específica aceite IA (não está com humano no comando nem com a IA desligada).
  if (iaAtiva && iaAutoLigada() && conversaAceitaIA(telefone)) {
    // se o cliente mandou foto (provável comprovante do PIX), passa a imagem pra IA conferir
    const img = (extras.tipo === 'image' && extras.midia) ? { data: extras.midia, mediaType: extras.midiaTipo } : null;
    // a IA precisa de texto NÃO-vazio; se veio só mídia (figurinha/áudio/vídeo), manda um marcador
    // (senão a chamada falha com "user messages must have non-empty content")
    let mensagemParaIA = message.body || '';
    if (!mensagemParaIA.trim() && !img) {
      const marcador = { ptt: '(o cliente enviou um áudio de voz)', audio: '(o cliente enviou um áudio)', sticker: '(o cliente enviou uma figurinha)', video: '(o cliente enviou um vídeo)', document: '(o cliente enviou um arquivo)' };
      mensagemParaIA = marcador[message.type] || '(o cliente enviou uma mídia sem texto)';
    }
    const resultado = await processarMensagemIA(telefone, nome, mensagemParaIA, img);
    if (resultado.erro) { console.log(`⚠️ Não respondida (${resultado.erro})`); return; }
    try {
      await message.reply(resultado.resposta);
      salvarMensagemWpp(telefone, nome, 'out', resultado.resposta, chatId);
    } catch (err) { console.log('❌ Falha ao responder no WhatsApp:', err.message); }
  }
});

// WA_DISABLE=1 pula o WhatsApp (útil para testes/manutenção sem acionar o Chrome). Padrão: liga normalmente.
// PERFORMANCE: o WhatsApp sobe o Chrome do Puppeteer (pesado, ~vários segundos). Pra o sistema ABRIR
// RÁPIDO, NÃO iniciamos aqui — adiamos pra DEPOIS do servidor já estar no ar (ver app.listen), em 2º plano.
let whatsappAgendado = false;
function iniciarWhatsappEmBackground() {
  if (whatsappAgendado) return; whatsappAgendado = true;
  if (process.env.WA_DISABLE === '1') { console.log('⚠️  WhatsApp desativado (WA_DISABLE=1) — avisos automáticos não serão enviados.'); return; }
  console.log('… iniciando WhatsApp em segundo plano (não trava a abertura)');
  whatsapp.initialize().catch(err => console.log('❌ Não foi possível iniciar o cliente WhatsApp:', err.message));
}

app.get('/api/whatsapp/status', (req, res) => res.json({
  pronto: whatsappPronto,
  temQr: !!ultimoQR,
  // número/nome de QUEM está conectado agora — é este WhatsApp que envia as mensagens
  numero: whatsappPronto ? ((whatsapp.info && whatsapp.info.wid && whatsapp.info.wid.user) || null) : null,
  nome: whatsappPronto ? ((whatsapp.info && whatsapp.info.pushname) || null) : null,
}));

// (Re)conectar a pedido do usuário (botão na tela): destrói o cliente travado e reinicia,
// gerando um QR Code novo (que aparece no painel). Não faz nada se já estiver conectado.
app.post('/api/whatsapp/conectar', async (req, res) => {
  if (whatsappPronto) return res.json({ ok: true, jaConectado: true });
  ultimoQR = null;
  console.log('🔌 (Re)iniciando conexão do WhatsApp a pedido do usuário...');
  reconectarWhatsapp(); // reconexão única e travada — o QR chega pelo evento
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
// números BR às vezes vêm sem o 55 (ex.: 91992207690) — sem o código do país o getNumberId não resolve.
// Põe o 55 quando é número nacional (10-11 dígitos) e deixa o getNumberId cuidar da pegadinha do 9º dígito.
function normalizarNumeroBR(digitos) {
  let d = (digitos || '').replace(/\D/g, '');
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = '55' + d;
  return d;
}
async function enviarMensagemWhatsapp(digitos, mensagem) {
  if (!whatsappPronto) {
    console.log(`⚠️ Tentativa de envio com WhatsApp ainda não conectado (telefone ${digitos})`);
    return { ok: false, status: 503, erro: 'WhatsApp ainda não conectado — escaneie o QR Code na tela de Clientes.' };
  }
  digitos = normalizarNumeroBR(digitos);
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

const PORTA = process.env.PORT ? +process.env.PORT : 3001;
const servidor = app.listen(PORTA, () => {
  console.log('✅ PROGRAMA AÇAÍ rodando em http://localhost:' + PORTA);
  manut.iniciarAgendador(); // Fase 11 — backup diário (03:00; ou na 1ª inicialização do dia)
  // Fase 37 — verificação de consistência no boot (só loga; não bloqueia nem altera nada)
  try {
    const c = consistenciaERP();
    console.log(`   Schema: ${SCHEMA_VERSAO} · saúde do ERP: ${c.status_geral === 'ok' ? '✅ consistente' : `⚠️ ${c.alertas} ponto(s) p/ conferir`}`);
    if (c.status_geral !== 'ok') c.checks.filter(x => x.status === 'alerta').forEach(x => console.log(`     ⚠️ ${x.titulo}: ${x.detalhe}`));
  } catch (e) { console.log('   (verificação de consistência falhou:', e.message, ')'); }
  // WhatsApp em SEGUNDO PLANO, alguns segundos depois — o sistema já abriu e responde; o Chrome do
  // WhatsApp sobe sem competir com a abertura. Avisos/atendimento ficam prontos logo em seguida.
  setTimeout(iniciarWhatsappEmBackground, 4000);
});

// Fase 37 — graceful shutdown: faz checkpoint do WAL e fecha o banco limpo ao encerrar.
let encerrando = false;
function encerrar(sinal) {
  if (encerrando) return; encerrando = true;
  console.log(`\n⏹️  Encerrando (${sinal})…`);
  try { servidor.close(); } catch {}
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  try { db.close(); console.log('   Banco fechado com segurança.'); } catch (e) { console.log('   Falha ao fechar banco:', e.message); }
  process.exit(0);
}
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
// porta ocupada é fatal (já tem outro servidor rodando) — encerra claro, sem virar zumbi
// (a blindagem global cobre erros do WhatsApp em runtime, não a subida do servidor)
servidor.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.log('❌ Porta 3001 já em uso — outro Programa Açaí já está rodando. Encerrando este.');
  else console.log('❌ Erro no servidor HTTP:', err.message);
  process.exit(1);
});
