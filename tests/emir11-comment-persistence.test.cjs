const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../services/supabase/env');
const client = require('../services/supabase/client');
const store = require('../services/matchSocialStore');
const registry = require('../services/matchSeoPages');
let route;
const entry = { slug: 'comment-test-tr', enSlug: 'comment-test-en' };

function fixture(t, { comments = [], likes = [], failOffset = -1 } = {}) {
  const requests = [];
  t.mock.method(env, 'isConfigured', () => true);
  t.mock.method(env, 'restUrl', () => 'https://database.invalid');
  t.mock.method(env, 'serviceKey', () => 'test-only-key');
  t.mock.method(registry, 'loadRegistry', () => ({ pages: [entry] }));
  delete require.cache[require.resolve('../server/matchSocialRoute')];
  route = require('../server/matchSocialRoute');
  route.resetSlugIndex();
  t.after(() => route.resetSlugIndex());
  t.mock.method(global, 'fetch', async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://database.invalid');
    const table = url.pathname.split('/').pop();
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 1000);
    requests.push({ table, offset, limit, method: options.method });
    if (table === store.COMMENTS && options.method === 'POST') {
      for (const row of JSON.parse(options.body)) comments.push({ ...row, id: comments.length + 1, created_at: new Date().toISOString() });
      return new Response(null, { status: 201 });
    }
    if (table === store.LIKES && offset === failOffset) return new Response('{"message":"unavailable"}', { status: 503 });
    const rows = table === store.COMMENTS ? comments : likes;
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200 });
  });
  return { comments, requests };
}

async function call(method, slug) {
  let body;
  const req = { method, url: `/api/match-comments?slug=${slug}`, headers: { cookie: 'fr_poll_voter=' + 'a'.repeat(32) },
    body: { slug, name: 'Test', body: 'Comment persistence regression test.', locale: 'en' } };
  const res = { statusCode: 200, setHeader() {}, end(value) { body = JSON.parse(value); } };
  await route.handleMatchComments(req, res);
  return { status: res.statusCode, body };
}

test('first comment saves and reloads through the real route, store and bounded REST client', async t => {
  const state = fixture(t);
  assert.deepEqual((await call('GET', entry.slug)).body.data.comments, []);
  const saved = await call('POST', entry.slug);
  assert.equal(saved.status, 200);
  assert.equal(state.comments.length, 1);
  assert.equal(saved.body.data.comments.length, 1);
  const reload = await call('GET', entry.enSlug);
  assert.equal(reload.status, 200);
  assert.equal(reload.body.data.comments[0].id, saved.body.data.comments[0].id);
  assert.equal(reload.body.data.comments[0].body, 'Comment persistence regression test.');
  assert.equal(state.requests.filter(r => r.method === 'POST').length, 1);
  assert(state.requests.every(r => r.limit <= client.MAX_SELECT_ROWS));
});

test('likes beyond the first REST page retain their count and the viewer vote', async t => {
  const likes = Array.from({ length: 1001 }, (_, i) => ({ comment_id: 1, voter_key: i === 1000 ? 'viewer' : `voter-${i}` }));
  const { requests } = fixture(t, { comments: [{ id: 1 }], likes });
  const rows = await store.listComments(entry.slug, 'viewer');
  assert.equal(rows[0].likeCount, 1001);
  assert.equal(rows[0].likedByMe, true);
  assert.deepEqual(requests.filter(r => r.table === store.LIKES).map(r => r.offset), [0, 1000]);
});

test('a later page failure cannot masquerade as a complete tally', async t => {
  fixture(t, { comments: [{ id: 1 }], likes: Array.from({ length: 1001 }, () => ({ comment_id: 1 })), failOffset: 1000 });
  await assert.rejects(store.listComments(entry.slug, 'viewer'), /supabase-http-503/);
});

test('the existing 8000-row budget is bounded and never silently truncates counts', async t => {
  const { requests } = fixture(t, { comments: [{ id: 1 }], likes: Array.from({ length: 8001 }, () => ({ comment_id: 1 })) });
  await assert.rejects(store.listComments(entry.slug, 'viewer'), /read-budget-exceeded/);
  assert.equal(requests.filter(r => r.table === store.LIKES).length, 9);
  assert.equal(requests.at(-1).limit, 1);
});

test('invalid pagination is rejected before network access', async t => {
  const { requests } = fixture(t);
  for (const offset of [-1, 1.5, Infinity]) await assert.rejects(client.select('match_comments', { offset }), /offset/);
  assert.equal(requests.length, 0);
});
