const apiFootballProvider = require("./providers/apiFootballProvider");
const { normalizeText } = require("./matchRadarService");
const { fixtureTeamNames } = require("./superLigTeams");

const MAX_ACCEPTABLE_DROP_RATIO = 0.2;

/**
 * Çekilen listenin, TFF fikstüründen bilinen on sekiz takımla en az bu kadar
 * örtüşmesi beklenir. Eşik %60: sezon arası birkaç takım değişebilir (küme
 * düşen/çıkan), ama çoğunluk tutmalıdır. Bambaşka bir ligde örtüşme sıfıra
 * yakın çıkar.
 */
const MIN_LEAGUE_IDENTITY_OVERLAP = 0.6;

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function providerSyncConfig() {
  const config = apiFootballProvider.getConfig();
  return { leagueId: config.leagueId, season: config.season, country: config.country };
}

/**
 * Never fetches for real unless a live API-Football key is configured
 * (APIFOOTBALL_API_KEY). Absence of config is a valid, expected state in
 * this repo today, not a failure — callers must branch on `status`.
 */
async function fetchCurrentSuperLigTeams(options = {}) {
  if (!apiFootballProvider.hasConfig()) {
    return { status: "unavailable", reason: "no-provider-config", teams: [] };
  }

  const config = providerSyncConfig();
  // Çağıran taraf lig kimliğini çözmüşse (env yoksa /leagues üzerinden) onu
  // kullanır; yoksa eskisi gibi yapılandırmadan okunur.
  const leagueId = options.leagueId || config.leagueId;
  if (!leagueId) {
    return { status: "unavailable", reason: "no-league-id-config", teams: [] };
  }

  try {
    const teams = await apiFootballProvider.getTeams({ league: leagueId, season: config.season });
    return { status: "fetched", reason: null, teams };
  } catch (error) {
    return { status: "unavailable", reason: error.code || "provider-error", teams: [] };
  }
}

/**
 * Guards against acting on a truncated/garbled provider response: a >20%
 * drop from the previously known team count blocks the sync rather than
 * silently shrinking the league.
 */
function evaluateTeamListChange(previousTeams, fetchedTeams) {
  const previousCount = Array.isArray(previousTeams) ? previousTeams.length : 0;
  const fetchedCount = Array.isArray(fetchedTeams) ? fetchedTeams.length : 0;

  if (previousCount === 0) {
    return { safe: true, reason: null, previousCount, fetchedCount };
  }

  if (fetchedCount === 0) {
    return { safe: false, reason: "empty-fetch-result", previousCount, fetchedCount };
  }

  const dropRatio = (previousCount - fetchedCount) / previousCount;
  if (dropRatio > MAX_ACCEPTABLE_DROP_RATIO) {
    return { safe: false, reason: `team-count-dropped-${Math.round(dropRatio * 100)}pct`, previousCount, fetchedCount };
  }

  return { safe: true, reason: null, previousCount, fetchedCount };
}

/**
 * KİMLİK KONTROLÜ — sayı doğru olsa da lig yanlış olabilir.
 *
 * evaluateTeamListChange yalnızca SAYILARA bakar. Yanlış bir lig kimliği
 * (operatörün elle yazdığı hatalı bir env değeri ya da eskimiş bir önbellek)
 * on sekiz takım döndürürse bu kontrolden sorunsuz geçer: gerçek Süper Lig
 * kulüpleri isCurrentSuperLigTeam=false olarak işaretlenir, başka bir ligin
 * kulüpleri güncel diye eklenir ve hepsi doğrulanmış veri gibi yayımlanır.
 *
 * Karşılaştırma için elimizde bağımsız bir doğruluk kaynağı var: TFF
 * fikstüründen türeyen on sekiz takım adı (services/superLigTeams.js).
 * Çekilen listenin bu adlarla yeterince örtüşmesi beklenir. Örtüşme düşükse
 * sorun "lig küçüldü" değil, "yanlış ligi çektik"tir ve yazma durur.
 */
function evaluateLeagueIdentity(fetchedTeams) {
  const fetched = Array.isArray(fetchedTeams) ? fetchedTeams : [];
  const expected = new Set(fixtureTeamNames().map((name) => normalizeText(name)));

  // Boş çekim HER ZAMAN reddedilir. evaluateTeamListChange bunu yalnızca
  // önceden takım varsa yakalıyor: previousCount 0 iken tüm korumaları
  // atlıyor ve sıfır takım "başarılı senkron" sayılıyordu. Süper Lig'in
  // sıfır takımı olduğu meşru bir durum yok.
  if (!fetched.length) {
    return { safe: false, reason: "empty-fetch-result", overlap: 0, expectedCount: expected.size, matchedNames: [] };
  }

  if (!expected.size) {
    // Beklenen liste yoksa kıyas yapılamaz; yalnızca bu durumda karşılaştırma
    // sessizce devre dışı kalır ve mevcut sayı korumaları yürürlükte kalır.
    return { safe: true, reason: null, overlap: null, expectedCount: 0 };
  }

  // Eşleştirme İÇEREN biçimde yapılır, birebir değil. İki bağımsız adlandırma
  // kaynağı karşılaştırılıyor: sağlayıcı "Gaziantep FK" derken fikstür
  // "Gaziantep", sağlayıcı "Rizespor" derken fikstür "Çaykur Rizespor"
  // diyebilir. Birebir eşleştirme, DOĞRU bir lig kimliğini yanlışlıkla
  // reddedip her şeyi durdururdu — bu, korumanın engellemeye çalıştığı
  // sorundan daha kötü olurdu. (Türkçe katlama normalizeText'te yapılıyor.)
  const expectedNames = [...expected];
  const matched = fetched.filter((team) => {
    const name = normalizeText(team && team.name);
    if (!name) return false;
    return expectedNames.some((candidate) =>
      candidate === name || candidate.includes(name) || name.includes(candidate));
  });
  const overlap = matched.length / expected.size;

  if (overlap < MIN_LEAGUE_IDENTITY_OVERLAP) {
    return {
      safe: false,
      reason: `league-identity-mismatch-${Math.round(overlap * 100)}pct`,
      overlap,
      expectedCount: expected.size,
      matchedNames: matched.map((team) => team.name)
    };
  }

  return { safe: true, reason: null, overlap, expectedCount: expected.size };
}

/**
 * Additive merge: promoted teams are appended, teams missing from the fresh
 * fetch are flagged isCurrentSuperLigTeam=false but never deleted (profile
 * and history stay intact for relegated clubs). Never invents duplicate
 * rows for the same club across a name change — provider ID is the primary
 * match key, falling back to normalized name only when providerId is absent
 * on the canonical row.
 */
function mergeTeamList(canonicalTeams, fetchedTeams) {
  const canonical = Array.isArray(canonicalTeams) ? canonicalTeams : [];
  const fetched = Array.isArray(fetchedTeams) ? fetchedTeams : [];
  const byProviderId = new Map(canonical.filter((team) => team.providerId).map((team) => [String(team.providerId), team]));
  const byName = new Map(canonical.map((team) => [normalizeText(team.name), team]));

  const merged = canonical.map((team) => ({ ...team, isCurrentSuperLigTeam: false }));
  const seenCanonicalIndexes = new Set();
  const additions = [];
  const conflicts = [];

  for (const fetchedTeam of fetched) {
    const matchByProvider = fetchedTeam.providerId ? byProviderId.get(String(fetchedTeam.providerId)) : null;
    const matchByName = byName.get(normalizeText(fetchedTeam.name));
    const match = matchByProvider || matchByName;

    if (match) {
      const index = merged.findIndex((team) => team === match || (team.id && team.id === match.id));
      if (index === -1) continue;
      seenCanonicalIndexes.add(index);
      merged[index] = {
        ...merged[index],
        providerId: merged[index].providerId || fetchedTeam.providerId || null,
        isCurrentSuperLigTeam: true,
        lastProviderSeenAt: new Date().toISOString()
      };
      if (matchByProvider && matchByName && matchByProvider !== matchByName) {
        conflicts.push({ providerId: fetchedTeam.providerId, name: fetchedTeam.name, reason: "provider-id-and-name-point-to-different-rows" });
      }
    } else {
      additions.push({
        id: fetchedTeam.id || slug(fetchedTeam.name),
        providerId: fetchedTeam.providerId || null,
        name: fetchedTeam.name,
        league: "Süper Lig",
        isCurrentSuperLigTeam: true,
        lastProviderSeenAt: new Date().toISOString(),
        source: "api-football"
      });
    }
  }

  return { merged: [...merged, ...additions], additions, conflicts };
}

module.exports = {
  fetchCurrentSuperLigTeams,
  evaluateTeamListChange,
  evaluateLeagueIdentity,
  mergeTeamList,
  providerSyncConfig,
  MAX_ACCEPTABLE_DROP_RATIO,
  MIN_LEAGUE_IDENTITY_OVERLAP
};
