#!/usr/bin/env node
// "Hangi takım şu an formda?" sayfası: son 5 maç hesabı, eşitlik bozma,
// eksik veri, paylaşım bağlantıları, Türkçe og/twitter etiketleri.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { rankFormTable, FORM_TIEBREAK_TEXT, lastFiveMatches } from "./lib/teamLastFive.mjs";
import { renderFormPage, shareLinks, updateSitemapXml, PAGE_URL, SHARE_TITLE, PAGE_DESCRIPTION } from "./generate-form-ranking-page.mjs";

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`); };

const require = createRequire(import.meta.url);
const { sameClub } = require("../services/superLigTeams.js");
const { canonicalStatus, istanbulDay } = require("../services/matchStatus.js");
function match(i, homeTeam, awayTeam, home, away, extra = {}) {
  return { kickoff: `2026-10-${String(10 + i).padStart(2, "0")}T19:00:00+03:00`, status: "FINISHED", homeTeam, awayTeam, score: { home, away }, league: "Süper Lig", source: "api-football", ...extra };
}
function rowsFor(name, list) {
  return lastFiveMatches({ team: { name }, calendar: list, reports: [], sameClub, canonicalStatus, istanbulDay });
}

// Galatasaray: 3G 1B 1M (10 puan), 8-4 → +4.  Fenerbahçe: 10 puan, 9-5 → +4, atılan 9.
// Beşiktaş: 10 puan, 6-4 → +2.  Trabzonspor: yalnızca 3 resmî maç.
const calA = [match(1, "Galatasaray", "Konyaspor", 2, 0), match(2, "Kasımpaşa", "Galatasaray", 1, 3), match(3, "Galatasaray", "Rizespor", 1, 1), match(4, "Alanyaspor", "Galatasaray", 2, 0), match(5, "Galatasaray", "Eyüpspor", 2, 0)];
const calB = [match(1, "Fenerbahçe", "Konyaspor", 3, 0), match(2, "Kasımpaşa", "Fenerbahçe", 2, 3), match(3, "Fenerbahçe", "Rizespor", 1, 1), match(4, "Alanyaspor", "Fenerbahçe", 2, 1), match(5, "Fenerbahçe", "Eyüpspor", 1, 0)];
const calC = [match(1, "Beşiktaş", "Konyaspor", 2, 0), match(2, "Kasımpaşa", "Beşiktaş", 1, 2), match(3, "Beşiktaş", "Rizespor", 0, 0), match(4, "Alanyaspor", "Beşiktaş", 3, 1), match(5, "Beşiktaş", "Eyüpspor", 1, 0)];
const calD = [match(1, "Trabzonspor", "Konyaspor", 1, 0), match(2, "Trabzonspor", "Rizespor", 1, 0), match(3, "Trabzonspor", "Eyüpspor", 1, 0), match(4, "Trabzonspor", "Ümraniyespor", 5, 0, { league: "Hazırlık Maçı" }), match(5, "Trabzonspor", "Alanyaspor", null, null, { status: "SCHEDULED" })];

const entries = [
  { team: { slug: "besiktas", name: "Beşiktaş" }, rows: rowsFor("Beşiktaş", calC) },
  { team: { slug: "galatasaray", name: "Galatasaray" }, rows: rowsFor("Galatasaray", calA) },
  { team: { slug: "fenerbahce", name: "Fenerbahçe" }, rows: rowsFor("Fenerbahçe", calB) },
  { team: { slug: "trabzonspor", name: "Trabzonspor" }, rows: rowsFor("Trabzonspor", calD) }
];
const table = rankFormTable(entries);

check("puan aynı takım sayısı ve G/B/M doğru hesaplanır", () => {
  const a = table.ranked.find((row) => row.team.slug === "galatasaray");
  assert.equal(a.summary.points, 10);
  assert.deepEqual([a.summary.won, a.summary.drawn, a.summary.lost, a.summary.scored, a.summary.conceded], [3, 1, 1, 8, 4]);
  assert.deepEqual(a.rows.map((r) => r.result), ["G", "M", "B", "G", "G"]); // en yeni solda
});
check("eşitlik: puan → averaj → atılan gol → ad", () => {
  assert.deepEqual(table.ranked.map((row) => row.team.slug), ["fenerbahce", "galatasaray", "besiktas"]);
  assert.deepEqual(table.ranked.map((row) => row.rank), [1, 2, 3]);
  assert.match(FORM_TIEBREAK_TEXT, /averaj/);
  assert.match(FORM_TIEBREAK_TEXT, /atılan gol/);
});
check("5 maçı eksik takım sıralanmaz, hazırlık/oynanmamış maç sayılmaz", () => {
  assert.equal(table.pending.length, 1);
  assert.equal(table.pending[0].team.slug, "trabzonspor");
  assert.equal(table.pending[0].rows.length, 3);
  assert.equal(table.pending[0].rank, null);
});

const model = { ...table, newest: "2026-10-15T16:00:00.000Z", indexable: true, credit: "Veri: API-Football", generatedAt: "2026-10-16T00:00:00.000Z" };
const html = renderFormPage(model);
const meta = (attr, name) => (html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`)) || [])[1];

check("kanonik, robots, Türkçe og/twitter etiketleri", () => {
  assert.ok(html.includes(`<link rel="canonical" href="${PAGE_URL}" />`));
  assert.equal(PAGE_URL, "https://www.futbolradar.com/hangi-takim-formda.html");
  assert.match(html, /<html lang="tr">/);
  assert.equal(meta("property", "og:url"), PAGE_URL);
  assert.equal(meta("property", "og:title"), SHARE_TITLE);
  assert.match(meta("property", "og:description"), /son 5 resmî maç/);
  assert.equal(meta("property", "og:locale"), "tr_TR");
  assert.equal(meta("name", "twitter:card"), "summary_large_image");
  assert.equal(meta("name", "twitter:title"), SHARE_TITLE);
  assert.match(meta("name", "robots"), /^index/);
  assert.match(renderFormPage({ ...model, indexable: false }), /<meta name="robots" content="noindex,follow"/);
  assert.ok(html.includes("Veri: API-Football"));
  assert.ok(html.includes("Güncelleniyor"));
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  assert.ok(!/anket|oylama|bahis|iddaa/i.test(main.replace(/Anket ya da tahmin kullanılmaz/, "")));
});
check("JSON-LD geçerli ve sıralamayla aynı", () => {
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const list = ld["@graph"].find((node) => node["@type"] === "ItemList");
  assert.deepEqual(list.itemListElement.map((item) => item.item.name), ["Fenerbahçe", "Galatasaray", "Beşiktaş"]);
});
check("paylaşım: Facebook, X, WhatsApp — kanonik URL kodlu, düz bağlantı", () => {
  const links = shareLinks();
  const enc = encodeURIComponent(PAGE_URL);
  assert.equal(links.find((l) => l.network === "facebook").href, `https://www.facebook.com/sharer/sharer.php?u=${enc}`);
  assert.equal(links.find((l) => l.network === "x").href, `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TITLE)}&url=${enc}`);
  const wa = links.find((l) => l.network === "whatsapp").href;
  assert.ok(wa.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(wa.slice("https://wa.me/?text=".length)), `${SHARE_TITLE} — ${PAGE_DESCRIPTION} ${PAGE_URL}`);
  const anchors = html.match(/<a data-share-network="[^"]+"[^>]*>/g);
  assert.equal(anchors.length, 3);
  for (const a of anchors) {
    assert.match(a, /target="_blank"/);
    assert.match(a, /rel="noopener noreferrer"/);
    assert.match(a, /aria-label="[^"]*paylaş[^"]*"/);
  }
  for (const l of links) assert.ok(html.includes(l.href.replaceAll("&", "&amp;")), l.network);
  // Üçüncü taraf SDK / izleme pikseli yok.
  assert.ok(!/connect\.facebook\.net|platform\.twitter\.com|widgets\.js|fbq\(|<img[^>]+(facebook|twitter)/i.test(html));
});
check("takım bağlantıları ve site haritası kararı", () => {
  assert.ok(html.includes('data-team="fenerbahce"'));
  const base = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n  <url>\n    <loc>https://www.futbolradar.com/</loc>\n  </url>\n</urlset>\n';
  assert.ok(updateSitemapXml(base, true, "2026-11-21").includes(`<loc>${PAGE_URL}</loc>`));
  const withPage = updateSitemapXml(base, true, "2026-11-21");
  assert.ok(!updateSitemapXml(withPage, false).includes(`<loc>${PAGE_URL}</loc>`));
  assert.equal(updateSitemapXml(withPage, true, "2026-11-21").split(PAGE_URL).length, 2);
});

console.log(`test-form-ranking-page: ${passed} kontrol geçti`);
