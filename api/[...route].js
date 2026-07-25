const { getProvider, mockProvider } = require("../services/providers");
const matchesHandler = require("../server/matches-handler");
const { mergeProviderPlayers } = require("../services/playerService");
const { enrichPlayerRating } = require("../services/ratingService");
const teams = require("../data/teams.json");
const {
  ANALYSIS_METHOD,
  currentTeamPlayers,
  findTeamAnalysis,
  readTeamAnalyses
} = require("../services/teamAnalysisService");
const {
  compareFormations,
  generateBestXI
} = require("../services/lineupPredictionService");
const { computeTransferFit } = require("../services/transferFitService");
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
  successResponse,
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
    return player.positionGroup === "forward" ? numberValue(radar.attack, 0) : -1;
  }
  if (type === "winger") {
    return player.positionGroup === "winger" ? numberValue(radar.creativity, 0) : -1;
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
  if (type === "transfer" || type === "transfers") {
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
  const currentOnly = query.currentLeagueOnly === undefined ||
    ["1", "true", "yes"].includes(normalizeText(query.currentLeagueOnly));
  const ranked = data
    .filter((player) => !currentOnly || (
      player.isCurrentSuperLigPlayer === true &&
      normalizeText(player.squadStatus) === "active"
    ))
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

function sendComputed(res, data, updatedAt) {
  return sendJson(res, 200, {
    ...successResponse(data, "FutbolRadar Computed Analysis", updatedAt),
    method: ANALYSIS_METHOD
  });
}

function requestedTeam(query, analyses) {
  return findTeamAnalysis(analyses, query);
}

function findTeamRecord(analysis) {
  return teams.find((team) =>
    [team.id, team.teamId, team.providerId, team.name].map(normalizeText)
      .includes(normalizeText(analysis && (analysis.teamId || analysis.teamName)))
  ) || null;
}

async function handleTeamAnalysis(req, res, query, route) {
  const analyses = readTeamAnalyses();
  const analysis = requestedTeam(query, analyses);
  if (!analysis) {
    return sendError(res, 404, "Takim analizi bulunamadi.", "TEAM_ANALYSIS_NOT_FOUND", "FutbolRadar API");
  }

  if (route === "team-analysis") {
    return sendComputed(res, analysis, analysis.generatedAt);
  }
  if (route === "team-depth") {
    return sendComputed(res, analysis.depthChart || {}, analysis.generatedAt);
  }
  if (route === "team-needs") {
    return sendComputed(res, {
      teamId: analysis.teamId,
      teamName: analysis.teamName,
      status: analysis.status,
      positionNeeds: analysis.positionNeeds || [],
      dataConfidence: analysis.dataConfidence
    }, analysis.generatedAt);
  }
  if (route === "formation-compare") {
    return sendComputed(res, {
      teamId: analysis.teamId,
      teamName: analysis.teamName,
      recommendedFormation: analysis.recommendedFormation,
      formationScores: analysis.formationScores || [],
      dataConfidence: analysis.dataConfidence
    }, analysis.generatedAt);
  }

  const formation = String(query.formation || analysis.recommendedFormation || "").trim();
  if (!formation || formation === analysis.bestXI?.formation) {
    return sendComputed(res, analysis.bestXI || {}, analysis.generatedAt);
  }

  const team = findTeamRecord(analysis);
  const playerPayload = await getPlayerData({});
  const squad = currentTeamPlayers(team, playerPayload.data);
  const lineup = generateBestXI(team, squad, formation);
  if (lineup.summary === "Desteklenmeyen formasyon seçildi.") {
    return sendError(res, 400, "Desteklenmeyen formasyon.", "INVALID_FORMATION", "FutbolRadar API");
  }
  return sendComputed(res, lineup, lineup.generatedAt);
}

async function handleTransferFit(req, res, query) {
  const playerQuery = normalizeText(query.playerId || query.player);
  const analyses = readTeamAnalyses();
  const analysis = requestedTeam(query, analyses);
  if (!analysis) {
    return sendError(res, 404, "Hedef takim analizi bulunamadi.", "TEAM_ANALYSIS_NOT_FOUND", "FutbolRadar API");
  }
  if (!playerQuery) {
    return sendError(res, 400, "playerId veya player parametresi gerekli.", "PLAYER_QUERY_REQUIRED", "FutbolRadar API");
  }

  const playerPayload = await getPlayerData({});
  const player = playerPayload.data.find((item) =>
    [item.id, item.slug, item.providerId, item.name].map(normalizeText).includes(playerQuery)
  );
  if (!player) {
    return sendError(res, 404, "Oyuncu kaydi bulunamadi.", "PLAYER_NOT_FOUND", "FutbolRadar API");
  }
  if (["pending", "review", "rumour", "rumor"].includes(normalizeText(player.transferStatus || player.squadStatus))) {
    return sendError(res, 409, "Inceleme bekleyen transfer icin uyum analizi yayimlanmiyor.", "TRANSFER_PENDING_REVIEW", "FutbolRadar API");
  }

  const team = findTeamRecord(analysis);
  const fit = computeTransferFit(player, analysis, { team });
  return sendComputed(res, fit, analysis.generatedAt);
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  const route = routeName(req);
  if (route === "matches") {
    return matchesHandler(req, res);
  }

  setCachePolicy(res, [
    "team-analysis",
    "team-lineup",
    "team-depth",
    "team-needs",
    "formation-compare",
    "transfer-fit"
  ].includes(route) ? "analyses" : "players");
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

  if (["team-analysis", "team-lineup", "team-depth", "team-needs", "formation-compare"].includes(route)) {
    return handleTeamAnalysis(req, res, query, route);
  }

  if (route === "transfer-fit") {
    return handleTransferFit(req, res, query);
  }

  return sendError(res, 404, "API endpoint bulunamadi.", "API_ROUTE_NOT_FOUND");
};
