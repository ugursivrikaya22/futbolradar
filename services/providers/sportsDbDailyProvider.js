const { fetchWithCache } = require('../providerCache');
const { istanbulDay, canonicalStatus } = require('../matchStatus');

// This backup is deliberately marked partial: the public plan caps a day at
// three events. An empty response can never certify an empty football day.
function normalizeEvent(event) {
  const raw = event.strTimestamp || (event.dateEvent && event.strTime ? `${event.dateEvent}T${event.strTime}` : '');
  const kickoff = raw && !/(Z|[+-]\d\d:\d\d)$/i.test(raw) ? raw + 'Z' : raw;
  if (!event.idEvent || !event.strHomeTeam || !event.strAwayTeam || !Number.isFinite(Date.parse(kickoff))) return null;
  const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  return {
    id: `thesportsdb-${event.idEvent}`, providerId: String(event.idEvent),
    providerIds: { theSportsDb: String(event.idEvent) }, source: 'thesportsdb', dataStatus: 'provider',
    league: event.strLeague || '', kickoff, homeTeam: event.strHomeTeam, awayTeam: event.strAwayTeam,
    status: canonicalStatus(event.strStatus), providerStatus: event.strStatus || null,
    score: { home: number(event.intHomeScore), away: number(event.intAwayScore) },
    venue: event.strVenue || null, fetchedAt: new Date().toISOString(), coverage: 'partial'
  };
}

async function getMatches(query = {}) {
  if (query.live || query.league) return [];
  const date = query.date || istanbulDay(new Date().toISOString());
  const previous = new Date(`${date}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const days = [previous.toISOString().slice(0, 10), date];
  const result = await fetchWithCache('matches', { provider: 'thesportsdb-daily', date }, async () => {
    const rows = [];
    for (const day of days) {
      const key = process.env.THESPORTSDB_API_KEY || '123';
      const response = await fetch(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/eventsday.php?d=${day}&s=Soccer`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw Object.assign(new Error('Fixture backup unavailable'), { code: 'BACKUP_HTTP_ERROR', statusCode: response.status });
      const body = await response.json();
      if (!Object.hasOwn(body, 'events') || (body.events !== null && !Array.isArray(body.events))) throw new Error('Invalid fixture backup response');
      rows.push(...(body.events || []).map(normalizeEvent).filter(Boolean));
    }
    return [...new Map(rows.filter(row => istanbulDay(row.kickoff) === date).map(row => [row.id, row])).values()];
  });
  return result.data;
}

module.exports = { name: 'thesportsdb-daily', source: 'TheSportsDB daily backup', partialCoverage: true, getMatches, normalizeEvent };
