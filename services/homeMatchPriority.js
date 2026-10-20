/**
 * ANA SAYFA MAÇ KARTI ÖNCELİĞİ — AĞIRLIKLAR TEK YERDE.
 *
 * "Bugünün Maçları" önizlemesi eskiden yalnızca durum (canlı/başlayacak),
 * Türk takımı ve BAŞLAMA SAATİNE göre sıralanıyordu; 24 kartlık tavan ve
 * 12 kartlık görünür pencere erken saatteki alt lig maçlarıyla doluyor,
 * akşamki PSG–Barcelona gibi Şampiyonlar Ligi maçları pencerenin dışında
 * kalıyordu. Bu modül her maça bir ÖNCELİK PUANI verir:
 *
 *   puan = lig ağırlığı + takım popülerliği + maç önemi
 *
 * - Lig ağırlığı: Şampiyonlar Ligi > Süper Lig / ilk 5 lig > diğer Avrupa
 *   (Avrupa Ligi, Konferans Ligi, Eredivisie, Primeira Liga, 1. Lig...) > diğer.
 *   Altyapı (U19/U21, Youth League) ve hazırlık maçları en altta.
 * - Takım popülerliği: editoryal liste (POPULAR_TEAMS), TAM ad eşleşmesi —
 *   "PSG U19" PSG sayılmaz.
 * - Maç önemi: editoryal derbi listesi + MEVCUT puan durumu verisinden
 *   (data/league-standings.json) "zirve maçı": iki takım da aynı ligin ilk
 *   TOP_OF_TABLE_RANK sırasındaysa. Veri yoksa bonus yok; hiçbir şey uydurulmaz.
 *
 * Türk takımları ASLA geriye düşmez: sıralamada "Türk maçı önce" kuralı
 * aynen korunur (app.js), puan yalnızca aynı grup İÇİNDE sırayı belirler.
 */

const LEAGUE_WEIGHT = Object.freeze({
  "sampiyonlar-ligi": 100,
  "super-lig": 80,
  "premier-league": 70,
  "la-liga": 70,
  "bundesliga": 70,
  "serie-a": 70,
  "ligue-1": 70,
  "avrupa-ligi": 55,
  "konferans-ligi": 45,
  "otherEuropean": 30,
  "other": 10,
  "youth": 2,
  "friendly": 0
});

/** Lig adı/sağlayıcı kimliği → ağırlık anahtarı. Sıra önemli (ilk eşleşen). */
const LEAGUE_PATTERNS = [
  ["friendly", /friendl|hazırlık|hazirlik|club friendlies/i],
  ["youth", /\bu-?(17|18|19|20|21|23)\b|youth|primavera|reserve|women|kadın|kadin/i],
  // Avrupa dışı kıta kupaları ("CAF Champions League") UEFA sayılmaz.
  ["other", /\b(caf|afc|concacaf|conmebol|ofc)\b|copa libertadores|copa sudamericana/i],
  ["sampiyonlar-ligi", /champions league|şampiyonlar ligi|sampiyonlar ligi/i],
  ["avrupa-ligi", /europa league|avrupa ligi/i],
  ["konferans-ligi", /conference league|konferans ligi/i],
  ["super-lig", /süper lig|super lig/i],
  ["premier-league", /^premier league$|^premier lig$/i],
  ["la-liga", /la liga|laliga/i],
  ["bundesliga", /^bundesliga$/i],
  ["serie-a", /^serie a$/i],
  ["ligue-1", /^ligue 1$/i],
  ["otherEuropean", /eredivisie|primeira|1\. lig|1 lig|türkiye kupası|turkiye kupasi|championship|jupiler|pro league|scottish|premiership|super league|ekstraklasa|austria|bundesliga 2|2\. bundesliga|segunda|serie b|ligue 2|uefa|nations league|uluslar/i]
];

/** API-Football lig kimlikleri: ad belirsiz olduğunda (ör. "Premier League"). */
const PROVIDER_LEAGUE = Object.freeze({
  2: "sampiyonlar-ligi", 3: "avrupa-ligi", 848: "konferans-ligi", 203: "super-lig",
  39: "premier-league", 140: "la-liga", 78: "bundesliga", 135: "serie-a", 61: "ligue-1",
  204: "otherEuropean", 206: "otherEuropean", 88: "otherEuropean", 94: "otherEuropean"
});

/** Her popüler taraf için puan; Türk büyükleri en az bu kadar. */
const POPULAR_TEAM_WEIGHT = 25;
const TURKISH_BIG_WEIGHT = 30;

const POPULAR_TEAMS = [
  ["Paris Saint-Germain", "PSG", "Paris Saint Germain", "Paris SG"],
  ["Barcelona", "FC Barcelona"],
  ["Real Madrid", "Real Madrid CF"],
  ["Manchester City", "Man City", "Manchester City FC"],
  ["Bayern München", "Bayern Munich", "FC Bayern München", "FC Bayern Munich", "Bayern Munchen"],
  ["Juventus", "Juventus FC"],
  ["AC Milan", "Milan"],
  ["Inter", "Internazionale", "FC Internazionale", "Inter Milan", "Internazionale Milano"],
  ["Liverpool", "Liverpool FC"],
  ["Arsenal", "Arsenal FC"],
  ["Manchester United", "Man United", "Man Utd", "Manchester United FC"],
  ["Chelsea", "Chelsea FC"],
  ["Borussia Dortmund", "Dortmund", "BV Borussia 09 Dortmund"],
  ["Atlético Madrid", "Atletico Madrid", "Atlético de Madrid", "Club Atlético de Madrid"]
];

const TURKISH_BIG_TEAMS = [
  ["Galatasaray"], ["Fenerbahçe", "Fenerbahce"], ["Beşiktaş", "Besiktas"], ["Trabzonspor"]
];

/** Editoryal derbi listesi (iki taraf da TAM ad). */
const DERBY_WEIGHT = 30;
const DERBIES = [
  ["Galatasaray", "Fenerbahçe"], ["Galatasaray", "Beşiktaş"], ["Fenerbahçe", "Beşiktaş"],
  ["Trabzonspor", "Fenerbahçe"], ["Trabzonspor", "Galatasaray"], ["Trabzonspor", "Beşiktaş"],
  ["Real Madrid", "Barcelona"], ["Real Madrid", "Atlético Madrid"],
  ["Manchester United", "Manchester City"], ["Manchester United", "Liverpool"],
  ["Liverpool", "Everton"], ["Arsenal", "Tottenham Hotspur"], ["Arsenal", "Chelsea"],
  ["AC Milan", "Inter"], ["Juventus", "Inter"], ["AS Roma", "Lazio"],
  ["Borussia Dortmund", "Bayern München"], ["Borussia Dortmund", "Schalke 04"],
  ["Paris Saint-Germain", "Olympique Marseille"], ["Celtic", "Rangers"], ["Ajax", "Feyenoord"],
  ["Benfica", "Sporting CP"], ["Benfica", "FC Porto"]
];
const EXTRA_ALIASES = [
  ["Tottenham Hotspur", "Tottenham", "Spurs"], ["AS Roma", "Roma"], ["Lazio", "SS Lazio"],
  ["Schalke 04", "FC Schalke 04", "Schalke"], ["Olympique Marseille", "Marseille", "Olympique de Marseille"],
  ["Celtic", "Celtic FC"], ["Rangers", "Rangers FC"], ["Ajax", "AFC Ajax"], ["Feyenoord"],
  ["Benfica", "SL Benfica"], ["Sporting CP", "Sporting Lisbon"], ["FC Porto", "Porto"], ["Everton", "Everton FC"]
];

/** Zirve maçı: iki takım da aynı lig tablosunda ilk N içinde. */
const TOP_OF_TABLE_RANK = 4;
const TOP_OF_TABLE_WEIGHT = 20;

/** Görünür pencerede garanti edilen (sabitlenen) en yüksek puanlı maç sayısı. */
const PIN_COUNT = 8;
/** Sabitlenmek için gereken en düşük puan ("büyük maç" eşiği). */
const PIN_MIN_SCORE = 95;

function key(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0131/g, "i")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function aliasMap(groups) {
  const map = new Map();
  for (const group of groups) for (const name of group) map.set(key(name), group[0]);
  return map;
}
const POPULAR = aliasMap(POPULAR_TEAMS);
const TURKISH_BIG = aliasMap(TURKISH_BIG_TEAMS);
const ANY_CLUB = aliasMap([...POPULAR_TEAMS, ...TURKISH_BIG_TEAMS, ...EXTRA_ALIASES]);
const DERBY_KEYS = new Set(DERBIES.map((pair) => pair.map(key).sort().join("|")));

function canonicalClub(name) {
  return ANY_CLUB.get(key(name)) || String(name || "").trim();
}

function leagueKeyOf(match) {
  const name = String((match && (match.league || match.competition)) || "");
  for (const [id, pattern] of LEAGUE_PATTERNS.slice(0, 3)) if (pattern.test(name)) return id;
  const providerId = Number(match && (match.providerLeagueId || match.leagueId));
  if (PROVIDER_LEAGUE[providerId]) return PROVIDER_LEAGUE[providerId];
  for (const [id, pattern] of LEAGUE_PATTERNS.slice(3)) if (pattern.test(name)) return id;
  return "other";
}

function teamWeight(name) {
  const k = key(name);
  if (TURKISH_BIG.has(k)) return TURKISH_BIG_WEIGHT;
  if (POPULAR.has(k)) return POPULAR_TEAM_WEIGHT;
  return 0;
}

function isDerby(match) {
  const pair = [canonicalClub(match.homeTeam), canonicalClub(match.awayTeam)].map(key).sort().join("|");
  return DERBY_KEYS.has(pair);
}

/** standings: data/league-standings.json biçimi ({ ligId: { table: [...] } }). */
function isTopOfTable(match, standings) {
  if (!standings || typeof standings !== "object") return false;
  const home = key(match.homeTeam);
  const away = key(match.awayTeam);
  for (const entry of Object.values(standings)) {
    const table = entry && Array.isArray(entry.table) ? entry.table : null;
    if (!table) continue;
    const rankOf = (k) => {
      const row = table.find((r) => key(r.team || r.name) === k);
      return row ? Number(row.rank) : NaN;
    };
    const hr = rankOf(home);
    const ar = rankOf(away);
    if (Number.isFinite(hr) && Number.isFinite(ar) && hr <= TOP_OF_TABLE_RANK && ar <= TOP_OF_TABLE_RANK) return true;
  }
  return false;
}

function homePriorityScore(match, options = {}) {
  if (!match) return 0;
  const leagueKey = leagueKeyOf(match);
  const league = LEAGUE_WEIGHT[leagueKey] || 0;
  // Altyapı/hazırlık maçlarında kulüp adı popülerlik getirmez.
  const lowTier = leagueKey === "youth" || leagueKey === "friendly";
  const teams = lowTier ? 0 : teamWeight(match.homeTeam) + teamWeight(match.awayTeam);
  const derby = !lowTier && isDerby(match) ? DERBY_WEIGHT : 0;
  const top = !lowTier && isTopOfTable(match, options.standings) ? TOP_OF_TABLE_WEIGHT : 0;
  return league + teams + derby + top;
}

/** Puanı kayda damgalar (kopya); istemci yalnızca sayıyı görür. */
function withHomePriority(matches, options = {}) {
  if (!Array.isArray(matches)) return [];
  return matches.map((match) => (match && typeof match === "object"
    ? { ...match, homePriority: homePriorityScore(match, options) }
    : match));
}

/**
 * Sabitlenecek maçlar: puanı eşiği geçen en yüksek PIN_COUNT maç.
 * scoreOf verilmezse homePriority alanı okunur.
 */
function pinnedMatches(matches, scoreOf, count = PIN_COUNT, minScore = PIN_MIN_SCORE) {
  const score = scoreOf || ((m) => Number(m && m.homePriority) || 0);
  return (Array.isArray(matches) ? matches : [])
    .filter((m) => score(m) >= minScore)
    .sort((a, b) => score(b) - score(a))
    .slice(0, count);
}

/**
 * Görünür pencereye (limit) sabitlenen maçları yerleştir. Pencereden çıkan
 * yalnızca sabitlenmemiş VE Türk olmayan en alttaki kartlardır; Türk maçı
 * asla pencere dışına itilmez. Sonuç tekrar `compare` ile sıralanır.
 */
function placePinned(ordered, pinned, limit, compare, isProtected) {
  const head = ordered.slice(0, limit);
  const tail = ordered.slice(limit);
  const pinnedSet = new Set(pinned);
  for (const match of pinned) {
    if (head.includes(match)) continue;
    let drop = -1;
    for (let i = head.length - 1; i >= 0; i -= 1) {
      if (!pinnedSet.has(head[i]) && !(isProtected && isProtected(head[i]))) { drop = i; break; }
    }
    if (drop < 0) break;
    tail.push(head.splice(drop, 1)[0]);
    tail.splice(tail.indexOf(match), 1);
    head.push(match);
  }
  return head.sort(compare).concat(tail.sort(compare));
}

module.exports = {
  LEAGUE_WEIGHT,
  POPULAR_TEAMS,
  TURKISH_BIG_TEAMS,
  DERBIES,
  POPULAR_TEAM_WEIGHT,
  TURKISH_BIG_WEIGHT,
  DERBY_WEIGHT,
  TOP_OF_TABLE_RANK,
  TOP_OF_TABLE_WEIGHT,
  PIN_COUNT,
  PIN_MIN_SCORE,
  homePriorityScore,
  isDerby,
  isTopOfTable,
  leagueKeyOf,
  pinnedMatches,
  placePinned,
  withHomePriority
};
