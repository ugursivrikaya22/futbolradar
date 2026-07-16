const { getProvider } = require("../services/providers");
const { providerLeagueValue } = require("../services/competitionCatalog");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy,
  validateOrSend,
  validateStandings,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "standings");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);
  const provider = getProvider("standings");
  const providerQuery = {
    ...query,
    league: providerLeagueValue(query.league, provider.name)
  };
  if (query.league && providerQuery.league === null) {
    return sendError(
      res,
      200,
      "Seçilen turnuvanın puan durumu mevcut veri sağlayıcısında desteklenmiyor.",
      "COMPETITION_NOT_SUPPORTED"
    );
  }
  let data = [];

  try {
    data = await withTimeout(provider.getStandings(providerQuery), DEFAULT_TIMEOUT_MS);
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
