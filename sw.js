// همه‌ی فایل‌های برنامه روی گوشی نگه داشته می‌شوند تا بدون اینترنت باز شود.
const CACHE = 'hesab-v2';
const SHELL = ['./', 'core.js', 'app.js', 'inbox.js', 'app.css', 'manifest.webmanifest', 'icon-180.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; });
    return hit ? (net.catch(() => { }), hit) : net.catch(() => caches.match('./'));
  }));
});
