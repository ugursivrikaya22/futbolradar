const { getProvider } = require("../services/providers");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy,
  validateAnalyses,
  validateOrSend,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "analyses");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);
  const provider = getProvider("analyses");
  let data = [];

  try {
    data = await withTimeout(provider.getAnalyses(query), DEFAULT_TIMEOUT_MS);
  } catch (error) {
    return sendError(
      res,
      200,
      error.message || "Analiz verisi provider katmanindan alinamadi.",
      error.code || "PROVIDER_ERROR"
    );
  }

  if (!validateOrSend(res, data, validateAnalyses)) {
    return;
  }

  return sendSuccess(res, data, provider.source);
};
