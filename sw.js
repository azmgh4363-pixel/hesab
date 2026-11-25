// همه‌ی فایل‌های برنامه روی گوشی نگه داشته می‌شوند تا بدون اینترنت باز شود.
// هر نسخه یک‌جا و مستقیم از سایت گرفته می‌شود (نه از حافظه‌ی میانی)؛ با هر تغییر فایل‌ها این شماره و VERSION در app.js با هم عوض شوند.
const CACHE = 'hesab-v21';
const SHELL = ['./', 'core.js', 'app.js', 'inbox.js', 'license.js', 'licenseui.js', 'weblicense.js', 'app.css', 'manifest.webmanifest', 'icon-180.png'];
self.addEventListener('install', e => e.waitUntil((async () => {
  const files = await Promise.all(SHELL.map(async u => {
    const r = await fetch(u + '?v=' + CACHE, { cache: 'reload' });
    if (!r.ok || r.redirected) throw new Error(u);
    return [u, r];
  }));
  const c = await caches.open(CACHE);
  await Promise.all(files.map(([u, r]) => c.put(u, r)));
})()));
self.addEventListener('message', e => { if (e.data === 'update') self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true })).then(hit => hit
    || fetch(e.request).catch(() => e.request.mode === 'navigate' ? caches.open(CACHE).then(c => c.match('./')) : Response.error())));
});
