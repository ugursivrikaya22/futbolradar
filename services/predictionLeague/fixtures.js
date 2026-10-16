/**
 * TAHMİN LİGİ — MAÇ LİSTESİ (mevcut fikstür takviminden).
 *
 * YENİ VERİ KAYNAĞI YOK: Süper Lig maçları, durumları ve sonuçları zaten
 * `data/fixture-calendar.json` içinde (saatlik senkronizasyon). Bu modül o
 * kayıtları tahmin ligi satırlarına çevirir; hiçbir sonuç türetmez.
 *
 * SONUÇ YALNIZCA DOĞRULANMIŞSA: bir maç `FINISHED` sayılması için sağlayıcı
 * bitiş kodu (FT/AET/PEN) VE okunabilir skor gerekir. Hükmen (AWD/WO),
 * terk edilen, yarıda kalan ve saati belirsiz (TBD) maç puanlanmaz.
 */
const matchStatus = require("../matchStatus");
const scoring = require("./scoring");

const LOOKBACK_MS = 10 * 24 * 3600 * 1000;
const LOOKAHEAD_MS = 21 * 24 * 3600 * 1000;

function readable(score) {
  return Boolean(score) && Number.isInteger(score.home) && Number.isInteger(score.away);
}

/** Tahmin ligi durumu: tablodaki check kısıtıyla aynı küme. */
function leagueStatus(match) {
  const state = matchStatus.matchState(match);
  if (matchStatus.isTimeUnconfirmed(match)) return "POSTPONED"; // saat yer tutucu: kilitli
  if (state === "FINISHED") {
    const provider = String(match.providerStatus || "").toUpperCase();
    return readable(match.score) && scoring.FINAL_PROVIDER_STATUSES.has(provider || "FINISHED") ? "FINISHED" : "LIVE";
  }
  if (state === "SCHEDULED" || state === "UNKNOWN") return "SCHEDULED";
  if (state === "LIVE" || state === "HALFTIME") return "LIVE";
  if (state === "INTERRUPTED") return "INTERRUPTED";
  if (state === "POSTPONED") return "POSTPONED";
  if (state === "CANCELLED") return "CANCELLED";
  return "ABANDONED"; // ABANDONED, AWARDED
}

function buildLeagueFixtures(calendarMatches, nowMs = Date.now()) {
  const rows = [];
  for (const match of Array.isArray(calendarMatches) ? calendarMatches : []) {
    if (!match || match.competitionId !== "super-lig") continue;
    const id = String((match.providerIds && match.providerIds.apiFootball) || match.providerId || "");
    if (!/^\d+$/.test(id)) continue;
    const kickoffMs = Date.parse(match.kickoff);
    if (!Number.isFinite(kickoffMs)) continue;
    if (kickoffMs < nowMs - LOOKBACK_MS || kickoffMs > nowMs + LOOKAHEAD_MS) continue;
    if (!match.homeTeam || !match.awayTeam) continue;

    const status = leagueStatus(match);
    rows.push({
      fixtureId: id,
      season: scoring.seasonOf(kickoffMs),
      round: Number.isInteger(match.round) ? match.round : null,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoff: new Date(kickoffMs).toISOString(),
      status,
      homeGoals: status === "FINISHED" ? match.score.home : null,
      awayGoals: status === "FINISHED" ? match.score.away : null
    });
  }
  return rows.sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.fixtureId.localeCompare(b.fixtureId));
}

/** Veritabanı satırı (snake_case). */
function toDbRow(fixture) {
  return {
    fixture_id: fixture.fixtureId, season: fixture.season, round: fixture.round,
    home_team: fixture.homeTeam, away_team: fixture.awayTeam, kickoff: fixture.kickoff,
    status: fixture.status, home_goals: fixture.homeGoals, away_goals: fixture.awayGoals
  };
}

/** Bu satır için istenen puanlama kipi: 'score' | 'void' | 'reset'. */
function settleModeOf(fixture) {
  if (fixture.status === "FINISHED") return "score";
  if (fixture.status === "POSTPONED" || fixture.status === "CANCELLED") return "void";
  return "reset";
}

module.exports = { LOOKAHEAD_MS, LOOKBACK_MS, buildLeagueFixtures, leagueStatus, settleModeOf, toDbRow };
