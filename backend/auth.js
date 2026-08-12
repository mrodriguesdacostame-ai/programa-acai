/* ── AUTENTICAÇÃO REAL (Fase 12) ─────────────────────────────────────────────
   Usuários no SQLite (senha com scrypt+salt), sessão por cookie HttpOnly
   (token aleatório; no banco só o SHA-256 dele), perfis admin/supervisor/
   operador e proteção de TODAS as rotas /api/* (exceto login e o webhook da
   IA, que tem o próprio segredo). A "autorização do supervisor" vira real:
   valida a senha no servidor e abre uma janela de 5 min NA SESSÃO do operador.
   O server.js injeta { db, logAcao } e registra middleware + rotas. */
const crypto = require('crypto');

module.exports = function createAuth({ db, logAcao }) {
  db.exec(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    usuario TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    perfil TEXT NOT NULL,             -- 'admin' | 'supervisor' | 'operador'
    ativo INTEGER DEFAULT 1,
    criado_em TEXT, atualizado_em TEXT, ultimo_login TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS sessoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    criado_em TEXT, expira_em TEXT, ultimo_uso TEXT,
    ip TEXT, user_agent TEXT,
    ativa INTEGER DEFAULT 1,
    supervisor_ate TEXT               -- janela de autorização de supervisor (5 min)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessoes_token ON sessoes(token_hash)');

  // ── Hash de senha: scrypt (nativo do Node) + salt. NUNCA texto puro. ──
  function hashSenha(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
    return `scrypt:${salt}:${hash}`;
  }
  function verificarSenha(senha, senhaHash) {
    try {
      const [algo, salt, hash] = String(senhaHash || '').split(':');
      if (algo !== 'scrypt' || !salt || !hash) return false;
      const calc = crypto.scryptSync(String(senha || ''), salt, 64).toString('hex');
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'));
    } catch { return false; }
  }

  // ── Usuário inicial (só se a tabela estiver vazia) ──
  if (db.prepare('SELECT COUNT(*) n FROM usuarios').get().n === 0) {
    const user = (process.env.ADMIN_USER || 'admin').toLowerCase();
    const senha = process.env.ADMIN_SENHA || 'admin';
    db.prepare('INSERT INTO usuarios (nome, usuario, senha_hash, perfil, ativo, criado_em) VALUES (?,?,?,?,1,?)')
      .run('Administrador', user, hashSenha(senha), 'admin', new Date().toISOString());
    console.log(`⚠️ ATENÇÃO: usuário inicial "${user}"${process.env.ADMIN_SENHA ? ' (senha do .env)' : '/admin'} criado. ALTERE A SENHA em produção!`);
  }

  const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');
  const HORAS_SESSAO = 12;
  const agoraISO = () => new Date().toISOString();

  // limpeza no boot: derruba sessões vencidas
  db.prepare('UPDATE sessoes SET ativa = 0 WHERE ativa = 1 AND expira_em < ?').run(agoraISO());

  function lerCookieToken(req) {
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)acai_sessao=([^;]+)/);
    return m ? m[1] : null;
  }
  function sessaoDoRequest(req) {
    const token = lerCookieToken(req);
    if (!token) return null;
    const s = db.prepare(`SELECT s.id sessaoId, s.usuario_id, s.expira_em, s.ultimo_uso, s.supervisor_ate,
                                 u.nome, u.usuario, u.perfil, u.ativo
                          FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
                          WHERE s.token_hash = ? AND s.ativa = 1`).get(sha256(token));
    if (!s || !s.ativo) return null;
    if (s.expira_em && s.expira_em < agoraISO()) { db.prepare('UPDATE sessoes SET ativa = 0 WHERE id = ?').run(s.sessaoId); return null; }
    // renova o ultimo_uso (com folga de 60 s pra não gravar a cada poll)
    if (!s.ultimo_uso || (Date.now() - new Date(s.ultimo_uso).getTime()) > 60000) {
      db.prepare('UPDATE sessoes SET ultimo_uso = ? WHERE id = ?').run(agoraISO(), s.sessaoId);
    }
    return s;
  }

  /* Nível exigido por rota. 'operador' = qualquer logado; 'supervisor' = admin/supervisor
     (ou operador com janela de supervisor ativa); 'admin' = só admin. */
  function nivelExigido(req) {
    const p = req.path, m = req.method;
    if (p.startsWith('/api/backup') || p.startsWith('/api/manutencao') || p.startsWith('/api/usuarios') || p.startsWith('/api/logs-acoes')
        || p.startsWith('/api/exportar') || p.startsWith('/api/importar')) return 'admin';
    if (m === 'DELETE' && (
        p.startsWith('/api/pedidos/') || p.startsWith('/api/produtos/') ||
        /^\/api\/clientes\/\d+$/.test(p) || /\/lancamentos\//.test(p) ||
        p.startsWith('/api/atendimento/conversas/'))) return 'supervisor';
    if (m === 'POST' && /^\/api\/vendas\/\d+\/cancelar$/.test(p)) return 'supervisor';
    if (m === 'POST' && /^\/api\/produtos\/[^/]+\/ajuste$/.test(p)) return 'supervisor';
    if ((m === 'POST' || m === 'PUT') && p.startsWith('/api/entregadores')) return 'supervisor'; // Fase 22: cadastrar/editar entregador
    return 'operador';
  }

  function middleware(req, res, next) {
    if (!req.path.startsWith('/api/')) return next();                 // estáticos passam (a tela de login precisa carregar)
    if (req.path === '/api/auth/login') return next();                // login: público
    if (req.path === '/api/auth/usuarios') return next();             // lista de usuários pra tela de login (só nome/usuario)
    if (req.path === '/api/atendimento-ia/webhook') return next();    // protegida pelo WEBHOOK_SECRET próprio
    if (req.path.startsWith('/api/entregador/')) return next();       // Fase 23: painel do entregador tem sessão própria (PIN) — NÃO exime /api/entregadores (CRUD da equipe)
    const s = sessaoDoRequest(req);
    if (!s) return res.status(401).json({ erro: 'Não autenticado.' });
    req.usuario = s;
    const nivel = nivelExigido(req);
    if (nivel === 'operador' || s.perfil === 'admin') return next();
    if (nivel === 'supervisor') {
      if (s.perfil === 'supervisor') return next();
      if (s.supervisor_ate && s.supervisor_ate > agoraISO()) return next(); // operador com autorização recente
      logAcao('acesso negado', 'auth', { rota: `${req.method} ${req.path}`, usuario: s.usuario, exigia: 'supervisor' }, 'seguranca');
      return res.status(403).json({ erro: 'Esta ação exige autorização do supervisor.' });
    }
    logAcao('acesso negado', 'auth', { rota: `${req.method} ${req.path}`, usuario: s.usuario, exigia: 'admin' }, 'seguranca');
    return res.status(403).json({ erro: 'Esta ação exige perfil de administrador.' });
  }

  // ── Endpoints ──
  function login(req, res) {
    const { usuario, senha } = req.body || {};
    const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND ativo = 1').get(String(usuario || '').trim().toLowerCase());
    if (!u || !verificarSenha(senha, u.senha_hash)) {
      logAcao('login falho', 'auth', { usuario: String(usuario || '').slice(0, 40) }, 'seguranca');
      return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const agora = new Date();
    db.prepare('INSERT INTO sessoes (usuario_id, token_hash, criado_em, expira_em, ultimo_uso, ip, user_agent, ativa) VALUES (?,?,?,?,?,?,?,1)')
      .run(u.id, sha256(token), agora.toISOString(), new Date(agora.getTime() + HORAS_SESSAO * 3600e3).toISOString(),
           agora.toISOString(), req.ip || '', String(req.get('user-agent') || '').slice(0, 200));
    db.prepare('UPDATE usuarios SET ultimo_login = ? WHERE id = ?').run(agora.toISOString(), u.id);
    res.setHeader('Set-Cookie', `acai_sessao=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${HORAS_SESSAO * 3600}`);
    logAcao('login', 'auth', { usuario: u.usuario }, 'seguranca');
    res.json({ id: u.id, nome: u.nome, usuario: u.usuario, perfil: u.perfil });
  }
  function logout(req, res) {
    if (req.usuario) {
      db.prepare('UPDATE sessoes SET ativa = 0 WHERE id = ?').run(req.usuario.sessaoId);
      logAcao('logout', 'auth', { usuario: req.usuario.usuario }, 'seguranca');
    }
    res.setHeader('Set-Cookie', 'acai_sessao=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  }
  function me(req, res) {
    const s = req.usuario;
    res.json({ id: s.usuario_id, nome: s.nome, usuario: s.usuario, perfil: s.perfil,
               supervisorAte: s.supervisor_ate || null });
  }
  /* Autorização do supervisor: valida a senha de QUALQUER admin/supervisor ativo
     (o modal da tela só pede a senha, sem usuário — compatível com a UI atual;
     se "usuario" vier no corpo, valida só contra ele). Abre janela de 5 min na sessão. */
  function supervisor(req, res) {
    const { usuario, senha } = req.body || {};
    const candidatos = usuario
      ? db.prepare("SELECT * FROM usuarios WHERE usuario = ? AND ativo = 1 AND perfil IN ('admin','supervisor')").all(String(usuario).trim().toLowerCase())
      : db.prepare("SELECT * FROM usuarios WHERE ativo = 1 AND perfil IN ('admin','supervisor')").all();
    const autorizador = candidatos.find(u => verificarSenha(senha, u.senha_hash));
    if (!autorizador) {
      logAcao('supervisor negado', 'auth', { pedidoPor: req.usuario.usuario }, 'seguranca');
      return res.status(401).json({ ok: false, erro: 'Senha de supervisor incorreta.' });
    }
    const ate = new Date(Date.now() + 5 * 60e3).toISOString();
    db.prepare('UPDATE sessoes SET supervisor_ate = ? WHERE id = ?').run(ate, req.usuario.sessaoId);
    logAcao('supervisor aprovado', 'auth', { pedidoPor: req.usuario.usuario, autorizador: autorizador.usuario }, 'seguranca');
    res.json({ ok: true, ate, autorizador: autorizador.nome });
  }

  // ── Gerenciamento de usuários (todas já exigem admin pelo middleware: /api/usuarios) ──
  const semHash = u => ({ id: u.id, nome: u.nome, usuario: u.usuario, perfil: u.perfil, ativo: u.ativo, criado_em: u.criado_em, ultimo_login: u.ultimo_login });
  function rotasUsuarios(app) {
    app.get('/api/usuarios', (req, res) => res.json(db.prepare('SELECT * FROM usuarios ORDER BY id').all().map(semHash)));
    app.post('/api/usuarios', (req, res) => {
      const d = req.body || {};
      if (!d.nome || !d.usuario || !d.senha) return res.status(400).json({ erro: 'nome, usuario e senha são obrigatórios.' });
      if (!['admin', 'supervisor', 'operador'].includes(d.perfil)) return res.status(400).json({ erro: 'perfil inválido.' });
      try {
        const info = db.prepare('INSERT INTO usuarios (nome, usuario, senha_hash, perfil, ativo, criado_em) VALUES (?,?,?,?,1,?)')
          .run(d.nome, String(d.usuario).trim().toLowerCase(), hashSenha(d.senha), d.perfil, agoraISO());
        logAcao('usuário criado', 'auth', { usuario: d.usuario, perfil: d.perfil, por: req.usuario.usuario }, 'seguranca');
        res.json(semHash(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid)));
      } catch { res.status(400).json({ erro: 'Usuário já existe.' }); }
    });
    app.put('/api/usuarios/:id', (req, res) => {
      const d = req.body || {}, id = +req.params.id;
      if (d.perfil && !['admin', 'supervisor', 'operador'].includes(d.perfil)) return res.status(400).json({ erro: 'perfil inválido.' });
      db.prepare('UPDATE usuarios SET nome = COALESCE(?, nome), perfil = COALESCE(?, perfil), atualizado_em = ? WHERE id = ?')
        .run(d.nome || null, d.perfil || null, agoraISO(), id);
      logAcao('usuário alterado', 'auth', { id, por: req.usuario.usuario }, 'seguranca');
      res.json(semHash(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id)));
    });
    app.post('/api/usuarios/:id/senha', (req, res) => {
      const { senha } = req.body || {};
      if (!senha || String(senha).length < 4) return res.status(400).json({ erro: 'Senha muito curta (mínimo 4).' });
      db.prepare('UPDATE usuarios SET senha_hash = ?, atualizado_em = ? WHERE id = ?').run(hashSenha(senha), agoraISO(), +req.params.id);
      logAcao('senha alterada', 'auth', { id: +req.params.id, por: req.usuario.usuario }, 'seguranca');
      res.json({ ok: true });
    });
    app.put('/api/usuarios/:id/ativo', (req, res) => {
      const ativo = (req.body && (req.body.ativo === false || req.body.ativo === 0)) ? 0 : 1;
      const id = +req.params.id;
      db.prepare('UPDATE usuarios SET ativo = ?, atualizado_em = ? WHERE id = ?').run(ativo, agoraISO(), id);
      if (!ativo) db.prepare('UPDATE sessoes SET ativa = 0 WHERE usuario_id = ?').run(id); // derruba as sessões
      logAcao(ativo ? 'usuário reativado' : 'usuário desativado', 'auth', { id, por: req.usuario.usuario }, 'seguranca');
      res.json({ ok: true, ativo });
    });
  }

  return { middleware, login, logout, me, supervisor, rotasUsuarios, hashSenha, verificarSenha };
};
