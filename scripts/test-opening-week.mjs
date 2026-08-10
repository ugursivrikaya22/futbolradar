#!/usr/bin/env node
/**
 * AÇILIŞ GECESİ ZİNCİRİ — UÇTAN UCA.
 *
 * Süper Lig 14 Ağustos'ta başlıyor ve o güne kadar bu hattan TEK BİR
 * gerçek lig maçı geçmedi: puan tablosu sıfır, canlı skor yalnızca yabancı
 * maçlarla sınandı, maç sonu raporu yalnızca hazırlık maçlarında üretildi.
 * Yani sezonun en kritik gecesinde zincirin ilk kez çalışacağı bir sürü
 * halka var ve hepsi ancak canlıda kırılırsa görülürdü.
 *
 * Bu test o geceyi sentetik olarak oynatır. DEPODAKİ VERİYE DOKUNMAZ:
 * sağlayıcı enjekte edilir, takvim bellekte tutulur, hiçbir dosya yazılmaz.
 * Sınanan zincir, gerçek üretim kodunun ta kendisi:
 *
 *   services/matchStatus.js          → durum ve canlı kararı
 *   services/featuredMatchSelector.js→ ana sayfa hero sırası
 *   scripts/sync-live-fixtures.mjs   → takvim birleştirme
 *   scripts/sync-standings.mjs       → puan tablosu
 *   services/standingsIntegrity.js   → aritmetik kapısı
 *   services/matchEligibility.js     → yayın uygunluğu
 *   services/postMatchReportStore.js → maç sonu rapor kaydı
 *
 * Senaryo: Galatasaray - Çorum FK, 14 Ağustos 2026 21:30 TSİ (açılış maçı).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { liveVerdict, matchState, istanbulDay } = require("../services/matchStatus.js");
const { selectFeaturedMatches } = require("../services/featuredMatchSelector.js");
const { evaluateMatch } = require("../services/matchEligibility.js");
const { buildReportRecord } = require("../services/postMatchReportStore.js");
const { checkStandings } = require("../services/standingsIntegrity.js");
const { synchronizeLiveFixtures } = await import("./sync-live-fixtures.mjs");
const { mergeStandings } = await import("./sync-standings.mjs");

const KICKOFF = "2026-08-14T21:30:00+03:00";
const HOME = "Galatasaray";
const AWAY = "Çorum FK";

function at(iso) {
  return new Date(iso).getTime();
}

function match(status, extra = {}) {
  return {
    id: "galatasaray-corum-fk-2026-08-14",
    providerId: "1584370",
    homeTeam: HOME,
    awayTeam: AWAY,
    league: "Süper Lig",
    competitionId: "super-lig",
    venue: "Rams Park",
    kickoff: KICKOFF,
    status,
    source: "api-football",
    dataStatus: "provider",
    ...extra
  };
}

// ── 1. Maçın yaşam döngüsü: her aşamada doğru durum ────────────────────────
//
// En kritik satır sonuncusu: maç bitmiş ama sağlayıcı hâlâ "LIVE" diyorsa
// (kota dolmuş, besleme donmuş) site o maçı CANLI GÖSTERMEMELİ. Bayat canlı,
// okuyucuya olmayan bir maçı izletir.
const lifecycle = [
  { label: "başlamadan iki saat önce", record: match("SCHEDULED"), now: at("2026-08-14T19:30:00+03:00"), live: false, verdict: "not-live" },
  { label: "23. dakika", record: match("LIVE", { live: true, minute: 23, score: { home: 1, away: 0 } }), now: at("2026-08-14T21:53:00+03:00"), live: true, verdict: "live" },
  { label: "devre arası", record: match("HALFTIME", { live: true, minute: 45, score: { home: 1, away: 0 } }), now: at("2026-08-14T22:20:00+03:00"), live: true, verdict: "live" },
  { label: "ikinci yarı", record: match("LIVE", { live: true, minute: 70, score: { home: 2, away: 1 } }), now: at("2026-08-14T22:45:00+03:00"), live: true, verdict: "live" },
  { label: "maç sonu", record: match("FINISHED", { score: { home: 2, away: 1 } }), now: at("2026-08-14T23:25:00+03:00"), live: false, verdict: "not-live" },
  { label: "bayat canlı (4 saat sonra hâlâ LIVE)", record: match("LIVE", { live: true, minute: 70, score: { home: 2, away: 1 } }), now: at("2026-08-15T01:35:00+03:00"), live: false, verdict: "unverified" }
];

for (const phase of lifecycle) {
  const result = liveVerdict(phase.record, { nowMs: phase.now });
  assert.equal(result.live, phase.live, `${phase.label}: canlı kararı ${phase.live} olmalı (gelen ${result.live})`);
  assert.equal(result.verdict, phase.verdict, `${phase.label}: verdict ${phase.verdict} olmalı (gelen ${result.verdict})`);
}

// Ertelenen maç hiçbir koşulda canlı sayılmaz.
assert.equal(liveVerdict(match("POSTPONED"), { nowMs: at("2026-08-14T21:45:00+03:00") }).live, false, "ertelenen maç canlı gösterilmemeli");
assert.equal(matchState(match("PST")), "POSTPONED", "sağlayıcı PST kodu ertelendi olarak okunmalı");

// ── 2. Takvim günü TSİ'ye göre ─────────────────────────────────────────────
assert.equal(istanbulDay(KICKOFF), "2026-08-14", "açılış maçı 14 Ağustos'a düşmeli");
// Gece yarısını geçen bir Avrupa maçı ertesi güne yazılmalı.
assert.equal(istanbulDay("2026-08-14T22:30:00+00:00"), "2026-08-15", "TSİ 01:30'da başlayan maç ertesi güne düşmeli");

// ── 3. Ana sayfa hero'su: canlı Türk maçı ilk kart ─────────────────────────
const foreignLive = {
  id: "lyon-sparta", homeTeam: "Lyon", awayTeam: "Sparta Praha", league: "Şampiyonlar Ligi",
  kickoff: "2026-08-14T22:00:00+03:00", status: "LIVE", live: true, source: "api-football"
};

for (const phase of lifecycle.slice(0, 5)) {
  const [first] = selectFeaturedMatches([foreignLive, phase.record], { now: new Date(phase.now), today: "2026-08-14" });
  assert.equal(first.match.homeTeam, HOME, `${phase.label}: hero ilk kartı Türk maçı olmalı`);
  assert.ok(first.reason.startsWith("turkish-"), `${phase.label}: sebep turkish- ile başlamalı (gelen ${first.reason})`);
}
// Canlıyken kademe 0: yabancı canlı maç önüne geçemez.
const liveSelection = selectFeaturedMatches([foreignLive, lifecycle[1].record], { now: new Date(lifecycle[1].now), today: "2026-08-14" });
assert.equal(liveSelection[0].tier, 0, "canlı Türk maçı kademe 0 olmalı");
assert.equal(liveSelection[0].reason, "turkish-live", "canlı Türk maçının sebebi turkish-live olmalı");

// ── 4. Takvim senkronu: aynı maç tek satır, skor ve durum ilerler ──────────
function fakeProvider(record) {
  return {
    getFixtures: async () => [{ ...record, time: "21:30", providerStatus: record.status, elapsed: record.minute ?? null }],
    getMatchDetail: async () => null
  };
}

let calendar = { matches: [] };
const syncSteps = [
  { record: match("SCHEDULED", { score: { home: null, away: null } }), now: "2026-08-14T19:30:00+03:00", status: "SCHEDULED" },
  { record: match("LIVE", { live: true, minute: 23, score: { home: 1, away: 0 } }), now: "2026-08-14T21:53:00+03:00", status: "LIVE" },
  { record: match("FINISHED", { score: { home: 2, away: 1 } }), now: "2026-08-14T23:25:00+03:00", status: "FINISHED" }
];

for (const step of syncSteps) {
  const result = await synchronizeLiveFixtures({
    provider: fakeProvider(step.record),
    mode: "hourly",
    now: new Date(step.now),
    previous: calendar
  });
  calendar = result.output;
  assert.equal(calendar.matches.length, 1, "aynı maç takvimde tek satır olmalı (yinelenme yok)");
  assert.equal(calendar.matches[0].status, step.status, `takvim durumu ${step.status} olmalı`);
}

const finalRow = calendar.matches[0];
assert.equal(String(finalRow.kickoff).slice(-6), "+03:00", "takvim satırı TSİ ofsetiyle yazılmalı");
assert.equal(istanbulDay(finalRow.kickoff), "2026-08-14", "takvim satırı doğru güne düşmeli");
assert.equal(finalRow.score.home, 2, "final skor korunmalı");
assert.equal(finalRow.score.away, 1, "final skor korunmalı");
assert.equal(finalRow.live, false, "biten maç live=false olmalı");

// ── 5. Puan tablosu: sezon öncesinden ilk haftaya ──────────────────────────
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const beforeHome = teams.find((team) => team.name === HOME);
assert.ok(beforeHome, "Galatasaray puan tablosunda bulunmalı");

// Sağlayıcı tabloyu HER ZAMAN bütün olarak döndürür; kısmi cevabın nasıl
// reddedildiği aşağıda ayrıca sınanıyor. Burada 18 takımın tamamı için
// tutarlı bir 1. hafta tablosu kuruluyor: dokuz maç, dokuz galip, dokuz
// mağlup.
const currentTeams = teams.filter((team) => team.isCurrentSuperLigTeam);
const providerStandings = currentTeams.map((team, index) => {
  const won = index < currentTeams.length / 2 ? 1 : 0;
  const lost = won ? 0 : 1;
  return {
    providerId: team.providerId,
    team: team.name,
    rank: won ? index + 1 : index + 1,
    played: 1,
    won,
    drawn: 0,
    lost,
    goalsFor: won ? 2 : 1,
    goalsAgainst: won ? 1 : 2,
    goalDifference: won ? 1 : -1,
    points: won ? 3 : 0,
    form: [won ? "W" : "L"]
  };
});
// Kazananlar üstte: sıralama puanla çelişmemeli.
providerStandings.sort((left, right) => right.points - left.points);
providerStandings.forEach((row, index) => { row.rank = index + 1; });

const merged = mergeStandings(teams, providerStandings, { nowIso: "2026-08-14T20:40:00Z", season: "2026/27" });
const afterHome = merged.teams.find((team) => team.name === HOME);
assert.equal(afterHome.played, 1, "ilk hafta sonrası O=1 olmalı");
assert.equal(afterHome.standingsStatus, "live", "maç oynanınca tablo sezon öncesinden çıkmalı");
assert.equal(afterHome.standingsSeason, "2026/27", "sezon etiketi yazılmalı");
assert.equal(merged.matched, currentTeams.length, "sağlayıcı tam tabloyu döndürdüğünde her takım eşleşmeli");

// ── 6. Aritmetik kapısı gerçekten bozuk satırı yakalıyor mu ────────────────
assert.deepEqual(checkStandings(merged.teams), [], "birleştirilen tablo tutarlı olmalı");

const corrupted = JSON.parse(JSON.stringify(merged.teams));
const target = corrupted.find((team) => team.name === HOME);
target.points = 9;
assert.ok(
  checkStandings(corrupted).some((violation) => violation.includes("P(9)")),
  "puanı tutmayan satır kapıdan geçmemeli"
);

const doubleCounted = JSON.parse(JSON.stringify(merged.teams));
doubleCounted.find((team) => team.name === HOME).played = 2;
assert.ok(
  checkStandings(doubleCounted).some((violation) => violation.includes("O(2)")),
  "maçı iki kez sayan satır kapıdan geçmemeli"
);

// ── 6b. KISMİ TABLO YAZILMAMALI ───────────────────────────────────────────
//
// Satır sayısı koruması tek başına yetmiyordu: 18 takımlık ligde eşik 12,
// yani sağlayıcı 12-17 satır döndürdüğünde birleştirme yapılıyor ve
// kapsanmayan takımlar ESKİ sıralarında kalıyordu. Sonuç aynı sıra
// numarasının iki takımda göründüğü çelişkili bir tabloydu. Artık
// birleştirme sonrası aritmetik kapısı yazmadan önce çalışıyor.
{
  const { synchronizeStandings } = await import("./sync-standings.mjs");
  const partial = providerStandings.slice(0, 13); // eşiği geçer ama tabloyu kapsamaz
  let rejected = false;
  try {
    await synchronizeStandings({
      provider: {
        getStandings: async () => partial,
        getConfig: () => ({ season: 2026 })
      },
      teams,
      leagueResolution: { status: "resolved", leagueId: 203 },
      now: new Date("2026-08-14T20:40:00Z")
    });
  } catch (error) {
    rejected = /integrity check rejected/i.test(error.message);
  }
  assert.ok(rejected, "kısmi puan tablosu yazma öncesi reddedilmeli (çelişkili sıra numarası)");
}

// ── 7. Maç sonu: yayın uygunluğu ve rapor kaydı ────────────────────────────
const finished = match("FINISHED", { score: { home: 2, away: 1 } });
const eligibility = evaluateMatch(finished);
assert.equal(eligibility.eligible, true, "biten lig maçı yayına uygun olmalı");
assert.equal(eligibility.publishState, "complete", "kimlik ve skor tamsa publishState complete olmalı");

const report = buildReportRecord(finished, {});
assert.ok(report && report.seo && report.seo.path, "maç sonu rapor kaydı üretilmeli");
assert.equal(report.seo.path, "mac-raporu/galatasaray-corum-fk-2026-08-14.html", "rapor yolu TSİ gününü taşımalı");
assert.match(report.seo.title, /Galatasaray 2-1 Çorum FK/, "rapor başlığı skoru taşımalı");

// Skoru olmayan "bitmiş" maç sonuç gibi yayımlanmamalı.
const scoreless = evaluateMatch(match("FINISHED"));
assert.notEqual(scoreless.publishState, "complete", "skoru doğrulanmamış maç complete sayılmamalı");

console.log(
  "Açılış haftası zinciri testleri geçti " +
  "(maç yaşam döngüsü, bayat canlı koruması, TSİ günü, hero sırası, takvim birleştirme, " +
  "puan tablosu geçişi, aritmetik kapısı, yayın uygunluğu, maç sonu raporu)."
);
