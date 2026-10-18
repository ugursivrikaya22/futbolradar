import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {watch,nextState,readState,render,START,END,REPO} from '../scripts/cloud-watch.mjs';

test('window ends at deadline and reruns replace observations',()=>{
  let state=nextState(null,{issues:[]},Date.parse(START),'url','1');
  state=nextState(state,{issues:['failure']},Date.parse(START)+1000,'url','1');
  assert.equal(state.samples.length,1);
  assert.equal(state.finalized,false);
  state=nextState(state,{issues:[]},Date.parse(END),'url','2');
  assert.equal(state.finalized,true);
  assert.deepEqual(readState(render(state)),state);
  assert.equal(nextState(state,{issues:['later']},Date.parse(END)+1000,'url','3'),state);
  assert.throws(()=>readState('invalid'));
});

function harness(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fr-cloud-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'outputs/operations'),{recursive:true});
  const write=(name,data)=>fs.writeFileSync(path.join(root,'outputs/operations',name),JSON.stringify(data));
  write('update-status.json',{lastUpdate:{steps:[{id:'supabase-sync',status:'success'}]}});
  let issue=null; const comments=[]; let failPatch=false;
  const gh=(endpoint,method='GET',payload)=>{
    if(method==='GET'&&endpoint.includes('/issues?')) return issue?[structuredClone(issue)]:[];
    if(method==='GET'&&endpoint.includes('/comments')) return structuredClone(comments);
    if(method==='POST'&&endpoint.endsWith('/issues')) { issue={...payload,number:1,html_url:'https://example.test/issue/1',user:{login:'github-actions[bot]'}}; return structuredClone(issue); }
    if(method==='POST'&&endpoint.endsWith('/comments')) {comments.push({...payload,user:{login:'github-actions[bot]'}}); return {};}
    if(method==='PATCH') {if(failPatch) {failPatch=false;throw new Error('network');} Object.assign(issue,payload);return structuredClone(issue);}
    throw new Error(endpoint);
  };
  const run=async(now,id,healthy=true)=>{
    write('monitor.json',{issues:[],warnings:[],checks:[{name:'deployment',state:'success'}]});
    return watch({root,now,gh,env:{GITHUB_REPOSITORY:REPO,GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:id},fetcher:async()=>({json:async()=>({data:[{supabaseProbe:{ok:healthy}}]})})});
  };
  return {run,comments,write,getIssue:()=>issue,failNextPatch:()=>{failPatch=true;}};
}
test('healthy checks stay quiet; critical and recovery notify once',async t=>{
  const h=harness(t),start=Date.parse(START);
  await h.run(start,'1'); assert.equal(h.comments.length,0);
  await h.run(start+1000,'2',false); assert.equal(h.comments.length,1);
  await h.run(start+2000,'3',false); assert.equal(h.comments.length,1);
  await h.run(start+3000,'4'); assert.equal(h.comments.length,2);
  assert.match(h.comments[1].body,/toparlandı/);
});
test('final report survives partial failure and is sent exactly once',async t=>{
  const h=harness(t);
  await h.run(Date.parse(START),'1');
  h.failNextPatch();
  await assert.rejects(h.run(Date.parse(END),'2'),/network/);
  assert.equal(h.comments.length,1);
  await h.run(Date.parse(END)+1000,'2');
  assert.equal(h.comments.length,1);
  assert.equal(readState(h.getIssue().body).finalized,true);
  await h.run(Date.parse(END)+2000,'3');
  assert.equal(h.comments.length,1);
});
test('missing write evidence is critical, not silently successful',async t=>{
  const h=harness(t);
  h.write('update-status.json',{lastUpdate:{steps:[]}});
  const result=await h.run(Date.parse(START),'1');
  assert.deepEqual(result.issues,['supabase-write-missing']);
  assert.equal(h.comments.length,1);
});
test('posting is forbidden outside production main',async()=>{
  await assert.rejects(watch({env:{},gh:()=>{throw new Error('must not call')}}),/restricted/);
});
