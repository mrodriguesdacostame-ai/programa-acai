'use strict';
// ============================================================================
//  SINCRONIZAÇÃO ENTRE MÁQUINAS (multi-master via pasta do Google Drive)
// ----------------------------------------------------------------------------
//  Cada máquina roda o SEU próprio servidor/banco (funciona offline) e troca as
//  mudanças com as outras por uma PASTA que o Google Drive espelha pela internet.
//  Ninguém é "dono": o que muda numa aparece na outra, sem duplicar dinheiro.
//
//  IDENTIDADE GLOBAL (guid): cada linha ganha um id GLOBAL = "maquina:id_local".
//  As máquinas guardam ids locais densos (1,2,3…) e TRADUZEM as chaves estrangeiras
//  (venda→itens, venda→cliente…) por esse guid a cada troca. Assim o MESMO registro
//  pode ter id 7 numa máquina e id 30040 noutra, e os vínculos continuam certos —
//  é assim que sincronização multi-mestre séria funciona (nada de "faixa de id",
//  que o AUTOINCREMENT do SQLite fura).
//
//  NÃO DUPLICA / NÃO BAGUNÇA:
//   • guid único → inserir 2× é ignorado (idempotente), mesmo relendo um arquivo.
//   • ESTOQUE entra por DELTA (a variação de cada movimento aplica 1× só, na 1ª vez
//     que o movimento chega) → as máquinas convergem no mesmo saldo sem depender
//     de ordem.
//   • Cadastros (produto, cliente…) usam ÚLTIMA-MUDANÇA-VENCE pela hora do evento.
//   • Vendas/pagamentos/movimentos são imutáveis → entram e pronto.
//
//  CAPTURA: gatilhos (triggers) gravam cada escrita num diário (sync_oplog) e
//  carimbam o guid (sync_guid). Uma flag desliga os gatilhos enquanto APLICAMOS o
//  que vem de fora (senão viraria eco). Só captura quando o sync está LIGADO.
//
//  TRANSPORTE: a cada ciclo exporta o que é novo pra
//     <Drive>/AcaiDoCentro-Sync/outbox/<minha-maquina>/<contador>.json
//  e lê as pastas das OUTRAS máquinas, aplicando o que ainda não aplicou.
// ============================================================================
const fs = require('fs');
const path = require('path');

module.exports = function createSync({ db, dadosDir, logErro }) {
  const log = (m) => { try { console.log('🔁 [sync] ' + m); } catch {} };
  const erro = (ctx, e) => { try { (logErro || (() => {}))('sync-' + ctx, e); } catch {} };

  // ── Tabelas sincronizadas (ORDEM = pai antes de filho, pro FK resolver no backfill) ──
  //  tipoPk: 'text' (chave natural global, ex. produtos.codigo) | 'int' (autoincrement local)
  //  estrategia: 'lww' (última mudança vence) · 'append' (imutável) · 'estoque' (delta)
  //  fks: colunas que apontam pra outra tabela (traduzidas por guid). ref 'produtos' é texto (global).
  //  estrategia: 'lww' (cadastro; ult.-mudanca-vence, com LOG de conflito p/ nada sumir calado)
  //            · 'append' (imutavel puro; insere 1x e nunca muda)
  //            · 'imutavel' (dinheiro/venda; insere 1x + so aplica transicoes MONOTONICAS de
  //               cancelamento/estorno/pagamento — nunca sobrescreve, nunca apaga operacao)
  //            · 'estoque' (movimento; aplica DELTA 1x)
  //  mono: { campoGatilho: [colunas a copiar] } — copia SO quando o par tem o gatilho "ligado"
  //        (nao-nulo/1) e o local ainda "desligado". Ex.: cancelar venda, estornar, marcar pago.
  const TABELAS = [
    { tbl: 'produtos',              pk: 'codigo', tipoPk: 'text', estrategia: 'lww', ts: 'atualizado_em', ignorar: ['estoque'], conflito: true },
    { tbl: 'clientes',              pk: 'id', tipoPk: 'int', estrategia: 'lww', ts: 'atualizado_em', conflito: true },
    { tbl: 'funcionarios',          pk: 'id', tipoPk: 'int', estrategia: 'lww', ts: 'criado_em', conflito: true },
    { tbl: 'financeiro_contas',     pk: 'id', tipoPk: 'int', estrategia: 'lww', ts: 'atualizado_em' },
    { tbl: 'financeiro_categorias', pk: 'id', tipoPk: 'int', estrategia: 'lww', ts: 'criado_em' },
    { tbl: 'vendas',                pk: 'id', tipoPk: 'int', estrategia: 'imutavel', ts: 'criado_em', fks: [{ col: 'cliente_id', ref: 'clientes' }],
      mono: { cancelada_em: ['status', 'cancelada_em', 'motivo_cancelamento'] } },
    { tbl: 'vendas_itens',          pk: 'id', tipoPk: 'int', estrategia: 'append', ts: 'criado_em', fks: [{ col: 'venda_id', ref: 'vendas' }] },
    { tbl: 'pagamentos',            pk: 'id', tipoPk: 'int', estrategia: 'append', ts: 'criado_em', fks: [{ col: 'venda_id', ref: 'vendas' }, { col: 'cliente_id', ref: 'clientes' }] },
    { tbl: 'clientes_extrato',      pk: 'id', tipoPk: 'int', estrategia: 'append', ts: 'criado_em', fks: [{ col: 'cliente_id', ref: 'clientes' }] },
    { tbl: 'fidelidade_movimentos', pk: 'id', tipoPk: 'int', estrategia: 'append', ts: 'criado_em', fks: [{ col: 'cliente_id', ref: 'clientes' }] },
    { tbl: 'anotacoes',             pk: 'id', tipoPk: 'int', estrategia: 'imutavel', ts: 'criado_em', fks: [{ col: 'venda_id', ref: 'vendas' }],
      mono: { pago: ['pago', 'pago_em', 'pago_formas', 'historico'] } },
    { tbl: 'estoque_movimentos',    pk: 'id', tipoPk: 'int', estrategia: 'estoque', ts: 'criado_em' },
    { tbl: 'financeiro_movimentos', pk: 'id', tipoPk: 'int', estrategia: 'imutavel', ts: 'criado_em', fks: [{ col: 'conta_id', ref: 'financeiro_contas' }, { col: 'categoria_id', ref: 'financeiro_categorias' }],
      mono: { estornado_em: ['situacao', 'estornado_em', 'estorno_motivo'] } },
    { tbl: 'compras_acai',          pk: 'id', tipoPk: 'int', estrategia: 'imutavel', ts: 'criado_em',
      mono: { pago: ['pago', 'data_pagamento', 'forma_pagamento', 'financeiro_movimento_id'] } },
    { tbl: 'movimentacoes_nc',      pk: 'id', tipoPk: 'int', estrategia: 'imutavel', ts: 'criado_em',
      mono: { estornado: ['estornado'] } },
    { tbl: 'operacao_fechamentos',  pk: 'id', tipoPk: 'int', estrategia: 'append', ts: 'criado_em' },
    { tbl: 'balancos',              pk: 'id', tipoPk: 'int', estrategia: 'append', ts: 'criado_em' },
    { tbl: 'litros_producao',       pk: 'id', tipoPk: 'int', estrategia: 'lww', ts: 'criado_em' },
    // Produção (registros/custo; o EFEITO no estoque ja vai por estoque_movimentos)
    { tbl: 'producoes',                pk: 'id', tipoPk: 'int', estrategia: 'append', ts: 'criado_em' },
    { tbl: 'producoes_itens_entrada',  pk: 'id', tipoPk: 'int', estrategia: 'append', fks: [{ col: 'producao_id', ref: 'producoes' }] },
    { tbl: 'producoes_itens_saida',    pk: 'id', tipoPk: 'int', estrategia: 'append', fks: [{ col: 'producao_id', ref: 'producoes' }] },
    { tbl: 'producao_ordens',          pk: 'id', tipoPk: 'int', estrategia: 'append', ts: 'criado_em' },
    { tbl: 'producao_ordens_saidas',   pk: 'id', tipoPk: 'int', estrategia: 'append', fks: [{ col: 'ordem_id', ref: 'producao_ordens' }] },
  ];
  const CFG = Object.fromEntries(TABELAS.map(t => [t.tbl, t]));
  const INT = TABELAS.filter(t => t.tipoPk === 'int');

  // ── Estruturas de controle ─────────────────────────────────────────────────
  function garantirSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_meta (chave TEXT PRIMARY KEY, valor TEXT);
      CREATE TABLE IF NOT EXISTS sync_oplog (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, pk TEXT NOT NULL, op TEXT NOT NULL, ts TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_guid (
        tbl TEXT NOT NULL, guid TEXT NOT NULL, local_id INTEGER NOT NULL, PRIMARY KEY (tbl, guid)
      );
      CREATE INDEX IF NOT EXISTS idx_guid_local ON sync_guid(tbl, local_id);
      CREATE TABLE IF NOT EXISTS sync_peers (
        station TEXT PRIMARY KEY, nome TEXT, ultimo_contador INTEGER DEFAULT 0, visto_em TEXT
      );
      CREATE TABLE IF NOT EXISTS sync_conflitos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT, guid TEXT, quando TEXT,
        vencedor TEXT, versao_local TEXT, versao_peer TEXT, revisado INTEGER DEFAULT 0
      );
    `);
    if (!getMeta('sync_aplicando')) setMeta('sync_aplicando', '0');
  }
  const getMeta = (k) => { try { const r = db.prepare('SELECT valor FROM sync_meta WHERE chave=?').get(k); return r ? r.valor : null; } catch { return null; } };
  const setMeta = (k, v) => { try { db.prepare('INSERT INTO sync_meta(chave,valor) VALUES(?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor').run(k, String(v)); } catch (e) { erro('meta', e); } };
  const aplicando = (v) => setMeta('sync_aplicando', v ? '1' : '0');

  // ── Gatilhos: capturam escrita (guid + diário) só com sync LIGADO e fora de aplicação ──
  function instalarGatilhos() {
    const agora = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
    const st = "(SELECT valor FROM sync_meta WHERE chave='station_id')";
    const cap = `(SELECT valor FROM sync_meta WHERE chave='ativo')='1' AND (SELECT valor FROM sync_meta WHERE chave='sync_aplicando')<>'1'`;
    for (const t of TABELAS) {
      const b = ('_sync_' + t.tbl).slice(0, 55);
      const oplog = (ref) => `INSERT INTO sync_oplog(tbl,pk,op,ts) VALUES('${t.tbl}', ${ref}.${t.pk}, 'U', ${agora});`;
      const guid = (ref) => t.tipoPk === 'int'
        ? `INSERT OR IGNORE INTO sync_guid(tbl,guid,local_id) VALUES('${t.tbl}', ${st}||':'||${ref}.${t.pk}, ${ref}.${t.pk});` : '';
      try {
        db.exec(`CREATE TRIGGER IF NOT EXISTS ${b}_ai AFTER INSERT ON ${t.tbl} WHEN ${cap} BEGIN ${guid('NEW')} ${oplog('NEW')} END;`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS ${b}_au AFTER UPDATE ON ${t.tbl} WHEN ${cap} BEGIN ${oplog('NEW')} END;`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS ${b}_ad AFTER DELETE ON ${t.tbl} WHEN ${cap} BEGIN INSERT INTO sync_oplog(tbl,pk,op,ts) VALUES('${t.tbl}', OLD.${t.pk}, 'D', ${agora}); END;`);
      } catch (e) { erro('trigger-' + t.tbl, e); }
    }
  }

  // ── guid <-> id local ──────────────────────────────────────────────────────
  const guidDe = (tbl, localId) => {
    const t = CFG[tbl];
    if (t && t.tipoPk === 'text') return tbl + ':' + localId;
    try { const r = db.prepare('SELECT guid FROM sync_guid WHERE tbl=? AND local_id=?').get(tbl, localId); return r ? r.guid : null; } catch { return null; }
  };
  const localDeGuid = (tbl, guid) => {
    const t = CFG[tbl];
    if (t && t.tipoPk === 'text') return String(guid).slice((tbl + ':').length);   // produtos: guid = "produtos:CODIGO"
    try { const r = db.prepare('SELECT local_id FROM sync_guid WHERE tbl=? AND guid=?').get(tbl, guid); return r ? r.local_id : null; } catch { return null; }
  };

  // Carimba guid nas linhas já existentes (idempotente por INSERT OR IGNORE) —
  // cobre tudo que foi criado ANTES do sync ser ligado. Barato de repetir.
  function adotarGuids() {
    const st = getMeta('station_id'); if (!st) return;
    try {
      db.exec('BEGIN');
      for (const t of INT) {
        try { db.prepare(`INSERT OR IGNORE INTO sync_guid(tbl,guid,local_id) SELECT '${t.tbl}', ?||':'||${t.pk}, ${t.pk} FROM ${t.tbl}`).run(st); } catch (e) { erro('adotar-' + t.tbl, e); }
      }
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} erro('adotar', e); }
  }

  // Enfileira TODO o acervo no diário (1×) — pra uma máquina nova receber tudo
  function backfill() {
    if (getMeta('backfilled') === '1') return { ok: true, jaFeito: true };
    adotarGuids();
    let total = 0;
    try {
      db.exec('BEGIN');
      const agora = new Date().toISOString();
      const ins = db.prepare('INSERT INTO sync_oplog(tbl,pk,op,ts) VALUES(?,?,?,?)');
      for (const t of TABELAS) {
        let rows = [];
        try { rows = db.prepare(`SELECT ${t.pk} k FROM ${t.tbl}`).all(); } catch { rows = []; }
        for (const r of rows) { ins.run(t.tbl, String(r.k), 'U', agora); total++; }
      }
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} erro('backfill', e); }
    setMeta('backfilled', '1');
    log(`backfill: ${total} registros enfileirados`);
    return { ok: true, total };
  }

  // ── Pasta compartilhada (Google Drive) ─────────────────────────────────────
  function detectarGoogleDrive() {
    for (const L of 'GHIJKLMNOPDEF'.split('')) {
      for (const n of ['Meu Drive', 'My Drive']) { const p = `${L}:\\${n}`; try { if (fs.existsSync(p)) return p; } catch {} }
    }
    const up = process.env.USERPROFILE || '';
    for (const n of ['Google Drive', 'GoogleDrive']) { const p = path.join(up, n); try { if (fs.existsSync(p)) return p; } catch {} }
    return null;
  }
  function pastaSync() {
    let dir = (getMeta('pasta') || process.env.ACAI_SYNC_DIR || '').trim();
    if (dir === 'OFF') return null;
    if (!dir) { const gd = detectarGoogleDrive(); if (gd) dir = path.join(gd, 'AcaiDoCentro-Sync'); }
    return dir || null;
  }
  function pastas() {
    const raiz = pastaSync(); if (!raiz) return null;
    const outbox = path.join(raiz, 'outbox');
    const minha = path.join(outbox, getMeta('station_id') || 'sem-id');
    try { fs.mkdirSync(minha, { recursive: true }); } catch (e) { erro('mkdir', e); return null; }
    return { raiz, outbox, minha };
  }

  // ── EXPORTAR ────────────────────────────────────────────────────────────────
  function exportarAgora() {
    if (getMeta('ativo') !== '1') return { ok: false, motivo: 'desligado' };
    const dirs = pastas(); if (!dirs) return { ok: false, motivo: 'sem-pasta' };
    const desde = +(getMeta('last_export_seq') || 0);
    let rows = [];
    try { rows = db.prepare('SELECT seq,tbl,pk,op,ts FROM sync_oplog WHERE seq>? ORDER BY seq LIMIT 5000').all(desde); } catch (e) { erro('ler-oplog', e); return { ok: false }; }
    if (!rows.length) return { ok: true, enviados: 0 };
    const ops = [];
    for (const r of rows) {
      const t = CFG[r.tbl]; if (!t) continue;
      const guid = guidDe(r.tbl, r.pk);
      if (!guid) continue;
      if (r.op === 'D') { ops.push({ seq: r.seq, tbl: r.tbl, op: 'D', guid, ts: r.ts }); continue; }
      let row = null;
      try { row = db.prepare(`SELECT * FROM ${r.tbl} WHERE ${t.pk}=?`).get(r.pk); } catch {}
      if (!row) continue;                                   // sumiu depois — o 'D' cuida
      if (t.tipoPk === 'int') delete row[t.pk];             // o par vai atribuir id local próprio
      for (const fk of (t.fks || [])) {                     // traduz FK: id local -> guid
        const v = row[fk.col];
        if (v == null) continue;
        const rt = CFG[fk.ref];
        row[fk.col] = (rt && rt.tipoPk === 'text') ? v : (guidDe(fk.ref, v) || null);
      }
      ops.push({ seq: r.seq, tbl: r.tbl, op: 'U', guid, ts: r.ts, row });
    }
    const ate = rows[rows.length - 1].seq;
    const lote = { station: getMeta('station_id'), nome: getMeta('station_nome'), contador: ate, gerado_em: new Date().toISOString(), ops };
    try {
      const nome = String(ate).padStart(15, '0') + '.json';
      const tmp = path.join(dirs.minha, nome + '.tmp');
      fs.writeFileSync(tmp, JSON.stringify(lote));
      fs.renameSync(tmp, path.join(dirs.minha, nome));       // atômico (o Drive não pega meio-arquivo)
    } catch (e) { erro('escrever-lote', e); return { ok: false }; }
    setMeta('last_export_seq', ate);
    setMeta('ultimo_export', new Date().toISOString());
    podarOplog();
    return { ok: true, enviados: ops.length, ate };
  }

  // ── IMPORTAR ─────────────────────────────────────────────────────────────────
  function importarAgora() {
    if (getMeta('ativo') !== '1') return { ok: false, motivo: 'desligado' };
    const dirs = pastas(); if (!dirs) return { ok: false, motivo: 'sem-pasta' };
    const meu = getMeta('station_id');
    let peers = [];
    try { peers = fs.readdirSync(dirs.outbox, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== meu).map(d => d.name); } catch { peers = []; }
    let aplicadosTotal = 0;
    for (const peer of peers) {
      const dirPeer = path.join(dirs.outbox, peer);
      let arquivos = [];
      try { arquivos = fs.readdirSync(dirPeer).filter(f => /^\d+\.json$/.test(f)).sort(); } catch { continue; }
      const jaLido = +((db.prepare('SELECT ultimo_contador c FROM sync_peers WHERE station=?').get(peer) || {}).c || 0);
      for (const f of arquivos) {
        const contador = parseInt(f, 10);
        if (contador <= jaLido) continue;
        let lote = null;
        try { lote = JSON.parse(fs.readFileSync(path.join(dirPeer, f), 'utf8')); } catch (e) { erro('ler-lote', e); continue; }
        if (!lote || !Array.isArray(lote.ops)) continue;
        aplicadosTotal += aplicarLote(peer, lote);
        db.prepare(`INSERT INTO sync_peers(station,nome,ultimo_contador,visto_em) VALUES(?,?,?,?)
                    ON CONFLICT(station) DO UPDATE SET nome=excluded.nome, ultimo_contador=excluded.ultimo_contador, visto_em=excluded.visto_em`)
          .run(peer, lote.nome || peer, contador, new Date().toISOString());
      }
    }
    setMeta('ultimo_import', new Date().toISOString());
    return { ok: true, aplicados: aplicadosTotal };
  }

  function aplicarLote(peer, lote) {
    let aplicados = 0;
    aplicando(true);
    try {
      db.exec('BEGIN');
      for (const op of lote.ops) { try { if (aplicarOp(op)) aplicados++; } catch (e) { erro('aplicar-' + op.tbl, e); } }
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} erro('lote', e); }
    aplicando(false);
    return aplicados;
  }

  function traduzirFks(t, row) {
    for (const fk of (t.fks || [])) {
      const g = row[fk.col];
      if (g == null) continue;
      const rt = CFG[fk.ref];
      if (rt && rt.tipoPk === 'text') continue;             // produto: já é código global
      const lid = localDeGuid(fk.ref, g);
      row[fk.col] = (lid != null) ? lid : null;             // pai ainda não chegou → deixa solto (raro)
    }
    return row;
  }

  function aplicarOp(op) {
    const t = CFG[op.tbl]; if (!t) return false;

    if (op.op === 'D') {
      if (t.estrategia === 'estoque') return false;         // apagar movimento é raro; não mexe no saldo
      const lid = localDeGuid(op.tbl, op.guid);
      if (lid == null) return false;
      try { db.prepare(`DELETE FROM ${op.tbl} WHERE ${t.pk}=?`).run(lid); } catch {}
      return true;
    }
    const row = op.row; if (!row) return false;

    // PRODUTO (chave natural): saldo NÃO vem do par (só o cadastro); estoque só por delta
    if (t.tipoPk === 'text') {
      const local = db.prepare(`SELECT * FROM ${t.tbl} WHERE ${t.pk}=?`).get(row[t.pk]);
      if (local) {
        const ign = (t.ignorar || []).concat([t.ts]);
        const peerTs = (row[t.ts] != null ? row[t.ts] : op.ts) || '';   // compara mesma régua: atualizado_em × atualizado_em
        if (peerTs < (local[t.ts] || '')) {                 // local é mais novo → mantém
          if (t.conflito && rowsDiferentes(local, row, ign)) logConflito(t.tbl, op.guid, 'local', local, row);
          return true;
        }
        if (t.conflito && rowsDiferentes(local, row, ign)) logConflito(t.tbl, op.guid, 'peer', local, row);
        upsertExcluindo(t, row, t.ignorar || []);
      } else upsertExcluindo(t, row, []);                    // produto novo: entra COM estoque (saldo de abertura)
      return true;
    }

    // Tabelas de id local: identidade pelo guid
    traduzirFks(t, row);
    const lid = localDeGuid(op.tbl, op.guid);
    if (lid != null) {                                       // já existe local
      if (t.estrategia === 'append' || t.estrategia === 'estoque') return false;   // imutável puro / delta: nada muda
      if (t.estrategia === 'imutavel') { aplicarMono(t, lid, row); return true; }  // só transições: cancelou/estornou/pagou
      // 'lww' (cadastro): última-mudança-vence + LOG de conflito (nada some calado)
      const local = db.prepare(`SELECT * FROM ${op.tbl} WHERE ${t.pk}=?`).get(lid);
      const localTs = (local && local[t.ts]) || '';
      const peerTs = (row[t.ts] != null ? row[t.ts] : op.ts) || '';   // mesma régua: coluna de data × coluna de data
      if (peerTs < localTs) {                                // local é mais novo → mantém
        if (t.conflito && local && rowsDiferentes(local, row, [t.ts])) logConflito(op.tbl, op.guid, 'local', local, row);
        return true;
      }
      if (t.conflito && local && rowsDiferentes(local, row, [t.ts])) logConflito(op.tbl, op.guid, 'peer', local, row);
      const cols = Object.keys(row);
      const set = cols.map(c => `"${c}"=?`).join(',');
      try { db.prepare(`UPDATE ${op.tbl} SET ${set} WHERE ${t.pk}=?`).run(...cols.map(c => row[c]), lid); } catch (e) { erro('upd-' + op.tbl, e); }
      return true;
    }
    // novo: insere com id LOCAL próprio e registra o guid
    const cols = Object.keys(row);
    const ph = cols.map(() => '?').join(',');
    let novoId = null;
    try {
      const info = db.prepare(`INSERT INTO ${op.tbl} (${cols.map(c => '"' + c + '"').join(',')}) VALUES (${ph})`).run(...cols.map(c => row[c]));
      novoId = info.lastInsertRowid;
    } catch (e) { erro('ins-' + op.tbl, e); return false; }
    try { db.prepare('INSERT OR IGNORE INTO sync_guid(tbl,guid,local_id) VALUES(?,?,?)').run(op.tbl, op.guid, novoId); } catch {}
    if (t.estrategia === 'estoque') aplicarDeltaEstoque(row);   // aplica a variação no saldo (1ª e única vez)
    return true;
  }

  function upsertExcluindo(t, row, ignorar) {
    const skip = new Set(ignorar);
    const cols = Object.keys(row).filter(c => !skip.has(c));
    const ph = cols.map(() => '?').join(',');
    const set = cols.filter(c => c !== t.pk).map(c => `"${c}"=excluded."${c}"`).join(',');
    const sql = `INSERT INTO ${t.tbl} (${cols.map(c => '"' + c + '"').join(',')}) VALUES (${ph})
                 ON CONFLICT(${t.pk}) DO UPDATE SET ${set || `"${t.pk}"="${t.pk}"`}`;
    try { db.prepare(sql).run(...cols.map(c => row[c])); } catch (e) { erro('upsert-' + t.tbl, e); }
  }

  function aplicarDeltaEstoque(mov) {
    const cod = mov.produto_codigo; if (!cod) return;
    const p = db.prepare('SELECT estoque FROM produtos WHERE codigo=?').get(cod);
    if (!p) return;                                          // produto ainda não chegou; acerta quando chegar
    const atual = +p.estoque || 0, qtd = +mov.quantidade || 0;
    let novo;
    if (mov.tipo === 'ajuste') novo = (mov.estoque_novo != null) ? +mov.estoque_novo : atual;
    else if (mov.tipo === 'entrada' || mov.tipo === 'cancelamento') novo = atual + qtd;
    else novo = atual - qtd;                                 // saida (venda)
    try { db.prepare('UPDATE produtos SET estoque=? WHERE codigo=?').run(Math.round(novo * 100) / 100, cod); } catch (e) { erro('delta', e); }
  }

  // IMUTÁVEL: nunca sobrescreve a operação; só copia transições MONOTÔNICAS (cancelou/
  // estornou/pagou) quando o par tem o gatilho "ligado" e o local ainda "desligado".
  const ligado = (v) => v != null && v !== '' && v !== 0 && v !== '0';
  function aplicarMono(t, lid, peerRow) {
    const mono = t.mono || {};
    const local = db.prepare(`SELECT * FROM ${t.tbl} WHERE ${t.pk}=?`).get(lid);
    if (!local) return;
    const sets = [], args = [];
    for (const gat of Object.keys(mono)) {
      if (ligado(peerRow[gat]) && !ligado(local[gat])) {     // transição só num sentido (nunca "des-cancela")
        for (const c of mono[gat]) { sets.push(`"${c}"=?`); args.push(peerRow[c]); }
      }
    }
    if (sets.length) { args.push(lid); try { db.prepare(`UPDATE ${t.tbl} SET ${sets.join(',')} WHERE ${t.pk}=?`).run(...args); } catch (e) { erro('mono-' + t.tbl, e); } }
  }

  // Log de conflito de cadastro (LWW) — guarda a versão que PERDEU pra nada sumir calado.
  function rowsDiferentes(a, b, ignorar) {
    const skip = new Set(ignorar || []);
    for (const k of Object.keys(b)) { if (skip.has(k)) continue; if (String(a[k] == null ? '' : a[k]) !== String(b[k] == null ? '' : b[k])) return true; }
    return false;
  }
  function logConflito(tbl, guid, vencedor, localRow, peerRow) {
    try { db.prepare('INSERT INTO sync_conflitos(tbl,guid,quando,vencedor,versao_local,versao_peer) VALUES(?,?,?,?,?,?)')
      .run(tbl, guid, new Date().toISOString(), vencedor, JSON.stringify(localRow || null), JSON.stringify(peerRow || null)); } catch (e) { erro('conflito', e); }
  }

  // Poda o diário já exportado (o arquivo no Drive é o registro durável) — evita crescer sem fim
  function podarOplog() {
    const ate = +(getMeta('last_export_seq') || 0) - 2000;   // guarda uma folga
    if (ate > 0) { try { db.prepare('DELETE FROM sync_oplog WHERE seq<?').run(ate); } catch {} }
  }

  // ── Configuração / liga-desliga ────────────────────────────────────────────
  function configurar({ nome, numero, pasta, primeira } = {}) {
    if (!getMeta('station_id')) setMeta('station_id', 'M' + Math.random().toString(36).slice(2, 8).toUpperCase());
    if (nome != null) setMeta('station_nome', String(nome).trim() || ('Máquina ' + (numero || '')));
    if (numero != null) setMeta('station_numero', Math.max(1, parseInt(numero, 10) || 1));  // só rótulo
    if (pasta != null) setMeta('pasta', String(pasta).trim());   // '' = auto (Drive) · 'OFF' = desliga
    if (primeira != null) setMeta('primeira_maquina', primeira ? '1' : '0');
    adotarGuids();
    return status();
  }
  function ligar(sim) {
    if (sim) { adotarGuids(); if (getMeta('primeira_maquina') === '1') backfill(); }
    setMeta('ativo', sim ? '1' : '0');
    return status();
  }

  // Quantos pacotes das OUTRAS máquinas ainda não li (pendentes para receber)
  function pendentesReceber() {
    const raiz = pastaSync(); if (!raiz) return 0;
    const outbox = path.join(raiz, 'outbox'); const meu = getMeta('station_id');
    let total = 0;
    try {
      for (const d of fs.readdirSync(outbox, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name === meu) continue;
        const jaLido = +((db.prepare('SELECT ultimo_contador c FROM sync_peers WHERE station=?').get(d.name) || {}).c || 0);
        for (const f of fs.readdirSync(path.join(outbox, d.name))) { if (/^\d+\.json$/.test(f) && parseInt(f, 10) > jaLido) total++; }
      }
    } catch {}
    return total;
  }
  function status() {
    let pendentes = 0, peers = [], conflitos = 0;
    try { pendentes = (db.prepare('SELECT COUNT(*) c FROM sync_oplog WHERE seq>?').get(+(getMeta('last_export_seq') || 0)) || {}).c || 0; } catch {}
    try { peers = db.prepare('SELECT station,nome,ultimo_contador,visto_em FROM sync_peers ORDER BY visto_em DESC').all(); } catch {}
    try { conflitos = (db.prepare('SELECT COUNT(*) c FROM sync_conflitos WHERE revisado=0').get() || {}).c || 0; } catch {}
    const pasta = pastaSync();
    let online = false; try { online = !!pasta && fs.existsSync(pasta); } catch {}   // a pasta do Drive está acessível?
    return {
      ativo: getMeta('ativo') === '1', online: getMeta('ativo') === '1' && online,
      station_id: getMeta('station_id') || null,
      nome: getMeta('station_nome') || null, numero: +(getMeta('station_numero') || 0) || null,
      pasta, pastaConfigurada: getMeta('pasta') || null, driveDetectado: !!detectarGoogleDrive(),
      primeiraMaquina: getMeta('primeira_maquina') === '1', backfillFeito: getMeta('backfilled') === '1',
      pendentesEnvio: pendentes, pendentesReceber: pendentesReceber(), conflitos,
      ultimoExport: getMeta('ultimo_export') || null, ultimoImport: getMeta('ultimo_import') || null,
      maquinas: peers,
    };
  }

  // ── Agendador ────────────────────────────────────────────────────────────────
  let timer = null;
  function ciclo() { if (getMeta('ativo') !== '1') return; try { exportarAgora(); } catch (e) { erro('ciclo-exp', e); } try { importarAgora(); } catch (e) { erro('ciclo-imp', e); } }
  function iniciarAgendador(ms) { if (timer) return; timer = setInterval(ciclo, ms || 20000); if (timer.unref) timer.unref(); log('agendador ligado (' + ((ms || 20000) / 1000) + 's)'); }

  // ── Init ─────────────────────────────────────────────────────────────────────
  garantirSchema();
  instalarGatilhos();
  log('pronto (' + (getMeta('station_nome') || 's/ nome') + ', ' + (getMeta('ativo') === '1' ? 'LIGADO' : 'desligado') + ')');

  return { status, configurar, ligar, backfill, exportarAgora, importarAgora, iniciarAgendador, pastaSync };
};
