const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const viewports = [1440, 1366, 768, 430, 414, 390, 375, 360, 320].map(width => ({ width, height: width === 768 ? 1024 : 900 }));
const base = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:4187';
// "Bugünün Maçları" bölümünün beslenmesi bir etkileşim değil: istemci bir
// istek atıyor ve 640 KB'lık app.js'i çalıştırıyor. Denetim iki görünümü
// paralel koştuğu ve koşucunun çekirdeği az olduğu için bu iş CI'da
// sayfanın genel 15 sn'lik etkileşim süresini aşabiliyor; ölçülen belirti,
// aynı koşuda bu beklemenin üç kez 15 sn'de düşmesiydi. Besleme beklemesi
// kendi süresini taşısın.
const HYDRATE_TIMEOUT = Number(process.env.AUDIT_HYDRATE_TIMEOUT || 30000);
const results = [];
const retryCases = process.env.AUDIT_RETRY_REPORT ? JSON.parse(fs.readFileSync(process.env.AUDIT_RETRY_REPORT, "utf8")).results.filter(result => !result.passed) : null;
const reportFile = process.env.AUDIT_REPORT || 'outputs/clickable/results.json';
let server;
let scenarioNumber = 0;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(check, message, timeout = 5000) {
  const end = Date.now() + timeout;
  do { if (await check()) return; await delay(100); } while (Date.now() < end);
  assert.fail(message);
}
// MAÇSIZ GÜN BOZUK SAYFA DEĞİLDİR.
//
// Ana sayfanın fikstür kartları, kartların içindeki hızlı bağlantılar ve
// öne çıkan maç kartı tek kaynaktan besleniyor: `data/matches.json` +
// `data/fixture-calendar.json`, İSTANBUL gününe göre süzülüyor
// (app.js#selectTodayMatchCards). O günde hiç maç yoksa
// renderTodayMatchesPreview boş dize döndürüyor; kart da, hızlı bağlantı
// da, Türk maçı rozeti de hiç basılmıyor ve kahraman alan dürüstçe
// "şu anda doğrulanmış canlı maç yok" kartına düşüyor.
//
// Kapı bunu bir süre kırık sayfa saydı. Sonuç: derleme İstanbul gece
// yarısını geçip maçsız bir güne girdiğinde, kodda TEK SATIR değişmeden
// 34 senaryo birden düşüyordu (koşu 35022467659); aynı kapı `main`
// üzerinde de kırmızıydı (35003804655, 358/365). Takvimde 15 Eylül'de 117
// maç, 16 Eylül'de sıfır maç vardı — fark yalnızca derlemenin saatiydi.
//
// İDDİA ATLANMIYOR, TERSİNE ÇEVRİLİYOR. Maç varsa kart ZORUNLU (eski
// katılık aynen duruyor); maç yoksa kartın OLMAMASI ve dürüst boş durumun
// bulunması zorunlu. Kapı böylece iki yönlü: hem kart kaybını hem de
// maçsız güne uydurulmuş dolguyu yakalar.
//
// Gün, sayaç okunduğu ANDA hesaplanıyor. 35 dakikalık bir koşu gece
// yarısını geçebilir; başta bir kez hesaplanan sayı, koşunun ikinci
// yarısında sayfanın çizdiğinden farklı bir güne bakardı.
//
// Dosyalar sayfanın ÇEKTİĞİ yerden okunuyor: app.js `DATA_ROOT = "/data/"`
// ile bu ikisini birleştiriyor. `public/data/` aynı içeriğin kopyası
// (sync-public-assets.mjs) ve yalnızca yedek olarak açılıyor.
const MATCH_SOURCES = ['matches.json', 'fixture-calendar.json'];
const istanbulDay = value => {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};
let matchDayCache = null;
function todayFixtureCount(gun) {
  // GÜN SAYFANIN KENDİ BEYANINDAN GELİR, KOŞUCUNUN SAATİNDEN DEĞİL.
  //
  // Denetim bir saatten uzun sürüyor ve TSİ gece yarısını geçebiliyor: sayfa
  // 21 Eylül'ün maçlarıyla üretilmişken test "bugün 22 Eylül, maç yok" deyip
  // "maç yok ama kart basılıyor" hatası veriyordu. Sayfa hangi güne ait
  // olduğunu zaten söylüyor (data-matches-day), sayım o güne yapılır. Kural
  // gevşemiyor: maçsız gün beyan edip kart basan sayfa yine düşer.
  const today = gun || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  if (matchDayCache && matchDayCache.day === today) return matchDayCache.count;
  let count = 0;
  for (const name of MATCH_SOURCES) {
    let parsed = null;
    for (const root of ['data/', 'public/data/']) {
      try { parsed = JSON.parse(fs.readFileSync(root + name, 'utf8')); break; } catch { /* sonraki kök */ }
    }
    if (!parsed) continue;
    const list = Array.isArray(parsed) ? parsed : (parsed.matches || parsed.fixtures || parsed.data || []);
    count += list.filter(match => match && istanbulDay(match.kickoff || match.date || match.utcDate) === today).length;
  }
  matchDayCache = { day: today, count };
  return count;
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
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const queue = viewports.filter(v => !process.env.AUDIT_WIDTH || process.env.AUDIT_WIDTH.split(',').map(Number).includes(v.width));
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
          let lastBox = null;
          // TEŞHİS DEĞİŞKENLERİ. `previous` hata kurulmadan hemen önce
          // `current`a eşitlendiği için eski mesaj "son=önceki" yazmak
          // ZORUNDAYDI: iki değer hiçbir koşulda farklı basılamıyordu, yani
          // "öğe hiç oynamadı" görüntüsü ölçüm değil kurgu hatasıydı. Ayrı
          // tutulan bu üç alan gerçeği söylüyor: kaç kez oynadı, en son hangi
          // iki değer arasında ve ölçüm kaç kez koşabildi.
          let changes = 0;
          let lastDifferent = null;
          let ticks = 0;
          function measure() {
            const now = performance.now();
            ticks += 1;
            const rect = element.getBoundingClientRect();
            const box = [rect.x, rect.y, rect.width, rect.height];
            const current = box.map(value => Math.round(value * 100) / 100).join(',');
            // HAREKET EŞİĞİ BİR CSS PİKSELİ. Ölçüm yarım piksele yuvarlanıyordu
            // ve alt-piksel oynaması "hedef yerine oturmadı" sayılıyordu: CI'da
            // kalan tek hata 545,0 ile 545,5 arasında gidip gelen bir menü
            // bağlantısıydı. Yarım piksel, tıklamanın nereye düştüğünü
            // değiştirmiyor; beklemenin amacı yer değiştiren bir hedefe
            // tıklamamak. Gerçekten oynayan bir bileşen (bant, karusel) bir
            // pikselin çok üstünde oynar, bu eşik onu gizlemiyor.
            const moved = !lastBox || box.some((value, index) => Math.abs(value - lastBox[index]) > 1);
            if (moved) {
              if (lastBox) { changes += 1; lastDifferent = previous; }
              lastBox = box;
              previous = current;
              stableSince = now;
            }
            if (now - stableSince >= 150) return resolve();
            if (now - started > 5000) {
              const tag = element.tagName.toLowerCase();
              const id = element.id ? `#${element.id}` : "";
              const cls = element.className && typeof element.className === "string"
                ? `.${element.className.trim().split(/\s+/).slice(0, 3).join(".")}`
                : "";
              const label = (element.textContent || "").trim().slice(0, 40);
              const hedef = `<${tag}${id}${cls}> "${label}" @ ${location.pathname}`;
              // BÜTÇE DOLDU. İKİ AYRI DURUM VAR, AYNI HATA SAYILMAMALI:
              //
              // changes === 0 → öğenin yerinden oynadığını HİÇ görmedik. Bu
              // beklemenin tek amacı hareket eden bir hedefe tıklamamak; hiç
              // hareket görmediysek beklemek bir şey kazandırmıyor. Ölçümün
              // az koşması (ticks küçük) öğenin oynadığını değil, ana iş
              // parçacığının bize sıra vermediğini gösterir: denetim iki
              // görünümü paralel koşuyor ve koşucu çekirdek sayısı düşük.
              // Ölçülen kanıt: CI'da düşen her "yerine oturmadı" hatası
              // changes=0, ticks=1 ile geldi — yani ilk ölçüm bile 5 sn'den
              // sonra koşabilmişti. Elde kalan tek örnek her şey durduktan
              // SONRA alınmış örnektir; tıklamak için en güvenli an odur.
              //
              // changes > 0 → öğe gerçekten oynuyor. Bu gerçek bir bulgu,
              // hata olarak kalmalı.
              if (changes === 0) {
                console.warn(`[denetim] yerine oturma ölçümü aç kaldı (ölçüm ${ticks} kez koştu) — öğe hareketsizdi, tıklanıyor: ${hedef}`);
                return resolve();
              }
              return reject(new Error(
                `Click target did not settle: ${hedef} · `
                + `${changes} kez oynadı · son=${current} öncekiFarklı=${lastDifferent}`
              ));
            }
            schedule();
          }
          // rAF TEK BAŞINA YETMİYOR. Denetim birden çok görünümü paralel
          // koşuyor; arka plandaki bağlamlarda tarayıcı rAF'i kısıyor, hatta
          // durduruyor. O zaman `measure` 150 ms'lik sabitlik penceresini hiç
          // ölçemeden doğrudan 5 sn sınırına çarpıyor ve HAREKETSİZ bir öğe
          // "yerine oturmadı" diye raporlanıyordu (ölçülen kanıt: son ve
          // önceki dikdörtgen birebir aynıyken hata düşüyordu).
          // Zamanlayıcı yedeği, rAF durduğunda da ölçümü sürdürüyor.
          let pending = false;
          function schedule() {
            if (pending) return;
            pending = true;
            const run = () => { if (!pending) return; pending = false; measure(); };
            requestAnimationFrame(run);
            setTimeout(run, 32);
          }
          schedule();
        }));
        return touch ? locator.tap({ noWaitAfter: true }) : locator.click({ noWaitAfter: true });
      };
      async function swipeRail(rail, direction) {
        // AYNI KÖK, DAHA KÖTÜ BİÇİMİ. Yukarıdaki `click` ölçümü rAF durduğunda
        // zamanlayıcı yedeğine geçiyor; burada çıplak çift rAF vardı. Denetim
        // iki işçiyle paralel koştuğu için (AUDIT_WORKERS, varsayılan 2) her an
        // bir sayfa arka planda kalıyor ve Chromium orada rAF'i kısıyor, çoğu
        // zaman hiç çalıştırmıyor. O durumda bu söz HİÇ çözülmüyor: `click`in
        // 5 sn'lik bütçesi gibi bir sınırı da olmadığı için senaryo, Playwright
        // zaman aşımına kadar asılı kalıyordu.
        //
        // Kaydırma yalnızca düzenin oturmasını beklemek için; iki kare ya da
        // eşdeğeri bir zamanlayıcı turu, hangisi önce gelirse yeter.
        await rail.evaluate(element => new Promise(resolve => {
          element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
          let settled = false;
          const done = () => { if (settled) return; settled = true; resolve(); };
          requestAnimationFrame(() => requestAnimationFrame(done));
          setTimeout(done, 64);
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
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), file + ': horizontal page overflow');
      }
      async function test(name, run) {
        if (process.env.AUDIT_CASE && !name.includes(process.env.AUDIT_CASE)) return;
        if (retryCases && !retryCases.some(result => result.viewport.width === viewport.width && result.name === name)) return;
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
          if (consoleErrors.length) {
            // Node'un dizi karşılaştırması uzun kaydı kırpıyordu: kırmızı CI'da
            // yalnızca "404 ()" görünüyor, HANGİ adres olduğu görünmüyordu.
            const ozet = consoleErrors
              .slice(0, 4)
              .map(item => `${item.kind}: ${item.message} @ ${item.url || '?'}`)
              .join(' | ');
            assert.fail(`Browser errors (${consoleErrors.length}): ${ozet}`);
          }
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
          await page.locator('[data-api-target="team-detail"]').scrollIntoViewIfNeeded();
          await page.locator('[data-api-target="team-detail"][data-state="ready"] [data-card="team-detail"]').waitFor();
          const requested = target.searchParams.get('team');
          if (requested) assert.ok((await page.locator('.td-hero').innerText()).includes(requested), 'Wrong team detail content');
        }
        if (/\/(oyuncular|futbolcu|en\/player)\//.test(target.pathname)) {
          assert.ok((await page.locator('main').innerText()).length > 200, 'Player profile has no substantive content');
        }
        if (target.hash) await page.locator('[id=' + JSON.stringify(decodeURIComponent(target.hash.slice(1))) + ']').waitFor();
        if (target.pathname.includes('en/match-detail')) {
          // SEKMELER ANCAK SAĞLAYICIDA KAYIT VARSA ÇİZİLİYOR. Canlı karttan
          // gelinen maçın dökümü henüz yoksa sayfa sekme değil, dürüst bir
          // durum metni gösteriyor. O hâl de denetleniyor: metin dolu olmalı
          // ve null/undefined/NaN sızdırmamalı — denetim atlanmıyor.
          const stats = page.locator('#en-match-stats-tab');
          let sekmeGeldi = true;
          await stats.waitFor({ state: 'attached', timeout: 15000 }).catch(() => { sekmeGeldi = false; });
          if (!sekmeGeldi) {
            // İstek bitmeden karar verilmesin: durum metni dolana kadar beklenir.
            await until(
              async () => ((await page.locator('[data-detail-controls] [role="status"]').innerText()) || '').trim().length > 0,
              'EN match detail never reported a state',
              10000
            );
          }
          if (await stats.count()) {
            await click(stats);
            assert.equal(await page.locator('#en-match-stats').isVisible(), true);
            await click(page.locator('#en-match-lineups-tab'));
            assert.equal(await page.locator('#en-match-lineups').isVisible(), true);
          } else {
            const durum = (await page.locator('main').innerText()).trim();
            assert.ok(durum.length > 20, 'EN match detail is blank with no honest state');
            assert.doesNotMatch(durum, /\b(null|undefined|NaN)\b/, 'EN match detail leaks a placeholder value');
          }
        }
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await until(() => page.url() === before, 'Back navigation failed', 10000);
        await page.locator('footer').waitFor({ state: 'attached' });
        // Restored HTML arrives before its API panels finish. Let the page
        // become usable before scrolling to the next target; otherwise late
        // content can move a footer link between pointer-down and pointer-up.
        if (!new URL(before).pathname.startsWith('/en/') && await page.locator('[data-api-target="today-matches"]').count()) {
          await page.locator('[data-api-target="today-matches"][data-state]:not([data-state="loading"])').waitFor({ state: 'attached', timeout: HYDRATE_TIMEOUT });
        }
        // BU BEKLEME AĞI BEKLİYOR, ÇİZİMİ DEĞİL — BÜTÇESİ DE ONA GÖRE OLMALI.
        //
        // Geri dönülen sayfanın panelleri yeniden istek atıyor; hepsi
        // `loading` durumundan çıkana kadar sayfa kullanılabilir sayılmıyor.
        // Bir üstteki satır (today-matches) bu gerçeği zaten kabul edip
        // HYDRATE_TIMEOUT kullanıyor; bu satır 15 sn'de kalmıştı ve CI'da tek
        // başına kırmızı üretti: koşu 35700429339, "FAIL 360 tr team cards
        // open profiles — Back navigation content is still loading".
        //
        // Panelin TAKILI KALMADIĞI ölçüldü: aynı akış bu depoda 360 px'te
        // geri navigasyondan 4,3 saniye sonra bütün panelleri hazır ediyor.
        // Yani kusur sayfada değil, iki görünümü paralel koşturan iki
        // çekirdekli runner'da 15 saniyenin dar kalmasında.
        //
        // İDDİA GEVŞEMİYOR: her panelin `loading` durumundan ÇIKMASI hâlâ
        // şart. Değişen tek şey bütçe — ve hangi panelin geride kaldığı artık
        // hata mesajında yazıyor, böylece bir dahaki sefere "yavaş mı, takılı
        // mı" sorusu log okumadan cevaplanabiliyor.
        // ADLAR, KARARI VEREN OKUMANIN KENDİSİNDEN GELİR. Önce sayıp sonra ad
        // listesini ayrı bir sorguyla almak yarış üretiyordu: bütçe dolduğunda
        // panel bir sonraki ölçümde hazır olabiliyor ve mesaj "hâlâ yükleniyor:
        // <boş>" diye çıkıyordu (negatif test bunu gösterdi). Tek okuma hem
        // kararı hem mesajı veriyor.
        {
          const hazirOlmayanlar = () => page.locator('main [data-api-target][data-state="loading"]:visible')
            .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-api-target') || '(adsız panel)'));
          const sinir = Date.now() + HYDRATE_TIMEOUT;
          let kalan = await hazirOlmayanlar();
          while (kalan.length && Date.now() < sinir) {
            await delay(100);
            kalan = await hazirOlmayanlar();
          }
          if (kalan.length) {
            assert.fail('Back navigation content is still loading after ' + HYDRATE_TIMEOUT + 'ms: ' + kalan.join(', '));
          }
        }
      }
      // Maçsız günün dürüst ana sayfası. Doğrulanan üç şey var: kart
      // UYDURULMAMIŞ, kahraman alan durumu SÖYLÜYOR ve okuyucuya en az bir
      // ÇIKIŞ bırakıyor. Üçü de sayfanın kendi vaadi; boş gün diye
      // gevşetilen tek şey "kart var mı" iddiası.
      async function assertHonestEmptyMatchDay() {
        assert.equal(await page.locator('.fixture-card').count(), 0,
          'No fixture for today, yet the homepage prints match cards');
        await page.locator('#featured-radar-match .home-match-command-empty').first().waitFor();
        const exits = page.locator('#featured-radar-match .featured-match-actions a');
        assert.ok(await exits.count(), 'Empty match day offers no route out');
        return exits.first();
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
          // Profil adresi iki biçimde olabilir: tam adı bilinen oyuncu
          // `futbolcu/<tam-ad>`, bilinmeyen `oyuncular/<id>`. Seçici ikisini
          // de kapsar; bağlantının DOĞRUDAN kanonik adrese gitmesi
          // (yönlendirmeden geçmemesi) `navigate` içinde denetleniyor.
          await navigate(page.locator([
            '.player-card a[href*="player/"]',
            '.player-detail-card a[href*="oyuncular/"]',
            '.player-card a[href*="oyuncular/"]',
            '.player-detail-card a[href*="futbolcu/"]',
            '.player-card a[href*="futbolcu/"]'
          ].join(', ')).first());
        });
        // ERİŞİLEBİLİRLİK GENİŞLİĞE BAĞLI, HEDEFİN SAĞLAMLIĞI DEĞİL.
        //
        // Bu senaryo iki AYRI şey doğruluyor ve ikisinin genişlikle ilişkisi
        // aynı değil:
        //
        //   1. Menü yolu o genişlikte OKUYUCUYA ULAŞIYOR mu — çekmece açılıyor
        //      mu, açılmıyorsa aynı yol altbilgide var mı. Tamamen genişliğe
        //      bağlı; DOKUZ GENİŞLİKTE DE sorulmaya devam ediyor.
        //   2. Yolun ucundaki SAYFA sağlam mı — açılıyor mu, doğru adrese mi
        //      gidiyor, boş mu değil mi. Bu statik HTML her genişliğe BİREBİR
        //      aynı gidiyor; 21 hedefi dokuz kez gezmek aynı baytı dokuz kez
        //      doğruluyordu.
        //
        // ÖLÇÜM (koşu 35525361626, satır zaman damgaları): bu tek senaryo
        // tıklanabilirlik denetiminin 37,3 dakikasının 13,3'ünü yiyordu —
        // genişlik başına 21 tam sayfa yüklemesi, her biri 3,4-6,8 sn. Hedef
        // gezintisi üç temsilî genişliğe indirildikten sonra aynı senaryo
        // 1,7 dakikaya düştü (koşu 35528543454) ve derleme 44,4 → 36,3 dk
        // oldu (koşu 35531368472).
        //
        // Bu, kapıyı AUDIT_WIDTH ile daraltmak DEĞİL: verify-production.mjs o
        // değişkeni bilerek siliyor ve silmeye devam ediyor. Buradaki karar
        // kapının kendi içinde, gerekçesi yazılı.
        const routeSweepWidths = [1440, 768, 390];
        const sweepsRoutes = routeSweepWidths.includes(viewport.width);
        await test(locale + ' primary navigation routes and footer', async () => {
          await open(home);
          const links = await page.locator('.nav-links a').evaluateAll(nodes => nodes.map(a => a.getAttribute('href')));
          // ÇEKMECE TUR BAŞINA DEĞİL, SAYFA BAŞINA AÇILIR. Gezinti yapılan
          // genişlikte her tur YENİ BİR SAYFAYA düşüyor, o yüzden çekmece her
          // turda yeniden açılmak zorunda. Gezinti yapılmayanda sayfa hiç
          // değişmiyor: bir kez açmak yetiyor. Her turda açıp kapatmak, düğmeyi
          // aç/kapa animasyonunun ortasında ölçtürüp "yerine oturmadı"
          // hatası veriyordu (koşu 35528543454) ve hiçbir iddiaya katkısı yoktu.
          if (viewport.width < 1366 && !sweepsRoutes) await click(page.locator('.nav-toggle'));
          for (const href of [...new Set(links)]) {
            if (viewport.width < 1366 && sweepsRoutes) await click(page.locator('.nav-toggle'));
            const target = page.locator('.nav-links a[href=' + JSON.stringify(href) + ']');
            // Secondary navigation is intentionally in the mobile drawer;
            // desktop visitors reach those same routes through the footer.
            const inMenu = await target.isVisible();
            const footer = page.locator('footer a[href=' + JSON.stringify(href) + ']').first();
            if (!inMenu) assert.ok(await footer.count(), 'Hidden menu item has no accessible alternative: ' + href);
            if (!sweepsRoutes) continue;
            await navigate(inMenu ? target : footer);
          }
          for (const suffix of en ? [] : ['hakkinda.html', 'iletisim.html', 'gizlilik.html', 'kullanim-sartlari.html']) {
            const link = page.locator('footer a[href$=' + JSON.stringify(suffix) + ']').first();
            if (!sweepsRoutes) {
              assert.ok(await link.count(), 'Footer link missing: ' + suffix);
              continue;
            }
            await navigate(link);
          }
        });
        await test(locale + ' featured carousel, pause and card', async () => {
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await open(home);
          const root = page.locator('[data-featured-carousel]');
          // KAHRAMAN ALANIN YERLEŞMESİNİ BEKLE, SONRA "YOK" DE.
          //
          // Statik sayfa derleme anının gününe, istemci ise SAYFANIN AÇILDIĞI
          // anın gününe göre çiziyor. Derleme İstanbul gece yarısını
          // geçtiğinde ikisi farklı güne bakıyor: istemci statik kahramanı
          // kendi (maçsız) günüyle değiştiriyor ve o değişimin ortasında
          // sayan bir okuma, karuseli kopmuş bir ağaçta arıyordu. Boyamadan
          // hemen sonra saymak bu yüzden yalancı kırmızı veriyordu.
          await until(
            async () => await root.count() > 0 || await page.locator('#featured-radar-match .featured-fixture').count() > 0,
            'Featured hero never rendered',
            15000
          );
          if (!(await root.count())) {
            // No featurable fixture left (every match of the day has ended and
            // nothing new qualifies yet): the hero deliberately falls back to
            // the "Program kontrol ediliyor" card instead of inventing a
            // fixture -- see staticFeaturedFixture() in
            // scripts/prerender-core-pages.mjs. That state still owes the
            // reader a way out, so its routes are clicked here rather than
            // failing the whole production gate on an honest empty hero.
            const fallback = page.locator('#featured-radar-match .featured-fixture').first();
            assert.ok(await fallback.count(), 'Featured carousel missing and no fallback fixture card either');
            const exits = fallback.locator('.featured-match-actions a');
            assert.ok(await exits.count(), 'Empty featured hero offers no route out');
            await navigate(exits.first());
            return;
          }
          // A promo like the Fenerbahce-Roma match focus hides this legacy
          // widget outright (see match-focus.css: `.match-focus-home
          // #hero-canli-skor{display:none}`) in favour of its own full-width
          // hero. That's a deliberate, CSS-only state visible as soon as the
          // page paints -- there is nothing to click, not a broken carousel.
          if (!(await root.isVisible())) {
            console.log('SKIP', viewport.width, locale + ' featured carousel: hidden by a homepage promo');
            return;
          }
          if (!en) await page.locator('[data-api-target="featured-match"][data-state="ready"]').waitFor();
          const pause = root.locator('[data-featured-pause]');
          if (await pause.count()) {
            // CANLI YENİLEME TIKLAMAYI YUTABİLİR. Karusel her veri
            // yoklamasında yeniden çiziliyor (app.js#setContent: `innerHTML`
            // düğümleri değiştirir, dinleyici de karusel KÖKÜNDE delege).
            // Tıklama o pencereye denk gelirse kopmuş bir ağaca gider,
            // hiçbir yere ulaşmaz ve düğme basılı kalmaz; yeni basılan
            // işaretleme `aria-pressed="false"` ile doğuyor.
            //
            // Tek okumayla iddia etmek bu yüzden ara sıra YALANCI KIRMIZI
            // veriyordu (main koşusu 34937323302: 365 kontrolde tek hata,
            // tek viewport). Aynı testteki komşu iddiaların hepsi zaten
            // `until` ile yeniden deniyor; bu tek satır denemiyordu.
            //
            // SIRA ÖNEMLİ: önce basılmasını BEKLE, ancak basılmadıysa bir
            // kez daha tıkla. Beklemeden yeniden tıklamak, ilk tıklama
            // tutmuşsa düğmeyi geri AÇARDI — yani düzeltme kendisi
            // kırılganlık üretirdi.
            const pressed = async () => await pause.getAttribute('aria-pressed') === 'true';
            const latched = async ms => {
              const end = Date.now() + ms;
              do { if (await pressed()) return true; await delay(100); } while (Date.now() < end);
              return false;
            };
            await click(pause);
            if (!await latched(2000)) {
              await click(pause);
              await until(pressed, 'Pause button did not latch after a re-render swallowed the click');
            }
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
          if (!en) await page.locator('[data-api-target="today-matches"][data-state="ready"]').waitFor({ state: 'attached', timeout: HYDRATE_TIMEOUT });
          // `navigate` geri dönüyor: aşağıdaki kart ana sayfanın "Bugünün
          // Maçları" önizlemesinden geliyor, takım profilinden değil.
          const gun = await page.locator('[data-api-target="today-matches"]').first()
            .getAttribute('data-matches-day').catch(() => null);
          if (!todayFixtureCount(gun)) {
            await navigate(await assertHonestEmptyMatchDay());
            return;
          }
          const firstCard = page.locator('.fixture-card').first();
          const matchId = await firstCard.getAttribute('data-match');
          const card = matchId ? page.locator('.fixture-card[data-match=' + JSON.stringify(matchId) + ']').first() : firstCard;
          const primaryAction = card.locator('.fixture-card-action').first();
          const target = await (await primaryAction.count() ? primaryAction : card.locator('a').first()).getAttribute('href');
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
          // HABER ROTASI DİLE GÖRE AYRI.
          //
          // İngilizce kart eskiden Türkçe `haber/<slug>` sayfasına
          // bağlanıyordu; okuyucu tek tıkla Türkçe metne düşüyordu. Artık
          // İngilizce haberin kendi sayfası var ve kart oraya gidiyor.
          // Denetimin koruduğu şey bu: İngilizce tarafta Türkçe yol KABUL
          // EDİLMEZ — `haber/` içinde `news/` geçmediği için seçici onu
          // zaten dışarıda bırakır, eski davranış geri gelirse burada kırılır.
          //
          // Seçici `en/news/` değil `news/` arar: kart sayfayla aynı dizinden
          // bir alta indiği için href göreli (`news/<slug>.html`), `en/`
          // öneki taşımıyor. Dar desen İngilizce kartı hiç bulamaz ve denetim
          // "No news article route" ile yanlış yere düşerdi.
          const news = page.locator(en
            ? 'main a[href*="news/"]'
            : 'main a[href*="/haber/"], main a[href*="haber/"]').first();
          assert.ok(await news.count(), 'No news article route');
          await navigate(news);
          await open(en ? 'en/columns.html' : 'kose-yazilari.html');
          const column = page.locator(en
            ? 'main a[href*="en/columns/"]'
            : 'main a[href*="kose-yazilari/"]').first();
          assert.ok(await column.count(), 'No column article route');
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
      await test('mobile parity: visible actions and outside menu close', async () => {
        await open('index.html');
        // BEKLENEN ŞEY "YÜKLENDİ", "DOLU" DEĞİL.
        //
        // `waitFor()` varsayılanı `visible` ve boş bir ızgaranın yüksekliği
        // sıfır: maçsız günde bölüm `ready` olmasına rağmen Playwright onu
        // görünmez sayıp 15 saniye bekliyordu. Aynı hedef `navigate()`
        // içinde zaten `attached` ile bekleniyor; burada da öyle.
        await page.locator('[data-api-target="today-matches"][data-state="ready"]').waitFor({ state: 'attached', timeout: HYDRATE_TIMEOUT });
        // Hızlı bağlantılar maç kartının İÇİNDE yaşıyor (app.js#
        // renderHomeFixtureCard). Maçsız günde kart basılmıyor, dolayısıyla
        // aranacak bağlantı da yok; o gün sayfanın borcu kartlar değil,
        // durumu söyleyen dürüst bir kahraman alan ve çalışan bir çıkış.
        const sayfaninGunu = await page.locator('[data-api-target="today-matches"]').first()
          .getAttribute('data-matches-day').catch(() => null);
        const matchDay = todayFixtureCount(sayfaninGunu) > 0;
        if (!matchDay) await navigate(await assertHonestEmptyMatchDay());
        for (const selector of matchDay
          ? ['.news-ticker-all', '.fixture-card-action', '.fixture-card-quicklinks a']
          : ['.news-ticker-all', '.fixture-card-action']) {
          const target = page.locator(selector).first();
          assert.ok(await target.isVisible(), selector + ' hidden');
          if (touch) {
            // Ana sayfa kartları periyodik yenileniyor: isVisible() ile
            // boundingBox() arasında eleman bir an DOM'dan düşerse
            // boundingBox() null döner ve `.height` okuması TypeError ile
            // senaryoyu düşürürdü (günlük tam koşu bu yüzden commit
            // atamadı). Kutu yeniden okunur; 44px eşiği AYNEN korunur.
            let box = null;
            await until(async () => { box = await target.boundingBox(); return box !== null; }, selector + ' has no layout box');
            assert.ok(box.height >= 44, selector + ' small touch target');
          }
          await navigate(target);
        }
        if (viewport.width < 1366) {
          await click(page.locator('.nav-toggle'));
          assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'), 'true');
          await page.touchscreen.tap(viewport.width - 5, viewport.height - 100);
          await until(async () => await page.locator('.nav-toggle').getAttribute('aria-expanded') === 'false', 'Outside tap did not close menu');
        }
      });
      await test('team hubs and broadcast pages retain mobile content', async () => {
        for (const file of ['galatasaray-maclari.html', 'fenerbahce-maclari.html', 'besiktas-maclari.html', 'trabzonspor-maclari.html', 'bugunun-maclari-hangi-kanalda.html']) {
          await open(file);
          const links = page.locator('main a[href]').filter({ visible: true });
          assert.ok(await links.count(), file + ' has no links');
          await navigate(links.first());
        }
      });
      await test('match analysis tabs and restored table columns', async () => {
        const analyses = JSON.parse(fs.readFileSync('data/match-analyses.json', 'utf8'));
        const record = analyses.find(item => item.fixtureId && item.homeContext && item.awayContext && item.prediction);
        assert.ok(record, 'No persisted match analysis to exercise');
        await open('mac-detay.html?id=' + encodeURIComponent(record.fixtureId));
        await page.locator('[data-api-target="match-analysis"]').scrollIntoViewIfNeeded();
        const tabs = page.locator('.match-analysis-tab');
        // SEKMELER AĞDAN GELİYOR, ÇİZİMDEN DEĞİL. mac-detay sayfası analizi
        // /api/match-analysis'ten istiyor; denetim statik sunucuda koştuğu
        // için o uç yok ve istemci 681 KB'lık data/match-analyses.json'a
        // düşüyor. Bu dosyanın indirilip ayrıştırılması, aynı anda birkaç
        // tarayıcı koşarken varsayılan 15 saniyeyi aşabiliyor: senaryo aynı
        // commit'te yedi genişlikte geçip ikisinde bu yüzden düştü. Süre
        // sekmelerin varlığını gevşetmiyor, yalnızca ağ payını tanıyor.
        await tabs.first().waitFor({ timeout: 60000 });
        for (let i = 0; i < await tabs.count(); i++) {
          const tab = tabs.nth(i);
          await click(tab);
          assert.equal(await tab.getAttribute('aria-selected'), 'true');
          assert.ok(await page.locator('#' + await tab.getAttribute('aria-controls')).isVisible());
        }
        await open('momentum.html');
        const cells = page.locator('.table-row.header > *');
        assert.equal(await cells.count(), 6);
        for (let i = 0; i < 6; i++) assert.ok(await cells.nth(i).isVisible(), 'Hidden momentum column ' + i);
      });
      await test('ticker links, logo and menu stacking', async () => {
        await open('index.html');
        // TICKER'IN BİLEŞİMİ VERİYE BAĞLI. Site içine giden bir künye her
        // zaman listede kalmıyor: taze haber akışı tamamen dış kaynaklıysa
        // (ölçüldü: 26 kaydın 26'sı da dış bağlantı) rotasyonda tek bir iç
        // bağlantı bile kalmayabiliyor. Varsa eskisi gibi geziliyor; yoksa
        // dış künyenin kendi sözleşmesi denetleniyor — denetim atlanmıyor.
        const tickerGroup = '.news-ticker-group:not([aria-hidden="true"]) ';
        const icBaglanti = page.locator(tickerGroup + '.news-ticker-item:not([target="_blank"])').first();
        if (await icBaglanti.count()) {
          await navigate(icBaglanti);
        } else {
          const disBaglanti = page.locator(tickerGroup + '.news-ticker-item[target="_blank"]').first();
          await disBaglanti.waitFor({ state: 'attached' });
          assert.match(await disBaglanti.getAttribute('href'), /^https?:\/\//, 'Ticker künyesi geçerli bir adrese gitmiyor');
          assert.match(await disBaglanti.getAttribute('rel') || '', /noopener/, 'Dış ticker künyesinde noopener yok');
          assert.ok((await disBaglanti.getAttribute('aria-label') || '').trim(), 'Ticker künyesinin erişilebilir adı yok');
        }
        await open('haberler.html');
        const logo = page.locator('header .brand').first();
        if (touch) { const box = await logo.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44, 'Logo touch target is too small'); }
        await navigate(logo);
        if (viewport.width < 1366) {
          await click(page.locator('.nav-toggle'));
          const menu = page.locator('.nav-menu');
          await menu.evaluate(e => { e.scrollTop = e.scrollHeight; });
          const last = menu.locator('a').last();
          await last.scrollIntoViewIfNeeded();
          assert.ok(await last.evaluate(e => { const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }), 'Menu item covered by floating content');
          await click(page.locator('.nav-toggle'));
          assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'), 'false');
        }
      });
      if (touch) await test('favourite team selection and full summary labels', async () => {
        await open('index.html');
        const pick = page.locator('.favourite-team__pick').first();
        await pick.waitFor();
        const name = await pick.locator('span').innerText();
        await click(pick);
        await until(async () => (await page.locator('.favourite-team__name').innerText()).includes(name), 'Favourite team selection is inert');
        const change = page.locator('.favourite-team__change');
        assert.ok((await change.boundingBox()).height >= 44);
        await click(change);
        await pick.waitFor();
        for (const selector of ['.favourite-team__pick span', '.now-football__value']) {
          const labels = page.locator(selector);
          for (let i = 0; i < await labels.count(); i++) assert.ok(await labels.nth(i).evaluate(e => e.scrollWidth <= e.clientWidth + 1), selector + ' clips its text');
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      });
      if (touch) await test('mobile summary follows main card and opens match detail', async () => {
        await open('index.html');
        // KARARI ÇİZİM BİTMEDEN VERME.
        //
        // Kahraman alanı istemci basıyor ve ilk çizim veri tamamlanmadan
        // oluyor: Türk maçı kartı ancak bölüm `ready` olduktan sonra doğuyor.
        // Daha erken saymak, maçlarla DOLU bir günde bile kartı "yok"
        // sayıyordu — `main` koşusu 35003804655 takvimde 117 maç varken tam
        // olarak buradan düşüyordu.
        await page.locator('[data-api-target="featured-match"][data-state="ready"]').waitFor();
        const featured = page.locator('[data-featured-turkish="true"]').first();
        const summary = page.locator('.now-football__row').first();
        await summary.waitFor();
        // TÜRK MAÇI KARTI YOKSA ŞERİT DE O SATIRI KURMAZ.
        //
        // Özet satırını site.js#syncSummary yazıyor ve kaynağı tam olarak bu
        // karttır; kart yoksa satır hiç eklenmiyor, şeritte yalnızca "Son
        // gelişme" kalıyor. İddia bu yüzden "kart var" değil, İKİ YÜZEY AYNI
        // ŞEYİ SÖYLÜYOR: kart varsa özet onu yansıtmalı, yoksa olmayan bir
        // maçı uydurmamalı.
        //
        // Dal maç SAYISINA değil kartın kendisine bakıyor, çünkü maçlarla
        // dolu bir günde de öne çıkan maç Türk takımının olmayabilir.
        if (!(await featured.count())) {
          const labels = await page.locator('.now-football__label').allInnerTexts();
          assert.ok(
            !labels.some(label => /Türk takımı maçı|Turkish club match/i.test(label)),
            'Summary invents a Turkish match row while the hero shows none'
          );
          // "Son gelişme" satırı haber kaynağına, yani dış siteye gidebiliyor
          // (site.js#nowRow bu satıra target="_blank" veriyor). Tıklanacak
          // güvenli rota kahraman alanın kendi çıkışı.
          const exit = page.locator('#featured-radar-match a[href]').first();
          assert.ok(await exit.count(), 'Featured hero offers no route out');
          await navigate(exit);
          return;
        }
        await until(async () => await summary.locator('.now-football__label').innerText() === await featured.getAttribute('data-featured-reason-label'), 'Summary mislabels the featured match');
        const score = featured.locator('.featured-fixture-score b');
        const status = featured.locator('.featured-fixture-score span');
        const original = [await score.innerText(), await status.innerText()];
        // Controlled DOM update verifies that the summary observes the same
        // source card; these values are never written to an API or data file.
        try {
          // Canlı skor yenilemesi kartı yeniden çizdiğinde yazdığımız değeri
          // siliyor; tek seferlik yazıp beklemek, gerçek maç oynanırken
          // özetin kartı izleyip izlemediğini değil, yenilemenin araya girip
          // girmediğini ölçüyordu. Değer her turda yeniden yazılıyor —
          // iddia aynı: özet, kartta YAZAN skoru göstermeli.
          await until(async () => {
            await score.evaluate(e => { e.textContent = '2 - 1'; });
            await status.evaluate(e => { e.textContent = "67'"; });
            return (await summary.locator('.now-football__meta').innerText()) === "2 - 1 · 67'";
          }, 'Summary score/minute did not follow the main card', 15000);
        } finally {
          await score.evaluate((e, text) => { e.textContent = text; }, original[0]);
          await status.evaluate((e, text) => { e.textContent = text; }, original[1]);
        }
        await navigate(summary);
      });
      await test('player profile comparison preserves the selected player', async () => {
        await open('oyuncular/mauro-icardi.html');
        const compare = page.locator('.p360-compare-button');
        await click(compare);
        await page.waitForURL(url => url.pathname.endsWith('/oyuncu-karsilastir.html'), { waitUntil: 'domcontentloaded' });
        const first = page.locator('[data-compare-player]').first();
        await until(async () => /Icardi/i.test(await first.locator('option:checked').innerText()), 'Profile comparison lost the selected player', 15000);
        await page.locator('[data-api-target="player-compare"][data-state="ready"]').waitFor();
        await page.goBack({ waitUntil: 'domcontentloaded' });
        const peer = page.locator('.p360-peer').first();
        if (touch) assert.ok((await peer.boundingBox()).height >= 44, 'Player comparison link has a small touch target');
        await navigate(peer);
      });
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
        // PAYLAŞILAN ADRES KANONİK OLMALI — sabit bir yol DEĞİL.
        //
        // Beklenti "/oyuncular/<id>.html" diye sabitti; oyuncu tam isimli
        // adrese taşınınca doğru davranış (kanonik adresi paylaşmak) hatalı
        // sayıldı. Kilitlenen şey: kopyalanan adres, o oyuncunun sayfasının
        // canonical etiketiyle BİREBİR aynı olmalı.
        const sharedPath = new URL(await page.evaluate(() => window.__copiedText)).pathname;
        const profileHref = await page.evaluate((playerId) => {
          const link = document.querySelector('[data-player="' + playerId + '"] a[href*="futbolcu/"], [data-player="' + playerId + '"] a[href*="oyuncular/"]');
          return link ? link.getAttribute('href') : null;
        }, id);
        assert.ok(profileHref, 'Player card has no profile link to compare the share URL against');
        const canonicalPath = new URL(profileHref, page.url()).pathname.replace(/\.html$/, '');
        assert.equal(sharedPath.replace(/\.html$/, ''), canonicalPath);
        await page.evaluate(() => { window.__denyCopy = true; });
        await click(share);
        await page.locator('[data-share-fallback]').waitFor();
        // Yedek kutudaki adres de aynı sayfayı göstermeli; kimliğin kendisi
        // adreste geçmeyebilir (tam isimli slug'da geçmiyor).
        assert.ok((await page.locator('[data-share-fallback] textarea').inputValue()).includes(canonicalPath));
        await page.keyboard.press('Escape');
        await page.locator('[data-share-fallback]').waitFor({ state: 'detached' });
      });
      await context.close();
    }
    const workers = Array.from({ length: Number(process.env.AUDIT_WORKERS || (process.platform === 'win32' ? 1 : 2)) }, (_, i) => i);
    await Promise.all(workers.map(async () => {
      while (queue.length) await runViewport(queue.shift());
    }));
  } finally { await browser.close(); }
  const failed = results.filter(r => !r.passed);
  console.log(`Clickable browser: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length || !results.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { if (server) server.kill(); });
