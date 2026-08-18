/* ── ATUALIZAÇÃO DO SISTEMA (in-ERP) ─────────────────────────────────────────
   Verifica/aplica atualizações vindas do GitHub (repo privado), preservando os
   dados (o git só mexe em arquivos versionados; acai.db/.env/backups são
   gitignored). A aplicação real é feita pelo `atualizador.bat` externo (encerra
   o servidor, git pull, npm install se preciso, reinicia, rollback em falha).
   Este módulo NÃO altera regra de negócio — só orquestra a atualização.
   Reutiliza manut.criarBackup e manut.logAcao. ───────────────────────────── */
const { execFile, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = function createAtualizacao({ db, rootDir, manut }) {
  const cfgPath = path.join(rootDir, 'update.config.json');
  const resultPath = path.join(rootDir, 'logs', 'ultima-atualizacao.txt');
  const pkgPath = path.join(rootDir, 'package.json');
  const batPath = path.join(rootDir, 'atualizador.bat');

  db.exec(`CREATE TABLE IF NOT EXISTS atualizacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, quando TEXT, por TEXT,
    de_commit TEXT, para_commit TEXT, status TEXT, detalhe TEXT)`);

  const lerConfig = () => { try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { return { repo: '', branch: 'main' }; } };
  const versaoInstalada = () => { try { return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '?'; } catch { return '?'; } };

  // ── ATUALIZAÇÃO ONLINE SEM GIT (repo PÚBLICO): compara a versão do package.json remoto
  // e aplica via atualizador_online.bat (baixa o ZIP do GitHub). Não precisa de Git. ──
  const https = require('https');
  const batOnlinePath = path.join(rootDir, 'atualizador_online.bat');
  const repoSlug = () => { const m = (lerConfig().repo || '').match(/github\.com[/:]([^/]+\/[^/.]+)/i); return m ? m[1] : 'mrodriguesdacostame-ai/programa-acai'; };
  function httpGet(url, redirects) {
    redirects = redirects || 0;
    return new Promise(resolve => {
      try {
        const req = https.get(url, { headers: { 'User-Agent': 'acai-updater' }, timeout: 15000 }, res => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 4) { res.resume(); return httpGet(res.headers.location, redirects + 1).then(resolve); }
          let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      } catch { resolve(null); }
    });
  }
  async function versaoRemota() {
    const branch = lerConfig().branch || 'main';
    const r = await httpGet(`https://raw.githubusercontent.com/${repoSlug()}/${branch}/package.json`);
    if (!r || r.status !== 200) return null;
    try { return JSON.parse(r.body).version || null; } catch { return null; }
  }
  const versaoMaior = (a, b) => {   // a > b ?
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x > y) return true; if (x < y) return false; }
    return false;
  };

  const gitP = (args) => new Promise(res => {
    execFile('git', args, { cwd: rootDir, windowsHide: true, timeout: 90000 }, (err, out, errout) =>
      res({ ok: !err, out: (out || '').trim(), errout: (errout || '').trim() }));
  });
  const gitSync = (args) => { try { return execFileSync('git', args, { cwd: rootDir, windowsHide: true, timeout: 15000 }).toString().trim(); } catch { return ''; } };

  // versão com timeout longo — usada no fetch da 1ª conexão (o usuário pode
  // demorar pra fazer o login do GitHub na janela que abre).
  const gitLongo = (args) => new Promise(res => {
    execFile('git', args, { cwd: rootDir, windowsHide: false, timeout: 300000 }, (err, out, errout) =>
      res({ ok: !err, out: (out || '').trim(), errout: (errout || '').trim() }));
  });

  const gitDisponivel = async () => (await gitP(['--version'])).ok;
  const ehRepo = async () => (await gitP(['rev-parse', '--is-inside-work-tree'])).ok;
  const temRemote = async () => (await gitP(['remote', 'get-url', 'origin'])).ok;

  function ultimoResultado() {
    try {
      const raw = fs.readFileSync(resultPath, 'utf8').trim();
      const [status, quando, detalhe] = raw.split('|');
      return { status, quando, detalhe: detalhe || '' };
    } catch { return null; }
  }

  // Ao subir: se a última atualização ficou "iniciada" e já há resultado no
  // arquivo, fecha o registro (o .bat não escreve no banco durante o restart).
  (function reconciliar() {
    try {
      const pend = db.prepare("SELECT * FROM atualizacoes WHERE status='iniciada' ORDER BY id DESC LIMIT 1").get();
      const r = ultimoResultado();
      if (pend && r && r.quando) {
        const st = r.status === 'OK' ? 'sucesso' : 'falha';
        const para = gitSync(['rev-parse', '--short', 'HEAD']);
        db.prepare('UPDATE atualizacoes SET status=?, detalhe=?, para_commit=? WHERE id=?').run(st, r.detalhe, para, pend.id);
      }
    } catch {}
  })();

  async function status() {
    const disp = await gitDisponivel();
    const repo = disp && await ehRepo();
    const conectado = repo && await temRemote();
    const branch = lerConfig().branch || 'main';
    // atrás/à frente do remoto (usa a ref origin/BR já em cache — não faz rede aqui, é rápido)
    let atras = 0, aFrente = 0;
    if (conectado) {
      atras = parseInt((await gitP(['rev-list', '--count', `HEAD..origin/${branch}`])).out, 10) || 0;
      aFrente = parseInt((await gitP(['rev-list', '--count', `origin/${branch}..HEAD`])).out, 10) || 0;
    }
    return {
      versao: versaoInstalada(),
      commitLocal: repo ? (await gitP(['rev-parse', '--short', 'HEAD'])).out : '',
      gitDisponivel: disp,
      conectado,
      onlineSemGit: fs.existsSync(batOnlinePath),   // da pra atualizar online mesmo SEM Git (repo publico + ZIP)
      atras, aFrente,
      repoUrl: lerConfig().repo,
      ultimoResultado: ultimoResultado(),
    };
  }

  async function verificar() {
    // SEM GIT (ou nao conectado) — repo e PUBLICO: confere pela versao do package.json remoto
    if (!(await gitDisponivel() && await ehRepo() && await temRemote())) {
      const vr = await versaoRemota();
      if (!vr) return { erro: 'Nao consegui acessar o GitHub. Confira a internet.' };
      const vi = versaoInstalada();
      const nova = versaoMaior(vr, vi);
      return { novaVersao: nova, semGit: true, versaoRemota: vr, versaoLocal: vi, resumo: nova ? [`Nova versao ${vr} disponivel (voce esta na ${vi}).`] : [] };
    }
    const branch = lerConfig().branch || 'main';
    const fetch = await gitP(['fetch', 'origin', branch]);
    if (!fetch.ok) return { erro: 'Não consegui acessar o GitHub. Confira a internet e o login.', detalhe: fetch.errout };
    const commitsAtras = parseInt((await gitP(['rev-list', '--count', `HEAD..origin/${branch}`])).out, 10) || 0;
    let resumo = [];
    if (commitsAtras > 0) {
      const log = (await gitP(['log', '--pretty=%s', `HEAD..origin/${branch}`])).out;
      resumo = log ? log.split('\n').slice(0, 12) : [];
    }
    return { novaVersao: commitsAtras > 0, commitsAtras, resumo, branch };
  }

  // Bloqueio de operação em andamento (heurístico — o carrinho é estado do navegador).
  function podeAtualizar() {
    try {
      const caixaAberto = db.prepare("SELECT COUNT(*) n FROM caixa_sessoes WHERE status='aberto'").get().n;
      if (caixaAberto > 0) return { pode: false, motivo: 'Há um caixa aberto. Feche o caixa antes de atualizar.' };
    } catch {}
    try {
      const recente = db.prepare('SELECT COUNT(*) n FROM vendas WHERE criado_em > ?').get(new Date(Date.now() - 30000).toISOString()).n;
      if (recente > 0) return { pode: false, motivo: 'Uma venda foi registrada agora há pouco. Aguarde alguns segundos e tente de novo.' };
    } catch {}
    return { pode: true };
  }

  async function aplicar(usuario) {
    const chk = podeAtualizar();
    if (!chk.pode) return { erro: chk.motivo, bloqueado: true };

    // SEM GIT (ou nao conectado) — repo PUBLICO: aplica pelo atualizador_online.bat (baixa o ZIP)
    if (!(await gitDisponivel() && await ehRepo() && await temRemote())) {
      const vr = await versaoRemota(), vi = versaoInstalada();
      if (!vr) return { erro: 'Nao consegui acessar o GitHub. Confira a internet.' };
      if (!versaoMaior(vr, vi)) return { ok: true, semNovidade: true, mensagem: 'Voce ja esta na versao mais recente — nada para atualizar.' };
      if (!fs.existsSync(batOnlinePath)) return { erro: 'atualizador_online.bat nao encontrado na pasta do sistema.' };
      const bk = manut.criarBackup('antes da atualizacao (online)');
      db.prepare('INSERT INTO atualizacoes (quando,por,de_commit,para_commit,status,detalhe) VALUES (?,?,?,?,?,?)')
        .run(new Date().toISOString(), usuario || '', vi, vr, 'iniciada', bk.ok ? 'backup ' + bk.arquivo : 'sem backup');
      manut.logAcao('atualizacao online iniciada', 'atualizacao', { por: usuario, de: vi, para: vr, backup: bk.arquivo || null }, 'admin');
      try { const child = spawn('cmd.exe', ['/c', batOnlinePath], { cwd: rootDir, detached: true, stdio: 'ignore', windowsHide: true }); child.unref(); }
      catch (e) { return { erro: 'Falha ao iniciar o atualizador: ' + e.message }; }
      return { ok: true, mensagem: 'Atualizacao iniciada (online). O sistema vai reiniciar em instantes.', backup: bk.arquivo || null };
    }

    // BLINDAGEM: só atualiza se houver MESMO versão nova no GitHub. Sem isso, o atualizador
    // faria `git reset --hard origin/BR` à toa — o que, numa máquina à frente do repositório,
    // reverteria o código e apagaria trabalho local não enviado. Nunca fazemos isso sem novidade.
    const branch = lerConfig().branch || 'main';
    const fetch = await gitP(['fetch', 'origin', branch]);
    if (!fetch.ok) return { erro: 'Não consegui acessar o GitHub. Confira a internet e o login.', detalhe: fetch.errout };
    const atras = parseInt((await gitP(['rev-list', '--count', `HEAD..origin/${branch}`])).out, 10) || 0;
    if (atras === 0) return { ok: true, semNovidade: true, mensagem: 'Você já está na versão mais recente — nada para atualizar.' };

    const bk = manut.criarBackup('antes da atualização');
    const de = (await gitP(['rev-parse', 'HEAD'])).out;
    db.prepare('INSERT INTO atualizacoes (quando,por,de_commit,para_commit,status,detalhe) VALUES (?,?,?,?,?,?)')
      .run(new Date().toISOString(), usuario || '', de, '', 'iniciada', bk.ok ? 'backup ' + bk.arquivo : 'sem backup');
    manut.logAcao('atualização iniciada', 'atualizacao', { por: usuario, de, backup: bk.arquivo || null }, 'admin');

    if (!fs.existsSync(batPath)) return { erro: 'atualizador.bat não encontrado na pasta do sistema.' };
    try {
      const child = spawn('cmd.exe', ['/c', batPath], { cwd: rootDir, detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } catch (e) { return { erro: 'Falha ao iniciar o atualizador: ' + e.message }; }
    return { ok: true, mensagem: 'Atualização iniciada. O sistema vai reiniciar em instantes.', backup: bk.arquivo || null };
  }

  const historico = () => { try { return db.prepare('SELECT * FROM atualizacoes ORDER BY id DESC LIMIT 20').all(); } catch { return []; } };

  // Liga a máquina ao repositório automaticamente (usa a URL do update.config.json).
  // Na 1ª vez, o Git abre uma janela pedindo login do GitHub (Credential Manager).
  // NÃO apaga dados: git init/reset só mexe em arquivos versionados (acai.db/.env
  // são gitignored e ficam intactos).
  async function conectar() {
    if (!await gitDisponivel()) return { erro: 'O Git não está instalado nesta máquina.' };
    const cfg = lerConfig();
    const url = (cfg.repo || '').trim();
    const branch = cfg.branch || 'main';
    if (!url) return { erro: 'A URL do repositório não está configurada (update.config.json).' };
    if (!await ehRepo()) { const ini = await gitP(['init']); if (!ini.ok) return { erro: 'Falha ao preparar o repositório: ' + ini.errout }; }
    await gitP(['remote', 'remove', 'origin']); // ignora se não existir
    const add = await gitP(['remote', 'add', 'origin', url]);
    if (!add.ok) return { erro: 'Falha ao configurar o repositório: ' + add.errout };
    const fetch = await gitLongo(['fetch', 'origin', branch]); // aqui abre o login do GitHub
    if (!fetch.ok) return { erro: 'Não consegui acessar o GitHub. Faça o login na janela que abriu e confira a internet.', detalhe: fetch.errout };
    await gitP(['checkout', '-B', branch]);
    await gitP(['branch', `--set-upstream-to=origin/${branch}`, branch]);
    const reset = await gitP(['reset', '--hard', `origin/${branch}`]);
    if (!reset.ok) return { erro: 'Falha ao alinhar o código: ' + reset.errout };
    try { manut.logAcao('máquina ligada ao GitHub', 'atualizacao', { url }, 'admin'); } catch {}
    return { ok: true };
  }

  return { status, verificar, aplicar, historico, podeAtualizar, versaoInstalada, conectar };
};
