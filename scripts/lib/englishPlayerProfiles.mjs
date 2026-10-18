// Slug aliases can outlive a provider's old player ID. Keep the published URL
// when a verified current record exists, even if its former canonical ID does not.
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
