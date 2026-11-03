/* KisanSetu service worker: lets the app open with no network.
 *  - Built files (/_next/static): cache first, they never change under the same name.
 *  - Pages: network first, falling back to the last copy this phone saw.
 *  - /api and Next's data requests are never cached here; the app keeps its own
 *    offline data in IndexedDB.
 * Cached pages are removed on sign-out by the app. */
const VERSION = "v1";
const STATIC = "ks-static-" + VERSION;
const PAGES = "ks-pages-" + VERSION;
const NAV_TIMEOUT_MS = 4000;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, PAGES]);
      for (const name of await caches.keys()) {
        if (name.startsWith("ks-") && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

function isDataRequest(request, url) {
  return (
    url.pathname.startsWith("/api/") ||
    request.headers.has("RSC") ||
    request.headers.has("Next-Router-Prefetch") ||
    url.searchParams.has("_rsc")
  );
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>KisanSetu</title><body style=\"font:18px system-ui;padding:24px\">" +
  "<h1>You are offline</h1><p>This page was not saved on this phone yet. " +
  "Open KisanSetu once while online, then it will work without a network.</p>";

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js" || isDataRequest(request, url)) return;

  if (url.pathname.startsWith("/_next/static/") || /\.(?:png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        try {
          const response = await withTimeout(fetch(request), NAV_TIMEOUT_MS);
          // Only a normal page is worth keeping, never a redirect to sign in or an error.
          if (response.ok && !response.redirected && response.type === "basic") {
            cache.put(url.pathname, response.clone());
          }
          return response;
        } catch {
          const saved = await cache.match(url.pathname);
          return saved || new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
      })(),
    );
  }
});
