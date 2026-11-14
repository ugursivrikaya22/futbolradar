#!/usr/bin/env node
/**
 * Oyuncu karşılaştırma botu (toplayıcı) testleri:
 *   - kaynak künyesi (her dolu alanın beyaz listede bir kaynağı var),
 *   - uydurma değer yok (girdide olmayan sayı çıktıda da yok),
 *   - "Güncelleniyor" yedeği,
 *   - aktif oyuncu süzgeci (ayrılan oyuncu listeye girmez),
 *   - depodaki data/player-comparison-data.json güncel.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  API_FOOTBALL_LABEL,
  MISSING_LABEL,
  collectPlayerComparisonData,
  displayValue,
  isUsableSourceUrl,
  isBlockedSource
} = require("../services/playerComparisonCollector.js");
const { annotateDuplicates } = require("../services/duplicatePlayerService.js");
const { getPlayers } = require("../services/playerService.js");

const leaderRow = (over) => ({ rank: 1, providerId: "100", name: "A. Forvet", team: "Galatasaray", leagueId: "203", season: 2026, goals: 6, assists: 2, appearances: 8, minutes: 600, ...over });

const fixture = {
  competitionLeaders: {
    cache: {
      "topscorers:203:2026": { updatedAt: "2026-11-06T02:00:00.000Z", rows: [leaderRow(), leaderRow({ providerId: "200", name: "M. Icardi", team: "Galatasaray" })] },
      "assists:203:2026": { updatedAt: "2026-11-06T02:00:00.000Z", rows: [leaderRow({ providerId: "300", name: "No Minutes", minutes: null, appearances: null, goals: 1, assists: 4 })] },
      "topscorers:39:2026": { updatedAt: "2026-11-06T02:10:00.000Z", rows: [leaderRow({ providerId: "400", name: "E. Striker", team: "Arsenal", leagueId: "39" })] }
    }
  },
  squads: [{
    teamId: "645", teamName: "Galatasaray", syncedAt: "2026-11-06T02:20:00.000Z",
    players: [
      { providerId: "100", name: "A. Forvet", number: null, position: "Attacker", age: 25 },
      { providerId: "200", name: "M. Icardi", number: 9, position: "Attacker", age: 33 },
      { providerId: "500", name: "W. Kaynak", number: null, position: "Defender", age: 22 }
    ]
  }],
  players: [
    { id: "a-forvet", name: "Ali Forvet", providerId: "100", currentTeam: "Galatasaray", squadStatus: "active", isCurrentSuperLigPlayer: true,
      sourceName: "API-Football", shirtNumber: 11, providerSnapshot: { provider: "api-football", providerId: "100", lastSyncedAt: "2026-11-06" },
      transferUpdatedAt: "2026-10-01",
      transferHistory: [
        { date: "2025-07-01", fromTeam: "X FC", toTeam: "Galatasaray", type: "Transfer", feeEur: null, feeLabel: "Bilinmiyor", source: "api-football" },
        { date: "2024-07-01", fromTeam: "Y FC", toTeam: "X FC", type: "N/A", feeEur: null, feeLabel: "Bilinmiyor", source: "api-football" },
        { date: "2023-07-01", fromTeam: "Z FC", toTeam: "Y FC", type: "Bonservis", feeEur: 5000000, feeLabel: "5M EUR", source: "manual" },
        { date: "2022-07-01", fromTeam: "Q FC", toTeam: "Z FC", type: "Bonservis", feeEur: 0, feeLabel: "", source: "Sabah" },
        { date: "2021-07-01", fromTeam: "R FC", toTeam: "Q FC", type: "Bonservis", feeEur: 0, feeLabel: "", source: "Galatasaray SK" }
      ] },
    { id: "mauro-icardi", name: "Mauro Icardi", providerId: "200", currentTeam: "Serbest oyuncu", squadStatus: "released", isCurrentSuperLigPlayer: false },
    // Kadro dosyasında yok ama API-Football kaydı ve aktif: havuza girer.
    { id: "p-only", name: "Provider Only", providerId: "600", currentTeam: "Fenerbahçe", league: "Süper Lig", squadStatus: "active", isCurrentSuperLigPlayer: true,
      position: "Midfielder", age: 24, sourceName: "API-Football", providerSnapshot: { provider: "api-football", providerId: "600", lastSyncedAt: "2026-11-06" },
      transferHistory: [{ date: "2026-08-01", fromTeam: "K FC", toTeam: "Fenerbahçe", type: "Loan", feeEur: null, feeLabel: "", source: "api-football" }] },
    // API-Football kaydı ama ayrılmış: girmez.
    { id: "p-gone", name: "Provider Gone", providerId: "700", currentTeam: "Kasımpaşa", league: "Süper Lig", squadStatus: "departed", isCurrentSuperLigPlayer: false,
      sourceName: "API-Football", providerSnapshot: { provider: "api-football", providerId: "700" } },
    // Wikipedia kaynaklı forma numarası kabul edilmez.
    { id: "w-kaynak", name: "Wiki Kaynak", providerId: "500", currentTeam: "Galatasaray", squadStatus: "active", isCurrentSuperLigPlayer: true,
      number: 4, sourceUrl: "https://en.wikipedia.org/wiki/Galatasaray_S.K._(football)", transferHistory: [] }
  ],
  matchHistory: {
    updatedAt: "2026-11-06T10:00:00.000Z",
    rows: [
      { providerPlayerId: "100", date: "2026-10-01", competition: "Süper Lig", team: "Galatasaray", opponent: "A", home: true, started: true, minutes: 90, goals: 1, assists: 0, shots: 3, rating: 7.5, position: "F" },
      { providerPlayerId: "100", date: "2026-10-08", competition: "Süper Lig", team: "Galatasaray", opponent: "B", home: false, started: false, minutes: 30, assists: 1, shots: 1, rating: 7.0, position: "F" },
      { providerPlayerId: "100", date: "2026-05-01", competition: "Süper Lig", team: "Galatasaray", opponent: "Old", minutes: 90, goals: 3, assists: 0 },
      { providerPlayerId: "200", date: "2026-10-01", competition: "Süper Lig", team: "Galatasaray", opponent: "A", minutes: 90, goals: 2, assists: 0 }
    ]
  }
};

const output = collectPlayerComparisonData(fixture);
const byId = new Map(output.players.map((player) => [player.providerId, player]));

// --- Aktif oyuncu süzgeci: Icardi ne kadrodan ne krallık satırından girer.
assert.equal(byId.has("200"), false, "ayrılan oyuncu (Icardi) karşılaştırma havuzuna girmez");
assert.ok(output.excluded.some((item) => item.providerId === "200"), "ayrılan oyuncu dışlananlar listesinde gerekçesiyle görünür");
assert.ok(byId.has("100") && byId.has("400") && byId.has("500"));
assert.equal(byId.get("400").region, "avrupa");
assert.equal(byId.get("600").team.value, "Fenerbahçe", "kadro dosyasında olmayan aktif API-Football kaydı girer");
assert.equal(byId.get("600").position.value, "Orta saha");
assert.equal(byId.get("600").transferHistory[0].type, "Kiralık", "sağlayıcı transfer türü Türkçeleşir");
assert.equal(byId.has("700"), false, "ayrılan API-Football kaydı girmez");
assert.ok(output.excluded.some((item) => item.providerId === "700"));
assert.equal(byId.get("100").region, "turkiye");

// --- Uydurma değer yok: istatistik girdinin birebir kopyası, oranlar formülden.
const forvet = byId.get("100");
const stat = forvet.seasonStats.find((item) => item.competitionId === "super-lig");
assert.deepEqual([stat.goals, stat.assists, stat.appearances, stat.minutes], [6, 2, 8, 600]);
assert.equal(stat.goalsPer90, 0.9);
assert.equal(stat.goalsPerMatch, 0.75);
const noMinutes = byId.get("300").seasonStats[0];
assert.equal(noMinutes.minutes, null);
assert.equal(noMinutes.goalsPer90, null, "dakika yoksa 90 dk oranı hesaplanmaz");
assert.equal(noMinutes.goalsPerMatch, null, "maç sayısı yoksa maç başı oran hesaplanmaz");

// Maç kayıtları: sezon öncesi satır sayılmaz; bir satırda gol alanı yoksa toplam null.
const perf = forvet.matchPerformance.competitions.find((item) => item.competition === "Süper Lig");
assert.equal(perf.matches, 2, "sezon başlangıcından önceki maç toplanmaz");
assert.equal(perf.minutes, 120);
assert.equal(perf.goals, null, "eksik gol alanı 0 sayılmaz");
assert.equal(perf.assists, 1);
assert.equal(perf.assistsPer90, 0.75);
assert.equal(forvet.matchPerformance.lastMatches[0].date, "2026-10-08");
assert.equal(forvet.matchPerformance.lastMatches[0].goals, null);

// --- Kadro / pozisyon / forma numarası kaynakları.
assert.equal(forvet.position.value, "Forvet");
assert.equal(forvet.shirtNumber.value, 11, "API-Football kayıtlı forma numarası kullanılır");
const wiki = byId.get("500");
assert.equal(wiki.shirtNumber.value, null, "Wikipedia kaynaklı forma numarası kullanılmaz");
assert.ok(wiki.missing.includes("shirtNumber"));
assert.equal(displayValue(wiki.shirtNumber.value), MISSING_LABEL);
assert.equal(displayValue(0), 0, "0 geçerli bir değerdir, 'Güncelleniyor' değil");
assert.equal(MISSING_LABEL, "Güncelleniyor");

// --- Transfer geçmişi: api-football + resmî kulüp; "manual" ve medya ismi elenir.
const transfers = forvet.transferHistory;
assert.deepEqual(transfers.map((item) => item.date), ["2025-07-01", "2024-07-01", "2021-07-01"]);
assert.equal(transfers[1].type, null, "'N/A' türü Güncelleniyor olarak kalır");
assert.equal(output.meta.sources[transfers[2].source].url, "https://www.galatasaray.org/");

// --- Kaynak künyesi: her dolu alanın kaynağı var, kaynak beyaz listede ve yasaklı değil.
function assertSourced(result) {
  const { meta, players } = result;
  for (const [key, source] of Object.entries(meta.sources)) {
    assert.ok(isUsableSourceUrl(source.url), `${key}: kaynak beyaz listede olmalı (${source.url})`);
    assert.equal(isBlockedSource(source.url), false, `${key}: yasaklı kaynak`);
    if (source.name === "API-Football") assert.equal(source.label, API_FOOTBALL_LABEL);
  }
  for (const player of players) {
    for (const field of ["team", "position", "shirtNumber", "age"]) {
      const cell = player[field];
      if (cell.value === null) assert.equal(cell.source, null, `${player.providerId}.${field}: boş alanın kaynağı olmaz`);
      else assert.ok(meta.sources[cell.source], `${player.providerId}.${field}: kaynak kaydı yok`);
    }
    for (const item of player.seasonStats) assert.ok(meta.sources[item.source], `${player.providerId}: sezon istatistiği kaynaksız`);
    for (const item of player.transferHistory) assert.ok(meta.sources[item.source], `${player.providerId}: transfer satırı kaynaksız`);
    if (player.matchPerformance) assert.ok(meta.sources[player.matchPerformance.source]);
  }
}
assertSourced(output);
assert.equal(isUsableSourceUrl("https://www.transfermarkt.com.tr/x"), false);
assert.equal(isUsableSourceUrl("https://en.wikipedia.org/wiki/X"), false, "Wikipedia beyaz listede olsa da kabul edilmez");
assert.equal(isUsableSourceUrl("https://fbref.com/en/players/x"), false);

// --- Gerçek veri: depodaki çıktı güncel, kaynaklı ve Icardi içermiyor.
const real = collectPlayerComparisonData({
  competitionLeaders: JSON.parse(fs.readFileSync("data/competition-leaders.json", "utf8")),
  squads: JSON.parse(fs.readFileSync("data/super-lig-squads.json", "utf8")),
  players: annotateDuplicates(getPlayers(JSON.parse(fs.readFileSync("data/players.json", "utf8")))),
  matchHistory: JSON.parse(fs.readFileSync("data/player-match-history.json", "utf8"))
});
assertSourced(real);
assert.ok(!real.players.some((player) => /icardi/i.test(player.name || "")), "gerçek veride Icardi yok");
const committed = JSON.parse(fs.readFileSync("data/player-comparison-data.json", "utf8"));
assert.deepEqual(committed, JSON.parse(JSON.stringify({ meta: real.meta, excluded: real.excluded, players: real.players })),
  "data/player-comparison-data.json eski: node scripts/collect-player-comparison.mjs --apply");
for (const leagueId of ["super-lig", "premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1", "sampiyonlar-ligi"]) {
  assert.ok(real.meta.coverage.leagues[leagueId].players > 0, `${leagueId} kapsanıyor`);
}

console.log(`player comparison collector tests passed (${real.players.length} oyuncu, ${Object.keys(real.meta.sources).length} kaynak)`);
