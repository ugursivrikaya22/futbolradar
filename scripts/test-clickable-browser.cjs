const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const viewports = [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 360, height: 800 }];
const base = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:4187';
const results = [];
const reportFile = process.env.AUDIT_REPORT || 'outputs/clickable/results.json';
let server;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(check, message, timeout = 5000) {
  const end = Date.now() + timeout;
  do { if (await check()) return; await delay(100); } while (Date.now() < end);
  assert.fail(message);
}
(async () => {
  fs.mkdirSync('outputs/clickable', { recursive: true });
  if (!process.env.AUDIT_BASE_URL) {
    server = spawn(process.execPath, ['scripts/serve-static.mjs'], { env: { ...process.env, PORT: '4187' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    server.stdout.resume();
    server.stderr.resume();
    await until(async () => { try { return (await fetch(base + '/index.html')).ok; } catch { return false; } }, 'Preview failed to start', 30000);
  }
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const queue = viewports.filter(v => !process.env.AUDIT_WIDTH || v.width === +process.env.AUDIT_WIDTH);
    async function runViewport(viewport) {
      const touch = viewport.width <= 768;
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce', serviceWorkers: 'block' });
      let page;
      let consoleErrors = [];
      const click = async locator => touch ? locator.tap() : locator.click();
      async function open(file) {
        const response = await page.goto(new URL(file, base + '/').href, { waitUntil: 'domcontentloaded' });
        assert.ok(response.ok(), file + ' HTTP ' + response.status());
        await page.locator('main').waitFor();
        assert.ok((await page.locator('h1').first().innerText()).trim(), file + ': empty page');
      }
      async function test(name, run) {
        if (process.env.AUDIT_CASE && !name.includes(process.env.AUDIT_CASE)) return;
        // Each flow owns a page; back navigation is still exercised within it.
        // Closing it releases decoded images and timers from previous flows.
        if (page) await page.close();
        page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(30000);
        consoleErrors = [];
        page.on('pageerror', e => consoleErrors.push({ kind: 'runtime', message: e.message, url: page.url() }));
        page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ kind: 'console', message: m.text(), url: m.location().url }); });
        try {
          await run();
          assert.deepEqual(consoleErrors, [], 'Browser errors');
          results.push({ viewport, name, passed: true });
          console.log('PASS', viewport.width, name);
        } catch (e) {
          const screenshot = path.join('outputs', 'clickable', `${viewport.width}-${results.length}.png`);
          await page.screenshot({ path: screenshot, timeout: 5000 }).catch(() => {});
          results.push({ viewport, name, passed: false, error: e.message, url: page.url(), consoleErrors, screenshot });
          console.log('FAIL', viewport.width, name, e.message.slice(0, 160));
        }
        fs.writeFileSync(reportFile, JSON.stringify({ base, results }, null, 2));
      }
      async function navigate(locator) {
        const before = page.url();
        const expected = await locator.getAttribute('href');
        assert.ok(expected && expected !== '#' && !expected.startsWith('javascript:'), 'Empty link');
        const target = new URL(expected, before);
        await click(locator);
        await until(() => page.url() !== before, 'Click did not navigate: ' + expected, 10000);
        await page.waitForLoadState('domcontentloaded');
        assert.equal(new URL(page.url()).pathname.replace(/\.html$/, ''), target.pathname.replace(/\.html$/, ''), 'Wrong destination');
        await page.locator('main').waitFor();
        assert.ok((await page.locator('h1').first().innerText()).trim(), 'Empty destination');
        if (target.hash) await page.locator('[id=' + JSON.stringify(decodeURIComponent(target.hash.slice(1))) + ']').waitFor();
        if (target.pathname.includes('en/match-detail')) {
          await page.locator('#en-match-stats-tab').waitFor();
          await click(page.locator('#en-match-stats-tab'));
          assert.equal(await page.locator('#en-match-stats').isVisible(), true);
          await click(page.locator('#en-match-lineups-tab'));
          assert.equal(await page.locator('#en-match-lineups').isVisible(), true);
        }
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await until(() => page.url() === before, 'Back navigation failed', 10000);
      }
      for (const locale of ['tr', 'en']) {
        const home = locale === 'tr' ? 'index.html' : 'en/index.html';
        const en = locale === 'en';
        await test(locale + ' header, theme and language switch', async () => {
          await open(home);
          if (viewport.width < 1366) {
            await click(page.locator('.nav-toggle'));
            assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'), 'true');
          }
          const old = await page.locator('html').getAttribute('data-theme');
          await click(page.locator('[data-theme-toggle]'));
          await until(async () => (await page.locator('html').getAttribute('data-theme')) !== old, 'Theme button is inert');
          if (viewport.width < 1366) await click(page.locator('.nav-toggle'));
          await click(page.locator('[data-lang-switch]'));
          await until(async () => (await page.locator('html').getAttribute('lang')) === (en ? 'tr' : 'en'), 'Language did not change');
          await click(page.locator('[data-lang-switch]'));
          await until(async () => (await page.locator('html').getAttribute('lang')) === locale, 'Return language did not change');
          await page.screenshot({ path: `outputs/clickable/${viewport.width}-${locale}-home.png`, timeout: 10000 });
        });
        await test(locale + ' search open, clear, result and keyboard', async () => {
          await open(home);
          const opener = page.locator(viewport.width < 1366 ? '.nav-search-toggle-mobile' : '[data-search-open]');
          await click(opener);
          const input = page.locator('.site-search-input');
          await until(() => input.evaluate(e => document.activeElement === e), 'Search input was not focused');
          await input.fill('Galatasaray');
          await page.locator('.site-search-option').first().waitFor().catch(async e => { throw new Error('First search: ' + e.message + ' ' + JSON.stringify(await input.evaluate(e => ({ value: e.value, active: document.activeElement === e, panel: e.form.querySelector('.site-search-panel').outerHTML.slice(0, 800), nav: document.querySelector('.nav').className })))); });
          await navigate(page.locator('.site-search-option').first());
          await click(opener);
          await input.fill('Mauro');
          await page.locator('.site-search-option').first().waitFor().catch(e => { throw new Error('Second search: ' + e.message); });
          await click(page.locator('.site-search-clear'));
          assert.equal(await input.inputValue(), '');
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('.site-search-panel').isVisible(), false);
          if (viewport.width < 1366) assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'), 'false');
        });
        await test(locale + ' standings and leaders tabs: pointer and keyboard', async () => {
          await open(home);
          for (const prefix of ['standings', 'leaders']) {
            const labels = page.locator('.' + prefix + '-tabs__label');
            if (!await labels.count()) continue;
            for (let i = 0; i < await labels.count(); i++) {
              const label = labels.nth(i);
              await click(label);
              assert.equal(await label.getAttribute('aria-selected'), 'true');
              assert.equal(await page.locator('#' + await label.getAttribute('aria-controls')).isVisible(), true);
            }
            await labels.first().focus();
            assert.ok(await labels.first().evaluate(e => e === document.activeElement), 'Tab cannot receive keyboard focus');
            await page.keyboard.press('ArrowRight');
            assert.equal(await labels.nth(1).getAttribute('aria-selected'), 'true', 'Arrow key did not select tab');
          }
        });
        await test(locale + ' transfer feature opens filtered radar', async () => {
          await open(home);
          await navigate(page.locator('.home-transfer-feature-cover').first());
        });
        await test(locale + ' team cards open profiles', async () => {
          await open(en ? 'en/teams.html' : 'takimlar.html');
          const cards = page.locator('.team-card, .trend-card');
          assert.ok(await cards.count(), 'No team cards');
          await navigate(cards.first().locator('a').first());
        });
        await test(locale + ' player cards open profiles', async () => {
          await open(en ? 'en/player-radar.html' : 'oyuncu-radari.html');
          await navigate(page.locator('.player-card a[href*="player/"], .player-detail-card a[href*="oyuncular/"], .player-card a[href*="oyuncular/"]').first());
        });
        await test(locale + ' primary navigation routes and footer', async () => {
          await open(home);
          const links = await page.locator('.nav-links a').evaluateAll(nodes => nodes.map(a => a.getAttribute('href')));
          for (const href of [...new Set(links)]) {
            if (viewport.width < 1366) await click(page.locator('.nav-toggle'));
            const target = page.locator('.nav-links a[href=' + JSON.stringify(href) + ']');
            // Secondary navigation is intentionally in the mobile drawer;
            // desktop visitors reach those same routes through the footer.
            if (await target.isVisible()) await navigate(target);
            else {
              const footer = page.locator('footer a[href=' + JSON.stringify(href) + ']').first();
              assert.ok(await footer.count(), 'Hidden menu item has no accessible alternative: ' + href);
              await navigate(footer);
            }
          }
          for (const suffix of ['hakkinda.html', 'iletisim.html', 'gizlilik.html', 'kullanim-sartlari.html']) {
            await navigate(page.locator('footer a[href$=' + JSON.stringify(suffix) + ']').first());
          }
        });
        await test(locale + ' featured carousel, pause and card', async () => {
          await open(home);
          const root = page.locator('[data-featured-carousel]');
          assert.ok(await root.count(), 'Featured carousel missing');
          const slides = root.locator('[data-featured-slide]');
          assert.ok(await slides.count() > 1, 'Carousel needs multiple real fixtures');
          const active = () => root.locator('[data-featured-slide].is-active').getAttribute('data-featured-slide');
          const first = await active();
          await click(root.locator('[data-featured-next]'));
          await until(async () => await active() !== first, 'Carousel next did nothing');
          await click(root.locator('[data-featured-prev]'));
          await until(async () => await active() === first, 'Carousel previous did nothing');
          await click(root.locator('[data-featured-go]').nth(1));
          assert.equal(await active(), '1');
          const pause = root.locator('[data-featured-pause]');
          if (await pause.count()) {
            await click(pause);
            assert.equal(await pause.getAttribute('aria-pressed'), 'true');
          }
          await navigate(root.locator('[data-featured-slide].is-active a').first());
        });
        await test(locale + ' horizontal sliders and card surfaces', async () => {
          await open(home);
          const sliders = page.locator('[data-slider]');
          for (let i = 0; i < await sliders.count(); i++) {
            const slider = sliders.nth(i);
            const rail = slider.locator('.slider-rail');
            const next = slider.locator('[data-slider-next]');
            if (!await next.count()) continue;
            const overflows = await rail.evaluate(e => e.scrollWidth > e.clientWidth + 3);
            if (!overflows) { assert.equal(await next.isDisabled(), true); continue; }
            await click(next);
            await until(() => rail.evaluate(e => e.scrollLeft > 0), 'Slider next did not scroll');
            await click(slider.locator('[data-slider-prev]'));
            await until(() => rail.evaluate(e => e.scrollLeft < 3), 'Slider previous did not return');
          }
          const card = page.locator('.fixture-card').first();
          const target = await card.locator('a').first().getAttribute('href');
          const before = page.url();
          await click(card.locator('.fixture-card-rows'));
          await until(() => page.url() !== before, 'Whole match card is inert');
          assert.equal(new URL(page.url()).pathname, new URL(target, before).pathname);
        });
        await test(locale + ' news and column cards', async () => {
          await open(en ? 'en/news.html' : 'haberler.html');
          const news = page.locator('main a[href*="/haber/"], main a[href*="haber/"]').first();
          assert.ok(await news.count(), 'No news article route');
          await navigate(news);
          await open(en ? 'en/columns.html' : 'kose-yazilari.html');
          const column = page.locator('main a[href*="kose-yazilari/"],main a[href*="columns/"]').first();
          await navigate(column);
        });
        await test(locale + ' notification panel opens and dismisses without covering menu', async () => {
          await open(home);
          const fab = page.locator('.fr-pwa-fab');
          await click(fab);
          await page.locator('.fr-pwa-panel select').waitFor();
          assert.equal(await fab.getAttribute('aria-expanded'), 'true');
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('.fr-pwa-panel').count(), 0);
          assert.ok(await fab.evaluate(e => document.activeElement === e));
          if (viewport.width < 901) {
            await click(page.locator('[data-bottom-nav-menu]'));
            assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'), 'true');
            await click(page.locator('.nav-toggle'));
            assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'), 'false');
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal page overflow');
        });
        await test(locale + ' live score card opens match details', async () => {
          await open(en ? 'en/live-football-scores.html' : 'canli-skor.html');
          const link = page.locator('.live-scores-ticker__group:not([aria-hidden="true"]) a, .fixture-card a').first();
          assert.ok(await link.count(), 'No score card in the persisted feed');
          await navigate(link);
        });
        await test(locale + ' scorer, assist and statistics links', async () => {
          await open(en ? 'en/stats-hub.html' : 'istatistik-merkezi.html');
          for (const suffix of en ? ['top-scorers.html', 'top-assists.html', 'standings.html'] : ['gol-kralligi.html', 'asist-kralligi.html', 'puan-durumu.html']) {
            await navigate(page.locator('main a[href$=' + JSON.stringify(suffix) + ']').first());
          }
        });
      }
      await test('player quick links remain above the hero', async () => {
        await open('oyuncu-radari.html');
        await navigate(page.locator('.player-quick-links a').first());
      });
      await test('Champions League links open the requested sections', async () => {
        await open('index.html');
        const links = await page.locator('.cl-match-card a[href*="#"]').evaluateAll(nodes => nodes.map(a => a.getAttribute('href')));
        assert.ok(links.length, 'Champions League section links missing');
        for (const href of [...new Set(links)]) await navigate(page.locator('.cl-match-card a[href=' + JSON.stringify(href) + ']').first());
      });
      await test('league pages and return navigation', async () => {
        await open('index.html');
        for (const league of ['super-lig', 'sampiyonlar-ligi', 'avrupa-ligi', 'premier-league']) {
          await navigate(page.locator('a[href="./lig/' + league + '.html"]').first());
        }
      });
      await test('English transfer club dropdown and reset', async () => {
        await open('en/transfer-radar.html');
        const select = page.locator('[data-en-transfer-filter] select');
        const value = await select.locator('option').nth(1).getAttribute('value');
        await select.selectOption(value);
        assert.ok(new URL(page.url()).searchParams.get('team'));
        const rows = page.locator('tr[data-transfer-team]:visible');
        assert.ok(await rows.count(), 'Selected club has no transfer results');
        const count = await rows.count();
        await click(page.locator('[data-en-transfer-filter] button[type="reset"]'));
        assert.equal(await select.inputValue(), '');
        assert.ok(await rows.count() >= count);
      });
      await test('fixture previous/next and club filter', async () => {
        await open('super-lig-fikstur.html');
        const label = page.locator('.fixture-week-label');
        const next = page.locator('[data-fixture-nav="next"]');
        await next.waitFor();
        if (await next.isDisabled()) {
          await click(page.locator('[data-fixture-nav="prev"]'));
        }
        const before = await page.locator('[data-api-target="super-lig-fixtures"]').textContent();
        await click(next);
        await until(async () => await page.locator('[data-api-target="super-lig-fixtures"]').textContent() !== before, 'Fixture week did not change');
      });
      await test('Turkish transfer filters update results and recover', async () => {
        await open('transfer-radari.html');
        const club = page.locator('[data-transfer-team-filter]');
        await club.locator('option').nth(1).waitFor({ state: 'attached' });
        const value = await club.locator('option').nth(1).getAttribute('value');
        await club.selectOption(value);
        await until(() => new URL(page.url()).searchParams.get('team') === value, 'Club filter did not update');
        assert.equal(await page.locator('[data-transfer-direction-filter]').isDisabled(), false);
        await club.selectOption('');
        for (const filter of ['son-hareket', 'all']) {
          const button = page.locator('[data-transfer-filter="' + filter + '"]');
          await click(button);
          assert.equal(await button.getAttribute('aria-pressed'), 'true');
        }
        assert.ok(await page.locator('.transfer-radar-card').count(), 'Transfer results did not recover');
      });
      await test('player search filters actual profile cards', async () => {
        await open('oyuncu-radari.html');
        await page.locator('[data-player-page-next]').waitFor();
        assert.ok(await page.locator('.player-detail-card').count() <= 24, 'Unbounded player rendering');
        const first = await page.locator('.player-detail-card').first().getAttribute('data-player');
        await click(page.locator('[data-player-page-next]'));
        await until(async () => await page.locator('.player-detail-card').first().getAttribute('data-player') !== first, 'Next player page did not change');
        await click(page.locator('[data-player-page-prev]'));
        assert.equal(await page.locator('.player-detail-card').first().getAttribute('data-player'), first);
        const input = page.locator('[data-player-search-filter]');
        await input.fill('Osimhen');
        await until(async () => {
          const titles = await page.locator('.player-detail-card h2').allTextContents();
          return titles.length > 0 && titles.every(t => /Osimhen/i.test(t));
        }, 'Player search did not filter cards', 15000);
        await input.fill('');
        await until(async () => await page.locator('.player-detail-card').count() > 1, 'Clearing search did not restore cards');
      });
      await test('share uses canonical player URL and exposes clipboard failure', async () => {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
          Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copiedText = text; if (window.__denyCopy) throw new Error('Denied for regression test'); } }, configurable: true });
        });
        await open('oyuncu-radari.html');
        const share = page.locator('[data-share-player]').first();
        await share.waitFor();
        const id = await share.getAttribute('data-share-player');
        await click(share);
        await until(() => page.evaluate(() => Boolean(window.__copiedText)), 'Share button did nothing');
        assert.equal(new URL(await page.evaluate(() => window.__copiedText)).pathname, '/oyuncular/' + encodeURIComponent(id) + '.html');
        await page.evaluate(() => { window.__denyCopy = true; });
        await click(share);
        await page.locator('[data-share-fallback]').waitFor();
        assert.ok((await page.locator('[data-share-fallback] textarea').inputValue()).includes(id));
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('[data-share-fallback]').count(), 0);
      });
      await context.close();
    }
    await Promise.all([0, 1].map(async () => {
      while (queue.length) await runViewport(queue.shift());
    }));
  } finally { await browser.close(); }
  const failed = results.filter(r => !r.passed);
  console.log(`Clickable browser: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length || !results.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { if (server) server.kill(); });
