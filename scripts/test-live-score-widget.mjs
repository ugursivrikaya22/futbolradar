#!/usr/bin/env node
/**
 * Canlı skor bileşeni: istemci çizimi (durum, skor, dakika, golcüler, boş
 * durum), sunucu anlık görüntüsü (SEO metni, JSON-LD, kaynaklar, CLS/taşma
 * kuralları, defer betik) ve sayfa yerleşimi (takım sayfaları + maç sayfası).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CSS, renderTeamWidget, renderMatchPageStrip, isFeaturedActive, upsertBlock, removeBlock, START, END } from "./lib/liveScoreWidget.mjs";
import { nextFixtureFor } from "./inject-live-score-widget.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const w = require("../live-score-widget.js");
const config = JSON.parse(fs.readFileSync(path.join(root, "data/live-score-widget.json"), "utf8"));
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");

// ---- İstemci: durumlar
assert.equal(w.statusOf({ status: "LIVE", providerStatus: "2H" }), "live");
assert.equal(w.statusOf({ status: "HALFTIME", providerStatus: "HT" }), "break");
assert.equal(w.statusOf({ status: "FINISHED", providerStatus: "FT" }), "finished");
assert.equal(w.statusOf({ status: "SCHEDULED", providerStatus: "NS" }), "scheduled");
assert.equal(w.statusOf({ status: "POSTPONED" }), "off");
assert.equal(w.statusOf({ status: "UNKNOWN" }), "unknown");

const base = {
  id: "1584469", providerId: "1584469", league: "Süper Lig", round: 12,
  kickoff: "2026-11-21T16:00:00+03:00", homeTeam: "Galatasaray", awayTeam: "Samsunspor",
  homeTeamId: "galatasaray", awayTeamId: "samsunspor", matchPage: "mac/galatasaray-samsunspor-21-kasim-2026"
};
const live = {
  ...base, status: "LIVE", providerStatus: "2H", minute: 67, score: { home: 2, away: 1 },
  events: [
    { time: "12'", team: { name: "Galatasaray" }, type: "Goal", detail: "Normal Goal", value: "V. Osimhen · Asist: L. Sané · Normal Goal" },
    { time: "30'", team: { name: "Samsunspor" }, type: "Goal", detail: "Penalty", value: "M. Ndiaye · Penalty" },
    { time: "50'", team: { name: "Galatasaray" }, type: "Goal", detail: "Missed Penalty", value: "B. Yılmaz · Missed Penalty" },
    { time: "61'", team: { name: "Galatasaray" }, type: "Goal", detail: "Normal Goal", value: "" },
    { time: "40'", team: { name: "Galatasaray" }, type: "Card", detail: "Yellow Card", value: "X" }
  ]
};
let html = w.cardHtml(live, "../", true);
assert.match(html, /Canlı · 67&#39;/);
assert.match(html, /<b class="lsw-card__score">2 - 1<\/b>/);
assert.match(html, /lsw-goal--home"><span>12&#39;<\/span> V\. Osimhen</);
assert.match(html, /lsw-goal--away"><span>30&#39;<\/span> M\. Ndiaye \(P\)</);
assert.doesNotMatch(html, /B\. Yılmaz/, "kaçan penaltı gol değildir");
assert.match(html, /61&#39;<\/span> Güncelleniyor/, "golcü adı yoksa uydurulmaz");
assert.match(html, /lsw-card--featured/);
assert.match(html, /href="\.\.\/mac\/galatasaray-samsunspor-21-kasim-2026"/);

html = w.cardHtml({ ...live, status: "FINISHED", providerStatus: "FT", minute: 90 }, "../", false);
assert.match(html, /Maç sonu/);
assert.match(html, /Maç raporu ve goller/);

html = w.cardHtml({ ...base, status: "LIVE", providerStatus: "1H", minute: 5, score: { home: null, away: null }, events: [] }, "/", false);
assert.match(html, /<b class="lsw-card__score">Güncelleniyor<\/b>/, "skor yoksa uydurulmaz");

html = w.cardHtml({ ...base, status: "LIVE", providerStatus: "1H", minute: 20, score: { home: 1, away: 0 }, events: [] }, "/", false);
assert.match(html, /Golcüler: Güncelleniyor/);

html = w.cardHtml({ ...base, status: "SCHEDULED", providerStatus: "NS", score: { home: null, away: null } }, "/", false);
assert.match(html, /Başlama 16\.00 TSİ/);
assert.doesNotMatch(html, /\d+ - \d+/, "başlamamış maçta skor yok");

assert.equal(w.cardHtml({ ...base, homeTeam: "<img onerror=x>", status: "SCHEDULED" }, "/", false).includes("<img"), false, "kaçış");

// ---- İstemci: takım/fikstür seçimi
const el = (attrs) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) });
const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const todayMatch = { ...base, id: "a", providerId: "a", kickoff: `${today}T16:00:00+03:00`, status: "SCHEDULED" };
const otherDay = { ...base, id: "b", providerId: "b", kickoff: "2020-01-01T16:00:00+03:00", status: "SCHEDULED" };
const otherTeam = { ...todayMatch, id: "c", providerId: "c", homeTeam: "Kocaelispor", awayTeam: "Fenerbahçe", homeTeamId: "kocaelispor", awayTeamId: "fenerbahce" };
const liveOld = { ...otherDay, id: "d", providerId: "d", status: "LIVE", providerStatus: "2H" };
assert.deepEqual(w.pick(el({ "data-lsw-team": "Galatasaray", "data-lsw-team-slug": "galatasaray" }), [todayMatch, otherDay, otherTeam, liveOld]).map((m) => m.id), ["d", "a"]);
assert.deepEqual(w.pick(el({ "data-lsw-team": "Fenerbahçe", "data-lsw-team-slug": "fenerbahce" }), [todayMatch, otherTeam]).map((m) => m.id), ["c"]);
assert.deepEqual(w.pick(el({ "data-lsw-team": "Fenerbahçe" }), [{ ...otherTeam, awayTeam: "Fenerbahce", awayTeamId: null }]).map((m) => m.id), ["c"], "aksansız sağlayıcı adı eşleşir");
assert.deepEqual(w.pick(el({ "data-lsw-fixture": "1584469" }), [otherTeam, live]).map((m) => m.id), ["1584469"]);
assert.equal(w.needsPoll([live]), true);
assert.equal(w.needsPoll([{ ...live, status: "FINISHED", providerStatus: "FT" }]), false, "maç bitince yoklama durur");
assert.equal(w.needsPoll([otherDay]), false);

// ---- Sunucu anlık görüntüsü
const featured = config.featured.find((f) => f.fixtureId === "1584469");
assert.ok(featured, "GS–Samsunspor öne çıkan maç kaydı");
assert.equal(featured.kickoff, "2026-11-21T16:00:00+03:00");
assert.equal(featured.referee, "Ali Şansalan");
assert.equal(featured.venue, "Başakşehir Fatih Terim Stadı");
for (const f of config.featured) {
  for (const k of ["venueSourceUrl", "refereeSourceUrl"]) if (f[k]) assert.ok(isAllowedSourceUrl(f[k]), `izinli kaynak: ${f[k]}`);
}
assert.equal(isFeaturedActive(featured, new Date("2026-11-21T17:00:00+03:00")), true);
assert.equal(isFeaturedActive(featured, new Date("2026-11-23T12:00:00+03:00")), false);

const team = { slug: "galatasaray", name: "Galatasaray" };
const fHtml = renderTeamWidget({ team, featured, endpoint: config.endpoint, poll: 60, base: "../" });
assert.ok(fHtml.startsWith(START) && fHtml.endsWith(END));
assert.match(fHtml, /Galatasaray – Samsunspor canlı skor/);
assert.match(fHtml, /Kritik maç/);
assert.match(fHtml, /21 Kasım 2026 Cumartesi, 16\.00 TSİ/);
assert.match(fHtml, /Veri: API-Football/);
assert.match(fHtml, /Hakem: Ali Şansalan \(Kaynak: <a href="https:\/\/www\.aa\.com\.tr\/[^"]+" target="_blank" rel="nofollow noopener noreferrer">Anadolu Ajansı<\/a>\)/);
assert.match(fHtml, /Stat: Başakşehir Fatih Terim Stadı \(Kaynak: <a href="https:\/\/www\.aa\.com\.tr\//);
assert.match(fHtml, /data-lsw-endpoint="\/api\/matches\?league=203"/, "mevcut uç nokta, yeni API yok");
assert.match(fHtml, /<script src="\/live-score-widget\.js" defer><\/script>/);
const scripts = fHtml.match(/<script\b[^>]*>/g) || [];
assert.ok(scripts.every((s) => /defer/.test(s) || /application\/ld\+json/.test(s)), "bloklayan betik yok");
assert.doesNotMatch(fHtml, /\b\d+\s-\s\d+\b/, "sunucu skor yazmaz");
const ld = JSON.parse(fHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
assert.equal(ld["@type"], "SportsEvent");
assert.equal(ld.startDate, featured.kickoff);
assert.equal(ld.location.name, "Başakşehir Fatih Terim Stadı");
assert.equal(ld.url, "https://www.futbolradar.com/mac/galatasaray-samsunspor-21-kasim-2026");
assert.equal(ld.eventStatus, "https://schema.org/EventScheduled");

const plain = renderTeamWidget({ team: { slug: "trabzonspor", name: "Trabzonspor" }, next: null, endpoint: config.endpoint, base: "../" });
assert.match(plain, /Güncelleniyor/);
assert.doesNotMatch(plain, /application\/ld\+json/, "gerçek öne çıkan maç yoksa JSON-LD yok");
const nextHtml = renderTeamWidget({ team: { slug: "fenerbahce", name: "Fenerbahçe" }, next: { slug: "kocaelispor-fenerbahce-21-kasim-2026", homeTeam: "Kocaelispor", awayTeam: "Fenerbahçe", league: "Süper Lig", kickoff: "2026-11-21T19:00:00+03:00" }, endpoint: config.endpoint, base: "../" });
assert.match(nextHtml, /Sıradaki maç · Süper Lig · <time datetime="2026-11-21T19:00:00\+03:00">21 Kasım 2026 Cumartesi, 19\.00 TSİ/);

const pages = [
  { homeTeam: "Galatasaray", awayTeam: "Samsunspor", kickoff: "2026-11-21T16:00:00+03:00", slug: "x" },
  { homeTeam: "Galatasaray", awayTeam: "Y", kickoff: "2026-11-28T16:00:00+03:00", slug: "y" },
  { homeTeam: "Galatasaray", awayTeam: "Z", kickoff: "2026-11-10T16:00:00+03:00", slug: "z" }
];
assert.equal(nextFixtureFor("Galatasaray", pages, new Date("2026-11-21T01:00:00+03:00")).slug, "x");
assert.equal(nextFixtureFor("Galatasaray", pages, new Date("2026-11-21T20:00:00+03:00")).slug, "y");

const strip = renderMatchPageStrip(featured);
assert.match(strip, /Kritik maç/);
assert.doesNotMatch(strip, /data-lsw-body/, "maç sayfasında ikinci skor tablosu yok");

// Idempotent yuva
const doc = "<main><header class=\"evergreen-hero\"><h1>x</h1></header><p>y</p></main>";
const once = upsertBlock(doc, fHtml, /<header class="evergreen-hero">[\s\S]*?<\/header>/);
assert.equal(upsertBlock(once, fHtml, /<header class="evergreen-hero">[\s\S]*?<\/header>/), once);
assert.equal(removeBlock(once), doc);

// ---- 390 px / CLS kuralları
assert.match(CSS, /\.lsw__body\{min-height:\d+px/);
assert.match(CSS, /grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);
assert.match(CSS, /overflow-wrap:anywhere/);
assert.match(CSS, /\.lsw-card__link\{[^}]*min-height:44px/);

// ---- Yerleşim: yeni URL yok, var olan sayfalar genişletildi
for (const t of config.teams) {
  const file = fs.readFileSync(path.join(root, t.file), "utf8");
  assert.equal(file.split(START).length - 1, 1, `${t.file}: tek bileşen`);
  assert.match(file, new RegExp(`data-lsw-team="${t.name}"`));
}
const matchFile = fs.readFileSync(path.join(root, featured.matchPageFile), "utf8");
assert.doesNotMatch(matchFile, /Rams Park/, "maç sayfasında stat düzeltmesi");
for (const f of ["site.webmanifest", "sw.js", "public/sw.js", "pwa.js"]) assert.ok(fs.existsSync(path.join(root, f)));

console.log("test-live-score-widget: istemci çizimi, sunucu anlık görüntüsü, JSON-LD, kaynaklar, CLS/390px ve yerleşim passed");
