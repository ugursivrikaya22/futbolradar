#!/usr/bin/env node
/**
 * X etkileşim katmanı testleri — ağ YOK, X/Supabase/API-Football'a gerçek istek YOK.
 *   node scripts/test-x-engagement.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const e = require("../services/xAutopost/engagement.js");
const compose = require("../services/xAutopost/compose.js");
const x = require("../services/xAutopost/index.js");
const { TABLE, createStore } = require("../services/xAutopost/store.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1; }
}

const KICK = "2026-10-25T20:00:00+03:00";
const NOW = new Date("2026-10-25T18:45:00+03:00"); // başlamadan 75 dk önce
function pre(over = {}) {
  return { id: "gs-kon", providerIds: { apiFootball: "777" }, league: "Süper Lig", kickoff: KICK, homeTeam: "Galatasaray", awayTeam: "Konyaspor", status: "SCHEDULED", providerStatus: "NS", ...over };
}
const seoIndex = { "af:777": "galatasaray-konyaspor-25-ekim-2026", "af:778": "fenerbahce-kasimpasa-25-ekim-2026", "af:780": "kasimpasa-goztepe-25-ekim-2026" };
const data = (matches) => ({ calendar: { matches }, seoIndex, columns: { columns: [] }, transfers: [], leaders: {} });
const ON = { X_ENGAGEMENT_ENABLED: "1" };
const LIVE_ENV = { X_AUTOPOST_ENABLED: "1", X_API_KEY: "ck", X_API_SECRET: "cs", X_ACCESS_TOKEN: "at", X_ACCESS_TOKEN_SECRET: "ats" };
const quiet = () => {};

function fakeSupabase() {
  const rows = new Map();
  async function request(pathname, options = {}) {
    const method = options.method || "GET";
    const [table, query = ""] = pathname.split("?");
    assert.equal(table, TABLE);
    const body = options.body ? JSON.parse(options.body) : null;
    const eq = (col) => { const m = query.match(new RegExp(`${col}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
    if (method === "POST") { const r = body[0]; if (rows.has(r.post_key)) return []; rows.set(r.post_key, { ...r }); return [r]; }
    if (method === "PATCH") { const k = eq("post_key"); rows.set(k, { ...rows.get(k), ...body }); return []; }
    if (method === "DELETE") { const k = eq("post_key"); if (rows.get(k)?.status === "pending") rows.delete(k); return []; }
    if (/post_key=in\./.test(query)) { const list = decodeURIComponent(query.match(/in\.\(([^)]*)\)/)[1]).split(",").map((s) => s.replace(/"/g, "")); return [...rows.values()].filter((r) => list.includes(r.post_key)); }
    if (/status=in\./.test(query)) return [...rows.values()].filter((r) => ["posted", "pending"].includes(r.status));
    return [];
  }
  return { request, rows };
}
function fakeX() {
  const sent = [];
  const fetcher = async (url, init) => {
    assert.equal(url, "https://api.x.com/2/tweets");
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 201, json: async () => ({ data: { id: String(5000 + sent.length) } }) };
  };
  return { sent, fetcher };
}

/* ---------------- metin ---------------- */
await test("bayrak: X_ENGAGEMENT_ENABLED varsayılan KAPALI; anket açık, bağlantı kapalı", () => {
  const c = e.engagementConfig({});
  assert.equal(c.enabled, false); assert.equal(c.polls, true); assert.equal(c.links, false); assert.equal(c.followup, true);
  assert.equal(e.engagementConfig({ X_ENGAGEMENT_ENABLED: "1", X_ENGAGEMENT_POLLS: "0" }).polls, false);
  assert.equal(x.config({}).engagement.enabled, false);
});

await test("soru: maça göre deterministik, set dışından değil, maçlar arasında döner", () => {
  const a = e.pickQuestion(pre());
  assert.equal(a, e.pickQuestion(pre()));
  assert.ok(e.QUESTIONS.includes(a));
  const picks = new Set(Array.from({ length: 40 }, (_, i) => e.pickQuestion(pre({ providerIds: { apiFootball: String(i) } }))));
  assert.ok(picks.size >= 3, "rotasyon en az 3 farklı soru üretmeli");
});

await test("metin: başlık, saat (İstanbul), anket çağrısı, soru; bağlantısız ve ≤280", () => {
  const c = e.composePrematch(pre(), "s", { now: NOW });
  assert.match(c.text, /^⏱️ MAÇ ÖNÜ \| Süper Lig\nGalatasaray - Konyaspor · 20:00\n\nKim kazanır\? Ankete oy ver 🗳️\n/);
  assert.ok(c.text.endsWith(e.pickQuestion(pre())));
  assert.doesNotMatch(c.text, /https?:\/\//);
  assert.ok(compose.weightedLength(c.text) <= 280);
  assert.equal(c.key, "prematch:af:777"); assert.equal(c.variant, "poll");
});

await test("metin: X_ENGAGEMENT_LINKS=1 → bağlantı 23 sayılır, 280 aşılmaz; çok uzun adlar kısaltılır", () => {
  const c = e.composePrematch(pre(), "galatasaray-konyaspor-25-ekim-2026", { now: NOW, links: true });
  assert.match(c.text, /https:\/\/www\.futbolradar\.com\/mac\/galatasaray-konyaspor-25-ekim-2026$/);
  const long = "Çok ".repeat(60);
  const d = e.composePrematch(pre({ homeTeam: long, league: "L ".repeat(40) }), "s", { now: NOW, links: true });
  assert.ok(d === null || compose.weightedLength(d.text) <= 280);
});

/* ---------------- anket gövdesi ---------------- */
await test("anket: ev / Beraberlik / deplasman, her seçenek 1–25 karakter", () => {
  assert.deepEqual(e.pollOptions(pre()), ["Galatasaray", "Beraberlik", "Konyaspor"]);
  const o = e.pollOptions(pre({ homeTeam: "Borussia Mönchengladbach Fußball Club", awayTeam: "Wolverhampton Wanderers Football Club" }));
  for (const s of o) assert.ok([...s].length >= 1 && [...s].length <= 25, s);
  assert.deepEqual(e.pollOptions(pre({ homeTeamShort: "GS" })).slice(0, 1), ["GS"]);
  assert.equal(e.pollOptions(pre({ awayTeam: "Galatasaray" })), null, "aynı iki seçenek → anket yok");
});

await test("anket süresi başlama anında biter, 5–10080 dk aralığına sıkıştırılır", () => {
  assert.equal(e.pollDuration(NOW, KICK), 75);
  assert.equal(e.pollDuration(new Date("2026-10-25T19:58:00+03:00"), KICK), 5);
  assert.equal(e.pollDuration(new Date("2026-10-25T21:00:00+03:00"), KICK), 5);
  assert.equal(e.pollDuration(new Date("2026-10-01T00:00:00+03:00"), KICK), 10080);
  assert.equal(e.pollDuration(NOW, "bozuk"), 5);
});

await test("POST /2/tweets gövdesi: text + poll{options,duration_minutes}; anket yoksa poll alanı yok", () => {
  const c = e.composePrematch(pre(), "s", { now: NOW });
  assert.deepEqual(e.tweetPayload(c), { text: c.text, poll: { options: ["Galatasaray", "Beraberlik", "Konyaspor"], duration_minutes: 75 } });
  assert.deepEqual(Object.keys(e.tweetPayload({ text: "a" })), ["text"]);
});

/* ---------------- medya yedeği ---------------- */
await test("medya varsa anket düşer → tek gönderi, metin-soru varyantı (poll alanı yok)", () => {
  const c = e.composePrematch(pre(), "s", { now: NOW, hasMedia: true });
  assert.equal(c.variant, "question"); assert.equal(c.poll, undefined);
  assert.doesNotMatch(c.text, /Ankete oy ver/);
  assert.ok(c.text.endsWith(e.pickQuestion(pre())));
  assert.equal(e.composePrematch(pre(), "s", { now: NOW, polls: false }).poll, undefined);
});

/* ---------------- aday seçimi ---------------- */
await test("aday: yalnızca favori takım maçı, başlamadan 60–90 dk önce; bayrak kapalıyken hiç yok", () => {
  const ms = [pre(), pre({ id: "x", providerIds: { apiFootball: "780" }, homeTeam: "Kasımpaşa", awayTeam: "Göztepe" })];
  const cfg = e.engagementConfig(ON);
  assert.equal(x.buildCandidates(data(ms), { now: NOW }).prematch.length, 0);
  assert.deepEqual(x.buildCandidates(data(ms), { now: NOW, engagementCfg: cfg }).prematch.map((p) => p.key), ["prematch:af:777"]);
  for (const t of ["2026-10-25T18:20:00+03:00", "2026-10-25T19:10:00+03:00", "2026-10-25T20:05:00+03:00"]) {
    assert.equal(x.buildCandidates(data(ms), { now: new Date(t), engagementCfg: cfg }).prematch.length, 0, t);
  }
  assert.equal(x.buildCandidates(data([pre()]), { now: new Date("2026-10-25T18:30:00+03:00"), engagementCfg: cfg }).prematch.length, 1);
  assert.equal(x.buildCandidates(data([pre()]), { now: new Date("2026-10-25T19:00:00+03:00"), engagementCfg: cfg }).prematch.length, 1);
});

/* ---------------- koşu ---------------- */
await test("kuru koşu: X_AUTOPOST_ENABLED kapalı → anket loglanır, X'e istek yok", async () => {
  const tw = fakeX();
  const r = await x.runXAutopost({ env: { ...ON }, now: NOW, data: data([pre()]), fetcher: tw.fetcher, log: quiet });
  assert.equal(r.mode, "dry-run"); assert.equal(tw.sent.length, 0);
  assert.equal(r.dryRun[0].kind, "prematch"); assert.equal(r.dryRun[0].poll.duration_minutes, 75);
});

await test("canlı: anket gövdesi gönderilir, bir kez; günlük tavana sayılır", async () => {
  const db = fakeSupabase(); const store = createStore({ request: db.request }); const tw = fakeX();
  const r = await x.runXAutopost({ env: { ...LIVE_ENV, ...ON }, now: NOW, data: data([pre()]), store, fetcher: tw.fetcher, log: quiet });
  assert.deepEqual(r.posted.map((p) => p.key), ["prematch:af:777"]);
  assert.deepEqual(tw.sent[0].poll, { options: ["Galatasaray", "Beraberlik", "Konyaspor"], duration_minutes: 75 });
  await x.runXAutopost({ env: { ...LIVE_ENV, ...ON }, now: new Date("2026-10-25T19:00:00+03:00"), data: data([pre()]), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(tw.sent.length, 1, "aynı maça ikinci anket yok");
  const r3 = await x.runXAutopost({ env: { ...LIVE_ENV, ...ON, X_MAX_PER_DAY: "1" }, now: NOW, data: data([pre({ providerIds: { apiFootball: "778" }, homeTeam: "Fenerbahçe", awayTeam: "Kasımpaşa" })]), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r3.skipped[0].reason, "day-cap");
});

await test("takip: maç öncesi gönderisi paylaşıldıysa maç sonunda 'Tahminini tutturan var mı?'", async () => {
  const db = fakeSupabase(); const store = createStore({ request: db.request }); const tw = fakeX();
  const done = pre({ status: "FINISHED", providerStatus: "FT", score: { home: 2, away: 1 } });
  const after = new Date("2026-10-25T22:00:00+03:00");
  // Maç öncesi gönderisi yoksa takip yok (sonuç tweeti yine gider).
  const r0 = await x.runXAutopost({ env: { ...LIVE_ENV, ...ON }, now: after, data: data([done]), store: createStore({ request: fakeSupabase().request }), fetcher: fakeX().fetcher, log: quiet });
  assert.ok(!r0.posted.some((p) => p.key.startsWith("followup:")));
  await x.runXAutopost({ env: { ...LIVE_ENV, ...ON }, now: NOW, data: data([pre()]), store, fetcher: tw.fetcher, log: quiet });
  const r = await x.runXAutopost({ env: { ...LIVE_ENV, ...ON }, now: after, data: data([done]), store, fetcher: tw.fetcher, log: quiet });
  assert.ok(r.posted.some((p) => p.key === "followup:af:777"));
  const f = tw.sent.find((b) => /Tahminini tutturan/.test(b.text));
  assert.equal(f.text, "🏁 Galatasaray 2-1 Konyaspor\n\nTahminini tutturan var mı? 🎯 Yorumlara yaz 👇");
  assert.equal(f.poll, undefined);
});

await test("bayrak kapalıyken mevcut akış birebir aynı (prematch/followup yok)", async () => {
  const done = pre({ status: "FINISHED", providerStatus: "FT", score: { home: 2, away: 1 } });
  const c = x.buildCandidates(data([done, pre({ providerIds: { apiFootball: "778" } })]), { now: NOW });
  assert.equal(c.prematch.length + c.followups.length, 0);
});

console.log(`\n${passed} test geçti${process.exitCode ? " — HATA VAR" : ""}`);
