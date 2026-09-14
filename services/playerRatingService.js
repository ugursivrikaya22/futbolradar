/**
 * PUAN HATTI — motoru veriye bağlayan tek yer.
 *
 * `services/playerRatingEngine.js` saf bir hesap: oyuncu kaydı + bağlam
 * alır, puan üretir. Bağlamı KURMAK (maç defteri, takımın oynadığı maç
 * sayısı, lig gol krallığı ölçümleri) ayrı bir iş ve üç yerde birden
 * gerekiyor: statik sayfa üreticileri, `/api/players` yanıtı ve testler.
 *
 * Üçünün ayrı kurması, aynı oyuncunun sayfada ve API'de FARKLI puan
 * göstermesi demekti. Bağlam bu yüzden burada, tek kez kurulur.
 */

const { buildPlayerMatchLedger, ledgerFor } = require("./playerMatchLedger");
const { computePlayerRatingScores } = require("./playerRatingEngine");

function normalizeTeamKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Takımların oynadığı maç sayısı — "Süreklilik" kategorisinin paydası.
 *
 * Bir oyuncunun 300 dakikası, takımı 4 maç oynadıysa yüksek bir pay, 20 maç
 * oynadıysa düşük bir paydır. Payda olmadan süreklilik yalnızca "maç başına
 * dakika"ya indirgenir ve bir maçlık örneklemde yanıltıcı olur.
 */
function buildTeamMatchIndex(standings) {
  const index = new Map();
  const leagues = standings && typeof standings === "object" ? Object.values(standings) : [];

  for (const league of leagues) {
    for (const row of (league && league.table) || []) {
      const played = Number(row && row.played);
      if (!Number.isFinite(played) || played <= 0) continue;
      for (const name of [row.team, row.name]) {
        const key = normalizeTeamKey(name);
        if (key) index.set(key, Math.max(index.get(key) || 0, played));
      }
    }
  }

  return index;
}

/**
 * Lig gol/asist krallığı tablosu ölçülmüş bir kaynaktır.
 *
 * `/players/topscorers` ve `/players/topassists` sağlayıcının kendi sayımı:
 * gol, asist, maç ve dakika. Kadro senkronunun boş bıraktığı alanları bu
 * tablo gerçekten doldurur — üstelik oyuncunun sitedeki kimliğiyle (slug)
 * eşleşmiş hâlde.
 */
function buildLeaderStatIndex(leagueLeaders) {
  const index = new Map();
  const rows = []
    .concat((leagueLeaders && leagueLeaders.topScorers) || [])
    .concat((leagueLeaders && leagueLeaders.topAssists) || []);

  for (const row of rows) {
    const keys = [row && row.slug, row && row.providerId ? `pid:${row.providerId}` : null].filter(Boolean);
    if (!keys.length) continue;

    const totals = {};
    const map = { goals: "goals", assists: "assists", appearances: "appearances", minutes: "minutesPlayed" };
    for (const [source, target] of Object.entries(map)) {
      const value = Number(row[source]);
      if (Number.isFinite(value)) totals[target] = Math.max(Number(totals[target] || 0), value);
    }
    if (!Object.keys(totals).length) continue;

    const entry = {
      kind: "leaderboard",
      label: "API-Football lig gol ve asist tablosu",
      verifiedAt: (leagueLeaders && (leagueLeaders.updatedAt || leagueLeaders.generatedAt)) || null,
      totals
    };

    for (const key of keys) {
      const existing = index.get(key);
      if (!existing) {
        index.set(key, entry);
        continue;
      }
      // Aynı oyuncu iki tabloda da olabilir (hem gol hem asist krallığı);
      // her alanın en büyük ölçümü korunur.
      for (const [field, value] of Object.entries(totals)) {
        existing.totals[field] = Math.max(Number(existing.totals[field] || 0), value);
      }
    }
  }

  return index;
}

/**
 * Bağlam üreticisi. Ağır hazırlık (defter kurulumu) BİR KEZ yapılır;
 * dönen fonksiyon oyuncu başına ucuzdur.
 *
 * @param {object} options
 * @param {Array}  [options.archive] historical-match-archive.json kayıtları
 * @param {Array}  [options.fixtures] fixture-calendar.json maçları
 * @param {object} [options.standings] league-standings.json
 * @param {object} [options.leagueLeaders] league-leaders.json
 * @param {Date}   [options.now]
 */
function createRatingContextFactory(options) {
  const settings = options || {};
  const ledger = buildPlayerMatchLedger({
    archive: settings.archive || [],
    fixtures: settings.fixtures || []
  });
  const teamMatches = buildTeamMatchIndex(settings.standings);
  const leaderStats = buildLeaderStatIndex(settings.leagueLeaders);
  const now = settings.now instanceof Date ? settings.now : new Date();

  return function ratingContextFor(player) {
    const teamKey = normalizeTeamKey(player && (player.currentTeam || player.team));
    const providerKey = player && player.providerId ? `pid:${player.providerId}` : null;

    return {
      now,
      ledger: ledgerFor(ledger, player),
      teamMatchesPlayed: teamKey && teamMatches.has(teamKey) ? teamMatches.get(teamKey) : null,
      measuredStats: (player && leaderStats.get(player.id))
        || (player && player.slug ? leaderStats.get(player.slug) : null)
        || (providerKey ? leaderStats.get(providerKey) : null)
        || null,
      positionGroup: player && player.positionGroup,
      age: player && (player.computedAge ?? player.age)
    };
  };
}

/**
 * Oyuncu listesine `ratingScores` ve `playerRatingUpdatedAt` ekler.
 *
 * Kayıt KOPYALANIR; girdi dizisi değiştirilmez. Eski `radar`/`aiRating`
 * alanlarına dokunulmaz — onların kredibilite kapısı ayrıdır ve bu blok
 * kendi kanıtını taşır.
 */
function attachPlayerRatings(players, options) {
  const contextFor = createRatingContextFactory(options);
  const list = Array.isArray(players) ? players : [];

  return list.map((player) => {
    const context = contextFor(player);
    const ratingScores = computePlayerRatingScores(player, context);
    return {
      ...player,
      ratingScores,
      playerRatingUpdatedAt: ratingScores.updatedAt,
      // snake_case ikiz alan: şartnamede `player_rating_updated_at` adıyla
      // isteniyor; veri tüketicileri ikisinden birini bulur.
      player_rating_updated_at: ratingScores.updatedAt
    };
  });
}

/**
 * Build adımının yazdığı tam puan bloklarını kayıtlara bağlar.
 *
 * `data/players.json` içindeki blok KOMPAKTTIR (girdi dökümü yok, dosya
 * şişmesin). Statik sayfa üreticileri detay açılımını basabilmek için tam
 * bloğa ihtiyaç duyar; o da `data/player-ratings.json` dosyasında durur.
 * İki kaynağı birleştirmek tek satırlık bir iş ama üç üreticide birden
 * gerektiği için burada.
 *
 * @param {Array} players oyuncu kayıtları
 * @param {object} ratingsFile data/player-ratings.json içeriği
 */
function withStoredRatings(players, ratingsFile) {
  const index = (ratingsFile && ratingsFile.players) || {};
  return (Array.isArray(players) ? players : []).map((player) => {
    const scores = player && index[player.id];
    if (!scores) return player;
    return {
      ...player,
      ratingScores: scores,
      playerRatingUpdatedAt: scores.updatedAt || player.playerRatingUpdatedAt || null,
      player_rating_updated_at: scores.updatedAt || player.player_rating_updated_at || null
    };
  });
}

module.exports = {
  attachPlayerRatings,
  withStoredRatings,
  buildLeaderStatIndex,
  buildTeamMatchIndex,
  createRatingContextFactory,
  normalizeTeamKey
};
