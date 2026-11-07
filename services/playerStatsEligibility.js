/**
 * Eligibility for current player-statistics lists, not a profile/data deletion rule.
 * Use existing roster/transfer facts, never minutes, ratings or injury as a proxy:
 * injured/suspended active squad members still belong in season statistics.
 * Unmarked legacy records with a club remain eligible; this is not proof that
 * their numbers are current-season data. Unknown transfers are not invented.
 */
function isActiveStatsPlayer(player) {
  if (!player || typeof player !== "object") return false;
  if (player.isCurrentSuperLigPlayer === false) return false;
  var status = String(player.squadStatus || "").trim().toLowerCase();
  if (["departed", "released", "transferred_out", "loaned_out", "retired", "inactive"].indexOf(status) !== -1) return false;
  var team = String(player.currentTeam || player.team || "").trim();
  if (!team || /serbest|free[ -]?agent|kul[üu]ps[üu]z|without club|retired/i.test(team)) return false;
  return true;
}

/** Match local departures even when an upstream chart still carries the former club. */
function filterActiveLeaderRows(rows, players) {
  var list = Array.isArray(players) ? players : [];
  function identity(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").toLowerCase().trim();
  }
  var byId = new Map();
  var byName = new Map();
  list.forEach(function (player) {
    [player.id, player.slug, player.providerId].filter(Boolean).forEach(function (id) { byId.set(String(id), player); });
    if (player.name) byName.set(identity(player.name), player);
  });
  return (Array.isArray(rows) ? rows : []).filter(function (row) {
    if (!isActiveStatsPlayer(row)) return false;
    var local = [row.slug, row.id, row.providerId].filter(Boolean).map(function (id) { return byId.get(String(id)); }).find(Boolean) || byName.get(identity(row.name));
    return !local || isActiveStatsPlayer({ ...row, ...local, currentTeam: local.currentTeam || local.team || row.team });
  }).map(function (row, index) { return { ...row, rank: index + 1 }; });
}

module.exports = { isActiveStatsPlayer, filterActiveLeaderRows };
