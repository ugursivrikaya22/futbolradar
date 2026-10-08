import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
export function finalize(ledger,{runId,outcome,commit,now=new Date().toISOString()}) {
  const record=ledger.lastUpdate;
  if(!record||String(record.id)!==String(runId)) return {...ledger,lastInvocation:{runId,outcome,finishedAt:now,duplicate:true}};
  const publication={...record.publication,state:outcome==='success'?(record.publication?.required?'committed':'unchanged'):'failed',commit:outcome==='success'?commit:null,finishedAt:now};
  const updated={...record,publication,status:outcome==='success'?record.status:'failed'};
  if(outcome!=='success') updated.errors=[...(record.errors||[]),{step:'publication',message:'Update output was not published; last production version preserved.'}];
  return {...ledger,lastUpdate:updated,lastFull:ledger.lastFull?.id===record.id?updated:ledger.lastFull,lastHourly:ledger.lastHourly?.id===record.id?updated:ledger.lastHourly,history:(ledger.history||[]).map(r=>r.id===record.id?updated:r)};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const file='outputs/operations/update-status.json';
  if(fs.existsSync(file)) {
    const ledger=JSON.parse(fs.readFileSync(file,'utf8'));
    const updated=finalize(ledger,{runId:process.env.GITHUB_RUN_ID,outcome:process.env.PUBLICATION_OUTCOME,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()});
    fs.writeFileSync(file,JSON.stringify(updated,null,2)+'\n');
    if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nPublication: **${updated.lastUpdate?.publication?.state||'unchanged'}**\n`);
  }
}
