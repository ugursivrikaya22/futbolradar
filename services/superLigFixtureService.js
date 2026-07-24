/**
 * @typedef {Object} FixtureTeam
 * @property {string} name
 * @property {string} [city]
 * @property {string} [region]
 * @property {string} [status]
 * @property {string|null} [venue]
 * @property {string|null} [logo]
 *
 * @typedef {Object} FixtureMatch
 * @property {string} id
 * @property {number} round
 * @property {string} homeTeam
 * @property {string} awayTeam
 * @property {string|null} kickoff        ISO 8601 in Europe/Istanbul, or null when TFF hasn't assigned a time yet
 * @property {string|null} dateLabel      Human-readable fallback when no ISO kickoff exists yet
 * @property {"SCHEDULED"|"LIVE"|"POSTPONED"|"FINISHED"|"CANCELLED"} status
 * @property {{home: number|null, away: number|null}|null} score
 * @property {string} fixtureStatus       "confirmed-pairing" | "pending-verification" | ...
 * @property {string|null} venue          Home team's stadium, only when independently verified
 *
 * @typedef {Object} FixtureWeek
 * @property {number} round
 * @property {string} label
 * @property {string} dateRange
 * @property {string} status
 * @property {FixtureMatch[]} matches
 * @property {boolean} hasConfirmedDates   True once every match in the week carries a real ISO kickoff
 */

const TIMEZONE = "Europe/Istanbul";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim()
    .toLowerCase();
}

/**
 * @param {*} fixturesData Raw parsed data/super-lig-fixtures.json
 * @returns {FixtureWeek[]}
 */
function getFixtureWeeks(fixturesData) {
  const rounds = Array.isArray(fixturesData && fixturesData.rounds) ? fixturesData.rounds : [];

  return rounds.map((round) => {
    const matches = Array.isArray(round.matches) ? round.matches : [];
    const normalizedMatches = matches.map((match) => {
      const normalized = normalizeFixtureMatch(match, round);
      if (!normalized.venue) {
        // A match's venue is its home team's stadium — joined from the
        // fixtures-page team pool rather than duplicated onto every match.
        const homeTeam = findFixtureTeam(fixturesData, normalized.homeTeam);
        normalized.venue = (homeTeam && homeTeam.venue) || null;
      }
      return normalized;
    });

    return {
      round: round.round,
      label: round.label || `${round.round}. Hafta`,
      dateRange: round.dateRange || "Tarih ve saat atamaları bekleniyor",
      status: round.status || "confirmed-pairings",
      matches: normalizedMatches,
      hasConfirmedDates: normalizedMatches.length > 0 && normalizedMatches.every((match) => Boolean(match.kickoff))
    };
  });
}

/**
 * @param {*} match Raw match record from a fixtures round
 * @param {*} round The round it belongs to (for shared dateRange/season fallback)
 * @returns {FixtureMatch}
 */
function normalizeFixtureMatch(match, round) {
  const status = normalizeMatchStatus(match.status);
  return {
    id: match.id || `${normalizeText(match.homeTeam)}-${normalizeText(match.awayTeam)}-r${round && round.round}`,
    round: (round && round.round) ?? match.round ?? null,
    homeTeam: match.homeTeam || "",
    awayTeam: match.awayTeam || "",
    kickoff: match.kickoff || null,
    dateLabel: match.dateLabel || (round && round.dateRange) || null,
    status,
    score: match.score
      ? { home: numberOrNull(match.score.home), away: numberOrNull(match.score.away) }
      : null,
    fixtureStatus: match.fixtureStatus || "pending-verification",
    venue: match.venue || null
  };
}

function numberOrNull(value) {
  return value === null || value === undefined || value === "" || Number.isNaN(Number(value)) ? null : Number(value);
}

const STATUS_ALIASES = {
  SCHEDULED: "SCHEDULED",
  NS: "SCHEDULED",
  TIMED: "SCHEDULED",
  LIVE: "LIVE",
  IN_PLAY: "LIVE",
  "1H": "LIVE",
  "2H": "LIVE",
  HT: "LIVE",
  ET: "LIVE",
  FINISHED: "FINISHED",
  FT: "FINISHED",
  AET: "FINISHED",
  PEN: "FINISHED",
  POSTPONED: "POSTPONED",
  PST: "POSTPONED",
  CANCELLED: "CANCELLED",
  CANC: "CANCELLED"
};

/**
 * @param {string|undefined} rawStatus
 * @returns {"SCHEDULED"|"LIVE"|"POSTPONED"|"FINISHED"|"CANCELLED"}
 */
function normalizeMatchStatus(rawStatus) {
  const key = String(rawStatus || "SCHEDULED").toUpperCase();
  return STATUS_ALIASES[key] || "SCHEDULED";
}

/**
 * Attaches each team's known venue/logo onto its fixtures-page team-pool
 * record (data/super-lig-fixtures.json's `teams` array is the only place
 * this project keeps a curated venue per Süper Lig club).
 * @param {*} fixturesData
 * @param {string} teamName
 * @returns {FixtureTeam|null}
 */
function findFixtureTeam(fixturesData, teamName) {
  const teams = Array.isArray(fixturesData && fixturesData.teams) ? fixturesData.teams : [];
  const wanted = normalizeText(teamName);
  return teams.find((team) => normalizeText(team.name) === wanted) || null;
}

/**
 * A week "counts" as the reference week once its range's end date is on or
 * after `referenceDate` (Europe/Istanbul, YYYY-MM-DD). Weeks whose date range
 * hasn't been assigned by TFF yet can't be resolved by date, so date-based
 * matching only ever looks at weeks with a parseable range.
 * @param {FixtureWeek[]} weeks
 * @param {string} referenceDateIso  YYYY-MM-DD, Europe/Istanbul "today"
 * @returns {number} round number to default to
 */
function resolveDefaultRound(weeks, referenceDateIso) {
  if (!weeks.length) return 1;

  const parsed = weeks
    .map((week) => ({ round: week.round, range: parseDateRange(week.dateRange) }))
    .filter((entry) => entry.range);

  if (!parsed.length) {
    return weeks[0].round;
  }

  const upcoming = parsed.find((entry) => entry.range.end >= referenceDateIso);
  if (upcoming) {
    return upcoming.round;
  }

  // Every dated week has already finished. Move on to whatever round comes
  // right after the last dated one — even if TFF hasn't assigned it a date
  // yet — rather than sticking on a week that's already over.
  const lastDatedRound = parsed[parsed.length - 1].round;
  const next = weeks.find((week) => week.round > lastDatedRound);
  return next ? next.round : lastDatedRound;
}

const TURKISH_MONTHS = {
  ocak: "01", şubat: "02", subat: "02", mart: "03", nisan: "04", mayıs: "05", mayis: "05",
  haziran: "06", temmuz: "07", ağustos: "08", agustos: "08", eylül: "09", eylul: "09",
  ekim: "10", kasım: "11", kasim: "11", aralık: "12", aralik: "12"
};

/**
 * Parses labels like "14-17 Ağustos 2026" into an ISO start/end range.
 * Returns null for anything not in that shape (e.g. "Tarih ve saat
 * atamaları bekleniyor") rather than guessing.
 * @param {string} label
 * @returns {{start: string, end: string}|null}
 */
function parseDateRange(label) {
  const match = String(label || "").match(/(\d{1,2})(?:-(\d{1,2}))?\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})/);
  if (!match) return null;

  const [, startDay, endDay, monthName, year] = match;
  const month = TURKISH_MONTHS[normalizeText(monthName)];
  if (!month) return null;

  const pad = (value) => String(value).padStart(2, "0");
  const start = `${year}-${month}-${pad(startDay)}`;
  const end = `${year}-${month}-${pad(endDay || startDay)}`;
  return { start, end };
}

/**
 * @param {string} timeZone
 * @returns {string} YYYY-MM-DD
 */
function todayInTimeZone(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

/**
 * @param {FixtureWeek[]} weeks
 * @param {string} teamName  "" or falsy means no filter (all teams)
 * @returns {FixtureWeek[]} same weeks, each with `matches` filtered
 */
function filterWeeksByTeam(weeks, teamName) {
  const wanted = normalizeText(teamName);
  if (!wanted) return weeks;

  return weeks.map((week) => ({
    ...week,
    matches: week.matches.filter((match) => normalizeText(match.homeTeam) === wanted || normalizeText(match.awayTeam) === wanted)
  }));
}

module.exports = {
  getFixtureWeeks,
  normalizeFixtureMatch,
  normalizeMatchStatus,
  findFixtureTeam,
  resolveDefaultRound,
  parseDateRange,
  todayInTimeZone,
  filterWeeksByTeam,
  TIMEZONE
};
