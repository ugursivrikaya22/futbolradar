import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { applyVerifiedBroadcast, broadcastChannel } = require('../services/broadcastSchedule.js');
const source = { providerId:'1635659', kickoff:'2026-09-10T19:45:00+03:00', broadcast:{turkey:'TRT 1, TRT Spor ve tabii'} };
const verified = applyVerifiedBroadcast(source);
assert.equal(verified.broadcast.turkey, 'TRT 1');
assert.equal(verified.broadcastSourceUrl, 'https://www.trt1.com.tr/yayin-akisi');
assert.equal(source.broadcast.turkey, 'TRT 1, TRT Spor ve tabii', 'Do not mutate provider/cache records');
assert.equal(broadcastChannel(source), verified.broadcast.turkey, 'Schedule and API must agree');
assert.equal(broadcastChannel({...source,kickoff:'2026-09-11T19:45:00+03:00'}),source.broadcast.turkey,'Do not leak a date-specific correction');
assert.equal(broadcastChannel({kickoff:'2026-09-10T19:45:00+03:00'}),'','Never invent a channel');

// Hakem: elle doğrulama boşluğu doldurur, sağlayıcı kaydını EZMEZ.
const bjk = { providerId:'2594885', kickoff:'2026-09-17T22:00:00+03:00', broadcast:null, referee:null };
const bjkVerified = applyVerifiedBroadcast(bjk);
assert.equal(bjkVerified.broadcast.turkey, 'TRT 1');
assert.equal(bjkVerified.referee, 'Andrea Colombo (İtalya)');
assert.ok(bjkVerified.refereeSourceUrl, 'Verified referee must carry its source');
assert.equal(applyVerifiedBroadcast({...bjk, referee:'Sahadaki Hakem'}).referee, 'Sahadaki Hakem', 'Provider referee wins over the pre-match announcement');
assert.equal(applyVerifiedBroadcast({...bjk, kickoff:'2026-09-18T22:00:00+03:00'}).referee, null, 'Do not leak a date-specific correction');

console.log('Broadcast verification OK: dated source, shared output, no mutation or inferred channel; referee fills only the gap');
