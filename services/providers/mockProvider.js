const matches = require("../../data/matches.json");
const teams = require("../../data/teams.json");
const players = require("../../data/players.json");
const transfers = require("../../data/transfers.json");
const momentum = require("../../data/momentum.json");
const signals = require("../../data/signals.json");
const analyses = require("../../data/analyses.json");
const { normalizeText } = require("../../api/_utils");
const { findCompetition, matchesCompetition, normalizeKey } = require("../competitionCatalog");
const { normalizePlayer: normalizePlayerRecord } = require("../playerService");

// Bu sağlayıcı artık yalnızca örnek veri sunmuyor: elle doğrulanmış
// editoryal maç kayıtlarını ve sağlayıcıdan senkronlanan fikstür takvimini
// birleştiriyor. "Mock API" etiketi yanıtı okuyanı yanıltıyordu.
const source = "FutbolRadar Doğrulanmış Veri";

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? null;
}

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function teamLogoByName(name) {
  const team = teams.find((item) => normalizeText(item.name) === normalizeText(name));
  return (team && team.logo) || "";
}

function normalizeMatch(match) {
  const homeMomentum = Number(match.homeMomentum || match.homeForm || 0);
  const awayMomentum = Number(match.awayMomentum || match.awayForm || 0);

  return {
    ...match,
    id: match.id || `${slug(match.homeTeam)}-${slug(match.awayTeam)}`,
    kickoff: match.kickoff || match.time || "",
    homeTeamLogo: match.homeTeamLogo || teamLogoByName(match.homeTeam),
    awayTeamLogo: match.awayTeamLogo || teamLogoByName(match.awayTeam),
    momentum: match.momentum || {
      side: homeMomentum >= awayMomentum ? "home" : "away",
      value: Math.abs(homeMomentum - awayMomentum)
    }
  };
}

function normalizeMatchDetail(match) {
  const normalized = normalizeMatch(match || {});
  const fallbackStatistics = [
    { team: normalized.homeTeam, type: "Momentum", value: normalized.homeMomentum || normalized.homeForm || null },
    { team: normalized.awayTeam, type: "Momentum", value: normalized.awayMomentum || normalized.awayForm || null },
    { team: normalized.homeTeam, type: "Goal potential", value: normalized.goalPotential || null }
  ].filter((item) => item.value !== null);

  return {
    ...normalized,
    fixtureId: normalized.providerId || normalized.id,
    status: normalized.status || "SCHEDULED",
    score: typeof normalized.score === "object" ? normalized.score : { home: null, away: null },
    lineups: Array.isArray(normalized.lineups) ? normalized.lineups : [],
    substitutions: Array.isArray(normalized.substitutions) ? normalized.substitutions : [],
    events: Array.isArray(normalized.events) ? normalized.events : [],
    statistics: Array.isArray(normalized.statistics) && normalized.statistics.length
      ? normalized.statistics
      : fallbackStatistics,
    prediction: normalized.prediction || (normalized.aiPrediction ? { label: normalized.aiPrediction, risk: normalized.risk || null } : null),
    source: normalized.source || "mock",
    updatedAt: firstDefined(normalized.updatedAt, normalized.lastVerifiedAt, normalized.fetchedAt, normalized.lastUpdatedAt)
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
  const rating = firstDefined(normalized.rating, normalized.aiRating, normalized.overallRating);
  const minutesPlayed = firstDefined(normalized.minutesPlayed, normalized.minutes);

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
    appearances: firstDefined(normalized.appearances, normalized.stats && normalized.stats.appearances),
    goals: firstDefined(normalized.goals, normalized.stats && normalized.stats.goals),
    assists: firstDefined(normalized.assists, normalized.stats && normalized.stats.assists),
    minutesPlayed,
    minutes: normalized.minutes || minutesPlayed,
    yellowCards: firstDefined(normalized.yellowCards, normalized.stats && normalized.stats.yellowCards),
    redCards: firstDefined(normalized.redCards, normalized.stats && normalized.stats.redCards),
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
    lastSyncedAt: firstDefined(normalized.lastSyncedAt, normalized.fetchedAt),
    lastUpdated: firstDefined(normalized.lastUpdated, normalized.lastUpdatedAt),
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

  // Curated rows store display names ("UEFA Şampiyonlar Ligi", "Hazırlık
  // Maçı") while the request carries a competition slug or a catalog name.
  // Exact string equality silently dropped every one of those rows, so the
  // catalog does the matching and `competitionId` is honoured directly.
  const competition = findCompetition(league);
  const wanted = normalizeText(league);

  return items.filter((item) => {
    if (competition) {
      return normalizeKey(item.competitionId) === competition.id
        || matchesCompetition(item.league, competition);
    }

    return normalizeText(item.league) === wanted;
  });
}

function todayInTimeZone(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function matchDateOnly(match) {
  const value = match && (match.kickoff || match.date || match.utcDate);
  if (!value) {
    return "";
  }

  return String(value).slice(0, 10);
}

// Fikstür takvimi (scripts/sync-fixture-calendar.mjs çıktısı) opsiyoneldir:
// dosya yoksa ya da bozuksa kürasyonlu veri tek başına çalışmaya devam eder.
function fixtureCalendarMatches() {
  try {
    const calendar = require("../../data/fixture-calendar.json");
    return Array.isArray(calendar && calendar.matches) ? calendar.matches : [];
  } catch (error) {
    return [];
  }
}

const MATCH_STATE_RANK = { SCHEDULED: 0, TIMED: 0, POSTPONED: 0, CANCELLED: 0, LIVE: 1, FINISHED: 2 };

function matchStateRank(status) {
  return MATCH_STATE_RANK[String(status || "").toUpperCase()] ?? 0;
}

function matchIdentity(match) {
  const date = matchDateOnly(match);
  return `${normalizeText(match && match.homeTeam)}|${normalizeText(match && match.awayTeam)}|${date}`;
}

function hasFinalScore(match) {
  const score = match && match.score;
  return Boolean(score) && score.home !== null && score.home !== undefined && score.away !== null && score.away !== undefined;
}

/**
 * Elle doğrulanmış maçlar (data/matches.json) ile sağlayıcı takvimi
 * (data/fixture-calendar.json) tek listede birleşir.
 *
 * Kural: kimlik ve editoryal alanlar (analiz, özet, kaynaklar) her zaman
 * kürasyonlu kayda aittir; sağlayıcı yalnızca maç *durumunu* ileri taşır.
 * Böylece kürasyonlu veri bir gün geride kaldığında biten maç "oynanacak"
 * görünmez, ama doğrulanmış bir skor da asla sağlayıcı tahminiyle ezilmez.
 */
function curatedMatches() {
  const merged = new Map();

  for (const match of matches) {
    merged.set(matchIdentity(match), match);
  }

  for (const calendarMatch of fixtureCalendarMatches()) {
    const key = matchIdentity(calendarMatch);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, calendarMatch);
      continue;
    }

    const advances = matchStateRank(calendarMatch.status) > matchStateRank(existing.status);
    if (!advances || hasFinalScore(existing)) {
      continue;
    }

    merged.set(key, {
      ...existing,
      status: calendarMatch.status,
      score: hasFinalScore(calendarMatch) ? { ...existing.score, ...calendarMatch.score } : existing.score,
      venue: existing.venue || calendarMatch.venue || null,
      providerId: existing.providerId || calendarMatch.providerId || "",
      liveStateSource: calendarMatch.source || "provider"
    });
  }

  return [...merged.values()];
}

function byMatchDate(items, date) {
  const targetDate = date || todayInTimeZone("Europe/Istanbul");

  return items.filter((item) => matchDateOnly(item) === targetDate);
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

function normalizeCuratedTransfer(transfer, index) {
  return {
    ...transfer,
    id: transfer.id || `${transfer.playerId || slug(transfer.playerName)}-${transfer.date || index}-${slug(transfer.toTeam)}`,
    playerId: transfer.playerId || slug(transfer.playerName),
    season: transfer.season || (transfer.date ? `${String(transfer.date).slice(0, 4)}/${String(Number(String(transfer.date).slice(2, 4)) + 1).padStart(2, "0")}` : null),
    fee: transfer.fee || null,
    feeEur: transfer.feeEur == null ? null : Number(transfer.feeEur),
    marketValueEur: transfer.marketValueEur == null ? null : Number(transfer.marketValueEur),
    status: transfer.status || "confirmed",
    confidence: transfer.confidence == null ? null : Number(transfer.confidence),
    source: transfer.sourceName || transfer.source || "FutbolRadar transfer takibi",
    sourceName: transfer.sourceName || transfer.source || "FutbolRadar transfer takibi",
    sourceUrl: transfer.sourceUrl || null,
    lastVerifiedAt: transfer.lastVerifiedAt || null
  };
}

function transferRecordKey(transfer) {
  return [
    normalizeText(transfer.playerId || transfer.playerName),
    String(transfer.date || transfer.season || ""),
    normalizeText(transfer.fromTeam),
    normalizeText(transfer.toTeam)
  ].join("|");
}

async function getMatches(query) {
  const normalized = curatedMatches().map(normalizeMatch);
  const byDate = byMatchDate(normalized, query && query.date);
  const data = byLeague(byDate, query && query.league);
  return data;
}

async function getMatchDetail(query) {
  const id = query && (query.fixtureId || query.id);
  const data = curatedMatches().map(normalizeMatchDetail);
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
  const curated = transfers.map(normalizeCuratedTransfer);
  const playerHistory = players.map(normalizePlayer).flatMap((player) => {
    return (player.transferHistory || []).map((transfer, index) => normalizeTransferRow(player, transfer, index));
  });
  const includeHistory = query && String(query.includeHistory || "").toLowerCase() === "true";
  const seen = new Set();
  let data = (includeHistory ? curated.concat(playerHistory) : curated).filter((transfer) => {
    const key = transferRecordKey(transfer);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (query && query.playerId) {
    const wanted = normalizeText(query.playerId);
    data = data.filter((transfer) => normalizeText(transfer.playerId).includes(wanted));
  }

  if (query && query.team) {
    const wanted = normalizeText(query.team);
    data = data.filter((transfer) => normalizeText(transfer.fromTeam).includes(wanted) || normalizeText(transfer.toTeam).includes(wanted));
  }

  if (query && query.search) {
    const wanted = normalizeText(query.search);
    data = data.filter((transfer) => [transfer.playerName, transfer.fromTeam, transfer.toTeam].some((value) => normalizeText(value).includes(wanted)));
  }

  return data.sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
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
