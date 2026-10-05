import assert from 'node:assert/strict';
import fs from 'node:fs';
import { predictionCardHtml, formSectionHtml } from './lib/matchSeoPage.mjs';

const ctx = { locale: 'en', homeTeam: 'Italy', awayTeam: 'Türkiye' };
const base = { source: 'market_probability', probabilities: { home: 60, draw: 25, away: 15 } };
for (const missing of [null, undefined, '']) {
  const html = predictionCardHtml({ ...base, bothTeamsScore: missing }, ctx);
  assert.ok(html.includes('Market probability'));
  assert.ok(!html.includes('Both teams to score'));
  assert.ok(!html.includes('null%'));
}
assert.ok(predictionCardHtml({ ...base, bothTeamsScore: 0 }, ctx).includes('0%'));
const form = formSectionHtml({ home: [{ result: 'D', label: 'Türkiye 1-1 İtalya', match: { homeTeam: 'Türkiye', awayTeam: 'İtalya', kickoff: '2026-09-28T18:45:00Z', score: { home: 1, away: 1 } } }] }, ctx);
assert.ok(form.includes('1-1 Italy'));
assert.ok(form.includes('>D</span>'));
// Inspect the actual generated production fixture, including archive/calendar aliases.
const page = fs.readFileSync('en/match/italy-turkiye-october-5-2026.html', 'utf8');
const section = page.match(/<section[^>]*id="form"[\s\S]*?<\/section>/)?.[0];
assert.ok(section);
const cards = [...section.matchAll(/<article[\s\S]*?<\/article>/g)].map(m => m[0]);
assert.equal(cards.length, 2);
for (const card of cards) assert.equal((card.match(/datetime="2026-09-28/g) || []).length, 1, 'same fixture must appear once per team');
assert.ok(!page.includes('null%'));
console.log('Match detail data polish: missing values, EN draw labels and generated history deduplication PASS');
