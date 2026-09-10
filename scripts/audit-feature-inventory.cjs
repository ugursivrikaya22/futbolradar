// Read-only browser inventory. Presence is not counted as a successful click;
// behavioral results are recorded by test-clickable-browser.cjs separately.
const fs = require('node:fs');
const { chromium } = require('playwright');
const { ROUTES, dynamicRoutePairs } = require('../services/i18n.js');
const base = process.env.AUDIT_BASE_URL || 'https://www.futbolradar.com';
const report = process.env.AUDIT_REPORT || 'outputs/e2e/inventory.json';
const pages = [...new Set(ROUTES.flatMap(route => [route.tr, route.en]))];
for (const kind of ['team/', 'player/', 'match/']) {
  const pair = dynamicRoutePairs().find(pair => pair.en.includes(kind));
  if (pair) pages.push(pair.tr, pair.en);
}
pages.push('bugunun-maclari-hangi-kanalda.html', 'takim-detay.html?team=__audit_missing_team__');
(async () => {
  fs.mkdirSync(require('node:path').dirname(report), { recursive:true });
  const browser = await chromium.launch({ headless:true, ...(process.platform === 'win32' ? {channel:'msedge'} : {}) });
  const results = [];
  try {
    for (const width of [1440, 360]) {
      const context = await browser.newContext({ viewport:{width,height:width===360?800:900}, hasTouch:width===360, serviceWorkers:'block' });
      for (const file of pages) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          const response = await page.goto(new URL(file, base).href, {waitUntil:'domcontentloaded',timeout:30000});
          await page.locator('main').waitFor();
          await page.waitForFunction(() => !document.querySelector('main [data-state="loading"]'), null, {timeout:20000}).catch(()=>{});
          const observed = await page.evaluate(() => ({
            title:document.querySelector('h1')?.textContent.trim(),
            content:document.querySelector('main')?.innerText.slice(0,16000),
            states:[...document.querySelectorAll('main [data-state]')].map(node=>({component:node.dataset.apiTarget||node.id,state:node.dataset.state})),
            controls:[...document.querySelectorAll('a,button,input,select,[role="tab"],[role="button"]')].map(node=>{
              const style=getComputedStyle(node), box=node.getBoundingClientRect();
              return {tag:node.tagName,role:node.getAttribute('role'),label:(node.getAttribute('aria-label')||node.innerText||node.getAttribute('placeholder')||'').trim().slice(0,160),href:node.getAttribute('href'),expected:node.tagName==='A'?'navigate to href':'perform labelled action',observed:'inventory only; see behavioral test report',disabled:node.disabled||node.getAttribute('aria-disabled')==='true',visible:!!(box.width&&box.height)&&style.visibility!=='hidden',cursor:style.cursor,pointerEvents:style.pointerEvents};
            })
          }));
          results.push({file,width,status:response.status(),...observed,errors});
          console.log('INVENTORY',width,file,response.status(),observed.controls.length);
        } catch(error) {results.push({file,width,error:error.message,errors});console.log('ERROR',width,file,error.message);}
        await page.close();
        fs.writeFileSync(report,JSON.stringify({checkedAt:new Date().toISOString(),base,results},null,2));
      }
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
