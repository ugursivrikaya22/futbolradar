import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
console.log('Optional match analysis passed: empty enrichment is quiet; existing API contracts and records are preserved.');
