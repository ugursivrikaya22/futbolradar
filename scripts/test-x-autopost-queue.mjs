#!/usr/bin/env node
/**
 * X otomatik paylaşım — kuyruk/kısıcı, 429 geri çekilme, içerik tekrarı,
 * OAuth 2.0 (PKCE + yenileme), bağlantı-yanıtı modu, acil durdurma,
 * maçsız gün istatistik sayfaları. Ağ YOK, Supabase YOK, X'e istek YOK.
 *   node scripts/test-x-autopost-queue.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createThrottle, rateLimitWaitMs } = require("../services/xAutopost/throttle.js");
const dedupe = require("../services/xAutopost/dedupe.js");
const oauth2 = require("../services/xAutopost/oauth2.js");
const compose = require("../services/xAutopost/compose.js");
const x = require("../services/xAutopost/index.js");
const { createStore } = require("../services/xAutopost/store.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1; }
}
const quiet = () => {};

/* ---------------- sahteler ---------------- */
function fakeSupabase() {
  const rows = new Map();
  async function request(pathname, options = {}) {
    const method = options.method || "GET";
    const [, query = ""] = pathname.split("?");
    const body = options.body ? JSON.parse(options.body) : null;
    const eq = (col) => { const m = query.match(new RegExp(`${col}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
    if (method === "POST") { const r = body[0]; if (rows.has(r.post_key)) return []; const full = { ...r, created_at: new Date().toISOString() }; rows.set(r.post_key, full); return [full]; }
    if (method === "PATCH") { const k = eq("post_key"); rows.set(k, { ...rows.get(k), ...body }); return []; }
    if (method === "DELETE") { const k = eq("post_key"); if (rows.get(k)?.status === "pending") rows.delete(k); return []; }
    if (/post_key=in\./.test(query)) { const list = decodeURIComponent(query.match(/in\.\(([^)]*)\)/)[1]).split(",").map((s) => s.replace(/"/g, "")); return [...rows.values()].filter((r) => list.includes(r.post_key)); }
    if (/status=in\./.test(query)) { const kind = eq("kind"); return [...rows.values()].filter((r) => ["posted", "pending"].includes(r.status) && (!kind || r.kind === kind)); }
    return [];
  }
  return { rows, request };
}
function fakeX({ status = 201, headers = {}, failOn = null } = {}) {
  const sent = []; const auth = [];
  let n = 1000;
  async function fetcher(url, opts) {
    assert.equal(url, "https://api.x.com/2/tweets");
    const body = JSON.parse(opts.body); sent.push(body); auth.push(opts.headers.Authorization);
    const st = failOn && failOn(body, sent.length) ? failOn(body, sent.length) : status;
    const h = new Map(Object.entries(headers));
    return { ok: st < 300, status: st, headers: { get: (k) => h.get(k) ?? null }, json: async () => (st < 300 ? { data: { id: String(++n) } } : { title: st === 429 ? "Too Many Requests" : "Forbidden", detail: "x" }) };
  }
  return { sent, auth, fetcher };
}
const LIVE_ENV = { X_AUTOPOST_ENABLED: "true", X_API_KEY: "ck", X_API_SECRET: "cs", X_ACCESS_TOKEN: "at", X_ACCESS_TOKEN_SECRET: "ats" };
const SLUG = "fenerbahce-slavia-praha-20-ekim-2026";
const NOW = new Date("2026-10-20T23:40:00+03:00");
const finished = {
  id: "fb-sp", providerIds: { apiFootball: "1635661" }, league: "Şampiyonlar Ligi", kickoff: "2026-10-20T19:45:00+03:00",
  homeTeam: "Fenerbahçe", awayTeam: "Slavia Praha", status: "FINISHED", providerStatus: "FT", score: { home: 2, away: 2 },
  statistics: [{ type: "İsabetli şut", home: 4, away: 4 }],
  events: [{ time: "4'", team: { name: "Fenerbahçe" }, type: "Goal", detail: "Normal Goal", value: "Oğuz Aydın · Normal Goal" }]
};
const data = (over = {}) => ({ calendar: { matches: [finished] }, seoIndex: { "af:1635661": SLUG }, columns: { columns: [] }, transfers: [], leaders: null, standings: null, ...over });

/* ---------------- kısıcı ---------------- */
await test("kısıcı: 100/15dk ve 10.000/24sa resmi sınırların %80'i (80 / 8000)", () => {
  const t = createThrottle();
  assert.equal(t.cap15, 80); assert.equal(t.cap24, 8000);
  let clock = 0; const th = createThrottle({ seed15m: 78, now: () => clock });
  assert.ok(th.check().ok); th.record(); th.record();
  assert.deepEqual(th.check().reason, "user-15m-cap");
  clock = 15 * 60e3 + 1; // bu koşunun istekleri pencereden çıkınca yeniden izin
  assert.ok(th.check().ok);
  const app = createThrottle({ seed24h: 8000 }); assert.equal(app.check().reason, "app-24h-cap");
});

await test("429: Retry-After (sn ve HTTP tarihi), x-rate-limit-reset, üstel geri çekilme", () => {
  const now = Date.parse("2026-11-04T18:00:00Z");
  assert.equal(rateLimitWaitMs({ "retry-after": "30" }, { now }), 30000);
  assert.equal(rateLimitWaitMs({ "retry-after": "Wed, 04 Nov 2026 18:01:00 GMT" }, { now }), 60000);
  assert.equal(rateLimitWaitMs({ "x-rate-limit-reset": String(now / 1000 + 120) }, { now }), 120000);
  assert.equal(rateLimitWaitMs({}, { now, attempt: 0 }), 60000);
  assert.equal(rateLimitWaitMs({}, { now, attempt: 10 }), 15 * 60e3);
  const map = new Map([["x-rate-limit-reset", String(now / 1000 + 5)]]);
  assert.equal(rateLimitWaitMs({ get: (k) => map.get(k) }, { now }), 5000);
});

await test("canlı koşu: 15 dk penceresi doluysa X'e istek atılmaz, anahtar bırakılır", async () => {
  const db = fakeSupabase(); const store = createStore({ request: db.request });
  for (let i = 0; i < 80; i += 1) db.rows.set(`old:${i}`, { post_key: `old:${i}`, kind: "goal", status: "posted" });
  const tw = fakeX();
  const r = await x.runXAutopost({ env: LIVE_ENV, now: NOW, data: data(), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(tw.sent.length, 0, JSON.stringify(r.skipped)); assert.ok(r.skipped.every((s) => /^throttle:/.test(s.reason)), JSON.stringify(r.skipped));
  assert.ok(!db.rows.has("result:af:1635661"));
});

await test("429 + Retry-After: koşu durur, retryAfterMs raporlanır, satır kalmaz", async () => {
  const db = fakeSupabase(); const store = createStore({ request: db.request });
  const tw = fakeX({ status: 429, headers: { "retry-after": "90" } });
  const r = await x.runXAutopost({ env: LIVE_ENV, now: NOW, data: data(), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r.posted.length, 0); assert.equal(r.retryAfterMs, 90000); assert.equal(tw.sent.length, 1); assert.equal(db.rows.size, 0);
});

/* ---------------- tekrar ---------------- */
await test("içerik özeti: bağlantı/işaret/boşluk/büyük-küçük harf farkı aynı özet", () => {
  assert.equal(dedupe.contentHash("⚽ GOL!\nA 1-0 B\n\n🤖 Otomatik\nhttps://x.y/1"), dedupe.contentHash("⚽ gol! a 1-0 b"));
  assert.notEqual(dedupe.contentHash("A 1-0 B"), dedupe.contentHash("A 2-0 B"));
  const file = `/tmp/x-dedupe-test-${process.pid}.json`;
  const d = dedupe.createFileDedupe(file); d.add("k1");
  assert.ok(dedupe.createFileDedupe(file).has("k1")); fs.rmSync(file, { force: true });
});

await test("aynı metin farklı anahtarla gelirse ikinci kez gönderilmez (duplicate-content)", async () => {
  const db = fakeSupabase(); const store = createStore({ request: db.request });
  const twin = { ...finished, id: "twin", providerIds: { apiFootball: "999" } };
  const tw = fakeX();
  const r = await x.runXAutopost({ env: { ...LIVE_ENV, X_LINK_MODE: "none" }, now: NOW, data: data({ calendar: { matches: [finished, twin] }, seoIndex: { "af:1635661": SLUG, "af:999": SLUG } }), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(tw.sent.length, 1); assert.ok(r.skipped.some((s) => s.reason === "duplicate-content"));
});

/* ---------------- bağlantı modu + işaret ---------------- */
await test("X_LINK_MODE=reply (varsayılan): ana gönderi bağlantısız + 🤖 Otomatik; bağlantı ilk yanıtta", async () => {
  const db = fakeSupabase(); const store = createStore({ request: db.request }); const tw = fakeX();
  const r = await x.runXAutopost({ env: LIVE_ENV, now: NOW, data: data(), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r.linkMode, "reply"); assert.equal(tw.sent.length, 2);
  assert.ok(!/https?:/.test(tw.sent[0].text)); assert.match(tw.sent[0].text, /🤖 Otomatik$/);
  assert.deepEqual(tw.sent[1].reply, { in_reply_to_tweet_id: r.posted[0].id });
  assert.match(tw.sent[1].text, new RegExp(`https://www.futbolradar.com/mac/${SLUG}$`));
  assert.equal(db.rows.get("reply:result:af:1635661").status, "posted");
});

await test("X_LINK_MODE=inline: tek istek; none: bağlantı yok; gol tweetinde bağlantı varsayılan yok", () => {
  const item = { key: "k", kind: "result", text: "A 1-0 B\n\nhttps://www.futbolradar.com/mac/a-b" };
  const inl = compose.applyLinkMode(item, "inline"); assert.equal(inl.reply, null); assert.match(inl.text, /🤖 Otomatik\nhttps:/);
  const none = compose.applyLinkMode(item, "none"); assert.ok(!/https?:/.test(none.text) && !none.reply);
  const cfg = x.config(LIVE_ENV);
  assert.equal(x.finalize({ key: "goal:1", kind: "goal", text: "⚽ GOL!\n\nhttps://www.futbolradar.com/mac/a-b" }, cfg).reply, null);
  assert.equal(x.config({ ...LIVE_ENV, X_INCLUDE_LINKS: "0" }).linkMode, "none");
  assert.equal(x.config({ ...LIVE_ENV, X_AUTOMATED_MARKER: "0" }).marker, "");
});

await test("280 sınırı: işaret sığmıyorsa metin kısaltılmaz, işaret düşer (bağlantı 23 sayılır)", () => {
  const long = "a".repeat(275);
  assert.equal(compose.applyLinkMode({ text: long }, "none").text, long);
  assert.equal(compose.weightedLength("x https://www.futbolradar.com/çok/uzun/bir/yol/ki/23ten/uzun"), 25);
});

/* ---------------- acil durdurma + kuru koşu ---------------- */
await test("X_AUTOPOST_KILL=1: bayrak ve anahtarlar olsa da kuru koşu, X'e istek yok", async () => {
  const tw = fakeX(); const db = fakeSupabase();
  const r = await x.runXAutopost({ env: { ...LIVE_ENV, X_AUTOPOST_KILL: "1" }, now: NOW, data: data(), store: createStore({ request: db.request }), fetcher: tw.fetcher, log: quiet });
  assert.equal(r.mode, "dry-run"); assert.match(r.reason, /KILL/); assert.equal(tw.sent.length, 0); assert.equal(db.rows.size, 0);
  assert.ok(r.dryRun[0].reply && /futbolradar\.com\/mac\//.test(r.dryRun[0].reply));
  const xl = require("../services/socialAutopost/xLive.js").config({ ...LIVE_ENV, X_LIVE_ENABLED: "1", X_AUTOPOST_KILL: "1" });
  assert.equal(xl.live, false, "x-live de durur");
});

await test("kuru koşu varsayılan: hiçbir env yokken gönderim yok ve sır loglanmaz", async () => {
  const lines = []; const tw = fakeX();
  const r = await x.runXAutopost({ env: { X_API_SECRET: "GIZLI-DEGER" }, now: NOW, data: data(), fetcher: tw.fetcher, log: (l) => lines.push(l) });
  assert.equal(r.mode, "dry-run"); assert.equal(tw.sent.length, 0); assert.ok(!lines.join("\n").includes("GIZLI-DEGER"));
});

/* ---------------- OAuth 2.0 ---------------- */
await test("PKCE S256: RFC 7636 Ek B test vektörü", () => {
  const p = oauth2.createPkcePair("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.equal(p.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const url = new URL(oauth2.buildAuthorizeUrl({ clientId: "cid", redirectUri: "https://www.futbolradar.com/", state: "s", challenge: p.challenge }));
  assert.equal(url.origin + url.pathname, "https://x.com/i/oauth2/authorize");
  assert.equal(url.searchParams.get("scope"), "tweet.read tweet.write users.read offline.access");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

await test("OAuth 2.0: yenileme Basic kimlikle; dönen yeni refresh token saklanır; Bearer ile gönderim", async () => {
  const calls = []; const saved = [];
  const tokenFetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ access_token: `acc${calls.length}`, expires_in: 7200, refresh_token: `rt${calls.length}` }) };
  };
  const env = { X_OAUTH2_CLIENT_ID: "cid", X_OAUTH2_CLIENT_SECRET: "sec", X_OAUTH2_REFRESH_TOKEN: "rt0" };
  let t = 0;
  const p = oauth2.createTokenProvider({ env, fetcher: tokenFetch, tokenStore: { load: async () => null, save: async (v) => saved.push(v) }, now: () => t });
  assert.equal(await p.getAccessToken(), "acc1");
  assert.equal(calls[0].url, "https://api.x.com/2/oauth2/token");
  assert.equal(calls[0].opts.headers.Authorization, `Basic ${Buffer.from("cid:sec").toString("base64")}`);
  assert.match(calls[0].opts.body, /grant_type=refresh_token&refresh_token=rt0/);
  assert.deepEqual(saved, [{ refreshToken: "rt1" }]);
  assert.equal(await p.getAccessToken(), "acc1", "önbellek");
  t = 7200e3; assert.equal(await p.getAccessToken(), "acc2"); assert.match(calls[1].opts.body, /refresh_token=rt1/);

  const cfg = x.config({ X_AUTOPOST_ENABLED: "1", ...env });
  assert.equal(cfg.authMode, "oauth2"); assert.equal(cfg.live, true); assert.deepEqual(cfg.missing, []);
  const tw = fakeX(); const db = fakeSupabase();
  await x.runXAutopost({ env: { X_AUTOPOST_ENABLED: "1", ...env }, now: NOW, data: data(), store: createStore({ request: db.request }), fetcher: tw.fetcher, tokens: { getAccessToken: async () => "TOK", invalidate() {} }, log: quiet });
  assert.ok(tw.auth.length === 2 && tw.auth.every((a) => a === "Bearer TOK"));
});

await test("OAuth 2.0: 401 → belirteç yenilenip bir kez yeniden denenir; hata mesajında belirteç yok", async () => {
  let n = 0; const tokens = { getAccessToken: async () => `T${n}`, invalidate() { n += 1; } };
  const tw = fakeX({ failOn: (_b, i) => (i === 1 ? 401 : null) });
  const id = await x.postTweet("deneme", { oauth2: true }, { fetcher: tw.fetcher, tokens });
  assert.ok(id); assert.deepEqual(tw.auth, ["Bearer T0", "Bearer T1"]);
  const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_request" }) });
  await assert.rejects(oauth2.refreshAccessToken({ refreshToken: "SIR", clientId: "c", clientSecret: "s", fetcher: bad }), (e) => !/SIR/.test(e.message) && /x-oauth2-400/.test(e.message));
});

/* ---------------- maçsız gün: gerçek sayfalar + gerçek veri ---------------- */
await test("takım karşılaştırma sayfaları sitede var; tweet yalnızca puan tablosundan", () => {
  for (const [a, b] of compose.TEAM_COMPARISON_PAGES) assert.ok(fs.existsSync(`karsilastirma/takimlar/${a}-vs-${b}.html`), `${a}-vs-${b}`);
  for (const f of ["gol-kralligi.html", "asist-kralligi.html", "takim-karsilastirmalari.html"]) assert.ok(fs.existsSync(f), f);
  const standings = JSON.parse(fs.readFileSync("data/league-standings.json", "utf8"));
  const c = compose.composeTeamComparison(standings, 0);
  assert.ok(c && compose.weightedLength(c.text) <= 280);
  const gs = standings["super-lig"].table.find((r) => r.team === "Galatasaray");
  assert.ok(c.text.includes(`Galatasaray: ${gs.rank}. sıra, ${gs.points} puan (${gs.won}G ${gs.drawn}B ${gs.lost}M), gol ${gs.goalsFor}-${gs.goalsAgainst}`));
  assert.equal(compose.composeTeamComparison(null, 0), null, "veri yoksa tweet yok");
});

await test("maçsız gün 19:xx dolgusu (gerçek depo verisi) istatistik sayfasına bağlanır", () => {
  const disk = x.loadFromDisk();
  const c = x.buildCandidates({ ...disk, calendar: { matches: [] } }, { now: new Date("2026-11-05T19:05:00+03:00") });
  assert.ok(c.fillers.length >= 2);
  assert.ok(c.fillers.every((f) => /futbolradar\.com\/(gol-kralligi\.html|asist-kralligi\.html|karsilastirma\/takimlar\/|super-lig-transferleri)/.test(f.text)));
});

/* ---------------- maç günü: gol + maç sonu ---------------- */
await test("gol kapsamı: varsayılan Süper Lig maçlarının tümü; X_GOAL_SCOPE=favorites daraltır", () => {
  const live = { ...finished, id: "kon-kas", league: "Süper Lig", homeTeam: "Konyaspor", awayTeam: "Kasımpaşa", status: "LIVE", providerStatus: "2H", kickoff: "2026-10-20T22:00:00+03:00", score: { home: 1, away: 0 },
    providerIds: { apiFootball: "77" }, events: [{ time: "55'", team: { name: "Konyaspor" }, type: "Goal", detail: "Normal Goal", value: "Oyuncu A · Normal Goal" }] };
  const input = data({ calendar: { matches: [live] }, seoIndex: { "af:77": "konyaspor-kasimpasa" } });
  const all = x.buildCandidates(input, { now: NOW, goalScope: "superlig" });
  assert.equal(all.goals.length, 1); assert.match(all.goals[0].text, /Konyaspor 1-0 Kasımpaşa\nOyuncu A 55'/);
  assert.equal(x.buildCandidates(input, { now: NOW, goalScope: "favorites" }).goals.length, 0);
});

await test("maç sonu (maç merkezi dosyası): skor, golcüler, dakikalar yalnızca dosyadan", () => {
  const hub = JSON.parse(fs.readFileSync("data/match-hubs/galatasaray-stuttgart-2026-11-03.json", "utf8"));
  const m = compose.matchFromHub(hub);
  const t = compose.composeResult(m, null, { url: `${compose.SITE}/${hub.file}` });
  assert.ok(t.text.startsWith(`🏁 MAÇ SONU | Şampiyonlar Ligi\nGalatasaray ${hub.result.home}-${hub.result.away} VfB Stuttgart\n⚽ Aleksey Batrakov 12', 15'`));
  assert.ok(fs.existsSync(hub.file));
  assert.ok(compose.weightedLength(compose.applyLinkMode(t, "reply").text) <= 280);
});

console.log(`\n${passed} test geçti${process.exitCode ? " — HATA VAR" : ""}`);
