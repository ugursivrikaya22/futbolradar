/**
 * MAÇ DURUMU — TAMAMLANMIŞ MAÇ TESPİTİ
 *
 * Maç sonrası analiz zincirinin tamamı tek bir soruya dayanır: "bu maç
 * bitti mi?". Cevap beş ayrı yerde ayrı ayrı yazılmıştı ve hepsi yalnızca
 * `status === "FINISHED"` kabul ediyordu:
 *
 *   services/matchReportService.js       (rapor üretimi)
 *   services/postMatchIntelligence.js    (ölçülmüş analiz bölümleri)
 *   services/matchResultSyncService.js   (istatistik/olay çekimi)
 *   scripts/generate-post-match-pages.mjs(rapor sayfası üretimi)
 *   scripts/validate-match-analyses.mjs  (doğrulama)
 *
 * Oysa sağlayıcı bitmiş maçı "FT", uzatmaya giden maçı "AET", penaltılara
 * giden maçı "PEN" olarak veriyor. Bu kodlar takvim ve sağlayıcı katmanında
 * normalize ediliyor ama her yol oradan geçmiyor: elle düzeltilmiş bir
 * kayıt, normalize edilmemiş bir sağlayıcı yanıtı ya da ileride eklenecek
 * yeni bir kaynak "FT" ile geldiğinde maç SESSİZCE analizsiz kalıyordu —
 * hata da vermiyordu, çünkü kod maçı "bitmemiş" sayıyordu.
 *
 * Tespit artık burada, tek yerde. Yeni bir durum kodu eklendiğinde tek
 * satır değişiyor ve zincirin tamamı onu görüyor.
 */

/** Maçın tamamlandığını gösteren durum kodları. */
const FINISHED_STATUSES = new Set([
  "FINISHED",
  "FULL_TIME",
  "FT",
  "AET",
  "AFTER_EXTRA_TIME",
  "PEN",
  "PENALTIES",
  "PEN_SHOOTOUT"
]);

/**
 * Hükmen sonuçlar. Maç oynanmadığı için olay akışı ve istatistiği yoktur;
 * "tamamlandı" sayılırlar ama analiz üretilmez — üretilse her bölümü boş
 * bir rapor çıkardı.
 */
const AWARDED_STATUSES = new Set(["AWARDED", "WO", "WALKOVER"]);

/** Uzatma ve penaltı ayrımı: raporun bitiş şeklini yazabilmesi için. */
const EXTRA_TIME_STATUSES = new Set(["AET", "AFTER_EXTRA_TIME"]);
const PENALTY_STATUSES = new Set(["PEN", "PENALTIES", "PEN_SHOOTOUT"]);

/**
 * Sağlayıcı bir alanı döndürmediğinde arayüzde görünecek metin.
 *
 * "Veri bekleniyor" ile bilinçli olarak farklı: o metin "henüz gelmedi,
 * gelebilir" demek (maç sürüyor, sağlayıcı gecikti). Bu metin ise maç
 * bitmiş ve sağlayıcı o veriyi hiç vermemiş demek. İkisini aynı cümleye
 * indirmek okuyucuya yanlış bilgi verir.
 */
const PROVIDER_MISSING_LABEL = "Veri sağlayıcı tarafından sunulmadı";

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/** Kayıttaki tüm durum alanları (kaynaklar farklı alan adları kullanıyor). */
function statusesOf(match) {
  if (!match) {
    return [];
  }

  return [match.status, match.providerStatus, match.matchStatus]
    .map(normalizeStatus)
    .filter(Boolean);
}

/** Maç tamamlandı mı? FT/AET/PEN dahil. */
function isFinishedMatch(match) {
  return statusesOf(match).some((status) => FINISHED_STATUSES.has(status));
}

/** Hükmen sonuç mu? (Analiz üretilmez.) */
function isAwardedMatch(match) {
  return statusesOf(match).some((status) => AWARDED_STATUSES.has(status));
}

/**
 * Maç analiz edilebilir mi? Tamamlanmış VE gerçekten oynanmış olmalı.
 * Analiz zincirinin giriş kapısı budur.
 */
function isAnalyzableMatch(match) {
  return isFinishedMatch(match) && !isAwardedMatch(match);
}

/**
 * Bitiş şekli: "regular" | "extra-time" | "penalties".
 * Bilinmiyorsa "regular" varsayılmaz — durum kodu ne diyorsa o.
 */
function finishType(match) {
  const statuses = statusesOf(match);

  if (statuses.some((status) => PENALTY_STATUSES.has(status))) {
    return "penalties";
  }

  if (statuses.some((status) => EXTRA_TIME_STATUSES.has(status))) {
    return "extra-time";
  }

  return "regular";
}

const FINISH_LABELS = {
  regular: "Normal sürede tamamlandı",
  "extra-time": "Uzatma devrelerinde tamamlandı",
  penalties: "Penaltı atışlarıyla belirlendi"
};

function finishLabel(match) {
  return FINISH_LABELS[finishType(match)];
}

module.exports = {
  AWARDED_STATUSES,
  EXTRA_TIME_STATUSES,
  FINISHED_STATUSES,
  FINISH_LABELS,
  PENALTY_STATUSES,
  PROVIDER_MISSING_LABEL,
  finishLabel,
  finishType,
  isAnalyzableMatch,
  isAwardedMatch,
  isFinishedMatch,
  normalizeStatus,
  statusesOf
};
