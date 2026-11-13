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
test('with includeUnverified an unverified player gets a page, but never displaces a verified owner', () => {
  const unverified = {id:'former-id',verified:false}, verified = {id:'current-id',verified:true};
  assert.deepEqual(englishProfilePlayers([unverified],urls,view,{includeUnverified:true}),[unverified]);
  for (const players of [[unverified,verified],[verified,unverified]])
    assert.deepEqual(englishProfilePlayers(players,urls,view,{includeUnverified:true}),[verified]);
});
test('with includeUnverified the canonical unverified record owns the address over its alias', () => {
  const alias = {id:'current-id',verified:false}, canonical = {id:'former-id',verified:false};
  for (const players of [[alias,canonical],[canonical,alias]])
    assert.deepEqual(englishProfilePlayers(players,urls,view,{includeUnverified:true}),[canonical]);
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

// --- Kıyas bağlantıları yalnızca üreticinin yazdığı sayfalara (sentetik veri) ---
import { createRequire } from 'node:module';
import { rewriteUnbuiltComparisonLinks, peerHrefForBuiltComparisons } from '../scripts/lib/englishPlayerProfiles.mjs';
const requireCjs = createRequire(import.meta.url);
const { createComparisonSlugResolver, profileCompareCandidates } = requireCjs('../services/playerComparisonPairs.js');

const synth = (id, extra = {}) => ({ id, name: id, position: 'Forvet', league: 'Test Lig', team: `club-${id}`, rating: 70, ...extra });

test('resolver exposes exactly the slugs the comparison generator builds for the pool', () => {
  const pool = ['p-a', 'p-b', 'p-c', 'p-d', 'p-e', 'p-f'].map((id, i) => synth(id, { rating: 60 + i }));
  const slugFor = createComparisonSlugResolver(pool, pool);
  for (const player of pool)
    for (const item of profileCompareCandidates(player, pool))
      assert.ok(slugFor.generatedSlugs.has(slugFor(player, item.player)));
});

test('a retained EN page linking to pairs no longer generated (fresh full-update data) is rewritten to the picker', () => {
  // Önceki koşuda üretilmiş sayfa: oyuncu "x-old" ile eşleşmişti; taze veride
  // x-old havuzda yok, o kıyas sayfası artık üretilmiyor.
  const fresh = ['p-a', 'p-b', 'p-c', 'p-d', 'p-e'].map((id) => synth(id));
  const slugFor = createComparisonSlugResolver(fresh, fresh);
  const kept = slugFor(fresh[0], profileCompareCandidates(fresh[0], fresh)[0].player);
  const html = `<a class="p360-peer" href="../../karsilastirma/p-a-vs-x-old.html">X</a>` +
    `<a class="p360-peer" href="../../karsilastirma/${kept}.html">Y</a>`;
  const out = rewriteUnbuiltComparisonLinks(html, slugFor.generatedSlugs, '../../oyuncu-karsilastir.html');
  assert.ok(!out.includes('p-a-vs-x-old'));
  assert.ok(out.includes('href="../../oyuncu-karsilastir.html"'));
  assert.ok(out.includes(`karsilastirma/${kept}.html`));
});

test('generated EN peer hrefs fall back to the picker when the pair page is not built', () => {
  const built = new Set(['p-a-vs-p-b']);
  assert.equal(peerHrefForBuiltComparisons('../../karsilastirma/p-a-vs-p-b.html', built, 'PICK'), '../../karsilastirma/p-a-vs-p-b.html');
  assert.equal(peerHrefForBuiltComparisons('../../karsilastirma/p-a-vs-p-z.html', built, 'PICK'), 'PICK');
});
