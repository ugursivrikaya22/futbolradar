const { sameClub } = require('./superLigTeams');
const { seasonLabel } = require('./playerHubContext');

// Called only with the /players season response, never a squad response.
function refreshPlayerSeasonStats(local, provider, season) {
  const stamp = provider && provider.fetchedAt;
  if (!provider || !/^\d+$/.test(String(provider.providerId)) ||
      String(local.providerId) !== String(provider.providerId) ||
      !sameClub(local.currentTeam, provider.currentTeam) ||
      !seasonLabel(season) || !Number.isFinite(Date.parse(stamp)) ||
      Date.parse(stamp) > Date.now() ||
      Date.parse(stamp) < Date.parse(local.statsVerifiedAt || '1970-01-01') ||
      !provider.stats || !Object.values(provider.stats).some(value => typeof value === 'number' && Number.isFinite(value))) return local;
  const stats = Object.fromEntries(Object.entries(provider.stats).map(([key,value]) =>
    [key, typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null]));
  stats.minutesPlayed = stats.minutes ?? null;
  const verified = Object.keys(stats).filter(key => stats[key] !== null);
  return {
    ...local, stats, ...stats,
    // Provider ratings use a different scale from the site's existing rating model.
    rating: local.rating, aiRating: local.aiRating, overallRating: local.overallRating,
    statsVerifiedFields: verified.filter(key => key !== 'rating'),
    statsVerifiedAt: stamp, statsUpdatedAt: stamp, statsSeason: seasonLabel(season),
    statsSource: 'API-Football /players · ' + seasonLabel(season),
    statsScope: 'all-competitions', lastVerifiedAt: stamp
  };
}

module.exports = { refreshPlayerSeasonStats };
