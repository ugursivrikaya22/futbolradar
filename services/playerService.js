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
  normalizeText,
  slug,
  updatePlayerTransfer,
  validatePlayerData
};
