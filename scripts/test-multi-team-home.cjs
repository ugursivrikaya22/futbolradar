const {chromium}=require('playwright');
const fs=require('node:fs'), http=require('node:http'), path=require('node:path'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), hits=[];
const teams=[{id:'fenerbahce',name:'Fenerbahçe',isCurrentSuperLigTeam:true},{id:'galatasaray',name:'Galatasaray',isCurrentSuperLigTeam:true}];
const matches=teams.flatMap((team,i)=>[{id:'next'+i,homeTeam:team.name,awayTeam:'Rakip',kickoff:new Date(Date.now()+86400000).toISOString(),status:'SCHEDULED'},{id:'last'+i,homeTeam:team.name,awayTeam:'Rakip',kickoff:new Date(Date.now()-86400000).toISOString(),status:'FT',score:{home:2,away:1}}]);
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');hits.push(url.pathname);
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<html lang="tr"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/page.css"><script src="/favorites-core.js"></script><script src="/site.js" defer></script><body><main class="home-main"><h1>FutbolRadar</h1><section class="container favourite-team" data-favourite-team data-placeholder aria-hidden="true"></section></main></body></html>');}
  let data;
  if(url.pathname==='/api/teams')data={data:teams};
  if(url.pathname==='/api/matches')data={data:matches};
  if(url.pathname==='/api/standings')data={data:teams.map((t,i)=>({team:t.name,rank:i+1,points:30}))};
  if(url.pathname==='/data/slim/news-lite.json')data=teams.map(t=>({team:t.name,title:t.name+' haberi',url:'/haber/test'}));
  if(data){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));}
  const file=path.join(root,url.pathname);if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/javascript');return res.end(fs.readFileSync(file));}res.statusCode=404;res.end();
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('futbolradar:favorites:v1',JSON.stringify({v:1,teams:['fenerbahce','galatasaray'],matches:[]})));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>document.querySelectorAll('.favourite-team__news-link').length===2);
  assert.equal(await page.locator('[data-favorite-id]').count(),2);
  for(const team of teams){const card=page.locator('[data-favorite-id="'+team.id+'"]');assert.match(await card.innerText(),/Sıradaki maç/);assert.match(await card.innerText(),/Son sonuç/);}
  assert.equal(await page.locator('main > :first-child').getAttribute('data-favourite-team'),'');
  assert.equal(hits.filter(p=>p==='/api/matches').length,1);
  assert.equal(hits.filter(p=>p==='/data/slim/news-lite.json').length,1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  fs.mkdirSync(path.join(root,'outputs/features'),{recursive:true});await page.screenshot({path:path.join(root,'outputs/features/favorites.png'),fullPage:true});
  await page.reload();await page.locator('[data-favorite-id="galatasaray"]').waitFor();assert.deepEqual(errors,[]);
  console.log('PASS: two favorite cards first, next/result/news, persisted state, shared requests, 390px.');
}finally{server.closeAllConnections();server.close();await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.closeAllConnections();server.close();});
