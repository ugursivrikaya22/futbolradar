// Shared, deterministic policy. No network, credentials or writes.
const crypto = require('node:crypto');
const OBSERVATION_KEYS = new Set(['fetchedAt','checkedAt','lastCheckedAt','lastAttemptAt','lastSuccessfulSyncAt','lastSuccessfulBackupSyncAt','syncedAt','generatedAt','updatedAt','observedAt','staleAfter','durationMs','requestCount','requestFailures','rateLimit','fixtureHealth','lastSync','lastFetchAt']);
const STOP_CODES = new Set(['PROVIDER_RATE_LIMIT','PROVIDER_AUTH_ERROR','PROVIDER_PLAN_ERROR','PROVIDER_ACCOUNT_SUSPENDED','PROVIDER_CREDENTIAL_NOT_SENT','PROVIDER_CONFIG_MISSING']);
const OPTIONAL = new Set(['fixture-predictions','competition-leaders','injuries-suspensions','football-news','english-news','manager-quotes','provider-identities','weekly-player-enrichment','weekly-photo-validation','international-opponents','refetch-finished','superlig-rating-backfill','featured-match-context']);
function semantic(value) {
  if (Array.isArray(value)) return value.map(semantic);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(k => !OBSERVATION_KEYS.has(k)).map(k => [k, semantic(value[k])]));
}
function version(value) { return crypto.createHash('sha256').update(JSON.stringify(semantic(value))).digest('hex'); }
function modeFor({requested='normal', rateLimit, code, now=Date.now()}={}) {
  if (STOP_CODES.has(code)) return 'protected';
  const fresh = rateLimit && Date.parse(rateLimit.observedAt) >= now - 24*3600000;
  if (fresh && Number.isFinite(rateLimit.remaining) && Number.isFinite(rateLimit.limit) && rateLimit.limit>0) {
    if (rateLimit.remaining <= 0) return 'protected';
    if (rateLimit.remaining/rateLimit.limit < 0.15) return requested==='protected' ? 'protected' : 'saving';
  }
  return ['normal','saving','protected'].includes(requested) ? requested : 'normal';
}
function skipReason(spec, mode, code) {
  if (mode==='protected' && spec.source==='api-football') return `Protected mode: ${code || 'operator policy'}; provider calls stopped.`;
  if (mode!=='normal' && OPTIONAL.has(spec.id)) return `Optional work deferred in ${mode} mode; core fixtures have priority.`;
  return null;
}
function istanbulDay(value=Date.now()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)); }
function assessRun(run, now=Date.now()) {
  if (!run) return 'missing';
  if (run.status!=='completed' && now-Date.parse(run.run_started_at||run.created_at)>95*60000) return 'stuck';
  if (now-Date.parse(run.created_at)>3*3600000) return 'missed';
  if (run.status==='completed' && !['success','skipped'].includes(run.conclusion)) return 'failed';
  return run.status==='completed' ? 'ok' : 'running';
}

// ---------------------------------------------------------------------------
// Daily full update: persistent-state based planning and completion rules.
//
// Everything below is deterministic: no clock, network or file access. Callers
// pass `now` and the restored operations ledger, so the decisions are testable
// with a controlled clock and fake ledgers.
// ---------------------------------------------------------------------------

const HOUR = 3600000;
const FULL_TARGET_HOUR = 5;            // 05:00 Europe/Istanbul (cron 0 2 * * * UTC)
const FULL_LAST_START_HOUR = 22;       // no compensation start after 22:59 local
const FULL_MAX_ATTEMPTS_PER_DAY = 2;   // primary + one retry/compensation
const FULL_RETRY_COOLDOWN_MS = 3 * HOUR;
const FULL_GRACE_MS = 4 * HOUR;        // measured: delayed daily cron starts ~08:00 UTC (11:00 TR)
const FULL_OVERDUE_MS = 36 * HOUR;
// Measured on 90 scheduled runs (2026-09-24..10-08): median gap 3.5 h, p90 7.1 h, max 9.1 h.
const SCHEDULER_DELAY_WARN_MS = 3 * HOUR;
const SCHEDULER_MISSED_MS = 12 * HOUR;
const STATIC_FIXTURE_WARN_MS = 3 * HOUR;
const STATIC_FIXTURE_CRITICAL_MS = 12 * HOUR;
const RUN_STUCK_MS = 95 * 60000;
const RUN_QUEUE_WARN_MS = 60 * 60000;

function istanbulHour(value=Date.now()) {
  return Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',hour:'2-digit',hourCycle:'h23'}).format(new Date(value)));
}
function hourlyKey(value=Date.now()) { return `hourly:${istanbulDay(value)}T${String(istanbulHour(value)).padStart(2,'0')}`; }
function fullKey(value=Date.now()) { return `full:${istanbulDay(value)}`; }

const CRITICAL_SOURCE_IDS = new Set(['live-fixtures']);
const NON_BLOCKING_STEP_IDS = new Set(['qa']);

/**
 * "Verified" means every critical stage succeeded and the output reached
 * visitors (or provably needed no publication). `status: partial` caused only
 * by optional sources/QA still counts; a partial whose core fixture source,
 * validation or build failed (or was skipped) never does.
 */
function assessCompletion(record, {trustAwaitingDeployment=false}={}) {
  const reasons = [];
  if (!record) return {verified:false, reasons:['no-record']};
  if (!['success','partial'].includes(record.status)) reasons.push(`status-${record.status||'unknown'}`);
  const publication = record.publication;
  if (publication) {
    const ok = ['committed','unchanged'].includes(publication.state) || (trustAwaitingDeployment && publication.state==='awaiting-deployment');
    if (!ok) reasons.push(`publication-${publication.state||'unknown'}`);
  }
  for (const step of record.steps||[]) {
    const critical = (['build','validation'].includes(step.kind) && !NON_BLOCKING_STEP_IDS.has(step.id)) || CRITICAL_SOURCE_IDS.has(step.id);
    if (critical && step.status==='failed') reasons.push(`step-failed:${step.id}`);
  }
  for (const source of record.sourcesChecked||[]) {
    if (!CRITICAL_SOURCE_IDS.has(source.id)) continue;
    if (source.status!=='success') reasons.push(`source-${source.status}:${source.id}`);
    else if (source.summary?.degraded || source.summary?.status==='degraded') reasons.push(`source-degraded:${source.id}`);
  }
  if (record.type==='full' && !(record.sourcesChecked||[]).some(s=>s.id==='live-fixtures')) reasons.push('source-missing:live-fixtures');
  return {verified: reasons.length===0, reasons: [...new Set(reasons)]};
}

function ledgerRecords(ledger) {
  const seen = new Set(), out = [];
  for (const record of [ledger?.lastUpdate, ledger?.lastFull, ...(ledger?.history||[])]) {
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id); out.push(record);
  }
  return out;
}

/** State of the Istanbul-day full update, from persisted records only. */
function fullDayState(ledger, day, options={}) {
  const records = ledgerRecords(ledger).filter(r => r.type==='full' && r.status!=='skipped' && r.dedupeKey===`full:${day}`);
  const completed = records.find(r => assessCompletion(r, options).verified) || null;
  const attempts = records.filter(r => !String(r.id).endsWith('-duplicate'));
  const last = attempts.slice().sort((a,b)=>Date.parse(b.finishedAt||0)-Date.parse(a.finishedAt||0))[0] || null;
  return {
    day,
    complete: Boolean(completed),
    completedAt: completed?.finishedAt || null,
    attempts: attempts.length,
    lastAttemptAt: last?.finishedAt || null,
    lastAttemptStatus: last ? (last.status + (last.publication?.state ? '/' + last.publication.state : '')) : null
  };
}

function lastVerifiedFull(ledger, options={}) {
  if (ledger?.lastVerifiedFull) return ledger.lastVerifiedFull;
  return ledgerRecords(ledger).filter(r => r.type==='full' && assessCompletion(r, options).verified)
    .sort((a,b)=>Date.parse(b.finishedAt||0)-Date.parse(a.finishedAt||0))[0] || null;
}

/**
 * Decide what a workflow invocation must really run.
 *  - workflow_dispatch: honours the operator's choice (and --force).
 *  - schedule: the daily cron is "due" at 05:00 Istanbul, and so is any later
 *    scheduled run while the day's full update has no verified success. Compensation
 *    is bounded by attempts/day, a cool-down after the last attempt and a last
 *    start hour; before 05:00 local nothing full ever starts.
 */
function decideUpdateType({event, schedule='', requestedType='', force=false, ledger=null, now=Date.now(), trustAwaitingDeployment=false}={}) {
  const day = istanbulDay(now), hour = istanbulHour(now);
  const state = fullDayState(ledger, day, {trustAwaitingDeployment});
  const base = {day, hour, fullState: state};
  if (event==='workflow_dispatch') {
    const type = requestedType==='hourly' ? 'hourly' : 'full';
    return {...base, type, run:true, compensation:false, reason: `manual-${type}${force?'-forced':''}`};
  }
  const hourlyDone = ledgerRecords(ledger).some(r => r.type==='hourly' && r.dedupeKey===hourlyKey(now) && ['success','partial'].includes(r.status) && (!r.publication || ['committed','unchanged'].includes(r.publication.state)));
  const hourly = (reason) => hourlyDone
    ? {...base, type:'hourly', run:false, compensation:false, reason:'hourly-already-done-this-hour'}
    : {...base, type:'hourly', run:true, compensation:false, reason};
  const isFullCron = schedule==='0 2 * * *';
  if (state.complete) return hourly(isFullCron ? 'full-already-verified-today' : 'full-verified-today');
  if (!isFullCron && hour < FULL_TARGET_HOUR) return hourly('before-daily-target');
  if (hour > FULL_LAST_START_HOUR) return hourly('past-last-full-start-hour');
  if (state.attempts >= FULL_MAX_ATTEMPTS_PER_DAY) return hourly('full-attempts-exhausted');
  if (state.lastAttemptAt && now - Date.parse(state.lastAttemptAt) < FULL_RETRY_COOLDOWN_MS) {
    return hourly('full-retry-cooldown');
  }
  return {...base, type:'full', run:true, compensation: !isFullCron, reason: isFullCron ? 'daily-full-cron' : (state.attempts ? 'compensation-retry' : 'compensation-missed-daily')};
}

/** Daily full health, independent of how recent the latest hourly run is. */
function assessFullDaily(ledger, now=Date.now(), options={}) {
  const day = istanbulDay(now), hour = istanbulHour(now);
  const state = fullDayState(ledger, day, options);
  const verified = lastVerifiedFull(ledger, options);
  const verifiedAt = Date.parse(verified?.finishedAt);
  const age = Number.isFinite(verifiedAt) ? now - verifiedAt : null;
  const msSinceMidnightTarget = (hour - FULL_TARGET_HOUR) * HOUR;
  let level = 'ok', code = null, detail = 'Daily full update verified today.';
  if (age===null || age > FULL_OVERDUE_MS) {
    level='critical'; code='full-update-overdue'; detail = age===null ? 'No verified full update recorded.' : `Last verified full update is ${Math.round(age/HOUR)} h old.`;
  } else if (!state.complete) {
    if (state.attempts >= FULL_MAX_ATTEMPTS_PER_DAY) { level='critical'; code='full-update-failed'; detail=`${state.attempts} full attempts today without a verified success (last: ${state.lastAttemptStatus}).`; }
    else if (hour < FULL_TARGET_HOUR || msSinceMidnightTarget < FULL_GRACE_MS) { level='info'; detail = 'Daily full update not yet due or still within the grace window.'; }
    else { level='warning'; code='full-update-late'; detail = state.attempts ? `Full attempt failed (${state.lastAttemptStatus}); retry is bounded and cooling down.` : 'Daily full update has not started yet; a later scheduled run will compensate.'; }
  }
  return {level, code, detail, day, state, lastVerifiedFullAt: verified?.finishedAt || null};
}

/**
 * Scheduler health from a window of recent runs (newest first, any event).
 * The latest run alone is never enough: a running/queued run, an older
 * success, and the failures since that success are all considered.
 */
function assessScheduler(runs, now=Date.now()) {
  const list = (runs||[]).filter(Boolean);
  if (!list.length) return {level:'critical', code:'scheduler-missing', detail:'No workflow runs found.', counts:{}};
  const age = (r, key='created_at') => now - Date.parse(r[key]||r.created_at);
  const active = list.filter(r => r.status!=='completed');
  const stuck = active.filter(r => r.status==='in_progress' && age(r,'run_started_at') > RUN_STUCK_MS);
  const queued = active.filter(r => r.status!=='in_progress');
  const completed = list.filter(r => r.status==='completed' && r.conclusion!=='cancelled' && r.conclusion!=='skipped');
  const success = completed.find(r => r.conclusion==='success');
  const failedSince = completed.filter(r => r.conclusion!=='success' && (!success || Date.parse(r.created_at) > Date.parse(success.created_at)));
  const counts = {running: active.length-queued.length, queued: queued.length, failedSinceSuccess: failedSince.length, cancelled: list.filter(r=>r.conclusion==='cancelled').length};
  const successAge = success ? now - Date.parse(success.updated_at||success.created_at) : null;
  const common = {counts, lastSuccessRunId: success?.id||null, lastSuccessAt: success?.updated_at||null};
  if (stuck.length) return {level:'critical', code:'scheduler-stuck', detail:`Run ${stuck[0].id} has been in progress for over ${Math.round(RUN_STUCK_MS/60000)} min.`, ...common};
  if (!success) return {level:'critical', code:'scheduler-failed', detail:'No successful run in the inspected window.', ...common};
  if (failedSince.length) {
    return {level:'critical', code:'scheduler-failed', detail:`${failedSince.length} run(s) failed since the last success (${failedSince[0].html_url||failedSince[0].id}).`, ...common};
  }
  const running = active.some(r => r.status==='in_progress');
  if (successAge > SCHEDULER_MISSED_MS && !running) return {level:'critical', code:'scheduler-missed', detail:`No successful run for ${Math.round(successAge/HOUR)} h; GitHub did not fire scheduled events.`, ...common};
  if (queued.some(r => age(r) > RUN_QUEUE_WARN_MS)) return {level:'warning', code:'scheduler-queue-delayed', detail:'A run has waited in the queue for over 60 min.', ...common};
  if (successAge > SCHEDULER_DELAY_WARN_MS && !running) return {level:'warning', code:'scheduler-delayed', detail:`Last success ${Math.round(successAge/60000)} min ago; scheduled events are delayed or dropped by GitHub.`, ...common};
  return {level:'ok', code:null, detail: running ? 'A run is in progress.' : 'Recent run succeeded.', ...common};
}

/**
 * Static fixture file freshness versus the live runtime API. A fresh live API
 * never hides a stale static file (SEO pages, prerendered HTML and the
 * fallback read it); it only changes the severity.
 */
function assessFixtureFreshness({staticAgeMs, runtimeFresh, emptyConfirmed=false}) {
  if (!Number.isFinite(staticAgeMs)) return {level:'critical', code:'fixtures-stale', detail:'Static fixture observation time is unknown.'};
  if (staticAgeMs > STATIC_FIXTURE_CRITICAL_MS) return {level:'critical', code:'fixtures-stale', detail:`Static fixtures are ${Math.round(staticAgeMs/HOUR)} h old.`};
  if (staticAgeMs > STATIC_FIXTURE_WARN_MS && !runtimeFresh && !emptyConfirmed) return {level:'critical', code:'fixtures-stale', detail:'Static fixtures are stale and the live API is not fresh.'};
  if (staticAgeMs > STATIC_FIXTURE_WARN_MS) return {level:'warning', code:'fixtures-static-delayed', detail:`Static fixtures are ${Math.round(staticAgeMs/60000)} min old; live API is fresh.`};
  return {level:'ok', code:null, detail:'Static fixtures are fresh.'};
}

/**
 * Static fixture file dated to a different Istanbul day than today. Right after
 * Istanbul midnight the hourly job can lag (GitHub drops scheduled events), so
 * the static file is still yesterday's while the live API already serves today.
 * That window is a delay, not an outage; it turns critical only when the live
 * API is not fresh too, or the static file is older than the critical bound.
 */
function assessFixtureDay({sourceDay, today, staticAgeMs, runtimeFresh}) {
  if (!sourceDay || sourceDay === today) return {level:'ok', code:null, detail:'Static fixture day matches Istanbul today.'};
  if (runtimeFresh && Number.isFinite(staticAgeMs) && staticAgeMs <= STATIC_FIXTURE_CRITICAL_MS) {
    return {level:'warning', code:'fixture-day-rollover', detail:`Static fixtures are still dated ${sourceDay} (Istanbul today is ${today}); live API is fresh.`};
  }
  return {level:'critical', code:'wrong-fixture-day', detail:`Static fixtures are dated ${sourceDay}, Istanbul today is ${today}, and the live API is not a fresh fallback.`};
}

/**
 * Tek tek kaynakların son BAŞARILI zamanı. Koşu yeşil olsa bile bir kaynak
 * sessizce başarısız olabilir (fixture-calendar 36 saat boyunca zaman aşımına
 * uğradı, koşular yeşildi). `criticalMs: null` kaynağı yalnızca uyarıya çevirir.
 */
const SOURCE_FRESHNESS = Object.freeze({
  'live-fixtures': {warnMs: 6 * HOUR, criticalMs: 24 * HOUR},
  'standings': {warnMs: 6 * HOUR, criticalMs: 24 * HOUR},
  'football-news': {warnMs: 8 * HOUR, criticalMs: null},
  'english-news': {warnMs: 12 * HOUR, criticalMs: null},
  'fixture-calendar': {warnMs: 30 * HOUR, criticalMs: null},
});

function assessSourceFreshness(id, source, now = Date.now(), table = SOURCE_FRESHNESS) {
  const rule = table[id];
  if (!rule) return {level:'ok', code:null, detail:`No freshness rule for ${id}.`};
  if (!source) return {level:'ok', code:null, detail:`${id}: not tracked in this ledger.`};
  const last = Date.parse(source.lastSuccessfulAt);
  if (!Number.isFinite(last)) return {level:'warning', code:`source-unknown-${id}`, detail:`${id}: no successful run recorded.`};
  const age = now - last;
  const hours = Math.round(age / HOUR);
  if (rule.criticalMs && age > rule.criticalMs) return {level:'critical', code:`source-stale-${id}`, detail:`${id}: last success ${hours} h ago.`, ageMs: age};
  if (age > rule.warnMs) return {level:'warning', code:`source-stale-${id}`, detail:`${id}: last success ${hours} h ago${source?.error ? ` (last error: ${String(source.error).slice(0, 80)})` : ''}.`, ageMs: age};
  return {level:'ok', code:null, detail:`${id}: fresh.`, ageMs: age};
}

module.exports = { semantic, version, modeFor, skipReason, STOP_CODES, istanbulDay, istanbulHour, hourlyKey, fullKey, assessRun,
  assessCompletion, fullDayState, lastVerifiedFull, decideUpdateType, assessFullDaily, assessScheduler, assessFixtureFreshness, assessFixtureDay, assessSourceFreshness, SOURCE_FRESHNESS,
  limits: {FULL_TARGET_HOUR, FULL_LAST_START_HOUR, FULL_MAX_ATTEMPTS_PER_DAY, FULL_RETRY_COOLDOWN_MS, FULL_GRACE_MS, FULL_OVERDUE_MS,
    SCHEDULER_DELAY_WARN_MS, SCHEDULER_MISSED_MS, STATIC_FIXTURE_WARN_MS, STATIC_FIXTURE_CRITICAL_MS} };
