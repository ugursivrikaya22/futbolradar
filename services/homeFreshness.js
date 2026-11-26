/**
 * ANA SAYFA TAZELİK KURALLARI — TEK YER.
 *
 * Ana sayfadaki maç kartları ve öne çıkan içerikler elle çıkarılmaz; tarihe
 * göre kendiliğinden düşer:
 *
 *   • Oynanmış maç "Son sonuçlar" bölümünde EN FAZLA 24 saat kalır.
 *   • Öne çıkan haber / köşe yazısı 48 saatten eskiyse yerini yenisine bırakır
 *     (yenisi yoksa vitrin boş kalır; eski içerik "öne çıkan" diye sunulmaz).
 *
 * Maçın bitiş anı: sağlayıcı `finishedAt`/`endedAt` verdiyse o; yoksa başlama
 * + MATCH_DURATION_MS tahmini. Tahmin gerçek bitişe yakındır (90 dk + ara +
 * uzatmalar ≈ 2 saat), 24 saatlik pencereyi dakikalar mertebesinde oynatır.
 *
 * Aynı kural tarayıcıda app.js içindeki `home-freshness` bloğunda da vardır;
 * scripts/test-home-freshness.mjs iki tarafın aynı karar verdiğini doğrular.
 */
const { matchState } = require("./matchStatus");

const HOUR_MS = 3600000;
const RESULT_WINDOW_MS = 24 * HOUR_MS;
const FEATURED_MAX_AGE_MS = 48 * HOUR_MS;
const MATCH_DURATION_MS = 2 * HOUR_MS;

function hasScore(match) {
  const score = match && match.score;
  return Boolean(score)
    && score.home !== null && score.home !== undefined && score.home !== ""
    && score.away !== null && score.away !== undefined && score.away !== ""
    && Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
}

/** Maçın bitiş zamanı (ms) ya da bilinemiyorsa NaN. */
function matchEndMs(match) {
  if (!match) return NaN;
  const reported = Date.parse(match.finishedAt || match.endedAt);
  if (Number.isFinite(reported)) return reported;
  const kickoff = Date.parse(match.kickoff);
  return Number.isFinite(kickoff) ? kickoff + MATCH_DURATION_MS : NaN;
}

/** Son sonuçlardan düşeceği an (ms) ya da NaN. */
function resultExpiresAtMs(match) {
  const end = matchEndMs(match);
  return Number.isFinite(end) ? end + RESULT_WINDOW_MS : NaN;
}

/**
 * Maç "son sonuç" olarak gösterilebilir mi? Yalnızca bitmiş ve skoru olan
 * maç; ertelenen/iptal edilen maçın sonucu yoktur. Skor UYDURULMAZ.
 */
function isRecentResult(match, nowMs = Date.now()) {
  if (!match || matchState(match) !== "FINISHED" || !hasScore(match)) return false;
  const kickoff = Date.parse(match.kickoff);
  if (!Number.isFinite(kickoff) || kickoff > nowMs) return false;
  const expires = resultExpiresAtMs(match);
  return Number.isFinite(expires) && nowMs < expires;
}

/** En yeni biten önde; en çok `limit` maç. */
function selectRecentResults(matches, nowMs = Date.now(), limit = 6) {
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => isRecentResult(match, nowMs))
    .sort((left, right) => matchEndMs(right) - matchEndMs(left))
    .slice(0, limit);
}

/**
 * Öne çıkan haber / yazı hâlâ taze mi? Tarihsiz ya da gelecek tarihli kayıt
 * (zamanlanmış yayın) vitrine çıkmaz.
 */
function isFreshFeatured(publishedAt, nowMs = Date.now(), maxAgeMs = FEATURED_MAX_AGE_MS) {
  const time = Date.parse(publishedAt);
  return Number.isFinite(time) && time <= nowMs && nowMs - time < maxAgeMs;
}

module.exports = {
  FEATURED_MAX_AGE_MS,
  MATCH_DURATION_MS,
  RESULT_WINDOW_MS,
  isFreshFeatured,
  isRecentResult,
  matchEndMs,
  resultExpiresAtMs,
  selectRecentResults
};
