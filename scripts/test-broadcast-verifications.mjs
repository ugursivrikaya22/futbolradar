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

const { programmeRows, channelForMatch } = require('../services/broadcastProgramme.js');
const { findBroadcaster } = require('../services/broadcastRights.js');
const beIN = findBroadcaster('bein-sports');
const day = '2026-11-27';
const a = { homeTeam: 'Çaykur Rizespor', awayTeam: 'Kasımpaşa', kickoff: '2026-11-27T17:00:00Z' };
const b = { homeTeam: 'Alanyaspor', awayTeam: 'Konyaspor', kickoff: '2026-11-27T20:00:00+03:00' };
const grid = '<header>beIN SPORTS 5</header><p><strong>27 Kasım 2026 Cuma</strong><br>' +
  '20:00 | ÇAYKUR RİZESPOR - KASIMPAŞA | <b>beIN SPORTS 1</b><br>' +
  '20:00 | CORENDON ALANYASPOR - TÜMOSAN KONYASPOR | <b>beIN SPORTS 2</b></p>' +
  '<p>28 Kasım 2026 Cumartesi<br>20:00 | Rizespor - Kasımpaşa | beIN SPORTS 3</p>';
const rows = programmeRows(grid, beIN);
assert.equal(channelForMatch(rows, a, day), 'beIN SPORTS 1');
assert.equal(channelForMatch(rows, b, day), 'beIN SPORTS 2');
assert.equal(channelForMatch(rows, {...a, awayTeam: 'Konyaspor'}, day), '');
assert.equal(channelForMatch(rows, {...a, homeTeam: 'Çaykur Rizespor U19'}, day), '');
assert.equal(channelForMatch(rows, {...a, kickoff: '2026-11-27T18:00:00Z'}, day), '');
assert.equal(channelForMatch(rows, {...a, kickoff: '2026-11-27T20:00:00'}, day), '');
assert.equal(channelForMatch(rows, {...a, kickoff: '2026-11-28T17:00:00Z'}, '2026-11-28'), 'beIN SPORTS 3');
const table = '<table><tr><td>2026-11-27</td><td>20:00</td><td>Ç.Rizespor</td><td>Kasımpaşa</td><td>beIN SPORTS MAX 1</td></tr></table>';
assert.equal(channelForMatch(programmeRows(table, beIN), a, day), 'beIN SPORTS MAX 1');
const conflicting = '<p>27 Kasım 2026 Cuma<br>20:00 | Rizespor - Kasımpaşa | beIN SPORTS 4</p>';
assert.equal(channelForMatch(programmeRows(grid + conflicting, beIN), a, day), '');
assert.equal(channelForMatch(programmeRows('<p>Cuma<br>20:00 | Rizespor - Kasımpaşa | beIN SPORTS 1</p>', beIN), a, day), '');
assert.equal(channelForMatch(programmeRows('<p>27 Kasım 2026 Cuma<br>20:00 | Rizespor - Kasımpaşa<br>beIN SPORTS 4</p>', beIN), a, day), '');
console.log('Programme verification OK: dated row, Istanbul kickoff, separate simultaneous channels, no borrowed channel');
