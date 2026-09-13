/* Service worker: the app shell, cached on first visit so the workbench opens
   from cache with no network - which is also the third answer to mixed
   content: an installed app served from its own cache can be opened from a
   plain http LAN address once it has been loaded once.

   Same-origin files are cache-first with a background refresh (Vite hashes
   its assets, so a new build never collides with an old one). Model files
   are cached by Transformers.js itself; the Hugging Face and jsDelivr
   responses that are worth keeping are kept here as they pass. */

const VERSION = "v1";
const SHELL = `workbench-shell-${VERSION}`;
const RUNTIME = "workbench-runtime";
const CACHEABLE_HOSTS = new Set(["huggingface.co", "cdn-lfs.huggingface.co", "cdn-lfs-us-1.hf.co", "cdn.jsdelivr.net"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      for (const url of ["./", "./index.html", "./manifest.webmanifest"]) {
        try {
          await cache.add(new Request(url, { cache: "reload" }));
        } catch {
          /* one missing entry must not break the install */
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("workbench-shell-") && key !== SHELL) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          const cache = await caches.open(SHELL);
          cache.put("./index.html", res.clone()).catch(() => {});
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error();
        }
      })(),
    );
    return;
  }
  if (url.origin === self.location.origin) {
    // never cache the lab endpoint, which is never same-origin anyway
    event.respondWith(staleWhileRevalidate(request, SHELL));
    return;
  }
  if (CACHEABLE_HOSTS.has(url.hostname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME);
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const res = await fetch(request);
          if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone()).catch(() => {});
          return res;
        } catch {
          return Response.error();
        }
      })(),
    );
  }
});
