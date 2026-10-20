// Keep the published URL when a verified current record exists, even if its
// canonical record is missing or no longer passes the publication gate.
export function englishProfilePlayers(players, urls, view) {
  const pages = new Map();
  for (const player of players) {
    if (!view(player).verified) continue;
    const pathname = urls.enPlayerPagePath(player.id);
    if (!pages.has(pathname) || urls.resolveId(player.id) === player.id) {
      pages.set(pathname, player);
    }
  }
  return [...pages.values()];
}

// Page-existence gate: every publication rule except the 45-day freshness one.
// A stale record keeps its URL; its restricted stats are withheld by
// publicPlayerView. Identity/source/rating failures still block the page.
const FRESHNESS_REASON = /^son doğrulama \d+ gün önce$/;
export function englishProfileGate(player, evaluateCard) {
  const verdict = evaluateCard(player);
  return verdict.reasons.every(reason => FRESHNESS_REASON.test(reason));
}
