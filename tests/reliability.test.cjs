const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = require('../match-notifications-core');
const {buildAiMatchCenter} = require('../services/aiMatchCenter');
const fixture = (stamp, home, extra={}) => ({id:'isolated-test',status:'2H',minute:65,score:{home,away:0},events:[],fetchedAt:new Date(stamp).toISOString(),...extra});

test('out-of-order/equal snapshots cannot undo a score, newer corrections can',()=>{
  const previous=core.snapshot(fixture(3000,2),3000);
  for(const time of [1000,3000]) {
    const ignored=core.diff(previous,fixture(time,1),4000);
    assert.equal(ignored.next.score.home,2); assert.deepEqual(ignored.events,[]);
  }
  const corrected=core.diff(previous,fixture(5000,1),5000);
  assert.equal(corrected.next.score.home,1); assert.equal(corrected.events[0].type,'score_correction');
  assert.equal(core.diff(corrected.next,fixture(5000,1),6000).events.length,0);
});
test('missing score retains last evidence without inventing 0-0',()=>{
  const previous=core.snapshot(fixture(1000,2),1000);
  const result=core.diff(previous,fixture(2000,null),2000);
  assert.deepEqual(result.next.score,{home:2,away:0}); assert.equal(result.next.scoreUnavailable,true);
  assert.deepEqual(result.events,[]);
});
test('terminal aliases and non-playing statuses are distinguished',()=>{
  for(const status of ['FT','AET','PEN','FULL_TIME','AWARDED','WO']) assert.equal(core.isFinished({status}),true);
  for(const status of ['PST','POSTPONED','CANC','SUSP','P','ET']) assert.equal(core.isFinished({status}),false);
  const first=core.snapshot(fixture(1000,1),1000);
  assert.deepEqual(core.diff(first,fixture(2000,1,{status:'PST'}),2000).events,[]);
  assert.equal(core.diff(first,fixture(2000,1,{status:'FT'}),2000).events[0].type,'fulltime');
});
test('reconnect and first follow never replay historical goals',()=>{
  const m=fixture(200000,1,{events:[{id:'old-goal',type:'Goal',minute:10}]});
  assert.deepEqual(core.diff(null,m,200000).events,[]);
  assert.deepEqual(core.diff(core.snapshot(fixture(1000,0),1000),m,200000).events,[]);
});
test('zero/one match and competition priors cannot become team dominance',()=>{
  for(const matches of [0,1,4]) {
    const model=buildAiMatchCenter({probability:{source:'futbolradar_model',probabilities:{home:80,draw:10,away:10}},modelPrediction:{inputs:{home:{matches,attackStrength:1.5},away:{matches,attackStrength:0.6}}}});
    assert.equal(model.outcome,null);assert.deepEqual(model.drivers,[]);assert.equal(model.insufficientAnalysis,true);
  }
  const model=buildAiMatchCenter({probability:{dataBasis:'competition-baseline',probabilities:{home:55,draw:25,away:20}}});
  assert.equal(model.outcome,null);assert.equal(model.insufficientAnalysis,true);
});
test('completed-match summary cannot repeat a pre-match prediction',()=>{
  const model=buildAiMatchCenter({state:'post',result:{home:1,away:2},probability:{probabilities:{home:70,draw:20,away:10}},modelPrediction:{inputs:{home:{matches:10,attackStrength:1.5},away:{matches:10,attackStrength:0.7}}}});
  assert.deepEqual(model.summary.result,{home:1,away:2});assert.equal(model.summary.lean,null);assert.deepEqual(model.summary.topDrivers,[]);
});
test('summary includes only verified final-score, statistics and explicit red cards',()=>{
  const input={state:'post',result:{home:2,away:1},statistics:[{type:'Toplam şut',home:12,away:8},{type:'İsabetli şut',home:null,away:4},{type:'Unknown',home:99,away:1}],events:[{id:'red1',type:'Card',detail:'Red Card'},{id:'red1',type:'Card',detail:'Red Card'},{type:'Card',detail:'Yellow Card'}]};
  const summary=buildAiMatchCenter(input).summary;
  assert.deepEqual(summary.statistics,[{type:'Toplam şut',home:12,away:8}]);assert.equal(summary.redCards,1);
  assert.deepEqual(buildAiMatchCenter(input).summary,summary);
  assert.equal(buildAiMatchCenter({...input,state:'live'}).summary,null);
});
test('explicit cancellation points to the previously observed goal',()=>{
  const goal={id:'goal1',type:'Goal',minute:65,playerName:'Test Player'};
  const before=core.snapshot(fixture(1000,1,{events:[goal]}),1000);
  const cancelled=core.diff(before,fixture(2000,0,{events:[{...goal,detail:'Goal cancelled'}]}),2000).events[0];
  assert.equal(cancelled.replacesEventId,'isolated-test:provider:goal1');
  assert.deepEqual(cancelled.previousScore,{home:1,away:0});
});
test('unverified background push fails closed before reading or changing subscriptions',async()=>{
  const {handlePushSubscription}=require('../server/pushSubscriptionRoute');
  const {isConfigured}=require('../services/pushNotifier');
  assert.equal(isConfigured(),false);
  for(const method of ['GET','POST','DELETE']) {
    let body; const res={setHeader(){},end(value){body=JSON.parse(value);}};
    await handlePushSubscription({method,headers:{},socket:{remoteAddress:'192.0.2.123'},body:{}},res);
    if(method==='GET') assert.equal(body.data.configured,false);
    else { assert.equal(res.statusCode,503);assert.equal(body.error.code,'PUSH_DISABLED'); }
  }
});
