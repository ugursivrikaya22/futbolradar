import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getLiveMatchFeed, resetLiveMatchFeed } = require("../services/liveMatchFeedService.js");

function result(data, provider = "api-football") {
  return { data, provider: provider ? { name: provider } : null, attempts: [{ provider: provider || "none", status: "ok" }], degraded: false };
}

const liveMatch = {
  id: "tr-1",
  homeTeam: "Trabzonspor",
  awayTeam: "Rakip FK",
  league: "UEFA Avrupa Ligi",
  status: "LIVE",
  minute: 42,
  score: { home: 1, away: 0 },
  fetchedAt: "2026-08-03T10:00:00.000Z"
};

resetLiveMatchFeed();
const fresh = await getLiveMatchFeed({ now: new Date("2026-08-03T10:00:30.000Z"), resolve: async () => result([liveMatch]) });
assert.equal(fresh.items.length, 1);
assert.equal(fresh.items[0].isVerified, true);
assert.equal(fresh.items[0].isStale, false);
assert.equal(fresh.items[0].minute, 42);
assert.equal(fresh.items[0].homeTeam, "Trabzonspor");

const stale = await getLiveMatchFeed({ now: new Date("2026-08-03T10:01:00.000Z"), resolve: async () => result([], "mock") });
assert.equal(stale.stale, true, "mock verisi yayımlanmak yerine son geçerli kayıt kullanılmalı");
assert.equal(stale.items[0].isStale, true);

resetLiveMatchFeed();
const noScore = await getLiveMatchFeed({
  now: new Date("2026-08-03T10:00:30.000Z"),
  resolve: async () => result([{ ...liveMatch, id: "missing-score", score: { home: null, away: null } }])
});
assert.equal(noScore.items.length, 0, "eksik skor 0-0 olarak yayımlanmamalı");

resetLiveMatchFeed();
const awaiting = await getLiveMatchFeed({ now: new Date("2026-08-03T10:00:30.000Z"), resolve: async () => result([liveMatch], "mock") });
assert.equal(awaiting.items.length, 0, "doğrulanmamış mock skoru yayımlanmamalı");
assert.equal(awaiting.awaitingVerifiedData, true);

console.log("Live match feed tests passed (verified provider, stale fallback, mock rejection).");
