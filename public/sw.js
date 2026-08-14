// Service worker del panel — fuerza contenido fresco en la navegación.
// GitHub Pages sirve el HTML con Cache-Control: max-age=600; esto lo elude.

const CACHE_NAME = 'tds-panel-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Navegación (HTML): network-first con no-store → siempre fresco.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() => caches.match(req)),
    );
    return;
  }

  // Assets con hash (/_astro/): cache-first (son inmutables).
  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
