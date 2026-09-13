const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4193';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => { window.EventSource = undefined; });
    await context.route('https://**/*', route => route.abort());
    const fetchedAt = new Date().toISOString();
    let matches = [{ id: '98765', providerId: '98765', providerLeagueId: '203', competitionId: 'super-lig', league: 'Süper Lig', homeTeam: 'Galatasaray', awayTeam: 'Kocaelispor', kickoff: new Date(Date.now() - 20 * 60000).toISOString(), status: 'LIVE', providerStatus: '1H', live: true, minute: 23, elapsed: 23, score: { home: 2, away: 1 }, fetchedAt, staleAfter: new Date(Date.now() + 90000).toISOString(), source: 'api-football', dataStatus: 'provider' }];
    await context.route('**/api/matches*', route => route.fulfill({ json: { ok: true, source: 'API-Football', updatedAt: fetchedAt, data: matches } }));
    await context.route('**/api/live-score-stream*', route => route.fulfill({ json: { matches, timing: { serverReceivedAt: fetchedAt } } }));
    const pages = [];
    for (const file of ['index.html', 'bugunun-maclari.html', 'canli-skor.html']) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/' + file, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-match="98765"]', { timeout: 25000 });
      const cards = await page.locator('[data-match="98765"]').allTextContents();
      assert.ok(cards.some(text => /23/.test(text) && (/2\s*[-–]\s*1/.test(text) || /Galatasaray2.*Kocaelispor1/.test(text))), file + ': score and minute must agree: ' + JSON.stringify(cards));
      assert.deepEqual(errors, [], file + ': no runtime errors');
      pages.push(page);
    }
    matches = [];
    const empty = await context.newPage();
    await empty.goto(base + '/bugunun-maclari.html', { waitUntil: 'domcontentloaded' });
    await empty.waitForFunction(() => document.querySelector('[data-api-target="matches-page"]')?.textContent.includes('Bu ölçütlerde doğrulanmış maç yok'), null, { timeout: 25000 });
    assert.equal(await empty.locator('[data-api-target="matches-page"] [data-match]').count(), 0, 'successful empty response must remove static matches');
    const leaders = JSON.parse(fs.readFileSync('data/league-leaders.json', 'utf8'));
    leaders.topScorers[0].goals = 27;
    leaders.topAssists[0].assists = 19;
    await context.route('**/data/league-leaders.json', route => route.fulfill({ json: leaders }));
    for (const [file, value] of [['gol-kralligi.html', '27'], ['asist-kralligi.html', '19']]) {
      const page = await context.newPage();
      await page.goto(base + '/' + file, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(v => document.querySelector('.evergreen-table tbody tr td:nth-child(4)')?.textContent === v, value, { timeout: 15000 });
      assert.equal(await page.locator('[data-resource-updated] time').getAttribute('datetime'), leaders.updatedAt || leaders.generatedAt);
    }
    console.log('Browser data consistency passed: same live score/minute on three pages, authoritative empty day, shared goals/assists data and source timestamps.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
