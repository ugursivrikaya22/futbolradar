const fs = require("fs");
const path = require("path");
const { normalizeText } = require("../api/_utils");
const {
  PRIMARY_COMPETITION_IDS,
  SCOREBOARD_COMPETITION_IDS,
  normalizeKey
} = require("./competitionCatalog");
const {
  MATCH_STATUSES,
  dateInTimeZone,
  dedupeMatches,
  normalizeMatchRecord
} = require("./matchDataService");
const {
  apiFootballProvider,
  footballProvider,
  mockProvider
} = require("./providers");

const DEFAULT_TIME_ZONE = "Europe/Istanbul";
const MANUAL_FIXTURE_DATE = "2026-07-25";
const MAX_DAILY_MATCHES = 80;

const TURKISH_TEAMS = new Set([
  "galatasaray",
  "fenerbahce",
  "besiktas",
  "trabzonspor",
  "basaksehir",
  "istanbul-basaksehir",
  "samsunspor",
  "konyaspor",
  "caykur-rizespor",
  "rizespor",
  "goztepe",
  "kasimpasa",
  "alanyaspor",
  "gaziantep-fk",
  "eyupspor",
  "kocaelispor",
  "genclerbirligi",
  "antalyaspor",
  "kayserispor",
  "sivasspor",
  "ankaragucu",
  "adana-demirspor",
  "hatayspor"
]);

const HIGH_INTEREST_TEAMS = new Set([
  "bayern-munich",
  "bayern-munih",
  "borussia-dortmund",
  "dortmund",
  "ac-milan",
  "milan",
  "juventus",
  "liverpool",
  "manchester-united",
  "manchester-city",
  "barcelona",
  "real-madrid",
  "atletico-madrid",
  "psg",
  "paris-saint-germain",
  "arsenal",
  "chelsea",
  "tottenham",
  "newcastle-united",
  "everton",
  "aston-villa",
  "fc-porto",
  "porto",
  "fiorentina",
  "real-sociedad",
  "wolves",
  "wolverhampton",
  "leicester-city",
  "celtic",
  "inter",
  "roma",
  "napoli",
  "marseille",
  "lyon",
  "monaco"
]);

const PRIMARY_LEAGUE_TEAMS = new Set([
  ...HIGH_INTEREST_TEAMS,
  "sunderland",
  "hull-city",
  "west-ham",
  "brighton",
  "crystal-palace",
  "fulham",
  "brentford",
  "bournemouth",
  "nottingham-forest",
  "leeds-united",
  "burnley",
  "sevilla",
  "valencia",
  "villarreal",
  "real-betis",
  "athletic-bilbao",
  "celta-vigo",
  "osasuna",
  "mallorca",
  "malaga",
  "lazio",
  "atalanta",
  "torino",
  "bologna",
  "udinese",
  "genoa",
  "sassuolo",
  "eintracht-frankfurt",
  "bayer-leverkusen",
  "rb-leipzig",
  "stuttgart",
  "wolfsburg",
  "werder-bremen",
  "freiburg",
  "borussia-monchengladbach",
  "lille",
  "rennes",
  "nice",
  "lens",
  "nantes",
  "strasbourg"
]);

function truthy(value) {
  return ["1", "true", "yes", "evet"].includes(String(value || "").toLowerCase());
}

function todayInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function addDays(date, amount) {
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return date;
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dateParam(query) {
  return query && query.date ? String(query.date).slice(0, 10) : todayInIstanbul();
}

function timeZoneParam(query) {
  return query && (query.timezone || query.timeZone) || DEFAULT_TIME_ZONE;
}

function providerConfigured(provider) {
  try {
    if (provider && provider.name === "api-football") return provider.hasConfig();
    if (provider && provider.name === "football-data") return Boolean(provider.getConfig().apiKey);
  } catch (error) {
    return false;
  }
  return false;
}

function normalizeTeamKey(value) {
  const key = normalizeKey(value);
  if (key === "fortuna-dusseldorf" || key === "fortuna-duesseldorf") return "fortuna-dusseldorf";
  if (key === "bayern-munchen" || key === "bayern-muenchen") return "bayern-munich";
  if (key === "wolverhampton-wanderers") return "wolverhampton";
  if (key === "standard-liege" || key === "standard-liege") return "standard-liege";
  if (key === "malaga-cf") return "malaga";
  return key;
}

function teamInSet(value, set) {
  const key = normalizeTeamKey(value);
  return set.has(key);
}

function teams(match) {
  return [match.homeTeam, match.awayTeam].filter(Boolean);
}

function hasTurkishTeam(match) {
  return teams(match).some((team) => teamInSet(team, TURKISH_TEAMS));
}

function hasHighInterestTeam(match) {
  return teams(match).some((team) => teamInSet(team, HIGH_INTEREST_TEAMS));
}

function hasPrimaryLeagueTeam(match) {
  return teams(match).some((team) => teamInSet(team, PRIMARY_LEAGUE_TEAMS));
}

function isOfficialPrimary(match) {
  return PRIMARY_COMPETITION_IDS.includes(match.competitionId) && !match.isFriendly;
}

function isScoreboardOfficial(match) {
  return SCOREBOARD_COMPETITION_IDS.includes(match.competitionId) && !match.isFriendly;
}

function isRelevantFriendly(match) {
  if (!match.isFriendly) return false;
  return hasTurkishTeam(match) || hasHighInterestTeam(match) || hasPrimaryLeagueTeam(match);
}

function priorityForMatch(match) {
  if (hasTurkishTeam(match)) return 10;
  if (hasHighInterestTeam(match)) return 30;
  if (hasPrimaryLeagueTeam(match)) return 40;
  if (PRIMARY_COMPETITION_IDS.includes(match.competitionId)) return 45;
  if (isScoreboardOfficial(match)) return 50;
  return 70;
}

function groupForMatch(match) {
  if (hasTurkishTeam(match)) return "Türk Takımlarının Maçları";
  if (hasHighInterestTeam(match) || hasPrimaryLeagueTeam(match) || isScoreboardOfficial(match)) {
    return "Avrupa’nın Öne Çıkan Maçları";
  }
  return "Diğer Maçlar";
}

function kickoffSortValue(match) {
  const parsed = Date.parse(match.utcKickoff || match.kickoffAtUtc || "");
  if (Number.isFinite(parsed)) return parsed;
  return Number.MAX_SAFE_INTEGER;
}

function enrichDailyMatch(record, query) {
  const match = normalizeMatchRecord(record, { timeZone: timeZoneParam(query) });
  const priority = Number.isFinite(Number(match.priority)) ? Number(match.priority) : priorityForMatch(match);
  return {
    ...match,
    priority,
    dailyGroup: match.dailyGroup || groupForMatch(match),
    displayGroup: match.displayGroup || groupForMatch(match),
    competition: match.competition && typeof match.competition === "object"
      ? match.competition.name
      : match.competition,
    competitionMeta: match.competition && typeof match.competition === "object" ? match.competition : null,
    lastUpdatedAt: match.lastUpdatedAt || match.fetchedAt || match.lastVerifiedAt || null
  };
}

function sameFixture(leftRecord, rightRecord) {
  const left = normalizeMatchRecord(leftRecord);
  const right = normalizeMatchRecord(rightRecord);
  if (left.providerFixtureId && right.providerFixtureId && left.providerFixtureId === right.providerFixtureId) {
    return true;
  }
  if (normalizeTeamKey(left.homeTeam) !== normalizeTeamKey(right.homeTeam)) return false;
  if (normalizeTeamKey(left.awayTeam) !== normalizeTeamKey(right.awayTeam)) return false;
  const leftTime = Date.parse(left.utcKickoff || left.kickoffAtUtc || "");
  const rightTime = Date.parse(right.utcKickoff || right.kickoffAtUtc || "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return Math.abs(leftTime - rightTime) <= 10 * 60 * 1000;
  }
  return left.localDate && right.localDate && left.localDate === right.localDate;
}

function localDateFilter(match, query) {
  const requestedDate = dateParam(query);
  const timeZone = timeZoneParam(query);
  const localDate = match.localDate || dateInTimeZone(match.utcKickoff || match.kickoffAtUtc, timeZone);
  return localDate === requestedDate;
}

function relevantFilter(match, query) {
  const includeFriendlies = truthy(query && query.includeFriendlies);
  if (isOfficialPrimary(match) || isScoreboardOfficial(match)) return true;
  if (includeFriendlies && isRelevantFriendly(match)) return true;
  return false;
}

function finalizeMatches(records, query) {
  return dedupeMatches(records)
    .map((record) => enrichDailyMatch(record, query))
    .filter((match) => localDateFilter(match, query))
    .filter((match) => relevantFilter(match, query))
    .sort((left, right) => (
      kickoffSortValue(left) - kickoffSortValue(right) ||
      Number(left.priority || 99) - Number(right.priority || 99) ||
      String(left.homeTeam).localeCompare(String(right.homeTeam), "tr")
    ))
    .slice(0, MAX_DAILY_MATCHES);
}

function readManualFixtures(date) {
  if (date !== MANUAL_FIXTURE_DATE) return [];
  const file = path.join(__dirname, "..", "data", "manual-fixtures", `${date}.json`);
  try {
    const records = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(records) ? records : [];
  } catch (error) {
    return [];
  }
}

function missingManualFixtures(providerRecords, manualRecords) {
  if (!manualRecords.length) return [];
  if (!providerRecords.length) return manualRecords;
  return manualRecords.filter((manual) => !providerRecords.some((provider) => sameFixture(provider, manual)));
}

async function fetchApiFootballMatches(query) {
  if (!providerConfigured(apiFootballProvider)) return { records: [], error: null };
  try {
    return {
      records: await apiFootballProvider.getMatches({
        ...query,
        date: dateParam(query),
        timezone: timeZoneParam(query)
      }),
      error: null
    };
  } catch (error) {
    return { records: [], error };
  }
}

async function fetchFootballDataMatches(query) {
  if (!providerConfigured(footballProvider)) return { records: [], error: null };
  const date = dateParam(query);
  const dates = [addDays(date, -1), date, addDays(date, 1)];
  try {
    const batches = await Promise.all(dates.map((day) =>
      footballProvider.getMatches({ ...query, date: day }).catch(() => [])
    ));
    return { records: batches.flat(), error: null };
  } catch (error) {
    return { records: [], error };
  }
}

async function fetchStaticMatches(query) {
  try {
    return await mockProvider.getMatches({ ...query, date: dateParam(query) });
  } catch (error) {
    return [];
  }
}

async function getDailyMatches(query) {
  const normalizedQuery = {
    ...(query || {}),
    date: dateParam(query),
    timezone: timeZoneParam(query)
  };
  const [apiFootballResult, footballDataResult, staticRecords] = await Promise.all([
    fetchApiFootballMatches(normalizedQuery),
    fetchFootballDataMatches(normalizedQuery),
    fetchStaticMatches(normalizedQuery)
  ]);
  const providerRecords = finalizeMatches([
    ...apiFootballResult.records,
    ...footballDataResult.records
  ], normalizedQuery);
  const staticMatches = finalizeMatches(staticRecords, normalizedQuery);
  const manualRecords = readManualFixtures(normalizedQuery.date);
  const manualMissing = missingManualFixtures(providerRecords, manualRecords);
  const manualMatches = finalizeMatches(manualMissing, normalizedQuery);
  const data = finalizeMatches([
    ...providerRecords,
    ...staticMatches,
    ...manualMatches
  ], normalizedQuery);
  const errors = [apiFootballResult.error, footballDataResult.error].filter(Boolean);
  const hasLive = data.some((match) => match.status === MATCH_STATUSES.LIVE || match.live);
  const providerSource = providerRecords.some((match) => normalizeText(match.source).includes("api-football"))
    ? "api-football"
    : providerRecords.some((match) => normalizeText(match.source).includes("football-data"))
      ? "football-data"
      : "";
  const fallbackSource = data.some((match) => match.isFallback) ? "manual-verified" : "";
  return {
    data,
    source: [providerSource, fallbackSource].filter(Boolean).join(" + ") || (fallbackSource || mockProvider.source),
    providerRecords,
    manualMatches,
    errors,
    hasLive
  };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  MANUAL_FIXTURE_DATE,
  getDailyMatches,
  groupForMatch,
  hasTurkishTeam,
  isRelevantFriendly,
  priorityForMatch,
  sameFixture,
  truthy
};
