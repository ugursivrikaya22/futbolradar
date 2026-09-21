const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : process.platform === 'win32' ? {channel:'msedge'} : {})});
 const context = await browser.newContext({viewport:{width:1440,height:900}, hasTouch:true, reducedMotion:'reduce', serviceWorkers:'block'});
 const page=await context.newPage();
 const files=['index.html','bugunun-maclari.html','canli-skor.html','puan-durumu.html','gol-kralligi.html','asist-kralligi.html','transfer-izleme.html','takimlar.html','oyuncu-radari.html','haberler.html','kose-yazilari.html','analizler.html','bugunun-maclari-hangi-kanalda.html','lig/super-lig.html','galatasaray-maclari.html','fenerbahce-maclari.html','besiktas-maclari.html','trabzonspor-maclari.html','momentum.html','mac-takvimi.html','oyuncular/mauro-icardi.html','haber/genclerbirligi-metin-diyadin-51f772ab.html','kose-yazilari/fenerbahce-roma-1-1-yarim-kalan-sampiyonlar-ligi-gecesi.html','mac/galatasaray-kocaelispor-13-eylul-2026.html','mac-detay.html?id=samsunspor-goztepe-2026-08-17','istatistik-merkezi.html','super-lig-fikstur.html','anketler.html'];
 const report=[];
 const snapshot=()=>page.evaluate(()=>{
  const visible=e=>!!(e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
  const items=[...document.querySelectorAll('main a[href], main button, main select, .news-ticker-all, footer a[href]')].filter(visible).map(e=>({key:[e.tagName,e.getAttribute('href')||e.getAttribute('aria-controls')||e.getAttribute('name')||'',e.textContent.trim()].join('|'),selector:e.className}));
  return {items,overflow:document.documentElement.scrollWidth>innerWidth+1,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};
 });
 try {
  for (const file of files.filter(file => !process.env.AUDIT_PAGES || process.env.AUDIT_PAGES.split(',').includes(file))) {
   await page.setViewportSize({width:1440,height:900});
   const response=await page.goto(new URL(file, (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:4187') + '/').href,{waitUntil:'domcontentloaded'});
   await page.locator('main').waitFor();
   await page.waitForTimeout(1500);
   const desktop=await snapshot();
   for(const width of [320,360,375,390,414,430,768]) {
    await page.setViewportSize({width,height:900});await page.waitForTimeout(100);
    const mobile=await snapshot();const keys=new Set(mobile.items.map(x=>x.key));
    const missing=desktop.items.filter(x=>!keys.has(x.key));
    report.push({file,width,status:response.status(),overflow:mobile.overflow,scrollWidth:mobile.scrollWidth,missing});
    if(mobile.overflow||missing.length)console.log(JSON.stringify(report.at(-1)));
   }
   console.log('CHECKED',file);
  }
 } finally {await browser.close();fs.mkdirSync('outputs/mobile-parity',{recursive:true});fs.writeFileSync(process.env.AUDIT_REPORT || 'outputs/mobile-parity/layout.json',JSON.stringify(report,null,2));}
 if(report.some(x=>x.overflow || x.missing.length || x.status >= 400)) process.exitCode=1;
 console.log('Layout checks',report.length,'overflow',report.filter(x=>x.overflow).length,'differences',report.filter(x=>x.missing.length).length);
})().catch(e=>{console.error(e);process.exitCode=1});
