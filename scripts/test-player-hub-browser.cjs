const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:4189';
const profiles = (process.env.AUDIT_PLAYERS || 'victor-osimhen,mason-greenwood,dusan-vlahovic,paul-onuachu,edin-dzeko,sebastian-szymanski').split(',');
const files = profiles.map(slug=>'futbolcu/'+slug+'.html').filter(file=>fs.existsSync(file));
const report=[];
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try {
  for(const width of (process.env.AUDIT_WIDTH ? process.env.AUDIT_WIDTH.split(',').map(Number) : [320,360,375,390,414,430,768,1440])) {
   const context=await browser.newContext({viewport:{width,height:900},isMobile:width<800,hasTouch:width<800,serviceWorkers:'block',reducedMotion:'reduce'});
   const page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(45000);
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const tap=async locator=>{await locator.scrollIntoViewIfNeeded();if(width<800)await locator.tap();else await locator.click();};
   for(const file of files) {
    try {
     const response=await page.goto(base+'/'+file,{waitUntil:'domcontentloaded',timeout:45000});assert.ok(response.ok());
     await page.locator('[data-p360-section="quick"]').waitFor();
     assert.equal(await page.locator('main h1').count(),1);
     assert.ok((await page.title()).includes('2026/27'));
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Page overflow');
     const quick=await page.locator('[data-p360-section="quick"]').boundingBox();assert.ok(quick.y<900,'Quick facts below first screen');
     const hrefs=await page.locator('[data-p360-section="links"] a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
     for(const href of (width===320||width===1440 ? hrefs : hrefs.slice(0,1))) {
      const target=page.locator('[data-p360-section="links"] a[href='+JSON.stringify(href)+']').first();
      const dest=new URL(href,page.url());
      await Promise.all([page.waitForURL(url=>url.pathname.replace(/\.html$/,'')===dest.pathname.replace(/\.html$/,''),{timeout:30000}),tap(target)]);
      await page.locator('main h1').first().waitFor();
      assert.ok(!/404|sayfa bulunamadı/i.test(await page.locator('main h1').first().innerText()));
      await page.goto(base+'/'+file,{waitUntil:'domcontentloaded'});
     }
     assert.deepEqual(errors,[]);report.push({width,file,passed:true,links:width===320||width===1440?hrefs.length:Math.min(hrefs.length,1)});
     console.log('PASS',width,file);
    }catch(e){report.push({width,file,passed:false,error:e.message});console.log('FAIL',width,file,e.message.slice(0,180));}
   }
   if(width===390)await page.screenshot({path:'outputs/player-hub/mobile-390.png',fullPage:false});
   await context.close();
  }
 }finally{await browser.close();fs.mkdirSync('outputs/player-hub',{recursive:true});fs.writeFileSync(process.env.AUDIT_REPORT || 'outputs/player-hub/browser.json',JSON.stringify(report,null,2));}
 if(report.some(row=>!row.passed))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
