const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArchive } = require('../services/historicalMatchArchive');
const archive = require('../data/historical-match-archive.json');
const reports = require('../data/post-match-reports.json');
const resolutions = require('../data/match-identity-resolutions.json').records;

for (const resolution of resolutions) {
  test(`historical identity: ${resolution.id}`, () => {
    const record = archive.records.find(r => r.canonicalId === resolution.id);
    assert.ok(record, 'stable URL identity remains present');
    const match = record.match;
    for (const key of ['homeTeam','awayTeam','kickoff','status']) assert.equal(match[key], resolution[key]);
    if (resolution.score) {
      assert.equal(match.score.home, resolution.score.home);
      assert.equal(match.score.away, resolution.score.away);
    } else assert.equal(match.score, null, 'cancelled fixture never inherits a result');
    assert.deepEqual(match.identityResolution.sourceUrls, resolution.sourceUrls);
    if (resolution.providerId) assert.equal(match.providerIds.apiFootball, resolution.providerId);
    else assert.ok(!match.providerIds?.apiFootball, 'missing numeric IDs are never fabricated');
    const report = reports.records.find(r=>r.matchId===resolution.id);
    if (resolution.status === 'CANCELLED') assert.equal(report, undefined);
    else {
      assert.ok(report);
      assert.equal(report.homeTeam, resolution.homeTeam);
      assert.equal(report.awayTeam, resolution.awayTeam);
      assert.equal(report.kickoff, resolution.kickoff);
      assert.equal(report.fixtureId || null, resolution.providerId);
    }
    if (resolution.status === 'FINISHED') {
      const rebuilt = buildArchive({sources:[{name:'report',records:[match]}],previous:{records:[]},now:'2026-10-17T19:00:00Z'});
      assert.deepEqual(rebuilt.records[0].match.identityResolution, match.identityResolution, 'provenance survives rebuild');
    }
  });
}

test('same-day friendlies and provider namespaces remain distinct', () => {
  const liverpool = resolutions.find(r=>r.id.startsWith('liverpool-'));
  assert.equal(liverpool.providerId, null);
  assert.notEqual(liverpool.kickoff,'2026-08-16T13:30:00+03:00');
  const fener = archive.records.find(r=>r.canonicalId==='fenerbahce-gornik-zabrze-2026-07-21').match;
  assert.equal(fener.providerIds.apiFootball,'1556502');
  assert.equal(fener.providerIds.opta,'blx8udpkfd48ndx9a93jskg0k');
});
