import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {boundedFetch} from '../../scripts/monitor-operations.mjs';

export const REPO='ugursivrikaya22/futbolradar';
export const START='2026-10-18T17:52:00Z';
export const END='2026-10-19T17:52:00Z';
export const TITLE='[FutbolRadar] 24 saat bulut takibi — 18–19 Ekim 2026';
const MARK='futbolradar-cloud-watch-20261018';
export function readState(body='') {
  const match=body.match(/<!-- futbolradar-cloud-watch-20261018-state (.*?) -->/s);
  if(!match) throw new Error('Watch state missing; refusing to replace history');
  const state=JSON.parse(match[1]);
  if(!Array.isArray(state.samples)||state.start!==START||state.end!==END) throw new Error('Invalid watch state');
  return state;
}
export function nextState(previous,report,now,runUrl,runId) {
  if(previous?.finalized) return previous;
  const state=structuredClone(previous||{start:START,end:END,samples:[],finalized:false});
  const check=name=>report.checks?.find(c=>c.name===name);
  const sample={at:new Date(now).toISOString(),runId,runUrl,issues:[...new Set(report.issues||[])].sort(),warnings:report.warnings||[],
    deployment:check('deployment')?.state||'unknown',supabase:check('supabase-read')?.state||'unknown',
    writer:check('supabase-write')?.state||'unknown',scheduler:check('scheduler')?.state||'unknown',
    lastSuccessRunId:check('scheduler')?.lastSuccessRunId||null};
  // Rerunning the same Actions run must not multiply observations.
  state.samples=state.samples.filter(s=>s.runId!==runId);
  state.samples.push(sample);
  state.finalized=now>=Date.parse(END);
  return state;
}
export function render(state) {
  const latest=state.samples.at(-1);
  const incidents=state.samples.filter(s=>s.issues.length);
  const times=[Date.parse(START),...state.samples.map(s=>Date.parse(s.at))];
  const maxGap=Math.max(0,...times.slice(1).map((t,i)=>t-times[i]));
  return `<!-- ${MARK} -->\n## ${state.finalized?'24 saatlik sonuç':'24 saatlik takip sürüyor'}\n\n`+
    `Dönem: 18 Ekim 20:52 – 19 Ekim 20:52 TSİ. Bilgisayardan bağımsız GitHub Actions.\n\n`+
    `Kontrol sayısı: **${state.samples.length}**. Kritik bulgulu kontrol: **${incidents.length}**. `+
    `En uzun gözlem aralığı: **${Math.round(maxGap/60000)} dakika**. Bu aralıklar kesintisiz çalışma kanıtı değildir.\n\n`+
    (latest?`Son durum: Vercel **${latest.deployment}**, Supabase okuma **${latest.supabase}**, Supabase yazma **${latest.writer}**, zamanlayıcı **${latest.scheduler}**.\n\n`:'')+
    `| UTC | Kritik bulgular | Uyarılar | Kanıt |\n|---|---|---|---|\n`+
    state.samples.map(s=>`| ${s.at} | ${s.issues.join(', ')||'yok'} | ${s.warnings.join(', ')||'yok'} | [Actions](${s.runUrl}) |`).join('\n')+
    `\n\nMevcut saatlik sağlık işi kullanılır; GitHub zamanlaması gecikebilir. Ücretli servis eklenmedi. GitHub genel kesintisinde bu mekanizma da çalışamaz. Bildirim teslimatı GitHub ayarlarına bağlıdır.\n\n`+
    `<!-- ${MARK}-state ${JSON.stringify(state)} -->`;
}
function github(endpoint,method='GET',payload) {
  return JSON.parse(execFileSync('gh',['api',endpoint,'--method',method,...(payload?['--input','-']:[])],{
    input:payload?JSON.stringify(payload):undefined,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,windowsHide:true}));
}
export async function watch({gh=github,fetcher=boundedFetch,root=process.cwd(),now=Date.now(),env=process.env}={}) {
  if(env.GITHUB_REPOSITORY!==REPO||env.GITHUB_REF!=='refs/heads/main') throw new Error('Cloud watch restricted to production main');
  if(now<Date.parse(START)) return {inactive:true};
  const matches=[];
  for(let page=1;page<=5;page++) {
    const issues=gh(`repos/${REPO}/issues?state=all&per_page=100&page=${page}`);
    matches.push(...issues.filter(i=>!i.pull_request&&i.title===TITLE&&i.user?.login==='github-actions[bot]'&&i.body?.includes(`<!-- ${MARK} -->`)));
    if(matches.length||issues.length<100) break;
  }
  let issue=matches[0];
  const previous=issue?readState(issue.body):null;
  if(previous?.finalized) return {finalized:true};
  const file=path.join(root,'outputs/operations/monitor.json');
  const report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{checkedAt:new Date(now).toISOString(),issues:['monitor-report-missing'],checks:[]};
  report.issues ||= []; report.checks ||= [];
  try {
    const health=await (await fetcher('https://www.futbolradar.com/api/health?probe=supabase')).json();
    const ok=health.data?.[0]?.supabaseProbe?.ok===true;
    report.checks.push({name:'supabase-read',state:ok?'ok':'failed'});
    if(!ok) report.issues.push('supabase-read-failed');
  } catch { report.checks.push({name:'supabase-read',state:'unavailable'}); report.issues.push('supabase-read-unavailable'); }
  const ledgerFile=path.join(root,'outputs/operations/update-status.json');
  let writer='unavailable';
  if(fs.existsSync(ledgerFile)) {
    const ledger=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
    writer=ledger.lastUpdate?.steps?.find(s=>s.id==='supabase-sync')?.status||'missing';
  }
  report.checks.push({name:'supabase-write',state:writer});
  if(writer!=='success') report.issues.push('supabase-write-'+writer);
  report.issues=[...new Set(report.issues)];
  report.status=report.issues.length?'attention':report.warnings?.length?'delayed':'ok';
  report.operations={critical:report.issues,warnings:report.warnings||[]};
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  const runUrl=`https://github.com/${REPO}/actions/runs/${env.GITHUB_RUN_ID}`;
  const state=nextState(previous,report,now,runUrl,env.GITHUB_RUN_ID);
  if(!issue) issue=gh(`repos/${REPO}/issues`,'POST',{title:TITLE,body:render({start:START,end:END,samples:[],finalized:false}),assignees:['ugursivrikaya22']});
  // Check comment markers before posting: retry after a partial failure is safe.
  const comments=gh(`repos/${REPO}/issues/${issue.number}/comments?per_page=100`);
  const last=previous?.samples.at(-1);
  const current=state.samples.at(-1);
  const changed=JSON.stringify(last?.issues||[])!==JSON.stringify(current.issues);
  const events=[];
  if(changed) events.push({key:`event-${env.GITHUB_RUN_ID}`,body:`@ugursivrikaya22 ${current.issues.length?'Kritik operasyon hatası: '+current.issues.join(', '):'Önceki kritik bulgular toparlandı.'}\n\n[Kontrol ve günlükler](${runUrl})`});
  if(state.finalized) events.push({key:'final',body:`@ugursivrikaya22 24 saatlik takip tamamlandı.\n\n${render(state).split('<!-- '+MARK+'-state')[0]}\n\nBu özel takip artık yeni kontrol/bildirim üretmeyecek; mevcut genel sağlık işiniz devam eder.`});
  for(const event of events) {
    const marker=`<!-- ${MARK}-${event.key} -->`;
    if(!comments.some(c=>c.user?.login==='github-actions[bot]'&&c.body?.includes(marker))) gh(`repos/${REPO}/issues/${issue.number}/comments`,'POST',{body:`${marker}\n${event.body}`});
  }
  // Persist finalization only after the final notification has been sent.
  gh(`repos/${REPO}/issues/${issue.number}`,'PATCH',{body:render(state)});
  fs.writeFileSync(path.join(root,'outputs/operations/cloud-watch.json'),JSON.stringify(state,null,2)+'\n');
  if(env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY,`\n[24 saat takip ve rapor](${issue.html_url})\n`);
  return {issueUrl:issue.html_url,finalized:state.finalized,issues:report.issues};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const result=await watch(); console.log(JSON.stringify(result));
  if(result.issues?.length) process.exitCode=1;
}
