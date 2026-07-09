const matches = require("../data/matches.json");
const teams = require("../data/teams.json");
const fallbackSignals = require("../data/signals.json");
const { computeLeagueMomentum } = require("../services/momentumService");
const { generateSignals } = require("../services/signalService");
const {
  DEFAULT_TIMEOUT_MS,
  getQuery,
  rateLimitHint,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  validateOrSend,
  validateSignals,
  withTimeout
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  rateLimitHint(req);

  getQuery(req);
  let data = [];

  try {
    const momentum = computeLeagueMomentum(teams, matches, teams);
    data = await withTimeout(Promise.resolve(generateSignals({ matches, standings: teams, momentum })), DEFAULT_TIMEOUT_MS);
    if (!data.length) {
      data = [].concat(fallbackSignals.radarSignals || [], fallbackSignals.momentumSignals || []);
    }
  } catch (error) {
    return sendError(
      res,
      200,
      error.message || "Radar sinyali hesaplanamadi.",
      error.code || "PROVIDER_ERROR"
    );
  }

  if (!validateOrSend(res, data, validateSignals)) {
    return;
  }

  return sendSuccess(res, data, "FutbolRadar Computed API");
};
