const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TYPES, normalizeTypes, accepts, confirmedLineupTeams } = require('../services/pushPreferences');
test('event preferences preserve opt-out and reject unknown types', () => {
  assert.deepEqual(normalizeTypes(undefined), TYPES);
  assert.deepEqual(normalizeTypes([]), []);
  assert.deepEqual(normalizeTypes(['goal','goal','advertisement']), ['goal']);
  assert.equal(accepts({notification_types:['goal']}, 'red-card'), false);
});
test('only complete official elevens trigger an announcement', () => {
  const players = Array(11).fill('Player');
  assert.deepEqual(confirmedLineupTeams({lineups:[{team:'A',players},{team:'B',players,probable:true}]}), ['A']);
  assert.deepEqual(confirmedLineupTeams({lineups:[{team:'A',players:players.slice(1)}]}), []);
});
test('worker observes official lineup, kickoff, goal, red card and final transitions without a browser', async () => {
  const store = require('../services/pushSubscriptionStore');
  const notifier = require('../services/pushNotifier');
  const { tick } = require('../scripts/run-push-worker.cjs');
  const savedList = store.listAll, savedNotify = notifier.notifyMatchEvents;
  const now = Date.now();
  let match = { id:'test', providerId:'42', homeTeam:'Fenerbahçe', awayTeam:'Galatasaray', kickoff:new Date(now-60000).toISOString(), status:'NS', score:{home:0,away:0}, fetchedAt:new Date(now).toISOString() };
  let lineups = [], events = [], delivered = [];
  store.listAll = async () => [{favorite_teams:['match:42']}];
  notifier.notifyMatchEvents = async value => {delivered.push(...value);};
  const provider = {getMatches:async()=>[match],getLineups:async()=>lineups,getFixtureEvents:async()=>events};
  try {
    let previous = new Map();
    const poll = async () => {const rows = await tick({provider,previous,now});previous = new Map(rows.map(row=>[row.id,row]));};
    await poll();assert.equal(delivered.length,0);
    lineups=[{team:'Fenerbahçe',players:Array(11).fill('Player')}];await poll();
    match={...match,status:'1H'};await poll();
    match={...match,score:{home:1,away:0}};await poll();
    events=[{id:'red',type:'Card',detail:'Red Card',time:"20'"}];await poll();
    match={...match,status:'FT'};await poll();await poll();
    assert.deepEqual(delivered.map(e=>e.type),['lineup','kickoff','goal','red-card','fulltime']);
  } finally {store.listAll=savedList;notifier.notifyMatchEvents=savedNotify;}
});
