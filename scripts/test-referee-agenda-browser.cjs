const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs/referee-agenda-qa');
const agenda = require('../services/refereeAgenda'), view = require('../referee-agenda');
const sampleTime = Date.parse('2026-10-02T13:00:00Z');
const sampleItems = Array.from({ length:4 }, (_, i) => {
  const item = { id: 'qa-' + i, tag: agenda.TAG, status:'approved', kind:'report', text:'QA — yalnız tarayıcı testi. Ayrı kaynak ve tarih taşıyan doğrulanmış gelişme örneği ' + (i + 1) + '.', label:'GELİŞME', subjectKeys:['qa-' + i], importance:'high', publishedAt:new Date(sampleTime - 1000).toISOString(), updatedAt:new Date(sampleTime - 1000).toISOString(), sourcePublishedAt:new Date(sampleTime - 1000).toISOString(), expiresAt:new Date(sampleTime + 3600000).toISOString(), sources:[{name:'Test source',url:'https://www.dha.com.tr/test-only'}] };
  item.review = {status:'verified',by:'test-only',notes:'In-memory fixture',legalStatusChecked:true,conflictsChecked:true,checkedAt:new Date(sampleTime - 500).toISOString(),contentHash:agenda.reviewHash(item)}; return item;
});
const sampleFeed = agenda.buildFeed({enabled:true,items:sampleItems}, [], sampleTime).feed;
let servedFeed = sampleFeed;
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/data/referee-agenda.json') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(servedFeed)); }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || pathname.startsWith('/api/')) { res.setHeader('Content-Type','application/json'); return res.end('{"ok":true,"data":[]}'); }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end(''); }
    res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' }[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
    if (pathname === '/') {
      const html = fs.readFileSync(file,'utf8').replace(/(<aside class="referee-agenda"[^>]*>)[\s\S]*?<\/aside>/, (_,start) => start + view.render(servedFeed,sampleTime) + '</aside>').replace(/(<script type="application\/json" id="referee-agenda-data">)[\s\S]*?<\/script>/, (_,start) => start + JSON.stringify(servedFeed) + '</script>');
      return res.end(html);
    }
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(time => { Date.now = () => time; }, sampleTime);
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    for (const width of [320,390,768,1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(origin, { waitUntil:'domcontentloaded' });
      const strip = page.locator('[data-referee-agenda]'); await strip.waitFor();
      assert.equal(await strip.locator('.referee-agenda__group:not([aria-hidden]) a').count(), 4);
      assert.equal(await strip.locator('h1,h2').count(), 0);
      assert.equal(await strip.locator('[aria-hidden] a:not([tabindex="-1"])').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `homepage overflow ${width}`);
      await strip.locator('button').click(); assert.equal(await strip.locator('button').getAttribute('aria-pressed'), 'true');
      assert.equal(await strip.locator('.referee-agenda__track').evaluate(e => getComputedStyle(e).animationPlayState), 'paused');
      await strip.locator('button').click();
      fs.mkdirSync(out, { recursive:true }); await strip.screenshot({ path: path.join(out, `light-${width}.png`) });
      await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await strip.screenshot({ path: path.join(out, `dark-${width}.png`) });
    }
    await page.emulateMedia({ reducedMotion:'reduce' });
    assert.equal(await page.locator('.referee-agenda__track').evaluate(e=>getComputedStyle(e).animationName), 'none');
    assert.equal(await page.locator('.referee-agenda__group[aria-hidden]').evaluate(e=>getComputedStyle(e).display), 'none');
    await page.locator('.referee-agenda__viewport').focus();
    assert.ok(await page.locator('.referee-agenda__viewport').evaluate(e=>e.scrollWidth>e.clientWidth));
    const href = await page.locator('.referee-agenda__label').getAttribute('href'); const response = await page.request.get(origin + href); assert.equal(response.status(), 200); assert.match(await response.text(), /Hakemler Dosyası/);
    const before = await page.locator('[data-referee-agenda]').boundingBox();
    await page.evaluate(() => { Date.now = () => new Date('2026-10-07T00:00:00Z').getTime(); document.dispatchEvent(new Event('visibilitychange')); });
    await page.locator('[data-referee-agenda]').waitFor({state:'hidden'});
    assert.equal(await page.locator('.referee-agenda__item').count(), 0);
    assert.equal(await page.locator('[data-referee-agenda]').boundingBox(), null, 'expired strip takes no space');
    servedFeed = {...sampleFeed,items:[]};
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.locator('[data-referee-agenda]').waitFor({state:'hidden'});
    servedFeed = sampleFeed;
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await page.locator('[data-referee-agenda]').waitFor({state:'visible'});
    assert.equal(await page.locator('.referee-agenda__group:not([aria-hidden]) a').count(),4);

    assert.deepEqual(errors, []);
    const bytes = ['referee-agenda.js','referee-agenda.css'].reduce((n,f)=>n+fs.statSync(path.join(root,f)).size,0);
    assert.ok(bytes < 16000); console.log(`Browser passed: 320/390/768/1440, light/dark, pause, reduced motion, no overflow, source article, live expiry hides, empty-to-new-feed reopens; assets ${bytes} bytes.`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
