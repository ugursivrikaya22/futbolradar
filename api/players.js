const { getProvider, mockProvider } = require("../services/providers");
const { mergeProviderPlayers } = require("../services/playerService");
const { enrichPlayerRating } = require("../services/ratingService");
const {
  DEFAULT_TIMEOUT_MS,
  getQuery,
  normalizeText,
  rateLimitHint,
  rejectUnsupportedMethod,
  sendSuccess,
  validateOrSend,
  validatePlayers,
  withTimeout
} = require("./_utils");

function currentTeam(player) {
  return player.currentTeam || player.team || "";
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function textMatches(value, wanted) {
  return normalizeText(value).includes(wanted);
}

function applyPlayerFilters(players, query) {
  let data = Array.isArray(players) ? players.slice() : [];
  const search = normalizeText(query.search || query.q);
  const team = normalizeText(query.team || query.teamId);
  const league = normalizeText(query.league);
  const position = normalizeText(query.position);
  const positionGroup = normalizeText(query.positionGroup);
  const dataStatus = normalizeText(query.dataStatus);
  const ratingStatus = normalizeText(query.ratingStatus);
  const minRating = Number(query.minRating || query.rating);
  const maxRating = Number(query.maxRating);
  const maxAge = Number(query.maxAge);
  const minAge = Number(query.minAge);
  const minMarketValue = Number(query.minMarketValue);
  const maxMarketValue = Number(query.maxMarketValue);
  const hasTransfers = normalizeText(query.hasTransfers);
  const needsUpdate = normalizeText(query.needsUpdate);
  const sort = normalizeText(query.sort || "rating");
  const limit = Number(query.limit);

  if (search) {
    data = data.filter((player) => {
      return [
        player.name,
        player.fullName,
        currentTeam(player),
        player.position,
        player.nationality,
        player.league
      ].some((value) => textMatches(value, search));
    });
  }

  if (team) {
    data = data.filter((player) => textMatches(currentTeam(player), team));
  }

  if (league) {
    data = data.filter((player) => textMatches(player.league, league));
  }

  if (position) {
    data = data.filter((player) => textMatches(player.position, position));
  }

  if (positionGroup) {
    data = data.filter((player) => normalizeText(player.positionGroup) === positionGroup);
  }

  if (dataStatus) {
    data = data.filter((player) => normalizeText(player.dataStatus) === dataStatus);
  }

  if (ratingStatus) {
    data = data.filter((player) => normalizeText(player.ratingStatus) === ratingStatus);
  }

  if (Number.isFinite(minRating)) {
    data = data.filter((player) => numberValue(player.overallRating || player.aiRating || player.rating, 0) >= minRating);
  }

  if (Number.isFinite(maxRating)) {
    data = data.filter((player) => numberValue(player.overallRating || player.aiRating || player.rating, 0) <= maxRating);
  }

  if (Number.isFinite(minAge)) {
    data = data.filter((player) => numberValue(player.computedAge || player.age, 0) >= minAge);
  }

  if (Number.isFinite(maxAge)) {
    data = data.filter((player) => {
      const age = numberValue(player.computedAge || player.age, 0);
      return age > 0 && age <= maxAge;
    });
  }

  if (Number.isFinite(minMarketValue)) {
    data = data.filter((player) => numberValue(player.marketValueEur, 0) >= minMarketValue);
  }

  if (Number.isFinite(maxMarketValue)) {
    data = data.filter((player) => numberValue(player.marketValueEur, 0) <= maxMarketValue);
  }

  if (["1", "true", "yes"].includes(hasTransfers)) {
    data = data.filter((player) => Array.isArray(player.transferHistory) && player.transferHistory.length > 0);
  }

  if (["1", "true", "yes"].includes(needsUpdate)) {
    data = data.filter((player) => {
      const status = normalizeText(player.dataStatus);
      return status.includes("stale") || status.includes("monitoring") || status.includes("mock_needs_verification") || status.includes("manual-review");
    });
  }

  const sorters = {
    rating: (a, b) => numberValue(b.overallRating || b.aiRating || b.rating, 0) - numberValue(a.overallRating || a.aiRating || a.rating, 0),
    age: (a, b) => numberValue(a.computedAge || a.age, 999) - numberValue(b.computedAge || b.age, 999),
    market: (a, b) => numberValue(b.marketValueEur, 0) - numberValue(a.marketValueEur, 0),
    form: (a, b) => numberValue(b.radar && b.radar.form, b.formRating || 0) - numberValue(a.radar && a.radar.form, a.formRating || 0),
    potential: (a, b) => numberValue(b.radar && b.radar.potential, b.potentialRating || 0) - numberValue(a.radar && a.radar.potential, a.potentialRating || 0),
    updated: (a, b) => String(b.transferUpdatedAt || b.lastUpdated || "").localeCompare(String(a.transferUpdatedAt || a.lastUpdated || "")),
    team: (a, b) => currentTeam(a).localeCompare(currentTeam(b), "tr")
  };

  data.sort(sorters[sort] || sorters.rating);

  if (Number.isFinite(limit) && limit > 0) {
    data = data.slice(0, limit);
  }

  return data;
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  rateLimitHint(req);

  const query = getQuery(req);
  const provider = getProvider("players");
  const localData = await mockProvider.getPlayers(query);
  let data = [];
  let source = provider.source;

  try {
    if (provider === mockProvider) {
      data = localData;
      source = mockProvider.source;
    } else {
      const providerData = await withTimeout(provider.getPlayers(query), DEFAULT_TIMEOUT_MS);
      data = Array.isArray(providerData) && providerData.length
        ? mergeProviderPlayers(localData, providerData, provider.name)
        : localData;
      source = Array.isArray(providerData) && providerData.length ? provider.source : mockProvider.source;
    }
  } catch (error) {
    data = localData;
    source = mockProvider.source;
  }

  if (!validateOrSend(res, data, validatePlayers)) {
    return;
  }

  data = applyPlayerFilters(data.map((player) => enrichPlayerRating(player)), query);

  return sendSuccess(res, data, source);
};
