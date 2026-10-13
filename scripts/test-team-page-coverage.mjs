#!/usr/bin/env node
/**
 * Görev 6 — takım sayfaları koruyucusu.
 *  - Tek takım listesi 18 Süper Lig takımını kapsar, slug'lar benzersiz ve
 *    büyük 4'ün yayımlanmış slug'ları değişmemiş.
 *  - İnce içerik eşiği: oynanmış maç < MIN_PLAYED ya da tablo satırı yoksa
 *    sayfa indekslenmez.
 *  - Her takım puan durumu sayfasının temiz adresi vercel.json'da rewrite ile
 *    açılıyor ve `.html` hâli temiz adrese 301'leniyor (aksi hâlde kanonik
 *    adres canlıda 404 olur).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { TEAM_PAGE_TABLE, MIN_PLAYED, superLigTeamPages, teamPageSlug, standingsPageIndexable } = require("../services/superLigTeamPages.js");

function ok(name, fn) { fn(); console.log(`  ok  ${name}`); }
console.log("team-page-coverage");

const pages = superLigTeamPages({ root });
ok("18 Süper Lig takımı, benzersiz slug", () => {
  assert.equal(pages.length, 18, pages.map((p) => p.slug).join(","));
  assert.equal(new Set(TEAM_PAGE_TABLE.map((t) => t.slug)).size, TEAM_PAGE_TABLE.length);
  for (const t of TEAM_PAGE_TABLE) assert.match(t.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

ok("büyük 4 slug'ları değişmedi", () => {
  assert.deepEqual(TEAM_PAGE_TABLE.filter((t) => t.big).map((t) => t.slug), ["galatasaray", "fenerbahce", "besiktas", "trabzonspor"]);
});

ok("ad eşleme: kaynaktaki farklı yazımlar aynı slug'a", () => {
  assert.equal(teamPageSlug("Gençlerbirliği S.K."), "genclerbirligi");
  assert.equal(teamPageSlug("Erzurumspor FK"), "erzurumspor");
  assert.equal(teamPageSlug("Barcelona"), null, "Süper Lig dışı kulübe sayfa yok");
});

ok("ince içerik eşiği", () => {
  assert.equal(standingsPageIndexable({ played: MIN_PLAYED, rank: 5, points: 9 }), true);
  assert.equal(standingsPageIndexable({ played: MIN_PLAYED - 1, rank: 5, points: 3 }), false);
  assert.equal(standingsPageIndexable({ played: 7, rank: null, points: 9 }), false);
  assert.equal(standingsPageIndexable(null), false);
});

ok("her puan durumu sayfası canlıda temiz adresle açılır", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const rewrites = new Map((vercel.rewrites || []).map((r) => [r.source, r.destination]));
  const redirects = new Map((vercel.redirects || []).map((r) => [r.source, r]));
  for (const { slug } of pages) {
    const clean = `/${slug}-puan-durumu`;
    assert.equal(rewrites.get(clean), `${clean}.html`, `rewrite eksik: ${clean}`);
    const red = redirects.get(`${clean}.html`);
    assert.ok(red && red.destination === clean && red.permanent === true, `301 eksik: ${clean}.html`);
  }
});

console.log("team-page-coverage OK");

// Görev 6, 3. adım: takım profili (hub) eşiği.
{
  const { teamHubIndexable, MIN_SQUAD } = require("../services/superLigTeamPages.js");
  ok("hub eşiği: puan satırı + en az MIN_SQUAD oyuncu", () => {
    const row = { played: 7, rank: 3, points: 12 };
    assert.equal(teamHubIndexable(row, MIN_SQUAD), true);
    assert.equal(teamHubIndexable(row, MIN_SQUAD - 1), false);
    assert.equal(teamHubIndexable({ played: 1, rank: 3, points: 3 }, 40), false);
  });
  console.log("team-page-coverage hub OK");
}
