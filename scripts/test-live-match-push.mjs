#!/usr/bin/env node
/**
 * Canlı maç push cron'u testleri — ağ YOK, Supabase YOK, gerçek push YOK.
 *   node scripts/test-live-match-push.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lp = require("../services/liveMatchPush.js");
const { handleLiveMatchPushCron } = require("../server/liveMatchPushCronRoute.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1; }
}

const ENV = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:x@example.com" };
const teams = [{ id: "galatasaray", name: "Galatasaray" }];
const KICK = "2026-11-03T20:45:00+03:00";
const AT = (hhmm) => new Date(`2026-11-03T${hhmm}:00+03:00`);
const F = (over = {}) => ({ id: "900", providerId: "900", homeTeam: "Galatasaray", awayTeam: "Stuttgart", kickoff: KICK, providerStatus: "NS", status: "SCHEDULED", score: { home: null, away: null }, events: [], ...over });

function memStore() {
  const rows = new Map();
  return {
    rows,
    read: async (k) => (rows.has(k) ? JSON.parse(rows.get(k)) : null),
    write: async (k, _kind, v) => { rows.set(k, JSON.stringify(v)); },
    claim: async (k) => { if (rows.has(k)) return false; rows.set(k, "null"); return true; }
  };
}
function fakeProvider(state) {
  const calls = [];
  return {
    calls,
    getFixtures: async (q) => {
      calls.push(q.live ? "live" : q.date ? "date" : "id");
      if (q.date) return [F(), F({ id: "1", providerId: "1", homeTeam: "A", awayTeam: "B" })];
      if (q.live) return state.live;
      return state.byId || [];
    }
  };
}
async function run(state, store, now, sent) {
  return lp.runLiveMatchPush({ env: ENV, now, provider: state.p, store, teams, subscriptionsConfigured: true, notify: async (ev) => sent.push(...ev) });
}

await test("yapılandırılmamış: VAPID/Supabase yoksa sessizce skipped", async () => {
  assert.equal((await lp.runLiveMatchPush({ env: {} })).reason, "vapid-not-configured");
  assert.equal((await lp.runLiveMatchPush({ env: ENV, subscriptionsConfigured: false })).reason, "supabase-not-configured");
  assert.equal((await lp.runLiveMatchPush({ env: { ...ENV, PUSH_LIVE_MATCH_ENABLED: "0" } })).status, "skipped");
});

await test("log tablosu yoksa skipped, sağlayıcıya gidilmez", async () => {
  const state = { live: [] }; state.p = fakeProvider(state);
  const store = { read: async () => { throw new Error("push-reminder-log-http-404"); } };
  const r = await run(state, store, AT("20:40"), []);
  assert.equal(r.status, "skipped"); assert.deepEqual(state.p.calls, []);
});

await test("pencere dışı: günde tek program isteği, canlı yoklama yok", async () => {
  const state = { live: [] }; state.p = fakeProvider(state); const store = memStore();
  await run(state, store, AT("12:00"), []); await run(state, store, AT("13:00"), []);
  assert.deepEqual(state.p.calls, ["date"]);
  assert.deepEqual(JSON.parse(store.rows.get("schedule:2026-11-03")).map((x) => x.id), ["900"], "yalnızca takipteki takımlar");
});

await test("olay tespiti: maç başı, gol, devre arası, kırmızı kart, maç sonu", async () => {
  const state = { live: [] }; state.p = fakeProvider(state); const store = memStore(); const sent = [];
  await run(state, store, AT("20:35"), sent); // pencere açık, canlı yok
  state.live = [F({ providerStatus: "1H", minute: 1, score: { home: 0, away: 0 } })];
  await run(state, store, AT("20:46"), sent);
  state.live = [F({ providerStatus: "1H", minute: 30, score: { home: 1, away: 0 } })];
  await run(state, store, AT("21:16"), sent);
  state.live = [F({ providerStatus: "HT", minute: 45, score: { home: 1, away: 0 } })];
  await run(state, store, AT("21:33"), sent);
  state.live = [F({ providerStatus: "2H", minute: 60, score: { home: 1, away: 0 }, events: [{ detail: "Red Card" }] })];
  await run(state, store, AT("22:05"), sent);
  state.live = []; state.byId = [F({ providerStatus: "FT", minute: 90, score: { home: 1, away: 0 }, events: [{ detail: "Red Card" }] })];
  await run(state, store, AT("22:40"), sent);
  assert.deepEqual(sent.map((e) => e.type), ["kickoff", "goal", "halftime", "red-card", "fulltime"]);
  assert.equal(sent[1].side, "home");
});

await test("tekrarsızlık: aynı durum tekrar yoklanınca ve SSE aynı olayı aldıysa gönderilmez", async () => {
  const state = { live: [F({ providerStatus: "1H", minute: 30, score: { home: 1, away: 0 } })] }; state.p = fakeProvider(state);
  const store = memStore(); const sent = [];
  await store.write("snap:900", "live-snapshot", { id: "900", live: true, providerStatus: "1H", score: { home: 0, away: 0 }, events: [] });
  await store.claim("goal:900:1-0"); // SSE hattı önce aldı
  const r = await run(state, store, AT("21:16"), sent);
  assert.equal(sent.length, 0); assert.equal(r.duplicates, 1);
  await run(state, store, AT("21:19"), sent);
  assert.equal(sent.length, 0);
});

await test("ilk gözlem bitmiş maçta yalnızca maç sonu; ilerlemiş maçta maç başı yok", async () => {
  const done = lp.eventsFor(null, { id: "9", live: false, providerStatus: "FT", score: { home: 2, away: 1 }, events: [] });
  assert.deepEqual(done.map((e) => e.type), ["fulltime"]);
  const mid = lp.eventsFor(null, { id: "9", live: true, providerStatus: "2H", minute: 70, score: { home: 0, away: 0 }, events: [] });
  assert.deepEqual(mid.map((e) => e.type), []);
});

await test("eventKey deterministik", async () => {
  const m = { id: "900", score: { home: 2, away: 1 }, minute: 77 };
  assert.equal(lp.eventKey({ type: "goal", match: m }), "goal:900:2-1");
  assert.equal(lp.eventKey({ type: "red-card", match: m }), "red:900:77");
  assert.equal(lp.eventKey({ type: "kickoff", match: m }), "kickoff:900");
  assert.equal(lp.eventKey({ type: "halftime", match: m }), "halftime:900");
  assert.equal(lp.eventKey({ type: "fulltime", match: m }), "fulltime:900");
});

await test("cron uç noktası CRON_SECRET olmadan 401, doğru sırla çalışır", async () => {
  const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } });
  const r1 = res(); await handleLiveMatchPushCron({ headers: {} }, r1, { env: {}, run: async () => ({}) });
  assert.equal(r1.statusCode, 401);
  const r2 = res(); await handleLiveMatchPushCron({ headers: { authorization: "Bearer s" } }, r2, { env: { CRON_SECRET: "x" }, run: async () => ({}) });
  assert.equal(r2.statusCode, 401);
  const r3 = res(); await handleLiveMatchPushCron({ headers: { authorization: "Bearer s" } }, r3, { env: { CRON_SECRET: "s" }, run: async () => ({ status: "skipped" }) });
  assert.equal(r3.statusCode, 200); assert.equal(r3.body.result.status, "skipped");
});

console.log(`\n${passed} test geçti`);
