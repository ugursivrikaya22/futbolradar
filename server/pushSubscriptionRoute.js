const { enforceRateLimit, sendError, sendSuccess, setCachePolicy } = require("../api/_utils");
const {
  configurationHint,
  isConfigured,
  removeSubscription,
  saveSubscription
} = require("../services/pushSubscriptionStore");
const { vapidConfig } = require("../services/pushNotifier");

/**
 * FAVORİ TAKIM PUSH ABONELİĞİ UÇ NOKTASI.
 *
 *   GET    /api/push-subscribe  → VAPID genel anahtarı + yapılandırma durumu
 *   POST   /api/push-subscribe  → abonelik kaydet/güncelle (favori takım seçimi)
 *   DELETE /api/push-subscribe  → abonelik sil (bildirimleri kapat)
 *
 * DOSYA `api/` ALTINDA DEĞİL — aynı gerekçe `server/homePollRoute.js`te
 * yazılı: Vercel Hobby planında `api/` altındaki her dosya ayrı bir
 * sunucusuz işlev sayılıyor. Yönlendirme `api/[...route].js`.
 *
 * SUNUCU İSTEMCİNİN GÖNDERDİĞİ TAKIMA GÜVENMEZ: `favoriteTeam` yalnızca
 * `data/teams.json`daki 18 Süper Lig takımından biriyse kabul edilir.
 * Geçersiz bir slug, gönderim zamanı `services/pushNotifier.js`te sessizce
 * hiçbir aboneye ulaşmayan bir abonelik biriktirirdi.
 */

const SOURCE = "push-subscribe";

function loadTeamIds() {
  try {
    const teams = require("../data/teams.json");
    return new Set((Array.isArray(teams) ? teams : []).map((team) => String(team && team.id || "")));
  } catch (error) {
    return new Set();
  }
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return null;
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) return null;
    chunks.push(chunk);
  }
  if (!chunks.length) return null;

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    return null;
  }
}

function isValidEndpoint(value) {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

async function handlePushSubscription(req, res) {
  const method = String(req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.setHeader("Allow", "GET, POST, DELETE, OPTIONS");
    res.statusCode = 204;
    return res.end();
  }
  if (!["GET", "POST", "DELETE"].includes(method)) {
    res.setHeader("Allow", "GET, POST, DELETE, OPTIONS");
    return sendError(res, 405, "Bu uc nokta yalnizca GET, POST ve DELETE kabul eder.", "METHOD_NOT_ALLOWED", SOURCE);
  }

  setCachePolicy(res, "push-subscription");
  if (enforceRateLimit(req, res, { windowMs: 60000, limit: method === "GET" ? 90 : 20 })) return undefined;

  if (method === "GET") {
    const vapid = vapidConfig();
    if (!vapid.publicKey || !isConfigured()) {
      return sendSuccess(res, { configured: false, publicKey: null }, SOURCE, null, {
        note: "Push bildirimi yapilandirilmamis.",
        configuration: configurationHint() || "VAPID anahtarlari tanimli degil"
      });
    }
    return sendSuccess(res, { configured: true, publicKey: vapid.publicKey }, SOURCE);
  }

  if (!isConfigured()) {
    return sendError(res, 503, "Push abonelik deposu yapilandirilmamis.", "PUSH_STORE_UNAVAILABLE", SOURCE);
  }

  const body = await readJsonBody(req);

  if (method === "DELETE") {
    const endpoint = String((body && body.endpoint) || "").trim();
    if (!isValidEndpoint(endpoint)) {
      return sendError(res, 400, "Gecerli bir endpoint gerekli.", "INVALID_ENDPOINT", SOURCE);
    }
    try {
      await removeSubscription(endpoint);
      return sendSuccess(res, { removed: true }, SOURCE);
    } catch (error) {
      return sendError(res, 502, "Abonelik silinemedi.", "PUSH_STORE_ERROR", SOURCE);
    }
  }

  // POST — kaydet/güncelle.
  const subscription = body && body.subscription;
  const endpoint = subscription && String(subscription.endpoint || "").trim();
  const p256dh = subscription && subscription.keys && String(subscription.keys.p256dh || "").trim();
  const auth = subscription && subscription.keys && String(subscription.keys.auth || "").trim();
  const favoriteTeam = String((body && body.favoriteTeam) || "").trim();

  if (!isValidEndpoint(endpoint) || !p256dh || !auth) {
    return sendError(res, 400, "Gecerli bir push abonelik nesnesi gerekli.", "INVALID_SUBSCRIPTION", SOURCE);
  }

  const teamIds = loadTeamIds();
  if (!favoriteTeam || !teamIds.has(favoriteTeam)) {
    return sendError(res, 400, "Gecerli bir favori takim secilmeli.", "INVALID_TEAM", SOURCE);
  }

  try {
    await saveSubscription({
      endpoint,
      p256dh,
      auth,
      favoriteTeam,
      userAgent: req.headers && req.headers["user-agent"]
    });
    return sendSuccess(res, { saved: true, favoriteTeam }, SOURCE);
  } catch (error) {
    return sendError(res, 502, "Abonelik kaydedilemedi.", "PUSH_STORE_ERROR", SOURCE);
  }
}

module.exports = { handlePushSubscription };
