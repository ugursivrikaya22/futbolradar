import test from 'node:test';
import assert from 'node:assert/strict';
import { selectReconcileTargets, synchronizeLiveFixtures } from '../scripts/sync-live-fixtures.mjs';

test('a fixture missing from a verified day is checked before its old kickoff, within the existing cap', async () => {
  const now = new Date('2026-10-17T10:00:00+03:00');
  const previous = { id: 'stable-url', providerId: '555', providerIds: { apiFootball: '555' }, source: 'api-football', homeTeam: 'Home Test', awayTeam: 'Away Test', kickoff: '2026-10-17T17:00:00+03:00', status: 'SCHEDULED', score: { home: null, away: null } };
  const options = { nowMs: now.getTime(), seenProviderIds: new Set(), limit: 1 };
  assert.deepEqual(selectReconcileTargets([previous], options), [], 'failed/unrequested day must not bypass the grace period');
  const verifiedDays = new Set(['2026-10-17']);
  assert.equal(selectReconcileTargets([previous], { ...options, verifiedDays }).length, 1);
  assert.equal(selectReconcileTargets([previous], { ...options, verifiedDays, seenProviderIds: new Set(['555']) }).length, 0);
  assert.equal(selectReconcileTargets([previous, { ...previous, providerId: '556', providerIds: { apiFootball: '556' } }], { ...options, verifiedDays }).length, 1);
  let identityCalls = 0;
  const provider = {
    async getFixtures(query) {
      if (!query.fixtureId) return [];
      identityCalls++;
      return [{ ...previous, kickoff: '2026-11-11T20:30:00+03:00', providerStatus: 'NS', fetchedAt: now.toISOString() }];
    },
    async getMatchDetail() { return null; }
  };
  const result = await synchronizeLiveFixtures({ now, provider, backupProvider: { getMatches: async () => [] }, previous: { matches: [previous] }, reconcileLimit: 1 });
  assert.equal(identityCalls, 1);
  assert.equal(result.output.matches[0].id, 'stable-url');
  assert.equal(result.output.matches[0].kickoff, '2026-11-11T20:30:00+03:00');
  assert.equal(result.output.matches[0].rescheduledFrom, previous.kickoff);
  assert.equal(result.output.matches[0].score.home, null);
});
