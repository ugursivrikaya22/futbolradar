const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
let enabled = true;
const m = id => ({id,homeTeam:'Home '+id,awayTeam:'Away '+id,status:'1H',minute:10,score:{home:0,away:0},events:[],updatedAt:new Date().toISOString()});
let matches = [m('A'),m('B')], hits = [];
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost'); hits.push(url.pathname);
  if (url.pathname === '/qa') {res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(`<html lang="${url.searchParams.get('lang')||'tr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/page.css"><script src="/live-follow.js" defer></script></head><body><header class="topbar-premium"><nav class="nav"><div class="nav-menu"></div></nav></header><main>${['A','B'].map(id=>`<article class="fixture-card" data-match="${id}" data-home-team="Home ${id}" data-away-team="Away ${id}" data-match-href="/mac-detay.html?id=${id}"><h2>Match ${id}</h2></article>`).join('')}</main><div class="cookie-banner" style="position:fixed;bottom:0;height:65px;background:#eee;width:100%">Cookie banner test</div></body></html>`);}
  if (url.pathname.startsWith('/data/')) {res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(url.pathname.endsWith('match-notifications.json')?{enabled}:url.pathname.endsWith('/matches.json')?matches:{matches:[]}));}
  const file = path.join(root, url.pathname.slice(1));
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript'); return res.end(fs.readFileSync(file));}
  res.statusCode=404;res.end();
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port, browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/qa');
    const button=id=>page.locator(`[data-follow-match="${id}"]`);
    await button('A').waitFor(); await page.waitForFunction(()=>!document.querySelector('[data-follow-match]').disabled);
    assert.equal(await button('A').getAttribute('aria-pressed'),'false');
    const poll=async()=>{await page.evaluate(()=>window.FutbolRadarFollow.reconnect()); await page.waitForTimeout(250);};
    await button('A').click(); await page.waitForTimeout(250);
    const goal=(id,n)=>{let x=matches.find(m=>m.id===id);x.score.home=n;x.events.push({id:'goal'+n,type:'Goal',minute:10+n});x.updatedAt=new Date().toISOString();};
    goal('A',1);goal('B',1);await poll();
    assert.equal(await page.locator('[data-toast-match="A"]').count(),1);assert.equal(await page.locator('[data-toast-match="B"]').count(),0);
    assert.equal(await page.locator('.live-event-toast-content').getAttribute('href'),'/mac-detay.html?id=A');
    const box=await page.locator('.live-event-toast').boundingBox();assert.ok(box.y+box.height<844-65);
    fs.mkdirSync(path.join(root,'outputs/match-notifications-qa'),{recursive:true});await page.screenshot({path:path.join(root,'outputs/match-notifications-qa/mobile.png')});
    await page.reload();await page.waitForTimeout(350);assert.equal(await button('A').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.live-event-toast').count(),0);
    await button('B').click();await page.waitForTimeout(250);goal('A',2);goal('B',2);await poll();assert.equal(await page.locator('.live-event-toast').count(),2);
    goal('A',3);await poll();await button('A').click();assert.equal(await page.locator('[data-toast-match="A"]').count(),0);
    await page.locator('.live-event-toast-close').click();assert.equal(await page.locator('[data-toast-match="A"]').count(),0);
    let b=matches[1];b.events[1].detail='Goal cancelled';b.score.home=1;await poll();assert.ok((await page.locator('.live-event-toast').innerText()).includes('GOL İPTALİ'));
    await page.waitForTimeout(7300);assert.equal(await page.locator('.live-event-toast').count(),0);
    await page.goto(origin+'/qa?lang=en');await page.waitForTimeout(350);assert.equal(await button('B').innerText(),'Notifications on');assert.equal(await page.locator('.live-event-toast').count(),0);
    await page.setViewportSize({width:1280,height:900});goal('B',3);await poll();assert.ok((await page.locator('.live-event-toast').innerText()).includes('GOAL'));
    await page.screenshot({path:path.join(root,'outputs/match-notifications-qa/desktop.png')});
    // Existing page stream uses the same engine and never starts a new connection.
    await page.reload(); await page.waitForTimeout(350);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('futbolradar:score-snapshot', {detail:{matches:[{id:'B',homeTeam:'Home B',awayTeam:'Away B',status:'1H',minute:20,score:{home:3,away:0},events:[],fetchedAt:new Date().toISOString()}]}})));
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('futbolradar:score-snapshot', {detail:{matches:[{id:'B',homeTeam:'Home B',awayTeam:'Away B',status:'1H',minute:21,score:{home:4,away:0},events:[{id:'stream-goal',type:'Goal',minute:21}],fetchedAt:new Date().toISOString()}]}})));
    assert.ok((await page.locator('.live-event-toast').innerText()).includes('GOAL'));
    enabled=false;await poll();assert.equal(await page.locator('.live-event-toast').count(),0);assert.equal(await button('A').isDisabled(),true); await button('B').click(); assert.equal(await button('B').getAttribute('aria-pressed'),'false');
    console.log('Checking finished-match expiry, postponed retention and clear-all');
    enabled=true; matches=[{...m('A'),status:'POSTPONED'}, {...m('B'),status:'FT'}];
    await page.evaluate(()=>localStorage.setItem('futbolradar:followed-matches:v1',JSON.stringify([
      {id:'A',homeTeam:'Home A',awayTeam:'Away A',href:'/mac-detay.html?id=A',followedAt:Date.now()-172800000},
      {id:'B',homeTeam:'Home B',awayTeam:'Away B',href:'/mac-detay.html?id=B',finishedAt:Date.now()-172800000}
    ])));
    await page.reload();await page.waitForTimeout(350);
    assert.equal(await button('A').getAttribute('aria-pressed'),'true'); assert.equal(await button('B').getAttribute('aria-pressed'),'false');
    const panelToggle=page.locator('[data-follow-mobile-toggle]'); if(await panelToggle.isVisible()) await panelToggle.click(); else await page.locator('[data-follow-panel-toggle]').click(); await page.locator('.follow-clear').click();
    assert.deepEqual(await page.evaluate(()=>window.FutbolRadarFollow.getState().matchIds),[]);
    assert.ok(!hits.some(p=>p.startsWith('/api/'))); assert.deepEqual(errors,[]);
    console.log('PASS: A/B filtering, independent subscriptions, persisted preference, reload/navigation baseline, queue purge, cancellation, 7s expiry, TR/EN, mobile obstruction, central off; no API requests.');
  } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
