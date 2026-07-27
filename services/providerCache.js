/**
 * SAĞLAYICI YANIT ÖNBELLEĞİ — kota koruması.
 *
 * Denetimin bulduğu boşluk: CDN önbelleği vardı, sağlayıcı önbelleği yoktu.
 * `matches-live` politikası s-maxage=10 ile geliyor ve istemci 20 saniyede
 * bir yokluyor; her CDN ıskası doğrudan API-Football'a gidiyordu. Ücretsiz
 * paket günde 100 istek veriyor — tek bir canlı maç günü bunu saatler içinde
 * tüketir ve kota bittiğinde sağlayıcı 429 döndürmeye başlar.
 *
 * Bu katman üç şey yapıyor:
 *
 *   1. TTL ÖNBELLEĞİ — aynı sorgu TTL içinde tekrar sorulmaz.
 *   2. TEK UÇUŞ (single-flight) — aynı anahtar için eşzamanlı N istek tek
 *      sağlayıcı çağrısına indirgenir. Soğuk önbellekte gelen trafik
 *      dalgası, kotayı N kat harcamak yerine bir kez harcar.
 *   3. HATADA BAYAT SERVİS — sağlayıcı 429 ya da kesinti döndürdüğünde son
 *      BAŞARILI yanıt sınırlı bir süre boyunca servis edilir. Kota bittiğinde
 *      sayfanın boşalması, elde geçerli bir yanıt varken gereksiz.
 *
 * Hata ASLA önbelleğe yazılmaz: başarısız bir çağrı, bir sonraki isteğin
 * yeniden denemesini engellemez.
 *
 * Süreç içi ve sınırlı boyutlu. Sunucusuz ortamda sıcak örnek boyunca
 * yaşar, yeni örnekte sıfırlanır — kalıcı depo değil, kota tamponu.
 */

/** Kaynak başına varsayılan TTL. Canlı veri kısa, kadro/lig uzun. */
const DEFAULT_TTLS = Object.freeze({
  "matches-live": 15 * 1000,
  matches: 60 * 1000,
  "match-detail": 30 * 1000,
  standings: 5 * 60 * 1000,
  "super-lig-fixtures": 30 * 60 * 1000,
  teams: 6 * 60 * 60 * 1000,
  squad: 6 * 60 * 60 * 1000,
  players: 12 * 60 * 60 * 1000,
  transfers: 60 * 60 * 1000,
  default: 60 * 1000
});

/**
 * Sağlayıcı hata verdiğinde bayat yanıtın servis edilebileceği en uzun süre.
 * Bunun ötesinde bayat veri servis etmek, "canlı skor" iddiasını bozar:
 * eski bir skoru güncel gibi göstermektense boş durum dürüsttür.
 */
const MAX_STALE_ON_ERROR_MS = 10 * 60 * 1000;

/** Sınırsız büyüme koruması. */
const MAX_ENTRIES = 200;

const store = new Map();
const inFlight = new Map();

function ttlFor(resource) {
  return DEFAULT_TTLS[resource] || DEFAULT_TTLS.default;
}

function cacheKey(resource, params) {
  const normalized = {};
  for (const key of Object.keys(params || {}).sort()) {
    const value = params[key];
    if (value === null || value === undefined || value === "") continue;
    normalized[key] = String(value);
  }
  return `${resource}:${JSON.stringify(normalized)}`;
}

/**
 * En eski girdiyi düşürür. Map ekleme sırasını koruduğu için ilk anahtar
 * en eskisidir; sıcak anahtarlar her yazımda sona taşındığı için bu
 * yaklaşık bir LRU'dur.
 */
function evictIfNeeded() {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

function readEntry(key) {
  return store.get(key) || null;
}

function writeEntry(key, value) {
  // Yeniden ekleme, anahtarı Map sırasının sonuna taşır (LRU tazeleme).
  store.delete(key);
  store.set(key, { value, storedAt: Date.now() });
  evictIfNeeded();
}

function isFresh(entry, ttlMs) {
  return Boolean(entry) && (Date.now() - entry.storedAt) < ttlMs;
}

function isServableWhenStale(entry) {
  return Boolean(entry) && (Date.now() - entry.storedAt) < MAX_STALE_ON_ERROR_MS;
}

/**
 * Önbellekli çağrı.
 *
 * @param {string} resource   TTL seçimi için kaynak adı
 * @param {object} params     sorgu — anahtarın parçası
 * @param {Function} fetcher  gerçek sağlayıcı çağrısı
 * @param {object} [options]  { ttlMs, now }
 * @returns {Promise<{data: *, cache: "hit"|"miss"|"stale"|"coalesced"}>}
 */
async function fetchWithCache(resource, params, fetcher, options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : ttlFor(resource);
  const key = cacheKey(resource, params);

  const cached = readEntry(key);
  if (isFresh(cached, ttlMs)) {
    return { data: cached.value, cache: "hit" };
  }

  // TEK UÇUŞ: aynı anahtar için zaten bir çağrı havadaysa ona katıl.
  const pending = inFlight.get(key);
  if (pending) {
    const data = await pending;
    return { data, cache: "coalesced" };
  }

  const promise = (async () => fetcher())();
  inFlight.set(key, promise);

  try {
    const data = await promise;
    writeEntry(key, data);
    return { data, cache: "miss" };
  } catch (error) {
    // Hata önbelleğe YAZILMAZ. Elde bayat ama geçerli bir yanıt varsa
    // kesinti/kota aşımı boyunca o servis edilir.
    if (isServableWhenStale(cached)) {
      return { data: cached.value, cache: "stale", error };
    }
    throw error;
  } finally {
    inFlight.delete(key);
  }
}

/** Test ve tanı için. */
function clearProviderCache() {
  store.clear();
  inFlight.clear();
}

function providerCacheStats() {
  return { entries: store.size, inFlight: inFlight.size, maxEntries: MAX_ENTRIES };
}

module.exports = {
  fetchWithCache,
  clearProviderCache,
  providerCacheStats,
  cacheKey,
  ttlFor,
  DEFAULT_TTLS,
  MAX_STALE_ON_ERROR_MS,
  MAX_ENTRIES
};
