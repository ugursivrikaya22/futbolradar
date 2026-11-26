/**
 * OYUNCU VERİSİ TAZELİĞİ — "GÜNCELLEME GEREKEN OYUNCU" KURALININ TEK KAYNAĞI.
 *
 * Eskiden "Güncelleme gereken" yalnızca elle konmuş `dataStatus` bayraklarına
 * bakıyordu; hiçbir betik zamana bakarak `stale` işareti koymuyordu. Sonuç:
 * oyuncu senkronu günlerce durduğunda liste hiç büyümüyordu ve oyuncu
 * radarındaki "Son kontrol" damgası, kimsenin ilgilenmediği bir eski tarihte
 * donup kalıyordu.
 *
 * Bir oyuncu şu iki durumda güncelleme bekler:
 *   1. `dataStatus` incelemeyi gerektiren bir durumdaysa (stale, manual-review,
 *      mock_needs_verification, transfer_needs_monitoring);
 *   2. kendi doğrulama damgası PLAYER_STALE_DAYS günden eskiyse (ya da hiç
 *      damgası yoksa).
 *
 * Damga uydurulmaz: yalnızca kayıttaki alanlardan okunur. Tarayıcı tarafı
 * (app.js · playerNeedsUpdateListing) aynı kuralı ve aynı sabiti kullanır;
 * scripts/test-player-radar-status.mjs ikisinin ayrışmamasını denetler.
 */

const PLAYER_STALE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const FLAGGED_STATUSES = Object.freeze(["stale", "manual-review", "mock_needs_verification", "transfer_needs_monitoring"]);
const STAMP_FIELDS = Object.freeze(["lastVerifiedAt", "lastProviderSeenAt", "lastSyncedAt", "lastUpdatedAt", "lastUpdated"]);

function stampMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Oyuncunun kayıttaki EN YENİ doğrulama/senkron damgası (ms) ya da null. */
function playerLastVerifiedMs(player) {
  let best = null;
  for (const field of STAMP_FIELDS) {
    const ms = stampMs(player && player[field]);
    if (ms !== null && (best === null || ms > best)) best = ms;
  }
  return best;
}

/** Güncelleme gerekmiyorsa null, gerekiyorsa nedeni. */
function playerRefreshReason(player, nowMs = Date.now()) {
  const status = String((player && player.dataStatus) || "").trim().toLowerCase();
  if (FLAGGED_STATUSES.includes(status)) return `status:${status}`;
  const last = playerLastVerifiedMs(player);
  if (last === null) return "no-stamp";
  const ageDays = Math.floor((nowMs - last) / DAY_MS);
  return ageDays > PLAYER_STALE_DAYS ? "stale-stamp" : null;
}

/** Listedeki en yeni oyuncu senkron damgası (ISO) ya da null. */
function newestPlayerSyncAt(players) {
  let best = null;
  for (const player of Array.isArray(players) ? players : []) {
    const ms = playerLastVerifiedMs(player);
    if (ms !== null && (best === null || ms > best)) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}

/**
 * Günlük durum özeti. `players` verinin kendisidir; `now` testlerde sabitlenir.
 * Liste en eski damgadan başlar ve LIST_LIMIT ile sınırlıdır (dosya şişmesin);
 * tam sayı `needsUpdateCount`'ta durur.
 */
const LIST_LIMIT = 200;
function summarizePlayerRadar(players, now = new Date()) {
  const rows = Array.isArray(players) ? players : [];
  const nowMs = now.getTime();
  const flagged = [];
  const byReason = {};
  for (const player of rows) {
    const reason = playerRefreshReason(player, nowMs);
    if (!reason) continue;
    const kind = reason.startsWith("status:") ? "status" : reason;
    byReason[kind] = (byReason[kind] || 0) + 1;
    const last = playerLastVerifiedMs(player);
    flagged.push({
      id: player.id || player.providerId || player.name,
      name: player.name || null,
      team: player.currentTeam || player.team || null,
      reason,
      lastVerifiedAt: last === null ? null : new Date(last).toISOString()
    });
  }
  flagged.sort((a, b) => String(a.lastVerifiedAt || "").localeCompare(String(b.lastVerifiedAt || "")) || String(a.id).localeCompare(String(b.id)));
  return {
    schemaVersion: 1,
    checkedAt: now.toISOString(),
    staleAfterDays: PLAYER_STALE_DAYS,
    totalPlayers: rows.length,
    newestSyncAt: newestPlayerSyncAt(rows),
    needsUpdateCount: flagged.length,
    byReason,
    needsUpdate: flagged.slice(0, LIST_LIMIT)
  };
}

module.exports = {
  FLAGGED_STATUSES,
  PLAYER_STALE_DAYS,
  STAMP_FIELDS,
  newestPlayerSyncAt,
  playerLastVerifiedMs,
  playerRefreshReason,
  summarizePlayerRadar
};
