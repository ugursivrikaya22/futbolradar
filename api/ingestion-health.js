const { rejectUnsupportedMethod, sendError, sendSuccess, setCachePolicy } = require("./_utils");
const { snapshot } = require("../services/ingestionMonitor");

function suppliedToken(req) {
  return String((req.headers && req.headers["x-futbolradar-health-token"]) || "").trim();
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) return;
  setCachePolicy(res, "health");
  const expected = String(process.env.INGESTION_HEALTH_TOKEN || "").trim();

  if (!expected || suppliedToken(req) !== expected) {
    return sendError(res, 404, "Kaynak bulunamadı.", "NOT_FOUND");
  }

  return sendSuccess(res, snapshot(), "FutbolRadar ingestion monitor", new Date().toISOString());
};
