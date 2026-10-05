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
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/matches') return route.fulfill({ json: { ok: true, data: rows } });
    if (path === '/daily-fixtures-en.js') return route.fulfill({ contentType: 'application/javascript', body: script });
    return route.fulfill({ contentType: 'text/html', body: '<div data-daily-fixtures-en data-home-only></div><script src="/daily-fixtures-en.js"></script>' });
  });
  await page.goto('http://fixtures.test/en/');
  await page.locator('[data-fixture-id="live"]').waitFor();
  assert.deepEqual((await page.locator('[data-fixture-id]').evaluateAll(nodes => nodes.map(n => n.dataset.fixtureId))).sort(), ['future', 'live']);
  rows = rows.map(row => ({ ...row, providerStatus: 'FT' }));
  await page.clock.fastForward(60001);
  await page.locator('[data-fixture-id]').first().waitFor({ state: 'detached' });
  assert.match(await page.locator('[data-home-only]').innerText(), /completed results/);
  rows = Array.from({ length: 20 }, (_, i) => ({ ...base, id: 'future-' + i }));
  await page.reload();
  await page.locator('[data-fixture-id]').first().waitFor();
  assert.equal(await page.locator('[data-fixture-id]').count(), 12, 'Home stays compact; the schedule retains every match');
  assert.deepEqual(errors, []);
  console.log('PASS: English homepage removes dual-status terminal rows and retires live cards after the final whistle.');
} finally {
  await browser.close();
}
