import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { primaryFixtureCalendar } from '../scripts/lib/primaryFixtureCalendar.mjs';
const require = createRequire(import.meta.url);
const { fixtureTeamNames } = require('../services/superLigTeams.js');
const teams = fixtureTeamNames();
const season = Array.from({length:teams.length/2},(_,i)=>({id:String(900000+i),providerId:String(900000+i),providerLeagueId:'203',league:'Süper Lig',homeTeam:teams[i*2],awayTeam:teams[i*2+1],kickoff:'2026-10-18T20:00:00+03:00',status:'SCHEDULED',score:{home:null,away:null},fetchedAt:'2026-10-17T19:00:00Z'}));

test('one season request merges the window and preserves unrelated rows and timestamps', async()=>{
  let calls=0;
  const old={id:'unrelated',homeTeam:'Liverpool',awayTeam:'Como',kickoff:'2026-08-16T20:00:00+03:00',source:'editorial',fetchedAt:'2026-08-16T21:00:00Z'};
  const result=await primaryFixtureCalendar({previous:{matches:[old]},today:'2026-10-17',fetchSeason:async()=>{calls++;return season;}});
  assert.equal(calls,1);
  assert.equal(result.calendarSync.requests,1);
  assert.equal(result.returnedInWindow,9);
  assert.equal(result.provider,'api-football');
  assert.deepEqual(result.matches.find(m=>m.id==='unrelated'),old);
  assert.ok(result.matches.filter(m=>m.providerIds?.apiFootball).every(m=>m.score.home===null));
});
test('wrong league, empty response and real window loss all fail closed',async()=>{
  for(const response of [[],season.map(m=>({...m,homeTeam:'Wrong A',awayTeam:'Wrong B'}))]){
    await assert.rejects(primaryFixtureCalendar({previous:{matches:[]},today:'2026-10-17',fetchSeason:async()=>response}),/league-identity/);
  }
  const partial=season.map((m,i)=>({...m,kickoff:i?'2026-12-18T20:00:00+03:00':m.kickoff}));
  await assert.rejects(primaryFixtureCalendar({previous:{matches:season},today:'2026-10-17',fetchSeason:async()=>partial}),/count-drop/);
});
