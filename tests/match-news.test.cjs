const test=require('node:test');
const assert=require('node:assert/strict');
const {view,renderPage,liveHtml,editorial,matchesFixture}=require('../services/matchNews');
const before=Date.parse('2026-10-09T13:00:00Z');
const fixture={id:'1584424',homeTeam:'Galatasaray',awayTeam:'Kasımpaşa',kickoff:editorial.kickoff,fetchedAt:'2026-10-09T13:00:00Z',source:'api-football'};
test('pregame has no invented score and all editorial sections',()=>{
  const html=renderPage({...fixture,status:'SCHEDULED',score:{home:null,away:null}},before);
  for(const text of ['Muhtemel 11','Sakat ve cezalı','Takım form grafikleri','Geçmiş karşılaşmalar','data-match-poll','application/ld+json']) assert.ok(html.includes(text),text);
  assert.ok(!html.includes('<b>0–0</b>'));
});
test('live to final changes headline and exposes only measured analysis',()=>{
  const m={...fixture,providerStatus:'1H',minute:12,score:{home:1,away:0},events:[{time:"12'",value:'Goal',team:{name:'Galatasaray'}}]};
  assert.match(view(m,before).title,/canlı skor/);
  const v=view({...m,providerStatus:'FT',statistics:[{type:'Şut',home:12,away:5},{type:'xG',home:null,away:null}],players:[{name:'A',team:'Galatasaray',minutes:90,providerRating:8.2}]},before);
  assert.match(v.title,/maç sonucu/);
  const html=liveHtml(v);
  assert.match(html,/Teknik analiz/); assert.match(html,/8.2/); assert.ok(!html.includes('<td>xG</td>'));
  assert.match(html,/Doğrulanmış maç sonu/);
});
test('wrong identity and outage cannot invent current state',()=>{
  assert.equal(matchesFixture({...fixture,id:'7'}),false);
  assert.equal(view({...fixture,id:'7',status:'FT',score:{home:9,away:9}},before).hasScore,false);
  assert.match(view(null,Date.parse('2026-10-09T18:00:00Z')).title,/bekleniyor/);
  assert.equal(view(fixture,before+180000).stale,true);
  assert.equal(view(fixture,before,true).stale,true);
});
test('postponed state and 0-0 final are distinct from pregame',()=>{
  assert.match(view({...fixture,providerStatus:'PST'},before).title,/Ertelendi/);
  assert.equal(view({...fixture,providerStatus:'FT',score:{home:0,away:0}},before).score,'0–0');
});
test('escapes provider text and accepts only complete official lineups',()=>{
  const m={...fixture,providerStatus:'FT',score:{home:2,away:1},events:[{value:'<script>alert(1)</script>'}],lineups:[{team:'Galatasaray',players:['A']}]};
  const html=liveHtml(view(m,before));
  assert.ok(!html.includes('<script>')); assert.match(html,/&lt;script&gt;/); assert.match(html,/Muhtemel 11/);
  m.lineups=['Galatasaray','Kasımpaşa'].map(team=>({team,players:Array.from({length:11},(_,i)=>'Player '+i)}));
  assert.match(liveHtml(view(m,before)),/Resmî ilk 11/);
});
test('HTTP route serves JSON and server-rendered SEO using the same fixture',async()=>{
  const provider=require('../services/providers/apiFootballProvider');
  const original=provider.getMatchDetail;
  let requests=0;
  provider.getMatchDetail=async query=>{assert.equal(query.id,'1584424');requests++;return {...fixture,fetchedAt:new Date().toISOString(),status:'FINISHED',score:{home:2,away:1}};};
  const {handleMatchNews}=require('../server/matchNewsRoute');
  const call=async url=>{const headers={};let body='';const res={setHeader:(k,v)=>headers[k]=v,end:value=>{body=value||'';},statusCode:0};await handleMatchNews({method:'GET',url,headers:{},socket:{remoteAddress:'127.0.0.1'}},res);return {headers,body,status:res.statusCode};};
  try {
    const json=await call('/api/match-news?format=json');
    assert.match(json.headers['Content-Type'],/json/);assert.equal(JSON.parse(json.body).ended,true);
    const html=await call('/api/match-news');
    assert.match(html.body,/<title>Galatasaray 2–1 Kasımpaşa/);
    assert.equal(html.headers['Vercel-CDN-Cache-Control'],'public, s-maxage=15');
    assert.equal(requests,1);
  } finally {provider.getMatchDetail=original;}
});
