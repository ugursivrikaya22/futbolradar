/**
 * "BUGÜNKÜ MAÇLAR HANGİ KANALDA" SAYFASININ SEÇİM KURALI.
 *
 * Sayfa kasıtlı olarak DAR kapsamlı: Süper Lig, dört büyük kulüp (hangi
 * turnuvada oynarlarsa oynasınlar) ve büyük Avrupa yarışmaları/ligleri.
 * Kural burada tek yerde — sayfa üreticisi yalnızca çağırır, kendi süzgeç
 * mantığını taşımaz.
 *
 * YAYIN KANALI UYDURULMAZ. `match.broadcast` sağlayıcıdan (TheSportsDB
 * `strTVStation`) geliyor ve çoğu maçta boş — bu BEKLENEN bir durum, arıza
 * değil. Kanal bilinmiyorsa alan boş dize döner; sayfa bunu "henüz
 * açıklanmadı" gibi nötr bir ifadeyle gösterir, asla bir kanal adı tahmin
 * etmez.
 */
const { resolveCompetitionId, findCompetition } = require("./competitionCatalog.js");
const { sameClub } = require("./superLigTeams.js");
const { istanbulDay, kickoffMs } = require("./matchStatus.js");
const broadcastVerifications = require("../data/broadcast-verifications.json");

function verifiedBroadcast(match) {
  if (!match) return null;
  const ids = [match.id, match.fixtureId, match.providerId, match.providerIds && match.providerIds.apiFootball].map(String);
  return broadcastVerifications.find(record => istanbulDay(match.kickoff) === record.date &&
    (ids.includes(record.providerId) || (sameClub(match.homeTeam, record.homeTeam) && sameClub(match.awayTeam, record.awayTeam)))) || null;
}

function applyVerifiedBroadcast(match) {
  const record = verifiedBroadcast(match);
  if (!record) return match;
  return { ...match, broadcast: { ...(typeof match.broadcast === "object" ? match.broadcast : {}), turkey: record.turkey },
    broadcastSourceUrl: record.sourceUrl, broadcastVerifiedAt: record.verifiedAt };
}

/** Öncelikli turnuva kimlikleri — data/competitions.json'daki `id` alanı. */
const PRIORITY_COMPETITION_IDS = Object.freeze([
  "super-lig",
  "sampiyonlar-ligi",
  "avrupa-ligi",
  "premier-league",
  "la-liga",
  "serie-a",
  "bundesliga"
]);

/** Turnuvadan bağımsız her zaman gösterilecek dört büyük kulüp. */
const PRIORITY_CLUBS = Object.freeze(["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor"]);

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return "";
}

function involvesPriorityClub(match) {
  return PRIORITY_CLUBS.some((club) => sameClub(club, match.homeTeam) || sameClub(club, match.awayTeam));
}

/**
 * `resolveCompetitionId` bazen sağlayıcı numarasıyla ÇELİŞEN, önceden
 * senkronda yazılmış bir `competitionId`ye güvenir (bkz. Uganda'nın
 * "Premier League"i — kayıtta `competitionId: "premier-league"` duruyor
 * ama `providerLeagueId: "585"`, İngiltere'nin 39 değil). Kayıt gerçek bir
 * sağlayıcı lig numarası taşıyorsa o numara katalogdaki BEKLENEN numarayla
 * eşleşmek ZORUNDA; eşleşmiyorsa çözülmüş kimlik reddedilir. Numara yoksa
 * (elle girilmiş kayıt) çözülen kimliğe güvenilir.
 */
function isPriorityCompetition(match) {
  const id = resolveCompetitionId(match);
  if (!id || !PRIORITY_COMPETITION_IDS.includes(id)) return false;

  const providerLeagueId = match && match.providerLeagueId;
  if (providerLeagueId === undefined || providerLeagueId === null || providerLeagueId === "") return true;

  const competition = findCompetition(id);
  const expected = competition && competition.providers && competition.providers.apiFootball;
  if (expected === undefined || expected === null) return true;

  return String(providerLeagueId) === String(expected);
}

/** Sayfanın gösterme kuralı: öncelikli turnuva OYA dört büyükten biri sahada. */
function isPriorityMatch(match) {
  if (!match || typeof match !== "object") return false;
  return isPriorityCompetition(match) || involvesPriorityClub(match);
}

/**
 * Bugünün öncelikli maçları, başlama saatine göre kronolojik.
 *
 * `today` verilmezse Europe/Istanbul takvim günü kullanılır — sitenin geri
 * kalanıyla aynı gün sınırı (services/matchStatus.js#istanbulDay).
 */
function selectBroadcastMatches(matches, options = {}) {
  const today = text(options.today) || istanbulDay(new Date().toISOString());
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => match && typeof match === "object" && istanbulDay(match.kickoff) === today)
    .filter(isPriorityMatch)
    .sort((left, right) => (kickoffMs(left) ?? 0) - (kickoffMs(right) ?? 0));
}

/**
 * Yayın kanalı — YALNIZCA sağlayıcı verdiyse. `broadcast` ya düz bir dize
 * ya da `{ turkey, ... }` biçiminde ülke bazlı bir nesne olabilir
 * (bkz. data/matches.json). Türkiye'deki okuyucu için Türkiye kanalı
 * öncelikli; yoksa boş dize döner ve sayfa bunu uydurmaz.
 */
function broadcastChannel(match) {
  const verified = verifiedBroadcast(match);
  if (verified) return verified.turkey;
  const broadcast = match && match.broadcast;
  if (!broadcast) return "";
  if (typeof broadcast === "string") return text(broadcast);
  if (typeof broadcast === "object") return text(broadcast.turkey) || text(broadcast.tr) || "";
  return "";
}

/** Turnuvanın kanonik görünen adı; katalogda yoksa kayıttaki ham ad. */
function competitionDisplayName(match) {
  const id = resolveCompetitionId(match);
  const competition = id ? findCompetition(id) : null;
  return (competition && competition.name) || text(match && match.league) || "";
}

module.exports = {
  applyVerifiedBroadcast,
  verifiedBroadcast,
  PRIORITY_CLUBS,
  PRIORITY_COMPETITION_IDS,
  broadcastChannel,
  competitionDisplayName,
  isPriorityMatch,
  selectBroadcastMatches
};
