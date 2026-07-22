const {
  DEFAULT_TIMEOUT_MS,
  normalizeText,
  withTimeout
} = require("../../api/_utils");
const { competitions, matchesCompetition } = require("../competitionCatalog");

const source = "FutbolRadar API-Football Live API";
const DEFAULT_BASE_URL = "https://v3.football.api-sports.io";

class ProviderError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.statusCode = statusCode || 200;
  }
}

function getConfig() {
  return {
    provider: process.env.FOOTBALL_PRIMARY_PROVIDER || "api-football",
    baseUrl: process.env.APIFOOTBALL_API_BASE_URL || DEFAULT_BASE_URL,
    apiKey: process.env.APIFOOTBALL_API_KEY || "",
    leagueId: process.env.APIFOOTBALL_LEAGUE_ID || "",
    season: process.env.APIFOOTBALL_SEASON || "2026",
    country: process.env.APIFOOTBALL_COUNTRY || "Turkey"
  };
}

function hasConfig() {
  const config = getConfig();
  return Boolean(config.apiKey && config.baseUrl);
}

function assertConfig() {
  const config = getConfig();

  if (!config.apiKey) {
    throw new ProviderError("PROVIDER_CONFIG_MISSING", "API-Football provider icin APIFOOTBALL_API_KEY gerekli.");
  }

  if (!config.baseUrl) {
    throw new ProviderError("PROVIDER_CONFIG_MISSING", "API-Football provider icin APIFOOTBALL_API_BASE_URL gerekli.");
  }

  return config;
}

function compactParams(params) {
  return Object.fromEntries(
    Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function mapHttpError(status) {
  if (status === 401 || status === 403) {
    return "PROVIDER_AUTH_ERROR";
  }

  if (status === 404) {
    return "PROVIDER_NOT_FOUND";
  }

  if (status === 429) {
    return "PROVIDER_RATE_LIMIT";
  }

  return "PROVIDER_HTTP_ERROR";
}

function publicErrorMessage(code, status) {
  if (code === "PROVIDER_AUTH_ERROR") return "Live provider kimlik dogrulamasi basarisiz.";
  if (code === "PROVIDER_RATE_LIMIT") return "Live provider istek limiti doldu.";
  if (code === "PROVIDER_NOT_FOUND") return "Live provider istenen kaydi bulamadi.";
  return `Live provider istegi basarisiz oldu (HTTP ${status}).`;
}

function apiErrors(payload) {
  if (!payload || !payload.errors) {
    return [];
  }

  if (Array.isArray(payload.errors)) {
    return payload.errors.filter(Boolean);
  }

  if (typeof payload.errors === "object") {
    return Object.values(payload.errors).filter(Boolean);
  }

  return [payload.errors].filter(Boolean);
}

function classifyPayloadError(errors) {
  const text = (errors || [])
    .map((error) => typeof error === "string" ? error : JSON.stringify(error))
    .join(" ")
    .toLowerCase();

  if (/api.?key|application key|token|auth|unauthor|forbidden/.test(text)) {
    return {
      code: "PROVIDER_AUTH_ERROR",
      message: "API-Football anahtari gecersiz, eksik veya bu endpoint icin yetkisiz."
    };
  }

  if (/rate.?limit|request.?limit|quota|too many requests/.test(text)) {
    return {
      code: "PROVIDER_RATE_LIMIT",
      message: "API-Football istek limiti doldu; statik yedek veri kullanilacak."
    };
  }

  if (/subscription|pricing|plan|not allowed|access denied/.test(text)) {
    return {
      code: "PROVIDER_PLAN_ERROR",
      message: "API-Football paketi bu veri veya turnuva icin erisim vermiyor."
    };
  }

  if (/season|date|no results|not found/.test(text)) {
    return {
      code: "PROVIDER_DATA_UNAVAILABLE",
      message: "API-Football istenen tarih veya sezon icin veri dondurmedi."
    };
  }

  return {
    code: "PROVIDER_RESPONSE_ERROR",
    message: "Live provider kontrollu bir veri hatasi dondu."
  };
}

async function providerFetch(path, params) {
  const config = assertConfig();
  const baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  const url = new URL(String(path).replace(/^\/+/, ""), baseUrl);

  Object.entries(compactParams(params)).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const request = fetch(url, {
    headers: {
      accept: "application/json",
      "x-apisports-key": config.apiKey
    }
  }).then(async (response) => {
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      const code = mapHttpError(response.status);
      throw new ProviderError(
        code,
        publicErrorMessage(code, response.status),
        response.status
      );
    }

    const errors = apiErrors(payload);
    if (errors.length) {
      const classified = classifyPayloadError(errors);
      throw new ProviderError(classified.code, classified.message);
    }

    return payload || {};
  });

  return withTimeout(request, DEFAULT_TIMEOUT_MS);
}

function resolveLeague(value) {
  const config = getConfig();
  return value || config.leagueId || "";
}

function resolveSeason(value) {
  const config = getConfig();
  return value || config.season || "2026";
}

function todayInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function responseItems(payload) {
  return Array.isArray(payload && payload.response) ? payload.response : [];
}

function teamName(team) {
  return team && (team.name || team.shortName || team.code) || "";
}

function scoreValue(score) {
  return score === undefined || score === null ? null : score;
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
    source: "api-football",
    providerName: "api-football",
    fetchedAt,
    staleAfter,
    dataStatus: "provider",
    needsReview: false,
    resource
  }));
}

function normalizeStatus(status) {
  const short = status && status.short;
  if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE"].includes(short)) {
    return "LIVE";
  }

  if (["FT", "AET", "PEN"].includes(short)) {
    return "FINISHED";
  }

  return "SCHEDULED";
}

function normalizeFixture(item) {
  const fixture = item.fixture || {};
  const league = item.league || {};
  const teams = item.teams || {};
  const goals = item.goals || {};
  const kickoff = fixture.date || "";
  const homeTeam = teams.home || {};
  const awayTeam = teams.away || {};

  return {
    id: String(fixture.id || `${teamName(homeTeam)}-${teamName(awayTeam)}-${kickoff}`),
    providerId: fixture.id ? String(fixture.id) : "",
    league: league.name || "",
    kickoff,
    time: kickoff ? new Date(kickoff).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "",
    homeTeam: teamName(homeTeam),
    awayTeam: teamName(awayTeam),
    status: normalizeStatus(fixture.status || {}),
    providerStatus: fixture.status && fixture.status.short || null,
    live: normalizeStatus(fixture.status || {}) === "LIVE",
    score: {
      home: scoreValue(goals.home),
      away: scoreValue(goals.away)
    },
    homeForm: null,
    awayForm: null,
    homeMomentum: null,
    awayMomentum: null,
    momentum: { side: "neutral", value: null },
    aiPrediction: null,
    goalExpectation: null,
    goalPotential: null,
    risk: null,
    source: "api-football"
  };
}

function filterSupportedCompetitions(matches) {
  return (Array.isArray(matches) ? matches : []).filter((match) =>
    competitions.some((competition) => matchesCompetition(match.league, competition))
  );
}

function normalizeStandingRow(row, leagueName) {
  const team = row.team || {};
  return {
    id: String(team.id || team.name || ""),
    providerId: team.id ? String(team.id) : "",
    rank: numberOrNull(row.rank),
    team: teamName(team),
    name: teamName(team),
    league: leagueName || "",
    played: numberOrNull(row.all && row.all.played),
    won: numberOrNull(row.all && row.all.win),
    drawn: numberOrNull(row.all && row.all.draw),
    lost: numberOrNull(row.all && row.all.lose),
    goalsFor: numberOrNull(row.all && row.all.goals && row.all.goals.for),
    goalsAgainst: numberOrNull(row.all && row.all.goals && row.all.goals.against),
    goalDifference: numberOrNull(row.goalsDiff),
    points: numberOrNull(row.points),
    average: numberOrNull(row.goalsDiff),
    momentum: null,
    formScore: null,
    form: row.form ? String(row.form).split("").slice(-5) : [],
    source: "api-football"
  };
}

function normalizeTeam(item) {
  const team = item.team || {};
  const venue = item.venue || {};
  return {
    id: String(team.id || team.name || ""),
    providerId: team.id ? String(team.id) : "",
    name: teamName(team),
    shortName: team.code || "",
    logo: team.logo || null,
    league: "",
    country: team.country || "",
    venue: venue.name || null,
    coach: null,
    squadCount: null,
    momentum: null,
    rating: null,
    attackRating: null,
    defenseRating: null,
    source: "api-football"
  };
}

function normalizeSquadPlayer(item, team) {
  return {
    id: String(item.id || item.name || ""),
    providerId: item.id ? String(item.id) : "",
    name: item.name || "",
    currentTeam: teamName(team),
    team: teamName(team),
    position: item.position || "",
    age: item.age || null,
    photo: item.photo || null,
    dataStatus: "provider",
    ratingStatus: "pending",
    source: "api-football"
  };
}

function firstStatistic(item) {
  return Array.isArray(item.statistics) && item.statistics[0] ? item.statistics[0] : {};
}

function normalizePlayer(item) {
  const player = item.player || item;
  const statistics = firstStatistic(item);
  const team = statistics.team || item.team || {};
  const games = statistics.games || {};
  const goals = statistics.goals || {};
  const cards = statistics.cards || {};
  const rating = games.rating == null ? null : Number(games.rating);
  const minutes = numberOrNull(games.minutes);
  const appearances = numberOrNull(firstDefined(games.appearences, games.appearances));
  const playerGoals = numberOrNull(goals.total);
  const assists = numberOrNull(goals.assists);
  const yellowCards = numberOrNull(cards.yellow);
  const redCards = numberOrNull(cards.red);

  return {
    id: String(player.id || player.name || ""),
    providerId: player.id ? String(player.id) : "",
    providerName: "api-football",
    name: player.name || "",
    currentTeam: teamName(team),
    team: teamName(team),
    formerTeams: [],
    league: "",
    position: games.position || player.position || "",
    birthDate: player.birth && player.birth.date || null,
    computedAge: player.age || null,
    age: player.age || null,
    nationality: player.nationality || null,
    height: player.height || null,
    weight: player.weight || null,
    marketValueEur: null,
    photo: player.photo || null,
    stats: {
      appearances,
      minutes,
      goals: playerGoals,
      assists,
      yellowCards,
      redCards
    },
    appearances,
    minutesPlayed: minutes,
    minutes,
    goals: playerGoals,
    assists,
    yellowCards,
    redCards,
    rating,
    aiRating: rating,
    overallRating: rating,
    transferHistory: [],
    dataStatus: "provider",
    ratingStatus: rating == null ? "pending" : "provider",
    transferUpdatedAt: null,
    source: "api-football",
    lastSyncedAt: firstDefined(item.lastSyncedAt, item.fetchedAt)
  };
}

function normalizeTransfer(item) {
  const player = item.player || {};
  const transfers = Array.isArray(item.transfers) ? item.transfers : [];
  return transfers.map((transfer, index) => {
    const teams = transfer.teams || {};
    const fromTeam = teams.out || {};
    const toTeam = teams.in || {};
    const date = transfer.date || null;
    return {
      id: String(`${player.id || player.name || "player"}-${date || index}-${teamName(toTeam)}`),
      playerId: player.id ? String(player.id) : "",
      playerName: player.name || "",
      date,
      season: date ? `${String(date).slice(0, 4)}/${String(Number(String(date).slice(2, 4)) + 1).padStart(2, "0")}` : null,
      fromTeam: teamName(fromTeam) || null,
      toTeam: teamName(toTeam) || null,
      type: transfer.type || null,
      fee: null,
      feeEur: null,
      marketValueEur: null,
      source: "api-football"
    };
  });
}

function ensureLeagueForData(params) {
  const league = resolveLeague(params && params.league);
  if (!league) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "API-Football icin APIFOOTBALL_LEAGUE_ID veya league query gerekli.");
  }

  return league;
}

async function getFixtures(query) {
  const fixtureId = query && (query.fixtureId || query.id);
  const league = resolveLeague(query && query.league);
  const season = resolveSeason(query && query.season);
  const date = query && query.date || (!fixtureId ? todayInIstanbul() : undefined);

  // API-Football supports a date-only fixture query. Leaving league empty here
  // is intentional: it lets the live matches page cover every competition.
  // Standings and league-specific resources still require a league id.
  const payload = await providerFetch("/fixtures", {
    id: fixtureId,
    league: league || undefined,
    season: league || fixtureId ? season : undefined,
    date
  });
  const matches = responseItems(payload).map(normalizeFixture);
  const supportedMatches = league ? matches : filterSupportedCompetitions(matches);
  return stampProviderData(supportedMatches, "matches", 5 * 60 * 1000);
}

async function getMatches(query) {
  return getFixtures(query);
}

async function getStandings(query) {
  const league = ensureLeagueForData(query);
  const season = resolveSeason(query && query.season);
  const payload = await providerFetch("/standings", { league, season });
  const leaguePayload = responseItems(payload)[0] && responseItems(payload)[0].league || {};
  const table = Array.isArray(leaguePayload.standings) ? leaguePayload.standings[0] || [] : [];
  return stampProviderData(table.map((row) => normalizeStandingRow(row, leaguePayload.name)), "standings", 60 * 60 * 1000);
}

async function getTeams(query) {
  const league = resolveLeague(query && query.league);
  const payload = await providerFetch("/teams", compactParams({
    league,
    season: resolveSeason(query && query.season),
    search: query && query.search,
    id: query && (query.teamId || query.id),
    country: query && query.country || getConfig().country
  }));
  return stampProviderData(responseItems(payload).map(normalizeTeam), "teams", 24 * 60 * 60 * 1000);
}

async function getSquad(query) {
  const teamId = query && query.teamId;
  if (!teamId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Kadro icin teamId query gerekli.");
  }

  const payload = await providerFetch("/players/squads", { team: teamId });
  const item = responseItems(payload)[0] || {};
  const team = item.team || {};
  const squad = Array.isArray(item.players) ? item.players : [];
  return stampProviderData(squad.map((player) => normalizeSquadPlayer(player, team)), "squad", 6 * 60 * 60 * 1000);
}

async function getPlayers(query) {
  const league = resolveLeague(query && query.league);
  const payload = await providerFetch("/players", compactParams({
    id: query && (query.playerId || query.id),
    team: query && query.teamId,
    league,
    season: resolveSeason(query && query.season),
    search: query && query.search,
    page: query && query.page
  }));
  return stampProviderData(responseItems(payload).map(normalizePlayer), "players", 24 * 60 * 60 * 1000);
}

async function getPlayerById(query) {
  const data = await getPlayers({ ...query, playerId: query && query.playerId });
  return data[0] || null;
}

async function getPlayerTransfers(query) {
  const playerId = query && query.playerId;
  const teamId = query && query.teamId;
  if (!playerId && !teamId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Transfer icin playerId veya teamId query gerekli.");
  }

  const payload = await providerFetch("/transfers", compactParams({ player: playerId, team: teamId }));
  return stampProviderData(responseItems(payload).flatMap(normalizeTransfer), "transfers", 6 * 60 * 60 * 1000);
}

async function getTopScorers(query) {
  const league = ensureLeagueForData(query);
  const payload = await providerFetch("/players/topscorers", { league, season: resolveSeason(query && query.season) });
  return stampProviderData(responseItems(payload).map(normalizePlayer), "players", 6 * 60 * 60 * 1000);
}

async function getInjuries(query) {
  const league = resolveLeague(query && query.league);
  const payload = await providerFetch("/injuries", compactParams({
    league,
    season: resolveSeason(query && query.season),
    team: query && query.teamId
  }));
  return responseItems(payload);
}

async function getLineups(query) {
  const fixtureId = query && query.fixtureId;
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Lineup icin fixtureId query gerekli.");
  }

  const payload = await providerFetch("/fixtures/lineups", { fixture: fixtureId });
  return responseItems(payload);
}

async function getFixtureEvents(query) {
  const fixtureId = query && query.fixtureId;
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Mac olaylari icin fixtureId query gerekli.");
  }

  const payload = await providerFetch("/fixtures/events", { fixture: fixtureId });
  return responseItems(payload);
}

async function getFixtureStatistics(query) {
  const fixtureId = query && query.fixtureId;
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Mac istatistigi icin fixtureId query gerekli.");
  }

  const payload = await providerFetch("/fixtures/statistics", { fixture: fixtureId });
  return responseItems(payload);
}

async function getPredictions(query) {
  const fixtureId = query && query.fixtureId;
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Tahmin icin fixtureId query gerekli.");
  }

  // API-Football supports /predictions on eligible plans. Keep the adapter
  // isolated so provider/plan changes never leak into frontend code.
  const payload = await providerFetch("/predictions", { fixture: fixtureId });
  return responseItems(payload);
}

async function getMatchDetail(query) {
  const fixtureId = query && (query.fixtureId || query.id);
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Mac detayi icin fixtureId veya id query gerekli.");
  }

  const fixtures = await getFixtures({ fixtureId });
  const match = fixtures[0];
  if (!match) {
    throw new ProviderError("PROVIDER_NOT_FOUND", "Mac detayi provider tarafinda bulunamadi.");
  }

  const [lineups, events, statistics, predictions] = await Promise.all([
    getLineups({ fixtureId }).catch(() => []),
    getFixtureEvents({ fixtureId }).catch(() => []),
    getFixtureStatistics({ fixtureId }).catch(() => []),
    getPredictions({ fixtureId }).catch(() => [])
  ]);

  return {
    ...match,
    fixtureId: String(fixtureId),
    lineups,
    events,
    statistics,
    prediction: predictions[0] || null,
    source: "api-football",
    fetchedAt: new Date().toISOString(),
    staleAfter: new Date(Date.now() + 2 * 60 * 1000).toISOString()
  };
}

function canSearchLocally(player, search) {
  if (!search) {
    return true;
  }

  return normalizeText(player.name).includes(normalizeText(search));
}

module.exports = {
  name: "api-football",
  source,
  ProviderError,
  canSearchLocally,
  getConfig,
  hasConfig,
  providerFetch,
  classifyPayloadError,
  getFixtures,
  getMatches,
  getStandings,
  getTeams,
  getSquad,
  getPlayers,
  getPlayerById,
  getPlayerTransfers,
  getTopScorers,
  getInjuries,
  getLineups,
  getFixtureEvents,
  getFixtureStatistics,
  getPredictions,
  getMatchDetail,
  normalizeFixture,
  filterSupportedCompetitions,
  normalizeStandingRow,
  normalizeTeam,
  normalizePlayer,
  normalizeTransfer
};
