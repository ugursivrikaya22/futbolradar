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
import { retainedEnglishPages } from '../scripts/lib/englishPlayerProfiles.mjs';
import { readFileSync } from 'node:fs';
test('pages outside the current dataset are retained, never deleted', () => {
  assert.deepEqual(retainedEnglishPages(['b.html','a.html','keep.html','notes.txt'], new Set(['keep.html'])), ['a.html','b.html']);
  const src = readFileSync(new URL('../scripts/generate-en-player-pages.mjs', import.meta.url), 'utf8');
  assert.equal(/rmSync|unlinkSync|rm\(/.test(src), false, 'EN player generator must not delete pages');
});
import { stripHreflangAlternates } from '../scripts/lib/englishPlayerProfiles.mjs';
test('retained pages drop one-sided hreflang alternates but keep canonical', () => {
  const html = '<link rel="canonical" href="x" />\n    <link rel="alternate" hreflang="en" href="y" />\n<title>t</title>';
  assert.equal(stripHreflangAlternates(html), '<link rel="canonical" href="x" />\n<title>t</title>');
});
