import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
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
  isLiveMatchInFutbolRadarScope: () => true, hasReadableScore: m => m.score && m.score.home != null && m.score.away != null
});
vm.runInContext(["recordsUpdatedAt", "filterFallbackData", "mergeLiveIntoMatches"].map(extract).join("\n"), context);
const fixture = { id: "slug", providerId: "98765", kickoff: "2026-09-12T21:15:00Z", homeTeam: "Old name", awayTeam: "Away", status: "LIVE", minute: 30, score: { home: 1, away: 0 }, fetchedAt: "2026-09-13T12:00:00Z" };
const changed = { ...fixture, id: "98765", homeTeam: "New name", minute: 0, score: { home: 0, away: 0 }, fetchedAt: "2026-09-13T12:01:00Z" };
context.base = [fixture]; context.incoming = [changed];
const merged = vm.runInContext("mergeLiveIntoMatches(base, incoming)", context);
assert.equal(merged.length, 1, "provider identity matches team-name variants");
assert.equal(merged[0].minute, 0, "zero minute and score corrections must not be discarded");
assert.equal(merged[0].score.home, 0);
context.base = merged; context.incoming = [fixture];
assert.equal(vm.runInContext("mergeLiveIntoMatches(base, incoming)", context)[0].minute, 0, "late packets cannot rewind a fixture");
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
console.log("Data consistency regressions passed: cache age, outage, identity, score correction, late packet, Istanbul date, authoritative empty response.");
