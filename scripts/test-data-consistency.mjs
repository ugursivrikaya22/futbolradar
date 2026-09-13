import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const provider = require("../services/providers/apiFootballProvider.js");
const { clearProviderCache } = require("../services/providerCache.js");
const { assessFreshness } = require("../services/dataFreshness.js");
const { successResponse } = require("../api/_utils.js");

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalKey = process.env.APIFOOTBALL_API_KEY;
let calls = 0;
let fail = false;
process.env.APIFOOTBALL_API_KEY = "test-only";
globalThis.fetch = async (url) => {
  calls++;
  assert.equal(new URL(url).searchParams.get("timezone"), "Europe/Istanbul", "all fixture queries use the site's calendar timezone");
  return new Response(JSON.stringify(fail ? { errors: { requests: "rate limit" } } : {
    response: [{ fixture: { id: 98765, date: new Date().toISOString(), status: { short: "1H", elapsed: 23 } }, league: { id: 203, name: "Süper Lig" }, teams: { home: { name: "Galatasaray" }, away: { name: "Kocaelispor" } }, goals: { home: 1, away: 0 } }]
  }), { status: fail ? 429 : 200, headers: { "Content-Type": "application/json" } });
};
try {
  clearProviderCache();
  const first = await provider.getFixtures({ live: true });
  const second = await provider.getFixtures({ live: true });
  assert.equal(calls, 1, "cached requests reuse the successful provider response");
  assert.equal(first[0].fetchedAt, second[0].fetchedAt, "cache hits never renew source time");
  const time = Date.parse(first[0].fetchedAt);
  Date.now = () => time + 120000;
  fail = true;
  const stale = await provider.getFixtures({ live: true });
  assert.equal(stale[0].fetchedAt, first[0].fetchedAt, "failed refresh never renews source time");
  assert.equal(assessFreshness(stale, { resource: "matches-live" }).stale, true);
  assert.equal(successResponse(stale).updatedAt, first[0].fetchedAt);
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  if (originalKey == null) delete process.env.APIFOOTBALL_API_KEY; else process.env.APIFOOTBALL_API_KEY = originalKey;
  clearProviderCache();
}

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf("  function " + name + "(");
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n  }", start) + 4;
  return source.slice(start, end);
}
const context = vm.createContext({
  URLSearchParams, Date, window: { location: { search: "" } },
  todayInIstanbul: () => "2026-09-13", matchDateValue: m => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(m.kickoff)),
  matchCompetitionMatches: () => true, matchIdentityKey: m => [m.homeTeam, m.awayTeam, m.kickoff].join("|"),
  hasReadableScore: m => m.score && m.score.home != null && m.score.away != null
});
vm.runInContext(["recordsUpdatedAt", "filterFallbackData", "isLiveMatchInFutbolRadarScope", "mergeLiveIntoMatches"].map(extract).join("\n"), context);
const fixture = { id: "slug", providerId: "98765", kickoff: "2026-09-12T21:15:00Z", homeTeam: "Old name", awayTeam: "Away", status: "LIVE", minute: 30, score: { home: 1, away: 0 }, fetchedAt: "2026-09-13T12:00:00Z" };
const changed = { ...fixture, id: "98765", homeTeam: "New name", minute: 0, score: { home: 0, away: 0 }, fetchedAt: "2026-09-13T12:01:00Z" };
context.base = [fixture]; context.incoming = [changed];
const merged = vm.runInContext("mergeLiveIntoMatches(base, incoming)", context);
assert.equal(merged.length, 1, "provider identity matches team-name variants");
assert.equal(merged[0].minute, 0, "zero minute and score corrections must not be discarded");
assert.equal(merged[0].score.home, 0);
context.base = merged; context.incoming = [fixture];
assert.equal(vm.runInContext("mergeLiveIntoMatches(base, incoming)", context)[0].minute, 0, "late packets cannot rewind a fixture");
context.base = [{ ...fixture, providerLeagueId: "39", competitionId: "premier-league" }];
context.incoming = [
  { ...changed, id: "foreign-altay", providerId: "foreign-altay", providerLeagueId: "389", competitionId: "premier-league", awayTeam: "Altay" },
  { ...changed, id: "outside-catalog", providerId: "outside-catalog", providerLeagueId: "554", homeTeam: "Karaköprü Belediyespor" }
];
assert.equal(vm.runInContext("mergeLiveIntoMatches(base, incoming)", context).length, 1, "live packets cannot add unrelated leagues by team name or an ambiguous league name");
context.incoming = [{ ...changed, id: "same-league", providerId: "same-league", providerLeagueId: 39 }];
assert.equal(vm.runInContext("mergeLiveIntoMatches(base, incoming)", context).length, 2, "new live fixtures in an existing provider league remain supported");
const brazil = provider.normalizeFixture({ fixture: { id: 11 }, league: { id: 71, name: "Serie A" } });
const italy = provider.normalizeFixture({ fixture: { id: 12 }, league: { id: 135, name: "Serie A" } });
assert.notEqual(brazil.league, italy.league, "same-name leagues must render in different groups");
assert.equal(brazil.competitionId, "brasileirao");
assert.equal(italy.competitionId, "serie-a");
const { matchProgramSummary } = require("../services/matchProgram.js");
assert.equal(matchProgramSummary([
  { league: "Serie A", providerLeagueId: "71" },
  { league: "Serie A", providerLeagueId: "135" },
  { league: "Italian Serie A", providerLeagueId: "135" }
]).leagues.length, 2, "daily summary counts league identities, merging aliases without merging countries");
vm.runInContext(extract("matchCompetitionMatches"), context);
context.brazil = brazil;
assert.equal(vm.runInContext('matchCompetitionMatches(brazil, "serie-a")', context), false, "Brazilian fixtures cannot enter the Italian league filter");
context.isFinishedMatch = match => match.status === "FINISHED";
context.isInformationalLanding = () => false;
vm.runInContext(extract("matchHasVerifiedFinalScore"), context);
context.finalMatch = { ...fixture, status: "FINISHED", providerStatus: "FT", dataStatus: "provider", source: "api-football" };
assert.equal(vm.runInContext("matchHasVerifiedFinalScore(finalMatch)", context), true, "daily cards show an actual provider final score without an editorial publishState");
context.isInformationalLanding = () => true;
context.window.location.pathname = "/bugunun-maclari.html";
assert.equal(vm.runInContext("matchHasVerifiedFinalScore(finalMatch)", context), true, "daily page uses its provider final result even with the existing landing-page class");
context.window.location.pathname = "/mac-sonuclari.html";
assert.equal(vm.runInContext("matchHasVerifiedFinalScore(finalMatch)", context), false, "other editorial result pages keep their existing verification requirement");
context.finalMatch.score = { home: null, away: null };
context.finalMatch.dataStatus = "verified"; context.finalMatch.publishState = "complete";
assert.equal(vm.runInContext("matchHasVerifiedFinalScore(finalMatch)", context), false, "missing final scores cannot become zero-zero through numeric coercion");
context.finalMatch.score = { home: 0, away: 0 };
assert.equal(vm.runInContext("matchHasVerifiedFinalScore(finalMatch)", context), true, "verified zero-zero is a valid final score");
context.input = [fixture, { ...fixture, kickoff: "2026-09-12T20:59:00Z" }];
assert.equal(vm.runInContext('filterFallbackData("matches", input)', context).length, 1, "today uses Istanbul midnight");
assert.match(fs.readFileSync(new URL("../api/matches.js", import.meta.url), "utf8"), /isUsable: Array.isArray/);
context.filterScoredMatches = matches => matches;
vm.runInContext(extract("renderLiveScoreSection"), context);
const emptyLive = vm.runInContext("renderLiveScoreSection([])", context);
assert.match(emptyLive, /Şu anda canlı maç yok/, "empty live data keeps its explicit state");
assert.match(emptyLive, /href="\.\/bugunun-maclari\.html"/, "clearing old live cards keeps the existing match-program route");
const prerender = fs.readFileSync(new URL("../scripts/prerender-core-pages.mjs", import.meta.url), "utf8");
const pool = prerender.match(/function programMatchPool\(\) \{[\s\S]*?\n\}/)[0];
const poolContext = vm.createContext({
  istanbulToday: () => "2026-09-13", istanbulDay: value => value.slice(0, 10),
  currentMatches: () => [{ kickoff: "2026-09-12" }, { kickoff: "2026-09-13", status: "FINISHED" }, { kickoff: "2026-09-14" }]
});
vm.runInContext(pool, poolContext);
const todayPool = vm.runInContext("programMatchPool()", poolContext);
assert.equal(todayPool.length, 1, "static cards and summary use only the selected calendar day");
assert.equal(todayPool[0].status, "FINISHED", "today's completed fixtures remain in the same daily count as the API");
const assetFixture = fs.mkdtempSync(path.join(os.tmpdir(), "futbolradar-data-consistency-"));
try {
  const write = (name, contents) => fs.writeFileSync(path.join(assetFixture, name), contents);
  const read = name => fs.readFileSync(path.join(assetFixture, name), "utf8");
  const stamp = name => crypto.createHash("sha256").update(read(name)).digest("hex").slice(0, 8);
  write("app.js", "window.dataVersion = 1;");
  write("performance-loader.js", 'function load() { script.src = "/app.js?v=abcdef"; }');
  write("index.html", '<script src="./performance-loader.js" defer></script>');
  const run = () => execFileSync(process.execPath, [fileURLToPath(new URL("./inject-asset-version.mjs", import.meta.url))], { cwd: assetFixture, stdio: "pipe", windowsHide: true });
  run();
  const firstPage = read("index.html");
  assert.ok(firstPage.includes("performance-loader.js?v=" + stamp("performance-loader.js")));
  write("app.js", "window.dataVersion = 2;");
  run();
  assert.notEqual(read("index.html"), firstPage, "new data code must change the loader URL seen by returning visitors");
  assert.ok(read("index.html").includes("performance-loader.js?v=" + stamp("performance-loader.js")));
  assert.ok(read("performance-loader.js").includes("/app.js?v=" + stamp("app.js")));
  const secondPage = read("index.html");
  run();
  assert.equal(read("index.html"), secondPage, "unchanged data code keeps a stable loader URL");
} finally {
  assert.equal(path.dirname(path.resolve(assetFixture)), path.resolve(os.tmpdir()));
  fs.rmSync(assetFixture, { recursive: true, force: true });
}
console.log("Data consistency regressions passed: cache age, outage, identity, score correction, late packet, Istanbul date, authoritative empty response.");
