const teams = require("../data/teams.json");
const matches = require("../data/matches.json");
const { computeLeagueMomentum } = require("../services/momentumService");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy,
  validateMomentum,
  validateOrSend,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "momentum");
  if (enforceRateLimit(req, res)) return;

  getQuery(req);
  let data = [];

  try {
    data = await withTimeout(Promise.resolve(computeLeagueMomentum(teams, matches, teams)), DEFAULT_TIMEOUT_MS);
  } catch (error) {
    return sendError(
      res,
      200,
      error.message || "Momentum verisi hesaplanamadi.",
      error.code || "PROVIDER_ERROR"
    );
  }

  if (!validateOrSend(res, data, validateMomentum)) {
    return;
  }

  return sendSuccess(res, data, "FutbolRadar Computed API");
};
