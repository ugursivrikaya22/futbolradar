/**
 * MAÇ SONRASI ANALİZ KARTI TESTLERİ
 *
 * Sözleşme:
 *   1. Kart YALNIZCA tamamlanmış maç için üretilir.
 *   2. Tamamlanmış HİÇBİR maç sessizce atlanmaz — verisi ince olan da kart alır.
 *   3. Her kart beş alanı da taşır: özet, kırılma anı, takım performansı,
 *      veri kapsamı, güven seviyesi.
 *   4. Dayanağı olmayan alan uydurulmaz: `status: "unavailable"` olur ve
 *      gerekçesi (`reason`) BOŞ OLAMAZ.
 *   5. Verisi yetersiz kart gizlenmez, "Veri yetersiz" etiketiyle yayımlanır.
 *   6. Kapsam yalnızca gerçekten ölçülmüş girdileri sayar; kart dökümü gibi
 *      analitik okuma üretmeyen istatistik tam kapsam sayılmaz.
 *   7. Statik üretici ile istemci boyaması aynı kart iskeletini kurar.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const service = require("../services/postMatchAnalysisService.js");

const richMatch = {
  id: "rich-match",
  league: "Test Ligi",
  kickoff: "2026-07-21T21:00:00+03:00",
  venue: "Test Stadyumu",
  homeTeam: "Ev Takımı",
  awayTeam: "Deplasman",
  status: "FINISHED",
  score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 0 },
  events: [
    { time: "12'", team: { name: "Ev Takımı" }, type: "Gol", detail: "Ali Veli skoru açtı." },
    { time: "37'", team: { name: "Deplasman" }, type: "Gol", detail: "Can Demir beraberliği sağladı." },
    { time: "68'", team: { name: "Ev Takımı" }, type: "Gol", detail: "Ali Veli farkı yeniden kurdu." }
  ],
  lineups: [
    { team: "Ev Takımı", formation: "4-3-3", players: [] },
    { team: "Deplasman", formation: "4-4-2", players: [] }
  ],
  statistics: [
    { type: "Topla oynama", home: 62, away: 38, unit: "%" },
    { type: "Toplam şut", home: 14, away: 6 },
    { type: "İsabetli şut", home: 7, away: 2 },
    { type: "Gol beklentisi (xG)", home: 1.9, away: 0.7, decimals: 2 },
    { type: "Pas isabeti", home: 88, away: 74, unit: "%" },
    { type: "Korner", home: 7, away: 3 }
  ]
};

/** Sağlayıcıdan yalnızca skoru gelen maç: sitede en sık karşılaşılan durum. */
const scoreOnlyMatch = {
  id: "score-only-match",
  league: "Hazırlık Maçı",
  kickoff: "2026-07-27T21:00:00+03:00",
  homeTeam: "Ev Takımı",
  awayTeam: "Deplasman",
  status: "FINISHED",
  score: { home: 0, away: 3 }
};

/** Yalnızca disiplin dökümü gelen maç: istatistik "var" ama okuma üretmez. */
const disciplineOnlyMatch = {
  ...scoreOnlyMatch,
  id: "discipline-only-match",
  statistics: [
    { type: "Sarı kart", home: 2, away: 1 },
    { type: "Kırmızı kart", home: 0, away: 1 }
  ]
};

function testOnlyFinishedMatchesGetCards() {
  for (const status of ["SCHEDULED", "LIVE", "1H", "HT", "POSTPONED", "CANCELLED", ""]) {
    assert.equal(
      service.buildPostMatchAnalysisCard({ ...richMatch, status }),
      null,
      `"${status}" durumundaki maç için kart üretilmemeli`
    );
  }
  for (const status of ["FINISHED", "FT", "AET", "PEN"]) {
    assert.ok(
      service.buildPostMatchAnalysisCard({ ...richMatch, status }),
      `"${status}" tamamlanmış sayılmalı ve kart almalı`
    );
  }
}

function testEveryFinishedMatchGetsACard() {
  const cards = service.buildPostMatchAnalyses([[richMatch, scoreOnlyMatch, { ...richMatch, id: "x", status: "SCHEDULED" }]]);
  assert.equal(cards.length, 2, "tamamlanmış iki maçın ikisi de kart almalı");
  assert.deepEqual(
    cards.map((card) => card.matchId).sort(),
    ["rich-match", "score-only-match"],
    "verisi ince olan maç listeden düşmemeli"
  );
}

function testCardAlwaysCarriesTheFiveFields() {
  for (const match of [richMatch, scoreOnlyMatch, disciplineOnlyMatch]) {
    const card = service.buildPostMatchAnalysisCard(match);
    for (const field of ["summary", "turningPoint", "teamPerformance", "coverage", "confidence"]) {
      assert.ok(card[field], `${match.id}: "${field}" alanı her kartta bulunmalı`);
    }
    assert.ok(card.dataStatusLabel, `${match.id}: veri durumu etiketi yazılmalı`);
    assert.equal(typeof card.coverage.percent, "number");
    assert.ok(card.confidence.level && card.confidence.label, `${match.id}: güven seviyesi adlandırılmalı`);
  }
}

function testMissingDataIsExplainedNeverInvented() {
  const card = service.buildPostMatchAnalysisCard(scoreOnlyMatch);

  assert.equal(card.summary.status, "ready", "kesin skor varsa özet yazılabilir");
  assert.match(card.summary.text, /3-0/, "özet gerçek skoru kullanmalı");

  assert.equal(card.turningPoint.status, "unavailable", "olay akışı yoksa kırılma anı üretilmemeli");
  assert.ok(card.turningPoint.reason && card.turningPoint.reason.length > 10, "eksik alan gerekçesiz bırakılmamalı");
  assert.equal(card.turningPoint.text, undefined, "gerekçe yerine uydurma bir an yazılmamalı");

  assert.equal(card.teamPerformance.status, "unavailable", "ölçüm yoksa performans notu üretilmemeli");
  assert.ok(card.teamPerformance.reason && card.teamPerformance.reason.length > 10);

  assert.equal(card.dataStatus, "insufficient");
  assert.equal(card.dataStatusLabel, "Veri yetersiz", "yetersiz veri kartın üzerinde açıkça yazmalı");
  assert.equal(card.insufficientData, true);
}

function testRichMatchIsFullyRead() {
  const card = service.buildPostMatchAnalysisCard(richMatch);

  assert.equal(card.dataStatus, "complete");
  assert.equal(card.confidence.level, "high");
  assert.equal(card.coverage.percent, 100);
  assert.equal(card.coverage.missing.length, 0);

  assert.equal(card.turningPoint.status, "ready");
  assert.equal(card.turningPoint.pivotal, true, "gol/penaltı/kırmızı belirleyici an sayılmalı");
  assert.match(card.turningPoint.text, /Ali Veli/, "kırılma anı gerçek olay metnini taşımalı");

  assert.equal(card.teamPerformance.status, "ready");
  for (const side of ["home", "away"]) {
    assert.ok(card.teamPerformance[side].notes.length, `${side}: en az bir performans notu olmalı`);
    for (const note of card.teamPerformance[side].notes) {
      assert.ok(note.text, "not metinsiz olamaz");
      assert.ok(note.basis, "her not dayandığı ölçüyü taşımalı");
    }
  }
}

/**
 * Kart dökümü hücum, kontrol ya da savunma okuması üretmez. İkili bir
 * "istatistik var mı" sorusu, yalnızca sarı/kırmızı kart gelen maçı 26
 * ölçüsü olan maçla aynı kapsama yazıyordu.
 */
function testDisciplineOnlyStatsDoNotClaimFullCoverage() {
  const scoreOnly = service.buildPostMatchAnalysisCard(scoreOnlyMatch);
  const discipline = service.buildPostMatchAnalysisCard(disciplineOnlyMatch);

  assert.equal(
    discipline.coverage.percent, scoreOnly.coverage.percent,
    "analitik okuma üretmeyen istatistik kapsamı yükseltmemeli"
  );
  assert.ok(
    discipline.coverage.missing.includes("Maç istatistikleri"),
    "çekirdek ölçüler gelmediyse istatistik eksik sayılmalı"
  );
  assert.notEqual(discipline.confidence.level, "high");
}

/** Kısmi istatistik kısmi kapsam alır: ne tam sayılır ne de yok sayılır. */
function testPartialStatisticsScorePartialCoverage() {
  const partial = service.buildPostMatchAnalysisCard({
    ...richMatch,
    id: "partial-stats",
    statistics: [
      { type: "Topla oynama", home: 62, away: 38, unit: "%" },
      { type: "Toplam şut", home: 14, away: 6 }
    ]
  });
  const full = service.buildPostMatchAnalysisCard(richMatch);

  assert.ok(partial.coverage.percent < full.coverage.percent, "eksik döküm tam kapsam sayılmamalı");
  assert.ok(partial.coverage.percent > 0);
  assert.ok(
    partial.coverage.partial.includes("Maç istatistikleri"),
    "kısmen gelen döküm 'kısmi' olarak işaretlenmeli"
  );
}

function testSameMatchFromTwoSourcesProducesOneCard() {
  const provider = { ...scoreOnlyMatch, id: "provider-id", source: "thesportsdb" };
  const curated = { ...scoreOnlyMatch, id: "curated-id", venue: "Doğrulanmış Stadyum" };
  const cards = service.buildPostMatchAnalyses([[curated], [provider]]);

  assert.equal(cards.length, 1, "aynı karşılaşma iki kez listelenmemeli");
  assert.equal(cards[0].matchId, "curated-id", "kürasyonlu kayıt öncelikli olmalı");
}

function testCardsAreSortedNewestFirst() {
  const cards = service.buildPostMatchAnalyses([[richMatch, scoreOnlyMatch]]);
  assert.equal(cards[0].matchId, "score-only-match", "en yeni maç başa gelmeli");
}

/**
 * Statik üretici (derleme) ile istemci boyaması (app.js) aynı kart
 * iskeletini kurmalı; biri değişip diğeri geride kalırsa sayfa ilk boyamada
 * bir görünüp yoklamadan sonra başka görünür.
 */
function testStaticAndClientRenderersStayInSync() {
  const generator = fs.readFileSync(path.join(root, "scripts", "generate-post-match-analyses.mjs"), "utf8");
  const client = fs.readFileSync(path.join(root, "app.js"), "utf8");

  const hooks = [
    "post-match-analysis-card",
    "pma-top",
    "pma-status",
    "pma-score",
    "pma-summary",
    "pma-block-title",
    "pma-missing",
    "pma-notes",
    "pma-note-basis",
    "pma-coverage",
    "pma-confidence",
    "Kırılma anı",
    "Takım performansı"
  ];

  for (const hook of hooks) {
    assert.ok(generator.includes(hook), `statik üretici "${hook}" işaretini kaybetmiş`);
    assert.ok(client.includes(hook), `app.js "${hook}" işaretini kaybetmiş`);
  }

  const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
  for (const hook of ["post-match-analysis-grid", ".pma-status", ".pma-missing", ".pma-confidence"]) {
    assert.ok(css.includes(hook), `page.css "${hook}" kuralını taşımalı`);
  }
}

/** Yayımlanan dosya, üretilen kartlarla aynı sözleşmeyi taşımalı. */
function testPublishedDataFileMatchesContract() {
  const file = path.join(root, "data", "post-match-analyses.json");
  if (!fs.existsSync(file)) return;

  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(Array.isArray(payload.analyses), "yayımlanan dosya analiz dizisi taşımalı");
  assert.equal(payload.total, payload.analyses.length, "toplam sayısı listeyle uyuşmalı");

  for (const card of payload.analyses) {
    assert.ok(card.matchId, "her kart maç kimliği taşımalı");
    assert.ok(card.homeTeam && card.awayTeam);
    for (const field of ["summary", "turningPoint", "teamPerformance", "coverage", "confidence"]) {
      assert.ok(card[field], `${card.matchId}: "${field}" alanı eksik`);
    }
    for (const field of ["summary", "turningPoint", "teamPerformance"]) {
      if (card[field].status === "unavailable") {
        assert.ok(card[field].reason, `${card.matchId}: eksik "${field}" gerekçesiz yayımlanmış`);
      }
    }
    assert.ok(
      ["complete", "partial", "insufficient"].includes(card.dataStatus),
      `${card.matchId}: tanımsız veri durumu`
    );
  }
}

testOnlyFinishedMatchesGetCards();
testEveryFinishedMatchGetsACard();
testCardAlwaysCarriesTheFiveFields();
testMissingDataIsExplainedNeverInvented();
testRichMatchIsFullyRead();
testDisciplineOnlyStatsDoNotClaimFullCoverage();
testPartialStatisticsScorePartialCoverage();
testSameMatchFromTwoSourcesProducesOneCard();
testCardsAreSortedNewestFirst();
testStaticAndClientRenderersStayInSync();
testPublishedDataFileMatchesContract();

console.log("Post-match analysis card tests passed (finished-only, no silent drops, five fields, honest coverage, static/client parity).");
