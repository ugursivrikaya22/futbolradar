/** Opt-in, source-only profile rollout. Cached match windows are NOT season totals. */
const fs = require("node:fs");
const path = require("node:path");
const { METRIC_CATALOG } = require("./playerMetricsService");
const { publicPlayerView } = require("./cardCredibility");
const { isActiveStatsPlayer } = require("./playerStatsEligibility");
const { sameClub } = require("./superLigTeams");
const root = path.join(__dirname, "..");
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
let cached;
function registrationsFromDisk() {
  const dir = path.join(root, "data/player-profile-evidence");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith(".json")).flatMap(name => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    return data.players || [];
  }) : [];
}
function prioritizeProfileSnapshots(snapshots) {
  const registrations = registrationsFromDisk();
  const ranks = new Map(registrations.map(row => [String(row.providerId), row.priority]));
  const rank = snapshot => Math.min(Infinity, ...snapshot.players.map(player => ranks.get(String(player.providerId)) ?? Infinity));
  return snapshots.slice().sort((a, b) => rank(a) - rank(b));
}
function load() {
  if (cached) return cached;
  const registrations = registrationsFromDisk();
  const archive = require("../data/historical-match-archive.json");
  const matches = require("../data/matches.json");
  cached = { registrations, history: require("../data/player-match-history.json"), squads: require("../data/super-lig-squads.json"),
    fixtures: [...(Array.isArray(matches) ? matches : matches.matches || []), ...(archive.records || []).map(row => row.match)] };
  return cached;
}
function buildRegisteredEvidence(player, data) {
  if (!isActiveStatsPlayer(player)) return null;
  const registration = data.registrations.find(row => row.playerId === player.id && String(row.providerId) === String(player.providerId));
  if (!registration || !/^\d+$/.test(String(player.providerId))) return null;
  // Reuse an actual complete API roster observation. Do not manufacture a new
  // verification time or open old rating/season values behind the identity gate.
  const roster = data.squads.find(row => row.status === "complete" && sameClub(row.teamName, player.currentTeam)
    && row.players.some(member => String(member.providerId) === String(player.providerId)));
  if (!roster) return null;
  const view = publicPlayerView({ ...player, dataStatus: "provider", lastVerifiedAt: roster.syncedAt,
    source: { ...player.source, provider: "API-Football", providerId: String(player.providerId),
      lastVerifiedAt: roster.syncedAt, fetchedAt: roster.syncedAt, sourceUrl: `https://v3.football.api-sports.io/players/squads?team=${roster.teamId}` } });
  if (!view.verified) return null;
  const fixtureMap = new Map(data.fixtures.filter(Boolean).map(row => [row.id, row]));
  const seen = new Set();
  const rows = data.history.rows.filter(row => {
    if (String(row.providerPlayerId) !== String(player.providerId) || !registration.matchIds.includes(row.matchId)
      || !sameClub(row.team, player.currentTeam) || !(number(row.minutes) > 0) || seen.has(row.matchId)) return false;
    const match = fixtureMap.get(row.matchId);
    if (!match || !/^\d+$/.test(String(match.providerIds?.apiFootball || match.providerId || ""))
      || !/FINISHED|^FT$|^AET$|^PEN$/.test(String(match.status || match.providerStatus))
      || /friendly|hazırlık|hazirlik/i.test(row.competition || "") || !registration.seasonStart || row.date < registration.seasonStart) return false;
    seen.add(row.matchId); return true;
  });
  if (!rows.length) return null;
  const mapped = new Set(["minutes", "goals", "assists", "shots", "shotsOnTarget", "keyPasses", "passes", "duelsWon", "tackles", "saves", "dribbles"]);
  const metrics = METRIC_CATALOG.map(metric => {
    let value = null, formula = null;
    if (metric.key === "appearances") { value = rows.length; formula = "COUNT(matchId); yalnızca kayıtlı maçlar"; }
    else if (mapped.has(metric.key) && rows.every(row => number(row[metric.key]) !== null)) {
      value = rows.reduce((sum, row) => sum + row[metric.key], 0); formula = `Σ ${metric.key}; yalnızca kayıtlı maçlar`;
    } else if (metric.key === "passAccuracy" && rows.every(row => number(row.accuratePasses) !== null && number(row.passes) !== null && row.accuratePasses <= row.passes)) {
      const passes = rows.reduce((sum, row) => sum + row.passes, 0);
      if (passes > 0) { value = Math.round(rows.reduce((sum, row) => sum + row.accuratePasses, 0) / passes * 10000) / 100; formula = "Σ accuratePasses / Σ passes × 100"; }
    }
    return { key: metric.key, label: metric.label, value, formula, unit: metric.unit || "" };
  });
  // These ability concepts are not API measurements. Even cached ratings are
  // not converted into invented 0–100 finishing/pressing/creativity scores.
  const pending = ["Bitiricilik", "Pres", "Yaratıcılık", "İstikrar", "Teknik beceri"];
  return { metrics, pending, playerId: player.id, source: "API-Football", scope: "registered-matches",
    matches: rows.map(row => ({ id: row.matchId, date: row.date, opponent: row.opponent })),
    verifiedAt: roster.syncedAt, recordedAt: data.history.updatedAt,
    priority: registration.priority, selectionReason: registration.selectionReason };
}
function profileEvidence(player) { return buildRegisteredEvidence(player, load()); }
module.exports = { buildRegisteredEvidence, profileEvidence, prioritizeProfileSnapshots, registrationsFromDisk };
