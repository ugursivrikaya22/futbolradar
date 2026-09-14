#!/usr/bin/env node
/**
 * FUTBOLCU ÖZELLİK PUANI MOTORU — BİRİM TESTLERİ.
 *
 * Sınanan sözleşme tek cümleyle: puan yalnızca ÖLÇÜLMÜŞ girdilerden çıkar,
 * ölçüm yoksa kategori "Veri yetersiz" kalır ve hiçbir koşulda uydurulmuş
 * bir sayı basılmaz.
 *
 * Testlerin çoğu bir REGRESYONU kilitliyor:
 *   • Kadro senkronunun 0'ları ölçüm sayılıyordu → 6 gollük santrfor 20/100
 *     "Hücum" alıyordu.
 *   • Küçük örneklem küçültülmüyordu → 3 maçta 2 gol, sezonun en iyisi gibi
 *     puanlanıyordu.
 *   • Kalecinin 0 gol + 0 asisti "kötü form" sayılıyordu.
 *   • Farklı kapsamdaki kaynaklar tek dakika paydasıyla bölünüyordu.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../services/playerRatingEngine.js");
const view = require("../services/playerRatingView.js");
const ledgerModule = require("../services/playerMatchLedger.js");
const { computePlayerRatingScores, RATING_CATEGORY_ORDER, POSITION_WEIGHTS } = engine;

/** Kimlik kapısından geçen bir taban kayıt; testler üstüne alan ekler. */
function basePlayer(extra) {
  return {
    id: "test-player",
    name: "Test Oyuncu",
    providerId: "12345",
    sourceUrl: "https://v3.football.api-sports.io/players?id=12345",
    lastVerifiedAt: "2026-09-10T12:00:00+03:00",
    dataStatus: "provider",
    positionGroup: "forward",
    position: "Santrfor",
    computedAge: 26,
    ...extra
  };
}

const NOW = new Date("2026-09-14T09:00:00+03:00");

function scoresFor(extra, context) {
  return computePlayerRatingScores(basePlayer(extra), { now: NOW, ...(context || {}) });
}

// ── 1. KANIT KAPISI ─────────────────────────────────────────────────────────

function testUnmeasuredZerosAreNotTreatedAsMeasurements() {
  // Kadro senkronundan gelen kaydın birebir şekli: her sayaç 0, hiçbir
  // istatistik kökeni işareti yok.
  const scores = scoresFor({
    stats: {
      appearances: 0, goals: 0, assists: 0, minutesPlayed: 0, shots: 0,
      xg: 0, xa: 0, keyPasses: 0, tackles: 0, yellowCards: 0, redCards: 0
    }
  });

  assert.equal(scores.status, "insufficient", "ölçülmemiş sıfırlardan puan üretilmemeli");
  for (const key of RATING_CATEGORY_ORDER) {
    assert.equal(scores.categories[key].value, null, `${key}: uydurulmuş değer`);
    assert.equal(scores.categories[key].display, "Veri yetersiz", `${key}: "-" yerine gerekçe basılmalı`);
  }
}

function testExplicitProvenanceMakesZeroAMeasurement() {
  // Aynı sıfırlar, ama bu kez sağlayıcı gerçekten istatistik gönderdi.
  const scores = scoresFor({
    statsSource: "api-football:/players",
    statsVerifiedAt: "2026-09-12T09:00:00+03:00",
    stats: {
      appearances: 6, minutesPlayed: 540, goals: 0, assists: 0,
      shots: 4, shotsOnTarget: 1, xg: 0.4, yellowCards: 0, redCards: 0
    }
  }, { teamMatchesPlayed: 6 });

  assert.equal(scores.categories.attack.status, "computed", "ölçülmüş sıfır da bir ölçümdür");
  assert.ok(scores.categories.attack.value < 55, "gol atamamış oyuncu yüksek hücum puanı almamalı");
  assert.equal(scores.categories.discipline.status, "computed", "kart verisi ölçülmüşse disiplin hesaplanmalı");
}

function testPartialVerificationLimitsMeasuredFields() {
  // `statsVerifiedFields` kısmi doğrulama beyan ediyor: yalnızca sayılan
  // alanlar ölçülmüş sayılır (services/cardCredibility.js ile aynı sözleşme).
  const scores = scoresFor({
    statsVerifiedFields: ["goals", "assists", "appearances", "minutesPlayed", "yellowCards", "redCards"],
    statsSource: "Manuel doğrulama",
    stats: {
      appearances: 4, minutesPlayed: 300, goals: 6, assists: 2,
      // Bunlar doğrulama listesinde YOK: 0 olmaları "hiç şut çekmedi"
      // demek değil, "ölçülmedi" demek.
      shots: 0, shotsOnTarget: 0, xg: 0, keyPasses: 0,
      yellowCards: 0, redCards: 0
    }
  }, { teamMatchesPlayed: 4 });

  const attackInputs = scores.categories.attack.inputs.map((item) => item.label);
  assert.ok(attackInputs.includes("Gol"), "gol ölçülmüş, girdide görünmeli");
  assert.ok(!attackInputs.includes("Şut"), "doğrulanmamış şut ölçüm sayılmamalı");
  assert.ok(scores.categories.attack.value >= 80, `6 gol / 300 dk yüksek hücum puanı vermeli (${scores.categories.attack.value})`);
}

function testPlaceholderIdentityWithholdsEveryScore() {
  const scores = computePlayerRatingScores(
    basePlayer({
      providerId: "mock-test-player",
      statsSource: "Manuel doğrulama",
      stats: { appearances: 10, minutesPlayed: 900, goals: 8, assists: 4, yellowCards: 1, redCards: 0 }
    }),
    { now: NOW }
  );

  assert.equal(scores.status, "insufficient", "yer tutucu kimlikli kayıttan puan yayımlanmamalı");
  assert.ok(scores.withheldReasons.some((reason) => /mock/i.test(reason)), "gerekçe çıktıda taşınmalı");
}

// ── 2. ÖLÇEK VE ÖRNEKLEM ────────────────────────────────────────────────────

function testEveryScoreStaysInRange() {
  const extreme = scoresFor({
    statsSource: "api-football:/players",
    stats: {
      appearances: 30, minutesPlayed: 2700, goals: 45, assists: 30, shots: 190,
      shotsOnTarget: 120, xg: 40, xa: 22, keyPasses: 95, dribbles: 90,
      passAccuracy: 97, tackles: 80, interceptions: 70, blocks: 30,
      duelsWon: 300, duelsTotal: 400, recoveries: 250,
      yellowCards: 0, redCards: 0, foulsCommitted: 2
    }
  }, { teamMatchesPlayed: 30 });

  for (const key of RATING_CATEGORY_ORDER) {
    const category = extreme.categories[key];
    if (category.status !== "computed") continue;
    assert.ok(category.value >= 0 && category.value <= 100, `${key}: ${category.value} aralık dışında`);
  }
  assert.ok(extreme.categories.overall.value >= 85, "elit girdilerle overall yüksek olmalı");
}

function testSmallSampleIsShrunkTowardBaseline() {
  const common = {
    statsSource: "api-football:/players",
    statsVerifiedFields: ["goals", "assists", "appearances", "minutesPlayed", "yellowCards", "redCards"]
  };
  const tinySample = scoresFor({
    ...common,
    stats: { appearances: 1, minutesPlayed: 90, goals: 2, assists: 0, yellowCards: 0, redCards: 0 }
  }, { teamMatchesPlayed: 6 });
  const longSample = scoresFor({
    ...common,
    stats: { appearances: 20, minutesPlayed: 1800, goals: 40, assists: 0, yellowCards: 0, redCards: 0 }
  }, { teamMatchesPlayed: 20 });

  assert.ok(
    tinySample.categories.attack.value < longSample.categories.attack.value,
    "90 dakikadaki 2 gol, 1800 dakikadaki 40 golden yüksek puanlanmamalı"
  );
}

function testSourcesKeepTheirOwnMinuteBasis() {
  // Maç defteri iki maçı, sezon kaydı dört maçı kapsıyor. Şutu iki maçtan,
  // dakikayı dört maçtan alıp bölmek şut/90'ı yarıya indirirdi.
  const scores = scoresFor({
    statsSource: "api-football:/players",
    statsVerifiedFields: ["goals", "assists", "appearances", "minutesPlayed", "yellowCards", "redCards"],
    stats: { appearances: 4, minutesPlayed: 360, goals: 2, assists: 1, yellowCards: 0, redCards: 0 }
  }, {
    teamMatchesPlayed: 4,
    ledger: [
      { matchId: "m2", kickoff: "2026-09-10T18:00:00Z", competition: "Süper Lig", played: true, started: true, minutes: 90, shots: 4, rating: 7.1 },
      { matchId: "m1", kickoff: "2026-09-03T18:00:00Z", competition: "Süper Lig", played: true, started: true, minutes: 90, shots: 4, rating: 6.8 }
    ]
  });

  const shots = scores.categories.attack.inputs.find((item) => item.label === "Şut");
  assert.ok(shots, "şut girdisi görünmeli");
  // 8 şut / 180 dakika = 4.00 per 90. Sezon dakikası (360) kullanılsaydı 2.00 çıkardı.
  assert.match(shots.value, /4 \/ 90 dk$/, `şut oranı kendi dakika tabanıyla hesaplanmalı: ${shots.value}`);
}

// ── 3. MEVKİ AĞIRLIKLARI ────────────────────────────────────────────────────

function testPositionWeightsMatchSpecification() {
  assert.deepEqual(POSITION_WEIGHTS.forward,
    { attack: 35, form: 20, creativity: 15, durability: 15, discipline: 5, defense: 10 },
    "forvet ağırlıkları şartnameyle birebir olmalı");
  assert.deepEqual(POSITION_WEIGHTS.midfielder,
    { creativity: 25, form: 20, attack: 20, defense: 15, durability: 15, discipline: 5 },
    "orta saha ağırlıkları şartnameyle birebir olmalı");
  assert.deepEqual(POSITION_WEIGHTS.defender,
    { defense: 35, form: 20, durability: 15, discipline: 10, attack: 10, creativity: 10 },
    "defans ağırlıkları şartnameyle birebir olmalı");

  for (const [group, weights] of Object.entries(POSITION_WEIGHTS)) {
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    assert.equal(total, 100, `${group}: ağırlık toplamı 100 olmalı, ${total}`);
  }
}

function testSameStatsScoreDifferentlyByPosition() {
  const stats = {
    statsSource: "api-football:/players",
    stats: {
      appearances: 10, minutesPlayed: 900, goals: 6, assists: 3, shots: 30, shotsOnTarget: 14,
      xg: 5, xa: 2, keyPasses: 18, tackles: 6, interceptions: 5, duelsWon: 40, duelsTotal: 80,
      yellowCards: 2, redCards: 0, foulsCommitted: 10
    }
  };

  const forward = scoresFor({ ...stats, positionGroup: "forward" }, { teamMatchesPlayed: 10 });
  const defender = scoresFor({ ...stats, positionGroup: "defender" }, { teamMatchesPlayed: 10 });

  assert.equal(forward.categories.attack.value, defender.categories.attack.value,
    "kategori puanı mevkiden bağımsız olmalı — fark ağırlıkta yaşar");
  assert.notEqual(forward.categories.overall.value, defender.categories.overall.value,
    "aynı istatistikler iki mevkide aynı overall vermemeli");
}

function testOverallRenormalizesAroundMissingCategories() {
  const scores = scoresFor({
    statsVerifiedFields: ["goals", "assists", "appearances", "minutesPlayed", "yellowCards", "redCards"],
    statsSource: "Manuel doğrulama",
    stats: { appearances: 6, minutesPlayed: 540, goals: 5, assists: 3, yellowCards: 1, redCards: 0 }
  }, { teamMatchesPlayed: 6 });

  assert.equal(scores.categories.defense.status, "insufficient", "savunma ölçümü yok");
  assert.equal(scores.categories.overall.status, "computed",
    "tek eksik kategori bütün tabloyu düşürmemeli");
  assert.ok(scores.categories.overall.coverage < 1, "eksik kategori kapsamada bildirilmeli");
}

// ── 4. KALECİ SİSTEMİ ───────────────────────────────────────────────────────

function testGoalkeeperUsesItsOwnScheme() {
  const keeper = scoresFor({
    positionGroup: "goalkeeper",
    position: "Kaleci",
    statsSource: "api-football:/players",
    stats: {
      appearances: 8, minutesPlayed: 720, saves: 28, goalsConceded: 7, cleanSheets: 3,
      goals: 0, assists: 0, yellowCards: 0, redCards: 0
    }
  }, { teamMatchesPlayed: 8 });

  assert.equal(keeper.scheme, "goalkeeper");
  assert.equal(keeper.categories.attack.status, "not-applicable", "kalecide hücum mevki dışı");
  assert.equal(keeper.categories.attack.display, "Mevki dışı");
  assert.equal(keeper.categories.creativity.status, "not-applicable");
  assert.equal(keeper.categories.defense.label, "Kalecilik", "kaleci satırı kendi sözcüğüyle adlandırılmalı");
  assert.equal(keeper.categories.defense.status, "computed");
  assert.ok(keeper.categories.defense.value >= 60, `28 kurtarış / 7 gol iyi puanlanmalı (${keeper.categories.defense.value})`);
  assert.ok(!("potential" in POSITION_WEIGHTS.goalkeeper) === false, "kalecide potansiyel ağırlığı tanımlı");
}

function testGoalkeeperFormIgnoresGoalContribution() {
  // Kalecinin 0 gol + 0 asisti mevkisinin tanımı; "kötü form" değil.
  const keeper = scoresFor({
    positionGroup: "goalkeeper",
    position: "Kaleci",
    statsVerifiedFields: ["goals", "assists", "appearances", "minutesPlayed", "yellowCards", "redCards"],
    statsSource: "Manuel doğrulama",
    stats: { appearances: 4, minutesPlayed: 360, goals: 0, assists: 0, yellowCards: 0, redCards: 0 }
  }, { teamMatchesPlayed: 4 });

  assert.equal(keeper.categories.form.status, "insufficient",
    "gol katkısından kaleci formu türetilmemeli");
}

// ── 5. DİSİPLİN, SÜREKLİLİK, POTANSİYEL ─────────────────────────────────────

function testDisciplineRewardsFewerCards() {
  const clean = scoresFor({
    statsSource: "api-football:/players",
    stats: { appearances: 10, minutesPlayed: 900, yellowCards: 0, redCards: 0, foulsCommitted: 5 }
  }, { teamMatchesPlayed: 10 });
  const dirty = scoresFor({
    statsSource: "api-football:/players",
    stats: { appearances: 10, minutesPlayed: 900, yellowCards: 7, redCards: 1, foulsCommitted: 30 }
  }, { teamMatchesPlayed: 10 });

  assert.ok(clean.categories.discipline.value > dirty.categories.discipline.value,
    "az olumsuz olay = yüksek puan");
  assert.ok(clean.categories.discipline.value < 100,
    "küçük örneklemde bile mükemmel puan verilmemeli");
}

function testDurabilityNeedsMoreThanASingleAppearance() {
  const single = scoresFor({
    statsSource: "api-football:/players",
    stats: { appearances: 1, minutesPlayed: 90, yellowCards: 0, redCards: 0 }
  });
  assert.equal(single.categories.durability.status, "insufficient",
    "takım paydası bilinmeden tek maçtan süreklilik okunmamalı");

  const withContext = scoresFor({
    statsSource: "api-football:/players",
    stats: { appearances: 1, minutesPlayed: 90, yellowCards: 0, redCards: 0 }
  }, { teamMatchesPlayed: 8 });
  assert.equal(withContext.categories.durability.status, "computed");
  assert.ok(withContext.categories.durability.value < 60,
    "8 maçın 1'inde oynayan oyuncunun sürekliliği düşük olmalı");
}

function testDurabilityIgnoresMismatchedSeasonDenominator() {
  // Kayıt geçen sezonun 21 maçını taşıyor, puan durumu bu sezonun 4'ünü.
  const scores = scoresFor({
    statsSource: "api-football:/players",
    stats: { appearances: 21, minutesPlayed: 812, yellowCards: 5, redCards: 0 }
  }, { teamMatchesPlayed: 4 });

  const labels = scores.categories.durability.inputs.map((item) => item.label);
  assert.ok(!labels.includes("Takım maçlarındaki dakika payı"),
    "oyuncunun maç sayısı takımınkini aşıyorsa takım paydası kullanılmamalı");
}

function testPotentialFavoursYoungerPlayersAtEqualPerformance() {
  const performance = {
    statsSource: "api-football:/players",
    stats: {
      appearances: 10, minutesPlayed: 900, goals: 5, assists: 3, shots: 25, shotsOnTarget: 12,
      tackles: 5, duelsWon: 40, duelsTotal: 80, yellowCards: 1, redCards: 0
    }
  };
  const young = scoresFor({ ...performance, computedAge: 19 }, { teamMatchesPlayed: 10 });
  const veteran = scoresFor({ ...performance, computedAge: 33 }, { teamMatchesPlayed: 10 });

  assert.equal(young.categories.overall.value, veteran.categories.overall.value,
    "yaş mevcut performansı değiştirmemeli");
  assert.ok(young.categories.potential.value > veteran.categories.potential.value,
    "genç oyuncuda gelişim payı daha ağır tartmalı");
  assert.ok(engine.ageHeadroom(19) > engine.ageHeadroom(29), "yaş eğrisi azalan olmalı");
}

// ── 6. MAÇ DEFTERİ ──────────────────────────────────────────────────────────

function testLedgerSkipsFriendliesAndUnfinishedMatches() {
  const ledger = ledgerModule.buildPlayerMatchLedger({
    fixtures: [
      {
        id: "friendly-1", status: "FINISHED", league: "Club Friendlies", kickoff: "2026-07-20T18:00:00Z",
        players: [{ name: "Test Oyuncu", providerPlayerId: "12345", minutes: 90, goals: 3, providerRating: 9 }]
      },
      {
        id: "scheduled-1", status: "SCHEDULED", league: "Süper Lig", kickoff: "2026-09-20T18:00:00Z",
        players: [{ name: "Test Oyuncu", providerPlayerId: "12345", minutes: 0, goals: 0, providerRating: 0 }]
      },
      {
        id: "official-1", status: "FINISHED", league: "Süper Lig", kickoff: "2026-09-13T18:00:00Z",
        players: [{ name: "Test Oyuncu", providerPlayerId: "12345", minutes: 90, goals: 1, providerRating: 7.4 }]
      }
    ]
  });

  const rows = ledgerModule.ledgerFor(ledger, { providerId: "12345", name: "Test Oyuncu" });
  assert.equal(rows.length, 1, "yalnızca bitmiş resmî maç deftere girmeli");
  assert.equal(rows[0].matchId, "official-1");
}

function testLedgerReadsGoalsAndAssistsFromEvents() {
  const rows = ledgerModule.extractMatchRows({
    id: "event-match", status: "FINISHED", competition: "Süper Lig",
    events: [
      { type: "Goal", detail: "Normal Goal", value: "O. Diabate · Asist: D. Goutas · Normal Goal", team: { name: "Gençlerbirliği" } },
      { type: "Goal", detail: "Own Goal", value: "X. Kendi · Own Goal", team: { name: "Kasımpaşa" } },
      { type: "Card", detail: "Yellow Card", value: "O. Diabate · Yellow Card", team: { name: "Gençlerbirliği" } }
    ]
  });

  const scorer = rows.get("name:o diabate");
  assert.ok(scorer, "golü atan oyuncu defterde olmalı");
  assert.equal(scorer.goals, 1);
  assert.equal(scorer.yellowCards, 1);

  const assister = rows.get("name:d goutas");
  assert.equal(assister.assists, 1, "asist olayı asisti yapana yazılmalı");

  const ownGoal = rows.get("name:x kendi");
  assert.ok(!ownGoal.goals, "kendi kalesine gol hücum üretimi sayılmamalı");
}

// ── 7. GÖRÜNÜM KATMANI ──────────────────────────────────────────────────────

function testComparisonRowMarksTheHigherValue() {
  const left = { name: "A", ratingScores: { scheme: "outfield", categories: { overall: { value: 70, status: "computed" } } } };
  const right = { name: "B", ratingScores: { scheme: "outfield", categories: { overall: { value: 91, status: "computed" } } } };

  const row = view.comparisonRowModel([left, right], "overall");
  assert.equal(row.cells[0].leading, false);
  assert.equal(row.cells[1].leading, true, "yüksek olan değer vurgulanmalı");
  assert.equal(row.label, "Overall");
}

function testComparisonRowDoesNotCrownATie() {
  const left = { name: "A", ratingScores: { scheme: "outfield", categories: { form: { value: 80, status: "computed" } } } };
  const right = { name: "B", ratingScores: { scheme: "outfield", categories: { form: { value: 80, status: "computed" } } } };

  const row = view.comparisonRowModel([left, right], "form");
  assert.ok(row.cells.every((cell) => !cell.leading), "eşitlikte lider vurgusu yapılmamalı");
}

function testComparisonTableNeverPrintsABareDash() {
  const left = {
    name: "Ölçülmüş",
    ratingScores: {
      scheme: "outfield",
      categories: Object.fromEntries(RATING_CATEGORY_ORDER.map((key) => [key, { value: 70, status: "computed" }]))
    }
  };
  const right = { name: "Ölçümsüz", ratingScores: { scheme: "outfield", status: "insufficient" } };

  const html = view.comparisonRatingTableHtml([left, right], { updatedLabel: "14 Eylül 2026" });
  assert.ok(html.includes("Veri yetersiz"), "ölçüm yoksa gerekçe basılmalı");
  assert.ok(!/>\s*-\s*</.test(html), "hiçbir hücrede çıplak tire olmamalı");
  assert.ok(html.includes("Son güncelleme: 14 Eylül 2026"), "güncelleme tarihi basılmalı");
  assert.ok(html.includes("rating-bar-fill"), "yatay çubuk basılmalı");
  assert.ok(html.includes("<details"), "kategori detayı açılabilir olmalı");
}

function testSchemaPropertiesOnlyCarryComputedValues() {
  const player = {
    name: "Test",
    ratingScores: {
      scheme: "outfield",
      categories: {
        overall: { value: 88, status: "computed" },
        form: { value: null, status: "insufficient" },
        attack: { value: 91, status: "computed" }
      }
    }
  };

  const properties = view.ratingAdditionalProperties(player);
  assert.equal(properties.length, 2, "hesaplanamayan kategori schema.org'a girmemeli");
  assert.ok(properties.every((item) => typeof item.value === "number"), "değerler sayı olmalı");
  assert.ok(properties.every((item) => item.maxValue === 100), "ölçek beyan edilmeli");
}

const tests = [
  testUnmeasuredZerosAreNotTreatedAsMeasurements,
  testExplicitProvenanceMakesZeroAMeasurement,
  testPartialVerificationLimitsMeasuredFields,
  testPlaceholderIdentityWithholdsEveryScore,
  testEveryScoreStaysInRange,
  testSmallSampleIsShrunkTowardBaseline,
  testSourcesKeepTheirOwnMinuteBasis,
  testPositionWeightsMatchSpecification,
  testSameStatsScoreDifferentlyByPosition,
  testOverallRenormalizesAroundMissingCategories,
  testGoalkeeperUsesItsOwnScheme,
  testGoalkeeperFormIgnoresGoalContribution,
  testDisciplineRewardsFewerCards,
  testDurabilityNeedsMoreThanASingleAppearance,
  testDurabilityIgnoresMismatchedSeasonDenominator,
  testPotentialFavoursYoungerPlayersAtEqualPerformance,
  testLedgerSkipsFriendliesAndUnfinishedMatches,
  testLedgerReadsGoalsAndAssistsFromEvents,
  testComparisonRowMarksTheHigherValue,
  testComparisonRowDoesNotCrownATie,
  testComparisonTableNeverPrintsABareDash,
  testSchemaPropertiesOnlyCarryComputedValues
];

let failed = 0;
for (const test of tests) {
  try {
    test();
    console.log(`  ✓ ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${test.name}\n    ${error.message}`);
  }
}

if (failed) {
  console.error(`\nplayer-rating-engine: ${failed} test başarısız`);
  process.exit(1);
}
console.log(`\nplayer-rating-engine: ${tests.length} test geçti`);
