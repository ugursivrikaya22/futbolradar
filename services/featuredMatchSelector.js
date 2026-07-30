/**
 * ANA SAYFA HERO KARTI — MAÇ SEÇİMİ
 *
 * Ana sayfadaki en büyük kartın tek bir kuralı var: bugün oynanan ya da şu
 * anda canlı olan bir Türk takımı maçı varsa, ilk ve en büyük kart O maçtır.
 * Kural mutlak; kürasyonlu liste, sağlayıcı takvimi veya statik yedek
 * içerik bunu ezemez.
 *
 * Seçim iki adımda yapılır:
 *
 *   1. HAVUZ — "bugün" oynanan maçlar ile (tarihi ne olursa olsun) canlı
 *      maçlar. Önce yalnızca Türk takımı olan maçlar denenir; havuz boşsa
 *      aynı sıralama tüm maçlara uygulanır.
 *   2. BANT — havuz içinde durum önceliği:
 *        live        → sağlayıcı canlı diyor
 *        in-progress → başlama saati geçmiş, bitmemiş (durum henüz
 *                      güncellenmemiş olabilir; sağlayıcı gecikmesi bir
 *                      maçı hero'dan düşürmemeli)
 *        upcoming    → başlayacak, en yakın olan önce
 *        played      → oynanmış, en yenisi önce
 *
 * "in-progress" bandı neden var: sağlayıcı takvimi günde birkaç kez
 * tazeleniyor ve saat 19:08'de 18:30 maçı hâlâ "SCHEDULED" görünebiliyor.
 * Sadece duruma bakan bir sıralama o maçı "başlayacak" saymayıp atlıyor ve
 * hero'da o an oynanan maç yerine daha geç bir karşılaşma kalıyordu. Bant,
 * skor veya dakika UYDURMAZ — yalnızca kart sırasını etkiler.
 */

const { isTurkishMatch, turkishSideOf } = require("./turkishTeams");

const LIVE_STATUSES = new Set(["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"]);
const FINISHED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN", "AWARDED", "WO"]);

/**
 * Başlama saati geçmiş bir maçın "hâlâ oynanıyor" sayılacağı süre. Uzatma
 * ve devre araları dahil bir maç bu pencereyi aşmaz; sonrasında maç
 * oynanmış kabul edilir.
 */
const IN_PROGRESS_WINDOW_MS = 150 * 60 * 1000;

const BAND_ORDER = ["live", "in-progress", "upcoming", "played"];

const REASON_LABELS = {
  "turkish-live": "Canlı Türk takımı maçı",
  "turkish-in-progress": "Oynanmakta olan Türk takımı maçı",
  "turkish-upcoming": "Bugünün en yakın Türk takımı maçı",
  "turkish-played": "Bugün oynanan son Türk takımı maçı",
  live: "Canlı maç (bugün Türk takımı maçı yok)",
  "in-progress": "Oynanmakta olan maç (bugün Türk takımı maçı yok)",
  upcoming: "Bugünün en yakın maçı (Türk takımı maçı yok)",
  played: "Bugün oynanan son maç (Türk takımı maçı yok)",
  "next-fixture": "Bugün maç yok; takvimdeki sıradaki karşılaşma",
  empty: "Gösterilecek doğrulanmış maç yok"
};

function istanbulToday(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now instanceof Date ? now : new Date());
}

function matchDateValue(match) {
  const value = match && (match.kickoff || match.date || match.utcDate);
  return value ? String(value).slice(0, 10) : "";
}

/**
 * Karşılaştırılabilir başlama zamanı. Yalnızca gün taşıyan kayıtlarda
 * ("2026-07-30") saat bilgisi uydurulmaz; gün başlangıcı kullanılır ve
 * kaydın saatinin bilinmediği `hasTime` ile ayrıca taşınır.
 */
function kickoffTime(match) {
  const raw = String((match && (match.kickoff || match.date || match.utcDate)) || "");

  if (!raw) {
    return { value: Number.POSITIVE_INFINITY, hasTime: false };
  }

  const hasTime = raw.includes("T") || raw.includes(":");
  const parsed = Date.parse(hasTime ? raw : `${raw.slice(0, 10)}T00:00:00+03:00`);

  return {
    value: Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed,
    hasTime
  };
}

function statusOf(match) {
  return String((match && (match.status || match.providerStatus)) || "").toUpperCase();
}

function isLiveMatch(match) {
  if (!match) {
    return false;
  }

  return match.live === true || LIVE_STATUSES.has(statusOf(match));
}

function isFinishedMatch(match) {
  return FINISHED_STATUSES.has(statusOf(match));
}

/** Maçın hangi banda düştüğü. */
function bandOf(match, nowMs) {
  if (isLiveMatch(match)) {
    return "live";
  }

  if (isFinishedMatch(match)) {
    return "played";
  }

  const kickoff = kickoffTime(match);

  if (!Number.isFinite(kickoff.value) || !kickoff.hasTime) {
    // Saati açıklanmamış maç "şu anda oynanıyor" sayılamaz.
    return "upcoming";
  }

  if (kickoff.value > nowMs) {
    return "upcoming";
  }

  return nowMs - kickoff.value <= IN_PROGRESS_WINDOW_MS ? "in-progress" : "played";
}

/**
 * Bant içi sıralama: oynanmış maçlarda en yeni, diğerlerinde en erken
 * başlayan önce. Eşitlikte id ile kararlı sıralama.
 */
function compareWithinBand(band, left, right) {
  const leftValue = kickoffTime(left).value;
  const rightValue = kickoffTime(right).value;

  if (leftValue !== rightValue) {
    return band === "played" ? rightValue - leftValue : leftValue - rightValue;
  }

  return String((left && left.id) || "").localeCompare(String((right && right.id) || ""));
}

function pickFromPool(pool, nowMs) {
  for (const band of BAND_ORDER) {
    const inBand = pool.filter((match) => bandOf(match, nowMs) === band);

    if (inBand.length) {
      const sorted = inBand.slice().sort((left, right) => compareWithinBand(band, left, right));
      return { match: sorted[0], band };
    }
  }

  return null;
}

/**
 * Hero kartında gösterilecek maçı seçer.
 *
 * @param {Array} matches Aday maçlar (kürasyonlu + sağlayıcı, birleştirilmiş).
 * @param {{now?: Date, today?: string}} [options]
 * @returns {{match: Object|null, reason: string, reasonLabel: string,
 *   turkish: boolean, turkishTeam: string, band: string,
 *   candidateCount: number, turkishCandidateCount: number}}
 */
function selectFeaturedMatch(matches, options) {
  const settings = options || {};
  const now = settings.now instanceof Date ? settings.now : new Date();
  const nowMs = now.getTime();
  const today = settings.today || istanbulToday(now);
  const list = (Array.isArray(matches) ? matches : []).filter(Boolean);

  // Havuz: bugünün maçları + tarihi ne olursa olsun canlı maçlar. Gece
  // yarısını aşan bir maç TSİ'de "dün" görünse de canlıysa hero'ya girer.
  const pool = list.filter((match) => matchDateValue(match) === today || isLiveMatch(match));
  const turkishPool = pool.filter(isTurkishMatch);

  const turkishPick = pickFromPool(turkishPool, nowMs);

  if (turkishPick) {
    return describe(turkishPick.match, `turkish-${turkishPick.band}`, turkishPick.band, pool.length, turkishPool.length);
  }

  const generalPick = pickFromPool(pool, nowMs);

  if (generalPick) {
    return describe(generalPick.match, generalPick.band, generalPick.band, pool.length, 0);
  }

  // Bugün maç yoksa takvimdeki sıradaki karşılaşma gösterilir; hero boş
  // kalmasın diye. Türk takımı maçı varsa yine önce o denenir.
  const upcoming = list
    .filter((match) => matchDateValue(match) > today)
    .sort((left, right) => kickoffTime(left).value - kickoffTime(right).value);
  const next = upcoming.find(isTurkishMatch) || upcoming[0] || null;

  if (next) {
    return describe(next, "next-fixture", "upcoming", pool.length, 0);
  }

  return describe(null, "empty", "", pool.length, 0);
}

function describe(match, reason, band, candidateCount, turkishCandidateCount) {
  return {
    match: match || null,
    reason,
    reasonLabel: REASON_LABELS[reason] || reason,
    band,
    turkish: Boolean(match) && isTurkishMatch(match),
    turkishTeam: match ? turkishSideOf(match) : "",
    candidateCount,
    turkishCandidateCount
  };
}

/**
 * İç günlük: hero kartında hangi maçın neden seçildiği. Kart beklenmedik
 * bir maç gösterdiğinde tek bakılacak yer burasıdır.
 */
function formatFeaturedSelectionLog(scope, selection) {
  const match = selection && selection.match;

  return [
    "[futbolradar:featured-match]",
    `scope=${scope}`,
    `reason=${(selection && selection.reason) || "empty"}`,
    `id=${(match && match.id) || "-"}`,
    `match="${match ? `${match.homeTeam || "?"} - ${match.awayTeam || "?"}` : "-"}"`,
    `turkish=${Boolean(selection && selection.turkish)}`,
    `turkishTeam="${(selection && selection.turkishTeam) || "-"}"`,
    `candidates=${(selection && selection.candidateCount) || 0}`,
    `turkishCandidates=${(selection && selection.turkishCandidateCount) || 0}`
  ].join(" ");
}

function logFeaturedSelection(scope, selection) {
  console.log(formatFeaturedSelectionLog(scope, selection));
}

module.exports = {
  BAND_ORDER,
  IN_PROGRESS_WINDOW_MS,
  REASON_LABELS,
  bandOf,
  formatFeaturedSelectionLog,
  istanbulToday,
  logFeaturedSelection,
  selectFeaturedMatch
};
