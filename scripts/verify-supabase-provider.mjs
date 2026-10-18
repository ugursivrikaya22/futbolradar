#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const client=require('../services/supabase/client.js');
const normalize=require('../services/supabase/normalize.js');
const calendar=JSON.parse(fs.readFileSync('data/fixture-calendar.json','utf8'));
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul'}).format(new Date());
const candidate=calendar.matches.find(m=>m.providerIds?.apiFootball && String(m.kickoff || m.kickoffUtc).startsWith(today));
assert(candidate, 'No dated provider fixture available for the live probe');
assert(process.env.APIFOOTBALL_API_KEY,'Provider credential required');
const id=candidate.providerIds.apiFootball;
const response=await fetch(`https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(id)}`,{
  headers:{'x-apisports-key':process.env.APIFOOTBALL_API_KEY},signal:AbortSignal.timeout(15000)
});
assert(response.ok,`Provider HTTP ${response.status}`);
const payload=await response.json();
assert.equal(Object.keys(payload.errors || {}).length,0,'Provider reported an error');
assert.equal(payload.response?.length,1,'Provider fixture response must be unambiguous');
const fixture=payload.response[0];
assert.equal(String(fixture.fixture.id),String(id));
// Reuse the existing canonical identity; update only facts returned by the provider.
const expected=normalize.match({...candidate,
  kickoff:fixture.fixture.date,
  homeTeam:fixture.teams.home.name,awayTeam:fixture.teams.away.name,
  status:fixture.fixture.status.short,providerStatus:fixture.fixture.status.short,
  score:{home:fixture.goals.home,away:fixture.goals.away,
    halftimeHome:fixture.score.halftime.home,halftimeAway:fixture.score.halftime.away}
},'api-football');
assert(expected,'Live fixture failed normalization');
const existing=await client.select('matches',{filters:{provider_fixture_id:`eq.${id}`,source_id:'eq.api-football'},limit:2});
assert(existing.length<=1,'Ambiguous persisted provider identity');
if(existing.length) expected.id=existing[0].id;
// Two writes to the same key test idempotency, without inserting synthetic records.
for(let attempt=0;attempt<2;attempt++){
  await client.upsert('matches',[expected],'id');
  const saved=await client.select('matches',{filters:{id:`eq.${expected.id}`},limit:2});
  assert.equal(saved.length,1);
  for(const field of ['provider_fixture_id','status','provider_status','home_score','away_score','ht_home_score','ht_away_score','source_id'])
    assert.equal(saved[0][field],expected[field],`Live readback mismatch: ${field}`);
  assert.equal(Date.parse(saved[0].kickoff),Date.parse(expected.kickoff));
}
const evidence={checkedAt:new Date().toISOString(),providerRequests:1,fixtureId:id,canonicalId:expected.id,status:expected.status,score:[expected.home_score,expected.away_score],writes:2,readbacks:2,success:true};
fs.mkdirSync('outputs',{recursive:true});
fs.writeFileSync('outputs/supabase-provider-verification.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
