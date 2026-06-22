const STATIC_CACHE = "fight-turn-static-v6";
const STATIC_PATHS = ["/assets/", "/game-assets/", "/prototype/"];
const STATIC_CONTENT_TYPES = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
};

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== STATIC_CACHE).map((name) => caches.delete(name))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !STATIC_PATHS.some((path) => url.pathname.startsWith(path))) {
    return;
  }

  if (url.pathname.endsWith(".json") || url.pathname.endsWith(".html") || url.pathname.endsWith("/") || url.searchParams.has("html-proxy")) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (shouldCacheResponse(request, response)) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (shouldCacheResponse(request, response)) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

function shouldCacheResponse(request, response) {
  if (!response.ok) {
    return false;
  }

  const expectedType = STATIC_CONTENT_TYPES[new URL(request.url).pathname.match(/\.[^.\/]+$/)?.[0] || ""];
  if (!expectedType) {
    return true;
  }

  return (response.headers.get("content-type") || "").toLowerCase().startsWith(expectedType);
}
