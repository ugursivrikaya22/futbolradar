/**
 * MAÇ DURUMU — SAĞLAYICI DURUM SÖZLÜĞÜ VE YAŞAM DÖNGÜSÜ
 *
 * Sağlayıcının (API-Football) verdiği kısa kodların TAMAMI burada tek yerde
 * tanımlıdır. Bu modül olmadan her katman kendi eşlemesini yazıyordu ve
 * ikisi de eksikti:
 *
 *   services/providers/apiFootballProvider.js  — yalnızca 1H/2H/HT/BT/ET/P
 *     ve FT/AET/PEN tanıyor, GERİ KALAN HER ŞEYİ "SCHEDULED" sayıyordu.
 *     Ertelenen (PST), iptal edilen (CANC), tatil edilen (ABD), askıya
 *     alınan (SUSP) ve hükmen (AWD/WO) sonuçlanan maçlar "programlandı"
 *     görünüyordu. Başlama saati geçtiği için arayüz bunları "oynanıyor"
 *     bandına alıyordu: OYNANMAYAN BİR MAÇ CANLI GİBİ GÖSTERİLİYORDU.
 *
 *   scripts/sync-fixture-calendar.mjs — SUSP, INT, AWD ve WO tanımlı değildi.
 *
 * ÜÇ AYRI SORU, ÜÇ AYRI CEVAP. Kodun karıştırdığı şey buydu:
 *
 *   1. Maç şu anda oynanıyor mu?     → isLiveStatus
 *   2. Maç tamamlandı mı?            → isFinishedStatus
 *   3. Maç analiz edilebilir mi?     → isAnalyzableStatus
 *
 * Hükmen sonuçlar (AWD/WO) tamamlanmıştır ve analiz hattına GİRER — ama
 * maç sahada oynanmadığı için olay/istatistik beklenmez; analiz kaçınılmaz
 * olarak "partial_data" olur. Ertelenen/iptal/tatil edilen maçlar
 * tamamlanmış SAYILMAZ: nihai sonuçları yoktur.
 *
 * BAYAT CANLI KORUMASI. Başlama saati geçmiş ama sağlayıcıdan doğrulanmış
 * canlı sinyali gelmeyen maç canlı gösterilmez. `liveVerdict()` bu kararı
 * tek yerde verir ve sebebini döndürür, böylece arayüz "veri yok" durumunu
 * yazabilir. Skor ya da dakika UYDURULMAZ.
 */

/** Sağlayıcı kısa kodu → kanonik durum. */
const STATUS_VOCABULARY = Object.freeze({
  // Oynanmadı
  TBD: "SCHEDULED",
  NS: "SCHEDULED",
  SCHEDULED: "SCHEDULED",
  TIMED: "SCHEDULED",
  NOT_STARTED: "SCHEDULED",

  // Oynanıyor
  "1H": "LIVE",
  "2H": "LIVE",
  ET: "LIVE",
  P: "LIVE",
  LIVE: "LIVE",
  IN_PLAY: "LIVE",

  // Ara — hâlâ "in-play", ama oyun durmuş
  HT: "HALFTIME",
  BT: "HALFTIME",
  HALFTIME: "HALFTIME",
  PAUSED: "HALFTIME",

  // Geçici kesinti — maç sürüyor sayılır, sık yoklanır
  SUSP: "INTERRUPTED",
  SUSPENDED: "INTERRUPTED",
  INT: "INTERRUPTED",
  INTERRUPTED: "INTERRUPTED",

  // Tamamlandı, sahada oynandı
  FT: "FINISHED",
  AET: "FINISHED",
  PEN: "FINISHED",
  FINISHED: "FINISHED",
  FULL_TIME: "FINISHED",
  AFTER_EXTRA_TIME: "FINISHED",
  PENALTIES: "FINISHED",
  "MATCH FINISHED": "FINISHED",

  // Tamamlandı, hükmen
  AWD: "AWARDED",
  AWARDED: "AWARDED",
  WO: "AWARDED",
  WALKOVER: "AWARDED",

  // Oynanmadı ve oynanmayacak (ya da ertelendi)
  PST: "POSTPONED",
  POSTPONED: "POSTPONED",
  CANC: "CANCELLED",
  CANCELLED: "CANCELLED",
  ABD: "ABANDONED",
  ABANDONED: "ABANDONED"
});

/** Oyun sürüyor (devre arası ve geçici kesinti dahil). */
const LIVE_STATES = new Set(["LIVE", "HALFTIME", "INTERRUPTED"]);

/** Sahada oynanıp tamamlanmış. */
const PLAYED_STATES = new Set(["FINISHED"]);

/** Analiz hattına giren tüm durumlar — hükmen sonuçlar dahil. */
const ANALYZABLE_STATES = new Set(["FINISHED", "AWARDED"]);

/** Nihai sonucu olmayan, oynanmamış maçlar. */
const UNPLAYED_STATES = new Set(["POSTPONED", "CANCELLED", "ABANDONED"]);

/**
 * Başlama saati geçmiş bir maçın doğrulanmış canlı sinyal olmadan "hâlâ
 * oynanıyor" sayılabileceği en uzun süre. Uzatma, devre arası ve makul
 * gecikme buna sığar; ötesinde maç ya bitmiştir ya da sağlayıcı veriyi
 * vermiyordur. İkisi de "canlı" değildir.
 */
const LIVE_GRACE_MS = 150 * 60 * 1000;

/**
 * Sağlayıcı bir alanı döndürmediğinde arayüzde görünecek metin.
 *
 * "Veri bekleniyor" ile bilinçli olarak farklı: o metin "henüz gelmedi,
 * gelebilir" demek. Bu metin ise maç bitmiş ve sağlayıcı o veriyi hiç
 * vermemiş demek.
 */
const PROVIDER_MISSING_LABEL = "Veri sağlayıcı tarafından sunulmadı";

/** Doğrulanamayan canlı durum için arayüz metni. */
const UNVERIFIED_LIVE_LABEL = "Canlı veri doğrulanamadı";

const STATE_LABELS = Object.freeze({
  SCHEDULED: "Başlamadı",
  LIVE: "Canlı",
  HALFTIME: "Devre arası",
  INTERRUPTED: "Maça ara verildi",
  FINISHED: "Tamamlandı",
  AWARDED: "Hükmen sonuçlandı",
  POSTPONED: "Ertelendi",
  CANCELLED: "İptal edildi",
  ABANDONED: "Tatil edildi",
  UNKNOWN: "Durum doğrulanmadı"
});

function normalizeStatusToken(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/**
 * Kanonik duruma çevirir. TANINMAYAN KOD "SCHEDULED" OLMAZ — "UNKNOWN"
 * olur. Eski davranış (bilinmeyeni programlanmış saymak) ertelenen bir maçı
 * "birazdan başlayacak" gibi gösteriyordu; bilinmeyen durum bilinmeyen
 * olarak taşınmalı ki arayüz "durum doğrulanmadı" diyebilsin.
 */
function canonicalStatus(value) {
  const token = normalizeStatusToken(value);

  if (!token) {
    return "UNKNOWN";
  }

  // Sözlük hem boşluklu ("MATCH FINISHED") hem alt çizgili biçimi taşıyor.
  return STATUS_VOCABULARY[token] || STATUS_VOCABULARY[token.replace(/_/g, " ")] || "UNKNOWN";
}

/** Kayıttaki tüm durum alanları (kaynaklar farklı alan adları kullanıyor). */
function statusesOf(match) {
  if (!match) {
    return [];
  }

  return [match.status, match.providerStatus, match.matchStatus]
    .map(normalizeStatusToken)
    .filter(Boolean);
}

/**
 * Kaydın kanonik durumu. Birden fazla alan doluysa EN İLERİ durum kazanır:
 * sağlayıcı "FT" derken kürasyonlu kayıt hâlâ "SCHEDULED" taşıyor olabilir.
 */
const STATE_RANK = { UNKNOWN: 0, SCHEDULED: 1, LIVE: 2, HALFTIME: 2, INTERRUPTED: 2, POSTPONED: 3, CANCELLED: 3, ABANDONED: 3, AWARDED: 4, FINISHED: 4 };

function matchState(match) {
  const states = statusesOf(match).map(canonicalStatus).filter((state) => state !== "UNKNOWN");

  if (!states.length) {
    return match && match.live === true ? "LIVE" : "UNKNOWN";
  }

  return states.reduce((best, state) => (STATE_RANK[state] > STATE_RANK[best] ? state : best), states[0]);
}

function isLiveStatus(match) {
  return LIVE_STATES.has(matchState(match)) || (match && match.live === true && matchState(match) !== "FINISHED");
}

function isFinishedStatus(match) {
  return PLAYED_STATES.has(matchState(match));
}

function isAwardedStatus(match) {
  return matchState(match) === "AWARDED";
}

function isUnplayedStatus(match) {
  return UNPLAYED_STATES.has(matchState(match));
}

/** Analiz hattına girer mi? FT/AET/PEN + hükmen (AWD/WO). */
function isAnalyzableStatus(match) {
  return ANALYZABLE_STATES.has(matchState(match));
}

function statusLabel(match) {
  return STATE_LABELS[matchState(match)] || STATE_LABELS.UNKNOWN;
}

// ── Geriye dönük adlar ───────────────────────────────────────────────────
// Zincirin geri kalanı bu adları kullanıyor; anlamları değişmedi.
const isFinishedMatch = isFinishedStatus;
const isAwardedMatch = isAwardedStatus;
const isAnalyzableMatch = isAnalyzableStatus;

/** Bitiş şekli: normal süre / uzatma / penaltılar / hükmen. */
function finishType(match) {
  const tokens = statusesOf(match);

  if (tokens.some((token) => token === "PEN" || token === "PENALTIES")) return "penalties";
  if (tokens.some((token) => token === "AET" || token === "AFTER_EXTRA_TIME")) return "extra-time";
  if (isAwardedStatus(match)) return "awarded";

  return "regular";
}

const FINISH_LABELS = Object.freeze({
  regular: "Normal sürede tamamlandı",
  "extra-time": "Uzatma devrelerinde tamamlandı",
  penalties: "Penaltı atışlarıyla belirlendi",
  awarded: "Hükmen sonuçlandı"
});

function finishLabel(match) {
  return FINISH_LABELS[finishType(match)];
}

function kickoffMs(match) {
  const raw = String((match && (match.kickoff || match.date || match.utcDate)) || "");
  if (!raw) return null;
  const hasTime = raw.includes("T") || raw.includes(":");
  const parsed = Date.parse(hasTime ? raw : `${raw.slice(0, 10)}T00:00:00+03:00`);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * BAYAT CANLI KORUMASI.
 *
 * "Bu maç şu anda canlı gösterilmeli mi?" sorusunun tek cevabı. Üç sonuç:
 *
 *   live       — sağlayıcı canlı diyor, göster.
 *   unverified — başlama saati geçti, canlı sinyal YOK. Canlı GÖSTERME;
 *                arayüz "canlı veri doğrulanamadı" yazar. Skor ya da
 *                dakika uydurulmaz.
 *   not-live   — maç ya başlamadı ya bitti ya da oynanmayacak.
 *
 * `stale` bayrağı, canlı işaretli ama uzun süredir güncellenmemiş maçları
 * ayırır: yeniden denemeye değer, ama o hâliyle canlı sayılmaz.
 */
function liveVerdict(match, options) {
  const settings = options || {};
  const nowMs = Number.isFinite(settings.nowMs) ? settings.nowMs : Date.now();
  const graceMs = Number.isFinite(settings.graceMs) ? settings.graceMs : LIVE_GRACE_MS;
  const state = matchState(match);

  if (PLAYED_STATES.has(state) || state === "AWARDED") {
    return { live: false, verdict: "not-live", reason: "finished", state };
  }

  if (UNPLAYED_STATES.has(state)) {
    return { live: false, verdict: "not-live", reason: "unplayed", state };
  }

  const kickoff = kickoffMs(match);

  if (LIVE_STATES.has(state)) {
    // Canlı işaretli ama sağlayıcı uzun süredir güncellemiyorsa bu maç
    // muhtemelen bitmiştir ve sonucu gelmemiştir. Canlı gösterilmez.
    if (kickoff !== null && nowMs - kickoff > graceMs) {
      return { live: false, verdict: "unverified", reason: "stale-live", stale: true, state };
    }
    return { live: true, verdict: "live", reason: "provider-live", state };
  }

  // Buradan sonrası SCHEDULED veya UNKNOWN.
  if (kickoff === null) {
    return { live: false, verdict: "not-live", reason: "no-kickoff", state };
  }

  if (kickoff > nowMs) {
    return { live: false, verdict: "not-live", reason: "not-started", state };
  }

  // Başlama saati geçti, sağlayıcı canlı demiyor. Doğrulanmamış.
  return {
    live: false,
    verdict: "unverified",
    reason: nowMs - kickoff > graceMs ? "kickoff-long-passed" : "kickoff-passed-no-signal",
    stale: nowMs - kickoff <= graceMs,
    state
  };
}

/** Arayüzün doğrudan basabileceği durum metni. */
function displayStatusLabel(match, options) {
  const verdict = liveVerdict(match, options);

  if (verdict.verdict === "unverified") {
    return UNVERIFIED_LIVE_LABEL;
  }

  return statusLabel(match);
}

module.exports = {
  ANALYZABLE_STATES,
  FINISH_LABELS,
  LIVE_GRACE_MS,
  LIVE_STATES,
  PLAYED_STATES,
  PROVIDER_MISSING_LABEL,
  STATE_LABELS,
  STATUS_VOCABULARY,
  UNPLAYED_STATES,
  UNVERIFIED_LIVE_LABEL,
  canonicalStatus,
  displayStatusLabel,
  finishLabel,
  finishType,
  isAnalyzableMatch,
  isAnalyzableStatus,
  isAwardedMatch,
  isAwardedStatus,
  isFinishedMatch,
  isFinishedStatus,
  isLiveStatus,
  isUnplayedStatus,
  kickoffMs,
  liveVerdict,
  matchState,
  normalizeStatusToken,
  statusLabel,
  statusesOf
};
