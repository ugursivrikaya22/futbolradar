const matches = require("../../data/matches.json");
const teams = require("../../data/teams.json");
const players = require("../../data/players.json");
const momentum = require("../../data/momentum.json");
const signals = require("../../data/signals.json");
const analyses = require("../../data/analyses.json");
const { normalizeText } = require("../_utils");

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
  return {
    ...team,
    id: team.id || slug(team.name),
    rating: team.rating || team.momentum
  };
}

function normalizePlayer(player) {
  const rating = player.rating || player.aiRating || 0;
  const minutesPlayed = player.minutesPlayed || player.minutes || 0;

  return {
    ...player,
    id: player.id || slug(`${player.name}-${player.team}`),
    height: player.height || null,
    weight: player.weight || null,
    age: player.age || null,
    nationality: player.nationality || null,
    team: player.team || "",
    league: player.league || "",
    position: player.position || "",
    preferredFoot: player.preferredFoot || null,
    marketValue: player.marketValue || null,
    contractUntil: player.contractUntil || null,
    appearances: player.appearances || 0,
    goals: player.goals || 0,
    assists: player.assists || 0,
    minutesPlayed,
    minutes: player.minutes || minutesPlayed,
    yellowCards: player.yellowCards || 0,
    redCards: player.redCards || 0,
    passAccuracy: player.passAccuracy || null,
    shotsPerGame: player.shotsPerGame || null,
    tacklesPerGame: player.tacklesPerGame || null,
    interceptionsPerGame: player.interceptionsPerGame || null,
    rating,
    aiRating: player.aiRating || rating,
    overallRating: player.overallRating || rating,
    potentialRating: player.potentialRating || player.overallRating || rating,
    technicalRating: player.technicalRating || rating,
    physicalRating: player.physicalRating || rating,
    mentalRating: player.mentalRating || rating,
    defensiveRating: player.defensiveRating || rating,
    attackingRating: player.attackingRating || rating,
    passingRating: player.passingRating || rating,
    shootingRating: player.shootingRating || rating,
    paceRating: player.paceRating || rating,
    dribblingRating: player.dribblingRating || rating,
    staminaRating: player.staminaRating || rating,
    formRating: player.formRating || rating,
    providerId: player.providerId || `mock-${slug(`${player.name}-${player.team}`)}`,
    providerName: player.providerName || "FutbolRadar Mock",
    lastSyncedAt: player.lastSyncedAt || "2026-07-09T08:00:00+03:00",
    lastUpdated: player.lastUpdated || String(player.lastSyncedAt || "2026-07-09T08:00:00+03:00").slice(0, 10),
    radar: player.radar || {
      finishing: player.threatScore || rating,
      creativity: player.creativityScore || rating,
      pressing: player.pressingScore || rating,
      tempo: player.tempoScore || rating,
      consistency: player.continuityScore || rating
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
  return items.filter((item) => normalizeText(item.team || item.name).includes(wanted));
}

async function getMatches(query) {
  const data = byLeague(matches.map(normalizeMatch), query && query.league);
  return data;
}

async function getStandings(query) {
  const data = byLeague(teams.map(normalizeStanding), query && query.league);
  return data.sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
}

async function getTeams(query) {
  let data = byLeague(teams.map(normalizeTeam), query && query.league);
  data = byTeam(data, query && query.team);
  return data;
}

async function getPlayers(query) {
  const teamLeague = new Map(teams.map((team) => [team.name, team.league]));
  let data = players.map(normalizePlayer);

  if (query && query.league) {
    const wanted = normalizeText(query.league);
    data = data.filter((player) => normalizeText(player.league || teamLeague.get(player.team)) === wanted);
  }

  data = byTeam(data, query && query.team);

  if (query && query.position) {
    const wanted = normalizeText(query.position);
    data = data.filter((player) => normalizeText(player.position).includes(wanted));
  }

  return data;
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
  getStandings,
  getTeams,
  getPlayers,
  getMomentum,
  getSignals,
  getAnalyses,
  normalizeMatch,
  normalizeStanding,
  normalizeTeam,
  normalizePlayer,
  normalizeMomentum,
  normalizeSignal,
  normalizeSignals,
  normalizeAnalysis
};
