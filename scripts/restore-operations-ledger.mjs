// Read only the latest private Actions artifact, not production content.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const repo='ugursivrikaya22/futbolradar';
fs.mkdirSync('outputs/operations',{recursive:true});
try {
  const data=JSON.parse(execFileSync('gh',['api',`repos/${repo}/actions/artifacts?name=operations-ledger&per_page=10`],{encoding:'utf8'}));
  const artifact=data.artifacts.find(a=>!a.expired&&a.workflow_run?.head_branch==='main');
  if(artifact) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fr-ops-'));
    const zip=path.join(dir,'ledger.zip');
    fs.writeFileSync(zip,execFileSync('gh',['api',`repos/${repo}/actions/artifacts/${artifact.id}/zip`],{maxBuffer:20*1024*1024}));
    execFileSync('unzip',['-q',zip,'-d',dir]);
    for(const file of ['update-status.json','monitor.json']) if(fs.existsSync(path.join(dir,file))) {
      JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
      fs.copyFileSync(path.join(dir,file),path.join('outputs/operations',file));
    }
    console.log('Previous operational ledger restored.');
  } else console.log('No prior operational artifact; using published ledger.');
} catch(error) {
  console.warn('Operational artifact unavailable; published ledger will be used.');
}
