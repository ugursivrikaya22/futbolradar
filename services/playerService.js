const players = require("../data/players.json");
const {
  computeOverallRating,
  computePlayerRadar,
  deriveStrengths,
  deriveWeaknesses,
  positionGroup: resolvePositionGroup
} = require("./ratingService");

const DEFAULT_SOURCE_NOTE = "FutbolRadar tahmini ve manuel veri kontrolü";

const VALID_DATA_STATUSES = new Set([
  "verified",
  "manual",
  "manually_verified",
  "provider",
  "stale",
  "estimated",
  "pending",
  "manual-review",
  "mock_needs_verification",
  "transfer_needs_monitoring"
]);
const VALID_RATING_STATUSES = new Set(["verified", "manual", "provider", "estimated", "pending", "stale"]);

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

function normalizeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeStats(player) {
  const stats = player.stats && typeof player.stats === "object" ? player.stats : {};

  return {
    appearances: normalizeNumber(stats.appearances ?? player.appearances, 0),
    goals: normalizeNumber(stats.goals ?? player.goals, 0),
    assists: normalizeNumber(stats.assists ?? player.assists, 0),
    minutesPlayed: normalizeNumber(stats.minutesPlayed ?? player.minutesPlayed ?? player.minutes, 0),
    minutes: normalizeNumber(stats.minutes ?? stats.minutesPlayed ?? player.minutes ?? player.minutesPlayed, 0),
    yellowCards: normalizeNumber(stats.yellowCards ?? player.yellowCards, 0),
    redCards: normalizeNumber(stats.redCards ?? player.redCards, 0),
    passAccuracy: normalizeNumber(stats.passAccuracy ?? player.passAccuracy, null),
    shotsPerGame: normalizeNumber(stats.shotsPerGame ?? player.shotsPerGame, null),
    tacklesPerGame: normalizeNumber(stats.tacklesPerGame ?? player.tacklesPerGame, null),
    interceptionsPerGame: normalizeNumber(stats.interceptionsPerGame ?? player.interceptionsPerGame, null),
    shots: normalizeNumber(stats.shots ?? player.shots, 0),
    keyPasses: normalizeNumber(stats.keyPasses ?? player.keyPasses, 0),
    xg: normalizeNumber(stats.xg ?? player.xg, 0),
    xa: normalizeNumber(stats.xa ?? player.xa, 0),
    duelsWon: normalizeNumber(stats.duelsWon ?? player.duelsWon ?? player.duels, 0),
    pressures: normalizeNumber(stats.pressures ?? player.pressures ?? player.press, 0),
    cleanSheets: normalizeNumber(stats.cleanSheets ?? player.cleanSheets, 0),
    goalsConceded: normalizeNumber(stats.goalsConceded ?? player.goalsConceded, 0)
  };
}

function normalizeSource(player) {
  const source = player.source && typeof player.source === "object" ? player.source : {};

  return {
    provider: source.provider || player.providerName || "FutbolRadar Mock Player Provider",
    providerId: source.providerId || player.providerId || null,
    status: source.status || player.dataStatus || "mock_needs_verification",
    ratingStatus: source.ratingStatus || player.ratingStatus || "estimated",
    lastSyncedAt: source.lastSyncedAt || player.lastSyncedAt || new Date().toISOString(),
    note: source.note || player.sourceNote || DEFAULT_SOURCE_NOTE
  };
}

function normalizeSimilarPlayers(value) {
  return normalizeArray(value).map((item) => {
    if (typeof item === "string") {
      return { id: slug(item), name: item, reason: "Benzer rol profili" };
    }

    return {
      id: item.id || item.slug || slug(item.name || item.playerName),
      name: item.name || item.playerName || item.id || "",
      reason: item.reason || item.note || "Benzer radar profili",
      score: item.score == null ? null : Number(item.score)
    };
  }).filter((item) => item.id || item.name);
}

function normalizeRadar(player, base, context) {
  const computed = computePlayerRadar(base, context || {});
  const group = base.positionGroup || resolvePositionGroup(base.position);
  const overall = computeOverallRating(computed, group, base);

  return {
    ...(player.radar || {}),
    ...computed,
    overall
  };
}

function normalizeTransferHistory(history) {
  return normalizeArray(history).map((item) => ({
    date: item.date || null,
    fromTeam: item.fromTeam || item.from || null,
    toTeam: item.toTeam || item.to || null,
    type: item.type || item.transferType || inferTransferType(item),
    feeEur: item.feeEur == null ? null : Number(item.feeEur),
    feeLabel: item.feeLabel || formatMarketValueEur(item.feeEur) || "Bilinmiyor",
    source: item.source || "manual",
    note: item.note || ""
  }));
}

function inferTransferType(item) {
  if (!item) {
    return null;
  }

  const feeLabel = String(item.feeLabel || "").toLowerCase();
  if (feeLabel === "academy") {
    return "Altyapı";
  }

  if (feeLabel === "free" || Number(item.feeEur) === 0) {
    return "Serbest transfer";
  }

  if (Number(item.feeEur) > 0) {
    return "Bonservis";
  }

  return null;
}

function normalizePlayer(player, options) {
  const atDate = options && options.atDate ? options.atDate : undefined;
  const id = player.id || player.slug || slug(player.name);
  const currentTeam = player.currentTeam || player.team || "";
  const computedAge = calculateAge(player.birthDate, atDate);
  const height = player.height || (player.heightCm ? `${player.heightCm} cm` : null);
  const marketValue = player.marketValue || formatMarketValueEur(player.marketValueEur);
  const formerTeams = normalizeArray(player.formerTeams).filter((team) => normalizeText(team) !== normalizeText(currentTeam));
  const stats = normalizeStats(player);
  const rawRating = player.rating || player.aiRating || player.overallRating || null;
  const minutesPlayed = stats.minutesPlayed;
  const positionGroup = player.positionGroup || resolvePositionGroup(player.position);
  const source = normalizeSource({
    ...player,
    currentTeam,
    providerId: player.providerId || `mock-${id}`
  });
  const base = {
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
    source,
    positionGroup,
    stats,
    minutesPlayed,
    minutes: player.minutes || minutesPlayed,
    appearances: stats.appearances,
    goals: stats.goals,
    assists: stats.assists,
    yellowCards: stats.yellowCards,
    redCards: stats.redCards,
    passAccuracy: stats.passAccuracy,
    shotsPerGame: stats.shotsPerGame,
    tacklesPerGame: stats.tacklesPerGame,
    interceptionsPerGame: stats.interceptionsPerGame,
    shots: stats.shots,
    keyPasses: stats.keyPasses,
    xg: stats.xg,
    xa: stats.xa,
    duelsWon: stats.duelsWon,
    duels: player.duels || stats.duelsWon,
    pressures: stats.pressures,
    press: player.press || stats.pressures,
    rating: rawRating,
    aiRating: player.aiRating || rawRating,
    overallRating: player.overallRating || rawRating
  };

  const radar = normalizeRadar(player, base, options && options.context);
  const manualRating = isProtectedStatus(base.ratingStatus) && Number.isFinite(Number(rawRating));
  const rating = manualRating ? Number(rawRating) : radar.overall;

  return {
    ...base,
    rating: base.rating || rating,
    aiRating: rating,
    overallRating: rating,
    radar: {
      ...radar,
      overall: rating
    },
    ratingComponents: {
      ...radar,
      overall: rating
    },
    strengths: deriveStrengths(base, radar),
    weaknesses: deriveWeaknesses(base, radar),
    similarPlayers: normalizeSimilarPlayers(player.similarPlayers),
    dataConflict: player.dataConflict || null,
    transferConflict: player.transferConflict || null
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

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function isProtectedStatus(status) {
  const normalized = normalizeText(status);
  return normalized.includes("manual") || normalized.includes("verified");
}

function conflictObject(field, localValue, providerValue, providerName) {
  return {
    field,
    localValue,
    providerValue,
    provider: providerName || "provider",
    detectedAt: new Date().toISOString()
  };
}

function transferKey(transfer) {
  return [
    String(transfer.date || "").slice(0, 10),
    normalizeText(transfer.fromTeam),
    normalizeText(transfer.toTeam),
    normalizeText(transfer.type)
  ].join("|");
}

function mergeTransferHistory(localHistory, providerHistory) {
  const local = normalizeTransferHistory(localHistory);
  const provider = normalizeTransferHistory(providerHistory).map((transfer) => ({
    ...transfer,
    source: transfer.source || "provider"
  }));
  const seen = new Set(local.map(transferKey));
  const merged = local.slice();

  provider.forEach((transfer) => {
    const key = transferKey(transfer);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(transfer);
    }
  });

  return merged.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function mergePlayerWithProvider(localPlayer, providerPlayer, providerName) {
  const local = localPlayer ? normalizePlayer(localPlayer) : null;
  const provider = providerPlayer ? normalizePlayer(providerPlayer) : null;

  if (!local && provider) {
    return normalizePlayer({
      ...provider,
      dataStatus: provider.dataStatus || "provider",
      ratingStatus: provider.ratingStatus || "provider",
      providerName: providerName || provider.providerName || "provider"
    });
  }

  if (!provider) {
    return local;
  }

  const protectedData = isProtectedStatus(local.dataStatus);
  const protectedRating = isProtectedStatus(local.ratingStatus);
  const merged = {
    ...local,
    providerSnapshot: {
      provider: providerName || provider.providerName || "provider",
      providerId: provider.providerId || provider.id || null,
      lastSyncedAt: provider.lastSyncedAt || new Date().toISOString()
    }
  };

  [
    "providerId",
    "providerName",
    "photo",
    "height",
    "weight",
    "birthDate",
    "nationality",
    "preferredFoot",
    "contractUntil",
    "marketValueEur",
    "marketValue",
    "league",
    "position"
  ].forEach((field) => {
    if (!hasValue(merged[field]) && hasValue(provider[field])) {
      merged[field] = provider[field];
    }
  });

  if (hasValue(provider.currentTeam) && normalizeText(provider.currentTeam) !== normalizeText(local.currentTeam)) {
    if (protectedData) {
      merged.dataConflict = conflictObject("currentTeam", local.currentTeam, provider.currentTeam, providerName);
    } else {
      merged.currentTeam = provider.currentTeam;
      merged.team = provider.currentTeam;
      merged.dataStatus = provider.dataStatus || "provider";
    }
  }

  if (!protectedRating) {
    ratingFields().forEach((field) => {
      if (hasValue(provider[field])) {
        merged[field] = provider[field];
      }
    });
    merged.ratingStatus = provider.ratingStatus || merged.ratingStatus || "provider";
  }

  ["appearances", "minutesPlayed", "minutes", "goals", "assists", "yellowCards", "redCards"].forEach((field) => {
    if (!hasValue(merged[field]) && hasValue(provider[field])) {
      merged[field] = provider[field];
    }
  });

  if (provider.stats && typeof provider.stats === "object") {
    merged.stats = { ...(provider.stats || {}), ...(merged.stats || {}) };
  }

  merged.formerTeams = Array.from(new Set(normalizeArray(local.formerTeams).concat(normalizeArray(provider.formerTeams))))
    .filter((team) => normalizeText(team) !== normalizeText(merged.currentTeam));
  merged.transferHistory = mergeTransferHistory(local.transferHistory, provider.transferHistory);
  merged.lastSyncedAt = provider.lastSyncedAt || new Date().toISOString();

  const latest = merged.transferHistory[merged.transferHistory.length - 1];
  if (latest && latest.toTeam && normalizeText(latest.toTeam) !== normalizeText(merged.currentTeam)) {
    merged.transferConflict = conflictObject("transferHistory.latest.toTeam", merged.currentTeam, latest.toTeam, providerName);
  }

  return normalizePlayer(merged);
}

function mergeProviderPlayers(localPlayers, providerPlayers, providerName) {
  const local = getPlayers(localPlayers);
  const provider = getPlayers(providerPlayers);
  const byName = new Map(local.map((player) => [normalizeText(player.name), player]));
  const byProviderId = new Map(local.filter((player) => player.providerId).map((player) => [String(player.providerId), player]));
  const used = new Set();
  const merged = provider.map((providerPlayer) => {
    const match = byProviderId.get(String(providerPlayer.providerId || "")) || byName.get(normalizeText(providerPlayer.name));
    if (match) {
      used.add(match.id);
    }
    return mergePlayerWithProvider(match, providerPlayer, providerName);
  });

  local.forEach((player) => {
    if (!used.has(player.id)) {
      merged.push(player);
    }
  });

  return merged;
}

function mergeProviderTransfers(localTransfers, providerTransfers) {
  const local = Array.isArray(localTransfers) ? localTransfers : [];
  const provider = Array.isArray(providerTransfers) ? providerTransfers : [];
  const seen = new Set(local.map(transferKey));
  const merged = local.slice();

  provider.forEach((transfer) => {
    const key = transferKey(transfer);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(transfer);
    }
  });

  return merged.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function validatePlayerData(rawPlayers) {
  const errors = [];
  const warnings = [];
  const seenIds = new Set();
  const seenSlugs = new Set();
  const list = getPlayers(rawPlayers);
  const now = new Date();

  list.forEach((player, index) => {
    const label = player.name || `index ${index}`;
    if (!player.id || !player.name) {
      errors.push(`${label}: id ve name zorunlu.`);
    }

    if (seenIds.has(player.id)) {
      errors.push(`${label}: duplicate player id ${player.id}.`);
    }
    seenIds.add(player.id);

    if (seenSlugs.has(player.slug)) {
      errors.push(`${label}: duplicate player slug ${player.slug}.`);
    }
    seenSlugs.add(player.slug);

    if (!player.currentTeam) {
      errors.push(`${label}: currentTeam eksik.`);
    }

    if (!player.position) {
      errors.push(`${label}: position eksik.`);
    }

    if (!player.positionGroup) {
      errors.push(`${label}: positionGroup hesaplanamadi.`);
    }

    if (!VALID_DATA_STATUSES.has(player.dataStatus)) {
      warnings.push(`${label}: dataStatus '${player.dataStatus}' beklenen sozlukte degil.`);
    }

    if (!VALID_RATING_STATUSES.has(player.ratingStatus)) {
      warnings.push(`${label}: ratingStatus '${player.ratingStatus}' beklenen sozlukte degil.`);
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
      warnings.push(`${label}: currentTeam formerTeams içinde görünüyor; eski kulüp listesi temizlenmeli.`);
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

    ["overall", "form", "attack", "creativity", "defense", "discipline", "durability", "potential", "transferValue", "dataConfidence"].forEach((field) => {
      const value = player.radar && player.radar[field];
      if (value != null && value !== "" && (Number(value) < 0 || Number(value) > 100)) {
        errors.push(`${label}: radar.${field} 0-100 araliginda olmali.`);
      }
    });

    if (!player.stats || typeof player.stats !== "object") {
      errors.push(`${label}: stats nesnesi eksik.`);
    }

    player.transferHistory.forEach((transfer, transferIndex) => {
      if (!transfer.date || !transfer.toTeam) {
        errors.push(`${label}: transferHistory[${transferIndex}] date ve toTeam içermeli.`);
      }
    });

    if (player.transferHistory.length) {
      const latestTransfer = player.transferHistory
        .slice()
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
      const latest = latestTransfer[latestTransfer.length - 1];
      if (latest && latest.toTeam && normalizeText(latest.toTeam) !== normalizeText(player.currentTeam)) {
        warnings.push(`${label}: son transfer currentTeam ile uyumlu değil.`);
      }
    }

    if (player.transferUpdatedAt) {
      const updatedDate = new Date(`${String(player.transferUpdatedAt).slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(updatedDate.getTime())) {
        errors.push(`${label}: transferUpdatedAt geçersiz.`);
      } else {
        const ageDays = Math.floor((now.getTime() - updatedDate.getTime()) / 86400000);
        if (ageDays > 180) {
          warnings.push(`${label}: transferUpdatedAt ${ageDays} günlük; güncellik kontrolü önerilir.`);
        }
      }
    }
  });

  const kerem = list.find((player) => player.id === "kerem-akturkoglu");
  if (!kerem || normalizeText(kerem.currentTeam) !== normalizeText("Fenerbahce")) {
    errors.push("Kerem Akturkoglu: currentTeam Fenerbahce olmali.");
  }

  const ugurcan = list.find((player) => player.id === "ugurcan-cakir");
  if (!ugurcan || normalizeText(ugurcan.currentTeam) !== normalizeText("Galatasaray")) {
    errors.push("Ugurcan Cakir: currentTeam Galatasaray olmali.");
  }

  const dzeko = list.find((player) => player.id === "edin-dzeko");
  if (!dzeko || normalizeText(dzeko.currentTeam).indexOf(normalizeText("Schalke")) === -1 || normalizeText(dzeko.league).indexOf(normalizeText("Bundesliga")) === -1) {
    errors.push("Edin Dzeko: currentTeam Schalke 04 ve league 2. Bundesliga olmali.");
  }

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
      type: update.type || update.transferType || inferTransferType(update),
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
  mergePlayerWithProvider,
  mergeProviderPlayers,
  mergeProviderTransfers,
  normalizePlayer,
  normalizeStats,
  normalizeText,
  slug,
  updatePlayerTransfer,
  validatePlayerData
};
