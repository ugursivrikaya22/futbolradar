/**
 * CANLI SKOR ALANININ VERİ KATMANI SÜZGECİ.
 *
 * Kural tek ve mutlak: SKORU OLMAYAN MAÇ CANLI SKOR ALANINA HİÇ GİRMEZ.
 * Süzme, kart çizen kodda değil VERİ KATMANINDA yapılır — skoru olmayan
 * maç diziye hiç girmez; çizim katmanının "skor yoksa ne göstereyim"
 * diye bir sorusu kalmaz.
 *
 * "Skoru var" iki koşulun BİRLİKTE tutması demektir:
 *
 *   1. Skor alanı iki tarafta da SAYISAL. `null`, `undefined`, boş dize,
 *      boş nesne — hiçbiri skor değildir. `Number(null)` SIFIR olduğu
 *      için doğrudan Number()'a güvenmek eksik skoru 0-0 sanmak olurdu;
 *      tam da bu kapının engellemesi gereken şey.
 *
 *   2. Maç skoru YAYINLAMIŞ bir durumda: oynanıyor ya da bitmiş.
 *      Başlamamış bir kayıt sağlayıcıdan "0-0" taşıyor olabilir; o sayı
 *      bir sonuç değil, yer tutucudur. Onu skor gibi basmak oynanmamış
 *      bir maça sonuç uydurmak olur.
 *
 * Bu modül hem derleme anında (scripts/prerender-core-pages.mjs, statik
 * yedek içerik) hem testlerde kullanılır. Tarayıcı betiği app.js modül
 * yükleyemediği için aynı mantığı `live-score-filter:start/end` işaretli
 * blokta taşır; scripts/test-live-score-filter.mjs iki uygulamayı aynı
 * girdi tablosunda çalıştırıp ayrışmayı kırmızıya çevirir.
 */

/** Skor yayınlayan durumlar: oynanıyor... */
const LIVE_STATUSES = ["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"];

/** ...ya da bitmiş. */
const FINISHED_STATUSES = ["FINISHED", "FT", "AET", "PEN"];

function isScoreNumber(value) {
  if (typeof value === "number") return isFinite(value);
  if (typeof value === "string" && value.trim() !== "") return isFinite(Number(value));
  return false;
}

function scoreBearingStatus(match) {
  const status = String((match && (match.status || match.providerStatus)) || "").toUpperCase();
  return LIVE_STATUSES.indexOf(status) !== -1 || FINISHED_STATUSES.indexOf(status) !== -1;
}

/** Maçın canlı skor alanında görünme hakkı var mı? */
function hasPublishedScore(match) {
  if (!match || typeof match !== "object") return false;
  const score = match.score;
  if (!score || typeof score !== "object") return false;
  if (!isScoreNumber(score.home) || !isScoreNumber(score.away)) return false;
  return scoreBearingStatus(match);
}

/** Veri katmanı süzgeci: skoru olmayan maç dönen diziye HİÇ girmez. */
function filterScoredMatches(list) {
  return (Array.isArray(list) ? list : []).filter(hasPublishedScore);
}

module.exports = {
  FINISHED_STATUSES,
  LIVE_STATUSES,
  filterScoredMatches,
  hasPublishedScore
};
