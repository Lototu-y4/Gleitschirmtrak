/* Service Worker der Flug-Anzeige.
   Strategie „Netz zuerst, Cache als Rückfall“: Mit Netz kommt immer die neueste Version,
   ohne Netz (oder nach 4 s ohne Antwort) die zuletzt gespeicherte. Lädt die Seite nie selbst neu. */
const CACHE = "flugapp-v4";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./kreisen.js", "./wind.js", "./startlandung.js"];
const TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Geländekacheln verwaltet die Seite selbst (IndexedDB), nicht hier zwischenspeichern
  if (url.pathname.includes("/terrain/")) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const fromCache = async () =>
    (await cache.match(req, { ignoreSearch: true })) ||
    (req.mode === "navigate" ? await cache.match("./index.html") : undefined);

  const net = fetch(req, { cache: "no-store" }).then(async (res) => {
    if (res && res.ok) {
      await cache.put(req, res.clone());
      if (req.mode === "navigate") await cache.put("./index.html", res.clone());
    }
    return res;
  });
  net.catch(() => {});   // spätere Netzfehler nach Rückfall auf den Cache nicht als unbehandelt melden

  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), TIMEOUT_MS); });
  try {
    const first = await Promise.race([net, timeout]);
    if (first !== "timeout") return first;
    const cached = await fromCache();
    return cached || await net;
  } catch (err) {
    const cached = await fromCache();
    if (cached) return cached;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
