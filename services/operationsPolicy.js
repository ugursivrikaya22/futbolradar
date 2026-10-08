// Shared, deterministic policy. No network, credentials or writes.
const crypto = require('node:crypto');
const OBSERVATION_KEYS = new Set(['fetchedAt','checkedAt','lastCheckedAt','lastAttemptAt','lastSuccessfulSyncAt','lastSuccessfulBackupSyncAt','syncedAt','generatedAt','updatedAt','observedAt','staleAfter','durationMs','requestCount','requestFailures','rateLimit','fixtureHealth','lastSync','lastFetchAt']);
const STOP_CODES = new Set(['PROVIDER_RATE_LIMIT','PROVIDER_AUTH_ERROR','PROVIDER_PLAN_ERROR','PROVIDER_ACCOUNT_SUSPENDED','PROVIDER_CREDENTIAL_NOT_SENT','PROVIDER_CONFIG_MISSING']);
const OPTIONAL = new Set(['fixture-predictions','competition-leaders','injuries-suspensions','football-news','english-news','manager-quotes','provider-identities','weekly-player-enrichment','weekly-photo-validation','international-opponents','refetch-finished']);
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
module.exports = { semantic, version, modeFor, skipReason, STOP_CODES, istanbulDay, assessRun };
