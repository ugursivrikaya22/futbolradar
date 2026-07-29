/**
 * SUNUCU İSTEMCİSİ — servis anahtarı yalnızca burada.
 *
 * Servis anahtarı satır düzeyi güvenliği (RLS) TAMAMEN BAYPAS EDER. Onu
 * taşıyan kod, veritabanının tamamına sınırsız yazma yetkisine sahiptir.
 * Tarayıcıya ulaşması, veritabanını internete açmakla aynı şeydir.
 *
 * ÜÇ KATMANLI KORUMA:
 *
 *   1. Bu dosya `typeof window` görürse AÇIKÇA PATLAR. Sessizce anon'a
 *      düşmek daha "nazik" olurdu ama tehlikeli: yanlış yapılandırma
 *      görünmez kalır ve bir gün gerçekten sızdıran bir yola dönüşür.
 *   2. Yalnızca api/ ve scripts/ bu dosyayı require eder. app.js ve
 *      tarayıcıya giden hiçbir dosya etmez.
 *   3. scripts/test-supabase-layer.mjs yayımlanan çıktının tamamını
 *      (app.js, tüm HTML, public/) tarar ve ne anahtar ADININ ne de JWT
 *      biçiminde bir değerin geçmediğini doğrular.
 *
 * ÜÇÜ DE GEREKLİ. Birincisi kazayı, ikincisi alışkanlığı, üçüncüsü ikisinin
 * de kaçırdığını yakalar.
 */

const { createClient } = require("./restClient.js");
const { hasServiceConfig, readAnonKey, readServiceKey, readUrl } = require("./config.js");

/** Aynı süreçte tekrar tekrar istemci kurmamak için. */
let cachedServiceClient = null;
let cachedReadClient = null;

function assertServerRuntime(what) {
  if (typeof window !== "undefined") {
    throw new Error(
      `${what} tarayıcıda kullanılamaz. Supabase servis anahtarı RLS'i baypas eder; ` +
      "istemci tarafına taşınması veritabanını herkese açmak demektir."
    );
  }
}

/**
 * Servis rolüyle tam yetkili istemci. YALNIZCA api/ ve scripts/ içinden.
 *
 * Yapılandırma eksikse null döner — çağıran taraf bunu "Supabase kapalı"
 * olarak okur ve yerel JSON verisiyle çalışmaya devam eder. Depo, Supabase
 * olmadan da çalışmak zorunda: geliştirme ve CI ortamlarında anahtar yok.
 */
function getServiceClient() {
  assertServerRuntime("Supabase servis istemcisi");
  if (cachedServiceClient) return cachedServiceClient;
  if (!hasServiceConfig()) return null;

  cachedServiceClient = createClient({
    url: readUrl(),
    key: readServiceKey(),
    role: "service"
  });
  return cachedServiceClient;
}

/**
 * Sunucuda okuma için istemci. Servis anahtarı VARSA onu, yoksa anon'u
 * kullanır — okuma işlemleri için servis yetkisi gerekmez ve gereksiz yetki
 * kullanmamak iyi bir alışkanlıktır.
 */
function getReadClient() {
  assertServerRuntime("Supabase okuma istemcisi");
  if (cachedReadClient) return cachedReadClient;

  const url = readUrl();
  if (!url) return null;

  const anon = readAnonKey();
  const service = readServiceKey();
  const key = anon || service;
  if (!key) return null;

  cachedReadClient = createClient({ url, key, role: anon ? "anon" : "service" });
  return cachedReadClient;
}

/** Supabase bu ortamda kullanılabilir mi? */
function isEnabled() {
  if (typeof window !== "undefined") return false;
  return Boolean(getReadClient());
}

/** Test ve uzun ömürlü süreçler için önbelleği boşaltır. */
function resetClients() {
  cachedServiceClient = null;
  cachedReadClient = null;
}

module.exports = {
  assertServerRuntime,
  getReadClient,
  getServiceClient,
  isEnabled,
  resetClients
};
