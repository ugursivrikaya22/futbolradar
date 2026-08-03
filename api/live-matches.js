const { enforceRateLimit, rejectUnsupportedMethod, sendSuccess, setCachePolicy } = require("./_utils");
const { getLiveMatchFeed } = require("../services/liveMatchFeedService");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) return;
  setCachePolicy(res, "live-feed");
  if (enforceRateLimit(req, res)) return;

  const feed = await getLiveMatchFeed();
  return sendSuccess(res, feed.items, feed.provider || "verified-live-feed", feed.updatedAt, {
    ...feed.meta,
    stale: feed.stale,
    awaitingVerifiedData: Boolean(feed.awaitingVerifiedData),
    lastSuccessfulUpdateAt: feed.updatedAt
  });
};
