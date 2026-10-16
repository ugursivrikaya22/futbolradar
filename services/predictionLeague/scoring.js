/**
 * TAHMİN LİGİ — SAF KURALLAR (puanlama, kilit, dönem anahtarları).
 *
 * Bu dosya VERİTABANI YAZMAZ. Aynı kuralların kanonik uygulaması
 * `supabase/migrations/0010_prediction_league.sql` içinde
 * (`league_settle_fixture`, `league_predictions_guard`); burası hem arayüz
 * hem bellek-içi depo hem de testler için aynı kuralın JS karşılığı.
 * `scripts/test-prediction-league-db.mjs` iki uygulamanın aynı sonucu
 * verdiğini gerçek PostgreSQL'de sınar.
 *
 * PUANLAMA
 *   doğru skor ............ 5   (örn. 2-1 bilindi)
 *   doğru maç sonucu ...... 2   (1/X/2; skor yanlış)
 *   yanlış ................ 0
 * Puanlar TOPLANMAZ: doğru skor zaten doğru sonucu içerir, 5 + 2 = 7 değildir.
 * Ertelenen/iptal edilen maçta puan verilmez (outcome = 'void').
 */

const POINTS = Object.freeze({ EXACT: 5, OUTCOME: 2, MISS: 0 });
const MAX_GOALS = 20;
const ISTANBUL = "Europe/Istanbul";

const FINAL_PROVIDER_STATUSES = new Set(["FT", "AET", "PEN", "FINISHED"]);

function isGoal(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_GOALS;
}

/** Kullanıcı girdisini (string/number) tam sayı skora çevirir; geçersizse null. */
function parseGoal(value) {
  if (typeof value === "number") return isGoal(value) ? value : null;
  if (typeof value === "string" && /^\d{1,2}$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return isGoal(parsed) ? parsed : null;
  }
  return null;
}

/** 'home' | 'draw' | 'away' */
function outcomeOf(home, away) {
  if (home === away) return "draw";
  return home > away ? "home" : "away";
}

/**
 * Bir tahmini sonuca göre puanlar.
 *
 * @param {{home:number, away:number}} prediction
 * @param {{status:string, home:number|null, away:number|null}} fixture
 * @returns {{outcome:'exact'|'outcome'|'miss'|'void'|null, points:number|null}}
 *   `null` sonuç: maç henüz puanlanamaz (oynanmadı / sonuç doğrulanmadı).
 */
function scorePrediction(prediction, fixture) {
  if (!prediction || !isGoal(prediction.home) || !isGoal(prediction.away)) {
    return { outcome: null, points: null };
  }
  const status = String((fixture && fixture.status) || "").toUpperCase();
  if (status === "POSTPONED" || status === "CANCELLED") return { outcome: "void", points: null };
  if (status !== "FINISHED" || !Number.isInteger(fixture.home) || !Number.isInteger(fixture.away)) {
    return { outcome: null, points: null };
  }
  if (prediction.home === fixture.home && prediction.away === fixture.away) {
    return { outcome: "exact", points: POINTS.EXACT };
  }
  if (outcomeOf(prediction.home, prediction.away) === outcomeOf(fixture.home, fixture.away)) {
    return { outcome: "outcome", points: POINTS.OUTCOME };
  }
  return { outcome: "miss", points: POINTS.MISS };
}

/**
 * Tahmin kilitli mi? Veritabanındaki `league_predictions_guard` ile aynı kural:
 * maç SCHEDULED değilse ya da başlama saati geldiyse kilitli.
 */
function isLocked(fixture, nowMs = Date.now()) {
  if (!fixture) return true;
  const kickoff = Date.parse(fixture.kickoff);
  if (!Number.isFinite(kickoff)) return true;
  if (String(fixture.status || "SCHEDULED").toUpperCase() !== "SCHEDULED") return true;
  return nowMs >= kickoff;
}

const PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: ISTANBUL, year: "numeric", month: "2-digit", day: "2-digit" });

function istanbulYMD(ms) {
  const [year, month, day] = PARTS.format(new Date(ms)).split("-").map(Number);
  return { year, month, day };
}

/** ISO hafta yılı ve numarası (Pazartesi başlar), Europe/Istanbul gününe göre. */
function isoWeek(ms) {
  const { year, month, day } = istanbulYMD(ms);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const yearStart = Date.UTC(weekYear, 0, 1);
  return { year: weekYear, week: Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7) };
}

/** Futbol sezonu: Temmuz ve sonrası yeni sezon ('2026-27'). */
function seasonOf(ms) {
  const { year, month } = istanbulYMD(ms);
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** SQL `league_period_key` karşılığı. */
function periodKeys(ms) {
  const { year, month } = istanbulYMD(ms);
  const { year: weekYear, week } = isoWeek(ms);
  return {
    week: `${weekYear}-W${String(week).padStart(2, "0")}`,
    month: `${year}-${String(month).padStart(2, "0")}`,
    season: seasonOf(ms)
  };
}

module.exports = {
  FINAL_PROVIDER_STATUSES,
  MAX_GOALS,
  POINTS,
  isGoal,
  isLocked,
  isoWeek,
  outcomeOf,
  parseGoal,
  periodKeys,
  scorePrediction,
  seasonOf
};
