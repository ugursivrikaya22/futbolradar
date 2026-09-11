import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

// Isolated API-contract fixture: canonical field names, zero/missing values,
// percentage units and both current/legacy substitute lists.
const fixture = { data: [{ id: 'contract', homeTeam: 'Home Club', awayTeam: 'Away Club', status: 'LIVE', score: { home: 1, away: 0 },
  statistics: [
    { type: 'Topla oynama', home: 76, away: 24, unit: '%' },
    { type: 'İsabetli pas', home: 316, away: 80 },
    { type: 'Kurtarış', home: 0, away: 1 },
    { type: 'Custom metric', home: null, away: 3 }
  ],
  lineups: [
    { team: 'Home Club', players: ['Home starter'], substitutes: ['Home reserve'] },
    { team: 'Away Club', players: [{ name: 'Away starter' }], bench: [{ player: { name: 'Away reserve' } }] }
  ] }] };
const client = fs.readFileSync(new URL('../match-detail-en.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../page.css', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await page.clock.install();
  let fail = false;
  let requests = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/match-detail') { requests++; return fail ? route.abort('failed') : route.fulfill({ json: fixture }); }
    if (pathname === '/match-detail-en.js') return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: client });
    if (pathname === '/page.css') return route.fulfill({ contentType: 'text/css; charset=utf-8', body: styles });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/page.css"><h1>Match details</h1><main data-en-match-detail></main><script src="/match-detail-en.js"></script>' });
  });
  await page.goto('http://detail.test/en/match-detail.html?id=contract');
  await page.locator('#en-match-stats-tab').click();
  const targets = await page.locator('[role="tab"]').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right })));
  assert.equal(targets.length, 3);
  // Chromium's internal LayoutUnit snaps to 1/64px, so a `min-height: 44px`
  // box can report 43.99998... from getBoundingClientRect() even though it
  // is visually and semantically 44px (flaky failure observed with exact
  // integer comparison). Round to the nearest pixel before checking the
  // WCAG touch-target minimum.
  assert.ok(targets.every(target => Math.round(target.width) >= 44 && Math.round(target.height) >= 44), JSON.stringify(targets));
  assert.ok(targets.every(target => target.left >= 0 && target.right <= 361), 'All three tabs must fit on mobile: ' + JSON.stringify(targets));
  assert.equal(await page.locator('#en-match-stats-tab').getAttribute('aria-selected'), 'true');
  assert.ok(await page.locator('#en-match-stats-tab').evaluate(node => node.classList.contains('is-active')));
  const statistics = await page.locator('#en-match-stats').innerText();
  for (const row of ['Possession: 76% – 24%', 'Accurate passes: 316 – 80', 'Saves: 0 – 1', 'Custom metric: — – 3']) assert.ok(statistics.includes(row), row + ': ' + statistics);
  await page.locator('#en-match-lineups-tab').click();
  const lineups = await page.locator('#en-match-lineups').innerText();
  for (const player of ['Home starter', 'Home reserve', 'Away starter', 'Away reserve']) assert.ok(lineups.includes(player), player);
  assert.equal(await page.locator('#en-match-lineups h4').count(), 2);
  await page.locator('#en-match-stats-tab').click();
  fixture.data[0].score.home = 2;
  fixture.data[0].statistics[0].home = 77;
  await page.clock.fastForward(15000);
  await page.waitForFunction(() => document.querySelector('.big-value').textContent === '2 – 0');
  assert.equal(await page.locator('#en-match-stats-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#en-match-stats-tab').evaluate(node => node === document.activeElement), true);
  assert.match(await page.locator('#en-match-stats').innerText(), /Possession: 77%/);
  const before = requests;
  fail = true;
  await page.locator('[data-detail-reload]').click();
  await page.locator('[data-en-match-detail][data-state="stale"]').waitFor();
  assert.equal(await page.locator('.big-value').innerText(), '2 – 0', 'Keep confirmed content during a failed refresh');
  assert.match(await page.locator('[data-detail-controls] [role="status"]').innerText(), /Refresh failed/);
  fail = false;
  await page.locator('[data-detail-reload]').press('Enter');
  await page.locator('[data-en-match-detail][data-state="ready"]').waitFor();
  assert.ok(requests >= before + 2, 'Retry must make a fresh request');
  for (const width of [390, 1440]) {
    await page.setViewportSize({width,height:900});
    await page.locator('#en-match-events-tab').click();
    await page.locator('#en-match-events-tab').press('ArrowRight');
    assert.equal(await page.locator('#en-match-stats').isVisible(), true);
  }
  fail = true;
  await page.reload();
  await page.locator('[data-en-match-detail][data-state="unavailable"]').waitFor();
  assert.match(await page.locator('[data-en-match-detail]').innerText(), /could not be loaded/);
  fail = false;
  await page.locator('[data-detail-reload]').click();
  await page.locator('#en-match-stats-tab').waitFor();
  assert.equal(await page.locator('[data-en-match-detail]').getAttribute('aria-busy'), 'false');
  assert.deepEqual(errors, []);
  console.log('English match detail contract OK: content, 44px tabs, polling, preserved selection/focus, stale data, network failure and keyboard retry');
} finally { await browser.close(); }
