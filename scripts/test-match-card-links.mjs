#!/usr/bin/env node
/**
 * MAÇ KARTI İÇ BAĞLANTILARI — app.js içindeki `match-card-links` bloğu
 * ayıklanıp örnek maçlarla çalıştırılır: her bağlantı gerçek bir sayfaya
 * gider, iç içe <a> yoktur, Süper Lig dışı maçta İstatistik düğmesi çıkmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const block = app.match(/\/\/ match-card-links:start([\s\S]*?)\/\/ match-card-links:end/);
assert.ok(block, "app.js içinde match-card-links bloğu bulunmalı");
const server = fs.readFileSync(path.join(root, "scripts", "prerender-core-pages.mjs"), "utf8");

const { teamPageSlug } = require("../services/superLigTeamPages.js");
const { sameClub } = require("../services/superLigTeams.js");
const BIG = [
  { name: "Galatasaray", slug: "galatasaray" }, { name: "Fenerbahçe", slug: "fenerbahce" },
  { name: "Beşiktaş", slug: "besiktas" }, { name: "Trabzonspor", slug: "trabzonspor" }
];
const escapeHtml = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const build = new Function("teamPageSlug", "escapeHtml", "quickLinkTeamFor", "fixtureStatusMeta", "matchDetailHref", "teamProfileHref",
  `"use strict";${block[1]}; return quickLinkButtonsHtml;`);
const render = build(
  (name) => teamPageSlug(name),
  escapeHtml,
  (m) => BIG.find((t) => sameClub(t.name, m.homeTeam)) || BIG.find((t) => sameClub(t.name, m.awayTeam)) || null,
  (m) => ({ finished: m.status === "FINISHED" }),
  () => "./mac-detay.html?id=x",
  (name) => `./takimlar/${teamPageSlug(name)}`
);

function exists(href) {
  const clean = href.replace(/^\.\//, "").replace(/[?#].*$/, "");
  return fs.existsSync(path.join(root, clean)) || fs.existsSync(path.join(root, `${clean}.html`));
}

const cases = [
  { league: "Süper Lig", homeTeam: "Galatasaray", awayTeam: "Kocaelispor", expect: ["super-lig-puan-durumu", "takimlar/galatasaray", "istatistik-merkezi"] },
  { league: "UEFA Şampiyonlar Ligi", homeTeam: "Galatasaray", awayTeam: "Ajax", expect: ["sampiyonlar-ligi-puan-durumu", "takimlar/galatasaray"] },
  { league: "UEFA Avrupa Ligi", homeTeam: "Roma", awayTeam: "Fenerbahçe", expect: ["avrupa-ligi-puan-durumu"] },
  { league: "Hazırlık Maçı", homeTeam: "Rennes", awayTeam: "Venezia", expect: [] },
  { league: "UEFA Uluslar Ligi", homeTeam: "Türkiye", awayTeam: "Galler", expect: ["puan-durumu.html"] }
];

for (const match of cases) {
  const html = render(match);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const href of hrefs.filter((h) => !h.includes("mac-detay"))) assert.ok(exists(href), `${match.league}: ${href} var olan bir sayfa olmalı`);
  for (const want of match.expect) assert.ok(hrefs.some((h) => h.includes(want)), `${match.league}: ${want} bağlantısı olmalı (${hrefs.join(", ")})`);
  assert.equal(/<a[^>]*>[^<]*<a/.test(html), false, "iç içe <a> olmamalı");
  if (match.league !== "Süper Lig") assert.ok(!html.includes('data-quicklink="stats"'), `${match.league}: İstatistik düğmesi yalnızca Süper Lig'de`);
  if (match.league === "Hazırlık Maçı") assert.ok(!html.includes("Puan Durumu"), "hazırlık maçında puan durumu bağlantısı olmamalı");
  // Ev ve deplasman takımı profili varsa ikisi de bağlanır.
  for (const team of [match.homeTeam, match.awayTeam]) {
    if (teamPageSlug(team)) assert.ok(html.includes(`>${team}</a>`), `${team} takım bağlantısı olmalı`);
  }
}

// Sunucu (statik yedek) aynı organizasyon tablosunu taşımalı.
for (const file of ["super-lig-puan-durumu.html", "sampiyonlar-ligi-puan-durumu.html", "avrupa-ligi-puan-durumu.html", "konferans-ligi-puan-durumu.html", "1-lig-puan-durumu.html", "premier-lig-puan-durumu.html", "la-liga-puan-durumu.html", "serie-a-puan-durumu.html", "bundesliga-puan-durumu.html", "ligue-1-puan-durumu.html"]) {
  assert.ok(block[1].includes(file) && server.includes(file), `${file} istemci ve sunucu tablosunda olmalı`);
  assert.ok(fs.existsSync(path.join(root, file)), `${file} yayında olmalı`);
}
console.log("match-card-links OK");

// Menü: Transfer Radar yalnızca var olan hedefe bağlanır.
const { resolveNavHref } = await import("./lib/layout.mjs");
const { NAV_KEYS } = require("../services/i18n.js");
const trTransfer = NAV_KEYS.tr.primary.find((item) => item.key === "nav.transferRadar");
const enTransfer = NAV_KEYS.en.primary.find((item) => item.key === "nav.transferRadar");
assert.equal(trTransfer.href, "transfer-radari.html", "TR: menü ayrı Transfer Radarı sayfasına gitmeli");
assert.equal(resolveNavHref(trTransfer, () => true), "transfer-radari.html", "TR: menü hedefi koşulsuz transfer-radari.html");
assert.equal(resolveNavHref(enTransfer, () => false), null, "EN: sayfa yoksa öğe çizilmemeli");
assert.equal(resolveNavHref(enTransfer, () => true), "en/transfer-radar.html");
assert.ok(fs.existsSync(path.join(root, trTransfer.href)), "TR yedek hedef yayında olmalı");
console.log("nav transfer-radar OK");
