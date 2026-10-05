import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const app=fs.readFileSync('app.js','utf8').replace('  function bootstrap() {','  window.initDetailForTest = initMatchDetail;\n  function bootstrap() { return;');
const fixture={id:'slow',homeTeam:'Home',awayTeam:'Away',kickoff:'2026-10-05T01:15:00Z',status:'LIVE',providerStatus:'1H',minute:20,score:{home:1,away:0},events:[],statistics:[],lineups:[]};
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try {
 const page=await browser.newPage();
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 let fail=false;
 await page.route('**/*',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p==='/app.js')return route.fulfill({body:app,contentType:'application/javascript; charset=utf-8'});
  if(p==='/api/match-detail'){
   if(fail)return route.abort();
   await new Promise(r=>setTimeout(r,7000));
   return route.fulfill({json:{ok:true,data:[fixture]}});
  }
  if(p==='/data/post-match-reports.json')return; // Optional enrichment never responds.
  if(p.endsWith('.json'))return route.fulfill({json:[]});
  return route.fulfill({contentType:'text/html; charset=utf-8',body:'<section data-api-target="match-detail" data-static-fallback="true">Select a match</section><script src="/app.js"></script>'});
 });
 async function open(){await page.goto('http://detail.test/mac-detay.html?id=slow',{waitUntil:'domcontentloaded'});await page.evaluate(()=>window.initDetailForTest(document.querySelector('[data-api-target="match-detail"]')));}
 await open();
 const target=page.locator('[data-api-target="match-detail"]');
 assert.match(await target.innerText(),/yükleniyor/);
 await page.locator('[data-api-target="match-detail"][data-state="ready"]').waitFor({timeout:12000});
 assert.match(await target.innerText(),/Home/);
 assert.match(await target.innerText(),/1 - 0/);
 fail=true;
 await open();
 await page.locator('[data-retry-action]').waitFor({timeout:10000});
 assert.ok(!(await target.innerText()).includes('Select a match'));
 assert.deepEqual(errors,[]);
 console.log('TR detail loading PASS: 7s live response, stalled optional report, loading state, failed request retry');
}finally{await browser.close();}
