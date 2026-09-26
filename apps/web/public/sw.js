/*
 * The app itself, kept on the phone.
 *
 * Without this, a phone that loses the connection and then reloads the page - or is locked long
 * enough for the browser to throw the tab away - gets nothing back, because the page and its code
 * come from the network. An adviser in a dead spot would lose the screen she was working on even
 * though her unsent saves were safe in the outbox.
 *
 * What this does and does not do:
 *   - GET requests for this site only. Everything else - every save, and every call to Supabase -
 *     goes straight to the network. A save is never answered from a cache, and a request that
 *     cannot leave is never made to look as if it arrived: that is the outbox's job, not ours.
 *   - Pages: the network first, so an online phone always has the current screen; the copy on the
 *     phone only when the network does not answer.
 *   - Code, styles and images: the copy on the phone first, refreshed in the background. Their
 *     names carry a build hash, so a new deployment asks for new names and cannot be served stale.
 */
const CACHE = "qirsh-shell-v1";

/* The screens an adviser may reload while the connection is gone. */
const ROUTES = [
  "/", "/dashboard", "/orders", "/orders/new", "/receipts", "/receipts/new", "/customers",
  "/price-list", "/stock", "/approvals", "/accounts", "/shipments", "/closing", "/profit",
  "/settings", "/server-checks",
];

const ASSET = /\/_next\/static\/[A-Za-z0-9._/-]+/g;

/* Puts one address on the phone and reports the code and styles it asks for. */
const warm = async (cache, url) => {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return [];
    await cache.put(url, res.clone());
    const type = res.headers.get("content-type") || "";
    if (!/html|css/.test(type)) return [];
    // The page names its own code and styles; a stylesheet names its fonts.
    return [...new Set((await res.text()).match(ASSET) || [])];
  } catch {
    return []; // no connection while warming: this address is simply not there yet
  }
};

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const pages = await Promise.all(["/icon.svg", "/manifest.webmanifest", ...ROUTES].map((u) => warm(cache, u)));
      // A page without its code is a white screen, so the code goes on the phone with it.
      const assets = [...new Set(pages.flat())].filter((u) => !u.endsWith("/"));
      const fonts = await Promise.all(assets.map((u) => warm(cache, u)));
      await Promise.all([...new Set(fonts.flat())].filter((u) => !assets.includes(u)).map((u) => warm(cache, u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // saves are never touched
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, fonts: straight through

  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) (await caches.open(CACHE)).put(url.pathname, res.clone());
          return res;
        } catch {
          const cache = await caches.open(CACHE);
          // The screen as it was last seen. A screen this phone has never opened is not faked with
          // another one: it says so, and the rest of the app is still there.
          return (await cache.match(url.pathname)) || offlinePage();
        }
      })(),
    );
    return;
  }

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const live = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || live;
    })(),
  );
});

/* Only for an address this phone has never opened while it had a connection. */
function offlinePage() {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>No connection</title>
<style>
 :root { color-scheme: light }
 body { margin:0; min-height:100dvh; display:grid; place-items:center; background:#f5f7f5; color:#1b241f;
        font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; padding:24px }
 .box { max-width:30rem; text-align:center }
 h1 { font-size:1.25rem; margin:0 0 .5rem }
 p { margin:0 0 .35rem; color:#55605a }
 .ar { direction:rtl; margin-top:1.25rem; padding-top:1.25rem; border-top:1px solid #dfe5e1 }
 a { display:inline-block; margin-top:1.25rem; background:#1e4d3b; color:#fff; text-decoration:none;
     padding:.7rem 1.2rem; border-radius:.6rem; font-weight:600 }
</style></head>
<body><div class="box">
 <h1>No connection</h1>
 <p>This screen was not open on this phone before the connection went, so there is nothing to show yet.</p>
 <p>Nothing you saved is lost: it is waiting on the phone and goes up by itself.</p>
 <div class="ar"><h1>لا يوجد اتصال</h1>
  <p>هذه الشاشة لم تُفتح على هذا الهاتف قبل انقطاع الاتصال، فلا يوجد ما يُعرض بعد.</p>
  <p>لم يضع شيء مما حفظته: إنه ينتظر على الهاتف ويُرسل تلقائيًا.</p></div>
 <a href="/dashboard">Open the app</a>
</div></body></html>`;
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
