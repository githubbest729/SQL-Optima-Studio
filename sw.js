/* SQL-Optima Studio — service worker
 * Strategies
 *   • App shell / static same-origin assets → cache-first (versioned cache, precached on install)
 *   • Navigations (HTML)                    → network-first, falling back to cache, then offline.html
 *   • Cross-origin (Tailwind CDN, fonts)    → stale-while-revalidate in a runtime cache
 * Bump VERSION whenever any precached file changes so clients pick up the update.
 */
const VERSION = 'v1.0.0';
const STATIC_CACHE = `sqlopt-static-${VERSION}`;
const RUNTIME_CACHE = `sqlopt-runtime-${VERSION}`;

const PRECACHE = [
  './',
  'index.html',
  'offline.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/components.js',
  'js/icons.js',
  'js/profiler.worker.js',
  'assets/icons/icon.svg',
  'assets/icons/favicon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      // addAll is atomic; use individual adds so one missing optional file cannot block install
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => null))))
  );
  // Do not skipWaiting automatically: the app shows an "update available" prompt instead.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, RUNTIME_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('sqlopt-') && !keep.has(k)).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) { /* ignore */ } }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) Page navigations: network-first → cache → offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          const fresh = preload || (await fetch(req));
          const cache = await caches.open(STATIC_CACHE);
          cache.put('index.html', fresh.clone()).catch(() => { });
          return fresh;
        } catch (err) {
          const cache = await caches.open(STATIC_CACHE);
          return (await cache.match(req, { ignoreSearch: true })) ||
                 (await cache.match('index.html')) ||
                 (await cache.match('./')) ||
                 (await cache.match('offline.html')) ||
                 new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // 2) Same-origin static assets: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone()).catch(() => { });
          return res;
        } catch (err) {
          if (req.destination === 'document') return (await cache.match('offline.html')) || Response.error();
          return Response.error();
        }
      })()
    );
    return;
  }

  // 3) Cross-origin (CDN scripts, fonts): stale-while-revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => { }); return res; })
        .catch(() => null);
      return hit || (await network) || Response.error();
    })()
  );
});
