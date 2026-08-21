const { getProvider, mockProvider } = require("../services/providers");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendSuccess,
  setCachePolicy,
  validateMatchDetail,
  validateOrSend,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "match-detail");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);
  const provider = getProvider("match-detail");
  const localDetail = await mockProvider.getMatchDetail(query);
  let detail = localDetail;
  let source = mockProvider.source;

  try {
    if (provider !== mockProvider && typeof provider.getMatchDetail === "function") {
      const providerDetail = await withTimeout(provider.getMatchDetail(query), DEFAULT_TIMEOUT_MS);
      if (providerDetail) {
        detail = providerDetail;
        source = provider.source;
      }
    }
  } catch (error) {
    detail = localDetail;
    source = mockProvider.source;
  }

  const data = detail ? [detail] : [];

  if (!validateOrSend(res, data, validateMatchDetail)) {
    return;
  }

  // Maç CANLIYSA önbellek politikası no-store'a geçer — bitmiş/başlamamış
  // maçta üstteki normal politika (kısa CDN önbelleği) geçerli kalır,
  // çünkü orada içerik dakikalarca değişmiyor ve önbellek gerçek bir
  // fayda sağlıyor.
  const status = String((detail && (detail.status || detail.providerStatus)) || "").toUpperCase();
  if (["LIVE", "HALFTIME", "1H", "2H", "ET", "P", "BT", "IN_PLAY", "PAUSED"].includes(status)) {
    setCachePolicy(res, "match-detail-live");
  }

  return sendSuccess(res, data, source);
};
