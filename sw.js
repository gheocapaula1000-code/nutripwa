/* NutriPWA service worker – percorsi relativi, cache versionata.
 * - HTML: network-first (con ripiego sulla cache se offline)
 * - file statici dello stesso sito: stale-while-revalidate
 * - MAI in cache: chiamate API/AI/proxy (tutto ciò che non è GET dello stesso sito) */
const VERSION = 'nutripwa-v1.0.0';
const ASSETS = [
  './', 'index.html', 'privacy.html', 'termini.html', 'cookie.html',
  'styles.css', 'theme.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS.map((a) => new URL(a, self.registration.scope).href)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('nutripwa-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isHTML(req) {
  return req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // niente POST (API AI)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // niente richieste esterne (Gemini, OFF, CDN, proxy)
  if (/\/(functions|api|\.netlify|\.supabase)\//.test(url.pathname)) return;

  if (isHTML(req)) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match(new URL('index.html', self.registration.scope).href)))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
