const { resolveCompetitionId } = require('./competitionCatalog');
const IDS = ['super-lig', '1-lig', 'tff-2-lig', 'tff-3-lig', 'sampiyonlar-ligi', 'avrupa-ligi', 'konferans-ligi'];
const PROVIDER = { 203: 0, 204: 1, 205: 2, 2: 4, 3: 5, 848: 6, 5: 8, 39: 9, 140: 10, 135: 11, 78: 12, 61: 13, 88: 14, 94: 15, 253: 16, 71: 17, 128: 18 };
function fixturePriority(match) {
  const providerId = match.providerLeagueId || match.leagueId;
  if (providerId && Object.hasOwn(PROVIDER, providerId)) return PROVIDER[providerId];
  const id = resolveCompetitionId({ ...match, providerLeagueId: providerId });
  if (/turkey|türkiye|turkiye/i.test(match.country || '') && /(?:^|tff\s*)3\.?\s*lig/i.test(match.league || '')) return 3;
  const tr = IDS.indexOf(id);
  if (tr >= 0) return tr;
  if (/nations.league|uluslar.ligi/i.test(match.league || '')) return 8;
  if (/world cup|euro championship|international|milli|dünya kupası/i.test(match.league || '')) return 7;
  const other = ['premier-league', 'la-liga', 'serie-a', 'bundesliga', 'ligue-1', 'eredivisie', 'primeira-liga', 'mls'];
  const index = other.indexOf(id);
  if (index >= 0) return index + 9;
  if (/brazil|brezilya/i.test(match.country || '')) return 17;
  if (/argentina|arjantin/i.test(match.country || '')) return 18;
  return 19;
}
module.exports = { fixturePriority };
