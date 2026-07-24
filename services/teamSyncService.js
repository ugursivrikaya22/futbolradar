const apiFootballProvider = require("./providers/apiFootballProvider");
const { normalizeText } = require("./matchRadarService");

const MAX_ACCEPTABLE_DROP_RATIO = 0.2;

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function providerSyncConfig() {
  const config = apiFootballProvider.getConfig();
  return { leagueId: config.leagueId, season: config.season, country: config.country };
}

/**
 * Never fetches for real unless a live API-Football key is configured
 * (APIFOOTBALL_API_KEY). Absence of config is a valid, expected state in
 * this repo today, not a failure — callers must branch on `status`.
 */
async function fetchCurrentSuperLigTeams() {
  if (!apiFootballProvider.hasConfig()) {
    return { status: "unavailable", reason: "no-provider-config", teams: [] };
  }

  const config = providerSyncConfig();
  if (!config.leagueId) {
    return { status: "unavailable", reason: "no-league-id-config", teams: [] };
  }

  try {
    const teams = await apiFootballProvider.getTeams({ league: config.leagueId, season: config.season });
    return { status: "fetched", reason: null, teams };
  } catch (error) {
    return { status: "unavailable", reason: error.code || "provider-error", teams: [] };
  }
}

/**
 * Guards against acting on a truncated/garbled provider response: a >20%
 * drop from the previously known team count blocks the sync rather than
 * silently shrinking the league.
 */
function evaluateTeamListChange(previousTeams, fetchedTeams) {
  const previousCount = Array.isArray(previousTeams) ? previousTeams.length : 0;
  const fetchedCount = Array.isArray(fetchedTeams) ? fetchedTeams.length : 0;

  if (previousCount === 0) {
    return { safe: true, reason: null, previousCount, fetchedCount };
  }

  if (fetchedCount === 0) {
    return { safe: false, reason: "empty-fetch-result", previousCount, fetchedCount };
  }

  const dropRatio = (previousCount - fetchedCount) / previousCount;
  if (dropRatio > MAX_ACCEPTABLE_DROP_RATIO) {
    return { safe: false, reason: `team-count-dropped-${Math.round(dropRatio * 100)}pct`, previousCount, fetchedCount };
  }

  return { safe: true, reason: null, previousCount, fetchedCount };
}

/**
 * Additive merge: promoted teams are appended, teams missing from the fresh
 * fetch are flagged isCurrentSuperLigTeam=false but never deleted (profile
 * and history stay intact for relegated clubs). Never invents duplicate
 * rows for the same club across a name change — provider ID is the primary
 * match key, falling back to normalized name only when providerId is absent
 * on the canonical row.
 */
function mergeTeamList(canonicalTeams, fetchedTeams) {
  const canonical = Array.isArray(canonicalTeams) ? canonicalTeams : [];
  const fetched = Array.isArray(fetchedTeams) ? fetchedTeams : [];
  const byProviderId = new Map(canonical.filter((team) => team.providerId).map((team) => [String(team.providerId), team]));
  const byName = new Map(canonical.map((team) => [normalizeText(team.name), team]));

  const merged = canonical.map((team) => ({ ...team, isCurrentSuperLigTeam: false }));
  const seenCanonicalIndexes = new Set();
  const additions = [];
  const conflicts = [];

  for (const fetchedTeam of fetched) {
    const matchByProvider = fetchedTeam.providerId ? byProviderId.get(String(fetchedTeam.providerId)) : null;
    const matchByName = byName.get(normalizeText(fetchedTeam.name));
    const match = matchByProvider || matchByName;

    if (match) {
      const index = merged.findIndex((team) => team === match || (team.id && team.id === match.id));
      if (index === -1) continue;
      seenCanonicalIndexes.add(index);
      merged[index] = {
        ...merged[index],
        providerId: merged[index].providerId || fetchedTeam.providerId || null,
        isCurrentSuperLigTeam: true,
        lastProviderSeenAt: new Date().toISOString()
      };
      if (matchByProvider && matchByName && matchByProvider !== matchByName) {
        conflicts.push({ providerId: fetchedTeam.providerId, name: fetchedTeam.name, reason: "provider-id-and-name-point-to-different-rows" });
      }
    } else {
      additions.push({
        id: fetchedTeam.id || slug(fetchedTeam.name),
        providerId: fetchedTeam.providerId || null,
        name: fetchedTeam.name,
        league: "Süper Lig",
        isCurrentSuperLigTeam: true,
        lastProviderSeenAt: new Date().toISOString(),
        source: "api-football"
      });
    }
  }

  return { merged: [...merged, ...additions], additions, conflicts };
}

module.exports = {
  fetchCurrentSuperLigTeams,
  evaluateTeamListChange,
  mergeTeamList,
  providerSyncConfig,
  MAX_ACCEPTABLE_DROP_RATIO
};
