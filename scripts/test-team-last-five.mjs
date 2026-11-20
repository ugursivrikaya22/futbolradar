#!/usr/bin/env node
/**
 * UZUN KUYRUK BÖLÜMLERİ — "<takım> son 5 maç" ve "<takım> kaçıncı sırada".
 *
 * Yeni adres açılmaz; iki sorgu da zaten o niyeti taşıyan sayfalarda çapalı
 * bölüm olarak cevaplanır (takım maçları → #son-5-mac, takım puan durumu →
 * #kacinci-sirada). Bu test:
 *   1. son 5 maç seçiminin yalnızca bitmiş, skorlu, resmî maçları aldığını,
 *      çift kaydı tekilleştirdiğini ve sonucu skordan hesapladığını,
 *   2. bilanço cümlesinin satırlarla birebir tuttuğunu,
 *   3. üreticilerin çapaları, soru biçimli H2'yi ve künyeyi bastığını
 * doğrular.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { lastFiveMatches, lastFiveSummary, allFromApiFootball } from "./lib/teamLastFive.mjs";

const require = createRequire(import.meta.url);
const { sameClub } = require("../services/superLigTeams.js");
const { canonicalStatus, istanbulDay } = require("../services/matchStatus.js");
const root = process.cwd();
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

const team = { name: "Galatasaray" };
const fin = (kickoff, homeTeam, awayTeam, home, away, extra = {}) => ({ kickoff, homeTeam, awayTeam, status: "FINISHED", score: { home, away }, league: "Süper Lig", source: "api-football", ...extra });
const calendar = [
  fin("2026-11-07T19:00:00+03:00", "Galatasaray", "Amed Sportif Faaliyetler", 3, 1),
  fin("2026-10-30T20:00:00+03:00", "Konyaspor", "Galatasaray", 0, 4),
  fin("2026-10-26T21:30:00+03:00", "Galatasaray", "Fenerbahçe", 2, 1),
  fin("2026-10-13T22:00:00+03:00", "Galatasaray", "Barcelona", 1, 4, { league: "Şampiyonlar Ligi" }),
  fin("2026-07-17T21:00:00+03:00", "Ümraniyespor", "Galatasaray", 1, 5, { league: "Hazırlık Maçı" }),
  { kickoff: "2026-11-21T16:00:00+03:00", homeTeam: "Galatasaray", awayTeam: "Samsunspor", status: "SCHEDULED", score: { home: null, away: null }, league: "Süper Lig" },
  fin("2026-10-20T19:00:00+03:00", "Galatasaray", "Eyüpspor", null, null),
  fin("2026-10-09T20:00:00+03:00", "Galatasaray U19", "Kasımpaşa U19", 2, 0)
];
const reports = [
  // Takvimdeki maçın rapor kopyası → tek satır kalmalı.
  fin("2026-10-26T21:30:00+03:00", "Galatasaray", "Fenerbahçe", 2, 1, { provider: "api-football", seo: { path: "mac-raporu/galatasaray-fenerbahce-2026-10-26.html" } }),
  fin("2026-10-17T19:00:00+03:00", "Gençlerbirliği", "Galatasaray", 0, 1, { provider: "api-football", seo: { path: "mac-raporu/genclerbirligi-galatasaray-2026-10-17.html" } }),
  fin("2026-10-04T19:00:00+03:00", "Galatasaray", "Kasımpaşa", 3, 1, { provider: "curated", seo: { path: "mac-raporu/x.html" } })
];
const rows = lastFiveMatches({ team, calendar, reports, sameClub, canonicalStatus, istanbulDay });

check("yalnızca bitmiş, skorlu, resmî maçlar; en yeni önde; en çok 5", () => {
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((row) => row.kickoff.slice(0, 10)), ["2026-11-07", "2026-10-30", "2026-10-26", "2026-10-17", "2026-10-13"]);
  assert.ok(!rows.some((row) => /Hazırlık/.test(row.league)), "hazırlık maçı girmemeli");
  assert.ok(!rows.some((row) => row.homeTeam.includes("U19")), "altyapı maçı girmemeli");
});

check("aynı maçın takvim + rapor kopyası tek satır; takvim kaydı önde", () => {
  const derby = rows.filter((row) => row.awayTeam === "Fenerbahçe");
  assert.equal(derby.length, 1);
  assert.equal(derby[0].origin, "calendar");
});

check("sonuç ve goller tabeladaki skordan, takım tarafına göre", () => {
  const away = rows.find((row) => row.homeTeam === "Konyaspor");
  assert.equal(away.result, "G");
  assert.equal(away.goalsFor, 4);
  assert.equal(away.goalsAgainst, 0);
  assert.equal(away.venue, "Deplasman");
  assert.equal(rows.find((row) => row.awayTeam === "Barcelona").result, "M");
});

check("bilanço cümlesi satırlarla tutarlı", () => {
  const summary = lastFiveSummary(rows, "Galatasaray");
  assert.equal(summary.won + summary.drawn + summary.lost, rows.length);
  assert.equal(summary.points, summary.won * 3 + summary.drawn);
  assert.equal(summary.sentence, "Galatasaray son 5 resmî maçında 4 galibiyet, 0 beraberlik, 1 mağlubiyet aldı; 11 gol attı, 6 gol yedi.");
  assert.equal(lastFiveSummary([], "Galatasaray"), null);
});

check("künye: hepsi API-Football ise yalnızca 'Veri: API-Football'", () => {
  assert.equal(allFromApiFootball(rows), true);
  assert.equal(allFromApiFootball([{ provider: "curated" }]), false);
  assert.equal(allFromApiFootball([]), false);
});

check("takım maçları üreticisi #son-5-mac bölümünü ve boş hâli basar", () => {
  const src = fs.readFileSync(path.join(root, "scripts", "generate-team-match-pages.mjs"), "utf8");
  assert.match(src, /id="son-5-mac"/);
  assert.match(src, /<h2 id="son-5-mac-title">\$\{escapeHtml\(heading\)\}<\/h2>/);
  assert.match(src, /const heading = `\$\{team\.name\} son 5 maç`;/);
  assert.match(src, /<strong>Güncelleniyor<\/strong>/);
  assert.match(src, /Veri: API-Football/);
});

check("puan durumu üreticisi #kacinci-sirada soru H2'sini basar", () => {
  const src = fs.readFileSync(path.join(root, "scripts", "generate-team-standings-pages.mjs"), "utf8");
  assert.match(src, /id="kacinci-sirada"/);
  assert.match(src, /\$\{escapeHtml\(team\.name\)\} kaçıncı sırada\?<\/h2>/);
  assert.match(src, /Veri: API-Football/);
  assert.match(src, /"Güncelleniyor"/);
});

check("yeni adres yok: iki sorgu için ayrı sayfa üreticisi eklenmedi", () => {
  const scripts = fs.readdirSync(path.join(root, "scripts"));
  assert.ok(!scripts.some((name) => /son-5-mac|kacinci-sirada/.test(name)));
});

console.log(`test-team-last-five: ${passed} kontrol geçti`);
