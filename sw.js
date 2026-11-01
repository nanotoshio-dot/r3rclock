const CACHE_NAME = 'r3rclock-v6-broker-status';
const APP_SHELL = [
  './',
  './index.html',
  './legacy.html',
  './market-timezones.js',
  './broker-market-status.js',
  './icon.svg',
  './manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(cacheNames => Promise.all(
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      )),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isNavigation = request.mode === 'navigate';
  const isAppCode = sameOrigin && (
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/legacy.html') ||
    url.pathname.endsWith('/market-timezones.js') ||
    url.pathname.endsWith('/broker-market-status.js')
  );

  // Network-first for application code so GitHub/Vercel updates appear immediately.
  if (isNavigation || isAppCode) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok && sameOrigin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});
