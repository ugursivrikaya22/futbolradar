#!/usr/bin/env node
// Push güvenilirliği: sarı kart / penaltı tespiti, örnekler arası
// tekilleştirme, zamanlanmış tik ve yönetici test uç noktası yetkisi.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
for (const name of ["SUPABASE_URL", "HOME_POLL_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "HOME_POLL_SUPABASE_KEY", "CRON_SECRET", "ADMIN_TEST_TOKEN"]) delete process.env[name];

const stream = require("../services/liveScoreStream.js");
const notifier = require("../services/pushNotifier.js");
const subscriptionStore = require("../services/pushSubscriptionStore.js");
const webPush = require("../services/webPush.js");
const eventStore = require("../services/pushEventStore.js");
const tick = require("../server/liveScoreTickRoute.js");
const admin = require("../server/adminTestGoalRoute.js");

let failures = 0;
async function ok(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack}`); }
}

function snap(score, events, extra = {}) {
  return stream.matchSnapshot({ id: "77", providerId: "77", homeTeam: "Fenerbahçe", awayTeam: "Galatasaray", status: "2H", live: true, minute: 60, score, events, ...extra }, "2026-10-20T20:00:00.000Z");
}
const ev = (type, detail, time, team, value) => ({ type, detail, time, team: { name: team }, value });
const detect = (prev, next) => stream.detectMatchEvents(new Map([[prev.id, prev]]), [next], true);

await ok("yeni sarı kart olayı yellow-card üretir; tekrar yoklamada üretmez", () => {
  const prev = snap({ home: 0, away: 0 }, []);
  const next = snap({ home: 0, away: 0 }, [ev("Card", "Yellow Card", "33'", "Galatasaray", "Icardi · Yellow Card")]);
  const events = detect(prev, next);
  assert.deepEqual(events.map((e) => e.type), ["yellow-card"]);
  assert.equal(events[0].side, "away");
  assert.equal(detect(next, next).length, 0);
  const payload = notifier.buildPayload(events[0]);
  assert.equal(payload.title, "🟨 Sarı kart");
  assert.match(payload.body, /Icardi \(Galatasaray\)/);
});

await ok("ikinci sarı yalnızca kırmızı sayılır (çift bildirim yok)", () => {
  const prev = snap({ home: 0, away: 0 }, []);
  const next = snap({ home: 0, away: 0 }, [ev("Card", "Second Yellow card", "70'", "Fenerbahçe", "X")]);
  assert.deepEqual(detect(prev, next).map((e) => e.type), ["red-card"]);
});

await ok("penaltı golü tek gol bildirimi olarak işaretlenir", () => {
  const prev = snap({ home: 0, away: 0 }, []);
  const next = snap({ home: 1, away: 0 }, [ev("Goal", "Penalty", "50'", "Fenerbahçe", "Dzeko · Penalty")]);
  const events = detect(prev, next);
  assert.deepEqual(events.map((e) => [e.type, e.penalty]), [["goal", true]]);
  assert.match(notifier.buildPayload(events[0]).title, /^⚽ PENALTI GOLÜ! Fenerbahçe/);
});

await ok("kaçan penaltı penalty/missed üretir, skor değişmez", () => {
  const prev = snap({ home: 0, away: 0 }, []);
  const next = snap({ home: 0, away: 0 }, [ev("Goal", "Missed Penalty", "80'", "Galatasaray", "Mertens · Missed Penalty")]);
  const events = detect(prev, next);
  assert.deepEqual(events.map((e) => [e.type, e.outcome]), [["penalty", "missed"]]);
  assert.equal(notifier.buildPayload(events[0]).title, "❌ Penaltı kaçtı");
});

await ok("normal gol penaltı sayılmaz; mevcut türler aynen çalışır", () => {
  const prev = snap({ home: 0, away: 0 }, []);
  const next = snap({ home: 1, away: 0 }, [ev("Goal", "Normal Goal", "12'", "Fenerbahçe", "X")]);
  const [goal] = detect(prev, next);
  assert.equal(goal.penalty, false);
  assert.match(notifier.buildPayload(goal).title, /^⚽ GOL! Fenerbahçe/);
});

await ok("olay anahtarı örnekler arasında kararlı", () => {
  const prev = snap({ home: 0, away: 0 }, []);
  const next = snap({ home: 1, away: 0 }, []);
  const a = stream.matchEventKey(detect(prev, next)[0]);
  const b = stream.matchEventKey(detect(prev, next)[0]);
  assert.equal(a, b);
  assert.equal(a, "77:goal:1-0:home");
});

await ok("claimEvent: çakışma → false, ekleme → true, hata/yapılandırma yok → true", async () => {
  assert.equal(await eventStore.claimEvent("k"), true, "Supabase yoksa eski davranış");
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  try {
    const calls = [];
    const fake = (rows, status = 200) => async (url, init) => { calls.push([url, init]); return { ok: status < 400, status, text: async () => JSON.stringify(rows) }; };
    assert.equal(await eventStore.claimEvent("k1", {}, fake([{ event_key: "k1" }])), true);
    assert.equal(await eventStore.claimEvent("k1", {}, fake([])), false);
    assert.equal(await eventStore.claimEvent("k1", {}, fake({}, 500)), true);
    assert.match(calls[0][0], /push_event_dedup\?on_conflict=event_key$/);
    assert.match(calls[0][1].headers.Prefer, /ignore-duplicates/);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

await ok("notifyMatchEvents: talebi kaybeden örnek göndermez", async () => {
  Object.assign(process.env, { VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s", VAPID_SUBJECT: "mailto:t@t", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" });
  const original = { list: subscriptionStore.listByTeam, send: webPush.sendNotification, mark: subscriptionStore.markSent };
  let sends = 0;
  subscriptionStore.listByTeam = async () => [{ endpoint: "https://push.example/1", p256dh: "a", auth: "b" }];
  subscriptionStore.markSent = async () => {};
  webPush.sendNotification = async () => { sends += 1; return { ok: true }; };
  try {
    const goal = { type: "goal", side: "home", match: snap({ home: 1, away: 0 }, []) };
    const lost = await notifier.notifyMatchEvents([goal], { claimEvent: async () => false });
    assert.equal(sends, 0);
    assert.equal(lost.skipped, 1);
    const won = await notifier.notifyMatchEvents([goal], { claimEvent: async () => true });
    assert.equal(won.sent, 1, "aynı uç nokta birden çok anahtarda olsa da bir kez");
    assert.equal(sends, 1);
  } finally {
    subscriptionStore.listByTeam = original.list;
    subscriptionStore.markSent = original.mark;
    webPush.sendNotification = original.send;
    for (const name of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[name];
  }
});

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b ? JSON.parse(b) : null; return this; } };
  return res;
}
const req = (url, method, headers = {}, body) => ({ url, method, headers, body, socket: { remoteAddress: `10.0.0.${Math.floor(Math.random() * 200)}` } });

await ok("tik: CRON_SECRET yoksa 404, yanlışsa 401", async () => {
  let res = fakeRes();
  await tick.handleLiveScoreTick(req("/api/live-score-tick", "GET", { authorization: "Bearer x" }), res);
  assert.equal(res.statusCode, 404);
  process.env.CRON_SECRET = "cron-secret-value";
  try {
    res = fakeRes();
    await tick.handleLiveScoreTick(req("/api/live-score-tick", "GET", { authorization: "Bearer wrong" }), res);
    assert.equal(res.statusCode, 401);
    res = fakeRes();
    await tick.handleLiveScoreTick(req("/api/live-score-tick", "GET", {}), res);
    assert.equal(res.statusCode, 401);
  } finally {
    delete process.env.CRON_SECRET;
  }
});

await ok("tik: maç penceresi dışında depoya bile gitmez", async () => {
  const store = { readSnapshot: async () => { throw new Error("okunmamalı"); }, writeSnapshot: async () => { throw new Error("yazılmamalı"); } };
  const result = await tick.runTick({ now: () => Date.parse("2026-10-20T12:00:00Z"), kickoffs: [Date.parse("2026-10-21T17:00:00Z")], store, notify: async () => assert.fail() });
  assert.deepEqual(result, { ran: false, reason: "no-fixture-window", providerRequests: 0 });
});

await ok("tik: paylaşılan görüntüden olay üretir, sağlayıcıya gitmez, işlenmişi yazar", async () => {
  const now = Date.parse("2026-10-20T20:01:00Z");
  const prev = snap({ home: 0, away: 0 }, []);
  const next = snap({ home: 1, away: 0 }, []);
  const rows = { live: { matches: [next], fetchedAt: "2026-10-20T20:00:30Z" }, processed: { matches: [prev], fetchedAt: "2026-10-20T20:00:00Z" } };
  const writes = [];
  const store = { readSnapshot: async (id) => rows[id] || null, writeSnapshot: async (...args) => writes.push(args) };
  let notified = [];
  const result = await tick.runTick({ now: () => now, kickoffs: [now - 3600000], store, notify: async (events) => { notified = events; return { sent: 2, skipped: 0 }; } });
  assert.deepEqual(notified.map((e) => e.type), ["goal"]);
  assert.equal(result.providerRequests, 0);
  assert.equal(result.sent, 2);
  assert.equal(writes[0][0], "processed");
  const again = await tick.runTick({ now: () => now, kickoffs: [now], store: { ...store, readSnapshot: async () => rows.live } });
  assert.equal(again.reason, "no-new-snapshot");
  const stale = await tick.runTick({ now: () => now + 10 * 60000, kickoffs: [now], store });
  assert.equal(stale.reason, "stale-shared-snapshot");
});

await ok("tik: uzun boşluktan sonra 'maç başladı' üretilmez", async () => {
  const now = Date.parse("2026-10-20T20:01:00Z");
  const rows = { live: { matches: [snap({ home: 0, away: 0 }, [])], fetchedAt: "2026-10-20T20:00:30Z" }, processed: { matches: [], fetchedAt: "2026-10-20T18:00:00Z" } };
  let notified = null;
  await tick.runTick({ now: () => now, kickoffs: [now], store: { readSnapshot: async (id) => rows[id], writeSnapshot: async () => {} }, notify: async (e) => { notified = e; return {}; } });
  assert.equal(notified, null);
});

await ok("yönetici: token yoksa 404, yanlışsa 401, dryRun yük döndürür", async () => {
  let res = fakeRes();
  await admin.handleAdminTestGoal(req("/api/admin/test-goal", "POST", {}, { team: "fenerbahce" }), res);
  assert.equal(res.statusCode, 404);
  process.env.ADMIN_TEST_TOKEN = "admin-token-value";
  try {
    res = fakeRes();
    await admin.handleAdminTestGoal(req("/api/admin/test-goal", "POST", { authorization: "Bearer nope" }, {}), res);
    assert.equal(res.statusCode, 401);
    for (const type of ["goal", "yellow-card", "red-card", "penalty"]) {
      res = fakeRes();
      await admin.handleAdminTestGoal(req("/api/admin/test-goal", "POST", { authorization: "Bearer admin-token-value" }, { team: "fenerbahce", type, dryRun: true }), res);
      assert.equal(res.statusCode, 200, type);
      assert.equal(res.body.data.dryRun, true);
      assert.match(res.body.data.payload.title, /^\[TEST\] /);
      assert.deepEqual(res.body.data.subscriberKeys, ["fenerbahce"]);
    }
    res = fakeRes();
    await admin.handleAdminTestGoal(req("/api/admin/test-goal", "POST", { "x-admin-token": "admin-token-value" }, { team: "fenerbahce", type: "corner", dryRun: true }), res);
    assert.equal(res.statusCode, 400);
    res = fakeRes();
    await admin.handleAdminTestGoal(req("/api/admin/test-goal", "POST", { authorization: "Bearer admin-token-value" }, { team: "fenerbahce" }), res);
    assert.equal(res.statusCode, 503, "yapılandırılmamışken gerçek gönderim denenmez");
    res = fakeRes();
    await admin.handleAdminTestGoal(req("/api/admin/other", "POST", { authorization: "Bearer admin-token-value" }, {}), res);
    assert.equal(res.statusCode, 404);
  } finally {
    delete process.env.ADMIN_TEST_TOKEN;
  }
});

await ok("canlı kayıt yazıcısı: aynı sağlayıcı yanıtını bir kez yazar, Supabase yoksa hiçbir şey yapmaz", async () => {
  eventStore.resetRecorder();
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push([url, init]); return { ok: true, status: 201, text: async () => "" }; };
  try {
    const rows = [{ id: "77", providerId: "77", homeTeam: "A", awayTeam: "B", status: "1H", live: true, score: { home: 0, away: 0 }, fetchedAt: "2026-10-20T20:00:00.000Z" }];
    eventStore.recordLiveFixtures(rows, 1000000);
    assert.equal(calls.length, 0, "Supabase yokken yazma yok");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    eventStore.recordLiveFixtures(rows, 1000000);
    eventStore.recordLiveFixtures(rows, 1100000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1, "aynı fetchedAt ikinci kez yazılmaz");
    assert.match(calls[0][0], /push_live_snapshots\?on_conflict=id$/);
    assert.equal(JSON.parse(calls[0][1].body).id, "live");
  } finally {
    globalThis.fetch = original;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    eventStore.resetRecorder();
  }
});

await ok("safeEqual uzunluk farkında false", () => {
  assert.equal(tick.safeEqual("abc", "abcd"), false);
  assert.equal(tick.safeEqual("abc", "abc"), true);
});

if (failures) {
  console.error(`${failures} test başarısız`);
  process.exit(1);
}
console.log("push güvenilirlik testleri geçti");
