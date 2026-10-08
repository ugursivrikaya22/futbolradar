import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import policy from '../services/operationsPolicy.js';
import news from '../services/automatedNewsPolicy.js';
import {captureData,retainUnchangedData} from '../scripts/lib/operationalData.mjs';
import {boundedFetch,monitor} from '../scripts/monitor-operations.mjs';
import {validateFixtures} from '../scripts/validate-operations-output.mjs';
import {finalize} from '../scripts/finalize-operations-publication.mjs';
import {synchronizeLiveFixtures} from '../scripts/sync-live-fixtures.mjs';
const now=Date.parse('2026-10-08T01:00:00Z');
function sandbox(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fr-operations-test-'));for(const p of ['data','public/data','outputs/operations','mac'])fs.mkdirSync(path.join(dir,p),{recursive:true});return dir;}
function write(dir,file,value){fs.writeFileSync(path.join(dir,file),JSON.stringify(value));}
test('Istanbul midnight and cost prioritisation preserve core fixtures',()=>{
  assert.equal(policy.istanbulDay('2026-10-07T21:01:00Z'),'2026-10-08');
  assert.equal(policy.modeFor({rateLimit:{limit:100,remaining:10,observedAt:new Date(now).toISOString()},now}),'saving');
  assert.equal(policy.skipReason({id:'live-fixtures',source:'api-football'},'saving'),null);
  assert.match(policy.skipReason({id:'weekly-photo-validation'},'saving'),/deferred/);
  for(const code of policy.STOP_CODES){assert.equal(policy.modeFor({code}),'protected');assert.match(policy.skipReason({source:'api-football'},'protected',code),/stopped/);}
});
test('runtime protected mode never reaches the paid provider',async()=>{
  const require=createRequire(import.meta.url),config=require('../data/operations-policy.json'),provider=require('../services/providers/apiFootballProvider');
  const previous=config.mode,oldFetch=global.fetch;let calls=0;
  config.mode='protected';global.fetch=async()=>{calls++;throw Error('Network must not run');};
  try {await assert.rejects(()=>provider.getFixtures({live:true}),e=>e.code==='PROVIDER_RATE_LIMIT');assert.equal(calls,0);}
  finally {config.mode=previous;global.fetch=oldFetch;}
});
test('timestamps alone keep original public bytes; score/date/event changes count',()=>{
  const dir=sandbox(),old={fetchedAt:'2026-10-07',matches:[{id:'A',kickoff:'2026-10-08T20:00:00Z',score:{home:null,away:null},events:[]}]};
  write(dir,'data/fixture-calendar.json',old);write(dir,'public/data/fixture-calendar.json',old);
  const before=captureData(dir);write(dir,'data/fixture-calendar.json',{...old,fetchedAt:'2026-10-08'});
  const result=retainUnchangedData(before,dir);
  assert.deepEqual(result.changed,[]);assert.equal(result.observations['fixture-calendar.json'].fetchedAt,'2026-10-08');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'data/fixture-calendar.json'))),old);
  write(dir,'data/fixture-calendar.json',{...old,matches:[{...old.matches[0],score:{home:1,away:0}}]});
  assert.deepEqual(retainUnchangedData(before,dir).changed,['fixture-calendar.json']);
  assert.notEqual(policy.version(old),policy.version({...old,matches:[{...old.matches[0],kickoff:'2026-10-09T20:00:00Z'}]}));
});
test('unchanged CI run creates no commit or deployment-triggering tracked diff',()=>{
  const dir=sandbox();execFileSync('git',['init','-q'],{cwd:dir});
  write(dir,'data/fixture-calendar.json',{matches:[]});execFileSync('git',['add','data'],{cwd:dir});
  execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','baseline'],{cwd:dir});
  write(dir,'outputs/operations/update-status.json',{lastUpdate:{status:'success',publication:{required:false}}});
  write(dir,'data/fixture-calendar.json',{matches:[],fetchedAt:'new observation'});
  execFileSync(process.execPath,[path.resolve('scripts/prepare-operations-publication.mjs')],{cwd:dir,env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'ugursivrikaya22/futbolradar'}});
  assert.equal(execFileSync('git',['diff','--name-only'],{cwd:dir,encoding:'utf8'}),'');
  assert.equal(execFileSync('git',['rev-list','--count','HEAD'],{cwd:dir,encoding:'utf8'}).trim(),'1');
  assert(fs.existsSync(path.join(dir,'outputs/operations/update-status.json')));
});
test('permanent HTTP errors do not retry; transient errors stop at three attempts',async()=>{
  for(const status of [401,402,403,429]){let calls=0;await assert.rejects(()=>boundedFetch('test',{fetcher:async()=>{calls++;return {ok:false,status};},sleep:async()=>{}}));assert.equal(calls,1);}
  let calls=0,waits=[];await assert.rejects(()=>boundedFetch('test',{fetcher:async()=>{calls++;throw Error('network');},sleep:async ms=>waits.push(ms)}));assert.equal(calls,3);assert.deepEqual(waits,[2000,4000]);
});
test('missing, stuck, failed and healthy scheduled runs are distinct',()=>{
  assert.equal(policy.assessRun(null,now),'missing');
  assert.equal(policy.assessRun({status:'in_progress',created_at:new Date(now-100*60000).toISOString()},now),'stuck');
  assert.equal(policy.assessRun({status:'completed',conclusion:'success',created_at:new Date(now-4*3600000).toISOString()},now),'missed');
  assert.equal(policy.assessRun({status:'completed',conclusion:'failure',created_at:new Date(now).toISOString()},now),'failed');
});
test('a successful fetch cannot conceal a failed publication or block retry',()=>{
  const record={id:'1',status:'success',publication:{required:true,state:'awaiting-deployment'}};
  const ledger={lastUpdate:record,lastHourly:record,history:[record]};
  const failed=finalize(ledger,{runId:'1',outcome:'failure',commit:'abc'});
  assert.equal(failed.lastUpdate.status,'failed');assert.equal(failed.history[0].publication.state,'failed');assert.equal(failed.lastHourly.publication.commit,null);
  const good=finalize(ledger,{runId:'1',outcome:'success',commit:'abc'});
  assert.equal(good.lastUpdate.publication.state,'committed');assert.equal(good.lastUpdate.publication.commit,'abc');
});
test('critical invalid records are blocked; unknown score remains null',()=>{
  const row={id:'A',homeTeam:'A',awayTeam:'B',score:{home:null,away:null}};
  assert.equal(validateFixtures([row]),1);assert.throws(()=>validateFixtures([row,row]));assert.throws(()=>validateFixtures([{...row,score:{home:-1,away:0}}]));
});
test('sensitive claims are skipped without changing manual archives',()=>{
  assert.equal(news.allowAutomatedNews('Fenerbahçe transfer iddiası',false),false);
  assert.equal(news.allowAutomatedNews('Player injury announcement',false),false);
  assert.equal(news.allowAutomatedNews('Player injury announcement',true),true);
  assert.equal(news.allowAutomatedNews('Galatasaray maçını kazandı',false),true);
});
test('publication monitoring detects semantic mismatch even when every URL returns 200',async()=>{
  const dir=sandbox();const calendar={fetchedAt:new Date(now).toISOString(),fixtureHealth:{date:'2026-10-08',lastSuccessfulSyncAt:new Date(now).toISOString()},matches:[]};
  write(dir,'data/fixture-calendar.json',calendar);write(dir,'data/matches.json',[]);write(dir,'data/update-status.json',{});write(dir,'data/match-seo-pages.json',{pages:[{path:'mac/example.html'}]});
  const github=url=>url.includes('/runs?')?{workflow_runs:[{id:1,status:'completed',conclusion:'success',event:'schedule',created_at:new Date(now).toISOString()}]}:url.endsWith('/status')?{statuses:[{context:'Vercel',state:'success'}]}:{sha:'a'.repeat(40)};
  const fetcher=async url=>({json:async()=>url.includes('fixture-calendar')?{...calendar,matches:[{id:'incorrect'}]}:[],text:async()=>'<html><link rel="canonical"><body>FutbolRadar</body></html>'});
  const report=await monitor({root:dir,now,github,fetcher});assert(report.issues.includes('publication-fixture-calendar.json'));assert(report.issues.includes('full-update-overdue'));assert(report.checks.find(c=>c.name==='/en/todays-matches.html').state==='ok');
});
test('production configuration has one writer schedule; disabled news stays disabled',()=>{
  assert(!/\n  schedule:/.test(fs.readFileSync('.github/workflows/broadcast-schedule.yml','utf8')));
  assert(!/\n  schedule:/.test(fs.readFileSync('.github/workflows/trabzonspor-post-match-column.yml','utf8')));
  assert(!/\n  schedule:/.test(fs.readFileSync('.github/workflows/sporx-news-discovery.yml','utf8')));
  const monitor=fs.readFileSync('.github/workflows/daily-health-check.yml','utf8');assert.match(monitor,/contents: read/);assert.doesNotMatch(monitor,/ci-commit-push|npm ci|playwright|--apply/);
});
