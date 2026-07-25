const { providerMeta, resolveFromProviders } = require("../services/liveDataService");
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
} = require("./_utils");

/**
 * Günün maç listesi.
 *
 * Every configured provider is tried in order and only then the curated
 * data set. A single provider failing (expired plan, rate limit, timeout)
 * used to return `ok:false` with an empty array, which rendered the match
 * pages as "bugün maç yok" even when another source had the fixtures. The
 * endpoint now degrades instead of failing, and reports what happened in
 * `meta` so the same class of outage is diagnosable from the response.
 */
module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  // Canlı skor isteği taze olmalı; günlük liste daha uzun önbelleklenebilir.
  setCachePolicy(res, getQuery(req).live ? "matches-live" : "matches");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);
  const dateError = validateDateParam(query.date);
  if (dateError) {
    return sendError(res, 200, dateError, "INVALID_DATE");
  }

  const result = await resolveFromProviders({
    resource: "matches",
    query,
    run: (provider, providerQuery) => provider.getMatches(providerQuery)
  });

  if (!result.provider) {
    const firstError = result.attempts.find((attempt) => attempt.status === "error");
    return sendError(
      res,
      200,
      (firstError && firstError.message) || "Mac verisi hicbir saglayicidan alinamadi.",
      (firstError && firstError.code) || "PROVIDER_ERROR"
    );
  }

  const data = Array.isArray(result.data) ? result.data : [];
  if (!validateOrSend(res, data, validateMatches)) {
    return;
  }

  return sendSuccess(res, data, result.provider.source, undefined, providerMeta(result));
};
