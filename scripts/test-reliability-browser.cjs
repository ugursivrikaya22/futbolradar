// Isolated browser failures; no provider requests or production writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    page.setDefaultTimeout(20000);
    let failing=true;
    await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"ok":false}'}));
    await page.route(/\/data\/(players|teams|matches|transfers)\.json/,route=>route.fulfill({status:failing?503:200,contentType:'application/json',body:failing?'{}':'[]'}));
    await page.goto((process.env.RELIABILITY_PREVIEW_URL || 'http://127.0.0.1:4188')+'/istatistik-merkezi.html',{waitUntil:'domcontentloaded'});
    const hub=page.locator('[data-api-target="statistics-hub"]');
    await page.waitForFunction(()=>document.querySelector('[data-api-target="statistics-hub"]')?.dataset.state==='error');
    assert.ok((await hub.innerText()).includes('İstatistikler yüklenemedi'));
    assert.ok(!(await hub.innerText()).includes('metrikleri yükleniyor'));
    fs.mkdirSync('outputs/reliability',{recursive:true});
    await page.screenshot({path:'outputs/reliability/statistics-error-mobile.png',fullPage:true});
    failing=false; await hub.getByRole('button',{name:'Yeniden dene'}).click();
    await page.waitForFunction(()=>document.querySelector('[data-api-target="statistics-hub"]')?.dataset.state!=='loading' && !document.querySelector('[data-api-target="statistics-hub"]')?.innerText.includes('İstatistikler yüklenemedi'));
    assert.equal(await hub.getByRole('button',{name:'Yeniden dene'}).count(),0);
    console.log('PASS: actual statistics page failure exits loading and retry recovers; mobile 390px; provider traffic mocked.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
