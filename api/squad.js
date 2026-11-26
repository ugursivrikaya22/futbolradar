const { getProvider, mockProvider } = require("../services/providers");
const { collapseDuplicates } = require("../services/duplicatePlayerService");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendSuccess,
  setCachePolicy,
  validateOrSend,
  validateSquad,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "squad");
  if (enforceRateLimit(req, res)) return;

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

  // Sağlayıcı/yerel kaynak fark etmeksizin: tek kayıt, tam ad, Türkçe tek tip mevki.
  data = collapseDuplicates(data);

  if (!validateOrSend(res, data, validateSquad)) {
    return;
  }

  return sendSuccess(res, data, source);
};
