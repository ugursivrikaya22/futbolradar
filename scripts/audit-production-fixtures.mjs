import fs from 'node:fs';
const origin = process.env.SITE_URL || 'https://www.futbolradar.com';
const date = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const report = { checkedAt:new Date().toISOString(), origin, date, pages:[], links:[], apis:[] };
const paths = ['/', '/en/index.html', '/bugunun-maclari.html', '/en/todays-matches.html', '/canli-skor.html', '/en/live-football-scores.html', '/en/matches', '/super-lig-puan-durumu', '/robots.txt', '/sitemap.xml'];
const links = new Set();
async function request(url, method='GET') {
  const start=Date.now();
  try { const r=await fetch(url,{method,signal:AbortSignal.timeout(20000)}); return {status:r.status,url:r.url,ms:Date.now()-start,cache:r.headers.get('x-vercel-cache'),body:method==='GET'?await r.text():''}; }
  catch(e){return {status:0,url,ms:Date.now()-start,error:e.message,body:''};}
}
for(const path of paths) {
 const r=await request(origin+path); const html=r.body;
 const attr=(re)=>html.match(re)?.[1] || null;
 report.pages.push({path,status:r.status,finalUrl:r.url,ms:r.ms,cache:r.cache,title:attr(/<title>([^<]*)<\/title>/i),canonical:attr(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i),noindex:/<meta[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(html),error:r.error});
 if(path==='/'||path==='/en/index.html') for(const m of html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)){
  try{ const u=new URL(m[1].replaceAll('&amp;','&'),r.url); if(u.origin===origin){u.hash='';links.add(u.href);} }catch{}
 }
}
const queue=[...links];
await Promise.all(Array.from({length:4},async()=>{while(queue.length){const url=queue.shift();const r=await request(url,'HEAD');report.links.push({url,status:r.status,finalUrl:r.url,error:r.error});}}));
for(const path of ['/api/health?probe=supabase',`/api/matches?date=${date}`,`/api/matches?date=${date}&locale=en`,'/api/matches?live=1','/api/standings?league=super-lig']){
 const r=await request(origin+path); let b;try{b=JSON.parse(r.body);}catch{}
 const health=path.includes('health')?b?.data?.[0]:null;
 report.apis.push({path,status:r.status,ms:r.ms,ok:b?.ok,count:b?.data?.length,meta:b?.meta,error:b?.error,deployment:health?.deployment,supabaseProbe:health?.supabaseProbe,apiFootball:health?{configured:health.apiFootball?.configured,credentialPresent:health.apiFootball?.credentialPresent}:undefined,matches:!health&&path.includes('/matches')?b?.data?.map(m=>({id:m.id,home:m.homeTeam,away:m.awayTeam,kickoff:m.kickoff,status:m.status,score:m.score,league:m.league})):undefined});
}
fs.writeFileSync('production-audit.log',JSON.stringify(report,null,2));
console.log(JSON.stringify({date,pages:report.pages,linksChecked:report.links.length,brokenLinks:report.links.filter(r=>r.status>=400||!r.status),apis:report.apis.map(({matches,...r})=>r)},null,2));
if(report.pages.some(r=>r.status>=400||!r.status)||report.links.some(r=>r.status>=400||!r.status)||report.apis.some(r=>r.status>=400||!r.ok))process.exitCode=1;
