import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { buildLeagueLeaders } from "./sync-super-lig-leaders.mjs";

const require = createRequire(import.meta.url);
const { isActiveStatsPlayer, filterActiveLeaderRows } = require("../services/playerStatsEligibility.js");
const { getPlayers } = require("../services/playerService.js");
const players = JSON.parse(fs.readFileSync("data/players.json", "utf8"));
const app = fs.readFileSync("app.js", "utf8");
function clientFunction(name) {
  const match = app.match(new RegExp("  function " + name + "\\([^]*?\\n  \\}"));
  assert.ok(match, `client function ${name} exists`);
  return match[0];
}
const context = vm.createContext({
  normalizeSearchText: value => String(value || "").toLowerCase(),
  playerStats: player => player.stats || {},
  playerAiScore: player => player.overallRating,
  playerCurrentTeam: player => player.currentTeam || player.team,
  escapeHtml: value => String(value ?? ""),
  siteHref: value => value,
  statisticsSummaryHtml: () => "",
  statisticsMatchOverview: () => "",
  statisticsCoverageHtml: () => "",
  // Preserve each actual list's entries without involving avatar/profile markup.
  statisticLeaderList: entries => entries.map(entry => entry.item.name).join(", ")
});
for (const name of ["isActiveStatsPlayer", "statisticNumber", "statisticMetric", "statisticLeaders", "statisticPanel", "statisticFilterValue", "statisticTextMatches", "filteredStatisticsData", "renderStatisticsHub", "filterSquadForTeam", "topPlayerIds"]) {
  vm.runInContext(clientFunction(name), context);
}

// The Node generator and browser fallback have exactly the same predicate.
const compact = fn => fn.toString().split("\n").map(line => line.trim()).join("\n");
assert.equal(compact(context.isActiveStatsPlayer), compact(isActiveStatsPlayer));
const active = { id: "active", name: "Active Player", currentTeam: "Galatasaray", league: "Süper Lig", squadStatus: "active", goals: 1, assists: 1, xg: 1, yellowCards: 1, redCards: 0, overallRating: 70, minutesPlayed: 90 };
for (const player of [...players, null, {}, active,
  ...["departed", "released", "transferred_out", "loaned_out", "retired", "inactive"].map(squadStatus => ({ ...active, squadStatus })),
  ...["Serbest oyuncu", "Free agent", "Kulüpsüz", "Without club", ""].map(currentTeam => ({ ...active, currentTeam })),
  ...["loaned_in", "injured", "suspended"].map(squadStatus => ({ ...active, squadStatus }))]) {
  assert.equal(context.isActiveStatsPlayer(player), isActiveStatsPlayer(player));
}
assert.equal(isActiveStatsPlayer({ ...active, isCurrentSuperLigPlayer: false }), false);
for (const squadStatus of ["active", "loaned_in", "injured", "suspended"]) assert.equal(isActiveStatsPlayer({ ...active, squadStatus }), true);
const icardi = players.find(player => player.id === "mauro-icardi");
assert.ok(icardi);
assert.equal(isActiveStatsPlayer(icardi), false);
assert.ok(getPlayers(players).some(player => player.id === icardi.id), "profile data is not deleted or globally filtered");
assert.ok(fs.existsSync("oyuncular/mauro-icardi.html"), "legacy profile URL is retained");

// Real data + a forced stale provider-style high scorer: every player panel shares the filtered pool.
const stale = { ...icardi, goals: 999, assists: 999, xg: 999, yellowCards: 999, redCards: 999, overallRating: 99, passAccuracy: 100, pressingScore: 100 };
const sets = [[stale, active, { ...active, id: "departed", name: "Departed Player", squadStatus: "departed" }], [], [], []];
const filtered = context.filteredStatisticsData(sets, {});
assert.deepEqual(Array.from(context.topPlayerIds(sets[0], player => player.goals, 3)), ["active"], "comparison leader presets exclude inactive players");
assert.deepEqual(Array.from(filtered[0], player => player.id), ["active"]);
for (const metric of ["goals", "assists", "xg", "yellowCards", "redCards", "minutesPlayed", "overallRating"]) {
  const ranked = context.statisticLeaders(filtered[0], player => player[metric]);
  assert.ok(ranked.every(entry => entry.item.id === "active"), `${metric}: no departed/free-agent player`);
}
assert.equal(context.filteredStatisticsData(sets, { team: "Serbest oyuncu" })[0].length, 0, "URL filters cannot opt a free agent back in");
const html = context.renderStatisticsHub(sets[0], [], [], []);
assert.doesNotMatch(html, /Icardi|Departed Player/);
assert.match(html, /Active Player/);
assert.equal(context.filterSquadForTeam({ name: "Galatasaray" }, [active, { ...stale, currentTeam: "Galatasaray" }]).length, 1, "team statistics exclude released records even with old club fields");
for (const name of ["filterPlayers", "initPlayerSeoLanding", "initStatisticsHub"]) assert.match(clientFunction(name), /isActiveStatsPlayer/, `${name} applies eligibility before rendering/filter choices`);

// Provider may still return the old club and a numeric ID while local Icardi has a mock ID.
const providerRows = [{ providerId: "999999", name: "Mauro Icardi", team: "Galatasaray", league: "Süper Lig", goals: 99, assists: 99 }, { providerId: "1", ...active, team: active.currentTeam }];
assert.deepEqual(filterActiveLeaderRows(providerRows, players).map(row => row.name), ["Active Player"]);
assert.deepEqual(filterActiveLeaderRows(providerRows, players).map(row => row.rank), [1]);
const result = await buildLeagueLeaders({
  players,
  leagueResolution: { status: "resolved", leagueId: "203" },
  provider: { getConfig: () => ({ season: 2026 }), getTopScorers: async () => providerRows, getTopAssists: async () => providerRows }
});
for (const key of ["topScorers", "topAssists"]) {
  assert.deepEqual(result[key].map(row => row.name), ["Active Player"]);
  assert.equal(result[key][0].rank, 1);
}
for (const file of ["scripts/prerender-core-pages.mjs", "scripts/generate-en-pages.mjs"]) {
  const code = fs.readFileSync(file, "utf8");
  assert.match(code, /allPlayers\.filter\(isActiveStatsPlayer\)/);
  assert.match(code, /filterActiveLeaderRows\(leagueLeaders\[key\], allPlayers\)/);
}
console.log("Active stats player tests passed: browser/Node parity, every metric, query filters, team stats, live/static eligibility, upstream stale rows, profile retention.");
