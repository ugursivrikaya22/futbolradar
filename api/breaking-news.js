const { enforceRateLimit, rejectUnsupportedMethod, sendSuccess, setCachePolicy } = require("./_utils");
const { recordNewsIngestion } = require("../services/ingestionMonitor");
const { buildBreakingNewsFeed } = require("../services/newsIngestionService");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) return;
  setCachePolicy(res, "breaking-news");
  if (enforceRateLimit(req, res)) return;

  const startedAt = Date.now();
  const data = buildBreakingNewsFeed();
  recordNewsIngestion({ imported: data.length, rejected: 0, durationMs: Date.now() - startedAt });
  return sendSuccess(res, data, "FutbolRadar verified news", data[0] && data[0].time, {
    verifiedOnly: data.every((item) => item.status === "verified"),
    count: data.length
  });
};
