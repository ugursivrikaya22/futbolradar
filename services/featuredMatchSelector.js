/**
 * ANA SAYFA HERO KARUSELİ — MAÇ SIRASI
 *
 * Hero'daki büyük kart 10 saniyede bir dönen bir karusel. Hangi maçın hangi
 * sırada geleceği tek bir yerde, burada belirlenir; kürasyonlu liste,
 * sağlayıcı takvimi veya statik yedek içerik bu sırayı ezemez.
 *
 * KADEME (tier) sırası — ilk kart daima kademe 0'ın en iyisidir:
 *
 *   0. Canlı Türk takımı maçı        → ilk karta sabitlenir
 *   1. Bugünün diğer Türk maçları    → canlı Türk maçı yoksa ilk kart
 *   2. Büyük kulüplerin canlı maçı   → Real Madrid, Bayern ve benzerleri
 *   3. Diğer canlı maçlar
 *   4. Bugünün kalan maçları
 *
 * Kademe 1, kademe 2'nin önünde: bugün bir Türk takımı oynuyorsa hero'nun
 * ilk kartı o maçtır, yabancı bir maç canlı olsa bile. Karusel zaten
 * hepsini gösteriyor — değişen yalnızca hangisinin ilk açılacağı.
 *
 * BANT — her kademe içinde durum önceliği:
 *   live        → sağlayıcı canlı diyor
 *   in-progress → başlama saati geçmiş, bitmemiş (durum henüz güncellenmemiş
 *                 olabilir; sağlayıcı gecikmesi bir maçı hero'dan düşürmemeli)
 *   upcoming    → başlayacak, en yakın olan önce
 *   played      → oynanmış, en yenisi önce
 *
 * "in-progress" bandı neden var: sağlayıcı takvimi günde birkaç kez
 * tazeleniyor ve saat 19:08'de 18:30 maçı hâlâ "SCHEDULED" görünebiliyor.
 * Sadece duruma bakan bir sıralama o maçı "başlayacak" saymayıp atlıyor ve
 * hero'da o an oynanan maç yerine daha geç bir karşılaşma kalıyordu. Bant,
 * skor veya dakika UYDURMAZ — yalnızca kart sırasını etkiler.
 */

const { isTurkishMatch, turkishSideOf } = require("./turkishTeams");
const { isMajorClubMatch, majorClubSideOf } = require("./majorClubs");
const { isAwardedStatus, isUnplayedStatus } = require("./matchStatus");

const LIVE_STATUSES = new Set(["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"]);
const FINISHED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN", "AWARDED", "WO"]);

/**
 * Başlama saati geçmiş bir maçın "hâlâ oynanıyor" sayılacağı süre. Uzatma
 * ve devre araları dahil bir maç bu pencereyi aşmaz; sonrasında maç
 * oynanmış kabul edilir.
 */
const IN_PROGRESS_WINDOW_MS = 150 * 60 * 1000;

const BAND_ORDER = ["live", "in-progress", "upcoming", "played"];

/** Karuselde en fazla kaç kart döner. */
const MAX_FEATURED_SLIDES = 6;

/** Kart değişim aralığı (ms). İstemci ve statik yedek aynı değeri kullanır. */
const ROTATION_INTERVAL_MS = 10000;

const REASON_LABELS = {
  "turkish-live": "Canlı Türk takımı maçı",
  "turkish-in-progress": "Oynanmakta olan Türk takımı maçı",
  "turkish-upcoming": "Bugünün en yakın Türk takımı maçı",
  "turkish-played": "Bugün oynanan son Türk takımı maçı",
  "major-live": "Büyük kulübün canlı maçı",
  live: "Canlı maç",
  "in-progress": "Oynanmakta olan maç",
  upcoming: "Bugünün başlayacak maçı",
  played: "Bugün oynanan maç",
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

  if (isFinishedMatch(match) || isAwardedStatus(match)) {
    return "played";
  }

  // Ertelenen/iptal/tatil edilen maç oynanmadı: başlama saati geçtiği için
  // "oynanıyor" bandına düşmemeli. Bu maçlar hero havuzundan tamamen
  // çıkarılır (poolOf), bant yalnızca güvenlik ağı.
  if (isUnplayedStatus(match)) {
    return "unplayed";
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

/**
 * Bir maçın kademesi. Sıra bu değere, sonra banda, sonra başlama saatine
 * göre kurulur.
 */
function tierOf(match, nowMs) {
  const band = bandOf(match, nowMs);
  const turkish = isTurkishMatch(match);

  if (turkish) {
    return band === "live" ? 0 : 1;
  }

  if (band === "live") {
    return isMajorClubMatch(match) ? 2 : 3;
  }

  return 4;
}

/** Kademe + bant birleşiminden okunabilir seçim sebebi. */
function reasonFor(match, nowMs) {
  const band = bandOf(match, nowMs);

  if (isTurkishMatch(match)) {
    return `turkish-${band}`;
  }

  if (band === "live" && isMajorClubMatch(match)) {
    return "major-live";
  }

  return band;
}

/**
 * Karuselde dönecek maçları sırasıyla verir. İlk kayıt hero'nun açılışta
 * gösterdiği karttır.
 *
 * @param {Array} matches Aday maçlar (kürasyonlu + sağlayıcı, birleştirilmiş).
 * @param {{now?: Date, today?: string, limit?: number}} [options]
 * @returns {Array<{match: Object, reason: string, reasonLabel: string,
 *   band: string, tier: number, turkish: boolean, turkishTeam: string,
 *   major: boolean, majorClub: string, candidateCount: number,
 *   turkishCandidateCount: number}>}
 */
function selectFeaturedMatches(matches, options) {
  const settings = options || {};
  const now = settings.now instanceof Date ? settings.now : new Date();
  const nowMs = now.getTime();
  const today = settings.today || istanbulToday(now);
  const limit = Number.isFinite(settings.limit) ? Math.max(1, settings.limit) : MAX_FEATURED_SLIDES;
  const list = (Array.isArray(matches) ? matches : []).filter(Boolean);

  // Havuz: bugünün maçları + tarihi ne olursa olsun canlı maçlar. Gece
  // yarısını aşan bir maç TSİ'de "dün" görünse de canlıysa hero'ya girer.
  // Oynanmayan maçlar (ertelendi/iptal/tatil) hero'ya hiç girmez: kartın
  // işi "şu anda ne var" göstermek, oynanmayacak bir eşleşme değil.
  const pool = list
    .filter((match) => matchDateValue(match) === today || isLiveMatch(match))
    .filter((match) => !isUnplayedStatus(match));
  const turkishCount = pool.filter(isTurkishMatch).length;

  const ordered = pool.slice().sort((left, right) => {
    const tierGap = tierOf(left, nowMs) - tierOf(right, nowMs);
    if (tierGap !== 0) {
      return tierGap;
    }

    const leftBand = bandOf(left, nowMs);
    const bandGap = BAND_ORDER.indexOf(leftBand) - BAND_ORDER.indexOf(bandOf(right, nowMs));
    if (bandGap !== 0) {
      return bandGap;
    }

    return compareWithinBand(leftBand, left, right);
  });

  if (ordered.length) {
    return ordered.slice(0, limit).map((match) => describe(
      match, reasonFor(match, nowMs), bandOf(match, nowMs), tierOf(match, nowMs), pool.length, turkishCount
    ));
  }

  // Bugün maç yoksa karusel boş kalmasın: takvimdeki sıradaki karşılaşmalar.
  // Türk takımı maçları yine öne alınır.
  const upcoming = list
    .filter((match) => matchDateValue(match) > today)
    .sort((left, right) => {
      const turkishGap = Number(isTurkishMatch(right)) - Number(isTurkishMatch(left));
      return turkishGap || kickoffTime(left).value - kickoffTime(right).value;
    });

  return upcoming.slice(0, limit).map((match) => describe(
    match, "next-fixture", "upcoming", tierOf(match, nowMs), pool.length, turkishCount
  ));
}

/**
 * Hero'nun ilk (en büyük) kartı. Karusel sırasının başındaki kayıt.
 *
 * @param {Array} matches
 * @param {{now?: Date, today?: string}} [options]
 */
function selectFeaturedMatch(matches, options) {
  const ordered = selectFeaturedMatches(matches, options);

  if (ordered.length) {
    return ordered[0];
  }

  const settings = options || {};
  const now = settings.now instanceof Date ? settings.now : new Date();
  const today = settings.today || istanbulToday(now);
  const list = (Array.isArray(matches) ? matches : []).filter(Boolean);
  const pool = list.filter((match) => matchDateValue(match) === today || isLiveMatch(match));

  return describe(null, "empty", "", null, pool.length, 0);
}

function describe(match, reason, band, tier, candidateCount, turkishCandidateCount) {
  return {
    match: match || null,
    reason,
    reasonLabel: REASON_LABELS[reason] || reason,
    band,
    tier,
    turkish: Boolean(match) && isTurkishMatch(match),
    turkishTeam: match ? turkishSideOf(match) : "",
    major: Boolean(match) && isMajorClubMatch(match),
    majorClub: match ? majorClubSideOf(match) : "",
    candidateCount,
    turkishCandidateCount
  };
}

/**
 * İç günlük: karuselin hangi kartı neden gösterdiği. Sıra beklenmedik
 * göründüğünde tek bakılacak yer burasıdır. `slot` kaçıncı kart olduğunu
 * verir; ilk kart 1.
 */
function formatFeaturedSelectionLog(scope, selection, slot) {
  const match = selection && selection.match;
  const position = Number.isFinite(slot) ? slot : 1;

  return [
    "[futbolradar:featured-match]",
    `scope=${scope}`,
    `slot=${position}`,
    `reason=${(selection && selection.reason) || "empty"}`,
    `id=${(match && match.id) || "-"}`,
    `match="${match ? `${match.homeTeam || "?"} - ${match.awayTeam || "?"}` : "-"}"`,
    `turkish=${Boolean(selection && selection.turkish)}`,
    `turkishTeam="${(selection && selection.turkishTeam) || "-"}"`,
    `major=${Boolean(selection && selection.major)}`,
    `majorClub="${(selection && selection.majorClub) || "-"}"`,
    `candidates=${(selection && selection.candidateCount) || 0}`,
    `turkishCandidates=${(selection && selection.turkishCandidateCount) || 0}`
  ].join(" ");
}

function logFeaturedSelection(scope, selection, slot) {
  console.log(formatFeaturedSelectionLog(scope, selection, slot));
}

/** Karuselin tamamını sırayla günlüğe yazar. */
function logFeaturedRotation(scope, selections) {
  const list = Array.isArray(selections) ? selections : [];

  if (!list.length) {
    logFeaturedSelection(scope, null, 1);
    return;
  }

  list.forEach((selection, index) => logFeaturedSelection(scope, selection, index + 1));
}

module.exports = {
  BAND_ORDER,
  IN_PROGRESS_WINDOW_MS,
  MAX_FEATURED_SLIDES,
  REASON_LABELS,
  ROTATION_INTERVAL_MS,
  bandOf,
  formatFeaturedSelectionLog,
  istanbulToday,
  logFeaturedRotation,
  logFeaturedSelection,
  selectFeaturedMatch,
  selectFeaturedMatches,
  tierOf
};
