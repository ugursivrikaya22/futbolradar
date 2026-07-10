const { getProvider } = require("../services/providers");
const {
  DEFAULT_TIMEOUT_MS,
  getQuery,
  rateLimitHint,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  validateOrSend,
  validateStandings,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  rateLimitHint(req);

  const query = getQuery(req);
  const provider = getProvider("standings");
  let data = [];

  try {
    data = await withTimeout(provider.getStandings(query), DEFAULT_TIMEOUT_MS);
  } catch (error) {
    return sendError(
      res,
      200,
      error.message || "Puan durumu provider katmanindan alinamadi.",
      error.code || "PROVIDER_ERROR"
    );
  }

  if (!validateOrSend(res, data, validateStandings)) {
    return;
  }

  return sendSuccess(res, data, provider.source);
};
