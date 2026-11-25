import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const now = new Date('2026-10-05T10:00:00+03:00');
  await page.clock.install({ time: now });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = { homeTeam: 'Home', awayTeam: 'Away', league: 'League', kickoff: '2026-10-05T19:00:00+03:00', status: 'SCHEDULED' };
  let rows = [
    { ...base, id: 'future' },
    { ...base, id: 'finished', providerStatus: 'FT' },
    { ...base, id: 'postponed', providerStatus: 'PST' },
    { ...base, id: 'live', status: 'LIVE', kickoff: '2026-10-05T09:30:00+03:00', fetchedAt: now.toISOString(), score: { home: 0, away: 1 } }
  ];
  const script = fs.readFileSync('daily-fixtures-en.js', 'utf8');
  let html = '<div class="quick-stats" aria-label="Today\'s match summary"><a class="quick-stat" href="/en/todays-matches.html"><span>Upcoming</span><b>1</b></a><a class="quick-stat" href="/en/todays-matches.html"><span>Total</span><b>1</b></a></div><div data-daily-fixtures-en data-home-only></div><script src="/daily-fixtures-en.js"></script>';
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/matches') return route.fulfill({ json: { ok: true, data: rows } });
    if (path === '/daily-fixtures-en.js') return route.fulfill({ contentType: 'application/javascript', body: script });
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('http://fixtures.test/en/');
  await page.locator('[data-fixture-id="live"]').waitFor();
  assert.deepEqual((await page.locator('[data-fixture-id]').evaluateAll(nodes => nodes.map(n => n.dataset.fixtureId))).sort(), ['future', 'live']);
  assert.equal(await page.locator('.quick-stats .quick-stat').count(), 4);
  assert.equal(await page.locator('.quick-stat:has-text("Live") b').innerText(), '1');
  assert.equal(await page.locator('.quick-stat:has-text("Upcoming") b').innerText(), '1');
  assert.equal(await page.locator('.quick-stat:has-text("Finished") b').innerText(), '1');
  assert.equal(await page.locator('.quick-stat:has-text("Total") b').innerText(), '4');
  rows = rows.map(row => ({ ...row, providerStatus: 'FT' }));
  await page.clock.fastForward(60001);
  await page.locator('[data-fixture-id]').first().waitFor({ state: 'detached' });
  assert.match(await page.locator('[data-home-only]').innerText(), /completed results/);
  // The counters follow the same "most advanced state wins" rule as the cards:
  // once the provider reports FT, a row whose own status still says LIVE or
  // SCHEDULED is finished — it is neither live nor upcoming any more.
  assert.equal(await page.locator('.quick-stat:has-text("Finished") b').innerText(), '4');
  assert.equal(await page.locator('.quick-stat:has-text("Total") b').innerText(), '4');
  assert.equal(await page.locator('.quick-stat:has-text("Live")').count(), 0);
  assert.equal(await page.locator('.quick-stat:has-text("Upcoming")').count(), 0);
  rows = Array.from({ length: 20 }, (_, i) => ({ ...base, id: 'future-' + i }));
  await page.reload();
  await page.locator('[data-fixture-id]').first().waitFor();
  assert.equal(await page.locator('[data-fixture-id]').count(), 12, 'Home stays compact; the schedule retains every match');

  // "In play" is ONE definition for the cards and the counters, and it is the
  // server's: playing, the break, or a temporary stoppage. Full-day payload
  // first — a raw IN_PLAY row and a suspended one are both live, both get a
  // card and both are counted.
  const fetchedAt = new Date(now.getTime() + 90000).toISOString();
  const playing = { ...base, id: 'playing', status: 'IN_PLAY', kickoff: '2026-10-05T09:30:00+03:00', fetchedAt, score: { home: 1, away: 0 } };
  const suspended = { ...base, id: 'suspended', status: 'INTERRUPTED', providerStatus: 'SUSP', kickoff: '2026-10-05T09:00:00+03:00', fetchedAt, score: { home: 0, away: 0 } };
  const ids = async () => (await page.locator('[data-fixture-id]').evaluateAll(nodes => nodes.map(n => n.dataset.fixtureId))).sort();
  rows = [{ ...base, id: 'future' }, playing, suspended];
  await page.reload();
  await page.locator('[data-fixture-id="suspended"]').waitFor();
  assert.deepEqual(await ids(), ['future', 'playing', 'suspended']);
  assert.equal(await page.locator('.quick-stat:has-text("Live") b').innerText(), '2');
  assert.equal(await page.locator('.quick-stat:has-text("Upcoming") b').innerText(), '1');
  assert.equal(await page.locator('.quick-stat:has-text("Total") b').innerText(), '3');

  // Light live-only feed (?live=all) carrying a suspended match is still a
  // live feed: the upcoming card printed at build time must survive, the
  // suspended match gets its own card and "Live" counts both.
  html = '<div class="quick-stats" aria-label="Today\'s match summary"><a class="quick-stat is-live" href="/en/live-football-scores.html"><span>Live</span><b class="live-number">1</b></a><a class="quick-stat" href="/en/todays-matches.html"><span>Upcoming</span><b>1</b></a><a class="quick-stat" href="/en/todays-matches.html"><span>Total</span><b>3</b></a></div><div data-daily-fixtures-en data-home-only><div class="matches-grid" data-match-list="today-matches"><article class="fixture-card" data-fixture-id="printed-upcoming" data-match="printed-upcoming">Printed at build time</article></div></div><script src="/daily-fixtures-en.js"></script>';
  rows = [playing, suspended];
  await page.reload();
  await page.locator('[data-fixture-id="suspended"]').waitFor();
  assert.deepEqual(await ids(), ['playing', 'printed-upcoming', 'suspended'], 'a suspended match must not turn the live feed into a full-day payload');
  assert.match(await page.locator('[data-fixture-id="suspended"]').innerText(), /Match paused|Suspended/);
  assert.equal(await page.locator('.quick-stat:has-text("Live") b').innerText(), '2');
  assert.equal(await page.locator('.quick-stat:has-text("Total") b').innerText(), '3', 'a live-only feed does not rewrite the day totals');
  // The suspended match leaves the feed: its card is retired, the rest stays.
  rows = [playing];
  await page.clock.fastForward(20001);
  await page.locator('[data-fixture-id="suspended"]').waitFor({ state: 'detached' });
  assert.deepEqual(await ids(), ['playing', 'printed-upcoming']);
  assert.equal(await page.locator('.quick-stat:has-text("Live") b').innerText(), '1');
  assert.deepEqual(errors, []);
  console.log('PASS: English homepage removes dual-status terminal rows, retires live cards after the final whistle and treats a suspended match as in play.');
} finally {
  await browser.close();
}
