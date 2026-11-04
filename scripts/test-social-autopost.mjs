#!/usr/bin/env node
/**
 * Sosyal paylaşım (X haber + Telegram) testleri — ağ YOK (sahte fetch),
 * Supabase YOK (sahte istemci), X/Telegram/API-Football'a gerçek istek YOK.
 *   node scripts/test-social-autopost.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const news = require("../services/socialAutopost/news.js");
const xNews = require("../services/socialAutopost/xNews.js");
const xLive = require("../services/socialAutopost/xLive.js");
const tg = require("../services/socialAutopost/telegram.js");
const { createStore, TABLE: X_TABLE } = require("../services/xAutopost/store.js");
const { weightedLength } = require("../services/xAutopost/compose.js");
const { JOBS } = require("../server/cronRoute.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1; }
}
const quiet = () => {};
const SITE = "https://www.futbolradar.com";

/* ---------------- sahte veri ---------------- */
function article(slug, over = {}) {
  return { id: slug, slug, url: `${SITE}/haber/${slug}`, status: "verified", includeInTicker: true, title: `Başlık ${slug}`, summary: "Kısa özet <b>&</b>.", team: "Fenerbahçe", category: "Şampiyonlar Ligi", tags: ["Fenerbahçe", "Süper Lig", "İsmail Kartal"], publishedAt: "2026-10-28T15:00:00+03:00", ...over };
}
const NOW = new Date("2026-10-28T18:00:00+03:00");
const NEWS = [
  article("a-haber", { publishedAt: "2026-10-28T10:00:00+03:00" }),
  article("b-haber", { publishedAt: "2026-10-28T12:00:00+03:00", team: "Galatasaray", category: "Süper Lig", tags: ["Galatasaray"] }),
  article("c-haber", { publishedAt: "2026-10-28T14:00:00+03:00" }),
  article("eski", { publishedAt: "2026-10-20T10:00:00+03:00" }),
  article("gelecek", { publishedAt: "2026-10-29T10:00:00+03:00" }),
  article("dogrulanmamis", { status: "draft" }),
  article("iddia", { ticker: { confidence: "reported" } }),
  article("dis-link", { url: "https://example.com/x" })
];

/* ---------------- sahte Supabase (tablo parametreli) ---------------- */
function fakeSupabase(table) {
  const rows = new Map();
  async function request(pathname, options = {}) {
    const method = options.method || "GET";
    const [t, query = ""] = pathname.split("?");
    assert.equal(t, table);
    const body = options.body ? JSON.parse(options.body) : null;
    const eq = (col) => { const m = query.match(new RegExp(`${col}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
    if (method === "POST") { const r = body[0]; if (rows.has(r.post_key)) return []; const full = { ...r, created_at: new Date().toISOString() }; rows.set(r.post_key, full); return [full]; }
    if (method === "PATCH") { const k = eq("post_key"); rows.set(k, { ...rows.get(k), ...body }); return []; }
    if (method === "DELETE") { const k = eq("post_key"); if (rows.get(k)?.status === "pending") rows.delete(k); return []; }
    if (/post_key=in\./.test(query)) { const list = decodeURIComponent(query.match(/in\.\(([^)]*)\)/)[1]).split(",").map((s) => s.replace(/"/g, "")); return [...rows.values()].filter((r) => list.includes(r.post_key)); }
    if (/post_key=like\./.test(query)) { const pre = decodeURIComponent(query.match(/like\.([^&]+)/)[1]).replace(/\*$/, ""); return [...rows.values()].filter((r) => ["posted", "pending"].includes(r.status) && r.post_key.startsWith(pre)); }
    if (/status=in\./.test(query)) {
      const kind = eq("kind"); const since = decodeURIComponent((query.match(/created_at=gte\.([^&]+)/) || [])[1] || "");
      return [...rows.values()].filter((r) => ["posted", "pending"].includes(r.status) && (!kind || r.kind === kind) && (!since || r.created_at >= since));
    }
    return [];
  }
  return { rows, request };
}
function fakeX() {
  const sent = [];
  const fetcher = async (url, init) => {
    assert.equal(url, "https://api.x.com/2/tweets");
    assert.match(init.headers.Authorization, /^OAuth oauth_consumer_key="ck"/);
    sent.push(JSON.parse(init.body).text);
    return { ok: true, status: 201, json: async () => ({ data: { id: String(500 + sent.length) } }) };
  };
  return { sent, fetcher };
}
function fakeTelegram({ ok = true, status = 200 } = {}) {
  const sent = [];
  const fetcher = async (url, init) => {
    assert.equal(url, "https://api.telegram.org/botTEST:TOKEN/sendMessage");
    const b = JSON.parse(init.body); sent.push(b);
    assert.equal(b.parse_mode, "HTML"); assert.equal(b.chat_id, "@futbolradar_test");
    return { ok, status, json: async () => (ok ? { ok: true, result: { message_id: 70 + sent.length } } : { ok: false, error_code: status, description: "Bad Request: chat not found" }) };
  };
  return { sent, fetcher };
}
const X_ENV = { X_NEWS_ENABLED: "1", X_API_KEY: "ck", X_API_SECRET: "cs", X_ACCESS_TOKEN: "at", X_ACCESS_TOKEN_SECRET: "ats" };
const TG_ENV = { TELEGRAM_ENABLED: "1", TELEGRAM_BOT_TOKEN: "TEST:TOKEN", TELEGRAM_CHAT_ID: "@futbolradar_test" };

/* ---------------- hashtag ---------------- */
await test("hashtag: takım + turnuva, yalnızca verideki alanlardan, en fazla 3", () => {
  const vocab = news.vocabularyOf(NEWS);
  assert.deepEqual(news.hashtagsFor(NEWS[0], 3, vocab), ["#Fenerbahçe", "#ŞampiyonlarLigi", "#SüperLig"]);
  assert.ok(!news.hashtagsFor(NEWS[0], 3, vocab).includes("#İsmailKartal"), "kişi adı sözlükte yok → etiket olmaz");
});
await test("hashtag: genel kategori etiket olmaz, tekrar yok, uydurma yok", () => {
  assert.deepEqual(news.hashtagsFor({ team: "Beşiktaş", category: "Transfer Gündemi", tags: ["Beşiktaş"] }), ["#Beşiktaş"]);
  assert.deepEqual(news.hashtagsFor({}), []);
  assert.equal(news.toHashtag("Türkiye Milli Takımı"), "#TürkiyeMilliTakımı");
  assert.equal(news.toHashtag("2026"), null);
});

/* ---------------- aday + biçim ---------------- */
await test("adaylar: doğrulanmış, kesin, kendi /haber/ adresli, son 24 saat; eskiden yeniye", () => {
  const c = news.newsCandidates(NEWS, { now: NOW });
  assert.deepEqual(c.map((x) => x.key), ["news:a-haber", "news:b-haber", "news:c-haber"]);
});
await test("tweet biçimi: başlık + site bağlantısı + etiketler, ≤280", () => {
  const [c] = news.newsCandidates(NEWS, { now: NOW });
  assert.equal(news.composeNewsTweet(c), `Başlık a-haber\n\n${SITE}/haber/a-haber\n\n#Fenerbahçe #ŞampiyonlarLigi #SüperLig`);
  const long = news.newsCandidates([article("uzun", { title: "Çok uzun başlık ".repeat(40) })], { now: NOW })[0];
  const t = news.composeNewsTweet(long);
  assert.ok(weightedLength(t) <= 280); assert.ok(t.includes(`${SITE}/haber/uzun`)); assert.ok(t.endsWith("#Fenerbahçe #ŞampiyonlarLigi"));
});
await test("Telegram biçimi: HTML kaçışı, kalın başlık, bağlantı", () => {
  const [c] = news.newsCandidates(NEWS, { now: NOW });
  const html = news.composeNewsTelegram(c);
  assert.ok(html.startsWith("📰 <b>Başlık a-haber</b>"));
  assert.ok(html.includes("Kısa özet &lt;b&gt;&amp;&lt;/b&gt;."));
  assert.ok(html.includes(`<a href="${SITE}/haber/a-haber">`));
});

/* ---------------- X: kuru koşu, dedup, tavan, aralık ---------------- */
await test("X kuru koşu: bayrak/anahtar yoksa hiçbir şey gönderilmez", async () => {
  const tw = fakeX();
  const r = await xNews.runXNews({ env: {}, now: NOW, data: { news: NEWS }, fetcher: tw.fetcher, log: quiet });
  assert.equal(r.mode, "dry-run"); assert.equal(tw.sent.length, 0); assert.equal(r.dryRun.length, 3);
  const r2 = await xNews.runXNews({ env: { ...X_ENV, X_API_SECRET: "" }, now: NOW, data: { news: NEWS }, store: createStore({ request: fakeSupabase(X_TABLE).request }), fetcher: tw.fetcher, log: quiet });
  assert.equal(r2.mode, "dry-run"); assert.match(r2.reason, /X_API_SECRET/); assert.equal(tw.sent.length, 0);
});
await test("X: koşu başına 1 tweet, en yeni önce; aynı haber ikinci kez yok", async () => {
  const db = fakeSupabase(X_TABLE); const store = createStore({ request: db.request }); const tw = fakeX();
  const r = await xNews.runXNews({ env: X_ENV, now: NOW, data: { news: NEWS }, store, fetcher: tw.fetcher, log: quiet });
  assert.deepEqual(r.posted.map((p) => p.key), ["news:c-haber"]);
  assert.equal(db.rows.get("news:c-haber").kind, "news"); assert.equal(db.rows.get("news:c-haber").tweet_id, "501");
  // Aralık dolmadan ikinci koşu: min-gap
  const r2 = await xNews.runXNews({ env: X_ENV, now: NOW, data: { news: NEWS }, store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r2.posted.length, 0); assert.equal(r2.skipped[0].reason, "min-gap");
  // Aralık kapalıyken bile aynı haber tekrar paylaşılmaz
  const r3 = await xNews.runXNews({ env: { ...X_ENV, X_NEWS_MIN_GAP_MINUTES: "30" }, now: NOW, data: { news: [NEWS[2]] }, store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r3.posted.length, 0); assert.equal(tw.sent.length, 1);
});
await test("X: günlük tavan (son 24 saat) ve sessiz saatler", () => {
  const cfg = xNews.config({ X_NEWS_MAX_PER_DAY: "9" });
  assert.equal(cfg.maxPerDay, 5, "tavan en fazla 5'e kırpılır");
  assert.equal(xNews.gate({ postedLast24h: 5, postedInGap: 0, hour: 14, cfg }), "day-cap");
  assert.equal(xNews.gate({ postedLast24h: 4, postedInGap: 0, hour: 14, cfg }), null);
  assert.equal(xNews.gate({ postedLast24h: 0, postedInGap: 1, hour: 14, cfg }), "min-gap");
  assert.equal(xNews.gate({ postedLast24h: 0, postedInGap: 0, hour: 3, cfg }), "quiet-hours");
  assert.equal(xNews.config({}).maxPerDay, 4);
});
await test("X: tavan dolunca koşu tweet atmaz", async () => {
  const db = fakeSupabase(X_TABLE); const store = createStore({ request: db.request }); const tw = fakeX();
  for (let i = 0; i < 4; i += 1) await store.claim({ key: `news:eski-${i}`, kind: "news", text: "x" });
  const r = await xNews.runXNews({ env: X_ENV, now: NOW, data: { news: NEWS }, store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r.skipped[0].reason, "day-cap"); assert.equal(tw.sent.length, 0);
});

/* ---------------- Telegram ---------------- */
await test("Telegram kuru koşu: token yoksa hiçbir şey gönderilmez", async () => {
  const t = fakeTelegram();
  const r = await tg.runTelegramNotify({ env: { TELEGRAM_ENABLED: "1" }, now: NOW, data: { news: NEWS }, fetcher: t.fetcher, log: quiet });
  assert.equal(r.mode, "dry-run"); assert.match(r.reason, /TELEGRAM_BOT_TOKEN/); assert.equal(t.sent.length, 0);
});
await test("Telegram: sendMessage, koşu tavanı, dedup", async () => {
  const db = fakeSupabase(tg.TABLE); const store = createStore({ request: db.request, table: tg.TABLE, idColumn: "message_id" }); const t = fakeTelegram();
  const env = { ...TG_ENV, TELEGRAM_MAX_PER_RUN: "2" };
  const r = await tg.runTelegramNotify({ env, now: NOW, data: { news: NEWS }, store, fetcher: t.fetcher, log: quiet });
  assert.deepEqual(r.posted.map((p) => p.key), ["news:a-haber", "news:b-haber"]);
  assert.ok(r.skipped.some((s) => s.reason === "run-cap"));
  assert.equal(db.rows.get("news:a-haber").message_id, "71");
  const r2 = await tg.runTelegramNotify({ env, now: NOW, data: { news: NEWS }, store, fetcher: t.fetcher, log: quiet });
  assert.deepEqual(r2.posted.map((p) => p.key), ["news:c-haber"]);
  const r3 = await tg.runTelegramNotify({ env, now: NOW, data: { news: NEWS }, store, fetcher: t.fetcher, log: quiet });
  assert.equal(r3.posted.length, 0); assert.equal(t.sent.length, 3);
});
await test("Telegram: 24 saat tavanı ve kalıcı hata (400) tekrar denenmez", async () => {
  const db = fakeSupabase(tg.TABLE); const store = createStore({ request: db.request, table: tg.TABLE, idColumn: "message_id" });
  const r = await tg.runTelegramNotify({ env: { ...TG_ENV, TELEGRAM_MAX_PER_DAY: "1" }, now: NOW, data: { news: NEWS }, store, fetcher: fakeTelegram().fetcher, log: quiet });
  assert.equal(r.posted.length, 1); assert.ok(r.skipped.some((s) => s.reason === "day-cap"));
  const db2 = fakeSupabase(tg.TABLE); const store2 = createStore({ request: db2.request, table: tg.TABLE, idColumn: "message_id" });
  const bad = fakeTelegram({ ok: false, status: 400 });
  const r2 = await tg.runTelegramNotify({ env: TG_ENV, now: NOW, data: { news: [NEWS[0]] }, store: store2, fetcher: bad.fetcher, log: quiet });
  assert.match(r2.skipped[0].reason, /telegram-http-400/); assert.ok(!/TEST:TOKEN/.test(r2.skipped[0].reason), "token hata metninde yok");
  assert.equal(db2.rows.get("news:a-haber").status, "failed");
});
await test("Telegram: biten maç sonucu (X otomatik paylaşımıyla aynı aday) mesaja dönüşür", () => {
  const calendar = { matches: [{ id: "m", providerIds: { apiFootball: "77" }, league: "Süper Lig", kickoff: "2026-10-28T15:00:00+03:00", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", status: "FINISHED", providerStatus: "FT", score: { home: 1, away: 0 }, statistics: [] }] };
  const msgs = tg.buildMessages({ news: [], calendar, seoIndex: { "af:77": "galatasaray-fenerbahce-28-ekim-2026" } }, { now: NOW, cfg: tg.config({}) });
  assert.equal(msgs.length, 1); assert.equal(msgs[0].key, "result:af:77");
  assert.ok(msgs[0].text.includes(`<a href="${SITE}/mac/galatasaray-fenerbahce-28-ekim-2026">`));
});


/* ---------------- X canlı maç ---------------- */
const LIVE_SLUG = "galatasaray-fenerbahce-1-kasim-2026";
const LIVE_NOW = new Date("2026-11-01T20:40:00+03:00");
function liveMatch(over = {}) {
  return {
    id: "gs-fb", providerIds: { apiFootball: "900" }, league: "Süper Lig", kickoff: "2026-11-01T20:00:00+03:00",
    homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", status: "LIVE", providerStatus: "1H", minute: 38, score: { home: 1, away: 0 },
    events: [
      { providerEventId: 1, time: "12'", team: { name: "Galatasaray" }, type: "Goal", detail: "Normal Goal", value: "Mauro Icardi · Normal Goal" },
      { providerEventId: 2, time: "20'", team: { name: "Fenerbahçe" }, type: "Card", detail: "Yellow Card", value: "X" },
      { providerEventId: 3, time: "30'", team: { name: "Fenerbahçe" }, type: "Card", detail: "Red Card", value: "Oyuncu B" },
      { providerEventId: 4, time: "35'", team: { name: "Galatasaray" }, type: "Goal", detail: "Missed Penalty", value: "Oyuncu C · Missed Penalty" }
    ],
    ...over
  };
}
const liveData = (m = liveMatch()) => ({ calendar: { matches: [m, { ...liveMatch({ id: "x", providerIds: { apiFootball: "901" }, homeTeam: "Ajax", awayTeam: "PSV", league: "Eredivisie" }) }] }, seoIndex: { "af:900": LIVE_SLUG, "af:901": "ajax-psv" } });
const LIVE_ENV = { ...X_ENV, X_NEWS_ENABLED: "0", X_LIVE_ENABLED: "1" };

await test("canlı: gol, kırmızı kart, kaçan penaltı; sarı kart yok; kapsam dışı maç yok; bağlantı maç sayfası", () => {
  const { candidates, liveMatches } = xLive.buildLiveCandidates(liveData(), { now: LIVE_NOW, favorites: ["Galatasaray", "Fenerbahçe"] });
  assert.equal(liveMatches.length, 1);
  assert.deepEqual(candidates.map((c) => c.type), ["goal", "red_card", "penalty_missed"]);
  assert.equal(candidates[0].key, "goal:gs-fb:provider:1", "gol anahtarı x-autopost ile aynı");
  assert.equal(candidates[1].key, "live:gs-fb:provider:3");
  for (const c of candidates) assert.ok(c.text.endsWith(`${SITE}/mac/${LIVE_SLUG}`));
  assert.ok(candidates[0].text.includes("Mauro Icardi 12'"));
  assert.ok(candidates[2].text.includes("Galatasaray 1-0 Fenerbahçe"), "skor yalnızca son olayda");
});
await test("canlı: devre arası tweeti; bitmiş maç canlı tweet üretmez", () => {
  const ht = xLive.buildLiveCandidates(liveData(liveMatch({ providerStatus: "HT", events: [] })), { now: LIVE_NOW, favorites: ["Galatasaray"] });
  assert.deepEqual(ht.candidates.map((c) => c.key), ["live:gs-fb:ht"]);
  const ft = xLive.buildLiveCandidates(liveData(liveMatch({ status: "FINISHED", providerStatus: "FT" })), { now: LIVE_NOW, favorites: ["Galatasaray"] });
  assert.equal(ft.candidates.length, 0);
});
await test("canlı: korner/pozisyon yalnızca iki kümülatif ölçüm farkından", () => {
  const { liveMatches } = xLive.buildLiveCandidates(liveData(), { now: LIVE_NOW, favorites: ["Galatasaray"] });
  const s = (minute, corner, sot) => ({ minute, statistics: [{ type: "Korner", home: corner[0], away: corner[1] }, { type: "İsabetli şut", home: sot[0], away: sot[1] }] });
  const out = xLive.statCandidates(liveMatches[0], [s(30, [2, 1], [3, 1]), s(34, [3, 1], [3, 2])]);
  assert.deepEqual(out.map((c) => c.key), ["live:gs-fb:corner:34:home", "live:gs-fb:chance:34:away"]);
  assert.ok(out[0].text.includes("Korner: 3-1")); assert.ok(out[0].text.includes("(30'-34')"));
  assert.equal(xLive.statCandidates(liveMatches[0], [s(34, [3, 1], [3, 2])]).length, 0, "tek ölçümle tweet yok");
});
await test("canlı kuru koşu: X_LIVE_ENABLED yoksa hiçbir şey gönderilmez", async () => {
  const tw = fakeX();
  const r = await xLive.runXLive({ env: X_ENV, now: LIVE_NOW, data: liveData(), fetcher: tw.fetcher, log: quiet });
  assert.equal(r.mode, "dry-run"); assert.equal(tw.sent.length, 0); assert.equal(r.dryRun.length, 3);
});
await test("canlı: olay başına tek tweet, maç başına tavan, x-autopost golüyle çift yok", async () => {
  const db = fakeSupabase(X_TABLE); const store = createStore({ request: db.request }); const tw = fakeX();
  await store.claim({ key: "goal:gs-fb:provider:1", kind: "goal", text: "x-autopost atmıştı" });
  const env = { ...LIVE_ENV, X_LIVE_MAX_PER_MATCH: "2" };
  const r = await xLive.runXLive({ env, now: LIVE_NOW, data: liveData(), store, fetcher: tw.fetcher, log: quiet });
  assert.deepEqual(r.posted.map((p) => p.key), ["live:gs-fb:provider:3"], "gol zaten atılmış; tavan 2 (gol + kart)");
  assert.ok(r.skipped.some((s) => s.reason === "match-cap"));
  assert.equal(db.rows.get("live:gs-fb:provider:3").kind, "live");
  const r2 = await xLive.runXLive({ env: { ...LIVE_ENV, X_LIVE_MAX_PER_MATCH: "10" }, now: LIVE_NOW, data: liveData(), store, fetcher: tw.fetcher, log: quiet });
  assert.deepEqual(r2.posted.map((p) => p.key), ["live:gs-fb:provider:4"]);
  const r3 = await xLive.runXLive({ env: { ...LIVE_ENV, X_LIVE_MAX_PER_MATCH: "10" }, now: LIVE_NOW, data: liveData(), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r3.posted.length, 0); assert.equal(tw.sent.length, 2);
});
await test("canlı: koşu ve günlük tavan", async () => {
  const db = fakeSupabase(X_TABLE); const store = createStore({ request: db.request }); const tw = fakeX();
  const r = await xLive.runXLive({ env: { ...LIVE_ENV, X_LIVE_MAX_PER_RUN: "1" }, now: LIVE_NOW, data: liveData(), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r.posted.length, 1); assert.ok(r.skipped.some((s) => s.reason === "run-cap"));
  const r2 = await xLive.runXLive({ env: { ...LIVE_ENV, X_LIVE_MAX_PER_DAY: "1" }, now: LIVE_NOW, data: liveData(), store, fetcher: tw.fetcher, log: quiet });
  assert.equal(r2.posted.length, 0); assert.ok(r2.skipped.some((s) => s.reason === "day-cap"));
});
await test("cron: x-autopost canlı işi aynı veriyle koşturur; x-live elle çağrılabilir", () => {
  assert.ok(JOBS.has("x-live"));
});

/* ---------------- geriye dönük uyumluluk ---------------- */
await test("store: varsayılan tablo/sütun X için değişmedi", async () => {
  const db = fakeSupabase(X_TABLE); const store = createStore({ request: db.request });
  await store.claim({ key: "k", kind: "result", text: "t" }); await store.finish({ key: "k", status: "posted", tweetId: "9" });
  assert.equal(db.rows.get("k").tweet_id, "9");
});
await test("cron: x-news ve telegram-notify işleri tanımlı", () => {
  assert.ok(JOBS.has("x-news")); assert.ok(JOBS.has("telegram-notify")); assert.ok(JOBS.has("x-autopost"));
});

console.log(`\n${passed} test geçti${process.exitCode ? " — HATA VAR" : ""}`);
