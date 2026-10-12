const apiFootballProvider = require("./providers/apiFootballProvider");
const { normalizeText } = require("./matchRadarService");
const { repairMojibake } = require("./textEncodingRepair.js");

const PARTIAL_SQUAD_THRESHOLD = 11;

async function fetchTeamSquad(team) {
  if (!apiFootballProvider.hasConfig()) {
    return { status: "unavailable", reason: "no-provider-config", players: [] };
  }
  if (!team || !team.providerId) {
    return { status: "unavailable", reason: "no-team-provider-id", players: [] };
  }

  try {
    const players = await apiFootballProvider.getSquad({ teamId: team.providerId });
    return { status: "fetched", reason: null, players };
  } catch (error) {
    return { status: "unavailable", reason: error.code || "provider-error", players: [] };
  }
}

function buildSquadSnapshot(team, providerPlayers, season) {
  const players = Array.isArray(providerPlayers) ? providerPlayers : [];
  const status = players.length === 0 ? "unavailable" : players.length < PARTIAL_SQUAD_THRESHOLD ? "partial" : "complete";

  return {
    teamId: team.providerId || team.id,
    teamName: team.name,
    season: season || new Date().getUTCFullYear(),
    syncedAt: new Date().toISOString(),
    status,
    // Ad, sağlayıcı anlık görüntüsüne yazılmadan ÖNCE onarılır. Kimlik ve URL
    // addan türetildiği için bozuk bir ad buradan geçtiğinde zarar kalıcı
    // oluyor: /oyuncular/b-baa-kan-trabzonspor.html gibi bir adres üretiliyor,
    // site haritasına giriyor, kıyas sayfalarına ve İngilizce aynaya
    // kopyalanıyor. Onarılamayan ad olduğu gibi bırakılır — tahmin edilmez —
    // ve yayın kapısında (services/cardCredibility.js) elenir.
    players: players.map((player) => ({
      providerId: player.providerId || null,
      name: repairMojibake(player.name),
      number: player.number ?? null,
      position: player.position || null,
      age: player.age ?? null,
      photo: player.photo || null
    }))
  };
}

/**
 * A team's squad snapshot is only ever additive-or-replace, never
 * destructive: an empty/failed fetch must not erase a previously good
 * snapshot for that team.
 */
function evaluateSquadSyncSafety(previousSnapshot, freshSnapshot) {
  const previousCount = previousSnapshot && Array.isArray(previousSnapshot.players) ? previousSnapshot.players.length : 0;
  const freshCount = freshSnapshot && Array.isArray(freshSnapshot.players) ? freshSnapshot.players.length : 0;

  if (freshCount === 0 && previousCount > 0) {
    return { safe: false, reason: "empty-fetch-would-erase-existing-squad", previousCount, freshCount };
  }

  return { safe: true, reason: null, previousCount, freshCount };
}

/**
 * A providerId appearing as active in two different team squads at once is
 * a data-quality signal (mid-window transfer, provider lag, duplicate
 * roster entry) that must be surfaced for review, not silently resolved.
 */
function detectProviderIdConflicts(squadSnapshots) {
  const seenBy = new Map();
  const conflicts = [];

  for (const snapshot of Array.isArray(squadSnapshots) ? squadSnapshots : []) {
    for (const player of snapshot.players || []) {
      if (!player.providerId) continue;
      const previousTeam = seenBy.get(player.providerId);
      if (previousTeam && previousTeam !== snapshot.teamName) {
        conflicts.push({
          providerId: player.providerId,
          name: player.name,
          teams: [previousTeam, snapshot.teamName],
          reason: "player-active-in-two-squads"
        });
      }
      seenBy.set(player.providerId, snapshot.teamName);
    }
  }

  return conflicts;
}

/**
 * Identity resolution order for matching a provider squad row against an
 * existing canonical player: providerId first, then birthDate + normalized
 * name. Name-only similarity is reported separately for manual review — it
 * is never used to auto-merge two records.
 */
/**
 * İsim karşılaştırması için BOŞLUK SADELEŞTİRİLİR.
 *
 * normalizeText iç boşlukları sıkıştırmıyor; sağlayıcı "Taylan  Bulut"
 * (çift boşluk) gönderdiğinde kayıt "Taylan Bulut" ile eşleşmedi ve aynı
 * oyuncu için İKİNCİ bir profil açıldı. Çift boşluk gözle görünmez, bu
 * yüzden hata veride sessizce duruyordu.
 */
function normalizedName(value) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function matchCanonicalPlayer(canonicalPlayers, providerPlayer, providerBirthDate) {
  const byProviderId = canonicalPlayers.find((player) => player.providerId && providerPlayer.providerId && player.providerId === providerPlayer.providerId);
  if (byProviderId) {
    return { match: byProviderId, method: "providerId" };
  }

  if (providerBirthDate) {
    const byBirthAndName = canonicalPlayers.find((player) => {
      return player.birthDate === providerBirthDate && normalizedName(player.name) === normalizedName(providerPlayer.name);
    });
    if (byBirthAndName) {
      return { match: byBirthAndName, method: "birthDate+name" };
    }
  }

  // YER TUTUCU SAĞLAYICI KİMLİĞİ: kayıt elle girilmiş ve `mock-…` kimliği
  // taşıyorsa, ad VE takım birebir tutuyor ve sağlayıcı kimliği başka bir
  // kanonik oyuncuda kullanılmıyorsa aynı oyuncudur. Ad tek başına yetmez;
  // takım uyuşmazsa ya da birden fazla aday varsa incelemeye düşer.
  const providerTeam = providerPlayer.currentTeam || providerPlayer.team;
  if (providerTeam && providerPlayer.providerId && /^\d+$/.test(String(providerPlayer.providerId))) {
    const idTaken = canonicalPlayers.some((player) => String(player.providerId || "") === String(providerPlayer.providerId));
    const placeholderMatches = canonicalPlayers.filter((player) => {
      return /^mock-/.test(String(player.providerId || ""))
        && normalizedName(player.name) === normalizedName(providerPlayer.name)
        && normalizedName(player.currentTeam || player.team) === normalizedName(providerTeam);
    });
    if (!idTaken && placeholderMatches.length === 1) {
      return { match: placeholderMatches[0], method: "name+team+placeholder-provider-id" };
    }
  }

  const nameOnlyCandidate = canonicalPlayers.find((player) => normalizedName(player.name) === normalizedName(providerPlayer.name));
  if (nameOnlyCandidate) {
    return { match: null, method: "name-only-review-required", reviewCandidate: nameOnlyCandidate };
  }

  return { match: null, method: "no-match" };
}

module.exports = {
  normalizedName,
  fetchTeamSquad,
  buildSquadSnapshot,
  evaluateSquadSyncSafety,
  detectProviderIdConflicts,
  matchCanonicalPlayer,
  PARTIAL_SQUAD_THRESHOLD
};
