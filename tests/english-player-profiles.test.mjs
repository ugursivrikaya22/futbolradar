import test from 'node:test';
import assert from 'node:assert/strict';
import { englishProfilePlayers, englishProfileGate } from '../scripts/lib/englishPlayerProfiles.mjs';

const urls = {
  resolveId: id => id === 'current-id' ? 'former-id' : id,
  enPlayerPagePath: () => 'en/player/published-name.html'
};
const view = player => ({ verified: player.verified });
test('a verified renamed record retains its published profile when the old ID is absent', () => {
  const current = {id:'current-id',verified:true};
  assert.deepEqual(englishProfilePlayers([current],urls,view),[current]);
});
test('an extant verified canonical record wins without generating duplicate pages', () => {
  const current = {id:'current-id',verified:true}, canonical={id:'former-id',verified:true};
  for (const players of [[current,canonical],[canonical,current]])
    assert.deepEqual(englishProfilePlayers(players,urls,view),[canonical]);
});
test('aliases never make unverified players eligible for publication', () => {
  assert.deepEqual(englishProfilePlayers([{id:'current-id',verified:false}],urls,view),[]);
});
test('a stale unverified canonical record cannot suppress its verified replacement', () => {
  const current={id:'current-id',verified:true};
  assert.deepEqual(englishProfilePlayers([{id:'former-id',verified:false},current],urls,view),[current]);
});
test('page gate keeps a stale-but-identified profile and hides its stats', async () => {
  const { createRequire } = await import('node:module');
  const { evaluatePlayerCard, publicPlayerView } = createRequire(import.meta.url)('../services/cardCredibility.js');
  const old = { id: 'p1', name: 'Test Player', providerId: '123456', sourceUrl: 'https://example.com/p', lastVerifiedAt: '2026-01-01T00:00:00Z', goals: 9 };
  assert.equal(englishProfileGate(old, evaluatePlayerCard), true);
  assert.equal(publicPlayerView(old).verified, false);
  assert.equal('goals' in publicPlayerView(old).fields, false);
  assert.equal(englishProfileGate({ ...old, providerId: 'mock-x' }, evaluatePlayerCard), false);
  assert.equal(englishProfileGate({ ...old, sourceUrl: '' }, evaluatePlayerCard), false);
});
