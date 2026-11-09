const APP_CACHE = "estuda-plus-app-v3";
const PDF_CACHE = "estuda-plus-pdfjs-v3";
const APP_FILES = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icon.svg"];
const PDF_FILES = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const appCache = await caches.open(APP_CACHE);
    await appCache.addAll(APP_FILES);
    const pdfCache = await caches.open(PDF_CACHE);
    await Promise.allSettled(PDF_FILES.map(async url => {
      const response = await fetch(url, { mode:"cors", cache:"reload" });
      if (response.ok) await pdfCache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("estuda-plus-") && ![APP_CACHE, PDF_CACHE].includes(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (PDF_FILES.includes(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(PDF_CACHE);
      const cached = await cache.match(request, { ignoreVary:true });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        return new Response("O leitor PDF ainda não foi baixado neste aparelho. Conecte-se à internet uma vez e reabra o Estuda+.", { status:503, headers:{"Content-Type":"text/plain; charset=utf-8"} });
      }
    })());
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        if (request.mode === "navigate") return cache.match("./index.html");
        return new Response("Recurso indisponível offline.", { status:503 });
      }
    })());
  }
});