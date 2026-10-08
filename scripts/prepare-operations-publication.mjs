import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const ledger=JSON.parse(fs.readFileSync('outputs/operations/update-status.json','utf8'));
const record=ledger.lastUpdate;
if(record?.status==='failed') throw new Error('Failed update cannot publish');
if(!record?.publication?.required) {
  // Only in the dedicated, freshly checked-out Actions job. Never reset a user's checkout.
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='ugursivrikaya22/futbolradar') throw new Error('Clean-checkout CI guard required');
  const paths=execFileSync('git',['diff','--name-only','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  if(paths.some(p=>!p.startsWith('data/')&&!p.startsWith('public/data/'))) throw new Error('Unexpected source changes in no-op update');
  if(paths.length) execFileSync('git',['restore','--worktree','--',...paths]);
  console.log('No public change: no commit, build or deployment. Observation retained as private artifact.');
}
