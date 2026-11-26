"use strict";

const TYPES = Object.freeze(["goal", "red-card", "lineup", "kickoff", "fulltime"]);
// Older clients keep their previous selection; explicit [] means no events.
function normalizeTypes(value) {
  if (value === undefined || value === null) return TYPES.slice();
  if (!Array.isArray(value)) return [];
  return TYPES.filter(type => value.includes(type));
}
function accepts(subscriber, type) {
  return normalizeTypes(subscriber.notification_types).includes(type);
}
function confirmedLineupTeams(match) {
  return (Array.isArray(match.lineups) ? match.lineups : []).filter(lineup =>
    !lineup.predicted && !lineup.probable && lineup.status !== "predicted" &&
    (lineup.startingDetails || lineup.players || lineup.startXI || []).length === 11
  ).map(lineup => String(lineup.team?.name || lineup.team || lineup.teamId || "")).filter(Boolean).sort();
}
module.exports = { TYPES, normalizeTypes, accepts, confirmedLineupTeams };
