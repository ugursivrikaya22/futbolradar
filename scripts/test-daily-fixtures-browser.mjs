import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.FIXTURE_TEST_URL || 'http://127.0.0.1:4175';
const browser = await chromium.launch({ headless: true, timeout: 20000 });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const tr = await (await page.request.get(`${base}/api/matches?date=2026-10-04`)).json();
  const en = await (await page.request.get(`${base}/api/matches?date=2026-10-04&locale=en`)).json();
  assert.ok(tr.ok && en.ok);
  assert.ok(tr.data.length > 0);
  assert.deepEqual(tr.data.map(row => row.id).sort(), en.data.map(row => row.id).sort());
  await page.goto(`${base}/bugunun-maclari.html?date=2026-10-04`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-api-target="matches-page"] .league-match-group').first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: 'fixture-tr-test.png', fullPage: false });
  await page.goto(`${base}/en/todays-matches.html?date=2026-10-04`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(count => document.querySelectorAll('[data-daily-fixtures-en] [data-fixture-id]').length === count, tr.data.length, { timeout: 30000 });
  await page.screenshot({ path: 'fixture-en-test.png', fullPage: false });
  await page.goto(`${base}/en/matches?date=2026-10-04`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(count => document.querySelectorAll('[data-daily-fixtures-en] [data-fixture-id]').length === count, tr.data.length, { timeout: 30000 });
  assert.deepEqual(errors, []);
  console.log(`PASS: browser TR/EN fixture lists; shared API count ${tr.data.length}; no JavaScript errors.`);
} finally { await browser.close(); }
