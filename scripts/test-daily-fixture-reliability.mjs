import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { synchronizeLiveFixtures, mergeCalendarMatches } from './sync-live-fixtures.mjs';
const require = createRequire(import.meta.url);
const { istanbulDay, canonicalStatus } = require('../services/matchStatus');
const { fixturePriority } = require('../services/dailyFixturePriority');
const api = require('../services/providers/apiFootballProvider');
const { clearProviderCache } = require('../services/providerCache');
const now = new Date('2026-10-04T12:00:00+03:00');
const row = { id: '123', providerId: '123', providerLeagueId: '205', league: '2. Lig', country: 'Turkey', source: 'api-football', homeTeam: 'Alt Lig Ev', awayTeam: 'Alt Lig Deplasman', kickoff: '2026-10-03T21:30:00Z', status: 'NS', score: { home: null, away: null } };
const noBackup = { getMatches: async () => [] };

// A: No Premier League fixture; lower Turkish leagues must survive the real adapter.
process.env.APIFOOTBALL_API_KEY = 'a'.repeat(32);
const originalFetch = global.fetch;
global.fetch = async url => {
  const query = new URL(url).searchParams;
  assert.equal(query.get('timezone'), 'Europe/Istanbul');
  return { ok: true, status: 200, headers: new Headers(), json: async () => ({ errors: [], response: [{ fixture: { id: 123, date: row.kickoff, status: { short: 'NS' } }, league: { id: 205, name: '2. Lig', country: 'Turkey' }, teams: { home: { name: row.homeTeam }, away: { name: row.awayTeam } } }] }) };
};
clearProviderCache();
assert.equal((await api.getFixtures({ date: '2026-10-04', fresh: true })).length, 1);
assert.equal((await api.getFixtures({ date: '2026-10-04', league: '39', fresh: true })).length, 0);
global.fetch = originalFetch;
delete process.env.APIFOOTBALL_API_KEY;
assert.equal(fixturePriority(row), 2);
assert.ok(fixturePriority(row) < fixturePriority({ providerLeagueId: '39' }));

// B: 00:30 Istanbul is the following UTC calendar day.
assert.equal(istanbulDay(row.kickoff), '2026-10-04');
assert.equal(istanbulDay('2026-10-04T21:30:00Z'), '2026-10-05');
const provider = { getFixtures: async query => query.date === '2026-10-04' ? [row] : [], getMatchDetail: async () => null };
const first = await synchronizeLiveFixtures({ provider, backupProvider: noBackup, now, previous: { matches: [] } });
assert.equal(first.summary.frontendVisible, 1);
assert.equal(first.output.fixtureHealth.lastSuccessfulSyncAt, now.toISOString());

// C: A quota failure preserves every saved fixture and the last successful sync.
let calls = 0;
const failed = await synchronizeLiveFixtures({ provider: { getFixtures: async () => { calls++; throw Object.assign(new Error('quota'), { code: 'PROVIDER_RATE_LIMIT' }); } }, backupProvider: noBackup, now, previous: first.output });
assert.equal(calls, 1, 'quota failure must stop repeated primary requests');
assert.equal(failed.output.matches.length, 1);
assert.equal(failed.summary.status, 'degraded');
assert.equal(failed.output.fixtureHealth.lastSuccessfulSyncAt, first.output.fixtureHealth.lastSuccessfulSyncAt);

// D/E: Repeat runs update by provider id, even if kickoff changes; FT updates score.
const twice = mergeCalendarMatches(first.output.matches, [row, row]);
assert.equal(twice.matches.length, 1);
const finished = mergeCalendarMatches(twice.matches, [{ ...row, kickoff: '2026-10-04T17:00:00Z', status: 'FT', score: { home: 3, away: 2 } }]);
assert.equal(finished.matches.length, 1);
assert.equal(finished.matches[0].id, first.output.matches[0].id, 'existing URLs remain stable');
assert.equal(finished.matches[0].status, 'FINISHED');
assert.equal(finished.matches[0].score.home, 3);
for (const status of ['NS', '1H', 'HT', '2H', 'ET', 'P', 'FT', 'PST', 'CANC', 'SUSP']) assert.notEqual(canonicalStatus(status), 'UNKNOWN');

// A partial backup cannot certify an empty day; its provider ids stay namespaced.
const backupRow = { ...row, id: 'thesportsdb-987', providerId: '987', providerIds: { theSportsDb: '987' }, source: 'thesportsdb' };
const backup = await synchronizeLiveFixtures({ provider: { getFixtures: async () => { throw Object.assign(new Error('offline'), { code: 'PROVIDER_AUTH_ERROR' }); } }, backupProvider: { getMatches: async q => q.date === '2026-10-04' ? [backupRow] : [] }, now, previous: { matches: [] } });
assert.equal(backup.summary.frontendVisible, 1);
assert.equal(backup.summary.status, 'degraded');
assert.equal(backup.output.matches[0].providerIds.apiFootball, undefined);
console.log('PASS: daily fixtures A–E, lower leagues, Istanbul boundaries, quota, backup provenance, stable URLs and all required statuses.');

// Both locales use the complete persisted pool (including non-catalogue leagues).
const mock = require('../services/providers/mockProvider');
const backupAdapter = require('../services/providers/sportsDbDailyProvider');
const originalBackup = backupAdapter.getMatches;
backupAdapter.getMatches = async () => [];
const oldWarn = console.warn; console.warn = () => {};
const expected = mock.curatedMatches().filter(row => istanbulDay(row.kickoff) === '2026-10-04');
assert.equal((await mock.getMatches({date:'2026-10-04'})).length, expected.length);
const handler = require('../api/matches');
async function read(locale) {
  let payload;
  const res = { setHeader() {}, status() { return this; }, json(value) { payload = value; }, end(value) { payload = JSON.parse(value); } };
  await handler({ method:'GET', query:{date:'2026-10-04',locale}, headers:{}, socket:{remoteAddress:'test-fixtures-' + locale} },res);
  return payload;
}
const tr = await read('tr'), en = await read('en');
assert.equal(tr.ok, true); assert.equal(en.ok, true);
assert.deepEqual(tr.data.map(row=>row.id),en.data.map(row=>row.id));
assert.equal(tr.data.length, expected.length);
console.warn = oldWarn; backupAdapter.getMatches = originalBackup;
console.log('PASS: persisted pool and TR/EN endpoint parity: ' + expected.length);

const footballData = require('../services/providers/footballProvider');
process.env.FOOTBALL_API_KEY = 'fixture-date-test';
const savedFetch = global.fetch;
global.fetch = async url => {
 const q = new URL(url).searchParams;
 assert.equal(q.get('dateFrom'), '2026-10-03');
 assert.equal(q.get('dateTo'), '2026-10-05');
 return { ok:true,status:200,headers:new Headers(),json:async()=>({matches:[
  {id:100,utcDate:'2026-10-03T21:30:00Z',homeTeam:{name:'Home'},awayTeam:{name:'Away'},competition:{name:'Regional Test League'},status:'TIMED'},
  {id:101,utcDate:'2026-10-04T21:30:00Z',homeTeam:{name:'Home2'},awayTeam:{name:'Away2'},competition:{name:'Regional Test League'},status:'TIMED'}
 ]}) };
};
clearProviderCache();
assert.deepEqual((await footballData.getMatches({date:'2026-10-04'})).map(row=>row.id), ['100']);
global.fetch = savedFetch; delete process.env.FOOTBALL_API_KEY;
console.log('PASS: football-data exclusive UTC range and Istanbul date filtering.');

const separate = mergeCalendarMatches(first.output.matches, [{ ...row, id:'124', providerId:'124' }]);
assert.equal(separate.matches.length, 2, 'different real provider fixture ids must not collapse into one match');
