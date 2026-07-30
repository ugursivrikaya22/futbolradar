/**
 * ANA SAYFA EDİTORYAL ÖNCELİĞİ
 *
 * Kahraman (hero) alanındaki maç, sağlayıcının döndürdüğü sıraya göre
 * seçilemez. Sağlayıcı listeyi lig kimliğine ya da başlama saatine göre
 * veriyor; sonuç olarak Türk takımının oynadığı bir maç varken ana sayfada
 * ilgisiz bir karşılaşma büyük gösteriliyordu.
 *
 * KURAL (yayın kararı, veri kararı değil):
 *   1. Türk takımı olan maç HER ZAMAN önce gelir — hazırlık maçı olsa bile.
 *   2. Aynı gruptaki maçlar arasında canlı olan öne çıkar, sonra başlayacak,
 *      en son tamamlanan.
 *   3. Türk takımı hiç yoksa küresel devlerin (Real Madrid, Bayern, Barcelona
 *      gibi) maçı öne çıkar.
 *   4. Kalan eşitlik başlama saatiyle çözülür: yaklaşan maçlarda en yakın,
 *      tamamlananlarda en yeni.
 *
 * İKİZİ: app.js -> `TURKISH_CLUB_NAMES` / `GLOBAL_TOP_CLUBS` /
 * `matchEditorialRank`. Tarayıcı tarafı bu dosyayı içe aktaramadığı için aynı
 * listeler orada da duruyor; `scripts/test-editorial-priority.mjs` ikisinin
 * birebir aynı kaldığını doğrular.
 */

/**
 * Türk kulüpleri. Süper Lig kadrosu `data/super-lig-fixtures.json` üzerinden
 * doğrulanmış; liste ayrıca alt liglerden ve hazırlık maçlarında ana sayfaya
 * düşebilen kulüpleri de kapsar. Eşleşme normalleştirilmiş ad İÇİNDE arama
 * yapar, böylece "Fenerbahce SK" ya da "İstanbul Başakşehir FK" gibi
 * sağlayıcı yazımları da yakalanır.
 */
const TURKISH_CLUB_NAMES = [
  "adana demirspor",
  "alanyaspor",
  "amed",
  "ankaragucu",
  "antalyaspor",
  "bandirmaspor",
  "basaksehir",
  "besiktas",
  "bodrum",
  "boluspor",
  "caykur rizespor",
  "corum",
  "denizlispor",
  "erzurumspor",
  "esenler erokspor",
  "eyupspor",
  "fatih karagumruk",
  "fenerbahce",
  "galatasaray",
  "gaziantep",
  "genclerbirligi",
  "giresunspor",
  "goztepe",
  "hatayspor",
  "igdir",
  "istanbulspor",
  "karagumruk",
  "kasimpasa",
  "kayserispor",
  "kecioengucu",
  "keciorengucu",
  "kocaelispor",
  "konyaspor",
  "manisa",
  "pendikspor",
  "rizespor",
  "sakaryaspor",
  "samsunspor",
  "sanliurfaspor",
  "sariyer",
  "sivasspor",
  "trabzonspor",
  "umraniyespor",
  "vanspor"
];

/** Millî takım adlarının olası yazımları. */
const TURKISH_NATIONAL_TEAM_NAMES = ["turkiye", "turkey"];

/**
 * Küresel devler: Türk takımı yokken kahraman alanını hak eden kulüpler.
 * Liste editoryal bir tercihtir, bir sıralama ya da güç ölçüsü değildir.
 */
const GLOBAL_TOP_CLUBS = [
  "ajax",
  "arsenal",
  "atletico madrid",
  "barcelona",
  "bayer leverkusen",
  "bayern",
  "benfica",
  "borussia dortmund",
  "chelsea",
  // "inter" tek başına yazılmıyor: "Inter Turku" (Finlandiya) da eşleşiyordu.
  // Küresel deve yanlışlıkla öncelik vermektense, adı tam yazılmadığında
  // önceliği kaçırmak tercih edilir.
  "inter milan",
  "internazionale",
  "juventus",
  "liverpool",
  "manchester city",
  "manchester united",
  "marseille",
  "milan",
  "napoli",
  "newcastle united",
  "paris saint germain",
  "porto",
  "psg",
  "real madrid",
  "roma",
  "sevilla",
  "tottenham"
];

const LIVE_STATES = ["LIVE", "IN_PLAY", "1H", "2H", "ET", "HT", "HALFTIME", "PAUSED", "BREAK"];
const UPCOMING_STATES = ["SCHEDULED", "TIMED", "NOT_STARTED", "NS", "PST", "POSTPONED"];
const FINISHED_STATES = ["FINISHED", "FT", "AET", "PEN"];

/** Türkçe karakterleri katlayan sade normalleştirme. */
function normalizeName(value) {
  return String(value == null ? "" : value)
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Sözcük dizisi eşleşmesi — düz alt dize araması DEĞİL.
 *
 * "roma" alt dize olarak arandığında "Romania"yı, "amed" ise "Mohamed"i
 * yakalıyordu. Eşleşme artık tam sözcük dizisi üzerinden yapılıyor:
 * "Çaykur Rizespor" -> [caykur, rizespor] dizisi "rizespor" sözcüğünü
 * içerdiği için eşleşir, "romania" ise "roma" sözcüğünü içermediği için
 * eşleşmez.
 */
function includesAny(name, needles) {
  const words = normalizeName(name).split(" ").filter(Boolean);
  if (!words.length) return false;

  return needles.some((needle) => {
    // Aranan ad da normalleştirilir: listeye tireli ya da büyük harfli bir
    // yazım girdiğinde sessizce eşleşmemesin.
    const parts = normalizeName(needle).split(" ").filter(Boolean);
    if (!parts.length) return false;
    for (let start = 0; start + parts.length <= words.length; start += 1) {
      let matched = true;
      for (let offset = 0; offset < parts.length; offset += 1) {
        if (words[start + offset] !== parts[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
    return false;
  });
}

/**
 * Türk kulübü mü?
 *
 * Açık listeye ek olarak "-spor" sonekini de kabul eder: Türk kulüp adlarında
 * çok yaygın bir ek (Trabzonspor, Ümraniyespor, Boluspor) ve listeye hiç
 * girmemiş bir alt lig takımı hazırlık maçında ana sayfaya düştüğünde onu da
 * yakalar. Sonek kontrolü "Sporting" / "Sport" gibi adlarla çakışmaz, çünkü
 * sözcüğün SONUNA bakar.
 */
function isTurkishTeam(name) {
  if (!name) return false;
  if (includesAny(name, TURKISH_CLUB_NAMES)) return true;

  const normalized = normalizeName(name);
  if (TURKISH_NATIONAL_TEAM_NAMES.includes(normalized)) return true;

  return normalized.split(" ").some((word) => word.length > 4 && word.endsWith("spor"));
}

function isGlobalTopClub(name) {
  return includesAny(name, GLOBAL_TOP_CLUBS);
}

function matchStatus(match) {
  return String((match && (match.status || match.providerStatus)) || "").toUpperCase();
}

function hasTurkishTeam(match) {
  return isTurkishTeam(match && match.homeTeam) || isTurkishTeam(match && match.awayTeam);
}

function hasGlobalTopClub(match) {
  return isGlobalTopClub(match && match.homeTeam) || isGlobalTopClub(match && match.awayTeam);
}

function statusRank(match) {
  const status = matchStatus(match);
  if (LIVE_STATES.includes(status) || (match && match.live === true)) return 0;
  if (FINISHED_STATES.includes(status)) return 2;
  if (UPCOMING_STATES.includes(status) || !status) return 1;
  return 1;
}

/**
 * Sıralama anahtarı. Küçük olan öne gelir.
 *
 * @returns {{turkish:number,status:number,elite:number,time:number,kickoff:string}}
 */
function matchEditorialRank(match) {
  const status = statusRank(match);
  const kickoff = String((match && (match.kickoff || match.utcDate || match.date)) || "");
  const stamp = Date.parse(kickoff);
  const time = Number.isFinite(stamp) ? stamp : Number.MAX_SAFE_INTEGER;

  return {
    turkish: hasTurkishTeam(match) ? 0 : 1,
    status,
    elite: hasGlobalTopClub(match) ? 0 : 1,
    // Yaklaşan/canlı maçta en yakın saat önce; tamamlanan maçta en YENİ önce.
    time: status === 2 ? -time : time,
    kickoff
  };
}

function compareByEditorialPriority(left, right) {
  const a = matchEditorialRank(left);
  const b = matchEditorialRank(right);
  return a.turkish - b.turkish ||
    a.status - b.status ||
    a.elite - b.elite ||
    a.time - b.time ||
    String(a.kickoff).localeCompare(String(b.kickoff));
}

/** Listeyi editoryal önceliğe göre sıralar (girdi değiştirilmez). */
function sortByEditorialPriority(matches) {
  return (Array.isArray(matches) ? matches.slice() : []).sort(compareByEditorialPriority);
}

/** Kahraman alanına çıkacak tek maç. */
function selectHeroMatch(matches) {
  return sortByEditorialPriority(matches)[0] || null;
}

module.exports = {
  GLOBAL_TOP_CLUBS,
  TURKISH_CLUB_NAMES,
  TURKISH_NATIONAL_TEAM_NAMES,
  compareByEditorialPriority,
  hasGlobalTopClub,
  hasTurkishTeam,
  isGlobalTopClub,
  isTurkishTeam,
  matchEditorialRank,
  normalizeName,
  selectHeroMatch,
  sortByEditorialPriority
};
