const { getProvider, mockProvider } = require("../services/providers");
const {
  DEFAULT_TIMEOUT_MS,
  getQuery,
  rateLimitHint,
  rejectUnsupportedMethod,
  sendSuccess,
  validateOrSend,
  validateSquad,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  rateLimitHint(req);

  const query = getQuery(req);
  const provider = getProvider("squad");
  const localData = await mockProvider.getSquad(query);
  let data = localData;
  let source = mockProvider.source;

  try {
    if (provider !== mockProvider) {
      const providerData = await withTimeout(provider.getSquad(query), DEFAULT_TIMEOUT_MS);
      if (Array.isArray(providerData) && providerData.length) {
        data = providerData;
        source = provider.source;
      }
    }
  } catch (error) {
    data = localData;
    source = mockProvider.source;
  }

  if (!validateOrSend(res, data, validateSquad)) {
    return;
  }

  return sendSuccess(res, data, source);
};
