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

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  rateLimitHint(req);

  const query = getQuery(req);
  const wanted = normalizeText(query.id || query.slug || query.player || query.playerId);
  const { data, source } = await getPlayers(query);
  const player = wanted
    ? data.find((item) => {
      return normalizeText(item.id) === wanted || normalizeText(item.slug) === wanted || normalizeText(item.name) === wanted;
    })
    : data[0];

  if (!player) {
    return sendError(res, 200, "Oyuncu kaydi bulunamadi.", "PLAYER_NOT_FOUND", source);
  }

  return sendSuccess(res, [player], source);
};
