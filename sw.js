/* =====================================================================
   SQL-Optima Studio — Progressive Web App Service Worker
   Cache-First Engine with Dynamic Invalidation
   ===================================================================== */
const CACHE_NAME = 'sql-optima-v2.4.0';
const STATIC_ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'components.js',
  'icons.js',
  'profiler.worker.js',
  'manifest.webmanifest',
  'favicon.svg',
  'icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('index.html');
        }
      });
    })
  );
});