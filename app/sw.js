// Minimal service worker — makes the app installable and gives an offline shell.
const CACHE = "pr-copilot-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache API calls — always go to network.
  if (url.pathname.startsWith("/api/")) return;

  // Network-first for the app shell (HTML/JS/CSS) so updates appear immediately;
  // fall back to cache when offline.
  if (/\.(html|js|css)$/.test(url.pathname) || url.pathname === "/") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for other assets (icons, manifest).
  e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
});
