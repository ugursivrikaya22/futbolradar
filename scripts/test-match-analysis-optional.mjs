import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const handler = require('../api/[...route].js');
const analyses = require('../data/match-analyses.json');
async function request(query) {
  const response = {
    statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; }
  };
  await handler({ method: 'GET', url: '/api/match-analysis?' + query, headers: {} }, response);
  return { status: response.statusCode, payload: JSON.parse(response.body) };
}
const missing = 'fixtureId=__interaction_audit_missing_fixture__';
const required = await request(missing);
const optional = await request(missing + '&optional=1');
assert.equal(required.status, 404, 'Existing resource lookup contract must remain unchanged');
assert.equal(optional.status, 200, 'An absent optional analysis is a normal empty response');
assert.deepEqual(optional.payload, required.payload);
assert.equal(optional.payload.data, null);
assert.equal(optional.payload.error.code, 'MATCH_ANALYSIS_NOT_FOUND');
const fixture = analyses.find(record => record.fixtureId);
assert.ok(fixture, 'Persisted analysis fixture missing');
const query = 'fixtureId=' + encodeURIComponent(fixture.fixtureId);
const existing = await request(query);
const existingOptional = await request(query + '&optional=1');
assert.equal(existing.status, 200);
assert.equal(existingOptional.status, 200);
assert.deepEqual(existingOptional.payload, existing.payload, 'Available analysis data must remain unchanged');

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const initSource = source.slice(source.indexOf('  function initMatchAnalysis('), source.indexOf('  function statisticNumber('));
async function testClient({ record = fixture, matches = [], rejectMatches = false, fallback = true } = {}) {
  let resolveMatches;
  let rejectMatchLoad;
  const pendingMatches = new Promise((resolve, reject) => {
    resolveMatches = resolve;
    rejectMatchLoad = reject;
  });
  let selectedTabId = null;
  let tabsInitialized = 0;
  const renderedMatches = [];
  const target = {
    dataset: { staticFallback: String(fallback) },
    innerHTML: fallback ? 'static fallback' : '',
    querySelector(selector) {
      if (selector.includes('aria-selected')) return selectedTabId ? { id: selectedTabId } : null;
      return { click() { selectedTabId = selector.slice(1); } };
    }
  };
  const context = vm.createContext({
    URLSearchParams,
    window: { location: { search: '?id=' + encodeURIComponent(fixture.fixtureId) } },
    loadData: () => pendingMatches,
    fetchMatchAnalysisRecord: () => Promise.resolve(record),
    deepAnalysisEditorialHtml: match => match?.deepAnalysis ? 'editorial' : '',
    matchAnalysisHeroHtml: (record, match) => { renderedMatches.push(match); return 'hero'; },
    matchAnalysisTabsHtml: () => 'tabs',
    setContent: (element, html) => { element.innerHTML = html; element.dataset.state = 'ready'; },
    setEmpty: element => { element.innerHTML = 'empty'; element.dataset.state = 'empty'; },
    initAnalysisTabs: () => { tabsInitialized++; selectedTabId = 'tab-summary'; }
  });
  vm.runInContext(initSource, context);
  context.initMatchAnalysis(target);
  await new Promise(resolve => setImmediate(resolve));
  if (record) {
    assert.equal(target.innerHTML, 'herotabs', 'Persisted analysis must render while match context is still pending');
    assert.equal(tabsInitialized, 1);
    selectedTabId = 'tab-deep';
  } else {
    assert.equal(target.dataset.state, 'loading', 'Editorial-only analysis still waits for match context');
  }
  if (rejectMatches) rejectMatchLoad(new Error('match-list-unavailable'));
  else resolveMatches(matches);
  await new Promise(resolve => setImmediate(resolve));
  return { target, renderedMatches, selectedTabId, tabsInitialized };
}

const match = { fixtureId: fixture.fixtureId, deepAnalysis: {} };
const enriched = await testClient({ matches: [match] });
assert.equal(enriched.target.innerHTML, 'herotabseditorial', 'Late context must retain editorial analysis');
assert.equal(enriched.renderedMatches[1], match);
assert.equal(enriched.selectedTabId, 'tab-deep', 'Late context must preserve the reader’s selected tab');
assert.equal(enriched.tabsInitialized, 2);
for (const rejectMatches of [false, true]) {
  const isolated = await testClient({ rejectMatches });
  assert.equal(isolated.target.innerHTML, 'herotabs', 'Absent or failed match context must not discard valid analysis');
  assert.equal(isolated.tabsInitialized, 1);
}
assert.equal((await testClient({ record: null, matches: [match] })).target.innerHTML, 'editorial');
assert.equal((await testClient({ record: null })).target.dataset.state, 'fallback');
assert.equal((await testClient({ record: null, fallback: false })).target.dataset.state, 'empty');
console.log('Optional match analysis passed: empty enrichment is quiet; existing API contracts and records are preserved.');
