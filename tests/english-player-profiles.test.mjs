import test from 'node:test';
import assert from 'node:assert/strict';
import { englishProfilePlayers } from '../scripts/lib/englishPlayerProfiles.mjs';

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
