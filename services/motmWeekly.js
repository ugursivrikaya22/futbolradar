/**
 * BU HAFTANIN EN ÇOK OY ALAN OYUNCULARI — SEÇİM VE BİRLEŞTİRME.
 *
 * Ana sayfa widget'ı son 7 günün maçın adamı oylarını tek listede toplar.
 * Bu modül YALNIZCA seçer ve birleştirir; sayımın nereden okunduğu
 * (`services/motmVoteStore.js`) ve nasıl çizildiği (site.js) buranın işi
 * değil. Sayımlar parametre olarak gelir — böylece testler gerçek Redis'e
 * çıkmadan tüm yolu sınayabilir.
 *
 * UYDURMA YOK, BURADA DA YOK:
 *
 *   • Oy sayısı yalnızca GERÇEK sayımdan gelir. Sayım yoksa satır yoktur;
 *     "0 oy" diye bir satır üretilmez.
 *   • Yüzde, oyuncunun KENDİ MAÇINDAKİ oy payıdır. Farklı maçların oyları
 *     tek havuzda yüzdelenmez: 3 oylu maçın %100'ü ile 300 oylu maçın
 *     %40'ını aynı ölçekte göstermek okuyucuyu yanıltır; bu yüzden hem
 *     mutlak oy hem maç-içi pay birlikte verilir.
 *   • Aynı oyuncu bir haftada iki maçta da oy almış olabilir; satırlar
 *     BİRLEŞTİRİLMEZ, oyuncunun en çok oy aldığı maç gösterilir. İki maçın
 *     oylarını toplamak, hiçbir maçta verilmemiş bir sayı üretmek olurdu.
 *   • Fotoğraf yalnızca lisanslı kaynaktan (playerPhotoService kuralları);
 *     bulunamazsa baş harfler gösterilir, rastgele görsel aranmaz.
 *   • Maç raporu bağlantısı yalnızca raporu GERÇEKTEN üretilmiş maça konur
 *     (`data/post-match-reports.json` kaydı). Var olmayan sayfaya bağlantı
 *     kırık bir söz olurdu.
 *
 * ADAY KÜMESİ anket kurallarının aynısıdır: `buildMotmPoll` ne diyorsa o.
 * Anket hak etmeyen maçın oyu bu listeye de giremez — widget, anketin
 * vitrini; ayrı bir kural kümesi iki yüzeyin ayrışması demek olurdu.
 */

const { buildMotmPoll, foldName, kickoffStamp } = require("./motmPoll");
const { resolvePlayerPhoto } = require("./playerPhotoService");

/** Haftalık pencere. "Bu hafta" iddiası 7 günden fazlasını taşıyamaz. */
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Bir istekte okunacak sayım üst sınırı: uç nokta maç başına bir Redis
 * okuması yapıyor; sınırsız liste sınırsız gecikme demek. En yeni maçlar
 * önce gelir, taşan eskiler düşer. */
const MAX_MATCHES = 16;

/** Widget bir liste değil, vitrin: varsayılan 5, üst sınır 10 satır. */
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

/** Ekran metinleri tek yerde (anket metinleriyle aynı gerekçe). */
const COPY = Object.freeze({
  title: "🏆 Bu Haftanın En Çok Oy Alan Oyuncuları",
  subtitle: "Okuyucuların \"maçın adamı\" oylarıyla öne çıkan isimler. " +
    "Yüzde, oyuncunun kendi maçındaki oy payıdır.",
  kicker: "Maçın Adamı",
  cta: "Maç raporu",
  sectionCta: "Maç sonuçları",
  votesSuffix: "oy",
  votingOpenBadge: "Oylama açık",
  votingClosedBadge: "Sonuç kesin"
});

function text(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

/**
 * Takım adı eşleştirmesi, KAYNAKLAR ARASI. Aynı kulüp veri kaynaklarında
 * farklı yazılıyor ("Midtjylland" / "FC Midtjylland"). Kelime sınırlı
 * içerme kabul edilir; kısa adlarda (<4 harf) içerme kapalıdır ki "FC"
 * gibi bir parça her kulüple eşleşmesin.
 */
function teamsMatch(left, right) {
  const a = foldName(left);
  const b = foldName(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 4) return false;
  return new RegExp(`(^|-)${shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-|$)`).test(longer);
}

/**
 * Kadro adının kısaltılmış anahtarı: "Doğan Alemdar" → "d-alemdar".
 * Oyuncu veri dosyası çoğu kaydı "D. Alemdar" biçiminde tutuyor; iki biçim
 * aynı anahtara katlanır ve fotoğraf eşleşmesi bunun üzerinden yapılır.
 */
function abbreviatedKey(name) {
  const parts = text(name).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return "";
  return foldName(`${parts[0].charAt(0)} ${parts.slice(1).join(" ")}`);
}

/**
 * Oyuncu fotoğrafı dizini. İki anahtar da aynı kayda gider: tam ad ve
 * kısaltılmış ad. ÇAKIŞAN kısaltma (iki kulüpte "d-alemdar") takım adıyla
 * ayrılır; takım tutmuyorsa eşleşme YOK sayılır — yanlış oyuncunun yüzünü
 * basmaktansa baş harf basılır.
 */
function buildPhotoIndex(playersPayload) {
  const list = Array.isArray(playersPayload)
    ? playersPayload
    : (playersPayload && Array.isArray(playersPayload.players) ? playersPayload.players : []);

  const index = new Map();
  for (const player of list) {
    const record = { name: text(player && player.name), team: text(player && player.team), player };
    if (!record.name) continue;
    // Kısaltılmış adda iki anahtar aynı dizeye katlanır ("D. Alemdar" için
    // ikisi de "d-alemdar"); küme aynı kaydın kendi kendisiyle "çakışmasını"
    // önler — gerçek çakışma yalnızca FARKLI kayıtlar arasında olabilir.
    for (const key of new Set([foldName(record.name), abbreviatedKey(record.name)])) {
      if (!key) continue;
      const bucket = index.get(key) || [];
      bucket.push(record);
      index.set(key, bucket);
    }
  }
  return index;
}

/** Fotoğrafı çöz: eşleşme yoksa dürüst yer tutucu (baş harfler). */
function photoFor(photoIndex, playerName, teamName) {
  const keys = [foldName(playerName), abbreviatedKey(playerName)].filter(Boolean);
  for (const key of keys) {
    const bucket = photoIndex.get(key) || [];
    const candidates = bucket.filter((record) => !record.team || !teamName || teamsMatch(record.team, teamName));
    // Takımla ayrıştırılamayan çakışma eşleşme değildir.
    if (candidates.length === 1) {
      const resolved = resolvePlayerPhoto(candidates[0].player);
      if (!resolved.isPlaceholder) {
        return { url: resolved.url, initials: resolved.initials };
      }
    }
  }
  return { url: "", initials: resolvePlayerPhoto({ name: playerName }).initials };
}

/**
 * Kulüp logosu YALNIZCA lisanslı medya sunucusundan ve yalnızca GERÇEK
 * sağlayıcı kimliğiyle türetilir (oyuncu fotoğrafı kuralının aynısı).
 * Süper Lig dışı rakiplerin çoğu `data/teams.json`ta yok; onlara logo
 * uydurulmaz, istemci baş harf çizer.
 */
function logoFor(teamsPayload, teamName) {
  const list = Array.isArray(teamsPayload)
    ? teamsPayload
    : (teamsPayload && Array.isArray(teamsPayload.teams) ? teamsPayload.teams : []);

  const hit = list.find((team) => teamsMatch(team && team.name, teamName));
  const providerId = text(hit && hit.providerId);
  return /^\d+$/.test(providerId)
    ? `https://media.api-sports.io/football/teams/${providerId}.png`
    : "";
}

/** Maç raporu kayıtları. Bağlantı ancak kayıt varsa kurulur. */
function reportRecords(reportsPayload) {
  if (Array.isArray(reportsPayload)) return reportsPayload;
  if (reportsPayload && Array.isArray(reportsPayload.records)) return reportsPayload.records;
  return [];
}

function dayOf(value) {
  const stamp = Date.parse(text(value));
  return Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : "";
}

/**
 * Maçın rapor sayfası (`/mac-raporu/<id>.html`) — ya da boş dize.
 *
 * Rapor kimlikleri sağlayıcı adlandırmasını kullanır ve küratörlü maç
 * kimliğiyle her zaman birebir değildir ("besiktas-midtjylland-…" /
 * "besiktas-fc-midtjylland-…"). Önce kimlik denenir; tutmazsa aynı günün
 * aynı iki takımlı raporu aranır. TAHMİN YOK: iki kapıdan biri tutmayan
 * maça bağlantı verilmez.
 */
function reportHrefFor(reports, match) {
  const matchId = text(match && match.id);
  const records = reportRecords(reports);

  const byId = records.find((record) => text(record && record.matchId) === matchId);
  if (byId) return `/mac-raporu/${encodeURIComponent(text(byId.matchId))}.html`;

  const day = dayOf(match && match.kickoff);
  if (!day) return "";
  const byTeams = records.find((record) =>
    dayOf(record && (record.kickoff || record.kickoffUtc || record.date)) === day &&
    teamsMatch(record && record.homeTeam, match && match.homeTeam) &&
    teamsMatch(record && record.awayTeam, match && match.awayTeam));
  return byTeams ? `/mac-raporu/${encodeURIComponent(text(byTeams.matchId))}.html` : "";
}

/** "Beşiktaş 1-0 Hradec Králové" — skor eksikse skorsuz etiket. */
function matchLabelFor(match) {
  const home = text(match && match.homeTeam);
  const away = text(match && match.awayTeam);
  const score = match && match.score;
  const hasScore = score && Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
  return hasScore ? `${home} ${Number(score.home)}-${Number(score.away)} ${away}` : `${home} – ${away}`;
}

function asMatchList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.matches)) return payload.matches;
  return [];
}

/**
 * HAFTANIN ANKET MAÇLARI: bitmiş, anket hak eden ve son 7 gün içinde
 * başlamış maçlar; en yenisi önce, en fazla MAX_MATCHES tane.
 *
 * Uç nokta bu listeyle sayım okur; seçim burada olduğu için "hangi maçın
 * sayımı okunur" sorusunun cevabı da test edilebilir.
 */
function weeklyPollMatches(matchesPayload, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();

  return asMatchList(matchesPayload)
    .map((match) => {
      const stamp = kickoffStamp(match);
      if (!stamp || nowMs - stamp > WEEK_WINDOW_MS || stamp > nowMs) return null;
      const { poll } = buildMotmPoll(match, { now: nowMs });
      return poll ? { match, poll, stamp } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.stamp - left.stamp)
    .slice(0, MAX_MATCHES);
}

/**
 * HAFTALIK SIRALAMA.
 *
 * @param sources { matches, tallies, players, teams, reports } — `tallies`
 *   maç kimliğinden sayım nesnesine ({ optionId: count }) bir Map ya da düz
 *   nesnedir; uç nokta onu depodan doldurur, testler elle verir.
 * @returns { players, matchCount, totalVotes }
 */
function selectWeeklyTopPlayers(sources = {}, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(options.limit) || DEFAULT_LIMIT));

  const talliesMap = sources.tallies instanceof Map
    ? sources.tallies
    : new Map(Object.entries(sources.tallies || {}));
  const photoIndex = buildPhotoIndex(sources.players);

  const rows = [];
  let matchCount = 0;
  let totalVotes = 0;

  for (const { match, poll } of weeklyPollMatches(sources.matches, { now: nowMs })) {
    const counts = talliesMap.get(poll.matchId);
    if (!counts || typeof counts !== "object") continue;

    // Sayımda kalmış ama aday listesinde OLMAYAN kimlikler süzülür — uç
    // noktadaki `presentTally` kuralının aynısı: kadro düzeltilmiş olabilir.
    const validOptions = new Map(poll.options.map((option) => [option.id, option]));
    const matchRows = [];
    let matchTotal = 0;
    for (const [optionId, rawCount] of Object.entries(counts)) {
      const option = validOptions.get(optionId);
      const count = Number(rawCount);
      if (!option || !Number.isFinite(count) || count <= 0) continue;
      matchTotal += count;
      matchRows.push({ option, votes: count });
    }
    if (!matchTotal) continue;

    matchCount += 1;
    totalVotes += matchTotal;
    const matchLabel = matchLabelFor(match);
    const reportHref = reportHrefFor(sources.reports, match);

    for (const { option, votes } of matchRows) {
      rows.push({
        playerId: option.id,
        name: option.name,
        team: option.team,
        votes,
        // Yüzde MAÇ İÇİ paydır; gerekçe dosya başında.
        percent: Math.round((votes / matchTotal) * 100),
        matchId: poll.matchId,
        matchLabel,
        matchVotes: matchTotal,
        reportHref,
        votingOpen: poll.votingOpen,
        photo: photoFor(photoIndex, option.name, option.team),
        teamLogo: logoFor(sources.teams, option.team),
        teamInitials: text(option.team).split(/\s+/).slice(0, 2)
          .map((part) => part.charAt(0)).join("").toLocaleUpperCase("tr-TR")
      });
    }
  }

  // Aynı oyuncunun iki maçı: en çok oy aldığı satır kalır (toplama yok).
  const bestByPlayer = new Map();
  for (const row of rows) {
    const key = `${row.playerId}|${foldName(row.team)}`;
    const existing = bestByPlayer.get(key);
    if (!existing || row.votes > existing.votes) bestByPlayer.set(key, row);
  }

  const players = [...bestByPlayer.values()].sort((left, right) =>
    right.votes - left.votes ||
    right.percent - left.percent ||
    left.name.localeCompare(right.name, "tr"));

  return { players: players.slice(0, limit), matchCount, totalVotes };
}

module.exports = {
  COPY,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_MATCHES,
  WEEK_WINDOW_MS,
  abbreviatedKey,
  buildPhotoIndex,
  logoFor,
  matchLabelFor,
  photoFor,
  reportHrefFor,
  selectWeeklyTopPlayers,
  teamsMatch,
  weeklyPollMatches
};
