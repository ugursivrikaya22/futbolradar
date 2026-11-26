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
const NO_LIVE_CADENCE_MS = 60000;
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
    homeTeamLogo: (match && match.homeTeamLogo) || null,
    awayTeamLogo: (match && match.awayTeamLogo) || null,
    // Canlı puan durumu maçı doğru takım satırına kimlikle bağlıyor
    // (services/liveStandings.js). Ad eşleşmesi yedek yol; kimlik yoksa
    // alan null kalır.
    homeTeamId: (match && match.homeTeamId) ? String(match.homeTeamId) : null,
    awayTeamId: (match && match.awayTeamId) ? String(match.awayTeamId) : null,
    league: (match && match.league) || "",
    competitionId: (match && match.competitionId) || null,
    providerLeagueId: (match && match.providerLeagueId) || null,
    kickoff: (match && match.kickoff) || null,
    fetchedAt: isoOrNull(match && match.fetchedAt),
    staleAfter: isoOrNull(match && match.staleAfter),
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
      serverReceivedAt: isoOrNull(match && match.fetchedAt) || serverReceivedAt,
      provider_event_time: latestActualEvent ? latestActualEvent.providerEventAt : null,
      backend_receive_time: isoOrNull(match && match.fetchedAt) || serverReceivedAt
    }
  };
}

/**
 * Ardışık iki anlık görüntü arasında gol ve maç başı olaylarını bulur.
 *
 * SOĞUK BAŞLANGIÇTA SESSİZ KALIR — `everPolled` false iken hiç olay
 * üretilmez. Sebep: bu hub tek bir sıcak sunucusuz örnekte yaşıyor;
 * örnek her uyandığında `previousMatchesById` boştur. O anda canlı olan
 * her maçı "az önce başladı" saymak, zaten 60. dakikada olan bir maç için
 * favori takım abonelerine yanlış "maç başladı" bildirimi gönderirdi.
 * Gol karşılaştırması `prev` yokluğunda zaten atlanıyor (skор artışı
 * ancak önceki skor bilinirse ölçülebilir), yalnızca kickoff için ayrı
 * bir bekçi gerekiyordu.
 */
/** Sağlayıcının durum kodu; bildirim geçişleri yalnızca buna bakar. */
function statusCode(match) {
  return String((match && (match.providerStatus || match.status)) || "").toUpperCase();
}

const HALFTIME_STATUSES = new Set(["HT", "HALFTIME", "BT"]);
const FINISHED_STATUSES = new Set(["FT", "FINISHED", "AET", "PEN"]);

/**
 * Olay akışındaki kırmızı kart sayısı. "İkinci sarıdan kırmızı" da kırmızı
 * sayılır — sahada sonucu aynı: takım eksik kalır.
 */
function countRedCards(events) {
  let total = 0;
  for (const event of Array.isArray(events) ? events : []) {
    const detail = String((event && event.detail) || "").toLowerCase();
    if (detail.includes("red card") || detail.includes("second yellow")) total += 1;
  }
  return total;
}

function detectMatchEvents(previousById, matches, everPolled) {
  const events = [];
  for (const match of matches) {
    const prev = previousById.get(match.id);

    if (everPolled && prev && /^(NS|SCHEDULED|TIMED|NOT_STARTED)$/.test(statusCode(prev)) && match.live) {
      events.push({ type: "kickoff", match });
    }

    if (prev) {
      const teams = (match.lineupTeams || []).filter(team => !(prev.lineupTeams || []).includes(team));
      if (teams.length) events.push({type:"lineup", teams, match});
      const prevHome = Number.isFinite(prev.score && prev.score.home) ? prev.score.home : null;
      const prevAway = Number.isFinite(prev.score && prev.score.away) ? prev.score.away : null;
      const nextHome = Number.isFinite(match.score && match.score.home) ? match.score.home : null;
      const nextAway = Number.isFinite(match.score && match.score.away) ? match.score.away : null;

      if (prevHome !== null && nextHome !== null && nextHome > prevHome) {
        events.push({ type: "goal", side: "home", match });
      }
      if (prevAway !== null && nextAway !== null && nextAway > prevAway) {
        events.push({ type: "goal", side: "away", match });
      }

      // DEVRE ARASI VE MAÇ SONU — DURUM GEÇİŞİNDEN, SAATTEN DEĞİL.
      //
      // Dakikaya bakarak "45 oldu, devre arasıdır" demek uzatma dakikalarında
      // yanlış olurdu. Sağlayıcının kendi durum kodu tek doğru kaynak ve
      // yalnızca GEÇİŞ anında olay üretilir: aynı durumda kalan her yoklama
      // yeni bir bildirim göndermez.
      const wasHalftime = HALFTIME_STATUSES.has(statusCode(prev));
      const isHalftime = HALFTIME_STATUSES.has(statusCode(match));
      if (!wasHalftime && isHalftime) {
        events.push({ type: "halftime", match });
      }

      const wasFinished = FINISHED_STATUSES.has(statusCode(prev));
      const isFinished = FINISHED_STATUSES.has(statusCode(match));
      if (!wasFinished && isFinished) {
        events.push({ type: "fulltime", match });
      }

      // KIRMIZI KART — OLAY AKIŞINDAKİ SAYIM ARTIŞINDAN.
      //
      // Skor gibi tek bir sayı yok; kırmızı kart olaylarının SAYISI
      // karşılaştırılıyor. Sağlayıcı aynı kartı iki kez listelerse sayı
      // artmaz, yani tekrar bildirim gitmez.
      const prevReds = countRedCards(prev.events);
      const nextReds = countRedCards(match.events);
      if (nextReds > prevReds) {
        events.push({ type: "red-card", match });
      }
    }
  }
  return events;
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
  const configured=require('../data/operations-policy.json').mode;
  if(configured==='protected') return EXHAUSTED_QUOTA_CADENCE_MS;
  if(configured==='saving') return LOW_QUOTA_CADENCE_MS;
  if (!provider || typeof provider.getProviderRateLimit !== "function") return PROVIDER_CADENCE_MS;
  const rate = provider.getProviderRateLimit();
  if (!rate || !Number.isFinite(rate.remaining)) return PROVIDER_CADENCE_MS;
  if (rate.remaining <= 0) return EXHAUSTED_QUOTA_CADENCE_MS;
  if (rate.remaining <= 10 || (Number.isFinite(rate.limit)&&rate.limit>0&&rate.remaining/rate.limit<0.15)) return LOW_QUOTA_CADENCE_MS;
  return PROVIDER_CADENCE_MS;
}

function nextPollCadence(provider, hasLiveMatches) {
  return Math.max(
    hasLiveMatches ? PROVIDER_CADENCE_MS : NO_LIVE_CADENCE_MS,
    quotaAwareCadence(provider)
  );
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
    this.hasLiveMatches = false;
    // Gol/maç başı bildirimi kancası — bkz. `detectMatchEvents`. Varsayılan
    // yok: testler ve `subscribe()`in kendisi bunu tetiklemesin, yalnızca
    // üretim tekil örneği (`getLiveScoreHub`) `services/pushNotifier.js`i bağlar.
    this.onMatchEvents = typeof options.onMatchEvents === "function" ? options.onMatchEvents : null;
    this.previousMatchesById = new Map();
    this.everPolled = false;
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
        this.hasLiveMatches = matches.length > 0;
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
            providerFetchDurationMs: Math.max(0, receivedMs - startedMs),
            provider_event_time: matches.map((match) => match.timing.provider_event_time).filter(Boolean).sort().slice(-1)[0] || null,
            backend_receive_time: providerDataReceivedAt
          }
        };

        this.lastPacket = packet;
        if (signature !== this.lastSignature) {
          this.lastSignature = signature;
          this.emit(packet);

          if (this.onMatchEvents) {
            const events = detectMatchEvents(this.previousMatchesById, matches, this.everPolled);
            if (events.length) {
              try { this.onMatchEvents(events); } catch (error) { /* bildirim hatası akışı kesmez */ }
            }
          }
        }
        this.previousMatchesById = new Map(matches.map((match) => [match.id, match]));
        this.everPolled = true;
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
          const cadence = nextPollCadence(this.provider, this.hasLiveMatches);
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
    // Son aboneyi de kaybettiğimiz an durum sıfırlanır: bir sonraki
    // `poll()` bilinmeyen bir boşluktan sonra başlıyor, önceki anlık
    // görüntüyle karşılaştırmak yanlış bir maç başı/gol olayı üretebilir.
    this.previousMatchesById = new Map();
    this.everPolled = false;
  }
}

function getLiveScoreHub() {
  const key = "__futbolRadarLiveScoreHub";
  if (!globalThis[key]) {
    // Döngüsel require'dan kaçınmak için gecikmeli yüklenir: pushNotifier
    // bu dosyayı değil `getLiveScoreHub`ı hiç import etmiyor, ama ileride
    // etseydi bu satır modül yükleme sırasına bağlı kalmazdı.
    const { notifyMatchEvents } = require("./pushNotifier");
    globalThis[key] = new LiveScoreHub({ onMatchEvents: process.env.PUSH_DELIVERY_MODE === "worker" ? null : notifyMatchEvents });
  }
  return globalThis[key];
}

module.exports = {
  EXHAUSTED_QUOTA_CADENCE_MS,
  LIVE_STATUS_CODES,
  LOW_QUOTA_CADENCE_MS,
  NO_LIVE_CADENCE_MS,
  LiveScoreHub,
  PROVIDER_CADENCE_MS,
  detectMatchEvents,
  estimatedEventTime,
  eventSnapshot,
  getLiveScoreHub,
  isLiveMatch,
  matchSnapshot,
  nextPollCadence,
  parseElapsedMinutes,
  quotaAwareCadence,
  snapshotSignature
};
