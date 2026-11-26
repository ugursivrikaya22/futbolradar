const {chromium}=require('playwright');const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const side={team:'Ev',formation:'4-2-3-1',probable:true,startingDetails:Array.from({length:11},(_,i)=>({name:'Oyuncu '+(i+1),number:i+1}))};
const detail={status:'NS',lineups:[side],score:{home:null,away:null}};
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(`<html lang="tr"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/page.css"><script src="/match-center.js" defer></script><main class="container msp" data-match-center data-msp-state="pre" data-msp-query="id=1" data-msp-kickoff="${new Date(Date.now()+30*60000).toISOString()}" data-msp-home="Ev" data-msp-away="Konuk"><h1>Ev – Konuk</h1></main></html>`);}
 if(req.url.startsWith('/api/match-detail')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:detail}));}
 const file=path.join(root,req.url);if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');return res.end(fs.readFileSync(file));}res.statusCode=404;res.end();
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});try{
 const page=await browser.newPage({viewport:{width:360,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await page.clock.fastForward(300);
 await page.locator('.msp-pitch').waitFor();assert.equal(await page.locator('.msp-pitch-player').count(),11);assert.match(await page.locator('[data-msp-lineups]').innerText(),/Muhtemel 11/);
 side.probable=false;await page.clock.fastForward(120000);await page.waitForFunction(()=>document.querySelector('.is-official'));
 assert.equal(await page.locator('.is-probable').count(),0);assert.match(await page.locator('[data-msp-lineups]').innerText(),/Açıklanan ilk 11/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));fs.mkdirSync(path.join(root,'outputs/features'),{recursive:true});await page.screenshot({path:path.join(root,'outputs/features/lineup.png'),fullPage:true});assert.deepEqual(errors,[]);
 const api=require('../lineup-live');assert.equal(api.rows({...side,formation:'4-4-4'}).length,0);assert.ok(!api.card({...side,team:'<script>x</script>'},false).includes('<script>'));
 console.log('PASS: 360px probable → official XI without reload, 11 players, formation validation and escaping.');
}finally{server.closeAllConnections();server.close();await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.closeAllConnections();server.close();});
