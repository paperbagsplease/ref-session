// Ref Session service worker: network-first with a short timeout, cached fallback for offline.
const CACHE = 'ref-session-v3';
const SHELL = ['./', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

// Safari refuses to serve a redirected response to a page navigation, so never store/serve one as-is.
async function clean(r) {
  if (!r.redirected) return r;
  return new Response(await r.blob(), { status: 200, statusText: 'OK', headers: r.headers });
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (u) => { try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await c.put(u, await clean(r)); } catch (err) { /* offline install: skip */ } }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const r = await withTimeout(fetch(req), req.mode === 'navigate' ? 4000 : 8000);
      if (r.type === 'opaqueredirect') return r;
      if (r.ok) { const copy = await clean(r.clone()); c.put(req.mode === 'navigate' ? './' : req, copy).catch(() => {}); }
      return await clean(r);
    } catch (err) {
      const hit = await c.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: true });
      return hit || Response.error();
    }
  })());
});
