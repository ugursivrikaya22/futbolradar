import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {isHomeFixture}=require('../services/homeFixtureVisibility');
const {isDisplayableLive}=require('../services/matchStatus');
const source=fs.readFileSync('app.js','utf8').match(/\/\/ today-match-card-selection:start([\s\S]*?)\/\/ today-match-card-selection:end/)[1];
const client=new Function('featuredIsLiveMatch',source+'\nreturn isHomeFixtureMatch;')((row,nowMs)=>isDisplayableLive(row,{nowMs}));
const now=Date.parse('2026-10-05T00:30:00+03:00');
const future={kickoff:'2026-10-05T19:00:00+03:00',status:'SCHEDULED'};
const cases=[
 [future,true], [{...future,status:'NS'},true],
 [{...future,status:'FINISHED',score:{home:2,away:1}},false],
 [{...future,providerStatus:'FT'},false],
 [{...future,status:'CANC'},false], [{...future,status:'PST'},false],
 [{...future,kickoff:'2026-10-04T10:00:00+03:00'},false],
 [{...future,kickoff:'bad'},false],
 [{kickoff:'2026-10-04T23:50:00+03:00',status:'LIVE',providerStatus:'1H',score:{home:0,away:0},source:'api-football',fetchedAt:new Date(now).toISOString()},true],
 [{kickoff:'2026-10-04T18:00:00+03:00',status:'LIVE',score:{home:0,away:0},source:'api-football',fetchedAt:new Date(now-3600000).toISOString()},false]
];
for(const [row,expected] of cases){assert.equal(isHomeFixture(row,now),expected,JSON.stringify(row));assert.equal(client(row,now),expected,'browser: '+JSON.stringify(row));}
console.log('PASS: homepage excludes final, cancelled, postponed and stale fixtures; server/client parity and midnight live match preserved.');
