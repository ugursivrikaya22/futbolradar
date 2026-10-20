/**
 * ZAMANLANMIŞ PUSH TİKİ — GET/POST /api/live-score-tick
 *
 * SSE hub'ı (services/liveScoreStream.js) yalnızca biri canlı sayfayı açık
 * tutarken çalışıyor. Bu uç nokta bir zamanlayıcıdan (Vercel Cron ya da
 * harici cron) dakikada bir çağrılır ve aynı `detectMatchEvents` mantığını
 * PAYLAŞILAN anlık görüntü üzerinde koşturur.
 *
 * SAĞLAYICIYA (API-Football) HİÇ İSTEK ATMAZ. Okuduğu tek veri, sitenin
 * zaten yaptığı `live=all` isteğinin Supabase'e yazılmış sonucu
 * (`push_live_snapshots.id = 'live'`, bkz. services/pushEventStore.js).
 * Fikstür takviminde takip edilebilir bir maç başlama penceresinde değilse
 * Supabase'e bile gitmeden döner.
 *
 * KORUMA: `CRON_SECRET` tanımlı değilse 404; `Authorization: Bearer <CRON_SECRET>`
 * eşleşmezse 401 (Vercel Cron bu başlığı kendisi gönderir).
 *
 * DOSYA `api/` ALTINDA DEĞİL — Vercel Hobby 12 işlev sınırı; yönlendirme
 * `api/[...route].js`.
 */
const crypto = require("node:crypto");
const { sendError, sendSuccess, setCachePolicy } = require("../api/_utils");

const SOURCE = "live-score-tick";
const WINDOW_BEFORE_MS = 10 * 60 * 1000;
const WINDOW_AFTER_MS = 150 * 60 * 1000;
const MAX_SNAPSHOT_AGE_MS = 5 * 60 * 1000;
const MAX_PROCESSED_GAP_MS = 30 * 60 * 1000;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  const header = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

/** 404 = özellik kapalı (sır yok), 401 = yanlış sır, null = geçti. */
function authorize(req, secretEnvName) {
  const secret = String(process.env[secretEnvName] || "").trim();
  if (!secret) return 404;
  const provided = bearerToken(req) || String((req.headers && req.headers["x-admin-token"]) || "").trim();
  if (!provided || !safeEqual(provided, secret)) return 401;
  return null;
}

let followableFixturesCache = null;

/** Abone olunabilir maçların başlama saatleri: 18 takımdan biri oynuyorsa. */
function followableKickoffs() {
  if (followableFixturesCache) return followableFixturesCache;
  const kickoffs = [];
  try {
    // eslint-disable-next-line global-require
    const { loadTeams, teamIdForName } = require("../services/teamIdentity");
    const teams = loadTeams();
    const sources = [];
    try { sources.push(...(require("../data/fixture-calendar.json").matches || [])); } catch (error) { /* yok */ }
    try { sources.push(...(require("../data/matches.json") || [])); } catch (error) { /* yok */ }
    for (const fixture of sources) {
      if (!fixture) continue;
      if (!teamIdForName(fixture.homeTeam, teams) && !teamIdForName(fixture.awayTeam, teams)) continue;
      const ms = Date.parse(fixture.kickoff);
      if (Number.isFinite(ms)) kickoffs.push(ms);
    }
  } catch (error) {
    followableFixturesCache = null;
    return null;
  }
  followableFixturesCache = kickoffs;
  return kickoffs;
}

function inFixtureWindow(nowMs, kickoffs) {
  // Takvim okunamazsa pencere açık sayılır: tik zaten sağlayıcıya gitmiyor.
  if (!Array.isArray(kickoffs)) return true;
  return kickoffs.some((ms) => nowMs >= ms - WINDOW_BEFORE_MS && nowMs <= ms + WINDOW_AFTER_MS);
}

async function runTick(options = {}) {
  const now = (options.now || Date.now)();
  const store = options.store || require("../services/pushEventStore");
  const notify = options.notify || require("../services/pushNotifier").notifyMatchEvents;
  const { detectMatchEvents } = require("../services/liveScoreStream");
  const kickoffs = options.kickoffs !== undefined ? options.kickoffs : followableKickoffs();

  if (!inFixtureWindow(now, kickoffs)) return { ran: false, reason: "no-fixture-window", providerRequests: 0 };

  const live = await store.readSnapshot("live");
  if (!live) return { ran: false, reason: "no-shared-snapshot", providerRequests: 0 };
  const liveAt = Date.parse(live.fetchedAt);
  if (!Number.isFinite(liveAt) || now - liveAt > MAX_SNAPSHOT_AGE_MS) {
    return { ran: false, reason: "stale-shared-snapshot", snapshotAt: live.fetchedAt, providerRequests: 0 };
  }

  const processed = await store.readSnapshot("processed");
  if (processed && processed.fetchedAt === live.fetchedAt) {
    return { ran: false, reason: "no-new-snapshot", snapshotAt: live.fetchedAt, providerRequests: 0 };
  }
  const processedAt = processed ? Date.parse(processed.fetchedAt) : NaN;
  // Uzun boşluktan sonra "maç başladı" üretilmez (hub'daki soğuk başlangıç kuralı).
  const everPolled = Boolean(processed) && Number.isFinite(processedAt) && liveAt - processedAt <= MAX_PROCESSED_GAP_MS;
  const previousById = new Map((everPolled ? processed.matches : []).map((match) => [match.id, match]));

  const events = detectMatchEvents(previousById, live.matches, everPolled);
  const result = events.length ? await notify(events) : { sent: 0, skipped: 0 };
  await store.writeSnapshot("processed", live.matches, live.fetchedAt);

  return {
    ran: true,
    snapshotAt: live.fetchedAt,
    liveMatches: live.matches.length,
    events: events.map((event) => event.type),
    sent: (result && result.sent) || 0,
    skippedDuplicates: (result && result.skipped) || 0,
    providerRequests: 0
  };
}

async function handleLiveScoreTick(req, res) {
  setCachePolicy(res, "push-subscription");
  const method = String(req.method || "GET").toUpperCase();
  const denied = authorize(req, "CRON_SECRET");
  if (denied === 404) return sendError(res, 404, "Bulunamadi.", "NOT_FOUND", SOURCE);
  if (denied === 401) return sendError(res, 401, "Yetkisiz.", "UNAUTHORIZED", SOURCE);
  if (!["GET", "POST"].includes(method)) {
    res.setHeader("Allow", "GET, POST");
    return sendError(res, 405, "Yalnizca GET ve POST.", "METHOD_NOT_ALLOWED", SOURCE);
  }
  try {
    return sendSuccess(res, await runTick(), SOURCE);
  } catch (error) {
    return sendError(res, 502, "Tik calismadi.", "TICK_FAILED", SOURCE);
  }
}

function resetFixtureCache() {
  followableFixturesCache = null;
}

module.exports = { authorize, handleLiveScoreTick, inFixtureWindow, resetFixtureCache, runTick, safeEqual };
