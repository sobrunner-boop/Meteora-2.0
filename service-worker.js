const CACHE = 'meteora-order-v1-4-0-final';
const ASSETS = ['./','./index.html','./css/style.css','./js/app.js','./js/menu.js','./js/storage.js','./js/tables.js','./js/ui.js','./js/diagnostics.js','./manifest.json','./CHANGELOG.md','./README.md','./TESTPROTOKOLL.md'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => {
    const network = fetch(event.request).then(response => {
      if (!response || response.status !== 200) return response;
      const clone = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match('./index.html'));
    return cached || network;
  }));
});
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
