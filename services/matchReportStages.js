/**
 * MAÇ RAPORU AŞAMALARI — tek yetkili kural.
 *
 * SORUN. Rapor kapsamı dokuz bölümün kaçının "ready" olduğuna bakıyordu:
 * `coverage = hazır / 9`. Bölümlerin sekizi sağlayıcıdan gelen zengin veri
 * istiyor (oyuncu istatistikleri, diziliş, kırılma anları, puanlar). Kesin
 * skoru, gollerini ve özetini taşıyan sapasağlam bir rapor bu yüzden "%44"
 * ve "1/3 ölçüm hazır" diye etiketleniyordu.
 *
 * Bu ölçüm okuyucuya YANLIŞ ŞEY söylüyordu. "%44", raporun yarısının eksik
 * olduğunu ima eder; oysa raporun ÇEKİRDEĞİ — kim kazandı, kaç kaç, kim ne
 * zaman attı — tamdı. Eksik olan zenginleştirmeydi. Üstelik hiçbir zaman
 * gelmeyeceği belli olduğunda bile aynı yüzde günlerce sayfada kalıyor,
 * maç "takılmış" görünüyordu.
 *
 * KURAL. Rapor iki aşamada yaşar:
 *
 *   HIZLI (quick)  — skor ve takımlar biliniyorsa HER ZAMAN üretilir.
 *                    Sonuç, gol akışı ve özet. Maç bittikten sonraki ilk
 *                    saat içinde hazır olması beklenir.
 *   TAM   (full)   — sağlayıcı zenginleştirmesi geldiğinde açılır:
 *                    istatistik, öne çıkan oyuncular, taktik okuma, puanlar.
 *
 * Ve rapor BEKLEMEYİ BIRAKIR. Tam analiz penceresi (6 saat) dolduğunda
 * durum "kısmi rapor" olarak KESİNLEŞİR. Bu, "günlerce %44" sorununun
 * doğrudan çözümü: bir noktadan sonra eksik veri bir bekleyiş değil, bir
 * sonuçtur ve öyle yazılır.
 *
 * DURUMLAR belirsiz sayı değil, cümledir:
 *
 *   quick-ready      Hızlı rapor hazır          (çekirdek tam, tam analiz bekleniyor)
 *   full-processing  Tam analiz hazırlanıyor    (zenginleştirme sürüyor)
 *   full-ready       Tam analiz hazır           (çekirdek + zenginleştirme)
 *   partial-final    Kısmi rapor · veri tamamlanmadı (pencere kapandı, son hâli)
 *   unavailable      Veri yok                   (skor ya da takımlar bilinmiyor)
 */

/** Rapor aşamaları. */
const STAGE = Object.freeze({ QUICK: "quick", FULL: "full" });

/**
 * ÇEKİRDEK BÖLÜMLER — skor ve takımlar biliniyorsa üretilebilir.
 * Bunlar olmadan rapor diye bir şey yoktur.
 */
const CORE_SECTIONS = Object.freeze(["summary"]);

/**
 * GENİŞLETİLMİŞ BÖLÜMLER — sağlayıcı zenginleştirmesi ister.
 * Eksik olmaları raporu geçersiz kılmaz, yalnızca tamamlanmamış yapar.
 */
const EXTENDED_SECTIONS = Object.freeze([
  "standoutPlayers", "momentum", "signals", "statistics",
  "tactical", "turningPoints", "aiRating", "nextMatch"
]);

/**
 * ZAMAN PENCERELERİ (maç bitişinden itibaren).
 *
 * Hızlı rapor ilk saat içinde beklenir; tam analiz altı saat içinde. Altıncı
 * saatten sonra gelmeyen veri için beklemeye devam etmek, sayfada kalıcı bir
 * "hazırlanıyor" yalanı bırakır.
 */
const QUICK_WINDOW_MINUTES = 60;
const FULL_WINDOW_HOURS = 6;

/** Maç bitişi, başlama saatinden bu kadar sonra kabul edilir. */
const FULL_TIME_AFTER_KICKOFF_MINUTES = 115;

/**
 * TAM ANALİZ BARI.
 *
 * Genişletilmiş bölümlerin en az yarısı ölçülmüşse rapor "tam" sayılır.
 * Hepsini şart koşmak gerçekçi değil: bazı turnuvalarda sağlayıcı diziliş ya
 * da oyuncu istatistiği hiç göndermiyor ve o rapor asla "tam" olamazdı.
 */
const FULL_COVERAGE_RATIO = 0.5;

/**
 * DURUM CÜMLELERİ templates/report-status.json'da yaşıyor.
 *
 * Metin ile kararı ayırmanın nedeni tek: bu beş cümle okuyucunun gördüğü
 * yüzdür ve üslubu bir gün düzeltilecektir. Düzeltmenin, hangi pencerede
 * hangi durumun seçildiğine karar veren mantığa dokunmayı gerektirmemesi
 * gerekir — yanlışlıkla eşiği kaydıran bir metin düzeltmesi, sessizce
 * yanlış rapor durumu üretir.
 *
 * Şablon YALNIZCA cümleyi taşır. Anahtar adları, `key` değerleri ve sıra
 * sözleşmedir; kural bu dosyada kalır.
 */
const REPORT_STATUS = Object.freeze(require("../templates/report-status.json").statuses);

const STATUS_BY_KEY = Object.freeze(
  Object.fromEntries(Object.values(REPORT_STATUS).map((status) => [status.key, status]))
);

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Skor ve takımlar biliniyor mu? Hızlı raporun tek ön koşulu budur. */
function hasReportableCore(match) {
  if (!match || typeof match !== "object") return false;
  if (!String(match.homeTeam || "").trim() || !String(match.awayTeam || "").trim()) return false;

  const score = match.score || {};
  return isNumber(Number(score.home)) && score.home !== null && score.home !== ""
    && isNumber(Number(score.away)) && score.away !== null && score.away !== "";
}

/** Bitmiş sayılan durum etiketleri. */
const FINISHED_LABELS = new Set(["FINISHED", "FT", "AET", "PEN"]);

/** Oynanmakta olan maç: skoru VAR ama FİNAL DEĞİL. */
const IN_PLAY_LABELS = new Set(["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"]);

/** Oynanmamış ya da yarıda kalmış maç: rapor konusu değil. */
const ABANDONED_LABELS = new Set(["POSTPONED", "CANCELLED", "CANCELED", "ABANDONED", "SUSPENDED", "AWARDED", "WO"]);

/** Maçın bitiş anı. Kayıtta yoksa başlama saatinden türetilir. */
function fullTimeAt(match) {
  const explicit = Date.parse((match && (match.finishedAt || match.fullTimeAt)) || "");
  if (!Number.isNaN(explicit)) return new Date(explicit);

  const kickoff = Date.parse((match && match.kickoff) || "");
  if (Number.isNaN(kickoff)) return null;
  return new Date(kickoff + FULL_TIME_AFTER_KICKOFF_MINUTES * 60000);
}

/** Maç bittiğinden bu yana kaç dakika geçti? Bilinmiyorsa null. */
function minutesSinceFullTime(match, now) {
  const finished = fullTimeAt(match);
  if (!finished) return null;
  const reference = now instanceof Date ? now : new Date();
  return (reference.getTime() - finished.getTime()) / 60000;
}

/**
 * MAÇ RAPORLANABİLİR Mİ? — üretim koşulunun tek yetkili hâli.
 *
 * İki ayrı yanlış yapmamak gerekiyor:
 *
 *   1. Sağlayıcı "FINISHED" etiketini saatler sonra gönderirken kesin skoru
 *      çoktan yollamış olabiliyor. Sırf etiket gecikti diye maçı raporsuz
 *      bırakmak, "günlerce takılı maç" tablosunun asıl sebebiydi.
 *   2. Ama CANLI bir maçın skoru FİNAL SKOR DEĞİLDİR. 1-0'ken yazılan
 *      "maç raporu", 90. dakikada yanlış bir belgeye dönüşür.
 *
 * Bu yüzden etiket tek başına değil, ZAMANLA BİRLİKTE okunuyor: etiket
 * bitmiş diyorsa bitmiştir; oynanıyor ya da ertelenmiş diyorsa rapor yok;
 * etiket sessizse maçın bitiş anının geçmiş olması aranır.
 */
function isReportableFinal(match, now) {
  if (!hasReportableCore(match)) return false;

  const status = String((match && match.status) || "").toUpperCase();
  if (FINISHED_LABELS.has(status)) return true;
  if (IN_PLAY_LABELS.has(status)) return false;
  if (ABANDONED_LABELS.has(status)) return false;

  // Etiket bilinmiyor: skor var ve bitiş anı geçmişse bu bir final skordur.
  const age = minutesSinceFullTime(match, now);
  return age !== null && age >= 0;
}

/** Bölüm hazır mı? */
function sectionIsReady(section) {
  return Boolean(section) && section.status === "ready";
}

/**
 * Bölümlerin aşama bazlı kapsamı.
 *
 * @returns {{core: {ready:number,total:number,complete:boolean},
 *            extended: {ready:number,total:number,ratio:number},
 *            overall: number}}
 */
function stageCoverage(sections) {
  const list = sections && typeof sections === "object" ? sections : {};

  const coreReady = CORE_SECTIONS.filter((key) => sectionIsReady(list[key])).length;
  const extendedReady = EXTENDED_SECTIONS.filter((key) => sectionIsReady(list[key])).length;
  const extendedTotal = EXTENDED_SECTIONS.length;

  return {
    core: { ready: coreReady, total: CORE_SECTIONS.length, complete: coreReady === CORE_SECTIONS.length },
    extended: {
      ready: extendedReady,
      total: extendedTotal,
      ratio: extendedTotal ? extendedReady / extendedTotal : 0
    },
    // Genel kapsam geriye dönük uyumluluk için korunuyor ama artık MANŞET
    // DEĞİL: okuyucuya durum cümlesi gösteriliyor, yüzde ayrıntıda kalıyor.
    overall: Math.round(
      ((coreReady + extendedReady) / (CORE_SECTIONS.length + extendedTotal)) * 100
    )
  };
}

/**
 * Raporun durumu. Zaman ve kapsam birlikte karar verir.
 *
 * @param {object} params {sections, match, now}
 * @returns {{status: object, stage: string, coverage: object, ageMinutes: number|null}}
 */
function evaluateReportStage(params = {}) {
  const { sections, match } = params;
  const now = params.now instanceof Date ? params.now : new Date();
  const coverage = stageCoverage(sections);
  const ageMinutes = minutesSinceFullTime(match, now);

  if (!coverage.core.complete || !hasReportableCore(match)) {
    return { status: REPORT_STATUS.unavailable, stage: null, coverage, ageMinutes };
  }

  if (coverage.extended.ratio >= FULL_COVERAGE_RATIO) {
    return { status: REPORT_STATUS.fullReady, stage: STAGE.FULL, coverage, ageMinutes };
  }

  // Bitiş anı bilinmiyorsa zamana dayalı bir iddia kurulamaz; elde olan
  // çekirdek raporu "hazır" demek dürüst olanı.
  if (ageMinutes === null) {
    return { status: REPORT_STATUS.quickReady, stage: STAGE.QUICK, coverage, ageMinutes };
  }

  if (ageMinutes <= QUICK_WINDOW_MINUTES) {
    return { status: REPORT_STATUS.quickReady, stage: STAGE.QUICK, coverage, ageMinutes };
  }

  if (ageMinutes <= FULL_WINDOW_HOURS * 60) {
    return { status: REPORT_STATUS.fullProcessing, stage: STAGE.QUICK, coverage, ageMinutes };
  }

  // Pencere kapandı: eksik veri artık bir bekleyiş değil, bir sonuç.
  return { status: REPORT_STATUS.partialFinal, stage: STAGE.QUICK, coverage, ageMinutes };
}

/** Durum anahtarından etiket. Bilinmeyen anahtar uydurulmaz. */
function statusByKey(key) {
  return STATUS_BY_KEY[String(key || "")] || null;
}

module.exports = {
  CORE_SECTIONS,
  EXTENDED_SECTIONS,
  FULL_COVERAGE_RATIO,
  FULL_TIME_AFTER_KICKOFF_MINUTES,
  FULL_WINDOW_HOURS,
  QUICK_WINDOW_MINUTES,
  REPORT_STATUS,
  STAGE,
  evaluateReportStage,
  fullTimeAt,
  hasReportableCore,
  isReportableFinal,
  minutesSinceFullTime,
  sectionIsReady,
  stageCoverage,
  statusByKey
};
