// Offline support: precache the built app; pages come from the network when possible.
// The build fills in VERSION and ASSETS (see vite.config.js).
const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const CACHE = `woodshed-${VERSION}`;
// Playback samples: fetched the first time an instrument is used, kept across releases.
const SAMPLES = 'woodshed-samples-1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SAMPLES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Pages: network first, so a new release shows up right away; the cached copy when offline
  // (or after 3 seconds on a bad connection).
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const network = fetch(req).then((res) => {
          if (res.ok) cache.put('./', res.clone());
          return res;
        });
        const fallback = new Promise((resolve) => setTimeout(resolve, 3000)).then(() => cache.match('./'));
        try {
          return await Promise.race([network, fallback.then((r) => r || network)]);
        } catch {
          return (await cache.match('./')) || Response.error();
        }
      }),
    );
    return;
  }
  if (new URL(req.url).pathname.includes('/samples/')) {
    e.respondWith(
      caches.open(SAMPLES).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  // Everything else has a content hash in its name (or rarely changes): cache first.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req)),
  );
});
