import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { istanbulDay } = require('../services/matchStatus');
const date = process.argv.find(arg => arg.startsWith('--date='))?.slice(7) || istanbulDay(new Date().toISOString());
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date');
const calendar = JSON.parse(fs.readFileSync('data/fixture-calendar.json', 'utf8'));
const repositoryRows = calendar.matches.filter(row => istanbulDay(row.kickoff) === date);
const repositoryCount = repositoryRows.length;
const identities = row => [row.id, row.providerIds?.apiFootball && `api-football:${row.providerIds.apiFootball}`].filter(Boolean).map(String);
try {
  const origin = process.env.SITE_URL || 'https://www.futbolradar.com';
  const response = await fetch(`${origin}/api/matches?date=${date}`, { signal: AbortSignal.timeout(15000) });
  const payload = await response.json();
  if (!response.ok || !payload.ok || !Array.isArray(payload.data)) throw new Error('Production match response unavailable');
  const productionCount = payload.data.filter(row => istanbulDay(row.kickoff) === date).length;
  const published = new Set(payload.data.flatMap(identities));
  const missingFixtureIds = repositoryRows.filter(row => !identities(row).some(id => published.has(id))).map(row => row.id);
  const failed = missingFixtureIds.length > 0;
  console.log(JSON.stringify({ date, timezone: 'Europe/Istanbul', repositoryCount, productionCount, missingFixtureIds, repositoryFetchedAt: calendar.fetchedAt, status: failed ? 'PUBLICATION_FAILED' : 'OK', fixtureHealth: payload.meta?.fixtureHealth || null }));
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ date, timezone: 'Europe/Istanbul', repositoryCount, status: 'UNAVAILABLE', error: error.message }));
  process.exitCode = 1;
}
