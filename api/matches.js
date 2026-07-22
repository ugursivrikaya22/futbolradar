const { getProvider } = require("../services/providers");
const { providerLeagueValue } = require("../services/competitionCatalog");
const { dedupeMatches } = require("../services/matchDataService");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy,
  validateDateParam,
  validateMatches,
  validateOrSend,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "matches");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);
  const dateError = validateDateParam(query.date);
  if (dateError) {
    return sendError(res, 200, dateError, "INVALID_DATE");
  }

  const provider = getProvider("matches");
  const providerQuery = {
    ...query,
    requestedCompetition: query.league || "",
    league: providerLeagueValue(query.league, provider.name)
  };
  if (query.league && providerQuery.league === null) {
    return sendError(
      res,
      200,
      "Seçilen turnuva mevcut canlı veri sağlayıcısında desteklenmiyor; yedek veri denenecek.",
      "COMPETITION_NOT_SUPPORTED"
    );
  }
  let data = [];

  try {
    data = dedupeMatches(await withTimeout(provider.getMatches(providerQuery), DEFAULT_TIMEOUT_MS));
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
