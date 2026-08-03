const { providerMeta, resolveFromProviders } = require("./liveDataService");
const { recordLiveFailure, recordLiveSuccess } = require("./ingestionMonitor");
const { liveVerdict } = require("./matchStatus");
const { isTurkishMatch } = require("./turkishTeams");

const MAX_LIVE_MATCHES = 24;
const STALE_AFTER_MS = 2 * 60 * 1000;
const PUBLISHABLE_PROVIDERS = new Set(["api-football", "football-data"]);
let lastSuccessfulSnapshot = null;

function matchTimestamp(match, fallback) {
  const value = match && (match.fetchedAt || match.providerUpdatedAt || match.updatedAt || match.lastVerifiedAt);
  const parsed = Date.parse(value || "");
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function hasUsableScore(match) {
  const score = match && match.score;
  if (!score || score.home === null || score.home === undefined || score.home === "" ||
    score.away === null || score.away === undefined || score.away === "") {
    return false;
  }
  return Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
}

function isPublishableLiveMatch(match, nowMs) {
  return Boolean(
    match && match.id && match.homeTeam && match.awayTeam && match.league &&
    hasUsableScore(match) && liveVerdict(match, { nowMs }).live
  );
}

function priority(match) {
  return isTurkishMatch(match) ? 0 : 1;
}

function normalise(match, providerName, nowIso) {
  return {
    id: String(match.id),
    type: "match",
    homeTeam: String(match.homeTeam),
    awayTeam: String(match.awayTeam),
    league: String(match.league),
    status: String(match.status || match.providerStatus || "LIVE"),
    minute: Number.isFinite(Number(match.minute)) ? Number(match.minute) : null,
    score: { home: Number(match.score.home), away: Number(match.score.away) },
    href: `/canli-skor.html#${encodeURIComponent(String(match.id))}`,
    source: providerName,
    sourceName: providerName === "api-football" ? "API-Football" : "football-data.org",
    timestamp: matchTimestamp(match, nowIso),
    isVerified: true,
    isStale: false,
    isTurkishPriority: isTurkishMatch(match)
  };
}

function snapshotFrom(matches, providerName, nowIso) {
  const nowMs = Date.parse(nowIso);
  return matches
    .filter((match) => isPublishableLiveMatch(match, nowMs))
    .sort((left, right) => priority(left) - priority(right) || String(left.id).localeCompare(String(right.id)))
    .slice(0, MAX_LIVE_MATCHES)
    .map((match) => normalise(match, providerName, nowIso));
}

function staleSnapshot(nowIso) {
  if (!lastSuccessfulSnapshot || !lastSuccessfulSnapshot.items.length) return null;
  const ageMs = Date.parse(nowIso) - Date.parse(lastSuccessfulSnapshot.updatedAt);
  if (!Number.isFinite(ageMs) || ageMs > STALE_AFTER_MS) return null;
  return {
    ...lastSuccessfulSnapshot,
    items: lastSuccessfulSnapshot.items.map((item) => ({ ...item, isStale: true })),
    stale: true
  };
}

async function getLiveMatchFeed(options = {}) {
  const resolve = options.resolve || resolveFromProviders;
  const nowIso = options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
  const startedAt = Date.now();
  const result = await resolve({
    resource: "matches",
    query: { live: "all" },
    run: (provider, query) => provider.getMatches(query),
    isUsable: (data) => Array.isArray(data)
  });
  const providerName = result.provider && result.provider.name;

  if (PUBLISHABLE_PROVIDERS.has(providerName)) {
    const items = snapshotFrom(Array.isArray(result.data) ? result.data : [], providerName, nowIso);
    const snapshot = {
      items,
      provider: providerName,
      updatedAt: nowIso,
      stale: false,
      meta: providerMeta(result, { liveOnly: true, fallback: false })
    };
    lastSuccessfulSnapshot = snapshot;
    recordLiveSuccess({ count: items.length, durationMs: Date.now() - startedAt });
    return snapshot;
  }

  const fallback = staleSnapshot(nowIso);
  recordLiveFailure({
    code: providerName === "mock" ? "LIVE_PROVIDER_UNAVAILABLE" : "LIVE_PROVIDER_EMPTY",
    durationMs: Date.now() - startedAt
  });
  if (fallback) {
    recordLiveSuccess({ count: fallback.items.length, durationMs: Date.now() - startedAt, stale: true });
    return { ...fallback, meta: providerMeta(result, { liveOnly: true, fallback: true }) };
  }

  return {
    items: [],
    provider: null,
    updatedAt: null,
    stale: false,
    awaitingVerifiedData: true,
    meta: providerMeta(result, { liveOnly: true, fallback: false })
  };
}

function resetLiveMatchFeed() {
  lastSuccessfulSnapshot = null;
}

module.exports = {
  MAX_LIVE_MATCHES,
  PUBLISHABLE_PROVIDERS,
  STALE_AFTER_MS,
  getLiveMatchFeed,
  isPublishableLiveMatch,
  resetLiveMatchFeed,
  snapshotFrom
};
