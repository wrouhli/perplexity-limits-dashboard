/* Service worker: makes the page installable and lets it show the last
   published snapshot when offline. Deliberately conservative — every
   failure path falls back to the network so the page can never be
   broken by a stale cache.

   Bump CACHE_VERSION whenever the shell changes. */

const CACHE_VERSION = 'pld-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './lib.js',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isData = (pathname) => /\/data\/[^/]+\.(json|jsonl)$/.test(pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // CDN fonts / chart.js: untouched

  // Data: always try fresh, fall back to the last good copy offline.
  // Keyed by pathname so the ?t= cache-buster still hits the cache offline.
  if (isData(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(() => caches.match(url.pathname))
    );
    return;
  }

  // Shell: serve from cache, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
