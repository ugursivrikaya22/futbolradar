const { getProvider, mockProvider } = require("../services/providers");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendSuccess,
  setCachePolicy,
  validateOrSend,
  validateTeams,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "teams");
  if (enforceRateLimit(req, res)) return;

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
          momentum: team.momentum == null ? null : team.momentum,
          rating: team.rating == null ? (team.momentum == null ? null : team.momentum) : team.rating
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
