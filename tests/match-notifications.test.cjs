const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = require('../match-notifications-core');
const match = (extra = {}) => ({id: 'A', homeTeam: 'Home', awayTeam: 'Away', status: '1H', minute: 10, score: {home: 0, away: 0}, events: [], ...extra});
test('first snapshot, repeat events, provider correction and reconnect baseline', () => {
  const goal = {id: 'e1', type: 'Goal', minute: 11, playerName: 'Verified'};
  let m = match({events: [goal], score: {home: 1, away: 0}});
  let first = core.diff(null, m, 1000); assert.equal(first.events.length, 0);
  assert.equal(core.diff(first.next, m, 2000).events.length, 0);
  m.events = [{...goal, detail: 'Goal cancelled'}]; m.score.home = 0;
  const correction = core.diff(first.next, m, 3000);
  assert.deepEqual(correction.events.map(e => e.type), ['var']);
  assert.equal(core.diff(correction.next, m, 4000).events.length, 0);
  assert.equal(core.diff(first.next, m, 200000).events.length, 0);
});
test('no fabricated goals or VAR; penalties and red cards require explicit events', () => {
  const base = core.snapshot(match(), 1000);
  assert.deepEqual(core.diff(base, match({score: {home: 1, away: 0}}), 2000).events.map(e=>e.type), ['score_update']);
  assert.equal(core.events(match({events: [{type:'Var', detail:'Penalty review'}]})).length, 0);
  const e = core.events(match({events: [{type:'Card',detail:'Red Card'}, {type:'Goal',detail:'Missed Penalty'}, {type:'Var',detail:'Penalty confirmed'}, {type:'Goal',detail:'Penalty'}]}));
  assert.deepEqual(e.map(x=>x.type), ['red_card','penalty_missed','penalty_awarded','penalty_scored']);
  const decrease = core.diff(core.snapshot(match({score:{home:1,away:0}}),1000),match(),2000);
  assert.equal(decrease.events[0].type, 'score_correction');
});
test('status transitions and postponed matches', () => {
  const start = core.diff(core.snapshot(match({status:'SCHEDULED'}), 1000), match(), 2000);
  assert.equal(start.events[0].type, 'kickoff');
  const half = core.diff(start.next, match({status:'HT'}), 3000); assert.equal(half.events[0].type,'halftime');
  assert.equal(core.diff(half.next, match({status:'FT'}), 4000).events[0].type,'fulltime');
  assert.equal(core.isFinished(match({status:'POSTPONED'})), false);
});

test('late historical events, added-time keys, and missing score stay honest', () => {
  const base = core.snapshot(match({minute:60}), 1000);
  const result = core.diff(base, match({minute:61,events:[{type:'Goal',minute:15}]}), 2000);
  assert.equal(result.events.length,0);
  const events = core.events(match({events:[{type:'Goal',time:{elapsed:45,extra:1}},{type:'Goal',time:{elapsed:45,extra:3}}]}));
  assert.notEqual(events[0].id,events[1].id);
  assert.equal(core.snapshot(match({score:{home:null,away:null}}),1000).score,null);
});

test('a provider without event IDs can cancel an earlier goal', () => {
 const previous = core.snapshot(match({minute:60,score:{home:1,away:0},events:[{type:'Goal',minute:55,playerName:'Player'}]}), 1000);
 const result = core.diff(previous,match({minute:61,events:[{type:'Var',detail:'Goal cancelled',minute:55,playerName:'Player'}]}),2000);
 assert.deepEqual(result.events.map(e=>e.type),['var']);
});

test('source ID aliases use the established dated match-page ID',()=>{
 const {buildAliases}=require('../scripts/generate-match-notification-identities.cjs');
 const fixture={homeTeam:'Konyaspor',awayTeam:'Başakşehir',kickoff:'2026-10-11T13:30:00+03:00'};
 const {aliases}=buildAliases([{...fixture,id:'tff-1'},{...fixture,id:'provider-1',providerIds:{apiFootball:'123'}},{...fixture,id:'other-date',kickoff:'2026-10-18T13:30:00+03:00'}]);
 assert.equal(aliases['tff-1'],aliases['123']);assert.equal(aliases['provider-1'],aliases['tff-1']);assert.notEqual(aliases['other-date'],aliases['tff-1']);
});

test('Turkish uppercase cancellation is explicit evidence',()=>{
 assert.equal(core.events(match({events:[{type:'VAR',detail:'GOL İPTALİ',minute:12}]}))[0].type,'var');
});
