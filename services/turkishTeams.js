/**
 * TÜRK TAKIMI TESPİTİ
 *
 * Ana sayfanın en büyük kartı (hero) bir Türk takımı maçı varsa onu
 * göstermek zorunda. Bunun için "bu maçta Türk takımı var mı?" sorusunun
 * tek ve doğrulanabilir bir cevabı olmalı; aksi halde her sayfa kendi
 * listesini uydurur ve Trabzonspor'un maçı olduğu gün ekranda bir hazırlık
 * maçı kalabilir.
 *
 * Kapsam üç doğrulanmış kaynaktan birleşir:
 *
 *   1. data/super-lig-fixtures.json — TFF fikstürü. Adı geçen her takım bu
 *      sezon Süper Lig'de; lig kadrosu değiştiğinde liste kendiliğinden
 *      güncellenir.
 *   2. data/teams.json — elle doğrulanmış takım kayıtları (lig/ülke alanı).
 *   3. TURKISH_CLUBS_OUTSIDE_FIXTURE — fikstürde olmayan ama maç verisinde
 *      görünen Türk kulüpleri (küme düşen/1. Lig takımları, hazırlık maçı
 *      rakipleri) ve A Millî Takım.
 *
 * ÖNEMLİ — yanlış pozitif riski: "Turk" içeren her ad Türk değildir.
 * Fikstür takviminde Finlandiya'dan "Inter Turku" var; ad benzerliğine
 * dayanan bir kısayol o maçı Türk maçı sayıp hero kartını yanlış doldurur.
 * Bu yüzden ad benzerliği değil, açık liste + dar bir "-spor" son eki
 * kuralı kullanılır ve şüpheli adlar NON_TURKISH_LOOKALIKES ile elenir.
 */

const fixtures = require("../data/super-lig-fixtures.json");
const teams = require("../data/teams.json");
const { normalizeText } = require("../api/_utils");

/** Süper Lig'i işaret eden lig adları (maçın ligi de kanıt sayılır). */
const TURKISH_LEAGUE_HINTS = ["super lig", "trendyol super lig", "turkiye kupasi", "ziraat turkiye kupasi", "1. lig", "trendyol 1. lig"];

/**
 * Lig adı ipucunu KELİME SINIRIYLA arar.
 *
 * Düz `includes` yetmiyor: Sırbistan'ın "Super Liga"sı "super lig" ipucunu
 * İÇERİYOR ve FK Partizan - OFK Beograd ana sayfada "Canlı Türk takımı maçı"
 * diye öne çıkıyordu. İpucunun ardından harf/rakam gelmemesi şartı, gerçek
 * Türk liglerini ("Super Lig", "Trendyol Super Lig", "1. Lig") elemeden
 * yalnızca bu yanlış eşleşmeyi kesiyor.
 */
function leagueHintMatches(normalized) {
  return TURKISH_LEAGUE_HINTS.some((hint) => {
    const escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(normalized);
  });
}

/** Türkiye'yi işaret eden ülke değerleri (sağlayıcı İngilizce de yazabilir). */
const TURKISH_COUNTRY_VALUES = ["turkiye", "turkey", "turkiye cumhuriyeti", "tur"];

/**
 * Fikstürde yer almayan Türk kulüpleri. Hazırlık maçlarında ve kupa
 * turlarında bu adlar maç verisine giriyor; fikstür listesi tek başına
 * onları kapsamıyor.
 */
const TURKISH_CLUBS_OUTSIDE_FIXTURE = [
  "Türkiye",
  "Ümraniyespor",
  "Adana Demirspor",
  "Antalyaspor",
  "Sivasspor",
  "Kayserispor",
  "Hatayspor",
  "Fatih Karagümrük",
  "İstanbulspor",
  "Pendikspor",
  "Bodrum FK",
  "Sakaryaspor",
  "Boluspor",
  "Manisa FK",
  "MKE Ankaragücü",
  "Ankaragücü",
  "Keçiörengücü",
  "Şanlıurfaspor",
  "Bandırmaspor",
  "Altay",
  "Giresunspor",
  "Denizlispor",
  "Esenler Erokspor",
  "Iğdır FK",
  "Serik Belediyespor",
  "Vanspor FK",
  "Tuzlaspor",
  "Altınordu",
  "Göztepe",
  "Karagümrük",
  "Menemen FK",
  "Sarıyer",
  "Adanaspor",
  "Bucaspor 1928",
  "Yeni Malatyaspor",
  "Kırklarelispor",
  "Somaspor",
  "Balıkesirspor"
];

/**
 * "-spor" son eki güçlü bir Türkçe kulüp işareti, ama körü körüne
 * uygulanamaz. Bu liste, kurala takılabilecek veya "Turk" benzerliği
 * taşıyan yabancı kulüpleri kesin olarak dışarıda tutar.
 */
const NON_TURKISH_LOOKALIKES = [
  "inter turku",
  "fc inter turku",
  "turku palloseura",
  "tps turku",
  "sporting",
  "sporting cp",
  "sporting lisbon",
  "sporting braga",
  "sporting gijon",
  "sport recife",
  "sport boys",
  "sportist",
  "sportul"
];

function key(value) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

let cachedNames = null;

/** Süper Lig fikstüründe adı geçen benzersiz takımlar. */
function fixtureTeamNames() {
  const names = new Set();

  for (const round of fixtures.rounds || []) {
    for (const match of round.matches || []) {
      if (match && match.homeTeam) names.add(String(match.homeTeam).trim());
      if (match && match.awayTeam) names.add(String(match.awayTeam).trim());
    }
  }

  for (const team of fixtures.teams || []) {
    if (team && team.name) names.add(String(team.name).trim());
  }

  return [...names].filter(Boolean);
}

/** teams.json'daki Türk takımları (lig veya ülke alanından doğrulanmış). */
function curatedTurkishTeamNames() {
  return (Array.isArray(teams) ? teams : [])
    .filter((team) => {
      if (!team || !team.name) return false;
      if (TURKISH_COUNTRY_VALUES.includes(key(team.country))) return true;
      return leagueHintMatches(key(team.league));
    })
    .map((team) => String(team.name).trim());
}

/** Tüm kaynakların birleşimi; normalize edilmiş adlardan oluşan küme. */
function turkishTeamNames() {
  if (!cachedNames) {
    cachedNames = new Set(
      [...fixtureTeamNames(), ...curatedTurkishTeamNames(), ...TURKISH_CLUBS_OUTSIDE_FIXTURE]
        .map(key)
        .filter(Boolean)
    );
  }

  return cachedNames;
}

/**
 * Dar "-spor" kuralı: bir sözcük "spor" ile bitiyorsa (Konyaspor,
 * Sivasspor, Rizespor) takım Türk sayılır. "Sporting", "Sport" gibi
 * sözcükler kapsam dışıdır çünkü kural sözcük SONUNU arar, içini değil.
 */
function hasTurkishClubSuffix(normalized) {
  return normalized
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((word) => word.length > 5 && word.endsWith("spor"));
}

/** Takım adı Türk kulübü mü? */
function isTurkishTeamName(name) {
  const normalized = key(name);

  if (!normalized || NON_TURKISH_LOOKALIKES.includes(normalized)) {
    return false;
  }

  if (turkishTeamNames().has(normalized)) {
    return true;
  }

  return hasTurkishClubSuffix(normalized);
}

/** Maçın ligi Türkiye organizasyonu mu? (Süper Lig, Türkiye Kupası…) */
function isTurkishLeague(league) {
  const normalized = key(league);
  return Boolean(normalized) && leagueHintMatches(normalized);
}

/**
 * Maçta Türk takımı var mı? Ev/deplasman adları, sağlayıcının ülke alanı ve
 * lig adı birlikte değerlendirilir — biri yeterlidir.
 */
function isTurkishMatch(match) {
  if (!match) {
    return false;
  }

  if (isTurkishTeamName(match.homeTeam) || isTurkishTeamName(match.awayTeam)) {
    return true;
  }

  const countries = [
    match.homeTeamCountry,
    match.awayTeamCountry,
    match.country,
    match.home && match.home.country,
    match.away && match.away.country
  ];

  if (countries.some((value) => TURKISH_COUNTRY_VALUES.includes(key(value)))) {
    return true;
  }

  return isTurkishLeague(match.league || match.competition);
}

/** Günlüğe yazılacak Türk taraf(lar)ı. Yoksa boş dize. */
function turkishSideOf(match) {
  if (!match) {
    return "";
  }

  const sides = [match.homeTeam, match.awayTeam].filter((name) => isTurkishTeamName(name));

  if (sides.length) {
    return sides.join(" & ");
  }

  return isTurkishMatch(match) ? String(match.league || match.competition || "") : "";
}

module.exports = {
  NON_TURKISH_LOOKALIKES,
  TURKISH_CLUBS_OUTSIDE_FIXTURE,
  TURKISH_COUNTRY_VALUES,
  TURKISH_LEAGUE_HINTS,
  isTurkishLeague,
  isTurkishMatch,
  isTurkishTeamName,
  turkishSideOf,
  turkishTeamNames
};
