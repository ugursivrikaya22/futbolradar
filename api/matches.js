const { getProvider, mockProvider } = require("../services/providers");
const { providerLeagueValue } = require("../services/competitionCatalog");
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
  // The verified local fixtures are the floor, exactly as /api/transfers
  // already works. A failing or empty live provider used to return zero
  // matches, which hid confirmed fixtures behind the frontend's "no matches
  // today" fallback. Note the mock reads the raw query: providerQuery.league
  // has already been rewritten to a provider-specific code.
  let data = await mockProvider.getMatches(query);
  let source = mockProvider.source;

  if (provider !== mockProvider) {
    try {
      const providerData = await withTimeout(provider.getMatches(providerQuery), DEFAULT_TIMEOUT_MS);
      if (Array.isArray(providerData) && providerData.length) {
        data = providerData;
        source = provider.source;
      }
    } catch {
      data = await mockProvider.getMatches(query);
      source = mockProvider.source;
    }
  }

  if (!validateOrSend(res, data, validateMatches)) {
    return;
  }

  return sendSuccess(res, data, source);
};
