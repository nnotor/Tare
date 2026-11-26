const CACHE = "tare-v23";
const SCANNER = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
const SHELL = ["./index.html", "./features.js", "./theme.css", "./foods.json", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
const INDEX = new URL("./index.html", self.location.href).href;

// Save a fresh copy, leaving the existing one in place if the network fails.
async function refresh(key) {
  try {
    const response = await fetch(key, { cache: "no-cache" });
    if (response.ok && !response.redirected) {
      const cache = await caches.open(CACHE);
      await cache.put(key, response.clone());
    }
  } catch (error) {
    // Offline. The saved copy keeps working.
  }
}

async function savedOrNetwork(key, request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key, { ignoreSearch: true, ignoreVary: true });
  if (hit) {
    if (request.mode !== "navigate") return hit;
    // Safari is more reliable with a fresh page response than a stored one.
    return new Response(await hit.blob(), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  try {
    return await fetch(request);
  } catch (error) {
    if (request.mode !== "navigate") throw error;
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tare</title><body style="font:16px system-ui;padding:32px 20px"><h1>Tare is not saved offline yet</h1><p>Connect to the internet, open Tare, then go to Plan and tap Prepare for offline.</p></body>',
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async path => {
      const key = new URL(path, self.location.href).href;
      const response = await fetch(key, { cache: "reload" });
      if (!response.ok || response.redirected) throw new Error("Could not save " + path);
      await cache.put(key, response);
    }));
    // Scanner code is useful offline, but the app can still install without it.
    try {
      const response = await fetch(SCANNER, { mode: "cors", credentials: "omit" });
      if (response.ok) await cache.put(SCANNER, response);
    } catch (error) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.href === SCANNER) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(SCANNER, { ignoreVary: true });
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) await cache.put(SCANNER, response.clone());
      return response;
    })());
    return;
  }

  // Product lookups and every other outside request go straight to the network.
  if (url.origin !== self.location.origin) return;

  // Open instantly from the saved app, then fetch any update for the next launch.
  if (request.mode === "navigate") {
    event.respondWith(savedOrNetwork(INDEX, request));
    event.waitUntil(refresh(INDEX));
    return;
  }

  const key = url.origin + url.pathname;
  if (SHELL.some(path => new URL(path, self.location.href).href === key)) {
    event.respondWith(savedOrNetwork(key, request));
    event.waitUntil(refresh(key));
  }
});
