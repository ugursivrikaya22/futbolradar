const MAX_RECENT_EVENTS = 30;

const state = {
  live: { lastSuccessAt: null, lastFailureAt: null, lastDurationMs: null, lastCount: 0, stale: false },
  news: { lastSuccessAt: null, lastFailureAt: null, lastDurationMs: null, lastImported: 0, lastRejected: 0 },
  recent: []
};

function nowIso() {
  return new Date().toISOString();
}

function push(scope, status, details) {
  state.recent.unshift({ scope, status, at: nowIso(), ...details });
  state.recent.length = Math.min(state.recent.length, MAX_RECENT_EVENTS);
}

function recordLiveSuccess({ count, durationMs, stale = false } = {}) {
  state.live.lastSuccessAt = nowIso();
  state.live.lastDurationMs = Number.isFinite(durationMs) ? durationMs : null;
  state.live.lastCount = Number.isFinite(count) ? count : 0;
  state.live.stale = Boolean(stale);
  push("live", stale ? "stale" : "success", { count: state.live.lastCount, durationMs: state.live.lastDurationMs });
}

function recordLiveFailure({ code, durationMs } = {}) {
  state.live.lastFailureAt = nowIso();
  state.live.lastDurationMs = Number.isFinite(durationMs) ? durationMs : null;
  push("live", "failure", { code: String(code || "LIVE_REFRESH_FAILED").slice(0, 80), durationMs: state.live.lastDurationMs });
}

function recordNewsIngestion({ imported, rejected, durationMs, failed = false, code } = {}) {
  const target = state.news;
  target.lastDurationMs = Number.isFinite(durationMs) ? durationMs : null;
  target.lastImported = Number.isFinite(imported) ? imported : 0;
  target.lastRejected = Number.isFinite(rejected) ? rejected : 0;
  if (failed) target.lastFailureAt = nowIso();
  else target.lastSuccessAt = nowIso();
  push("news", failed ? "failure" : "success", {
    imported: target.lastImported,
    rejected: target.lastRejected,
    durationMs: target.lastDurationMs,
    code: failed ? String(code || "NEWS_INGESTION_FAILED").slice(0, 80) : undefined
  });
}

function snapshot() {
  return {
    persistence: "process-memory",
    live: { ...state.live },
    news: { ...state.news },
    recent: state.recent.slice(0, 10)
  };
}

function resetIngestionMonitor() {
  state.live = { lastSuccessAt: null, lastFailureAt: null, lastDurationMs: null, lastCount: 0, stale: false };
  state.news = { lastSuccessAt: null, lastFailureAt: null, lastDurationMs: null, lastImported: 0, lastRejected: 0 };
  state.recent = [];
}

module.exports = { recordLiveFailure, recordLiveSuccess, recordNewsIngestion, resetIngestionMonitor, snapshot };
