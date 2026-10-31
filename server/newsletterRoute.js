/**
 * E-POSTA BÜLTENİ UÇ NOKTASI — /api/newsletter (catch-all `api/[...route].js` üzerinden).
 *
 *   POST /api/newsletter                          { name, email, consent, website(bal küpü), t }
 *        → çift onay: bekleyen kayıt + onay e-postası (yanıt adres var/yok bilgisini SIZDIRMAZ)
 *   GET  /api/newsletter?action=confirm&token=…   → onay; /bulten.html?durum=… sayfasına yönlendirir
 *   GET  /api/newsletter?action=unsubscribe&token=… → tek tıkla çıkış (e-postadaki bağlantı)
 *   POST /api/newsletter?action=unsubscribe&token=… → RFC 8058 List-Unsubscribe-Post tek tık
 *
 * Abone listesi hiçbir uçtan okunamaz. NEWSLETTER_ENABLED/RESEND yoksa kayıt alınmaz (503).
 */
const crypto = require("crypto");
const { enforceRateLimit, sendError, sendSuccess } = require("../api/_utils");
const config = require("../services/newsletter/config");
const render = require("../services/newsletter/render");
const resend = require("../services/newsletter/resend");
const { createStore, token, hashToken } = require("../services/newsletter/store");

const SOURCE = "newsletter";
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const GENERIC_OK = "Onay e-postası gönderildi. Aboneliği tamamlamak için gelen kutundaki bağlantıya dokun.";

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EMAIL_RE.test(email) || !/\.[a-z]{2,}$/.test(email)) return null;
  return email;
}
function normalizeName(value) {
  const name = String(value || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return name.length >= 2 ? name : null;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = typeof req.body === "string" ? req.body : "";
  if (!raw && req && typeof req[Symbol.asyncIterator] === "function") {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 4096) return null; chunks.push(chunk); }
    raw = Buffer.concat(chunks).toString("utf8");
  }
  if (!raw) return {};
  const type = String((req.headers && req.headers["content-type"]) || "");
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch (error) { return Object.fromEntries(new URLSearchParams(raw)); }
}

function redirect(res, site, state) {
  res.statusCode = 303;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Location", `/bulten.html?durum=${encodeURIComponent(state)}`);
  res.end();
}

function ipHash(req) {
  const ip = String((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "").split(",")[0].trim();
  const salt = process.env.HOME_POLL_IP_SALT || process.env.SUPABASE_IP_SALT || "";
  return ip && salt ? crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex") : null;
}

async function subscribe(req, res, deps) {
  const body = await readBody(req);
  if (!body) return sendError(res, 400, "Geçersiz istek.", "BAD_REQUEST", SOURCE);
  // Bal küpü + çok hızlı gönderim: botlara başarılı görünür, hiçbir şey kaydedilmez.
  const elapsed = Date.now() - Number(body.t || 0);
  if (String(body.website || "").trim() || (body.t && elapsed < 2500)) return sendSuccess(res, { message: GENERIC_OK }, SOURCE);
  const email = normalizeEmail(body.email);
  const name = normalizeName(body.name);
  if (!name) return sendError(res, 400, "Lütfen adını yaz (en az 2 karakter).", "NAME_REQUIRED", SOURCE);
  if (!email) return sendError(res, 400, "Geçerli bir e-posta adresi yaz.", "EMAIL_INVALID", SOURCE);
  if (!(body.consent === true || body.consent === "on" || body.consent === "1" || body.consent === "true")) {
    return sendError(res, 400, "Bülten için açık rıza kutusunu işaretlemelisin.", "CONSENT_REQUIRED", SOURCE);
  }
  if (!config.sendingEnabled(deps.env) || !deps.store.isConfigured()) {
    return sendError(res, 503, "Bülten aboneliği henüz aktif değil.", "NEWSLETTER_DISABLED", SOURCE);
  }
  const existing = await deps.store.findByEmail(email);
  if (existing && existing.status === "confirmed") return sendSuccess(res, { message: GENERIC_OK }, SOURCE);
  if (existing && existing.status === "pending" && existing.confirm_sent_at && Date.now() - Date.parse(existing.confirm_sent_at) < 10 * 60 * 1000) {
    return sendSuccess(res, { message: GENERIC_OK }, SOURCE); // onay e-postası tekrarına 10 dk sınırı
  }
  const raw = token();
  const record = { email, name, consentText: config.CONSENT_TEXT, consentVersion: config.CONSENT_VERSION, ipHash: ipHash(req), confirmHash: hashToken(raw) };
  if (existing) await deps.store.refreshPending(existing.id, record);
  else await deps.store.insertPending(record);
  const site = config.siteUrl(deps.env);
  const mail = render.confirmEmail({ name, site, confirmUrl: `${site}/api/newsletter?action=confirm&token=${encodeURIComponent(raw)}` });
  await deps.resend.sendOne({ from: config.fromAddress(deps.env), to: [email], ...mail }, { env: deps.env, fetcher: deps.fetcher });
  return sendSuccess(res, { message: GENERIC_OK }, SOURCE);
}

async function handleNewsletter(req, res, overrides = {}) {
  const deps = { env: process.env, store: createStore(), resend, fetcher: fetch, ...overrides };
  const method = String(req.method || "GET").toUpperCase();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  const url = new URL(req.url || "/", "http://localhost");
  const action = url.searchParams.get("action") || "";
  const rawToken = String(url.searchParams.get("token") || "").slice(0, 200);
  const site = config.siteUrl(deps.env);
  if (method === "OPTIONS") { res.statusCode = 204; res.setHeader("Allow", "GET, POST, OPTIONS"); return res.end(); }
  if (enforceRateLimit(req, res, { limit: method === "POST" && !action ? 5 : 30, windowMs: 60000, bucket: `newsletter-${action || "subscribe"}` })) return undefined;
  try {
    if (action === "confirm" && method === "GET") {
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(rawToken) || !deps.store.isConfigured()) return redirect(res, site, "gecersiz");
      return redirect(res, site, (await deps.store.confirm(rawToken)) ? "onaylandi" : "gecersiz");
    }
    if (action === "unsubscribe" && (method === "GET" || method === "POST")) {
      const ok = /^[A-Za-z0-9_-]{20,100}$/.test(rawToken) && deps.store.isConfigured() && await deps.store.unsubscribe(rawToken);
      if (method === "POST") return sendSuccess(res, { unsubscribed: true }, SOURCE); // RFC 8058: her durumda 200
      return redirect(res, site, ok ? "ayrildi" : "ayrildi");
    }
    if (!action && method === "POST") return await subscribe(req, res, deps);
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendError(res, 405, "Desteklenmeyen istek.", "METHOD_NOT_ALLOWED", SOURCE);
  } catch (error) {
    console.warn(`[newsletter] ${String(error && error.message || error).slice(0, 160)}`);
    if (action) return redirect(res, site, "hata");
    return sendError(res, 502, "Şu an kayıt alınamadı, lütfen biraz sonra tekrar dene.", "NEWSLETTER_ERROR", SOURCE);
  }
}

module.exports = { handleNewsletter, normalizeEmail, normalizeName };
