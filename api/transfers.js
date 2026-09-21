const { getProvider, mockProvider } = require("../services/providers");
const { mergeProviderTransfers } = require("../services/playerService");
const { withDisplayStatus } = require("../services/transferDisplayStatus");
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

  // DURUM BURADA DAMGALANIR — "Resmî" rozetinin kaynak koşulu tek yerde.
  //
  // Kural services/transferDisplayStatus.js içinde ve kaynak alan adları
  // services/sourceTrust.js içinde duruyor; ikisi de sunucuda kalıyor.
  // İstemciye yalnızca SONUÇ gidiyor, böylece bant istemcide yeniden
  // çizildiğinde ön derlenmiş rozetten farklı bir şey göstermiyor.
  return sendSuccess(res, withDisplayStatus(data), source);
};
