import test from 'node:test';
import assert from 'node:assert/strict';
import { planAlert } from '../scripts/notify-operations.mjs';
test('critical incidents open once, change, and close on recovery', () => {
  const report = { checkedAt: '2026-10-17', issues: ['provider-failed'] };
  const first = planAlert(report, null, 'https://example.test/run');
  assert.equal(first.action, 'create');
  const existing = { number: 4, body: first.body };
  assert.equal(planAlert({ ...report, checkedAt: 'later' }, existing, 'another-run').action, 'none');
  assert.equal(planAlert({ ...report, issues: ['scheduler-failed'] }, existing, 'url').action, 'edit');
  assert.deepEqual(planAlert({ issues: [] }, existing, 'url'), { action: 'close', number: 4 });
  assert.equal(planAlert({ issues: [] }, null, 'url').action, 'none');
  assert.throws(() => planAlert({}, existing, 'url'));
});
