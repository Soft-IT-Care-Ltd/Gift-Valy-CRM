// Gift Valy service worker (SPEC §16 Phase 4 — mobile PWA).
//
// Deliberately conservative for an authenticated ERP:
//   - /api/* and every non-GET request are never touched — money, orders and
//     auth always hit the network with no cached staleness.
//   - Navigations are network-first; only when the device is offline does the
//     precached /offline.html appear.
//   - Immutable static assets (/_next/static hashed bundles, fonts, icons)
//     are cache-first, which is what makes the installed app feel instant.
//
// Bump VERSION whenever this file's caching logic changes — activate() drops
// every older cache.

const VERSION = "gift-valy-sw-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/gift-valy-logo.png"];

const STATIC_PREFIXES = ["/_next/static/", "/fonts/", "/icons/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Live data + auth: never intercepted, never cached.
  if (url.pathname.startsWith("/api/")) return;

  // App pages: network-first, offline fallback page when the network is gone.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(OFFLINE_URL).then((res) => res ?? Response.error())
      )
    );
    return;
  }

  // Hashed/immutable static assets: cache-first.
  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((cache) => cache.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});
