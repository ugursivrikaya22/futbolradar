/**
 * TAZELEME POLİTİKASI — hangi maç ne sıklıkta yoklanır?
 *
 * SORUN. Canlı iş beş dakikada bir koşuyor ve her koşuda aynı işi yapıyordu:
 * pencereye giren her maç için sağlayıcıya gidiyordu. Ücretsiz API-Football
 * paketi günde 100 istek veriyor. Yarın oynanacak bir maçı beş dakikada bir
 * sormak, o kotayı hiçbir şey kazanmadan tüketir; buna karşılık şu anda
 * oynanan bir maçı beş dakikada bir sormak yetersizdir.
 *
 * ÇÖZÜM. Her maç, durumuna ve başlama saatine göre bir KADEMEye düşer ve
 * her kademenin kendi tazeleme aralığı vardır. `shouldRefresh` yalnızca
 * "bu maçın son başarılı senkronundan bu yana kademesinin aralığı geçti mi"
 * sorusunu yanıtlar — koşu sıklığından bağımsız, saf ve test edilebilir.
 *
 * Kademeler (kullanıcı gereksinimiyle birebir):
 *
 *   archived        — çok eski, tamamlanmış ve verisi tam. Yoklanmaz.
 *   scheduled-far   — başlamasına 6 saatten çok var.        6 saat
 *   scheduled-near   — 6 saat içinde başlıyor.               30 dakika
 *   live            — oynanıyor.                              1 dakika
 *   paused          — devre arası / ara verildi.               2 dakika
 *   just-finished   — yeni bitti, veri henüz tam değil.        3 dakika
 *   settling        — bitti, veri tamamlanana kadar.          15 dakika
 *   unplayed        — ertelendi/iptal/tatil.                   6 saat
 *
 * "just-finished" ve "settling" ayrımı önemli: sağlayıcılar istatistik ve
 * kadroları son düdükten dakikalar sonra yayımlıyor. Maç biter bitmez
 * durmak, o maçı kalıcı olarak eksik veriyle bırakır. Veri tamamlandığında
 * ("dataComplete") kademe "archived" olur ve istek harcanmaz.
 */

const {
  isAnalyzableStatus,
  isLiveStatus,
  isUnplayedStatus,
  kickoffMs,
  matchState
} = require("./matchStatus");

/** Kademe → tazeleme aralığı (ms). */
const TIER_INTERVALS = Object.freeze({
  live: 60 * 1000,
  paused: 2 * 60 * 1000,
  "just-finished": 3 * 60 * 1000,
  settling: 15 * 60 * 1000,
  "scheduled-near": 30 * 60 * 1000,
  "scheduled-far": 6 * 60 * 60 * 1000,
  unplayed: 6 * 60 * 60 * 1000,
  archived: Number.POSITIVE_INFINITY
});

const TIER_ORDER = ["live", "paused", "just-finished", "settling", "scheduled-near", "scheduled-far", "unplayed", "archived"];

/** "Yakın" eşiği: bu süre içinde başlayan maç orta sıklıkla yoklanır. */
const NEAR_KICKOFF_MS = 6 * 60 * 60 * 1000;

/** Bitişten sonra "taze bitti" sayılan süre. */
const JUST_FINISHED_MS = 30 * 60 * 1000;

/**
 * Bitişten sonra sağlayıcının veriyi tamamlaması için beklenen en uzun süre.
 * Bunun ötesinde veri hâlâ eksikse sağlayıcı o maç için vermiyor demektir;
 * sürekli sormak kotayı boşa harcar.
 */
const SETTLING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Analiz için beklenen sağlayıcı alanları. */
const EXPECTED_FIELDS = ["events", "statistics", "lineups"];

function countOf(match, field) {
  const value = match && match[field];
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Veri tamlığı 0–1. Yalnızca sağlayıcının gerçekten döndürdüğü alanları
 * sayar; eksik alan için varsayım yapılmaz.
 */
function dataCompleteness(match) {
  const present = EXPECTED_FIELDS.filter((field) => countOf(match, field) > 0).length;
  const hasScore = Boolean(match && match.score &&
    typeof match.score.home === "number" && typeof match.score.away === "number");

  return Math.round(((present + (hasScore ? 1 : 0)) / (EXPECTED_FIELDS.length + 1)) * 100) / 100;
}

/** Analiz için yeterli veri var mı? Skor + en az bir ölçülmüş alan. */
function hasCompleteMatchData(match) {
  const hasScore = Boolean(match && match.score &&
    typeof match.score.home === "number" && typeof match.score.away === "number");
  return hasScore && EXPECTED_FIELDS.every((field) => countOf(match, field) > 0);
}

function parseTime(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Maçın tazeleme kademesi.
 *
 * @param {Object} match
 * @param {{nowMs?: number}} [options]
 */
function refreshTier(match, options) {
  const settings = options || {};
  const nowMs = Number.isFinite(settings.nowMs) ? settings.nowMs : Date.now();
  const state = matchState(match);
  const kickoff = kickoffMs(match);

  if (isLiveStatus(match)) {
    return state === "LIVE" ? "live" : "paused";
  }

  if (isUnplayedStatus(match)) {
    return "unplayed";
  }

  if (isAnalyzableStatus(match)) {
    // Verisi tamamlanmış maç bir daha sorulmaz — kotanın büyük kısmı
    // buradan kurtuluyor.
    if (hasCompleteMatchData(match)) {
      return "archived";
    }

    if (kickoff === null) {
      return "settling";
    }

    const sinceKickoff = nowMs - kickoff;
    if (sinceKickoff < 0) return "settling";
    if (sinceKickoff <= JUST_FINISHED_MS + 120 * 60 * 1000) return "just-finished";
    if (sinceKickoff <= SETTLING_WINDOW_MS) return "settling";

    // Bir günden eski ve hâlâ eksik: sağlayıcı bu maç için vermiyor.
    return "archived";
  }

  if (kickoff === null) {
    return "scheduled-far";
  }

  return kickoff - nowMs <= NEAR_KICKOFF_MS ? "scheduled-near" : "scheduled-far";
}

function refreshIntervalMs(match, options) {
  return TIER_INTERVALS[refreshTier(match, options)];
}

/**
 * Bu maç şimdi yoklanmalı mı? Son BAŞARILI senkron zamanına bakar; başarısız
 * bir deneme sayacı ilerletmez, yoksa hata veren bir maç bir daha hiç
 * denenmezdi.
 */
function shouldRefresh(match, options) {
  const settings = options || {};
  const nowMs = Number.isFinite(settings.nowMs) ? settings.nowMs : Date.now();
  const tier = refreshTier(match, { nowMs });
  const interval = TIER_INTERVALS[tier];

  if (!Number.isFinite(interval)) {
    return { refresh: false, tier, reason: "archived", dueInMs: Infinity };
  }

  const last = parseTime(settings.lastSyncAt || (match && match.lastSuccessfulSyncAt));

  if (last === null) {
    return { refresh: true, tier, reason: "never-synced", dueInMs: 0 };
  }

  const elapsed = nowMs - last;

  if (elapsed >= interval) {
    return { refresh: true, tier, reason: "interval-elapsed", dueInMs: 0, elapsed };
  }

  return { refresh: false, tier, reason: "interval-not-elapsed", dueInMs: interval - elapsed };
}

/**
 * Bir koşuda yoklanacak maçları seçer ve kademe önceliğine göre sıralar.
 * `limit` kota tamponu: tek koşuda harcanacak istek sayısını sınırlar.
 */
function planRefresh(matches, options) {
  const settings = options || {};
  const nowMs = Number.isFinite(settings.nowMs) ? settings.nowMs : Date.now();
  const limit = Number.isFinite(settings.limit) ? settings.limit : 20;
  const list = (Array.isArray(matches) ? matches : []).filter(Boolean);

  const due = [];
  const skipped = [];

  for (const match of list) {
    const verdict = shouldRefresh(match, { nowMs });
    if (verdict.refresh) {
      due.push({ match, ...verdict });
    } else {
      skipped.push({ matchId: match.id, tier: verdict.tier, reason: verdict.reason });
    }
  }

  due.sort((left, right) => {
    const tierGap = TIER_ORDER.indexOf(left.tier) - TIER_ORDER.indexOf(right.tier);
    if (tierGap !== 0) return tierGap;
    return String(left.match.id || "").localeCompare(String(right.match.id || ""));
  });

  return {
    due: due.slice(0, limit),
    deferred: due.slice(limit),
    skipped,
    counts: due.reduce((totals, entry) => {
      totals[entry.tier] = (totals[entry.tier] || 0) + 1;
      return totals;
    }, {})
  };
}

module.exports = {
  EXPECTED_FIELDS,
  JUST_FINISHED_MS,
  NEAR_KICKOFF_MS,
  SETTLING_WINDOW_MS,
  TIER_INTERVALS,
  TIER_ORDER,
  dataCompleteness,
  hasCompleteMatchData,
  planRefresh,
  refreshIntervalMs,
  refreshTier,
  shouldRefresh
};
