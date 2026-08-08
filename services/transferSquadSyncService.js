const {
  mergePlayerWithProvider,
  normalizePlayer,
  normalizeText,
  slug
} = require("./playerService");
const {
  isCurrentSquadStatus,
  isLoanTransfer,
  isSuperLigTeam,
  publishableTransfers,
  squadMembershipForTransfer,
  transfersForTeam
} = require("./transferService");

function historyKey(item) {
  return [
    String(item && item.date || "").slice(0, 10),
    normalizeText(item && item.fromTeam),
    normalizeText(item && item.toTeam),
    normalizeText(item && item.type)
  ].join("|");
}

function transferHistoryEntry(transfer) {
  return {
    date: transfer.date,
    fromTeam: transfer.fromTeam,
    toTeam: transfer.toTeam,
    type: transfer.type,
    feeEur: transfer.feeEur == null ? null : Number(transfer.feeEur),
    feeLabel: transfer.fee || transfer.feeLabel || "Açıklanmadı",
    source: transfer.sourceName,
    note: transfer.note || ""
  };
}

function appendTransferHistory(history, transfer) {
  const entry = transferHistoryEntry(transfer);
  const entries = Array.isArray(history) ? history.slice() : [];
  const key = historyKey(entry);
  const index = entries.findIndex((item) => historyKey(item) === key);
  if (index === -1) entries.push(entry);
  else entries[index] = { ...entries[index], ...entry };
  return entries.sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));
}

function recordIndexByProviderId(players, providerId) {
  if (!providerId) return -1;
  return players.findIndex((player) => String(player.providerId || "") === String(providerId));
}

function sameClub(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function createTransferPlayer(transfer) {
  const profile = transfer.playerProfile && typeof transfer.playerProfile === "object"
    ? transfer.playerProfile
    : {};
  const updatedAt = String(transfer.lastVerifiedAt || transfer.date).slice(0, 10);

  return {
    ...profile,
    id: transfer.playerId || slug(transfer.playerName),
    slug: transfer.playerId || slug(transfer.playerName),
    name: transfer.playerName,
    fullName: transfer.playerName,
    currentTeam: transfer.toTeam,
    team: transfer.toTeam,
    position: profile.position || transfer.position || "Bilinmiyor",
    primaryPosition: profile.primaryPosition || profile.position || transfer.position || "Bilinmiyor",
    providerId: transfer.providerId || null,
    formerTeams: [transfer.fromTeam].filter(Boolean),
    transferHistory: [],
    dataStatus: "manually_verified",
    ratingStatus: "pending",
    sourceUrl: transfer.sourceUrl,
    source: {
      provider: transfer.sourceName,
      providerId: transfer.providerId || null,
      sourceUrl: transfer.sourceUrl,
      status: "manually_verified",
      ratingStatus: "pending",
      lastVerifiedAt: transfer.lastVerifiedAt,
      note: "Official confirmed transfer"
    },
    lastVerifiedAt: transfer.lastVerifiedAt,
    lastUpdatedAt: updatedAt,
    lastUpdated: updatedAt,
    transferUpdatedAt: transfer.date
  };
}

function applyTransferToPlayer(player, transfer) {
  const membership = squadMembershipForTransfer(transfer);
  const oldTeam = player.currentTeam || player.team || transfer.fromTeam;
  const destinationMatchesProvider = sameClub(player.currentTeam || player.team, transfer.toTeam);
  const aliases = new Set(Array.isArray(player.aliases) ? player.aliases : []);
  const formerTeams = new Set(Array.isArray(player.formerTeams) ? player.formerTeams : []);
  if (oldTeam && !sameClub(oldTeam, transfer.toTeam)) formerTeams.add(oldTeam);
  if (transfer.fromTeam && !sameClub(transfer.fromTeam, transfer.toTeam)) formerTeams.add(transfer.fromTeam);
  const updatedAt = String(transfer.lastVerifiedAt || transfer.date).slice(0, 10);
  const profile = transfer.playerProfile && typeof transfer.playerProfile === "object"
    ? transfer.playerProfile
    : {};

  const next = {
    ...player,
    ...profile,
    id: transfer.playerId || player.id,
    slug: transfer.playerId || player.slug || player.id,
    name: profile.name || player.name || transfer.playerName,
    fullName: profile.fullName || player.fullName || player.name || transfer.playerName,
    aliases: [...aliases],
    currentTeam: transfer.toTeam,
    team: transfer.toTeam,
    currentTeamId: destinationMatchesProvider && /^\d+$/.test(String(player.currentTeamId || ""))
      ? player.currentTeamId
      : slug(transfer.toTeam),
    currentTeamLogo: destinationMatchesProvider ? player.currentTeamLogo : null,
    position: profile.position || transfer.position || player.position,
    primaryPosition: profile.primaryPosition || profile.position || transfer.position || player.primaryPosition || player.position,
    formerTeams: [...formerTeams].filter((team) => !sameClub(team, transfer.toTeam)),
    transferHistory: appendTransferHistory(player.transferHistory, transfer),
    squadStatus: membership.squadStatus || player.squadStatus || "pending",
    isCurrentSuperLigPlayer: membership.isCurrentSuperLigPlayer,
    officialTransferPendingProvider: membership.isCurrentSuperLigPlayer && !player.providerId,
    officialTransferVerified: true,
    dataStatus: "manually_verified",
    transferUpdatedAt: transfer.date,
    lastUpdatedAt: updatedAt,
    lastUpdated: updatedAt,
    lastSyncedAt: updatedAt,
    lastVerifiedAt: transfer.lastVerifiedAt,
    sourceUrl: transfer.sourceUrl,
    transferConflict: null
  };

  if (membership.isCurrentSuperLigPlayer) next.league = "Süper Lig";
  else if (transfer.destinationLeague) next.league = transfer.destinationLeague;

  if (isLoanTransfer(transfer)) {
    next.parentClub = transfer.fromTeam;
    next.loanClub = transfer.toTeam;
  } else {
    next.parentClub = null;
    next.loanClub = null;
  }

  return normalizePlayer(next);
}

function reconcileConfirmedTransfers(rawPlayers, rawTransfers) {
  const players = (Array.isArray(rawPlayers) ? rawPlayers : []).map((player) => ({ ...player }));
  const prepared = publishableTransfers({ transfers: rawTransfers });
  const transfers = prepared.transfers.slice().sort((left, right) =>
    String(left.date || "").localeCompare(String(right.date || "")));
  const report = {
    processed: [],
    created: [],
    merged: [],
    updated: [],
    duplicatesRemoved: [],
    excluded: prepared.excluded,
    duplicateTransfers: prepared.duplicates
  };

  for (const transfer of transfers) {
    const playerId = transfer.playerId || slug(transfer.playerName);
    let canonicalIndex = players.findIndex((player) => player.id === playerId || player.slug === playerId);
    let providerIndex = recordIndexByProviderId(players, transfer.providerId);

    if (canonicalIndex !== -1 && providerIndex !== -1 && canonicalIndex !== providerIndex) {
      const providerRecord = players[providerIndex];
      const merged = mergePlayerWithProvider(players[canonicalIndex], providerRecord, providerRecord.providerName || "API-Football");
      merged.aliases = Array.from(new Set([
        ...(Array.isArray(merged.aliases) ? merged.aliases : []),
        ...(Array.isArray(providerRecord.aliases) ? providerRecord.aliases : []),
        providerRecord.id
      ].filter(Boolean)));
      players[canonicalIndex] = merged;
      players.splice(providerIndex, 1);
      report.merged.push(playerId);
      report.duplicatesRemoved.push(providerRecord.id);
      canonicalIndex = players.findIndex((player) => player.id === playerId);
    } else if (canonicalIndex === -1 && providerIndex !== -1) {
      const providerRecord = players[providerIndex];
      players[providerIndex] = {
        ...providerRecord,
        id: playerId,
        slug: playerId,
        name: transfer.playerName,
        fullName: transfer.playerName,
        aliases: Array.from(new Set([
          ...(Array.isArray(providerRecord.aliases) ? providerRecord.aliases : []),
          providerRecord.id
        ].filter(Boolean)))
      };
      canonicalIndex = providerIndex;
      report.merged.push(playerId);
      report.duplicatesRemoved.push(providerRecord.id);
    } else if (canonicalIndex === -1) {
      players.push(createTransferPlayer({ ...transfer, playerId }));
      canonicalIndex = players.length - 1;
      report.created.push(playerId);
    }

    players[canonicalIndex] = applyTransferToPlayer(players[canonicalIndex], { ...transfer, playerId });
    report.updated.push(playerId);
    report.processed.push(transfer.id);
  }

  return { players, report };
}

function auditSquadIntegrity(rawPlayers, rawTransfers) {
  const players = (Array.isArray(rawPlayers) ? rawPlayers : []).map((player) => normalizePlayer(player));
  const errors = [];
  const warnings = [];
  const activeByProviderId = new Map();
  const activeByIdentity = new Map();

  for (const player of players) {
    const current = isCurrentSquadStatus(player.squadStatus);
    if (current !== (player.isCurrentSuperLigPlayer === true)) {
      errors.push(`${player.id}: squad status/current flag mismatch.`);
    }
    if (!current) continue;

    if (player.providerId) {
      const previous = activeByProviderId.get(String(player.providerId));
      if (previous) errors.push(`${player.id}: providerId ${player.providerId} is also active as ${previous}.`);
      activeByProviderId.set(String(player.providerId), player.id);
    }

    const identity = `${normalizeText(player.fullName || player.name)}|${normalizeText(player.currentTeam)}`;
    const previousIdentity = activeByIdentity.get(identity);
    if (previousIdentity) errors.push(`${player.id}: duplicate active squad identity with ${previousIdentity}.`);
    activeByIdentity.set(identity, player.id);
  }

  const { transfers } = publishableTransfers({ transfers: rawTransfers });
  const latestByPlayer = new Map();
  for (const transfer of transfers.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    latestByPlayer.set(transfer.playerId || slug(transfer.playerName), transfer);
  }

  for (const [playerId, transfer] of latestByPlayer) {
    const player = players.find((item) => item.id === playerId);
    if (!player) {
      errors.push(`${playerId}: confirmed transfer has no canonical player.`);
      continue;
    }
    const membership = squadMembershipForTransfer(transfer);
    if (!sameClub(player.currentTeam, transfer.toTeam)) {
      errors.push(`${playerId}: current team '${player.currentTeam}' does not match '${transfer.toTeam}'.`);
    }
    if (membership.squadStatus && player.squadStatus !== membership.squadStatus) {
      errors.push(`${playerId}: squad status '${player.squadStatus}' should be '${membership.squadStatus}'.`);
    }
    if (!(player.transferHistory || []).some((item) => historyKey(item) === historyKey(transfer))) {
      errors.push(`${playerId}: confirmed transfer is missing from transfer history.`);
    }
    if (membership.isCurrentSuperLigPlayer && !player.providerId && player.officialTransferPendingProvider !== true) {
      errors.push(`${playerId}: incoming player has neither provider identity nor pending-provider marker.`);
    }
    if (player.officialTransferPendingProvider === true) {
      warnings.push(`${playerId}: official transfer awaits provider squad identity/photo.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function syncTeamRecentTransfers(rawTeams, rawTransfers) {
  const prepared = publishableTransfers({ transfers: rawTransfers });
  return (Array.isArray(rawTeams) ? rawTeams : []).map((team) => {
    const split = transfersForTeam(team.name, { prepared });
    const recentTransfers = [
      ...split.incoming.map((transfer) => ({
        playerName: transfer.playerName,
        direction: "in",
        date: transfer.date,
        fromTeam: transfer.fromTeam,
        type: transfer.type,
        status: transfer.status,
        sourceName: transfer.sourceName,
        sourceUrl: transfer.sourceUrl
      })),
      ...split.outgoing.map((transfer) => ({
        playerName: transfer.playerName,
        direction: "out",
        date: transfer.date,
        toTeam: transfer.toTeam,
        type: transfer.type,
        status: transfer.status,
        sourceName: transfer.sourceName,
        sourceUrl: transfer.sourceUrl
      }))
    ].sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));

    return { ...team, recentTransfers };
  });
}

module.exports = {
  appendTransferHistory,
  applyTransferToPlayer,
  auditSquadIntegrity,
  reconcileConfirmedTransfers,
  syncTeamRecentTransfers,
  transferHistoryEntry
};
