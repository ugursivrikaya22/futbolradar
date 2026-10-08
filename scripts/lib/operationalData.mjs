import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { version } = createRequire(import.meta.url)('../../services/operationsPolicy.js');
// Observation reports are durable Actions artifacts, never reasons to rebuild.
const REPORT = /^(?:update-status|daily-health-check-report)\.json$/;
export function captureData(root=process.cwd()) {
  const entries=new Map();
  for(const name of fs.readdirSync(path.join(root,'data'))) {
    if(!name.endsWith('.json')) continue;
    const file=path.join(root,'data',name);
    const raw=fs.readFileSync(file,'utf8');
    try { entries.set(name,{raw,hash:version(JSON.parse(raw)),report:REPORT.test(name)}); } catch { /* validation rejects malformed published data */ }
  }
  return entries;
}
export function retainUnchangedData(before, root=process.cwd()) {
  const changed=[];
  const after=captureData(root);
  const observations={};
  for(const [name, entry] of after) {
    const old=before.get(name);
    if(!old || old.raw===entry.raw) { if(!old&&!entry.report) changed.push(name); continue; }
    if(entry.report || old.hash===entry.hash) {
      observations[name]=JSON.parse(entry.raw);
      fs.writeFileSync(path.join(root,'data',name),old.raw);
      const mirror=path.join(root,'public','data',name);
      if(fs.existsSync(mirror)) fs.writeFileSync(mirror,old.raw);
    } else changed.push(name);
  }
  for(const name of before.keys()) if(!after.has(name)&&!before.get(name).report) changed.push(name);
  return {changed,observations};
}
