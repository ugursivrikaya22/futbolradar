const test = require('node:test');
const assert = require('node:assert/strict');
const release = require('../data/match-poll-release.json');
const { matchPollReleased } = require('../services/matchPollRelease');
const enabled = { enabled: true, matchSlug: 'test-match-tr',
  verified: { pollPersistence: true, commentPersistence: true, browserFlow: true } };

test('production defaults remain closed until all three checks pass', () => {
  assert.equal(matchPollReleased('test-match-tr'), false);
  assert.equal(matchPollReleased('test-match-tr', enabled), true);
  assert.equal(matchPollReleased('different-match', enabled), false);
  for (const key of Object.keys(enabled.verified)) {
    assert.equal(matchPollReleased('test-match-tr', { ...enabled, verified: { ...enabled.verified, [key]: false } }), false);
  }
  assert.equal(matchPollReleased('test-match-tr', null), false);
});

test('route gate does no storage work when closed and exposes only winner when released', async () => {
  const originalRelease = structuredClone(release);
  const storePath = require.resolve('../services/homePollVoteStore');
  const registryPath = require.resolve('../services/matchSeoPages');
  const routePath = require.resolve('../server/matchPollRoute');
  const store = require(storePath), registry = require(registryPath);
  const originalStore = require.cache[storePath].exports, originalRegistry = require.cache[registryPath].exports;
  let writes = 0, reads = 0;
  const entry = { slug: 'test-match-tr', enSlug: 'test-match-en', kickoff: '2099-01-01T18:00:00Z', homeTeam: 'Home', awayTeam: 'Away' };
  require.cache[storePath].exports = { ...store, isConfigured: () => true,
    findVote: async () => { reads++; return { voted: writes > 0, optionId: writes ? 'draw' : null }; },
    readTally: async () => { reads++; return writes ? { draw: 1 } : {}; },
    recordVote: async () => { writes++; } };
  require.cache[registryPath].exports = { ...registry, loadRegistry: () => ({ pages: [entry] }) };
  delete require.cache[routePath];
  const route = require(routePath);
  const call = async (method, slug, questionId = 'winner') => {
    let result;
    const req = { method, url: '/api/match-poll?slug=' + slug, headers: {}, body: { slug, questionId, optionId: 'draw' } };
    const res = { setHeader() {}, end(value) { result = JSON.parse(value); }, statusCode: 200 };
    await route.handleMatchPoll(req, res);
    return { status: res.statusCode, body: result };
  };
  try {
    Object.assign(release, { ...enabled, enabled: false });
    assert.equal((await call('GET', entry.slug)).body.data.storage, 'none');
    assert.equal((await call('POST', entry.slug)).status, 503);
    assert.equal(reads + writes, 0);
    Object.assign(release, enabled);
    const before = await call('GET', entry.enSlug);
    assert.deepEqual(before.body.data.questions.map(q => q.id), ['winner']);
    assert.equal((await call('POST', entry.slug, 'next-goal')).status, 400);
    assert.equal(writes, 0);
    const saved = await call('POST', entry.enSlug);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.questions[0].alreadyVoted, true);
    assert.equal(saved.body.data.questions[0].choice, 'draw');
    assert.equal(writes, 1);
  } finally {
    Object.assign(release, originalRelease);
    require.cache[storePath].exports = originalStore;
    require.cache[registryPath].exports = originalRegistry;
    delete require.cache[routePath];
  }
});

test('closed polls emit no impression; visible polls emit only one across vote repaint', async () => {
  const originals = { document: global.document, window: global.window, fetch: global.fetch };
  const fan = require('../radar-fan');
  const flush = () => new Promise(resolve => setImmediate(resolve));
  try {
    for (const storage of ['none', 'supabase']) {
      const events = [], listeners = {};
      const question = { id: 'winner', question: 'Who wins?', options: [{ id: 'draw', label: 'Draw' }], total: 0, results: [] };
      const body = { innerHTML: '' };
      const button = { getAttribute: key => key === 'data-question' ? 'winner' : 'draw' };
      const section = { getAttribute: key => key.endsWith('slug') ? 'test-match-tr' : 'en',
        querySelector: () => body, querySelectorAll: () => [button], setAttribute() {}, removeAttribute() {},
        addEventListener: (name, fn) => { listeners[name] = fn; } };
      global.document = { querySelector: () => section };
      global.window = { fetch: true, gtag: (...args) => events.push(args) };
      global.fetch = async () => ({ ok: true, json: async () => ({ ok: true, data: { storage, questions: [question] } }) });
      fan.bootPoll();
      await flush();
      if (storage === 'supabase') {
        question.alreadyVoted = true; question.choice = 'draw';
        listeners.click({ target: { closest: () => button }, preventDefault() {} });
        await flush();
      }
      assert.equal(events.filter(e => e[1] === 'match_poll_view').length, storage === 'none' ? 0 : 1);
    }
  } finally {
    Object.assign(global, originals);
  }
});
