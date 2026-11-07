/**
 * 2026/27 SÜPER LİG İSTATİSTİK LİSTELERİ — KİM GİREBİLİR?
 *
 * `data/players.json` düz `goals` / `assists` / `xg` alanları sezon taşımaz.
 * Kadro senkronu ölçmediği sayıyı 0 yazar; elle doldurulmuş eski kayıtlar
 * (Mauro Icardi: kaynak notu "Performans değerleri 2025/26 sezonundan",
 * sağlayıcı kimliği `mock-icardi-9`, güncel takım "Serbest oyuncu") ise
 * dolu görünür. İstatistik merkezi bu alanları süzmeden sıralayınca eski
 * sezon, güncel Süper Lig xG / gol / asist listesinin başına oturuyordu.
 *
 * Kural isim kara listesi değil. Güncel havuz:
 *   - `data/super-lig-squads.json` içinde sezonu 2026 (2026/27) olan kadro
 *   - `data/league-leaders.json` aynı sezonda ve `appearances` > 0 olan
 *     satırlar (sezon içinde ayrılan, kadroda artık olmayan oyuncu ligde
 *     süre aldıysa listede kalır)
 *
 * İkisi de yoksa oyuncu elenir. Ölçülmemiş 0 ve doğrulanmamış derecelendirme
 * liderliğe yazılmaz; yerine sayı uydurulmaz.
 *
 * Tarayıcı kopyası `app.js` içindeki aynı adlı işlevlerdir. İkisi birlikte
 * değişmeli — `scripts/test-super-lig-season-stats.mjs` bunu kollar.
 */

const SUPER_LIG_STAT_SEASON = "2026";

const RATING_KEYS = new Set([
  "aiRating", "rating", "overallRating", "pressingScore",
  "threatScore", "creativityScore"
]);

const MAINTAINED_RATING_STATUS = new Set(["verified", "current"]);

function seasonYear(value) {
  const match = String(value == null ? "" : value).trim().match(/^(\d{4})/);
  return match ? match[1] : "";
}

function foldClub(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

function isSuperLigLabel(value) {
  return /s[uü]per\s*lig/i.test(foldClub(value).replace(/ü/g, "u"));
}

/**
 * @param {Array} squads super-lig-squads.json
 * @param {object|null} leaders league-leaders.json
 * @param {string} [season]
 */
function buildSuperLigStatPool(squads, leaders, season) {
  const wanted = seasonYear(season || SUPER_LIG_STAT_SEASON);
  const providerIds = new Set();
  const slugs = new Set();

  for (const team of Array.isArray(squads) ? squads : []) {
    if (seasonYear(team && team.season) !== wanted) continue;
    for (const player of (team && team.players) || []) {
      if (player && player.providerId) providerIds.add(String(player.providerId));
    }
  }

  if (leaders && seasonYear(leaders.season) === wanted) {
    const rows = []
      .concat(Array.isArray(leaders.topScorers) ? leaders.topScorers : [])
      .concat(Array.isArray(leaders.topAssists) ? leaders.topAssists : []);
    for (const row of rows) {
      if (!(Number(row && row.appearances) > 0)) continue;
      if (row.providerId) providerIds.add(String(row.providerId));
      if (row.slug) slugs.add(String(row.slug));
    }
  }

  return { season: wanted, providerIds, slugs };
}

function isCurrentSeasonStatPlayer(player, pool) {
  if (!player || !pool) return false;
  const providerId = String(player.providerId || player.provider_id || "");
  if (providerId && pool.providerIds && pool.providerIds.has(providerId)) return true;
  const slug = String(player.id || player.slug || "");
  if (slug && pool.slugs && pool.slugs.has(slug)) return true;
  return false;
}

function readMetric(player, key) {
  if (!player) return null;
  const direct = player[key];
  if (direct !== null && direct !== undefined && direct !== "") {
    const number = Number(direct);
    if (Number.isFinite(number)) return number;
  }
  const stats = player.stats && typeof player.stats === "object" ? player.stats : {};
  const nested = stats[key];
  if (nested !== null && nested !== undefined && nested !== "") {
    const number = Number(nested);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

/**
 * Sezon listesinde kullanılacak sayı. Uygun değilse null — 0 uydurulmaz.
 */
function seasonStatMetric(player, key, pool) {
  if (!isCurrentSeasonStatPlayer(player, pool)) return null;
  if (RATING_KEYS.has(key)) {
    const status = String((player && player.ratingStatus) || "").toLowerCase();
    if (!MAINTAINED_RATING_STATUS.has(status)) return null;
  }
  if (Array.isArray(player && player.statsVerifiedFields) && !player.statsVerifiedFields.includes(key)) {
    return null;
  }
  const number = readMetric(player, key);
  if (number === null) return null;
  if (!(Array.isArray(player.statsVerifiedFields)) && number === 0) return null;
  return number;
}

/**
 * Gol/asist listesi `league-leaders.json`den. Dosya yoksa veya sezon
 * uymuyorsa null (çağıran oyuncu havuzuna düşer). Başka bir lig filtresi
 * seçiliyse boş dizi: Süper Lig tablosu o lige yazılmaz.
 */
function seasonLeaderboard(leaders, metric, options) {
  const settings = options || {};
  const wanted = seasonYear(settings.season || SUPER_LIG_STAT_SEASON);
  if (!leaders || seasonYear(leaders.season) !== wanted) return null;
  const listKey = metric === "assists" ? "topAssists" : metric === "goals" ? "topScorers" : null;
  if (!listKey || !Array.isArray(leaders[listKey])) return null;
  if (settings.league && !isSuperLigLabel(settings.league)) return [];

  const team = settings.team ? foldClub(settings.team) : "";
  const rows = leaders[listKey].filter((row) => {
    if (!(Number(row && row.appearances) > 0)) return false;
    if (!(Number(row && row[metric]) > 0)) return false;
    if (team && foldClub(row.team) !== team) return false;
    return true;
  });

  return rows.slice(0, settings.limit || 5).map((row) => ({
    item: {
      id: row.slug || "",
      slug: row.slug || "",
      name: row.name || "",
      team: row.team || "",
      currentTeam: row.team || "",
      position: "",
      providerId: row.providerId || "",
      goals: Number(row.goals || 0),
      assists: Number(row.assists || 0)
    },
    value: Number(row[metric])
  }));
}

module.exports = {
  SUPER_LIG_STAT_SEASON,
  buildSuperLigStatPool,
  isCurrentSeasonStatPlayer,
  seasonStatMetric,
  seasonLeaderboard
};
