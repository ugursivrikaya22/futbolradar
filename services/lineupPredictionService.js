const { positionGroup } = require("./ratingService");

const FORMATION_TEMPLATE = [
  { slot: "GK", group: "goalkeeper", count: 1 },
  { slot: "DEF", group: "defender", count: 4 },
  { slot: "MID", group: "midfielder", count: 3 },
  { slot: "WING", group: "winger", count: 2 },
  { slot: "FWD", group: "forward", count: 1 }
];
const STARTING_XI_SIZE = FORMATION_TEMPLATE.reduce((sum, slot) => sum + slot.count, 0);
const FALLBACK_GROUP_ORDER = ["midfielder", "winger", "forward", "defender", "goalkeeper"];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim()
    .toLowerCase();
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function playerRating(player) {
  const value = Number(player && (player.overallRating ?? player.aiRating ?? player.rating ?? (player.radar && player.radar.overall)));
  return Number.isFinite(value) ? value : null;
}

function isDeparted(player, teamName) {
  return normalizeText(player.currentTeam || player.team) !== normalizeText(teamName);
}

function isPendingTransfer(player) {
  return normalizeText(player.transferStatus) === "pending" || player.pendingTransfer === true;
}

/**
 * No injury/suspension feed exists yet, so availability is "unknown" unless a
 * player record explicitly carries an availabilityStatus. Unknown must never
 * be treated as unavailable (would wrongly zero out real players) nor as a
 * clean bill of health (must lower confidence honestly).
 */
function buildAvailabilitySummary(team, fixture) {
  const players = Array.isArray(team && team.players) ? team.players : [];
  const teamName = team && team.name;
  const eligible = players.filter((player) => !isDeparted(player, teamName) && !isPendingTransfer(player));

  const rows = eligible.map((player) => {
    const status = normalizeText(player.availabilityStatus) || "unknown";
    return {
      playerId: player.id || null,
      name: player.name,
      status: ["available", "injured", "suspended", "doubtful"].includes(status) ? status : "unknown",
      note: player.availabilityNote || null
    };
  });

  const known = rows.filter((row) => row.status !== "unknown");
  const unavailable = rows.filter((row) => row.status === "injured" || row.status === "suspended");

  return {
    fixtureId: fixture && (fixture.id || fixture.fixtureId) || null,
    totalKnownPlayers: players.length,
    unavailableCount: unavailable.length,
    unavailable,
    knownAvailabilityCoverage: rows.length ? Math.round((known.length / rows.length) * 100) : 0,
    rows
  };
}

function eligibleSquad(team, availability) {
  const players = Array.isArray(team && team.players) ? team.players : [];
  const teamName = team && team.name;
  const unavailableIds = new Set((availability ? availability.unavailable : []).map((row) => row.playerId).filter(Boolean));

  return players.filter((player) => {
    if (isDeparted(player, teamName)) return false;
    if (isPendingTransfer(player)) return false;
    if (player.id && unavailableIds.has(player.id)) return false;
    return true;
  });
}

/**
 * Starter records only ever need a lean, display-safe subset — the full
 * enriched player object carries dozens of internal/editorial fields
 * (sourceNote, transferHistory, dataConflict, ...) that don't belong in the
 * persisted match-analysis snapshot.
 */
function toLeanStarter(player, slot, assignedGroup, outOfPosition) {
  return {
    id: player.id || null,
    name: player.name,
    position: player.position || null,
    slot,
    assignedGroup,
    outOfPosition: Boolean(outOfPosition),
    overallRating: playerRating(player),
    formRating: (() => {
      const value = Number(player.radar && player.radar.form);
      return Number.isFinite(value) ? value : playerRating(player);
    })(),
    profileUrl: player.id ? `./oyuncular/${player.id}.html` : null
  };
}

function fillSlot(pool, group, count, selectedIds) {
  const candidates = pool
    .filter((player) => positionGroup(player.position) === group && !selectedIds.has(player.id || player.name))
    .sort((left, right) => (playerRating(right) ?? -1) - (playerRating(left) ?? -1));

  const picked = candidates.slice(0, count);
  picked.forEach((player) => selectedIds.add(player.id || player.name));
  return picked;
}

function fillFromFallback(pool, need, selectedIds, primaryGroup) {
  if (need <= 0) return [];
  const order = FALLBACK_GROUP_ORDER.filter((group) => group !== primaryGroup);
  const picked = [];

  for (const group of order) {
    if (picked.length >= need) break;
    const candidates = pool
      .filter((player) => positionGroup(player.position) === group && !selectedIds.has(player.id || player.name))
      .sort((left, right) => (playerRating(right) ?? -1) - (playerRating(left) ?? -1));
    for (const player of candidates) {
      if (picked.length >= need) break;
      selectedIds.add(player.id || player.name);
      picked.push(toLeanStarter(player, null, primaryGroup, true));
    }
  }

  return picked;
}

function generateProbableLineupForFixture(team, fixture, context) {
  const teamName = team && team.name;
  const availability = buildAvailabilitySummary(team, fixture);
  const pool = eligibleSquad(team, availability);
  const selectedIds = new Set();
  const starters = [];

  FORMATION_TEMPLATE.forEach(({ slot, group, count }) => {
    const filled = fillSlot(pool, group, count, selectedIds);
    filled.forEach((player) => starters.push(toLeanStarter(player, slot, group, false)));

    const shortfall = count - filled.length;
    if (shortfall > 0) {
      const fallback = fillFromFallback(pool, shortfall, selectedIds, group);
      fallback.forEach((player) => starters.push({ ...player, slot }));
    }
  });

  const knownCount = starters.length;
  const coverage = clamp(Math.round((knownCount / STARTING_XI_SIZE) * 100), 0, 100);
  const contextConfidence = context && Number.isFinite(context.confidence) ? context.confidence : null;
  const availabilityPenalty = availability.knownAvailabilityCoverage < 50 ? 15 : 0;
  const confidenceParts = [coverage, contextConfidence].filter((value) => value !== null);
  const confidence = clamp(
    Math.round((confidenceParts.reduce((sum, value) => sum + value, 0) / (confidenceParts.length || 1)) - availabilityPenalty),
    0,
    100
  );

  const status = fixture && fixture.officialLineups && fixture.officialLineups[team && team.side]
    ? "official"
    : "probable";

  let predictionStatus = "available";
  if (knownCount === 0) {
    predictionStatus = "unavailable";
  } else if (coverage < 55 || confidence < 40) {
    predictionStatus = "low-confidence";
  }

  return {
    fixtureId: fixture && (fixture.id || fixture.fixtureId) || null,
    teamName,
    status,
    label: status === "official" ? "Resmî İlk 11" : "Muhtemel İlk 11",
    formation: FORMATION_TEMPLATE.filter((item) => item.group !== "goalkeeper").map((item) => `${item.count}`).join("-"),
    predictionStatus,
    knownStarterCount: knownCount,
    requiredStarterCount: STARTING_XI_SIZE,
    coverage,
    confidence,
    starters,
    availability,
    warnings: [
      ...(knownCount === 0 ? ["no-known-squad-data"] : []),
      ...(knownCount > 0 && knownCount < STARTING_XI_SIZE ? ["incomplete-starting-xi-known"] : []),
      ...(starters.some((player) => player.outOfPosition) ? ["out-of-position-selection-used"] : []),
      ...(availability.knownAvailabilityCoverage < 50 ? ["availability-largely-unknown"] : [])
    ]
  };
}

function computeLineupStrength(lineup) {
  if (!lineup || !Array.isArray(lineup.starters) || !lineup.starters.length) {
    return { score: null, confidence: 0, sampleSize: 0 };
  }

  const ratings = lineup.starters.map(playerRating).filter((value) => value !== null);
  if (!ratings.length) {
    return { score: null, confidence: 0, sampleSize: 0 };
  }

  const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  const coverage = lineup.coverage ?? clamp(Math.round((ratings.length / STARTING_XI_SIZE) * 100), 0, 100);

  return {
    score: Math.round(average),
    confidence: clamp(Math.round(coverage * 0.7 + (lineup.confidence || 0) * 0.3), 0, 100),
    sampleSize: ratings.length
  };
}

function computeBenchStrength(squad, lineup) {
  const players = Array.isArray(squad) ? squad : [];
  const starterIds = new Set((lineup && lineup.starters || []).map((player) => player.id || player.name));
  // Yalnızca "ilk 11'de değil" bench yapmaz: sakat/cezalı bir oyuncu da ilk
  // 11'de değildir ama SAHAYA ÇIKAMAZ. Aynı uygunluk listesi (`eligibleSquad`
  // ilk 11'i seçerken de bunu kullanıyor) burada da uygulanmazsa, sakatlığı
  // yüzden ilk 11 dışında kalan bir oyuncu "yedek adayı" gibi görünür.
  const unavailableIds = new Set(
    ((lineup && lineup.availability && lineup.availability.unavailable) || [])
      .map((row) => row.playerId)
      .filter(Boolean)
  );
  const bench = players.filter((player) => {
    const key = player.id || player.name;
    if (starterIds.has(key)) return false;
    if (player.id && unavailableIds.has(player.id)) return false;
    return true;
  });

  if (!bench.length) {
    return { score: null, confidence: 0, sampleSize: 0, players: [] };
  }

  const ratings = bench.map(playerRating).filter((value) => value !== null);
  if (!ratings.length) {
    return { score: null, confidence: 0, sampleSize: 0, players: bench.map((player) => player.name) };
  }

  const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  return {
    score: Math.round(average),
    confidence: clamp(Math.round((ratings.length / Math.max(bench.length, 1)) * 100), 0, 100),
    sampleSize: ratings.length,
    players: bench.map((player) => player.name)
  };
}

function detectMissingKeyPlayers(team, lineup, squad) {
  const players = Array.isArray(squad) ? squad : [];
  const starterIds = new Set((lineup && lineup.starters || []).map((player) => player.id || player.name));
  const ranked = players
    .filter((player) => (playerRating(player) ?? 0) > 0)
    .sort((left, right) => (playerRating(right) ?? 0) - (playerRating(left) ?? 0));

  return ranked
    .filter((player) => !starterIds.has(player.id || player.name))
    .slice(0, 3)
    .map((player) => ({
      playerId: player.id || null,
      name: player.name,
      position: player.position || null,
      overall: playerRating(player),
      reason: isDeparted(player, team && team.name)
        ? "departed"
        : isPendingTransfer(player)
          ? "pending-transfer"
          : normalizeText(player.availabilityStatus) === "injured"
            ? "injured"
            : normalizeText(player.availabilityStatus) === "suspended"
              ? "suspended"
              : "rotation-or-unknown"
    }));
}

function compareProbableAndOfficialLineup(probable, official) {
  const probableIds = new Set((probable && probable.starters || []).map((player) => player.id || player.name));
  const officialIds = new Set((official && official.starters || []).map((player) => player.id || player.name));

  if (!officialIds.size) {
    return { available: false, matches: 0, total: 0, accuracy: null, matchedPlayers: [], missedPlayers: [] };
  }

  const matchedPlayers = [...officialIds].filter((id) => probableIds.has(id));
  const missedPlayers = [...officialIds].filter((id) => !probableIds.has(id));

  return {
    available: true,
    matches: matchedPlayers.length,
    total: officialIds.size,
    accuracy: Math.round((matchedPlayers.length / officialIds.size) * 100),
    matchedPlayers,
    missedPlayers
  };
}

module.exports = {
  generateProbableLineupForFixture,
  buildAvailabilitySummary,
  computeLineupStrength,
  computeBenchStrength,
  detectMissingKeyPlayers,
  compareProbableAndOfficialLineup,
  STARTING_XI_SIZE,
  FORMATION_TEMPLATE
};
