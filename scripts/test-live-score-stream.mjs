import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  EXHAUSTED_QUOTA_CADENCE_MS,
  LOW_QUOTA_CADENCE_MS,
  LiveScoreHub,
  PROVIDER_CADENCE_MS,
  estimatedEventTime,
  quotaAwareCadence
} = require("../services/liveScoreStream.js");
const { cacheControlFor } = require("../api/_utils.js");
const apiFootball = require("../services/providers/apiFootballProvider.js");
const { handleLiveScoreStream } = require("../server/liveScoreStreamRoute.js");

let now = Date.parse("2026-08-24T18:00:00Z");
let calls = 0;
let score = 1;
const timers = [];
const provider = {
  name: "test-provider",
  getProviderRateLimit: () => ({ remaining: 90 })
};
const fetchMatches = async () => {
  calls += 1;
  now += 25;
  return [{
    id: "fixture-1",
    providerId: "fixture-1",
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    kickoff: "2026-08-24T17:00:00Z",
    status: "LIVE",
    providerStatus: "2H",
    minute: 61,
    live: true,
    score: { home: score, away: 0 },
    fetchedAt: new Date(now).toISOString(),
    events: [{ id: "goal-1", type: "Goal", detail: "Normal Goal", time: "61'" }]
  }];
};

const hub = new LiveScoreHub({
  provider,
  fetchMatches,
  now: () => now,
  setTimer: (callback, delay) => {
    const timer = { callback, delay, unref() {} };
    timers.push(timer);
    return timer;
  },
  clearTimer() {}
});
const first = [];
const second = [];
const unsubscribeFirst = hub.subscribe((packet) => first.push(packet));
const unsubscribeSecond = hub.subscribe((packet) => second.push(packet));
await hub.inFlight;

assert.equal(calls, 1, "eşzamanlı aboneler tek sağlayıcı isteğini paylaşmalı");
assert.equal(first.length, 1);
assert.equal(second.length, 1);
assert.equal(first[0].matches[0].score.home, 1);
assert.ok(first[0].timing.serverReceivedAt);
assert.equal(first[0].matches[0].timing.providerEventAt, null, "sağlayıcı mutlak olay zamanı vermediyse null kalmalı");
assert.equal(
  first[0].matches[0].events[0].providerEventTimeEstimated,
  estimatedEventTime("2026-08-24T17:00:00Z", { time: "61'" })
);

await hub.poll();
assert.equal(first.length, 1, "değişmeyen skor istemcilere yeniden itilmemeli");
score = 2;
await hub.poll();
assert.equal(first.length, 2, "skor değişikliği hemen yeni paket üretmeli");
assert.equal(first[1].matches[0].score.home, 2);
assert.ok(timers.every((timer) => timer.delay <= PROVIDER_CADENCE_MS), "normal kota durumunda 15sn kadans aşılmamalı");

unsubscribeFirst();
unsubscribeSecond();

assert.equal(quotaAwareCadence({ getProviderRateLimit: () => ({ remaining: 50 }) }), PROVIDER_CADENCE_MS);
assert.equal(quotaAwareCadence({ getProviderRateLimit: () => ({ remaining: 5 }) }), LOW_QUOTA_CADENCE_MS);
assert.equal(quotaAwareCadence({ getProviderRateLimit: () => ({ remaining: 0 }) }), EXHAUSTED_QUOTA_CADENCE_MS);

assert.deepEqual(cacheControlFor("live-stream"), { browser: "no-store", cdn: "no-store" });

const headResponse = {
  headers: {},
  setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
  end() { this.ended = true; }
};
await handleLiveScoreStream({
  method: "HEAD",
  url: "/api/live-score-stream",
  headers: { "x-forwarded-for": "203.0.113.44" }
}, headResponse);
assert.equal(headResponse.headers["content-type"], "text/event-stream; charset=utf-8");
assert.equal(headResponse.headers["cdn-cache-control"], "no-store");
assert.equal(headResponse.headers["vercel-cdn-cache-control"], "no-store");
assert.equal(headResponse.headers["x-accel-buffering"], "no");
assert.equal(headResponse.ended, true);

const normalized = apiFootball.normalizeFixture({
  fixture: { id: 44, date: "2026-08-24T17:00:00Z", status: { short: "2H", elapsed: 61 } },
  league: { name: "Süper Lig" },
  teams: { home: { id: 1, name: "Galatasaray" }, away: { id: 2, name: "Fenerbahçe" } },
  goals: { home: 1, away: 0 },
  events: [{ time: { elapsed: 61 }, team: { id: 1, name: "Galatasaray" }, player: { id: 9, name: "Oyuncu" }, type: "Goal", detail: "Normal Goal" }]
});
assert.equal(normalized.events.length, 1, "canlı fikstürün gömülü olayları ayrıca API'den istenmemeli");
assert.equal(normalized.events[0].providerEventAt, null, "olmayan sağlayıcı zamanı uydurulmamalı");

const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const route = fs.readFileSync(path.join(root, "api", "[...route].js"), "utf8");
assert.match(app, /new EventSource\(API_ROOT \+ "live-score-stream"\)/);
assert.match(app, /if \(!hasLiveMatchNow \|\| !window\.EventSource/,
  "SSE yalnızca canlı maç varken açılmalı");
assert.match(app, /hasLiveMatchNow \? LIVE_MATCH_FAST_POLL_MS : MATCH_LIVE_POLL_MS/,
  "polling geri düşüşü canlı ve keşif kadanslarını ayırmalı");
assert.match(app, /futbolradar:live-latency/, "istemci render zamanı ölçülmeli");
assert.match(route, /handleLiveScoreStream/);
assert.match(route, /maxDuration: 300/, "SSE işlev ömrü akış rotasyonundan uzun olmalı");

console.log("live-score-stream OK");
