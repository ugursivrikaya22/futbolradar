/**
 * MAÇ SONRASI ANALİZ KATMANI TESTLERİ
 *
 * Sözleşme:
 *   1. Rapor YALNIZCA tamamlanmış maç için üretilir.
 *   2. Momentum, sağlayıcının dakikalı olay akışından TÜRETİLİR. Dakikası
 *      okunamayan olay sayıma girmez; varsayılan dakika atanmaz.
 *   3. Her sinyal tek bir ölçülmüş istatistiğe dayanır ve hangi ölçüden
 *      geldiğini taşır. Ölçü yoksa sinyal üretilmez.
 *   4. Veri eksikse bölüm gizlenmez, gerekçesiyle "veri yok" der.
 *   5. Kısmi veri raporu düşürmez: bir bölüm boşken diğerleri yayımlanır.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const service = require("../services/matchReportService.js");

const finished = {
  id: "test-match",
  homeTeam: "Ev Takımı",
  awayTeam: "Deplasman",
  league: "Test Ligi",
  status: "FINISHED",
  score: { home: 2, away: 1 },
  kickoff: "2026-07-26T20:00:00+03:00",
  events: [
    { time: "12'", team: { name: "Ev Takımı" }, type: "Gol", detail: "Ali Veli skoru açtı." },
    { time: "37'", team: { name: "Deplasman" }, type: "Gol", detail: "Can Demir beraberliği sağladı." },
    { time: "68'", team: { name: "Ev Takımı" }, type: "Gol", detail: "Ali Veli farkı yeniden kurdu." },
    { time: "90+3'", team: { name: "Ev Takımı" }, type: "Kurtarış", detail: "Kaleci son anda çeldi." }
  ],
  statistics: [
    { type: "Topla oynama", home: 62, away: 38, unit: "%" },
    { type: "Toplam şut", home: 14, away: 6 },
    { type: "Korner", home: 7, away: 3 }
  ]
};

function testOnlyFinishedMatchesGetReports() {
  for (const status of ["SCHEDULED", "LIVE", "1H", "HT", "POSTPONED", ""]) {
    assert.equal(
      service.buildMatchReport({ ...finished, status }, {}), null,
      `"${status}" durumundaki maç için rapor üretilmemeli`
    );
  }
  assert.ok(service.buildMatchReport(finished, {}), "tamamlanmış maç rapor almalı");
}

function testMomentumIsDerivedFromRealEvents() {
  const momentum = service.buildMomentum(finished);
  assert.equal(momentum.status, "ready");
  assert.equal(momentum.sampleSize, 4, "dört dakikalı olay sayılmalı");
  assert.equal(momentum.phases.length, 3, "üç dilim üretilmeli");

  const first = momentum.phases[0];
  assert.equal(first.home, 1, "0-30 diliminde ev sahibi bir olay");
  assert.equal(first.away, 0);
  assert.equal(first.leader, "Ev Takımı");

  // 90+3 uzatma dakikası son dilime düşmeli, kaybolmamalı.
  const last = momentum.phases[momentum.phases.length - 1];
  assert.ok(last.events >= 2, "uzatma dakikası son dilime dahil edilmeli");

  assert.ok(momentum.readings.some((line) => /İlk gol 12/.test(line)), "ilk gol dakikasıyla anılmalı");
}

function testMomentumRefusesWithoutEnoughTimedEvents() {
  // Dakikası olmayan olaylar sayıma girmemeli.
  const untimed = { ...finished, events: [
    { team: { name: "Ev Takımı" }, type: "Gol", detail: "Dakika bilinmiyor." },
    { time: "", team: { name: "Deplasman" }, type: "Gol", detail: "Dakika bilinmiyor." }
  ] };
  const result = service.buildMomentum(untimed);
  assert.equal(result.status, "unavailable", "dakikasız olaylardan momentum çıkarılmamalı");
  assert.ok(result.reason, "gerekçe yazılmalı");

  // Tek olay momentum için yeterli değil.
  const single = { ...finished, events: [finished.events[0]] };
  assert.equal(service.buildMomentum(single).status, "unavailable", "tek olaydan momentum çizilmemeli");

  assert.equal(service.buildMomentum({ ...finished, events: [] }).status, "unavailable");
}

function testMomentumConfidenceTracksSampleSize() {
  assert.equal(service.buildMomentum(finished).confidence, "orta", "dört olay orta güven");

  const many = { ...finished, events: [
    ...finished.events,
    { time: "20'", team: { name: "Deplasman" }, type: "Korner", detail: "-" },
    { time: "55'", team: { name: "Deplasman" }, type: "Sarı kart", detail: "-" }
  ] };
  assert.equal(service.buildMomentum(many).confidence, "yüksek", "altı olay yüksek güven");
}

function testSignalsCiteTheirMetric() {
  const signals = service.buildSignals(finished);
  assert.equal(signals.status, "ready");
  assert.ok(signals.signals.length >= 3, "ölçülen her fark sinyal üretmeli");

  for (const signal of signals.signals) {
    assert.ok(signal.metric, "sinyal hangi ölçüden geldiğini taşımalı");
    assert.ok(signal.team, "sinyalin sahibi belirtilmeli");
    assert.ok(/^\d+(\.\d+)?-\d+(\.\d+)?$/.test(signal.value), `değer çifti taşınmalı: ${signal.value}`);
  }

  const control = signals.signals.find((signal) => signal.metric === "Topla oynama");
  assert.equal(control.team, "Ev Takımı", "üstün taraf doğru seçilmeli");
  assert.equal(control.strong, true, "%62 kontrol eşiği aşmalı");
}

function testSignalsRefuseWithoutStatistics() {
  const noStats = service.buildSignals({ ...finished, statistics: [] });
  assert.equal(noStats.status, "unavailable", "istatistik yoksa sinyal üretilmemeli");
  assert.ok(/istatistik/i.test(noStats.reason), "gerekçe ölçü eksikliğini söylemeli");

  // Ölçü var ama fark yok: sinyal uydurulmamalı.
  const tied = service.buildSignals({
    ...finished,
    statistics: [{ type: "Topla oynama", home: 50, away: 50 }]
  });
  assert.equal(tied.status, "unavailable", "eşit ölçüden sinyal çıkarılmamalı");
}

function testPartialDataStillPublishesReport() {
  // Olaylar var, istatistik yok: momentum dolu, sinyaller boş, rapor yayımda.
  const partial = { ...finished, statistics: [] };
  const report = service.buildMatchReport(partial, {});

  assert.ok(report, "kısmi veri raporu düşürmemeli");
  assert.equal(report.sections.momentum.status, "ready");
  assert.equal(report.sections.signals.status, "unavailable");
  assert.ok(report.sections.signals.reason, "boş bölüm gerekçesini taşımalı");
  assert.ok(report.coverage > 0 && report.coverage < 100, `kapsam kısmi olmalı: ${report.coverage}`);
}

function testRealMatchesProduceHonestCoverage() {
  const matches = require("../data/matches.json")
    .filter((match) => String(match.status).toUpperCase() === "FINISHED");

  assert.ok(matches.length, "ön koşul: tamamlanmış maç bulunmalı");

  let momentumReady = 0;
  let signalsReady = 0;

  for (const match of matches) {
    const report = service.buildMatchReport(match, {});
    assert.ok(report, `${match.id}: tamamlanmış maç rapor almalı`);

    for (const key of ["momentum", "signals"]) {
      const section = report.sections[key];
      assert.ok(section, `${match.id}: ${key} bölümü bulunmalı`);
      if (section.status === "ready") {
        if (key === "momentum") momentumReady += 1;
        else signalsReady += 1;
      } else {
        assert.ok(section.reason, `${match.id}: ${key} boşsa gerekçesi yazılmalı`);
      }
    }
  }

  // Gerçek durum: olay akışı çoğu maçta var, istatistik dökümü yalnızca
  // birinde. Bu testi sabitlemiyoruz — yalnızca sinyallerin istatistik
  // OLMADAN üretilmediğini doğruluyoruz.
  const withStats = matches.filter((match) => (match.statistics || []).length).length;
  assert.equal(
    signalsReady <= withStats, true,
    `sinyal, istatistiği olmayan maçtan üretilmemeli (sinyal: ${signalsReady}, istatistikli maç: ${withStats})`
  );
  assert.ok(momentumReady > 0, "olay akışı olan maçlarda momentum üretilmeli");
}

const tests = [
  testOnlyFinishedMatchesGetReports,
  testMomentumIsDerivedFromRealEvents,
  testMomentumRefusesWithoutEnoughTimedEvents,
  testMomentumConfidenceTracksSampleSize,
  testSignalsCiteTheirMetric,
  testSignalsRefuseWithoutStatistics,
  testPartialDataStillPublishesReport,
  testRealMatchesProduceHonestCoverage
];

for (const test of tests) {
  test();
}

console.log(`Post-match analysis tests passed (${tests.length} senaryo: yalnızca tamamlanmış maç, ` +
  "olaydan momentum, dakikasız olay reddi, güven ölçeği, ölçüye dayalı sinyal, istatistiksiz sinyal reddi, " +
  "kısmi veri, gerçek veri kapsamı).");
