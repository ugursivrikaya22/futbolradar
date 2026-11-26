/**
 * PROFİL KAHRAMAN ŞERİDİ — TAHMİNİ PUAN YAYIMLANMAZ.
 *
 * Bildirilen: Mohamed Khalil sayfasında "Overall 15 (tahmini)". Şerit puanı
 * `player.overallRating`'den doğrudan okuyup "estimated" kayda "(tahmini)"
 * ekleyerek basıyordu; yayımlanan profillerin tamamında aynı desen vardı.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { publicPlayerView, publishedOverallLabel, OVERALL_NO_DATA_LABEL } = require("../services/cardCredibility.js");
const { getPlayers } = require("../services/playerService.js");

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

test("metin: kapıdan geçen puan sayı olarak, geçmeyen 'Yeterli veri yok'", () => {
  assert.equal(OVERALL_NO_DATA_LABEL, "Overall: Yeterli veri yok");
  assert.equal(publishedOverallLabel({ fields: { overallRating: 81 } }), "Overall 81");
  assert.equal(publishedOverallLabel({ fields: { aiRating: 74 } }), "Overall 74");
  assert.equal(publishedOverallLabel({ fields: {} }), OVERALL_NO_DATA_LABEL);
  assert.equal(publishedOverallLabel(null), OVERALL_NO_DATA_LABEL);
  assert.ok(!/tahmini/i.test(publishedOverallLabel({ fields: { overallRating: 15 } })), "'(tahmini)' eki olmamalı");
});

test("gerçek veri: tahmini (estimated) puan sayı olarak çıkmaz, doğrulanmış çıkar", () => {
  const verified = getPlayers().map((player) => ({ player, view: publicPlayerView(player) })).filter(({ view }) => view.verified);
  assert.ok(verified.length > 50, "kapıdan geçen profil bulunmalı (test boş geçmesin)");
  for (const { player } of verified.slice(0, 200)) {
    const base = { ...player, overallRating: 15, aiRating: 15, rating: 15 };
    for (const status of ["estimated", "pending", "stale", ""]) {
      const label = publishedOverallLabel(publicPlayerView({ ...base, ratingStatus: status }));
      assert.equal(label, OVERALL_NO_DATA_LABEL, `${player.id} (${status || "boş"}): tahmini puan yayımlanmamalı → ${label}`);
    }
    for (const status of ["verified", "current"]) {
      assert.equal(publishedOverallLabel(publicPlayerView({ ...base, ratingStatus: status })), "Overall 15", `${player.id} (${status})`);
    }
  }
});

test("üretici: şerit kapıdan geçen etiketi kullanır, ham alanı ve '(tahmini)' ekini basmaz", () => {
  const src = fs.readFileSync("scripts/generate-player-profile-pages.mjs", "utf8");
  assert.ok(src.includes("publishedOverallLabel(view)"));
  assert.ok(!src.includes('" (tahmini)"'), "'(tahmini)' eki üreticide kalmamalı");
  const hero = src.slice(src.indexOf('<span class="hero-meta">${escapeHtml(overall)}'), src.indexOf('<span class="hero-meta">${escapeHtml(overall)}') + 160);
  assert.ok(hero.includes("escapeHtml(overall)"));
  assert.ok(!/player\.(overallRating|aiRating|rating)/.test(hero), "şerit ham puan alanını okumamalı");
});

test("istemci: 'Rating Modeli' puanları doğrulanmadan sayı basmaz", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const start = app.indexOf('profileSectionHtml("Rating Modeli", [');
  assert.ok(start > 0);
  const block = app.slice(start, app.indexOf("]) +", start));
  const rows = block.split("\n").filter((line) => line.includes("profileItemHtml("));
  assert.equal(rows.length, 8);
  for (const row of rows) {
    assert.ok(row.includes("verifiedRatingValue(player,"), `doğrulama kapısı yok: ${row.trim()}`);
    assert.ok(row.includes('"Yeterli veri yok"'), `'Yeterli veri yok' yedeği yok: ${row.trim()}`);
  }
  assert.equal(fs.readFileSync("app.js", "utf8"), fs.readFileSync("public/app.js", "utf8"), "public/app.js senkron değil");
});

console.log(`profile overall rating: ${passed} test geçti`);
