/**
 * MAÇ SEO MOTORU — ÖNEM VE SIRALAMA KURALI.
 *
 * "Önemli maç" tanımı burada tek yerde: bir Türk takımı sahadaysa YA DA
 * karşılaşma `COMPETITION_PRIORITY_ORDER` listesindeki bir turnuvadaysa
 * sayfa üretilir. İstenen sıra tam olarak şu: Türk takımları → Süper Lig →
 * Şampiyonlar Ligi → Avrupa Ligi → Konferans Ligi → Premier League →
 * La Liga → Serie A → Bundesliga.
 *
 * DOĞRULAMA KOPYALANMADI, YENİDEN KULLANILDI: `resolveCompetitionId` bazen
 * yalnızca AD üzerinden çözer (ör. Uganda'nın da "Premier League" adlı bir
 * ligi var) ve kayıt gerçek bir sağlayıcı lig numarası taşıyorsa bu numara
 * katalogdaki BEKLENEN numarayla uyuşmuyorsa çözülen kimlik yanlıştır. Bu
 * çapraz kontrol services/broadcastSchedule.js#isPriorityCompetition'da
 * zaten var; aynı hatayı burada tekrar yaşamamak için birebir aynı kural
 * uygulanır (kopya değil, aynı `data/competitions.json` alanları okunur).
 */

const { resolveCompetitionId, findCompetition } = require("./competitionCatalog.js");
const { sameClub, fixtureTeamNames } = require("./superLigTeams.js");
const { kickoffMs } = require("./matchStatus.js");

/** Kullanıcının istediği sıra — sayfa üretimi ve sıralama bundan türer. */
const COMPETITION_PRIORITY_ORDER = Object.freeze([
  "super-lig",
  "sampiyonlar-ligi",
  "avrupa-ligi",
  "konferans-ligi",
  "premier-league",
  "la-liga",
  "serie-a",
  "bundesliga"
]);

let turkishTeamNamesCache = null;
function turkishTeamNames() {
  if (!turkishTeamNamesCache) {
    turkishTeamNamesCache = fixtureTeamNames();
  }
  return turkishTeamNamesCache;
}

/** Süper Lig'de bu sezon doğrulanmış oynayan bir kulüp mü? */
function isTurkishTeamName(name) {
  if (!name) return false;
  const names = turkishTeamNames();
  for (const candidate of names) {
    if (sameClub(candidate, name)) return true;
  }
  return false;
}

function involvesTurkishTeam(match) {
  return isTurkishTeamName(match && match.homeTeam) || isTurkishTeamName(match && match.awayTeam);
}

/**
 * `resolveCompetitionId` bazen sağlayıcı numarasıyla ÇELİŞEN, önceden
 * senkronda yazılmış bir `competitionId`ye güvenir. Kayıt gerçek bir
 * sağlayıcı lig numarası taşıyorsa o numara katalogdaki BEKLENEN numarayla
 * eşleşmek ZORUNDA; eşleşmiyorsa çözülmüş kimlik reddedilir. Numara yoksa
 * çözülen kimliğe güvenilir. (services/broadcastSchedule.js ile aynı kural.)
 */
function verifiedCompetitionId(match) {
  const id = resolveCompetitionId(match);
  if (!id) return "";

  const providerLeagueId = match && match.providerLeagueId;
  if (providerLeagueId === undefined || providerLeagueId === null || providerLeagueId === "") return id;

  const competition = findCompetition(id);
  const expected = competition && competition.providers && competition.providers.apiFootball;
  if (expected === undefined || expected === null) return id;

  return String(providerLeagueId) === String(expected) ? id : "";
}

/** Öncelik sırasındaki bir turnuvada mı? (0 = en öncelikli.) */
function priorityRank(match) {
  const id = verifiedCompetitionId(match);
  if (!id) return -1;
  const index = COMPETITION_PRIORITY_ORDER.indexOf(id);
  return index;
}

function isPriorityCompetition(match) {
  return priorityRank(match) !== -1;
}

/** Yalnızca "önemli" maçlara SEO sayfası üretilir. */
function isImportantMatch(match) {
  if (!match || typeof match !== "object") return false;
  return involvesTurkishTeam(match) || isPriorityCompetition(match);
}

/**
 * Sıralama anahtarı: [türTakımıVar mı (0/1), turnuva sırası, kickoff].
 * Küçük değer = önce gelir.
 */
function importanceSortKey(match) {
  const turkishRank = involvesTurkishTeam(match) ? 0 : 1;
  const rank = priorityRank(match);
  const competitionRank = rank === -1 ? COMPETITION_PRIORITY_ORDER.length : rank;
  const kickoff = kickoffMs(match) ?? Number.MAX_SAFE_INTEGER;
  return [turkishRank, competitionRank, kickoff];
}

function compareByImportance(left, right) {
  const a = importanceSortKey(left);
  const b = importanceSortKey(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function sortByImportance(matches) {
  return [...(Array.isArray(matches) ? matches : [])].sort(compareByImportance);
}

module.exports = {
  COMPETITION_PRIORITY_ORDER,
  compareByImportance,
  involvesTurkishTeam,
  isImportantMatch,
  isPriorityCompetition,
  isTurkishTeamName,
  sortByImportance,
  verifiedCompetitionId
};
