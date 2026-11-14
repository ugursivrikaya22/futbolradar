#!/usr/bin/env node
/**
 * Kaynaklı oyuncu kıyası yüzeyi (oyuncu-karsilastir.html + karsilastirma/*.html):
 *   - "Veri: API-Football" künyesi görünür,
 *   - eksik değer "Güncelleniyor",
 *   - dış bağlantılar rel="nofollow noopener noreferrer" ve beyaz listede,
 *   - interaktif sayfa noindex kalır, PWA bağlantısı korunur,
 *   - 390px: CSS'te taşma yaratan sabit genişlik yok.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { renderComparison, MISSING } = require("../player-comparison-data.js");
const { isUsableSourceUrl } = require("../services/playerComparisonCollector.js");
const data = JSON.parse(fs.readFileSync("data/player-comparison-data.json", "utf8"));

function externalLinks(html) {
  return Array.from(html.matchAll(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>/g)).map((m) => ({ tag: m[0], href: m[1] }));
}
function assertLinks(html, label) {
  const links = externalLinks(html);
  assert.ok(links.length > 0, `${label}: kaynak bağlantısı var`);
  for (const link of links) {
    assert.match(link.tag, /rel="nofollow noopener noreferrer"/, `${label}: ${link.href} rel`);
    assert.ok(isUsableSourceUrl(link.href), `${label}: ${link.href} beyaz listede`);
  }
}

assert.equal(MISSING, "Güncelleniyor");

// Boş iki taraf: her alan Güncelleniyor, künye yine görünür.
const empty = renderComparison(data, null, null);
assert.ok(empty.includes("Veri: API-Football"));
assert.ok((empty.match(/Güncelleniyor/g) || []).length >= 15, "eksik alanlar Güncelleniyor");
assert.ok(!/\bNaN\b|undefined|null/.test(empty.replace(/data-pcd-[a-z]+="[^"]*"/g, "")), "boş değer metne sızmaz");

// Gerçek veri: Avrupa ve Türkiye'den birer oyuncu.
const tr = data.players.find((p) => p.region === "turkiye" && p.seasonStats.length && p.transferHistory.length && p.matchPerformance);
const eu = data.players.find((p) => p.region === "avrupa" && p.seasonStats.length);
assert.ok(tr && eu, "Türkiye ve Avrupa oyuncusu veride var");
const html = renderComparison(data, tr, eu);
assert.ok(html.includes("Veri: API-Football"));
assert.ok(html.includes(tr.seasonStats[0].competition));
assert.ok(html.includes(String(tr.seasonStats[0].goals)));
for (const label of ["Kulüp (kadro)", "Pozisyon", "Forma numarası", "Gol / 90 dk", "Gol / maç", "son 5 maç", "transfer geçmişi"]) {
  assert.ok(html.includes(label), `${label} satırı var`);
}
assertLinks(html, "kıyas bloğu");
assert.ok(!/NaN|undefined/.test(html));

// Lig filtresi: seçilen ligin istatistiği öne gelir.
const multi = data.players.find((p) => p.seasonStats.length > 1);
if (multi) {
  const second = multi.seasonStats[1];
  assert.ok(renderComparison(data, multi, null, { leagueId: second.competitionId }).includes(second.competition));
}

// İnteraktif sayfa: bölüm, betik, künye; noindex ve PWA manifest korunur.
for (const file of ["oyuncu-karsilastir.html", "public/oyuncu-karsilastir.html"]) {
  const page = fs.readFileSync(file, "utf8");
  assert.ok(page.includes("data-player-comparison-data"), `${file}: kaynaklı kıyas bölümü`);
  assert.match(page, /player-comparison-data\.js\?v=[0-9a-f]{8}/, `${file}: sürümlü betik`);
  assert.match(page, /player-comparison-data\.css\?v=[0-9a-f]{8}/, `${file}: sürümlü stil`);
  assert.ok(page.includes("Veri: API-Football"), `${file}: künye`);
  assert.match(page, /<meta name="robots" content="noindex,follow"/, `${file}: noindex kalır`);
  assert.match(page, /site\.webmanifest/, `${file}: PWA manifest bağlantısı korunur`);
  for (const league of ["Süper Lig", "Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1", "Şampiyonlar Ligi"]) {
    assert.ok(page.includes(league), `${file}: ${league}`);
  }
  const section = page.slice(page.indexOf("data-player-comparison-data"), page.indexOf("source-strip"));
  assertLinks(section, file);
}

// Statik kıyas üreticisi aynı çiziciyi kullanır.
const generator = fs.readFileSync("scripts/generate-player-comparison-pages.mjs", "utf8");
assert.ok(generator.includes('require("../player-comparison-data.js")'));
assert.ok(generator.includes("data/player-comparison-data.json"));

// Mobil öncelik: 390px'i aşan sabit genişlik yok; çok sütun yalnızca medya sorgusunda.
const css = fs.readFileSync("player-comparison-data.css", "utf8");
assert.ok(!/(?:^|[;{])\s*(?:min-)?width\s*:\s*(?:[4-9]\d{2}|\d{4,})px/.test(css), "sabit geniş genişlik yok");
const base = css.split("@media")[0];
assert.ok(/\.pcd-toolbar\{[^}]*grid-template-columns:1fr/.test(base), "390px'te tek sütun seçim");
assert.ok(/\.pcd-cards\{[^}]*grid-template-columns:1fr/.test(base), "390px'te tek sütun kart");
assert.equal(fs.readFileSync("public/player-comparison-data.js", "utf8"), fs.readFileSync("player-comparison-data.js", "utf8"));
assert.equal(fs.readFileSync("public/player-comparison-data.css", "utf8"), fs.readFileSync("player-comparison-data.css", "utf8"));

console.log("player comparison page tests passed");
