// AgentiCMS admin service worker. Makes the admin installable and shows an
// offline notice instead of the browser error page. It deliberately caches
// nothing: admin data must always be live, and /assets/* mixes build output
// with CMS uploads, so a cache would serve stale content.
const OFFLINE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentiCMS — offline</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#e4e4e7;font:15px/1.5 system-ui,sans-serif;text-align:center"><div><p style="font-weight:600;font-size:17px">You are offline</p><p style="color:#a1a1aa">AgentiCMS needs a connection. It will load again once you are back online.</p><button onclick="location.reload()" style="margin-top:8px;padding:8px 16px;border-radius:6px;border:1px solid #155e75;background:#083344;color:#cffafe;font:inherit">Try again</button></div>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })),
  );
});
