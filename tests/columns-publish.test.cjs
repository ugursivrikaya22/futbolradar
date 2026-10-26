const test = require('node:test');
const assert = require('node:assert/strict');
const route = require('../server/columnsPublishRoute');
const env = require('../services/supabase/env');

const TOKEN = 'test-editor-token';
const good = { slug: 'yeni-yazi-26-ekim-2026', title: 'Başlık', excerpt: 'Özet', url: 'https://www.futbolradar.com/kose-yazilari/yeni-yazi.html' };

function mockRes() {
  return { headers: {}, statusCode: 0, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = JSON.parse(b); } };
}
async function call(t, { method = 'POST', auth = `Bearer ${TOKEN}`, body = good, configured = true, fetchImpl } = {}) {
  process.env.EDITOR_TOKEN = configured ? TOKEN : '';
  t.mock.method(env, 'restUrl', () => configured ? 'https://example.test' : '');
  t.mock.method(env, 'serviceKey', () => configured ? 'service-test-only' : '');
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init) => { calls.push({ url, init }); return fetchImpl ? fetchImpl() : { ok: true, status: 201, json: async () => [{ id: 'x', ...good }] }; });
  const res = mockRes();
  await route.handleColumnsPublish({ method, headers: auth ? { authorization: auth } : {}, body }, res);
  return { res, calls };
}

test('405 for non-POST', async t => { const { res, calls } = await call(t, { method: 'GET' }); assert.equal(res.statusCode, 405); assert.equal(calls.length, 0); });
test('503 when env missing', async t => { const { res } = await call(t, { configured: false }); assert.equal(res.statusCode, 503); });
test('401 for missing/bad token', async t => {
  assert.equal((await call(t, { auth: '' })).res.statusCode, 401);
  const { res, calls } = await call(t, { auth: 'Bearer wrong' });
  assert.equal(res.statusCode, 401); assert.equal(calls.length, 0);
});
test('400 for invalid bodies', async t => {
  for (const body of [null, { ...good, slug: 'Bad Slug' }, { ...good, url: 'https://evil.com/x' }, { ...good, url: 'http://www.futbolradar.com/x' }, { ...good, title: '' }, { ...good, excerpt: 'x'.repeat(601) }]) {
    assert.equal((await call(t, { body })).res.statusCode, 400);
  }
});
test('200 with inserted row, service key only in headers', async t => {
  const { res, calls } = await call(t);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.slug, good.slug);
  assert.equal(calls[0].url, 'https://example.test/rest/v1/columns');
  assert.equal(calls[0].init.headers.Prefer, 'return=representation');
  const sent = JSON.parse(calls[0].init.body);
  assert.ok(sent.published_at);
  assert.ok(!JSON.stringify(res.body).includes('service-test-only'));
  assert.ok(!JSON.stringify(res.body).includes(TOKEN));
});
test('409 on slug conflict, 502 on other upstream errors', async t => {
  assert.equal((await call(t, { fetchImpl: () => ({ ok: false, status: 409, json: async () => ({ code: '23505' }) }) })).res.statusCode, 409);
  assert.equal((await call(t, { fetchImpl: () => ({ ok: false, status: 500, json: async () => ({}) }) })).res.statusCode, 502);
  assert.equal((await call(t, { fetchImpl: () => { throw new Error('net'); } })).res.statusCode, 502);
});
