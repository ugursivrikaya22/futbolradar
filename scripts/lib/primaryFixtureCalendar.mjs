import { createRequire } from 'node:module';
import { mergeCalendarMatches } from '../sync-live-fixtures.mjs';
const require = createRequire(import.meta.url);
const { evaluateLeagueIdentity } = require('../../services/teamSyncService.js');
const { istanbulDay } = require('../../services/matchStatus.js');

export async function primaryFixtureCalendar({ previous, fetchSeason, today, now = new Date().toISOString() }) {
  // One existing-provider season request replaces 36 limited public requests.
  const season = await fetchSeason();
  const teams = [...new Set(season.flatMap(m => [m.homeTeam, m.awayTeam]))].map(name => ({ name }));
  if (!evaluateLeagueIdentity(teams).safe) throw new Error('calendar-league-identity-mismatch');
  const start = Date.parse(`${today}T00:00:00+03:00`) - 3 * 86400000;
  const end = Date.parse(`${today}T00:00:00+03:00`) + 36 * 86400000;
  const inWindow = m => Date.parse(m.kickoff) >= start && Date.parse(m.kickoff) < end;
  const incoming = season.filter(inWindow);
  if (!incoming.length) throw new Error('calendar-empty-window');
  const leagues = new Set(incoming.map(m => String(m.providerLeagueId)));
  const prior = (previous.matches || []).filter(m => inWindow(m) && leagues.has(String(m.providerLeagueId)));
  if (prior.length >= 6 && incoming.length < prior.length * 0.5) throw new Error('calendar-window-count-drop');
  const merged = mergeCalendarMatches(previous.matches || [], incoming);
  // Keep the original calendar retention bound. History lives in the archive;
  // retaining every expired global fixture here would grow the browser payload.
  const kept = merged.matches.filter(m => !Number.isFinite(Date.parse(m.kickoff)) || Date.parse(m.kickoff) >= start);
  return {
    ...previous, provider: 'api-football', source: 'API-Football',
    providers: [...new Set([...(previous.providers || []), 'api-football'])],
    fetchedAt: now, windowDays: { past: 3, future: 35 },
    coverageMode: 'super-lig-season-window', returnedInWindow: incoming.length,
    requestFailures: 0, matches: kept,
    calendarSync: { provider: 'api-football', day: istanbulDay(now), requests: 1, added: merged.added, updated: merged.updated, pruned: merged.matches.length - kept.length }
  };
}
