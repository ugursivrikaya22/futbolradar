/**
 * MAÇ HATTI TESTLERİ
 *
 * Kapsam: Europe/Istanbul dönüşümü, fikstür tekilleştirme, canlı→bitti
 * geçişi, AET/PEN, ertelenen/iptal maçlar, doğrulanamayan canlı durum,
 * tazeleme kademeleri, analiz tetikleyicisi, yeniden deneme, kısmi veri,
 * uydurma istatistik yasağı, backfill idempotansı, kaynak değişmeden
 * yeniden üretmeme ve kararlı analiz URL'i.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  canonicalStatus,
  displayStatusLabel,
  finishType,
  isAnalyzableStatus,
  isLiveStatus,
  isUnplayedStatus,
  liveVerdict,
  matchState,
  statusLabel
} = require("../services/matchStatus.js");
const {
  dataCompleteness,
  hasCompleteMatchData,
  planRefresh,
  refreshTier,
  shouldRefresh
} = require("../services/refreshPolicy.js");
const {
  ANALYSIS_STATUSES,
  MAX_ANALYSIS_ATTEMPTS,
  analysisFingerprint,
  buildReportRecord,
  isRetryDue,
  istanbulLocal,
  markAnalysisFailure,
  syncPostMatchReports,
  winnerOf
} = require("../services/postMatchReportStore.js");
const { dedupeFixtures, fixtureKey, mergeProviderDetail } = require("../services/matchResultSyncService.js");
const { buildPipelineDiagnostics, freshnessOf } = require("../services/pipelineDiagnostics.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");

const NOW = Date.parse("2026-07-30T19:00:00+03:00");

// ── 1. Europe/Istanbul dönüşümü ─────────────────────────────────────────────
// Sunucunun yerel dilimine GÜVENİLMEZ; dönüşüm her zaman açıkça yapılır.
assert.equal(istanbulLocal("2026-07-21T18:00:00.000Z"), "2026-07-21T21:00", "UTC 18:00 → TSİ 21:00 (yaz saati +03)");
assert.equal(istanbulLocal("2026-01-15T12:00:00.000Z"), "2026-01-15T15:00", "Kışın da +03 (Türkiye kalıcı yaz saatinde)");
assert.equal(istanbulLocal("2026-07-30T22:30:00.000Z"), "2026-07-31T01:30", "Gece yarısını aşan maç ertesi güne geçer");
assert.equal(istanbulLocal(null), null, "Boş değer null döner");
assert.equal(istanbulLocal("geçersiz"), null, "Geçersiz tarih uydurulmaz");

// Sunucu dilimi değişse bile sonuç aynı olmalı.
const originalTz = process.env.TZ;
process.env.TZ = "America/New_York";
assert.equal(istanbulLocal("2026-07-21T18:00:00.000Z"), "2026-07-21T21:00", "Sunucu dilimi sonucu değiştirmemeli");
if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;

// ── 2. Sağlayıcı durum sözlüğü ──────────────────────────────────────────────
const VOCAB = {
  NS: "SCHEDULED", TBD: "SCHEDULED",
  "1H": "LIVE", "2H": "LIVE", ET: "LIVE", P: "LIVE",
  HT: "HALFTIME", BT: "HALFTIME",
  SUSP: "INTERRUPTED", INT: "INTERRUPTED",
  FT: "FINISHED", AET: "FINISHED", PEN: "FINISHED",
  AWD: "AWARDED", WO: "AWARDED",
  PST: "POSTPONED", CANC: "CANCELLED", ABD: "ABANDONED"
};

for (const [code, expected] of Object.entries(VOCAB)) {
  assert.equal(canonicalStatus(code), expected, `${code} → ${expected}`);
}

// Tanınmayan kod "SCHEDULED" OLMAZ: ertelenmiş bir maçı "başlayacak" gibi
// göstermek, oynanmayan maçı canlı bandına sokuyordu.
assert.equal(canonicalStatus("BILINMEYEN"), "UNKNOWN", "Tanınmayan kod UNKNOWN olmalı");
assert.equal(canonicalStatus(""), "UNKNOWN", "Boş durum UNKNOWN olmalı");

// ── 3. Analiz tetikleyicisi: FT/AET/PEN/AWD/WO ──────────────────────────────
for (const code of ["FT", "AET", "PEN", "AWD", "WO"]) {
  assert.equal(isAnalyzableStatus({ status: code }), true, `${code} analiz hattına girmeli`);
}
for (const code of ["PST", "CANC", "ABD", "SUSP", "INT", "NS", "1H", "HT"]) {
  assert.equal(isAnalyzableStatus({ status: code }), false, `${code} normal analiz üretmemeli`);
}

assert.equal(finishType({ status: "AET" }), "extra-time", "AET uzatma");
assert.equal(finishType({ status: "PEN" }), "penalties", "PEN penaltılar");
assert.equal(finishType({ status: "WO" }), "awarded", "WO hükmen");

// ── 4. Canlı → bitti geçişi ─────────────────────────────────────────────────
const liveMatch = { id: "m1", kickoff: "2026-07-30T18:00:00+03:00", status: "2H" };
assert.equal(liveVerdict(liveMatch, { nowMs: NOW }).live, true, "Devam eden maç canlı");
assert.equal(isLiveStatus(liveMatch), true, "2H canlı sayılır");

const finishedMatch = { ...liveMatch, status: "FT", score: { home: 2, away: 1 } };
assert.equal(liveVerdict(finishedMatch, { nowMs: NOW }).live, false, "Biten maç canlı GÖSTERİLMEMELİ");
assert.equal(isLiveStatus(finishedMatch), false, "FT canlı değil");
assert.equal(liveVerdict(finishedMatch, { nowMs: NOW }).reason, "finished", "Sebep 'finished' olmalı");

// Kayıt hâlâ live:true taşıyor ama durum FT: durum kazanır.
assert.equal(
  isLiveStatus({ ...finishedMatch, live: true }),
  false,
  "FT durumu, kalıntı live bayrağını ezmeli — biten maç canlı listede kalmamalı"
);

// ── 5. Başlama saati geçti, canlı doğrulanamıyor ────────────────────────────
const unverified = { id: "m2", kickoff: "2026-07-30T18:00:00+03:00", status: "NS" };
const verdict = liveVerdict(unverified, { nowMs: NOW });
assert.equal(verdict.live, false, "Doğrulanmamış maç CANLI gösterilmemeli");
assert.equal(verdict.verdict, "unverified", "Durum 'unverified' olmalı");
assert.equal(verdict.reason, "kickoff-passed-no-signal", "Sebep açıkça yazılmalı");
assert.equal(displayStatusLabel(unverified, { nowMs: NOW }), "Canlı veri doğrulanamadı", "Arayüz metni yanıltmamalı");

// Canlı işaretli ama uzun süredir güncellenmemiş: canlı sayılmaz.
const staleLive = { id: "m3", kickoff: "2026-07-30T14:00:00+03:00", status: "1H" };
const staleVerdict = liveVerdict(staleLive, { nowMs: NOW });
assert.equal(staleVerdict.live, false, "Bayat canlı maç canlı gösterilmemeli");
assert.equal(staleVerdict.stale, true, "Bayat olarak işaretlenmeli (yeniden denenecek)");

// Ertelenen maç: saati geçse de canlı değil, "başlayacak" da değil.
const postponed = { id: "m4", kickoff: "2026-07-30T18:00:00+03:00", status: "PST" };
assert.equal(liveVerdict(postponed, { nowMs: NOW }).live, false, "Ertelenen maç canlı değil");
assert.equal(liveVerdict(postponed, { nowMs: NOW }).reason, "unplayed", "Sebep 'unplayed'");
assert.equal(isUnplayedStatus(postponed), true, "PST oynanmayan maç");
assert.equal(statusLabel(postponed), "Ertelendi", "Durum etiketi doğru");
assert.equal(statusLabel({ status: "CANC" }), "İptal edildi", "CANC etiketi");
assert.equal(statusLabel({ status: "ABD" }), "Tatil edildi", "ABD etiketi");

// Henüz başlamamış maç doğrulanamayan sayılmaz.
assert.equal(
  liveVerdict({ id: "m5", kickoff: "2026-07-30T21:00:00+03:00", status: "NS" }, { nowMs: NOW }).reason,
  "not-started",
  "Saati gelmemiş maç 'not-started'"
);

// ── 6. Fikstür tekilleştirme ────────────────────────────────────────────────
const dupA = { id: "local-a", homeTeam: "Trabzonspor", awayTeam: "Al-Sadd", kickoff: "2026-07-30", providerIds: { "api-football": "999" } };
const dupB = { id: "provider-999", homeTeam: "Trabzonspor", awayTeam: "Al-Sadd", kickoff: "2026-07-30", providerIds: { "api-football": "999" }, statistics: [{ type: "Topla oynama", home: 55, away: 45 }] };

assert.equal(fixtureKey(dupA), fixtureKey(dupB), "Aynı sağlayıcı kimliği aynı anahtarı vermeli");
const deduped = dedupeFixtures([dupA, dupB]);
assert.equal(deduped.records.length, 1, "Aynı fikstür teke inmeli");
assert.equal(deduped.records[0].id, "provider-999", "Daha çok doğrulanmış veri taşıyan kayıt korunmalı");
assert.equal(deduped.duplicates.length, 1, "Elenen kayıt raporlanmalı");

// Sağlayıcı kimliği yoksa takım çifti + gün anahtarı kullanılır.
const noIdA = { id: "x", homeTeam: "Beşiktaş", awayTeam: "Midtjylland", kickoff: "2026-07-30T20:00:00+03:00" };
const noIdB = { id: "y", homeTeam: "Beşiktaş", awayTeam: "Midtjylland", kickoff: "2026-07-30T20:00:00+03:00" };
assert.equal(fixtureKey(noIdA), fixtureKey(noIdB), "Kimliksiz aynı maç aynı anahtara düşmeli");
assert.equal(dedupeFixtures([noIdA, noIdB]).records.length, 1, "Kimliksiz yinelenen de teke inmeli");

// Farklı maçlar birleşmemeli.
assert.notEqual(
  fixtureKey({ homeTeam: "A", awayTeam: "B", kickoff: "2026-07-30" }),
  fixtureKey({ homeTeam: "A", awayTeam: "C", kickoff: "2026-07-30" }),
  "Farklı rakip farklı anahtar"
);

// ── 7. Tazeleme kademeleri ──────────────────────────────────────────────────
const tierCases = [
  [{ kickoff: new Date(NOW - 30 * 60000).toISOString(), status: "1H" }, "live"],
  [{ kickoff: new Date(NOW - 50 * 60000).toISOString(), status: "HT" }, "paused"],
  [{ kickoff: new Date(NOW - 60 * 60000).toISOString(), status: "SUSP" }, "paused"],
  [{ kickoff: new Date(NOW + 2 * 3600000).toISOString(), status: "NS" }, "scheduled-near"],
  [{ kickoff: new Date(NOW + 20 * 3600000).toISOString(), status: "NS" }, "scheduled-far"],
  [{ kickoff: new Date(NOW - 100 * 60000).toISOString(), status: "FT", score: { home: 1, away: 0 } }, "just-finished"],
  [{ kickoff: new Date(NOW - 6 * 3600000).toISOString(), status: "FT", score: { home: 1, away: 0 } }, "settling"],
  [{ kickoff: new Date(NOW - 3 * 86400000).toISOString(), status: "FT", score: { home: 1, away: 0 } }, "archived"],
  [{ kickoff: new Date(NOW - 3600000).toISOString(), status: "PST" }, "unplayed"]
];

for (const [match, expected] of tierCases) {
  assert.equal(refreshTier(match, { nowMs: NOW }), expected, `${match.status} → ${expected} kademesi`);
}

// Verisi tamamlanmış maç bir daha SORULMAZ: kota koruması.
const complete = {
  kickoff: new Date(NOW - 90 * 60000).toISOString(),
  status: "FT",
  score: { home: 1, away: 0 },
  events: [{ time: "10'", type: "Gol" }],
  statistics: [{ type: "Topla oynama", home: 50, away: 50 }],
  lineups: [{ team: "A" }, { team: "B" }]
};
assert.equal(refreshTier(complete, { nowMs: NOW }), "archived", "Verisi tam maç arşive düşmeli");
assert.equal(shouldRefresh(complete, { nowMs: NOW }).refresh, false, "Arşiv maçı istek harcamamalı");
assert.equal(hasCompleteMatchData(complete), true, "Veri tamlığı doğru okunmalı");

// Aralık dolmadan tekrar sorulmaz (idempotent koşu).
const liveTier = { kickoff: new Date(NOW - 30 * 60000).toISOString(), status: "1H" };
assert.equal(
  shouldRefresh(liveTier, { nowMs: NOW, lastSyncAt: new Date(NOW - 10 * 1000).toISOString() }).refresh,
  false,
  "10 saniye önce senkronlanan canlı maç tekrar sorulmamalı"
);
assert.equal(
  shouldRefresh(liveTier, { nowMs: NOW, lastSyncAt: new Date(NOW - 120 * 1000).toISOString() }).refresh,
  true,
  "Aralık dolduğunda yeniden sorulmalı"
);

// Kota tamponu: tek koşuda sınırlı sayıda istek.
const plan = planRefresh(tierCases.map(([match], index) => ({ id: `t${index}`, ...match })), { nowMs: NOW, limit: 3 });
assert.equal(plan.due.length, 3, "Limit uygulanmalı");
assert.ok(plan.deferred.length > 0, "Sınırın dışındakiler ertelenmeli, kaybolmamalı");
assert.equal(plan.due[0].tier, "live", "Canlı maç sıranın başında olmalı");

assert.equal(dataCompleteness({ score: { home: 1, away: 0 } }), 0.25, "Yalnızca skor → %25 tamlık");
assert.equal(dataCompleteness(complete), 1, "Tüm alanlar → %100 tamlık");

// ── 8. Sağlayıcı birleştirme: durum ilerlemesi ──────────────────────────────
const pendingMatch = { id: "p1", homeTeam: "A", awayTeam: "B", kickoff: "2026-07-30T18:00:00+03:00", status: "SCHEDULED", providerIds: { "api-football": "77" } };

const toFinished = mergeProviderDetail(pendingMatch, { status: "AET", score: { home: 2, away: 1 } }, "2026-07-30T21:00:00Z");
assert.equal(toFinished.record.status, "FINISHED", "AET kanonik FINISHED'e ilerlemeli");
assert.equal(toFinished.record.providerStatus, "AET", "Sağlayıcının AET ayrımı korunmalı — uzatma bilgisi silinmemeli");
assert.equal(toFinished.record.lastSuccessfulSyncAt, "2026-07-30T21:00:00Z", "Senkron zamanı yazılmalı");
assert.ok(toFinished.record.dataCompleteness >= 0, "Veri tamlığı hesaplanmalı");

const toPostponed = mergeProviderDetail(pendingMatch, { status: "PST" }, "2026-07-30T21:00:00Z");
assert.equal(toPostponed.record.status, "POSTPONED", "Erteleme kayda işlenmeli — eskiden SCHEDULED kalıyordu");

// Doğrulanmış skor sağlayıcı tarafından EZİLMEZ.
const scored = { ...pendingMatch, status: "FINISHED", score: { home: 3, away: 0 } };
const attempted = mergeProviderDetail(scored, { status: "FT", score: { home: 1, away: 1 } }, "2026-07-30T21:00:00Z");
assert.deepEqual(attempted.record.score, { home: 3, away: 0 }, "Doğrulanmış skor korunmalı");

// ── 9. Uydurma veri yasağı ──────────────────────────────────────────────────
const bare = {
  id: "bare-1",
  homeTeam: "Trabzonspor",
  awayTeam: "Eintracht Frankfurt",
  kickoff: "2026-07-26T16:30:00+03:00",
  league: "Hazırlık Maçı",
  status: "FT",
  score: { home: 0, away: 3 },
  events: [],
  statistics: [],
  lineups: []
};

const bareRecord = buildReportRecord(bare, { generatedAt: "2026-07-30T10:00:00.000Z" });
assert.equal(bareRecord.digest.turningPoints.moments.length, 0, "Olay yokken kırılma anı uydurulmamalı");
assert.equal(bareRecord.digest.lateGame.status, "unavailable", "Olay yokken maç sonu bölümü uydurulmamalı");
assert.equal(bareRecord.digest.analysis.length, 0, "İstatistik yokken analiz bölümü üretilmemeli");
assert.equal(bareRecord.digest.coaching.status, "unavailable", "Diziliş/değişiklik yokken teknik karar bölümü üretilmemeli");
assert.equal(bareRecord.digest.firstHalf.status, "unavailable", "Olay ve devre skoru yokken devre analizi üretilmemeli");
assert.equal(bareRecord.availability.statistics, 0, "Sayım gerçeği yansıtmalı");
assert.equal(bareRecord.analysisStatus, ANALYSIS_STATUSES.PARTIAL, "Eksik veri partial_data olmalı");

const serialized = JSON.stringify(bareRecord);
for (const term of ["xG", "possession", "playerRating"]) {
  assert.ok(!serialized.includes(`"${term}":`), `Ölçülmemiş ${term} kayda girmemeli`);
}

// Skor yoksa uydurulmaz.
const scoreless = buildReportRecord({ ...bare, id: "bare-2", score: null }, { generatedAt: "2026-07-30T10:00:00.000Z" });
assert.equal(scoreless.score, null, "Skor uydurulmamalı");
assert.equal(scoreless.finalScore, null, "Skor metni uydurulmamalı");
assert.equal(scoreless.winner, null, "Kazanan uydurulmamalı");
assert.equal(scoreless.analysisStatus, ANALYSIS_STATUSES.WAITING, "Ölçülmüş bölüm yoksa veri beklenmeli");
assert.equal(scoreless.publishState, "store-only", "Boş analiz bağımsız sayfa basmamalı");

assert.equal(winnerOf({ score: { home: 2, away: 2 }, homeTeam: "A", awayTeam: "B" }), "draw", "Beraberlik doğru okunmalı");
assert.equal(winnerOf({ score: {} }), null, "Skor yoksa kazanan yok");

// ── 10. Hükmen sonuç kısmi analiz üretir ────────────────────────────────────
const awarded = buildReportRecord({ ...bare, id: "awd-1", status: "AWD" }, { generatedAt: "2026-07-30T10:00:00.000Z" });
assert.ok(awarded, "Hükmen sonuç analiz hattına girmeli");
assert.equal(awarded.analysisStatus, ANALYSIS_STATUSES.PARTIAL, "Hükmen sonuç kaçınılmaz olarak kısmi");
assert.equal(awarded.finishType, "awarded", "Bitiş şekli hükmen olmalı");

// ── 11. Yeniden deneme davranışı ────────────────────────────────────────────
let failure = markAnalysisFailure(bare, new Error("sağlayıcı zaman aşımı"), { generatedAt: "2026-07-30T10:00:00.000Z" });
assert.equal(failure.analysisStatus, ANALYSIS_STATUSES.RETRY, "İlk hata yeniden denenmeli");
assert.equal(failure.analysisAttempts, 1, "Deneme sayacı ilerlemeli");
assert.match(failure.analysisError, /zaman aşımı/, "Hata sebebi kayda geçmeli");
assert.ok(failure.retryAfter, "Yeniden deneme zamanı belirlenmeli");

for (let attempt = 2; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt += 1) {
  failure = markAnalysisFailure(bare, new Error("yine hata"), { previous: failure, generatedAt: "2026-07-30T10:00:00.000Z" });
}
assert.equal(failure.analysisStatus, ANALYSIS_STATUSES.FAILED, "Deneme hakkı bitince failed olmalı");
assert.equal(failure.retryAfter, null, "Failed kayıtta yeniden deneme zamanı olmamalı");

// Geri çekilme süresi dolmadan yeniden denenmez.
const pendingRetry = { analysisStatus: ANALYSIS_STATUSES.RETRY, retryAfter: "2026-07-30T12:00:00.000Z" };
assert.equal(isRetryDue(pendingRetry, Date.parse("2026-07-30T11:00:00Z")), false, "Süre dolmadan denenmemeli");
assert.equal(isRetryDue(pendingRetry, Date.parse("2026-07-30T13:00:00Z")), true, "Süre dolunca denenmeli");

// Başarısız kayıt, girdisi değişmese de yeniden denenir — geçici bir hata
// kalıcı olmamalı.
const failedPrevious = [{ ...failure, matchId: bare.id, fingerprint: analysisFingerprint(bare), modelVersion: bareRecord.modelVersion }];
const retried = syncPostMatchReports({ matches: [bare], previous: failedPrevious, generatedAt: "2026-07-30T14:00:00.000Z" });
assert.equal(retried.stats.reused, 0, "Başarısız kayıt korunmamalı, yeniden denenmeli");

// ── 12. Kaynak değişmeden yeniden üretilmez ─────────────────────────────────
const first = syncPostMatchReports({ matches: [bare], previous: [], generatedAt: "2026-07-30T10:00:00.000Z" });
const second = syncPostMatchReports({ matches: [bare], previous: first.records, generatedAt: "2026-07-30T11:00:00.000Z" });
assert.equal(second.stats.reused, 1, "Girdi değişmediyse kayıt korunmalı");
assert.equal(second.records[0].analysisUpdatedAt, "2026-07-30T10:00:00.000Z", "Korunan kaydın zaman damgası değişmemeli");

const changed = syncPostMatchReports({
  matches: [{ ...bare, score: { home: 1, away: 3 } }],
  previous: first.records,
  generatedAt: "2026-07-30T12:00:00.000Z"
});
assert.equal(changed.stats.regenerated, 1, "Skor değişince yeniden üretilmeli");
assert.notEqual(analysisFingerprint(bare), analysisFingerprint({ ...bare, score: { home: 1, away: 3 } }), "Parmak izi değişmeli");
assert.equal(
  analysisFingerprint(bare),
  analysisFingerprint({ ...bare, providerVenue: "sonradan eklendi", lastSuccessfulSyncAt: "2026-07-30T12:00:00Z" }),
  "Analize girmeyen alan parmak izini değiştirmemeli — yoksa her senkron yeniden üretim tetiklerdi"
);

// ── 13. Kararlı analiz URL'i ────────────────────────────────────────────────
const urlA = buildReportRecord(bare, { generatedAt: "2026-07-30T10:00:00.000Z" });
const urlB = buildReportRecord({ ...bare, score: { home: 1, away: 2 } }, { generatedAt: "2026-07-31T10:00:00.000Z" });
assert.equal(urlA.seo.path, urlB.seo.path, "Skor değişse de URL sabit kalmalı");
assert.equal(urlA.seo.path, "mac-raporu/trabzonspor-eintracht-frankfurt-2026-07-26.html", "URL kuralı: takımlar + tarih");
assert.equal(urlA.slug, "trabzonspor-eintracht-frankfurt-2026-07-26", "Slug URL ile tutarlı");
assert.ok(!urlA.seo.path.includes("//"), "URL'de çift eğik çizgi olmamalı");

// Gerçek veride hiçbir URL yinelenmemeli.
const live12 = syncPostMatchReports({ matches: curatedMatches(), previous: [], generatedAt: "2026-07-30T10:00:00.000Z" });
const paths = live12.records.map((record) => record.seo.path);
assert.equal(new Set(paths).size, paths.length, `Yinelenen analiz URL'i olmamalı: ${paths.length} kayıt, ${new Set(paths).size} benzersiz`);
const ids = live12.records.map((record) => record.matchId);
assert.equal(new Set(ids).size, ids.length, "Aynı maç için iki analiz kaydı olmamalı");

// ── 14. Teşhis çıktısı ──────────────────────────────────────────────────────
const diagnostics = buildPipelineDiagnostics({
  matches: [liveMatch, finishedMatch, unverified, postponed, bare],
  reports: live12.records,
  nowMs: NOW
});
assert.equal(diagnostics.timezone, "Europe/Istanbul", "Kanonik dilim raporlanmalı");
assert.equal(diagnostics.matches.live, 1, "Canlı maç sayısı doğru olmalı");
assert.ok(diagnostics.matches.unverifiedLive >= 1, "Doğrulanamayan maçlar ayrıca sayılmalı");
assert.equal(diagnostics.matches.unplayed, 1, "Oynanmayan maç sayılmalı");
assert.ok(diagnostics.analysis.stored > 0, "Saklanan analiz sayısı raporlanmalı");
assert.ok("awaiting" in diagnostics.analysis, "Analiz bekleyen maç sayısı raporlanmalı");
assert.ok("averageDataCompleteness" in diagnostics.freshness, "Veri tazeliği raporlanmalı");

assert.equal(freshnessOf(null, NOW).state, "unknown", "Senkron yoksa durum bilinmiyor");
assert.equal(freshnessOf(new Date(NOW - 5 * 60000).toISOString(), NOW).state, "fresh", "5 dakika taze");
assert.equal(freshnessOf(new Date(NOW - 30 * 60000).toISOString(), NOW).state, "lagging", "30 dakika gecikmiş");
assert.equal(freshnessOf(new Date(NOW - 5 * 3600000).toISOString(), NOW).state, "stale", "5 saat bayat");

// Teşhis gizli bilgi sızdırmamalı.
const diagnosticsText = JSON.stringify(diagnostics);
for (const secret of ["API_KEY", "apiKey", "x-apisports-key", "Bearer "]) {
  assert.ok(!diagnosticsText.includes(secret), `Teşhis çıktısı '${secret}' içermemeli`);
}

// ── 15. Gerçek veri değişmezleri ────────────────────────────────────────────
const pool = curatedMatches();
const analyzable = pool.filter(isAnalyzableStatus);
assert.equal(live12.records.length, analyzable.length, "Tamamlanmış her maç kayıt üretmeli");

for (const record of live12.records) {
  assert.ok(record.kickoffUtc, `${record.matchId}: UTC zaman damgası olmalı`);
  assert.ok(record.kickoffLocal, `${record.matchId}: TSİ gösterimi olmalı`);
  assert.ok(record.analysisSourceHash, `${record.matchId}: kaynak özeti olmalı`);
  assert.ok(Object.values(ANALYSIS_STATUSES).includes(record.analysisStatus), `${record.matchId}: geçerli analiz durumu`);
  assert.ok(record.dataCompleteness >= 0 && record.dataCompleteness <= 1, `${record.matchId}: tamlık 0-1 aralığında`);
  // Skor varsa gerçekten sayısal olmalı — "0-0" yer tutucusu yok.
  if (record.score) {
    assert.equal(typeof record.score.home, "number", `${record.matchId}: skor sayısal`);
  }
}

// Canlı gösterilen maç kalmamalı: hepsi bitmiş.
const stillLive = analyzable.filter((match) => liveVerdict(match, { nowMs: NOW }).live);
assert.deepEqual(stillLive, [], "Biten hiçbir maç canlı görünmemeli");

console.log(
  `test-match-pipeline: OK (${Object.keys(VOCAB).length} durum kodu, ${tierCases.length} kademe, ` +
  `${live12.records.length} gerçek maç kaydı doğrulandı)`
);
