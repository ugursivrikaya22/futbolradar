import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestBreaker, isRetryableRequestError } from '../scripts/lib/requestBreaker.mjs';

test('breaker stops after consecutive failures and resets on success', () => {
  const b = createRequestBreaker({ maxConsecutiveFailures: 3, budgetMs: 1e9 });
  b.record(false); b.record(false);
  assert.equal(b.stopReason(), null);
  b.record(true); b.record(false); b.record(false);
  assert.equal(b.stopReason(), null);
  b.record(false);
  assert.match(b.stopReason(), /3 consecutive request failures/);
  assert.equal(b.failures, 5);
});

test('breaker stops when the time budget is spent', () => {
  let t = 1000;
  const b = createRequestBreaker({ budgetMs: 60000, now: () => t });
  assert.equal(b.stopReason(), null);
  t += 59999; assert.equal(b.stopReason(), null);
  t += 1; assert.match(b.stopReason(), /time budget of 60s/);
});

test('only transient errors are retried', () => {
  const http = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
  assert.equal(isRetryableRequestError(http(404)), false);
  assert.equal(isRetryableRequestError(http(403)), false);
  assert.equal(isRetryableRequestError(http(429)), true);
  assert.equal(isRetryableRequestError(http(503)), true);
  assert.equal(isRetryableRequestError(new Error('fetch failed')), true);
  assert.equal(isRetryableRequestError(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
});
