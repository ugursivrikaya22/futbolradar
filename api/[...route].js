const { getProvider, mockProvider } = require("../services/providers");
const { mergeProviderPlayers } = require("../services/playerService");
const { enrichPlayerRating } = require("../services/ratingService");
const { MODEL_VERSION: MATCH_PREDICTION_MODEL_VERSION } = require("../services/matchPredictionService");
const { getFixtureWeeks, groupMatchesIntoWeeks } = require("../services/superLigFixtureService");
const { providerMeta, resolveFromProviders } = require("../services/liveDataService");
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

  return sendSuccess(res, [player], source);
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
    return matchAnalysisResponse(res, 404, {
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

/**
 * KORUMALI MANUEL YENİDEN KOŞU — maç sonu 96 saatlik kapsayıcı için.
 *
 * Statik sitenin derlemesi GitHub Actions'ta yaşar; bu uç nokta o zinciri
 * `repository_dispatch (post-match-rerun)` olayıyla tetikler. İki ayrı sır
 * gerekir ve ikisi de YOKSA uç nokta dürüstçe 503 döner — sahte başarı yok:
 *
 *   - CRON_SECRET: çağıranın yetkisi (Authorization: Bearer ... ya da
 *     ?secret=). Vercel cron kancalarıyla aynı kalıp.
 *   - GITHUB_DISPATCH_TOKEN + GITHUB_REPOSITORY: tetikleme kanalı. Token
 *     yalnızca repo dispatch yetkisi taşımalı; yanıta asla yazılmaz.
 *
 * GET/HEAD dışına zaten kapalıyız (rejectUnsupportedMethod) — Vercel cron
 * da GET kullanır. Yanıt önbelleğe alınmaz.
 */
async function handlePostMatchRerun(req, res, query) {
  const configured = String(process.env.CRON_SECRET || "").trim();
  if (!configured) {
    return sendError(res, 503, "Yeniden koşu ucu yapılandırılmadı (CRON_SECRET tanımsız).", "RERUN_NOT_CONFIGURED");
  }
  const header = String(req.headers.authorization || "");
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : String(query.secret || "").trim();
  if (!provided || provided !== configured) {
    return sendError(res, 401, "Yetkisiz: geçerli CRON_SECRET gerekli.", "RERUN_UNAUTHORIZED");
  }

  const token = String(process.env.GITHUB_DISPATCH_TOKEN || "").trim();
  const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (!token || !repository) {
    return sendError(res, 503, "Tetikleme kanalı yapılandırılmadı (GITHUB_DISPATCH_TOKEN / GITHUB_REPOSITORY).", "RERUN_CHANNEL_MISSING");
  }

  try {
    const response = await withTimeout(fetch(`https://api.github.com/repos/${repository}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "futbolradar-post-match-rerun"
      },
      body: JSON.stringify({ event_type: "post-match-rerun" })
    }), DEFAULT_TIMEOUT_MS);

    if (response.status !== 204) {
      return sendError(res, 502, `GitHub dispatch beklenmeyen durum döndü: ${response.status}.`, "RERUN_DISPATCH_FAILED");
    }
  } catch (error) {
    return sendError(res, 502, "GitHub dispatch çağrısı tamamlanamadı.", "RERUN_DISPATCH_FAILED");
  }

  return sendJson(res, 202, {
    ok: true,
    source: "FutbolRadar API",
    message: "Maç sonu kapsayıcı zinciri tetiklendi (repository_dispatch: post-match-rerun).",
    triggeredAt: new Date().toISOString()
  });
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  const route = routeName(req);
  setCachePolicy(res, route === "match-analysis" ? "match-analysis" : "players");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);

  if (route === "post-match-rerun") {
    // Tetikleyici yanıtı hiçbir CDN katmanında önbelleğe alınmamalı.
    setCachePolicy(res, "health");
    return handlePostMatchRerun(req, res, query);
  }

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
