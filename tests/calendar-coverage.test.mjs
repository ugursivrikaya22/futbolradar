import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarCoverage } from '../scripts/lib/calendarCoverage.mjs';
test('successful public limited feed can supplement a larger retained calendar',()=>{
  assert.deepEqual(calendarCoverage({publicKey:true,failures:0,previousCount:11,incomingCount:5}),{safe:true,mode:'limited-home-fixtures'});
});
test('partial failures and empty public feed cannot be promoted',()=>{
  assert.equal(calendarCoverage({publicKey:true,failures:1,previousCount:11,incomingCount:5}).safe,false);
  assert.equal(calendarCoverage({publicKey:true,failures:0,previousCount:11,incomingCount:0}).safe,false);
});
test('full-window provider still retains its loss guard',()=>{
  assert.equal(calendarCoverage({publicKey:false,failures:0,previousCount:11,incomingCount:5}).safe,false);
  assert.equal(calendarCoverage({publicKey:false,failures:0,previousCount:11,incomingCount:10}).safe,true);
});
