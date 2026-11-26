/**
 * Ana sayfa tazelik kuralları: oynanmış maç ≤ 24 saat "Son sonuçlar"da kalır,
 * öne çıkan haber/yazı ≤ 48 saat. Kural sunucuda (services/homeFreshness.js),
 * tarayıcıda (app.js `home-freshness` bloğu) ve statik HTML'deki satır içi
 * betiklerde aynı olmalı; elle yazılmış Shakhtar kartı geri dönmemeli.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { renderHomeRecentResults } from "./lib/homeRecentResults.mjs";

const require = createRequire(import.meta.url);
const {
  FEATURED_MAX_AGE_MS, RESULT_WINDOW_MS, MATCH_DURATION_MS,
  isFreshFeatured, isRecentResult, selectRecentResults, resultExpiresAtMs
} = require("../services/homeFreshness.js");

const H = 3600000;
const T0 = Date.parse("2026-11-25T23:00:00+03:00"); // Shakhtar–Fenerbahçe başlama
const base = { id: "a-b", homeTeam: "A", awayTeam: "B", league: "Lig", time: "23:00", kickoff: "2026-11-25T23:00:00+03:00", status: "FINISHED", score: { home: 1, away: 2 } };

// --- 1. Son sonuç penceresi: bitişten 24 saat (bitiş bilinmiyorsa başlama + 2 saat)
assert.equal(RESULT_WINDOW_MS, 24 * H);
assert.equal(FEATURED_MAX_AGE_MS, 48 * H);
const estEnd = T0 + MATCH_DURATION_MS;
assert.equal(resultExpiresAtMs(base), estEnd + 24 * H);
assert.equal(isRecentResult(base, estEnd + 1), true, "biten maç görünür");
assert.equal(isRecentResult(base, estEnd + 24 * H - 1), true, "24 saatin hemen altında görünür");
assert.equal(isRecentResult(base, estEnd + 24 * H), false, "24. saatte düşer");
assert.equal(isRecentResult(base, estEnd + 40 * H), false);
// sağlayıcı bitiş zamanı verdiyse o geçerli
const withEnd = { ...base, finishedAt: new Date(T0 + 105 * 60000).toISOString() };
assert.equal(resultExpiresAtMs(withEnd), T0 + 105 * 60000 + 24 * H);
assert.equal(isRecentResult(withEnd, T0 + 105 * 60000 + 24 * H + 1), false);
// sonucu olmayanlar girmez
for (const [name, m] of Object.entries({
  scheduled: { ...base, status: "SCHEDULED", score: null },
  live: { ...base, status: "LIVE" },
  postponed: { ...base, status: "PST", score: { home: null, away: null } },
  cancelled: { ...base, status: "CANC" },
  noScore: { ...base, score: { home: null, away: null } },
  noScoreAtAll: { ...base, score: undefined },
  badKickoff: { ...base, kickoff: "x" },
  future: { ...base, kickoff: "2027-01-01T20:00:00+03:00" }
})) assert.equal(isRecentResult(m, estEnd + H), false, name);
// sıralama ve sınır
const mk = (id, h) => ({ ...base, id, kickoff: new Date(T0 + h * H).toISOString() });
const picked = selectRecentResults([mk("old", -30), mk("a", -3), mk("b", -1), mk("c", -2)], T0 + 5 * H, 2);
assert.deepEqual(picked.map((m) => m.id), ["b", "c"], "en yeni biten önde, limit uygulanır; 24 saati geçen düşer");

// --- 2. Öne çıkan haber/yazı 48 saat
const now = Date.parse("2026-11-26T12:00:00+03:00");
assert.equal(isFreshFeatured("2026-11-24T12:00:01+03:00", now), true);
assert.equal(isFreshFeatured("2026-11-24T12:00:00+03:00", now), false, "tam 48. saatte düşer");
assert.equal(isFreshFeatured("2026-11-11T21:20:00+03:00", now), false);
assert.equal(isFreshFeatured("2026-11-27T12:00:00+03:00", now), false, "gelecek tarihli vitrine çıkmaz");
assert.equal(isFreshFeatured(undefined, now), false);
assert.equal(isFreshFeatured("bozuk", now), false);

// --- 3. Tarayıcı kuralı (app.js) sunucuyla aynı kararı verir
const block = fs.readFileSync("app.js", "utf8").match(/\/\/ home-freshness:start([\s\S]*?)\/\/ home-freshness:end/);
assert.ok(block, "app.js home-freshness bloğu yok");
const client = new Function(`${block[1]}\nreturn isFreshFeaturedItem;`)();
for (const v of ["2026-11-24T12:00:01+03:00", "2026-11-24T12:00:00+03:00", "2026-11-26T11:59:59+03:00", "2026-11-27T00:00:00+03:00", "2026-11-11T21:20:00+03:00", "", undefined, "bozuk"]) {
  assert.equal(client(v, now), isFreshFeatured(v, now), `sunucu/istemci uyumsuz: ${v}`);
}

// --- 4. Üretilen "Son sonuçlar" işaretlemesi
assert.equal(renderHomeRecentResults([{ ...base, status: "SCHEDULED", score: null }], { nowMs: estEnd + H }), "", "sonuç yoksa bölüm basılmaz");
const html = renderHomeRecentResults([base, mk("old", -30)], { nowMs: estEnd + H, href: (m) => `./mac/${m.id}`, dateLabel: () => "25 Kasım" });
assert.match(html, /id="son-sonuclar"/);
assert.match(html, /<b class="recent-result__score">1 – 2<\/b>/);
assert.equal((html.match(/data-recent-result=/g) || []).length, 1, "24 saati geçen maç basılmaz");
assert.match(html, new RegExp(`data-expires="${new Date(resultExpiresAtMs(base)).toISOString()}"`));
assert.doesNotMatch(renderHomeRecentResults([{ ...base, homeTeam: "<b>x</b>" }], { nowMs: estEnd + H }), /<b>x<\/b>/, "takım adı kaçışlanır");

// --- 5. Satır içi süpürme betiği (önbellekten bayat gelen HTML): süresi dolan kart ve boş bölüm düşer
function sweepAt(nowMs, markup) {
  const cards = [...markup.matchAll(/data-expires="([^"]+)"/g)].map((m) => ({ expires: m[1], removed: false }));
  const nodes = cards.map((card) => ({ getAttribute: () => card.expires, parentNode: { removeChild() { card.removed = true; } } }));
  const sectionRef = { removed: false };
  const document = {
    getElementById: () => ({
      querySelectorAll: () => nodes.filter((_, i) => !cards[i].removed),
      parentNode: { removeChild() { sectionRef.removed = true; } }
    })
  };
  const timers = [];
  const script = markup.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, { document, Array, Date: class extends Date { static now() { return nowMs; } }, isFinite, Math, Infinity, setTimeout: (fn, ms) => timers.push(ms) });
  return { remaining: cards.filter((c) => !c.removed).length, sectionRemoved: sectionRef.removed, timers };
}
const markup = renderHomeRecentResults([base], { nowMs: estEnd + H });
assert.deepEqual(sweepAt(estEnd + H, markup), { remaining: 1, sectionRemoved: false, timers: [resultExpiresAtMs(base) - (estEnd + H) + 500] });
const late = sweepAt(estEnd + 25 * H, markup);
assert.equal(late.remaining, 0);
assert.equal(late.sectionRemoved, true, "kart kalmayınca bölüm de kalkar");

// --- 6. Kaynak HTML: elle yazılmış maç kartı geri dönmesin, yuva ve vitrin işaretleri yerinde
const index = fs.readFileSync("index.html", "utf8");
assert.doesNotMatch(index, /id="one-cikan-mac"/, "elle yazılmış manşet maç kartı kaldırıldı");
assert.doesNotMatch(index, /<h2[^>]*>[^<]*Shakhtar/i, "ana sayfada Shakhtar manşeti yok");
assert.match(index, /<!-- prerender:home-recent-results:start -->[\s\S]*<!-- prerender:home-recent-results:end -->/);
assert.match(index, /id="futbol-gundemi"[^>]*data-api-section="news-preview"[^>]*data-empty-hide/);
assert.match(fs.readFileSync("scripts/prerender-core-pages.mjs", "utf8"), /"home-recent-results": homeRecentResultsSlot\(\)/);

// --- 7. Öne çıkan köşe yazısı 48 saati geçince boş döner
const { featuredColumnHtml } = await import("./generate-column-pages.mjs");
const column = { id: "c", path: "kose-yazilari/c.html", title: "T", date: "2026-11-11T21:20:00+03:00", author: "FutbolRadar", excerpt: "x" };
assert.notEqual(featuredColumnHtml([column], now), "", "sınırsız çağrı davranışı korunur");
assert.equal(featuredColumnHtml([column], now, { maxAgeMs: FEATURED_MAX_AGE_MS }), "", "15 günlük yazı vitrine çıkmaz");
const fresh = { ...column, date: "2026-11-26T08:00:00+03:00" };
const freshHtml = featuredColumnHtml([fresh, column], now, { maxAgeMs: FEATURED_MAX_AGE_MS });
assert.match(freshHtml, /data-expires="2026-11-28T05:00:00\.000Z"/, "yeni yazı yerini alır ve son kullanma işareti taşır");

console.log("PASS: home freshness — son sonuç ≤24s, öne çıkan ≤48s, sunucu/istemci eşit, süpürme betiği, Shakhtar kartı yok.");
