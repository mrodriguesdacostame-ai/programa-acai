#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   LIMPAR DADOS PARA SIMULAÇÃO REAL (#8)
   Zera os dados TRANSACIONAIS (vendas, pedidos, financeiro, estoque-mov, fiado,
   compras, produção, mensagens, logs…) e MANTÉM os cadastros e a configuração
   (produtos, clientes, contas, categorias, insumos, fornecedores, usuários,
   config, maquininhas, perfis de produção…).

   SEGURANÇA:
   • Faz BACKUP do banco ANTES de qualquer DELETE (copia o arquivo .db).
   • Só roda com a flag  --confirmar  (sem ela, apenas simula e mostra o plano).
   • Usa DENYLIST: só apaga as tabelas nomeadas aqui; qualquer tabela nova/desconhecida
     é PRESERVADA por padrão (nunca quebra o schema).

   USO:
     node scripts/limpar_simulacao.js                      → DRY-RUN (mostra o que faria)
     node scripts/limpar_simulacao.js --confirmar          → executa (backup + wipe)
     node scripts/limpar_simulacao.js --confirmar --zerar-estoque   → + zera estoque de produtos e insumos
     node scripts/limpar_simulacao.js --confirmar --zerar-saldos    → + zera saldo inicial das contas
   Banco: usa  ACAI_DB  (env) se definido, senão  ./acai.db
   ───────────────────────────────────────────────────────────────────────────── */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const CONFIRMAR = args.includes('--confirmar');
const ZERAR_ESTOQUE = args.includes('--zerar-estoque');
const ZERAR_SALDOS = args.includes('--zerar-saldos');

const DB_PATH = process.env.ACAI_DB || path.join(__dirname, '..', 'acai.db');

// Tabelas TRANSACIONAIS a limpar (denylist). Tudo que NÃO estiver aqui é mantido.
const WIPE = [
  // vendas / PDV
  'vendas', 'vendas_itens', 'pagamentos',
  'pedidos', 'pedidos_seq',
  // estoque / movimentos
  'estoque_movimentos', 'movimentacoes_nc',
  // financeiro
  'financeiro_movimentos', 'contas_pagar', 'contas_pagar_pagamentos', 'cobrancas',
  // fiado / fidelidade (cadastro do cliente é mantido; só o histórico sai)
  'clientes_extrato', 'fidelidade_movimentos',
  // compras (todos os eixos)
  'compras', 'compras_itens', 'compras_acai',
  'erp_compras', 'erp_compras_itens', 'erp_recebimentos', 'erp_recebimentos_itens',
  'cp_cotacoes', 'cp_cotacoes_fornecedores', 'cp_notas_fiscais', 'cp_pedidos', 'cp_pedidos_itens',
  'cp_recebimentos', 'cp_recebimentos_itens', 'cp_solicitacoes', 'cp_solicitacoes_itens',
  'fornecedor_avaliacoes',
  // produção / lotes
  'producoes', 'producoes_itens_entrada', 'producoes_itens_saida',
  'lotes', 'lotes_consumo', 'lotes_produtos', 'mp_lotes', 'mp_fechamento_consumo',
  'producao_ordens', 'producao_ordens_saidas', 'perdas',
  'litros_producao', 'insumos_movimentos',
  // custos (histórico; a base de custo do produto fica no cadastro)
  'custo_historico', 'pesos_custo_historico', 'produtos_historico',
  // caixa / fechamento / balanço
  'caixa_sessoes', 'conf_caixa', 'operacao_fechamentos', 'balancos',
  // atendimento / mensageria / impressão / logs
  'conversas_ia', 'mensagens_wpp', 'atendimento_estado', 'fila_impressao',
  'avisos', 'logs_acoes', 'idempotencia',
  // CRM emitido (regras/campanhas = config, ficam; cupons/sorteios emitidos saem)
  'crm_cupons', 'crm_sorteios',
];

function contar(db, t) { try { return db.prepare('SELECT COUNT(*) c FROM ' + t).get().c; } catch { return null; } }

function main() {
  if (!fs.existsSync(DB_PATH)) { console.error('❌ Banco não encontrado: ' + DB_PATH); process.exit(1); }
  const db = new DatabaseSync(DB_PATH);

  const existentes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  const alvo = WIPE.filter(t => existentes.has(t));
  const inexistentes = WIPE.filter(t => !existentes.has(t));

  console.log('🗄️  Banco: ' + DB_PATH);
  console.log('🧹 Modo: ' + (CONFIRMAR ? 'EXECUTAR (com backup)' : 'DRY-RUN (nada será apagado)'));
  console.log('   opções: ' + (ZERAR_ESTOQUE ? '+zerar-estoque ' : '') + (ZERAR_SALDOS ? '+zerar-saldos' : '') + '\n');

  let totalLinhas = 0;
  console.log('Tabelas que serão LIMPAS:');
  for (const t of alvo) { const n = contar(db, t); totalLinhas += (n || 0); console.log('  • ' + t.padEnd(28) + String(n).padStart(8) + ' linhas'); }
  if (inexistentes.length) console.log('\n(ignoradas — não existem neste banco: ' + inexistentes.join(', ') + ')');

  const mantidas = [...existentes].filter(t => !alvo.includes(t) && !t.startsWith('sqlite_')).sort();
  console.log('\nTabelas MANTIDAS (' + mantidas.length + '): ' + mantidas.join(', '));
  console.log('\nTotal de linhas a remover: ' + totalLinhas);

  if (!CONFIRMAR) { console.log('\n👉 DRY-RUN. Para executar de verdade, rode com  --confirmar'); return; }

  // BACKUP antes de tudo
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const bkp = DB_PATH.replace(/\.db$/, '') + '-ANTES-LIMPEZA-' + stamp + '.db';
  fs.copyFileSync(DB_PATH, bkp);
  console.log('\n💾 Backup criado: ' + bkp);

  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('BEGIN');
  try {
    for (const t of alvo) db.exec('DELETE FROM ' + t);
    // zera contadores de AUTOINCREMENT das tabelas limpas (sqlite_sequence)
    if (existentes.has('sqlite_sequence')) { for (const t of alvo) { try { db.prepare('DELETE FROM sqlite_sequence WHERE name=?').run(t); } catch {} } }
    if (ZERAR_ESTOQUE) {
      try { db.exec('UPDATE produtos SET estoque=0, estoque_reservado=0'); } catch {}
      try { db.exec('UPDATE insumos SET saldo=0, qtd=0'); } catch {}
      console.log('   ↳ estoque de produtos e insumos zerado');
    }
    if (ZERAR_SALDOS) {
      try { db.exec('UPDATE financeiro_contas SET saldo_inicial=0'); } catch {}
      console.log('   ↳ saldo inicial das contas zerado');
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); console.error('❌ Erro — nada foi alterado (rollback): ' + e.message); process.exit(1); }
  try { db.exec('VACUUM'); } catch {}

  console.log('\n✅ Limpeza concluída. Conferência pós-limpeza:');
  for (const t of ['vendas', 'pedidos', 'financeiro_movimentos', 'clientes_extrato', 'estoque_movimentos']) console.log('  ' + t.padEnd(24) + ' → ' + contar(db, t));
  for (const t of ['produtos', 'clientes', 'financeiro_contas', 'config', 'usuarios']) console.log('  (mantida) ' + t.padEnd(14) + ' → ' + contar(db, t));
  console.log('\nSe algo saiu errado, restaure o backup: ' + bkp);
}
main();
