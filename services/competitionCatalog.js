const competitions = require("../data/competitions.json");

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function findCompetition(value) {
  const key = normalizeKey(value);
  if (!key || key === "all" || key === "tumu") {
    return null;
  }

  return competitions.find((competition) => {
    const providers = competition.providers || {};
    return [
      competition.id,
      competition.name,
      ...(competition.aliases || []),
      providers.apiFootball,
      providers.footballData
    ].some((candidate) => normalizeKey(candidate) === key);
  }) || null;
}

/**
 * SAĞLAYICININ SAYISAL LİG KİMLİĞİYLE DOĞRUDAN EŞLEŞME.
 *
 * Bu, sistemdeki EN GÜVENİLİR eşleşme yolu: API-Football her fikstürde bir
 * `league.id` döndürür ve bu sayı hiçbir yazım/takma ad belirsizliğine
 * açık değildir — "Premier League" adında iki farklı yarışma olsa bile
 * kimlikleri asla çakışmaz. `findCompetition`/`matchesCompetition` ada göre
 * çalışır ve çok anlamlı adlarda (`AMBIGUOUS_COMPETITION_NAMES`) bilerek
 * geri çekilir; kimlik varken bu geri çekilmeye hiç gerek kalmaz.
 */
function findCompetitionByProviderId(providerId, providerName = "apiFootball") {
  if (providerId === null || providerId === undefined || providerId === "") {
    return null;
  }
  const key = String(providerId);
  return competitions.find((competition) => {
    const value = competition.providers && competition.providers[providerName];
    return value !== null && value !== undefined && String(value) === key;
  }) || null;
}

function matchesCompetition(value, competitionValue) {
  const competition = typeof competitionValue === "object"
    ? competitionValue
    : findCompetition(competitionValue);
  const key = normalizeKey(value);

  if (!competition || !key) {
    return false;
  }

  const providers = competition.providers || {};
  return [
    competition.id,
    competition.name,
    ...(competition.aliases || []),
    providers.apiFootball,
    providers.footballData
  ].some((candidate) => normalizeKey(candidate) === key);
}

function providerLeagueValue(value, providerName) {
  const key = normalizeKey(value);
  if (!key || key === "all" || key === "tumu") {
    return "";
  }

  const competition = findCompetition(value);
  if (!competition) {
    return value;
  }

  if (providerName === "api-football") {
    return competition.providers.apiFootball || "";
  }

  if (providerName === "football-data" || providerName === "football") {
    return competition.providers.footballData;
  }

  return competition.name;
}

const FRIENDLY_COMPETITION_IDS = new Set(["hazirlik-maci"]);

/**
 * ÇOK ANLAMLI YARIŞMA ADLARI — TAKMA AD EŞLEŞTİRMESİNİN KÖR NOKTASI.
 *
 * "Primera División" bu katalogda La Liga'nın takma adı ve bu DOĞRU: İspanya
 * ligi resmen öyle anılıyor. Ama aynı ad Uruguay, Venezuela, Şili, Bolivya
 * ve daha birçok ülkenin birinci ligi için de kullanılıyor.
 *
 * Sonuç depoda görünür oldu: sağlayıcıdan "Primera División" adıyla gelen
 * 53 maç `competitionId: "la-liga"` damgasıyla kaydedildi. Bolivya'daki
 * "ABB - Guabirá" karşılaşması sistemde İspanya La Liga'sı sayılıyor —
 * lig etiketi yanlış, lig formu yanlış, ana sayfadaki önceliği yanlış.
 *
 * Kural: çok anlamlı ad TEK BAŞINA yarışmayı belirlemez. Kaydın kimliği
 * ancak kanonik adla ÖRTÜŞÜYORSA kabul edilir. Takma ad kullanmak sorun
 * değil — "Trendyol Süper Lig" ile "Süper Lig" aynı yarışmadır; sorun,
 * hangi ülkenin ligi olduğunu ayırt edemediğimiz addır.
 *
 * Belirsizken yanlış yarışmayı seçmektense "tanımıyorum" demek doğrudur.
 */
const AMBIGUOUS_COMPETITION_NAMES = new Set([
  "Primera División",
  "Primera Division",
  "Premier Division",
  "Primera A",
  "Liga Profesional",
  // "Premier League" adını İngiltere dışında da onlarca lig taşıyor
  // (data/fixture-calendar.json'da tek başına 5 farklı `providerLeagueId`
  // ile görülüyor: Uganda, Belize, Hong Kong...). İngiltere'nin gerçek maçları
  // sağlayıcı lig kimliğiyle (39) zaten çözülüyor; bu satır yalnızca AD
  // eşleşmesiyle yanlış ülkeye atanmayı engelliyor.
  "Premier League",
  // "Serie A" da aynı sorunu taşıyor: İtalya (135) ile Brezilya (71) aynı
  // ada sahip, adla çözüm ikisini ayıramaz.
  "Serie A",
  // "Bundesliga" Almanya (78) ve Avusturya (218) liglerinin ORTAK adı.
  // Ad üzerinden çözüm ikisini ayıramadığı için Avusturya Bundesliga'sının
  // maçları (Grazer AK, Austria Lustenau, Wolfsberger AC...) Alman
  // Bundesliga'sı diye sicile giriyor, maç sayfası "Bundesliga" başlığı ve
  // Alman Bundesliga puan durumu bağlantısıyla yayınlanıyordu. Almanya'nın
  // gerçek maçları sağlayıcı lig kimliğiyle (78) zaten çözülüyor.
  "Bundesliga"
].map(normalizeKey));

/** Ad, ülkeyi ayırt etmeye yetmeyen türden mi? */
function isAmbiguousCompetitionName(value) {
  return AMBIGUOUS_COMPETITION_NAMES.has(normalizeKey(value));
}

/**
 * DOĞRULANMIŞ YARIŞMA KİMLİĞİ.
 *
 * Kaydın `competitionId` alanı varsa kullanılır — ama `league` metni çok
 * anlamlı bir adsa ve kanonik adla örtüşmüyorsa kayıt kendi içinde
 * çelişiyor demektir ve kimlik reddedilir. Kimlik yoksa ad üzerinden
 * çözülür; ad çok anlamlıysa çözülmez.
 *
 * Boş dize "bu yarışmayı tanımıyorum" demektir, "yarışma yok" değil.
 */
function resolveCompetitionId(match) {
  // EN GÜVENİLİR YOL ÖNCE DENENİR: sağlayıcının sayısal lig kimliği varsa
  // ad hiç okunmaz. Bu, çok anlamlı bir adın (ör. "Primera División") ID
  // taşıyan bir kayıtta bile reddedilme riskini ortadan kaldırır.
  const byProviderId = findCompetitionByProviderId(match && match.providerLeagueId);
  if (byProviderId) {
    return byProviderId.id;
  }

  const leagueName = normalizeKey(match && match.league);
  const ambiguous = AMBIGUOUS_COMPETITION_NAMES.has(leagueName);

  const declared = normalizeKey(match && match.competitionId);
  if (declared) {
    if (!ambiguous) return declared;
    const canonical = findCompetition(declared);
    const canonicalName = normalizeKey(canonical && canonical.name);
    return canonicalName && canonicalName === leagueName ? declared : "";
  }

  if (ambiguous) return "";
  const found = findCompetition(match && match.league);
  return found ? normalizeKey(found.id) : "";
}

/**
 * Single shared classifier so a friendly never gets counted as league form
 * and a European/cup result never gets the full weight of a league result
 * — used by both the match-analysis generator (fixture normalization) and
 * matchContextService (form weighting) so the two can never disagree.
 */
function classifyFixtureCompetition(match) {
  const normalizedId = normalizeKey(match && match.competitionId);

  if (FRIENDLY_COMPETITION_IDS.has(normalizedId) || normalizeKey(match && match.league).includes("hazirlik")) {
    return { competitionType: "friendly", isOfficialCompetition: false, includeInLeagueForm: false };
  }

  // Kimlik DOĞRULANARAK çözülür: çok anlamlı bir ad yüzünden yanlış ligin
  // formuna yazılan maç, o ligin tablosunu sessizce bozar. Bolivya'daki bir
  // karşılaşma La Liga formuna sayılmamalı.
  const resolvedId = resolveCompetitionId(match);
  const competition = resolvedId ? findCompetition(resolvedId) : null;
  if (!competition) {
    return { competitionType: "cup", isOfficialCompetition: true, includeInLeagueForm: false };
  }

  if (competition.type === "friendly") {
    return { competitionType: "friendly", isOfficialCompetition: false, includeInLeagueForm: false };
  }

  if (competition.type === "continental") {
    return { competitionType: "europe", isOfficialCompetition: true, includeInLeagueForm: false };
  }

  return { competitionType: "league", isOfficialCompetition: true, includeInLeagueForm: true };
}

module.exports = {
  competitions,
  findCompetition,
  findCompetitionByProviderId,
  matchesCompetition,
  normalizeKey,
  providerLeagueValue,
  classifyFixtureCompetition,
  isAmbiguousCompetitionName,
  resolveCompetitionId
};
