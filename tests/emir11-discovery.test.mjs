import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { matchDiscoveryHtml } from '../scripts/lib/matchDiscovery.mjs';
const require = createRequire(import.meta.url);
const players = require('../services/playerService').getPlayers(require('../data/players.json'));
const entry = { homeTeam: 'Galatasaray', awayTeam: 'Fenerbahçe', kickoff: '2026-10-19T18:00:00Z' };
const now = Date.parse('2026-10-19T12:00:00Z');
const ctx = { homeTeam: entry.homeTeam, awayTeam: entry.awayTeam,
  homeHref: '../galatasaray-maclari.html', awayHref: '../fenerbahce-maclari.html', base: '../', locale: 'tr' };
const row = (href, kickoff) => ({ href, match: { homeTeam: 'Galatasaray', awayTeam: 'Other', kickoff } });

test('both languages link to published players, teams, related matches and nearest future match', () => {
  for (const locale of ['tr', 'en']) {
    const localCtx = { ...ctx, locale, base: locale === 'en' ? '../../' : '../' };
    const html = matchDiscoveryHtml(entry, localCtx, { players, now,
      related: [row('/mac/past', '2026-10-01'), row('/mac/past', '2026-10-01')],
      next: { home: [row('/mac/later', '2026-11-01')], away: [row('/mac/stale', '2026-10-01'), row('/mac/nearest', '2026-10-20')] } });
    for (const type of ['team', 'player', 'related_match', 'next_match']) assert.match(html, new RegExp(`data-discovery-link="${type}"`));
    assert.match(html, /href="\/mac\/nearest"/);
    assert.doesNotMatch(html, /href="\/mac\/(later|stale)"/);
    assert.equal((html.match(/href="\/mac\/past"/g) || []).length, 1);
    for (const [, href] of html.matchAll(/data-discovery-link="player" href="([^"]+)"/g)) {
      const filename = href.replace(/^(\.\.\/)+/, '').replace(/(?<!\.html)$/, '.html');
      assert.ok(fs.existsSync(filename), filename);
      assert.equal(filename.startsWith('en/player/'), locale === 'en');
    }
  }
});

test('missing data stays absent and no unpublished player is linked', () => {
  const html = matchDiscoveryHtml(entry, { ...ctx, homeHref: null, awayHref: null }, {
    now, players: [{ ...players[0], id: 'emir11-unpublished-player' }],
    next: { home: [row(null, '2026-11-01'), row('/bad-date', 'invalid')] }
  });
  assert.equal(html, '');
});

test('English related match labels translate national team names', () => {
  const html = matchDiscoveryHtml(entry, { ...ctx, locale: 'en' }, { now,
    related: [{ href: '/en/match/turkey-italy', match: { homeTeam: 'Türkiye', awayTeam: 'İtalya' } }] });
  assert.match(html, /Türkiye – Italy/);
  assert.doesNotMatch(html, /İtalya/);
});

test('labels are escaped and no fetch/script dependency is introduced', () => {
  const html = matchDiscoveryHtml(entry, { ...ctx, homeTeam: '<img onerror=evil>' }, { now });
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script|<img|fetch\(/);
});

function analytics({ privacy = false, webdriver = false, ga = true } = {}) {
  const events = [], listeners = {};
  const discovery = { querySelector: () => ({}), contains: () => true,
    addEventListener: (name, fn) => { listeners[name] = fn; } };
  const context = {
    navigator: { globalPrivacyControl: privacy, webdriver },
    window: { location: { pathname: '/mac/test' }, gtag: (...args) => events.push(args) },
    document: { currentScript: { dataset: { ga4Id: ga ? 'G-TEST123' : '', googleAdsId: 'AW-123' } },
      documentElement: { lang: 'tr' }, querySelector: () => discovery,
      createElement: () => ({}), head: { appendChild() {} }, addEventListener() {} }
  };
  vm.runInNewContext(fs.readFileSync('analytics.js', 'utf8'), context);
  const click = (type) => listeners.click?.({ target: { closest: () => ({ getAttribute: () => type }) } });
  return { events, click };
}

test('navigation metrics count each destination once and preserve privacy exclusions', () => {
  const a = analytics();
  a.click('team'); a.click('team'); a.click('next_match'); a.click('unknown');
  assert.equal(a.events.filter(e => e[1] === 'match_navigation_view').length, 1);
  assert.equal(a.events.filter(e => e[1] === 'match_navigation_click').length, 2);
  for (const options of [{ privacy: true }, { webdriver: true }, { ga: false }]) {
    assert.equal(analytics(options).events.filter(e => String(e[1]).startsWith('match_navigation')).length, 0);
  }
});
