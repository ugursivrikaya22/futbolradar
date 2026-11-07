/**
 * 2026/27 Süper Lig istatistik listeleri Mauro Icardi'yi (ve kadroda /
 * bu sezon liginde görünmeyen diğer eski kayıtları) sıralamaya almaz.
 * Yerine sayı üretilmez; kalanlar yeniden sıralanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildSuperLigStatPool,
  isCurrentSeasonStatPlayer,
  seasonStatMetric,
  seasonLeaderboard
} = require("../services/superLigSeasonStats.js");

const root = process.cwd();
const players = JSON.parse(fs.readFileSync(path.join(root, "data/players.json"), "utf8"));
const squads = JSON.parse(fs.readFileSync(path.join(root, "data/super-lig-squads.json"), "utf8"));
const leaders = JSON.parse(fs.readFileSync(path.join(root, "data/league-leaders.json"), "utf8"));
const pool = buildSuperLigStatPool(squads, leaders);

const icardi = players.find((player) => player.id === "mauro-icardi");
const osimhen = players.find((player) => player.id === "v-osimhen-galatasaray");

assert.ok(icardi, "Icardi kaydı duruyor (profil silinmez)");
assert.equal(isCurrentSeasonStatPlayer(icardi, pool), false, "serbest oyuncu güncel havuza girmemeli");
assert.equal(seasonStatMetric(icardi, "goals", pool), null);
assert.equal(seasonStatMetric(icardi, "assists", pool), null);
assert.equal(seasonStatMetric(icardi, "xg", pool), null);
assert.equal(seasonStatMetric(icardi, "aiRating", pool), null);

assert.equal(isCurrentSeasonStatPlayer(osimhen, pool), true, "güncel kadrodaki oyuncu havuzda kalmalı");
assert.equal(seasonStatMetric(osimhen, "goals", pool), 6, "doğrulanmış gol sayısı korunmalı");
assert.equal(seasonStatMetric(osimhen, "xg", pool), null, "doğrulanmamış xG 0 liderliğe yazılmamalı");

const departedMidSeason = {
  id: "eski-golcu",
  providerId: "999001",
  name: "Eski Golcü",
  currentTeam: "Serbest oyuncu",
  goals: 4,
  appearances: 6,
  xg: 3.2,
  statsVerifiedFields: ["goals", "appearances"]
};
const leadersWithDeparture = {
  season: "2026",
  topScorers: [{ providerId: "999001", slug: "eski-golcu", name: "Eski Golcü", team: "Amed", goals: 4, appearances: 6 }],
  topAssists: []
};
const poolWithDeparture = buildSuperLigStatPool([], leadersWithDeparture);
assert.equal(isCurrentSeasonStatPlayer(departedMidSeason, poolWithDeparture), true, "bu sezon süre alan oyuncu kadrodan düşse de kalır");
assert.equal(seasonStatMetric(departedMidSeason, "goals", poolWithDeparture), 4);
assert.equal(seasonStatMetric(departedMidSeason, "xg", poolWithDeparture), null, "doğrulanmayan xG açılmamalı");

const previousSquadOnly = buildSuperLigStatPool([
  { season: "2025", teamName: "Galatasaray", players: [{ providerId: "mock-icardi-9", name: "Mauro Icardi" }] }
], { season: "2025", topScorers: [], topAssists: [] });
assert.equal(isCurrentSeasonStatPlayer(icardi, previousSquadOnly), false, "geçen sezon kadrosu güncel listeyi açmamalı");

const board = seasonLeaderboard(leaders, "goals");
assert.ok(board && board.length > 0, "güncel gol krallığı okunmalı");
assert.equal(board.some((row) => /icardi/i.test(row.item.name)), false);
assert.equal(board[0].item.name, leaders.topScorers[0].name);
assert.equal(board[0].value, leaders.topScorers[0].goals);
assert.ok(board.every((row, index) => index === 0 || row.value <= board[index - 1].value), "sıra yeniden kurulmalı");

const assists = seasonLeaderboard(leaders, "assists");
assert.ok(assists && assists.length > 0);
assert.equal(assists.some((row) => /icardi/i.test(row.item.name)), false);

assert.deepEqual(seasonLeaderboard(leaders, "goals", { league: "Premier League" }), []);
assert.equal(seasonLeaderboard({ season: "2025", topScorers: leaders.topScorers }, "goals"), null);

const rankedNames = [icardi, osimhen]
  .map((player) => ({ name: player.name, value: seasonStatMetric(player, "goals", pool) }))
  .filter((row) => row.value !== null)
  .sort((left, right) => right.value - left.value);
assert.deepEqual(rankedNames.map((row) => row.name), ["V. Osimhen"]);

const pages = [
  "gol-kralligi.html",
  "asist-kralligi.html",
  "en/top-scorers.html",
  "en/top-assists.html",
  "takimlar/galatasaray/istatistikler.html"
];
for (const file of pages) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  assert.equal(/Mauro Icardi|mauro-icardi/i.test(html), false, `${file} güncel istatistik sayfasında Icardi olmamalı`);
}

const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const publicApp = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
assert.equal(publicApp, app, "public/app.js app.js ile aynı kalmalı");
assert.match(app, /function buildSuperLigStatPool/);
assert.match(app, /function seasonStatMetric/);
assert.match(app, /function seasonLeaderboard/);
assert.match(app, /playerSeasonLeaders\(playerList, "goals"/);
assert.match(app, /rememberSuperLigStatPool/);

console.log("super lig season stats: icardi excluded, remaining leaders re-ranked");
