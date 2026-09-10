import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('app.js', 'utf8');
const block = source.match(/\/\/ daily-headlines:start([\s\S]*?)\/\/ daily-headlines:end/);
assert.ok(block, 'Daily match date helpers must remain available');
let allocations = 0;
const countingIntl = {
  DateTimeFormat: function (...args) {
    allocations++;
    return new Intl.DateTimeFormat(...args);
  }
};
const dayOf = new Function('Intl', `${block[1]}; return istanbulDayOf;`)(countingIntl);
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
