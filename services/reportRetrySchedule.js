/**
 * RAPOR YENİDEN DENEME VE GERİ DOLDURMA TAKVİMİ — tek yetkili kural.
 *
 * SORUN. Zenginleştirme koşusu her beş dakikada bir tüm bitmiş maçlara
 * bakıyordu ve hangi maçın ne zaman yeniden denenmesi gerektiğine dair bir
 * kural yoktu. İki sonuç doğuyordu:
 *
 *   1. Verisi hiç gelmeyecek bir maç günlerce her koşuda yeniden sorgulanıyor,
 *      kota harcanıyordu.
 *   2. Buna rağmen maç "takılı" kalıyordu, çünkü tekrar sormak veriyi
 *      getirmiyordu — sağlayıcıda o veri yoktu.
 *
 * KURAL. Her maç, bitişinden sonra SINIRLI SAYIDA ve ARTAN ARALIKLARLA
 * denenir. Deneme takvimi bittiğinde maç "kısmi rapor" olarak kesinleşir ve
 * bir daha sorulmaz. Bu, hem kotayı hem de sayfadaki dürüstlüğü korur:
 * sonsuza kadar "hazırlanıyor" yazan bir sayfa, yanlış bir sayfadır.
 *
 * GERİ DOLDURMA. 24 saatten eski, hâlâ raporsuz maçlar ayrı ve YAVAŞ bir
 * kuyrukta işlenir. Bunlar aciliyeti olmayan kayıtlardır; canlı kuyruğun
 * önüne geçmemeleri gerekir.
 *
 * KOTA GÜVENLİĞİ. Kuyruk her koşuda kesin bir üst sınırla kırpılır ve
 * kırpılan miktar RAPOR EDİLİR — sessizce düşürülen iş, yapılmamış iştir
 * ve öyle görünmelidir.
 */

const {
  FULL_WINDOW_HOURS,
  QUICK_WINDOW_MINUTES,
  evaluateReportStage,
  hasReportableCore,
  minutesSinceFullTime
} = require("./matchReportStages.js");

/**
 * DENEME TAKVİMİ (maç bitişinden itibaren dakika).
 *
 * Yoğun aralık ilk saatte: hızlı rapor için gereken skor ve olay akışı o
 * pencerede gelir. Sonrası seyrekleşir; altıncı saatten sonra hiç denenmez.
 */
const RETRY_SCHEDULE_MINUTES = Object.freeze([10, 30, 60, 120, 240, 360]);

/** Aynı maç için iki deneme arasındaki en kısa süre. */
const MIN_RETRY_GAP_MINUTES = 8;

/** Geri doldurma kuyruğuna girme yaşı. */
const BACKFILL_AFTER_HOURS = 24;

/** Geri doldurma bu yaştan sonra denenmez: veri artık gelmeyecektir. */
const BACKFILL_GIVE_UP_DAYS = 14;

/** Bir koşuda sağlayıcıya gidilecek en fazla maç sayısı. */
const MAX_ATTEMPTS_PER_RUN = 12;

/** Geri doldurmanın koşu başına payı — canlı kuyruğun önüne geçmemeli. */
const MAX_BACKFILL_PER_RUN = 4;

/** Bir maç için toplam deneme üst sınırı. */
const MAX_ATTEMPTS_PER_MATCH = RETRY_SCHEDULE_MINUTES.length;

const ACTION = Object.freeze({
  QUICK: "quick",       // hızlı rapor için çekirdek veri lazım
  ENRICH: "enrich",     // zenginleştirme denemesi
  BACKFILL: "backfill", // eski ve raporsuz maç
  WAIT: "wait",         // sırası gelmedi
  DONE: "done"          // tamamlandı ya da takvim bitti
});

function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function hoursSince(value, now) {
  const date = toDate(value);
  if (!date) return null;
  return ((now instanceof Date ? now : new Date()).getTime() - date.getTime()) / 3600000;
}

/**
 * Takvimde sıradaki denemenin maç bitişinden kaç dakika sonra olduğunu döner.
 * Takvim tükendiyse null.
 */
function nextScheduledMinute(attempts) {
  const done = Math.max(0, Number(attempts) || 0);
  return done < RETRY_SCHEDULE_MINUTES.length ? RETRY_SCHEDULE_MINUTES[done] : null;
}

/**
 * Tek bir maç için ne yapılmalı?
 *
 * @param {object} match
 * @param {{report?: object, attempts?: number, lastAttemptAt?: string, now?: Date}} [options]
 * @returns {{action: string, reason: string, dueInMinutes: number|null, attempt: number, priority: number}}
 */
function retryPlan(match, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const attempts = Math.max(0, Number(options.attempts) || 0);
  const age = minutesSinceFullTime(match, now);

  const plan = (action, reason, dueInMinutes = null, priority = 0) =>
    ({ action, reason, dueInMinutes, attempt: attempts + 1, priority });

  if (!match || typeof match !== "object") {
    return plan(ACTION.DONE, "kayıt yok");
  }

  // Maç henüz bitmemiş: rapor kuyruğuna hiç girmez.
  if (age === null) return plan(ACTION.DONE, "bitiş anı bilinmiyor");
  if (age < 0) return plan(ACTION.WAIT, "maç henüz bitmedi", Math.abs(age));

  // Aynı maç çok sık sorulmaz.
  const sinceLast = options.lastAttemptAt ? (hoursSince(options.lastAttemptAt, now) || 0) * 60 : null;
  if (sinceLast !== null && sinceLast < MIN_RETRY_GAP_MINUTES) {
    return plan(ACTION.WAIT, "son denemenin üstünden yeterli süre geçmedi", MIN_RETRY_GAP_MINUTES - sinceLast);
  }

  const ageHours = age / 60;

  // --- Çekirdek veri yok: skor bilinmiyor. ---
  if (!hasReportableCore(match)) {
    if (ageHours >= BACKFILL_GIVE_UP_DAYS * 24) {
      return plan(ACTION.DONE, "veri gelmedi, takvim kapandı");
    }
    if (ageHours >= BACKFILL_AFTER_HOURS) {
      // Eski ve hâlâ skorsuz: yavaş kuyruk.
      return plan(ACTION.BACKFILL, "24 saatten eski, skor hâlâ yok", 0, 1);
    }
    // Skor en acil veridir: takvimden bağımsız, en yüksek öncelik.
    return plan(ACTION.QUICK, "skor bekleniyor", 0, 100);
  }

  // --- Çekirdek var: rapor durumu neyi gerektiriyor? ---
  const stage = evaluateReportStage({ sections: (options.report && options.report.sections) || {}, match, now });

  if (stage.status.key === "full-ready") {
    return plan(ACTION.DONE, "tam analiz hazır");
  }

  if (stage.status.key === "partial-final") {
    return plan(ACTION.DONE, "tam analiz penceresi kapandı, rapor kesinleşti");
  }

  if (attempts >= MAX_ATTEMPTS_PER_MATCH) {
    return plan(ACTION.DONE, `deneme sınırı doldu (${MAX_ATTEMPTS_PER_MATCH})`);
  }

  const due = nextScheduledMinute(attempts);
  if (due === null) return plan(ACTION.DONE, "takvim tükendi");
  if (age < due) return plan(ACTION.WAIT, "takvimde sırası gelmedi", due - age);

  // Yeni biten maçlar önce: okuyucu en çok onları arıyor.
  const priority = ageHours <= 1 ? 60 : ageHours <= FULL_WINDOW_HOURS ? 40 : 10;
  return plan(ACTION.ENRICH, "zenginleştirme denemesi", 0, priority);
}

/**
 * Koşunun iş kuyruğu.
 *
 * Kırpılan iş SESSİZ DÜŞMEZ: `skipped` alanında kaç kaydın sınıra takıldığı
 * ve neden takıldığı taşınır.
 *
 * @param {Array} matches
 * @param {{reports?: object, attempts?: object, now?: Date, limit?: number}} [options]
 * @returns {{queue: Array, skipped: Array, waiting: Array, done: Array, counts: object}}
 */
function buildRetryQueue(matches, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const reports = options.reports || {};
  const attempts = options.attempts || {};
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : MAX_ATTEMPTS_PER_RUN;

  const actionable = [];
  const waiting = [];
  const done = [];

  for (const match of Array.isArray(matches) ? matches : []) {
    const id = (match && match.id) || "?";
    const state = attempts[id] || {};
    const plan = retryPlan(match, {
      now,
      report: reports[id],
      attempts: state.attempts,
      lastAttemptAt: state.lastAttemptAt
    });

    const entry = { id, match, plan };
    if (plan.action === ACTION.WAIT) waiting.push(entry);
    else if (plan.action === ACTION.DONE) done.push(entry);
    else actionable.push(entry);
  }

  // Öncelik yüksekten düşüğe; eşitlikte en yeni maç önce.
  actionable.sort((left, right) => {
    const byPriority = right.plan.priority - left.plan.priority;
    if (byPriority !== 0) return byPriority;
    const leftAge = minutesSinceFullTime(left.match, now) ?? Infinity;
    const rightAge = minutesSinceFullTime(right.match, now) ?? Infinity;
    return leftAge - rightAge;
  });

  const queue = [];
  const skipped = [];
  let backfillUsed = 0;

  for (const entry of actionable) {
    if (queue.length >= limit) {
      skipped.push({ id: entry.id, reason: `koşu sınırı (${limit}) doldu`, action: entry.plan.action });
      continue;
    }
    if (entry.plan.action === ACTION.BACKFILL) {
      if (backfillUsed >= MAX_BACKFILL_PER_RUN) {
        skipped.push({ id: entry.id, reason: `geri doldurma payı (${MAX_BACKFILL_PER_RUN}) doldu`, action: entry.plan.action });
        continue;
      }
      backfillUsed += 1;
    }
    queue.push(entry);
  }

  return {
    queue,
    skipped,
    waiting,
    done,
    counts: {
      total: (Array.isArray(matches) ? matches : []).length,
      queued: queue.length,
      skipped: skipped.length,
      waiting: waiting.length,
      done: done.length,
      backfill: backfillUsed
    }
  };
}

/** İç günlük: sınıra takılan iş görünür olmalı. */
function logSkipped(scope, skipped) {
  for (const item of skipped || []) {
    console.warn(
      `[futbolradar:retry-skipped] scope=${scope} id=${item.id} action=${item.action} reason="${item.reason}"`
    );
  }
}

module.exports = {
  ACTION,
  BACKFILL_AFTER_HOURS,
  BACKFILL_GIVE_UP_DAYS,
  MAX_ATTEMPTS_PER_MATCH,
  MAX_ATTEMPTS_PER_RUN,
  MAX_BACKFILL_PER_RUN,
  MIN_RETRY_GAP_MINUTES,
  QUICK_WINDOW_MINUTES,
  RETRY_SCHEDULE_MINUTES,
  buildRetryQueue,
  logSkipped,
  nextScheduledMinute,
  retryPlan
};
