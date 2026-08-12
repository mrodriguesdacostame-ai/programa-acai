// Reseta a senha de um usuário do Açaí do Centro (scrypt+salt, igual ao sistema).
// Uso:  node resetar_senha.js [usuario] [novaSenha]   (padrão: admin / 1234)
// Roda pelo RESETAR_SENHA.bat. Não mexe em mais nada do banco.
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

const usuario = (process.argv[2] || 'admin').toLowerCase().trim();
const novaSenha = process.argv[3] || '1234';
const db = new DatabaseSync('acai.db');
const u = db.prepare('SELECT id, usuario, nome FROM usuarios WHERE lower(trim(usuario)) = ?').get(usuario);
if (!u) {
  console.log('Usuario NAO encontrado: ' + usuario);
  console.log('Usuarios cadastrados:');
  for (const x of db.prepare('SELECT usuario, nome FROM usuarios ORDER BY nome').all()) console.log('   - ' + x.usuario + '  (' + x.nome + ')');
  process.exit(1);
}
db.prepare('UPDATE usuarios SET senha_hash = ?, ativo = 1 WHERE id = ?').run(hashSenha(novaSenha), u.id);
console.log('OK! Senha redefinida com sucesso.');
console.log('   Usuario: ' + u.usuario + '   (' + u.nome + ')');
console.log('   Nova senha: ' + novaSenha);
