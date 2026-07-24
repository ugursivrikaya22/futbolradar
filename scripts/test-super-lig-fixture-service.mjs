import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  getFixtureWeeks,
  normalizeMatchStatus,
  findFixtureTeam,
  resolveDefaultRound,
  parseDateRange,
  filterWeeksByTeam
} = require("../services/superLigFixtureService.js");

const sampleFixtures = {
  teams: [
    { name: "Galatasaray", city: "İstanbul", venue: "Rams Park" },
    { name: "Fenerbahçe", city: "İstanbul", venue: "Chobani Stadyumu" },
    { name: "Yeni Takım", city: "Bilinmiyor" }
  ],
  rounds: [
    {
      round: 1,
      label: "1. Hafta",
      dateRange: "14-17 Ağustos 2026",
      status: "confirmed-pairings",
      matches: [
        { id: "m1", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", fixtureStatus: "confirmed-pairing" },
        { id: "m2", homeTeam: "Yeni Takım", awayTeam: "Galatasaray", status: "FT", score: { home: 1, away: 2 }, fixtureStatus: "confirmed-pairing" }
      ]
    },
    {
      round: 2,
      label: "2. Hafta",
      dateRange: "Tarih ve saat atamaları bekleniyor",
      status: "confirmed-pairings",
      matches: [
        { id: "m3", homeTeam: "Fenerbahçe", awayTeam: "Yeni Takım", fixtureStatus: "confirmed-pairing" }
      ]
    }
  ]
};

// --- normalizeMatchStatus ---
assert.equal(normalizeMatchStatus("FT"), "FINISHED", "FT ham durumu FINISHED'e eşlenmeli");
assert.equal(normalizeMatchStatus("NS"), "SCHEDULED", "NS ham durumu SCHEDULED'e eşlenmeli");
assert.equal(normalizeMatchStatus("PST"), "POSTPONED", "PST ham durumu POSTPONED'e eşlenmeli");
assert.equal(normalizeMatchStatus(undefined), "SCHEDULED", "Durum yoksa varsayılan SCHEDULED olmalı");
assert.equal(normalizeMatchStatus("garbage-value"), "SCHEDULED", "Tanınmayan durum uydurulmadan SCHEDULED'e düşmeli");

// --- getFixtureWeeks ---
const weeks = getFixtureWeeks(sampleFixtures);
assert.equal(weeks.length, 2, "İki hafta normalize edilmeli");
assert.equal(weeks[0].matches.length, 2, "1. haftada 2 maç olmalı");
assert.equal(weeks[0].matches[1].status, "FINISHED", "Skoru olan maç FINISHED işaretlenmeli");
assert.deepEqual(weeks[0].matches[1].score, { home: 1, away: 2 }, "Skor doğru taşınmalı");
assert.equal(weeks[0].matches[0].score, null, "Skor yoksa 0-0 uydurulmamalı, null kalmalı");
assert.equal(weeks[0].hasConfirmedDates, false, "Kickoff ISO'su olmayan hafta 'confirmed dates' sayılmamalı");

// --- findFixtureTeam ---
const gs = findFixtureTeam(sampleFixtures, "Galatasaray");
assert.equal(gs.venue, "Rams Park", "Bilinen takımın stadyum bilgisi bulunmalı");
const unknownTeamVenue = findFixtureTeam(sampleFixtures, "Yeni Takım");
assert.equal(unknownTeamVenue.venue, undefined, "Doğrulanmamış takımın stadyumu uydurulmamalı");
assert.equal(findFixtureTeam(sampleFixtures, "Var Olmayan Takım"), null, "Bilinmeyen takım null dönmeli");

// --- parseDateRange ---
const range = parseDateRange("14-17 Ağustos 2026");
assert.deepEqual(range, { start: "2026-08-14", end: "2026-08-17" }, "Tarih aralığı doğru ayrıştırılmalı");
assert.equal(parseDateRange("Tarih ve saat atamaları bekleniyor"), null, "Belirsiz tarih uydurulmadan null dönmeli");

// --- resolveDefaultRound ---
assert.equal(resolveDefaultRound(weeks, "2026-07-24"), 1, "Sezon başlamadan önce 1. hafta varsayılan olmalı");
assert.equal(resolveDefaultRound(weeks, "2026-08-20"), 2, "1. hafta bittiğinde bir sonraki (tarihsiz) haftaya geçmeli");
assert.equal(resolveDefaultRound([], "2026-07-24"), 1, "Hafta yoksa güvenli varsayılan 1 olmalı");

// --- filterWeeksByTeam ---
const onlyGalatasaray = filterWeeksByTeam(weeks, "Galatasaray");
assert.equal(onlyGalatasaray[0].matches.length, 2, "Galatasaray'ın oynadığı 2 maç da (ev/deplasman) kalmalı");
assert.equal(onlyGalatasaray[1].matches.length, 0, "Galatasaray oynamayan haftada maç kalmamalı");
const allTeams = filterWeeksByTeam(weeks, "");
assert.equal(allTeams[0].matches.length, 2, "Boş takım filtresi 'tüm takımlar' anlamına gelmeli");

console.log("Süper Lig fixture service tests passed");
