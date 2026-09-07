/**
 * FUTBOLRADAR SERVICE WORKER.
 *
 * KAPSAM BİLEREK DAR: bu dosya kök dizinden (`/sw.js`) kayıt olduğu için
 * tarayıcı her gezinmeyi bu `fetch` olay dinleyicisinden geçirir, ama
 * dinleyicinin kendisi yalnızca AŞAĞIDAKİ üç kategoriyi ele alır — geri
 * kalan her istek `respondWith` hiç çağrılmadan olağan ağ yoluna bırakılır:
 *
 *   1. Canlı skor sayfaları (`LIVE_SCORE_PATHS`) ve kullanıcının seçtiği
 *      favori takımın sayfaları (istemciden `SET_FAVORITE_TEAM` mesajıyla
 *      gelir, `fr-meta` önbelleğinde saklanır) — bunlar çevrimdışıyken de
 *      son görülen hâliyle açılabilsin diye ağ-önce/önbellek-yedek ile
 *      sunulur.
 *   2. Bu sayfaların ihtiyaç duyduğu sabit üç varlık (`page.css`, `site.js`,
 *      `app.js`) — sürüm sorgusu (`?v=hash`) URL'nin bir parçası değil,
 *      `pathname`de olduğu için eşleşme sürümden bağımsız çalışır.
 *   3. Canlı skor verisini taşıyan üç API ucu (`/api/matches`,
 *      `/api/standings`, `/api/teams`) — son bilinen anlık görüntü
 *      çevrimdışında da gösterilsin diye kısa zaman aşımlı ağ-önce.
 *
 * SİTENİN GERİ KALANI (13.000'den fazla sayfa) BU SERVICE WORKER'DAN HİÇ
 * GEÇMEZ — ne önbelleğe yazılır ne önbellekten okunur. "Tüm siteyi değil,
 * yalnızca canlı skor ve favori takım sayfalarını" isteği bu ayrımla
 * karşılanıyor.
 */

const SW_VERSION = "v1";
const HTML_CACHE = `fr-pages-${SW_VERSION}`;
const ASSET_CACHE = `fr-assets-${SW_VERSION}`;
const API_CACHE = `fr-api-${SW_VERSION}`;
const META_CACHE = `fr-meta-${SW_VERSION}`;
const KNOWN_CACHES = new Set([HTML_CACHE, ASSET_CACHE, API_CACHE, META_CACHE]);

const META_KEY = new Request("/__fr-pwa-meta/favorite-team-paths");

const LIVE_SCORE_PATHS = ["/canli-skor.html", "/canli-maclar.html", "/canli-mac-sonuclari.html"];
const TRACKED_ASSET_PATHS = new Set(["/page.css", "/site.js", "/app.js"]);
const TRACKED_API_PATHS = new Set(["/api/matches", "/api/standings", "/api/teams"]);

const NETWORK_TIMEOUT_MS = 4000;

async function getFavoriteTeamPaths() {
  try {
    const cache = await caches.open(META_CACHE);
    const stored = await cache.match(META_KEY);
    if (!stored) return [];
    const paths = await stored.json();
    return Array.isArray(paths) ? paths : [];
  } catch (error) {
    return [];
  }
}

async function setFavoriteTeamPaths(paths) {
  const cache = await caches.open(META_CACHE);
  await cache.put(META_KEY, new Response(JSON.stringify(paths), {
    headers: { "Content-Type": "application/json" }
  }));
}

/** Bir isteği zaman aşımlı ağdan çeker; süre dolarsa ağ hâlâ arkada devam eder ama biz beklemeyiz. */
function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fr-sw-network-timeout")), timeoutMs);
    fetch(request.clone ? request.clone() : request).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/** Ağ-önce, önbellek-yedek: canlı sayfa/veri güncelken hep taze, çevrimdışında son bilinen hâl. */
async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetchWithTimeout(request, timeoutMs || NETWORK_TIMEOUT_MS);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

/** Önbellek-önce, arkadan tazele: statik varlıklar için — çevrimdışında anında, çevrimiçiyken hep güncellenir. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || network || fetch(request);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(HTML_CACHE);
    await Promise.all(LIVE_SCORE_PATHS.map((path) => cache.add(path).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("fr-") && !KNOWN_CACHES.has(name)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "SET_FAVORITE_TEAM" && Array.isArray(data.paths)) {
    event.waitUntil((async () => {
      await setFavoriteTeamPaths(data.paths);
      const cache = await caches.open(HTML_CACHE);
      await Promise.all(data.paths.map((path) => cache.add(path).catch(() => {})));
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === "navigate" || request.destination === "document";

  if (isNavigation) {
    event.respondWith((async () => {
      const favoritePaths = LIVE_SCORE_PATHS.includes(url.pathname) ? LIVE_SCORE_PATHS : await getFavoriteTeamPaths();
      const tracked = LIVE_SCORE_PATHS.includes(url.pathname) || favoritePaths.includes(url.pathname);
      if (!tracked) return fetch(request);
      try {
        return await networkFirst(request, HTML_CACHE);
      } catch (error) {
        return fetch(request);
      }
    })());
    return;
  }

  if (TRACKED_ASSET_PATHS.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }

  if (TRACKED_API_PATHS.has(url.pathname)) {
    event.respondWith((async () => {
      try {
        return await networkFirst(request, API_CACHE, 3000);
      } catch (error) {
        return fetch(request);
      }
    })());
  }

  // Diğer her şey (görseller, diğer sayfalar, diğer JS demetleri): dokunulmaz.
});

/**
 * PUSH — gol ve maç başı bildirimleri.
 *
 * Gövde `services/pushNotifier.js` `buildPayload()`ın ürettiği JSON:
 * `{ title, body, tag, url }`. Biçim bozuksa bildirim sessizce atlanır —
 * kırık bir bildirim göstermek, hiç göstermemekten kötü.
 */
self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : null;
  } catch (error) {
    payload = null;
  }
  if (!payload || !payload.title) return;

  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body || "",
    tag: payload.tag || undefined,
    icon: "/favicon-192x192.png",
    badge: "/favicon-96x96.png",
    data: { url: payload.url || "/canli-skor.html" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/canli-skor.html";

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientList) {
      const clientUrl = new URL(client.url);
      if (clientUrl.pathname === new URL(targetUrl, self.location.origin).pathname && "focus" in client) {
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
