// Promove o usuario "admin" (Administrador) para o perfil ADMIN, pra ele enxergar
// o botao "Configuracao do Programa" e todas as telas de administracao.
// Nao mexe em mais nada. Rode pelo VIRAR_ADMIN.bat.
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('acai.db');
const r = db.prepare("UPDATE usuarios SET perfil='admin' WHERE usuario='admin'").run();
console.log('Usuarios atualizados:', r.changes);
const u = db.prepare("SELECT usuario,nome,perfil FROM usuarios WHERE usuario='admin'").get();
if (u) console.log('Agora: ' + u.usuario + ' -> perfil: ' + u.perfil + ' (nome: ' + u.nome + ')');
console.log('');
console.log('PRONTO. Feche o programa, abra de novo e faca login como admin.');
console.log('O botao "Configuracao do Programa" vai estar no canto superior direito.');
