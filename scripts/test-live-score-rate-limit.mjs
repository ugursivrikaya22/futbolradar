import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { handleLiveScoreStream } = require('../server/liveScoreStreamRoute');
const { enforceRateLimit } = require('../api/_utils');
const headers = { 'x-forwarded-for': '203.0.113.195' };
const makeResponse = () => ({
  headers: {}, statusCode: 200,
  setHeader(name, value) { this.headers[name] = value; },
  end(body) { this.body = body; }
});
async function request(method) {
  const response = makeResponse();
  await handleLiveScoreStream({
    method, url: '/api/live-score-stream', headers,
    body: { packetId: 'rate-limit-test', clientRenderedAt: '2026-09-10T00:00:00Z' }
  }, response);
  return response;
}
// Capture the real telemetry logger to validate accepted writes without
// printing 120 otherwise identical metrics in the unit-test output.
const originalLog = console.log;
const metrics = [];
try {
  console.log = message => { metrics.push(message); };
  for (let i = 0; i < 120; i++) assert.equal((await request('POST')).statusCode, 200);
  assert.equal(metrics.length, 120);
  assert.equal((await request('POST')).statusCode, 429, 'telemetry quota remains enforced');
  for (let i = 0; i < 30; i++) assert.equal((await request('HEAD')).statusCode, 200, 'telemetry must not consume stream connections');
  assert.equal((await request('HEAD')).statusCode, 429, 'connection quota remains enforced');
} finally { console.log = originalLog; }
const independent = makeResponse();
assert.equal(enforceRateLimit({ url: '/api/live-score-stream', headers: { 'x-forwarded-for': '203.0.113.196' } }, independent, { limit: 30, bucket: 'stream-connections' }), false);
console.log('live-score-rate-limit OK: 120 telemetry writes, 30 independent connections, both limits enforced per client');
