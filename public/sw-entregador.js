/* Service worker MÍNIMO e SEGURO do Painel do Entregador (Fase 23).
   Só cacheia o "shell" (a página, o ícone e o manifest) com estratégia network-first,
   pra permitir instalar como PWA e abrir offline. NUNCA cacheia /api/ (dados dinâmicos
   e autenticados) e IGNORA qualquer outra URL — então não afeta o sistema principal,
   mesmo tendo escopo de raiz. */
const CACHE = 'entregador-shell-v1';
const SHELL = ['/entregador', '/icone-entregador.svg', '/manifest.webmanifest'];
const ehShell = (p) => p === '/entregador' || p === '/icone-entregador.svg' || p === '/manifest.webmanifest';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // deixa passar
  if (url.pathname.startsWith('/api/')) return;                                   // API nunca é cacheada
  if (!ehShell(url.pathname)) return;                                             // qualquer outra coisa: navegador cuida
  // shell: pega da rede (versão nova) e guarda; offline cai no cache
  e.respondWith(
    fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request))
  );
});
