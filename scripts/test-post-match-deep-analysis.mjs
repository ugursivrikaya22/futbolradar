/**
 * 96 SAATLİK MAÇ SONU DERİN ANALİZ SİSTEMİ TESTLERİ.
 *
 * Korunan sözleşmeler:
 *   1. Kayan pencere sınırları ve İstanbul saat dilimi doğru işlenir.
 *   2. Yalnızca FT/AET/PEN (FINISHED) rapor kimliği alır; NS/TBD/PST/CANC/
 *      ABD/INT/SUSP ve canlı maçlar dışarıda kalır.
 *   3. Terfi idempotenttir: tekrar koşmak kopya kayıt/sayfa üretmez —
 *      ev/deplasman sırası ters kaynakta bile.
 *   4. Kapsam kapısı dürüsttür: eşik tutmayan rapora "Derin Analiz" yazılmaz;
 *      skor-özeti/sınırlı raporlar dizine kapanır (noindex) ve site
 *      haritasına girmez.
 *   5. Momentum türü açık etiketlidir; anlık görüntü yoğunluğu yetersizse
 *      olay bazlı moda düşülür ve bu ölçülmüş baskı gibi sunulmaz.
 *   6. Taktik çıkarımlar kanıt + güven + measured/inferred taşır; veri
 *      kanıtlamadan kesin diziliş iddia edilmez.
 *   7. xG ve benzeri ölçüler UYDURULMAZ; eksik istatistik hüküm üretmez.
 *   8. Görünürlük sırası Türk takımlarını öne alır ama üretimi etkilemez.
 *   9. Yayın günlüğü geri tarihleme yapmaz; içerik değişmeden tarih oynamaz.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const deep = require("../services/postMatchDeepAnalysis.js");
const backfill = require("../services/postMatchBackfillService.js");
const snapshots = require("../services/liveSnapshotService.js");

// ── Yardımcı kurgular ───────────────────────────────────────────────────────

function fullMatch(overrides = {}) {
  return {
    id: "ornek-mac-2026-07-28",
    providerId: "999001",
    kickoff: "2026-07-28T21:00:00+03:00",
    league: "UEFA Şampiyonlar Ligi",
    homeTeam: "Ev FK",
    awayTeam: "Konuk SK",
    status: "FINISHED",
    score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 1 },
    lineups: [
      { team: "Ev FK", formation: "4-2-3-1", players: Array.from({ length: 11 }, (_, i) => `Ev Oyuncu ${i + 1}`) },
      { team: "Konuk SK", formation: "4-3-3", players: Array.from({ length: 11 }, (_, i) => `Konuk Oyuncu ${i + 1}`) }
    ],
    substitutions: [],
    events: [
      { time: "10'", team: { name: "Ev FK" }, type: "Gol", detail: "Ev Oyuncu 9 skoru 1-0 yaptı." },
      { time: "35'", team: { name: "Konuk SK" }, type: "Gol", detail: "Konuk Oyuncu 9 skoru 1-1 yaptı." },
      { time: "60'", team: { name: "Ev FK" }, type: "Gol", detail: "Ev Oyuncu 10 skoru 2-1 yaptı." },
      { time: "70'", team: { name: "Konuk SK" }, type: "Şut", detail: "Uzaktan deneme auta gitti." },
      { time: "80'", team: { name: "Ev FK" }, type: "Kurtarış", detail: "Yakın mesafe şutunda kaleci gole izin vermedi." }
    ],
    statistics: [
      { category: "Genel", type: "Topla oynama", home: 55, away: 45, unit: "%" },
      { category: "Hücum", type: "Toplam şut", home: 14, away: 9 },
      { category: "Hücum", type: "İsabetli şut", home: 6, away: 3 },
      { category: "Genel", type: "Korner", home: 7, away: 4 },
      { category: "Disiplin", type: "Faul", home: 10, away: 12 },
      { category: "Pas", type: "Toplam pas", home: 500, away: 400 },
      { category: "Pas", type: "İsabetli pas", home: 430, away: 320 },
      { category: "Savunma", type: "Kaleci kurtarışı", home: 2, away: 4 }
    ],
    source: "manual_verified",
    sourceUrls: ["https://example.com/kaynak"],
    dataStatus: "verified",
    lastVerifiedAt: "2026-07-28T23:45:00+03:00",
    ...overrides
  };
}

function scoreOnlyMatch(overrides = {}) {
  return {
    id: "takvim-maci-2026-07-28",
    kickoff: "2026-07-28T19:00:00+03:00",
    league: "Hazırlık Maçı",
    homeTeam: "Yabancı A",
    awayTeam: "Yabancı B",
    status: "FINISHED",
    score: { home: 0, away: 3 },
    lineups: [],
    substitutions: [],
    events: [],
    statistics: [],
    source: "thesportsdb",
    dataStatus: "provider",
    ...overrides
  };
}

// ── 1-2. Pencere sınırı, saat dilimi ve durum süzgeci ───────────────────────

function testRollingWindowBoundary() {
  const now = Date.parse("2026-07-29T21:00:00Z");
  const window = backfill.windowFor(now, 96);

  // Kesin sınır: tahmini bitişi tam pencere başında olan maç İÇERİDE kalır.
  const boundaryKickoffMs = window.startMs - backfill.FULL_TIME_MINUTES * 60 * 1000;
  const boundary = scoreOnlyMatch({ kickoff: new Date(boundaryKickoffMs).toISOString() });
  assert.equal(backfill.isEligible(boundary, window), true, "pencere başlangıcındaki maç dahil olmalı");

  const justOutside = scoreOnlyMatch({ kickoff: new Date(boundaryKickoffMs - 60 * 1000).toISOString() });
  assert.equal(backfill.isEligible(justOutside, window), false, "penceredən 1 dakika eski maç dışarıda kalmalı");

  // İstanbul saat dilimli kickoff (+03:00) doğru ayrıştırılır: 96 saatlik
  // pencerenin içindeki TRT akşam maçı uygun sayılır.
  const istanbulEvening = scoreOnlyMatch({ kickoff: "2026-07-28T21:30:00+03:00" });
  assert.equal(backfill.isEligible(istanbulEvening, window), true, "TRT kickoff'u yanlış dilimle dışarı düşmemeli");

  // Gelecek maç pencere sonunun ötesinde: dahil edilmez.
  const future = scoreOnlyMatch({ kickoff: "2026-07-29T23:00:00Z" });
  assert.equal(backfill.isEligible(future, window), false, "bitmemiş/gelecek maç dahil edilmemeli");
}

function testStatusFilters() {
  const now = Date.parse("2026-07-29T21:00:00Z");
  const window = backfill.windowFor(now, 96);

  for (const status of ["FT", "AET", "PEN", "FINISHED"]) {
    const match = scoreOnlyMatch({ status, kickoff: "2026-07-28T19:00:00+03:00" });
    assert.equal(backfill.isFinished(match), true, `${status} bitmiş sayılmalı`);
    assert.equal(backfill.isEligible(match, window), true, `${status} pencere içinde uygun olmalı`);
  }

  for (const status of ["NS", "TBD", "PST", "CANC", "ABD", "INT", "SUSP", "SCHEDULED", "LIVE", "HALFTIME", "1H", "HT"]) {
    const match = scoreOnlyMatch({ status, kickoff: "2026-07-28T19:00:00+03:00" });
    assert.equal(backfill.isEligible(match, window), false, `${status} rapor kimliği almamalı`);
  }

  // Skoru doğrulanmamış "bitmiş" kayıt da reddedilir: skor uydurulmaz.
  const noScore = scoreOnlyMatch({ score: { home: null, away: null } });
  assert.equal(backfill.isEligible(noScore, window), false, "skorsuz maç uygun sayılmamalı");
}

// ── 3. Terfi idempotentliği ─────────────────────────────────────────────────

function testPromotionIdempotency() {
  const now = Date.parse("2026-07-29T21:00:00Z");
  const window = backfill.windowFor(now, 96);
  const calendar = [scoreOnlyMatch({ id: "cal-1" })];

  const first = backfill.promoteCalendarFixtures([], calendar, window, "2026-07-29T21:00:00Z");
  assert.equal(first.additions.length, 1, "ilk koşu terfi etmeli");
  assert.equal(first.additions[0].source, "thesportsdb", "terfi kaydı gerçek sağlayıcı kaynağını taşımalı");
  assert.ok(!JSON.stringify(first.additions[0]).includes("mock"), "terfi kaydında mock kimlik olmamalı");

  const second = backfill.promoteCalendarFixtures(first.additions, calendar, window, "2026-07-29T22:00:00Z");
  assert.equal(second.additions.length, 0, "ikinci koşu kopya üretmemeli");
  assert.ok(second.skipped.some((row) => row.reason.includes("idempotent")), "atlama gerekçesi yazılmalı");

  // Ev/deplasman sırası ters kaynak bile aynı maçtır.
  const flipped = [scoreOnlyMatch({ id: "cal-flip", homeTeam: "Yabancı B", awayTeam: "Yabancı A" })];
  const third = backfill.promoteCalendarFixtures(first.additions, flipped, window, "2026-07-29T22:00:00Z");
  assert.equal(third.additions.length, 0, "taraf sırası ters kopya yakalanmalı");
}

// ── 4-5. Kapsam kapısı ve seviye dürüstlüğü ─────────────────────────────────

function testCoverageGate() {
  const full = fullMatch();
  const withoutPlayers = deep.assessCoverage(full, { playerStats: false });
  assert.equal(withoutPlayers.score, 75, `oyuncu istatistiği olmadan kapsam 75 olmalı (=${withoutPlayers.score})`);
  assert.equal(deep.levelFor(withoutPlayers.score).level, "standard", "75 puan standart seviyedir; derin DEĞİL");

  const withPlayers = deep.assessCoverage(full, { playerStats: true });
  assert.equal(withPlayers.score, 100, "tüm bloklar doluyken kapsam 100 olmalı");
  assert.equal(deep.levelFor(withPlayers.score).level, "deep", "100 puan derin analiz");
  assert.equal(deep.levelFor(withPlayers.score).label, "Derin Analiz");

  const bare = deep.assessCoverage(scoreOnlyMatch(), { playerStats: false });
  assert.equal(bare.score, 10, "yalnız skor+künye 10 puandır");
  assert.equal(deep.levelFor(bare.score).level, "score-only", "10 puan skor özetidir");

  // Eşik sınırları: 79 standart, 80 derin; 19 skor özeti, 20 sınırlı.
  assert.equal(deep.levelFor(79).level, "standard");
  assert.equal(deep.levelFor(80).level, "deep");
  assert.equal(deep.levelFor(19).level, "score-only");
  assert.equal(deep.levelFor(20).level, "limited");
}

function testRobotsGating() {
  assert.equal(deep.robotsFor("deep"), "index,follow");
  assert.equal(deep.robotsFor("standard"), "index,follow");
  assert.equal(deep.robotsFor("limited"), "noindex,follow", "sınırlı rapor dizine kapanmalı");
  assert.equal(deep.robotsFor("score-only"), "noindex,follow", "skor özeti dizine kapanmalı");
}

// ── 5. Momentum modları ─────────────────────────────────────────────────────

function testMomentumEventFallback() {
  const noSnapshots = deep.momentumModeFor(fullMatch(), null);
  assert.equal(noSnapshots.mode, "event");
  assert.ok(noSnapshots.label.includes("Olay bazlı"), "olay bazlı etiket şart");
  assert.equal(noSnapshots.note, deep.EVENT_MOMENTUM_NOTE, "dürüstlük notu birebir yazılmalı");

  // Yoğunluk yetersiz (2 kova) → yine olay bazlı.
  const sparse = { buckets: [{ minute: 10 }, { minute: 15 }] };
  assert.equal(deep.momentumModeFor(fullMatch(), sparse).mode, "event", "seyrek görüntü ölçülmüş sayılmamalı");

  const dense = { buckets: Array.from({ length: 8 }, (_, i) => ({ minute: (i + 1) * 10 })) };
  const measured = deep.momentumModeFor(fullMatch(), dense);
  assert.equal(measured.mode, "measured");
  assert.ok(measured.label.includes("Ölçülmüş canlı veri"), "ölçülmüş etiket şart");
}

function testSnapshotRecordingAndDeltas() {
  const store = {};
  const match = { id: "canli-mac", providerId: "555", homeTeam: "Ev FK", awayTeam: "Konuk SK" };
  const detailAt = (minute, shotsHome, shotsAway) => ({
    minute,
    score: { home: 0, away: 0 },
    statistics: [
      { type: "Toplam şut", home: shotsHome, away: shotsAway },
      { type: "İsabetli şut", home: Math.floor(shotsHome / 2), away: Math.floor(shotsAway / 2) },
      { type: "Korner", home: 1, away: 1 }
    ]
  });

  assert.ok(snapshots.recordSnapshot(store, match, detailAt(12, 3, 1), "t1"), "ilk kova yazılmalı");
  assert.equal(snapshots.recordSnapshot(store, match, detailAt(13, 4, 1), "t2"), null, "aynı beş dakikalık kovaya ikinci yazım reddedilmeli");
  assert.ok(snapshots.recordSnapshot(store, match, detailAt(18, 6, 2), "t3"), "sonraki kova yazılmalı");

  // Dakikasız ya da istatistiksiz detay görüntü ÜRETMEZ.
  assert.equal(snapshots.recordSnapshot(store, match, { minute: null, statistics: [] }, "t4"), null);
  assert.equal(snapshots.recordSnapshot(store, match, { minute: 25, statistics: [] }, "t5"), null, "ölçüsüz detay kova üretmemeli");

  const intervals = snapshots.measuredIntervals(store[match.id]);
  assert.equal(intervals.length, 1, "iki kovadan bir aralık türemeli");
  assert.equal(intervals[0].deltas.totalShots.home, 3, "kümülatif fark doğru hesaplanmalı (6-3)");
  const pressure = snapshots.pressureReading(intervals[0]);
  assert.ok(pressure.home > pressure.away, "baskı okuması ölçülen farkı yansıtmalı");
}

// ── 6. Taktik çıkarımlar ────────────────────────────────────────────────────

function testTacticalInference() {
  const players = new Map([
    ["hucumcu can", { position: "Forvet", positionGroup: "forward" }],
    ["stoper veli", { position: "Stoper", positionGroup: "defender" }],
    ["kanat efe", { position: "Sol kanat", positionGroup: "winger" }],
    ["orta saha ali", { position: "Merkez orta saha", positionGroup: "midfielder" }]
  ]);

  // Geride olan takım stoper çıkarıp forvet alıyor → riskli yapı çıkarımı.
  const trailing = fullMatch({
    events: [{ time: "20'", team: { name: "Ev FK" }, type: "Gol", detail: "Ev Oyuncu 9 skoru 1-0 yaptı." }],
    substitutions: [{ time: "60'", team: "Konuk SK", in: "Hücumcu Can", out: "Stoper Veli" }]
  });
  const changes = deep.tacticalChangesFor(trailing, { playersByName: players });
  const risky = changes.find((change) => change.change.includes("Hücumcu Can"));
  assert.ok(risky, "değişiklik yorumlanmalı");
  assert.ok(risky.likelyPurpose.includes("riskli"), "geride+hücumcu değişimi riskli yapıya işaret etmeli");
  assert.equal(risky.type, "inferred", "canlı ölçüm yokken çıkarım 'inferred' olmalı");
  assert.ok(["orta", "düşük"].includes(risky.confidence), "çıkarım güveni ihtiyatlı olmalı");
  assert.ok(risky.evidence.length >= 2, "kanıt satırları yazılmalı");
  assert.ok(!/\d-\d-\d/.test(risky.likelyPurpose), "veri olmadan kesin diziliş (ör. 4-3-3) iddia edilmemeli");

  // Önde olan takım forvet çıkarıp stoper alıyor → skor koruma.
  const leading = fullMatch({
    events: [{ time: "20'", team: { name: "Ev FK" }, type: "Gol", detail: "Ev Oyuncu 9 skoru 1-0 yaptı." }],
    substitutions: [{ time: "70'", team: "Ev FK", in: "Stoper Veli", out: "Hücumcu Can" }]
  });
  const protect = deep.tacticalChangesFor(leading, { playersByName: players })
    .find((change) => change.change.includes("Stoper Veli"));
  assert.ok(protect.likelyPurpose.includes("koruma"), "önde+savunmacı değişimi skor korumaya işaret etmeli");

  // Rol verisi bilinmeyen oyuncular → amaç kesinleştirilemez, güven düşük.
  const unknown = deep.tacticalChangesFor(fullMatch({
    substitutions: [{ time: "55'", team: "Ev FK", in: "Bilinmeyen Bir", out: "Bilinmeyen İki" }]
  }), { playersByName: players }).find((change) => change.change.includes("Bilinmeyen"));
  assert.ok(unknown.likelyPurpose.includes("kesinleştirilemiyor"), "verisiz değişiklik ihtiyatlı kalmalı");
  assert.equal(unknown.confidence, "düşük");

  // Kırmızı kart alçak blok çıkarımı üretir ama kesin yapı iddia etmez.
  const redCard = deep.tacticalChangesFor(fullMatch({
    events: [{ time: "50'", team: { name: "Konuk SK" }, type: "Kırmızı kart", detail: "Konuk Oyuncu 4 oyundan atıldı." }]
  }), { playersByName: players }).find((change) => change.change.includes("Kırmızı"));
  assert.ok(redCard, "kırmızı kart taktik değişiklik sayılmalı");
  assert.ok(redCard.likelyPurpose.includes("muhtemel"), "kırmızı kart yorumu ihtiyatlı dille yazılmalı");

  // Devre arası çoklu değişiklik plan reddine işaret eder.
  const halftime = deep.tacticalChangesFor(fullMatch({
    substitutions: [
      { time: "46'", team: "Ev FK", in: "Kanat Efe", out: "Orta Saha Ali" },
      { time: "46'", team: "Ev FK", in: "Hücumcu Can", out: "Stoper Veli" }
    ]
  }), { playersByName: players }).find((change) => change.change.includes("Devre arasında"));
  assert.ok(halftime, "devre arası çoklu değişiklik ayrıca yorumlanmalı");
  assert.ok(halftime.likelyPurpose.includes("planının"), "plan reddi çıkarımı yazılmalı");
}

// ── 7. Uydurma yok ──────────────────────────────────────────────────────────

function testNoFabrication() {
  const bare = scoreOnlyMatch();
  assert.equal(deep.resultVsPerformanceFor(bare), null, "istatistiksiz maçta hüküm üretilmemeli");

  const model = deep.buildDeepModel(bare, { turkishTeams: [] });
  const text = JSON.stringify(model);
  assert.ok(!text.includes('"xg"'), "modelde uydurma xG alanı olmamalı");
  assert.ok(!text.toLowerCase().includes("mock"), "modelde mock kimlik olmamalı");
  assert.ok(model.analysis.limitations.some((line) => line.includes("xG")), "xG yokluğu sınırlama olarak yazılmalı");
  assert.ok(model.analysis.limitations.some((line) => line.includes("Takım istatistikleri")), "istatistik yokluğu açıkça yazılmalı");
  assert.equal(model.analysis.level, "score-only");
  assert.equal(model.analysis.tacticalChanges.length, 0, "verisiz maçta taktik bölümü boş kalmalı (boş başlık basılmaz)");

  // Ölçülmüş maçta hüküm veriye bağlanır.
  const verdict = deep.resultVsPerformanceFor(fullMatch());
  assert.ok(verdict && verdict.evidence.length >= 1, "hüküm kanıt taşımalı");
  assert.ok(verdict.verdict.includes("isabetli şut"), "hüküm ölçülen göstergeye atıf yapmalı");
}

// ── 8. Görünürlük önceliği ──────────────────────────────────────────────────

function testDisplayPriority() {
  const turkish = ["Fenerbahçe", "Galatasaray", "Samsunspor"];

  const fener = { homeTeam: "Górnik Zabrze", awayTeam: "Fenerbahçe", league: "UEFA Şampiyonlar Ligi", kickoff: "2026-07-29T21:00:00+03:00" };
  const foreignUcl = { homeTeam: "Ajax", awayTeam: "Slavia Prag", league: "UEFA Şampiyonlar Ligi", kickoff: "2026-07-29T22:00:00+03:00" };
  const friendly = { homeTeam: "Yabancı A", awayTeam: "Yabancı B", league: "Hazırlık Maçı", kickoff: "2026-07-29T23:00:00+03:00" };

  assert.equal(deep.displayPriorityFor(fener, turkish).rank, 1, "Türk takımı 1. sınıf");
  assert.equal(deep.displayPriorityFor(foreignUcl, turkish).rank, 2, "yabancı ŞL maçı 2. sınıf");
  assert.equal(deep.displayPriorityFor(friendly, turkish).rank, 8, "hazırlık maçı son sınıf");

  const ordered = deep.sortForDisplay([
    { match: friendly, priority: deep.displayPriorityFor(friendly, turkish) },
    { match: foreignUcl, priority: deep.displayPriorityFor(foreignUcl, turkish) },
    { match: fener, priority: deep.displayPriorityFor(fener, turkish) }
  ]);
  assert.equal(ordered[0].match.awayTeam, "Fenerbahçe", "sıralama Türk takımını öne almalı");
  assert.equal(ordered[2].match.league, "Hazırlık Maçı", "hazırlık maçı en sona düşmeli");
}

// ── 9. Yayın günlüğü ────────────────────────────────────────────────────────

function testPublishLog() {
  const log = {};
  const first = deep.publishDatesFor(log, "mac-raporu/ornek.html", "hash-a", "2026-07-29T10:00:00Z");
  assert.equal(first.datePublished, "2026-07-29T10:00:00Z");
  assert.equal(first.dateModified, "2026-07-29T10:00:00Z");

  // Aynı içerikle yeniden üretim tarihleri OYNATMAZ.
  const second = deep.publishDatesFor(log, "mac-raporu/ornek.html", "hash-a", "2026-07-29T11:00:00Z");
  assert.equal(second.datePublished, "2026-07-29T10:00:00Z", "ilk yayın tarihi değişmemeli");
  assert.equal(second.dateModified, "2026-07-29T10:00:00Z", "içerik değişmeden dateModified ilerlememeli");

  // İçerik değişince yalnız dateModified ilerler; geri tarihleme yok.
  const third = deep.publishDatesFor(log, "mac-raporu/ornek.html", "hash-b", "2026-07-29T12:00:00Z");
  assert.equal(third.datePublished, "2026-07-29T10:00:00Z");
  assert.equal(third.dateModified, "2026-07-29T12:00:00Z");
}

// ── 10. Kararlı slug ve model kimliği ───────────────────────────────────────

function testStableIdentity() {
  const model = deep.buildDeepModel(fullMatch(), { turkishTeams: [] });
  assert.equal(model.slug, "ev-fk-konuk-sk-2026-07-28", "slug takımlar+tarihten deterministik türemeli");
  assert.equal(model.fixtureId, "999001", "sağlayıcı kimliği değişmez kimlik olarak taşınmalı");
  const again = deep.buildDeepModel(fullMatch(), { turkishTeams: [] });
  assert.equal(again.slug, model.slug, "aynı maç aynı slug'ı üretmeli");
  assert.equal(model.analysisVersion, 1);
}

// ── Koşum ───────────────────────────────────────────────────────────────────

const tests = [
  testRollingWindowBoundary,
  testStatusFilters,
  testPromotionIdempotency,
  testCoverageGate,
  testRobotsGating,
  testMomentumEventFallback,
  testSnapshotRecordingAndDeltas,
  testTacticalInference,
  testNoFabrication,
  testDisplayPriority,
  testPublishLog,
  testStableIdentity
];

for (const test of tests) test();

console.log(`Post-match deep analysis tests passed (${tests.length} senaryo: kayan pencere sınırı, ` +
  "durum süzgeci, idempotent terfi, kapsam kapısı, robots kapısı, momentum modları, " +
  "anlık görüntü/delta, taktik çıkarım, uydurma yok, Türk takımı önceliği, yayın günlüğü, kararlı kimlik).");
