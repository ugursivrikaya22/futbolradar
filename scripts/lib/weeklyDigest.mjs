/**
 * "BU HAFTA SÜPER LİG" DERLEMESİ — saf yardımcılar (test edilebilir).
 *
 * Kural: hiçbir sonuç uydurulmaz. Bir maç yalnızca
 *   • Süper Lig maçıysa, FINISHED durumundaysa ve skoru sayıysa,
 *   • en az bir kaynağı ALLOWED_SOURCE_HOSTS beyaz listesindeyse
 * derlemeye girer. Haftanın verisi yoksa sayfa uydurma içerik göstermez;
 * yalnızca gerçek verisi olan SON hafta, tarihiyle birlikte gösterilir.
 * Kaynaklı sonuç sayısı eşiğin altındaysa sayfa noindex olur ve site
 * haritasına girmez.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../../services/sourceLinks.js");

export const MIN_INDEXABLE_RESULTS = 3;
/** Derleme bu kadar günden eskiyse "bu hafta" iddiası taşıyamaz: noindex + haritadan çıkar. */
export const MAX_DIGEST_AGE_DAYS = 28;
const DAY = 24 * 60 * 60 * 1000;

/** ISO 8601 hafta: { year, week, monday, sunday } (tarihler YYYY-MM-DD). */
export function isoWeekOf(dateString) {
  const [y, m, d] = String(dateString).slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = (date.getUTCDay() + 6) % 7; // Pazartesi = 0
  const monday = new Date(date.getTime() - weekday * DAY);
  const thursday = new Date(monday.getTime() + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY);
  const week = Math.round((monday - week1Monday) / (7 * DAY)) + 1;
  const iso = (value) => value.toISOString().slice(0, 10);
  return { year, week, key: `${year}-W${String(week).padStart(2, "0")}`, monday: iso(monday), sunday: iso(new Date(monday.getTime() + 6 * DAY)) };
}

function isSuperLig(record) {
  return /s[üu]per lig/i.test(String(record.league || record.competition || ""));
}

/** Kaynaklı, bitmiş Süper Lig sonuçları (en yeni önde). */
export function sourcedSuperLigResults(records = []) {
  const seen = new Set();
  return records
    .filter((record) => isSuperLig(record) && record.status === "FINISHED")
    .filter((record) => Number.isFinite(record.score?.home) && Number.isFinite(record.score?.away))
    .map((record) => ({ ...record, sources: (record.sourceUrls || []).filter((url) => isAllowedSourceUrl(url)) }))
    .filter((record) => record.sources.length > 0)
    .filter((record) => {
      const key = record.matchId || record.slug || `${record.date}-${record.homeTeam}-${record.awayTeam}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(b.kickoff || b.date).localeCompare(String(a.kickoff || a.date)));
}

/**
 * Gösterilecek hafta: verisi olan en son ISO hafta.
 * `today` verilirse sonucun "bu hafta" olup olmadığı da söylenir.
 */
export function buildWeeklyDigest(records, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const results = sourcedSuperLigResults(records);
  const current = isoWeekOf(today);
  if (!results.length) {
    return { week: null, currentWeek: current, isCurrentWeek: false, results: [], indexable: false, totals: null };
  }
  const week = isoWeekOf(results[0].date || results[0].kickoff);
  const weekResults = results
    .filter((record) => isoWeekOf(record.date || record.kickoff).key === week.key)
    .sort((a, b) => String(a.kickoff || a.date).localeCompare(String(b.kickoff || b.date)));
  const goals = weekResults.reduce((sum, record) => sum + record.score.home + record.score.away, 0);
  const homeWins = weekResults.filter((record) => record.score.home > record.score.away).length;
  const awayWins = weekResults.filter((record) => record.score.home < record.score.away).length;
  const biggest = [...weekResults].sort((a, b) => Math.abs(b.score.home - b.score.away) - Math.abs(a.score.home - a.score.away) || (b.score.home + b.score.away) - (a.score.home + a.score.away))[0];
  return {
    week,
    currentWeek: current,
    isCurrentWeek: week.key === current.key,
    results: weekResults,
    ageDays: Math.round((Date.parse(`${current.monday}T00:00:00Z`) - Date.parse(`${week.monday}T00:00:00Z`)) / DAY),
    indexable: weekResults.length >= MIN_INDEXABLE_RESULTS
      && (Date.parse(`${current.monday}T00:00:00Z`) - Date.parse(`${week.monday}T00:00:00Z`)) / DAY <= MAX_DIGEST_AGE_DAYS,
    totals: { matches: weekResults.length, goals, homeWins, awayWins, draws: weekResults.length - homeWins - awayWins, biggest },
    latestResultDate: weekResults.at(-1)?.date || null
  };
}

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export function formatTrDate(dateString) {
  const [y, m, d] = String(dateString).slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
