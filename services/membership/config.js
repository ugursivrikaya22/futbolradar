/**
 * FUTBOLRADAR PRO — ÜYELİK YAPILANDIRMASININ TEK KAYNAĞI.
 *
 * ---------------------------------------------------------------------
 * BUGÜNKÜ DURUM: PRO ÜCRETSİZ. KOD ÜCRETLİ OLMAYA HAZIR.
 * ---------------------------------------------------------------------
 * Erken erişim döneminde kayıt olan HERKES `pro` statüsü alıyor ve
 * hiç kimseden para istenmiyor. Ama "ücretsiz" bir DEĞER kararıdır,
 * mimari karar değil: ileride fiyat konduğunda yeniden yazılacak bir
 * ödeme katmanı bırakmamak için erişim kararı bugünden TEK bir
 * fonksiyondan (`canUseProFeature`) geçiyor.
 *
 * Ücretli sisteme geçiş için gereken TEK kod değişikliği:
 *
 *   1. `PRO_PAYWALL_ENABLED` → true
 *   2. `PRO_PRICE` → gerçek fiyat
 *   3. `PAYMENT_PROVIDER` → "stripe" | "iyzico"
 *   4. Sağlayıcının webhook'u `profiles.subscription_status` yazsın.
 *
 * Yüzeylerin hiçbiri değişmez: sayfalar, API kapıları ve rozet zaten
 * `canUseProFeature()` / `membershipLabel()` okuyor. Bu yüzden bu
 * dosyada hiçbir yerde "ücretsiz" varsayımı SABİT yazılmadı —
 * paywall kapalıyken bile kod ücretli dünyanın şeklinde duruyor.
 *
 * ---------------------------------------------------------------------
 * ORTAM DEĞİŞKENİ EZEBİLİR, AMA VARSAYILAN BURADA
 * ---------------------------------------------------------------------
 * Değerler ortamdan okunabiliyor (staging'de paywall'ı açıp denemek
 * için) ama varsayılanlar burada yazılı: ortam değişkeni tanımlı
 * değilse üretimde ne olacağı bu dosyaya bakarak görülebilmeli.
 */

/** Üyelik kademeleri. Veritabanı `profiles.subscription_type` ile birebir. */
const TIERS = Object.freeze({
  FREE: "free",
  PRO: "pro",
  PRO_PLUS: "pro_plus"
});

const TIER_VALUES = Object.freeze([TIERS.FREE, TIERS.PRO, TIERS.PRO_PLUS]);

/** Kademe sırası: erişim karşılaştırması sayı üzerinden yapılır. */
const TIER_RANK = Object.freeze({
  [TIERS.FREE]: 0,
  [TIERS.PRO]: 1,
  [TIERS.PRO_PLUS]: 2
});

/** Abonelik durumu. Ödeme sağlayıcısı webhook'u bu alanı yazacak. */
const STATUSES = Object.freeze({
  ACTIVE: "active",
  TRIALING: "trialing",
  PAST_DUE: "past_due",
  CANCELED: "canceled",
  EXPIRED: "expired"
});

const STATUS_VALUES = Object.freeze(Object.values(STATUSES));

/**
 * Erişim veren durumlar. `past_due` BİLEREK içeride: ödeme başarısız
 * olduğunda erişimi aynı saniye kesmek, kart yenileme penceresi olan
 * her abonelik ürününde iptal sebebidir. `canceled` da içeride değil —
 * iptal edilmiş ama süresi dolmamış abonelik `expires_at` üzerinden
 * değerlendirilir (bkz. `isSubscriptionLive`).
 */
const ACCESS_GRANTING_STATUSES = Object.freeze([STATUSES.ACTIVE, STATUSES.TRIALING, STATUSES.PAST_DUE]);

function envValue(name) {
  return String(process.env[name] || "").trim();
}

function envFlag(name, fallback) {
  const raw = envValue(name).toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on", "acik", "açık"].includes(raw)) return true;
  if (["0", "false", "no", "off", "kapali", "kapalı"].includes(raw)) return false;
  return fallback;
}

function envNumber(name, fallback) {
  const raw = envValue(name);
  if (!raw) return fallback;
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/** PRO sistemi açık mı? Kapatılırsa üyelik yüzeyleri hiç çizilmez. */
const PRO_ENABLED = envFlag("PRO_ENABLED", true);

/** Aylık fiyat. 0 = erken erişim, ücretsiz. */
const PRO_PRICE = envNumber("PRO_PRICE", 0);

const PRO_CURRENCY = envValue("PRO_CURRENCY") || "TRY";

/**
 * ÖDEME DUVARI. `false` iken PRO özellikleri, giriş yapmış HER
 * kullanıcıya açıktır — kademesi ne olursa olsun. `true` olduğunda
 * `canUseProFeature` kademe ve durum kontrolüne döner.
 *
 * ŞU ANDA KESİNLİKLE `false`: hiçbir kullanıcıdan para istenmiyor.
 */
const PRO_PAYWALL_ENABLED = envFlag("PRO_PAYWALL_ENABLED", false);

/** "none" = ödeme entegrasyonu yok. İleride "stripe" | "iyzico". */
const PAYMENT_PROVIDER = envValue("PAYMENT_PROVIDER") || "none";

/**
 * YENİ ÜYENİN VARSAYILAN KADEMESİ.
 *
 * Erken erişimde `pro`: kayıt olan herkes ücretsiz PRO. Ücretli
 * döneme geçildiğinde bu `free` olur ve yükseltme ödemeden gelir.
 */
const DEFAULT_SIGNUP_TIER = (() => {
  const raw = envValue("PRO_DEFAULT_TIER").toLowerCase();
  return TIER_VALUES.includes(raw) ? raw : TIERS.PRO;
})();

const DEFAULT_SIGNUP_STATUS = (() => {
  const raw = envValue("PRO_DEFAULT_STATUS").toLowerCase();
  return STATUS_VALUES.includes(raw) ? raw : STATUSES.ACTIVE;
})();

/**
 * PRO ÖZELLİK ANAHTARLARI.
 *
 * Yüzeyler bu anahtarları kullanır, kademe adını değil. Böylece bir
 * özelliği `pro_plus`a taşımak tek satırlık bir düzenleme olur ve
 * özelliğin çizildiği sayfa hiç değişmez.
 */
const FEATURES = Object.freeze({
  AI_ANALYSIS: "ai_analysis",
  ADVANCED_STATS: "advanced_stats",
  WIN_PROBABILITIES: "win_probabilities",
  PROBABLE_LINEUPS: "probable_lineups",
  AVAILABILITY: "availability",
  TEAM_FORM: "team_form",
  PLAYER_COMPARISON: "player_comparison",
  LEAGUE_STATS: "league_stats",
  FAVORITE_TEAMS: "favorite_teams",
  FAVORITE_PLAYERS: "favorite_players",
  FAVORITE_LEAGUES: "favorite_leagues",
  FAVORITE_MATCHES: "favorite_matches",
  PERSONAL_HOME: "personal_home",
  NOTIFICATIONS: "notifications",
  AD_LIGHT: "ad_light"
});

const FEATURE_VALUES = Object.freeze(Object.values(FEATURES));

/**
 * Özellik → gereken EN DÜŞÜK kademe.
 *
 * Bugün hepsi `pro` çünkü `pro_plus` henüz bir ürün değil; kademe
 * şemada ve burada var ki ileride bir özelliği yukarı taşımak veri
 * göçü gerektirmesin.
 */
const FEATURE_MIN_TIER = Object.freeze(
  FEATURE_VALUES.reduce((map, feature) => Object.assign(map, { [feature]: TIERS.PRO }), {})
);

function normalizeTier(value) {
  const raw = String(value || "").trim().toLowerCase();
  return TIER_VALUES.includes(raw) ? raw : TIERS.FREE;
}

function normalizeStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  return STATUS_VALUES.includes(raw) ? raw : STATUSES.EXPIRED;
}

/**
 * Abonelik CANLI mı? — kademe değil, ZAMAN ve DURUM sorusu.
 *
 * `expires_at` boşsa süresiz sayılır: erken erişim üyelerinin bitiş
 * tarihi yok ve `null`u "süresi dolmuş" saymak bugün herkesin
 * erişimini keserdi.
 */
function isSubscriptionLive(profile, now = new Date()) {
  const status = normalizeStatus(profile && profile.subscriptionStatus);
  const expiresAt = profile && profile.subscriptionExpiresAt;

  if (expiresAt) {
    const expiry = new Date(expiresAt);
    if (Number.isFinite(expiry.getTime()) && expiry.getTime() <= now.getTime()) {
      return false;
    }
  }

  return ACCESS_GRANTING_STATUSES.includes(status);
}

/**
 * PRO ÖZELLİĞİ KULLANILABİLİR Mİ? — TEK KARAR NOKTASI.
 *
 * Ücretli sisteme geçişte değişen tek davranış burada: paywall kapalı
 * iken giriş yapmış olmak yeterli, açıkken kademe + durum aranır.
 * Çağıran yüzeylerin hiçbiri bu farkı bilmez.
 */
function canUseProFeature(profile, feature) {
  if (!PRO_ENABLED) return false;
  if (!profile) return false;

  const wanted = String(feature || "").trim();
  if (wanted && !FEATURE_VALUES.includes(wanted)) return false;

  // ERKEN ERİŞİM: duvar kapalı, giriş yapmış herkes içeride.
  if (!PRO_PAYWALL_ENABLED) return true;

  if (!isSubscriptionLive(profile)) return false;

  const tier = normalizeTier(profile.subscriptionType);
  const required = wanted ? (FEATURE_MIN_TIER[wanted] || TIERS.PRO) : TIERS.PRO;
  return (TIER_RANK[tier] || 0) >= (TIER_RANK[required] || 0);
}

/** Rozet çizilsin mi? "PRO" yazısı bir iddiadır; kademe gerçekten PRO olmalı. */
function hasProBadge(profile) {
  if (!PRO_ENABLED || !profile) return false;
  const tier = normalizeTier(profile.subscriptionType);
  if (tier === TIERS.FREE) return false;
  // Duvar kapalıyken durum kontrolü yapılmaz: kimseden ödeme
  // beklenmediği için "süresi dolmuş" diye bir hâl de yok.
  return PRO_PAYWALL_ENABLED ? isSubscriptionLive(profile) : true;
}

/** Rozet metni: `pro_plus` ayrı yazılır, aksi hâlde ikisi karışır. */
function badgeLabel(profile) {
  return normalizeTier(profile && profile.subscriptionType) === TIERS.PRO_PLUS ? "PRO+" : "PRO";
}

/**
 * FİYAT ETİKETİ.
 *
 * 0 iken "Ücretsiz" yazılır — "0 TL" teknik olarak doğru ama okura
 * bir ödeme adımı olduğunu ima eder.
 */
function priceLabel(locale = "tr") {
  const isEn = String(locale).toLowerCase().startsWith("en");
  if (!PRO_PRICE) return isEn ? "Free" : "Ücretsiz";
  const amount = Number.isInteger(PRO_PRICE) ? String(PRO_PRICE) : PRO_PRICE.toFixed(2);
  const suffix = PRO_CURRENCY === "TRY" ? "TL" : PRO_CURRENCY;
  return isEn ? `${amount} ${suffix}/mo` : `${amount} ${suffix}/ay`;
}

/** Profil sayfasındaki "Üyelik: ..." satırı. */
function membershipLabel(profile, locale = "tr") {
  const isEn = String(locale).toLowerCase().startsWith("en");
  if (!hasProBadge(profile)) {
    return isEn ? "FutbolRadar Free" : "FutbolRadar Ücretsiz";
  }
  const name = `FutbolRadar ${badgeLabel(profile)}`;
  return `${name} – ${priceLabel(locale)}`;
}

/** Yeni üyeye yazılacak abonelik alanları. Kayıt akışının tek kaynağı. */
function signupDefaults(now = new Date()) {
  return {
    subscription_type: DEFAULT_SIGNUP_TIER,
    subscription_status: DEFAULT_SIGNUP_STATUS,
    subscription_started_at: now.toISOString(),
    // Erken erişimde bitiş tarihi YOK. Ücretli döneme geçildiğinde
    // sağlayıcının dönem sonu buraya yazılacak.
    subscription_expires_at: null,
    payment_provider: PAYMENT_PROVIDER === "none" ? null : PAYMENT_PROVIDER,
    payment_customer_id: null
  };
}

/**
 * İSTEMCİYE GİDEN YAPILANDIRMA.
 *
 * Yalnızca ekranda gösterilecek olanlar. Ortam değişkeni adları ya da
 * sağlayıcı anahtarları buradan ÇIKMAZ.
 */
function publicConfig() {
  return {
    enabled: PRO_ENABLED,
    price: PRO_PRICE,
    currency: PRO_CURRENCY,
    paywall: PRO_PAYWALL_ENABLED,
    free: !PRO_PAYWALL_ENABLED || PRO_PRICE === 0,
    defaultTier: DEFAULT_SIGNUP_TIER
  };
}

module.exports = {
  ACCESS_GRANTING_STATUSES,
  DEFAULT_SIGNUP_STATUS,
  DEFAULT_SIGNUP_TIER,
  FEATURES,
  FEATURE_MIN_TIER,
  FEATURE_VALUES,
  PAYMENT_PROVIDER,
  PRO_CURRENCY,
  PRO_ENABLED,
  PRO_PAYWALL_ENABLED,
  PRO_PRICE,
  STATUSES,
  STATUS_VALUES,
  TIERS,
  TIER_RANK,
  TIER_VALUES,
  badgeLabel,
  canUseProFeature,
  hasProBadge,
  isSubscriptionLive,
  membershipLabel,
  normalizeStatus,
  normalizeTier,
  priceLabel,
  publicConfig,
  signupDefaults
};
