const test = require('node:test');
const assert = require('node:assert/strict');
const route = require('../server/tickerPublishRoute');
const env = require('../services/supabase/env');

const TOKEN = 'test-editor-token';
const item = { text: 'Galatasaray ocakta Brahim Díaz için yeniden harekete geçecek', status: 'dedikodu', league: 'Süper Lig', source_name: 'A Spor', source_url: 'https://www.aspor.com.tr/galatasaray/x' };
const good = { items: [item, { ...item, status: 'imza' }], replace: true };

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
  t.mock.method(global, 'fetch', async (url, init) => {
    calls.push({ url, init });
    if (fetchImpl) return fetchImpl(url, init, calls.length);
    if (init.method === 'PATCH') return { ok: true, status: 204, json: async () => null };
    return { ok: true, status: 201, json: async () => JSON.parse(init.body).map((r, i) => ({ id: `id-${i}`, ...r })) };
  });
  const res = mockRes();
  await route.handleTickerPublish({ method, headers: auth ? { authorization: auth } : {}, body }, res);
  return { res, calls };
}

test('405 for non-POST', async t => { const { res, calls } = await call(t, { method: 'GET' }); assert.equal(res.statusCode, 405); assert.equal(res.headers.allow, 'POST'); assert.equal(calls.length, 0); });
test('503 when env missing', async t => { const { res, calls } = await call(t, { configured: false }); assert.equal(res.statusCode, 503); assert.equal(calls.length, 0); });
test('401 for missing/bad token', async t => {
  assert.equal((await call(t, { auth: '' })).res.statusCode, 401);
  const { res, calls } = await call(t, { auth: 'Bearer wrong' });
  assert.equal(res.statusCode, 401); assert.equal(calls.length, 0);
});
test('400 for invalid bodies', async t => {
  const bad = [
    null, {}, { items: [] }, { items: 'x' },
    { items: Array.from({ length: 21 }, () => item) },
    { items: [{ ...item, status: 'kesin' }] },
    { items: [{ ...item, text: 'x'.repeat(221) }] },
    { items: [{ ...item, text: '' }] },
    { items: [{ ...item, source_name: '' }] },
    { items: [{ ...item, source_url: 'http://www.aspor.com.tr/x' }] },
    { items: [{ ...item, source_url: 'javascript:alert(1)' }] },
    { items: [{ ...item, source_url: 'https://www.transfermarkt.com.tr/x' }] },
    { items: [item], replace: 'yes' }
  ];
  for (const body of bad) {
    const { res, calls } = await call(t, { body });
    assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(calls.length, 0);
  }
});
test('200: replace expires old rows then inserts with 48h expiry', async t => {
  const before = Date.now();
  const { res, calls } = await call(t);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'PATCH');
  assert.ok(calls[0].url.startsWith('https://example.test/rest/v1/transfer_ticker?or='));
  assert.ok(JSON.parse(calls[0].init.body).expires_at);
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].url, 'https://example.test/rest/v1/transfer_ticker');
  assert.equal(calls[1].init.headers.Prefer, 'return=representation');
  const rows = JSON.parse(calls[1].init.body);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.sort), [0, 1]);
  const ttl = Date.parse(rows[0].expires_at) - before;
  assert.ok(ttl >= 48 * 3600e3 - 5000 && ttl <= 48 * 3600e3 + 5000);
  assert.equal(res.body.count, 2);
  assert.equal(res.body.data[0].status, 'dedikodu');
  const out = JSON.stringify(res.body);
  assert.ok(!out.includes('service-test-only')); assert.ok(!out.includes(TOKEN));
});
test('replace=false skips expiring', async t => {
  const { res, calls } = await call(t, { body: { items: [item], replace: false } });
  assert.equal(res.statusCode, 200); assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'POST');
});
test('502 on upstream errors', async t => {
  assert.equal((await call(t, { fetchImpl: () => ({ ok: false, status: 500, json: async () => ({}) }) })).res.statusCode, 502);
  const r = await call(t, { fetchImpl: (u, init) => init.method === 'PATCH' ? { ok: true, status: 204, json: async () => null } : { ok: false, status: 400, json: async () => ({}) } });
  assert.equal(r.res.statusCode, 502);
  assert.equal((await call(t, { fetchImpl: () => { throw new Error('net'); } })).res.statusCode, 502);
});
test('seed data/transfer-ticker.json passes route validation', () => {
  const seed = require('../data/transfer-ticker.json');
  const checked = route.validate({ items: seed.items, replace: true });
  assert.equal(checked.error, undefined, checked.error);
});
