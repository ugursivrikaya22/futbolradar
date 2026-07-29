/**
 * DERİN ANALİZ HAZIR MI? — tek yetkili kural.
 *
 * Ana sayfadaki maç kartları her maç için "Derin Analiz" bağlantısı basıyordu.
 * Kartın kendisi bir satır üstte "Analiz için doğrulanmış veri bekleniyor."
 * yazarken hemen altında analiz sözü veren bir düğme duruyordu — düğme ya boş
 * bir sayfaya ya da analiz olmayan bir yere gidiyordu.
 *
 * Bir düğme bir sözdür. Arkasında içerik yoksa basılmaz.
 *
 * HAZIR SAYILMANIN İKİ YOLU:
 *
 *   1. Maçın kendi yayımlanmış analiz sayfası var (`analysisPage`) ya da
 *      tamamlanmış maç raporu üretilmiş. Bunlar zaten yayımlanmış içerik.
 *   2. Elimizde o maç için ÖLÇÜLMÜŞ bir analiz kaydı var.
 *
 * İkinci maddenin barı, projenin kendi kapsam eşiğidir
 * (services/analysisCoverageService.js LOW_COVERAGE_THRESHOLD = 40). Yeni bir
 * sayı uydurmuyoruz: "düşük" bandındaki bir kayıt zaten sayfada "veri yetersiz"
 * diyor, o hâlde ona "Derin Analiz" demek de yanlış.
 *
 * Denetim (2026-07): elimizdeki tek analiz kaydının kapsamı %21, veri güveni
 * 9, yedi bileşeni eksik ve deplasman takımının gücü hiç ölçülmemiş. O kayıt
 * bir analiz değil, bir analiz taslağı — ve kart onu "Derin Analiz" diye
 * sunuyordu.
 */

const { LOW_COVERAGE_THRESHOLD } = require("./analysisCoverageService.js");

/**
 * Analiz kaydının yayımlanabilmesi için gereken en düşük kapsam.
 * Projenin "düşük güven" eşiğiyle aynı: altındaki kayıt ölçülmüş sayılmaz.
 */
const MIN_COVERAGE = LOW_COVERAGE_THRESHOLD;

/** Bu durumlar içeriğin henüz oluşmadığını söyler. */
const UNREADY_STATUS = new Set(["pending", "unavailable", "failed", "queued", "draft"]);

function coverageOf(record) {
  const coverage = record && record.coverage;
  if (!coverage || typeof coverage !== "object") return null;
  const value = Number(coverage.overallCoverage);
  return Number.isFinite(value) ? value : null;
}

/**
 * Analiz kaydı gerçek içerik taşıyor mu?
 *
 * @returns {{ready: boolean, reason: string, coverage: number|null}}
 */
function evaluateAnalysisRecord(record) {
  if (!record || typeof record !== "object") {
    return { ready: false, reason: "analiz kaydı yok", coverage: null };
  }

  const status = String(record.analysisStatus || "").toLowerCase();
  if (UNREADY_STATUS.has(status)) {
    return { ready: false, reason: `analiz durumu "${status}"`, coverage: coverageOf(record) };
  }

  const coverage = coverageOf(record);
  if (coverage === null) {
    return { ready: false, reason: "kapsam ölçülmemiş", coverage: null };
  }

  if (coverage < MIN_COVERAGE) {
    return {
      ready: false,
      reason: `kapsam yetersiz: %${Math.round(coverage)} (en az %${MIN_COVERAGE})`,
      coverage
    };
  }

  return { ready: true, reason: "", coverage };
}

/**
 * Maçın "Derin Analiz" hedefi.
 *
 * @param {object} match
 * @param {{analysis?: object, reportPath?: string}} [options]
 *   `reportPath` yalnızca yayımlanmış bir rapor sayfası olduğu BİLİNİYORSA
 *   verilir (derleme tarafı dosya sistemini görebilir). Verilmediğinde kural
 *   değişmez, yalnızca bir hazır olma yolu daha az bilinir — bu yön güvenli:
 *   eksik bilgi düğmeyi gizler, uydurma bir hedef üretmez.
 *
 * @returns {{ready: boolean, href: string|null, label: string, reason: string}}
 */
function matchAnalysisTarget(match, options = {}) {
  const record = match && typeof match === "object" ? match : {};

  // 1. Yayımlanmış rapor sayfası: tamamlanmış maçın gerçek içeriği.
  if (options.reportPath) {
    return { ready: true, href: options.reportPath, label: "Maç raporu", reason: "" };
  }

  // 2. Maçın kendi analiz sayfası.
  if (String(record.analysisPage || "").trim()) {
    const page = String(record.analysisPage).replace(/^\.\//, "");
    return { ready: true, href: `./${page}`, label: "Derin analiz", reason: "" };
  }

  // 3. Ölçülmüş analiz kaydı.
  const verdict = evaluateAnalysisRecord(options.analysis);
  if (verdict.ready) {
    const id = record.fixtureId || record.id || record.providerId || "";
    return {
      ready: true,
      href: `./mac-detay.html?id=${encodeURIComponent(id)}`,
      label: "Derin analiz",
      reason: ""
    };
  }

  return { ready: false, href: null, label: "", reason: verdict.reason };
}

/** İç günlük: düğmesi gizlenen maç sessizce kaybolmasın. */
function logUnreadyAnalyses(scope, entries) {
  for (const item of entries || []) {
    console.warn(
      `[futbolradar:analysis-unready] scope=${scope} id=${item.id} reason="${item.reason}"`
    );
  }
}

module.exports = {
  MIN_COVERAGE,
  UNREADY_STATUS,
  evaluateAnalysisRecord,
  logUnreadyAnalyses,
  matchAnalysisTarget
};
