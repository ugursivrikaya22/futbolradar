/**
 * LİGİN ADI — TEK KAYNAK.
 *
 * Türkiye birinci ligi sitede farklı yerlerde farklı yazılıyordu: veri
 * dosyalarında "Süper Lig", fikstür kaydında "Trendyol Süper Lig", SEO
 * başlıklarında bazen biri bazen diğeri. Aynı ligin iki adı olması hem
 * okuyucu için tutarsız hem de arama motoru için iki ayrı varlık gibi
 * görünüyordu.
 *
 * Kural:
 *   • KULLANICIYA GÖRÜNEN her yerde `SUPER_LIG_DISPLAY_NAME` yazılır.
 *   • İÇ ANAHTARLAR (competitionId "super-lig", dosya adları, URL'ler,
 *     sağlayıcı lig kimlikleri) DEĞİŞMEZ. Bunlar adres ve eşleşme
 *     anahtarıdır; sponsor adı değiştiğinde URL'lerin kırılması gerekmez.
 *
 * Sponsor adı sezon sonunda değişirse tek bir sabit güncellenir; veri
 * dosyalarındaki eski yazımlar `isSuperLigName` sayesinde eşleşmeye devam
 * eder ve `displayLeagueName` onları yeni adla gösterir.
 */

/** Kullanıcıya görünen tek doğru ad. */
const SUPER_LIG_DISPLAY_NAME = "Trendyol Süper Lig";

/**
 * Aynı ligi işaret eden yazımlar. Bunlar EŞLEŞME için tanınır ama hiçbiri
 * ekrana yazılmaz — hepsi `SUPER_LIG_DISPLAY_NAME` olarak gösterilir.
 *
 * Liste eski sponsor adlarını da içeriyor: arşiv kayıtlarında ve sağlayıcı
 * yanıtlarında hâlâ geçebiliyorlar.
 */
const SUPER_LIG_NAME_VARIANTS = Object.freeze([
  "Trendyol Süper Lig",
  "Süper Lig",
  "Super Lig",
  "Süper Ligi",
  "Türkiye Süper Ligi",
  "Türk Süper Ligi",
  "Turkiye Super Ligi",
  "Turkcell Süper Lig",
  "Spor Toto Süper Lig",
  "Turkish Super Lig",
  "Turkish Super League",
  "super-lig"
]);

/**
 * Karşılaştırma için sadeleştirme. Türkçe küçültme, aksan ayrıştırma ve
 * harf dışı her şeyin atılması: "Trendyol Süper Lig" ile "trendyol-super-lig"
 * aynı anahtara iner.
 */
function fold(value) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

const VARIANT_KEYS = new Set(SUPER_LIG_NAME_VARIANTS.map(fold));

/** Verilen ad Türkiye birinci ligini mi işaret ediyor? */
function isSuperLigName(value) {
  const key = fold(value);
  if (!key) return false;
  if (VARIANT_KEYS.has(key)) return true;
  // Sponsor adı değişse bile "…süperlig" ile biten yazımlar aynı ligdir.
  // "süperligi" (tamlama eki) de aynı kapıya çıkar.
  return /superlig(i)?$/.test(key);
}

/**
 * Gösterilecek ad. Süper Lig'in herhangi bir yazımı tek doğru ada döner;
 * başka bir lig ise değer olduğu gibi geçer.
 *
 * Sunum katmanı bunu çağırdığı sürece veri dosyalarındaki eski yazımlar
 * ekrana sızmaz.
 */
function displayLeagueName(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return isSuperLigName(raw) ? SUPER_LIG_DISPLAY_NAME : raw;
}

module.exports = {
  SUPER_LIG_DISPLAY_NAME,
  SUPER_LIG_NAME_VARIANTS,
  displayLeagueName,
  isSuperLigName
};
