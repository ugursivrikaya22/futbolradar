/**
 * MAÇ SONRASI ANALİZ SİSTEMİ TESTLERİ
 *
 * Kapsam: tamamlanma tespiti (FT/AET/PEN), "bir kez üret" önbelleği,
 * uydurma veri yasağı, eksik veri etiketi, sunum sırası ve gerçek veride
 * hiçbir bitmiş maçın analizsiz kalmaması.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const {
  PROVIDER_MISSING_LABEL,
  finishLabel,
  finishType,
  isAnalyzableMatch,
  isAwardedMatch,
  isFinishedMatch
} = require("../services/matchStatus.js");
const {
  MODEL_VERSION,
  analysisFingerprint,
  buildReportRecord,
  inputAvailability,
  orderForDisplay,
  syncPostMatchReports
} = require("../services/postMatchReportStore.js");
const { buildMatchReport, buildLateGame, buildFinish } = require("../services/matchReportService.js");
const { buildPostMatchIntelligence } = require("../services/postMatchIntelligence.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");

// --- Tamamlanma tespiti: FT/AET/PEN ---
for (const status of ["FINISHED", "FT", "AET", "PEN", "FULL_TIME", "PENALTIES"]) {
  assert.equal(isFinishedMatch({ status }), true, `${status} tamamlanmış sayılmalı`);
  assert.equal(isAnalyzableMatch({ status }), true, `${status} analiz edilebilir olmalı`);
}

for (const status of ["SCHEDULED", "NS", "LIVE", "1H", "HT", "POSTPONED", "CANCELLED", ""]) {
  assert.equal(isFinishedMatch({ status }), false, `${status || "(boş)"} tamamlanmış sayılmamalı`);
}

// Sağlayıcı alanı da okunur: kürasyonlu kayıt kanonik değeri taşırken
// FT/AET/PEN ayrımı providerStatus'ta durur.
assert.equal(isFinishedMatch({ status: "SCHEDULED", providerStatus: "AET" }), true, "providerStatus da okunmalı");

// Hükmen sonuçlar (AWD/WO) sahada oynanmadı — `isFinishedMatch` false —
// ama analiz hattına GİRERLER: sonuç kesinleşmiştir ve okuyucunun bunu
// görmesi gerekir. Olay/istatistik olmadığı için analiz kaçınılmaz olarak
// "partial_data" olur; uydurulmaz.
assert.equal(isFinishedMatch({ status: "AWARDED" }), false, "Hükmen sonuç sahada oynanmış sayılmaz");
assert.equal(isAwardedMatch({ status: "WO" }), true, "WO hükmen sonuçtur");
assert.equal(isAnalyzableMatch({ status: "WO" }), true, "Hükmen sonuç analiz hattına girmeli");
assert.equal(finishType({ status: "WO" }), "awarded", "Bitiş şekli hükmen olmalı");

assert.equal(finishType({ status: "FT" }), "regular", "FT normal süre");
assert.equal(finishType({ status: "AET" }), "extra-time", "AET uzatma");
assert.equal(finishType({ status: "PEN" }), "penalties", "PEN penaltılar");
assert.equal(finishLabel({ status: "PEN" }), "Penaltı atışlarıyla belirlendi", "Bitiş etiketi yazılmalı");

// --- Rapor servisleri FT/AET/PEN kabul etmeli ---
const aetMatch = {
  id: "test-aet",
  homeTeam: "Trabzonspor",
  awayTeam: "Real Madrid",
  kickoff: "2026-07-30T20:00:00+03:00",
  league: "Hazırlık Maçı",
  status: "AET",
  score: { home: 2, away: 1 },
  events: [
    { time: "37'", type: "Gol", team: "Trabzonspor", detail: "Paul Onuachu sağ kanattan gelen ortada." },
    { time: "88'", type: "Gol", team: "Real Madrid", detail: "Kylian Mbappe ceza sahası dışından." },
    { time: "105'", type: "Gol", team: "Trabzonspor", detail: "Anthony Nwakaeme uzatmada." }
  ],
  statistics: []
};

const aetReport = buildMatchReport(aetMatch, {});
assert.ok(aetReport, "AET maçı rapor üretmeli — eskiden yalnızca FINISHED kabul ediliyordu");
assert.equal(aetReport.sections.finish.type, "extra-time", "Rapor uzatmayı işaretlemeli");
assert.equal(aetReport.sections.finish.wentToExtraTime, true, "wentToExtraTime doğru olmalı");
assert.ok(buildPostMatchIntelligence(aetMatch), "AET maçı analiz katmanına girmeli");

const penIntel = buildPostMatchIntelligence({ ...aetMatch, status: "PEN" });
assert.ok(Array.isArray(penIntel.sections), "PEN maçı analiz katmanına girmeli");

// --- Maç sonu bölümü: yalnızca gerçek olaylardan ---
const late = buildLateGame(aetMatch);
assert.equal(late.status, "ready", "Olay akışı varken son bölüm üretilmeli");
assert.equal(late.from, 75, "Son bölüm 75. dakikadan başlamalı");
assert.equal(late.moments.length, 2, "75+ olayları alınmalı (88' ve 105')");
assert.match(late.verdict, /2 gol/, "Son bölüm golleri sayılmalı");

const noEvents = buildLateGame({ ...aetMatch, events: [] });
assert.equal(noEvents.status, "unavailable", "Olay yoksa son bölüm üretilmemeli");
assert.match(noEvents.reason, /sağlayıcı tarafından sunulmadı/, "Eksik veri sağlayıcıya atfedilmeli");

// Olay akışı VAR ama son bölümde olay YOK: bu ölçülmüş bir bulgudur.
const quietEnd = buildLateGame({
  ...aetMatch,
  events: [{ time: "10'", type: "Gol", team: "Trabzonspor", detail: "Erken gol." }]
});
assert.equal(quietEnd.status, "ready", "Olay akışı varsa bölüm üretilir");
assert.equal(quietEnd.moments.length, 0, "Son bölümde olay yoksa liste boş");
assert.match(quietEnd.verdict, /son 15 dakikasında/, "Olaysız son bölüm ölçüm olarak yazılmalı");

// Uzatma dakikaları doğru sıralanmalı: "90+3" 93 sayılır.
const stoppage = buildLateGame({
  ...aetMatch,
  events: [
    { time: "90+3'", type: "Gol", team: "Trabzonspor", detail: "Son saniye golü." },
    { time: "80'", type: "Sarı Kart", team: "Real Madrid", detail: "Faul." }
  ]
});
assert.deepEqual(stoppage.moments.map((moment) => moment.minute), ["80'", "90+3'"], "Uzatma dakikası doğru sıralanmalı");

assert.equal(buildFinish({ status: "PEN", events: [] }).decidedOnPenalties, true, "PEN penaltı işaretlemeli");

// --- Uydurma yok: veri olmayan bölüm üretilmez ---
const bareMatch = {
  id: "test-bare",
  homeTeam: "Trabzonspor",
  awayTeam: "Eintracht Frankfurt",
  kickoff: "2026-07-26T16:30:00+03:00",
  league: "Hazırlık Maçı",
  status: "FT",
  score: { home: 0, away: 3 },
  events: [],
  statistics: []
};

const bareRecord = buildReportRecord(bareMatch, {});
assert.ok(bareRecord, "Verisi eksik maç da kayıt üretmeli — sessizce atlanmamalı");
assert.equal(bareRecord.providerMissingLabel, PROVIDER_MISSING_LABEL, "Eksik veri etiketi kayıtta olmalı");
assert.equal(PROVIDER_MISSING_LABEL, "Veri sağlayıcı tarafından sunulmadı", "Etiket metni sabit olmalı");

const missingFields = bareRecord.missingInputs.map((item) => item.field);
assert.deepEqual(
  missingFields.sort(),
  ["events", "lineups", "players", "statistics"],
  "Sağlayıcının vermediği alanlar tek tek listelenmeli"
);
assert.equal(bareRecord.digest.turningPoints.moments.length, 0, "Olay yokken kırılma anı uydurulmamalı");
assert.equal(bareRecord.digest.lateGame.status, "unavailable", "Olay yokken son bölüm uydurulmamalı");
assert.equal(bareRecord.digest.analysis.length, 0, "İstatistik yokken analiz bölümü üretilmemeli");
assert.equal(bareRecord.availability.events, 0, "Sayım gerçeği yansıtmalı");

// Skoru da olmayan maçta hiçbir bölüm ölçülmüş değildir → bağımsız sayfa yok.
const scoreless = buildReportRecord({ ...bareMatch, id: "test-scoreless", score: null }, {});
assert.equal(scoreless.publishState, "store-only", "Ölçülmüş bölüm yoksa bağımsız sayfa basılmamalı");
assert.equal(scoreless.score, null, "Skor uydurulmamalı");
assert.ok(
  scoreless.missingInputs.some((item) => item.field === "score"),
  "Eksik skor da sağlayıcı eksiği olarak işaretlenmeli"
);

// --- SEO başlığı ve açıklaması ---
assert.match(bareRecord.seo.title, /Trabzonspor .* Eintracht Frankfurt/, "SEO başlığı takımları içermeli");
assert.match(bareRecord.seo.title, /FutbolRadar/, "SEO başlığı marka taşımalı");
assert.ok(bareRecord.seo.description.length <= 158, "Meta açıklaması 158 karakteri aşmamalı");
assert.ok(bareRecord.seo.path.endsWith(".html"), "SEO yolu bir sayfaya işaret etmeli");

// --- "Bir kez üret": parmak izi önbelleği ---
const first = syncPostMatchReports({ matches: [aetMatch, bareMatch], previous: [], generatedAt: "2026-07-30T10:00:00.000Z" });
assert.equal(first.stats.created, 2, "İlk koşuda iki kayıt üretilmeli");
assert.equal(first.stats.reused, 0, "İlk koşuda korunan kayıt olmamalı");

const second = syncPostMatchReports({ matches: [aetMatch, bareMatch], previous: first.records, generatedAt: "2026-07-30T11:00:00.000Z" });
assert.equal(second.stats.reused, 2, "Girdi değişmediyse kayıtlar korunmalı");
assert.equal(second.stats.created, 0, "Girdi değişmediyse yeniden üretilmemeli");
assert.equal(
  second.records.find((record) => record.matchId === "test-aet").generatedAt,
  "2026-07-30T10:00:00.000Z",
  "Korunan kaydın zaman damgası değişmemeli — yoksa her build gürültülü diff üretir"
);

// Girdi değişince yeniden üretilir.
const scored = { ...aetMatch, score: { home: 3, away: 1 } };
const third = syncPostMatchReports({ matches: [scored, bareMatch], previous: second.records, generatedAt: "2026-07-30T12:00:00.000Z" });
assert.equal(third.stats.regenerated, 1, "Skor değişince rapor yenilenmeli");
assert.equal(third.stats.reused, 1, "Değişmeyen maç korunmalı");

assert.notEqual(
  analysisFingerprint(aetMatch),
  analysisFingerprint(scored),
  "Skor değişimi parmak izini değiştirmeli"
);
assert.equal(
  analysisFingerprint(aetMatch),
  analysisFingerprint({ ...aetMatch, providerVenue: "Sonradan eklenen saha" }),
  "Analize girmeyen alan parmak izini değiştirmemeli"
);

// Bitmemiş maç depoya girmez.
const withScheduled = syncPostMatchReports({
  matches: [aetMatch, { id: "future", homeTeam: "A", awayTeam: "B", status: "SCHEDULED" }],
  previous: [],
  generatedAt: "2026-07-30T10:00:00.000Z"
});
assert.equal(withScheduled.records.length, 1, "Yalnızca tamamlanmış maçlar depoya girmeli");

// --- Sunum sırası: bitmiş Türk maçları önce, sonra en yeni ---
const ordered = orderForDisplay([
  { matchId: "eski-turk", turkish: true, kickoff: "2026-07-20T18:00:00+03:00" },
  { matchId: "yeni-yabanci", turkish: false, kickoff: "2026-07-29T18:00:00+03:00" },
  { matchId: "yeni-turk", turkish: true, kickoff: "2026-07-28T18:00:00+03:00" }
]);
assert.deepEqual(
  ordered.map((record) => record.matchId),
  ["yeni-turk", "eski-turk", "yeni-yabanci"],
  "Türk takımı maçları önce, kendi içinde en yeni önce"
);

// --- inputAvailability ---
const availability = inputAvailability(aetMatch);
assert.equal(availability.counts.events, 3, "Olay sayısı doğru olmalı");
assert.equal(availability.hasScore, true, "Skor varlığı doğru okunmalı");
assert.ok(availability.missing.some((item) => item.field === "statistics"), "Boş istatistik eksik sayılmalı");

// --- GERÇEK VERİ: hiçbir bitmiş maç analizsiz kalmamalı ---
const pool = curatedMatches();
const analyzable = pool.filter(isAnalyzableMatch);
assert.ok(analyzable.length > 0, "Gerçek veride en az bir tamamlanmış maç olmalı");

const live = syncPostMatchReports({ matches: pool, previous: [], generatedAt: "2026-07-30T10:00:00.000Z" });
assert.equal(
  live.records.length,
  analyzable.length,
  `Tamamlanmış ${analyzable.length} maçın hepsi kayıt üretmeli (üretilen: ${live.records.length})`
);

const covered = new Set(live.records.map((record) => record.matchId));
const uncovered = analyzable.filter((match) => !covered.has(match.id)).map((match) => match.id);
assert.deepEqual(uncovered, [], `Analizsiz kalan maç olmamalı: ${uncovered.join(", ")}`);

for (const record of live.records) {
  assert.ok(record.seo && record.seo.title && record.seo.description, `${record.matchId}: SEO başlığı ve açıklaması olmalı`);
  assert.ok(record.fingerprint, `${record.matchId}: parmak izi olmalı`);
  assert.equal(record.modelVersion, MODEL_VERSION, `${record.matchId}: model sürümü işaretlenmeli`);
  assert.ok(["page", "store-only"].includes(record.publishState), `${record.matchId}: yayın durumu geçerli olmalı`);
  // Uydurma koruması: skor yoksa alan null kalmalı, 0-0 yazılmamalı.
  if (record.score) {
    assert.equal(typeof record.score.home, "number", `${record.matchId}: skor sayısal olmalı`);
  }
}

// --- Yazılmış depo dosyası tutarlı mı? ---
const storePath = path.join(root, "data", "post-match-reports.json");
if (fs.existsSync(storePath)) {
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  assert.ok(Array.isArray(store.records), "Depo dosyası records dizisi taşımalı");
  assert.equal(store.modelVersion, MODEL_VERSION, "Depo dosyası model sürümünü taşımalı");
  assert.equal(store.matchCount, store.records.length, "matchCount kayıt sayısıyla uyuşmalı");

  const storedIds = new Set(store.records.map((record) => record.matchId));
  const missingFromStore = analyzable.filter((match) => !storedIds.has(match.id)).map((match) => match.id);
  assert.deepEqual(
    missingFromStore,
    [],
    `Depo dosyası güncel değil, eksik maçlar: ${missingFromStore.join(", ")} — 'npm run reports' çalıştırın`
  );

  for (const record of store.records) {
    assert.ok(record.digest, `${record.matchId}: depo kaydı özet taşımalı`);
    assert.equal(record.providerMissingLabel, PROVIDER_MISSING_LABEL, `${record.matchId}: eksik veri etiketi olmalı`);
  }
}

// --- Rapor sayfası yalnızca ölçülmüş bölüm varken basılır ---
const pageRecords = live.records.filter((record) => record.publishState === "page");
for (const record of pageRecords) {
  assert.ok(record.readySections.length > 0, `${record.matchId}: sayfa basılan raporun ölçülmüş bölümü olmalı`);
}

console.log(
  `test-post-match-reports: OK (${live.records.length} tamamlanmış maç, ` +
  `${pageRecords.length} rapor sayfası, ${live.records.length - pageRecords.length} yalnızca depoda)`
);
