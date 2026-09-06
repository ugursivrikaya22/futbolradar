#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const block = appSource.match(/\/\/ today-match-card-selection:start([\s\S]*?)\/\/ today-match-card-selection:end/);
assert.ok(block, "app.js içinde bugünün maç kartı seçim bloğu bulunmalı");

const { isTurkishMatch } = require("../services/turkishTeams.js");

/**
 * `isHomeRelevantMatch`in izole ortamdaki eşi — gerçek app.js sürümü gibi
 * önce `match.relevance` puanına bakar (yoksa Türk takımı/beş büyük Avrupa
 * ligi+UEFA kupaları adından tanır). Aşağıdaki kurgu maçlarda puan hiç
 * basılmadığı için ikinci yol test edilir.
 */
function isHomeRelevantMatchStub(match) {
  if (!match) return false;
  if (typeof match.relevance === "number" && isFinite(match.relevance)) {
    return match.relevance >= 400;
  }
  if (isTurkishMatch(match)) return true;
  const bigLeagues = ["premier league", "la liga", "serie a", "bundesliga", "ligue 1", "sampiyonlar ligi", "avrupa ligi", "konferans ligi"];
  const league = String((match && match.league) || "").toLocaleLowerCase("tr-TR");
  return bigLeagues.includes(league);
}

const selectTodayMatchCards = new Function("isTurkishMatch", "isHomeRelevantMatch", `
  "use strict";
  function todayInIstanbul() { return "2026-08-24"; }
  function istanbulDayOf(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date(value));
  }
  function isLiveMatch(match) {
    const status = String(match && (match.status || match.providerStatus) || "").toUpperCase();
    const score = match && match.score;
    return ["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"].includes(status) &&
      score && Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
  }
  ${block[1]}
  return selectTodayMatchCards;
`)(isTurkishMatch, isHomeRelevantMatchStub);

const matches = [
  { id: "yesterday", kickoff: "2026-08-23T20:00:00+03:00", homeTeam: "Galatasaray", awayTeam: "Rennes", status: "FINISHED", score: { home: 2, away: 0 } },
  { id: "tomorrow", kickoff: "2026-08-25T20:00:00+03:00", homeTeam: "Fenerbahçe", awayTeam: "Ajax", status: "SCHEDULED" },
  { id: "foreign-live", kickoff: "2026-08-24T19:00:00+03:00", homeTeam: "Ajax", awayTeam: "PSG", status: "LIVE", score: { home: 0, away: 1 }, league: "Ligue 1" },
  { id: "turkish-live", kickoff: "2026-08-24T19:30:00+03:00", homeTeam: "Beşiktaş", awayTeam: "Roma", status: "LIVE", score: { home: 1, away: 1 } },
  { id: "foreign-upcoming", kickoff: "2026-08-24T20:00:00+03:00", homeTeam: "Rennes", awayTeam: "Venezia", status: "SCHEDULED", league: "Ligue 1" },
  { id: "turkish-upcoming", kickoff: "2026-08-24T21:00:00+03:00", homeTeam: "Trabzonspor", awayTeam: "Basel", status: "SCHEDULED" },
  { id: "finished-today", kickoff: "2026-08-24T14:00:00+03:00", homeTeam: "A Takımı", awayTeam: "B Takımı", status: "FINISHED", score: { home: 1, away: 0 } },
  { id: "irrelevant-live", kickoff: "2026-08-24T18:00:00+03:00", homeTeam: "Deportivo Cuenca", awayTeam: "Guayaquil City FC", status: "LIVE", score: { home: 0, away: 0 }, league: "Liga Pro" }
];

const selected = selectTodayMatchCards(matches, { today: "2026-08-24" });
assert.deepEqual(
  selected.map((match) => match.id),
  ["turkish-live", "foreign-live", "turkish-upcoming", "foreign-upcoming"],
  "yalnızca bugünün İLGİLİ kartları kalmalı; durum bandında Türk maçı önce gelmeli"
);
assert.ok(!selected.some((match) => match.id === "yesterday"), "dünün eski kartı ana sayfada kalmamalı");
assert.ok(!selected.some((match) => match.id === "tomorrow"), "yarının maçı bugünün kartları arasına girmemeli");
assert.ok(
  !selected.some((match) => match.id === "finished-today"),
  "Türk takımı ya da beş büyük lig/UEFA dışındaki bugünün maçı ana sayfada kalmamalı"
);
assert.ok(
  !selected.some((match) => match.id === "irrelevant-live"),
  "tanınmayan bir alt ligin canlı maçı (ör. Liga Pro) ana sayfayı doldurmamalı"
);

console.log("home-match-cards OK (tarih filtresi + ana sayfa ilgi süzgeci + Türk takımı önceliği)");
