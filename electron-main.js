/* ── APP NATIVO (Electron) — Açaí do Centro ──────────────────────────────────
   Empacota o ERP num aplicativo de verdade pro Windows: janela propria, icone
   proprio, sem barra de navegador. Ele SOBE o servidor (server.js, no Node do
   sistema — precisa do node:sqlite = Node 22+) e mostra a tela em localhost:3001.
   Ao fechar a janela, encerra o servidor junto. Nada muda no ERP em si. ─────── */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const fs = require('fs');
const PORT = process.env.PORT ? +process.env.PORT : 3001;
const APP_DIR = __dirname;
let serverProc = null;
let win = null;

// PASTA DE DADOS PERMANENTE: fica em %APPDATA%\<app> — o instalador/atualizacao NUNCA apaga.
// Assim, reinstalar ou trocar de maquina NAO perde o banco. Na 1a vez, MIGRA o acai.db da
// pasta do programa pra ca (inclui o -wal/-shm pra nao perder as ultimas vendas).
function prepararDadosPersistentes() {
  try {
    const DADOS = path.join(app.getPath('userData'), 'dados');
    fs.mkdirSync(DADOS, { recursive: true });
    const destDb = path.join(DADOS, 'acai.db');
    if (!fs.existsSync(destDb)) {
      const origDb = path.join(APP_DIR, 'acai.db');
      if (fs.existsSync(origDb)) {
        for (const suf of ['', '-wal', '-shm']) { try { if (fs.existsSync(origDb + suf)) fs.copyFileSync(origDb + suf, destDb + suf); } catch {} }
        console.log('Banco migrado para a pasta permanente:', destDb);
      }
    }
    process.env.ACAI_DB = destDb;                          // o server.js respeita ACAI_DB
    process.env.DADOS_DIR = DADOS;                         // backups/sessao WhatsApp tambem vao pra ca (se o server suportar)
    return DADOS;
  } catch (e) { console.error('prepararDados:', e.message); return APP_DIR; }
}

// sobe o server.js num processo Node separado (usa o Node do sistema por causa do node:sqlite)
function iniciarServidor() {
  const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';
  serverProc = spawn(nodeCmd, ['server.js'], { cwd: APP_DIR, windowsHide: true, env: process.env });
  serverProc.on('error', (e) => console.error('Falha ao iniciar o servidor:', e.message));
  serverProc.stdout && serverProc.stdout.on('data', d => process.stdout.write(d));
  serverProc.stderr && serverProc.stderr.on('data', d => process.stderr.write(d));
}

// espera a porta responder (o server demora alguns segundos pra subir)
function esperarServidor(cb, tentativas = 0) {
  const req = http.get({ host: 'localhost', port: PORT, path: '/', timeout: 1500 }, () => { req.destroy(); cb(true); });
  req.on('error', () => { if (tentativas >= 200) return cb(false); setTimeout(() => esperarServidor(cb, tentativas + 1), 300); });
  req.on('timeout', () => { req.destroy(); if (tentativas >= 200) return cb(false); setTimeout(() => esperarServidor(cb, tentativas + 1), 300); });
}

function criarJanela() {
  Menu.setApplicationMenu(null); // sem menu do Electron (fica um app limpo)
  win = new BrowserWindow({
    show: false,
    icon: path.join(APP_DIR, 'assets', 'icone-acai.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#1e88c8',
    title: 'Açaí do Centro',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.maximize();
  win.loadURL(`http://localhost:${PORT}/`);
  win.once('ready-to-show', () => win.show());
  // links externos (ex.: algo que tente abrir fora) vao pro navegador padrao, nao dentro do app
  win.webContents.setWindowOpenHandler(({ url }) => { try { shell.openExternal(url); } catch {} return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  prepararDadosPersistentes();   // migra/aponta o banco pra pasta permanente ANTES de subir o servidor
  iniciarServidor();
  esperarServidor((ok) => {
    if (!ok) { dialog.showErrorBox('Açaí do Centro', 'Não consegui iniciar o servidor do sistema. Verifique se o Node.js 22+ está instalado.'); }
    criarJanela();
  });
});

// fechar a janela = encerrar o app + o servidor
app.on('window-all-closed', () => { pararServidor(); app.quit(); });
app.on('before-quit', pararServidor);
function pararServidor() { try { if (serverProc) { serverProc.kill(); serverProc = null; } } catch {} }

// segunda instancia: foca a janela existente em vez de abrir outra
const soUma = app.requestSingleInstanceLock();
if (!soUma) { app.quit(); } else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}
