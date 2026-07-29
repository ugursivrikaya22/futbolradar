/**
 * MAÇ RAPORU BORU HATTI TESTLERİ
 *
 * Sorun: maçlar günlerce "Veri kapsamı %44 · 1/3 ölçüm hazır" diye takılı
 * kalıyordu. İki ayrı hata vardı — kapsam ölçümü yanlış şeyi ölçüyordu ve
 * hiçbir şey beklemeye son vermiyordu.
 *
 * Sözleşme:
 *   1. SKOR VE TAKIMLAR BİLİNİYORSA rapor HER ZAMAN üretilir.
 *   2. Rapor iki aşamada yaşar: hızlı (çekirdek) ve tam (zenginleştirilmiş).
 *   3. Durum belirsiz kesir değil, cümledir.
 *   4. Beklemenin sonu vardır: pencere kapanınca durum "kısmi rapor" olarak
 *      KESİNLEŞİR. Hiçbir maç sonsuza kadar "hazırlanıyor" diyemez.
 *   5. Yeniden deneme takvimi sınırlıdır ve kota korumaları vardır.
 *   6. 24 saatten eski raporsuz maçlar geri doldurma kuyruğuna girer.
 *   7. Yayımlanan sayfalarda belirsiz "n/3 ölçüm" ifadesi kalmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const {
  CORE_SECTIONS,
  EXTENDED_SECTIONS,
  FULL_WINDOW_HOURS,
  QUICK_WINDOW_MINUTES,
  REPORT_STATUS,
  STAGE,
  evaluateReportStage,
  hasReportableCore,
  stageCoverage,
  statusByKey
} = require("../services/matchReportStages.js");
const {
  ACTION,
  BACKFILL_AFTER_HOURS,
  MAX_ATTEMPTS_PER_MATCH,
  MAX_ATTEMPTS_PER_RUN,
  MAX_BACKFILL_PER_RUN,
  MIN_RETRY_GAP_MINUTES,
  RETRY_SCHEDULE_MINUTES,
  buildRetryQueue,
  retryPlan
} = require("../services/reportRetrySchedule.js");
const { buildMatchReport } = require("../services/matchReportService.js");

const NOW = new Date("2026-07-29T20:00:00+03:00");

/** Maç bitişinden `minutes` dakika önce başlamış bir maç kurar. */
function finishedAgo(minutes, extra = {}) {
  const finished = new Date(NOW.getTime() - minutes * 60000);
  return {
    id: `test-${minutes}`,
    homeTeam: "Ev Takımı",
    awayTeam: "Deplasman",
    league: "Trendyol Süper Lig",
    status: "FINISHED",
    score: { home: 2, away: 1 },
    finishedAt: finished.toISOString(),
    kickoff: new Date(finished.getTime() - 115 * 60000).toISOString(),
    ...extra
  };
}

function sections(readyExtended = 0) {
  const list = { summary: { status: "ready" } };
  EXTENDED_SECTIONS.forEach((key, index) => {
    list[key] = { status: index < readyExtended ? "ready" : "unavailable" };
  });
  return list;
}

/** Çekirdek: skor ve takımlar. Başka hiçbir şey gerekmez. */
function testCoreIsScoreAndTeams() {
  assert.equal(hasReportableCore(finishedAgo(30)), true);
  assert.equal(hasReportableCore({ ...finishedAgo(30), score: null }), false);
  assert.equal(hasReportableCore({ ...finishedAgo(30), score: { home: 1, away: null } }), false);
  assert.equal(hasReportableCore({ ...finishedAgo(30), homeTeam: "" }), false);
  assert.equal(hasReportableCore(null), false);

  // Gerçek 0-0 bir skordur.
  assert.equal(hasReportableCore({ ...finishedAgo(30), score: { home: 0, away: 0 } }), true);

  assert.deepEqual(CORE_SECTIONS, ["summary"], "çekirdek tek bölüm olmalı: özet");
  assert.equal(EXTENDED_SECTIONS.length, 8, "genişletilmiş bölüm sayısı değişti mi?");
}

/**
 * AŞAMA ZAMAN ÇİZGİSİ.
 *
 * hızlı hazır → tam hazırlanıyor → (tam hazır | kısmi kesin)
 */
function testStageTimeline() {
  // İlk saat: hızlı rapor hazır.
  const fresh = evaluateReportStage({ sections: sections(0), match: finishedAgo(20), now: NOW });
  assert.equal(fresh.status.key, REPORT_STATUS.quickReady.key);
  assert.equal(fresh.stage, STAGE.QUICK);

  // Sınır dahil.
  assert.equal(
    evaluateReportStage({ sections: sections(0), match: finishedAgo(QUICK_WINDOW_MINUTES), now: NOW }).status.key,
    REPORT_STATUS.quickReady.key
  );

  // Hızlı pencere geçti, tam pencere sürüyor: hazırlanıyor.
  const processing = evaluateReportStage({ sections: sections(1), match: finishedAgo(180), now: NOW });
  assert.equal(processing.status.key, REPORT_STATUS.fullProcessing.key);

  // Yeterli zenginleştirme geldi: tam analiz hazır.
  const full = evaluateReportStage({ sections: sections(4), match: finishedAgo(180), now: NOW });
  assert.equal(full.status.key, REPORT_STATUS.fullReady.key);
  assert.equal(full.stage, STAGE.FULL);

  // BEKLEMENİN SONU: pencere kapandı, durum kesinleşti.
  const closed = evaluateReportStage({
    sections: sections(1), match: finishedAgo(FULL_WINDOW_HOURS * 60 + 1), now: NOW
  });
  assert.equal(closed.status.key, REPORT_STATUS.partialFinal.key);

  // Günlerce beklemiş maç da AYNI kesin duruma düşer — "hazırlanıyor" demez.
  for (const days of [1, 3, 14, 90]) {
    const old = evaluateReportStage({ sections: sections(2), match: finishedAgo(days * 24 * 60), now: NOW });
    assert.equal(
      old.status.key, REPORT_STATUS.partialFinal.key,
      `${days} günlük maç hâlâ "${old.status.key}" diyor — takılı kalmış demektir`
    );
  }

  // Çekirdek yoksa: veri yok.
  const empty = evaluateReportStage({
    sections: { summary: { status: "unavailable" } }, match: { ...finishedAgo(30), score: null }, now: NOW
  });
  assert.equal(empty.status.key, REPORT_STATUS.unavailable.key);
}

/** Durum bir cümledir, kesir değil. */
function testStatusesAreSentences() {
  const required = ["quick-ready", "full-processing", "full-ready", "partial-final", "unavailable"];
  for (const key of required) {
    const status = statusByKey(key);
    assert.ok(status, `"${key}" durumu tanımlı olmalı`);
    assert.ok(status.text && status.text.length > 3, `"${key}" okunabilir bir etiket taşımalı`);
    assert.ok(status.detail && status.detail.length > 20, `"${key}" açıklama taşımalı`);
    assert.ok(["ok", "progress", "warn"].includes(status.tone), `"${key}" tanınmayan ton: ${status.tone}`);

    // Belirsiz kesir ifadeleri etiketlere sızmamalı.
    assert.ok(!/\d\s*\/\s*\d/.test(status.text), `"${key}" etiketi kesir taşıyor: ${status.text}`);
  }

  assert.equal(statusByKey("uydurma"), null, "tanımsız durum uydurulmamalı");
}

/** Kapsam aşamalara ayrılır: çekirdek eksikliği ile zenginleştirme eksikliği aynı şey değil. */
function testStageCoverageSeparatesCoreFromExtended() {
  const none = stageCoverage(sections(0));
  assert.equal(none.core.complete, true, "özet hazırsa çekirdek tamdır");
  assert.equal(none.extended.ready, 0);
  assert.equal(none.extended.ratio, 0);

  const half = stageCoverage(sections(4));
  assert.equal(half.extended.ratio, 0.5);

  const broken = stageCoverage({ summary: { status: "unavailable" } });
  assert.equal(broken.core.complete, false);

  assert.equal(stageCoverage(null).core.complete, false, "bölümsüz girdi çökertmemeli");
}

/**
 * SKOR VE TAKIMLAR BİLİNİYORSA RAPOR ÜRETİLİR.
 *
 * Eskiden yalnızca "FINISHED" etiketli kayıtlar rapor alıyordu; sağlayıcı
 * etiketi geciktirdiğinde skoru bilinen maç raporsuz kalıyordu.
 */
function testReportIsAlwaysBuiltWhenScoreIsKnown() {
  // Durum etiketi hiç gelmemiş ama skor var.
  const unlabelled = { ...finishedAgo(90), status: "SCHEDULED" };
  const report = buildMatchReport(unlabelled, { now: NOW, generatedAt: NOW.toISOString() });
  assert.ok(report, "skoru bilinen maç raporsuz kalmamalı");
  assert.ok(report.status, "rapor bir durum taşımalı");
  assert.equal(report.sections.summary.status, "ready", "çekirdek özet üretilmeli");

  // Skor yoksa sayfa üretilmez — boş sayfa yayımlamaktansa hiç yayımlamamak.
  assert.equal(
    buildMatchReport({ ...finishedAgo(90), status: "SCHEDULED", score: null }, { now: NOW }),
    null
  );

  // Rapor durum alanlarını taşımalı.
  for (const field of ["status", "statusLabel", "statusDetail", "statusTone", "stageCoverage"]) {
    assert.ok(field in report, `rapor "${field}" alanını taşımalı`);
  }
}

/** Depodaki gerçek maçların hiçbiri belirsiz bir durumda kalmamalı. */
function testRealMatchesAreNotStuck() {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
  const matches = Array.isArray(raw) ? raw : (raw.matches || []);

  for (const match of matches) {
    const report = buildMatchReport(match, { now: NOW, generatedAt: NOW.toISOString() });
    if (!report) continue;

    assert.ok(statusByKey(report.status), `${match.id}: tanınmayan durum "${report.status}"`);

    // Bir günden eski hiçbir maç "hazırlanıyor" diyemez.
    const ageHours = (NOW.getTime() - Date.parse(match.kickoff)) / 3600000;
    if (ageHours > 24) {
      assert.notEqual(
        report.status, REPORT_STATUS.fullProcessing.key,
        `${match.id}: ${Math.round(ageHours)} saattir "hazırlanıyor" — takılı kalmış`
      );
    }
  }
}

/** Deneme takvimi sınırlı ve artan aralıklı. */
function testRetryScheduleIsBoundedAndIncreasing() {
  for (let index = 1; index < RETRY_SCHEDULE_MINUTES.length; index += 1) {
    assert.ok(
      RETRY_SCHEDULE_MINUTES[index] > RETRY_SCHEDULE_MINUTES[index - 1],
      "takvim aralıkları artmalı"
    );
  }
  assert.equal(MAX_ATTEMPTS_PER_MATCH, RETRY_SCHEDULE_MINUTES.length);
  assert.ok(
    RETRY_SCHEDULE_MINUTES.at(-1) <= FULL_WINDOW_HOURS * 60,
    "son deneme tam analiz penceresini aşmamalı — aşarsa pencere kapandıktan sonra kota harcanır"
  );

  // Sırası gelmemiş maç beklemede.
  const early = retryPlan(finishedAgo(5), { now: NOW, attempts: 0 });
  assert.equal(early.action, ACTION.WAIT);
  assert.ok(early.dueInMinutes > 0);

  // Sırası gelen maç kuyrukta: bir deneme yapılmışsa sıradaki 30. dakikada,
  // maç 45 dakikalık — sırası gelmiş.
  const due = retryPlan(finishedAgo(45), { now: NOW, attempts: 1, report: { sections: sections(0) } });
  assert.equal(due.action, ACTION.ENRICH);

  // İki deneme yapılmışsa sıradaki 60. dakikada; 45 dakikalık maç beklemeli.
  assert.equal(
    retryPlan(finishedAgo(45), { now: NOW, attempts: 2, report: { sections: sections(0) } }).action,
    ACTION.WAIT,
    "takvim ilerledikçe aralık açılmalı"
  );

  // Deneme sınırı dolmuş maç bir daha sorulmaz.
  const exhausted = retryPlan(finishedAgo(45), {
    now: NOW, attempts: MAX_ATTEMPTS_PER_MATCH, report: { sections: sections(0) }
  });
  assert.equal(exhausted.action, ACTION.DONE);

  // Tam analiz hazırsa iş bitti.
  assert.equal(
    retryPlan(finishedAgo(45), { now: NOW, attempts: 0, report: { sections: sections(6) } }).action,
    ACTION.DONE
  );

  // Pencere kapandıysa iş bitti — sonsuz döngü yok.
  assert.equal(
    retryPlan(finishedAgo(FULL_WINDOW_HOURS * 60 + 60), {
      now: NOW, attempts: 0, report: { sections: sections(1) }
    }).action,
    ACTION.DONE
  );
}

/** Aynı maç çok sık sorulmaz. */
function testMinimumGapProtectsQuota() {
  const tooSoon = retryPlan(finishedAgo(45), {
    now: NOW,
    attempts: 1,
    lastAttemptAt: new Date(NOW.getTime() - 2 * 60000).toISOString(),
    report: { sections: sections(0) }
  });
  assert.equal(tooSoon.action, ACTION.WAIT);
  assert.ok(/yeterli süre geçmedi/.test(tooSoon.reason), tooSoon.reason);

  const longEnough = retryPlan(finishedAgo(45), {
    now: NOW,
    attempts: 1,
    lastAttemptAt: new Date(NOW.getTime() - (MIN_RETRY_GAP_MINUTES + 1) * 60000).toISOString(),
    report: { sections: sections(0) }
  });
  assert.equal(longEnough.action, ACTION.ENRICH);
}

/** Skor en acil veridir: takvimden bağımsız, en yüksek öncelik. */
function testMissingScoreIsUrgent() {
  const plan = retryPlan({ ...finishedAgo(30), score: null }, { now: NOW, attempts: 0 });
  assert.equal(plan.action, ACTION.QUICK);
  assert.ok(plan.priority > 50, "skor eksikliği en yüksek önceliği almalı");
}

/** 24 saatten eski raporsuz maçlar geri doldurma kuyruğuna girer. */
function testBackfillQueue() {
  const old = { ...finishedAgo((BACKFILL_AFTER_HOURS + 5) * 60), id: "eski", score: null };
  const plan = retryPlan(old, { now: NOW, attempts: 0 });
  assert.equal(plan.action, ACTION.BACKFILL);
  assert.ok(/24 saatten eski/.test(plan.reason), plan.reason);

  // Çok eski kayıt için de beklemeye son verilir.
  const ancient = { ...finishedAgo(60 * 24 * 60), id: "cok-eski", score: null };
  assert.equal(retryPlan(ancient, { now: NOW, attempts: 0 }).action, ACTION.DONE);

  // Geri doldurma canlı kuyruğun önüne geçmez.
  const pool = [
    ...Array.from({ length: 10 }, (_, index) => ({ ...old, id: `eski-${index}` })),
    { ...finishedAgo(45), id: "yeni" }
  ];
  const { queue, counts } = buildRetryQueue(pool, { now: NOW, reports: {}, attempts: {} });
  assert.equal(queue[0].id, "yeni", "yeni biten maç geri doldurmanın önünde olmalı");
  assert.ok(counts.backfill <= MAX_BACKFILL_PER_RUN, `geri doldurma payı aşıldı: ${counts.backfill}`);
}

/** Koşu sınırı kotayı korur ve kırpılan iş sessizce kaybolmaz. */
function testRunLimitProtectsQuota() {
  const pool = Array.from({ length: 40 }, (_, index) => ({ ...finishedAgo(45), id: `m-${index}` }));
  const { queue, skipped, counts } = buildRetryQueue(pool, { now: NOW, reports: {}, attempts: {} });

  assert.equal(queue.length, MAX_ATTEMPTS_PER_RUN, "kuyruk koşu sınırıyla kırpılmalı");
  assert.equal(skipped.length, 40 - MAX_ATTEMPTS_PER_RUN, "kırpılan her kayıt raporlanmalı");
  assert.equal(counts.queued + counts.skipped, 40);
  for (const item of skipped) {
    assert.ok(item.reason, `${item.id}: kırpma gerekçesiz olmamalı`);
  }

  // Sınır sıfırsa hiç sağlayıcıya gidilmez.
  assert.equal(buildRetryQueue(pool, { now: NOW, limit: 0 }).queue.length, 0);

  // Boş ve bozuk girdi çökertmemeli.
  assert.equal(buildRetryQueue(null, { now: NOW }).queue.length, 0);
  assert.equal(buildRetryQueue([null, undefined], { now: NOW }).counts.total, 2);
}

/** Yayımlanan sayfalarda belirsiz "n/3 ölçüm" ifadesi kalmamalı. */
function testPublishedPagesDroppedTheVagueFraction() {
  const pages = ["index.html", "mac-merkezi.html"]
    .map((file) => path.join(root, file))
    .filter((file) => fs.existsSync(file));

  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    assert.ok(
      !/\d\/\d\s*ölçüm hazır/.test(html),
      `${path.basename(file)}: belirsiz "n/3 ölçüm hazır" ifadesi hâlâ basılıyor`
    );
  }

  // Rapor kartları durum etiketi taşımalı.
  const home = path.join(root, "index.html");
  if (fs.existsSync(home)) {
    const html = fs.readFileSync(home, "utf8");
    if (html.includes("home-report-card")) {
      assert.ok(html.includes("report-status"), "rapor kartları durum etiketi taşımalı");
      for (const [, key] of html.matchAll(/class="report-status is-([a-z]+)"/g)) {
        assert.ok(["ok", "progress", "warn"].includes(key), `tanınmayan durum tonu: ${key}`);
      }
    }
  }
}

const tests = [
  testCoreIsScoreAndTeams,
  testStageTimeline,
  testStatusesAreSentences,
  testStageCoverageSeparatesCoreFromExtended,
  testReportIsAlwaysBuiltWhenScoreIsKnown,
  testRealMatchesAreNotStuck,
  testRetryScheduleIsBoundedAndIncreasing,
  testMinimumGapProtectsQuota,
  testMissingScoreIsUrgent,
  testBackfillQueue,
  testRunLimitProtectsQuota,
  testPublishedPagesDroppedTheVagueFraction
];

for (const test of tests) test();

console.log(`Report pipeline tests passed (${tests.length} senaryo: çekirdek tanımı, aşama zaman çizgisi, ` +
  "durum cümleleri, aşamalı kapsam, her zaman rapor, takılı maç yok, sınırlı takvim, aralık koruması, " +
  "acil skor, geri doldurma, kota koruması, sayfa denetimi).");
