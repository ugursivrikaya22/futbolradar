const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let calls=0;
const detail={id:'mobile-test',status:'1H',minute:25,score:{home:1,away:0},homeTeam:'Ev',awayTeam:'Konuk',events:[{time:"20'",type:'Goal',team:{name:'Ev'},value:'Golcü'},{time:"21'",type:'Card',detail:'Yellow Card',team:{name:'Konuk'},value:'Oyuncu'},{time:"23'",type:'subst',team:{name:'Ev'},player:{name:'Çıkan'},assist:{name:'Giren'}}],statistics:[{type:'Topla oynama',home:55,away:45},{type:'Toplam şut',home:5,away:2},{type:'Korner',home:3,away:1}],radarPulse:{minute:25,pulse:{home:65,away:35},window:null,momentum:{segments:[{from:1,to:10,value:20},{from:10,to:25,value:-40}],markers:[]},timeline:[]}};
const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(`<html lang="tr"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/page.css"><script src="/match-timeline.js"></script><script src="/radar-pulse.js"></script><script src="/match-center.js" defer></script><main class="container msp" data-match-center data-msp-state="live" data-msp-query="id=1" data-msp-kickoff="${new Date(Date.now()-25*60000).toISOString()}" data-msp-home="Ev" data-msp-away="Konuk"><h1>Ev – Konuk</h1><div data-msp-score></div><span data-msp-minute></span><span data-msp-status></span><section data-msp-events-body></section><section data-msp-stats-body></section><section data-radar-pulse><div data-radar-pulse-body></div></section></main></html>`);}
  if(req.url.startsWith('/api/match-detail')){calls++;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:detail}));}
  const file=path.join(root,req.url);if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');return res.end(fs.readFileSync(file));}res.statusCode=404;res.end();
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await page.clock.fastForward(300);
  await page.locator('[data-msp-score-home]').waitFor();assert.equal(calls,1);
  assert.match(await page.locator('[data-msp-events-body]').innerText(),/Golcü/);assert.match(await page.locator('[data-msp-events-body]').innerText(),/Giren/);
  await page.locator('[data-rp-momentum] svg').waitFor();
  // Same minute, same number of statistics: values must still update.
  detail.statistics[0].home=61;detail.statistics[0].away=39;
  detail.events[0].value='Düzeltilen golcü';
  await page.clock.fastForward(30000);await page.waitForFunction(()=>document.querySelector('[data-msp-stats-body]').textContent.includes('61'));
  assert.equal(calls,2);assert.match(await page.locator('[data-msp-events-body]').innerText(),/Düzeltilen golcü/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  fs.mkdirSync(path.join(root,'outputs/features'),{recursive:true});await page.screenshot({path:path.join(root,'outputs/features/live-match.png'),fullPage:true});
  detail.status='FT';await page.clock.fastForward(30000);await page.waitForFunction(()=>document.querySelector('[data-msp-status]').textContent==='Tamamlandı');const finalCalls=calls;
  await page.clock.fastForward(90000);assert.equal(calls,finalCalls);assert.deepEqual(errors,[]);
  console.log('PASS: 390px timeline, shots/possession/corners, momentum SVG, 30s value updates, stop at FT.');
}finally{server.closeAllConnections();server.close();await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.closeAllConnections();server.close();});
