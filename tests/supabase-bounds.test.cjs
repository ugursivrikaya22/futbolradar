const test = require('node:test');
const assert = require('node:assert/strict');
const client = require('../services/supabase/client');
const env = require('../services/supabase/env');
test('select bounds every request and rejects invalid limits before network access', async t => {
  t.mock.method(env, 'isConfigured', () => true);
  t.mock.method(env, 'restUrl', () => 'https://example.test');
  t.mock.method(env, 'serviceKey', () => 'test-only');
  const urls = [];
  t.mock.method(global, 'fetch', async url => { urls.push(url); return { ok: true, text: async () => '[]' }; });
  await client.select('matches');
  assert.equal(new URL(urls[0]).searchParams.get('limit'), '1000');
  await client.select('matches', { limit: 1 });
  assert.equal(new URL(urls[1]).searchParams.get('limit'), '1');
  for (const limit of [0, -1, 1001, Infinity, NaN, 1.5, '1000']) await assert.rejects(client.select('matches', { limit }), RangeError);
  assert.equal(urls.length, 2);
});
