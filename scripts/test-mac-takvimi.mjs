#!/usr/bin/env node
/**
 * MAÇ TAKVİMİ SEO — /mac-takvimi lig/takım kırılımı + /takimlar/<takım> maç takvimi.
 * 1) Saf kurallar (sentetik veri): skor uydurulmaz, aynı adlı ligler
 *    competitionId ile ayrılır, ItemList/SportsEvent şekli.
 * 2) Üretilmiş ağaç (varsa): tek H1, canonical, ItemList, iki yönlü
 *    bağlantılar, bağlanan /mac/ sayfaları mevcut ve indekslenebilir,
 *    noindex maç sayfaları sitemap'te yok.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { calendarRowHtml, groupByCompetition, hasFinalScore, itemListNode, teamCalendar } from "./lib/matchCalendar.mjs";

const root = process.cwd();
const NOW = Date.parse("2026-10-28T12:00:00+03:00");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };

const base = { competitionId: "super-lig", league: "Süper Lig", status: "SCHEDULED", score: { home: null, away: null }, providerIds: { apiFootball: "1" }, primarySource: "calendar", indexable: true };
const pre = { ...base, slug: "galatasaray-fenerbahce-1-kasim-2026", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", kickoff: "2026-11-01T20:00:00+03:00" };
const post = { ...base, slug: "besiktas-galatasaray-20-ekim-2026", homeTeam: "Beşiktaş", awayTeam: "Galatasaray", kickoff: "2026-10-20T20:00:00+03:00", status: "FINISHED", providerStatus: "FT", score: { home: 1, away: 2 } };
const pending = { ...base, slug: "galatasaray-konyaspor-25-ekim-2026", homeTeam: "Galatasaray", awayTeam: "Konyaspor", kickoff: "2026-10-25T20:00:00+03:00", status: "FINISHED", score: { home: null, away: null } };

// 1. Saf kurallar
ok(hasFinalScore(post, NOW), "bitmiş + skorlu maç sonuç sayılır");
ok(!hasFinalScore(pending, NOW), "skoru olmayan bitmiş maç sonuç listesine girmez");
const cal = teamCalendar([pre, post, pending], "galatasaray", { now: NOW });
ok(cal.upcoming.length === 1 && cal.upcoming[0].slug === pre.slug, "yaklaşan maç listesi");
ok(cal.recent.length === 1 && cal.recent[0].slug === post.slug, "sonuç listesi yalnızca skorlu maç");
ok(!calendarRowHtml(pending, "/x", { now: NOW }).includes(" - null"), "skor uydurulmaz");
ok(calendarRowHtml(pre, "/x", { now: NOW }).includes("20:00"), "saat Europe/Istanbul");
const ligA = { ...pre, competitionId: "premier-lig-ingiltere", league: "Premier League" };
const ligB = { ...pre, competitionId: "premier-lig-ukrayna", league: "Premier League" };
ok(groupByCompetition([ligA, ligB]).length === 2, "aynı adlı ligler ayrı gruplanır");
const list = itemListNode([pre], "Yaklaşan maçlar", NOW);
ok(list["@type"] === "ItemList" && list.itemListElement[0].item["@type"] === "SportsEvent", "ItemList > SportsEvent");
ok(list.itemListElement[0].url === "https://www.futbolradar.com/mac/galatasaray-fenerbahce-1-kasim-2026", "kalıcı /mac/ URL");

// 2. Üretilmiş ağaç
const read = (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), "utf8") : null);
const hub = read("mac-takvimi.html");
const sitemap = read("sitemap.xml") || "";
const macLink = (href) => href.replace(/^(\.\.?\/)+/, "").replace(/#.*$/, "");
function assertMatchLinks(html, label) {
  const links = [...html.matchAll(/href="((?:\.\.?\/)+mac\/[^"#?]+)"/g)].map((m) => macLink(m[1]));
  for (const rel of new Set(links)) {
    const file = read(`${rel}.html`);
    ok(file, `${label}: bağlanan sayfa mevcut ${rel}`);
    ok(!/<meta name="robots" content="noindex/.test(file), `${label}: bağlanan maç sayfası indekslenebilir ${rel}`);
  }
  return links.length;
}
if (hub) {
  ok((hub.match(/<h1[\s>]/g) || []).length === 1, "hub: tek H1");
  ok(hub.includes('<link rel="canonical" href="https://www.futbolradar.com/mac-takvimi"'), "hub: canonical");
  ok(/"@type":"BreadcrumbList"/.test(hub), "hub: BreadcrumbList");
  const hasUpcoming = /Liglere göre maç takvimi/.test(hub);
  if (hasUpcoming) ok(/"@type":"ItemList"/.test(hub) && /"@type":"SportsEvent"/.test(hub), "hub: ItemList + SportsEvent");
  ok(/href="\.\/takimlar\/galatasaray"/.test(hub) || !/id="takim-galatasaray"/.test(hub), "hub → takım profili");
  ok(!/style="[^"]*width:\s*\d{3,}px/.test(hub), "hub: sabit genişlik yok");
  assertMatchLinks(hub, "hub");
}
for (const slug of ["galatasaray", "fenerbahce", "besiktas", "trabzonspor"]) {
  const page = read(`takimlar/${slug}.html`);
  if (!page || !page.includes('id="team-calendar"')) continue;
  ok(page.includes(`../mac-takvimi.html#takim-${slug}`), `${slug}: takım → hub çapası`);
  ok(assertMatchLinks(page, slug) > 0, `${slug}: takım → maç detay bağlantısı`);
  if (hub) ok(hub.includes(`id="takim-${slug}"`), `${slug}: hub'da takım bölümü`);
}
// noindex maç sayfaları sitemap'te olmamalı
if (fs.existsSync(path.join(root, "mac"))) {
  let noindex = 0;
  for (const file of fs.readdirSync(path.join(root, "mac")).filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(root, "mac", file), "utf8");
    if (/<meta name="robots" content="noindex/.test(html)) {
      noindex += 1;
      ok(!sitemap.includes(`/mac/${file.replace(/\.html$/, "")}<`), `noindex maç sitemap dışı: ${file}`);
    }
  }
}
console.log(`test-mac-takvimi: ${checks} kontrol geçti`);
