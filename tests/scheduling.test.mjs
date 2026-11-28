// Scheduling, compensation and health-classification scenarios.
// All timing uses a controlled clock and fake GitHub/API responses; nothing
// here touches the network, a real provider or the production repository.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import policy from '../services/operationsPolicy.js';
import {finalize,settleFullLock} from '../scripts/finalize-operations-publication.mjs';
import {monitor} from '../scripts/monitor-operations.mjs';
import {plan} from '../scripts/plan-scheduled-update.mjs';
import {claimSharedRunLock} from '../scripts/run-scheduled-update.mjs';

const L = policy.limits;
const at = (iso) => Date.parse(iso);
const FULL_CRON = '0 2 * * *';
const HOURLY_CRON = '7 4-21 * * *';

function liveSource(overrides = {}) {
  return {id: 'live-fixtures', source: 'api-football', status: 'success', summary: {degraded: false, lastSuccessfulSyncAt: '2026-10-08T08:00:00Z'}, ...overrides};
}
function record({id, type = 'full', status = 'success', finishedAt, day = '2026-10-08', publication = {state: 'committed'}, steps = [{id: 'full-static-build', kind: 'build', status: 'success'}], sources = [liveSource()], hourKey}) {
  return {id: String(id), type, status, finishedAt, startedAt: finishedAt, dedupeKey: type === 'full' ? `full:${day}` : (hourKey || `hourly:${day}T10`), publication, steps, sourcesChecked: sources};
}
function ledgerOf(...records) {
  const sorted = records.slice().sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
  return {lastUpdate: sorted[0], lastFull: sorted.find(r => r.type === 'full'), history: sorted};
}
const decide = (opts) => policy.decideUpdateType({event: 'schedule', ...opts});

// ---------------------------------------------------------------------------
// Daily full: delayed cron, missed cron, compensation and its bounds
// ---------------------------------------------------------------------------
test('delayed daily cron (fires six hours late) still runs the full update once', () => {
  const d = decide({schedule: FULL_CRON, ledger: ledgerOf(), now: at('2026-10-08T08:13:00Z')});
  assert.equal(d.type, 'full'); assert.equal(d.run, true); assert.equal(d.compensation, false); assert.equal(d.reason, 'daily-full-cron');
});

test('missed daily cron is compensated by the next scheduled run after 05:00 Istanbul', () => {
  const d = decide({schedule: HOURLY_CRON, ledger: ledgerOf(), now: at('2026-10-08T08:29:00Z')});
  assert.equal(d.type, 'full'); assert.equal(d.compensation, true); assert.equal(d.reason, 'compensation-missed-daily');
});

test('no full update starts before the 05:00 Istanbul target', () => {
  for (const iso of ['2026-10-07T21:07:00Z', '2026-10-08T01:51:00Z', '2026-10-08T01:59:00Z']) {
    const d = decide({schedule: HOURLY_CRON, ledger: ledgerOf(), now: at(iso)});
    assert.equal(d.type, 'hourly', iso); assert.equal(d.reason, 'before-daily-target');
  }
  assert.equal(decide({schedule: HOURLY_CRON, ledger: ledgerOf(), now: at('2026-10-08T02:07:00Z')}).type, 'full');
});

test('a verified full update is never repeated, even if the daily cron arrives late', () => {
  const done = ledgerOf(record({id: 1, finishedAt: '2026-10-08T06:00:00Z'}));
  const late = decide({schedule: FULL_CRON, ledger: done, now: at('2026-10-08T08:13:00Z')});
  assert.equal(late.type, 'hourly'); assert.equal(late.reason, 'full-already-verified-today');
  assert.equal(decide({schedule: HOURLY_CRON, ledger: done, now: at('2026-10-08T09:07:00Z')}).type, 'hourly');
});

test('previous-day success does not satisfy today; the Istanbul day rolls at 21:00 UTC', () => {
  const yesterday = ledgerOf(record({id: 1, day: '2026-10-07', finishedAt: '2026-10-07T07:00:00Z'}));
  assert.equal(decide({schedule: HOURLY_CRON, ledger: yesterday, now: at('2026-10-08T03:07:00Z')}).type, 'full');
  const d = decide({schedule: HOURLY_CRON, ledger: yesterday, now: at('2026-10-07T22:07:00Z')});
  assert.equal(d.day, '2026-10-08'); assert.equal(d.type, 'hourly');
});

test('failed attempt is not "today done"; retry waits for the cool-down and is capped per day', () => {
  const failed = record({id: 1, status: 'failed', publication: {state: 'failed'}, steps: [{id: 'full-static-build', kind: 'build', status: 'failed'}], finishedAt: '2026-10-08T09:06:00Z'});
  const ledger = ledgerOf(failed);
  assert.equal(policy.fullDayState(ledger, '2026-10-08').complete, false);
  assert.equal(decide({schedule: HOURLY_CRON, ledger, now: at('2026-10-08T10:07:00Z')}).reason, 'full-retry-cooldown');
  const retry = decide({schedule: HOURLY_CRON, ledger, now: at(new Date(at('2026-10-08T09:06:00Z') + L.FULL_RETRY_COOLDOWN_MS + 60000).toISOString())});
  assert.equal(retry.type, 'full'); assert.equal(retry.reason, 'compensation-retry');
  const second = record({id: 2, status: 'failed', publication: {state: 'failed'}, finishedAt: '2026-10-08T13:20:00Z', steps: [{id: 'full-static-build', kind: 'build', status: 'failed'}]});
  const capped = decide({schedule: HOURLY_CRON, ledger: ledgerOf(failed, second), now: at('2026-10-08T18:07:00Z')});
  assert.equal(capped.type, 'hourly'); assert.equal(capped.reason, 'full-attempts-exhausted');
  assert.equal(decide({schedule: FULL_CRON, ledger: ledgerOf(failed, second), now: at('2026-10-08T18:07:00Z')}).type, 'hourly');
});

test('compensation never starts late in the Istanbul evening', () => {
  const d = decide({schedule: HOURLY_CRON, ledger: ledgerOf(), now: at('2026-10-08T20:07:00Z')}); // 23:07 TR
  assert.equal(d.type, 'hourly'); assert.equal(d.reason, 'past-last-full-start-hour');
});

test('double execution: the same Istanbul hour is not repeated; manual runs honour the operator', () => {
  const hour = record({id: 5, type: 'hourly', finishedAt: '2026-10-08T07:12:00Z', hourKey: 'hourly:2026-10-08T10'});
  const done = ledgerOf(record({id: 1, finishedAt: '2026-10-08T06:00:00Z'}), hour);
  const dup = decide({schedule: HOURLY_CRON, ledger: done, now: at('2026-10-08T07:40:00Z')});
  assert.equal(dup.run, false); assert.equal(dup.reason, 'hourly-already-done-this-hour');
  assert.equal(decide({schedule: HOURLY_CRON, ledger: done, now: at('2026-10-08T08:07:00Z')}).run, true);
  const manual = policy.decideUpdateType({event: 'workflow_dispatch', requestedType: 'full', ledger: done, now: at('2026-10-08T07:40:00Z')});
  assert.equal(manual.type, 'full'); assert.equal(manual.run, true);
  assert.equal(policy.decideUpdateType({event: 'workflow_dispatch', requestedType: 'hourly', ledger: done, now: at('2026-10-08T07:40:00Z')}).type, 'hourly');
});

test('queued daily and hourly runs: a displaced daily run is recovered by the next hourly run', () => {
  // GitHub keeps one pending run per group. Simulate: the 02:00 UTC full cron was
  // replaced in the queue; the next hourly cron starts at 08:07 UTC and becomes the full.
  let ledger = ledgerOf(record({id: 9, type: 'hourly', finishedAt: '2026-10-08T01:46:00Z', hourKey: 'hourly:2026-10-08T04'}));
  const next = decide({schedule: HOURLY_CRON, ledger, now: at('2026-10-08T08:07:00Z')});
  assert.equal(next.type, 'full'); assert.equal(next.compensation, true);
  // A newer pending hourly after that one is a plain hourly again.
  ledger = ledgerOf(record({id: 10, finishedAt: '2026-10-08T09:00:00Z'}));
  assert.equal(decide({schedule: HOURLY_CRON, ledger, now: at('2026-10-08T09:07:00Z')}).type, 'hourly');
});

// ---------------------------------------------------------------------------
// Completion rules: partial, publication, commit/push failure
// ---------------------------------------------------------------------------
test('partial caused by optional sources or QA counts; partial with a failed critical step does not', () => {
  const optional = record({id: 1, status: 'partial', finishedAt: '2026-10-08T06:00:00Z', steps: [{id: 'football-news', kind: 'source', status: 'failed'}, {id: 'qa', kind: 'validation', status: 'failed'}, {id: 'full-static-build', kind: 'build', status: 'success'}]});
  assert.equal(policy.assessCompletion(optional).verified, true);
  for (const [name, bad] of Object.entries({
    build: record({id: 2, status: 'partial', finishedAt: '2026-10-08T06:00:00Z', steps: [{id: 'full-static-build', kind: 'build', status: 'failed'}]}),
    validation: record({id: 3, status: 'partial', finishedAt: '2026-10-08T06:00:00Z', steps: [{id: 'validate-fixtures', kind: 'validation', status: 'failed'}]}),
    liveFixtures: record({id: 4, status: 'partial', finishedAt: '2026-10-08T06:00:00Z', sources: [liveSource({status: 'failed'})]}),
    quotaSkipped: record({id: 5, status: 'partial', finishedAt: '2026-10-08T06:00:00Z', sources: [liveSource({status: 'skipped'})]}),
    degraded: record({id: 6, status: 'partial', finishedAt: '2026-10-08T06:00:00Z', sources: [liveSource({summary: {degraded: true}})]}),
    noLiveSource: record({id: 7, status: 'partial', finishedAt: '2026-10-08T06:00:00Z', sources: []})
  })) {
    const result = policy.assessCompletion(bad);
    assert.equal(result.verified, false, name);
    assert.equal(policy.fullDayState(ledgerOf(bad), '2026-10-08').complete, false, name);
  }
});

test('commit/push failure: outcome is recorded as failed and never counts as the daily full', () => {
  const pending = record({id: 77, status: 'success', publication: {required: true, state: 'awaiting-deployment'}, finishedAt: '2026-10-08T09:00:00Z'});
  const base = {...ledgerOf(pending), lastVerifiedFull: undefined};
  assert.equal(policy.fullDayState(base, '2026-10-08').complete, false, 'awaiting-deployment is not yet published');
  const failed = finalize(base, {runId: '77', outcome: 'failure', commit: 'abc'});
  assert.equal(failed.lastUpdate.status, 'failed'); assert.equal(failed.lastUpdate.publication.state, 'failed');
  assert.equal(failed.lastVerifiedFull, undefined);
  assert.equal(policy.fullDayState(failed, '2026-10-08').complete, false);
  const skipped = finalize(base, {runId: '77', outcome: 'skipped', commit: 'abc'});
  assert.equal(skipped.lastUpdate.publication.state, 'failed');
  const ok = finalize(base, {runId: '77', outcome: 'success', commit: 'abc'});
  assert.equal(ok.lastVerifiedFull.id, '77'); assert.equal(policy.fullDayState(ok, '2026-10-08').complete, true);
  // After a failed push the next eligible run retries (bounded), instead of treating the day as done.
  assert.equal(decide({schedule: HOURLY_CRON, ledger: failed, now: at('2026-10-08T13:07:00Z')}).type, 'full');
});

test('unchanged content is a verified outcome without a commit', () => {
  const unchanged = record({id: 3, publication: {required: false, state: 'unchanged'}, finishedAt: '2026-10-08T06:00:00Z'});
  assert.equal(policy.fullDayState(ledgerOf(unchanged), '2026-10-08').complete, true);
});

// ---------------------------------------------------------------------------
// Scheduler / daily-full / freshness classification
// ---------------------------------------------------------------------------
const run = (id, status, conclusion, iso, extra = {}) => ({id, status, conclusion, created_at: iso, updated_at: iso, run_started_at: iso, html_url: `https://example.invalid/runs/${id}`, ...extra});
test('scheduler: running, delayed, missed, failed, stuck and queued are distinguished', () => {
  const now = at('2026-10-08T08:00:00Z');
  const iso = (hoursAgo) => new Date(now - hoursAgo * 3600000).toISOString();
  assert.equal(policy.assessScheduler([run(1, 'completed', 'success', iso(1))], now).level, 'ok');
  const delayed = policy.assessScheduler([run(1, 'completed', 'success', iso(6.2))], now);
  assert.equal(delayed.level, 'warning'); assert.equal(delayed.code, 'scheduler-delayed');
  const missed = policy.assessScheduler([run(1, 'completed', 'success', iso(13))], now);
  assert.equal(missed.level, 'critical'); assert.equal(missed.code, 'scheduler-missed');
  // An in-progress newest run does not hide an older failure or success.
  const runningOverFailure = policy.assessScheduler([run(3, 'in_progress', null, iso(0.2)), run(2, 'completed', 'failure', iso(2)), run(1, 'completed', 'success', iso(5))], now);
  assert.equal(runningOverFailure.code, 'scheduler-failed');
  const recovered = policy.assessScheduler([run(3, 'completed', 'success', iso(0.5)), run(2, 'completed', 'failure', iso(2))], now);
  assert.equal(recovered.level, 'ok');
  assert.equal(policy.assessScheduler([run(3, 'in_progress', null, iso(2))], now).code, 'scheduler-stuck');
  assert.equal(policy.assessScheduler([run(2, 'queued', null, iso(1.5)), run(1, 'completed', 'success', iso(1.6))], now).code, 'scheduler-queue-delayed');
  assert.equal(policy.assessScheduler([run(2, 'completed', 'cancelled', iso(1)), run(1, 'completed', 'success', iso(1.5))], now).level, 'ok');
  assert.equal(policy.assessScheduler([], now).code, 'scheduler-missing');
});

test('daily full health: waiting, late, exhausted and overdue are different severities', () => {
  const done = ledgerOf(record({id: 1, finishedAt: '2026-10-08T06:00:00Z'}));
  assert.equal(policy.assessFullDaily(done, at('2026-10-08T08:00:00Z')).level, 'ok');
  const yesterday = ledgerOf(record({id: 1, day: '2026-10-07', finishedAt: '2026-10-07T07:00:00Z'}));
  assert.equal(policy.assessFullDaily(yesterday, at('2026-10-08T03:00:00Z')).level, 'info');           // 06:00 TR, within grace
  const late = policy.assessFullDaily(yesterday, at('2026-10-08T08:00:00Z'));                          // 11:00 TR
  assert.equal(late.level, 'warning'); assert.equal(late.code, 'full-update-late');
  const failedOnce = ledgerOf(record({id: 1, day: '2026-10-07', finishedAt: '2026-10-07T07:00:00Z'}), record({id: 2, status: 'failed', publication: {state: 'failed'}, finishedAt: '2026-10-08T06:00:00Z'}));
  assert.equal(policy.assessFullDaily(failedOnce, at('2026-10-08T08:00:00Z')).level, 'warning');
  const failedTwice = ledgerOf(record({id: 1, day: '2026-10-07', finishedAt: '2026-10-07T07:00:00Z'}), record({id: 2, status: 'failed', publication: {state: 'failed'}, finishedAt: '2026-10-08T06:00:00Z'}), record({id: 3, status: 'failed', publication: {state: 'failed'}, finishedAt: '2026-10-08T09:30:00Z'}));
  assert.equal(policy.assessFullDaily(failedTwice, at('2026-10-08T12:00:00Z')).code, 'full-update-failed');
  const stale = policy.assessFullDaily(ledgerOf(record({id: 1, day: '2026-10-04', finishedAt: '2026-10-04T08:48:00Z'})), at('2026-10-08T08:00:00Z'));
  assert.equal(stale.code, 'full-update-overdue'); assert.equal(stale.level, 'critical');
  assert.equal(policy.assessFullDaily({}, at('2026-10-08T08:00:00Z')).code, 'full-update-overdue');
});

test('fixture freshness: a fresh live API never hides stale static data, only changes severity', () => {
  const H = 3600000;
  assert.equal(policy.assessFixtureFreshness({staticAgeMs: 1 * H, runtimeFresh: true}).level, 'ok');
  const warn = policy.assessFixtureFreshness({staticAgeMs: 6.4 * H, runtimeFresh: true});
  assert.equal(warn.level, 'warning'); assert.equal(warn.code, 'fixtures-static-delayed');
  assert.equal(policy.assessFixtureFreshness({staticAgeMs: 4 * H, runtimeFresh: false}).code, 'fixtures-stale');
  assert.equal(policy.assessFixtureFreshness({staticAgeMs: 13 * H, runtimeFresh: true}).level, 'critical');
  assert.equal(policy.assessFixtureFreshness({staticAgeMs: NaN, runtimeFresh: true}).level, 'critical');
});

test('fixture day: midnight rollover with a fresh live API is a delay, not an outage', () => {
  const H = 3600000;
  const base = {sourceDay: '2026-10-14', today: '2026-10-15'};
  assert.equal(policy.assessFixtureDay({sourceDay: '2026-10-15', today: '2026-10-15', staticAgeMs: 30 * H, runtimeFresh: false}).level, 'ok');
  assert.equal(policy.assessFixtureDay({...base, staticAgeMs: 3.3 * H, runtimeFresh: true}).code, 'fixture-day-rollover');
  assert.equal(policy.assessFixtureDay({...base, staticAgeMs: 3.3 * H, runtimeFresh: false}).code, 'wrong-fixture-day');
  assert.equal(policy.assessFixtureDay({...base, staticAgeMs: 13 * H, runtimeFresh: true}).code, 'wrong-fixture-day');
  assert.equal(policy.assessFixtureDay({...base, staticAgeMs: NaN, runtimeFresh: true}).code, 'wrong-fixture-day');
});

test('per-source freshness: a green run cannot hide a source that silently stopped', () => {
  const H = 3600000, now = Date.parse('2026-10-16T18:00:00Z');
  const ago = (h) => ({lastSuccessfulAt: new Date(now - h * H).toISOString()});
  assert.equal(policy.assessSourceFreshness('standings', ago(1), now).level, 'ok');
  assert.equal(policy.assessSourceFreshness('standings', ago(7), now).code, 'source-stale-standings');
  assert.equal(policy.assessSourceFreshness('standings', ago(7), now).level, 'warning');
  assert.equal(policy.assessSourceFreshness('standings', ago(25), now).level, 'critical');
  // News and the weekly-ish calendar never turn the job red on their own.
  assert.equal(policy.assessSourceFreshness('football-news', ago(200), now).level, 'warning');
  const cal = policy.assessSourceFreshness('fixture-calendar', {...ago(36), error: 'Timed out after 480000ms'}, now);
  assert.equal(cal.level, 'warning'); assert.match(cal.detail, /Timed out/);
  assert.equal(policy.assessSourceFreshness('standings', {}, now).code, 'source-unknown-standings');
  assert.equal(policy.assessSourceFreshness('standings', undefined, now).level, 'ok');
  assert.equal(policy.assessSourceFreshness('unlisted', ago(999), now).level, 'ok');
});

// ---------------------------------------------------------------------------
// Monitor scenarios (fake GitHub + fake HTTP)
// ---------------------------------------------------------------------------
function sandbox({ledger, calendar, restored = true}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-sched-'));
  for (const p of ['data', 'outputs/operations', 'mac']) fs.mkdirSync(path.join(dir, p), {recursive: true});
  const w = (f, v) => fs.writeFileSync(path.join(dir, f), JSON.stringify(v));
  w('data/fixture-calendar.json', calendar); w('data/matches.json', []); w('data/match-seo-pages.json', {pages: [{path: 'mac/example.html'}]});
  w('data/update-status.json', ledger);
  if (restored) w('outputs/operations/update-status.json', ledger);
  return dir;
}
function fakeGithub({runs, deployment = {context: 'Vercel', state: 'success'}, codeConclusion = 'success', now}) {
  return (url) => url.includes('interaction-checks') ? {workflow_runs: [run(900, 'completed', codeConclusion, new Date(now).toISOString())]}
    : url.includes('/runs?') ? {workflow_runs: runs}
    : url.endsWith('/status') ? {statuses: [deployment]} : {sha: 'a'.repeat(40)};
}
function fakeFetcher({calendar, api}) {
  return async (url) => ({
    json: async () => url.includes('/api/matches') ? api : url.includes('fixture-calendar') ? calendar : [],
    text: async () => '<html><link rel="canonical"><body>FutbolRadar</body></html>'
  });
}
const goodApi = {ok: true, data: [{id: 1}], updatedAt: '2026-10-08T08:00:00Z', meta: {freshness: {stale: false}}};
function healthyWorld(now) {
  const iso = (min) => new Date(now - min * 60000).toISOString();
  const calendar = {fetchedAt: iso(400), fixtureHealth: {date: '2026-10-08', lastSuccessfulSyncAt: iso(400)}, matches: [{id: 'm1', homeTeam: 'A', awayTeam: 'B'}]};
  const full = record({id: 11, finishedAt: iso(120)});
  const hourly = record({id: 12, type: 'hourly', finishedAt: iso(10), publication: {state: 'unchanged'}, sources: [liveSource({summary: {degraded: false, lastSuccessfulSyncAt: iso(10)}})]});
  const ledger = {...ledgerOf(full, hourly), lastVerifiedFull: full};
  return {calendar, ledger, iso};
}

test('current but unchanged data: a successful private observation keeps freshness green without a new commit', async () => {
  const now = at('2026-10-08T08:30:00Z'), {calendar, ledger, iso} = healthyWorld(now);
  const dir = sandbox({ledger, calendar});
  const report = await monitor({root: dir, now, github: fakeGithub({runs: [run(1, 'completed', 'success', iso(20))], now}), fetcher: fakeFetcher({calendar, api: goodApi})});
  assert.deepEqual(report.issues, []); assert.deepEqual(report.warnings, []); assert.equal(report.status, 'ok');
});

test('GitHub dropping hourly schedules is a warning, not a red failure, while data is still live', async () => {
  const now = at('2026-10-08T08:30:00Z'), {calendar, ledger, iso} = healthyWorld(now);
  const dir = sandbox({ledger, calendar});
  const report = await monitor({root: dir, now, github: fakeGithub({runs: [run(1, 'completed', 'success', iso(6.2 * 60))], now}), fetcher: fakeFetcher({calendar, api: goodApi})});
  assert.deepEqual(report.issues, []);
  assert(report.warnings.includes('scheduler-delayed')); assert.equal(report.status, 'delayed');
});

test('API outage / quota exhaustion / degraded runtime response stay visible as critical', async () => {
  const now = at('2026-10-08T08:30:00Z'), {calendar, ledger, iso} = healthyWorld(now);
  const quota = {...ledger, lastUpdate: {...ledger.lastUpdate, sourcesChecked: [liveSource({status: 'failed', providerCode: 'PROVIDER_RATE_LIMIT'})]}};
  const dir = sandbox({ledger: quota, calendar});
  const degraded = {ok: false, data: [], error: {code: 'PROVIDER_RATE_LIMIT'}, meta: {degraded: true}};
  const report = await monitor({root: dir, now, github: fakeGithub({runs: [run(1, 'completed', 'success', iso(20))], now}), fetcher: fakeFetcher({calendar, api: degraded})});
  assert(report.issues.includes('provider-PROVIDER_RATE_LIMIT')); assert(report.issues.includes('runtime-api-degraded')); assert.equal(report.status, 'attention');
  const down = await monitor({root: dir, now, github: fakeGithub({runs: [], now}), fetcher: async (u) => { if (u.includes('/api/matches')) throw new Error('503'); return fakeFetcher({calendar, api: goodApi})(u); }});
  assert(down.issues.includes('runtime-api-unavailable')); assert(down.issues.includes('scheduler-missing'));
});

test('verified empty match day is healthy; the same empty answer from a degraded API is not', async () => {
  const now = at('2026-10-08T08:30:00Z'), {calendar, ledger, iso} = healthyWorld(now);
  const dir = sandbox({ledger, calendar});
  const github = fakeGithub({runs: [run(1, 'completed', 'success', iso(20))], now});
  const empty = {ok: true, data: [], meta: {freshness: {stale: true}, fixtureHealth: {state: 'empty-confirmed'}}};
  assert.deepEqual((await monitor({root: dir, now, github, fetcher: fakeFetcher({calendar, api: empty})})).issues, []);
  const broken = {ok: true, data: [], meta: {degraded: true, freshness: {stale: true}, fixtureHealth: {state: 'degraded'}}};
  assert((await monitor({root: dir, now, github, fetcher: fakeFetcher({calendar, api: broken})})).issues.includes('runtime-api-degraded'));
});

test('corrupt published data is reported as unavailable/mismatch, not as a healthy publication', async () => {
  const now = at('2026-10-08T08:30:00Z'), {calendar, ledger, iso} = healthyWorld(now);
  const dir = sandbox({ledger, calendar});
  const github = fakeGithub({runs: [run(1, 'completed', 'success', iso(20))], now});
  const corrupt = await monitor({root: dir, now, github, fetcher: fakeFetcher({calendar: {matches: 'not-an-array'}, api: goodApi})});
  assert(corrupt.issues.includes('unavailable-fixture-calendar.json'));
});

test('publication delay: pending deployment is tolerated for 45 minutes, a mismatch afterwards is critical', async () => {
  const now = at('2026-10-08T08:30:00Z'), {calendar, ledger, iso} = healthyWorld(now);
  const dir = sandbox({ledger, calendar});
  const stale = {...calendar, matches: [{id: 'old', homeTeam: 'A', awayTeam: 'B'}]};
  const mk = (minutes) => fakeGithub({runs: [run(1, 'completed', 'success', iso(20))], deployment: {context: 'Vercel', state: 'pending', created_at: iso(minutes)}, now});
  assert(!(await monitor({root: dir, now, github: mk(20), fetcher: fakeFetcher({calendar: stale, api: goodApi})})).issues.includes('publication-fixture-calendar.json'));
  assert((await monitor({root: dir, now, github: mk(60), fetcher: fakeFetcher({calendar: stale, api: goodApi})})).issues.includes('publication-fixture-calendar.json'));
});

test('stale static fixtures while the live API is fresh: warning first, critical past the measured worst-case gap', async () => {
  const now = at('2026-10-08T08:30:00Z'), {ledger, iso} = healthyWorld(now);
  const noObservation = {...ledger, lastUpdate: {...ledger.lastUpdate, publication: {state: 'failed'}}};
  const staleCalendar = (min) => ({fetchedAt: iso(min), fixtureHealth: {date: '2026-10-08', lastSuccessfulSyncAt: iso(min)}, matches: [{id: 'm1', homeTeam: 'A', awayTeam: 'B'}]});
  const run1 = [run(1, 'completed', 'success', iso(20))];
  const a = await monitor({root: sandbox({ledger: noObservation, calendar: staleCalendar(383)}), now, github: fakeGithub({runs: run1, now}), fetcher: fakeFetcher({calendar: staleCalendar(383), api: goodApi})});
  assert(a.warnings.includes('fixtures-static-delayed')); assert(!a.issues.includes('fixtures-stale'));
  const b = await monitor({root: sandbox({ledger: noObservation, calendar: staleCalendar(13 * 60)}), now, github: fakeGithub({runs: run1, now}), fetcher: fakeFetcher({calendar: staleCalendar(13 * 60), api: goodApi})});
  assert(b.issues.includes('fixtures-stale'));
});

test('code-test CI failures are reported separately and never make operations red', async () => {
  const now = at('2026-10-08T08:30:00Z'), {calendar, ledger, iso} = healthyWorld(now);
  const dir = sandbox({ledger, calendar});
  const report = await monitor({root: dir, now, github: fakeGithub({runs: [run(1, 'completed', 'success', iso(20))], codeConclusion: 'failure', now}), fetcher: fakeFetcher({calendar, api: goodApi})});
  assert.deepEqual(report.issues, []); assert.equal(report.codeChecks.state, 'failing'); assert(report.warnings.includes('code-checks-failing'));
});

test('daily full overdue and failed publication stay critical (no silent pass)', async () => {
  const now = at('2026-10-08T08:30:00Z'), {calendar, iso} = healthyWorld(now);
  const old = record({id: 1, day: '2026-10-04', finishedAt: '2026-10-04T08:48:00Z'});
  const ledger = {...ledgerOf(old, record({id: 2, type: 'hourly', status: 'failed', publication: {state: 'failed'}, finishedAt: iso(10)})), lastVerifiedFull: old};
  const report = await monitor({root: sandbox({ledger, calendar}), now, github: fakeGithub({runs: [run(1, 'completed', 'success', iso(20))], now}), fetcher: fakeFetcher({calendar, api: goodApi})});
  assert(report.issues.includes('full-update-overdue')); assert(report.issues.includes('writer-publication-failed'));
});

// ---------------------------------------------------------------------------
// Planner CLI and workflow wiring
// ---------------------------------------------------------------------------
test('planner reads the restored ledger and writes the real type to GITHUB_OUTPUT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-plan-'));
  fs.mkdirSync(path.join(dir, 'outputs/operations'), {recursive: true}); fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'outputs/operations/update-status.json'), JSON.stringify(ledgerOf()));
  const d = plan({root: dir, now: at('2026-10-08T08:29:00Z'), env: {GITHUB_EVENT_NAME: 'schedule', SCHEDULE: HOURLY_CRON}});
  assert.equal(d.type, 'full'); assert.equal(d.compensation, true);
  const out = path.join(dir, 'gh-output');
  execFileSync(process.execPath, [path.resolve('scripts/plan-scheduled-update.mjs')], {cwd: dir, env: {...process.env, GITHUB_OUTPUT: out, GITHUB_EVENT_NAME: 'workflow_dispatch', MANUAL_TYPE: 'hourly', SCHEDULE: ''}});
  assert.match(fs.readFileSync(out, 'utf8'), /type=hourly\nrun=true/);
});

test('workflow: dependencies and Playwright follow the planned type, not the first cron event', () => {
  const wf = fs.readFileSync('.github/workflows/match-analysis.yml', 'utf8').replace(/\r\n/g, '\n');
  const idx = (needle) => wf.indexOf(needle);
  assert(idx('id: plan') > 0 && idx('id: plan') < idx('npm ci --include=dev'), 'plan precedes dependency installation');
  assert(idx('restore-operations-ledger.mjs') < idx('id: plan'), 'ledger restored before planning');
  assert.match(wf, /Install validation browser\n\s+if: steps\.plan\.outputs\.run == 'true' && steps\.plan\.outputs\.type == 'full'/);
  assert.doesNotMatch(wf, /Install validation browser[\s\S]{0,120}github\.event\.schedule/);
  assert.match(wf, /UPDATE_TYPE: \$\{\{ steps\.plan\.outputs\.type \}\}/);
});

test('unavailable shared daily lock exits 1 and is saved as a non-public failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-lock-cli-'));
  try {
    const result = spawnSync(process.execPath,[path.resolve('scripts/run-scheduled-update.mjs'),'--type=full','--ci-guard'], {
      cwd:dir, env:{GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'schedule',GITHUB_REPOSITORY:'ugursivrikaya22/futbolradar',
        FUTBOLRADAR_AUTOMATION_TOKEN:'fake-local-test',GITHUB_RUN_ID:'123'},encoding:'utf8'
    });
    assert.equal(result.status,1,result.stderr);
    assert.match(result.stdout,/Shared cron lock is not configured/);
    const ledger = JSON.parse(fs.readFileSync(path.join(dir,'outputs/operations/update-status.json'),'utf8'));
    assert.equal(ledger.lastFull.status,'failed');
    assert.equal(ledger.lastFull.errors[0].step,'shared-full-lock');
    assert.equal(fs.existsSync(path.join(dir,'data/update-status.json')),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('a blocked scheduled full backup fails, but a completed hourly owner is a harmless skip', async () => {
  const env={GITHUB_EVENT_NAME:'schedule'};
  let hydrates=0;
  const run=(type,status)=>claimSharedRunLock({type},'key',env,{
    configured:true,
    hydrate:async()=>{hydrates++;},
    store:{
      claimGithubFullRun:async()=>({acquired:false,row:{runner:'vercel',status}}),
      acquireRun:async()=>({acquired:false,row:{runner:'vercel',status}})
    }
  });
  for(const status of ['running','complete','failed','skipped']) {
    const result=await run('full',status);
    assert.equal(result.skip,true); assert.equal(result.failed,true);
    assert.match(result.reason,new RegExp(status));
  }
  const hourly=await run('hourly','complete');
  assert.equal(hourly.skip,true); assert.equal(hourly.failed,false);
  assert.equal(hydrates,0);
});

test('daily lock completion needs the same run/key and verified publication', async () => {
  const calls=[];
  const key='full:2026-10-08';
  const store={updateOwnedRun:async (args)=>{calls.push(args);return true;}};
  const owner={key,startedAt:'2026-10-08T02:00:00Z',runId:'77',now:'2026-10-08T02:05:00Z',store};
  const good=record({id:77,publication:{state:'committed'},finishedAt:owner.now});
  await settleFullLock({lastUpdate:good},{...owner,outcome:'success'});
  assert.deepEqual(calls.at(-1),{key,startedAt:owner.startedAt,runner:'github-actions',patch:{status:'complete',finished_at:owner.now}});
  await settleFullLock({lastUpdate:good},{...owner,outcome:'failure'});
  assert.equal(calls.at(-1).patch.status,'failed');
  await assert.rejects(settleFullLock({lastUpdate:{...good,dedupeKey:'full:2026-10-07'}},{...owner,outcome:'success'}),/no verified completion/);
  assert.equal(calls.at(-1).patch.status,'failed');
  await assert.rejects(settleFullLock({lastUpdate:good},{...owner,store:{updateOwnedRun:async()=>false},outcome:'success'}),/Could not finalize/);
});

test('workflow: shared write lock is kept and critical failures reach the final result', () => {
  const wf = fs.readFileSync('.github/workflows/match-analysis.yml', 'utf8').replace(/\r\n/g, '\n');
  assert.match(wf, /group: site-yuku\r?\n\s+cancel-in-progress: false/);
  assert.equal((wf.match(/continue-on-error: true/g) || []).length, 1, 'only the pipeline step defers its failure');
  assert.match(wf, /name: Fail workflow after status capture\n\s+if: always\(\) && steps\.update\.outcome == 'failure'[\s\S]*?run: exit 1/);
  assert.doesNotMatch(wf, /\|\|\s*true|exit 0/);
  const publication = wf.match(/id: publication[\s\S]*?(?=\n      - name:)/)[0];
  assert.doesNotMatch(publication, /continue-on-error/, 'a failed commit/push fails the job');
  const health = fs.readFileSync('.github/workflows/daily-health-check.yml', 'utf8');
  assert.doesNotMatch(health, /continue-on-error|\|\|\s*true|exit 0/);
  const other = ['broadcast-schedule', 'english-news', 'sporx-news-discovery', 'trabzonspor-post-match-column']
    .every(n => /group: site-yuku/.test(fs.readFileSync(`.github/workflows/${n}.yml`, 'utf8')));
  assert(other, 'every production writer shares the lock');
});

test('monitor CLI contract: operational issues exit 1, warnings alone do not', () => {
  const src = fs.readFileSync('scripts/monitor-operations.mjs', 'utf8');
  assert.match(src, /if\(report\.issues\.length\) process\.exitCode=1;/);
  assert.doesNotMatch(src, /warnings\.length\) process\.exitCode/);
});
