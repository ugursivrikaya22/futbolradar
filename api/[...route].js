const { getProvider, mockProvider } = require("../services/providers");
const { mergeProviderPlayers } = require("../services/playerService");
const { enrichPlayerRating } = require("../services/ratingService");
const { MODEL_VERSION: MATCH_PREDICTION_MODEL_VERSION } = require("../services/matchPredictionService");
const {
  DEFAULT_RECENT_WINDOW,
  MAX_RECENT_WINDOW,
  buildPlayerProfile
} = require("../services/playerProfileService");
const { getFixtureWeeks, groupMatchesIntoWeeks } = require("../services/superLigFixtureService");
const { providerMeta, resolveFromProviders } = require("../services/liveDataService");
const { handleMotmVote } = require("../server/motmVoteRoute");
const { handleMotmWeek } = require("../server/motmWeekRoute");
const { handleHomePoll } = require("../server/homePollRoute");
const { handlePredictionLeague } = require("../server/predictionLeagueRoute");
const { handleMatchWinnerVote } = require("../server/matchWinnerVoteRoute");
const { handleMatchPoll } = require("../server/matchPollRoute");
const { handleMatchComments, handleMatchRatings } = require("../server/matchSocialRoute");
const { handleMatchLineup } = require("../server/matchLineupRoute");
const { handleLiveLatency } = require("../server/liveLatencyRoute");
const { handleDailyHealthCheck } = require("../server/dailyHealthCheckRoute");
const { handleLiveScoreStream } = require("../server/liveScoreStreamRoute");
const { handlePushSubscription } = require("../server/pushSubscriptionRoute");
const { handleColumnsPublish } = require("../server/columnsPublishRoute");
const { handleOnThisDayCron } = require("../server/onThisDayCronRoute");
const { handleNewsletter } = require("../server/newsletterRoute");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  normalizeText,
  rejectUnsupportedMethod,
  sendError,
  sendJson,
  sendSuccess,
  setCachePolicy,
  withTimeout
} = require("./_utils");

async function getPlayerData(query) {
  const provider = getProvider("players");
  const localData = await mockProvider.getPlayers(query);
  let data = localData;
  let source = mockProvider.source;

  try {
    if (provider !== mockProvider) {
      const providerData = await withTimeout(provider.getPlayers(query), DEFAULT_TIMEOUT_MS);
      if (Array.isArray(providerData) && providerData.length) {
        data = mergeProviderPlayers(localData, providerData, provider.name);
        source = provider.source;
      }
    }
  } catch (error) {
    data = localData;
    source = mockProvider.source;
  }

  return {
    data: data.map((player) => enrichPlayerRating(player)),
    source
  };
}

function routeName(req) {
  const url = new URL(req.url || "/", "http://localhost");
  return normalizeText(url.pathname.replace(/^\/api\/?/, "").split("/")[0]);
}

function requestedPlayers(query) {
  const explicit = String(query.players || "")
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
  const positional = [query.p1, query.p2, query.p3].map((item) => normalizeText(item)).filter(Boolean);
  return (explicit.length ? explicit : positional).slice(0, 3);
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rankingScore(player, type) {
  const radar = player.radar || {};
  if (type === "forward") {
    return player.positionGroup === "forward" || player.positionGroup === "winger" ? numberValue(radar.attack, 0) : -1;
  }
  if (type === "midfielder") {
    return player.positionGroup === "midfielder" ? numberValue(radar.creativity, 0) : -1;
  }
  if (type === "defender") {
    return player.positionGroup === "defender" ? numberValue(radar.defense, 0) : -1;
  }
  if (type === "goalkeeper") {
    return player.positionGroup === "goalkeeper" ? numberValue(radar.defense, 0) : -1;
  }
  if (type === "rising") {
    return numberValue(player.formChange, 0) * 12 + numberValue(radar.form, 0);
  }
  if (type === "young") {
    const age = numberValue(player.computedAge || player.age, 99);
    return age <= 23 ? numberValue(radar.potential, 0) : -1;
  }
  if (type === "transfer") {
    return numberValue(radar.transferValue, 0);
  }

  return numberValue(radar.overall, numberValue(player.overallRating || player.aiRating || player.rating, 0));
}

/**
 * Sağlayıcıdan son maç kırılımını çeker. Sağlayıcı kimliği yoksa (kürasyonlu
 * kayıtlar `mock-*` kimliği taşır) veya çağrı başarısız olursa boş dizi
 * döner; profil bu durumda maç kırılımı için boş durum gösterir, uydurma
 * maç satırı üretilmez.
 */
async function loadPlayerMatchLog(player, query) {
  const provider = getProvider("players");
  const providerId = String(player.providerId || "");
  const teamId = String(player.currentTeamProviderId || "");

  if (!provider || typeof provider.getPlayerMatchLog !== "function") {
    return [];
  }

  if (!/^\d+$/.test(providerId) || !/^\d+$/.test(teamId)) {
    return [];
  }

  const last = Math.max(1, Math.min(Number(query.last || query.matches) || DEFAULT_RECENT_WINDOW, MAX_RECENT_WINDOW));

  try {
    const log = await withTimeout(provider.getPlayerMatchLog({ playerId: providerId, teamId, last }), DEFAULT_TIMEOUT_MS * 2);
    return Array.isArray(log) ? log : [];
  } catch (error) {
    return [];
  }
}

async function handlePlayerDetail(req, res, query) {
  const wanted = normalizeText(query.id || query.slug || query.player || query.playerId);
  const { data, source } = await getPlayerData(query);
  const player = wanted
    ? data.find((item) => {
      return normalizeText(item.id) === wanted || normalizeText(item.slug) === wanted || normalizeText(item.name) === wanted;
    })
    : data[0];

  if (!player) {
    return sendError(res, 200, "Oyuncu kaydi bulunamadi.", "PLAYER_NOT_FOUND", source);
  }

  const matchLog = await loadPlayerMatchLog(player, query);
  let transfers = [];
  try {
    transfers = require("../data/transfers.json");
  } catch (error) {
    transfers = [];
  }

  const profile = buildPlayerProfile({
    player,
    players: data,
    matchLog,
    transfers,
    recentWindow: query.last || query.matches
  });

  return sendSuccess(res, [{ ...player, profile }], source, undefined, {
    profileVersion: profile ? profile.version : null,
    matchLogSource: matchLog.length ? "provider" : "unavailable"
  });
}

async function handlePlayerCompare(req, res, query) {
  const { data, source } = await getPlayerData(query);
  const wanted = requestedPlayers(query);
  const selected = wanted.length
    ? wanted.map((id) => data.find((player) => {
      return normalizeText(player.id) === id || normalizeText(player.slug) === id || normalizeText(player.name) === id;
    })).filter(Boolean)
    : data.slice(0, 3);

  if (selected.length < 2) {
    return sendError(res, 200, "Karsilastirma icin en az iki oyuncu bulunmali.", "PLAYER_COMPARE_NOT_ENOUGH_PLAYERS", source);
  }

  return sendSuccess(res, selected.slice(0, 3), source);
}

async function handlePlayerRankings(req, res, query) {
  const type = normalizeText(query.type || "overall");
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
  const { data, source } = await getPlayerData(query);
  const ranked = data
    .map((player) => ({ ...player, rankingScore: rankingScore(player, type) }))
    .filter((player) => player.rankingScore >= 0)
    .sort((a, b) => b.rankingScore - a.rankingScore)
    .slice(0, limit)
    .map((player, index) => ({
      ...player,
      rank: index + 1,
      rankingType: type
    }));

  return sendSuccess(res, ranked, source);
}

/**
 * Full Süper Lig season, grouped into weeks. Always starts from the
 * curated data/super-lig-fixtures.json (season metadata, team pool,
 * verified venues) and only ever swaps in `rounds` from a live provider —
 * every other editorial field is left untouched. No limit/page parameter
 * is applied; a provider fetch failure or empty result simply keeps the
 * curated rounds instead of guessing.
 */
async function handleSuperLigFixtures(req, res, query) {
  const fixturesData = require("../data/super-lig-fixtures.json");
  const result = await resolveFromProviders({
    resource: "super-lig-fixtures",
    query,
    run: (provider, providerQuery) => {
      if (typeof provider.getSeasonFixtures !== "function") {
        return [];
      }

      return provider.getSeasonFixtures(providerQuery);
    },
    // A live season feed is only usable once it actually groups into weeks;
    // anything less keeps the curated, editorially verified rounds.
    isUsable: (data) => Array.isArray(data) && data.length > 0 && groupMatchesIntoWeeks(data).length > 0
  });

  const liveRounds = Array.isArray(result.data) && result.data.length ? groupMatchesIntoWeeks(result.data) : [];
  const useLive = liveRounds.length > 0 && result.provider && result.provider !== mockProvider;

  return sendSuccess(
    res,
    {
      ...fixturesData,
      rounds: useLive ? liveRounds : getFixtureWeeks(fixturesData),
      roundsSource: useLive ? "provider" : "curated"
    },
    useLive ? result.provider.source : mockProvider.source,
    undefined,
    providerMeta(result, { roundsSource: useLive ? "provider" : "curated" })
  );
}

function matchAnalysisResponse(res, statusCode, payload) {
  return sendJson(res, statusCode, payload);
}

async function handleMatchAnalysis(req, res, query) {
  const fixtureId = normalizeText(query.fixtureId);
  const slugQuery = normalizeText(query.slug);

  if (!fixtureId && !slugQuery) {
    return matchAnalysisResponse(res, 200, {
      ok: false,
      source: "FutbolRadar Analysis",
      updatedAt: null,
      method: MATCH_PREDICTION_MODEL_VERSION,
      error: { code: "MATCH_ANALYSIS_QUERY_REQUIRED", message: "fixtureId veya slug parametresi gerekli." },
      data: null
    });
  }

  let analyses = [];
  try {
    analyses = require("../data/match-analyses.json");
  } catch (error) {
    return matchAnalysisResponse(res, 200, {
      ok: false,
      source: "FutbolRadar Analysis",
      updatedAt: null,
      method: MATCH_PREDICTION_MODEL_VERSION,
      error: { code: "MATCH_ANALYSIS_UNAVAILABLE", message: "Maç analizi verisi şu anda okunamıyor." },
      data: null
    });
  }

  const record = (Array.isArray(analyses) ? analyses : []).find((item) => {
    return (fixtureId && normalizeText(item.fixtureId) === fixtureId) || (slugQuery && normalizeText(item.slug) === slugQuery);
  });

  if (!record) {
    // Optional UI enrichment can legitimately be absent for a known fixture.
    // Preserve the existing 404 contract for callers requesting a resource.
    return matchAnalysisResponse(res, query.optional === "1" ? 200 : 404, {
      ok: false,
      source: "FutbolRadar Analysis",
      updatedAt: null,
      method: MATCH_PREDICTION_MODEL_VERSION,
      error: { code: "MATCH_ANALYSIS_NOT_FOUND", message: "Bu maç için analiz bulunamadı." },
      data: null
    });
  }

  if (record.analysisStatus === "unavailable") {
    return matchAnalysisResponse(res, 200, {
      ok: true,
      source: "FutbolRadar Analysis",
      updatedAt: record.generatedAt || null,
      method: record.modelVersion || MATCH_PREDICTION_MODEL_VERSION,
      status: "unavailable",
      data: record
    });
  }

  return matchAnalysisResponse(res, 200, {
    ok: true,
    source: "FutbolRadar Analysis",
    updatedAt: record.generatedAt || null,
    method: record.modelVersion || MATCH_PREDICTION_MODEL_VERSION,
    data: record
  });
}

module.exports = async function handler(req, res) {
  if (routeName(req) === "match-news" || /^\/haber\/galatasaray-kasimpasa-9-ekim-2026-canli-haber(?:\.html)?$/.test(new URL(req.url || "/", "http://localhost").pathname)) {
    return require("../server/matchNewsRoute").handleMatchNews(req, res);
  }
  // E-posta bülteni: abonelik (POST), onay ve tek tıkla çıkış (server/newsletterRoute.js).
  if (routeName(req) === "newsletter") {
    return handleNewsletter(req, res);
  }
  // OY UÇ NOKTASI EN ÖNDE, ÇÜNKÜ ALTTAKİ KAPILAR ONA UYMUYOR.
  //
  // `rejectUnsupportedMethod` yalnızca okuma yöntemlerine izin veriyor ve
  // oy vermek bir POST; buraya sonradan eklenseydi her oy 405 dönerdi.
  // Kendi önbellek politikası (no-store) ve kendi hız sınırı da var —
  // yazma, okumadan daha pahalı ve daha kötüye kullanılabilir.
  //
  // Mantık `server/motmVoteRoute.js`te: `api/` altındaki her dosya Vercel'de
  // bir sunucusuz işlev sayılıyor ve Hobby planının 12 işlev sınırı doluydu.
  if (routeName(req) === "motm-vote") {
    return handleMotmVote(req, res);
  }

  // Haftalık liste de kendi kapılarını taşır (kendi önbellek politikası ve
  // hız sınırı); alttaki genel kapılara sokulmaz.
  if (routeName(req) === "motm-week") {
    return handleMotmWeek(req, res);
  }

  // Ücretsiz Tahmin Ligi: hesap, tahmin, sıralama (server/predictionLeagueRoute.js).
  if (routeName(req) === "prediction-league") {
    return handlePredictionLeague(req, res);
  }

  // Ana sayfa tahmin anketi: oy vermek POST, yanıt seçmene özel.
  if (routeName(req) === "home-poll") {
    return handleHomePoll(req, res);
  }

  // Fenerbahçe-Beşiktaş derbisi "kim kazanır" anketi: tekil maça özel,
  // takvimsiz bir pencere (bkz. server/matchWinnerVoteRoute.js); aynı
  // gerekçeyle alttaki genel kapılara sokulmuyor.
  if (routeName(req) === "match-winner-vote") {
    return handleMatchWinnerVote(req, res);
  }

  // HER MAÇ İÇİN taraftar anketi ("kim kazanır" + değiştirilebilir ikinci
  // soru). Yukarıdaki derbi anketinden farkı maça sabitlenmemiş olması:
  // maçı slug ile alır, soruları sicilden ve
  // `data/match-poll-questions.json`dan kurar. Oy vermek POST, yanıt
  // seçmene özel — alttaki tek politikalı okuma kapısına girmez.
  if (routeName(req) === "match-poll") {
    return handleMatchPoll(req, res);
  }

  // MAÇ SAYFASI TOPLULUK KATMANI: yorumlar ve okuyucu oyuncu puanları.
  // İkisi de seçmene özel yanıt döndürüyor ("benim beğenim", "benim
  // puanım") ve kendi no-store politikasını taşıyor; alttaki tek
  // politikalı okuma kapısına sokulmuyorlar.
  if (routeName(req) === "match-comments") {
    return handleMatchComments(req, res);
  }

  if (routeName(req) === "match-ratings") {
    return handleMatchRatings(req, res);
  }

  // Maç dosyası ilk 11 + canlı skor: kendi önbellek politikasını maçın
  // durumuna göre seçiyor (onaylanmış + bitmiş kadro uzun süre önbelleklenir),
  // bu yüzden alttaki tek politikalı kapıya sokulmuyor.
  if (routeName(req) === "match-lineup") {
    return handleMatchLineup(req, res);
  }

  // Canlı skor gecikme kütüğü: GET tazeler+loglar, POST istemcinin
  // render zamanını işler — ikisi de kendi önbellek politikasını (no-store)
  // ve hız sınırını taşıyor, alttaki tek politikalı GET kapısına girmiyor.
  if (routeName(req) === "live-latency") {
    return handleLiveLatency(req, res);
  }

  // Günlük sağlık kontrolü kendi sır doğrulamasını ve önbellek politikasını
  // taşır (bkz. server/dailyHealthCheckRoute.js); alttaki genel kapılara
  // sokulmaz.
  if (routeName(req) === "daily-health-check") {
    return handleDailyHealthCheck(req, res);
  }

  if (routeName(req) === "live-score-stream") {
    return handleLiveScoreStream(req, res);
  }

  // Push abonelik uç noktası: POST/DELETE yazma taşır, alttaki genel kapı
  // yalnızca okuma yöntemlerine (GET/HEAD) izin veriyor.
  if (routeName(req) === "push-subscribe") {
    return handlePushSubscription(req, res);
  }

  // Köşe yazısı yayın uç noktası: yalnızca POST, EDITOR_TOKEN ile korunur.
  if (routeName(req) === "columns-publish") {
    return handleColumnsPublish(req, res);
  }

  // Tarihte Bugün günlük cron'u: CRON_SECRET ile korunur, hiçbir şey yazmaz.
  if (routeName(req) === "cron-on-this-day") {
    return handleOnThisDayCron(req, res);
  }

  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  const route = routeName(req);
  setCachePolicy(res, route === "match-analysis" ? "match-analysis" : "players");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);

  if (route === "player-detail") {
    return handlePlayerDetail(req, res, query);
  }

  if (route === "player-compare") {
    return handlePlayerCompare(req, res, query);
  }

  if (route === "player-rankings") {
    return handlePlayerRankings(req, res, query);
  }

  if (route === "match-analysis") {
    return handleMatchAnalysis(req, res, query);
  }

  if (route === "super-lig-fixtures") {
    return handleSuperLigFixtures(req, res, query);
  }

  return sendError(res, 404, "API endpoint bulunamadi.", "API_ROUTE_NOT_FOUND");
};

// SSE responses rotate before this ceiling. Keeping the stream in the
// existing catch-all avoids adding another Vercel function on the Hobby plan.
module.exports.config = { maxDuration: 300 };
