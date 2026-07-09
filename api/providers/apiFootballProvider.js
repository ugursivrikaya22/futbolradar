const {
  DEFAULT_TIMEOUT_MS,
  normalizeText,
  withTimeout
} = require("../_utils");

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
      const providerMessage = payload && (payload.message || payload.error);
      throw new ProviderError(
        mapHttpError(response.status),
        providerMessage || `API-Football HTTP ${response.status} dondu.`,
        response.status
      );
    }

    const errors = apiErrors(payload);
    if (errors.length) {
      throw new ProviderError("PROVIDER_RESPONSE_ERROR", String(errors[0]));
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

function responseItems(payload) {
  return Array.isArray(payload && payload.response) ? payload.response : [];
}

function teamName(team) {
  return team && (team.name || team.shortName || team.code) || "";
}

function scoreValue(score) {
  return score === undefined || score === null ? null : score;
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

function normalizeStandingRow(row, leagueName) {
  const team = row.team || {};
  return {
    id: String(team.id || team.name || ""),
    providerId: team.id ? String(team.id) : "",
    rank: row.rank || 0,
    team: teamName(team),
    name: teamName(team),
    league: leagueName || "",
    played: row.all && row.all.played || 0,
    won: row.all && row.all.win || 0,
    drawn: row.all && row.all.draw || 0,
    lost: row.all && row.all.lose || 0,
    goalsFor: row.all && row.all.goals && row.all.goals.for || 0,
    goalsAgainst: row.all && row.all.goals && row.all.goals.against || 0,
    goalDifference: row.goalsDiff || 0,
    points: row.points || 0,
    average: row.goalsDiff || 0,
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
    squadCount: 0,
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
  const minutes = games.minutes || 0;

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
      appearances: games.appearences || games.appearances || 0,
      minutes,
      goals: goals.total || 0,
      assists: goals.assists || 0,
      yellowCards: cards.yellow || 0,
      redCards: cards.red || 0
    },
    appearances: games.appearences || games.appearances || 0,
    minutesPlayed: minutes,
    minutes,
    goals: goals.total || 0,
    assists: goals.assists || 0,
    yellowCards: cards.yellow || 0,
    redCards: cards.red || 0,
    rating,
    aiRating: rating,
    overallRating: rating,
    transferHistory: [],
    dataStatus: "provider",
    ratingStatus: rating == null ? "pending" : "provider",
    transferUpdatedAt: null,
    source: "api-football",
    lastSyncedAt: new Date().toISOString()
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
  const league = ensureLeagueForData(query);
  const season = resolveSeason(query && query.season);
  const payload = await providerFetch("/fixtures", { league, season, date: query && query.date });
  return responseItems(payload).map(normalizeFixture);
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
  return table.map((row) => normalizeStandingRow(row, leaguePayload.name));
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
  return responseItems(payload).map(normalizeTeam);
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
  return squad.map((player) => normalizeSquadPlayer(player, team));
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
  return responseItems(payload).map(normalizePlayer);
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
  return responseItems(payload).flatMap(normalizeTransfer);
}

async function getTopScorers(query) {
  const league = ensureLeagueForData(query);
  const payload = await providerFetch("/players/topscorers", { league, season: resolveSeason(query && query.season) });
  return responseItems(payload).map(normalizePlayer);
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
  normalizeFixture,
  normalizeStandingRow,
  normalizeTeam,
  normalizePlayer,
  normalizeTransfer
};
