/**
 * PER-90 NORMALİZASYON + "SIFIR" TUZAĞI.
 *
 * Kadro senkronundan gelen kayıtların büyük kısmında gol, asist, dakika ve
 * maç sayısı harfiyen 0 olarak SAKLI — çünkü sağlayıcı kadro uç noktası hiç
 * performans verisi döndürmüyor ve normalizePlayer eksik alanı 0 ile
 * dolduruyor (bkz. services/cardCredibility.js). Bu sayı "oynadı, atamadı"
 * ile "hiç ölçülmedi" arasında ayrım taşımıyor.
 *
 * cardCredibility.statsAreVerified() bu ayrımı zaten çözüyor: açık bir
 * ölçüm işareti YA DA gerçekten oynanmış olduğunun (appearances/minutes>0)
 * kanıtı yoksa kayıt "ölçülmedi" sayılır. Bu modül aynı kararı üstüne
 * kurup ham sayıyı per-90'a çevirir — YALNIZCA karar "ölçüldü" dediğinde.
 */
const { statsAreVerified, ratingIsVerified } = require("./cardCredibility");

/** Ham değeri 90 dakikaya normalize eder. Dakika yoksa/0 ise null döner. */
function per90(rawValue, minutesPlayed) {
  const value = Number(rawValue);
  const minutes = Number(minutesPlayed);
  if (!Number.isFinite(value) || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round((value / minutes) * 90 * 100) / 100;
}

/** Sayım istatistiği yalnızca doğrulanmışsa döner; aksi hâlde null. */
function verifiedCountingValue(player, rawValue) {
  if (!statsAreVerified(player)) return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

/** Derecelendirme/radar değeri yalnızca doğrulanmışsa döner; aksi hâlde null. */
function verifiedRatingValue(player, rawValue) {
  if (!ratingIsVerified(player)) return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

/**
 * Bir oyuncunun gol/asist per-90 değerleri. İstatistik doğrulanmamışsa
 * ikisi de null — 0 basmak "ölçüldü ve üretmedi" iddiasına dönüşür.
 */
function playerPer90Stats(player) {
  if (!statsAreVerified(player)) {
    return { goalsPer90: null, assistsPer90: null };
  }

  const minutes = Number((player && (player.minutesPlayed ?? player.minutes)) ?? NaN);
  return {
    goalsPer90: per90(player && player.goals, minutes),
    assistsPer90: per90(player && player.assists, minutes)
  };
}

module.exports = {
  per90,
  verifiedCountingValue,
  verifiedRatingValue,
  playerPer90Stats
};
