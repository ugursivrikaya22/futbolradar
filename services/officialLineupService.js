const apiFootballProvider = require("./providers/apiFootballProvider");
const { compareProbableAndOfficialLineup } = require("./lineupPredictionService");

const LINEUP_REFRESH_WINDOW_MINUTES = 180;

/**
 * Only ever called for fixtures inside the pre-kickoff refresh window
 * (see computeLineupRefreshTargets) — never a blind poll. Returns a typed
 * "pending"/"unavailable" state rather than throwing so callers can decide
 * whether to keep the probable lineup untouched.
 */
async function fetchOfficialLineup(fixtureId) {
  if (!apiFootballProvider.hasConfig()) {
    return { status: "unavailable", reason: "no-provider-config", raw: null };
  }
  if (!fixtureId) {
    return { status: "unavailable", reason: "no-fixture-id", raw: null };
  }

  try {
    const items = await apiFootballProvider.getLineups({ fixtureId });
    if (!Array.isArray(items) || !items.length) {
      return { status: "pending", reason: "not-published-yet", raw: items || [] };
    }
    return { status: "available", reason: null, raw: items };
  } catch (error) {
    return { status: "unavailable", reason: error.code || "provider-error", raw: null };
  }
}

function normalizeLineupSide(item) {
  if (!item) {
    return { formation: null, startingXI: [], substitutes: [] };
  }

  const toPlayer = (entry) => {
    const player = (entry && entry.player) || {};
    return {
      providerId: player.id ? String(player.id) : null,
      name: player.name || null,
      number: player.number ?? null,
      position: player.pos || null
    };
  };

  const startingXI = (Array.isArray(item.startXI) ? item.startXI : []).map(toPlayer);
  const substitutes = (Array.isArray(item.substitutes) ? item.substitutes : []).map(toPlayer);

  // Defensive de-dup: the same providerId must never appear in both slots.
  const startingIds = new Set(startingXI.map((player) => player.providerId).filter(Boolean));
  const dedupedSubstitutes = substitutes.filter((player) => !player.providerId || !startingIds.has(player.providerId));

  return {
    formation: item.formation || null,
    startingXI,
    substitutes: dedupedSubstitutes
  };
}

/**
 * Never fabricates a lineup: if the provider hasn't published one yet, both
 * sides come back empty with status "pending"/"unavailable" and the caller
 * must leave the probable lineup as the shown analysis.
 */
function normalizeOfficialLineup(fixtureId, fetchResult) {
  const receivedAt = new Date().toISOString();
  if (!fetchResult || fetchResult.status !== "available") {
    return {
      fixtureId,
      status: fetchResult ? fetchResult.status : "unavailable",
      receivedAt,
      home: { formation: null, startingXI: [], substitutes: [] },
      away: { formation: null, startingXI: [], substitutes: [] }
    };
  }

  const [homeRaw, awayRaw] = fetchResult.raw;
  return {
    fixtureId,
    status: "available",
    receivedAt,
    home: normalizeLineupSide(homeRaw),
    away: normalizeLineupSide(awayRaw)
  };
}

/**
 * Additive only: an official lineup never removes the probable-lineup
 * snapshot that was already frozen pre-match — both are stored side by
 * side so the UI can show "muhtemel" vs "resmi" separately.
 */
function mergeOfficialLineup(matchAnalysis, officialLineup) {
  if (!matchAnalysis) return matchAnalysis;
  return {
    ...matchAnalysis,
    officialLineups: {
      home: officialLineup.status === "available" ? officialLineup.home : matchAnalysis.officialLineups?.home ?? null,
      away: officialLineup.status === "available" ? officialLineup.away : matchAnalysis.officialLineups?.away ?? null
    },
    officialLineupStatus: officialLineup.status,
    officialLineupReceivedAt: officialLineup.status === "available" ? officialLineup.receivedAt : matchAnalysis.officialLineupReceivedAt ?? null
  };
}

function compareProbableWithOfficial(probableLineup, officialLineupSide) {
  if (!officialLineupSide || !Array.isArray(officialLineupSide.startingXI) || !officialLineupSide.startingXI.length) {
    return { available: false, matches: 0, total: 0, accuracy: null, matchedPlayers: [], missedPlayers: [], unexpectedPlayers: [] };
  }

  const official = { starters: officialLineupSide.startingXI.map((player) => ({ id: player.providerId, name: player.name })) };
  const comparison = compareProbableAndOfficialLineup(probableLineup, official);

  const probableIds = new Set((probableLineup && probableLineup.starters || []).map((player) => player.id || player.name));
  const officialIds = new Set(official.starters.map((player) => player.id || player.name));
  const unexpectedPlayers = [...probableIds].filter((id) => !officialIds.has(id));

  return { ...comparison, unexpectedPlayers };
}

function computeLineupAccuracy(probableLineup, officialLineupSide) {
  const comparison = compareProbableWithOfficial(probableLineup, officialLineupSide);
  return comparison.available ? comparison.accuracy : null;
}

/**
 * Fixtures eligible for a lineup-refresh check: not yet kicked off, kickoff
 * within LINEUP_REFRESH_WINDOW_MINUTES, and no official lineup on file yet.
 * Used by the GitHub Actions lineup-refresh mode to avoid polling every
 * fixture on every run.
 */
function computeLineupRefreshTargets(matchAnalyses, now) {
  const nowTime = (now || new Date()).getTime();
  return (Array.isArray(matchAnalyses) ? matchAnalyses : []).filter((record) => {
    if (record.status !== "scheduled") return false;
    if (record.officialLineupStatus === "available") return false;
    const kickoffTime = record.kickoff ? new Date(record.kickoff).getTime() : NaN;
    if (!Number.isFinite(kickoffTime)) return false;
    const minutesToKickoff = (kickoffTime - nowTime) / 60000;
    return minutesToKickoff >= 0 && minutesToKickoff <= LINEUP_REFRESH_WINDOW_MINUTES;
  });
}

module.exports = {
  fetchOfficialLineup,
  normalizeOfficialLineup,
  mergeOfficialLineup,
  compareProbableWithOfficial,
  computeLineupAccuracy,
  computeLineupRefreshTargets,
  LINEUP_REFRESH_WINDOW_MINUTES
};
