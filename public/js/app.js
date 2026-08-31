/* ═══════════════════════════════════════════════════════════
   PROGRAMA AÇAÍ — App
   ═══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const fmt = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });  // ponto de milhar: 1.200,00

/* ── Toast ───────────────────────────────────────────────── */
let toastTimer;
function toast(msg, tipo = '') {
  const t = $('toast');
  t.textContent = msg;
  if (!tipo) {   // deduz o tom pelo começo da mensagem (padrão de cores do projeto)
    if (/^\s*(❌|⛔|⚠|🚫)/.test(msg)) tipo = 'erro';
    else if (/^\s*(✅|✔|🎉)/.test(msg)) tipo = 'sucesso';
  }
  t.className = 'toast show' + (tipo ? ' ' + tipo : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ── Relógio ─────────────────────────────────────────────── */
setInterval(() => {
  $('relogio').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}, 1000);

/* ── Navegação entre telas ───────────────────────────────── */
const SECOES = { home: 'Início', pdv: 'Vendas (PDV)', delivery: 'Delivery', producao: 'Produção', fechamento: 'Fechamento do Período', movimentacoes: 'Movimentações Não Comerciais', impressao: 'Central de Impressão', produtos: 'Produtos / Estoque', cadastro: 'Cadastro Mestre', clientes: 'Clientes', financeiro: 'Financeiro', custos: 'Custos & Rentabilidade', compras: 'Compras', bi: 'BI / Gestão', assistente: 'Assistente IA', atendimento: 'Atendimento', conectividade: 'Conectividade', administracao: 'Administração' };

function irPara(tela) {
  // ao SAIR do Clientes (F2): limpa TUDO (campos + detalhe) pra não deixar a última conta aberta na tela
  if (tela !== 'clientes' && $('tela-clientes') && $('tela-clientes').classList.contains('ativa')) { try { limparFormCliente(); } catch {} }
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  const alvo = $('tela-' + tela);
  if (!alvo) return;
  alvo.classList.add('ativa');
  $('topbar-secao').textContent = SECOES[tela] || '';
  navMarcarAtivo(tela);
  // Etapa 2: MODO OPERAÇÃO tela-cheia — PDV e Produção escondem sidebar/topo (sai por ESC ou botão)
  document.body.classList.toggle('modo-operacao', tela === 'pdv' || tela === 'producao');
  // PDV preenche a TELA TODA (fullscreen, sem barra); as outras telas voltam pra JANELA (com o X/barra de tarefas)
  try {
    if (tela === 'pdv') { if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); }
    else if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(() => {}); }
  } catch {}
  if (tela === 'pdv') { if ($('codigo')) $('codigo').value = ''; focusCodigoMercadoria(); }   // campo de venda sempre limpo
  if (tela === 'delivery') { renderDelivery(); iniciarPollPedidos(); carregarEstadoLoja(); }
  else { pararPollPedidos(); }
  if (tela === 'produtos') { esconderDetalheProduto(); renderProdutos(); atualizarMargemForm(); atualizarEstoqueCards(null); { const dt = $('pf-data-entrada'); if (dt && !dt.value) dt.value = new Date().toISOString().slice(0, 10); } setTimeout(() => $('pf-nota').focus(), 60); }
  if (tela === 'clientes') { esconderDetalheCliente(); setTimeout(() => $('cl-nome').focus(), 60); }
  // Fase 46A §3: Clientes não mexe mais com WhatsApp — a conexão vive em Atendimento/Conectividade.
  if (tela === 'conectividade') atualizarStatusWhatsapp();
  else if (tela !== 'atendimento') pararPollWhatsapp();
  if (tela === 'atendimento') { abrirAtendimento(); }
  else { pararPollAtendimento(); }
  if (tela === 'conectividade') { carregarDestinatariosCopia(); carregarIaAuto(); carregarEstadoLoja(); carregarAvisos(); try { renderNumsFechamento(); } catch {} }
  if (tela === 'administracao') { renderAdministracao(); }
  if (tela === 'financeiro') { abrirFinanceiro(); }
  if (tela === 'custos') { abrirCustos(); }
  if (tela === 'compras') { abrirCompras(); }
  if (tela === 'producao') { abrirProducao(); } else { pararPollProducao(); }
  if (tela === 'impressao') { renderCentralImpressao(); }
  if (tela === 'assistente') { renderAssistente(); }
  if (tela === 'fechamento') { renderFechamento(); }
  if (tela === 'movimentacoes') { renderMovimentacoes(); }
  if (tela === 'bi') { abrirBI(); }
  if (tela === 'home') { carregarDashboard(); iniciarPollDashboard(); }  // Fase 17: dashboard
  else pararPollDashboard();
  if (tela === 'pdv' && typeof carregarAnotacoes === 'function') carregarAnotacoes();  // atualiza a caixa de anotações
  observarFit();   // encaixa a tela na altura visível (auto-encolhe se precisar) — pedido do Melque
}

/* ── FIT-TO-VIEWPORT ──────────────────────────────────────────────────────────
   Cada tela cabe na altura visível SEM rolar: se o conteúdo passa da área, encolhe
   só o necessário (zoom Chrome/Electron + compensação de altura pra seguir preenchendo).
   Nunca aumenta; tem PISO (FIT_MIN) pra não ficar minúsculo — se ainda não couber,
   deixa rolar o excedente. Reajusta ao trocar de tela, no resize e quando o conteúdo muda. */
const FIT_MIN = 0.6;
function ajustarFitTela() {
  const tela = document.querySelector('.tela.ativa');
  if (!tela) return;
  tela.style.zoom = ''; tela.style.height = '';           // reset pra medir o natural
  const disp = tela.clientHeight, cont = tela.scrollHeight;
  if (!disp || cont <= disp + 1) return;                  // já cabe → nada a fazer
  const f = disp / cont;
  if (f >= 0.999) return;
  if (f < FIT_MIN) return;                                // alto demais até pro piso → deixa ROLAR normal (não trava o acesso)
  tela.style.zoom = f;
  tela.style.height = (100 / f) + '%';                    // compensa a altura → tela segue preenchendo a área
}
let _fitPend, _fitObs;
function agendarFit() { clearTimeout(_fitPend); _fitPend = setTimeout(ajustarFitTela, 60); }
function observarFit() {
  const tela = document.querySelector('.tela.ativa');
  if (!_fitObs) _fitObs = new MutationObserver(agendarFit);
  _fitObs.disconnect();
  if (tela) _fitObs.observe(tela, { childList: true, subtree: true, attributes: false }); // reajusta quando o conteúdo muda (listas async, etc.)
  agendarFit();
}
window.addEventListener('resize', agendarFit);
window.ajustarFitTela = ajustarFitTela;   // disponível pra chamadas pontuais

/* ── FIT dos MODAIS (F8, rendimento) — cabem inteiros na tela, sem rolar (auto-encolhe) ── */
let _fitModalEl = null, _fitModalObs = null, _fitModalT;
function ajustarFitModal(el) {
  if (!el || !el.isConnected) return;
  el.style.zoom = '';                                     // mede natural
  const disp = window.innerHeight - 20;                   // margem de respiro
  const cont = el.scrollHeight;
  if (!disp || cont <= disp) return;                      // já cabe
  const f = disp / cont;
  el.style.zoom = Math.max(0.5, f);                       // encolhe só o necessário (piso 0.5)
}
function observarFitModal(el) {
  _fitModalEl = el || null;
  const run = () => ajustarFitModal(_fitModalEl);
  if (_fitModalObs) _fitModalObs.disconnect();
  if (!el) return;
  run(); setTimeout(run, 90); setTimeout(run, 260);       // no arranque e após render assíncrono
  _fitModalObs = new MutationObserver(() => { clearTimeout(_fitModalT); _fitModalT = setTimeout(run, 60); });
  _fitModalObs.observe(el, { childList: true, subtree: true, characterData: true });
}
window.addEventListener('resize', () => { if (_fitModalEl && _fitModalEl.isConnected) ajustarFitModal(_fitModalEl); });
window.ajustarFitModal = ajustarFitModal;

// A navegação é a BARRA SUPERIOR (gerada por montarTopo) — a home não repete os atalhos.
$('btn-home-logo').addEventListener('click', () => irPara('home'));
// Fase 17: botão "Atualizar" do dashboard
{ const b = $('btn-dash-refresh'); if (b) b.addEventListener('click', carregarDashboard); }

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
  if ($('overlay-erp') && $('overlay-erp').classList.contains('aberto')) { e.preventDefault(); fecharErpModal(); return; }
  if (!$('tela-home').classList.contains('ativa'))           { e.preventDefault(); irPara('home'); }
});

/* ═══════════════════════════════════════════════════════════
   NAVEGAÇÃO FINAL (aprovada) — BARRA SUPERIOR + LATERAL CONTEXTUAL
   Topo fixo e compacto com os MÓDULOS a 1 clique (NAV_TOPO) + menu "⋯"
   para o restante (NAV_MAIS), tudo filtrado por permissão. A lateral de
   cada módulo é a já existente (fin/cx/cu/cm-menu) — contextual, mostra
   SÓ as funções do módulo ativo, e agora é recolhível (só ícones).
   Telas operacionais (PDV/Produção) continuam em TELA CHEIA (Etapa 2).
   perm: 'todos' | 'gestor' (admin/supervisor) | 'admin'.
   ═══════════════════════════════════════════════════════════ */
function navPodeVer(perm) {
  const p = (usuarioAtual || {}).perfil; if (!p) return false;
  if (perm === 'admin') return p === 'admin';
  if (perm === 'gestor') return p === 'admin' || p === 'supervisor';
  return true; // 'todos'
}
// Aplica o SUB (aba/submenu do módulo) antes/depois de trocar de tela (deep-link).
const NAV_PRE_SUB = {
  financeiro: v => { finSecao = v; }, compras: v => { cxSub = v; }, custos: v => { cuSub = v; }, bi: v => { biAbaAtual = v; },
};
/* Atalhos principais do topo — 1 clique (na ordem pedida). `telas` = quais telas
   marcam este atalho como ativo; `resolve` decide a rota na hora (por perfil). */
const NAV_TOPO = [
  { id: 'dash', titulo: 'Dashboard', icone: '📊', rota: 'home', perm: 'todos', telas: ['home'], kw: 'inicio dashboard resumo' },
  { id: 'vendas', titulo: 'Vendas', icone: '🛒', rota: 'pdv', perm: 'todos', telas: ['pdv'], kw: 'venda pdv caixa' },
  { id: 'produtos', titulo: 'Produtos', icone: '📦', rota: 'produtos', perm: 'todos', telas: ['produtos'], kw: 'produto estoque entrada mercadoria' },
  { id: 'clientes', titulo: 'Clientes', icone: '👥', rota: 'clientes', perm: 'todos', telas: ['clientes'], kw: 'cliente fiado crm' },
  { id: 'producao', titulo: 'Produção', icone: '🏭', rota: 'producao', perm: 'todos', telas: ['producao'], kw: 'producao preparo' },
  { id: 'delivery', titulo: 'Delivery', icone: '🛵', rota: 'delivery', perm: 'todos', telas: ['delivery'], atalho: 'D', kw: 'delivery entrega expedicao' },
  { id: 'atend', titulo: 'Atendimento', icone: '💬', rota: 'atendimento', perm: 'todos', telas: ['atendimento'], atalho: 'A', badgeId: 'top-badge-atendimento', kw: 'atendimento whatsapp' },
  { id: 'fin', titulo: 'Financeiro', icone: '💵', perm: 'todos', telas: ['financeiro'], atalho: 'F', kw: 'financeiro contas pagar receber caixa',
    resolve: () => ({ rota: 'financeiro', sub: navPodeVer('gestor') ? 'caixa' : 'fechamento' }) },
  { id: 'relat', titulo: 'Relatórios', icone: '📈', rota: 'bi', sub: 'geral', perm: 'gestor', telas: ['bi'], atalho: 'R', kw: 'relatorio bi gestao' },
];
/* Menu "⋯" — o restante, sem poluir a barra (fecha ao selecionar/ESC/clicar fora). */
const NAV_MAIS = [
  { titulo: 'Mov. Não Comerciais', icone: '📉', rota: 'movimentacoes', perm: 'todos', kw: 'consumo perda quebra' },
  { titulo: 'Central de Impressão', icone: '🖨️', rota: 'impressao', perm: 'todos', kw: 'impressao' },
  { titulo: 'Assistente IA', icone: '🤖', rota: 'assistente', perm: 'gestor', kw: 'ia assistente' },
  { titulo: 'Conectividade', icone: '🔌', rota: 'conectividade', perm: 'gestor', kw: 'whatsapp conexao numeros' },
  { titulo: 'Configuração do Programa', icone: '⚙️', rota: 'administracao', sub: 'usuarios', perm: 'admin', kw: 'configuracao usuarios funcionarios backup logs loja atualizacao' },
];
function irParaItem(item) {
  if (!item) return;
  const alvo = item.resolve ? item.resolve() : item;
  const rota = alvo.rota, sub = alvo.sub != null ? alvo.sub : item.sub;
  if (!rota) return;
  if (sub && NAV_PRE_SUB[rota]) NAV_PRE_SUB[rota](sub);
  irPara(rota);
  if (sub && !NAV_PRE_SUB[rota]) {
    const post = { clientes: trocarAbaCliente, administracao: abrirAbaAdm, delivery: trocarDelTab };
    if (post[rota]) setTimeout(() => { try { post[rota](sub); } catch {} }, 0);
  }
  navFecharMais();
}
// Monta a barra superior (atalhos por permissão + "⋯").
function montarTopo() {
  const nav = $('topo-nav'); if (!nav) return;
  const badgeAntigo = $('top-badge-atendimento');
  const badgeEstado = badgeAntigo ? { txt: badgeAntigo.textContent, disp: badgeAntigo.style.display } : null;
  const rotulo = it => it.atalho ? `<span class="atalho">${it.titulo[0]}</span>${it.titulo.slice(1)}` : it.titulo;
  const itens = NAV_TOPO.filter(it => navPodeVer(it.perm));
  const temMais = NAV_MAIS.some(it => navPodeVer(it.perm));
  nav.innerHTML = itens.map(it =>
    `<button class="tp-btn" data-tp="${it.id}" title="${it.titulo}"><span class="tp-ic">${it.icone}</span><span class="tp-txt">${rotulo(it)}</span>${it.badgeId ? `<span class="sb-badge" id="${it.badgeId}" style="display:none">0</span>` : ''}</button>`
  ).join('') + (temMais ? `<div class="tp-mais-wrap"><button class="tp-btn tp-mais" id="tp-mais" title="Mais módulos" aria-haspopup="true" aria-expanded="false">⋯</button><div class="tp-menu" id="tp-menu" role="menu"></div></div>` : '');
  nav.querySelectorAll('[data-tp]').forEach(b => b.addEventListener('click', () => { const it = NAV_TOPO.find(x => x.id === b.dataset.tp); if (it) irParaItem(it); }));
  const mais = $('tp-mais');
  if (mais) mais.addEventListener('click', e => { e.stopPropagation(); navToggleMais(); });
  if (badgeEstado) { const nb = $('top-badge-atendimento'); if (nb) { nb.textContent = badgeEstado.txt; nb.style.display = badgeEstado.disp; } }
  navMarcarAtivo(telaAtual());
}
function telaAtual() { const t = document.querySelector('.tela.ativa'); return t ? t.id.replace('tela-', '') : null; }
// Marca o módulo ativo na barra (item destacado = localização).
function navMarcarAtivo(tela) {
  const nav = $('topo-nav'); if (!nav || !tela) return;
  nav.querySelectorAll('[data-tp]').forEach(b => {
    const it = NAV_TOPO.find(x => x.id === b.dataset.tp);
    b.classList.toggle('on', !!(it && (it.telas || []).includes(tela)));
  });
  const mais = $('tp-mais');
  if (mais) mais.classList.toggle('on', NAV_MAIS.some(it => it.rota === tela && navPodeVer(it.perm)) && !NAV_TOPO.some(it => (it.telas || []).includes(tela)));
}
// Dropdown "⋯": abre/fecha; fecha ao selecionar, clicar fora e no ESC (nunca fica sobre a tela).
function navToggleMais() {
  const menu = $('tp-menu'), btn = $('tp-mais'); if (!menu || !btn) return;
  const aberto = menu.classList.contains('aberto');
  if (aberto) { navFecharMais(); return; }
  menu.innerHTML = NAV_MAIS.filter(it => navPodeVer(it.perm))
    .map((it, i) => `<button class="tp-menu-item" role="menuitem" data-mi="${i}"><span class="tp-ic">${it.icone}</span>${it.titulo}</button>`).join('');
  const visiveis = NAV_MAIS.filter(it => navPodeVer(it.perm));
  menu.querySelectorAll('[data-mi]').forEach(b => b.addEventListener('click', () => irParaItem(visiveis[+b.dataset.mi])));
  menu.classList.add('aberto'); btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect();
  // reposiciona dentro da área visível; se não couber embaixo, abre PARA CIMA
  const h = menu.offsetHeight || 300;
  menu.style.top = (r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4) + 'px';
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - (menu.offsetWidth || 220) - 8)) + 'px';
  const first = menu.querySelector('.tp-menu-item'); if (first) first.focus();
}
function navFecharMais() { const m = $('tp-menu'); if (m) m.classList.remove('aberto'); const b = $('tp-mais'); if (b) b.setAttribute('aria-expanded', 'false'); }
document.addEventListener('click', e => { if (!e.target.closest('.tp-mais-wrap')) navFecharMais(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('tp-menu') && $('tp-menu').classList.contains('aberto')) { e.stopPropagation(); navFecharMais(); } }, true);

/* ── LATERAIS CONTEXTUAIS DOS MÓDULOS (fin/cx/cu/cm-menu já existentes) ──
   Recolhíveis: expandida = ícone + nome · recolhida = só ícones (lembrado).
   Nenhum item foi alterado — só a apresentação. ── */
function prepararMenusLaterais() {
  document.querySelectorAll('.fin-menu').forEach(menu => {
    if (menu.dataset.prep) return;
    menu.dataset.prep = '1';
    // separa "emoji + nome" de cada item em spans (pra recolher mostrando só o ícone)
    menu.querySelectorAll('button').forEach(b => {
      if (b.querySelector('.mi-ico') || b.classList.contains('fin-avancado-btn')) return;   // Avançado tem seta própria — não reescreve
      const t = (b.textContent || '').trim();
      const m = t.match(/^(\S+)\s+(.*)$/);
      if (m) { b.innerHTML = `<span class="mi-ico">${m[1]}</span><span class="mi-txt">${m[2]}</span>`; b.title = m[2]; }
    });
    // botão de recolher no topo da lateral
    const tg = document.createElement('button');
    tg.className = 'fin-menu-toggle'; tg.title = 'Recolher/expandir o menu do módulo'; tg.textContent = '⇤';
    tg.addEventListener('click', () => {
      const compacta = menu.classList.toggle('compacta');
      tg.textContent = compacta ? '⇥' : '⇤';
      try { localStorage.setItem('acai_lateral_compacta', compacta ? '1' : '0'); } catch {}
    });
    menu.prepend(tg);
    // estado lembrado (notebook inicia recolhida por padrão)
    let ini = null; try { ini = localStorage.getItem('acai_lateral_compacta'); } catch {}
    const compactar = ini != null ? ini === '1' : (window.innerWidth <= 1440);
    if (compactar) { menu.classList.add('compacta'); tg.textContent = '⇥'; }
  });
}
document.addEventListener('DOMContentLoaded', prepararMenusLaterais);
if (document.readyState !== 'loading') prepararMenusLaterais();

/* ── ACESSIBILIDADE: tamanho da letra (zoom) + alto contraste, lembrados ── */
(function acessibilidade() {
  const ESCALAS = [85, 100, 115, 130, 150, 175, 200];
  const ESCALA_PADRAO = 115;   // fonte um pouco maior por padrão (pedido do Melque) — ajustável no menu de acessibilidade
  let escala = parseInt(localStorage.getItem('acai_escala'), 10) || ESCALA_PADRAO;
  let contraste = localStorage.getItem('acai_contraste') === '1';
  function aplicar() {
    try { document.body.style.zoom = (escala / 100); } catch {}
    document.body.classList.toggle('alto-contraste', contraste);
    const pct = document.getElementById('acessi-pct'); if (pct) pct.textContent = escala + '%';
    const cb = document.getElementById('acessi-contraste'); if (cb) cb.checked = contraste;
    try { agendarFit(); } catch {}   // mudou a fonte → reencaixa a tela na altura
  }
  function mudarEscala(dir) {
    let i = ESCALAS.indexOf(escala); if (i < 0) i = 1;
    i = Math.max(0, Math.min(ESCALAS.length - 1, i + dir));
    escala = ESCALAS[i]; localStorage.setItem('acai_escala', escala); aplicar();
  }
  function wire() {
    const btn = document.getElementById('btn-acessi'), pop = document.getElementById('acessi-pop');
    if (!btn || !pop || btn.dataset.wired) { aplicar(); return; }
    btn.dataset.wired = '1';
    btn.addEventListener('click', e => { e.stopPropagation(); pop.hidden = !pop.hidden; });
    document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) pop.hidden = true; });
    document.getElementById('acessi-menos').addEventListener('click', () => mudarEscala(-1));
    document.getElementById('acessi-mais').addEventListener('click', () => mudarEscala(1));
    document.getElementById('acessi-contraste').addEventListener('change', e => { contraste = e.target.checked; localStorage.setItem('acai_contraste', contraste ? '1' : '0'); aplicar(); });
    document.getElementById('acessi-reset').addEventListener('click', () => { escala = ESCALA_PADRAO; contraste = false; localStorage.setItem('acai_escala', ESCALA_PADRAO); localStorage.setItem('acai_contraste', '0'); aplicar(); pop.hidden = true; });
    aplicar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();

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

/* Fase 9: o catálogo (produtos/estoque/disponibilidade) virou fonte principal no backend.
   O localStorage é cache. Carrega o cache primeiro (instantâneo); depois puxa do servidor.
   Na 1ª migração (backend vazio ou só o espelho antigo, sem atualizado_em) sobe o catálogo
   COMPLETO do cache pro servidor — sem apagar nada. */
async function carregarEstoque() {
  try { const s = JSON.parse(localStorage.getItem('acai_produtos') || 'null'); PRODUTOS = Array.isArray(s) ? s : PRODUTOS_SEED.map(p => ({ ...p })); }
  catch { PRODUTOS = PRODUTOS_SEED.map(p => ({ ...p })); }
  PRODUTOS.forEach(p => { if (p.disponivel === undefined) p.disponivel = true; });
  // insumos/vendas/compras/receitas continuam no localStorage por enquanto (migram na Fase 10)
  try { insumos = JSON.parse(localStorage.getItem('acai_insumos') || '[]'); } catch { insumos = []; }
  try { vendasLog = JSON.parse(localStorage.getItem('acai_vendas') || '[]'); } catch { vendasLog = []; }
  try { comprasLog = JSON.parse(localStorage.getItem('acai_compras') || '[]'); } catch { comprasLog = []; }
  try { receitasRendimento = JSON.parse(localStorage.getItem('acai_receitas_rendimento') || '{}'); } catch { receitasRendimento = {}; }
  try {
    let dados = await (await fetch('/api/produtos', { cache: 'no-store' })).json();
    const parcial = !Array.isArray(dados) || dados.length === 0 || dados.every(p => !p.atualizado_em);
    if (parcial && PRODUTOS.length) {
      const rel = await (await fetch('/api/produtos/importar-localstorage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produtos: PRODUTOS }) })).json();
      console.log('📥 Produtos importados pro servidor:', rel);
      dados = await (await fetch('/api/produtos', { cache: 'no-store' })).json();
    }
    if (Array.isArray(dados) && dados.length) {
      // mapeia de volta pros nomes que o frontend usa (disponivel bool; caixa)
      PRODUTOS = dados.map(p => ({ ...p, disponivel: p.disponivel !== 0, precoVendaCaixa: p.vendacaixa || 0, unidPorCaixa: p.unidCaixa || 0 }));
      salvarCacheProdutos();
    }
  } catch { /* servidor offline: fica com o cache local */ }
}
function salvarCacheProdutos() { try { localStorage.setItem('acai_produtos', JSON.stringify(PRODUTOS)); } catch {} }
function salvarEstoque() {
  // cache local + UPSERT do catálogo inteiro no backend (fonte principal). Não apaga nada.
  salvarCacheProdutos();
  fetch('/api/produtos/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(PRODUTOS) }).catch(() => {});
}
/* Log de movimento de estoque (auditoria) — fire-and-forget. O valor do estoque em si já é
   gravado pelo salvarEstoque (UPSERT); aqui registramos o movimento com o antes/depois. */
function logMov(codigo, tipo, quantidade, estoqueAnterior, estoqueNovo, motivo, referencia) {
  fetch(`/api/produtos/${encodeURIComponent(codigo)}/${tipo}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantidade, estoque_anterior: estoqueAnterior, estoque_novo: estoqueNovo, motivo, referencia }),
  }).catch(() => {});
}
function salvarInsumos()  { localStorage.setItem('acai_insumos', JSON.stringify(insumos)); }
function salvarReceitasRendimento() { localStorage.setItem('acai_receitas_rendimento', JSON.stringify(receitasRendimento)); }
function salvarVendasLog(){ localStorage.setItem('acai_vendas', JSON.stringify(vendasLog)); }
function salvarComprasLog(){ localStorage.setItem('acai_compras', JSON.stringify(comprasLog)); }
/* Fase 10: espelha a compra no backend (fonte principal). O cache local (comprasLog) continua. */
function salvarCompraBackend(c) {
  fetch('/api/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    data: c.hora || new Date().toISOString(), numNota: c.numNota || '', fornecedor: c.fornecedor || '', descricao: c.nome || '',
    total: +c.total || 0, origem: c.codigo === '(rendimento)' ? 'rendimento' : 'produto', forma_pagamento: c.forma_pagamento || '', detalhes: { codigo: c.codigo, qtd: c.qtd },
  }) }).catch(() => {});
}

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
let qtdPendentePdv = 0;   // quantidade digitada antes do "*" (ex.: 5*) pra aplicar ao escolher na busca
// O caixa só trabalha com METADES: quantidade tem que ser múltiplo de 0,5 (0,5 · 1 · 1,5 · 2 · 2,5…).
// Rejeita 1,2 · 0,3 · etc. (evita digitar errado a "parte" de um produto).
function qtdMeioValida(q) { return q > 0 && Math.abs(q * 2 - Math.round(q * 2)) < 1e-9; }
// Registra UM código (com suporte a "qtd*código"). Retorna true se adicionou.
function registrarCodigoPdv(parte) {
  let entrada = (parte || '').trim();
  if (!entrada) return false;
  let qtd = 1;
  // suporta "qtd*código" (ex: 3*A500, 1,5*A500)
  if (entrada.includes('*')) {
    const [q, c] = entrada.split('*');
    const qn = parseFloat((q || '').replace(',', '.'));
    if (qn > 0) {
      if (!qtdMeioValida(qn)) { avisoGrandeQtd((q || '').trim()); bipErro(); falar('Quantidade inválida'); return false; }
      qtd = qn;
    }
    entrada = (c || '').trim();
  }
  const prod = buscarPorCodigo(entrada);
  if (prod) { adicionarProduto(prod, qtd); return true; }
  const prodPacote = buscarPorConjunto(entrada);
  if (prodPacote) { adicionarProduto(prodPacote, qtd, true); return true; }
  avisoGrandeCodigo(entrada); bipErro(); falar('Código errado');
  return false;
}
// Janela de ATENÇÃO grande no meio da tela (fica 3s) — pra o caixa não passar batido.
let avisoGrandeTimer = null;
function avisoGrande(titulo, sub) {
  let ov = document.getElementById('aviso-grande');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'aviso-grande';
    ov.innerHTML = '<div class="avg-card"><div class="avg-ic">⚠️</div><div class="avg-tit" id="avg-tit"></div><div class="avg-sub" id="avg-sub"></div></div>';
    document.body.appendChild(ov);
  }
  const et = ov.querySelector('#avg-tit'); if (et) et.textContent = titulo || 'ATENÇÃO';
  const es = ov.querySelector('#avg-sub'); if (es) es.textContent = sub || '';
  ov.classList.remove('show'); void ov.offsetWidth;   // reinicia a animação a cada aviso
  ov.classList.add('show');
  clearTimeout(avisoGrandeTimer);
  avisoGrandeTimer = setTimeout(() => ov.classList.remove('show'), 3000);
}
// Código digitado não existe / não confere
function avisoGrandeCodigo(codigo) {
  avisoGrande('CÓDIGO NÃO CONFERE', codigo ? '“' + codigo + '” não está cadastrado' : '');
}
// Quantidade fora do meio-a-meio (0,5 · 1 · 1,5…)
function avisoGrandeQtd(valor) {
  avisoGrande('QUANTIDADE NÃO CONFERE', 'Só de meio em meio: 0,5 · 1 · 1,5 · 2…' + (valor ? ' (não vale ' + valor + ')' : ''));
}
$('codigo').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const entrada = $('codigo').value.trim();
    if (!entrada) return;
    // Etapa 2 (regra 5): "+" adiciona VÁRIOS produtos de uma vez (ex.: 001+025+030,
    // cada parte aceita qtd*código: 2*001+025). Sem "+", comportamento de sempre.
    const partes = entrada.split('+').map(s => s.trim()).filter(Boolean);
    let ok = 0;
    for (const parte of partes) if (registrarCodigoPdv(parte)) ok++;
    if (partes.length > 1 && ok > 0) toast(`🛒 ${ok} produto${ok > 1 ? 's' : ''} adicionado${ok > 1 ? 's' : ''}`);
    $('codigo').value = '';
    focusCodigoMercadoria();   // pronto pro próximo código, sem tirar a mão do teclado
    return;
  }
  // duplo-espaço → busca por nome. Funciona com o campo VAZIO ou com só a QUANTIDADE pendente
  // (ex.: digitar "5*" e dar dois espaços → abre a busca; ao escolher, adiciona 5 unidades).
  const mQtd = $('codigo').value.match(/^\s*(\d+(?:[.,]\d+)?)\s*\*\s*$/);   // "5*" sem código ainda
  if (e.key === ' ' && ($('codigo').value.trim() === '' || mQtd)) {
    e.preventDefault();                      // não digita espaço no código
    const agora = Date.now();
    if (agora - ultimoEspaco < 450) {
      ultimoEspaco = 0;
      qtdPendentePdv = mQtd ? (parseFloat(mQtd[1].replace(',', '.')) || 0) : 0;   // guarda a qtd pra aplicar na escolha
      if (qtdPendentePdv > 0 && !qtdMeioValida(qtdPendentePdv)) { avisoGrandeQtd(mQtd ? mQtd[1] : ''); bipErro(); qtdPendentePdv = 0; return; }
      abrirBuscaProduto();
    } else ultimoEspaco = agora;
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
    focusCodigoMercadoria();
  }
});

/* ══ FOCO CENTRALIZADO — o Código da Mercadoria é o ponto de repouso do teclado ══
   Uma ÚNICA função devolve o foco ao código quando uma operação/modal do PDV termina,
   sem roubar o foco enquanto um modal está aberto (o operador digita lá dentro). */
const PDV_OVERLAYS = ['overlay-recebimento', 'overlay-item', 'overlay-busca', 'overlay-cartao-tipo', 'overlay-pedido', 'overlay-rendimento', 'overlay-clientes-delivery', 'overlay-disponibilidade', 'overlay-supervisor', 'overlay-erp'];
function pdvModalAberto() { return PDV_OVERLAYS.some(id => { const el = $(id); return !!el && el.classList.contains('aberto'); }); }
function focusCodigoMercadoria() {
  const pdv = $('tela-pdv');
  if (!pdv || !pdv.classList.contains('ativa')) return;   // só quando o PDV está na tela
  if (pdvModalAberto()) return;                            // modal aberto → NÃO rouba o foco
  requestAnimationFrame(() => {                            // espera o DOM assentar (fechar modal / re-render)
    if (!$('tela-pdv').classList.contains('ativa') || pdvModalAberto()) return;
    const el = $('codigo'); if (!el) return;
    try { el.focus({ preventScroll: true }); el.select(); } catch {}
  });
}
/* Um único observador: quando QUALQUER modal do PDV fecha (por ESC, botão ou confirmação)
   e não resta nenhum aberto, o foco volta pro código. Centraliza TODOS os fechamentos. */
(function observarModaisPDV() {
  const liga = () => {
    const obs = new MutationObserver(() => { if (!pdvModalAberto()) focusCodigoMercadoria(); });
    PDV_OVERLAYS.forEach(id => { const el = $(id); if (el) obs.observe(el, { attributes: true, attributeFilter: ['class'] }); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liga); else liga();
})();

/* Clicar em área vazia do PDV devolve o foco ao código (operador sem mouse) */
$('tela-pdv').addEventListener('click', e => {
  if (!e.target.closest('input, button, select, a, label, .item-linha')) focusCodigoMercadoria();
});

let modoCancelarItens = false;      // "modo cancelar" (tecla I): ↑↓ escolhe o item · Enter confirma (teclado puro)
let cancelCursor = 0;               // item "sob o cursor"
let cancelConfirmOpen = false, cancelConfirmItem = -1;   // tela de confirmação (Enter cancela · Esc volta)
function renderCupom() {
  const el = $('espelho-itens');
  $('btn-limpar-venda').disabled = itensCupom.length === 0;
  if (itensCupom.length === 0) {
    el.innerHTML = '<div class="espelho-vazio">Nenhum item registrado</div>';
    $('contador').textContent = '0 itens';
    $('espelho-total').textContent = fmt(0);
    if (modoCancelarItens) sairModoCancelarItens();
    return;
  }
  el.innerHTML = itensCupom.map((it, i) => `
    <div class="item-linha${modoCancelarItens ? ' modo-cancelar' : ''}${modoCancelarItens && i === cancelCursor ? ' cancel-cursor' : ''}" tabindex="0" data-idx="${i}" title="${modoCancelarItens ? 'Enter para cancelar este item' : '2× clique ou Enter para alterar'}">
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

$('espelho-itens').addEventListener('click', e => {
  if (!modoCancelarItens) return;                     // clique só age no MODO CANCELAR (mouse é opcional)
  const linha = e.target.closest('.item-linha'); if (!linha) return;
  cancelCursor = +linha.dataset.idx; renderCupom(); abrirConfirmCancelar(cancelCursor);
});
$('espelho-itens').addEventListener('dblclick', e => {
  if (modoCancelarItens) return;                      // no modo cancelar, 2× clique não abre edição
  const linha = e.target.closest('.item-linha');
  if (linha) abrirEditarItem(+linha.dataset.idx);
});
$('espelho-itens').addEventListener('keydown', e => {
  if (modoCancelarItens) return;                      // no modo cancelar o teclado é tratado GLOBAL (independe de foco)
  const linha = e.target.closest('.item-linha');
  if (!linha) return;
  const idx = +linha.dataset.idx;
  if (e.key === 'Enter')          { e.preventDefault(); abrirEditarItem(idx); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (linha.nextElementSibling) linha.nextElementSibling.focus(); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); linha.previousElementSibling ? linha.previousElementSibling.focus() : $('codigo').focus(); }
  else if (e.key === 'Delete')    { e.preventDefault(); itensCupom.splice(idx, 1); renderCupom(); focusCodigoMercadoria(); }
});
/* ── MODO CANCELAR ITENS (tecla I no PDV): ↑↓ move o cursor · Enter abre a CONFIRMAÇÃO · Enter de novo cancela ── */
function entrarModoCancelarItens() {
  if (!itensCupom.length) { toast('🛒 Não há itens no cupom pra cancelar'); focusCodigoMercadoria(); return; }
  modoCancelarItens = true; cancelCursor = 0; fecharConfirmCancelar();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // tira o foco do código
  renderCupom();
  toast('🗑 Cancelar: ↑↓ escolhe o item · Enter confirma · Esc sai');
}
function sairModoCancelarItens() {
  modoCancelarItens = false; fecharConfirmCancelar();
  renderCupom();   // SEMPRE re-renderiza (inclusive p/ mostrar "vazio" quando cancelou o último item)
  focusCodigoMercadoria();
}
function moverCursorCancelar(delta) {
  if (!itensCupom.length) return;
  cancelCursor = Math.max(0, Math.min(itensCupom.length - 1, cancelCursor + delta));
  renderCupom();
  const l = $('espelho-itens').querySelector('.item-linha.cancel-cursor'); if (l && l.scrollIntoView) l.scrollIntoView({ block: 'nearest' });
}
// Tela de confirmação: mostra o item e pede Enter de novo (Esc volta pra lista).
function abrirConfirmCancelar(idx) {
  const it = itensCupom[idx]; if (!it) return;
  cancelConfirmItem = idx; cancelConfirmOpen = true;
  let ov = $('cancel-confirm');
  if (!ov) { ov = document.createElement('div'); ov.id = 'cancel-confirm'; ov.className = 'cancel-confirm'; document.body.appendChild(ov); }
  const q = +it.qtd || 0;
  ov.innerHTML = `<div class="ccf-card">
      <div class="ccf-ic">🗑</div>
      <div class="ccf-tit">CANCELAR ITEM?</div>
      <div class="ccf-item"><b>${crmEsc(it.desc || it.cod)}</b><span class="ccf-sub">${biNum(q)} × ${fmt(it.preco)} = <b>${fmt(q * it.preco)}</b></span></div>
      <div class="ccf-acoes"><button type="button" class="ccf-sim" id="ccf-sim">✔ Enter — Cancelar</button><button type="button" class="ccf-nao" id="ccf-nao">Esc — Voltar</button></div>
    </div>`;
  ov.classList.add('show');
  $('ccf-sim').addEventListener('click', confirmarCancelarItem);
  $('ccf-nao').addEventListener('click', fecharConfirmCancelar);
}
function fecharConfirmCancelar() {
  cancelConfirmOpen = false; cancelConfirmItem = -1;
  const ov = $('cancel-confirm'); if (ov) ov.remove();
}
function confirmarCancelarItem() {
  const it = itensCupom[cancelConfirmItem];
  if (!it) { fecharConfirmCancelar(); return; }
  const nome = it.desc || it.cod;
  itensCupom.splice(cancelConfirmItem, 1);   // cancela o item inteiro
  fecharConfirmCancelar();
  toast(`🗑 Item cancelado: ${nome}`);
  if (!itensCupom.length) { sairModoCancelarItens(); return; }
  cancelCursor = Math.max(0, Math.min(cancelCursor, itensCupom.length - 1));
  renderCupom();
}

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
  focusCodigoMercadoria();   // volta o foco pro código (também coberto pelo observador de modais)
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
  if (q > 0 && !qtdMeioValida(q)) { avisoGrandeQtd($('item-qtd').value); bipErro(); $('item-qtd').focus(); $('item-qtd').select(); return; }
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
  'receber-conta': '💰 Cliente que vai pagar a conta...',
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
  qtdPendentePdv = 0;   // se cancelou a busca, esquece a quantidade pendente (5*)
  if (buscaContexto === 'pdv') focusCodigoMercadoria();
  else if (buscaContexto === 'rendimento' && rendLinhaAtual) rendLinhaAtual.querySelector('.rl-desc').focus();
  else if (buscaContexto === 'materia') $('rend-materia').focus();
  else if (buscaContexto === 'clientes') $('cl-nome').focus();
  else if (buscaContexto === 'recebimento-fiado') $('receb-fiado-cliente').focus();
  else if (buscaContexto === 'movimentacoes') { const e = $('movnc-produto'); if (e) e.focus(); }
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

  if (buscaContexto === 'clientes' || buscaContexto === 'recebimento-fiado' || buscaContexto === 'receber-conta') {
    // busca por nome, telefone OU código (id) — o código também casa sem os zeros à esquerda
    buscaResultados = CLIENTES.filter(c => !termo || c.nome.toLowerCase().includes(termo) || (c.telefone || '').includes(termo) || clienteCodigo(c).toLowerCase().includes(termo) || String(c.id) === termo);
    buscaIndice = 0;
    if (buscaResultados.length === 0) {
      el.innerHTML = '<div class="busca-vazio">Nenhum cliente encontrado</div>';
      return;
    }
    el.innerHTML = buscaResultados.map((c, i) => `
      <div class="busca-item ${i === buscaIndice ? 'sel' : ''}" data-i="${i}">
        <span class="bi-cod">${clienteCodigo(c)}</span>
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
  if (buscaContexto === 'receber-conta') {
    const c = buscaResultados[i];
    if (!c) return;
    fecharBusca();
    abrirReceberContaModal(c.id);
    return;
  }
  if (buscaContexto === 'recebimento-fiado') {
    const c = buscaResultados[i];
    if (!c) return;
    fecharBusca();
    selecionarClienteFiado(c);
    return;
  }
  if (buscaContexto === 'movimentacoes') {
    const p = buscaResultados[i]; if (!p) return;
    fecharBusca();
    movncSelecionarProduto(p.codigo);
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
    adicionarProduto(p, qtdPendentePdv > 0 ? qtdPendentePdv : 1);   // aplica a quantidade pendente (5*) se houver
    qtdPendentePdv = 0;
    if ($('codigo')) $('codigo').value = '';   // limpa o "5*" que tinha ficado no campo
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
let fiadoQuemPegou = null;            // nome de quem pegou na conta (titular ou autorizado) — vai pro espelho e pra conta

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
  fiadoQuemPegou = null;
  $('receb-fiado-cliente').value = '';
  $('receb-fiado-cliente-box').style.display = 'none';
  confirmarDepoisDoCartao = false;
  $('cartao-texto').innerHTML = '<span class="atalho">C</span>artão';
  if ($('receb-depois-nome')) $('receb-depois-nome').value = '';
  if ($('receb-depois-valor')) $('receb-depois-valor').textContent = fmt(totalReceber);
  atualizarResumo();
  $('overlay-recebimento').classList.add('aberto');
  setTimeout(() => $('val-dinheiro').focus(), 100);   // Dinheiro é a 1ª forma agora
}
/* Anotar a venda pra pagar depois: finaliza como "Anotado" (baixa estoque + faturamento,
   mas NÃO entra no caixa) e cria a anotação ligada. Vira caixa quando marcar "✓ pagou". */
async function anotarVendaDepois() {
  if (!(totalReceber > 0) || !itensCupom.length) { toast('⚠ Cupom vazio — nada pra anotar'); return; }
  const nome = ($('receb-depois-nome') ? $('receb-depois-nome').value : '').trim();
  const desc = itensCupom.map(it => `${it.qtd}× ${it.desc}`).join(', ');
  // Pagamento PARCIAL: o que o cliente pagou AGORA (PIX/Dinheiro/Cartão) entra no caixa;
  // o que sobra (restante) fica anotado pra pagar depois. Ex.: paga 15 de 20 → anota 5.
  const pagos = [];
  for (const id of CAMPOS_PGTO_EDITAVEIS) {
    const v = +$(id).value || 0; if (v <= 0) continue;
    const base = CAMPOS_PGTO.find(c => c.id === id).forma;
    pagos.push({ forma: (base === 'Cartão' && cartaoTipo) ? `Cartão ${cartaoTipo}` : base, valor: v });
  }
  const pagoAgora = Math.round(pagos.reduce((s, p) => s + p.valor, 0) * 100) / 100;
  const anotar = Math.round((totalReceber - pagoAgora) * 100) / 100;
  if (anotar <= 0) { toast('⚠ Já está tudo pago — use “Confirmar venda”'); return; }
  const pagamentos = [...pagos, { forma: 'Anotado', valor: anotar }];
  fecharRecebimento();
  await concluirVenda(totalReceber, pagoAgora > 0 ? `Anotado · pagou ${fmt(pagoAgora)}` : 'Anotado', 0, null, pagamentos);
  const vid = (ultimaVenda && ultimaVenda.vendaId) || null;
  await anotarNovo(nome, anotar, desc, vid);
  toast(`📝 Anotado: ${nome || 'cliente'} deve ${fmt(anotar)}${pagoAgora > 0 ? ` · pagou ${fmt(pagoAgora)} agora` : ''}`);
}
{ const b = $('btn-receb-depois'); if (b) b.addEventListener('click', anotarVendaDepois);
  const n = $('receb-depois-nome'); if (n) n.addEventListener('keydown', e => { if (e.key === 'Enter' && ($('rdn-drop') || {}).hidden !== false) { e.preventDefault(); anotarVendaDepois(); } }); }
// Dropdown CLICÁVEL de nomes (quem já teve anotação/fiado) — escolhe com o mouse, sem redigitar
{
  const inp = $('receb-depois-nome'), drop = $('rdn-drop'), btn = $('rdn-drop-btn');
  if (inp && drop) {
    const esconder = () => { drop.hidden = true; };
    const render = (filtro) => {
      const f = (filtro || '').trim().toLowerCase();
      const lista = anotNomesCache.filter(n => !f || n.toLowerCase().includes(f));
      drop.innerHTML = lista.length
        ? lista.map(n => `<button type="button" class="rdn-item">${crmEsc(n)}</button>`).join('')
        : '<div class="rdn-vazio">Ninguém salvo ainda — digite o nome</div>';
      drop.querySelectorAll('.rdn-item').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); inp.value = b.textContent; esconder(); inp.focus(); atualizarSaldoAnotado(); }));
    };
    const mostrar = () => { render(inp.value); drop.hidden = false; };
    inp.addEventListener('focus', mostrar);
    inp.addEventListener('input', () => { mostrar(); atualizarSaldoAnotado(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); esconder(); } });
    if (btn) btn.addEventListener('click', () => { if (drop.hidden) { inp.focus(); mostrar(); } else esconder(); });
    document.addEventListener('click', e => { const w = inp.closest('.rdn-wrap'); if (w && !w.contains(e.target)) esconder(); });
  }
}
// Quanto a pessoa (por nome) JÁ deve nas anotações "pagar depois"
function dividaAnotadaDe(nome) {
  const n = (nome || '').trim().toLowerCase(); if (!n) return 0;
  return (anotacoesCache || []).filter(a => (a.nome || '').trim().toLowerCase() === n).reduce((s, a) => s + (+a.valor || 0), 0);
}
// Mostra "já deve X · com esta compra fica devendo (X + novo)" ao digitar o nome no "pagar depois"
function atualizarSaldoAnotado() {
  const el = $('receb-depois-saldo'); if (!el) return;
  const nome = ($('receb-depois-nome') ? $('receb-depois-nome').value : '').trim();
  const novo = +$('val-fiado').value || 0;
  const jaDeve = dividaAnotadaDe(nome);
  if (!nome || (jaDeve <= 0 && novo <= 0)) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = jaDeve > 0
    ? `<span class="rds-nome">👤 ${crmEsc(nome)}</span> já deve <b>${fmt(jaDeve)}</b>${novo > 0 ? ` · com esta fica devendo <b class="rds-total">${fmt(jaDeve + novo)}</b>` : ''}`
    : `<span class="rds-nome">👤 ${crmEsc(nome)}</span> vai ficar devendo <b class="rds-total">${fmt(novo)}</b>`;
}
$('btn-finalizar').addEventListener('click', finalizarVenda);

function fecharRecebimento() {
  $('overlay-recebimento').classList.remove('aberto');
  focusCodigoMercadoria();
}
$('btn-fechar-receb').addEventListener('click', fecharRecebimento);
$('btn-cancelar-receb').addEventListener('click', fecharRecebimento);
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

  // Cartão ALIMENTAÇÃO tem acréscimo de 20% sobre o valor pago nessa forma (sobe o total a cobrar).
  const acrescimo = (cartaoTipo === 'Alimentação') ? Math.round((+$('val-cartao').value || 0) * 0.20 * 100) / 100 : 0;
  $('receb-acrescimo-linha').style.display = acrescimo > 0 ? '' : 'none';
  $('receb-cobrar-linha').style.display = acrescimo > 0 ? '' : 'none';
  if (acrescimo > 0) { $('receb-acrescimo').textContent = '+ ' + fmt(acrescimo); $('receb-cobrar').textContent = fmt(totalReceber + acrescimo); }

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

  // "Anotar pra depois" agora anota só o RESTANTE (total − o que já foi pago em PIX/Dinheiro/Cartão)
  if ($('receb-depois-valor')) $('receb-depois-valor').textContent = fmt(valFiado);
  atualizarSaldoAnotado();   // atualiza "já deve + esta compra = total" conforme o valor muda

  $('btn-confirmar-receb').disabled = !(totalReceber > 0 && fiadoOk);
  renderFiadoInfo();
}

/* Bloco de fiado: mostra saldo atual e saldo final do cliente (só leitura — reusa saldoCliente/CLIENTES). */
function renderFiadoInfo() {
  const box = $('fiado-saldo');
  if (!box) return;
  const valFiado = +$('val-fiado').value || 0;
  if (valFiado <= 0) { box.innerHTML = ''; return; }
  if (!fiadoClienteSelecionado) { box.innerHTML = '<span class="fs-aviso">Escolha o cliente pra lançar o fiado</span>'; return; }
  const c = buscarClientePorId(fiadoClienteSelecionado);
  if (!c) { box.innerHTML = ''; return; }
  const atual = saldoCliente(c);
  const final = atual + valFiado;
  // "Quem pegou?" — titular + autorizados (nomes separados por vírgula no cadastro do cliente)
  const autorizados = (c.autorizados || '').split(',').map(s => s.trim()).filter(Boolean);
  const opcoes = [c.nome, ...autorizados];
  if (!fiadoQuemPegou || !opcoes.includes(fiadoQuemPegou)) fiadoQuemPegou = c.nome;
  const chips = opcoes.map((n, idx) =>
    `<button type="button" class="fq-chip ${n === fiadoQuemPegou ? 'on' : ''}" data-quem="${crmEsc(n)}">${idx === 0 ? '👤 ' : ''}${crmEsc(n)}${idx === 0 ? ' <small>(titular)</small>' : ''}</button>`).join('');
  box.innerHTML =
    `<div class="fs-linha"><span>Saldo atual</span><strong>${fmt(atual)}</strong></div>` +
    `<div class="fs-linha"><span>+ Fiado desta venda</span><strong>${fmt(valFiado)}</strong></div>` +
    `<div class="fs-linha fs-final"><span>Saldo final</span><strong>${fmt(final)}</strong></div>` +
    `<div class="fq-quem"><span class="fq-lbl">Quem pegou?</span><div class="fq-chips">${chips}</div></div>`;
  box.querySelectorAll('.fq-chip').forEach(b => b.addEventListener('click', () => {
    fiadoQuemPegou = b.dataset.quem;
    box.querySelectorAll('.fq-chip').forEach(x => x.classList.toggle('on', x.dataset.quem === fiadoQuemPegou));
  }));
}

CAMPOS_PGTO_EDITAVEIS.forEach(id => $(id).addEventListener('input', atualizarResumo));
/* Tab no Cartão segue pro FIADO (campo do cliente) quando há fiado a lançar —
   sem isso o Tab pulava direto pro Cancelar (o valor do fiado é automático, tabindex -1) */
$('val-cartao').addEventListener('keydown', e => {
  if (e.key !== 'Tab' || e.shiftKey) return;
  if ((+$('val-fiado').value || 0) <= 0) return;      // sem fiado → segue o fluxo normal
  e.preventDefault();
  $('receb-fiado-cliente').focus();
});
// Seleciona o cliente do fiado (reusado pela busca e pelo código+Enter).
function selecionarClienteFiado(c) {
  if (!c) return;
  fiadoClienteSelecionado = c.id;
  fiadoQuemPegou = c.nome;   // padrão: o próprio titular pegou (pode trocar pra um autorizado)
  $('receb-fiado-cliente').value = c.nome;
  atualizarResumo();
}
// Acha cliente pelo CÓDIGO (id 4 dígitos), id cru ou nome exato — pra por o cliente por código.
function resolverClienteFiado(termo) {
  termo = (termo || '').trim(); if (!termo) return null;
  const t = termo.toLowerCase();
  return CLIENTES.find(cl => clienteCodigo(cl).toLowerCase() === t || String(cl.id) === termo || String(cl.id).padStart(4, '0') === termo)
    || CLIENTES.find(cl => (cl.nome || '').toLowerCase() === t) || null;
}
/* Duplo-espaço (campo vazio) abre a busca; código/nome + Enter seleciona o cliente. */
let ultimoEspacoFiado = 0;
/* Cliente do fiado: autocomplete que mostra os clientes conforme digita e deixa escolher
   com o MOUSE ou com as SETAS do teclado (↓↑ navega, Enter escolhe o destacado). O
   duplo-espaço (busca em tela cheia) e o Enter-finaliza continuam funcionando. */
{
  const inp = $('receb-fiado-cliente'), drop = $('rfc-drop');
  if (inp && drop) {
    let itens = [], ativo = -1;
    const esconder = () => { drop.hidden = true; itens = []; ativo = -1; };
    const marcar = (i) => {
      const btns = drop.querySelectorAll('.rfc-item'); if (!btns.length) return;
      ativo = (i + btns.length) % btns.length;
      btns.forEach((b, k) => b.classList.toggle('ativo', k === ativo));
      btns[ativo].scrollIntoView({ block: 'nearest' });
    };
    const render = () => {
      const f = (inp.value || '').trim().toLowerCase();
      if (!f) { esconder(); return; }
      itens = CLIENTES.filter(c => (c.nome || '').toLowerCase().includes(f) || clienteCodigo(c).toLowerCase().includes(f) || String(c.id) === f).slice(0, 8);
      drop.innerHTML = itens.length
        ? itens.map((c, i) => `<button type="button" class="rfc-item${i === 0 ? ' ativo' : ''}" data-id="${c.id}"><span class="rfc-nome">${crmEsc(c.nome || 'sem nome')}</span><span class="rfc-cod">${crmEsc(clienteCodigo(c))}</span></button>`).join('')
        : '<div class="rfc-vazio">Nenhum cliente com esse nome</div>';
      ativo = itens.length ? 0 : -1;   // já deixa o 1º destacado (Enter escolhe ele)
      drop.querySelectorAll('.rfc-item').forEach((b, i) => {
        b.addEventListener('mousedown', ev => { ev.preventDefault(); const c = buscarClientePorId(+b.dataset.id); if (c) selecionarClienteFiado(c); esconder(); });
        b.addEventListener('mousemove', () => marcar(i));
      });
      drop.hidden = false;
    };
    inp.addEventListener('input', render);
    inp.addEventListener('focus', () => { if ((inp.value || '').trim()) render(); });
    document.addEventListener('click', ev => { const w = inp.closest('.rfc-wrap'); if (w && !w.contains(ev.target)) esconder(); });
    inp.addEventListener('keydown', e => {
      const aberto = !drop.hidden && itens.length > 0;
      if (e.key === 'ArrowDown') { if (aberto) { e.preventDefault(); marcar(ativo + 1); } else if ((inp.value || '').trim()) render(); return; }
      if (e.key === 'ArrowUp')   { if (aberto) { e.preventDefault(); marcar(ativo - 1); } return; }
      if (e.key === 'Escape')    { if (!drop.hidden) { e.stopPropagation(); esconder(); } return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (aberto && ativo >= 0 && itens[ativo]) { selecionarClienteFiado(itens[ativo]); esconder(); return; }   // Enter escolhe o destacado
        if (fiadoClienteSelecionado && !$('btn-confirmar-receb').disabled) { confirmarRecebimento(); return; }     // já selecionado → finaliza
        const termo = inp.value.trim();
        if (termo) { const c = resolverClienteFiado(termo) || CLIENTES.find(cl => (cl.nome || '').toLowerCase().includes(termo.toLowerCase())); if (c) selecionarClienteFiado(c); else toast('⚠ Cliente não encontrado'); }
        return;
      }
      if (e.key === ' ' && inp.value.trim() === '') {   // duplo-espaço → busca em tela cheia
        e.preventDefault();
        const agora = Date.now();
        if (agora - ultimoEspacoFiado < 450) { ultimoEspacoFiado = 0; abrirBuscaProduto('recebimento-fiado'); }
        else ultimoEspacoFiado = agora;
      }
    });
  }
}

let confirmarDepoisDoCartao = false;

/* Confirmar recebimento → conclui a venda */
async function confirmarRecebimento() {
  if ($('btn-confirmar-receb').disabled) return;
  // Se há valor no cartão mas o tipo ainda não foi escolhido, pede o tipo primeiro
  const valCartao = +$('val-cartao').value || 0;
  if (valCartao > 0 && !cartaoTipo) {
    confirmarDepoisDoCartao = true;
    abrirCartaoTipo();
    return;
  }
  // acréscimo de 20% quando o cartão é ALIMENTAÇÃO (sobe o total a cobrar; o cartão é debitado base+20%)
  const acrescimo = (cartaoTipo === 'Alimentação') ? Math.round(valCartao * 0.20 * 100) / 100 : 0;
  const partes = [];
  const pagamentosVenda = [];   // estruturado, pro registro da venda no backend (Fase 10)
  let pago = 0;
  CAMPOS_PGTO.forEach(c => {
    const v = +$(c.id).value || 0;
    if (v > 0) {
      const ehCartao = c.forma === 'Cartão' && cartaoTipo;
      const nome = ehCartao ? `Cartão ${cartaoTipo}` : c.forma;
      const cobrado = (ehCartao && cartaoTipo === 'Alimentação') ? Math.round(v * 1.20 * 100) / 100 : v;  // alimentação cobra 20% a mais
      partes.push(`${nome} ${fmt(cobrado)}`);
      pagamentosVenda.push({ forma: nome, valor: cobrado });
      pago += v;   // pago = base (pro cálculo de troco/restante); o acréscimo é cobrança extra, não troco
    }
  });
  const troco = pago - totalReceber;
  const totalCobrado = totalReceber + acrescimo;   // o que a loja de fato recebe (com o acréscimo do alimentação)
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
    // "quem pegou": só registra explicitamente quando NÃO foi o próprio titular
    const c = buscarClientePorId(fiadoClienteSelecionado);
    const outroPegou = fiadoQuemPegou && c && fiadoQuemPegou !== c.nome ? fiadoQuemPegou : '';
    const descLanc = 'Venda no PDV' + (outroPegou ? ` · Retirado por: ${outroPegou}` : '');
    const r = await lancarNaContaCliente(fiadoClienteSelecionado, 'compra', valFiado, descLanc, { itensTexto, valorTotal: totalReceber, formasPagas, referencia: 'venda' });
    if (r) fiadoInfo = { clienteId: r.cliente.id, clienteNome: r.cliente.nome, lancamentoId: r.lancamentoId, valor: valFiado, quemPegou: fiadoQuemPegou };
  }

  await concluirVenda(totalCobrado, partes.join(' + '), troco > 0 ? troco : 0, fiadoInfo, pagamentosVenda);
  fecharRecebimento();
}
$('btn-confirmar-receb').addEventListener('click', confirmarRecebimento);

/* Conclui a venda: registra histórico, baixa estoque, guarda última venda e limpa */
let ultimaVenda = null;
async function concluirVenda(total, descricaoPgto, troco = 0, fiado = null, pagamentos = null) {
  const agora = new Date();
  // captura os itens ANTES de limpar o cupom (usado no registro da venda no backend)
  const itensVenda = itensCupom.map(it => ({ codigo: it.cod, nome: it.desc, qtd: it.qtd, preco: it.preco, subtotal: it.qtd * it.preco, pacote: !!it.pacote, unidConsumo: it.unidConsumo || 1 }));
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
    if (p && typeof p.estoque === 'number') {
      const baixa = it.qtd * (it.unidConsumo || 1);
      // vender sem estoque deixa NEGATIVO (a falta fica visível); a entrada SOMA e normaliza (−3 + 10 = 7).
      p.estoque = Math.round((p.estoque - baixa) * 100) / 100;
    }
  });
  // Só cache local (feedback instantâneo). A baixa no SERVIDOR é feita pelo POST /api/vendas
  // (movimentarEstoqueVenda) — fonte ÚNICA. Não empurramos o estoque aqui (nem logMov nem sync)
  // pra não baixar em DOBRO. Vale offline: o cupom fica na fila e a baixa aplica ao reconectar.
  salvarCacheProdutos();
  ultimaVenda = {
    total, hora: agora, pgto: descricaoPgto || '—', troco: troco || 0,
    itens: itensCupom.map(it => ({ desc: it.desc, qtd: it.qtd, cod: it.cod, pacote: !!it.pacote, unidConsumo: it.unidConsumo || 1 })),
    fiado,
    retiradoPor: (fiado && fiado.quemPegou && fiado.quemPegou !== fiado.clienteNome) ? fiado.quemPegou : '',
    cancelada: false,
  };
  renderUltimaVenda();
  itensCupom = [];
  renderCupom();
  // Fase 10/14: registra a venda no backend (RECORD-ONLY — estoque/fiado já tratados acima).
  // Via fila offline: se o servidor cair, a venda fica salva e é reenviada (sem duplicar).
  const pags = (pagamentos && pagamentos.length) ? pagamentos : [{ forma: 'Automático', valor: total }];
  const v = await postComFila('venda', '/api/vendas', {
    data: agora.toISOString(), total, subtotal: total, troco: troco || 0, status: 'concluida', origem: 'pdv',
    cliente_id: fiado ? fiado.clienteId : null, fiado_lancamento_id: fiado ? fiado.lancamentoId : null,
    retirado_por: fiado && fiado.quemPegou ? fiado.quemPegou : null,   // quem pegou na conta → aparece no espelho
    itens: itensVenda,
    pagamentos: pags.map(p => ({ forma: p.forma, valor: p.valor, cliente_id: (p.forma === 'Fiado' && fiado) ? fiado.clienteId : null })),
  });
  if (ultimaVenda && v && v.id) { ultimaVenda.vendaId = v.id; ultimaVenda.numero = v.numero; }
  focusCodigoMercadoria();   // fim da venda → teclado volta pro código (guarda evita roubar se houver modal aberto)
}
function renderUltimaVenda() {
  const el = $('ultima-venda');
  if (!el) return;
  if (!ultimaVenda) { el.style.display = 'none'; return; }
  el.style.display = '';
  $('uv-total').textContent = fmt(ultimaVenda.total);
  $('uv-pgto').textContent = ultimaVenda.pgto || '—';
  // fiado: mostra QUEM ficou devendo, direto no espelho da última venda
  const fiadoLinha = $('uv-fiado-linha');
  if (fiadoLinha) {
    const f = ultimaVenda.fiado;
    fiadoLinha.style.display = f ? '' : 'none';
    $('uv-fiado-cliente').textContent = f ? (f.clienteNome || '—') : '—';
  }
  const retirouLinha = $('uv-retirou-linha');
  if (retirouLinha) {
    retirouLinha.style.display = ultimaVenda.retiradoPor ? '' : 'none';
    $('uv-retirou-nome').textContent = ultimaVenda.retiradoPor || '—';
  }
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
async function cancelarUltimaVenda() {
  if (!ultimaVenda || ultimaVenda.cancelada) return;
  if (!(await garantirSupervisor('Cancelar venda precisa da autorização do supervisor.'))) return; // operador exige senha (Fase 12)
  const avisoFiado = ultimaVenda.fiado ? `\nA cobrança de ${fmt(ultimaVenda.fiado.valor)} na conta de ${ultimaVenda.fiado.clienteNome} também será removida.` : '';
  if (!confirm(`Cancelar a última venda (${fmt(ultimaVenda.total)})?\nO estoque dos itens será devolvido.${avisoFiado}`)) return;

  (ultimaVenda.itens || []).forEach(it => {
    if (!it.cod) return;
    const p = PRODUTOS.find(x => x.codigo === it.cod);
    if (p && typeof p.estoque === 'number') {
      const dev = it.qtd * (it.unidConsumo || 1);
      p.estoque = Math.round((p.estoque + dev) * 100) / 100;   // devolve (só UI/cache)
    }
  });
  // devolução do estoque no SERVIDOR é feita pelo POST /api/vendas/:id/cancelar (estorno) — fonte única
  salvarCacheProdutos();

  if (ultimaVenda.fiado) {
    const removido = await removerLancamentoPorId(ultimaVenda.fiado.clienteId, ultimaVenda.fiado.lancamentoId);
    if (removido) toast(`↩️ Cobrança de fiado revertida na conta de ${ultimaVenda.fiado.clienteNome}`);
  }

  // Fase 10: marca a venda como CANCELADA no backend (mantém o registro/auditoria — não apaga)
  if (ultimaVenda.vendaId) fetch(`/api/vendas/${ultimaVenda.vendaId}/cancelar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: 'cancelamento no PDV' }) }).catch(() => {});

  // remove o registro correspondente do histórico de vendas (o mais recente) do cache local
  const idxLog = vendasLog.length - 1;
  if (idxLog >= 0) { vendasLog.splice(idxLog, 1); salvarVendasLog(); }

  ultimaVenda.cancelada = true;
  renderUltimaVenda();
  toast(`↩️ Venda cancelada · ${fmt(ultimaVenda.total)} devolvido ao estoque`);
  focusCodigoMercadoria();
}
$('btn-cancelar-venda').addEventListener('click', cancelarUltimaVenda);

/* ── 📝 ANOTAÇÕES (pagar depois) ──────────────────────────────────────────────
   Recebível rápido no PDV: fica até dar baixa; ao pagar vira entrada no financeiro
   (backend). Some do total "a receber" quando pago. */
let anotacoesCache = [], fiadosCache = [];
async function carregarAnotacoes() {
  try { const d = await (await fetch('/api/anotacoes', { cache: 'no-store' })).json();
    anotacoesCache = Array.isArray(d.lista) ? d.lista : [];
    fiadosCache = Array.isArray(d.fiados) ? d.fiados : [];
    preencherNomesAnotacao(d.nomes || []);
    renderAnotacoes(d.totalPendente != null ? d.totalPendente : null); }
  catch { /* offline: mantém o que tem */ }
}
// Nomes já usados (anotações + clientes com fiado) — pra escolher com o mouse, sem redigitar
let anotNomesCache = [];
function preencherNomesAnotacao(nomes) {
  const set = new Set([...(nomes || []), ...fiadosCache.map(f => f.nome)].filter(Boolean));
  anotNomesCache = [...set].sort((a, b) => String(a).localeCompare(String(b)));
}
function renderAnotacoes(total) {
  const box = $('anot-lista'); if (!box) return;
  if (total == null) total = anotacoesCache.reduce((s, a) => s + (+a.valor || 0), 0) + fiadosCache.reduce((s, f) => s + (+f.saldo || 0), 0);
  const badge = $('anot-total-badge'); if (badge) badge.textContent = fmt(total);
  if (!anotacoesCache.length) { box.innerHTML = '<div class="anot-vazio">Nenhuma anotação pra pagar depois 🙌</div>'; return; }
  // fiados em aberto (📒) — pagam na própria caixa, escolhendo a forma
  const htmlFiado = fiadosCache.map(f => `
    <div class="anot-item anot-fiado" data-cli="${f.cliente_id}">
      <span class="anot-hora">🕒 ${f.hora || ''}</span>
      <span class="anot-quem">${crmEsc(f.nome || 'cliente')}</span>
      <span class="anot-desc">— fiado em aberto</span>
      <span class="anot-vlr">${fmt(f.saldo)}</span>
      <button class="anot-ok" data-fiado="${f.cliente_id}" title="Receber o fiado deste cliente">PAGAR</button>
    </div>`).join('');
  const htmlAnot = anotacoesCache.map(a => `
    <div class="anot-item" data-id="${a.id}">
      <span class="anot-hora">🕒 ${a.hora || ''}</span>
      <span class="anot-quem">${crmEsc(a.nome || 'sem nome')}</span>
      <span class="anot-desc">${(a.nCompras > 1) ? `— ${a.nCompras} compras` : (a.descricao ? '— ' + crmEsc(a.descricao) : '')}</span>
      <span class="anot-vlr">${fmt(a.valor)}</span>
      <button class="anot-rel" data-rel="${a.id}" title="Ver o relatório desta pessoa">📄</button>
      <button class="anot-ok" data-pagar="${a.id}" title="Recebeu — dar baixa">PAGAR</button>
      <button class="anot-del" data-del="${a.id}" title="Remover anotação">🗑</button>
    </div>`).join('');
  box.innerHTML = htmlAnot;   // PDV mostra SÓ as anotações rápidas (pagar depois); fiado de cliente NÃO aparece aqui
  box.querySelectorAll('[data-pagar]').forEach(b => b.addEventListener('click', () => pagarAnotacao(+b.dataset.pagar)));
  box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => excluirAnotacao(+b.dataset.del)));
  box.querySelectorAll('[data-fiado]').forEach(b => b.addEventListener('click', () => pagarFiadoCaixa(+b.dataset.fiado)));
  box.querySelectorAll('[data-rel]').forEach(b => b.addEventListener('click', () => verRelatorioAnotacao(+b.dataset.rel)));
}
// Relatório da pessoa na própria anotação: cada compra (hora · itens · valor) + total
function verRelatorioAnotacao(id) {
  const a = anotacoesCache.find(x => x.id === id); if (!a) return;
  const hist = (a.historico && a.historico.length) ? a.historico : [{ data: a.criado_em, descricao: a.descricao, valor: a.valor }];
  const nCompras = hist.filter(h => !(h.pagamento || (+h.valor < 0))).length || 1;
  const linhas = hist.map(h => {
    const dt = h.data ? new Date(h.data) : null;
    const quando = dt ? dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const pag = h.pagamento || (+h.valor < 0);
    return `<div class="arel-linha${pag ? ' arel-pag' : ''}"><span class="arel-quando">${quando}</span><span class="arel-desc">${crmEsc(h.descricao || '—')}</span><span class="arel-vlr">${pag ? '− ' + fmt(Math.abs(+h.valor || 0)) : fmt(h.valor)}</span></div>`;
  }).join('');
  abrirErpModal(`<h3 class="erp-modal-tit">📄 Relatório · ${crmEsc(a.nome || 'sem nome')}</h3>
    <div class="arel-box">
      <div class="arel-cab"><span>${nCompras} compra(s) · em aberto</span><b>${fmt(a.valor)}</b></div>
      <div class="arel-lista">${linhas}</div>
      <div class="arel-acoes">
        <button class="crm-btn" id="arel-pagar">✅ Receber tudo (${fmt(a.valor)})</button>
        <button class="crm-btn arel-fechar" id="arel-fechar">Fechar</button>
      </div>
    </div>`);
  const p = $('arel-pagar'); if (p) p.addEventListener('click', () => { fecharErpModal(); pagarAnotacao(id); });
  const f = $('arel-fechar'); if (f) f.addEventListener('click', fecharErpModal);
}
// Recebe o fiado de um cliente direto na caixa "quem paga depois" (quita o saldo, escolhendo a forma)
function pagarFiadoCaixa(clienteId) {
  const f = fiadosCache.find(x => x.cliente_id === clienteId); if (!f) return;
  receberContaModal(`📒 Receber fiado · ${f.nome || 'cliente'}`, f.saldo, async (valor, forma) => {
    const r = await (await fetch(`/api/clientes/${clienteId}/lancamentos`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'pagamento', valor, formas: [{ nome: forma, valor }], descricao: 'Recebimento de fiado (caixa do PDV)' }) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    const parcial = valor < f.saldo - 0.001;
    toast(parcial ? `✅ ${f.nome || 'Cliente'} pagou ${fmt(valor)} do fiado — falta ${fmt(f.saldo - valor)}` : `✅ ${f.nome || 'Cliente'} quitou o fiado ${fmt(f.saldo)}`);
    await carregarAnotacoes();
    try { if (typeof carregarClientes === 'function') carregarClientes(); } catch {}
  });
}
async function anotarNovo(nome, valor, descricao, vendaId) {
  const r = await (await fetch('/api/anotacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: nome || '', valor: +valor || 0, descricao: descricao || '', venda_id: vendaId || null }) })).json();
  if (r && r.erro) { toast('⚠ ' + r.erro); return null; }
  await carregarAnotacoes();
  return r;
}
function pagarAnotacao(id) {
  const a = anotacoesCache.find(x => x.id === id); if (!a) return;
  receberContaModal(`Receber · ${a.nome || 'cliente'}`, a.valor, async (valor, forma) => {
    const r = await (await fetch(`/api/anotacoes/${id}/pagar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor, forma }) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    const parcial = valor < a.valor - 0.001;
    toast(parcial ? `✅ ${a.nome || 'Cliente'} pagou ${fmt(valor)} — falta ${fmt(a.valor - valor)}` : `✅ ${a.nome || 'Anotação'} quitou ${fmt(a.valor)} — entrou no caixa`);
    await carregarAnotacoes();
    if ($('tela-financeiro') && $('tela-financeiro').classList.contains('ativa') && typeof finCarregarBase === 'function') { try { finCarregarBase(); } catch {} }
  });
}
async function excluirAnotacao(id) {
  const a = anotacoesCache.find(x => x.id === id);
  if (!confirm(`Remover a anotação de ${a ? (a.nome || 'sem nome') : ''} (${a ? fmt(a.valor) : ''})?`)) return;
  await fetch(`/api/anotacoes/${id}`, { method: 'DELETE' }).catch(() => {});
  await carregarAnotacoes();
}
// Modal de recebimento com PARCIAL: mostra o saldo, deixa escolher QUANTO pagar (padrão = tudo)
// e a FORMA. onConfirm(valor, forma). Usado pela anotação e pelo fiado da caixa do PDV.
function receberContaModal(titulo, saldo, onConfirm) {
  const rr = x => Math.round((+x || 0) * 100) / 100;
  saldo = rr(saldo);
  abrirErpModal(`<h3 class="erp-modal-tit">${titulo}</h3>
    <div class="rcm">
      <div class="rcm-saldo">Está devendo <b>${fmt(saldo)}</b></div>
      <label class="rcm-lbl">Quanto vai pagar agora?</label>
      <div class="rcm-valrow">
        <input type="number" id="rcm-valor" class="rcm-input" step="0.01" min="0.01" max="${saldo}" value="${saldo.toFixed(2)}" inputmode="decimal">
        <button type="button" class="rcm-tudo" id="rcm-tudo">Tudo</button>
      </div>
      <div class="rcm-resto" id="rcm-resto"></div>
      <label class="rcm-lbl">Forma <small>(clique pra confirmar · teclas 1/2/3)</small></label>
      <div class="anot-formas">${['Dinheiro', 'PIX', 'Cartão'].map((f, i) => `<button class="anot-forma-btn" data-f="${f}"><span class="num">${i + 1}</span>${f}</button>`).join('')}</div>
    </div>`);
  const inp = $('rcm-valor'), resto = $('rcm-resto');
  const atualiza = () => {
    let v = rr(+inp.value || 0); if (v > saldo) { v = saldo; inp.value = saldo.toFixed(2); }
    const r = rr(saldo - v);
    if (v > 0 && r > 0.001) { resto.textContent = `Fica devendo ${fmt(r)} pra pagar depois`; resto.className = 'rcm-resto parcial'; }
    else if (v >= saldo) { resto.textContent = 'Quita a conta ✅'; resto.className = 'rcm-resto ok'; }
    else { resto.textContent = ''; resto.className = 'rcm-resto'; }
  };
  inp.addEventListener('input', atualiza); atualiza();
  $('rcm-tudo').addEventListener('click', () => { inp.value = saldo.toFixed(2); atualiza(); inp.focus(); inp.select(); });
  const confirmar = (forma) => {
    const v = Math.min(rr(+inp.value || 0), saldo);
    if (!(v > 0)) { toast('⚠ Informe o valor'); inp.focus(); return; }
    fecharErpModal(); onConfirm(v, forma);
  };
  document.querySelectorAll('.anot-forma-btn').forEach(b => b.addEventListener('click', () => confirmar(b.dataset.f)));
  const tecla = (e) => {
    if (document.activeElement === inp && !['Enter'].includes(e.key)) return;   // digitando o valor → não sequestra
    if (e.key === '1') confirmar('Dinheiro'); else if (e.key === '2') confirmar('PIX'); else if (e.key === '3') confirmar('Cartão');
    else if (e.key === 'Enter') confirmar('Dinheiro'); else if (e.key === 'Escape') fecharErpModal();
  };
  document.addEventListener('keydown', tecla);
  const ov = $('overlay-erp'); const obs = new MutationObserver(() => { if (ov && !ov.classList.contains('aberto')) { document.removeEventListener('keydown', tecla); obs.disconnect(); } });
  if (ov) obs.observe(ov, { attributes: true, attributeFilter: ['class'] });
  setTimeout(() => { inp.focus(); inp.select(); }, 60);
}
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
  const extra = tipo === 'Alimentação' ? `${tipo} +20%` : tipo;
  $('cartao-texto').innerHTML = `<span class="atalho">C</span>artão <small>(${extra})</small>`;
  $('overlay-cartao-tipo').classList.remove('aberto');
  atualizarResumo();   // reflete o acréscimo de 20% do Alimentação na hora
  // Alimentação: antes de finalizar, mostra o valor JÁ com +20% pra confirmar
  if (tipo === 'Alimentação') { confirmarAlimentacao(); return; }
  prosseguirAposCartao();
}
// Depois de escolhido o tipo (e confirmado, no caso do Alimentação): finaliza ou volta pro campo do valor.
function prosseguirAposCartao() {
  if (confirmarDepoisDoCartao) {
    confirmarDepoisDoCartao = false;
    setTimeout(confirmarRecebimento, 50);
  } else {
    setTimeout(() => $('val-cartao').focus(), 50);
  }
}
// Tela de confirmação do Cartão Alimentação: mostra valor, acréscimo de 20% e total que "fica no cartão".
function confirmarAlimentacao() {
  const base = +$('val-cartao').value || 0;
  const acrescimo = Math.round(base * 0.20 * 100) / 100;
  const total = Math.round(base * 1.20 * 100) / 100;
  $('alim-base').textContent = fmt(base);
  $('alim-acrescimo').textContent = '+ ' + fmt(acrescimo);
  $('alim-total').textContent = fmt(total);
  $('overlay-alimentacao').classList.add('aberto');
  setTimeout(() => $('alim-confirmar').focus(), 50);
}
function fecharAlimentacao() { $('overlay-alimentacao').classList.remove('aberto'); }
// Confirmou o valor do alimentação → segue o fluxo (finaliza a venda ou volta pro campo)
$('alim-confirmar').addEventListener('click', () => { fecharAlimentacao(); prosseguirAposCartao(); });
// Voltar → reabre a escolha de tipo de cartão (deixa trocar Crédito/Débito)
$('alim-voltar').addEventListener('click', () => { fecharAlimentacao(); cartaoTipo = null; abrirCartaoTipo(); });
$('overlay-alimentacao').addEventListener('click', e => { if (e.target === $('overlay-alimentacao')) { $('alim-voltar').click(); } });

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

  // ── Confirmação do Cartão Alimentação (fica ACIMA de tudo) ──
  if ($('overlay-alimentacao').classList.contains('aberto')) {
    if (e.key === 'Enter') { e.preventDefault(); $('alim-confirmar').click(); }
    else if (e.key === 'Escape') { e.preventDefault(); $('alim-voltar').click(); }
    return;
  }
  // ── Submodal de tipo de cartão (a mais "em cima") ──
  if ($('overlay-cartao-tipo').classList.contains('aberto')) {
    if (e.key === '1') { e.preventDefault(); escolherCartaoTipo('Crédito'); }
    else if (e.key === '2') { e.preventDefault(); escolherCartaoTipo('Débito'); }
    else if (e.key === '3') { e.preventDefault(); escolherCartaoTipo('Alimentação'); }
    return;
  }
  // ── Busca por nome / edição de item abertas → tratadas localmente ──
  if ($('overlay-busca').classList.contains('aberto')) return;
  if ($('overlay-item').classList.contains('aberto')) return;

  // ── Dentro do modal de recebimento ──
  if ($('overlay-recebimento').classList.contains('aberto')) {
    // QUALQUER campo de texto (nome do fiado / nome da anotação) digita livremente — os atalhos
    // de letra (P/D/C) NÃO devem sequestrar a tecla enquanto se escreve um nome.
    const ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT' && /^(text|search|)$/.test(ae.type || '')) return;
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
  // ── Tela PDV: V abre o recebimento — SÓ na tela de vendas, nunca nas outras ──
  if (e.ctrlKey || e.metaKey || e.altKey) return;                 // ignora Ctrl+V (colar) etc.
  if (e.key !== 'v' && e.key !== 'V') return;
  if (!$('tela-pdv').classList.contains('ativa')) return;          // só na tela de PDV
  if ($('overlay-pedido').classList.contains('aberto')) return;    // modal de delivery aberto
  // mesmo princípio do C/S: com código digitado (códigos podem ter letra V) ou
  // digitando em outro campo, a letra vai pro campo — não finaliza a venda
  {
    const cod = $('codigo');
    if (cod && cod.value.trim() !== '') return;
    const ativo = document.activeElement;
    if (ativo && ativo !== cod && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName)) return;
  }
  e.preventDefault();
  finalizarVenda();
});

/* ═══════════════════════════════════════════════════════════
   FASE 46A — OPERAÇÃO RÁPIDA NO PDV: Sangria (F8), Suprimento (F9),
   Consumo Interno (C). SÓ camada de interface — reusa os endpoints
   já existentes (/api/caixa/:id/sangria|suprimento e /api/movimentacoes).
   Nenhuma regra de negócio nova. C só dispara com o campo de código VAZIO,
   pra não atrapalhar quem digita códigos de produto com a letra C.
   ═══════════════════════════════════════════════════════════ */
let caixaAtualCache = null;
async function getCaixaAtual(forcar) {
  if (caixaAtualCache && !forcar) return caixaAtualCache;
  try { caixaAtualCache = await (await fetch('/api/caixa/atual', { cache: 'no-store' })).json(); } catch { caixaAtualCache = { aberto: false }; }
  return caixaAtualCache;
}
function opInfoCaixaHtml(s) {
  const agora = new Date();
  const abertoDesde = s.aberto_em ? new Date(s.aberto_em) : null;
  return `<div class="op-mov-info">
    <div><span>👤 Operador</span><b>${crmEsc((usuarioAtual && usuarioAtual.nome) || (usuarioAtual && usuarioAtual.usuario) || '—')}</b></div>
    <div><span>🗄️ Caixa</span><b>#${s.id}${s.operador_nome ? ' · ' + crmEsc(s.operador_nome) : ''}</b></div>
    <div><span>🕒 Aberto desde</span><b>${abertoDesde ? abertoDesde.toLocaleString('pt-BR') : '—'}</b></div>
    <div><span>📅 Data / hora</span><b>${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR').slice(0,5)}</b></div>
  </div>`;
}
// Sangria (saída) e Suprimento (entrada) — NÃO exigem caixa aberto; justificativa obrigatória.
// Vão pro razão como movimento de dinheiro e entram na conferência do dia automático.
async function abrirCaixaMov(tipo) {
  const ehSup = tipo === 'suprimento';
  const cedulas = [10, 20, 50, 100, 200];   // botões rápidos (SOMAM, tipo contar cédulas)
  const motivos = ehSup
    ? ['Troco inicial', 'Reforço de caixa', 'Abertura']
    : ['Pagamento fornecedor', 'Retirada p/ banco', 'Despesa', 'Troco'];
  const agora = new Date();
  const op = (usuarioAtual && (usuarioAtual.nome || usuarioAtual.usuario)) || '—';
  abrirErpModal(`<h3 class="erp-modal-tit">${ehSup ? '➕ Suprimento (entrada no caixa)' : '➖ Sangria (retirada do caixa)'}</h3>
    <form id="op-mov-form" class="fin-form op-mov-form">
      <div class="op-mov-meta"><span>👤 ${crmEsc(op)}</span><span>🕒 ${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR').slice(0, 5)}</span></div>
      <p class="fin-hint">${ehSup ? 'Dinheiro que ENTRA na gaveta (reforço/troco).' : 'Dinheiro que SAI da gaveta (pagamento, retirada, banco).'} Não precisa de caixa aberto.</p>
      <label class="op-mov-vlabel">Valor (R$)<input type="number" step="0.01" min="0.01" id="op-mov-valor" class="op-mov-vinput" inputmode="decimal" autocomplete="off" placeholder="0,00"></label>
      <div class="op-mov-chips">${cedulas.map(v => `<button type="button" class="op-mov-chip" data-v="${v}">+${v}</button>`).join('')}<button type="button" class="op-mov-chip zerar" data-zerar="1">limpar</button></div>
      <label>Justificativa *<input id="op-mov-just" autocomplete="off" placeholder="${ehSup ? 'ex.: troco inicial, reforço de caixa' : 'ex.: pagamento fornecedor, retirada para banco'}"></label>
      <div class="op-mov-chips motivos">${motivos.map(m => `<button type="button" class="op-mov-chip mot" data-m="${crmEsc(m)}">${crmEsc(m)}</button>`).join('')}</div>
      <p class="op-mov-hint-fluxo">🧾 Entra no <b>caixa do dia</b> (fechamento). Se também tiver que ir pro <b>fluxo de caixa / painel financeiro</b>, você marca isso <b>no fechamento diário do caixa</b>.</p>
      <button type="submit" class="fin-btn-salvar">${ehSup ? '➕ Registrar suprimento' : '➖ Registrar sangria'}</button>
    </form>`);
  $('modal-erp-box').classList.add('erp-mov', ehSup ? 'erp-mov-sup' : 'erp-mov-san');   // padrão azul (igual Recebimento)
  const valor = $('op-mov-valor'), just = $('op-mov-just');
  setTimeout(() => valor.focus(), 60);
  $('op-mov-form').querySelectorAll('.op-mov-chip[data-v]').forEach(b => b.addEventListener('click', () => {
    valor.value = ((parseFloat(valor.value) || 0) + (+b.dataset.v || 0)).toFixed(2); valor.focus();   // soma (monta o valor rápido)
  }));
  { const z = $('op-mov-form').querySelector('[data-zerar]'); if (z) z.addEventListener('click', () => { valor.value = ''; valor.focus(); }); }
  $('op-mov-form').querySelectorAll('.op-mov-chip[data-m]').forEach(b => b.addEventListener('click', () => { just.value = b.dataset.m; just.focus(); }));
  valor.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); just.focus(); } });
  $('op-mov-form').addEventListener('submit', async e => {
    e.preventDefault();
    const v = parseFloat(valor.value) || 0; if (v <= 0) { toast('⚠ Informe um valor maior que zero'); valor.focus(); return; }
    if (!just.value.trim()) { toast('⚠ A justificativa é obrigatória'); just.focus(); return; }
    // Padrão: só gaveta/fechamento. A escolha de mandar pro fluxo é feita depois, no fechamento diário.
    const r = await (await fetch(`/api/caixa/${tipo}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor: v, motivo: just.value.trim() }) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    toast(`✅ ${ehSup ? 'Suprimento' : 'Sangria'} de ${fmt(v)} registrado`); fecharErpModal(); caixaAtualCache = null;
    if ($('tela-financeiro') && $('tela-financeiro').classList.contains('ativa')) finIr(finSecao);
  });
}
const abrirSangria = () => abrirCaixaMov('sangria');
const abrirSuprimento = () => abrirCaixaMov('suprimento');

// Consumo Interno — baixa de estoque (não é venda). Reusa POST /api/movimentacoes.
// O REGISTRO dos itens é feito na TELA DE VENDAS (cupom); aqui só se escolhe pra quem.
// C abre SEMPRE: com itens no cupom eles viram o consumo (saem do cupom ao confirmar);
// sem itens, a tela abre avisando pra registrar em Vendas (Confirmar fica travado).
// Paleta padrão (claro) via classe .erp-ci. Ver [[feedback_paleta_padrao]].
let ciItens = [];
let ciVeioDoCupom = false;
function ciAtualizarBtn() {
  const inp = $('ci-func'), btnOk = $('ci-confirmar'); if (!btnOk) return;
  btnOk.disabled = !(inp && inp.value.trim() !== '' && ciItens.length > 0);
}
async function abrirConsumoInterno() {
  ciItens = []; ciVeioDoCupom = false;
  const naPdv = $('tela-pdv').classList.contains('ativa');
  const temCupom = naPdv && itensCupom.length > 0;
  if (temCupom) {   // itens do cupom viram o consumo (pacote conta em unidades)
    ciVeioDoCupom = true;
    ciItens = itensCupom.map(it => ({ codigo: it.cod, nome: it.desc, qtd: it.qtd * (it.pacote ? (it.unidConsumo || 1) : 1), unidade: 'un' }));
  }
  let funcs = []; try { funcs = (await (await fetch('/api/movimentacoes/funcionarios', { cache: 'no-store' })).json()).funcionarios || []; } catch {}
  const n = ciItens.length;
  const sub = temCupom ? `${n} ${n > 1 ? 'itens' : 'item'} do cupom — pra quem?` : 'registre os itens na tela de Vendas (F9) e aperte C';
  abrirErpModal(`<h3 class="erp-modal-tit">🧑‍🍳 CONSUMO INTERNO <small class="op-ci-sub" id="ci-cabec">${sub}</small></h3>
    <div class="op-ci">
      ${temCupom ? '' : `<div class="op-ci-aviso">🛒 Nenhum item no cupom. O consumo é registrado na <b>tela de Vendas</b>: lance os produtos lá e aperte <kbd>C</kbd>.</div>`}
      <div class="op-ci-labelfunc">👤 Pra quem?</div>
      <div class="op-ci-funcs" id="ci-funcs">
        ${funcs.map((f, i) => `<button type="button" class="op-ci-funcbtn" data-f="${crmEsc(f)}">${i < 9 ? `<span class="num">${i + 1}</span>` : ''}<span class="lbl">${crmEsc(f)}</span></button>`).join('')}
      </div>
      <input id="ci-func" class="op-ci-funcoutro" autocomplete="off" placeholder="${funcs.length ? 'ou digite outro nome…' : 'nome do funcionário…'}">
      <div class="op-ci-rodape"><span class="op-ci-op">👤 ${crmEsc((usuarioAtual && usuarioAtual.nome) || '—')} · ${new Date().toLocaleDateString('pt-BR')}</span>
        <button type="button" class="crm-btn" id="ci-pesquisa" title="Ver o que já foi consumido e por quem">📊 Ver consumo</button>
        <button class="fin-btn-salvar" id="ci-confirmar" disabled>✅ Confirmar consumo</button></div>
    </div>`);
  $('modal-erp-box').classList.add('erp-ci');   // paleta clara padrão
  $('ci-pesquisa').addEventListener('click', abrirConsumoPesquisa);
  const inp = $('ci-func'), btnOk = $('ci-confirmar');
  const escolher = (nome) => {
    inp.value = nome; ciAtualizarBtn();
    document.querySelectorAll('.op-ci-funcbtn').forEach(b => b.classList.toggle('sel', b.dataset.f === nome));
    if (!btnOk.disabled) btnOk.focus(); // Enter confirma
  };
  document.querySelectorAll('.op-ci-funcbtn').forEach(b => b.addEventListener('click', () => escolher(b.dataset.f)));
  inp.addEventListener('input', () => { ciAtualizarBtn(); document.querySelectorAll('.op-ci-funcbtn').forEach(b => b.classList.remove('sel')); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!btnOk.disabled) confirmarConsumoInterno(); } });
  // teclas 1..9 escolhem o funcionário (fora de qualquer campo de digitação com texto)
  $('overlay-erp').addEventListener('keydown', function tecla(e) {
    if (!/^[1-9]$/.test(e.key)) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value.trim() !== '') return;
    const alvo = document.querySelectorAll('.op-ci-funcbtn')[+e.key - 1];
    if (alvo) { e.preventDefault(); escolher(alvo.dataset.f); }
  });
  btnOk.addEventListener('click', confirmarConsumoInterno);
  setTimeout(() => { const alvo = document.querySelector('.op-ci-funcbtn'); (alvo || inp).focus(); }, 60);
}
async function confirmarConsumoInterno() {
  if (!ciItens.length) return;
  const func = $('ci-func') ? $('ci-func').value.trim() : '';
  const obs = ''; // a tela enxuta não tem observação
  let ok = 0; const erros = []; const okCodigos = new Set();
  for (const it of ciItens) {
    const r = await (await fetch('/api/movimentacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produto_codigo: it.codigo, tipo: 'consumo_interno', quantidade: it.qtd, funcionario: func, obs }) })).json();
    if (r && !r.erro) {
      ok++; okCodigos.add(it.codigo);
      // baixa TAMBÉM no cache local (o servidor já baixou via /api/movimentacoes) → a tela de Produtos
      // reflete na hora e a próxima entrada/sync não apaga a baixa. Pode ficar negativo.
      const p = PRODUTOS.find(x => x.codigo === it.codigo);
      if (p && typeof p.estoque === 'number') p.estoque = Math.round((p.estoque - it.qtd) * 100) / 100;
    } else erros.push(it.nome + (r && r.erro ? ' (' + r.erro + ')' : ''));
  }
  if (ok) { salvarCacheProdutos(); if ($('tela-produtos') && $('tela-produtos').classList.contains('ativa')) renderProdutos(); }
  if (ok) toast(`✅ Consumo interno registrado (${ok} ${ok > 1 ? 'itens' : 'item'})`);
  if (erros.length) toast('⚠ Falhou: ' + erros.join(', '));
  // itens vindos do cupom do PDV: o que virou consumo SAI do cupom (não é venda)
  if (ciVeioDoCupom && ok) {
    itensCupom = itensCupom.filter(i => !okCodigos.has(i.cod));
    renderCupom();
  }
  ciVeioDoCupom = false;
  fecharErpModal();
  if ($('tela-movimentacoes').classList.contains('ativa')) renderMovimentacoes();
}

/* Pesquisa inteligente do CONSUMO INTERNO — o que foi consumido e por quem. Abre por cima
   do card de consumo (o cupom fica intacto; é só apertar C de novo pra registrar). */
let consumoPesqPeriodo = { de: '', ate: '' };
let consumoPesqFunc = '';   // funcionário selecionado (botão) — filtra o relatório inteiro pra ele
async function abrirConsumoPesquisa() {
  consumoPesqFunc = '';
  abrirErpModal(`<h3 class="erp-modal-tit">📊 Consumo interno — o que foi consumido e por quem</h3>
    <div class="cpq">
      <div class="cpq-filtros">
        <label>De<input type="date" id="cpq-de" value="${consumoPesqPeriodo.de}"></label>
        <label>Até<input type="date" id="cpq-ate" value="${consumoPesqPeriodo.ate}"></label>
        <input type="search" id="cpq-q" placeholder="🔎 funcionário ou produto…" autocomplete="off">
      </div>
      <div id="cpq-conteudo">${biLoading()}</div>
    </div>`);
  $('modal-erp-box').classList.add('erp-ci', 'erp-ci-wide', 'erp-cpq');   // paleta clara + tela ampla (aproveita o espaço)
  const carregar = async () => {
    consumoPesqPeriodo = { de: $('cpq-de').value, ate: $('cpq-ate').value };
    const base = new URLSearchParams();
    if (consumoPesqPeriodo.de) base.set('de', consumoPesqPeriodo.de);
    if (consumoPesqPeriodo.ate) base.set('ate', consumoPesqPeriodo.ate);
    if ($('cpq-q').value.trim()) base.set('q', $('cpq-q').value.trim());
    // dFull = todos os funcionários (pros botões); dDet = só o selecionado (pro resto do relatório)
    let dFull; try { dFull = await (await fetch('/api/consumo/inteligente?' + base, { cache: 'no-store' })).json(); } catch { $('cpq-conteudo').innerHTML = biErro(); return; }
    let dDet = dFull;
    if (consumoPesqFunc) {
      const p2 = new URLSearchParams(base); p2.set('funcionario', consumoPesqFunc);
      try { dDet = await (await fetch('/api/consumo/inteligente?' + p2, { cache: 'no-store' })).json(); } catch { dDet = dFull; }
    }
    $('cpq-conteudo').innerHTML = consumoPesqHTML(dFull, dDet);
    // botões de funcionário → clicar filtra o relatório pra ele (clicar de novo volta a todos)
    $('cpq-conteudo').querySelectorAll('.cpq-funcbtn').forEach(b => b.addEventListener('click', () => {
      consumoPesqFunc = (consumoPesqFunc === b.dataset.f) ? '' : b.dataset.f;
      carregar();
    }));
    const lim = $('cpq-func-limpar'); if (lim) lim.addEventListener('click', () => { consumoPesqFunc = ''; carregar(); });
  };
  ['cpq-de', 'cpq-ate'].forEach(id => $(id).addEventListener('change', carregar));
  let t; $('cpq-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(carregar, 250); });
  carregar();
}
function consumoPesqHTML(dFull, dDet) {
  dDet = dDet || dFull;
  const i = dDet.insights || {};
  const sel = consumoPesqFunc;
  const kpiPessoa = sel
    ? `<div class="cpq-kpi cpq-kpi--pessoa"><span>Funcionário</span><b>${crmEsc(sel)}</b><small>${i.nRegistros || 0} lançamentos</small></div>`
    : `<div class="cpq-kpi cpq-kpi--pessoa"><span>Quem mais consome</span><b>${i.quemMais ? crmEsc(i.quemMais.nome) : '—'}</b><small>${i.quemMais ? fmt(i.quemMais.valor) : ''}</small></div>`;
  const kpis = `<div class="cpq-kpis">
      <div class="cpq-kpi cpq-kpi--money"><span>Consumido (custo)${sel ? ' — ' + crmEsc(sel) : ''}</span><b>${fmt(i.totalValor || 0)}</b><small>${i.nRegistros || 0} lançamentos</small></div>
      ${kpiPessoa}
      <div class="cpq-kpi cpq-kpi--produto"><span>Mais consumido${sel ? ' por ' + crmEsc(sel) : ''}</span><b>${i.produtoMais ? crmEsc(i.produtoMais.nome) : '—'}</b><small>${i.produtoMais ? biNum(i.produtoMais.qtd) + ' un' : ''}</small></div>
    </div>`;
  // Painel "Por funcionário" = BOTÕES (nome + qtd + valor). Clicar mostra só o respectivo.
  const botoes = (dFull.porFuncionario || []).map(f => `
      <button type="button" class="cpq-funcbtn ${f.nome === sel ? 'sel' : ''}" data-f="${crmEsc(f.nome)}">
        <span class="cpq-fb-nome">${crmEsc(f.nome)}</span>
        <span class="cpq-fb-vals"><b>${fmt(f.valor)}</b><small>${biNum(f.qtd)} un · ${f.n}×</small></span>
      </button>`).join('') || '<div class="ac-vazio">Nada no período.</div>';
  const chip = sel ? `<div class="cpq-chip">📌 Mostrando só: <b>${crmEsc(sel)}</b><button type="button" id="cpq-func-limpar" title="Ver todos">✕ todos</button></div>` : '';
  const prod = (dDet.porProduto || []).map(p => `<tr><td>${crmEsc(p.nome)}</td><td class="col-num">${biNum(p.qtd)} ${crmEsc(p.unidade || '')}</td><td class="col-num">${fmt(p.valor)}</td></tr>`).join('') || '<tr><td colspan="3" class="ac-vazio">Nada no período.</td></tr>';
  const lista = (dDet.lista || []).slice(0, 60).map(m => `<tr><td>${fmtDataHora(m.criado_em)}</td><td>${crmEsc(m.produto_nome || m.produto_codigo)}</td><td class="col-num">${biNum(m.quantidade)}</td><td>${crmEsc(m.funcionario || '—')}</td></tr>`).join('') || '<tr><td colspan="4" class="ac-vazio">Nada.</td></tr>';
  return kpis + chip + `
    <div class="cpq-cols">
      <div><div class="fin-box-tit">👤 Por funcionário <small class="cpq-dica">(clique num nome pra ver só ele)</small></div><div class="cpq-funcbtns">${botoes}</div></div>
      <div><div class="fin-box-tit">🍧 Por produto${sel ? ' — ' + crmEsc(sel) : ''}</div><div class="prod-tabela-wrap"><table class="prod-tabela"><thead><tr><th>Produto</th><th class="col-num">Qtd</th><th class="col-num">Valor</th></tr></thead><tbody>${prod}</tbody></table></div></div>
    </div>
    <div class="fin-box-tit" style="margin-top:6px">🕒 Últimos lançamentos${sel ? ' — ' + crmEsc(sel) : ''}</div>
    <div class="prod-tabela-wrap cpq-lista"><table class="prod-tabela"><thead><tr><th>Quando</th><th>Produto</th><th class="col-num">Qtd</th><th>Quem</th></tr></thead><tbody>${lista}</tbody></table></div>`;
}

/* Aceita o formato NOVO (objetos {valor,codigo,nome} — cada botão é um produto) e o ANTIGO
   (só números), pra não quebrar caches/servidores desatualizados. */
function normalizarValoresLitros(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(v => (v && typeof v === 'object')
    ? { valor: r2loc(+v.valor || 0), codigo: v.codigo || '', nome: v.nome || '' }
    : { valor: r2loc(+v || 0), codigo: '', nome: '' }).filter(v => v.valor > 0);
}
// Paleta de cores predominantes por VALOR/TIPO de açaí na lista do F8 (o gelado tem o azul próprio).
const LTR_PALETA = [
  { bg: '#d7ebca', bd: '#a4d18e', tx: '#14532d' }, // verde
  { bg: '#efe3fd', bd: '#cbb8f2', tx: '#5b21b6' }, // roxo
  { bg: '#fdeeb8', bd: '#e6cb46', tx: '#6b5600' }, // amarelo
  { bg: '#ffe0c7', bd: '#f2b877', tx: '#8a4b12' }, // laranja
  { bg: '#fcd6e5', bd: '#f2a9c4', tx: '#8a2b52' }, // rosa
  { bg: '#cdeee7', bd: '#8fd6c7', tx: '#0f5e50' }, // verde-água
  { bg: '#f6d7d2', bd: '#f0a597', tx: '#8a2c1c' }, // vermelho suave
  { bg: '#dbe4f7', bd: '#a9bce8', tx: '#2b3a7a' }, // azul-índigo
];
// CONVENÇÃO GLOBAL: Shift+Enter = VOLTAR em todo o programa (passo anterior / fechar / ESC).
// Captura no window (antes de tudo). O F8 registra sua própria função de "voltar um passo".
let f8VoltarAtual = null;
(function instalarShiftEnterVoltar() {
  const ehEnter = e => e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.keyCode === 13;
  window.addEventListener('keydown', e => {
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || !ehEnter(e)) return;
    e.preventDefault(); e.stopPropagation();
    // 1) F8 "Açaí do dia" tem passos → volta um passo
    const f8Aberto = document.querySelector('#overlay-erp.aberto .ltr');
    if (f8Aberto && typeof f8VoltarAtual === 'function') { f8VoltarAtual(); return; }
    // 2) botão de voltar visível na tela/modal atual (‹ editar, voltar…)
    const back = [...document.querySelectorAll('.ltr-voltar, [data-voltar]')].find(b => b.offsetParent !== null);
    if (back) { back.click(); return; }
    // 3) resto do programa: age como ESC (fecha/volta o que estiver aberto)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  }, true);
})();
// Aviso visível "MODO TESTE" quando o programa roda com o BANCO DE DESENVOLVIMENTO (não é a loja).
(function marcarAmbienteTeste() {
  try {
    if (typeof window === 'undefined' || window.__ACAI_AMBIENTE !== 'dev') return;
    const montar = () => {
      if (!document.body || document.getElementById('ambiente-teste')) return;
      const el = document.createElement('div');
      el.id = 'ambiente-teste'; el.className = 'ambiente-teste';
      el.innerHTML = `🧪 MODO TESTE<small>banco de desenvolvimento — NÃO é a loja${window.__ACAI_DB ? ' · ' + window.__ACAI_DB : ''}</small>`;
      el.title = 'Você está numa cópia de desenvolvimento/teste. A loja real é o programa instalado.';
      document.body.appendChild(el);
    };
    if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar);
  } catch (e) {}
})();
/* F8 — LITROS produzidos, em 3 passos guiados: (1) digita os litros → Enter · (2) escolhe o
   PRODUTO/valor por número (cada botão é um produto) · (3) confirma (registrar ou editar).
   Os lançamentos ficam PENDENTES até o F10 (fechar o dia → rendimento). */
async function abrirLitros() {
  let valores = []; try { valores = await (await fetch('/api/litros/valores', { cache: 'no-store' })).json(); } catch {}
  valores = normalizarValoresLitros(valores);
  abrirErpModal(`<h3 class="erp-modal-tit">🫐 Açaí do dia <small class="op-ci-sub">(F8)</small></h3>
    <div class="ltr">
      <div class="ltr-entrada">
        <div class="ltr-steps" id="ltr-steps"></div>
        <div class="ltr-produzido" id="ltr-produzido">
          <div class="ltr-dia-tit">📋 Produzido hoje</div>
          <div id="ltr-lista">${biLoading()}</div>
        </div>
      </div>
      <div class="ltr-dia">
        <div class="ltr-gelado-inline">🧊 Sobrou gelado: <input type="text" id="ltr-gelado-qtd" class="ltr-input-mini" inputmode="decimal" autocomplete="off" placeholder="litros ⏎"> <button type="button" class="crm-btn" id="ltr-gelado-add">registrar</button></div>
        <div class="ltr-fechar-box" id="ltr-fechar-box">
          <div class="ltr-fechar-tit">🥫 Latas do dia <small>(vá dando entrada durante o dia)</small></div>
          <div class="ltr-latas-add">
            <input type="text" id="ltr-lata-qtd" class="ltr-input" inputmode="decimal" autocomplete="off" placeholder="quantas latas? ⏎">
            <input type="text" id="ltr-lata-valor" class="ltr-input" inputmode="decimal" autocomplete="off" placeholder="preço da lata ⏎" style="display:none">
            <button type="button" class="crm-btn" id="ltr-lata-add">➕ Adicionar</button>
          </div>
          <label class="ltr-latas-varpreco"><input type="checkbox" id="ltr-lata-varpreco"> 💲 preço variado <small>(cada lata com um valor · senão o custo é no processamento)</small></label>
          <div id="ltr-latas-lista">${biLoading()}</div>
        </div>
      </div>
    </div>
    <button class="ltr-btn-finalizar" id="ltr-fx-ok">🏁 Finalizar e dar entrada <span class="ltr-kbd-alt">Alt+F</span></button>`);

  try { const mb = $('modal-erp-box'); if (mb) { mb.classList.add('ltr-modal'); observarFitModal(mb); } } catch {}   // tela AMPLIADA que cabe no viewport (auto-encolhe)
  // Fluxo guiado em 3 passos: (1) litros → Enter · (2) valor por número · (3) confirma (registrar/editar).
  let passo = 1, litros = 0, valorSel = null, codigoSel = '', nomeSel = '', formulaPendente = null, latasPendente = null;
  let diaResumo = null;   // resumo do dia (setado por carregarDia) — usado pelo "Finalizar"
  let latasTotal = 0, latasValorMedio = 0;   // latas do dia (soma) + valor médio por lata — setado por carregarLatas
  const stepBox = $('ltr-steps');
  const wrap = document.querySelector('.ltr');

  function render() {
    const box = $('modal-erp-box'); if (box) box.classList.toggle('erp-conf-grande', passo === 3 || passo === 'confF' || passo === 'confL'); // tela grande na confirmação
    if (passo === 'confF') { renderConfirmFormula(); return; }
    if (passo === 'confL') { renderConfirmLatas(); return; }
    passo === 1 ? renderPasso1() : passo === 2 ? renderPasso2() : renderPasso3();
  }
  // Shift+Enter volta as seleções em qualquer passo (captura: antes dos campos/botões)
  const voltarSelecao = () => {
    if (passo === 3) { passo = 2; render(); }
    else if (passo === 2) { passo = 1; render(); }
    else if (passo === 'confF') { formulaPendente = null; passo = 1; render(); }
    else if (passo === 'confL') { latasPendente = null; passo = 1; render(); setTimeout(() => { const e = $('ltr-lata-qtd'); if (e) e.focus(); }, 50); }
  };
  f8VoltarAtual = voltarSelecao;   // o Shift+Enter global usa esta função quando o F8 está aberto

  // Fecha o F8 sozinho após 7s SEM atividade (tecla/clique/digitação/movimento do mouse).
  {
    const ovInat = $('overlay-erp');
    let inatTimer = null;
    const evs = ['keydown', 'pointerdown', 'mousemove', 'wheel', 'touchstart', 'input'];
    const fecharPorInatividade = () => { const ov = $('overlay-erp'); if (ov && ov.classList.contains('aberto') && ov.querySelector('.ltr')) fecharErpModal(); };
    const resetInat = () => { clearTimeout(inatTimer); inatTimer = setTimeout(fecharPorInatividade, 7000); };
    evs.forEach(ev => document.addEventListener(ev, resetInat, true));
    resetInat();
    const obs = new MutationObserver(() => { if (!ovInat.classList.contains('aberto')) { clearTimeout(inatTimer); evs.forEach(ev => document.removeEventListener(ev, resetInat, true)); obs.disconnect(); } });
    obs.observe(ovInat, { attributes: true, attributeFilter: ['class'] });
  }

  function renderPasso1() {
    stepBox.innerHTML = `
      <div class="ltr-reg">
        <div class="ltr-reg-top"><span class="ltr-reg-tit">🫐 Registro de litros produzidos</span><span class="ltr-reg-foco">● FOCO</span></div>
        <input type="text" id="ltr-litros" class="ltr-reg-input" inputmode="text" autocomplete="off" placeholder="ex.: 12   ou   3*10" value="${litros > 0 ? litros : ''}">
        <div class="ltr-reg-hint">Tecle <kbd>Enter</kbd> para adicionar · <kbd>3*cód</kbd> para quantidade</div>
      </div>`;
    const inp = $('ltr-litros'); setTimeout(() => { inp.focus(); inp.select(); }, 60);
    // FÓRMULA (litros*código, encadeada por +): registra direto — "5*15+2*10" = 5 L do cód 15 + 2 L do cód 10
    async function registrarFormulaLitros(raw) {
      const itens = [];
      for (const t of raw.split('+').map(s => s.trim()).filter(Boolean)) {
        if (!t.includes('*')) { toast('⚠ Use litros*código (ex.: 5*15). Erro em "' + t + '"'); inp.focus(); return; }
        const [q, c] = t.split('*');
        const qn = parseFloat(String(q).replace(',', '.')), cod = String(c || '').trim();
        if (!(qn > 0) || !cod) { toast('⚠ Fórmula inválida em "' + t + '"'); inp.focus(); return; }
        if (!qtdMeioValida(qn)) { avisoGrande('LITROS NÃO CONFERE', 'Só de meio em meio: 0,5 · 1 · 1,5 · 2… (não vale ' + String(q).trim() + ')'); bipErro(); inp.focus(); return; }
        let obj = valores.find(v => v.codigo && String(v.codigo).toLowerCase() === cod.toLowerCase());
        if (!obj) { const p = (typeof buscarPorCodigo === 'function') ? buscarPorCodigo(cod) : null; if (p) obj = { valor: r2loc(+p.precoVenda || +p.preco || 0), codigo: p.codigo, nome: p.nome }; }
        if (!obj || !(obj.valor > 0)) { toast('❌ Código não encontrado ou sem preço: ' + cod); inp.focus(); return; }
        itens.push({ litros: r2loc(qn), valor: obj.valor, produto_codigo: obj.codigo || cod, nome: obj.nome || '' });
      }
      if (!itens.length) return;
      // pedido do Melque: digitar direto (fórmula) também passa pela tela de confirmação
      formulaPendente = itens; passo = 'confF'; render();
    }
    const avancar = () => {
      const raw = (inp.value || '').trim();
      // tem código (com * e/ou +) → registra DIRETO pela fórmula (igual ao gelado)
      if (raw.includes('*')) { registrarFormulaLitros(raw); return; }
      // só a quantidade → fluxo normal (escolhe o valor no passo 2)
      const v = +String(raw).replace(',', '.') || 0;
      if (!(v > 0)) { toast('⚠ Informe os litros'); inp.focus(); return; }
      if (!qtdMeioValida(v)) { avisoGrande('LITROS NÃO CONFERE', 'Só de meio em meio: 0,5 · 1 · 1,5 · 2… (não vale ' + raw + ')'); bipErro(); inp.focus(); return; }
      litros = r2loc(v); passo = 2; render();
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); avancar(); }   // Enter adiciona (sem botão)
      else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const t = $('ltr-gelado-qtd'); if (t) t.focus(); }   // Tab: registro → gelado
    });
  }

  function renderPasso2() {
    const ehAdmin = usuarioAtual && usuarioAtual.perfil === 'admin';
    stepBox.innerHTML = `
      <div class="ltr-passo">
        <div class="ltr-passo-n">Passo 2 de 3 · <button class="ltr-voltar" id="ltr-volta2">‹ editar litros (Shift+Enter)</button></div>
        <div class="ltr-resumo-mini">🫐 <b>${biNum(litros)} litros</b></div>
        <div class="ltr-val-cab"><label class="ltr-lbl">Açaí de qual valor?</label>${ehAdmin ? '<button class="ltr-edit-val" id="ltr-editar-valores">✏️ editar valores</button>' : ''}</div>
        <div class="ltr-valores-lbl"><small>clique ou tecle 1–9</small></div>
        <div class="ltr-valores ltr-valores-fila" id="ltr-valores">
          ${valores.length ? valores.map((v, i) => `<button type="button" class="ltr-valbtn ltr-valbtn-fila" data-i="${i}">${i < 9 ? `<span class="num">${i + 1}</span>` : ''}<span class="ltr-valbtn-preco">${fmt(v.valor)}</span>${v.nome ? `<span class="ltr-valbtn-nome">${v.nome}</span>` : ''}</button>`).join('') : `<span class="ltr-semval">Nenhum produto com preço cadastrado. ${ehAdmin ? 'Cadastre produtos ou clique em “editar valores”.' : 'Peça ao administrador pra cadastrar.'}</span>`}
        </div>
        <label class="ltr-lbl-outro">Outro valor <input type="number" step="0.01" min="0" id="ltr-valor-outro" class="ltr-input-mini" placeholder="R$"></label>
      </div>`;
    stepBox.querySelectorAll('.ltr-valbtn').forEach(b => b.addEventListener('click', () => escolherValor(valores[+b.dataset.i])));
    const outro = $('ltr-valor-outro');
    outro.addEventListener('keydown', e => { if (e.key === 'Enter' && outro.value) { e.preventDefault(); escolherValor(outro.value); } });
    $('ltr-volta2').addEventListener('click', () => { passo = 1; render(); });
    if (ehAdmin) { const eb = $('ltr-editar-valores'); if (eb) eb.addEventListener('click', abrirEditorValores); }
    setTimeout(() => { const f = stepBox.querySelector('.ltr-valbtn'); if (f) f.focus(); }, 40);
  }
  function escolherValor(sel) {
    const obj = (sel && typeof sel === 'object') ? sel : { valor: r2loc(+sel || 0), codigo: '', nome: '' };
    if (!(obj.valor > 0)) { toast('⚠ Valor inválido'); return; }
    valorSel = obj.valor; codigoSel = obj.codigo || ''; nomeSel = obj.nome || ''; passo = 3; render();
  }

  // Editor dos valores do F8 — só o admin chega aqui (o botão só aparece pra admin).
  function abrirEditorValores() {
    let edit = valores.map(v => v.valor);   // o editor mexe só nos NÚMEROS; o vínculo com o produto é refeito ao salvar
    stepBox.innerHTML = `
      <div class="ltr-passo">
        <div class="ltr-passo-n">✏️ Editar valores do açaí · <button class="ltr-voltar" id="ltr-edit-volta">‹ voltar</button></div>
        <p class="ltr-dica" style="text-align:left">São os atalhos de valor do F8. Só o administrador edita. Sem nenhum, o sistema usa os preços dos produtos.</p>
        <div class="ltr-editlista" id="ltr-editlista"></div>
        <div class="ltr-editadd">
          <input type="number" step="0.01" min="0" id="ltr-novo-valor" class="ltr-input-mini" placeholder="novo R$">
          <button class="crm-btn" id="ltr-add-valor">➕ Adicionar</button>
        </div>
        <button class="fin-btn-salvar" id="ltr-salvar-valores">💾 Salvar valores</button>
      </div>`;
    const renderLista = () => {
      $('ltr-editlista').innerHTML = edit.length ? edit.map((v, i) => `<div class="ltr-editrow"><b>${fmt(v)}</b><button class="ac-mini del" data-i="${i}" title="Remover">🗑</button></div>`).join('') : '<div class="ac-vazio">Nenhum valor — usará os preços dos produtos.</div>';
      $('ltr-editlista').querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { edit.splice(+b.dataset.i, 1); renderLista(); }));
    };
    renderLista();
    const addV = () => { const v = r2loc(+$('ltr-novo-valor').value || 0); if (!(v > 0)) { toast('⚠ Valor inválido'); return; } if (!edit.includes(v)) edit.push(v); edit.sort((a, b) => a - b); $('ltr-novo-valor').value = ''; renderLista(); $('ltr-novo-valor').focus(); };
    $('ltr-add-valor').addEventListener('click', addV);
    $('ltr-novo-valor').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addV(); } });
    $('ltr-edit-volta').addEventListener('click', () => { passo = 2; render(); });
    $('ltr-salvar-valores').addEventListener('click', async () => {
      const r = await (await fetch('/api/litros/valores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valores: edit }) })).json();
      if (r && r.erro) { toast('⚠ ' + r.erro); return; }
      // recarrega já no formato novo (com produto vinculado a cada valor)
      try { valores = normalizarValoresLitros(await (await fetch('/api/litros/valores', { cache: 'no-store' })).json()); } catch { valores = normalizarValoresLitros(edit); }
      toast('💾 Valores salvos'); passo = 2; render();
    });
    setTimeout(() => $('ltr-novo-valor').focus(), 50);
  }

  function renderPasso3() {
    const litTxt = (litros === 1) ? '1 litro' : `${biNum(litros)} litros`;
    stepBox.innerHTML = `
      <div class="ltr-passo ltr-passo-conf">
        <div class="ltr-passo-n">Passo 3 de 3 · confirmação</div>
        <div class="ltr-conf-grande">
          <div class="ltr-conf-q">?</div>
          <div class="ltr-conf-intro">Você está dando entrada de</div>
          <div class="ltr-conf-frase"><b class="ltr-conf-litros">${litTxt}</b> de <b class="ltr-conf-prod">${nomeSel || 'produto'}</b> <span class="ltr-conf-bullet">•</span> <b class="ltr-conf-valor">${fmt(valorSel)}</b>.</div>
          <div class="ltr-conf-pergunta">Posso registrar?</div>
        </div>
        <div class="ltr-conf-acoes">
          <button class="fin-btn-salvar ltr-btn-registrar" id="ltr-registrar">✅ Registrar (Enter)</button>
          <button class="crm-btn ltr-btn-editar" id="ltr-edit-litros">✏️ Editar litros</button>
          <button class="crm-btn ltr-btn-editar" id="ltr-edit-valor">✏️ Editar valor</button>
        </div>
      </div>`;
    setTimeout(() => $('ltr-registrar').focus(), 40);
    $('ltr-registrar').addEventListener('click', registrar);
    $('ltr-edit-litros').addEventListener('click', () => { passo = 1; render(); });
    $('ltr-edit-valor').addEventListener('click', () => { passo = 2; render(); });
  }

  async function registrar() {
    if (!(litros > 0 && valorSel > 0)) { toast('⚠ Preencha litros e valor'); return; }
    const r = await (await fetch('/api/litros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ litros, valor: valorSel, produto_codigo: codigoSel }) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    toast(`🫐 ${biNum(litros)} L de ${nomeSel || fmt(valorSel)} registrados`);
    fecharErpModal(); // fecha a tela inteira após confirmar — reabre no próximo F8
  }

  // Confirmação da ENTRADA DIRETA (fórmula digitada). Mostra os itens e só grava ao confirmar.
  let cfPosting = false;
  async function confirmarFormulaPost() {
    if (cfPosting) return; cfPosting = true;
    const itens = formulaPendente || [];
    let totalL = 0;
    for (const it of itens) {
      const r = await (await fetch('/api/litros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ litros: it.litros, valor: it.valor, produto_codigo: it.produto_codigo, gelado: 0 }) })).json();
      if (r && r.erro) { toast('⚠ ' + r.erro); cfPosting = false; return; }
      totalL += it.litros;
    }
    toast(`🫐 ${biNum(totalL)} L registrados`);
    formulaPendente = null; cfPosting = false; litros = 0; passo = 1; render(); carregarDia();
  }
  function renderConfirmFormula() {
    const itens = formulaPendente || [];
    const totalL = itens.reduce((s, it) => s + (+it.litros || 0), 0);
    const linhas = itens.map(it => {
      const nome = it.nome || (valores.find(v => v.codigo === it.produto_codigo) || {}).nome || it.produto_codigo || 'produto';
      return `<div class="ltr-conf-linha"><b>${biNum(it.litros)} L</b> · ${crmEsc(nome)} · ${fmt(it.valor)}</div>`;
    }).join('');
    stepBox.innerHTML = `
      <div class="ltr-passo ltr-passo-conf">
        <div class="ltr-passo-n">Confirmação · <button class="ltr-voltar" id="ltr-cf-volta">‹ editar (Shift+Enter)</button></div>
        <div class="ltr-conf-grande">
          <div class="ltr-conf-q">?</div>
          <div class="ltr-conf-intro">Você está dando entrada de</div>
          <div class="ltr-conf-itens">${linhas}</div>
          <div class="ltr-conf-frase">Total: <b class="ltr-conf-litros">${biNum(totalL)} L</b></div>
          <div class="ltr-conf-pergunta">Posso registrar?</div>
        </div>
        <div class="ltr-conf-acoes">
          <button class="fin-btn-salvar ltr-btn-registrar" id="ltr-cf-ok">✅ Registrar (Enter)</button>
          <button class="crm-btn ltr-btn-editar" id="ltr-cf-editar">✏️ Editar</button>
        </div>
      </div>`;
    setTimeout(() => { const b = $('ltr-cf-ok'); if (b) b.focus(); }, 40);
    $('ltr-cf-ok').addEventListener('click', confirmarFormulaPost);
    $('ltr-cf-editar').addEventListener('click', () => { passo = 1; render(); });
    $('ltr-cf-volta').addEventListener('click', () => { passo = 1; render(); });
  }

  // Teclado do fluxo: no passo 2, teclas 1–9 escolhem o valor; no passo 3, Enter registra.
  wrap.addEventListener('keydown', e => {
    const ae = document.activeElement;
    if (passo === 2 && /^[1-9]$/.test(e.key)) {
      if (ae && ae.tagName === 'INPUT') return; // digitando num campo (outro valor / editor) — não sequestra
      const btn = stepBox.querySelectorAll('.ltr-valbtn')[+e.key - 1]; if (btn) { e.preventDefault(); btn.click(); }
    } else if (passo === 3 && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); registrar(); }
    else if (passo === 'confF' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmarFormulaPost(); }
    else if (passo === 'confL' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmarLataPost(); }
  });

  // 🧊 SOBROU GELADO — mesma lógica de digitar dos litros: tecla os litros e Enter (ou litros*código).
  //    Registra como GELADO (não conta no total, fica pro dia seguinte).
  async function registrarGelado() {
    const raw = ($('ltr-gelado-qtd').value || '').trim(); if (!raw) return;
    // FÓRMULA (mesma lógica do registro): "5*15+2*10" = 5 L do código 15 + 2 L do código 10.
    const termos = raw.split('+').map(t => t.trim()).filter(Boolean);
    const itens = [];
    for (const t of termos) {
      let qtd, cod = '';
      if (t.includes('*')) { const [q, c] = t.split('*'); qtd = parseFloat(String(q).replace(',', '.')); cod = String(c || '').trim(); }
      else qtd = parseFloat(t.replace(',', '.'));
      if (!(qtd > 0)) { toast('⚠ Fórmula inválida em "' + t + '"'); $('ltr-gelado-qtd').focus(); return; }
      let valor = 0;
      if (cod) { const obj = valores.find(v => v.codigo && String(v.codigo).toLowerCase() === cod.toLowerCase()); if (obj) valor = obj.valor; }
      itens.push({ litros: r2loc(qtd), valor, produto_codigo: cod, gelado: 1 });
    }
    let totalL = 0;
    for (const it of itens) { const r = await (await fetch('/api/litros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(it) })).json(); if (r && r.erro) { toast('⚠ ' + r.erro); return; } totalL += it.litros; }
    toast(`🧊 ${biNum(totalL)} L de sobra gelada registrados (não contam)`);
    $('ltr-gelado-qtd').value = ''; $('ltr-gelado-qtd').focus(); carregarDia();
  }
  // gelado: Enter no campo → FOCA o botão "registrar" (aí Enter/clique registra)
  $('ltr-gelado-qtd').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); $('ltr-gelado-add').focus(); }
    else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const t = $('ltr-lata-qtd'); if (t) t.focus(); }   // Tab: gelado → latas
    else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); const t = $('ltr-litros'); if (t) t.focus(); }       // Shift+Tab: gelado → registro
  });
  $('ltr-gelado-add').addEventListener('click', registrarGelado);

  // 🥫 LATAS — fluxo por Enter: quantidade → Enter vai pro VALOR → Enter registra. Soma no dia.
  const latasVarPreco = () => { const c = $('ltr-lata-varpreco'); return !!(c && c.checked); };
  async function adicionarLata() {
    const raw = ($('ltr-lata-qtd').value || '').trim(); if (!raw) { $('ltr-lata-qtd').focus(); return; }
    const qtd = parseFloat(raw.replace(',', '.'));
    if (!(qtd > 0)) { toast('⚠ Informe quantas latas'); $('ltr-lata-qtd').focus(); return; }
    const valor = latasVarPreco() ? (parseFloat(($('ltr-lata-valor').value || '').replace(',', '.')) || 0) : 0;   // preço só quando "preço variado"; senão o custo é no processamento
    // pedido do Melque: as latas também passam pela tela de confirmação antes de gravar
    latasPendente = { qtd, valor }; passo = 'confL'; render();
  }
  let clPosting = false;
  async function confirmarLataPost() {
    if (clPosting) return; clPosting = true;
    const p = latasPendente || {};
    const r = await (await fetch('/api/latas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qtd: p.qtd, valor: p.valor || 0 }) })).json();
    clPosting = false;
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    toast(`🥫 ${biNum(p.qtd)} lata(s) registrada(s)`);
    latasPendente = null; { const a = $('ltr-lata-qtd'), b = $('ltr-lata-valor'); if (a) a.value = ''; if (b) b.value = ''; }
    passo = 1; render(); carregarLatas();
    setTimeout(() => { const e = $('ltr-lata-qtd'); if (e) e.focus(); }, 60);
  }
  function renderConfirmLatas() {
    const p = latasPendente || {};
    const vtxt = (+p.valor > 0) ? ` <span class="ltr-conf-bullet">•</span> <b class="ltr-conf-valor">${fmt(p.valor)} cada</b>` : '';
    stepBox.innerHTML = `
      <div class="ltr-passo ltr-passo-conf">
        <div class="ltr-passo-n">Confirmação · <button class="ltr-voltar" id="ltr-cl-volta">‹ editar (Shift+Enter)</button></div>
        <div class="ltr-conf-grande">
          <div class="ltr-conf-q">🥫</div>
          <div class="ltr-conf-intro">Você está dando entrada de</div>
          <div class="ltr-conf-frase"><b class="ltr-conf-litros">${biNum(p.qtd)} lata(s)</b>${vtxt}</div>
          <div class="ltr-conf-pergunta">Posso registrar?</div>
        </div>
        <div class="ltr-conf-acoes">
          <button class="fin-btn-salvar ltr-btn-registrar" id="ltr-cl-ok">✅ Registrar (Enter)</button>
          <button class="crm-btn ltr-btn-editar" id="ltr-cl-editar">✏️ Editar</button>
        </div>
      </div>`;
    setTimeout(() => { const b = $('ltr-cl-ok'); if (b) b.focus(); }, 40);
    $('ltr-cl-ok').addEventListener('click', confirmarLataPost);
    const volta = () => { latasPendente = null; passo = 1; render(); setTimeout(() => { const e = $('ltr-lata-qtd'); if (e) e.focus(); }, 50); };
    $('ltr-cl-editar').addEventListener('click', volta);
    $('ltr-cl-volta').addEventListener('click', volta);
  }
  $('ltr-lata-qtd').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (latasVarPreco()) $('ltr-lata-valor').focus(); else adicionarLata(); }
    else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); const t = $('ltr-gelado-qtd'); if (t) t.focus(); }   // Shift+Tab: latas → gelado
  });
  $('ltr-lata-valor').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); adicionarLata(); } });
  $('ltr-lata-add').addEventListener('click', adicionarLata);
  { const cb = $('ltr-lata-varpreco'); if (cb) cb.addEventListener('change', () => { const v = $('ltr-lata-valor'); if (v) { v.style.display = cb.checked ? '' : 'none'; if (!cb.checked) v.value = ''; } }); }
  async function carregarLatas() {
    let d; try { d = await (await fetch('/api/latas', { cache: 'no-store' })).json(); } catch { $('ltr-latas-lista').innerHTML = ''; return; }
    latasTotal = +d.total || 0;
    const lista = d.lista || [];
    let somaValor = 0, somaQtd = 0;
    for (const x of lista) { const v = +x.valor_unit || 0; if (v > 0) { somaValor += v * (+x.qtd || 0); somaQtd += (+x.qtd || 0); } }
    latasValorMedio = somaQtd > 0 ? r2loc(somaValor / somaQtd) : 0;
    if (!lista.length) { $('ltr-latas-lista').innerHTML = `<div class="ltr-latas-vazio">Nenhuma lata ainda hoje — adicione acima.</div>`; return; }
    // Só a ÚLTIMA entrada aparece (a SOMA fica no card do topo); botão "ver todas" (não amontoa)
    const rowHtml = x => {
      const hora = x.criado_em ? new Date(x.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      const v = +x.valor_unit || 0; const vtxt = v > 0 ? ' · ' + fmt(v) : '';
      return `<div class="ltr-item ltr-item-lata"><span class="ltr-item-hora">🕒 ${hora}</span><span class="ltr-item-desc">🥫 <b>${biNum(x.qtd)}</b> lata(s)${vtxt}</span><button class="ac-mini del" data-dellata="${x.id}" title="Remover">🗑</button></div>`;
    };
    const porData = lista.slice().sort((a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0));
    const n = porData.length;
    let labelHtml = '', rowsHtml = '', btnHtml = '';
    if (n === 1) rowsHtml = rowHtml(porData[0]);
    else if (!latasExpandido) {
      const resto = porData.slice(1);
      const somaResto = resto.reduce((s, x) => s + (+x.qtd || 0), 0);
      labelHtml = '<div class="ltr-ultimo-lbl">🆕 Última entrada</div>';
      rowsHtml = rowHtml(porData[0]);
      btnHtml = `<button type="button" class="ltr-ver-todas" id="ltr-latas-vertodas">📋 Ver todas as latas do dia <span class="ltr-vt-tag">+${resto.length} · ${biNum(somaResto)} lata(s)</span></button>`;
    } else {
      rowsHtml = porData.map(rowHtml).join('');
      btnHtml = `<button type="button" class="ltr-ver-todas recolher" id="ltr-latas-recolher">▲ Recolher (mostrar só a última)</button>`;
    }
    $('ltr-latas-lista').innerHTML = `
      <div class="ltr-latas-card">
        <div class="ltr-latas-ico">🥫</div>
        <div style="flex:1"><div class="ltr-latas-lbl">Total do dia</div><div class="ltr-latas-big"><b>${biNum(latasTotal)}</b> lata(s)</div></div>
        ${somaValor > 0 ? `<div class="ltr-latas-valor">${fmt(somaValor)}</div>` : ''}
      </div>
      ${labelHtml}<div class="ltr-latas-itens ltr-rows${latasExpandido ? ' expandida' : ''}">${rowsHtml}</div>${btnHtml}`;
    $('ltr-latas-lista').querySelectorAll('[data-dellata]').forEach(b => b.addEventListener('click', async () => { await fetch('/api/latas/' + b.dataset.dellata, { method: 'DELETE' }); carregarLatas(); }));
    { const vt = $('ltr-latas-vertodas'); if (vt) vt.addEventListener('click', () => { latasExpandido = true; carregarLatas(); }); }
    { const rc = $('ltr-latas-recolher'); if (rc) rc.addEventListener('click', () => { latasExpandido = false; carregarLatas(); }); }
  }
  carregarLatas();

  // 🏁 FINALIZAR — NÃO dá baixa aqui. Vai pra tela de rendimento (o lucro aparece LÁ);
  //    a baixa (litros + latas + gelado somem) só acontece quando você GRAVAR o rendimento.
  $('ltr-fx-ok').addEventListener('click', async () => {
    const rz = diaResumo || {};
    if (!(rz.totalLitros > 0)) { toast('🫐 Nenhum litro pra finalizar. Lance a produção primeiro.'); const li = $('ltr-litros'); if (li) li.focus(); return; }
    if (!(latasTotal > 0)) { toast('🥫 Adicione as latas do dia antes de finalizar'); $('ltr-lata-qtd').focus(); return; }
    let lucro = null; try { lucro = await (await fetch('/api/latas/lucro', { cache: 'no-store' })).json(); } catch {}
    litrosFechamentoPendente = { sacas: latasTotal, valorSaca: latasValorMedio || 0, resumo: rz, lucro };
    litrosBaixaPendente = true;   // a baixa só acontece ao GRAVAR o rendimento
    { const ta = document.querySelector('.tela.ativa'); telaAntesRendimento = ta ? ta.id.replace('tela-', '') : 'pdv'; }   // pra ESC voltar
    fecharErpModal();
    irPara('produtos');
    setTimeout(() => { try { abrirRendimento(); preencherRendimentoDeLitros(); } catch (e) { toast('Abra "Processar em vários produtos" pra concluir.'); } }, 400);
  });
  let ltrExpandido = false;   // por padrão mostra só o último lançamento; botão expande a lista toda
  let latasExpandido = false; // idem pra lista de latas do dia (não amontoar)
  render();
  carregarDia();
  async function carregarDia() {
    let d; try { d = await (await fetch('/api/litros', { cache: 'no-store' })).json(); } catch { $('ltr-lista').innerHTML = biErro(); return; }
    const rz = d.resumo || {};
    diaResumo = rz;   // deixa o "Fechar o dia" saber quanto foi produzido
    { const box = $('ltr-fechar-box'); if (box) box.classList.toggle('ltr-fechar-vazio', !(rz.totalLitros > 0)); }
    // CADA valor/tipo de açaí ganha uma COR predominante própria (o gelado mantém o azul dele)
    const chaveCor = x => x.produto_codigo ? ('c' + x.produto_codigo) : ('v' + (r2loc(+x.valor_unit || 0)));
    const chaveCorChip = p => p.codigo ? ('c' + p.codigo) : ('v' + (r2loc(+p.valor || 0)));
    const distintas = [...new Set((d.lista || []).filter(x => !x.gelado).map(chaveCor))].sort();
    const corDe = k => LTR_PALETA[distintas.indexOf(k) % LTR_PALETA.length] || LTR_PALETA[0];
    // chips do resumo com a MESMA cor de cada tipo (viram legenda)
    const porValor = (rz.porValor || []).map(p => { const c = corDe(chaveCorChip(p)); return `<span class="ltr-chip" style="background:${c.bg};border-color:${c.bd};color:${c.tx}">${p.nome ? p.nome + ' · ' : ''}${fmt(p.valor)}: <b>${biNum(p.litros)} L</b></span>`; }).join('');
    const rowHtml = x => {
      const hora = x.criado_em ? new Date(x.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      const prod = x.produto_codigo ? PRODUTOS.find(p => p.codigo === x.produto_codigo) : null;
      const nome = prod ? prod.nome : '';
      if (x.gelado) {
        const desc = `<b>${biNum(x.litros)} L</b> · 🧊 gelado (não conta)${nome ? ' · ' + nome : ''}`;
        return `<div class="ltr-item ltr-item-gelado"><span class="ltr-item-hora">🕒 ${hora}</span><span class="ltr-item-desc">${desc}</span><button class="ac-mini del" data-del="${x.id}" title="Remover">🗑</button></div>`;
      }
      const desc = `<b>${biNum(x.litros)} L</b> · ${nome ? nome + ' · ' : ''}${fmt(x.valor_unit)}`;
      const c = corDe(chaveCor(x));
      return `<div class="ltr-item ltr-item-cor" style="background:${c.bg};border-color:${c.bd};color:${c.tx}"><span class="ltr-item-hora">🕒 ${hora}</span><span class="ltr-item-desc">${desc}</span><button class="ac-mini del" data-del="${x.id}" title="Remover">🗑</button></div>`;
    };
    const bruto = +rz.totalBruto || +rz.totalLitros || 0, gel = +rz.geladoLitros || 0, net = +rz.totalLitros || 0;
    const totalTxt = gel > 0
      ? `Produzido: <b>${biNum(bruto)} L</b> · 🧊 gelado: <b>${biNum(gel)} L</b> · ✅ a processar: <b>${biNum(net)} L</b>`
      : `Total: <b>${biNum(net)} litros</b>`;
    // Só o ÚLTIMO lançamento aparece; o resto fica somado no total acima, com botão pra ver tudo.
    const porData = (d.lista || []).slice().sort((a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0));
    const n = porData.length;
    let labelHtml = '', rowsHtml = '', btnHtml = '';
    if (n === 0) rowsHtml = '<div class="ac-vazio">Nada ainda hoje.</div>';
    else if (!ltrExpandido && n > 1) {
      const resto = porData.slice(1);
      const somaResto = resto.reduce((s, x) => s + (x.gelado ? 0 : (+x.litros || 0)), 0);
      labelHtml = '<div class="ltr-ultimo-lbl">🆕 Último lançamento</div>';
      rowsHtml = rowHtml(porData[0]);
      btnHtml = `<button type="button" class="ltr-ver-todas" id="ltr-ver-todas">📋 Ver todas as entradas do dia <span class="ltr-vt-tag">+${resto.length} · ${biNum(somaResto)} L</span></button>`;
    } else {
      rowsHtml = porData.map(rowHtml).join('');
      if (n > 1) btnHtml = `<button type="button" class="ltr-ver-todas recolher" id="ltr-recolher">▲ Recolher (mostrar só o último)</button>`;
    }
    // as LINHAS ficam num container que ROLA quando expandido (não corta nada)
    $('ltr-lista').innerHTML = `<div class="ltr-total">${totalTxt}</div><div class="ltr-porvalor">${porValor}</div>${labelHtml}<div class="ltr-rows${ltrExpandido ? ' expandida' : ''}">${rowsHtml}</div>${btnHtml}`;
    $('ltr-lista').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { await fetch('/api/litros/' + b.dataset.del, { method: 'DELETE' }); carregarDia(); }));
    { const vt = $('ltr-ver-todas'); if (vt) vt.addEventListener('click', () => { ltrExpandido = true; carregarDia(); }); }
    { const rc = $('ltr-recolher'); if (rc) rc.addEventListener('click', () => { ltrExpandido = false; carregarDia(); }); }
  }
}
/* 🧊 Açaí que sobrou GELADO: registra a sobra pra controle, mas NÃO entra na contagem do dia
   (desconsiderado do total e do F10). Reabre o F8 já com a sobra listada à parte. */
async function abrirLitrosGelado() {
  let valores = []; try { valores = normalizarValoresLitros(await (await fetch('/api/litros/valores', { cache: 'no-store' })).json()); } catch {}
  const opts = valores.map(v => `<option value="${v.codigo || ''}" data-valor="${v.valor}">${(v.nome ? v.nome + ' · ' : '') + fmt(v.valor)}</option>`).join('');
  abrirErpModal(`<h3 class="erp-modal-tit">🧊 Açaí que sobrou gelado</h3>
    <form id="gel-form" class="fin-form">
      <p class="fin-hint">Registre o açaí que ficou <b>gelado</b> (sobra do dia). Ele fica só pro seu controle — <b>NÃO entra na contagem</b> nem no fechamento (F10).</p>
      <label>Litros que sobraram <small>(gelado)</small><input type="number" step="0.01" min="0.01" id="gel-litros" class="op-mov-vinput" inputmode="decimal" autocomplete="off" placeholder="ex.: 4"></label>
      <label>Qual açaí? <small>(opcional)</small><select id="gel-prod"><option value="">— não especificar —</option>${opts}</select></label>
      <button type="submit" class="fin-btn-salvar">🧊 Registrar sobra gelada</button>
    </form>`);
  $('modal-erp-box').classList.add('erp-mov');   // reaproveita o visual azul
  const inp = $('gel-litros'); setTimeout(() => inp.focus(), 60);
  $('gel-form').addEventListener('submit', async e => {
    e.preventDefault();
    const litros = parseFloat((inp.value || '').replace(',', '.')) || 0;
    if (!(litros > 0)) { toast('⚠ Informe os litros que sobraram'); inp.focus(); return; }
    const sel = $('gel-prod'), cod = sel.value || '';
    const valor = cod ? (+sel.options[sel.selectedIndex].dataset.valor || 0) : 0;
    const r = await (await fetch('/api/litros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ litros, valor, produto_codigo: cod, gelado: 1 }) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    toast(`🧊 ${biNum(litros)} L de sobra gelada registrados (não contam)`);
    fecharErpModal(); abrirLitros();   // reabre o F8 com a sobra listada à parte
  });
}
/* O "fechar o dia" foi ACOPLADO dentro do F8 (🫐 Açaí do dia) e a tecla F10 foi liberada.
   Esta função virou um atalho: qualquer referência antiga abre a tela mesclada. */
function abrirFechamentoLitros() { abrirLitros(); }
let litrosFechamentoPendente = null;
let litrosBaixaPendente = false;   // true depois do "Finalizar": a baixa (litros/latas/gelado) só ocorre ao GRAVAR o rendimento
let telaAntesRendimento = null;    // tela de onde veio o Finalizar — ESC/fechar o rendimento volta pra ela
let consumoInternoDia = 0;         // consumo interno do dia a PREÇO DE VENDA — só pra MOSTRAR (valor consumido)
let consumoInternoCustoDia = 0;    // consumo interno do dia a CUSTO — é o que REALMENTE desconta do lucro
// Um produto é "de açaí" se o nome ou o departamento tiver "açaí"/"acai" (ignora acento/maiúscula).
// Serve pra o F10 casar litros→produto SEM pescar Farinha/complemento que tenha o mesmo preço.
function ehProdutoAcai(p) {
  const t = (((p && p.nome) || '') + ' ' + ((p && p.departamento) || '')).toLowerCase();
  return t.includes('açaí') || t.includes('açai') || t.includes('acaí') || t.includes('acai');
}
// Pré-preenche o rendimento a partir do fechamento dos litros: sacas → matéria-prima (entrada);
// cada valor → uma linha de saída (litros na qtd, preço = valor; produto = o gravado no F8, ou açaí de mesmo preço).
function preencherRendimentoDeLitros() {
  if (!litrosFechamentoPendente) return;
  const { sacas, valorSaca, resumo } = litrosFechamentoPendente;
  if (!$('rend-materia').value.trim()) $('rend-materia').value = 'Açaí (lata)';
  $('rend-qtd-materia').value = sacas || 1;
  if (valorSaca > 0) $('rend-valor-unit').value = valorSaca;
  calcularTotalRendimento();
  const porValor = (resumo && resumo.porValor) || [];
  if (porValor.length) {
    $('rend-linhas').innerHTML = '';
    // MESMA cor de cada valor/tipo do F8 (identidade visual continua no rendimento)
    const chaveCorChip = p => p.codigo ? ('c' + p.codigo) : ('v' + (r2loc(+p.valor || 0)));
    const distintasR = [...new Set(porValor.map(chaveCorChip))].sort();
    const corDeR = k => LTR_PALETA[distintasR.indexOf(k) % LTR_PALETA.length] || LTR_PALETA[0];
    porValor.forEach(pv => {
      addLinhaRendimento();
      const linha = $('rend-linhas').lastElementChild;
      // 1º o produto EXATO gravado no F8; se não houver (lançamento antigo), casa por preço
      // SÓ entre produtos de AÇAÍ (nunca Farinha/complemento, mesmo com preço igual).
      let prod = pv.codigo ? PRODUTOS.find(p => p.codigo === pv.codigo) : null;
      if (!prod) prod = PRODUTOS.find(p => ehProdutoAcai(p) && Math.abs((+p.precoVenda || 0) - (+pv.valor || 0)) < 0.005);
      if (prod) { linha.querySelector('.rl-cod').value = prod.codigo; linha.querySelector('.rl-desc').value = prod.nome; }
      linha.querySelector('.rl-preco').value = pv.valor;
      linha.querySelector('.rl-qtd').value = pv.litros;
      const c = corDeR(chaveCorChip(pv));   // faixa lateral + fundo tênue (não mexe no layout)
      linha.classList.add('rend-linha-cor');
      linha.style.background = c.bg;
      linha.style.boxShadow = 'inset 6px 0 0 ' + c.tx;
    });
    recalcularRendimento();
  }
  // troca o "Custo alocado" pelo LUCRO; a barra ao vivo mostra receita − custo − consumo interno
  { const ab = $('rend-r-aloc-box'); if (ab) ab.style.display = 'none'; }
  const _l = litrosFechamentoPendente.lucro || {};
  consumoInternoDia = +_l.consumoInterno || 0;            // valor consumido (preço de venda) — só mostra
  consumoInternoCustoDia = +_l.consumoInternoCusto || 0;  // custo — é o que desconta
  recalcularRendimento();   // recalcula o lucro descontando o CUSTO do consumo interno
  toast(`🫐 ${biNum(sacas)} lata(s) → ${porValor.length} saída(s) preenchida(s). Confira e grave.`);
  litrosFechamentoPendente = null;
}
// Alt+F → Finalizar / dar entrada. Fica em CAPTURA no window (roda antes de qualquer outro
// handler e antes do navegador tratar o Alt) e checa e.code (com Alt o e.key pode variar).
window.addEventListener('keydown', e => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (!(e.code === 'KeyF' || e.key === 'f' || e.key === 'F' || e.key === 'ƒ')) return;
  if ($('app-principal') && $('app-principal').classList.contains('oculto')) return;
  const rendAberto = $('overlay-rendimento') && $('overlay-rendimento').classList.contains('aberto');
  if (rendAberto) { const b = $('btn-confirmar-rend'); e.preventDefault(); e.stopPropagation(); if (b && !b.disabled) b.click(); return; }
  const btnFin = $('overlay-erp') && $('overlay-erp').classList.contains('aberto') && $('ltr-fx-ok');
  if (btnFin) { e.preventDefault(); e.stopPropagation(); btnFin.click(); return; }
}, true);
// Atalhos operacionais: F9 abre Vendas (de qualquer tela) · F8 Litros · F10 Fecha dia · C Consumo · S Sangria/Suprimento.
document.addEventListener('keydown', e => {
  if ($('app-principal').classList.contains('oculto')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // MODO CANCELAR ITENS — teclado puro. ↑↓ escolhe o item · Enter abre a CONFIRMAÇÃO.
  // Na confirmação: Enter cancela o item · Esc volta pra lista. I/Esc saem do modo.
  if (modoCancelarItens) {
    if (cancelConfirmOpen) {
      if (e.key === 'Enter')  { e.preventDefault(); confirmarCancelarItem(); return; }
      if (e.key === 'Escape') { e.preventDefault(); fecharConfirmCancelar(); return; }
      e.preventDefault(); return;
    }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moverCursorCancelar(-1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); moverCursorCancelar(1); return; }
    if (e.key === 'Enter')     { e.preventDefault(); abrirConfirmCancelar(cancelCursor); return; }
    if (e.key === 'Escape' || e.key === 'i' || e.key === 'I') { e.preventDefault(); sairModoCancelarItens(); return; }
    e.preventDefault(); return;
  }
  // F9 → abrir a tela de VENDAS de qualquer lugar (não fica preso em modal aberto)
  if (e.key === 'F9') { if (algumOverlayAberto && algumOverlayAberto()) return; e.preventDefault(); irPara('pdv'); focusCodigoMercadoria(); return; }
  // F3 → abrir a tela de PRODUTOS (entrada de mercadoria/estoque) de qualquer lugar
  if (e.key === 'F3') { if (algumOverlayAberto && algumOverlayAberto()) return; e.preventDefault(); irPara('produtos'); return; }
  // F2 → abrir a tela de CLIENTES de qualquer lugar (era F4; unificado no F2 a pedido)
  if (e.key === 'F2') { if (algumOverlayAberto && algumOverlayAberto()) return; e.preventDefault(); irPara('clientes'); return; }
  if (algumOverlayAberto && algumOverlayAberto()) return;
  if ($('overlay-erp') && $('overlay-erp').classList.contains('aberto')) return;
  const naOperacao = $('tela-pdv').classList.contains('ativa');
  if (e.key === 'F8') { e.preventDefault(); abrirLitros(); return; }         // F8 → entrada de LITROS produzidos (sangria foi pro menu S)
  // F10 LIBERADO — o "fechar o dia" agora fica DENTRO do F8 (🫐 Açaí do dia). A tecla ficou livre.
  // I → MODO CANCELAR ITENS (seleciona itens do cupom pra cancelar). Só no PDV, campo de código vazio.
  if ((e.key === 'i' || e.key === 'I') && naOperacao) {
    const cod = $('codigo');
    if (cod && cod.value.trim() !== '') return;
    const ativo = document.activeElement;
    if (ativo && ativo !== cod && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName)) return;
    e.preventDefault();
    modoCancelarItens ? sairModoCancelarItens() : entrarModoCancelarItens();   // I liga/desliga
    return;
  }
  // C → Consumo Interno · S → ações financeiras (Sangria/Suprimento). Só no PDV e com o campo
  // de código VAZIO (não atrapalha quem digita códigos com letras — princípio do duplo-espaço).
  if ((e.key === 'c' || e.key === 'C' || e.key === 's' || e.key === 'S') && naOperacao) {
    const cod = $('codigo');
    if (cod && cod.value.trim() !== '') return;            // tem código digitado → deixa a letra ir pro campo
    const ativo = document.activeElement;
    if (ativo && ativo !== cod && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName)) return; // digitando em outro campo
    e.preventDefault();
    if (e.key === 'c' || e.key === 'C') abrirConsumoInterno();
    else abrirAcoesFinanceiras();
  }
});
// Barra de atalhos do PDV como BOTÕES clicáveis (mesmos atalhos de teclado, agora visíveis).
{
  const bar = $('pdv-atalhos');
  if (bar) bar.addEventListener('click', e => {
    const b = e.target.closest('.pdv-atbtn'); if (!b) return;
    const acoes = {
      vendas: () => irPara('pdv'),
      recebimento: () => finalizarVenda(),
      produtos: () => irPara('produtos'),
      clientes: () => irPara('clientes'),
      litros: () => abrirLitros(),
      sangria: () => abrirSangria(),
      suprimento: () => abrirSuprimento(),
      consumo: () => abrirConsumoInterno(),
      fechardia: () => abrirFechamentoLitros(),
    };
    const fn = acoes[b.dataset.act]; if (fn) { try { fn(); } catch (err) { console.error('atalho', b.dataset.act, err); } }
  });
}
// Etapa 2 (regra 5/6): atalho S abre o menu de ações financeiras — Sangria e Suprimento
// só aparecem quando solicitados (PDV limpo). Teclas 1/2 escolhem; ESC fecha.
function abrirAcoesFinanceiras() {
  abrirErpModal(`<h3 class="erp-modal-tit">💰 Ações financeiras do caixa</h3>
    <div class="op-acoes-fin">
      <button class="ds-btn opaf" id="opaf-sangria"><span class="opaf-ic">➖</span><span class="opaf-tx"><b>Sangria</b><small>retirada do caixa</small></span><span class="opaf-kb">1</span></button>
      <button class="ds-btn opaf" id="opaf-supr"><span class="opaf-ic">➕</span><span class="opaf-tx"><b>Suprimento</b><small>entrada no caixa</small></span><span class="opaf-kb">2</span></button>
    </div>
    <p class="fin-hint">Atalhos: <b>1</b> Sangria · <b>2</b> Suprimento · <b>ESC</b> fecha. (F8/F9 continuam funcionando.)</p>`);
  $('modal-erp-box').classList.add('erp-ci', 'erp-acaofin');   // paleta clara padrão
  const teclas = e2 => {
    if (e2.key === '1') { e2.preventDefault(); irAcao(abrirSangria); }
    else if (e2.key === '2') { e2.preventDefault(); irAcao(abrirSuprimento); }
    else if (e2.key === 'Escape') { limparTeclas(); }
  };
  const limparTeclas = () => document.removeEventListener('keydown', teclas, true);
  // BUGFIX: SEMPRE remover o listener de 1/2 ao sair (senão, no form de suprimento, digitar
  // um valor começando com "1" era capturado e pulava pra Sangria). Vale p/ clique, tecla, X, ESC.
  const irAcao = (fn) => { limparTeclas(); fecharErpModal(); fn(); };
  erpOnClose = limparTeclas;   // qualquer fechamento do modal (X, clique fora, ESC) tira o listener
  $('opaf-sangria').addEventListener('click', () => irAcao(abrirSangria));
  $('opaf-supr').addEventListener('click', () => irAcao(abrirSuprimento));
  document.addEventListener('keydown', teclas, true);
}
function podeOperarCaixa() { return !!usuarioAtual; } // qualquer logado tem caixa próprio (o backend valida gateCaixa)

/* Etapa 2 (regra 6): a barra inferior fixa foi REMOVIDA — o PDV fica limpo.
   As ações vivem nos atalhos (V, C, S→Sangria/Suprimento, F8/F9) e na sidebar (1 clique). */
// Saída visível do modo operação (ESC também sai — handler global já cobre).
{ const b = $('btn-sair-operacao'); if (b) b.addEventListener('click', () => irPara('home')); }

/* ── INDICADORES VISUAIS DE STATUS (Fase 46A §15) — WhatsApp / Caixa / IA na topbar ── */
let indicadoresTimer = null;
async function atualizarIndicadores() {
  const box = $('status-cluster'); if (!box || !usuarioAtual) return;
  const [wpp, caixa, loja] = await Promise.all([
    fetch('/api/whatsapp/status', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch('/api/caixa/atual', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch('/api/loja/estado', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
  ]);
  if (caixa) caixaAtualCache = caixa;
  const caixaAberto = !!(caixa && caixa.id && caixa.status === 'aberto');
  const ind = (txt, estado, title) => `<span class="status-ind" title="${title}"><span class="status-dot ${estado}"></span><span class="status-txt">${txt}</span></span>`;
  let html = '';
  if (wpp) html += ind('WhatsApp', wpp.pronto ? 'on' : 'off', wpp.pronto ? 'WhatsApp conectado' : 'WhatsApp desconectado');
  if (wpp && wpp.pronto) { try { waFilaFlush(); } catch {} } // Etapa 2 (regra 9): reconectou → sincroniza a fila
  if (caixa) html += ind('Caixa', caixaAberto ? 'on' : 'off', caixaAberto ? 'Caixa aberto' : 'Caixa fechado');
  if (loja) html += ind('IA', loja.iaAuto ? 'on' : 'off', loja.iaAuto ? 'IA automática ativa' : 'IA automática pausada');
  box.innerHTML = html;
}
function iniciarIndicadores() { atualizarIndicadores(); if (!indicadoresTimer) indicadoresTimer = setInterval(atualizarIndicadores, 15000); }
function pararIndicadores() { if (indicadoresTimer) { clearInterval(indicadoresTimer); indicadoresTimer = null; } const b = $('status-cluster'); if (b) b.innerHTML = ''; }

/* ── ETAPA 2 (regras 9/10) — FILA DE SINCRONIZAÇÃO WHATSAPP + NÚMEROS AUTORIZADOS ──
   WhatsApp desconectado → envios entram na fila (localStorage) e sincronizam
   sozinhos quando reconectar (o poll de indicadores já checa o status a cada 15s).
   Números autorizados recebem o RELATÓRIO DE FECHAMENTO automaticamente.
   Reusa o endpoint existente /api/whatsapp/enviar — nenhum banco/API alterado. */
const NUMS_FECH_KEY = 'acai_nums_fechamento';
const WA_FILA_KEY = 'acai_wa_fila';
function numsFechamento() { try { const l = JSON.parse(localStorage.getItem(NUMS_FECH_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } }
function salvarNumsFechamento(l) { try { localStorage.setItem(NUMS_FECH_KEY, JSON.stringify(l)); } catch {} }
function waFila() { try { const f = JSON.parse(localStorage.getItem(WA_FILA_KEY) || '[]'); return Array.isArray(f) ? f : []; } catch { return []; } }
function waFilaSalvar(f) { try { localStorage.setItem(WA_FILA_KEY, JSON.stringify(f.slice(-50))); } catch {} }
async function waEnviarOuEnfileirar(telefone, mensagem) {
  try {
    const r = await (await fetch('/api/whatsapp/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telefone, mensagem }) })).json();
    if (r && r.ok) return { ok: true };
    throw new Error((r && r.erro) || 'falha no envio');
  } catch {
    const f = waFila(); f.push({ telefone, mensagem, criado: new Date().toISOString() }); waFilaSalvar(f);
    return { ok: false, enfileirado: true };
  }
}
let waFlushando = false;
async function waFilaFlush() {
  if (waFlushando) return;
  const f = waFila(); if (!f.length) return;
  waFlushando = true;
  try {
    const resta = [];
    for (const m of f) {
      try { const r = await (await fetch('/api/whatsapp/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telefone: m.telefone, mensagem: m.mensagem }) })).json(); if (!r || !r.ok) resta.push(m); }
      catch { resta.push(m); }
    }
    waFilaSalvar(resta);
    if (resta.length < f.length) toast(`📤 Fila WhatsApp: ${f.length - resta.length} mensagem(ns) sincronizada(s)`);
  } finally { waFlushando = false; }
}
// Relatório de fechamento → números autorizados (fila automática se offline).
function montarRelatorioFechamento(r) {
  const linhas = [
    `🌅 *FECHAMENTO ${r.modo === 'consolidado' ? 'DO DIA' : 'DO PERÍODO'}* — ${r.data || ''} ${r.periodo_label || r.periodo || ''}`.trim(),
    `👤 Operador: ${r.operador ? nomeOp(r.operador) : ((usuarioAtual && usuarioAtual.nome) || '—')}`,
    `🥥 Sacas usadas: ${r.sacas_usadas != null ? r.sacas_usadas : 0}`,
    `🥤 Litros produzidos: ${r.litros_totais != null ? r.litros_totais : '—'} (P ${r.litros_popular || 0} · M ${r.litros_medio || 0} · G ${r.litros_grosso || 0})`,
    `📦 Restante físico: P ${r.restante_popular || 0} · M ${r.restante_medio || 0} · G ${r.restante_grosso || 0}`,
    `⚖️ Divergência total: ${r.divergencia_total != null ? r.divergencia_total : '—'}`,
  ];
  if (r.custo_mp != null) linhas.push(`💰 Custo da matéria-prima: R$ ${r.custo_mp}`);
  linhas.push('— Açaí do Centro ERP');
  return linhas.join('\n');
}
async function enviarRelatorioFechamento(r) {
  const nums = numsFechamento(); if (!nums.length) return;
  const msg = montarRelatorioFechamento(r);
  let enviados = 0, fila = 0;
  for (const n of nums) { const res = await waEnviarOuEnfileirar(n.telefone, msg); if (res.ok) enviados++; else fila++; }
  if (enviados) toast(`📲 Relatório de fechamento enviado para ${enviados} número(s)`);
  if (fila) toast(`⏳ WhatsApp offline — ${fila} envio(s) na fila (sincroniza ao reconectar)`);
}
// UI do cadastro (card na tela Conectividade). Armazenado por dispositivo (localStorage) —
// promover ao config do servidor numa etapa futura, com autorização (exigiria mexer em API).
function renderNumsFechamento() {
  const box = $('numsfech-lista'); if (!box) return;
  const nums = numsFechamento();
  box.innerHTML = nums.length
    ? nums.map((n, i) => `<div class="hc-item"><span>📲 <b>${crmEsc(n.nome || 'Sem nome')}</b> · ${crmEsc(n.telefone)}</span><button class="btn-hc-del" data-i="${i}" title="remover">✕</button></div>`).join('')
    : '<div class="hc-vazio">Nenhum número autorizado ainda.</div>';
  box.querySelectorAll('.btn-hc-del').forEach(b => b.addEventListener('click', () => { const l = numsFechamento(); l.splice(+b.dataset.i, 1); salvarNumsFechamento(l); renderNumsFechamento(); }));
  const fila = waFila(); const fEl = $('numsfech-fila');
  if (fEl) fEl.textContent = fila.length ? `⏳ ${fila.length} mensagem(ns) aguardando sincronização` : '';
}
{ const f = $('numsfech-form'); if (f) f.addEventListener('submit', e => {
  e.preventDefault();
  const nome = $('numsfech-nome').value.trim(), tel = $('numsfech-tel').value.replace(/\D/g, '');
  if (tel.length < 10) { toast('⚠ Informe um telefone válido (com DDD)'); return; }
  const l = numsFechamento();
  if (l.some(n => n.telefone === tel)) { toast('⚠ Número já cadastrado'); return; }
  l.push({ nome, telefone: tel }); salvarNumsFechamento(l);
  $('numsfech-nome').value = ''; $('numsfech-tel').value = '';
  toast('✅ Número autorizado adicionado'); renderNumsFechamento();
}); }

/* ═══════════════════════════════════════════════════════════
   DELIVERY
   ═══════════════════════════════════════════════════════════ */
const STATUS = ['pendente', 'preparo', 'rota', 'entregue'];
const STATUS_INFO = {
  pendente: { label: 'Pendente',         icone: '🕐', proximo: 'Iniciar preparo' },
  preparo:  { label: 'Em preparo',       icone: '👨‍🍳', proximo: 'Saiu p/ entrega' },
  pronto:   { label: 'Pronto',           icone: '📦', proximo: 'Saiu p/ entrega' }, // Fase 22: aguardando expedição
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
      if (delTabAtual === 'expedicao') renderExpedicao(); // Fase 22: mantém o painel de expedição vivo
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
let atUltimoPedidoAtivo = null; // último pedido do contato aberto (Fase 4 — alimenta "Repetir último pedido")
let atPedidoAbertoAtivo = null; // pedido em aberto do contato (Fase 15 — mudar status / abrir no Delivery)
let atEstadoAtivo = null;       // estado da conversa aberta (Fase 15 — modo IA/humano, IA por-conversa)
let esAtendimento = null;       // EventSource do canal em tempo real (Fase 16)
let esConectado = false;        // canal SSE no ar? (define se o poll é lento/fallback ou rápido)
let esAvisouQueda = false;      // evita repetir o aviso de "canal caiu" no console

const fmtHora = iso => { try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const fmtDia  = iso => { try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return ''; } };
const escapar = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function abrirAtendimento() {
  atIrTab('conversas'); // Fase 46A: sempre abre nas Conversas
  const busca = $('at-busca'); if (busca) busca.value = ''; // limpa preenchimento automático do navegador (evitava o filtro fantasma "admin" que escondia tudo)
  carregarConversas();
  atualizarStatusWhatsappAt();
  // mantém o indicador IA/humano das conversas em dia com o estado GLOBAL do atendimento automático
  fetch('/api/loja/estado').then(r => r.json()).then(e => { iaAutoEstado = !!e.iaAuto; renderConversas(); }).catch(() => {});
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
    const r = await fetch('/api/atendimento/conversas', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const dados = await r.json();
    atConversas = Array.isArray(dados) ? dados : [];
    renderConversas();
    atualizarBadgesNaoLidas();
  } catch (e) {
    $('at-conversas').innerHTML = '<div class="at-vazio">⚠ Não consegui buscar as conversas.<br>Motivo: ' + ((e && e.message) || e) + '</div>';
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
    const nomeReal = c.nome || c.telefone;
    const nome = escapar(nomeReal);
    const previa = (c.ultimaDirecao === 'out' ? 'Você: ' : '') + escapar(c.ultimoTexto || '');
    const badge = c.naoLidas > 0 ? `<span class="badge-nao-lidas">${c.naoLidas}</span>` : '';
    // Fase 15 — indicador REAL por conversa (humano / IA on / IA desligada), combinado com a IA global
    const est = c.estado || { modo: 'ia', ia_ativa: 1 };
    const humano = est.modo === 'humano';
    const iaConvOn = !humano && est.ia_ativa !== 0;
    const quem = est.assumido_nome ? ' — ' + escapar(est.assumido_nome) : '';
    let dotCls, dotTit;
    if (humano) { dotCls = 'humano'; dotTit = 'Atendimento manual' + quem; }
    else if (!iaConvOn) { dotCls = 'desligada'; dotTit = 'IA desligada nesta conversa'; }
    else if (!iaAutoEstado) { dotCls = 'off'; dotTit = 'IA global desligada'; }
    else { dotCls = 'on'; dotTit = 'IA respondendo automaticamente'; }
    const iaDot = `<span class="at-ia-dot ${dotCls}" title="${dotTit}"></span>`;
    const tagAssumido = (humano && est.assumido_nome)
      ? `<span class="at-conversa-assumido" title="Assumido por ${escapar(est.assumido_nome)}">🙋 ${escapar(est.assumido_nome)}</span>` : '';
    return `<div class="at-conversa ${c.telefone === atTelefoneAtivo ? 'sel' : ''}" data-tel="${c.telefone}">
      <div class="at-conversa-av">${escapar(inicialNome(nomeReal))}${iaDot}</div>
      <div class="at-conversa-main">
        <div class="at-conversa-topo">
          <span class="at-conversa-nome">${nome}</span>
          <span class="at-conversa-hora">${fmtHora(c.criado)}</span>
        </div>
        <div class="at-conversa-baixo">
          <span class="at-conversa-previa">${previa}</span>
          ${tagAssumido}${badge}
        </div>
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('.at-conversa').forEach(el =>
    el.addEventListener('click', () => abrirConversa(el.dataset.tel)));
}

async function abrirConversa(telefone) {
  atTelefoneAtivo = telefone;
  atUltimoMsgId = 0;
  atUltimoPedidoAtivo = null;
  renderConversas(); // re-marca a selecionada
  $('at-chat-vazio').style.display = 'none';
  $('at-chat-ativo').style.display = 'flex';
  carregarContextoCliente(telefone); // COLUNA 3 — em paralelo, não trava o chat
  await carregarMensagens(true);
  setTimeout(() => $('at-texto').focus(), 60);
}

async function carregarMensagens(rolarFim) {
  if (!atTelefoneAtivo) return;
  try {
    const r = await fetch('/api/atendimento/mensagens/' + encodeURIComponent(atTelefoneAtivo), { cache: 'no-store' });
    const { mensagens, cliente } = await r.json();
    atClienteAtivo = cliente || null;   // guarda pra preencher o "Criar pedido"
    const conv = atConversas.find(c => c.telefone === atTelefoneAtivo);
    const nomeChat = (conv && conv.nome) || (cliente && cliente.nome) || atTelefoneAtivo;
    $('at-chat-nome').textContent = nomeChat;
    $('at-chat-telefone').textContent = fmtTelefone(atTelefoneAtivo);
    $('at-chat-avatar').textContent = inicialNome(nomeChat);
    $('at-chat-cliente').innerHTML = ''; // o cadastro/contexto do cliente agora vive na COLUNA 3 (painel de contexto)

    const ultimoId = mensagens.length ? mensagens[mensagens.length - 1].id : 0;
    const temNova = ultimoId !== atUltimoMsgId;
    if (temNova) {
      const jaTinha = atUltimoMsgId !== 0; // no 1º load abrirConversa já buscou o contexto; aqui só interessa msg nova do poll
      renderMensagens(mensagens);
      atUltimoMsgId = ultimoId;
      if (jaTinha) carregarContextoCliente(atTelefoneAtivo); // chegou msg nova → pode ter virado pedido: atualiza o painel
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

// Intervalo do poll do Atendimento: com o tempo real (SSE) ligado vira só REDE DE SEGURANÇA
// (lento, 30s); se o canal cai, volta a 4s pra não perder atualização (Fase 16).
function intervaloPollAtendimento() { return esConectado ? 30000 : 4000; }
function iniciarPollAtendimento() {
  if (atPollTimer) return;
  atPollTimer = setInterval(() => {
    carregarConversas();
    if (atTelefoneAtivo) carregarMensagens(false);
  }, intervaloPollAtendimento());
}
function pararPollAtendimento() {
  if (atPollTimer) { clearInterval(atPollTimer); atPollTimer = null; }
  if (atConxTimer) { clearInterval(atConxTimer); atConxTimer = null; } // Fase 46A: para o poll da Conexão
}
// reaplica o intervalo quando o estado do SSE muda (só mexe se o poll estiver rodando, i.e. na tela)
function ajustarPollPorTempoReal() {
  if (!atPollTimer) return;
  clearInterval(atPollTimer); atPollTimer = null;
  iniciarPollAtendimento();
}

/* ── TEMPO REAL (Fase 16) — SSE ────────────────────────────────────────────────
   Abre um EventSource pro /api/eventos (mesmo cookie de sessão) e reage aos eventos
   do backend, sem esperar o polling. As AÇÕES continuam indo por REST; aqui é só
   RECEBER. O EventSource reconecta sozinho; enquanto está no ar, o poll fica lento. */
function conectarEventos() {
  if (esAtendimento || typeof EventSource === 'undefined') return;
  let es;
  try { es = new EventSource('/api/eventos'); } catch { return; }
  esAtendimento = es;
  es.addEventListener('conectado', () => { esConectado = true; esAvisouQueda = false; ajustarPollPorTempoReal(); });
  es.addEventListener('mensagem_nova', onEvMensagemNova);
  es.addEventListener('conversa_atualizada', onEvConversaAtualizada);
  es.addEventListener('estado_atendimento_alterado', onEvEstadoAtendimento);
  es.addEventListener('pedido_status_alterado', onEvPedidoStatus);
  es.addEventListener('nao_lidas_atualizadas', () => agendarAtualizarConversas());
  es.addEventListener('whatsapp_status', onEvWhatsappStatus);
  es.addEventListener('sessao_expirada', () => { desconectarEventos(); if (typeof mostrarTelaLogin === 'function') mostrarTelaLogin(); });
  es.onopen = () => { esConectado = true; esAvisouQueda = false; ajustarPollPorTempoReal(); };
  es.onerror = () => {
    // o navegador reconecta sozinho; só marca desconectado (reforça o polling) e avisa 1x
    esConectado = false; ajustarPollPorTempoReal();
    if (!esAvisouQueda) { console.warn('⚠️ Canal em tempo real indisponível — usando polling e tentando reconectar.'); esAvisouQueda = true; }
  };
}
function desconectarEventos() {
  if (esAtendimento) { try { esAtendimento.close(); } catch {} esAtendimento = null; }
  esConectado = false; ajustarPollPorTempoReal();
}
// refresca a lista com um pequeno debounce (vários eventos seguidos = 1 só fetch)
let _tmrConversasRT = null;
function agendarAtualizarConversas() {
  clearTimeout(_tmrConversasRT);
  _tmrConversasRT = setTimeout(() => { carregarConversas(); }, 200);
}
function parseEv(ev) { try { return JSON.parse(ev.data); } catch { return {}; } }

function onEvMensagemNova(ev) {
  const d = parseEv(ev);
  if (d.telefone && d.telefone === atTelefoneAtivo) carregarMensagens(false); // puxa a nova na hora
  agendarAtualizarConversas();                                                // lista + badge + som
  refreshDashboardSeHome();                                                   // Fase 17: bloco de atendimento
}
function onEvConversaAtualizada(ev) {
  const d = parseEv(ev);
  if (d.removida && d.telefone && d.telefone === atTelefoneAtivo) {
    atTelefoneAtivo = null; atClienteAtivo = null;
    $('at-chat-vazio').style.display = ''; $('at-chat-ativo').style.display = 'none';
    limparContexto();
  }
  agendarAtualizarConversas();
}
function onEvEstadoAtendimento(ev) {
  const d = parseEv(ev);
  if (!d.telefone) return;
  const conv = atConversas.find(c => c.telefone === d.telefone);
  if (conv && d.estado) conv.estado = { modo: d.estado.modo, ia_ativa: d.estado.ia_ativa, assumido_nome: d.estado.assumido_nome };
  if (d.telefone === atTelefoneAtivo) {           // conversa aberta: atualiza header + painel
    if (d.estado) { atEstadoAtivo = d.estado; renderControleHeader(d.estado); }
    carregarContextoCliente(d.telefone);
  }
  renderConversas();                               // repinta o indicador da lista
  refreshDashboardSeHome();                        // Fase 17: contadores humano/IA
}
function onEvPedidoStatus(ev) {
  const d = parseEv(ev);
  if (d.telefone && d.telefone === atTelefoneAtivo) carregarContextoCliente(d.telefone);
  refreshDashboardSeHome();                        // Fase 17: contadores de pedidos por status
}
function onEvWhatsappStatus() {
  if (typeof atualizarStatusWhatsappAt === 'function') atualizarStatusWhatsappAt();
  if (typeof atualizarStatusWhatsapp === 'function') atualizarStatusWhatsapp();
}

/* ── DASHBOARD / HOME GERENCIAL (Fase 17) — tudo vem do backend ──────────────
   Busca os 6 endpoints /api/dashboard/* em paralelo e pinta os blocos. Roda ao
   abrir a Home, no botão Atualizar, num poll leve (60s) e via eventos SSE. */
let dashTimer = null, dashCarregando = false, _tmrDash = null;
function homeAtiva() { const h = $('tela-home'); return h && h.classList.contains('ativa'); }
async function fetchJson(url) { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } }

async function carregarDashboard() {
  if (dashCarregando) return;
  dashCarregando = true;
  const btn = $('btn-dash-refresh'); if (btn) btn.classList.add('girando');
  const hoje = new Date();
  const dt = $('dash-data'); if (dt) dt.textContent = hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  try {
    const [resumo, formas, atend, estoque, fin, top] = await Promise.all([
      fetchJson('/api/dashboard/resumo-dia'), fetchJson('/api/dashboard/formas-pagamento'),
      fetchJson('/api/dashboard/atendimento'), fetchJson('/api/dashboard/estoque-alertas'),
      fetchJson('/api/dashboard/financeiro'), fetchJson('/api/dashboard/top-produtos'),
    ]);
    if (resumo) renderDashKpis(resumo);
    if (atend) renderDashAtendimento(atend);
    if (formas) renderDashPagamentos(formas);
    if (estoque) renderDashEstoque(estoque);
    if (fin) renderDashFinanceiro(fin);
    if (top) renderDashTop(top);
  } catch { /* silencioso — mantém o que já estava na tela */ }
  finally { dashCarregando = false; if (btn) btn.classList.remove('girando'); }
}

function kpi(rot, val, sub, destaque) {
  return `<div class="kpi ${destaque ? 'destaque' : ''}"><span class="kpi-rot">${rot}</span><span class="kpi-val">${val}</span>${sub ? `<span class="kpi-sub">${sub}</span>` : ''}</div>`;
}
function renderDashKpis(d) {
  $('dash-kpis').innerHTML = [
    kpi('Faturamento hoje', fmt(d.faturamento), null, true),
    kpi('Vendas hoje', d.qtdVendas, `${(+d.itens).toFixed(0)} itens`),
    kpi('Ticket médio', fmt(d.ticketMedio)),
    kpi('Pedidos hoje', d.pedidosHoje, 'delivery + balcão'),
    kpi('Clientes id.', d.clientesIdentificados, 'com cadastro'),
  ].join('');
}
function renderDashAtendimento(d) {
  $('dash-atendimento').innerHTML = `
    <div class="dash-status-grid">
      <div class="dash-status st-pendente"><span class="ds-n">${d.pendentes}</span><span class="ds-r">Pendentes</span></div>
      <div class="dash-status st-preparo"><span class="ds-n">${d.preparo}</span><span class="ds-r">Preparo</span></div>
      <div class="dash-status st-rota"><span class="ds-n">${d.rota}</span><span class="ds-r">Em rota</span></div>
      <div class="dash-status st-entregue"><span class="ds-n">${d.entreguesHoje}</span><span class="ds-r">Entregues hoje</span></div>
    </div>
    <div class="dash-linha"><span class="dl-rot">💬 Conversas não lidas</span><span class="dl-val">${d.conversasNaoLidas}</span></div>
    <div class="dash-linha"><span class="dl-rot">🙋 Em atendimento humano</span><span class="dl-val">${d.conversasHumano}</span></div>
    <div class="dash-linha"><span class="dl-rot">🔇 IA desligada na conversa</span><span class="dl-val">${d.conversasIaDesligada}</span></div>`;
}
function renderDashPagamentos(lista) {
  if (!lista || !lista.length) { $('dash-pagamentos').innerHTML = '<div class="dash-vazio">Nenhuma venda registrada hoje ainda.</div>'; return; }
  const max = Math.max(...lista.map(f => f.total), 1);
  $('dash-pagamentos').innerHTML = lista.map(f => `
    <div class="dash-bar-row">
      <div class="dash-bar-top"><span class="dbt-forma">${escapar(f.forma || '—')}</span><span class="dbt-val">${fmt(f.total)}</span></div>
      <div class="dash-bar-trk"><div class="dash-bar-fill" style="width:${Math.round(f.total / max * 100)}%"></div></div>
    </div>`).join('');
}
function renderDashEstoque(d) {
  const criticos = d.criticos && d.criticos.length
    ? d.criticos.map(p => `<div class="dash-critico"><span class="dcr-nome">${escapar(p.nome || p.codigo)}</span><span class="dcr-est">${p.estoque}${p.estoqueMin ? ' / mín ' + p.estoqueMin : ''}</span></div>`).join('')
    : '<div class="dash-vazio">Nenhum produto crítico. 👍</div>';
  $('dash-estoque').innerHTML = `
    <div class="dash-chips">
      <div class="dash-chip ${d.estoqueBaixo ? 'warn' : 'ok'}"><span class="dc-n">${d.estoqueBaixo}</span>Estoque baixo</div>
      <div class="dash-chip ${d.zerados ? 'bad' : 'ok'}"><span class="dc-n">${d.zerados}</span>Zerados</div>
      <div class="dash-chip ${d.indisponiveis ? 'warn' : 'ok'}"><span class="dc-n">${d.indisponiveis}</span>Indisponíveis</div>
    </div>
    ${criticos}`;
}
function renderDashFinanceiro(d) {
  $('dash-financeiro').innerHTML = `
    <div class="dash-linha"><span class="dl-rot">🛒 Gastos hoje (compras + insumos)</span><span class="dl-val vermelho">${fmt(d.gastosHoje)}</span></div>
    <div class="dash-linha"><span class="dl-rot">📈 Saldo bruto hoje</span><span class="dl-val ${d.saldoBrutoHoje >= 0 ? 'verde' : 'vermelho'}">${fmt(d.saldoBrutoHoje)}</span></div>
    <div class="dash-linha"><span class="dl-rot">💵 Fiado recebido hoje</span><span class="dl-val">${fmt(d.fiadoRecebidoHoje)}</span></div>
    <div class="dash-linha"><span class="dl-rot">📒 Fiado em aberto (total)</span><span class="dl-val vermelho">${fmt(d.fiadoEmAberto)}</span></div>`;
}
function renderDashTop(d) {
  const col = (titulo, lista) => `<div class="dash-top-col"><h4>${titulo}</h4>${
    lista && lista.length
      ? lista.map((p, i) => `<div class="dash-top-item"><span class="dash-top-pos">${i + 1}</span><span class="dash-top-nome">${escapar(p.nome || p.codigo)}</span><span class="dash-top-qtd">${(+p.qtd).toFixed(0)}</span></div>`).join('')
      : '<div class="dash-vazio">Sem vendas no período.</div>'
  }</div>`;
  $('dash-top').innerHTML = `<div class="dash-top-cols">${col('Hoje', d.dia)}${col('Últimos 7 dias', d.semana)}</div>`;
}
function iniciarPollDashboard() { if (!dashTimer) dashTimer = setInterval(() => { if (homeAtiva()) carregarDashboard(); }, 60000); }
function pararPollDashboard() { if (dashTimer) { clearInterval(dashTimer); dashTimer = null; } }
// atualização leve via SSE: se a Home está aberta, refresca com debounce (delivery/atendimento ao vivo)
function refreshDashboardSeHome() { if (!homeAtiva()) return; clearTimeout(_tmrDash); _tmrDash = setTimeout(carregarDashboard, 400); }

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
    const r = await fetch('/api/atendimento/conversas', { cache: 'no-store' });
    const dados = await r.json();
    atConversas = Array.isArray(dados) ? dados : [];
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

/* ══════════════════════════════════════════════════════════════════════════
   COLUNA 3 — CONTEXTO DO CLIENTE (Fase 4)
   Painel operacional da conversa aberta. SÓ LEITURA: junta o contexto do servidor
   (endpoint /api/atendimento/contexto — cliente + último pedido + pedido aberto, que
   reaproveita as consultas da Fase 3) com o fiado do PDV (localStorage, casado pelo
   telefone). Não altera pedido, cliente, WhatsApp nem IA.
   ══════════════════════════════════════════════════════════════════════════ */
async function carregarContextoCliente(telefone) {
  if (!telefone) return;
  try {
    const r = await fetch('/api/atendimento/contexto/' + encodeURIComponent(telefone), { cache: 'no-store' });
    const ctx = await r.json();
    if (telefone !== atTelefoneAtivo) return; // trocou de conversa enquanto buscava — descarta
    atUltimoPedidoAtivo = ctx.ultimoPedido || null;
    atPedidoAbertoAtivo = ctx.pedidoAberto || null;
    renderContexto(ctx);
  } catch { /* falhou a busca: mantém o painel como está, sem quebrar a tela */ }
}

function renderContexto(ctx) {
  const cli = ctx.cliente || { conhecido: false };
  const conv = atConversas.find(c => c.telefone === atTelefoneAtivo) || {};
  const nome = cli.nome || conv.nome || ctx.telefone;
  $('at-ctx-conteudo').innerHTML = [
    blocoCtxCliente(cli, nome, ctx.telefone),
    blocoCtxPedido('Último pedido', '🧾', ctx.ultimoPedido, false),
    blocoCtxPedido('Pedido em aberto', '🛵', ctx.pedidoAberto, true),
    // Fase 8: fiado agora vem do backend (ctx.fiado); cai no localStorage só se o servidor não achar
    blocoCtxFinanceiro((ctx.fiado && ctx.fiado.encontrado) ? { nome: ctx.fiado.nome, saldo: ctx.fiado.saldo } : fiadoDoTelefone(ctx.telefone)),
    blocoCtxHistorico(ctx.historico), // Fase 18: histórico recente de pedidos do cliente unificado
    blocoCtxObs(ctx),        // Fase 15: anotações do operador sobre esta conversa
    blocoCtxAcoes(ctx),
  ].join('');
  $('at-ctx-vazio').style.display = 'none';
  $('at-ctx-conteudo').style.display = 'flex';
  atEstadoAtivo = ctx.estado || { modo: 'ia', ia_ativa: 1 };  // Fase 15: guarda o estado da conversa aberta
  renderControleHeader(atEstadoAtivo);                         // pinta o controle no cabeçalho do chat
}

function limparContexto() {
  atUltimoPedidoAtivo = null;
  atPedidoAbertoAtivo = null;
  atEstadoAtivo = null;
  $('at-ctx-conteudo').innerHTML = '';
  $('at-ctx-conteudo').style.display = 'none';
  $('at-ctx-vazio').style.display = 'flex';
  const ctrl = $('at-chat-controle');  // Fase 15: esconde o controle do header quando não há conversa
  if (ctrl) { ctrl.innerHTML = ''; ctrl.style.display = 'none'; }
}

// Bloco 1 — cliente
function blocoCtxCliente(cli, nome, telefone) {
  const tag = cli.conhecido
    ? '<span class="ctx-tag conhecido">✔ Cliente conhecido</span>'
    : '<span class="ctx-tag novo">Novo contato</span>';
  const endereco = cli.endereco ? escapar(cli.endereco) : '<span class="ctx-vazio-bloco">sem endereço salvo</span>';
  const pgto = cli.formaPagamento ? escapar(cli.formaPagamento) : '—';
  const obs = cli.obs ? `<div class="ctx-linha"><span class="ctx-rot">📝 Obs.</span><span class="ctx-val">${escapar(cli.obs)}</span></div>` : '';
  const atualizado = cli.atualizado_em ? `<div class="ctx-linha"><span class="ctx-rot">🕒 Atualizado</span><span class="ctx-val">${fmtDataHora(cli.atualizado_em)}</span></div>` : '';
  return `<div class="ctx-card">
    <div class="ctx-card-tit"><span class="ctx-ico">🪪</span> Cliente</div>
    <div class="ctx-nome-grande">${escapar(nome)}</div>
    <div style="margin-bottom:8px">${tag}</div>
    <div class="ctx-linha"><span class="ctx-rot">📞 Telefone</span><span class="ctx-val">${escapar(fmtTelefone(telefone))}</span></div>
    <div class="ctx-linha"><span class="ctx-rot">📍 Endereço</span><span class="ctx-val">${endereco}</span></div>
    <div class="ctx-linha"><span class="ctx-rot">💳 Pagamento</span><span class="ctx-val">${pgto}</span></div>
    ${obs}${atualizado}
  </div>`;
}

// Blocos 2 e 3 — pedido (último / em aberto)
function blocoCtxPedido(titulo, ico, ped, exigeAberto) {
  if (!ped) {
    const msg = exigeAberto ? 'Nenhum pedido em andamento agora.' : 'Esse cliente ainda não fez pedidos.';
    return `<div class="ctx-card">
      <div class="ctx-card-tit"><span class="ctx-ico">${ico}</span> ${titulo}</div>
      <div class="ctx-vazio-bloco">${msg}</div>
    </div>`;
  }
  const itens = ped.itens ? escapar(ped.itens) : '—';
  const valor = fmt(ped.total != null ? ped.total : (ped.valor || 0));
  const quando = ped.criado ? fmtDataHora(ped.criado) : '';
  const pgto = ped.pagamento ? ` · ${escapar(ped.pagamento)}` : '';
  // Fase 15: no "pedido em aberto" o operador muda o status direto daqui (mesmo PUT do Delivery)
  const troca = (exigeAberto && ped.id) ? botoesStatusPedido(ped) : '';
  // Fase 22: se o pedido já foi despachado, mostra quem está levando
  const entregador = ped.entregador_nome ? `<div class="ctx-ped-entregador">🧑‍🔧 Entregador: <strong>${escapar(ped.entregador_nome)}</strong></div>` : '';
  return `<div class="ctx-card">
    <div class="ctx-card-tit"><span class="ctx-ico">${ico}</span> ${titulo}</div>
    <div class="ctx-ped-topo"><span class="ctx-ped-num">Pedido #${escapar(String(ped.numero))}</span>${statusPill(ped.status)}</div>
    <div class="ctx-ped-itens">${itens}</div>
    <div class="ctx-ped-rodape">
      <span class="ctx-ped-valor">${valor}</span>
      <span class="ctx-ped-meta">${quando}${pgto}</span>
    </div>
    ${entregador}
    ${troca}
  </div>`;
}

// Fase 15 — troca rápida de status do pedido em aberto (pendente → preparo → rota → entregue)
function botoesStatusPedido(ped) {
  const fluxo = [['pendente', 'Pendente'], ['preparo', 'Preparo'], ['rota', 'Em rota'], ['entregue', 'Entregue']];
  const atual = (ped.status || '').toLowerCase();
  const btns = fluxo.map(([s, rot]) =>
    `<button class="ctx-st-btn st-${s} ${atual === s ? 'atual' : ''}" data-pedido-status="${s}" data-pedido-id="${ped.id}" ${atual === s ? 'disabled' : ''}>${rot}</button>`
  ).join('');
  return `<div class="ctx-st-troca"><span class="ctx-st-rot">Mudar status</span><div class="ctx-st-btns">${btns}</div></div>`;
}

// Bloco 4 — financeiro (fiado do PDV, casado pelo telefone)
function blocoCtxFinanceiro(fin) {
  let corpo;
  if (!fin) {
    corpo = '<div class="ctx-vazio-bloco">Cliente não encontrado no fiado do PDV.</div>';
  } else if (fin.saldo > 0.001) {
    corpo = `<div class="ctx-linha"><span class="ctx-rot">Em aberto</span><span class="ctx-val ctx-fin-deve">${fmt(fin.saldo)}</span></div>
             <div class="ctx-ped-meta" style="margin-top:4px">conta de ${escapar(fin.nome)}</div>`;
  } else {
    corpo = '<div class="ctx-fin-ok">✔ Sem saldo em aberto</div>';
  }
  return `<div class="ctx-card">
    <div class="ctx-card-tit"><span class="ctx-ico">💰</span> Financeiro (fiado)</div>
    ${corpo}
  </div>`;
}

// Controle da conversa NO CABEÇALHO do chat (Fase 15): assumir / devolver pra IA + switch de IA.
// Fica no header (não no painel lateral) — Parte 4. Preenche #at-chat-controle.
function renderControleHeader(est) {
  const box = $('at-chat-controle');
  if (!box) return;
  est = est || { modo: 'ia', ia_ativa: 1 };
  const humano = est.modo === 'humano';
  const iaOn = !humano && est.ia_ativa !== 0; // = conversaAceitaIA no backend
  const quem = est.assumido_nome ? escapar(est.assumido_nome) : 'operador';
  const desde = est.assumido_em ? ` · ${fmtHora(est.assumido_em)}` : '';
  const pill = humano
    ? `<span class="at-modo-pill humano">🙋 Manual — ${quem}${desde}</span>`
    : (iaOn ? `<span class="at-modo-pill ia">🤖 IA automática</span>`
            : `<span class="at-modo-pill off">🔇 IA desligada</span>`);
  const btn = humano
    ? `<button class="at-ctrl-btn liberar" data-acao="liberar">✅ Devolver pra IA</button>`
    : `<button class="at-ctrl-btn assumir" data-acao="assumir">🙋 Assumir</button>`;
  box.innerHTML = `
    ${pill}
    <div class="at-ctrl-dir">
      <span class="at-ctrl-ia-rot">IA desta conversa</span>
      <button class="dt-switch ${iaOn ? 'ligado' : ''}" data-acao="ia-switch" data-ativa="${iaOn ? 1 : 0}" title="${iaOn ? 'IA ligada nesta conversa' : 'IA desligada nesta conversa'}"></button>
      ${btn}
    </div>`;
  box.style.display = 'flex';
}

// Bloco — anotações INTERNAS do operador sobre a conversa (Fase 15). Não vão pro cliente.
// Bloco — histórico recente de pedidos do cliente unificado (Fase 18)
function blocoCtxHistorico(historico) {
  if (!historico || !historico.length) return ''; // sem histórico: não polui o painel
  const linhas = historico.slice(0, 5).map(p => {
    const quando = p.criado ? fmtDataHora(p.criado) : '';
    const itens = p.itens ? escapar(String(p.itens)) : '—';
    const valor = fmt(p.total != null ? p.total : (p.valor || 0));
    return `<div class="ctx-hist-item">
      <div class="ctx-hist-topo"><span class="ctx-hist-num">#${escapar(String(p.numero))}</span>${statusPill(p.status)}<span class="ctx-hist-data">${quando}</span></div>
      <div class="ctx-hist-itens">${itens}</div>
      <div class="ctx-hist-val">${valor}</div>
    </div>`;
  }).join('');
  return `<div class="ctx-card">
    <div class="ctx-card-tit"><span class="ctx-ico">📚</span> Histórico de pedidos <span class="ctx-hist-qtd">${historico.length}</span></div>
    ${linhas}
  </div>`;
}

function blocoCtxObs(ctx) {
  const est = ctx.estado || {};
  const obs = est.obs ? escapar(est.obs) : '';
  return `<div class="ctx-card">
    <div class="ctx-card-tit"><span class="ctx-ico">📝</span> Anotações do atendimento</div>
    <textarea id="ctx-obs-texto" class="ctx-obs-area" placeholder="Ex.: prefere sem leite condensado, sempre paga no PIX…">${obs}</textarea>
    <button class="ctx-acao larga" data-acao="obs-salvar" style="margin-top:8px">💾 Salvar anotação</button>
    <div class="ctx-obs-nota">Só pra equipe — o cliente não vê.</div>
  </div>`;
}

// Bloco — ações rápidas (Criar / Repetir / Abrir cadastro / Abrir no Delivery)
function blocoCtxAcoes(ctx) {
  const semUltimo = ctx.ultimoPedido ? '' : 'disabled';
  const semAberto = (ctx.pedidoAberto && ctx.pedidoAberto.id) ? '' : 'disabled';
  return `<div class="ctx-card">
    <div class="ctx-card-tit"><span class="ctx-ico">⚡</span> Ações rápidas</div>
    <div class="ctx-acoes">
      <button class="ctx-acao destaque larga" data-acao="criar">🛵 Criar pedido</button>
      <button class="ctx-acao larga" data-acao="repetir" ${semUltimo}>🔁 Repetir último pedido</button>
      <button class="ctx-acao" data-acao="cadastro">👤 Abrir cadastro</button>
      <button class="ctx-acao" data-acao="delivery" ${semAberto}>📋 Abrir no Delivery</button>
    </div>
  </div>`;
}

/* status do pedido → pílula colorida */
function statusPill(status) {
  const s = (status || '').toLowerCase();
  const nomes = { pendente: 'Pendente', preparo: 'Em preparo', pronto: 'Pronto', rota: 'Em rota', entregue: 'Entregue', cancelado: 'Cancelado' };
  const conhecido = ['pendente', 'preparo', 'pronto', 'rota', 'entregue', 'cancelado'].includes(s);
  return `<span class="ctx-status st-${conhecido ? s : 'pendente'}">${escapar(nomes[s] || status || '—')}</span>`;
}

/* fiado do PDV (localStorage) casado pelo telefone — heurística: compara os últimos 8 dígitos.
   Só leitura do que o PDV já tem; não cria nem altera cliente. */
function fiadoDoTelefone(telefone) {
  try {
    const alvo = soDigitos(telefone).slice(-8);
    if (alvo.length < 8 || typeof CLIENTES === 'undefined') return null;
    const c = CLIENTES.find(cl => soDigitos(cl.telefone || '').slice(-8) === alvo);
    if (!c) return null;
    return { nome: c.nome, saldo: saldoCliente(c) };
  } catch { return null; }
}

/* Repetir último pedido — abre o modal de pedido já preenchido com o último pedido do cliente.
   O atendente revisa e confirma (não cria nada sozinho — mesmo fluxo do "Criar pedido"). */
function repetirUltimoPedido() {
  if (!atTelefoneAtivo || !atUltimoPedidoAtivo) return;
  const p = atUltimoPedidoAtivo;
  const conv = atConversas.find(c => c.telefone === atTelefoneAtivo);
  $('form-pedido').reset();
  $('ped-taxa').value = 0;
  $('ped-cliente').value = (atClienteAtivo && atClienteAtivo.nome) || (conv && conv.nome) || '';
  $('ped-telefone').value = atTelefoneAtivo;
  $('ped-endereco').value = p.endereco || (atClienteAtivo && atClienteAtivo.endereco) || '';
  if (p.bairro) $('ped-bairro').value = p.bairro;
  if (p.complemento) $('ped-complemento').value = p.complemento;
  $('ped-itens').value = p.itens || '';
  if (p.valor != null) $('ped-valor').value = p.valor;
  if (p.pagamento) { const sel = $('ped-pagamento'); if ([...sel.options].some(o => o.value === p.pagamento)) sel.value = p.pagamento; }
  atualizarPreviewTotal();
  $('overlay-pedido').classList.add('aberto');
  setTimeout(() => $('ped-itens').focus(), 100);
}

/* Abrir cadastro do cliente — reaproveita o modal "Clientes Cadastrados" (delivery) já existente */
function abrirCadastroDoContato() {
  const overlay = $('overlay-clientes-delivery');
  if (!overlay) return;
  if (typeof renderClientesDelivery === 'function') renderClientesDelivery('');
  overlay.classList.add('aberto');
}

/* ── Controle da conversa (Fase 15) — assumir / liberar / IA on-off ──
   Chama o backend, atualiza o header e o item da lista sem recarregar tudo. */
async function acaoEstadoConversa(url, opts, msgErroPadrao) {
  if (!atTelefoneAtivo) return null;
  try {
    const r = await fetch(url, { cache: 'no-store', ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.erro || msgErroPadrao || 'Não foi possível concluir.', 'erro'); return null; }
    atEstadoAtivo = j;
    renderControleHeader(j);                                    // repinta o cabeçalho
    const conv = atConversas.find(c => c.telefone === atTelefoneAtivo);
    if (conv) { conv.estado = { modo: j.modo, ia_ativa: j.ia_ativa, assumido_nome: j.assumido_nome }; renderConversas(); }
    return j;
  } catch { toast('Sem conexão com o servidor.', 'erro'); return null; }
}
function assumirConversa() {
  acaoEstadoConversa(`/api/atendimento/assumir/${encodeURIComponent(atTelefoneAtivo)}`, { method: 'POST' })
    .then(e => { if (e) toast('🙋 Você assumiu — a IA não responde mais aqui.', 'sucesso'); });
}
function liberarConversa() {
  acaoEstadoConversa(`/api/atendimento/liberar/${encodeURIComponent(atTelefoneAtivo)}`, { method: 'POST' })
    .then(e => { if (e) toast('✅ Conversa devolvida pra IA.', 'sucesso'); });
}
function toggleIAConversa(ativa) {
  acaoEstadoConversa(`/api/atendimento/ia/${encodeURIComponent(atTelefoneAtivo)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativa }) })
    .then(e => { if (e) toast(ativa ? '🤖 IA ligada nesta conversa.' : '🔇 IA desligada nesta conversa.', 'sucesso'); });
}
/* Anotações internas (não vão pro cliente) */
async function salvarObsConversa() {
  if (!atTelefoneAtivo) return;
  const ta = $('ctx-obs-texto');
  const obs = ta ? ta.value : '';
  try {
    const r = await fetch(`/api/atendimento/obs/${encodeURIComponent(atTelefoneAtivo)}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ obs }) });
    if (!r.ok) { toast('Não foi possível salvar a anotação.', 'erro'); return; }
    const est = await r.json();
    if (atEstadoAtivo) atEstadoAtivo.obs = est.obs;
    toast('💾 Anotação salva.', 'sucesso');
  } catch { toast('Sem conexão com o servidor.', 'erro'); }
}
/* Mudar status do pedido em aberto direto do Atendimento (mesma API do Delivery) */
async function mudarStatusPedidoAtendimento(id, status) {
  if (!id || !status) return;
  try {
    const r = await fetch('/api/pedidos/' + id,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, via: 'atendimento' }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.erro || 'Não foi possível mudar o status.', 'erro'); return; }
    const nomes = { pendente: 'Pendente', preparo: 'Em preparo', rota: 'Em rota', entregue: 'Entregue' };
    toast('🛵 Pedido → ' + (nomes[status] || status) + '.', 'sucesso');
    if (atTelefoneAtivo) carregarContextoCliente(atTelefoneAtivo);   // recarrega o painel com o novo status
    if (typeof carregarPedidos === 'function') carregarPedidos();      // mantém o quadro do Delivery em dia
  } catch { toast('Sem conexão com o servidor.', 'erro'); }
}
/* Abrir a tela de Delivery (o pedido em aberto do cliente aparece no quadro) */
function abrirNoDelivery() {
  irPara('delivery');
  if (typeof carregarPedidos === 'function') carregarPedidos();
}

/* helpers de exibição do painel de contexto */
function inicialNome(nome) {
  const s = (nome || '').trim();
  const ch = s ? s[0] : '';
  return /[a-zA-Z0-9]/.test(ch) ? ch.toUpperCase() : (ch || '🙂');
}
const soDigitos = s => (s || '').replace(/\D/g, '');
function fmtTelefone(tel) {
  let d = soDigitos(tel);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2); // tira o 55 do país só pra exibir
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel || '—';
}
function fmtDataHora(iso) { const dia = fmtDia(iso), hora = fmtHora(iso); return dia && hora ? `${dia} ${hora}` : (dia || hora || ''); }

// listeners da Central (registrados uma vez)
$('at-busca').addEventListener('input', renderConversas);
$('at-envio').addEventListener('submit', e => { e.preventDefault(); enviarResposta(); });
$('at-btn-criar-pedido').addEventListener('click', abrirPedidoDaConversa);
// ações rápidas do painel de contexto (delegação — os botões são recriados a cada render)
$('at-ctx-conteudo').addEventListener('click', e => {
  // Fase 15 — troca de status do pedido em aberto (botões próprios, fora de .ctx-acao)
  const st = e.target.closest('.ctx-st-btn');
  if (st && !st.disabled) { mudarStatusPedidoAtendimento(+st.dataset.pedidoId, st.dataset.pedidoStatus); return; }
  const btn = e.target.closest('.ctx-acao');
  if (!btn || btn.disabled) return;
  const acao = btn.dataset.acao;
  if (acao === 'criar') abrirPedidoDaConversa();
  else if (acao === 'repetir') repetirUltimoPedido();
  else if (acao === 'cadastro') abrirCadastroDoContato();
  else if (acao === 'delivery') abrirNoDelivery();
  else if (acao === 'obs-salvar') salvarObsConversa();
});
// Fase 15 — controle IA x humano no CABEÇALHO do chat (assumir / liberar / switch de IA)
$('at-chat-controle').addEventListener('click', e => {
  const btn = e.target.closest('[data-acao]');
  if (!btn || btn.disabled) return;
  const acao = btn.dataset.acao;
  if (acao === 'assumir') assumirConversa();
  else if (acao === 'liberar') liberarConversa();
  else if (acao === 'ia-switch') toggleIAConversa(btn.dataset.ativa !== '1'); // ligada → desliga; desligada → liga
});
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
    limparContexto(); // esvazia o painel de contexto da COLUNA 3
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
  if (!p) return;
  if (!(await garantirSupervisor('Remover pedido precisa da autorização do supervisor.'))) return; // operador exige senha (Fase 12)
  if (confirm(`Remover o pedido #${p.numero} de ${p.cliente}?`)) {
    try {
      await fetch('/api/pedidos/' + id, { method: 'DELETE' });
    } catch { toast('⚠ Servidor indisponível'); return; }
    pedidos = pedidos.filter(x => x.id !== id);
    renderDelivery();
  }
}

/* ── EXPEDIÇÃO (Fase 22) — aba de saída/rota + entregadores ── */
let delTabAtual = 'quadro';
let entregadoresCache = [];
function trocarDelTab(tab) {
  delTabAtual = tab;
  document.querySelectorAll('.del-tab').forEach(b => b.classList.toggle('ativo', b.dataset.dtab === tab));
  $('delivery-board').style.display = tab === 'quadro' ? '' : 'none';
  $('expedicao-wrap').style.display = tab === 'expedicao' ? '' : 'none';
  if (tab === 'expedicao') renderExpedicao();
}
document.querySelectorAll('.del-tab').forEach(b => b.addEventListener('click', () => trocarDelTab(b.dataset.dtab)));

async function renderExpedicao() {
  let d;
  try { d = await (await fetch('/api/expedicao/resumo', { cache: 'no-store' })).json(); } catch { return; }
  entregadoresCache = d.entregadores || [];
  $('exp-prontos-n').textContent = d.prontos.length;
  $('exp-prontos').innerHTML = d.prontos.length ? d.prontos.map(p => cardExp(p, 'pronto')).join('') : '<div class="exp-vazio">Nenhum pedido pronto pra sair.</div>';
  $('exp-rota-n').textContent = d.rota.length;
  $('exp-rota').innerHTML = d.rota.length ? d.rota.map(p => cardExp(p, 'rota')).join('') : '<div class="exp-vazio">Ninguém em rota agora.</div>';
  $('exp-entregadores').innerHTML = d.entregadores.length ? d.entregadores.map(e => `
    <div class="exp-ent-item">
      <div><div class="exp-ent-nome">🧑‍🔧 ${escapar(e.nome)} ${e.temPin ? '<span class="exp-pin-ok" title="Tem acesso ao app">📱</span>' : '<span class="exp-pin-no" title="Sem PIN — não acessa o app">🔒</span>'}</div>
      <div class="exp-ent-meta">${e.emRota} em rota · ${e.entreguesHoje} hoje${e.tempoMedio ? ' · ~' + e.tempoMedio + ' min' : ''}</div></div>
      <div class="exp-ent-btns">
        <button class="exp-ent-pin" data-ent-pin="${e.id}" data-ent-nome="${escapar(e.nome)}" title="Definir/resetar PIN do app">🔑</button>
        <button class="exp-ent-off" data-ent-off="${e.id}" title="Desativar">✕</button>
      </div>
    </div>`).join('') : '<div class="exp-vazio">Nenhum entregador ativo — cadastre abaixo.</div>';
  $('exp-hoje').innerHTML = `<div class="exp-hoje-card">✅ <strong>${d.entreguesHoje.total}</strong> entregues hoje${d.entreguesHoje.tempoMedio ? ` · tempo médio ~${d.entreguesHoje.tempoMedio} min` : ''}</div>`;
}
function cardExp(p, modo) {
  const end = [p.endereco, p.bairro].filter(Boolean).join(' - ');
  const atrasado = modo === 'rota' && p.min_em_rota != null && p.min_em_rota >= 45;
  const acoes = modo === 'pronto'
    ? `<button class="exp-btn destaque" data-despachar="${p.id}">🛵 Despachar</button>`
    : `<button class="exp-btn ok" data-entregar="${p.id}">✅ Entregue</button><button class="exp-btn" data-retornar="${p.id}">↩ Voltar</button>`;
  const rotaInfo = modo === 'rota'
    ? `<div class="exp-card-rota">🧑‍🔧 ${escapar(p.entregador_nome || 'sem entregador')} · há ${p.min_em_rota != null ? p.min_em_rota : '?'} min${atrasado ? ' ⚠️' : ''}</div>` : '';
  return `<div class="exp-card ${atrasado ? 'atrasado' : ''}">
    <div class="exp-card-top"><span class="exp-card-num">#${p.numero}</span><span class="exp-card-total">${fmt(p.total)}</span></div>
    <div class="exp-card-cli">${escapar(p.cliente || '—')}</div>
    <div class="exp-card-end">📍 ${escapar(end || '—')}</div>
    ${rotaInfo}
    <div class="exp-card-acoes">${acoes}</div>
  </div>`;
}
$('expedicao-wrap').addEventListener('click', e => {
  const desp = e.target.closest('[data-despachar]'), entr = e.target.closest('[data-entregar]');
  const ret = e.target.closest('[data-retornar]'), off = e.target.closest('[data-ent-off]');
  const pin = e.target.closest('[data-ent-pin]');
  if (pin) { definirPinEntregador(+pin.dataset.entPin, pin.dataset.entNome); return; }
  if (desp) abrirDespachar(+desp.dataset.despachar);
  else if (entr) marcarEntregue(+entr.dataset.entregar);
  else if (ret) retornarRota(+ret.dataset.retornar);
  else if (off) desativarEntregador(+off.dataset.entOff);
});
let despachandoId = null;
function abrirDespachar(id) {
  const p = pedidos.find(x => x.id === id) || {};
  despachandoId = id;
  $('despachar-info').textContent = `Pedido #${p.numero || id} · ${p.cliente || ''}`;
  $('despachar-entregador').innerHTML = entregadoresCache.length
    ? entregadoresCache.map(e => `<option value="${e.id}">${escapar(e.nome)}</option>`).join('')
    : '<option value="">— cadastre um entregador —</option>';
  $('despachar-previsao').value = '';
  $('overlay-despachar').classList.add('aberto');
}
function fecharDespachar() { $('overlay-despachar').classList.remove('aberto'); despachandoId = null; }
$('btn-fechar-despachar').addEventListener('click', fecharDespachar);
$('overlay-despachar').addEventListener('click', e => { if (e.target === $('overlay-despachar')) fecharDespachar(); });
$('btn-despachar-ok').addEventListener('click', async () => {
  if (!despachandoId) return;
  const entregador_id = +$('despachar-entregador').value || null;
  const previsao_min = +$('despachar-previsao').value || 0;
  try {
    const r = await fetch(`/api/pedidos/${despachandoId}/despachar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entregador_id, previsao_min }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.erro || 'Falha ao despachar', 'erro'); return; }
    toast('🛵 Pedido despachado', 'sucesso');
    fecharDespachar();
    await carregarPedidos(); renderExpedicao();
  } catch { toast('Servidor indisponível', 'erro'); }
});
async function marcarEntregue(id) {
  try {
    const r = await fetch(`/api/pedidos/${id}/entregar`, { method: 'POST' });
    if (!r.ok) { toast('Falha ao marcar entregue', 'erro'); return; }
    const p = await r.json();
    toast(`✅ Entregue${p.tempo_entrega_min != null ? ' · ' + p.tempo_entrega_min + ' min' : ''}`, 'sucesso');
    await carregarPedidos(); renderExpedicao();
  } catch { toast('Servidor indisponível', 'erro'); }
}
async function retornarRota(id) {
  if (!confirm('Voltar este pedido da rota pra "pronto"?')) return;
  try {
    await fetch(`/api/pedidos/${id}/retornar`, { method: 'POST' });
    toast('↩ Pedido voltou pra pronto', 'sucesso');
    await carregarPedidos(); renderExpedicao();
  } catch { toast('Servidor indisponível', 'erro'); }
}
$('exp-ent-add').addEventListener('submit', async e => {
  e.preventDefault();
  const nome = $('exp-ent-nome').value.trim(); if (!nome) return;
  const pin = ($('exp-ent-pin') && $('exp-ent-pin').value.trim()) || '';
  if (pin && pin.length < 4) { toast('O PIN precisa de pelo menos 4 dígitos', 'erro'); return; }
  try {
    const r = await fetch('/api/entregadores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, telefone: $('exp-ent-tel').value.trim(), pin: pin || undefined }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.erro || 'Sem permissão (precisa de supervisor)', 'erro'); return; }
    $('exp-ent-add').reset();
    toast('✅ Entregador cadastrado', 'sucesso');
    renderExpedicao();
  } catch { toast('Servidor indisponível', 'erro'); }
});
async function desativarEntregador(id) {
  if (!confirm('Desativar este entregador? (o histórico é preservado)')) return;
  try {
    const r = await fetch('/api/entregadores/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: false }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.erro || 'Sem permissão (precisa de supervisor)', 'erro'); return; }
    toast('Entregador desativado', 'sucesso');
    renderExpedicao();
  } catch { toast('Servidor indisponível', 'erro'); }
}
// Fase 23: define/reseta o PIN de acesso mobile do entregador
async function definirPinEntregador(id, nome) {
  const pin = prompt(`PIN de acesso do app pra ${nome || 'entregador'} (mín. 4 dígitos). Deixe vazio pra remover o acesso:`);
  if (pin === null) return; // cancelou
  if (pin && pin.trim().length > 0 && pin.trim().length < 4) { toast('O PIN precisa de pelo menos 4 dígitos', 'erro'); return; }
  try {
    const r = await fetch('/api/entregadores/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pin.trim() }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.erro || 'Sem permissão (precisa de supervisor)', 'erro'); return; }
    toast(pin.trim() ? '🔑 PIN definido' : 'Acesso removido', 'sucesso');
    renderExpedicao();
  } catch { toast('Servidor indisponível', 'erro'); }
}

/* Render — QUADRO OPERACIONAL por status (Fase 5): 4 colunas pendente/preparo/rota/entregue.
   Mesma lógica de dados de antes (mesmos pedidos, mesmos status, mesmas ações) — só a
   organização visual mudou. A coluna "Entregues" mostra os de HOJE (bate com o card do topo). */
function renderDelivery() {
  const board = $('delivery-board');
  const hoje = new Date().toISOString().slice(0, 10);

  // agrupa por status preservando a ordem que veio do servidor (id DESC = mais novo primeiro)
  const grupos = { pendente: [], preparo: [], rota: [], entregue: [] };
  for (const p of (Array.isArray(pedidos) ? pedidos : [])) { const g = p.status === 'pronto' ? 'preparo' : p.status; if (grupos[g]) grupos[g].push(p); } // Fase 22: 'pronto' aparece na coluna de preparo (guarda: sessão expirada → não-lista)
  const entreguesHoje = grupos.entregue.filter(p => (p.criado || '').slice(0, 10) === hoje);
  const faturamento = entreguesHoje.reduce((s, p) => s + (p.total || 0), 0);

  // Estatísticas do topo
  $('stat-pendentes').textContent = grupos.pendente.length;
  $('stat-preparo').textContent = grupos.preparo.length;
  $('stat-rota').textContent = grupos.rota.length;
  $('stat-entregues').textContent = entreguesHoje.length;
  $('stat-faturamento').textContent = fmt(faturamento);

  const colunas = [
    { status: 'pendente', titulo: 'Pendentes',  lista: grupos.pendente,  vazio: 'Nenhum pedido pendente.' },
    { status: 'preparo',  titulo: 'Em preparo', lista: grupos.preparo,   vazio: 'Nada em preparo agora.' },
    { status: 'rota',     titulo: 'Em rota',    lista: grupos.rota,      vazio: 'Ninguém em rota agora.' },
    { status: 'entregue', titulo: 'Entregues',  lista: entreguesHoje,    vazio: 'Nada entregue hoje ainda.' },
  ];
  board.innerHTML = colunas.map(col => {
    const info = STATUS_INFO[col.status];
    const cards = col.lista.length
      ? col.lista.map(cardPedido).join('')
      : `<div class="col-vazio">${col.vazio}</div>`;
    return `<div class="board-col" data-status="${col.status}">
      <div class="board-col-head">
        <span class="bc-titulo">${info.icone} ${col.titulo}</span>
        <span class="bc-count">${col.lista.length}</span>
      </div>
      <div class="board-col-cards">${cards}</div>
    </div>`;
  }).join('');
}

/* Card de um pedido (cabeçalho · cliente · pedido · rodapé). Ações e IDs iguais aos de antes. */
function cardPedido(p) {
  const info = STATUS_INFO[p.status];
  const enderecoCompleto = [p.endereco, p.bairro].filter(Boolean).join(' - ');
  const trocoTxt = (p.pagamento === 'Dinheiro' && p.troco > 0) ? ` · troco p/ ${fmt(p.troco)}` : '';
  const origem = p.origem === 'ia'
    ? '<span class="card-origem ia" title="Pedido feito pelo atendimento automático">🤖 IA</span>'
    : '<span class="card-origem manual">✍ Manual</span>';
  return `
    <div class="del-card" tabindex="0" data-id="${p.id}" data-status="${p.status}">
      <div class="del-card-top">
        <span class="del-num">#${p.numero}</span>
        ${origem}
        <span class="del-hora">🕘 ${fmtHora(p.criado)}</span>
      </div>
      <div class="del-cliente">${escapar(p.cliente || '—')}</div>
      ${p.telefone ? `<div class="del-info">📞 <a class="wa-link" href="https://wa.me/${telWhatsapp(p.telefone)}" target="_blank" rel="noopener" title="Abrir no WhatsApp">${escapar(p.telefone)}</a></div>` : ''}
      <div class="del-info">📍 ${escapar(enderecoCompleto || '—')}</div>
      ${p.complemento ? `<div class="del-info compl">↳ ${escapar(p.complemento)}</div>` : ''}
      ${p.itens ? `<div class="del-itens">${escapar(p.itens)}</div>` : ''}
      <div class="del-pgto">💳 ${escapar(p.pagamento || '—')}${trocoTxt}</div>
      <div class="del-valores">
        <span class="detalhe">Itens ${fmt(p.valor)} + taxa ${fmt(p.taxa)}</span>
        <span class="del-total">${fmt(p.total)}</span>
      </div>
      <div class="del-acoes">
        ${info.proximo
          ? `<button class="btn-avancar" onclick="avancarStatus(${p.id})">${info.proximo} →</button>`
          : `<button class="btn-avancar concluido" disabled>✅ Pedido concluído</button>`}
        <button class="btn-cancelar" onclick="cancelarPedido(${p.id})" title="Remover">🗑</button>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   LOGIN
   ═══════════════════════════════════════════════════════════ */
/* Fase 12: autenticação REAL no backend. A lista fixa de usuários saiu do código —
   agora o login chama POST /api/auth/login (sessão em cookie HttpOnly) e quem diz
   quem está logado é GET /api/auth/me. usuarioAtual guarda { nome, usuario, perfil }. */
let usuarioAtual = null;

/* Autorização do supervisor — agora REAL: a senha é validada no SERVIDOR
   (POST /api/auth/supervisor), que abre uma janela de 5 min na sessão atual.
   Retorna uma Promise que resolve true se o supervisor autorizou. */
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
async function validarSupervisor() {
  const senha = $('supervisor-senha').value;
  if (!senha) return;
  $('btn-supervisor-ok').disabled = true;
  try {
    const r = await fetch('/api/auth/supervisor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }) });
    if (r.ok) { fecharSupervisor(true); return; }
    $('supervisor-erro').textContent = '⚠️ Senha incorreta'; $('supervisor-senha').value = ''; $('supervisor-senha').focus();
  } catch { $('supervisor-erro').textContent = '⚠️ Servidor indisponível'; }
  finally { $('btn-supervisor-ok').disabled = false; }
}
/* Gate de supervisor pro OPERADOR: admin/supervisor passam direto; operador precisa
   da senha (abre a janela de 5 min no servidor — sem ela o backend devolve 403). */
async function garantirSupervisor(msg) {
  if (!usuarioAtual || usuarioAtual.perfil !== 'operador') return true;
  return await pedirAutorizacaoSupervisor(msg || 'Esta ação precisa da autorização do supervisor.');
}
$('btn-supervisor-ok').addEventListener('click', validarSupervisor);
$('supervisor-senha').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); validarSupervisor(); } });
$('btn-fechar-supervisor').addEventListener('click', () => fecharSupervisor(false));
$('overlay-supervisor').addEventListener('click', e => { if (e.target === $('overlay-supervisor')) fecharSupervisor(false); });

function fazerLogin(nome) {
  sessionStorage.setItem('acai_logado', nome); // só estado visual — a verdade é o cookie de sessão
  $('user-nome').textContent = nome;
  $('home-user').textContent = nome.split(' ')[0];
  $('tela-login').classList.add('oculto');
  $('app-principal').classList.remove('oculto');
  atualizarMenuAdmin(); // botão ⚙️ Administração só aparece pro perfil admin (Fase 13)
  conectarEventos();    // Fase 16: abre o canal em tempo real (só logado)
  carregarLojaConfig(); // Fase 20: aplica o nome da loja no título da aba
  irPara('pdv');                                   // abre DIRETO na tela de Vendas (PDV)
  if (typeof focusCodigoMercadoria === 'function') setTimeout(focusCodigoMercadoria, 80);
}
/* A navegação (barra superior) é gerada por permissão a partir da fonte central (montarTopo).
   Os cartões da home também são filtrados pelo perfil. A proteção REAL continua no backend. */
function atualizarMenuAdmin() {
  // Fase 46B §10: home por perfil — cards gerenciais só aparecem para quem usa.
  document.querySelectorAll('.dash-card[data-perm]').forEach(c => { c.style.display = navPodeVer(c.dataset.perm) ? '' : 'none'; });
  // Topo direito: admin vê "⚙️ Configuração do Programa" (abre as configs); operador vê o nome.
  const ehAdmin = usuarioAtual && usuarioAtual.perfil === 'admin';
  const bCfg = $('btn-config-programa'), chipNome = $('user-chip-nome');
  if (bCfg) bCfg.style.display = ehAdmin ? '' : 'none';
  if (chipNome) chipNome.style.display = ehAdmin ? 'none' : '';
  try { montarTopo(); } catch (e) { console.error('montarTopo', e); }
  if (usuarioAtual) { try { iniciarIndicadores(); } catch {} } else { try { pararIndicadores(); } catch {} }
}
function mostrarTelaLogin() {
  sessionStorage.removeItem('acai_logado');
  usuarioAtual = null;
  desconectarEventos(); // Fase 16: fecha o canal em tempo real ao sair/expirar sessão
  pararPollDashboard(); // Fase 17: para o refresh do dashboard
  atualizarMenuAdmin();
  $('app-principal').classList.add('oculto');
  $('tela-login').classList.remove('oculto');
  $('form-login').reset();
  carregarUsuariosLogin();   // popula os usuários e foca o 1º chip (setas navegam, Tab vai pra senha)
}
/* Tela de login: mostra os usuários cadastrados como botões — clicar preenche o usuário
   e pula pra senha (não precisa saber/digitar o nome de usuário). */
// mapa login→nome (pra NUNCA mostrar o "admin"/login cru em campos de operador/criador)
let MAPA_USUARIOS = {};
function nomeOp(login) {
  if (login == null || login === '') return '—';
  return MAPA_USUARIOS[String(login).toLowerCase().trim()] || login;   // desconhecido → mostra como veio
}
async function carregarUsuariosLogin() {
  const box = $('login-usuarios'); if (!box) return;
  const irSenha = () => { const s = $('login-senha'); if (s) s.focus(); };
  try {
    const us = await (await fetch('/api/auth/usuarios', { cache: 'no-store' })).json();
    if (Array.isArray(us)) us.forEach(u => { if (u && u.usuario) MAPA_USUARIOS[String(u.usuario).toLowerCase().trim()] = u.nome || u.usuario; });
    if (!Array.isArray(us) || !us.length) { box.innerHTML = ''; box.style.display = 'none'; const u = $('login-user'); if (u) u.focus(); return; }
    box.style.display = '';
    box.innerHTML = us.map((u, i) => `<button type="button" class="login-user-chip" role="option" data-u="${crmEsc(u.usuario)}" tabindex="${i === 0 ? '0' : '-1'}"><span class="luc-ava">👤</span><span class="luc-nome">${crmEsc(u.nome || u.usuario)}</span></button>`).join('');
    const chips = [...box.querySelectorAll('.login-user-chip')];
    // seleciona um usuário: preenche o campo, marca visual e roving-tabindex (só o ativo é tabável)
    const selecionar = (b, foca) => {
      if (!b) return;
      $('login-user').value = b.dataset.u;
      chips.forEach(x => { const on = x === b; x.classList.toggle('sel', on); x.tabIndex = on ? 0 : -1; });
      if (foca) b.focus();
    };
    chips.forEach((b, i) => {
      b.addEventListener('click', () => { selecionar(b, true); irSenha(); });
      b.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); selecionar(chips[(i + 1) % chips.length], true); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); selecionar(chips[(i - 1 + chips.length) % chips.length], true); }
        else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selecionar(b, false); irSenha(); }   // Tab/Enter → senha
      });
    });
    selecionar(chips[0], true);   // pré-seleciona e foca o 1º → setas já funcionam, sem mouse
  } catch { box.innerHTML = ''; box.style.display = 'none'; const u = $('login-user'); if (u) u.focus(); }
}
carregarUsuariosLogin();   // popula já no carregamento (a tela de login aparece por padrão)
function logout() {
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); // encerra a sessão no servidor
  mostrarTelaLogin();
}
/* Depois de logar, recarrega os dados que falharam com 401 antes do login */
function recarregarDadosPosLogin() {
  carregarEstoque().then(importarFinanceiroInicial).catch(() => {});
  carregarClientes();
  carregarPedidos().then(renderDelivery).catch(() => {});
  if (typeof carregarAnotacoes === 'function') carregarAnotacoes();   // caixa de anotações do PDV
  atualizarBadgeFila();
  processarFila(); // reenvia pendências offline assim que loga
}

$('form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const u = $('login-user').value.trim().toLowerCase();
  const s = $('login-senha').value;
  if (!u || !s) return;
  try {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: u, senha: s }) });
    if (r.ok) {
      usuarioAtual = await r.json();
      $('login-erro').textContent = '';
      fazerLogin(usuarioAtual.nome);
      recarregarDadosPosLogin();
    } else {
      $('login-erro').textContent = '⚠️ Usuário ou senha inválidos';
      $('login-senha').value = '';
      $('login-senha').focus();
    }
  } catch { $('login-erro').textContent = '⚠️ Servidor indisponível'; }
});
$('login-user').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('login-senha').focus(); }
});
$('btn-sair').addEventListener('click', logout);
{ const bc = $('btn-config-programa'); if (bc) bc.addEventListener('click', () => irPara('administracao')); }
// Botão DISCRETO de FECHAR o programa (canto, quase invisível — pra não clicar sem querer).
// Como abre em tela cheia sem barra, quem usa só o mouse/touch fecha por aqui (com confirmação).
(function botaoFecharApp() {
  const b = document.createElement('button');
  b.id = 'btn-fechar-app'; b.type = 'button'; b.title = 'Fechar o programa'; b.textContent = '⏻';
  b.addEventListener('click', () => {
    if (!confirm('Fechar o programa?')) return;
    try { window.close(); } catch {}
    setTimeout(() => { try { window.open('', '_self'); window.close(); } catch {} }, 60);
  });
  document.body.appendChild(b);
})();

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
  focusCodigoMercadoria();
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
  if (t.dataset.ptab === 'custos')  renderCustosProducao();
}));

/* ── Custos & Produção (Fase 19) — lê do backend (custo por produto + produções) ── */
let _custosCache = [];
async function renderCustosProducao() {
  try {
    const [custos, producoes] = await Promise.all([
      fetch('/api/custos', { cache: 'no-store' }).then(r => r.json()).catch(() => []),
      fetch('/api/producoes', { cache: 'no-store' }).then(r => r.json()).catch(() => []),
    ]);
    _custosCache = Array.isArray(custos) ? custos : [];
    // produções
    $('prod-list-tbody').innerHTML = (producoes && producoes.length)
      ? producoes.map(p => `<tr>
          <td>${fmtDataHora(p.data || p.criado_em)}</td>
          <td>${escapar(p.descricao || '—')}</td>
          <td><span class="prod-badge">${escapar(p.tipo || 'produção')}</span></td>
          <td class="col-num"><strong>${fmt(p.custo_total)}</strong></td>
        </tr>`).join('')
      : `<tr><td colspan="4" style="text-align:center;padding:24px;color:rgba(15,47,77,.4)">Nenhuma produção registrada ainda</td></tr>`;
    renderTabelaCustos();
  } catch { /* silencioso */ }
}
function renderTabelaCustos() {
  const filtro = ($('custos-filtro').value || '').trim().toLowerCase();
  const lista = filtro ? _custosCache.filter(c => (c.nome || '').toLowerCase().includes(filtro) || (c.codigo || '').toLowerCase().includes(filtro)) : _custosCache;
  // alerta inteligente: quantos sem custo, quantos vendem abaixo do custo (prejuízo), margem média
  const box = $('custos-insight');
  if (box) {
    const comVenda = _custosCache.filter(c => (+c.precoVenda || 0) > 0);
    const semCusto = _custosCache.filter(c => !(+c.custo > 0)).length;
    const prejuizo = comVenda.filter(c => (+c.custo || 0) > 0 && +c.precoVenda < +c.custo);
    const margMedia = comVenda.length ? comVenda.reduce((s, c) => s + (+c.margem || 0), 0) / comVenda.length : 0;
    const partes = [`📊 Margem média <b>${(margMedia * 100).toFixed(1)}%</b>`];
    if (prejuizo.length) partes.push(`🔴 <b>${prejuizo.length}</b> vendendo abaixo do custo`);
    if (semCusto) partes.push(`⚠️ <b>${semCusto}</b> sem custo cadastrado`);
    box.innerHTML = partes.join(' · ');
  }
  $('custos-tbody').innerHTML = lista.length ? lista.map(c => {
    const m = +c.margem || 0, custo = +c.custo || 0, venda = +c.precoVenda || 0;
    const cls = m >= 0.3 ? 'verde' : (m > 0 ? 'amarelo' : 'vermelho');
    const rowCls = (custo > 0 && venda > 0 && venda < custo) ? 'custos-prejuizo' : (!(custo > 0) ? 'custos-semcusto' : '');
    return `<tr class="${rowCls}">
      <td>${escapar(c.codigo)}</td>
      <td>${escapar(c.nome || '—')}</td>
      <td class="col-num">${custo > 0 ? fmt(custo) : '<span class="custos-tag">sem custo</span>'}</td>
      <td class="col-num">${fmt(venda)}</td>
      <td class="col-num"><strong class="${cls}">${(m * 100).toFixed(1)}%</strong></td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" style="text-align:center;padding:24px;color:rgba(15,47,77,.4)">Nenhum produto</td></tr>`;
}
{ const cf = $('custos-filtro'); if (cf) cf.addEventListener('input', renderTabelaCustos); }

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
    descricao_conjunto: ($('pf-conjunto-nome') ? $('pf-conjunto-nome').value.trim() : ''),
    departamento: $('pf-departamento').value.trim(),
    fornecedor: $('pf-fornecedor').value.trim(),
    precoCompra: +$('pf-compra').value || 0,
    precoVenda: +$('pf-venda').value || 0,
    estoqueMin: +$('pf-min').value || 0,
    unidPorCaixa: +$('pf-unidcaixa').value || 0,
    precoVendaCaixa: +$('pf-vendacaixa').value || 0,
    granel: ($('pf-granel') && $('pf-granel').checked) ? 1 : 0,
  };
  let p = PRODUTOS.find(x => x.codigo.toLowerCase() === cod.toLowerCase());
  let estoqueAntes = 0;
  if (p) {
    estoqueAntes = +p.estoque || 0;
    Object.assign(p, dados);
    p.estoque = estoqueAntes + entrada;
    toast(`✅ ${p.nome} atualizado${entrada ? ` (+${entrada} no estoque)` : ''}`, 'sucesso');
  } else {
    p = { ...dados, estoque: entrada };
    PRODUTOS.push(p);
    toast(`✅ ${dados.nome} cadastrado`, 'sucesso');
  }
  // registra a compra como gasto (entrada com valor pago OU com nota fiscal informada)
  const numNota = $('pf-nota').value.trim();
  const valorTotalCompra = (+$('pf-valortotal').value || 0) || (entrada * (dados.precoCompra || 0));
  const dataEntrada = ($('pf-data-entrada') || {}).value || '';
  const horaCompra = dataEntrada ? new Date(dataEntrada + 'T12:00:00').toISOString() : new Date().toISOString();
  if (entrada > 0 && (valorTotalCompra > 0 || numNota)) {
    const compra = { hora: horaCompra, codigo: dados.codigo, nome: dados.nome, qtd: entrada, total: valorTotalCompra, numNota, fornecedor: dados.fornecedor, forma_pagamento: (($('pf-pagamento') || {}).value || '') };
    comprasLog.push(compra); salvarComprasLog(); salvarCompraBackend(compra);
  }
  salvarEstoque();
  if (entrada > 0) logMov(p.codigo, 'entrada', entrada, estoqueAntes, p.estoque, 'entrada mercadoria', numNota ? ('nota ' + numNota) : 'nota'); // audit (depois do sync)
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
{ const av = $('pf-avancado-btn'); if (av) av.addEventListener('click', () => { const box = $('pf-avancado'), fechado = box.style.display === 'none'; box.style.display = fechado ? '' : 'none'; const s = av.querySelector('.pf-av-seta'); if (s) s.textContent = fechado ? '▴' : '▾'; }); }
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
  { const ab = $('rend-r-aloc-box'); if (ab) ab.style.display = ''; }       // "Custo alocado" no uso normal
  consumoInternoDia = 0; consumoInternoCustoDia = 0;                        // rendimento manual não desconta consumo interno
  // reseta o modo "latas de valores diferentes"
  { const c = $('rend-latas-var'); if (c) c.checked = false; }
  { const b = $('rend-latas-box'); if (b) b.style.display = 'none'; }
  { const r = $('rend-latas-rows'); if (r) r.innerHTML = ''; }
  ['rend-qtd-materia', 'rend-valor-unit'].forEach(id => { const el = $(id); if (el) el.readOnly = false; });
  $('rend-linhas').innerHTML = '';
  addLinhaRendimento(); addLinhaRendimento(); addLinhaRendimento();   // começa com 3 linhas (ex.: 10/15/20)
  recalcularRendimento();
  atualizarResumoNotaRend();
  $('overlay-rendimento').classList.add('aberto');
  observarFitModal(document.querySelector('#overlay-rendimento .modal-rend'));   // cabe inteiro na tela, sem rolar
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
  observarFitModal(null); { const mr = document.querySelector('#overlay-rendimento .modal-rend'); if (mr) mr.style.zoom = ''; }
  litrosBaixaPendente = false;   // fechou SEM gravar → não dá baixa; litros/latas/gelado ficam pendentes
  { const lb = $('rend-lucro-box'); if (lb) lb.style.display = 'none'; }
  { const ab = $('rend-r-aloc-box'); if (ab) ab.style.display = ''; }
  { const bar = $('rend-lucro-bar'); if (bar) bar.style.display = ''; }
  // veio do Finalizar (F8)? volta pra tela de onde saiu (ESC/fechar/gravar). Senão fica em produtos.
  if (telaAntesRendimento) { const t = telaAntesRendimento; telaAntesRendimento = null; irPara(t); }
  else { const n = $('pf-nota'); if (n) n.focus(); }
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

  let somaAloc = 0, linhasValidas = 0, somaReceita = 0;
  linhas.forEach(l => {
    const qtd = +l.querySelector('.rl-qtd').value || 0;
    const preco = +l.querySelector('.rl-preco').value || 0;
    somaReceita += preco * qtd;                           // faturamento potencial (qtd × preço venda)
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

  // LUCRO desta tela = faturamento (qtd × preço) − custo da matéria − consumo interno do dia. Negativo = vermelho.
  const consumoV = +consumoInternoDia || 0;          // valor consumido (preço de venda) — só mostra
  const consumoC = +consumoInternoCustoDia || 0;     // custo do consumo — é o que desconta
  const lucro = r2loc(somaReceita - total - consumoC);
  const qtdLatas = +$('rend-qtd-materia').value || 0;
  const lucroLata = qtdLatas > 0 ? r2loc(lucro / qtdLatas) : 0;
  { const lb = $('rend-lucro-bar'); if (lb) {
      lb.innerHTML = `<div class="rlb-quebra"><span>Faturamento <small>(venda)</small></span><b>${fmt(somaReceita)}</b>`
        + `<span>− Custo da matéria</span><b class="neg">${fmt(total)}</b>`
        + (consumoV > 0 ? `<span>− Consumo interno <small>(só o custo · consumido ${fmt(consumoV)})</small></span><b class="neg">${fmt(consumoC)}</b>` : '')
        + `</div><div class="rlb-total"><span>💰 Lucro</span><b>${fmt(lucro)}</b></div>`
        + (qtdLatas > 0 ? `<div class="rlb-porlata"><span>Lucro por lata <small>(${biNum(qtdLatas)} lata(s))</small></span><b>${fmt(lucroLata)}</b></div>` : '');
      lb.classList.toggle('neg', lucro < 0);
  } }

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
// Fase 19: agora o rendimento vira uma PRODUÇÃO no backend — é ele quem sobe o estoque do produto
// final (com movimento auditado), calcula/grava o custo por produto e registra o gasto da
// matéria-prima em compras. O frontend só monta o payload e recarrega os produtos do servidor.
async function confirmarRendimento() {
  const total = +$('rend-total').value || 0;
  if (total <= 0) { toast('⚠ Informe o valor total pago', 'erro'); return; }
  const dep = $('rend-departamento').value.trim();
  const forn = $('rend-fornecedor').value.trim();
  const materia = $('rend-materia').value.trim();
  const qtdMateria = +$('rend-qtd-materia').value || 1;
  const valorUnit = +$('rend-valor-unit').value || total;

  const linhas = [...$('rend-linhas').querySelectorAll('.rend-linha')];
  const saidas = [];
  let incompleta = false;
  linhas.forEach(l => {
    const cod = l.querySelector('.rl-cod').value.trim();
    const desc = l.querySelector('.rl-desc').value.trim();
    const qtd = +l.querySelector('.rl-qtd').value || 0;
    const preco = +l.querySelector('.rl-preco').value || 0;
    const custo = +l.querySelector('.rl-custo').value || 0;
    if (!cod && !desc && !qtd && !preco) return;           // linha em branco: ignora
    if (!cod || !desc || qtd <= 0 || preco <= 0) { incompleta = true; return; }
    saidas.push({ produto_codigo: cod.toUpperCase(), descricao: desc, quantidade: qtd, preco_venda: preco, custo_unitario_resultante: custo, unidade: 'un' });
  });
  if (incompleta) { toast('⚠ Preencha código, descrição, qtd e preço em todas as linhas', 'erro'); return; }
  if (saidas.length === 0) { toast('⚠ Adicione ao menos um produto', 'erro'); return; }

  const payload = {
    tipo: 'rendimento', descricao: materia || 'Processamento', origem: 'manual',
    departamento: dep, fornecedor: forn, numNota: $('rend-nota').value.trim(), registrar_compra: true,
    entrada: [{ tipo_item: 'materia', descricao: materia || 'Matéria-prima', quantidade: qtdMateria, unidade: 'un', custo_unitario: valorUnit, subtotal: total }],
    saida: saidas,
  };
  const btn = $('btn-confirmar-rend'); if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/producoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.erro || 'Falha ao registrar a produção', 'erro'); if (btn) btn.disabled = false; return; }
  } catch { toast('Sem conexão com o servidor', 'erro'); if (btn) btn.disabled = false; return; }

  // BAIXA do dia — só AGORA (depois de gravar): consome litros + latas + GELADO (somem da lista)
  if (litrosBaixaPendente) {
    try { await fetch('/api/litros/fechar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gelado: true }) }); } catch {}
    try { await fetch('/api/latas/fechar', { method: 'POST', headers: { 'Content-Type': 'application/json' } }); } catch {}
    try { await fetch('/api/consumo-interno/fechar', { method: 'POST', headers: { 'Content-Type': 'application/json' } }); } catch {}   // consumo interno some do lucro, fica na lista
    litrosBaixaPendente = false;
  }

  // memoriza a composição (pra reaproveitar quando a mesma matéria-prima for digitada de novo)
  const chave = chaveMateria(materia);
  if (chave) {
    receitasRendimento[chave] = { nomeOriginal: materia, itens: saidas.map(s => ({ cod: s.produto_codigo, desc: s.descricao, preco: s.preco_venda })) };
    salvarReceitasRendimento();
  }
  // mantém o resumo local da nota (UX) sem reenviar a compra ao backend (a produção já registrou)
  comprasLog.push({ hora: new Date().toISOString(), codigo: '(rendimento)', nome: materia || 'Processamento', qtd: qtdMateria, total, numNota: $('rend-nota').value.trim() });
  salvarComprasLog();

  await carregarEstoque();     // recarrega PRODUTOS do backend (estoque e custo já subiram lá)
  fecharRendimento();
  atualizarResumoNotaForm();
  renderProdutos();
  toast(`✅ ${saidas.length} produto(s) gerados de ${materia || 'matéria-prima'} · ${fmt(total)}`, 'sucesso');
}
$('btn-confirmar-rend').addEventListener('click', confirmarRendimento);

// ── Matéria de LATAS com VALORES DIFERENTES: lança cada (qtd × valor) e SOMA → preenche a matéria ──
function rendLataRow(qtd, valor) {
  const div = document.createElement('div'); div.className = 'rend-lata-row';
  div.innerHTML = `<input type="number" step="0.01" min="0" class="rl-mq" inputmode="decimal" placeholder="qtd" value="${qtd || ''}">`
    + `<input type="number" step="0.01" min="0" class="rl-mv" inputmode="decimal" placeholder="valor un. (R$)" value="${valor || ''}">`
    + `<button type="button" class="rl-mdel" title="Remover">🗑</button>`;
  return div;
}
function recalcularLatasMulti() {
  const rows = [...$('rend-latas-rows').querySelectorAll('.rend-lata-row')];
  let qt = 0, tot = 0;
  rows.forEach(r => { const q = +r.querySelector('.rl-mq').value || 0, v = +r.querySelector('.rl-mv').value || 0; qt += q; tot += q * v; });
  qt = r2loc(qt); tot = r2loc(tot);
  $('rend-latas-qt').textContent = biNum(qt);
  $('rend-latas-total').textContent = fmt(tot);
  $('rend-qtd-materia').value = qt || '';
  $('rend-valor-unit').value = qt > 0 ? r2loc(tot / qt) : '';   // valor unitário = média ponderada
  $('rend-total').value = tot ? tot.toFixed(2) : '';
  recalcularRendimento();
}
{
  const cb = $('rend-latas-var');
  if (cb) cb.addEventListener('change', () => {
    const box = $('rend-latas-box'); if (box) box.style.display = cb.checked ? '' : 'none';
    ['rend-qtd-materia', 'rend-valor-unit'].forEach(id => { const el = $(id); if (el) el.readOnly = cb.checked; });   // no modo soma, os campos vêm das latas
    const rows = $('rend-latas-rows');
    if (cb.checked) { if (!rows.children.length) rows.appendChild(rendLataRow()); recalcularLatasMulti(); setTimeout(() => { const f = rows.querySelector('.rl-mq'); if (f) f.focus(); }, 40); }
    else { rows.innerHTML = ''; }
  });
  const addb = $('rend-latas-add');
  if (addb) addb.addEventListener('click', () => { const rows = $('rend-latas-rows'); rows.appendChild(rendLataRow()); const qs = rows.querySelectorAll('.rl-mq'); const last = qs[qs.length - 1]; if (last) last.focus(); });
  const rowsBox = $('rend-latas-rows');
  if (rowsBox) {
    rowsBox.addEventListener('input', recalcularLatasMulti);
    rowsBox.addEventListener('click', e => { if (!e.target.classList.contains('rl-mdel')) return; e.target.closest('.rend-lata-row').remove(); if (!rowsBox.children.length) rowsBox.appendChild(rendLataRow()); recalcularLatasMulti(); });
    rowsBox.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return; e.preventDefault();
      if (e.target.classList.contains('rl-mq')) { const v = e.target.closest('.rend-lata-row').querySelector('.rl-mv'); if (v) v.focus(); }
      else if (e.target.classList.contains('rl-mv')) $('rend-latas-add').click();
    });
  }
}

// Estoque em conjunto (caixas) / unidades soltas / total, a partir do estoque e das unid. por caixa.
function atualizarEstoqueCards(p) {
  const conj = $('pf-est-conj'), un = $('pf-est-un'), tot = $('pf-est-total');
  if (!conj) return;
  if (!p) { conj.textContent = '—'; un.textContent = '—'; tot.textContent = '—'; return; }
  const total = Math.round((+p.estoque || 0) * 100) / 100, uncx = +p.unidPorCaixa || 0;
  const caixas = uncx > 0 ? Math.floor(total / uncx) : 0;
  const soltas = uncx > 0 ? Math.round((total - caixas * uncx) * 100) / 100 : total;
  conj.textContent = uncx > 0 ? caixas : '—';
  un.textContent = soltas;
  tot.textContent = total;
}
function limparFormProduto() {
  ['pf-codigo','pf-conjunto','pf-conjunto-nome','pf-nome','pf-departamento','pf-fornecedor','pf-compra','pf-venda','pf-entrada','pf-valortotal','pf-min','pf-caixas','pf-unidcaixa','pf-valorcaixa','pf-vendacaixa','pf-nota']
    .forEach(id => { const el = $(id); if (el) el.value = ''; });
  { const pg = $('pf-pagamento'); if (pg) pg.value = ''; }
  { const g = $('pf-granel'); if (g) g.checked = false; }
  { const dt = $('pf-data-entrada'); if (dt) dt.value = new Date().toISOString().slice(0, 10); }
  atualizarEstoqueCards(null);
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
  { const cn = $('pf-conjunto-nome'); if (cn) cn.value = p.descricao_conjunto || ''; }
  { const g = $('pf-granel'); if (g) g.checked = !!(+p.granel); }
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
  { const dt = $('pf-data-entrada'); if (dt && !dt.value) dt.value = new Date().toISOString().slice(0, 10); }
  atualizarEstoqueCards(p);
  // pf-nota NÃO é limpo aqui: ao carregar um produto pra dar entrada, a nota da sessão continua valendo
  atualizarMargemForm();
  mostrarDetalheProduto(p.codigo);
  $('pf-nome').focus();
}
/* Excluir produto definitivamente do cadastro */
async function excluirProduto(cod) {
  const p = PRODUTOS.find(x => x.codigo === cod);
  if (!p) return;
  if (!(await garantirSupervisor('Excluir produto precisa da autorização do supervisor.'))) return; // operador exige senha (Fase 12)
  if (confirm(`Excluir definitivamente "${p.nome}" (${p.codigo})?\nEssa ação não pode ser desfeita.`)) {
    PRODUTOS = PRODUTOS.filter(x => x.codigo !== cod);
    salvarEstoque();
    fetch('/api/produtos/' + encodeURIComponent(cod), { method: 'DELETE' }).catch(() => {}); // remove no backend (o sync não apaga)
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
  carregarFichaProduto(p.codigo); // Fase 21: ficha técnica do produto
}
function esconderDetalheProduto() {
  produtoDetalheAtual = null;
  $('pd-conteudo').style.display = 'none';
  // com produtos cadastrados, a lista já os mostra — o hint grande fica só quando está vazio
  $('pd-vazio').style.display = PRODUTOS.length ? 'none' : '';
}

/* ── FICHA TÉCNICA / RECEITA (Fase 21) — editor no detalhe do produto ── */
let fichaCod = null;         // produto da ficha aberta
let fichaItens = [];         // itens em edição [{tipo_item, referencia_id, descricao, quantidade, unidade}]
let fichaInsumos = [];       // cache de insumos do backend (id, nome, custo_unitario, unidade)
async function carregarFichaProduto(cod) {
  fichaCod = cod; fichaItens = [];
  try {
    // insumos do backend (para os selects e o custo estimado ao vivo)
    if (!fichaInsumos.length) fichaInsumos = await (await fetch('/api/insumos', { cache: 'no-store' })).json().catch(() => []);
    const f = await (await fetch('/api/produtos/' + encodeURIComponent(cod) + '/ficha', { cache: 'no-store' })).json();
    if (cod !== produtoDetalheAtual) return; // trocou de produto enquanto buscava
    fichaItens = (f.itens || []).map(it => ({ tipo_item: it.tipo_item, referencia_id: String(it.referencia_id), descricao: it.descricao, quantidade: +it.quantidade || 0, unidade: it.unidade || '' }));
  } catch { fichaItens = []; }
  preencherFichaRefSelect();
  renderFichaEditor();
}
function custoRefUnitarioFront(tipo, ref) {
  if (tipo === 'insumo') { const i = fichaInsumos.find(x => String(x.id) === String(ref)); return i ? (+i.custo_unitario || 0) : 0; }
  const p = PRODUTOS.find(x => x.codigo === String(ref)); return p ? (+p.precoCompra || 0) : 0;
}
function nomeRef(tipo, ref) {
  if (tipo === 'insumo') { const i = fichaInsumos.find(x => String(x.id) === String(ref)); return i ? i.nome : ('#' + ref); }
  const p = PRODUTOS.find(x => x.codigo === String(ref)); return p ? p.nome : String(ref);
}
function preencherFichaRefSelect() {
  const tipo = $('pdf-tipo').value;
  const sel = $('pdf-ref');
  if (tipo === 'insumo') {
    sel.innerHTML = fichaInsumos.length ? fichaInsumos.map(i => `<option value="${i.id}">${escapar(i.nome)} (${escapar(i.unidade || 'un')})</option>`).join('') : '<option value="">— sem insumos cadastrados —</option>';
  } else {
    sel.innerHTML = PRODUTOS.filter(p => p.codigo !== fichaCod).map(p => `<option value="${escapar(p.codigo)}">${escapar(p.nome)}</option>`).join('');
  }
}
function renderFichaEditor() {
  const box = $('pd-ficha-itens');
  if (!fichaItens.length) {
    box.innerHTML = '<div class="pd-ficha-vazio">Sem ficha ainda — adicione os componentes abaixo.</div>';
  } else {
    box.innerHTML = fichaItens.map((it, idx) => {
      const cu = custoRefUnitarioFront(it.tipo_item, it.referencia_id);
      const sub = cu * (+it.quantidade || 0);
      return `<div class="pd-ficha-item">
        <span class="pfi-tipo ${it.tipo_item}">${it.tipo_item === 'insumo' ? '🧴' : '📦'}</span>
        <span class="pfi-nome">${escapar(nomeRef(it.tipo_item, it.referencia_id))}</span>
        <span class="pfi-qtd">${(+it.quantidade || 0)}${it.unidade ? ' ' + escapar(it.unidade) : ''}</span>
        <span class="pfi-sub">${fmt(sub)}</span>
        <button type="button" class="pfi-del" data-ficha-del="${idx}" title="Remover">✕</button>
      </div>`;
    }).join('');
  }
  const custo = fichaItens.reduce((s, it) => s + custoRefUnitarioFront(it.tipo_item, it.referencia_id) * (+it.quantidade || 0), 0);
  $('pd-ficha-custo').textContent = fichaItens.length ? `· custo ${fmt(custo)}` : '';
}
$('pdf-tipo').addEventListener('change', preencherFichaRefSelect);
$('pdf-add').addEventListener('click', () => {
  const tipo = $('pdf-tipo').value, ref = $('pdf-ref').value, qtd = +$('pdf-qtd').value || 0;
  if (!ref) { toast('Selecione um item', 'erro'); return; }
  if (qtd <= 0) { toast('Informe a quantidade', 'erro'); return; }
  const unidade = tipo === 'insumo' ? ((fichaInsumos.find(i => String(i.id) === String(ref)) || {}).unidade || 'un') : 'un';
  fichaItens.push({ tipo_item: tipo, referencia_id: String(ref), descricao: nomeRef(tipo, ref), quantidade: qtd, unidade });
  $('pdf-qtd').value = '';
  renderFichaEditor();
});
$('pd-ficha-itens').addEventListener('click', e => {
  const b = e.target.closest('[data-ficha-del]'); if (!b) return;
  fichaItens.splice(+b.dataset.fichaDel, 1); renderFichaEditor();
});
$('pdf-salvar').addEventListener('click', async () => {
  if (!fichaCod) return;
  try {
    const r = await fetch('/api/produtos/' + encodeURIComponent(fichaCod) + '/ficha', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: true, itens: fichaItens }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.erro || 'Não foi possível salvar a ficha', 'erro'); return; }
    const j = await r.json();
    toast(`✅ Ficha salva · custo ${fmt(j.custoEstimado)}`, 'sucesso');
    await carregarEstoque();                 // o custo (precoCompra) foi atualizado no backend
    if (produtoDetalheAtual === fichaCod) mostrarDetalheProduto(fichaCod);  // reflete o novo custo/margem
  } catch { toast('Sem conexão com o servidor', 'erro'); }
});

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
  const antes = +p.estoque || 0;
  p.estoque = Math.max(0, antes + delta);
  salvarEstoque();
  logMov(p.codigo, 'ajuste', Math.abs(delta), antes, p.estoque, 'ajuste manual', 'manual');
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
  const antes = +p.estoque || 0;
  p.estoque = Math.max(0, +v || 0);
  salvarEstoque();
  logMov(p.codigo, 'ajuste', p.estoque, antes, p.estoque, 'ajuste manual', 'manual');
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
  renderProdutosLista();
  if (produtoDetalheAtual && PRODUTOS.some(p => p.codigo === produtoDetalheAtual)) mostrarDetalheProduto(produtoDetalheAtual);
}
/* Lista de TODOS os produtos, sempre visível na tela de Produtos — resolve o
   "não aparecem". Clicar carrega o produto no formulário pra dar entrada/editar. */
let prodListaFiltro = '';
function renderProdutosLista() {
  const box = $('pd-lista'); if (!box) return;
  const termo = prodListaFiltro.trim().toLowerCase();
  const L = PRODUTOS
    .filter(p => !termo || (p.nome || '').toLowerCase().includes(termo) || (p.codigo || '').toLowerCase().includes(termo))
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  const baixos = PRODUTOS.filter(p => (+p.estoque || 0) <= (+p.estoqueMin || 0)).length;
  box.innerHTML = `
    <div class="pd-lista-head">
      <span>📦 <b>${PRODUTOS.length}</b> produtos${baixos ? ` · <span class="pd-lista-baixo">⚠ ${baixos} em falta</span>` : ''}</span>
      <input type="search" id="pd-lista-busca" placeholder="🔎 filtrar..." value="${crmEsc(prodListaFiltro)}" autocomplete="off">
    </div>
    <div class="pd-lista-grid">${L.length ? L.map(p => {
      const baixo = (+p.estoque || 0) <= (+p.estoqueMin || 0);
      return `<button type="button" class="pd-lista-item ${baixo ? 'baixo' : ''}" data-cod="${crmEsc(p.codigo)}">
        <span class="pli-info"><span class="pli-nome">${crmEsc(p.nome || p.codigo)}</span><span class="pli-cod">${crmEsc(p.codigo)}</span></span>
        <span class="pli-est">${biNum(p.estoque || 0)}${baixo ? ' ⚠' : ''}</span>
      </button>`;
    }).join('') : '<div class="pd-lista-vazio">Nenhum produto' + (termo ? ' no filtro.' : '. Cadastre pela Entrada de Mercadoria ao lado.') + '</div>'}</div>`;
  box.querySelectorAll('.pd-lista-item').forEach(b => b.addEventListener('click', () => {
    editarProdutoForm(b.dataset.cod);
    setTimeout(() => $('pf-entrada').focus(), 40);
    toast(`📦 ${b.dataset.cod} carregado — informe a entrada`);
  }));
  const busca = $('pd-lista-busca');
  if (busca) busca.addEventListener('input', e => { prodListaFiltro = e.target.value; renderProdutosLista(); const nb = $('pd-lista-busca'); if (nb) { nb.focus(); nb.setSelectionRange(nb.value.length, nb.value.length); } });
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
  const insumo = { nome, custo: +$('if-custo').value || 0, qtd: +$('if-qtd').value || 0, unidade: ($('if-unidade') && $('if-unidade').value) || 'un', hora: new Date().toISOString() };
  insumos.push(insumo);
  salvarInsumos();
  // Fase 10/19: persiste no backend (agora com unidade; o backend cria saldo + movimento de entrada)
  fetch('/api/insumos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: insumo.nome, custo_total: insumo.custo, qtd: insumo.qtd, unidade: insumo.unidade }) })
    .then(r => r.json()).then(j => { if (j && j.id) { insumo._backendId = j.id; salvarInsumos(); } }).catch(() => {});
  $('form-insumo').reset();
  $('if-unit-preview').textContent = '';
  atualizarBtnInsumo();
  renderInsumos();
  if ($('tela-financeiro') && $('tela-financeiro').classList.contains('ativa') && typeof finCarregarBase === 'function') { try { finCarregarBase(); } catch {} }
  toast(`✅ Descartável lançado no fluxo (saída de ${fmt(insumo.custo)})`, 'sucesso');
});
// preview do valor por unidade + habilita o botão Finalizar só quando qtd E valor estão preenchidos
function atualizarBtnInsumo() {
  const q = +$('if-qtd').value || 0, c = +$('if-custo').value || 0;
  $('if-unit-preview').textContent = (q > 0 && c > 0) ? `Valor por unidade: ${fmt(c / q)} · ao finalizar sai ${fmt(c)} do caixa` : '';
  const b = $('if-finalizar'); if (b) b.disabled = !(q > 0 && c > 0 && ($('if-nome').value || '').trim());
}
['if-custo', 'if-qtd', 'if-nome'].forEach(id => { const e = $(id); if (e) e.addEventListener('input', atualizarBtnInsumo); });
atualizarBtnInsumo();
function excluirInsumo(i) {
  const insumo = insumos[i];
  insumos.splice(i, 1); salvarInsumos();
  if (insumo && insumo._backendId) fetch('/api/insumos/' + insumo._backendId, { method: 'DELETE' }).catch(() => {}); // remove no backend (se tiver id)
  renderInsumos(); renderProdutos();
}
function renderInsumos() {
  const total = insumos.reduce((s, i) => s + (+i.custo || 0), 0);
  $('insumo-resumo').innerHTML = `Total em descartáveis: <strong>${fmt(total)}</strong> <span style="opacity:.65">— cada entrada vira saída no fluxo de caixa (não entra no custo das mercadorias)</span>`;
  $('insumo-tbody').innerHTML = insumos.map((i, idx) => {
    const unit = (+i.qtd > 0) ? (+i.custo / +i.qtd) : null;
    return `<tr tabindex="0" data-idx="${idx}">
      <td>${i.nome}</td>
      <td class="col-num">${i.qtd ? i.qtd + (i.unidade ? ' ' + i.unidade : '') : '—'}</td>
      <td class="col-num">${fmt(i.custo)}</td>
      <td class="col-num">${unit != null ? `<strong>${fmt(unit)}</strong>` : '—'}</td>
      <td><button class="btn-mini-del" onclick="excluirInsumo(${idx})">🗑</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="text-align:center;padding:30px;color:rgba(15,47,77,.4)">Nenhum insumo cadastrado</td></tr>`;
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

/* Fase 14: o Histórico agora vem do BACKEND (fonte principal). Se o servidor cair,
   cai no cálculo local a partir do cache (renderHistoricoLocal) como fallback. */
function periodoParaDatas(p) {
  if (p === 'tudo') return { de: '', ate: '' };
  const fim = new Date().toISOString();
  const d = new Date();
  if (p === 'hoje') { d.setHours(0, 0, 0, 0); return { de: d.toISOString(), ate: fim }; }
  d.setDate(d.getDate() - (p === 'semana' ? 7 : 30) + 1); d.setHours(0, 0, 0, 0);
  return { de: d.toISOString(), ate: fim };
}
async function renderHistorico() {
  const { de, ate } = periodoParaDatas(histPeriodo);
  const q = new URLSearchParams(); if (de) q.set('de', de); if (ate) q.set('ate', ate);
  try {
    const [resumo, produtos] = await Promise.all([
      fetch('/api/historico/resumo?' + q, { cache: 'no-store' }).then(r => { if (!r.ok) throw 0; return r.json(); }),
      fetch('/api/historico/vendas-produtos?' + q, { cache: 'no-store' }).then(r => r.json()),
    ]);
    $('hist-vendas').textContent = resumo.qtdVendas;
    $('hist-itens').textContent = resumo.itens;
    $('hist-faturamento').textContent = fmt(resumo.faturamento);
    $('hist-pico').textContent = resumo.picoHora != null ? `${String(resumo.picoHora).padStart(2, '0')}h` : '—';
    $('gasto-compras').textContent = fmt(resumo.gastoCompras);
    $('gasto-insumos').textContent = fmt(resumo.gastoInsumos);
    $('gasto-total').textContent = fmt(resumo.gastos);
    $('saldo').textContent = fmt(resumo.saldo);
    $('saldo').style.color = resumo.saldo >= 0 ? 'var(--verde)' : 'var(--vermelho)';
    // cancelamentos aparecem no rótulo do card de vendas (sem novo elemento)
    const lblVendas = $('hist-vendas').parentElement.querySelector('.hc-lbl');
    if (lblVendas) lblVendas.textContent = 'Vendas registradas' + (resumo.cancelamentos ? ` · ${resumo.cancelamentos} cancelada(s)` : '');
    histProdutosCache = Array.isArray(produtos) ? produtos : [];
    histRenderTabela(); histInsight();
  } catch {
    renderHistoricoLocal(); // servidor offline → usa o cache local
  }
}
/* Histórico inteligente: cache dos produtos do período + busca rápida (client-side) + destaque. */
let histProdutosCache = [];
function histRenderTabela() {
  const bq = ($('hist-busca') ? $('hist-busca').value : '').toLowerCase().trim();
  const lista = bq ? histProdutosCache.filter(p => ((p.nome || '') + ' ' + (p.codigo || '')).toLowerCase().includes(bq)) : histProdutosCache;
  $('hist-tbody').innerHTML = lista.length
    ? lista.map(p => `<tr tabindex="0"><td>${escapar(p.nome || p.codigo)}</td><td class="col-num">${p.qtd}</td><td class="col-num">${fmt(p.valor)}</td>
        <td class="col-num">${p.ultima ? new Date(p.ultima).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td></tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;padding:30px;color:rgba(15,47,77,.4)">${bq ? 'Nada na busca' : 'Nenhuma venda no período'}</td></tr>`;
}
function histInsight() {
  const box = $('hist-insight'); if (!box) return;
  if (!histProdutosCache.length) { box.innerHTML = ''; return; }
  const topQtd = histProdutosCache.slice().sort((a, b) => (+b.qtd || 0) - (+a.qtd || 0))[0];
  const topFat = histProdutosCache.slice().sort((a, b) => (+b.valor || 0) - (+a.valor || 0))[0];
  box.innerHTML = `🥇 Mais vendido: <b>${escapar(topQtd.nome || topQtd.codigo)}</b> (${topQtd.qtd}) · 💰 Mais faturou: <b>${escapar(topFat.nome || topFat.codigo)}</b> (${fmt(topFat.valor)})`;
}
{ const b = $('hist-busca'); if (b) b.addEventListener('input', histRenderTabela); }
/* Fallback local (ex-fonte principal): calcula do cache vendasLog/comprasLog/insumos. */
function renderHistoricoLocal() {
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
  histProdutosCache = Object.values(porProduto).sort((a, b) => b.qtd - a.qtd);
  histRenderTabela(); histInsight();
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
    : `<tr><td colspan="4" style="text-align:center;padding:30px;color:rgba(15,47,77,.4)">Nenhuma nota fiscal lançada ainda</td></tr>`;
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

/* Fase 8: a fonte principal virou o backend (SQLite). O localStorage é CACHE/BACKUP.
   Carrega o cache primeiro (instantâneo), depois o servidor manda a versão oficial.
   Na 1ª vez (servidor vazio + cache com dados) faz a importação inicial — idempotente,
   sem apagar o localStorage. */
async function carregarClientes() {
  try { CLIENTES = JSON.parse(localStorage.getItem('acai_clientes') || '[]'); } catch { CLIENTES = []; }
  try {
    let dados = await (await fetch('/api/clientes?full=1', { cache: 'no-store' })).json();
    if (Array.isArray(dados) && dados.length === 0 && CLIENTES.length > 0) {
      const rel = await (await fetch('/api/clientes/importar-localstorage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientes: CLIENTES }),
      })).json();
      console.log('📥 Clientes importados pro servidor:', rel);
      if (rel && (rel.clientesImportados || rel.lancamentosImportados)) toast(`📥 ${rel.clientesImportados} clientes e ${rel.lancamentosImportados} lançamentos importados`, 'sucesso');
      dados = await (await fetch('/api/clientes?full=1', { cache: 'no-store' })).json();
    }
    if (Array.isArray(dados)) { CLIENTES = dados; salvarClientes(); }
  } catch { /* servidor offline: segue com o cache local */ }
}
function salvarClientes() {
  // cache/backup local (o backend é a fonte da verdade; escrito pelos endpoints específicos)
  try { localStorage.setItem('acai_clientes', JSON.stringify(CLIENTES)); } catch {}
}
function buscarClientePorId(id) { return CLIENTES.find(c => c.id === id); }
/* Código do cliente = id do banco (único, atribuído na criação), formatado com zeros à esquerda.
   Cliente ainda offline (id 'local-...') mostra "novo" até sincronizar e ganhar o número. */
function clienteCodigo(c) {
  if (!c) return '—';
  return (typeof c.id === 'number') ? String(c.id).padStart(4, '0') : 'novo';
}
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
async function lancarNaContaCliente(clienteId, tipo, valor, desc, extra) {
  const c = buscarClientePorId(clienteId);
  if (!c) return null;
  const formasPagas = (extra && extra.formasPagas) || [];
  // PERSISTE no backend via fila offline (não duplica no reenvio, por client_request_id).
  // Se o servidor cair, cai no id local e o postComFila enfileira pra reenviar depois.
  const j = await postComFila('pagamento_fiado', `/api/clientes/${clienteId}/lancamentos`,
    { tipo, valor, descricao: desc, formas: formasPagas, referencia: (extra && extra.referencia) || '' });
  const lanc = j && j.lancamento;
  c.lancamentos = c.lancamentos || [];
  const id = lanc ? lanc.id : (c.lancSeq = (c.lancSeq || 0) + 1, 'local-' + c.lancSeq);
  c.lancamentos.push({ id, data: lanc ? lanc.data : new Date().toISOString(), tipo, valor, desc, formasPagas });
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
/* Remove um lançamento específico pelo "id" (não pelo índice — pode ter mudado de posição).
   Reverte também no backend (fonte da verdade). Usado pelo cancelamento de venda fiada. */
async function removerLancamentoPorId(clienteId, lancamentoId) {
  const c = buscarClientePorId(clienteId);
  if (!c) return false;
  const i = (c.lancamentos || []).findIndex(l => l.id === lancamentoId);
  if (i < 0) return false;
  c.lancamentos.splice(i, 1);
  salvarClientes();
  if (typeof lancamentoId === 'number') {
    try { await fetch(`/api/clientes/${clienteId}/lancamentos/${lancamentoId}`, { method: 'DELETE' }); }
    catch { toast('⚠ Estorno do fiado não chegou ao servidor (offline)'); }
  }
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
    el.textContent = j.numero ? `✅ WhatsApp conectado — ${formatarTelBR(j.numero)}${j.nome ? ' (' + j.nome + ')' : ''}` : '✅ WhatsApp conectado';
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

/* ── FASE 46A §4 — ATENDIMENTO em abas: Conversas · Conexão WhatsApp · Configurações.
   A configuração do WhatsApp fica CONCENTRADA aqui (reusa /api/whatsapp/* e aplicarStatusWpp).
   Não duplica lógica: só apresenta em um lugar melhor. ── */
let atTabAtual = 'conversas', atConxTimer = null, atConxUltimaSync = null;
function atIrTab(tab) {
  atTabAtual = tab;
  document.querySelectorAll('#at-tabs .at-tab').forEach(b => b.classList.toggle('ativo', b.dataset.attab === tab));
  ['conversas', 'conexao', 'config'].forEach(t => { const p = $('at-pane-' + t); if (p) p.style.display = t === tab ? '' : 'none'; });
  if (atConxTimer) { clearInterval(atConxTimer); atConxTimer = null; }
  if (tab === 'conexao') { renderAtConexao(); atConxRefresh(); atConxTimer = setInterval(atConxRefresh, 4000); }
  else if (tab === 'config') renderAtConfig();
}
function renderAtConexao() {
  const el = $('at-pane-conexao'); if (!el || el.dataset.pronto) return;
  el.innerHTML = `<div class="at-conx">
    <div class="at-conx-card">
      <h3>🔌 Conexão WhatsApp</h3>
      <div class="at-conx-status" id="at-conx-status">🔌 Verificando…</div>
      <div class="cl-whats-qr at-conx-qr" id="at-conx-qr" style="display:none"><img id="at-conx-qr-img" alt="QR Code do WhatsApp"><p>📱 No celular da loja: WhatsApp → <b>Aparelhos conectados → Conectar um aparelho</b> e escaneie.</p></div>
      <div class="at-conx-info"><span>🕒 Última sincronização</span><b id="at-conx-sync">—</b></div>
      <div class="at-conx-acoes">
        <button class="fin-btn-salvar" id="at-conx-reconectar">🔄 Reconectar / novo QR</button>
        <button class="fin-mini" id="at-conx-atualizar">↻ Atualizar status</button>
      </div>
      <p class="fin-hint">A conexão do WhatsApp agora fica só aqui (saiu da tela de Clientes). Para desconectar de vez, use o celular da loja em Aparelhos conectados.</p>
    </div></div>`;
  el.dataset.pronto = '1';
  $('at-conx-reconectar').addEventListener('click', async () => { const b = $('at-conx-reconectar'); b.disabled = true; b.textContent = '⏳ Conectando…'; try { await fetch('/api/whatsapp/conectar', { method: 'POST' }); } catch {} setTimeout(() => { b.disabled = false; b.textContent = '🔄 Reconectar / novo QR'; atConxRefresh(); }, 4000); });
  $('at-conx-atualizar').addEventListener('click', atConxRefresh);
}
async function atConxRefresh() {
  if (!$('at-conx-status')) return;
  try {
    const j = await (await fetch('/api/whatsapp/status', { cache: 'no-store' })).json();
    aplicarStatusWpp('at-conx-status', 'at-conx-qr', 'at-conx-qr-img', j);
    if (j.pronto || j.temQr) { atConxUltimaSync = new Date(); }
    const s = $('at-conx-sync'); if (s) s.textContent = atConxUltimaSync ? atConxUltimaSync.toLocaleTimeString('pt-BR') : '—';
    const dot = $('at-status-wpp'); // reflete no cabeçalho da coluna de conversas
    if (dot) { dot.textContent = j.pronto ? '● conectado' : '○ desconectado'; dot.className = 'at-status ' + (j.pronto ? 'on' : 'off'); }
  } catch { aplicarStatusWpp('at-conx-status', 'at-conx-qr', 'at-conx-qr-img', 'erro'); }
}
function renderAtConfig() {
  const el = $('at-pane-config'); if (!el) return;
  el.innerHTML = `<div class="at-conx"><div class="at-conx-card">
    <h3>⚙️ Configurações do Atendimento</h3>
    <label class="at-cfg-switch"><input type="checkbox" id="at-cfg-ia"> <span>🤖 IA responde sozinha quem escrever no WhatsApp</span></label>
    <p class="fin-hint">As demais configurações (cópia de pedidos, números, avisos) ficam em <b>Administração › Conectividade</b>.</p>
    <button class="fin-mini" id="at-cfg-conect">🔌 Abrir Conectividade</button>
  </div></div>`;
  // reusa o estado da IA automática (mesmo endpoint da Conectividade: /api/loja/estado)
  fetch('/api/loja/estado', { cache: 'no-store' }).then(r => r.json()).then(j => { const c = $('at-cfg-ia'); if (c) c.checked = !!(j && j.iaAuto); }).catch(() => {});
  $('at-cfg-ia').addEventListener('change', async e => {
    if (e.target.checked && !confirm('Ligar o atendimento automático? A IA responderá sozinha quem escrever neste WhatsApp.')) { e.target.checked = false; return; }
    try { const j = await (await fetch('/api/loja/estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ iaAuto: e.target.checked }) })).json(); e.target.checked = !!(j && j.iaAuto); if (typeof pintarIaAuto === 'function') pintarIaAuto(j.iaAuto); toast(e.target.checked ? '🤖 IA automática ligada' : '⏸ IA automática pausada'); } catch { toast('⚠ Falha ao salvar'); }
  });
  $('at-cfg-conect').addEventListener('click', () => irPara('conectividade'));
}
document.querySelectorAll('#at-tabs .at-tab').forEach(b => b.addEventListener('click', () => atIrTab(b.dataset.attab)));

// ── Cópia dos pedidos: números que recebem cópia de cada pedido novo ──
function formatarTelBR(t) {
  const d = (t || '').replace(/\D/g, '');
  const s = d.startsWith('55') ? d.slice(2) : d;               // tira o código do país pra exibir
  if (s.length >= 10) { const ddd = s.slice(0, 2), r = s.slice(2); return `(${ddd}) ${r.slice(0, -4)}-${r.slice(-4)}`; }
  return t;
}
function escCopia(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let copiaDestinatarios = [];
async function carregarDestinatariosCopia() {
  const box = $('copia-lista');
  if (!box) return;
  try { copiaDestinatarios = await (await fetch('/api/copia-pedido/destinatarios')).json(); } catch { return; }
  if (!copiaDestinatarios.length) { box.innerHTML = '<div class="hc-vazio">Nenhum número cadastrado ainda.</div>'; return; }
  box.innerHTML = copiaDestinatarios.map(d => {
    const on = !!d.ativo;
    return `<div class="hc-item" data-id="${d.id}">
      <div class="hc-item-info">
        <div class="hc-item-nome">${d.nome ? escCopia(d.nome) : 'Sem nome'}</div>
        <div class="hc-item-tel">${formatarTelBR(d.telefone)}</div>
      </div>
      <button class="dt-switch${on ? ' ligado' : ''}" data-acao="toggle" title="Ligar/desligar"></button>
      <span class="dt-estado ${on ? 'on' : 'off'}">${on ? 'Ligado' : 'Desligado'}</span>
      <button class="btn-hc-del" data-acao="del" title="Remover">🗑</button>
    </div>`;
  }).join('');
}
$('form-copia').addEventListener('submit', async e => {
  e.preventDefault();
  const nome = $('copia-nome').value.trim();
  const telefone = $('copia-telefone').value.replace(/\D/g, '');
  if (telefone.length < 10) { alert('Digite um telefone válido com DDD (ex.: 91 98454-0212).'); return; }
  try {
    const r = await fetch('/api/copia-pedido/destinatarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, telefone }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.erro || 'Não foi possível adicionar.'); return; }
    $('copia-nome').value = ''; $('copia-telefone').value = '';
    carregarDestinatariosCopia();
  } catch { alert('Servidor offline?'); }
});
$('copia-lista').addEventListener('click', async e => {
  const item = e.target.closest('.hc-item'); if (!item) return;
  const id = +item.dataset.id, acao = e.target.dataset.acao;
  if (acao === 'toggle') {
    const d = copiaDestinatarios.find(x => x.id === id); if (!d) return;
    await fetch(`/api/copia-pedido/destinatarios/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: d.ativo ? 0 : 1 }) });
    carregarDestinatariosCopia();
  } else if (acao === 'del') {
    const d = copiaDestinatarios.find(x => x.id === id);
    if (!confirm(`Remover ${d && d.nome ? d.nome : 'este número'} da cópia dos pedidos?`)) return;
    await fetch(`/api/copia-pedido/destinatarios/${id}`, { method: 'DELETE' });
    carregarDestinatariosCopia();
  }
});
carregarDestinatariosCopia();

// ── Atendimento automático (IA): liga/desliga a resposta automática aos clientes ──
let iaAutoEstado = false;
function pintarIaAuto(on) {
  iaAutoEstado = !!on;
  const sw = $('btn-ia-auto'), est = $('ia-auto-estado');
  if (sw) sw.classList.toggle('ligado', iaAutoEstado);
  if (est) { est.textContent = iaAutoEstado ? 'Ligado' : 'Desligado'; est.className = 'dt-estado ' + (iaAutoEstado ? 'on' : 'off'); }
}
async function carregarIaAuto() {
  try { const j = await (await fetch('/api/loja/estado')).json(); pintarIaAuto(j.iaAuto); } catch {}
}
if ($('btn-ia-auto')) {
  $('btn-ia-auto').addEventListener('click', async () => {
    const ligar = !iaAutoEstado;
    if (ligar && !confirm('Ligar o atendimento automático?\n\nA IA vai responder SOZINHA qualquer pessoa que escrever neste WhatsApp (inclusive contatos pessoais). O ideal é usar um número dedicado só pra loja.\n\nDeseja ligar mesmo assim?')) return;
    try {
      const j = await (await fetch('/api/loja/estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ iaAuto: ligar }) })).json();
      pintarIaAuto(j.iaAuto);
    } catch { alert('Servidor offline?'); }
  });
  carregarIaAuto();
}

// ── Avisos automáticos: 4 mensagens editáveis que a IA passa pro cliente quando ligadas ──
async function carregarAvisos() {
  const box = $('avisos-lista');
  if (!box) return;
  let avisos = [];
  try { avisos = await (await fetch('/api/avisos', { cache: 'no-store' })).json(); } catch { return; }
  if (!Array.isArray(avisos)) return;   // sessão expirada/erro → resposta não é lista (evita quebrar)
  box.innerHTML = avisos.map(a => {
    const on = !!a.ativo;
    return `<div class="aviso-linha" data-id="${a.id}">
      <input class="aviso-texto" maxlength="300" placeholder="Escreva um aviso (ex.: 🎉 Hoje açaí 1L por R$12!)" value="${escCopia(a.texto || '')}">
      <button class="dt-switch${on ? ' ligado' : ''}" data-acao="toggle" title="Ligar/desligar"></button>
      <span class="dt-estado ${on ? 'on' : 'off'}">${on ? 'Ligado' : 'Desligado'}</span>
    </div>`;
  }).join('');
}
async function salvarAviso(id, campos) {
  try { await fetch('/api/avisos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campos) }); } catch {}
}
if ($('avisos-lista')) {
  // liga/desliga o aviso
  $('avisos-lista').addEventListener('click', e => {
    if (!e.target.dataset || e.target.dataset.acao !== 'toggle') return;
    const linha = e.target.closest('.aviso-linha'); const id = +linha.dataset.id;
    const on = e.target.classList.toggle('ligado');
    const est = linha.querySelector('.dt-estado'); est.textContent = on ? 'Ligado' : 'Desligado'; est.className = 'dt-estado ' + (on ? 'on' : 'off');
    salvarAviso(id, { ativo: on ? 1 : 0 });
  });
  // salva o texto ao sair do campo
  $('avisos-lista').addEventListener('change', e => {
    if (!e.target.classList.contains('aviso-texto')) return;
    salvarAviso(+e.target.closest('.aviso-linha').dataset.id, { texto: e.target.value });
  });
  carregarAvisos();
}

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
  $('cl-d-codigo').textContent = '#' + clienteCodigo(c);
  $('cl-d-codigo').title = 'Código do cliente';
  $('cl-d-nome').textContent = c.nome;
  $('cl-d-nome').title = c.nome;
  $('cl-d-telefone').textContent = c.telefone || '—';
  $('cl-tag-bairro').textContent = c.bairro ? `📍 ${c.bairro}` : '';
  $('cl-tag-bairro').style.display = c.bairro ? '' : 'none';
  $('cl-d-endereco').textContent = c.endereco || '—';
  $('cl-d-obsmini').textContent = c.obs || '—';
  const saldo = saldoCliente(c);
  $('cl-saldo-num').textContent = fmt(saldo);
  $('cl-saldo-num').classList.toggle('devendo', saldo > 0);
  renderExtratoCliente(c);
  renderClienteCRM(id);
  clTrocarSubaba('resumo');   // sempre abre no Resumo
}
function renderExtratoCliente(c) {
  const el = $('cl-extrato');
  const asc = (c.lancamentos || []).map((l, i) => ({ ...l, i })).sort((a, b) => new Date(a.data) - new Date(b.data));
  if (asc.length === 0) { el.innerHTML = '<div class="cl-extrato-vazio">Nenhum lançamento ainda</div>'; return; }
  let corrido = 0;
  const comSaldo = asc.map(l => { corrido += (l.tipo === 'compra' ? l.valor : -l.valor); return { ...l, saldoApos: corrido }; });
  const totCompra = asc.filter(l => l.tipo === 'compra').reduce((s, l) => s + l.valor, 0);
  const totPago = asc.filter(l => l.tipo !== 'compra').reduce((s, l) => s + l.valor, 0);
  const saldoAtual = corrido;
  const resumo = `
    <div class="cl-ext-resumo">
      <div class="cl-ext-stat compra"><span>🛒 Comprou (fiado)</span><strong>${fmt(totCompra)}</strong></div>
      <div class="cl-ext-stat pago"><span>💰 Pagou</span><strong>${fmt(totPago)}</strong></div>
      <div class="cl-ext-stat saldo ${saldoAtual > 0.001 ? 'devendo' : ''}"><span>${saldoAtual > 0.001 ? '⚠️ Deve' : '✅ Em dia'}</span><strong>${fmt(saldoAtual)}</strong></div>
    </div>`;
  const cab = `<div class="cl-lanc-cab"><span>Data</span><span>Lançamento</span><span>Valor</span><span>Saldo</span></div>`;
  const linhas = comSaldo.slice().reverse().map(l => `
    <div class="cl-lanc-linha ${l.tipo}" tabindex="0" data-i="${l.i}" title="Delete para remover este lançamento">
      <span class="cll-data">${new Date(l.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${new Date(l.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="cll-tipo">${l.tipo === 'compra' ? '🛒 Compra fiado' : '💰 Pagamento' + ((l.formasPagas && l.formasPagas.length) ? ` (${l.formasPagas.map(f => f.nome).join(' + ')})` : '')}${l.desc ? ' · ' + l.desc : ''}</span>
      <span class="cll-valor">${l.tipo === 'compra' ? '+' : '−'}${fmt(l.valor)}</span>
      <span class="cll-saldo">${fmt(l.saldoApos)}</span>
    </div>`).join('');
  el.innerHTML = resumo + cab + `<div class="cl-ext-lista">${linhas}</div>`;
}
ativarNavLista($('cl-extrato'), '.cl-lanc-linha', {
  onDelete: linha => {
    const c = buscarClientePorId(clienteDetalheAtual);
    if (!c) return;
    if (!confirm('Remover este lançamento do extrato?')) return;
    const l = (c.lancamentos || [])[+linha.dataset.i];
    c.lancamentos.splice(+linha.dataset.i, 1);
    salvarClientes();
    // remove também no backend (fonte da verdade)
    if (l && typeof l.id === 'number') fetch(`/api/clientes/${c.id}/lancamentos/${l.id}`, { method: 'DELETE' }).catch(() => {});
    mostrarDetalheCliente(c.id);
  },
});

/* Formas em que o pagamento de fiado pode ser dividido (ex.: parte PIX + parte Cartão).
   Usadas pela TELA DE RECEBIMENTO (modal do botão "Receber Conta"). */
const CAMPOS_PGTO_CLIENTE = [
  { id: 'rcc-pix',      nome: 'PIX',            ico: '📱' },
  { id: 'rcc-dinheiro', nome: 'Dinheiro',       ico: '💵' },
  { id: 'rcc-credito',  nome: 'Cartão Crédito', ico: '💳' },
  { id: 'rcc-debito',   nome: 'Cartão Débito',  ico: '💳' },
  // Cartão Alimentação foi removido daqui: não faz sentido quitar uma dívida de fiado
  // com vale-alimentação (+20% em cima da dívida). Fica só nas formas que quitam de verdade.
];

function limparFormCliente() {
  ['cl-nome', 'cl-telefone', 'cl-bairro', 'cl-endereco', 'cl-obs', 'cl-nascimento', 'cl-tags', 'cl-autorizados'].forEach(id => $(id).value = '');
  $('cl-form-codigo').textContent = 'Novo';   // cadastro novo ainda não tem código (gerado ao gravar)
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
  $('cl-nascimento').value = (c.nascimento || '').slice(0, 10);
  $('cl-tags').value = c.tags || '';
  $('cl-autorizados').value = c.autorizados || '';
  $('cl-form-codigo').textContent = '#' + clienteCodigo(c);   // código no cabeçalho do form
  mostrarDetalheCliente(c.id);
  $('cl-nome').focus();
}

async function excluirCliente(id) {
  const c = buscarClientePorId(id);
  if (!c) return;
  if (!(await garantirSupervisor('Excluir cliente precisa da autorização do supervisor.'))) return; // operador exige senha (Fase 12)
  if (!confirm(`Excluir definitivamente "${c.nome}"?\nTodo o extrato e saldo serão perdidos. Essa ação não pode ser desfeita.`)) return;
  try { await fetch(`/api/clientes/${id}`, { method: 'DELETE' }); } catch {}
  CLIENTES.splice(CLIENTES.indexOf(c), 1);
  salvarClientes();
  limparFormCliente();
  toast(`🗑 ${c.nome} excluído`);
}
$('btn-cliente-excluir').addEventListener('click', () => clienteDetalheAtual && excluirCliente(clienteDetalheAtual));
$('cl-d-excluir').addEventListener('click', () => clienteDetalheAtual && excluirCliente(clienteDetalheAtual));

$('form-cliente').addEventListener('submit', async e => {
  e.preventDefault();
  const nome = $('cl-nome').value.trim();
  const telefone = $('cl-telefone').value.trim();
  if (!nome) return;   // telefone é OPCIONAL — dá pra criar conta só com o nome
  const dados = {
    nome, telefone,
    bairro: $('cl-bairro').value.trim(),
    endereco: $('cl-endereco').value.trim(),
    obs: $('cl-obs').value.trim(),
    nascimento: $('cl-nascimento').value || null,
    tags: $('cl-tags').value.trim() || null,
    autorizados: $('cl-autorizados').value.trim() || null,
  };
  let c = clienteDetalheAtual ? buscarClientePorId(clienteDetalheAtual) : null;
  if (!c) c = CLIENTES.find(x => x.nome.toLowerCase() === nome.toLowerCase());
  if (c) {                          // edição → PUT (mantém os lançamentos em memória)
    Object.assign(c, dados);
    try { await fetch(`/api/clientes/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) }); toast(`✅ ${nome} atualizado`); }
    catch { toast('⚠ Alteração salva só localmente (servidor offline)'); }
  } else {                          // novo → POST via fila offline (não duplica no reenvio)
    const novo = await postComFila('cliente', '/api/clientes', dados);
    c = (novo && novo.id) ? { ...novo, lancamentos: novo.lancamentos || [] } : { id: 'local-' + Date.now(), ...dados, lancamentos: [] };
    CLIENTES.push(c);
    if (novo && novo.id) toast(`✅ ${nome} cadastrado · Cód. ${clienteCodigo(c)}`);
  }
  salvarClientes();
  // pedido do Melque: ao gravar/alterar, limpa tudo e volta o foco pro Nome (nova busca)
  limparFormCliente();
});
ativarEnterProximo($('form-cliente'));

/* ── RECEBER CONTA (fiado) — botão que abre a busca de cliente e um modal de
   recebimento independente do detalhe. Reusa lancarNaContaCliente('pagamento'). ── */
// Abre o Recebimento de Contas: cliente já aberto → vai direto; senão abre a busca (autocompleta ao digitar).
function abrirReceberConta() {
  if (clienteDetalheAtual) abrirReceberContaModal(clienteDetalheAtual);
  else abrirBuscaProduto('receber-conta');
}
{ const b = $('btn-receber-conta'); if (b) b.addEventListener('click', abrirReceberConta); }
/* Comprovante de PAGAMENTO (recibo térmico 80mm) — reusa o iframe do motor de impressão.
   Só é chamado quando o operador clica em "Imprimir comprovante". */
function comprovantePagamentoHTML(d) {
  const w = 80;
  const formas = (d.formas || []).map(f => `<div class="lin"><span>${crmEsc(f.nome)}</span><span>${fmt(f.valor)}</span></div>`).join('');
  return `<html><head><meta charset="utf-8"><style>
    @page{size:${w}mm auto;margin:0}
    body{font-family:'Courier New',monospace;width:${w}mm;padding:4mm;font-size:12px;color:#000;margin:0}
    h3{text-align:center;margin:0 0 2px;font-size:14px}
    .c{text-align:center}.sub{font-size:11px}
    hr{border:0;border-top:1px dashed #000;margin:5px 0}
    .lin{display:flex;justify-content:space-between;gap:8px}
    .tot{font-size:15px;font-weight:bold;display:flex;justify-content:space-between}
  </style></head><body>
    <h3>${crmEsc(d.loja.loja_nome || 'Açaí do Centro')}</h3>
    ${d.loja.loja_telefone ? `<div class="c sub">${crmEsc(d.loja.loja_telefone)}</div>` : ''}
    ${d.loja.loja_endereco ? `<div class="c sub">${crmEsc(d.loja.loja_endereco)}</div>` : ''}
    <div class="c">COMPROVANTE DE PAGAMENTO</div><hr>
    <div class="lin"><span>Cliente</span><span>${crmEsc(d.cliente || '')}</span></div>
    <div class="lin"><span>Data</span><span>${d.data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
    ${d.operador ? `<div class="lin"><span>Recebido por</span><span>${crmEsc(nomeOp(d.operador))}</span></div>` : ''}
    <hr>
    <div class="tot"><span>VALOR PAGO</span><span>${fmt(d.valor)}</span></div>
    ${formas ? `<div style="margin-top:4px">${formas}</div>` : ''}
    <hr>
    <div class="lin"><span>Saldo anterior</span><span>${fmt(d.saldoAntes)}</span></div>
    <div class="lin"><span><b>Saldo atual</b></span><span><b>${fmt(d.saldoNovo)}</b></span></div>
    <hr><div class="c">Obrigado pela preferencia!</div>
    <div class="c sub">- comprovante nao fiscal -</div>
  </body></html>`;
}
function imprimirComprovantePagamento(d) {
  const frame = $('cp-print-frame');
  if (!frame) { toast('⚠ Sem área de impressão'); return; }
  try {
    const doc = frame.contentWindow.document; doc.open(); doc.write(comprovantePagamentoHTML(d)); doc.close();
    frame.contentWindow.focus(); frame.contentWindow.print();
    toast('🖨️ Comprovante enviado para impressão');
  } catch { toast('⚠ Impressora bloqueada pelo navegador'); }
}
function abrirReceberContaModal(clienteId) {
  const c = buscarClientePorId(clienteId);
  if (!c) { toast('⚠ Cliente não encontrado'); return; }
  const saldo = saldoCliente(c);
  abrirErpModal(`<h3 class="erp-modal-tit">💰 Receber conta <small class="op-ci-sub">${crmEsc(c.nome)}</small></h3>
    <div class="rcc">
      <div class="rcc-saldo ${saldo > 0 ? 'deve' : 'quite'}"><span>Saldo devedor</span><b>${fmt(saldo)}</b></div>
      <p class="rcc-dica">💡 Pode dividir em mais de uma forma (parte PIX, parte dinheiro…).</p>
      <div class="rcc-formas-v">
        ${CAMPOS_PGTO_CLIENTE.map(f => `<label class="rcc-forma-lin"><span class="rcc-forma-nome">${f.ico} ${f.nome}</span><input id="${f.id}" class="rcc-forma-val" type="number" step="0.01" min="0" placeholder="0,00" inputmode="decimal" autocomplete="off"></label>`).join('')}
      </div>
      <div class="rcc-total-lin"><span>Total recebido</span><b id="rcc-total">R$ 0,00</b>${saldo > 0 ? `<button type="button" class="rcc-tudo" id="rcc-tudo">Quitar tudo</button>` : ''}</div>
      <div class="rcc-resultado" id="rcc-resultado" style="display:none"></div>
      <div class="campo" style="margin-top:10px"><label>Observação (opcional)</label><input id="rcc-desc" placeholder="ex.: pagou parcial"></div>
      <div class="op-ci-rodape"><span class="op-ci-op">👤 ${crmEsc((usuarioAtual && usuarioAtual.nome) || '—')} · ${new Date().toLocaleDateString('pt-BR')}</span>
        <button class="fin-btn-salvar" id="rcc-confirmar" disabled>✅ Registrar recebimento</button></div>
    </div>`);
  $('modal-erp-box').classList.add('erp-rcc');   // visual azul (igual ao Recebimento)
  // ao SAIR da tela de recebimento (ESC, X, clique fora ou confirmar) → limpa tudo do cliente
  erpOnClose = () => { if ($('tela-clientes').classList.contains('ativa')) limparFormCliente(); };
  const ok = $('rcc-confirmar');
  const valorDe = f => parseFloat(String(($(f.id) || {}).value).replace(',', '.')) || 0;
  const totalDigitado = () => CAMPOS_PGTO_CLIENTE.reduce((s, f) => s + valorDe(f), 0);   // base (abate a conta)
  const recalc = () => {
    const t = totalDigitado(); $('rcc-total').textContent = fmt(t); ok.disabled = t <= 0;
    // troco (pagou mais que a nota) OU saldo que fica devendo (pagou menos)
    const res = $('rcc-resultado'); if (!res) return;
    const diff = Math.round((t - saldo) * 100) / 100;
    if (t <= 0) { res.style.display = 'none'; res.className = 'rcc-resultado'; res.innerHTML = ''; return; }
    res.style.display = '';
    if (diff > 0)       { res.className = 'rcc-resultado troco'; res.innerHTML = `💵 Troco <b>${fmt(diff)}</b> <small>(recebeu ${fmt(t)} de ${fmt(saldo)})</small>`; }
    else if (diff < 0)  { res.className = 'rcc-resultado deve';  res.innerHTML = `📌 Fica devendo <b>${fmt(-diff)}</b> <small>(pagou ${fmt(t)} de ${fmt(saldo)})</small>`; }
    else                { res.className = 'rcc-resultado quite'; res.innerHTML = `✅ Quitou a conta <small>(${fmt(saldo)})</small>`; }
  };
  CAMPOS_PGTO_CLIENTE.forEach(f => $(f.id).addEventListener('input', recalc));
  const tudo = $('rcc-tudo'); if (tudo) tudo.addEventListener('click', () => { $('rcc-pix').value = saldo.toFixed(2); CAMPOS_PGTO_CLIENTE.slice(1).forEach(f => $(f.id).value = ''); recalc(); $('rcc-pix').focus(); });
  const confirmar = async () => {
    const v = totalDigitado();
    if (v <= 0) return;
    // MESMA lógica do troco do PDV: só ABATE até o saldo devedor. O excedente é TROCO (dinheiro
    // de volta) — NÃO vira pagamento nem saldo negativo. Assim pagar 430 numa dívida de 7 quita e
    // devolve 423 de troco, em vez de deixar a conta em -423.
    const abate = Math.round(Math.min(v, Math.max(saldo, 0)) * 100) / 100;
    const troco = Math.round((v - abate) * 100) / 100;
    if (abate <= 0) { toast('⚠ Este cliente não tem saldo devedor a receber'); ok.disabled = false; return; }
    ok.disabled = true;
    // formas registradas = só o que abate (capadas na ordem); o troco sai em dinheiro
    let falta = abate;
    const formasPagas = CAMPOS_PGTO_CLIENTE.map(f => ({ nome: f.nome, valor: valorDe(f) })).filter(x => x.valor > 0)
      .map(x => { const usa = Math.round(Math.min(x.valor, falta) * 100) / 100; falta = Math.round((falta - usa) * 100) / 100; return { nome: x.nome, valor: usa }; }).filter(x => x.valor > 0);
    const desc = ($('rcc-desc').value || '').trim() || 'Recebimento de conta';
    const r = await lancarNaContaCliente(clienteId, 'pagamento', abate, desc, { formasPagas, referencia: 'recebimento' });
    if (!r) { toast('⚠ Falha ao registrar'); ok.disabled = false; return; }
    toast(`✅ Recebido ${fmt(abate)} de ${c.nome}${troco > 0 ? ` · troco ${fmt(troco)}` : ''} · saldo ${fmt(r.novoSaldo)}`);
    // tela de conclusão: mostra o comprovante e SÓ imprime se o operador quiser (botão)
    const compr = { loja: lojaConfigCache || {}, cliente: c.nome, valor: abate, troco, formas: formasPagas, saldoAntes: saldo, saldoNovo: r.novoSaldo, data: new Date(), operador: (usuarioAtual && usuarioAtual.nome) || '', desc };
    $('modal-erp-box').innerHTML = `<h3 class="erp-modal-tit">✅ Recebimento registrado <small class="op-ci-sub">${crmEsc(c.nome)}</small></h3>
      <div class="rcc-ok">
        <div class="rcc-ok-val">${fmt(abate)} recebido${troco > 0 ? ` · 💵 troco ${fmt(troco)}` : ''}</div>
        <div class="rcc-ok-saldo">Saldo: ${fmt(saldo)} → <b>${fmt(r.novoSaldo)}</b></div>
        <div class="rcc-ok-pergunta">🧾 Imprimir comprovante?</div>
        <div class="rcc-ok-acoes">
          <button type="button" class="fin-btn-salvar" id="rcc-imprimir">🖨️ Sim, imprimir</button>
          <button type="button" class="ds-btn" id="rcc-nao">Não</button>
        </div>
      </div>`;
    // Sim → imprime e conclui · Não → só conclui (ambos limpam via erpOnClose)
    $('rcc-imprimir').addEventListener('click', () => { imprimirComprovantePagamento(compr); fecharErpModal(); });
    $('rcc-nao').addEventListener('click', () => fecharErpModal());
    setTimeout(() => $('rcc-imprimir').focus(), 60);
  };
  // Enter percorre as formas; na última confirma
  CAMPOS_PGTO_CLIENTE.forEach((f, i) => $(f.id).addEventListener('keydown', e => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const prox = CAMPOS_PGTO_CLIENTE[i + 1];
    if (prox) { $(prox.id).focus(); $(prox.id).select(); }
    else if (!ok.disabled) confirmar();
  }));
  ok.addEventListener('click', confirmar);
  setTimeout(() => $('rcc-pix').focus(), 60);
}

/* Duplo-espaço (campo Nome vazio) abre a busca de cliente já cadastrado */
let ultimoEspacoCliente = 0;
/* Autocomplete do NOME: vai mostrando os clientes conforme digita; escolhe com ↑↓ + Enter ou
   clique. Não atrapalha o código+Enter (números) nem o espaço-espaço (busca em tela cheia). */
{
  const inp = $('cl-nome'), drop = $('cln-drop');
  if (inp && drop) {
    let itens = [], ativo = -1;
    const esconder = () => { drop.hidden = true; itens = []; ativo = -1; };
    const marcar = i => {
      const btns = drop.querySelectorAll('.cln-item'); if (!btns.length) return;
      ativo = (i + btns.length) % btns.length;
      btns.forEach((b, k) => b.classList.toggle('ativo', k === ativo));
      btns[ativo].scrollIntoView({ block: 'nearest' });
    };
    const escolher = c => { esconder(); editarClienteForm(c.id); toast(`👤 #${clienteCodigo(c)} — ${c.nome}`); };
    const render = () => {
      const f = (inp.value || '').trim().toLowerCase();
      if (f.length < 1 || /^\d+$/.test(f)) { esconder(); return; }   // só número → deixa o Enter buscar por código
      itens = CLIENTES.filter(c => (c.nome || '').toLowerCase().includes(f) || (c.telefone || '').includes(f) || clienteCodigo(c).toLowerCase().includes(f)).slice(0, 8);
      drop.innerHTML = itens.length
        ? itens.map((c, i) => `<button type="button" class="cln-item${i === 0 ? ' ativo' : ''}" data-id="${c.id}"><span class="cln-nome">${crmEsc(c.nome || 'sem nome')}</span><span class="cln-cod">#${crmEsc(clienteCodigo(c))}${(+saldoCliente(c) > 0) ? ' · deve ' + fmt(saldoCliente(c)) : ''}</span></button>`).join('')
        : '<div class="cln-vazio">Nenhum cliente com esse nome — Enter cadastra novo</div>';
      ativo = itens.length ? 0 : -1;
      drop.querySelectorAll('.cln-item').forEach((b, i) => {
        b.addEventListener('mousedown', ev => { ev.preventDefault(); const c = buscarClientePorId(+b.dataset.id); if (c) escolher(c); });
        b.addEventListener('mousemove', () => marcar(i));
      });
      drop.hidden = false;
    };
    inp.addEventListener('input', render);
    inp.addEventListener('focus', () => { if ((inp.value || '').trim()) render(); });
    document.addEventListener('click', ev => { const w = inp.closest('.cln-wrap'); if (w && !w.contains(ev.target)) esconder(); });
    inp.addEventListener('keydown', e => {
      const aberto = !drop.hidden && itens.length > 0;
      if (e.key === 'ArrowDown') { if (aberto) { e.preventDefault(); marcar(ativo + 1); } else if ((inp.value || '').trim()) render(); return; }
      if (e.key === 'ArrowUp')   { if (aberto) { e.preventDefault(); marcar(ativo - 1); } return; }
      if (e.key === 'Escape')    { if (!drop.hidden) { e.stopPropagation(); esconder(); } return; }
      if (e.key === 'Enter' && aberto && ativo >= 0 && itens[ativo]) { e.preventDefault(); e.stopImmediatePropagation(); escolher(itens[ativo]); }   // Enter escolhe o destacado
    });
  }
}
$('cl-nome').addEventListener('keydown', e => {
  if (e.key !== ' ' || $('cl-nome').value.trim() !== '') return;
  e.preventDefault();
  const agora = Date.now();
  if (agora - ultimoEspacoCliente < 450) { ultimoEspacoCliente = 0; abrirBuscaProduto('clientes'); }
  else ultimoEspacoCliente = agora;
});
/* Buscar por CÓDIGO direto no campo Nome: digitou só números + Enter → carrega o cliente.
   (marcado com enterCustom pra o "Enter → próximo campo" do form não atrapalhar) */
$('cl-nome').dataset.enterCustom = '1';
$('cl-nome').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const val = $('cl-nome').value.trim();
  if (/^\d+$/.test(val)) {          // é um código → procura o cliente por ele
    const c = CLIENTES.find(x => String(x.id) === val || clienteCodigo(x) === val.padStart(4, '0'));
    if (c) { editarClienteForm(c.id); toast(`👤 Cliente #${clienteCodigo(c)} — ${c.nome}`); }
    else { toast('⚠ Nenhum cliente com esse código'); $('cl-nome').select(); }
    return;
  }
  $('cl-telefone').focus();          // nome digitado → segue pro telefone
});

/* ══════════════════════════════════════════════════════════════════════════
   CRM & FIDELIDADE (Fase 24) — bloco de relacionamento no detalhe do cliente +
   painel de listas/campanhas. Só LÊ métricas (calculadas ao vivo no backend) e
   movimenta o saldo de fidelidade (ledger à parte, NÃO mexe no caixa nem no
   fiado). Nada aqui altera o PDV/Delivery/Atendimento.
   ══════════════════════════════════════════════════════════════════════════ */
const CRM_STATUS = {
  novo:       { rot: 'Novo',       emo: '🌱' },
  recorrente: { rot: 'Recorrente', emo: '🔁' },
  vip:        { rot: 'VIP',        emo: '⭐' },
  inativo:    { rot: 'Sumido',     emo: '😴' },
};
const crmEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const crmStatusChip = st => { const s = CRM_STATUS[st] || CRM_STATUS.novo; return `<span class="crm-badge ${st || 'novo'}">${s.emo} ${s.rot}</span>`; };
const crmDias = d => d == null ? '—' : d === 0 ? 'hoje' : `${d} dia${d === 1 ? '' : 's'}`;

/* ── Bloco de relacionamento dentro do detalhe do cliente (aba Cadastro) ── */
async function renderClienteCRM(id) {
  const box = $('cl-crm-box');
  if (!box) return;
  box.innerHTML = '<div class="crm-loading">Carregando relacionamento…</div>';
  let d;
  try { d = await (await fetch(`/api/clientes/${id}/crm`)).json(); }
  catch { box.innerHTML = '<div class="crm-loading">Sem conexão pra carregar o CRM.</div>'; return; }
  if (!d || d.erro) { box.innerHTML = ''; return; }
  const m = d.metricas || {};
  const saldoFid = d.fidelidade ? (d.fidelidade.saldo || 0) : 0;
  const alerta = m.status === 'inativo'
    ? `<div class="crm-alerta">😴 Sumido há ${crmDias(m.diasSemComprar)} — vale um "sentimos sua falta".</div>`
    : (d.aniversario && d.aniversario === crmMMDDHoje() ? `<div class="crm-alerta aniv">🎂 É aniversário do cliente hoje!</div>` : '');
  const compras = (d.ultimasCompras || []).map(c => `
    <button type="button" class="crm-compra" data-ctipo="${c.tipo}" data-cid="${c.id != null ? c.id : ''}" data-cnum="${c.numero != null ? c.numero : ''}" title="Ver o que o cliente comprou">
      <span>${c.tipo === 'venda' ? '🛒 Balcão' : '🛵 Delivery'} ${c.numero != null ? '#' + c.numero : ''}</span>
      <span class="crm-compra-dt">${c.dt ? new Date(c.dt).toLocaleDateString('pt-BR') : ''}</span>
      <span class="crm-compra-val">${fmt(c.total || 0)}</span>
    </button>`).join('') || '<div class="crm-compra vazio">Nenhuma compra registrada ainda.</div>';

  box.innerHTML = `
    <div class="crm-detalhe-head"><span class="pd-sub" style="margin:0">📊 Relacionamento</span>${crmStatusChip(m.status)}</div>
    ${alerta}
    <div class="crm-metricas">
      <div class="crm-mt"><b>${m.qtdCompras || 0}</b><span>compras</span></div>
      <div class="crm-mt"><b>${fmt(m.totalGasto || 0)}</b><span>gasto total</span></div>
      <div class="crm-mt"><b>${fmt(m.ticketMedio || 0)}</b><span>ticket médio</span></div>
      <div class="crm-mt"><b>${m.ultimaCompra ? crmDias(m.diasSemComprar) : '—'}</b><span>sem comprar</span></div>
    </div>
    <div class="crm-fid">
      <div class="crm-fid-saldo"><span>💜 Fidelidade</span><b class="${saldoFid > 0 ? 'tem' : ''}">${fmt(saldoFid)}</b></div>
      <div class="crm-fid-acoes">
        <button type="button" class="crm-fid-btn" data-fid="credito">➕ Creditar</button>
        <button type="button" class="crm-fid-btn" data-fid="resgate" ${saldoFid > 0 ? '' : 'disabled'}>➖ Resgatar</button>
        <button type="button" class="crm-fid-btn ajuste" data-fid="ajuste">✏️ Ajustar</button>
      </div>
    </div>`;
  box.querySelectorAll('.crm-fid-btn').forEach(b => b.addEventListener('click', () => fidelidadeAcao(id, b.dataset.fid, saldoFid)));
  // últimas compras vão pra sub-aba "Compras" (aproveita o espaço)
  const cbox = $('cl-compras-box');
  if (cbox) {
    cbox.innerHTML = `<div class="crm-compras"><div class="crm-compras-tit">Últimas compras</div>${compras}</div>`;
    cbox.querySelectorAll('.crm-compra[data-ctipo]').forEach(b => b.addEventListener('click', () => {
      abrirRelatorioCompra(b.dataset.ctipo, b.dataset.cid, b.dataset.cnum, (($('cl-nome') || {}).value || '').trim());
    }));
  }
}
// sub-abas do detalhe do cliente (Resumo · Extrato · Compras)
function clTrocarSubaba(sub) {
  document.querySelectorAll('.cl-subtab').forEach(x => x.classList.toggle('ativo', x.dataset.clsub === sub));
  document.querySelectorAll('.cl-subpanel').forEach(p => p.style.display = p.id === 'cl-sub-' + sub ? '' : 'none');
}
document.querySelectorAll('.cl-subtab').forEach(b => b.addEventListener('click', () => clTrocarSubaba(b.dataset.clsub)));

/* ESPELHO DA NOTA de UMA compra do cliente — cupom completo (loja, itens com
   qtd/valor unit., total, formas, troco). Resolve o id pelo número quando preciso,
   então funciona mesmo sem reiniciar o servidor. */
async function abrirRelatorioCompra(tipo, id, numero, clienteNome) {
  const rot = tipo === 'venda' ? '🛒 Balcão' : '🛵 Delivery';
  abrirErpModal(`<h3 class="erp-modal-tit">${rot} ${numero ? '#' + numero : ''} <small class="op-ci-sub">espelho da nota</small></h3>
    <div class="rc-corpo" id="rc-corpo">${biLoading()}</div>`);
  let itens = [], textoItens = '', cab = {};
  try {
    if (tipo === 'venda') {
      // sem id (backend antigo) → descobre pelo número na lista de vendas
      let vid = id;
      if (!vid && numero) { const lst = await (await fetch('/api/vendas?status=concluida', { cache: 'no-store' })).json(); const m = (Array.isArray(lst) ? lst : []).find(x => String(x.numero) === String(numero)); if (m) vid = m.id; }
      if (vid) {
        const v = await (await fetch('/api/vendas/' + encodeURIComponent(vid), { cache: 'no-store' })).json();
        if (v && !v.erro) {
          itens = (v.itens || []).map(i => ({ nome: i.nome || i.codigo, qtd: i.qtd, preco: i.preco, subtotal: i.subtotal != null ? i.subtotal : (i.qtd * i.preco) }));
          cab = { dt: v.data, total: v.total, troco: v.troco, pagamentos: v.pagamentos, num: v.numero, retiradoPor: v.retirado_por };
        }
      }
    } else {
      // pedido: pega da lista por id OU número (não depende de endpoint novo)
      const lst = await (await fetch('/api/pedidos', { cache: 'no-store' })).json();
      const p = (Array.isArray(lst) ? lst : []).find(x => (id && String(x.id) === String(id)) || (numero && String(x.numero) === String(numero)));
      if (p) {
        let its = p.itens, parsed = null;
        if (Array.isArray(its)) parsed = its;
        else if (typeof its === 'string') { const t = its.trim(); if (t[0] === '[' || t[0] === '{') { try { parsed = JSON.parse(t); } catch {} } else textoItens = its; }
        if (Array.isArray(parsed)) itens = parsed.map(i => ({ nome: i.nome || i.descricao || i.produto || '—', qtd: i.qtd || i.quantidade || 1, preco: i.preco || i.valor || 0, subtotal: i.subtotal != null ? i.subtotal : ((i.qtd || i.quantidade || 1) * (i.preco || i.valor || 0)) }));
        cab = { dt: p.criado, total: p.total, troco: p.troco, pagamento: p.pagamento, endereco: p.endereco, num: p.numero };
      }
    }
  } catch {}
  const el = $('rc-corpo'); if (!el) return;
  if (!itens.length && !textoItens.trim()) { el.innerHTML = '<div class="ds-vazio">Sem itens registrados nesta compra.</div>'; return; }

  const cfg = lojaConfigCache || {};
  const dataStr = cab.dt ? new Date(cab.dt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const totalCalc = itens.reduce((s, i) => s + (i.subtotal || 0), 0);
  const total = cab.total != null ? cab.total : totalCalc;
  const pags = (cab.pagamentos && cab.pagamentos.length)
    ? cab.pagamentos.map(p => `<div class="rcn-lin"><span>${crmEsc(p.forma)}</span><span>${fmt(p.valor)}</span></div>`).join('')
    : (cab.pagamento ? `<div class="rcn-lin"><span>${crmEsc(cab.pagamento)}</span><span></span></div>` : '');

  const corpoItens = itens.length
    ? `<div class="rcn-itens">
         <div class="rcn-cab"><span>Qtd × Item</span><span>Valor</span></div>
         ${itens.map(i => `<div class="rcn-item"><span class="rcn-desc">${biNum(i.qtd)}× ${crmEsc((i.nome || '—').toUpperCase())}${i.preco ? ` <small>(${fmt(i.preco)} un)</small>` : ''}</span><span class="rcn-val">${fmt(i.subtotal || 0)}</span></div>`).join('')}
       </div>`
    : `<div class="rcn-texto">${crmEsc(textoItens).replace(/\n/g, '<br>')}</div>`;

  el.innerHTML = `
    <div class="rc-nota">
      <div class="rcn-topo">
        <div class="rcn-loja">${crmEsc(cfg.loja_nome || 'Açaí do Centro')}</div>
        ${cfg.loja_telefone ? `<div class="rcn-sub">${crmEsc(cfg.loja_telefone)}</div>` : ''}
        ${cfg.loja_endereco ? `<div class="rcn-sub">${crmEsc(cfg.loja_endereco)}</div>` : ''}
      </div>
      <div class="rcn-meta">
        <div class="rcn-lin"><span>${rot} ${cab.num != null ? '#' + cab.num : (numero ? '#' + numero : '')}</span><span>${dataStr}</span></div>
        ${clienteNome ? `<div class="rcn-lin"><span>Cliente</span><span>${crmEsc(clienteNome)}</span></div>` : ''}
        ${cab.retiradoPor && cab.retiradoPor !== clienteNome ? `<div class="rcn-lin rcn-retirou"><span>🖐 Retirado por</span><span>${crmEsc(cab.retiradoPor)}</span></div>` : ''}
      </div>
      ${corpoItens}
      <div class="rcn-total"><span>TOTAL</span><b>${fmt(total)}</b></div>
      ${pags ? `<div class="rcn-pags"><div class="rcn-pags-tit">Pagamento</div>${pags}${cab.troco ? `<div class="rcn-lin"><span>Troco</span><span>${fmt(cab.troco)}</span></div>` : ''}</div>` : ''}
      ${cab.endereco ? `<div class="rcn-end">📍 ${crmEsc(cab.endereco)}</div>` : ''}
      <div class="rcn-rodape">· espelho não fiscal ·</div>
    </div>`;
}

async function fidelidadeAcao(id, tipo, saldoAtual) {
  const rot = tipo === 'credito' ? 'creditar' : tipo === 'resgate' ? 'resgatar' : 'ajustar (negativo tira)';
  const raw = prompt(`💜 Valor em R$ para ${rot}:` + (tipo === 'resgate' ? `\nSaldo disponível: ${fmt(saldoAtual)}` : ''));
  if (raw == null) return;
  const valor = parseFloat(String(raw).replace(',', '.'));
  if (isNaN(valor) || valor === 0 || (tipo !== 'ajuste' && valor <= 0)) { toast('⚠ Valor inválido'); return; }
  if (tipo === 'resgate' && valor > saldoAtual + 1e-9) { toast('⚠ Saldo de fidelidade insuficiente'); return; }
  const desc = prompt('Descrição (opcional):', tipo === 'credito' ? 'crédito manual' : tipo === 'resgate' ? 'resgate no balcão' : 'ajuste') || '';
  try {
    const r = await (await fetch(`/api/clientes/${id}/fidelidade`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, valor, descricao: desc }),
    })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    toast(`💜 Fidelidade agora: ${fmt(r.saldo)}`);
    renderClienteCRM(id);
  } catch { toast('⚠ Falha ao lançar fidelidade'); }
}

/* ── Abas Cadastro / CRM + painel de listas e campanhas ── */
const crmMMDDHoje = () => { const d = new Date(); return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
let crmAba = 'cadastro', crmLista = [], crmListaAtual = 'ranking-gasto', crmBuscaT = 0;
const CRM_LISTAS = {
  'ranking-gasto':   { q: 'ordenar=gasto',            tit: 'Quem mais gastou' },
  'ranking-compras': { q: 'ordenar=compras',          tit: 'Quem mais comprou' },
  'sumidos':         { q: 'sumido=1&ordenar=sumido',  tit: 'Clientes sumidos' },
  'aniversariantes': { q: 'aniversariante=semana',    tit: 'Aniversariantes da semana' },
  'fiado':           { q: 'comFiado=1&ordenar=gasto', tit: 'Com fiado em aberto' },
  'novos':           { q: 'status=novo&ordenar=nome', tit: 'Clientes novos' },
  'vip':             { q: 'status=vip&ordenar=gasto', tit: 'Clientes VIP' },
  'todos':           { q: 'ordenar=nome',             tit: 'Todos os clientes' },
};

function trocarAbaCliente(aba) {
  crmAba = aba;
  document.querySelectorAll('.cl-tab').forEach(t => t.classList.toggle('ativo', t.dataset.cltab === aba));
  $('clientes-painel').style.display = aba === 'cadastro' ? '' : 'none';
  $('crm-painel').style.display = aba === 'crm' ? '' : 'none';
  $('clube-painel').style.display = aba === 'clube' ? '' : 'none';
  if (aba === 'crm') crmCarregar();
  if (aba === 'clube') renderClube();
}

/* ── FASE 41: Clube do Cliente (gerencial) ── */
let clubeSub = 'resumo';
const clubeGet = async (rota, method, body) => (await fetch('/api/crm/' + rota, { method: method || 'GET', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })).json();
const CLUBE_PREM = { litros: '🥤 Litros de açaí', desconto: '🏷️ Desconto', produto: '🎁 Produto', credito: '💰 Crédito', frete: '🛵 Frete grátis', cupom: '🎟️ Cupom' };
const CLUBE_TIPO = { acumulo_valor: 'A cada R$ acumulado', compras: 'A cada nº de compras', pedidos: 'A cada nº de pedidos', produto: 'A cada qtd de um produto' };
function renderClube() {
  document.querySelectorAll('.clube-sub').forEach(b => b.classList.toggle('ativo', b.dataset.clube === clubeSub));
  const R = { resumo: clubeResumo, regras: clubeRegras, cupons: clubeCupons, campanhas: clubeCampanhas, sorteios: clubeSorteios };
  (R[clubeSub] || clubeResumo)();
}
document.querySelectorAll('.clube-sub').forEach(b => b.addEventListener('click', () => { clubeSub = b.dataset.clube; renderClube(); }));

async function clubeResumo() {
  const el = $('clube-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await clubeGet('clube/resumo'); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  el.innerHTML = `
    <div class="fin-cards bi-cards-4">
      ${finCard('⚙️', d.regras_ativas, 'Regras ativas')}
      ${finCard('🎟️', d.cupons.disponivel, 'Cupons disponíveis')}
      ${finCard('✅', d.cupons.usado, 'Cupons usados')}
      ${finCard('📣', d.campanhas_ativas, 'Campanhas ativas')}
    </div>
    <div class="clube-acoes">
      ${pode ? '<button class="fin-btn-salvar" id="clube-avaliar">⚡ Avaliar clientes e gerar cupons</button>' : ''}
      <span class="fin-hint">A avaliação lê as compras já registradas e emite cupons pelas regras — nunca duplica (idempotente por ciclo).</span>
    </div>
    ${finBox('🎯 Como funciona', `<p class="fin-hint">O Clube usa o que o ERP já sabe do cliente (compras, total, frequência) para premiar automaticamente. Sem cartão físico — a identificação é pelo cadastro/telefone. Configure as <b>Regras</b>, dispare <b>Campanhas</b> e faça <b>Sorteios</b>. Cada campanha traz seus indicadores.</p>`)}`;
  const b = $('clube-avaliar'); if (b) b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'avaliando…';
    const r = await clubeGet('avaliar', 'POST', {});
    toast(`⚡ ${r.cupons_gerados} cupom(ns) gerado(s) para ${r.clientes_avaliados} cliente(s)`); clubeResumo();
  });
}
async function clubeRegras() {
  const el = $('clube-conteudo'); el.innerHTML = biLoading();
  let regras; try { regras = await clubeGet('regras'); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const rows = regras.map(r => [crmEsc(r.nome), CLUBE_TIPO[r.tipo] || r.tipo, fmt(r.meta).replace('R$ ', r.tipo === 'acumulo_valor' ? 'R$ ' : ''),
    (CLUBE_PREM[r.premiacao_tipo] || r.premiacao_tipo) + (r.premiacao_valor ? ' · ' + r.premiacao_valor : ''), r.validade_dias + 'd',
    `<span class="cu-status cu-st-${r.ativa ? 'finalizado' : 'cancelado'}">${r.ativa ? 'ativa' : 'inativa'}</span>`,
    pode ? `<button class="fin-mini" data-cr-edit="${r.id}">✏️</button> <button class="fin-mini" data-cr-del="${r.id}">🗑</button>` : '']);
  el.innerHTML = `<div class="erp-topo"><span class="fin-flex"></span>${pode ? '<button class="fin-mini" data-cr-nova="1">➕ Nova regra</button>' : ''}</div>` +
    finBox('⚙️ Regras de fidelização (100% configuráveis)', biTabela([{ h: 'Regra' }, { h: 'Tipo' }, { h: 'Meta', cls: 'num' }, { h: 'Premiação' }, { h: 'Validade' }, { h: 'Status' }, { h: '' }], rows, 'Nenhuma regra — crie a primeira (ex.: "1 litro a cada R$300").'));
  el.querySelectorAll('[data-cr-nova]').forEach(b => b.addEventListener('click', () => clubeRegraForm()));
  el.querySelectorAll('[data-cr-edit]').forEach(b => b.addEventListener('click', () => clubeRegraForm(regras.find(r => r.id == b.dataset.crEdit))));
  el.querySelectorAll('[data-cr-del]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Excluir regra?')) return; await clubeGet('regras/' + b.dataset.crDel, 'DELETE'); toast('🗑 Excluída'); clubeRegras(); }));
}
function clubeRegraForm(r) {
  const ed = !!r, opt = (o, m) => Object.entries(m).map(([k, v]) => `<option value="${k}" ${o === k ? 'selected' : ''}>${v}</option>`).join('');
  abrirErpModal(`<h3 class="erp-modal-tit">⚙️ ${ed ? 'Editar' : 'Nova'} regra</h3>
    <form id="cr-form" class="fin-form">
      <label>Nome<input id="cr-nome" value="${ed ? crmEsc(r.nome) : ''}" placeholder="ex.: 1 litro a cada R$300"></label>
      <div class="fin-frow"><label>Tipo<select id="cr-tipo">${opt(ed ? r.tipo : 'acumulo_valor', CLUBE_TIPO)}</select></label>
        <label>Meta (gatilho)<input type="number" step="0.01" id="cr-meta" value="${ed ? r.meta : 300}"></label></div>
      <div class="fin-frow"><label>Premiação<select id="cr-prem">${opt(ed ? r.premiacao_tipo : 'litros', CLUBE_PREM)}</select></label>
        <label>Valor do prêmio<input type="number" step="0.01" id="cr-premval" value="${ed ? r.premiacao_valor : 1}"></label>
        <label>Validade (dias)<input type="number" id="cr-val" value="${ed ? r.validade_dias : 30}" style="width:90px"></label></div>
      <label>Descrição do prêmio<input id="cr-premdesc" value="${ed ? crmEsc(r.premiacao_desc || '') : ''}" placeholder="ex.: 1 litro de açaí grátis"></label>
      <label>Produto (só p/ tipo 'produto')<input id="cr-prod" value="${ed ? crmEsc(r.produto_codigo || '') : ''}" placeholder="código do produto (opcional)"></label>
      <button type="submit" class="fin-btn-salvar">💾 Salvar regra</button></form>`);
  $('cr-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { nome: $('cr-nome').value.trim(), tipo: $('cr-tipo').value, meta: +$('cr-meta').value || 0, premiacao_tipo: $('cr-prem').value,
      premiacao_valor: +$('cr-premval').value || 0, validade_dias: +$('cr-val').value || 30, premiacao_desc: $('cr-premdesc').value.trim(), produto_codigo: $('cr-prod').value.trim() || null };
    if (!body.nome) { toast('⚠ Informe o nome'); return; }
    const rr = await clubeGet(ed ? 'regras/' + r.id : 'regras', ed ? 'PUT' : 'POST', body);
    if (rr.erro) { toast('⚠ ' + rr.erro); return; } toast('✅ Regra salva'); fecharErpModal(); clubeRegras();
  });
}
async function clubeCupons() {
  const el = $('clube-conteudo'); el.innerHTML = biLoading();
  let cupons; try { cupons = await clubeGet('cupons'); } catch { el.innerHTML = biErro(); return; }
  const stCls = { disponivel: 'aberto', usado: 'finalizado', expirado: 'cancelado', cancelado: 'cancelado' };
  const rows = cupons.map(c => [crmEsc(c.codigo), crmEsc(c.cliente_nome || '#' + c.cliente_id), CLUBE_PREM[c.tipo] || c.tipo, c.valor ? fmt(c.valor) : '—',
    c.validade || '—', `<span class="cu-status cu-st-${stCls[c.status] || 'aberto'}">${c.status}</span>`,
    finPodeLancar() && c.status === 'disponivel' ? `<button class="fin-mini" data-cu-usar="${c.id}">✅ Usar</button> <button class="fin-mini" data-cu-canc="${c.id}">🚫</button>` : '']);
  el.innerHTML = finBox('🎟️ Cupons virtuais', biTabela([{ h: 'Código' }, { h: 'Cliente' }, { h: 'Prêmio' }, { h: 'Valor', cls: 'num' }, { h: 'Validade' }, { h: 'Status' }, { h: '' }], rows, 'Nenhum cupom — configure regras e clique em "Avaliar" no Resumo.'));
  el.querySelectorAll('[data-cu-usar]').forEach(b => b.addEventListener('click', async () => { const r = await clubeGet('cupons/' + b.dataset.cuUsar + '/usar', 'POST', {}); if (r.erro) { toast('⚠ ' + r.erro); return; } toast('✅ Cupom usado'); clubeCupons(); }));
  el.querySelectorAll('[data-cu-canc]').forEach(b => b.addEventListener('click', async () => { await clubeGet('cupons/' + b.dataset.cuCanc + '/cancelar', 'POST', {}); toast('🚫 Cancelado'); clubeCupons(); }));
}
async function clubeCampanhas() {
  const el = $('clube-conteudo'); el.innerHTML = biLoading();
  let camps, regras; try { [camps, regras] = await Promise.all([clubeGet('campanhas'), clubeGet('regras')]); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const rows = camps.map(c => { const i = c.indicadores || {};
    return [crmEsc(c.nome), (c.de || '—') + ' → ' + (c.ate || '—'), crmEsc(c.segmento || 'todos'), i.cupons || 0, i.usados || 0, (i.conversao || 0) + '%', fmt(i.valor_vendido || 0),
      pode ? `<button class="fin-mini" data-ca-disp="${c.id}">📣 Disparar</button> <button class="fin-mini" data-ca-del="${c.id}">🗑</button>` : '']; });
  el.innerHTML = `<div class="erp-topo"><span class="fin-flex"></span>${pode ? '<button class="fin-mini" data-ca-nova="1">➕ Nova campanha</button>' : ''}</div>` +
    finBox('📣 Campanhas & indicadores', biTabela([{ h: 'Campanha' }, { h: 'Período' }, { h: 'Segmento' }, { h: 'Cupons', cls: 'num' }, { h: 'Usados', cls: 'num' }, { h: 'Conversão', cls: 'num' }, { h: 'Vendido', cls: 'num' }, { h: '' }], rows, 'Nenhuma campanha ainda.'));
  el.querySelectorAll('[data-ca-nova]').forEach(b => b.addEventListener('click', () => clubeCampanhaForm(regras)));
  el.querySelectorAll('[data-ca-disp]').forEach(b => b.addEventListener('click', async () => { const r = await clubeGet('campanhas/' + b.dataset.caDisp + '/disparar', 'POST', {}); if (r.erro) { toast('⚠ ' + r.erro); return; } toast(`📣 ${r.cupons_emitidos} cupom(ns) emitido(s)`); clubeCampanhas(); }));
  el.querySelectorAll('[data-ca-del]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Excluir campanha?')) return; await clubeGet('campanhas/' + b.dataset.caDel, 'DELETE'); toast('🗑 Excluída'); clubeCampanhas(); }));
}
function clubeCampanhaForm(regras) {
  abrirErpModal(`<h3 class="erp-modal-tit">📣 Nova campanha</h3>
    <form id="ca-form" class="fin-form">
      <label>Nome<input id="ca-nome" placeholder="ex.: Volta às aulas"></label>
      <div class="fin-frow"><label>De<input type="date" id="ca-de"></label><label>Até<input type="date" id="ca-ate"></label></div>
      <div class="fin-frow"><label>Segmento<select id="ca-seg"><option value="todos">Todos</option><option value="vip">VIPs</option><option value="recorrente">Recorrentes</option><option value="inativo">Inativos (recuperar)</option><option value="novo">Novos</option></select></label>
        <label>Regra do prêmio<select id="ca-regra"><option value="">— cupom simples —</option>${regras.map(r => `<option value="${r.id}">${crmEsc(r.nome)}</option>`).join('')}</select></label></div>
      <label>Descrição do prêmio<input id="ca-prem" placeholder="ex.: Frete grátis"></label>
      <button type="submit" class="fin-btn-salvar">💾 Criar campanha</button></form>`);
  $('ca-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { nome: $('ca-nome').value.trim(), de: $('ca-de').value || null, ate: $('ca-ate').value || null, segmento: $('ca-seg').value, regra_id: +$('ca-regra').value || null, premiacao_desc: $('ca-prem').value.trim() };
    if (!body.nome) { toast('⚠ Informe o nome'); return; }
    const r = await clubeGet('campanhas', 'POST', body);
    if (r.erro) { toast('⚠ ' + r.erro); return; } toast('✅ Campanha criada'); fecharErpModal(); clubeCampanhas();
  });
}
async function clubeSorteios() {
  const el = $('clube-conteudo'); el.innerHTML = biLoading();
  let sorteios; try { sorteios = await clubeGet('sorteios'); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const rows = sorteios.map(s => [crmEsc(s.nome), (s.de || '—') + ' → ' + (s.ate || '—'), fmt(s.valor_por_bilhete) + '/bilhete', crmEsc(s.premio || '—'),
    `<span class="cu-status cu-st-${s.status === 'encerrado' ? 'finalizado' : 'aberto'}">${s.status}</span>`, s.ganhador_nome ? '🏆 ' + crmEsc(s.ganhador_nome) : '—',
    pode && s.status === 'aberto' ? `<button class="fin-mini" data-so-ver="${s.id}">👁</button> <button class="fin-mini" data-so-sortear="${s.id}">🎲 Sortear</button>` : `<button class="fin-mini" data-so-ver="${s.id}">👁</button>`]);
  el.innerHTML = `<div class="erp-topo"><span class="fin-flex"></span>${pode ? '<button class="fin-mini" data-so-novo="1">➕ Novo sorteio</button>' : ''}</div>` +
    finBox('🎲 Sorteios (bilhetes por compras)', biTabela([{ h: 'Sorteio' }, { h: 'Período' }, { h: 'Bilhete' }, { h: 'Prêmio' }, { h: 'Status' }, { h: 'Ganhador' }, { h: '' }], rows, 'Nenhum sorteio ainda.'));
  el.querySelectorAll('[data-so-novo]').forEach(b => b.addEventListener('click', () => clubeSorteioForm()));
  el.querySelectorAll('[data-so-ver]').forEach(b => b.addEventListener('click', () => clubeSorteioDetalhe(+b.dataset.soVer)));
  el.querySelectorAll('[data-so-sortear]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Realizar o sorteio agora? Escolhe um ganhador ponderado pelos bilhetes e encerra.')) return; const r = await clubeGet('sorteios/' + b.dataset.soSortear + '/sortear', 'POST', {}); if (r.erro) { toast('⚠ ' + r.erro); return; } toast('🏆 Ganhador: ' + r.ganhador_nome); clubeSorteios(); }));
}
function clubeSorteioForm() {
  abrirErpModal(`<h3 class="erp-modal-tit">🎲 Novo sorteio</h3>
    <form id="so-form" class="fin-form">
      <label>Nome<input id="so-nome" placeholder="ex.: Sorteio de Julho"></label>
      <div class="fin-frow"><label>De<input type="date" id="so-de"></label><label>Até<input type="date" id="so-ate"></label></div>
      <div class="fin-frow"><label>R$ por bilhete<input type="number" step="0.01" id="so-vpb" value="50"></label><label>Prêmio<input id="so-premio" placeholder="ex.: 1 mês de açaí"></label></div>
      <p class="fin-hint">Cada cliente ganha 1 bilhete a cada R$ gastos no período (calculado das compras — sem cadastro manual).</p>
      <button type="submit" class="fin-btn-salvar">💾 Criar sorteio</button></form>`);
  $('so-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { nome: $('so-nome').value.trim(), de: $('so-de').value || null, ate: $('so-ate').value || null, valor_por_bilhete: +$('so-vpb').value || 0, premio: $('so-premio').value.trim() };
    if (!body.nome) { toast('⚠ Informe o nome'); return; }
    const r = await clubeGet('sorteios', 'POST', body); if (r.erro) { toast('⚠ ' + r.erro); return; } toast('✅ Sorteio criado'); fecharErpModal(); clubeSorteios();
  });
}
async function clubeSorteioDetalhe(id) {
  const s = await clubeGet('sorteios/' + id);
  const rows = (s.bilhetes || []).slice(0, 30).map(b => [crmEsc(b.cliente_nome), fmt(b.gasto), b.bilhetes]);
  abrirErpModal(`<h3 class="erp-modal-tit">🎲 ${crmEsc(s.nome)}</h3>
    <div class="cu-lote-resumo"><span>Participantes: <b>${s.participantes}</b></span><span>Total bilhetes: <b>${s.total_bilhetes}</b></span><span>Prêmio: <b>${crmEsc(s.premio || '—')}</b></span>${s.ganhador_nome ? `<span>🏆 <b>${crmEsc(s.ganhador_nome)}</b></span>` : ''}</div>
    ${biTabela([{ h: 'Cliente' }, { h: 'Gasto no período', cls: 'num' }, { h: 'Bilhetes', cls: 'num' }], rows, 'Ninguém com bilhetes ainda.')}`);
}
document.querySelectorAll('.cl-tab').forEach(t => t.addEventListener('click', () => trocarAbaCliente(t.dataset.cltab)));

async function crmCarregarResumo() {
  let r;
  try { r = await (await fetch('/api/crm/resumo')).json(); } catch { return; }
  const cards = [
    ['👥', r.totalClientes, 'clientes'], ['✅', r.ativos, 'ativos'], ['😴', r.sumidos, 'sumidos'],
    ['⭐', r.vips, 'VIPs'], ['🌱', r.novos, 'novos'], ['🎂', r.aniversariantesSemana, 'aniv./semana'],
    ['📒', r.comFiado, 'com fiado'], ['💜', fmt(r.fidelidadeTotal || 0), 'em fidelidade'],
  ];
  $('crm-resumo').innerHTML = cards.map(([e, n, l]) =>
    `<div class="crm-card"><div class="crm-card-num">${e} ${n}</div><div class="crm-card-lbl">${l}</div></div>`).join('');
}

async function crmCarregarLista() {
  const def = CRM_LISTAS[crmListaAtual] || CRM_LISTAS.todos;
  const busca = $('crm-busca').value.trim(), bairro = $('crm-bairro').value.trim();
  let url = '/api/crm/clientes?' + def.q;
  if (busca) url += '&busca=' + encodeURIComponent(busca);
  if (bairro) url += '&bairro=' + encodeURIComponent(bairro);
  const tb = $('crm-tbody');
  tb.innerHTML = '<tr><td colspan="8" class="crm-vazio">Carregando…</td></tr>';
  let lista;
  try { lista = await (await fetch(url)).json(); }
  catch { tb.innerHTML = '<tr><td colspan="8" class="crm-vazio">Sem conexão.</td></tr>'; return; }
  crmLista = Array.isArray(lista) ? lista : [];
  $('crm-count').textContent = `${crmLista.length} cliente${crmLista.length === 1 ? '' : 's'}`;
  if (!crmLista.length) { tb.innerHTML = '<tr><td colspan="8" class="crm-vazio">Nenhum cliente nessa lista.</td></tr>'; return; }
  tb.innerHTML = crmLista.map(c => `
    <tr data-id="${c.id}" tabindex="0" title="Abrir cadastro">
      <td class="crm-nome">${crmEsc(c.nome || '—')}${c.tags ? ` <span class="crm-tags">${crmEsc(c.tags)}</span>` : ''}</td>
      <td>${crmStatusChip(c.status)}</td>
      <td class="num">${c.qtdCompras || 0}</td>
      <td class="num">${fmt(c.totalGasto || 0)}</td>
      <td class="num">${crmDias(c.diasSemComprar)}</td>
      <td class="num ${c.saldoFidelidade > 0 ? 'crm-tem-fid' : ''}">${c.saldoFidelidade > 0 ? fmt(c.saldoFidelidade) : '—'}</td>
      <td class="num ${c.fiado > 0.001 ? 'crm-tem-fiado' : ''}">${c.fiado > 0.001 ? fmt(c.fiado) : '—'}</td>
      <td class="crm-tel">${crmEsc(c.telefone || '—')}</td>
    </tr>`).join('');
  tb.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => crmAbrirCliente(+tr.dataset.id));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') crmAbrirCliente(+tr.dataset.id); });
  });
}
function crmCarregar() { crmCarregarResumo(); crmCarregarLista(); }

async function crmAbrirCliente(id) {
  trocarAbaCliente('cadastro');
  let c = buscarClientePorId(id);
  if (!c) { await carregarClientes(); c = buscarClientePorId(id); }
  if (c) editarClienteForm(id); else toast('⚠ Cliente não encontrado na base local');
}

document.querySelectorAll('.crm-lista-btn').forEach(b => b.addEventListener('click', () => {
  crmListaAtual = b.dataset.lista;
  document.querySelectorAll('.crm-lista-btn').forEach(x => x.classList.toggle('ativo', x === b));
  crmCarregarLista();
}));
['crm-busca', 'crm-bairro'].forEach(idc => $(idc).addEventListener('input', () => {
  clearTimeout(crmBuscaT); crmBuscaT = setTimeout(crmCarregarLista, 250);
}));

$('crm-copiar').addEventListener('click', async () => {
  const linhas = crmLista.filter(c => c.telefone).map(c => `${c.nome} - ${c.telefone}`);
  if (!linhas.length) { toast('⚠ Nenhum contato com telefone nessa lista'); return; }
  try { await navigator.clipboard.writeText(linhas.join('\n')); toast(`📋 ${linhas.length} contato${linhas.length === 1 ? '' : 's'} copiado${linhas.length === 1 ? '' : 's'}`); }
  catch { toast('⚠ Navegador bloqueou a cópia'); }
});

$('crm-exportar').addEventListener('click', () => {
  if (!crmLista.length) { toast('⚠ Lista vazia'); return; }
  const cab = ['Nome', 'Telefone', 'Bairro', 'Status', 'Compras', 'Gasto total', 'Ticket medio', 'Dias sem comprar', 'Fidelidade', 'Fiado'];
  const linhas = crmLista.map(c => [
    c.nome || '', c.telefone || '', c.bairro || '', (CRM_STATUS[c.status] || {}).rot || c.status || '',
    c.qtdCompras || 0, (c.totalGasto || 0).toFixed(2), (c.ticketMedio || 0).toFixed(2),
    c.diasSemComprar == null ? '' : c.diasSemComprar, (c.saldoFidelidade || 0).toFixed(2), (c.fiado || 0).toFixed(2),
  ]);
  const csv = [cab, ...linhas].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `clientes-${crmListaAtual}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`⬇️ ${linhas.length} cliente${linhas.length === 1 ? '' : 's'} exportado${linhas.length === 1 ? '' : 's'}`);
});

/* ══════════════════════════════════════════════════════════════════════════
   TELA ADMINISTRAÇÃO (Fase 13) — usuários · logs de segurança · backup · mídia.
   Só consome endpoints que já existem (Fases 11/12 + /api/logs-acoes). O botão
   e a tela só aparecem pro admin; a proteção REAL é o middleware do backend.
   ══════════════════════════════════════════════════════════════════════════ */
let abaAdmAtual = 'usuarios';

function renderAdministracao() {
  const negado = !usuarioAtual || usuarioAtual.perfil !== 'admin';
  $('adm-negado').style.display = negado ? '' : 'none';
  $('adm-conteudo').style.display = negado ? 'none' : '';
  if (!negado) abrirAbaAdm(abaAdmAtual);
}
function abrirAbaAdm(aba) {
  abaAdmAtual = aba;
  document.querySelectorAll('.adm-tab').forEach(b => b.classList.toggle('ativo', b.dataset.aba === aba));
  ['usuarios', 'funcionarios', 'loja', 'dados', 'logs', 'backup', 'sync', 'midia', 'plataforma', 'atualizacoes'].forEach(a => { const el = $('adm-pane-' + a); if (el) el.style.display = a === aba ? '' : 'none'; });
  if (aba === 'usuarios') admCarregarUsuarios();
  if (aba === 'funcionarios') admCarregarFuncionarios();
  if (aba === 'loja') admCarregarLoja();
  if (aba === 'dados') admCarregarDados();
  if (aba === 'logs') admCarregarLogs();
  if (aba === 'backup') admCarregarBackup();
  if (aba === 'sync') admCarregarSync();
  if (aba === 'midia') admCarregarMidia();
  if (aba === 'plataforma') admCarregarPlataforma();
  if (aba === 'atualizacoes') admCarregarAtualizacoes();
}

/* ── Sincronização entre máquinas (Administração → Sincronização) — só admin ── */
let sySt = null;
async function admCarregarSync() {
  const box = $('sy-status'); if (!box) return;
  let s; try { s = await (await fetch('/api/sync/status', { cache: 'no-store' })).json(); }
  catch { box.innerHTML = '<div class="adm-aviso">Falha ao carregar o estado da sincronização.</div>'; return; }
  sySt = s;
  const badge = s.ativo ? (s.online ? '<span class="atz-badge on">🟢 Online</span>' : '<span class="atz-badge off">🟠 Ligado, sem a pasta (offline)</span>') : '<span class="atz-badge off">🔴 Desligado</span>';
  const drive = s.driveDetectado ? '<span class="atz-badge on">✅ Google Drive detectado</span>' : '<span class="atz-badge off">⚠️ Google Drive não encontrado</span>';
  const conf = (s.conflitos || 0) > 0 ? `<span class="atz-badge off">⚠️ ${s.conflitos} conflito(s) p/ revisar</span>` : '<span class="atz-badge on">✅ nenhum</span>';
  box.innerHTML = `
    <div><span>Sincronização</span><b>${badge}</b></div>
    <div><span>Esta máquina</span><b>${crmEsc(s.nome || '—')}${s.numero ? ' (nº ' + s.numero + ')' : ''}</b></div>
    <div><span>Google Drive</span><b>${drive}</b></div>
    <div><span>Pasta</span><b style="font-size:.82em">${crmEsc(s.pasta || '— (instale/aguarde o Google Drive)')}</b></div>
    <div><span>Pendentes para enviar</span><b>${s.pendentesEnvio || 0}</b></div>
    <div><span>Pendentes para receber</span><b>${s.pendentesReceber || 0}</b></div>
    <div><span>Último envio</span><b>${s.ultimoExport ? fmtDataHora(s.ultimoExport) : '—'}</b></div>
    <div><span>Última leitura</span><b>${s.ultimoImport ? fmtDataHora(s.ultimoImport) : '—'}</b></div>
    <div><span>Conflitos</span><b>${conf}</b></div>`;
  // preenche o formulário só na 1ª carga (não atropela o que o usuário está digitando)
  if (!$('sy-nome').value) $('sy-nome').value = s.nome || '';
  if (s.numero && (+$('sy-numero').value === 1)) $('sy-numero').value = s.numero;
  if (!$('sy-pasta').value && s.pastaConfigurada && s.pastaConfigurada !== 'OFF') $('sy-pasta').value = s.pastaConfigurada;
  $('sy-primeira').checked = !!s.primeiraMaquina;
  // botão ligar/desligar — verde quando vai LIGAR? não: cor do ESTADO. Ligado=verde, desligado=vermelho.
  const tg = $('sy-toggle');
  tg.textContent = s.ativo ? '🔴 Desligar' : '🟢 Ligar';
  tg.classList.toggle('perigo', s.ativo);
  tg.classList.toggle('destaque', !s.ativo);
  // peers
  const tb = $('sy-peers');
  tb.innerHTML = (s.maquinas && s.maquinas.length)
    ? s.maquinas.map(m => `<tr><td>${crmEsc(m.nome || m.station)}</td><td>${m.visto_em ? fmtDataHora(m.visto_em) : '—'}</td></tr>`).join('')
    : '<tr><td colspan="2" class="adm-vazio">Nenhuma ainda.</td></tr>';
  // dica de onboarding: marcou "nova" (não-principal) numa máquina que JÁ tem dados → alerta de mistura
  const nota = $('sy-toggle-nota');
  if (nota) {
    if (!s.primeiraMaquina && s.temDados && !s.ativo)
      nota.innerHTML = '⚠️ <b>Atenção:</b> esta máquina já tem dados e NÃO está marcada como principal. Se ela for uma máquina NOVA que vai só receber, o certo é começar com o banco vazio (senão os dois se misturam). Se ela é a que tem os dados bons, marque <b>"já tem os dados"</b>.';
    else nota.textContent = 'Enquanto ligado, troca com as outras máquinas a cada ~20 segundos.';
  }
  admCarregarConflitos();
}
async function admCarregarConflitos() {
  const card = $('sy-conflitos-card'), box = $('sy-conflitos'); if (!card || !box) return;
  let lista = []; try { lista = await (await fetch('/api/sync/conflitos', { cache: 'no-store' })).json(); } catch {}
  if (!Array.isArray(lista) || !lista.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  const campo = (o, k) => (o && o[k] != null ? String(o[k]) : '');
  box.innerHTML = lista.map(c => {
    const l = c.local || {}, p = c.peer || {};
    const chaves = [...new Set([...Object.keys(l), ...Object.keys(p)])].filter(k => !['id', 'criado_em', 'atualizado_em'].includes(k) && campo(l, k) !== campo(p, k));
    const dif = chaves.map(k => `<tr><td>${crmEsc(k)}</td><td>${crmEsc(campo(l, k))}</td><td>${crmEsc(campo(p, k))}</td></tr>`).join('') || '<tr><td colspan="3" class="adm-vazio">(diferença sutil)</td></tr>';
    return `<div class="adm-card" style="margin:8px 0">
      <div class="adm-card-tit" style="font-size:.95em">${crmEsc(c.tbl)} · ${fmtDataHora(c.quando)} <small>(ficou com: ${c.vencedor === 'peer' ? 'a outra máquina' : 'esta máquina'})</small></div>
      <div class="adm-tabela-wrap"><table class="adm-tabela"><thead><tr><th>Campo</th><th>Esta máquina</th><th>Outra máquina</th></tr></thead><tbody>${dif}</tbody></table></div>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button class="adm-btn destaque" data-conf="${c.id}" data-esc="manter">✔ Manter a versão atual</button>
        <button class="adm-btn" data-conf="${c.id}" data-esc="trocar">↔ Usar a outra versão</button>
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-conf]').forEach(b => b.addEventListener('click', () => admResolverConflito(b.dataset.conf, b.dataset.esc)));
}
async function admResolverConflito(id, escolha) {
  try {
    await fetch('/api/sync/conflitos/resolver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: +id, escolha }) });
    toast(escolha === 'trocar' ? 'Trocado pela outra versão.' : 'Mantida a versão atual.', 'sucesso');
    admCarregarSync();
  } catch { toast('Falha ao resolver.', 'erro'); }
}
async function admSalvarSync() {
  const body = {
    nome: $('sy-nome').value.trim(),
    numero: +$('sy-numero').value || 1,
    pasta: $('sy-pasta').value.trim(),   // vazio = auto (Google Drive)
    primeira: $('sy-primeira').checked,
  };
  try {
    await fetch('/api/sync/configurar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    toast('Configuração salva.');
    admCarregarSync();
  } catch { toast('Falha ao salvar.', 'erro'); }
}
async function admToggleSync() {
  const ligar = !(sySt && sySt.ativo);
  if (ligar && !$('sy-nome').value.trim()) { toast('Dê um nome pra esta máquina antes de ligar.', 'erro'); return; }
  if (ligar) await admSalvarSync();   // garante que salvou nome/pasta/principal antes de ligar
  try {
    await fetch('/api/sync/ligar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ligar }) });
    toast(ligar ? '🟢 Sincronização ligada.' : '🔴 Sincronização desligada.');
    admCarregarSync();
  } catch { toast('Falha ao ligar/desligar.', 'erro'); }
}
async function admSyncAgora() {
  const b = $('sy-agora'); b.disabled = true; b.textContent = '⏳ Sincronizando…';
  try { await fetch('/api/sync/agora', { method: 'POST' }); toast('Sincronizado.'); admCarregarSync(); }
  catch { toast('Falha ao sincronizar.', 'erro'); }
  finally { b.disabled = false; b.textContent = '🔄 Sincronizar agora'; }
}

/* ── Atualização do sistema (Administração → Atualizações) — só admin ── */
let atzVerif = null, atzPolling = null;
async function admCarregarAtualizacoes() {
  const el = $('atz-conteudo'); if (!el) return;
  el.innerHTML = biLoading();
  let s; try { s = await (await fetch('/api/atualizacao/status', { cache: 'no-store' })).json(); }
  catch { el.innerHTML = '<div class="adm-aviso">Falha ao carregar o estado das atualizações.</div>'; return; }
  const ur = s.ultimoResultado;
  const conBadge = s.conectado ? '<span class="atz-badge on">✅ ligada ao GitHub</span>'
    : (s.onlineSemGit ? '<span class="atz-badge on">✅ atualização online (sem Git)</span>'
    : (s.gitDisponivel ? '<span class="atz-badge off">⚠️ não ligada ao repositório</span>' : '<span class="atz-badge off">⚠️ Git não instalado</span>'));
  // ESTADO ATUAL (o que importa) — só cai pra "falha" antiga como notinha discreta.
  let estado = '';
  if (s.conectado) {
    if (s.atras > 0) estado = `<div class="atz-ultimo nova">🎉 Nova versão disponível (${s.atras} atualização(ões)). Clique em <b>Verificar</b> e <b>Atualizar</b>.</div>`;
    else if (s.aFrente > 0) estado = '<div class="atz-ultimo ok">✅ Você está na versão mais recente <small>(seu código está à frente do repositório — nada a baixar).</small></div>';
    else estado = '<div class="atz-ultimo ok">✅ Você está na versão mais recente.</div>';
  }
  // a última tentativa vira nota discreta só quando FALHOU e ainda há algo pra atualizar (senão é ruído do passado)
  const ultimo = estado + (ur && ur.status !== 'OK' && s.atras > 0 ? `<div class="atz-ultimo-nota">Última tentativa falhou (${crmEsc(ur.quando || '')})${ur.detalhe ? ` — <small>${crmEsc(ur.detalhe)}</small>` : ''}. Veja o histórico abaixo.</div>` : '');
  el.innerHTML = `
    <div class="adm-card">
      <div class="adm-card-tit">🔄 Atualização do sistema</div>
      <div class="atz-topo">
        <div class="atz-kv"><span>Versão instalada</span><b>${crmEsc(s.versao || '?')}</b></div>
        <div class="atz-kv"><span>Código</span><b>${crmEsc(s.commitLocal || '—')}</b></div>
        <div class="atz-kv"><span>Conexão</span><b>${conBadge}</b></div>
      </div>
      ${ultimo}
      <div class="atz-acoes">
        ${s.gitDisponivel ? `<button class="adm-btn ${s.conectado ? '' : 'destaque'}" id="atz-conectar">${s.conectado ? '🔧 Reparar / realinhar' : '🔗 Ligar ao GitHub'}</button>` : ''}
        <button class="adm-btn" id="atz-verificar" ${(s.conectado || s.onlineSemGit) ? '' : 'disabled'}>🔍 Verificar atualização</button>
        <button class="adm-btn secundario" id="atz-atualizar" disabled>⬆️ Atualizar agora</button>
      </div>
      <div id="atz-resultado" class="atz-resultado"></div>
      <p class="adm-aviso">A atualização baixa só o código do GitHub e <b>preserva todos os dados</b> (clientes, vendas, estoque, configurações). Antes, é feito um <b>backup automático</b>. Se algo falhar, o sistema volta sozinho para a versão anterior.</p>
    </div>
    <div class="adm-card">
      <div class="adm-card-tit">📜 Histórico de atualizações</div>
      <div id="atz-historico">—</div>
    </div>`;
  const cbtn = $('atz-conectar'); if (cbtn) cbtn.addEventListener('click', atzConectar);
  const v = $('atz-verificar'); if (v) v.addEventListener('click', atzVerificar);
  const a = $('atz-atualizar'); if (a) a.addEventListener('click', atzAtualizar);
  atzCarregarHistorico();
}
async function atzConectar() {
  const box = $('atz-resultado'), b = $('atz-conectar');
  box.innerHTML = '<div class="atz-atualizando"><div class="atz-spinner"></div><div><b>Ligando ao GitHub…</b><br><small>Vai abrir uma janela do GitHub pedindo <b>login</b> — faça o login (só na 1ª vez) e aguarde. Não feche esta tela.</small></div></div>';
  if (b) b.disabled = true;
  let r; try { r = await (await fetch('/api/atualizacao/conectar', { method: 'POST' })).json(); }
  catch { box.innerHTML = '<div class="atz-msg erro">Falha ao ligar. Tente de novo.</div>'; if (b) b.disabled = false; return; }
  if (r.erro) { box.innerHTML = `<div class="atz-msg erro">⚠ ${crmEsc(r.erro)}</div>`; if (b) b.disabled = false; return; }
  box.innerHTML = '<div class="atz-msg ok">✅ Ligada ao GitHub! Agora é só <b>Verificar</b> e <b>Atualizar</b>.</div>';
  setTimeout(admCarregarAtualizacoes, 1600);
}
async function atzVerificar() {
  const box = $('atz-resultado'), b = $('atz-verificar');
  box.innerHTML = '⏳ Verificando no GitHub…'; b.disabled = true;
  let r; try { r = await (await fetch('/api/atualizacao/verificar', { method: 'POST' })).json(); }
  catch { box.innerHTML = '<div class="atz-msg erro">Falha ao verificar.</div>'; b.disabled = false; return; }
  b.disabled = false;
  if (r.erro) { box.innerHTML = `<div class="atz-msg erro">⚠ ${crmEsc(r.erro)}</div>`; $('atz-atualizar').disabled = true; return; }
  atzVerif = r;
  if (!r.novaVersao) { box.innerHTML = '<div class="atz-msg ok">✅ O sistema já está na versão mais recente.</div>'; $('atz-atualizar').disabled = true; return; }
  const lista = (r.resumo || []).map(x => `<li>${crmEsc(x)}</li>`).join('');
  box.innerHTML = `<div class="atz-msg nova">🎉 Nova versão disponível — <b>${r.commitsAtras}</b> atualização(ões). O sistema reinicia ao aplicar.</div>${lista ? `<ul class="atz-resumo">${lista}</ul>` : ''}`;
  $('atz-atualizar').disabled = false;
}
async function atzAtualizar() {
  if (typeof itensCupom !== 'undefined' && itensCupom && itensCupom.length &&
      !confirm('Há uma venda em andamento no PDV (carrinho com itens). Atualizar agora vai reiniciar o sistema. Continuar mesmo assim?')) return;
  if (!confirm('Atualizar o sistema agora?\n\n• Backup automático antes\n• O sistema fecha e reabre sozinho\n• Seus dados são preservados\n\nConfirmar?')) return;
  const box = $('atz-resultado'), a = $('atz-atualizar'), v = $('atz-verificar');
  a.disabled = true; v.disabled = true;
  let r; try { r = await (await fetch('/api/atualizacao/aplicar', { method: 'POST' })).json(); }
  catch { box.innerHTML = '<div class="atz-msg erro">Falha ao iniciar a atualização.</div>'; a.disabled = false; v.disabled = false; return; }
  if (r.erro) { box.innerHTML = `<div class="atz-msg erro">⚠ ${crmEsc(r.erro)}</div>`; v.disabled = false; a.disabled = !!r.bloqueado; return; }
  if (r.semNovidade) { box.innerHTML = `<div class="atz-msg ok">✅ ${crmEsc(r.mensagem || 'Você já está na versão mais recente.')}</div>`; v.disabled = false; a.disabled = true; return; }
  atzAguardarReinicio(r);
}
function atzAguardarReinicio(r) {
  const box = $('atz-resultado');
  box.innerHTML = `<div class="atz-atualizando"><div class="atz-spinner"></div><div><b>Atualizando o sistema…</b><br><small>O sistema vai reiniciar.${r.backup ? ' Backup: ' + crmEsc(r.backup) + '.' : ''}<br>Esta tela recarrega sozinha quando terminar. Não feche.</small></div></div>`;
  let caiu = false, tentativas = 0;
  clearInterval(atzPolling);
  atzPolling = setInterval(async () => {
    tentativas++;
    try {
      const resp = await fetch('/api/atualizacao/status', { cache: 'no-store' });
      if (!resp.ok) throw 0;
      const s = await resp.json();
      if (caiu) {
        clearInterval(atzPolling);
        const ur = s.ultimoResultado || {};
        if (ur.status === 'OK') { box.innerHTML = '<div class="atz-msg ok">✅ Sistema atualizado com sucesso! Recarregando…</div>'; setTimeout(() => location.replace('/?nc=' + Date.now()), 1500); }
        else { box.innerHTML = `<div class="atz-msg erro">🔴 A atualização falhou e a versão anterior foi restaurada.${ur.detalhe ? `<br><small>${crmEsc(ur.detalhe)}</small>` : ''}</div>`; setTimeout(admCarregarAtualizacoes, 2500); }
      }
    } catch { caiu = true; }
    if (tentativas > 120) { clearInterval(atzPolling); box.innerHTML = '<div class="atz-msg erro">A atualização está demorando. Confira o sistema — seu backup está salvo.</div>'; }
  }, 2000);
}
async function atzCarregarHistorico() {
  const box = $('atz-historico'); if (!box) return;
  let h; try { h = await (await fetch('/api/atualizacao/historico', { cache: 'no-store' })).json(); } catch { box.innerHTML = '—'; return; }
  if (!Array.isArray(h) || !h.length) { box.innerHTML = '<div class="adm-aviso">Nenhuma atualização registrada ainda.</div>'; return; }
  const map = { sucesso: '✅ sucesso', falha: '🔴 falha', iniciada: '⏳ iniciada' };
  box.innerHTML = `<div class="adm-tabela-wrap"><table class="adm-tabela"><thead><tr><th>Quando</th><th>Por</th><th>De→Para</th><th>Status</th><th>Detalhe</th></tr></thead><tbody>${h.map(x => `<tr><td>${fmtDataHora(x.quando)}</td><td>${crmEsc(nomeOp(x.por))}</td><td>${(x.de_commit || '').slice(0, 7)}→${(x.para_commit || '').slice(0, 7) || '…'}</td><td>${map[x.status] || crmEsc(x.status || '')}</td><td>${crmEsc(x.detalhe || '')}</td></tr>`).join('')}</tbody></table></div>`;
}
/* ── Fase 36: Plataforma — saúde do ERP + módulos ativos + próximos módulos ── */
async function admCarregarPlataforma() {
  try {
    const [saude, mods, info] = await Promise.all([
      (await fetch('/api/erp/consistencia', { cache: 'no-store' })).json(),
      (await fetch('/api/modulos', { cache: 'no-store' })).json(),
      (await fetch('/api/manutencao/info', { cache: 'no-store' })).json().catch(() => ({})),
    ]);
    // manutenção / schema (Fase 37)
    const mel = $('plat-manutencao');
    if (mel) {
      mel.innerHTML = `<div class="plat-manut-grid">
        <div class="plat-kv"><span class="plat-kv-lbl">Schema</span><span class="plat-kv-val">${escapar(info.schema_versao || '—')}</span></div>
        <div class="plat-kv"><span class="plat-kv-lbl">Journal</span><span class="plat-kv-val">${escapar(String(info.journal_mode || '—')).toUpperCase()}</span></div>
        <div class="plat-kv"><span class="plat-kv-lbl">Índices</span><span class="plat-kv-val">${info.indices ?? '—'}</span></div>
        <div class="plat-kv"><span class="plat-kv-lbl">Migrações</span><span class="plat-kv-val">${(info.migracoes || []).length}</span></div>
      </div>
      ${usuarioAtual && usuarioAtual.perfil === 'admin' ? '<button class="adm-btn secundario" id="plat-otimizar">🛠️ Otimizar banco</button><span id="plat-otimizar-res" class="plat-otim-res"></span>' : ''}`;
      const ob = $('plat-otimizar');
      if (ob) ob.addEventListener('click', async () => {
        ob.disabled = true; $('plat-otimizar-res').textContent = 'otimizando…';
        try { const r = await (await fetch('/api/manutencao/otimizar', { cache: 'no-store' })).json();
          $('plat-otimizar-res').textContent = r.ok ? `✅ integridade: ${(r.integridade && r.integridade.integrity_check) || '—'}` : ('⚠ ' + (r.erro || 'falhou'));
        } catch { $('plat-otimizar-res').textContent = '⚠ falhou'; }
        ob.disabled = false;
      });
    }
    // saúde
    const geralOk = saude.status_geral === 'ok';
    const linhas = (saude.checks || []).map(c => `<div class="plat-check ${c.status}">
      <span class="plat-check-dot"></span>
      <div class="plat-check-body"><div class="plat-check-tit">${escapar(c.titulo)} <b>${escapar(String(c.valor))}</b></div><div class="plat-check-det">${escapar(c.detalhe || '')}</div></div></div>`).join('');
    $('plat-saude').innerHTML = `<div class="plat-saude-topo ${geralOk ? 'ok' : 'alerta'}">${geralOk ? '✅ Tudo consistente' : `⚠️ ${saude.alertas} ponto(s) para conferir`}</div>${linhas}`;
    // ativos
    const catLabel = { operacao: '⚙️ Operação', financeiro: '💵 Financeiro', gestao: '📊 Gestão' };
    const porCat = {};
    (mods.ativos || []).forEach(m => { (porCat[m.categoria] = porCat[m.categoria] || []).push(m); });
    $('plat-ativos').innerHTML = `<div class="plat-resumo">${mods.resumo.ativos} módulos ativos · ${mods.resumo.planejados} planejados</div>` +
      Object.entries(porCat).map(([cat, arr]) => `<div class="plat-cat"><div class="plat-cat-tit">${catLabel[cat] || cat}</div><div class="plat-grid">${arr.map(m => `<div class="plat-mod ativo"><span class="plat-mod-ico">${m.icone}</span><div><div class="plat-mod-nome">${escapar(m.nome)}</div><div class="plat-mod-fase">Fase ${escapar(m.fase)}</div></div></div>`).join('')}</div></div>`).join('');
    // planejados
    $('plat-planejados').innerHTML = `<div class="plat-grid">${(mods.planejados || []).map(m => `<div class="plat-mod planejado">
      <span class="plat-mod-ico">${m.icone}</span>
      <div class="plat-mod-corpo"><div class="plat-mod-nome">${escapar(m.nome)} <span class="plat-badge">${m.habilitado ? 'habilitado' : 'planejado'}</span></div><div class="plat-mod-desc">${escapar(m.descricao || '')}</div></div></div>`).join('')}</div>`;
  } catch { $('plat-saude').innerHTML = '<p class="adm-aviso">Falha ao carregar (acesso restrito a admin/supervisor).</p>'; }
}
document.querySelectorAll('.adm-tab').forEach(b => b.addEventListener('click', () => abrirAbaAdm(b.dataset.aba)));

/* ── Dados da Loja (Fase 20) — identidade + parâmetros no backend ── */
let lojaConfigCache = null;
async function carregarLojaConfig() {
  try { lojaConfigCache = await (await fetch('/api/loja/config', { cache: 'no-store' })).json(); aplicarLojaConfig(); } catch {}
  return lojaConfigCache;
}
function aplicarLojaConfig() {
  if (!lojaConfigCache) return;
  try { document.title = (lojaConfigCache.loja_nome || 'Açaí') + ' — Sistema'; } catch {}
}
async function admCarregarLoja() {
  const c = await carregarLojaConfig() || {};
  const set = (id, v) => { const el = $(id); if (el) el.value = v != null ? v : ''; };
  set('lj-nome', c.loja_nome); set('lj-telefone', c.loja_telefone); set('lj-endereco', c.loja_endereco);
  set('lj-bairro', c.loja_bairro); set('lj-horario', c.loja_horario);
  set('lj-taxa', c.loja_taxa_entrega || ''); set('lj-mensagem', c.loja_mensagem_atendimento);
}
{ const f = $('adm-form-loja'); if (f) f.addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    loja_nome: $('lj-nome').value.trim(), loja_telefone: $('lj-telefone').value.trim(),
    loja_endereco: $('lj-endereco').value.trim(), loja_bairro: $('lj-bairro').value.trim(),
    loja_horario: $('lj-horario').value.trim(), loja_taxa_entrega: $('lj-taxa').value || '0',
    loja_mensagem_atendimento: $('lj-mensagem').value.trim(),
  };
  if (!body.loja_nome) { toast('⚠ Informe o nome da loja', 'erro'); return; }
  try {
    const r = await fetch('/api/loja/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.erro || 'Não foi possível salvar', 'erro'); return; }
    lojaConfigCache = await r.json(); aplicarLojaConfig();
    toast('✅ Dados da loja salvos', 'sucesso');
  } catch { toast('Sem conexão com o servidor', 'erro'); }
}); }

/* ── Dados / Exportar / Importar (Fase 20) ── */
const EXPORT_TIPOS = ['clientes', 'produtos', 'vendas', 'pedidos', 'compras', 'insumos'];
async function admCarregarDados() {
  try {
    const s = await (await fetch('/api/loja/status-instalacao', { cache: 'no-store' })).json();
    const item = (ok, lbl, val) => `<div class="adm-status-item"><span class="asi-dot ${ok ? 'on' : 'off'}"></span><div><div class="asi-val">${escapar(String(val))}</div><div class="asi-lbl">${lbl}</div></div></div>`;
    $('ad-status').innerHTML = [
      item(s.admins > 0, 'Admin ativo', s.admins + ' admin(s)'),
      item(s.lojaConfigurada, 'Loja configurada', s.lojaConfigurada ? 'Sim' : 'Pendente'),
      item(s.produtos > 0, 'Produtos', s.produtos),
      item(s.clientes > 0, 'Clientes', s.clientes),
      item(s.vendas > 0, 'Vendas', s.vendas),
      item(s.whatsappConectado, 'WhatsApp', s.whatsappConectado ? 'Conectado' : 'Desconectado'),
      item(s.temBackup, 'Backup', s.temBackup ? 'Existe' : 'Nenhum'),
    ].join('');
  } catch { $('ad-status').textContent = 'Não foi possível carregar o status.'; }
  $('ad-export').innerHTML = EXPORT_TIPOS.map(t =>
    `<div class="ad-export-item"><span class="ade-nome">${t}</span>
      <button class="adm-btn secundario mini" data-exp="${t}" data-fmt="json">JSON</button>
      <button class="adm-btn secundario mini" data-exp="${t}" data-fmt="csv">CSV</button></div>`).join('');
}
function baixarExport(tipo, fmt) {
  const url = `/api/exportar/${tipo}` + (fmt === 'csv' ? '?formato=csv' : '');
  const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
  toast(`⬇️ Exportando ${tipo} (${(fmt || 'json').toUpperCase()})…`, 'sucesso');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-exp]'); if (!b) return;
  baixarExport(b.dataset.exp, b.dataset.fmt || 'json');
});
function ligarImport(inputId, tipo) {
  const el = $(inputId); if (!el) return;
  el.addEventListener('change', async () => {
    const file = el.files && el.files[0]; if (!file) return;
    try {
      const dados = JSON.parse(await file.text());
      const r = await fetch('/api/importar/' + tipo, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
      const j = await r.json();
      if (!r.ok) toast(j.erro || 'Falha na importação', 'erro');
      else if (tipo === 'clientes') toast(`✅ Clientes: ${j.criados} novo(s), ${j.atualizados} atualizado(s)`, 'sucesso');
      else toast(`✅ ${j.importados} produto(s) importado(s)`, 'sucesso');
    } catch { toast('Arquivo JSON inválido', 'erro'); }
    el.value = '';
  });
}
ligarImport('ad-imp-clientes', 'clientes');
ligarImport('ad-imp-produtos', 'produtos');

/* ── Aba Usuários ── */
async function admCarregarUsuarios() {
  const tbody = $('adm-usuarios-tbody');
  try {
    const usuarios = await (await fetch('/api/usuarios', { cache: 'no-store' })).json();
    if (!Array.isArray(usuarios) || !usuarios.length) { tbody.innerHTML = '<tr><td colspan="6" class="adm-vazio">Nenhum usuário.</td></tr>'; return; }
    tbody.innerHTML = usuarios.map(u => `
      <tr data-id="${u.id}">
        <td>${escapar(u.nome)}</td>
        <td>${escapar(u.usuario)}</td>
        <td>
          <select class="adm-sel-perfil" data-id="${u.id}" style="padding:5px 8px;border-radius:8px;border:1px solid var(--vidro-borda);background:rgba(0,0,0,0.3);color:var(--branco)">
            ${['operador', 'supervisor', 'admin'].map(p => `<option value="${p}" ${u.perfil === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </td>
        <td><span class="adm-tag ${u.ativo ? 'on' : 'off'}">${u.ativo ? 'ativo' : 'inativo'}</span></td>
        <td>${u.ultimo_login ? fmtDataHora(u.ultimo_login) : '—'}</td>
        <td class="adm-acoes-td">
          <button class="adm-btn mini" data-acao="senha" data-id="${u.id}" title="Trocar a senha">🔑 Senha</button>
          <button class="adm-btn mini ${u.ativo ? 'perigo' : ''}" data-acao="ativo" data-id="${u.id}" data-ativo="${u.ativo}">${u.ativo ? '⛔ Desativar' : '✔ Ativar'}</button>
        </td>
      </tr>`).join('');
  } catch { tbody.innerHTML = '<tr><td colspan="6" class="adm-vazio">⚠ Não consegui carregar os usuários.</td></tr>'; }
}
$('adm-form-usuario').addEventListener('submit', async e => {
  e.preventDefault();
  const dados = { nome: $('au-nome').value.trim(), usuario: $('au-usuario').value.trim(), senha: $('au-senha').value, perfil: $('au-perfil').value };
  if (!dados.nome || !dados.usuario || !dados.senha) return;
  try {
    const r = await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
    const j = await r.json();
    if (!r.ok) { toast('⚠ ' + (j.erro || 'Não foi possível criar')); return; }
    toast(`✅ Usuário ${j.usuario} criado (${j.perfil})`, 'sucesso');
    $('adm-form-usuario').reset();
    admCarregarUsuarios();
  } catch { toast('⚠ Servidor indisponível'); }
});
// ações da tabela: trocar perfil (select), trocar senha (input inline) e ativar/desativar
$('adm-usuarios-tbody').addEventListener('change', async e => {
  const sel = e.target.closest('.adm-sel-perfil');
  if (!sel) return;
  try {
    const r = await fetch('/api/usuarios/' + sel.dataset.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perfil: sel.value }) });
    if (r.ok) toast('✅ Perfil atualizado', 'sucesso'); else { toast('⚠ Não foi possível alterar'); admCarregarUsuarios(); }
  } catch { toast('⚠ Servidor indisponível'); admCarregarUsuarios(); }
});
$('adm-usuarios-tbody').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-acao]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.acao === 'ativo') {
    const ativar = btn.dataset.ativo !== '1';
    if (!ativar && usuarioAtual && String(usuarioAtual.id) === String(id)) { toast('⚠ Você não pode desativar a si mesmo'); return; }
    if (!ativar && !confirm('Desativar este usuário? As sessões dele serão encerradas.')) return;
    try {
      await fetch(`/api/usuarios/${id}/ativo`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: ativar }) });
      toast(ativar ? '✅ Usuário reativado' : '⛔ Usuário desativado', 'sucesso');
      admCarregarUsuarios();
    } catch { toast('⚠ Servidor indisponível'); }
    return;
  }
  if (btn.dataset.acao === 'senha') {
    // troca o botão por um input de senha inline (a senha nunca aparece na tela)
    const cel = btn.parentElement;
    cel.innerHTML = `<span class="adm-senha-inline">
      <input type="password" placeholder="nova senha" autocomplete="new-password">
      <button class="adm-btn mini destaque" data-acao="senha-ok" data-id="${id}">OK</button>
      <button class="adm-btn mini" data-acao="senha-cancela">✕</button>
    </span>`;
    cel.querySelector('input').focus();
    return;
  }
  if (btn.dataset.acao === 'senha-cancela') { admCarregarUsuarios(); return; }
  if (btn.dataset.acao === 'senha-ok') {
    const inp = btn.parentElement.querySelector('input');
    const senha = inp.value;
    if (!senha || senha.length < 4) { toast('⚠ Senha muito curta (mínimo 4)'); inp.focus(); return; }
    try {
      const r = await fetch(`/api/usuarios/${id}/senha`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }) });
      if (r.ok) { toast('🔑 Senha alterada', 'sucesso'); admCarregarUsuarios(); }
      else toast('⚠ Não foi possível trocar a senha');
    } catch { toast('⚠ Servidor indisponível'); }
  }
});

/* ── Aba Funcionários (quem pega consumo interno) ── */
async function admCarregarFuncionarios() {
  const tbody = $('adm-funcionarios-tbody'); if (!tbody) return;
  try {
    const lista = await (await fetch('/api/funcionarios', { cache: 'no-store' })).json();
    if (!Array.isArray(lista) || !lista.length) { tbody.innerHTML = '<tr><td colspan="3" class="adm-vazio">Nenhum funcionário cadastrado ainda.</td></tr>'; return; }
    tbody.innerHTML = lista.map(f => `
      <tr data-id="${f.id}">
        <td>${escapar(f.nome)}</td>
        <td><span class="adm-tag ${f.ativo ? 'on' : 'off'}">${f.ativo ? 'ativo' : 'inativo'}</span></td>
        <td class="adm-acoes-td">
          <button class="adm-btn mini ${f.ativo ? 'perigo' : ''}" data-facao="ativo" data-id="${f.id}" data-ativo="${f.ativo ? 1 : 0}">${f.ativo ? '⛔ Desativar' : '✔ Ativar'}</button>
          <button class="adm-btn mini perigo" data-facao="excluir" data-id="${f.id}" title="Remover da lista">🗑</button>
        </td>
      </tr>`).join('');
  } catch { tbody.innerHTML = '<tr><td colspan="3" class="adm-vazio">⚠ Não consegui carregar os funcionários.</td></tr>'; }
}
{ const form = $('adm-form-funcionario'); if (form) form.addEventListener('submit', async e => {
  e.preventDefault();
  const nome = $('af-nome').value.trim(); if (!nome) return;
  try {
    const r = await fetch('/api/funcionarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome }) });
    const j = await r.json();
    if (!r.ok) { toast('⚠ ' + (j.erro || 'Não foi possível cadastrar')); return; }
    toast(j.jaExistia ? `✅ ${j.nome} reativado` : `✅ ${j.nome} cadastrado`, 'sucesso');
    form.reset(); admCarregarFuncionarios();
  } catch { toast('⚠ Servidor indisponível'); }
}); }
{ const tb = $('adm-funcionarios-tbody'); if (tb) tb.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-facao]'); if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.facao === 'ativo') {
    const ativar = btn.dataset.ativo !== '1';
    try { await fetch('/api/funcionarios/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: ativar }) }); toast(ativar ? '✅ Reativado' : '⛔ Desativado', 'sucesso'); admCarregarFuncionarios(); }
    catch { toast('⚠ Servidor indisponível'); }
  } else if (btn.dataset.facao === 'excluir') {
    if (!confirm('Remover este funcionário da lista?')) return;
    try { await fetch('/api/funcionarios/' + id, { method: 'DELETE' }); admCarregarFuncionarios(); } catch {}
  }
}); }

/* ── Aba Segurança / Logs ── */
async function admCarregarLogs() {
  const tbody = $('adm-logs-tbody');
  const q = new URLSearchParams();
  if ($('al-acao').value.trim()) q.set('acao', $('al-acao').value.trim());
  if ($('al-modulo').value.trim()) q.set('modulo', $('al-modulo').value.trim());
  if ($('al-de').value) q.set('de', $('al-de').value);
  if ($('al-ate').value) q.set('ate', $('al-ate').value);
  try {
    const logs = await (await fetch('/api/logs-acoes?' + q, { cache: 'no-store' })).json();
    if (!Array.isArray(logs) || !logs.length) { tbody.innerHTML = '<tr><td colspan="5" class="adm-vazio">Nenhum registro no filtro.</td></tr>'; return; }
    tbody.innerHTML = logs.map(l => `
      <tr>
        <td style="white-space:nowrap">${fmtDataHora(l.data)}</td>
        <td><strong>${escapar(l.acao)}</strong></td>
        <td>${escapar(l.modulo || '—')}</td>
        <td>${escapar(l.origem || '—')}</td>
        <td class="adm-detalhes">${escapar(l.detalhes || '')}</td>
      </tr>`).join('');
  } catch { tbody.innerHTML = '<tr><td colspan="5" class="adm-vazio">⚠ Não consegui carregar os logs.</td></tr>'; }
}
$('al-filtrar').addEventListener('click', admCarregarLogs);
['al-acao', 'al-modulo'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); admCarregarLogs(); } }));

/* ── Aba Backup ── */
const fmtMB = b => (b / 1048576).toFixed(1) + ' MB';
async function admCarregarBackup() {
  try {
    const [st, lista] = await Promise.all([
      (await fetch('/api/backup/status', { cache: 'no-store' })).json(),
      (await fetch('/api/backup/listar', { cache: 'no-store' })).json(),
    ]);
    $('ab-status').innerHTML = `
      <div class="adm-stat"><div class="as-num">${st.ultimo ? fmtDataHora(st.ultimo.criado) : '—'}</div><div class="as-lbl">💾 Último backup</div></div>
      <div class="adm-stat"><div class="as-num">${st.ultimo ? fmtMB(st.ultimo.tamanho) : '—'}</div><div class="as-lbl">📦 Tamanho</div></div>
      <div class="adm-stat"><div class="as-num">${st.total}</div><div class="as-lbl">🗂 Backups guardados</div></div>
      <div class="adm-stat"><div class="as-num">${fmtDataHora(st.proximaExecucao)}</div><div class="as-lbl">⏰ Próxima execução</div></div>`;
    $('adm-backups-tbody').innerHTML = (lista && lista.length)
      ? lista.map(b => `<tr><td>${escapar(b.arquivo)}</td><td>${fmtMB(b.tamanho)}</td><td>${fmtDataHora(b.criado)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="adm-vazio">Nenhum backup ainda.</td></tr>';
  } catch {
    $('ab-status').innerHTML = '<div class="adm-vazio">⚠ Não consegui carregar o status.</div>';
  }
}
$('ab-criar').addEventListener('click', async () => {
  $('ab-criar').disabled = true;
  toast('💾 Criando backup… (pode levar alguns segundos)');
  try {
    const j = await (await fetch('/api/backup/criar', { method: 'POST' })).json();
    if (j.ok) toast(`✅ Backup criado: ${j.arquivo}`, 'sucesso'); else toast('⚠ Falha no backup: ' + (j.erro || ''));
    admCarregarBackup();
  } catch { toast('⚠ Servidor indisponível'); }
  finally { $('ab-criar').disabled = false; }
});

/* ── Aba Sincronização — listeners ── */
{
  const f = $('sy-form'); if (f) f.addEventListener('submit', e => { e.preventDefault(); admSalvarSync(); });
  const t = $('sy-toggle'); if (t) t.addEventListener('click', admToggleSync);
  const a = $('sy-agora'); if (a) a.addEventListener('click', admSyncAgora);
}

/* ── Aba Mídia WhatsApp ── */
async function admCarregarMidia() {
  try {
    const m = await (await fetch('/api/manutencao/midia/status', { cache: 'no-store' })).json();
    $('am-status').innerHTML = `
      <div class="adm-stat"><div class="as-num">${m.totalMensagens}</div><div class="as-lbl">💬 Mensagens no banco</div></div>
      <div class="adm-stat"><div class="as-num">${m.mensagensComMidia}</div><div class="as-lbl">🖼 Com mídia (anexo)</div></div>
      <div class="adm-stat"><div class="as-num">${m.tamanhoMB} MB</div><div class="as-lbl">📦 Tamanho aproximado</div></div>
      <div class="adm-stat"><div class="as-num">${m.midiaMaisAntiga ? fmtDataHora(m.midiaMaisAntiga) : '—'}</div><div class="as-lbl">📅 Mídia mais antiga</div></div>
      <div class="adm-stat"><div class="as-num">${m.midiaMaisRecente ? fmtDataHora(m.midiaMaisRecente) : '—'}</div><div class="as-lbl">🕒 Mídia mais recente</div></div>`;
  } catch { $('am-status').innerHTML = '<div class="adm-vazio">⚠ Não consegui carregar o status.</div>'; }
}
$('am-limpar').addEventListener('click', async () => {
  const dias = +$('am-dias').value || 0;
  if (dias <= 0) { toast('⚠ Informe um número de dias válido'); return; }
  // confirmação forte: digitar LIMPAR (não dá pra desfazer)
  const conf = prompt(`Isso vai APAGAR os anexos das mensagens com mais de ${dias} dia(s) — o texto é preservado.\nNão dá pra desfazer.\n\nDigite LIMPAR para confirmar:`);
  if (conf !== 'LIMPAR') { if (conf !== null) toast('Limpeza cancelada (confirmação não confere)'); return; }
  $('am-limpar').disabled = true;
  try {
    const j = await (await fetch('/api/manutencao/midia/limpar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dias }) })).json();
    if (j.erro) toast('⚠ ' + j.erro);
    else toast(`🧹 ${j.limpas} mídia(s) limpas (mensagens com mais de ${dias} dias)`, 'sucesso');
    admCarregarMidia();
  } catch { toast('⚠ Servidor indisponível'); }
  finally { $('am-limpar').disabled = false; }
});

/* ══════════════════════════════════════════════════════════════════════════
   BI / RELATÓRIOS / GESTÃO (Fase 25) — só leitura. Consome /api/bi/* com um
   filtro de período global. Nada aqui grava (o CSV é gerado no backend, que
   loga a exportação). Visível pra admin/supervisor; o backend é a trava real.
   ══════════════════════════════════════════════════════════════════════════ */
let biPeriodo = '30d', biAbaAtual = 'geral', biDe = '', biAte = '';
const biFmt = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });  // 1.200,00
const biPct = v => (Number(v || 0) * 100).toFixed(1).replace('.', ',') + '%';
const biNum = v => Number(v || 0).toLocaleString('pt-BR');
const biDiaCurto = iso => { const p = (iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : iso; };
const biDataHora = iso => { try { const d = new Date(iso); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };
const biLoading = () => '<div class="bi-loading">Carregando…</div>';
const biErro = () => '<div class="bi-vazio">⚠ Não consegui carregar. Tente de novo.</div>';
const biVazio = (t) => `<div class="bi-vazio">${t || 'Sem dados no período.'}</div>`;
const biCard = (ico, valor, label, extra = '') => `<div class="bi-card"><div class="bi-card-top">${ico}</div><div class="bi-card-num">${valor}</div><div class="bi-card-lbl">${label}</div>${extra ? `<div class="bi-card-extra">${extra}</div>` : ''}</div>`;
const biSecao = (tit, conteudo) => `<div class="bi-secao"><h3 class="bi-secao-tit">${tit}</h3>${conteudo}</div>`;
function biBars(items, fmtVal) {
  const f = fmtVal || biFmt;
  const max = Math.max(1, ...items.map(i => Math.abs(i.valor || 0)));
  return '<div class="bi-bars">' + items.map(i => `<div class="bi-bar"><span class="bi-bar-lbl">${crmEsc(i.label)}</span><span class="bi-bar-track"><span class="bi-bar-fill" style="width:${Math.max(2, (Math.abs(i.valor || 0) / max * 100)).toFixed(1)}%"></span></span><span class="bi-bar-val">${f(i.valor)}</span></div>`).join('') + '</div>';
}
function biTabela(cols, rows, vazio) {
  if (!rows.length) return biVazio(vazio);
  return `<div class="bi-tab-wrap"><table class="bi-tabela"><thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${c.h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((cell, i) => `<td class="${(cols[i] || {}).cls || ''}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function biQuery() { const q = new URLSearchParams({ periodo: biPeriodo }); if (biPeriodo === 'custom') { if (biDe) q.set('de', biDe); if (biAte) q.set('ate', biAte); } return q.toString(); }
async function biGet(rota) { return await (await fetch(`/api/bi/${rota}?${biQuery()}`, { cache: 'no-store' })).json(); }

async function renderBIgeral() {
  const el = $('bi-geral'); el.innerHTML = biLoading();
  let d; try { d = await biGet('visao-geral'); } catch { el.innerHTML = biErro(); return; }
  const temCusto = d.coberturaCusto > 0;
  const custoTxt = temCusto ? biFmt(d.custoEstimado) : '—';
  const lucroTxt = temCusto ? biFmt(d.lucroEstimado) : '—';
  el.innerHTML = `
    <div class="bi-cards">
      ${biCard('💵', biFmt(d.faturamento), 'Faturamento bruto', `🛒 ${biFmt(d.faturamentoBalcao)} · 🛵 ${biFmt(d.faturamentoDelivery)}`)}
      ${biCard('📈', lucroTxt, 'Lucro bruto estimado', temCusto ? `margem ${biPct(d.margemEstimada)}` : 'sem custo cadastrado')}
      ${biCard('🧾', custoTxt, 'Custo estimado', temCusto ? `cobre ${biPct(d.coberturaCusto)} do faturamento` : 'sem custo cadastrado')}
      ${biCard('🎯', biFmt(d.ticketMedio), 'Ticket médio')}
      ${biCard('🧮', biNum(d.nTransacoes), 'Vendas + pedidos', `${biNum(d.nVendas)} balcão · ${biNum(d.nPedidos)} delivery`)}
      ${biCard('👥', biNum(d.clientesAtendidos), 'Clientes atendidos')}
      ${biCard('💰', biFmt(d.fiadoRecebido), 'Fiado recebido')}
      ${biCard('📒', biFmt(d.fiadoAbertoTotal), 'Fiado em aberto (total)')}
      ${biCard('✅', biNum(d.entregasConcluidas), 'Entregas concluídas')}
      ${biCard('⏱', d.tempoMedioEntregaMin ? Math.round(d.tempoMedioEntregaMin) + ' min' : '—', 'Tempo médio de entrega')}
      ${biCard('💜', biFmt(d.cashbackCreditado), 'Cashback creditado')}
    </div>
    ${!temCusto ? `<div class="bi-aviso">ℹ️ <b>Custo e lucro</b> aparecem quando os produtos tiverem <b>preço de compra</b> ou <b>ficha técnica</b>. Hoje ${biPct(d.coberturaCusto)} do faturamento tem custo apurado — os valores ficam como “—” até lá (números honestos, sem chute).</div>` : ''}`;
}
async function renderBIfinanceiro() {
  const el = $('bi-financeiro'); el.innerHTML = biLoading();
  let d; try { d = await biGet('financeiro'); } catch { el.innerHTML = biErro(); return; }
  const totFormas = d.formasPagamento.reduce((s, f) => s + f.total, 0) || 1;
  const formasRows = d.formasPagamento.map(f => [crmEsc(f.forma), biFmt(f.total), biPct(f.total / totFormas), biNum(f.n)]);
  const evolBars = d.evolucao.map(e => ({ label: biDiaCurto(e.dia), valor: e.total }));
  const topDev = d.fiado.topDevedores.map(c => [crmEsc(c.nome), crmEsc(c.telefone || '—'), biFmt(c.saldo)]);
  el.innerHTML = `
    <div class="bi-cards bi-cards-4">
      ${biCard('💵', biFmt(d.faturamento), 'Faturamento', `🛒 ${biFmt(d.faturamentoBalcao)} · 🛵 ${biFmt(d.faturamentoDelivery)}`)}
      ${biCard('🎯', biFmt(d.ticketMedio), 'Ticket médio')}
      ${biCard('💰', biFmt(d.fiado.recebido), 'Fiado recebido')}
      ${biCard('📒', biFmt(d.fiado.aberto), 'Fiado em aberto')}
    </div>
    <div class="bi-grid2">
      ${biSecao('💳 Formas de pagamento', biTabela([{ h: 'Forma' }, { h: 'Total', cls: 'num' }, { h: '%', cls: 'num' }, { h: 'Qtde', cls: 'num' }], formasRows))}
      ${biSecao('📅 Faturamento por dia', d.evolucao.length ? biBars(evolBars) : biVazio())}
    </div>
    ${biSecao('📒 Fiado', `
      <div class="bi-fiado-linha">
        <span>Recebido no período: <b class="bi-verde">${biFmt(d.fiado.recebido)}</b></span>
        <span>Lançado no período: <b>${biFmt(d.fiado.lancado)}</b></span>
        <span>Saldo em aberto: <b class="bi-vermelho">${biFmt(d.fiado.aberto)}</b></span>
      </div>
      <div class="bi-sub">Maiores devedores</div>
      ${biTabela([{ h: 'Cliente' }, { h: 'Telefone' }, { h: 'Saldo', cls: 'num' }], topDev, 'Ninguém devendo. 🎉')}`)}
    <div class="bi-export"><button class="bi-btn-export" data-export="financeiro">⬇️ Exportar financeiro (CSV)</button></div>`;
}
async function renderBIprodutos() {
  const el = $('bi-produtos'); el.innerHTML = biLoading();
  let d; try { d = await biGet('produtos'); } catch { el.innerHTML = biErro(); return; }
  const semCusto = d.semCusto > 0 ? `<div class="bi-aviso">ℹ️ ${d.semCusto} de ${d.totalProdutos} produtos estão <b>sem preço de compra</b> — pra eles, lucro e margem aparecem como “—”.</div>` : '';
  const rowVend = d.maisVendidos.map(p => [crmEsc(p.nome), biNum(p.qtd), biFmt(p.faturamento), biPct(p.participacao), `<span class="bi-abc bi-abc-${p.classeABC}">${p.classeABC}</span>`]);
  const rowLucro = d.maisLucro.map(p => [crmEsc(p.nome), biFmt(p.faturamento), biFmt(p.lucro), biPct(p.margem)]);
  const rowMargem = d.maiorMargem.map(p => [crmEsc(p.nome), biPct(p.margem), biFmt(p.lucro)]);
  const rowGiro = d.baixoGiro.map(p => [crmEsc(p.nome), biNum(p.qtd), biFmt(p.faturamento)]);
  el.innerHTML = `
    ${semCusto}
    ${biSecao('🏆 Mais vendidos (quantidade) + Curva ABC', biTabela([{ h: 'Produto' }, { h: 'Qtd', cls: 'num' }, { h: 'Faturamento', cls: 'num' }, { h: '%', cls: 'num' }, { h: 'ABC', cls: 'num' }], rowVend))}
    <div class="bi-grid2">
      ${biSecao('💸 Maior lucro estimado', biTabela([{ h: 'Produto' }, { h: 'Fat.', cls: 'num' }, { h: 'Lucro', cls: 'num' }, { h: 'Margem', cls: 'num' }], rowLucro, 'Sem custo cadastrado ainda.'))}
      ${biSecao('📊 Maior margem estimada', biTabela([{ h: 'Produto' }, { h: 'Margem', cls: 'num' }, { h: 'Lucro', cls: 'num' }], rowMargem, 'Sem custo cadastrado ainda.'))}
    </div>
    ${biSecao('🐌 Baixo giro (menos vendidos)', biTabela([{ h: 'Produto' }, { h: 'Qtd', cls: 'num' }, { h: 'Faturamento', cls: 'num' }], rowGiro))}
    <div class="bi-export"><button class="bi-btn-export" data-export="produtos">⬇️ Exportar produtos (CSV)</button></div>`;
}
async function renderBIclientes() {
  const el = $('bi-clientes'); el.innerHTML = biLoading();
  let d; try { d = await biGet('clientes'); } catch { el.innerHTML = biErro(); return; }
  const rowComp = d.maisCompraram.map(c => [crmEsc(c.nome), biNum(c.compras), biFmt(c.gasto)]);
  const rowGasto = d.maisGastaram.map(c => [crmEsc(c.nome), biFmt(c.gasto), biNum(c.compras)]);
  const rowFiado = d.comFiado.map(c => [crmEsc(c.nome), crmEsc(c.telefone || '—'), biFmt(c.saldo)]);
  const rowNovos = d.novosLista.map(c => [crmEsc(c.nome), crmEsc(c.telefone || '—'), c.criado_em ? biDataHora(c.criado_em) : '—']);
  el.innerHTML = `
    <div class="bi-cards bi-cards-4">
      ${biCard('👥', biNum(d.clientesNoPeriodo), 'Clientes no período')}
      ${biCard('🌱', biNum(d.novos), 'Novos no período')}
      ${biCard('💜', biFmt(d.fidelidade.creditadoPeriodo), 'Cashback creditado')}
      ${biCard('🎁', biFmt(d.fidelidade.resgatadoPeriodo), 'Cashback resgatado')}
    </div>
    <div class="bi-grid2">
      ${biSecao('🔁 Mais compraram', biTabela([{ h: 'Cliente' }, { h: 'Compras', cls: 'num' }, { h: 'Gasto', cls: 'num' }], rowComp))}
      ${biSecao('💸 Mais gastaram', biTabela([{ h: 'Cliente' }, { h: 'Gasto', cls: 'num' }, { h: 'Compras', cls: 'num' }], rowGasto))}
    </div>
    <div class="bi-grid2">
      ${biSecao('📒 Com fiado em aberto', biTabela([{ h: 'Cliente' }, { h: 'Telefone' }, { h: 'Saldo', cls: 'num' }], rowFiado, 'Ninguém devendo. 🎉'))}
      ${biSecao('🆕 Novos clientes', biTabela([{ h: 'Cliente' }, { h: 'Telefone' }, { h: 'Cadastro' }], rowNovos))}
    </div>
    <div class="bi-export"><button class="bi-btn-export" data-export="clientes">⬇️ Exportar clientes (CSV)</button></div>`;
}
async function renderBIdelivery() {
  const el = $('bi-delivery'); el.innerHTML = biLoading();
  let d; try { d = await biGet('delivery'); } catch { el.innerHTML = biErro(); return; }
  const rank = d.rankingEntregadores.map(e => [crmEsc(e.nome), biNum(e.entregas), e.tempoMedio ? Math.round(e.tempoMedio) + ' min' : '—', biFmt(e.faturamento)]);
  const bairros = d.porBairro.map(b => [crmEsc(b.bairro), biNum(b.n), biFmt(b.fat)]);
  const compBars = [{ label: '🛒 Balcão', valor: d.comparativo.balcao.fat }, { label: '🛵 Delivery', valor: d.comparativo.delivery.fat }];
  el.innerHTML = `
    <div class="bi-cards bi-cards-4">
      ${biCard('🛵', biNum(d.pedidos), 'Pedidos delivery', biFmt(d.faturamento))}
      ${biCard('✅', biNum(d.entregues), 'Entregues')}
      ${biCard('✖️', biNum(d.cancelados), 'Cancelados')}
      ${biCard('⏱', d.tempoMedioMin ? Math.round(d.tempoMedioMin) + ' min' : '—', 'Tempo médio', d.emRotaAgora ? `${d.emRotaAgora} em rota agora` : '')}
    </div>
    ${biSecao('🏍️ Ranking de entregadores', biTabela([{ h: 'Entregador' }, { h: 'Entregas', cls: 'num' }, { h: 'Tempo médio', cls: 'num' }, { h: 'Faturamento', cls: 'num' }], rank, 'Nenhuma entrega registrada no período.'))}
    <div class="bi-grid2">
      ${biSecao('⚖️ Balcão × Delivery (faturamento)', biBars(compBars))}
      ${biSecao('📍 Pedidos por bairro', biTabela([{ h: 'Bairro' }, { h: 'Pedidos', cls: 'num' }, { h: 'Faturamento', cls: 'num' }], bairros))}
    </div>`;
}
async function renderBIhorarios() {
  const el = $('bi-horarios'); el.innerHTML = biLoading();
  let d; try { d = await biGet('horarios'); } catch { el.innerHTML = biErro(); return; }
  const horasComMov = d.porHora.filter(h => h.n > 0);
  const horaBars = (horasComMov.length ? horasComMov : []).map(h => ({ label: String(h.hora).padStart(2, '0') + 'h', valor: h.total }));
  const dowBars = d.porDiaSemana.map(w => ({ label: w.nome, valor: w.total }));
  el.innerHTML = `
    <div class="bi-cards bi-cards-3">
      ${biCard('🔥', d.melhorHora != null ? String(d.melhorHora).padStart(2, '0') + 'h' : '—', 'Melhor horário')}
      ${biCard('📆', d.melhorDia || '—', 'Melhor dia da semana')}
      ${biCard('🛵', d.picoDeliveryHora != null ? String(d.picoDeliveryHora).padStart(2, '0') + 'h' : '—', 'Pico do delivery')}
    </div>
    ${biSecao('🕒 Faturamento por hora do dia', horaBars.length ? biBars(horaBars) : biVazio())}
    ${biSecao('📅 Faturamento por dia da semana', biBars(dowBars))}`;
}

const BI_RENDER = { geral: renderBIgeral, financeiro: renderBIfinanceiro, produtos: renderBIprodutos, clientes: renderBIclientes, delivery: renderBIdelivery, horarios: renderBIhorarios };
function abrirBI() {
  const ok = !!(usuarioAtual && (usuarioAtual.perfil === 'admin' || usuarioAtual.perfil === 'supervisor'));
  $('bi-negado').style.display = ok ? 'none' : '';
  $('bi-wrap').style.display = ok ? '' : 'none';
  if (!ok) return;
  biAtualizarLabel();
  (BI_RENDER[biAbaAtual] || renderBIgeral)();
}
function biAtualizarLabel() {
  const nomes = { hoje: 'Hoje', ontem: 'Ontem', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', mes: 'Este mês', mes_passado: 'Mês passado', tudo: 'Todo o período', custom: 'Período personalizado' };
  let txt = nomes[biPeriodo] || biPeriodo;
  if (biPeriodo === 'custom' && (biDe || biAte)) txt += ` (${biDe || '…'} a ${biAte || '…'})`;
  $('bi-periodo-label').textContent = '📅 ' + txt;
}
function biTrocarPeriodo(per) {
  biPeriodo = per;
  document.querySelectorAll('.bi-per').forEach(b => b.classList.toggle('ativo', b.dataset.per === per));
  biAtualizarLabel();
  (BI_RENDER[biAbaAtual] || renderBIgeral)();
}
function biTrocarAba(aba) {
  biAbaAtual = aba;
  document.querySelectorAll('.bi-aba').forEach(b => b.classList.toggle('ativo', b.dataset.biaba === aba));
  document.querySelectorAll('.bi-painel').forEach(p => p.classList.toggle('ativo', p.id === 'bi-' + aba));
  (BI_RENDER[aba] || renderBIgeral)();
}
document.querySelectorAll('.bi-per').forEach(b => b.addEventListener('click', () => biTrocarPeriodo(b.dataset.per)));
document.querySelectorAll('.bi-aba').forEach(b => b.addEventListener('click', () => biTrocarAba(b.dataset.biaba)));
$('bi-aplicar-custom').addEventListener('click', () => {
  biDe = $('bi-de').value; biAte = $('bi-ate').value;
  if (!biDe && !biAte) { toast('⚠ Escolha ao menos uma data'); return; }
  biTrocarPeriodo('custom');
});
$('tela-bi').addEventListener('click', e => {
  const b = e.target.closest('.bi-btn-export'); if (!b) return;
  const a = document.createElement('a'); a.href = `/api/bi/export/${b.dataset.export}.csv?${biQuery()}`; a.download = '';
  document.body.appendChild(a); a.click(); a.remove();
  toast('⬇️ Gerando CSV…');
});

/* ══════════════════════════════════════════════════════════════════════════
   FINANCEIRO / FLUXO DE CAIXA (Fase 25) — o núcleo financeiro. Menu lateral com
   6 telas. Consome /api/financeiro/*. Lançamentos manuais + integração automática
   (PDV/Delivery/Fiado) que o backend já cria. Reaproveita biTabela/biLoading/etc.
   ══════════════════════════════════════════════════════════════════════════ */
let finSecao = 'caixa', finContas = [], finCategorias = [], finCentrosCusto = [];
const finPodeLancar = () => !!(usuarioAtual && (usuarioAtual.perfil === 'admin' || usuarioAtual.perfil === 'supervisor'));
const finPodeAdmin = () => !!(usuarioAtual && usuarioAtual.perfil === 'admin');
const finTipoConta = t => ({ caixa: '💵 Caixa', pix: '⚡ PIX', banco: '🏦 Banco', maquininha: '💳 Maquininha', outro: '📦 Outra' }[t] || t || '—');
const finTipoCat = t => ({ entrada: '⬆️ Entrada', saida: '⬇️ Saída', ambos: '↕️ Ambos' }[t] || t);
const finSitLabel = s => ({ confirmado: '✅ Confirmado', pendente: '⏳ Pendente', estornado: '↩️ Estornado' }[s] || s);
const finOrigemChip = o => `<span class="fin-origem fin-origem-${o || 'manual'}">${({ manual: '✍️ Manual', pdv: '🛒 PDV', delivery: '🛵 Delivery', fiado: '📒 Fiado' }[o] || o || '—')}</span>`;
const finCard = (ico, valor, label, extra = '', cls = '', goto = '') => `<div class="fin-card ${cls}${goto ? ' fin-card-click' : ''}"${goto ? ` data-fin-goto="${goto}" tabindex="0" role="button" title="clique para ver de onde vem"` : ''}><div class="fin-card-top">${ico}</div><div class="fin-card-num">${valor}</div><div class="fin-card-lbl">${label}${goto ? ' <span class="fin-card-ver">🔎</span>' : ''}</div>${extra ? `<div class="fin-card-extra">${extra}</div>` : ''}</div>`;
// clique num card da Visão geral → vai pra fonte da informação (fluxo, contas a pagar, análise…)
function finGoto(v) { if (!v) return; if (v.indexOf(':') >= 0) { finPainelSub = v.split(':')[1]; finIr('painel'); } else { finIr(v); } }
const finGet = async (rota) => (await fetch('/api/financeiro/' + rota, { cache: 'no-store' })).json();
const finOptContas = (sel) => finContas.filter(c => c.ativo).map(c => `<option value="${c.id}" ${c.id == sel ? 'selected' : ''}>${crmEsc(c.nome)}</option>`).join('');
const finOptCategorias = (tipo, sel) => finCategorias.filter(c => c.ativo && (c.tipo === tipo || c.tipo === 'ambos')).map(c => `<option value="${c.id}" ${c.id == sel ? 'selected' : ''}>${crmEsc(c.nome)}</option>`).join('');

function abrirFinanceiro() {
  if (!usuarioAtual) { $('fin-negado').style.display = ''; $('fin-wrap').style.display = 'none'; return; }
  const gestor = finPodeLancar(); // admin/supervisor veem o menu simplificado; operador só o caixa dele
  $('fin-negado').style.display = 'none';
  $('fin-wrap').style.display = '';
  $('fin-menu-principal').style.display = gestor ? '' : 'none';   // 4 itens + Avançado
  $('fin-menu-operador').style.display = gestor ? 'none' : '';    // só fechamento/conciliação
  if (!gestor && !['fechamento', 'conciliacao'].includes(finSecao)) finSecao = 'fechamento';
  finCarregarBase().then(() => finIr(finSecao));
}
async function finCarregarBase() {
  try { const [ct, cat, cc] = await Promise.all([finGet('contas'), finGet('categorias'), finGet('centros-custo')]); finContas = ct || []; finCategorias = cat || []; finCentrosCusto = cc || []; } catch {}
}
const finOptCentros = (sel) => `<option value="">— centro de custo —</option>` + finCentrosCusto.filter(c => c.ativo).map(c => `<option value="${c.id}" ${c.id == sel ? 'selected' : ''}>${crmEsc(c.nome)}</option>`).join('');

/* ── FASE 46 (#6): PAINEL FINANCEIRO — funde Dashboard + Extrato/Fluxo + Análise(Premium)
   numa tela só com sub-abas. Cada sub-aba reaproveita o render existente num host. ── */
let finPainelSub = 'visao';
function renderFinPainel() {
  const el = $('fin-conteudo');
  const tab = (v, t) => `<button class="fin-ptab ${finPainelSub === v ? 'ativo' : ''}" data-psub="${v}">${t}</button>`;
  el.innerHTML = `
    <div class="fin-painel">
      <div class="fin-painel-tabs">
        ${tab('visao', '📊 Visão geral')}${tab('extrato', '🌊 Fluxo de caixa')}${tab('analise', '💎 Análise (DRE)')}
      </div>
      <div id="fin-painel-sub"></div>
    </div>`;
  el.querySelectorAll('.fin-ptab').forEach(b => b.addEventListener('click', () => painelIr(b.dataset.psub)));
  painelIr(finPainelSub);
}
function painelIr(sub) {
  finPainelSub = sub;
  document.querySelectorAll('.fin-ptab').forEach(b => b.classList.toggle('ativo', b.dataset.psub === sub));
  const host = $('fin-painel-sub'); if (!host) return;
  if (sub === 'extrato') renderFinFluxo(host);
  else if (sub === 'analise') renderFinPremium(host);
  else renderFinDashboard(host);
}

/* ── FASE 39: FINANCEIRO PREMIUM — dashboard gerencial consolidado (responsivo) ── */
let finPremPer = 'mes', finPremFiltroAberto = false;
const finPremSinal = (v) => v >= 0 ? 'pos' : 'neg';
async function renderFinPremium(host) {
  const el = host || $('fin-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await finGet('premium?periodo=' + finPremPer); } catch { el.innerHTML = biErro(); return; }
  if (d.erro) { el.innerHTML = biErro(); return; }
  const s = d.saldos, dre = d.dre, ind = d.indicadores, r = d.receber, p = d.pagar, res = d.resultado;
  const per = (v, t) => `<button class="fp-per ${finPremPer === v ? 'ativo' : ''}" data-fp-per="${v}">${t}</button>`;
  const kpi = (ico, val, lbl, cls, extra) => `<div class="fp-kpi ${cls || ''}"><div class="fp-kpi-ico">${ico}</div><div class="fp-kpi-val">${val}</div><div class="fp-kpi-lbl">${lbl}</div>${extra ? `<div class="fp-kpi-ex">${extra}</div>` : ''}</div>`;
  const pct = (v) => v == null ? '—' : v + '%';
  const num = (v) => v == null ? '—' : (typeof v === 'number' ? v.toLocaleString('pt-BR') : v);
  el.innerHTML = `
  <div class="fp-wrap">
    <div class="fp-top">
      <h2 class="fp-title">💎 Financeiro Premium</h2>
      <button class="fp-filtro-btn" id="fp-toggle">🗓️ ${d.periodo.label} ▾</button>
    </div>
    <div class="fp-filtros ${finPremFiltroAberto ? 'aberto' : ''}" id="fp-filtros">
      ${per('hoje', 'Hoje')}${per('7d', '7 dias')}${per('30d', '30 dias')}${per('mes', 'Este mês')}${per('mes_passado', 'Mês passado')}${per('tudo', 'Tudo')}
    </div>
    <div class="fp-kpis">
      ${kpi('💰', fmt(s.total), 'Saldo em caixa', finPremSinal(s.total))}
      ${kpi('📥', fmt(r.total), 'A receber', '', r.vencido > 0 ? `${fmt(r.vencido)} vencido` : 'em dia')}
      ${kpi('📌', fmt(p.total), 'A pagar', '', p.vencido > 0 ? `${fmt(p.vencido)} vencido` : 'em dia')}
      ${kpi('🧭', fmt(ind.posicao_liquida), 'Posição líquida', finPremSinal(ind.posicao_liquida), 'caixa + receber − pagar')}
      ${kpi(dre.resultado >= 0 ? '📈' : '📉', fmt(dre.resultado), 'Resultado do período', finPremSinal(dre.resultado), dre.margem_liquida != null ? `margem ${dre.margem_liquida}%` : '')}
    </div>
    <div class="fp-grid">
      <div class="fp-panel">
        <div class="fp-panel-h">📑 DRE simplificado <span class="fp-per-lbl">${d.periodo.label}</span></div>
        <div class="fp-dre">
          <div class="fp-dre-l"><span>Receita (vendas)</span><b>${fmt(dre.receita_bruta)}</b></div>
          <div class="fp-dre-l neg"><span>(−) Custo dos produtos (CMV)</span><b>${fmt(dre.cmv)}</b></div>
          <div class="fp-dre-l tot"><span>= Lucro bruto</span><b>${fmt(dre.lucro_bruto)}</b><i>${pct(dre.margem_bruta)}</i></div>
          <div class="fp-dre-l neg"><span>(−) Despesas</span><b>${fmt(dre.despesas)}</b></div>
          <div class="fp-dre-l final ${finPremSinal(dre.resultado)}"><span>= Resultado</span><b>${fmt(dre.resultado)}</b><i>${pct(dre.margem_liquida)}</i></div>
        </div>
      </div>
      <div class="fp-panel">
        <div class="fp-panel-h">📊 Indicadores financeiros</div>
        <div class="fp-ind">
          <div class="fp-ind-i"><span class="fp-ind-v">${ind.liquidez_imediata == null ? '—' : ind.liquidez_imediata + 'x'}</span><span class="fp-ind-l">Liquidez imediata</span></div>
          <div class="fp-ind-i"><span class="fp-ind-v ${ind.inadimplencia_pct > 0 ? 'neg' : ''}">${pct(ind.inadimplencia_pct)}</span><span class="fp-ind-l">Inadimplência</span></div>
          <div class="fp-ind-i"><span class="fp-ind-v">${pct(ind.margem_bruta)}</span><span class="fp-ind-l">Margem bruta</span></div>
          <div class="fp-ind-i"><span class="fp-ind-v ${finPremSinal(ind.margem_liquida || 0)}">${pct(ind.margem_liquida)}</span><span class="fp-ind-l">Margem líquida</span></div>
          <div class="fp-ind-i"><span class="fp-ind-v">${ind.cobertura_caixa_dias == null ? '—' : num(ind.cobertura_caixa_dias)}</span><span class="fp-ind-l">Dias de caixa</span></div>
          <div class="fp-ind-i"><span class="fp-ind-v ${finPremSinal(ind.resultado_caixa)}">${fmt(ind.resultado_caixa)}</span><span class="fp-ind-l">Resultado de caixa</span></div>
        </div>
      </div>
      <div class="fp-panel">
        <div class="fp-panel-h">🧩 Consolidação por módulo</div>
        <div class="fp-mods">
          ${d.modulos.map(m => `<button class="fp-mod ${m.alerta ? 'alerta' : ''}" data-fp-goto="${m.chave}"><span class="fp-mod-n">${m.nome}</span><span class="fp-mod-v">${m.valor == null ? '—' : fmt(m.valor)}</span><span class="fp-mod-o">${crmEsc(m.obs || '')}</span></button>`).join('')}
        </div>
      </div>
      <div class="fp-panel">
        <div class="fp-panel-h">🌊 Fluxo (14 dias) &amp; contas</div>
        <div class="fp-serie">${finPremSerie(d.serie_dia)}</div>
        <div class="fp-contas">${s.contas.map(c => `<div class="fp-conta"><span>${crmEsc(c.nome)}</span><b class="${finPremSinal(c.saldo)}">${fmt(c.saldo)}</b></div>`).join('') || '<p class="fin-hint">Sem contas ativas.</p>'}</div>
      </div>
    </div>
    <div class="fp-futuro">🔗 <b>Integrações preparadas:</b> ${Object.entries(d.integracoes_futuras).map(([k, v]) => `<span class="fp-fut-chip ${v.status === 'ativo' ? 'on' : ''}">${({ producao_lotes: '🏭 Produção por Lotes', crm_fidelidade: '🎯 CRM/Fidelidade', bi: '📊 BI' }[k] || k)}: ${v.status}</span>`).join('')}</div>
  </div>`;
  $('fp-toggle').addEventListener('click', () => { finPremFiltroAberto = !finPremFiltroAberto; $('fp-filtros').classList.toggle('aberto', finPremFiltroAberto); });
  el.querySelectorAll('[data-fp-per]').forEach(b => b.addEventListener('click', () => { finPremPer = b.dataset.fpPer; renderFinPremium(host); }));
  el.querySelectorAll('[data-fp-goto]').forEach(b => b.addEventListener('click', () => { const m = { receber: 'receber', contas_pagar: 'contas_pagar', compras: 'compras', custos: null, fluxo: 'fluxo', fechamento: 'fechamento' }[b.dataset.fpGoto]; if (m) finIr(m); else if (b.dataset.fpGoto === 'custos') { irPara('custos'); } }));
}
function finPremSerie(serie) {
  if (!serie || !serie.length) return '<p class="fin-hint">Sem movimento no período.</p>';
  const max = Math.max(1, ...serie.map(x => Math.abs(x.v)));
  return `<div class="fp-bars">${serie.map(x => { const h = Math.round(Math.abs(x.v) / max * 100); return `<div class="fp-bar-wrap" title="${x.k}: ${fmt(x.v)}"><div class="fp-bar ${x.v >= 0 ? 'pos' : 'neg'}" style="height:${Math.max(4, h)}%"></div></div>`; }).join('')}</div>`;
}

/* ── Fase 29: Dashboard, Movimentações, Centro de Custos, Relatórios, Config ── */
/* ── CAIXA DO DIA — a tela simples: ENTROU × SAIU × SALDO de hoje.
   Reaproveita os endpoints do dashboard (sem tocar em API). ── */
const FIN_FORMA_ICO = { PIX: '📱', Dinheiro: '💵', 'Cartão': '💳', 'Cartão Crédito': '💳', 'Cartão Débito': '💳', 'Cartão Alimentação': '🍽', Fiado: '📒' };
async function renderFinCaixaDia() {
  const el = $('fin-conteudo'); el.innerHTML = biLoading();
  let dia, formas, fin;
  try {
    [dia, formas, fin] = await Promise.all([
      fetch('/api/dashboard/resumo-dia', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/dashboard/formas-pagamento', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/dashboard/financeiro', { cache: 'no-store' }).then(r => r.json()),
    ]);
  } catch { el.innerHTML = biErro(); return; }
  const formasArr = Array.isArray(formas) ? formas : [];
  const emDinheiro = formasArr.filter(f => !/fiado/i.test(f.forma));        // dinheiro que ENTROU de fato hoje
  const vendaFiadoHoje = formasArr.filter(f => /fiado/i.test(f.forma)).reduce((s, f) => s + (+f.total || 0), 0);
  const entrouVendas = emDinheiro.reduce((s, f) => s + (+f.total || 0), 0);
  const fiadoRecebido = +fin.fiadoRecebidoHoje || 0;
  const totalEntrou = entrouVendas + fiadoRecebido;
  const saiuCompras = +fin.gastoCompras || 0, saiuInsumos = +fin.gastoInsumos || 0, saiuAcai = +fin.acaiPagoHoje || 0;
  const totalSaiu = saiuCompras + saiuInsumos + saiuAcai;
  const saldo = totalEntrou - totalSaiu;
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const linha = (ico, lbl, val, cls = '') => `<div class="cxd-lin"><span>${ico} ${crmEsc(lbl)}</span><b class="${cls}">${fmt(val)}</b></div>`;
  el.innerHTML = `
    <div class="cxd">
      <div class="cxd-head">
        <div><h2 class="cxd-tit">💰 Caixa do dia</h2><span class="cxd-data">${hoje}</span></div>
        <button class="crm-btn" id="cxd-refresh">🔄 Atualizar</button>
      </div>
      <div class="cxd-saldo ${saldo >= 0 ? 'pos' : 'neg'}">
        <span>Saldo do dia (entrou − saiu)</span>
        <b>${fmt(saldo)}</b>
      </div>
      <div class="cxd-cols">
        <div class="cxd-col entrou">
          <div class="cxd-col-h">⬆️ Entrou hoje <b>${fmt(totalEntrou)}</b></div>
          ${emDinheiro.length ? emDinheiro.map(f => linha(FIN_FORMA_ICO[f.forma] || '💳', f.forma, +f.total || 0)).join('') : '<div class="cxd-vazio">Nenhuma venda ainda hoje.</div>'}
          ${fiadoRecebido > 0 ? linha('📥', 'Fiado recebido', fiadoRecebido) : ''}
        </div>
        <div class="cxd-col saiu">
          <div class="cxd-col-h">⬇️ Saiu hoje <b>${fmt(totalSaiu)}</b></div>
          ${saiuCompras > 0 ? linha('🧾', 'Compras (mercadoria)', saiuCompras) : ''}
          ${saiuInsumos > 0 ? linha('🧴', 'Insumos', saiuInsumos) : ''}
          ${saiuAcai > 0 ? linha('🫐', 'Açaí (latas) pago hoje', saiuAcai) : ''}
          ${totalSaiu === 0 ? '<div class="cxd-vazio">Nenhuma saída hoje.</div>' : ''}
        </div>
      </div>
      <div class="cxd-extra">
        <div class="cxd-mini info"><span>📒 Fiado em aberto (a receber)</span><b>${fmt(+fin.fiadoEmAberto || 0)}</b></div>
        ${(+fin.acaiAPagar || 0) > 0 ? `<button class="cxd-mini" data-cxd-goto="acai"><span>🫐 Açaí a pagar (fornecedores)</span><b>${fmt(+fin.acaiAPagar || 0)}</b></button>` : ''}
        <div class="cxd-mini info"><span>🛒 Vendas do dia (${dia.qtdVendas || 0})</span><b>${fmt(+dia.faturamento || 0)}</b></div>
        ${vendaFiadoHoje > 0 ? `<div class="cxd-mini info"><span>📝 Vendido no fiado hoje</span><b>${fmt(vendaFiadoHoje)}</b></div>` : ''}
      </div>
      <button class="fin-btn-salvar cxd-troco" id="cxd-troco">💵 Deixar troco na gaveta (para o próximo dia)</button>
      <p class="fin-hint">💡 Tudo é calculado automático das vendas, fiado e compras de hoje. Nada é digitado à mão.</p>
    </div>`;
  $('cxd-refresh').addEventListener('click', renderFinCaixaDia);
  $('cxd-troco').addEventListener('click', cxdAbrirTroco);
  el.querySelectorAll('[data-cxd-goto]').forEach(b => b.addEventListener('click', () => finIr(b.dataset.cxdGoto)));
}
// Troco/fundo que fica na gaveta para o próximo dia (entra no caixa esperado daquele dia).
function cxdAbrirTroco(onSaved) {
  const amanha = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  abrirErpModal(`<h3 class="erp-modal-tit">💵 Troco na gaveta</h3>
    <div class="op-ci">
      <p class="fin-hint">Registre o dinheiro que fica na gaveta como troco/fundo do próximo dia. Ele entra no <b>caixa esperado</b> daquele dia (na conferência), sem você digitar de novo.</p>
      <div class="fin-frow"><label>Valor (R$)<input type="number" step="0.01" min="0.01" id="cxd-troco-valor" inputmode="decimal" autocomplete="off"></label>
        <label>Fica para o dia<input type="date" id="cxd-troco-data" value="${amanha}"></label></div>
      <label>Observação<input id="cxd-troco-obs" placeholder="opcional"></label>
      <div class="op-ci-rodape"><span class="op-ci-op">👤 ${crmEsc((usuarioAtual && usuarioAtual.nome) || '—')}</span>
        <button class="fin-btn-salvar" id="cxd-troco-ok">✅ Deixar na gaveta</button></div>
    </div>`);
  setTimeout(() => $('cxd-troco-valor').focus(), 60);
  $('cxd-troco-valor').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('cxd-troco-ok').click(); } });
  $('cxd-troco-ok').addEventListener('click', async () => {
    const valor = parseFloat(($('cxd-troco-valor').value || '').replace(',', '.')) || 0;
    if (valor <= 0) { toast('⚠ Informe um valor maior que zero'); $('cxd-troco-valor').focus(); return; }
    const r = await (await fetch('/api/caixa/troco', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor, data: $('cxd-troco-data').value, obs: $('cxd-troco-obs').value.trim() }) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    toast(`💵 Troco de ${fmt(valor)} guardado para ${acaiDataBR(r.data)}`); fecharErpModal(); (typeof onSaved === 'function' ? onSaved : renderFinCaixaDia)();
  });
}
/* ── CONFERÊNCIA DE CAIXA — compara o ESPERADO (vendas por forma) com o CONTADO (por
   maquininha + pix da conta + dinheiro da gaveta). SÓ confere: não fecha caixa nem move
   dinheiro. Período De→Até (fecha vários dias juntos). Maquininhas editáveis. ── */
let confMaquininhas = [], confEsperado = {}, confMovimentos = null;
let confPeriodo = { de: '', ate: '' };
let confValores = { maq: {}, pixConta: '', dinheiro: '', outros: '' };
const confNum = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const CONF_LINHAS = [['credito', '💳 Crédito'], ['debito', '💳 Débito'], ['pix', '📱 PIX'], ['alimentacao', '🍽️ Alimentação'], ['dinheiro', '💵 Dinheiro']];
function confContado() {
  const c = { credito: 0, debito: 0, pix: 0, alimentacao: 0, dinheiro: 0, outros: 0 };
  for (const m of confMaquininhas) { const v = confValores.maq[m.id] || {}; c.credito += confNum(v.credito); c.debito += confNum(v.debito); c.pix += confNum(v.pix); c.alimentacao += confNum(v.alimentacao); }
  c.pix += confNum(confValores.pixConta); c.dinheiro += confNum(confValores.dinheiro); c.outros += confNum(confValores.outros);
  c.total = c.credito + c.debito + c.pix + c.alimentacao + c.dinheiro + c.outros;
  return c;
}
// forma da conferência → string de forma da venda (pra o esperado voltar a ler certo)
const CONF_FORMA_VENDA = { credito: 'Cartão Crédito', debito: 'Cartão Débito', pix: 'PIX', dinheiro: 'Dinheiro', alimentacao: 'Cartão Alimentação' };
// sobras por forma = dinheiro que entrou a MAIS do que as vendas registradas (candidato a venda não registrada)
function confSobrasPorForma() {
  const e = confEsperado || {}, c = confContado(); const s = {}; let total = 0;
  for (const f of ['credito', 'debito', 'pix', 'dinheiro', 'alimentacao']) { const v = Math.max(0, Math.round(((+c[f] || 0) - (+e[f] || 0)) * 100) / 100); s[f] = v; total += v; }
  s.total = Math.round(total * 100) / 100; return s;
}
function confComparacaoHTML() {
  const e = confEsperado || {}, c = confContado();
  const nadaContado = (c.total || 0) === 0;   // ainda não contou nada → não grita "prejuízo"
  const linha = (k, lbl) => {
    const esp = +e[k] || 0, con = +c[k] || 0, dif = Math.round((con - esp) * 100) / 100;
    const cls = nadaContado ? '' : (dif === 0 ? 'ok' : (dif > 0 ? 'sobra' : 'falta'));
    const ico = nadaContado ? '—' : (dif === 0 ? '✅' : (dif > 0 ? `🔵 +${fmt(dif)}` : `🔴 ${fmt(dif)}`));
    return `<tr class="conf-cmp-${cls}"><td>${lbl}</td><td class="col-num">${fmt(esp)}</td><td class="col-num">${fmt(con)}</td><td class="col-num conf-dif">${ico}</td></tr>`;
  };
  let rows = CONF_LINHAS.map(([k, l]) => linha(k, l)).join('');
  if ((+e.outros || 0) > 0) rows += linha('outros', '❓ Outros (sem forma)');
  const espT = +e.total || 0, conT = c.total, difT = Math.round((conT - espT) * 100) / 100;
  const clsT = nadaContado ? 'neutro' : (difT === 0 ? 'ok' : (difT > 0 ? 'sobra' : 'falta'));
  const sit = nadaContado ? '📝 Conte o dinheiro e as maquininhas e preencha o contado para conferir'
    : (difT === 0 ? '✅ Bateu certinho!' : (difT > 0 ? `🔵 Saldo (sobra) de ${fmt(difT)}` : `🔴 Prejuízo do caixa de ${fmt(Math.abs(difT))}`));
  const det = e.dinheiroDetalhe || {};
  const temMov = (+det.fundo || 0) > 0 || (+det.suprimentos || 0) > 0 || (+det.sangrias || 0) > 0;
  const notaDinheiro = temMov
    ? `<div class="conf-det">💵 Dinheiro esperado = ${(+det.fundo || 0) > 0 ? `troco/fundo ${fmt(det.fundo)} + ` : ''}vendas ${fmt(det.vendas || 0)}${(+det.suprimentos || 0) > 0 ? ` + suprimento ${fmt(det.suprimentos)}` : ''}${(+det.sangrias || 0) > 0 ? ` − sangria ${fmt(det.sangrias)}` : ''} <small>(troco/fundo, suprimento e sangria entram automático)</small></div>`
    : '';
  // se JÁ contou algo e mesmo assim deu diferença, oferece conferir o estoque (achar o que sumiu)
  const btnEstoque = (difT !== 0 && conT > 0) ? '<button class="crm-btn conf-estoque-btn" data-ir-balanco="1">🔍 Deu diferença? Conferir o estoque</button>' : '';
  // 🛒 total das vendas do período (o que gerou o esperado): formas + vendas em dinheiro (SEM o troco/fundo e suprimento)
  const vendasTotal = Math.round(((+e.credito || 0) + (+e.debito || 0) + (+e.pix || 0) + (+e.alimentacao || 0) + (+e.outros || 0) + (+det.vendas || 0)) * 100) / 100;
  const notaVendas = `<div class="conf-vendas-tot"><span>🛒 Total das vendas do período <small>(o que virou dinheiro/cartão)</small></span><strong>${fmt(vendasTotal)}</strong></div>`;
  // 📝 fiado do dia (cliente + fiado rápido) — NÃO entra na conta do caixa; só quando for pago
  const fi = e.fiado || {};
  const notaFiado = (+fi.total > 0) ? `<div class="conf-fiado-info">
      <div class="conf-fiado-tit">📝 Fiado do dia <small>— NÃO entra na conta, só quando for pago</small></div>
      <div class="conf-fiado-linhas">
        ${(+fi.cliente > 0) ? `<span>👤 Fiado de cliente <b>${fmt(fi.cliente)}</b></span>` : ''}
        ${(+fi.rapido > 0) ? `<span>⚡ Fiado rápido (anotado) <b>${fmt(fi.rapido)}</b></span>` : ''}
        <span class="conf-fiado-tot">A receber depois <b>${fmt(fi.total)}</b></span>
      </div>
    </div>` : '';
  return `${notaVendas}${notaFiado}<table class="prod-tabela conf-cmp">
      <thead><tr><th>Forma</th><th class="col-num">Esperado</th><th class="col-num">Contado</th><th class="col-num">Diferença</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="conf-cmp-total conf-cmp-${clsT}"><td>TOTAL</td><td class="col-num">${fmt(espT)}</td><td class="col-num">${fmt(conT)}</td><td class="col-num conf-dif">${nadaContado ? '—' : (difT === 0 ? '✅' : fmt(difT))}</td></tr></tfoot>
    </table>
    ${notaDinheiro}
    <div class="conf-sit conf-cmp-${clsT}">${sit}</div>
    ${btnEstoque}`;
}
// Passo 3 — "quanto deu tudo": total geral contado + quebra por forma (ao vivo)
function confTotalContadoHTML() {
  const c = confContado();
  return `<div class="conf-total-big"><span>🧮 Total contado <small>(tudo que entrou: dinheiro + máquinas + PIX)</small></span><strong>${fmt(c.total)}</strong></div>
    <div class="conf-total-mini">
      <span>💵 Dinheiro <b>${fmt(c.dinheiro)}</b></span>
      <span>💳 Crédito <b>${fmt(c.credito)}</b></span>
      <span>💳 Débito <b>${fmt(c.debito)}</b></span>
      <span>📱 PIX <b>${fmt(c.pix)}</b></span>
      <span>🍽️ Alim. <b>${fmt(c.alimentacao)}</b></span>
    </div>`;
}
function confAtualizarComparacao() {
  const c = $('conf-comparacao'); if (c) c.innerHTML = confComparacaoHTML();
  const t = $('conf-total'); if (t) t.innerHTML = confTotalContadoHTML();
}
async function confBuscarEsperado() {
  const p = new URLSearchParams(); if (confPeriodo.de) p.set('de', confPeriodo.de); if (confPeriodo.ate) p.set('ate', confPeriodo.ate);
  const d = await (await fetch('/api/conferencia/esperado?' + p, { cache: 'no-store' })).json();
  confEsperado = d.esperado || {}; confMovimentos = d.movimentos || null; return d;
}
/* Movimentações do período (fora as vendas): entradas (suprimento/recebimentos) e
   saídas (sangria/despesas) — pra fechar o caixa vendo tudo que entrou e saiu. */
function confMovimentosHTML() {
  const m = confMovimentos || { entradas: [], saidas: [], totalEntradas: 0, totalSaidas: 0 };
  const porData = a => (a || []).slice().sort((x, y) => new Date(x.data) - new Date(y.data));   // sempre em ORDEM DE DATA
  const linha = x => `<tr><td class="conf-mv-hora">${x.data ? fmtDataHora(x.data) : ''}</td><td class="conf-mv-desc">${crmEsc(x.descricao)}</td><td class="col-num">${fmt(x.valor)}</td><td class="conf-mv-fx">${x.podeFluxo
      ? `<button type="button" class="conf-fx-tog ${x.noFluxo ? 'on' : 'off'}" data-fx-id="${x.id}" data-fx-on="${x.noFluxo ? 1 : 0}" title="${x.noFluxo ? 'Já está no fluxo de caixa — clique p/ deixar só na gaveta do dia' : 'Só na gaveta do dia — clique p/ lançar no fluxo de caixa'}">${x.noFluxo ? '💵 no fluxo' : '➕ lançar no fluxo'}</button>`
      : '<span class="conf-fx-na" title="Recebimentos já entram no fluxo normalmente">—</span>'}</td></tr>`;
  const bloco = (titulo, ico, lista, total, cls) => `
    <div class="conf-mv-bloco conf-mv-${cls}">
      <div class="conf-mv-tit">${ico} ${titulo}<span class="conf-mv-tot">${fmt(total)}</span></div>
      ${lista.length ? `<table class="conf-mv-tab"><tbody>${lista.map(linha).join('')}</tbody></table>` : '<div class="conf-mv-vazio">Nenhuma no período</div>'}
    </div>`;
  const saldo = Math.round(((m.totalEntradas || 0) - (m.totalSaidas || 0)) * 100) / 100;
  // contador "aguardando decisão": sangrias/suprimentos que estão só na gaveta (não foram pro fluxo)
  const caixaItens = [...(m.entradas || []), ...(m.saidas || [])].filter(x => x.podeFluxo);
  const soGaveta = caixaItens.filter(x => !x.noFluxo).length, jaFluxo = caixaItens.filter(x => x.noFluxo).length;
  const contador = caixaItens.length ? `<div class="conf-mv-contador">🔔 <b>${soGaveta}</b> do caixa <b>só na gaveta</b> aguardando decisão${jaFluxo ? ` · <span class="fin-pos">${jaFluxo} já no fluxo</span>` : ''} <small>— revise se alguma precisa ir pro fluxo</small></div>` : '';
  return `
    <div class="fin-box-tit">📋 Movimentações do período <small>(fora as vendas — suprimento, sangria, recebimentos e despesas)</small></div>
    ${contador}
    <div class="conf-mv-aviso">💡 Sangrias e suprimentos entram só no <b>caixa do dia</b>. Clique em <b>“➕ lançar no fluxo”</b> pra também mandar pro <b>fluxo de caixa / painel financeiro</b> (vira <b>💵 no fluxo</b>).</div>
    <div class="conf-mv-grid">
      ${bloco('Entradas', '⬆️', porData(m.entradas), m.totalEntradas, 'ent')}
      ${bloco('Saídas / Despesas', '⬇️', porData(m.saidas), m.totalSaidas, 'sai')}
    </div>
    <div class="conf-mv-saldo">Saldo das movimentações: <strong class="${saldo >= 0 ? 'pos' : 'neg'}">${fmt(saldo)}</strong> <small>(entradas − saídas)</small></div>`;
}
// liga os botões "só gaveta ↔ no fluxo" de cada sangria/suprimento no fechamento
function bindConfFluxo() {
  const box = $('conf-movimentos'); if (!box) return;
  box.querySelectorAll('[data-fx-id]').forEach(b => b.addEventListener('click', async () => {
    const id = +b.dataset.fxId, estaNoFluxo = b.dataset.fxOn === '1';
    b.disabled = true;
    let r; try { r = await (await fetch('/api/conferencia/movimento/' + id + '/fluxo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fluxo: !estaNoFluxo }) })).json(); } catch { r = { erro: 'Falha de rede' }; }
    if (!r || r.erro) { toast('⚠ ' + ((r && r.erro) || 'erro')); b.disabled = false; return; }
    const upd = arr => (arr || []).forEach(x => { if (x.id === id) x.noFluxo = !!r.noFluxo; });
    if (confMovimentos) { upd(confMovimentos.entradas); upd(confMovimentos.saidas); }
    const mv = $('conf-movimentos'); if (mv) { mv.innerHTML = confMovimentosHTML(); bindConfFluxo(); }
    toast(r.noFluxo ? '💵 Também no fluxo de caixa' : '🧾 Só na gaveta do dia');
  }));
}
async function renderFinConferencia() {
  const el = $('fin-conteudo'); el.innerHTML = biLoading();
  const hoje = new Date().toISOString().slice(0, 10);
  let d;
  try {
    confMaquininhas = await (await fetch('/api/conferencia/maquininhas', { cache: 'no-store' })).json();
    if (!Array.isArray(confMaquininhas)) confMaquininhas = [];
    if (!confPeriodo.de) confPeriodo = { de: hoje, ate: hoje };
    d = await confBuscarEsperado();
  } catch { el.innerHTML = biErro(); return; }
  const ultima = d.ultima;
  const val = (id, campo) => { const v = (confValores.maq[id] || {})[campo]; return v == null ? '' : v; };
  const maqRows = confMaquininhas.map(m => `
      <tr data-maq="${m.id}">
        <td class="conf-maq-nome"><span class="ac-forn-dot" style="background:${acaiCorFornecedor(m.nome)}"></span>${crmEsc(m.nome)}</td>
        <td><input type="number" step="0.01" class="conf-in" data-maq="${m.id}" data-campo="credito" value="${val(m.id, 'credito')}" placeholder="0,00"></td>
        <td><input type="number" step="0.01" class="conf-in" data-maq="${m.id}" data-campo="debito" value="${val(m.id, 'debito')}" placeholder="0,00"></td>
        <td><input type="number" step="0.01" class="conf-in" data-maq="${m.id}" data-campo="pix" value="${val(m.id, 'pix')}" placeholder="0,00"></td>
        <td><input type="number" step="0.01" class="conf-in" data-maq="${m.id}" data-campo="alimentacao" value="${val(m.id, 'alimentacao')}" placeholder="0,00"></td>
        <td class="conf-maq-acoes"><button class="ac-mini" data-conf-ren="${m.id}" title="Renomear">✎</button><button class="ac-mini del" data-conf-del="${m.id}" title="Remover">🗑</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="ac-vazio">Nenhuma maquininha. Adicione a primeira abaixo.</td></tr>';
  const ultimaTxt = ultima ? `última: ${acaiDataBR(ultima.de)}${ultima.ate && ultima.ate !== ultima.de ? '–' + acaiDataBR(ultima.ate) : ''} · ${fmtDataHora(ultima.criado_em)}` : 'nenhuma conferência salva ainda';
  el.innerHTML = `
    <div class="conf">
      <div class="conf-head"><h2 class="cxd-tit">🧮 Fechamento / Conferência de caixa</h2>
        <span class="conf-sub">Siga a ordem: conte o <b>dinheiro da gaveta</b> (com as entradas e saídas), confira as <b>máquinas</b>, veja o <b>total</b> e <b>compare com as vendas</b>.</span></div>
      <div class="conf-periodo">
        <label>De<input type="date" id="conf-de" value="${confPeriodo.de}"></label>
        <label>Até<input type="date" id="conf-ate" value="${confPeriodo.ate}"></label>
        ${ultima ? '<button class="crm-btn" id="conf-desde">↩️ Desde a última</button>' : ''}
        <span class="conf-ultima">🕒 ${ultimaTxt}</span>
      </div>
      <div class="conf-grid">
        <div class="conf-lado">
          <div class="conf-passo"><span class="conf-passo-n">1</span> 💵 Dinheiro da gaveta</div>
          <div class="conf-fundo">
            <div class="conf-fundo-info"><span>🪙 Troco/fundo da gaveta <small>(deixado com antecedência)</small></span><b id="conf-fundo-val">${fmt((confEsperado.dinheiroDetalhe || {}).fundo || 0)}</b></div>
            <button class="crm-btn" id="conf-troco-btn">➕ Deixar / ajustar troco (adiantar p/ outro dia)</button>
          </div>
          <div class="conf-extra">
            <label class="conf-xrow conf-xrow-forte"><span>💵 Dinheiro contado na gaveta</span><input type="number" step="0.01" id="conf-dinheiro" value="${confValores.dinheiro}" placeholder="0,00"></label>
            <label class="conf-xrow" id="conf-outros-row" style="${(+confEsperado.outros || 0) > 0 ? '' : 'display:none'}"><span>❓ Outros (vendas sem forma)</span><input type="number" step="0.01" id="conf-outros" value="${confValores.outros}" placeholder="0,00"></label>
          </div>
          <div class="conf-movbox" id="conf-movimentos">${confMovimentosHTML()}</div>
        </div>
        <div class="conf-lado">
          <div class="conf-passo"><span class="conf-passo-n">2</span> 💳 Máquinas <small>(crédito · débito · PIX)</small></div>
          <div class="prod-tabela-wrap"><table class="prod-tabela conf-maq">
            <thead><tr><th>Maquininha</th><th>Crédito</th><th>Débito</th><th>PIX</th><th>Alimentação</th><th></th></tr></thead>
            <tbody id="conf-maq-body">${maqRows}</tbody>
          </table></div>
          <button class="crm-btn conf-add" id="conf-add-maq">➕ Adicionar maquininha</button>
          <div class="conf-extra">
            <label class="conf-xrow"><span>📱 PIX da conta (banco)</span><input type="number" step="0.01" id="conf-pixconta" value="${confValores.pixConta}" placeholder="0,00"></label>
          </div>
        </div>
      </div>
      <div class="conf-passo conf-passo-solo"><span class="conf-passo-n">3</span> 🧮 Quanto deu tudo</div>
      <div id="conf-total">${confTotalContadoHTML()}</div>
      <div class="conf-passo conf-passo-solo"><span class="conf-passo-n">4</span> ⚖️ Comparar com as vendas</div>
      <div class="conf-lado conf-final">
        <div id="conf-comparacao">${confComparacaoHTML()}</div>
        <label class="conf-obs-l">Observação<input id="conf-obs" placeholder="opcional"></label>
        <button class="fin-btn-salvar" id="conf-salvar">💾 Salvar fechamento</button>
        <div id="conf-resultado"></div>
      </div>
      <div class="conf-histbox">
        <button class="conf-hist-toggle" id="conf-hist-toggle">📜 Histórico de fechamentos <span class="fin-av-seta">▾</span></button>
        <div id="conf-hist" style="display:none"></div>
      </div>
    </div>`;

  // período → só re-busca o esperado e recomputa (sem recriar os campos de data, p/ não perder o foco)
  const aplicarPeriodo = async () => {
    confPeriodo = { de: $('conf-de').value, ate: $('conf-ate').value };
    try { await confBuscarEsperado(); } catch {}
    const orow = $('conf-outros-row'); if (orow) orow.style.display = (+confEsperado.outros || 0) > 0 ? '' : 'none';
    const mv = $('conf-movimentos'); if (mv) { mv.innerHTML = confMovimentosHTML(); bindConfFluxo(); }  // entradas/saídas do novo período
    const fv = $('conf-fundo-val'); if (fv) fv.textContent = fmt((confEsperado.dinheiroDetalhe || {}).fundo || 0);
    confAtualizarComparacao();
  };
  bindConfFluxo();   // liga os botões "só gaveta ↔ no fluxo" no 1º render
  ['conf-de', 'conf-ate'].forEach(id => $(id).addEventListener('change', aplicarPeriodo));
  { const b = $('conf-desde'); if (b) b.addEventListener('click', () => { $('conf-de').value = (ultima && ultima.de) || hoje; $('conf-ate').value = hoje; aplicarPeriodo(); }); }
  { const b = $('conf-troco-btn'); if (b) b.addEventListener('click', () => cxdAbrirTroco(renderFinConferencia)); }
  { const cc = $('conf-comparacao'); if (cc) cc.addEventListener('click', e => { if (e.target.closest('[data-ir-balanco]')) { balancoVoltarConferencia = true; finIr('balanco'); } }); }
  { const ht = $('conf-hist-toggle'); if (ht) ht.addEventListener('click', () => { const box = $('conf-hist'), fechado = box.style.display === 'none'; box.style.display = fechado ? '' : 'none'; ht.querySelector('.fin-av-seta').textContent = fechado ? '▴' : '▾'; if (fechado) confCarregarHistorico(); }); }

  // contado ao vivo
  el.querySelectorAll('.conf-in').forEach(i => i.addEventListener('input', () => {
    (confValores.maq[i.dataset.maq] = confValores.maq[i.dataset.maq] || {})[i.dataset.campo] = i.value; confAtualizarComparacao();
  }));
  { const p = $('conf-pixconta'); if (p) p.addEventListener('input', () => { confValores.pixConta = p.value; confAtualizarComparacao(); }); }
  { const p = $('conf-dinheiro'); if (p) p.addEventListener('input', () => { confValores.dinheiro = p.value; confAtualizarComparacao(); }); }
  { const p = $('conf-outros'); if (p) p.addEventListener('input', () => { confValores.outros = p.value; confAtualizarComparacao(); }); }

  // maquininhas: adicionar / renomear / remover (só rótulos, não afeta o financeiro)
  $('conf-add-maq').addEventListener('click', async () => {
    const nome = (prompt('Nome da maquininha:') || '').trim(); if (!nome) return;
    const r = await (await fetch('/api/conferencia/maquininhas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome }) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; } toast('✅ Maquininha adicionada'); renderFinConferencia();
  });
  el.querySelectorAll('[data-conf-ren]').forEach(b => b.addEventListener('click', async () => {
    const m = confMaquininhas.find(x => x.id == b.dataset.confRen); const nome = (prompt('Novo nome:', m ? m.nome : '') || '').trim(); if (!nome) return;
    await fetch('/api/conferencia/maquininhas/' + b.dataset.confRen, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome }) });
    toast('✏️ Renomeada'); renderFinConferencia();
  }));
  el.querySelectorAll('[data-conf-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remover esta maquininha da conferência?')) return;
    delete confValores.maq[b.dataset.confDel];
    await fetch('/api/conferencia/maquininhas/' + b.dataset.confDel, { method: 'DELETE' });
    toast('🗑 Removida'); renderFinConferencia();
  }));

  // salvar
  $('conf-salvar').addEventListener('click', async () => {
    const informado = {
      maquininhas: confMaquininhas.map(m => { const v = confValores.maq[m.id] || {}; return { id: m.id, nome: m.nome, credito: confNum(v.credito), debito: confNum(v.debito), pix: confNum(v.pix), alimentacao: confNum(v.alimentacao) }; }),
      pixConta: confNum(confValores.pixConta), dinheiro: confNum(confValores.dinheiro), outros: confNum(confValores.outros),
    };
    const r = await (await fetch('/api/conferencia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ de: confPeriodo.de, ate: confPeriodo.ate, informado, obs: ($('conf-obs') || {}).value || '' }) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    const clsT = r.totalDiferenca === 0 ? 'ok' : (r.totalDiferenca > 0 ? 'sobra' : 'falta');
    // deu diferença ao salvar → CONTINUA a verificação que já existe (conferir o estoque no balanço, e volta pra cá)
    const btnVerif = r.totalDiferenca !== 0 ? '<button class="crm-btn conf-estoque-btn" id="conf-resultado-estoque">🔍 Deu diferença? Conferir o estoque</button>' : '';
    $('conf-resultado').innerHTML = `<div class="conf-saved conf-cmp-${clsT}">${r.totalDiferenca === 0 ? '✅ Bateu certinho e ficou salvo!' : (r.totalDiferenca > 0 ? `🔵 Salvo — sobra de ${fmt(r.totalDiferenca)}` : `🔴 Salvo — prejuízo do caixa de ${fmt(Math.abs(r.totalDiferenca))}`)}</div>${btnVerif}`;
    { const be = $('conf-resultado-estoque'); if (be) be.addEventListener('click', () => { balancoVoltarConferencia = true; finIr('balanco'); }); }
    toast('💾 Conferência salva');
    if ($('conf-hist') && $('conf-hist').style.display !== 'none') confCarregarHistorico();
  });
}
async function confCarregarHistorico() {
  const box = $('conf-hist'); if (!box) return; box.innerHTML = biLoading();
  let d; try { d = await (await fetch('/api/conferencia/historico', { cache: 'no-store' })).json(); } catch { box.innerHTML = biErro(); return; }
  const i = d.insights || {}, lista = d.lista || [];
  const FL = { credito: '💳 Crédito', debito: '💳 Débito', pix: '📱 PIX', dinheiro: '💵 Dinheiro', alimentacao: '🍽️ Alimentação' };
  if (!lista.length) { box.innerHTML = '<div class="ac-vazio" style="padding:14px">Nenhum fechamento salvo ainda. Salve uma conferência pra começar o histórico.</div>'; return; }
  const alerta = i.alerta ? `<div class="conf-hist-alerta">⚠ ${FL[i.alerta.forma]} deu <b>${i.alerta.sentido}</b> em ${i.alerta.n} dos últimos ${i.alerta.de} fechamentos — vale investigar.</div>` : '';
  const pior = i.pior && Math.abs(i.pior.valor) >= 0.01 ? `<div class="conf-hist-kpi"><span>Forma que mais escapa</span><b class="${i.pior.valor < 0 ? 'bal-neg' : 'bal-pos'}">${FL[i.pior.forma]}</b><small>${i.pior.valor < 0 ? 'falta' : 'sobra'} ${fmt(Math.abs(i.pior.valor))} acumulado</small></div>` : '';
  const insightsHTML = `
    <div class="conf-hist-insights">
      <div class="conf-hist-kpi"><span>Fechamentos</span><b>${i.n}</b><small>✅ ${i.bateu} · 🔵 ${i.sobra} sobra · 🔴 ${i.prejuizo} prejuízo</small></div>
      <div class="conf-hist-kpi"><span>Diferença acumulada</span><b class="${i.difAcum < 0 ? 'bal-neg' : (i.difAcum > 0 ? 'bal-pos' : '')}">${fmt(i.difAcum)}</b><small>média ${fmt(i.difMedia)}/fechamento</small></div>
      ${pior}
    </div>${alerta}`;
  const linhas = lista.map(c => {
    const dif = +c.diferenca || 0, cls = Math.abs(dif) < 0.005 ? '' : (dif > 0 ? 'bal-pos' : 'bal-neg');
    const per = c.de === c.ate ? acaiDataBR(c.de) : acaiDataBR(c.de) + '–' + acaiDataBR(c.ate);
    const sit = Math.abs(dif) < 0.005 ? '✅ bateu' : (dif > 0 ? `🔵 +${fmt(dif)}` : `🔴 ${fmt(dif)}`);
    return `<tr class="conf-hist-row" data-conf-id="${c.id}" title="duplo-clique: abrir espelho"><td>${per}</td><td class="col-num">${fmt(c.total_esperado)}</td><td class="col-num">${fmt(c.total_informado)}</td><td class="col-num ${cls}">${sit}</td><td>${crmEsc(nomeOp(c.criado_por))} <small>${fmtDataHora(c.criado_em).slice(-5)}</small></td></tr>`;
  }).join('');
  box.innerHTML = insightsHTML + `<div class="conf-hist-dica">💡 duplo-clique numa linha abre o espelho do fechamento</div><div class="prod-tabela-wrap"><table class="prod-tabela conf-hist-tab"><thead><tr><th>Período</th><th class="col-num">Esperado</th><th class="col-num">Contado</th><th class="col-num">Diferença</th><th>Por</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
  box.querySelectorAll('.conf-hist-row').forEach(tr => tr.addEventListener('dblclick', () => confEspelho(+tr.dataset.confId)));
}
async function confEspelho(id) {
  let d; try { d = await (await fetch('/api/conferencia/' + id, { cache: 'no-store' })).json(); } catch { toast('⚠ Falha ao abrir'); return; }
  if (d.erro) { toast('⚠ ' + d.erro); return; }
  const FL = { credito: '💳 Crédito', debito: '💳 Débito', pix: '📱 PIX', dinheiro: '💵 Dinheiro', alimentacao: '🍽️ Alimentação', outros: '❓ Outros' };
  const per = d.de === d.ate ? acaiDataBR(d.de) : acaiDataBR(d.de) + '–' + acaiDataBR(d.ate);
  const linhaForma = f => { const x = d.porForma[f]; if (!x || (x.esperado === 0 && x.contado === 0)) return ''; const cls = Math.abs(x.diferenca) < 0.005 ? '' : (x.diferenca > 0 ? 'bal-pos' : 'bal-neg'); const t = Math.abs(x.diferenca) < 0.005 ? '✅' : (x.diferenca > 0 ? `🔵 +${fmt(x.diferenca)}` : `🔴 ${fmt(x.diferenca)}`); return `<tr><td>${FL[f]}</td><td class="col-num">${fmt(x.esperado)}</td><td class="col-num">${fmt(x.contado)}</td><td class="col-num ${cls}">${t}</td></tr>`; };
  const formasHTML = ['credito', 'debito', 'pix', 'dinheiro', 'alimentacao', 'outros'].map(linhaForma).join('');
  const maq = (d.maquininhas || []).map(m => `<tr><td>${crmEsc(m.nome || '—')}</td><td class="col-num">${fmt(m.credito || 0)}</td><td class="col-num">${fmt(m.debito || 0)}</td><td class="col-num">${fmt(m.pix || 0)}</td><td class="col-num">${fmt(m.alimentacao || 0)}</td></tr>`).join('');
  const dif = +d.diferenca || 0, clsT = Math.abs(dif) < 0.005 ? 'ok' : (dif > 0 ? 'sobra' : 'falta');
  const sit = Math.abs(dif) < 0.005 ? '✅ Bateu certinho' : (dif > 0 ? `🔵 Saldo (sobra) de ${fmt(dif)}` : `🔴 Prejuízo do caixa de ${fmt(Math.abs(dif))}`);
  abrirErpModal(`<h3 class="erp-modal-tit">🧾 Espelho do fechamento</h3>
    <div class="cesp">
      <div class="cesp-cab">Período <b>${per}</b> · ${fmtDataHora(d.criado_em)} · por <b>${crmEsc(nomeOp(d.criado_por))}</b></div>
      <table class="prod-tabela cesp-tab"><thead><tr><th>Forma</th><th class="col-num">Esperado</th><th class="col-num">Contado</th><th class="col-num">Diferença</th></tr></thead><tbody>${formasHTML}</tbody></table>
      ${maq ? `<div class="cesp-sub">💳 Contado por maquininha</div><table class="prod-tabela cesp-tab"><thead><tr><th>Máquina</th><th class="col-num">Crédito</th><th class="col-num">Débito</th><th class="col-num">PIX</th><th class="col-num">Alim.</th></tr></thead><tbody>${maq}</tbody></table>` : ''}
      <div class="cesp-extra">📱 PIX da conta: <b>${fmt(d.pixConta)}</b> · 💵 Dinheiro na gaveta: <b>${fmt(d.dinheiro)}</b></div>
      <div class="conf-sit conf-cmp-${clsT}">${sit}</div>
      ${d.obs ? `<div class="cesp-obs">📝 ${crmEsc(d.obs)}</div>` : ''}
    </div>`);
}
/* ── BALANÇO DE ESTOQUE — conta o físico de cada produto, o sistema ajusta tudo de uma vez
   (reusa o ajuste auditado) e valora a diferença em SALDO (sobra) ou PREJUÍZO (perda), pelo
   custo. Ligado à Conferência: quando o caixa dá diferença, vem pra cá achar o que sumiu. ── */
let balancoProdutosCache = [], balancoValores = {}, balancoBusca = '', balancoVoltarConferencia = false, balancoMotivo = {};
const balNum = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? null : n; };
function balancoTotais() {
  let sobra = 0, falta = 0, n = 0;
  for (const p of balancoProdutosCache) {
    const f = balNum(balancoValores[p.codigo]); if (f == null) continue;
    const dif = Math.round((f - (+p.estoque || 0)) * 100) / 100; if (Math.abs(dif) < 0.001) continue;
    n++; const val = dif * (+p.custo || 0); if (val > 0) sobra += val; else falta += -val;
  }
  return { sobra: Math.round(sobra * 100) / 100, falta: Math.round(falta * 100) / 100, resultado: Math.round((sobra - falta) * 100) / 100, n };
}
function balancoTotaisHTML() {
  const t = balancoTotais(), cls = t.resultado === 0 ? 'ok' : (t.resultado > 0 ? 'sobra' : 'falta');
  const lbl = t.n === 0 ? 'Conte os produtos e clique em Ajustar' : (t.resultado === 0 ? '✅ Sem valor de diferença' : (t.resultado > 0 ? `🔵 Saldo (sobra) de ${fmt(t.resultado)}` : `🔴 Prejuízo de ${fmt(Math.abs(t.resultado))}`));
  return `<div class="bal-tot conf-cmp-${cls}"><span>${t.n} item(ns) com diferença · sobra ${fmt(t.sobra)} · falta ${fmt(t.falta)}</span><b>${lbl}</b></div>`;
}
function balancoLinhaHTML(p) {
  const f = balancoValores[p.codigo], fv = f == null ? '' : f;
  const fn = balNum(f); const dif = fn == null ? null : Math.round((fn - (+p.estoque || 0)) * 100) / 100;
  const difTxt = dif == null ? '—' : (dif > 0 ? '+' : '') + dif;
  const val = dif == null ? null : Math.round(dif * (+p.custo || 0) * 100) / 100;
  const cls = dif == null || dif === 0 ? '' : (dif > 0 ? 'bal-pos' : 'bal-neg');
  return `<tr data-cod="${crmEsc(p.codigo)}">
      <td class="bal-nome">${crmEsc(p.nome)}</td>
      <td class="col-num">${biNum(p.estoque)} <small>${crmEsc(p.unidade)}</small></td>
      <td><input type="number" step="0.01" class="bal-fis" data-cod="${crmEsc(p.codigo)}" value="${fv}" placeholder="contar"></td>
      <td class="col-num bal-dif ${cls}">${difTxt}</td>
      <td class="col-num bal-val ${cls}">${val == null ? '—' : fmt(val)}</td>
    </tr>`;
}
function balancoTabelaHTML() {
  const bq = balancoBusca.toLowerCase();
  const lista = bq ? balancoProdutosCache.filter(p => (p.nome + ' ' + p.codigo).toLowerCase().includes(bq)) : balancoProdutosCache;
  const rows = lista.map(balancoLinhaHTML).join('') || '<tr><td colspan="5" class="ac-vazio">Nenhum produto.</td></tr>';
  return `<table class="prod-tabela bal-tabela">
      <thead><tr><th>Produto</th><th class="col-num">Sistema</th><th>Físico (contado)</th><th class="col-num">Diferença</th><th class="col-num">Valor (custo)</th></tr></thead>
      <tbody id="bal-body">${rows}</tbody></table>`;
}
function balancoAtualizarLinha(cod) {
  const p = balancoProdutosCache.find(x => x.codigo === cod); if (!p) return;
  const tr = document.querySelector(`.bal-tabela tr[data-cod="${CSS.escape(cod)}"]`); if (!tr) return;
  const fn = balNum(balancoValores[cod]);
  const difCell = tr.querySelector('.bal-dif'), valCell = tr.querySelector('.bal-val');
  if (fn == null) { difCell.textContent = '—'; valCell.textContent = '—'; difCell.className = 'col-num bal-dif'; valCell.className = 'col-num bal-val'; return; }
  const dif = Math.round((fn - (+p.estoque || 0)) * 100) / 100, val = Math.round(dif * (+p.custo || 0) * 100) / 100;
  const cls = dif === 0 ? '' : (dif > 0 ? 'bal-pos' : 'bal-neg');
  difCell.textContent = (dif > 0 ? '+' : '') + dif; difCell.className = 'col-num bal-dif ' + cls;
  valCell.textContent = fmt(val); valCell.className = 'col-num bal-val ' + cls;
  const tot = $('bal-totais'); if (tot) tot.innerHTML = balancoTotaisHTML();
}
async function renderFinBalanco() {
  const el = $('fin-conteudo'); el.innerHTML = biLoading();
  try { balancoProdutosCache = await (await fetch('/api/balanco/produtos', { cache: 'no-store' })).json(); }
  catch { el.innerHTML = biErro(); return; }
  if (!Array.isArray(balancoProdutosCache)) balancoProdutosCache = [];
  el.innerHTML = `
    <div class="bal">
      <div class="conf-head"><h2 class="cxd-tit">📦 Balanço de estoque</h2>
        <span class="conf-sub">Conte o que você tem de verdade e clique em Ajustar. O sistema acerta o estoque em todo o programa e mostra o saldo (sobra) ou o prejuízo (perda), pelo custo.</span></div>
      <div class="bal-bar">
        <input type="search" id="bal-busca" placeholder="🔎 buscar produto…" value="${crmEsc(balancoBusca)}">
        <button class="crm-btn" id="bal-limpar">Limpar contagem</button>
      </div>
      <div class="prod-tabela-wrap" id="bal-tabela-wrap">${balancoTabelaHTML()}</div>
      <div id="bal-totais">${balancoTotaisHTML()}</div>
      <label class="conf-obs-l">Observação<input id="bal-obs" placeholder="opcional — ex.: balanço do dia"></label>
      <button class="fin-btn-salvar" id="bal-ajustar">⚖️ Ajustar e processar</button>
      <div id="bal-resultado"></div>
      <div class="conf-histbox">
        <button class="conf-hist-toggle" id="bal-hist-toggle">📜 Histórico de balanços <span class="fin-av-seta">▾</span></button>
        <div id="bal-hist" style="display:none"></div>
      </div>
    </div>`;
  const wireInputs = () => el.querySelectorAll('.bal-fis').forEach(i => i.addEventListener('input', () => { balancoValores[i.dataset.cod] = i.value; balancoAtualizarLinha(i.dataset.cod); }));
  wireInputs();
  $('bal-busca').addEventListener('input', () => { balancoBusca = $('bal-busca').value; $('bal-tabela-wrap').innerHTML = balancoTabelaHTML(); wireInputs(); });
  $('bal-limpar').addEventListener('click', () => { balancoValores = {}; renderFinBalanco(); });
  { const ht = $('bal-hist-toggle'); if (ht) ht.addEventListener('click', () => { const box = $('bal-hist'), fechado = box.style.display === 'none'; box.style.display = fechado ? '' : 'none'; ht.querySelector('.fin-av-seta').textContent = fechado ? '▴' : '▾'; if (fechado) balancoCarregarHistorico(); }); }
  $('bal-ajustar').addEventListener('click', async () => {
    // se veio da Conferência e há itens que FALTARAM, abre a reconciliação (perda × venda não registrada)
    const contados = balancoProdutosCache.filter(p => balNum(balancoValores[p.codigo]) != null)
      .map(p => ({ p, fisico: balNum(balancoValores[p.codigo]), dif: Math.round((balNum(balancoValores[p.codigo]) - (+p.estoque || 0)) * 100) / 100 }))
      .filter(x => Math.abs(x.dif) >= 0.001);
    if (balancoVoltarConferencia && contados.some(x => x.dif < 0)) { abrirBalancoReconciliacao(contados, contados.filter(x => x.dif < 0)); return; }
    const itens = balancoProdutosCache.filter(p => balNum(balancoValores[p.codigo]) != null).map(p => ({ codigo: p.codigo, fisico: balNum(balancoValores[p.codigo]) }));
    if (!itens.length) { toast('⚠ Conte pelo menos um produto'); return; }
    const comDif = itens.filter(it => { const p = balancoProdutosCache.find(x => x.codigo === it.codigo); return Math.abs(it.fisico - (+p.estoque || 0)) >= 0.001; }).length;
    if (!confirm(`Ajustar o estoque de ${comDif} produto(s) com diferença? O estoque será corrigido em todo o sistema.`)) return;
    const r = await (await fetch('/api/balanco', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itens, obs: ($('bal-obs') || {}).value || '' }) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    balancoValores = {};
    // se veio da Conferência (o caixa deu diferença), volta pra lá depois de acertar o estoque
    if (balancoVoltarConferencia) {
      balancoVoltarConferencia = false;
      toast(r.resultado === 0 ? `⚖️ Estoque ajustado (${r.nAjustados})` : (r.resultado > 0 ? `🔵 Ajustado · Saldo de ${fmt(r.resultado)}` : `🔴 Ajustado · Prejuízo de ${fmt(Math.abs(r.resultado))}`));
      finIr('conferencia');
      return;
    }
    const cls = r.resultado === 0 ? 'ok' : (r.resultado > 0 ? 'sobra' : 'falta');
    const lbl = r.resultado === 0 ? '✅ Estoque ajustado — sem diferença de valor' : (r.resultado > 0 ? `🔵 Estoque ajustado · Saldo (sobra) de ${fmt(r.resultado)}` : `🔴 Estoque ajustado · Prejuízo de ${fmt(Math.abs(r.resultado))}`);
    $('bal-resultado').innerHTML = `<div class="conf-saved conf-cmp-${cls}">${lbl}<br><small>${r.nAjustados} produto(s) ajustado(s) · sobra ${fmt(r.valorSobra)} · falta ${fmt(r.valorFalta)}</small></div>`;
    toast(`⚖️ ${r.nAjustados} ajuste(s) processado(s)`);
    balancoValores = {};
    // recarrega os estoques atualizados (mantém o resultado à mostra)
    try { balancoProdutosCache = await (await fetch('/api/balanco/produtos', { cache: 'no-store' })).json(); } catch {}
    $('bal-tabela-wrap').innerHTML = balancoTabelaHTML(); wireInputs(); $('bal-totais').innerHTML = balancoTotaisHTML();
  });
}
/* Reconciliação: os itens que faltaram viram PERDA (prejuízo de mercadoria) ou VENDA não
   registrada (registra a venda pelo preço cadastrado, dividida nas SOBRAS por forma da
   conferência → dá baixa e entra o dinheiro onde ele realmente apareceu). O que não casar
   fica como diferença/prejuízo do caixa na própria conferência. */
function abrirBalancoReconciliacao(contados, faltantes) {
  const sob = confSobrasPorForma();
  const sobTxt = sob.total > 0
    ? ['credito', 'debito', 'pix', 'dinheiro', 'alimentacao'].filter(f => sob[f] > 0).map(f => `${CONF_FORMA_VENDA[f]} ${fmt(sob[f])}`).join(' · ')
    : 'nenhuma — o caixa não teve dinheiro a mais que as vendas';
  faltantes.forEach(x => { if (!balancoMotivo[x.p.codigo]) balancoMotivo[x.p.codigo] = 'perda'; });   // default: perda (não inventa venda)
  const linhas = faltantes.map(x => {
    const qt = Math.abs(x.dif), val = Math.round(qt * (+x.p.venda || 0) * 100) / 100, mot = balancoMotivo[x.p.codigo] || 'perda';
    return `<div class="brc-item">
        <div class="brc-info"><b>${crmEsc(x.p.nome)}</b><small>faltou ${biNum(qt)} ${crmEsc(x.p.unidade)} · venda ${fmt(val)}</small></div>
        <div class="brc-toggle">
          <button type="button" class="brc-opt ${mot === 'perda' ? 'on' : ''}" data-mot="perda" data-cod="${crmEsc(x.p.codigo)}">🗑️ Perda</button>
          <button type="button" class="brc-opt ${mot === 'venda' ? 'on' : ''}" data-mot="venda" data-cod="${crmEsc(x.p.codigo)}">🛒 Venda</button>
        </div></div>`;
  }).join('');
  abrirErpModal(`<h3 class="erp-modal-tit">🔎 Itens que faltaram — o que aconteceu?</h3>
    <div class="brc">
      <div class="brc-sob">💰 Dinheiro que entrou sem venda registrada: <b>${sobTxt}</b></div>
      <div class="brc-lista">${linhas}</div>
      <div class="brc-resumo" id="brc-resumo"></div>
      <div class="op-ci-rodape"><span class="op-ci-op">🗑️ Perda = prejuízo · 🛒 Venda = registra a venda pelas sobras</span>
        <button class="fin-btn-salvar" id="brc-ok">✅ Processar</button></div>
    </div>`);
  const atualizarResumo = () => {
    const V = Math.round(faltantes.filter(x => balancoMotivo[x.p.codigo] === 'venda').reduce((s, x) => s + Math.abs(x.dif) * (+x.p.venda || 0), 0) * 100) / 100;
    const aviso = V > sob.total ? ` <span class="brc-aviso">⚠ venda (${fmt(V)}) maior que o que sobrou (${fmt(sob.total)}) — o resto vira prejuízo do caixa</span>` : '';
    $('brc-resumo').innerHTML = V > 0 ? `Venda a registrar: <b>${fmt(V)}</b>, dividida nas sobras.${aviso}` : 'Nenhum item marcado como venda — tudo vira perda.';
  };
  atualizarResumo();
  document.querySelectorAll('.brc-opt').forEach(b => b.addEventListener('click', () => {
    balancoMotivo[b.dataset.cod] = b.dataset.mot;
    document.querySelectorAll(`.brc-opt[data-cod="${CSS.escape(b.dataset.cod)}"]`).forEach(x => x.classList.toggle('on', x.dataset.mot === b.dataset.mot));
    atualizarResumo();
  }));
  $('brc-ok').addEventListener('click', () => { fecharErpModal(); balancoExecutarReconciliacao(contados, faltantes); });
}
async function balancoExecutarReconciliacao(contados, faltantes) {
  // REFAZ a diferença com o estoque ATUAL do servidor (a contagem pode ter sido feita contra um
  // estoque já defasado — outras vendas no meio; sem isso a "venda" reduziria a quantidade errada).
  try {
    const fresh = await (await fetch('/api/balanco/produtos', { cache: 'no-store' })).json();
    const mapa = {}; (Array.isArray(fresh) ? fresh : []).forEach(p => { mapa[p.codigo] = p; });
    contados.forEach(x => { const f = mapa[x.p.codigo]; if (f) { x.p = f; x.dif = Math.round((x.fisico - (+f.estoque || 0)) * 100) / 100; } });
  } catch {}
  // só é "venda" o que REALMENTE faltou (dif<0) agora E foi marcado como venda
  const vendaItens = contados.filter(x => x.dif < 0 && balancoMotivo[x.p.codigo] === 'venda');
  const ajusteItens = contados.filter(x => !(x.dif < 0 && balancoMotivo[x.p.codigo] === 'venda'));   // perdas + sobras de estoque
  let vendaMsg = '';
  if (vendaItens.length) {
    const V = Math.round(vendaItens.reduce((s, x) => s + Math.abs(x.dif) * (+x.p.venda || 0), 0) * 100) / 100;
    if (V > 0) {
      const sob = confSobrasPorForma(); let pagamentos = [];
      if (sob.total > 0) {
        const formas = ['credito', 'debito', 'pix', 'dinheiro', 'alimentacao'].filter(f => sob[f] > 0); let acc = 0;
        formas.forEach((f, i) => { const val = i === formas.length - 1 ? Math.round((V - acc) * 100) / 100 : Math.round(V * sob[f] / sob.total * 100) / 100; acc += val; if (val > 0) pagamentos.push({ forma: CONF_FORMA_VENDA[f], valor: val }); });
      } else { pagamentos = [{ forma: 'Dinheiro', valor: V }]; }
      const itensVenda = vendaItens.map(x => ({ codigo: x.p.codigo, nome: x.p.nome, qtd: Math.abs(x.dif), preco: +x.p.venda || 0, subtotal: Math.round(Math.abs(x.dif) * (+x.p.venda || 0) * 100) / 100 }));
      const rv = await (await fetch('/api/vendas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itens: itensVenda, pagamentos, total: V, subtotal: V, origem: 'conferencia', status: 'concluida' }) })).json();
      if (rv && rv.erro) { toast('⚠ ' + rv.erro); return; }
      vendaMsg = `🛒 Venda de ${fmt(V)} registrada`;
    }
  }
  let ajusteRes = null;
  if (ajusteItens.length) {
    const itens = ajusteItens.map(x => ({ codigo: x.p.codigo, fisico: x.fisico }));
    ajusteRes = await (await fetch('/api/balanco', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itens, obs: ($('bal-obs') || {}).value || 'reconciliação da conferência' }) })).json();
  }
  balancoValores = {}; balancoMotivo = {};
  const parts = [];
  if (vendaMsg) parts.push(vendaMsg);
  if (ajusteRes && ajusteRes.resultado < 0) parts.push(`🔴 Perda ${fmt(Math.abs(ajusteRes.resultado))}`);
  else if (ajusteRes && ajusteRes.resultado > 0) parts.push(`🔵 Saldo ${fmt(ajusteRes.resultado)}`);
  toast(parts.join(' · ') || '⚖️ Processado');
  if (balancoVoltarConferencia) { balancoVoltarConferencia = false; finIr('conferencia'); } else { renderFinBalanco(); }
}
async function balancoCarregarHistorico() {
  const box = $('bal-hist'); if (!box) return; box.innerHTML = biLoading();
  let d; try { d = await (await fetch('/api/balanco/historico', { cache: 'no-store' })).json(); } catch { box.innerHTML = biErro(); return; }
  const i = d.insights || {}, lista = d.lista || [];
  if (!lista.length) { box.innerHTML = '<div class="ac-vazio" style="padding:14px">Nenhum balanço salvo ainda.</div>'; return; }
  const pior = i.pior ? `<div class="conf-hist-kpi"><span>Produto que mais dá perda</span><b class="bal-neg">${crmEsc(i.pior.nome)}</b><small>perda ${fmt(i.pior.perda)} em ${i.pior.n} balanço(s)</small></div>` : '';
  const insightsHTML = `<div class="conf-hist-insights">
      <div class="conf-hist-kpi"><span>Balanços</span><b>${i.n}</b></div>
      <div class="conf-hist-kpi"><span>Prejuízo acumulado</span><b class="bal-neg">${fmt(i.totalPrejuizo)}</b></div>
      <div class="conf-hist-kpi"><span>Saldo acumulado</span><b class="bal-pos">${fmt(i.totalSaldo)}</b></div>
      ${pior}</div>`;
  const linhas = lista.map(c => {
    const r = +c.resultado || 0, cls = Math.abs(r) < 0.005 ? '' : (r > 0 ? 'bal-pos' : 'bal-neg');
    const sit = Math.abs(r) < 0.005 ? '✅ sem dif.' : (r > 0 ? `🔵 +${fmt(r)}` : `🔴 ${fmt(r)}`);
    return `<tr class="conf-hist-row" data-bal-id="${c.id}" title="duplo-clique: abrir espelho"><td>${acaiDataBR(c.data)}</td><td class="col-num">${c.n_ajustados}</td><td class="col-num ${cls}">${sit}</td><td>${crmEsc(nomeOp(c.criado_por))} <small>${fmtDataHora(c.criado_em).slice(-5)}</small></td></tr>`;
  }).join('');
  box.innerHTML = insightsHTML + '<div class="conf-hist-dica">💡 duplo-clique numa linha abre o espelho do balanço</div>' + `<div class="prod-tabela-wrap"><table class="prod-tabela conf-hist-tab"><thead><tr><th>Data</th><th class="col-num">Ajustados</th><th class="col-num">Resultado</th><th>Por</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
  box.querySelectorAll('.conf-hist-row').forEach(tr => tr.addEventListener('dblclick', () => balancoEspelho(+tr.dataset.balId)));
}
async function balancoEspelho(id) {
  let d; try { d = await (await fetch('/api/balanco/' + id, { cache: 'no-store' })).json(); } catch { toast('⚠ Falha ao abrir'); return; }
  if (d.erro) { toast('⚠ ' + d.erro); return; }
  const linhas = (d.itens || []).map(it => { const v = +it.valor || 0, cls = v < 0 ? 'bal-neg' : (v > 0 ? 'bal-pos' : ''); return `<tr><td>${crmEsc(it.nome)}</td><td class="col-num">${biNum(it.estoque_sistema)}</td><td class="col-num">${biNum(it.fisico)}</td><td class="col-num ${it.dif < 0 ? 'bal-neg' : 'bal-pos'}">${it.dif > 0 ? '+' : ''}${it.dif}</td><td class="col-num ${cls}">${fmt(v)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="ac-vazio">Sem itens.</td></tr>';
  const r = +d.resultado || 0, clsT = Math.abs(r) < 0.005 ? 'ok' : (r > 0 ? 'sobra' : 'falta');
  const sit = Math.abs(r) < 0.005 ? '✅ Sem diferença' : (r > 0 ? `🔵 Saldo (sobra) de ${fmt(r)}` : `🔴 Prejuízo de ${fmt(Math.abs(r))}`);
  abrirErpModal(`<h3 class="erp-modal-tit">🧾 Espelho do balanço</h3>
    <div class="cesp">
      <div class="cesp-cab">${acaiDataBR(d.data)} · ${fmtDataHora(d.criado_em)} · por <b>${crmEsc(nomeOp(d.criado_por))}</b> · ${d.n_ajustados} ajuste(s)</div>
      <table class="prod-tabela cesp-tab"><thead><tr><th>Produto</th><th class="col-num">Sistema</th><th class="col-num">Físico</th><th class="col-num">Dif.</th><th class="col-num">Valor</th></tr></thead><tbody>${linhas}</tbody></table>
      <div class="conf-sit conf-cmp-${clsT}">${sit}</div>
      ${d.obs ? `<div class="cesp-obs">📝 ${crmEsc(d.obs)}</div>` : ''}
    </div>`);
}
/* ── COMPRA DE AÇAÍ (latas) — registra compra a prazo e marca o pagamento em outra data. ── */
// padrão: mostra só PENDENTES (ao pagar, some da lista; pagas aparecem só quando filtrar).
const ACAI_FILTRO_PADRAO = { fornecedor: '', status: 'pendente', de: '', ate: '', campo: 'compra' };
let acaiFiltro = { ...ACAI_FILTRO_PADRAO };
const acaiDataBR = s => { if (!s) return '—'; const p = String(s).slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };
// cor fixa por fornecedor (hash do nome → matiz) pra separar visualmente
function acaiCorFornecedor(nome) {
  const s = (nome || '').trim().toLowerCase();
  if (!s) return '#8a7f9c';
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}, 60%, 60%)`;
}
let acaiListaCache = [];   // pra o pagamento em lote achar as compras selecionadas
const acaiQS = () => { const p = new URLSearchParams(); Object.entries(acaiFiltro).forEach(([k, v]) => { if (v) p.set(k, v); }); return p.toString() ? '?' + p : ''; };
const acaiResumoHTML = (r) => `
  <div class="acai-kpi"><span>🫐 Comprado</span><b>${fmt(r.totComprado || 0)}</b><small>${biNum(r.totLatas || 0)} latas · ${r.n || 0} compras</small></div>
  <div class="acai-kpi pago"><span>✅ Pago</span><b>${fmt(r.totPago || 0)}</b></div>
  <div class="acai-kpi deve"><span>⏳ A pagar</span><b>${fmt(r.aPagar || 0)}</b></div>`;
const acaiLinhasHTML = (lista) => lista.map(c => {
  const cor = acaiCorFornecedor(c.fornecedor);
  return `
    <tr class="${c.pago ? 'ac-pago' : 'ac-pendente'}" style="--forn-cor:${cor}">
      <td class="ac-sel">${c.pago ? '' : `<input type="checkbox" class="ac-check" data-ac-check="${c.id}">`}</td>
      <td>${acaiDataBR(c.data_compra)}</td>
      <td><span class="ac-forn"><span class="ac-forn-dot" style="background:${cor}"></span>${crmEsc(c.fornecedor || '—')}</span>${c.obs ? `<small class="ac-obs-l" title="${crmEsc(c.obs)}">📝 ${crmEsc(c.obs)}</small>` : ''}</td>
      <td class="col-num">${biNum(c.quantidade)}</td>
      <td class="col-num">${fmt(c.preco_unitario)}</td>
      <td class="col-num"><b>${fmt(c.total)}</b></td>
      <td>${c.pago
        ? `<span class="ac-st ok">✅ Pago em ${acaiDataBR(c.data_pagamento)}${c.forma_pagamento ? ' · ' + crmEsc(c.forma_pagamento) : ''}</span>`
        : `<span class="ac-st pend">⏳ Pendente</span>`}</td>
      <td class="ac-acoes">
        ${c.pago ? `<button class="ac-mini" data-ac-estornar="${c.id}" title="Desfazer pagamento">↩️</button>` : `<button class="ac-mini pagar" data-ac-pagar="${c.id}">💵 Pagar</button>`}
        <button class="ac-mini del" data-ac-del="${c.id}" title="Excluir">🗑</button>
      </td>
    </tr>`; }).join('') || '<tr><td colspan="8" class="ac-vazio">Nenhuma compra no filtro. Registre a primeira acima.</td></tr>';
async function renderFinAcai() {
  const el = $('fin-conteudo'); el.innerHTML = biLoading();
  let d;
  try {
    const resp = await fetch('/api/compras-acai' + acaiQS(), { cache: 'no-store' });
    if (resp.status === 404) { el.innerHTML = '<div class="ds-vazio">🫐 Este controle é novo — <b>reinicie o servidor</b> (feche e abra o <code>node server.js</code>) pra criar a tabela. Depois é só recarregar.</div>'; return; }
    d = await resp.json();
  } catch { el.innerHTML = biErro(); return; }
  const r = d.resumo || {}, hoje = new Date().toISOString().slice(0, 10);
  acaiListaCache = d.lista || [];
  const optForn = (d.fornecedores || []).map(f => `<option value="${crmEsc(f)}">`).join('');
  const temPendentes = acaiListaCache.some(c => !c.pago);

  el.innerHTML = `
    <div class="acai">
      <div class="acai-resumo" id="acai-resumo">${acaiResumoHTML(r)}</div>
      <form class="acai-form" id="acai-form">
        <div class="acai-frow">
          <label>Fornecedor<input id="ac-forn" list="ac-forn-list" autocomplete="off" placeholder="ex.: Fazenda, Outros"><datalist id="ac-forn-list">${optForn}</datalist></label>
          <label>Data da compra<input type="date" id="ac-data" value="${hoje}"></label>
          <label>Latas<input type="number" id="ac-qtd" step="1" min="0" placeholder="0"></label>
          <label>Preço/lata<input type="number" id="ac-preco" step="0.01" min="0" placeholder="0,00"></label>
          <label>Total<input id="ac-total" readonly placeholder="R$ 0,00"></label>
          <button type="submit" class="fin-btn-salvar">➕ Registrar</button>
        </div>
        <input id="ac-obs" class="acai-obs" placeholder="Observação (opcional)">
      </form>
      <div class="acai-filtros">
        <select id="ac-f-forn"><option value="">Todos fornecedores</option>${(d.fornecedores || []).map(f => `<option value="${crmEsc(f)}" ${acaiFiltro.fornecedor === f ? 'selected' : ''}>${crmEsc(f)}</option>`).join('')}</select>
        <select id="ac-f-status"><option value="pendente" ${acaiFiltro.status === 'pendente' ? 'selected' : ''}>⏳ Pendentes</option><option value="pago" ${acaiFiltro.status === 'pago' ? 'selected' : ''}>✅ Pagas</option><option value="" ${acaiFiltro.status === '' ? 'selected' : ''}>Todas</option></select>
        <select id="ac-f-campo" title="A data De/Até filtra por qual coluna"><option value="compra" ${acaiFiltro.campo === 'compra' ? 'selected' : ''}>📅 por data da compra</option><option value="pagamento" ${acaiFiltro.campo === 'pagamento' ? 'selected' : ''}>💵 por data do pagamento</option></select>
        <label class="acai-flabel">De<input type="date" id="ac-f-de" value="${acaiFiltro.de}"></label>
        <label class="acai-flabel">Até<input type="date" id="ac-f-ate" value="${acaiFiltro.ate}"></label>
        <button class="crm-btn" id="ac-f-limpar">Limpar</button>
      </div>
      <div class="acai-lote" id="ac-lote" style="display:none">
        <span id="ac-lote-info">0 selecionadas</span>
        <button class="fin-btn-salvar" id="ac-lote-pagar">💵 Pagar selecionadas</button>
      </div>
      <div class="prod-tabela-wrap">
        <table class="prod-tabela acai-tabela">
          <thead><tr><th class="ac-sel" id="ac-th-sel">${temPendentes ? '<input type="checkbox" id="ac-check-all" title="Selecionar todas as pendentes">' : ''}</th><th>Data compra</th><th>Fornecedor</th><th>Latas</th><th>Preço/lata</th><th>Total</th><th>Situação</th><th></th></tr></thead>
          <tbody id="ac-tbody">${acaiLinhasHTML(acaiListaCache)}</tbody>
        </table>
      </div>
    </div>`;

  // total automático
  const calcTotal = () => { const q = +$('ac-qtd').value || 0, p = +$('ac-preco').value || 0; $('ac-total').value = (q > 0 && p > 0) ? fmt(q * p) : ''; };
  ['ac-qtd', 'ac-preco'].forEach(id => $(id).addEventListener('input', calcTotal));
  $('acai-form').addEventListener('submit', async e => {
    e.preventDefault();
    const qtd = +$('ac-qtd').value || 0;
    if (qtd <= 0) { toast('⚠ Informe as latas'); $('ac-qtd').focus(); return; }
    const body = { fornecedor: $('ac-forn').value.trim(), data_compra: $('ac-data').value, quantidade: qtd, preco_unitario: +$('ac-preco').value || 0, obs: $('ac-obs').value.trim() };
    const j = await (await fetch('/api/compras-acai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (j && j.erro) { toast('⚠ ' + j.erro); return; }
    toast(`✅ Compra registrada · ${biNum(qtd)} latas`); renderFinAcai();
  });

  // seleção múltipla (pagar vários no mesmo dia) — consultam o DOM na hora, valem após trocar o corpo
  const checks = () => [...el.querySelectorAll('.ac-check')];
  const selecionados = () => checks().filter(c => c.checked).map(c => +c.dataset.acCheck);
  const atualizarLote = () => {
    const ids = selecionados();
    const total = ids.reduce((s, id) => { const c = acaiListaCache.find(x => x.id === id); return s + (c ? +c.total || 0 : 0); }, 0);
    $('ac-lote').style.display = ids.length ? '' : 'none';
    if (ids.length) $('ac-lote-info').textContent = `${ids.length} selecionada${ids.length > 1 ? 's' : ''} · ${fmt(total)}`;
    const all = $('ac-check-all'); if (all) all.checked = checks().length > 0 && ids.length === checks().length;
  };
  // (re)liga os eventos da tabela — chamado no 1º render e sempre que o corpo é trocado por um filtro
  const bindTabela = () => {
    checks().forEach(c => c.addEventListener('change', atualizarLote));
    { const all = $('ac-check-all'); if (all) all.addEventListener('change', () => { checks().forEach(c => c.checked = all.checked); atualizarLote(); }); }
    el.querySelectorAll('[data-ac-pagar]').forEach(b => b.addEventListener('click', () => acaiAbrirPagamento([+b.dataset.acPagar])));
    el.querySelectorAll('[data-ac-estornar]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Desfazer o pagamento desta compra?')) return; await fetch('/api/compras-acai/' + b.dataset.acEstornar + '/estornar-pagamento', { method: 'POST' }); renderFinAcai(); }));
    el.querySelectorAll('[data-ac-del]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Excluir esta compra do controle?')) return; await fetch('/api/compras-acai/' + b.dataset.acDel, { method: 'DELETE' }); renderFinAcai(); }));
  };
  { const lp = $('ac-lote-pagar'); if (lp) lp.addEventListener('click', () => { const ids = selecionados(); if (ids.length) acaiAbrirPagamento(ids); }); }
  bindTabela();

  // filtros: só recarregam RESUMO + TABELA (sem recriar os campos, pra não perder o foco enquanto digita a data)
  const aplicar = async () => {
    acaiFiltro = { fornecedor: $('ac-f-forn').value, status: $('ac-f-status').value, campo: $('ac-f-campo').value, de: $('ac-f-de').value, ate: $('ac-f-ate').value };
    let dd;
    try { dd = await (await fetch('/api/compras-acai' + acaiQS(), { cache: 'no-store' })).json(); } catch { return; }
    acaiListaCache = dd.lista || [];
    $('acai-resumo').innerHTML = acaiResumoHTML(dd.resumo || {});
    $('ac-th-sel').innerHTML = acaiListaCache.some(c => !c.pago) ? '<input type="checkbox" id="ac-check-all" title="Selecionar todas as pendentes">' : '';
    $('ac-tbody').innerHTML = acaiLinhasHTML(acaiListaCache);
    $('ac-lote').style.display = 'none';
    bindTabela();
  };
  ['ac-f-forn', 'ac-f-status', 'ac-f-campo', 'ac-f-de', 'ac-f-ate'].forEach(id => $(id).addEventListener('change', aplicar));
  $('ac-f-limpar').addEventListener('click', () => { acaiFiltro = { ...ACAI_FILTRO_PADRAO }; renderFinAcai(); });
  setTimeout(() => $('ac-forn').focus(), 60);
}
function acaiAbrirPagamento(ids) {
  ids = Array.isArray(ids) ? ids : [ids];
  const compras = ids.map(id => acaiListaCache.find(c => c.id === id)).filter(Boolean);
  if (!compras.length) return;
  const hoje = new Date().toISOString().slice(0, 10);
  const totalGeral = compras.reduce((s, c) => s + (+c.total || 0), 0);
  const muitas = compras.length > 1;
  // lista das compras que serão pagas — com a OBSERVAÇÃO de cada uma (aparece antes de confirmar)
  const itens = compras.map(c => `
    <div class="acpg-item">
      <span class="acpg-item-top"><span class="ac-forn-dot" style="background:${acaiCorFornecedor(c.fornecedor)}"></span><b>${crmEsc(c.fornecedor || '—')}</b> · ${acaiDataBR(c.data_compra)} · ${biNum(c.quantidade)} latas <span class="acpg-item-val">${fmt(c.total)}</span></span>
      ${c.obs ? `<span class="acpg-obs">📝 ${crmEsc(c.obs)}</span>` : ''}
    </div>`).join('');
  abrirErpModal(`<h3 class="erp-modal-tit">💵 Registrar pagamento${muitas ? ' (' + compras.length + ' compras)' : ' da compra'}</h3>
    <div class="acai-pg">
      <div class="acpg-lista">${itens}</div>
      <div class="acpg-total"><span>Total a pagar</span><b>${fmt(totalGeral)}</b></div>
      <label>Data do pagamento<input type="date" id="acpg-data" value="${hoje}"></label>
      <span class="acpg-lbl">Meio do pagamento <small>(marque uma ou mais)</small></span>
      <div class="acpg-meios" id="acpg-meios">
        ${[['Dinheiro', '💵'], ['PIX', '📱'], ['Cartão', '💳'], ['Banco', '🏦']].map(m => `<button type="button" class="acpg-meio" data-meio="${m[0]}">${m[1]} ${m[0]}</button>`).join('')}
      </div>
      <input id="acpg-forma-outro" class="acpg-outro" placeholder="Outro / detalhe (opcional) — ex.: banco XP, cheque">
      <div class="op-ci-rodape"><span class="op-ci-op">👤 ${crmEsc((usuarioAtual && usuarioAtual.nome) || '—')}</span>
        <button class="fin-btn-salvar" id="acpg-ok">✅ Confirmar pagamento</button></div>
    </div>`);
  document.querySelectorAll('.acpg-meio').forEach(b => b.addEventListener('click', () => b.classList.toggle('on')));
  $('acpg-ok').addEventListener('click', async () => {
    $('acpg-ok').disabled = true;
    // junta as formas marcadas (pode ser mais de uma) + o texto livre
    const meios = [...document.querySelectorAll('.acpg-meio.on')].map(b => b.dataset.meio);
    const outro = ($('acpg-forma-outro').value || '').trim();
    if (outro) meios.push(outro);
    const body = { data_pagamento: $('acpg-data').value || hoje, forma_pagamento: meios.join(' + ') };
    let ok = 0;
    for (const c of compras) {
      const j = await (await fetch('/api/compras-acai/' + c.id + '/pagar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (j && !j.erro) ok++;
    }
    toast(`✅ ${ok} pagamento${ok > 1 ? 's' : ''} registrado${ok > 1 ? 's' : ''}`); fecharErpModal();
    try { await finCarregarBase(); } catch {}   // atualiza os saldos das contas (senão o "Saldo geral" fica velho)
    if ($('tela-financeiro').classList.contains('ativa') && finSecao === 'acai') renderFinAcai();
  });
  setTimeout(() => $('acpg-data').focus(), 60);
}
async function renderFinDashboard(host) {
  const el = host || $('fin-conteudo'); el.innerHTML = biLoading();
  let d, al; try { [d, al] = await Promise.all([finGet('dashboard'), finGet('alertas')]); } catch { el.innerHTML = biErro(); return; }
  const s = d.saldos, p = d.pagar, m = d.mes, cls = (v) => v < 0 ? 'neg' : 'pos';
  el.innerHTML = `
    <div class="fin-cards">
      ${finCard('💰', fmt(s.total), 'Saldo disponível', '', cls(s.total), 'painel:extrato')}
      ${finCard('💵', fmt(s.caixa), 'Em caixa', '', '', 'painel:extrato')}
      ${finCard('🏦', fmt(s.banco), 'Banco / maquininha', '', '', 'painel:extrato')}
      ${finCard('📥', fmt(d.receber.total), 'A receber (fiado)', '', '', 'clientes')}
      ${finCard('📤', fmt(p.total), 'A pagar', p.vencido ? `${fmt(p.vencido)} vencido` : '', p.vencido ? 'neg' : '', 'contas_pagar')}
      ${finCard('📅', fmt(p.hoje), 'Pagar hoje', '', '', 'contas_pagar')}
      ${finCard('🗓️', fmt(p.semana), 'Pagar na semana', '', '', 'contas_pagar')}
      ${finCard(m.lucro >= 0 ? '📈' : '📉', fmt(m.lucro), 'Lucro do mês', m.coberturaCusto ? '' : 'sem custo cadastrado', cls(m.lucro), 'painel:analise')}
    </div>
    <div class="fin-cards bi-cards-4">
      ${finCard('🛒', fmt(m.vendas), 'Vendas do mês', '', '', 'painel:extrato')}
      ${finCard('⬆️', fmt(m.receitas), 'Receitas do mês', '', '', 'painel:extrato')}
      ${finCard('⬇️', fmt(m.despesas), 'Despesas do mês', '', '', 'painel:extrato')}
      ${finCard('🧾', fmt(m.compras), 'Compras do mês', '', '', 'compras')}
    </div>
    ${al && al.total ? finBox('🔔 Alertas', finDashAlertas(al)) : ''}
    <div class="fin-grid2">
      ${finBox('📊 Fluxo diário (14 dias)', d.graficos.diario.length ? biBars(d.graficos.diario.map(x => ({ label: biDiaCurto(x.k), valor: x.v }))) : biVazio())}
      ${finBox('📆 Fluxo mensal', d.graficos.mensal.length ? biBars(d.graficos.mensal.map(x => ({ label: x.k, valor: x.v }))) : biVazio())}
    </div>
    <div class="fin-grid2">
      ${finBox('🏭 Maior fornecedor (mês)', d.maiorFornecedor ? `<div class="fin-dash-linha"><b>${crmEsc(d.maiorFornecedor.nome)}</b><span>${fmt(d.maiorFornecedor.total)}</span></div>` : biVazio('Sem compras no mês.'))}
      ${finBox('👑 Maior cliente (mês)', d.maiorCliente ? `<div class="fin-dash-linha"><b>${crmEsc(d.maiorCliente.nome)}</b><span>${fmt(d.maiorCliente.total)}</span></div>` : biVazio('Sem vendas no mês.'))}
    </div>
    ${finBox('🍧 Produtos mais lucrativos (mês)', d.produtosLucrativos.length ? biTabela([{ h: 'Produto' }, { h: 'Lucro', cls: 'num' }, { h: 'Margem', cls: 'num' }], d.produtosLucrativos.map(x => [crmEsc(x.nome), fmt(x.lucro), x.margem != null ? (x.margem * 100).toFixed(0) + '%' : '—'])) : biVazio('Cadastre o preço de compra dos produtos pra ver o lucro.'))}`;
  el.querySelectorAll('[data-fin-goto]').forEach(c => { const go = () => finGoto(c.dataset.finGoto); c.addEventListener('click', go); c.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }); });
}
function finDashAlertas(al) {
  const it = [];
  if (al.vencidas.length) it.push(`🔴 ${al.vencidas.length} conta(s) vencida(s) — ${fmt(al.vencidas.reduce((s, c) => s + c.valor, 0))}`);
  if (al.venceAmanha.length) it.push(`🟡 ${al.venceAmanha.length} conta(s) vence(m) amanhã`);
  if (al.fluxoNegativo) it.push(`⚠️ Fluxo negativo: saldo ${fmt(al.saldoTotal)}`);
  else if (al.saldoBaixo) it.push(`🟠 Saldo baixo (${fmt(al.saldoTotal)} · limite ${fmt(al.saldoBaixoLim)})`);
  if (al.fornecedoresParados.length) it.push(`💤 ${al.fornecedoresParados.length} fornecedor(es) parado(s) há +45 dias`);
  if (al.comprasAcimaMedia.length) it.push(`📈 ${al.comprasAcimaMedia.length} compra(s) acima da média`);
  if (al.semCategoria) it.push(`🏷️ ${al.semCategoria} movimento(s) sem categoria`);
  return '<div class="fin-alertas">' + it.map(i => `<div class="fin-alerta">${i}</div>`).join('') + '</div>';
}

function renderFinMovimentacoes() {
  const el = $('fin-conteudo');
  el.innerHTML = `
    <div class="fin-filtros">
      <label>De<input type="date" id="mv-de"></label>
      <label>Até<input type="date" id="mv-ate"></label>
      <label>Conta<select id="mv-conta"><option value="">Todas</option>${finContas.map(c => `<option value="${c.id}">${crmEsc(c.nome)}</option>`).join('')}</select></label>
      <label>Categoria<select id="mv-cat"><option value="">Todas</option>${finCategorias.map(c => `<option value="${c.id}">${crmEsc(c.nome)}</option>`).join('')}</select></label>
      <label>Centro<select id="mv-cc"><option value="">Todos</option>${finCentrosCusto.map(c => `<option value="${c.id}">${crmEsc(c.nome)}</option>`).join('')}</select></label>
      <label>Tipo<select id="mv-tipo"><option value="">Ambos</option><option value="entrada">Entradas</option><option value="saida">Saídas</option></select></label>
      <label>Buscar<input id="mv-busca" placeholder="histórico"></label>
      <button class="fin-btn-filtrar" id="mv-filtrar">🔎</button>
    </div>
    <div id="mv-lista">${biLoading()}</div>`;
  $('mv-filtrar').addEventListener('click', finCarregarMovimentacoes);
  finCarregarMovimentacoes();
}
async function finCarregarMovimentacoes() {
  const q = new URLSearchParams(), map = { de: 'mv-de', ate: 'mv-ate', conta_id: 'mv-conta', categoria_id: 'mv-cat', centro_custo_id: 'mv-cc', tipo: 'mv-tipo', busca: 'mv-busca' };
  for (const [k, id] of Object.entries(map)) { const v = $(id) && $(id).value; if (v) q.set(k, v); }
  let d; try { d = await (await fetch('/api/financeiro/movimentacoes?' + q, { cache: 'no-store' })).json(); } catch { $('mv-lista').innerHTML = biErro(); return; }
  const rows = d.linhas.map(m => [fmtDataHora(m.data), finOrigemChip(m.origem), crmEsc(m.descricao || '—'), crmEsc(m.conta_nome || '—'), crmEsc(m.categoria_nome || '—'), crmEsc(m.centro_custo_nome || '—'),
    `<span class="fin-val ${m.tipo}">${m.tipo === 'entrada' ? '+' : '−'}${fmt(m.valor)}</span>`, `<b>${fmt(m.saldo)}</b>`, crmEsc(nomeOp(m.criado_por || m.responsavel))]);
  $('mv-lista').innerHTML = `<div class="fin-fluxo-topo">${d.total} movimentações · saldo final: <b>${fmt(d.saldoFinal)}</b></div>` +
    biTabela([{ h: 'Data' }, { h: 'Origem' }, { h: 'Histórico' }, { h: 'Conta' }, { h: 'Categoria' }, { h: 'Centro' }, { h: 'Valor', cls: 'num' }, { h: 'Saldo', cls: 'num' }, { h: 'Por' }], rows, 'Nenhuma movimentação no filtro.');
}

function renderFinCentroCustos() {
  const el = $('fin-conteudo');
  const rows = finCentrosCusto.map(c => [crmEsc(c.nome), crmEsc(c.tipo || '—'), c.sistema ? '🔒 sistema' : '', c.ativo ? 'Ativo' : 'Inativo', finPodeAdmin() ? finAcoesCentro(c) : '']);
  el.innerHTML = `
    ${finPodeAdmin() ? `<div class="fin-box"><h3 class="fin-box-tit">🎯 Novo centro de custo</h3>
      <form id="fin-form-cc" class="fin-form fin-form-inline"><input id="cc-nome" placeholder="Nome (ex.: Gás)"><select id="cc-tipo"><option value="insumo">Insumo</option><option value="fixo">Fixo</option><option value="variavel">Variável</option><option value="outro" selected>Outro</option></select><button type="submit" class="fin-btn-salvar">➕ Adicionar</button></form></div>` : ''}
    <div class="fin-box"><h3 class="fin-box-tit">Centros de custo (${finCentrosCusto.length})</h3>${biTabela([{ h: 'Centro' }, { h: 'Tipo' }, { h: '' }, { h: 'Situação' }, { h: '' }], rows)}</div>`;
  const f = $('fin-form-cc'); if (f) f.addEventListener('submit', finSalvarCentro);
}
function finAcoesCentro(c) {
  let b = `<button class="fin-mini" data-fin-acao="cc-ativo" data-id="${c.id}" data-ativo="${c.ativo ? 0 : 1}">${c.ativo ? '🚫' : '✅'}</button>`;
  if (!c.sistema) b += `<button class="fin-mini" data-fin-acao="cc-excluir" data-id="${c.id}">🗑</button>`;
  return b;
}
async function finSalvarCentro(e) {
  e.preventDefault();
  const nome = $('cc-nome').value.trim(); if (!nome) { toast('⚠ Informe o nome'); return; }
  const r = await (await fetch('/api/financeiro/centros-custo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, tipo: $('cc-tipo').value }) })).json();
  if (r.erro) { toast('⚠ ' + r.erro); return; }
  toast('🎯 Centro de custo criado'); await finCarregarBase(); renderFinCentroCustos();
}

function renderFinRelatorios() {
  const el = $('fin-conteudo');
  const tipos = [['fluxo', '🌊 Fluxo de caixa'], ['despesas', '⬇️ Despesas por categoria'], ['receitas', '⬆️ Receitas por categoria'], ['centro-custos', '🎯 Despesas por centro'], ['fornecedores', '🏭 Compras por fornecedor'], ['contas-pagas', '✅ Contas pagas'], ['contas-vencidas', '🔴 Contas vencidas']];
  el.innerHTML = `
    <div class="fin-filtros">
      <label>Relatório<select id="rel-tipo">${tipos.map(t => `<option value="${t[0]}">${t[1]}</option>`).join('')}</select></label>
      <label>Período<select id="rel-periodo"><option value="mes">Este mês</option><option value="mes_passado">Mês passado</option><option value="30d">30 dias</option><option value="tudo">Tudo</option></select></label>
      <button class="fin-btn-filtrar" id="rel-gerar">📊 Gerar</button>
      <span class="crm-flex"></span>
      <button class="crm-btn" id="rel-csv">⬇️ Excel/CSV</button>
      <button class="crm-btn" id="rel-pdf">🖨️ PDF</button>
    </div>
    <div id="rel-lista" class="fin-box">${biVazio('Escolha um relatório e clique em Gerar.')}</div>`;
  $('rel-gerar').addEventListener('click', finGerarRelatorio);
  $('rel-csv').addEventListener('click', () => { const a = document.createElement('a'); a.href = `/api/financeiro/relatorios/${$('rel-tipo').value}?periodo=${$('rel-periodo').value}&csv=1`; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); toast('⬇️ Gerando CSV…'); });
  $('rel-pdf').addEventListener('click', () => window.print());
  finGerarRelatorio();
}
async function finGerarRelatorio() {
  const tipo = $('rel-tipo').value, per = $('rel-periodo').value;
  let d; try { d = await (await fetch(`/api/financeiro/relatorios/${tipo}?periodo=${per}`, { cache: 'no-store' })).json(); } catch { $('rel-lista').innerHTML = biErro(); return; }
  const cols = d.colunas.map((c, i) => ({ h: c, cls: i > 0 ? 'num' : '' }));
  const rows = d.linhas.map(l => l.map(v => crmEsc(String(v))));
  $('rel-lista').innerHTML = `<h3 class="fin-box-tit">${d.titulo}</h3>${biTabela(cols, rows, 'Sem dados no período.')}`;
}

async function renderFinConfig() {
  const el = $('fin-conteudo');
  let cfg; try { cfg = await finGet('config'); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeAdmin();
  el.innerHTML = `<div class="fin-box" style="max-width:560px"><h3 class="fin-box-tit">⚙️ Configurações financeiras</h3>
    <form id="fin-cfg-form" class="fin-form">
      <label>Alerta de saldo baixo (R$)<input type="number" step="0.01" id="cfg-saldo-baixo" value="${cfg.saldo_baixo}"></label>
      <label>Conta padrão do cartão (maquininha)<select id="cfg-conta-cartao">${finContas.map(c => `<option value="${c.id}" ${c.id == cfg.conta_cartao_id ? 'selected' : ''}>${crmEsc(c.nome)}</option>`).join('')}</select></label>
      ${pode ? '<button type="submit" class="fin-btn-salvar">💾 Salvar</button>' : '<p class="fin-hint">Só o administrador edita as configurações financeiras.</p>'}
    </form></div>`;
  const f = $('fin-cfg-form');
  if (f && pode) f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const r = await (await fetch('/api/financeiro/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ saldo_baixo: +$('cfg-saldo-baixo').value || 0, conta_cartao_id: +$('cfg-conta-cartao').value || 0 }) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    toast('💾 Configuração salva');
  });
}
function finIr(secao) {
  finSecao = secao;
  document.querySelectorAll('.fin-menu-item').forEach(b => b.classList.toggle('ativo', b.dataset.fin === secao));
  const R = { caixa: renderFinCaixaDia, conferencia: renderFinConferencia, balanco: renderFinBalanco, acai: renderFinAcai, painel: renderFinPainel, dashboard: renderFinPainel, premium: renderFinPainel, geral: renderFinGeral, fluxo: renderFinPainel, movimentacoes: renderFinMovimentacoes,
    receitas: () => renderFinLancamento('entrada'), despesas: () => renderFinLancamento('saida'),
    entradas: () => renderFinLancamento('entrada'), saidas: () => renderFinLancamento('saida'), contas: renderFinContas, categorias: renderFinCategorias,
    fornecedores: renderFinFornecedores, compras: renderFinCompras, contas_pagar: renderFinContasPagar, receber: renderFinReceber, centro_custos: renderFinCentroCustos,
    fechamento: renderFinConferencia, conciliacao: renderFinConciliacao, relatorios: renderFinRelatorios, config: renderFinConfig };
  (R[secao] || renderFinCaixaDia)();
}
document.querySelectorAll('#tela-financeiro .fin-menu-item').forEach(b => b.addEventListener('click', () => finIr(b.dataset.fin)));

function finListaMov(movs, comAcoes) {
  const cols = [{ h: 'Data' }, { h: 'Descrição' }, { h: 'Conta' }, { h: 'Categoria' }, { h: 'Valor', cls: 'num' }, { h: 'Situação' }];
  if (comAcoes) cols.push({ h: '' });
  return biTabela(cols, movs.map(m => {
    const row = [fmtDataHora(m.data), crmEsc(m.descricao || '—'), crmEsc(m.conta_nome || '—'), crmEsc(m.categoria_nome || '—'),
      `<span class="fin-val ${m.tipo}">${m.tipo === 'entrada' ? '+' : '−'}${fmt(m.valor)}</span>`, `<span class="fin-sit fin-sit-${m.situacao}">${finSitLabel(m.situacao)}</span>`];
    if (comAcoes) row.push(finAcoesMov(m));
    return row;
  }));
}
function finAcoesMov(m) {
  if (!finPodeAdmin() || m.situacao === 'estornado') return m.situacao === 'estornado' ? '<span class="fin-mini-tag">estornado</span>' : '';
  let b = `<button class="fin-mini" data-fin-acao="estornar" data-id="${m.id}" title="Estornar">↩️</button>`;
  if (!m.referencia_tipo) b += `<button class="fin-mini" data-fin-acao="excluir" data-id="${m.id}" title="Excluir">🗑</button>`;
  return b;
}

async function renderFinGeral() {
  const el = $('fin-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await finGet('visao-geral'); } catch { el.innerHTML = biErro(); return; }
  el.innerHTML = `
    <div class="fin-cards">
      ${finCard('💰', fmt(d.saldoAtual), 'Saldo atual em contas', '', d.saldoAtual >= 0 ? 'pos' : 'neg')}
      ${finCard('⬆️', fmt(d.entradasDia), 'Entradas do dia')}
      ${finCard('⬇️', fmt(d.saidasDia), 'Saídas do dia')}
      ${finCard(d.saldoDia >= 0 ? '📈' : '📉', fmt(d.saldoDia), 'Saldo do dia', '', d.saldoDia >= 0 ? 'pos' : 'neg')}
      ${finCard('⬆️', fmt(d.entradasMes), 'Entradas do mês')}
      ${finCard('⬇️', fmt(d.saidasMes), 'Saídas do mês')}
      ${finCard(d.resultadoMes >= 0 ? '📈' : '📉', fmt(d.resultadoMes), 'Resultado do mês', '', d.resultadoMes >= 0 ? 'pos' : 'neg')}
      ${finCard('⏳', biNum(d.totalPendentes), 'Movimentações pendentes', fmt(d.valorPendente))}
    </div>
    <div class="fin-grid2">
      ${finBox('🏦 Saldo por conta', biTabela([{ h: 'Conta' }, { h: 'Tipo' }, { h: 'Saldo', cls: 'num' }], d.contas.map(c => [crmEsc(c.nome), finTipoConta(c.tipo), `<b>${fmt(c.saldo)}</b>`])))}
      ${finBox('🧾 Últimas movimentações', d.ultimas.length ? finListaMov(d.ultimas) : biVazio('Nenhuma movimentação ainda.'))}
    </div>
    ${d.pendentes.length ? finBox('⏳ Movimentações pendentes', finListaMov(d.pendentes, true)) : ''}`;
}
const finBox = (tit, conteudo) => `<div class="fin-box"><h3 class="fin-box-tit">${tit}</h3>${conteudo}</div>`;

function renderFinLancamento(tipo) {
  const el = $('fin-conteudo');
  const nome = tipo === 'entrada' ? 'entrada' : 'saída';
  // SAÍDAS = hub de Contas a pagar (sem lançamento manual avulso). Toda saída passa por
  // registrar a conta (uma vez ou parcelada) e depois pagar (o pagamento vira o movimento).
  if (tipo === 'saida') {
    el.innerHTML = `
      <div class="fin-saida-atalhos">
        <div class="fsa-tit">📌 Contas a pagar <small>— registre a conta, agende com aviso e pague</small></div>
        <div class="fsa-btns">
          <button type="button" class="fsa-btn parc" data-erp-acao="cp-nova">🧾 Registrar conta a pagar</button>
          <button type="button" class="fsa-btn func" data-erp-acao="cp-func">👤 Pagar funcionário</button>
          <button type="button" class="fsa-btn vale" data-erp-acao="cp-vale">🤝 Vale funcionário</button>
          <button type="button" class="fsa-btn" data-erp-acao="cp-abrir">📋 Ver contas a pagar</button>
        </div>
        <div id="fin-saida-avisos"></div>
      </div>
      <div class="fin-box">
        <h3 class="fin-box-tit">Últimas saídas</h3>
        <div id="fin-mov-lista">${biLoading()}</div>
      </div>`;
    finCarregarListaMov('saida');
    erpGet('alertas').then(a => { const box = $('fin-saida-avisos'); if (box) box.innerHTML = renderAlertasBanner(a) || '<div class="fsa-ok">✅ Nenhuma conta vencida ou vencendo agora.</div>'; }).catch(() => {});
    return;
  }
  el.innerHTML = `
    <div class="fin-grid-form">
      <div class="fin-box">
        <h3 class="fin-box-tit">⬆️ Nova entrada</h3>
        <form id="fin-form-mov" autocomplete="off" class="fin-form">
          <input type="hidden" id="fin-mov-tipo" value="${tipo}">
          <div class="fin-frow"><label>Data<input type="date" id="fin-mov-data"></label><label>Valor (R$)<input type="number" step="0.01" min="0" id="fin-mov-valor" placeholder="0,00"></label></div>
          <div class="fin-frow"><label>Conta<select id="fin-mov-conta">${finOptContas()}</select></label><label>Categoria<select id="fin-mov-cat">${finOptCategorias(tipo)}</select></label></div>
          <label>Centro de custo<select id="fin-mov-cc">${finOptCentros()}</select></label>
          <label>Descrição<input id="fin-mov-desc" placeholder="ex.: aporte do dono"></label>
          <div class="fin-frow"><label>Responsável<input id="fin-mov-resp" placeholder="quem lançou"></label><label>Situação<select id="fin-mov-sit"><option value="confirmado">Confirmado</option><option value="pendente">Pendente</option></select></label></div>
          <label>Observação<input id="fin-mov-obs"></label>
          <button type="submit" class="fin-btn-salvar">💾 Lançar ${nome}</button>
        </form>
      </div>
      <div class="fin-box">
        <h3 class="fin-box-tit">Últimas entradas</h3>
        <div id="fin-mov-lista">${biLoading()}</div>
      </div>
    </div>`;
  $('fin-mov-data').value = new Date().toISOString().slice(0, 10);
  $('fin-form-mov').addEventListener('submit', finSalvarMov);
  finCarregarListaMov(tipo);
}
async function finSalvarMov(e) {
  e.preventDefault();
  const tipo = $('fin-mov-tipo').value;
  const valor = parseFloat(($('fin-mov-valor').value || '').replace(',', '.'));
  if (!valor || valor <= 0) { toast('⚠ Informe um valor válido'); return; }
  const body = { tipo, valor, conta_id: +$('fin-mov-conta').value || null, categoria_id: +$('fin-mov-cat').value || null, centro_custo_id: +($('fin-mov-cc') || {}).value || null,
    data: $('fin-mov-data').value ? new Date($('fin-mov-data').value + 'T12:00:00').toISOString() : undefined,
    descricao: $('fin-mov-desc').value.trim(), responsavel: $('fin-mov-resp').value.trim(), obs: $('fin-mov-obs').value.trim(), situacao: $('fin-mov-sit').value };
  try {
    const r = await (await fetch('/api/financeiro/movimentos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    toast(`✅ ${tipo === 'entrada' ? 'Entrada' : 'Saída'} de ${fmt(valor)} lançada`);
    ['fin-mov-valor', 'fin-mov-desc', 'fin-mov-obs'].forEach(id => $(id).value = '');
    await finCarregarBase(); finCarregarListaMov(tipo);
  } catch { toast('⚠ Falha ao lançar'); }
}
async function finCarregarListaMov(tipo) {
  let L; try { L = await finGet('movimentos?tipo=' + tipo); } catch { $('fin-mov-lista').innerHTML = biErro(); return; }
  if (tipo === 'saida') {   // Saídas: agrupa por dia; clicar no dia abre TUDO do dia
    $('fin-mov-lista').innerHTML = (L && L.length) ? finListaMovAgrupada(L) : biVazio('Nenhuma saída ainda.');
    $('fin-mov-lista').querySelectorAll('[data-dia-full]').forEach(cab => { const abrir = () => abrirDiaCompleto(cab.dataset.diaFull, cab.dataset.diaLabel); cab.addEventListener('click', abrir); cab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } }); });
    return;
  }
  $('fin-mov-lista').innerHTML = (L && L.length) ? finListaMov(L, true) : biVazio('Nenhum lançamento ainda.');
}
const finYmdLocal = d => { const t = new Date(d), p = n => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; };
// Últimas saídas agrupadas por DIA: cada dia é uma barra clicável (abre tudo do dia) com as saídas embaixo.
function finListaMovAgrupada(movs) {
  const dias = [], mapa = new Map();
  movs.forEach(m => { const key = new Date(m.data).toLocaleDateString('pt-BR'); let g = mapa.get(key); if (!g) { g = { label: key, ymd: finYmdLocal(m.data), movs: [], total: 0 }; mapa.set(key, g); dias.push(g); } g.movs.push(m); g.total += (+m.valor || 0); });
  const hora = d => new Date(d).toLocaleTimeString('pt-BR').slice(0, 5);
  let body = '';
  dias.forEach(g => {
    body += `<tr class="fsd-cab" data-dia-full="${g.ymd}" data-dia-label="${g.label}" tabindex="0" title="clique pra ver TUDO deste dia"><td colspan="4"><span class="fsd-data">📅 ${g.label}</span><span class="fsd-qtd">${g.movs.length} saída(s)</span><b class="fsd-tot fin-neg">${fmt(g.total)}</b><span class="fsd-abrir">abrir o dia ▸</span></td></tr>`;
    g.movs.forEach(m => { body += `<tr class="fsd-mov"><td class="fsd-hora">${hora(m.data)}</td><td>${crmEsc(m.descricao || '—')}</td><td>${crmEsc(m.conta_nome || '—')}</td><td class="col-num"><span class="fin-val ${m.tipo}">${m.tipo === 'entrada' ? '+' : '−'}${fmt(m.valor)}</span></td></tr>`; });
  });
  return `<table class="fin-tabela fsd-tabela"><thead><tr><th>Hora</th><th>Descrição</th><th>Conta</th><th class="col-num">Valor</th></tr></thead><tbody>${body}</tbody></table>`;
}
// Abre TUDO (entradas + saídas) de um dia num modal: filtros entrada/saída + vendas por turno.
let diaComp = { linhas: [], itens: [], filtro: 'tudo', abertos: {}, ymd: '', label: '' };
async function abrirDiaCompleto(ymd, label) {
  let d, vi;
  try {
    [d, vi] = await Promise.all([
      (await fetch('/api/financeiro/fluxo?de=' + ymd + '&ate=' + ymd, { cache: 'no-store' })).json(),
      (await fetch('/api/financeiro/vendas-dia?dia=' + ymd, { cache: 'no-store' })).json()
    ]);
  } catch { toast('⚠ Falha ao abrir o dia'); return; }
  diaComp = { linhas: d.linhas || [], itens: (vi && vi.itens) || [], filtro: 'tudo', abertos: { manha: false, noite: false, outro: false }, ymd, label: label || ymd };
  abrirErpModal('<div id="diac-host"></div>');
  $('modal-erp-box').classList.add('erp-ci');
  renderDiaCompleto();
}
// Rótulo da unidade: açaí (por litro) → LT; senão a sigla do produto ou "un".
function diacUnLabel(it) { const u = (it.unidade || '').trim(), n = it.nome || ''; if (/litro|^l$|^lt$/i.test(u) || /litro/i.test(n) || /a[çc]a[íi]/i.test(n)) return 'LT'; return u ? u.toUpperCase() : 'un'; }
function renderDiaCompleto() {
  const host = $('diac-host'); if (!host) return;
  const { linhas, itens, filtro, label, abertos } = diaComp;
  const hora = x => new Date(x).toLocaleTimeString('pt-BR').slice(0, 5);
  const isVenda = m => ['pdv', 'delivery'].includes(m.origem);
  const ent = linhas.filter(m => m.tipo === 'entrada').reduce((s, m) => s + (+m.valor || 0), 0);
  const sai = linhas.filter(m => m.tipo === 'saida').reduce((s, m) => s + (+m.valor || 0), 0);
  const fil = linhas.filter(m => filtro === 'tudo' ? true : m.tipo === filtro);
  const outras = fil.filter(m => !isVenda(m));   // vendas viram o resumo por turno; resto lista normal
  const mostrarVendas = filtro !== 'saida';       // vendas são entradas → somem no filtro "Saídas"
  // agrupa os ITENS vendidos por turno (cada turno tem linhas "20 LT de R$10 · Açaí")
  const T = { manha: { lbl: '🌅 Manhã (07h–14h)', itens: [], tot: 0 }, noite: { lbl: '🌙 Tarde/Noite (17h–23h)', itens: [], tot: 0 }, outro: { lbl: '🕐 Outros horários', itens: [], tot: 0 } };
  itens.forEach(it => { if (T[it.turno]) { T[it.turno].itens.push(it); T[it.turno].tot += +it.total || 0; } });
  const temVendas = itens.length > 0;
  const rowsHtml = arr => arr.map(m => `<tr><td class="fsd-hora">${hora(m.data)}</td><td>${crmEsc(m.descricao || '—')}</td><td>${crmEsc(m.conta_nome || '—')}</td><td class="col-num"><span class="fin-val ${m.tipo}">${m.tipo === 'entrada' ? '+' : '−'}${fmt(m.valor)}</span></td></tr>`).join('');
  const itensHtml = arr => arr.map(it => `<tr class="fsd-item"><td class="fsd-qty">${biNum(it.qtd)} ${diacUnLabel(it)}</td><td class="fsd-de">de ${fmt(it.preco)}</td><td>${crmEsc(it.nome || '—')}</td><td class="col-num"><b class="fin-pos">${fmt(it.total)}</b></td></tr>`).join('');
  const fbtn = (v, t) => `<button type="button" class="diac-fbtn${filtro === v ? ' ativo' : ''}" data-diac-f="${v}">${t}</button>`;
  let turnosHtml = '';
  if (mostrarVendas) ['manha', 'noite', 'outro'].forEach(k => { const g = T[k]; if (!g.itens.length) return; const ab = !!abertos[k];
    const totQ = g.itens.reduce((s, it) => s + (+it.qtd || 0), 0);
    turnosHtml += `<table class="fin-tabela fsd-tabela"><tbody>
        <tr class="fsd-cab" data-diac-turno="${k}" tabindex="0" title="clique pra abrir/fechar"><td colspan="4"><span class="fsd-seta">${ab ? '▾' : '▸'}</span> <span class="fsd-data">${g.lbl}</span> <span class="fsd-qtd">${biNum(totQ)} itens</span> <b class="fsd-tot fin-pos">${fmt(g.tot)}</b></td></tr>
        ${ab ? itensHtml(g.itens) : ''}</tbody></table>`; });
  const outrasHtml = outras.length ? `<table class="fin-tabela"><thead><tr><th>Hora</th><th>Descrição</th><th>Conta</th><th class="col-num">Valor</th></tr></thead><tbody>${rowsHtml(outras)}</tbody></table>` : '';
  const nada = (!(mostrarVendas && temVendas) && !outras.length) ? '<div class="ac-vazio">Nada neste filtro.</div>' : '';
  host.innerHTML = `<h3 class="erp-modal-tit">📅 Tudo do dia ${label}</h3>
    <div class="dia-tot">⬆️ <b class="fin-pos">${fmt(ent)}</b> · ⬇️ <b class="fin-neg">${fmt(sai)}</b> · resultado <b class="${ent - sai >= 0 ? 'fin-pos' : 'fin-neg'}">${fmt(ent - sai)}</b></div>
    <div class="diac-filtros">${fbtn('tudo', 'Tudo')}${fbtn('entrada', '⬆️ Entradas')}${fbtn('saida', '⬇️ Saídas')}</div>
    <div class="dia-tab-wrap">
      ${(mostrarVendas && temVendas) ? `<div class="diac-sec">🛒 Vendas por turno <small>(clique pra ver por produto/valor)</small></div>${turnosHtml}` : ''}
      ${outras.length ? `<div class="diac-sec">📋 Outras movimentações</div>${outrasHtml}` : ''}
      ${nada}
    </div>`;
  host.querySelectorAll('[data-diac-f]').forEach(b => b.addEventListener('click', () => { diaComp.filtro = b.dataset.diacF; renderDiaCompleto(); }));
  host.querySelectorAll('[data-diac-turno]').forEach(c => { const t = () => { const k = c.dataset.diacTurno; diaComp.abertos[k] = !diaComp.abertos[k]; renderDiaCompleto(); }; c.addEventListener('click', t); c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t(); } }); });
}

// Pesquisa por forma de pagamento (máquina/pix/dinheiro): agrupa as contas por tipo.
// dinheiro→caixa, pix→pix, cartão→maquininha+banco. O filtro é client-side sobre a conta do movimento.
let finFluxoForma = '';
let finFluxoTipo = '';     // '' | 'entrada' | 'saida' — chip rápido de entrada/saída
let fluxoMovsCache = [];   // guarda os movimentos do fluxo p/ o clique na linha (drill-down da origem)
const FIN_FORMA_TIPOS = { dinheiro: ['caixa'], pix: ['pix'], cartao: ['maquininha', 'banco'] };
function finFluxoContaTipo(nome) { const c = finContas.find(x => x.nome === nome); return c ? c.tipo : ''; }
function renderFinFluxo(host) {
  const el = host || $('fin-conteudo');
  const chip = (v, t) => `<button class="fin-forma-chip ${finFluxoForma === v ? 'ativo' : ''}" data-forma="${v}">${t}</button>`;
  const tchip = (v, t) => `<button class="fin-forma-chip fin-tipo-chip ${finFluxoTipo === v ? 'ativo' : ''}" data-tipo="${v}">${t}</button>`;
  el.innerHTML = `
    <div class="fin-fluxo-cab"><b>🌊 Fluxo de caixa</b> <small>— todas as entradas (+) e saídas (−) do período, com saldo acumulado. Filtre por data, conta, forma, origem…</small></div>
    <div class="fin-formas">
      <span class="fin-formas-lbl">💳 Pesquisar por forma:</span>
      ${chip('', 'Todas')}${chip('dinheiro', '💵 Dinheiro')}${chip('pix', '📱 PIX')}${chip('cartao', '💳 Máquina/Cartão')}
    </div>
    <div class="fin-formas">
      <span class="fin-formas-lbl">↕️ Entrada / Saída:</span>
      ${tchip('', 'Tudo')}${tchip('entrada', '⬆️ Entradas')}${tchip('saida', '⬇️ Saídas')}
    </div>
    <div class="fin-filtros">
      <label>De<input type="date" id="fin-f-de"></label>
      <label>Até<input type="date" id="fin-f-ate"></label>
      <label>Conta<select id="fin-f-conta"><option value="">Todas</option>${finContas.map(c => `<option value="${c.id}">${crmEsc(c.nome)}</option>`).join('')}</select></label>
      <label>Categoria<select id="fin-f-cat"><option value="">Todas</option>${finCategorias.map(c => `<option value="${c.id}">${crmEsc(c.nome)}</option>`).join('')}</select></label>
      <label>Tipo<select id="fin-f-tipo"><option value="">Ambos</option><option value="entrada">Entradas</option><option value="saida">Saídas</option></select></label>
      <label>Origem<select id="fin-f-origem"><option value="">Todas</option><option value="manual">Manual</option><option value="pdv">PDV</option><option value="delivery">Delivery</option><option value="fiado">Fiado</option></select></label>
      <label>Responsável<input id="fin-f-resp" placeholder="nome"></label>
      <button class="fin-btn-filtrar" id="fin-f-aplicar">🔎 Filtrar</button>
    </div>
    <div id="fin-fluxo-lista">${biLoading()}</div>`;
  $('fin-f-aplicar').addEventListener('click', finCarregarFluxo);
  el.querySelectorAll('.fin-forma-chip[data-forma]').forEach(b => b.addEventListener('click', () => { finFluxoForma = b.dataset.forma; el.querySelectorAll('.fin-forma-chip[data-forma]').forEach(x => x.classList.toggle('ativo', x.dataset.forma === finFluxoForma)); finCarregarFluxo(); }));
  el.querySelectorAll('.fin-tipo-chip').forEach(b => b.addEventListener('click', () => { finFluxoTipo = b.dataset.tipo; if ($('fin-f-tipo')) $('fin-f-tipo').value = finFluxoTipo; el.querySelectorAll('.fin-tipo-chip').forEach(x => x.classList.toggle('ativo', x.dataset.tipo === finFluxoTipo)); finCarregarFluxo(); }));
  finCarregarFluxo();
}
async function finCarregarFluxo() {
  try { const ct = await finGet('contas'); if (Array.isArray(ct)) finContas = ct; } catch {}   // saldo geral SEMPRE fresco (não fica velho após pagar açaí/conta)
  const q = new URLSearchParams();
  const map = { de: 'fin-f-de', ate: 'fin-f-ate', conta_id: 'fin-f-conta', categoria_id: 'fin-f-cat', tipo: 'fin-f-tipo', origem: 'fin-f-origem', responsavel: 'fin-f-resp' };
  for (const [k, id] of Object.entries(map)) { const v = $(id) && $(id).value; if (v) q.set(k, v); }
  let d; try { d = await (await fetch('/api/financeiro/fluxo?' + q, { cache: 'no-store' })).json(); } catch { $('fin-fluxo-lista').innerHTML = biErro(); return; }
  // filtro por forma (client-side, por tipo da conta) + recomputa saldo do período mostrado
  let linhas = d.linhas, saldoFinal = d.saldoFinal, extraNota = '';
  if (finFluxoForma && FIN_FORMA_TIPOS[finFluxoForma]) {
    const tipos = FIN_FORMA_TIPOS[finFluxoForma];
    linhas = d.linhas.filter(m => tipos.includes(finFluxoContaTipo(m.conta_nome)));
    saldoFinal = linhas.reduce((s, m) => s + (m.tipo === 'entrada' ? +m.valor : -m.valor), 0);
    const flbl = { dinheiro: '💵 Dinheiro', pix: '📱 PIX', cartao: '💳 Máquina/Cartão' }[finFluxoForma];
    extraNota = ` · <span class="fin-forma-nota">filtrado: ${flbl}</span>`;
  }
  fluxoMovsCache = linhas;   // p/ o clique na linha
  const entradas = linhas.filter(m => m.tipo === 'entrada').reduce((s, m) => s + (+m.valor || 0), 0);
  const saidas = linhas.filter(m => m.tipo === 'saida').reduce((s, m) => s + (+m.valor || 0), 0);
  const resultado = Math.round((entradas - saidas) * 100) / 100;
  const saldoGeral = (finContas || []).reduce((s, c) => s + (+c.saldo || 0), 0);   // SALDO NO GERAL (todas as contas, agora)
  const contasChips = (finContas || []).map(c => `<button type="button" class="flx-conta-chip" data-flx-conta="${c.id}" title="ver só esta conta"><span>${crmEsc(c.nome)}</span><b class="${(+c.saldo || 0) >= 0 ? 'fin-pos' : 'fin-neg'}">${fmt(c.saldo)}</b></button>`).join('');
  const totLbl = finFluxoForma ? 'Total da forma' : 'Saldo do período';
  const colSaldo = finFluxoForma ? '' : '<th class="col-num">Saldo acum.</th>';
  const nCols = finFluxoForma ? 5 : 6;
  // agrupa por DIA (ordem preservada = mais recente no topo); cada dia é um cabeçalho clicável.
  const dias = []; const mapaDia = new Map();
  linhas.forEach((m, i) => {
    const key = new Date(m.data).toLocaleDateString('pt-BR');
    let g = mapaDia.get(key);
    if (!g) { g = { label: key, ymd: finYmdLocal(m.data), movs: [], ent: 0, sai: 0 }; mapaDia.set(key, g); dias.push(g); }
    g.movs.push({ m, i });
    if (m.tipo === 'entrada') g.ent += +m.valor || 0; else g.sai += +m.valor || 0;
  });
  const hora = d => new Date(d).toLocaleTimeString('pt-BR').slice(0, 5);
  let bodyHtml = '';
  if (!linhas.length) bodyHtml = `<tr><td colspan="${nCols}" class="ac-vazio">Nenhuma movimentação no filtro.</td></tr>`;
  dias.forEach((g, gi) => {
    const net = Math.round((g.ent - g.sai) * 100) / 100, aberto = gi === 0;   // 1º dia (mais recente) já aberto
    bodyHtml += `<tr class="flx-dia-cab${aberto ? ' aberto' : ''}" data-dia-toggle="${gi}" tabindex="0" title="clique pra abrir/fechar o dia">
        <td colspan="${nCols}"><span class="flx-dia-seta">▸</span><span class="flx-dia-data">📅 ${g.label}</span><span class="flx-dia-qtd">${g.movs.length} mov.</span><button type="button" class="flx-dia-open" data-dia-open="${g.ymd}" data-dia-label="${g.label}" title="abrir o dia com filtros e vendas por turno">🔎 abrir dia</button><span class="flx-dia-tot">⬆️ ${fmt(g.ent)} · ⬇️ ${fmt(g.sai)} · <b class="${net >= 0 ? 'fin-pos' : 'fin-neg'}">${fmt(net)}</b></span></td></tr>`;
    g.movs.forEach(({ m, i }) => {
      bodyHtml += `<tr class="flx-row flx-mov${aberto ? '' : ' oculto'}" data-diagrp="${gi}" data-fi="${i}" tabindex="0" title="clique pra ver de onde veio">
        <td class="flx-hora">${hora(m.data)}</td>
        <td class="flx-desc">${crmEsc(m.descricao || '—')}</td>
        <td class="flx-cc">${crmEsc(m.conta_nome || '—')} · ${crmEsc(m.categoria_nome || '—')}</td>
        <td>${finOrigemChip(m.origem)}</td>
        <td class="col-num"><span class="fin-val ${m.tipo}">${m.tipo === 'entrada' ? '+' : '−'}${fmt(m.valor)}</span></td>
        ${finFluxoForma ? '' : `<td class="col-num"><b>${fmt(m.saldoAcumulado)}</b></td>`}
      </tr>`;
    });
  });
  $('fin-fluxo-lista').innerHTML = `
    <div class="flx-topcards">
      <div class="flx-saldo-geral">
        <span class="flx-sg-lbl">💰 Saldo geral <small>(todas as contas, agora)</small></span>
        <b class="flx-sg-val ${saldoGeral >= 0 ? 'fin-pos' : 'fin-neg'}">${fmt(saldoGeral)}</b>
        <div class="flx-contas">${contasChips || '<span class="flx-sem">sem contas</span>'}</div>
      </div>
      <div class="flx-kpis">
        <div class="flx-kpi ent"><span>⬆️ Entradas <small>(período)</small></span><b>${fmt(entradas)}</b></div>
        <div class="flx-kpi sai"><span>⬇️ Saídas <small>(período)</small></span><b>${fmt(saidas)}</b></div>
        <div class="flx-kpi res ${resultado >= 0 ? 'pos' : 'neg'}"><span>${resultado >= 0 ? '📈' : '📉'} Resultado <small>(período)</small></span><b>${fmt(resultado)}</b></div>
      </div>
    </div>
    <div class="fin-fluxo-topo">${totLbl}: <b class="${saldoFinal >= 0 ? 'fin-pos' : 'fin-neg'}">${fmt(saldoFinal)}</b> · ${linhas.length} movimentações${extraNota} · <small>clique num dia pra abrir/fechar</small></div>
    <div class="prod-tabela-wrap flx-wrap"><table class="prod-tabela flx-tabela flx-agrupada"><thead><tr><th>Hora</th><th>Descrição</th><th>Conta · Categoria</th><th>Origem</th><th class="col-num">Valor</th>${colSaldo}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
  $('fin-fluxo-lista').querySelectorAll('[data-flx-conta]').forEach(b => b.addEventListener('click', () => { const sel = $('fin-f-conta'); if (sel) { sel.value = b.dataset.flxConta; finCarregarFluxo(); } }));
  // cabeçalho de dia → abre/fecha as linhas daquele dia
  $('fin-fluxo-lista').querySelectorAll('[data-dia-toggle]').forEach(cab => {
    const gi = cab.dataset.diaToggle;
    const toggle = () => { cab.classList.toggle('aberto'); const ab = cab.classList.contains('aberto'); $('fin-fluxo-lista').querySelectorAll(`.flx-mov[data-diagrp="${gi}"]`).forEach(r => r.classList.toggle('oculto', !ab)); };
    cab.addEventListener('click', toggle);
    cab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
  // 🔎 abrir dia → pop-up "Tudo do dia" (filtros entrada/saída + vendas por turno). Não dispara o toggle.
  $('fin-fluxo-lista').querySelectorAll('[data-dia-open]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); abrirDiaCompleto(b.dataset.diaOpen, b.dataset.diaLabel); }));
  $('fin-fluxo-lista').querySelectorAll('.flx-mov').forEach(tr => { const abrir = () => abrirDetalheMov(fluxoMovsCache[+tr.dataset.fi]); tr.addEventListener('click', abrir); tr.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); abrir(); } }); });
}
// Detalhe de um movimento do fluxo — "de onde veio" (origem, conta, categoria, referência, quem lançou)
function abrirDetalheMov(m) {
  if (!m) return;
  const origemTxt = { manual: '✍️ Lançamento manual', pdv: '🛒 Venda no PDV', delivery: '🛵 Delivery', fiado: '📒 Fiado (conta de cliente)', caixa: '💰 Caixa (sangria/suprimento)', compra_acai: '🫐 Compra de açaí', compra: '🧾 Compra de fornecedor' }[m.origem] || (m.origem || '—');
  const refMap = { caixa_sangria: 'Sangria de caixa', caixa_suprimento: 'Suprimento de caixa', compra_acai: 'Compra de açaí', venda: 'Venda', pedido: 'Pedido delivery', anotacao: 'Recebimento anotado', extrato: 'Recebimento de fiado', contas_pagar: 'Conta a pagar' };
  const refTxt = m.referencia_tipo ? `${refMap[m.referencia_tipo] || m.referencia_tipo}${m.referencia_id ? ' #' + m.referencia_id : ''}` : '—';
  const linha = (r, v) => `<tr><td class="md-k">${r}</td><td class="md-v">${v}</td></tr>`;
  abrirErpModal(`<h3 class="erp-modal-tit">🔎 De onde veio este lançamento</h3>
    <div class="mov-det">
      <div class="mov-det-val ${m.tipo}">${m.tipo === 'entrada' ? '+' : '−'}${fmt(m.valor)}</div>
      <div class="mov-det-desc">${crmEsc(m.descricao || '—')}</div>
      <table class="mov-det-tab">
        ${linha('Tipo', m.tipo === 'entrada' ? '⬆️ Entrada' : '⬇️ Saída')}
        ${linha('Origem', origemTxt)}
        ${linha('Conta', crmEsc(m.conta_nome || '—'))}
        ${linha('Categoria', crmEsc(m.categoria_nome || '—'))}
        ${m.centro_custo_nome ? linha('Centro de custo', crmEsc(m.centro_custo_nome)) : ''}
        ${linha('Data', fmtDataHora(m.data))}
        ${linha('No fluxo/painel', m.fora_fluxo ? '🚫 Não — só fechamento do dia' : '✅ Sim')}
        ${linha('Quem lançou', crmEsc(nomeOp(m.criado_por || m.responsavel) || '—'))}
        ${linha('Referência', refTxt)}
        ${m.obs ? linha('Observação', crmEsc(m.obs)) : ''}
      </table>
      ${finPodeAdmin() && movEditavel(m) ? `<div class="mov-det-acoes"><button class="fin-btn-salvar" id="mov-det-editar">✏️ Editar movimentação</button></div>` : ''}
    </div>`);
  $('modal-erp-box').classList.add('erp-ci');
  const be = $('mov-det-editar'); if (be) be.addEventListener('click', () => abrirEditarMov(m));
}
// só admin edita, e só manual OU sangria/suprimento (venda/pedido/fiado se corrige na origem)
const movEditavel = (m) => !m.referencia_tipo || ['caixa_sangria', 'caixa_suprimento'].includes(m.referencia_tipo);
function abrirEditarMov(m) {
  const foraFluxo = !!m.fora_fluxo;
  abrirErpModal(`<h3 class="erp-modal-tit">✏️ Editar movimentação</h3>
    <form id="mov-edit-form" class="op-mov-form">
      <div class="mov-edit-dia">📅 ${fmtDataHora(m.data)} <small>— a data fica travada no dia do lançamento (não sai do fechamento)</small></div>
      <label>Valor (R$) *<input id="mov-edit-valor" type="number" step="0.01" min="0.01" value="${(+m.valor || 0).toFixed(2)}"></label>
      <label>Descrição<input id="mov-edit-desc" autocomplete="off" value="${crmEsc(m.descricao || '')}"></label>
      <label>Observação<input id="mov-edit-obs" autocomplete="off" value="${crmEsc(m.obs || '')}"></label>
      <label class="op-mov-fluxo"><input type="checkbox" id="mov-edit-fluxo" ${foraFluxo ? '' : 'checked'}> Entra no <b>fluxo de caixa</b> e no <b>painel financeiro</b> <small>— desmarque se for só pra fechar o caixa do dia</small></label>
      <button type="submit" class="fin-btn-salvar">💾 Salvar alterações</button>
    </form>`);
  $('modal-erp-box').classList.add('erp-ci');
  setTimeout(() => { const v = $('mov-edit-valor'); if (v) { v.focus(); v.select(); } }, 40);
  $('mov-edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    const valor = parseFloat(($('mov-edit-valor').value || '0').replace(',', '.'));
    if (!(valor > 0)) { toast('⚠ Valor deve ser maior que zero'); return; }
    const body = { valor, descricao: $('mov-edit-desc').value.trim(), obs: $('mov-edit-obs').value.trim(), fora_fluxo: $('mov-edit-fluxo').checked ? false : true };
    const r = await (await fetch('/api/financeiro/movimentos/' + m.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    toast('💾 Movimentação atualizada'); fecharErpModal();
    if (typeof finCarregarFluxo === 'function' && $('tela-financeiro') && $('tela-financeiro').classList.contains('ativa')) finCarregarFluxo();
  });
}

function renderFinContas() {
  const el = $('fin-conteudo');
  const rows = finContas.map(c => [crmEsc(c.nome) + (c.sistema ? ' <span class="fin-mini-tag">sistema</span>' : ''), finTipoConta(c.tipo), `<b>${fmt(c.saldo)}</b>`,
    `<span class="fin-sit fin-sit-${c.ativo ? 'confirmado' : 'estornado'}">${c.ativo ? 'Ativa' : 'Inativa'}</span>`, finPodeAdmin() ? finAcoesConta(c) : '']);
  el.innerHTML = `
    ${finPodeAdmin() ? `<div class="fin-box"><h3 class="fin-box-tit">🏦 Nova conta</h3>
      <form id="fin-form-conta" class="fin-form fin-form-inline">
        <input id="fin-conta-nome" placeholder="Nome (ex.: Nubank)">
        <select id="fin-conta-tipo"><option value="caixa">Caixa</option><option value="pix">PIX</option><option value="banco">Banco</option><option value="maquininha">Maquininha</option><option value="outro" selected>Outra</option></select>
        <input type="number" step="0.01" id="fin-conta-saldo" placeholder="Saldo inicial">
        <button type="submit" class="fin-btn-salvar">➕ Adicionar</button>
      </form></div>` : ''}
    <div class="fin-box"><h3 class="fin-box-tit">Contas (${finContas.length})</h3>
      ${biTabela([{ h: 'Conta' }, { h: 'Tipo' }, { h: 'Saldo', cls: 'num' }, { h: 'Situação' }, { h: '' }], rows)}</div>`;
  const f = $('fin-form-conta'); if (f) f.addEventListener('submit', finSalvarConta);
}
function finAcoesConta(c) {
  let b = `<button class="fin-mini" data-fin-acao="conta-saldo" data-id="${c.id}" title="Editar saldo inicial">💰</button>`;
  b += `<button class="fin-mini" data-fin-acao="conta-ativo" data-id="${c.id}" data-ativo="${c.ativo ? 0 : 1}" title="${c.ativo ? 'Desativar' : 'Ativar'}">${c.ativo ? '🚫' : '✅'}</button>`;
  if (!c.sistema) b += `<button class="fin-mini" data-fin-acao="conta-excluir" data-id="${c.id}" title="Excluir">🗑</button>`;
  return b;
}
async function finSalvarConta(e) {
  e.preventDefault();
  const nome = $('fin-conta-nome').value.trim(); if (!nome) { toast('⚠ Informe o nome'); return; }
  const body = { nome, tipo: $('fin-conta-tipo').value, saldo_inicial: parseFloat(($('fin-conta-saldo').value || '0').replace(',', '.')) || 0 };
  const r = await (await fetch('/api/financeiro/contas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (r.erro) { toast('⚠ ' + r.erro); return; }
  toast('🏦 Conta criada'); await finCarregarBase(); renderFinContas();
}

function renderFinCategorias() {
  const el = $('fin-conteudo');
  const rows = finCategorias.map(c => [crmEsc(c.nome), finTipoCat(c.tipo), c.sistema ? '🔒 sistema' : '', finPodeAdmin() && !c.sistema ? `<button class="fin-mini" data-fin-acao="cat-excluir" data-id="${c.id}" title="Excluir">🗑</button>` : '']);
  el.innerHTML = `
    ${finPodeAdmin() ? `<div class="fin-box"><h3 class="fin-box-tit">🏷️ Nova categoria</h3>
      <form id="fin-form-cat" class="fin-form fin-form-inline">
        <input id="fin-cat-nome" placeholder="Nome (ex.: Aluguel)">
        <select id="fin-cat-tipo"><option value="saida">Saída</option><option value="entrada">Entrada</option><option value="ambos">Ambos</option></select>
        <button type="submit" class="fin-btn-salvar">➕ Adicionar</button>
      </form></div>` : ''}
    <div class="fin-box"><h3 class="fin-box-tit">Categorias (${finCategorias.length})</h3>
      ${biTabela([{ h: 'Categoria' }, { h: 'Tipo' }, { h: '' }, { h: '' }], rows)}</div>`;
  const f = $('fin-form-cat'); if (f) f.addEventListener('submit', finSalvarCat);
}
async function finSalvarCat(e) {
  e.preventDefault();
  const nome = $('fin-cat-nome').value.trim(); if (!nome) { toast('⚠ Informe o nome'); return; }
  const r = await (await fetch('/api/financeiro/categorias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, tipo: $('fin-cat-tipo').value }) })).json();
  if (r.erro) { toast('⚠ ' + r.erro); return; }
  toast('🏷️ Categoria criada'); await finCarregarBase(); renderFinCategorias();
}

// Ações delegadas (estornar/excluir movimento; editar/ativar/excluir conta; excluir categoria)
$('fin-conteudo').addEventListener('click', async e => {
  const b = e.target.closest('[data-fin-acao]'); if (!b) return;
  const id = b.dataset.id, acao = b.dataset.finAcao;
  const req = async (url, opt) => { const r = await (await fetch(url, opt)).json(); if (r.erro) { toast('⚠ ' + r.erro); return null; } return r; };
  if (acao === 'estornar') {
    if (!confirm('Estornar este movimento? Ele sai do saldo mas continua registrado.')) return;
    if (await req(`/api/financeiro/movimentos/${id}/estornar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })) { toast('↩️ Estornado'); await finCarregarBase(); finIr(finSecao); }
  } else if (acao === 'excluir') {
    if (!confirm('Excluir este movimento manual? Não dá pra desfazer.')) return;
    if (await req(`/api/financeiro/movimentos/${id}`, { method: 'DELETE' })) { toast('🗑 Excluído'); await finCarregarBase(); finIr(finSecao); }
  } else if (acao === 'conta-saldo') {
    const c = finContas.find(x => x.id == id); const v = prompt('Saldo inicial da conta (R$):', c ? c.saldo_inicial : 0); if (v == null) return;
    if (await req(`/api/financeiro/contas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ saldo_inicial: parseFloat(String(v).replace(',', '.')) || 0 }) })) { toast('💰 Saldo inicial atualizado'); await finCarregarBase(); renderFinContas(); }
  } else if (acao === 'conta-ativo') {
    if (await req(`/api/financeiro/contas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: b.dataset.ativo === '1' }) })) { await finCarregarBase(); renderFinContas(); }
  } else if (acao === 'conta-excluir') {
    if (!confirm('Excluir esta conta?')) return;
    if (await req(`/api/financeiro/contas/${id}`, { method: 'DELETE' })) { toast('🗑 Conta excluída'); await finCarregarBase(); renderFinContas(); }
  } else if (acao === 'cat-excluir') {
    if (!confirm('Excluir esta categoria?')) return;
    if (await req(`/api/financeiro/categorias/${id}`, { method: 'DELETE' })) { toast('🗑 Categoria excluída'); await finCarregarBase(); renderFinCategorias(); }
  } else if (acao === 'cc-ativo') {
    if (await req(`/api/financeiro/centros-custo/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: b.dataset.ativo === '1' }) })) { await finCarregarBase(); renderFinCentroCustos(); }
  } else if (acao === 'cc-excluir') {
    if (!confirm('Excluir este centro de custo?')) return;
    if (await req(`/api/financeiro/centros-custo/${id}`, { method: 'DELETE' })) { toast('🗑 Centro excluído'); await finCarregarBase(); renderFinCentroCustos(); }
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   ERP — FORNECEDORES · COMPRAS · CONTAS A PAGAR (Fase 26). Estende o menu do
   Financeiro. Reaproveita biTabela/biBars/finCard/finBox. Modais no #overlay-erp.
   ══════════════════════════════════════════════════════════════════════════ */
let erpFornecedoresCache = [], erpCompraAberta = null;
const erpFmtData = iso => { if (!iso) return '—'; const s = String(iso).slice(0, 10), p = s.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };
const erpStatusChip = s => `<span class="erp-status erp-status-${s}">${({ aberto: 'Em aberto', parcial: 'Parcial', pago: 'Pago', cancelada: 'Cancelada' }[s] || s)}</span>`;
const erpGet = async (rota) => (await fetch('/api/erp/' + rota, { cache: 'no-store' })).json();
const erpOptFornecedores = (sel) => erpFornecedoresCache.filter(f => f.ativo).map(f => `<option value="${f.id}" ${f.id == sel ? 'selected' : ''}>${crmEsc(f.nome)}</option>`).join('');
let erpOnClose = null;   // callback disparado ao fechar o modal (ESC, X, clique fora, confirmar)
function abrirErpModal(html) { erpOnClose = null; const b = $('modal-erp-box'); b.className = 'modal-erp'; b.innerHTML = html; $('overlay-erp').classList.add('aberto'); }
function fecharErpModal() {
  $('overlay-erp').classList.remove('aberto');
  const cb = erpOnClose; erpOnClose = null;   // limpa antes (evita reentrância)
  if (cb) { try { cb(); } catch {} }
}
$('overlay-erp').addEventListener('click', e => { if (e.target === $('overlay-erp')) fecharErpModal(); });
function finRefreshAtual() { if (erpCompraAberta) renderCompraDetalhe(erpCompraAberta); else if (finSecao === 'contas_pagar') renderFinContasPagar(); else if (finSecao === 'compras') carregarComprasLista(); else if (finSecao === 'receber') renderFinReceber(); }

// ── FORNECEDORES ──
async function renderFinFornecedores() {
  const el = $('fin-conteudo'); el.innerHTML = biLoading(); erpCompraAberta = null;
  let L; try { L = await erpGet('fornecedores'); } catch { el.innerHTML = biErro(); return; }
  erpFornecedoresCache = L;
  const rows = L.map(f => [`<a class="erp-link" data-erp-acao="forn-ver" data-id="${f.id}">${crmEsc(f.nome)}</a>${f.ativo ? '' : ' <span class="fin-mini-tag">inativo</span>'}`, crmEsc(f.cidade || '—'), `<b class="${f.saldoAberto > 0 ? 'fin-neg' : ''}">${fmt(f.saldoAberto)}</b>`, erpFmtData(f.ultimaCompra), fmt(f.totalMes)]);
  el.innerHTML = `
    <div class="erp-topo"><h2 class="erp-h2">🏭 Fornecedores</h2><span class="fin-flex"></span>${finPodeLancar() ? '<button class="fin-btn-salvar" data-erp-acao="forn-novo">➕ Novo fornecedor</button>' : ''}</div>
    ${biTabela([{ h: 'Nome' }, { h: 'Cidade' }, { h: 'Saldo aberto', cls: 'num' }, { h: 'Última compra' }, { h: 'Comprado no mês', cls: 'num' }], rows, 'Nenhum fornecedor cadastrado.')}`;
}
function fornecedorFormHtml(f) {
  f = f || {};
  const campo = (id, lbl, val, tipo) => `<label>${lbl}<input id="ef-${id}" ${tipo ? `type="${tipo}"` : ''} value="${crmEsc(val || '')}"></label>`;
  return `<form id="erp-form-forn" class="fin-form erp-forn-form">
    <div class="erp-forn-cards">
      <section class="erp-forn-card"><h4>🏷️ Identificação</h4>
        <div class="fin-frow">${campo('nome', 'Nome*', f.nome)}${campo('fantasia', 'Nome fantasia', f.nome_fantasia)}</div>
        <div class="fin-frow">${campo('razao', 'Razão social', f.razao_social)}${campo('doc', 'CPF / CNPJ', f.cpf_cnpj)}</div>
        <div class="fin-frow">${campo('ie', 'Inscrição estadual', f.inscricao_estadual)}<label>Código${f.id ? ' (auto)' : ''}<input id="ef-codigo" value="${crmEsc(f.codigo || '')}" ${f.codigo ? 'readonly' : 'placeholder="auto"'}></label></div>
        <label class="erp-forn-ativo">Situação<select id="ef-ativo"><option value="1" ${f.ativo !== 0 ? 'selected' : ''}>✅ Ativo</option><option value="0" ${f.ativo === 0 ? 'selected' : ''}>⛔ Inativo</option></select></label></section>
      <section class="erp-forn-card"><h4>📞 Contato</h4>
        <div class="fin-frow">${campo('tel', 'Telefone', f.telefone)}${campo('wpp', 'WhatsApp', f.whatsapp)}</div>
        <div class="fin-frow">${campo('email', 'E-mail', f.email, 'email')}${campo('contato', 'Contato principal', f.contato_principal)}</div></section>
      <section class="erp-forn-card"><h4>📍 Endereço</h4>
        <label>Endereço<input id="ef-end" value="${crmEsc(f.endereco || '')}"></label>
        <div class="fin-frow">${campo('cidade', 'Cidade', f.cidade)}<label>Estado<input id="ef-estado" maxlength="2" value="${crmEsc(f.estado || '')}" style="text-transform:uppercase"></label></div></section>
      <section class="erp-forn-card"><h4>💳 Pagamento</h4>
        <label>Chave PIX<input id="ef-pix" value="${crmEsc(f.pix || '')}"></label>
        <label>Dados bancários<input id="ef-banco" value="${crmEsc(f.banco || '')}" placeholder="banco / agência / conta"></label></section>
      <section class="erp-forn-card erp-forn-card-wide"><h4>📝 Observações</h4>
        <div class="fin-frow">${campo('tags', 'Tags', f.tags)}<label>&nbsp;</label></div>
        <label>Observações<input id="ef-obs" value="${crmEsc(f.obs || '')}"></label></section>
    </div>
    <input type="hidden" id="ef-id" value="${f.id || ''}">
    <button type="submit" class="fin-btn-salvar">💾 Salvar fornecedor</button></form>`;
}
function abrirFornecedorForm(f) { abrirErpModal(`<h3 class="erp-modal-tit">${f ? '✏️ Editar' : '➕ Novo'} fornecedor</h3>${fornecedorFormHtml(f)}`); $('erp-form-forn').addEventListener('submit', salvarFornecedor); }
async function salvarFornecedor(e) {
  e.preventDefault();
  const nome = $('ef-nome').value.trim(); if (!nome) { toast('⚠ Informe o nome'); return; }
  const val = id => { const e = $(id); return e ? e.value.trim() : ''; };
  const body = { nome, nome_fantasia: val('ef-fantasia'), razao_social: val('ef-razao'), cpf_cnpj: val('ef-doc'), inscricao_estadual: val('ef-ie'), contato_principal: val('ef-contato'), telefone: val('ef-tel'), whatsapp: val('ef-wpp'), email: val('ef-email'), cidade: val('ef-cidade'), estado: val('ef-estado').toUpperCase(), endereco: val('ef-end'), banco: val('ef-banco'), pix: val('ef-pix'), tags: val('ef-tags'), obs: val('ef-obs'), ativo: $('ef-ativo').value === '1' };
  const codigo = val('ef-codigo'); if (codigo) body.codigo = codigo;
  const id = $('ef-id').value;
  const r = await (await fetch('/api/erp/fornecedores' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (r.erro) { toast('⚠ ' + r.erro); return; }
  toast('✅ Fornecedor salvo'); fecharErpModal(); renderFinFornecedores();
}
const CRITERIOS_AVAL = [['qualidade', 'Qualidade do fruto'], ['pontualidade', 'Pontualidade'], ['atendimento', 'Atendimento'], ['conformidade_qtd', 'Conformidade da quantidade'], ['conformidade_prod', 'Conformidade do produto']];
function estrelas(n) { if (n == null) return '<span class="fin-hint">—</span>'; const c = Math.round(n); return '★'.repeat(c) + '☆'.repeat(Math.max(0, 5 - c)) + ` <small>${n}</small>`; }
async function renderFornecedorDetalhe(id) {
  const el = $('fin-conteudo'); el.innerHTML = biLoading();
  let fi; try { fi = await erpGet('fornecedores/' + id + '/ficha'); } catch { el.innerHTML = biErro(); return; }
  if (fi.erro) { el.innerHTML = biVazio(fi.erro); return; }
  const f = fi.fornecedor, a = fi.analise, m = fi.metricas;
  const rl = (v, u) => v == null ? '—' : (v + (u || ''));
  const contato = [f.telefone && '📞 ' + crmEsc(f.telefone), f.whatsapp && '💬 ' + crmEsc(f.whatsapp), f.email && '✉️ ' + crmEsc(f.email), f.cidade && '📍 ' + crmEsc(f.cidade) + (f.estado ? '/' + crmEsc(f.estado) : ''), f.pix && '💳 PIX ' + crmEsc(f.pix)].filter(Boolean).join(' · ');
  el.innerHTML = `
    <div class="erp-topo"><button class="fin-mini" data-erp-acao="forn-voltar">← Voltar</button><h2 class="erp-h2">🏭 ${crmEsc(f.nome || 'Fornecedor')}${f.codigo ? ` <small>${crmEsc(f.codigo)}</small>` : ''}</h2><span class="fin-flex"></span>${finPodeLancar() ? `<button class="fin-mini" data-erp-acao="forn-editar" data-id="${id}">✏️ Editar</button>` : ''}</div>
    ${contato ? `<p class="erp-forn-contato">${contato}</p>` : ''}
    <div class="fin-cards">
      ${finCard('💰', fmt(fi.saldoAberto), 'Saldo em aberto', '', fi.saldoAberto > 0 ? 'neg' : '')}
      ${finCard('🧾', biNum(m.qtdCompras), 'Compras', fmt(m.totalComprado))}
      ${finCard('📦', biNum(a.sacasCompradas) + ' sc', 'Sacas fornecidas')}
      ${finCard('🏷️', fmt(a.precoMedioSaca), 'Preço médio/saca')}
      ${finCard('💧', rl(a.rendimentoMedioSaca, ' L/sc'), 'Rendimento médio')}
      ${finCard('💵', a.custoMedioLitro != null ? fmt(a.custoMedioLitro) : '—', 'Custo real/litro')}
      ${finCard('📈', rl(a.melhorRendimento, ' L/sc'), 'Melhor rendimento')}
      ${finCard('📉', rl(a.piorRendimento, ' L/sc'), 'Pior rendimento')}
      ${finCard('🧊', biNum(a.lotesEmEstoque), 'Lotes disponíveis', biNum(a.saldoSacas) + ' sc')}
      ${finCard('⭐', fi.notaMedia != null ? fi.notaMedia + '/5' : '—', 'Avaliação média')}
      ${finCard('🗓️', a.primeiraCompra || '—', 'Primeira compra')}
      ${finCard('🗓️', a.ultimaCompra || '—', 'Última compra')}
    </div>
    ${fi.alertas && fi.alertas.length ? `<div class="fin-box"><h3 class="fin-box-tit">⚠️ Alertas ativos (${fi.alertas.length})</h3><div class="ci-alertas">${fi.alertas.map(x => `<div class="ci-alerta ${CI_SEV[x.sev] || ''}">${crmEsc(x.texto)}</div>`).join('')}</div></div>` : ''}
    ${fi.contasVencidas && fi.contasVencidas.length ? finBox('🔴 Contas vencidas', biTabela([{ h: 'Descrição' }, { h: 'Vencimento' }, { h: 'Em aberto', cls: 'num' }], fi.contasVencidas.map(c => [crmEsc(c.descricao || '—'), erpFmtData(c.data_vencimento), fmt(c.restante)]), '')) : ''}
    <div class="fin-grid2">
      ${finBox('🧾 Compras', biTabela([{ h: 'Compra' }, { h: 'Data' }, { h: 'Total', cls: 'num' }, { h: 'Financ.' }, { h: 'Receb.' }], fi.compras.map(c => [`<a class="erp-link" data-erp-acao="compra-ver" data-id="${c.id}">#${c.id}</a>`, erpFmtData(c.data_emissao), fmt(c.total), erpStatusChip(c.status), recStatusChip(c.status_recebimento)]), 'Sem compras.'))}
      ${finBox('🧊 Lotes internos', biTabela([{ h: 'Lote' }, { h: 'Sacas', cls: 'num' }, { h: 'Saldo', cls: 'num' }, { h: 'Custo/sc', cls: 'num' }, { h: 'Receb.' }, { h: 'Status' }], fi.lotes.map(l => [crmEsc(l.lote_interno), biNum(l.qtd), biNum(l.saldo), fmt(l.custo_saca), erpFmtData(l.data_recebimento), crmEsc(l.status)]), 'Sem lotes.'))}
    </div>
    <div class="fin-grid2">
      ${finBox('🚚 Recebimentos', biTabela([{ h: 'Receb.' }, { h: 'Compra' }, { h: 'Data' }, { h: 'Status' }], fi.recebimentos.map(rc => [`#${rc.id}`, `<a class="erp-link" data-erp-acao="compra-ver" data-id="${rc.compra_id}">#${rc.compra_id}</a>`, erpFmtData(rc.data), crmEsc(rc.status)]), 'Sem recebimentos.'))}
      ${finBox('⭐ Avaliações', biTabela([{ h: 'Data' }, { h: 'Nota' }, { h: 'Obs' }], fi.avaliacoes.map(av => [erpFmtData(av.criado_em), estrelas(av.nota), crmEsc(av.obs || '—')]), 'Nenhuma avaliação ainda.'))}
    </div>
    ${finPodeLancar() ? `<div class="fin-box"><h3 class="fin-box-tit">📝 Avaliar fornecedor</h3>
      <form id="erp-form-aval" class="fin-form">
        <div class="erp-aval-grid">${CRITERIOS_AVAL.map(([k, lbl]) => `<label>${lbl}<select class="av-crit" data-k="${k}"><option value="">—</option>${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${'★'.repeat(n)} ${n}</option>`).join('')}</select></label>`).join('')}</div>
        <label>Observação geral<input id="av-obs"></label>
        <p class="fin-hint">A nota média usa só os critérios preenchidos — critérios em branco não contam.</p>
        <button type="submit" class="fin-btn-salvar" data-fid="${id}">💾 Salvar avaliação</button></form></div>` : ''}`;
  const af = $('erp-form-aval');
  if (af) af.addEventListener('submit', async e => {
    e.preventDefault();
    const criterios = {}; let soma = 0, n = 0;
    af.querySelectorAll('.av-crit').forEach(s => { if (s.value) { criterios[s.dataset.k] = +s.value; soma += +s.value; n++; } });
    if (!n) { toast('⚠ Preencha ao menos um critério'); return; }
    const nota = Math.round((soma / n) * 100) / 100;
    const r = await (await fetch(`/api/erp/fornecedores/${id}/avaliacoes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nota, criterios, obs: $('av-obs').value.trim() }) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    toast('⭐ Avaliação salva (nota ' + nota + ')'); renderFornecedorDetalhe(id);
  });
}

// ── COMPRAS ──
async function renderFinCompras() {
  const el = $('fin-conteudo'); el.innerHTML = biLoading(); erpCompraAberta = null;
  if (!erpFornecedoresCache.length) { try { erpFornecedoresCache = await erpGet('fornecedores'); } catch {} }
  el.innerHTML = `
    <div class="erp-topo"><h2 class="erp-h2">🧾 Compras</h2><span class="fin-flex"></span>
      <button class="fin-mini" data-erp-acao="compra-relatorios">📊 Relatórios</button>
      ${finPodeLancar() ? '<button class="fin-btn-salvar" data-erp-acao="compra-nova">➕ Nova compra</button>' : ''}</div>
    <div class="fin-filtros">
      <label>Fornecedor<select id="cf-forn"><option value="">Todos</option>${erpOptFornecedores()}</select></label>
      <label>Status<select id="cf-status"><option value="">Todos</option><option value="aberto">Em aberto</option><option value="parcial">Parcial</option><option value="pago">Pago</option><option value="cancelada">Cancelada</option></select></label>
      <label>De<input type="date" id="cf-de"></label><label>Até<input type="date" id="cf-ate"></label>
      <label>NF<input id="cf-nf" placeholder="nº"></label><label>Produto<input id="cf-prod" placeholder="código/nome"></label>
      <button class="fin-btn-filtrar" data-erp-acao="compra-filtrar">🔎 Filtrar</button>
    </div>
    <div id="erp-compras-lista">${biLoading()}</div>`;
  carregarComprasLista();
}
async function carregarComprasLista() {
  const q = new URLSearchParams(), map = { fornecedor_id: 'cf-forn', status: 'cf-status', de: 'cf-de', ate: 'cf-ate', numero_nf: 'cf-nf', produto: 'cf-prod' };
  for (const [k, id] of Object.entries(map)) { const v = $(id) && $(id).value; if (v) q.set(k, v); }
  let L; try { L = await erpGet('compras?' + q); } catch { $('erp-compras-lista').innerHTML = biErro(); return; }
  const rows = L.map(c => [`<a class="erp-link" data-erp-acao="compra-ver" data-id="${c.id}">#${c.id}</a>`, erpFmtData(c.data_emissao), crmEsc(c.fornecedor_nome || '—'), crmEsc(c.numero_nf || '—'), fmt(c.total), fmt(c.pago), erpStatusChip(c.status)]);
  $('erp-compras-lista').innerHTML = biTabela([{ h: 'Compra' }, { h: 'Emissão' }, { h: 'Fornecedor' }, { h: 'NF' }, { h: 'Total', cls: 'num' }, { h: 'Pago', cls: 'num' }, { h: 'Status' }], rows, 'Nenhuma compra encontrada.');
}
let ecItemSeq = 0;
function abrirCompraForm() {
  const contasFin = finContas.filter(c => c.ativo);
  abrirErpModal(`<h3 class="erp-modal-tit">➕ Nova compra</h3>
    <form id="erp-form-compra" class="fin-form">
      <div class="fin-frow"><label>Fornecedor<select id="ec-forn">${erpOptFornecedores()}</select></label><label>Número NF<input id="ec-nf"></label></div>
      <div class="fin-frow"><label>Data emissão<input type="date" id="ec-emissao"></label><label>Data vencimento<input type="date" id="ec-venc"></label></div>
      <div class="fin-frow erp-receb-cfg"><label>Recebimento<select id="ec-modo"><option value="automatico">Entrada única (recebe tudo agora)</option><option value="manual">Parcial (recebo em entregas)</option></select></label><label>Conta a pagar<select id="ec-finbase"><option value="pedido">Pelo total do pedido</option><option value="recebido">Conforme for recebido</option></select></label></div>
      <p class="fin-hint" id="ec-modo-hint">Entrada única: dá entrada no estoque e gera o lote na hora. Parcial: você registra cada entrega depois.</p>
      <div class="erp-itens"><div class="erp-itens-head"><span>Itens</span><button type="button" class="fin-mini" id="ec-add-item">➕ item</button></div><div id="ec-itens"></div></div>
      <div class="fin-frow3"><label>Frete<input type="number" step="0.01" id="ec-frete" value="0"></label><label>Desconto<input type="number" step="0.01" id="ec-desc" value="0"></label><label>Outras desp.<input type="number" step="0.01" id="ec-outras" value="0"></label></div>
      <div class="erp-total-linha">Total da compra: <b id="ec-total" data-val="0">R$ 0,00</b></div>
      <div class="erp-pgto-box"><label class="erp-check"><input type="checkbox" id="ec-pagar-ja"> Registrar um pagamento agora</label>
        <div class="fin-frow" id="ec-pgto-campos" style="display:none"><label>Valor<input type="number" step="0.01" id="ec-pgto-valor"></label><label>Forma<select id="ec-pgto-forma"><option>PIX</option><option>Dinheiro</option><option>Cartão</option><option>Banco</option><option>Boleto</option></select></label><label>Conta<select id="ec-pgto-conta">${contasFin.map(c => `<option value="${c.id}">${crmEsc(c.nome)}</option>`).join('')}</select></label></div></div>
      <label>Observação<input id="ec-obs"></label>
      <button type="submit" class="fin-btn-salvar">💾 Registrar compra</button></form>`);
  $('ec-emissao').value = new Date().toISOString().slice(0, 10);
  ecAddItem();
  $('ec-add-item').addEventListener('click', ecAddItem);
  $('ec-itens').addEventListener('input', ecRecalc);
  ['ec-frete', 'ec-desc', 'ec-outras'].forEach(id => $(id).addEventListener('input', ecRecalc));
  $('ec-pagar-ja').addEventListener('change', () => { $('ec-pgto-campos').style.display = $('ec-pagar-ja').checked ? '' : 'none'; if ($('ec-pagar-ja').checked && !$('ec-pgto-valor').value) $('ec-pgto-valor').value = $('ec-total').dataset.val || ''; });
  $('ec-modo').addEventListener('change', () => { $('ec-modo-hint').textContent = $('ec-modo').value === 'manual' ? 'Parcial: a compra fica "aguardando"; você registra cada entrega em Compra › Recebimento (entra no estoque só o que chegar).' : 'Entrada única: dá entrada no estoque e gera o lote na hora.'; });
  $('erp-form-compra').addEventListener('submit', salvarCompra);
}
function ecAddItem() {
  ecItemSeq++;
  const div = document.createElement('div'); div.className = 'erp-item-row'; div.dataset.i = ecItemSeq;
  div.innerHTML = `<input class="ec-i-cod" placeholder="Cód."><input class="ec-i-desc" placeholder="Produto / descrição"><input class="ec-i-qtd" type="number" step="0.01" placeholder="Qtd"><input class="ec-i-vu" type="number" step="0.01" placeholder="Vlr un."><span class="ec-i-tot">R$ 0,00</span><input class="ec-i-lote" placeholder="Lote"><input class="ec-i-val" type="date" title="Validade"><button type="button" class="fin-mini ec-i-del">✕</button>`;
  $('ec-itens').appendChild(div);
  div.querySelector('.ec-i-del').addEventListener('click', () => { div.remove(); ecRecalc(); });
  div.querySelector('.ec-i-cod').addEventListener('change', async e => { const cod = e.target.value.trim(); if (!cod) return; try { const p = await (await fetch('/api/produtos/' + encodeURIComponent(cod))).json(); if (p && p.codigo) { if (!div.querySelector('.ec-i-desc').value) div.querySelector('.ec-i-desc').value = p.nome; if (!div.querySelector('.ec-i-vu').value && p.precoCompra) div.querySelector('.ec-i-vu').value = p.precoCompra; ecRecalc(); } } catch {} });
}
function ecRecalc() {
  let subtotal = 0;
  $('ec-itens').querySelectorAll('.erp-item-row').forEach(r => { const q = parseFloat(r.querySelector('.ec-i-qtd').value) || 0, vu = parseFloat(r.querySelector('.ec-i-vu').value) || 0, t = q * vu; r.querySelector('.ec-i-tot').textContent = fmt(t); subtotal += t; });
  const total = subtotal + (parseFloat($('ec-frete').value) || 0) + (parseFloat($('ec-outras').value) || 0) - (parseFloat($('ec-desc').value) || 0);
  const tEl = $('ec-total'); tEl.textContent = fmt(total); tEl.dataset.val = total.toFixed(2);
}
async function salvarCompra(e) {
  e.preventDefault();
  const itens = [...$('ec-itens').querySelectorAll('.erp-item-row')].map(r => ({ produto_codigo: r.querySelector('.ec-i-cod').value.trim(), descricao: r.querySelector('.ec-i-desc').value.trim(), quantidade: parseFloat(r.querySelector('.ec-i-qtd').value) || 0, valor_unitario: parseFloat(r.querySelector('.ec-i-vu').value) || 0, lote: r.querySelector('.ec-i-lote').value.trim(), validade: r.querySelector('.ec-i-val').value })).filter(it => it.descricao || it.produto_codigo);
  if (!itens.length) { toast('⚠ Adicione ao menos um item'); return; }
  const modo = $('ec-modo') ? $('ec-modo').value : 'automatico';
  const body = { fornecedor_id: +$('ec-forn').value || null, numero_nf: $('ec-nf').value.trim(), data_emissao: $('ec-emissao').value, data_vencimento: $('ec-venc').value || null, recebimento_modo: modo, financeiro_base: $('ec-finbase') ? $('ec-finbase').value : 'pedido', frete: parseFloat($('ec-frete').value) || 0, desconto: parseFloat($('ec-desc').value) || 0, outras_despesas: parseFloat($('ec-outras').value) || 0, obs: $('ec-obs').value.trim(), itens };
  if ($('ec-pagar-ja').checked && parseFloat($('ec-pgto-valor').value) > 0) body.pagamento_inicial = { valor: parseFloat($('ec-pgto-valor').value), forma: $('ec-pgto-forma').value, conta_id: +$('ec-pgto-conta').value };
  const r = await (await fetch('/api/erp/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (r.erro) { toast('⚠ ' + r.erro); return; }
  toast(modo === 'manual' ? '✅ Compra criada — registre os recebimentos das entregas' : '✅ Compra registrada — estoque e conta a pagar gerados'); fecharErpModal(); renderCompraDetalhe(r.id);
}
// Chip do status de RECEBIMENTO (Fase 45.1).
const REC_STATUS = { aguardando: ['⏳ Aguardando', 'cinza'], parcial: ['📦 Parcial', 'amarelo'], recebida: ['✅ Recebida', 'verde'], divergencia: ['⚠️ Divergência', 'vermelho'], cancelada: ['🚫 Cancelada', 'cinza'] };
function recStatusChip(st) { const m = REC_STATUS[st] || [st || '—', 'cinza']; return `<span class="erp-rec-chip ${m[1]}">${m[0]}</span>`; }
const MOTIVO_LABEL = { falta: 'Falta', sobra: 'Sobra', produto_errado: 'Produto errado', danificado: 'Danificado', qualidade_recusada: 'Qualidade recusada', lote_divergente: 'Lote divergente', validade_inadequada: 'Validade inadequada', outro: 'Outro' };
async function renderCompraDetalhe(id) {
  const el = $('fin-conteudo'); el.innerHTML = biLoading(); erpCompraAberta = id;
  let c, resumo; try { [c, resumo] = await Promise.all([erpGet('compras/' + id), erpGet('compras/' + id + '/recebimento').catch(() => null)]); } catch { el.innerHTML = biErro(); return; }
  if (c.erro) { el.innerHTML = biVazio(c.erro); return; }
  const r = c.resumo;
  const itensRows = c.itens.map(i => [crmEsc(i.produto_codigo || '—'), crmEsc(i.descricao || '—'), biNum(i.quantidade), fmt(i.valor_unitario), fmt(i.valor_total), crmEsc(i.lote || '—'), i.validade ? erpFmtData(i.validade) : '—']);
  const tl = c.timeline.map(t => `<div class="erp-tl-item erp-tl-${t.tipo}"><div class="erp-tl-dot"></div><div class="erp-tl-body"><div class="erp-tl-top">${crmEsc(t.texto)} ${t.valor ? `<b>${fmt(t.valor)}</b>` : ''}</div><div class="erp-tl-data">${fmtDataHora(t.data)}</div></div></div>`).join('');
  const podePagar = finPodeLancar() && c.status !== 'pago' && c.status !== 'cancelada' && c.conta_pagar;
  const podeCancelar = finPodeAdmin() && c.status !== 'cancelada';
  el.innerHTML = `
    <div class="erp-topo"><button class="fin-mini" data-erp-acao="compra-voltar">← Voltar</button><h2 class="erp-h2">🧾 Compra #${c.id}</h2></div>
    <div class="erp-compra-grid">
      <div class="erp-compra-main">
        ${finBox('📦 Itens', biTabela([{ h: 'Código' }, { h: 'Produto' }, { h: 'Qtd', cls: 'num' }, { h: 'Vlr un.', cls: 'num' }, { h: 'Total', cls: 'num' }, { h: 'Lote' }, { h: 'Validade' }], itensRows, 'Sem itens.'))}
        ${renderRecebimentoBox(c, resumo)}
        <div class="fin-box"><h3 class="fin-box-tit">🕒 Linha do tempo</h3><div class="erp-timeline">${tl}</div></div>
      </div>
      <aside class="erp-compra-side"><div class="fin-box">
        <h3 class="fin-box-tit">Resumo</h3>
        <div class="erp-resumo-linha"><span>Fornecedor</span><b>${crmEsc(r.fornecedor)}</b></div>
        <div class="erp-resumo-linha"><span>NF</span><b>${crmEsc(r.nf || '—')}</b></div>
        <div class="erp-resumo-linha"><span>Status financ.</span>${erpStatusChip(r.status)}</div>
        <div class="erp-resumo-linha"><span>Recebimento</span>${recStatusChip(c.status_recebimento)}</div>
        <div class="erp-resumo-linha"><span>Vencimento</span><b>${erpFmtData(c.data_vencimento)}</b></div>
        <hr class="erp-hr">
        <div class="erp-resumo-linha grande"><span>Valor total</span><b>${fmt(r.valor_total)}</b></div>
        <div class="erp-resumo-linha"><span>Pago</span><b class="fin-pos">${fmt(r.pago)}</b></div>
        <div class="erp-resumo-linha"><span>Em aberto</span><b class="${r.restante > 0 ? 'fin-neg' : ''}">${fmt(r.restante)}</b></div>
        <div class="erp-resumo-linha"><span>Parcelas pagas</span><b>${r.num_parcelas}</b></div>
        <div class="erp-side-acoes">
          ${podePagar ? `<button class="fin-btn-salvar" data-erp-acao="cp-pagar" data-id="${c.conta_pagar.id}" data-rest="${r.restante}">💵 Pagar</button>` : ''}
          ${podeCancelar ? `<button class="fin-mini" data-erp-acao="compra-cancelar" data-id="${c.id}">🚫 Cancelar compra</button>` : ''}
        </div>
      </div></aside>
    </div>`;
}
// Painel de RECEBIMENTO PARCIAL (Fase 45.1) — comprado/recebido/pendente/recusado + entregas.
function renderRecebimentoBox(c, resumo) {
  if (!resumo || resumo.erro) return '';
  const t = resumo.totais, manual = resumo.recebimento_modo === 'manual';
  const podeReceber = finPodeLancar() && c.status !== 'cancelada' && t.pendente > 0.0001;
  const podeEstornar = finPodeAdmin();
  const itRows = resumo.itens.map(i => [crmEsc(i.produto_codigo || i.descricao || '—'), biNum(i.comprado), `<b class="fin-pos">${biNum(i.recebido)}</b>`, i.recusado > 0 ? `<b class="fin-neg">${biNum(i.recusado)}</b>` : '—', i.pendente > 0 ? `<b>${biNum(i.pendente)}</b>` : '0']);
  const recRows = resumo.recebimentos.map(rc => {
    const acoes = (rc.integrado && podeEstornar) ? `<button class="fin-mini" data-erp-acao="receb-estornar" data-id="${rc.id}">↩️ estornar</button>` : (rc.status === 'pendente' && finPodeLancar() ? `<button class="fin-mini" data-erp-acao="receb-aprovar" data-id="${rc.id}">✅ aprovar</button> <button class="fin-mini" data-erp-acao="receb-recusar" data-id="${rc.id}">✕ recusar</button>` : '');
    const resumoItens = rc.itens.map(x => `${biNum(x.qtd_recebida)}${x.qtd_recusada > 0 ? ' (−' + biNum(x.qtd_recusada) + (x.motivo_divergencia ? ' ' + (MOTIVO_LABEL[x.motivo_divergencia] || x.motivo_divergencia) : '') + ')' : ''} ${crmEsc(x.produto_codigo || '')}`).join(', ');
    return [`#${rc.id}`, fmtDataHora(rc.data), crmEsc(resumoItens), `<span class="erp-rec-chip ${rc.status === 'aprovado' ? 'verde' : rc.status === 'recusado' || rc.status === 'estornado' ? 'vermelho' : 'amarelo'}">${rc.status}</span>`, acoes];
  });
  return `<div class="fin-box"><div class="ci-box-head"><h3 class="fin-box-tit">🚚 Recebimento ${recStatusChip(c.status_recebimento)}</h3>
      ${podeReceber ? `<button class="fin-btn-salvar" data-erp-acao="receb-novo" data-id="${c.id}">➕ Registrar recebimento</button>` : ''}</div>
    <div class="erp-rec-totais"><span>Comprado <b>${biNum(t.comprado)}</b></span><span class="fin-pos">Recebido <b>${biNum(t.recebido)}</b></span><span>Pendente <b>${biNum(t.pendente)}</b></span><span class="fin-neg">Recusado <b>${biNum(t.recusado)}</b></span></div>
    ${biTabela([{ h: 'Item' }, { h: 'Comprado', cls: 'num' }, { h: 'Recebido', cls: 'num' }, { h: 'Recusado', cls: 'num' }, { h: 'Pendente', cls: 'num' }], itRows, 'Sem itens.')}
    ${resumo.recebimentos.length ? `<h4 class="erp-rec-sub">Entregas</h4>${biTabela([{ h: '#' }, { h: 'Data/hora' }, { h: 'Itens' }, { h: 'Status' }, { h: '' }], recRows, '')}` : (manual ? '<p class="fin-hint">Nenhuma entrega registrada ainda.</p>' : '<p class="fin-hint">Entrada única na criação da compra.</p>')}</div>`;
}
// Modal de registro de recebimento — por item pendente (qtd recebida/recusada + motivo + lote).
async function abrirRecebimentoModal(compraId) {
  let resumo; try { resumo = await erpGet('compras/' + compraId + '/recebimento'); } catch { toast('⚠ Falha ao carregar'); return; }
  const pend = resumo.itens.filter(i => i.pendente > 0.0001);
  if (!pend.length) { toast('✅ Nada pendente para receber'); return; }
  const motivoOpts = Object.entries(MOTIVO_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  const linhas = pend.map(i => `<tr data-item="${i.id}">
      <td>${crmEsc(i.produto_codigo || i.descricao)}<br><small>pendente: ${biNum(i.pendente)}</small></td>
      <td><input type="number" step="0.01" class="rl-rec" value="${biNum(i.pendente)}" max="${i.pendente}" style="width:80px"></td>
      <td><input type="number" step="0.01" class="rl-rej" value="0" style="width:70px"></td>
      <td><select class="rl-motivo"><option value="">—</option>${motivoOpts}</select></td>
      <td><input class="rl-lote" placeholder="lote forn." style="width:90px"></td>
      <td><input type="date" class="rl-val" title="validade" style="width:130px"></td></tr>`).join('');
  abrirErpModal(`<h3 class="erp-modal-tit">🚚 Registrar recebimento · Compra #${compraId}</h3>
    <form id="erp-form-receb" class="fin-form">
      <div style="overflow-x:auto"><table class="bi-tabela erp-rec-form-tab"><thead><tr><th>Item</th><th>Recebido</th><th>Recusado</th><th>Motivo</th><th>Lote forn.</th><th>Validade</th></tr></thead><tbody>${linhas}</tbody></table></div>
      <label>Observações<input id="erb-obs"></label>
      <label>Anexos/comprovantes (links ou nº do doc, separados por vírgula)<input id="erb-anexos" placeholder="ex.: NF-123, foto-entrega.jpg"></label>
      <label class="erp-check"><input type="checkbox" id="erb-aprovar" checked> Aprovar já (dá entrada no estoque + gera lote + financeiro)</label>
      <button type="submit" class="fin-btn-salvar">💾 Registrar recebimento</button></form>`);
  $('erp-form-receb').addEventListener('submit', async e => {
    e.preventDefault();
    const itens = [...document.querySelectorAll('#erp-form-receb tr[data-item]')].map(tr => ({ compra_item_id: +tr.dataset.item, qtd_recebida: parseFloat(tr.querySelector('.rl-rec').value) || 0, qtd_recusada: parseFloat(tr.querySelector('.rl-rej').value) || 0, motivo_divergencia: tr.querySelector('.rl-motivo').value, lote_fornecedor: tr.querySelector('.rl-lote').value.trim(), validade: tr.querySelector('.rl-val').value })).filter(i => i.qtd_recebida > 0 || i.qtd_recusada > 0);
    if (!itens.length) { toast('⚠ Informe ao menos um item recebido/recusado'); return; }
    const anexos = $('erb-anexos').value.trim() ? $('erb-anexos').value.split(',').map(s => s.trim()).filter(Boolean) : null;
    const body = { aprovar: $('erb-aprovar').checked, obs: $('erb-obs').value.trim(), anexos, itens };
    const resp = await (await fetch(`/api/erp/compras/${compraId}/recebimentos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (resp.erro) { toast('⚠ ' + resp.erro); return; }
    const st = resp.resumo ? resp.resumo.status_recebimento : '';
    toast('✅ Recebimento registrado' + (st ? ' · ' + (REC_STATUS[st] ? REC_STATUS[st][0] : st) : '')); fecharErpModal(); await finCarregarBase(); renderCompraDetalhe(compraId);
  });
}
async function renderCompraRelatorios() {
  const el = $('fin-conteudo'); el.innerHTML = biLoading(); erpCompraAberta = null;
  let d; try { d = await erpGet('relatorios'); } catch { el.innerHTML = biErro(); return; }
  const t = d.totalPeriodo, evolBars = d.evolucao.map(e => ({ label: erpFmtData(e.dia), valor: e.preco }));
  el.innerHTML = `
    <div class="erp-topo"><button class="fin-mini" data-erp-acao="compra-voltar-lista">← Compras</button><h2 class="erp-h2">📊 Relatórios de compras</h2></div>
    <div class="fin-cards bi-cards-3">${finCard('💰', fmt(t.total), 'Total comprado')}${finCard('🧾', biNum(t.qtd), 'Compras')}${finCard('🎯', fmt(t.media), 'Valor médio')}</div>
    <div class="fin-grid2">
      ${finBox('🏭 Compras por fornecedor', biTabela([{ h: 'Fornecedor' }, { h: 'Qtd', cls: 'num' }, { h: 'Total', cls: 'num' }, { h: 'Média', cls: 'num' }], d.porFornecedor.map(f => [crmEsc(f.nome), biNum(f.qtd), fmt(f.total), fmt(f.media)]), 'Sem dados.'))}
      ${finBox('🍧 Produtos mais comprados', biTabela([{ h: 'Produto' }, { h: 'Qtd', cls: 'num' }, { h: 'Total', cls: 'num' }, { h: 'Preço médio', cls: 'num' }], d.produtos.map(p => [crmEsc(p.nome), biNum(p.qtd), fmt(p.total), fmt(p.preco_medio)]), 'Sem dados.'))}
    </div>
    <div class="fin-grid2">
      ${finBox('💚 Mais barato / 💔 Mais caro', d.maisBarato ? `<div class="erp-resumo-linha"><span>Mais barato (${crmEsc(d.maisBarato.produto)})</span><b class="fin-pos">${crmEsc(d.maisBarato.fornecedor)} · ${fmt(d.maisBarato.preco)}</b></div><div class="erp-resumo-linha"><span>Mais caro</span><b class="fin-neg">${crmEsc(d.maisCaro.fornecedor)} · ${fmt(d.maisCaro.preco)}</b></div>` : biVazio('Sem comparativo (precisa de 2+ fornecedores no mesmo produto).'))}
      ${finBox('📈 Evolução de preço' + (d.produtoEvolucao ? ' · ' + crmEsc(d.produtoEvolucao) : ''), evolBars.length ? biBars(evolBars) : biVazio('Sem histórico.'))}
    </div>`;
}

// ── CONTAS A PAGAR ──
let cpContasCache = [];   // guarda as contas do último carregamento (p/ o editar achar pelo id)
async function renderFinContasPagar() {
  const el = $('fin-conteudo'); el.innerHTML = biLoading(); erpCompraAberta = null;
  if (!erpFornecedoresCache.length) { try { erpFornecedoresCache = await erpGet('fornecedores'); } catch {} }
  let alertas = {}; try { alertas = await erpGet('alertas'); } catch {}
  el.innerHTML = `
    <div class="erp-topo"><h2 class="erp-h2">📌 Contas a serem pagas</h2><span class="fin-flex"></span>${finPodeLancar() ? '<button class="fin-mini" data-erp-acao="cp-vale">🤝 Vale</button><button class="fin-mini" data-erp-acao="cp-func">👤 Pagar funcionário</button><button class="fin-mini" data-erp-acao="cp-nova">➕ Nova conta</button>' : ''}</div>
    ${renderAlertasBanner(alertas)}
    <div class="fin-filtros">
      <label>Fornecedor<select id="pf-forn"><option value="">Todos</option>${erpOptFornecedores()}</select></label>
      <label>Status<select id="pf-status"><option value="__abertas" selected>Não pagas</option><option value="">Todos</option><option value="aberto">Em aberto</option><option value="parcial">Parcial</option><option value="pago">Pago</option><option value="cancelada">Cancelada</option></select></label>
      <label>Situação<select id="pf-bucket"><option value="">Todas</option><option value="vencida">Vencidas</option><option value="hoje">Vencem hoje</option><option value="amanha">Amanhã</option><option value="proximos">Próximos 7 dias</option></select></label>
      <label>Venc. de<input type="date" id="pf-de"></label><label>até<input type="date" id="pf-ate"></label>
      <label>Buscar<input id="pf-busca" placeholder="fornecedor/descrição"></label>
      <button class="fin-btn-filtrar" data-erp-acao="cp-filtrar">🔎 Filtrar</button>
    </div>
    <div id="erp-cp-resumo"></div><div id="erp-cp-lista">${biLoading()}</div>`;
  carregarContasPagar();
}
function renderAlertasBanner(a) {
  if (!a || !a.totalAlertas) return '';
  const chip = (n, txt, cls) => n ? `<span class="erp-alerta-chip ${cls || ''}">${txt}: <b>${n}</b></span>` : '';
  return `<div class="erp-alertas">🔔 ${chip((a.vencidas || []).length, 'Vencidas', 'vermelho')}${chip((a.venceHoje || []).length, 'Vencem hoje', 'amarelo')}${chip((a.venceAmanha || []).length, 'Amanhã', '')}${chip((a.fornecedoresSemCompra || []).length, 'Fornecedor sumido', '')}${chip((a.aumentosPreco || []).length, '↑ Preço acima da média', 'vermelho')}</div>`;
}
async function carregarContasPagar() {
  const soAbertas = ($('pf-status') && $('pf-status').value === '__abertas');   // padrão: só as NÃO pagas
  const q = new URLSearchParams(), map = { fornecedor_id: 'pf-forn', status: 'pf-status', bucket: 'pf-bucket', vencDe: 'pf-de', vencAte: 'pf-ate', busca: 'pf-busca' };
  for (const [k, id] of Object.entries(map)) { const v = $(id) && $(id).value; if (v && v !== '__abertas') q.set(k, v); }   // "__abertas" é filtro do cliente (aberto+parcial)
  let d; try { d = await erpGet('contas-pagar?' + q); } catch { $('erp-cp-lista').innerHTML = biErro(); return; }
  const r = d.resumo; cpContasCache = d.contas || [];
  const bkt = ($('pf-bucket') || {}).value || '', sts = ($('pf-status') || {}).value || '';
  const chipB = (bucket, cls, txt, n) => `<button type="button" class="erp-cp-chip ${cls}${bkt === bucket ? ' ativo' : ''}" data-cp-bucket="${bucket}" title="clique pra filtrar">${txt} <b>${n}</b></button>`;
  const chipS = (status, cls, txt, n) => `<button type="button" class="erp-cp-chip ${cls}${sts === status ? ' ativo' : ''}" data-cp-status="${status}" title="clique pra filtrar">${txt} <b>${n}</b></button>`;
  $('erp-cp-resumo').innerHTML = `<div class="erp-cp-chips">${chipB('vencida', 'vermelho', '🔴 Vencidas', r.vencidas)}${chipB('hoje', 'amarelo', '⏰ Vencem hoje', r.hoje)}${chipB('amanha', '', 'Amanhã', r.amanha)}${chipB('proximos', '', 'Próx. 7d', r.proximos)}${chipS('parcial', '', 'Parciais', r.parciais)}${chipS('pago', 'verde', 'Pagas', r.pagas)}<span class="erp-cp-total">Em aberto: <b>${fmt(d.totalAberto)}</b></span></div>`;
  $('erp-cp-resumo').querySelectorAll('[data-cp-bucket]').forEach(b => b.addEventListener('click', () => { const cur = $('pf-bucket'); if (!cur) return; cur.value = (cur.value === b.dataset.cpBucket ? '' : b.dataset.cpBucket); carregarContasPagar(); }));
  $('erp-cp-resumo').querySelectorAll('[data-cp-status]').forEach(b => b.addEventListener('click', () => { const cur = $('pf-status'); if (!cur) return; cur.value = (cur.value === b.dataset.cpStatus ? '__abertas' : b.dataset.cpStatus); if ($('pf-bucket')) $('pf-bucket').value = ''; carregarContasPagar(); }));
  // agrupa parcelas da MESMA conta (mesmo fornecedor + descrição-base + valor) num card colapsável
  const baseDesc = s => (s || '').replace(/\s*\(\d+\/\d+\)\s*$/, '').trim() || 'Conta a pagar';
  const grupos = [], mapa = new Map();
  d.contas.forEach(c => {
    const key = (c.fornecedor_id || '') + '|' + baseDesc(c.descricao) + '|' + c.valor_total;
    let g = mapa.get(key);
    if (!g) { g = { titulo: baseDesc(c.descricao), fornecedor: c.fornecedor_nome || '', parcelas: [], total: 0, aberto: 0, pagas: 0, abertas: 0, temVencida: false, proxVenc: null, proxConta: null }; mapa.set(key, g); grupos.push(g); }
    g.parcelas.push(c);
    g.total += +c.valor_total || 0; g.aberto += +c.restante || 0;
    if (c.status === 'pago') g.pagas++; else { g.abertas++; const v = (c.data_vencimento || '').slice(0, 10); if (v && (!g.proxVenc || v < g.proxVenc)) { g.proxVenc = v; g.proxConta = c; } if (c.bucket === 'vencida') g.temVencida = true; }
  });
  // padrão "Não pagas": esconde os grupos totalmente quitados (mostra os que têm parcela em aberto)
  const gruposMostrar = soAbertas ? grupos.filter(g => g.abertas > 0) : grupos.slice();
  // ordena por URGÊNCIA: vencidas primeiro, depois quem vence mais cedo (hoje sobe); sem vencimento por último
  const hojeYmd = new Date().toISOString().slice(0, 10);
  gruposMostrar.forEach(g => { g.venceHoje = g.proxVenc === hojeYmd; });
  gruposMostrar.sort((a, b) => {
    const av = a.temVencida ? 0 : (a.venceHoje ? 1 : 2), bv = b.temVencida ? 0 : (b.venceHoje ? 1 : 2);
    if (av !== bv) return av - bv;
    const ad = a.proxVenc || '9999-99-99', bd = b.proxVenc || '9999-99-99';
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });
  const btnPagar = c => (finPodeLancar() && (c.status === 'aberto' || c.status === 'parcial'))
    ? (c.acai ? `<button class="fin-mini" data-erp-acao="cp-pagar-acai" data-acaiid="${c.acaiId}">💵 Pagar</button>`
              : `<button class="fin-mini" data-erp-acao="cp-pagar" data-id="${c.id}" data-rest="${c.restante}">💵 Pagar</button>`) : '';
  // editar valor/descrição/vencimento — só conta manual (não açaí, não de compra)
  const btnEditar = c => (finPodeLancar() && !c.acai && !c.compra_id) ? `<button class="fin-mini" data-erp-acao="cp-editar" data-id="${c.id}" title="Editar valor/descrição/vencimento">✏️</button>` : '';
  const btnExcluir = c => (finPodeAdmin() && !c.acai && !c.compra_id) ? `<button class="fin-mini del" data-erp-acao="cp-excluir" data-id="${c.id}" title="Excluir (lançamento indevido)">🗑</button>` : '';
  const parcelaRow = c => `<tr class="cpg-parc"><td>${erpFmtData(c.data_vencimento)}${c.bucket === 'vencida' ? ' <span class="erp-venc-flag">vencida</span>' : ''}</td><td class="col-num">${fmt(c.valor_total)}</td><td class="col-num">${fmt(c.pago)}</td><td class="col-num"><b>${fmt(c.restante)}</b></td><td>${erpStatusChip(c.status)}</td><td class="col-num">${btnEditar(c)} ${btnExcluir(c)} ${btnPagar(c)}</td></tr>`;
  const html = gruposMostrar.map((g, gi) => {
    if (g.parcelas.length === 1) { const c = g.parcelas[0];
      return `<div class="cpg-card ${g.temVencida ? 'venc' : ''}${g.venceHoje ? ' hoje' : ''}"><div class="cpg-head cpg-solo">
          <div class="cpg-title"><b>${crmEsc(g.titulo)}</b>${g.fornecedor ? `<span class="cpg-forn">${crmEsc(g.fornecedor)}</span>` : ''}</div>
          <div class="cpg-venc">${erpFmtData(c.data_vencimento)}${c.bucket === 'vencida' ? ' <span class="erp-venc-flag">vencida</span>' : ''}</div>
          <div class="cpg-vals"><span class="cpg-aberto ${c.restante > 0 ? '' : 'qui'}">${c.restante > 0 ? 'aberto ' + fmt(c.restante) : '✅ pago'}</span></div>
          <div class="cpg-acao">${btnEditar(c)} ${btnExcluir(c)} ${btnPagar(c)}</div></div></div>`;
    }
    const abertosTxt = g.abertas ? `${g.abertas} aberta(s)` : 'tudo pago';
    return `<div class="cpg-card ${g.temVencida ? 'venc' : ''}${g.venceHoje ? ' hoje' : ''}">
        <div class="cpg-head" data-cpg-toggle="${gi}" tabindex="0" title="clique pra ver as parcelas">
          <span class="cpg-seta">▸</span>
          <div class="cpg-title"><b>${crmEsc(g.titulo)}</b>${g.fornecedor ? `<span class="cpg-forn">${crmEsc(g.fornecedor)}</span>` : ''}<span class="cpg-badges"><span class="cpg-badge">${g.parcelas.length}x</span><span class="cpg-badge ${g.abertas ? 'ab' : 'pg'}">${abertosTxt}</span>${g.pagas ? `<span class="cpg-badge pg">${g.pagas} paga(s)</span>` : ''}</span></div>
          <div class="cpg-venc">${g.proxVenc ? `próx.: ${erpFmtData(g.proxVenc)}${g.temVencida ? ' <span class="erp-venc-flag">vencida</span>' : ''}` : ''}</div>
          <div class="cpg-vals"><span class="cpg-aberto">${g.aberto > 0 ? 'aberto ' + fmt(g.aberto) : '✅ quitado'}</span><small>total ${fmt(g.total)}</small></div>
          <div class="cpg-acao">${(g.proxConta && !g.proxConta.acai && finPodeLancar()) ? `<button class="fin-mini" data-erp-acao="cp-pagar" data-id="${g.proxConta.id}" data-rest="${g.proxConta.restante}">💵 Pagar próxima</button>` : ''}</div>
        </div>
        <div class="cpg-parcelas" data-cpg-grp="${gi}" style="display:none"><table class="cpg-tab"><thead><tr><th>Vencimento</th><th class="col-num">Valor</th><th class="col-num">Pago</th><th class="col-num">Aberto</th><th>Status</th><th></th></tr></thead><tbody>${g.parcelas.map(parcelaRow).join('')}</tbody></table></div>
      </div>`;
  }).join('');
  $('erp-cp-lista').innerHTML = gruposMostrar.length ? html : `<div class="ac-vazio">${soAbertas ? 'Nenhuma conta em aberto 🎉' : 'Nenhuma conta a pagar no filtro.'}</div>`;
  $('erp-cp-lista').querySelectorAll('[data-cpg-toggle]').forEach(h => { const gi = h.dataset.cpgToggle; const box = $('erp-cp-lista').querySelector(`[data-cpg-grp="${gi}"]`); const t = () => { const open = box.style.display === 'none'; box.style.display = open ? '' : 'none'; h.querySelector('.cpg-seta').textContent = open ? '▾' : '▸'; }; h.addEventListener('click', e => { if (e.target.closest('[data-erp-acao]')) return; t(); }); h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t(); } }); });
}
// Editar uma conta a pagar lançada errada (valor/descrição/vencimento). Só conta manual.
function abrirEditarContaPagar(id) {
  const c = (cpContasCache || []).find(x => x.id === id);
  if (!c) { toast('⚠ Conta não encontrada'); return; }
  const venc = (c.data_vencimento || '').slice(0, 10);
  abrirErpModal(`<h3 class="erp-modal-tit">✏️ Editar conta a pagar</h3>
    <form id="erp-form-cpedit" class="fin-form">
      ${(+c.pago > 0) ? `<div class="fin-hint">⚠ Já foi pago ${fmt(c.pago)} nesta conta — o valor não pode ficar abaixo disso.</div>` : ''}
      <label>Descrição<input id="cpe-desc" autocomplete="off" value="${crmEsc(c.descricao || '')}"></label>
      <label>Fornecedor / origem<input id="cpe-forn" autocomplete="off" value="${crmEsc(c.fornecedor_nome || '')}" placeholder="opcional"></label>
      <div class="fin-frow"><label>Valor (R$)<input type="number" step="0.01" min="0.01" id="cpe-valor" value="${(+c.valor_total || 0).toFixed(2)}"></label><label>Vencimento<input type="date" id="cpe-venc" value="${venc}"></label></div>
      <button type="submit" class="fin-btn-salvar">💾 Salvar alterações</button></form>`);
  $('modal-erp-box').classList.add('erp-ci');
  setTimeout(() => { const v = $('cpe-valor'); if (v) { v.focus(); v.select(); } }, 40);
  $('erp-form-cpedit').addEventListener('submit', async e => {
    e.preventDefault();
    const valor = parseFloat(($('cpe-valor').value || '').replace(',', '.'));
    if (!(valor > 0)) { toast('⚠ Valor inválido'); return; }
    const fornId = await resolverFornecedorId($('cpe-forn').value);   // acha ou cria (fica salvo)
    const body = { descricao: $('cpe-desc').value.trim(), valor_total: valor, data_vencimento: $('cpe-venc').value || null, fornecedor_id: fornId };
    const r = await (await fetch('/api/erp/contas-pagar/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    toast('💾 Conta atualizada'); fecharErpModal(); carregarContasPagar();
  });
}
function abrirPagarModal(contaId, restante) {
  const contasFin = finContas.filter(c => c.ativo);
  abrirErpModal(`<h3 class="erp-modal-tit">💵 Pagar conta</h3>
    <form id="erp-form-pagar" class="fin-form">
      <div class="erp-pagar-rest">Em aberto: <b>${fmt(restante)}</b></div>
      <div class="fin-frow"><label>Valor<input type="number" step="0.01" id="ep-valor" value="${(+restante).toFixed(2)}"></label><label>Forma<select id="ep-forma"><option>PIX</option><option>Dinheiro</option><option>Cartão</option><option>Banco</option><option>Boleto</option></select></label></div>
      <label>Conta financeira<select id="ep-conta">${contasFin.map(c => `<option value="${c.id}">${crmEsc(c.nome)}</option>`).join('')}</select></label>
      <label>Data<input type="date" id="ep-data"></label>
      <input type="hidden" id="ep-conta-id" value="${contaId}">
      <button type="submit" class="fin-btn-salvar">✅ Confirmar pagamento</button></form>`);
  $('modal-erp-box').classList.add('erp-ci');
  $('ep-data').value = new Date().toISOString().slice(0, 10);
  $('erp-form-pagar').addEventListener('submit', async e => {
    e.preventDefault();
    const valor = parseFloat($('ep-valor').value) || 0; if (valor <= 0) { toast('⚠ Valor inválido'); return; }
    const body = { valor, forma_pagamento: $('ep-forma').value, conta_id: +$('ep-conta').value, data: $('ep-data').value ? new Date($('ep-data').value + 'T12:00:00').toISOString() : undefined };
    const r = await (await fetch(`/api/erp/contas-pagar/${$('ep-conta-id').value}/pagar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    toast(`✅ Pago ${fmt(valor)} · ${({ aberto: 'em aberto', parcial: 'parcial', pago: 'quitado' }[r.status] || r.status)}`); fecharErpModal(); await finCarregarBase(); finRefreshAtual();
  });
}
// Soma i intervalos (mes/quinzena/semana) a uma data 'yyyy-mm-dd' e devolve 'yyyy-mm-dd'.
function cpAddIntervalo(base, tipo, i) {
  if (!base) return null;
  const [y, m, d] = base.split('-').map(Number);
  let dt;
  if (tipo === 'mes') dt = new Date(y, (m - 1) + i, d);
  else if (tipo === 'quinzena') dt = new Date(y, m - 1, d + 15 * i);
  else if (tipo === 'semana') dt = new Date(y, m - 1, d + 7 * i);
  else dt = new Date(y, m - 1, d);
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
// Acha o fornecedor pelo nome (ignora maiúsc/acento simples) ou CRIA um novo → fica salvo p/ próximas.
async function resolverFornecedorId(nome) {
  nome = (nome || '').trim(); if (!nome) return null;
  if (!erpFornecedoresCache.length) { try { erpFornecedoresCache = await erpGet('fornecedores'); } catch {} }
  const norm = s => (s || '').trim().toLowerCase();
  const ja = erpFornecedoresCache.find(f => norm(f.nome) === norm(nome));
  if (ja) return ja.id;
  try { const r = await (await fetch('/api/erp/fornecedores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome }) })).json(); if (r && r.id) { erpFornecedoresCache.push(r); return r.id; } } catch {}
  return null;
}
async function abrirContaAvulsaForm() {
  if (!erpFornecedoresCache.length) { try { erpFornecedoresCache = await erpGet('fornecedores'); } catch {} }
  const chips = erpFornecedoresCache.filter(f => f.ativo).map(f => `<button type="button" class="ecp-chip" data-nome="${crmEsc(f.nome)}">${crmEsc(f.nome)}</button>`).join('');
  abrirErpModal(`<h3 class="erp-modal-tit">➕ Nova conta a pagar</h3>
    <form id="erp-form-cp" class="fin-form">
      <label>Descrição<input id="ecp-desc" placeholder="ex.: Aluguel, energia, internet..."></label>
      <label>Fornecedor / origem do pagamento <small>(digite ou escolha — fica salvo p/ próximas)</small><input id="ecp-forn-nome" autocomplete="off" placeholder="ex.: Energia, Aluguel, Fornecedor X"></label>
      ${chips ? `<div class="ecp-chips" id="ecp-chips">${chips}</div>` : ''}
      <div class="fin-frow"><label>Valor de cada<input type="number" step="0.01" id="ecp-valor" placeholder="0,00"></label><label>1º vencimento<input type="date" id="ecp-venc"></label></div>
      <div class="fin-frow"><label>Parcelas (repetir o valor)<input type="number" min="1" step="1" id="ecp-parcelas" value="1"></label><label>Intervalo<select id="ecp-intervalo"><option value="mes" selected>Mensal</option><option value="quinzena">Quinzenal</option><option value="semana">Semanal</option></select></label></div>
      <div class="fin-hint" id="ecp-resumo">1 parcela.</div>
      <button type="submit" class="fin-btn-salvar">💾 Criar</button></form>`);
  $('modal-erp-box').classList.add('erp-ci');
  const chipsBox = $('ecp-chips'); if (chipsBox) chipsBox.querySelectorAll('.ecp-chip').forEach(b => b.addEventListener('click', () => { $('ecp-forn-nome').value = b.dataset.nome; }));
  const resumo = () => {
    const v = parseFloat($('ecp-valor').value) || 0;
    const n = Math.max(1, parseInt($('ecp-parcelas').value) || 1);
    const it = $('ecp-intervalo').value, base = $('ecp-venc').value;
    const rot = { mes: 'mês', quinzena: 'quinzena', semana: 'semana' }[it] || 'mês';
    let txt = n > 1 ? `${n} parcelas de ${fmt(v)} = <b>${fmt(v * n)}</b> (uma por ${rot})` : `1 parcela de ${fmt(v)}.`;
    if (n > 1 && base) txt += ` · 1º venc.: ${erpFmtData(cpAddIntervalo(base, it, 0))} · último: ${erpFmtData(cpAddIntervalo(base, it, n - 1))}`;
    $('ecp-resumo').innerHTML = txt;
  };
  ['ecp-valor', 'ecp-parcelas', 'ecp-intervalo', 'ecp-venc'].forEach(id => { const e = $(id); if (e) { e.addEventListener('input', resumo); e.addEventListener('change', resumo); } });
  $('erp-form-cp').addEventListener('submit', async e => {
    e.preventDefault();
    const valor = parseFloat($('ecp-valor').value) || 0; if (valor <= 0) { toast('⚠ Informe o valor'); return; }
    const n = Math.max(1, parseInt($('ecp-parcelas').value) || 1);
    const it = $('ecp-intervalo').value, base = $('ecp-venc').value || null;
    const descBase = $('ecp-desc').value.trim() || 'Conta a pagar';
    const forn = await resolverFornecedorId($('ecp-forn-nome').value);   // acha ou cria (fica salvo)
    let criadas = 0, erros = 0;
    for (let i = 0; i < n; i++) {
      const desc = n > 1 ? `${descBase} (${i + 1}/${n})` : descBase;
      const body = { descricao: desc, fornecedor_id: forn, valor_total: valor, data_vencimento: cpAddIntervalo(base, it, i) };
      const r = await (await fetch('/api/erp/contas-pagar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (r && r.erro) erros++; else criadas++;
    }
    if (criadas) toast(`✅ ${criadas > 1 ? criadas + ' parcelas criadas' : 'Conta criada'}${erros ? ` (${erros} falharam)` : ''}`);
    else toast('⚠ Não foi possível criar');
    fecharErpModal(); renderFinContasPagar();
  });
}
// Pagamento de funcionário → lança em Contas a pagar (com recorrência opcional: repete N meses).
async function abrirPagamentoFuncionario() {
  let funcs = [], vd = {};
  try { funcs = await (await fetch('/api/funcionarios', { cache: 'no-store' })).json(); } catch {}
  try { vd = await (await fetch('/api/vales?pendentes=1', { cache: 'no-store' })).json(); } catch {}
  const valesPorFunc = {}; ((vd && vd.vales) || []).forEach(v => { const k = (v.funcionario || '').trim().toLowerCase(); (valesPorFunc[k] || (valesPorFunc[k] = { total: 0, ids: [] })); valesPorFunc[k].total += +v.valor || 0; valesPorFunc[k].ids.push(v.id); });
  const ativos = (Array.isArray(funcs) ? funcs : []).filter(f => f.ativo !== 0 && f.ativo !== false);
  abrirErpModal(`<h3 class="erp-modal-tit">👤 Pagamento de funcionário</h3>
    <form id="erp-form-func" class="fin-form">
      <label>Funcionário<select id="efp-func">${ativos.map(f => `<option value="${crmEsc(f.nome)}">${crmEsc(f.nome)}</option>`).join('')}<option value="__outro">➕ Outro (digitar)</option></select></label>
      <label id="efp-outro-wrap" style="display:none">Nome<input id="efp-outro" placeholder="nome do funcionário"></label>
      <div class="fin-frow"><label>Valor<input type="number" step="0.01" id="efp-valor" placeholder="0,00"></label><label>1º vencimento<input type="date" id="efp-venc"></label></div>
      <div class="fin-frow"><label>Repetir (vezes)<input type="number" min="1" step="1" id="efp-parcelas" value="1"></label><label>A cada<select id="efp-intervalo"><option value="mes" selected>Mês</option><option value="quinzena">Quinzena</option><option value="semana">Semana</option></select></label></div>
      <label class="op-mov-fluxo" id="efp-vale-wrap" style="display:none"><input type="checkbox" id="efp-descontar" checked> Descontar <b id="efp-vale-tot"></b> de vale(s) pendente(s)</label>
      <div class="fin-hint" id="efp-resumo"></div>
      <button type="submit" class="fin-btn-salvar">💾 Lançar em Contas a pagar</button></form>`);
  $('modal-erp-box').classList.add('erp-ci');
  $('efp-venc').value = new Date().toISOString().slice(0, 10);
  if (!ativos.length) $('efp-func').value = '__outro';
  const outroWrap = $('efp-outro-wrap');
  const valeDoFunc = () => valesPorFunc[($('efp-func').value === '__outro' ? ($('efp-outro') || {}).value : $('efp-func').value || '').trim().toLowerCase()] || null;
  const syncOutro = () => { const o = $('efp-func').value === '__outro'; outroWrap.style.display = o ? '' : 'none'; if (o) $('efp-outro').focus();
    const v = valeDoFunc(), w = $('efp-vale-wrap'); if (w) { if (v && v.total > 0) { w.style.display = ''; $('efp-vale-tot').textContent = fmt(v.total); } else w.style.display = 'none'; } };
  syncOutro();
  const resumo = () => {
    const v = parseFloat($('efp-valor').value) || 0, n = Math.max(1, parseInt($('efp-parcelas').value) || 1);
    const it = $('efp-intervalo').value, base = $('efp-venc').value, rot = { mes: 'mês', quinzena: 'quinzena', semana: 'semana' }[it] || 'mês';
    let t = n > 1 ? `${n} pagamentos de ${fmt(v)} = <b>${fmt(v * n)}</b> (um por ${rot})` : `1 pagamento de ${fmt(v)}.`;
    if (n > 1 && base) t += ` · 1º: ${erpFmtData(cpAddIntervalo(base, it, 0))} · último: ${erpFmtData(cpAddIntervalo(base, it, n - 1))}`;
    $('efp-resumo').innerHTML = t;
  };
  $('efp-func').addEventListener('change', () => { syncOutro(); resumo(); });
  ['efp-valor', 'efp-parcelas', 'efp-intervalo', 'efp-venc', 'efp-outro'].forEach(id => { const e = $(id); if (e) { e.addEventListener('input', resumo); e.addEventListener('change', resumo); } });
  resumo();
  $('erp-form-func').addEventListener('submit', async e => {
    e.preventDefault();
    const nome = ($('efp-func').value === '__outro' ? $('efp-outro').value.trim() : $('efp-func').value);
    if (!nome) { toast('⚠ Escolha ou digite o funcionário'); return; }
    const valor = parseFloat($('efp-valor').value) || 0; if (valor <= 0) { toast('⚠ Informe o valor'); return; }
    const n = Math.max(1, parseInt($('efp-parcelas').value) || 1), it = $('efp-intervalo').value, base = $('efp-venc').value || null;
    // desconto de vale: só se marcado e o funcionário tem vale pendente (abate da 1ª parcela)
    const vinfo = valeDoFunc();
    const descontar = !!(vinfo && vinfo.total > 0 && $('efp-vale-wrap') && $('efp-vale-wrap').style.display !== 'none' && $('efp-descontar') && $('efp-descontar').checked);
    const valeTot = descontar ? Math.min(vinfo.total, valor) : 0;
    let criadas = 0, erros = 0;
    for (let i = 0; i < n; i++) {
      const vParc = i === 0 ? Math.round((valor - valeTot) * 100) / 100 : valor;
      const desc = `👤 Pagamento — ${nome}${n > 1 ? ` (${i + 1}/${n})` : ''}${i === 0 && valeTot > 0 ? ` (− vale ${fmt(valeTot)})` : ''}`;
      const body = { descricao: desc, fornecedor_id: null, valor_total: vParc, data_vencimento: cpAddIntervalo(base, it, i) };
      const r = await (await fetch('/api/erp/contas-pagar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (r && r.erro) erros++; else criadas++;
    }
    if (descontar) { for (const vid of vinfo.ids) { try { await fetch('/api/vales/' + vid + '/descontar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch {} } }
    if (criadas) toast(`✅ ${criadas > 1 ? criadas + ' pagamentos lançados' : 'Pagamento lançado'}${valeTot > 0 ? ` (− ${fmt(valeTot)} de vale)` : ''}${erros ? ` (${erros} falharam)` : ''}`);
    else toast('⚠ Não foi possível lançar');
    fecharErpModal(); if (finSecao === 'contas_pagar') renderFinContasPagar();
  });
}
// 🤝 Vale / adiantamento: sai do caixa (fluxo) agora e fica pendente pra descontar no pagamento.
async function abrirValeFuncionario() {
  let funcs = [], vd = {};
  try { funcs = await (await fetch('/api/funcionarios', { cache: 'no-store' })).json(); } catch {}
  try { vd = await (await fetch('/api/vales?pendentes=1', { cache: 'no-store' })).json(); } catch {}
  const pend = {}; ((vd && vd.pendentesPorFunc) || []).forEach(p => { pend[(p.funcionario || '').trim().toLowerCase()] = p; });
  const ativos = (Array.isArray(funcs) ? funcs : []).filter(f => f.ativo !== 0 && f.ativo !== false);
  abrirErpModal(`<h3 class="erp-modal-tit">🤝 Vale / adiantamento</h3>
    <form id="erp-form-vale" class="fin-form">
      <label>Funcionário<select id="evl-func">${ativos.map(f => `<option value="${crmEsc(f.nome)}">${crmEsc(f.nome)}</option>`).join('')}<option value="__outro">➕ Outro (digitar)</option></select></label>
      <label id="evl-outro-wrap" style="display:none">Nome<input id="evl-outro" placeholder="nome do funcionário"></label>
      <div class="fin-frow"><label>Valor do vale<input type="number" step="0.01" id="evl-valor" placeholder="0,00"></label><label>Data<input type="date" id="evl-data"></label></div>
      <label>Observação<input id="evl-obs" placeholder="opcional"></label>
      <div class="fin-hint" id="evl-pend"></div>
      <button type="submit" class="fin-btn-salvar">🤝 Dar vale (sai do caixa)</button></form>`);
  $('modal-erp-box').classList.add('erp-ci');
  $('evl-data').value = new Date().toISOString().slice(0, 10);
  if (!ativos.length) $('evl-func').value = '__outro';
  const outroWrap = $('evl-outro-wrap');
  const syncOutro = () => { const o = $('evl-func').value === '__outro'; outroWrap.style.display = o ? '' : 'none'; if (o) $('evl-outro').focus(); };
  const mostraPend = () => { const nome = ($('evl-func').value === '__outro' ? ($('evl-outro') || {}).value : $('evl-func').value || '').trim().toLowerCase(); const p = pend[nome]; $('evl-pend').innerHTML = p ? `⚠ ${crmEsc(nome)} já tem <b>${fmt(p.t)}</b> em vale(s) pendente(s) (${p.n}) — pra descontar no próximo pagamento.` : ''; };
  syncOutro(); mostraPend();
  $('evl-func').addEventListener('change', () => { syncOutro(); mostraPend(); });
  { const eo = $('evl-outro'); if (eo) eo.addEventListener('input', mostraPend); }
  $('erp-form-vale').addEventListener('submit', async e => {
    e.preventDefault();
    const nome = ($('evl-func').value === '__outro' ? $('evl-outro').value.trim() : $('evl-func').value);
    if (!nome) { toast('⚠ Escolha o funcionário'); return; }
    const valor = parseFloat($('evl-valor').value) || 0; if (valor <= 0) { toast('⚠ Informe o valor'); return; }
    const body = { funcionario: nome, valor, data: $('evl-data').value || null, obs: $('evl-obs').value.trim() };
    const r = await (await fetch('/api/vales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    toast(`🤝 Vale de ${fmt(valor)} pra ${nome} — saiu do caixa`); fecharErpModal();
    if ($('tela-financeiro') && $('tela-financeiro').classList.contains('ativa') && typeof finCarregarBase === 'function') { try { await finCarregarBase(); } catch {} }
    if (finSecao === 'contas_pagar') renderFinContasPagar();
  });
}

// Ações delegadas do ERP (separado do handler de data-fin-acao)
$('fin-conteudo').addEventListener('click', async e => {
  const b = e.target.closest('[data-erp-acao]'); if (!b) return;
  const acao = b.dataset.erpAcao, id = b.dataset.id;
  if (acao === 'forn-novo') abrirFornecedorForm();
  else if (acao === 'forn-ver') renderFornecedorDetalhe(id);
  else if (acao === 'forn-voltar') renderFinFornecedores();
  else if (acao === 'forn-editar') { try { abrirFornecedorForm(await erpGet('fornecedores/' + id)); } catch {} }
  else if (acao === 'compra-nova') abrirCompraForm();
  else if (acao === 'compra-ver') renderCompraDetalhe(id);
  else if (acao === 'compra-voltar' || acao === 'compra-voltar-lista') renderFinCompras();
  else if (acao === 'compra-filtrar') carregarComprasLista();
  else if (acao === 'compra-relatorios') renderCompraRelatorios();
  else if (acao === 'compra-cancelar') { if (!confirm('Cancelar esta compra? O estoque volta, a conta a pagar é cancelada e os pagamentos são estornados.')) return; const r = await (await fetch('/api/erp/compras/' + id + '/cancelar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json(); if (r.erro) { toast('⚠ ' + r.erro); return; } toast('🚫 Compra cancelada'); await finCarregarBase(); renderCompraDetalhe(id); }
  else if (acao === 'cp-pagar') abrirPagarModal(id, +b.dataset.rest || 0);
  else if (acao === 'cp-pagar-acai') {
    const aid = b.dataset.acaiid; if (!aid) return;
    if (!confirm('Pagar esta compra de açaí agora? (entra como saída no fluxo de caixa)')) return;
    const hoje = new Date().toISOString().slice(0, 10);
    const r = await (await fetch('/api/compras-acai/' + aid + '/pagar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forma_pagamento: 'Dinheiro', data_pagamento: hoje }) })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    toast('✅ Açaí pago · saiu no fluxo de caixa e foi pra Contas pagas'); await finCarregarBase(); carregarContasPagar();
  }
  else if (acao === 'cp-nova') abrirContaAvulsaForm();
  else if (acao === 'cp-func') abrirPagamentoFuncionario();
  else if (acao === 'cp-vale') abrirValeFuncionario();
  else if (acao === 'cp-editar') abrirEditarContaPagar(+id);
  else if (acao === 'cp-excluir') {
    const c = (cpContasCache || []).find(x => x.id === +id);
    if (!confirm(`Excluir de vez esta conta a pagar?\n\n${c ? (c.descricao || '') + ' · ' + fmt(c.valor_total) : ''}\n\nSó faça isso se foi lançada por engano.`)) return;
    const r = await (await fetch('/api/erp/contas-pagar/' + id, { method: 'DELETE' })).json();
    if (r && r.erro) { toast('⚠ ' + r.erro); return; }
    toast('🗑 Conta excluída'); carregarContasPagar();
  }
  else if (acao === 'cp-abrir') finIr('contas_pagar');
  else if (acao === 'cp-filtrar') carregarContasPagar();
  else if (acao === 'receb-novo') abrirRecebimentoModal(id);
  else if (acao === 'receb-aprovar') { const r = await (await fetch('/api/erp/recebimentos/' + id + '/aprovar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json(); if (r.erro) { toast('⚠ ' + r.erro); return; } toast('✅ Recebimento aprovado'); await finCarregarBase(); renderCompraDetalhe(erpCompraAberta); }
  else if (acao === 'receb-recusar') { const motivo = prompt('Motivo da recusa deste recebimento:'); if (motivo === null) return; const r = await (await fetch('/api/erp/recebimentos/' + id + '/recusar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo }) })).json(); if (r.erro) { toast('⚠ ' + r.erro); return; } toast('✕ Recebimento recusado'); renderCompraDetalhe(erpCompraAberta); }
  else if (acao === 'receb-estornar') { if (!confirm('Estornar este recebimento? O estoque volta, o lote é cancelado e a conta a pagar dele é removida.')) return; const r = await (await fetch('/api/erp/recebimentos/' + id + '/estornar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json(); if (r.erro) { toast('⚠ ' + r.erro); return; } toast('↩️ Recebimento estornado'); await finCarregarBase(); renderCompraDetalhe(erpCompraAberta); }
});

/* ══════════════════════════════════════════════════════════════════════════
   FASE 33 — CONTAS A RECEBER, COBRANÇAS E INADIMPLÊNCIA (frontend)
   Camada de gestão sobre o Fiado (clientes_extrato). Reusa finCard/biTabela/
   finBox/abrirErpModal/toast. Receber reusa o mesmo caminho de pagamento de
   fiado → sincroniza no financeiro sem duplicar. ══════════════════════════ */
let crAba = 'carteira';
const crGet = async (rota) => (await fetch('/api/receber/' + rota, { cache: 'no-store' })).json();
const crStatusChip = (s) => ({ pago: '<span class="cr-st pago">✅ Pago</span>', vencido: '<span class="cr-st venc">⛔ Vencido</span>', a_vencer: '<span class="cr-st aberto">🕒 A vencer</span>' }[s] || s);
const crBucketLabel = (b) => ({ a_vencer: 'A vencer', d1_30: '1–30 dias', d31_60: '31–60 dias', d61_90: '61–90 dias', d90_mais: '90+ dias' }[b] || b);
const crDataBR = (d) => { if (!d) return '—'; const [a, m, dia] = String(d).slice(0, 10).split('-'); return `${dia}/${m}/${a}`; };

async function renderFinReceber() {
  const el = $('fin-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await crGet('dashboard'); } catch { el.innerHTML = biErro(); return; }
  const r = d.resumo;
  const abas = [['carteira', '📊 Carteira'], ['titulos', '📄 Títulos'], ['inadimplencia', '⛔ Inadimplência'], ['cobrancas', '📣 Cobranças'], ['regua', '📅 Régua'], ['relatorios', '📈 Relatórios'], ['config', '⚙️ Config']];
  el.innerHTML = `
    <div class="erp-topo"><h2 class="erp-h2">📥 Contas a Receber</h2><span class="fin-flex"></span></div>
    <div class="fin-cards">
      ${finCard('📥', fmt(r.total), 'Total a receber')}
      ${finCard('⛔', fmt(r.vencido), 'Vencido', r.clientes_inadimplentes ? `${r.clientes_inadimplentes} cliente(s)` : '', r.vencido > 0 ? 'neg' : '')}
      ${finCard('🕒', fmt(r.a_vencer), 'A vencer')}
      ${finCard('💰', fmt(d.recebido_mes), 'Recebido no mês')}
      ${finCard('🔔', fmt(d.vencendo_total), 'Vencendo em breve', d.vencendo_qtd ? `${d.vencendo_qtd} título(s)` : '')}
    </div>
    <div class="cr-abas">${abas.map(a => `<button class="cr-aba ${crAba === a[0] ? 'ativo' : ''}" data-cr-acao="aba" data-aba="${a[0]}">${a[1]}</button>`).join('')}</div>
    <div id="cr-conteudo">${biLoading()}</div>`;
  crRenderAba(d);
}
function crRenderAba(dash) {
  const R = { carteira: () => crRenderCarteira(dash), titulos: crRenderTitulos, inadimplencia: crRenderInadimplencia,
    cobrancas: crRenderCobrancas, regua: crRenderRegua, relatorios: crRenderRelatorios, config: crRenderConfig };
  (R[crAba] || R.carteira)();
}

async function crRenderCarteira(dash) {
  const box = $('cr-conteudo');
  let d = dash; if (!d) { try { d = await crGet('dashboard'); } catch { box.innerHTML = biErro(); return; } }
  const ag = d.resumo.aging;
  const faixas = [['a_vencer', ag.a_vencer], ['d1_30', ag.d1_30], ['d31_60', ag.d31_60], ['d61_90', ag.d61_90], ['d90_mais', ag.d90_mais]];
  const max = Math.max(1, ...faixas.map(f => f[1]));
  const barras = faixas.map(f => `<div class="cr-aging-linha"><span class="cr-aging-lbl">${crBucketLabel(f[0])}</span>
    <span class="cr-aging-barra"><span class="cr-aging-fill ${f[0] === 'a_vencer' ? 'ok' : 'ruim'}" style="width:${Math.round(f[1] / max * 100)}%"></span></span>
    <span class="cr-aging-val">${fmt(f[1])}</span></div>`).join('');
  const devRows = (d.maiores_devedores || []).map(c => [crmEsc(c.cliente_nome), fmt(c.total), c.vencido > 0 ? `<span class="cr-st venc">${fmt(c.vencido)}</span>` : '—',
    `<button class="fin-mini" data-cr-acao="cliente" data-id="${c.cliente_id}">👁 Ver</button> ${finPodeLancar() ? `<button class="fin-mini" data-cr-acao="receber" data-id="${c.cliente_id}" data-rest="${c.total}">💵 Receber</button>` : ''}`]);
  box.innerHTML = `
    <div class="cr-2col">
      ${finBox('📊 Aging da carteira', `<div class="cr-aging">${barras}</div>`)}
      ${finBox('🏆 Maiores devedores', biTabela([{ h: 'Cliente' }, { h: 'Deve', cls: 'num' }, { h: 'Vencido', cls: 'num' }, { h: '' }], devRows, 'Ninguém devendo. 🎉'))}
    </div>`;
}

async function crRenderTitulos() {
  const box = $('cr-conteudo');
  box.innerHTML = `
    <div class="fin-filtros">
      <label>Status<select id="cr-f-status"><option value="">Todos abertos</option><option value="a_vencer">A vencer</option><option value="vencido">Vencido</option><option value="pago">Pago</option></select></label>
      <label>Buscar<input id="cr-f-busca" placeholder="cliente / descrição"></label>
      <button class="fin-btn-filtrar" data-cr-acao="titulos-filtrar">🔎 Filtrar</button>
    </div>
    <div id="cr-titulos-lista">${biLoading()}</div>`;
  crCarregarTitulos();
}
async function crCarregarTitulos() {
  const st = $('cr-f-status') ? $('cr-f-status').value : '';
  const busca = $('cr-f-busca') ? $('cr-f-busca').value.trim() : '';
  const q = new URLSearchParams(); if (st) q.set('status', st); else q.set('abertos', '1'); if (busca) q.set('busca', busca);
  let d; try { d = await crGet('titulos?' + q); } catch { $('cr-titulos-lista').innerHTML = biErro(); return; }
  const rows = d.titulos.map(t => [crmEsc(t.cliente_nome), crmEsc(t.descricao || '—'), crDataBR(t.vencimento),
    fmt(t.valor), fmt(t.valor_pago), fmt(t.restante), crStatusChip(t.status) + (t.dias_atraso ? ` <small>${t.dias_atraso}d</small>` : ''),
    finPodeLancar() && t.status !== 'pago' ? `<button class="fin-mini" data-cr-acao="receber" data-id="${t.cliente_id}" data-ext="${t.extrato_id}" data-rest="${t.restante}">💵</button>
       <button class="fin-mini" data-cr-acao="venc" data-ext="${t.extrato_id}" data-venc="${t.vencimento || ''}">📅</button>` : '']);
  $('cr-titulos-lista').innerHTML = `<div class="cr-resumo-chip">Em aberto no filtro: <b>${fmt(d.resumo.total)}</b> · vencido <b>${fmt(d.resumo.vencido)}</b></div>` +
    biTabela([{ h: 'Cliente' }, { h: 'Título' }, { h: 'Vencimento' }, { h: 'Valor', cls: 'num' }, { h: 'Pago', cls: 'num' }, { h: 'Aberto', cls: 'num' }, { h: 'Status' }, { h: '' }], rows, 'Nenhum título no filtro.');
}

async function crRenderInadimplencia() {
  const box = $('cr-conteudo'); box.innerHTML = biLoading();
  let d; try { d = await crGet('inadimplencia'); } catch { box.innerHTML = biErro(); return; }
  const rows = d.clientes.map(c => [crmEsc(c.cliente_nome), fmtTelefone(c.cliente_telefone || ''), fmt(c.total), `${c.titulos}`,
    `<span class="cr-st venc">${c.maior_atraso}d</span>`, crBucketLabel(c.bucket), c.ultima_cobranca ? crDataBR(c.ultima_cobranca) : '<small>nunca</small>',
    `<button class="fin-mini" data-cr-acao="cliente" data-id="${c.cliente_id}">👁</button>${finPodeLancar() ? `
     <button class="fin-mini" data-cr-acao="receber" data-id="${c.cliente_id}" data-rest="${c.total}">💵</button>
     <button class="fin-mini" data-cr-acao="cobrar" data-id="${c.cliente_id}">📣</button>` : ''}`]);
  box.innerHTML = `<div class="cr-resumo-chip vermelho">Total vencido: <b>${fmt(d.total)}</b> · ${d.qtd} cliente(s) inadimplente(s)</div>` +
    biTabela([{ h: 'Cliente' }, { h: 'Telefone' }, { h: 'Vencido', cls: 'num' }, { h: 'Títulos', cls: 'num' }, { h: 'Atraso' }, { h: 'Faixa' }, { h: 'Últ. cobrança' }, { h: '' }], rows, 'Nenhum inadimplente. 🎉');
}

async function crRenderCobrancas() {
  const box = $('cr-conteudo'); box.innerHTML = biLoading();
  let lista; try { lista = await crGet('cobrancas'); } catch { box.innerHTML = biErro(); return; }
  const canalIco = { whatsapp: '💬', telefone: '📞', presencial: '🤝', email: '✉️', outro: '📌' };
  const stChip = { pendente: 'aberto', enviada: 'aberto', prometido: 'aberto', pago: 'pago', cancelada: 'venc' };
  const rows = lista.map(c => [crDataBR(c.criado_em), crmEsc(c.cliente_nome), (canalIco[c.canal] || '') + ' ' + (c.canal || ''),
    `<span class="cr-st ${stChip[c.status] || 'aberto'}">${c.status}</span>`, c.promessa_data ? crDataBR(c.promessa_data) : '—', crmEsc(c.resultado || c.obs || ''),
    finPodeLancar() ? `<button class="fin-mini" data-cr-acao="cobranca-status" data-id="${c.id}" data-st="pago">✅</button>
       <button class="fin-mini" data-cr-acao="cobranca-del" data-id="${c.id}">🗑</button>` : '']);
  box.innerHTML = `<div class="erp-topo"><span class="fin-flex"></span>${finPodeLancar() ? '<button class="fin-mini" data-cr-acao="cobrar">➕ Registrar cobrança</button>' : ''}</div>` +
    biTabela([{ h: 'Data' }, { h: 'Cliente' }, { h: 'Canal' }, { h: 'Status' }, { h: 'Promessa' }, { h: 'Resultado' }, { h: '' }], rows, 'Nenhuma cobrança registrada.');
}

async function crRenderRegua() {
  const box = $('cr-conteudo'); box.innerHTML = biLoading();
  let d; try { d = await crGet('regua'); } catch { box.innerHTML = biErro(); return; }
  const linhaTit = (t, motivo) => [crmEsc(t.cliente_nome), crmEsc(t.descricao || '—'), crDataBR(t.vencimento), fmt(t.restante), motivo,
    t.dias_ultima_cobranca >= 999 ? '<small>nunca</small>' : `${t.dias_ultima_cobranca}d`,
    finPodeLancar() ? `<button class="fin-mini" data-cr-acao="cobrar" data-id="${t.cliente_id}">📣 Cobrar</button>
      <button class="fin-mini" data-cr-acao="receber" data-id="${t.cliente_id}" data-ext="${t.extrato_id}" data-rest="${t.restante}">💵</button>` : ''];
  const venc = d.vencidos.map(t => linhaTit(t, `⛔ vencido ${t.dias_atraso}d`));
  const aVencer = d.a_vencer.map(t => linhaTit(t, `🕒 vence em ${t.dias_para_vencer}d`));
  const cols = [{ h: 'Cliente' }, { h: 'Título' }, { h: 'Vencimento' }, { h: 'Aberto', cls: 'num' }, { h: 'Motivo' }, { h: 'Últ. cobrança' }, { h: '' }];
  box.innerHTML = `<p class="cr-hint">Sugestões automáticas: títulos a vencer em breve e vencidos sem cobrança recente (config: dias de alerta prévio).</p>
    ${finBox('⛔ Vencidos p/ cobrar', biTabela(cols, venc, 'Nenhum vencido pendente de cobrança. 🎉'))}
    ${finBox('🕒 Vencendo em breve', biTabela(cols, aVencer, 'Nada vencendo no período.'))}`;
}

function crRenderRelatorios() {
  const box = $('cr-conteudo');
  const rel = [['posicao', '📄 Posição da carteira'], ['aging', '📊 Aging'], ['inadimplencia', '⛔ Inadimplência'], ['recebimentos', '💰 Recebimentos do mês'], ['cobrancas', '📣 Cobranças']];
  box.innerHTML = `<p class="cr-hint">Baixe cada relatório em CSV (abre no Excel).</p><div class="cr-rel-grid">${rel.map(r => `<div class="cr-rel-card"><span>${r[1]}</span><a class="fin-mini" href="/api/receber/relatorios/${r[0]}?csv=1" target="_blank">⬇️ CSV</a></div>`).join('')}</div>`;
}

async function crRenderConfig() {
  const box = $('cr-conteudo'); box.innerHTML = biLoading();
  let c; try { c = await crGet('config'); } catch { box.innerHTML = biErro(); return; }
  const dis = finPodeLancar() ? '' : 'disabled';
  box.innerHTML = finBox('⚙️ Configurações de Contas a Receber', `
    <form id="cr-form-config" class="fin-form">
      <div class="fin-frow"><label>Prazo padrão do fiado (dias)<input type="number" id="cr-cfg-prazo" value="${c.prazo_padrao_dias}" ${dis}></label>
        <label>Dias de alerta prévio<input type="number" id="cr-cfg-alerta" value="${c.dias_alerta_previo}" ${dis}></label></div>
      <div class="fin-frow"><label>Juros ao mês (%)<input type="number" step="0.01" id="cr-cfg-juros" value="${c.juros_mes}" ${dis}></label>
        <label>Multa por atraso (%)<input type="number" step="0.01" id="cr-cfg-multa" value="${c.multa_pct}" ${dis}></label></div>
      <div class="fin-frow"><label>Limite de crédito padrão (R$)<input type="number" step="0.01" id="cr-cfg-limite" value="${c.limite_padrao}" ${dis}></label>
        <label class="cr-switch-lbl">Bloqueio automático se vencido<input type="checkbox" id="cr-cfg-bloqueio" ${c.bloqueio_automatico ? 'checked' : ''} ${dis}></label></div>
      ${finPodeLancar() ? '<button type="submit" class="fin-btn-salvar">💾 Salvar configurações</button>' : '<p class="cr-hint">Somente administrador/supervisor edita.</p>'}
    </form>`);
  if (finPodeLancar()) $('cr-form-config').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { prazo_padrao_dias: +$('cr-cfg-prazo').value || 0, dias_alerta_previo: +$('cr-cfg-alerta').value || 0,
      juros_mes: parseFloat($('cr-cfg-juros').value) || 0, multa_pct: parseFloat($('cr-cfg-multa').value) || 0,
      limite_padrao: parseFloat($('cr-cfg-limite').value) || 0, bloqueio_automatico: $('cr-cfg-bloqueio').checked };
    const r = await (await fetch('/api/receber/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; } toast('✅ Configurações salvas');
  });
}

// ── Modais ────────────────────────────────────────────────────────────────
async function crAbrirReceber(clienteId, restanteMax, extratoId) {
  let info; try { info = await crGet('cliente/' + clienteId); } catch { toast('⚠ Falha ao carregar cliente'); return; }
  const saldo = info.credito.saldo;
  const rest = Math.min(+restanteMax || saldo, saldo);
  abrirErpModal(`<h3 class="erp-modal-tit">💵 Receber de ${crmEsc(info.cliente.nome)}</h3>
    <form id="cr-form-receber" class="fin-form">
      <div class="erp-pagar-rest">Saldo devedor: <b>${fmt(saldo)}</b>${extratoId ? ` · título #${extratoId}` : ''}</div>
      <div class="fin-frow"><label>Valor<input type="number" step="0.01" id="cr-rc-valor" value="${(+rest).toFixed(2)}"></label>
        <label>Forma<select id="cr-rc-forma"><option>Dinheiro</option><option>PIX</option><option>Débito</option><option>Crédito</option></select></label></div>
      <input type="hidden" id="cr-rc-cli" value="${clienteId}"><input type="hidden" id="cr-rc-ext" value="${extratoId || ''}">
      <button type="submit" class="fin-btn-salvar">✅ Confirmar recebimento</button></form>`);
  $('cr-form-receber').addEventListener('submit', async e => {
    e.preventDefault();
    const valor = parseFloat($('cr-rc-valor').value) || 0; if (valor <= 0) { toast('⚠ Valor inválido'); return; }
    const body = { cliente_id: +$('cr-rc-cli').value, valor, formas: [{ nome: $('cr-rc-forma').value, valor }],
      extrato_id: $('cr-rc-ext').value ? +$('cr-rc-ext').value : undefined, client_request_id: 'cr-' + Date.now() + '-' + Math.random().toString(36).slice(2) };
    const r = await (await fetch('/api/receber/pagar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    toast(`✅ Recebido ${fmt(valor)} · saldo ${fmt(r.saldo)}`); fecharErpModal(); renderFinReceber();
  });
}
async function crAbrirCobranca(clienteId) {
  let info; try { info = await crGet('cliente/' + clienteId); } catch { toast('⚠ Falha ao carregar cliente'); return; }
  abrirErpModal(`<h3 class="erp-modal-tit">📣 Registrar cobrança — ${crmEsc(info.cliente.nome)}</h3>
    <form id="cr-form-cobranca" class="fin-form">
      <div class="erp-pagar-rest">Deve: <b>${fmt(info.credito.saldo)}</b> · vencido <b>${fmt(info.credito.vencido)}</b></div>
      <div class="fin-frow"><label>Canal<select id="cr-cb-canal"><option value="whatsapp">💬 WhatsApp</option><option value="telefone">📞 Telefone</option><option value="presencial">🤝 Presencial</option><option value="email">✉️ E-mail</option><option value="outro">📌 Outro</option></select></label>
        <label>Situação<select id="cr-cb-status"><option value="enviada">Enviada/Contatado</option><option value="prometido">Prometeu pagar</option><option value="pendente">Pendente</option></select></label></div>
      <label>Promessa de pagamento<input type="date" id="cr-cb-promessa"></label>
      <label>Observação / resultado<input id="cr-cb-obs" placeholder="ex.: falei com o cliente, paga sexta"></label>
      <input type="hidden" id="cr-cb-cli" value="${clienteId}">
      <button type="submit" class="fin-btn-salvar">💾 Registrar cobrança</button></form>`);
  $('cr-form-cobranca').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { cliente_id: +$('cr-cb-cli').value, canal: $('cr-cb-canal').value, status: $('cr-cb-status').value,
      promessa_data: $('cr-cb-promessa').value || null, obs: $('cr-cb-obs').value.trim(), resultado: $('cr-cb-obs').value.trim() };
    const r = await (await fetch('/api/receber/cobrancas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; } toast('✅ Cobrança registrada'); fecharErpModal(); if (crAba === 'cobrancas' || crAba === 'inadimplencia' || crAba === 'regua') crRenderAba();
  });
}
async function crAbrirCliente(clienteId) {
  let info; try { info = await crGet('cliente/' + clienteId); } catch { toast('⚠ Falha'); return; }
  const c = info.cliente, cr = info.credito;
  const titRows = info.titulos.filter(t => t.status !== 'pago').map(t => [crmEsc(t.descricao || '—'), crDataBR(t.vencimento), fmt(t.restante), crStatusChip(t.status)]);
  const limInfo = cr.limite > 0 ? `${fmt(cr.limite)} (disp. ${fmt(cr.disponivel)})` : 'sem limite';
  abrirErpModal(`<h3 class="erp-modal-tit">👤 ${crmEsc(c.nome)}</h3>
    <div class="cr-cli-cred">
      <span>Deve: <b>${fmt(cr.saldo)}</b></span><span>Vencido: <b class="${cr.vencido > 0 ? 'cr-neg' : ''}">${fmt(cr.vencido)}</b></span>
      <span>Limite: <b>${limInfo}</b></span>${cr.bloqueado ? '<span class="cr-st venc">🔒 Bloqueado</span>' : ''}
    </div>
    ${finPodeLancar() ? `<form id="cr-form-limite" class="fin-form cr-form-inline">
      <label>Limite de crédito<input type="number" step="0.01" id="cr-lim" value="${cr.limite}"></label>
      <label class="cr-switch-lbl">Bloquear<input type="checkbox" id="cr-blq" ${cr.bloqueado_manual ? 'checked' : ''}></label>
      <button type="submit" class="fin-mini">💾 Salvar crédito</button></form>` : ''}
    <h4 class="cr-sub">Títulos em aberto</h4>
    ${biTabela([{ h: 'Título' }, { h: 'Vencimento' }, { h: 'Aberto', cls: 'num' }, { h: 'Status' }], titRows, 'Sem títulos em aberto.')}
    ${finPodeLancar() && cr.saldo > 0 ? `<button class="fin-btn-salvar" data-cr-acao="receber" data-id="${clienteId}" data-rest="${cr.saldo}">💵 Receber</button>` : ''}`);
  if (finPodeLancar()) { const f = $('cr-form-limite'); if (f) f.addEventListener('submit', async e => {
    e.preventDefault();
    const r = await (await fetch(`/api/clientes/${clienteId}/credito`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limite_credito: parseFloat($('cr-lim').value) || 0, bloqueado: $('cr-blq').checked }) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; } toast('✅ Crédito atualizado'); fecharErpModal();
  }); }
}
function crAbrirVencimento(extratoId, atual) {
  abrirErpModal(`<h3 class="erp-modal-tit">📅 Vencimento do título #${extratoId}</h3>
    <form id="cr-form-venc" class="fin-form">
      <label>Data de vencimento<input type="date" id="cr-venc-data" value="${atual || ''}"></label>
      <p class="cr-hint">Deixe vazio para remover o vencimento.</p>
      <button type="submit" class="fin-btn-salvar">💾 Salvar</button></form>`);
  $('cr-form-venc').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await (await fetch(`/api/receber/titulos/${extratoId}/vencimento`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vencimento: $('cr-venc-data').value || null }) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; } toast('✅ Vencimento salvo'); fecharErpModal(); if (crAba === 'titulos') crCarregarTitulos();
  });
}

// Handler delegado do módulo Contas a Receber
$('fin-conteudo').addEventListener('click', async e => {
  const b = e.target.closest('[data-cr-acao]'); if (!b) return;
  const acao = b.dataset.crAcao, id = b.dataset.id;
  if (acao === 'aba') { crAba = b.dataset.aba; document.querySelectorAll('.cr-aba').forEach(x => x.classList.toggle('ativo', x.dataset.aba === crAba)); $('cr-conteudo').innerHTML = biLoading(); crRenderAba(); }
  else if (acao === 'titulos-filtrar') crCarregarTitulos();
  else if (acao === 'receber') crAbrirReceber(+id, +b.dataset.rest || 0, b.dataset.ext ? +b.dataset.ext : undefined);
  else if (acao === 'cobrar') crAbrirCobranca(+id);
  else if (acao === 'cliente') crAbrirCliente(+id);
  else if (acao === 'venc') crAbrirVencimento(+b.dataset.ext, b.dataset.venc);
  else if (acao === 'cobranca-status') { await fetch(`/api/receber/cobrancas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: b.dataset.st }) }); toast('✅ Cobrança atualizada'); crRenderAba(); }
  else if (acao === 'cobranca-del') { if (!confirm('Excluir esta cobrança?')) return; await fetch(`/api/receber/cobrancas/${id}`, { method: 'DELETE' }); toast('🗑 Excluída'); crRenderAba(); }
});


/* ══════════════════════════════════════════════════════════════════════════
   CONCILIAÇÃO DE CAIXA (Fase 27). Histórico de sessões fechadas × esperado por
   conta. (A tela de fechamento por sessão foi aposentada na #5 — o fechamento
   oficial agora é a Conferência por forma/maquininha, ver renderFinConferencia.)
   ══════════════════════════════════════════════════════════════════════════ */
function renderFinConciliacao() {
  const el = $('fin-conteudo');
  el.innerHTML = `
    <div class="fin-filtros">
      <label>De<input type="date" id="cc-de"></label>
      <label>Até<input type="date" id="cc-ate"></label>
      <label>Conta<select id="cc-conta"><option value="">Todas</option>${finContas.map(c => `<option value="${c.id}">${crmEsc(c.nome)}</option>`).join('')}</select></label>
      <button class="fin-btn-filtrar" id="cc-filtrar">🔎 Filtrar</button>
    </div>
    <div id="cc-lista">${biLoading()}</div>`;
  $('cc-filtrar').addEventListener('click', carregarConciliacao);
  carregarConciliacao();
}
async function carregarConciliacao() {
  const q = new URLSearchParams();
  if ($('cc-de').value) q.set('de', $('cc-de').value);
  if ($('cc-ate').value) q.set('ate', $('cc-ate').value);
  if ($('cc-conta').value) q.set('conta_id', $('cc-conta').value);
  let d; try { d = await (await fetch('/api/caixa/conciliacao?' + q, { cache: 'no-store' })).json(); } catch { $('cc-lista').innerHTML = biErro(); return; }
  const rows = d.linhas.map(l => {
    const conf = Math.round(((l.esperado || 0) + (l.diferenca || 0)) * 100) / 100;
    return [crmEsc(nomeOp(l.operador)), fmtDataHora(l.aberto_em), fmt(l.esperado), fmt(conf),
      `<span class="fin-val ${(l.diferenca || 0) === 0 ? '' : (l.diferenca > 0 ? 'entrada' : 'saida')}">${fmt(l.diferenca)}</span>`,
      `<span class="cc-sit cc-sit-${l.situacao}">${({ ok: '✅ OK', sobra: '🔵 Sobra', falta: '🔴 Falta' }[l.situacao] || l.situacao)}</span>`];
  });
  $('cc-lista').innerHTML = `<div class="fin-fluxo-topo">Limite de diferença: <b>${fmt(d.limite)}</b> · diferença acumulada: <b>${fmt(d.totalDiferenca)}</b></div>` +
    biTabela([{ h: 'Operador' }, { h: 'Abertura' }, { h: 'Registrado', cls: 'num' }, { h: 'Conferido', cls: 'num' }, { h: 'Diferença', cls: 'num' }, { h: 'Situação' }], rows, 'Nenhuma conciliação no filtro.');
}

/* ══════════════════════════════════════════════════════════════════════════
   CENTRAL DE PRODUÇÃO · MOTOR DE IMPRESSÃO (Fase 28). Board KDS (pedidos por
   status) + fila de impressão real (o navegador imprime a comanda 58/80mm com
   QR) + expedição + config + sons. Reimpressão só imprime (o backend garante
   que não registra venda/estoque/financeiro). ══════════════════════════════════ */
let cpAba = 'board', cpConfig = { auto: false, som: true, copias: 1, largura: 80 }, cpPollTimer = null, cpUltimoMax = 0, cpImprimindo = false, cpAudioCtx = null, cpFilaImpressa = new Set();

function abrirProducao() {
  fetch('/api/impressao/config', { cache: 'no-store' }).then(r => r.json()).then(cfg => {
    cpConfig = cfg; $('cp-auto').checked = !!cfg.auto; $('cp-som').checked = cfg.som !== false;
  }).catch(() => {});
  cpIr(cpAba);
  iniciarPollProducao();
}
function pararPollProducao() { if (cpPollTimer) { clearInterval(cpPollTimer); cpPollTimer = null; } }
function iniciarPollProducao() { pararPollProducao(); cpPollTimer = setInterval(cpPoll, 8000); }
function cpPoll() {
  if ($('tela-producao') && !$('tela-producao').classList.contains('ativa')) return;
  if (cpAba === 'board') renderCpBoard(true);
  else if (cpAba === 'expedicao') renderCpExpedicao(true);
  cpProcessarFila();
}
function cpIr(aba) {
  cpAba = aba;
  document.querySelectorAll('.cp-aba').forEach(b => b.classList.toggle('ativo', b.dataset.cpaba === aba));
  document.querySelectorAll('.cp-painel').forEach(p => p.classList.toggle('ativo', p.id === 'cp-' + aba));
  if (aba === 'board') renderCpBoard();
  else if (aba === 'expedicao') renderCpExpedicao();
  else if (aba === 'config') renderCpConfig();
}
document.querySelectorAll('.cp-aba').forEach(b => b.addEventListener('click', () => cpIr(b.dataset.cpaba)));
$('cp-auto').addEventListener('change', async e => {
  cpConfig.auto = e.target.checked;
  if (e.target.checked) { try { cpAudioCtx = cpAudioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch {} } // ativa áudio/print no gesto
  await fetch('/api/impressao/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto: e.target.checked }) }).catch(() => {});
  toast(e.target.checked ? '🖨️ Impressão automática ligada' : 'Impressão automática desligada');
  if (e.target.checked) cpProcessarFila();
});
$('cp-som').addEventListener('change', e => { cpConfig.som = e.target.checked; fetch('/api/impressao/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ som: e.target.checked }) }).catch(() => {}); });

function cpBeep(tipo) {
  if (!$('cp-som') || !$('cp-som').checked) return;
  try {
    cpAudioCtx = cpAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = cpAudioCtx, o = ctx.createOscillator(), g = ctx.createGain();
    const freq = { novo: 880, pronto: 1180, erro: 200, offline: 150 }[tipo] || 660;
    o.type = (tipo === 'erro' || tipo === 'offline') ? 'sawtooth' : 'sine'; o.frequency.value = freq;
    o.connect(g); g.connect(ctx.destination); g.gain.value = 0.07; o.start();
    if (tipo === 'novo' || tipo === 'pronto') setTimeout(() => { try { o.frequency.value = freq * 1.28; } catch {} }, 110);
    o.stop(ctx.currentTime + 0.24);
  } catch {}
}
const cpPrioridade = (min) => min >= 30 ? 'atrasado' : min >= 15 ? 'atencao' : 'ok';

async function renderCpBoard(silencioso) {
  const el = $('cp-board'); if (!silencioso) el.innerHTML = biLoading();
  let g; try { g = await (await fetch('/api/producao/pedidos', { cache: 'no-store' })).json(); } catch { if (!silencioso) el.innerHTML = biErro(); return; }
  // som de novo pedido
  const todos = [...g.aguardando, ...g.producao, ...g.pronto];
  const maxId = todos.reduce((m, p) => Math.max(m, p.id), 0);
  if (cpUltimoMax && maxId > cpUltimoMax && g.aguardando.length) cpBeep('novo');
  cpUltimoMax = maxId;
  const cols = [
    ['⏳ Aguardando', g.aguardando, 'aguardando'], ['🔥 Em produção', g.producao, 'producao'],
    ['✅ Prontos', g.pronto, 'pronto'], ['🛵 Rota / Retirados', [...g.rota, ...g.entregue], 'saiu'], ['✖️ Cancelados', g.cancelado, 'cancelado'],
  ];
  el.innerHTML = `<div class="cp-cols">${cols.map(([tit, lista, tipo]) => `
    <div class="cp-col">
      <div class="cp-col-tit">${tit} <span class="cp-col-n">${lista.length}</span></div>
      <div class="cp-col-cards">${lista.length ? lista.map(p => cpCard(p, tipo)).join('') : '<div class="cp-vazio">—</div>'}</div>
    </div>`).join('')}</div>`;
}
function cpCard(p, coluna) {
  const prio = cpPrioridade(p.min_espera);
  const tipoIco = p.tipo === 'entrega' ? '🛵' : '🏠';
  let acoes = '';
  if (coluna === 'aguardando') acoes = `<button data-cp="iniciar" data-id="${p.id}">▶ Iniciar</button><button data-cp="imprimir" data-id="${p.id}">🖨️</button><button data-cp="cancelar" data-id="${p.id}">✖</button>`;
  else if (coluna === 'producao') acoes = `<button data-cp="pronto" data-id="${p.id}">✅ Pronto</button><button data-cp="reimprimir" data-id="${p.id}">🖨️</button><button data-cp="cancelar" data-id="${p.id}">✖</button>`;
  else if (coluna === 'pronto') acoes = (p.tipo === 'entrega' ? `<button data-cp="despachar" data-id="${p.id}">🛵 Saiu p/ entrega</button>` : `<button data-cp="entregar" data-id="${p.id}">📦 Retirado</button>`) + `<button data-cp="reimprimir" data-id="${p.id}">🖨️</button>`;
  else if (coluna === 'saiu') acoes = (p.status === 'rota' ? `<button data-cp="entregar" data-id="${p.id}">✅ Entregue</button>` : '') + `<button data-cp="detalhes" data-id="${p.id}">👁</button>`;
  else acoes = `<button data-cp="detalhes" data-id="${p.id}">👁</button>`;
  return `<div class="cp-card prio-${prio}">
    <div class="cp-card-top"><span class="cp-num">#${p.numero}</span><span class="cp-tempo">${tipoIco} ${p.min_espera}min</span></div>
    <div class="cp-cli">${crmEsc(p.cliente || 'Sem nome')}</div>
    <div class="cp-itens">${crmEsc((p.itens || '—')).slice(0, 90)}</div>
    ${p.obs ? `<div class="cp-obs">📝 ${crmEsc(p.obs)}</div>` : ''}
    <div class="cp-card-rod"><span class="cp-pgto">${crmEsc(p.pagamento || '')}</span>${p.entregador ? `<span class="cp-ent">🛵 ${crmEsc(p.entregador)}</span>` : ''}</div>
    <div class="cp-acoes">${acoes}</div>
  </div>`;
}
// ações delegadas do board
$('cp-board').addEventListener('click', async e => {
  const b = e.target.closest('[data-cp]'); if (!b) return;
  const id = +b.dataset.id, acao = b.dataset.cp;
  const call = async (url, opt) => { const r = await (await fetch(url, opt || { method: 'POST' })).json(); if (r && r.erro) { toast('⚠ ' + r.erro); return null; } return r || {}; };
  if (acao === 'iniciar') { if (await call(`/api/producao/pedidos/${id}/iniciar`)) { toast('🔥 Em produção'); renderCpBoard(); } }
  else if (acao === 'pronto') { if (await call(`/api/producao/pedidos/${id}/pronto`)) { cpBeep('pronto'); toast('✅ Pronto'); renderCpBoard(); } }
  else if (acao === 'cancelar') { if (confirm('Cancelar este pedido?') && await call(`/api/producao/pedidos/${id}/cancelar`)) { toast('✖ Cancelado'); renderCpBoard(); } }
  else if (acao === 'imprimir') { cpImprimir(id, 'producao'); }
  else if (acao === 'reimprimir') { const r = await call(`/api/impressao/reimprimir/${id}`); if (r) { cpImprimir(id, 'producao', null, true); toast('🖨️ Reimpresso (sem alterar venda/estoque)'); } }
  else if (acao === 'despachar') cpDespachar(id);
  else if (acao === 'entregar') { if (await call(`/api/pedidos/${id}/entregar`)) { toast('✅ Entregue'); renderCpBoard(); } }
  else if (acao === 'detalhes') cpDetalhes(id);
});
async function cpDespachar(id) {
  let ents = []; try { ents = await (await fetch('/api/entregadores?ativos=1')).json(); } catch {}
  let entregadorId = null;
  if (ents.length === 1) entregadorId = ents[0].id;
  else if (ents.length > 1) { const lista = ents.map((e, i) => `${i + 1}) ${e.nome}`).join('\n'); const escolha = prompt('Entregador:\n' + lista); if (escolha == null) return; const idx = parseInt(escolha) - 1; entregadorId = ents[idx] ? ents[idx].id : null; }
  const r = await (await fetch(`/api/pedidos/${id}/despachar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entregador_id: entregadorId }) })).json();
  if (r.erro) { toast('⚠ ' + r.erro); return; }
  toast('🛵 Saiu para entrega'); renderCpBoard();
}
async function cpDetalhes(id) {
  let c; try { c = await (await fetch(`/api/impressao/comanda/${id}?via=cliente`)).json(); } catch { return; }
  if (!c || c.erro) return;
  alert(`Pedido #${c.numero}\nCliente: ${c.cliente || '—'}\nTel: ${c.telefone || '—'}\nTipo: ${c.tipo}\n${c.endereco ? 'Endereço: ' + c.endereco + '\n' : ''}Itens: ${c.itens}\n${c.obs ? 'Obs: ' + c.obs + '\n' : ''}Pagamento: ${c.pagamento} · Total: ${fmt(c.total)}\nQR: ${c.qr}`);
}

// ── Motor de impressão (o navegador imprime; caminho real sem driver nativo) ──
function cpQrSvg(payload, px) {
  const q = window.qrMatriz ? window.qrMatriz(payload) : null;
  if (!q) return '';
  const n = q.size, cell = Math.max(2, Math.floor((px || 120) / (n + 4))), quiet = 2, dim = (n + quiet * 2) * cell;
  let rects = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.dark[r][c]) rects += `<rect x="${(c + quiet) * cell}" y="${(r + quiet) * cell}" width="${cell}" height="${cell}"/>`;
  return `<svg width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" xmlns="http://www.w3.org/2000/svg"><rect width="${dim}" height="${dim}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
function cpComandaHTML(c) {
  const larg = c.largura === 58 ? '58mm' : '80mm', via = c.via, sep = '================================';
  const dt = new Date(c.data);
  let corpo = `<div class="cbig">${via === 'cliente' ? crmEsc(c.loja.nome) : (via === 'entrega' ? 'VIA ENTREGA' : 'VIA PRODUÇÃO')}</div>
    <div class="cnum">PEDIDO #${c.numero}</div>
    <div class="csmall">${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${c.tipo === 'entrega' ? 'ENTREGA' : 'RETIRADA'}</div>
    <div class="cline">${sep}</div>`;
  if (via !== 'producao') {
    corpo += `<div class="crow"><b>Cliente:</b> ${crmEsc(c.cliente || '—')}</div>`;
    if (c.telefone) corpo += `<div class="crow"><b>Tel:</b> ${crmEsc(c.telefone)}</div>`;
    if (c.tipo === 'entrega') { corpo += `<div class="crow"><b>End.:</b> ${crmEsc(c.endereco || '')}${c.complemento ? ' - ' + crmEsc(c.complemento) : ''}</div>`; if (c.bairro) corpo += `<div class="crow">${crmEsc(c.bairro)}</div>`; }
    corpo += `<div class="cline">${sep}</div>`;
  }
  corpo += `<div class="citens">${crmEsc(c.itens || '—')}</div>`;
  if (c.obs) corpo += `<div class="cobs">** ${crmEsc(c.obs)} **</div>`;
  corpo += `<div class="cline">${sep}</div>`;
  if (via !== 'producao') {
    corpo += `<div class="crow"><b>Pgto:</b> ${crmEsc(c.pagamento || '—')}</div>`;
    if (+c.troco > 0) corpo += `<div class="crow"><b>Troco p/:</b> ${fmt(c.troco)}</div>`;
    corpo += `<div class="ctotal">TOTAL ${fmt(c.total || c.valor || 0)}</div>`;
  }
  corpo += `<div class="cqr">${cpQrSvg(c.qr, c.largura === 58 ? 96 : 130)}</div><div class="csmall">#${c.numero} · via ${via}</div>`;
  const uma = `<div class="ccomanda">${corpo}</div>`;
  const copias = Math.max(1, +c.copias || 1);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${larg} auto; margin: 0; } * { margin:0; padding:0; box-sizing:border-box; }
    body { width:${larg}; font-family:'Courier New',monospace; color:#000; }
    .ccomanda { padding:5px 7px; page-break-after: always; }
    .cbig { font-size:14px; font-weight:bold; text-align:center; }
    .cnum { font-size:19px; font-weight:bold; text-align:center; }
    .csmall { font-size:10px; text-align:center; }
    .cline { font-size:10px; overflow:hidden; white-space:nowrap; }
    .crow { font-size:12px; margin:1px 0; }
    .citens { font-size:15px; font-weight:bold; white-space:pre-wrap; margin:3px 0; }
    .cobs { font-size:12px; font-style:italic; margin-top:2px; }
    .ctotal { font-size:15px; font-weight:bold; text-align:right; margin-top:3px; }
    .cqr { text-align:center; margin-top:6px; }
  </style></head><body>${uma.repeat(copias)}</body></html>`;
}
/* ── FASE 43: Fechamento Operacional por Período (operacional, simples) ── */
// Classificação de divergência no cliente (espelha hintDivergencia do servidor).
function fechHint(dif) {
  const d = Math.round((+dif || 0) * 100) / 100;
  if (Math.abs(d) < 0.01) return { c: 'ok', t: 'sem divergência' };
  if (d < 0) return { c: 'falta', t: 'falta — venda não registrada, consumo interno ou perda' };
  return { c: 'sobra', t: 'sobra — erro de contagem, produção não lançada ou devolução' };
}
const FECH_ACAI = [['popular', '🟣 Popular'], ['medio', '🔵 Médio'], ['grosso', '🟤 Grosso']];
let fechStep = 1;
let fechPerguntouConsolidado = ''; // Etapa 2 (regra 7): pergunta 1x por dia quando não houve parcial às 13h
async function renderFechamento() {
  const el = $('fechamento-conteudo'); el.innerHTML = biLoading();
  let modo, conf, resumo, fechs; try { [modo, conf, resumo, fechs] = await Promise.all([
    (await fetch('/api/operacao/modo', { cache: 'no-store' })).json(),
    (await fetch('/api/operacao/conferencia', { cache: 'no-store' })).json(),
    (await fetch('/api/operacao/resumo', { cache: 'no-store' })).json(),
    (await fetch('/api/operacao/fechamentos', { cache: 'no-store' })).json(),
  ]); } catch { el.innerHTML = biErro(); return; }
  // Etapa 2 (regra 7): sem fechamento parcial (13h) hoje → pergunta antes de abrir o dia inteiro.
  if (modo.modo === 'consolidado' && fechPerguntouConsolidado !== modo.data) {
    fechPerguntouConsolidado = modo.data;
    const naoHouve = confirm('Não encontrei fechamento parcial (13h) registrado hoje.\n\nHouve fechamento parcial?\n\n• OK = NÃO houve → abrir o fechamento ÚNICO do dia inteiro\n• Cancelar = HOUVE → vou conferir o histórico');
    if (!naoHouve) toast('ℹ️ Nenhum parcial registrado hoje — confira o Histórico abaixo antes de fechar o dia.');
  }
  // Rascunho pendente de hoje (mesmo modo) → "continuar depois".
  const rasc = fechs.find(f => f.data === modo.data && f.status === 'rascunho' && f.modo === modo.modo);
  const prod = conf.acai, produtos = conf.produtos || [], caixa = conf.caixa || { formas: [], total: 0, fiado_recebido: 0 };
  const dinheiroEsp = (caixa.formas.find(f => f.forma === 'Dinheiro') || {}).total || 0;
  const eletronicoEsp = caixa.formas.filter(f => f.forma !== 'Dinheiro' && f.forma !== 'Fiado').reduce((s, f) => s + f.total, 0);
  // valores pré-carregados (do rascunho, se houver)
  const pv = { sacas: rasc ? rasc.sacas_usadas : 0 };
  FECH_ACAI.forEach(([t]) => { pv['lit_' + t] = rasc ? (rasc['litros_' + t] || 0) : 0; pv['rest_' + t] = rasc ? (rasc['restante_' + t] || 0) : prod[t].teorico; });
  const rascItem = (cod) => rasc && (rasc.itens || []).find(i => i.codigo === cod);
  const fin = (rasc && rasc.financeiro) || {};

  const linhaAcai = ([t, lbl]) => `<div class="fech-linha">
    <span class="fech-tipo">${lbl} <small>(teórico ${prod[t].teorico} L)</small></span>
    <label>Litros produzidos<input type="number" step="0.1" class="fech-prod" data-t="${t}" value="${pv['lit_' + t]}"></label>
    <label>Restante físico<input type="number" step="0.1" class="fech-rest" data-t="${t}" value="${pv['rest_' + t]}"></label>
    <span class="fech-consumo" data-t="${t}">consumo: —</span></div>`;
  const linhaProd = (p) => { const it = rascItem(p.codigo); const val = it && it.fisico != null ? it.fisico : ''; return `<div class="fech-prlinha">
    <span class="fech-prnome">${crmEsc(p.nome)} <small>${p.unidade}</small></span>
    <span class="fech-prteo">teórico: <b>${p.teorico}</b></span>
    <label>Contagem física<input type="number" step="0.01" class="fech-fis" data-cod="${crmEsc(p.codigo)}" data-nome="${crmEsc(p.nome)}" data-un="${crmEsc(p.unidade)}" data-teo="${p.teorico}" value="${val}" placeholder="—"></label>
    <span class="fech-prdif" data-cod="${crmEsc(p.codigo)}">—</span></div>`; };

  el.innerHTML = `
  <div class="fech-wrap">
    <div class="fech-top">
      <h2 class="fech-title">🌅 ${crmEsc(modo.label)}</h2>
      <span class="fech-badge ${modo.modo === 'consolidado' ? 'consol' : ''}">${modo.modo === 'consolidado' ? 'Único do dia' : 'Por período'}</span>
      ${rasc ? '<span class="fech-badge rasc">rascunho salvo · continuando</span>' : ''}
    </div>
    ${modo.modo === 'consolidado' ? '<p class="fech-hint">A manhã não foi fechada — o sistema oferece o <b>fechamento único do dia inteiro</b> (nunca os dois formatos). As vendas nunca ficam bloqueadas.</p>' : '<p class="fech-hint">Informe o que aconteceu no período. O sistema calcula consumo, rendimento e as divergências sozinho.</p>'}
    <div class="fech-steps">${['Produção & Estoque', 'Saídas não-venda', 'Caixa', 'Divergências', 'Resumo'].map((s, i) => `<span class="fech-stepchip" data-step="${i + 1}"><b>${i + 1}</b> ${s}</span>`).join('')}</div>

    <div class="fech-panel" data-panel="1">
      <div class="fech-sacas"><label>Sacas de açaí usadas<input type="number" step="0.1" id="fech-sacas" value="${pv.sacas}"></label>
        <div class="fech-rend-live" id="fech-rend">Rendimento: — L/saca</div></div>
      ${FECH_ACAI.map(linhaAcai).join('')}
      <div class="fech-sub">Outros produtos controlados <small>(entram sozinhos pelo tipo do cadastro)</small></div>
      ${produtos.length ? produtos.map(linhaProd).join('') : '<div class="fech-vazio">Nenhum outro produto controlado.</div>'}
    </div>

    <div class="fech-panel" data-panel="2" hidden>
      <p class="fech-phint">Saídas que <b>não foram venda</b> (consumo interno, perdas, brindes, doações, ajustes) dão baixa de verdade no estoque e explicam a divergência. Registre pelos <b>botões na etapa Divergências</b> (já vêm com a quantidade da diferença) ou no módulo dedicado.</p>
      <button class="fech-btn ghost" type="button" id="fech-abrir-movnc">📉 Abrir Movimentações Não Comerciais</button>
      <div id="fech-mov-hoje" class="fech-movhoje">carregando…</div>
      <label class="fech-full">Anotações do período (opcional)<textarea id="fech-mov-consumo" rows="2" placeholder="observações gerais do período">${fin.anotacoes || fin.consumo_interno || ''}</textarea></label>
    </div>

    <div class="fech-panel" data-panel="3" hidden>
      <p class="fech-phint">Conferência do caixa do período. O <b>esperado</b> vem das vendas registradas; informe o que foi <b>contado</b>.</p>
      <div class="fech-caixa-esp">${caixa.formas.length ? caixa.formas.map(f => `<span class="fech-forma">${crmEsc(f.forma)}: <b>${fmt(f.total)}</b> <small>(${f.n})</small></span>`).join('') : '<span class="fech-forma">Sem vendas no período.</span>'}</div>
      <div class="fech-cxgrid">
        <label>Dinheiro contado na gaveta<input type="number" step="0.01" id="fech-cx-contado" value="${fin.contado != null ? fin.contado : ''}" placeholder="0,00"></label>
        <label>(+) Suprimentos<input type="number" step="0.01" id="fech-cx-supri" value="${fin.suprimentos || ''}" placeholder="0,00"></label>
        <label>(−) Sangrias<input type="number" step="0.01" id="fech-cx-sangria" value="${fin.sangrias || ''}" placeholder="0,00"></label>
        <label>(−) Despesas pagas do caixa<input type="number" step="0.01" id="fech-cx-despesa" value="${fin.despesas || ''}" placeholder="0,00"></label>
        <label>Fiado recebido (informado)<input type="number" step="0.01" id="fech-cx-fiado" value="${fin.fiado_recebido != null ? fin.fiado_recebido : (caixa.fiado_recebido || '')}" placeholder="0,00"></label>
      </div>
      <div class="fech-cxres" id="fech-cxres">—</div>
    </div>

    <div class="fech-panel" data-panel="4" hidden>
      <p class="fech-phint">Conferência automática — o sistema <b>não cria venda</b>; ele aponta a hipótese. Justifique se precisar.</p>
      <div id="fech-diverg"></div>
      <label class="fech-full">Justificativa / observações<textarea id="fech-obs" rows="2" placeholder="opcional">${rasc ? crmEsc(rasc.obs || '') : ''}</textarea></label>
    </div>

    <div class="fech-panel" data-panel="5" hidden>
      <div id="fech-resumo"></div>
      <div class="fech-acoes-final">
        <button class="fech-btn ghost" id="fech-rascunho">💾 Salvar rascunho (continuar depois)</button>
        <button class="fech-btn" id="fech-confirmar">✅ Confirmar ${modo.modo === 'consolidado' ? 'fechamento do dia' : 'fechamento do período'}</button>
      </div>
      <p class="fech-phint">Ao <b>confirmar</b>, o estoque é reconciliado ao físico e as sacas são consumidas. Rascunho não altera nada.</p>
    </div>

    <div class="fech-nav">
      <button class="fech-btn ghost" id="fech-voltar" hidden>‹ Voltar</button>
      <button class="fech-btn ghost" id="fech-rasc-topo">💾 Rascunho</button>
      <button class="fech-btn" id="fech-avancar">Avançar ›</button>
    </div>

    <div class="fech-cards">
      ${finCard('📊', (resumo.rendimento_medio_saca != null ? resumo.rendimento_medio_saca + ' L/saca' : '—'), 'Rendimento médio (histórico)')}
      ${finCard('🥤', (resumo.litros_total || 0) + ' L', 'Litros produzidos (total)')}
      ${finCard('⚠️', resumo.divergencias || 0, 'Fechamentos c/ divergência', '', resumo.divergencias ? 'neg' : '')}
    </div>
    ${finBox('🕒 Histórico de fechamentos', biTabela([{ h: 'Data' }, { h: 'Período' }, { h: 'Modo' }, { h: 'Status' }, { h: 'Sacas', cls: 'num' }, { h: 'Litros', cls: 'num' }, { h: 'Divergência', cls: 'num' }],
      fechs.map(f => [f.data, f.periodo_label, f.modo_label || f.modo, `<span class="fech-st ${f.status}">${f.status}</span>`, f.sacas_usadas, f.litros_totais, `<span class="${Math.abs(f.divergencia_total) > 2 ? 'fin-val saida' : ''}">${f.divergencia_total}</span>`]), 'Nenhum fechamento ainda.'))}
  </div>`;

  // ── coleta dos valores atuais dos campos ──
  const num = (id) => +(($(id) || {}).value) || 0;
  const r100 = (x) => Math.round(x * 100) / 100;
  function coletar() {
    const g = (cls, t) => +el.querySelector(`.${cls}[data-t="${t}"]`).value || 0;
    const itens = [...el.querySelectorAll('.fech-fis')].filter(i => i.value !== '').map(i => ({ codigo: i.dataset.cod, nome: i.dataset.nome, unidade: i.dataset.un, fisico: +i.value || 0 }));
    const financeiro = { contado: num('fech-cx-contado'), suprimentos: num('fech-cx-supri'), sangrias: num('fech-cx-sangria'), despesas: num('fech-cx-despesa'), fiado_recebido: num('fech-cx-fiado'),
      dinheiro_esperado: dinheiroEsp, eletronico_esperado: eletronicoEsp,
      anotacoes: (($('fech-mov-consumo') || {}).value || '').trim() };
    return { modo: modo.modo, periodo: modo.periodo, data: modo.data, sacas_usadas: num('fech-sacas'), obs: ($('fech-obs').value || '').trim(),
      litros_popular: g('fech-prod', 'popular'), litros_medio: g('fech-prod', 'medio'), litros_grosso: g('fech-prod', 'grosso'),
      restante_popular: g('fech-rest', 'popular'), restante_medio: g('fech-rest', 'medio'), restante_grosso: g('fech-rest', 'grosso'), itens, financeiro };
  }

  // ── recálculos ao vivo (etapa 1) ──
  const recalc = () => {
    let lt = 0; const sac = num('fech-sacas');
    FECH_ACAI.forEach(([t]) => {
      const p = +el.querySelector(`.fech-prod[data-t="${t}"]`).value || 0, r = +el.querySelector(`.fech-rest[data-t="${t}"]`).value || 0;
      lt += p; el.querySelector(`.fech-consumo[data-t="${t}"]`).textContent = 'consumo: ' + (Math.round((p - r) * 100) / 100) + ' L';
    });
    $('fech-rend').textContent = 'Rendimento: ' + (sac > 0 ? Math.round(lt / sac * 100) / 100 : '—') + ' L/saca';
    el.querySelectorAll('.fech-fis').forEach(i => { const cell = el.querySelector(`.fech-prdif[data-cod="${CSS.escape(i.dataset.cod)}"]`); if (!cell) return;
      if (i.value === '') { cell.textContent = '—'; cell.className = 'fech-prdif'; return; }
      const dif = (+i.value || 0) - (+i.dataset.teo || 0); const h = fechHint(dif); cell.textContent = 'dif: ' + (Math.round(dif * 100) / 100) + ' ' + i.dataset.un; cell.className = 'fech-prdif ' + h.c; });
  };
  // ── caixa (etapa 3) ──
  const recalcCaixa = () => {
    const espGaveta = dinheiroEsp + num('fech-cx-supri') - num('fech-cx-sangria') - num('fech-cx-despesa');
    const dif = num('fech-cx-contado') - espGaveta; const h = fechHint(dif);
    $('fech-cxres').innerHTML = `Esperado na gaveta: <b>${fmt(espGaveta)}</b> · Contado: <b>${fmt(num('fech-cx-contado'))}</b> · <span class="fech-cxdif ${h.c}">${dif >= 0 ? 'sobra' : 'falta'} ${fmt(Math.abs(dif))}</span><br><small>Eletrônico esperado (PIX/cartão): ${fmt(eletronicoEsp)} · Fiado recebido: ${fmt(num('fech-cx-fiado'))}</small>`;
  };
  // ── divergências (etapa 4) — com registro de movimentação não comercial inline ──
  const FECH_MOV = [['consumo_interno', '🧑‍🍳', 'Consumo'], ['perda', '🗑️', 'Perda'], ['brinde', '🎁', 'Brinde'], ['doacao', '🤝', 'Doação'], ['ajuste', '⚖️', 'Ajuste']];
  async function fechRegMov(codigo, tipo, qtd, dif) {
    const sentido_ajuste = tipo === 'ajuste' ? (dif < 0 ? 'saida' : 'entrada') : undefined;
    const r = await (await fetch('/api/movimentacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produto_codigo: codigo, tipo, quantidade: Math.abs(qtd), origem: 'fechamento', sentido_ajuste, obs: 'justificativa do fechamento' }) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    toast(`✅ ${r.tipo_icone} ${r.tipo_label} · ${r.produto_nome} · estoque ${r.estoque_anterior}→${r.estoque_novo}`);
    // atualiza o teórico local (estoque mudou) e re-renderiza a conferência
    const ac = FECH_ACAI.find(([tk]) => prod[tk].codigo === codigo); if (ac) prod[ac[0]].teorico = r.estoque_novo;
    const fis = [...el.querySelectorAll('.fech-fis')].find(i => i.dataset.cod === codigo); if (fis) fis.dataset.teo = r.estoque_novo;
    const pp = produtos.find(p => p.codigo === codigo); if (pp) pp.teorico = r.estoque_novo;
    renderDiverg();
  }
  const renderDiverg = () => {
    const linhas = [];
    FECH_ACAI.forEach(([t, lbl]) => { const rest = +el.querySelector(`.fech-rest[data-t="${t}"]`).value || 0; const teo = prod[t].teorico; linhas.push({ codigo: prod[t].codigo, nome: lbl.replace(/^\S+\s/, 'Açaí '), un: 'L', teo, inf: rest, dif: r100(rest - teo) }); });
    el.querySelectorAll('.fech-fis').forEach(i => { if (i.value === '') return; const teo = +i.dataset.teo || 0; linhas.push({ codigo: i.dataset.cod, nome: i.dataset.nome, un: i.dataset.un, teo, inf: +i.value || 0, dif: r100((+i.value || 0) - teo) }); });
    const linhaHtml = (l) => { const h = fechHint(l.dif); const podeReg = Math.abs(l.dif) >= 0.01;
      const botoes = podeReg ? FECH_MOV.filter(([chave]) => l.dif < 0 || chave === 'ajuste').map(([chave, ic, lb]) => `<button class="fech-regmov" data-cod="${crmEsc(l.codigo)}" data-tipo="${chave}" data-qtd="${Math.abs(l.dif)}" data-dif="${l.dif}">${ic} ${lb}</button>`).join('') : '';
      return `<tr><td>${crmEsc(l.nome)}</td><td>${l.un}</td><td class="num">${l.teo}</td><td class="num">${l.inf}</td><td class="num"><span class="fech-dv ${h.c}">${l.dif}</span></td><td>${h.t}${botoes ? `<div class="fech-regmov-box">${botoes}</div>` : ''}</td></tr>`; };
    const espGaveta = dinheiroEsp + num('fech-cx-supri') - num('fech-cx-sangria') - num('fech-cx-despesa');
    const cxdif = num('fech-cx-contado') - espGaveta; const ch = fechHint(cxdif);
    $('fech-diverg').innerHTML = `<div class="bi-tabela-wrap"><table class="bi-tabela"><thead><tr><th>Item</th><th>Un</th><th class="num">Esperado</th><th class="num">Informado</th><th class="num">Diferença</th><th>Hipótese / justificar</th></tr></thead><tbody>${linhas.map(linhaHtml).join('') || '<tr><td colspan="6">Sem itens.</td></tr>'}</tbody></table></div>`
      + `<div class="fech-cxbox">Caixa (dinheiro): esperado ${fmt(espGaveta)} · contado ${fmt(num('fech-cx-contado'))} · <span class="fech-dv ${ch.c}">${cxdif >= 0 ? 'sobra' : 'falta'} ${fmt(Math.abs(cxdif))}</span></div>`;
    $('fech-diverg').querySelectorAll('.fech-regmov').forEach(b => b.addEventListener('click', () => fechRegMov(b.dataset.cod, b.dataset.tipo, +b.dataset.qtd, +b.dataset.dif)));
  };
  // ── resumo (etapa 5) ──
  const renderResumo = () => {
    const d = coletar(); const lt = d.litros_popular + d.litros_medio + d.litros_grosso;
    const nDiv = FECH_ACAI.filter(([t]) => Math.abs((d['restante_' + t]) - prod[t].teorico) > 0.01).length + d.itens.filter(i => Math.abs(i.fisico - (produtos.find(p => p.codigo === i.codigo) || {}).teorico) > 0.01).length;
    $('fech-resumo').innerHTML = `<div class="fech-resumo-grid">
      <div><span>Modo</span><b>${modo.modo === 'consolidado' ? 'Único do dia' : modo.label}</b></div>
      <div><span>Sacas usadas</span><b>${d.sacas_usadas}</b></div>
      <div><span>Litros produzidos</span><b>${Math.round(lt * 100) / 100} L</b></div>
      <div><span>Rendimento</span><b>${d.sacas_usadas > 0 ? Math.round(lt / d.sacas_usadas * 100) / 100 + ' L/saca' : '—'}</b></div>
      <div><span>Restante açaí</span><b>${d.restante_popular} / ${d.restante_medio} / ${d.restante_grosso} L</b></div>
      <div><span>Outros produtos conferidos</span><b>${d.itens.length}</b></div>
      <div><span>Itens com divergência</span><b class="${nDiv ? 'fin-val saida' : ''}">${nDiv}</b></div>
      <div><span>Dinheiro contado</span><b>${fmt(d.financeiro.contado)}</b></div>
    </div>`;
  };

  // lista as movimentações não comerciais de HOJE (etapa 2)
  async function carregarMovHoje() {
    const box = $('fech-mov-hoje'); if (!box) return;
    try {
      const lista = await (await fetch('/api/movimentacoes?de=' + modo.data + '&ate=' + modo.data + '&excluir_estornadas=1', { cache: 'no-store' })).json();
      box.innerHTML = lista.length ? '<div class="fech-movhoje-tit">Registradas hoje:</div>' + lista.map(m => `<div class="fech-movhoje-item">${m.tipo_icone} ${crmEsc(m.tipo_label)} · ${crmEsc(m.produto_nome)} · <b>${m.delta > 0 ? '+' : ''}${m.delta} ${m.unidade}</b> ${m.funcionario ? '· ' + crmEsc(m.funcionario) : ''} <small>${m.hora}</small></div>`).join('') : '<div class="fech-movhoje-vazio">Nenhuma movimentação não comercial hoje.</div>';
    } catch { box.textContent = ''; }
  }
  const painel = (n) => { fechStep = n; el.querySelectorAll('.fech-panel').forEach(p => p.hidden = +p.dataset.panel !== n);
    el.querySelectorAll('.fech-stepchip').forEach(c => c.classList.toggle('ativo', +c.dataset.step === n));
    $('fech-voltar').hidden = n === 1; $('fech-avancar').textContent = n === 5 ? 'Ir ao resumo ✓' : 'Avançar ›'; $('fech-avancar').hidden = n === 5;
    if (n === 2) carregarMovHoje(); if (n === 3) recalcCaixa(); if (n === 4) renderDiverg(); if (n === 5) renderResumo();
    el.querySelector('.fech-wrap').scrollIntoView({ block: 'start', behavior: 'smooth' }); };

  const abrirMov = $('fech-abrir-movnc'); if (abrirMov) abrirMov.addEventListener('click', () => irPara('movimentacoes'));
  el.querySelectorAll('.fech-prod, .fech-rest, #fech-sacas, .fech-fis').forEach(i => i.addEventListener('input', recalc));
  el.querySelectorAll('#fech-cx-contado, #fech-cx-supri, #fech-cx-sangria, #fech-cx-despesa, #fech-cx-fiado').forEach(i => i.addEventListener('input', recalcCaixa));
  el.querySelectorAll('.fech-stepchip').forEach(c => c.addEventListener('click', () => painel(+c.dataset.step)));
  $('fech-avancar').addEventListener('click', () => painel(Math.min(5, fechStep + 1)));
  $('fech-voltar').addEventListener('click', () => painel(Math.max(1, fechStep - 1)));
  recalc();

  async function salvar(status) {
    const body = { ...coletar(), status };
    const url = rasc ? '/api/operacao/fechamentos/' + rasc.id : '/api/operacao/fechamentos';
    const r = await (await fetch(url, { method: rasc ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    fechStep = 1;
    toast(status === 'confirmado' ? `✅ Fechamento confirmado · ${r.litros_totais} L` : '💾 Rascunho salvo — dá pra continuar depois.');
    // Etapa 2 (regra 10): relatório automático pros números autorizados (fila se offline).
    if (status === 'confirmado') { try { enviarRelatorioFechamento(r); } catch {} }
    renderFechamento();
  }
  $('fech-rasc-topo').addEventListener('click', () => salvar('rascunho'));
  $('fech-rascunho').addEventListener('click', () => salvar('rascunho'));
  $('fech-confirmar').addEventListener('click', () => { if (confirm('Confirmar o fechamento? O estoque será reconciliado ao físico informado.')) salvar('confirmado'); });
  painel(fechStep > 5 ? 1 : fechStep);
}

/* ── FASE 44: Movimentações Não Comerciais (operacional) — toda saída/entrada que não é venda ── */
let movncSel = null;      // produto selecionado {codigo,nome,unidade,estoque,tipos}
let movncTipoSel = null;  // chave do tipo escolhido
let movncTiposCache = [], movncFuncsCache = [], movncFiltroTipo = '';
async function renderMovimentacoes() {
  const el = $('movimentacoes-conteudo'); el.innerHTML = biLoading();
  let tipos, funcs, resumo, hist; try { [tipos, funcs, resumo, hist] = await Promise.all([
    (await fetch('/api/movimentacoes/tipos', { cache: 'no-store' })).json(),
    (await fetch('/api/movimentacoes/funcionarios', { cache: 'no-store' })).json(),
    (await fetch('/api/movimentacoes/resumo', { cache: 'no-store' })).json(),
    (await fetch('/api/movimentacoes' + (movncFiltroTipo ? '?tipo=' + movncFiltroTipo : ''), { cache: 'no-store' })).json(),
  ]); } catch { el.innerHTML = biErro(); return; }
  movncTiposCache = tipos.tipos || []; movncFuncsCache = funcs.funcionarios || [];
  const gestor = (usuarioAtual && (usuarioAtual.perfil === 'admin' || usuarioAtual.perfil === 'supervisor'));
  el.innerHTML = `
  <div class="movnc-wrap">
    <div class="movnc-top"><h2 class="movnc-title">📉 Movimentações Não Comerciais</h2></div>
    <p class="movnc-hint">Toda saída ou entrada de estoque que <b>não é venda</b> — com motivo. Baixa o estoque, <b>nunca</b> gera venda ou receita, e entra nos relatórios e na conferência do fechamento.</p>
    <div class="movnc-cards">
      ${finCard('📋', resumo.total || 0, 'Movimentações (30 dias)')}
      ${finCard('📅', resumo.hoje || 0, 'Hoje')}
      ${(resumo.porTipo || []).slice(0, 2).map(t => finCard(t.icone, t.q, t.label + ' (30d)')).join('')}
    </div>
    <div class="movnc-form">
      <div class="movnc-prod">
        <label>Produto <small>(clique ou espaço-espaço para buscar)</small>
          <input id="movnc-produto" readonly placeholder="clique para escolher…" value="${movncSel ? crmEsc(movncSel.nome) : ''}"></label>
        <div class="movnc-estoque" id="movnc-estoque">${movncSel ? ('estoque: ' + movncSel.estoque + ' ' + movncSel.unidade) : ''}</div>
      </div>
      <div class="movnc-tipos" id="movnc-tipos">${movncTipoChips()}</div>
      <div class="movnc-linha2">
        <div class="movnc-ajuste" id="movnc-ajuste" hidden>
          <span>Sentido:</span>
          <button class="movnc-sent ativo" data-sent="saida" type="button">− Saída</button>
          <button class="movnc-sent" data-sent="entrada" type="button">+ Entrada</button>
        </div>
        <label>Quantidade<input type="number" step="0.01" id="movnc-qtd" placeholder="0" value=""><span class="movnc-un" id="movnc-un">${movncSel ? movncSel.unidade : ''}</span></label>
        <label>Funcionário responsável<input id="movnc-func" list="movnc-funcs" placeholder="quem consumiu / responsável" autocomplete="off"></label>
        <datalist id="movnc-funcs">${movncFuncsCache.map(f => `<option value="${crmEsc(f)}">`).join('')}</datalist>
      </div>
      <label class="movnc-full">Observação<input id="movnc-obs" placeholder="opcional"></label>
      <button class="movnc-btn" id="movnc-registrar">✅ Registrar movimentação</button>
    </div>
    <div class="movnc-filtros">
      <button class="movnc-fchip ${movncFiltroTipo === '' ? 'ativo' : ''}" data-ft="">Todas</button>
      ${movncTiposCache.map(t => `<button class="movnc-fchip ${movncFiltroTipo === t.chave ? 'ativo' : ''}" data-ft="${t.chave}">${t.icone} ${crmEsc(t.label)}</button>`).join('')}
    </div>
    ${finBox('🕒 Histórico', biTabela([{ h: 'Data' }, { h: 'Hora' }, { h: 'Tipo' }, { h: 'Produto' }, { h: 'Qtd', cls: 'num' }, { h: 'Estoque', cls: 'num' }, { h: 'Responsável' }, { h: 'Usuário' }, { h: '' }],
      (hist || []).map(m => [m.data, m.hora, `${m.tipo_icone} ${crmEsc(m.tipo_label)}`, crmEsc(m.produto_nome || m.produto_codigo),
        `<span class="${m.delta < 0 ? 'fin-val saida' : 'fin-val entrada'}">${m.delta > 0 ? '+' : ''}${m.delta} ${m.unidade}</span>`,
        `${m.estoque_anterior}→${m.estoque_novo}`, crmEsc(m.funcionario || '—'), crmEsc(m.usuario || '—'),
        m.estornado ? '<span class="movnc-estornada">estornada</span>' : (gestor ? `<button class="movnc-estornar" data-id="${m.id}">estornar</button>` : '')]),
      'Nenhuma movimentação ainda.'))}
  </div>`;
  // produto: clique abre a busca (contexto movimentacoes)
  const abrir = () => abrirBuscaProduto('movimentacoes');
  $('movnc-produto').addEventListener('click', abrir);
  $('movnc-produto').addEventListener('focus', abrir);
  el.querySelectorAll('.movnc-tipo').forEach(b => b.addEventListener('click', () => { movncTipoSel = b.dataset.tipo; renderMovncTipos(); }));
  el.querySelectorAll('.movnc-sent').forEach(b => b.addEventListener('click', () => { el.querySelectorAll('.movnc-sent').forEach(x => x.classList.remove('ativo')); b.classList.add('ativo'); }));
  el.querySelectorAll('.movnc-fchip').forEach(b => b.addEventListener('click', () => { movncFiltroTipo = b.dataset.ft; renderMovimentacoes(); }));
  el.querySelectorAll('.movnc-estornar').forEach(b => b.addEventListener('click', () => movncEstornar(+b.dataset.id)));
  $('movnc-registrar').addEventListener('click', movncRegistrar);
}
function movncTipoChips() {
  const permit = movncSel ? movncSel.tipos : null; // array de chaves
  const lista = movncTiposCache.filter(t => !permit || permit.includes(t.chave));
  if (!lista.length) return '<div class="movnc-vazio">Selecione um produto para ver os tipos permitidos.</div>';
  return lista.map(t => `<button class="movnc-tipo ${movncTipoSel === t.chave ? 'ativo' : ''}" data-tipo="${t.chave}">${t.icone} ${crmEsc(t.label)}</button>`).join('');
}
function renderMovncTipos() {
  const box = $('movnc-tipos'); if (box) box.innerHTML = movncTipoChips();
  document.querySelectorAll('#movnc-tipos .movnc-tipo').forEach(b => b.addEventListener('click', () => { movncTipoSel = b.dataset.tipo; renderMovncTipos(); }));
  const t = movncTiposCache.find(x => x.chave === movncTipoSel);
  const aj = $('movnc-ajuste'); if (aj) aj.hidden = !(t && t.sentido === 'ajuste');
}
async function movncSelecionarProduto(codigo) {
  try {
    const lista = await (await fetch('/api/movimentacoes/produtos?q=' + encodeURIComponent(codigo), { cache: 'no-store' })).json();
    const p = lista.find(x => x.codigo === codigo) || lista[0];
    if (!p) return;
    movncSel = p; movncTipoSel = null;
    const inp = $('movnc-produto'); if (inp) inp.value = p.nome;
    const est = $('movnc-estoque'); if (est) est.textContent = 'estoque: ' + p.estoque + ' ' + p.unidade;
    const un = $('movnc-un'); if (un) un.textContent = p.unidade;
    renderMovncTipos();
  } catch { toast('⚠ Falha ao carregar o produto.'); }
}
async function movncRegistrar() {
  if (!movncSel) { toast('⚠ Escolha um produto.'); return; }
  if (!movncTipoSel) { toast('⚠ Escolha o tipo de movimentação.'); return; }
  const qtd = parseFloat(($('movnc-qtd').value || '').replace(',', '.'));
  if (!(qtd > 0)) { toast('⚠ Informe a quantidade.'); return; }
  const t = movncTiposCache.find(x => x.chave === movncTipoSel);
  const sentidoAjuste = (t && t.sentido === 'ajuste') ? (document.querySelector('#movnc-ajuste .movnc-sent.ativo') || {}).dataset.sent : undefined;
  const body = { produto_codigo: movncSel.codigo, tipo: movncTipoSel, quantidade: qtd,
    funcionario: ($('movnc-func').value || '').trim(), obs: ($('movnc-obs').value || '').trim(), sentido_ajuste: sentidoAjuste };
  const r = await (await fetch('/api/movimentacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (r.erro) { toast('⚠ ' + r.erro); return; }
  toast(`✅ ${r.tipo_icone} ${r.tipo_label} · ${r.produto_nome} · ${r.estoque_anterior}→${r.estoque_novo} ${r.unidade}`);
  movncSel = null; movncTipoSel = null;
  renderMovimentacoes();
}
async function movncEstornar(id) {
  if (!confirm('Estornar esta movimentação? O estoque será revertido.')) return;
  const r = await (await fetch('/api/movimentacoes/' + id, { method: 'DELETE' })).json();
  if (r.erro) { toast('⚠ ' + r.erro); return; }
  toast('↩ Movimentação estornada.'); renderMovimentacoes();
}

/* ── FASE 42: Assistente IA do ERP (gerencial) — insights + resumo + perguntar ── */
const IA_AREA = { operacao: '⚙️ Operação', financeiro: '💵 Financeiro', clientes: '👥 Clientes', producao: '🏭 Produção', administracao: '🛠️ Administração' };
const IA_SEV = { critico: 'crit', atencao: 'aten', info: 'info' };
async function renderAssistente() {
  const el = $('assistente-conteudo'); el.innerHTML = biLoading();
  let resumo, insights, status; try { [resumo, insights, status] = await Promise.all([
    (await fetch('/api/assistente/resumo', { cache: 'no-store' })).json(),
    (await fetch('/api/assistente/insights', { cache: 'no-store' })).json(),
    (await fetch('/api/assistente/status', { cache: 'no-store' })).json(),
  ]); } catch { el.innerHTML = biErro(); return; }
  const a = resumo.alertas || {};
  const areasComInsight = Object.entries(insights.por_area || {}).filter(([, arr]) => arr.length);
  const insightCard = (i) => `<div class="ia-insight ${IA_SEV[i.severidade] || 'info'}">
    <div class="ia-insight-top"><span class="ia-sev ${IA_SEV[i.severidade]}">${i.severidade}</span><span class="ia-insight-tit">${crmEsc(i.titulo)}</span></div>
    ${i.detalhe ? `<div class="ia-insight-det">${crmEsc(i.detalhe)}</div>` : ''}
    ${i.acao_sugerida ? `<div class="ia-insight-acao">💡 ${crmEsc(i.acao_sugerida)}${i.requer_confirmacao ? ' <span class="ia-conf">requer sua confirmação</span>' : ''}${i.modulo ? ` <button class="ia-goto" data-ia-goto="${i.modulo}">abrir ▸</button>` : ''}</div>` : ''}
  </div>`;
  el.innerHTML = `
  <div class="ia-wrap">
    <div class="ia-head"><h2 class="ia-title">🤖 Assistente do ERP</h2><span class="ia-status ${status.ia_ativa ? 'on' : 'off'}">${status.ia_ativa ? 'IA ativa · ' + (status.modelo || '') : 'IA de texto off (mostrando dados diretos)'}</span></div>
    <div class="ia-kpis">
      ${finCard('💵', fmt(resumo.faturamento_mes), 'Faturamento (mês)')}
      ${finCard('📈', fmt(resumo.lucro_mes), 'Lucro (mês)')}
      ${finCard('💰', fmt(resumo.saldo_caixa), 'Caixa')}
      ${finCard('📥', fmt(resumo.a_receber), 'A receber')}
      ${finCard('📤', fmt(resumo.a_pagar), 'A pagar')}
      ${finCard('🚨', (a.critico || 0) + '/' + (a.atencao || 0), 'Alertas crít./atenção', '', a.critico ? 'neg' : '')}
    </div>
    <div class="ia-pergunta">
      <input id="ia-q" placeholder="Pergunte ao assistente (ex.: o que preciso resolver hoje? como está o lucro?)" autocomplete="off">
      <button class="ia-ask" id="ia-ask">Perguntar</button>
    </div>
    <div id="ia-resposta"></div>
    <div class="ia-insights">
      ${insights.total ? areasComInsight.map(([area, arr]) => `<div class="ia-area"><div class="ia-area-tit">${IA_AREA[area] || area} <span class="ia-area-n">${arr.length}</span></div><div class="ia-area-lista">${arr.map(insightCard).join('')}</div></div>`).join('')
        : '<div class="ia-vazio">✅ Nenhum alerta agora — está tudo em ordem.</div>'}
    </div>
    <p class="fin-hint">O assistente lê o que o ERP já tem e apenas sugere. Ações com impacto financeiro, de estoque ou fiscal você confirma no módulo — a IA nunca executa sozinha.</p>
  </div>`;
  el.querySelectorAll('[data-ia-goto]').forEach(b => b.addEventListener('click', () => irPara(b.dataset.iaGoto)));
  const ask = async () => {
    const q = $('ia-q').value.trim(); if (!q) return;
    $('ia-resposta').innerHTML = '<div class="ia-resp carregando">🤔 pensando…</div>';
    try {
      const r = await (await fetch('/api/assistente/perguntar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pergunta: q }) })).json();
      $('ia-resposta').innerHTML = `<div class="ia-resp"><div class="ia-resp-fonte">${r.ia ? '🤖 ' + (r.modelo || 'IA') : '📊 resposta direta dos dados'}</div><div class="ia-resp-txt">${crmEsc(r.resposta || '').replace(/\n/g, '<br>')}</div></div>`;
    } catch { $('ia-resposta').innerHTML = '<div class="ia-resp">⚠ Falha ao consultar o assistente.</div>'; }
  };
  $('ia-ask').addEventListener('click', ask);
  $('ia-q').addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
}

/* ── FASE 40: Central de Impressão (operacional, simples) — reusa a fila + iframe ── */
let ciEstacao = '';
const ciEstNome = (ch) => ({ balcao: 'Balcão', producao: 'Produção', expedicao: 'Expedição' }[ch] || ch || '—');
async function renderCentralImpressao() {
  const el = $('impressao-conteudo'); el.innerHTML = biLoading();
  let est, fila; try { [est, fila] = await Promise.all([
    (await fetch('/api/impressao/estacoes', { cache: 'no-store' })).json(),
    (await fetch('/api/impressao/fila?status=pendente' + (ciEstacao ? '&estacao=' + ciEstacao : ''), { cache: 'no-store' })).json(),
  ]); } catch { el.innerHTML = biErro(); return; }
  const totalPend = est.estacoes.reduce((a, e) => a + e.pendentes, 0);
  const chips = [{ chave: '', nome: 'Todas', icone: '📋', pendentes: totalPend }].concat(est.estacoes);
  el.innerHTML = `
    <div class="ci-top"><h2 class="ci-title">🖨️ Central de Impressão</h2><button class="ci-refresh" id="ci-refresh">↻ Atualizar</button></div>
    <div class="ci-estacoes">${chips.map(e => `<button class="ci-est ${ciEstacao === e.chave ? 'ativo' : ''}" data-ci-est="${e.chave}">${e.icone || '📋'} ${crmEsc(e.nome)} <span class="ci-badge">${e.pendentes}</span></button>`).join('')}</div>
    <div class="ci-lista">${fila.length ? fila.map(f => `
      <div class="ci-item">
        <div class="ci-item-info"><div class="ci-item-tit">${crmEsc(f.titulo || ('#' + f.referencia_id))}</div>
          <div class="ci-item-sub">${crmEsc(ciEstNome(f.estacao))} · ${crmEsc(f.via || f.tipo)} · ${fmtHora(f.criado_em)}</div></div>
        <div class="ci-item-acoes">
          <button class="ci-btn imprimir" data-ci-imp="${f.id}" data-tipo="${f.tipo}" data-ref="${f.referencia_id || ''}" data-via="${f.via || ''}">🖨️ Imprimir</button>
          <button class="ci-btn ok" data-ci-ok="${f.id}" title="Marcar como impresso">✓</button>
        </div></div>`).join('') : '<div class="ci-vazio">✅ Nada pendente para imprimir.</div>'}</div>`;
  $('ci-refresh').addEventListener('click', renderCentralImpressao);
  el.querySelectorAll('[data-ci-est]').forEach(b => b.addEventListener('click', () => { ciEstacao = b.dataset.ciEst; renderCentralImpressao(); }));
  el.querySelectorAll('[data-ci-imp]').forEach(b => b.addEventListener('click', () => ciImprimirItem(b.dataset)));
  el.querySelectorAll('[data-ci-ok]').forEach(b => b.addEventListener('click', async () => {
    await fetch('/api/impressao/' + b.dataset.ciOk + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'impresso' }) });
    toast('✓ Marcado como impresso'); renderCentralImpressao();
  }));
}
async function ciImprimirItem(ds) {
  const filaId = +ds.ciImp;
  if (ds.tipo === 'pedido' && ds.ref) { await cpImprimir(+ds.ref, ds.via || 'producao', filaId); renderCentralImpressao(); return; }
  // venda / canhoto → monta o comprovante e imprime no mesmo iframe do motor de impressão
  let c; try { c = await (await fetch(`/api/impressao/canhoto/venda/${ds.ref}`, { cache: 'no-store' })).json(); } catch { toast('⚠ Falha ao montar comprovante'); return; }
  if (!c || c.erro) { toast('⚠ Comprovante indisponível'); return; }
  const frame = $('cp-print-frame'); if (!frame) { toast('⚠ Sem área de impressão'); return; }
  try {
    const doc = frame.contentWindow.document; doc.open(); doc.write(ciCanhotoHTML(c)); doc.close();
    frame.contentWindow.focus(); frame.contentWindow.print();
    fetch(`/api/impressao/${filaId}/imprimir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) }).catch(() => {});
    toast('🖨️ Enviado para impressão');
  } catch { toast('⚠ Impressora bloqueada pelo navegador'); }
  renderCentralImpressao();
}
function ciCanhotoHTML(c) {
  const w = c.largura || 80, formas = (c.formas || []).map(f => `<div>${crmEsc(f.forma)}: R$ ${(+f.valor || 0).toFixed(2)}</div>`).join('');
  return `<html><head><meta charset="utf-8"><style>@page{size:${w}mm auto;margin:0}body{font-family:'Courier New',monospace;width:${w}mm;padding:4mm;font-size:12px;color:#000}h3{text-align:center;margin:0 0 4px;font-size:14px}.c{text-align:center}hr{border:0;border-top:1px dashed #000;margin:5px 0}.tot{font-size:15px;font-weight:bold}</style></head><body>
    <h3>${crmEsc(c.loja ? c.loja.nome : '')}</h3><div class="c">COMPROVANTE DE VENDA</div><hr>
    <div>Venda: ${crmEsc(String(c.numero))}</div><div>Data: ${new Date(c.data).toLocaleString('pt-BR')}</div>${c.operador ? `<div>Operador: ${crmEsc(nomeOp(c.operador))}</div>` : ''}
    <hr><div class="tot">TOTAL: R$ ${(+c.total || 0).toFixed(2)}</div>${formas}<hr><div class="c">Obrigado pela preferência!</div></body></html>`;
}
async function cpImprimir(pedidoId, via, filaId) {
  let c; try { c = await (await fetch(`/api/impressao/comanda/${pedidoId}?via=${via || 'producao'}`, { cache: 'no-store' })).json(); } catch { toast('⚠ Falha ao montar comanda'); return false; }
  if (!c || c.erro) { toast('⚠ Comanda indisponível'); return false; }
  const frame = $('cp-print-frame'); if (!frame) return false;
  try {
    const doc = frame.contentWindow.document; doc.open(); doc.write(cpComandaHTML(c)); doc.close();
    frame.contentWindow.focus(); frame.contentWindow.print();
    if (filaId) fetch(`/api/impressao/${filaId}/imprimir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) }).catch(() => {});
    cpBeep('imprimir'); return true;
  } catch (e) {
    if (filaId) fetch(`/api/impressao/${filaId}/imprimir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false }) }).catch(() => {});
    cpBeep('erro'); toast('⚠ Impressora indisponível ou bloqueada pelo navegador'); return false;
  }
}
// engine: processa a fila pendente. Auto só imprime de fato se o operador ligou (gesto do navegador).
async function cpProcessarFila() {
  let fila; try { fila = await (await fetch('/api/impressao/fila?status=pendente', { cache: 'no-store' })).json(); } catch { return; }
  const pedidos = (fila || []).filter(f => f.tipo === 'pedido' && f.referencia_id && !cpFilaImpressa.has(f.id));
  if (!pedidos.length) return;
  $('cp-status').textContent = `● ${pedidos.length} na fila`;
  if (!cpConfig.auto) return;
  for (const f of pedidos) { cpFilaImpressa.add(f.id); await cpImprimir(+f.referencia_id, 'producao', f.id); }
  if (cpAba === 'board') renderCpBoard(true);
}

async function renderCpExpedicao(silencioso) {
  const el = $('cp-expedicao'); if (!silencioso) el.innerHTML = biLoading();
  let g, ents; try { [g, ents] = await Promise.all([(await fetch('/api/producao/pedidos', { cache: 'no-store' })).json(), (await fetch('/api/entregadores?ativos=1')).json()]); } catch { if (!silencioso) el.innerHTML = biErro(); return; }
  const prontosEntrega = g.pronto.filter(p => p.tipo === 'entrega');
  const emRota = g.rota;
  el.innerHTML = `
    ${finBox('✅ Prontos para sair (' + prontosEntrega.length + ')', prontosEntrega.length ? biTabela([{ h: 'Pedido' }, { h: 'Cliente' }, { h: 'Destino' }, { h: 'Pgto' }, { h: 'Espera', cls: 'num' }, { h: '' }],
      prontosEntrega.map(p => [`#${p.numero}`, crmEsc(p.cliente || '—'), crmEsc((p.bairro || p.endereco || '—')), crmEsc(p.pagamento || ''), `${p.min_espera}min`, `<button class="cp-mini" data-cpx="despachar" data-id="${p.id}">🛵 Saiu</button>`])) : biVazio('Nada pronto para entrega.'))}
    ${finBox('🛵 Em rota (' + emRota.length + ')', emRota.length ? biTabela([{ h: 'Pedido' }, { h: 'Cliente' }, { h: 'Entregador' }, { h: 'Há', cls: 'num' }, { h: '' }],
      emRota.map(p => [`#${p.numero}`, crmEsc(p.cliente || '—'), crmEsc(p.entregador || '—'), `${p.min_espera}min`, `<button class="cp-mini" data-cpx="entregar" data-id="${p.id}">✅ Entregue</button>`])) : biVazio('Ninguém em rota.'))}
    <div class="cp-hint">Entregadores ativos: ${ents.map(e => crmEsc(e.nome)).join(', ') || 'nenhum cadastrado'}.</div>`;
}
$('cp-expedicao').addEventListener('click', async e => {
  const b = e.target.closest('[data-cpx]'); if (!b) return;
  const id = +b.dataset.id;
  if (b.dataset.cpx === 'despachar') cpDespachar(id).then(() => renderCpExpedicao());
  else if (b.dataset.cpx === 'entregar') { await fetch(`/api/pedidos/${id}/entregar`, { method: 'POST' }); toast('✅ Entregue'); renderCpExpedicao(); }
});

async function renderCpConfig() {
  const el = $('cp-config');
  let cfg; try { cfg = await (await fetch('/api/impressao/config', { cache: 'no-store' })).json(); } catch { el.innerHTML = biErro(); return; }
  const podeEditar = finPodeLancar();
  el.innerHTML = `
    <div class="fin-box" style="max-width:620px">
      <h3 class="fin-box-tit">⚙️ Configuração de impressão</h3>
      <form id="cp-cfg-form" class="fin-form">
        <div class="fin-frow">
          <label>Largura do papel<select id="cfg-largura"><option value="80" ${cfg.largura === 80 ? 'selected' : ''}>80 mm</option><option value="58" ${cfg.largura === 58 ? 'selected' : ''}>58 mm</option></select></label>
          <label>Cópias por comanda<input type="number" min="1" max="5" id="cfg-copias" value="${cfg.copias || 1}"></label>
        </div>
        <div class="fin-frow">
          <label>Conexão<select id="cfg-conexao"><option value="usb" ${cfg.conexao === 'usb' ? 'selected' : ''}>USB</option><option value="rede" ${cfg.conexao === 'rede' ? 'selected' : ''}>Rede</option></select></label>
          <label>Impressora principal<input id="cfg-principal" value="${crmEsc(cfg.principal || '')}" placeholder="nome/porta (informativo)"></label>
        </div>
        <label>Impressora secundária<input id="cfg-secundaria" value="${crmEsc(cfg.secundaria || '')}" placeholder="opcional"></label>
        <div class="cp-modelos">
          <b>Vias que imprimem:</b>
          <label><input type="checkbox" id="cfg-m-prod" ${cfg.modelos && cfg.modelos.producao ? 'checked' : ''}> Via Produção</label>
          <label><input type="checkbox" id="cfg-m-ent" ${cfg.modelos && cfg.modelos.entrega ? 'checked' : ''}> Via Entrega</label>
          <label><input type="checkbox" id="cfg-m-cli" ${cfg.modelos && cfg.modelos.cliente ? 'checked' : ''}> Via Cliente</label>
        </div>
        <label class="cp-check"><input type="checkbox" id="cfg-auto" ${cfg.auto ? 'checked' : ''}> Impressão automática ao confirmar pedido</label>
        <label class="cp-check"><input type="checkbox" id="cfg-som" ${cfg.som ? 'checked' : ''}> Som ao imprimir / novo pedido</label>
        ${podeEditar ? '<button type="submit" class="fin-btn-salvar">💾 Salvar</button>' : '<p class="fin-hint">Só administrador/supervisor edita a configuração.</p>'}
      </form>
      <div class="cp-print-teste"><button class="cp-mini" id="cp-teste-print">🖨️ Imprimir comanda de teste</button></div>
    </div>`;
  const f = $('cp-cfg-form');
  if (podeEditar) f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const body = { largura: +$('cfg-largura').value, copias: +$('cfg-copias').value, conexao: $('cfg-conexao').value,
      principal: $('cfg-principal').value.trim(), secundaria: $('cfg-secundaria').value.trim(), auto: $('cfg-auto').checked, som: $('cfg-som').checked,
      modelos: { producao: $('cfg-m-prod').checked, entrega: $('cfg-m-ent').checked, cliente: $('cfg-m-cli').checked } };
    const r = await (await fetch('/api/impressao/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    cpConfig = { ...cpConfig, ...body }; $('cp-auto').checked = body.auto; $('cp-som').checked = body.som;
    toast('💾 Configuração salva');
  });
  const bt = $('cp-teste-print'); if (bt) bt.addEventListener('click', () => {
    const frame = $('cp-print-frame');
    const c = { via: 'cliente', loja: { nome: 'Açaí do Centro' }, numero: '000', data: new Date().toISOString(), cliente: 'TESTE', telefone: '', endereco: '', tipo: 'retirada', itens: '1x Açaí 500ml\n1x Granola', obs: 'comanda de teste', pagamento: 'PIX', troco: 0, total: 20, qr: 'acaipedido:teste', largura: +$('cfg-largura').value || 80, copias: 1 };
    const doc = frame.contentWindow.document; doc.open(); doc.write(cpComandaHTML(c)); doc.close(); frame.contentWindow.focus(); frame.contentWindow.print();
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   CUSTOS & RENTABILIDADE (Fase 30) — lotes, rateio ponderado, custo real FIFO,
   rendimento, perdas, rentabilidade, pesos, simulação. Reusa biTabela/biBars.
   ══════════════════════════════════════════════════════════════════════════ */
let cuSub = 'lotes', cuProdutos = [], cuFornecedores = [];
const cuGet = async (rota) => (await fetch('/api/custos/' + rota, { cache: 'no-store' })).json();
async function abrirCustos() {
  try { cuProdutos = await (await fetch('/api/produtos', { cache: 'no-store' })).json(); } catch { cuProdutos = []; }
  try { cuFornecedores = await (await fetch('/api/erp/fornecedores', { cache: 'no-store' })).json(); } catch { cuFornecedores = []; }
  if (!Array.isArray(cuFornecedores)) cuFornecedores = [];
  cuIr(cuSub);
}
function cuIr(sub) {
  cuSub = sub;
  document.querySelectorAll('.cu-menu-item').forEach(b => b.classList.toggle('ativo', b.dataset.cu === sub));
  const R = { lotes: renderCuLotes, rendimentos: renderCuRendimentos, custos_reais: renderCuCustosReais, rentabilidade: renderCuRentabilidade,
    custo_produto: renderCuCustoProduto, formacao_preco: renderCuFormacaoPreco, lucro_bruto: renderCuLucroBruto, rendimento_prep: renderCuRendimentoPrep,
    perfis_producao: renderCuPerfisProducao, ordens_producao: renderCuOrdensProducao,
    perdas: renderCuPerdas, pesos: renderCuPesos, simulacoes: renderCuSimulacoes, historico: renderCuHistorico };
  (R[sub] || renderCuLotes)();
}
document.querySelectorAll('.cu-menu-item').forEach(b => b.addEventListener('click', () => cuIr(b.dataset.cu)));

async function renderCuLotes() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let lotes; try { lotes = await cuGet('lotes'); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const rows = lotes.map(l => [`<a href="#" class="cu-lote-link" data-id="${l.id}">${crmEsc(l.numero)}</a>`, crmEsc(l.fornecedor || '—'), fmtDia(l.data), fmt(l.valor_pago), (l.qtd_recebida || 0) + ' ' + (l.unidade || ''), l.produtos + ' prod', `<span class="cu-status cu-st-${l.status}">${l.status}</span>`]);
  el.innerHTML = `
    ${pode ? `<div class="fin-box"><h3 class="fin-box-tit">📦 Novo lote de produção</h3>${cuFormLoteHTML()}</div>` : ''}
    <div class="fin-box"><h3 class="fin-box-tit">Lotes (${lotes.length})</h3>${biTabela([{ h: 'Lote' }, { h: 'Fornecedor' }, { h: 'Data' }, { h: 'Valor', cls: 'num' }, { h: 'Recebido' }, { h: 'Produtos' }, { h: 'Status' }], rows, 'Nenhum lote ainda.')}</div>`;
  if (pode) cuWireFormLote();
  el.querySelectorAll('.cu-lote-link').forEach(a => a.addEventListener('click', e => { e.preventDefault(); renderCuLoteDetalhe(+a.dataset.id); }));
}
function cuFormLoteHTML() {
  return `<form id="cu-form-lote" class="fin-form">
    <div class="fin-frow"><label>Fornecedor<select id="cl-forn"><option value="">— nenhum —</option>${cuFornecedores.map(f => `<option value="${f.id}">${crmEsc(f.nome)}</option>`).join('')}</select></label><label>Nota Fiscal<input id="cl-nf" placeholder="opcional"></label></div>
    <div class="fin-frow"><label>Valor pago (R$)<input type="number" step="0.01" id="cl-valor" placeholder="0,00"></label><label>Qtd recebida<input type="number" step="0.01" id="cl-qtd" placeholder="ex.: 20"></label><label>Unidade<input id="cl-un" value="kg"></label></div>
    <label>Rendimento previsto (qtd esperada)<input type="number" step="0.01" id="cl-prev" placeholder="opcional"></label>
    <div class="cu-prod-head"><b>Produtos produzidos</b><button type="button" class="fin-mini" id="cl-add">➕ produto</button></div>
    <div id="cl-produtos"></div>
    <button type="submit" class="fin-btn-salvar">💾 Criar lote (rateia automático)</button></form>`;
}
function cuLinhaProduto() {
  const opts = cuProdutos.map(p => `<option value="${p.codigo}">${crmEsc(p.nome)}</option>`).join('');
  const div = document.createElement('div'); div.className = 'cu-prod-linha';
  div.innerHTML = `<select class="cl-p-cod">${opts}</select><input type="number" step="0.01" class="cl-p-qtd" placeholder="qtd produzida"><input type="number" step="0.01" class="cl-p-preco" placeholder="preço venda"><button type="button" class="fin-mini cl-p-del">✕</button>`;
  div.querySelector('.cl-p-del').addEventListener('click', () => div.remove());
  return div;
}
function cuWireFormLote() {
  const cont = $('cl-produtos'); cont.appendChild(cuLinhaProduto()); cont.appendChild(cuLinhaProduto());
  $('cl-add').addEventListener('click', () => cont.appendChild(cuLinhaProduto()));
  $('cu-form-lote').addEventListener('submit', async e => {
    e.preventDefault();
    const produtos = [...cont.querySelectorAll('.cu-prod-linha')].map(d => { const cod = d.querySelector('.cl-p-cod').value; const prod = cuProdutos.find(p => p.codigo === cod); return { codigo: cod, nome: prod ? prod.nome : cod, qtd_produzida: +d.querySelector('.cl-p-qtd').value || 0, preco_venda: +d.querySelector('.cl-p-preco').value || (prod ? prod.precoVenda : 0) }; }).filter(p => p.qtd_produzida > 0);
    if (!produtos.length) { toast('⚠ Informe ao menos um produto com quantidade'); return; }
    const body = { fornecedor_id: +$('cl-forn').value || null, nota_fiscal: $('cl-nf').value.trim(), valor_pago: +$('cl-valor').value || 0, qtd_recebida: +$('cl-qtd').value || 0, unidade: $('cl-un').value.trim() || 'kg', rendimento_previsto: +$('cl-prev').value || 0, produtos };
    const r = await (await fetch('/api/custos/lotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    toast('📦 Lote criado e rateado'); renderCuLoteDetalhe(r.id);
  });
}
async function renderCuLoteDetalhe(id) {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let l; try { l = await cuGet('lotes/' + id); } catch { el.innerHTML = biErro(); return; }
  const rows = l.produtos.map(p => [crmEsc(p.nome), p.qtd_produzida, p.peso_custo, fmt(p.custo_unitario), fmt(p.preco_venda), p.qtd_vendida, p.qtd_perdida, `<b>${p.qtd_restante}</b>`,
    finPodeLancar() && p.qtd_restante > 0 ? `<button class="fin-mini cu-perda" data-lp="${p.id}" data-nome="${crmEsc(p.nome)}">🗑️</button>` : '']);
  el.innerHTML = `<button class="fin-mini" id="cu-voltar">← voltar</button>
    <div class="fin-box"><h3 class="fin-box-tit">📦 Lote ${crmEsc(l.numero)} · ${crmEsc(l.fornecedor || 'sem fornecedor')}</h3>
      <div class="cu-lote-resumo"><span>Valor: <b>${fmt(l.valor_pago)}</b></span><span>Recebido: <b>${l.qtd_recebida} ${l.unidade || ''}</b></span><span>Status: <b>${l.status}</b></span><span>Data: <b>${fmtDataHora(l.data)}</b></span></div>
      ${biTabela([{ h: 'Produto' }, { h: 'Produzida', cls: 'num' }, { h: 'Peso', cls: 'num' }, { h: 'Custo un.', cls: 'num' }, { h: 'Preço', cls: 'num' }, { h: 'Vendida', cls: 'num' }, { h: 'Perdida', cls: 'num' }, { h: 'Restante', cls: 'num' }, { h: '' }], rows)}</div>`;
  $('cu-voltar').addEventListener('click', renderCuLotes);
  el.querySelectorAll('.cu-perda').forEach(b => b.addEventListener('click', () => cuRegistrarPerda(b.dataset.lp, b.dataset.nome, id)));
}
async function cuRegistrarPerda(lpId, nome, loteId) {
  const tipo = prompt(`Tipo de perda de "${nome}"?\n(descarte / deterioracao / degustacao / erro_producao / quebra)`, 'descarte'); if (!tipo) return;
  const qtd = prompt('Quantidade perdida:'); if (qtd == null) return;
  const r = await (await fetch('/api/custos/perdas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lote_produto_id: +lpId, tipo: tipo.trim(), qtd: +qtd }) })).json();
  if (r.erro) { toast('⚠ ' + r.erro); return; }
  toast(`🗑️ Perda registrada (custo ${fmt(r.custoTotal)} → saída no Financeiro)`); renderCuLoteDetalhe(loteId);
}
async function renderCuRendimentos() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await cuGet('rendimentos'); } catch { el.innerHTML = biErro(); return; }
  const rows = d.map(r => [crmEsc(r.numero), crmEsc(r.fornecedor || '—'), (r.qtd_recebida || 0) + ' ' + (r.unidade || ''), r.previsto, r.produzido, r.diferenca, r.perdas, r.rendimento != null ? r.rendimento + '%' : '—', r.eficiencia != null ? r.eficiencia + '%' : '—']);
  el.innerHTML = finBox('🌾 Rendimento por lote', biTabela([{ h: 'Lote' }, { h: 'Fornecedor' }, { h: 'Recebido' }, { h: 'Previsto', cls: 'num' }, { h: 'Produzido', cls: 'num' }, { h: 'Dif.', cls: 'num' }, { h: 'Perdas', cls: 'num' }, { h: 'Rend.', cls: 'num' }, { h: 'Efic.', cls: 'num' }], rows, 'Nenhum lote finalizado.'));
}
async function renderCuCustosReais() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await cuGet('custos-reais?periodo=tudo'); } catch { el.innerHTML = biErro(); return; }
  const rows = d.map(r => [crmEsc(r.nome), crmEsc(r.lote_numero || '—'), r.qtd, fmt(r.custo_unitario), fmt(r.preco_unitario), fmt(r.custo_total), fmt(r.receita), `<span class="fin-val ${r.lucro >= 0 ? 'entrada' : 'saida'}">${fmt(r.lucro)}</span>`, r.margem + '%']);
  el.innerHTML = finBox('💵 Custo real por item vendido (FIFO)', biTabela([{ h: 'Produto' }, { h: 'Lote' }, { h: 'Qtd', cls: 'num' }, { h: 'Custo un.', cls: 'num' }, { h: 'Preço', cls: 'num' }, { h: 'Custo', cls: 'num' }, { h: 'Receita', cls: 'num' }, { h: 'Lucro', cls: 'num' }, { h: 'Margem', cls: 'num' }], rows, 'Nenhuma venda consumiu lote ainda (crie lotes com os produtos que você vende).'));
}
async function renderCuRentabilidade() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let d, ind; try { [d, ind] = await Promise.all([cuGet('rentabilidade?periodo=tudo'), cuGet('indicadores?periodo=tudo')]); } catch { el.innerHTML = biErro(); return; }
  const tab = (lista, colNome) => biTabela([{ h: colNome }, { h: 'Receita', cls: 'num' }, { h: 'Custo', cls: 'num' }, { h: 'Lucro', cls: 'num' }, { h: 'Margem', cls: 'num' }], lista.map(p => [crmEsc(p.nome || p.numero || '—'), fmt(p.receita), fmt(p.custo), `<span class="fin-val ${p.lucro >= 0 ? 'entrada' : 'saida'}">${fmt(p.lucro)}</span>`, p.margem + '%']), 'Sem dados.');
  el.innerHTML = `
    <div class="fin-cards bi-cards-4">
      ${finCard('💵', fmt(ind.receita), 'Receita')}${finCard('🧾', fmt(ind.custoReal), 'Custo real')}${finCard('📈', fmt(ind.lucroReal), 'Lucro real', '', ind.lucroReal >= 0 ? 'pos' : 'neg')}${finCard('％', ind.margem + '%', 'Margem')}
    </div>
    <div class="fin-cards bi-cards-4">
      ${finCard('✖️', ind.markup + 'x', 'Markup')}${finCard('🎯', ind.roi + '%', 'ROI')}${finCard('🎫', fmt(ind.ticketMedio), 'Ticket médio')}${finCard('📦', fmt(ind.custoMedioProduto), 'Custo médio/produto')}
    </div>
    ${d.porProduto.length ? finBox('📊 Lucro por produto', biBars(d.porProduto.slice(0, 10).map(p => ({ label: p.nome || p.cod, valor: p.lucro })))) : ''}
    <div class="fin-grid2">${finBox('🥇 Mais lucrativos', tab(d.maisLucrativos, 'Produto'))}${finBox('🥉 Menos lucrativos', tab(d.menosLucrativos, 'Produto'))}</div>
    <div class="fin-grid2">${finBox('📦 Por lote', tab(d.porLote, 'Lote'))}${finBox('🏭 Por fornecedor', tab(d.porFornecedor, 'Fornecedor'))}</div>`;
}
/* ── FASE 35: Custo por Produto · Formação de Preço · Lucro Bruto · Rendimento (prep) ── */
const cuCustoCell = (v) => v == null ? '<small>—</small>' : fmt(v);
const cuMargemCell = (v) => v == null ? '<small>—</small>' : `<span class="fin-val ${v >= 0 ? 'entrada' : 'saida'}">${v}%</span>`;
async function renderCuCustoProduto() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let d, cfg; try { [d, cfg] = await Promise.all([cuGet('produtos'), cuGet('config-custo')]); } catch { el.innerHTML = biErro(); return; }
  const r = d.resumo, pode = finPodeLancar();
  const metOpt = (v, t) => `<option value="${v}" ${cfg.metodo === v ? 'selected' : ''}>${t}</option>`;
  const rows = d.produtos.map(p => [crmEsc(p.nome), fmt(p.preco_venda), cuCustoCell(p.custo_medio), cuCustoCell(p.custo_real), cuCustoCell(p.ultima_compra),
    `<b>${fmt(p.custo_vigente)}</b>`, cuMargemCell(p.margem_vigente), p.markup_vigente != null ? p.markup_vigente + 'x' : '<small>—</small>']);
  el.innerHTML = `
    <div class="fin-cards bi-cards-4">
      ${finCard('📦', r.total, 'Produtos')}${finCard('❓', r.sem_custo, 'Sem custo', '', r.sem_custo ? 'neg' : '')}
      ${finCard('％', r.margem_media + '%', 'Margem média')}${finCard('⚠️', r.margem_negativa, 'Margem negativa', '', r.margem_negativa ? 'neg' : '')}
    </div>
    <div class="fin-filtros">
      <label>Custo vigente por${pode ? '' : ' (leitura)'}<select id="cu-metodo" ${pode ? '' : 'disabled'}>${metOpt('real', '🧾 Custo real (FIFO)')}${metOpt('medio', '⚖️ Custo médio')}${metOpt('ultima', '🛒 Última compra')}</select></label>
      <label>Buscar<input id="cu-cp-busca" placeholder="produto/código"></label>
      <button class="fin-btn-filtrar" id="cu-cp-filtrar">🔎</button>
      <span class="fin-hint">Custo vigente = base escolhida (cai pra próxima quando não há dado).</span>
    </div>
    ${finBox('🏷️ Custo consolidado por produto', biTabela([{ h: 'Produto' }, { h: 'Preço', cls: 'num' }, { h: 'C. médio', cls: 'num' }, { h: 'C. real', cls: 'num' }, { h: 'Últ. compra', cls: 'num' }, { h: 'C. vigente', cls: 'num' }, { h: 'Margem', cls: 'num' }, { h: 'Markup', cls: 'num' }], rows, 'Sem produtos.'))}`;
  const met = $('cu-metodo'); if (met && pode) met.addEventListener('change', async () => {
    await fetch('/api/custos/config-custo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metodo: met.value }) });
    toast('✅ Método de custo: ' + met.value); renderCuCustoProduto();
  });
  const filtrar = async () => {
    const s = ($('cu-cp-busca').value || '').trim();
    const dd = await cuGet('produtos' + (s ? '?busca=' + encodeURIComponent(s) : ''));
    const rr = dd.produtos.map(p => [crmEsc(p.nome), fmt(p.preco_venda), cuCustoCell(p.custo_medio), cuCustoCell(p.custo_real), cuCustoCell(p.ultima_compra), `<b>${fmt(p.custo_vigente)}</b>`, cuMargemCell(p.margem_vigente), p.markup_vigente != null ? p.markup_vigente + 'x' : '<small>—</small>']);
    el.querySelector('.fin-box').innerHTML = `<h3 class="fin-box-tit">🏷️ Custo consolidado por produto</h3>` + biTabela([{ h: 'Produto' }, { h: 'Preço', cls: 'num' }, { h: 'C. médio', cls: 'num' }, { h: 'C. real', cls: 'num' }, { h: 'Últ. compra', cls: 'num' }, { h: 'C. vigente', cls: 'num' }, { h: 'Margem', cls: 'num' }, { h: 'Markup', cls: 'num' }], rr, 'Nada encontrado.');
  };
  $('cu-cp-filtrar').addEventListener('click', filtrar);
  $('cu-cp-busca').addEventListener('keydown', e => { if (e.key === 'Enter') filtrar(); });
}
async function renderCuFormacaoPreco() {
  const el = $('cu-conteudo');
  const opts = (cuProdutos || []).map(p => `<option value="${crmEsc(p.codigo)}">${crmEsc(p.nome)}</option>`).join('');
  el.innerHTML = `<div class="fin-box"><h3 class="fin-box-tit">💰 Formação de preço</h3>
    <p class="fin-hint">Escolha o produto e a margem-alvo — o sistema sugere o preço de venda a partir do <b>custo vigente</b> (markup por dentro: preço = custo ÷ (1 − margem)).</p>
    <div class="fin-frow"><label>Produto<select id="cu-fp-prod">${opts}</select></label><label>Margem-alvo (%)<input type="number" step="0.5" id="cu-fp-margem" value="50"></label>
      <label>&nbsp;<button class="fin-btn-filtrar" id="cu-fp-calc">Calcular</button></label></div>
    <div id="cu-fp-res"></div></div>`;
  const calc = async () => {
    const cod = $('cu-fp-prod').value, m = +$('cu-fp-margem').value || 0;
    const d = await cuGet(`formacao-preco?codigo=${encodeURIComponent(cod)}&margem=${m}`);
    const difCls = (d.diferenca || 0) > 0 ? 'saida' : 'entrada';
    $('cu-fp-res').innerHTML = `<div class="fin-cards bi-cards-4">
      ${finCard('🧾', fmt(d.custo), 'Custo vigente')}${finCard('🎯', fmt(d.preco_sugerido), 'Preço sugerido', d.markup ? d.markup + 'x markup' : '')}
      ${finCard('🏷️', fmt(d.preco_atual), 'Preço atual', d.margem_atual != null ? d.margem_atual + '% margem' : '')}
      ${finCard(((d.diferenca || 0) > 0 ? '⬆️' : '⬇️'), fmt(Math.abs(d.diferenca || 0)), (d.diferenca || 0) > 0 ? 'Subir p/ meta' : 'Folga sobre a meta', '', difCls === 'saida' ? 'neg' : 'pos')}
    </div>${d.preco_sugerido == null ? '<p class="fin-hint">Sem custo cadastrado ou margem inválida (0–99%).</p>' : ''}`;
  };
  $('cu-fp-calc').addEventListener('click', calc);
  $('cu-fp-prod').addEventListener('change', calc);
  if (opts) calc();
}
let cuLbGroup = 'produto', cuLbPer = 'tudo';
async function renderCuLucroBruto() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await cuGet(`lucro-bruto?group=${cuLbGroup}&periodo=${cuLbPer}`); } catch { el.innerHTML = biErro(); return; }
  const t = d.total, gsel = (v, txt) => `<option value="${v}" ${cuLbGroup === v ? 'selected' : ''}>${txt}</option>`;
  const psel = (v, txt) => `<option value="${v}" ${cuLbPer === v ? 'selected' : ''}>${txt}</option>`;
  let cols, rows;
  if (cuLbGroup === 'venda') { cols = [{ h: 'Venda' }, { h: 'Data' }, { h: 'Receita', cls: 'num' }, { h: 'Custo', cls: 'num' }, { h: 'Lucro', cls: 'num' }, { h: 'Margem', cls: 'num' }];
    rows = d.dados.map(x => [crmEsc(x.numero || ('#' + x.venda_id)), fmtDataHora(x.data), fmt(x.receita), fmt(x.custo), `<span class="fin-val ${x.lucro >= 0 ? 'entrada' : 'saida'}">${fmt(x.lucro)}</span>`, x.margem + '%']); }
  else if (cuLbGroup === 'dia') { cols = [{ h: 'Dia' }, { h: 'Receita', cls: 'num' }, { h: 'Custo', cls: 'num' }, { h: 'Lucro', cls: 'num' }, { h: 'Margem', cls: 'num' }];
    rows = d.dados.map(x => [x.dia, fmt(x.receita), fmt(x.custo), `<span class="fin-val ${x.lucro >= 0 ? 'entrada' : 'saida'}">${fmt(x.lucro)}</span>`, x.margem + '%']); }
  else { cols = [{ h: 'Produto' }, { h: 'Qtd', cls: 'num' }, { h: 'Receita', cls: 'num' }, { h: 'Custo', cls: 'num' }, { h: 'Lucro', cls: 'num' }, { h: 'Margem', cls: 'num' }];
    rows = d.dados.map(x => [crmEsc(x.nome || x.cod), x.qtd, fmt(x.receita), fmt(x.custo), `<span class="fin-val ${x.lucro >= 0 ? 'entrada' : 'saida'}">${fmt(x.lucro)}</span>`, x.margem + '%']); }
  el.innerHTML = `
    <div class="fin-cards bi-cards-4">${finCard('💵', fmt(t.receita), 'Receita')}${finCard('🧾', fmt(t.custo), 'Custo (FIFO)')}${finCard('📈', fmt(t.lucro), 'Lucro bruto', '', t.lucro >= 0 ? 'pos' : 'neg')}${finCard('％', t.margem + '%', 'Margem')}</div>
    <div class="fin-filtros">
      <label>Agrupar por<select id="cu-lb-group">${gsel('produto', 'Produto')}${gsel('venda', 'Venda')}${gsel('dia', 'Dia')}</select></label>
      <label>Período<select id="cu-lb-per">${psel('tudo', 'Tudo')}${psel('hoje', 'Hoje')}${psel('7d', '7 dias')}${psel('30d', '30 dias')}${psel('mes', 'Este mês')}</select></label>
      <span class="fin-hint">Lucro bruto = receita − custo real (FIFO dos lotes). Sem lote consumido, fica zerado.</span>
    </div>
    ${finBox('📊 Lucro bruto — ' + d.periodo.label, biTabela(cols, rows, 'Sem vendas com custo apurado no período.'))}`;
  $('cu-lb-group').addEventListener('change', e => { cuLbGroup = e.target.value; renderCuLucroBruto(); });
  $('cu-lb-per').addEventListener('change', e => { cuLbPer = e.target.value; renderCuLucroBruto(); });
}
async function renderCuRendimentoPrep() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let lista; try { lista = await cuGet('rendimento-perfil'); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const mapa = new Map(lista.map(x => [x.produto_codigo, x]));
  const rows = (cuProdutos || []).map(p => { const rp = mapa.get(p.codigo) || {};
    return [crmEsc(p.nome), `<input type="number" step="0.1" class="cu-rp-inp" data-cod="${crmEsc(p.codigo)}" data-f="rendimento_esperado" value="${rp.rendimento_esperado ?? ''}" ${pode ? '' : 'disabled'} style="width:80px">`,
      `<input type="number" step="0.01" class="cu-rp-inp" data-cod="${crmEsc(p.codigo)}" data-f="fator_rateio" value="${rp.fator_rateio ?? ''}" ${pode ? '' : 'disabled'} style="width:80px">`,
      `<input type="number" step="0.01" class="cu-rp-inp" data-cod="${crmEsc(p.codigo)}" data-f="custo_alvo" value="${rp.custo_alvo ?? ''}" ${pode ? '' : 'disabled'} style="width:80px">`,
      pode ? `<button class="fin-mini cu-rp-save" data-cod="${crmEsc(p.codigo)}">💾</button>` : '']; });
  el.innerHTML = `<div class="cu-prep-banner">🌾 <b>Estrutura de preparação (Fase 35).</b> Aqui você já pode registrar o <b>rendimento esperado</b>, o <b>fator de rateio</b> e o <b>custo-alvo</b> de cada produto. ⚠️ Isto ainda <b>NÃO altera a produção nem o custo real</b> — é a base pronta para o <b>rateio avançado da produção de açaí</b> de uma fase futura.</div>
    ${finBox('🌾 Perfil de rendimento por produto (preparação)', biTabela([{ h: 'Produto' }, { h: 'Rend. esperado', cls: 'num' }, { h: 'Fator rateio', cls: 'num' }, { h: 'Custo-alvo', cls: 'num' }, { h: '' }], rows, 'Sem produtos.'))}`;
  el.querySelectorAll('.cu-rp-save').forEach(b => b.addEventListener('click', async () => {
    const cod = b.dataset.cod, body = {};
    el.querySelectorAll(`.cu-rp-inp[data-cod="${cod}"]`).forEach(i => { if (i.value !== '') body[i.dataset.f] = +i.value; });
    body.ativo = 1;
    const r = await (await fetch('/api/custos/rendimento-perfil/' + encodeURIComponent(cod), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; } toast('🌾 Perfil salvo (preparação — não afeta a produção ainda)');
  }));
}
/* ── FASE 38: Produção Avançada (preparação) — Perfis + Ordens ── */
const cuPA = async (rota, method, body) => (await fetch('/api/producao-avancada/' + rota, { method: method || 'GET', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })).json();
const cuPrepBanner = () => `<div class="cu-prep-banner">🏭 <b>Produção Avançada — estrutura de preparação (Fase 38).</b> Você já pode cadastrar <b>perfis de produção</b> (uma matéria-prima que rende vários produtos) e registrar <b>ordens</b> com o rateio de custo. ⚠️ Nesta fase é <b>arquitetura genérica</b>: as ordens são <b>registro/simulação</b> — <b>ainda NÃO baixam estoque, não geram lote FIFO nem lançam no financeiro</b>. Essa ativação vem numa fase futura, sem retrabalho.</div>`;

async function renderCuPerfisProducao() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let perfis; try { perfis = await cuPA('perfis'); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const rows = perfis.map(p => [crmEsc(p.nome), crmEsc(p.materia_nome || p.materia_ref || '—'), `${crmEsc(p.materia_unidade || '')}`, crmEsc(p.metodo_rateio), p.saidas + ' saída(s)',
    `<span class="cu-status cu-st-${p.ativo ? 'finalizado' : 'cancelado'}">${p.ativo ? 'ativo' : 'inativo'}</span>`,
    pode ? `<button class="fin-mini" data-pa-sim="${p.id}">🧮 Simular</button> <button class="fin-mini" data-pa-edit="${p.id}">✏️</button> <button class="fin-mini" data-pa-del="${p.id}">🗑</button>` : '']);
  el.innerHTML = cuPrepBanner() +
    `<div class="erp-topo"><span class="fin-flex"></span>${pode ? '<button class="fin-mini" data-pa-novo="1">➕ Novo perfil</button>' : ''}</div>` +
    finBox('🏭 Perfis de produção', biTabela([{ h: 'Perfil' }, { h: 'Matéria-prima' }, { h: 'Unid.' }, { h: 'Método' }, { h: 'Saídas' }, { h: 'Status' }, { h: '' }], rows, 'Nenhum perfil ainda — crie o primeiro (ex.: “Açaí da saca → Grosso/Médio/Fino”).'));
  el.querySelectorAll('[data-pa-novo]').forEach(b => b.addEventListener('click', () => cuPerfilForm()));
  el.querySelectorAll('[data-pa-edit]').forEach(b => b.addEventListener('click', async () => cuPerfilForm(await cuPA('perfis/' + b.dataset.paEdit))));
  el.querySelectorAll('[data-pa-sim]').forEach(b => b.addEventListener('click', () => cuSimularPerfil(+b.dataset.paSim)));
  el.querySelectorAll('[data-pa-del]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Excluir este perfil?')) return; const r = await cuPA('perfis/' + b.dataset.paDel, 'DELETE'); if (r.erro) { toast('⚠ ' + r.erro); return; } toast('🗑 Excluído'); renderCuPerfisProducao(); }));
}
function cuSaidaRow(s = {}) {
  return `<div class="cu-saida-row">
    <input class="pa-s-cod" placeholder="cód. produto (opcional)" value="${crmEsc(s.produto_codigo || '')}">
    <input class="pa-s-nome" placeholder="nome da saída" value="${crmEsc(s.nome || '')}">
    <input class="pa-s-peso" type="number" step="0.05" placeholder="peso" value="${s.peso_rateio ?? 1}" title="peso de rateio">
    <input class="pa-s-rend" type="number" step="0.01" placeholder="rend./unid" value="${s.rendimento_esperado ?? ''}" title="rendimento esperado por unidade de matéria">
    <button type="button" class="fin-mini cu-saida-del">✕</button></div>`;
}
function cuPerfilForm(p) {
  const ed = !!p;
  abrirErpModal(`<h3 class="erp-modal-tit">🏭 ${ed ? 'Editar' : 'Novo'} perfil de produção</h3>
    <form id="pa-form" class="fin-form">
      <div class="fin-frow"><label>Nome<input id="pa-nome" value="${ed ? crmEsc(p.nome) : ''}" placeholder="ex.: Açaí da saca"></label>
        <label>Método de rateio<select id="pa-metodo"><option value="peso">Peso (ponderado)</option><option value="percentual">Percentual</option></select></label></div>
      <div class="fin-frow"><label>Matéria-prima<input id="pa-mat" value="${ed ? crmEsc(p.materia_nome || '') : ''}" placeholder="ex.: Açaí em caroço"></label>
        <label>Unidade<input id="pa-unid" value="${ed ? crmEsc(p.materia_unidade || 'kg') : 'kg'}" style="width:80px"></label>
        <label>Rend. total<input id="pa-rend" type="number" step="0.01" value="${ed && p.rendimento_esperado != null ? p.rendimento_esperado : ''}" style="width:90px" title="rendimento total esperado por unidade de matéria"></label></div>
      <div class="cu-saidas-lbl">Produtos gerados (saídas) <button type="button" class="fin-mini" id="pa-add-saida">➕ saída</button></div>
      <div id="pa-saidas">${(ed && p.saidas && p.saidas.length ? p.saidas : [{}, {}]).map(cuSaidaRow).join('')}</div>
      <button type="submit" class="fin-btn-salvar">💾 Salvar perfil</button></form>`);
  if (ed) $('pa-metodo').value = p.metodo_rateio || 'peso';
  const wire = () => $('pa-saidas').querySelectorAll('.cu-saida-del').forEach(b => b.onclick = () => b.closest('.cu-saida-row').remove());
  wire();
  $('pa-add-saida').addEventListener('click', () => { $('pa-saidas').insertAdjacentHTML('beforeend', cuSaidaRow()); wire(); });
  $('pa-form').addEventListener('submit', async e => {
    e.preventDefault();
    const nome = $('pa-nome').value.trim(); if (!nome) { toast('⚠ Informe o nome'); return; }
    const saidas = [...$('pa-saidas').querySelectorAll('.cu-saida-row')].map((r, i) => ({ produto_codigo: r.querySelector('.pa-s-cod').value.trim() || null, nome: r.querySelector('.pa-s-nome').value.trim(),
      peso_rateio: +r.querySelector('.pa-s-peso').value || 1, rendimento_esperado: +r.querySelector('.pa-s-rend').value || null, ordem: i })).filter(s => s.produto_codigo || s.nome);
    const body = { nome, metodo_rateio: $('pa-metodo').value, materia_nome: $('pa-mat').value.trim(), materia_unidade: $('pa-unid').value.trim() || 'kg', rendimento_esperado: +$('pa-rend').value || null, saidas };
    const r = await cuPA(ed ? 'perfis/' + p.id : 'perfis', ed ? 'PUT' : 'POST', body);
    if (r.erro) { toast('⚠ ' + r.erro); return; } toast('✅ Perfil salvo'); fecharErpModal(); renderCuPerfisProducao();
  });
}
async function cuSimularPerfil(id) {
  const p = await cuPA('perfis/' + id);
  abrirErpModal(`<h3 class="erp-modal-tit">🧮 Simular rateio — ${crmEsc(p.nome)}</h3>
    <form id="pa-sim-form" class="fin-form">
      <div class="fin-frow"><label>Qtd de matéria (${crmEsc(p.materia_unidade || '')})<input id="pa-sim-qtd" type="number" step="0.01" value="100"></label>
        <label>Custo total da matéria (R$)<input id="pa-sim-custo" type="number" step="0.01" value="500"></label>
        <label>&nbsp;<button class="fin-btn-filtrar" type="submit">Calcular</button></label></div>
    </form><div id="pa-sim-res"></div>`);
  const calc = async e => { if (e) e.preventDefault();
    const r = await cuPA('perfis/' + id + '/simular', 'POST', { materia_qtd: +$('pa-sim-qtd').value || 0, materia_custo_total: +$('pa-sim-custo').value || 0 });
    $('pa-sim-res').innerHTML = biTabela([{ h: 'Produto' }, { h: 'Qtd', cls: 'num' }, { h: 'Custo un.', cls: 'num' }, { h: 'Custo total', cls: 'num' }],
      r.linhas.map(l => [crmEsc(l.nome), l.qtd, fmt(l.custo_unitario), fmt(l.custo_total)]), 'Sem saídas.') +
      `<div class="cu-lote-resumo"><span>Método: <b>${r.metodo}</b></span><span>Distribuído: <b>${fmt(r.custo_distribuido)}</b></span><span>Diferença: <b>${fmt(r.diferenca)}</b></span></div>`;
  };
  $('pa-sim-form').addEventListener('submit', calc); calc();
}

async function renderCuOrdensProducao() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let ordens, ind, perfis; try { [ordens, ind, perfis] = await Promise.all([cuPA('ordens'), cuPA('indicadores'), cuPA('perfis')]); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const stCls = { rascunho: 'aberto', planejada: 'aberto', concluida: 'finalizado', cancelada: 'cancelado' };
  const rows = ordens.map(o => [crmEsc(o.numero), crmEsc(o.perfil_nome || '—'), fmtDia(o.data), `${o.materia_qtd || 0}`, fmt(o.materia_custo_total),
    o.rendimento_real != null ? o.rendimento_real : '—', `<span class="cu-status cu-st-${stCls[o.status] || 'aberto'}">${o.status}</span>`,
    `<button class="fin-mini" data-po-ver="${o.id}">👁</button>${pode && o.status !== 'concluida' && o.status !== 'cancelada' ? ` <button class="fin-mini" data-po-concluir="${o.id}">✅ Concluir</button>` : ''}`]);
  el.innerHTML = cuPrepBanner() +
    `<div class="fin-cards bi-cards-4">${finCard('🏭', ind.total_ordens, 'Ordens concluídas')}${finCard('⚖️', ind.resumo.materia_total, 'Matéria processada')}${finCard('📦', ind.resumo.produzido_total, 'Produzido')}${finCard('💰', fmt(ind.resumo.custo_total), 'Custo total')}</div>` +
    `<div class="erp-topo"><span class="fin-flex"></span>${pode && perfis.length ? '<button class="fin-mini" data-po-nova="1">➕ Nova ordem</button>' : ''}</div>` +
    finBox('📋 Ordens de produção', biTabela([{ h: 'Nº' }, { h: 'Perfil' }, { h: 'Data' }, { h: 'Matéria', cls: 'num' }, { h: 'Custo', cls: 'num' }, { h: 'Rend.', cls: 'num' }, { h: 'Status' }, { h: '' }], rows, perfis.length ? 'Nenhuma ordem — crie a primeira.' : 'Crie um Perfil de Produção antes.'));
  el.querySelectorAll('[data-po-nova]').forEach(b => b.addEventListener('click', () => cuOrdemForm(perfis)));
  el.querySelectorAll('[data-po-ver]').forEach(b => b.addEventListener('click', () => cuOrdemDetalhe(+b.dataset.poVer)));
  el.querySelectorAll('[data-po-concluir]').forEach(b => b.addEventListener('click', () => cuConcluirOrdem(+b.dataset.poConcluir)));
}
function cuOrdemForm(perfis) {
  const forn = (typeof cuFornecedores !== 'undefined' && Array.isArray(cuFornecedores)) ? cuFornecedores : [];
  abrirErpModal(`<h3 class="erp-modal-tit">📋 Novo lote de produção</h3>
    <form id="po-form" class="fin-form">
      <div class="fin-frow"><label>Perfil<select id="po-perfil">${perfis.filter(p => p.ativo).map(p => `<option value="${p.id}">${crmEsc(p.nome)}</option>`).join('')}</select></label>
        <label>Fornecedor das sacas<select id="po-forn"><option value="">—</option>${forn.map(f => `<option value="${f.id}">${crmEsc(f.nome)}</option>`).join('')}</select></label></div>
      <div class="fin-frow"><label>Qtd de sacas<input id="po-qtd" type="number" step="0.01" value="0"></label>
        <label>Valor total das sacas (R$)<input id="po-custo" type="number" step="0.01" value="0"></label></div>
      <p class="fin-hint">Cria o lote como <b>planejado</b>. Ao concluir, você informa os <b>litros produzidos</b> de cada tipo — o sistema calcula rendimento e custo médio por litro.</p>
      <button type="submit" class="fin-btn-salvar">💾 Criar lote</button></form>`);
  $('po-form').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await cuPA('ordens', 'POST', { perfil_id: +$('po-perfil').value, fornecedor_id: +$('po-forn').value || null, materia_qtd: +$('po-qtd').value || 0, materia_custo_total: +$('po-custo').value || 0, status: 'planejada' });
    if (r.erro) { toast('⚠ ' + r.erro); return; } toast('✅ Lote ' + r.numero + ' criado'); fecharErpModal(); renderCuOrdensProducao();
  });
}
// Concluir lote: operador informa os LITROS produzidos por tipo (decisão oficial — rendimento medido no fim)
async function cuConcluirOrdem(id) {
  const o = await cuPA('ordens/' + id);
  abrirErpModal(`<h3 class="erp-modal-tit">✅ Concluir lote ${crmEsc(o.numero)}</h3>
    <form id="po-conc" class="fin-form">
      <div class="cu-lote-resumo"><span>Sacas: <b>${o.materia_qtd || 0}</b></span><span>Valor: <b>${fmt(o.materia_custo_total)}</b></span>${o.fornecedor_nome ? `<span>Fornecedor: <b>${crmEsc(o.fornecedor_nome)}</b></span>` : ''}</div>
      <p class="fin-hint">Informe os <b>litros produzidos</b> de cada tipo:</p>
      ${(o.saidas || []).map(s => `<div class="fin-frow"><label>${crmEsc(s.nome || s.produto_codigo)} (litros)<input type="number" step="0.01" class="po-litros" data-sid="${s.id}" value="${s.qtd_prevista || 0}"></label></div>`).join('')}
      <button type="submit" class="fin-btn-salvar">✅ Concluir e calcular</button></form>`);
  $('po-conc').addEventListener('submit', async e => {
    e.preventDefault();
    const produzido = {}; document.querySelectorAll('.po-litros').forEach(i => produzido[i.dataset.sid] = +i.value || 0);
    const r = await cuPA('ordens/' + id, 'PUT', { status: 'concluida', produzido });
    if (r.erro) { toast('⚠ ' + r.erro); return; }
    const m = r.metricas || {}; toast(`✅ Lote concluído · ${m.litros_totais || 0} L · ${m.custo_medio_litro != null ? 'R$ ' + m.custo_medio_litro + '/L' : ''}`); fecharErpModal(); renderCuOrdensProducao();
  });
}
async function cuOrdemDetalhe(id) {
  const o = await cuPA('ordens/' + id);
  const m = o.metricas || {};
  const rows = (o.saidas || []).map(s => [crmEsc(s.nome || s.produto_codigo), s.qtd_prevista ?? '—', s.qtd_produzida ?? '—', fmt(s.custo_unitario_resultante || 0), fmt(s.subtotal_resultante || 0)]);
  abrirErpModal(`<h3 class="erp-modal-tit">📋 Lote ${crmEsc(o.numero)} · ${crmEsc(o.perfil_nome || '')}</h3>
    <div class="cu-lote-resumo"><span>Status: <b>${o.status}</b></span><span>Sacas: <b>${o.materia_qtd || 0}</b></span><span>Valor: <b>${fmt(o.materia_custo_total)}</b></span>${o.fornecedor_nome ? `<span>Fornecedor: <b>${crmEsc(o.fornecedor_nome)}</b></span>` : ''}</div>
    <div class="cu-lote-resumo"><span>Litros totais: <b>${m.litros_totais ?? '—'}</b></span><span>Rend. médio: <b>${m.rendimento_medio_saca != null ? m.rendimento_medio_saca + ' L/saca' : '—'}</b></span><span>Custo médio: <b>${m.custo_medio_litro != null ? fmt(m.custo_medio_litro) + '/L' : '—'}</b></span></div>
    ${biTabela([{ h: 'Saída' }, { h: 'Prevista', cls: 'num' }, { h: 'Produzida', cls: 'num' }, { h: 'Custo un.', cls: 'num' }, { h: 'Subtotal', cls: 'num' }], rows, 'Sem saídas.')}
    <p class="fin-hint">Registro/simulação — não afeta estoque, lote de custo nem financeiro nesta fase.</p>`);
}

async function renderCuPerdas() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await cuGet('perdas'); } catch { el.innerHTML = biErro(); return; }
  const rows = d.map(p => [fmtDataHora(p.data), crmEsc(p.nome), crmEsc(p.lote_numero || '—'), crmEsc(p.tipo), p.qtd, fmt(p.custo_total), crmEsc(nomeOp(p.operador))]);
  el.innerHTML = finBox('🗑️ Perdas registradas', biTabela([{ h: 'Data' }, { h: 'Produto' }, { h: 'Lote' }, { h: 'Tipo' }, { h: 'Qtd', cls: 'num' }, { h: 'Custo', cls: 'num' }, { h: 'Operador' }], rows, 'Nenhuma perda registrada.')) +
    `<p class="fin-hint">Registre perdas pelo detalhe de cada Lote (botão 🗑️). Cada perda vira uma <b>saída no Financeiro</b> (categoria "Perda"), pelo custo real do lote.</p>`;
}
async function renderCuPesos() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await cuGet('pesos'); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const rows = d.map(p => [crmEsc(p.nome), crmEsc(p.codigo), pode ? `<input type="number" step="0.05" class="cu-peso-inp" data-cod="${crmEsc(p.codigo)}" value="${p.peso}">` : p.peso, pode ? `<button class="fin-mini cu-peso-save" data-cod="${crmEsc(p.codigo)}">💾</button>` : '']);
  el.innerHTML = finBox('⚖️ Pesos de custo (rateio inteligente)', `<p class="fin-hint">O custo do lote é distribuído por esses pesos — <b>não é média simples</b>. Ex.: Popular 1,00 · Médio 1,25 · Top 1,55 · Grosso 1,90 · Premium 2,30. Mudar o peso <b>não recalcula lotes antigos</b> (o peso fica congelado no lote).</p>` +
    biTabela([{ h: 'Produto' }, { h: 'Código' }, { h: 'Peso', cls: 'num' }, { h: '' }], rows, 'Sem produtos.'));
  el.querySelectorAll('.cu-peso-save').forEach(b => b.addEventListener('click', async () => {
    const cod = b.dataset.cod, inp = el.querySelector(`.cu-peso-inp[data-cod="${cod}"]`), peso = +inp.value;
    const r = await (await fetch('/api/custos/pesos/' + encodeURIComponent(cod), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ peso }) })).json();
    if (r.erro) { toast('⚠ ' + r.erro); return; } toast('⚖️ Peso salvo (vale pros próximos lotes)');
  }));
}
function renderCuSimulacoes() {
  const el = $('cu-conteudo');
  el.innerHTML = `<div class="fin-box"><h3 class="fin-box-tit">🧮 Simulação (não altera nada real)</h3>
    <form id="cu-sim-form" class="fin-form">
      <label>Valor pago pelo lote (R$)<input type="number" step="0.01" id="sim-valor" placeholder="ex.: 120"></label>
      <div class="cu-prod-head"><b>Produtos</b><button type="button" class="fin-mini" id="sim-add">➕ produto</button></div>
      <div id="sim-produtos"></div>
      <button type="submit" class="fin-btn-salvar">📊 Simular impacto no lucro</button></form>
    <div id="sim-result"></div></div>`;
  const cont = $('sim-produtos');
  const linha = () => { const div = document.createElement('div'); div.className = 'cu-prod-linha'; div.innerHTML = `<input class="sim-nome" placeholder="nome"><input type="number" step="0.01" class="sim-qtd" placeholder="qtd"><input type="number" step="0.05" class="sim-peso" placeholder="peso" value="1"><input type="number" step="0.01" class="sim-preco" placeholder="preço"><button type="button" class="fin-mini sim-del">✕</button>`; div.querySelector('.sim-del').addEventListener('click', () => div.remove()); return div; };
  cont.appendChild(linha()); cont.appendChild(linha());
  $('sim-add').addEventListener('click', () => cont.appendChild(linha()));
  $('cu-sim-form').addEventListener('submit', async e => {
    e.preventDefault();
    const produtos = [...cont.querySelectorAll('.cu-prod-linha')].map(d => ({ nome: d.querySelector('.sim-nome').value || 'produto', qtd: +d.querySelector('.sim-qtd').value || 0, peso: +d.querySelector('.sim-peso').value || 1, preco: +d.querySelector('.sim-preco').value || 0 })).filter(p => p.qtd > 0);
    const r = await (await fetch('/api/custos/simular', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor_pago: +$('sim-valor').value || 0, produtos }) })).json();
    const rows = r.linhas.map(l => [crmEsc(l.nome), l.qtd, l.peso, fmt(l.custoUnit), fmt(l.preco), `<span class="fin-val ${l.lucroUnit >= 0 ? 'entrada' : 'saida'}">${fmt(l.lucroUnit)}</span>`, l.margem + '%']);
    $('sim-result').innerHTML = `<div class="cu-sim-res">Receita <b>${fmt(r.receita)}</b> · Custo <b>${fmt(r.custo)}</b> · Lucro <b class="${r.lucro >= 0 ? 'fin-pos' : 'fin-neg'}">${fmt(r.lucro)}</b> · Margem <b>${r.margem}%</b> · ROI <b>${r.roi}%</b></div>` +
      biTabela([{ h: 'Produto' }, { h: 'Qtd', cls: 'num' }, { h: 'Peso', cls: 'num' }, { h: 'Custo un.', cls: 'num' }, { h: 'Preço', cls: 'num' }, { h: 'Lucro un.', cls: 'num' }, { h: 'Margem', cls: 'num' }], rows);
  });
}
async function renderCuHistorico() {
  const el = $('cu-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await cuGet('historico'); } catch { el.innerHTML = biErro(); return; }
  el.innerHTML = `
    ${finBox('📦 Últimos lotes', biTabela([{ h: 'Lote' }, { h: 'Data' }, { h: 'Valor', cls: 'num' }, { h: 'Status' }], d.lotes.map(l => [crmEsc(l.numero), fmtDia(l.data), fmt(l.valor_pago), l.status]), 'Nenhum lote.'))}
    ${finBox('🗑️ Últimas perdas', biTabela([{ h: 'Data' }, { h: 'Produto' }, { h: 'Tipo' }, { h: 'Qtd', cls: 'num' }, { h: 'Custo', cls: 'num' }], d.perdas.map(p => [fmtDia(p.data), crmEsc(p.nome), crmEsc(p.tipo), p.qtd, fmt(p.custo_total)]), 'Nenhuma perda.'))}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   COMPRAS PROFISSIONAIS (Fase 31) — ciclo Solicitação→Cotação→Pedido→
   Recebimento→integração. Reusa biTabela/finBox/finCard. ═══════════════════ */
let cxSub = 'solicitacoes', cxProdutos = [], cxFornecedores = [];
const cxGet = async (rota) => (await fetch('/api/compras-pro/' + rota, { cache: 'no-store' })).json();
const cxOptProd = () => cxProdutos.map(p => `<option value="${p.codigo}">${crmEsc(p.nome)}</option>`).join('');
const cxOptForn = () => cxFornecedores.map(f => `<option value="${f.id}">${crmEsc(f.nome)}</option>`).join('');
const cxStatusCls = s => s === 'recebido' || s === 'finalizado' || s === 'fechada' || s === 'aprovado' ? 'finalizado' : s === 'cancelado' ? 'cancelado' : 'aberto';
async function abrirCompras() {
  try { cxProdutos = await (await fetch('/api/produtos', { cache: 'no-store' })).json(); } catch { cxProdutos = []; }
  try { cxFornecedores = await (await fetch('/api/erp/fornecedores', { cache: 'no-store' })).json(); } catch { cxFornecedores = []; }
  if (!Array.isArray(cxFornecedores)) cxFornecedores = [];
  cxIr(cxSub);
}
function cxIr(sub) {
  cxSub = sub;
  document.querySelectorAll('.cx-menu-item').forEach(b => b.classList.toggle('ativo', b.dataset.cx === sub));
  const R = { solicitacoes: renderCxSolicitacoes, cotacoes: renderCxCotacoes, pedidos: renderCxPedidos, recebimentos: renderCxRecebimentos, notas: renderCxNotas, inteligencia: renderCxInteligencia, relatorios: renderCxRelatorios, historico: renderCxHistorico, fornecedores: renderCxFornecedores };
  (R[sub] || renderCxSolicitacoes)();
}
document.querySelectorAll('.cx-menu-item').forEach(b => b.addEventListener('click', () => cxIr(b.dataset.cx)));

/* ── FASE 45: Compras Inteligentes (gerencial) — dashboard + comparativo + rendimento/custo real + alertas ── */
const CI_SEV = { critico: 'neg', atencao: 'aten', info: '' };
// SVG de linha simples (responsivo via viewBox). pts = [{x:'label', y:number|null}].
function ciLineSVG(pts, opts) {
  opts = opts || {}; const W = 520, H = 150, ml = 44, mr = 12, mt = 12, mb = 24;
  const vals = pts.filter(p => p.y != null).map(p => p.y);
  if (!vals.length) return `<div class="ci-graf-vazio">Sem dados para "${crmEsc(opts.titulo || '')}".</div>`;
  const max = Math.max(...vals), min = Math.min(...vals, opts.zero ? 0 : Math.min(...vals));
  const span = (max - min) || 1, iw = W - ml - mr, ih = H - mt - mb;
  const xAt = i => ml + (pts.length <= 1 ? iw / 2 : iw * i / (pts.length - 1));
  const yAt = v => mt + ih - ih * (v - min) / span;
  let d = '', dots = '', last = null;
  pts.forEach((p, i) => { if (p.y == null) return; const x = xAt(i), y = yAt(p.y); d += (last == null ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' '; last = i; dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${opts.cor || '#7c3aed'}"><title>${crmEsc(p.x)}: ${opts.fmt ? opts.fmt(p.y) : p.y}</title></circle>`; });
  const labels = pts.map((p, i) => `<text x="${xAt(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ci-graf-lbl">${crmEsc(p.x)}</text>`).join('');
  const gy = [max, (max + min) / 2, min].map(v => `<text x="${ml - 6}" y="${(yAt(v) + 3).toFixed(1)}" text-anchor="end" class="ci-graf-lbl">${opts.fmt ? opts.fmt(v) : Math.round(v * 100) / 100}</text><line x1="${ml}" y1="${yAt(v).toFixed(1)}" x2="${W - mr}" y2="${yAt(v).toFixed(1)}" class="ci-graf-grid"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="ci-graf-svg" preserveAspectRatio="xMidYMid meet">${gy}<path d="${d}" fill="none" stroke="${opts.cor || '#7c3aed'}" stroke-width="2"/>${dots}${labels}</svg>`;
}
function ciGrafBox(titulo, svg) { return `<div class="fin-box ci-graf"><h4 class="ci-graf-tit">${titulo}</h4>${svg}</div>`; }
async function ciCarregarGraficos() {
  const cont = $('ci-graficos'); if (!cont) return;
  const per = ($('ci-per') && $('ci-per').value) || 'tudo', forn = ($('ci-forn') && $('ci-forn').value) || '';
  const qs = new URLSearchParams({ periodo: per }); if (forn) qs.set('fornecedor_id', forn);
  cont.innerHTML = biLoading();
  let s, sz; try { [s, sz] = await Promise.all([fetch('/api/erp/inteligencia/series?' + qs, { cache: 'no-store' }).then(r => r.json()), fetch('/api/erp/inteligencia/sazonalidade', { cache: 'no-store' }).then(r => r.json())]); } catch { cont.innerHTML = biErro(); return; }
  const cData = s.compra || [], pData = s.producao || [];
  const preco = cData.map(x => ({ x: x.mes, y: x.preco_saca }));
  const qtd = cData.map(x => ({ x: x.mes, y: x.sacas }));
  const rend = pData.map(x => ({ x: x.mes, y: x.rendimento }));
  const custo = pData.map(x => ({ x: x.mes, y: x.custo_litro }));
  const grafs = `<div class="ci-graf-grid2">
    ${ciGrafBox('🏷️ Preço por saca', ciLineSVG(preco, { titulo: 'Preço por saca', fmt: v => 'R$ ' + (Math.round(v * 100) / 100), cor: '#7c3aed' }))}
    ${ciGrafBox('📦 Sacas compradas', ciLineSVG(qtd, { titulo: 'Sacas', cor: '#0891b2', zero: true }))}
    ${ciGrafBox('💧 Rendimento por saca (L/sc)', ciLineSVG(rend, { titulo: 'Rendimento', cor: '#16a34a' }))}
    ${ciGrafBox('💵 Custo real por litro', ciLineSVG(custo, { titulo: 'Custo/L', fmt: v => 'R$ ' + (Math.round(v * 100) / 100), cor: '#dc2626' }))}
  </div>`;
  // Sazonalidade
  const szRows = (sz.linhas || []).map(l => [l.nome, biNum(l.sacas), l.preco_saca != null ? fmt(l.preco_saca) : '—', l.rendimento != null ? l.rendimento + ' L/sc' : '—', l.custo_litro != null ? fmt(l.custo_litro) : '—']);
  const szHead = sz.melhorPeriodo ? `<p class="fin-hint">🥇 Melhor mês (menor custo/L): <b>${crmEsc(sz.melhorPeriodo.nome)}</b> (${fmt(sz.melhorPeriodo.custo_litro)}) · 🔻 Pior: <b>${crmEsc(sz.piorPeriodo.nome)}</b> (${fmt(sz.piorPeriodo.custo_litro)})</p>` : '';
  const safras = (sz.safras || []).length ? finBox('🌾 Por safra/temporada', biTabela([{ h: 'Safra' }, { h: 'Sacas', cls: 'num' }, { h: 'Preço/saca', cls: 'num' }], sz.safras.map(x => [crmEsc(x.safra), biNum(x.sacas), fmt(x.preco_saca)]), '')) : '';
  cont.innerHTML = grafs + `<div class="fin-box"><h3 class="fin-box-tit">📅 Sazonalidade (por mês)</h3>${szHead}${biTabela([{ h: 'Mês' }, { h: 'Sacas', cls: 'num' }, { h: 'Preço/saca', cls: 'num' }, { h: 'Rendimento', cls: 'num' }, { h: 'Custo/L', cls: 'num' }], szRows, 'Sem dados de sazonalidade ainda.')}</div>` + safras;
}
async function renderCxInteligencia() {
  const el = $('cx-conteudo'); el.innerHTML = biLoading();
  let dash, comp, fechs; try { [dash, comp, fechs] = await Promise.all([
    fetch('/api/erp/inteligencia/dashboard', { cache: 'no-store' }).then(r => r.json()),
    fetch('/api/erp/inteligencia/comparativo', { cache: 'no-store' }).then(r => r.json()),
    fetch('/api/erp/inteligencia/fechamentos', { cache: 'no-store' }).then(r => r.json()),
  ]); } catch { el.innerHTML = biErro(); return; }
  if (dash && dash.erro) { el.innerHTML = `<div class="fin-box"><p class="fin-hint">${crmEsc(dash.erro)}</p></div>`; return; }
  const melhorId = comp.melhorCustoBeneficio ? comp.melhorCustoBeneficio.id : null;
  const rl = (v, u) => v == null ? '—' : (v + (u || ''));
  const compRows = comp.linhas.map(l => [
    `${l.id === melhorId ? '🏆 ' : ''}${crmEsc(l.nome)}${l.dadosSuficientes ? '' : ' <small class="ci-poucos">(poucos dados)</small>'}`,
    l.sacasCompradas, fmt(l.precoMedioSaca), rl(l.rendimentoMedioSaca, ' L/sc'),
    l.custoMedioLitro != null ? `<b class="${l.id === melhorId ? 'fin-val entrada' : ''}">${fmt(l.custoMedioLitro)}</b>` : '—',
    l.saldoSacas, l.ultimaCompra || '—']);
  const fechRows = (fechs || []).map(f => [f.data, crmEsc(f.periodo), f.sacas_usadas, f.litros + ' L',
    f.rendimento_saca != null ? f.rendimento_saca + ' L/sc' : '—', f.custo_mp != null ? fmt(f.custo_mp) : '—',
    f.custo_litro != null ? `<b>${fmt(f.custo_litro)}</b>` : '—', (f.parcelas || []).length + ' lote(s)']);
  el.innerHTML = `
    <div class="ci-cards">
      ${finCard('🛒', fmt(dash.totalComprado), 'Total comprado')}
      ${finCard('📦', dash.sacas + ' sc', 'Sacas')}
      ${finCard('🏷️', fmt(dash.precoMedioSaca), 'Preço médio/saca')}
      ${finCard('💧', dash.rendimentoMedioSaca != null ? dash.rendimentoMedioSaca + ' L/sc' : '—', 'Rendimento médio')}
      ${finCard('💰', dash.custoMedioLitro != null ? fmt(dash.custoMedioLitro) : '—', 'Custo real/litro')}
      ${finCard('🏆', dash.melhorCustoBeneficio ? crmEsc(dash.melhorCustoBeneficio.nome) : '—', 'Melhor custo-benefício', dash.melhorCustoBeneficio ? fmt(dash.melhorCustoBeneficio.custoMedioLitro) + '/L' : '')}
    </div>
    ${dash.alertas && dash.alertas.length ? `<div class="fin-box"><h3 class="fin-box-tit">⚠️ Alertas gerenciais (${dash.alertas.length})</h3>
      <div class="ci-alertas">${dash.alertas.map(a => `<div class="ci-alerta ${CI_SEV[a.sev] || ''}"><span class="ci-al-tipo">${crmEsc(a.tipo)}</span>${a.fornecedor ? '<b>' + crmEsc(a.fornecedor) + '</b> · ' : ''}${crmEsc(a.texto)}</div>`).join('')}</div></div>` : '<div class="fin-box"><p class="fin-hint">✅ Sem alertas gerenciais no momento.</p></div>'}
    <div class="fin-box"><div class="ci-box-head"><h3 class="fin-box-tit">🏭 Comparativo de fornecedores</h3><a class="fin-mini" href="/api/erp/inteligencia/relatorio?tipo=comparativo&formato=csv">⬇ CSV</a></div>
      ${biTabela([{ h: 'Fornecedor' }, { h: 'Sacas', cls: 'num' }, { h: 'Preço/saca', cls: 'num' }, { h: 'Rendimento', cls: 'num' }, { h: 'Custo real/L', cls: 'num' }, { h: 'Saldo', cls: 'num' }, { h: 'Última' }], compRows, 'Sem compras de matéria-prima ainda.')}
      <p class="fin-hint">🏆 = menor custo real por litro (com dados suficientes). O mais barato por saca não é necessariamente o melhor — o que vale é o custo por litro produzido.</p></div>
    <div class="fin-box"><div class="ci-box-head"><h3 class="fin-box-tit">💧 Rendimento & custo real por fechamento</h3><a class="fin-mini" href="/api/erp/inteligencia/relatorio?tipo=fechamentos&formato=csv">⬇ CSV</a></div>
      ${biTabela([{ h: 'Data' }, { h: 'Período' }, { h: 'Sacas', cls: 'num' }, { h: 'Litros', cls: 'num' }, { h: 'Rend./saca', cls: 'num' }, { h: 'Custo MP', cls: 'num' }, { h: 'Custo/L', cls: 'num' }, { h: 'Lotes' }], fechRows, 'Nenhum fechamento com consumo ainda.')}</div>
    <div class="fin-box"><div class="ci-box-head"><h3 class="fin-box-tit">📈 Gráficos gerenciais</h3>
      <div class="ci-graf-filtros"><label>Período<select id="ci-per"><option value="tudo">Tudo</option><option value="mes">Este mês</option><option value="30d">30 dias</option><option value="mes_passado">Mês passado</option></select></label>
        <label>Fornecedor<select id="ci-forn"><option value="">Todos</option>${comp.linhas.map(l => `<option value="${l.id}">${crmEsc(l.nome)}</option>`).join('')}</select></label></div></div>
    <div id="ci-graficos">${biLoading()}</div>
    <div class="ci-box-head"><a class="fin-mini" href="/api/erp/inteligencia/relatorio?tipo=lotes&formato=csv">⬇ Lotes em CSV</a></div>`;
  ciCarregarGraficos();
  if ($('ci-per')) $('ci-per').addEventListener('change', ciCarregarGraficos);
  if ($('ci-forn')) $('ci-forn').addEventListener('change', ciCarregarGraficos);
}

async function renderCxSolicitacoes() {
  const el = $('cx-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await cxGet('solicitacoes'); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const rows = d.map(s => [fmtDia(s.criado_em), crmEsc(s.departamento || '—'), crmEsc(s.prioridade || ''), s.itens + ' itens', crmEsc(s.centro_custo || '—'), `<span class="cu-status cu-st-${cxStatusCls(s.status)}">${s.status}</span>`]);
  el.innerHTML = `
    ${pode ? `<div class="fin-box"><h3 class="fin-box-tit">📝 Nova solicitação interna</h3>
      <form id="cx-form-sol" class="fin-form">
        <div class="fin-frow"><label>Departamento<input id="sol-dep" placeholder="ex.: Produção"></label><label>Prioridade<select id="sol-prio"><option>normal</option><option>alta</option><option>urgente</option></select></label></div>
        <div class="cu-prod-head"><b>Itens</b><button type="button" class="fin-mini" id="sol-add">➕ item</button></div>
        <div id="sol-itens"></div>
        <label>Observação<input id="sol-obs"></label>
        <button type="submit" class="fin-btn-salvar">💾 Criar solicitação</button></form></div>` : ''}
    <div class="fin-box"><h3 class="fin-box-tit">Solicitações (${d.length})</h3>${biTabela([{ h: 'Data' }, { h: 'Depto' }, { h: 'Prioridade' }, { h: 'Itens' }, { h: 'Centro' }, { h: 'Status' }], rows, 'Nenhuma solicitação.')}</div>`;
  if (pode) {
    const cont = $('sol-itens'); const linha = () => { const div = document.createElement('div'); div.className = 'cu-prod-linha'; div.innerHTML = `<select class="sol-p">${cxOptProd()}</select><input type="number" step="0.01" class="sol-q" placeholder="qtd"><button type="button" class="fin-mini sol-del">✕</button>`; div.querySelector('.sol-del').addEventListener('click', () => div.remove()); return div; };
    cont.appendChild(linha()); $('sol-add').addEventListener('click', () => cont.appendChild(linha()));
    $('cx-form-sol').addEventListener('submit', async e => {
      e.preventDefault();
      const itens = [...cont.querySelectorAll('.cu-prod-linha')].map(d2 => { const cod = d2.querySelector('.sol-p').value; const p = cxProdutos.find(x => x.codigo === cod); return { produto_codigo: cod, descricao: p ? p.nome : cod, quantidade: +d2.querySelector('.sol-q').value || 0 }; }).filter(i => i.quantidade > 0);
      if (!itens.length) { toast('⚠ Informe ao menos um item'); return; }
      const r = await (await fetch('/api/compras-pro/solicitacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ departamento: $('sol-dep').value.trim(), prioridade: $('sol-prio').value, obs: $('sol-obs').value.trim(), itens }) })).json();
      if (r.erro) { toast('⚠ ' + r.erro); return; } toast('📝 Solicitação criada'); renderCxSolicitacoes();
    });
  }
}
async function renderCxCotacoes() {
  const el = $('cx-conteudo'); el.innerHTML = biLoading();
  let d, sols; try { [d, sols] = await Promise.all([cxGet('cotacoes'), cxGet('solicitacoes')]); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const rows = d.map(c => [`<a href="#" class="cx-cot-link" data-id="${c.id}">#${c.id}</a>`, crmEsc(c.descricao || '—'), c.fornecedores + ' cotados', crmEsc(c.vencedor || '—'), `<span class="cu-status cu-st-${cxStatusCls(c.status)}">${c.status}</span>`]);
  el.innerHTML = `
    ${pode ? `<div class="fin-box"><h3 class="fin-box-tit">💬 Nova cotação</h3>
      <form id="cx-form-cot" class="fin-form fin-form-inline"><select id="cot-sol"><option value="">— solicitação (opcional) —</option>${sols.filter(s => s.status !== 'pedido').map(s => `<option value="${s.id}">#${s.id} · ${crmEsc(s.departamento || '')} (${s.itens} itens)</option>`).join('')}</select><input id="cot-desc" placeholder="descrição"><button type="submit" class="fin-btn-salvar">➕ Criar</button></form></div>` : ''}
    <div class="fin-box"><h3 class="fin-box-tit">Cotações (${d.length})</h3>${biTabela([{ h: '#' }, { h: 'Descrição' }, { h: 'Fornecedores' }, { h: 'Vencedor' }, { h: 'Status' }], rows, 'Nenhuma cotação.')}</div>`;
  const cf = $('cx-form-cot'); if (cf) cf.addEventListener('submit', async e => { e.preventDefault(); const r = await (await fetch('/api/compras-pro/cotacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ solicitacao_id: +$('cot-sol').value || null, descricao: $('cot-desc').value.trim() || 'Cotação' }) })).json(); if (r.erro) { toast('⚠ ' + r.erro); return; } toast('💬 Cotação criada'); renderCxCotDetalhe(r.id); });
  el.querySelectorAll('.cx-cot-link').forEach(a => a.addEventListener('click', e => { e.preventDefault(); renderCxCotDetalhe(+a.dataset.id); }));
}
async function renderCxCotDetalhe(id) {
  const el = $('cx-conteudo'); el.innerHTML = biLoading();
  let c; try { c = await cxGet('cotacoes/' + id); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const rows = c.fornecedores.map(f => [crmEsc(f.nome || '—'), fmt(f.valor), crmEsc(f.prazo || '—'), fmt(f.frete), c.status !== 'fechada' && pode ? `<button class="fin-mini cx-venc" data-fid="${f.fornecedor_id}">🏆 escolher</button>` : (c.vencedor_fornecedor_id === f.fornecedor_id ? '🏆 vencedor' : '')]);
  el.innerHTML = `<button class="fin-mini" id="cx-volta">← voltar</button>
    <div class="fin-box"><h3 class="fin-box-tit">💬 Cotação #${c.id} · ${crmEsc(c.descricao || '')}</h3>
      ${pode && c.status !== 'fechada' ? `<form id="cx-cotf" class="fin-form fin-form-inline"><select id="cf-forn">${cxOptForn()}</select><input type="number" step="0.01" id="cf-valor" placeholder="valor"><input type="date" id="cf-prazo" title="prazo"><input type="number" step="0.01" id="cf-frete" placeholder="frete"><button type="submit" class="fin-btn-salvar">➕ cotar</button></form>` : ''}
      ${biTabela([{ h: 'Fornecedor' }, { h: 'Valor', cls: 'num' }, { h: 'Prazo' }, { h: 'Frete', cls: 'num' }, { h: '' }], rows, 'Nenhum fornecedor cotado ainda.')}</div>`;
  $('cx-volta').addEventListener('click', renderCxCotacoes);
  const cf = $('cx-cotf'); if (cf) cf.addEventListener('submit', async e => { e.preventDefault(); await fetch('/api/compras-pro/cotacoes/' + id + '/fornecedor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fornecedor_id: +$('cf-forn').value, valor: +$('cf-valor').value || 0, prazo: $('cf-prazo').value, frete: +$('cf-frete').value || 0 }) }); toast('➕ Cotação registrada'); renderCxCotDetalhe(id); });
  el.querySelectorAll('.cx-venc').forEach(b => b.addEventListener('click', async () => { if (!confirm('Escolher este fornecedor como vencedor? Isso gera o pedido de compra.')) return; const r = await (await fetch('/api/compras-pro/cotacoes/' + id + '/vencedor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fornecedor_id: +b.dataset.fid }) })).json(); if (r.erro) { toast('⚠ ' + r.erro); return; } toast('🏆 Vencedor escolhido · pedido ' + r.numero + ' gerado'); cxIr('pedidos'); }));
}
async function renderCxPedidos() {
  const el = $('cx-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await cxGet('pedidos'); } catch { el.innerHTML = biErro(); return; }
  const rows = d.map(p => [`<a href="#" class="cx-ped-link" data-id="${p.id}">${crmEsc(p.numero)}</a>`, crmEsc(p.fornecedor || '—'), fmtDia(p.data), fmt(p.total), crmEsc(p.prazo_entrega || '—'), `<span class="cu-status cu-st-${cxStatusCls(p.status)}">${p.status}</span>`]);
  el.innerHTML = finBox('📋 Pedidos de compra', biTabela([{ h: 'Pedido' }, { h: 'Fornecedor' }, { h: 'Data' }, { h: 'Total', cls: 'num' }, { h: 'Prazo' }, { h: 'Status' }], rows, 'Nenhum pedido. Crie uma cotação e escolha o vencedor.'));
  el.querySelectorAll('.cx-ped-link').forEach(a => a.addEventListener('click', e => { e.preventDefault(); renderCxPedDetalhe(+a.dataset.id); }));
}
async function renderCxPedDetalhe(id) {
  const el = $('cx-conteudo'); el.innerHTML = biLoading();
  let p; try { p = await cxGet('pedidos/' + id); } catch { el.innerHTML = biErro(); return; }
  const itens = p.itens.map(i => [crmEsc(i.descricao || i.produto_codigo), i.quantidade, fmt(i.valor_unitario), fmt(i.valor_total), i.qtd_recebida]);
  const pode = finPodeLancar();
  el.innerHTML = `<button class="fin-mini" id="cx-volta">← voltar</button>
    <div class="fin-box"><h3 class="fin-box-tit">📋 Pedido ${crmEsc(p.numero)} · ${crmEsc(p.fornecedor || '')}</h3>
      <div class="cu-lote-resumo"><span>Total: <b>${fmt(p.total)}</b></span><span>Prazo: <b>${crmEsc(p.prazo_entrega || '—')}</b></span><span>Status: <b>${p.status}</b></span></div>
      ${biTabela([{ h: 'Item' }, { h: 'Qtd', cls: 'num' }, { h: 'Vl un.', cls: 'num' }, { h: 'Total', cls: 'num' }, { h: 'Recebido', cls: 'num' }], itens)}
      ${pode && p.status !== 'recebido' && p.status !== 'cancelado' ? `<button class="fin-btn-salvar" id="cx-receber" style="margin-top:10px">📥 Registrar recebimento</button>` : ''}</div>
    ${p.recebimentos.length ? finBox('📥 Recebimentos', biTabela([{ h: 'Data' }, { h: 'Conferente' }, { h: 'Status' }], p.recebimentos.map(r => [fmtDataHora(r.data), crmEsc(r.conferente || '—'), r.status]))) : ''}
    <div id="cx-receber-form"></div>`;
  $('cx-volta').addEventListener('click', renderCxPedidos);
  const rb = $('cx-receber'); if (rb) rb.addEventListener('click', () => cxFormRecebimento(p));
}
function cxFormRecebimento(p) {
  const rows = p.itens.map(i => `<div class="cx-rec-linha" data-item="${i.id}" data-cod="${crmEsc(i.produto_codigo)}"><span>${crmEsc(i.descricao || i.produto_codigo)} <small>(pedido ${i.quantidade}, falta ${r2loc(i.quantidade - i.qtd_recebida)})</small></span><input type="number" step="0.01" class="rec-q" placeholder="recebido" value="${r2loc(i.quantidade - i.qtd_recebida)}"><input class="rec-lote" placeholder="lote"><input type="date" class="rec-val" title="validade"></div>`).join('');
  $('cx-receber-form').innerHTML = `<div class="fin-box"><h3 class="fin-box-tit">📥 Conferência do recebimento</h3>${rows}<div class="fin-frow"><label>Conferente<input id="rec-conf"></label></div><label>Observação<input id="rec-obs"></label><button class="fin-btn-salvar" id="rec-confirmar">✅ Registrar e aprovar (atualiza estoque + financeiro + custo)</button></div>`;
  $('rec-confirmar').addEventListener('click', async () => {
    const itens = [...document.querySelectorAll('.cx-rec-linha')].map(d => { const i = p.itens.find(x => x.id == d.dataset.item); return { pedido_item_id: +d.dataset.item, produto_codigo: d.dataset.cod, qtd_pedida: i ? i.quantidade : 0, qtd_recebida: +d.querySelector('.rec-q').value || 0, lote: d.querySelector('.rec-lote').value, validade: d.querySelector('.rec-val').value, qualidade: 'ok' }; }).filter(i => i.qtd_recebida > 0);
    if (!itens.length) { toast('⚠ Informe as quantidades recebidas'); return; }
    const rec = await (await fetch('/api/compras-pro/recebimentos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedido_id: p.id, conferente: $('rec-conf').value.trim(), obs: $('rec-obs').value.trim(), itens }) })).json();
    if (rec.erro) { toast('⚠ ' + rec.erro); return; }
    const ap = await (await fetch('/api/compras-pro/recebimentos/' + rec.id + '/aprovar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    if (ap.erro) { toast('⚠ ' + ap.erro); return; }
    toast(`✅ Recebimento aprovado · estoque + custo(lote) + conta a pagar ${fmt(ap.valor_recebido || 0)}`); renderCxPedDetalhe(p.id);
  });
}
const r2loc = (v) => Math.round((+v || 0) * 100) / 100;
async function renderCxRecebimentos() {
  const el = $('cx-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await cxGet('recebimentos'); } catch { el.innerHTML = biErro(); return; }
  const rows = d.map(r => [fmtDataHora(r.data), crmEsc(r.pedido_numero || '—'), crmEsc(r.fornecedor || '—'), crmEsc(r.conferente || '—'),
    `<span class="cu-status cu-st-${cxStatusCls(r.status)}">${r.status}</span>`, `<button class="fin-mini" data-cx-rec="${r.id}">🔎 Detalhe</button>`]);
  el.innerHTML = finBox('📥 Recebimentos', biTabela([{ h: 'Data' }, { h: 'Pedido' }, { h: 'Fornecedor' }, { h: 'Conferente' }, { h: 'Status' }, { h: '' }], rows, 'Nenhum recebimento — registre pelo detalhe do Pedido.'));
  el.querySelectorAll('[data-cx-rec]').forEach(b => b.addEventListener('click', () => renderCxRecDetalhe(+b.dataset.cxRec)));
}
// Detalhe do recebimento: itens + LOTE de custo gerado + CONTA A PAGAR gerada (Fase 34) + estorno
async function renderCxRecDetalhe(id) {
  const el = $('cx-conteudo'); el.innerHTML = biLoading();
  let r; try { r = await cxGet('recebimentos/' + id); } catch { el.innerHTML = biErro(); return; }
  const itens = (r.itens || []).map(i => [crmEsc(i.produto_codigo || '—'), i.qtd_recebida, i.lote || '—', i.validade || '—', i.qualidade || '—']);
  const lote = r.lote, conta = r.conta_pagar;
  const loteBox = lote ? finBox('📦 Lote de custo gerado (FIFO)', `<div class="cu-lote-resumo"><span>Nº <b>${crmEsc(lote.numero)}</b></span><span>Valor <b>${fmt(lote.valor_pago)}</b></span><span>Status <b>${lote.status}</b></span></div>` +
    biTabela([{ h: 'Produto' }, { h: 'Qtd', cls: 'num' }, { h: 'Custo un.', cls: 'num' }, { h: 'Restante', cls: 'num' }], (lote.produtos || []).map(p => [crmEsc(p.nome || p.produto_codigo), p.qtd_produzida, fmt(p.custo_unitario), p.qtd_restante]))) : '<p class="cr-hint">Sem lote de custo (recebimento sem itens cadastrados).</p>';
  const contaBox = conta ? finBox('📌 Conta a pagar gerada', `<div class="cu-lote-resumo"><span>${crmEsc(conta.descricao)}</span><span>Valor <b>${fmt(conta.valor_total)}</b></span><span>Venc. <b>${crmEsc(conta.data_vencimento || '—')}</b></span><span>Status <b>${conta.status}</b></span></div>`) : '<p class="cr-hint">Sem conta a pagar (valor recebido zero).</p>';
  const podeEstornar = finPodeAdmin() && r.integrado && r.status !== 'estornado';
  el.innerHTML = `<button class="fin-mini" id="cx-volta">← voltar</button>
    <div class="fin-box"><h3 class="fin-box-tit">📥 Recebimento #${r.id} · ${crmEsc(r.pedido_numero || '')} · ${crmEsc(r.fornecedor || '')}</h3>
      <div class="cu-lote-resumo"><span>Data <b>${fmtDataHora(r.data)}</b></span><span>Conferente <b>${crmEsc(r.conferente || '—')}</b></span><span>Status <b>${r.status}</b></span></div>
      ${biTabela([{ h: 'Produto' }, { h: 'Recebido', cls: 'num' }, { h: 'Lote' }, { h: 'Validade' }, { h: 'Qualidade' }], itens)}</div>
    ${loteBox}${contaBox}
    ${podeEstornar ? `<button class="fin-btn-salvar" id="cx-estornar" style="background:var(--vermelho)">↩️ Estornar recebimento</button>` : ''}`;
  $('cx-volta').addEventListener('click', renderCxRecebimentos);
  const eb = $('cx-estornar'); if (eb) eb.addEventListener('click', async () => {
    if (!confirm('Estornar este recebimento? Desfaz a entrada de estoque, remove o lote de custo e cancela a conta a pagar (só se ainda não houve pagamento nem venda do lote).')) return;
    const res = await (await fetch('/api/compras-pro/recebimentos/' + id + '/estornar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    if (res.erro) { toast('⚠ ' + res.erro); return; }
    toast('↩️ Recebimento estornado'); renderCxRecebimentos();
  });
}
async function renderCxNotas() {
  const el = $('cx-conteudo'); el.innerHTML = biLoading();
  let d, peds; try { [d, peds] = await Promise.all([cxGet('notas'), cxGet('pedidos')]); } catch { el.innerHTML = biErro(); return; }
  const pode = finPodeLancar();
  const rows = d.map(n => [crmEsc(n.numero || '—'), crmEsc(n.serie || ''), crmEsc(n.pedido_numero || '—'), crmEsc((n.emissao || '').slice(0, 10)), crmEsc(n.chave || '—')]);
  el.innerHTML = `
    ${pode ? `<div class="fin-box"><h3 class="fin-box-tit">🧾 Cadastrar nota fiscal</h3>
      <form id="cx-nf" class="fin-form">
        <div class="fin-frow"><label>Pedido<select id="nf-ped"><option value="">—</option>${peds.map(p => `<option value="${p.id}">${crmEsc(p.numero)}</option>`).join('')}</select></label><label>Número<input id="nf-num"></label><label>Série<input id="nf-serie"></label></div>
        <div class="fin-frow"><label>Emissão<input type="date" id="nf-emis"></label><label>Chave (44 díg.)<input id="nf-chave"></label></div>
        <label>Observação<input id="nf-obs"></label>
        <button type="submit" class="fin-btn-salvar">💾 Cadastrar</button></form>
      <p class="fin-hint">Estrutura pronta pra <b>leitura automática de XML/NF-e</b> no futuro (chave, xml, pdf) — a leitura ainda não foi implementada.</p></div>` : ''}
    <div class="fin-box"><h3 class="fin-box-tit">Notas fiscais (${d.length})</h3>${biTabela([{ h: 'Número' }, { h: 'Série' }, { h: 'Pedido' }, { h: 'Emissão' }, { h: 'Chave' }], rows, 'Nenhuma nota.')}</div>`;
  const f = $('cx-nf'); if (f) f.addEventListener('submit', async e => { e.preventDefault(); const r = await (await fetch('/api/compras-pro/notas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedido_id: +$('nf-ped').value || null, numero: $('nf-num').value.trim(), serie: $('nf-serie').value.trim(), emissao: $('nf-emis').value, chave: $('nf-chave').value.trim(), obs: $('nf-obs').value.trim() }) })).json(); if (r.erro) { toast('⚠ ' + r.erro); return; } toast('🧾 Nota cadastrada'); renderCxNotas(); });
}
function renderCxRelatorios() {
  const el = $('cx-conteudo');
  const tipos = [['por-fornecedor', '🏭 Comprado por fornecedor'], ['por-produto', '📦 Comprado por produto'], ['por-centro', '🎯 Compras por centro de custo']];
  el.innerHTML = `<div class="fin-filtros"><label>Relatório<select id="cxr-tipo">${tipos.map(t => `<option value="${t[0]}">${t[1]}</option>`).join('')}</select></label><label>Período<select id="cxr-per"><option value="mes">Este mês</option><option value="tudo">Tudo</option></select></label><button class="fin-btn-filtrar" id="cxr-gerar">📊 Gerar</button></div><div id="cxr-lista" class="fin-box">${biVazio('Escolha e gere.')}</div>`;
  $('cxr-gerar').addEventListener('click', cxGerarRel); cxGerarRel();
}
async function cxGerarRel() {
  let d; try { d = await cxGet('relatorios/' + $('cxr-tipo').value + '?periodo=' + $('cxr-per').value); } catch { $('cxr-lista').innerHTML = biErro(); return; }
  const cols = d.colunas.map((c, i) => ({ h: c, cls: i > 0 ? 'num' : '' }));
  const rows = d.linhas.map(l => l.map(v => crmEsc(String(v))));
  $('cxr-lista').innerHTML = `<h3 class="fin-box-tit">${d.titulo}</h3>${biTabela(cols, rows, 'Sem dados no período.')}`;
}
async function renderCxHistorico() {
  const el = $('cx-conteudo'); el.innerHTML = biLoading();
  let peds, recs, al; try { [peds, recs, al] = await Promise.all([cxGet('pedidos'), cxGet('recebimentos'), cxGet('alertas')]); } catch { el.innerHTML = biErro(); return; }
  el.innerHTML = `
    ${al.total ? finBox('🔔 Alertas', '<div class="fin-alertas">' + [...al.pedidosAtrasados.map(p => `<div class="fin-alerta">🔴 Pedido ${crmEsc(p.pedido)} atrasado (${crmEsc(p.fornecedor)}) · venceu ${p.prazo}</div>`), ...al.fornecedoresParados.map(f => `<div class="fin-alerta">💤 ${crmEsc(f.nome)} sem comprar há +45 dias</div>`)].join('') + '</div>') : ''}
    ${finBox('📋 Pedidos recentes', biTabela([{ h: 'Pedido' }, { h: 'Fornecedor' }, { h: 'Total', cls: 'num' }, { h: 'Status' }], peds.slice(0, 15).map(p => [crmEsc(p.numero), crmEsc(p.fornecedor || '—'), fmt(p.total), p.status]), 'Nenhum.'))}
    ${finBox('📥 Recebimentos recentes', biTabela([{ h: 'Data' }, { h: 'Pedido' }, { h: 'Status' }], recs.slice(0, 15).map(r => [fmtDia(r.data), crmEsc(r.pedido_numero || '—'), r.status]), 'Nenhum.'))}`;
}
async function renderCxFornecedores() {
  const el = $('cx-conteudo'); el.innerHTML = biLoading();
  let d; try { d = await (await fetch('/api/erp/fornecedores', { cache: 'no-store' })).json(); } catch { el.innerHTML = biErro(); return; }
  if (!Array.isArray(d)) d = [];
  const rows = d.map(f => [crmEsc(f.nome), crmEsc(f.telefone || '—'), crmEsc(f.cidade || '—'), f.ativo ? 'Ativo' : 'Inativo']);
  el.innerHTML = finBox('🏭 Fornecedores', biTabela([{ h: 'Nome' }, { h: 'Telefone' }, { h: 'Cidade' }, { h: 'Situação' }], rows, 'Nenhum fornecedor.')) + `<p class="fin-hint">O cadastro completo de fornecedores fica no módulo 💵 Financeiro → Fornecedores.</p>`;
}

/* Fase 10: importação inicial de vendas/compras/insumos pro backend (só se o backend estiver vazio).
   Idempotente, não apaga o localStorage. Roda depois do carregarEstoque (que carrega os caches). */
async function importarFinanceiroInicial() {
  try {
    const [vend, comp, ins] = await Promise.all([
      fetch('/api/vendas').then(r => r.json()).catch(() => []),
      fetch('/api/compras').then(r => r.json()).catch(() => []),
      fetch('/api/insumos').then(r => r.json()).catch(() => []),
    ]);
    if (Array.isArray(vend) && vend.length === 0 && vendasLog.length) {
      console.log('📥 Vendas importadas:', await (await fetch('/api/vendas/importar-localstorage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendas: vendasLog }) })).json());
    }
    if (Array.isArray(comp) && comp.length === 0 && comprasLog.length) {
      console.log('📥 Compras importadas:', await (await fetch('/api/compras/importar-localstorage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compras: comprasLog }) })).json());
    }
    if (Array.isArray(ins) && ins.length === 0 && insumos.length) {
      console.log('📥 Insumos importados:', await (await fetch('/api/insumos/importar-localstorage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ insumos }) })).json());
    }
  } catch { /* offline: segue com o cache */ }
}

/* ══════════════════════════════════════════════════════════════════════════
   FILA OFFLINE (Fase 14) — não perde operação crítica se o backend cair.
   Guardada no localStorage (acai_fila_offline). Item:
   { id_local, tipo, url, body, criado_em, tentativas, status, ultima_tentativa }.
   Idempotência: cada operação leva um client_request_id — o backend, com a tabela
   `idempotencia`, ignora repetição e devolve o mesmo resultado (não duplica).
   Escolhi localStorage (não IndexedDB): a fila é pequena e o resto do sistema já usa. */
const FILA_KEY = 'acai_fila_offline';
function uuidOp() { try { return crypto.randomUUID(); } catch { return 'crid-' + Date.now() + '-' + Math.random().toString(16).slice(2); } }
function lerFila() { try { return JSON.parse(localStorage.getItem(FILA_KEY) || '[]'); } catch { return []; } }
function salvarFila(f) { try { localStorage.setItem(FILA_KEY, JSON.stringify(f)); } catch {} atualizarBadgeFila(); }
function enfileirar(tipo, url, body) {
  const f = lerFila();
  f.push({ id_local: uuidOp(), tipo, url, body, criado_em: new Date().toISOString(), tentativas: 0, status: 'pendente', ultima_tentativa: null });
  salvarFila(f);
}
function removerDaFila(idLocal) { salvarFila(lerFila().filter(x => x.id_local !== idLocal)); }
function marcarNaFila(idLocal, patch) { salvarFila(lerFila().map(x => x.id_local === idLocal ? { ...x, ...patch, tentativas: x.tentativas + 1, ultima_tentativa: new Date().toISOString() } : x)); }
function atualizarBadgeFila() {
  const el = $('badge-fila'); if (!el) return;
  const n = lerFila().length;
  el.textContent = n; el.style.display = n > 0 ? '' : 'none';
  el.title = `${n} operação(ões) salva(s) localmente, aguardando o servidor`;
}

/* POST que sobrevive a queda do backend: tenta enviar; se a REDE falhar (fetch quebra
   ou 5xx), enfileira e avisa. Erro de lógica (4xx) NÃO entra na fila. Devolve o JSON
   da resposta, ou null se foi enfileirado. Sucesso aproveita pra escoar a fila. */
async function postComFila(tipo, url, body) {
  body = { ...body, client_request_id: body.client_request_id || uuidOp() };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { processarFila(); return await r.json().catch(() => ({})); }
    if (r.status >= 500) throw new Error('servidor ' + r.status);
    return await r.json().catch(() => null); // 4xx (lógica) — não enfileira
  } catch {
    enfileirar(tipo, url, body);
    toast('📴 Sem conexão com o servidor — operação salva e será reenviada', 'aviso');
    return null;
  }
}

/* Reenvio automático: percorre a fila em ORDEM (FIFO), remove no sucesso, para se o
   servidor ainda estiver ruim (tenta de novo depois). Não trava a interface, não spamma. */
let filaProcessando = false;
async function processarFila() {
  if (filaProcessando || !usuarioAtual || !lerFila().length) return;
  filaProcessando = true;
  let sincronizou = 0;
  try {
    for (const item of lerFila()) {
      if (item.status === 'falhou') continue;
      let r;
      try { r = await fetch(item.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.body) }); }
      catch { marcarNaFila(item.id_local, {}); break; }              // rede caiu → tenta depois
      if (r.ok) { removerDaFila(item.id_local); sincronizou++; }      // ok (ou já-processado idempotente) → sai da fila
      else if (r.status === 401) break;                              // sessão caiu → tenta depois
      else if (r.status >= 500) { marcarNaFila(item.id_local, {}); break; } // servidor ruim → para
      else marcarNaFila(item.id_local, { status: 'falhou' });        // 4xx lógico → não reenvia infinito (fica visível)
    }
  } finally { filaProcessando = false; }
  atualizarBadgeFila();
  if (sincronizou) toast(`✅ ${sincronizou} pendência(s) sincronizada(s) com o servidor`, 'sucesso');
}
window.addEventListener('online', processarFila);   // navegador voltou a ter rede
setInterval(processarFila, 60000);                   // rede leve a cada 60s

/* ── Init ────────────────────────────────────────────────── */
carregarEstoque().then(importarFinanceiroInicial);
carregarClientes();
carregarPedidos().then(renderDelivery);
renderCupom();
atualizarBadgeFila();

/* Sessão expirada no meio do uso → volta pra tela de login (aviso único).
   Interceptador leve: qualquer /api/* que responder 401 com o app aberto derruba pro login. */
let _avisoSessao = false;
const _fetchOriginal = window.fetch.bind(window);
window.fetch = async (recurso, opcoes) => {
  const r = await _fetchOriginal(recurso, opcoes);
  const url = typeof recurso === 'string' ? recurso : (recurso && recurso.url) || '';
  if (r.status === 401 && url.startsWith('/api/') && !url.startsWith('/api/auth/') &&
      !$('app-principal').classList.contains('oculto') && !_avisoSessao) {
    _avisoSessao = true;
    toast('🔒 Sessão expirada — entre de novo');
    mostrarTelaLogin();
    setTimeout(() => { _avisoSessao = false; }, 3000);
  }
  return r;
};

/* Quem manda é o servidor: pergunta ao /api/auth/me se há sessão válida (cookie). */
fetch('/api/auth/me')
  .then(r => (r.ok ? r.json() : null))
  .then(u => {
    if (u) { usuarioAtual = u; fazerLogin(u.nome); atualizarBadgeFila(); processarFila(); }
    else mostrarTelaLogin();
  })
  .catch(() => { mostrarTelaLogin(); });
