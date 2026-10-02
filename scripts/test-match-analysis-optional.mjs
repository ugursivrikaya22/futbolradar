import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const handler = require('../api/[...route].js');
const analyses = require('../data/match-analyses.json');
async function request(query) {
  const response = {
    statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; }
  };
  await handler({ method: 'GET', url: '/api/match-analysis?' + query, headers: {} }, response);
  return { status: response.statusCode, payload: JSON.parse(response.body) };
}
const missing = 'fixtureId=__interaction_audit_missing_fixture__';
const required = await request(missing);
const optional = await request(missing + '&optional=1');
assert.equal(required.status, 404, 'Existing resource lookup contract must remain unchanged');
assert.equal(optional.status, 200, 'An absent optional analysis is a normal empty response');
assert.deepEqual(optional.payload, required.payload);
assert.equal(optional.payload.data, null);
assert.equal(optional.payload.error.code, 'MATCH_ANALYSIS_NOT_FOUND');
const fixture = analyses.find(record => record.fixtureId);
assert.ok(fixture, 'Persisted analysis fixture missing');
const query = 'fixtureId=' + encodeURIComponent(fixture.fixtureId);
const existing = await request(query);
const existingOptional = await request(query + '&optional=1');
assert.equal(existing.status, 200);
assert.equal(existingOptional.status, 200);
assert.deepEqual(existingOptional.payload, existing.payload, 'Available analysis data must remain unchanged');

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function functionSource(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name + ' must remain available');
  return source.slice(start, source.indexOf('\n  function ', start + 1));
}
const config = source.match(/  var RESOURCE_CONFIG = \{[\s\S]*?\n  \};/);
assert.ok(config);
const flush = () => new Promise(resolve => setImmediate(resolve));
function analysisLoader(mode) {
  const timers = new Map(), requests = [];
  const context = {
    AbortController, API_ROOT: '/api/', DATA_ROOT: '/data/', FETCH_TIMEOUT_MS: 6500, cache: {},
    window: {
      AbortController, location: { protocol: 'http:' },
      setTimeout: (callback, delay) => { const id = Symbol(); timers.set(id, { callback, delay }); return id; },
      clearTimeout: id => timers.delete(id)
    },
    markStaticFallback: value => value, filterFallbackData: (_, value) => value,
    unwrapResourcePayload: value => ({ data: value }),
    fetch: (url, options) => {
      requests.push(url);
      if (url.startsWith('/api/') && mode === 'missing') return Promise.resolve({ json: async () => optional.payload });
      if (url.startsWith('/api/') && mode === 'available') return Promise.resolve({ json: async () => existing.payload });
      if (url.startsWith('/api/') && mode === 'failed') return Promise.reject(new Error('network-failure'));
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        if (url === '/data/match-analyses.json') context.completeStatic = () => resolve({ ok: true, json: async () => [fixture] });
      });
    }
  };
  vm.createContext(context);
  vm.runInContext(config[0] + ['fetchJson', 'loadData', 'fetchMatchAnalysisRecord'].map(functionSource).join('\n'), context);
  return { context, timers, requests };
}
for (const mode of ['failed', 'timeout']) {
  const { context, timers, requests } = analysisLoader(mode);
  const result = context.fetchMatchAnalysisRecord(fixture.fixtureId);
  if (mode === 'timeout') {
    assert.equal([...timers.values()][0].delay, 6500, 'API lookup must retain its short deadline');
    [...timers.values()][0].callback();
  }
  await flush();
  assert.equal(requests.at(-1), '/data/match-analyses.json');
  assert.equal([...timers.values()][0].delay, 30000, 'Large persisted analysis must survive the short API deadline');
  context.completeStatic();
  assert.equal(await result, fixture, 'Transport failure or API timeout must preserve persisted analysis');
  assert.equal(timers.size, 0, 'Completed requests must clear their timers');
}
for (const mode of ['missing', 'available']) {
  const { context, requests } = analysisLoader(mode);
  assert.deepEqual(await context.fetchMatchAnalysisRecord(fixture.fixtureId), mode === 'missing' ? null : fixture);
  assert.equal(requests.length, 1, 'Successful API responses must not trigger the static fallback');
}
const stalled = analysisLoader('failed');
const stalledResult = stalled.context.fetchMatchAnalysisRecord(fixture.fixtureId);
await flush();
[...stalled.timers.values()][0].callback();
assert.equal(await stalledResult, null, 'Static fallback must remain bounded when it never responds');
const ordinary = analysisLoader('failed');
const ordinaryResult = ordinary.context.loadData('news');
const rejection = assert.rejects(ordinaryResult, /aborted/);
assert.equal([...ordinary.timers.values()][0].delay, 6500, 'Unrelated resources must keep their existing deadline');
[...ordinary.timers.values()][0].callback();
await rejection;
console.log('Optional match analysis passed: empty enrichment is quiet; existing API contracts and records are preserved.');
