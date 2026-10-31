// Kilit SEO sayfalarının veri tarihi (dateModified + görünür "Son güncelleme") testi.
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyDataFreshness, extractDateModified, extractVisibleUpdate, freshnessFlags, istanbulDate, sitemapLastmod } from "./lib/pageFreshness.mjs";

// 1) Saf fonksiyonlar
assert.equal(istanbulDate("2026-10-19T22:30:00Z"), "2026-10-20", "İstanbul günü UTC+3");
assert.equal(istanbulDate("bozuk"), null);
const base = `<script type="application/ld+json">{"@graph":[{"@type":"CollectionPage","@id":"https://x/p.html"}]}</script><h1>Başlık</h1>`;
const once = applyDataFreshness(base, { dataTimestamp: "2026-10-19T06:00:00Z", pageUrl: "https://x/p.html" });
assert.equal(extractDateModified(once), "2026-10-19");
assert.equal(extractVisibleUpdate(once), "2026-10-19".replace(/.*/, "19 Ekim 2026"));
assert.equal(applyDataFreshness(once, { dataTimestamp: "2026-10-19T06:00:00Z", pageUrl: "https://x/p.html" }), once, "idempotent");
assert.equal(applyDataFreshness(base, { dataTimestamp: null }), base, "veri damgası yoksa tarih uydurulmaz");
const xml = `<url><loc>https://x/a</loc></url><url><loc>https://x/b</loc><lastmod>2026-10-01</lastmod></url>`;
assert.equal(sitemapLastmod(xml, "https://x/a"), null, "komşu girdinin lastmod'u sızmaz");
assert.ok(freshnessFlags({ dateModified: "2026-01-01", visible: "x", lastmod: "2026-01-01" }, new Date("2026-10-30")).flags.includes("STALE"));

// 2) Üretilmiş sayfalar: dateModified == görünür tarih == veri dosyasının damgası
const leaders = JSON.parse(fs.readFileSync("data/league-leaders.json", "utf8"));
const standings = JSON.parse(fs.readFileSync("data/league-standings.json", "utf8"))["super-lig"];
const expect = {
  "gol-kralligi.html": istanbulDate(leaders.updatedAt || leaders.generatedAt),
  "asist-kralligi.html": istanbulDate(leaders.updatedAt || leaders.generatedAt),
  "puan-durumu.html": istanbulDate(standings?.updatedAt),
  "takimlar.html": istanbulDate(standings?.updatedAt),
  "galatasaray-puan-durumu.html": istanbulDate(standings?.updatedAt),
  "fenerbahce-puan-durumu.html": istanbulDate(standings?.updatedAt),
  "besiktas-puan-durumu.html": istanbulDate(standings?.updatedAt),
  "trabzonspor-puan-durumu.html": istanbulDate(standings?.updatedAt)
};
for (const [file, date] of Object.entries(expect)) {
  if (!date) continue;
  const html = fs.readFileSync(file, "utf8");
  assert.equal(extractDateModified(html), date, `${file}: dateModified veri tarihine eşit olmalı`);
  assert.match(html, new RegExp(`data-data-freshness>Son güncelleme: <time datetime="${date}">`), `${file}: görünür Son güncelleme`);
}
console.log("✓ page-freshness: dateModified + görünür Son güncelleme veri damgasından geliyor");
