#!/usr/bin/env node
/** Kalıcı ek SEO sayfaları: veri kuralı, indeks kapısı, şema, sitemap, rota. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { buildAll, buildTransferRadarPage, buildEuropePage, applySitemap, rumourItems, teamOf, MIN_RUMOURS } from "./generate-kalici-ek-pages.mjs";
import { POSTPROCESS_CHAIN } from "./lib/postprocessChain.mjs";
const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");

const pages = buildAll();
assert.equal(pages.length, 3);
for (const p of pages) {
  const h = p.html;
  assert.equal((h.match(/<h1[\s>]/g) || []).length, 1, `${p.slug}: tek H1`);
  assert.ok((h.match(/<h2[\s>]/g) || []).length >= 2, `${p.slug}: H2'ler`);
  assert.ok(h.includes(`<link rel="canonical" href="https://www.futbolradar.com/${p.slug}" />`), `${p.slug}: canonical`);
  const ld = JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const types = ld["@graph"].map((n) => n["@type"]);
  assert.ok(types.includes("BreadcrumbList") && types.includes("ItemList"), `${p.slug}: şema`);
  assert.ok(!/wikipedia\.org|thesportsdb/i.test(h), `${p.slug}: yasak kaynak`);
  const mainHtml = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
  for (const [, href, rel] of mainHtml.matchAll(/<a href="(https?:\/\/[^"]+)"[^>]*?rel="([^"]*)"/g)) {
    assert.ok(rel.includes("noreferrer"), `${p.slug}: rel noreferrer ${href}`);
    assert.ok(isAllowedSourceUrl(href), `${p.slug}: izinli kaynak ${href}`);
  }
  assert.ok(/<meta name="robots" content="(index|noindex),follow/.test(h));
  if (!p.indexable) assert.ok(h.includes("noindex,follow"), `${p.slug}: noindex`);
  for (const f of [`${p.slug}.html`, `public/${p.slug}.html`]) assert.ok(fs.existsSync(f), `${f} üretilmiş olmalı`);
}
const stats = pages.find((p) => p.slug === "super-lig-mac-istatistikleri");
assert.ok(stats.html.includes("Veri: <a href=\"https://www.api-football.com/\""), "API-Football atfı");
assert.ok(stats.html.includes("Güncelleniyor"), "kart krallığı uydurulmaz");
assert.ok(/SportsEvent/.test(stats.html));

// Avrupa: kaynak kimliği olmayan ve altyapı maçı basılmaz
const eu = buildEuropePage({ updatedAt: "2026-10-20T00:00:00Z", records: [
  { match: { id: "a", homeTeam: "Fenerbahçe", awayTeam: "X", league: "UEFA Champions League", status: "FINISHED", kickoff: "2026-09-01T20:00:00+03:00", score: { home: 1, away: 0 } } },
  { match: { id: "b", homeTeam: "Fenerbahce U19", awayTeam: "Y", league: "UEFA Champions League", status: "FINISHED", kickoff: "2026-09-02T20:00:00+03:00", providerIds: { apiFootball: "2" }, score: { home: 1, away: 0 } } },
  { match: { id: "c", homeTeam: "Beşiktaş", awayTeam: "Z", league: "UEFA Europa League", status: "FINISHED", kickoff: "2026-09-03T20:00:00+03:00", providerIds: { apiFootball: "3" }, score: { home: 2, away: 0 } } }
] }, { matches: [] });
assert.ok(eu.html.includes("Beşiktaş Avrupa maçları") && !eu.html.includes("Fenerbahçe Avrupa maçları</h2>") && !eu.indexable);

// Transfer Radarı: izinsiz kaynak düşer, iddia etiketi zorunlu, eşik altı noindex + sitemap dışı
const items = [
  { text: "Galatasaray X ile ilgileniyor", status: "dedikodu", source_name: "Takvim", source_url: "https://www.takvim.com.tr/spor/galatasaray/2026/10/20/x" },
  { text: "Fenerbahçe Y'yi istiyor", status: "dedikodu", source_name: "Wiki", source_url: "https://tr.wikipedia.org/wiki/Y" }
];
const r = rumourItems({ items });
assert.equal(r.length, 1); assert.equal(r[0].date, "2026-10-20"); assert.equal(teamOf("Galatasaray SK")[0], "galatasaray");
const tr = buildTransferRadarPage([], { updatedAt: "2026-10-26T11:00:00+03:00", items });
assert.ok(tr.html.includes("İddia / dedikodu") && !tr.html.includes("wikipedia") && !tr.indexable && MIN_RUMOURS > 1);
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n  <url>\n    <loc>https://www.futbolradar.com/transfer-radari</loc>\n  </url>\n</urlset>\n';
assert.ok(!applySitemap(xml, tr).includes("transfer-radari"), "noindex sayfa sitemap dışı");

// sitemap: indekslenebilir sayfa var, noindex olanlar yok
const sm = fs.readFileSync("sitemap.xml", "utf8");
for (const p of pages) assert.equal(sm.includes(`<loc>https://www.futbolradar.com/${p.slug}</loc>`), p.indexable, `${p.slug} sitemap durumu`);
// rota + zincir
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
for (const p of pages) {
  assert.ok(vercel.rewrites.some((x) => x.source === `/${p.slug}` && x.destination === `/${p.slug}.html`), `${p.slug} rewrite`);
  assert.ok(!vercel.redirects.some((x) => x.source === `/${p.slug}`), `${p.slug} yönlendirilmemeli`);
}
assert.ok(POSTPROCESS_CHAIN.some((s) => s.script === "generate-kalici-ek-pages.mjs"));
// PWA dosyaları dokunulmadan duruyor
for (const f of ["site.webmanifest", "sw.js", "public/sw.js", "pwa.js"]) assert.ok(fs.existsSync(f));
console.log("test-kalici-ek: OK");
