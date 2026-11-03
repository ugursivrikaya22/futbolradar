#!/usr/bin/env node
/**
 * MAÇ SONU OTOMATİK ÖZETİ — ağsız testler.
 *   1. Özet üretimi (skor, goller+dakika, kırmızı kart, penaltı, istatistik, yorum)
 *   2. Eksik veri: istatistik yoksa bölüm yok; skorla tutarsız gol listesi basılmaz
 *   3. schema.org SportsEvent JSON-LD (homeTeam, awayTeam, startDate, location, eventStatus, sonuç)
 *   4. Sayfa HTML'i (uydurma yok, noindex kuralı, bağlantılar)
 *   5. X kuyruğu: kuyruğa alınır ama anahtar/bayrak yokken GÖNDERİLMEZ (ağ/DB çağrısı yok)
 *   6. Tetik: saatlik dönüşüm adımı, vercel.json yeniden yazımı, yeni api/ dosyası yok
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../services/matchSummary/index.js");
const queue = require("../services/matchSummary/xQueue.js");
const root = process.cwd();
let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log(`  ✓ ${name}`); }

const base = {
  id: "galatasaray-fenerbahce-2026-10-25", providerIds: { apiFootball: "999001" }, league: "Süper Lig", round: 10,
  kickoff: "2026-10-25T20:00:00+03:00", venue: "RAMS Park", referee: "Ali Şansalan",
  homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", status: "FINISHED", providerStatus: "FT",
  score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 0 },
  events: [
    { time: "12'", team: { name: "Galatasaray" }, type: "Goal", detail: "Normal Goal", value: "V. Osimhen · Normal Goal" },
    { time: "40'", team: { name: "Fenerbahçe" }, type: "Card", detail: "Red Card", value: "M. Skriniar · Red Card" },
    { time: "55'", team: { name: "Fenerbahçe" }, type: "Goal", detail: "Penalty", value: "E. Dzeko · Penalty" },
    { time: "70'", team: { name: "Galatasaray" }, type: "Goal", detail: "Missed Penalty", value: "M. Icardi · Missed Penalty" },
    { time: "90+3'", team: { name: "Galatasaray" }, type: "Goal", detail: "Normal Goal", value: "B. Yılmaz · Asist: L. Sané · Normal Goal" },
    { time: "60'", team: { name: "Galatasaray" }, type: "Card", detail: "Yellow Card", value: "L. Torreira · Yellow Card" }
  ],
  statistics: [
    { type: "Topla oynama", home: 45, away: 55, unit: "%" },
    { type: "Toplam şut", home: 14, away: 9 },
    { type: "İsabetli şut", home: 6, away: 3 },
    { type: "Gol beklentisi (xG)", home: 1.9, away: 0.8 }
  ]
};
const SLUG = "galatasaray-fenerbahce-25-ekim-2026";

console.log("match-summary");

await test("bitmiş maç → tam özet (skor, goller, olaylar, istatistik)", () => {
  const s = core.buildSummary(base, { slug: SLUG });
  assert.equal(s.slug, SLUG);
  assert.deepEqual(s.score, { home: 2, away: 1, halftimeHome: 1, halftimeAway: 0 });
  assert.equal(s.goalsConsistent, true);
  assert.deepEqual(s.events.goals.map((g) => [g.minute, g.player, g.kind, g.side]), [["12", "V. Osimhen", "normal", "home"], ["55", "E. Dzeko", "penalty", "away"], ["90+3", "B. Yılmaz", "normal", "home"]]);
  assert.deepEqual(s.events.redCards.map((r) => [r.minute, r.player, r.team]), [["40", "M. Skriniar", "Fenerbahçe"]]);
  assert.deepEqual(s.events.penalties.map((p) => [p.player, p.outcome]).sort(), [["E. Dzeko", "scored"], ["M. Icardi", "missed"]]);
  assert.deepEqual(Object.keys(s.stats), ["possession", "shots", "shotsOnTarget"]);
  assert.ok(!("xg" in s.stats), "istenmeyen istatistik özete girmez");
  // Galibiyet golü: rakip 1 gol attı → Galatasaray'ın 2. golü (90+3').
  assert.equal(s.comment, "Galatasaray, Fenerbahçe karşısında 2-1 kazandı; galibiyeti getiren gol 90+3. dakikada B. Yılmaz imzasını taşıdı.");
  assert.equal(core.buildSummary(base, { slug: SLUG }).hash, s.hash, "deterministik");
});

await test("bitmemiş / skorsuz / hükmen / slugsuz maç özet üretmez", () => {
  assert.equal(core.buildSummary({ ...base, status: "LIVE", providerStatus: "2H" }, { slug: SLUG }), null);
  assert.equal(core.buildSummary({ ...base, score: { home: null, away: null } }, { slug: SLUG }), null);
  assert.equal(core.buildSummary({ ...base, status: "AWARDED", providerStatus: "AWD" }, { slug: SLUG }), null);
  assert.equal(core.buildSummary(base, { slug: null }), null);
});

await test("eksik istatistik atlanır, yorum yalnızca var olan veriyle kurulur", () => {
  const s = core.buildSummary({ ...base, statistics: [{ type: "Topla oynama", home: null, away: null }], events: [] }, { slug: SLUG });
  assert.deepEqual(s.stats, {});
  assert.equal(s.goalsConsistent, false, "olay yok ama skor 2-1 → gol listesi basılmaz");
  assert.deepEqual(s.events.goals, []);
  assert.equal(s.comment, "Galatasaray, Fenerbahçe karşısında 2-1 kazandı.");
  assert.doesNotMatch(s.comment, /%|şut/);
});

await test("skorla tutarsız gol olayı listesi yayımlanmaz", () => {
  const s = core.buildSummary({ ...base, events: base.events.slice(0, 2) }, { slug: SLUG });
  assert.equal(s.goalsConsistent, false);
  assert.deepEqual(s.events.goals, []);
  assert.equal(s.events.redCards.length, 1, "kırmızı kart yine gösterilir");
});

await test("yorum şablonları: golsüz, beraberlik, deplasman galibiyeti, farklı skor", () => {
  const nil = core.buildSummary({ ...base, score: { home: 0, away: 0 }, events: [] }, { slug: SLUG });
  assert.equal(nil.comment, "Galatasaray ile Fenerbahçe arasındaki maç golsüz sona erdi; isabetli şutlarda tablo 6-3 oldu.");
  const away = core.buildSummary({ ...base, score: { home: 0, away: 1 }, events: [{ time: "33'", team: { name: "Fenerbahçe" }, type: "Goal", detail: "Normal Goal", value: "E. Dzeko · Normal Goal" }] }, { slug: SLUG });
  assert.equal(away.comment, "Fenerbahçe, deplasmanda Galatasaray karşısında 1-0 kazandı; galibiyeti getiren gol 33. dakikada E. Dzeko imzasını taşıdı.");
  const big = core.buildSummary({ ...base, score: { home: 4, away: 0 }, events: [] }, { slug: SLUG });
  assert.equal(big.comment, "Galatasaray, Fenerbahçe karşısında 4-0 biten maçta 4 farklı galibiyet aldı.");
});

await test("schema.org SportsEvent JSON-LD", () => {
  const s = core.buildSummary(base, { slug: SLUG });
  const ld = core.jsonLd(s);
  assert.equal(ld["@context"], "https://schema.org");
  const ev = ld["@graph"].find((n) => n["@type"] === "SportsEvent");
  assert.equal(ev.name, "Galatasaray 2-1 Fenerbahçe");
  assert.equal(ev.startDate, "2026-10-25T20:00:00+03:00");
  assert.deepEqual(ev.homeTeam, { "@type": "SportsTeam", name: "Galatasaray" });
  assert.deepEqual(ev.awayTeam, { "@type": "SportsTeam", name: "Fenerbahçe" });
  assert.deepEqual(ev.location, { "@type": "Place", name: "RAMS Park" });
  assert.equal(ev.eventStatus, "https://schema.org/EventScheduled");
  assert.equal(ev.url, `https://www.futbolradar.com/ozet/${SLUG}`);
  assert.match(ev.description, /Galatasaray 2-1 Fenerbahçe/);
  assert.deepEqual(ev.additionalProperty.map((p) => p.value), [2, 1]);
  const noVenue = core.jsonLd(core.buildSummary({ ...base, venue: null }, { slug: SLUG }))["@graph"][0];
  assert.ok(!("location" in noVenue), "stat bilinmiyorsa location uydurulmaz");
});

await test("sicil: kalıcı, idempotent, takvimden düşen özet silinmez", () => {
  const index = { "af:999001": SLUG };
  const first = core.updateRegistry({}, { matches: [base] }, index, { now: new Date("2026-10-25T22:00:00Z") });
  assert.deepEqual(first.added, [SLUG]);
  const again = core.updateRegistry(first.registry, { matches: [base] }, index, { now: new Date("2026-10-25T23:00:00Z") });
  assert.deepEqual([again.added, again.changed], [[], []]);
  assert.equal(again.registry.summaries[SLUG].updatedAt, "2026-10-25T22:00:00.000Z");
  const dropped = core.updateRegistry(first.registry, { matches: [] }, index);
  assert.ok(dropped.registry.summaries[SLUG], "kalıcı sayfa");
});

await test("sayfa HTML'i: yalnızca saklanan veri, bölüm atlama, bağlantılar", async () => {
  const { pageHtml } = await import("./generate-match-summary-pages.mjs");
  const s = core.buildSummary(base, { slug: SLUG });
  const html = pageHtml(s);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/ozet\/galatasaray-fenerbahce-25-ekim-2026" \/>/);
  assert.match(html, /"@type":"SportsEvent"/);
  for (const needle of ["V. Osimhen", "90+3'", "M. Skriniar", "kırmızı kart", "penaltı kaçırıldı", "Topla oynama", "%45", "İsabetli şut", "RAMS Park", "İlk yarı 1-0", s.comment]) assert.ok(html.includes(needle), `sayfada yok: ${needle}`);
  assert.match(html, /name="robots" content="index/);
  assert.match(html, /<link rel="manifest" href="\/site.webmanifest" \/>/);
  const bare = pageHtml(core.buildSummary({ ...base, statistics: [], events: [] }, { slug: SLUG }));
  assert.ok(!bare.includes('id="istatistikler"') && !bare.includes('id="goller"') && !bare.includes('id="onemli-olaylar"'), "verisi olmayan bölüm yok");
  assert.match(bare, /name="robots" content="noindex/, "yalnızca skorlu sayfa indekslenmez");
});

await test("X kuyruğu: anahtar yokken kuyruğa ALINIR ama GÖNDERİLMEZ", async () => {
  const s = core.buildSummary(base, { slug: SLUG });
  const rows = new Map();
  const calls = [];
  const store = {
    async enqueue(item) { calls.push(["enqueue", item.key]); if (rows.has(item.key)) return false; rows.set(item.key, { ...item, status: "queued" }); return true; },
    async listQueued() { calls.push(["list"]); return [...rows.values()].filter((r) => r.status === "queued").map((r) => ({ post_key: r.key, text: r.text, payload: r.payload })); },
    async claim(key) { calls.push(["claim", key]); const r = rows.get(key); if (!r || r.status !== "queued") return false; r.status = "pending"; return true; },
    async isPosted(key) { return rows.get(key)?.status === "posted"; },
    async finish({ key, status, tweetId }) { calls.push(["finish", key, status]); const r = rows.get(key) || {}; rows.set(key, { ...r, status, tweetId }); },
    async requeue(key) { rows.get(key).status = "queued"; },
    async countSince() { return 0; }
  };
  const now = new Date("2026-10-25T23:00:00+03:00");
  const out = await queue.enqueueSummaries([s], { store, now, log: () => {} });
  assert.deepEqual(out.enqueued, ["summary:af:999001"]);
  assert.equal(rows.get("summary:af:999001").status, "queued");
  assert.match(rows.get("summary:af:999001").text, /MAÇ ÖZETİ \| Süper Lig\nGalatasaray 2-1 Fenerbahçe/);
  assert.match(rows.get("summary:af:999001").text, /https:\/\/www\.futbolradar\.com\/ozet\/galatasaray-fenerbahce-25-ekim-2026$/);
  assert.equal((await queue.enqueueSummaries([s], { store, now, log: () => {} })).already.length, 1, "aynı maç ikinci kez kuyruğa girmez");
  const old = await queue.enqueueSummaries([s], { store, now: new Date("2026-11-05T00:00:00Z"), log: () => {} });
  assert.equal(old.outOfWindow, 1, "48 saatten eski maç kuyruğa alınmaz");

  const forbidden = () => { throw new Error("X/ağ çağrısı yapılmamalı"); };
  const before = calls.length;
  const keys = { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_TOKEN_SECRET: "ts" };
  for (const env of [{}, { X_AUTOPOST_ENABLED: "1" }, { ...keys }, { ...keys, X_AUTOPOST_ENABLED: "1" }, { X_AUTOPOST_ENABLED: "1", X_MATCH_SUMMARY_SHARE_ENABLED: "1" }, { ...keys, X_MATCH_SUMMARY_SHARE_ENABLED: "1" }]) {
    const r = await queue.drainSummaryQueue({ env, store, fetcher: forbidden, post: forbidden, publishedSlugs: new Set([SLUG]), now });
    assert.equal(r.mode, "queued-only", JSON.stringify(env));
    assert.equal(r.posted.length, 0);
  }
  assert.equal(calls.length, before, "kapalı kapıda kuyruğa hiç dokunulmaz");
  assert.equal(rows.get("summary:af:999001").status, "queued");

  // Üç koşul birlikte: gönderilir (sahte gönderici; gerçek ağ yok).
  const live = { ...keys, X_AUTOPOST_ENABLED: "1", X_MATCH_SUMMARY_SHARE_ENABLED: "1" };
  const notYet = await queue.drainSummaryQueue({ env: live, store, post: forbidden, publishedSlugs: new Set(), now });
  assert.deepEqual(notYet.skipped.map((x) => x.reason), ["page-not-published-yet"], "sayfa yayında değilse gönderilmez");
  const sent = [];
  const r = await queue.drainSummaryQueue({ env: live, store, post: async (text) => { sent.push(text); return "123"; }, publishedSlugs: new Set([SLUG]), now });
  assert.equal(r.mode, "live");
  assert.deepEqual(r.posted, [{ key: "summary:af:999001", tweetId: "123" }]);
  assert.equal(rows.get("summary:af:999001").status, "posted");
});

await test("aynı maçın #541 'maç sonu' tweeti gönderildiyse özet atlanır", async () => {
  const s = core.buildSummary(base, { slug: SLUG });
  const rows = new Map([["result:af:999001", { status: "posted" }], ["summary:af:999001", { key: "summary:af:999001", text: "x", payload: { slug: SLUG, afId: "999001" }, status: "queued" }]]);
  const store = {
    async listQueued() { return [{ post_key: "summary:af:999001", text: "x", payload: { slug: SLUG, afId: "999001" } }]; },
    async isPosted(key) { return rows.get(key)?.status === "posted"; },
    async finish({ key, status }) { rows.get(key).status = status; },
    async claim() { throw new Error("claim çağrılmamalı"); },
    async countSince() { return 0; }
  };
  const live = { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_TOKEN_SECRET: "ts", X_AUTOPOST_ENABLED: "1", X_MATCH_SUMMARY_SHARE_ENABLED: "1" };
  const r = await queue.drainSummaryQueue({ env: live, store, post: () => { throw new Error("gönderilmemeli"); }, publishedSlugs: new Set([s.slug]) });
  assert.deepEqual(r.skipped.map((x) => x.reason), ["result-already-posted"]);
  assert.equal(rows.get("summary:af:999001").status, "skipped");
});

await test("tweet metni 280 ağırlıklı karakteri aşmaz", () => {
  const compose = require("../services/xAutopost/compose.js");
  const s = core.buildSummary({ ...base, league: "UEFA Avrupa Konferans Ligi Play-off Turu İkinci Maç", homeTeam: "Çok Uzun Adlı Bir Spor Kulübü Anonim Şirketi", awayTeam: "Bir Başka Çok Uzun Adlı Futbol Kulübü Derneği" }, { slug: SLUG });
  assert.ok(compose.weightedLength(queue.summaryTweet(s)) <= 280);
});

await test("tetik + altyapı: saatlik dönüşüm adımı, rewrite, cron işi, yeni api/ dosyası yok", () => {
  const pipeline = fs.readFileSync(path.join(root, "scripts/run-scheduled-update.mjs"), "utf8");
  assert.match(pipeline, /nodeStep\("match-summaries", "build-match-summaries\.mjs", \["--apply", "--enqueue"\]/);
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.ok(vercel.rewrites.some((r) => r.source === "/ozet/:slug" && r.destination === "/ozet/:slug.html"));
  assert.ok(!vercel.crons.some((c) => /ozet|summary/.test(c.path)), "yeni cron eklenmedi");
  const apiFiles = fs.readdirSync(path.join(root, "api"), { recursive: true }).filter((f) => String(f).endsWith(".js"));
  assert.ok(!apiFiles.some((f) => /summary|ozet/i.test(f)), "yeni işlev dosyası yok");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(pkg.scripts.build, /generate-match-summary-pages\.mjs && node scripts\/sync-public-assets\.mjs/);
  const cron = require("../server/cronRoute.js");
  assert.ok(cron.JOBS.has("x-autopost"));
  const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(home.includes("<!-- match-summary-recent:start -->") && home.includes("<!-- match-summary-recent:end -->"));
  for (const f of ["services/matchSummary/index.js", "services/matchSummary/xQueue.js", "scripts/generate-match-summary-pages.mjs"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), "utf8"), /SUPABASE_SERVICE_ROLE_KEY|service_role_key/i, `${f} anahtar adını doğrudan okumaz`);
  }
});

console.log(`match-summary: ${passed} test geçti`);
