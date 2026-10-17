const { test } = require('node:test');
const assert = require('node:assert/strict');
const agenda = require('../services/refereeAgenda');
const view = require('../referee-agenda');
const now = Date.parse('2026-10-02T13:00:00Z');
function approved(patch = {}) {
  const i = { id: 'a', tag: agenda.TAG, status: 'approved', kind: 'legal-status', legalStatus: 'detained', subject: 'Test Kişisi', subjectKeys: ['person'], importance: 'high',
    publishedAt: new Date(now - 1000).toISOString(), updatedAt: new Date(now - 1000).toISOString(), sourcePublishedAt: new Date(now - 3600000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
    sources: [{ name: 'DHA', url: 'https://www.dha.com.tr/spor/test-1' }], ...patch };
  i.review = { status: 'verified', by: 'test-only', notes: 'fixture', legalStatusChecked: true, conflictsChecked: true, checkedAt: new Date(now - 500).toISOString(), contentHash: agenda.reviewHash(i) };
  return i;
}
const feed = (items, time = now) => agenda.buildFeed({ enabled: true, items }, [], time).feed;
test('editorial approved records have valid reviews; public selection is capped at four', () => {
  const config = require('../editorial/referee-agenda.json');
  for (const i of config.items.filter(i => i.status === 'approved')) assert.equal(agenda.validate(i, Date.now()).valid, true, i.id);
  const items = Array.from({ length: 6 }, (_, n) => approved({ id: String(n), subject: 'Test ' + n, subjectKeys: [String(n)] }));
  assert.equal(feed(items).items.length, 4);
});
test('trusted source alone cannot publish; a changed approved claim loses approval', () => {
  const i = approved(); delete i.review; assert.equal(feed([i]).items.length, 0);
  const changed = approved(); changed.subject = 'Changed name'; assert.equal(feed([changed]).items.length, 0);
});
test('social media, deceptive domains and unknown sources rejected', () => {
  for (const url of ['https://x.com/aa', 'https://dha.com.tr.example.com/news', 'javascript:alert(1)', 'https://unknown.test/news']) assert.equal(feed([approved({ sources: [{ name: 'Source', url }] })]).items.length, 0);
});
test('judicial states use separate controlled templates', () => {
  for (const [legalStatus, phrase] of Object.entries(agenda.ACTIONS)) assert.ok(feed([approved({ legalStatus })]).items[0].text.endsWith(phrase + '.'));
  assert.equal(feed([approved({ legalStatus: 'guilty' })]).items.length, 0);
  assert.equal(feed([approved({ subject: 'Test tutuklandı' })]).items.length, 0);
});
test('new release replaces old detention; expired new state never resurrects old', () => {
  const old = approved({ id: 'old', expiresAt: new Date(now + 7200000).toISOString() });
  const release = approved({ id: 'new', legalStatus: 'released', sourcePublishedAt: new Date(now - 1000).toISOString() });
  assert.deepEqual(feed([old, release]).items.map(i => i.id), ['new']);
  assert.equal(feed([old, release], now + 3600001).items.length, 0);
});
test('one-person update suppresses an older combined group claim', () => {
  const group = approved({ subjectKeys: ['a', 'b'] }); const update = approved({ id: 'b-new', subjectKeys: ['b'], legalStatus: 'released', sourcePublishedAt: new Date(now - 2000).toISOString() });
  assert.deepEqual(feed([group, update]).items.map(i => i.id), ['b-new']);
});
test('24 hour publication cap, 72 hour source cap, no future content', () => {
  assert.equal(feed([approved()], now + 86400001).items.length, 0);
  assert.equal(feed([approved({ sourcePublishedAt: new Date(now - 73 * 3600000).toISOString() })]).items.length, 0);
  assert.equal(feed([approved({ sourcePublishedAt: new Date(now + 1000).toISOString() })]).items.length, 0);
});
test('breaking expires independently, unimportant news is only agenda', () => {
  const data = feed([approved()]); assert.match(view.render(data, now), /SON DAKİKA/);
  assert.doesNotMatch(view.render(feed([approved({ importance: 'normal' })]), now), /SON DAKİKA/);
});
test('tagged verified news still requires review, drafts never enter', () => {
  const i = approved(); const n = { status: 'verified', tags: [agenda.TAG], agendaItem: i };
  assert.equal(agenda.buildFeed({ items: [] }, [n], now).feed.items.length, 1);
  assert.equal(agenda.buildFeed({ items: [] }, [{ ...n, status: 'draft' }], now).feed.items.length, 0);
});
test('internal column destination, HTML escaping and inaccessible duplicate', () => {
  const data = agenda.buildFeed({ destinationHref: '/kose-yazilari/hakemler-dosyasi.html', items: [approved({ subject: '<Example>' })] }, [], now).feed;
  const html = view.render(data, now); assert.match(html, /href="\/kose-yazilari\/hakemler-dosyasi.html"/); assert.ok(!html.includes('<Example>')); assert.match(html, /aria-hidden="true" inert/); assert.doesNotMatch(html, /<h[12]/);
  assert.equal(agenda.internalHref('//evil.test'), null);
});
test('browser filters stale cached feed even if server refresh fails', () => {
  const data = feed([approved()]); assert.equal(view.active(data, now + 3600001).length, 0); assert.doesNotMatch(view.render(data, now + 3600001), /Test Kişisi/);
});
test('RSS investigation discovery is never an automatic breaking item', async () => {
  const sync = await import('../scripts/sync-football-news.mjs');
  const item = { title: 'MHK soruşturmasında yeni gelişme', description: '', publishedAt: new Date(now).toISOString(), sourceName: 'TFF', sourceUrl: 'https://www.tff.org', link: 'https://www.tff.org/news', feed: { id: 'test' } };
  assert.equal(sync.isRefereeInvestigation(item), true); assert.equal(sync.toTickerItem(item), null);
});
test('RSS investigation candidates stay in review queue', async () => {
 const sync = await import('../scripts/sync-football-news.mjs');
 const r = await sync.synchronizeFootballNews({now:new Date(now),previous:{items:[]},feeds:[{id:'test',url:'https://www.tff.org',team:'Süper Lig'}],fetchText:async()=>'<rss><channel><item><title>MHK soruşturmasında yeni gelişme</title><link>https://www.tff.org/news</link><pubDate>'+new Date(now-1000).toUTCString()+'</pubDate></item></channel></rss>'});
 assert.equal(r.refereeCandidates.length,1);assert.equal(r.refereeCandidates[0].status,'pending-review');assert.equal(r.output.items.length,0);
});

test('empty, disabled and expired feeds render no strip content',()=>{
 assert.equal(view.render({enabled:true,items:[]},now),'');
 assert.equal(view.render({...feed([approved()]),enabled:false},now),'');
 assert.equal(view.render(feed([approved()]),now+3600001),'');
 assert.ok(view.render(feed([approved()]),now).includes('Test Kişisi'));
});
