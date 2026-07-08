const { getProvider } = require("./providers");
const {
  DEFAULT_TIMEOUT_MS,
  getQuery,
  rateLimitHint,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  validateDateParam,
  validateMatches,
  validateOrSend,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  rateLimitHint(req);

  const query = getQuery(req);
  const dateError = validateDateParam(query.date);
  if (dateError) {
    return sendError(res, 200, dateError, "INVALID_DATE");
  }

  const provider = getProvider("matches");
  let data = [];

  try {
    data = await withTimeout(provider.getMatches(query), DEFAULT_TIMEOUT_MS);
  } catch (error) {
    return sendError(
      res,
      200,
      error.message || "Mac verisi provider katmanindan alinamadi.",
      error.code || "PROVIDER_ERROR"
    );
  }

  if (!validateOrSend(res, data, validateMatches)) {
    return;
  }

  return sendSuccess(res, data, provider.source);
};
