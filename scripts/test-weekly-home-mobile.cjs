const {chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {handlePredictionLeague}=require('../server/predictionLeagueRoute');
const root=path.resolve(__dirname,'..'),requests=[];
const rows=[{rank:1,nickname:'Lider',points:15,exact:3,outcome:0,predicted:3},{rank:2,nickname:'<img src=x onerror=alert(1)>',points:4,exact:0,outcome:2,predicted:3}];
const markup=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<section[^>]*data-weekly-predictors[\s\S]*?<\/section>/)[0];
const server=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')){requests.push(req.url);return handlePredictionLeague(req,res,{store:{leaderboard:async()=>rows},nowMs:Date.now()});}
 if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<html lang="tr"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/page.css"><script src="/site.js" defer></script><body><div style="height:1700px">FutbolRadar</div>'+markup+'</body></html>');}
 const file=path.join(root,req.url.split('?')[0]);if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/javascript');return res.end(fs.readFileSync(file));}res.statusCode=404;res.end();
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForTimeout(200);assert.equal(requests.length,0);
 await page.locator('[data-weekly-predictors]').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('[data-predictors-body]').textContent.includes('Lider'));
 assert.equal(requests.length,1);assert.match(requests[0],/view=leaderboard&period=week/);assert.match(await page.locator('[data-weekly-predictors]').innerText(),/Haftanın nişancısı/);assert.equal(await page.locator('[data-predictors-body] img').count(),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));fs.mkdirSync(path.join(root,'outputs/features'),{recursive:true});await page.screenshot({path:path.join(root,'outputs/features/weekly.png')});assert.deepEqual(errors,[]);
 console.log('PASS: 390px weekly rank and badges through real API, deferred single request, no private endpoint and escaped nickname.');
}finally{server.closeAllConnections();server.close();await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.closeAllConnections();server.close();});
