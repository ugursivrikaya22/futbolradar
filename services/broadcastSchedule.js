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
const { trSlugFor } = require("./matchSeoPages.js");

/**
 * ELLE YÖNETİLEN YAYIN EŞLEMESİ — `data/yayin-kanallari.json`.
 *
 * Sağlayıcı (`strTVStation`) maçların ezici çoğunluğunda kanal vermiyor.
 * Sonuç, başlığı "…Hangi Kanalda?" diyen bir sayfanın gövdesinde "Henüz
 * açıklanmadı" yazması oluyordu: okuyucu aramadan o vaatle geliyor,
 * cevabı bulamayınca geri dönüyor. Hem dönüşüm hem sıralama kaybı.
 *
 * Dosyanın iki bölümü var:
 *
 *   maclar      — maç slug'ı → kanal listesi. Tek bir karşılaşma için
 *                 kesin bilgi. Sağlayıcıyı da doğrulanmış kaydı da EZER;
 *                 editörün son sözü burasıdır.
 *   varsayilan  — turnuva adı → kanal listesi. Lig yayın hakkından gelen
 *                 genel bilgi. EN SON denenir ve sayfada kaynağı
 *                 saklanmaz: "Lig yayın hakkına göre; kanal değişikliği
 *                 olabilir" notuyla birlikte gösterilir.
 *
 * Ayrım önemli: "tahmin yazmıyoruz" ilkesi korunuyor. Lig varsayılanı bir
 * tahmin değil, yayın hakkı sözleşmesinden gelen bir olgu — ama o maça
 * özel doğrulanmış bir bilgi de değil. Okuyucu ikisini ayırt edebilsin
 * diye kaynak sayfada açıkça yazıyor.
 */
const yayinKanallari = require("../data/yayin-kanallari.json");

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
/** Kanal alanı tek ad ya da liste olabilir; ikisi de temiz diziye iner. */
function channelList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const single = text(value);
  return single ? [single] : [];
}

/** Sağlayıcının bildirdiği kanal — yoksa boş dize. */
function providerChannel(match) {
  const broadcast = match && match.broadcast;
  if (!broadcast) return "";
  if (typeof broadcast === "string") return text(broadcast);
  if (typeof broadcast === "object") return text(broadcast.turkey) || text(broadcast.tr) || "";
  return "";
}

/** Maçın `data/yayin-kanallari.json#maclar` anahtarı — çıkaramazsa boş. */
function broadcastSlug(match) {
  if (!match || !match.homeTeam || !match.awayTeam || !match.kickoff) return "";
  try {
    return trSlugFor(match.homeTeam, match.awayTeam, match.kickoff) || "";
  } catch {
    return "";
  }
}

/**
 * KANAL ÇÖZÜMLEME — sırası ve KAYNAĞI birlikte döner.
 *
 *   1. maclar        elle girilmiş maça özel kayıt
 *   2. verified      `data/broadcast-verifications.json` (kaynak bağlantılı)
 *   3. provider      sağlayıcının bildirdiği kanal
 *   4. varsayilan    lig yayın hakkı — sayfada NOTLA gösterilir
 *   5. ""            hiçbiri yoksa: "Henüz açıklanmadı"
 *
 * `source` alanı çağıranın nereden geldiğini bilmesi için var. Lig
 * varsayılanını maça özel bilgiymiş gibi basmak, tam da kaçındığımız şeyi
 * yapmak olurdu: okuyucuya kesinmiş gibi bir kanal göstermek.
 */
function resolveBroadcastWith(match, mapping) {
  const table = mapping || {};
  const slug = broadcastSlug(match);
  if (slug) {
    const channels = channelList((table.maclar || {})[slug]);
    if (channels.length) return { channels, channel: channels.join(", "), source: "match" };
  }

  const verified = verifiedBroadcast(match);
  const verifiedChannels = verified ? channelList(verified.turkey) : [];
  if (verifiedChannels.length) {
    return { channels: verifiedChannels, channel: verifiedChannels.join(", "), source: "verified" };
  }

  const provider = providerChannel(match);
  if (provider) return { channels: [provider], channel: provider, source: "provider" };

  const defaults = table.varsayilan || {};
  for (const name of [competitionDisplayName(match), text(match && match.league)]) {
    if (!name) continue;
    const channels = channelList(defaults[name]);
    if (channels.length) return { channels, channel: channels.join(", "), source: "league" };
  }

  return { channels: [], channel: "", source: "" };
}

/** Depodaki eşlemeyle çözümleme. Saf sürüm `resolveBroadcastWith`. */
function resolveBroadcast(match) {
  return resolveBroadcastWith(match, yayinKanallari);
}

/**
 * Kesin kanal — lig varsayılanı DAHİL DEĞİL.
 *
 * Bu yüzeyler (ör. "bugünün maçları hangi kanalda" sayfası, sağlayıcı
 * katmanı) kaynağı gösterecek bir yere sahip değil; notsuz bir lig
 * varsayılanı orada tahmin gibi okunur. Notu taşıyabilen yüzeyler
 * `resolveBroadcast` çağırır.
 */
function broadcastChannel(match) {
  const resolved = resolveBroadcast(match);
  return resolved.source === "league" ? "" : resolved.channel;
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
  resolveBroadcast,
  resolveBroadcastWith,
  competitionDisplayName,
  isPriorityMatch,
  selectBroadcastMatches
};
