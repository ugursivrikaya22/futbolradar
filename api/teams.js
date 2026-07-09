const { getProvider, mockProvider } = require("./providers");
const {
  DEFAULT_TIMEOUT_MS,
  getQuery,
  rateLimitHint,
  rejectUnsupportedMethod,
  sendSuccess,
  validateOrSend,
  validateTeams,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  rateLimitHint(req);

  const query = getQuery(req);
  const provider = getProvider("teams");
  const localData = await mockProvider.getTeams(query);
  let data = localData;
  let source = mockProvider.source;

  try {
    if (provider !== mockProvider) {
      const providerData = await withTimeout(provider.getTeams(query), DEFAULT_TIMEOUT_MS);
      if (Array.isArray(providerData) && providerData.length) {
        data = providerData.map((team) => ({
          ...team,
          momentum: team.momentum == null ? 0 : team.momentum,
          rating: team.rating == null ? team.momentum || 0 : team.rating
        }));
        source = provider.source;
      }
    }
  } catch (error) {
    data = localData;
    source = mockProvider.source;
  }

  if (!validateOrSend(res, data, validateTeams)) {
    return;
  }

  return sendSuccess(res, data, source);
};
