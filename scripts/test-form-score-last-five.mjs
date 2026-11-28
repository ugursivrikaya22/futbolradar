#!/usr/bin/env node
/**
 * Form sıralaması son 5 lig maçının gerçek sonucuna uyar.
 *
 * Samsunspor beş maçtır yenilmişken sezon öncesi form skoru (7.5) ve
 * momentum (71) İngilizce form sıralamasında 3. sırada kalıyordu. Skor,
 * kayıtlı sonuç dizisinden hesaplanır; beş mağlubiyet 0 form skorudur ve
 * ilk üçe girmez. Türkçe form tablosu aynı hesabı kullanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { lastFiveMatches } from "./lib/teamLastFive.mjs";

const require = createRequire(import.meta.url);
const { sameClub } = require("../services/superLigTeams.js");
const { canonicalStatus, istanbulDay } = require("../services/matchStatus.js");
const { withLiveFormScores } = require("../services/trendTeams.js");
const { mergeStandings } = require("./sync-standings.mjs");

const root = process.cwd();
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

const teams = read("data/teams.json");
const matches = read("data/matches.json");
const calendar = read("data/fixture-calendar.json").matches || [];
const store = read("data/post-match-reports.json");
const reports = Array.isArray(store) ? store : (store.records || store.reports || []);

function leagueLastFive(name) {
  const rows = lastFiveMatches({
    team: { name },
    calendar,
    reports,
    sameClub,
    canonicalStatus,
    istanbulDay,
    limit: 15
  });
  return rows.filter((row) => /süper lig/i.test(row.league)).slice(0, 5);
}

const samsunResults = leagueLastFive("Samsunspor");

check("Samsunspor'un depodaki son 5 lig maçı beş mağlubiyet", () => {
  assert.equal(samsunResults.length, 5);
  assert.deepEqual(samsunResults.map((row) => row.result), ["M", "M", "M", "M", "M"]);
  assert.deepEqual(
    samsunResults.map((row) => [row.kickoff.slice(0, 10), row.homeTeam, row.score.home, row.score.away, row.awayTeam]),
    [
      ["2026-11-01", "Başakşehir", 5, 2, "Samsunspor"],
      ["2026-10-24", "Samsunspor", 1, 2, "Amed Sportif Faaliyetler"],
      ["2026-10-18", "Kasımpaşa", 4, 1, "Samsunspor"],
      ["2026-10-10", "Samsunspor", 0, 3, "Trabzonspor"],
      ["2026-09-20", "Erzurumspor FK", 1, 0, "Samsunspor"]
    ]
  );
});

check("kayıtlı form dizisi lig son 5'iyle aynı (ev/deplasman tarafı doğru)", () => {
  for (const name of ["Samsunspor", "Galatasaray", "Fenerbahçe", "Trabzonspor", "Beşiktaş", "Göztepe"]) {
    const team = teams.find((item) => item.name === name);
    const fromMatches = leagueLastFive(name).map((row) => row.result).join("");
    const stored = (team.form || []).map((item) => item.label).join("");
    assert.equal(stored, fromMatches, `${name}: form dizisi maç sonuçlarıyla uyuşmuyor`);
  }
});

const ranked = withLiveFormScores(teams, matches)
  .slice()
  .sort((left, right) => right.formScore - left.formScore || right.momentum - left.momentum || left.name.localeCompare(right.name, "tr"));
const byName = (name) => ranked.find((team) => team.name === name);
const place = (name) => ranked.findIndex((team) => team.name === name) + 1;

check("beş mağlubiyetin form skoru 0 ve Samsunspor ilk üçte değil", () => {
  const row = byName("Samsunspor");
  assert.equal(row.formScore, 0);
  assert.notEqual(row.momentum, 71);
  assert.ok(row.momentum < 40, `beş mağlubiyet 71 momentum üretmemeli, üretilen ${row.momentum}`);
  assert.ok(place("Samsunspor") > 3, `sıra ${place("Samsunspor")}`);
});

check("karışık formlu takımların skoru puanla uyumlu ve Samsunspor'un üstünde", () => {
  assert.equal(byName("Trabzonspor").formScore, 10);
  assert.equal(byName("Galatasaray").formScore, 8);
  assert.equal(byName("Fenerbahçe").formScore, 6);
  assert.equal(byName("Beşiktaş").formScore, 4.7);
  assert.equal(byName("Göztepe").formScore, 8.7);
  assert.ok(place("Trabzonspor") < place("Samsunspor"));
  assert.ok(place("Galatasaray") < place("Samsunspor"));
  assert.ok(place("Fenerbahçe") < place("Samsunspor"));
});

check("puan senkronu beş mağlubiyette sezon öncesi 71'i taşımaz", () => {
  const stale = {
    id: "samsunspor",
    providerId: "3603",
    name: "Samsunspor",
    formScore: 7.5,
    momentum: 71,
    attack: 74,
    defense: 67,
    rank: 17,
    played: 10,
    points: 4,
    goalDifference: -16,
    form: Array.from({ length: 5 }, () => ({ label: "M", result: "loss" }))
  };
  const standing = {
    providerId: "3603",
    team: "Samsunspor",
    rank: 17,
    played: 10,
    won: 1,
    drawn: 1,
    lost: 8,
    goalsFor: 10,
    goalsAgainst: 26,
    goalDifference: -16,
    points: 4,
    average: -16,
    form: ["L", "L", "L", "L", "L"]
  };
  const merged = mergeStandings([stale], [standing], {
    nowIso: "2026-11-06T02:20:43.916Z",
    season: "2026/27",
    matches: []
  });
  assert.equal(merged.teams[0].formScore, 0);
  assert.notEqual(merged.teams[0].momentum, 71);
  assert.deepEqual(merged.teams[0].form.map((item) => item.result), ["loss", "loss", "loss", "loss", "loss"]);
});

function panel(html, id) {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start >= 0, id);
  return html.slice(start, start + 4000);
}

check("İngilizce takım formu sıralamasında Samsunspor 71 ile 3. değil", () => {
  const html = fs.readFileSync(path.join(root, "en/index.html"), "utf8");
  const teamForm = panel(html, "leaders-panel-team");
  assert.doesNotMatch(teamForm, /Samsunspor<\/strong><span>Form<\/span><\/a><span class="leaders-value">71<\/span>/);
  const names = [...teamForm.matchAll(/<strong>([^<]+)<\/strong><span>Form<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(names.slice(0, 3), ["Trabzonspor", "Galatasaray", "Amed"]);
  assert.ok(!names.slice(0, 3).includes("Samsunspor"));
});

check("İngilizce momentum sayfası Samsunspor'a 0 form skoru basar", () => {
  const html = fs.readFileSync(path.join(root, "en/momentum.html"), "utf8");
  const block = html.slice(html.indexOf("samsunspor.html"), html.indexOf("samsunspor.html") + 700);
  assert.match(block, /momentum-number">21</);
  assert.match(block, /Form score <b>0<\/b>/);
  assert.doesNotMatch(block, /momentum-number">71</);
  assert.doesNotMatch(block, /Form score <b>7\.5<\/b>/);
});

check("Türkçe form tablosu aynı skoru kullanır", () => {
  const html = fs.readFileSync(path.join(root, "form-tablosu/super-lig.html"), "utf8");
  const row = html.slice(html.indexOf(">Samsunspor<"), html.indexOf(">Samsunspor<") + 500);
  assert.match(row, /<td>0<\/td>/);
  assert.doesNotMatch(row, /<td>7\.5<\/td>/);
  assert.doesNotMatch(row, /<td>71<\/td>/);
  const order = [...html.matchAll(/<th scope="row">(?:<a[^>]*>)?([^<]+)/g)].map((match) => match[1]);
  assert.ok(order.indexOf("Trabzonspor") < order.indexOf("Samsunspor"));
  assert.ok(order.indexOf("Samsunspor") > 2);
});

console.log(`test-form-score-last-five: ${passed} kontrol geçti`);
