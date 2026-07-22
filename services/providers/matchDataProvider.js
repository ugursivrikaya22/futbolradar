const REQUIRED_METHODS = Object.freeze([
  "fetchCompetitions",
  "fetchMatchesByDate",
  "fetchLiveMatches",
  "fetchMatchDetails",
  "fetchBroadcasts"
]);

function assertMatchDataProvider(provider) {
  if (!provider || typeof provider !== "object") {
    throw new TypeError("MatchDataProvider nesnesi gerekli.");
  }
  const missing = REQUIRED_METHODS.filter((method) => typeof provider[method] !== "function");
  if (missing.length) {
    throw new TypeError(`MatchDataProvider eksik metotlar: ${missing.join(", ")}`);
  }
  return provider;
}

function createMatchDataProvider(adapter) {
  return assertMatchDataProvider({
    name: adapter.name,
    source: adapter.source,
    fetchCompetitions: adapter.fetchCompetitions,
    fetchMatchesByDate: adapter.fetchMatchesByDate,
    fetchLiveMatches: adapter.fetchLiveMatches,
    fetchMatchDetails: adapter.fetchMatchDetails,
    fetchBroadcasts: adapter.fetchBroadcasts
  });
}

module.exports = { REQUIRED_METHODS, assertMatchDataProvider, createMatchDataProvider };
