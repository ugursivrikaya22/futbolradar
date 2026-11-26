/**
 * Karşılaştırma kartlarında ASCII'ye düşmüş Türkçe metin kalmamalı.
 *
 * Bildirilen: "Akilli eslesme", "yakinligi", "diger profili", "Rating sinavi",
 * "farkini". Kartlar iki yerde üretiliyor — sunucu tarafı (profil/kıyas sayfası
 * üreticileri) ve tarayıcı tarafı (app.js, app-compare.js) — ikisi de taranır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { profileCompareCandidates, positionGroupLabel, playerPositionGroup } = require("../services/playerComparisonPairs.js");

const BANNED = [
  "Akilli eslesme", "yakinligi", "yakinligina", "diger profili", "Rating sinavi",
  "farkini", "Karsilastirma Merkezi", "Takim oyuncularini"
];
const files = [
  "app.js", "app-compare.js", "public/app.js", "public/app-compare.js",
  "services/playerComparisonPairs.js", "scripts/generate-player-comparison-pages.mjs"
];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const word of BANNED) {
    assert.ok(!text.includes(word), `${file}: ASCII metin kalmış: "${word}"`);
  }
}

// Üreticideki kıyas dizini kartı da ASCII kalmamalı.
const gen = fs.readFileSync("scripts/generate-player-comparison-pages.mjs", "utf8");
for (const word of ["${playerPositionGroup(left)} eslesmesi", "Rating farki ${", "tarafinda onde gorunuyor", "Mevki yakinda"]) {
  assert.ok(!gen.includes(word), `üretici: ASCII metin kalmış: "${word}"`);
}

// Konum bilgisi tanınmayan oyuncu "diger" anahtarına düşer; ekranda "diğer" yazmalı.
const odd = { id: "odd", position: "Teknik direktör", rating: 60, team: "X" };
assert.equal(playerPositionGroup(odd), "diger", "karşılaştırma anahtarı değişmemeli");
assert.equal(positionGroupLabel(odd), "diğer");
assert.equal(positionGroupLabel({ position: "Kaleci" }), "kaleci");

const pool = [odd, 1, 2, 3, 4].map((v, i) => (i === 0 ? v : { id: `p${v}`, position: "Teknik direktör", rating: 60 + v, team: "Y" }));
const cards = profileCompareCandidates(odd, pool);
const labels = cards.map((c) => `${c.label} ${c.note}`).join(" | ");
assert.ok(!/\bdiger\b/.test(labels), `kart metninde "diger" kalmış: ${labels}`);
assert.ok(cards.some((c) => c.label === "Akıllı eşleşme"), "Akıllı eşleşme kartı yok");

// Public kopyaları köklerle aynı olmalı (sync-public-assets).
for (const f of ["app.js", "app-compare.js"]) {
  assert.equal(fs.readFileSync(f, "utf8"), fs.readFileSync(`public/${f}`, "utf8"), `public/${f} senkron değil`);
}
console.log("comparison Turkish copy OK");
