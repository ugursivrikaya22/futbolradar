const {
  API_KEY_ENV_NAMES,
  BASE_URL_ENV_NAMES,
  COMPETITION_CODE_ENV_NAMES,
  DEFAULT_TIMEOUT_MS,
  firstPresentEnv,
  withTimeout
} = require("../_utils");

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
      let message = `Live provider HTTP ${response.status} dondu.`;
      try {
        const payload = await response.json();
        message = payload.message || payload.error || message;
      } catch (error) {
        // Provider body may be empty or non-JSON.
      }

      const code = response.status === 401 || response.status === 403
        ? "PROVIDER_AUTH_ERROR"
        : response.status === 429
          ? "PROVIDER_RATE_LIMIT"
          : "PROVIDER_HTTP_ERROR";
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

function todayInTimeZone(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
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

function scoreObject(score) {
  const fullTime = score && score.fullTime ? score.fullTime : {};
  return {
    home: fullTime.home == null ? null : fullTime.home,
    away: fullTime.away == null ? null : fullTime.away
  };
}

function normalizeLiveMatch(item) {
  const kickoff = item.utcDate || item.kickoff || item.date || item.time || "";
  const score = scoreObject(item.score);
  const homeTeam = item.homeTeam || {};
  const awayTeam = item.awayTeam || {};

  return {
    id: String(item.id || item.fixtureId || `${teamName(homeTeam)}-${teamName(awayTeam)}-${kickoff}`),
    league: item.competition && (item.competition.name || item.competition.code) || item.league || "",
    kickoff,
    time: kickoff ? new Date(kickoff).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "",
    homeTeam: teamName(homeTeam) || item.home || "",
    awayTeam: teamName(awayTeam) || item.away || "",
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
  const goalDifference = item.goalDifference == null ? (Number(item.goalsFor || 0) - Number(item.goalsAgainst || 0)) : item.goalDifference;

  return {
    id: String(team.id || item.teamId || team.name || item.team || ""),
    rank: item.position || item.rank,
    team: teamName(team) || item.team || item.name || "",
    name: teamName(team) || item.name || item.team || "",
    league: item.league || "",
    played: item.playedGames || item.played || item.matchesPlayed || 0,
    won: item.won || 0,
    drawn: item.draw || item.drawn || 0,
    lost: item.lost || 0,
    goalsFor: item.goalsFor || 0,
    goalsAgainst: item.goalsAgainst || 0,
    goalDifference,
    points: item.points || 0,
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
    momentum: item.momentum || item.rating,
    rating: item.rating || item.momentum,
    formScore: item.formScore || item.rating,
    form: item.form || [],
    attack: item.attack || item.attackRating || 0,
    defense: item.defense || item.defenseRating || 0,
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
  const rating = item.rating || games.rating || item.aiRating || null;
  const minutesPlayed = item.minutesPlayed || item.minutes || games.minutes || item.playedMinutes || 0;
  const overallRating = item.overallRating || item.overall || item.aiRating || rating;

  return {
    id: String(player.id || item.playerId || item.id || item.name || ""),
    providerId: String(player.id || item.playerId || item.id || ""),
    providerName: "football-data",
    lastSyncedAt: new Date().toISOString(),
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
    appearances: item.appearances || games.appearences || games.appearances || 0,
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
    impact: item.impact || rating || 0,
    goals: item.goals || goals.total || 0,
    assists: item.assists || goals.assists || 0,
    minutesPlayed,
    minutes: item.minutes || minutesPlayed,
    yellowCards: item.yellowCards || cards.yellow || 0,
    redCards: item.redCards || cards.red || 0,
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
    lastUpdated: item.lastUpdated || new Date().toISOString().slice(0, 10),
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
  const competitionCode = resolveCompetitionCode(query);
  const dateFrom = query && query.date ? toDateOnly(query.date) : toDateOnly();
  const dateTo = query && query.date ? dateFrom : addDays(dateFrom, 7);
  const payload = await providerFetch(`/competitions/${competitionCode}/matches`, { dateFrom, dateTo });
  return (payload.matches || payload.data || []).map(normalizeLiveMatch);
}

async function getStandings(query) {
  const competitionCode = resolveCompetitionCode(query);
  const payload = await providerFetch(`/competitions/${competitionCode}/standings`, {});
  const table = Array.isArray(payload.standings)
    ? payload.standings.find((standing) => standing.type === "TOTAL") || payload.standings[0]
    : null;
  return table && Array.isArray(table.table) ? table.table.map(normalizeLiveStanding) : [];
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
  name: "football",
  source,
  ProviderError,
  getConfig,
  providerFetch,
  getMatches,
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
