/**
 * OYUNCU PROFİLİ DOLULUK ORANI — TEK TANIM.
 *
 * `sync-turkish-player-profiles.mjs` iki yerde `profileCompleteness` alanını
 * OKUYORDU ama bu alanı HİÇBİR YER YAZMIYORDU:
 *
 *   --incomplete-profiles  ->  Number(undefined) >= 85  ->  hep false
 *                              yani süzgeç kimseyi elemiyordu, bayrak ölüydü.
 *   raporun averageCompleteness alanı  ->  Number(undefined || 0)  ->  hep 0
 *                              yani her koşuda "ortalama doluluk %0" yazıyordu.
 *
 * İkincisi daha zararlı: otomatik rapor, gerçekle ilgisi olmayan bir sayıyı
 * ölçülmüş bir değer gibi sunuyordu. Doluluk oranı uydurulacak bir şey değil,
 * kayıttan TÜRETİLİR — bu yüzden dosyada saklanan bir alan değil, hesaplanan
 * bir fonksiyon olarak duruyor. Saklansaydı, mevki grubunda yaşandığı gibi,
 * eski değer düzeltilmiş kuralı gölgelerdi.
 *
 * Ölçülen alanlar, haftalık derin zenginleştirmenin doldurabildikleriyle
 * sınırlı: sağlayıcının hiç vermediği bir alanı puanlamak, hiçbir zaman
 * kapanmayacak bir açık üretirdi.
 */

/** Profil kimliğini oluşturan alanlar; hepsi eşit ağırlıklı. */
const PROFILE_FIELDS = Object.freeze([
  "name",
  "currentTeam",
  "position",
  "photo",
  "birthDate",
  "nationality",
  "height",
  "number"
]);

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "object") {
    // Fotoğraf alanı hem düz metin hem { url } nesnesi olabiliyor.
    if (typeof value.url === "string") return value.url.trim() !== "";
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

/**
 * @param {object} player kanonik oyuncu kaydı
 * @returns {number} 0-100 arası tam sayı
 */
function profileCompleteness(player) {
  if (!player || typeof player !== "object") return 0;
  const filled = PROFILE_FIELDS.filter((field) => hasValue(player[field])).length;
  return Math.round((filled / PROFILE_FIELDS.length) * 100);
}

/** Hangi alanların eksik olduğunu döndürür; raporlama ve hata ayıklama için. */
function missingProfileFields(player) {
  if (!player || typeof player !== "object") return [...PROFILE_FIELDS];
  return PROFILE_FIELDS.filter((field) => !hasValue(player[field]));
}

module.exports = { PROFILE_FIELDS, profileCompleteness, missingProfileFields };
