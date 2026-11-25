#!/usr/bin/env node
/**
 * OYUNCU PROFİLİ İNDEKS KAPISI — Türkçe ve İngilizce AYNI TANIMI kullanır.
 *
 * Diskteki üretilmiş sayfaya BAĞLI DEĞİL (derlemeden önce de çalışır).
 *   node scripts/test-en-player-indexing.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hasSubstantivePlayerContent } from "./lib/playerIndexing.mjs";

const root = process.cwd();
const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.log(`  FAIL ${name} — ${error.message.split("\n")[0]}`);
    failures.push(name);
  }
}

console.log("en-player-indexing");

// --- 1. İşlev: yalnızca ad + mevki ince, her kaynaklı bölüm yeterli --------
const thin = {
  profileEvidence: { matches: [] },
  seasonStats: { available: false },
  matchLog: { available: false },
  career: { rows: [] },
  transfers: { rows: [] },
  news: { transfer: [], general: [] },
  honours: { rows: [] },
  availability: { available: false }
};

check("model yok ya da yalnızca ad + mevki → ince", () => {
  assert.equal(hasSubstantivePlayerContent(null), false);
  assert.equal(hasSubstantivePlayerContent(thin), false);
});

const withSection = {
  "kanıtlı maç": { profileEvidence: { matches: [{ id: 1 }] } },
  "sezon istatistiği": { seasonStats: { available: true } },
  "maç günlüğü": { matchLog: { available: true } },
  "kariyer": { career: { rows: [{ season: "2025" }] } },
  "transfer": { transfers: { items: [{ date: "2026-08-01" }] } },
  "haber": { news: { transfer: [], general: [{ title: "x" }] } },
  "madalya": { honours: { available: true } },
  "kadro durumu": { availability: { available: true } }
};
for (const [label, patch] of Object.entries(withSection)) {
  check(`${label} varsa içerik yeterli`, () => {
    assert.equal(hasSubstantivePlayerContent({ ...thin, ...patch }), true);
  });
}

// --- 2. İki üretici TEK tanımı kullanıyor, ayrışma yok --------------------
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const tr = read("scripts/generate-player-profile-pages.mjs");
const en = read("scripts/generate-en-player-pages.mjs");

check("Türkçe üretici ortak işlevi içe aktarıyor, yerelde tanımlamıyor", () => {
  assert.match(tr, /import \{ hasSubstantivePlayerContent \} from "\.\/lib\/playerIndexing\.mjs"/);
  assert.doesNotMatch(tr, /function hasSubstantivePlayerContent/);
});
check("İngilizce üretici ortak işlevi içe aktarıyor, yerelde tanımlamıyor", () => {
  assert.match(en, /import \{ hasSubstantivePlayerContent \} from "\.\/lib\/playerIndexing\.mjs"/);
  assert.doesNotMatch(en, /function hasSubstantivePlayerContent/);
});
check("İngilizce indeks kararı yalnızca `verified` değil, ortak kapıyı da içeriyor", () => {
  assert.match(en, /const indexable = view\.verified === true \|\| hasSubstantivePlayerContent\(model\);/);
  assert.doesNotMatch(en, /const indexable = view\.verified === true;/);
});
check("Türkçe indeks kararı ortak kapıyı kullanıyor", () => {
  assert.match(tr, /hasSubstantivePlayerContent\(model\)/);
});

// --- 3. "Yalnızca doğrulanmış oyuncular" kuralı kalktı ---------------------
check("İngilizce üretici doğrulanmamış oyuncuyu da seçiyor (includeUnverified)", () => {
  assert.match(en, /englishProfilePlayers\(players, playerUrls, publicPlayerView, \{ includeUnverified: true \}\)/);
});
check("ince içerikli sayfa noindex basılıyor, site haritasına girmiyor", () => {
  assert.match(en, /indexable \? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW/);
  assert.match(en, /if \(!result\.indexable\) continue;/);
});

if (failures.length) {
  console.error(`\nen-player-indexing FAILED (${failures.length}):`);
  failures.forEach((name) => console.error(`  - ${name}`));
  process.exit(1);
}
console.log("\nen-player-indexing passed");
