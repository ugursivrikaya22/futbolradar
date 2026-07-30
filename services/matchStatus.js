/**
 * MAÇ DURUMU — tek yetkili sınıflandırma.
 *
 * SORUN. Aynı soru ("bu maç bitti mi?") depoda dört ayrı yerde, dört ayrı
 * sözlükle cevaplanıyordu:
 *
 *   services/matchEligibility.js      FINISHED_STATUSES / LIVE_STATUSES
 *   services/matchReportStages.js     FINISHED_LABELS / IN_PLAY_LABELS / ABANDONED_LABELS
 *   services/superLigFixtureService.js STATUS_ALIASES
 *   services/providers/apiFootballProvider.js normalizeStatus
 *
 * Dördü BİRBİRİYLE ÇELİŞİYORDU ve çelişki sessizdi. Örnekler:
 *
 *   - "HALFTIME" ve "PAUSED" fikstür sözlüğünde hiç yoktu; bilinmeyen etiket
 *     "SCHEDULED"a düşüyordu. Devre arasındaki bir maç fikstür satırında
 *     "Planlandı" yazıyordu — oynanmakta olan maç oynanmamış gibi görünüyordu.
 *   - "ABANDONED" ve "SUSPENDED" aynı şekilde "SCHEDULED"a düşüyordu: tatil
 *     edilen maç takvimde hâlâ bekleyen bir karşılaşma gibi duruyordu.
 *   - Sağlayıcı sözlüğü "PST" (ertelendi) etiketini de "SCHEDULED" yapıyordu;
 *     ertelenen maç ile oynanacak maç arasındaki fark kayboluyordu.
 *
 * Bu dosya o dört sözlüğün yerine geçer. Her biri artık buraya delege eder;
 * sunum eşlemesi (hangi durum hangi CSS sınıfına, hangi Türkçe cümleye
 * gider) çağıranda kalır ama SINIFLANDIRMA tek yerde yapılır.
 *
 * SÖZLÜK KAPALI. Tanınmayan etiket sessizce "SCHEDULED" olmaz — `UNKNOWN`
 * olur. Aradaki fark önemli: "planlandı" bir iddiadır ("bu maç oynanmadı"),
 * "durum bekleniyor" ise bir itiraftır ("etiketi okuyamadık"). Sağlayıcı yeni
 * bir kısaltma göndermeye başladığında bunu uydurma bir iddiaya çevirmek,
 * bitmiş bir maçı günlerce "planlandı" göstermenin tam olarak yoluydu.
 */

/** Kanonik durumlar. Başka bir değer üretilmez. */
const MATCH_STATUS = Object.freeze({
  SCHEDULED: "SCHEDULED",
  LIVE: "LIVE",
  HALFTIME: "HALFTIME",
  FINISHED: "FINISHED",
  POSTPONED: "POSTPONED",
  CANCELLED: "CANCELLED",
  ABANDONED: "ABANDONED",
  AWARDED: "AWARDED",
  UNKNOWN: "UNKNOWN"
});

/**
 * HAM ETİKET → KANONİK DURUM.
 *
 * Kaynaklar: API-Football kısaltmaları (NS, 1H, HT, FT, AET, PEN, PST, ABD,
 * AWD, WO…), football-data.org (SCHEDULED, IN_PLAY, PAUSED, FINISHED…),
 * TheSportsDB (Match Finished, Not Started…) ve deponun kendi kayıtları.
 * Hepsi tek tabloda toplandı; bir kaynağın tanıdığı etiketi diğerinin
 * tanımaması, çelişkinin asıl kaynağıydı.
 */
const STATUS_ALIASES = Object.freeze({
  // Oynanmadı, oynanacak
  SCHEDULED: MATCH_STATUS.SCHEDULED,
  NS: MATCH_STATUS.SCHEDULED,
  TIMED: MATCH_STATUS.SCHEDULED,
  TBD: MATCH_STATUS.SCHEDULED,
  "NOT STARTED": MATCH_STATUS.SCHEDULED,

  // Oynanıyor
  LIVE: MATCH_STATUS.LIVE,
  IN_PLAY: MATCH_STATUS.LIVE,
  INPLAY: MATCH_STATUS.LIVE,
  "1H": MATCH_STATUS.LIVE,
  "2H": MATCH_STATUS.LIVE,
  ET: MATCH_STATUS.LIVE,
  P: MATCH_STATUS.LIVE,
  INT: MATCH_STATUS.LIVE,

  // Devre arası: oynanıyor sayılır ama ayrı yazılır. Skor tablosunda
  // "Canlı"ya ezilirse oynanmayan bir dakika bekleniyormuş gibi görünüyor.
  HT: MATCH_STATUS.HALFTIME,
  HALFTIME: MATCH_STATUS.HALFTIME,
  "HALF TIME": MATCH_STATUS.HALFTIME,
  BT: MATCH_STATUS.HALFTIME,
  PAUSED: MATCH_STATUS.HALFTIME,

  // Bitti
  FINISHED: MATCH_STATUS.FINISHED,
  FT: MATCH_STATUS.FINISHED,
  AET: MATCH_STATUS.FINISHED,
  PEN: MATCH_STATUS.FINISHED,
  "MATCH FINISHED": MATCH_STATUS.FINISHED,

  // Oynanmadı, oynanmayacak (ya da yarıda kaldı)
  POSTPONED: MATCH_STATUS.POSTPONED,
  PST: MATCH_STATUS.POSTPONED,
  CANCELLED: MATCH_STATUS.CANCELLED,
  CANCELED: MATCH_STATUS.CANCELLED,
  CANC: MATCH_STATUS.CANCELLED,
  ABANDONED: MATCH_STATUS.ABANDONED,
  ABD: MATCH_STATUS.ABANDONED,
  SUSPENDED: MATCH_STATUS.ABANDONED,
  SUSP: MATCH_STATUS.ABANDONED,

  // Hükmen: skor vardır ama sahada oynanarak elde edilmemiştir. Maç raporu
  // konusu değildir — rapor, sahada olanı anlatır.
  AWARDED: MATCH_STATUS.AWARDED,
  AWD: MATCH_STATUS.AWARDED,
  WO: MATCH_STATUS.AWARDED
});

/**
 * DURUM CÜMLELERİ templates/match-status.json'da yaşıyor.
 *
 * Sebep şablon dosyasının başında yazılı: metin ile karar ayrı tutulur ki
 * bir gün "Tatil edildi" ifadesi düzeltilirken hangi ham etiketin hangi
 * duruma düştüğüne dokunulmasın.
 */
const STATUS_LABELS = Object.freeze(require("../templates/match-status.json").statuses);

/**
 * Oynanmakta sayılan durumlar.
 *
 * Değerler MATCH_STATUS sözlüğünden; burada düz metin yazılmalarının sebebi
 * kural defterinin (rules/registry.json) bu tabloyu kaynaktan okuyup
 * doğrulayabilmesi. Yazım hatasına karşı koruma sembol referansı değil,
 * scripts/test-post-match-completion.mjs içindeki "her değer MATCH_STATUS
 * üyesi olmalı" denetimi.
 */
const IN_PLAY = Object.freeze(["LIVE", "HALFTIME"]);

/**
 * Sahada normal biçimde tamamlanmamış durumlar. Rapor da analiz de üretilmez:
 * anlatılacak bir maç yoktur.
 */
const NOT_PLAYED = Object.freeze(["POSTPONED", "CANCELLED", "ABANDONED", "AWARDED"]);

/**
 * Ham etiketi kanonik duruma çevirir.
 *
 * @param {*} rawStatus Sağlayıcıdan ya da kayıttan gelen ham etiket.
 * @returns {string} MATCH_STATUS değerlerinden biri; tanınmayan ya da boş
 *   etiket için MATCH_STATUS.UNKNOWN.
 */
function normalizeMatchStatus(rawStatus) {
  const key = String(rawStatus === null || rawStatus === undefined ? "" : rawStatus)
    .trim()
    .toUpperCase();
  if (!key) return MATCH_STATUS.UNKNOWN;
  return STATUS_ALIASES[key] || MATCH_STATUS.UNKNOWN;
}

/** Maç kaydının durumu. `match.status` okunur. */
function matchStatusOf(match) {
  return normalizeMatchStatus(match && match.status);
}

/** Bitmiş mi? Ham etiket de kanonik değer de kabul edilir. */
function isFinishedStatus(rawStatus) {
  return normalizeMatchStatus(rawStatus) === MATCH_STATUS.FINISHED;
}

/** Oynanıyor mu? (devre arası dahil) */
function isInPlayStatus(rawStatus) {
  return IN_PLAY.includes(normalizeMatchStatus(rawStatus));
}

/** Ertelendi / iptal / tatil / hükmen mi? */
function isNotPlayedStatus(rawStatus) {
  return NOT_PLAYED.includes(normalizeMatchStatus(rawStatus));
}

/** Oynanacak mı? */
function isScheduledStatus(rawStatus) {
  return normalizeMatchStatus(rawStatus) === MATCH_STATUS.SCHEDULED;
}

/** Etiket okunabildi mi? */
function isKnownStatus(rawStatus) {
  return normalizeMatchStatus(rawStatus) !== MATCH_STATUS.UNKNOWN;
}

/** Okuyucuya basılacak Türkçe cümle. */
function statusLabel(rawStatus) {
  const entry = STATUS_LABELS[normalizeMatchStatus(rawStatus)];
  return entry ? entry.text : STATUS_LABELS.UNKNOWN.text;
}

/** CSS sınıfına / data-status niteliğine giden slug. */
function statusSlug(rawStatus) {
  const entry = STATUS_LABELS[normalizeMatchStatus(rawStatus)];
  return entry ? entry.slug : STATUS_LABELS.UNKNOWN.slug;
}

/** Tanınan tüm ham etiketler — testler ve aynalar için. */
function knownAliases() {
  return Object.keys(STATUS_ALIASES);
}

module.exports = {
  IN_PLAY,
  MATCH_STATUS,
  NOT_PLAYED,
  STATUS_ALIASES,
  STATUS_LABELS,
  isFinishedStatus,
  isInPlayStatus,
  isKnownStatus,
  isNotPlayedStatus,
  isScheduledStatus,
  knownAliases,
  matchStatusOf,
  normalizeMatchStatus,
  statusLabel,
  statusSlug
};
