const test = require('node:test');
const assert = require('node:assert/strict');
const fan = require('../radar-fan.js');

test('English compatibility route cannot redirect HTML pages into a loop', () => {
  const route = require('../vercel.json').redirects.find(r => r.source.startsWith('/en/player/:slug'));
  assert.ok(route);
  const source = new RegExp('^' + route.source.replace(':slug', '') + '$');
  assert.equal(source.test('/en/player/victor-osimhen'), true);
  assert.equal(source.test('/en/player/victor-osimhen.html'), false);
  assert.equal(source.test('/en/player/missing/nested'), false);
  assert.equal(route.destination.replace(':slug', 'victor-osimhen'), '/en/player/victor-osimhen.html');
  assert.equal(require('node:fs').existsSync('en/player/victor-osimhen.html'), true);
  assert.equal(require('node:fs').existsSync('en/player/does-not-exist-emir11.html'), false);
});

test('English team clean URL redirects to the generated page without looping', () => {
  const route = require('../vercel.json').redirects.find(r => r.source.startsWith('/en/team/:slug'));
  assert.ok(route);
  assert.equal(route.permanent, false);
  const source = new RegExp('^' + route.source.replace(':slug', '') + '$');
  for (const slug of ['galatasaray', 'fenerbahce']) {
    assert.equal(source.test(`/en/team/${slug}`), true);
    assert.equal(route.destination.replace(':slug', slug), `/en/team/${slug}.html`);
    assert.equal(require('node:fs').existsSync(`en/team/${slug}.html`), true);
  }
  assert.equal(source.test('/en/team/galatasaray.html'), false);
  assert.equal(source.test('/en/team/missing/nested'), false);
});

const question = { id: 'winner', question: 'Who wins?', closed: false,
  options: [{ id: 'home', label: 'Home' }, { id: 'draw', label: 'Draw' }],
  total: 0, results: [], alreadyVoted: false, choice: null };
const payload = (q = question) => ({ ok: true, data: { storage: 'supabase', questions: [q] } });
const flush = () => new Promise(resolve => setImmediate(resolve));

async function runVote(response, status = 200) {
  const events = [], listeners = {}, attrs = new Map([['hidden', '']]);
  const body = { innerHTML: '' };
  const note = { hidden: true, removeAttribute() { this.hidden = false; }, setAttribute() { this.hidden = true; } };
  const button = { disabled: false, getAttribute(k) { return k === 'data-question' ? 'winner' : 'draw'; } };
  const section = {
    getAttribute(k) { return k.endsWith('slug') ? 'test-match' : 'en'; },
    setAttribute(k, v) { attrs.set(k, v); }, removeAttribute(k) { attrs.delete(k); },
    querySelector(k) { return k.includes('body') ? body : note; },
    querySelectorAll() { return [button]; }, addEventListener(k, fn) { listeners[k] = fn; }
  };
  global.document = { querySelector() { return section; } };
  global.window = { fetch: true, gtag(...args) { events.push(args); } };
  global.fetch = async (_url, options) => {
    if (!options.method) return { ok: true, status: 200, json: async () => payload() };
    if (response instanceof Error) throw response;
    return { ok: status < 400, status, json: async () => response };
  };
  try {
    fan.bootPoll();
    await flush();
    listeners.click({ target: { closest: () => button }, preventDefault() {} });
    await flush();
    return { events, note, button, body };
  } finally {
    delete global.document; delete global.window; delete global.fetch;
  }
}

test('only a persisted vote emits success', async () => {
  const q = { ...question, alreadyVoted: true, choice: 'draw', total: 1,
    results: [{ optionId: 'draw', label: 'Draw', votes: 1, percent: 100 }] };
  const result = await runVote(payload(q));
  assert.equal(result.events.filter(e => e[1] === 'fan_vote').length, 1);
  assert.match(result.body.innerHTML, /Your vote|recorded|Draw/);
});

for (const [label, response, status] of [
  ['store failure', { ok: false }, 502],
  ['network failure', new Error('offline'), 0],
  ['storage disabled', { ok: true, data: { storage: 'none', questions: [question] } }, 200],
  ['unconfirmed write', payload(), 200],
  ['HTTP failure with misleading body', payload({ ...question, alreadyVoted: true, choice: 'draw' }), 503]
]) {
  test(label + ' shows failure and allows retry without a success metric', async () => {
    const result = await runVote(response, status);
    assert.equal(result.note.hidden, false);
    assert.equal(result.button.disabled, false);
    assert.equal(result.events.filter(e => e[1] === 'fan_vote').length, 0);
    assert.equal(result.events.filter(e => e[1] === 'fan_vote_error').length, 1);
  });
}
