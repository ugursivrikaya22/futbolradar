/**
 * Ana sayfa: canlı yeniden çizimde maç kartının kimliği DEĞİŞMEZ.
 *
 * 12 Ekim 2026: statik kartlar takvim kimliğiyle (`eyupspor-goztepe-2026-10-12`)
 * çiziliyor, canlı /api/matches gelince aynı maç sağlayıcının sayısal
 * kimliğiyle (`1584423`) yeniden çiziliyordu. Takvim kimliğiyle kaydedilmiş
 * takip tercihi düşüyor, kartı kimliğiyle izleyen her şey (tam derlemenin
 * tarayıcı kapısı dahil) kopuyordu.
 *
 * Bu test canlı yeniden çizimi taklit eder: /api/matches sayısal kimlikle
 * döner, kimlik tablosu (calendarIds) sağlayıcı→takvim eşlemesini verir.
 * Beklenen: kart kimlikleri takvim kimliği; sayısal kimlikle saklanmış eski
 * takip kaydı takvim kimliğine taşınır ve kartta "açık" görünür. Kontrol
 * olarak tablo verilmezse kimliklerin sayısal kaldığı da doğrulanır (test
 * gerçekten yeniden çizimi gözlüyor).
 */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
// İki maç: biri canlı, biri ertelenmiş (kimlikte eski tarih, başlama bugün).
// Ertelenmiş maçın başlaması İstanbul gününün İÇİNDE kalmalı: "+3 saat"
// 21:00'den (TRT) sonra ertesi güne taşıyor, kart ana sayfada hiç çizilmiyor
// ve kontrol adımı akşamları kırmızıya düşüyordu. Günün sonuna en fazla
// 3 saat, en az 1 dakika kala bir saat seçilir.
const ISTANBUL_OFFSET_MS = 3 * 3600000;
const istanbulDayEnd = Math.floor((now + ISTANBUL_OFFSET_MS) / 86400000) * 86400000 + 86400000 - ISTANBUL_OFFSET_MS;
// Canlı maç da aynı İstanbul gününde başlamış olmalı: 00:00–00:55 TRT arası
// "55 dk önce" önceki güne düşüyor ve kart çizilmiyordu.
const istanbulDayStart = istanbulDayEnd - 86400000;
const startedToday = Math.min(now - 60000, Math.max(now - 55 * 60000, istanbulDayStart + 60000));
const laterToday = Math.max(now + 60000, Math.min(now + 3 * 3600000, istanbulDayEnd - 5 * 60000));
const fixtures = [
  { calendarId: 'qa-home-fc-qa-away-fc-2026-10-11', providerId: '9900001', home: 'QA Home FC', away: 'QA Away FC', status: 'LIVE', minute: 55, score: { home: 1, away: 0 }, kickoff: iso(startedToday) },
  { calendarId: 'qa-north-qa-south-2026-10-12', providerId: '9900002', home: 'QA North', away: 'QA South', status: 'SCHEDULED', minute: null, score: { home: null, away: null }, kickoff: iso(laterToday) }
];
const apiMatch = (f) => ({
  id: f.providerId, providerId: f.providerId, source: 'api-football', homeTeam: f.home, awayTeam: f.away,
  league: 'Süper Lig', competition: 'Süper Lig', country: 'Turkey', status: f.status, minute: f.minute, score: f.score,
  kickoff: f.kickoff, date: f.kickoff.slice(0, 10), updatedAt: iso(now), fetchedAt: iso(now), events: []
});

let withTable = true;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/matches')) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, source: 'api-football', updatedAt: iso(now), data: fixtures.map(apiMatch) }));
  }
  if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, data: [] })); }
  if (url.pathname === '/data/match-notification-identities.json') {
    res.setHeader('Content-Type', 'application/json');
    const calendarIds = withTable ? Object.fromEntries(fixtures.map((f) => [f.providerId, f.calendarId])) : undefined;
    return res.end(JSON.stringify({ aliases: {}, calendarIds }));
  }
  let file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (fs.existsSync(file) && fs.statSync(file).isFile()) { res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); return res.end(fs.readFileSync(file)); }
  res.statusCode = 404; res.end();
});

async function cardIds(page) {
  await page.waitForFunction((ids) => {
    const seen = [...document.querySelectorAll('.fixture-card[data-match]')].map((c) => c.getAttribute('data-match'));
    return ids.some((id) => seen.includes(id));
  }, fixtures.flatMap((f) => [f.calendarId, f.providerId]), { timeout: 30000 });
  await page.waitForTimeout(1500);
  return page.$$eval('.fixture-card[data-match]', (cards) => cards.map((c) => c.getAttribute('data-match')));
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    // 1) Kontrol: tablo yoksa yeniden çizim sayısal kimlik basar (testin gözlediği şey bu).
    withTable = false;
    let page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(origin + '/');
    let ids = await cardIds(page);
    assert.ok(fixtures.every((f) => ids.includes(f.providerId)), 'kontrol: tablo yokken sayısal kimlik beklenirdi: ' + ids.join(','));
    await page.close();

    // 2) Tablo varken: kart kimliği takvim kimliği; eski sayısal takip kaydı taşınır.
    withTable = true;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript((record) => {
      if (!sessionStorage.getItem('qa-seeded')) {
        sessionStorage.setItem('qa-seeded', '1');
        localStorage.setItem('futbolradar:followed-matches:v1', JSON.stringify([record]));
      }
    }, { id: fixtures[0].providerId, homeTeam: fixtures[0].home, awayTeam: fixtures[0].away, followedAt: now });
    page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/');
    ids = await cardIds(page);
    for (const f of fixtures) {
      assert.ok(ids.includes(f.calendarId), `${f.home}: kart takvim kimliğiyle çizilmeli (görülen: ${ids.join(',')})`);
      assert.ok(!ids.includes(f.providerId), `${f.home}: kart sayısal kimliğe dönmemeli`);
    }
    // İkinci canlı çizim (yoklama) sonrası da kimlik aynı kalır.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(2000);
    const again = await page.$$eval('.fixture-card[data-match]', (cards) => cards.map((c) => c.getAttribute('data-match')));
    assert.ok(fixtures.every((f) => again.includes(f.calendarId)), 'tekrar çizimde kimlik korunmalı');

    // Yeniden çizilen her kartta takip düğmesi olmalı. Aynı karede birden çok
    // bölüm çizildiğinde (canlı veri gelişi) yalnızca ilk bölüm senkronlanıp
    // kartlar düğmesiz kalıyordu; bunu belirlenimli olarak canlandır.
    await page.evaluate(() => {
      document.querySelectorAll('.match-follow-button').forEach((b) => b.remove());
      const cardSection = document.querySelector('.fixture-card').closest('[data-api-target]') || document.querySelector('.fixture-card').parentElement;
      const other = document.createElement('div'); document.body.appendChild(other);
      document.dispatchEvent(new CustomEvent('futbolradar:rendered', { detail: { target: other } }));
      document.dispatchEvent(new CustomEvent('futbolradar:rendered', { detail: { target: cardSection } }));
    });
    await page.waitForTimeout(500);
    const missing = await page.$$eval('.fixture-card[data-match]', (cards) => cards.filter((c) => !c.querySelector('.match-follow-button')).map((c) => c.getAttribute('data-match')));
    assert.deepEqual(missing, [], 'aynı karede çizilen bölümlerde takip düğmesi eksik: ' + missing.join(','));

    const follow = page.locator(`.fixture-card[data-match="${fixtures[0].calendarId}"] .match-follow-button`);
    await follow.waitFor({ timeout: 15000 });
    await page.waitForFunction((id) => {
      const stored = JSON.parse(localStorage.getItem('futbolradar:followed-matches:v1') || '[]');
      return stored.some((r) => r.id === id);
    }, fixtures[0].calendarId, { timeout: 15000 });
    assert.equal(await follow.getAttribute('aria-pressed'), 'true', 'sayısal kimlikle saklanmış takip, takvim kimlikli kartta açık görünmeli');
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('futbolradar:followed-matches:v1')));
    assert.deepEqual(stored.map((r) => r.id), [fixtures[0].calendarId]);
    assert.ok(stored[0].aliases.includes(fixtures[0].providerId), 'sayısal kimlik takma ad olarak korunmalı');
    assert.deepEqual(errors, []);
    console.log('home-stable-match-id OK: canlı yeniden çizimde kart kimlikleri takvim kimliği, eski sayısal takip kaydı taşındı.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
