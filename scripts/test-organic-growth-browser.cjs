const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const { improveOrganicSharing } = await import('./lib/organic-growth.mjs');
  const root = process.cwd();
  const folder = path.join(root, 'outputs/organic-growth');
  fs.mkdirSync(folder, { recursive: true });
  // Real static homepage; isolate this feature from unrelated live APIs/scripts.
  const html = improveOrganicSharing(fs.readFileSync('index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const results = [];
  try {
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'www.futbolradar.com') return route.abort();
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        const file = path.resolve(root, '.' + url.pathname);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.abort();
        return route.fulfill({ path: file });
      });
      const page = await context.newPage();
      await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedLink = value; } } }));
      await page.goto('https://www.futbolradar.com/');
      const section = page.locator('[data-page-share]');
      await section.scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Bağlantıyı kopyala' }).click();
      await page.getByRole('status').filter({ hasText: 'Bağlantı kopyalandı.' }).waitFor();
      assert.equal(await page.evaluate(() => window.copiedLink), 'https://www.futbolradar.com/');
      await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
      await page.getByRole('button', { name: 'Bağlantıyı kopyala' }).click();
      const input = page.getByRole('textbox', { name: 'Paylaşılacak bağlantı' });
      await input.waitFor({ state: 'visible' });
      assert.equal(await input.inputValue(), 'https://www.futbolradar.com/');
      assert.ok(await input.evaluate(el => el === document.activeElement && el.selectionEnd === el.value.length));
      const bounds = await section.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'sharing must fit viewport');
      await section.screenshot({ path: path.join(folder, `share-${width}.png`) });
      results.push({ width, copySuccess: true, deniedClipboardFallback: true, fitsViewport: true });
      await context.close();
    }
    const nojs = await browser.newContext({ javaScriptEnabled: false });
    const page = await nojs.newPage();
    await page.setContent(html);
    assert.equal(await page.locator('[data-page-share] a').count(), 2);
    assert.equal(await page.locator('[data-page-share-copy]').isVisible(), false);
    await nojs.close();
    fs.writeFileSync(path.join(folder, 'browser-results.json'), JSON.stringify({ results, noJavaScriptLinks: true, scope: 'Sharing component on static homepage; unrelated scripts and network blocked.' }, null, 2));
    console.log(JSON.stringify(results));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
