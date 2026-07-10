const { getProvider, mockProvider } = require("./providers");
const { mergeProviderPlayers } = require("../services/playerService");
const { enrichPlayerRating } = require("../services/ratingService");
const {
  DEFAULT_TIMEOUT_MS,
  getQuery,
  normalizeText,
  rateLimitHint,
  rejectUnsupportedMethod,
  sendError,
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

function requestedPlayers(query) {
  const explicit = String(query.players || "")
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
  const positional = [query.p1, query.p2, query.p3].map((item) => normalizeText(item)).filter(Boolean);
  return (explicit.length ? explicit : positional).slice(0, 3);
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  rateLimitHint(req);

  const query = getQuery(req);
  const { data, source } = await getPlayers(query);
  const wanted = requestedPlayers(query);
  const selected = wanted.length
    ? data.filter((player) => wanted.includes(normalizeText(player.id)) || wanted.includes(normalizeText(player.slug)))
    : data.slice(0, 3);

  if (selected.length < 2) {
    return sendError(res, 200, "Karsilastirma icin en az iki oyuncu bulunmali.", "PLAYER_COMPARE_NOT_ENOUGH_PLAYERS", source);
  }

  return sendSuccess(res, selected.slice(0, 3), source);
};
