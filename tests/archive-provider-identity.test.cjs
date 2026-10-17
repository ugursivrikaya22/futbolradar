const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArchive } = require('../services/historicalMatchArchive');
const { buildReportRecord, syncPostMatchReports } = require('../services/postMatchReportStore');

test('provider identity survives report/archive round trips without inventing missing IDs', () => {
  const base = { id: 'stable-local-url', homeTeam: 'Ajax', awayTeam: 'Roma', kickoff: '2026-10-01T20:00:00+03:00', league: 'Friendly', status: 'FINISHED', score: { home: 1, away: 0 } };
  for (const identity of [{ providerId: '123' }, { fixtureId: '123' }, { providerIds: { apiFootball: '123' } }, { providerIds: { 'api-football': '123' } }, {}]) {
    const archived = buildArchive({ sources: [{ name: 'report', records: [{ ...base, ...identity }] }], previous: { records: [] }, now: '2026-10-02T00:00:00Z' }).records[0].match;
    const report = buildReportRecord(archived, { apiKeyPresent: false, generatedAt: '2026-10-02T00:00:00Z' });
    assert.equal(report.matchId, base.id);
    assert.equal(report.fixtureId, Object.keys(identity).length ? '123' : null);
  }
});

test('reused report repairs its source ID without regenerating text or timestamps', () => {
  const match = { id: 'stable-local-url', providerIds: { apiFootball: '123' }, homeTeam: 'Ajax', awayTeam: 'Roma', kickoff: '2026-10-01T20:00:00+03:00', league: 'Friendly', status: 'FINISHED', score: { home: 1, away: 0 } };
  const previous = { ...buildReportRecord(match, { apiKeyPresent: false, generatedAt: '2026-10-02T00:00:00Z' }), fixtureId: null };
  const result = syncPostMatchReports({ matches: [match], previous: [previous], generatedAt: '2026-10-03T00:00:00Z', apiKeyPresent: false });
  assert.equal(result.stats.regenerated, 0);
  assert.equal(result.stats.reused, 1);
  assert.deepEqual(result.records[0], { ...previous, fixtureId: '123' });
});
