/* ── MANUTENÇÃO / OPS (Fase 11) ──────────────────────────────────────────────
   Backup automático do acai.db (VACUUM INTO — cópia consistente e compactada),
   retenção, logs de erro (arquivo) e de ações críticas (tabela logs_acoes), e
   ferramentas de manutenção da mídia do WhatsApp. Não mexe em regra de negócio.
   O server.js injeta o banco e a raiz do projeto e recebe as funções de volta. */
const fs = require('fs');
const path = require('path');

module.exports = function createManutencao({ db, rootDir }) {
  const dirBackups = path.join(rootDir, 'backups');
  const dirLogs = path.join(rootDir, 'logs');
  try { fs.mkdirSync(dirBackups, { recursive: true }); } catch {}
  try { fs.mkdirSync(dirLogs, { recursive: true }); } catch {}
  const arqErro = path.join(dirLogs, 'erro.log');

  // ── LOGS DE ERRO (arquivo logs/erro.log) — nunca grava .env/chaves ──
  function logErro(contexto, err) {
    const detalhe = (err && err.stack) || (err && err.message) || String(err);
    try { fs.appendFileSync(arqErro, `[${new Date().toISOString()}] ${contexto}: ${detalhe}\n`); } catch {}
    console.log(`⚠️ ${contexto}:`, (err && err.message) || err);
  }

  // ── LOGS DE AÇÕES CRÍTICAS (tabela logs_acoes) ──
  db.exec(`CREATE TABLE IF NOT EXISTS logs_acoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, acao TEXT, modulo TEXT, detalhes TEXT, origem TEXT
  )`);
  function logAcao(acao, modulo, detalhes, origem) {
    try {
      const det = detalhes == null ? '' : (typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes));
      db.prepare('INSERT INTO logs_acoes (data,acao,modulo,detalhes,origem) VALUES (?,?,?,?,?)')
        .run(new Date().toISOString(), acao || '', modulo || '', det, origem || 'sistema');
    } catch (e) { logErro('logAcao', e); }
  }

  // ── BACKUP ──
  const p2 = n => String(n).padStart(2, '0');
  function nomeBackup(d = new Date()) {
    return `acai-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}-${p2(d.getMinutes())}.db`;
  }
  function listarBackups() {
    try {
      return fs.readdirSync(dirBackups).filter(f => /^acai-.*\.db$/.test(f)).map(f => {
        const st = fs.statSync(path.join(dirBackups, f));
        return { arquivo: f, tamanho: st.size, criado: st.mtime.toISOString() };
      }).sort((a, b) => b.criado.localeCompare(a.criado)); // mais recente primeiro
    } catch { return []; }
  }
  function criarBackup(motivo) {
    const arq = path.join(dirBackups, nomeBackup());
    try {
      // VACUUM INTO: cópia limpa e compactada, segura mesmo com o banco aberto.
      // (barra normal e aspas escapadas pro literal do SQLite no Windows)
      db.exec(`VACUUM INTO '${arq.replace(/\\/g, '/').replace(/'/g, "''")}'`);
      const tamanho = fs.statSync(arq).size;
      console.log(`💾 Backup criado: ${nomeBackup()} (${(tamanho / 1048576).toFixed(1)} MB)${motivo ? ' · ' + motivo : ''}`);
      logAcao('backup criado', 'backup', { arquivo: path.basename(arq), tamanho, motivo: motivo || '' }, 'sistema');
      aplicarRetencao();
      return { ok: true, arquivo: path.basename(arq), tamanho };
    } catch (e) {
      logErro('backup', e);
      logAcao('falha de backup', 'backup', { erro: e.message }, 'sistema');
      return { ok: false, erro: e.message };
    }
  }
  function isoSemana(iso) {
    const d = new Date(iso); const dia = (d.getDay() + 6) % 7; // seg=0
    const quinta = new Date(d); quinta.setDate(d.getDate() - dia + 3);
    const jan1 = new Date(quinta.getFullYear(), 0, 1);
    const sem = Math.ceil(((quinta - jan1) / 86400000 + 1) / 7);
    return `${quinta.getFullYear()}-S${sem}`;
  }
  // Retenção: TODOS das últimas 48h (os de hora em hora) + 14 diários + 8 semanais.
  // NUNCA apaga o mais recente. Loga quantos saíram.
  function aplicarRetencao() {
    const bks = listarBackups();
    if (bks.length <= 1) return;
    const manter = new Set([bks[0].arquivo]); // o mais recente sempre fica
    const agoraMs = Date.now();
    // 1) guarda TODOS os backups das últimas 48h (é onde ficam os de hora em hora)
    for (const b of bks) { if (agoraMs - new Date(b.criado).getTime() <= 48 * 3600 * 1000) manter.add(b.arquivo); }
    const porDia = new Map();
    for (const b of bks) { const dia = b.criado.slice(0, 10); if (!porDia.has(dia)) porDia.set(dia, b.arquivo); }
    [...porDia.values()].slice(0, 14).forEach(a => manter.add(a));
    const porSemana = new Map();
    for (const b of bks) { const s = isoSemana(b.criado); if (!porSemana.has(s)) porSemana.set(s, b.arquivo); }
    [...porSemana.values()].slice(0, 8).forEach(a => manter.add(a));
    let removidos = 0;
    for (const b of bks) if (!manter.has(b.arquivo)) { try { fs.unlinkSync(path.join(dirBackups, b.arquivo)); removidos++; } catch {} }
    if (removidos) console.log(`🧹 Retenção de backups: ${removidos} antigo(s) removido(s), ${manter.size} mantido(s).`);
  }
  function proximo0300() {
    const p = new Date(); p.setHours(3, 0, 0, 0);
    if (p <= new Date()) p.setDate(p.getDate() + 1);
    return p;
  }
  function temBackupHoje() {
    const hoje = new Date().toISOString().slice(0, 10);
    return listarBackups().some(b => b.criado.slice(0, 10) === hoje);
  }
  // minutos desde o backup mais recente (Infinity se não houver nenhum) — base do agendamento horário
  function minutosUltimoBackup() {
    const bks = listarBackups();
    if (!bks.length) return Infinity;
    return (Date.now() - new Date(bks[0].criado).getTime()) / 60000;
  }
  function statusBackup() {
    const bks = listarBackups();
    const min = minutosUltimoBackup();
    return {
      total: bks.length, ultimo: bks[0] || null,
      proximaExecucao: new Date(Date.now() + Math.max(0, (60 - min)) * 60000).toISOString(),
      pastaBackups: dirBackups,
      politica: 'automático DE HORA EM HORA · guarda 48h de horários + 14 diários + 8 semanais (o mais recente nunca é apagado)',
    };
  }
  // Agendador: backup DE HORA EM HORA. Confere a cada 10 min e faz um novo se já passou ~1h
  // do último (base = os próprios arquivos, então sobrevive a reinícios — se caiu no meio do dia,
  // reabrindo ele já garante um backup recente). Roda enquanto o programa estiver aberto.
  function iniciarAgendador() {
    if (minutosUltimoBackup() >= 60) {
      console.log('💾 Backup automático em 5s (não trava o boot).');
      setTimeout(() => criarBackup('inicialização'), 5000);
    }
    const t = setInterval(() => {
      if (minutosUltimoBackup() >= 60) criarBackup('automático (de hora em hora)');
    }, 10 * 60 * 1000); // confere a cada 10 min
    if (t.unref) t.unref();
  }

  // ── MÍDIA DO WHATSAPP (mensagens_wpp.midia) ──
  function statusMidia() {
    const r = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(LENGTH(midia)),0) bytes, MIN(criado) maisAntiga, MAX(criado) maisRecente FROM mensagens_wpp WHERE midia IS NOT NULL").get();
    const totalMsgs = db.prepare('SELECT COUNT(*) n FROM mensagens_wpp').get().n;
    return {
      totalMensagens: totalMsgs, mensagensComMidia: r.n,
      bytesAprox: r.bytes, tamanhoMB: +(r.bytes / 1048576).toFixed(1),
      midiaMaisAntiga: r.maisAntiga || null, midiaMaisRecente: r.maisRecente || null,
    };
  }
  // Limpa SÓ as colunas midia/midia_tipo de mensagens mais antigas que X dias (mantém o texto).
  function limparMidia(dias) {
    const d = +dias || 0;
    if (d <= 0) return { erro: 'Informe "dias" maior que 0.' };
    const limite = new Date(Date.now() - d * 86400000).toISOString();
    const alvo = db.prepare("SELECT COUNT(*) n FROM mensagens_wpp WHERE midia IS NOT NULL AND criado < ?").get(limite).n;
    db.prepare("UPDATE mensagens_wpp SET midia = NULL, midia_tipo = NULL WHERE midia IS NOT NULL AND criado < ?").run(limite);
    console.log(`🧹 Mídia limpa: ${alvo} mensagem(ns) mais antigas que ${d} dia(s) — texto preservado.`);
    logAcao('limpeza de mídia', 'manutencao', { dias: d, limpas: alvo }, 'admin');
    return { limpas: alvo, dias: d, anteriores_a: limite };
  }

  return { logErro, logAcao, criarBackup, listarBackups, statusBackup, iniciarAgendador, statusMidia, limparMidia };
};
