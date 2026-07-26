const { normalizePlayer, mergePlayerWithProvider, slug: buildSlug } = require("./playerService");
const { matchCanonicalPlayer } = require("./squadSyncService");
const { normalizeText } = require("./matchRadarService");

const MIN_SAFE_SUPER_LIG_PLAYER_COUNT = 100;
const MAX_ACCEPTABLE_PLAYER_DROP_RATIO = 0.2;

/**
 * Squad-sync currentTeam changes are always routed through a conflict
 * object for review, never applied silently — stricter than the general
 * mergePlayerWithProvider() used for live/request-time player merges
 * elsewhere, because a batch canonical write is much higher-stakes and the
 * task explicitly calls out named players (Kerem Akturkoglu, Ugurcan
 * Cakir, Edin Dzeko) whose currentTeam must never flip on a single
 * provider signal.
 */
/**
 * Sağlayıcıdan gelen kayda KÖKEN bilgisini yazar.
 *
 * Bunlar uydurma alan değil, kaydın nereden ve ne zaman geldiğine dair
 * doğrulanabilir olgular: kayıt gerçekten API-Football'un /players/squads
 * uç noktasından, bu zaman damgasıyla alındı.
 *
 * Neden gerekli: yayın kapısı (cardCredibility) bir kaydı yayımlamak için
 * izlenebilir kaynak ve doğrulama zamanı arıyor. Senkron yalnızca
 * `lastProviderSeenAt` yazıyordu; sonuç olarak sağlayıcıdan GERÇEKTEN
 * çekilmiş, sayısal kimliği ve lisanslı fotoğrafı olan 479 oyuncunun
 * tamamı "kaynak bağlantısı yok / doğrulama zamanı yok" gerekçesiyle
 * eleniyor ve hiçbir yüzeyde görünmüyordu.
 *
 * ratingStatus "pending" kalır: köken bilgisi kadronun doğruluğunu
 * belgeler, sağlayıcının vermediği bir dereceyi doğrulamaz.
 */
const PROVIDER_SOURCE_NAME = "API-Football";
const PROVIDER_SQUAD_ENDPOINT = "https://v3.football.api-sports.io/players/squads";

function providerProvenance(squadPlayer) {
  const seenAt = new Date().toISOString();
  const provenance = {
    sourceName: PROVIDER_SOURCE_NAME,
    sourceUrl: PROVIDER_SQUAD_ENDPOINT,
    lastVerifiedAt: seenAt,
    // normalizePlayer'ın varsayılanı "FutbolRadar tahmini ve manuel veri
    // kontrolü" — sağlayıcıdan birebir gelen bir kayıt için yanıltıcı.
    sourceNote: `${PROVIDER_SOURCE_NAME} kadro uç noktasından senkronlandı.`,
    providerName: PROVIDER_SOURCE_NAME
  };
  if (squadPlayer && squadPlayer.providerId) {
    provenance.sourceUrl = `${PROVIDER_SQUAD_ENDPOINT}?player=${squadPlayer.providerId}`;
  }
  return provenance;
}

function reconcileSquadPlayer(canonicalPlayers, squadPlayer, team) {
  const resolution = matchCanonicalPlayer(canonicalPlayers, squadPlayer, squadPlayer.birthDate || null);

  if (resolution.method === "name-only-review-required") {
    return {
      action: "review",
      reviewCandidate: resolution.reviewCandidate,
      squadPlayer,
      team: team.name,
      reason: "same-name-different-identity-signal"
    };
  }

  if (!resolution.match) {
    const id = buildSlug(`${squadPlayer.name}-${team.name}`);
    const created = normalizePlayer({
      id,
      providerId: squadPlayer.providerId || null,
      slug: id,
      name: squadPlayer.name,
      currentTeam: team.name,
      team: team.name,
      position: squadPlayer.position || null,
      age: squadPlayer.age || null,
      photo: squadPlayer.photo || null,
      dataStatus: "provider",
      ratingStatus: "pending",
      isCurrentSuperLigPlayer: true,
      squadStatus: "active",
      lastProviderSeenAt: new Date().toISOString(),
      ...providerProvenance(squadPlayer)
    });
    return { action: "create", player: created };
  }

  const local = resolution.match;
  const merged = mergePlayerWithProvider(local, {
    ...squadPlayer,
    currentTeam: team.name,
    team: team.name,
    dataStatus: "provider"
  }, "api-football");

  let conflict = null;
  if (normalizeText(merged.currentTeam) !== normalizeText(local.currentTeam)) {
    // Field-level merge may have flipped currentTeam; squad sync never allows that silently.
    merged.currentTeam = local.currentTeam;
    merged.team = local.currentTeam;
    conflict = {
      playerId: local.id,
      name: local.name,
      field: "currentTeam",
      localValue: local.currentTeam,
      providerValue: team.name,
      detectedAt: new Date().toISOString(),
      resolution: "kept-local-flagged-for-review"
    };
  } else if (merged.dataConflict) {
    // mergePlayerWithProvider already refused the overwrite for a protected
    // record (manual/verified) and recorded its own conflict — surface it.
    conflict = { playerId: local.id, name: local.name, resolution: "kept-local-flagged-for-review", ...merged.dataConflict };
  }

  merged.isCurrentSuperLigPlayer = true;
  merged.squadStatus = "active";
  merged.lastProviderSeenAt = new Date().toISOString();
  // Sağlayıcı kaydı tazelendiyse köken de tazelenir; elle doğrulanmış
  // alanlar mergePlayerWithProvider tarafından zaten korunuyor.
  Object.assign(merged, providerProvenance(squadPlayer));

  return { action: "update", player: normalizePlayer(merged), conflict };
}

/**
 * A player who no longer appears in any currently-synced active-team squad
 * is marked departed — the profile is kept (history, stats, prior ratings),
 * only the "is this a current Super Lig player" flag flips.
 */
function markDepartedPlayers(canonicalPlayers, activeSquadPlayerKeys) {
  return canonicalPlayers.map((player) => {
    if (!player.isCurrentSuperLigPlayer) {
      return player;
    }
    const key = player.providerId || player.id;
    if (activeSquadPlayerKeys.has(key)) {
      return player;
    }
    return { ...player, isCurrentSuperLigPlayer: false, squadStatus: "departed" };
  });
}

/**
 * Same guard shape as the team-list sync: a big unexplained drop in the
 * current Super Lig player count blocks the write rather than silently
 * shrinking the canonical dataset.
 */
function evaluatePlayerCountGuard(previousCount, newCount) {
  if (newCount < MIN_SAFE_SUPER_LIG_PLAYER_COUNT) {
    return { safe: false, reason: `below-minimum-safe-threshold (${newCount}/${MIN_SAFE_SUPER_LIG_PLAYER_COUNT})` };
  }
  if (previousCount > 0) {
    const dropRatio = (previousCount - newCount) / previousCount;
    if (dropRatio > MAX_ACCEPTABLE_PLAYER_DROP_RATIO) {
      return { safe: false, reason: `player-count-dropped-${Math.round(dropRatio * 100)}pct` };
    }
  }
  return { safe: true, reason: null };
}

function detectCanonicalDuplicates(players) {
  const seenProviderIds = new Map();
  const seenSlugs = new Map();
  const duplicates = [];

  for (const player of players) {
    if (player.providerId) {
      if (seenProviderIds.has(player.providerId)) {
        duplicates.push({ type: "providerId", value: player.providerId, players: [seenProviderIds.get(player.providerId), player.name] });
      }
      seenProviderIds.set(player.providerId, player.name);
    }
    if (player.slug) {
      if (seenSlugs.has(player.slug)) {
        duplicates.push({ type: "slug", value: player.slug, players: [seenSlugs.get(player.slug), player.name] });
      }
      seenSlugs.set(player.slug, player.name);
    }
  }

  return duplicates;
}

/**
 * Detailed per-player stat calls are the most request-budget-expensive part
 * of a sync, so they're prioritized rather than fetched for everyone at
 * once: players already placed in an upcoming fixture's probable lineup
 * come first, then anyone still missing a rating, then everyone else.
 */
function selectStatsEnrichmentPriority(players, lineupPlayerIds) {
  const priorityIds = lineupPlayerIds instanceof Set ? lineupPlayerIds : new Set(lineupPlayerIds || []);

  return players
    .map((player, index) => {
      let tier = 3;
      if (priorityIds.has(player.id) || priorityIds.has(player.providerId)) tier = 1;
      else if (!Number.isFinite(Number(player.overallRating ?? player.aiRating))) tier = 2;
      return { player, tier, index };
    })
    .sort((left, right) => (left.tier - right.tier) || (left.index - right.index))
    .map((entry) => entry.player);
}

/**
 * Stat enrichment reuses the same field-merge safety as squad sync: only
 * fills genuinely empty fields, never turns a missing stat into a
 * fabricated zero, and never overwrites a manually verified rating.
 */
function enrichPlayerStats(canonicalPlayer, providerStatsPayload) {
  if (!providerStatsPayload) {
    return canonicalPlayer;
  }
  return normalizePlayer(mergePlayerWithProvider(canonicalPlayer, { ...providerStatsPayload, dataStatus: "provider" }, "api-football"));
}

module.exports = {
  reconcileSquadPlayer,
  selectStatsEnrichmentPriority,
  enrichPlayerStats,
  markDepartedPlayers,
  evaluatePlayerCountGuard,
  detectCanonicalDuplicates,
  MIN_SAFE_SUPER_LIG_PLAYER_COUNT,
  MAX_ACCEPTABLE_PLAYER_DROP_RATIO
};
