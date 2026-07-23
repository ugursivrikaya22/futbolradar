function envFlag(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return Boolean(defaultValue);
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function featureFlags() {
  return Object.freeze({
    scoreFirstHomepage: envFlag("FEATURE_SCORE_HOMEPAGE", true),
    liveScores: envFlag("FEATURE_LIVE_SCORES", true),
    matchDetailTabs: envFlag("FEATURE_MATCH_DETAIL_TABS", true),
    advancedAnalysisTabs: envFlag("FEATURE_ADVANCED_ANALYSIS_TABS", true),
    newMatchPages: envFlag("FEATURE_NEW_MATCH_PAGES", true),
    newDailyFixtures: envFlag("FEATURE_NEW_DAILY_FIXTURES", true),
    automatedAnalysis: envFlag("FEATURE_AUTOMATED_ANALYSIS", false),
    dynamicOgImages: envFlag("FEATURE_DYNAMIC_OG_IMAGES", false),
    widgets: envFlag("FEATURE_WIDGETS", false),
    notifications: envFlag("FEATURE_NOTIFICATIONS", false)
  });
}

module.exports = { envFlag, featureFlags };
