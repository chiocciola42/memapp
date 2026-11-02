/* MemAPP service worker — generato da build.js (sw.template.js -> sw.js).
 * Non modificare sw.js a mano: la versione viene stampata a ogni build. */
const VERSION      = 'e306a109448d';
const SHELL_CACHE  = 'memapp-shell-' + VERSION;
const AUDIO_CACHE  = 'memapp-audio-v1';
const FONT_CACHE   = 'memapp-fonts-v1';
const KEEP_CACHES  = [SHELL_CACHE, AUDIO_CACHE, FONT_CACHE];

const SHELL_URLS = [
  "/",
  "/pwa.js",
  "/manifest.webmanifest",
  "/tracks.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  "/icons/favicon.svg"
];

const AUDIO_RE          = /\.(wav|mp3|ogg|flac|aac|m4a)$/i;
const AUDIO_MAX_ENTRIES = 200;
const AUDIO_MAX_BYTES   = 25 * 1024 * 1024; // un singolo file più grande non viene messo in cache
const NAV_TIMEOUT_MS    = 4000;

self.addEventListener('install', event => {
  // Niente skipWaiting automatico: il nuovo SW resta in attesa finché l'utente non accetta l'aggiornamento.
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      Promise.all(SHELL_URLS.map(url =>
        fetch(url, { cache: 'reload' }).then(res => {
          if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
          return cache.put(url, res);
        })
      ))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('memapp-') && !KEEP_CACHES.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate')                 return event.respondWith(handleNavigation(req));
    if (AUDIO_RE.test(url.pathname))             return event.respondWith(handleAudio(req));
    if (url.pathname === '/tracks.json')         return event.respondWith(networkFirst(req));
    if (url.pathname === '/sw.js')               return; // sempre dalla rete
    return event.respondWith(shellFirst(req));
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
  }
});

/* ── Navigazione: rete con timeout, fallback all'app shell in cache ── */
async function handleNavigation(req) {
  const shell = () => caches.match('/', { ignoreSearch: true });
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NAV_TIMEOUT_MS);
  try {
    return await fetch(req, { signal: ctrl.signal });
  } catch (e) {
    return (await shell()) || fetch(req);
  } finally {
    clearTimeout(timer);
  }
}

/* ── Asset della shell (manifest, icone, pwa.js): cache, poi rete ── */
async function shellFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  return hit || fetch(req);
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit   = await cache.match(req);
  const net   = fetch(req).then(async res => {
    if (res.ok || res.type === 'opaque') await cache.put(req, res.clone());
    return res;
  }).catch(() => null); // rete assente: si usa la copia in cache, se c'è
  return hit || (await net) || Response.error();
}

/* ── Audio: cache-first con supporto alle Range request (necessario a iOS Safari) ── */
async function handleAudio(req) {
  const cache = await caches.open(AUDIO_CACHE);
  let res = await cache.match(req.url);

  if (!res) {
    // Si scarica sempre il file intero (senza header Range) così la cache contiene una risposta 200 completa.
    let net;
    try { net = await fetch(req.url, { credentials: 'same-origin' }); }
    catch (e) { return Response.error(); }

    const len = Number(net.headers.get('content-length')) || 0;
    if (net.status !== 200 || len > AUDIO_MAX_BYTES) {
      return net.status === 200 && req.headers.has('range') ? rangeResponse(net, req.headers.get('range')) : net;
    }
    await cache.put(req.url, net);
    await trimCache(cache);
    res = await cache.match(req.url);
  }

  const range = req.headers.get('range');
  return range ? rangeResponse(res, range) : res;
}

async function rangeResponse(res, rangeHeader) {
  const blob  = await res.blob();
  const size  = blob.size;
  const m     = /^bytes=(\d*)-(\d*)$/.exec((rangeHeader || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    return new Response(blob, { status: 200, headers: baseHeaders(res, size) });
  }
  let start, end;
  if (m[1] === '') {                      // suffisso: ultimi N byte
    start = Math.max(0, size - Number(m[2]));
    end   = size - 1;
  } else {
    start = Number(m[1]);
    end   = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  const headers = baseHeaders(res, end - start + 1);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  return new Response(blob.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
}

function baseHeaders(res, length) {
  const h = new Headers();
  h.set('Content-Type', res.headers.get('content-type') || 'audio/mpeg');
  h.set('Content-Length', String(length));
  h.set('Accept-Ranges', 'bytes');
  const cc = res.headers.get('cache-control');
  if (cc) h.set('Cache-Control', cc);
  return h;
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - AUDIO_MAX_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]); // le più vecchie per prime
}
