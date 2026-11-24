#!/usr/bin/env node
/**
 * FIFA erkek sıralaması: resmî 18 Kasım 2026 tablosundan doğrulanan sabitler.
 * Puanlar api.fifa.com rankingsbyschedule (FRS_Male_Football_20261007) değerlerinin
 * 2 ondalık gösterimidir. UEFA katsayı dosyasına bakmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readFifaMenRanking, renderFifaMenRankingBlock } from "./lib/fifaMenRankingTable.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const data = readFifaMenRanking(root);
assert.ok(data, "data/fifa-men-world-ranking.json okunamadı");
assert.equal(data.asOf, "2026-11-18");
assert.equal(data.asOfLabel, "18 Kasım 2026");
assert.equal(data.nextUpdate, "2026-12-16");
assert.equal(data.nextUpdateLabel, "16 Aralık 2026");
assert.equal(data.sourceUrl, "https://inside.fifa.com/fifa-rankings/world-ranking/men");
assert.equal(data.rankingScheduleId, "FRS_Male_Football_20261007");
assert.equal(data.rows.length, 211);
assert.deepEqual(data.rows.map((r) => r.rank), Array.from({ length: 211 }, (_, i) => i + 1));

const expected = [
  [1, "ESP", "Spain", 2004.48, 0],
  [2, "ARG", "Argentina", 1966.13, 0],
  [3, "FRA", "France", 1950.82, 0],
  [4, "ENG", "England", 1938.9, 0],
  [5, "MAR", "Morocco", 1809.37, 2],
  [6, "POR", "Portugal", 1801.28, -1],
  [7, "BRA", "Brazil", 1800.91, -1],
  [8, "BEL", "Belgium", 1790.37, 0],
  [9, "NED", "Netherlands", 1774.06, 0],
  [10, "COL", "Colombia", 1735.9, 1]
];
for (const [rank, code, name, points, change] of expected) {
  const row = data.rows[rank - 1];
  assert.equal(row.rank, rank);
  assert.equal(row.countryCode, code);
  assert.equal(row.country, name);
  assert.equal(row.points, points);
  assert.equal(row.rankChange, change);
}

const tur = data.rows.find((r) => r.countryCode === "TUR");
assert.equal(tur.country, "Türkiye");
assert.equal(tur.rank, 33);
assert.equal(tur.previousRank, 31);
assert.equal(tur.rankChange, -2);
assert.equal(tur.points, 1556.22);

const block = renderFifaMenRankingBlock(data);
assert.match(block, /data-fifa-as-of="2026-11-18"/);
assert.match(block, /Türkiye 33\. sırada, 1556,22 puan/);
assert.match(block, /İspanya|Spain/);
assert.match(block, /2004,48/);
assert.match(block, /16 Aralık 2026/);
assert.match(block, /rel="nofollow noopener noreferrer"/);
assert.match(block, /https:\/\/inside\.fifa\.com\/fifa-rankings\/world-ranking\/men/);

for (const file of ["uefa-ulke-puani-siralamasi.html", "public/uefa-ulke-puani-siralamasi.html"]) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  assert.match(html, /id="fifa-erkek-dunya-siralamasi"/, `${file} FIFA tablosunu içermeli`);
  assert.match(html, /data-fifa-as-of="2026-11-18"/, file);
  assert.match(html, /Türkiye 33\. sırada, 1556,22 puan/, file);
  assert.match(html, /data-uefa-as-of="2026-10-22"/, `${file} UEFA tarihi değişmemeli`);
  assert.match(html, /52,275/, `${file} UEFA Türkiye puanı değişmemeli`);
}

console.log("fifa-men-ranking OK");
