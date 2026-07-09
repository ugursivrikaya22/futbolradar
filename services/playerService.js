const players = require("../data/players.json");

const DEFAULT_SOURCE_NOTE = "FutbolRadar tahmini ve manuel veri kontrolü";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .trim()
    .toLowerCase();
}

function slug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function calculateAge(birthDate, atDate) {
  if (!birthDate) {
    return null;
  }

  const date = new Date(`${birthDate}T00:00:00Z`);
  const now = atDate ? new Date(atDate) : new Date();
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) {
    return null;
  }

  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - date.getUTCMonth();
  const dayDiff = now.getUTCDate() - date.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

function formatMarketValueEur(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  if (number >= 1000000) {
    return `${Number((number / 1000000).toFixed(1)).toLocaleString("en-US")}M EUR`;
  }

  if (number >= 1000) {
    return `${Number((number / 1000).toFixed(0)).toLocaleString("en-US")}K EUR`;
  }

  return `${number.toLocaleString("en-US")} EUR`;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeTransferHistory(history) {
  return normalizeArray(history).map((item) => ({
    date: item.date || null,
    fromTeam: item.fromTeam || item.from || null,
    toTeam: item.toTeam || item.to || null,
    feeEur: item.feeEur == null ? null : Number(item.feeEur),
    feeLabel: item.feeLabel || formatMarketValueEur(item.feeEur) || "Bilinmiyor",
    source: item.source || "manual",
    note: item.note || ""
  }));
}

function normalizePlayer(player, options) {
  const atDate = options && options.atDate ? options.atDate : undefined;
  const id = player.id || player.slug || slug(player.name);
  const currentTeam = player.currentTeam || player.team || "";
  const computedAge = calculateAge(player.birthDate, atDate);
  const height = player.height || (player.heightCm ? `${player.heightCm} cm` : null);
  const marketValue = player.marketValue || formatMarketValueEur(player.marketValueEur);
  const formerTeams = normalizeArray(player.formerTeams).filter((team) => normalizeText(team) !== normalizeText(currentTeam));
  const rating = player.rating || player.aiRating || player.overallRating || null;
  const minutesPlayed = player.minutesPlayed || player.minutes || 0;

  return {
    ...player,
    id,
    slug: player.slug || id,
    fullName: player.fullName || player.name,
    currentTeam,
    team: currentTeam,
    formerTeams,
    transferHistory: normalizeTransferHistory(player.transferHistory),
    birthDate: player.birthDate || null,
    computedAge,
    age: computedAge || player.age || null,
    height,
    heightCm: player.heightCm || null,
    marketValue,
    marketValueEur: player.marketValueEur == null ? null : Number(player.marketValueEur),
    secondaryPosition: player.secondaryPosition || "",
    dataStatus: player.dataStatus || "mock_needs_verification",
    ratingStatus: player.ratingStatus || "estimated",
    sourceNote: player.sourceNote || DEFAULT_SOURCE_NOTE,
    providerName: player.providerName || "FutbolRadar Mock Player Provider",
    providerId: player.providerId || `mock-${id}`,
    lastUpdated: player.lastUpdated || new Date().toISOString().slice(0, 10),
    transferUpdatedAt: player.transferUpdatedAt || player.lastUpdated || new Date().toISOString().slice(0, 10),
    lastSyncedAt: player.lastSyncedAt || new Date().toISOString(),
    minutesPlayed,
    minutes: player.minutes || minutesPlayed,
    rating,
    aiRating: player.aiRating || rating,
    overallRating: player.overallRating || rating
  };
}

function getPlayers(rawPlayers, options) {
  return (Array.isArray(rawPlayers) ? rawPlayers : players).map((player) => normalizePlayer(player, options));
}

function getPlayerBySlug(playerSlug, rawPlayers, options) {
  const wanted = slug(playerSlug);
  return getPlayers(rawPlayers, options).find((player) => player.slug === wanted || player.id === wanted) || null;
}

function ratingFields() {
  return [
    "rating",
    "aiRating",
    "overallRating",
    "potentialRating",
    "technicalRating",
    "physicalRating",
    "mentalRating",
    "defensiveRating",
    "attackingRating",
    "passingRating",
    "shootingRating",
    "paceRating",
    "dribblingRating",
    "staminaRating",
    "formRating",
    "threatScore",
    "creativityScore",
    "pressingScore",
    "continuityScore",
    "tempoScore"
  ];
}

function validatePlayerData(rawPlayers) {
  const errors = [];
  const warnings = [];
  const seenIds = new Set();
  const list = getPlayers(rawPlayers);

  list.forEach((player, index) => {
    const label = player.name || `index ${index}`;
    if (!player.id || !player.name) {
      errors.push(`${label}: id ve name zorunlu.`);
    }

    if (seenIds.has(player.id)) {
      errors.push(`${label}: duplicate player id ${player.id}.`);
    }
    seenIds.add(player.id);

    if (!player.currentTeam) {
      errors.push(`${label}: currentTeam eksik.`);
    }

    if (!player.position) {
      errors.push(`${label}: position eksik.`);
    }

    if (!player.birthDate) {
      warnings.push(`${label}: birthDate eksik, yaş dinamik hesaplanamaz.`);
    } else if (calculateAge(player.birthDate) == null) {
      errors.push(`${label}: birthDate geçersiz.`);
    }

    if (!player.lastUpdated) {
      warnings.push(`${label}: lastUpdated eksik.`);
    }

    if (!player.transferUpdatedAt) {
      warnings.push(`${label}: transferUpdatedAt eksik.`);
    }

    if (player.formerTeams.some((team) => normalizeText(team) === normalizeText(player.currentTeam))) {
      errors.push(`${label}: currentTeam formerTeams içinde olmamalı.`);
    }

    if (player.marketValueEur != null && (!Number.isFinite(Number(player.marketValueEur)) || Number(player.marketValueEur) < 0)) {
      errors.push(`${label}: marketValueEur sayı olmalı.`);
    }

    ratingFields().forEach((field) => {
      const value = player[field];
      if (value != null && value !== "" && (Number(value) < 0 || Number(value) > 100)) {
        errors.push(`${label}: ${field} 0-100 aralığında olmalı.`);
      }
    });

    player.transferHistory.forEach((transfer, transferIndex) => {
      if (!transfer.date || !transfer.toTeam) {
        errors.push(`${label}: transferHistory[${transferIndex}] date ve toTeam içermeli.`);
      }
    });
  });

  return { ok: errors.length === 0, errors, warnings };
}

function updatePlayerTransfer(rawPlayers, update, now) {
  const list = Array.isArray(rawPlayers) ? rawPlayers : players;
  const playerSlug = update.playerSlug || update.id || update.slug;
  const wanted = slug(playerSlug);
  const updatedAt = now || new Date().toISOString().slice(0, 10);

  return list.map((player) => {
    const id = player.id || player.slug || slug(player.name);
    if (id !== wanted) {
      return player;
    }

    const currentTeam = update.toTeam || update.currentTeam;
    const previousTeam = update.fromTeam || player.currentTeam || player.team || "";
    const formerTeams = normalizeArray(player.formerTeams).concat(previousTeam).filter(Boolean);
    const transferHistory = normalizeArray(player.transferHistory).concat({
      date: update.date || updatedAt,
      fromTeam: previousTeam || null,
      toTeam: currentTeam,
      feeEur: update.feeEur == null ? null : Number(update.feeEur),
      feeLabel: update.feeLabel || formatMarketValueEur(update.feeEur) || "Bilinmiyor",
      source: update.source || "manual",
      note: update.note || ""
    });

    return {
      ...player,
      currentTeam,
      team: currentTeam,
      league: update.league || player.league,
      contractUntil: update.contractUntil || player.contractUntil,
      formerTeams: Array.from(new Set(formerTeams.filter((team) => normalizeText(team) !== normalizeText(currentTeam)))),
      transferHistory,
      transferUpdatedAt: updatedAt,
      lastUpdated: updatedAt,
      dataStatus: update.dataStatus || "manually_verified"
    };
  });
}

module.exports = {
  calculateAge,
  formatMarketValueEur,
  getPlayerBySlug,
  getPlayers,
  normalizePlayer,
  normalizeText,
  slug,
  updatePlayerTransfer,
  validatePlayerData
};
