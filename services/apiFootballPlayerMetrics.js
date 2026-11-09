/** Exact /players season fields only. Never turn missing coverage into zero. */
const FIELD_PATHS = Object.freeze({
  appearances: "games.appearences", starts: "games.lineups", minutes: "games.minutes",
  goals: "goals.total", assists: "goals.assists", shots: "shots.total",
  shotsOnTarget: "shots.on", keyPasses: "passes.key", passes: "passes.total", passAccuracy: "passes.accuracy",
  dribbles: "dribbles.success", dribbleAttempts: "dribbles.attempts",
  duelsWon: "duels.won", duelsTotal: "duels.total", tackles: "tackles.total",
  interceptions: "tackles.interceptions", blocks: "tackles.blocks",
  foulsCommitted: "fouls.committed", yellowCards: "cards.yellow",
  redCards: "cards.red + cards.yellowred", saves: "goals.saves", goalsConceded: "goals.conceded"
});
const UNSUPPORTED = Object.freeze(["xg", "xa", "recoveries", "cleanSheets"]);
function numeric(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function read(block, path) {
  return numeric(path.split(".").reduce((value, key) => value?.[key], block));
}
function blockValue(block, key, path) {
  if (key === "appearances") return read(block, path) ?? read(block, "games.appearances");
  if (key === "foulsCommitted") return read(block, path) ?? read(block, "fouls.commited");
  if (key === "redCards") {
    const red = read(block, "cards.red"), secondYellow = read(block, "cards.yellowred");
    return red === null || secondYellow === null ? null : red + secondYellow;
  }
  return read(block, path);
}
function buildSeasonSnapshot(item, expectedSeason) {
  const raw = Array.isArray(item.statistics) ? item.statistics : [];
  const seasons = raw.map(block => numeric(block.league?.season)).filter(value => value !== null);
  const season = numeric(expectedSeason) ?? (seasons.length ? Math.max(...seasons) : null);
  if (season === null) return null;
  const blocks = raw.filter(block => numeric(block.league?.season) === season);
  if (!blocks.length || blocks.some(block => !block.league?.id || !block.team?.id)) return null;
  const identities = blocks.map(block => `${block.team.id}:${block.league.id}`);
  if (new Set(identities).size !== identities.length) return null;
  const stats = Object.fromEntries(UNSUPPORTED.map(key => [key, null]));
  const evidence = {};
  for (const [key, path] of Object.entries(FIELD_PATHS)) {
    const values = blocks.map(block => blockValue(block, key, path));
    if (key === "passAccuracy") {
      // The official API-Football 13 March 2026 /players guide identifies
      // season accuracy as a percentage. Weight by passes, not competitions.
      const weights = blocks.map(block => read(block, "passes.total"));
      const valid = values.every(value => value !== null && value <= 100);
      const total = weights.every(value => value !== null) ? weights.reduce((a, b) => a + b, 0) : null;
      stats[key] = !valid ? null : blocks.length === 1 ? values[0]
        : total > 0 ? Math.round(values.reduce((sum, value, i) => sum + value * weights[i], 0) / total * 100) / 100 : null;
      if (stats[key] !== null) evidence[key] = { source: "API-Football", field: path,
        formula: blocks.length === 1 ? path : "Σ (passes.accuracy × passes.total) / Σ passes.total (pas ağırlıklı yüzde ortalaması)" };
      continue;
    }
    stats[key] = values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
    if (stats[key] !== null) evidence[key] = { source: "API-Football", field: path,
      formula: blocks.length > 1 ? `Σ (${path}); aynı sezondaki listelenen takım/turnuva blokları` : path };
  }
  // No finishing/technical ability score is inferred from these counts.
  return { provider: "api-football", endpoint: "/players", season: String(season),
    competitions: blocks.map(block => ({ id: block.league.id, name: block.league.name || "",
      teamId: block.team.id, team: block.team.name || "" })), stats, evidence };
}
function applySeasonSnapshot(local, provider) {
  const snapshot = provider.seasonStatistics;
  if (!snapshot || snapshot.provider !== "api-football") return local;
  const keys = [...Object.keys(FIELD_PATHS), ...UNSUPPORTED];
  const next = { ...local, seasonStatistics: snapshot, stats: { ...snapshot.stats },
    season: snapshot.season, statsSource: "API-Football", statsVerifiedAt: provider.fetchedAt || provider.lastSyncedAt || new Date().toISOString(),
    statsVerifiedFields: Object.keys(snapshot.evidence) };
  for (const key of keys) next[key] = snapshot.stats[key] ?? null;
  next.minutesPlayed = snapshot.stats.minutes;
  if (snapshot.stats.minutes !== null) next.statsVerifiedFields.push("minutesPlayed");
  return next;
}
module.exports = { FIELD_PATHS, UNSUPPORTED, buildSeasonSnapshot, applySeasonSnapshot };
