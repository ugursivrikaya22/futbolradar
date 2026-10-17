const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildArchive } = require('../services/historicalMatchArchive');
const { buildMatchReport } = require('../services/matchReportService');
const { dedupeFixtures } = require('../services/matchResultSyncService');
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
      assert.equal(report.reportUrl, './'+report.seo.path);
      assert.equal(report.slug, report.seo.path.replace(/^mac-raporu\//,'').replace(/\.html$/,''));
      for(const base of ['', 'public']) assert.ok(fs.existsSync(path.join(__dirname,'..',base,report.seo.path)), 'published route exists: '+report.seo.path);
      assert.equal(buildMatchReport(match,{}).seo.path,report.seo.path,'archive rebuild retains URL');
    }
    if (resolution.status === 'FINISHED') {
      const rebuilt = buildArchive({sources:[{name:'report',records:[match]}],previous:{records:[]},now:'2026-10-17T19:00:00Z'});
      assert.deepEqual(rebuilt.records[0].match.identityResolution, match.identityResolution, 'provenance survives rebuild');
      assert.equal(rebuilt.records[0].match.reportPage, match.reportPage, 'published route survives archive round trip');
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

test('both Chile fixtures survive calendar deduplication without sharing an API ID',()=>{
  for(const file of ['../data/fixture-calendar.json','../public/data/fixture-calendar.json']){
    const rows=require(file).matches.filter(m=>m.homeTeam==='Chile W'&&m.awayTeam==='Bolivia W');
    // The daily calendar may age these out; the permanent archive above must
    // retain both. Any rows still in the live window must remain independent.
    assert.equal(dedupeFixtures(rows).records.length,rows.length);
    const cancelled=rows.find(m=>m.status==='CANCELLED');
    if(cancelled){
      assert.ok(!cancelled.providerId);
      assert.ok(!cancelled.providerIds?.apiFootball);
      assert.equal(cancelled.score,null);
    }
  }
});
