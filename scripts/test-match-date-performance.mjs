import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('app.js', 'utf8');
const block = source.match(/\/\/ daily-headlines:start([\s\S]*?)\/\/ daily-headlines:end/);
assert.ok(block, 'Daily match date helpers must remain available');

// The headline block asks the shared live-freshness gate for its grace window
// (services/matchStatus.js, mirrored into app.js as `LiveGuard`), so the gate
// has to be in scope here too. It is injected rather than stubbed: a stub
// would let this gate drift from the one production actually runs.
//
// It allocates no formatter on its own — `LiveGuard`'s Intl instance is built
// lazily on first use and nothing below calls into it — so the one-formatter
// budget asserted at the end still measures `istanbulDayOf` alone.
const guard = source.match(/\/\/ live-freshness-guard:start([\s\S]*?)\/\/ live-freshness-guard:end/);
assert.ok(guard, 'app.js must carry the live-freshness-guard block');
let allocations = 0;
const countingIntl = {
  DateTimeFormat: function (...args) {
    allocations++;
    return new Intl.DateTimeFormat(...args);
  }
};
const dayOf = new Function('Intl', `${guard[1]}\n${block[1]}; return istanbulDayOf;`)(countingIntl);
assert.equal(dayOf('2026-09-09T22:30:00Z'), '2026-09-10', 'UTC midnight boundary must use Istanbul');
assert.equal(dayOf('2026-09-09T00:30:00+03:00'), '2026-09-09');
assert.equal(dayOf('2026-09-09'), '2026-09-09');
assert.equal(dayOf('invalid'), 'invalid');
assert.equal(dayOf(''), '');
// A live refresh filters/sorts the same fixtures many times. Recreating ICU
// formatters in this hot path froze the browser for over 50 seconds.
for (let i = 0; i < 20000; i++) {
  assert.equal(dayOf(`2026-09-09T${String(i % 21).padStart(2, '0')}:30:00Z`), '2026-09-09');
}
assert.equal(allocations, 1, 'Match comparisons must reuse one timezone formatter');
console.log('Match date regression passed: 20,000 conversions, one formatter, correct timezone boundaries.');
