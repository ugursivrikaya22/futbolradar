/**
 * Ana sayfa "Momentumu yükselen takımlar" + "Takım Formu" — canlı momentum.
 *
 * 1. Son 5 maçını kaybetmiş takım "yükselen" ilk 3'te olamaz.
 * 2. Hesaplanamayan takım listeye girmez (kartta "–" yok).
 * 3. Prerender ve istemci aynı kaynaktan (/api/momentum hesabı) aynı sırayı
 *    ve sayıları verir; hücum/savunma alt metrikleri gösterilmez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { liveTeamMomentum } = require("../services/trendTeams.js");
const { computeLeagueMomentum } = require("../services/momentumService.js");
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, "data", name), "utf8"));
const teams = read("teams.json");
const matches = read("matches.json");
let passed = 0;
const ok = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

console.log("home-trend-momentum");

const loss = { label: "M", result: "loss" };
const win = { label: "G", result: "win" };
// Bayat, yüksek sezon öncesi alanları taşıyan ama 5 maçtır kaybeden takım.
const synthetic = [
  { id: "a", name: "A", league: "Süper Lig", form: [win, win, win, win, win], goalDifference: 8 },
  { id: "b", name: "B", league: "Süper Lig", form: [win, loss, win, win, win], goalDifference: 4 },
  { id: "c", name: "C", league: "Süper Lig", form: [win, win, loss, win, loss], goalDifference: 2 },
  { id: "d", name: "D", league: "Süper Lig", form: [loss, win, loss, win, win], goalDifference: 0 },
  { id: "s", name: "S", league: "Süper Lig", form: [loss, loss, loss, loss, loss], goalDifference: -9, momentum: 99, attack: 99, defense: 99, formScore: 9.9 },
  { id: "x", name: "X", league: "Süper Lig" }
];

ok("son 5 maçını kaybeden takım ilk 3 yükselen arasında değil (sentetik)", () => {
  const rows = liveTeamMomentum(synthetic, []);
  assert.ok(!rows.slice(0, 3).some((row) => row.team === "S"), rows.map((r) => `${r.team}:${r.momentum}`).join(", "));
});

ok("hesaplanamayan takım listeye girmez", () => {
  const rows = liveTeamMomentum(synthetic, []);
  assert.ok(!rows.some((row) => row.team === "X"));
  for (const row of rows) assert.ok(Number.isFinite(Number(row.momentum)), `${row.team} momentum sayı değil`);
});

const live = liveTeamMomentum(teams, matches);
ok("gerçek veri: LLLLL formlu hiçbir takım ilk 3'te değil", () => {
  for (const row of live.slice(0, 3)) {
    assert.notDeepEqual(row.form, ["L", "L", "L", "L", "L"], `${row.team} 5 yenilgiyle ilk 3'te`);
  }
});

ok("gerçek veri: /api/momentum ile aynı sıra ve sayılar, tüm Süper Lig takımları", () => {
  const list = Array.isArray(teams) ? teams : teams.teams;
  const api = computeLeagueMomentum(list, matches, list);
  assert.deepEqual(live.map((r) => [r.team, r.momentum, r.formScore]), api.map((r) => [r.team, r.momentum, r.formScore]));
  const superLig = list.filter((team) => team.league === "Süper Lig").map((team) => team.name).sort();
  assert.deepEqual(live.map((r) => r.team).sort(), superLig, "her Süper Lig takımı hesaplanmalı");
});

ok("istemci yedeği data/momentum.json aynı sırayı taşıyor", () => {
  const fallback = read("momentum.json");
  assert.deepEqual(fallback.map((r) => [r.team, r.momentum, r.formScore]), live.map((r) => [r.team, r.momentum, r.formScore]),
    "data/momentum.json bayat: node scripts/sync-momentum-data.mjs");
});

ok("istemci şeridi /api/momentum'dan çiziyor ve hücum/savunma göstermiyor", () => {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(app, /data-api-target="home-trend-teams"\]'\),\s*"momentum",\s*renderTrendTeams/);
  const fn = app.slice(app.indexOf("function renderTrendTeams("), app.indexOf("function renderTrendTeams(") + 2500);
  assert.doesNotMatch(fn, /<dt>Hücum<\/dt>|<dt>Savunma<\/dt>/);
});

ok("prerender edilmiş ana sayfa canlı sırayla ve '–' olmadan", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const block = html.split("<!-- prerender:home-trend-teams:start -->")[1]?.split("<!-- prerender:home-trend-teams:end -->")[0];
  if (!block) { console.log("    (index.html'de işaretçi yok, atlandı)"); return; }
  const names = [...block.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m) => m[1]);
  const scores = [...block.matchAll(/trend-card-score">([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(names, live.slice(0, 8).map((r) => r.team.replace(/&/g, "&amp;")));
  assert.deepEqual(scores, live.slice(0, 8).map((r) => String(r.momentum)));
  assert.doesNotMatch(block, />–</);
  assert.doesNotMatch(block, /Hücum|Savunma/);
});

console.log(`home-trend-momentum OK (${passed} denetim)`);
