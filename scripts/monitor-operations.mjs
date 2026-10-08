import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import policy from '../services/operationsPolicy.js';
const ORIGIN='https://www.futbolradar.com';
const REPO='ugursivrikaya22/futbolradar';
export async function boundedFetch(url,{fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  for(let attempt=1;attempt<=3;attempt++) {
    try {
      const response=await fetcher(url,{signal:AbortSignal.timeout(15000)});
      if(response.ok) return response;
      if([401,402,403,429].includes(response.status)||response.status<500) throw Object.assign(new Error(`HTTP ${response.status}`),{permanent:true});
      throw new Error(`HTTP ${response.status}`);
    } catch(e) { if(e.permanent||attempt===3) throw e; await sleep(attempt*2000); }
  }
}
function gh(endpoint) { return JSON.parse(execFileSync('gh',['api',endpoint],{encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024})); }
export async function monitor({fetcher=boundedFetch,github=gh,root=process.cwd(),now=Date.now()}={}) {
  const issues=[],checks=[];
  let run=null, deployment=null;
  try {
    const runs=github(`repos/${REPO}/actions/workflows/match-analysis.yml/runs?branch=main&per_page=5`).workflow_runs;
    run=runs[0];
    const state=policy.assessRun(run,now);
    checks.push({name:'scheduler',state,runId:run?.id,trigger:run?.event,createdAt:run?.created_at});
    if(!['ok','running'].includes(state)) issues.push(`scheduler-${state}`);
    const commit=github(`repos/${REPO}/commits/main`);
    const status=github(`repos/${REPO}/commits/${commit.sha}/status`);
    deployment=status.statuses.find(s=>s.context==='Vercel') || null;
    checks.push({name:'deployment',state:deployment?.state||'unknown',commit:commit.sha,url:deployment?.target_url||null});
  } catch { issues.push('github-observation-unavailable'); }
  let liveCalendar=null;
  for(const file of ['fixture-calendar.json','matches.json']) {
    try {
      const expected=JSON.parse(fs.readFileSync(path.join(root,'data',file),'utf8'));
      const live=await (await fetcher(`${ORIGIN}/data/${file}`)).json();
      if(file==='fixture-calendar.json') liveCalendar=live;
      const rows=Array.isArray(live)?live:live.matches;
      if(!Array.isArray(rows)) throw new Error('Invalid data shape');
      const equal=policy.version(expected)===policy.version(live);
      const pending=deployment?.state==='pending' && now-Date.parse(deployment.created_at)<45*60000;
      checks.push({name:file,state:equal?'published':pending?'deployment-pending':'mismatch',version:policy.version(live),records:rows.length,sourceTime:live.fetchedAt||null});
      if(!equal&&!pending) issues.push(`publication-${file}`);
    } catch { issues.push(`unavailable-${file}`); }
  }
  const localCalendar=JSON.parse(fs.readFileSync(path.join(root,'data/fixture-calendar.json'),'utf8'));
  const ledgerPath=path.join(root,'outputs/operations/update-status.json');
  const ledger=JSON.parse(fs.readFileSync(fs.existsSync(ledgerPath)?ledgerPath:path.join(root,'data/update-status.json'),'utf8'));
  const source=ledger.lastUpdate?.sourcesChecked?.find(s=>s.id==='live-fixtures');
  if(source?.status==='failed'||source?.summary?.degraded||policy.STOP_CODES.has(source?.providerCode)) issues.push('provider-'+(source.providerCode||source.summary?.degradedCode||'sync-failed'));
  const publication=ledger.lastUpdate?.publication;
  const observationPublished=!publication||['committed','unchanged'].includes(publication.state);
  checks.push({name:'writer-publication',state:publication?.state||'legacy-published',commit:publication?.commit||null});
  if(publication?.state==='failed') issues.push('writer-publication-failed');
  // Fresh provider data in an artifact is not proof that visitors received it.
  const sourceTime=(observationPublished&&source?.summary?.lastSuccessfulSyncAt) || liveCalendar?.fixtureHealth?.lastSuccessfulSyncAt || liveCalendar?.fetchedAt;
  const age=now-Date.parse(sourceTime);
  checks.push({name:'fixture-freshness',sourceTime,ageMinutes:Number.isFinite(age)?Math.round(age/60000):null,state:age<=90*60000?'fresh':'delayed'});
  if(!Number.isFinite(age)||age>180*60000) issues.push('fixtures-stale');
  const today=policy.istanbulDay(now);
  checks.push({name:'istanbul-day',expected:today,sourceDay:localCalendar.fixtureHealth?.date||null});
  if(localCalendar.fixtureHealth?.date && localCalendar.fixtureHealth.date!==today) issues.push('wrong-fixture-day');
  try {
    // Same canonical cache as visitors/notifications; one bounded read, no
    // match-specific requests, query cache busters or extra provider resource.
    const api=await (await fetcher(ORIGIN+'/api/matches')).json();
    const valid=api.ok===true&&Array.isArray(api.data)&&!api.meta?.degraded&&
      (api.meta?.freshness?.stale===false||api.meta?.fixtureHealth?.state==='empty-confirmed');
    checks.push({name:'runtime-matches-api',state:valid?'fresh':'degraded',records:api.data?.length||0,source:api.source||null,sourceTime:api.updatedAt||null,errorCode:api.error?.code||null});
    if(!valid) issues.push('runtime-api-degraded');
  } catch { issues.push('runtime-api-unavailable'); }
  const registry=JSON.parse(fs.readFileSync(path.join(root,'data/match-seo-pages.json'),'utf8'));
  const entries=Array.isArray(registry)?registry:registry.pages||registry.records||[];
  const recent=entries.find(r=>r.path&&/^(?:\/)?mac\//.test(r.path));
  const routes=['/','/bugunun-maclari.html','/en/todays-matches.html'];
  if(recent) routes.push('/'+recent.path.replace(/^\//,''));
  else { const files=fs.readdirSync(path.join(root,'mac')).filter(f=>f.endsWith('.html')); if(files.length) routes.push('/mac/'+files[0]); }
  for(const route of routes) try {
    const html=await (await fetcher(ORIGIN+route)).text();
    const good=/FutbolRadar/i.test(html)&&/<(?:main|body)\b/i.test(html)&&/canonical/i.test(html)&&!/DEPLOYMENT_PAUSED|Payment Required/i.test(html);
    checks.push({name:route,state:good?'ok':'invalid-page'}); if(!good) issues.push('page-'+route);
  } catch { issues.push('page-'+route); }
  const report={checkedAt:new Date(now).toISOString(),status:issues.length?'attention':checks.some(c=>c.state==='delayed')?'delayed':'ok',issues:[...new Set(issues)],fingerprint:policy.version([...new Set(issues)].sort()),checks,externalMonitor:'not-configured',ownerChannel:'panel-and-actions-summary',limitations:['GitHub-wide outages require an independent external monitor; none is configured.','No billing totals or analytics access; values are unavailable, not zero.']};
  return report;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  let report;
  try { report=await monitor(); } catch { report={checkedAt:new Date().toISOString(),status:'attention',issues:['monitor-internal-error']}; }
  fs.mkdirSync('outputs/operations',{recursive:true});
  fs.writeFileSync('outputs/operations/monitor.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n## Günlük operasyon özeti\n${report.status}\n\n${report.issues.map(x=>'- '+x).join('\n')||'Müdahale gerektiren sorun saptanmadı.'}\n\nBildirim kanalı: panel / Actions özeti. Harici bağımsız izleyici yapılandırılmamış.\n`);
  if(report.issues.length) process.exitCode=1;
}
