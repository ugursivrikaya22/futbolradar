const { providerMeta, resolveFromProviders } = require("../services/liveDataService");
const {
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy,
  validateOrSend,
  validateStandings
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "standings");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);
  const result = await resolveFromProviders({
    resource: "standings",
    // Live providers need an explicit league; the curated provider answers
    // for the default competition on its own.
    query: { ...query, league: query.league || "super-lig" },
    run: (provider, providerQuery) => provider.getStandings(
      provider.name === "mock" ? query : providerQuery
    )
  });

  if (!result.provider) {
    const firstError = result.attempts.find((attempt) => attempt.status === "error");
    return sendError(
      res,
      200,
      (firstError && firstError.message) || "Puan durumu hicbir saglayicidan alinamadi.",
      (firstError && firstError.code) || "PROVIDER_ERROR"
    );
  }

  const data = Array.isArray(result.data) ? result.data : [];
  if (!validateOrSend(res, data, validateStandings)) {
    return;
  }

  return sendSuccess(res, data, result.provider.source, undefined, providerMeta(result));
};
