/** Offline integration contracts: synthetic fixtures are NEVER published data. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { renderPlayer360, player360Description } from "./lib/player360.mjs";
const require = createRequire(import.meta.url);
const { buildSeasonSnapshot, applySeasonSnapshot, FIELD_PATHS } = require("../services/apiFootballPlayerMetrics.js");
const { buildMetrics } = require("../services/playerMetricsService.js");
const { normalizePlayer, mergePlayerWithProvider } = require("../services/playerService.js");
const provider = require("../services/providers/apiFootballProvider.js");
const { buildPlayer360, buildSeasonStats } = require("../services/player360Service.js");
const { buildPlayerProfile } = require("../services/playerProfileService.js");
const ui = require("../player-profile.js");
const block = (season = 2026, id = 203) => ({
  league: { id, name: "Süper Lig", season }, team: { id: 645, name: "Galatasaray" },
  games: { appearences: 10, lineups: 8, minutes: 800, position: "Attacker" },
  goals: { total: 4, assists: 0, saves: 3, conceded: 2 }, shots: { total: 25, on: 11 },
  passes: { total: 210, key: 9, accuracy: 33 }, dribbles: { attempts: 16, success: 9 },
  tackles: { total: 4, blocks: 1, interceptions: 2 }, duels: { total: 80, won: 32 },
  fouls: { committed: 5 }, cards: { yellow: 1, red: 0, yellowred: 1 }
});
const item = { player: { id: 998877, name: "Fixture Player" }, statistics: [block(), block(2025)] };
const snapshot = buildSeasonSnapshot(item, 2026);
assert.equal(snapshot.season, "2026");
assert.equal(snapshot.stats.goals, 4, "never add another season");
assert.equal(snapshot.stats.assists, 0, "a sourced zero remains zero");
assert.equal(snapshot.stats.redCards, 1);
const pass1 = block(), pass2 = block(2026, 2);
pass1.passes = { total: 100, accuracy: 80, key: 1 };
pass2.passes = { total: 300, accuracy: 60, key: 2 };
assert.equal(buildSeasonSnapshot({ statistics: [pass1, pass2] }, 2026).stats.passAccuracy, 65, "pass-weighted, not unweighted percentage mean");
pass2.passes.accuracy = 300;
assert.equal(buildSeasonSnapshot({ statistics: [pass1, pass2] }, 2026).stats.passAccuracy, null, "out-of-range values are not percentages");
assert.equal(Object.keys(snapshot.evidence).length, 22);
for (const key of ["xg", "xa", "recoveries", "cleanSheets"]) assert.equal(snapshot.stats[key], null);
assert.equal(buildSeasonSnapshot(item, 2024), null);
assert.equal(buildSeasonSnapshot({ statistics: [{}] }), null);
assert.equal(buildSeasonSnapshot({ statistics: [block(), block()] }), null, "ambiguous duplicate block is rejected");
const second = block(2026, 2);
second.shots.total = null;
const multi = buildSeasonSnapshot({ statistics: [block(), second] }, 2026);
assert.equal(multi.stats.goals, 8);
assert.equal(multi.stats.shots, null, "a partial total is not a full season total");
assert.match(multi.evidence.goals.formula, /Σ/);
const unknown = structuredClone(item);
unknown.statistics[0].goals.assists = null;
assert.equal(buildSeasonSnapshot(unknown, 2026).stats.assists, null);
const invalid = structuredClone(item);
invalid.statistics[0].shots.total = true;
assert.equal(buildSeasonSnapshot(invalid, 2026).stats.shots, null);
const rejected = provider.normalizePlayer(item, 2024);
assert.equal(rejected.seasonStatisticsRejected, true);
assert.deepEqual(rejected.stats, {}, "invalid explicit season cannot fall back to unscoped counts");
const reordered = { ...item, statistics: [item.statistics[1], item.statistics[0]] };
reordered.statistics[0] = { ...reordered.statistics[0], team: { id: 9, name: "Old Club" } };
assert.equal(provider.normalizePlayer(reordered, 2026).currentTeam, "Galatasaray");
const normalized = provider.normalizePlayer(item, 2026);
assert.equal(normalized.stats.goals, 4);
assert.equal(normalized.stats.passAccuracy, 33);
const now = new Date().toISOString();
const local = normalizePlayer({ id: "fixture-player", name: "Fixture Player", position: "ST", currentTeam: "Galatasaray",
  providerId: "998877", dataStatus: "verified", lastVerifiedAt: now,
  stats: { goals: 99, shots: 900, xg: 34, xa: 21, recoveries: 32 }, shotsPerGame: 9 });
const merged = mergePlayerWithProvider(local, { ...normalized, fetchedAt: now }, "api-football");
assert.equal(merged.stats.goals, 4, "fresh source replaces stale local totals");
assert.equal(merged.stats.xg, null, "no legacy xG behind a new source label");
assert.equal(merged.season, "2026");
assert.ok(!merged.statsVerifiedFields.includes("marketValueEur"));
assert.ok(!merged.statsVerifiedFields.includes("xg"));
assert.equal(merged.statsVerifiedAt, now);
const metrics = buildMetrics(merged, { positionGroup: "forward" });
assert.equal(metrics.length, 23, "actual repository catalogue has 23 outfield metrics, not 22");
assert.equal(metrics.filter(row => row.available).length, 20);
assert.equal(metrics.find(row => row.key === "goals").source, "API-Football");
assert.equal(metrics.find(row => row.key === "goals").per90, 0.45);
assert.equal(metrics.find(row => row.key === "xg").available, false);
assert.equal(buildMetrics({ ...merged, stats: { ...merged.stats, shots: null }, shots: 900, shotsPerGame: 9 })
  .find(row => row.key === "shots").available, false, "no flat/per-game fallback for missing API fields");
const view = { verified: true, fields: {}, reasons: [] };
const season = buildSeasonStats(merged, view);
assert.equal(season.metrics.filter(row => row.available).length, 20);
assert.ok(season.core.some(row => row.key === "goals"));
const model = buildPlayer360({ player: merged, credibility: view, matches: [], archive: [], players: [] });
const html = renderPlayer360(model);
assert.match(html, /Veri: <a[^>]+>API-Football/);
assert.match(html, /games.appearences/);
assert.match(html, /değer \/ dakika × 90/);
assert.match(html, /Güncelleniyor/);
assert.match(html, /Transfermarkt/);
assert.match(html, /2026/);
const missingGoalMeta = player360Description({ ...model, seasonStats: { ...model.seasonStats, core: [{ key: "assists", value: 2 }] } });
assert.ok(!missingGoalMeta.includes("0 gol"), "metadata never invents a missing goal total");
assert.ok(!html.includes("900"));
const en = renderPlayer360(model, { locale: "en" });
assert.match(en, /Data: <a[^>]+>API-Football/);
assert.ok(!en.includes("player360.stat."), "all new stat keys translated");
assert.ok(!buildSeasonStats(merged, { verified: false, fields: {} }).metrics, "identity gate remains in force");
const hidden = buildPlayerProfile({ player: { ...merged, providerId: "mock-fixture", dataStatus: "mock_needs_verification" }, credibility: { verified: false, fields: {}, reasons: [] } });
assert.equal(hidden.season.metrics.filter(row => row.available).length, 0);
const uiHtml = ui.renderProfileHtml({ ...buildPlayerProfile({ player: merged, credibility: view }), credibility: { verified: true, reasons: [] } });
assert.ok(uiHtml.includes("Veri: API-Football"));
assert.equal(Object.keys(FIELD_PATHS).length, 22);
assert.deepEqual(applySeasonSnapshot(local, {}), local, "no data means no change");
// A typo/unknown selection must not spend quota or enrich every player.
const emptySelection = spawnSync(process.execPath, ["--require", "./scripts/lib/fakeApiFootball.cjs",
  "scripts/sync-turkish-player-profiles.mjs", "--playerId=does-not-exist", "--skip-squad-refresh", "--dry-run"],
  { encoding: "utf8", env: { ...process.env, FUTBOLRADAR_FAKE_API_FOOTBALL: "1", APIFOOTBALL_API_KEY: "offline-test-only", APIFOOTBALL_SEASON: "2026" } });
assert.equal(emptySelection.status, 0, emptySelection.stderr);
assert.match(emptySelection.stdout, /"providerRequests": 0/);
assert.match(emptySelection.stdout, /"enriched": 0/);
console.log("API-Football player metrics passed: season scope, 26 mappings, 20/23 outfield fields, null/zero, provenance, merge, bilingual SSR, UI, credibility.");
