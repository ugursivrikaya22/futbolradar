const {
  API_KEY_ENV_NAMES,
  BASE_URL_ENV_NAMES,
  COMPETITION_CODE_ENV_NAMES,
  DEFAULT_TIMEOUT_MS,
  firstPresentEnv,
  withTimeout
} = require("../../api/_utils");
const { competitions, findCompetition, matchesCompetition } = require("../competitionCatalog");
const { TIMEZONE: CALENDAR_TIMEZONE, todayInIstanbul } = require("../matchCalendar");

const source = "FutbolRadar Football-Data Live API";

class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

function getConfig() {
  return {
    provider: process.env.FOOTBALL_API_PROVIDER || "football-data",
    baseUrl: firstPresentEnv(BASE_URL_ENV_NAMES) || "https://api.football-data.org/v4",
    apiKey: firstPresentEnv(API_KEY_ENV_NAMES),
    competitionCode: firstPresentEnv(COMPETITION_CODE_ENV_NAMES) || "TSL"
  };
}

function assertConfig() {
  const config = getConfig();

  if (!config.apiKey) {
    throw new ProviderError("PROVIDER_CONFIG_MISSING", "Live provider icin FOOTBALL_API_KEY gerekli.");
  }

  if (!config.baseUrl) {
    throw new ProviderError("PROVIDER_CONFIG_MISSING", "Live provider icin FOOTBALL_API_BASE_URL gerekli.");
  }

  return config;
}

async function providerFetch(path, params) {
  const config = assertConfig();
  const baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  const url = new URL(String(path).replace(/^\/+/, ""), baseUrl);

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const request = fetch(url, {
    headers: {
      accept: "application/json",
      "X-Auth-Token": config.apiKey
    }
  }).then(async (response) => {
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? "PROVIDER_AUTH_ERROR"
        : response.status === 429
          ? "PROVIDER_RATE_LIMIT"
          : "PROVIDER_HTTP_ERROR";
      const message = code === "PROVIDER_AUTH_ERROR"
        ? "Live provider kimlik dogrulamasi basarisiz."
        : code === "PROVIDER_RATE_LIMIT"
          ? "Live provider istek limiti doldu."
          : `Live provider istegi basarisiz oldu (HTTP ${response.status}).`;
      throw new ProviderError(code, message);
    }

    return response.json();
  });

  return withTimeout(request, DEFAULT_TIMEOUT_MS);
}

function notImplemented(resource) {
  return new ProviderError(
    "LIVE_PROVIDER_NOT_IMPLEMENTED",
    `${resource} live adapter henuz gercek provider formatina baglanmadi.`
  );
}

/**
 * Takvim günü hesabı services/matchCalendar.js'te. Bu imza korunuyor çünkü
 * dışa aktarılıyor ve çağıranları var; gövdesi artık tek yetkili hesabı
 * çağırıyor. Aynı sorunun altı ayrı cevabı vardı ve altısının aynı kalacağının
 * garantisi yoktu.
 */
function todayInTimeZone(timeZone) {
  if (timeZone && timeZone !== CALENDAR_TIMEZONE) {
    // Depoda tek saat dilimi var; başka bir dilim istenirse sessizce
    // İstanbul'a düşmek yanlış tarih üretirdi.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }
  return todayInIstanbul();
}

function toDateOnly(value) {
  if (!value) {
    return todayInTimeZone("Europe/Istanbul");
  }

  return String(value).slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function resolveCompetitionCode(query) {
  const config = getConfig();
  const league = query && query.league ? String(query.league).trim() : "";

  if (/^[A-Z0-9_-]{2,16}$/i.test(league)) {
    return league.toUpperCase();
  }

  if (!config.competitionCode) {
    throw new ProviderError("PROVIDER_CONFIG_MISSING", "Live provider icin FOOTBALL_COMPETITION_CODE gerekli.");
  }

  return config.competitionCode;
}

function teamName(team) {
  return team && (team.shortName || team.name || team.tla) || "";
}

function teamShort(team) {
  return team && (team.tla || team.shortName || team.name || "").slice(0, 3).toUpperCase();
}

function teamLogo(team) {
  return (team && (team.crest || team.logo)) || "";
}

function scoreObject(score) {
  const fullTime = score && score.fullTime ? score.fullTime : {};
  return {
    home: fullTime.home == null ? null : fullTime.home,
    away: fullTime.away == null ? null : fullTime.away
  };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? null;
}

function numberOrNull(value) {
  const candidate = firstDefined(value);
  if (candidate === null) {
    return null;
  }

  const number = Number(candidate);
  return Number.isFinite(number) ? number : null;
}

function stampProviderData(records, resource, staleAfterMs) {
  const fetchedAt = new Date().toISOString();
  const staleAfter = new Date(Date.parse(fetchedAt) + staleAfterMs).toISOString();
  return records.map((record) => ({
    ...record,
    source: "football-data",
    providerName: "football-data",
    fetchedAt,
    staleAfter,
    dataStatus: "provider",
    needsReview: false,
    resource
  }));
}

function normalizeLiveMatch(item) {
  const kickoff = item.utcDate || item.kickoff || item.date || item.time || "";
  const score = scoreObject(item.score);
  const homeTeam = item.homeTeam || {};
  const awayTeam = item.awayTeam || {};

  return {
    id: String(item.id || item.fixtureId || `${teamName(homeTeam)}-${teamName(awayTeam)}-${kickoff}`),
    league: item.competition && (item.competition.name || item.competition.code) || item.league || "",
    round: Number.isFinite(Number(item.matchday)) ? Number(item.matchday) : null,
    venue: item.venue || null,
    kickoff,
    time: kickoff ? new Date(kickoff).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : "",
    homeTeam: teamName(homeTeam) || item.home || "",
    awayTeam: teamName(awayTeam) || item.away || "",
    homeTeamLogo: teamLogo(homeTeam),
    awayTeamLogo: teamLogo(awayTeam),
    homeShort: teamShort(homeTeam),
    awayShort: teamShort(awayTeam),
    status: item.status || "SCHEDULED",
    score,
    homeForm: null,
    awayForm: null,
    homeMomentum: null,
    awayMomentum: null,
    momentum: item.momentum || { side: "neutral", value: null },
    aiPrediction: null,
    goalExpectation: null,
    goalPotential: null,
    risk: null,
    tempo: null,
    live: ["LIVE", "IN_PLAY", "PAUSED"].includes(item.status),
    summary: "Canli provider verisi FutbolRadar formatina normalize edildi.",
    tags: [],
    liveTags: []
  };
}

function normalizeLiveStanding(item) {
  const team = item.team || {};
  const goalsFor = numberOrNull(item.goalsFor);
  const goalsAgainst = numberOrNull(item.goalsAgainst);
  const explicitGoalDifference = numberOrNull(item.goalDifference);
  const goalDifference = explicitGoalDifference === null && goalsFor !== null && goalsAgainst !== null
    ? goalsFor - goalsAgainst
    : explicitGoalDifference;

  return {
    id: String(team.id || item.teamId || team.name || item.team || ""),
    rank: numberOrNull(firstDefined(item.position, item.rank)),
    team: teamName(team) || item.team || item.name || "",
    name: teamName(team) || item.name || item.team || "",
    league: item.league || "",
    played: numberOrNull(firstDefined(item.playedGames, item.played, item.matchesPlayed)),
    won: numberOrNull(item.won),
    drawn: numberOrNull(firstDefined(item.draw, item.drawn)),
    lost: numberOrNull(item.lost),
    goalsFor,
    goalsAgainst,
    goalDifference,
    points: numberOrNull(item.points),
    average: goalDifference,
    momentum: null,
    formScore: null,
    form: Array.isArray(item.form) ? item.form : []
  };
}

function normalizeLiveTeam(item) {
  return {
    id: String(item.id || item.teamId || item.name || ""),
    name: item.name || item.team || "",
    league: item.league || "",
    rank: item.rank,
    played: item.played,
    points: item.points,
    average: item.average,
    momentum: firstDefined(item.momentum, item.rating),
    rating: firstDefined(item.rating, item.momentum),
    formScore: firstDefined(item.formScore, item.rating),
    form: item.form || [],
    attack: firstDefined(item.attack, item.attackRating),
    defense: firstDefined(item.defense, item.defenseRating),
    goalTrend: item.goalTrend || ""
  };
}

function normalizeLivePlayer(item) {
  const player = item.player || item;
  const statistics = Array.isArray(item.statistics) && item.statistics[0] ? item.statistics[0] : {};
  const team = item.team || statistics.team || {};
  const games = statistics.games || {};
  const goals = statistics.goals || {};
  const cards = statistics.cards || {};
  const passes = statistics.passes || {};
  const shots = statistics.shots || {};
  const tackles = statistics.tackles || {};
  const rating = numberOrNull(firstDefined(item.rating, games.rating, item.aiRating));
  const minutesPlayed = numberOrNull(firstDefined(item.minutesPlayed, item.minutes, games.minutes, item.playedMinutes));
  const overallRating = numberOrNull(firstDefined(item.overallRating, item.overall, item.aiRating, rating));

  return {
    id: String(player.id || item.playerId || item.id || item.name || ""),
    providerId: String(player.id || item.playerId || item.id || ""),
    providerName: "football-data",
    lastSyncedAt: firstDefined(item.lastSyncedAt, item.fetchedAt),
    name: player.name || item.name || "",
    height: player.height || item.height || null,
    weight: player.weight || item.weight || null,
    nationality: player.nationality || item.nationality || null,
    team: teamName(team) || item.team || "",
    league: item.league || "",
    position: player.position || item.position || games.position || item.role || "",
    age: player.age || item.age || null,
    preferredFoot: player.preferredFoot || item.preferredFoot || null,
    marketValue: player.marketValue || item.marketValue || null,
    contractUntil: player.contractUntil || item.contractUntil || null,
    appearances: numberOrNull(firstDefined(item.appearances, games.appearences, games.appearances)),
    aiRating: item.aiRating || overallRating,
    rating,
    overallRating,
    potentialRating: item.potentialRating || item.potential || overallRating,
    technicalRating: item.technicalRating || item.technical || overallRating,
    physicalRating: item.physicalRating || item.physical || overallRating,
    mentalRating: item.mentalRating || item.mental || overallRating,
    defensiveRating: item.defensiveRating || item.defensive || overallRating,
    attackingRating: item.attackingRating || item.attacking || overallRating,
    passingRating: item.passingRating || item.passing || passes.accuracy || overallRating,
    shootingRating: item.shootingRating || item.shooting || overallRating,
    paceRating: item.paceRating || item.pace || overallRating,
    dribblingRating: item.dribblingRating || item.dribbling || overallRating,
    staminaRating: item.staminaRating || item.stamina || overallRating,
    formRating: item.formRating || item.formScore || overallRating,
    trend: item.trend || "",
    trendDirection: item.trendDirection || item.trendState || "",
    impact: numberOrNull(firstDefined(item.impact, rating)),
    goals: numberOrNull(firstDefined(item.goals, goals.total)),
    assists: numberOrNull(firstDefined(item.assists, goals.assists)),
    minutesPlayed,
    minutes: firstDefined(item.minutes, minutesPlayed),
    yellowCards: numberOrNull(firstDefined(item.yellowCards, cards.yellow)),
    redCards: numberOrNull(firstDefined(item.redCards, cards.red)),
    passAccuracy: item.passAccuracy || passes.accuracy || null,
    shotsPerGame: item.shotsPerGame || null,
    tacklesPerGame: item.tacklesPerGame || null,
    interceptionsPerGame: item.interceptionsPerGame || null,
    shots: item.shots || shots.total || item.totalShots,
    keyPasses: item.keyPasses || item.chancesCreated,
    xg: item.xg || item.expectedGoals,
    xa: item.xa || item.expectedAssists,
    duelsWon: item.duelsWon || item.duels,
    duels: item.duels || item.duelsWon,
    pressures: item.pressures || item.pressActions || item.press,
    press: item.press || item.pressures || item.pressActions,
    badges: item.badges || [],
    formChange: item.formChange,
    threatScore: item.threatScore,
    creativityScore: item.creativityScore,
    pressingScore: item.pressingScore,
    continuityScore: item.continuityScore,
    tempoScore: item.tempoScore,
    summary: item.summary || "",
    lastUpdated: firstDefined(item.lastUpdated, item.lastUpdatedAt),
    radar: item.radar || {
      finishing: item.finishing || item.threatScore,
      creativity: item.creativity || item.creativityScore,
      pressing: item.pressing || item.pressingScore,
      tempo: item.tempo || item.tempoScore,
      consistency: item.consistency || item.continuityScore
    },
    form: item.form || []
  };
}

function normalizeLiveMomentum(item) {
  return {
    id: String(item.id || item.team || ""),
    rank: item.rank,
    team: item.team || item.name || "",
    momentum: item.momentum || item.score,
    score: item.score || item.momentum,
    formScore: item.formScore || item.rating,
    goalSignal: item.goalSignal || "",
    risk: item.risk || "",
    trend: item.trend || "",
    form: item.form || []
  };
}

function normalizeLiveSignal(item, type) {
  return {
    id: String(item.id || item.signalId || item.title || ""),
    type: item.type || type || "radar",
    severity: item.severity || item.level || "medium",
    label: item.label || item.category || "",
    title: item.title || "",
    value: item.value || item.score || "",
    description: item.description || item.summary || ""
  };
}

function normalizeLiveAnalysis(item) {
  return {
    id: String(item.id || item.slug || item.title || ""),
    title: item.title || "",
    excerpt: item.excerpt || item.summary || item.description || "",
    summary: item.summary || item.excerpt || item.description || "",
    url: item.url || item.href || ""
  };
}

async function getMatches(query) {
  const requestedCompetition = query && query.league ? String(query.league).trim() : "";
  const competition = findCompetition(query && (query.requestedCompetition || query.league));
  const dateFrom = query && query.date ? toDateOnly(query.date) : toDateOnly();
  const dateTo = dateFrom;
  let payload;

  if (requestedCompetition) {
    try {
      payload = await providerFetch(`/competitions/${resolveCompetitionCode(query)}/matches`, { dateFrom, dateTo });
    } catch (error) {
      if (!competition || !["PROVIDER_AUTH_ERROR", "PROVIDER_HTTP_ERROR"].includes(error.code)) {
        throw error;
      }
      payload = await providerFetch("/matches", { dateFrom, dateTo });
    }
  } else {
    payload = await providerFetch("/matches", { dateFrom, dateTo });
  }

  const allMatches = (payload.matches || payload.data || []).map(normalizeLiveMatch);
  // Belirli bir turnuva istenmediğinde football-data.org abonelikteki tüm
  // turnuvaları döndürüyor. Editoryal kapsam dışı ligler (ör. Brasileirão)
  // "Bugünkü Maçlar" listesine sızmasın diye api-football adaptöründeki
  // katalog filtresinin aynısı burada da uygulanır.
  const matches = competition
    ? allMatches.filter((match) => matchesCompetition(match.league, competition))
    : allMatches.filter((match) => competitions.some((item) => matchesCompetition(match.league, item)));

  return stampProviderData(matches, "matches", 5 * 60 * 1000);
}

/**
 * Full-season fixture list for the configured competition (e.g. every
 * Süper Lig matchday), not just "today". football-data.org's
 * /competitions/{code}/matches returns the whole season in one
 * unpaginated response when called without dateFrom/dateTo — no
 * page/limit parameter is applied here, and nothing is sliced client-side.
 */
async function getSeasonFixtures(query) {
  const season = query && query.season;
  const payload = await providerFetch(`/competitions/${resolveCompetitionCode(query)}/matches`, { season });
  const matches = (payload.matches || payload.data || []).map(normalizeLiveMatch);
  return stampProviderData(matches, "season-fixtures", 60 * 60 * 1000);
}

async function getStandings(query) {
  const competitionCode = resolveCompetitionCode(query);
  const payload = await providerFetch(`/competitions/${competitionCode}/standings`, {});
  const table = Array.isArray(payload.standings)
    ? payload.standings.find((standing) => standing.type === "TOTAL") || payload.standings[0]
    : null;
  return table && Array.isArray(table.table)
    ? stampProviderData(table.table.map(normalizeLiveStanding), "standings", 60 * 60 * 1000)
    : [];
}

async function getTeams(query) {
  // const payload = await providerFetch("/teams", query);
  // return (payload.data || payload.teams || []).map(normalizeLiveTeam);
  throw notImplemented("teams");
}

async function getPlayers(query) {
  // const payload = await providerFetch("/players", query);
  // return (payload.data || payload.players || []).map(normalizeLivePlayer);
  throw notImplemented("players");
}

async function getMomentum(query) {
  // const payload = await providerFetch("/momentum", query);
  // return (payload.data || payload.momentum || []).map(normalizeLiveMomentum);
  throw notImplemented("momentum");
}

async function getSignals(query) {
  // const payload = await providerFetch("/signals", query);
  // return {
  //   radarSignals: (payload.radarSignals || payload.data || []).map((item) => normalizeLiveSignal(item, "radar")),
  //   momentumSignals: (payload.momentumSignals || []).map((item) => normalizeLiveSignal(item, "momentum"))
  // };
  throw notImplemented("signals");
}

async function getAnalyses(query) {
  // const payload = await providerFetch("/analyses", query);
  // return (payload.data || payload.analyses || []).map(normalizeLiveAnalysis);
  throw notImplemented("analyses");
}

module.exports = {
  name: "football-data",
  source,
  ProviderError,
  getConfig,
  providerFetch,
  getMatches,
  getSeasonFixtures,
  getStandings,
  getTeams,
  getPlayers,
  getMomentum,
  getSignals,
  getAnalyses,
  normalizeLiveMatch,
  normalizeLiveStanding,
  normalizeLiveTeam,
  normalizeLivePlayer,
  normalizeLiveMomentum,
  normalizeLiveSignal,
  normalizeLiveAnalysis,
  todayInTimeZone,
  resolveCompetitionCode
};
