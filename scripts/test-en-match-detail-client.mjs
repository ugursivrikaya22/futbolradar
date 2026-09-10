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
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/match-detail') return route.fulfill({ json: fixture });
    if (pathname === '/match-detail-en.js') return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: client });
    if (pathname === '/page.css') return route.fulfill({ contentType: 'text/css; charset=utf-8', body: styles });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/page.css"><h1>Match details</h1><main data-en-match-detail></main><script src="/match-detail-en.js"></script>' });
  });
  await page.goto('http://detail.test/en/match-detail.html?id=contract');
  await page.locator('#en-match-stats-tab').click();
  const targets = await page.locator('[role="tab"]').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
  assert.equal(targets.length, 3);
  assert.ok(targets.every(target => target.width >= 44 && target.height >= 44), JSON.stringify(targets));
  assert.equal(await page.locator('#en-match-stats-tab').getAttribute('aria-selected'), 'true');
  assert.ok(await page.locator('#en-match-stats-tab').evaluate(node => node.classList.contains('is-active')));
  const statistics = await page.locator('#en-match-stats').innerText();
  for (const row of ['Possession: 76% – 24%', 'Accurate passes: 316 – 80', 'Saves: 0 – 1', 'Custom metric: — – 3']) assert.ok(statistics.includes(row), row + ': ' + statistics);
  await page.locator('#en-match-lineups-tab').click();
  const lineups = await page.locator('#en-match-lineups').innerText();
  for (const player of ['Home starter', 'Home reserve', 'Away starter', 'Away reserve']) assert.ok(lineups.includes(player), player);
  assert.equal(await page.locator('#en-match-lineups h4').count(), 2);
  assert.deepEqual(errors, []);
  console.log('English match detail contract OK: labels, units, zero/missing values, starters, substitutes and 44px tabs');
} finally { await browser.close(); }
