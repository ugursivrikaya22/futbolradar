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
let scenarioNumber = 0;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(check, message, timeout = 5000) {
  const end = Date.now() + timeout;
  do { if (await check()) return; await delay(100); } while (Date.now() < end);
  assert.fail(message);
}
(async () => {
  fs.mkdirSync('outputs/clickable', { recursive: true });
  if (!process.env.AUDIT_BASE_URL) {
    fs.writeFileSync('outputs/clickable/preview-server.log', '');
    server = spawn(process.execPath, ['scripts/serve-static.mjs'], { env: { ...process.env, PORT: '4187' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    server.stdout.resume();
    server.stderr.on('data', chunk => fs.appendFileSync('outputs/clickable/preview-server.log', chunk));
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
      // Destination/content assertions below own navigation waiting; third-party
      // images must not hold an otherwise completed click until window.load.
      const click = async locator => {
        // Finish scrolling before pointer input. Smooth document scrolling can
        // otherwise oscillate between the fixed header and bottom navigation.
        await locator.evaluate(element => new Promise((resolve, reject) => {
          element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
          const started = performance.now();
          let stableSince = started;
          let previous;
          function measure() {
            const now = performance.now();
            const rect = element.getBoundingClientRect();
            const current = [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 2)).join(',');
            if (current !== previous) { previous = current; stableSince = now; }
            if (now - stableSince >= 150) return resolve();
            if (now - started > 5000) return reject(new Error('Click target did not settle'));
            requestAnimationFrame(measure);
          }
          requestAnimationFrame(measure);
        }));
        return touch ? locator.tap({ noWaitAfter: true }) : locator.click({ noWaitAfter: true });
      };
      async function swipeRail(rail, direction) {
        await rail.evaluate(element => new Promise(resolve => {
          element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        const box = await rail.boundingBox();
        const left = Math.max(24, box.x + 24);
        const right = Math.min(viewport.width - 24, box.x + box.width - 24);
        const y = Math.max(130, Math.min(viewport.height - 100, box.y + box.height / 2));
        const start = direction > 0 ? right : left;
        const end = direction > 0 ? left : right;
        assert.ok(await rail.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), { x: start, y }), 'Swipe target is covered: ' + await rail.getAttribute('id'));
        await rail.evaluate(element => {
          element.__auditScrollEnded = false;
          element.addEventListener('scrollend', () => { element.__auditScrollEnded = true; }, { once: true });
        });
        const input = await context.newCDPSession(page);
        try {
          await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
          for (let step = 1; step <= 12; step++) {
            await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start + (end - start) * step / 12, y }] });
            await delay(25);
          }
          await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await until(() => rail.evaluate(element => element.__auditScrollEnded), 'Touch scroll did not finish: ' + await rail.getAttribute('id'));
        } finally { await input.detach(); }
      }
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
        // Each independent scenario represents a separate preview client.
        // Keep actual per-client rate limits active; never send synthetic
        // forwarding headers to a deployed host.
        if (['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) {
          await context.setExtraHTTPHeaders({ 'x-forwarded-for': '192.0.2.' + (++scenarioNumber) });
        }
        page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(30000);
        consoleErrors = [];
        const startedAt = Date.now();
        page.on('pageerror', e => consoleErrors.push({ kind: 'runtime', message: e.message, url: page.url() }));
        page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ kind: 'console', message: m.text(), url: m.location().url }); });
        try {
          await run();
          assert.deepEqual(consoleErrors, [], 'Browser errors');
          results.push({ viewport, name, passed: true, durationMs: Date.now() - startedAt });
          console.log('PASS', viewport.width, name);
        } catch (e) {
          const screenshot = path.join('outputs', 'clickable', `${viewport.width}-${results.length}.png`);
          await page.screenshot({ path: screenshot, timeout: 5000 }).catch(() => {});
          results.push({ viewport, name, passed: false, error: e.message, url: page.url(), consoleErrors, screenshot });
          console.log('FAIL', viewport.width, name, e.message.slice(0, 160));
        }
        fs.writeFileSync(reportFile, JSON.stringify({ base, results }, null, 2));
      }
      async function navigate(locator, surface = locator) {
        const before = page.url();
        const expected = await locator.getAttribute('href');
        assert.ok(expected && expected !== '#' && !expected.startsWith('javascript:'), 'Empty link');
        const target = new URL(expected, before);
        console.log('NAV', viewport.width, expected);
        await click(surface);
        await page.waitForURL(url => url.href !== before, { waitUntil: 'domcontentloaded' });
        assert.equal(new URL(page.url()).pathname.replace(/\.html$/, ''), target.pathname.replace(/\.html$/, ''), 'Wrong destination');
        await page.locator('main').waitFor();
        assert.ok((await page.locator('h1').first().innerText()).trim(), 'Empty destination');
        if (target.pathname.endsWith('/takim-detay.html')) {
          await page.locator('[data-api-target="team-detail"][data-state="ready"] [data-card="team-detail"]').waitFor();
          const requested = target.searchParams.get('team');
          if (requested) assert.ok((await page.locator('.td-hero').innerText()).includes(requested), 'Wrong team detail content');
        }
        if (/\/(oyuncular|en\/player)\//.test(target.pathname)) {
          assert.ok((await page.locator('main').innerText()).length > 200, 'Player profile has no substantive content');
        }
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
        await page.locator('footer').waitFor({ state: 'attached' });
        // Restored HTML arrives before its API panels finish. Let the page
        // become usable before scrolling to the next target; otherwise late
        // content can move a footer link between pointer-down and pointer-up.
        if (!new URL(before).pathname.startsWith('/en/') && await page.locator('[data-api-target="today-matches"]').count()) {
          await page.locator('[data-api-target="today-matches"][data-state]:not([data-state="loading"])').waitFor({ state: 'attached' });
        }
        await until(async () => await page.locator('main [data-api-target][data-state="loading"]:visible').count() === 0, 'Back navigation content is still loading', 15000);
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
          let languageTarget = new URL(await page.locator('[data-lang-switch]').getAttribute('href'), page.url());
          await click(page.locator('[data-lang-switch]'));
          await page.waitForURL(url => url.pathname === languageTarget.pathname, { waitUntil: 'domcontentloaded' });
          await until(async () => (await page.locator('html').getAttribute('lang')) === (en ? 'tr' : 'en'), 'Language did not change');
          languageTarget = new URL(await page.locator('[data-lang-switch]').getAttribute('href'), page.url());
          await click(page.locator('[data-lang-switch]'));
          await page.waitForURL(url => url.pathname === languageTarget.pathname, { waitUntil: 'domcontentloaded' });
          await until(async () => (await page.locator('html').getAttribute('lang')) === locale, 'Return language did not change');
          await page.screenshot({ path: `outputs/clickable/${viewport.width}-${locale}-home.png`, timeout: 10000, animations: 'disabled' })
            .catch(error => console.log('SCREENSHOT', viewport.width, locale, error.message.split('\n')[0]));
        });
        await test(locale + ' search open, clear, result and keyboard', async () => {
          await open(home);
          const opener = page.locator(viewport.width < 1366 ? '.nav-search-toggle-mobile' : '[data-search-open]');
          await click(opener);
          const input = page.locator('.site-search-input');
          await until(() => input.evaluate(e => document.activeElement === e), 'Search input was not focused');
          await input.fill('Galatasaray');
          await page.locator('.site-search-option').first().waitFor().catch(async e => { throw new Error('First search: ' + e.message + ' ' + JSON.stringify(await input.evaluate(e => ({ value: e.value, active: document.activeElement === e, panel: e.form.querySelector('.site-search-panel').outerHTML.slice(0, 800), nav: document.querySelector('.nav').className })))); });
          if (en) assert.ok(new URL(await page.locator('.site-search-option').first().getAttribute('href'), page.url()).pathname.startsWith('/en/'), 'English profile search must preserve language');
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
          if (!en) await page.locator('[data-api-target="teams-page"][data-state="ready"]').waitFor();
          const cards = page.locator('.team-card, .trend-card, [data-card="team"]');
          assert.ok(await cards.count(), 'No team cards');
          const link = cards.first().locator(en ? 'a' : '.team-card-actions a').first();
          await navigate(link, en ? link : cards.first().locator('h2'));
        });
        await test(locale + ' player cards open profiles', async () => {
          await open(en ? 'en/player-radar.html' : 'oyuncu-radari.html');
          if (!en) await page.locator('[data-api-target="players-page"][data-state="ready"]').waitFor();
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
          for (const suffix of en ? [] : ['hakkinda.html', 'iletisim.html', 'gizlilik.html', 'kullanim-sartlari.html']) {
            await navigate(page.locator('footer a[href$=' + JSON.stringify(suffix) + ']').first());
          }
        });
        await test(locale + ' featured carousel, pause and card', async () => {
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await open(home);
          const heroContainer = page.locator('#featured-radar-match').first();
          assert.ok(await heroContainer.count(), 'Featured hero container missing');
          const heroVisible = await heroContainer.isVisible().catch(() => false);
          const hasFeaturedApiTarget = await heroContainer.evaluate(node => node.getAttribute('data-api-target') === 'featured-match');
          if (!en && hasFeaturedApiTarget && heroVisible) {
            await until(async () => (await heroContainer.getAttribute('data-state')) === 'ready', 'Featured hero state did not become ready', 15000);
          }
          const root = heroContainer.locator('[data-featured-carousel]').first();
          if (!await root.isVisible().catch(() => false)) {
            assert.equal(heroVisible, false, 'Featured carousel missing while hero module is visible');
            const heroHiddenByLayout = await heroContainer.evaluate(node => {
              const section = node.closest('section.hero');
              if (!section) return false;
              const style = getComputedStyle(section);
              const rect = section.getBoundingClientRect();
              return section.hidden || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width === 0 || rect.height === 0;
            });
            assert.equal(heroHiddenByLayout, true, 'Featured carousel hidden for an unexpected reason');
            const focusVisible = await heroContainer.evaluate(node => {
              const heroSection = node.closest('section.hero');
              const siblings = heroSection ? [heroSection.previousElementSibling, heroSection.nextElementSibling] : [];
              const focus = siblings.find(candidate => candidate && candidate.matches && candidate.matches('section.match-focus')) || null;
              if (!focus) return false;
              const style = getComputedStyle(focus);
              const rect = focus.getBoundingClientRect();
              if (focus.hidden || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width === 0 || rect.height === 0) return false;
              return Boolean(focus.querySelector('[data-focus-board], [data-focus-title]'));
            });
            assert.ok(focusVisible, 'Featured module missing');
            return;
          }
          const pause = root.locator('[data-featured-pause]');
          if (await pause.count()) {
            await click(pause);
            assert.equal(await pause.getAttribute('aria-pressed'), 'true');
          }
          const slides = root.locator('[data-featured-slide]');
          const slideCount = await slides.count();
          assert.ok(slideCount > 0, 'Carousel has no fixture');
          if (slideCount === 1) {
            assert.equal(await root.locator('[data-featured-next], [data-featured-prev], [data-featured-pause]').count(), 0, 'A single fixture must not expose inert carousel controls');
            await navigate(slides.first().locator('a').first());
            return;
          }
          const active = () => root.locator('[data-featured-slide].is-active').getAttribute('data-featured-slide');
          const first = await active();
          await click(root.locator('[data-featured-next]'));
          await until(async () => await active() !== first, 'Carousel next did nothing');
          await click(root.locator('[data-featured-prev]'));
          await until(async () => await active() === first, 'Carousel previous did nothing');
          await click(root.locator('[data-featured-go]').nth(1));
          assert.equal(await active(), '1');
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
            if (touch && !await next.isVisible()) {
              await swipeRail(rail, 1);
              await until(() => rail.evaluate(e => e.scrollLeft > 0), 'Touch swipe did not scroll the rail: ' + await rail.getAttribute('id'));
              const forwardPosition = await rail.evaluate(e => e.scrollLeft);
              await swipeRail(rail, -1);
              const reversePosition = await rail.evaluate(e => e.scrollLeft);
              // Native momentum can advance different numbers of cards on
              // successive gestures. Verify direction, not identical distance.
              assert.ok(reversePosition < forwardPosition - 1, 'Reverse swipe did not move back: ' + await rail.getAttribute('id') + ' ' + forwardPosition + ' -> ' + reversePosition);
              console.log('SWIPE', viewport.width, await rail.getAttribute('id'), 0, forwardPosition, reversePosition);
              continue;
            }
            await click(next);
            await until(() => rail.evaluate(e => e.scrollLeft > 0), 'Slider next did not scroll');
            await click(slider.locator('[data-slider-prev]'));
            await until(() => rail.evaluate(e => e.scrollLeft < 3), 'Slider previous did not return');
          }
          const trendLink = page.locator('#home-trend-teams .trend-card a').first();
          assert.ok(await trendLink.count(), 'Trending team profile link missing');
          const trendTarget = new URL(await trendLink.getAttribute('href'), page.url());
          assert.ok(en ? trendTarget.pathname.startsWith('/en/team/') : trendTarget.pathname === '/takim-detay.html', 'Trending team must open its profile');
          await navigate(trendLink);
          if (!en) await page.locator('[data-api-target="today-matches"][data-state="ready"]').waitFor();
          const firstCard = page.locator('.fixture-card').first();
          const matchId = await firstCard.getAttribute('data-match');
          const card = matchId ? page.locator('.fixture-card[data-match=' + JSON.stringify(matchId) + ']').first() : firstCard;
          const target = await card.locator('.fixture-card-action, a').first().getAttribute('href');
          const before = page.url();
          // On touch layouts the card's native stretched link covers its rows.
          // Click the complete card surface, which includes that valid target.
          await click(card);
          await until(() => page.url() !== before, 'Whole match card is inert');
          assert.equal(new URL(page.url()).pathname, new URL(target, before).pathname);
        });
        await test(locale + ' news and column cards', async () => {
          await open(home);
          const tickerAll = page.locator('.news-ticker-all').first();
          await navigate(await tickerAll.isVisible() ? tickerAll : page.locator('main a.section-link[href$="' + (en ? 'news.html' : 'haberler.html') + '"]').first());
          await open(en ? 'en/news.html' : 'haberler.html');
          if (!en) await page.locator('[data-api-target="news-page"][data-state="ready"]').waitFor();
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
        await test(locale + ' live score cards or empty-state route', async () => {
          await open(en ? 'en/live-football-scores.html' : 'canli-skor.html');
          if (!en) {
            await page.locator('[data-api-target="live-score"][data-state]:not([data-state="loading"])').waitFor({ state: 'attached' });
          }
          const link = page.locator('main a.live-compact-card[href], main .fixture-card a[href]').first();
          if (await link.count()) {
            await navigate(link);
          } else {
            // A real feed can have no live matches. Confirm its explicit empty
            // state and exercise the route offered there, not a stale ticker.
            const status = page.locator(en ? '[aria-labelledby="en-live-title"]' : '[data-api-target="live-score"]');
            assert.match(await status.innerText(), en ? /Update pending|No live matches/i : /Şu anda canlı maç yok/);
            await navigate(page.locator(en ? 'main a[href="./todays-matches.html"]' : '[data-api-target="live-score"] a[href="./bugunun-maclari.html"]').first());
          }
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
      await test('unknown team has an honest state and a working return route', async () => {
        await open('takim-detay.html?team=__audit_missing_team__');
        const panel = page.locator('[data-api-target="team-detail"]');
        await until(async () => ['empty','unavailable'].includes(await panel.getAttribute('data-state')), 'Unknown team did not reach a terminal state', 20000);
        assert.equal(await panel.locator('[data-card="team-detail"]').count(), 0, 'Unknown ID must never render the first team');
        await navigate(panel.locator('a[href="./takimlar.html"]'));
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
        await page.locator('[data-api-target="players-page"][data-state="ready"]').waitFor();
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
        await page.locator('[data-share-fallback]').waitFor({ state: 'detached' });
      });
      await context.close();
    }
    const workers = process.platform === 'win32' ? [0] : [0, 1];
    await Promise.all(workers.map(async () => {
      while (queue.length) await runViewport(queue.shift());
    }));
  } finally { await browser.close(); }
  const failed = results.filter(r => !r.passed);
  console.log(`Clickable browser: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length || !results.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { if (server) server.kill(); });
