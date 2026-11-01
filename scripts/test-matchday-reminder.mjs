#!/usr/bin/env node
/**
 * PWA "favori takımının maçı bugün" hatırlatması testleri — ağ YOK, Supabase
 * YOK, gerçek push YOK (sahte gönderici ve depo).
 *   node scripts/test-matchday-reminder.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const r = require("../services/matchdayReminder.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1; }
}

const teams = [{ id: "galatasaray", name: "Galatasaray" }, { id: "fenerbahce", name: "Fenerbahçe" }, { id: "611", name: "Göztepe" }];
const M = (over = {}) => ({ id: "x1", providerIds: { apiFootball: "777" }, league: "Süper Lig", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", kickoff: "2026-11-01T20:00:00+03:00", status: "SCHEDULED", providerStatus: "NS", ...over });
const data = (matches = [M()]) => ({ calendar: { matches }, teams, seoIndex: { "af:777": "galatasaray-fenerbahce-1-kasim-2026" } });
const AT = (s) => new Date(`2026-11-01T${s}:05+03:00`);
const ENV = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:x@example.com" };

function fakes({ subs = { galatasaray: [{ endpoint: "e1", p256dh: "p", auth: "a" }, { endpoint: "e2", p256dh: "p", auth: "a" }], fenerbahce: [{ endpoint: "e3", p256dh: "p", auth: "a" }] }, sendStatus = 201, logFails = false } = {}) {
  const sent = []; const removed = []; const keys = new Map();
  const subscriptions = { isConfigured: () => true, listByTeam: async (t) => subs[t] || [], removeSubscription: async (e) => removed.push(e), markSent: async () => {} };
  const log = { claim: async (k) => { if (logFails) throw new Error("push-reminder-log-http-404"); if (keys.has(k)) return false; keys.set(k, null); return true; }, finish: async (k, n) => keys.set(k, n) };
  const send = async (sub, payload, opts) => { sent.push({ sub: sub.endpoint, payload, opts }); return { ok: sendStatus < 300, status: sendStatus, expired: sendStatus === 410 }; };
  return { sent, removed, keys, subscriptions, log, send };
}

await test("aday: bugün maç → iki takım için ayrı anahtar, metin ve bağlantı", () => {
  const list = r.buildReminders(data(), { now: AT("09") });
  assert.deepEqual(list.map((x) => x.key), ["matchday:2026-11-01:af:777:galatasaray", "matchday:2026-11-01:af:777:fenerbahce"]);
  assert.deepEqual(list[0].payload, { title: "📅 Favori takımının maçı bugün", body: "Galatasaray - Fenerbahçe · bugün saat 20:00 · Süper Lig", tag: "matchday-af:777", url: "/mac/galatasaray-fenerbahce-1-kasim-2026" });
  assert.equal(list[0].ttlSeconds, 10 * 3600 + 55 * 60);
});

await test("aday: sessiz saat, yarın, başlamış, 15 dk'dan az, tanınmayan takım → yok", () => {
  assert.equal(r.buildReminders(data(), { now: AT("08") }).length, 0, "09:00 öncesi");
  assert.equal(r.buildReminders(data(), { now: AT("22") }).length, 0, "22:00 sonrası");
  assert.equal(r.buildReminders(data([M({ kickoff: "2026-11-02T20:00:00+03:00" })]), { now: AT("10") }).length, 0, "yarın");
  assert.equal(r.buildReminders(data([M({ providerStatus: "1H" })]), { now: AT("10") }).length, 0, "canlı");
  assert.equal(r.buildReminders(data([M({ kickoff: "2026-11-01T10:15:00+03:00" })]), { now: AT("10") }).length, 0, "15 dk'dan az");
  assert.equal(r.buildReminders(data([M({ homeTeam: "Bilinmeyen", awayTeam: "Yok" })]), { now: AT("10") }).length, 0);
});

await test("İstanbul gün sınırı: UTC'de dün olan 00:30 maçı İstanbul'da bugün sayılmaz/sayılır doğru", () => {
  const late = M({ kickoff: "2026-11-01T21:30:00Z" }); // İstanbul 2 Kasım 00:30
  assert.equal(r.buildReminders(data([late]), { now: AT("12") }).length, 0);
});

await test("koşu: gönderir, ikinci koşuda tekrar yok", async () => {
  const f = fakes();
  const s1 = await r.runMatchdayReminder({ env: ENV, now: AT("09"), data: data(), subscriptions: f.subscriptions, log: f.log, send: f.send, logger: () => {} });
  assert.equal(s1.sent, 3); assert.equal(f.sent.length, 3);
  assert.equal(f.sent[0].opts.vapidPrivateKey, "priv"); assert.ok(f.sent[0].opts.ttlSeconds > 0);
  const s2 = await r.runMatchdayReminder({ env: ENV, now: AT("10"), data: data(), subscriptions: f.subscriptions, log: f.log, send: f.send, logger: () => {} });
  assert.equal(s2.sent, 0); assert.ok(s2.skipped.every((x) => x.reason === "already-sent")); assert.equal(f.sent.length, 3);
});

await test("koşu: süresi dolmuş abonelik silinir", async () => {
  const f = fakes({ sendStatus: 410 });
  const s = await r.runMatchdayReminder({ env: ENV, now: AT("09"), data: data(), subscriptions: f.subscriptions, log: f.log, send: f.send, logger: () => {} });
  assert.equal(s.sent, 0); assert.deepEqual(f.removed.sort(), ["e1", "e2", "e3"]);
});

await test("güvenlik: VAPID yok / kapalı / tekrar kaydı yok → hiç gönderim yok", async () => {
  const f = fakes();
  assert.equal((await r.runMatchdayReminder({ env: {}, now: AT("09"), data: data(), subscriptions: f.subscriptions, log: f.log, send: f.send })).reason, "vapid-not-configured");
  assert.equal((await r.runMatchdayReminder({ env: { ...ENV, PUSH_MATCHDAY_REMINDER_ENABLED: "0" }, now: AT("09"), data: data(), subscriptions: f.subscriptions, log: f.log, send: f.send })).status, "skipped");
  assert.equal((await r.runMatchdayReminder({ env: ENV, now: AT("23"), data: data(), subscriptions: f.subscriptions, log: f.log, send: f.send })).reason, "quiet-hours");
  const g = fakes({ logFails: true });
  const s = await r.runMatchdayReminder({ env: ENV, now: AT("09"), data: data(), subscriptions: g.subscriptions, log: g.log, send: g.send, logger: () => {} });
  assert.equal(g.sent.length, 0, "0015 tablosu yoksa gönderilmez"); assert.equal(s.status, "partial");
  assert.equal(f.sent.length, 0);
});

await test("PUSH_MATCHDAY_START_HOUR ve abonesi olmayan takım", async () => {
  assert.equal(r.buildReminders(data(), { now: AT("09"), startHour: 11 }).length, 0);
  const f = fakes({ subs: {} });
  const s = await r.runMatchdayReminder({ env: ENV, now: AT("09"), data: data(), subscriptions: f.subscriptions, log: f.log, send: f.send, logger: () => {} });
  assert.equal(s.sent, 0); assert.equal(f.keys.size, 0, "abonesi yoksa anahtar harcanmaz");
});

await test("cron: matchday-reminder işi kayıtlı, CRON_SECRET olmadan 401; vercel.json takvimi", async () => {
  const { handleCron, JOBS } = require("../server/cronRoute.js");
  assert.ok(JOBS.has("matchday-reminder"));
  let status = 0; const res = { setHeader() {}, end() {}, set statusCode(v) { status = v; } };
  await handleCron({ url: "/api/cron/matchday-reminder", method: "GET", headers: {} }, res, { env: {}, runners: { "matchday-reminder": async () => { throw new Error("çağrılmamalı"); } } });
  assert.equal(status, 401);
  const vercel = JSON.parse(require("fs").readFileSync("vercel.json", "utf8"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/cron/matchday-reminder" && c.schedule === "5 6-19 * * *"));
});

await test("service worker push işleyicisi yükü olduğu gibi gösterir (title/body/tag/url)", () => {
  const sw = require("fs").readFileSync("sw.js", "utf8");
  assert.match(sw, /addEventListener\("push"/); assert.match(sw, /payload\.url/); assert.match(sw, /payload\.tag/);
});

console.log(`\n${passed} test geçti${process.exitCode ? " — HATA VAR" : ""}`);
