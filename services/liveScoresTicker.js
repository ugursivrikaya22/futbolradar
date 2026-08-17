/**
 * CANLI SKORLAR BANDI — HANGİ MAÇ, HANGİ SIRADA, HANGİ ETİKETLE.
 *
 * Transfer Radarı bandının yerini alır (bkz. services/transferRadarTicker.js,
 * artık kullanılmıyor). Kural TEK ve MUTLAK: yalnızca ŞU AN OYNANAN maçlar
 * banda girer. Başlamamış, bitmiş, ertelenen ya da iptal edilen hiçbir
 * kayıt buraya düşmez — "canlı" iddiası bir zaman iddiasıdır ve veri
 * katmanında, çizim katmanında değil, burada kesilir.
 *
 * Süzgeç services/liveScoreFilter.js'in LIVE_STATUSES kümesini FINISHED
 * kümesi hariç kullanır: devre arası (HT) "canlı" sayılır (maç sürüyor,
 * yalnızca duraklamış), ama bitmiş/ertelenmiş asla sayılmaz.
 *
 * Lig adı fixture.league.id üzerinden doğrulanmış katalog adına çözülür
 * (services/competitionCatalog.js, Faz B'nin kök hata düzeltmesiyle aynı
 * kural) — ham sağlayıcı metni değil.
 */

const { LIVE_STATUSES, isScoreNumber } = (() => {
  const filter = require("./liveScoreFilter");
  return {
    LIVE_STATUSES: filter.LIVE_STATUSES,
    isScoreNumber: (value) => {
      if (typeof value === "number") return isFinite(value);
      if (typeof value === "string" && value.trim() !== "") return isFinite(Number(value));
      return false;
    }
  };
})();
const { resolveCompetitionId, findCompetition } = require("./competitionCatalog");
const { matchDetailPath } = require("./matchProgram");

/** Bantta en fazla kaç maç? Kayan bir şerit liste değildir. */
const MAX_ITEMS = 16;

/** Bitmiş sayılan durumlar asla "canlı" değildir — LIVE_STATUSES'tan ayrıca çıkarılır. */
const FINISHED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN", "AWARDED", "AWD", "WO"]);
const OFF_STATUSES = new Set(["POSTPONED", "PST", "CANCELLED", "CANC", "ABANDONED", "ABD", "SUSPENDED", "SUSP", "INTERRUPTED", "INT"]);

/** Kısa durum etiketi (dakika yoksa). */
const SHORT_STATUS_LABELS = Object.freeze({
  HT: "HT",
  HALFTIME: "HT",
  ET: "ET",
  BT: "BT",
  P: "Pen",
  PAUSED: "Devre arası",
  LIVE: "Canlı",
  IN_PLAY: "Canlı",
  "1H": "Canlı",
  "2H": "Canlı"
});

function statusOf(match) {
  return String((match && (match.status || match.providerStatus)) || "").toUpperCase();
}

/** Maç şu an oynanıyor mu? Skoru olsun ya da olmasın — dakika göstermek skor iddiası değildir. */
function isCurrentlyLive(match) {
  if (!match || typeof match !== "object") return false;
  const status = statusOf(match);
  if (FINISHED_STATUSES.has(status) || OFF_STATUSES.has(status)) return false;
  if (match.live === true) return true;
  return LIVE_STATUSES.includes(status);
}

/** "67'", "HT", "ET" — dakika varsa dakika, yoksa kısa durum etiketi. */
function minuteOrStatusLabel(match) {
  const minute = match && (match.minute ?? match.elapsed);
  if (minute !== undefined && minute !== null && isFinite(Number(minute)) && String(minute).trim() !== "") {
    return `${minute}'`;
  }
  if (match && typeof match.time === "string" && /^\d+(\+\d+)?'$/.test(match.time.trim())) {
    return match.time.trim();
  }
  return SHORT_STATUS_LABELS[statusOf(match)] || "Canlı";
}

/** Skor metni. Skor sayısal değilse "–" — uydurma yok. */
function scoreValue(value) {
  return isScoreNumber(value) ? Number(value) : null;
}

function leagueLabelOf(match) {
  const resolvedId = resolveCompetitionId(match);
  const competition = resolvedId ? findCompetition(resolvedId) : null;
  return (competition && competition.name) || String((match && match.league) || "").trim() || "Futbol";
}

/** Ham maç listesini banda çevirir. `now` yalnızca sıralama için, filtre zaten durumdan gelir. */
function selectLiveTickerRecords(matches, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : MAX_ITEMS;

  return (Array.isArray(matches) ? matches : [])
    .filter(isCurrentlyLive)
    .map((match) => {
      const homeTeam = String((match && match.homeTeam) || "").trim();
      const awayTeam = String((match && match.awayTeam) || "").trim();
      // Taraf adı eksikse kayıt banda girmez: boşluğu doldurmak bilgi üretmektir.
      if (!homeTeam || !awayTeam) return null;

      const score = match.score || {};
      return {
        id: String((match && match.id) || `${homeTeam}-${awayTeam}`),
        league: leagueLabelOf(match),
        homeTeam,
        awayTeam,
        homeScore: scoreValue(score.home),
        awayScore: scoreValue(score.away),
        minuteOrStatus: minuteOrStatusLabel(match),
        isHalftime: ["HT", "HALFTIME"].includes(statusOf(match)),
        href: matchDetailPath(match)
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

module.exports = {
  MAX_ITEMS,
  isCurrentlyLive,
  leagueLabelOf,
  minuteOrStatusLabel,
  selectLiveTickerRecords
};
