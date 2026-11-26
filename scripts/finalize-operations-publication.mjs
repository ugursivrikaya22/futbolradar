import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
const policy=createRequire(import.meta.url)('../services/operationsPolicy.js');
export function finalize(ledger,{runId,outcome,commit,now=new Date().toISOString()}) {
  const record=ledger.lastUpdate;
  if(!record||String(record.id)!==String(runId)) return {...ledger,lastInvocation:{runId,outcome,finishedAt:now,duplicate:true}};
  const publication={...record.publication,state:outcome==='success'?(record.publication?.required?'committed':'unchanged'):'failed',commit:outcome==='success'?commit:null,finishedAt:now};
  const updated={...record,publication,status:outcome==='success'?record.status:'failed'};
  if(outcome!=='success') updated.errors=[...(record.errors||[]),{step:'publication',message:'Update output was not published; last production version preserved.'}];
  updated.completion=policy.assessCompletion(updated);
  // lastVerifiedFull moves only after the real publication outcome is known:
  // a failed push or a critical-step failure can never count as "today's job done".
  const lastVerifiedFull=updated.type==='full'&&updated.completion.verified?updated:ledger.lastVerifiedFull===undefined?undefined:ledger.lastVerifiedFull?.id===record.id?null:ledger.lastVerifiedFull;
  const result={...ledger,lastUpdate:updated,lastFull:ledger.lastFull?.id===record.id?updated:ledger.lastFull,lastHourly:ledger.lastHourly?.id===record.id?updated:ledger.lastHourly,history:(ledger.history||[]).map(r=>r.id===record.id?updated:r)};
  if(lastVerifiedFull!==undefined) result.lastVerifiedFull=lastVerifiedFull;
  return result;
}
export async function settleFullLock(ledger, {key, startedAt, runId, outcome, now=new Date().toISOString(), store=createRequire(import.meta.url)('../services/cron/runStore.js')}) {
  if(!key && !startedAt) return;
  if(!/^full:\d{4}-\d{2}-\d{2}$/.test(key||'') || !startedAt) throw new Error('Incomplete full cron lock ownership');
  const record=ledger?.lastUpdate;
  const verified=outcome==='success' && String(record?.id)===String(runId) && record?.dedupeKey===key
    && Boolean(record.publication) && policy.assessCompletion(record).verified;
  const updated=await store.updateOwnedRun({
    key,runner:'github-actions',startedAt,patch:{status:verified?'complete':'failed',finished_at:now}
  });
  if(!updated) throw new Error('Could not finalize the owned full cron lock');
  if(!verified && outcome==='success') throw new Error('Full cron fallback had no verified completion');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const file='outputs/operations/update-status.json';
  let updated;
  if(fs.existsSync(file)) {
    const ledger=JSON.parse(fs.readFileSync(file,'utf8'));
    updated=finalize(ledger,{runId:process.env.GITHUB_RUN_ID,outcome:process.env.PUBLICATION_OUTCOME,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()});
    fs.writeFileSync(file,JSON.stringify(updated,null,2)+'\n');
    if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nPublication: **${updated.lastUpdate?.publication?.state||'unchanged'}**\n`);
  }
  await settleFullLock(updated,{
    key:process.env.FULL_LOCK_KEY,startedAt:process.env.FULL_LOCK_STARTED_AT,
    runId:process.env.GITHUB_RUN_ID,outcome:process.env.PUBLICATION_OUTCOME
  });
}
