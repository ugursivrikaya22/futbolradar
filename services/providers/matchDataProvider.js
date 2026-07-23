const REQUIRED_METHODS = Object.freeze([
  "fetchCompetitions",
  "fetchMatchesByDate",
  "fetchLiveMatches",
  "fetchMatchDetails",
  "fetchBroadcasts"
]);

const OPTIONAL_METHODS = Object.freeze([
  "fetchFixturesByDate",
  "fetchLiveFixtures",
  "fetchFixtureDetails",
  "fetchMatchEvents",
  "fetchStandings"
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
  const provider = {
    name: adapter.name,
    source: adapter.source,
    fetchCompetitions: adapter.fetchCompetitions,
    fetchMatchesByDate: adapter.fetchMatchesByDate,
    fetchLiveMatches: adapter.fetchLiveMatches,
    fetchMatchDetails: adapter.fetchMatchDetails,
    fetchBroadcasts: adapter.fetchBroadcasts,
    fetchFixturesByDate: adapter.fetchFixturesByDate || adapter.fetchMatchesByDate,
    fetchLiveFixtures: adapter.fetchLiveFixtures || adapter.fetchLiveMatches,
    fetchFixtureDetails: adapter.fetchFixtureDetails || adapter.fetchMatchDetails,
    fetchMatchEvents: adapter.fetchMatchEvents || (async (providerMatchId) => {
      const detail = await adapter.fetchMatchDetails(providerMatchId);
      return detail && Array.isArray(detail.events) ? detail.events : [];
    }),
    fetchStandings: adapter.fetchStandings || adapter.getStandings || (async () => [])
  };
  return assertMatchDataProvider(provider);
}

module.exports = { OPTIONAL_METHODS, REQUIRED_METHODS, assertMatchDataProvider, createMatchDataProvider };
