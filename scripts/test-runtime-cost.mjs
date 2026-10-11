import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Count expensive ICU conversions, not machine-dependent milliseconds.
let conversions = 0;
const context = { module: { exports: {} }, Intl: {
  DateTimeFormat: function (...args) {
    const formatter = new Intl.DateTimeFormat(...args);
    return { format(value) { conversions++; return formatter.format(value); } };
  }
}};
vm.runInNewContext(fs.readFileSync('services/matchStatus.js', 'utf8'), context);
const status = context.module.exports;
for (let i = 0; i < 10000; i++) assert.equal(status.istanbulDay('2026-10-11T22:00:00Z'), '2026-10-12');
assert.equal(conversions, 1);
assert.equal(status.istanbulDay('2026-10-11T20:00:00Z'), '2026-10-11');
assert.equal(status.istanbulDay('2026-10-11T23:00:00+03:00'), '2026-10-11');
assert.equal(status.istanbulDay('invalid'), 'invalid');
assert.equal(status.istanbulDay(null), '');
for (let i = 0; i < 8300; i++) status.istanbulDay(new Date(1700000000000 + i * 1000).toISOString());
const before = conversions;
assert.equal(status.istanbulDay('2026-10-11T22:00:00Z'), '2026-10-12');
assert.equal(conversions, before + 1, 'bounded cache evicts old entries');

const provider = require('../services/providers/mockProvider');
const { normalizeText, cacheControlFor } = require('../api/_utils');
const broadcast = require('../services/broadcastSchedule');
const oldWarn = console.warn;
const originalBroadcast = broadcast.applyVerifiedBroadcast;
console.warn = () => {};
try {
  const reference = provider.curatedMatches().map(provider.normalizeMatchDetail);
  const selected = [reference[0], reference[Math.floor(reference.length / 2)], reference.at(-1)];
  const identifiers = selected.flatMap(row => [row.id, row.fixtureId, row.providerIds?.apiFootball]).filter(Boolean);
  for (const id of [...identifiers, 'not-a-match']) {
    const wanted = normalizeText(id);
    const expected = reference.find(row => normalizeText(row.id) === wanted || normalizeText(row.fixtureId) === wanted ||
      (row.providerIds?.apiFootball && normalizeText(row.providerIds.apiFootball) === wanted)) || null;
    let normalizations = 0;
    broadcast.applyVerifiedBroadcast = row => { normalizations++; return originalBroadcast(row); };
    assert.deepEqual(await provider.getMatchDetail({ fixtureId: id }), expected);
    assert.equal(normalizations, expected ? 1 : 0, 'normalize only the requested match');
  }
  assert.deepEqual(await provider.getMatchDetail({}), reference[0]);
  broadcast.applyVerifiedBroadcast = originalBroadcast;
  const allMatches = provider.curatedMatches().map(provider.normalizeMatch);
  const { istanbulDay } = require('../services/matchStatus');
  for (const date of ['2026-10-11', '2026-10-12', '2099-01-01', 'all']) {
    const expected = date === 'all' ? allMatches : allMatches.filter(row => istanbulDay(row.kickoff || row.date || row.utcDate) === date);
    let normalizations = 0;
    broadcast.applyVerifiedBroadcast = row => { normalizations++; return originalBroadcast(row); };
    assert.deepEqual(await provider.getMatches({ date }), expected);
    assert.equal(normalizations, expected.length, 'normalize only matches in the requested window');
  }
  // Live HTTP responses and streams still bypass CDN and browser caches.
  for (const policy of ['matches-live', 'match-detail-live', 'live-stream', 'live-latency']) {
    assert.deepEqual(cacheControlFor(policy), { browser: 'no-store', cdn: 'no-store' });
  }
} finally {
  console.warn = oldWarn;
  broadcast.applyVerifiedBroadcast = originalBroadcast;
}
console.log('Runtime cost checks passed: bounded date memo, identical match detail, one normalization, live no-store.');
