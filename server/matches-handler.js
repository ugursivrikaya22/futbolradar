const { findCompetition, providerLeagueValue } = require("../services/competitionCatalog");
const { getDailyMatches } = require("../services/dailyFixturesService");
const { mockProvider } = require("../services/providers");
const {
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy,
  validateDateParam,
  validateMatches,
  validateOrSend
} = require("../api/_utils");

function sourceForResult(result) {
  if (result && result.source) return result.source;
  if (result && result.manualMatches && result.manualMatches.length) return "manual-verified";
  return mockProvider.source;
}

module.exports = async function matchesHandler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "matches");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);
  if (query.mode === "live") setCachePolicy(res, "live-matches");
  const dateError = validateDateParam(query.date);
  if (dateError) {
    return sendError(res, 200, dateError, "INVALID_DATE");
  }

  const providerName = "api-football";
  const providerQuery = {
    ...query,
    timezone: query.timezone || query.timeZone || "Europe/Istanbul",
    includeFriendlies: query.includeFriendlies === undefined ? "true" : query.includeFriendlies,
    requestedCompetition: query.league || "",
    league: providerLeagueValue(query.league, providerName)
  };
  if (query.league && providerQuery.league === null) {
    return sendError(
      res,
      200,
      "Seçilen turnuva mevcut canlı veri sağlayıcısında desteklenmiyor; yedek veri denenecek.",
      "COMPETITION_NOT_SUPPORTED"
    );
  }

  let result;
  try {
    result = await getDailyMatches(providerQuery);
  } catch (error) {
    return sendError(
      res,
      200,
      error.message || "Maç verisi provider katmanından alınamadı.",
      error.code || "PROVIDER_ERROR"
    );
  }

  let data = result.data;
  if (query.mode === "live") {
    data = data.filter((match) => match.live || match.status === "LIVE");
  }
  if (query.league) {
    const requestedCompetition = findCompetition(query.league);
    if (requestedCompetition) {
      data = data.filter((match) => match.competitionId === requestedCompetition.id);
    }
  }

  setCachePolicy(res, data.some((match) => match.live || match.status === "LIVE") ? "live-matches" : "matches");

  if (!validateOrSend(res, data, validateMatches)) {
    return;
  }

  return sendSuccess(res, data, sourceForResult(result));
};
