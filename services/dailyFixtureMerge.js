const { istanbulDay } = require('./matchStatus');
const { sameClub } = require('./superLigTeams');
function apiId(row) {
  return row.providerIds?.apiFootball || (String(row.source).includes('api-football') ? row.providerId : null);
}
function sameFixture(a, b) {
  if (apiId(a) && apiId(b)) return String(apiId(a)) === String(apiId(b));
  if (a.providerIds?.theSportsDb && b.providerIds?.theSportsDb) return String(a.providerIds.theSportsDb) === String(b.providerIds.theSportsDb);
  if (a.id === b.id && a.source === b.source) return true;
  return istanbulDay(a.kickoff) === istanbulDay(b.kickoff) &&
    sameClub(a.homeTeam, b.homeTeam) && sameClub(a.awayTeam, b.awayTeam);
}
function mergeDailyMatches(primary, stored) {
  const rows = primary.map(row => ({ ...row }));
  for (const saved of stored) {
    const index = rows.findIndex(row => sameFixture(row, saved));
    if (index < 0) rows.push(saved);
    else rows[index] = { ...saved, ...rows[index], id: saved.id, providerIds: { ...saved.providerIds, ...rows[index].providerIds } };
  }
  return rows;
}
module.exports = { sameFixture, mergeDailyMatches };
