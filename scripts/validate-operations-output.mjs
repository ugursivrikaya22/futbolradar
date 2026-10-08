import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
export function validateFixtures(value) {
  const rows=Array.isArray(value)?value:value.matches;
  assert(Array.isArray(rows),'Fixture rows must be an array');
  const ids=new Set();
  for(const m of rows) {
    assert(m&&m.id,'Missing match ID');
    assert(!ids.has(String(m.id)),`Duplicate match ${m.id}`); ids.add(String(m.id));
    assert(m.homeTeam&&m.awayTeam,`Missing teams ${m.id}`);
    if(m.kickoff) assert(Number.isFinite(Date.parse(m.kickoff)),`Invalid kickoff ${m.id}`);
    for(const k of ['home','away']) if(m.score?.[k]!=null) assert(Number.isInteger(m.score[k])&&m.score[k]>=0,`Invalid score ${m.id}`);
  }
  return rows.length;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  for(const f of ['data/matches.json','data/fixture-calendar.json']) console.log(f,validateFixtures(JSON.parse(fs.readFileSync(f,'utf8'))));
  console.log('Critical fixture validation passed. Full SEO/browser checks remain in daily/code CI.');
}
