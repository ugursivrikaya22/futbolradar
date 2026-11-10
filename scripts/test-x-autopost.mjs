#!/usr/bin/env node
/**
 * X otomatik paylaşım testleri — ağ YOK (sahte fetch), Supabase YOK (sahte
 * istemci), X'e ve API-Football'a gerçek istek YOK.
 *   node scripts/test-x-autopost.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const oauth = require("../services/xAutopost/oauth1.js");
const compose = require("../services/xAutopost/compose.js");
const x = require("../services/xAutopost/index.js");
const { TABLE, createStore } = require("../services/xAutopost/store.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1; }
}

/* ---------------- sahte veri ---------------- */
const SLUG = "fenerbahce-slavia-praha-20-ekim-2026";
const stats = (o) => Object.entries(o).map(([type, [home, away]]) => ({ type, home, away }));
function match(over = {}) {
  return {
    id: "fb-sp", providerIds: { apiFootball: "1635661" }, league: "Şampiyonlar Ligi",
    kickoff: "2026-10-20T19:45:00+03:00", homeTeam: "Fenerbahçe", awayTeam: "Slavia Praha",
    status: "FINISHED", providerStatus: "FT", score: { home: 2, away: 2 },
    statistics: stats({ "Gol beklentisi (xG)": [1.12, 1.54], "İsabetli şut": [4, 4], "Topla oynama": [49, 51] }),
    events: [
      { time: "4'", team: { name: "Fenerbahçe" }, type: "Goal", detail: "Normal Goal", value: "Oğuz Aydın · Asist: Milan Škriniar · Normal Goal" },
      { time: "11'", team: { name: "Fenerbahçe" }, type: "Goal", detail: "Normal Goal", value: "Mason Greenwood · Normal Goal" },
      { time: "30'", team: { name: "Fenerbahçe" }, type: "Card", detail: "Yellow Card", value: "X" }
    ],
    ...over
  };
}
const seoIndex = { "af:1635661": SLUG, "af:1": "trabzonspor-besiktas-19-ekim-2026" };
const column = { slug: "deneme-yazi", title: "Deneme Başlık", spot: "Kısa spot cümlesi.", status: "published", date: "2026-10-20T21:00:00+03:00" };
const leaders = { topScorers: [{ providerId: "306", name: "Mohamed Salah", team: "Trabzonspor", goals: 8 }], topAssists: [{ providerId: "9", name: "A. Kyziridis", team: "Çorum FK", assists: 4 }] };
const data = (over = {}) => ({ calendar: { matches: [match()] }, seoIndex, columns: { columns: [column] }, transfers: [], leaders, ...over });

/* ---------------- sahte Supabase ---------------- */
function fakeSupabase() {
  const rows = new Map();
  const calls = [];
  async function request(pathname, options = {}) {
    const method = options.method || "GET";
    calls.push(`${method} ${pathname}`);
    const [table, query = ""] = pathname.split("?");
    assert.equal(table, TABLE);
    const body = options.body ? JSON.parse(options.body) : null;
    const eq = (col) => { const m = query.match(new RegExp(`${col}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
    if (method === "POST") { const r = body[0]; if (rows.has(r.post_key)) return []; const full = { ...r, created_at: new Date().toISOString() }; rows.set(r.post_key, full); return [full]; }
    if (method === "PATCH") { const k = eq("post_key"); rows.set(k, { ...rows.get(k), ...body }); return []; }
    if (method === "DELETE") { const k = eq("post_key"); if (rows.get(k)?.status === "pending") rows.delete(k); return []; }
    if (/post_key=in\./.test(query)) { const list = decodeURIComponent(query.match(/in\.\(([^)]*)\)/)[1]).split(",").map((s) => s.replace(/"/g, "")); return [...rows.values()].filter((r) => list.includes(r.post_key)); }
    if (/status=in\./.test(query)) { const kind = eq("kind"); return [...rows.values()].filter((r) => ["posted", "pending"].includes(r.status) && (!kind || r.kind === kind)); }
    return [];
  }
  return { rows, calls, request };
}
function fakeX({ status = 201 } = {}) {
  const sent = []; const bodies = [];
  const fetcher = async (url, init) => {
    assert.equal(url, "https://api.x.com/2/tweets");
    assert.match(init.headers.Authorization, /^OAuth oauth_consumer_key="ck", oauth_nonce="[0-9a-f]{32}", oauth_signature="[^"]+", oauth_signature_method="HMAC-SHA1", oauth_timestamp="\d+", oauth_token="at", oauth_version="1\.0"$/);
    bodies.push(JSON.parse(init.body)); sent.push(JSON.parse(init.body).text);
    return { ok: status < 300, status, json: async () => (status < 300 ? { data: { id: String(1000 + sent.length), text: "" } } : { title: "err", detail: "nope" }) };
  };
  return { sent, bodies, fetcher };
}
const LIVE_ENV = { X_AUTOPOST_ENABLED: "1", X_API_KEY: "ck", X_API_SECRET: "cs", X_ACCESS_TOKEN: "at", X_ACCESS_TOKEN_SECRET: "ats" };
const NOW = new Date("2026-10-20T22:30:00+03:00");
const quiet = () => {};

/* ---------------- OAuth 1.0a ---------------- */
await test("OAuth: X dokümanındaki örnek vektör (statuses/update) → hCtSmYh+iHYCEqBWrE7C7hYmtUk=", () => {
  // https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature
  const { signature, baseString } = oauth.signature({
    method: "POST",
    url: "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
    extraParams: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
    oauthParams: {
      oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
      oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: "1318622958",
      oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      oauth_version: "1.0"
    },
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE"
  });
  assert.ok(baseString.startsWith("POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key"));
  assert.equal(signature, "hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
});

await test("OAuth: RFC 3986 kodlaması (!'()* ve Türkçe karakter)", () => {
  assert.equal(oauth.percentEncode("Ladies + Gentlemen!"), "Ladies%20%2B%20Gentlemen%21");
  assert.equal(oauth.percentEncode("ç(ş)*'"), "%C3%A7%28%C5%9F%29%2A%27");
});

/* ---------------- kompozisyon & uzunluk ---------------- */
await test("uzunluk: bağlantı 23, Türkçe harf 1, emoji 2 sayılır", () => {
  assert.equal(compose.weightedLength("https://www.futbolradar.com/mac/cok-uzun-bir-adres-cok-uzun-bir-adres"), 23);
  assert.equal(compose.weightedLength("çğıöşü"), 6);
  assert.equal(compose.weightedLength("⚽"), 2);
  assert.equal(compose.weightedLength("✍️"), 2);
});

await test("maç sonu: sonuç + tek cümle analiz + kanonik /mac/ bağlantısı", () => {
  const t = compose.composeResult(match(), SLUG);
  assert.equal(t.key, "result:af:1635661");
  assert.equal(t.text, "🏁 MAÇ SONU | Şampiyonlar Ligi\nFenerbahçe 2-2 Slavia Praha\n⚽ Oğuz Aydın 4' · Mason Greenwood 11'\n\nİsabetli şutta 4-4 biten dengeli maçta puanlar paylaşıldı.\n\nhttps://www.futbolradar.com/mac/fenerbahce-slavia-praha-20-ekim-2026");
  assert.equal(compose.composeResult(match(), null), null, "sayfası olmayan maç paylaşılmaz");
});

await test("analiz cümlesi yalnızca gerçek veriden (kurallar)", () => {
  const s = (o) => compose.analysisSentence(match(o));
  assert.equal(s({ score: { home: 1, away: 2 }, statistics: stats({ "Gol beklentisi (xG)": [1.5, 0.94] }) }), "Slavia Praha, xG'de 0,94-1,50 geride kalmasına rağmen 3 puanı aldı.");
  assert.equal(s({ score: { home: 2, away: 0 }, statistics: stats({ "Topla oynama": [38, 62] }) }), "Fenerbahçe, topla oynamada %38 ile geride kalmasına rağmen kazanmayı bildi.");
  assert.equal(s({ score: { home: 2, away: 1 }, statistics: stats({ "İsabetli şut": [6, 4] }) }), "Fenerbahçe, isabetli şutta 6-4 üstünlük kurarak kazandı.");
  assert.equal(s({ score: { home: 2, away: 1 }, statistics: [] }), "Maçın son golünü 11. dakikada Mason Greenwood kaydetti.");
  assert.equal(s({ score: { home: 0, away: 0 }, statistics: [], events: [] }), "Gol sesinin çıkmadığı maçta puanlar paylaşıldı.");
  assert.equal(s({ score: null }), null);
});

await test("köşe yazısı: başlık + spot + /kose-yazilari/<slug>; uzun metin 280'e kısaltılır", () => {
  const t = compose.composeColumn(column);
  assert.equal(t.text, "✍️ Köşe Yazısı: Deneme Başlık\n\nKısa spot cümlesi.\n\nhttps://www.futbolradar.com/kose-yazilari/deneme-yazi");
  const long = compose.composeColumn({ ...column, spot: "çok uzun cümle ".repeat(60) });
  assert.ok(compose.weightedLength(long.text) <= 280);
  assert.match(long.text, /…\n\nhttps:\/\/www\.futbolradar\.com\/kose-yazilari\/deneme-yazi$/);
});

await test("gol: web push çekirdeğiyle aynı olay kimliği; skor yalnızca son golde", () => {
  const live = match({ status: "LIVE", providerStatus: "1H", score: { home: 2, away: 0 } });
  const goals = compose.goalEvents(live);
  assert.equal(goals.length, 2, "kart gol sayılmaz");
  const core = require("../match-notifications-core.js").events(live).filter((e) => e.type === "goal");
  assert.deepEqual(goals.map((g) => g.id), core.map((e) => e.id));
  const first = compose.composeGoal(live, goals[0], SLUG, { isLatest: false });
  const last = compose.composeGoal(live, goals[1], SLUG, { isLatest: true });
  assert.equal(first.text, "⚽ GOL! Fenerbahçe\nFenerbahçe - Slavia Praha\nOğuz Aydın 4'\n\nhttps://www.futbolradar.com/mac/fenerbahce-slavia-praha-20-ekim-2026");
  assert.equal(last.text, "⚽ GOL! Fenerbahçe\nFenerbahçe 2-0 Slavia Praha\nMason Greenwood 11'\n\nhttps://www.futbolradar.com/mac/fenerbahce-slavia-praha-20-ekim-2026");
});

await test("adaylar: favori takım canlı maçında gol; biten maçta sonuç; kapsam dışı maç yok", () => {
  const liveNow = new Date("2026-10-20T20:10:00+03:00");
  const c1 = x.buildCandidates(data({ calendar: { matches: [match({ status: "LIVE", providerStatus: "1H" })] } }), { now: liveNow });
  assert.equal(c1.goals.length, 2); assert.equal(c1.results.length, 0);
  const c2 = x.buildCandidates(data(), { now: NOW });
  assert.equal(c2.goals.length, 0); assert.equal(c2.results.length, 1); assert.equal(c2.columns.length, 1);
  const foreign = match({ homeTeam: "Monza", awayTeam: "Cagliari", league: "Serie A" });
  assert.equal(x.buildCandidates(data({ calendar: { matches: [foreign] } }), { now: NOW }).results.length, 0);
  const notFav = x.buildCandidates(data({ calendar: { matches: [match({ status: "LIVE", providerStatus: "1H" })] } }), { now: liveNow, favorites: ["göztepe"] });
  assert.equal(notFav.goals.length, 0, "favori olmayan takımın golü paylaşılmaz");
  const old = x.buildCandidates(data(), { now: new Date("2026-10-21T12:00:00+03:00") });
  assert.equal(old.results.length, 0, "6 saatten eski sonuç geriye dönük paylaşılmaz");
});

await test("maçsız gün: yalnızca 12:xx ve 19:xx'te dolgu (istatistik/transfer)", () => {
  const empty = data({ calendar: { matches: [] }, columns: { columns: [] } });
  assert.equal(x.buildCandidates(empty, { now: new Date("2026-10-22T10:05:00+03:00") }).fillers.length, 0);
  const noon = x.buildCandidates(empty, { now: new Date("2026-10-22T12:05:00+03:00") });
  assert.equal(noon.fillers[0].text, "🎯 Süper Lig asist krallığı\n1. A. Kyziridis (Çorum FK) – 4 asist\n\nhttps://www.futbolradar.com/asist-kralligi.html");
  assert.equal(noon.fillers[0].slotKey, "slot:2026-10-22:noon");
  const tr = x.buildCandidates({ ...empty, transfers: [{ id: "t1", status: "confirmed", date: "2026-10-21", playerName: "Oyuncu", fromTeam: "A", toTeam: "B", type: "Bonservis" }] }, { now: new Date("2026-10-22T12:05:00+03:00") });
  assert.equal(tr.fillers[0].text, "🔁 Transfer özeti\n• Oyuncu: A → B (Bonservis)\n\nhttps://www.futbolradar.com/super-lig-transferleri-2026-2027.html");
  const matchDay = x.buildCandidates(data({ columns: { columns: [] }, calendar: { matches: [match({ kickoff: "2026-10-22T20:00:00+03:00", status: "NS", providerStatus: "NS" })] } }), { now: new Date("2026-10-22T12:05:00+03:00") });
  assert.equal(matchDay.fillers.length, 0, "maç günü dolgu yok");
});

await test("bağlantılar sitede gerçekten var (dosya ya da vercel.json rewrite)", async () => {
  const fs = await import("node:fs");
  for (const f of ["asist-kralligi.html", "gol-kralligi.html", "super-lig-transferleri-2026-2027.html"]) assert.ok(fs.existsSync(f), f);
  const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  const sources = new Set((vercel.rewrites || []).map((r) => r.source));
  assert.ok(sources.has("/mac/:slug") && sources.has("/kose-yazilari/:slug"), "uzantısız /mac/ ve /kose-yazilari/ rewrite");
  assert.ok((vercel.crons || []).some((c) => c.path === "/api/cron/x-autopost"));
});

/* ---------------- kuru koşu ---------------- */
await test("kuru koşu: bayrak kapalı → X'e ve Supabase'e hiçbir istek yok", async () => {
  const db = fakeSupabase(); const tw = fakeX();
  const r = await x.runXAutopost({ env: { ...LIVE_ENV, X_AUTOPOST_ENABLED: "" }, now: NOW, data: data(), store: createStore({ request: db.request }), fetcher: tw.fetcher, log: quiet });
  assert.equal(r.mode, "dry-run"); assert.match(r.reason, /X_AUTOPOST_ENABLED/);
  assert.equal(r.dryRun.length, 2); assert.equal(tw.sent.length, 0); assert.equal(db.calls.length, 0);
});

await test("kuru koşu: anahtar eksikse adlarını bildirir, değer loglamaz", async () => {
  const logs = []; const tw = fakeX();
  const r = await x.runXAutopost({ env: { X_AUTOPOST_ENABLED: "1", X_API_KEY: "ck" }, now: NOW, data: data(), fetcher: tw.fetcher, log: (s) => logs.push(s) });
  assert.equal(r.mode, "dry-run"); assert.equal(r.reason, "eksik: X_API_SECRET,X_ACCESS_TOKEN,X_ACCESS_TOKEN_SECRET");
  assert.ok(!logs.join("\n").includes("ck\n")); assert.equal(tw.sent.length, 0);
});

await test("X_INCLUDE_LINKS=0: bağlantısız (ucuz) gönderi", async () => {
  const r = await x.runXAutopost({ env: { X_INCLUDE_LINKS: "0" }, now: NOW, data: data(), log: quiet });
  assert.ok(r.dryRun.length && r.dryRun.every((t) => !/https?:/.test(t.text)));
  assert.equal(r.dryRun[0].text, "🏁 MAÇ SONU | Şampiyonlar Ligi\nFenerbahçe 2-2 Slavia Praha\n⚽ Oğuz Aydın 4' · Mason Greenwood 11'\n\nİsabetli şutta 4-4 biten dengeli maçta puanlar paylaşıldı.\n\n🤖 Otomatik");
  assert.equal(r.dryRun[0].reply, null, "bağlantısız modda yanıt da yok");
});

/* ---------------- canlı (sahte X) + tekrar yok ---------------- */
await test("canlı: gönderir, ikinci koşuda aynı maç/yazı tekrar tweetlenmez", async () => {
  const db = fakeSupabase(); const tw = fakeX(); const store = createStore({ request: db.request });
  const r1 = await x.runXAutopost({ env: LIVE_ENV, now: NOW, data: data(), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r1.mode, "live"); assert.deepEqual(r1.posted.map((p) => p.key), ["result:af:1635661", "column:deneme-yazi"]);
  assert.equal(db.rows.get("result:af:1635661").status, "posted"); assert.equal(db.rows.get("result:af:1635661").tweet_id, "1001");
  const r2 = await x.runXAutopost({ env: LIVE_ENV, now: NOW, data: data(), store, fetcher: tw.fetcher, log: quiet });
  // X_LINK_MODE=reply (varsayılan): 2 ana gönderi + 2 bağlantı yanıtı = 4 istek.
  assert.equal(r2.posted.length, 0); assert.equal(tw.sent.length, 4);
});

await test("tavan: koşu başına ve günlük sınır", async () => {
  const many = { columns: Array.from({ length: 6 }, (_, i) => ({ ...column, slug: `y${i}`, title: `Yazı ${i}` })) };
  const db = fakeSupabase(); const tw = fakeX(); const store = createStore({ request: db.request });
  const r = await x.runXAutopost({ env: { ...LIVE_ENV, X_MAX_PER_RUN: "3" }, now: NOW, data: data({ columns: many }), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r.posted.length, 3); assert.ok(r.skipped.every((s) => s.reason === "run-cap"));
  const db2 = fakeSupabase(); const tw2 = fakeX();
  const r2 = await x.runXAutopost({ env: { ...LIVE_ENV, X_MAX_PER_DAY: "2" }, now: NOW, data: data({ columns: many }), store: createStore({ request: db2.request }), fetcher: tw2.fetcher, log: quiet });
  assert.equal(r2.posted.length, 2); assert.ok(r2.skipped.some((s) => s.reason === "day-cap"));
});

await test("maçsız gün dolgusu: aynı slotta ikinci tweet yok", async () => {
  const empty = data({ calendar: { matches: [] }, columns: { columns: [] } });
  const db = fakeSupabase(); const tw = fakeX(); const store = createStore({ request: db.request });
  const at = new Date("2026-10-22T12:05:00+03:00");
  const r1 = await x.runXAutopost({ env: LIVE_ENV, now: at, data: empty, store, fetcher: tw.fetcher, log: quiet });
  const r2 = await x.runXAutopost({ env: LIVE_ENV, now: new Date("2026-10-22T12:20:00+03:00"), data: empty, store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r1.posted.length, 1); assert.equal(r2.posted.length, 0); assert.ok(db.rows.has("slot:2026-10-22:noon"));
  const r3 = await x.runXAutopost({ env: LIVE_ENV, now: new Date("2026-10-22T19:05:00+03:00"), data: empty, store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r3.posted.length, 1, "akşam slotu ayrı; farklı içerik"); assert.notEqual(tw.sent[0], tw.sent[1]);
});

await test("hata: 429 anahtarı bırakır (sonra yeniden dener), 403 kalıcı işaretler", async () => {
  const db = fakeSupabase(); const store = createStore({ request: db.request });
  const r = await x.runXAutopost({ env: LIVE_ENV, now: NOW, data: data(), store, fetcher: fakeX({ status: 429 }).fetcher, log: quiet });
  assert.equal(r.posted.length, 0); assert.equal(db.rows.size, 0, "429 sonrası satır kalmaz");
  const r2 = await x.runXAutopost({ env: LIVE_ENV, now: NOW, data: data(), store, fetcher: fakeX({ status: 403 }).fetcher, log: quiet });
  assert.equal(r2.posted.length, 0); assert.equal(db.rows.get("result:af:1635661").status, "failed");
});

await test("cron ucu: x-autopost işi kayıtlı ve CRON_SECRET olmadan 401", async () => {
  const { handleCron, JOBS } = require("../server/cronRoute.js");
  assert.ok(JOBS.has("x-autopost"));
  let status = 0; const res = { setHeader() {}, end() {}, set statusCode(v) { status = v; } };
  await handleCron({ url: "/api/cron/x-autopost", method: "GET", headers: {} }, res, { env: {}, runners: { "x-autopost": async () => { throw new Error("çağrılmamalı"); } } });
  assert.equal(status, 401);
});

await test("gerçek depo verisiyle tüm adaylar 280 sınırında", () => {
  const disk = x.loadFromDisk();
  for (const at of ["2026-10-19T22:30:00+03:00", "2026-10-20T23:40:00+03:00", "2026-10-22T12:05:00+03:00", "2026-10-22T19:05:00+03:00"]) {
    const c = x.buildCandidates(disk, { now: new Date(at), prematch: x.config({ X_PREMATCH_POLLS_ENABLED: "1", X_PREMATCH_MODE: "both", X_PREMATCH_HOURS: "24" }).prematch });
    for (const t of [...c.goals, ...c.results, ...c.prematch, ...c.columns, ...c.fillers]) assert.ok(compose.weightedLength(t.text) <= 280, `${t.key} ${compose.weightedLength(t.text)}`);
  }
});

/* ---------------- maç öncesi anket / "Senin tahminin ne?" ---------------- */
const UPCOMING = () => match({ id: "gs-fb", providerIds: { apiFootball: "777" }, league: "Süper Lig", kickoff: "2026-11-01T20:00:00+03:00", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", status: "SCHEDULED", providerStatus: "NS", score: null, statistics: [], events: [] });
const PRE_NOW = new Date("2026-11-01T16:30:00+03:00");
const preData = () => data({ calendar: { matches: [UPCOMING()] }, seoIndex: { ...seoIndex, "af:777": "galatasaray-fenerbahce-1-kasim-2026" }, columns: { columns: [] } });
const PRE_ON = { X_PREMATCH_POLLS_ENABLED: "1" };

await test("maç öncesi: bayrak kapalıyken aday yok (varsayılan)", () => {
  const cfg = x.config({});
  assert.equal(cfg.prematch.enabled, false); assert.equal(cfg.prematch.hours, 4); assert.equal(cfg.prematch.mode, "poll");
  assert.equal(x.buildCandidates(preData(), { now: PRE_NOW, prematch: cfg.prematch }).prematch.length, 0);
});

await test("maç öncesi: anket metni, seçenekler, süre başlamada biter, sayı yok", () => {
  const c = x.buildCandidates(preData(), { now: PRE_NOW, prematch: x.config(PRE_ON).prematch });
  assert.equal(c.prematch.length, 1);
  const p = c.prematch[0];
  assert.equal(p.key, "prematch-poll:af:777"); assert.equal(p.kind, "prematch-poll");
  assert.equal(p.text, "📊 MAÇ ÖNCESİ ANKET | Süper Lig\nGalatasaray – Fenerbahçe\n⏰ Bugün 20:00\n\nSenin tahminin ne? Kim kazanır?\n\nhttps://www.futbolradar.com/mac/galatasaray-fenerbahce-1-kasim-2026");
  assert.deepEqual(p.poll, { options: ["Galatasaray", "Beraberlik", "Fenerbahçe"], duration_minutes: 210 });
  assert.ok(!/\d+\s*(oy|kişi|katılımcı)/i.test(p.text), "oy/katılımcı sayısı yazılmaz");
});

await test("maç öncesi: pencere dışı / başlamış / favori dışı maç → yok", () => {
  const pre = x.config(PRE_ON).prematch;
  assert.equal(x.buildCandidates(preData(), { now: new Date("2026-11-01T15:30:00+03:00"), prematch: pre }).prematch.length, 0, "4 saatten erken");
  assert.equal(x.buildCandidates(preData(), { now: new Date("2026-11-01T19:55:00+03:00"), prematch: pre }).prematch.length, 0, "10 dk'dan az");
  const live = preData(); live.calendar.matches[0].providerStatus = "1H";
  assert.equal(x.buildCandidates(live, { now: PRE_NOW, prematch: pre }).prematch.length, 0, "başlamış");
  assert.equal(x.buildCandidates(preData(), { now: PRE_NOW, prematch: pre, favorites: ["Trabzonspor"] }).prematch.length, 0, "favori dışı");
  assert.equal(x.buildCandidates(preData(), { now: new Date("2026-11-01T14:30:00+03:00"), prematch: x.config({ ...PRE_ON, X_PREMATCH_HOURS: "6" }).prematch }).prematch.length, 1, "X_PREMATCH_HOURS=6");
});

await test("maç öncesi: X_PREMATCH_MODE=both → anket + 'Senin tahminin ne?'", () => {
  const c = x.buildCandidates(preData(), { now: PRE_NOW, prematch: x.config({ ...PRE_ON, X_PREMATCH_MODE: "both" }).prematch });
  assert.deepEqual(c.prematch.map((p) => p.key), ["prematch-poll:af:777", "prematch-ask:af:777"]);
  assert.equal(c.prematch[1].text, "🔮 Senin tahminin ne?\nGalatasaray – Fenerbahçe (Süper Lig)\n⏰ Bugün 20:00\n\nSkor tahminini yanıtlara yaz 👇\n\nhttps://www.futbolradar.com/mac/galatasaray-fenerbahce-1-kasim-2026");
  assert.equal(c.prematch[1].poll, undefined);
});

await test("anket seçeneği 25 karakter sınırı ve yarın etiketi", () => {
  assert.equal(compose.pollOption("Brighton & Hove Albion Football Club").length, 25);
  const p = compose.composePrematchPoll(UPCOMING(), "s", { now: new Date("2026-10-31T23:00:00+03:00") });
  assert.match(p.text, /⏰ Yarın 20:00/); assert.equal(p.poll.duration_minutes, 1260);
  assert.equal(compose.composePrematchPoll(UPCOMING(), null), null, "sayfası olmayan maç yok");
});

await test("maç öncesi canlı: poll gövdesi gönderilir, maç başına bir kez, günlük maç öncesi tavanı", async () => {
  const db = fakeSupabase(); const tw = fakeX(); const store = createStore({ request: db.request });
  const env = { ...LIVE_ENV, ...PRE_ON, X_INCLUDE_LINKS: "0" };
  const r1 = await x.runXAutopost({ env, now: PRE_NOW, data: preData(), store, fetcher: tw.fetcher, log: quiet });
  assert.deepEqual(r1.posted.map((p) => p.key), ["prematch-poll:af:777"]);
  assert.deepEqual(tw.bodies[0], { text: "📊 MAÇ ÖNCESİ ANKET | Süper Lig\nGalatasaray – Fenerbahçe\n⏰ Bugün 20:00\n\nSenin tahminin ne? Kim kazanır?\n\n🤖 Otomatik", poll: { options: ["Galatasaray", "Beraberlik", "Fenerbahçe"], duration_minutes: 210 } });
  const r2 = await x.runXAutopost({ env, now: new Date("2026-11-01T17:00:00+03:00"), data: preData(), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r2.posted.length, 0, "aynı maç ikinci kez yok");
  const db2 = fakeSupabase(); const tw2 = fakeX();
  const r3 = await x.runXAutopost({ env: { ...env, X_PREMATCH_MODE: "both", X_PREMATCH_MAX_PER_DAY: "1" }, now: PRE_NOW, data: preData(), store: createStore({ request: db2.request }), fetcher: tw2.fetcher, log: quiet });
  assert.equal(r3.posted.length, 1); assert.ok(r3.skipped.some((s) => s.reason === "prematch-day-cap"));
});

await test("maç öncesi kuru koşu: anahtar yoksa hiçbir şey gönderilmez", async () => {
  const tw = fakeX();
  const r = await x.runXAutopost({ env: PRE_ON, now: PRE_NOW, data: preData(), fetcher: tw.fetcher, log: quiet });
  assert.equal(r.mode, "dry-run"); assert.equal(tw.sent.length, 0); assert.ok(r.dryRun[0].poll);
});

console.log(`\n${passed} test geçti${process.exitCode ? " — HATA VAR" : ""}`);
