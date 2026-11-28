/**
 * PUAN DURUMU "SON GÜNCELLEME"
 *
 * Söz: tarih VERİNİN tarihidir (derleme anı değil) ve uydurulmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatUpdatedAt, standingsFreshness, standingsUpdatedHtml } from "./lib/standingsFreshness.mjs";

const rows = [
  { name: "A", played: 11, lastStandingsSyncedAt: "2026-11-08T21:30:00.000Z" },
  { name: "B", played: 10, lastStandingsSyncedAt: "2026-11-05T00:52:14.371Z" },
  { name: "C", played: 11 }
];

// En yeni veri tarihi ve en çok oynanan maç seçilir.
assert.deepEqual(standingsFreshness(rows), { iso: "2026-11-08T21:30:00.000Z", week: 11 });
// Veri tarihi yoksa tarih uydurulmaz.
assert.equal(standingsFreshness([{ played: 3 }]), null);
assert.equal(standingsUpdatedHtml([{ played: 3 }], "tr"), "");
assert.equal(standingsUpdatedHtml([], "tr"), "");

// Biçim İstanbul saatiyle: 21:30Z → 00:30 ertesi gün.
assert.equal(formatUpdatedAt("2026-11-08T21:30:00.000Z", "tr"), "9 Kasım 2026 00:30 TSİ");
assert.equal(formatUpdatedAt("2026-11-08T21:30:00.000Z", "en"), "9 November 2026, 00:30 TRT");

const tr = standingsUpdatedHtml(rows, "tr");
assert.match(tr, /Son güncelleme: <time datetime="2026-11-08T21:30:00\.000Z">9 Kasım 2026 00:30 TSİ<\/time> · 11\. hafta sonrası/);
const en = standingsUpdatedHtml(rows, "en");
assert.match(en, /Last updated: <time datetime="2026-11-08T21:30:00\.000Z">/);
assert.match(en, /after matchweek 11/);

// Takım puan durumu üreticileri yardımcıyı gerçekten kullanıyor (TR + EN).
for (const file of ["generate-team-standings-pages.mjs", "generate-en-team-standings-pages.mjs"]) {
  const src = fs.readFileSync(path.join("scripts", file), "utf8");
  assert.match(src, /standingsUpdatedHtml\(sorted, "(tr|en)"\)/, `${file}: görünen güncelleme tarihi basılmalı`);
  assert.match(src, /dateModified/, `${file}: şemada dateModified olmalı`);
}

console.log("Puan durumu tazelik testleri geçti.");
