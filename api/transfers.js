const { getProvider, mockProvider } = require("../services/providers");
const { mergeProviderTransfers } = require("../services/playerService");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendSuccess,
  setCachePolicy,
  validateOrSend,
  validateTransfers,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "transfers");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);
  const provider = getProvider("transfers");
  const localData = await mockProvider.getPlayerTransfers(query);
  let data = localData;
  let source = mockProvider.source;

  try {
    if (provider !== mockProvider) {
      const providerData = await withTimeout(provider.getPlayerTransfers(query), DEFAULT_TIMEOUT_MS);
      if (Array.isArray(providerData) && providerData.length) {
        data = mergeProviderTransfers(localData, providerData);
        source = provider.source;
      }
    }
  } catch (error) {
    data = localData;
    source = mockProvider.source;
  }

  if (!validateOrSend(res, data, validateTransfers)) {
    return;
  }

  return sendSuccess(res, data, source);
};
