/**
 * NORMALLEŞTİRİCİ — aynı şeyin farklı yazımlarını tek yazıma indirir.
 *
 * İki sorunu çözer:
 *
 * 1. TÜRKÇE KATLAMA. "Beşiktaş", "BEŞİKTAŞ", "Besiktas" ve "besiktaş" aynı
 *    kulüptür. Türkçe'de büyük/küçük dönüşümü İngilizce'den farklıdır
 *    (I/ı, İ/i); düz `toLowerCase()` "İSTANBUL"u "i̇stanbul" yapar ve
 *    eşleşme kaçar. Bu yüzden katlama açıkça yazılıyor.
 *
 * 2. KULÜP TAKMA ADLARI. Aynı kulüp kaynağa göre "Çaykur Rizespor",
 *    "Rizespor", "Fenerbahçe SK", "Fenerbahce" olabilir. Tekilleştirme
 *    kulüp adına dayandığı için bu, doğrudan yinelenen kayıt üretir.
 *
 * Takma ad tablosu ELLE tutulmuyor: on sekiz Süper Lig kulübünün adı
 * fikstürden (services/superLigTeams.js) geliyor, tablo yalnızca fikstür
 * adına indirgenemeyen kısa kullanımları taşıyor.
 */

/** Türkçe'ye duyarlı küçültme + aksan sadeleştirme. */
function fold(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Kimlik parçası: boşluksuz, tireli. */
function slug(value) {
  return fold(value).replace(/\s+/g, "-");
}

/**
 * Kulüp takma adları → kanonik ad.
 *
 * Yalnızca fikstür adından türetilemeyen kullanımlar. "Galatasaray SK" gibi
 * son ek taşıyanlar ayrıca `stripClubSuffix` ile çözülür, tabloyu şişirmezler.
 */
const CLUB_ALIASES = Object.freeze({
  "fener": "Fenerbahçe",
  "fenerbahce": "Fenerbahçe",
  "fb": "Fenerbahçe",
  "cimbom": "Galatasaray",
  "cim bom": "Galatasaray",
  "gs": "Galatasaray",
  "galatasaray": "Galatasaray",
  "bjk": "Beşiktaş",
  "besiktas": "Beşiktaş",
  "kara kartal": "Beşiktaş",
  "ts": "Trabzonspor",
  "trabzon": "Trabzonspor",
  "firtina": "Trabzonspor",
  "bordo mavili": "Trabzonspor",
  "rizespor": "Çaykur Rizespor",
  "riz": "Çaykur Rizespor",
  "basaksehir": "Başakşehir",
  "medipol basaksehir": "Başakşehir",
  "rams basaksehir": "Başakşehir",
  "kasimpasa": "Kasımpaşa",
  "goztepe": "Göztepe",
  "samsun": "Samsunspor",
  "konya": "Konyaspor",
  "antalya": "Antalyaspor",
  "alanya": "Alanyaspor",
  "kayseri": "Kayserispor",
  "gaziantep": "Gaziantep FK",
  "eyup": "Eyüpspor",
  "kocaeli": "Kocaelispor",
  "genclerbirligi": "Gençlerbirliği",
  "karagumruk": "Fatih Karagümrük",
  "fatih karagumruk": "Fatih Karagümrük",
  // Süper Lig dışı ama haber değeri taşıyan Türk kulüpleri (1. Lig ve
  // ligden düşmüş takımlar). Şartname bunları da kapsıyor.
  "bodrum": "Bodrum FK",
  "bodrumspor": "Bodrum FK",
  "sanliurfa": "Şanlıurfaspor",
  "bandirma": "Bandırmaspor",
  "sakarya": "Sakaryaspor",
  "manisa": "Manisa FK",
  "umraniye": "Ümraniyespor",
  "adana demirspor": "Adana Demirspor",
  "hatayspor": "Hatayspor",
  "sivasspor": "Sivasspor",
  "istanbulspor": "İstanbulspor",
  "pendik": "Pendikspor"
});

/** Kulüp adı sonuna eklenen kurumsal ekler. Kimlikte anlam taşımazlar. */
const CLUB_SUFFIXES = [
  "spor kulubu", "futbol kulubu", "sportif yatirimlar", "a s", "as",
  "sk", "fk", "jk", "kulubu"
];

function stripClubSuffix(folded) {
  let result = ` ${folded} `;
  for (const suffix of CLUB_SUFFIXES) {
    result = result.replace(new RegExp(`\\s${suffix}\\s`, "g"), " ");
  }
  return result.trim();
}

let cachedFixtureNames = null;

/** Fikstürden gelen on sekiz Süper Lig adı. Elle liste tutulmuyor. */
function fixtureClubNames() {
  if (cachedFixtureNames) return cachedFixtureNames;
  try {
    const { fixtureTeamNames } = require("../superLigTeams.js");
    cachedFixtureNames = (fixtureTeamNames() || []).filter(Boolean);
  } catch {
    cachedFixtureNames = [];
  }
  return cachedFixtureNames;
}

/**
 * Bir kulüp adını kanonik biçime çevirir.
 *
 * Sıra: birebir fikstür adı → takma ad tablosu → ek temizlenmiş fikstür
 * eşleşmesi → içeren eşleşme. Hiçbiri tutmazsa GİRDİ AYNEN döner: tanımadığı
 * bir kulübü uydurmaz, yabancı kulüpler de böyle korunur.
 */
function canonicalClub(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const folded = fold(raw);
  if (!folded) return raw;

  const names = fixtureClubNames();

  for (const name of names) {
    if (fold(name) === folded) return name;
  }

  if (CLUB_ALIASES[folded]) return CLUB_ALIASES[folded];

  const stripped = stripClubSuffix(folded);
  if (CLUB_ALIASES[stripped]) return CLUB_ALIASES[stripped];

  for (const name of names) {
    if (stripClubSuffix(fold(name)) === stripped) return name;
  }

  // "galatasaray sk futbol" gibi uzun biçimler: fikstür adını içeriyorsa o.
  for (const name of names) {
    const target = stripClubSuffix(fold(name));
    if (target.length >= 5 && stripped.includes(target)) return name;
  }

  return raw;
}

function isSuperLigClub(value) {
  const canonical = fold(canonicalClub(value));
  if (!canonical) return false;
  return fixtureClubNames().some((name) => fold(name) === canonical);
}

/**
 * TÜRK KULÜBÜ MÜ? — hattın ilgi alanı Süper Lig'den geniştir.
 *
 * Şartname 1. Lig kulüplerini ve Türk kulüplerinden yurt dışına giden
 * oyuncuları da kapsıyor. Yalnızca fikstürdeki on sekiz takıma bakan bir
 * kapı, ligden düşmüş ya da alt ligdeki bir kulübün transferini görmezden
 * gelirdi: Antalyaspor bu sezon Süper Lig'de değil ama transferi haberdir.
 *
 * Küme: fikstür adları ∪ takma ad tablosunun kanonik değerleri.
 */
let cachedTurkishClubs = null;

function turkishClubNames() {
  if (cachedTurkishClubs) return cachedTurkishClubs;
  const names = new Set(fixtureClubNames());
  for (const canonical of Object.values(CLUB_ALIASES)) names.add(canonical);
  cachedTurkishClubs = [...names];
  return cachedTurkishClubs;
}

function isTurkishClub(value) {
  const canonical = fold(canonicalClub(value));
  if (!canonical) return false;
  return turkishClubNames().some((name) => fold(name) === canonical);
}

/** Oyuncu adı: fazla boşluk ve künye artıkları temizlenir. */
function canonicalPlayer(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”‘’-]+|[\s"'“”‘’-]+$/g, "")
    .trim();
}

/**
 * Transfer penceresi: kimliğin dördüncü parçası.
 *
 * Yaz penceresi haziran-eylül, kış penceresi ocak-şubat kabul ediliyor;
 * arada kalan tarihler en yakın pencereye yazılır ki kimlik boş kalmasın.
 */
function transferWindow(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  if (month >= 6 && month <= 9) return `${year}-yaz`;
  if (month <= 2) return `${year}-kis`;
  if (month >= 10) return `${year + 1}-kis`;
  return `${year}-yaz`;
}

/** Sezon etiketi: mevcut veri dosyasıyla aynı biçim ("2026/27"). */
function seasonLabel(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const start = month >= 6 ? year : year - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

module.exports = {
  CLUB_ALIASES,
  CLUB_SUFFIXES,
  canonicalClub,
  canonicalPlayer,
  fixtureClubNames,
  fold,
  isSuperLigClub,
  isTurkishClub,
  turkishClubNames,
  seasonLabel,
  slug,
  stripClubSuffix,
  transferWindow
};
