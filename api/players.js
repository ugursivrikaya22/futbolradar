const { getProvider, mockProvider } = require("./providers");
const { mergeProviderPlayers } = require("../services/playerService");
const { enrichPlayerRating } = require("../services/ratingService");
const {
  DEFAULT_TIMEOUT_MS,
  getQuery,
  rateLimitHint,
  rejectUnsupportedMethod,
  sendSuccess,
  validateOrSend,
  validatePlayers,
  withTimeout
} = require("./_utils");

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

  data = data.map((player) => enrichPlayerRating(player));

  return sendSuccess(res, data, source);
};
