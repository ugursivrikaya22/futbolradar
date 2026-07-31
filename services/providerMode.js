/**
 * SAĞLAYICI MODU — "canlı veri mi, saklanan veri mi?"
 *
 * SORUN. Sistem, API anahtarı olmadığında da sessizce çalışıyordu: depodaki
 * maç verisi okunuyor, `lastSuccessfulSyncAt` alanı dolu görünüyor ve
 * teşhis çıktısı "veri tazeliği" başlığı altında bir yaş raporluyordu. Bu
 * yaş SAKLANAN verinin yaşıydı; sağlayıcıdan yeni bir şey gelmiyordu.
 * Sonuç: "hat çalışıyor ama sağlayıcı veri vermiyor" ile "hat hiç
 * çalışmıyor, çünkü anahtar yok" ayırt edilemiyordu.
 *
 * Bu modül iki durumu ayırır ve ikisini de AÇIKÇA söyler:
 *
 *   live        — anahtar var, sağlayıcıya gidilebilir.
 *   stored-only — anahtar YOK. Depodaki veri okunur ama TAZE SAYILMAZ;
 *                 arayüz "API anahtarı eksik" rozetini gösterir.
 *
 * Anahtarın kendisi hiçbir koşulda okunmaz, günlüğe yazılmaz, yanıta
 * girmez — yalnızca "dolu mu" sorusu yanıtlanır.
 */

/**
 * Okunan ortam değişkenleri. İLKİ birincil addır; Vercel'de tanımlanması
 * gereken değişken budur. Diğerleri geçmişte kullanılmış eş adlar.
 */
const API_KEY_ENV_NAMES = [
  "APIFOOTBALL_API_KEY",
  "API_FOOTBALL_API_KEY",
  "APIFOOTBALL_KEY",
  "API_SPORTS_API_KEY",
  "APISPORTS_API_KEY"
];

/** Vercel ve GitHub Actions'ta tanımlanması gereken değişkenin tam adı. */
const PRIMARY_API_KEY_ENV = API_KEY_ENV_NAMES[0];

const MODES = Object.freeze({
  LIVE: "live",
  STORED_ONLY: "stored-only"
});

const MISSING_KEY_MESSAGE =
  `API anahtarı tanımlı değil (${PRIMARY_API_KEY_ENV}). ` +
  "Sağlayıcıya hiç istek gönderilmiyor; gösterilen maç verisi depoda saklanan " +
  "son doğrulanmış kayıttır ve TAZE DEĞİLDİR.";

/** Hangi env adları dolu? Değerler okunmaz, yalnızca varlıkları. */
function presentKeyEnvNames(env) {
  const source = env || process.env;
  return API_KEY_ENV_NAMES.filter((name) => String(source[name] || "").trim() !== "");
}

function hasApiKey(env) {
  return presentKeyEnvNames(env).length > 0;
}

/**
 * Çalışma modu ve gerekçesi.
 *
 * @param {Object} [env] Test edilebilirlik için; varsayılan process.env.
 * @returns {{mode: string, live: boolean, apiKeyPresent: boolean,
 *   primaryEnvName: string, presentEnvNames: string[], warning: string|null,
 *   dataFreshnessTrustworthy: boolean}}
 */
function resolveProviderMode(env) {
  const present = presentKeyEnvNames(env);
  const live = present.length > 0;

  return {
    mode: live ? MODES.LIVE : MODES.STORED_ONLY,
    live,
    apiKeyPresent: live,
    primaryEnvName: PRIMARY_API_KEY_ENV,
    presentEnvNames: present,
    // Anahtar yokken depodaki zaman damgası "tazelik" olarak SUNULAMAZ.
    dataFreshnessTrustworthy: live,
    warning: live ? null : MISSING_KEY_MESSAGE
  };
}

/**
 * Komut satırı betikleri için tek satırlık uyarı. Anahtar yoksa her koşuda
 * basılır — sessizce no-op eden bir betik, çalıştığı sanılan bir betiktir.
 */
function logProviderMode(scope, env) {
  const resolved = resolveProviderMode(env);

  if (resolved.live) {
    console.log(`[futbolradar:provider-mode] scope=${scope} mode=live env=${resolved.presentEnvNames.join(",")}`);
    return resolved;
  }

  console.warn(`[futbolradar:provider-mode] scope=${scope} mode=stored-only ${resolved.warning}`);
  return resolved;
}

module.exports = {
  API_KEY_ENV_NAMES,
  MISSING_KEY_MESSAGE,
  MODES,
  PRIMARY_API_KEY_ENV,
  hasApiKey,
  logProviderMode,
  presentKeyEnvNames,
  resolveProviderMode
};
