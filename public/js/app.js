/* ═══════════════════════════════════════════════════════════
   PROGRAMA AÇAÍ — App
   ═══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const fmt = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');

/* ── Toast ───────────────────────────────────────────────── */
let toastTimer;
function toast(msg, tipo = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (tipo ? ' ' + tipo : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ── Relógio ─────────────────────────────────────────────── */
setInterval(() => {
  $('relogio').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}, 1000);

/* ── Navegação entre telas ───────────────────────────────── */
const SECOES = { home: 'Início', pdv: 'Vendas (PDV)', delivery: 'Delivery', produtos: 'Produtos / Estoque', clientes: 'Clientes', atendimento: 'Atendimento' };

function irPara(tela) {
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  const alvo = $('tela-' + tela);
  if (!alvo) return;
  alvo.classList.add('ativa');
  $('topbar-secao').textContent = SECOES[tela] || '';
  document.querySelectorAll('.btn-topmenu').forEach(b => b.classList.toggle('ativo', b.dataset.ir === tela));
  if (tela === 'pdv') setTimeout(() => $('codigo').focus(), 50);
  if (tela === 'delivery') { renderDelivery(); iniciarPollPedidos(); carregarEstadoLoja(); }
  else { pararPollPedidos(); }
  if (tela === 'produtos') { esconderDetalheProduto(); renderProdutos(); atualizarMargemForm(); setTimeout(() => $('pf-nota').focus(), 60); }
  if (tela === 'clientes') { esconderDetalheCliente(); setTimeout(() => $('cl-nome').focus(), 60); }
  if (tela === 'clientes' || tela === 'home') atualizarStatusWhatsapp();
  else pararPollWhatsapp();
  if (tela === 'atendimento') { abrirAtendimento(); }
  else { pararPollAtendimento(); }
}

// Cartões do menu principal
document.querySelectorAll('.modulo-card[data-ir]').forEach(card => {
  card.addEventListener('click', () => { if (!card.disabled) irPara(card.dataset.ir); });
});
// Menu da topbar (Início, Delivery)
document.querySelectorAll('.btn-topmenu[data-ir]').forEach(b =>
  b.addEventListener('click', () => irPara(b.dataset.ir)));
$('btn-home-logo').addEventListener('click', () => irPara('home'));

/* ── Tecla ESC: voltar (fecha o modal aberto ou volta ao Início) ── */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('app-principal').classList.contains('oculto')) return;        // na tela de login, ignora
  if ($('overlay-supervisor').classList.contains('aberto')) { e.preventDefault(); fecharSupervisor(false); return; }
  if ($('overlay-cartao-tipo').classList.contains('aberto')) { e.preventDefault(); fecharCartaoTipo(); return; }
  // busca por nome pode abrir POR CIMA do form de produtos, do recebimento ou do rendimento —
  // tem que fechar primeiro (revela o que tinha por baixo), senão o Esc fecha o de baixo direto
  if ($('overlay-busca').classList.contains('aberto'))       { e.preventDefault(); fecharBusca(); return; }
  if ($('overlay-rendimento').classList.contains('aberto'))  { e.preventDefault(); fecharRendimento(); return; }
  if ($('overlay-item').classList.contains('aberto'))        { e.preventDefault(); fecharEditarItem(); return; }
  if ($('overlay-recebimento').classList.contains('aberto')) { e.preventDefault(); fecharRecebimento(); return; }
  if ($('overlay-pedido').classList.contains('aberto'))      { e.preventDefault(); fecharModal(); return; }
  if ($('overlay-clientes-delivery').classList.contains('aberto')) { e.preventDefault(); $('overlay-clientes-delivery').classList.remove('aberto'); return; }
  if ($('overlay-disponibilidade').classList.contains('aberto')) { e.preventDefault(); fecharDisponibilidade(); return; }
  if (!$('tela-home').classList.contains('ativa'))           { e.preventDefault(); irPara('home'); }
});

/* ═══════════════════════════════════════════════════════════
   PDV — Espelho do Cupom
   ═══════════════════════════════════════════════════════════ */
let itensCupom = [];

/* Catálogo semente (usado só se ainda não há produtos salvos) — cardápio real
   (por litro, com variações de qualidade) confirmado nas conversas reais do
   BotConversa em 29/06/2026, não o catálogo genérico chutado no início do projeto. */
const PRODUTOS_SEED = [
  { codigo:'ACAI-POP',    nome:'Açaí Popular (por litro)', precoVenda:10, precoCompra:5.00,  estoque:50, estoqueMin:10, departamento:'Açaí',         fornecedor:'', conjunto:'' },
  { codigo:'ACAI-TOP',    nome:'Açaí Top (por litro)',     precoVenda:15, precoCompra:7.50,  estoque:50, estoqueMin:10, departamento:'Açaí',         fornecedor:'', conjunto:'' },
  { codigo:'ACAI-GROSSO', nome:'Açaí Grosso (por litro)',  precoVenda:20, precoCompra:10.00, estoque:40, estoqueMin:8,  departamento:'Açaí',         fornecedor:'', conjunto:'' },
  { codigo:'FARINHA',     nome:'Farinha',                  precoVenda:10, precoCompra:5.00,  estoque:60, estoqueMin:10, departamento:'Complementos', fornecedor:'', conjunto:'' },
  { codigo:'TAPIOCA',     nome:'Tapioca regional',         precoVenda:5,  precoCompra:2.50,  estoque:60, estoqueMin:10, departamento:'Complementos', fornecedor:'', conjunto:'' },
  { codigo:'SARDINHA',    nome:'Sardinha Gomes da Costa',  precoVenda:7,  precoCompra:3.50,  estoque:60, estoqueMin:10, departamento:'Complementos', fornecedor:'', conjunto:'' },
];
let PRODUTOS = [];
let insumos = [];
let vendasLog = [];
let comprasLog = [];
let receitasRendimento = {};   // { 'saca de açaí': [{cod,desc,preco}, ...] } — última composição de cada matéria-prima

function carregarEstoque() {
  // Semente só na 1ª vez (chave inexistente). Array vazio salvo = limpou de propósito → fica vazio.
  try { const s = JSON.parse(localStorage.getItem('acai_produtos') || 'null'); PRODUTOS = Array.isArray(s) ? s : PRODUTOS_SEED.map(p => ({ ...p })); }
  catch { PRODUTOS = PRODUTOS_SEED.map(p => ({ ...p })); }
  // produtos antigos não tinham o campo "disponivel" — assume disponível por padrão
  PRODUTOS.forEach(p => { if (p.disponivel === undefined) p.disponivel = true; });
  fetch('/api/produtos/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(PRODUTOS) }).catch(() => {});
  try { insumos = JSON.parse(localStorage.getItem('acai_insumos') || '[]'); } catch { insumos = []; }
  try { vendasLog = JSON.parse(localStorage.getItem('acai_vendas') || '[]'); } catch { vendasLog = []; }
  try { comprasLog = JSON.parse(localStorage.getItem('acai_compras') || '[]'); } catch { comprasLog = []; }
  try { receitasRendimento = JSON.parse(localStorage.getItem('acai_receitas_rendimento') || '{}'); } catch { receitasRendimento = {}; }
}
function salvarEstoque() {
  localStorage.setItem('acai_produtos', JSON.stringify(PRODUTOS));
  // espelha o catálogo no servidor (fire-and-forget) — é de lá que o atendimento por IA lê o cardápio
  fetch('/api/produtos/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(PRODUTOS) }).catch(() => {});
}
function salvarInsumos()  { localStorage.setItem('acai_insumos', JSON.stringify(insumos)); }
function salvarReceitasRendimento() { localStorage.setItem('acai_receitas_rendimento', JSON.stringify(receitasRendimento)); }
function salvarVendasLog(){ localStorage.setItem('acai_vendas', JSON.stringify(vendasLog)); }
function salvarComprasLog(){ localStorage.setItem('acai_compras', JSON.stringify(comprasLog)); }

function buscarPorCodigo(cod) {
  return PRODUTOS.find(p => p.codigo.toLowerCase() === cod.toLowerCase());
}
/* Cód. conjunto = código alternativo pra vender a CAIXA inteira (pacote) do produto */
function buscarPorConjunto(cod) {
  return PRODUTOS.find(p => p.conjunto && p.conjunto.toLowerCase() === cod.toLowerCase());
}
function adicionarProduto(prod, qtd = 1, pacote = false) {
  const unidConsumo = pacote ? (+prod.unidPorCaixa || 1) : 1;
  const preco = pacote ? (+prod.precoVendaCaixa || prod.precoVenda * unidConsumo) : prod.precoVenda;
  const ex = itensCupom.find(i => i.cod === prod.codigo && !!i.pacote === pacote);
  let idx;
  if (ex) { ex.qtd += qtd; idx = itensCupom.indexOf(ex); }
  else { itensCupom.push({ cod: prod.codigo, desc: prod.nome, qtd, preco, pacote, unidConsumo }); idx = itensCupom.length - 1; }
  renderCupom();
  // confirmação visual no item afetado
  const linha = $('espelho-itens').querySelector(`.item-linha[data-idx="${idx}"]`);
  if (linha) {
    linha.classList.add('flash');
    setTimeout(() => linha.classList.remove('flash'), 600);
    linha.scrollIntoView({ block: 'nearest' });
  }
  // aviso discreto de estoque insuficiente (não bloqueia a venda) — considera quanto a caixa consome de fato
  if (typeof prod.estoque === 'number' && itensCupom[idx].qtd * unidConsumo > prod.estoque) {
    toast(`⚠ Estoque baixo: ${prod.nome} (${prod.estoque} em estoque)`);
  }
}

/* Bip de erro (código não cadastrado) via Web Audio */
let audioCtx = null;
function bipErro() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = 200;
    o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.18, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    o.start();
    o.stop(audioCtx.currentTime + 0.25);
  } catch (e) {}
}

/* Campo de código: Enter registra · duplo-espaço abre a busca por nome */
let ultimoEspaco = 0;
$('codigo').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    let entrada = $('codigo').value.trim();
    if (!entrada) return;
    let qtd = 1;
    // suporta "qtd*código" (ex: 3*A500, 1,5*A500)
    if (entrada.includes('*')) {
      const [q, c] = entrada.split('*');
      const qn = parseFloat((q || '').replace(',', '.'));
      if (qn > 0) qtd = qn;
      entrada = (c || '').trim();
    }
    const prod = buscarPorCodigo(entrada);
    if (prod) adicionarProduto(prod, qtd);
    else {
      const prodPacote = buscarPorConjunto(entrada);
      if (prodPacote) adicionarProduto(prodPacote, qtd, true);
      else { toast('❌ Código não cadastrado'); bipErro(); falar('Produto não cadastrado'); }
    }
    $('codigo').value = '';
    return;
  }
  // duplo-espaço (campo vazio) → busca por nome
  if (e.key === ' ' && $('codigo').value.trim() === '') {
    e.preventDefault();                      // não digita espaço no código
    const agora = Date.now();
    if (agora - ultimoEspaco < 450) { ultimoEspaco = 0; abrirBuscaProduto(); }
    else ultimoEspaco = agora;
  }
  // ↓/↑ com o campo vazio → entra na lista do espelho pra selecionar item
  if ($('codigo').value.trim() === '' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const items = $('espelho-itens').querySelectorAll('.item-linha');
    if (items.length) {
      e.preventDefault();
      (e.key === 'ArrowDown' ? items[0] : items[items.length - 1]).focus();
    }
  }
});

/* Limpar a venda inteira */
$('btn-limpar-venda').addEventListener('click', () => {
  if (itensCupom.length === 0) return;
  if (confirm('Limpar todos os itens desta venda?')) {
    itensCupom = [];
    renderCupom();
    $('codigo').focus();
  }
});

/* Clicar em área vazia do PDV devolve o foco ao código (operador sem mouse) */
$('tela-pdv').addEventListener('click', e => {
  if (!e.target.closest('input, button, select, a, label, .item-linha')) $('codigo').focus();
});

function renderCupom() {
  const el = $('espelho-itens');
  $('btn-limpar-venda').disabled = itensCupom.length === 0;
  if (itensCupom.length === 0) {
    el.innerHTML = '<div class="espelho-vazio">Nenhum item registrado</div>';
    $('contador').textContent = '0 itens';
    $('espelho-total').textContent = fmt(0);
    return;
  }
  el.innerHTML = itensCupom.map((it, i) => `
    <div class="item-linha" tabindex="0" data-idx="${i}" title="2× clique ou Enter para alterar">
      <span class="cod">${it.cod}</span>
      <span class="desc">${it.desc}${it.pacote ? ' <small class="tag-pacote">caixa</small>' : ''}</span>
      <span class="qtd">${it.qtd}</span>
      <span class="total">${fmt(it.qtd * it.preco)}</span>
    </div>`).join('');
  const total = itensCupom.reduce((s, it) => s + it.qtd * it.preco, 0);
  const q = itensCupom.reduce((s, it) => s + it.qtd, 0);
  $('contador').textContent = `${q} ${q === 1 ? 'item' : 'itens'}`;
  $('espelho-total').textContent = fmt(total);
  el.scrollTop = el.scrollHeight;
}

/* ── Alterar item do espelho (2× clique no mouse ou Enter no teclado) ── */
let itemEditIndex = -1;

$('espelho-itens').addEventListener('dblclick', e => {
  const linha = e.target.closest('.item-linha');
  if (linha) abrirEditarItem(+linha.dataset.idx);
});
$('espelho-itens').addEventListener('keydown', e => {
  const linha = e.target.closest('.item-linha');
  if (!linha) return;
  if (e.key === 'Enter')          { e.preventDefault(); abrirEditarItem(+linha.dataset.idx); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (linha.nextElementSibling) linha.nextElementSibling.focus(); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); linha.previousElementSibling ? linha.previousElementSibling.focus() : $('codigo').focus(); }
  else if (e.key === 'Delete')    { e.preventDefault(); itensCupom.splice(+linha.dataset.idx, 1); renderCupom(); $('codigo').focus(); }
});

function abrirEditarItem(idx) {
  const it = itensCupom[idx];
  if (!it) return;
  itemEditIndex = idx;
  $('item-edit-nome').textContent = ((it.desc && it.desc !== '—') ? it.desc : it.cod) + (it.pacote ? ' (caixa)' : '');
  $('item-qtd').value = it.qtd;
  $('item-preco').value = (+it.preco).toFixed(2);
  atualizarSubtotalItem();
  $('overlay-item').classList.add('aberto');
  setTimeout(() => { $('item-qtd').focus(); $('item-qtd').select(); }, 60);
}
function fecharEditarItem() {
  $('overlay-item').classList.remove('aberto');
  itemEditIndex = -1;
  setTimeout(() => $('codigo').focus(), 50);
}
function atualizarSubtotalItem() {
  const q = +$('item-qtd').value || 0;
  const p = +$('item-preco').value || 0;
  $('item-edit-subtotal').textContent = fmt(q * p);
}
function salvarEditarItem() {
  if (itemEditIndex < 0) return;
  const q = +$('item-qtd').value || 0;
  const p = +$('item-preco').value || 0;
  if (q <= 0) itensCupom.splice(itemEditIndex, 1);
  else { itensCupom[itemEditIndex].qtd = q; itensCupom[itemEditIndex].preco = p; }
  renderCupom();
  fecharEditarItem();
}
function removerEditarItem() {
  if (itemEditIndex < 0) return;
  itensCupom.splice(itemEditIndex, 1);
  renderCupom();
  fecharEditarItem();
}
$('item-qtd-menos').addEventListener('click', () => { $('item-qtd').value = Math.max(0, (+$('item-qtd').value || 0) - 1); atualizarSubtotalItem(); });
$('item-qtd-mais').addEventListener('click',  () => { $('item-qtd').value = (+$('item-qtd').value || 0) + 1; atualizarSubtotalItem(); });
$('item-qtd').addEventListener('input', atualizarSubtotalItem);
$('item-preco').addEventListener('input', atualizarSubtotalItem);
$('btn-salvar-item').addEventListener('click', salvarEditarItem);
$('btn-remover-item').addEventListener('click', removerEditarItem);
$('btn-fechar-item').addEventListener('click', fecharEditarItem);
$('overlay-item').addEventListener('click', e => { if (e.target === $('overlay-item')) fecharEditarItem(); });
[$('item-qtd'), $('item-preco')].forEach(inp =>
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); salvarEditarItem(); } }));

/* ── Busca de produto por nome (duplo-espaço) ────────────── */
let buscaResultados = [];
let buscaIndice = 0;
let buscaContexto = 'pdv';   // 'pdv' adiciona ao carrinho · 'produtos' carrega no formulário · 'rendimento' preenche a linha do processamento · 'materia' carrega a receita · 'clientes' carrega o cliente no formulário · 'recebimento-fiado' escolhe o cliente do fiado no PDV
let rendLinhaAtual = null;   // linha do modal Rendimento que disparou a busca (contexto 'rendimento')
const BUSCA_PLACEHOLDER = {
  pdv: '🔍 Buscar produto pelo nome...', produtos: '🔍 Buscar produto pelo nome...',
  rendimento: '🔍 Buscar produto pelo nome...', materia: '🔍 Buscar matéria-prima já processada...',
  clientes: '🔍 Buscar cliente pelo nome...', 'recebimento-fiado': '🔍 Buscar cliente pelo nome...',
};

function abrirBuscaProduto(contexto = 'pdv') {
  buscaContexto = contexto;
  $('overlay-busca').classList.add('aberto');
  $('busca-input').placeholder = BUSCA_PLACEHOLDER[contexto] || BUSCA_PLACEHOLDER.pdv;
  $('busca-input').value = '';
  renderBusca('');
  setTimeout(() => $('busca-input').focus(), 60);
}
function fecharBusca() {
  $('overlay-busca').classList.remove('aberto');
  if (buscaContexto === 'pdv') $('codigo').focus();
  else if (buscaContexto === 'rendimento' && rendLinhaAtual) rendLinhaAtual.querySelector('.rl-desc').focus();
  else if (buscaContexto === 'materia') $('rend-materia').focus();
  else if (buscaContexto === 'clientes') $('cl-nome').focus();
  else if (buscaContexto === 'recebimento-fiado') $('receb-fiado-cliente').focus();
}
function renderBusca(termo) {
  termo = termo.trim().toLowerCase();
  const el = $('busca-resultados');

  if (buscaContexto === 'materia') {
    buscaResultados = Object.values(receitasRendimento).filter(r => !termo || r.nomeOriginal.toLowerCase().includes(termo));
    buscaIndice = 0;
    if (buscaResultados.length === 0) {
      el.innerHTML = '<div class="busca-vazio">Nenhuma matéria-prima processada ainda</div>';
      return;
    }
    el.innerHTML = buscaResultados.map((r, i) => `
      <div class="busca-item ${i === buscaIndice ? 'sel' : ''}" data-i="${i}">
        <span class="bi-cod">🫐</span>
        <span class="bi-nome">${r.nomeOriginal}</span>
        <span class="bi-preco">${r.itens.length} produto${r.itens.length > 1 ? 's' : ''}</span>
      </div>`).join('');
    el.querySelectorAll('.busca-item').forEach(it =>
      it.addEventListener('click', () => selecionarBusca(+it.dataset.i)));
    return;
  }

  if (buscaContexto === 'clientes' || buscaContexto === 'recebimento-fiado') {
    buscaResultados = CLIENTES.filter(c => !termo || c.nome.toLowerCase().includes(termo) || (c.telefone || '').includes(termo));
    buscaIndice = 0;
    if (buscaResultados.length === 0) {
      el.innerHTML = '<div class="busca-vazio">Nenhum cliente encontrado</div>';
      return;
    }
    el.innerHTML = buscaResultados.map((c, i) => `
      <div class="busca-item ${i === buscaIndice ? 'sel' : ''}" data-i="${i}">
        <span class="bi-cod">👤</span>
        <span class="bi-nome">${c.nome}</span>
        <span class="bi-preco">${fmt(saldoCliente(c))}</span>
      </div>`).join('');
    el.querySelectorAll('.busca-item').forEach(it =>
      it.addEventListener('click', () => selecionarBusca(+it.dataset.i)));
    return;
  }

  buscaResultados = PRODUTOS.filter(p =>
    !termo || p.nome.toLowerCase().includes(termo) || p.codigo.toLowerCase().includes(termo));
  buscaIndice = 0;
  if (buscaResultados.length === 0) {
    el.innerHTML = '<div class="busca-vazio">Nenhum produto encontrado</div>';
    return;
  }
  el.innerHTML = buscaResultados.map((p, i) => `
    <div class="busca-item ${i === buscaIndice ? 'sel' : ''}" data-i="${i}">
      <span class="bi-cod">${p.codigo}</span>
      <span class="bi-nome">${p.nome}</span>
      <span class="bi-preco">${fmt(p.precoVenda)}</span>
    </div>`).join('');
  el.querySelectorAll('.busca-item').forEach(it =>
    it.addEventListener('click', () => selecionarBusca(+it.dataset.i)));
}
function moverBusca(delta) {
  if (buscaResultados.length === 0) return;
  buscaIndice = (buscaIndice + delta + buscaResultados.length) % buscaResultados.length;
  const el = $('busca-resultados');
  el.querySelectorAll('.busca-item').forEach((it, i) => it.classList.toggle('sel', i === buscaIndice));
  const sel = el.querySelector('.busca-item.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function selecionarBusca(i) {
  if (buscaContexto === 'materia') {
    const r = buscaResultados[i];
    if (!r) return;
    fecharBusca();
    $('rend-materia').value = r.nomeOriginal;
    carregarReceitaRendimento(r.nomeOriginal);
    return;
  }
  if (buscaContexto === 'clientes') {
    const c = buscaResultados[i];
    if (!c) return;
    fecharBusca();
    editarClienteForm(c.id);
    return;
  }
  if (buscaContexto === 'recebimento-fiado') {
    const c = buscaResultados[i];
    if (!c) return;
    fecharBusca();
    fiadoClienteSelecionado = c.id;
    $('receb-fiado-cliente').value = c.nome;
    atualizarResumo();
    return;
  }
  const p = buscaResultados[i];
  if (!p) return;
  if (buscaContexto === 'produtos') {
    fecharBusca();
    editarProdutoForm(p.codigo);   // carrega o produto no formulário
  } else if (buscaContexto === 'rendimento') {
    fecharBusca();
    preencherLinhaRendimento(rendLinhaAtual, p);   // carrega o produto existente na linha (dar entrada de novo)
  } else {
    adicionarProduto(p);
    fecharBusca();
  }
}
$('busca-input').addEventListener('input', e => renderBusca(e.target.value));
$('busca-input').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown')      { e.preventDefault(); moverBusca(1); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); moverBusca(-1); }
  else if (e.key === 'Enter')     { e.preventDefault(); selecionarBusca(buscaIndice); }
});
$('btn-fechar-busca').addEventListener('click', fecharBusca);
$('overlay-busca').addEventListener('click', e => { if (e.target === $('overlay-busca')) fecharBusca(); });

/* ── Recebimento / Pagamento (3 formas simultâneas) ──────── */
let totalReceber = 0;
let cartaoTipo = null;   // 'Crédito' ou 'Débito' (zerado a cada nova venda)
let fiadoClienteSelecionado = null;   // id do cliente escolhido pro valor em "Fiado" (zerado a cada nova venda)

const CAMPOS_PGTO = [
  { id: 'val-pix',      forma: 'PIX' },
  { id: 'val-dinheiro', forma: 'Dinheiro' },
  { id: 'val-cartao',   forma: 'Cartão' },
  { id: 'val-fiado',    forma: 'Fiado' },
];
const CAMPOS_PGTO_EDITAVEIS = ['val-pix', 'val-dinheiro', 'val-cartao'];   // Fiado não é digitado — é sempre o restante

/* Fiado = total menos o que já foi preenchido em PIX/Dinheiro/Cartão (nunca digitado manualmente) */
function recalcularFiado() {
  const outros = CAMPOS_PGTO_EDITAVEIS.reduce((s, id) => s + (+$(id).value || 0), 0);
  const fiado = Math.max(0, totalReceber - outros);
  $('val-fiado').value = fiado > 0 ? fiado.toFixed(2) : '';
}

/* Finalizar venda → abre a tela de recebimento (sempre, mesmo sem itens) */
function finalizarVenda() {
  totalReceber = itensCupom.reduce((s, it) => s + it.qtd * it.preco, 0);
  $('receb-total').textContent = fmt(totalReceber);
  CAMPOS_PGTO.forEach(c => { $(c.id).value = ''; $(c.id).classList.remove('preenchido'); });
  cartaoTipo = null;
  fiadoClienteSelecionado = null;
  $('receb-fiado-cliente').value = '';
  $('receb-fiado-cliente-box').style.display = 'none';
  confirmarDepoisDoCartao = false;
  $('cartao-texto').innerHTML = '<span class="atalho">C</span>artão';
  atualizarResumo();
  $('overlay-recebimento').classList.add('aberto');
  setTimeout(() => $('val-pix').focus(), 100);
}
$('btn-finalizar').addEventListener('click', finalizarVenda);

function fecharRecebimento() {
  $('overlay-recebimento').classList.remove('aberto');
  $('codigo').focus();
}
$('btn-fechar-receb').addEventListener('click', fecharRecebimento);
$('overlay-recebimento').addEventListener('click', e => {
  if (e.target === $('overlay-recebimento')) fecharRecebimento();
});

/* Soma os 4 valores, atualiza Pago / Restante / Troco e habilita o botão */
function atualizarResumo() {
  recalcularFiado();
  const valores = CAMPOS_PGTO.map(c => +$(c.id).value || 0);
  const pago = valores.reduce((s, v) => s + v, 0);
  const diff = pago - totalReceber;

  $('receb-pago').textContent = fmt(pago);
  const box = $('receb-restante-box'), rest = $('receb-restante'), lbl = $('receb-rest-lbl');
  box.classList.remove('falta', 'troco', 'quitado');
  if (diff < 0)      { lbl.textContent = 'Falta';    rest.textContent = fmt(-diff); box.classList.add('falta'); }
  else if (diff > 0) { lbl.textContent = 'Troco';    rest.textContent = fmt(diff);  box.classList.add('troco'); }
  else               { lbl.textContent = 'Restante'; rest.textContent = fmt(0);     box.classList.add('quitado'); }

  // destaque visual nos campos preenchidos
  CAMPOS_PGTO.forEach((c, i) => $(c.id).classList.toggle('preenchido', valores[i] > 0));

  // Fiado > 0 exige escolher o cliente antes de liberar o Confirmar
  const valFiado = +$('val-fiado').value || 0;
  $('receb-fiado-cliente-box').style.display = valFiado > 0 ? '' : 'none';
  if (valFiado <= 0 && fiadoClienteSelecionado) {
    fiadoClienteSelecionado = null;
    $('receb-fiado-cliente').value = '';
  }
  const fiadoOk = valFiado <= 0 || !!fiadoClienteSelecionado;

  $('btn-confirmar-receb').disabled = !(totalReceber > 0 && fiadoOk);
}

CAMPOS_PGTO_EDITAVEIS.forEach(id => $(id).addEventListener('input', atualizarResumo));
/* Duplo-espaço (campo vazio) no nome do cliente do fiado abre a busca */
let ultimoEspacoFiado = 0;
$('receb-fiado-cliente').addEventListener('keydown', e => {
  if (e.key !== ' ' || $('receb-fiado-cliente').value.trim() !== '') return;
  e.preventDefault();
  const agora = Date.now();
  if (agora - ultimoEspacoFiado < 450) { ultimoEspacoFiado = 0; abrirBuscaProduto('recebimento-fiado'); }
  else ultimoEspacoFiado = agora;
});

let confirmarDepoisDoCartao = false;

/* Confirmar recebimento → conclui a venda */
function confirmarRecebimento() {
  if ($('btn-confirmar-receb').disabled) return;
  // Se há valor no cartão mas o tipo ainda não foi escolhido, pede o tipo primeiro
  const valCartao = +$('val-cartao').value || 0;
  if (valCartao > 0 && !cartaoTipo) {
    confirmarDepoisDoCartao = true;
    abrirCartaoTipo();
    return;
  }
  const partes = [];
  let pago = 0;
  CAMPOS_PGTO.forEach(c => {
    const v = +$(c.id).value || 0;
    if (v > 0) {
      const nome = c.forma === 'Cartão' && cartaoTipo ? `Cartão ${cartaoTipo}` : c.forma;
      partes.push(`${nome} ${fmt(v)}`);
      pago += v;
    }
  });
  const troco = pago - totalReceber;
  let msg = `✅ Recebido: ${partes.join(' + ')}`;
  if (troco > 0) msg += ` · Troco ${fmt(troco)}`;
  toast(msg, 'sucesso');

  // Fiado > 0 → lança na conta do cliente escolhido e já avisa no WhatsApp (lancarNaContaCliente)
  const valFiado = +$('val-fiado').value || 0;
  let fiadoInfo = null;
  if (valFiado > 0 && fiadoClienteSelecionado) {
    const itensTexto = itensCupom.map(it => `${it.qtd}x ${it.desc}`).join(', ');
    const formasPagas = CAMPOS_PGTO_EDITAVEIS
      .map(id => ({ id, valor: +$(id).value || 0 }))
      .filter(f => f.valor > 0)
      .map(f => {
        const base = CAMPOS_PGTO.find(c => c.id === f.id).forma;
        const nome = base === 'Cartão' && cartaoTipo ? `Cartão ${cartaoTipo}` : base;
        return { nome, valor: f.valor };
      });
    const r = lancarNaContaCliente(fiadoClienteSelecionado, 'compra', valFiado, 'Venda no PDV', { itensTexto, valorTotal: totalReceber, formasPagas });
    if (r) fiadoInfo = { clienteId: r.cliente.id, clienteNome: r.cliente.nome, lancamentoId: r.lancamentoId, valor: valFiado };
  }

  concluirVenda(totalReceber, partes.join(' + '), troco > 0 ? troco : 0, fiadoInfo);
  fecharRecebimento();
}
$('btn-confirmar-receb').addEventListener('click', confirmarRecebimento);

/* Conclui a venda: registra histórico, baixa estoque, guarda última venda e limpa */
let ultimaVenda = null;
function concluirVenda(total, descricaoPgto, troco = 0, fiado = null) {
  const agora = new Date();
  vendasLog.push({
    hora: agora.toISOString(),
    total,
    pgto: descricaoPgto || '',
    itens: itensCupom.map(it => ({ cod: it.cod, nome: it.desc, qtd: it.qtd, preco: it.preco, pacote: !!it.pacote, unidConsumo: it.unidConsumo || 1 })),
    fiado,
  });
  salvarVendasLog();
  itensCupom.forEach(it => {
    const p = PRODUTOS.find(x => x.codigo === it.cod);
    if (p && typeof p.estoque === 'number') p.estoque = Math.max(0, p.estoque - it.qtd * (it.unidConsumo || 1));
  });
  salvarEstoque();
  ultimaVenda = {
    total, hora: agora, pgto: descricaoPgto || '—', troco: troco || 0,
    itens: itensCupom.map(it => ({ desc: it.desc, qtd: it.qtd, cod: it.cod, pacote: !!it.pacote, unidConsumo: it.unidConsumo || 1 })),
    fiado,
    cancelada: false,
  };
  renderUltimaVenda();
  itensCupom = [];
  renderCupom();
}
function renderUltimaVenda() {
  const el = $('ultima-venda');
  if (!el) return;
  if (!ultimaVenda) { el.style.display = 'none'; return; }
  el.style.display = '';
  $('uv-total').textContent = fmt(ultimaVenda.total);
  $('uv-pgto').textContent = ultimaVenda.pgto || '—';
  $('uv-troco').textContent = fmt(ultimaVenda.troco || 0);
  $('uv-hora').textContent = ultimaVenda.hora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const itens = ultimaVenda.itens || [];
  $('uv-itens').innerHTML = itens.map(it =>
    `<li>${it.qtd}× ${(it.desc || '—').toUpperCase()}${it.pacote ? ' (caixa)' : ''}</li>`).join('') || '<li>—</li>';
  el.classList.toggle('cancelada', !!ultimaVenda.cancelada);
  $('uv-badge-cancelada').style.display = ultimaVenda.cancelada ? '' : 'none';
  $('btn-cancelar-venda').disabled = !!ultimaVenda.cancelada;
}

/* Cancela a última venda: devolve o estoque, reverte o fiado (se houver) e marca como cancelada */
function cancelarUltimaVenda() {
  if (!ultimaVenda || ultimaVenda.cancelada) return;
  const avisoFiado = ultimaVenda.fiado ? `\nA cobrança de ${fmt(ultimaVenda.fiado.valor)} na conta de ${ultimaVenda.fiado.clienteNome} também será removida.` : '';
  if (!confirm(`Cancelar a última venda (${fmt(ultimaVenda.total)})?\nO estoque dos itens será devolvido.${avisoFiado}`)) return;

  (ultimaVenda.itens || []).forEach(it => {
    if (!it.cod) return;
    const p = PRODUTOS.find(x => x.codigo === it.cod);
    if (p && typeof p.estoque === 'number') p.estoque += it.qtd * (it.unidConsumo || 1);
  });
  salvarEstoque();

  if (ultimaVenda.fiado) {
    const removido = removerLancamentoPorId(ultimaVenda.fiado.clienteId, ultimaVenda.fiado.lancamentoId);
    if (removido) toast(`↩️ Cobrança de fiado revertida na conta de ${ultimaVenda.fiado.clienteNome}`);
  }

  // remove o registro correspondente do histórico de vendas (o mais recente)
  const idxLog = vendasLog.length - 1;
  if (idxLog >= 0) { vendasLog.splice(idxLog, 1); salvarVendasLog(); }

  ultimaVenda.cancelada = true;
  renderUltimaVenda();
  toast(`↩️ Venda cancelada · ${fmt(ultimaVenda.total)} devolvido ao estoque`);
}
$('btn-cancelar-venda').addEventListener('click', cancelarUltimaVenda);

/* ── Submodal: tipo de cartão (Crédito / Débito) ─────────── */
function abrirCartaoTipo() {
  $('overlay-cartao-tipo').classList.add('aberto');
  setTimeout(() => { const b = document.querySelector('.cartao-opc'); if (b) b.focus(); }, 50);
}
function fecharCartaoTipo() {
  $('overlay-cartao-tipo').classList.remove('aberto');
  confirmarDepoisDoCartao = false;
}
function escolherCartaoTipo(tipo) {
  cartaoTipo = tipo;
  $('cartao-texto').innerHTML = `<span class="atalho">C</span>artão <small>(${tipo})</small>`;
  $('overlay-cartao-tipo').classList.remove('aberto');
  if (confirmarDepoisDoCartao) {
    confirmarDepoisDoCartao = false;
    setTimeout(confirmarRecebimento, 50);
  } else {
    setTimeout(() => $('val-cartao').focus(), 50);
  }
}

// Abre ao SAIR do campo do cartão se o usuário digitou um valor sem ter escolhido o tipo
$('val-cartao').addEventListener('blur', () => {
  const v = +$('val-cartao').value || 0;
  if (v > 0 && !cartaoTipo) abrirCartaoTipo();
});
// Clique nas opções
document.querySelectorAll('.cartao-opc').forEach(b =>
  b.addEventListener('click', () => escolherCartaoTipo(b.dataset.tipo)));
// Clique fora fecha
$('overlay-cartao-tipo').addEventListener('click', e => {
  if (e.target === $('overlay-cartao-tipo')) fecharCartaoTipo();
});

document.addEventListener('keydown', e => {
  // só quando logado (app visível)
  if ($('app-principal').classList.contains('oculto')) return;

  // ── Submodal de tipo de cartão (a mais "em cima") ──
  if ($('overlay-cartao-tipo').classList.contains('aberto')) {
    if (e.key === '1') { e.preventDefault(); escolherCartaoTipo('Crédito'); }
    else if (e.key === '2') { e.preventDefault(); escolherCartaoTipo('Débito'); }
    return;
  }
  // ── Busca por nome / edição de item abertas → tratadas localmente ──
  if ($('overlay-busca').classList.contains('aberto')) return;
  if ($('overlay-item').classList.contains('aberto')) return;

  // ── Dentro do modal de recebimento ──
  if ($('overlay-recebimento').classList.contains('aberto')) {
    // campo de texto (nome do cliente do fiado) digita livremente — duplo-espaço tratado por listener próprio
    if (document.activeElement && document.activeElement.id === 'receb-fiado-cliente') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      // Enter navega entre PIX/Dinheiro/Cartão; saindo do Cartão, pula pro cliente se há fiado pendente, senão confirma
      const ordem = CAMPOS_PGTO_EDITAVEIS;
      const i = ordem.indexOf(document.activeElement.id);
      const fiadoPendente = (+$('val-fiado').value || 0) > 0 && !fiadoClienteSelecionado;
      if (i >= 0 && i < ordem.length - 1) {
        const prox = $(ordem[i + 1]); prox.focus(); prox.select();
      } else if (i === ordem.length - 1 && fiadoPendente) {
        $('receb-fiado-cliente').focus();
      } else if (!$('btn-confirmar-receb').disabled) {
        confirmarRecebimento();
      } else {
        $('val-pix').focus(); $('val-pix').select();
      }
      return;
    }
    // atalhos de letra (P/D/C) → foca o campo da forma
    const alvo = { p: 'val-pix', d: 'val-dinheiro', c: 'val-cartao' }[e.key.toLowerCase()];
    if (alvo) { e.preventDefault(); $(alvo).focus(); $(alvo).select(); }
    return;
  }
  // ── Tela PDV: V abre o recebimento ──
  if (e.ctrlKey || e.metaKey || e.altKey) return;                 // ignora Ctrl+V (colar) etc.
  if (e.key !== 'v' && e.key !== 'V') return;
  if (!$('tela-pdv').classList.contains('ativa')) return;          // só na tela de PDV
  if ($('overlay-pedido').classList.contains('aberto')) return;    // modal de delivery aberto
  e.preventDefault();
  finalizarVenda();
});

/* ═══════════════════════════════════════════════════════════
   DELIVERY
   ═══════════════════════════════════════════════════════════ */
const STATUS = ['pendente', 'preparo', 'rota', 'entregue'];
const STATUS_INFO = {
  pendente: { label: 'Pendente',         icone: '🕐', proximo: 'Iniciar preparo' },
  preparo:  { label: 'Em preparo',       icone: '👨‍🍳', proximo: 'Saiu p/ entrega' },
  rota:     { label: 'Saiu p/ entrega',  icone: '🛵', proximo: 'Marcar entregue' },
  entregue: { label: 'Entregue',         icone: '✅', proximo: null },
};

let pedidos = [];

/* Pedidos vivem no servidor (banco SQLite) agora, não mais no localStorage —
   é o que permite o atendimento por IA criar pedido sem navegador aberto. */
async function carregarPedidos() {
  try {
    const r = await fetch('/api/pedidos');
    pedidos = await r.json();
  } catch { pedidos = []; }
}
let pedidosPollTimer = null;
function iniciarPollPedidos() {
  if (pedidosPollTimer) return;
  pedidosPollTimer = setInterval(async () => {
    try {
      const r = await fetch('/api/pedidos');
      pedidos = await r.json();
      renderDelivery();
    } catch {}
  }, 5000);
}
function pararPollPedidos() {
  if (pedidosPollTimer) { clearInterval(pedidosPollTimer); pedidosPollTimer = null; }
}

/* ══════════════════════════════════════════════════════════
   CENTRAL DE ATENDIMENTO — caixa de entrada do WhatsApp
   ══════════════════════════════════════════════════════════ */
let atConversas = [];          // conversas carregadas
let atTelefoneAtivo = null;    // telefone da conversa aberta
let atClienteAtivo = null;     // cadastro do cliente da conversa aberta (pra "Criar pedido")
let atPollTimer = null;        // poll rápido enquanto a tela está aberta
let atBadgePollTimer = null;   // poll lento do badge (roda sempre, em qualquer tela)
let atUltimoMsgId = 0;         // pra detectar mensagem nova e rolar pro fim

const fmtHora = iso => { try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const fmtDia  = iso => { try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return ''; } };
const escapar = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function abrirAtendimento() {
  carregarConversas();
  atualizarStatusWhatsappAt();
  iniciarPollAtendimento();
}

async function atualizarStatusWhatsappAt() {
  const el = $('at-status-wpp');
  if (!el) return;
  try {
    const r = await fetch('/api/whatsapp/status');
    const { pronto } = await r.json();
    el.textContent = pronto ? '● conectado' : '○ desconectado';
    el.className = 'at-status ' + (pronto ? 'on' : 'off');
  } catch { el.textContent = '○ servidor off'; el.className = 'at-status off'; }
}

async function carregarConversas() {
  try {
    const r = await fetch('/api/atendimento/conversas');
    atConversas = await r.json();
    renderConversas();
    atualizarBadgesNaoLidas();
  } catch {
    $('at-conversas').innerHTML = '<div class="at-vazio">⚠ Servidor indisponível</div>';
  }
}

function renderConversas() {
  const filtro = ($('at-busca').value || '').trim().toLowerCase();
  const lista = filtro
    ? atConversas.filter(c => (c.nome || '').toLowerCase().includes(filtro) || c.telefone.includes(filtro))
    : atConversas;
  const box = $('at-conversas');
  if (!lista.length) {
    box.innerHTML = `<div class="at-vazio">${filtro ? 'Nenhuma conversa encontrada' : 'Nenhuma mensagem ainda.<br>Quando um cliente escrever no WhatsApp, aparece aqui.'}</div>`;
    return;
  }
  box.innerHTML = lista.map(c => {
    const nome = escapar(c.nome || c.telefone);
    const previa = (c.ultimaDirecao === 'out' ? 'Você: ' : '') + escapar(c.ultimoTexto || '');
    const badge = c.naoLidas > 0 ? `<span class="badge-nao-lidas">${c.naoLidas}</span>` : '';
    return `<div class="at-conversa ${c.telefone === atTelefoneAtivo ? 'sel' : ''}" data-tel="${c.telefone}">
      <div class="at-conversa-topo">
        <span class="at-conversa-nome">${nome}</span>
        <span class="at-conversa-hora">${fmtHora(c.criado)}</span>
      </div>
      <div class="at-conversa-baixo">
        <span class="at-conversa-previa">${previa}</span>
        ${badge}
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('.at-conversa').forEach(el =>
    el.addEventListener('click', () => abrirConversa(el.dataset.tel)));
}

async function abrirConversa(telefone) {
  atTelefoneAtivo = telefone;
  atUltimoMsgId = 0;
  renderConversas(); // re-marca a selecionada
  $('at-chat-vazio').style.display = 'none';
  $('at-chat-ativo').style.display = 'flex';
  await carregarMensagens(true);
  setTimeout(() => $('at-texto').focus(), 60);
}

async function carregarMensagens(rolarFim) {
  if (!atTelefoneAtivo) return;
  try {
    const r = await fetch('/api/atendimento/mensagens/' + encodeURIComponent(atTelefoneAtivo));
    const { mensagens, cliente } = await r.json();
    atClienteAtivo = cliente || null;   // guarda pra preencher o "Criar pedido"
    const conv = atConversas.find(c => c.telefone === atTelefoneAtivo);
    $('at-chat-nome').textContent = (conv && conv.nome) || (cliente && cliente.nome) || atTelefoneAtivo;
    $('at-chat-telefone').textContent = atTelefoneAtivo;
    $('at-chat-cliente').innerHTML = ''; // status/cadastro do cliente não aparece na Central (pedido do usuário)

    const ultimoId = mensagens.length ? mensagens[mensagens.length - 1].id : 0;
    const temNova = ultimoId !== atUltimoMsgId;
    if (temNova) {
      renderMensagens(mensagens);
      atUltimoMsgId = ultimoId;
    }
    if (rolarFim || temNova) {
      const cont = $('at-mensagens');
      cont.scrollTop = cont.scrollHeight;
    }
    // a conversa aberta foi marcada como lida no servidor — reflete no badge
    if (conv && conv.naoLidas) { conv.naoLidas = 0; renderConversas(); atualizarBadgesNaoLidas(); }
  } catch {}
}

function renderMensagens(mensagens) {
  let html = '', diaAtual = '';
  for (const m of mensagens) {
    const dia = fmtDia(m.criado);
    if (dia !== diaAtual) { html += `<div class="at-dia-sep">${dia}</div>`; diaAtual = dia; }
    html += `<div class="msg msg-${m.direcao}">${corpoMensagem(m)}<span class="msg-hora">${fmtHora(m.criado)}</span></div>`;
  }
  $('at-mensagens').innerHTML = html;
}

// monta o conteúdo de uma mensagem: player de áudio, imagem, vídeo ou texto.
// (a legenda, quando existir, aparece embaixo da mídia)
function corpoMensagem(m) {
  const src = `/api/atendimento/midia/${m.id}`;
  const legenda = m.texto ? `<div class="msg-legenda">${escapar(m.texto)}</div>` : '';
  if (m.temMidia && (m.tipo === 'ptt' || m.tipo === 'audio')) {
    return `<audio class="msg-audio" controls preload="none" src="${src}"></audio>${legenda}`;
  }
  if (m.temMidia && m.tipo === 'image') {
    return `<a href="${src}" target="_blank" rel="noopener"><img class="msg-midia" src="${src}" alt="foto" loading="lazy"></a>${legenda}`;
  }
  if (m.temMidia && m.tipo === 'video') {
    return `<video class="msg-midia" controls preload="none" src="${src}"></video>${legenda}`;
  }
  if (m.temMidia && (m.tipo === 'document' || m.tipo === 'sticker')) {
    const rot = m.tipo === 'sticker' ? '🌟 Figurinha' : '📎 Arquivo';
    return `<a class="msg-arquivo" href="${src}" target="_blank" rel="noopener">${rot} — baixar</a>${legenda}`;
  }
  // texto puro (ou mídia que não baixou → mostra um rótulo)
  if (!m.texto && m.tipo && m.tipo !== 'chat') return `<em class="msg-rotulo">📎 ${m.tipo}</em>`;
  return escapar(m.texto);
}

async function enviarResposta() {
  const texto = $('at-texto').value.trim();
  if (!texto || !atTelefoneAtivo) return;
  const btn = $('at-btn-enviar');
  btn.disabled = true;
  try {
    const r = await fetch('/api/atendimento/enviar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefone: atTelefoneAtivo, texto }),
    });
    const res = await r.json();
    if (!res.ok) { alert('Não foi possível enviar: ' + (res.erro || 'erro desconhecido')); return; }
    $('at-texto').value = '';
    ajustarAlturaTexto();
    await carregarMensagens(true);
    carregarConversas();
  } catch {
    alert('Falha de conexão ao enviar.');
  } finally {
    btn.disabled = false;
    $('at-texto').focus();
  }
}

function ajustarAlturaTexto() {
  const t = $('at-texto');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 120) + 'px';
}

function iniciarPollAtendimento() {
  if (atPollTimer) return;
  atPollTimer = setInterval(() => {
    carregarConversas();
    if (atTelefoneAtivo) carregarMensagens(false);
  }, 4000);
}
function pararPollAtendimento() {
  if (atPollTimer) { clearInterval(atPollTimer); atPollTimer = null; }
}

// badge de não-lidas: roda em qualquer tela, leve, pra avisar que chegou mensagem
let atUltimoTotalNaoLidas = null; // null = ainda não inicializado (não toca som no 1º carregamento)
function atualizarBadgesNaoLidas() {
  const total = atConversas.reduce((s, c) => s + (c.naoLidas || 0), 0);
  if (atUltimoTotalNaoLidas !== null && total > atUltimoTotalNaoLidas) tocarBeepMensagem();
  atUltimoTotalNaoLidas = total;
  for (const id of ['top-badge-atendimento', 'home-badge-atendimento']) {
    const el = $(id);
    if (!el) continue;
    el.textContent = total;
    el.style.display = total > 0 ? 'inline-block' : 'none';
  }
}

// aviso sonoro (dois tons curtos) — gerado na hora via Web Audio, sem precisar de arquivo
let audioCtxNotif = null;
function tocarBeepMensagem() {
  try {
    audioCtxNotif = audioCtxNotif || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtxNotif.state === 'suspended') audioCtxNotif.resume();
    const ctx = audioCtxNotif, t0 = ctx.currentTime;
    const tom = (freq, ini, dur) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, t0 + ini);
      g.gain.exponentialRampToValueAtTime(0.3, t0 + ini + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + ini + dur);
      o.start(t0 + ini); o.stop(t0 + ini + dur + 0.02);
    };
    tom(880, 0, 0.18);     // ding
    tom(1175, 0.13, 0.28); // dong
  } catch {}
}
async function pollBadgeGlobal() {
  // só atualiza o contador quando NÃO está na tela (lá o poll próprio já faz isso)
  if ($('tela-atendimento').classList.contains('ativa')) return;
  try {
    const r = await fetch('/api/atendimento/conversas');
    atConversas = await r.json();
    atualizarBadgesNaoLidas();
  } catch {}
}

/* Respostas rápidas — clicar preenche o campo (você revisa e dá Enter pra enviar) */
const RESPOSTAS_RAPIDAS = [
  { rotulo: '👋 Saudação', texto: 'Boa noite! 😊 Temos açaí sim: Popular (R$10/L), Top (R$15/L) e Grosso (R$20/L). Quantos litros você quer?' },
  { rotulo: '📲 Chave PIX', texto: 'certo! essa é a chave pix.✔\n\nPIX:\n91984540212\nBanco nubank\nnome: comercial do centro / ou M.Rodrigues da Costa.\n\naguardo o comprovante para poder enviarmos seu pedido 😉' },
  { rotulo: '✅ Pedido confirmado', texto: 'Seu pedido foi realizado com sucesso!\n\nAs entregas são feitas pela ordem dos pedidos.\n\nPor favor aguarde! 😊' },
  { rotulo: '🛵 Saiu pra entrega', texto: 'Seu pedido saiu para entrega! 🛵 Já já chega aí 😊' },
  { rotulo: '⏳ Preparando', texto: 'Pedido recebido! Já estamos preparando, é só aguardar 😊' },
];
function renderRespostasRapidas() {
  const box = $('at-respostas');
  box.innerHTML = RESPOSTAS_RAPIDAS.map((r, i) => `<button class="at-resposta-chip" data-i="${i}">${r.rotulo}</button>`).join('');
  box.querySelectorAll('.at-resposta-chip').forEach(b => b.addEventListener('click', () => {
    $('at-texto').value = RESPOSTAS_RAPIDAS[+b.dataset.i].texto;
    ajustarAlturaTexto();
    $('at-texto').focus();
  }));
}
renderRespostasRapidas();

/* Criar pedido a partir da conversa — abre o modal de pedido já preenchido */
function abrirPedidoDaConversa() {
  if (!atTelefoneAtivo) return;
  const conv = atConversas.find(c => c.telefone === atTelefoneAtivo);
  $('form-pedido').reset();
  $('ped-taxa').value = 0;
  $('ped-cliente').value = (atClienteAtivo && atClienteAtivo.nome) || (conv && conv.nome) || '';
  $('ped-telefone').value = atTelefoneAtivo;
  if (atClienteAtivo && atClienteAtivo.endereco) $('ped-endereco').value = atClienteAtivo.endereco;
  atualizarPreviewTotal();
  $('overlay-pedido').classList.add('aberto');
  setTimeout(() => $('ped-itens').focus(), 100); // foca nos itens — é o que ainda falta digitar
}

// listeners da Central (registrados uma vez)
$('at-busca').addEventListener('input', renderConversas);
$('at-envio').addEventListener('submit', e => { e.preventDefault(); enviarResposta(); });
$('at-btn-criar-pedido').addEventListener('click', abrirPedidoDaConversa);
$('at-btn-excluir').addEventListener('click', async () => {
  if (!atTelefoneAtivo) return;
  const nome = (atConversas.find(c => c.telefone === atTelefoneAtivo) || {}).nome || atTelefoneAtivo;
  const autorizado = await pedirAutorizacaoSupervisor(`Excluir a conversa com ${nome}? As mensagens serão apagadas e não dá pra desfazer.`);
  if (!autorizado) return;
  try {
    await fetch('/api/atendimento/conversas/' + encodeURIComponent(atTelefoneAtivo), { method: 'DELETE' });
    atTelefoneAtivo = null; atClienteAtivo = null;
    $('at-chat-vazio').style.display = '';
    $('at-chat-ativo').style.display = 'none';
    await carregarConversas();
  } catch { alert('Não foi possível excluir a conversa (servidor offline?).'); }
});
$('at-texto').addEventListener('input', ajustarAlturaTexto);
$('at-texto').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarResposta(); }
});
atBadgePollTimer = setInterval(pollBadgeGlobal, 12000);
pollBadgeGlobal();

/* Modal */
$('btn-novo-pedido').addEventListener('click', () => {
  $('form-pedido').reset();
  $('ped-taxa').value = 0;
  atualizarPreviewTotal();
  $('overlay-pedido').classList.add('aberto');
  setTimeout(() => $('ped-cliente').focus(), 100);
});
$('btn-fechar-pedido').addEventListener('click', fecharModal);

/* Clientes cadastrados (importados do BotConversa + atualizados a cada pedido da IA) */
async function renderClientesDelivery(busca) {
  const tbody = $('cd-tbody');
  try {
    const r = await fetch('/api/clientes-delivery?busca=' + encodeURIComponent(busca || '') + '&limite=100');
    const { total, resultados } = await r.json();
    $('cd-total').textContent = busca ? `${resultados.length} de ${total} clientes` : `${total} clientes (mostrando 100)`;
    tbody.innerHTML = resultados.length
      ? resultados.map(c => `
        <tr>
          <td>${c.nome || '—'}</td>
          <td>${c.telefone}</td>
          <td>${c.endereco || '—'}</td>
          <td>${c.formaPagamento || '—'}</td>
          <td>${new Date(c.atualizado_em).toLocaleDateString('pt-BR')}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center; opacity:.5; padding:20px;">Nenhum cliente encontrado</td></tr>';
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; opacity:.5; padding:20px;">⚠ Servidor indisponível</td></tr>';
  }
}
let timeoutBuscaCD = null;
$('cd-busca').addEventListener('input', () => {
  clearTimeout(timeoutBuscaCD);
  timeoutBuscaCD = setTimeout(() => renderClientesDelivery($('cd-busca').value.trim()), 250);
});
$('btn-clientes-delivery').addEventListener('click', () => {
  $('cd-busca').value = '';
  renderClientesDelivery('');
  $('overlay-clientes-delivery').classList.add('aberto');
  setTimeout(() => $('cd-busca').focus(), 100);
});
$('btn-fechar-clientes-delivery').addEventListener('click', () => $('overlay-clientes-delivery').classList.remove('aberto'));
$('overlay-clientes-delivery').addEventListener('click', e => { if (e.target === $('overlay-clientes-delivery')) $('overlay-clientes-delivery').classList.remove('aberto'); });

/* ── Disponibilidade (Módulo A): liga/desliga o que tem agora ── */
function renderDisponibilidade() {
  const lista = $('disp-lista');
  if (!PRODUTOS.length) { lista.innerHTML = '<div class="at-vazio">Nenhum produto cadastrado.</div>'; return; }
  lista.innerHTML = PRODUTOS.map(p => {
    const on = p.disponivel !== false;
    return `<div class="disp-item ${on ? 'on' : 'off'}" data-cod="${p.codigo}">
      <div class="disp-info">
        <strong>${p.nome}</strong>
        <span>${p.codigo} · ${fmt(p.precoVenda)}</span>
      </div>
      <div class="disp-dir">
        <span class="disp-estado">${on ? 'TEM' : 'ACABOU'}</span>
        <button class="disp-switch" title="Ligar/desligar" aria-label="alternar"></button>
      </div>
    </div>`;
  }).join('');
  lista.querySelectorAll('.disp-item').forEach(item => {
    item.querySelector('.disp-switch').addEventListener('click', () => {
      const prod = buscarPorCodigo(item.dataset.cod);
      if (!prod) return;
      prod.disponivel = prod.disponivel === false ? true : false;
      salvarEstoque();            // persiste e re-sincroniza o cardápio pro servidor (a IA lê de lá)
      renderDisponibilidade();
    });
  });
}
function abrirDisponibilidade() {
  renderDisponibilidade();
  $('overlay-disponibilidade').classList.add('aberto');
}
function fecharDisponibilidade() { $('overlay-disponibilidade').classList.remove('aberto'); }
$('btn-disponibilidade-delivery').addEventListener('click', abrirDisponibilidade);
$('btn-disponibilidade-pdv').addEventListener('click', abrirDisponibilidade);
$('btn-fechar-disp').addEventListener('click', fecharDisponibilidade);
$('overlay-disponibilidade').addEventListener('click', e => { if (e.target === $('overlay-disponibilidade')) fecharDisponibilidade(); });

/* Loja Aberta/Fechada + Só Retirada — controlam como a IA atende */
let lojaAberta = true;
let retiradaApenas = false;
function pintarBotaoLoja() {
  $('btn-loja-estado').classList.toggle('ligado', lojaAberta);
  const t = $('dt-loja-estado');
  t.textContent = lojaAberta ? 'Aberta' : 'Fechada';
  t.className = 'dt-estado ' + (lojaAberta ? 'on' : 'off');
}
function pintarBotaoRetirada() {
  $('btn-loja-retirada').classList.toggle('ligado', retiradaApenas);
  const t = $('dt-ret-estado');
  t.textContent = retiradaApenas ? 'Ligado' : 'Desligado';
  t.className = 'dt-estado ' + (retiradaApenas ? 'on' : 'off');
}
async function carregarEstadoLoja() {
  try {
    const e = await (await fetch('/api/loja/estado')).json();
    lojaAberta = e.aberta;
    retiradaApenas = e.retiradaApenas;
  } catch { /* mantém o último estado conhecido */ }
  pintarBotaoLoja();
  pintarBotaoRetirada();
}
$('btn-loja-estado').addEventListener('click', async () => {
  const novo = !lojaAberta;
  if (!novo && !confirm('Fechar a loja? A IA vai parar de atender pedidos e avisar os clientes que está fechado.')) return;
  try {
    lojaAberta = (await (await fetch('/api/loja/estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aberta: novo }) })).json()).aberta;
    pintarBotaoLoja();
  } catch { alert('Não foi possível mudar o estado da loja (servidor offline?).'); }
});
$('btn-loja-retirada').addEventListener('click', async () => {
  const novo = !retiradaApenas;
  try {
    retiradaApenas = (await (await fetch('/api/loja/estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retiradaApenas: novo }) })).json()).retiradaApenas;
    pintarBotaoRetirada();
  } catch { alert('Não foi possível mudar o modo retirada (servidor offline?).'); }
});
$('overlay-pedido').addEventListener('click', e => { if (e.target === $('overlay-pedido')) fecharModal(); });
function fecharModal() { $('overlay-pedido').classList.remove('aberto'); }

['ped-valor', 'ped-taxa'].forEach(id => $(id).addEventListener('input', atualizarPreviewTotal));
function atualizarPreviewTotal() {
  const total = (+$('ped-valor').value || 0) + (+$('ped-taxa').value || 0);
  $('ped-total-preview').textContent = fmt(total);
}

/* Criar pedido */
$('form-pedido').addEventListener('submit', async e => {
  e.preventDefault();
  const valor = +$('ped-valor').value || 0;
  const taxa = +$('ped-taxa').value || 0;
  const dados = {
    cliente: $('ped-cliente').value.trim(),
    telefone: $('ped-telefone').value.trim(),
    bairro: $('ped-bairro').value.trim(),
    endereco: $('ped-endereco').value.trim(),
    complemento: $('ped-complemento').value.trim(),
    itens: $('ped-itens').value.trim(),
    valor, taxa,
    pagamento: $('ped-pagamento').value,
    troco: +$('ped-troco').value || 0,
    origem: 'manual',
  };
  let novoPedido;
  try {
    const r = await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
    if (!r.ok) { toast('⚠ Não foi possível criar o pedido'); return; }
    novoPedido = await r.json();
  } catch { toast('⚠ Servidor indisponível — pedido não criado'); return; }
  pedidos.unshift(novoPedido);
  renderDelivery();
  fecharModal();
  toast(`✅ Pedido #${novoPedido.numero} criado`, 'sucesso');
  const novo = $('delivery-board').querySelector('.del-card');
  if (novo) { novo.classList.add('flash'); setTimeout(() => novo.classList.remove('flash'), 700); }
});

/* Telefone → número p/ link do WhatsApp (adiciona DDI Brasil se for local) */
function telWhatsapp(tel) {
  let d = (tel || '').replace(/\D/g, '');
  if (d && d.length <= 11) d = '55' + d;
  return d;
}

/* Avançar status */
async function avancarStatus(id) {
  const p = pedidos.find(x => x.id === id);
  if (!p) return;
  const i = STATUS.indexOf(p.status);
  if (i < STATUS.length - 1) {
    const novoStatus = STATUS[i + 1];
    try {
      const r = await fetch('/api/pedidos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: novoStatus }) });
      if (!r.ok) { toast('⚠ Não foi possível atualizar o pedido'); return; }
    } catch { toast('⚠ Servidor indisponível'); return; }
    p.status = novoStatus;
    renderDelivery();
    toast(`🛵 Pedido #${p.numero}: ${STATUS_INFO[p.status].label}`);
  }
}
/* Cancelar / remover */
async function cancelarPedido(id) {
  const p = pedidos.find(x => x.id === id);
  if (p && confirm(`Remover o pedido #${p.numero} de ${p.cliente}?`)) {
    try {
      await fetch('/api/pedidos/' + id, { method: 'DELETE' });
    } catch { toast('⚠ Servidor indisponível'); return; }
    pedidos = pedidos.filter(x => x.id !== id);
    renderDelivery();
  }
}

/* Render */
function renderDelivery() {
  const board = $('delivery-board');

  // Estatísticas
  const hoje = new Date().toISOString().slice(0, 10);
  const pend = pedidos.filter(p => p.status !== 'entregue').filter(p => p.status === 'pendente' || p.status === 'preparo').length;
  const rota = pedidos.filter(p => p.status === 'rota').length;
  const entreguesHoje = pedidos.filter(p => p.status === 'entregue' && p.criado.slice(0, 10) === hoje);
  const faturamento = entreguesHoje.reduce((s, p) => s + p.total, 0);
  $('stat-pendentes').textContent = pend;
  $('stat-rota').textContent = rota;
  $('stat-entregues').textContent = entreguesHoje.length;
  $('stat-faturamento').textContent = fmt(faturamento);

  if (pedidos.length === 0) {
    board.innerHTML = `<div class="board-vazio"><div class="ico">🛵</div>
      <p>Nenhum pedido de delivery.<br>Clique em <strong>+ Novo Pedido</strong> para começar.</p></div>`;
    return;
  }

  board.innerHTML = pedidos.map(p => {
    const info = STATUS_INFO[p.status];
    const enderecoCompleto = [p.endereco, p.bairro].filter(Boolean).join(' - ');
    const trocoTxt = (p.pagamento === 'Dinheiro' && p.troco > 0) ? ` · troco p/ ${fmt(p.troco)}` : '';
    return `
    <div class="del-card st-${p.status}" tabindex="0" data-id="${p.id}">
      <div class="del-card-top">
        <span class="del-num">#${p.numero}${p.origem === 'ia' ? ' <span class="badge-ia" title="Pedido feito pelo atendimento automático">🤖 IA</span>' : ''}</span>
        <span class="badge-status">${info.icone} ${info.label}</span>
      </div>
      <div class="del-cliente">${p.cliente}</div>
      ${p.telefone ? `<div class="del-info">📞 <a class="wa-link" href="https://wa.me/${telWhatsapp(p.telefone)}" target="_blank" rel="noopener" title="Abrir no WhatsApp">${p.telefone}</a></div>` : ''}
      <div class="del-info">📍 ${enderecoCompleto || '—'}</div>
      ${p.complemento ? `<div class="del-info" style="opacity:.7">↳ ${p.complemento}</div>` : ''}
      ${p.itens ? `<div class="del-itens">${p.itens}</div>` : ''}
      <div class="del-pgto">💳 ${p.pagamento}${trocoTxt}</div>
      <div class="del-valores">
        <span class="detalhe">Itens ${fmt(p.valor)} + Taxa ${fmt(p.taxa)}</span>
        <span class="del-total">${fmt(p.total)}</span>
      </div>
      <div class="del-acoes">
        ${info.proximo
          ? `<button class="btn-avancar" onclick="avancarStatus(${p.id})">${info.proximo} →</button>`
          : `<button class="btn-avancar concluido" disabled>✅ Concluído</button>`}
        <button class="btn-cancelar" onclick="cancelarPedido(${p.id})" title="Remover">🗑</button>
      </div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   LOGIN
   ═══════════════════════════════════════════════════════════ */
const USUARIOS = [
  { usuario: 'admin', senha: 'admin', nome: 'Administrador' },
  { usuario: 'caixa', senha: 'caixa', nome: 'Operador' },
];

/* Autorização do supervisor (o Administrador) — usada antes de ações destrutivas.
   Retorna uma Promise que resolve true se a senha do supervisor for digitada certa. */
let _supervisorResolve = null;
function pedirAutorizacaoSupervisor(msg) {
  return new Promise(resolve => {
    _supervisorResolve = resolve;
    $('supervisor-msg').textContent = msg || 'Esta ação precisa da senha do supervisor.';
    $('supervisor-senha').value = '';
    $('supervisor-erro').textContent = '';
    $('overlay-supervisor').classList.add('aberto');
    setTimeout(() => $('supervisor-senha').focus(), 100);
  });
}
function fecharSupervisor(ok) {
  $('overlay-supervisor').classList.remove('aberto');
  const r = _supervisorResolve; _supervisorResolve = null;
  if (r) r(ok);
}
function validarSupervisor() {
  const senha = $('supervisor-senha').value;
  const sup = USUARIOS.find(u => u.usuario === 'admin'); // supervisor = Administrador
  if (sup && senha === sup.senha) fecharSupervisor(true);
  else { $('supervisor-erro').textContent = '⚠️ Senha incorreta'; $('supervisor-senha').value = ''; $('supervisor-senha').focus(); }
}
$('btn-supervisor-ok').addEventListener('click', validarSupervisor);
$('supervisor-senha').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); validarSupervisor(); } });
$('btn-fechar-supervisor').addEventListener('click', () => fecharSupervisor(false));
$('overlay-supervisor').addEventListener('click', e => { if (e.target === $('overlay-supervisor')) fecharSupervisor(false); });

function fazerLogin(nome) {
  sessionStorage.setItem('acai_logado', nome);
  $('user-nome').textContent = nome;
  $('home-user').textContent = nome.split(' ')[0];
  $('tela-login').classList.add('oculto');
  $('app-principal').classList.remove('oculto');
  irPara('home');
}
function logout() {
  sessionStorage.removeItem('acai_logado');
  $('app-principal').classList.add('oculto');
  $('tela-login').classList.remove('oculto');
  $('form-login').reset();
  setTimeout(() => $('login-user').focus(), 60);
}

$('form-login').addEventListener('submit', e => {
  e.preventDefault();
  const u = $('login-user').value.trim().toLowerCase();
  const s = $('login-senha').value;
  const user = USUARIOS.find(x => x.usuario === u && x.senha === s);
  if (user) { $('login-erro').textContent = ''; fazerLogin(user.nome); }
  else {
    $('login-erro').textContent = '⚠️ Usuário ou senha inválidos';
    $('login-senha').value = '';
    $('login-senha').focus();
  }
});
$('login-user').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('login-senha').focus(); }
});
$('btn-sair').addEventListener('click', logout);

/* Atalho universal: Alt + letra sublinhada aciona o botão correspondente */
document.addEventListener('keydown', e => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (algumOverlayAberto()) return;            // não navega "por trás" de um modal aberto
  const letra = (e.key || '').toLowerCase();
  if (letra.length !== 1) return;
  for (const span of document.querySelectorAll('button .atalho')) {
    if (span.textContent.trim().toLowerCase() === letra) {
      const btn = span.closest('button');
      if (btn && btn.offsetParent !== null && !btn.disabled) {
        e.preventDefault();
        btn.click();
        return;
      }
    }
  }
});

/* ═══════════════════════════════════════════════════════════
   FINALIZAÇÃO AUTOMÁTICA POR INATIVIDADE (1min30) + voz
   ═══════════════════════════════════════════════════════════ */
const INATIVIDADE_SEG = 30;        // 30 segundos
let inatividadeRestante = INATIVIDADE_SEG;

/* Fala um texto em pt-BR (síntese de voz do navegador) */
function falar(texto) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'pt-BR';
    u.rate = 1;
    const voz = speechSynthesis.getVoices().find(v => (v.lang || '').toLowerCase().startsWith('pt'));
    if (voz) u.voice = voz;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {}
}
// pré-carrega as vozes (alguns navegadores carregam de forma assíncrona)
if ('speechSynthesis' in window) speechSynthesis.getVoices();

/* O cronômetro só corre com venda em aberto, na tela PDV e sem modais */
function algumOverlayAberto() {
  return ['overlay-recebimento', 'overlay-item', 'overlay-busca', 'overlay-cartao-tipo', 'overlay-pedido', 'overlay-rendimento', 'overlay-clientes-delivery', 'overlay-disponibilidade', 'overlay-supervisor']
    .some(id => $(id).classList.contains('aberto'));
}
function podeContarInatividade() {
  return !$('app-principal').classList.contains('oculto')
      && $('tela-pdv').classList.contains('ativa')
      && itensCupom.length > 0
      && !algumOverlayAberto();
}
function resetarInatividade() { inatividadeRestante = INATIVIDADE_SEG; }

/* Qualquer ação do usuário zera o cronômetro */
['keydown', 'click', 'input'].forEach(ev =>
  document.addEventListener(ev, resetarInatividade, true));

/* Tique de 1s */
setInterval(() => {
  const badge = $('auto-finaliza');
  if (!podeContarInatividade()) {
    badge.style.display = 'none';
    badge.classList.remove('alerta');
    inatividadeRestante = INATIVIDADE_SEG;
    return;
  }
  badge.style.display = '';
  inatividadeRestante--;
  const m = Math.floor(inatividadeRestante / 60);
  const s = inatividadeRestante % 60;
  $('af-tempo').textContent = `${m}:${String(s).padStart(2, '0')}`;
  badge.classList.toggle('alerta', inatividadeRestante <= 10);
  if (inatividadeRestante <= 0) finalizarAutomatico();
}, 1000);

function finalizarAutomatico() {
  inatividadeRestante = INATIVIDADE_SEG;
  $('auto-finaliza').style.display = 'none';
  $('auto-finaliza').classList.remove('alerta');
  const total = itensCupom.reduce((s, it) => s + it.qtd * it.preco, 0);
  toast(`⏱ Venda finalizada automaticamente · ${fmt(total)}`, 'sucesso');
  falar('Venda finalizada automaticamente');
  concluirVenda(total, 'Automático');
  $('codigo').focus();
}

/* ═══════════════════════════════════════════════════════════
   MÓDULO PRODUTOS / ESTOQUE
   ═══════════════════════════════════════════════════════════ */
// Sub-abas
document.querySelectorAll('.prod-tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.prod-tab').forEach(x => x.classList.remove('ativo'));
  document.querySelectorAll('.prod-painel').forEach(x => x.classList.remove('ativo'));
  t.classList.add('ativo');
  $('ptab-' + t.dataset.ptab).classList.add('ativo');
  if (t.dataset.ptab === 'merc')    { renderProdutos(); setTimeout(() => $('pf-nota').focus(), 50); }
  if (t.dataset.ptab === 'insumos') { renderInsumos(); setTimeout(() => $('if-nome').focus(), 50); }
  if (t.dataset.ptab === 'hist')    renderHistorico();
  if (t.dataset.ptab === 'notas')   { renderNotas(); setTimeout(() => $('notas-filtro').focus(), 50); }
}));

/* Margem de lucratividade — só preço de compra vs venda (insumos NÃO entram) */
function margemDe(precoVenda, precoCompra) {
  const custo = +precoCompra || 0;
  const venda = +precoVenda || 0;
  if (venda <= 0) return null;
  return { pct: (venda - custo) / venda * 100, lucro: venda - custo, custo };
}
function atualizarMargemForm() {
  const m = margemDe(+$('pf-venda').value, +$('pf-compra').value);
  $('pf-margem').textContent = m ? `${m.pct.toFixed(1)}%  (lucro ${fmt(m.lucro)})` : '—';
}
['pf-venda', 'pf-compra'].forEach(id => $(id).addEventListener('input', atualizarMargemForm));

/* Dar entrada por valor total: divide pela quantidade → custo unitário automático */
function calcularCustoUnitario() {
  const qtd = +$('pf-entrada').value || 0;
  const total = +$('pf-valortotal').value || 0;
  if (qtd > 0 && total > 0) {
    $('pf-compra').value = (total / qtd).toFixed(2);
    atualizarMargemForm();
  }
}
['pf-entrada', 'pf-valortotal'].forEach(id => $(id).addEventListener('input', calcularCustoUnitario));

/* Entrada por caixa: caixas × unid. por caixa → preenche "Entrada (qtd)" automaticamente */
function calcularEntradaPorCaixa() {
  const caixas = +$('pf-caixas').value || 0;
  const unidPorCaixa = +$('pf-unidcaixa').value || 0;
  if (caixas > 0 && unidPorCaixa > 0) {
    $('pf-entrada').value = caixas * unidPorCaixa;
    calcularCustoUnitario();
  }
}
['pf-caixas', 'pf-unidcaixa'].forEach(id => $(id).addEventListener('input', calcularEntradaPorCaixa));

/* Entrada por caixa: caixas × valor da caixa → preenche "Valor total pago" e já desce pro custo unitário */
function calcularValorPorCaixa() {
  const caixas = +$('pf-caixas').value || 0;
  const valorCaixa = +$('pf-valorcaixa').value || 0;
  if (caixas > 0 && valorCaixa > 0) {
    $('pf-valortotal').value = (caixas * valorCaixa).toFixed(2);
    calcularCustoUnitario();
  }
}
['pf-caixas', 'pf-valorcaixa'].forEach(id => $(id).addEventListener('input', calcularValorPorCaixa));

/* Salvar / dar entrada */
$('form-produto').addEventListener('submit', e => {
  e.preventDefault();
  const cod = $('pf-codigo').value.trim();
  if (!cod) return;
  const entrada = +$('pf-entrada').value || 0;
  const dados = {
    codigo: cod.toUpperCase(),
    nome: $('pf-nome').value.trim(),
    conjunto: $('pf-conjunto').value.trim(),
    departamento: $('pf-departamento').value.trim(),
    fornecedor: $('pf-fornecedor').value.trim(),
    precoCompra: +$('pf-compra').value || 0,
    precoVenda: +$('pf-venda').value || 0,
    estoqueMin: +$('pf-min').value || 0,
    unidPorCaixa: +$('pf-unidcaixa').value || 0,
    precoVendaCaixa: +$('pf-vendacaixa').value || 0,
  };
  let p = PRODUTOS.find(x => x.codigo.toLowerCase() === cod.toLowerCase());
  if (p) {
    Object.assign(p, dados);
    p.estoque = (+p.estoque || 0) + entrada;
    toast(`✅ ${p.nome} atualizado${entrada ? ` (+${entrada} no estoque)` : ''}`, 'sucesso');
  } else {
    PRODUTOS.push({ ...dados, estoque: entrada });
    toast(`✅ ${dados.nome} cadastrado`, 'sucesso');
  }
  // registra a compra como gasto (entrada com valor pago OU com nota fiscal informada)
  const numNota = $('pf-nota').value.trim();
  const valorTotalCompra = (+$('pf-valortotal').value || 0) || (entrada * (dados.precoCompra || 0));
  if (entrada > 0 && (valorTotalCompra > 0 || numNota)) {
    comprasLog.push({ hora: new Date().toISOString(), codigo: dados.codigo, nome: dados.nome, qtd: entrada, total: valorTotalCompra, numNota });
    salvarComprasLog();
  }
  salvarEstoque();
  limparFormProduto();
  // a nota fica fixa pro próximo produto da mesma nota — e o resumo mostra o total acumulando
  if (numNota) {
    $('pf-nota').value = numNota;
    atualizarResumoNotaForm();
    $('pf-nome').focus();   // nota já fixa → próximo produto começa pela Descrição
  }
  renderProdutos();
});
$('btn-prod-limpar').addEventListener('click', limparFormProduto);
$('btn-prod-excluir').addEventListener('click', () => {
  const cod = $('pf-codigo').value.trim().toUpperCase();
  if (!cod) return;
  excluirProduto(cod);
});
/* Zerar todos os produtos cadastrados (recomeçar do zero) */
$('btn-prod-zerar').addEventListener('click', () => {
  if (!PRODUTOS.length) { toast('Nenhum produto cadastrado'); return; }
  if (!confirm(`Apagar TODOS os ${PRODUTOS.length} produtos cadastrados?\nEssa ação não pode ser desfeita.`)) return;
  PRODUTOS = [];
  salvarEstoque();
  limparFormProduto();
  renderProdutos();
  toast('🧹 Todos os cadastros foram apagados');
});

/* ═══════════════════════════════════════════════════════════
   RENDIMENTO — uma matéria-prima (ex: saca de açaí R$250) vira
   vários produtos com preços diferentes; o custo total é dividido
   entre eles (custo unit. = total ÷ qtd total, ajustável por linha)
   ═══════════════════════════════════════════════════════════ */
function abrirRendimento() {
  $('rend-materia').value = '';
  $('rend-qtd-materia').value = '1';
  $('rend-valor-unit').value = '';
  $('rend-total').value = '';
  $('rend-departamento').value = $('pf-departamento').value.trim();
  $('rend-fornecedor').value = $('pf-fornecedor').value.trim();
  // Nº da nota fica disponível pro próximo cadastro — só herda do form principal se ainda não tiver uma própria
  if (!$('rend-nota').value.trim() && $('pf-nota').value.trim()) $('rend-nota').value = $('pf-nota').value.trim();
  $('rend-linhas').innerHTML = '';
  addLinhaRendimento(); addLinhaRendimento(); addLinhaRendimento();   // começa com 3 linhas (ex.: 10/15/20)
  recalcularRendimento();
  atualizarResumoNotaRend();
  $('overlay-rendimento').classList.add('aberto');
  setTimeout(() => $('rend-valor-unit').focus(), 60);
}

/* Duplo-espaço (campo vazio) abre a busca do que já foi processado antes — mesmo padrão usado em todo o projeto */
let ultimoEspacoMateria = 0;
$('rend-materia').addEventListener('keydown', e => {
  if (e.key !== ' ' || $('rend-materia').value.trim() !== '') return;
  e.preventDefault();
  const agora = Date.now();
  if (agora - ultimoEspacoMateria < 450) { ultimoEspacoMateria = 0; abrirBuscaProduto('materia'); }
  else ultimoEspacoMateria = agora;
});

/* ── Receita por matéria-prima: lembra quais produtos saíram da última vez que essa
   matéria-prima foi processada, pra recarregar pronto e só ajustar qtd/valor ── */
function chaveMateria(nome) { return (nome || '').trim().toLowerCase(); }

function carregarReceitaRendimento(materiaNome) {
  const r = receitasRendimento[chaveMateria(materiaNome)];
  if (!r || !r.itens.length) return false;
  const linhasAtuais = [...$('rend-linhas').querySelectorAll('.rend-linha')];
  const todasVazias = linhasAtuais.every(l => !l.querySelector('.rl-cod').value.trim() && !l.querySelector('.rl-desc').value.trim());
  if (!todasVazias) { toast(`💡 Receita de "${r.nomeOriginal}" disponível — limpe as linhas pra carregar`); return false; }
  $('rend-linhas').innerHTML = '';
  r.itens.forEach(it => {
    addLinhaRendimento();
    const linha = $('rend-linhas').lastElementChild;
    linha.querySelector('.rl-cod').value = it.cod;
    linha.querySelector('.rl-desc').value = it.desc;
    linha.querySelector('.rl-preco').value = it.preco;
  });
  recalcularRendimento();
  toast(`📋 Receita de "${r.nomeOriginal}" carregada — ajuste quantidade e valores`, 'sucesso');
  const primeira = $('rend-linhas').querySelector('.rend-linha');
  if (primeira) primeira.querySelector('.rl-qtd').focus();
  return true;
}
$('rend-materia').addEventListener('change', () => carregarReceitaRendimento($('rend-materia').value));
/* Quantidade × valor unitário da matéria-prima → total pago (automático) */
function calcularTotalRendimento() {
  const qtd = +$('rend-qtd-materia').value || 0;
  const valorUnit = +$('rend-valor-unit').value || 0;
  const total = qtd * valorUnit;
  $('rend-total').value = total > 0 ? total.toFixed(2) : '';
  recalcularRendimento();
}
['rend-qtd-materia', 'rend-valor-unit'].forEach(id => $(id).addEventListener('input', calcularTotalRendimento));
function fecharRendimento() {
  $('overlay-rendimento').classList.remove('aberto');
  $('pf-nota').focus();
}
$('btn-abrir-rendimento').addEventListener('click', abrirRendimento);
$('btn-fechar-rend').addEventListener('click', fecharRendimento);
$('overlay-rendimento').addEventListener('click', e => { if (e.target === $('overlay-rendimento')) fecharRendimento(); });

function addLinhaRendimento(foco = false) {
  const div = document.createElement('div');
  div.className = 'rend-linha';
  div.innerHTML =
    '<input class="rl-cod" placeholder="Cód" autocomplete="off">' +
    '<input class="rl-desc" placeholder="Descrição" autocomplete="off">' +
    '<input class="rl-qtd" type="number" min="0" step="1" placeholder="0">' +
    '<input class="rl-preco" type="number" min="0" step="0.01" placeholder="0,00">' +
    '<input class="rl-custo" type="number" min="0" step="0.01" placeholder="auto">' +
    '<span class="rl-margem">—</span>' +
    '<button type="button" class="rl-del" title="Remover">✕</button>';
  $('rend-linhas').appendChild(div);
  if (foco) div.querySelector('.rl-cod').focus();
}

/* Preenche a linha com um produto JÁ CADASTRADO (selecionado na busca) — código, descrição e
   preço de venda vêm prontos; só falta digitar a quantidade dessa nova entrada */
function preencherLinhaRendimento(linha, p) {
  if (!linha || !p) return;
  linha.querySelector('.rl-cod').value = p.codigo;
  linha.querySelector('.rl-desc').value = p.nome;
  linha.querySelector('.rl-preco').value = p.precoVenda || '';
  recalcularRendimento();
  linha.querySelector('.rl-qtd').focus();
}

/* Recalcula custo unitário padrão (total ÷ qtd total) e as margens por linha */
function recalcularRendimento() {
  const total = +$('rend-total').value || 0;
  const linhas = [...$('rend-linhas').querySelectorAll('.rend-linha')];
  let somaQtd = 0;
  linhas.forEach(l => somaQtd += +l.querySelector('.rl-qtd').value || 0);
  const custoPadrao = somaQtd > 0 ? total / somaQtd : 0;

  let somaAloc = 0, linhasValidas = 0;
  linhas.forEach(l => {
    const qtd = +l.querySelector('.rl-qtd').value || 0;
    const preco = +l.querySelector('.rl-preco').value || 0;
    const custoInp = l.querySelector('.rl-custo');
    if (custoInp.dataset.manual !== '1') {                // custo automático se não foi editado à mão
      custoInp.value = custoPadrao > 0 ? custoPadrao.toFixed(2) : '';
      custoInp.classList.remove('manual');
    }
    const custo = +custoInp.value || 0;
    somaAloc += custo * qtd;
    const cod = l.querySelector('.rl-cod').value.trim();
    const desc = l.querySelector('.rl-desc').value.trim();
    if (cod && desc && qtd > 0 && preco > 0) linhasValidas++;
    const mEl = l.querySelector('.rl-margem');
    if (preco > 0) {
      const pct = (preco - custo) / preco * 100;
      mEl.textContent = pct.toFixed(0) + '%';
      mEl.classList.toggle('neg', pct < 0);
    } else { mEl.textContent = '—'; mEl.classList.remove('neg'); }
  });

  $('rend-r-total').textContent = fmt(total);
  $('rend-r-qtd').textContent = somaQtd;
  $('rend-r-medio').textContent = fmt(custoPadrao);
  $('rend-r-aloc').textContent = fmt(somaAloc);
  const box = $('rend-r-aloc-box');
  box.classList.remove('ok', 'dif');
  if (total > 0) box.classList.add(Math.abs(somaAloc - total) < 0.01 ? 'ok' : 'dif');

  $('btn-confirmar-rend').disabled = !(total > 0 && linhasValidas > 0);
}

$('rend-linhas').addEventListener('input', e => {
  if (e.target.classList.contains('rl-custo')) {          // usuário digitou custo manual nessa linha
    e.target.dataset.manual = '1';
    e.target.classList.add('manual');
  }
  recalcularRendimento();
});
$('rend-linhas').addEventListener('click', e => {
  if (!e.target.classList.contains('rl-del')) return;
  const linhas = $('rend-linhas').querySelectorAll('.rend-linha');
  if (linhas.length > 1) e.target.closest('.rend-linha').remove();
  else e.target.closest('.rend-linha').querySelectorAll('input').forEach(i => { i.value = ''; i.dataset.manual = ''; i.classList.remove('manual'); });
  recalcularRendimento();
});
/* Duplo-espaço na Descrição (campo vazio) abre a busca de produtos cadastrados — reaproveita
   código/descrição/preço de um produto já existente, pra dar entrada nele de novo */
$('rend-linhas').addEventListener('keydown', e => {
  if (e.key !== ' ' || !e.target.classList.contains('rl-desc') || e.target.value.trim() !== '') return;
  e.preventDefault();
  const agora = Date.now();
  if (agora - (+e.target.dataset.ultimoEspaco || 0) < 450) {
    e.target.dataset.ultimoEspaco = '0';
    rendLinhaAtual = e.target.closest('.rend-linha');
    abrirBuscaProduto('rendimento');
  } else {
    e.target.dataset.ultimoEspaco = String(agora);
  }
});
/* Enter no preço/custo da última linha cria nova linha; senão pula pro próximo campo (teclado-first) */
$('rend-linhas').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const linha = e.target.closest('.rend-linha');
  if (!linha) return;
  const linhas = [...$('rend-linhas').querySelectorAll('.rend-linha')];
  const ehUltima = linha === linhas[linhas.length - 1];
  const ultimoCampo = e.target.classList.contains('rl-preco') || e.target.classList.contains('rl-custo');
  if (ultimoCampo && ehUltima) { addLinhaRendimento(true); return; }
  const inputs = [...linha.querySelectorAll('input')];
  const i = inputs.indexOf(e.target);
  if (inputs[i + 1]) inputs[i + 1].focus();
  else if (linha.nextElementSibling) linha.nextElementSibling.querySelector('.rl-cod').focus();
});
$('btn-rend-add').addEventListener('click', () => addLinhaRendimento(true));
$('rend-departamento').addEventListener('input', recalcularRendimento);

/* Processar: cria/atualiza cada produto e registra UMA compra (o gasto da matéria-prima) */
function confirmarRendimento() {
  const total = +$('rend-total').value || 0;
  if (total <= 0) { toast('⚠ Informe o valor total pago', 'erro'); return; }
  const dep = $('rend-departamento').value.trim();
  const forn = $('rend-fornecedor').value.trim();
  const materia = $('rend-materia').value.trim();

  const linhas = [...$('rend-linhas').querySelectorAll('.rend-linha')];
  const saidas = [];
  let incompleta = false, somaQtd = 0;
  linhas.forEach(l => {
    const cod = l.querySelector('.rl-cod').value.trim();
    const desc = l.querySelector('.rl-desc').value.trim();
    const qtd = +l.querySelector('.rl-qtd').value || 0;
    const preco = +l.querySelector('.rl-preco').value || 0;
    const custo = +l.querySelector('.rl-custo').value || 0;
    if (!cod && !desc && !qtd && !preco) return;           // linha em branco: ignora
    if (!cod || !desc || qtd <= 0 || preco <= 0) { incompleta = true; return; }
    saidas.push({ cod: cod.toUpperCase(), desc, qtd, preco, custo });
    somaQtd += qtd;
  });
  if (incompleta) { toast('⚠ Preencha código, descrição, qtd e preço em todas as linhas', 'erro'); return; }
  if (saidas.length === 0) { toast('⚠ Adicione ao menos um produto', 'erro'); return; }

  saidas.forEach(s => {
    const p = PRODUTOS.find(x => x.codigo.toLowerCase() === s.cod.toLowerCase());
    if (p) {
      p.nome = s.desc; p.precoVenda = s.preco; p.precoCompra = s.custo;
      if (dep) p.departamento = dep;
      if (forn) p.fornecedor = forn;
      p.estoque = (+p.estoque || 0) + s.qtd;
    } else {
      PRODUTOS.push({ codigo: s.cod, nome: s.desc, conjunto: '', departamento: dep, fornecedor: forn,
        precoCompra: s.custo, precoVenda: s.preco, estoque: s.qtd, estoqueMin: 0, unidPorCaixa: 0 });
    }
  });
  // UMA compra registrada — o gasto real da matéria-prima (não conta o custo por produto pra não duplicar)
  const qtdMateria = +$('rend-qtd-materia').value || somaQtd;
  comprasLog.push({ hora: new Date().toISOString(), codigo: '(rendimento)', nome: materia || 'Processamento', qtd: qtdMateria, total, numNota: $('rend-nota').value.trim() });
  salvarComprasLog();
  // memoriza a composição (código/descrição/preço) pra reaproveitar na próxima vez que essa matéria-prima for digitada
  const chave = chaveMateria(materia);
  if (chave) {
    receitasRendimento[chave] = { nomeOriginal: materia, itens: saidas.map(s => ({ cod: s.cod, desc: s.desc, preco: s.preco })) };
    salvarReceitasRendimento();
  }
  salvarEstoque();
  fecharRendimento();
  atualizarResumoNotaForm();   // o rendimento entrou na nota — mantém o resumo do form em dia
  renderProdutos();
  toast(`✅ ${saidas.length} produto(s) gerados de ${materia || 'matéria-prima'} · ${fmt(total)}`, 'sucesso');
}
$('btn-confirmar-rend').addEventListener('click', confirmarRendimento);

function limparFormProduto() {
  ['pf-codigo','pf-conjunto','pf-nome','pf-departamento','pf-fornecedor','pf-compra','pf-venda','pf-entrada','pf-valortotal','pf-min','pf-caixas','pf-unidcaixa','pf-valorcaixa','pf-vendacaixa','pf-nota']
    .forEach(id => $(id).value = '');
  atualizarMargemForm();
  atualizarResumoNotaForm();
  esconderDetalheProduto();
  $('pf-nota').focus();
}
/* Carrega o produto no formulário (editar/dar entrada) e expande os detalhes */
function editarProdutoForm(cod) {
  const p = PRODUTOS.find(x => x.codigo === cod);
  if (!p) return;
  $('pf-codigo').value = p.codigo;
  $('pf-conjunto').value = p.conjunto || '';
  $('pf-nome').value = p.nome || '';
  $('pf-departamento').value = p.departamento || '';
  $('pf-fornecedor').value = p.fornecedor || '';
  $('pf-compra').value = p.precoCompra || '';
  $('pf-venda').value = p.precoVenda || '';
  $('pf-min').value = p.estoqueMin || '';
  $('pf-unidcaixa').value = p.unidPorCaixa || '';
  $('pf-vendacaixa').value = p.precoVendaCaixa || '';
  $('pf-entrada').value = '';
  $('pf-valortotal').value = '';
  $('pf-caixas').value = '';
  $('pf-valorcaixa').value = '';
  // pf-nota NÃO é limpo aqui: ao carregar um produto pra dar entrada, a nota da sessão continua valendo
  atualizarMargemForm();
  mostrarDetalheProduto(p.codigo);
  $('pf-nome').focus();
}
/* Excluir produto definitivamente do cadastro */
function excluirProduto(cod) {
  const p = PRODUTOS.find(x => x.codigo === cod);
  if (!p) return;
  if (confirm(`Excluir definitivamente "${p.nome}" (${p.codigo})?\nEssa ação não pode ser desfeita.`)) {
    PRODUTOS = PRODUTOS.filter(x => x.codigo !== cod);
    salvarEstoque();
    limparFormProduto();
    renderProdutos();
    toast(`🗑 ${p.nome} excluído`);
  }
}

/* Resumo de vendas de um produto (qtd vendida, faturado, última venda) */
function calcularDesempenhoProduto(cod) {
  let qtd = 0, faturado = 0, ultima = null;
  vendasLog.forEach(v => {
    (v.itens || []).forEach(it => {
      if (it.cod === cod) {
        qtd += it.qtd;
        faturado += it.qtd * it.preco;
        if (!ultima || v.hora > ultima) ultima = v.hora;
      }
    });
  });
  return { qtd, faturado, ultima };
}

/* ── Painel de detalhes do produto (Mercadorias) ──────────────
   Substitui a antiga tabela sempre visível: só aparece ao localizar
   um produto pelo código (Enter) ou pela busca (duplo-espaço). */
let produtoDetalheAtual = null;
function mostrarDetalheProduto(cod) {
  const p = PRODUTOS.find(x => x.codigo === cod);
  if (!p) { esconderDetalheProduto(); return; }
  const trocouProduto = produtoDetalheAtual !== p.codigo;
  produtoDetalheAtual = p.codigo;
  $('pd-vazio').style.display = 'none';
  $('pd-conteudo').style.display = '';

  $('pd-cod').textContent = p.codigo;
  $('pd-nome').textContent = p.nome || '—';
  const tagDep = $('pd-tag-dep'), tagForn = $('pd-tag-forn'), tagConj = $('pd-tag-conj');
  tagDep.textContent = p.departamento || ''; tagDep.style.display = p.departamento ? '' : 'none';
  tagForn.textContent = p.fornecedor ? `🚚 ${p.fornecedor}` : ''; tagForn.style.display = p.fornecedor ? '' : 'none';
  tagConj.textContent = p.conjunto ? `Conjunto: ${p.conjunto}` : ''; tagConj.style.display = p.conjunto ? '' : 'none';

  const est = +p.estoque || 0, min = +p.estoqueMin || 0;
  const faixa = est === 0 ? 'zero' : (est <= min ? 'baixo' : 'ok');
  const numEl = $('pd-estoque-num');
  numEl.textContent = est;
  numEl.className = 'pd-estoque-num' + (faixa !== 'ok' ? ' ' + faixa : '');
  $('pd-estoque-min').textContent = min;
  const meta = Math.max(min * 3, est, 5);
  const pct = Math.min(100, Math.max(est > 0 ? 6 : 0, (est / meta) * 100));
  const fill = $('pd-gauge-fill');
  fill.style.width = pct + '%';
  fill.className = 'pd-gauge-fill' + (faixa !== 'ok' ? ' ' + faixa : '');

  const m = margemDe(p.precoVenda, p.precoCompra);
  $('pd-compra').textContent = fmt(p.precoCompra);
  $('pd-venda').textContent = fmt(p.precoVenda);
  $('pd-margem').textContent = m ? `${m.pct.toFixed(1)}%` : '—';

  const d = calcularDesempenhoProduto(p.codigo);
  $('pd-qtdvend').textContent = d.qtd;
  $('pd-faturado').textContent = fmt(d.faturado);
  $('pd-ultvenda').textContent = d.ultima
    ? new Date(d.ultima).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';

  $('pd-set-input').value = '';

  if (trocouProduto || !$('pd-data-de').value || !$('pd-data-ate').value) {
    const hoje = new Date();
    const primeiroDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    $('pd-data-de').value = primeiroDoMes.toISOString().slice(0, 10);
    $('pd-data-ate').value = hoje.toISOString().slice(0, 10);
  }
  atualizarPeriodoProduto();
}
function esconderDetalheProduto() {
  produtoDetalheAtual = null;
  $('pd-conteudo').style.display = 'none';
  $('pd-vazio').style.display = '';
}

/* Vendas do produto num período (data específica ou intervalo) + média diária */
function calcularVendasPeriodoProduto(cod, deStr, ateStr) {
  if (!deStr || !ateStr) return { qtd: 0, faturado: 0, dias: 1 };
  const de = new Date(deStr + 'T00:00:00');
  const ate = new Date(ateStr + 'T23:59:59');
  let qtd = 0, faturado = 0;
  vendasLog.forEach(v => {
    const h = new Date(v.hora);
    if (h < de || h > ate) return;
    (v.itens || []).forEach(it => {
      if (it.cod === cod) { qtd += it.qtd; faturado += it.qtd * it.preco; }
    });
  });
  const dias = Math.max(1, Math.round((ate - de) / 86400000) + 1);
  return { qtd, faturado, dias };
}
function atualizarPeriodoProduto() {
  if (!produtoDetalheAtual) return;
  const r = calcularVendasPeriodoProduto(produtoDetalheAtual, $('pd-data-de').value, $('pd-data-ate').value);
  $('pd-periodo-qtd').textContent = r.qtd;
  $('pd-periodo-fat').textContent = fmt(r.faturado);
  $('pd-periodo-media').textContent = (r.qtd / r.dias).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '/dia';
}
['pd-data-de', 'pd-data-ate'].forEach(id => $(id).addEventListener('change', atualizarPeriodoProduto));
/* Ajuste dinâmico de estoque: +/- rápido ou definir valor exato, sem precisar do form de entrada */
function ajustarEstoqueDetalhe(delta) {
  if (!produtoDetalheAtual) return;
  const p = PRODUTOS.find(x => x.codigo === produtoDetalheAtual);
  if (!p) return;
  p.estoque = Math.max(0, (+p.estoque || 0) + delta);
  salvarEstoque();
  mostrarDetalheProduto(p.codigo);
  atualizarAlertaBaixoEstoque();
  toast(`📦 ${p.nome}: estoque ${p.estoque}`);
}
$('prod-detalhe').addEventListener('click', e => {
  const btn = e.target.closest('.pd-ajuste');
  if (btn) ajustarEstoqueDetalhe(+btn.dataset.delta);
});
function definirEstoqueDetalhe() {
  if (!produtoDetalheAtual) return;
  const v = $('pd-set-input').value;
  if (v === '') return;
  const p = PRODUTOS.find(x => x.codigo === produtoDetalheAtual);
  if (!p) return;
  p.estoque = Math.max(0, +v || 0);
  salvarEstoque();
  mostrarDetalheProduto(p.codigo);
  atualizarAlertaBaixoEstoque();
  toast(`📦 ${p.nome}: estoque ajustado para ${p.estoque}`);
}
$('pd-set-btn').addEventListener('click', definirEstoqueDetalhe);
$('pd-set-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); definirEstoqueDetalhe(); } });
$('pd-excluir').addEventListener('click', () => { if (produtoDetalheAtual) excluirProduto(produtoDetalheAtual); });

/* Aviso dinâmico de estoque baixo (substitui a coluna ⚠ da antiga tabela) */
function atualizarAlertaBaixoEstoque() {
  const baixos = PRODUTOS.filter(p => (+p.estoque || 0) <= (+p.estoqueMin || 0));
  const el = $('pd-alerta-baixo');
  if (baixos.length === 0) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `⚠ <strong>${baixos.length}</strong> produto${baixos.length > 1 ? 's' : ''} com estoque baixo — <span class="pd-alerta-link">localizar</span>`;
}
$('pd-alerta-baixo').addEventListener('click', () => abrirBuscaProduto('produtos'));

function renderProdutos() {
  atualizarAlertaBaixoEstoque();
  if (produtoDetalheAtual && PRODUTOS.some(p => p.codigo === produtoDetalheAtual)) mostrarDetalheProduto(produtoDetalheAtual);
}

/* pf-codigo: Enter carrega produto existente (dar entrada rápido) ou pula pro nome */
$('pf-codigo').dataset.enterCustom = '1';
$('pf-codigo').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const cod = $('pf-codigo').value.trim();
  if (!cod) return;
  const p = buscarPorCodigo(cod);
  if (p) { editarProdutoForm(p.codigo); $('pf-entrada').focus(); toast(`📦 ${p.nome} — estoque atual ${p.estoque}`); }
  else { esconderDetalheProduto(); $('pf-nome').focus(); }
});

/* Descrição: duplo-espaço (campo vazio) abre a busca de produtos cadastrados */
let ultimoEspacoNome = 0;
$('pf-nome').addEventListener('keydown', e => {
  if (e.key === ' ' && $('pf-nome').value.trim() === '') {
    e.preventDefault();
    const agora = Date.now();
    if (agora - ultimoEspacoNome < 450) { ultimoEspacoNome = 0; abrirBuscaProduto('produtos'); }
    else ultimoEspacoNome = agora;
  }
});

/* ── Insumos ── */
$('form-insumo').addEventListener('submit', e => {
  e.preventDefault();
  const nome = $('if-nome').value.trim();
  if (!nome) return;
  insumos.push({ nome, custo: +$('if-custo').value || 0, qtd: +$('if-qtd').value || 0, hora: new Date().toISOString() });
  salvarInsumos();
  $('form-insumo').reset();
  $('if-unit-preview').textContent = '';
  renderInsumos();
  toast('✅ Insumo adicionado', 'sucesso');
});
// preview do valor por unidade enquanto digita
['if-custo', 'if-qtd'].forEach(id => $(id).addEventListener('input', () => {
  const q = +$('if-qtd').value || 0, c = +$('if-custo').value || 0;
  $('if-unit-preview').textContent = (q > 0 && c > 0) ? `Valor por unidade: ${fmt(c / q)}` : '';
}));
function excluirInsumo(i) { insumos.splice(i, 1); salvarInsumos(); renderInsumos(); renderProdutos(); }
function renderInsumos() {
  const total = insumos.reduce((s, i) => s + (+i.custo || 0), 0);
  $('insumo-resumo').innerHTML = `Total gasto em insumos: <strong>${fmt(total)}</strong> <span style="opacity:.65">— controle de gastos (não entra no custo das mercadorias)</span>`;
  $('insumo-tbody').innerHTML = insumos.map((i, idx) => {
    const unit = (+i.qtd > 0) ? (+i.custo / +i.qtd) : null;
    return `<tr tabindex="0" data-idx="${idx}">
      <td>${i.nome}</td>
      <td class="col-num">${i.qtd || '—'}</td>
      <td class="col-num">${fmt(i.custo)}</td>
      <td class="col-num">${unit != null ? `<strong>${fmt(unit)}</strong>` : '—'}</td>
      <td><button class="btn-mini-del" onclick="excluirInsumo(${idx})">🗑</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="text-align:center;padding:30px;color:rgba(243,234,251,.4)">Nenhum insumo cadastrado</td></tr>`;
}

/* ── Histórico + Resumo financeiro com filtro de período ── */
let histPeriodo = 'hoje';   // hoje | semana | mes | tudo
function dentroDoPeriodo(iso) {
  if (!iso) return histPeriodo === 'tudo';   // registros sem data só contam em "Tudo"
  if (histPeriodo === 'tudo') return true;
  const d = new Date(iso), agora = new Date();
  if (histPeriodo === 'hoje') return d.toDateString() === agora.toDateString();
  const dias = histPeriodo === 'semana' ? 7 : 30;
  const limite = new Date(agora);
  limite.setDate(limite.getDate() - dias + 1);
  limite.setHours(0, 0, 0, 0);
  return d >= limite;
}
document.querySelectorAll('.periodo-btn').forEach(b => b.addEventListener('click', () => {
  histPeriodo = b.dataset.periodo;
  document.querySelectorAll('.periodo-btn').forEach(x => x.classList.toggle('ativo', x === b));
  renderHistorico();
}));

function renderHistorico() {
  const vendas  = vendasLog.filter(v => dentroDoPeriodo(v.hora));
  const compras = comprasLog.filter(c => dentroDoPeriodo(c.hora));
  const insP    = insumos.filter(i => dentroDoPeriodo(i.hora));
  let totItens = 0, faturamento = 0;
  const porProduto = {}, porHora = {};
  vendas.forEach(v => {
    faturamento += +v.total || 0;
    const h = new Date(v.hora).getHours();
    (v.itens || []).forEach(it => {
      totItens += it.qtd;
      porHora[h] = (porHora[h] || 0) + it.qtd;
      const k = it.cod || it.nome;
      if (!porProduto[k]) porProduto[k] = { nome: it.nome || it.cod, qtd: 0, valor: 0, ultima: v.hora };
      porProduto[k].qtd += it.qtd;
      porProduto[k].valor += it.qtd * it.preco;
      if (new Date(v.hora) > new Date(porProduto[k].ultima)) porProduto[k].ultima = v.hora;
    });
  });
  $('hist-vendas').textContent = vendas.length;
  $('hist-itens').textContent = totItens;
  $('hist-faturamento').textContent = fmt(faturamento);

  // Resumo financeiro: gastos consolidados (compras + insumos) e saldo
  const totalCompras = compras.reduce((s, c) => s + (+c.total || 0), 0);
  const totalInsumos = insP.reduce((s, i) => s + (+i.custo || 0), 0);
  const totalGastos = totalCompras + totalInsumos;
  const saldo = faturamento - totalGastos;
  $('gasto-compras').textContent = fmt(totalCompras);
  $('gasto-insumos').textContent = fmt(totalInsumos);
  $('gasto-total').textContent = fmt(totalGastos);
  $('saldo').textContent = fmt(saldo);
  $('saldo').style.color = saldo >= 0 ? 'var(--verde)' : 'var(--vermelho)';
  let picoH = null, picoQ = 0;
  Object.entries(porHora).forEach(([h, q]) => { if (q > picoQ) { picoQ = q; picoH = h; } });
  $('hist-pico').textContent = picoH != null ? `${String(picoH).padStart(2, '0')}h` : '—';
  const linhas = Object.values(porProduto).sort((a, b) => b.qtd - a.qtd);
  $('hist-tbody').innerHTML = linhas.map(p => `
    <tr tabindex="0"><td>${p.nome}</td><td class="col-num">${p.qtd}</td><td class="col-num">${fmt(p.valor)}</td>
    <td class="col-num">${new Date(p.ultima).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td></tr>`).join('')
    || `<tr><td colspan="4" style="text-align:center;padding:30px;color:rgba(243,234,251,.4)">Nenhuma venda registrada ainda</td></tr>`;
}

/* Resumo de uma nota fiscal: todas as entradas (form normal + rendimento) com esse número e a soma.
   Usado tanto pelo campo ao vivo do formulário quanto pela busca do Histórico. */
function resumoDaNota(num) {
  const n = (num || '').trim().toLowerCase();
  const itens = n ? comprasLog.filter(c => (c.numNota || '').trim().toLowerCase() === n) : [];
  return { itens, total: itens.reduce((s, c) => s + (+c.total || 0), 0) };
}
/* Pinta um mini-resumo "Total da nota X: R$ Y · N entradas" em qualquer um dos campos de nota */
function pintarResumoNota(num, boxId, numId, totalId, qtdId) {
  const box = $(boxId);
  if (!num) { box.style.display = 'none'; return; }
  const { itens, total } = resumoDaNota(num);
  box.style.display = '';
  $(numId).textContent = num;
  $(totalId).textContent = fmt(total);
  $(qtdId).textContent = `${itens.length} entrada${itens.length === 1 ? '' : 's'}`;
}
function atualizarResumoNotaForm() {
  pintarResumoNota($('pf-nota').value.trim(), 'pf-nota-resumo', 'pf-nota-resumo-num', 'pf-nota-resumo-total', 'pf-nota-resumo-qtd');
}
function atualizarResumoNotaRend() {
  pintarResumoNota($('rend-nota').value.trim(), 'rend-nota-resumo', 'rend-nota-resumo-num', 'rend-nota-resumo-total', 'rend-nota-resumo-qtd');
}
$('pf-nota').addEventListener('input', atualizarResumoNotaForm);
$('rend-nota').addEventListener('input', atualizarResumoNotaRend);

/* ── Aba NOTAS FISCAIS: lista consolidada — uma linha por nº de nota, com o total
   SOMADO de todas as entradas daquela nota (de qualquer dia). Adicionar uma entrada
   com nota já existente engorda o total dela em vez de criar linha nova. ── */
let notaSelecionada = null;
function agruparNotas() {
  const grupos = {};   // chave normalizada → { num, qtd, total, ultima }
  comprasLog.forEach(c => {
    const num = (c.numNota || '').trim();
    if (!num) return;                                  // só entradas COM nota fiscal
    const k = num.toLowerCase();
    if (!grupos[k]) grupos[k] = { num, qtd: 0, total: 0, ultima: c.hora };
    grupos[k].qtd += 1;
    grupos[k].total += (+c.total || 0);
    if (new Date(c.hora) > new Date(grupos[k].ultima)) grupos[k].ultima = c.hora;
  });
  return Object.values(grupos).sort((a, b) => new Date(b.ultima) - new Date(a.ultima));
}
function renderNotas() {
  const filtro = ($('notas-filtro').value || '').trim().toLowerCase();
  const grupos = agruparNotas().filter(g => !filtro || g.num.toLowerCase().includes(filtro));
  const totalGeral = grupos.reduce((s, g) => s + g.total, 0);
  $('notas-total-geral').textContent = fmt(totalGeral);
  $('notas-tbody').innerHTML = grupos.length
    ? grupos.map(g => `
      <tr tabindex="0" data-num="${g.num.replace(/"/g, '&quot;')}">
        <td class="nt-num">${g.num}</td>
        <td class="col-num">${g.qtd}</td>
        <td>${new Date(g.ultima).toLocaleDateString('pt-BR')}</td>
        <td class="nt-total">${fmt(g.total)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;padding:30px;color:rgba(243,234,251,.4)">Nenhuma nota fiscal lançada ainda</td></tr>`;
  $('notas-tbody').querySelectorAll('tr[data-num]').forEach(tr =>
    tr.addEventListener('click', () => { mostrarDetalheNota(tr.dataset.num); tr.focus(); }));
  // mantém o detalhe aberto coerente com o que ainda existe
  if (notaSelecionada && grupos.some(g => g.num.toLowerCase() === notaSelecionada.toLowerCase())) mostrarDetalheNota(notaSelecionada);
  else { notaSelecionada = null; $('nota-resultado').style.display = 'none'; }
}
/* Detalhe de uma nota: lista cada entrada e a soma (mesma de antes, agora acionada ao clicar a linha) */
function mostrarDetalheNota(num) {
  notaSelecionada = num;
  const box = $('nota-resultado');
  const { itens, total } = resumoDaNota(num);
  box.style.display = '';
  $('nota-r-num').textContent = num;
  $('nota-r-qtditens').textContent = itens.length;
  $('nota-r-total').textContent = fmt(total);
  $('nota-r-itens').innerHTML = itens.length
    ? itens.map(c => `
      <div class="nota-item" tabindex="0" title="${new Date(c.hora).toLocaleString('pt-BR')}">
        <span class="ni-cod">${c.codigo}</span>
        <span class="ni-nome">${c.nome}</span>
        <span class="ni-qtd">${c.qtd}</span>
        <span class="ni-valor">${fmt(c.total)}</span>
      </div>`).join('')
    : '<div class="nota-vazio">Nenhuma entrada encontrada com esse número de nota</div>';
}
$('notas-filtro').addEventListener('input', renderNotas);
ativarNavLista($('notas-tbody'), 'tr[data-num]', { onEnter: tr => mostrarDetalheNota(tr.dataset.num) });
ativarNavLista($('nota-r-itens'), '.nota-item', {});

/* ── Enter/seta pula entre campos (agiliza digitação nos formulários):
   Enter e ↓ avançam, ↑ volta — mesmo padrão da navegação por lista, aplicado a forms ── */
function ativarEnterProximo(form) {
  if (!form) return;
  form.addEventListener('keydown', e => {
    const t = e.target;
    if (t.tagName === 'TEXTAREA') return;
    if (t.tagName !== 'INPUT' && t.tagName !== 'SELECT') return;
    if (e.key === 'Enter' && t.dataset.enterCustom) return;   // campo com Enter próprio (ex.: pf-codigo)
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const campos = [...form.querySelectorAll('input:not([type=hidden]), select, textarea, button[type=submit]')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    const i = campos.indexOf(t);
    const prox = e.key === 'ArrowUp' ? campos[i - 1] : campos[i + 1];
    if (!prox) { if (e.key === 'Enter' && form.requestSubmit) form.requestSubmit(); return; }
    prox.focus();
    if (prox.select) prox.select();
  });
}
ativarEnterProximo($('form-produto'));
ativarEnterProximo($('form-pedido'));
ativarEnterProximo($('form-insumo'));

/* ── Navegação por teclado PADRÃO de listas: ↑/↓ move · Enter age · Delete remove ── */
function ativarNavLista(container, itemSel, { onEnter, onDelete } = {}) {
  if (!container) return;
  container.addEventListener('keydown', e => {
    const atual = e.target.closest(itemSel);
    if (!atual) return;
    const itens = [...container.querySelectorAll(itemSel)];
    const i = itens.indexOf(atual);
    if (e.key === 'ArrowDown')      { e.preventDefault(); if (itens[i + 1]) itens[i + 1].focus(); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); if (itens[i - 1]) itens[i - 1].focus(); }
    else if (e.key === 'Enter' && onEnter)   { e.preventDefault(); onEnter(atual); }
    else if (e.key === 'Delete' && onDelete) { e.preventDefault(); onDelete(atual); }
  });
}
ativarNavLista($('insumo-tbody'),  'tr[data-idx]', { onDelete: tr => excluirInsumo(+tr.dataset.idx) });
ativarNavLista($('hist-tbody'),    'tr[tabindex]', {});
ativarNavLista($('delivery-board'), '.del-card',   {
  onEnter:  c => avancarStatus(+c.dataset.id),
  onDelete: c => cancelarPedido(+c.dataset.id),
});

/* ── CLIENTES: cadastro + saldo fiado + extrato + aviso automático no WhatsApp ── */
let CLIENTES = [];
let seqCliente = 0;
let clienteDetalheAtual = null;

function carregarClientes() {
  try {
    CLIENTES = JSON.parse(localStorage.getItem('acai_clientes') || '[]');
    seqCliente = +(localStorage.getItem('acai_clientes_seq') || 0);
  } catch { CLIENTES = []; seqCliente = 0; }
}
function salvarClientes() {
  localStorage.setItem('acai_clientes', JSON.stringify(CLIENTES));
  localStorage.setItem('acai_clientes_seq', seqCliente);
}
function buscarClientePorId(id) { return CLIENTES.find(c => c.id === id); }
/* Saldo nunca é guardado — é sempre a soma do extrato, pra nunca ficar dessincronizado */
function saldoCliente(c) {
  return (c.lancamentos || []).reduce((s, l) => s + (l.tipo === 'compra' ? l.valor : -l.valor), 0);
}

const NOME_LOJA = 'Açaí do Centro';

/* Lançamento compartilhado — usado pela tela Clientes E pelo "Fiado" no Recebimento do PDV.
   Cada lançamento ganha um "id" próprio (sequencial por cliente, em c.lancSeq) pra poder ser
   localizado e revertido depois (ex.: cancelar uma venda no PDV) mesmo que outros lançamentos
   tenham sido adicionados nesse meio-tempo — um índice de array puro ficaria desatualizado.
   "extra" (opcional): { itensTexto, valorTotal, formasPagas } — formasPagas = [{nome, valor}, ...],
   uma linha por forma de pagamento usada (no pagamento, pode ter mais de uma se o cliente dividir
   entre PIX/Dinheiro/Cartão; na compra do PDV, são as formas usadas ALÉM do fiado). */
const EMOJI_FORMA = { PIX: '📱', Dinheiro: '💵', 'Cartão Crédito': '💳', 'Cartão Débito': '💳' };
function lancarNaContaCliente(clienteId, tipo, valor, desc, extra) {
  const c = buscarClientePorId(clienteId);
  if (!c) return null;
  const formasPagas = (extra && extra.formasPagas) || [];
  c.lancamentos = c.lancamentos || [];
  c.lancSeq = (c.lancSeq || 0) + 1;
  const id = c.lancSeq;
  c.lancamentos.push({ id, data: new Date().toISOString(), tipo, valor, desc, formasPagas });
  salvarClientes();
  const novoSaldo = saldoCliente(c);
  const primeiroNome = (c.nome || '').split(' ')[0];
  const linhasFormas = formasPagas.map(f => `${EMOJI_FORMA[f.nome] || '💰'} ${f.nome}: ${fmt(f.valor)}`).join('\n');

  let msg;
  if (tipo === 'compra') {
    const itensTexto = (extra && extra.itensTexto) || desc || '';
    const valorTotal = (extra && extra.valorTotal != null) ? extra.valorTotal : valor;
    msg = `🌴 *${NOME_LOJA}*
🧾 *Nota de Compra*

Olá, *${primeiroNome}*! 😊

Sua compra foi registrada com sucesso!

${itensTexto ? `🛒 *Itens:* ${itensTexto}\n` : ''}💰 *Valor total:* ${fmt(valorTotal)}

*Formas de pagamento:*
${linhasFormas ? linhasFormas + '\n' : ''}📒 Crediário: ${fmt(valor)}

📒 *Saldo devedor atualizado:* ${fmt(novoSaldo)}

Obrigado pela preferência! 🙏`;
  } else {
    msg = `🌴 *${NOME_LOJA}*
🧾 *Recibo de Pagamento*

Olá, *${primeiroNome}*! 😊

Pagamento recebido com sucesso! ✅

💰 *Valor total pago:* ${fmt(valor)}

*Formas de pagamento:*
${linhasFormas}

📒 Seu saldo pendente agora é de *${fmt(novoSaldo)}*.

Agradecemos a confiança! 🙏`;
  }
  enviarWhatsApp(c.telefone, msg);
  return { cliente: c, lancamentoId: id, novoSaldo };
}
/* Remove um lançamento específico pelo "id" (não pelo índice — pode ter mudado de posição) */
function removerLancamentoPorId(clienteId, lancamentoId) {
  const c = buscarClientePorId(clienteId);
  if (!c) return false;
  const i = (c.lancamentos || []).findIndex(l => l.id === lancamentoId);
  if (i < 0) return false;
  c.lancamentos.splice(i, 1);
  salvarClientes();
  return true;
}

/* Envia o aviso pro cliente via WhatsApp (backend whatsapp-web.js) — nunca bloqueia o lançamento local */
async function enviarWhatsApp(telefone, mensagem) {
  const tel = telWhatsapp(telefone);
  if (!tel) { toast('⚠ Cliente sem telefone — aviso não enviado'); return; }
  try {
    const r = await fetch('/api/whatsapp/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefone: tel, mensagem }),
    });
    const j = await r.json();
    if (j.ok) toast('✅ Aviso enviado no WhatsApp');
    else toast(`⚠ WhatsApp: ${j.erro || 'falha ao enviar'}`);
  } catch {
    toast('⚠ Não foi possível falar com o servidor de WhatsApp');
  }
}
let whatsappPollTimer = null;
function pararPollWhatsapp() {
  if (whatsappPollTimer) { clearInterval(whatsappPollTimer); whatsappPollTimer = null; }
}
// aplica o status a um painel (Clientes E/OU tela inicial — o que existir na tela)
function aplicarStatusWpp(statusId, qrId, imgId, j) {
  const el = $(statusId), qrBox = $(qrId);
  if (!el) return;
  if (j === 'erro') {
    el.textContent = '⚠️ Não foi possível checar o status do WhatsApp';
    el.classList.remove('conectado'); el.classList.add('desconectado');
    if (qrBox) qrBox.style.display = 'none';
    return;
  }
  el.classList.toggle('conectado', !!j.pronto);
  el.classList.toggle('desconectado', !j.pronto);
  if (j.pronto) {
    el.textContent = '✅ WhatsApp conectado';
    if (qrBox) qrBox.style.display = 'none';
  } else if (j.temQr) {
    el.textContent = '📷 Escaneie o QR Code abaixo no WhatsApp do celular da loja';
    if (qrBox) { qrBox.style.display = ''; const img = $(imgId); if (img) img.src = '/api/whatsapp/qr?t=' + Date.now(); }
  } else {
    el.textContent = '⏳ Iniciando conexão com o WhatsApp...';
    if (qrBox) qrBox.style.display = 'none';
  }
}
async function atualizarStatusWhatsapp() {
  const btn = $('btn-conectar-wpp');
  try {
    const j = await (await fetch('/api/whatsapp/status')).json();
    aplicarStatusWpp('cl-whats-status', 'cl-whats-qr', 'cl-whats-qr-img', j);
    aplicarStatusWpp('home-whats-status', 'home-whats-qr', 'home-whats-qr-img', j);
    // botão "Conectar" aparece sempre que NÃO estiver conectado (pra forçar um QR novo se o atual não pegar)
    if (btn && !btn.disabled) { btn.style.display = j.pronto ? 'none' : ''; btn.textContent = j.temQr ? '🔄 Gerar novo QR' : '🔌 Conectar WhatsApp'; }
    if (j.pronto) pararPollWhatsapp();
  } catch {
    aplicarStatusWpp('cl-whats-status', 'cl-whats-qr', 'cl-whats-qr-img', 'erro');
    aplicarStatusWpp('home-whats-status', 'home-whats-qr', 'home-whats-qr-img', 'erro');
    if (btn && !btn.disabled) btn.style.display = '';
  }
  if (!whatsappPollTimer) whatsappPollTimer = setInterval(atualizarStatusWhatsapp, 4000);
}
$('btn-conectar-wpp').addEventListener('click', async () => {
  const btn = $('btn-conectar-wpp');
  btn.disabled = true;
  btn.textContent = '⏳ Conectando...';
  try {
    await fetch('/api/whatsapp/conectar', { method: 'POST' });
    atualizarStatusWhatsapp(); // garante o poll rodando pro QR aparecer
  } catch {
    alert('Não foi possível iniciar a conexão (servidor offline?).');
  }
  // reabilita depois de alguns segundos (dá tempo do QR/conexão aparecer)
  setTimeout(() => { btn.disabled = false; btn.textContent = '🔌 Conectar WhatsApp'; atualizarStatusWhatsapp(); }, 6000);
});

function esconderDetalheCliente() {
  clienteDetalheAtual = null;
  $('cl-vazio').style.display = '';
  $('cl-conteudo').style.display = 'none';
}
function mostrarDetalheCliente(id) {
  const c = buscarClientePorId(id);
  if (!c) return;
  clienteDetalheAtual = id;
  $('cl-vazio').style.display = 'none';
  $('cl-conteudo').style.display = '';
  $('cl-d-nome').textContent = c.nome;
  $('cl-d-telefone').textContent = c.telefone || '—';
  $('cl-tag-bairro').textContent = c.bairro ? `📍 ${c.bairro}` : '';
  $('cl-tag-bairro').style.display = c.bairro ? '' : 'none';
  $('cl-d-endereco').textContent = c.endereco || '—';
  $('cl-d-obsmini').textContent = c.obs || '—';
  const saldo = saldoCliente(c);
  $('cl-saldo-num').textContent = fmt(saldo);
  $('cl-saldo-num').classList.toggle('devendo', saldo > 0);
  limparFormasPagamentoCliente();
  renderExtratoCliente(c);
}
function renderExtratoCliente(c) {
  const el = $('cl-extrato');
  const asc = (c.lancamentos || []).map((l, i) => ({ ...l, i })).sort((a, b) => new Date(a.data) - new Date(b.data));
  if (asc.length === 0) { el.innerHTML = '<div class="cl-extrato-vazio">Nenhum lançamento ainda</div>'; return; }
  let corrido = 0;
  const comSaldo = asc.map(l => { corrido += (l.tipo === 'compra' ? l.valor : -l.valor); return { ...l, saldoApos: corrido }; });
  el.innerHTML = comSaldo.slice().reverse().map(l => `
    <div class="cl-lanc-linha ${l.tipo}" tabindex="0" data-i="${l.i}" title="Delete para remover este lançamento">
      <span class="cll-data">${new Date(l.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${new Date(l.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="cll-tipo">${l.tipo === 'compra' ? '🛒 Compra fiado' : '💰 Pagamento' + ((l.formasPagas && l.formasPagas.length) ? ` (${l.formasPagas.map(f => f.nome).join(' + ')})` : '')}${l.desc ? ' · ' + l.desc : ''}</span>
      <span class="cll-valor">${l.tipo === 'compra' ? '+' : '−'}${fmt(l.valor)}</span>
      <span class="cll-saldo">${fmt(l.saldoApos)}</span>
    </div>`).join('');
}
ativarNavLista($('cl-extrato'), '.cl-lanc-linha', {
  onDelete: linha => {
    const c = buscarClientePorId(clienteDetalheAtual);
    if (!c) return;
    if (!confirm('Remover este lançamento do extrato?')) return;
    c.lancamentos.splice(+linha.dataset.i, 1);
    salvarClientes();
    mostrarDetalheCliente(c.id);
  },
});

/* Pagamento do cliente pode ser dividido em mais de uma forma (ex.: parte PIX + parte Cartão) */
const CAMPOS_PGTO_CLIENTE = [
  { id: 'cl-pgto-pix',      nome: 'PIX' },
  { id: 'cl-pgto-dinheiro', nome: 'Dinheiro' },
  { id: 'cl-pgto-credito',  nome: 'Cartão Crédito' },
  { id: 'cl-pgto-debito',   nome: 'Cartão Débito' },
];
function totalPagamentoCliente() {
  return CAMPOS_PGTO_CLIENTE.reduce((s, c) => s + (+$(c.id).value || 0), 0);
}
function recalcularTotalPagamentoCliente() {
  const total = totalPagamentoCliente();
  $('cl-pgto-total').textContent = fmt(total);
  $('btn-cl-pagamento').disabled = total <= 0;
}
CAMPOS_PGTO_CLIENTE.forEach(c => $(c.id).addEventListener('input', recalcularTotalPagamentoCliente));

function limparFormasPagamentoCliente() {
  CAMPOS_PGTO_CLIENTE.forEach(c => $(c.id).value = '');
  $('cl-lanc-desc').value = '';
  recalcularTotalPagamentoCliente();
}

function registrarLancamento() {
  if (!clienteDetalheAtual) { toast('⚠ Selecione um cliente primeiro'); return; }
  const valor = totalPagamentoCliente();
  if (valor <= 0) { toast('⚠ Informe o valor em ao menos uma forma de pagamento'); return; }
  const desc = $('cl-lanc-desc').value.trim();
  const formasPagas = CAMPOS_PGTO_CLIENTE
    .map(c => ({ nome: c.nome, valor: +$(c.id).value || 0 }))
    .filter(f => f.valor > 0);
  const r = lancarNaContaCliente(clienteDetalheAtual, 'pagamento', valor, desc, { formasPagas });
  if (!r) return;
  limparFormasPagamentoCliente();
  mostrarDetalheCliente(r.cliente.id);
  $('cl-pgto-pix').focus();
}
$('btn-cl-pagamento').addEventListener('click', registrarLancamento);
/* Enter percorre PIX→Dinheiro→Crédito→Débito; no último (ou se já não há próximo) confirma se possível */
CAMPOS_PGTO_CLIENTE.forEach((c, i) => $(c.id).addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const prox = CAMPOS_PGTO_CLIENTE[i + 1];
  if (prox) { $(prox.id).focus(); $(prox.id).select(); }
  else if (!$('btn-cl-pagamento').disabled) registrarLancamento();
}));

function limparFormCliente() {
  ['cl-nome', 'cl-telefone', 'cl-bairro', 'cl-endereco', 'cl-obs'].forEach(id => $(id).value = '');
  esconderDetalheCliente();
  $('cl-nome').focus();
}
$('btn-cliente-limpar').addEventListener('click', limparFormCliente);

function editarClienteForm(id) {
  const c = buscarClientePorId(id);
  if (!c) return;
  $('cl-nome').value = c.nome;
  $('cl-telefone').value = c.telefone || '';
  $('cl-bairro').value = c.bairro || '';
  $('cl-endereco').value = c.endereco || '';
  $('cl-obs').value = c.obs || '';
  mostrarDetalheCliente(c.id);
  $('cl-nome').focus();
}

function excluirCliente(id) {
  const c = buscarClientePorId(id);
  if (!c) return;
  if (!confirm(`Excluir definitivamente "${c.nome}"?\nTodo o extrato e saldo serão perdidos. Essa ação não pode ser desfeita.`)) return;
  CLIENTES.splice(CLIENTES.indexOf(c), 1);
  salvarClientes();
  limparFormCliente();
  toast(`🗑 ${c.nome} excluído`);
}
$('btn-cliente-excluir').addEventListener('click', () => clienteDetalheAtual && excluirCliente(clienteDetalheAtual));
$('cl-d-excluir').addEventListener('click', () => clienteDetalheAtual && excluirCliente(clienteDetalheAtual));

$('form-cliente').addEventListener('submit', e => {
  e.preventDefault();
  const nome = $('cl-nome').value.trim();
  const telefone = $('cl-telefone').value.trim();
  if (!nome || !telefone) return;
  const dados = {
    nome, telefone,
    bairro: $('cl-bairro').value.trim(),
    endereco: $('cl-endereco').value.trim(),
    obs: $('cl-obs').value.trim(),
  };
  let c = clienteDetalheAtual ? buscarClientePorId(clienteDetalheAtual) : null;
  if (!c) c = CLIENTES.find(x => x.nome.toLowerCase() === nome.toLowerCase());
  if (c) { Object.assign(c, dados); toast(`✅ ${nome} atualizado`); }
  else { c = { id: ++seqCliente, ...dados, criadoEm: new Date().toISOString(), lancamentos: [] }; CLIENTES.push(c); toast(`✅ ${nome} cadastrado`); }
  salvarClientes();
  mostrarDetalheCliente(c.id);
});
ativarEnterProximo($('form-cliente'));

/* Duplo-espaço (campo Nome vazio) abre a busca de cliente já cadastrado */
let ultimoEspacoCliente = 0;
$('cl-nome').addEventListener('keydown', e => {
  if (e.key !== ' ' || $('cl-nome').value.trim() !== '') return;
  e.preventDefault();
  const agora = Date.now();
  if (agora - ultimoEspacoCliente < 450) { ultimoEspacoCliente = 0; abrirBuscaProduto('clientes'); }
  else ultimoEspacoCliente = agora;
});

/* ── Init ────────────────────────────────────────────────── */
carregarEstoque();
carregarClientes();
carregarPedidos().then(renderDelivery);
renderCupom();

const logado = sessionStorage.getItem('acai_logado');
if (logado) fazerLogin(logado);
else setTimeout(() => $('login-user').focus(), 60);
