const { getProvider, mockProvider } = require("./providers");
const { mergeProviderPlayers } = require("../services/playerService");
const { enrichPlayerRating } = require("../services/ratingService");
const {
  DEFAULT_TIMEOUT_MS,
  getQuery,
  normalizeText,
  rateLimitHint,
  rejectUnsupportedMethod,
  sendSuccess,
  withTimeout
} = require("./_utils");

async function getPlayers(query) {
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

  return numberValue(player.overallRating || player.aiRating || player.rating, 0);
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  rateLimitHint(req);

  const query = getQuery(req);
  const type = normalizeText(query.type || "overall");
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
  const { data, source } = await getPlayers(query);
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
};
