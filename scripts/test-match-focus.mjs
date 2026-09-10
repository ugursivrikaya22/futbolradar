import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), F = require('../match-focus.js');
const cfg = require('../data/fenerbahce-roma-focus.json');
const kickoff = Date.parse(F.KICKOFF), now = kickoff + 37 * 60000;
const scheduled = { id: F.ID, providerId: F.PROVIDER_ID, kickoff: F.KICKOFF, source: 'api-football', providerStatus: 'NS', score: { home: null, away: null } };
const live = { ...scheduled, providerStatus: '1H', fetchedAt: new Date(now).toISOString(), minute: 37, score: { home: 1, away: 0 } };
assert.equal(F.state(scheduled, kickoff - 1000), 'scheduled');
assert.equal(F.countdown(9261000), '02:34:21');
assert.equal(F.state(scheduled, kickoff), 'waiting', 'the wall clock alone must not fabricate kick-off');
assert.equal(F.state(live, now), 'live');
assert.match(F.board(live, 'tr', now), /🔴 CANLI/);
assert.match(F.board(live, 'tr', now), /1–0/);
assert.match(F.board(live, 'en', now), /37′/);
assert.equal(F.state(live, now + 90001), 'stale');
assert.equal(F.state({ ...live, source: 'mock' }, now), 'waiting');
assert.equal(F.state({ ...live, providerStatus: 'PST' }, now), 'postponed');
assert.equal(F.state({ ...live, providerStatus: 'ABD' }, now), 'interrupted');
assert.equal(F.minute({ ...live, minute: 45, extra: 3 }, false), '45+3′');
assert.match(F.minute({ ...live, providerStatus: 'HT', minute: null }, true), /Half time · 45′/);
assert.doesNotMatch(F.board(scheduled, 'tr', kickoff - 1000), /0–0/);
assert.match(F.board({ ...live, minute: null }, 'tr', now), /Dakika bekleniyor/);
const officialHome = { team: 'Fenerbahçe', formation: '4-3-3', players: cfg.probable.home.players, substitutes: ['Test substitute'] };
assert.equal((F.lineupsHtml({ ...live, lineups: [officialHome] }, cfg, true).match(/OFFICIAL XI</g) || []).length, 1);
assert.match(F.lineupsHtml({ ...live, lineups: [{ ...officialHome, players: officialHome.players.slice(0, 10) }] }, cfg, true), /PREDICTED XI/);
assert.equal(F.merge({ ...live, lineups: [officialHome] }, { ...live, lineups: [] }).lineups.length, 1);
assert.strictEqual(F.merge(live, { ...live, id: 'unrelated', providerId: '111' }), live);
assert.strictEqual(F.merge(live, { ...live, fetchedAt: new Date(now - 1000).toISOString(), score: { home: 0, away: 0 } }), live);
const final = { ...live, providerStatus: 'FT', minute: 90, events: [{ time: "37'", type: 'Goal', value: '<script>unsafe</script>', detail: 'Normal Goal', team: { name: 'Fenerbahçe' } }, { time: "61'", type: 'Card', detail: 'Red Card', value: 'Test defender' }, { time: "75'", type: 'subst', value: 'Test substitution' }, { time: "80'", type: 'Goal', detail: 'Missed Penalty', value: 'Test penalty' }], statistics: [{ type: 'İsabetli şut', home: 5, away: 2 }] };
assert.equal(F.state(final, now), 'finished');
assert.strictEqual(F.merge(final, { ...live, fetchedAt: new Date(now + 1000).toISOString() }), final);
assert.match(F.reportHtml(final, true), /Fenerbahçe won the match/);
assert.match(F.reportHtml(final, false), /İsabetli şutlarda tablo 5–2/);
for (const label of ['RED CARD', 'SUBSTITUTION', 'PENALTY', 'FT']) assert.ok(F.eventsHtml(final, true).includes(label));
assert.ok(!F.eventsHtml(final, true).includes('<script>'));
assert.match(F.statsHtml(final, true), /Shots on target/);

// Run the real browser controller against controlled time and transport.
let clock = kickoff - 2000, nextResponse = scheduled, fetches = 0;
const listeners = {}, intervals = new Map(), timeouts = new Map(), nodes = new Map();
function node(selector) { if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', content: '', classList: { remove() {}, add() {} }, querySelector: () => node('counter') }); return nodes.get(selector); }
node('#match-focus-config').textContent = JSON.stringify({ ...cfg, match: scheduled, page: true });
node('#focus-schema').textContent = JSON.stringify({ name: 'Fenerbahçe – Roma' });
const document = { hidden: false, documentElement: { lang: 'tr' }, getElementById: id => node('#' + id), querySelector: node, addEventListener: (name, fn) => { listeners[name] = fn; }, title: F.TITLES.tr };
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
const context = { document, Date: TestDate, AbortController, fetch: async () => { fetches++; return { ok: true, json: async () => ({ ok: true, data: [nextResponse] }) }; }, setTimeout: fn => { const id = Symbol(); timeouts.set(id, fn); return id; }, clearTimeout: id => timeouts.delete(id), setInterval: fn => { const id = Symbol(); intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id), localStorage: { getItem: () => null, setItem() {} } };
context.window = { addEventListener: (name, fn) => { listeners[name] = fn; } };
vm.runInNewContext(fs.readFileSync('match-focus.js', 'utf8'), context);
const flush = () => new Promise(resolve => setImmediate(resolve));
await flush();
assert.match(node('[data-focus-board]').innerHTML, /focus-countdown/);
clock = now; nextResponse = live;
for (const fn of intervals.values()) fn();
await flush();
assert.match(node('[data-focus-board]').innerHTML, /37′/);
assert.match(node('[data-focus-board]').innerHTML, /1–0/);
assert.match(node('[data-focus-board]').innerHTML, /🔴 CANLI/);
// A goal correction may reduce the score, but a stale packet cannot undo it.
listeners['futbolradar:score-snapshot']({ detail: { source: 'api-football', matches: [{ ...live, score: { home: 0, away: 0 }, fetchedAt: new Date(now + 1000).toISOString(), timing: { serverReceivedAt: new Date(now + 1000).toISOString() } }] } });
assert.match(node('[data-focus-board]').innerHTML, /0–0/);
await flush();
clock += 2000; nextResponse = { ...final, fetchedAt: new Date(clock).toISOString(), lineups: [officialHome] };
document.hidden = true; listeners.visibilitychange();
assert.equal(intervals.size, 0, 'background tabs stop their clocks and polling');
const before = fetches;
document.hidden = false; listeners.visibilitychange(); await flush();
assert.equal(fetches, before + 1);
assert.match(document.title, /maç sonucu, goller ve özet/);
assert.match(node('[data-focus-lineups]').innerHTML, /RESMİ İLK 11/);
assert.match(node('[data-focus-events]').innerHTML, /KIRMIZI KART/);
assert.match(node('[data-focus-report]').innerHTML, /karşılaşmayı kazandı/);
listeners.pagehide();
assert.equal(intervals.size, 0);

for (const file of ['fenerbahce-roma-maci.html', 'en/fenerbahce-vs-roma.html']) {
  const html = fs.readFileSync(file, 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(id), `${file}: missing #${id}`);
  for (const [, json] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/g)) JSON.parse(json);
  assert.ok(html.includes('TRT 1 / tabii'));
  assert.match(html, /href="https:\/\/www.futbolradar.com\/en\/fenerbahce-vs-roma"/);
  assert.match(html, /href="https:\/\/www.futbolradar.com\/fenerbahce-roma-maci"/);
}
console.log('Match focus: countdown, kickoff, goal/VAR, minute, freshness, official XI, final report, API recovery, TR/EN anchors and SEO passed.');
