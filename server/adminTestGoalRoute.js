/**
 * YÖNETİCİ TEST BİLDİRİMİ — POST /api/admin/test-goal
 *
 * Sahte bir maç olayıyla gerçek gönderim hattını (buildPayload → webPush)
 * uçtan uca dener. `ADMIN_TEST_TOKEN` tanımlı değilse 404, yanlışsa 401
 * (sabit zamanlı karşılaştırma). Gövde (JSON):
 *
 *   { "team": "fenerbahce" | "match": "<sağlayıcı-maç-kimliği>",
 *     "type": "goal" | "yellow-card" | "red-card" | "penalty",
 *     "outcome": "scored" | "missed"   (yalnızca penalty, varsayılan scored)
 *     "side": "home" | "away",          (varsayılan home)
 *     "endpoint": "https://..."         (opsiyonel: yalnızca bu aboneliğe)
 *     "dryRun": true }                  (gönderme, yükü döndür)
 *
 * Tekilleştirme tablosuna YAZMAZ ve sağlayıcıya istek ATMAZ.
 */
const { enforceRateLimit, sendError, sendSuccess, setCachePolicy } = require("../api/_utils");
const { authorize } = require("./liveScoreTickRoute");

const SOURCE = "admin-test-goal";
const TYPES = new Set(["goal", "yellow-card", "red-card", "penalty"]);

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (error) { return null; }
  }
  if (!req || typeof req[Symbol.asyncIterator] !== "function") return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) return null;
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null; } catch (error) { return null; }
}

function buildTestEvent(body, teams) {
  const type = String(body.type || "goal").trim();
  if (!TYPES.has(type)) return { error: "INVALID_TYPE" };
  const side = body.side === "away" ? "away" : "home";
  const teamId = String(body.team || "").trim();
  const matchId = String(body.match || "").trim().replace(/^match:/, "");
  let homeTeam = "Ev Sahibi";
  let awayTeam = "Deplasman";
  let subscriberKeys;

  if (teamId) {
    const team = teams.find((item) => item && String(item.id) === teamId);
    if (!team) return { error: "INVALID_TEAM" };
    if (side === "home") homeTeam = team.name; else awayTeam = team.name;
    subscriberKeys = [teamId];
  } else if (/^[A-Za-z0-9_-]{1,40}$/.test(matchId)) {
    subscriberKeys = [`match:${matchId}`];
  } else {
    return { error: "TEAM_OR_MATCH_REQUIRED" };
  }

  const minute = Number.isFinite(Number(body.minute)) ? Number(body.minute) : 37;
  const match = {
    id: matchId || `test-${teamId}`,
    providerId: matchId || null,
    homeTeam,
    awayTeam,
    minute,
    score: { home: side === "home" ? 1 : 0, away: side === "away" ? 1 : 0 },
    events: []
  };
  const event = { type, side, match, redCount: 1 };
  if (type === "penalty") event.outcome = body.outcome === "missed" ? "missed" : "scored";
  if (type === "yellow-card" || type === "penalty") {
    event.providerEvent = { time: `${minute}'`, value: "Test Oyuncu", teamName: side === "home" ? homeTeam : awayTeam };
  }
  return { event, subscriberKeys };
}

async function handleAdminTestGoal(req, res, deps = {}) {
  setCachePolicy(res, "push-subscription");
  const denied = authorize(req, "ADMIN_TEST_TOKEN");
  if (denied === 404) return sendError(res, 404, "Bulunamadi.", "NOT_FOUND", SOURCE);
  if (denied === 401) return sendError(res, 401, "Yetkisiz.", "UNAUTHORIZED", SOURCE);
  const url = new URL(req.url || "/", "http://localhost");
  if (!/^\/api\/admin\/test-goal\/?$/.test(url.pathname)) return sendError(res, 404, "Bulunamadi.", "NOT_FOUND", SOURCE);
  if (String(req.method || "GET").toUpperCase() !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Yalnizca POST.", "METHOD_NOT_ALLOWED", SOURCE);
  }
  if (enforceRateLimit(req, res, { windowMs: 60000, limit: 10 })) return undefined;

  const notifier = deps.notifier || require("../services/pushNotifier");
  const store = deps.store || require("../services/pushSubscriptionStore");
  const teams = deps.teams || require("../services/teamIdentity").loadTeams();

  const body = (await readJsonBody(req)) || {};
  const built = buildTestEvent(body, teams);
  if (built.error) return sendError(res, 400, "Gecersiz istek.", built.error, SOURCE);

  const payload = notifier.buildPayload(built.event);
  payload.title = `[TEST] ${payload.title}`;
  payload.tag = `test-${payload.tag}`;
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";

  if (body.dryRun === true || body.dryRun === "true") {
    return sendSuccess(res, { dryRun: true, payload, subscriberKeys: built.subscriberKeys, endpoint: endpoint || null, configured: notifier.isConfigured() }, SOURCE);
  }
  if (!notifier.isConfigured()) {
    return sendError(res, 503, "Push yapilandirilmamis (VAPID/Supabase).", "PUSH_NOT_CONFIGURED", SOURCE);
  }

  let subscribers = [];
  try {
    if (endpoint) {
      const row = await store.getByEndpoint(endpoint);
      subscribers = row ? [row] : [];
    } else {
      for (const key of built.subscriberKeys) subscribers.push(...(await store.listByTeam(key)));
    }
  } catch (error) {
    return sendError(res, 502, "Aboneler okunamadi.", "PUSH_STORE_ERROR", SOURCE);
  }

  const vapid = notifier.vapidConfig();
  const results = await Promise.all(subscribers.map((subscriber) => notifier.sendToSubscriber(subscriber, payload, vapid)));
  return sendSuccess(res, {
    dryRun: false,
    payload,
    subscriberKeys: built.subscriberKeys,
    attempted: subscribers.length,
    delivered: results.filter((result) => result && result.ok).length,
    expiredRemoved: results.filter((result) => result && result.expired).length
  }, SOURCE);
}

module.exports = { buildTestEvent, handleAdminTestGoal };
