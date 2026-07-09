const matches = require("../../data/matches.json");
const teams = require("../../data/teams.json");
const players = require("../../data/players.json");
const momentum = require("../../data/momentum.json");
const signals = require("../../data/signals.json");
const analyses = require("../../data/analyses.json");
const { normalizeText } = require("../_utils");
const { normalizePlayer: normalizePlayerRecord } = require("../../services/playerService");

const source = "FutbolRadar Mock API";

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeMatch(match) {
  const homeMomentum = Number(match.homeMomentum || match.homeForm || 0);
  const awayMomentum = Number(match.awayMomentum || match.awayForm || 0);

  return {
    ...match,
    id: match.id || `${slug(match.homeTeam)}-${slug(match.awayTeam)}`,
    kickoff: match.kickoff || match.time || "",
    momentum: match.momentum || {
      side: homeMomentum >= awayMomentum ? "home" : "away",
      value: Math.abs(homeMomentum - awayMomentum)
    }
  };
}

function normalizeMatchDetail(match) {
  const normalized = normalizeMatch(match || {});
  return {
    ...normalized,
    fixtureId: normalized.providerId || normalized.id,
    status: normalized.status || "SCHEDULED",
    score: typeof normalized.score === "object" ? normalized.score : { home: null, away: null },
    lineups: [],
    events: [],
    statistics: [
      { team: normalized.homeTeam, type: "Momentum", value: normalized.homeMomentum || normalized.homeForm || null },
      { team: normalized.awayTeam, type: "Momentum", value: normalized.awayMomentum || normalized.awayForm || null },
      { team: normalized.homeTeam, type: "Goal potential", value: normalized.goalPotential || null }
    ],
    prediction: normalized.aiPrediction ? { label: normalized.aiPrediction, risk: normalized.risk || null } : null,
    source: "mock",
    updatedAt: new Date().toISOString()
  };
}

function normalizeStanding(team) {
  return {
    id: team.id || slug(team.name || team.team),
    rank: team.rank,
    team: team.team || team.name,
    name: team.name || team.team,
    league: team.league,
    played: team.played,
    points: team.points,
    average: team.average,
    momentum: team.momentum,
    formScore: team.formScore,
    form: team.form || []
  };
}

function normalizeTeam(team) {
  const squadCount = players.filter((player) => normalizeText(player.currentTeam || player.team) === normalizeText(team.name)).length;
  return {
    ...team,
    id: team.id || slug(team.name),
    providerId: team.providerId || `mock-${team.id || slug(team.name)}`,
    shortName: team.shortName || String(team.name || "").slice(0, 3).toUpperCase(),
    logo: team.logo || null,
    country: team.country || "Turkey",
    venue: team.venue || null,
    coach: team.coach || null,
    squadCount,
    rating: team.rating || team.momentum,
    attackRating: team.attackRating || team.attack,
    defenseRating: team.defenseRating || team.defense,
    source: "mock"
  };
}

function normalizePlayer(player) {
  const normalized = normalizePlayerRecord(player);
  const rating = normalized.rating || normalized.aiRating || normalized.overallRating || 0;
  const minutesPlayed = normalized.minutesPlayed || normalized.minutes || 0;

  return {
    ...normalized,
    id: normalized.id || slug(`${normalized.name}-${normalized.currentTeam || normalized.team}`),
    height: normalized.height || null,
    weight: normalized.weight || null,
    age: normalized.age || null,
    nationality: normalized.nationality || null,
    currentTeam: normalized.currentTeam || normalized.team || "",
    team: normalized.currentTeam || normalized.team || "",
    league: normalized.league || "",
    position: normalized.position || "",
    preferredFoot: normalized.preferredFoot || null,
    marketValue: normalized.marketValue || null,
    marketValueEur: normalized.marketValueEur == null ? null : normalized.marketValueEur,
    contractUntil: normalized.contractUntil || null,
    formerTeams: normalized.formerTeams || [],
    transferHistory: normalized.transferHistory || [],
    dataStatus: normalized.dataStatus || "mock_needs_verification",
    ratingStatus: normalized.ratingStatus || "estimated",
    sourceNote: normalized.sourceNote || "",
    transferUpdatedAt: normalized.transferUpdatedAt || normalized.lastUpdated || null,
    birthDate: normalized.birthDate || null,
    computedAge: normalized.computedAge || null,
    secondaryPosition: normalized.secondaryPosition || "",
    heightCm: normalized.heightCm || null,
    appearances: normalized.appearances || 0,
    goals: normalized.goals || 0,
    assists: normalized.assists || 0,
    minutesPlayed,
    minutes: normalized.minutes || minutesPlayed,
    yellowCards: normalized.yellowCards || 0,
    redCards: normalized.redCards || 0,
    passAccuracy: normalized.passAccuracy || null,
    shotsPerGame: normalized.shotsPerGame || null,
    tacklesPerGame: normalized.tacklesPerGame || null,
    interceptionsPerGame: normalized.interceptionsPerGame || null,
    rating,
    aiRating: normalized.aiRating || rating,
    overallRating: normalized.overallRating || rating,
    potentialRating: normalized.potentialRating || normalized.overallRating || rating,
    technicalRating: normalized.technicalRating || rating,
    physicalRating: normalized.physicalRating || rating,
    mentalRating: normalized.mentalRating || rating,
    defensiveRating: normalized.defensiveRating || rating,
    attackingRating: normalized.attackingRating || rating,
    passingRating: normalized.passingRating || rating,
    shootingRating: normalized.shootingRating || rating,
    paceRating: normalized.paceRating || rating,
    dribblingRating: normalized.dribblingRating || rating,
    staminaRating: normalized.staminaRating || rating,
    formRating: normalized.formRating || rating,
    providerId: normalized.providerId || `mock-${slug(`${normalized.name}-${normalized.currentTeam || normalized.team}`)}`,
    providerName: normalized.providerName || "FutbolRadar Mock",
    lastSyncedAt: normalized.lastSyncedAt || "2026-07-09T08:00:00+03:00",
    lastUpdated: normalized.lastUpdated || String(normalized.lastSyncedAt || "2026-07-09T08:00:00+03:00").slice(0, 10),
    radar: normalized.radar || {
      finishing: normalized.threatScore || rating,
      creativity: normalized.creativityScore || rating,
      pressing: normalized.pressingScore || rating,
      tempo: normalized.tempoScore || rating,
      consistency: normalized.continuityScore || rating
    }
  };
}

function normalizeMomentum(row) {
  const team = teams.find((item) => item.name === row.team);
  return {
    ...row,
    id: row.id || slug(row.team),
    score: row.score || row.momentum,
    trend: row.trend || (row.rank <= 2 ? "Yukseliyor" : row.rank === 3 ? "Pozitif" : "Izlenmeli"),
    form: row.form || (team ? team.form : [])
  };
}

function normalizeSignal(signal, type, severity) {
  return {
    type: signal.type || type,
    severity: signal.severity || severity,
    ...signal
  };
}

function normalizeSignals(payload) {
  const radarSignals = (payload.radarSignals || []).map((signal) => ({
    group: "radarSignals",
    ...normalizeSignal(signal, "radar", "medium")
  }));
  const momentumSignals = (payload.momentumSignals || []).map((signal) => ({
    group: "momentumSignals",
    ...normalizeSignal(signal, "momentum", "medium")
  }));

  return [...radarSignals, ...momentumSignals];
}

function normalizeAnalysis(item) {
  return {
    excerpt: item.excerpt || item.summary || "",
    ...item
  };
}

function byLeague(items, league) {
  if (!league) {
    return items;
  }

  const wanted = normalizeText(league);
  return items.filter((item) => normalizeText(item.league) === wanted);
}

function byTeam(items, team) {
  if (!team) {
    return items;
  }

  const wanted = normalizeText(team);
  return items.filter((item) => normalizeText(item.currentTeam || item.team || item.name).includes(wanted));
}

function bySearch(items, search) {
  if (!search) {
    return items;
  }

  const wanted = normalizeText(search);
  return items.filter((item) => normalizeText(item.name || item.playerName || item.team || "").includes(wanted));
}

function byPage(items, page, pageSize) {
  const pageNumber = Number(page);
  if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
    return items;
  }

  const size = Number(pageSize) > 0 ? Number(pageSize) : 25;
  const start = (pageNumber - 1) * size;
  return items.slice(start, start + size);
}

function normalizeTransferRow(player, transfer, index) {
  return {
    id: `${player.id || slug(player.name)}-${transfer.date || index}-${slug(transfer.toTeam || "transfer")}`,
    playerId: player.id || slug(player.name),
    playerName: player.name,
    date: transfer.date || null,
    season: transfer.date ? `${String(transfer.date).slice(0, 4)}/${String(Number(String(transfer.date).slice(2, 4)) + 1).padStart(2, "0")}` : null,
    fromTeam: transfer.fromTeam || null,
    toTeam: transfer.toTeam || null,
    type: transfer.type || transfer.transferType || null,
    fee: transfer.feeLabel || null,
    feeEur: transfer.feeEur == null ? null : Number(transfer.feeEur),
    marketValueEur: transfer.marketValueEur == null ? null : Number(transfer.marketValueEur),
    source: transfer.source || "manual",
    note: transfer.note || ""
  };
}

async function getMatches(query) {
  const data = byLeague(matches.map(normalizeMatch), query && query.league);
  return data;
}

async function getMatchDetail(query) {
  const id = query && (query.fixtureId || query.id);
  const data = matches.map(normalizeMatchDetail);
  if (!id) {
    return data[0] || null;
  }

  const wanted = normalizeText(id);
  return data.find((match) => normalizeText(match.id) === wanted || normalizeText(match.fixtureId) === wanted) || null;
}

async function getStandings(query) {
  const data = byLeague(teams.map(normalizeStanding), query && query.league);
  return data.sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
}

async function getTeams(query) {
  let data = byLeague(teams.map(normalizeTeam), query && query.league);
  data = byTeam(data, query && query.team);
  data = bySearch(data, query && query.search);
  if (query && (query.teamId || query.id)) {
    const wanted = normalizeText(query.teamId || query.id);
    data = data.filter((team) => normalizeText(team.id).includes(wanted) || normalizeText(team.providerId).includes(wanted));
  }
  return data;
}

async function getSquad(query) {
  const teamQuery = query && (query.team || query.teamId || query.id);
  let data = players.map(normalizePlayer);

  if (teamQuery) {
    const wanted = normalizeText(teamQuery);
    data = data.filter((player) => {
      return normalizeText(player.currentTeam || player.team).includes(wanted) ||
        normalizeText(player.id).includes(wanted) ||
        normalizeText(player.providerId).includes(wanted);
    });
  }

  return data.map((player) => ({
    id: player.id,
    providerId: player.providerId,
    name: player.name,
    currentTeam: player.currentTeam || player.team,
    team: player.currentTeam || player.team,
    position: player.position,
    birthDate: player.birthDate || null,
    computedAge: player.computedAge || player.age || null,
    nationality: player.nationality || null,
    photo: player.photo || null,
    number: player.number || null,
    aiRating: player.aiRating || player.rating,
    source: "mock"
  }));
}

async function getPlayers(query) {
  const teamLeague = new Map(teams.map((team) => [team.name, team.league]));
  let data = players.map(normalizePlayer);

  if (query && query.league) {
    const wanted = normalizeText(query.league);
    data = data.filter((player) => normalizeText(player.league || teamLeague.get(player.currentTeam || player.team)) === wanted);
  }

  data = byTeam(data, query && query.team);
  data = bySearch(data, query && query.search);

  if (query && query.position) {
    const wanted = normalizeText(query.position);
    data = data.filter((player) => normalizeText(player.position).includes(wanted));
  }

  return byPage(data, query && query.page, query && query.pageSize);
}

async function getPlayerTransfers(query) {
  let data = players.map(normalizePlayer);

  if (query && query.playerId) {
    const wanted = normalizeText(query.playerId);
    data = data.filter((player) => normalizeText(player.id).includes(wanted) || normalizeText(player.providerId).includes(wanted));
  }

  data = byTeam(data, query && query.team);
  data = bySearch(data, query && query.search);

  return data.flatMap((player) => {
    return (player.transferHistory || []).map((transfer, index) => normalizeTransferRow(player, transfer, index));
  });
}

async function getMomentum(query) {
  const teamLeague = new Map(teams.map((team) => [team.name, team.league]));
  let data = momentum.map(normalizeMomentum);

  if (query && query.league) {
    const wanted = normalizeText(query.league);
    data = data.filter((row) => normalizeText(teamLeague.get(row.team)) === wanted);
  }

  return data;
}

async function getSignals() {
  return normalizeSignals(signals);
}

async function getAnalyses() {
  return analyses.map(normalizeAnalysis);
}

module.exports = {
  name: "mock",
  source,
  getMatches,
  getMatchDetail,
  getStandings,
  getTeams,
  getSquad,
  getPlayers,
  getPlayerTransfers,
  getMomentum,
  getSignals,
  getAnalyses,
  normalizeMatch,
  normalizeMatchDetail,
  normalizeStanding,
  normalizeTeam,
  normalizePlayer,
  normalizeTransferRow,
  normalizeMomentum,
  normalizeSignal,
  normalizeSignals,
  normalizeAnalysis
};
