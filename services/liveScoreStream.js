/**
 * Shared live-score poller for one warm server instance.
 *
 * API-Football exposes live fixtures over REST and documents a 15-second
 * refresh cadence. One provider request therefore feeds every connected SSE
 * client in this instance. The provider adapter adds a second single-flight
 * guard, so a simultaneous JSON request joins the same cached provider result.
 */
const { getProvider } = require("./providers");

const PROVIDER_CADENCE_MS = 15000;
const LOW_QUOTA_CADENCE_MS = 60000;
const EXHAUSTED_QUOTA_CADENCE_MS = 5 * 60 * 1000;
const LIVE_STATUS_CODES = new Set(["LIVE", "IN_PLAY", "1H", "2H", "HT", "HALFTIME", "ET", "BT", "P", "INT", "PAUSED"]);

function isoOrNull(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function isLiveMatch(match) {
  const status = String((match && (match.providerStatus || match.status)) || "").toUpperCase();
  return Boolean(match && (match.live || LIVE_STATUS_CODES.has(status)));
}

function parseElapsedMinutes(value) {
  const match = String(value || "").match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!match) return null;
  const base = Number(match[1]);
  const extra = match[2] ? Number(match[2]) : 0;
  return Number.isFinite(base) && Number.isFinite(extra) ? base + extra : null;
}

function estimatedEventTime(kickoff, event) {
  const minutes = parseElapsedMinutes(event && (event.time || event.minute));
  const kickoffMs = kickoff ? Date.parse(kickoff) : NaN;
  if (minutes === null || !Number.isFinite(kickoffMs)) return null;
  return new Date(kickoffMs + minutes * 60000).toISOString();
}

function eventSnapshot(event, kickoff) {
  return {
    id: event && event.id ? String(event.id) : null,
    type: event && event.type ? String(event.type) : null,
    detail: event && event.detail ? String(event.detail) : null,
    time: event && event.time ? String(event.time) : null,
    teamId: event && event.teamId ? String(event.teamId) : null,
    playerId: event && event.playerId ? String(event.playerId) : null,
    providerEventAt: isoOrNull(event && event.providerEventAt),
    // API-Football normally supplies only elapsed minute. This is explicitly
    // labelled as an estimate and remains null if either input is absent.
    providerEventTimeEstimated: estimatedEventTime(kickoff, event)
  };
}

function matchSnapshot(match, serverReceivedAt) {
  const score = (match && match.score) || {};
  const events = (Array.isArray(match && match.events) ? match.events : []).map((event) => eventSnapshot(event, match.kickoff));
  const latestActualEvent = events.slice().reverse().find((event) => event.providerEventAt);
  const latestEstimatedEvent = events.slice().reverse().find((event) => event.providerEventTimeEstimated);
  return {
    id: String((match && (match.id || match.providerId)) || ""),
    providerId: String((match && (match.providerId || match.id)) || ""),
    homeTeam: (match && match.homeTeam) || "",
    awayTeam: (match && match.awayTeam) || "",
    kickoff: (match && match.kickoff) || null,
    status: (match && match.status) || null,
    providerStatus: (match && match.providerStatus) || null,
    minute: match && (match.minute ?? match.elapsed) != null ? Number(match.minute ?? match.elapsed) : null,
    live: isLiveMatch(match),
    score: {
      home: score.home ?? null,
      away: score.away ?? null,
      halftimeHome: score.halftimeHome ?? null,
      halftimeAway: score.halftimeAway ?? null
    },
    events,
    timing: {
      providerEventAt: latestActualEvent ? latestActualEvent.providerEventAt : null,
      providerEventTimeEstimated: latestEstimatedEvent ? latestEstimatedEvent.providerEventTimeEstimated : null,
      serverReceivedAt: isoOrNull(match && match.fetchedAt) || serverReceivedAt
    }
  };
}

function snapshotSignature(matches) {
  return JSON.stringify((Array.isArray(matches) ? matches : []).map((match) => [
    match.id,
    match.status,
    match.providerStatus,
    match.minute,
    match.score && match.score.home,
    match.score && match.score.away,
    (match.events || []).map((event) => event.id || [event.type, event.time, event.teamId, event.playerId].join(":"))
  ]));
}

function quotaAwareCadence(provider) {
  if (!provider || typeof provider.getProviderRateLimit !== "function") return PROVIDER_CADENCE_MS;
  const rate = provider.getProviderRateLimit();
  if (!rate || !Number.isFinite(rate.remaining)) return PROVIDER_CADENCE_MS;
  if (rate.remaining <= 0) return EXHAUSTED_QUOTA_CADENCE_MS;
  if (rate.remaining <= 10) return LOW_QUOTA_CADENCE_MS;
  return PROVIDER_CADENCE_MS;
}

class LiveScoreHub {
  constructor(options = {}) {
    this.provider = options.provider || getProvider("matches");
    this.fetchMatches = options.fetchMatches || ((query) => this.provider.getMatches(query));
    this.now = options.now || Date.now;
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.subscribers = new Set();
    this.timer = null;
    this.inFlight = null;
    this.lastSignature = null;
    this.lastPacket = null;
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    if (this.lastPacket) listener(this.lastPacket);
    if (!this.inFlight && !this.timer) this.poll();
    return () => {
      this.subscribers.delete(listener);
      if (!this.subscribers.size) this.stop();
    };
  }

  emit(packet) {
    this.subscribers.forEach((listener) => {
      try { listener(packet); } catch (error) { /* closed clients are isolated */ }
    });
  }

  async poll() {
    if (!this.subscribers.size) return null;
    if (this.inFlight) return this.inFlight;

    const startedMs = this.now();
    this.inFlight = Promise.resolve()
      .then(() => this.fetchMatches({ live: "all" }))
      .then((rows) => {
        const receivedMs = this.now();
        const serverReceivedAt = new Date(receivedMs).toISOString();
        const matches = (Array.isArray(rows) ? rows : []).filter(isLiveMatch).map((match) => matchSnapshot(match, serverReceivedAt));
        const providerDataReceivedAt = matches
          .map((match) => match.timing && match.timing.serverReceivedAt)
          .filter(Boolean)
          .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || serverReceivedAt;
        const signature = snapshotSignature(matches);
        const packet = {
          type: "snapshot",
          id: `${receivedMs}-${signature.length}`,
          matches,
          source: this.provider && (this.provider.name || this.provider.source) || null,
          timing: {
            // `fetchedAt` is stamped immediately after the provider response.
            // It stays unchanged on an in-process cache hit, which makes cache
            // age visible instead of pretending cached data just arrived.
            serverReceivedAt: providerDataReceivedAt,
            hubObservedAt: serverReceivedAt,
            providerFetchDurationMs: Math.max(0, receivedMs - startedMs)
          }
        };

        this.lastPacket = packet;
        if (signature !== this.lastSignature) {
          this.lastSignature = signature;
          this.emit(packet);
        }
        return packet;
      })
      .catch((error) => {
        const packet = {
          type: "provider-state",
          state: "degraded",
          code: error && error.code ? error.code : "LIVE_PROVIDER_ERROR",
          timing: { serverReceivedAt: new Date(this.now()).toISOString() }
        };
        this.emit(packet);
        return packet;
      })
      .finally(() => {
        this.inFlight = null;
        if (this.subscribers.size) {
          const cadence = quotaAwareCadence(this.provider);
          this.timer = this.setTimer(() => {
            this.timer = null;
            this.poll();
          }, cadence);
          if (this.timer && typeof this.timer.unref === "function") this.timer.unref();
        }
      });

    return this.inFlight;
  }

  stop() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.lastPacket = null;
    this.lastSignature = null;
  }
}

function getLiveScoreHub() {
  const key = "__futbolRadarLiveScoreHub";
  if (!globalThis[key]) globalThis[key] = new LiveScoreHub();
  return globalThis[key];
}

module.exports = {
  EXHAUSTED_QUOTA_CADENCE_MS,
  LIVE_STATUS_CODES,
  LOW_QUOTA_CADENCE_MS,
  LiveScoreHub,
  PROVIDER_CADENCE_MS,
  estimatedEventTime,
  eventSnapshot,
  getLiveScoreHub,
  isLiveMatch,
  matchSnapshot,
  parseElapsedMinutes,
  quotaAwareCadence,
  snapshotSignature
};
