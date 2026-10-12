/**
 * Kıyas adresi: profil, üreticinin İLK-GELEN slug'una bağlanmalı.
 *
 * 12 Ekim 2026 tam derlemesi (38227207433, 38233263278): iki havuz kaydı aynı
 * canonicalId'yi taşıyınca üretici çifti kanonik anahtarla tekilleştirip
 * ilk slug'da üretti; profil ise kendi kimliğinden türettiği slug'a bağlandı
 * ve bağlantı denetimi yayını durdurdu.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createComparisonSlugResolver, profileCompareCandidates, canonicalPairKey } = require("../services/playerComparisonPairs.js");

const base = { position: "Forvet", league: "Süper Lig", rating: 70, marketValueEur: 1000000 };
// a1 ve a2: iki ayrı kayıt, taze veride aynı canonicalId'ye bağlanmış.
const pool = [
  { ...base, id: "a1-first", canonicalId: "a-canon", team: "A FK" },
  { ...base, id: "a2-second", canonicalId: "a-canon", team: "A FK" },
  { ...base, id: "x-peer", team: "X FK" },
  { ...base, id: "y-peer", team: "Y FK" }
];

// Üreticinin buildPairs mantığı (generate-player-comparison-pages.mjs) — ilk gelen kazanır.
const generated = new Map();
const legacy = createComparisonSlugResolver(pool);
for (const player of pool) {
  for (const item of profileCompareCandidates(player, pool)) {
    const key = canonicalPairKey(player, item.player);
    if (!generated.has(key)) generated.set(key, legacy(player, item.player));
  }
}
const generatedSlugs = new Set(generated.values());

const resolver = createComparisonSlugResolver(pool, pool);
let checked = 0;
let legacyMisses = 0;
for (const player of pool) {
  for (const item of profileCompareCandidates(player, pool)) {
    checked += 1;
    if (!generatedSlugs.has(legacy(player, item.player))) legacyMisses += 1;
    assert.ok(generatedSlugs.has(resolver(player, item.player)),
      `${player.id} → ${item.player.id} üretilmeyen bir kıyas sayfasına bağlanıyor`);
  }
}
assert.ok(legacyMisses > 0, "senaryo eski hatayı yeniden üretmeli (havuzsuz çözücü kırık slug vermeli)");
// Havuz verilmezse davranış aynen korunur.
assert.equal(createComparisonSlugResolver(pool)(pool[2], pool[3]), "x-peer-vs-y-peer");
console.log(`comparison-slug-first-come OK: ${checked} profil bağlantısı üretilen sayfalara gidiyor (eski çözücü ${legacyMisses} kırık verirdi).`);
