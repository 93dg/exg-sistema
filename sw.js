// Service worker EXG — network first, auto-actualización sin intervención del usuario.
// Cambia CACHE_NAME al hacer deploy para forzar reinstalación.
const CACHE_NAME = 'exg-shell-v4';
const SHELL_FILES = ['/exg-sistema/', '/exg-sistema/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  // NO llamar skipWaiting aquí — lo hacemos cuando la página nos lo pide
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// La página nos pide que tomemos control ya (cuando detecta nueva versión)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).then((networkResp) => {
      if (networkResp && networkResp.ok) {
        const clone = networkResp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return networkResp;
    }).catch(() => caches.match(event.request))
  );
});
